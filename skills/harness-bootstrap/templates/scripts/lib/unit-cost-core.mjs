// harness-bootstrap unit-cost core (generated YYYY-MM-DD). Pure core of scripts/unit-cost.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- the model price table, the cache-write multipliers and the dollars-per-percent
// calibration, each re-derived from the project's own plan and /usage readings.
/**
 * Turns Claude Code transcript lines and the Codex run ledger into the cost of one harness unit.
 * No I/O here, so `unit-cost-core.test.mjs` can pin each rule.
 *
 * WHY MEASURED. A log cell for "cost" was a guess made from memory: the one unit that was later
 * measured from its transcripts (main thread plus every subagent) had cost several times what the
 * session believed, nearly all of it in subagents nobody had added up. The numbers below come from
 * `message.usage` on each assistant turn, so the harness log can carry Cost / Claude % / Codex %
 * and Gate 1 can quote a range from real units instead of a hope.
 */

// ---- [B] project bindings
// [B] USD per million tokens: [input, output, cacheRead]. Matched on the model id's family word.
export const PRICE = {
  opus: [4, 20, 0.2],
  sonnet: [2, 10, 0.2],
  haiku: [0.1, 0.5, 0.01],
  fable: [10, 50, 0.25],
};
// [B] The exact model ids the PRICE rates above were taken for. A transcript turn whose model id is
// not listed here is still priced at its family's rate (an older or newer model of the same family may
// cost differently) and the report names it under "priced at family rates". Add an id once its rate is
// confirmed. A trailing `-YYYYMMDD` or `[1m]` on a transcript's id is ignored when matching.
export const PRICED_IDS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
// [B] A cache write costs input x this: 5-minute writes x1.25, 1-hour writes x2.
export const CACHE_WRITE_5M = 1.25;
export const CACHE_WRITE_1H = 2;
// [B] 1% of the weekly limit is about this many dollars. Recalibrate from /usage: read the percent
// before and after a measured stretch of work. Dollar figures are API-equivalent and relative -- a
// way to compare units and size a plan -- not a bill, and not what a subscription is charged.
export const DOLLARS_PER_PERCENT = 20;
// ---- end [B]

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round1 = (v) => Math.round(v * 10) / 10;

/** Reject unknown flags and a missing --session before any file is read. */
export function parseArgs(argv) {
  const a = {
    session: [],
    projectsDir: null,
    since: null,
    until: null,
    ledger: null,
    cwdMatch: null,
    json: false,
    line: false,
  };
  const valued = {
    '--session': 'session',
    '--projects-dir': 'projectsDir',
    '--since': 'since',
    '--until': 'until',
    '--ledger': 'ledger',
    '--cwd-match': 'cwdMatch',
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--line') a.line = true;
    else if (Object.hasOwn(valued, t)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[valued[t]] = v;
    } else throw new Error(`unknown option ${t}`);
  }
  if (a.json && a.line) throw new Error('--json and --line cannot be combined');
  a.session = [
    ...new Set(
      (a.session ?? '')
        .toString()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (a.session.length === 0) throw new Error('--session <id>[,<id>...] is required');
  for (const id of a.session) {
    if (!/^[A-Za-z0-9._-]+$/.test(id) || id.startsWith('.')) throw new Error(`bad session id "${id}"`);
  }
  for (const k of ['since', 'until']) {
    if (a[k] !== null && Number.isNaN(Date.parse(a[k]))) throw new Error(`--${k} is not an ISO time: ${a[k]}`);
  }
  if (a.since !== null && a.until !== null && Date.parse(a.since) > Date.parse(a.until)) {
    throw new Error('--since is after --until');
  }
  return a;
}

/** The price-table key a model id belongs to, or 'other' (priced at zero, counted as unpriced). */
export function family(model) {
  const m = String(model ?? '').toLowerCase();
  return Object.keys(PRICE).find((k) => m.includes(k)) ?? 'other';
}

/** True when the model id is one of PRICED_IDS (a `[1m]` or `-YYYYMMDD` suffix ignored). */
export function isPricedId(model) {
  return PRICED_IDS.includes(String(model ?? '').toLowerCase().replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, ''));
}

/**
 * Dollars for one turn's usage. Cache writes use the 5m and 1h split when the usage carries it;
 * when both are 0 the flat `cache_creation_input_tokens` is priced at the 5-minute rate.
 */
export function rowCost(fam, usage) {
  const [pin, pout, pread] = PRICE[fam] ?? [0, 0, 0];
  const cc = usage.cache_creation ?? {};
  const w1h = num(cc.ephemeral_1h_input_tokens);
  let w5m = num(cc.ephemeral_5m_input_tokens);
  if (w1h + w5m === 0) w5m = num(usage.cache_creation_input_tokens);
  return (
    (num(usage.input_tokens) * pin +
      w5m * pin * CACHE_WRITE_5M +
      w1h * pin * CACHE_WRITE_1H +
      num(usage.cache_read_input_tokens) * pread +
      num(usage.output_tokens) * pout) /
    1e6
  );
}

/**
 * One transcript file's text -> priced rows. Only `assistant` lines with `message.usage` count;
 * `<synthetic>` turns are skipped. `ctx` = { kind: 'main'|'sub', agentId, agentType } labels the file.
 * A row's `key` is "message.id|requestId", null when the line carries neither.
 */
export function parseTranscript(text, ctx = {}) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = d?.message;
    if (d?.type !== 'assistant' || !msg || typeof msg.usage !== 'object' || msg.usage === null) continue;
    if (msg.model === '<synthetic>') continue;
    const fam = family(msg.model);
    rows.push({
      key: msg.id || d.requestId ? `${msg.id ?? ''}|${d.requestId ?? ''}` : null,
      ts: Date.parse(d.timestamp),
      model: msg.model ?? '',
      family: fam,
      exact: isPricedId(msg.model),
      kind: ctx.kind === 'sub' ? 'sub' : 'main',
      agentId: ctx.agentId ?? null,
      agentType: ctx.agentType ?? null,
      output: num(msg.usage.output_tokens),
      cost: rowCost(fam, msg.usage),
    });
  }
  return rows;
}

