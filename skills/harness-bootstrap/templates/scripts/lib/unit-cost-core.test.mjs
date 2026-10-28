// harness-bootstrap unit-cost tests (generated YYYY-MM-DD). Run: node --test scripts/lib/unit-cost-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: the price tests read PRICE, CACHE_WRITE_* and
// DOLLARS_PER_PERCENT, so a recalibrated table keeps them green; no test pins a dollar literal.
// Hermetic: the wrapper runs against a synthetic projects dir in a temp directory with a fresh HOME.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CACHE_TTL_MIN,
  CACHE_WRITE_1H,
  CACHE_WRITE_5M,
  DOLLARS_PER_PERCENT,
  PRICE,
  PRICED_IDS,
  codexPercent,
  dedupeRows,
  family,
  formatReport,
  inWindow,
  isOwnerPrompt,
  isPricedId,
  ledgerWindow,
  parseArgs,
  parseCodexSession,
  parseEvents,
  parseLedger,
  parseTag,
  parseTranscript,
  rowCost,
  summarizeCache,
  summarizeClaude,
  summarizeClaudeRuns,
  summarizeCodexHost,
  summarizeCompactions,
  summarizeLedger,
  summarizeSteps,
  summarizeTimes,
  summaryLine,
  unionMs,
} from './unit-cost-core.mjs';
import { codexProjectSessions, codexSessionFiles, codexSessionsDir, fileLines } from './run-sources.mjs';

const RUNNER = fileURLToPath(new URL('../unit-cost.mjs', import.meta.url));
const M = 1_000_000;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

const tempDirs = [];
function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** One transcript line: an assistant turn with the given usage. */
function turn({ id = 'm1', req = 'r1', model = 'claude-opus-5-5', at = '2026-10-24T01:00:00Z', usage = {}, type = 'assistant' }) {
  return JSON.stringify({ type, timestamp: at, requestId: req, message: { id, model, usage } });
}

test('rowCost prices input, output and cache reads per family', () => {
  const [pin, pout, pread] = PRICE.sonnet;
  near(rowCost('sonnet', { input_tokens: M, output_tokens: M, cache_read_input_tokens: M }), pin + pout + pread);
  near(rowCost('opus', { output_tokens: 2 * M }), 2 * PRICE.opus[1]);
});

test('rowCost prices a 5m cache write at x5m and a 1h write at x1h of the input rate', () => {
  const pin = PRICE.opus[0];
  near(rowCost('opus', { cache_creation: { ephemeral_5m_input_tokens: M } }), pin * CACHE_WRITE_5M);
  near(rowCost('opus', { cache_creation: { ephemeral_1h_input_tokens: M } }), pin * CACHE_WRITE_1H);
  near(
    rowCost('opus', { cache_creation: { ephemeral_5m_input_tokens: M, ephemeral_1h_input_tokens: M } }),
    pin * (CACHE_WRITE_5M + CACHE_WRITE_1H),
  );
  assert.ok(CACHE_WRITE_1H > CACHE_WRITE_5M);
});

test('rowCost falls back to the flat cache_creation_input_tokens at the 5m rate only when both splits are 0', () => {
  const pin = PRICE.opus[0];
  near(rowCost('opus', { cache_creation_input_tokens: M }), pin * CACHE_WRITE_5M);
  near(rowCost('opus', { cache_creation_input_tokens: M, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } }), pin * CACHE_WRITE_5M);
  near(rowCost('opus', { cache_creation_input_tokens: M, cache_creation: { ephemeral_1h_input_tokens: M } }), pin * CACHE_WRITE_1H);
});

test('rowCost treats missing, null and non-numeric fields as 0 and an unknown family as free', () => {
  assert.equal(rowCost('opus', {}), 0);
  assert.equal(rowCost('opus', { input_tokens: null, output_tokens: 'x', cache_creation: null }), 0);
  assert.equal(rowCost('other', { input_tokens: M, output_tokens: M }), 0);
});

test('family matches the model id on the family word and says other for anything unknown', () => {
  assert.equal(family('claude-opus-5-5'), 'opus');
  assert.equal(family('claude-sonnet-5-5'), 'sonnet');
  assert.equal(family('claude-haiku-4-5'), 'haiku');
  assert.equal(family('fable-1'), 'fable');
  assert.equal(family('gpt-6'), 'other');
  assert.equal(family(undefined), 'other');
});

test('parseTranscript keeps assistant turns with usage and skips synthetic, user, torn and usage-less lines', () => {
  const text = [
    turn({ id: 'a', usage: { output_tokens: 10 } }),
    turn({ id: 'b', model: '<synthetic>', usage: { output_tokens: 99 } }),
    turn({ id: 'c', type: 'user', usage: { output_tokens: 99 } }),
    '{"type":"assistant","message":{"usage":',
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-24T01:00:00Z', message: { id: 'd', model: 'claude-opus-5-5' } }),
    '',
    turn({ id: 'e', usage: { output_tokens: 5 } }),
  ].join('\n');
  const rows = parseTranscript(text, { kind: 'sub', agentId: 'A', agentType: 'implementer' });
  assert.deepEqual(rows.map((r) => [r.key, r.output, r.kind, r.agentType]), [
    ['a|r1', 10, 'sub', 'implementer'],
    ['e|r1', 5, 'sub', 'implementer'],
  ]);
  assert.equal(parseTranscript(turn({ usage: { output_tokens: 1 } }))[0].kind, 'main');
});

test('dedupeRows drops a repeated (message.id, requestId) pair, keeps a new request and keeps keyless rows', () => {
  const t = (id, req) => turn({ id, req, usage: { output_tokens: 1 } });
  const rows = parseTranscript([t('m1', 'r1'), t('m1', 'r1'), t('m1', 'r2'), t('m2', 'r1')].join('\n'));
  assert.equal(dedupeRows(rows).length, 3);
  const keyless = [{ key: null }, { key: null }];
  assert.equal(dedupeRows(keyless).length, 2);
});

test('dedupeRows keeps one row per message: the first copy\'s place and labels, the usage of the copy with the most output', () => {
  const copy = (id, at, output, input, ctx) => parseTranscript(turn({ id, at, usage: { input_tokens: input, output_tokens: output } }), ctx)[0];
  const T1 = '2026-10-24T01:00:00Z';
  const T2 = '2026-10-24T01:00:05Z';
  const T3 = '2026-10-24T01:00:09Z';
  const first = { kind: 'sub', agentId: 'A', agentType: 'implementer', session: 's1', description: 'first file' };
  const later = { kind: 'main', agentId: 'B', agentType: 'reviewer', session: 's2', description: 'later file' };
  const k1 = copy('m1', T1, 1, 10, first);
  const big = copy('m1', T2, 1000, 20, later);
  const small = copy('m1', T3, 500, 30, later);
  const before = structuredClone([k1, big, small]);
  const [kept, ...rest] = dedupeRows([k1, big, small]);
  assert.equal(rest.length, 0);
  // the most output, not the last copy; the place and the labels are the first copy's
  assert.deepEqual([kept.output, kept.input, kept.cacheRead, kept.cacheWrite, kept.writeCost, kept.cost], [big.output, big.input, big.cacheRead, big.cacheWrite, big.writeCost, big.cost]);
  assert.equal(kept.output, 1000);
  assert.equal(kept.input, 20);
  assert.deepEqual([kept.ts, kept.kind, kept.agentId, kept.agentType, kept.session, kept.agentDescription], [k1.ts, 'sub', 'A', 'implementer', 's1', 'first file']);
  assert.deepEqual([k1, big, small], before);
  // equal outputs keep the first copy's usage
  assert.equal(dedupeRows([k1, copy('m1', T2, 1, 99, later)])[0].input, 10);
  // a keyless row and a second key keep their places
  const x = copy('m2', T1, 7, 1, first);
  const keyless = { ...x, key: null };
  assert.deepEqual(dedupeRows([k1, keyless, big]).map((r) => [r.key, r.output]), [['m1|r1', 1000], [null, 7]]);
  assert.deepEqual(dedupeRows([k1, x, big]).map((r) => [r.key, r.output]), [['m1|r1', 1000], ['m2|r1', 7]]);
  // every cost figure takes the larger copy
  const s = summarizeClaude([k1, big]);
  assert.equal(s.outputTokens, 1000);
  near(s.total, big.cost);
  const early = copy('m1', atMin(5), 1, 10, { kind: 'main' });
  const late = copy('m1', atMin(35), 1000, 20, { kind: 'main' });
  const markers = [marker('4', 'start', 0), marker('4', 'done', 30), marker('8c', 'start', 30), marker('8c', 'done', 50)];
  const steps = Object.fromEntries(summarizeSteps([early, late], markers, { unit: 'U-1' }).steps.map((st) => [st.label, st]));
  near(steps['4 r1'].usd, late.cost);
  assert.equal(steps['4 r1'].turns, 1);
  assert.equal(steps['8c r1'].turns, 0);
});

test('summarizeClaude dedupes across files: a turn repeated in a subagent file counts once', () => {
  const line = turn({ id: 'same', usage: { output_tokens: M } });
  const rows = [...parseTranscript(line, { kind: 'main' }), ...parseTranscript(line, { kind: 'sub', agentId: 'A', agentType: 'x' })];
  const s = summarizeClaude(rows);
  assert.equal(s.turns, 1);
  near(s.total, PRICE.opus[1]);
  assert.equal(s.sub, 0);
});

test('inWindow is inclusive at both bounds, open when a bound is absent, and out for an unreadable time', () => {
  const t = Date.parse('2026-10-24T01:00:00Z');
  assert.equal(inWindow(t, '2026-10-24T01:00:00Z', '2026-10-24T01:00:00Z'), true);
  assert.equal(inWindow(t, '2026-10-24T01:00:01Z', null), false);
  assert.equal(inWindow(t, null, '2026-10-24T00:59:59Z'), false);
  assert.equal(inWindow(NaN, null, null), true);
  assert.equal(inWindow(NaN, '2026-10-24T00:00:00Z', null), false);
});

