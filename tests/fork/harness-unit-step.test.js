/**
 * Tests for the harness-bootstrap unit-step template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'unit-step-core.test.mjs');
const CORE_REL = path.join('lib', 'unit-step-core.mjs');
const CLI_REL = 'unit-step.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 13;

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

/** Env with a fresh HOME and no GIT_* variable. */
function hermeticEnv(cleanup) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.HOME = tmp('unit-step-suite-home-');
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

/** Copy the shipped scripts, apply a one-line mutation to the core (or `fileRel`), and assert the suite fails. */
function mutantFails(name, needle, replacement, fileRel = CORE_REL) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('unit-step-mutant-');
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

console.log('\nharness-bootstrap unit-step template');

test('the shipped unit-step suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('leaving the open step running past the next start', 'cur.implicit = true;\n        intervals.push(cur);', 'cur.implicit = true;');
mutantFails('turning a repeated start into a new interval', 'if (cur && cur.step === m.step && cur.round === m.round) {\n        problems.push', 'if (false) {\n        problems.push');
mutantFails('closing a step on a done for another round', '} else if (cur && cur.step === m.step && cur.round === m.round) {', '} else if (cur && cur.step === m.step) {');
mutantFails('sorting markers by file order instead of time', 'x.m.ts - y.m.ts || x.i - y.i', 'x.i - y.i');
mutantFails('accepting a path that climbs out of the steps directory in a unit id', "export const UNIT_ID_SOURCE = '[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)?';", "export const UNIT_ID_SOURCE = '[A-Za-z0-9.][A-Za-z0-9._-]*(?:/[A-Za-z0-9.][A-Za-z0-9._-]*)?';");
mutantFails('refusing a harness/<slug> unit id', "(?:/[A-Za-z0-9][A-Za-z0-9._-]*)?';", "';");
mutantFails('dropping the warning for a done with no start', "if (!open) return `no step is open, so done of ${label(next)} has no start`;", "if (!open) return '';");
mutantFails('refusing an out-of-order marker instead of appending it', 'if (warning) process.stderr.write', 'if (warning) return usage(warning);\n  if (warning) process.stderr.write', CLI_REL);

test('CLI smoke: a start and a done land in <dir>/<unit>.steps.jsonl and --list reads them back', () => {
  const root = tmp('unit-step-cli-');
  cleanup.push(root);
  const run = (args) =>
    spawnSync(process.execPath, [path.join(SCRIPTS, CLI_REL), ...args], { cwd: root, encoding: 'utf8', env: hermeticEnv(cleanup) });
  assert.strictEqual(run(['CR-9', '3', 'start', '--dir', root, '--at', '2026-10-26T02:00:00Z']).status, 0);
  assert.strictEqual(run(['CR-9', '3', 'done', '--dir', root, '--at', '2026-10-26T02:09:00Z']).status, 0);
  const list = run(['CR-9', '--list', '--dir', root]);
  assert.strictEqual(list.status, 0, list.stderr);
  assert.match(list.stdout, /^3 r1 +2026-10-26 02:00 → 02:09 {2}9m$/m);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
