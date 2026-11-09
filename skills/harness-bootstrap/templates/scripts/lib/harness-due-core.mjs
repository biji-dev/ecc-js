// harness-bootstrap harness-due core (generated YYYY-MM-DD). Pure core of scripts/harness-due.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- the mainline, where the log, the follow-ups doc, the registry, the state files and each
// kind's reports live, the phase in a row id, the cadences, the limits and what each line tells the
// runner to run, each re-derived from the project.
/**
 * Due-checks: what the harness owes before the next unit -- a phase's preflight, the owner's inputs
 * on the critical path, the background reports, the digest of what the standing grant decided and
 * what merged, a held unit grown too big to land in one piece -- from the repository's files and git
 * alone. No I/O here (scripts/harness-due.mjs reads them), so `harness-due-core.test.mjs` can pin
 * each rule.
 *
 * WHY A CHECK. Preflights and sweeps ran 13 times in two projects and caught real problems -- a
 * warning four sweeps running that then failed a phase's entry, fifteen open decisions -- but each
 * ran because someone asked: the owner asked six times, two sweeps ran overdue ("the weekly cadence
 * is enforced by nothing mechanical"), and one project's note that a sweep was due lived in a
 * session's memory only. A check the runner runs at every claim and every landing is the trigger
 * those runs lacked.
 *
 * WHY V10. The harness stops generating its own work inside a project. In v9 a due sweep, retro or
 * hygiene became the next unit, ahead of the next product row, and the P3 queue and the week's
 * proposals printed at every claim and land. Now they are reports written in the background
 * (`REPORT`), and the run's next unit is a product unit. The owner's inputs that block the critical
 * path print first (`OWED`), housekeeping (disk, worktrees) goes to the digest, and the digest is how
 * the owner reads what the standing grant decided; the valve (`HOLD`) stops new claims, never
 * merges, when the owner stops reading. A held unit past SPLIT_LINES production lines is a review
 * nobody can do well (`SPLIT`), and `ASK` names the card kinds the owner still answers.
 *
 * THE INBOX. A unit that reaches an owner gate does not hold the run: the runner parks it, its cards
 * go to its state file and its row moves from the registry's active table to the parked one. A held
 * row is what makes the commit guard refuse a mainline merge under SCOPE=repo, so a unit waiting on
 * the owner would stop every other unit; a parked row locks nothing. `inboxLines` lists the parked
 * rows, so the runner and the owner see what waits. It is not a check: it never blocks.
 */
import path from 'node:path';
import { ASK_DEFAULT, askKinds, isHarnessMerge, isHarnessUnit, logRecords, owedRows } from './retro-core.mjs';
import { isProduction, parseNumstat } from './review-gate-core.mjs';

