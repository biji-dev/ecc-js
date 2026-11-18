#!/usr/bin/env node
// coordinate-sessions board check. Read-only except --host --register/--release, no dependencies, Node 18+.
//
//   node board-check.mjs --plan <board.md>
//     Before any worker starts: expands each unit's write-set globs against `git ls-files` (a glob
//     with no wildcard also counts as itself, so a file a unit will create is checked too) and
//     refuses a file that two units of one wave would write, or a hub file inside a write set. Two
//     units of one wave whose globs could match one path no tracked file shows yet (`src/new/**`
//     and `src/new/*.ts`) are refused too, naming both globs.
//     Exit 0: the sets are disjoint. Exit 1: CONFLICT / HUB lines, then PLAN REFUSED.
//
//   node board-check.mjs <board.md> [--quiet-min <n>] [--now <ISO time>] [--transcripts [--projects-dir <dir>]]
//     At each event (a message, an idle notice, after a compaction): for every active worker, in its
//     worktree, the files its branch changed since it left the mainline, uncommitted and untracked
//     included. Prints, one per line:
//       FENCE <worker> <path>             a write outside the worker's write set, or to a hub file
//       OVERLAP <worker> <worker> <path>  two workers changed one file
//       BEHIND <worker> <n>               the branch lacks the mainline's newest <n> commits
//       QUIET <worker> <n>m               no log line, commit or file change for <n> minutes (default
//                                         15): usually a prompt only the owner can answer
//       MISSING <worker> <path>           the worktree the board names is not there
//     then `BOARD OK <n> workers` (exit 0) or `BOARD <k> findings` (exit 1). Exit 2: usage.
//
//     --transcripts adds, per active worker, one line from the tail of its newest Claude Code
//     transcript (<projects dir>/<slug of the worktree's real path>/*.jsonl, newest by mtime; the
//     slug replaces every character outside [A-Za-z0-9] with `-`; the projects dir is
//     --projects-dir, else $CLAUDE_PROJECTS_DIR, else ~/.claude/projects). A worker that started in
//     the main checkout and entered its worktree writes under the main checkout's slug instead: when
//     the worktree's own directory has no transcript, the transcript there (among the 20 newest)
//     whose newest record with a `cwd` is the worktree (or under it) is used, when exactly one is;
//     only tails are read.
//       PROMPT <worker> <tool> <n>m       a tool call with no result for 5 minutes or more, not a tool
//                                         that runs long in the foreground (Agent, Task, Workflow,
//                                         TaskOutput; a foreground Bash only once past its timeout
//                                         plus 60 s): the worker waits on a dialog only the owner
//                                         can answer
//       IDLE <worker> <n>m                the turn ended <n> minutes ago (5 or more) on a last line
//                                         that is no state word (RUNNING, WAITING ON OWNER, WAITING
//                                         ON CONTROLLER, DONE, BLOCKED, STOPPED), or on RUNNING with
//                                         no background task still running: send GO or PING. A task
//                                         is running when its launch has no <task-notification> and
//                                         no successful TaskStop / KillShell yet. A launch is a call
//                                         with run_in_background, a result flagged async (isAsync,
//                                         status async_launched, backgroundTaskId), an agent a
//                                         SendMessage resumed, a Monitor, or, for Bash, Agent, Task
//                                         and Workflow only, a result that opens with "Async agent
//                                         launched" / "Workflow launched in background" / "Command
//                                         running in background" (Bash also: "moved to the
//                                         background"). A launch whose result is an error never ran.
//                                         When RUNNING shows no open task in the last 256 KB, the last
//                                         4 MB is read before saying IDLE
//       NOTRANSCRIPT <worker> <dir>       no transcript there (or its directory name is not the
//                                         slug, as for a very long path): PING; never a PROMPT
//       NOTRANSCRIPT <worker> <dir> (<n> candidates)
//                                         the worktree's own directory has none, and <n> (2 or more)
//                                         transcripts in the main checkout's directory end in the
//                                         worktree: one may be a session that only cd'd there, so
//                                         none is read
//     A turn ending on WAITING ON ..., DONE, BLOCKED or STOPPED, a running background task or a
//     fresh tool call prints nothing. Every line counts as a finding.
//
//   node board-check.mjs --watch <board.md> [--every <seconds>] [--max <minutes>]
//     The event check with --transcripts every <every> seconds (default 600), for up to <max>
//     minutes (default 240). The first check is the baseline: its lines stand (BEHIND before READY,
//     NOTRANSCRIPT for a worker whose host writes none, QUIET on a worker waiting on the owner) and
//     are announced once as `WATCH BASELINE <n> standing findings`. A later check that has a line
//     the previous check did not have (compared by type, worker and path, not by minutes or counts:
//     QUIET 20m then QUIET 35m is the same line; IDLE then PROMPT is a new one) prints those new
//     lines and `BOARD <k> findings` and exits 1. An IDLE or PROMPT that stands is new again once its
//     minutes are 30 or more past the minutes it was last reported with (a worker idle for an hour
//     wakes the controller again). With none by the end it prints `WATCH END <n> checks, <k> still
//     standing` (the first check had lines; k = the lines standing at the last check) or, when the
//     first check was clean, `WATCH END <n> checks, nothing found`, and exits 0. Run it as a
//     background shell: its exit wakes the controller. A board that does not parse exits 2 at once. (--max-seconds <s> is the same
//     bound in seconds, for tests.)
//
//   node board-check.mjs --host [--peak-gb <g>]
//     The worker cap over the whole host. Reads the registry (<dir>/<run>-<hash>.json =
//     {"board": <absolute path>, "workers": <n>, "started": <ISO time>}; dir = --sessions-dir, else
//     $HARNESS_SESSIONS_DIR, else ~/.harness/sessions). The count of each run is read from its board
//     now (the stored number is a snapshot); a file that does not parse, or whose board is gone, is
//     ignored; a run with no write for 6 hours (its board file, or a *.log in the board's directory)
//     is stale: left out of the count and reported, never deleted. Prints
//       HOST <n> workers in <m> runs (cap <c>; <g> GB free by vm_stat|freemem|--free-gb)
//       HOST STALE <run> <board>          one per stale run
//     cap = min(floor(cores / 2), 3, n + floor(free GB / peak GB)): half the cores and 3 bound the
//     workers on the host, and free memory bounds how many more fit (it is measured with the n
//     workers running, so they are not subtracted again). Peak GB default 3; cores from os.cpus();
//     free memory from /usr/bin/vm_stat on macOS as (free + inactive + speculative + purgeable) pages times
//     the page size (os.freemem() counts only free pages there, near zero on an idle machine), and
//     from os.freemem() elsewhere or when vm_stat fails (the HOST line names the source, so a cap of
//     0 from a failed measurement is seen); --cores <n> and --free-gb <g> override.
//     Exit 0 while <n> < <c>; at the cap it adds `HOST AT CAP: start no new worker` and exits 1.
//   node board-check.mjs --host --register <board.md>
//     Writes the board's registry file (run = the `# Board: <run>` heading, workers = its active
//     rows; the file name carries a hash of the board's real path, so two repositories with one run
//     name never share a file; written to a temp file and renamed). Prints
//     `HOST REGISTERED <run> <n> workers`.
//   node board-check.mjs --host --release <board.md>
//     Removes it. Prints `HOST RELEASED <run>` (`HOST NOT REGISTERED <run>` when it was not there).
//
// The board (reference/board.md): `Key: value` lines before the first heading (Mainline, Hub,
// Shared), and the units table between `<!-- board:units -->` and `<!-- /board:units -->` with the
// columns Worker, Unit, Wave, Branch, Worktree, Write set, State. A Worktree cell is relative to the
// main checkout (the parent of git's common dir) or absolute. Write sets, Hub and Shared are lists
// split on commas. Shared files (append-only logs merged with merge=union) are never FENCE or
// OVERLAP. A row whose State is LANDED, STOPPED or DONE, or with no Worker or Worktree, is not
// active. Each worker's log is <board dir>/<worker>.log.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, freemem, homedir, platform } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const GIT_TIMEOUT_MS = 10000;
const QUIET_MIN = 15;
const IDLE_MIN = 5;
const PROMPT_MIN = 5;
const TAIL_BYTES = 256 * 1024;
const BIG_TAIL_BYTES = 4 * 1024 * 1024;
const REFIRE_MIN = 30;
const DEFAULT_BASH_TIMEOUT_MS = 120000;
// tools that run long in the foreground without a dialog: a subagent, a workflow, a blocking wait
const LONG_TOOLS = new Set(['Agent', 'Task', 'Workflow', 'TaskOutput']);
const STATE_WORDS = /^(?:RUNNING|WAITING ON OWNER|WAITING ON CONTROLLER|DONE|BLOCKED|STOPPED)\b/;
const HOST_MAX_CAP = 3;
const HOST_STALE_MS = 6 * 3600 * 1000;
const CANDIDATES = 20;
// what a background launch's tool_result says (its first 300 characters), when the call has no run_in_background flag
// A launch is told from its result: the flags Claude Code puts on it (isAsync, status async_launched,
// backgroundTaskId, or the id of an agent a SendMessage resumed), or, for the tools that launch, the
// opening words of the result. The phrase is never searched in the middle of another tool's output or
// in a foreground agent's report ("the server is running in the background").
const PHRASE_TOOLS = new Set(['Bash', 'Agent', 'Task', 'Workflow', 'Monitor']);
const STARTED_BG = /^\s*(?:Async agent launched|Workflow launched in background|Command running in background)/i;
const MOVED_BG = /\bmoved to (?:the )?background\b/i;
const STOP_TOOLS = new Set(['TaskStop', 'KillShell']);
const INACTIVE = /^(?:landed|stopped|stop|done)$/i;
const PLACEHOLDER = /^(?:|-|—|n\/a|none)$/i;

