// harness-bootstrap retro core (generated YYYY-MM-DD). Pure core of scripts/retro.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- where the digests, the log, the follow-ups doc and the plans live, the log columns the
// retro adds, the outlier rule, the alert levels and the step words, each re-derived from the project.
/**
 * The retro: what the last week of units cost and where it went, and how much the owner had to touch
 * the sessions, against the four weeks before it, from the harness log, the steps and state files, the
 * follow-ups doc, the transcripts, a Codex host's threads and the two run ledgers, codex-run's and
 * claude-run's. No I/O here (scripts/lib/retro-gather.mjs reads the files), so `retro-core.test.mjs` can
 * pin each rule.
 *
 * WHY A DIGEST. Every harness round so far started because the owner asked: the learning loop was
 * the owner's memory. Transcripts expire after 21 days, and an observer that kept 209 MB of
 * observations produced no instinct. A short committed digest -- a few numbers against their own
 * history, the outliers, the repeated friction and at most five candidates -- is what a reviewer, or
 * the next round, can read in one pass.
 *
 * WHAT V10 ADDED. The standing grant lets the agent take the recommendation on reversible cards, and
 * each card kind the owner still answers is asked because a rule says so, not because anyone measured
 * it. So the retro now reads the decision rows themselves: which kinds are still asked (askKinds), and a
 * kind the owner took the recommendation on 90% of the last 20 times is proposed for the grant
 * (promotions) -- the rule measured on the owner's own answers. A kind the grant covers comes back to
 * the owner when more than one in ten of its granted decisions was reversed. Agreement is not
 * correctness, though: an owner who would have said yes to a wrong default agrees with it. So each
 * granted decision is also linked to what happened after its unit merged -- a reversal, or a fix within
 * seven days on the merge's files (decisionOutcomes) -- and the linked ones are listed for the owner to
 * judge, never counted as proof. The week's original plan rows, the owner wait per landed row, the
 * oldest thing owed to the owner and an escaped-defect proxy sit beside them.
 */
import { fmtMinutes, groupUnits, leftOutRows, leftOutWarning, parseLog, percentile, tables } from './estimate-core.mjs';
import {
  dedupeRows,
  fmtTokens,
  inWindow,
  isOwnerPrompt,
  parseTag,
  summarizeCache,
  summarizeClaude,
  summarizeClaudeRuns,
  summarizeCodexHost,
  summarizeCompactions,
  summarizeLedger,
  summarizeSteps,
} from './unit-cost-core.mjs';
import { parseState } from './unit-record-core.mjs';
import { UNIT_ID_SOURCE, stepIntervals } from './unit-step-core.mjs';

// ---- [B] project bindings
// [B] Where the digests go (committed), and where the log, the follow-ups doc and the unit plans
// (state and steps files) live. FOLLOW_UPS may also be a list of paths; an entry ending in `/*.md`
// is every markdown file in that directory, sorted by name.
export const REPORTS_DIR = 'docs/harness/reports';
export const LOG = 'docs/harness/log.md';
export const FOLLOW_UPS = 'docs/harness/follow-ups.md';
export const PLANS_DIR = 'docs/plans';
// [B] The follow-ups doc's shape. The status column is the leftmost one whose name starts with any of
// STATUS_COLUMNS (lowercase); a cell is of a kind when it starts with one of that kind's words, case
// ignored and leading `*`, `_` and backticks skipped, followed by a non-letter or the cell's end
// (kinds in this order; anything else is `other`). A table with a column starting with one of
// SEVERITY_COLUMNS makes a row a P3 only by that cell; one without any cell may.
export const STATUS_COLUMNS = ['status'];
export const STATUS_WORDS = { open: ['open'], scheduled: ['scheduled'], fixed: ['fixed'], dropped: ['dropped'] };
export const SEVERITY_COLUMNS = ['sev', 'priority'];
// [B] The date a row was filed, when the project writes it into the row: a RegExp whose first group is a
// `YYYY-MM-DD` date. An open row's cells are tried in order and the first one it matches decides: that
// cell's date (UTC midnight) is the filing date and the row's age counts from it; if the date does not
// parse, the row keeps the date of its line's last commit, and no later cell is tried. A row with no
// matching cell keeps its line's date too. `null` dates every row by its line. Anchor the RegExp to its
// cell, so that a date in a note or a status cell is not read as a filing date: `/^(\d{4}-\d{2}-\d{2})$/`
// for a Filed column, `/^[A-Z]+-(\d{4}-\d{2}-\d{2})\b/` for an id that carries the date. The skill's weekly
// job reads only the paths its registry names, so it always dates by line.
export const FILED_AT = null;
// [B] The log columns the retro reads beyond estimate-core's COLUMNS, matched the same way (prefix).
export const EXTRA_COLUMNS = { defects: 'defects', missed: 'missed by harness', friction: 'friction', deliverable: 'deliverable' };
// [B] An outlier is at least OUTLIER_X times its cohort's median, in a cohort of at least MIN_COHORT.
export const OUTLIER_X = 2;
export const MIN_COHORT = 3;
// [B] A step under this share of its unit's dollars (percent) is never an outlier, however rare.
export const MIN_SHARE = 5;
// [B] Candidates: cache-expiry rewrites above this share of main-thread dollars; an open follow-up
// older than this many days.
export const REWRITE_ALERT_PERCENT = 5;
export const QUEUE_ALERT_DAYS = 14;
// [B] An untagged dispatch's step, from words in its description; the first match wins. Units from
// before the step tag carry none, so this is how their subagent cost finds its step.
export const STEP_WORDS = [
  [/\b8c\b|claim/i, '8c'],
  [/\b8b\b|\brecord\b/i, '8b'],
  [/\b8a\b|docs? (?:sweep|update)/i, '8a'],
  [/\blane a\b|conformance/i, '4'],
  [/\blive\b|\bwalk\b/i, '5'],
  [/integrat/i, '6'],
  [/visual|screenshot/i, '7'],
  [/review|\blane b\b|blast|adversar|silent|security|test.analy|verify|\bfix/i, '8'],
  [/\bslice\b|implement/i, '2'],
  [/\bplan\b|ground|investigat|research|explor/i, '1'],
];
// ---- end [B]

export const BASELINE_WEEKS = 4;
export const MAX_BYTES = 8192;
export const MAX_CANDIDATES = 5;
// The kinds of decision card (harness-bootstrap's reference/gate-design.md › Who decides), and the ones the owner is asked by
// default: a fact only the owner has, and what the grant never covers.
export const CARD_KINDS = ['code', 'taste', 'owner-fact', 'never-auto'];
export const ASK_DEFAULT = ['owner-fact', 'never-auto'];
// A fix this many days after a unit's merge, on one of the merge's files, links the unit's granted
// decisions to it; retro-gather reads this much first-parent history before the window for it.
export const DEFECT_DAYS = 7;
// A mainline commit that repairs one: a revert, or a conventional `fix`, `fix(scope)` or `fix!`.
export const FIX_SUBJECT = /^(revert\b|fix(\(|!|:))/i;
// One unit's owner wait counts at most this many minutes in the per-row figure: a unit parked over a
// weekend would otherwise be the whole week's number.
export const OWNER_WAIT_CAP_MIN = 24 * 60;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
// The runner's steps in sequence order (harness-bootstrap's reference/runner.md › The sequence), for listing.
const STEP_ORDER = ['0a', '0', '1', 'g1', '2', '3', '4', '5', '6', '7', '8', '8a', '8b', '8c', 'g2', '9', '10'];
// An empty cell, however it says so: ``, `—`, `none`, `none (owner, Gate 2)`, `— (none named)`.
const EMPTY = /^(?:|none|nothing|n\/a|-|—|–)(?:[\s.,;:]*\(.*\))?[\s.]*$/i;
const VALUE_FLAGS = {
  '--since': 'since',
  '--until': 'until',
  '--export': 'export',
  '--projects-dir': 'projectsDir',
  '--ledger': 'ledger',
};
// The digest's machine-readable tail, read back as the next retro's baseline.
const DATA_BLOCK = /<!-- retro-data (\{.*\}) -->/;
// A main thread's step-marker command names the unit it ran: `unit-step.mjs <unit> <step> start`.
const MARKER_CMD = new RegExp(`unit-step\\.mjs\\s+(${UNIT_ID_SOURCE})(?=[\\s"\\\\]|$)`, 'g');
// A slash command the owner typed is a user line that opens with command markup (`<command-name>/clear</command-name>`;
// transcripts hold the `<command-message>` tag first as well). The same tag inside a tool result, an assistant turn
// or a sentence is not one. The two that reset the context are counted.
const COMMAND_START = /^\s*<command-(?:name|message)>/;
const COMMAND_NAME = /<command-name>\s*\/([^<\s]+)\s*<\/command-name>/;
const CONTEXT_COMMANDS = new Set(['clear', 'compact']);
// Words too common to start or end a friction theme.
const STOP = new Set(
  'about above after again also because been before being between both could does doing done during each from have having here into just like made make many more most much must need never only other over same should since some such than that their them then there these they this those through under until very were what when where which while with would your unit units step steps time times owner the and for was but not its one two all any can did had has how out own see set per via new off are'.split(
    ' ',
  ),
);

const iso = (ms) => new Date(ms).toISOString();
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const usd = (v) => `$${Number(v ?? 0).toFixed(2)}`;
const minutes = (m) => (Number.isFinite(m) ? fmtMinutes(m) : '—');
const span = (m) => (Number.isFinite(m) && m < 1 ? `${Math.round(m * 60)}s` : minutes(m)); // a run can be seconds
const clip = (s, n) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clean = (cell) => (EMPTY.test(oneLine(cell)) ? '' : oneLine(cell));
const median = (values) => {
  const v = values.filter(Number.isFinite);
  return v.length ? percentile(v, 0.5) : null;
};
const stepRank = (s) => {
  const i = STEP_ORDER.indexOf(s);
  return i === -1 ? STEP_ORDER.length + (s === 'other' ? 1 : s === 'unmarked' ? 2 : 0) : i;
};
// A log with no tier column has one cohort: every unit.
const cohortName = (tier) => (tier ? `the ${tier} median` : 'the median');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Reject unknown flags, unreadable dates and more than one output mode before any file is read. */
export function parseArgs(argv) {
  const a = { since: null, until: null, dryRun: false, json: false, export: null, projectsDir: null, ledger: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--json') a.json = true;
    else if (Object.hasOwn(VALUE_FLAGS, t)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[VALUE_FLAGS[t]] = v;
    } else throw new Error(`unknown option ${t}`);
  }
  for (const k of ['since', 'until']) {
    if (a[k] !== null && !Number.isFinite(Date.parse(a[k]))) throw new Error(`--${k} is not a date: ${a[k]}`);
  }
  if (a.since !== null && a.until !== null && Date.parse(a.since) >= Date.parse(a.until)) {
    throw new Error('--since must be before --until');
  }
  if ([a.dryRun, a.json, a.export !== null].filter(Boolean).length > 1) {
    throw new Error('pick one of --dry-run, --json and --export');
  }
  return a;
}

/** The ISO 8601 week of a time, `2026-W44`, in UTC. */
export function isoWeek(ms) {
  const d = new Date(ms);
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const firstThursday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + 3 * DAY;
  return `${year}-W${String(1 + Math.round((thursday - firstThursday) / WEEK)).padStart(2, '0')}`;
}

/**
 * The window: `since` and `until` when given; else up to `now`, from the end of the newest earlier
 * digest of another week, else one week back. ISO strings, with the week of its end and the start of
 * its baseline, BASELINE_WEEKS before `since`.
 */
export function windowFor({ since = null, until = null, now, previous = [] }) {
  const end = until === null ? now : Date.parse(until);
  const week = isoWeek(end);
  const last = previous
    .filter((p) => p.week !== week && Date.parse(p.until) < end)
    .sort((x, y) => Date.parse(y.until) - Date.parse(x.until))[0];
  const start = since !== null ? Date.parse(since) : last ? Date.parse(last.until) : end - WEEK;
  return { since: iso(start), until: iso(end), week, baselineSince: iso(start - BASELINE_WEEKS * WEEK) };
}

/** An earlier digest's `retro-data` block (or an export's JSON) -> { week, since, until, kpis }; null when absent or torn. */
export function previousData(text) {
  const raw = String(text ?? '').trim();
  const m = raw.startsWith('{') ? [null, raw] : DATA_BLOCK.exec(raw);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    return d && typeof d.week === 'string' && typeof d.until === 'string' ? { week: d.week, since: d.since, until: d.until, kpis: d.kpis ?? {} } : null;
  } catch {
    return null;
  }
}

