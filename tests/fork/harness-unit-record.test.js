/**
 * Tests for the harness-bootstrap unit-record template (skills/harness-bootstrap/templates/scripts):
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
const TEST_REL = path.join('lib', 'unit-record-core.test.mjs');
const CORE_REL = path.join('lib', 'unit-record-core.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 42;

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

/** Env with a fresh HOME and no GIT_* variable; `extra` is applied last (the decoy test sets GIT_*). */
function hermeticEnv(cleanup, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.HOME = tmp('unit-record-suite-home-');
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

/** Run git in `cwd` with only hermetic GIT_* variables; returns trimmed stdout. */
function git(cwd, ...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}

const cleanup = [];

/** Copy the shipped scripts, apply a one-line mutation to the core (or `fileRel`), and assert the suite fails. */
function mutantFails(name, needle, replacement, fileRel = CORE_REL) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('unit-record-mutant-');
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

console.log('\nharness-bootstrap unit-record template');

test('the shipped unit-record suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
});

// The four report cores' [B] bindings as one install rewrites them, [file, needle, replacement], each needle once
// in its file. The values need not agree across cores: each suite builds its own fixtures from the core it tests.
const MID = String.fromCodePoint(0xb7);
const STAR = String.fromCodePoint(0x2605);
const UNIT_RECORD_CORE = path.join('lib', 'unit-record-core.mjs');
const UNIT_RECORD_TEST = path.join('lib', 'unit-record-core.test.mjs');
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
  // unit-record-core.test: the suite's own [B] examples, rebound in the same edit as the core
  [UNIT_RECORD_TEST, "const SUMMARY_EXAMPLES = ['SUMMARY 3 passed, 1 failed, 0 skipped', 'SUMMARY 4 passed, 0 failed, 1 skipped (retry)'];", "const SUMMARY_EXAMPLES = ['All 3 stages passed in 12s.', 'All 4 stages passed in 9s.'];"],
  [UNIT_RECORD_TEST, "const AUDITOR_EXAMPLE = 'claim-check';", "const AUDITOR_EXAMPLE = 'spec-check';"],
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
  const copy = tmp('unit-record-rebound-');
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

mutantFails('counting a finding another source also reported as unique', 'f.also.length === 0 &&', 'true &&');
mutantFails('splitting a table row on an escaped pipe', "if (ch === '\\\\' && text[i + 1] === '|') {", "if (false && text[i + 1] === '|') {");
mutantFails('counting retracted findings in the severity totals', "if (f.status === 'retracted') continue;", 'if (false) continue;');
mutantFails('counting auditor-lane findings as defects', 'if (!AUDITOR_SOURCE.test(f.source)) {', 'if (true) {');
mutantFails('taking the first SUMMARY line instead of the last', 'all[all.length - 1][0].trim()', 'all[0][0].trim()');
mutantFails('dropping the first-heading fallback for the unit', "header.unit === '' && title !== null", "false && title !== null");
mutantFails('reading a two-column header table as nothing', 'kvTable = cells.length === 2;', 'kvTable = false;');
mutantFails('printing wall time as work time', 'wallMs - wait.ms', 'wallMs');
mutantFails('letting a newline in the cost line break the draft row', ".replace(/[\\r\\n]+/g, ' ')", '');
mutantFails('measuring a deliverable from the unit claim', 'h.deliverableStarted || h.claimed', 'h.claimed');
mutantFails('counting owner-wait pairs from before the deliverable started', 'if (Number.isFinite(since) && to <= since) continue;', '');
mutantFails('listing every commit instead of capping the list', 'commits.slice(0, MAX_COMMITS)', 'commits');
mutantFails('counting a step again on its later ledger rows', 'if (seen.has(id)) return `(${id} above)`;', '');
mutantFails('reading a Gate row as no step', ".replace(/^Gate (\\d+)(?=\\s|$)/i, 'g$1')", '');
mutantFails('leaving the open step without a time up to now', 'stepIntervals(markers, Date.parse(now))', 'stepIntervals(markers)');
mutantFails('dropping the Steps line', '...(times ? [`- Steps: ${times.line}`] : []),', '');
mutantFails('reading a bare 0 owner wait as unreadable', "if (term === '0') continue;", '');
mutantFails('ignoring the bound log columns', '${columns.map((name) => logCell(name, known)).join', '${LOG_COLUMNS.map((name) => logCell(name, known)).join');
mutantFails('ignoring --steps', "if (args.steps) steps = parseSteps(readFile(args.steps, 'steps file'));", '', 'unit-record.mjs');

