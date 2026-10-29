// harness-bootstrap estimate tests (generated YYYY-MM-DD). Run: node --test scripts/lib/estimate-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none to edit -- the fixtures are built from the
// core's bound values (COLUMNS for the header, TIERS and TIER_WORDS for the tier cells, MIN_ROWS for the
// number of units and every "need <n>" message), so a project that rebinds them edits no test.
// Hermetic: the wrapper runs against a log file in a temp directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COLUMNS,
  MIN_ROWS,
  TIERS,
  TIER_WORDS,
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

const DOT = String.fromCodePoint(0xb7);
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);
// The bound tier words the fixtures use: the --tier value of the biggest and of the smallest tier.
const BIG = TIERS.at(-1);
const SMALL = TIERS[0];
const BIG_CELL = cap(BIG);

const HEADER = [COLUMNS.unit, 'Mode', COLUMNS.type, COLUMNS.tier, COLUMNS.elapsed, COLUMNS.cost, 'Scope', 'Friction'];
const row = (unit, tier, elapsed, cost = '', scope = 'admitted 0', type = 'Code') => [unit, 'plan', type, tier, elapsed, cost, scope, ''];
// N big-tier units, enough for every metric to have history under the bound MIN_ROWS (4 under the template's 3), then one
// small one. Unit i works 100i min, waits 20 + 20i, costs 10i, Claude 0.5i %, Codex i %: the values are linear in i, so a
// quantile of them is 100 * (1 + (N - 1) * p), and so on, whatever N is.
const N = Math.max(MIN_ROWS, 4);
const at = (p) => 1 + (N - 1) * p;
const LOG_ROWS = N + 1;
const LOG = table(HEADER, [
  ...Array.from({ length: N }, (_, k) => {
    const i = k + 1;
    return row(i === N ? 'harness/a' : `EP-${i}`, BIG_CELL, `work ${100 * i}m ${DOT} owner ${20 + 20 * i}m`, `$${10 * i}.00 ${DOT} Claude ${(0.5 * i).toFixed(1)}% ${DOT} Codex ${i}%`);
  }),
  row('EP-S', `${cap(SMALL)} (cold)`, '30m', `$1.00 ${DOT} Claude 0.1%`),
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
  const word = TIER_WORDS[0];
  assert.equal(tierWord(`${cap(word)} (critical \`AGENTS.md\`)`), word);
  assert.equal(tierWord(word), word);
  assert.equal(tierWord(`  ${cap(word)} (cold)`), word);
  assert.equal(tierWord(`${cap(word)}ly loaded`), '');
  assert.equal(tierWord(''), '');
});

test('tierWord reads the words a project binds, longest first, each matched literally', () => {
  assert.equal(tierWord('S · x', ['s', 'm', 'l']), 's');
  assert.equal(tierWord('M', ['s']), '');
  assert.equal(tierWord('Medium', ['s', 'm', 'l']), '');
  assert.equal(tierWord('Hot-small', ['hot', 'hot-small']), 'hot-small');
  assert.equal(tierWord('Hot', ['hot', 'hot-small']), 'hot');
  assert.equal(tierWord('C++ (old)', ['c++', 'c']), 'c++');
  assert.equal(tierWord('Cxx', ['c++']), '');
  assert.equal(tierWord('a.c', ['a.c']), 'a.c');
  assert.equal(tierWord('abc', ['a.c']), '');
  // parseLog hands the words it is given to it; a word list of its own replaces the bound one.
  const rows = [['U1', 'Hot-small', '10m'], ['U2', 'S', '20m']];
  const log = table([COLUMNS.unit, COLUMNS.tier, COLUMNS.elapsed], rows);
  assert.deepEqual(parseLog(log, { tierWords: ['s', 'm', 'l'] }).map((r) => r.tier), ['', 's']);
  assert.deepEqual(parseLog(log, { tierWords: ['hot-small', 'small'] }).map((r) => r.tier), ['hot-small', '']);
});

