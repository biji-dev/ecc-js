#!/usr/bin/env node
// harness-bootstrap harness-due (generated YYYY-MM-DD). What the harness owes before the next unit.
// [M] mechanism (ships as-is): everything. The [B] bindings (the mainline, the paths, the registry, the
// phase in a row id, the cadences, the limits, the commands) live at the top of scripts/lib/harness-due-core.mjs.
/**
 * The runner runs it at step 0, before the claim, and at step 9, after the merge (harness-bootstrap's
 * reference/runner.md › Due-checks):
 *
 *   node scripts/harness-due.mjs [--claim <row id>] [--json] [--now <ISO>] [--home <dir>]
 *   node scripts/harness-due.mjs --digest-read [--now <ISO>] [--home <dir>]
 *   node scripts/harness-due.mjs --seen <YYYY-Www> [--home <dir>]
 *
 * options:
 *   --claim <id>   also check the row about to be claimed: the preflight of the phase it opens, and
 *                  the valve (a HOLD line stops the claim)
 *   --json         { due: [{ kind, subject, why, command, blocking }], blocking, held, inbox: [{ unit, gate,
 *                  parked, branch, worktree, cards, command }], owed: [{ id, since, what }], split: [{ unit,
 *                  branch, lines, cap }], ask: { ask, demoted, promoted, ignored }, digest: { unread, lines,
 *                  holdCount }, hold: { count, why, command, blocking } | null } instead of lines
 *   --now <ISO>    the time to check against (default now)
 *   --home <dir>   the directory holding .agents/harness (default the home directory): the machine
 *                  sweep's approvals and log, the weekly job's registry, seen.json and digest-read.json
 *   --digest-read  record that the owner read this project's digest now, in
 *                  <home>/.agents/harness/digest-read.json; it checks nothing else
 *   --seen <week>  record that this project read its proposals of that week, in
 *                  <home>/.agents/harness/retro/seen.json; it checks nothing else (the proposals print
 *                  in the weekly report only)
 *
 * The lines, in this order: `OWED <row> since <date> — <what>` for each open follow-up waiting on the
 * owner past OWED_DAYS; the owner's inbox, one `INBOX <unit> <gate> since <parked> · <cards>` line for
 * each row of the parked table of the commit guard's registry (REGISTRY, in the main checkout); `HOLD
 * claims — …` when the owner has left the digest unread (the valve); `SPLIT <unit> — …` for each held
 * row whose local branch is past SPLIT_LINES production lines against MAIN; `DUE preflight <phase> — …`;
 * `REPORT <kind> — <why> — <what to run>` for a sweep, retro or hygiene report due, written in the
 * background, never a unit; `harness-due: nothing due` when there is no HOLD, SPLIT, DUE or REPORT
 * line; while the manifest (MANIFEST) says `"stage": "foundation"`, one `HELD <kinds> — …` line; the
 * `ASK <kinds> — <why>` line, from every STATE_DIR/*.state.md at MAIN; and the digest block, `DIGEST
 * <n> unread since <last read>`, the unread grant and default decisions and merged log rows, and the
 * disk and worktrees checks. An inbox line never changes the exit code, and a registry that is missing
 * or unreadable prints none; a missing or unreadable manifest holds nothing. A worktree a registry row
 * names, held or parked, is never listed. It reads files and git (`log`, `blame`, `worktree list`,
 * `merge-base`, `rev-list`, `reflog`, `status`, `ls-tree`, `cat-file`, `rev-parse`, `diff`) and writes
 * nothing but --seen's and --digest-read's files: it starts no sweep itself, the runner does what each
 * line says.
 *
 * exit: 0 nothing blocks | 1 the claimed row opens a phase with no preflight report, or --claim and the
 * valve holds | 2 usage.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FOLLOW_UPS,
  LOG,
  MAIN,
  REGISTRY,
  REPORTS,
  STATE_DIR,
  dueParts,
  formatDue,
  heldBranches,
  inboxLines,
  lastReadOf,
  markDigestRead,
  markSeen,
  matchReports,
  parkedUnits,
  parseArgs,
  parseWorktrees,
  projectName,
  reportShape,
} from './lib/harness-due-core.mjs';
import { decisionRows } from './lib/retro-core.mjs';
import { blameDates, lastCommitTimes, readFollowUps, repoTop } from './lib/retro-gather.mjs';
import { gitRead } from './lib/run-sources.mjs';

// The install manifest, relative to the checkout: its `stage` holds the cadences until the flip.
const MANIFEST = '.agents/harness-manifest.json';

const USAGE =
  'usage: node scripts/harness-due.mjs [--claim <row id>] [--json] [--now <ISO>] [--home <dir>] | --digest-read [--now <ISO>] [--home <dir>] | --seen <YYYY-Www> [--home <dir>]';

function usage(msg) {
  process.stderr.write(`harness-due: ${msg}\n${USAGE}\n`);
  process.exitCode = 2;
}

const git = (args, cwd) => {
  try {
    return gitRead(args, cwd);
  } catch {
    return null;
  }
};
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
// The registry's text in the main checkout, or null: a missing or unreadable one is no inbox, never a failure.
const readRegistry = (root) => {
  try {
    return fs.readFileSync(path.join(root, REGISTRY), 'utf8');
  } catch {
    return null;
  }
};
// A path through its links, as the guard's cd and pwd -P read it (the native call also gives a
// case-insensitive disk's own spelling); a path that does not exist is itself.
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
};
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** A tracked file as { text, dates } (line -> commit ms), or null when it does not exist. */
function withDates(top, rel) {
  const file = path.join(top, rel);
  if (!fs.existsSync(file)) return null;
  return { text: fs.readFileSync(file, 'utf8'), dates: blameDates(top, rel) };
}