// ---- [B] project bindings
// [B] The mainline; the harness log and the follow-ups doc. FOLLOW_UPS may also be a list of paths;
// an entry ending in `/*.md` is every markdown file in that directory, sorted by name.
export const MAIN = 'main';
export const LOG = 'docs/harness/log.md';
export const FOLLOW_UPS = 'docs/harness/follow-ups.md';
// [B] The commit guard's lock file, relative to the main checkout: its parked table is the owner's inbox.
export const REGISTRY = '.claude/registry.md';
// [B] Each kind's committed reports. The file name carries `<phase>`, `<date>` (YYYY-MM-DD) or
// `<week>` (YYYY-Www); a kind the project does not run is null and is never due.
export const REPORTS = {
  preflight: 'docs/harness/reports/preflight-<phase>.md',
  sweep: 'docs/harness/reports/sweep-<date>.md',
  retro: 'docs/harness/reports/retro-<week>.md',
  hygiene: 'docs/harness/reports/hygiene-<date>.md',
};
// [B] The phase a row id belongs to: a RegExp whose first group is the phase, or a function
// id -> phase | null. The function form is for a phase that is not a prefix of the id (a table
// bound here, for instance). An id the RegExp does not match, or the function gives null,
// belongs to no phase (P2-16 -> P2, EP-27.04 -> EP-27; T-DATA-037 and CR-021 -> none).
export const PHASE_OF = /^([A-Za-z]+-?\d+)[-.]\w/;
// [B] A recurring report is due this many days after the newest one, or once this many units
// have landed since it (null: by days only). The log moves them.
export const CADENCE = {
  sweep: { days: 7, landings: 5 },
  retro: { days: 7, landings: null },
  hygiene: { days: 14, landings: 5 },
};
// [B] Where the unit plans' state files live: every `*.state.md` directly in it, as MAIN holds it, feeds
// the ASK line and the digest (their `## Decisions` tables).
export const STATE_DIR = 'docs/plans';
// [B] An open follow-up whose cells say `Owner supplies:` or `Owner decides:` is OWED past this many days.
export const OWED_DAYS = 3;
// [B] The digest lists at most this many unread items, newest first.
export const DIGEST_LINES = 20;
// [B] The valve: more than VALVE_ITEMS unread digest items older than VALVE_DAYS hold new claims.
export const VALVE_ITEMS = 10;
export const VALVE_DAYS = 3;
// [B] A held unit's branch past this many production lines (added + deleted against MAIN, docs and
// tests aside, as review-gate-core's isProduction reads a path) is split.
export const SPLIT_LINES = 10000;
// [B] Below this much free disk (GB), the approved machine-sweep categories run.
export const DISK_MIN_GB = 25;
// [B] A worktree merged into MAIN, with commits of its own, clean, and untouched this many hours
// is residue.
export const WORKTREE_IDLE_HOURS = 6;
// [B] The ignored paths such a worktree may still hold: rebuildable output and litter. Any other
// ignored file -- a key, a hand-written .env.local -- keeps it, because `git worktree remove`
// deletes ignored files without a word. A link never counts: removing one never touches what it
// points to.
export const REBUILDABLE = /(^|\/)(node_modules|dist|build|out|coverage|test-results|playwright-report|\.next|\.turbo|\.expo|\.vite|\.cache|\.husky\/_)\/?$|\.DS_Store$|\.tsbuildinfo$/;
// [B] What each line tells the runner to run; `<phase>`, `<date>`, `<file>`, `<week>`, `<paths>` and
// `<unit>` are filled in. The defaults cite harness-bootstrap's references, which hold the
// procedures; bind each one to the project's own skill where the project generated one.
export const COMMANDS = {
  preflight: 'run the phase preflight for <phase> (harness-bootstrap\'s reference/preflight.md); its escalations are Gate 1 cards',
  sweep: 'write the sweep report in the background (a Sonnet runner, harness-bootstrap\'s reference/sweep.md); it rides in the next unit\'s land commit',
  retro: 'node scripts/retro.mjs in the background; the report rides in the next unit\'s land commit',
  hygiene: 'write the hygiene report in the background (harness-bootstrap\'s reference/hygiene.md); it rides in the next unit\'s land commit',
  disk: 'node ~/.agents/harness/machine-sweep/machine-sweep.mjs --apply-approved, in the background',
  worktrees: 'git worktree remove <paths>, each once no registry row names it',
  inbox: 'nothing to run, the run moves on to the next ready unit; the owner\'s answers resume <unit> through the runner (harness-bootstrap\'s reference/runner.md)',
};
// ---- end [B]

export const KINDS = ['preflight', 'sweep', 'retro', 'hygiene', 'disk', 'worktrees'];
// The cadence kinds print as REPORT lines, written in the background; the machine kinds go to the digest.
const REPORT_KINDS = ['sweep', 'retro', 'hygiene'];
const HOUSEKEEPING = ['disk', 'worktrees'];
const HOLD_COMMAND = 'read the digest, then node scripts/harness-due.mjs --digest-read';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const GB = 1e9;
// A row id names a branch's unit: plan ids, change slugs, harness/<slug>.
const ROW_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const WEEK_ID = /^\d{4}-W\d{2}$/;
// An id-like token of a merge subject, for a function PHASE_OF: a run of ROW_ID's characters except `/`
// (so `task/T001` is two tokens), with no `.`, `_` or `-` at its end (a sentence's full stop is not the id's).
const ID_TOKEN = /[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/g;
// a phase is whatever either form of PHASE_OF can give, so a name with no digit (DATA) is one
const PLACEHOLDERS = { phase: '([A-Za-z0-9][A-Za-z0-9_-]*)', date: '(\\d{4}-\\d{2}-\\d{2})', week: '(\\d{4}-W\\d{2})' };
const VALUE_FLAGS = { '--claim': 'claim', '--seen': 'seen', '--now': 'now', '--home': 'home' };
// A Branch cell's branch, as a revision git can take: no leading `-`, no space, no `..`.
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fill = (text, values) => Object.entries(values).reduce((t, [k, v]) => t.replaceAll(`<${k}>`, v), text);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Reject unknown flags, a bad id or week, and `--seen` or `--digest-read` with another mode, before anything is read. */
export function parseArgs(argv) {
  const a = { claim: null, seen: null, json: false, now: null, home: null, digestRead: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--digest-read') a.digestRead = true;
    else if (t in VALUE_FLAGS) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[VALUE_FLAGS[t]] = v;
    } else throw new Error(t.startsWith('--') ? `unknown option ${t}` : `unexpected argument "${t}"`);
  }
  if (a.claim !== null && !ROW_ID.test(a.claim)) throw new Error(`bad row id "${a.claim}"`);
  if (a.seen !== null && !WEEK_ID.test(a.seen)) throw new Error(`--seen takes a week, YYYY-Www, not "${a.seen}"`);
  if (a.seen !== null && a.claim !== null) throw new Error('--seen records a week and checks nothing; run it without --claim');
  if (a.digestRead && a.claim !== null) throw new Error('--digest-read records the read and checks nothing; run it without --claim');
  if (a.digestRead && a.seen !== null) throw new Error('pick one of --seen and --digest-read');
  if (a.now !== null && Number.isNaN(Date.parse(a.now))) throw new Error(`--now is not an ISO time: ${a.now}`);
  return a;
}

