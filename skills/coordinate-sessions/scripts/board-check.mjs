#!/usr/bin/env node
// coordinate-sessions board check. Read-only, no dependencies, Node 18+.
//
//   node board-check.mjs --plan <board.md>
//     Before any worker starts: expands each unit's write-set globs against `git ls-files` (a glob
//     with no wildcard also counts as itself, so a file a unit will create is checked too) and
//     refuses a file that two units of one wave would write, or a hub file inside a write set.
//     Exit 0: the sets are disjoint. Exit 1: CONFLICT / HUB lines, then PLAN REFUSED.
//
//   node board-check.mjs <board.md> [--quiet-min <n>] [--now <ISO time>]
//     At each event (a message, an idle notice, after a compaction): for every active worker, in its
//     worktree, the files its branch changed since it left the mainline, uncommitted and untracked
//     included. Prints, one per line:
//       FENCE <worker> <path>             a write outside the worker's write set (a hub file too)
//       OVERLAP <worker> <worker> <path>  two workers changed one file
//       BEHIND <worker> <n>               the branch lacks the mainline's newest <n> commits
//       QUIET <worker> <n>m               no log line, commit or file change for <n> minutes (default
//                                         30): usually a prompt only the owner can answer
//       MISSING <worker> <path>           the worktree the board names is not there
//     then `BOARD OK <n> workers` (exit 0) or `BOARD <k> findings` (exit 1). Exit 2: usage.
//
// The board (reference/board.md): `Key: value` lines before the first heading (Mainline, Hub,
// Shared), and the units table between `<!-- board:units -->` and `<!-- /board:units -->` with the
// columns Worker, Unit, Wave, Branch, Worktree, Write set, State. A Worktree cell is relative to the
// main checkout (the parent of git's common dir) or absolute. Write sets, Hub and Shared are lists
// split on commas. Shared files (append-only logs merged with merge=union) are never FENCE or
// OVERLAP. A row whose State is LANDED, STOPPED or DONE, or with no Worker or Worktree, is not
// active. Each worker's log is <board dir>/<worker>.log.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const GIT_TIMEOUT_MS = 10000;
const QUIET_MIN = 30;
const INACTIVE = /^(?:landed|stopped|stop|done)$/i;
const PLACEHOLDER = /^(?:|-|—|n\/a|none)$/i;

function usage(message) {
  process.stderr.write(`board-check: ${message}\nusage: node board-check.mjs --plan <board.md>\n       node board-check.mjs <board.md> [--quiet-min <n>] [--now <ISO time>]\n`);
  process.exit(2);
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

const lines = (text) => String(text).split('\n').map((l) => l.trim()).filter(Boolean);
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.replace(/`/g, '').trim());
const isSep = (line) => /^\s*\|[\s:|-]*-[\s:|-]*$/.test(line);
const list = (value) => String(value ?? '').split(',').map((s) => s.replace(/`/g, '').trim()).filter((s) => !PLACEHOLDER.test(s));

