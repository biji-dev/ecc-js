// harness-bootstrap retro gather (generated YYYY-MM-DD). The I/O half of scripts/retro.mjs.
// [M] mechanism (ships as-is): everything. The paths come in as arguments: retro-core's [B] block for
// retro.mjs, a repository's manifest for the skill's weekly job (scripts/retro-weekly.mjs).
/**
 * Reads what retro-core turns into a digest: the log and the follow-ups doc with each line's commit
 * time (git blame), the state and steps files, earlier digests and exports, the Claude Code
 * transcripts and a Codex host's threads that ran in the repository or one of its worktrees, and the
 * two run ledgers, codex-run's and claude-run's, and the mainline's merges and fix commits around the
 * window (the files each changed), so a granted decision can be linked to a fix on its unit's files.
 * Read-only: it never writes, and its git is `blame`, `log`, `diff`, `diff-tree`, `rev-parse` and
 * `worktree list`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MAIN } from './harness-due-core.mjs'; // the one [B] binding of the mainline (retro-core binds none)
import { DEFECT_DAYS, FIX_SUBJECT, contextCommands, markerUnits, mergedBranch, previousData } from './retro-core.mjs';
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
 * Whitespace-only changes are not changes (`-w`: a formatter's re-pad of a table keeps its rows' dates),
 * and the commits in `.git-blame-ignore-revs`, when the repository has that file, are looked past (a
 * commit that repairs the log's columns). A file git refuses (a line in it is no commit id) is not used.
 * The retro reads only the repository's own `.git-blame-ignore-revs`, whatever `blame.ignoreRevsFile` a
 * machine's git config names (a named file that is missing would stop blame): `--no-ignore-revs-file` clears
 * the list the config built, and the repository's file is added after it.
 */
export function blameDates(top, rel) {
  const base = ['blame', '-w', '--line-porcelain', '--no-ignore-revs-file'];
  let out;
  try {
    const ignore = path.join(top, '.git-blame-ignore-revs');
    const listed = fs.existsSync(ignore) && fs.statSync(ignore).isFile();
    try {
      out = gitRead([...base, ...(listed ? ['--ignore-revs-file', '.git-blame-ignore-revs'] : []), '--', rel], top);
    } catch (e) {
      if (!listed) throw e;
      out = gitRead([...base, '--', rel], top); // one bad line there must not undate the whole log
    }
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

/**
 * path (relative to top) -> the newest commit time (ms) that changed it, for every file under `dirs`.
 * A pure move (`git mv`, R100: same content, new path) is not a change: the new path takes the time of
 * what the old path was last changed at, so a state file archived this week does not read as edited this
 * week. A path moved to two places keeps its time at both. A rename with edits is a change at its own time.
 */
export function lastCommitTimes(top, dirs) {
  let out;
  try {
    out = gitRead(['log', '-z', '-M', '--format=%x01%ct', '--name-status', '--', ...dirs], top);
  } catch {
    return new Map();
  }
  // Newest first. `-z` gives NUL-separated tokens: `\x01<ct>`, then per file a status (the first one
  // after a commit time starts with a newline) and one path, or two (old, new) for an R or C status.
  const times = new Map();
  const moved = new Map(); // old path -> the paths it was moved to by pure moves
  const take = (file, t, seen = new Set()) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!times.has(file)) times.set(file, t);
    for (const to of moved.get(file) ?? []) take(to, t, seen);
  };
  const tokens = out.split('\0');
  let t = null;
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i].replace(/^\n/, '');
    if (status.startsWith('\x01')) {
      t = Number(status.slice(1)) * 1000;
      continue;
    }
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      const [from, to] = [tokens[i + 1], tokens[i + 2]];
      i += 2;
      if (status === 'R100') {
        if (!moved.has(from)) moved.set(from, []);
        moved.get(from).push(to);
      } else {
        take(to, t);
      }
    } else {
      take(tokens[i + 1], t);
      i += 1;
    }
  }
  return times;
}

const DAY = 86_400_000;

