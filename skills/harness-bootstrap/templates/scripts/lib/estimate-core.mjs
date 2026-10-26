// harness-bootstrap estimate core (generated YYYY-MM-DD). Pure core of scripts/estimate.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- the log's column header names, the tiers and the history threshold, each re-derived
// from the project's own harness log.
/**
 * Turns the harness log's rows into a RANGE (p25-p75) for work time, owner wait, Claude % and
 * Codex %, so Gate 1 can show the owner a range and say "no history" when there is none. No I/O
 * here, so `estimate-core.test.mjs` can pin each rule.
 *
 * WHY A RANGE. The origin project's units ran in two regimes ten times apart (22-59 min clean,
 * 99-526 min with defects), so one number is always wrong in one direction. A quartile range from
 * the project's own rows shows the spread; below a handful of rows it shows nothing and says so
 * instead of inventing a median.
 */
import { splitRow } from './unit-record-core.mjs';

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
  slices: 'slices',
  scope: 'scope',
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
  const a = { log: null, tier: null, cohort: null, slices: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--log' || t === '--tier' || t === '--cohort' || t === '--slices') {
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
  if (a.slices !== null) {
    const n = Number(a.slices);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--slices must be a whole number >= 1 (got "${a.slices}")`);
    a.slices = n;
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

const norm = (c) => c.toLowerCase().replace(/^[\s*★]+/, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
const findCol = (names, prefix) => names.findIndex((n) => n.startsWith(prefix));

/** The log text -> one record per usable table row, from every table that has Unit and Elapsed/Cost columns. */
export function parseLog(text) {
  const tables = [];
  let prev = null;
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) {
      prev = null;
      current = null;
      continue;
    }
    const cells = splitRow(line);
    if (cells.length > 0 && cells.every((c) => SEPARATOR.test(c))) {
      if (prev && !current) {
        current = { names: prev.map(norm), rows: [] };
        tables.push(current);
      }
      continue;
    }
    if (current) current.rows.push(cells);
    prev = cells;
  }
  const records = [];
  for (const { names, rows } of tables) {
    const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, v]) => [k, findCol(names, v)]));
    if (col.unit === -1 || (col.elapsed === -1 && col.cost === -1)) continue;
    const at = (cells, k) => (col[k] === -1 ? '' : (cells[col[k]] ?? ''));
    for (const cells of rows) {
      const first = cells[col.unit] ?? '';
      if (!first) continue;
      const parts = first.split('·').map((s) => s.trim());
      const tier = col.tier !== -1 ? tierWord(at(cells, 'tier')) : tierWord(parts.length > 1 ? parts.at(-1) : '');
      const elapsed = parseElapsed(at(cells, 'elapsed'));
      const wait = col.ownerWait !== -1 ? parseDuration(at(cells, 'ownerWait')) : null;
      const sliceCell = /(\d+)\s+slices?\b/i.exec(at(cells, 'scope'));
      const sliceCount = col.slices !== -1 ? Number.parseInt(at(cells, 'slices'), 10) : sliceCell ? Number(sliceCell[1]) : NaN;
      const cost = parseCost(at(cells, 'cost'));
      const usable = !UNUSABLE.test(at(cells, 'elapsed'));
      records.push({
        unit: first,
        type: at(cells, 'type'),
        tier,
        work: usable ? elapsed.work : null,
        ownerWait: usable ? (wait ?? elapsed.ownerWait) : null,
        claudePct: cost.claudePct,
        codexPct: cost.codexPct,
        cost: cost.cost,
        slices: Number.isFinite(sliceCount) && sliceCount > 0 ? sliceCount : null,
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

function stat(values) {
  const n = values.length;
  if (n < MIN_ROWS) return { n, noHistory: true, message: `no history (n=${n}, need ${MIN_ROWS})` };
  return { n, p25: percentile(values, 0.25), median: percentile(values, 0.5), p75: percentile(values, 0.75) };
}

/** Per-metric ranges for the rows, plus a per-slice range scaled to `slices` when given. */
export function estimate(records, { tier = null, cohort = null, slices = null } = {}) {
  const rows = filterRows(records, { tier, cohort });
  const out = { tier, rows: rows.length, metrics: {}, perSlice: null, slices };
  for (const key of Object.keys(METRICS)) {
    out.metrics[key] = stat(rows.map((r) => r[key]).filter(Number.isFinite));
  }
  if (slices !== null) {
    out.perSlice = {};
    for (const key of Object.keys(METRICS)) {
      const scaled = rows.filter((r) => r.slices !== null && Number.isFinite(r[key])).map((r) => (r[key] / r.slices) * slices);
      out.perSlice[key] = stat(scaled);
    }
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
  return `Estimate (${tier}, n=${est.rows}): work ${range(m.work, fmtMinutes)} · owner wait ${range(m.ownerWait, fmtMinutes)} · Claude ${range(m.claudePct, fmtPct, '%')} · Codex ${range(m.codexPct, fmtPct, '%')} — a range from this project's log, not a promise`;
}

/** The line plus a median detail per metric, and the per-slice ranges when asked for. */
export function formatReport(est) {
  const fmts = { work: fmtMinutes, ownerWait: fmtMinutes, claudePct: fmtPct, codexPct: fmtPct };
  const detail = (label, s, fmt) =>
    `  ${label}: ${s.noHistory ? s.message : `n=${s.n} · p25 ${fmt(s.p25)} · median ${fmt(s.median)} · p75 ${fmt(s.p75)}`}`;
  const lines = [formatLine(est)];
  for (const [k, label] of Object.entries(METRICS)) lines.push(detail(label, est.metrics[k], fmts[k]));
  if (est.perSlice) {
    lines.push(`Per slice, scaled to ${est.slices} slice${est.slices === 1 ? '' : 's'}:`);
    for (const [k, label] of Object.entries(METRICS)) lines.push(detail(label, est.perSlice[k], fmts[k]));
  }
  return `${lines.join('\n')}\n`;
}
