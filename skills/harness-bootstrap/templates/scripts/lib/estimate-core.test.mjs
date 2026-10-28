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
  groupUnits,
  leftOutRows,
  leftOutWarning,
  ownerWaitMinutes,
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
  row('EP-1', 'Full', 'work 100m · owner 40m', '$10.00 · Claude 0.5% · Codex 1%'),
  row('EP-2', 'Full', 'work 200m · owner 60m', '$20.00 · Claude 1.0% · Codex 2%'),
  row('EP-3', 'Full', 'work 300m · owner 80m', '$30.00 · Claude 1.5% · Codex 3%'),
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
  // unit-cost's line with runs that reported no cost still reads as the same cost and percents.
  assert.deepEqual(parseCost('Cost $20.00 · Claude 0.6% (2 claude-run, 2 without a cost, 1 not run) · Codex 6% (host, 3 runs)'), { cost: 20, claudePct: 0.6, codexPct: 6 });
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

test('tierWord reads Hot-small by default and the words a project binds, longest first, each matched literally', () => {
  assert.equal(tierWord('Hot-small'), 'hot-small');
  assert.equal(tierWord('Hot-small (rework)'), 'hot-small');
  assert.equal(tierWord('Small'), 'small');
  assert.equal(tierWord('S · x', ['s', 'm', 'l']), 's');
  assert.equal(tierWord('M'), '');
  assert.equal(tierWord('Medium', ['s', 'm', 'l']), '');
  assert.equal(tierWord('Hot-small', ['hot', 'hot-small']), 'hot-small');
  assert.equal(tierWord('Hot', ['hot', 'hot-small']), 'hot');
  assert.equal(tierWord('C++ (old)', ['c++', 'c']), 'c++');
  assert.equal(tierWord('Cxx', ['c++']), '');
  assert.equal(tierWord('a.c', ['a.c']), 'a.c');
  assert.equal(tierWord('abc', ['a.c']), '');
  // parseLog hands the bound words to it; the default list keeps a Hot-small row in the tier figures.
  const rows = [['U1', 'Hot-small', '10m'], ['U2', 'S', '20m']];
  const log = table(['Unit', 'Tier', 'Elapsed'], rows);
  assert.deepEqual(parseLog(log).map((r) => r.tier), ['hot-small', '']);
  assert.deepEqual(parseLog(log, { tierWords: ['s', 'm', 'l'] }).map((r) => r.tier), ['', 's']);
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
  assert.deepEqual(rows[0], { unit: 'U1', id: 'U1', type: '', tier: 'full', work: 90, ownerWait: 80, claudePct: 0.3, codexPct: 2, cost: 5 });
});