test('summarizeClaude filters by the window and attributes main versus subagent dollars', () => {
  const u = { output_tokens: M };
  const main = parseTranscript(
    [turn({ id: 'a', at: '2026-10-24T01:00:00Z', usage: u }), turn({ id: 'b', at: '2026-10-25T01:00:00Z', usage: u })].join('\n'),
    { kind: 'main' },
  );
  const sub = parseTranscript(turn({ id: 'c', model: 'claude-sonnet-5-5', at: '2026-10-24T02:00:00Z', usage: u }), {
    kind: 'sub',
    agentId: 'A1',
    agentType: 'implementer',
  });
  const all = summarizeClaude([...main, ...sub]);
  assert.equal(all.turns, 3);
  near(all.main, 2 * PRICE.opus[1]);
  near(all.sub, PRICE.sonnet[1]);
  near(all.total, all.main + all.sub);
  near(all.byFamily.opus, 2 * PRICE.opus[1]);
  near(all.byFamily.sonnet, PRICE.sonnet[1]);
  assert.equal(all.outputTokens, 3 * M);
  const day = summarizeClaude([...main, ...sub], { since: '2026-10-24T00:00:00Z', until: '2026-10-24T23:59:59Z' });
  assert.equal(day.turns, 2);
  near(day.main, PRICE.opus[1]);
});

test('summarizeClaude counts each subagent once and groups them by agentType', () => {
  const u = { output_tokens: 1 };
  const rows = [
    ...parseTranscript([turn({ id: 'a', usage: u }), turn({ id: 'b', usage: u })].join('\n'), { kind: 'sub', agentId: 'A1', agentType: 'implementer' }),
    ...parseTranscript(turn({ id: 'c', usage: u }), { kind: 'sub', agentId: 'A2', agentType: 'implementer' }),
    ...parseTranscript(turn({ id: 'd', usage: u }), { kind: 'sub', agentId: 'A3', agentType: 'code-reviewer' }),
    ...parseTranscript(turn({ id: 'e', usage: u }), { kind: 'sub', agentId: 'A4', agentType: null }),
  ];
  const s = summarizeClaude(rows);
  assert.equal(s.subagentCount, 4);
  assert.deepEqual(s.subagents, { implementer: 2, 'code-reviewer': 1, unknown: 1 });
});

test('summarizeClaude reports Claude % as dollars over DOLLARS_PER_PERCENT to one decimal and counts unpriced turns', () => {
  const rows = parseTranscript(
    [turn({ id: 'a', usage: { output_tokens: M } }), turn({ id: 'b', model: 'mystery-1', usage: { output_tokens: M } })].join('\n'),
  );
  const s = summarizeClaude(rows);
  assert.equal(s.claudePercent, Math.round((PRICE.opus[1] / DOLLARS_PER_PERCENT) * 10) / 10);
  assert.equal(s.unpricedTurns, 1);
  assert.equal(summarizeClaude([]).total, 0);
});

const run = (over) => ({
  at: '2026-10-24T01:00:00Z',
  kind: 'review',
  cwd: '/p/app',
  ms: 1000,
  limitsBefore: { usedPercent: 10, resetsAt: 111 },
  limitsAfter: { usedPercent: 12, resetsAt: 111 },
  ...over,
});

test('summarizeLedger sums the quota delta of same-window runs and counts runs by kind with minutes', () => {
  const s = summarizeLedger([
    run(),
    run({ kind: 'adversarial', ms: 500, limitsBefore: { usedPercent: 12, resetsAt: 111 }, limitsAfter: { usedPercent: 15.5, resetsAt: 111 } }),
  ]);
  assert.equal(s.runs, 2);
  assert.deepEqual(s.byKind, { review: 1, adversarial: 1 });
  assert.equal(s.percent, 5.5);
  assert.equal(s.ms, 1500);
});

test('summarizeLedger counts the union of overlapping quota intervals once: 10->12 and 10->13 is 3, not 5', () => {
  const at = (before, after, reset = 111) => ({ limitsBefore: { usedPercent: before, resetsAt: reset }, limitsAfter: { usedPercent: after, resetsAt: reset } });
  assert.equal(summarizeLedger([run(at(10, 12)), run(at(10, 13))]).percent, 3);
  // Nested, chained and disjoint intervals: [10,20] swallows [12,14]; [18,25] chains on; [30,31] is apart.
  assert.equal(summarizeLedger([run(at(10, 20)), run(at(12, 14)), run(at(18, 25)), run(at(30, 31))]).percent, 16);
  // Another window (a different resetsAt) is summed separately, so equal intervals there do not merge.
  assert.equal(summarizeLedger([run(at(10, 12)), run(at(10, 12, 999_999))]).percent, 4);
  // A one-second drift of resetsAt inside one window does not split it.
  assert.equal(summarizeLedger([run(at(10, 12, 1793382102)), run({ limitsBefore: { usedPercent: 11, resetsAt: 1793382103 }, limitsAfter: { usedPercent: 13, resetsAt: 1793382103 } })]).percent, 3);
  assert.equal(summarizeLedger([run({ limitsBefore: { usedPercent: 10, resetsAt: 1793382102 }, limitsAfter: { usedPercent: 12, resetsAt: 1793382103 } })]).percent, 2);
});

test('summarizeLedger keeps reserved and unavailable rows out of runs and counts them as notRun', () => {
  const s = summarizeLedger([run(), run({ outcome: 'ok' }), run({ outcome: 'failed' }), run({ outcome: 'reserved', limitsAfter: undefined }), run({ outcome: 'unavailable', ms: 9999 })]);
  assert.equal(s.runs, 3);
  assert.equal(s.notRun, 2);
  assert.equal(s.ms, 3000);
  assert.deepEqual(s.byKind, { review: 3 });
  assert.equal(summarizeLedger([run()]).notRun, 0);
});

test('summarizeLedger does not count a delta across a reset (different resetsAt) or a negative delta', () => {
  const s = summarizeLedger([
    run({ limitsBefore: { usedPercent: 98, resetsAt: 111 }, limitsAfter: { usedPercent: 1, resetsAt: 222 } }),
    run({ limitsBefore: { usedPercent: 20, resetsAt: 111 }, limitsAfter: { usedPercent: 18, resetsAt: 111 } }),
    run(),
  ]);
  assert.equal(s.runs, 3);
  assert.equal(s.percent, 2);
  assert.equal(s.uncounted, 1);
});

test('summarizeLedger survives missing fields: no limits, no resetsAt, no kind, no ms', () => {
  const s = summarizeLedger([
    { at: '2026-10-24T01:00:00Z' },
    run({ limitsBefore: undefined }),
    run({ limitsAfter: { usedPercent: 50 }, limitsBefore: { usedPercent: 10 } }),
    run({ kind: undefined, ms: undefined }),
  ]);
  assert.equal(s.runs, 4);
  assert.equal(s.percent, 2);
  assert.equal(s.byKind.unknown, 2);
  assert.equal(s.uncounted, 3);
});

test('summarizeLedger filters by the window and by a substring of cwd', () => {
  const entries = [
    run({ at: '2026-10-23T01:00:00Z' }),
    run({ at: '2026-10-24T01:00:00Z', cwd: '/p/app/.worktrees/x' }),
    run({ at: '2026-10-24T02:00:00Z', cwd: '/p/other' }),
    run({ at: 'not a time' }),
  ];
  assert.equal(summarizeLedger(entries).runs, 4);
  assert.equal(summarizeLedger(entries, { since: '2026-10-24T00:00:00Z' }).runs, 2);
  assert.equal(summarizeLedger(entries, { since: '2026-10-24T00:00:00Z', until: '2026-10-24T01:30:00Z' }).runs, 1);
  assert.equal(summarizeLedger(entries, { cwdMatch: '/p/app' }).runs, 3);
});

test('ledgerWindow fills only the bounds the owner left out, with the sessions\' first and last time', () => {
  const lo = Date.parse('2026-10-24T01:00:00Z');
  const hi = Date.parse('2026-10-24T03:00:00Z');
  const times = [hi, NaN, lo, Date.parse('2026-10-24T02:00:00Z'), Number.NaN];
  assert.deepEqual(ledgerWindow({ since: null, until: null }, times), { since: new Date(lo).toISOString(), until: new Date(hi).toISOString() });
  assert.deepEqual(ledgerWindow({ since: '2026-10-24T00:00:00Z', until: null }, times), { since: '2026-10-24T00:00:00Z', until: new Date(hi).toISOString() });
  assert.deepEqual(ledgerWindow({ since: null, until: '2026-10-24T04:00:00Z' }, times), { since: new Date(lo).toISOString(), until: '2026-10-24T04:00:00Z' });
  assert.deepEqual(ledgerWindow({ since: 'a', until: 'b' }, times), { since: 'a', until: 'b' });
  // no readable time: the window as given
  assert.deepEqual(ledgerWindow({ since: null, until: '2026-10-24T04:00:00Z' }, [NaN]), { since: null, until: '2026-10-24T04:00:00Z' });
  assert.deepEqual(ledgerWindow({ since: null, until: null }, []), { since: null, until: null });
  // a long session\'s times do not overflow an argument list
  const many = Array.from({ length: 200_000 }, (_, i) => lo + i);
  assert.deepEqual(ledgerWindow({ since: null, until: null }, many), { since: new Date(lo).toISOString(), until: new Date(lo + 199_999).toISOString() });
});

test('parseLedger skips blank and torn lines and non-object values', () => {
  const text = `${JSON.stringify(run())}\n\n{"at":\n[1,2]\n42\n${JSON.stringify(run({ kind: 'docs' }))}\n`;
  assert.deepEqual(parseLedger(text).map((e) => e.kind), ['review', 'docs']);
});

test('parseArgs splits the session list, reads every option and rejects unknown flags', () => {
  const a = parseArgs(['--session', 'a1, b2', '--projects-dir', '/p', '--since', '2026-10-24T00:00:00Z', '--until', '2026-10-25', '--ledger', 'l.jsonl', '--cwd-match', 'app', '--json']);
  assert.deepEqual(a.session, ['a1', 'b2']);
  assert.equal(a.projectsDir, '/p');
  assert.equal(a.ledger, 'l.jsonl');
  assert.equal(a.cwdMatch, 'app');
  assert.equal(a.json, true);
  assert.equal(a.line, false);
  assert.equal(parseArgs(['--session', 'a', '--line']).line, true);
  assert.throws(() => parseArgs(['--session', 'a', '--line', '--json']), /cannot be combined/);
  assert.deepEqual(parseArgs(['--session', 'a,b,a']).session, ['a', 'b']);
  assert.throws(() => parseArgs(['--session', 'a', '--nope']), /unknown option --nope/);
  assert.throws(() => parseArgs(['--session', 'a', 'stray']), /unknown option stray/);
});

test('parseArgs needs a session, a value after each option, a clean id, a real ISO time and since <= until', () => {
  assert.throws(() => parseArgs([]), /--session .* is required/);
  assert.throws(() => parseArgs(['--session']), /--session needs a value/);
  assert.throws(() => parseArgs(['--session', 'a', '--since', '--json']), /--since needs a value/);
  assert.throws(() => parseArgs(['--session', '../x']), /bad session id/);
  assert.throws(() => parseArgs(['--session', 'a/b']), /bad session id/);
  assert.throws(() => parseArgs(['--session', 'a', '--since', 'yesterday']), /not an ISO time/);
  assert.throws(() => parseArgs(['--session', 'a', '--since', '2026-10-25', '--until', '2026-10-24']), /after --until/);
});