/** Drop repeats of the same (message.id, requestId); the first one seen wins. Keyless rows stay. */
export function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    if (r.key === null) return true;
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });
}

/** A time inside [since, until]; a missing bound is open. With a bound, an unreadable time is out. */
export function inWindow(ts, since, until) {
  const lo = since === null || since === undefined ? null : Date.parse(since);
  const hi = until === null || until === undefined ? null : Date.parse(until);
  if (lo === null && hi === null) return true;
  if (!Number.isFinite(ts)) return false;
  return (lo === null || ts >= lo) && (hi === null || ts <= hi);
}

/** Rows -> dollars (total, main thread, subagents, per model family), turns, output tokens, Claude %. */
export function summarizeClaude(rows, { since = null, until = null } = {}) {
  const used = dedupeRows(rows).filter((r) => inWindow(r.ts, since, until));
  const out = {
    total: 0,
    main: 0,
    sub: 0,
    byFamily: {},
    turns: used.length,
    outputTokens: 0,
    unpricedTurns: 0,
    familyRated: [],
    subagents: {},
    subagentCount: 0,
  };
  const agents = new Map();
  const familyRated = new Set();
  for (const r of used) {
    out.total += r.cost;
    out[r.kind] += r.cost;
    out.byFamily[r.family] = (out.byFamily[r.family] ?? 0) + r.cost;
    out.outputTokens += r.output;
    if (r.family === 'other') out.unpricedTurns += 1;
    else if (r.exact === false) familyRated.add(r.model);
    if (r.kind === 'sub') agents.set(r.agentId ?? `${r.agentType}#${agents.size}`, r.agentType ?? 'unknown');
  }
  for (const type of agents.values()) out.subagents[type] = (out.subagents[type] ?? 0) + 1;
  out.subagentCount = agents.size;
  out.familyRated = [...familyRated].sort();
  out.claudePercent = round1(out.total / DOLLARS_PER_PERCENT);
  return out;
}

/** Ledger JSONL text -> run objects; a blank or unparseable line is skipped, never fatal. */
export function parseLedger(text) {
  const runs = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && !Array.isArray(e)) runs.push(e);
    } catch {
      /* a torn line is skipped */
    }
  }
  return runs;
}

// The weekly window's `resetsAt` drifts by a second between readings of one window (observed
// 1793382102 vs 1793382103), so two readings within this many seconds are the same window.
const SAME_WINDOW_S = 60;
// Ledger outcomes that never started Codex: no work, no quota used.
const NOT_RUN = new Set(['reserved', 'unavailable']);

/**
 * Codex runs in the window: count by kind, wall minutes, and the quota they used. The quota is
 * account-wide, so two runs that overlapped in time share the same stretch of it. Within one quota
 * window (`resetsAt` equal, give or take SAME_WINDOW_S), the [before, after] `usedPercent` intervals
 * are merged and the length of the union is summed -- 10->12 and 10->13 is 3, not 5. A run with no
 * reading on one side, or one that straddled a reset, has no honest interval and is `uncounted`.
 * Ledger rows whose outcome is reserved or unavailable never ran: they are `notRun`, not in `runs`.
 */
