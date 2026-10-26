#!/usr/bin/env node
// harness-bootstrap leftover-processes hook (generated YYYY-MM-DD). Claude Code, Stop + UserPromptSubmit.
// [M] mechanism (ships as-is): everything except the lines marked [B]. [B] binding: WORKTREES,
// MACHINE_WIDE and NOTICE_MINUTES below, re-derived per project.
// MCP servers and dev servers left running held 11.25 GB of one project's 12 GB of swap
// (2026-10-17); its version of this hook then fired in 39 sessions. This names every TCP
// listener whose working directory is inside THIS session's checkout (a main checkout leaves out
// its worktrees: they belong to other sessions), every executable MACHINE_WIDE names,
// and -- when memory is tight -- says so. It never stops anything:
//   Stop             -> systemMessage to the owner
//   UserPromptSubmit -> additionalContext to the model
// Silent when nothing runs; never blocks, never fails the turn. LEFTOVER_PRESSURE overrides the
// memory reading (0, 2 or 4), for tests.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKTREES = '.worktrees'; // [B] where this project's worktrees live, relative to the main checkout
const MACHINE_WIDE = /^(qemu-system|emulator64-)/; // [B] executables named whoever started them (an Android emulator is ~2 GB)
const NOTICE_MINUTES = 30; // [B] a tight-memory notice repeats this often at most, sooner when it gets worse

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    // lsof exits 1 when a filter matches nothing, but still prints what it found
    return typeof err?.stdout === 'string' ? err.stdout : '';
  }
};

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

/** The listeners and machine-wide processes to name, for the checkout at `root`. */
export function leftovers(root) {
  let main = false;
  try {
    main = statSync(join(root, '.git')).isDirectory();
  } catch {
    return [];
  }
  const worktrees = join(root, WORKTREES) + sep;
  const found = [];
  const listeners = parseLsof(run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']));
  if (listeners.size) {
    const cwds = parseLsof(run('lsof', ['-a', '-p', [...listeners.keys()].join(','), '-d', 'cwd', '-Fpn']));
    for (const [pid, names] of listeners) {
      const cwd = cwds.get(pid)?.[0];
      if (!cwd || (cwd !== root && !cwd.startsWith(root + sep))) continue;
      if (main && cwd.startsWith(worktrees)) continue;
      const ports = [...new Set(names.map((n) => n.slice(n.lastIndexOf(':') + 1)))].join(',');
      found.push(`:${ports} ${run('ps', ['-o', 'command=', '-p', pid]).trim().slice(0, 60)} (pid ${pid})`);
    }
  }
  // by the executable's name alone: a shell whose command text mentions one is not one
  for (const line of run('ps', ['-axo', 'pid=,command=']).split('\n')) {
    const [pid, exe = ''] = line.trim().split(/\s+/);
    const name = exe.slice(exe.lastIndexOf('/') + 1);
    if (MACHINE_WIDE.test(name)) found.push(`${name} (pid ${pid}, machine-wide)`);
  }
  return found;
}

/** How tight memory is: 0 fine, 2 warn, 4 critical (macOS's pressure level; elsewhere from MemAvailable). */
export function pressure() {
  if (process.platform === 'darwin') {
    const level = Number(run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']).trim());
    return level > 1 ? level : 0;
  }
  try {
    const info = readFileSync('/proc/meminfo', 'utf8');
    const kb = (key) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(info)?.[1]);
    const share = kb('MemAvailable') / kb('MemTotal');
    return share < 0.05 ? 4 : share < 0.1 ? 2 : 0;
  } catch {
    return 0;
  }
}

/** A tight-memory notice once per NOTICE_MINUTES per session and event, sooner when it got worse. */
function notice(input, level, now = Date.now()) {
  if (level < 2) return null;
  const file = join(tmpdir(), `harness-leftover-notice-${String(input.session_id ?? 'x').replace(/[^\w-]/g, '')}.json`);
  let state = {};
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // the first notice in this session
  }
  const last = state[input.hook_event_name] ?? { at: 0, level: 0 };
  if (now - last.at < NOTICE_MINUTES * 60_000 && level <= last.level) return null;
  state[input.hook_event_name] = { at: now, level };
  try {
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // an unwritable tmp only means the notice repeats
  }
  return `memory pressure ${level === 4 ? 'critical' : 'warn'}`;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw || '{}');
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  if (!dir) return;
  const found = leftovers(realpathSync(dir));
  let tight = null;
  try {
    tight = notice(input, Number(process.env.LEFTOVER_PRESSURE ?? pressure()));
  } catch {
    // a failed reading must not hide the list
  }
  if (!found.length && !tight) return;
  const list = found.join('; ');
  // the installed copy exists only once the owner approved a category (machine.md)
  const sweep = existsSync(join(homedir(), '.agents', 'harness', 'machine-sweep', 'machine-sweep.mjs'))
    ? 'node ~/.agents/harness/machine-sweep/machine-sweep.mjs --report lists the rest'
    : "the harness-bootstrap skill's scripts/machine-sweep.mjs --report lists the rest (machine.md)";
  if (input.hook_event_name === 'Stop') {
    const parts = [];
    if (found.length) parts.push(`Still running from this checkout: ${list}`);
    if (tight) parts.push(`The machine is tight (${tight}). ${sweep}.`);
    process.stdout.write(JSON.stringify({ systemMessage: parts.join('\n') }));
  } else if (input.hook_event_name === 'UserPromptSubmit') {
    const parts = [];
    if (found.length) parts.push(`[leftover-processes] Still running from this checkout: ${list}. Stop the ones you started unless the task still needs them: by recorded PID, never pkill (the runner's teardown).`);
    if (tight) parts.push(`[resources] The machine is tight (${tight}). Before starting tests, a dev server, an emulator or a full verify, tell the owner what to free (${sweep}), and never stop another session's process.`);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: parts.join('\n') } }));
  }
}

// import.meta.url is a realpath, so compare against the realpath of argv[1] (a symlinked hooks
// directory would otherwise never run main).
function isMain() {
  const arg = process.argv[1] ?? '';
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
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
