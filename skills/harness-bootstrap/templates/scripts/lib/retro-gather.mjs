// harness-bootstrap retro gather (generated YYYY-MM-DD). The I/O half of scripts/retro.mjs.
// [M] mechanism (ships as-is): everything. The paths come in as arguments: retro-core's [B] block for
// retro.mjs, a repository's manifest for the skill's weekly job (scripts/retro-weekly.mjs).
/**
 * Reads what retro-core turns into a digest: the log and the follow-ups doc with each line's commit
 * time (git blame), the state and steps files, earlier digests and exports, the Claude Code
 * transcripts and a Codex host's threads that ran in the repository or one of its worktrees, and the
 * two run ledgers, codex-run's and claude-run's. Read-only: it never writes, and its git is `blame`,
 * `log`, `rev-parse` and `worktree list`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { markerUnits, previousData } from './retro-core.mjs';
import {
  CLAUDE_LEDGER_DIR,
  codexProjectSessions,
  codexSessionsDir,
  defaultLedger,
  fileLines,
  gitRead,
  projectSessions,
  worktreePaths,
} from './run-sources.mjs';
import { parseCodexSession, parseEvents, parseLedger, parseTranscript } from './unit-cost-core.mjs';
import { parseSteps } from './unit-step-core.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', '.worktrees', 'dist', 'build', 'coverage']);
const MAX_DEPTH = 6;

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`cannot read ${file}: ${e.code ?? e.message}`, { cause: e });
  }
}

/** The repository's top level, or a thrown error outside one. */
export function repoTop(cwd) {
  try {
    return gitRead(['rev-parse', '--show-toplevel'], cwd).trim();
  } catch (e) {
    throw new Error('not inside a git repository', { cause: e });
  }
}

/**
 * line -> the commit time (ms) of the commit that last changed it, or null for a line not committed
 * yet (git blames it on the zero commit, with the time of the blame); empty when git cannot blame the file.
 */
export function blameDates(top, rel) {
  let out;
  try {
    out = gitRead(['blame', '--line-porcelain', '--', rel], top);
  } catch {
    return new Map();
  }
  const dates = new Map();
  let time = null;
  let committed = true;
  for (const line of out.split('\n')) {
    const head = /^([0-9a-f]{40,64}) \d+ \d+/.exec(line);
    if (head) committed = /[^0]/.test(head[1]);
    else if (line.startsWith('committer-time ')) time = Number(line.slice('committer-time '.length)) * 1000;
    else if (line.startsWith('\t')) dates.set(dates.size + 1, committed ? time : null);
  }
  return dates;
}

/**
 * The follow-ups doc(s) -> { text, dates }, or null when no file exists. `specs` is one path or a list
 * (relative to `top`); an entry ending in `/*.md` is every markdown file in that directory, sorted by
 * name, and a missing file or directory is skipped. The texts, each without its trailing newline, are
 * joined by one blank line, and `dates.get(line)` is the commit time of that line in its own file.
 * A file is blamed once, on the first lookup of one of its lines, so a doc of many files is blamed
 * only where an open row needs a date.
 */
export function readFollowUps(top, specs, blame = blameDates) {
  const rels = [];
  for (const spec of [specs].flat()) {
    if (!spec.endsWith('/*.md')) {
      rels.push(spec);
      continue;
    }
    const dir = spec.slice(0, -'/*.md'.length);
    let names = [];
    try {
      names = fs.readdirSync(path.join(top, dir)).filter((n) => n.endsWith('.md')).sort();
    } catch {
      // a missing directory holds nothing
    }
    for (const n of names) rels.push(`${dir}/${n}`);
  }
  const files = [];
  let next = 1;
  for (const rel of rels) {
    const file = path.join(top, rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const text = readText(file).replace(/\r?\n$/, '');
    const lines = text.split('\n').length;
    files.push({ rel, text, start: next, lines, blamed: null });
    next += lines + 1;
  }
  if (files.length === 0) return null;
  const dates = {
    get(line) {
      const f = files.findLast((x) => x.start <= line);
      if (!f || line >= f.start + f.lines) return undefined;
      f.blamed ??= blame(top, f.rel);
      return f.blamed.get(line - f.start + 1);
    },
  };
  return { text: files.map((f) => f.text).join('\n\n'), dates };
}

/** path (relative to top) -> the newest commit time (ms) that touched it, for every file under `dirs`. */
export function lastCommitTimes(top, dirs) {
  let out;
  try {
    out = gitRead(['log', '--format=%x00%ct', '--name-only', '--', ...dirs], top);
  } catch {
    return new Map();
  }
  const times = new Map();
  let t = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('\0')) t = Number(line.slice(1)) * 1000;
    else if (line && !times.has(line)) times.set(line, t);
  }
  return times;
}