function usage(message) {
  process.stderr.write(`board-check: ${message}
usage: node board-check.mjs --plan <board.md>
       node board-check.mjs <board.md> [--quiet-min <n>] [--now <ISO time>] [--transcripts [--projects-dir <dir>]]
       node board-check.mjs --watch <board.md> [--every <seconds>] [--max <minutes>]
       node board-check.mjs --host [--peak-gb <g>] [--register <board.md> | --release <board.md>]
`);
  process.exit(2);
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

const lines = (text) => String(text).split('\n').map((l) => l.trim()).filter(Boolean);
// git's -z output: paths as they are, a leading or trailing space kept
const zlist = (text) => String(text).split('\0').filter(Boolean);
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

const hasWild = (glob) => /[*?]/.test(glob);

/** A glob as path segments, `**` for any depth: a glob with no wildcard or a trailing `/` covers what is under it. */
function segments(glob) {
  const g = glob.trim().replace(/^\.\//, '');
  const segs = g.replace(/\/+$/, '').split('/').filter(Boolean).map((x) => (x.includes('**') ? '**' : x));
  return !hasWild(g) || g.endsWith('/') ? [...segs, '**'] : segs;
}

/** Whether two one-segment patterns (`*` and `?` inside it) can match one name. */
function segmentsMeet(a, b) {
  const memo = new Map();
  const meet = (i, j) => {
    const key = i * (b.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let r;
    if (i === a.length && j === b.length) r = true;
    else if (a[i] === '*') r = meet(i + 1, j) || (j < b.length && meet(i, j + 1));
    else if (b[j] === '*') r = meet(i, j + 1) || (i < a.length && meet(i + 1, j));
    else if (i === a.length || j === b.length) r = false;
    else r = (a[i] === '?' || b[j] === '?' || a[i] === b[j]) && meet(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return meet(0, 0);
}

/** Whether two write-set globs can match one repository path, existing or not. */
export function globsMeet(x, y) {
  const a = segments(x);
  const b = segments(y);
  const memo = new Map();
  const meet = (i, j) => {
    const key = i * (b.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let r;
    if (i === a.length && j === b.length) r = true;
    else if (a[i] === '**') r = meet(i + 1, j) || (j < b.length && meet(i, j + 1));
    else if (b[j] === '**') r = meet(i, j + 1) || (i < a.length && meet(i + 1, j));
    else if (i === a.length || j === b.length) r = false;
    else r = segmentsMeet(a[i], b[j]) && meet(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return meet(0, 0);
}

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
  const named = new Set();
  for (const [wave, owners] of byWave) {
    for (const [f, units] of owners) {
      if (units.length < 2) continue;
      out.push(`CONFLICT ${f} ${units.join(' ')} (wave ${wave})`);
      for (const x of units) for (const y of units) named.add(`${wave}\0${x}\0${y}`);
    }
  }
  // Globs that could meet on a path git does not show yet: a file one of the units will create.
  const sets = board.units.filter((u) => u.writeSet.length);
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const [u, v] = [sets[i], sets[j]];
      if (u.wave !== v.wave || u.unit === v.unit || named.has(`${u.wave}\0${u.unit}\0${v.unit}`)) continue;
      const pair = u.writeSet.flatMap((g) => v.writeSet.map((h) => [g, h])).find(([g, h]) => {
        const literal = [g, h].filter((x) => !hasWild(x)).map((x) => x.replace(/^\.\//, '').replace(/\/+$/, ''));
        return !literal.some((f) => shared(f) || hub(f)) && globsMeet(g, h);
      });
      if (pair) out.push(`CONFLICT ${pair[0]} ~ ${pair[1]} ${u.unit} ${v.unit} (wave ${u.wave}: the globs can match one new file)`);
    }
  }
  return out;
}

/** The files a worker's branch changed since it left the mainline: committed, staged, unstaged, untracked. */
function changedFiles(wt, mainline) {
  const base = git(wt, ['merge-base', `refs/heads/${mainline}`, 'HEAD']).trim();
  const tracked = zlist(git(wt, ['diff', '--name-only', '-z', '--no-renames', base, '--']));
  const untracked = zlist(git(wt, ['ls-files', '-z', '--others', '--exclude-standard']));
  return [...new Set([...tracked, ...untracked])].filter((f) => !f.startsWith('.review-work/')).sort();
}

/** The rows that are workers still running: a worker, a worktree and a State that is not LANDED, STOPPED or DONE. */
const activeUnits = (board) => board.units.filter((u) => u.worker && u.worktree && !INACTIVE.test(u.state));

const mtimeMs = (file) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** Claude Code's directory name for a working directory: every character outside [A-Za-z0-9] becomes `-`. */
export const slugOf = (absPath) => String(absPath).replace(/[^A-Za-z0-9]/g, '-');

/** The newest top-level *.jsonl in a transcript directory (subagents/ is a subdirectory, so it is never read), or null. */
export function newestTranscript(dir) {
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.jsonl')).map((d) => join(dir, d.name));
  } catch {
    return null;
  }
  names.sort((x, y) => mtimeMs(y) - mtimeMs(x));
  return names[0] ?? null;
}

/** The parsed JSONL records in the last TAIL_BYTES of a file; a partial first line and bad lines are skipped. */
export function readTail(file, bytes = TAIL_BYTES) {
  const fd = openSync(file, 'r');
  try {
    const size = statSync(file).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    let text = buf.subarray(0, got).toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    const out = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e === 'object') out.push(e);
      } catch {
        // a torn or foreign line
      }
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

const blocksOf = (message) => {
  const c = message?.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c.filter((b) => b && typeof b === 'object') : [];
};

/** The ids a <task-notification> in a record's text names: a background task that ended. */
function notifiedIds(e) {
  const texts = [];
  if (e.type === 'queue-operation' && typeof e.content === 'string') texts.push(e.content);
  if (e.type === 'user') for (const b of blocksOf(e.message)) if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
  const ids = [];
  for (const t of texts) {
    for (const m of t.matchAll(/<(?:tool-use-id|task-id)>([^<\s]+)<\/(?:tool-use-id|task-id)>/g)) ids.push(m[1]);
  }
  return ids;
}

/** The text of a tool_result block: a string, or the text items of a list. */
function resultText(block) {
  const c = block.content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n') : '';
}

/** The task or agent ids a launch result names ("with ID: b7", "agentId: a1", "(task m1)"). */
function taskIdsOf(text, record) {
  const ids = [];
  for (const re of [/\bID:\s*([A-Za-z0-9_-]+)/g, /\bagentId:\s*([A-Za-z0-9_-]+)/g, /\(task ([A-Za-z0-9_-]+)\)/g]) for (const m of text.matchAll(re)) ids.push(m[1]);
  for (const m of text.matchAll(/"(?:resumed|revived)AgentId"\s*:\s*"([A-Za-z0-9_-]+)"/g)) ids.push(m[1]);
  for (const k of ['backgroundTaskId', 'agentId', 'taskId', 'resumedAgentId', 'revivedAgentId']) if (typeof record?.[k] === 'string') ids.push(record[k]);
  return ids;
}

/**
 * Classifies a worker from the tail of its transcript records. Claude Code writes one content block
 * per `assistant` record (thinking, text or tool_use; `message.stop_reason` is `end_turn` on the last
 * of a turn, `tool_use` before a tool call), tool results as `user` records with `tool_result`
 * blocks, and a finished background task as a `<task-notification>` naming the launching tool call's
 * id (and the task id) in a `queue-operation` record and in the `user` record that wakes the worker.
 * A call runs in the background when its input says so, or when its result says so (an agent or a
 * workflow launches that way with no flag, and a foreground Bash can be moved there), or it is a
 * Monitor; a foreground Agent returns its full result and is never notified, so it is not one.
 * Returns { kind: 'PROMPT', tool, minutes }, { kind: 'IDLE', minutes } or null.
 */
export function classifyTail(entries, nowMs) {
  return classifyDetail(entries, nowMs).found;
}

/** classifyTail's answer and `unverified`: it is IDLE only because RUNNING shows no open task in these records, which may not reach back to the launch. */
function classifyDetail(entries, nowMs) {
  const pending = new Map();
  const background = new Map();
  const notified = new Set();
  const names = new Map();
  const stops = new Map();
  let last = null;
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    for (const id of notifiedIds(e)) notified.add(id);
    if ((e.type !== 'assistant' && e.type !== 'user') || e.isSidechain || !e.message) continue;
    const at = Date.parse(e.timestamp);
    const blocks = blocksOf(e.message);
    const uses = blocks.filter((b) => b.type === 'tool_use');
    for (const b of blocks) {
      if (b.type !== 'tool_result') continue;
      const id = b.tool_use_id;
      pending.delete(id);
      const name = names.get(id) ?? '';
      if (b.is_error) {
        // a launch that errored never ran
        background.delete(id);
        continue;
      }
      if (stops.has(id)) for (const t of stops.get(id)) notified.add(t);
      const text = resultText(b);
      const record = e.toolUseResult && typeof e.toolUseResult === 'object' ? e.toolUseResult : null;
      const head = text.slice(0, 300);
      const flagged = record?.isAsync === true || record?.status === 'async_launched'
        || ['backgroundTaskId', 'resumedAgentId', 'revivedAgentId'].some((k) => typeof record?.[k] === 'string' && record[k] !== '');
      const phrased = PHRASE_TOOLS.has(name) && (STARTED_BG.test(head) || (name === 'Bash' && MOVED_BG.test(head)));
      if (flagged || phrased || name === 'Monitor') background.set(id, taskIdsOf(text, record));
    }
    for (const b of uses) {
      const input = b.input && typeof b.input === 'object' ? b.input : {};
      pending.set(b.id, { name: String(b.name ?? ''), input, at });
      names.set(b.id, String(b.name ?? ''));
      if (input.run_in_background === true && !background.has(b.id)) background.set(b.id, []);
      // a TaskStop or KillShell closes the task it names (the task id or the launching call's id) once it succeeds
      if (STOP_TOOLS.has(b.name)) stops.set(b.id, [input.task_id, input.shell_id, input.bash_id].filter((v) => typeof v === 'string' && v));
    }
    let kind;
    if (e.type === 'assistant') kind = uses.length ? 'tool' : blocks.some((b) => b.type === 'text' && String(b.text ?? '').trim()) ? 'text' : 'thinking';
    else kind = blocks.some((b) => b.type === 'tool_result') ? 'result' : 'prompt';
    last = { kind, at, blocks, stop: e.message.stop_reason };
  }
  if (!last || Number.isNaN(last.at)) return { found: null };
  const mins = (ms) => Math.floor((nowMs - ms) / 60000);
  for (const call of pending.values()) {
    if (LONG_TOOLS.has(call.name) || Number.isNaN(call.at)) continue;
    const age = nowMs - call.at;
    const foreground = call.name === 'Bash' && call.input.run_in_background !== true;
    const limit = foreground ? (Number(call.input.timeout) || DEFAULT_BASH_TIMEOUT_MS) + 60000 : 0;
    if (age >= PROMPT_MIN * 60000 && age > limit) return { found: { kind: 'PROMPT', tool: call.name, minutes: mins(call.at) } };
  }
  if (last.kind !== 'text' || last.stop === 'tool_use' || nowMs - last.at < IDLE_MIN * 60000) return { found: null };
  const text = last.blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('\n');
  const finalLine = text.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  const state = finalLine.replace(/^[\s*_`>#-]+/, '');
  const running = [...background].some(([id, tasks]) => !notified.has(id) && !tasks.some((t) => notified.has(t)));
  if (STATE_WORDS.test(state) && !(state.startsWith('RUNNING') && !running)) return { found: null };
  return { found: { kind: 'IDLE', minutes: mins(last.at) }, unverified: state.startsWith('RUNNING') };
}

/** The top-level transcripts of a directory, newest first. */
function transcriptsNewestFirst(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.jsonl')).map((d) => join(dir, d.name)).sort((x, y) => mtimeMs(y) - mtimeMs(x));
  } catch {
    return [];
  }
}

/**
 * A worker started in the main checkout that entered its worktree writes its transcript under the main
 * checkout's slug. Every transcript among the newest CANDIDATES there whose newest record with a `cwd` is
 * the worktree (or under it) is a candidate; only each one's tail is read. Returns [{ file, entries }].
 */
export function transcriptsByCwd(mainDir, worktree) {
  const found = [];
  for (const file of transcriptsNewestFirst(mainDir).slice(0, CANDIDATES)) {
    let entries;
    try {
      entries = readTail(file);
    } catch {
      continue;
    }
    const cwd = [...entries].reverse().find((e) => typeof e.cwd === 'string')?.cwd;
    if (cwd && (cwd === worktree || cwd.startsWith(worktree + sep))) found.push({ file, entries });
  }
  return found;
}

/** The entries of the one transcript in the main checkout's directory that is the worktree's, or null when there is none or more than one. */
export function transcriptByCwd(mainDir, worktree) {
  const found = transcriptsByCwd(mainDir, worktree);
  return found.length === 1 ? found[0].entries : null;
}

/**
 * The transcript line for one worker, or null: PROMPT, IDLE or NOTRANSCRIPT. `mainRoot` adds the main
 * checkout's slug directory as a second place to look; when more than one transcript there ends in the
 * worktree (a session that only cd'd into it), none can be told to be the worker's:
 * `NOTRANSCRIPT <worker> <dir> (<n> candidates)`.
 */
export function transcriptLine(worker, worktree, projectsDir, nowMs, mainRoot = null) {
  let real = worktree;
  try {
    real = realpathSync(worktree);
  } catch {
    // the caller has checked that it exists
  }
  const dir = join(projectsDir, slugOf(real));
  let file = newestTranscript(dir);
  let entries = null;
  try {
    if (file) entries = readTail(file);
    else if (mainRoot && mainRoot !== real) {
      const found = transcriptsByCwd(join(projectsDir, slugOf(mainRoot)), real);
      if (found.length > 1) return `NOTRANSCRIPT ${worker} ${dir} (${found.length} candidates)`;
      if (found.length === 1) ({ file, entries } = found[0]);
    }
  } catch {
    entries = null;
  }
  if (!entries) return `NOTRANSCRIPT ${worker} ${dir}`;
  let { found, unverified } = classifyDetail(entries, nowMs);
  if (unverified) {
    // RUNNING with no open task in the tail: a launch can sit further back than the tail reaches
    try {
      if (statSync(file).size > TAIL_BYTES) found = classifyDetail(readTail(file, BIG_TAIL_BYTES), nowMs).found;
    } catch {
      // the first answer stands
    }
  }
  if (!found) return null;
  return found.kind === 'PROMPT' ? `PROMPT ${worker} ${found.tool} ${found.minutes}m` : `IDLE ${worker} ${found.minutes}m`;
}

/** A finding line without its changing numbers: the same standing condition keeps one key (QUIET 20m and QUIET 35m, BEHIND 1 and 2). */
export function lineKey(line) {
  const w = String(line).split(' ');
  if (w[0] === 'QUIET' || w[0] === 'IDLE') return w.slice(0, 2).join(' ');
  if (w[0] === 'PROMPT') return w.slice(0, 3).join(' ');
  if (w[0] === 'BEHIND' || w[0] === 'NOTRANSCRIPT') return w.slice(0, 2).join(' ');
  return String(line);
}

/** The minutes in an IDLE or PROMPT line, else null. */
const minutesOf = (line) => {
  const w = String(line).split(' ');
  if (w[0] !== 'IDLE' && w[0] !== 'PROMPT') return null;
  const m = /^(\d+)m$/.exec(w[w.length - 1]);
  return m ? Number(m[1]) : null;
};

/**
 * One watch step. `prev` maps the key of each line that stood at the previous check to the minutes it
 * had when it was last reported (null for lines without minutes), as a plain object. A line is fresh
 * when its key was not there, or when it is an IDLE or PROMPT whose minutes have grown by REFIRE_MIN or
 * more since it was last reported (a worker idle for an hour must wake the controller again). Returns
 * { fresh, next }: the fresh lines, and the map for the next step (a standing line keeps the minutes
 * it was last reported with).
 */
export function watchStep(prev, lines) {
  const fresh = [];
  const next = {};
  for (const line of lines) {
    const key = lineKey(line);
    if (Object.hasOwn(next, key)) continue;
    const m = minutesOf(line);
    const was = Object.hasOwn(prev, key) ? prev[key] : undefined;
    if (was === undefined || (m !== null && was !== null && m - was >= REFIRE_MIN)) {
      fresh.push(line);
      next[key] = m;
    } else next[key] = was;
  }
  return { fresh, next };
}

/** The event check's lines for every active worker; `projectsDir` adds the transcript lines. */
export function eventFindings(board, root, boardDir, { now = Date.now(), quietMin = QUIET_MIN, projectsDir = null } = {}) {
  const mainline = board.keys.mainline || 'main';
  const shared = anyOf(list(board.keys.shared));
  const hub = anyOf(list(board.keys.hub));
  const out = [];
  const seen = [];
  const active = activeUnits(board);
  for (const u of active) {
    const wt = isAbsolute(u.worktree) ? u.worktree : resolve(root, u.worktree);
    if (!existsSync(wt)) {
      out.push(`MISSING ${u.worker} ${u.worktree}`);
      continue;
    }
    const changed = changedFiles(wt, mainline);
    const inSet = anyOf(u.writeSet);
    // a hub file is the controller's, even inside a worker's write set
    for (const f of changed) if (!shared(f) && (hub(f) || !inSet(f))) out.push(`FENCE ${u.worker} ${f}`);
    const behind = Number(git(wt, ['rev-list', '--count', `HEAD..refs/heads/${mainline}`]).trim());
    if (behind > 0) out.push(`BEHIND ${u.worker} ${behind}`);
    const committed = Number(git(wt, ['log', '-1', '--format=%ct', 'HEAD']).trim()) * 1000;
    const last = Math.max(mtimeMs(join(boardDir, `${u.worker}.log`)), committed, ...changed.map((f) => mtimeMs(join(wt, f))));
    const idle = Math.floor((now - last) / 60000);
    if (idle >= quietMin) out.push(`QUIET ${u.worker} ${idle}m`);
    if (projectsDir) {
      const line = transcriptLine(u.worker, wt, projectsDir, now, root);
      if (line) out.push(line);
    }
    seen.push({ worker: u.worker, files: new Set(changed.filter((f) => !shared(f))) });
  }
  for (let i = 0; i < seen.length; i += 1) {
    for (let j = i + 1; j < seen.length; j += 1) {
      for (const f of seen[i].files) if (seen[j].files.has(f)) out.push(`OVERLAP ${seen[i].worker} ${seen[j].worker} ${f}`);
    }
  }
  return { out, active: active.length };
}

/**
 * The host's worker cap: half the cores and 3 bound the workers on the machine, and free memory bounds
 * how many more fit. Free memory is measured with the running workers already in it, so they are added
 * back to the cap, not subtracted twice.
 */
export function hostCap({ cores, freeGb, peakGb, running = 0 }) {
  return Math.max(0, Math.min(Math.floor(cores / 2), HOST_MAX_CAP, running + Math.floor(freeGb / peakGb)));
}

/** Bytes available from `vm_stat` output: (free + inactive + speculative + purgeable) pages times the page size, or null. */
export function parseVmStat(text) {
  const size = /page size of (\d+) bytes/.exec(String(text));
  if (!size) return null;
  let pages = 0;
  for (const name of ['free', 'inactive', 'speculative', 'purgeable']) {
    const m = new RegExp(`^Pages ${name}:\\s+(\\d+)\\.?\\s*$`, 'm').exec(String(text));
    if (!m) return null;
    pages += Number(m[1]);
  }
  return pages * Number(size[1]);
}

/**
 * Memory a new worker can use: { gb, source }. os.freemem() counts only free pages, which on macOS is
 * near zero with the machine idle, so there the figure comes from /usr/bin/vm_stat (source `vm_stat`;
 * $BOARD_CHECK_VM_STAT names another program, for tests);
 * elsewhere, or when vm_stat fails, it is os.freemem() (source `freemem`), and the HOST line says which.
 */
export function availableGb() {
  if (platform() === 'darwin') {
    try {
      const bytes = parseVmStat(execFileSync(process.env.BOARD_CHECK_VM_STAT || '/usr/bin/vm_stat', [], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }));
      if (bytes !== null) return { gb: bytes / 2 ** 30, source: 'vm_stat' };
    } catch {
      // fall through to os.freemem()
    }
  }
  return { gb: freemem() / 2 ** 30, source: 'freemem' };
}

/** Every registry file that parses and names a board. */
export function readRegistry(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.sort()) {
    try {
      const r = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (r && typeof r.board === 'string') out.push({ file: join(dir, name), run: name.replace(/\.json$/, ''), board: r.board, workers: r.workers, started: r.started });
    } catch {
      // a file that does not parse is ignored
    }
  }
  return out;
}

/**
 * The registry split into live runs and stale ones. A run is live while its board file exists and was
 * written in the last 6 hours; its worker count is read from the board now (the stored number is only a
 * snapshot, used when the board cannot be parsed). A board that is gone is dropped silently; a board not
 * written for 6 hours is stale: reported, never deleted. Two files naming one board count once.
 */
export function hostEntries(dir, now) {
  const live = [];
  const stale = [];
  const seen = new Set();
  for (const r of readRegistry(dir)) {
    if (seen.has(r.board)) continue;
    let mtime;
    try {
      mtime = statSync(r.board).mtimeMs;
    } catch {
      continue;
    }
    // a run is as live as its newest write: the board's, or a worker's log in the board's directory
    try {
      const dirOf = dirname(r.board);
      for (const n of readdirSync(dirOf)) if (n.endsWith('.log')) mtime = Math.max(mtime, mtimeMs(join(dirOf, n)));
    } catch {
      // the board's own mtime stands
    }
    seen.add(r.board);
    let text = '';
    try {
      text = readFileSync(r.board, 'utf8');
    } catch {
      // unreadable: the stored count and the file name stand
    }
    let run = r.run;
    try {
      run = runOf(text);
    } catch {
      // no heading: the file name
    }
    if (now - mtime > HOST_STALE_MS) {
      stale.push({ ...r, run });
      continue;
    }
    let workers = Number.isInteger(r.workers) ? r.workers : 0;
    try {
      workers = activeUnits(parseBoard(text)).length;
    } catch {
      // the stored snapshot stands
    }
    live.push({ ...r, run, workers });
  }
  return { live, stale };
}

/** The `# Board: <run>` heading, as a file-name-safe run id. */
export function runOf(text) {
  const m = /^#\s+Board:\s*(.+?)\s*$/m.exec(String(text));
  const run = m ? m[1].replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') : '';
  if (!run) throw new Error('the board has no "# Board: <run>" heading');
  return run;
}

function hostMain(opts) {
  const dir = opts.sessionsDir || process.env.HARNESS_SESSIONS_DIR || join(homedir(), '.harness', 'sessions');
  if (opts.register || opts.release) {
    const boardPath = realpathSync(resolve(opts.register || opts.release));
    const text = readFileSync(boardPath, 'utf8');
    const run = runOf(text);
    const mine = readRegistry(dir).filter((r) => r.board === boardPath);
    if (opts.release) {
      for (const r of mine) rmSync(r.file, { force: true });
      process.stdout.write(mine.length ? `HOST RELEASED ${run}\n` : `HOST NOT REGISTERED ${run}\n`);
      return 0;
    }
    const workers = activeUnits(parseBoard(text)).length;
    mkdirSync(dir, { recursive: true });
    // one file per board, named by the run and a hash of the board's real path: two repositories that
    // call their runs alike never write one file. Written to a per-process temp file, then renamed.
    const target = mine[0]?.file ?? join(dir, `${run}-${createHash('sha1').update(boardPath).digest('hex').slice(0, 8)}.json`);
    const record = { board: boardPath, workers, started: mine[0]?.started ?? new Date(opts.now).toISOString() };
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(record)}\n`);
    renameSync(temp, target);
    process.stdout.write(`HOST REGISTERED ${run} ${workers} workers\n`);
    return 0;
  }
  const { live, stale } = hostEntries(dir, opts.now);
  const n = live.reduce((sum, r) => sum + r.workers, 0);
  const free = opts.freeGb === undefined ? availableGb() : { gb: opts.freeGb, source: '--free-gb' };
  const cap = hostCap({ cores: opts.cores ?? cpus().length, freeGb: free.gb, peakGb: opts.peakGb, running: n });
  process.stdout.write(`HOST ${n} workers in ${live.length} runs (cap ${cap}; ${free.gb.toFixed(1)} GB free by ${free.source})\n`);
  for (const r of stale) process.stdout.write(`HOST STALE ${r.run} ${r.board}\n`);
  if (n < cap) return 0;
  process.stdout.write('HOST AT CAP: start no new worker\n');
  return 1;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function takeNumber(argv, i, flag, { min, whole = false }) {
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v) || v < min || (whole && !Number.isInteger(v))) usage(`${flag} takes ${whole ? 'a whole number' : 'a number'} of at least ${min}`);
  return v;
}

async function main(argv) {
  const opts = { quietMin: QUIET_MIN, now: Date.now(), everyS: 600, maxS: 240 * 60, peakGb: 3 };
  let plan = false;
  let watch = false;
  let host = false;
  let transcripts = false;
  let file = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--plan') plan = true;
    else if (a === '--transcripts') transcripts = true;
    else if (a === '--watch') watch = true;
    else if (a === '--host') host = true;
    else if (a === '--quiet-min') {
      opts.quietMin = takeNumber(argv, i, a, { min: 1, whole: true });
      i += 1;
    } else if (a === '--every') {
      opts.everyS = takeNumber(argv, i, a, { min: 1 });
      i += 1;
    } else if (a === '--max') {
      opts.maxS = takeNumber(argv, i, a, { min: 0 }) * 60;
      i += 1;
    } else if (a === '--max-seconds') {
      opts.maxS = takeNumber(argv, i, a, { min: 0 });
      i += 1;
    } else if (a === '--peak-gb') {
      opts.peakGb = takeNumber(argv, i, a, { min: 0.1 });
      i += 1;
    } else if (a === '--cores') {
      opts.cores = takeNumber(argv, i, a, { min: 1, whole: true });
      i += 1;
    } else if (a === '--free-gb') {
      opts.freeGb = takeNumber(argv, i, a, { min: 0 });
      i += 1;
    } else if (a === '--projects-dir' || a === '--sessions-dir' || a === '--register' || a === '--release') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) usage(`${a} takes a path`);
      opts[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
      i += 1;
    } else if (a === '--now') {
      opts.now = Date.parse(argv[(i += 1)] ?? '');
      if (Number.isNaN(opts.now)) usage('--now takes an ISO time');
    } else if (a === '-h' || a === '--help') usage('help');
    else if (a.startsWith('-') || file !== null) usage(`unexpected argument: ${a}`);
    else file = a;
  }
  const modes = [plan, watch, host].filter(Boolean).length;
  if (modes > 1) usage('--plan, --watch and --host are separate modes');
  if (host) {
    if (file !== null || transcripts) usage('--host takes no board; name it after --register or --release');
    if (opts.register && opts.release) usage('--register and --release are separate');
    try {
      return hostMain(opts);
    } catch (error) {
      usage(error.message.split('\n')[0]);
    }
  }
  if (opts.register || opts.release) usage('--register and --release go with --host');
  if (file === null) usage('name the board file');
  let board;
  let root;
  const boardPath = resolve(file);
  const load = () => {
    const b = parseBoard(readFileSync(boardPath, 'utf8'));
    return { b, r: mainCheckout(dirname(boardPath)) };
  };
  try {
    ({ b: board, r: root } = load());
  } catch (error) {
    usage(error.message.split('\n')[0]);
  }
  if (plan) {
    const files = zlist(git(root, ['ls-files', '-z']));
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
  const projectsDir = transcripts || watch ? resolve(opts.projectsDir || process.env.CLAUDE_PROJECTS_DIR || join(homedir(), '.claude', 'projects')) : null;
  const once = (b, r, now) => {
    const { out, active } = eventFindings(b, r, dirname(boardPath), { now, quietMin: opts.quietMin, projectsDir });
    for (const line of out) process.stdout.write(`${line}\n`);
    process.stdout.write(out.length ? `BOARD ${out.length} findings\n` : `BOARD OK ${active} workers\n`);
    return out.length;
  };
  if (!watch) return once(board, root, opts.now) ? 1 : 0;
  // watch: the board is read again at each check, so rows the controller adds are seen. A finding that
  // stood at the previous check (BEHIND before READY, a worker with no transcript, QUIET on a worker that
  // waits on the owner) does not end the watch; one that is new does.
  const started = Date.now();
  let checks = 0;
  let standing = {};
  let baselined = 0;
  for (;;) {
    let current = { b: board, r: root };
    if (checks > 0) {
      try {
        current = load();
      } catch (error) {
        usage(error.message.split('\n')[0]);
      }
    }
    checks += 1;
    const { out } = eventFindings(current.b, current.r, dirname(boardPath), { now: Date.now(), quietMin: opts.quietMin, projectsDir });
    const step = watchStep(standing, out);
    const fresh = step.fresh;
    if (checks === 1 && out.length) {
      baselined = out.length;
      process.stdout.write(`WATCH BASELINE ${out.length} standing findings\n`);
    }
    if (checks > 1 && fresh.length) {
      for (const line of fresh) process.stdout.write(`${line}\n`);
      process.stdout.write(`BOARD ${fresh.length} findings\n`);
      return 1;
    }
    standing = step.next;
    const left = opts.maxS * 1000 - (Date.now() - started);
    if (left <= 0) {
      process.stdout.write(baselined ? `WATCH END ${checks} checks, ${Object.keys(standing).length} still standing\n` : `WATCH END ${checks} checks, nothing found\n`);
      return 0;
    }
    await sleep(Math.min(opts.everyS * 1000, left));
  }
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
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (error) => {
    process.stderr.write(`board-check: ${String(error.message ?? error).split('\n')[0]}\n`);
    process.exitCode = 2;
  });
}