test('summaryLine has the log-cell format, and says "no ledger" without one', () => {
  const claude = { total: 12.345, claudePercent: 0.6 };
  assert.equal(summaryLine(claude, { percent: 1.5, runs: 3 }), 'Cost $12.35 · Claude 0.6% · Codex 1.5% (3 runs)');
  assert.equal(summaryLine(claude, null), 'Cost $12.35 · Claude 0.6% · Codex no ledger');
  assert.equal(summaryLine(claude, { percent: 1.5, runs: 3, notRun: 0 }), 'Cost $12.35 · Claude 0.6% · Codex 1.5% (3 runs)');
  assert.equal(summaryLine(claude, { percent: 1.5, runs: 3, notRun: 2 }), 'Cost $12.35 · Claude 0.6% · Codex 1.5% (3 runs, 2 not run)');
});

test('a model id outside PRICED_IDS is priced at its family rate and named; a listed id (or one with a date suffix) is not', () => {
  assert.ok(PRICED_IDS.includes('claude-opus-5-5'));
  assert.equal(isPricedId('claude-opus-5-5'), true);
  assert.equal(isPricedId('claude-opus-5-5-20261001'), true);
  assert.equal(isPricedId('claude-opus-5-5[1m]'), true);
  assert.equal(isPricedId('claude-opus-4-1'), false);
  assert.equal(isPricedId(undefined), false);
  const u = { output_tokens: M };
  const rows = parseTranscript(
    [turn({ id: 'a', usage: u }), turn({ id: 'b', model: 'claude-opus-4-1', usage: u }), turn({ id: 'c', model: 'claude-sonnet-4-5', usage: u }), turn({ id: 'd', model: 'mystery-1', usage: u })].join('\n'),
  );
  const s = summarizeClaude(rows);
  near(s.byFamily.opus, 2 * PRICE.opus[1]); // the older opus is priced at the opus rate, not left out
  assert.deepEqual(s.familyRated, ['claude-opus-4-1', 'claude-sonnet-4-5']); // 'other' is unpriced, not family-rated
  assert.equal(s.unpricedTurns, 1);
  const text = formatReport(s, null);
  assert.match(text, /^ {2}priced at family rates: claude-opus-4-1, claude-sonnet-4-5$/m);
  assert.doesNotMatch(summaryLine(s, null), /family/);
  assert.doesNotMatch(formatReport(summarizeClaude(parseTranscript(turn({ usage: u }))), null), /family rates/);
});

test('formatReport carries the split, the model mix, the subagent mix and the no-ledger line', () => {
  const rows = parseTranscript(turn({ usage: { output_tokens: M } }), { kind: 'sub', agentId: 'A', agentType: 'implementer' });
  const text = formatReport(summarizeClaude(rows), null);
  assert.match(text, /^Cost \$\d+\.\d\d · Claude [\d.]+% · Codex no ledger\n/);
  assert.match(text, /main \$0\.00 · subagents \$/);
  assert.match(text, /by model: opus \$/);
  assert.match(text, /subagents 1: implementer 1/);
  assert.match(text, /^Codex: no ledger$/m);
  assert.match(text, /not a bill/);
  const withCodex = formatReport(summarizeClaude(rows), summarizeLedger([run(), run({ outcome: 'reserved' })]));
  assert.match(withCodex, /^Codex: 1 runs \(review 1\) · 1 not run \(reserved or unavailable\) · 2% of quota/m);
  assert.match(withCodex, /^ {2}the % is account-wide: it includes any other work on the same Codex account during the window$/m);
});

/** A synthetic projects dir: one session with a subagent, a ledger, nothing from the real HOME. */
function fixture() {
  const root = tmpDir('unit-cost-');
  const proj = path.join(root, 'projects', '-p-app');
  fs.mkdirSync(path.join(proj, 'sess1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'sess1.jsonl'), `${turn({ id: 'a', usage: { output_tokens: M } })}\n`);
  fs.writeFileSync(path.join(proj, 'sess1', 'subagents', 'agent-1.jsonl'), `${turn({ id: 'b', model: 'claude-sonnet-5-5', usage: { output_tokens: M } })}\n`);
  fs.writeFileSync(path.join(proj, 'sess1', 'subagents', 'agent-1.meta.json'), JSON.stringify({ agentType: 'implementer' }));
  fs.writeFileSync(path.join(root, 'ledger.jsonl'), `${JSON.stringify(run({ cwd: root }))}\n`);
  return root;
}

function cli(root, args, cwd = root, extra = {}) {
  const env = { ...process.env, HOME: tmpDir('unit-cost-home-') };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k === 'CODEX_HOME') delete env[k];
  Object.assign(env, extra);
  return spawnSync(process.execPath, [RUNNER, ...args], { cwd, env, encoding: 'utf8' });
}

test('the wrapper reads a session and its subagents, then the ledger, and prints the summary line', () => {
  const root = fixture();
  const r = cli(root, ['--session', 'sess1', '--projects-dir', path.join(root, 'projects'), '--ledger', path.join(root, 'ledger.jsonl')]);
  assert.equal(r.status, 0, r.stderr);
  const total = PRICE.opus[1] + PRICE.sonnet[1];
  assert.ok(r.stdout.startsWith(`Cost $${total.toFixed(2)} · Claude ${Math.round((total / DOLLARS_PER_PERCENT) * 10) / 10}% · Codex 2% (1 runs)\n`), r.stdout);
  assert.match(r.stdout, /subagents 1: implementer 1/);
  const j = JSON.parse(cli(root, ['--session', 'sess1', '--projects-dir', path.join(root, 'projects'), '--json']).stdout);
  assert.equal(j.claude.turns, 2);
  assert.equal(j.codex, null);
});

test('the wrapper exits 2 on a missing session and on a bad flag, and writes nothing', () => {
  const root = fixture();
  const bad = cli(root, ['--session', 'nope', '--projects-dir', path.join(root, 'projects')]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /session nope not found/);
  assert.equal(cli(root, ['--bogus']).status, 2);
  assert.deepEqual(fs.readdirSync(root).sort(), ['ledger.jsonl', 'projects']);
});

/** A real git repo with one commit; returns its root. */
function gitRepo() {
  const root = tmpDir('unit-cost-git-');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].includes(k)) delete env[k];
  const git = (...a) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: root, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'f.txt'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  return { root, git };
}

test('from a linked worktree the wrapper reads the main checkout\'s ledger, the one codex-run.mjs writes', () => {
  const { root, git } = gitRepo();
  const wt = path.join(root, '.worktrees', 'wt1');
  git('worktree', 'add', '-q', '-b', 'wt1', wt);
  fs.mkdirSync(path.join(root, '.codex-runs'));
  // one run made in the linked worktree, one in the main checkout: each reads its own
  fs.writeFileSync(path.join(root, '.codex-runs', 'ledger.jsonl'), `${[run({ cwd: wt }), run({ cwd: root })].map((e) => JSON.stringify(e)).join('\n')}\n`);
  const sessions = fixture();
  const args = ['--session', 'sess1', '--projects-dir', path.join(sessions, 'projects'), '--line'];
  const fromWorktree = cli(sessions, args, wt);
  assert.equal(fromWorktree.status, 0, fromWorktree.stderr);
  assert.match(fromWorktree.stdout, /Codex 2% \(1 runs\)\n$/);
  assert.match(cli(sessions, args, root).stdout, /Codex 2% \(1 runs\)\n$/);
  // Outside any repository (and with no ledger there) it says so instead of failing.
  assert.match(cli(sessions, args, sessions).stdout, /Codex no ledger\n$/);
});

test('--line prints exactly the summary line, one line, with the not-run count only when there are not-run rows', () => {
  const root = fixture();
  const base = ['--session', 'sess1', '--projects-dir', path.join(root, 'projects'), '--ledger', path.join(root, 'ledger.jsonl')];
  const r = cli(root, [...base, '--line']);
  assert.equal(r.status, 0, r.stderr);
  const total = PRICE.opus[1] + PRICE.sonnet[1];
  assert.equal(r.stdout, `Cost $${total.toFixed(2)} · Claude ${Math.round((total / DOLLARS_PER_PERCENT) * 10) / 10}% · Codex 2% (1 runs)\n`);
  fs.appendFileSync(path.join(root, 'ledger.jsonl'), `${JSON.stringify(run({ cwd: root, outcome: 'reserved' }))}\n`);
  assert.match(cli(root, [...base, '--line']).stdout, /Codex 2% \(1 runs, 1 not run\)\n$/);
  assert.equal(cli(root, [...base, '--line', '--json']).status, 2);
});

test('--session takes a comma-separated list: every session counts, in whichever project dir it lives', () => {
  const root = fixture();
  const other = path.join(root, 'projects', '-p-other');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'sess2.jsonl'), `${turn({ id: 'z', usage: { output_tokens: M } })}\n`);
  const base = ['--projects-dir', path.join(root, 'projects'), '--json'];
  const one = JSON.parse(cli(root, ['--session', 'sess1', ...base]).stdout);
  const both = JSON.parse(cli(root, ['--session', 'sess1,sess2', ...base]).stdout);
  assert.equal(both.claude.turns, one.claude.turns + 1);
  near(both.claude.total, one.claude.total + PRICE.opus[1]);
  // The same id twice, or a session listed again, does not double a turn.
  assert.equal(JSON.parse(cli(root, ['--session', 'sess1,sess2,sess1', ...base]).stdout).claude.turns, both.claude.turns);
  const missing = cli(root, ['--session', 'sess1,nope', ...base]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /session nope not found/);
});

// ---- times, compactions, the cache and steps (--times, --by-step)

const MIN = 60_000;
const T0 = Date.parse('2026-10-24T01:00:00Z');
const atMin = (min) => new Date(T0 + min * MIN).toISOString();
const jline = (o) => JSON.stringify(o);
const asst = (min, content = [], extra = {}) => jline({ type: 'assistant', timestamp: atMin(min), message: { content }, ...extra });
const userLine = (min, content, extra = {}) => jline({ type: 'user', timestamp: atMin(min), message: { content }, ...extra });
const compactLine = (min, trigger, preTokens, durationMs) =>
  jline({ type: 'system', subtype: 'compact_boundary', timestamp: atMin(min), compactMetadata: { trigger, preTokens, durationMs } });
