/**
 * Tests for the harness-bootstrap estimate template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'estimate-core.test.mjs');
const CORE_REL = path.join('lib', 'estimate-core.mjs');
const CLI_REL = 'estimate.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 27;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Env with a fresh HOME and no GIT_* variable; `extra` is applied last. */
function hermeticEnv(cleanup, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.HOME = tmp('estimate-suite-home-');
  cleanup.push(env.HOME);
  return { ...env, ...extra };
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(scriptsDir, cleanup, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(scriptsDir, TEST_REL)],
    { encoding: 'utf8', env: hermeticEnv(cleanup, extraEnv), timeout: 120_000 },
  );
}

/** Run the shipped CLI from `scriptsDir` with `cwd` as the working directory. */
function runCli(scriptsDir, args, cwd, cleanup) {
  return spawnSync(process.execPath, [path.join(scriptsDir, CLI_REL), ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv(cleanup),
    timeout: 60_000,
  });
}

const cleanup = [];

/** Copy the shipped scripts, apply a one-line mutation to the core, and assert the suite fails. */
function mutantFails(name, needle, replacement, fileRel = CORE_REL) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('estimate-mutant-');
    cleanup.push(copy);
    fs.cpSync(SCRIPTS, copy, { recursive: true });
    const corePath = path.join(copy, fileRel);
    const before = fs.readFileSync(corePath, 'utf8');
    const mutated = before.replace(needle, replacement);
    assert.notStrictEqual(mutated, before, 'the mutation did not apply');
    fs.writeFileSync(corePath, mutated);
    const res = runSuite(copy, cleanup);
    const out = res.stdout + res.stderr;
    assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
    assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
  });
}

console.log('\nharness-bootstrap estimate template');