/** Whether a log row's unit id names a harness unit (`harness/<slug>`), not a product one. */
export const isHarnessUnit = (id) => /^[`'"]?harness\/[A-Za-z0-9]/i.test(String(id ?? '').trim());

// The branch a merge subject merges, the first form that matches: GitHub's `from <owner>/<branch>`, git's
// remote-tracking `'<remote>/<branch>'` and `Merge branch '<branch>'`, the runner's `Merge <branch>: <title>`.
const MERGE_FORMS = [
  /^Merge pull request #\d+ from [^/\s]+\/(\S+)/i,
  /^Merge remote-tracking branch '[^/']+\/([^']+)'/i,
  /^Merge branch '([^']+)'/i,
  /^Merge [`'"]?([^\s`'":]+)/i,
];
/** The branch a merge subject names, or null for a subject in no merge form. */
export function mergedBranch(subject) {
  const s = String(subject ?? '').trim();
  for (const re of MERGE_FORMS) {
    const m = re.exec(s);
    if (m) return m[1];
  }
  return null;
}
/** Whether a merge subject merges a harness unit's `harness/<slug>` branch; a title that only mentions one does not. */
export const isHarnessMerge = (subject) => isHarnessUnit(mergedBranch(subject));

/** The plan rows a batch row names: the ids of a Deliverable cell that starts `rows <id>, <id> — `; else none. */
export function batchRows(cell) {
  const m = /^rows ((?:[^\s,]+, )*[^\s,]+) — /i.exec(oneLine(cell));
  return m ? m[1].split(', ') : [];
}

/** A Defects cell -> { p0, p1 }: `0/2`, `P0 0 · P1 2` or an older `2C/6H`; null when it says none of these. */
export function parseDefects(cell) {
  const text = String(cell ?? '');
  const m =
    /P0\D{0,3}(\d+)\D+?P1\D{0,3}(\d+)/i.exec(text) ?? /(\d+)\s*C\b\D*?(\d+)\s*H\b/i.exec(text) ?? /(\d+)\s*\/\s*(\d+)/.exec(text);
  return m ? { p0: Number(m[1]), p1: Number(m[2]) } : null;
}

/**
 * The log's rows: estimate-core's fields, the Defects, Missed by harness and Friction cells, the plan
 * rows a batch row names (`batch`, batchRows), and
 * `landed` -- the time of the commit that last changed the row's line (`lineDates`, line -> ms, from
 * git blame), or null. `columns` replaces estimate-core's COLUMNS (the weekly job's per-repository map).
 */
export function logRecords(text, lineDates = new Map(), columns = undefined) {
  return parseLog(text, { raw: true, columns }).map(({ names, cells, ...r }) => {
    const at = (prefix) => {
      const i = names.findIndex((n) => n.startsWith(prefix));
      return i === -1 ? '' : (cells[i] ?? '');
    };
    return {
      ...r,
      defects: parseDefects(at(EXTRA_COLUMNS.defects)),
      missed: clean(at(EXTRA_COLUMNS.missed)),
      friction: clean(at(EXTRA_COLUMNS.friction)),
      batch: batchRows(at(EXTRA_COLUMNS.deliverable)),
      landed: lineDates.get(r.line) ?? null,
    };
  });
}

const STATUS_KINDS = ['open', 'scheduled', 'fixed', 'dropped'];
// A sticky or global flag would carry state from one row to the next.
const stateless = (re) => (re ? new RegExp(re.source, re.flags.replace(/[gy]/g, '')) : null);
// Each status kind with words, and the RegExp that reads a cell as that kind.
const statusMatchers = (statusWords) =>
  STATUS_KINDS.filter((kind) => statusWords[kind]?.length).map((kind) => [kind, new RegExp(`^(?:${statusWords[kind].map(escapeRe).join('|')})(?![A-Za-z])`, 'i')]);
const prefixColumn = (names, prefixes) => names.findIndex((n) => prefixes.some((p) => n.startsWith(p.toLowerCase())));
// A first cell as an id: its marks and outer spaces gone.
const bareId = (c) => oneLine(c).replace(/^[`*\s]+|[`*\s]+$/g, '');

/**
 * The filing date (UTC midnight, ms) the `filedAt` RegExp finds in a row: the first of `cells` it matches
 * decides, and null when that date does not parse (a day the calendar lacks), or when there is no binding
 * or no matching cell.
 */
function filedOn(cells, filedAt) {
  if (!filedAt) return null;
  let m = null;
  for (const c of cells) if ((m = filedAt.exec(String(c ?? '').trim()))) break;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(m?.[1] ?? '');
  if (!ymd) return null;
  const ms = Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  return new Date(ms).toISOString().slice(0, 10) === ymd[0] ? ms : null; // 2026-02-31 would roll into March
}

/**
 * The follow-ups doc -> rows by status kind, the open ones that name a P3, the age in days of the
 * oldest open row and of the oldest open P3, and that P3's row (its first cell, marks stripped).
 * Rows in a table with no status column are counted in `noStatus` and in nothing else. `lineDates` is
 * anything with `get(line)` -> commit ms (a Map, or readFollowUps' lazy lookup); the options default
 * to the [B] bindings, and a test passes its own. An open row is aged from the date in the first of its
 * cells `filedAt` matches (its line is not looked up then); a row with no such cell, or whose date does
 * not parse, from its line.
 */
export function followUpsSummary(
  text,
  lineDates = new Map(),
  now = Date.now(),
  { statusColumns = STATUS_COLUMNS, statusWords = STATUS_WORDS, severityColumns = SEVERITY_COLUMNS, filedAt = FILED_AT } = {},
) {
  const filed = stateless(filedAt);
  const out = { open: 0, scheduled: 0, fixed: 0, dropped: 0, other: 0, noStatus: 0, openP3: 0, oldestOpenDays: null, oldestOpenP3Days: null, oldestOpenP3Row: null };
  const words = statusMatchers(statusWords);
  const column = prefixColumn;
  let oldest = null;
  let oldestP3 = null;
  let oldestRow = null;
  for (const { names, rows } of tables(text)) {
    const st = column(names, statusColumns);
    if (st === -1) {
      out.noStatus += rows.length;
      continue;
    }
    const sev = column(names, severityColumns);
    for (const { cells, line } of rows) {
      const cell = String(cells[st] ?? '').trim().replace(/^[*_`]+/, '');
      const kind = words.find(([, re]) => re.test(cell))?.[0] ?? 'other';
      out[kind] += 1;
      if (kind !== 'open') continue;
      const p3 = sev === -1 ? cells.some((c) => /\bP3\b/.test(c)) : /\bP3\b/.test(cells[sev] ?? '');
      if (p3) out.openP3 += 1;
      const at = filedOn(cells, filed) ?? lineDates.get(line);
      if (!Number.isFinite(at)) continue;
      if (oldest === null || at < oldest) oldest = at;
      if (p3 && (oldestP3 === null || at < oldestP3)) [oldestP3, oldestRow] = [at, cells[0]];
    }
  }
  if (oldest !== null) out.oldestOpenDays = Math.floor((now - oldest) / DAY);
  if (oldestP3 !== null) out.oldestOpenP3Days = Math.floor((now - oldestP3) / DAY);
  if (oldestRow !== null) out.oldestOpenP3Row = oneLine(oldestRow).replace(/^[`*\s]+|[`*\s]+$/g, '') || null;
  return out;
}

/**
 * The follow-ups doc's open rows (followUpsSummary's notion of open, from the same options): each with
 * its id (the first cell, marks stripped), cells, line, the time it is aged from -- its filing date when
 * `filedAt` finds one, else its line's commit, else null -- and the severities it names (a severity
 * column's cell when the table has one, else any cell).
 */
export function openFollowUps(
  text,
  lineDates = new Map(),
  { statusColumns = STATUS_COLUMNS, statusWords = STATUS_WORDS, severityColumns = SEVERITY_COLUMNS, filedAt = FILED_AT } = {},
) {
  const filed = stateless(filedAt);
  const open = statusMatchers(statusWords).find(([kind]) => kind === 'open')?.[1];
  const out = [];
  if (!open) return out;
  for (const { names, rows } of tables(text)) {
    const st = prefixColumn(names, statusColumns);
    if (st === -1) continue;
    const sev = prefixColumn(names, severityColumns);
    for (const { cells, line } of rows) {
      if (!open.test(String(cells[st] ?? '').trim().replace(/^[*_`]+/, ''))) continue;
      const at = filedOn(cells, filed) ?? lineDates.get(line);
      const sevText = sev === -1 ? cells.join(' ') : String(cells[sev] ?? '');
      out.push({ id: bareId(cells[0] ?? ''), cells, line, at: Number.isFinite(at) ? at : null, sevs: [...new Set(sevText.match(/\bP[0-3]\b/g) ?? [])] });
    }
  }
  return out;
}