/** The phase a row id belongs to (a RegExp's first group, or a function's result), or null. */
export function phaseOf(id, pattern = PHASE_OF) {
  const trimmed = String(id ?? '').trim();
  if (typeof pattern === 'function') {
    const phase = pattern(trimmed);
    return typeof phase === 'string' && phase !== '' ? phase : null;
  }
  return pattern.exec(trimmed)?.[1] ?? null;
}

/** A report template -> its directory, its placeholder and a file-name pattern whose group is the placeholder's value. */
export function reportShape(template) {
  const dir = path.posix.dirname(template);
  const base = path.posix.basename(template);
  if (/[<>]/.test(dir)) throw new Error(`a report's placeholder belongs in its file name: ${template}`);
  const keys = [...base.matchAll(/<(\w+)>/g)].map((m) => m[1]);
  if (keys.length !== 1 || !(keys[0] in PLACEHOLDERS)) throw new Error(`a report's file name carries one of <phase>, <date>, <week>: ${template}`);
  const [head, tail] = base.split(`<${keys[0]}>`);
  return { dir, key: keys[0], pattern: new RegExp(`^${esc(head)}${PLACEHOLDERS[keys[0]]}${esc(tail)}$`, 'i') };
}

/** The file names in a report's directory that are its reports, as { rel, value }. */
export function matchReports(template, names) {
  const { dir, pattern } = reportShape(template);
  return names.flatMap((name) => {
    const m = pattern.exec(name);
    return m ? [{ rel: path.posix.join(dir, name), value: m[1] }] : [];
  });
}

/**
 * The claimed row's phase preflight. It blocks the claim when the row opens its phase -- no log
 * row and no mainline merge names the phase yet -- and the phase has no report. A phase already
 * under way without one is named, never blocked: a stop mid-phase fixes nothing.
 */
export function preflightDue({ claim, reports = [], logIds = [], merges = [], template = REPORTS.preflight, pattern = PHASE_OF, command = COMMANDS.preflight }) {
  if (claim === null || template === null) return null;
  const phase = phaseOf(claim, pattern);
  if (phase === null) return null;
  const want = path.posix.basename(template).replace('<phase>', phase).toLowerCase();
  if (reports.some((r) => path.posix.basename(r.rel).toLowerCase() === want)) return null;
  const rel = template.replace('<phase>', phase);
  const rows = logIds.filter((id) => phaseOf(id, pattern)?.toLowerCase() === phase.toLowerCase()).length;
  // a RegExp phase is named by `<phase>-x` or `<phase>.x`; a function's by an id-like token it gives the phase
  const mention = typeof pattern === 'function'
    ? (subject) => (subject.match(ID_TOKEN) ?? []).some((token) => phaseOf(token, pattern)?.toLowerCase() === phase.toLowerCase())
    : ((re) => (subject) => re.test(subject))(new RegExp(`\\b${esc(phase)}[-.]\\w`, 'i'));
  const merged = merges.filter(mention).length;
  const opens = rows === 0 && merged === 0;
  const why = opens
    ? `no report at ${rel}, and ${claim} opens the phase: the claim waits for it`
    : `no report at ${rel}, and the phase is under way (${plural(rows, 'log row')}, ${plural(merged, 'merge')})`;
  return { kind: 'preflight', subject: phase, why, command: fill(command, { phase }), blocking: opens };
}

/**
 * A recurring kind: due when its newest report is CADENCE days old, or CADENCE landings behind.
 * `reports` are { rel, time } (time: its last commit; a report no commit holds is never one); with none, the count
 * starts at `logBorn`, the log's first commit. A landing is a log row (`landed`, the commit time
 * of each row) or a mainline merge (`merged`, each merge's time), whichever counts more: a row the
 * log's table does not parse still merged.
 */