export function summarizeLedger(entries, { since = null, until = null, cwdMatch = null } = {}) {
  const out = { runs: 0, notRun: 0, byKind: {}, percent: 0, ms: 0, uncounted: 0 };
  const intervals = [];
  for (const e of entries) {
    if (!inWindow(Date.parse(e.at), since, until)) continue;
    if (cwdMatch && !String(e.cwd ?? '').includes(cwdMatch)) continue;
    if (NOT_RUN.has(String(e.outcome ?? e.status ?? '').toLowerCase())) {
      out.notRun += 1;
      continue;
    }
    out.runs += 1;
    const kind = e.kind || 'unknown';
    out.byKind[kind] = (out.byKind[kind] ?? 0) + 1;
    out.ms += num(e.ms);
    const b = e.limitsBefore;
    const a = e.limitsAfter;
    const ok =
      b &&
      a &&
      Number.isFinite(b.usedPercent) &&
      Number.isFinite(a.usedPercent) &&
      Number.isFinite(b.resetsAt) &&
      Number.isFinite(a.resetsAt) &&
      Math.abs(b.resetsAt - a.resetsAt) <= SAME_WINDOW_S;
    if (ok) intervals.push({ reset: b.resetsAt, lo: b.usedPercent, hi: a.usedPercent });
    else out.uncounted += 1;
  }
  // Windows: sorted resets, a gap over SAME_WINDOW_S starts a new one.
  const resets = [...new Set(intervals.map((i) => i.reset))].sort((x, y) => x - y);
  const windowOf = new Map();
  let id = -1;
  resets.forEach((r, i) => {
    if (i === 0 || r - resets[i - 1] > SAME_WINDOW_S) id += 1;
    windowOf.set(r, id);
  });
  const byWindow = new Map();
  for (const i of intervals) {
    if (i.hi <= i.lo) continue; // a negative or empty delta adds nothing
    const w = windowOf.get(i.reset);
    if (!byWindow.has(w)) byWindow.set(w, []);
    byWindow.get(w).push([i.lo, i.hi]);
  }
  let sum = 0;
  for (const list of byWindow.values()) {
    list.sort((x, y) => x[0] - y[0]);
    let [lo, hi] = list[0];
    for (const [l, h] of list.slice(1)) {
      if (l <= hi) hi = Math.max(hi, h);
      else {
        sum += hi - lo;
        [lo, hi] = [l, h];
      }
    }
    sum += hi - lo;
  }
  out.percent = round1(sum);
  return out;
}

const usd = (v) => `$${v.toFixed(2)}`;

/** The one line for a log cell. `codex` is null when there is no ledger. */
export function summaryLine(claude, codex) {
  const tail =
    codex === null
      ? 'Codex no ledger'
      : `Codex ${codex.percent}% (${codex.runs} runs${codex.notRun ? `, ${codex.notRun} not run` : ''})`;
  return `Cost ${usd(claude.total)} · Claude ${claude.claudePercent}% · ${tail}`;
}

const pairs = (o, fmt = (v) => v) =>
  Object.entries(o)
    .sort((x, y) => (typeof y[1] === 'number' ? y[1] - x[1] : 0))
    .map(([k, v]) => `${k} ${fmt(v)}`)
    .join(' · ') || 'none';

/** The multi-line human report; `codex` null prints "Codex: no ledger". */
export function formatReport(claude, codex) {
  const lines = [
    summaryLine(claude, codex),
    '',
    `Claude: ${usd(claude.total)} (main ${usd(claude.main)} · subagents ${usd(claude.sub)}) = ${claude.claudePercent}% of the weekly limit at $${DOLLARS_PER_PERCENT}/%`,
    `  by model: ${pairs(claude.byFamily, usd)}`,
    `  turns ${claude.turns} · output tokens ${claude.outputTokens}${claude.unpricedTurns ? ` · unpriced turns ${claude.unpricedTurns}` : ''}`,
    ...(claude.familyRated?.length ? [`  priced at family rates: ${claude.familyRated.join(', ')}`] : []),
    `  subagents ${claude.subagentCount}: ${pairs(claude.subagents)}`,
  ];
  if (codex === null) lines.push('Codex: no ledger');
  else {
    lines.push(
      `Codex: ${codex.runs} runs (${pairs(codex.byKind)})${codex.notRun ? ` · ${codex.notRun} not run (reserved or unavailable)` : ''} · ${codex.percent}% of quota · ${codex.ms} ms`,
      '  the % is account-wide: it includes any other work on the same Codex account during the window',
      ...(codex.uncounted ? [`  ${codex.uncounted} runs without a same-window quota reading are not in the %`] : []),
    );
  }
  lines.push('', 'Dollar figures are API-equivalent and relative, not a bill.');
  return `${lines.join('\n')}\n`;
}