/** A priced row `min` minutes after T0 costing `usd` in Opus output, labelled by `ctx`. */
const pricedRow = (min, usd, ctx = {}) =>
  parseTranscript(
    turn({ id: `m${min}-${ctx.agentId ?? 'main'}`, req: `r${min}-${ctx.agentId ?? 'main'}`, at: atMin(min), usage: { output_tokens: (usd * M) / PRICE.opus[1] } }),
    ctx,
  )[0];
const marker = (step, event, min, round = 1) => ({ t: atMin(min), ts: T0 + min * MIN, unit: 'U-1', step, event, round });

test('parseTranscript carries the cache split, the write dollars, the session and the dispatch description', () => {
  const [r] = parseTranscript(
    turn({ usage: { input_tokens: 10, cache_read_input_tokens: 70, cache_creation: { ephemeral_1h_input_tokens: 20 } } }),
    { kind: 'sub', session: 's9', description: '[U-1 s8c r2] review' },
  );
  assert.equal(r.input, 10);
  assert.equal(r.cacheRead, 70);
  assert.equal(r.cacheWrite, 20);
  near(r.writeCost, (20 * PRICE.opus[0] * CACHE_WRITE_1H) / M);
  assert.equal(r.session, 's9');
  assert.equal(r.agentDescription, '[U-1 s8c r2] review');
  const [flat] = parseTranscript(turn({ usage: { cache_creation_input_tokens: 5 } }));
  assert.equal(flat.cacheWrite, 5);
  near(flat.writeCost, (5 * PRICE.opus[0] * CACHE_WRITE_5M) / M);
  assert.equal(flat.session, null);
  assert.equal(flat.agentDescription, null);
});

test('isOwnerPrompt takes what the owner typed and nothing Claude Code wrote itself', () => {
  const u = (content, extra = {}) => ({ type: 'user', message: { content }, ...extra });
  assert.equal(isOwnerPrompt(u('fix the test')), true);
  assert.equal(isOwnerPrompt(u('<command-name>/compact</command-name>')), true);
  assert.equal(isOwnerPrompt(u('<bash-input>ls</bash-input>')), true);
  assert.equal(isOwnerPrompt(u([{ type: 'text', text: 'see the screenshot' }])), true);
  assert.equal(isOwnerPrompt(u('<task-notification>x</task-notification>', { origin: { kind: 'human' } })), true);
  assert.equal(isOwnerPrompt(u('hello from a peer', { origin: { kind: 'peer' } })), false);
  assert.equal(isOwnerPrompt(u('<task-notification>done</task-notification>')), false);
  assert.equal(isOwnerPrompt(u('<local-command-stdout>ok</local-command-stdout>')), false);
  assert.equal(isOwnerPrompt(u('<bash-stdout>x</bash-stdout>')), false);
  assert.equal(isOwnerPrompt(u([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }])), false);
  assert.equal(isOwnerPrompt(u('injected', { isMeta: true })), false);
  assert.equal(isOwnerPrompt(u('summary', { isCompactSummary: true })), false);
  assert.equal(isOwnerPrompt(u('side', { isSidechain: true })), false);
  assert.equal(isOwnerPrompt(u('   ')), false);
  assert.equal(isOwnerPrompt({ type: 'assistant', message: { content: 'x' } }), false);
});

test('parseEvents reads turns, questions, results, prompts, notes and compactions in time order, sidechains skipped', () => {
  const text = [
    userLine(5, 'start the unit'),
    asst(0, [{ type: 'text', text: 'hi' }]),
    asst(6, [
      { type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: {} },
      { type: 'tool_use', id: 'b1', name: 'Bash', input: {} },
    ]),
    userLine(9, [{ type: 'tool_result', tool_use_id: 'q1', content: 'a' }]),
    userLine(10, '<task-notification>bg done</task-notification>'),
    compactLine(11, 'auto', 250_000, 60_000),
    jline({ type: 'system', subtype: 'turn_duration', timestamp: atMin(12) }),
    asst(13, [], { isSidechain: true }),
    jline({ type: 'file-history-snapshot', snapshot: {} }),
    '{"type":"assistant","timestamp":"2026-10-24T01:1',
  ].join('\n');
  const ev = parseEvents(text);
  assert.deepEqual(
    ev.map((e) => [e.type, (e.ts - T0) / MIN]),
    [
      ['turn', 0],
      ['prompt', 5],
      ['turn', 6],
      ['ask', 6],
      ['result', 9],
      ['note', 10],
      ['compact', 11],
      ['note', 12],
    ],
  );
  assert.equal(ev.find((e) => e.type === 'ask').id, 'q1');
  assert.deepEqual(ev.find((e) => e.type === 'compact'), { ts: T0 + 11 * MIN, type: 'compact', trigger: 'auto', preTokens: 250_000, durationMs: 60_000 });
});

test('unionMs counts an overlap once and skips empty or backward spans', () => {
  assert.equal(
    unionMs([
      [0, 10],
      [5, 15],
      [20, 30],
      [30, 30],
      [40, 35],
    ]),
    25,
  );
  assert.equal(unionMs([]), 0);
});

