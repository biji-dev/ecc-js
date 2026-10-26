// harness-bootstrap estimate tests (generated YYYY-MM-DD). Run: node --test scripts/lib/estimate-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: the tests read MIN_ROWS and COLUMNS' header
// words through fixtures written for the default names; a project that renames a column edits the
// fixture header, not the tests.
// Hermetic: the wrapper runs against a log file in a temp directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MIN_ROWS,
  estimate,
  filterRows,
  fmtMinutes,
  formatLine,
  formatReport,
  parseArgs,
  parseCost,
  parseDuration,
  parseElapsed,
  parseLog,
  percentile,
  tierWord,
} from './estimate-core.mjs';

const RUNNER = fileURLToPath(new URL('../estimate.mjs', import.meta.url));
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

/** A log table with the given header and rows (each row an array of cells). */
const table = (header, rows) =>
  [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const HEADER = ['Unit', 'Mode', 'Type', 'Tier', 'Elapsed', 'Cost', 'Scope', 'Friction'];
const row = (unit, tier, elapsed, cost = '', scope = 'admitted 0', type = 'Code') => [unit, 'plan', type, tier, elapsed, cost, scope, ''];
const LOG = table(HEADER, [
  row('EP-1', 'Full', 'work 100m · owner 40m', '$10.00 · Claude 0.5% · Codex 1%', '3 slices'),
  row('EP-2', 'Full', 'work 200m · owner 60m', '$20.00 · Claude 1.0% · Codex 2%', '4 slices'),
  row('EP-3', 'Full', 'work 300m · owner 80m', '$30.00 · Claude 1.5% · Codex 3%', '5 slices'),
  row('harness/a', 'Full', 'work 400m · owner 100m', '$40.00 · Claude 2.0% · Codex 4%'),
  row('EP-5', 'Small (cold)', '30m', '$1.00 · Claude 0.1%'),
]);

test('percentile interpolates linearly between ranks and handles one value and none', () => {
  near(percentile([1, 2, 3, 4], 0.25), 1.75);
  near(percentile([1, 2, 3, 4], 0.5), 2.5);
  near(percentile([1, 2, 3, 4], 0.75), 3.25);
  near(percentile([4, 1, 3, 2, 5], 0.5), 3);
  near(percentile([7], 0.25), 7);
  near(percentile([10, 20], 0), 10);
  near(percentile([10, 20], 1), 20);
  assert.equal(percentile([], 0.5), null);
});

test('parseDuration reads every form the logs use, in minutes', () => {
  assert.equal(parseDuration('189m'), 189);
  assert.equal(parseDuration('1h20m'), 80);
  assert.equal(parseDuration('5h43m'), 343);
  assert.equal(parseDuration('~2h55'), 175);
  assert.equal(parseDuration('93.5 min'), 93.5);
  assert.equal(parseDuration('7h55m'), 475);
  assert.equal(parseDuration('2 hours'), 120);
  assert.equal(parseDuration('1h'), 60);
  assert.equal(parseDuration('about 59 minutes of work'), 59);
});

test('parseDuration returns null for text with no duration and ignores timestamps and words that start with m', () => {
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration(undefined), null);
  assert.equal(parseDuration('from claim 04:53:23Z to land 05:52Z'), null);
  assert.equal(parseDuration('5 more days'), null);
});

test('parseElapsed splits work and owner wait from a combined cell', () => {
  assert.deepEqual(parseElapsed('work 189m · owner 308m'), { work: 189, ownerWait: 308 });
  assert.deepEqual(parseElapsed('work 189.2 min = claim 01:15:43Z → land 09:33:02Z (497.3 min) minus owner-wait 308.1 min (Gate 1 19.6)'), { work: 189.2, ownerWait: 308.1 });
  assert.deepEqual(parseElapsed('1h20m work (45m owner wait)'), { work: 80, ownerWait: 45 });
  assert.deepEqual(parseElapsed('59 min from claim 04:53:23Z to land 05:52Z; owner-wait inside it, not measured separately'), { work: 59, ownerWait: null });
  assert.deepEqual(parseElapsed('~2h55'), { work: 175, ownerWait: null });
  assert.deepEqual(parseElapsed('unknown'), { work: null, ownerWait: null });
});

