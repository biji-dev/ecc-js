// harness-bootstrap estimate core (generated YYYY-MM-DD). Pure core of scripts/estimate.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- the log's column header names, the tiers and the history threshold, each re-derived
// from the project's own harness log.
/**
 * Turns the harness log's rows into a RANGE (p25-p75) for work time, owner wait, Claude % and
 * Codex % PER UNIT, so Gate 1 can show the owner a range and say "no history" when there is none.
 * A unit with several deliverable rows is one sample: its rows are summed. No I/O
 * here, so `estimate-core.test.mjs` can pin each rule.
 *
 * WHY A RANGE. The origin project's units ran in two regimes ten times apart (22-59 min clean,
 * 99-526 min with defects), so one number is always wrong in one direction. A quartile range from
 * the project's own rows shows the spread; below a handful of rows it shows nothing and says so
 * instead of inventing a median.
 */
import { parseOwnerWait, splitRow } from './unit-record-core.mjs';

// ---- [B] project bindings
// [B] How many rows a metric needs before it is shown (the log's own "armed at 3" rule).
export const MIN_ROWS = 3;
// [B] The tiers a Gate 1 estimate can be asked for.
export const TIERS = ['small', 'full'];
// [B] The log's column headers, matched case-insensitively by prefix (a leading `★` or `*` ignored).
export const COLUMNS = {
  unit: 'unit',
  type: 'type',
  tier: 'tier',
  elapsed: 'elapsed',
  ownerWait: 'owner wait',
  cost: 'cost',
};
// ---- end [B]

// metric key -> label in the estimate line
export const METRICS = {
  work: 'work',
  ownerWait: 'owner wait',
  claudePct: 'Claude',
  codexPct: 'Codex',
};
const SEPARATOR = /^:?-+:?$/;
const UNUSABLE = /unreconcil|unusable|excluded/i;
// One duration: 1h20m, 5h, ~2h55 (minutes with no unit), 93.5 min, 189m.
const DUR =
  '~?(\\d+(?:\\.\\d+)?)\\s*(?:h(?:ours?|rs?)?(?![a-z])\\s*(?:(\\d{1,2})(?!\\d)\\s*(?:m(?:ins?|inutes?)?(?![a-z]))?)?|m(?:ins?|inutes?)?(?![a-z]))';

/** Reject unknown flags and a missing --log before any file is read. */
export function parseArgs(argv) {
  const a = { log: null, tier: null, cohort: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--log' || t === '--tier' || t === '--cohort') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[t.slice(2)] = v;
    } else throw new Error(`unknown option ${t}`);
  }
  if (!a.log) throw new Error('--log <docs/harness/log.md> is required');
  if (a.tier !== null) {
    a.tier = a.tier.toLowerCase();
    if (!TIERS.includes(a.tier)) throw new Error(`--tier must be one of ${TIERS.join('|')} (got "${a.tier}")`);
  }
  if (a.cohort !== null) {
    try {
      a.cohort = new RegExp(a.cohort, 'i');
    } catch (e) {
      throw new Error(`--cohort is not a regular expression: ${e.message}`, { cause: e });
    }
  }
  return a;
}

/** The first duration in `text` as minutes, or null. Accepts 189m, 1h20m, 5h43m, ~2h55, 93.5 min. */
export function parseDuration(text) {
  const m = new RegExp(DUR, 'i').exec(String(text ?? ''));
  return m ? durationOf(m) : null;
}

function durationOf(m) {
  const n = Number(m[1]);
  return /h/i.test(m[0]) ? n * 60 + (m[2] === undefined ? 0 : Number(m[2])) : n;
}

/** Linear-interpolation percentile (p in 0..1) of numbers; null for an empty list. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const v = [...values].sort((x, y) => x - y);
  const pos = (v.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** First word of a tier cell, lowercased, when it is a known tier word; else ''. */
export function tierWord(cell) {
  const m = /^\W*(trivial|small|full|docs)\b/i.exec(String(cell ?? ''));
  return m ? m[1].toLowerCase() : '';
}