test('summarizeTimes: a question waits from its call to its answer, a typed prompt back to the last turn or result', () => {
  const ev = parseEvents(
    [
      asst(0),
      asst(10, [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion' }]),
      userLine(40, [{ type: 'tool_result', tool_use_id: 'q1' }]),
      asst(50),
      jline({ type: 'system', subtype: 'turn_duration', timestamp: atMin(51) }),
      userLine(80, 'next'),
      asst(90),
    ].join('\n'),
  );
  const t = summarizeTimes(ev);
  assert.equal(t.wallMs, 90 * MIN);
  assert.equal(t.questionMs, 30 * MIN);
  assert.equal(t.promptMs, 30 * MIN);
  assert.equal(t.waitMs, 60 * MIN);
  assert.equal(t.workMs, 30 * MIN);
  assert.deepEqual([t.questions, t.prompts, t.unanswered], [1, 1, 0]);
});

test('summarizeTimes: a background notice starts no wait, a slash command does not split one, and the window clips', () => {
  const ev = parseEvents(
    [
      asst(0),
      userLine(20, '<task-notification>agent done</task-notification>'),
      asst(21),
      asst(30),
      userLine(40, '<command-name>/compact</command-name>'),
      userLine(41, '<local-command-stdout>ok</local-command-stdout>'),
      userLine(70, 'go on'),
      asst(75),
      asst(200, [{ type: 'tool_use', id: 'q9', name: 'ExitPlanMode' }]),
    ].join('\n'),
  );
  const t = summarizeTimes(ev, { until: atMin(100) });
  assert.equal(t.wallMs, 75 * MIN);
  assert.equal(t.waitMs, 40 * MIN); // 30 -> 70, the command typed inside it
  assert.equal(t.workMs, 35 * MIN);
  assert.equal(t.prompts, 2);
  assert.equal(t.questions, 0);
  assert.equal(summarizeTimes(ev).unanswered, 1);
  assert.deepEqual(summarizeTimes([], {}), { wallMs: 0, waitMs: 0, workMs: 0, questions: 0, unanswered: 0, prompts: 0, questionMs: 0, promptMs: 0 });
});

test('summarizeTimes: a wait that crosses a window edge is clipped to the wall, not counted as work', () => {
  // A question asked at 50 and answered at 90, measured from 60: the wall starts at the note (70).
  const ev = parseEvents(
    [
      asst(40),
      asst(50, [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion' }]),
      jline({ type: 'system', subtype: 'turn_duration', timestamp: atMin(70) }),
      userLine(90, [{ type: 'tool_result', tool_use_id: 'q1' }]),
      asst(100),
    ].join('\n'),
  );
  const q = summarizeTimes(ev, { since: atMin(60) });
  assert.deepEqual([q.wallMs, q.questionMs, q.waitMs, q.workMs], [30 * MIN, 20 * MIN, 20 * MIN, 10 * MIN]);
  assert.deepEqual([q.questions, q.unanswered], [0, 0]); // the ask itself is outside the window
  // A prompt typed at 65 whose last turn was at 40, before the window.
  const p = summarizeTimes(
    parseEvents([asst(40), jline({ type: 'system', subtype: 'turn_duration', timestamp: atMin(62) }), userLine(65, 'go'), asst(70)].join('\n')),
    { since: atMin(60) },
  );
  assert.deepEqual([p.wallMs, p.promptMs, p.waitMs, p.workMs, p.prompts], [8 * MIN, 3 * MIN, 3 * MIN, 5 * MIN, 1]);
  // Unanswered is the window's own: an ask from before it, never answered, is not counted; one inside it is.
  const note = (min) => jline({ type: 'system', subtype: 'turn_duration', timestamp: atMin(min) });
  const old = [asst(50, [{ type: 'tool_use', id: 'q3', name: 'AskUserQuestion' }]), note(65), asst(70)];
  assert.equal(summarizeTimes(parseEvents(old.join('\n')), { since: atMin(60) }).unanswered, 0);
  const fresh = [...old, asst(75, [{ type: 'tool_use', id: 'q4', name: 'AskUserQuestion' }])];
  assert.equal(summarizeTimes(parseEvents(fresh.join('\n')), { since: atMin(60) }).unanswered, 1);
  // The other edge: asked at 50, answered at 90, window ends at 70; the question is the window's, and answered.
  const u = summarizeTimes(
    parseEvents(
      [asst(50, [{ type: 'tool_use', id: 'q2', name: 'AskUserQuestion' }]), jline({ type: 'system', subtype: 'turn_duration', timestamp: atMin(55) }), userLine(90, [{ type: 'tool_result', tool_use_id: 'q2' }])].join('\n'),
    ),
    { until: atMin(70) },
  );
  assert.deepEqual([u.wallMs, u.questionMs, u.waitMs, u.questions, u.unanswered], [5 * MIN, 5 * MIN, 5 * MIN, 1, 0]);
});

test('summarizeTimes over two sessions: the gap before the next session\'s first prompt is owner wait', () => {
  const first = parseEvents([asst(0), asst(10)].join('\n'));
  const second = parseEvents([userLine(60, 'resume U-1'), asst(65)].join('\n'));
  const t = summarizeTimes([...second, ...first]);
  assert.deepEqual([t.wallMs, t.waitMs, t.workMs], [65 * MIN, 50 * MIN, 15 * MIN]);
});

test('summarizeCompactions counts by trigger, takes the median tokens before and sums the time, inside the window', () => {
  const ev = parseEvents(
    [compactLine(0, 'auto', 300_000, 60_000), compactLine(10, 'manual', 200_000, 30_000), compactLine(20, 'manual', 260_000, 30_000), compactLine(90, 'auto', 900_000, 1)].join('\n'),
  );
  assert.deepEqual(summarizeCompactions(ev, { until: atMin(60) }), { count: 3, byTrigger: { auto: 1, manual: 2 }, medianPreTokens: 260_000, durationMs: 120_000 });
  assert.equal(summarizeCompactions(ev.slice(0, 2)).medianPreTokens, 250_000);
  assert.deepEqual(summarizeCompactions([]), { count: 0, byTrigger: {}, medianPreTokens: 0, durationMs: 0 });
});

test('summarizeCache: the hit share of the main thread, and a rewrite only after the TTL, mostly written, in the same session', () => {
  const row = (min, session, read, write, kind = 'main') =>
    parseTranscript(
      turn({ id: `c${min}${session}`, req: `q${min}${session}`, at: atMin(min), usage: { cache_read_input_tokens: read, cache_creation: { ephemeral_1h_input_tokens: write } } }),
      { kind, session },
    )[0];
  const gap = CACHE_TTL_MIN + 1;
  const rows = [
    row(0, 'a', 0, 100_000),
    row(5, 'a', 100_000, 1_000),
    row(5 + gap, 'a', 1_000, 120_000),
    row(10 + 2 * gap, 'a', 120_000, 500),
    row(400, 'b', 0, 90_000),
    row(400, 'c', 0, 999_999, 'sub'),
  ];
  const s = summarizeCache(rows);
  assert.equal(s.rewrites, 1);
  assert.equal(s.rewriteTokens, 120_000);
  near(s.rewriteDollars, (120_000 * PRICE.opus[0] * CACHE_WRITE_1H) / M);
  const read = 100_000 + 1_000 + 120_000;
  const context = read + 100_000 + 1_000 + 120_000 + 500 + 90_000;
  assert.equal(s.hitPercent, Math.round((read / context) * 1000) / 10);
  assert.equal(summarizeCache(rows, { until: atMin(30) }).rewrites, 0);
});

test('parseTag reads [<unit> s<step> r<n>] anywhere in a description, the round defaulting to 1', () => {
  assert.deepEqual(parseTag('[EP-27.03 s8c r2] codex review'), { unit: 'EP-27.03', step: '8c', round: 2 });
  assert.deepEqual(parseTag('implement slice 2 [CR-9 s5]'), { unit: 'CR-9', step: '5', round: 1 });
  assert.deepEqual(parseTag('[U s8b-fix r3]'), { unit: 'U', step: '8b-fix', round: 3 });
  assert.equal(parseTag('review the diff'), null);
  assert.equal(parseTag(null), null);
  assert.equal(parseTag('[EP-27.03 8c]'), null);
});

test('summarizeSteps: main turns by interval, subagents by their tag or else their first turn, the rest unmarked', () => {
  const markers = [marker('4', 'start', 0), marker('4', 'done', 30), marker('8c', 'start', 30), marker('8c', 'done', 50)];
  const rows = [
    pricedRow(5, 1),
    pricedRow(35, 2),
    pricedRow(70, 4),
    pricedRow(40, 8, { kind: 'sub', agentId: 'a1', description: '[U-1 s4 r1] late review' }),
    pricedRow(10, 16, { kind: 'sub', agentId: 'a2', description: 'untagged builder' }),
    pricedRow(45, 32, { kind: 'sub', agentId: 'a2', description: 'untagged builder' }),
    pricedRow(36, 64, { kind: 'sub', agentId: 'a3', description: '[OTHER s4] not this unit' }),
  ];
  const s = summarizeSteps(rows, markers, { unit: 'U-1' });
  const by = Object.fromEntries(s.steps.map((x) => [x.label, x]));
  assert.deepEqual(
    s.steps.map((x) => x.label),
    ['4 r1', '8c r1', 'unmarked'],
  );
  near(by['4 r1'].usd, 1 + 8 + 16 + 32);
  near(by['4 r1'].subUsd, 8 + 16 + 32);
  near(by['4 r1'].mainUsd, 1);
  assert.equal(by['4 r1'].agents, 2);
  near(by['8c r1'].usd, 2 + 64);
  near(by.unmarked.usd, 4);
  assert.equal(by['4 r1'].wallMs, 30 * MIN);
  assert.equal(by['8c r1'].wallMs, 20 * MIN);
  near(s.total, 127);
  assert.equal(by['4 r1'].share, Math.round((57 / 127) * 1000) / 10);
  assert.deepEqual(s.problems, []);
});

test('summarizeSteps: the open last step runs to the last turn, a tag names its round, and marker problems pass through', () => {
  const markers = [marker('8c', 'start', 0, 1), marker('8c', 'done', 10, 1), marker('8c', 'start', 10, 2), marker('9', 'done', 15)];
  const rows = [pricedRow(12, 1), pricedRow(25, 2), pricedRow(1, 4, { kind: 'sub', agentId: 'a1', description: '[U-1 s8c r2] codex review' })];
  const s = summarizeSteps(rows, markers, { unit: 'U-1' });
  const by = Object.fromEntries(s.steps.map((x) => [x.label, x]));
  assert.deepEqual(
    s.steps.map((x) => x.label),
    ['8c r1', '8c r2'],
  );
  near(by['8c r1'].usd, 0);
  near(by['8c r2'].usd, 7);
  assert.equal(by['8c r2'].wallMs, 15 * MIN);
  assert.equal(s.problems.length, 1);
  assert.match(s.problems[0], /done of 9 r1 .* matches no open step/);
});

test('summarizeSteps: a step interval adds only its part inside the window to the wall time', () => {
  const markers = [marker('4', 'start', 0), marker('4', 'done', 120)];
  const rows = [pricedRow(100, 1)];
  const wall = (window) => summarizeSteps(rows, markers, { unit: 'U-1', ...window }).steps.find((x) => x.label === '4 r1').wallMs;
  assert.equal(wall({}), 120 * MIN);
  assert.equal(wall({ since: atMin(60) }), 60 * MIN);
  assert.equal(wall({ since: atMin(60), until: atMin(90) }), 30 * MIN);
  assert.equal(wall({ until: atMin(30) }), 30 * MIN);
});

test('summarizeSteps: a subagent dispatched before the window is placed by its first turn, not its first one in the window', () => {
  const markers = [marker('2', 'start', 0), marker('2', 'done', 58), marker('3', 'start', 58), marker('3', 'done', 120)];
  const agent = { kind: 'sub', agentId: 'a1', description: 'untagged builder' };
  const rows = [pricedRow(55, 1, agent), pricedRow(70, 2, agent), pricedRow(80, 4, agent)];
  const s = summarizeSteps(rows, markers, { unit: 'U-1', since: atMin(60) });
  const by = Object.fromEntries(s.steps.map((x) => [x.label, x]));
  near(by['2 r1'].usd, 6); // its cost and turns stay the window's, its step is the first turn's
  assert.equal(by['2 r1'].turns, 2);
  near(by['3 r1'].usd, 0);
  near(s.total, 6);
});

test('summarizeSteps: an open step runs to the last turn anywhere, so a window that ends inside it still gets its time', () => {
  const markers = [marker('4', 'start', 0)];
  const wall = (rows, window) => summarizeSteps(rows, markers, { unit: 'U-1', ...window }).steps.find((x) => x.label === '4 r1').wallMs;
  assert.equal(wall([pricedRow(30, 1), pricedRow(120, 2)], { until: atMin(60) }), 60 * MIN);
  assert.equal(wall([pricedRow(120, 2)], { until: atMin(60) }), 60 * MIN); // no turn inside the window at all
  assert.equal(wall([pricedRow(30, 1), pricedRow(120, 2)], {}), 120 * MIN);
});

test('summarizeSteps: a row without a readable time never sets a subagent\'s first turn', () => {
  const markers = [marker('2', 'start', 0), marker('2', 'done', 58), marker('3', 'start', 58), marker('3', 'done', 120)];
  const agent = { kind: 'sub', agentId: 'a1', description: 'untagged builder' };
  const rows = [{ ...pricedRow(90, 8, agent), ts: NaN }, pricedRow(55, 1, agent), pricedRow(70, 2, agent)];
  const s = summarizeSteps(rows, markers, { unit: 'U-1', since: atMin(60) });
  const by = Object.fromEntries(s.steps.map((x) => [x.label, x]));
  near(by['2 r1'].usd, 2);
  assert.equal(by.unmarked, undefined);
});

test('parseArgs reads --times, --by-step and --unit, and refuses --line with them and --unit alone', () => {
  const a = parseArgs(['--session', 's1', '--times', '--by-step', 'docs/plans/U-1.steps.jsonl', '--unit', 'U-1']);
  assert.equal(a.times, true);
  assert.equal(a.byStep, 'docs/plans/U-1.steps.jsonl');
  assert.equal(a.unit, 'U-1');
  assert.throws(() => parseArgs(['--session', 's1', '--line', '--times']), /--line prints the cost cell only/);
  assert.throws(() => parseArgs(['--session', 's1', '--line', '--by-step', 'f']), /--line prints the cost cell only/);
  assert.throws(() => parseArgs(['--session', 's1', '--unit', 'U-1']), /--unit names the unit of a --by-step/);
  assert.throws(() => parseArgs(['--session', 's1', '--by-step']), /needs a value/);
});

test('formatReport adds the times, compaction, cache and step sections only when asked', () => {
  const claude = summarizeClaude([]);
  assert.doesNotMatch(formatReport(claude, null), /Times|By step/);
  const text = formatReport(claude, null, {
    times: { wallMs: 90 * MIN, waitMs: 60 * MIN, workMs: 30 * MIN, questions: 2, unanswered: 1, prompts: 3, questionMs: 0, promptMs: 0 },
    compactions: { count: 2, byTrigger: { auto: 1, manual: 1 }, medianPreTokens: 250_000, durationMs: 2 * MIN },
    cache: { hitPercent: 97.5, rewrites: 1, rewriteDollars: 1.5, rewriteTokens: 150_000 },
    steps: {
      unit: 'U-1',
      steps: [
        { label: '8b r1', usd: 14.65, mainUsd: 14, subUsd: 0.65, turns: 9, agents: 1, wallMs: 25 * MIN, share: 19 },
        { label: 'unmarked', usd: 1, mainUsd: 1, subUsd: 0, turns: 1, agents: 0, wallMs: 0, share: 1.3 },
      ],
      problems: ['done of 9 r1 at x matches no open step'],
    },
  });
  assert.match(text, /^Times \(main thread\): wall 1h30m · owner wait 1h00m \(2 questions, 1 unanswered · 3 prompts\) · work 30m$/m);
  assert.match(text, /^ {2}compactions 2 \(auto 1 · manual 1\) · median 250K before · 2m spent$/m);
  assert.match(text, /^ {2}cache hit 97\.5% · expiry rewrites 1 \(\$1\.50, 150K written\)$/m);
  assert.match(text, /^By step \(U-1\):$/m);
  assert.match(text, /^ {2}8b r1 +\$14\.65 +19% · main \$14\.00 · subagents \$0\.65 \(1\) · 25m$/m);
  assert.match(text, /^ {2}unmarked +\$1\.00 +1\.3% · .* · no marker$/m);
  assert.match(text, /^ {2}! done of 9 r1/m);
  assert.ok(text.trimEnd().endsWith('Dollar figures are API-equivalent and relative, not a bill.'));
});

test('without --projects-dir the wrapper reads $CLAUDE_CONFIG_DIR/projects when it is set, else ~/.claude/projects', () => {
  const sessions = fixture();
  const withProjects = (base) => {
    fs.cpSync(path.join(sessions, 'projects'), path.join(base, 'projects'), { recursive: true });
    return base;
  };
  const bare = tmpDir('unit-cost-bare-');
  const config = withProjects(tmpDir('unit-cost-config-'));
  const home = tmpDir('unit-cost-home-');
  const homed = tmpDir('unit-cost-homed-');
  withProjects(path.join(homed, '.claude'));
  const exec = (env) => {
    const e = { ...process.env, ...env };
    for (const k of Object.keys(e)) if (k.startsWith('GIT_') || k === 'CODEX_HOME') delete e[k];
    return spawnSync(process.execPath, [RUNNER, '--session', 'sess1', '--line'], { cwd: bare, env: e, encoding: 'utf8' });
  };
  const viaConfig = exec({ HOME: home, CLAUDE_CONFIG_DIR: config });
  assert.equal(viaConfig.status, 0, viaConfig.stderr);
  assert.match(viaConfig.stdout, /^Cost \$/);
  // The variable wins over a HOME that also has the session; set but empty falls back to HOME.
  assert.equal(exec({ HOME: homed, CLAUDE_CONFIG_DIR: bare }).status, 2);
  assert.equal(exec({ HOME: homed, CLAUDE_CONFIG_DIR: '' }).status, 0);
});

test('the wrapper adds --times and --by-step from the session, its subagents\' tags and the steps file', () => {
  const root = tmpDir('unit-cost-steps-');
  const proj = path.join(root, 'projects', '-p-app');
  fs.mkdirSync(path.join(proj, 's7', 'subagents'), { recursive: true });
  const usage = { output_tokens: M / PRICE.opus[1] };
  fs.writeFileSync(
    path.join(proj, 's7.jsonl'),
    [
      userLine(0, 'run U-7'),
      jline({ type: 'assistant', timestamp: atMin(1), requestId: 'r1', message: { id: 'm1', model: 'claude-opus-5-5', usage, content: [] } }),
      jline({ type: 'assistant', timestamp: atMin(10), requestId: 'r2', message: { id: 'm2', model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: {} }] } }),
      userLine(40, [{ type: 'tool_result', tool_use_id: 'q1', content: 'ok' }]),
      jline({ type: 'assistant', timestamp: atMin(45), requestId: 'r3', message: { id: 'm3', model: 'claude-opus-5-5', usage, content: [] } }),
    ].join('\n'),
  );
  fs.writeFileSync(path.join(proj, 's7', 'subagents', 'agent-1.jsonl'), `${turn({ id: 's1', req: 'sr1', at: atMin(2), usage })}\n`);
  fs.writeFileSync(path.join(proj, 's7', 'subagents', 'agent-1.meta.json'), JSON.stringify({ agentType: 'implementer', description: '[U-7 s8c] review' }));
  const steps = path.join(root, 'U-7.steps.jsonl');
  fs.writeFileSync(steps, [marker('4', 'start', 0), marker('4', 'done', 30), marker('8c', 'start', 30)].map((m) => jline({ ...m, ts: undefined, unit: 'U-7' })).join('\n'));
  const args = ['--session', 's7', '--projects-dir', path.join(root, 'projects'), '--times', '--by-step', steps];
  const j = JSON.parse(cli(root, [...args, '--json']).stdout);
  assert.equal(j.times.waitMs, 30 * MIN);
  assert.equal(j.times.workMs, 15 * MIN);
  assert.equal(j.steps.unit, 'U-7');
  const by = Object.fromEntries(j.steps.steps.map((x) => [x.label, x]));
  near(by['4 r1'].usd, 2);
  near(by['8c r1'].usd, 2);
  assert.equal(by['8c r1'].agents, 1);
  const text = cli(root, args);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^Times \(main thread\): wall 45m · owner wait 30m \(1 questions · 1 prompts\) · work 15m$/m);
  assert.match(text.stdout, /^By step \(U-7\):$/m);
  assert.equal(cli(root, [...args, '--line']).status, 2);
});

// ---- a Codex host (its rollouts under $CODEX_HOME/sessions) and the claude-run ledger

const cx = (min, type, payload) => jline({ timestamp: atMin(min), type, payload });
const cxMeta = (min, over = {}) =>
  cx(min, 'session_meta', { id: 'th-1', session_id: 'th-1', cwd: '/r/app', originator: 'Codex Desktop', source: 'vscode', thread_source: 'user', ...over });
const cxEvent = (min, type, extra = {}) => cx(min, 'event_msg', { type, ...extra });
/** A token_count: the thread's running totals and the account's weekly quota reading. */
const cxTokens = (min, total, used, { cached = 0, output = 0, resets = 1_800_000_000 } = {}) =>
  cxEvent(min, 'token_count', {
    info: { total_token_usage: { input_tokens: total - output, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 0, total_tokens: total } },
    rate_limits: { primary: { used_percent: used, window_minutes: 10080, resets_at: resets } },
  });
const cxUser = (min, text) => cx(min, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const cxCall = (min, name, callId) => cx(min, 'response_item', { type: 'function_call', name, call_id: callId, arguments: '{}' });
const cxOutput = (min, callId) => cx(min, 'response_item', { type: 'function_call_output', call_id: callId, output: 'ok' });
const cxReply = (min, callId) =>
  cxUser(min, `<send_user_message_question_reply> ${JSON.stringify([{ questionItemId: JSON.stringify(['request_user_input_async', callId, 0]), answer: 'yes' }])}`);

/** A Codex main thread: three turns, a question that stops it and one that does not, a compaction. */
function hostMain() {
  return [
    cxMeta(0),
    cx(0, 'turn_context', { model: 'gpt-6.1-sol', effort: 'high' }),
    cxEvent(0, 'task_started'),
    cxUser(1, '<environment_context>\n  <cwd>/r/app</cwd>\n</environment_context>'),
    cxUser(1, 'build the thing'),
    cxTokens(2, 1000, 10, { cached: 600, output: 100 }),
    cxCall(3, 'request_user_input', 'c1'),
    cxOutput(13, 'c1'),
    cxTokens(14, 3000, 12, { cached: 2000, output: 300 }),
    cxEvent(15, 'task_complete'),
    cxEvent(45, 'task_started'),
    cxUser(45, 'next'),
    cxTokens(46, 5000, 20, { cached: 3500, output: 500 }),
    cxCall(47, 'request_user_input_async', 'c2'),
    cxTokens(48, 6000, 21, { cached: 4200, output: 600 }),
    cxEvent(50, 'task_complete'),
    cxEvent(60, 'task_started'),
    cxReply(60, 'c2'),
    cx(61, 'compacted', { message: '', latest_token_usage_record: { usage: { input_tokens: 80_000 } } }),
    cxTokens(62, 9000, 25, { cached: 6000, output: 900 }),
    cxTokens(62, 9000, 25, { cached: 6000, output: 900 }),
    cxTokens(64, 10_000, 27, { cached: 6800, output: 1000 }),
    cxEvent(65, 'task_complete'),
  ];
}

/** A subagent of th-1: its own meta, then the parent's and its history (forked), then its own turn. */
function hostSub() {
  return [
    cxMeta(45, { id: 'th-2', session_id: 'th-1', parent_thread_id: 'th-1', source: { subagent: { thread_spawn: { parent_thread_id: 'th-1' } } }, thread_source: 'subagent' }),
    cxMeta(45),
    cxUser(45, 'build the thing'),
    cxCall(45, 'request_user_input', 'c0'),
    cxEvent(46, 'task_started'),
    cxTokens(47, 2000, 20, { cached: 1000, output: 200 }),
    cxTokens(49, 4000, 22, { cached: 3000, output: 400 }),
    cxEvent(49, 'task_complete'),
  ];
}

const hostRun = (before, after) => run({ limitsBefore: { usedPercent: before, resetsAt: 1_800_000_000 }, limitsAfter: { usedPercent: after, resetsAt: 1_800_000_000 } });

test('parseCodexSession reads a rollout: its own meta, turns, readings, questions, typed prompts and compactions', () => {
  const s = parseCodexSession(hostMain());
  assert.deepEqual([s.id, s.session, s.parent, s.kind, s.cwd, s.host], ['th-1', 'th-1', null, 'main', '/r/app', true]);
  assert.deepEqual(s.models, ['gpt-6.1-sol']);
  assert.equal(s.starts.length, 3);
  assert.equal(s.readings.length, 7);
  assert.equal(s.events.filter((e) => e.type === 'prompt').length, 3);
  assert.deepEqual(s.events.filter((e) => e.type === 'ask').map((e) => [e.id, e.async === true]), [['c1', false], ['c2', true]]);
  assert.deepEqual(s.events.filter((e) => e.type === 'result').map((e) => e.id), ['c1']);
  assert.deepEqual(s.events.filter((e) => e.type === 'compact').map((e) => e.preTokens), [80_000]);
  const sub = parseCodexSession(hostSub());
  assert.deepEqual([sub.id, sub.session, sub.parent, sub.kind, sub.host], ['th-2', 'th-1', 'th-1', 'sub', true]);
  // An exec run is no host session; torn and foreign lines are skipped.
  const exec = parseCodexSession([cxMeta(0, { id: 'ex-1', session_id: 'ex-1', originator: 'codex_exec', source: 'exec' }), '{"torn', 'not json', '']);
  assert.deepEqual([exec.id, exec.host, exec.readings.length], ['ex-1', false, 0]);
});

test('summarizeCodexHost: tokens are the growth of the running totals inside the window; turns, questions and compactions are the main thread\'s', () => {
  const sessions = [parseCodexSession(hostMain()), parseCodexSession(hostSub())];
  const all = summarizeCodexHost(sessions);
  assert.deepEqual([all.sessions, all.subagents, all.turns, all.questions, all.compactions, all.compactPreTokens], [1, 1, 3, 2, 1, 80_000]);
  assert.deepEqual([all.tokens, all.inputTokens, all.cachedTokens, all.outputTokens], [14_000, 9000 + 3600, 6800 + 3000, 1400]);
  assert.equal(all.cacheHit, Math.round(((6800 + 3000) / (9000 + 3600)) * 1000) / 10);
  assert.deepEqual(all.models, ['gpt-6.1-sol']);
  // From minute 40 the main thread adds what it read since its last reading before (3000 at minute 14).
  const late = summarizeCodexHost(sessions, { since: atMin(40) });
  assert.deepEqual([late.tokens, late.turns, late.questions], [10_000 - 3000 + 4000, 2, 1]);
  const after = summarizeCodexHost(sessions, { since: atMin(70) });
  assert.deepEqual([after.sessions, after.subagents, after.tokens, after.percent], [0, 0, 0, 0]);
});

test('summarizeCodexHost: the quota is each turn\'s first reading to its last, one union per quota window, never the gap between turns', () => {
  const main = parseCodexSession(hostMain());
  // 10->12, 20->21 and 25->27; the 12->20 between turns is other work on the account.
  assert.equal(summarizeCodexHost([main]).percent, 5);
  // The subagent's 20->22 overlaps the main thread's 20->21: counted once.
  assert.equal(summarizeCodexHost([main, parseCodexSession(hostSub())]).percent, 6);
  // A turn that crosses a weekly reset is two intervals, one per window.
  const reset = parseCodexSession([
    cxMeta(0),
    cxEvent(0, 'task_started'),
    cxTokens(1, 100, 98, { resets: 1000 }),
    cxTokens(2, 200, 99, { resets: 1030 }),
    cxTokens(3, 300, 0, { resets: 605_800 }),
    cxTokens(4, 400, 2, { resets: 605_800 }),
    cxEvent(5, 'task_complete'),
  ]);
  assert.equal(summarizeCodexHost([reset]).percent, 3);
});

test('codexPercent counts the ledger\'s runs and the host\'s turns as one union per quota window', () => {
  const sessions = [parseCodexSession(hostMain())];
  assert.equal(codexPercent([hostRun(11, 13)], sessions), 6);
  assert.equal(codexPercent([hostRun(30, 32)], sessions), 7);
  assert.equal(codexPercent([hostRun(30, 32), run({ outcome: 'reserved', ...hostRun(40, 50) })], sessions), 7);
  assert.equal(codexPercent([], sessions), 5);
  assert.equal(codexPercent([hostRun(30, 32)], []), 2);
  assert.equal(codexPercent([hostRun(30, 32)], [], { cwdMatch: 'elsewhere' }), 0);
});

test('summarizeTimes over a Codex main thread: a stopping question waits to its answer, a prompt or an async reply back to the last turn', () => {
  const ev = parseCodexSession(hostMain()).events;
  const t = summarizeTimes(ev);
  assert.equal(t.wallMs, 65 * MIN);
  assert.equal(t.questionMs, 10 * MIN);
  assert.equal(t.promptMs, 40 * MIN);
  assert.equal(t.waitMs, 50 * MIN);
  assert.equal(t.workMs, 15 * MIN);
  assert.deepEqual([t.questions, t.prompts, t.unanswered], [2, 3, 0]);
  assert.equal(summarizeCompactions(ev).count, 1);
});

test('summarizeClaudeRuns adds the runs\' dollars, counts them by kind, and keeps not-run and unpriced rows apart', () => {
  const cr = (over = {}) => ({ at: '2026-10-24T01:00:00Z', kind: 'review', cwd: '/r/app', outcome: 'ok', costUsd: 0.5, turns: 4, ms: 1000, ...over });
  const s = summarizeClaudeRuns([
    cr(),
    cr({ kind: 'adversarial', costUsd: 1.25 }),
    cr({ outcome: 'failed', costUsd: 0.25 }),
    cr({ outcome: 'timeout', costUsd: null }),
    cr({ outcome: 'reserved', costUsd: undefined, ms: undefined }),
    cr({ outcome: 'unavailable', costUsd: undefined, ms: undefined }),
  ]);
  assert.deepEqual([s.runs, s.notRun, s.unpriced, s.ms], [4, 2, 1, 4000]);
  assert.deepEqual(s.byKind, { review: 3, adversarial: 1 });
  near(s.usd, 2);
  assert.equal(summarizeClaudeRuns([cr()], { since: '2026-10-25T00:00:00Z' }).runs, 0);
  assert.equal(summarizeClaudeRuns([cr()], { cwdMatch: 'elsewhere' }).runs, 0);
});

test('summarizeClaudeRuns counts a run the API stopped after it spent: unavailable with a cost', () => {
  const s = summarizeClaudeRuns([
    { at: '2026-10-24T01:00:00Z', kind: 'review', cwd: '/r/app', outcome: 'unavailable', claudeExit: 1, costUsd: 2.4, turns: 20, ms: 60_000, reason: 'error_during_execution: overloaded' },
    { at: '2026-10-24T01:05:00Z', kind: 'review', cwd: '/r/app', outcome: 'unavailable', reason: 'claude is not on PATH' },
  ]);
  assert.deepEqual([s.runs, s.notRun, s.unpriced], [1, 1, 0]);
  near(s.usd, 2.4);
});

test('summaryLine adds claude-run dollars to the cost and its Claude %, and names a Codex host beside the ledger\'s runs', () => {
  const claude = { total: 12.345, claudePercent: 0.6 };
  const pct = Math.round((20 / DOLLARS_PER_PERCENT) * 10) / 10;
  const runs = { runs: 2, notRun: 0, usd: 7.655 };
  assert.equal(summaryLine(claude, null, { claudeRuns: runs }), `Cost $20.00 · Claude ${pct}% (2 claude-run) · Codex no ledger`);
  assert.equal(summaryLine(claude, null, { claudeRuns: { ...runs, notRun: 1 } }), `Cost $20.00 · Claude ${pct}% (2 claude-run, 1 not run) · Codex no ledger`);
  assert.equal(summaryLine(claude, null, { host: { percent: 5 }, percent: 5 }), 'Cost $12.35 · Claude 0.6% · Codex 5% (host)');
  assert.equal(summaryLine(claude, { percent: 1.5, runs: 3, notRun: 1 }, { host: { percent: 5 }, percent: 6 }), 'Cost $12.35 · Claude 0.6% · Codex 6% (host, 3 runs, 1 not run)');
  // Without either, the line is the one it always was.
  assert.equal(summaryLine(claude, { percent: 1.5, runs: 3 }, {}), 'Cost $12.35 · Claude 0.6% · Codex 1.5% (3 runs)');
  assert.equal(summaryLine(claude, null, { claudeRuns: { runs: 0, notRun: 0, usd: 0 } }), 'Cost $12.35 · Claude 0.6% · Codex no ledger');
});

test('formatReport adds the claude-run and the Codex host lines only when there are any', () => {
  const claude = summarizeClaude(parseTranscript(turn({ usage: { output_tokens: M } })));
  assert.doesNotMatch(formatReport(claude, null), /claude-run|Codex host/);
  const sessions = [parseCodexSession(hostMain()), parseCodexSession(hostSub())];
  const host = summarizeCodexHost(sessions);
  const claudeRuns = summarizeClaudeRuns([
    { at: '2026-10-24T01:00:00Z', kind: 'review', outcome: 'ok', costUsd: 1.5, ms: 60_000 },
    { at: '2026-10-24T01:00:00Z', kind: 'review', outcome: 'reserved' },
  ]);
  const text = formatReport(claude, null, { claudeRuns, host, percent: codexPercent([], sessions) });
  assert.match(text, /^Claude runs \(claude-run\): 1 runs \(review 1\) · \$1\.50 · 1 not run \(reserved or unavailable\)$/m);
  assert.match(text, /^Codex host: 1 sessions \(1 subagents\) · 3 turns · 2 questions · 1 compactions · tokens 14K \(77\.8% of input cached\) · 6% of quota · gpt-6\.1-sol$/m);
  assert.match(text, /^ {2}the % is account-wide: it includes any other work on the same Codex account during the window$/m);
  assert.match(text, /^Cost \$\d+\.\d\d · Claude [\d.]+% \(1 claude-run, 1 not run\) · Codex 6% \(host\)\n/);
});

test('fileLines streams a file in chunks: a line across chunks, a character across chunks, no newline at the end, an empty file', () => {
  const f = path.join(tmpDir('unit-cost-lines-'), 'a.jsonl');
  fs.writeFileSync(f, 'alpha\nbeta-long-line\n\ngamma ünï');
  assert.deepEqual([...fileLines(f, 4)], ['alpha', 'beta-long-line', '', 'gamma ünï']);
  fs.writeFileSync(f, 'one\n');
  assert.deepEqual([...fileLines(f, 3)], ['one']);
  fs.writeFileSync(f, '');
  assert.deepEqual([...fileLines(f, 4)], []);
});

/** A $CODEX_HOME whose sessions hold th-1, its subagent th-2, another thread with its subagent, and an exec run. */
function codexHome() {
  const home = tmpDir('unit-cost-codex-');
  const day = path.join(home, 'sessions', '2026', '10', '24');
  fs.mkdirSync(day, { recursive: true });
  const put = (name, lines) => fs.writeFileSync(path.join(day, name), `${lines.join('\n')}\n`);
  put('rollout-2026-10-24T08-00-00-th-1.jsonl', hostMain());
  put('rollout-2026-10-24T08-45-00-th-2.jsonl', hostSub());
  put('rollout-2026-10-24T08-46-00-th-9.jsonl', [cxMeta(46, { id: 'th-9', session_id: 'th-9' }), cxEvent(46, 'task_started'), cxTokens(47, 500, 40), cxTokens(48, 900, 44)]);
  put('rollout-2026-10-24T08-46-30-th-10.jsonl', [
    cxMeta(46, { id: 'th-10', session_id: 'th-9', parent_thread_id: 'th-9', source: { subagent: { thread_spawn: { parent_thread_id: 'th-9' } } } }),
    cxEvent(46, 'task_started'),
    cxTokens(47, 700, 41),
    cxTokens(48, 800, 43),
  ]);
  put('rollout-2026-10-24T08-47-00-ex-1.jsonl', [
    cxMeta(47, { id: 'ex-1', session_id: 'th-1', originator: 'codex_exec', source: 'exec' }),
    cxEvent(47, 'task_started'),
    cxTokens(48, 50_000, 30),
    cxTokens(49, 60_000, 39),
  ]);
  return home;
}

test('the wrapper takes a Codex thread id: its rollout under $CODEX_HOME/sessions and its subagents, never an exec run or another thread', () => {
  const root = fixture();
  const env = { CODEX_HOME: codexHome() };
  const base = ['--projects-dir', path.join(root, 'projects'), '--ledger', path.join(root, 'none.jsonl')];
  const r = cli(root, ['--session', 'th-1', ...base, '--json', '--times'], root, env);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.claude.turns, 0);
  assert.deepEqual([j.codexHost.sessions, j.codexHost.subagents, j.codexHost.tokens, j.codexHost.percent], [1, 1, 14_000, 6]);
  assert.deepEqual([j.times.waitMs, j.compactions.count], [50 * MIN, 1]);
  assert.equal(j.summary, 'Cost $0.00 · Claude 0% · Codex 6% (host)');
  // Claude's cache line says nothing about a Codex thread: its cache share is on the host line.
  assert.equal(j.cache, undefined);
  const text = cli(root, ['--session', 'th-1', ...base, '--times'], root, env).stdout;
  assert.match(text, /^Codex host: 1 sessions \(1 subagents\) · 3 turns .* 6% of quota · gpt-6\.1-sol$/m);
  assert.doesNotMatch(text, /cache hit/);
  const both = JSON.parse(cli(root, ['--session', 'sess1,th-1', ...base, '--json'], root, env).stdout);
  assert.deepEqual([both.claude.turns, both.codexHost.sessions], [2, 1]);
  const missing = cli(root, ['--session', 'th-404', ...base], root, env);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /session th-404 not found/);
});