/** The core's default LOG_COLUMNS are log-format.md's columns, in its order, and each one has a cell (Yield, Friction, Missed). */
function checkLogColumns(scriptsDir) {
  const doc = fs.readFileSync(path.join(ROOT, 'skills', 'harness-bootstrap', 'reference', 'log-format.md'), 'utf8');
  const columns = [];
  for (const line of doc.slice(doc.indexOf('| Unit · Mode · Type · Tier')).split('\n')) {
    if (!line.startsWith('| ')) break;
    columns.push(line.split(' | ')[0].replace(/^\| /, '').replace(/[*★]/g, '').trim());
  }
  const core = path.join(scriptsDir, CORE_REL);
  const probe = `
    import { LOG_COLUMNS, buildRecord, parseState } from ${JSON.stringify(pathToFileURL(core).href)};
    const state = parseState('Unit: U-1\\nClaimed: 2026-10-24T03:10:00Z\\n\\n## Findings\\n| ID | Sev | Source | Also | Status | Note |\\n|---|---|---|---|---|---|\\n| F-1 | P1 | codex-review | | fixed abc1234 | a |\\n');
    const rec = buildRecord({ state, commits: [], diffstat: '', gatesSummary: null, now: '2026-10-24T06:22:00Z' });
    const lines = rec.split('\\n');
    process.stdout.write(JSON.stringify({ columns: LOG_COLUMNS, row: lines[lines.indexOf('Draft log row:') + 1] }));
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', env: hermeticEnv(cleanup) });
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.deepStrictEqual(out.columns.map((c) => c.replace(/[*★]/g, '').trim()), columns);
  const cells = out.row.slice(2, -2).split(' | ');
  assert.strictEqual(cells.length, columns.length, `${cells.length} cells for ${columns.length} columns`);
  assert.strictEqual(cells[columns.indexOf('Yield by source')], 'codex-review 0/1/0');
  assert.match(cells[columns.indexOf('Friction')], /friction/);
  assert.match(cells[columns.indexOf('Missed by harness')], /missed by harness/);
  for (const [i, name] of columns.entries()) assert.ok(!cells[i].startsWith(`<fill: ${name}>`), `${name} has no cell of its own`);
}

test('the core\'s default LOG_COLUMNS are log-format.md\'s columns, in its order, and each one has a cell (Yield, Friction, Missed)', () => {
  checkLogColumns(SCRIPTS);
});

test('mutant: swapping the Yield and Friction columns of the draft row fails the LOG_COLUMNS check', () => {
  const copy = tmp('unit-record-columns-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  const mutated = before.replace("'Yield by source',\n  'Friction',", "'Friction',\n  'Yield by source',");
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(corePath, mutated);
  assert.throws(() => checkLogColumns(copy));
});

/** What the shipped suite no longer pins: it injects or imports the bound values, so the template's own are read here. */
function checkDefaults(scriptsDir) {
  const url = pathToFileURL(path.join(scriptsDir, CORE_REL)).href;
  const code = `import * as c from ${JSON.stringify(url)};
const state = c.parseState('Unit: U-1\\nClaimed: 2026-10-24T03:10:00Z\\nOwner wait: 20m\\nDeliverable: docs/x.md\\n\\n## Findings\\n| ID | Sev | Source | Also | Status |\\n|---|---|---|---|---|\\n| F-1 | P1 | codex-review | | fixed |\\n\\n## Ledger\\n| Step | Status | Evidence |\\n|---|---|---|\\n| 8 review | ran | ok |\\n');
const rec = c.buildRecord({ state, commits: [], diffstat: '', gatesSummary: null, now: '2026-10-24T06:22:00Z', cost: 'Cost $1.00' });
const lines = rec.split('\\n');
console.log(JSON.stringify({
  row: lines[lines.indexOf('Draft log row:') + 1],
  columns: c.LOG_COLUMNS.length,
  headings: [c.LEDGER_HEADING, c.FINDINGS_HEADING],
  found: [state.ledger.length, state.findings.length],
  maxCommits: c.MAX_COMMITS,
  auditor: ['conform-x', 'claim-y', 'lane-a', 'lane-c', 'codex-review'].map((x) => c.AUDITOR_SOURCE.test(x)),
  summary: [c.lastSummary('x\\nSUMMARY 1 passed, 0 failed, 0 skipped\\ny'), c.lastSummary('no summary here\\n  SUMMARY 1 passed, 0 failed, 0 skipped'), c.lastSummary('SUMMARY 1 passed, 0 failed, 0 skipped\\r\\nbye')],
}));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: hermeticEnv(cleanup) });
  assert.strictEqual(res.status, 0, res.stderr);
  const got = JSON.parse(res.stdout);
  const row = `| U-1 ${MID} ? ${MID} ? ${MID} ? | docs/x.md | 2h52m | 20m | 0/1 | <fill: scope counts> | <fill: gates as decided> | <fill: verdicts> | <fill: retries> | <fill: models as dispatched> | Cost $1.00 | <fill: missed by harness> | codex-review 0/1/0 | <fill: friction> |`;
  assert.strictEqual(got.row, row, 'the template draft row');
  assert.strictEqual(got.columns, 14, 'the template LOG_COLUMNS count');
  assert.deepStrictEqual(got.headings, ['ledger', 'findings'], 'the template headings');
  assert.deepStrictEqual(got.found, [1, 1], 'the template headings read the ledger and the findings');
  assert.strictEqual(got.maxCommits, 40, 'the template MAX_COMMITS');
  assert.deepStrictEqual(got.auditor, [true, true, true, true, false], 'the template AUDITOR_SOURCE');
  assert.deepStrictEqual(got.summary, ['SUMMARY 1 passed, 0 failed, 0 skipped', null, 'SUMMARY 1 passed, 0 failed, 0 skipped'], 'the template SUMMARY_LINE: unindented, anchored');
}

