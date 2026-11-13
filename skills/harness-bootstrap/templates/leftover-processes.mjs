#!/usr/bin/env node
// harness-bootstrap leftover-processes hook (generated YYYY-MM-DD). Claude Code, SessionStart + Stop +
// UserPromptSubmit. [M] mechanism (ships as-is): everything except the lines marked [B]. [B] binding:
// WORKTREES, MACHINE_WIDE, REAP_MINUTES, LISTEN_HOURS, STUCK_MINUTES, DISK_NOTICE_GB and KEEP below, re-derived per project.
// One install: a probe's spawnSync timeout killed only its direct child, so about 96 `zsh -c`
// grandchildren went to process 1 and spun for about 9.5 hours on 5-8 cores; background waits stayed
// alive 19-26 hours. Each run reads `ps` once and `lsof` for cwds and TCP listeners, then:
//   reaps      own-uid orphans (parent 1, no TTY, REAP_MINUTES old, no KEEP match in their subtree,
//              their group's leader gone) that run in this checkout or are runaway `sh -c` shells
//              anywhere; one whose subtree listens only in this checkout, once LISTEN_HOURS old or
//              its directory is gone:
//              SIGTERM, SIGKILL 1 s later. A tool shell leads its group and its leftover job keeps
//              that group once the shell exits. Spared: a group leader (tmux, an editor, `ssh -f`,
//              a terminal's `nohup` job, a daemon) and a process its service manager runs (launchd's
//              list; a systemd service other than the one this hook runs in): on a server, root
//              sessions run every system service as the same uid.
//   Stop             -> blocks once per shell on the session's tool shells stuck STUCK_MINUTES with no CPU
//   UserPromptSubmit -> additionalContext to the model: the listeners in this checkout and every
//                       MACHINE_WIDE executable, at most once per LIST_MINUTES
//   SessionStart, Stop -> one desktop notification a day machine-wide under DISK_NOTICE_GB free
// The reaped line goes to the model (SessionStart, UserPromptSubmit, a Stop block; a Stop with nothing
// stuck keeps it for the next prompt) and says how to keep a job running. Never fails the
// turn. A failed ps or listener reading reaps nothing; right before each signal a fresh ps reading
// spares a pid that is no longer the orphan it was. Test seams: LEFTOVER_PS, LEFTOVER_PS_RECHECK
// (that fresh reading), LEFTOVER_KILL=0, LEFTOVER_REAP_MINUTES, LEFTOVER_RUNAWAY=0 (no
// runaway rule), LEFTOVER_MANAGED (a file, one service-managed pid per line), LEFTOVER_HOME,
// LEFTOVER_NOTIFY=0, LEFTOVER_FREE_GB.
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKTREES = '.worktrees'; // [B] where this project's worktrees live, relative to the main checkout
const MACHINE_WIDE = /^(qemu-system|emulator64-)/; // [B] executables named whoever started them (an Android emulator is ~2 GB)
const REAP_MINUTES = 10; // [B] an orphan this old is reaped
const LISTEN_HOURS = 6; // [B] an orphan in the checkout whose subtree listens is reaped at this age, and at once when its directory is gone (6: the sweep's idle-worktree hours)
const STUCK_MINUTES = 30; // [B] a tool shell this old with no CPU is stuck
const DISK_NOTICE_GB = 5; // [B] the desktop notification's free-space floor
const KEEP = null; // [B] a regex: an orphan whose command line, or a child's, matches is never reaped (an owner-named worker, e.g. /\bqueue:work\b/)
const RUNAWAY_CPU = 0.3; // a shell spinning at this share of one core since it started
const STUCK_CPU = 0.01; // a tool shell's subtree under this share is waiting, not working
const LIST_MINUTES = 60; // the leftover listing repeats this often at most
const PENDING_MAX = 5; // reaped lines a Stop keeps for the next prompt
const SHELLS = new Set(['zsh', 'bash', 'sh', 'dash']);
const TOOL_SHELLS = new Set(['zsh', 'bash', 'sh']);
const NO_TTY = new Set(['??', '?']);
const PS_ARGS = ['-axo', 'pid=,ppid=,pgid=,uid=,tty=,etime=,time=,comm=,args='];
const SWEEP = 'node ~/.agents/harness/machine-sweep/machine-sweep.mjs --report';

