/**
 * Tests for the harness-bootstrap run-counted template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'run-counted-core.test.mjs');
const CORE_REL = path.join('lib', 'run-counted-core.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 16;

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

/**
 * Env with a fresh HOME and no GIT_* variable. NODE_OPTIONS and NODE_TEST_CONTEXT are dropped
 * too: the suite runs node's own test runner, which either would redirect or filter.
 */
function hermeticEnv(cleanup) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  env.HOME = tmp('run-counted-suite-home-');
  cleanup.push(env.HOME);
  return env;
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

/** Copy the shipped scripts, apply a one-line mutation to the core, and assert the suite fails. */
function mutantFails(name, needle, replacement) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('run-counted-mutant-');
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

console.log('\nharness-bootstrap run-counted template');

test('the shipped run-counted suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails(
  'hiding a second summary',
  'problems: hits.length > 1 ? [`${hits.length} ${kind} summary lines in the output (one expected)`] : [] };',
  'problems: [] };',
);
mutantFails('letting a skip through', "  'skipped',\n  'todo',", "  'todo',");
mutantFails('letting a flaky test through', "  'flaky',\n", '');
mutantFails('ignoring the node skip and todo markers', 'for (const m of summary.markers ?? [])', 'for (const m of [])');
mutantFails('reading the escapes instead of the text', 'const lines = (text) => stripAnsi(text).split(/\\r?\\n/);', 'const lines = (text) => String(text).split(/\\r?\\n/);');
mutantFails('trusting bun counters that do not add up to its Ran count', 'if (ran !== Number(hit[1])) counts.problems.push(', 'if (false) counts.problems.push(');
mutantFails('ignoring the floor', 'if (summary.passed < min) reasons.push(', 'if (false) reasons.push(');
mutantFails('ignoring the exit code', 'else if (exitCode !== 0) reasons.push(', 'else if (false) reasons.push(');
mutantFails("reading bun's summary from stdout", "bun: 'stderr'", "bun: 'stdout'");
mutantFails('reading an inherited key as a counter word', 'Object.hasOwn(words, m[2]) && words[m[2]]', 'words[m[2]]');
mutantFails('ignoring a --test flag in NODE_OPTIONS', "if (!/--test/.test(v)) return null;", 'return null;');

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
