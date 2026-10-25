/**
 * Tests for the harness-bootstrap review-gate template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating named rules.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'review-gate-core.test.mjs');
const CORE_REL = path.join('lib', 'review-gate-core.mjs');
const WRAPPER_REL = 'review-gate.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 26;

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

/** Env without any GIT_* variable (an inherited hook environment never matters). */
function hermeticEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  return { ...env, ...extra };
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(scriptsDir, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(scriptsDir, TEST_REL)],
    { encoding: 'utf8', env: hermeticEnv(extraEnv), timeout: 120_000 }
  );
}

const cleanup = [];

/** Copy the shipped scripts, replace `needle` with `replacement` in the core, run the suite. */
function mutantRun(needle, replacement) {
  const copy = tmp('review-gate-mutant-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  const mutated = before.replace(needle, replacement);
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(corePath, mutated);
  const res = runSuite(copy);
  const out = res.stdout + res.stderr;
  assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
  assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
}

console.log('\nharness-bootstrap review-gate template');

test('the shipped review-gate suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
});

test('the suite is unaffected by GIT_DIR / GIT_INDEX_FILE of a caller repo (as inside a git hook)', () => {
  const decoy = tmp('review-gate-decoy-');
  cleanup.push(decoy);
  const run = (...args) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { cwd: decoy, env: hermeticEnv(), encoding: 'utf8' }
    );
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  run('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(decoy, 'f.txt'), 'x\n');
  run('add', '.');
  run('commit', '-q', '-m', 'base');
  const snapshot = () => [run('log', '--all', '--format=%H'), run('status', '--porcelain')];
  const before = snapshot();
  const res = runSuite(SCRIPTS, {
    GIT_DIR: path.join(decoy, '.git'),
    GIT_WORK_TREE: decoy,
    GIT_INDEX_FILE: path.join(decoy, '.git', 'index'),
  });
  // The suite must still pass and must not have written into the decoy repository.
  assert.strictEqual(tapCount(res.stdout + res.stderr, 'pass'), EXPECTED_TESTS);
  assert.deepStrictEqual(snapshot(), before, 'the suite wrote into the repository named by GIT_DIR');
});

test('mutant: a P3-only fix round that is no longer a sweep makes the suite fail', () => {
  mutantRun("maxFixed === 'P3')", "maxFixed === 'P3x')");
});

test('mutant: the database trigger matching every path makes the suite fail', () => {
  mutantRun('/\\.sql$/i,', '/./,');
});

test('mutant: critical code written by the second family no longer gets a Claude reviewer', () => {
  mutantRun("writer === 'codex' && critical.length === 0", "writer === 'codex'");
});

test('mutant: the FIX_LINES boundary moved by one makes the suite fail', () => {
  mutantRun('prodLines <= FIX_LINES', 'prodLines < FIX_LINES');
});

test('shipped files carry no machine paths', () => {
  const machinePath = new RegExp('/(Users|home)/[A-Za-z]');
  for (const rel of [WRAPPER_REL, CORE_REL, TEST_REL]) {
    const text = fs.readFileSync(path.join(SCRIPTS, rel), 'utf8');
    assert.ok(!machinePath.test(text), `${rel} contains a machine path`);
  }
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