/**
 * A command's stdout and whether the reading is whole: `ok` is false when it failed to start, timed
 * out, overran its buffer or exited non-zero -- except exit 1 with nothing on stderr where `exit1`
 * allows it (lsof run with -w exits 1 when a filter matches nothing, ps -p when no pid is left; with
 * an error message the same exit 1 is a failed, maybe partial, reading).
 */
function read(cmd, args, { exit1 = false } = {}) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    const out = typeof err?.stdout === 'string' ? err.stdout : '';
    const quiet = !String(err?.stderr ?? '').trim();
    return { ok: exit1 && err?.status === 1 && !err.signal && typeof err.code !== 'string' && quiet, out };
  }
}
const run = (cmd, args) => read(cmd, args, { exit1: true }).out;

/** `lsof -F` output -> Map<pid, string[]> of each process's `n` fields. */
export function parseLsof(out) {
  const byPid = new Map();
  let pid = null;
  for (const line of String(out).split('\n')) {
    if (line.startsWith('p')) {
      pid = line.slice(1);
      if (!byPid.has(pid)) byPid.set(pid, []);
    } else if (line.startsWith('n') && pid) byPid.get(pid).push(line.slice(1));
  }
  return byPid;
}

/** Milliseconds in `[[dd-]hh:]mm:ss[.cc]` (ps's etime, and its cpu time on macOS and Linux); NaN for anything else. */
export function durationMs(text) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?$/.exec(String(text ?? '').trim());
  if (!m) return NaN;
  const [d, h, min, s] = [m[1], m[2], m[3], m[4]].map((x) => (x === undefined ? 0 : Number(x)));
  return (((d * 24 + h) * 60 + min) * 60 + s) * 1000 + (m[5] ? Math.round(Number(`0.${m[5]}`) * 1000) : 0);
}

const base = (p) => p.slice(p.lastIndexOf('/') + 1);

/**
 * The comm column and the args after it. macOS pads comm to 16 characters, cuts it there and keeps
 * spaces in its path, so the split is the first gap after which args repeats comm; else the first gap.
 */
function splitComm(rest) {
  const gap = /\s+/g;
  let m;
  while ((m = gap.exec(rest))) {
    const comm = rest.slice(0, m.index);
    const args = rest.slice(m.index + m[0].length);
    if (args.startsWith(comm)) return { comm, args };
  }
  const i = rest.search(/\s/);
  return i < 0 ? { comm: rest, args: '' } : { comm: rest.slice(0, i), args: rest.slice(i).trimStart() };
}

/** The executable's name: comm's basename, completed from argv[0] where ps cut comm (16 characters on macOS, 15 on Linux). */
function exeName(comm, args) {
  // a cut comm that args repeats runs on to the next gap there: a path may hold spaces
  const argv0 = args.startsWith(comm) ? comm + args.slice(comm.length).split(/\s/)[0] : args.split(/\s/)[0];
  if (comm.length >= 15 && argv0 && (argv0.startsWith(comm) || (base(comm) && base(argv0).startsWith(base(comm))))) return base(argv0);
  return base(comm);
}

/** `ps -axo pid=,ppid=,pgid=,uid=,tty=,etime=,time=,comm=,args=` -> rows; `elapsed` and `cpu` in ms (NaN when unread). */
export function parsePsRows(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S.*)$/.exec(line);
    if (!m) continue;
    const { comm, args } = splitComm(m[8].trimEnd());
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), uid: Number(m[4]), tty: m[5], elapsed: durationMs(m[6]), cpu: durationMs(m[7]), comm, args, name: exeName(comm, args) });
  }
  return rows;
}

const has = (map, pid) => Boolean(map?.has(pid) || map?.has(String(pid)));
const cwdOf = (cwds, pid) => {
  const v = cwds?.get(pid) ?? cwds?.get(String(pid));
  return Array.isArray(v) ? v[0] : v;
};
const inside = (p, dir) => Boolean(p && dir) && (p === dir || p.startsWith(dir + sep));

/**
 * Whether a cwd lsof printed is proven gone: stat says ENOENT or ENOTDIR for it. A printed name with a
 * backslash or a caret is no proof (lsof doubles a backslash, prints a tab as `\t` and other control
 * characters as `^X`), nor is any other stat error (a parent without search permission).
 */