export function cadenceDue(kind, { reports = [], landed = [], merged = [], logBorn = null, now, cadence = CADENCE[kind], command = COMMANDS[kind] }) {
  const newest = reports.reduce((a, r) => (Number.isFinite(r.time) && (a === null || r.time > a.time) ? r : a), null);
  const from = newest?.time ?? logBorn;
  const values = { date: day(now) };
  if (!Number.isFinite(from)) {
    return { kind, subject: null, why: 'no report yet, and no log to count from', command: fill(command, values), blocking: false };
  }
  const days = Math.floor((now - from) / DAY);
  const after = (times) => times.filter((t) => Number.isFinite(t) && t > from).length;
  const landings = Math.max(after(landed), after(merged));
  const byCount = cadence.landings !== null && landings >= cadence.landings;
  if (days < cadence.days && !byCount) return null;
  const since = newest ? `since ${path.posix.basename(newest.rel)}` : 'since the log began, and no report yet';
  return { kind, subject: null, why: `${days} d, ${plural(landings, 'landing')} ${since}`, command: fill(command, values), blocking: false };
}

// isHarnessUnit and isHarnessMerge (retro-core): a `harness/<slug>` row id, a merge of a `harness/` branch. The
// cadences count product landings only: in one install seven of the first eight units were the
// harness's own, and a sweep and a hygiene unit came due a day in, counted on those.
export { isHarnessMerge, isHarnessUnit };

/**
 * The kinds the foundation stage holds: the cadences wait for the flip, since nothing has landed to
 * sweep or clean yet. The preflight and the machine checks still run.
 */
export function heldKinds(stage) {
  if (stage !== 'foundation') return [];
  return REPORT_KINDS.filter((k) => REPORTS[k] !== null);
}

/**
 * Free disk under DISK_MIN_GB: the approved machine-sweep categories run in the background. With
 * none approved the line says so -- approving one is the owner's, once. The last run's line, when
 * there is one, says what it freed.
 */
export function diskDue({ free, minGb = DISK_MIN_GB, approved = [], last = null, command = COMMANDS.disk }) {
  if (!Number.isFinite(free) || free >= minGb * GB) return null;
  const freed = last && Number.isFinite(last.freed) ? `; the last sweep (${String(last.t).slice(0, 10)}) freed ${(last.freed / GB).toFixed(1)} GB` : '';
  const why = `${(free / GB).toFixed(1)} GB free, under ${minGb}${freed}`;
  if (!approved.length) {
    return { kind: 'disk', subject: null, why: `${why}; no sweep category is approved`, command: 'the owner reads machine-sweep.mjs --report (the harness-bootstrap skill) and approves categories once', blocking: false };
  }
  return { kind: 'disk', subject: null, why: `${why}; approved: ${approved.join(', ')}`, command, blocking: false };
}

/** `git worktree list --porcelain` -> [{ path, head, branch, locked, prunable }], the main worktree first. */
export function parseWorktrees(text) {
  const out = [];
  for (const block of String(text ?? '').split(/\n\s*\n/)) {
    const w = { path: null, head: null, branch: null, bare: false, locked: false, prunable: false };
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ');
      const value = rest.join(' ');
      if (key === 'worktree') w.path = value;
      else if (key === 'HEAD') w.head = value;
      else if (key === 'branch') w.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'bare') w.bare = true;
      else if (key === 'locked') w.locked = true;
      else if (key === 'prunable') w.prunable = true;
    }
    if (w.path) out.push(w);
  }
  return out;
}

/**
 * The linked worktrees that are residue: merged into MAIN with commits of their own, no change
 * in them, no ignored file that is not REBUILDABLE, and untouched for WORKTREE_IDLE_HOURS. Each
 * comes with `merged`, `own`, `clean`, `ignored` (its ignored paths) and `active` (its last
 * activity, ms) as the CLI measured them; the main worktree, a locked one and a prunable one are
 * never residue, nor is one a registry row names (`named`, absolute paths: registryWorktrees). A row
 * and git may spell one checkout two ways, through a link: both sides are compared as `real` gives
 * them (the CLI's resolves links, as the guard's cd and pwd -P do; the identity here). The
 * rails are one project's, earned: a branch cut from the mainline and not yet started is an
 * ancestor of it too, hence `own`.
 */