test('the template core ships its default bindings', () => {
  checkDefaults(SCRIPTS);
});

test('mutant: a template MAX_COMMITS of 41 fails the defaults check', () => {
  const copy = tmp('unit-record-defaults-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(before.split('export const MAX_COMMITS = 40;').length - 1, 1);
  fs.writeFileSync(corePath, before.replace('export const MAX_COMMITS = 40;', 'export const MAX_COMMITS = 41;'));
  assert.throws(() => checkDefaults(copy), /MAX_COMMITS/);
});

test('the SUMMARY_LINE rebound alone fails the [B] SUMMARY_LINE test', () => {
  const only = INSTALL.filter(([rel, needle]) => rel === UNIT_RECORD_CORE && needle.includes('SUMMARY_LINE'));
  assert.strictEqual(only.length, 1);
  const { res, out } = reboundRun(only);
  assert.notStrictEqual(res.status, 0, 'the suite still passed');
  assert.match(out, /^not ok \d+ - \[B\] the core's SUMMARY_LINE matches SUMMARY_EXAMPLES/m);
});

test('the AUDITOR_SOURCE rebound alone fails the [B] AUDITOR_SOURCE test', () => {
  const only = INSTALL.filter(([rel, needle]) => rel === UNIT_RECORD_CORE && needle.includes('AUDITOR_SOURCE'));
  assert.strictEqual(only.length, 1);
  const { res, out } = reboundRun(only);
  assert.notStrictEqual(res.status, 0, 'the suite still passed');
  assert.match(out, /^not ok \d+ - \[B\] the core's AUDITOR_SOURCE takes AUDITOR_EXAMPLE/m);
});

test('a suite run with GIT_DIR and GIT_INDEX_FILE set (as inside a git hook) leaves that repo untouched', () => {
  const decoy = tmp('unit-record-decoy-');
  cleanup.push(decoy);
  git(decoy, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(decoy, 'f.txt'), 'x\n');
  git(decoy, 'add', '.');
  git(decoy, 'commit', '-q', '-m', 'base');
  const snapshot = () => ({
    log: git(decoy, 'log', '--all', '--format=%H'),
    branches: git(decoy, 'branch', '--format=%(refname)'),
    status: git(decoy, 'status', '--porcelain'),
  });
  const before = snapshot();
  const res = runSuite(SCRIPTS, cleanup, {
    GIT_DIR: path.join(decoy, '.git'),
    GIT_WORK_TREE: decoy,
    GIT_INDEX_FILE: path.join(decoy, '.git', 'index'),
  });
  const out = res.stdout + res.stderr;
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS, out.slice(-1500));
  assert.deepStrictEqual(snapshot(), before, 'the suite wrote into the repository named by GIT_DIR');
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