/**
 * Each bound kind's reports as [{ rel, time, pending? }]: the last commit that touched it. A cadence
 * report (sweep, retro, hygiene) is written in the background and rides in the NEXT unit's land commit,
 * so until then no commit holds it, or holds only an earlier version of it: its file under the repository
 * top counts, with its file time as `time` (the later of that and its commit time when a commit holds it,
 * as the uncommitted change, staged or not, is the newer report) and `pending: true`, or REPORT would
 * print again and the runner would start the same report twice. A preflight report stays committed-only:
 * it opens a claim, so a unit stays due until the report is committed.
 */
function readReports(top) {
  const out = {};
  for (const [kind, template] of Object.entries(REPORTS)) {
    if (template === null) continue;
    const { dir } = reportShape(template);
    let names;
    try {
      names = fs.readdirSync(path.join(top, dir));
    } catch {
      names = [];
    }
    const found = matchReports(template, names);
    const times = found.length ? lastCommitTimes(top, [dir]) : new Map();
    const changed = found.length && kind !== 'preflight' ? changedFiles(top, dir) : new Set();
    out[kind] = found.flatMap((r) => {
      if (times.has(r.rel)) {
        const file = changed.has(r.rel) && isFile(path.join(top, r.rel)) ? mtime(path.join(top, r.rel)) : null;
        return [file === null ? { rel: r.rel, time: times.get(r.rel) } : { rel: r.rel, time: Math.max(times.get(r.rel), file), pending: true }];
      }
      const time = kind === 'preflight' || !isFile(path.join(top, r.rel)) ? null : mtime(path.join(top, r.rel));
      return time === null ? [] : [{ rel: r.rel, time, pending: true }];
    });
  }
  return out;
}

/** The paths under `dir` with an uncommitted change, staged or not, by one `git status --porcelain -z`: a Set of paths from the top. */
function changedFiles(top, dir) {
  const tokens = (git(['status', '--porcelain', '-z', '--', dir], top) ?? '').split('\0');
  const out = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].length < 4) continue;
    out.add(tokens[i].slice(3));
    if (/[RC]/.test(tokens[i].slice(0, 2))) i += 1; // a rename or copy carries its source as the next token
  }
  return out;
}

/** The main checkout of the repository `top` is in (a linked worktree's is its common directory's parent). */
function mainCheckout(top) {
  const common = git(['rev-parse', '--git-common-dir'], top)?.trim();
  if (!common) return top;
  const dir = path.resolve(top, common);
  return path.basename(dir) === '.git' ? path.dirname(dir) : top;
}

/**
 * The mainline's merges, newest first, as [{ t, subject }]: the landings, and the phases they name.
 * First-parent only: a landed branch that merged the mainline into itself is one landing, not two.
 */
function readMerges(top) {
  return (git(['log', '--merges', '--first-parent', '--format=%ct%x09%s', MAIN], top) ?? '').split('\n').flatMap((line) => {
    const tab = line.indexOf('\t');
    return tab === -1 ? [] : [{ t: Number(line.slice(0, tab)) * 1000, subject: line.slice(tab + 1) }];
  });
}

/**
 * The linked worktrees, each measured: merged into MAIN, with commits of its own (its HEAD off
 * the mainline's first-parent line, or a branch reflog that moved after its creation), its changes
 * and ignored paths, and its last activity.
 */