export function worktreesDue({ worktrees = [], now, idleHours = WORKTREE_IDLE_HOURS, rebuildable = REBUILDABLE, top = null, named = [], real = (p) => p, command = COMMANDS.worktrees }) {
  const kept = new Set(named.map((p) => real(path.resolve(p))));
  const stale = worktrees
    .slice(1)
    .filter((w) => !w.bare && !w.locked && !w.prunable && w.merged && w.own && w.clean)
    .filter((w) => !kept.has(real(path.resolve(w.path))))
    .filter((w) => (w.ignored ?? []).every((p) => rebuildable.test(p)))
    .filter((w) => Number.isFinite(w.active) && now - w.active >= idleHours * HOUR);
  if (!stale.length) return null;
  const shown = stale.map((w) => (top && w.path.startsWith(`${top}/`) ? w.path.slice(top.length + 1) : w.path));
  const names = shown.length > 4 ? `${shown.slice(0, 4).join(', ')} and ${shown.length - 4} more` : shown.join(', ');
  return { kind: 'worktrees', subject: null, why: `${plural(stale.length, 'worktree')} merged into ${MAIN}, clean and idle over ${idleHours} h: ${names}`, command: fill(command, { paths: shown.join(' ') }), blocking: false };
}

/**
 * seen.json after `--seen <week>`: the project's week only moves forward. The retro's proposals print
 * in the weekly report only since v10; `--seen` stays, so a runner or a habit that still marks a week
 * read keeps working.
 */
export function markSeen(seen, project, week) {
  const out = { ...(seen && typeof seen === 'object' && !Array.isArray(seen) ? seen : {}) };
  if (!(typeof out[project] === 'string' && out[project] >= week)) out[project] = week;
  return out;
}

/** digest-read.json after `--digest-read`: this project's last read is `iso`; every other project's key is kept. */
export function markDigestRead(read, project, iso) {
  return { ...(read && typeof read === 'object' && !Array.isArray(read) ? read : {}), [project]: iso };
}

/** This project's last read (ms) in digest-read.json, or null: never read, or a value that is no time. */
export function lastReadOf(read, project) {
  const v = read && typeof read === 'object' && !Array.isArray(read) ? read[project] : undefined;
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** The project's name: the weekly job's registry entry for the main checkout, else its directory's name. */
export function projectName(registry, mainTop) {
  const entry = Array.isArray(registry?.repos) ? registry.repos.find((r) => r && r.path === mainTop) : null;
  return entry?.project ?? path.basename(mainTop);
}

// ---- the registry: its tables are read by header name, whatever the order or the extra columns
const SEPARATOR = /^\s*\|[\s:|-]*-[\s:|-]*$/;
const trimCell = (c) => c.replace(/^[\s`]+|[\s`]+$/g, '');
// a cell without its padding and backticks; `\|` is a pipe inside a cell
const cellsOf = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => trimCell(c.replace(/\\\|/g, '|')));
// the cells as the commit guard splits them: at every `|`, an escaped one too
const guardCellsOf = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(trimCell);

/**
 * The table between `<!-- harness:<name> -->` and `<!-- /harness:<name> -->`, read as the commit guard
 * reads its active one (harness-guard.sh's rows()), as { head, lines }. A marker is any line holding
 * it, and the begin marker's line is no row; every marked section counts, and one not closed runs to
 * the file's end. The header is the row right above the first |---| row inside, else the table header
 * right above the first begin marker (markers around the data rows only), lowercased and without a
 * trailing `(UTC)`-like note; every other row inside is data. A file without both markers, or a table
 * without a header, is no table: no column is named, and rows outside the markers are never read.
 */
function registryTable(text, name) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const [open, close] = [`<!-- harness:${name} -->`, `<!-- /harness:${name} -->`];
  if (!lines.some((l) => l.includes(open)) || !lines.some((l) => l.includes(close))) return null;
  const rows = [];
  let run = []; // the table rows right above the line at hand, until the first begin marker
  let above = null;
  let on = false;
  for (const line of lines) {
    const row = /^\s*\|/.test(line);
    if (line.includes(open)) {
      if (run && run.length > 1 && SEPARATOR.test(run.at(-1))) above = run.at(-2);
      run = null;
      on = true;
    } else if (on && line.includes(close)) on = false;
    else if (on && row) rows.push(line);
    else if (run && row) run.push(line);
    else if (run) run = [];
  }
  const at = rows.findIndex((l, i) => i + 1 < rows.length && SEPARATOR.test(rows[i + 1]));
  const header = at >= 0 ? rows[at] : above;
  if (header === null) return null;
  return {
    head: cellsOf(header).map((h) => h.replace(/\s*\(.*\)$/, '').toLowerCase()),
    lines: rows.filter((l, i) => i !== at && !SEPARATOR.test(l)),
  };
}

/**
 * The units parked at an owner gate, in table order, from the registry's parked table (Unit, Gate,
 * Parked (UTC), Branch, Worktree, Cards): [{ unit, gate, parked, branch, worktree, cards, command }].
 * A row with no unit is skipped, an empty cell is ''; no table, or one with no Unit column, is [].
 */