export function dirGone(cwd, stat = fs.statSync) {
  if (!cwd || /[\\^]/.test(cwd)) return false;
  try {
    stat(cwd);
    return false;
  } catch (e) {
    return e?.code === 'ENOENT' || e?.code === 'ENOTDIR';
  }
}

/**
 * The rows the reaper may consider at all: own uid, parent 1, no TTY, old enough, not this hook's
 * chain, its process group's leader gone (pgid !== pid, no row with pid === pgid), and no `keep`
 * match anywhere in its subtree. A tool shell leads its own group with no TTY; its background job
 * keeps that group once the shell exits. What the owner starts (tmux, an editor, `ssh -f`, a
 * terminal's `nohup` job, a daemon) leads its own live group and is never a candidate.
 */
function orphans(rows, { uid, selfChain = new Set(), minutes = REAP_MINUTES, keep = KEEP }) {
  const live = new Set(rows.map((r) => r.pid));
  const kids = childMap(rows);
  // without its g or y flag: a stateful test would carry lastIndex from row to row and from the candidates' pass to reapable()'s
  const keepRe = keep && new RegExp(keep.source, keep.flags.replace(/[gy]/g, ''));
  const kept = (r) => subtree(r, kids).some((t) => Boolean(keepRe?.test(t.args)));
  return rows.filter((r) => r.pid > 1 && r.uid === uid && r.ppid === 1 && NO_TTY.has(r.tty) && r.elapsed >= minutes * 60_000 && !selfChain.has(r.pid) && r.pgid !== r.pid && !live.has(r.pgid) && !kept(r));
}


/** A `/proc/<pid>/cgroup` text's path: the unified hierarchy's (`0::`), else cgroup v1's systemd line; null for neither. */
export function cgroupPath(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim());
  const line = lines.find((l) => l.startsWith('0::')) ?? lines.find((l) => /^\d+:name=systemd:/.test(l));
  return line ? line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1) : null;
}

/**
 * The systemd services a `/proc/<pid>/cgroup` text puts the process in, from every line (each
 * hierarchy): per path, the path up to its deepest component ending in `.service`, other than a bare
 * user manager (`user@<uid>.service`, under which a desktop terminal's scopes live).
 * `/system.slice/worker.service/jobs` -> `/system.slice/worker.service`;
 * `…/user@1000.service/app.slice/app-term.scope` -> none.
 */
export function cgroupUnits(text) {
  const units = new Set();
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*\d+:[^:]*:(.*)$/.exec(line);
    if (!m) continue;
    const parts = m[1].trim().split('/');
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].endsWith('.service') && !/^user@\d+\.service$/.test(parts[i])) {
        units.add(parts.slice(0, i + 1).join('/'));
        break;
      }
    }
  }
  return [...units];
}

/** `launchctl list` -> the pids in its first column; null when it is not that table. */
export function parseLaunchctl(text) {
  const lines = String(text ?? '').split('\n');
  if (!/^PID\s/.test(lines[0] ?? '')) return null;
  return new Set(lines.slice(1).map((l) => Number(/^(\d+)\s/.exec(l)?.[1])).filter((n) => n > 0));
}

/**
 * The candidates their service manager runs, never reaped: on Linux one in any service (cgroupUnits())
 * that is not among the hook's own (a session hosted in a service -- a CI runner, a daemon -- leaves its
 * leftovers in that same service, and they are its own), or a cgroup that cannot be read, or any in a
 * service when the hook's own cgroup cannot be read (when in doubt, keep it); on macOS launchd's list for this user's
 * domain (the system's as root), read once. null when that list cannot be read: nothing is reaped
 * that run. Root sessions on a server run every system service as the same uid: hence this check.
 */