function readWorktrees(top) {
  const list = parseWorktrees(git(['worktree', 'list', '--porcelain'], top) ?? '');
  let mainline = null;
  return list.map((w, i) => {
    if (i === 0 || w.bare || w.locked || w.prunable || !w.head) return w;
    const merged = git(['merge-base', '--is-ancestor', w.head, MAIN], top) !== null;
    mainline ??= new Set((git(['rev-list', '--first-parent', MAIN], top) ?? '').split('\n').filter(Boolean));
    const moved = w.branch ? (git(['reflog', 'show', '-n', '2', '--format=%H', `refs/heads/${w.branch}`, '--'], top) ?? '').trim().split('\n').filter(Boolean).length > 1 : false;
    const own = merged && (!mainline.has(w.head) || moved);
    const commit = Number(git(['log', '-1', '--format=%ct', w.head], top)?.trim()) * 1000;
    // the worktree's own reflog moves at every commit, checkout and reset in it; its .git file at creation
    const gitdir = /^gitdir:\s*(.+)$/m.exec(fs.existsSync(path.join(w.path, '.git')) ? fs.readFileSync(path.join(w.path, '.git'), 'utf8') : '')?.[1];
    const times = [commit, mtime(path.join(w.path, '.git')), gitdir ? mtime(path.join(path.resolve(w.path, gitdir), 'logs', 'HEAD')) : null];
    const active = Math.max(...times.filter(Number.isFinite));
    const status = own ? git(['status', '--porcelain', '--ignored'], w.path) : null;
    const lines = status === null ? [] : status.split('\n').filter(Boolean);
    const clean = status !== null && lines.every((l) => l.startsWith('!! '));
    // a link is left out: removing it never touches what it points to
    const ignored = lines.filter((l) => l.startsWith('!! ')).map((l) => l.slice(3)).filter((p) => !isLink(path.join(w.path, p.replace(/\/$/, ''))));
    return { ...w, merged, own, clean, ignored, active };
  });
}

/** The machine sweep's approvals and its last run, from <home>/.agents/harness. */
function readDisk(top, harness) {
  let free;
  try {
    const s = fs.statfsSync(top);
    free = s.bavail * s.bsize;
  } catch {
    return null;
  }
  const approvals = readJson(path.join(harness, 'sweep.json'));
  const approved = Array.isArray(approvals?.approved) ? approvals.approved.filter((c) => typeof c === 'string') : [];
  let last = null;
  try {
    const lines = fs.readFileSync(path.join(harness, 'sweep-log.jsonl'), 'utf8').trim().split('\n');
    for (const line of lines.reverse()) {
      try {
        const e = JSON.parse(line);
        if (e && typeof e.t === 'string' && Number.isFinite(e.freed)) {
          last = e;
          break;
        }
      } catch {
        // a torn line
      }
    }
  } catch {
    last = null;
  }
  return { free, approved, last };
}

/**
 * Every `*.state.md` directly in STATE_DIR as MAIN holds it, as [{ rel, text }]: what has landed, so
 * a unit's state file on its own branch counts once it merges. None when MAIN or the directory is missing.
 */
function readStates(top) {
  const out = [];
  for (const entry of (git(['ls-tree', '-z', MAIN, '--', `${STATE_DIR}/`], top) ?? '').split('\0')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry);
    if (!m || !m[2].endsWith('.state.md')) continue;
    const text = git(['cat-file', 'blob', m[1]], top);
    if (text !== null) out.push({ rel: m[2], text });
  }
  return out;
}

/**
 * line number -> commit ms for the `lines` of `rel` at MAIN, by blame (as retro-gather's blameDates
 * dates the follow-ups: `-w`, the repository's own `.git-blame-ignore-revs`), one `-L` per line so a
 * long state file costs only its decision rows.
 */
function blameLines(top, rel, lines) {
  const base = ['blame', '-w', '--line-porcelain', '--no-ignore-revs-file', ...lines.flatMap((n) => ['-L', `${n},${n}`])];
  const listed = fs.existsSync(path.join(top, '.git-blame-ignore-revs'));
  const out = (listed ? git([...base, '--ignore-revs-file', '.git-blame-ignore-revs', MAIN, '--', rel], top) : null) ?? git([...base, MAIN, '--', rel], top) ?? '';
  const dates = new Map();
  let final = null;
  for (const line of out.split('\n')) {
    const head = /^[0-9a-f]{40,64} \d+ (\d+)/.exec(line);
    if (head) final = Number(head[1]);
    else if (line.startsWith('committer-time ') && final !== null) dates.set(final, Number(line.slice('committer-time '.length)) * 1000);
  }
  return dates;
}