test('the wrapper reads the main checkout\'s claude-run ledger from a worktree and adds the dollars of the runs made in that worktree', () => {
  const { root, git } = gitRepo();
  const wt = path.join(root, '.worktrees', 'wt2');
  const other = path.join(root, '.worktrees', 'wt-other');
  git('worktree', 'add', '-q', '-b', 'wt2', wt);
  git('worktree', 'add', '-q', '-b', 'wt-other', other);
  // claude-run records the --cwd it was given, here once through a link to the worktree
  const link = path.join(tmpDir('unit-cost-link-'), 'wt2-link');
  fs.symlinkSync(wt, link);
  const row = (cwd, costUsd) => JSON.stringify({ at: '2026-10-24T01:00:00Z', kind: 'review', cwd, outcome: 'ok', costUsd, ms: 1000 });
  fs.mkdirSync(path.join(root, '.claude-runs'));
  fs.writeFileSync(path.join(root, '.claude-runs', 'ledger.jsonl'), `${[row(wt, 2), row(path.join(wt, 'src'), 0.5), row(link, 0.25), row(root, 3), row(other, 5)].join('\n')}\n`);
  const sessions = fixture();
  const args = ['--session', 'sess1', '--projects-dir', path.join(sessions, 'projects'), '--line'];
  const line = (usd, n) => {
    const total = PRICE.opus[1] + PRICE.sonnet[1] + usd;
    return `Cost $${total.toFixed(2)} · Claude ${Math.round((total / DOLLARS_PER_PERCENT) * 10) / 10}% (${n} claude-run) · Codex no ledger\n`;
  };
  const r = cli(sessions, args, wt);
  assert.equal(r.status, 0, r.stderr);
  // the main checkout's run and the other worktree's are other units'
  assert.equal(r.stdout, line(2.75, 3));
  // --cwd-match picks the runs instead
  assert.equal(cli(sessions, [...args, '--cwd-match', path.join('.worktrees', 'wt-other')], wt).stdout, line(5, 1));
});

