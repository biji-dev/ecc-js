// harness-bootstrap retro core (generated YYYY-MM-DD). Pure core of scripts/retro.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- where the digests, the log, the follow-ups doc and the plans live, the log columns the
// retro adds, the outlier rule, the alert levels and the step words, each re-derived from the project.
/**
 * The retro: what the last week of units cost and where it went, against the four weeks before it,
 * from the harness log, the steps and state files, the follow-ups doc, the transcripts and the Codex
 * ledger. No I/O here (scripts/lib/retro-gather.mjs reads the files), so `retro-core.test.mjs` can
 * pin each rule.
 *
 * WHY A DIGEST. Every harness round so far started because the owner asked: the learning loop was
 * the owner's memory. Transcripts expire after 21 days, and an observer that kept 209 MB of
 * observations produced no instinct. A short committed digest -- a few numbers against their own
 * history, the outliers, the repeated friction and at most five candidates -- is what a reviewer, or
 * the next round, can read in one pass.
 */
import { fmtMinutes, groupUnits, parseLog, percentile, tables } from './estimate-core.mjs';
import {
  dedupeRows,
  inWindow,
  parseTag,
  summarizeCache,
  summarizeClaude,
  summarizeCompactions,
  summarizeLedger,
  summarizeSteps,
} from './unit-cost-core.mjs';
import { parseState } from './unit-record-core.mjs';
import { stepIntervals } from './unit-step-core.mjs';