test('parseCost reads $, Claude % and Codex % and leaves absent parts null', () => {
  assert.deepEqual(parseCost('Cost $12.35 · Claude 0.6% · Codex 1.5% (3 runs)'), { cost: 12.35, claudePct: 0.6, codexPct: 1.5 });
  assert.deepEqual(parseCost('$562 · Claude ~28%'), { cost: 562, claudePct: 28, codexPct: null });
  assert.deepEqual(parseCost('Codex no ledger'), { cost: null, claudePct: null, codexPct: null });
  assert.deepEqual(parseCost(''), { cost: null, claudePct: null, codexPct: null });
});

test('tierWord takes the leading tier word and ignores the parenthetical that follows', () => {
  assert.equal(tierWord('Full (critical `AGENTS.md`)'), 'full');
  assert.equal(tierWord('small'), 'small');
  assert.equal(tierWord('  Small (cold)'), 'small');
  assert.equal(tierWord('Fully loaded'), '');
  assert.equal(tierWord(''), '');
});

test('parseLog reads a Tier column and the combined Unit · Mode · Type · Tier cell (tier is the last part)', () => {
  const a = parseLog(LOG);
  assert.deepEqual(a.map((r) => [r.unit, r.tier, r.work, r.ownerWait]), [
    ['EP-1', 'full', 100, 40],
    ['EP-2', 'full', 200, 60],
    ['EP-3', 'full', 300, 80],
    ['harness/a', 'full', 400, 100],
    ['EP-5', 'small', 30, null],
  ]);
  const b = parseLog(table(['Unit · Mode · Type · Tier', 'Elapsed'], [['EP-9 · plan · Code · Full (critical)', '12m'], ['EP-8 · change · Docs · Small', '5m']]));
  assert.deepEqual(b.map((r) => [r.unit, r.tier, r.work]), [['EP-9 · plan · Code · Full (critical)', 'full', 12], ['EP-8 · change · Docs · Small', 'small', 5]]);
});

test('parseLog matches headers by prefix, case-insensitively, ignoring a leading star', () => {
  const rows = parseLog(table(['unit', 'TIER (as run)', '★ Elapsed (work)', 'Owner-wait', 'Cost (measured)'], [['U1', 'Full', '90m', '1h20m', '$5 · Claude 0.3% · Codex 2%']]));
  assert.deepEqual(rows[0], { unit: 'U1', type: '', tier: 'full', work: 90, ownerWait: 80, claudePct: 0.3, codexPct: 2, cost: 5, slices: null });
});

test('parseLog keeps an escaped pipe inside one cell instead of shifting the columns', () => {
  const text = ['| Unit | Tier | Elapsed | Cost |', '|---|---|---|---|', '| EP-1 | Full | work 50m \\| a note | $3 · Claude 0.2% |'].join('\n');
  const [r] = parseLog(text);
  assert.equal(r.work, 50);
  assert.equal(r.claudePct, 0.2);
});

test('parseLog reads slices from a Slices column or from "<n> slices" in the Scope cell', () => {
  assert.deepEqual(parseLog(LOG).map((r) => r.slices), [3, 4, 5, null, null]);
  const bySlicesCol = parseLog(table(['Unit', 'Tier', 'Elapsed', 'Slices'], [['U', 'Full', '60m', '6'], ['V', 'Full', '60m', 'n/a']]));
  assert.deepEqual(bySlicesCol.map((r) => r.slices), [6, null]);
});