test('parseLog reads a Tier column and the combined Unit · Mode · Type · Tier cell (tier is the last part)', () => {
  const a = parseLog(LOG);
  assert.deepEqual(a.map((r) => [r.unit, r.tier, r.work, r.ownerWait]), [
    ...Array.from({ length: N }, (_, k) => [k + 1 === N ? 'harness/a' : `EP-${k + 1}`, BIG, 100 * (k + 1), 40 + 20 * k]),
    ['EP-S', SMALL, 30, null],
  ]);
  const combined = `${COLUMNS.unit} ${DOT} Mode ${DOT} ${COLUMNS.type} ${DOT} ${COLUMNS.tier}`;
  const big = `EP-9 ${DOT} plan ${DOT} Code ${DOT} ${BIG_CELL} (critical)`;
  const small = `EP-8 ${DOT} change ${DOT} Docs ${DOT} ${cap(SMALL)}`;
  const b = parseLog(table([combined, COLUMNS.elapsed], [[big, '12m'], [small, '5m']]));
  assert.deepEqual(b.map((r) => [r.unit, r.tier, r.work]), [[big, BIG, 12], [small, SMALL, 5]]);
});

test('parseLog matches headers by prefix, case-insensitively, ignoring a leading star', () => {
  const star = String.fromCodePoint(0x2605);
  const header = [COLUMNS.unit.toLowerCase(), `${COLUMNS.tier.toUpperCase()} (as run)`, `${star} ${cap(COLUMNS.elapsed)} (work)`, cap(COLUMNS.ownerWait).replace(' ', '-'), `${cap(COLUMNS.cost)} (measured)`];
  const rows = parseLog(table(header, [['U1', BIG_CELL, '90m', '1h20m', `$5 ${DOT} Claude 0.3% ${DOT} Codex 2%`]]));
  assert.deepEqual(rows[0], { unit: 'U1', id: 'U1', type: '', tier: BIG, work: 90, ownerWait: 80, claudePct: 0.3, codexPct: 2, cost: 5 });
});

test('parseLog keeps an escaped pipe inside one cell instead of shifting the columns', () => {
  const text = [`| ${COLUMNS.unit} | ${COLUMNS.tier} | ${COLUMNS.elapsed} | ${COLUMNS.cost} |`, '|---|---|---|---|', '| EP-1 | Full | work 50m \\| a note | $3 · Claude 0.2% |'].join('\n');
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
    table([COLUMNS.unit, COLUMNS.tier, COLUMNS.elapsed], [['U1', 'Full', '10m'], ['', 'Full', '20m'], ['U2', 'Full', 'cannot be reconciled; excluded']]),
    '',
    table([COLUMNS.unit, COLUMNS.tier, COLUMNS.elapsed], [['U3', 'Small', '5m']]),
  ].join('\n');
  assert.deepEqual(parseLog(text).map((r) => [r.unit, r.work]), [['U1', 10], ['U2', null], ['U3', 5]]);
  assert.deepEqual(parseLog('no table here'), []);
});

