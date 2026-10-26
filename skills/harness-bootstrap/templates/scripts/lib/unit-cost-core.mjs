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
 *
 * WHERE IT WENT. A unit total does not say which step spent it, nor how long the run sat waiting on
 * the owner. `--times` reads the main thread's own events (questions, typed prompts, compactions,
 * cache expiries) and `--by-step` joins the turns to the unit's step markers (unit-step.mjs), so the
 * retro can see that one step cost a fifth of a unit, or that the waits were most of its wall time.
 */
import { formatMinutes, label, stepIntervals } from './unit-step-core.mjs';

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
// [B] Minutes a cached prompt prefix lives: main sessions write 1-hour cache entries, so a main-thread
// turn after a longer gap re-writes its prefix (an expiry rewrite).
export const CACHE_TTL_MIN = 60;
// [B] The share of a turn's context written to cache that makes it an expiry rewrite.
export const REWRITE_SHARE = 0.5;
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
    byStep: null,
    unit: null,
    times: false,
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
    '--by-step': 'byStep',
    '--unit': 'unit',
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--line') a.line = true;
    else if (t === '--times') a.times = true;
    else if (Object.hasOwn(valued, t)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[valued[t]] = v;
    } else throw new Error(`unknown option ${t}`);
  }
  if (a.json && a.line) throw new Error('--json and --line cannot be combined');
  if (a.line && (a.times || a.byStep)) throw new Error('--line prints the cost cell only; drop --times and --by-step');
  if (a.unit !== null && a.byStep === null) throw new Error('--unit names the unit of a --by-step steps file');
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

/** A turn's cache writes as 5-minute and 1-hour tokens; with neither split, the flat count is 5-minute. */
function cacheWrites(usage) {
  const cc = usage.cache_creation ?? {};
  const w1h = num(cc.ephemeral_1h_input_tokens);
  let w5m = num(cc.ephemeral_5m_input_tokens);
  if (w1h + w5m === 0) w5m = num(usage.cache_creation_input_tokens);
  return { w5m, w1h };
}

/** Dollars for the cache-write part of one turn's usage alone. */
export function writeCost(fam, usage) {
  const [pin] = PRICE[fam] ?? [0];
  const { w5m, w1h } = cacheWrites(usage);
  return (w5m * pin * CACHE_WRITE_5M + w1h * pin * CACHE_WRITE_1H) / 1e6;
}

/**
 * Dollars for one turn's usage. Cache writes use the 5m and 1h split when the usage carries it;
 * when both are 0 the flat `cache_creation_input_tokens` is priced at the 5-minute rate.
 */