export function parkedUnits(registryText, command = COMMANDS.inbox) {
  const table = registryTable(registryText, 'parked');
  const unit = table ? table.head.indexOf('unit') : -1;
  if (unit === -1) return [];
  return table.lines
    .map(cellsOf)
    .filter((row) => (row[unit] ?? '') !== '')
    .map((row) => {
      const cell = (name) => row[table.head.indexOf(name)] ?? '';
      return { unit: row[unit], gate: cell('gate'), parked: cell('parked'), branch: cell('branch'), worktree: cell('worktree'), cards: cell('cards'), command: fill(command, { unit: row[unit] }) };
    });
}

/** One line per parked unit, `INBOX <unit> <gate> since <Parked> · <Cards>`; a cell that is empty leaves its words out. */
export function inboxLines(registryText) {
  return parkedUnits(registryText).map((p) => `INBOX ${p.unit}${p.gate ? ` ${p.gate}` : ''}${p.parked ? ` since ${p.parked}` : ''}${p.cards ? ` · ${p.cards}` : ''}`);
}

/**
 * The linked worktrees the registry's rows name, as absolute paths from `root` (the main checkout):
 * every held row of the active table (first cell 1 or more, its spaces aside) and every parked row. A
 * Worktree cell's first word is the path; empty, `main`, `.` and a placeholder (-, n/a, none) name the
 * main checkout. Over-reading is safe and under-reading is not: every Worktree column counts, and each
 * row is also split at every `|`, as the guard splits it, so a path either reading names is kept.
 */
export function registryWorktrees(registryText, root) {
  if (typeof root !== 'string' || root === '') return [];
  const out = new Set();
  for (const [name, held] of [['active', (row) => /^[1-9]\d*$/.test((row[0] ?? '').replace(/\s/g, ''))], ['parked', () => true]]) {
    const table = registryTable(registryText, name);
    const columns = table ? table.head.flatMap((h, i) => (h === 'worktree' ? [i] : [])) : [];
    for (const row of columns.length ? table.lines.flatMap((l) => [cellsOf(l), guardCellsOf(l)]).filter(held) : []) {
      for (const w of columns) {
        const cell = (row[w] ?? '').replaceAll('`', '').trim().split(/\s/)[0].split('·')[0];
        if (!['', 'main', '.', '-', '—', 'n/a', 'none'].includes(cell.toLowerCase())) out.add(path.resolve(root, cell));
      }
    }
  }
  return [...out];
}

/**
 * The held rows of the registry's active table (first cell 1 or more) whose Branch cell names a
 * branch, as [{ unit, branch }] in table order: the Branch cell's first word, backticks dropped; an
 * empty cell, a placeholder or a word git could read as an option names none. Whether the branch is
 * a local one is the CLI's question (`git rev-parse --verify refs/heads/<branch>`).
 */
export function heldBranches(registryText) {
  const table = registryTable(registryText, 'active');
  const [unit, branch] = table ? ['unit', 'branch'].map((h) => table.head.indexOf(h)) : [-1, -1];
  if (branch === -1) return [];
  return table.lines
    .map(cellsOf)
    .filter((row) => /^[1-9]\d*$/.test(String(row[0] ?? '').replace(/\s/g, '')))
    .flatMap((row) => {
      const name = (row[branch] ?? '').replaceAll('`', '').trim().split(/\s/)[0];
      return BRANCH.test(name) ? [{ unit: (unit === -1 ? '' : row[unit]) || name, branch: name }] : [];
    });
}

/**
 * Every check, in KINDS order, from what the CLI read: `log` and `followUps` as { text, dates }
 * (line -> commit ms) or null; `reports` by kind as [{ rel, time }]; `merges` the mainline's
 * merges as [{ t, subject }]; `disk` { free, approved, last }; `worktrees` measured; `registry`
 * { text, root, real } (the registry's text, the main checkout and a path's real path, the identity
 * when absent) or null; `stage`, the manifest's (heldKinds). Nothing here reads a file.
 */