export function managedPids(pids, { platform = process.platform, readCgroup = (pid) => fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8'), ownCgroup = () => fs.readFileSync('/proc/self/cgroup', 'utf8'), launchctl = () => execFileSync('launchctl', ['list'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }) } = {}) {
  if (!pids.length) return new Set();
  if (platform === 'linux') {
    let own = null;
    try {
      own = new Set(cgroupUnits(ownCgroup()));
    } catch {
      // unreadable: every candidate in a service counts as managed
    }
    return new Set(pids.filter((pid) => {
      try {
        return cgroupUnits(readCgroup(pid)).some((unit) => !own || !own.has(unit));
      } catch {
        return true;
      }
    }));
  }
  if (platform === 'darwin') {
    try {
      const listed = parseLaunchctl(launchctl());
      return listed && new Set(pids.filter((pid) => listed.has(pid)));
    } catch {
      return null;
    }
  }
  return new Set();
}

/**
 * The processes to reap: orphans() (their group's leader gone) that no service manager runs
 * (`managed`, the pids managedPids() keeps; null: it could not tell, so none) and that run in the
 * checkout (`root`, null when there is none: its cwd is in it or in `worktrees`, or its argv holds
 * `root/`) or, unless `runaway` is false, are runaway shells anywhere (a shell with a `-c` word that
 * has used RUNAWAY_CPU of a core since it started). One whose subtree listens on TCP is a server left
 * running (`npm run dev &`: a package runner never listens itself, its server is a child): spared
 * outside the checkout, and in it until `listenHours` old or its directory is proven gone (`gone`,
 * dirGone(): a cwd not read, or not provable, counts as there), so a finished unit's server never
 * holds its worktree from the sweep. Such a row comes back with `why`.
 */
export function reapable(rows, { uid, root = null, worktrees = null, listeners = new Map(), cwds = new Map(), selfChain = new Set(), minutes = REAP_MINUTES, runaway = true, managed = new Set(), keep = KEEP, listenHours = LISTEN_HOURS, gone = dirGone } = {}) {
  if (!managed) return [];
  const kids = childMap(rows);
  return orphans(rows, { uid, selfChain, minutes, keep }).flatMap((r) => {
    if (managed.has(r.pid)) return [];
    const cwd = cwdOf(cwds, r.pid);
    const ours = Boolean(root) && (inside(cwd, root) || inside(cwd, worktrees) || r.args.includes(`${root}/`));
    if (subtree(r, kids).some((t) => has(listeners, t.pid))) {
      const removed = Boolean(cwd) && gone(cwd);
      return ours && (removed || r.elapsed >= listenHours * 3_600_000) ? [{ ...r, why: removed ? 'listening, its directory gone' : 'listening' }] : [];
    }
    if (ours) return [r];
    return runaway && SHELLS.has(r.name) && r.args.split(/\s+/).includes('-c') && r.cpu / r.elapsed >= RUNAWAY_CPU ? [r] : [];
  });
}

/** Each pid's direct children, from the rows. */
function childMap(rows) {
  const kids = new Map();
  for (const r of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r]);
  return kids;
}

/** `pid` and every process under it. */
function subtree(row, kids) {
  const out = [];
  const seen = new Set();
  const stack = [row];
  while (stack.length) {
    const r = stack.pop();
    if (seen.has(r.pid)) continue;
    seen.add(r.pid);
    out.push(r);
    stack.push(...(kids.get(r.pid) ?? []));
  }
  return out;
}

/**
 * The Claude process's tool shells (its direct children that are zsh, bash or sh) that are stuck:
 * STUCK_MINUTES old, their subtree under STUCK_CPU of a core, and no listener in it.
 */
export function stuckShells(rows, { claudePid, listeners = new Map(), selfChain = new Set(), minutes = STUCK_MINUTES } = {}) {
  const kids = childMap(rows);
  return rows.filter((r) => {
    if (r.ppid !== claudePid || !TOOL_SHELLS.has(r.name) || selfChain.has(r.pid) || !(r.elapsed >= minutes * 60_000)) return false;
    const tree = subtree(r, kids);
    if (tree.some((t) => has(listeners, t.pid))) return false;
    return tree.reduce((sum, t) => sum + t.cpu, 0) / r.elapsed < STUCK_CPU;
  });
}

/** An age as the lines print it: 12m, 9h, 3d. */
export function age(ms) {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** `reaped <n>: <name> (pid <p>, <age>[, <why>])[, …] — <how to keep one>`, five named at most; null when nothing was reaped. */
export function formatReaped(list) {
  if (!list.length) return null;
  const named = list.slice(0, 5).map((r) => `${r.name} (pid ${r.pid}, ${age(r.elapsed)}${r.why ? `, ${r.why}` : ''})`);
  if (list.length > 5) named.push(`+${list.length - 5} more`);
  return `reaped ${list.length}: ${named.join(', ')} — each outlived the shell that started it (one that listens is kept ${LISTEN_HOURS} h, while its directory exists); start what must keep running with the host's own background option (Claude Code: the Bash tool's run_in_background), not a shell \`&\`.`;
}

/** The Stop block's reason for stuck shells (their command lines go to the model only). */
export function formatStuck(list) {
  const clip = (s) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);
  const items = list.map((r) => `${clip(r.args.replace(/\s+/g, ' '))} (pid ${r.pid}, ${age(r.elapsed)}, no CPU)`);
  return `STUCK ${list.length}: ${items.join('; ')} — stop each with TaskStop (or kill its process group) unless it is still needed, then finish.`;
}