test('the wrapper reads the main checkout\'s Codex ledger from a worktree and counts the runs made in that worktree', () => {
  const { root, git } = gitRepo();
  const wt = path.join(root, '.worktrees', 'wt');
  const other = path.join(root, '.worktrees', 'wt-other');
  git('worktree', 'add', '-q', '-b', 'wt', wt);
  git('worktree', 'add', '-q', '-b', 'wt-other', other);
  const link = path.join(tmpDir('unit-cost-link-'), 'wt-link');
  fs.symlinkSync(wt, link);
  // each run has its own stretch of the quota: 2 + 1 + 1 made in wt, 5 in the main checkout, 7 in wt-other
  const row = (cwd, before, after) => JSON.stringify(run({ cwd, limitsBefore: { usedPercent: before, resetsAt: 111 }, limitsAfter: { usedPercent: after, resetsAt: 111 } }));
  fs.mkdirSync(path.join(root, '.codex-runs'));
  fs.writeFileSync(
    path.join(root, '.codex-runs', 'ledger.jsonl'),
    `${[row(wt, 10, 12), row(path.join(wt, 'src'), 20, 21), row(link, 30, 31), row(root, 40, 45), row(other, 50, 57), JSON.stringify(run({ cwd: undefined, limitsBefore: { usedPercent: 60, resetsAt: 111 }, limitsAfter: { usedPercent: 68, resetsAt: 111 } }))].join('\n')}\n`,
  );
  const sessions = fixture();
  const args = ['--session', 'sess1', '--projects-dir', path.join(sessions, 'projects'), '--line'];
  const codex = (cwd, more = []) => {
    const r = cli(sessions, [...args, ...more], cwd);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim().split(' · ').pop();
  };
  // the main checkout's run and the other worktree's are other units'; a row with no cwd is nobody's
  assert.equal(codex(wt), 'Codex 4% (3 runs)');
  assert.equal(codex(root), 'Codex 5% (1 runs)');
  // --cwd-match picks the runs instead
  assert.equal(codex(wt, ['--cwd-match', path.join('.worktrees', 'wt-other')]), 'Codex 7% (1 runs)');
});

