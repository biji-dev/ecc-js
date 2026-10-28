/**
 * Tests for the harness-bootstrap harness-due template (skills/harness-bootstrap/templates/scripts):
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
const TEST_REL = path.join('lib', 'harness-due-core.test.mjs');
const CORE_REL = path.join('lib', 'harness-due-core.mjs');
const CLI_REL = 'harness-due.mjs';
const GATHER_REL = path.join('lib', 'retro-gather.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 25;

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

/** Env with a fresh HOME, no GIT_* variable and no global git config. */
function hermeticEnv(cleanup, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.HOME = tmp('harness-due-suite-home-');
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  cleanup.push(env.HOME);
  return { ...env, ...extra };
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(scriptsDir, cleanup) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(scriptsDir, TEST_REL)],
    { encoding: 'utf8', env: hermeticEnv(cleanup), timeout: 120_000 },
  );
}

const cleanup = [];

/** Copy the shipped scripts, apply a one-line mutation to the core (or `fileRel`), and assert the suite fails. */
function mutantFails(name, needle, replacement, fileRel = CORE_REL) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('harness-due-mutant-');
    cleanup.push(copy);
    fs.cpSync(SCRIPTS, copy, { recursive: true });
    const filePath = path.join(copy, fileRel);
    const before = fs.readFileSync(filePath, 'utf8');
    const mutated = before.replace(needle, replacement);
    assert.notStrictEqual(mutated, before, 'the mutation did not apply');
    fs.writeFileSync(filePath, mutated);
    const res = runSuite(copy, cleanup);
    const out = res.stdout + res.stderr;
    assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
    assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
  });
}

console.log('\nharness-bootstrap harness-due template');