/** The listeners and machine-wide processes to name, for the checkout at `root`; `seen` holds what the caller already read. */
export function leftovers(root, seen = {}) {
  let main;
  try {
    main = fs.statSync(join(root, '.git')).isDirectory();
  } catch {
    return [];
  }
  const rows = seen.rows ?? parsePsRows(run('ps', PS_ARGS));
  const listeners = seen.listeners ?? parseLsof(run('lsof', ['-w', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']));
  const missing = [...listeners.keys()].filter((pid) => !has(seen.cwds, pid));
  const cwds = new Map(seen.cwds ?? []);
  if (missing.length) for (const [pid, names] of parseLsof(run('lsof', ['-w', '-a', '-p', missing.join(','), '-d', 'cwd', '-Fpn']))) cwds.set(pid, names);
  const worktrees = join(root, WORKTREES) + sep;
  const byPid = new Map(rows.map((r) => [String(r.pid), r]));
  const found = [];
  for (const [pid, names] of listeners) {
    const cwd = cwdOf(cwds, pid);
    if (!cwd || (cwd !== root && !cwd.startsWith(root + sep))) continue;
    if (main && cwd.startsWith(worktrees)) continue;
    const ports = [...new Set(names.map((n) => n.slice(n.lastIndexOf(':') + 1)))].join(',');
    // the executable only: a command line can carry a secret
    found.push(`:${ports} ${byPid.get(String(pid))?.name ?? '?'} (pid ${pid})`);
  }
  // by the executable's name alone: a shell whose command text mentions one is not one
  for (const r of rows) if (MACHINE_WIDE.test(r.name)) found.push(`${r.name} (pid ${r.pid}, machine-wide)`);
  return found;
}

/** This process and its ancestors, as far as the rows reach. */
function chainOf(rows, pid) {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const chain = [pid];
  for (let r = byPid.get(pid); r && r.ppid > 1 && chain.length < 64; r = byPid.get(r.ppid)) chain.push(r.ppid);
  return chain;
}

/**
 * The rows of `list` that a fresh reading (`again`) still shows as the same orphan: parent 1, the same
 * group and TTY, and at least as old as first read (a reused pid is seconds old). A pid missing from
 * `again` is gone.
 */
export function stillOrphans(list, again) {
  const now = new Map(again.map((r) => [r.pid, r]));
  return list.filter((r) => {
    const a = now.get(r.pid);
    return Boolean(a) && a.ppid === 1 && a.pgid === r.pgid && a.tty === r.tty && a.elapsed >= r.elapsed;
  });
}

/**
 * A fresh `ps` reading of `pids` (pid, ppid, pgid, tty, etime); empty when the reading failed or may be
 * partial, so no signal goes out. LEFTOVER_PS_RECHECK, else LEFTOVER_PS, replaces it.
 */
function recheck(pids) {
  const fixture = process.env.LEFTOVER_PS_RECHECK || process.env.LEFTOVER_PS;
  if (fixture) return parsePsRows(fs.readFileSync(fixture, 'utf8'));
  const ps = read('ps', ['-o', 'pid=,ppid=,pgid=,tty=,etime=', '-p', pids.join(',')], { exit1: true });
  if (!ps.ok) return [];
  const rows = [];
  for (const line of ps.out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), tty: m[4], elapsed: durationMs(m[5]) });
  }
  return rows;
}

/**
 * SIGTERM to each (its group when it leads one), then SIGKILL 1000 ms later to whatever still runs;
 * right before each, a fresh reading spares any pid that is no longer the orphan it was. Returns the
 * ones that got SIGTERM.
 */