/**
 * The state files' decision rows (retro-core's decisionRows, the unit from the file's header, else its
 * name), and `<unit>/<id>` -> the commit time of the row's line for each row the digest lists (By:
 * grant or default): only those lines are blamed.
 */
function readDecisions(top) {
  const decisions = [];
  const rowTimes = new Map();
  for (const { rel, text } of readStates(top)) {
    const rows = decisionRows(text, path.posix.basename(rel).replace(/\.state\.md$/, ''));
    decisions.push(...rows);
    const lines = text.split(/\r?\n/);
    const wanted = [];
    let from = 0;
    for (const r of rows) {
      const at = lines.indexOf(r.line, from);
      if (at === -1) continue;
      from = at + 1;
      if (r.by === 'grant' || r.by === 'default') wanted.push({ key: `${r.unit}/${r.id}`, n: at + 1 });
    }
    if (!wanted.length) continue;
    const dates = blameLines(top, rel, wanted.map((w) => w.n));
    for (const { key, n } of wanted) {
      const t = dates.get(n);
      if (Number.isFinite(t)) rowTimes.set(key, t);
    }
  }
  return { decisions, rowTimes };
}

/** Each held registry row's local branch with its `git diff --numstat` against MAIN, as [{ unit, branch, numstat }]. */
function readSplits(top, registryText) {
  return heldBranches(registryText).flatMap(({ unit, branch }) => {
    if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], top) === null) return [];
    const numstat = git(['diff', '--numstat', '--no-renames', `${MAIN}...refs/heads/${branch}`, '--'], top);
    return numstat === null ? [] : [{ unit, branch, numstat }];
  });
}

/** --seen's and --digest-read's one write: `data` as JSON at `file` (its directory made), then `said`. */
function record(file, data, said) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  } catch (e) {
    return usage(`cannot write ${file}: ${e.code ?? e.message}`);
  }
  process.stdout.write(`harness-due: ${said}\n`);
}

function main() {
  if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  let args;
  let top;
  try {
    args = parseArgs(process.argv.slice(2));
    top = repoTop(process.cwd());
  } catch (e) {
    return usage(e.message);
  }
  const harness = path.join(path.resolve(args.home ?? os.homedir()), '.agents', 'harness');
  const registry = readJson(path.join(harness, 'repos.json'));
  const repos = Array.isArray(registry?.repos) ? registry.repos.map((r) => ({ ...r, path: real(String(r?.path ?? '')) })) : [];
  const mainTop = real(mainCheckout(top));
  const project = projectName({ repos }, mainTop);
  const seenFile = path.join(harness, 'retro', 'seen.json');
  if (args.seen !== null) {
    return record(seenFile, markSeen(readJson(seenFile), project, args.seen), `${project} has read the proposals of ${args.seen}`);
  }
  const now = args.now === null ? Date.now() : Date.parse(args.now);
  const readFile = path.join(harness, 'digest-read.json');
  if (args.digestRead) {
    const at = new Date(now).toISOString();
    return record(readFile, markDigestRead(readJson(readFile), project, at), `${project} has read the digest at ${at}`);
  }
  let parts;
  const registryText = readRegistry(mainTop);
  try {
    const facts = {
      now,
      claim: args.claim,
      top,
      log: withDates(top, LOG),
      followUps: readFollowUps(top, FOLLOW_UPS),
      reports: readReports(top),
      merges: readMerges(top),
      disk: readDisk(top, harness),
      worktrees: readWorktrees(top),
      registry: registryText === null ? null : { text: registryText, root: mainTop, real },
      stage: readJson(path.join(top, MANIFEST))?.stage ?? null,
      ...readDecisions(top),
      lastRead: lastReadOf(readJson(readFile), project),
      splits: readSplits(top, registryText),
    };
    parts = dueParts(facts);
  } catch (e) {
    return usage(e.message);
  }
  const { items, owed, split, ask, digest, hold, held } = parts;
  const blocking = items.filter((i) => i.blocking).length + (hold?.blocking ? 1 : 0);
  process.stdout.write(
    args.json
      ? `${JSON.stringify({ due: items, blocking, held, inbox: parkedUnits(registryText), owed, split, ask, digest, hold }, null, 2)}\n`
      : formatDue({ ...parts, inbox: inboxLines(registryText) }),
  );
  if (blocking) process.exitCode = 1;
}

main();