export function checkAll(f) {
  const now = f.now;
  const records = f.log ? logRecords(f.log.text, f.log.dates) : [];
  const logBorn = f.log ? [...f.log.dates.values()].reduce((a, t) => (Number.isFinite(t) && (a === null || t < a) ? t : a), null) : null;
  const landed = records.filter((r) => !isHarnessUnit(r.id)).map((r) => r.landed);
  const merged = (f.merges ?? []).filter((m) => !isHarnessMerge(m.subject)).map((m) => m.t);
  const reports = (kind) => f.reports?.[kind] ?? [];
  const held = new Set(heldKinds(f.stage ?? null));
  const items = [
    preflightDue({ claim: f.claim ?? null, reports: reports('preflight'), logIds: records.map((r) => r.id), merges: (f.merges ?? []).map((m) => m.subject) }),
    ...REPORT_KINDS.map((kind) => (REPORTS[kind] === null || held.has(kind) ? null : cadenceDue(kind, { reports: reports(kind), landed, merged, logBorn, now }))),
    f.disk ? diskDue(f.disk) : null,
    worktreesDue({ worktrees: f.worktrees ?? [], now, top: f.top ?? null, named: registryWorktrees(f.registry?.text, f.registry?.root), real: f.registry?.real }),
  ];
  return items.filter(Boolean);
}

/**
 * What the owner owes on the critical path: the open follow-up rows whose cells say `Owner supplies:`
 * or `Owner decides:` (retro-core's owedRows, so open means what followUpsSummary counts as open), aged
 * from the row's filing date, else its line's commit, past `days` -> [{ id, since, what }], oldest first,
 * `what` on one line and at most 80 characters. An undated row (a line not committed yet) is not owed
 * yet. `opts` are owedRows' (the follow-ups doc's shape; the [B] bindings by default).
 */
export function owedItems(followUpsText, lineDates = new Map(), now = Date.now(), { days = OWED_DAYS, ...opts } = {}) {
  return owedRows(followUpsText, lineDates, opts)
    .filter((r) => Number.isFinite(r.at) && now - r.at > days * DAY)
    .map((r) => ({ id: r.id, since: day(r.at), what: clip(oneLine(r.what), 80) }));
}

// A decision row's time: its line's commit (blame, as follow-ups are dated), else the end of its Date
// day (a row dated today is not read by a read earlier today), else unknown.
const rowTime = (r, rowTimes) => {
  const t = rowTimes?.get?.(`${r.unit}/${r.id}`);
  if (Number.isFinite(t)) return t;
  const d = r.date === null || r.date === undefined ? NaN : Date.parse(`${r.date}T00:00:00Z`);
  return Number.isFinite(d) ? d + DAY - 1 : null;
};

/**
 * The digest: what the standing grant decided and what merged since the owner last read it. Unread
 * items are the `By: grant` and `By: default` decision rows (retro-core's decisionRows) and the log
 * records landed after `lastRead` (ms, or null: never read, so every one is unread); a row whose time
 * is unknown is unread. -> { unread, lines, holdCount }: `lines` is the block, a header, the newest
 * `max` items (unknown times last) and `… <k> more`, then one line per housekeeping item (the disk and
 * worktrees checks), which is never unread; `holdCount` is how many unread items are older than
 * `olderDays`, an unknown time never among them (the valve).
 */
export function digest({ rows = [], rowTimes = new Map(), records = [], lastRead = null, now, housekeeping = [], max = DIGEST_LINES, olderDays = VALVE_DAYS }) {
  const after = (t) => lastRead === null || t === null || t > lastRead;
  const decided = rows
    .filter((r) => r.by === 'grant' || r.by === 'default')
    .map((r) => ({ r, time: rowTime(r, rowTimes) }))
    .filter(({ time }) => after(time))
    .map(({ r, time }) => ({ time, text: `DIGEST ${r.unit ?? '?'}/${r.id} ${r.date ?? (time === null ? '?' : day(time))} · ${clip(oneLine(r.decision), 80)} · reversal: ${oneLine(r.cost) || '?'}` }));
  const merged = records
    .filter((r) => Number.isFinite(r.landed) && after(r.landed))
    .map((r) => ({ time: r.landed, text: `DIGEST merged ${r.id} ${day(r.landed)}` }));
  // newest first, unknown times last; equal times keep their order
  const items = [...decided, ...merged].sort((x, y) => (x.time === y.time ? 0 : x.time === null ? 1 : y.time === null ? -1 : y.time - x.time));
  const n = items.length;
  const lines = [
    `DIGEST ${n} unread since ${lastRead === null ? 'never' : new Date(lastRead).toISOString()}`,
    ...items.slice(0, max).map((i) => i.text),
    ...(n > max ? [`… ${n - max} more`] : []),
    ...housekeeping.map((h) => `DIGEST ${h.kind} — ${h.why} — ${h.command}`),
  ];
  return { unread: n, lines, holdCount: items.filter((i) => i.time !== null && now - i.time > olderDays * DAY).length };
}

/**
 * The valve: more than `items` unread digest items older than VALVE_DAYS hold new claims -- a HOLD
 * line, blocking only for a run given `--claim` (`claim`, its row id). It never stops a merge or a
 * run already under way: the owner who stopped reading is asked to read, not the work to stop.
 */