async function kill(list) {
  const target = (r) => (r.pgid === r.pid ? -r.pid : r.pid);
  const send = (rows, signal) => {
    for (const r of rows) {
      try {
        process.kill(target(r), signal);
      } catch {
        // already gone
      }
    }
  };
  const termed = stillOrphans(list, recheck(list.map((r) => r.pid)));
  if (!termed.length) return termed;
  send(termed, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  send(stillOrphans(termed, recheck(termed.map((r) => r.pid))), 'SIGKILL');
  return termed;
}

/** A session state file's content as { reported: pid[], listed: ms, pending: reaped line[] }; any other shape starts fresh. */
export function parseState(text) {
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    // torn or missing: fresh
  }
  const plain = j !== null && typeof j === 'object' && !Array.isArray(j);
  const reported = plain && Array.isArray(j.reported) ? j.reported.filter((p) => Number.isInteger(p) && p > 0) : [];
  const listed = plain && Number.isFinite(j.listed) ? j.listed : 0;
  const pending = plain && Array.isArray(j.pending) ? j.pending.filter((l) => typeof l === 'string' && l.startsWith('reaped ')).slice(-PENDING_MAX) : [];
  return { reported, listed, pending };
}

/** Under DISK_NOTICE_GB free on `root`'s file system: one desktop notification a day, machine-wide. Never model text. */
function diskNotice(root) {
  let free = Number(process.env.LEFTOVER_FREE_GB);
  if (!process.env.LEFTOVER_FREE_GB || !Number.isFinite(free)) {
    if (typeof fs.statfsSync !== 'function') return;
    const s = fs.statfsSync(root);
    free = (Number(s.bavail) * Number(s.bsize)) / 1e9;
  }
  if (!(free < DISK_NOTICE_GB)) return;
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dir = join(process.env.LEFTOVER_HOME || homedir(), '.agents', 'harness');
  const lock = `disk-notice-${date}.lock`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    // the exclusive create claims the day: of two sessions at once, only its creator notifies
    fs.writeFileSync(join(dir, lock), `${process.pid}\n`, { flag: 'wx' });
  } catch {
    return; // claimed already, or unwritable (which would repeat the notification every turn)
  }
  try {
    for (const name of fs.readdirSync(dir)) if (/^disk-notice-\d{4}-\d{2}-\d{2}\.lock$/.test(name) && name !== lock) fs.rmSync(join(dir, name), { force: true });
  } catch {
    // an older lock left behind is only clutter
  }
  if (process.env.LEFTOVER_NOTIFY === '0') return;
  const text = `${free.toFixed(1)} GB free on this disk. Free space: ${SWEEP}`;
  const cmd = process.platform === 'darwin'
    ? ['osascript', ['-e', `display notification "${text.replace(/["\\]/g, '\\$&')}" with title "Harness"`]]
    : process.platform === 'linux' ? ['notify-send', ['Harness', text]] : null;
  if (!cmd) return;
  const child = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/** The session's state file (stuck pids reported, when the listing last went out, reaped lines kept for the next prompt). */
function sessionState(input) {
  const file = join(tmpdir(), `harness-stuck-${String(input.session_id ?? 'x').replace(/[^\w-]/g, '')}.json`);
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    // none yet
  }
  const state = parseState(text);
  // whether it wrote: a report goes out only once it is recorded, else it would repeat every turn
  const save = () => {
    try {
      fs.writeFileSync(file, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  };
  return { state, save };
}

/** Stop: block once on the tool shells newly stuck, the reaped line after them; else keep the reaped line for the next prompt. */
function onStop(input, { rows, listeners, selfChain, reaped }) {
  const { state, save } = sessionState(input);
  const keepForPrompt = () => {
    if (!reaped) return;
    state.pending = [...state.pending, reaped].slice(-PENDING_MAX);
    save();
  };
  if (input.stop_hook_active === true) return keepForPrompt();
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const claudePid = chainOf(rows, process.ppid).find((pid) => byPid.get(pid)?.name === 'claude') ?? process.ppid;
  const reported = new Set(state.reported);
  const stuck = stuckShells(rows, { claudePid, listeners, selfChain }).filter((r) => !reported.has(r.pid));
  if (!stuck.length) return keepForPrompt();
  state.reported = [...reported, ...stuck.map((r) => r.pid)];
  if (!save()) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: formatStuck(stuck) + (reaped ? `\n${reaped}` : '') }));
}

