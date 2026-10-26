/**
 * Tests for the harness-bootstrap unit-record template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'unit-record-core.test.mjs');
const CORE_REL = path.join('lib', 'unit-record-core.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 34;

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

/** Copy the shipped scripts, apply a one-line mutation to the core, and assert the suite fails. */
function mutantFails(name, needle, replacement) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('unit-record-mutant-');
    cleanup.push(copy);
    fs.cpSync(SCRIPTS, copy, { recursive: true });
    const corePath = path.join(copy, CORE_REL);
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

test('the draft log row has log-format.md\'s columns, in its order (Yield before Friction)', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'skills', 'harness-bootstrap', 'reference', 'log-format.md'), 'utf8');
  const columns = [];
  for (const line of doc.slice(doc.indexOf('| Unit · Mode · Type · Tier')).split('\n')) {
    if (!line.startsWith('| ')) break;
    columns.push(line.split(' | ')[0].replace(/^\| /, '').replace(/[*★]/g, '').trim());
  }
  const core = fs.readFileSync(path.join(SCRIPTS, CORE_REL), 'utf8');
  const row = /`\| \$\{cell\(unit\)\}.*\|`/.exec(core);
  assert.ok(row, 'the draft row template is in the core');
  const cells = row[0].slice(2, -2).split(' | ');
  assert.strictEqual(cells.length, columns.length, `${cells.length} cells for ${columns.length} columns`);
  assert.strictEqual(cells[columns.indexOf('Yield by source')], '${yieldCompact}');
  assert.match(cells[columns.indexOf('Friction')], /friction/);
  assert.match(cells[columns.indexOf('Missed by harness')], /missed by harness/);
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