// What a follow-up row says the owner owes: `Owner supplies: <what>` or `Owner decides: <what>`.
const OWED = /\bOwner (?:supplies|decides):\s*(.*)$/i;

/**
 * The open follow-up rows that wait on the owner (a cell holding `Owner supplies:` or `Owner decides:`
 * text), oldest first, the undated ones last: [{ id, at, what }], `what` the text after the label, on one
 * line. The options are openFollowUps'.
 */
export function owedRows(text, lineDates = new Map(), opts = {}) {
  const out = [];
  for (const r of openFollowUps(text, lineDates, opts)) {
    const m = r.cells.map((c) => OWED.exec(oneLine(c))).find(Boolean);
    if (m) out.push({ id: r.id, line: r.line, at: r.at, what: m[1].replace(/[`*]/g, '').trim() });
  }
  return out.sort((x, y) => (x.at ?? Infinity) - (y.at ?? Infinity));
}

/** Every first-column id in the follow-ups doc's tables, marks stripped: a plan row with one of these ids was filed later, not planned. */
export function followUpIds(text) {
  const ids = new Set();
  for (const { rows } of tables(text)) for (const { cells } of rows) if (bareId(cells[0] ?? '')) ids.add(bareId(cells[0]));
  return ids;
}

// Who decided, as the By cell says it; `owner-other` before `owner`, which would swallow it.
const BY_WORD = /owner[- ]other|owner|grant|default|agent/i;
const byWord = (cell) => {
  const w = BY_WORD.exec(String(cell ?? ''))?.[0].toLowerCase();
  return w === undefined ? null : w.startsWith('owner') && w !== 'owner' ? 'owner-other' : w;
};

/**
 * One state file -> its unit, its decision log by Class (a table with no Class column counts as
 * unclassified) and By (`owner-other`, the owner choosing another option or adding a fact, under
 * `ownerOther`), its open questions and its P3 findings still to do.
 */
export function stateSummary(text) {
  const state = parseState(String(text ?? ''));
  const classes = { P: 0, C: 0, T: 0, other: 0, unclassified: 0 };
  const by = { owner: 0, ownerOther: 0, grant: 0, default: 0, agent: 0, other: 0 };
  let questions = 0;
  for (const section of unfenced(text).split(/^(?=##\s)/m)) {
    if (!/^##\s+decisions?\b/i.test(section)) continue;
    for (const { names, rows } of tables(section)) {
      const ci = names.findIndex((n) => n.startsWith('class'));
      const bi = names.findIndex((n) => n.startsWith('by'));
      const ii = names.findIndex((n) => n === 'id');
      for (const { cells } of rows) {
        if (ii !== -1 && /^Q-/i.test(cells[ii] ?? '')) {
          questions += 1;
          continue;
        }
        // A decision log from before the classes (no Class column) is counted, not guessed at.
        if (ci === -1) {
          classes.unclassified += 1;
          continue;
        }
        classes[/^\W*([PCT])\b/i.exec(cells[ci] ?? '')?.[1].toUpperCase() ?? 'other'] += 1;
        if (bi !== -1) {
          const w = byWord(cells[bi]);
          by[w === 'owner-other' ? 'ownerOther' : (w ?? 'other')] += 1;
        }
      }
    }
  }
  const p3 = state.findings.filter((f) => f.sev === 'P3' && (f.status === 'open' || f.status === 'follow-up')).length;
  return { unit: state.header.unit, classes, by, questions, p3 };
}

const unmark = (cell) => oneLine(cell).replace(/[`*]/g, '').trim();
/**
 * The text with every fenced code block (``` or ~~~, closed by a line of the same character at least as
 * long, or the end of the text) blanked line for line: a table a state file shows as an example is not a
 * decision, and the blank lines keep each remaining line at its number.
 */
function unfenced(text) {
  let open = null; // [char, length] of the fence being read
  return String(text ?? '')
    .split('\n')
    .map((line) => {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''));
      if (open === null) {
        if (!m || (m[1][0] === '`' && m[2].includes('`'))) return line;
        open = [m[1][0], m[1].length];
        return '';
      }
      if (m && m[1][0] === open[0] && m[1].length >= open[1] && m[2].trim() === '') open = null;
      return '';
    })
    .join('\n');
}
// `reverses DEC-3` or `reverses <unit>/DEC-3`: the unit is everything before the id's slash.
const REVERSES = /\breverses\s+(?:(\S+)\/)?([A-Za-z][A-Za-z0-9]*-\d+)\b/i;

/**
 * One state file -> its decision rows (C6): [{ unit, id, date, cls, by, cardKind, decision, cost, kind,
 * reverses, line }]. The unit is the file's `Unit:` header, else `unit`. Columns are found by the start
 * of their lowercased name in any order (`by`, `card`, `kind` -- which never matches `card kind` --,
 * `reversal`), cells read with backticks and bold stripped. `reverses` is set on a row of Kind `reversal`
 * only, a bare id qualified with this file's unit. `line` is the row's table line as it stands in the
 * file, so a caller can date the row by its line's commit. Q- rows are skipped, and a table with no ID
 * column yields nothing. A table inside a fenced code block is an example, never a decision (unfenced).
 */
export function decisionRows(text, unit = null) {
  const src = String(text ?? '');
  const own = parseState(src).header.unit || unit;
  const lines = src.split(/\r?\n/);
  const out = [];
  let offset = 0;
  for (const section of unfenced(src).split(/^(?=##\s)/m)) {
    const start = offset;
    offset += section.split(/\r?\n/).length - 1;
    if (!/^##\s+decisions?\b/i.test(section)) continue;
    for (const { names, rows } of tables(section)) {
      const col = (p) => names.findIndex((n) => n.startsWith(p));
      const ii = col('id');
      if (ii === -1) continue;
      const [di, ci, dci, bi, ki, ri, ti] = ['date', 'class', 'decision', 'by', 'card', 'reversal', 'kind'].map(col);
      const at = (cells, i) => (i === -1 ? '' : unmark(cells[i] ?? ''));
      for (const { cells, line } of rows) {
        const id = at(cells, ii);
        if (!id || /^Q-/i.test(id)) continue;
        const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(at(cells, di))?.[1] ?? null;
        const card = at(cells, ki).toLowerCase();
        const kind = at(cells, ti).toLowerCase();
        const decision = at(cells, dci);
        const rev = /^reversal\b/.test(kind) ? REVERSES.exec(decision) : null;
        out.push({
          unit: own,
          id,
          date,
          cls: /^\W*([PCT])\b/i.exec(at(cells, ci))?.[1].toUpperCase() ?? null,
          by: byWord(at(cells, bi)),
          cardKind: CARD_KINDS.find((k) => new RegExp(`^${k}(?![a-z-])`).test(card)) ?? null,
          decision,
          cost: at(cells, ri),
          kind,
          reverses: rev ? `${rev[1] ?? own}/${rev[2]}` : null,
          line: lines[start + line - 1],
        });
      }
    }
  }
  return out;
}

const rowKey = (r) => `${r.unit}/${r.id}`;
// Newest first by date, the undated after every dated row; ties keep their order.
const newestFirst = (list) => [...list].sort((x, y) => (x.date === y.date ? 0 : x.date === null ? 1 : y.date === null ? -1 : x.date < y.date ? 1 : -1));
const reversedKeys = (rows) => new Set(rows.map((r) => r.reverses).filter(Boolean));

/** The owner's `KIND-<kind>` promote rows: the kinds promoted, the ones that cannot be (`never-auto`, an unknown kind), and each promoted kind's newest promotion date. */
function promotedKinds(rows) {
  const promoted = [];
  const ignored = [];
  const since = new Map(); // kind -> its newest promotion's date, or null when undated
  for (const r of rows) {
    const k = /^KIND-(.+)$/i.exec(r.id ?? '')?.[1].toLowerCase();
    if (!k || r.by !== 'owner' || !/^promote\b/i.test(r.decision ?? '')) continue;
    if (k === 'never-auto' || !CARD_KINDS.includes(k)) {
      if (!ignored.includes(k)) ignored.push(k);
      continue;
    }
    if (!promoted.includes(k)) promoted.push(k);
    if (r.date !== null && !(since.get(k) >= r.date)) since.set(k, r.date);
    else if (!since.has(k)) since.set(k, null);
  }
  return { promoted, ignored, since };
}

/**
 * Which card kinds the owner is asked (C6), from every state file's decision rows: ASK_DEFAULT, less a
 * kind an owner `KIND-<kind>` promote row widened the grant to (`never-auto` never: such a row goes to
 * `ignored`), plus a granted kind whose last `window` grant rows -- after its newest promotion, when it
 * has one -- were reversed more than `bar` of the time. Only a grant row dated after the promotion's day
 * counts (C6): dates are days, so one dated the promotion's day cannot be told from the asked kind's own
 * answers before it, and an undated grant row never counts after a promotion. A promotion with no date keeps
 * every dated grant row and drops the undated ones.
 */
export function askKinds(rows, { window = 20, bar = 0.1 } = {}) {
  const { promoted, ignored, since } = promotedKinds(rows);
  const ask = new Set(ASK_DEFAULT.filter((k) => !promoted.includes(k)));
  const reversed = reversedKeys(rows);
  const demoted = [];
  for (const k of ['code', 'taste', 'owner-fact']) {
    const promotedKind = since.has(k); // a promotion with no date has a null cut, so `has`, not the cut, tells promoted
    const cut = since.get(k) ?? null;
    const granted = rows.filter((r) => r.by === 'grant' && r.cardKind === k && (!promotedKind || (r.date !== null && (cut === null || r.date > cut))));
    const last = newestFirst(granted).slice(0, window);
    const n = last.filter((r) => reversed.has(rowKey(r))).length;
    if (last.length > 0 && n / last.length > bar) {
      ask.add(k);
      demoted.push({ kind: k, reversed: n, of: last.length });
    }
  }
  return { ask: CARD_KINDS.filter((k) => ask.has(k)), demoted, promoted, ignored };
}

/**
 * The asked kinds the owner's own answers say the grant could take (`never-auto` never): over a kind's
 * last `window` rows the owner answered (`owner`, `owner-other`), proposed when there are `window` of
 * them and the owner took the recommendation (`owner`) on at least `bar` of them -> [{ kind, took, of }].
 */
export function promotions(rows, ask, { window = 20, bar = 0.9 } = {}) {
  const out = [];
  for (const k of ask) {
    if (k === 'never-auto') continue;
    const last = newestFirst(rows.filter((r) => r.cardKind === k && (r.by === 'owner' || r.by === 'owner-other') && !/^KIND-/i.test(r.id))).slice(0, window);
    const took = last.filter((r) => r.by === 'owner').length;
    if (last.length >= window && took / last.length >= bar) out.push({ kind: k, took, of: last.length });
  }
  return out;
}

// A merge's branch names a unit when it is the unit's id, or ends in `/<id>`.
const mergeOf = (m, unit) => m.unit === unit || (typeof m.unit === 'string' && m.unit.endsWith(`/${unit}`));
// Is `f` after the merge `m`? By their first-parent order (`seq`, larger = later) when both carry it, as
// commits in the same second cannot be ordered by time; else not before it in time and another commit.
const after = (f, m) => (Number.isFinite(f.seq) && Number.isFinite(m.seq) ? f.seq > m.seq : f.t >= m.t && f.sha !== m.sha);
// A fix on one of a merge's files, after it and within `days`; the earliest.
const fixAfter = (m, fixes, days) => {
  const files = new Set(m.files ?? []);
  return fixes
    .filter((f) => after(f, m) && f.t <= m.t + days * DAY && (f.files ?? []).some((p) => files.has(p)))
    .sort((x, y) => x.t - y.t || (x.seq ?? 0) - (y.seq ?? 0))[0];
};

/**
 * Each `By: grant` row with what came after it (pure): `reversed` when a reversal row names it; else
 * `defect-linked`, with `fix: { sha, subject }`, when a revert or fix commit (FIX_SUBJECT) within `days`
 * after its unit's merge touches one of that merge's files; else `kept`. `merges`: [{ sha, unit, t, seq,
 * files }]; `fixes`: [{ sha, t, seq, subject, files }] (`seq`: the commit's place in the mainline's
 * first-parent order, larger = later; it orders commits of one second when both sides carry it). A link is a lead for the owner to judge, not a verdict.
 */
export function decisionOutcomes(rows, { merges = [], fixes = [], days = DEFECT_DAYS } = {}) {
  const reversed = reversedKeys(rows);
  const repairs = (fixes ?? []).filter((f) => FIX_SUBJECT.test(f.subject ?? ''));
  return rows
    .filter((r) => r.by === 'grant')
    .map((r) => {
      if (reversed.has(rowKey(r))) return { ...r, outcome: 'reversed' };
      const fix = (merges ?? [])
        .filter((m) => mergeOf(m, r.unit))
        .map((m) => fixAfter(m, repairs, days))
        .filter(Boolean)
        .sort((x, y) => x.t - y.t)[0];
      return fix ? { ...r, outcome: 'defect-linked', fix: { sha: fix.sha, subject: fix.subject } } : { ...r, outcome: 'kept' };
    });
}

/** The units a main-thread transcript wrote step markers for, from its `unit-step.mjs <unit>` commands. */
export function markerUnits(text) {
  return new Set([...String(text ?? '').matchAll(MARKER_CMD)].map((m) => m[1]));
}

/**
 * The context command (`clear` or `compact`) a parsed transcript line is, when the owner typed it; else
 * null. The line must be an owner prompt (unit-cost-core's isOwnerPrompt, the one definition: a tool result,
 * a sidechain line, an assistant turn or a peer's message never is) and open with command markup.
 */
export function contextCommand(d) {
  if (!isOwnerPrompt(d)) return null;
  const c = d.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => String(x.text ?? '')).join('') : '';
  if (!COMMAND_START.test(text)) return null;
  const name = COMMAND_NAME.exec(text)?.[1];
  return CONTEXT_COMMANDS.has(name) ? name : null;
}

/** A main-thread transcript's text -> its context commands in file order: [{ ts, name }]. A line with no readable time is skipped. */
export function contextCommands(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.includes('command-name')) continue; // most lines: not parsed
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(d?.timestamp);
    const name = Number.isFinite(ts) ? contextCommand(d) : null;
    if (name) out.push({ ts, name });
  }
  return out;
}

// A description names a unit when its id stands alone: `EP-27.0` is not named by `EP-27.04`.
const namesUnit = (unit) => new RegExp(`(?:^|[^A-Za-z0-9.])${escapeRe(unit)}(?![A-Za-z0-9]|\\.[A-Za-z0-9])`);

/**
 * The step a dispatch belongs to in `unit`: its tag's, when the tag names the unit; else, when the
 * description names the unit, the first STEP_WORDS match (`other` without one); null when it is not
 * this unit's dispatch.
 */
export function stepOfDescription(description, unit, named = namesUnit(unit)) {
  const text = String(description ?? '');
  const tag = parseTag(text);
  if (tag) return tag.unit === unit ? tag.step : null;
  if (!named.test(text)) return null;
  return STEP_WORDS.find(([re]) => re.test(text))?.[1] ?? 'other';
}

/** Subagent rows -> one entry per subagent: its id, dispatch description and dollars. */
export function agentCosts(rows) {
  const byId = new Map();
  for (const r of dedupeRows(rows)) {
    if (r.kind !== 'sub') continue;
    const id = r.agentId ?? r.agentType ?? 'unknown';
    if (!byId.has(id)) byId.set(id, { agentId: id, description: r.agentDescription ?? '', usd: 0 });
    byId.get(id).usd += r.cost;
  }
  return [...byId.values()];
}

const agentKey = (r) => r.agentId ?? r.agentType ?? 'unknown';

/**
 * A marked unit's transcript rows: those of the sessions that wrote its markers (every session when
 * none did), from its first marker to its last -- or to `until` while a step is still open. A
 * dispatch `owners` gives this unit (dispatchOwners) is the unit's whole, whatever its session and
 * however long it outlives the unit's last marker.
 */
export function rowsForUnit(rows, sessionUnits, unit, markers, until, owners = new Map()) {
  const sessions = new Set([...sessionUnits].filter(([, units]) => units.has(unit)).map(([s]) => s));
  const ts = markers.map((m) => m.ts);
  const lo = Math.min(...ts);
  const hi = stepIntervals(markers).intervals.some((iv) => iv.open) ? Date.parse(until) : Math.max(...ts);
  const own = (r) => r.kind === 'sub' && owners.get(agentKey(r)) === unit;
  return rows.filter((r) => own(r) || ((sessions.size === 0 || sessions.has(r.session)) && r.ts >= lo && r.ts <= hi));
}

/** agent -> the one unit its dispatch belongs to: its tag's, else the only one of `ids` its description names. */
export function dispatchOwners(agents, ids) {
  const named = [...ids].map((id) => [id, namesUnit(id)]);
  const out = new Map();
  for (const a of agents) {
    const tag = parseTag(a.description);
    const hits = tag ? [tag.unit] : named.filter(([, re]) => re.test(a.description)).map(([id]) => id);
    if (hits.length === 1) out.set(a.agentId, hits[0]);
  }
  return out;
}

/**
 * Each marked unit's rows once overlapping units are settled: `spans` is unit -> { rows (from
 * rowsForUnit), intervals (stepIntervals) }. A dispatch goes to the unit `owners` gives it. Any other
 * row held by the step intervals of two units -- a subagent by its first turn -- goes to the unit
 * whose step started last: planning the next unit while this one waits on Gate 2 is the next unit's
 * work. A row no interval holds stays with every unit whose span holds it, as `unmarked`.
 */
export function claimRows(spans, owners = new Map()) {
  const first = new Map();
  for (const { rows } of spans.values()) {
    for (const r of rows) if (r.kind === 'sub' && !(first.get(agentKey(r)) <= r.ts)) first.set(agentKey(r), r.ts);
  }
  const owned = (r) => r.kind === 'sub' && owners.has(agentKey(r));
  const at = (r) => (r.kind === 'sub' ? first.get(agentKey(r)) : r.ts);
  const id = (r) => (r.kind === 'sub' ? `a ${agentKey(r)}` : `r ${r.key}`);
  const best = new Map();
  for (const [unit, { rows, intervals }] of spans) {
    for (const r of rows) {
      if (owned(r)) continue;
      const ts = at(r);
      const iv = intervals.find((i) => ts >= i.start && (i.end === null || ts < i.end || (i.open && ts <= i.end)));
      if (iv && !(best.get(id(r))?.start >= iv.start)) best.set(id(r), { unit, start: iv.start });
    }
  }
  const out = new Map();
  for (const [unit, { rows }] of spans) {
    out.set(unit, rows.filter((r) => (owned(r) ? owners.get(agentKey(r)) === unit : (best.get(id(r))?.unit ?? unit) === unit)));
  }
  return out;
}

/**
 * One unit's dollars (and, with markers, time) by step. With markers: main-thread turns by interval,
 * subagents by tag (summarizeSteps), rounds summed per step. Without: its subagents by dispatch
 * description (`agents`, from agentCosts) -- a unit from before the markers has no main-thread
 * split. Null when nothing names the unit.
 */
export function unitSteps(unit, { markers = [], rows = [], agents = null } = {}) {
  const slots = new Map();
  const slot = (step) => {
    if (!slots.has(step)) slots.set(step, { step, usd: 0, wallMs: markers.length ? 0 : null, agents: 0 });
    return slots.get(step);
  };
  let total = 0;
  let problems = 0;
  if (markers.length > 0) {
    const s = summarizeSteps(rows, markers, { unit });
    for (const x of s.steps) {
      const v = slot(x.label === 'unmarked' ? 'unmarked' : x.label.replace(/ r\d+$/, ''));
      v.usd += x.usd;
      v.wallMs += x.wallMs;
      v.agents += x.agents;
    }
    total = s.total;
    problems = s.problems.length;
  } else {
    const named = namesUnit(unit);
    for (const a of agents ?? agentCosts(rows)) {
      const step = stepOfDescription(a.description, unit, named);
      if (step === null) continue;
      const v = slot(step);
      v.usd += a.usd;
      v.agents += 1;
      total += a.usd;
    }
    if (slots.size === 0) return null;
  }
  const steps = [...slots.values()]
    .sort((x, y) => stepRank(x.step) - stepRank(y.step) || x.step.localeCompare(y.step))
    .map((x) => ({ ...x, usd: round2(x.usd), share: total > 0 ? round1((x.usd / total) * 100) : 0 }));
  return { unit, source: markers.length ? 'markers' : 'descriptions', total: round2(total), problems, steps };
}

/** The log's units landed in [since, until]: count, median work, owner wait and cost per unit, P0 and P1 found, rows with Missed by harness. */
export function logKpis(records, since, until) {
  const rows = records.filter((r) => inWindow(r.landed, since, until));
  const units = groupUnits(rows);
  const med = (k, round = round1) => {
    const m = median(units.map((u) => u[k]));
    return m === null ? null : round(m);
  };
  return {
    units: units.length,
    work: med('work'),
    ownerWait: med('ownerWait'),
    cost: med('cost', round2), // dollars to the cent, minutes to a tenth
    p0: rows.reduce((s, r) => s + (r.defects?.p0 ?? 0), 0),
    p1: rows.reduce((s, r) => s + (r.defects?.p1 ?? 0), 0),
    missed: rows.filter((r) => r.missed).length,
  };
}

/**
 * The harness's share of the units landed in [since, until], by count and by cost (over the units whose
 * Cost cell parses), and the product plan rows landed per day: a product unit counts the plan rows its
 * batch rows name, else 1. Reported in the digest, never a candidate.
 */
export function productKpis(records, since, until) {
  const rows = records.filter((r) => inWindow(r.landed, since, until));
  const units = groupUnits(rows);
  const priced = units.filter((u) => Number.isFinite(u.cost));
  const total = priced.reduce((s, u) => s + u.cost, 0);
  const harness = units.filter((u) => isHarnessUnit(u.id));
  const named = new Map();
  for (const r of rows) if (!isHarnessUnit(r.id)) named.set(r.id, new Set([...(named.get(r.id) ?? []), ...r.batch]));
  const productRows = [...named.values()].reduce((n, ids) => n + (ids.size || 1), 0);
  const days = (Date.parse(until) - Date.parse(since)) / DAY;
  return {
    units: units.length,
    harness: harness.length,
    share: units.length ? round1((harness.length / units.length) * 100) : null,
    costShare: total > 0 ? round1((priced.filter((u) => isHarnessUnit(u.id)).reduce((s, u) => s + u.cost, 0) / total) * 100) : null,
    productRows,
    perDay: days > 0 ? round2(productRows / days) : null,
  };
}

/** The window's transcripts: spend (main thread, subagents), sessions, questions, compactions, cache hit and expiry rewrites. */
export function transcriptKpis(rows, events, { since, until }) {
  const w = { since, until };
  const claude = summarizeClaude(rows, w);
  const cache = summarizeCache(rows, w);
  const comp = summarizeCompactions(events, w);
  const sessions = new Set(dedupeRows(rows).filter((r) => r.kind === 'main' && inWindow(r.ts, since, until)).map((r) => r.session));
  return {
    claudeUsd: round2(claude.total),
    mainUsd: round2(claude.main),
    subUsd: round2(claude.sub),
    sessions: sessions.size,
    subagents: claude.subagentCount,
    questions: events.filter((e) => e.type === 'ask' && inWindow(e.ts, since, until)).length,
    compactions: comp.count,
    autoCompactions: comp.byTrigger.auto ?? 0,
    compactPreTokens: comp.medianPreTokens,
    cacheHit: cache.hitPercent,
    rewrites: cache.rewrites,
    rewriteUsd: round2(cache.rewriteDollars),
    rewriteShare: claude.main > 0 ? round1((cache.rewriteDollars / claude.main) * 100) : 0,
  };
}

/**
 * How much the owner had to touch the window's main-thread transcripts: the prompts typed (isOwnerPrompt),
 * the /clear and /compact among them (`commands`: contextCommands, tagged like the events), and the median
 * agent run -- from a prompt to the last main-thread record before the next prompt of the same session, or
 * before its end, in minutes. A run belongs to the window its prompt is in, whenever it ends. An answer to
 * a question tool is a tool result, not a prompt, so it does not end a run; a typed /clear is a prompt
 * with a run of about nothing. `events` are parseEvents' of every session, each tagged `session` (retro-gather).
 * Per unit: over the `units` landed in the window, null with none. Null when the window holds no event.
 */
export function ownerKpis(events, commands, { since, until, units }) {
  if (!events.some((e) => inWindow(e.ts, since, until))) return null;
  const threads = new Map();
  for (const e of events) {
    const key = e.session ?? null;
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(e);
  }
  // A typed /clear or /compact is an owner prompt, but no work follows it: it counts as a prompt
  // and stays out of the run median, which it would otherwise pull towards zero.
  const typedAt = new Set(commands.map((c) => `${c.session ?? null}|${c.ts}`));
  const runs = [];
  let prompts = 0;
  for (const [session, list] of threads) {
    let start = null;
    let end = null;
    const close = () => {
      if (start === null || !inWindow(start, since, until)) return;
      prompts += 1;
      if (!typedAt.has(`${session}|${start}`)) runs.push(end - start);
    };
    for (const e of list.sort((x, y) => x.ts - y.ts)) {
      if (e.type === 'prompt') {
        close();
        start = e.ts;
      }
      end = e.ts;
    }
    close();
  }
  const typed = commands.filter((c) => inWindow(c.ts, since, until));
  const clears = typed.filter((c) => c.name === 'clear').length;
  const compacts = typed.filter((c) => c.name === 'compact').length;
  const perUnit = (n) => (units > 0 ? round1(n / units) : null);
  const mid = median(runs);
  return {
    prompts,
    clears,
    compacts,
    promptsPerUnit: perUnit(prompts),
    commandsPerUnit: perUnit(clears + compacts),
    runMin: mid === null ? null : round1(mid / 60_000),
  };
}

/** A Codex host's threads in the window (summarizeCodexHost), its numbers only, so earlier weeks give a median. */
export function codexHostKpis(sessions, { since, until }) {
  const h = summarizeCodexHost(sessions, { since, until });
  return {
    sessions: h.sessions,
    subagents: h.subagents,
    turns: h.turns,
    questions: h.questions,
    compactions: h.compactions,
    compactPreTokens: h.compactPreTokens,
    tokens: h.tokens,
    cacheHit: h.cacheHit,
    percent: h.percent,
  };
}

/** claude-run's runs in the window: how many ran and did not, their dollars, and those without a cost. */
export function claudeRunKpis(entries, { since, until }) {
  const r = summarizeClaudeRuns(entries, { since, until });
  return { runs: r.runs, notRun: r.notRun, usd: round2(r.usd), unpriced: r.unpriced };
}

// A finding line: a severity tag first on the line, after a list or table marker, an id (`F-12 ·`,
// `| F3 |`), up to two openers (`**`, `[`, `(`, backtick: `**[P1]**`) and a `severity:` label --
// `F-12 · P1 · a.js:3 ...`, `- **P1** ...`, `| P2 | ...`, `[P0] ...`, `- severity: P1` -- unless
// what follows says there is none: `P1: none.`, `P1: None found`, `P1: 0 findings`, `P1: none (after
// review)`, `P1: no issues`, `| P1 | — |`, after more tags or a noun too (`P0/P1: none`, `P0, P1:
// none`, `P1 findings: none`), but `P1: none of the callers ...` and `P1: 0.5s slower` are findings.
// A none line's `;` parts are read again (`P0: none; P1: a.js:3 race`). A heading names a section.
const FINDING_LEAD = String.raw`^\s*(?:[-*+]\s+|\d+[.)]\s+|\|\s*)?`;
const FINDING_ID = String.raw`(?:[A-Z][A-Z0-9]{0,5}-?\d+[a-z]?\s*[·:|.)\-–—]\s*)?`;
const FINDING_OPEN = String.raw`(?:(?:\*\*|__|\[|\(|\x60)\s*){0,2}`;
const FINDING_LABEL = String.raw`(?:(?:severity|sev)\s*(?:\*\*|__)?\s*[:=]\s*(?:\*\*|__)?\s*)?`;
const NONE_WORD = String.raw`(?:none|nothing|n\/a|nil|0(?![.,]\d)|no\s+(?:findings?|issues?|p[0-3]s?)|[\-–—]+(?=\s*(?:\||$)))`;
const NONE_AFTER = String.raw`(?:\s*(?:$|[.,;:()*_|\x60\-–—])|\s+(?:found|reported|identified|remaining|open|left|seen|in|at|this|so|yet|after|for|to\s+report|findings?|issues?)\b)`;
const NONE_MORE = String.raw`(?:(?:[^A-Za-z0-9]*|\s+(?:and|or)\s+)P[0-3]\b)*(?:\s+(?:findings?|issues?)\b)?`;
const FINDING_NOT_NONE = String.raw`(?!${NONE_MORE}[^A-Za-z0-9]*${NONE_WORD}${NONE_AFTER})`;
const FINDING_LINE = new RegExp(`${FINDING_LEAD}${FINDING_ID}${FINDING_OPEN}${FINDING_LABEL}(P[0-3])\\b${FINDING_NOT_NONE}`, 'i');
const FINDING_TAG = new RegExp(`${FINDING_LEAD}${FINDING_ID}${FINDING_OPEN}${FINDING_LABEL}P[0-3]\\b`, 'i');

/** The findings a verdict lists, by severity: the lines FINDING_LINE takes. */
export function countFindings(text) {
  const out = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const parts = FINDING_LINE.test(line) || !FINDING_TAG.test(line) ? [line] : line.split(';');
    for (const part of parts) {
      const m = FINDING_LINE.exec(part);
      if (m) out[m[1].toUpperCase()] += 1;
    }
  }
  return out;
}

/**
 * Yield by step: codex-run's ok runs in the window by kind (its step), the verdicts kept for them
 * (`verdictCopy`, read into `verdicts`: copy path -> text), how many of those list a P0 or P1, and
 * the P0/P1 lines they list. A run whose copy is missing counts in `runs`, not `kept`; the rate is
 * over the kept verdicts. Sorted by runs, then kind.
 */
export function stepYield(entries, verdicts, { since, until }) {
  const by = new Map();
  for (const e of entries) {
    if (e.outcome !== 'ok' || !inWindow(Date.parse(e.at), since, until)) continue;
    const kind = e.kind || 'unknown';
    const s = by.get(kind) ?? { kind, runs: 0, kept: 0, hits: 0, p0p1: 0 };
    s.runs += 1;
    const text = e.verdictCopy ? verdicts.get(e.verdictCopy) : undefined;
    if (typeof text === 'string') {
      const f = countFindings(text);
      s.kept += 1;
      s.p0p1 += f.P0 + f.P1;
      if (f.P0 + f.P1 > 0) s.hits += 1;
    }
    by.set(kind, s);
  }
  return [...by.values()]
    .map((s) => ({ ...s, rate: s.kept ? Math.round((s.hits / s.kept) * 100) : null }))
    .sort((x, y) => y.runs - x.runs || (x.kind < y.kind ? -1 : 1));
}

/** Each `key` KPI's median over the newest BASELINE_WEEKS earlier digests of weeks before `week`; null with none. */
export function previousKpis(previous, week, key = 'transcripts') {
  const list = previous
    .filter((p) => p.week < week && p.kpis?.[key])
    .sort((x, y) => (x.week < y.week ? 1 : -1))
    .slice(0, BASELINE_WEEKS);
  if (list.length === 0) return null;
  const out = { weeks: list.length };
  for (const k of Object.keys(list[0].kpis[key])) {
    const m = median(list.map((p) => p.kpis[key][k]));
    out[k] = m === null ? null : (k.endsWith('Usd') ? round2 : round1)(m);
  }
  return out;
}

/** Units of the window whose cost or work is at least OUTLIER_X times their tier's median over window and baseline. */
export function unitOutliers(records, win) {
  const pool = groupUnits(records.filter((r) => inWindow(r.landed, win.baselineSince, win.until)));
  const current = new Set(records.filter((r) => inWindow(r.landed, win.since, win.until)).map((r) => r.id));
  const out = [];
  for (const metric of ['cost', 'work']) {
    for (const tier of new Set(pool.map((u) => u.tier))) {
      const cohort = pool.filter((u) => u.tier === tier && Number.isFinite(u[metric]));
      const med = median(cohort.map((u) => u[metric]));
      if (cohort.length < MIN_COHORT || !(med > 0)) continue;
      for (const u of cohort) {
        if (current.has(u.id) && u[metric] >= OUTLIER_X * med) {
          out.push({ unit: u.id, tier: tier || null, metric, value: u[metric], median: (metric === 'cost' ? round2 : round1)(med), x: round1(u[metric] / med), n: cohort.length });
        }
      }
    }
  }
  return out.sort((a, b) => b.x - a.x);
}

/**
 * Steps of the window's units that took at least OUTLIER_X times the median share of their unit's
 * dollars that the step takes over every unit with the same kind of step data (markers or
 * descriptions), in a cohort of at least MIN_COHORT; a step under MIN_SHARE of its unit never is.
 */
export function stepOutliers(all, currentIds) {
  const byStep = new Map();
  for (const u of all) {
    if (!(u.total > 0)) continue;
    for (const s of u.steps) {
      if (s.step === 'unmarked' || s.step === 'other') continue;
      const key = `${u.source}:${s.step}`;
      if (!byStep.has(key)) byStep.set(key, []);
      byStep.get(key).push({ unit: u.unit, share: (s.usd / u.total) * 100, usd: s.usd, source: u.source, step: s.step });
    }
  }
  const out = [];
  for (const list of byStep.values()) {
    const med = median(list.map((x) => x.share));
    if (list.length < MIN_COHORT || !(med > 0)) continue;
    for (const x of list) {
      if (currentIds.has(x.unit) && x.share >= MIN_SHARE && x.share >= OUTLIER_X * med) {
        out.push({ step: x.step, unit: x.unit, source: x.source, usd: x.usd, share: round1(x.share), median: round1(med), x: round1(x.share / med), n: list.length });
      }
    }
  }
  return out.sort((a, b) => b.x - a.x);
}

/** Each step's median share of its unit's dollars over every unit with step data of one kind, most first. */
export function stepShares(all, source) {
  const byStep = new Map();
  for (const u of all) {
    if (u.source !== source || !(u.total > 0)) continue;
    for (const s of u.steps) {
      if (!byStep.has(s.step)) byStep.set(s.step, []);
      byStep.get(s.step).push((s.usd / u.total) * 100);
    }
  }
  return [...byStep]
    .map(([step, v]) => ({ step, median: round1(median(v)), n: v.length }))
    .sort((x, y) => y.median - x.median || stepRank(x.step) - stepRank(y.step));
}

/**
 * Two-word phrases that recur in the Friction of two or more units over window and baseline, one of
 * them in the window; most units first. Single words were too generic to read (`state`, `review`).
 */
export function frictionThemes(records, win, limit = 6) {
  const units = new Map();
  const recent = new Set();
  for (const r of records) {
    if (!r.friction || !inWindow(r.landed, win.baselineSince, win.until)) continue;
    const inWin = inWindow(r.landed, win.since, win.until);
    const words = r.friction.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [];
    const pairs = new Set();
    for (let i = 0; i + 1 < words.length; i++) {
      const [a, b] = [words[i], words[i + 1]];
      if (a.length >= 3 && b.length >= 3 && !STOP.has(a) && !STOP.has(b)) pairs.add(`${a} ${b}`);
    }
    for (const w of pairs) {
      if (!units.has(w)) units.set(w, new Set());
      units.get(w).add(r.id);
      if (inWin) recent.add(w);
    }
  }
  return [...units]
    .filter(([w, ids]) => ids.size >= 2 && recent.has(w))
    .sort((x, y) => y[1].size - x[1].size || x[0].localeCompare(y[0]))
    .slice(0, limit)
    .map(([word, ids]) => ({ word, units: [...ids].sort() }));
}

/**
 * At most MAX_CANDIDATES things for the retro review, one of each source in turn so no source fills
 * every slot: what the Read line warns of, what the owner caught, cache-expiry rewrites, step outliers,
 * unit outliers, repeated friction, an old queue -- then the second of each, and so on.
 */
export function candidates(d) {
  const sources = [
    d.missed.map((r) => ({ kind: 'rule', text: `${r.unit}: the owner caught what the harness missed — ${clip(r.missed, 120)}`, evidence: 'log › Missed by harness' })),
    [],
    d.stepOutliers.map((o) => ({ kind: 'machinery', text: `step ${o.step} took ${o.share}% of ${o.unit}'s dollars, ${o.x}× its median ${o.median}% (n=${o.n})`, evidence: `steps (${o.source})` })),
    d.unitOutliers.map((o) => ({
      kind: 'machinery',
      text: `${o.unit}'s ${o.metric} ${o.metric === 'cost' ? usd(o.value) : minutes(o.value)} is ${o.x}× ${cohortName(o.tier)} (n=${o.n})`,
      evidence: 'log',
    })),
    d.friction.map((t) => ({ kind: 'machinery', text: `"${t.word}" recurs in the Friction of ${t.units.join(', ')}`, evidence: 'log › Friction' })),
    [],
  ];
  const t = d.kpis.transcripts;
  if (t && t.rewriteShare >= REWRITE_ALERT_PERCENT) {
    sources[1].push({
      kind: 'threshold',
      text: `cache-expiry rewrites cost ${usd(t.rewriteUsd)}, ${t.rewriteShare}% of main-thread spend (${t.rewrites}): end the turn at owner gates (harness-bootstrap's reference/context.md › The gate wait)`,
      evidence: 'transcripts',
    });
  }
  const q = d.queue.followUps;
  if (q && q.oldestOpenDays !== null && q.oldestOpenDays >= QUEUE_ALERT_DAYS) {
    sources[5].push({ kind: 'machinery', text: `the oldest open follow-up is ${q.oldestOpenDays} days old (${q.open} open, ${q.openP3} naming a P3): each passes the relevance test or is dropped (harness-bootstrap's reference/runner.md)`, evidence: 'follow-ups doc' });
  }
  sources.unshift((d.warnings ?? []).map((w) => ({ kind: 'machinery', text: w, evidence: 'Read line' })));
  const out = [];
  for (let i = 0; out.length < MAX_CANDIDATES && sources.some((s) => s.length > i); i++) {
    for (const s of sources) if (s[i] && out.length < MAX_CANDIDATES) out.push(s[i]);
  }
  return out;
}

/** How much of each source there was to read: the digest's Read line. */
function readCounts(g, records) {
  return {
    logRows: records.length,
    undated: records.filter((r) => r.landed === null).length,
    stepsFiles: g.steps.size,
    stateFiles: g.states.length,
    sessions: g.sessions ?? 0,
    codexSessions: g.codex?.length ?? 0,
    ledgerRows: g.ledger ? g.ledger.length : null,
    claudeRunRows: g.claudeRuns ? g.claudeRuns.length : null,
  };
}

/**
 * What the Read line cannot say for itself: a figure that is missing or zero for a reason the
 * project can fix. A list of strings, empty when all is well. `claudeRows` says whether the window
 * holds a Claude transcript row, main or subagent: the sessions figure counts main-thread rows only.
 * `leftOut` is the log's rows no table took (estimate-core's leftOutRows).
 */
function warningsFor(d, records, claudeRows, leftOut = []) {
  const out = [];
  if (leftOut.length) out.push(leftOutWarning(leftOut));
  const undated = records.filter((r) => r.landed === null).length;
  if (undated) {
    out.push(`${undated} log row${undated === 1 ? ' has' : 's have'} no commit date, so every figure leaves ${undated === 1 ? 'it' : 'them'} out: a row not committed yet, or one edited since its commit (a Missed by harness filled after the land); commit the log, then run the retro again`);
  }
  const t = d.kpis.transcripts;
  const h = d.kpis.codexHost;
  const spent = [t?.claudeUsd > 0 ? `${usd(t.claudeUsd)} of Claude spend` : null, h?.sessions > 0 ? `${h.sessions} Codex thread${h.sessions === 1 ? '' : 's'}` : null].filter(Boolean);
  if (records.length === 0 && spent.length) {
    out.push(`${spent.join(' and ')} in the window against no log rows: the harness log is not being written, LOG names a file that is not the log, or its columns do not match`);
  }
  const units = d.kpis.log.units;
  if (units > 0 && !claudeRows && !(h?.sessions > 0)) {
    out.push(`${units} unit${units === 1 ? '' : 's'} landed in the window but no Claude Code session or Codex thread was read, so the cost and session figures are missing: the retro reads Claude Code and Codex sessions only (another host's are not read), and a wrong projects directory or CLAUDE_CONFIG_DIR gives the same`);
  }
  const q = d.queue.followUps;
  if (q && q.noStatus > 0 && q.open + q.scheduled + q.fixed + q.dropped + q.other === 0) {
    out.push(`the follow-ups doc has ${q.noStatus} rows, all in tables with no status column (looked for: ${STATUS_COLUMNS.join(', ')}): none is counted`);
  }
  return out;
}

/**
 * The window's landed product rows that were planned, not filed later (an id in `fuIds`, the follow-ups
 * doc's first-column ids, was filed), and the owner wait per landed product row: each unit's Owner wait
 * capped at OWNER_WAIT_CAP_MIN, summed, over the rows the units landed (productKpis' count); null with
 * no row or no wait.
 */
export function planKpis(records, since, until, fuIds = new Set()) {
  const rows = records.filter((r) => inWindow(r.landed, since, until) && !isHarnessUnit(r.id));
  const named = new Map();
  for (const r of rows) named.set(r.id, new Set([...(named.get(r.id) ?? []), ...r.batch]));
  let landed = 0;
  let originalRows = 0;
  for (const [id, batch] of named) {
    const ids = batch.size ? [...batch] : [id];
    landed += ids.length;
    originalRows += ids.filter((x) => !fuIds.has(x)).length;
  }
  const waits = groupUnits(rows).map((u) => u.ownerWait).filter(Number.isFinite);
  const total = waits.reduce((s, w) => s + Math.min(w, OWNER_WAIT_CAP_MIN), 0);
  return { originalRows, ownerWaitPerRowMin: landed > 0 && waits.length > 0 ? round1(total / landed) : null };
}

/**
 * The escaped-defect proxy over the window: the mainline's reverts, its fixes within DEFECT_DAYS after a
 * merge on that merge's files, and the open P0/P1 follow-ups filed in the window (`open`: openFollowUps).
 * With no git history read (`merges` null), the two git counts are null.
 */
export function escapedKpis({ merges = null, fixes = null, open = [] }, since, until) {
  const openP01 = open.filter((r) => inWindow(r.at, since, until) && r.sevs.some((s) => s === 'P0' || s === 'P1')).length;
  if (merges === null || fixes === null) return { reverts: null, fixes: null, openP01 };
  const inWin = fixes.filter((f) => FIX_SUBJECT.test(f.subject ?? '') && inWindow(f.t, since, until));
  const reverts = inWin.filter((f) => /^revert\b/i.test(f.subject));
  const linked = inWin.filter((f) => !/^revert\b/i.test(f.subject) && merges.some((m) => fixAfter(m, [f], DEFECT_DAYS)));
  return { reverts: reverts.length, fixes: linked.length, openP01 };
}

// A state file's unit from its path, for a file with no Unit: header.
const unitOfPath = (p) => (p ? String(p).replace(/^.*\//, '').replace(/\.state\.md$/, '') : null);

/**
 * Everything the digest and the export say, from what retro-gather read: `g` is { log: { text,
 * dates }, followUps: { text, dates } | null, states: [{ text, changed, path? }], steps: Map unit -> markers,
 * rows, events (each tagged with its session), commands (contextCommands, tagged the same), sessionUnits:
 * Map session -> Set of units, sessions, ledger: entries | null, codex: [parsed Codex threads],
 * claudeRuns: entries | null, merges and fixes: the mainline's (retro-gather's mainlineHistory) | absent,
 * previous: [data] }; `columns` as for logRecords.
 */
export function buildRetro(g, { project, now, since = null, until = null, columns = undefined }) {
  const win = windowFor({ since, until, now, previous: g.previous });
  const records = logRecords(g.log.text, g.log.dates, columns);
  const inWin = (ts) => inWindow(ts, win.since, win.until);
  const currentIds = new Set(records.filter((r) => inWin(r.landed)).map((r) => r.id));
  for (const [id, markers] of g.steps) if (markers.some((m) => inWin(m.ts))) currentIds.add(id);
  const ids = new Set([...records.map((r) => r.id), ...g.steps.keys()]);
  const agents = agentCosts(g.rows);
  const owners = dispatchOwners(agents, ids);
  const spans = new Map();
  for (const [id, markers] of g.steps) {
    if (markers.length === 0) continue;
    const { intervals } = stepIntervals(markers, Date.parse(win.until));
    spans.set(id, { rows: rowsForUnit(g.rows, g.sessionUnits, id, markers, win.until, owners), intervals });
  }
  const claimed = claimRows(spans, owners);
  const all = [];
  for (const id of ids) {
    const s = unitSteps(id, { markers: g.steps.get(id) ?? [], rows: claimed.get(id) ?? [], agents });
    if (s) all.push(s);
  }
  const states = g.states.map((s) => ({ ...stateSummary(s.text), changed: s.changed }));
  const recent = states.filter((s) => inWin(s.changed));
  const log = logKpis(records, win.since, win.until);
  const sum = (list, pick) => list.reduce((acc, s) => {
    for (const [k, v] of Object.entries(pick(s))) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
  // Every state file's decision rows feed the ask kinds (a rolling count, not the window's); the
  // window's grant rows are the dated ones dated in it, an undated one by its file's last change.
  const decisionList = g.states.flatMap((s) => decisionRows(s.text, unitOfPath(s.path)).map((r) => ({ ...r, changed: s.changed })));
  const ask = askKinds(decisionList);
  const history = Array.isArray(g.merges) && Array.isArray(g.fixes);
  const outcomes = decisionOutcomes(decisionList, { merges: history ? g.merges : [], fixes: history ? g.fixes : [] });
  const granted = outcomes.filter((r) => inWin(r.date === null ? r.changed : Date.parse(`${r.date}T00:00:00Z`)));
  const reversedN = granted.filter((r) => r.outcome === 'reversed').length;
  const linked = granted.filter((r) => r.outcome === 'defect-linked');
  const open = g.followUps ? openFollowUps(g.followUps.text, g.followUps.dates) : [];
  const owed = g.followUps ? owedRows(g.followUps.text, g.followUps.dates) : [];
  const oldestOwed = owed[0] ?? null;
  const d = {
    schema: 1,
    project,
    week: win.week,
    since: win.since,
    until: win.until,
    baselineSince: win.baselineSince,
    generated: iso(now),
    sources: readCounts(g, records),
    kpis: {
      log,
      product: productKpis(records, win.since, win.until),
      transcripts: g.rows.length ? transcriptKpis(g.rows, g.events, win) : null,
      owner: ownerKpis(g.events ?? [], g.commands ?? [], { ...win, units: log.units }),
      codex: g.ledger ? summarizeLedger(g.ledger, { since: win.since, until: win.until }) : null,
      codexHost: g.codex?.length ? codexHostKpis(g.codex, win) : null,
      claudeRuns: g.claudeRuns ? claudeRunKpis(g.claudeRuns, win) : null,
      plan: planKpis(records, win.since, win.until, g.followUps ? followUpIds(g.followUps.text) : new Set()),
      owed: oldestOwed ? { days: oldestOwed.at === null ? null : Math.floor((now - oldestOwed.at) / DAY), row: oldestOwed.id } : null,
      grants: { decisions: granted.length, reversed: reversedN, reversedPct: granted.length ? Math.round((reversedN / granted.length) * 100) : 0, defectLinked: linked.length },
      escaped: escapedKpis({ merges: history ? g.merges : null, fixes: history ? g.fixes : null, open }, win.since, win.until),
    },
    ask,
    promotions: promotions(decisionList, ask.ask),
    defectLinked: linked.map((r) => ({ unit: r.unit, id: r.id, decision: r.decision, fix: r.fix })),
    baseline: {
      log: logKpis(records, win.baselineSince, win.since),
      product: productKpis(records, win.baselineSince, win.since),
      transcripts: previousKpis(g.previous, win.week),
      owner: previousKpis(g.previous, win.week, 'owner'),
      codexHost: previousKpis(g.previous, win.week, 'codexHost'),
    },
    unitOutliers: unitOutliers(records, win),
    stepOutliers: stepOutliers(all, currentIds),
    steps: all.filter((u) => currentIds.has(u.unit)),
    stepShares: { markers: stepShares(all, 'markers'), descriptions: stepShares(all, 'descriptions') },
    stepYield: g.ledger ? stepYield(g.ledger, g.verdicts ?? new Map(), win) : null,
    friction: frictionThemes(records, win),
    frictionCells: records.filter((r) => r.friction && inWin(r.landed)).map((r) => ({ unit: r.id, friction: r.friction })),
    missed: records.filter((r) => r.missed && inWin(r.landed)).map((r) => ({ unit: r.id, missed: r.missed })),
    queue: {
      followUps: g.followUps ? followUpsSummary(g.followUps.text, g.followUps.dates, now) : null,
      stateP3: states.reduce((n, s) => n + s.p3, 0),
    },
    decisions: { units: recent.length, classes: sum(recent, (s) => s.classes), by: sum(recent, (s) => s.by), questions: recent.reduce((n, s) => n + s.questions, 0) },
  };
  d.warnings = warningsFor(d, records, g.rows.some((r) => inWin(r.ts)), leftOutRows(g.log.text));
  d.candidates = candidates(d);
  return d;
}

const hm = (m) => {
  const r = Math.round(m);
  return `${Math.floor(r / 60)}h${String(r % 60).padStart(2, '0')}m`;
};

/**
 * The plain lines under the KPI table: plan rows, owner wait, what is owed, the granted decisions and
 * what became of them, the ask kinds (always, so a reader can find the line), the promotions to put to
 * the owner and at most five defect-linked decisions for the owner to judge. A data object from before
 * these figures prints its defaults.
 */
function decisionLines(d, items) {
  const k = d.kpis ?? {};
  const pl = k.plan ?? {};
  const gr = k.grants ?? { decisions: 0, reversed: 0, reversedPct: 0, defectLinked: 0 };
  const es = k.escaped ?? { reverts: null, fixes: null, openP01: 0 };
  const n = (v) => (v === null || v === undefined ? '—' : String(v));
  const ask = d.ask ?? { ask: ASK_DEFAULT, demoted: [] };
  const linked = d.defectLinked ?? [];
  return [
    `Original plan rows: ${pl.originalRows ?? 0} this week`,
    `Owner wait per landed row: ${Number.isFinite(pl.ownerWaitPerRowMin) ? hm(pl.ownerWaitPerRowMin) : 'n/a'}`,
    `OWED oldest: ${k.owed ? `${k.owed.days === null ? '?' : k.owed.days} days (${cell(k.owed.row)})` : 'none'}`,
    `Grant decisions: ${gr.decisions} · reversed ${gr.reversed} (${gr.reversedPct}%) · defect-linked ${gr.defectLinked}`,
    `Escaped-defect proxy: ${n(es.reverts)} reverts · ${n(es.fixes)} fixes within ${DEFECT_DAYS} days of a merge, on its files · ${es.openP01} open P0/P1 follow-ups filed this week`,
    `Ask kinds: ${ask.ask.join(', ')}`,
    ...(ask.demoted.length ? [`Demoted: ${ask.demoted.map((x) => `${x.kind} ${x.reversed}/${x.of}`).join(', ')}`] : []),
    ...(d.promotions ?? []).map((p) => `Promote? ${p.kind}: took ${p.took}/${p.of} — one word from the owner widens the grant`),
    ...(linked.length
      ? [
          'Defect-linked decisions (judge them):',
          ...linked.slice(0, Math.min(5, Math.max(items, 1))).map((x) => `- ${x.unit}/${x.id} · ${clip(cell(x.decision), 60)} · ${String(x.fix.sha).slice(0, 7)} ${clip(cell(x.fix.subject), 50)}`),
        ]
      : []),
  ];
}

const perWeek = (n) => `${round1(n / BASELINE_WEEKS)}/wk`;
const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const cell = (s) => oneLine(s).replaceAll('|', '\\|');

/** The digest markdown; `items` caps each list and `width` each quoted cell (fitDigest shrinks both to fit). */
export function formatDigest(d, { items = 8, width = 160 } = {}) {
  const k = d.kpis.log;
  const b = d.baseline.log;
  const t = d.kpis.transcripts;
  const bt = d.baseline.transcripts;
  const base = (key, fmt) => (bt && bt[key] !== null && bt[key] !== undefined ? fmt(bt[key]) : '—');
  const s = d.sources ?? {};
  const L = [
    `# Retro ${d.week} — ${d.project}`,
    '',
    `Window ${d.since.slice(0, 16)}Z → ${d.until.slice(0, 16)}Z, baseline from ${d.baselineSince.slice(0, 10)} · generated by retro.mjs — regenerate, never edit by hand`,
    `Read: ${s.logRows ?? 0} log rows${s.undated ? ` (${s.undated} undated, left out)` : ''} · ${s.stepsFiles ?? 0} steps files · ${s.stateFiles ?? 0} state files · ${s.sessions ?? 0} sessions${s.codexSessions ? ` · ${s.codexSessions} Codex threads` : ''} · ${s.ledgerRows === null || s.ledgerRows === undefined ? 'no Codex ledger' : `${s.ledgerRows} Codex ledger rows`}${s.claudeRunRows === null || s.claudeRunRows === undefined ? '' : ` · ${s.claudeRunRows} claude-run ledger rows`}`,
    ...(d.warnings ?? []).map((w) => `Warn: ${oneLine(w)}`),
    '',
    '## KPIs',
    '',
    '| Metric | This window | Previous 4 weeks |',
    '|---|---|---|',
    `| Units landed | ${k.units} | ${perWeek(b.units)} |`,
    `| Work per unit (median) | ${minutes(k.work)} | ${minutes(b.work)} |`,
    `| Owner wait per unit (median) | ${minutes(k.ownerWait)} | ${minutes(b.ownerWait)} |`,
    `| Cost per unit (median) | ${k.cost === null ? '—' : usd(k.cost)} | ${b.cost === null ? '—' : usd(b.cost)} |`,
    `| P0 / P1 found | ${k.p0} / ${k.p1} | ${perWeek(b.p0)} / ${perWeek(b.p1)} |`,
    `| Rows with Missed by harness | ${k.missed} | ${perWeek(b.missed)} |`,
  ];
  const p = d.kpis.product;
  const bp = d.baseline.product;
  if (p) {
    L.push(
      `| Harness units: share by count · by cost | ${p.harness} of ${p.units} (${pct(p.share)} · ${pct(p.costShare)}) | ${pct(bp?.share)} · ${pct(bp?.costShare)} |`,
      `| Product plan rows per day | ${p.perDay ?? '—'} (${p.productRows} row${p.productRows === 1 ? '' : 's'}) | ${bp?.perDay ?? '—'} |`,
    );
  }
  if (t) {
    L.push(
      `| Claude spend (main · subagents) | ${usd(t.claudeUsd)} (${usd(t.mainUsd)} · ${usd(t.subUsd)}) | ${base('claudeUsd', usd)} |`,
      `| Sessions · questions asked | ${t.sessions} · ${t.questions} | ${base('sessions', String)} · ${base('questions', String)} |`,
      `| Compactions (auto) · median tokens before | ${t.compactions} (${t.autoCompactions}) · ${t.compactPreTokens} | ${base('compactions', String)} · ${base('compactPreTokens', String)} |`,
      `| Cache hit · expiry rewrites | ${t.cacheHit}% · ${t.rewrites} (${usd(t.rewriteUsd)}, ${t.rewriteShare}% of main) | ${base('cacheHit', (v) => `${v}%`)} · ${base('rewriteShare', (v) => `${v}% of main`)} |`,
    );
  } else L.push('| Transcripts | none found for this repository | — |');
  const o = d.kpis.owner;
  if (o) {
    const bo = d.baseline.owner;
    const ob = (key, fmt = String) => (bo && bo[key] !== null && bo[key] !== undefined ? fmt(bo[key]) : '—');
    const per = (v) => (v === null || v === undefined ? '—' : String(v));
    L.push(
      `| Owner prompts per unit | ${per(o.promptsPerUnit)} (${o.prompts} ÷ ${k.units} unit${k.units === 1 ? '' : 's'}) | ${ob('promptsPerUnit')} |`,
      `| /clear · /compact per unit | ${per(o.commandsPerUnit)} (${o.clears} · ${o.compacts}) | ${ob('commandsPerUnit')} |`,
      `| Agent run between owner prompts (median) | ${span(o.runMin)} | ${ob('runMin', span)} |`,
    );
  }
  const r = d.kpis.claudeRuns;
  if (r) L.push(`| Claude runs (claude-run) · spend | ${r.runs} · ${usd(r.usd)} | — |`);
  const c = d.kpis.codex;
  L.push(c ? `| Codex runs · weekly quota used | ${c.runs} · ${c.percent}% | — |` : '| Codex | no ledger | — |');
  const h = d.kpis.codexHost;
  if (h) {
    const bh = d.baseline.codexHost;
    const hb = (key, fmt = String) => (bh && bh[key] !== null && bh[key] !== undefined ? fmt(bh[key]) : '—');
    L.push(
      `| Codex host: sessions · turns · questions asked | ${h.sessions} · ${h.turns} · ${h.questions} | ${hb('sessions')} · ${hb('turns')} · ${hb('questions')} |`,
      `| Codex host: tokens (input cached) · weekly quota used | ${fmtTokens(h.tokens)} (${h.cacheHit}%) · ${h.percent}% | ${hb('tokens', fmtTokens)} (${hb('cacheHit', (v) => `${v}%`)}) · ${hb('percent', (v) => `${v}%`)} |`,
      `| Codex host: compactions · median tokens before | ${h.compactions} · ${h.compactPreTokens} | ${hb('compactions')} · ${hb('compactPreTokens')} |`,
    );
  }
  L.push('', ...decisionLines(d, items), '');

  L.push('## Outliers', '');
  const outliers = [
    ...d.stepOutliers.map((o) => `- ${o.unit} step ${o.step}: ${usd(o.usd)}, ${o.share}% of the unit, ${o.x}× the median ${o.median}% (n=${o.n}, ${o.source})`),
    ...d.unitOutliers.map((o) => `- ${o.unit} ${o.metric}: ${o.metric === 'cost' ? usd(o.value) : minutes(o.value)}, ${o.x}× ${cohortName(o.tier)} (n=${o.n})`),
  ];
  L.push(...(outliers.length ? outliers.slice(0, items) : [`- none (a cohort needs ${MIN_COHORT} units)`]), '');

  L.push('## Where the money went, by step', '');
  const stepLines = d.steps.map((u) => {
    const top = [...u.steps].sort((x, y) => y.usd - x.usd).slice(0, 4);
    const how = u.source === 'markers' ? 'markers' : 'dispatch descriptions, subagents only';
    return `- ${u.unit} (${how}): ${usd(u.total)} — ${top.map((x) => `${x.step} ${usd(x.usd)} (${x.share}%)`).join(' · ')}`;
  });
  L.push(...(stepLines.length ? stepLines.slice(0, items) : ['- no step data: no markers and no dispatch that names a unit']));
  for (const [source, how] of [['markers', 'markers'], ['descriptions', 'dispatch descriptions']]) {
    const shares = d.stepShares[source].filter((x) => x.n >= MIN_COHORT);
    if (shares.length) L.push(`- Median share by step (${how}): ${shares.slice(0, 6).map((x) => `${x.step} ${x.median}% (n=${x.n})`).join(' · ')}`);
  }
  L.push('');

  L.push('## Yield by step (Codex verdicts)', '');
  const y = d.stepYield;
  if (!y) L.push('- no Codex ledger');
  else if (y.length === 0) L.push('- no ok Codex run this window');
  else {
    L.push('| Step (kind) | Runs | Verdicts kept | With a P0/P1 | P0/P1 lines |', '|---|---|---|---|---|');
    for (const s of y) L.push(`| ${s.kind} | ${s.runs} | ${s.kept} | ${s.rate === null ? '—' : `${s.hits} (${s.rate}%)`} | ${s.p0p1} |`);
    const lost = y.reduce((n, s) => n + s.runs - s.kept, 0);
    if (lost) L.push('', `- ${lost} ok run${lost === 1 ? '' : 's'} with no kept verdict (codex-run copies each into the ledger's verdicts/ since v12)`);
  }
  L.push('');

  L.push('## Friction', '');
  const themes = d.friction.map((f) => `- "${f.word}" — ${clip(f.units.join(', '), width)}`);
  const cells = d.frictionCells.map((f) => `- ${f.unit}: ${clip(cell(f.friction), width)}`);
  L.push(...(themes.length ? ['Repeated:', ...themes.slice(0, items)] : ['Repeated: none']));
  if (cells.length) L.push('This window:', ...cells.slice(0, items));
  L.push('');

  L.push('## Missed by harness', '');
  const missed = d.missed.map((m) => `- ${m.unit}: ${clip(cell(m.missed), width)}`);
  L.push(...(missed.length ? missed.slice(0, items) : ['- none this window']), '');

  L.push('## Queue', '');
  const q = d.queue.followUps;
  L.push(
    q
      ? `- Follow-ups: ${q.open} open (${q.openP3} naming a P3${q.oldestOpenP3Row ? `, the oldest ${q.oldestOpenP3Row} at ${q.oldestOpenP3Days} d` : ''}; oldest ${q.oldestOpenDays === null ? '—' : `${q.oldestOpenDays} d`}) · ${q.scheduled} scheduled · ${q.fixed} fixed · ${q.dropped} dropped${q.noStatus ? ` · ${q.noStatus} rows in tables with no status column, left out` : ''}`
      : '- Follow-ups: no doc',
    `- P3 findings still to do in state files: ${d.queue.stateP3}`,
  );
  const dc = d.decisions;
  if (dc.units) {
    const cl = dc.classes;
    const by = dc.by;
    const un = cl.unclassified ? ` · ${cl.unclassified} unclassified (no Class column)` : '';
    L.push(`- Decisions in ${dc.units} state files changed this window: P ${cl.P ?? 0} · C ${cl.C ?? 0} · T ${cl.T ?? 0}${un} (owner ${by.owner ?? 0}${by.ownerOther ? ` · owner-other ${by.ownerOther}` : ''}${by.grant ? ` · grant ${by.grant}` : ''} · default ${by.default ?? 0} · agent ${by.agent ?? 0}) · open questions ${dc.questions}`);
  }
  L.push('');

  L.push('## Candidates for the retro review', '');
  L.push(...(d.candidates.length ? d.candidates.map((x, i) => `${i + 1}. [${x.kind}] ${clip(cell(x.text), width + 40)} — ${x.evidence}`) : ['- none']), '');
  L.push(`<!-- retro-data ${JSON.stringify({ week: d.week, since: d.since, until: d.until, kpis: d.kpis })} -->`, '');
  return L.join('\n');
}

/** The digest within MAX_BYTES: lists and quoted cells shrink until it fits. */
export function fitDigest(d) {
  const size = (s) => new TextEncoder().encode(s).length;
  let text = '';
  for (const [items, width] of [[8, 160], [5, 120], [3, 80], [1, 60], [0, 40]]) {
    text = formatDigest(d, { items, width });
    if (size(text) <= MAX_BYTES) return text;
  }
  return text;
}
