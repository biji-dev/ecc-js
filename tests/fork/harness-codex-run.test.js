/**
 * Tests for the harness-bootstrap codex-run template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the clamp and the wrapper.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'codex-run-core.test.mjs');
const CORE_REL = path.join('lib', 'codex-run-core.mjs');
const WRAPPER_REL = 'codex-run.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 54;

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
 * Env with a fresh HOME and CODEX_HOME and no CODEX_RUN* or GIT_* variable: the real quota and an
 * inherited hook environment never matter. `extra` is applied last (the decoy test sets GIT_*).
 */
function hermeticEnv(cleanup, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CODEX_RUN') || key.startsWith('GIT_')) delete env[key];
  }
  delete env.CODEX_BIN;
  env.HOME = tmp('codex-run-suite-home-');
  env.CODEX_HOME = tmp('codex-run-suite-codex-');
  cleanup.push(env.HOME, env.CODEX_HOME);
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

console.log('\nharness-bootstrap codex-run template');

test('the shipped codex-run suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
});

test('mutant: removing the clamp in resolveRoute makes the suite fail', () => {
  const copy = tmp('codex-run-mutant-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  // The clamp: an `ultra` effort without --allow-ultra is lowered to xhigh. Never lower it.
  const needle = "if (effort === 'ultra' && !opts.allowUltra) {";
  const mutated = before.replace(needle, "if (effort === 'ultra' && false) {");
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(corePath, mutated);
  const res = runSuite(copy, cleanup);
  const out = res.stdout + res.stderr;
  assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
  assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
});

test('mutant: dropping the frontier model gate makes the suite fail', () => {
  const copy = tmp('codex-run-mutant-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  const needle = "kind !== 'adversarial-frontier' && !opts.allowFrontier";
  const mutated = before.replace(needle, 'false');
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(corePath, mutated);
  const res = runSuite(copy, cleanup);
  assert.ok(tapCount(res.stdout + res.stderr, 'fail') > 0, 'the mutant suite still passed');
});

test('mutant: dropping the max clamp makes the suite fail', () => {
  const copy = tmp('codex-run-mutant-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  // The clamp: a `max` effort without --allow-max (or --allow-ultra) is lowered to xhigh.
  const needle = "if (effort === 'max' && !opts.allowMax && !opts.allowUltra) {";
  const mutated = before.replace(needle, "if (effort === 'max' && false) {");
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(corePath, mutated);
  const res = runSuite(copy, cleanup);
  assert.ok(tapCount(res.stdout + res.stderr, 'fail') > 0, 'the mutant suite still passed');
});

test('mutant: the wrapper ignoring the installed CLI (always `codex` on PATH) makes the suite fail', () => {
  const copy = tmp('codex-run-mutant-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const wrapperPath = path.join(copy, WRAPPER_REL);
  const before = fs.readFileSync(wrapperPath, 'utf8');
  const needle = 'codexBinary(process.env, os.homedir(), isExecutable)';
  const mutated = before.replace(needle, "'codex'");
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(wrapperPath, mutated);
  const res = runSuite(copy, cleanup);
  assert.ok(tapCount(res.stdout + res.stderr, 'fail') > 0, 'the mutant suite still passed');
});

test('mutant: the rule resolver run on the PATH node instead of the wrapper\'s own makes the suite fail', () => {
  const copy = tmp('codex-run-mutant-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const wrapperPath = path.join(copy, WRAPPER_REL);
  const before = fs.readFileSync(wrapperPath, 'utf8');
  const needle = 'execFileSync(process.execPath, [RULES_RESOLVER';
  const mutated = before.replace(needle, "execFileSync('node', [RULES_RESOLVER");
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(wrapperPath, mutated);
  const res = runSuite(copy, cleanup);
  assert.ok(tapCount(res.stdout + res.stderr, 'fail') > 0, 'the mutant suite still passed');
});

test('a suite run with GIT_DIR and GIT_INDEX_FILE set (as inside a git hook) leaves that repo untouched', () => {
  const decoy = tmp('codex-run-decoy-');
  cleanup.push(decoy);
  git(decoy, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(decoy, 'f.txt'), 'x\n');
  git(decoy, 'add', '.');
  git(decoy, 'commit', '-q', '-m', 'base');
  const snapshot = () => ({
    log: git(decoy, 'log', '--all', '--format=%H'),
    branches: git(decoy, 'branch', '--format=%(refname)'),
    worktrees: git(decoy, 'worktree', 'list', '--porcelain'),
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

test('mutant: a test that leaks a call to the PATH codex before the reach test fails the suite', () => {
  const copy = tmp('codex-run-mutant-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const testPath = path.join(copy, TEST_REL);
  const before = fs.readFileSync(testPath, 'utf8');
  const needle = "test('a run with no CODEX_BIN reaches the PATH stub";
  const leak = "test('leaky earlier test', () => { fs.appendFileSync(GUARD_MARKER, 'leak\\n'); });\n\n";
  const mutated = before.replace(needle, leak + needle);
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(testPath, mutated);
  const res = runSuite(copy, cleanup);
  const out = res.stdout + res.stderr;
  assert.notStrictEqual(res.status, 0, 'the leaky suite still passed');
  assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
  assert.match(out, /an earlier test called the PATH codex/);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
