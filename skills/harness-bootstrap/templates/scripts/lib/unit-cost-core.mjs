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
import { UNIT_ID_SOURCE, formatMinutes, label, stepIntervals } from './unit-step-core.mjs';

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

// What a row's usage is: the fields a later copy of the same message may carry more of.
const USAGE_FIELDS = ['output', 'input', 'cacheRead', 'cacheWrite', 'writeCost', 'cost'];

/**
 * One row per (message.id, requestId). Claude Code writes a streamed message once per content block,
 * each line carrying the usage so far, so the copies of one message can differ in their output tokens
 * (a subagent's transcript is where they do). The row keeps the first copy's place, time and labels with
 * the usage of the copy that has the most output; of equal outputs the first stays. Keyless rows stay.
 * Pure: a row that takes a later copy's usage is a new object, the rows it was given are not touched.
 */
export function dedupeRows(rows) {
  const at = new Map();
  const out = [];
  for (const r of rows) {
    if (r.key === null) {
      out.push(r);
      continue;
    }
    const i = at.get(r.key);
    if (i === undefined) {
      at.set(r.key, out.length);
      out.push(r);
    } else if (r.output > out[i].output) {
      const kept = { ...out[i] };
      for (const k of USAGE_FIELDS) kept[k] = r[k];
      out[i] = kept;
    }
  }
  return out;
}

/** A time inside [since, until]; a missing bound is open. With a bound, an unreadable time is out. */
export function inWindow(ts, since, until) {
  const lo = since === null || since === undefined ? null : Date.parse(since);
  const hi = until === null || until === undefined ? null : Date.parse(until);
  if (lo === null && hi === null) return true;
  if (!Number.isFinite(ts)) return false;
  return (lo === null || ts >= lo) && (hi === null || ts <= hi);
}

/**
 * A transcript's text -> { times, live }: the time of every line, whatever its type (a tool result is
 * written after the turn that called the tool), and whether a tool is running now -- the last assistant
 * message called a tool and no result has followed. The copies of one streamed message are one message.
 * A line with no readable time has none.
 */
export function transcriptTimes(text) {
  const times = [];
  let pending = new Set();
  let lastId = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(d?.timestamp);
    if (Number.isFinite(ts)) times.push(ts);
    const msg = d?.message;
    const content = Array.isArray(msg?.content) ? msg.content : [];
    if (d?.type === 'assistant' && msg) {
      const id = msg.id ?? null;
      if (id === null || id !== lastId) pending = new Set();
      lastId = id;
      for (const c of content) if (c?.type === 'tool_use' && c.id) pending.add(c.id);
    } else if (d?.type === 'user') {
      for (const c of content) if (c?.type === 'tool_result') pending.delete(c.tool_use_id);
    }
  }
  return { times, live: pending.size > 0 };
}

/**
 * The window a ledger's runs are counted in: `window` is { since, until } as given (ISO strings or
 * null), `times` the sessions' times in ms, `now` the time in ms while a session is still running a
 * tool, else null. A ledger holds every run its checkout ever made, so a bound the owner left out is
 * the sessions' first (`since`) or last (`until`) readable time, not open; a live session's `until` is
 * now, since the run its tool started is not in the transcript yet. With no readable time the window
 * is as given.
 */