test('parseLog skips unrelated tables, reads several logs tables, drops empty-unit rows and marks unreconcilable work', () => {
  const text = [
    table(['Rule', 'Why'], [['a', 'b']]),
    '',
    'prose between',
    '',
    table(['Unit', 'Tier', 'Elapsed'], [['U1', 'Full', '10m'], ['', 'Full', '20m'], ['U2', 'Full', 'cannot be reconciled; excluded']]),
    '',
    table(['Unit', 'Tier', 'Elapsed'], [['U3', 'Small', '5m']]),
  ].join('\n');
  assert.deepEqual(parseLog(text).map((r) => [r.unit, r.work]), [['U1', 10], ['U2', null], ['U3', 5]]);
  assert.deepEqual(parseLog('no table here'), []);
});

test('filterRows keeps one tier and matches the cohort regex against the Unit or Type cell', () => {
  const rows = parseLog(LOG);
  assert.equal(filterRows(rows, { tier: 'full' }).length, 4);
  assert.equal(filterRows(rows, { tier: 'small' }).length, 1);
  assert.equal(filterRows(rows, {}).length, 5);
  assert.deepEqual(filterRows(rows, { tier: 'full', cohort: /^harness\// }).map((r) => r.unit), ['harness/a']);
  assert.deepEqual(filterRows(rows, { cohort: /^ep-[12]$/i }).map((r) => r.unit), ['EP-1', 'EP-2']);
  const typed = parseLog(table(['Unit', 'Type', 'Tier', 'Elapsed'], [['U1', 'Docs', 'Small', '5m'], ['U2', 'Code', 'Small', '5m']]));
  assert.deepEqual(filterRows(typed, { cohort: /docs/i }).map((r) => r.unit), ['U1']);
});

test('estimate gives n, p25, median and p75 per metric over the filtered rows', () => {
  const est = estimate(parseLog(LOG), { tier: 'full' });
  assert.equal(est.rows, 4);
  assert.equal(est.metrics.work.n, 4);
  near(est.metrics.work.p25, 175);
  near(est.metrics.work.median, 250);
  near(est.metrics.work.p75, 325);
  assert.equal(est.metrics.ownerWait.n, 4);
  near(est.metrics.claudePct.median, 1.25);
  near(est.metrics.codexPct.p75, 3.25);
});

test(`a metric with fewer than MIN_ROWS rows says "no history (n=<k>, need ${MIN_ROWS})", never a number`, () => {
  const est = estimate(parseLog(LOG), { tier: 'small' });
  assert.equal(est.metrics.work.noHistory, true);
  assert.equal(est.metrics.work.message, `no history (n=1, need ${MIN_ROWS})`);
  assert.equal(est.metrics.work.p25, undefined);
  const two = estimate(parseLog(LOG), { cohort: /^EP-[12]$/ });
  assert.equal(two.metrics.work.message, 'no history (n=2, need 3)');
  assert.equal(estimate([], {}).metrics.work.message, 'no history (n=0, need 3)');
});

test('a log without a Cost column (or Elapsed owner part) gives no history for exactly those metrics', () => {
  const text = table(['Unit', 'Tier', 'Elapsed'], ['10m', '20m', '30m'].map((e, i) => [`U${i}`, 'Full', e]));
  const est = estimate(parseLog(text), { tier: 'full' });
  assert.equal(est.metrics.work.n, 3);
  assert.equal(est.metrics.ownerWait.message, 'no history (n=0, need 3)');
  assert.equal(est.metrics.claudePct.message, 'no history (n=0, need 3)');
  assert.equal(est.metrics.codexPct.message, 'no history (n=0, need 3)');
  const line = formatLine(est);
  assert.match(line, /work 15m–25m/);
  assert.match(line, /Claude no history \(n=0, need 3\)/);
});

test('estimate scales a per-slice range to the requested slice count from rows that name their slices', () => {
  const rows = parseLog(LOG);
  const est = estimate(rows, { tier: 'full', slices: 6 });
  assert.equal(est.perSlice.work.n, 3);
  const perSlice = [100 / 3, 200 / 4, 300 / 5].map((v) => v * 6);
  near(est.perSlice.work.median, perSlice.sort((a, b) => a - b)[1]);
  assert.equal(estimate(rows, { tier: 'full' }).perSlice, null);
  const none = estimate(parseLog(table(['Unit', 'Tier', 'Elapsed'], [['U', 'Full', '5m']])), { slices: 4 });
  assert.equal(none.perSlice.work.message, 'no history (n=0, need 3)');
});

test('formatLine has the Gate 1 shape: tier, n, four ranges and the not-a-promise tail', () => {
  const line = formatLine(estimate(parseLog(LOG), { tier: 'full' }));
  assert.equal(
    line,
    "Estimate (full, n=4): work 2h55m–5h25m · owner wait 55m–1h25m · Claude 0.9–1.6% · Codex 1.8–3.3% — a range from this project's log, not a promise",
  );
  assert.match(formatLine(estimate(parseLog(LOG), {})), /^Estimate \(all tiers, n=5\)/);
  assert.equal(fmtMinutes(59.6), '1h00m');
  assert.equal(fmtMinutes(5), '5m');
});

test('formatReport adds the median detail and the per-slice block when slices are given', () => {
  const text = formatReport(estimate(parseLog(LOG), { tier: 'full', slices: 2 }));
  assert.match(text, /^Estimate \(full, n=4\)/);
  assert.match(text, /work: n=4 · p25 2h55m · median 4h10m · p75 5h25m/);
  assert.match(text, /Per slice, scaled to 2 slices:/);
});

test('parseArgs needs --log, validates tier, cohort and slices, and rejects unknown flags', () => {
  const a = parseArgs(['--log', 'l.md', '--tier', 'Full', '--cohort', '^harness', '--slices', '5', '--json']);
  assert.equal(a.log, 'l.md');
  assert.equal(a.tier, 'full');
  assert.ok(a.cohort.test('Harness/x'));
  assert.equal(a.slices, 5);
  assert.equal(a.json, true);
  assert.throws(() => parseArgs([]), /--log .* is required/);
  assert.throws(() => parseArgs(['--log']), /--log needs a value/);
  assert.throws(() => parseArgs(['--log', 'l', '--tier', 'huge']), /--tier must be one of small\|full/);
  assert.throws(() => parseArgs(['--log', 'l', '--cohort', '(']), /not a regular expression/);
  assert.throws(() => parseArgs(['--log', 'l', '--slices', '0']), /whole number/);
  assert.throws(() => parseArgs(['--log', 'l', '--slices', '2.5']), /whole number/);
  assert.throws(() => parseArgs(['--log', 'l', '--nope']), /unknown option --nope/);
});

function cli(args) {
  const env = { ...process.env, HOME: tmpDir('estimate-home-') };
  return spawnSync(process.execPath, [RUNNER, ...args], { env, encoding: 'utf8' });
}

test('the wrapper prints the line for a log file, JSON on request, and exits 2 on a missing log or a log with no table', () => {
  const dir = tmpDir('estimate-');
  const log = path.join(dir, 'log.md');
  fs.writeFileSync(log, `# Harness log\n\n${LOG}\n`);
  const r = cli(['--log', log, '--tier', 'full']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Estimate \(full, n=4\): work 2h55m–5h25m/);
  const j = JSON.parse(cli(['--log', log, '--tier', 'small', '--json']).stdout);
  assert.equal(j.rows, 1);
  assert.match(j.line, /work no history \(n=1, need 3\)/);
  assert.equal(cli(['--log', path.join(dir, 'missing.md')]).status, 2);
  fs.writeFileSync(path.join(dir, 'empty.md'), '# nothing\n');
  const none = cli(['--log', path.join(dir, 'empty.md')]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no harness-log table/);
  assert.equal(cli(['--log', log, '--bogus']).status, 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['empty.md', 'log.md']);
});