/** Work time and owner wait (minutes) from an Elapsed cell like "work 189m · owner 308m" or "59 min from claim". */
export function parseElapsed(cell) {
  const text = String(cell ?? '');
  const work = new RegExp(`work\\s*[:=]?\\s*${DUR}`, 'i').exec(text);
  const owner =
    new RegExp(`owner(?:[\\s-]*wait)?\\s*[:=]?\\s*${DUR}`, 'i').exec(text) ??
    new RegExp(`${DUR}\\s*(?:of\\s+)?(?:owner[\\s-]*)?wait`, 'i').exec(text);
  const first = new RegExp(DUR, 'i').exec(owner ? text.replace(owner[0], ' ') : text);
  const pick = work ?? first;
  return { work: pick ? durationOf(pick) : null, ownerWait: owner ? durationOf(owner) : null };
}

/** `$<x>`, `Claude <p>%` and `Codex <q>%` from a Cost cell; each null when absent. */
export function parseCost(cell) {
  const text = String(cell ?? '');
  const grab = (re) => {
    const m = re.exec(text);
    return m ? Number(m[1].replace(',', '.')) : null;
  };
  return {
    cost: grab(/\$\s*(\d+(?:[.,]\d+)?)/),
    claudePct: grab(/claude\s*~?\s*(\d+(?:\.\d+)?)\s*%/i),
    codexPct: grab(/codex\s*~?\s*(\d+(?:\.\d+)?)\s*%/i),
  };
}

/**
 * An Owner wait cell -> minutes. unit-record writes it as summed durations (`10m + 60m`) or as
 * `asked <ISO> → answered <ISO>` pairs, so unit-record-core's parser sums every term; text it cannot
 * read (a looser phrase such as `~2h55`) falls back to the first duration in it.
 */
export function ownerWaitMinutes(cell) {
  const wait = parseOwnerWait(cell, null);
  return wait === null ? parseDuration(cell) : wait.ms / 60_000;
}

const norm = (c) => c.toLowerCase().replace(/^[\s*★]+/, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
const findCol = (names, prefix) => names.findIndex((n) => n.startsWith(prefix));

/**
 * Every markdown table in `text`: its normalised header names and its rows, each with its 1-based
 * line. A row with no header of its own -- rows appended below a later table -- continues the
 * nearest earlier table with as many columns as it has cells, or is dropped.
 */
export function tables(text) {
  const out = [];
  let prev = null;
  let current = null;
  let loose = [];
  const adopt = () => {
    for (const r of loose) out.findLast((x) => x.names.length === r.cells.length)?.rows.push(r);
    loose = [];
  };
  for (const [i, line] of String(text ?? '').split(/\r?\n/).entries()) {
    if (!line.trim().startsWith('|')) {
      if (!current) adopt();
      prev = null;
      current = null;
      loose = [];
      continue;
    }
    const cells = splitRow(line);
    if (cells.length > 0 && cells.every((c) => SEPARATOR.test(c))) {
      if (prev && !current) {
        current = { names: prev.map(norm), rows: [] };
        out.push(current);
        loose = [];
      }
      continue;
    }
    if (current) current.rows.push({ cells, line: i + 1 });
    else loose.push({ cells, line: i + 1 });
    prev = cells;
  }
  if (!current) adopt();
  return out;
}

/**
 * The log text -> one record per usable table row, from every table that has Unit and Elapsed/Cost
 * columns. With `raw`, a record also carries its 1-based `line` and its table's normalised column
 * `names` and raw `cells`, so a reader of other columns (retro-core) parses the log the same way.
 * `columns` replaces COLUMNS for a reader that cannot see this project's binding (the weekly job).
 */
const isLogTable = (col) => col.unit !== -1 && (col.elapsed !== -1 || col.cost !== -1);

/** Whether the text holds a harness-log table, rows or not: a fresh install's log has headers only. */
export function hasLogTable(text, { columns = COLUMNS } = {}) {
  return tables(text).some(({ names }) => isLogTable(Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, findCol(names, v)]))));
}

