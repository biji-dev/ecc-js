// harness-bootstrap unit-step core (generated YYYY-MM-DD). Pure core of scripts/unit-step.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- where the steps file lives, re-derived from the project's state-file path.
/**
 * Step markers: one JSON line per step start or end, appended beside the unit's state file, so a
 * unit's time and cost can be split by runner step afterwards. No I/O here, so
 * `unit-step-core.test.mjs` can pin each rule.
 *
 * WHY A MARKER. Ledger rows carry no times and were written in one batch at the end, so a unit's
 * transcripts said what it cost but not which step spent it: one measured unit put 19% of its cost
 * into the step that writes the record, and only a by-hand reconstruction found it. A start and a
 * done line per step, written when the step begins and ends, turns that split into a join.
 */

// ---- [B] project bindings
// [B] The directory of the unit's state file (scope-guard.md › the state file). The steps file
// `<unit>.steps.jsonl` sits beside the state file and is committed with it.
export const STEPS_DIR = 'docs/plans';
// ---- end [B]

export const EVENTS = ['start', 'done'];
export const MAX_ROUND = 99;
// A unit id names a file: `<unit>.steps.jsonl` sits beside the state file. One `/` nests the file under
// the id's first segment (`harness/sweep-2026-10-28`, `change/fix-login`); each segment starts with a
// letter or digit, so `..`, an absolute path and a third level stay refused. The source is exported
// so every reader of a unit id (unit-cost's step tag, retro's marker command) matches the same rule.
export const UNIT_ID_SOURCE = '[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)?';
const UNIT_ID = new RegExp(`^${UNIT_ID_SOURCE}$`);
const STEP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/** `8b r2` -- how a step and its round are named everywhere (reports, dispatch tags). */
export const label = (m) => `${m.step} r${m.round}`;

/** Reject unknown flags, a bad id, event or round, and a wrong argument count before any file is touched. */
export function parseArgs(argv) {
  const a = { unit: null, step: null, event: null, round: '1', dir: null, at: null, list: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--list') a.list = true;
    else if (t === '--round' || t === '--dir' || t === '--at') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[t.slice(2)] = v;
    } else if (t.startsWith('--')) throw new Error(`unknown option ${t}`);
    else positional.push(t);
  }
  if (a.list) {
    if (positional.length !== 1) throw new Error('--list takes the unit id only');
    [a.unit] = positional;
  } else {
    if (positional.length !== 3) throw new Error('needs <unit> <step> start|done');
    [a.unit, a.step, a.event] = positional;
    if (!STEP_ID.test(a.step)) throw new Error(`bad step "${a.step}"`);
    if (!EVENTS.includes(a.event)) throw new Error(`the event is start or done, not "${a.event}"`);
  }
  if (!UNIT_ID.test(a.unit)) throw new Error(`bad unit id "${a.unit}"`);
  if (!/^\d+$/.test(a.round) || Number(a.round) < 1 || Number(a.round) > MAX_ROUND) {
    throw new Error(`--round is a whole number from 1 to ${MAX_ROUND}, not "${a.round}"`);
  }
  a.round = Number(a.round);
  if (a.at !== null && Number.isNaN(Date.parse(a.at))) throw new Error(`--at is not an ISO time: ${a.at}`);
  return a;
}

/** The JSON line for one marker; `t` is an ISO time. */
export function stepLine({ t, unit, step, event, round }) {
  return JSON.stringify({ t, unit, step, event, round });
}

/** A steps file's text -> its markers in file order, each with `ts`; a torn or foreign line is skipped. */
export function parseSteps(text) {
  const markers = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // a torn last line
    }
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const ts = Date.parse(e.t);
    if (!Number.isFinite(ts) || !EVENTS.includes(e.event) || typeof e.step !== 'string' || e.step === '') continue;
    markers.push({
      t: e.t,
      ts,
      unit: typeof e.unit === 'string' ? e.unit : '',
      step: e.step,
      event: e.event,
      round: Number.isInteger(e.round) && e.round > 0 ? e.round : 1,
    });
  }
  return markers;
}

/**
 * Markers -> step intervals in time order. Steps run one at a time on the main thread, so a start
 * while another step is open closes that one at the new start (`implicit`); a second start of the
 * step already open is a repeat and is ignored. A done that matches no open step goes to `problems`
 * and never into an interval. A step still open at the end runs to `untilMs` (the last transcript
 * turn, say) and is `open`; without `untilMs` its end is null.
 */
export function stepIntervals(markers, untilMs = null) {
  const sorted = markers.map((m, i) => ({ m, i })).sort((x, y) => x.m.ts - y.m.ts || x.i - y.i);
  const intervals = [];
  const problems = [];
  let cur = null;
  for (const { m } of sorted) {
    if (m.event === 'start') {
      if (cur && cur.step === m.step && cur.round === m.round) {
        problems.push(`repeated start of ${label(m)} at ${m.t}`);
        continue;
      }
      if (cur) {
        cur.end = m.ts;
        cur.implicit = true;
        intervals.push(cur);
      }
      cur = { step: m.step, round: m.round, start: m.ts, end: null, implicit: false, open: false };
    } else if (cur && cur.step === m.step && cur.round === m.round) {
      cur.end = m.ts;
      intervals.push(cur);
      cur = null;
    } else problems.push(`done of ${label(m)} at ${m.t} matches no open step`);
  }
  if (cur) {
    cur.open = true;
    cur.end = Number.isFinite(untilMs) && untilMs >= cur.start ? untilMs : null;
    intervals.push(cur);
  }
  return { intervals, problems };
}

/** What appending `next` after `markers` means: '' when it is in order, else one warning line. */
export function checkNext(markers, next) {
  const last = markers.reduce((max, m) => Math.max(max, m.ts), -Infinity);
  if (Number.isFinite(next.ts) && next.ts < last) return `${label(next)} ${next.event} is earlier than the last marker`;
  const open = stepIntervals(markers).intervals.find((iv) => iv.open);
  if (next.event === 'done') {
    if (!open) return `no step is open, so done of ${label(next)} has no start`;
    if (open.step !== next.step || open.round !== next.round) return `the open step is ${label(open)}, not ${label(next)}`;
    return '';
  }
  return open && open.step === next.step && open.round === next.round ? `${label(next)} is already open` : '';
}

/** "1h05m", "37m"; "0m" under a minute. */
export function formatMinutes(ms) {
  const minutes = Math.floor(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

const hhmm = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/**
 * The `--list` text: one line per interval (UTC times), then every problem prefixed with `!`. A step
 * closed by the next start carries no note: that is the runner's normal path (`runner.md`).
 */
export function formatIntervals({ intervals, problems }) {
  const lines = intervals.map((iv) => {
    const end = iv.end === null ? 'open' : hhmm(iv.end).slice(11);
    const took = iv.end === null ? '' : `  ${formatMinutes(iv.end - iv.start)}`;
    const note = iv.open ? ' (open)' : '';
    return `${label(iv).padEnd(10)} ${hhmm(iv.start)} → ${end}${took}${note}`;
  });
  if (lines.length === 0) lines.push('no step markers');
  for (const p of problems) lines.push(`! ${p}`);
  return `${lines.join('\n')}\n`;
}