export function ledgerWindow(window, times, now = null) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of times) {
    if (!Number.isFinite(t)) continue;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  if (lo === Infinity) return window;
  const given = (b) => b !== null && b !== undefined;
  return {
    since: given(window.since) ? window.since : new Date(lo).toISOString(),
    until: given(window.until) ? window.until : new Date(now ?? hi).toISOString(),
  };
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
 * it: the session had stopped and was waiting on the owner. An async question (Codex's) stops
 * nothing: it counts as a question, and the owner's reply is a prompt. Lines nobody typed (a background task's
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
      if (!e.async) asks.set(e.id, e.ts);
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

// A dispatch description's step tag, `[<unit> s<step> r<round>]`; the round is optional. The unit is
// unit-step's own id rule (`harness/x` included).
const STEP_TAG = new RegExp(`\\[(${UNIT_ID_SOURCE}) s([A-Za-z0-9][A-Za-z0-9._-]{0,31}?)(?: r(\\d+))?\\]`);

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
// Ledger outcomes that never started Codex (or, in claude-run's ledger, Claude): no work, no quota used.
// A claude-run row with a cost did run: the API stopped it after it spent (an overload, a limit).
const NOT_RUN = new Set(['reserved', 'unavailable']);

/** A ledger's rows in the window whose cwd matches: the ones that ran, and how many never did. */
function ledgerRows(entries, { since = null, until = null, cwdMatch = null } = {}) {
  const ran = [];
  let notRun = 0;
  for (const e of entries) {
    if (!inWindow(Date.parse(e.at), since, until)) continue;
    if (cwdMatch && !String(e.cwd ?? '').includes(cwdMatch)) continue;
    if (NOT_RUN.has(String(e.outcome ?? e.status ?? '').toLowerCase()) && !Number.isFinite(e.costUsd)) {
      notRun += 1;
      continue;
    }
    ran.push(e);
  }
  return { ran, notRun };
}

/** A Codex run's [before, after] quota interval; null without a reading on each side of one window. */
function runInterval(e) {
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
  return ok ? { reset: b.resetsAt, lo: b.usedPercent, hi: a.usedPercent } : null;
}

/**
 * Codex runs in the window: count by kind, wall minutes, and the quota they used. The quota is
 * account-wide, so two runs that overlapped in time share the same stretch of it. Within one quota
 * window (`resetsAt` equal, give or take SAME_WINDOW_S), the [before, after] `usedPercent` intervals
 * are merged and the length of the union is summed -- 10->12 and 10->13 is 3, not 5. A run with no
 * reading on one side, or one that straddled a reset, has no honest interval and is `uncounted`.
 * Ledger rows whose outcome is reserved or unavailable never ran: they are `notRun`, not in `runs`.
 */
export function summarizeLedger(entries, window = {}) {
  const { ran, notRun } = ledgerRows(entries, window);
  const out = { runs: ran.length, notRun, byKind: {}, percent: 0, ms: 0, uncounted: 0 };
  const intervals = [];
  for (const e of ran) {
    const kind = e.kind || 'unknown';
    out.byKind[kind] = (out.byKind[kind] ?? 0) + 1;
    out.ms += num(e.ms);
    const i = runInterval(e);
    if (i) intervals.push(i);
    else out.uncounted += 1;
  }
  out.percent = quotaPercent(intervals);
  return out;
}

/**
 * claude-run's ledger in the window: runs by kind, wall time and their dollars (`costUsd`, what
 * `claude -p` reported). A run without a cost (a timeout) is `unpriced`; a reserved or unavailable row
 * never ran (`notRun`) unless it has a cost, which the API stopped after it spent. Its runs keep no
 * transcript, so this ledger is the only record of them.
 */
export function summarizeClaudeRuns(entries, window = {}) {
  const { ran, notRun } = ledgerRows(entries, window);
  const out = { runs: ran.length, notRun, byKind: {}, usd: 0, ms: 0, unpriced: 0 };
  for (const e of ran) {
    const kind = e.kind || 'unknown';
    out.byKind[kind] = (out.byKind[kind] ?? 0) + 1;
    out.ms += num(e.ms);
    if (Number.isFinite(e.costUsd)) out.usd += e.costUsd;
    else out.unpriced += 1;
  }
  return out;
}

/** The length of the union of quota intervals [{ reset, lo, hi }], summed over their quota windows. */
function quotaPercent(intervals) {
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
  return round1(sum);
}

// ---- a Codex host: the owner's session runs on Codex, its rollouts under $CODEX_HOME/sessions (or archived_sessions)

// The tool a Codex thread asks the owner with and stops until the answer, and the one that asks and goes on.
const CODEX_ASK = 'request_user_input';
const CODEX_ASK_ASYNC = 'request_user_input_async';
// A user message Codex wrote itself (its environment, an open page, the AGENTS.md instructions) is
// whole elements, so a line the owner typed that merely starts with `<` is still the owner's.
const CODEX_AGENTS_LINE = /^# AGENTS\.md instructions for [^\n]*/;
const CODEX_TAG = /^<([A-Za-z_][A-Za-z0-9_.:-]*)(?=[\s/>])/;
const CODEX_OWNER_TAG = 'send_user_message_question_reply';
// A rollout line is parsed only when it may be one of these; the test after parsing decides.
const CODEX_WANTED = /"type":"(?:session_meta|turn_context|compacted|task_started|task_complete|turn_aborted|token_count|function_call|function_call_output|message)"/;
// The quota window the Codex % reads: the weekly one (codex-run.mjs picks the same).
const WEEK_MINUTES = 10080;

const text = (v) => (typeof v === 'string' ? v : null);

/**
 * A rollout's session_meta payload -> { id, session, parent, cwd, started, kind, host }. `session` is
 * the thread a subagent belongs to (its own id for a main thread). `host` is false for a `codex exec`
 * run, which codex-run's ledger counts, and true for a session the owner opened (the app, the TUI).
 */
export function codexMeta(p) {
  const m = p !== null && typeof p === 'object' ? p : {};
  const src = m.source;
  const parent = text(m.parent_thread_id) ?? text(src?.subagent?.thread_spawn?.parent_thread_id);
  const id = text(m.id);
  const started = Date.parse(m.timestamp);
  return {
    id,
    session: text(m.session_id) ?? parent ?? id,
    parent,
    cwd: text(m.cwd),
    started: Number.isFinite(started) ? started : null,
    kind: src !== null && typeof src === 'object' && Object.hasOwn(src, 'subagent') ? 'sub' : 'main',
    host: id !== null && m.originator !== 'codex_exec' && src !== 'exec',
  };
}

/** A token_count -> its running totals (null without them) and its weekly quota reading. */
function codexReading(p, ts, seg) {
  const t = p.info?.total_token_usage;
  const limits = [p.rate_limits?.primary, p.rate_limits?.secondary]
    .filter((w) => w && typeof w === 'object')
    .sort((x, y) => num(y.window_minutes) - num(x.window_minutes));
  const w = limits.find((x) => num(x.window_minutes) >= WEEK_MINUTES) ?? limits[0] ?? null;
  return {
    ts,
    seg,
    tokens: t ? { input: num(t.input_tokens), cached: num(t.cached_input_tokens), output: num(t.output_tokens), total: num(t.total_tokens) } : null,
    used: Number.isFinite(w?.used_percent) ? w.used_percent : null,
    resets: Number.isFinite(w?.resets_at) ? w.resets_at : null,
  };
}

/**
 * One Codex rollout's lines (any iterable; run-sources streams the file) -> its meta (codexMeta) plus
 * `models`, `starts` (each turn's start), `readings` (each token_count: the thread's running totals,
 * the weekly quota reading and `seg`, the turn it fell in) and `events` in parseEvents' shape:
 * `turn` (a model response, a turn's end), `note` (a turn's start, a line Codex wrote itself),
 * `prompt` (what the owner typed, or their reply to an async question), `ask` (request_user_input,
 * which stops the thread until its `result`, or request_user_input_async, `async`, which does not)
 * and `compact`. Only the first session_meta counts: a subagent's rollout repeats its parent's.
 */
export function parseCodexSession(lines) {
  const s = { ...codexMeta(null), models: [], starts: [], readings: [], events: [] };
  const state = { meta: false, seg: 0, models: new Set() };
  for (const line of lines) {
    const d = CODEX_WANTED.test(line) ? rolloutLine(line) : null;
    if (d) readRolloutLine(s, state, d);
  }
  s.models = [...state.models].sort();
  s.events.sort((x, y) => x.ts - y.ts);
  return s;
}

/** A rollout line as JSON with an object payload, else null. */
function rolloutLine(line) {
  try {
    const d = JSON.parse(line);
    return d?.payload !== null && typeof d?.payload === 'object' ? d : null;
  } catch {
    return null;
  }
}

function readRolloutLine(s, state, d) {
  const p = d.payload;
  if (d.type === 'session_meta') {
    if (!state.meta) Object.assign(s, codexMeta(p));
    state.meta = true;
    return;
  }
  const ts = Date.parse(d.timestamp);
  if (!Number.isFinite(ts)) return;
  if (d.type === 'turn_context' && typeof p.model === 'string') state.models.add(p.model);
  else if (d.type === 'compacted') {
    s.events.push({ ts, type: 'compact', trigger: 'unknown', preTokens: num(p.latest_token_usage_record?.usage?.input_tokens), durationMs: 0 });
  } else if (d.type === 'event_msg') readTurnEvent(s, state, p, ts);
  else if (d.type === 'response_item') readItem(s, p, ts);
}

/** A turn's start or end, or a token_count (a model response, with its reading). */
function readTurnEvent(s, state, p, ts) {
  if (p.type === 'task_started') {
    state.seg += 1;
    s.starts.push(ts);
    s.events.push({ ts, type: 'note' });
  } else if (p.type === 'task_complete' || p.type === 'turn_aborted') {
    s.events.push({ ts, type: 'turn' });
    state.seg += 1;
  } else if (p.type === 'token_count') {
    s.readings.push(codexReading(p, ts, state.seg));
    s.events.push({ ts, type: 'turn' });
  }
}

/**
 * Whether a user message is Codex's own: one or more complete elements `<tag ...>...</tag>` (or
 * `<tag .../>`) with only whitespace between them, after at most one `# AGENTS.md instructions for ...`
 * first line. An async question's reply is the owner's. One forward scan: an AGENTS.md message can be 40 KB.
 */
export function isCodexOwn(message) {
  const t = String(message ?? '').trim();
  let i = CODEX_AGENTS_LINE.exec(t)?.[0].length ?? 0;
  let elements = 0;
  for (;;) {
    while (i < t.length && /\s/.test(t[i])) i += 1;
    if (i >= t.length) return elements > 0;
    const tag = CODEX_TAG.exec(t.slice(i, i + 80));
    if (!tag || tag[1] === CODEX_OWNER_TAG) return false;
    const open = t.indexOf('>', i);
    if (open === -1) return false;
    i = open + 1;
    elements += 1;
    if (t[open - 1] === '/') continue;
    // Depth by the same name: the next open and the next close are each looked up once, then moved on.
    const [opening, closing] = [`<${tag[1]}`, `</${tag[1]}>`];
    // A same-name opening that closes itself (`<a/>`) raises no depth. The `>` that ends an opening is looked up once.
    let gt = 0;
    const nextOpen = (from) => {
      for (let k = t.indexOf(opening, from); k !== -1; k = t.indexOf(opening, k + 1)) {
        if (!/[\s/>]/.test(t[k + opening.length] ?? '')) continue;
        if (gt !== -1 && gt < k) gt = t.indexOf('>', k);
        if (gt === -1 || t[gt - 1] !== '/') return k;
      }
      return -1;
    };
    let depth = 1;
    let o = nextOpen(i);
    let c = t.indexOf(closing, i);
    while (depth > 0) {
      if (c === -1) return false;
      if (o !== -1 && o < c) {
        depth += 1;
        o = nextOpen(o + 1);
      } else {
        depth -= 1;
        i = c + closing.length;
        c = t.indexOf(closing, i);
      }
    }
  }
}

/** A question to the owner, a tool's output, or a user line: typed by the owner, or written by Codex. */
function readItem(s, p, ts) {
  if (p.type === 'function_call' && (p.name === CODEX_ASK || p.name === CODEX_ASK_ASYNC) && p.call_id) {
    s.events.push({ ts, type: 'ask', id: p.call_id, ...(p.name === CODEX_ASK_ASYNC ? { async: true } : {}) });
  } else if (p.type === 'function_call_output' && p.call_id) s.events.push({ ts, type: 'result', id: p.call_id });
  else if (p.type === 'message' && p.role === 'user') {
    const typed = (Array.isArray(p.content) ? p.content : [])
      .filter((c) => c?.type === 'input_text')
      .map((c) => String(c.text ?? ''))
      .join('');
    s.events.push({ ts, type: typed.trim() !== '' && !isCodexOwn(typed) ? 'prompt' : 'note' });
  }
}

/** A thread's token growth inside the window: each reading's step from the one before it; a drop starts over. */
function tokenGrowth(readings, since, until) {
  const out = { input: 0, cached: 0, output: 0, total: 0 };
  let prev = null;
  for (const r of readings) {
    if (!r.tokens) continue;
    if (inWindow(r.ts, since, until)) {
      for (const k of Object.keys(out)) {
        const before = prev?.[k] ?? 0;
        out[k] += r.tokens[k] >= before ? r.tokens[k] - before : r.tokens[k];
      }
    }
    prev = r.tokens;
  }
  return out;
}

/**
 * Each turn's quota interval: its first reading inside the window to its last, split where the weekly
 * window resets. The growth between two turns is not a turn's: the quota is account-wide, and an idle
 * thread's next reading includes whatever else ran on the account meanwhile.
 */
function hostIntervals(sessions, { since = null, until = null } = {}) {
  const out = [];
  for (const s of sessions) {
    let cur = null;
    for (const r of s.readings) {
      if (r.used === null || r.resets === null || !inWindow(r.ts, since, until)) continue;
      if (cur && cur.seg === r.seg && Math.abs(r.resets - cur.reset) <= SAME_WINDOW_S) cur.hi = r.used;
      else {
        if (cur) out.push(cur);
        cur = { seg: r.seg, reset: r.resets, lo: r.used, hi: r.used };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/**
 * A Codex host's threads in the window: the main sessions and subagents with a turn or a reading in
 * it, the main threads' turns, questions and compactions, every thread's token growth and the share
 * of its input read from cache, and the weekly quota the turns used (one union per window, as for the
 * ledger, and as account-wide). Codex reports tokens, not dollars.
 */
export function summarizeCodexHost(sessions, { since = null, until = null } = {}) {
  const out = { sessions: 0, subagents: 0, turns: 0, questions: 0, compactions: 0, compactPreTokens: 0, tokens: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, cacheHit: 0, percent: 0, models: [] };
  const inside = (ts) => inWindow(ts, since, until);
  const models = new Set();
  const events = [];
  for (const s of sessions) {
    if (!s.readings.some((r) => inside(r.ts)) && !s.starts.some(inside)) continue;
    const main = s.kind !== 'sub';
    out[main ? 'sessions' : 'subagents'] += 1;
    for (const m of s.models) models.add(m);
    const g = tokenGrowth(s.readings, since, until);
    out.tokens += g.total;
    out.inputTokens += g.input;
    out.cachedTokens += g.cached;
    out.outputTokens += g.output;
    if (!main) continue;
    out.turns += s.starts.filter(inside).length;
    out.questions += s.events.filter((e) => e.type === 'ask' && inside(e.ts)).length;
    for (const e of s.events) events.push(e);
  }
  const comp = summarizeCompactions(events, { since, until });
  out.compactions = comp.count;
  out.compactPreTokens = comp.medianPreTokens;
  out.cacheHit = out.inputTokens > 0 ? round1((out.cachedTokens / out.inputTokens) * 100) : 0;
  out.percent = quotaPercent(hostIntervals(sessions, { since, until }));
  out.models = [...models].sort();
  return out;
}

/** A unit's Codex %: the ledger's runs and the host's turns, one union per quota window. */
export function codexPercent(entries, sessions, { since = null, until = null, cwdMatch = null } = {}) {
  const runs = ledgerRows(entries, { since, until, cwdMatch }).ran.map(runInterval).filter(Boolean);
  return quotaPercent([...runs, ...hostIntervals(sessions, { since, until })]);
}

const usd = (v) => `$${v.toFixed(2)}`;

/**
 * The one line for a log cell. `codex` is null when there is no ledger. `claudeRuns` (claude-run's
 * ledger) adds its dollars to the cost and the Claude %; `host` (a Codex host's threads) is named in
 * the Codex part, whose % is then `percent`, the union with the ledger's runs (codexPercent).
 */
export function summaryLine(claude, codex, { claudeRuns = null, host = null, percent = null } = {}) {
  const total = claude.total + (claudeRuns?.usd ?? 0);
  // Runs with no cost (a timeout) are named: the dollars before them are not the whole spend.
  const runs =
    claudeRuns && (claudeRuns.runs || claudeRuns.notRun)
      ? ` (${claudeRuns.runs} claude-run${claudeRuns.unpriced ? `, ${claudeRuns.unpriced} without a cost` : ''}${claudeRuns.notRun ? `, ${claudeRuns.notRun} not run` : ''})`
      : '';
  const ledger = codex === null ? null : `${codex.runs} runs${codex.notRun ? `, ${codex.notRun} not run` : ''}`;
  const tail =
    codex === null && host === null
      ? 'Codex no ledger'
      : `Codex ${host ? (percent ?? host.percent) : codex.percent}% (${[host ? 'host' : null, ledger].filter(Boolean).join(', ')})`;
  return `Cost ${usd(total)} · Claude ${claudeRuns ? round1(total / DOLLARS_PER_PERCENT) : claude.claudePercent}%${runs} · ${tail}`;
}

const pairs = (o, fmt = (v) => v) =>
  Object.entries(o)
    .sort((x, y) => (typeof y[1] === 'number' ? y[1] - x[1] : 0))
    .map(([k, v]) => `${k} ${fmt(v)}`)
    .join(' · ') || 'none';

const kTokens = (n) => `${Math.round(n / 1000)}K`;

/** 14000 -> 14K, 2_500_000 -> 2.5M. */
export const fmtTokens = (n) => (n >= 1e6 ? `${round1(n / 1e6)}M` : n >= 1e3 ? kTokens(n) : String(n));

const ACCOUNT_WIDE = '  the % is account-wide: it includes any other work on the same Codex account during the window';

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
 * section ({ times, compactions, cache }), the `--by-step` section ({ steps }), claude-run's ledger
 * ({ claudeRuns }) and a Codex host ({ host, percent }) when present.
 */
export function formatReport(claude, codex, extra = {}) {
  const lines = [
    summaryLine(claude, codex, extra),
    '',
    `Claude: ${usd(claude.total)} (main ${usd(claude.main)} · subagents ${usd(claude.sub)}) = ${claude.claudePercent}% of the weekly limit at $${DOLLARS_PER_PERCENT}/%`,
    `  by model: ${pairs(claude.byFamily, usd)}`,
    `  turns ${claude.turns} · output tokens ${claude.outputTokens}${claude.unpricedTurns ? ` · unpriced turns ${claude.unpricedTurns}` : ''}`,
    ...(claude.familyRated?.length ? [`  priced at family rates: ${claude.familyRated.join(', ')}`] : []),
    `  subagents ${claude.subagentCount}: ${pairs(claude.subagents)}`,
  ];
  const r = extra.claudeRuns;
  if (r) {
    lines.push(
      `Claude runs (claude-run): ${r.runs} runs (${pairs(r.byKind)}) · ${usd(r.usd)}${r.notRun ? ` · ${r.notRun} not run (reserved or unavailable)` : ''}${r.unpriced ? ` · ${r.unpriced} without a cost` : ''}`,
    );
  }
  if (codex === null) lines.push('Codex: no ledger');
  else {
    lines.push(
      `Codex: ${codex.runs} runs (${pairs(codex.byKind)})${codex.notRun ? ` · ${codex.notRun} not run (reserved or unavailable)` : ''} · ${codex.percent}% of quota · ${codex.ms} ms`,
      ACCOUNT_WIDE,
      ...(codex.uncounted ? [`  ${codex.uncounted} runs without a same-window quota reading are not in the %`] : []),
    );
  }
  const h = extra.host;
  if (h) {
    lines.push(
      `Codex host: ${h.sessions} sessions (${h.subagents} subagents) · ${h.turns} turns · ${h.questions} questions · ${h.compactions} compactions · tokens ${fmtTokens(h.tokens)} (${h.cacheHit}% of input cached) · ${h.percent}% of quota${h.models.length ? ` · ${h.models.join(', ')}` : ''}`,
      ...(codex === null ? [ACCOUNT_WIDE] : []),
    );
  }
  if (extra.times) lines.push('', ...timesLines(extra));
  if (extra.steps) lines.push('', ...stepLines(extra.steps));
  lines.push('', 'Dollar figures are API-equivalent and relative, not a bill.');
  return `${lines.join('\n')}\n`;
}