// ---- [B] project bindings
// [B] Where the digests go (committed), and where the log, the follow-ups doc and the unit plans
// (state and steps files) live.
export const REPORTS_DIR = 'docs/harness/reports';
export const LOG = 'docs/harness/log.md';
export const FOLLOW_UPS = 'docs/harness/follow-ups.md';
export const PLANS_DIR = 'docs/plans';
// [B] The log columns the retro reads beyond estimate-core's COLUMNS, matched the same way (prefix).
export const EXTRA_COLUMNS = { defects: 'defects', missed: 'missed by harness', friction: 'friction' };
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
const DAY = 86_400_000;
const WEEK = 7 * DAY;
// The runner's steps in sequence order (`runner.md` › The sequence), for listing.
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
const MARKER_CMD = /unit-step\.mjs\s+([A-Za-z0-9][A-Za-z0-9._-]*)(?=[\s"\\]|$)/g;
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

/** A Defects cell -> { p0, p1 }: `0/2`, `P0 0 · P1 2` or an older `2C/6H`; null when it says none of these. */
export function parseDefects(cell) {
  const text = String(cell ?? '');
  const m =
    /P0\D{0,3}(\d+)\D+?P1\D{0,3}(\d+)/i.exec(text) ?? /(\d+)\s*C\b\D*?(\d+)\s*H\b/i.exec(text) ?? /(\d+)\s*\/\s*(\d+)/.exec(text);
  return m ? { p0: Number(m[1]), p1: Number(m[2]) } : null;
}

/**
 * The log's rows: estimate-core's fields, the Defects, Missed by harness and Friction cells, and
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
      landed: lineDates.get(r.line) ?? null,
    };
  });
}

/** The follow-ups doc -> rows by Status, the open ones that name a P3, and the age in days of the oldest open row and the oldest open P3. */
export function followUpsSummary(text, lineDates = new Map(), now = Date.now()) {
  const out = { open: 0, scheduled: 0, fixed: 0, dropped: 0, other: 0, openP3: 0, oldestOpenDays: null, oldestOpenP3Days: null };
  let oldest = null;
  let oldestP3 = null;
  for (const { names, rows } of tables(text)) {
    const st = names.findIndex((n) => n.startsWith('status'));
    if (st === -1) continue;
    for (const { cells, line } of rows) {
      const kind = /^(open|scheduled|fixed|dropped)\b/i.exec(String(cells[st] ?? '').trim())?.[1].toLowerCase() ?? 'other';
      out[kind] += 1;
      if (kind !== 'open') continue;
      const p3 = cells.some((c) => /\bP3\b/.test(c));
      if (p3) out.openP3 += 1;
      const at = lineDates.get(line);
      if (!Number.isFinite(at)) continue;
      if (oldest === null || at < oldest) oldest = at;
      if (p3 && (oldestP3 === null || at < oldestP3)) oldestP3 = at;
    }
  }
  if (oldest !== null) out.oldestOpenDays = Math.floor((now - oldest) / DAY);
  if (oldestP3 !== null) out.oldestOpenP3Days = Math.floor((now - oldestP3) / DAY);
  return out;
}

/**
 * One state file -> its unit, its decision log by Class (a table with no Class column counts as
 * unclassified) and By, its open questions and its P3 findings still to do.
 */
export function stateSummary(text) {
  const state = parseState(String(text ?? ''));
  const classes = { P: 0, C: 0, T: 0, other: 0, unclassified: 0 };
  const by = { owner: 0, default: 0, agent: 0, other: 0 };
  let questions = 0;
  for (const section of String(text ?? '').split(/^(?=##\s)/m)) {
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
        if (bi !== -1) by[/owner|default|agent/i.exec(cells[bi] ?? '')?.[0].toLowerCase() ?? 'other'] += 1;
      }
    }
  }
  const p3 = state.findings.filter((f) => f.sev === 'P3' && (f.status === 'open' || f.status === 'follow-up')).length;
  return { unit: state.header.unit, classes, by, questions, p3 };
}

/** The units a main-thread transcript wrote step markers for, from its `unit-step.mjs <unit>` commands. */
export function markerUnits(text) {
  return new Set([...String(text ?? '').matchAll(MARKER_CMD)].map((m) => m[1]));
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
  const med = (k) => {
    const m = median(units.map((u) => u[k]));
    return m === null ? null : round1(m);
  };
  return {
    units: units.length,
    work: med('work'),
    ownerWait: med('ownerWait'),
    cost: med('cost'),
    p0: rows.reduce((s, r) => s + (r.defects?.p0 ?? 0), 0),
    p1: rows.reduce((s, r) => s + (r.defects?.p1 ?? 0), 0),
    missed: rows.filter((r) => r.missed).length,
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

/** Each transcript KPI's median over the newest BASELINE_WEEKS earlier digests of weeks before `week`; null with none. */
export function previousKpis(previous, week) {
  const list = previous
    .filter((p) => p.week < week && p.kpis?.transcripts)
    .sort((x, y) => (x.week < y.week ? 1 : -1))
    .slice(0, BASELINE_WEEKS);
  if (list.length === 0) return null;
  const out = { weeks: list.length };
  for (const k of Object.keys(list[0].kpis.transcripts)) {
    const m = median(list.map((p) => p.kpis.transcripts[k]));
    out[k] = m === null ? null : round1(m);
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
          out.push({ unit: u.id, tier: tier || null, metric, value: u[metric], median: round1(med), x: round1(u[metric] / med), n: cohort.length });
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
 * every slot: what the owner caught, cache-expiry rewrites, step outliers, unit outliers, repeated
 * friction, an old queue -- then the second of each, and so on.
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
      text: `cache-expiry rewrites cost ${usd(t.rewriteUsd)}, ${t.rewriteShare}% of main-thread spend (${t.rewrites}): end the turn at owner gates (context.md › The gate wait)`,
      evidence: 'transcripts',
    });
  }
  const q = d.queue.followUps;
  if (q && q.oldestOpenDays !== null && q.oldestOpenDays >= QUEUE_ALERT_DAYS) {
    sources[5].push({ kind: 'machinery', text: `the oldest open follow-up is ${q.oldestOpenDays} days old (${q.open} open, ${q.openP3} naming a P3): a hygiene unit is due`, evidence: 'follow-ups doc' });
  }
  const out = [];
  for (let i = 0; out.length < MAX_CANDIDATES && sources.some((s) => s.length > i); i++) {
    for (const s of sources) if (s[i] && out.length < MAX_CANDIDATES) out.push(s[i]);
  }
  return out;
}

/**
 * Everything the digest and the export say, from what retro-gather read: `g` is { log: { text,
 * dates }, followUps: { text, dates } | null, states: [{ text, changed }], steps: Map unit -> markers,
 * rows, events, sessionUnits: Map session -> Set of units, sessions, ledger: entries | null,
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
  const sum = (list, pick) => list.reduce((acc, s) => {
    for (const [k, v] of Object.entries(pick(s))) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
  const d = {
    schema: 1,
    project,
    week: win.week,
    since: win.since,
    until: win.until,
    baselineSince: win.baselineSince,
    generated: iso(now),
    sources: {
      logRows: records.length,
      undated: records.filter((r) => r.landed === null).length,
      stepsFiles: g.steps.size,
      stateFiles: g.states.length,
      sessions: g.sessions ?? 0,
      ledgerRows: g.ledger ? g.ledger.length : null,
    },
    kpis: {
      log: logKpis(records, win.since, win.until),
      transcripts: g.rows.length ? transcriptKpis(g.rows, g.events, win) : null,
      codex: g.ledger ? summarizeLedger(g.ledger, { since: win.since, until: win.until }) : null,
    },
    baseline: { log: logKpis(records, win.baselineSince, win.since), transcripts: previousKpis(g.previous, win.week) },
    unitOutliers: unitOutliers(records, win),
    stepOutliers: stepOutliers(all, currentIds),
    steps: all.filter((u) => currentIds.has(u.unit)),
    stepShares: { markers: stepShares(all, 'markers'), descriptions: stepShares(all, 'descriptions') },
    friction: frictionThemes(records, win),
    frictionCells: records.filter((r) => r.friction && inWin(r.landed)).map((r) => ({ unit: r.id, friction: r.friction })),
    missed: records.filter((r) => r.missed && inWin(r.landed)).map((r) => ({ unit: r.id, missed: r.missed })),
    queue: {
      followUps: g.followUps ? followUpsSummary(g.followUps.text, g.followUps.dates, now) : null,
      stateP3: states.reduce((n, s) => n + s.p3, 0),
    },
    decisions: { units: recent.length, classes: sum(recent, (s) => s.classes), by: sum(recent, (s) => s.by), questions: recent.reduce((n, s) => n + s.questions, 0) },
  };
  d.candidates = candidates(d);
  return d;
}

const perWeek = (n) => `${round1(n / BASELINE_WEEKS)}/wk`;
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
    `Read: ${s.logRows ?? 0} log rows${s.undated ? ` (${s.undated} undated, left out)` : ''} · ${s.stepsFiles ?? 0} steps files · ${s.stateFiles ?? 0} state files · ${s.sessions ?? 0} sessions · ${s.ledgerRows === null || s.ledgerRows === undefined ? 'no Codex ledger' : `${s.ledgerRows} Codex ledger rows`}`,
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
  if (t) {
    L.push(
      `| Claude spend (main · subagents) | ${usd(t.claudeUsd)} (${usd(t.mainUsd)} · ${usd(t.subUsd)}) | ${base('claudeUsd', usd)} |`,
      `| Sessions · questions asked | ${t.sessions} · ${t.questions} | ${base('sessions', String)} · ${base('questions', String)} |`,
      `| Compactions (auto) · median tokens before | ${t.compactions} (${t.autoCompactions}) · ${t.compactPreTokens} | ${base('compactions', String)} · ${base('compactPreTokens', String)} |`,
      `| Cache hit · expiry rewrites | ${t.cacheHit}% · ${t.rewrites} (${usd(t.rewriteUsd)}, ${t.rewriteShare}% of main) | ${base('cacheHit', (v) => `${v}%`)} · ${base('rewriteShare', (v) => `${v}% of main`)} |`,
    );
  } else L.push('| Transcripts | none found for this repository | — |');
  const c = d.kpis.codex;
  L.push(c ? `| Codex runs · weekly quota used | ${c.runs} · ${c.percent}% | — |` : '| Codex | no ledger | — |', '');

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
      ? `- Follow-ups: ${q.open} open (${q.openP3} naming a P3; oldest ${q.oldestOpenDays === null ? '—' : `${q.oldestOpenDays} d`}) · ${q.scheduled} scheduled · ${q.fixed} fixed · ${q.dropped} dropped`
      : '- Follow-ups: no doc',
    `- P3 findings still to do in state files: ${d.queue.stateP3}`,
  );
  const dc = d.decisions;
  if (dc.units) {
    const cl = dc.classes;
    const by = dc.by;
    const un = cl.unclassified ? ` · ${cl.unclassified} unclassified (no Class column)` : '';
    L.push(`- Decisions in ${dc.units} state files changed this window: P ${cl.P ?? 0} · C ${cl.C ?? 0} · T ${cl.T ?? 0}${un} (owner ${by.owner ?? 0} · default ${by.default ?? 0} · agent ${by.agent ?? 0}) · open questions ${dc.questions}`);
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