test('the shipped harness-due suite passes with the pinned test count', () => {
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
const DUE_TEST = path.join('lib', 'harness-due-core.test.mjs');
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
  // the suite's [B] block: how the fixtures spell a row id, and an example of the phase PHASE_OF gives one
  [DUE_TEST, "const ROW = (p, n) => `P${p}-${String(n).padStart(2, '0')}`;", 'const ROW = (p, n) => `M${p}.${n}`;'],
  [DUE_TEST, "const PHASE_EXAMPLE = [ROW(2, 16), 'P2'];", "const PHASE_EXAMPLE = [ROW(2, 16), 'M2'];"],
];

/** Copy the shipped scripts, apply each rebinding (each needle exactly once), run the suite. */
function reboundRun(rebindings) {
  const copy = tmp('harness-due-rebound-');
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

/** What the shipped suite no longer pins (it reads the bound values): the template's own, read from its core. */
function checkDefaults(scriptsDir) {
  const url = pathToFileURL(path.join(scriptsDir, CORE_REL)).href;
  const code = `import * as c from ${JSON.stringify(url)};
console.log(JSON.stringify({
  main: c.MAIN,
  log: c.LOG,
  followUps: c.FOLLOW_UPS,
  reports: c.REPORTS,
  phases: ['P2-16', 'EP-27.04', 'p3-12a', 'T-DATA-037', 'CR-021', 'P2'].map((id) => c.phaseOf(id)),
  cadence: c.CADENCE,
  p3: c.P3_AGE_DAYS,
  disk: c.DISK_MIN_GB,
  idle: c.WORKTREE_IDLE_HOURS,
  rebuildable: ['node_modules/', 'dist', '.next/', 'coverage', '.husky/_', '.DS_Store', 'x.tsbuildinfo', '.env.local', 'src/'].map((p) => c.REBUILDABLE.test(p)),
}));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: hermeticEnv(cleanup) });
  assert.strictEqual(res.status, 0, res.stderr);
  const got = JSON.parse(res.stdout);
  assert.strictEqual(got.main, 'main', 'the template MAIN');
  assert.strictEqual(got.log, 'docs/harness/log.md', 'the template LOG');
  assert.strictEqual(got.followUps, 'docs/harness/follow-ups.md', 'the template FOLLOW_UPS');
  assert.deepStrictEqual(
    got.reports,
    {
      preflight: 'docs/harness/reports/preflight-<phase>.md',
      sweep: 'docs/harness/reports/sweep-<date>.md',
      retro: 'docs/harness/reports/retro-<week>.md',
      hygiene: 'docs/harness/reports/hygiene-<date>.md',
    },
    'the template REPORTS',
  );
  assert.deepStrictEqual(got.phases, ['P2', 'EP-27', 'p3', null, null, null], 'the template PHASE_OF');
  assert.deepStrictEqual(got.cadence, { sweep: { days: 7, landings: 5 }, retro: { days: 7, landings: null }, hygiene: { days: 14, landings: 5 } }, 'the template CADENCE');
  assert.strictEqual(got.p3, 14, 'the template P3_AGE_DAYS');
  assert.strictEqual(got.disk, 25, 'the template DISK_MIN_GB');
  assert.strictEqual(got.idle, 6, 'the template WORKTREE_IDLE_HOURS');
  assert.deepStrictEqual(got.rebuildable, [true, true, true, true, true, true, true, false, false], 'the template REBUILDABLE');
}

test('the template core ships its default bindings', () => {
  checkDefaults(SCRIPTS);
});

test('mutant: a template P3_AGE_DAYS of 15 fails the defaults check', () => {
  const copy = tmp('harness-due-defaults-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(before.split('export const P3_AGE_DAYS = 14;').length - 1, 1);
  fs.writeFileSync(corePath, before.replace('export const P3_AGE_DAYS = 14;', 'export const P3_AGE_DAYS = 15;'));
  assert.throws(() => checkDefaults(copy), /P3_AGE_DAYS/);
});

/** The template with only these bindings changed: the shipped suite must pass, with its pinned count. */
function passesRebound(rebindings) {
  const { res, out } = reboundRun(rebindings);
  const failing = out.match(/^not ok .*$/gm) ?? [];
  assert.strictEqual(res.status, 0, `rebound: ${failing.length} failing, first: ${failing.slice(0, 3).join(' | ')}\n${out.slice(-1200)}`);
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1200));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
}

test('the shipped suite passes with a sweep cadence of 14 days, whose fixture dates run into the next month', () => {
  passesRebound([[DUE_CORE, '  sweep: { days: 7, landings: 5 },', '  sweep: { days: 14, landings: 5 },']]);
});

// An install with no phases: PHASE_OF gives none, so no preflight is ever due. The report path may stay bound or be null.
const NO_PHASES = [
  [DUE_CORE, 'export const PHASE_OF = /^([A-Za-z]+-?\\d+)[-.]\\w/;', 'export const PHASE_OF = () => null;'],
  [DUE_TEST, "const PHASE_EXAMPLE = [ROW(2, 16), 'P2'];", 'const PHASE_EXAMPLE = [ROW(2, 16), null];'],
];

test('the shipped suite passes for an install with no phases and no preflight report bound', () => {
  passesRebound([...NO_PHASES, [DUE_CORE, "  preflight: 'docs/harness/reports/preflight-<phase>.md',", '  preflight: null,']]);
});

test('the shipped suite passes for an install with no phases and a preflight report path still bound', () => {
  passesRebound(NO_PHASES);
});

test('the core\'s PHASE_OF rebound alone fails the [B] PHASE_OF test', () => {
  const only = INSTALL.filter(([rel, needle]) => rel === DUE_CORE && needle.startsWith('export const PHASE_OF'));
  assert.strictEqual(only.length, 1);
  const { res, out } = reboundRun(only);
  assert.notStrictEqual(res.status, 0, 'the suite still passed');
  assert.match(out, /^not ok \d+ - \[B\] PHASE_OF gives PHASE_EXAMPLE its phase/m);
});

mutantFails('blocking a phase that a merge already opened', 'const opens = rows === 0 && merged === 0;', 'const opens = rows === 0;');
mutantFails('matching a preflight report by case', '.some((r) => path.posix.basename(r.rel).toLowerCase() === want)', '.some((r) => path.posix.basename(r.rel) === want)');
mutantFails('counting landings from the log rows alone', 'const landings = Math.max(after(landed), after(merged));', 'const landings = after(landed);');
mutantFails('dropping the P3 queue from the hygiene line', "note: kind === 'hygiene' ? p3Note(summary) : ''", "note: ''");
mutantFails('taking a dirty worktree for residue', 'w.merged && w.own && w.clean)', 'w.merged && w.own)');
mutantFails('taking a branch with no commits of its own for residue', 'w.merged && w.own && w.clean)', 'w.merged && w.clean)');
mutantFails('losing an ignored file that is not rebuildable', '.every((p) => rebuildable.test(p))', '.every(() => true)');
mutantFails('counting an ignored link as a file it would lose', ".filter((p) => !isLink(path.join(w.path, p.replace(/\\/$/, ''))))", '', CLI_REL);
mutantFails('reading a fast-forwarded branch as one cut and never started', 'const own = merged && (!mainline.has(w.head) || moved);', 'const own = merged && !mainline.has(w.head);', CLI_REL);
mutantFails('matching a project name inside a longer one', '${esc(project)}(?![A-Za-z0-9_-])', '${esc(project)}');
mutantFails('moving a seen week backward', "if (!(typeof out[project] === 'string' && out[project] >= week)) out[project] = week;", 'out[project] = week;');
mutantFails('counting a report no commit holds by its file time', 'found.filter((r) => times.has(r.rel)).map((r) => ({ rel: r.rel, time: times.get(r.rel) }))', 'found.map((r) => ({ rel: r.rel, time: times.get(r.rel) ?? mtime(path.join(top, r.rel)) }))', CLI_REL);
mutantFails("counting a landed branch's merge of the mainline as a landing", "'--merges', '--first-parent', ", "'--merges', ", CLI_REL);
mutantFails('dating a line not committed yet by the time of the blame', 'committed ? time : null', 'time', GATHER_REL);
mutantFails('counting every merge subject as naming a function-bound phase', '.some((token) => phaseOf(token, pattern)?.toLowerCase() === phase.toLowerCase())', '.some(() => true)');
mutantFails('reading only separator-joined words of a merge subject as ids', 'const ID_TOKEN = /[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/g;', 'const ID_TOKEN = /[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)+/g;');
mutantFails('exiting 0 when the claim is blocked', 'if (blocking) process.exitCode = 1;', '', CLI_REL);

test('the shipped suite never skips: bound to no preflight and a 72 h idle time it still passes with skipped 0 and todo 0', () => {
  const copy = tmp('harness-due-binding-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const file = path.join(copy, CORE_REL);
  const before = fs.readFileSync(file, 'utf8');
  const bound = before
    .replace("preflight: 'docs/harness/reports/preflight-<phase>.md',", 'preflight: null,')
    .replace('WORKTREE_IDLE_HOURS = 6;', 'WORKTREE_IDLE_HOURS = 72;');
  assert.ok(bound.includes('preflight: null,') && bound.includes('WORKTREE_IDLE_HOURS = 72;'), 'the binding did not apply');
  fs.writeFileSync(file, bound);
  const res = runSuite(copy, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'skipped'), 0, out.slice(-800));
  assert.strictEqual(tapCount(out, 'todo'), 0, out.slice(-800));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
});

test('the COMMANDS defaults cite the references that hold the procedures, not skills nothing generates', () => {
  const text = fs.readFileSync(path.join(SCRIPTS, CORE_REL), 'utf8');
  const block = /^export const COMMANDS = \{\n([\s\S]*?)^\};/m.exec(text);
  assert.ok(block, 'no COMMANDS block in the core');
  const lines = block[1].split('\n');
  const line = (kind) => lines.find((l) => l.trim().startsWith(`${kind}:`)) ?? '';
  for (const word of ['phase-preflight', 'workstream-sweep', 'task-runner']) assert.ok(!block[1].includes(word), `COMMANDS still names ${word}`);
  for (const [kind, reference] of [['preflight', 'preflight'], ['sweep', 'sweep'], ['hygiene', 'hygiene'], ['p3', 'hygiene']]) {
    assert.ok(line(kind).includes(`harness-bootstrap\\'s reference/${reference}.md`), `COMMANDS.${kind} does not cite reference/${reference}.md: ${line(kind)}`);
  }
  assert.match(text, /bind each one to the project's own skill/, 'the comment does not say to bind each to the project\'s own skill');
});

test('CLI smoke: claiming the first row of a phase with no preflight report exits 1 and names the report', () => {
  const repo = tmp('harness-due-cli-');
  cleanup.push(repo);
  const env = hermeticEnv(cleanup, { GIT_AUTHOR_DATE: '2026-10-20T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-20T10:00:00Z' });
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
  };
  git(['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(repo, 'docs', 'harness'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'harness', 'log.md'), '| Unit · Mode · Type · Tier | Elapsed (work) | Cost |\n|---|---|---|\n| P1-01 · plan · Code · Small | 60m | $1 |\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'log']);
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, CLI_REL), '--claim', 'P2-01', '--home', repo, '--now', '2026-10-21T10:00:00Z'], { cwd: repo, encoding: 'utf8', env });
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /^DUE preflight P2 — no report at docs\/harness\/reports\/preflight-P2\.md, and P2-01 opens the phase: the claim waits for it — /m);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