test('parseLog keeps an escaped pipe inside one cell instead of shifting the columns', () => {
  const text = ['| Unit | Tier | Elapsed | Cost |', '|---|---|---|---|', '| EP-1 | Full | work 50m \\| a note | $3 · Claude 0.2% |'].join('\n');
  const [r] = parseLog(text);
  assert.equal(r.work, 50);
  assert.equal(r.claudePct, 0.2);
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

test('rows with no header of their own continue the nearest earlier table with as many columns', () => {
  const text = [
    '| U0 | Full | 9m |',
    '',
    table(['Unit', 'Tier', 'Elapsed'], [['U1', 'Full', '10m']]),
    '',
    table(['Signal', 'Change'], [['a', 'b']]),
    '',
    '| U2 | Full | a stray | pipe | 20m |',
    '| U3 | Full | 20m |',
    '| two | cells |',
    '| U4 | Small | 5m |',
  ].join('\n');
  // U0 has no earlier table to continue; U2's stray pipes and the two-cell row match no log table.
  assert.deepEqual(parseLog(text, { raw: true }).map((r) => [r.unit, r.work, r.line]), [['U1', 10, 5], ['U3', 20, 12], ['U4', 5, 14]]);
});

test('the unit id drops the code ticks and bold around it; the Unit cell keeps them', () => {
  const [r] = parseLog(table(['Task', 'Elapsed'], [['`T-SEC-016`', '15m']]), { columns: { unit: 'task', elapsed: 'elapsed' } });
  assert.deepEqual([r.unit, r.id, r.work], ['`T-SEC-016`', 'T-SEC-016', 15]);
  assert.equal(parseLog(table(['Unit', 'Elapsed'], [['**EP-3** · plan', '5m']]))[0].id, 'EP-3');
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

test('formatLine has the Gate 1 shape: tier, n, four ranges and the not-a-promise tail', () => {
  const line = formatLine(estimate(parseLog(LOG), { tier: 'full' }));
  assert.equal(
    line,
    "Estimate per unit (full, n=4 units): work 2h55m–5h25m · owner wait 55m–1h25m · Claude 0.9–1.6% · Codex 1.8–3.3% — a range from this project's log, not a promise",
  );
  assert.match(formatLine(estimate(parseLog(LOG), {})), /^Estimate per unit \(all tiers, n=5 units\)/);
  assert.equal(fmtMinutes(59.6), '1h00m');
  assert.equal(fmtMinutes(5), '5m');
});

test('formatReport adds the median detail per metric', () => {
  const text = formatReport(estimate(parseLog(LOG), { tier: 'full' }));
  assert.match(text, /^Estimate per unit \(full, n=4 units\)/);
  assert.match(text, /work: n=4 · p25 2h55m · median 4h10m · p75 5h25m/);
  assert.doesNotMatch(text, /slice/i);
});

test('parseArgs needs --log, validates tier and cohort, and rejects unknown flags (--slices is gone)', () => {
  const a = parseArgs(['--log', 'l.md', '--tier', 'Full', '--cohort', '^harness', '--json']);
  assert.equal(a.log, 'l.md');
  assert.equal(a.tier, 'full');
  assert.ok(a.cohort.test('Harness/x'));
  assert.equal(a.json, true);
  assert.throws(() => parseArgs([]), /--log .* is required/);
  assert.throws(() => parseArgs(['--log']), /--log needs a value/);
  assert.throws(() => parseArgs(['--log', 'l', '--tier', 'huge']), /--tier must be one of small\|full/);
  assert.throws(() => parseArgs(['--log', 'l', '--cohort', '(']), /not a regular expression/);
  assert.throws(() => parseArgs(['--log', 'l', '--slices', '3']), /unknown option --slices/);
  assert.throws(() => parseArgs(['--log', 'l', '--nope']), /unknown option --nope/);
});

test('owner wait is summed over every term unit-record writes: durations joined by + or , and ISO pairs', () => {
  const d = '2026-10-24';
  assert.equal(ownerWaitMinutes('10m + 60m'), 70);
  assert.equal(ownerWaitMinutes('1h, 20m'), 80);
  assert.equal(ownerWaitMinutes('1h20m'), 80);
  assert.equal(ownerWaitMinutes(`asked ${d}T05:00:00Z → answered ${d}T05:30:00Z; asked ${d}T06:00:00Z → answered ${d}T07:20:00Z`), 110);
  // Text unit-record's parser cannot read falls back to the first duration, then to nothing.
  // A recorded wait of nothing is 0 minutes; a bare number with no unit stays unreadable.
  assert.equal(ownerWaitMinutes('0'), 0);
  assert.equal(ownerWaitMinutes('45'), null);
  assert.equal(ownerWaitMinutes('~2h55'), 175);
  assert.equal(ownerWaitMinutes('Gate 1 asked'), null);
  assert.equal(ownerWaitMinutes(`asked ${d}T06:00:00Z → pending`), null);
  const text = table(['Unit', 'Tier', 'Elapsed', 'Owner wait'], [['U1', 'Full', '10m', '10m + 60m'], ['U2', 'Full', '10m', '1h'], ['U3', 'Full', '10m', `${d}T05:00:00Z → ${d}T05:50:00Z`]]);
  assert.deepEqual(parseLog(text).map((r) => r.ownerWait), [70, 60, 50]);
  assert.equal(parseLog(table(['Unit', 'Tier', 'Elapsed', 'Owner wait'], [['U4', 'Full', '10m', '0']]))[0].ownerWait, 0);
  // The Elapsed-cell form (`work 100m · owner 40m`) is unchanged.
  assert.equal(parseLog(LOG)[0].ownerWait, 40);
});

test('a unit with several deliverable rows is one sample: work, owner wait and cost are summed per unit id', () => {
  const log = table(
    ['Unit · Mode · Type · Tier', 'Deliverable', 'Elapsed', 'Owner wait', 'Cost'],
    [
      ['EP-1 · plan · Code · Full', 'a.md', '60m', '10m', '$10 · Claude 1% · Codex 1%'],
      ['EP-1 · plan · Code · Full', 'b.md', '30m', '20m + 10m', '$5 · Claude 0.5% · Codex 0.5%'],
      ['EP-1 · plan · Code · Full', 'c.md', '15m', '5m', 'Codex no ledger'],
      ['EP-2 · plan · Code · Full', 'a.md', '100m', '40m', '$20 · Claude 2% · Codex 2%'],
      ['EP-3 · plan · Code · Full', 'a.md', '200m', '60m', '$30 · Claude 3% · Codex 3%'],
      ['EP-4 · plan · Docs · Small', 'a.md', '5m', '0m', ''],
    ],
  );
  const records = parseLog(log);
  assert.equal(records.length, 6);
  assert.deepEqual(records.map((r) => r.id), ['EP-1', 'EP-1', 'EP-1', 'EP-2', 'EP-3', 'EP-4']);
  const units = groupUnits(records);
  assert.equal(units.length, 4);
  const ep1 = units[0];
  assert.deepEqual([ep1.id, ep1.rows, ep1.tier, ep1.work, ep1.ownerWait, ep1.cost, ep1.claudePct, ep1.codexPct], ['EP-1', 3, 'full', 105, 45, 15, 1.5, 1.5]);
  assert.equal(groupUnits(records.filter((r) => r.id === 'EP-4'))[0].claudePct, null);
  const est = estimate(records, { tier: 'full' });
  assert.equal(est.rows, 3);
  assert.equal(est.metrics.work.n, 3);
  near(est.metrics.work.median, 105);
  near(est.metrics.work.p25, 102.5);
  near(est.metrics.ownerWait.median, 45);
  assert.match(formatLine(est), /^Estimate per unit \(full, n=3 units\): work 1h43m–2h33m/);
  // Without grouping EP-1 would be three samples (60, 30, 15 min of work), not one of 105.
  assert.equal(estimate(records, { tier: 'full', cohort: /^EP-1 /i }).rows, 1);
});

// A 4-column log table, a blank line, then rows written for an older, 3-column header.
const OLD_ROWS = '| U2 | Full | 10m |\n| U3 | Full | 20m |';
const REPRO = `${table(['Unit', 'Tier', 'Elapsed', 'Cost'], [['U1', 'Full', '10m', '$1.00']])}\n\n${OLD_ROWS}\n`;

test('leftOutRows returns the rows no table took, with their lines, from the scan tables() makes', () => {
  assert.deepEqual(parseLog(REPRO).map((r) => r.unit), ['U1'], 'the rows are not records');
  assert.deepEqual(leftOutRows(REPRO), [
    { line: 5, cells: ['U2', 'Full', '10m'] },
    { line: 6, cells: ['U3', 'Full', '20m'] },
  ]);
  assert.deepEqual(leftOutRows(LOG), []);
  assert.deepEqual(leftOutRows(''), []);
  // A row with as many cells as an earlier table joins it, so nothing is left out.
  const joined = `${table(['Unit', 'Tier', 'Elapsed', 'Cost'], [['U1', 'Full', '10m', '$1.00']])}\n\n| U2 | Full | 20m | $2.00 |\n`;
  assert.deepEqual(leftOutRows(joined), []);
  assert.deepEqual(parseLog(joined).map((r) => r.unit), ['U1', 'U2']);
  // A header row and its separator are never left out.
  assert.deepEqual(leftOutRows(`${REPRO}\n${table(['Unit', 'Tier', 'Elapsed'], [])}\n`), [
    { line: 5, cells: ['U2', 'Full', '10m'] },
    { line: 6, cells: ['U3', 'Full', '20m'] },
  ]);
});

test('leftOutWarning counts the rows and names their lines; no row, no warning', () => {
  assert.equal(leftOutWarning(leftOutRows(REPRO)), '2 log row(s) left out: no table above has as many columns (line 5, 6)');
  assert.equal(leftOutWarning(leftOutRows(LOG)), '');
  assert.equal(leftOutWarning([{ line: 9, cells: ['x'] }]), '1 log row(s) left out: no table above has as many columns (line 9)');
  const many = Array.from({ length: 14 }, (_, i) => ({ line: i + 1, cells: ['x'] }));
  assert.match(leftOutWarning(many), /^14 log row\(s\) left out: .* \(line 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, …\)$/);
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
  assert.match(r.stdout, /^Estimate per unit \(full, n=4 units\): work 2h55m–5h25m/);
  const j = JSON.parse(cli(['--log', log, '--tier', 'small', '--json']).stdout);
  assert.equal(j.rows, 1);
  assert.match(j.line, /work no history \(n=1, need 3\)/);
  assert.equal(cli(['--log', path.join(dir, 'missing.md')]).status, 2);
  fs.writeFileSync(path.join(dir, 'empty.md'), '# nothing\n');
  const none = cli(['--log', path.join(dir, 'empty.md')]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no harness-log table/);
  assert.equal(cli(['--log', log, '--bogus']).status, 2);
  assert.equal(cli(['--log', log, '--slices', '3']).status, 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['empty.md', 'log.md']);
});

test('the wrapper warns on stderr of log rows left out, exits 0 as before, and says nothing when none is', () => {
  const dir = tmpDir('estimate-');
  const log = path.join(dir, 'log.md');
  fs.writeFileSync(log, `# Harness log\n\n${LOG}\n`);
  const clean = cli(['--log', log]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.stderr, '');
  fs.writeFileSync(log, `# Harness log\n\n${LOG}\n\n| EP-9 | Full | 10m |\n| EP-10 | Full | 20m |\n`);
  const r = cli(['--log', log]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, 'estimate: warning: 2 log row(s) left out: no table above has as many columns (line 11, 12)\n');
  assert.equal(r.stdout, clean.stdout, 'the estimate itself is unchanged');
  assert.equal(cli(['--log', log, '--json']).stderr, r.stderr);
});

test('a log with its headers and no rows yet says no history, the install\'s first Gate 1', () => {
  const dir = tmpDir('estimate-');
  const log = path.join(dir, 'log.md');
  fs.writeFileSync(log, '# Harness log\n\n| Unit · Mode · Type · Tier | Elapsed (work) | Owner wait | Cost |\n|---|---|---|---|\n');
  const r = cli(['--log', log, '--tier', 'small']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Estimate per unit \(small, n=0 units\): work no history \(n=0, need \d+\)/);
});