/** Files under `dir` whose name ends with one of `suffixes`, skipping dependency and build trees. */
export function findFiles(dir, suffixes, depth = 0, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && depth < MAX_DEPTH) findFiles(p, suffixes, depth + 1, out);
    } else if (suffixes.some((s) => e.name.endsWith(s))) out.push(p);
  }
  return out.sort();
}

/** Earlier digests (`retro-*.md`, their data block) and exports (`retro-*.json`) in `dirs`, as previousData records. */
export function readPrevious(dirs) {
  const out = [];
  for (const dir of dirs) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((n) => /^retro-\d{4}-W\d{2}\.(?:md|json)$/.test(n)).sort()) {
      const d = previousData(readText(path.join(dir, name)));
      if (d && !out.some((p) => p.week === d.week)) out.push(d);
    }
  }
  return out;
}

/**
 * A steps file's markers into `steps` (unit -> markers): each under its own unit (`harness/x` sits in
 * `harness/x.steps.jsonl`), one with none under `fallback`, the file's path under its plans dir.
 */
function addSteps(steps, markers, fallback) {
  if (markers.length === 0 && !steps.has(fallback)) steps.set(fallback, []);
  for (const m of markers) {
    const unit = m.unit || fallback;
    if (!steps.has(unit)) steps.set(unit, []);
    steps.get(unit).push(m);
  }
}

/**
 * Everything retro-core's buildRetro reads, but `previous`. `log`, `followUps` (a path or a list, see
 * readFollowUps) and `plansDirs` are relative to `top`; a missing follow-ups doc is null, a missing log is an error, and `log: null` (a
 * repository the weekly job reads that keeps none) is an empty one. Transcripts are the sessions of
 * `top` and its worktrees whose main file changed since `sinceMs`, and so are a Codex host's threads
 * (rollouts under `codexDir`, streamed: one can pass 512 MB).
 */
export function gather({ top, log, followUps = null, plansDirs = [], projectsDir, codexDir = codexSessionsDir(), ledger = null, claudeLedger = null, sinceMs = 0 }) {
  const logFile = log === null ? null : path.join(top, log);
  if (logFile !== null && !fs.existsSync(logFile)) throw new Error(`no harness log at ${log}`);
  const g = {
    log: logFile === null ? { text: '', dates: new Map() } : { text: readText(logFile), dates: blameDates(top, log) },
    followUps: followUps ? readFollowUps(top, followUps) : null,
    states: [],
    steps: new Map(),
    rows: [],
    events: [],
    sessionUnits: new Map(),
    sessions: 0,
    ledger: null,
    codex: [],
    claudeRuns: null,
  };
  const dirs = plansDirs.filter((d) => fs.existsSync(path.join(top, d)));
  const changed = lastCommitTimes(top, dirs);
  for (const dir of dirs) {
    for (const file of findFiles(path.join(top, dir), ['.state.md', '.steps.jsonl'])) {
      const rel = path.relative(top, file).split(path.sep).join('/');
      if (file.endsWith('.state.md')) {
        g.states.push({ path: rel, text: readText(file), changed: changed.get(rel) ?? fs.statSync(file).mtimeMs });
        continue;
      }
      addSteps(g.steps, parseSteps(readText(file)), path.relative(path.join(top, dir), file).split(path.sep).join('/').replace(/\.steps\.jsonl$/, ''));
    }
  }
  const roots = worktreePaths(top);
  for (const { id, files } of projectSessions(projectsDir, roots, sinceMs)) {
    g.sessions += 1;
    for (const { file, ctx } of files) {
      const text = readText(file);
      for (const r of parseTranscript(text, ctx)) g.rows.push(r); // a loop: a long session overflows a spread
      if (ctx.kind !== 'main') continue;
      for (const e of parseEvents(text)) g.events.push(e);
      const units = markerUnits(text);
      if (units.size) g.sessionUnits.set(id, units);
    }
  }
  for (const { file } of codexProjectSessions(codexDir, roots, sinceMs)) g.codex.push(parseCodexSession(fileLines(file)));
  const ledgerFile = ledger ?? defaultLedger(top);
  if (fs.existsSync(ledgerFile)) g.ledger = parseLedger(readText(ledgerFile));
  const claudeFile = claudeLedger ?? defaultLedger(top, CLAUDE_LEDGER_DIR);
  if (fs.existsSync(claudeFile)) g.claudeRuns = parseLedger(readText(claudeFile));
  return g;
}
