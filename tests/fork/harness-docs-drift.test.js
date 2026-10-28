/**
 * Tests for the harness-bootstrap docs-drift template (skills/harness-bootstrap/templates/scripts):
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
const TEST_REL = path.join('lib', 'docs-drift-core.test.mjs');
const CORE_REL = path.join('lib', 'docs-drift-core.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 29;

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

/** Env with no GIT_* variable: an inherited hook environment never reaches the suite's fixture repos. */
function hermeticEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return env;
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(scriptsDir) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(scriptsDir, TEST_REL)],
    { encoding: 'utf8', env: hermeticEnv(), timeout: 120_000 },
  );
}

const cleanup = [];

/** Copy the shipped scripts, replace `needle` in the core (or fail), return the suite result. */
function runMutant(needle, replacement) {
  const copy = tmp('docs-drift-mutant-');
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

console.log('\nharness-bootstrap docs-drift template');

test('the shipped docs-drift suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
});

/** The shipped suite reads whatever a project binds, so the template's own bindings are checked here. */
test('the template core ignores every lockfile name, bun.lock included, and counts decide as generic', () => {
  const url = pathToFileURL(path.join(SCRIPTS, CORE_REL)).href;
  const code = `import * as c from ${JSON.stringify(url)}; console.log(JSON.stringify({ ignore: c.IGNORE_TOKENS, generic: c.GENERIC }));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: hermeticEnv() });
  assert.strictEqual(res.status, 0, res.stderr);
  const got = JSON.parse(res.stdout);
  assert.deepStrictEqual(got.ignore, ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'tsconfig.json'], 'the template IGNORE_TOKENS');
  assert.deepStrictEqual(got.generic, ['index', 'main', 'utils', 'types', 'config', 'default', 'test', 'README', 'decide'], 'the template GENERIC: decide is an export of the review gate core');
});

test('mutant: dropping the word boundary on identifiers makes the suite fail', () => {
  // getUser would match getUsers, $getUser and my_getUser_x.
  runMutant('`(?<![\\\\w$])${escapeRe(t.token)}(?![\\\\w$])`', '`${escapeRe(t.token)}`');
});

test('mutant: no longer skipping documents the diff edited makes the suite fail', () => {
  runMutant('if (!includeChanged && changed.has(doc.path)) continue;', 'if (false) continue;');
});

test('mutant: ** no longer matching zero directories makes the suite fail', () => {
  runMutant("re += '(?:.*/)?';", "re += '(?:.*/)';");
});

test('mutant: searching identifiers shorter than MIN_IDENT makes the suite fail', () => {
  runMutant('name.length >= MIN_IDENT && ', '');
});

test('mutant: tokens for purely added exports make the suite fail', () => {
  runMutant("side === 'removed' && ", '');
});

test('mutant: edited documents becoming tokens makes the suite fail', () => {
  runMutant('if (isDoc(p) && !deleted.has(p)) continue;', 'if (false) continue;');
});

test('mutant: basename tokens without --basenames make the suite fail', () => {
  runMutant('if (basenames && !GENERIC', 'if (!GENERIC');
});

test('mutant: a deleted document no longer being a token makes the suite fail', () => {
  runMutant('if (isDoc(p) && !deleted.has(p)) continue;', 'if (isDoc(p)) continue;');
});

test('mutant: an uncapped report makes the suite fail', () => {
  runMutant('.slice(0, max)', '.slice(0)');
});

test('mutant: --strict never exiting 1 makes the suite fail', () => {
  const copy = tmp('docs-drift-mutant-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const wrapperPath = path.join(copy, 'docs-drift.mjs');
  const before = fs.readFileSync(wrapperPath, 'utf8');
  const mutated = before.replace('a.strict && mentions.length > 0', 'false');
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(wrapperPath, mutated);
  const res = runSuite(copy);
  assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
  assert.ok(tapCount(res.stdout + res.stderr, 'fail') > 0);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