export function valve(d, { claim = null, items = VALVE_ITEMS, days = VALVE_DAYS } = {}) {
  if (!d || d.holdCount <= items) return null;
  return {
    kind: 'hold',
    count: d.holdCount,
    why: `${d.holdCount} digest items unread for over ${days} days`,
    command: HOLD_COMMAND,
    blocking: Boolean(claim),
  };
}

/**
 * Each held unit past the cap: `list` is [{ unit, branch, numstat }] (`git diff --numstat --no-renames
 * MAIN...<branch>`), and its production lines are the added and deleted lines of the paths `production`
 * accepts (review-gate-core's isProduction: no docs, no tests) -> [{ unit, branch, lines, cap }].
 */
export function splitItems(list = [], { cap = SPLIT_LINES, production = isProduction } = {}) {
  return list.flatMap(({ unit, branch, numstat }) => {
    const n = parseNumstat(numstat ?? '')
      .filter((f) => production(f.path))
      .reduce((a, f) => a + f.lines, 0);
    return n > cap ? [{ unit, branch, lines: n, cap }] : [];
  });
}

/** askKinds' result (retro-core) -> `ASK <kinds> — default` or `ASK <kinds> — demoted: code 3/20, …`. */
export function askLine(r) {
  const ask = r?.ask ?? ASK_DEFAULT;
  const demoted = r?.demoted ?? [];
  return `ASK ${ask.join(', ')} — ${demoted.length ? `demoted: ${demoted.map((x) => `${x.kind} ${x.reversed}/${x.of}`).join(', ')}` : 'default'}`;
}

/**
 * Every part of the report from what the CLI read: checkAll's facts and `decisions` (every state
 * file's decision rows at MAIN), `rowTimes` (`<unit>/<id>` -> the row's commit ms), `lastRead` (ms or
 * null), `splits` ([{ unit, branch, numstat }], the held rows' branches). -> { items, owed, split,
 * ask, digest, hold, held }, as formatDue takes them (the inbox aside: the CLI reads it).
 */
export function dueParts(f) {
  const items = checkAll(f);
  const rows = f.decisions ?? [];
  const d = digest({
    rows,
    rowTimes: f.rowTimes ?? new Map(),
    records: f.log ? logRecords(f.log.text, f.log.dates) : [],
    lastRead: f.lastRead ?? null,
    now: f.now,
    housekeeping: items.filter((i) => HOUSEKEEPING.includes(i.kind)),
  });
  return {
    items,
    owed: f.followUps ? owedItems(f.followUps.text, f.followUps.dates, f.now) : [],
    split: splitItems(f.splits ?? []),
    ask: askKinds(rows),
    digest: d,
    hold: valve(d, { claim: f.claim ?? null }),
    held: heldKinds(f.stage ?? null),
  };
}

/**
 * The report, in C7's order: `OWED` lines, the inbox lines (inboxLines), `HOLD`, `SPLIT` lines, `DUE`
 * lines (the preflight), `REPORT` lines (the cadences), then the all-clear when there is no HOLD,
 * SPLIT, DUE or REPORT line, the `HELD` line of the foundation stage (heldKinds), the `ASK` line and
 * the digest block. The disk and worktrees items print in the digest only. A part not given prints
 * nothing.
 */
export function formatDue({ items = [], owed = [], inbox = [], hold = null, split = [], ask = null, digest: d = null, held = [] } = {}) {
  const due = items.filter((i) => !REPORT_KINDS.includes(i.kind) && !HOUSEKEEPING.includes(i.kind));
  const reports = items.filter((i) => REPORT_KINDS.includes(i.kind));
  const lines = [
    ...owed.map((o) => `OWED ${o.id} since ${o.since} — ${o.what}`),
    ...inbox,
    ...(hold ? [`HOLD claims — ${hold.why} — ${hold.command}`] : []),
    ...split.map((s) => `SPLIT ${s.unit} — ${s.lines} production lines past the ${s.cap}-line cap — land the green slices (flag-off where unfinished); the rest is the next unit`),
    ...due.map((i) => `DUE ${i.kind}${i.subject ? ` ${i.subject}` : ''} — ${i.why} — ${i.command}`),
    ...reports.map((i) => `REPORT ${i.kind} — ${i.why} — ${i.command}`),
  ];
  if (!hold && !split.length && !due.length && !reports.length) lines.push('harness-due: nothing due');
  if (held.length) lines.push(`HELD ${held.join(', ')} — foundation stage — they wait for the flip`);
  if (ask) lines.push(askLine(ask));
  if (d) lines.push(...d.lines);
  return lines.map((l) => `${l}\n`).join('');
}
