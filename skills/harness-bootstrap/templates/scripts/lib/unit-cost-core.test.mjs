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
  CACHE_WRITE_1H,
  CACHE_WRITE_5M,
  DOLLARS_PER_PERCENT,
  PRICE,
  dedupeRows,
  family,
  formatReport,
  inWindow,
  parseArgs,
  parseLedger,
  parseTranscript,
  rowCost,
  summarizeClaude,
  summarizeLedger,
  summaryLine,
} from './unit-cost-core.mjs';

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
  const s = summarizeLedger([run(), run({ kind: 'adversarial', ms: 500, limitsAfter: { usedPercent: 15.5, resetsAt: 111 } })]);
  assert.equal(s.runs, 2);
  assert.deepEqual(s.byKind, { review: 1, adversarial: 1 });
  assert.equal(s.percent, 7.5);
  assert.equal(s.ms, 1500);
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
});

/** A synthetic projects dir: one session with a subagent, a ledger, nothing from the real HOME. */
function fixture() {
  const root = tmpDir('unit-cost-');
  const proj = path.join(root, 'projects', '-p-app');
  fs.mkdirSync(path.join(proj, 'sess1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'sess1.jsonl'), `${turn({ id: 'a', usage: { output_tokens: M } })}\n`);
  fs.writeFileSync(path.join(proj, 'sess1', 'subagents', 'agent-1.jsonl'), `${turn({ id: 'b', model: 'claude-sonnet-5-5', usage: { output_tokens: M } })}\n`);
  fs.writeFileSync(path.join(proj, 'sess1', 'subagents', 'agent-1.meta.json'), JSON.stringify({ agentType: 'implementer' }));
  fs.writeFileSync(path.join(root, 'ledger.jsonl'), `${JSON.stringify(run())}\n`);
  return root;
}

function cli(root, args, cwd = root) {
  const env = { ...process.env, HOME: tmpDir('unit-cost-home-') };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
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