/** UserPromptSubmit: the leftover listing at most once per LIST_MINUTES, the reaped lines a Stop kept, and this run's. */
function onPrompt(input, root, { rows, listeners, cwds, reaped }) {
  const parts = [];
  const found = leftovers(root, { rows, listeners, cwds });
  const { state, save } = sessionState(input);
  const now = Date.now();
  const listing = found.length > 0 && !(now - state.listed < LIST_MINUTES * 60_000);
  const kept = state.pending;
  if (listing) state.listed = now;
  state.pending = [];
  // each goes out only once its state is recorded, else it would repeat every turn
  if ((listing || kept.length) && save()) {
    if (listing) parts.push(`[leftover-processes] Still running from this checkout: ${found.join('; ')}. Stop the ones you started unless the task still needs them: by recorded PID, never pkill (the runner's teardown).`);
    parts.push(...kept);
  }
  if (reaped) parts.push(reaped);
  if (parts.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: parts.join('\n') } }));
}

/** Read ps and lsof once, reap what reapable() names (unless LEFTOVER_KILL=0), and return the readings with the reaped line. */
async function reapAndRead(event, root) {
  let mainCheckout = false;
  try {
    mainCheckout = fs.statSync(join(root, '.git')).isDirectory();
  } catch {
    // a linked worktree's .git is a file; no .git at all: nothing is reaped as in the checkout
  }
  const checkout = root !== '/' && fs.existsSync(join(root, '.git'));
  // a failed or partial reading of either reaps nothing: a live leader or a listener could be missing
  const ps = process.env.LEFTOVER_PS ? { ok: true, out: fs.readFileSync(process.env.LEFTOVER_PS, 'utf8') } : read('ps', PS_ARGS);
  const lsof = read('lsof', ['-w', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], { exit1: true });
  const whole = ps.ok && lsof.ok;
  const rows = parsePsRows(ps.out);
  const listeners = parseLsof(lsof.out);
  const selfChain = new Set([...chainOf(rows, process.pid), process.ppid]);
  const uid = process.getuid?.() ?? -1;
  const minutes = process.env.LEFTOVER_REAP_MINUTES && Number(process.env.LEFTOVER_REAP_MINUTES) >= 0 ? Number(process.env.LEFTOVER_REAP_MINUTES) : REAP_MINUTES;

  // one cwd reading: the reaper's candidates, and the listeners when they are listed
  const candidates = whole ? orphans(rows, { uid, selfChain, minutes }).map((r) => r.pid) : [];
  const pids = new Set(candidates.map(String));
  if (event === 'UserPromptSubmit') for (const pid of listeners.keys()) pids.add(pid);
  const cwds = pids.size ? parseLsof(run('lsof', ['-w', '-a', '-d', 'cwd', '-Fpn', '-p', [...pids].join(',')])) : new Map();

  const worktrees = mainCheckout ? resolve(root, WORKTREES) : null;
  const managed = process.env.LEFTOVER_MANAGED
    ? new Set(fs.readFileSync(process.env.LEFTOVER_MANAGED, 'utf8').split('\n').map(Number).filter((n) => n > 0))
    : managedPids(candidates);
  const chosen = whole ? reapable(rows, { uid, root: checkout ? root : null, worktrees, listeners, cwds, selfChain, minutes, runaway: process.env.LEFTOVER_RUNAWAY !== '0', managed }) : [];
  const reap = chosen.length && process.env.LEFTOVER_KILL !== '0' ? await kill(chosen) : chosen;
  return { rows, listeners, cwds, selfChain, reaped: formatReaped(reap) };
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw || '{}');
  const event = input.hook_event_name;
  if (!['SessionStart', 'Stop', 'UserPromptSubmit'].includes(event)) return;
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  if (!dir) return;
  const root = fs.realpathSync(dir);
  const { rows, listeners, cwds, selfChain, reaped } = await reapAndRead(event, root);

  if (event !== 'UserPromptSubmit') {
    try {
      diskNotice(root);
    } catch {
      // a failed reading must not hide the rest
    }
  }
  if (event === 'SessionStart') {
    if (reaped) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: reaped } }));
  } else if (event === 'Stop') onStop(input, { rows, listeners, selfChain, reaped });
  else onPrompt(input, root, { rows, listeners, cwds, reaped });
}

// import.meta.url is a realpath, so compare against the realpath of argv[1] (a symlinked hooks
// directory would otherwise never run main).
function isMain() {
  const arg = process.argv[1] ?? '';
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(arg)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    await main();
  } catch {
    // a hook never breaks the turn
  }
  process.exit(0);
}