test('a ledger counts only the runs between the sessions\' first and last turn, a bound the owner gave stays', () => {
  const root = tmpDir('unit-cost-window-');
  const proj = path.join(root, 'projects', '-p-app');
  fs.mkdirSync(proj, { recursive: true });
  const at = (hhmm) => `2026-10-24T${hhmm}:00Z`;
  fs.writeFileSync(
    path.join(proj, 'sess1.jsonl'),
    `${turn({ id: 'a', at: at('01:00'), usage: { output_tokens: 1 } })}\n${turn({ id: 'b', at: at('03:00'), usage: { output_tokens: 1 } })}\n`,
  );
  // a run before the first turn, one between the turns and one after the last, each with its own quota stretch and dollars
  const times = [
    [at('00:30'), 10, 12, 1],
    [at('02:00'), 20, 21, 2],
    [at('03:30'), 30, 35, 4],
  ];
  const rows = (extra) => times.map(([when, lo, hi, costUsd]) => JSON.stringify({ at: when, kind: 'review', cwd: root, outcome: 'ok', costUsd, ms: 1, limitsBefore: { usedPercent: lo, resetsAt: 111 }, limitsAfter: { usedPercent: hi, resetsAt: 111 }, ...extra }));
  fs.writeFileSync(path.join(root, 'ledger.jsonl'), `${rows().join('\n')}\n`);
  fs.mkdirSync(path.join(root, '.claude-runs'));
  fs.writeFileSync(path.join(root, '.claude-runs', 'ledger.jsonl'), `${rows().join('\n')}\n`);
  const read = (...more) => {
    const r = cli(root, ['--session', 'sess1', '--projects-dir', path.join(root, 'projects'), '--ledger', path.join(root, 'ledger.jsonl'), '--json', ...more]);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    return [j.codex.runs, j.codex.percent, j.claudeRuns.runs, j.claudeRuns.usd, j.claude.turns];
  };
  // no bounds: the run between the turns
  assert.deepEqual(read(), [1, 1, 1, 2, 2]);
  // --since: the run before the first turn too; the end is the last turn
  assert.deepEqual(read('--since', at('00:00')), [2, 3, 2, 3, 2]);
  // --until: the run after the last turn too; the start is the first turn
  assert.deepEqual(read('--until', at('04:00')), [2, 6, 2, 6, 2]);
  // both given: as given
  assert.deepEqual(read('--since', at('00:00'), '--until', at('04:00')), [3, 8, 3, 7, 2]);
  // the turns themselves keep the window as given
  assert.equal(read('--since', at('02:00'))[4], 1);
});

test('a Codex host\'s Codex % counts the ledger\'s runs only between the threads\' first and last time', () => {
  const root = fixture();
  const env = { CODEX_HOME: codexHome() };
  // a run before the threads, one between their turns and one after, each with its own stretch of the quota
  const row = (min, before, after) => JSON.stringify(run({ at: atMin(min), cwd: root, limitsBefore: { usedPercent: before, resetsAt: 1_800_000_000 }, limitsAfter: { usedPercent: after, resetsAt: 1_800_000_000 } }));
  fs.writeFileSync(path.join(root, 'ledger.jsonl'), `${[row(-10, 40, 41), row(30, 50, 53), row(80, 60, 65)].join('\n')}\n`);
  const line = (...more) => {
    const r = cli(root, ['--session', 'th-1', '--projects-dir', path.join(root, 'projects'), '--ledger', path.join(root, 'ledger.jsonl'), '--line', ...more], root, env);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  assert.equal(line(), 'Cost $0.00 · Claude 0% · Codex 9% (host, 1 runs)');
  assert.equal(line('--since', atMin(-60), '--until', atMin(120)), 'Cost $0.00 · Claude 0% · Codex 15% (host, 3 runs)');
});

test('a Codex thread archived to $CODEX_HOME/archived_sessions is still found, with its subagent', () => {
  const home = tmpDir('unit-cost-codex-');
  const archive = path.join(home, 'archived_sessions');
  fs.mkdirSync(path.join(home, 'sessions'));
  fs.mkdirSync(archive);
  const put = (name, lines) => fs.writeFileSync(path.join(archive, name), `${lines.join('\n')}\n`);
  put('rollout-2026-10-24T08-00-00-th-30.jsonl', [cxMeta(0, { id: 'th-30', session_id: 'th-30' }), cxEvent(0, 'task_started'), cxTokens(1, 100, 10), cxTokens(2, 400, 12)]);
  put('rollout-2026-10-24T08-01-00-th-31.jsonl', [
    cxMeta(1, { id: 'th-31', session_id: 'th-30', parent_thread_id: 'th-30', source: { subagent: { thread_spawn: { parent_thread_id: 'th-30' } } } }),
    cxEvent(1, 'task_started'),
    cxTokens(2, 50, 12),
    cxTokens(3, 90, 13),
  ]);
  const dir = codexSessionsDir({ CODEX_HOME: home });
  assert.deepEqual(codexSessionFiles(dir, 'th-30').map((f) => f.meta.id), ['th-30', 'th-31']);
  assert.deepEqual(codexProjectSessions(dir, ['/r/app']).map((f) => f.meta.id).sort(), ['th-30', 'th-31']);
});