/** The paths a commit changed against its first parent (a root commit: against nothing); none when git cannot say. */
function changedFiles(top, sha) {
  const lines = (out) => out.split('\n').filter(Boolean);
  try {
    return lines(gitRead(['diff', '--name-only', '--no-renames', `${sha}^1`, sha], top));
  } catch {
    try {
      return lines(gitRead(['diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '-r', sha], top));
    } catch {
      return [];
    }
  }
}

/**
 * The mainline's first-parent history from DEFECT_DAYS before `sinceMs` to `untilMs` (committer time):
 * { merges: [{ sha, unit, t, seq, subject, files }], fixes: [{ sha, t, seq, subject, files }], note? }.
 * It is read from MAIN, not from HEAD: run from a unit's linked worktree, HEAD is the unit's branch and
 * the repairs that landed on the mainline since would be missed. When MAIN does not exist (a repository
 * whose mainline has another name), HEAD is read and `note` says so; an explicit `ref` is used as given.
 * `seq` is the commit's place in the window's `git log --first-parent` order, larger = later, for
 * ordering commits that share a second. A merge's unit is the branch its subject names (mergedBranch;
 * null when it names none) and its files those the merge changed on the mainline (`git diff
 * <merge>^1 <merge>`); a fix is a single-parent commit whose subject is a revert or a conventional fix
 * (FIX_SUBJECT). The extra days are there so a fix early in the window finds the merge it repairs;
 * nothing older is read. Empty lists when git cannot read the history.
 */
export function mainlineHistory(top, { sinceMs, untilMs, ref = null }) {
  const out = { merges: [], fixes: [] };
  let note = null;
  let from = ref;
  if (from === null) {
    try {
      gitRead(['rev-parse', '--verify', '--quiet', `${MAIN}^{commit}`], top);
      from = MAIN;
    } catch {
      from = 'HEAD';
      note = `no ${MAIN} branch: the mainline history was read from HEAD`;
    }
  }
  let log;
  try {
    const since = new Date(sinceMs - DEFECT_DAYS * DAY).toISOString();
    const until = new Date(untilMs).toISOString();
    log = gitRead(['log', '--first-parent', '--no-color', `--since=${since}`, `--until=${until}`, '--format=%x1e%H%x1f%ct%x1f%P%x1f%s', from, '--'], top);
  } catch {
    return out;
  }
  const records = log.split('\x1e').filter((rec) => rec.trim() !== '');
  records.forEach((rec, i) => {
    const [sha, ct, parents, subject = ''] = rec.replace(/\n+$/, '').split('\x1f');
    if (!/^[0-9a-f]{40,64}$/.test(sha ?? '')) return;
    const t = Number(ct) * 1000;
    const seq = records.length - 1 - i; // newest first in the log: the first record is the latest
    if (String(parents).trim().split(/\s+/).length > 1) out.merges.push({ sha, unit: mergedBranch(subject), t, seq, subject, files: changedFiles(top, sha) });
    else if (FIX_SUBJECT.test(subject)) out.fixes.push({ sha, t, seq, subject, files: changedFiles(top, sha) });
  });
  if (note !== null) out.note = note;
  return out;
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
 * `top` and its worktrees whose main file changed since `sinceMs` (a main thread's events and its typed
 * /clear and /compact commands carry the session's id), and so are a Codex host's threads
 * (rollouts under `codexDir`, streamed: one can pass 512 MB). With `history` ({ sinceMs, untilMs }, the
 * window), the mainline's merges and fixes around it (mainlineHistory, whose `note` rides along on a
 * fallback to HEAD); without it, `merges` and `fixes`
 * are null, so the digest says the git figures were not read rather than zero.
 */
export function gather({ top, log, followUps = null, plansDirs = [], projectsDir, codexDir = codexSessionsDir(), ledger = null, claudeLedger = null, sinceMs = 0, history = null }) {
  const logFile = log === null ? null : path.join(top, log);
  if (logFile !== null && !fs.existsSync(logFile)) throw new Error(`no harness log at ${log}`);
  const g = {
    log: logFile === null ? { text: '', dates: new Map() } : { text: readText(logFile), dates: blameDates(top, log) },
    followUps: followUps ? readFollowUps(top, followUps) : null,
    states: [],
    steps: new Map(),
    rows: [],
    events: [],
    commands: [],
    sessionUnits: new Map(),
    sessions: 0,
    ledger: null,
    codex: [],
    claudeRuns: null,
    merges: null,
    fixes: null,
  };
  if (history) Object.assign(g, mainlineHistory(top, history));
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
      for (const e of parseEvents(text)) g.events.push({ ...e, session: id }); // a run ends with its own session's records
      for (const c of contextCommands(text)) g.commands.push({ ...c, session: id });
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