/** { keys: lower-cased `Key: value` lines before the first heading, units: rows by column name }. */
export function parseBoard(text) {
  const all = String(text).replace(/\r\n?/g, '\n').split('\n');
  const keys = {};
  for (const line of all) {
    if (/^#{2,}\s/.test(line) || line.includes('<!-- board:')) break;
    const kv = /^([A-Za-z][A-Za-z ]*?):\s*(.*)$/.exec(line);
    if (kv && !(kv[1].toLowerCase() in keys)) keys[kv[1].toLowerCase()] = kv[2].trim();
  }
  const begin = all.findIndex((l) => l.includes('<!-- board:units -->'));
  const end = all.findIndex((l, i) => i > begin && l.includes('<!-- /board:units -->'));
  if (begin < 0 || end < 0) throw new Error('the board has no <!-- board:units --> ... <!-- /board:units --> table');
  const body = all.slice(begin + 1, end).filter((l) => /^\s*\|/.test(l));
  const at = body.findIndex((l, i) => i + 1 < body.length && isSep(body[i + 1]));
  if (at < 0) throw new Error('the units table has no header row');
  const header = cellsOf(body[at]).map((h) => h.toLowerCase());
  const col = (cells, name) => {
    const i = header.indexOf(name);
    return i >= 0 ? cells[i] ?? '' : '';
  };
  const units = body.filter((l, i) => i !== at && !isSep(l)).map(cellsOf).map((cells) => ({
    worker: PLACEHOLDER.test(col(cells, 'worker')) ? '' : col(cells, 'worker'),
    unit: col(cells, 'unit'),
    wave: PLACEHOLDER.test(col(cells, 'wave')) ? '1' : col(cells, 'wave'),
    branch: col(cells, 'branch'),
    worktree: PLACEHOLDER.test(col(cells, 'worktree')) ? '' : col(cells, 'worktree'),
    writeSet: list(col(cells, 'write set')),
    state: col(cells, 'state'),
  }));
  return { keys, units };
}

/** A write-set glob as a test on a repository path: `**` any depth, `*` and `?` inside one segment;
 *  a trailing `/`, or no wildcard at all, also covers everything under the path. */
export function globTest(glob) {
  let g = glob.trim().replace(/^\.\//, '');
  if (!/[*?]/.test(g)) {
    const p = g.replace(/\/+$/, '');
    return (file) => file === p || file.startsWith(`${p}/`);
  }
  if (g.endsWith('/')) g += '**';
  let rx = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i += 1;
      if (g[i + 1] === '/') {
        i += 1;
        rx += '(?:.*/)?';
      } else {
        rx += '.*';
      }
    } else if (c === '*') {
      rx += '[^/]*';
    } else if (c === '?') {
      rx += '[^/]';
    } else {
      rx += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const re = new RegExp(`^${rx}$`);
  return (file) => re.test(file);
}

const anyOf = (globs) => {
  const tests = globs.map(globTest);
  return (file) => tests.some((t) => t(file));
};

/** The main checkout: the parent of git's common dir when that is a .git, else the top level. */
function mainCheckout(dir) {
  const top = git(dir, ['rev-parse', '--show-toplevel']).trim();
  const common = resolve(top, git(top, ['rev-parse', '--git-common-dir']).trim());
  return realpathSync(basename(common) === '.git' ? dirname(common) : top);
}

/** --plan: CONFLICT and HUB lines, or none. */
export function planFindings(board, files) {
  const hub = anyOf(list(board.keys.hub));
  const shared = anyOf(list(board.keys.shared));
  const out = [];
  const byWave = new Map();
  for (const u of board.units) {
    if (!u.writeSet.length) continue;
    const inSet = anyOf(u.writeSet);
    const mine = new Set(files.filter(inSet));
    for (const g of u.writeSet) if (!/[*?]/.test(g)) mine.add(g.replace(/^\.\//, '').replace(/\/+$/, ''));
    const owners = byWave.get(u.wave) ?? new Map();
    byWave.set(u.wave, owners);
    for (const f of [...mine].sort()) {
      if (shared(f)) continue;
      if (hub(f)) {
        out.push(`HUB ${u.unit} ${f}`);
        continue;
      }
      owners.set(f, [...(owners.get(f) ?? []), u.unit]);
    }
  }
  for (const [wave, owners] of byWave) {
    for (const [f, units] of owners) if (units.length > 1) out.push(`CONFLICT ${f} ${units.join(' ')} (wave ${wave})`);
  }
  return out;
}

/** The files a worker's branch changed since it left the mainline: committed, staged, unstaged, untracked. */
function changedFiles(wt, mainline) {
  const base = git(wt, ['merge-base', `refs/heads/${mainline}`, 'HEAD']).trim();
  const tracked = lines(git(wt, ['diff', '--name-only', '--no-renames', base, '--']));
  const untracked = lines(git(wt, ['ls-files', '--others', '--exclude-standard']));
  return [...new Set([...tracked, ...untracked])].filter((f) => !f.startsWith('.review-work/')).sort();
}

const mtimeMs = (file) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** The event check's lines for every active worker. */
export function eventFindings(board, root, boardDir, { now = Date.now(), quietMin = QUIET_MIN } = {}) {
  const mainline = board.keys.mainline || 'main';
  const shared = anyOf(list(board.keys.shared));
  const out = [];
  const seen = [];
  const active = board.units.filter((u) => u.worker && u.worktree && !INACTIVE.test(u.state));
  for (const u of active) {
    const wt = isAbsolute(u.worktree) ? u.worktree : resolve(root, u.worktree);
    if (!existsSync(wt)) {
      out.push(`MISSING ${u.worker} ${u.worktree}`);
      continue;
    }
    const changed = changedFiles(wt, mainline);
    const inSet = anyOf(u.writeSet);
    for (const f of changed) if (!shared(f) && !inSet(f)) out.push(`FENCE ${u.worker} ${f}`);
    const behind = Number(git(wt, ['rev-list', '--count', `HEAD..refs/heads/${mainline}`]).trim());
    if (behind > 0) out.push(`BEHIND ${u.worker} ${behind}`);
    const committed = Number(git(wt, ['log', '-1', '--format=%ct', 'HEAD']).trim()) * 1000;
    const last = Math.max(mtimeMs(join(boardDir, `${u.worker}.log`)), committed, ...changed.map((f) => mtimeMs(join(wt, f))));
    const idle = Math.floor((now - last) / 60000);
    if (idle >= quietMin) out.push(`QUIET ${u.worker} ${idle}m`);
    seen.push({ worker: u.worker, files: new Set(changed.filter((f) => !shared(f))) });
  }
  for (let i = 0; i < seen.length; i += 1) {
    for (let j = i + 1; j < seen.length; j += 1) {
      for (const f of seen[i].files) if (seen[j].files.has(f)) out.push(`OVERLAP ${seen[i].worker} ${seen[j].worker} ${f}`);
    }
  }
  return { out, active: active.length };
}

function main(argv) {
  let plan = false;
  let file = null;
  let quietMin = QUIET_MIN;
  let now = Date.now();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--plan') plan = true;
    else if (a === '--quiet-min') {
      quietMin = Number(argv[(i += 1)]);
      if (!Number.isFinite(quietMin) || quietMin < 1) usage('--quiet-min takes a whole number of minutes');
    } else if (a === '--now') {
      now = Date.parse(argv[(i += 1)] ?? '');
      if (Number.isNaN(now)) usage('--now takes an ISO time');
    } else if (a === '-h' || a === '--help') usage('help');
    else if (a.startsWith('-') || file !== null) usage(`unexpected argument: ${a}`);
    else file = a;
  }
  if (file === null) usage('name the board file');
  let board;
  let root;
  const boardPath = resolve(file);
  try {
    board = parseBoard(readFileSync(boardPath, 'utf8'));
    root = mainCheckout(dirname(boardPath));
  } catch (error) {
    usage(error.message.split('\n')[0]);
  }
  if (plan) {
    const files = lines(git(root, ['ls-files']));
    const found = planFindings(board, files);
    for (const line of found) process.stdout.write(`${line}\n`);
    const units = board.units.filter((u) => u.writeSet.length).length;
    if (!found.length) {
      process.stdout.write(`PLAN OK ${units} units, write sets disjoint in each wave\n`);
      return 0;
    }
    process.stdout.write('PLAN REFUSED: give one of the units a later wave, or make the file a hub file the controller lands before the wave\n');
    return 1;
  }
  const { out, active } = eventFindings(board, root, dirname(boardPath), { now, quietMin });
  for (const line of out) process.stdout.write(`${line}\n`);
  process.stdout.write(out.length ? `BOARD ${out.length} findings\n` : `BOARD OK ${active} workers\n`);
  return out.length ? 1 : 0;
}

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
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`board-check: ${String(error.message ?? error).split('\n')[0]}\n`);
    process.exitCode = 2;
  }
}