export function parseLog(text, { raw = false, columns = COLUMNS } = {}) {
  const records = [];
  for (const { names, rows } of tables(text)) {
    const col = Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, findCol(names, v)]));
    if (!isLogTable(col)) continue;
    const at = (cells, k) => (col[k] === -1 ? '' : (cells[col[k]] ?? ''));
    for (const { cells, line } of rows) {
      const first = cells[col.unit] ?? '';
      if (!first) continue;
      const parts = first.split('·').map((s) => s.trim());
      const tier = col.tier !== -1 ? tierWord(at(cells, 'tier')) : tierWord(parts.length > 1 ? parts.at(-1) : '');
      const elapsed = parseElapsed(at(cells, 'elapsed'));
      const wait = col.ownerWait !== -1 ? ownerWaitMinutes(at(cells, 'ownerWait')) : null;
      const cost = parseCost(at(cells, 'cost'));
      const usable = !UNUSABLE.test(at(cells, 'elapsed'));
      records.push({
        unit: first,
        id: parts[0].replace(/^[`*]+|[`*]+$/g, ''),
        type: at(cells, 'type'),
        tier,
        work: usable ? elapsed.work : null,
        ownerWait: usable ? (wait ?? elapsed.ownerWait) : null,
        claudePct: cost.claudePct,
        codexPct: cost.codexPct,
        cost: cost.cost,
        ...(raw ? { line, names, cells } : {}),
      });
    }
  }
  return records;
}

/** Rows of one tier (when given) whose Unit or Type cell matches the cohort regex (when given). */
export function filterRows(records, { tier = null, cohort = null } = {}) {
  return records.filter(
    (r) => (tier === null || r.tier === tier) && (cohort === null || cohort.test(r.unit) || cohort.test(r.type)),
  );
}

const sumKnown = (rows, key) => {
  const v = rows.map((r) => r[key]).filter(Number.isFinite);
  return v.length === 0 ? null : v.reduce((x, y) => x + y, 0);
};

/**
 * Rows -> one record per unit, by the id in the first cell (the part before ` · `). A unit with
 * several deliverable rows is one sample: work, owner wait, cost and the two percents are summed
 * over its rows (a metric no row of the unit has stays null); tier and type come from its first row.
 */
export function groupUnits(records) {
  const byId = new Map();
  for (const r of records) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }
  return [...byId.values()].map((rows) => ({
    ...rows[0],
    rows: rows.length,
    ...Object.fromEntries(Object.keys(METRICS).map((k) => [k, sumKnown(rows, k)])),
    cost: sumKnown(rows, 'cost'),
  }));
}

function stat(values) {
  const n = values.length;
  if (n < MIN_ROWS) return { n, noHistory: true, message: `no history (n=${n}, need ${MIN_ROWS})` };
  return { n, p25: percentile(values, 0.25), median: percentile(values, 0.5), p75: percentile(values, 0.75) };
}

/** Per-metric ranges, one sample per unit among the rows of the tier and cohort asked for. */
export function estimate(records, { tier = null, cohort = null } = {}) {
  const units = groupUnits(filterRows(records, { tier, cohort }));
  const out = { tier, rows: units.length, metrics: {} };
  for (const key of Object.keys(METRICS)) {
    out.metrics[key] = stat(units.map((u) => u[key]).filter(Number.isFinite));
  }
  return out;
}

export function fmtMinutes(m) {
  const r = Math.round(m);
  return r < 60 ? `${r}m` : `${Math.floor(r / 60)}h${String(r % 60).padStart(2, '0')}m`;
}
export const fmtPct = (v) => `${Number(v.toFixed(1))}`;

const range = (s, fmt, unit = '') => (s.noHistory ? s.message : `${fmt(s.p25)}–${fmt(s.p75)}${unit}`);

/** The one Gate 1 line. */
export function formatLine(est) {
  const m = est.metrics;
  const tier = est.tier ?? 'all tiers';
  return `Estimate per unit (${tier}, n=${est.rows} units): work ${range(m.work, fmtMinutes)} · owner wait ${range(m.ownerWait, fmtMinutes)} · Claude ${range(m.claudePct, fmtPct, '%')} · Codex ${range(m.codexPct, fmtPct, '%')} — a range from this project's log, not a promise`;
}

/** The line plus a median detail per metric. */
export function formatReport(est) {
  const fmts = { work: fmtMinutes, ownerWait: fmtMinutes, claudePct: fmtPct, codexPct: fmtPct };
  const detail = (label, s, fmt) =>
    `  ${label}: ${s.noHistory ? s.message : `n=${s.n} · p25 ${fmt(s.p25)} · median ${fmt(s.median)} · p75 ${fmt(s.p75)}`}`;
  const lines = [formatLine(est)];
  for (const [k, label] of Object.entries(METRICS)) lines.push(detail(label, est.metrics[k], fmts[k]));
  return `${lines.join('\n')}\n`;
}