export function rowCost(fam, usage) {
  const [pin, pout, pread] = PRICE[fam] ?? [0, 0, 0];
  const { w5m, w1h } = cacheWrites(usage);
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
 * `<synthetic>` turns are skipped. `ctx` = { kind: 'main'|'sub', agentId, agentType, session,
 * description } labels the file; `description` is a subagent's dispatch description, which carries
 * its step tag. A row's `key` is "message.id|requestId", null when the line carries neither.
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
    const { w5m, w1h } = cacheWrites(msg.usage);
    rows.push({
      key: msg.id || d.requestId ? `${msg.id ?? ''}|${d.requestId ?? ''}` : null,
      ts: Date.parse(d.timestamp),
      model: msg.model ?? '',
      family: fam,
      exact: isPricedId(msg.model),
      kind: ctx.kind === 'sub' ? 'sub' : 'main',
      agentId: ctx.agentId ?? null,
      agentType: ctx.agentType ?? null,
      session: ctx.session ?? null,
      agentDescription: ctx.description ?? null,
      output: num(msg.usage.output_tokens),
      input: num(msg.usage.input_tokens),
      cacheRead: num(msg.usage.cache_read_input_tokens),
      cacheWrite: w5m + w1h,
      writeCost: writeCost(fam, msg.usage),
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

// The tools that stop the run until the owner answers.
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
// User lines Claude Code writes that nobody typed: background-task notices and command output.
const NOT_TYPED =
  /^\s*<(?:task-notification|local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr)\b/;

/**
 * True when a transcript line is something the owner typed: a prompt, a slash command, a `!` command.
 * A line with an `origin` says so itself (`human`; a peer session or a task notice is not); an older
 * line without one is judged by its text. Tool results, meta lines and compaction summaries never are.
 */
export function isOwnerPrompt(d) {
  if (d?.type !== 'user' || d.isSidechain || d.isMeta || d.isCompactSummary) return false;
  const origin = d.origin !== null && typeof d.origin === 'object' ? d.origin.kind : d.origin;
  if (origin !== undefined && origin !== null) return origin === 'human';
  const c = d.message?.content;
  let text = '';
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    if (c.some((x) => x?.type === 'tool_result')) return false;
    text = c
      .filter((x) => x?.type === 'text')
      .map((x) => String(x.text ?? ''))
      .join('');
  } else return false;
  return text.trim() !== '' && !NOT_TYPED.test(text);
}

/**
 * One main-thread transcript's text -> its events in time order: `turn` (an assistant line), `ask`
 * (a question tool call), `result` (a tool result, by tool_use_id), `prompt` (the owner typed), `note`
 * (any other user or system line) and `compact` (a compaction boundary, with its trigger, tokens before
 * and duration). Sidechain lines and lines without a readable time are skipped.
 */
export function parseEvents(text) {
  const events = [];
  for (const line of String(text).split('\n')) {
    if (!line.includes('"timestamp"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!d || d.isSidechain) continue;
    const ts = Date.parse(d.timestamp);
    if (!Number.isFinite(ts)) continue;
    const content = Array.isArray(d.message?.content) ? d.message.content : [];
    if (d.type === 'assistant') {
      events.push({ ts, type: 'turn' });
      for (const c of content) {
        if (c?.type === 'tool_use' && ASK_TOOLS.has(c.name) && c.id) events.push({ ts, type: 'ask', id: c.id });
      }
    } else if (d.type === 'user') {
      const results = content.filter((c) => c?.type === 'tool_result' && c.tool_use_id);
      if (results.length) for (const c of results) events.push({ ts, type: 'result', id: c.tool_use_id });
      else events.push({ ts, type: isOwnerPrompt(d) ? 'prompt' : 'note' });
    } else if (d.type === 'system') {
      if (d.subtype === 'compact_boundary') {
        const m = d.compactMetadata ?? {};
        events.push({
          ts,
          type: 'compact',
          trigger: String(m.trigger ?? 'unknown'),
          preTokens: num(m.preTokens),
          durationMs: num(m.durationMs),
        });
      } else events.push({ ts, type: 'note' });
    }
  }
  return events.sort((x, y) => x.ts - y.ts);
}

/** The total length of [from, to] spans, an overlap counted once; an empty or backward span adds nothing. */
export function unionMs(spans) {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let lo = null;
  let hi = null;
  for (const [a, b] of sorted) {
    if (hi === null || a > hi) {
      if (hi !== null) total += hi - lo;
      [lo, hi] = [a, b];
    } else hi = Math.max(hi, b);
  }
  if (hi !== null) total += hi - lo;
  return total;
}

/**
 * Main-thread events -> wall, owner-wait and work time. Owner wait is the union of each question from
 * its call to its answer, and each typed prompt back to the last assistant turn or tool result before
 * it: the session had stopped and was waiting on the owner. Lines nobody typed (a background task's
 * notice, command output) start no wait, so time the run spent on its own work stays work. Events of
 * several sessions can be merged: the gap before the next session's first prompt is owner wait too.
 * The wall is the first to the last event inside the window, but a wait is paired over every event
 * and clipped to that wall, so one that starts before `since` or ends after `until` still counts
 * the part inside the window; the counts are the window's own events.
 */
export function summarizeTimes(events, { since = null, until = null } = {}) {
  const all = [...events].sort((x, y) => x.ts - y.ts);
  const ev = all.filter((e) => inWindow(e.ts, since, until));
  const out = { wallMs: 0, waitMs: 0, workMs: 0, questions: 0, unanswered: 0, prompts: 0, questionMs: 0, promptMs: 0 };
  if (ev.length === 0) return out;
  const lo = ev[0].ts;
  const hi = ev.at(-1).ts;
  const inside = (a, b) => Math.max(0, Math.min(b, hi) - Math.max(a, lo));
  const spans = [];
  const asks = new Map();
  let lastWork = null;
  for (const e of all) {
    const mine = inWindow(e.ts, since, until);
    if (e.type === 'ask') {
      if (mine) out.questions += 1;
      asks.set(e.id, e.ts);
    } else if (e.type === 'result' && asks.has(e.id)) {
      spans.push([asks.get(e.id), e.ts]);
      out.questionMs += inside(asks.get(e.id), e.ts);
      asks.delete(e.id);
    } else if (e.type === 'prompt') {
      if (mine) out.prompts += 1;
      if (lastWork !== null && e.ts > lastWork) {
        spans.push([lastWork, e.ts]);
        out.promptMs += inside(lastWork, e.ts);
      }
    }
    if (e.type === 'turn' || e.type === 'result') lastWork = e.ts;
  }
  out.unanswered = [...asks.values()].filter((ts) => inWindow(ts, since, until)).length;
  out.wallMs = hi - lo;
  out.waitMs = unionMs(spans.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]));
  out.workMs = Math.max(0, out.wallMs - out.waitMs);
  return out;
}

/** Compaction boundaries in the window: how many, by trigger, the median tokens before, the time spent. */
export function summarizeCompactions(events, { since = null, until = null } = {}) {
  const hits = events.filter((e) => e.type === 'compact' && inWindow(e.ts, since, until));
  const byTrigger = {};
  for (const e of hits) byTrigger[e.trigger] = (byTrigger[e.trigger] ?? 0) + 1;
  const pre = hits
    .map((e) => e.preTokens)
    .filter((n) => n > 0)
    .sort((x, y) => x - y);
  const mid = Math.floor(pre.length / 2);
  const median = pre.length === 0 ? 0 : pre.length % 2 ? pre[mid] : (pre[mid - 1] + pre[mid]) / 2;
  return {
    count: hits.length,
    byTrigger,
    medianPreTokens: Math.round(median),
    durationMs: hits.reduce((s, e) => s + e.durationMs, 0),
  };
}

/**
 * The main thread's cache: the share of its context read from cache, and its expiry rewrites -- a turn
 * more than CACHE_TTL_MIN after the previous turn of the same session that wrote at least REWRITE_SHARE
 * of its context to cache. A session's first turn is not one (there was no cache to lose).
 */
export function summarizeCache(rows, { since = null, until = null } = {}) {
  const main = dedupeRows(rows)
    .filter((r) => r.kind === 'main' && Number.isFinite(r.ts))
    .sort((x, y) => x.ts - y.ts);
  const out = { hitPercent: 0, rewrites: 0, rewriteDollars: 0, rewriteTokens: 0 };
  const lastTurn = new Map();
  let read = 0;
  let context = 0;
  for (const r of main) {
    const prev = lastTurn.get(r.session);
    lastTurn.set(r.session, r.ts);
    if (!inWindow(r.ts, since, until)) continue;
    const ctx = num(r.input) + num(r.cacheRead) + num(r.cacheWrite);
    read += num(r.cacheRead);
    context += ctx;
    if (prev !== undefined && r.ts - prev > CACHE_TTL_MIN * 60_000 && ctx > 0 && num(r.cacheWrite) >= REWRITE_SHARE * ctx) {
      out.rewrites += 1;
      out.rewriteDollars += num(r.writeCost);
      out.rewriteTokens += num(r.cacheWrite);
    }
  }
  out.hitPercent = context > 0 ? round1((read / context) * 100) : 0;
  return out;
}

// A dispatch description's step tag, `[<unit> s<step> r<round>]`; the round is optional.
const STEP_TAG = /\[([A-Za-z0-9][A-Za-z0-9._-]*) s([A-Za-z0-9][A-Za-z0-9._-]{0,31}?)(?: r(\d+))?\]/;

/** `[EP-27.03 s8c r2] codex review` -> { unit, step, round }; null when there is no tag. */
export function parseTag(description) {
  const m = STEP_TAG.exec(String(description ?? ''));
  return m ? { unit: m[1], step: m[2], round: m[3] ? Number(m[3]) : 1 } : null;
}

/** Each subagent's earliest readable turn time, by key; a row without one never sets it. */
function firstTurns(rows, agentKey) {
  const first = new Map();
  for (const r of rows) {
    if (r.kind !== 'sub' || !Number.isFinite(r.ts)) continue;
    const cur = first.get(agentKey(r));
    if (cur === undefined || r.ts < cur) first.set(agentKey(r), r.ts);
  }
  return first;
}

/**
 * Rows plus the unit's step markers -> dollars and time per runner step. A main-thread turn belongs to
 * the step interval it falls in. A subagent belongs to the step its dispatch tag names when the tag is
 * this unit's; otherwise to the interval its first turn falls in. Anything outside every interval is
 * `unmarked`. A step's wall time is its intervals summed, so a step run in two rounds shows both; with
 * a window, each interval counts only the part inside it.
 */
export function summarizeSteps(rows, markers, { unit = null, since = null, until = null } = {}) {
  const deduped = dedupeRows(rows);
  const used = deduped.filter((r) => inWindow(r.ts, since, until));
  // An open step runs to the last turn anywhere, not the window's last: the window clips it below.
  const lastTs = deduped.reduce((m, r) => (Number.isFinite(r.ts) ? Math.max(m, r.ts) : m), -Infinity);
  const { intervals, problems } = stepIntervals(markers, Number.isFinite(lastTs) ? lastTs : null);
  const stepAt = (ts) => {
    const iv = intervals.find((i) => ts >= i.start && (i.end === null || ts < i.end || (i.open && ts <= i.end)));
    return iv ? label(iv) : 'unmarked';
  };
  const slots = new Map();
  const slot = (key) => {
    if (!slots.has(key)) slots.set(key, { usd: 0, mainUsd: 0, subUsd: 0, turns: 0, agents: new Set(), wallMs: 0 });
    return slots.get(key);
  };
  const winLo = since === null || since === undefined ? -Infinity : Date.parse(since);
  const winHi = until === null || until === undefined ? Infinity : Date.parse(until);
  for (const iv of intervals) {
    slot(label(iv)).wallMs += iv.end === null ? 0 : Math.max(0, Math.min(iv.end, winHi) - Math.max(iv.start, winLo));
  }
  // An agent is placed by its first turn and its tag wherever they fall; only cost and turns are the window's.
  const agentKey = (r) => r.agentId ?? r.agentType ?? 'unknown';
  const firstTurn = firstTurns(deduped, agentKey);
  const agentStep = new Map();
  for (const r of deduped) {
    if (r.kind !== 'sub' || agentStep.has(agentKey(r))) continue;
    const tag = parseTag(r.agentDescription);
    agentStep.set(agentKey(r), tag && (unit === null || tag.unit === unit) ? label(tag) : stepAt(firstTurn.get(agentKey(r))));
  }
  let total = 0;
  for (const r of used) {
    const s = slot(r.kind === 'sub' ? agentStep.get(agentKey(r)) : stepAt(r.ts));
    s.usd += r.cost;
    if (r.kind === 'sub') {
      s.subUsd += r.cost;
      s.agents.add(agentKey(r));
    } else s.mainUsd += r.cost;
    s.turns += 1;
    total += r.cost;
  }
  const order = [...new Set([...intervals.map(label), ...slots.keys()])].filter((k) => k !== 'unmarked');
  if (slots.has('unmarked')) order.push('unmarked');
  const steps = order.map((k) => {
    const s = slots.get(k);
    return {
      label: k,
      usd: s.usd,
      mainUsd: s.mainUsd,
      subUsd: s.subUsd,
      turns: s.turns,
      agents: s.agents.size,
      wallMs: s.wallMs,
      share: total > 0 ? round1((s.usd / total) * 100) : 0,
    };
  });
  return { unit, steps, problems, total };
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

const kTokens = (n) => `${Math.round(n / 1000)}K`;

/** The `--times` lines: wall, owner wait and work, then compactions and the cache. */
function timesLines({ times, compactions, cache }) {
  const lines = [
    `Times (main thread): wall ${formatMinutes(times.wallMs)} · owner wait ${formatMinutes(times.waitMs)} (${times.questions} questions${times.unanswered ? `, ${times.unanswered} unanswered` : ''} · ${times.prompts} prompts) · work ${formatMinutes(times.workMs)}`,
  ];
  if (compactions) {
    lines.push(
      compactions.count
        ? `  compactions ${compactions.count} (${pairs(compactions.byTrigger)}) · median ${kTokens(compactions.medianPreTokens)} before · ${formatMinutes(compactions.durationMs)} spent`
        : '  compactions 0',
    );
  }
  if (cache) {
    lines.push(`  cache hit ${cache.hitPercent}% · expiry rewrites ${cache.rewrites}${cache.rewrites ? ` (${usd(cache.rewriteDollars)}, ${kTokens(cache.rewriteTokens)} written)` : ''}`);
  }
  return lines;
}

/** The `--by-step` lines: one per step in time order, `unmarked` last, then any marker problem. */
function stepLines({ unit, steps, problems }) {
  const width = Math.max(8, ...steps.map((s) => s.label.length));
  const lines = [`By step${unit ? ` (${unit})` : ''}:`];
  for (const s of steps) {
    lines.push(
      `  ${s.label.padEnd(width)} ${usd(s.usd).padStart(9)} ${`${s.share}%`.padStart(6)} · main ${usd(s.mainUsd)} · subagents ${usd(s.subUsd)} (${s.agents}) · ${s.label === 'unmarked' ? 'no marker' : formatMinutes(s.wallMs)}`,
    );
  }
  if (steps.length === 0) lines.push('  no turns in the window');
  for (const p of problems) lines.push(`  ! ${p}`);
  return lines;
}

/**
 * The multi-line human report; `codex` null prints "Codex: no ledger". `extra` adds the `--times`
 * section ({ times, compactions, cache }) and the `--by-step` section ({ steps }) when present.
 */
export function formatReport(claude, codex, extra = {}) {
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
  if (extra.times) lines.push('', ...timesLines(extra));
  if (extra.steps) lines.push('', ...stepLines(extra.steps));
  lines.push('', 'Dollar figures are API-equivalent and relative, not a bill.');
  return `${lines.join('\n')}\n`;
}