test('rows with no header of their own continue the nearest earlier table with as many columns', () => {
  const text = [
    '| U0 | Full | 9m |',
    '',
    table([COLUMNS.unit, COLUMNS.tier, COLUMNS.elapsed], [['U1', 'Full', '10m']]),
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
  assert.equal(parseLog(table([COLUMNS.unit, COLUMNS.elapsed], [['**EP-3** · plan', '5m']]))[0].id, 'EP-3');
});

test('filterRows keeps one tier and matches the cohort regex against the Unit or Type cell', () => {
  const rows = parseLog(LOG);
  assert.equal(filterRows(rows, { tier: BIG }).length, N);
  assert.equal(filterRows(rows, { tier: SMALL }).length, 1);
  assert.equal(filterRows(rows, {}).length, LOG_ROWS);
  assert.deepEqual(filterRows(rows, { tier: BIG, cohort: /^harness\// }).map((r) => r.unit), ['harness/a']);
  assert.deepEqual(filterRows(rows, { cohort: /^ep-[12]$/i }).map((r) => r.unit), ['EP-1', 'EP-2']);
  const typed = parseLog(table([COLUMNS.unit, COLUMNS.type, COLUMNS.tier, COLUMNS.elapsed], [['U1', 'Docs', cap(SMALL), '5m'], ['U2', 'Code', cap(SMALL), '5m']]));
  assert.deepEqual(filterRows(typed, { cohort: /docs/i }).map((r) => r.unit), ['U1']);
});

test('estimate gives n, p25, median and p75 per metric over the filtered rows', () => {
  const est = estimate(parseLog(LOG), { tier: BIG });
  assert.equal(est.rows, N);
  assert.equal(est.metrics.work.n, N);
  near(est.metrics.work.p25, 100 * at(0.25));
  near(est.metrics.work.median, 100 * at(0.5));
  near(est.metrics.work.p75, 100 * at(0.75));
  assert.equal(est.metrics.ownerWait.n, N);
  near(est.metrics.ownerWait.p25, 20 + 20 * at(0.25));
  near(est.metrics.claudePct.median, 0.5 * at(0.5));
  near(est.metrics.codexPct.p75, at(0.75));
});

test(`a metric with fewer than MIN_ROWS rows says "no history (n=<k>, need ${MIN_ROWS})", never a number`, () => {
  const est = estimate(parseLog(LOG), { tier: SMALL });
  assert.equal(est.metrics.work.noHistory, true);
  assert.equal(est.metrics.work.message, `no history (n=1, need ${MIN_ROWS})`);
  assert.equal(est.metrics.work.p25, undefined);
  const short = estimate(parseLog(LOG).slice(0, MIN_ROWS - 1), {});
  assert.equal(short.metrics.work.message, `no history (n=${MIN_ROWS - 1}, need ${MIN_ROWS})`);
  assert.equal(estimate([], {}).metrics.work.message, `no history (n=0, need ${MIN_ROWS})`);
  // MIN_ROWS rows are enough.
  assert.equal(estimate(parseLog(LOG).slice(0, MIN_ROWS), {}).metrics.work.noHistory, undefined);
});

test('a log without a Cost column (or Elapsed owner part) gives no history for exactly those metrics', () => {
  const text = table([COLUMNS.unit, COLUMNS.tier, COLUMNS.elapsed], Array.from({ length: MIN_ROWS }, (_, i) => [`U${i}`, BIG_CELL, `${10 * (i + 1)}m`]));
  const est = estimate(parseLog(text), { tier: BIG });
  assert.equal(est.metrics.work.n, MIN_ROWS);
  const none = `no history (n=0, need ${MIN_ROWS})`;
  assert.equal(est.metrics.ownerWait.message, none);
  assert.equal(est.metrics.claudePct.message, none);
  assert.equal(est.metrics.codexPct.message, none);
  const line = formatLine(est);
  // Work is 10, 20, ... min: a quantile of it is 10 * (1 + (n - 1) * p).
  assert.ok(line.includes(`work ${fmtMinutes(10 * (1 + (MIN_ROWS - 1) * 0.25))}–${fmtMinutes(10 * (1 + (MIN_ROWS - 1) * 0.75))} `), line);
  assert.ok(line.includes(`Claude ${none}`), line);
});

test('formatLine has the Gate 1 shape: tier, n, four ranges and the not-a-promise tail', () => {
  // A hand-built estimate pins the shape whatever MIN_ROWS is.
  const stat = (p25, median, p75) => ({ n: 4, p25, median, p75 });
  const built = { tier: 'full', rows: 4, metrics: { work: stat(175, 250, 325), ownerWait: stat(55, 70, 85), claudePct: stat(0.875, 1.25, 1.625), codexPct: stat(1.75, 2.5, 3.25) } };
  assert.equal(
    formatLine(built),
    "Estimate per unit (full, n=4 units): work 2h55m–5h25m · owner wait 55m–1h25m · Claude 0.9–1.6% · Codex 1.8–3.3% — a range from this project's log, not a promise",
  );
  const line = formatLine(estimate(parseLog(LOG), { tier: BIG }));
  assert.ok(line.startsWith(`Estimate per unit (${BIG}, n=${N} units): work ${fmtMinutes(100 * at(0.25))}–${fmtMinutes(100 * at(0.75))} · owner wait ${fmtMinutes(20 + 20 * at(0.25))}–${fmtMinutes(20 + 20 * at(0.75))} · Claude `), line);
  assert.ok(line.endsWith(" — a range from this project's log, not a promise"), line);
  assert.match(formatLine(estimate(parseLog(LOG), {})), new RegExp(`^Estimate per unit \\(all tiers, n=${LOG_ROWS} units\\)`));
  assert.equal(fmtMinutes(59.6), '1h00m');
  assert.equal(fmtMinutes(5), '5m');
});

test('formatReport adds the median detail per metric', () => {
  const text = formatReport(estimate(parseLog(LOG), { tier: BIG }));
  assert.ok(text.startsWith(`Estimate per unit (${BIG}, n=${N} units)`), text);
  assert.ok(text.includes(`work: n=${N} ${DOT} p25 ${fmtMinutes(100 * at(0.25))} ${DOT} median ${fmtMinutes(100 * at(0.5))} ${DOT} p75 ${fmtMinutes(100 * at(0.75))}`), text);
  assert.doesNotMatch(text, /slice/i);
});

test('parseArgs needs --log, validates tier and cohort, and rejects unknown flags (--slices is gone)', () => {
  const a = parseArgs(['--log', 'l.md', '--tier', BIG_CELL, '--cohort', '^harness', '--json']);
  assert.equal(a.log, 'l.md');
  assert.equal(a.tier, BIG);
  assert.ok(a.cohort.test('Harness/x'));
  assert.equal(a.json, true);
  assert.throws(() => parseArgs([]), /--log .* is required/);
  assert.throws(() => parseArgs(['--log']), /--log needs a value/);
  assert.throws(() => parseArgs(['--log', 'l', '--tier', 'huge']), new RegExp(`--tier must be one of ${TIERS.join('\\|')}`));
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
  const head = [COLUMNS.unit, COLUMNS.tier, COLUMNS.elapsed, COLUMNS.ownerWait];
  const text = table(head, [['U1', 'Full', '10m', '10m + 60m'], ['U2', 'Full', '10m', '1h'], ['U3', 'Full', '10m', `${d}T05:00:00Z → ${d}T05:50:00Z`]]);
  assert.deepEqual(parseLog(text).map((r) => r.ownerWait), [70, 60, 50]);
  assert.equal(parseLog(table(head, [['U4', 'Full', '10m', '0']]))[0].ownerWait, 0);
  // The Elapsed-cell form (`work 100m · owner 40m`) is unchanged.
  assert.equal(parseLog(LOG)[0].ownerWait, 40);
});

test('a unit with several deliverable rows is one sample: work, owner wait and cost are summed per unit id', () => {
  const unitCell = (id, type, tier) => `${id} ${DOT} plan ${DOT} ${type} ${DOT} ${tier}`;
  // Units beyond EP-3 bring the big-tier units up to MIN_ROWS (none under the template's 3), each 150m of work and 50m of wait.
  const extra = Array.from({ length: Math.max(0, MIN_ROWS - 3) }, (_, i) => `EP-${10 + i}`);
  const log = table(
    [`${COLUMNS.unit} ${DOT} Mode ${DOT} ${COLUMNS.type} ${DOT} ${COLUMNS.tier}`, 'Deliverable', COLUMNS.elapsed, COLUMNS.ownerWait, COLUMNS.cost],
    [
      [unitCell('EP-1', 'Code', BIG_CELL), 'a.md', '60m', '10m', `$10 ${DOT} Claude 1% ${DOT} Codex 1%`],
      [unitCell('EP-1', 'Code', BIG_CELL), 'b.md', '30m', '20m + 10m', `$5 ${DOT} Claude 0.5% ${DOT} Codex 0.5%`],
      [unitCell('EP-1', 'Code', BIG_CELL), 'c.md', '15m', '5m', 'Codex no ledger'],
      [unitCell('EP-2', 'Code', BIG_CELL), 'a.md', '100m', '40m', `$20 ${DOT} Claude 2% ${DOT} Codex 2%`],
      [unitCell('EP-3', 'Code', BIG_CELL), 'a.md', '200m', '60m', `$30 ${DOT} Claude 3% ${DOT} Codex 3%`],
      [unitCell('EP-4', 'Docs', cap(SMALL)), 'a.md', '5m', '0m', ''],
      ...extra.map((id) => [unitCell(id, 'Code', BIG_CELL), 'a.md', '150m', '50m', '']),
    ],
  );
  const records = parseLog(log);
  assert.equal(records.length, 6 + extra.length);
  assert.deepEqual(records.map((r) => r.id), ['EP-1', 'EP-1', 'EP-1', 'EP-2', 'EP-3', 'EP-4', ...extra]);
  const units = groupUnits(records);
  assert.equal(units.length, 4 + extra.length);
  const ep1 = units[0];
  assert.deepEqual([ep1.id, ep1.rows, ep1.tier, ep1.work, ep1.ownerWait, ep1.cost, ep1.claudePct, ep1.codexPct], ['EP-1', 3, BIG, 105, 45, 15, 1.5, 1.5]);
  assert.equal(groupUnits(records.filter((r) => r.id === 'EP-4'))[0].claudePct, null);
  const est = estimate(records, { tier: BIG });
  const work = [105, 100, 200, ...extra.map(() => 150)];
  const wait = [45, 40, 60, ...extra.map(() => 50)];
  assert.equal(est.rows, work.length);
  assert.equal(est.metrics.work.n, work.length);
  near(est.metrics.work.median, percentile(work, 0.5));
  near(est.metrics.work.p25, percentile(work, 0.25));
  near(est.metrics.ownerWait.median, percentile(wait, 0.5));
  assert.ok(formatLine(est).startsWith(`Estimate per unit (${BIG}, n=${work.length} units): work ${fmtMinutes(percentile(work, 0.25))}–${fmtMinutes(percentile(work, 0.75))}`), formatLine(est));
  // Without grouping EP-1 would be three samples (60, 30, 15 min of work), not one of 105.
  assert.equal(estimate(records, { tier: BIG, cohort: /^EP-1 /i }).rows, 1);
});

// A 4-column log table, a blank line, then rows written for an older, 3-column header.
const OLD_ROWS = '| U2 | Full | 10m |\n| U3 | Full | 20m |';
const REPRO = `${table([COLUMNS.unit, COLUMNS.tier, COLUMNS.elapsed, COLUMNS.cost], [['U1', 'Full', '10m', '$1.00']])}\n\n${OLD_ROWS}\n`;

test('leftOutRows returns the rows no table took, with their lines, from the scan tables() makes', () => {
  assert.deepEqual(parseLog(REPRO).map((r) => r.unit), ['U1'], 'the rows are not records');
  assert.deepEqual(leftOutRows(REPRO), [
    { line: 5, cells: ['U2', 'Full', '10m'] },
    { line: 6, cells: ['U3', 'Full', '20m'] },
  ]);
  assert.deepEqual(leftOutRows(LOG), []);
  assert.deepEqual(leftOutRows(''), []);
  // A row with as many cells as an earlier table joins it, so nothing is left out.
  const joined = `${table([COLUMNS.unit, COLUMNS.tier, COLUMNS.elapsed, COLUMNS.cost], [['U1', 'Full', '10m', '$1.00']])}\n\n| U2 | Full | 20m | $2.00 |\n`;
  assert.deepEqual(leftOutRows(joined), []);
  assert.deepEqual(parseLog(joined).map((r) => r.unit), ['U1', 'U2']);
  // A header row and its separator are never left out.
  assert.deepEqual(leftOutRows(`${REPRO}\n${table([COLUMNS.unit, COLUMNS.tier, COLUMNS.elapsed], [])}\n`), [
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
  const r = cli(['--log', log, '--tier', BIG]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.startsWith(`Estimate per unit (${BIG}, n=${N} units): work ${fmtMinutes(100 * at(0.25))}–${fmtMinutes(100 * at(0.75))}`), r.stdout);
  const j = JSON.parse(cli(['--log', log, '--tier', SMALL, '--json']).stdout);
  assert.equal(j.rows, 1);
  assert.ok(j.line.includes(`work no history (n=1, need ${MIN_ROWS})`), j.line);
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
  // The title, a blank line and the header and separator come first, then the rows, then a blank line.
  const first = 4 + LOG_ROWS + 2;
  assert.equal(r.stderr, `estimate: warning: 2 log row(s) left out: no table above has as many columns (line ${first}, ${first + 1})\n`);
  assert.equal(r.stdout, clean.stdout, 'the estimate itself is unchanged');
  assert.equal(cli(['--log', log, '--json']).stderr, r.stderr);
});

test('a log with its headers and no rows yet says no history, the install\'s first Gate 1', () => {
  const dir = tmpDir('estimate-');
  const log = path.join(dir, 'log.md');
  const head = [`${COLUMNS.unit} ${DOT} Mode ${DOT} ${COLUMNS.type} ${DOT} ${COLUMNS.tier}`, `${cap(COLUMNS.elapsed)} (work)`, cap(COLUMNS.ownerWait), cap(COLUMNS.cost)];
  fs.writeFileSync(log, `# Harness log\n\n${table(head, [])}\n`);
  const r = cli(['--log', log, '--tier', SMALL]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.startsWith(`Estimate per unit (${SMALL}, n=0 units): work no history (n=0, need ${MIN_ROWS})`), r.stdout);
});