test('the shipped estimate suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

// The four report cores' [B] bindings as one install rewrites them, [file, needle, replacement], each needle once
// in its file. The values need not agree across cores: each suite builds its own fixtures from the core it tests.
const MID = String.fromCodePoint(0xb7);
const STAR = String.fromCodePoint(0x2605);
const UNIT_RECORD_CORE = path.join('lib', 'unit-record-core.mjs');
const ESTIMATE_CORE = path.join('lib', 'estimate-core.mjs');
const RETRO_CORE = path.join('lib', 'retro-core.mjs');
const DUE_CORE = path.join('lib', 'harness-due-core.mjs');
const logColumns = (names) => `export const LOG_COLUMNS = [\n${names.map((n) => `  '${n}',`).join('\n')}\n];`;
const FOLLOW_UPS_LIST = "export const FOLLOW_UPS = ['docs/fu/*.md', 'docs/other.md'];";
const INSTALL = [
  // unit-record-core
  [UNIT_RECORD_CORE, 'export const AUDITOR_SOURCE = /conform|claim|lane-a|lane-c/i;', 'export const AUDITOR_SOURCE = /auditor|spec-check/i;'],
  [UNIT_RECORD_CORE, 'export const SUMMARY_LINE = /^SUMMARY \\d+ passed, \\d+ failed, \\d+ skipped.*$/gm;', 'export const SUMMARY_LINE = /^All \\d+ stages passed in \\d+s\\.$/gm;'],
  [UNIT_RECORD_CORE, "export const LEDGER_HEADING = 'ledger';", "export const LEDGER_HEADING = 'steps';"],
  [UNIT_RECORD_CORE, "export const FINDINGS_HEADING = 'findings';", "export const FINDINGS_HEADING = 'review findings';"],
  [UNIT_RECORD_CORE, 'export const MAX_COMMITS = 40;', 'export const MAX_COMMITS = 12;'],
  [
    UNIT_RECORD_CORE,
    logColumns([`Unit ${MID} Mode ${MID} Type ${MID} Tier`, 'Deliverable', 'Elapsed (work)', 'Owner wait', 'Defects', 'Scope', `Gate 1 ${MID} Gate 2`, 'Verdicts', 'Retries', 'Model', 'Cost', `${STAR} Missed by harness`, 'Yield by source', 'Friction']),
    logColumns([`Unit ${MID} Type ${MID} Tier`, 'Deliverable', 'Elapsed (work)', 'Owner wait', 'Cost', 'Defects', `${STAR} Missed by harness`, 'Notes']),
  ],
  // estimate-core
  [ESTIMATE_CORE, 'export const MIN_ROWS = 3;', 'export const MIN_ROWS = 5;'],
  [ESTIMATE_CORE, "export const TIERS = ['small', 'full'];", "export const TIERS = ['s', 'm', 'l'];"],
  [ESTIMATE_CORE, "export const TIER_WORDS = ['trivial', 'hot-small', 'small', 'full', 'docs'];", "export const TIER_WORDS = ['s', 'm', 'l'];"],
  [ESTIMATE_CORE, "  unit: 'unit',\n  type: 'type',\n  tier: 'tier',", "  unit: 'task',\n  type: 'type',\n  tier: 'size',"],
  // retro-core
  [RETRO_CORE, "export const REPORTS_DIR = 'docs/harness/reports';", "export const REPORTS_DIR = 'docs/reports/harness';"],
  [RETRO_CORE, "export const LOG = 'docs/harness/log.md';", "export const LOG = 'docs/harness-log.md';"],
  [RETRO_CORE, "export const FOLLOW_UPS = 'docs/harness/follow-ups.md';", FOLLOW_UPS_LIST],
  [RETRO_CORE, "export const PLANS_DIR = 'docs/plans';", "export const PLANS_DIR = '.claude/plans';"],
  [RETRO_CORE, "export const STATUS_COLUMNS = ['status'];", "export const STATUS_COLUMNS = ['decision'];"],
  [
    RETRO_CORE,
    "export const STATUS_WORDS = { open: ['open'], scheduled: ['scheduled'], fixed: ['fixed'], dropped: ['dropped'] };",
    "export const STATUS_WORDS = { open: ['todo'], scheduled: ['planned'], fixed: ['done'], dropped: ['wontfix'] };",
  ],
  [RETRO_CORE, "export const SEVERITY_COLUMNS = ['sev', 'priority'];", "export const SEVERITY_COLUMNS = ['impact'];"],
  [RETRO_CORE, 'export const FILED_AT = null;', 'export const FILED_AT = /(?:^|[^\\d])(\\d{4}-\\d{2}-\\d{2})-[a-z]/i;'],
  [RETRO_CORE, "export const EXTRA_COLUMNS = { defects: 'defects', missed: 'missed by harness', friction: 'friction' };", "export const EXTRA_COLUMNS = { defects: 'bugs', missed: 'missed', friction: 'notes' };"],
  [RETRO_CORE, 'export const OUTLIER_X = 2;', 'export const OUTLIER_X = 3;'],
  [RETRO_CORE, 'export const MIN_COHORT = 3;', 'export const MIN_COHORT = 4;'],
  [RETRO_CORE, 'export const MIN_SHARE = 5;', 'export const MIN_SHARE = 8;'],
  [RETRO_CORE, 'export const REWRITE_ALERT_PERCENT = 5;', 'export const REWRITE_ALERT_PERCENT = 10;'],
  [RETRO_CORE, 'export const QUEUE_ALERT_DAYS = 14;', 'export const QUEUE_ALERT_DAYS = 21;'],
  [RETRO_CORE, "  [/\\blive\\b|\\bwalk\\b/i, '5'],", "  [/\\bsmoke\\b/i, '5'],\n  [/\\blive\\b|\\bwalk\\b/i, '5'],"],
  // harness-due-core
  [DUE_CORE, "export const MAIN = 'main';", "export const MAIN = 'trunk';"],
  [DUE_CORE, "export const LOG = 'docs/harness/log.md';", "export const LOG = 'docs/harness-log.md';"],
  [DUE_CORE, "export const FOLLOW_UPS = 'docs/harness/follow-ups.md';", FOLLOW_UPS_LIST],
  [DUE_CORE, "  preflight: 'docs/harness/reports/preflight-<phase>.md',", "  preflight: 'docs/preflight/<phase>.md',"],
  [DUE_CORE, "  sweep: 'docs/harness/reports/sweep-<date>.md',", "  sweep: 'docs/sweeps/<date>.md',"],
  [DUE_CORE, 'export const PHASE_OF = /^([A-Za-z]+-?\\d+)[-.]\\w/;', 'export const PHASE_OF = (id) => /^(M\\d+)\\.\\d/.exec(id)?.[1] ?? null;'],
  [DUE_CORE, '  sweep: { days: 7, landings: 5 },', '  sweep: { days: 10, landings: 8 },'],
  [DUE_CORE, '  hygiene: { days: 14, landings: 5 },', '  hygiene: { days: 21, landings: null },'],
  [DUE_CORE, 'export const P3_AGE_DAYS = 14;', 'export const P3_AGE_DAYS = 30;'],
  [DUE_CORE, 'export const DISK_MIN_GB = 25;', 'export const DISK_MIN_GB = 40;'],
  [DUE_CORE, 'export const WORKTREE_IDLE_HOURS = 6;', 'export const WORKTREE_IDLE_HOURS = 72;'],
  [
    DUE_CORE,
    'export const REBUILDABLE = /(^|\\/)(node_modules|dist|build|out|coverage|test-results|playwright-report|\\.next|\\.turbo|\\.expo|\\.vite|\\.cache|\\.husky\\/_)\\/?$|\\.DS_Store$|\\.tsbuildinfo$/;',
    'export const REBUILDABLE = /(^|\\/)(node_modules|dist|\\.turbo|\\.output)\\/?$|\\.DS_Store$/;',
  ],
  [DUE_CORE, String.raw`  preflight: 'run the phase preflight for <phase> (harness-bootstrap\'s reference/preflight.md); its escalations are Gate 1 cards',`, "  preflight: 'run /phase-check <phase>; its escalations are Gate 1 cards',"],
  [DUE_CORE, String.raw`  sweep: 'the next unit: harness/sweep-<date> (harness-bootstrap\'s reference/sweep.md)',`, "  sweep: 'run /sweep-check, the next unit: harness/sweep-<date>',"],
  [DUE_CORE, String.raw`  retro: 'the next unit: harness/retro-<date> (node scripts/retro.mjs, then commit the digest)',`, "  retro: 'run /weekly-retro, the next unit: harness/retro-<date>, then commit the digest',"],
  [DUE_CORE, String.raw`  hygiene: 'the next unit: harness/hygiene-<date> (harness-bootstrap\'s reference/hygiene.md)',`, "  hygiene: 'run /hygiene-pass, the next unit: harness/hygiene-<date>',"],
  [DUE_CORE, String.raw`  p3: 'the next unit: harness/p3-batch-<date>, the hygiene unit\'s P3 batch alone (harness-bootstrap\'s reference/hygiene.md)',`, "  p3: 'run /p3-batch, the next unit: harness/p3-batch-<date>, the P3 batch alone',"],
  [DUE_CORE, "  disk: 'node ~/.agents/harness/machine-sweep/machine-sweep.mjs --apply-approved, in the background',", "  disk: 'run /free-disk, in the background',"],
  [DUE_CORE, "  worktrees: 'git worktree remove <paths>, each once no registry row names it',", "  worktrees: 'run /prune-worktrees <paths>, each once no registry row names it',"],
  [DUE_CORE, "  proposals: 'read <file>; route each proposal (T: a harness/<slug> unit, C: the next Gate 2 brief), then node scripts/harness-due.mjs --seen <week>',", "  proposals: 'run /read-proposals <file>, then node scripts/harness-due.mjs --seen <week>',"],
];

/** Copy the shipped scripts, apply each rebinding (each needle exactly once), run the suite. */
function reboundRun(rebindings) {
  const copy = tmp('estimate-rebound-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  for (const [rel, needle, replacement] of rebindings) {
    const file = path.join(copy, rel);
    const before = fs.readFileSync(file, 'utf8');
    assert.strictEqual(before.split(needle).length - 1, 1, `${needle} is not in ${rel} exactly once`);
    fs.writeFileSync(file, before.replace(needle, () => replacement));
  }
  const res = runSuite(copy, cleanup);
  return { res, out: res.stdout + res.stderr };
}

test('the shipped suite passes with every binding rebound as an install binds them', () => {
  const { res, out } = reboundRun(INSTALL);
  const failing = out.match(/^not ok .*$/gm) ?? [];
  assert.strictEqual(res.status, 0, `rebound: ${failing.length} failing, first: ${failing.slice(0, 3).join(' | ')}\n${out.slice(-1200)}`);
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1200));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('using the nearest rank instead of interpolating', 'const pos = (v.length - 1) * p;', 'const pos = Math.floor((v.length - 1) * p);');
mutantFails('showing a range below the history threshold', 'export const MIN_ROWS = 3;', 'export const MIN_ROWS = 1;');
mutantFails('reading the tier from the wrong part of the combined cell', "parts.length > 1 ? parts.at(-1) : ''", "''");
mutantFails('ignoring the Type cell in the cohort filter', 'cohort.test(r.unit) || cohort.test(r.type)', 'cohort.test(r.unit)');
mutantFails('reading hours as 6 minutes each', 'n * 60 +', 'n * 6 +');
mutantFails('counting each deliverable row as its own sample', 'if (!byId.has(r.id)) byId.set(r.id, []);\n    byId.get(r.id).push(r);', 'byId.set(`${byId.size}`, [r]);');
mutantFails('reading only the first term of an owner wait', 'return wait === null ? parseDuration(cell) : wait.ms / 60_000;', 'return parseDuration(cell);');
mutantFails('accepting an unknown flag', '} else throw new Error(`unknown option ${t}`);', '}');
mutantFails('dropping the rows below a later table', 'const home = out.findLast((x) => x.names.length === r.cells.length);', 'const home = null;');
mutantFails('dropping the rows no table took without a word', 'else leftOut.push(r);', '');
mutantFails('staying silent about the log rows left out', 'if (leftOut) process.stderr.write(', 'if (false) process.stderr.write(', CLI_REL);
mutantFails('refusing a log that has headers and no rows yet', 'return tables(text).some(({ names })', 'return false && tables(text).some(({ names })');
mutantFails('keeping the code ticks in the unit id', "id: parts[0].replace(/^[`*]+|[`*]+$/g, ''),", 'id: parts[0],');

/** What the shipped suite no longer pins: it builds its fixtures from the bound values, so the template's own are read here. */
function checkDefaults(scriptsDir) {
  const url = pathToFileURL(path.join(scriptsDir, CORE_REL)).href;
  const code = `import * as c from ${JSON.stringify(url)};
const log = [['U1', 'Hot-small', '10m'], ['U2', 'S', '20m']];
const text = '| Unit | Tier | Elapsed |\\n|---|---|---|\\n' + log.map((r) => '| ' + r.join(' | ') + ' |').join('\\n') + '\\n';
let flag = '';
try { c.parseArgs(['--log', 'l', '--tier', 'huge']); } catch (e) { flag = e.message; }
console.log(JSON.stringify({
  minRows: c.MIN_ROWS,
  tiers: c.TIERS,
  words: c.TIER_WORDS,
  columns: c.COLUMNS,
  hot: [c.tierWord('Hot-small'), c.tierWord('Hot-small (rework)'), c.tierWord('Small'), c.tierWord('M')],
  tiersRead: c.parseLog(text).map((r) => r.tier),
  none: c.estimate([], {}).metrics.work.message,
  flag,
}));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: hermeticEnv(cleanup) });
  assert.strictEqual(res.status, 0, res.stderr);
  const got = JSON.parse(res.stdout);
  assert.strictEqual(got.minRows, 3, 'the template MIN_ROWS');
  assert.deepStrictEqual(got.tiers, ['small', 'full'], 'the template TIERS');
  assert.deepStrictEqual(got.words, ['trivial', 'hot-small', 'small', 'full', 'docs'], 'the template TIER_WORDS');
  assert.deepStrictEqual(got.columns, { unit: 'unit', type: 'type', tier: 'tier', elapsed: 'elapsed', ownerWait: 'owner wait', cost: 'cost' }, 'the template COLUMNS');
  assert.deepStrictEqual(got.hot, ['hot-small', 'hot-small', 'small', ''], `Hot-small is read whole, longest word first, and M is no tier: ${got.hot.join(', ')}`);
  assert.deepStrictEqual(got.tiersRead, ['hot-small', ''], 'a Hot-small row keeps its tier and an S row has none');
  assert.strictEqual(got.none, 'no history (n=0, need 3)', 'the template history message');
  assert.match(got.flag, /--tier must be one of small\|full/, 'the template --tier values');
}

test('the template core ships its default bindings', () => {
  checkDefaults(SCRIPTS);
});

test('mutant: a template tier list without Hot-small fails the defaults check', () => {
  const copy = tmp('estimate-defaults-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  const needle = "['trivial', 'hot-small', 'small', 'full', 'docs']";
  assert.strictEqual(before.split(needle).length - 1, 1);
  fs.writeFileSync(corePath, before.replace(needle, "['trivial', 'small', 'full', 'docs']"));
  assert.throws(() => checkDefaults(copy), /TIER_WORDS|Hot-small/);
});

test('CLI smoke: a log file gives the Gate 1 line, and a thin cohort says no history', () => {
  const dir = tmp('estimate-cli-');
  cleanup.push(dir);
  const log = path.join(dir, 'log.md');
  const rows = [60, 120, 180, 240].map((m, i) => `| EP-${i} | plan | Code | Full | work ${m}m · owner 30m | $${m / 10}.00 · Claude ${i + 1}% · Codex 1% | admitted 0 \\| x |`);
  fs.writeFileSync(log, ['# Harness log', '', '| Unit | Mode | Type | Tier | Elapsed | Cost | Scope |', '|---|---|---|---|---|---|---|', ...rows, ''].join('\n'));
  const res = runCli(SCRIPTS, ['--log', log, '--tier', 'full'], dir, cleanup);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(
    res.stdout.startsWith("Estimate per unit (full, n=4 units): work 1h45m–3h15m · owner wait 30m–30m · Claude 1.8–3.3% · Codex 1–1% — a range from this project's log, not a promise\n"),
    res.stdout,
  );
  const thin = runCli(SCRIPTS, ['--log', log, '--tier', 'full', '--cohort', '^EP-[01]$', '--json'], dir, cleanup);
  assert.strictEqual(thin.status, 0, thin.stderr);
  const j = JSON.parse(thin.stdout);
  assert.strictEqual(j.metrics.work.message, 'no history (n=2, need 3)');
  assert.match(j.line, /work no history \(n=2, need 3\)/);
});

test('CLI smoke: a missing log, a table-less file and a bad flag exit 2', () => {
  const dir = tmp('estimate-cli-');
  cleanup.push(dir);
  assert.strictEqual(runCli(SCRIPTS, ['--log', path.join(dir, 'no.md')], dir, cleanup).status, 2);
  fs.writeFileSync(path.join(dir, 'empty.md'), '# nothing\n');
  const none = runCli(SCRIPTS, ['--log', path.join(dir, 'empty.md')], dir, cleanup);
  assert.strictEqual(none.status, 2);
  assert.match(none.stderr, /usage: node scripts\/estimate\.mjs/);
  assert.strictEqual(runCli(SCRIPTS, ['--log', path.join(dir, 'empty.md'), '--tier', 'huge'], dir, cleanup).status, 2);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
