/**
 * Tests for the harness-bootstrap review-gate template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating named rules.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'review-gate-core.test.mjs');
const CORE_REL = path.join('lib', 'review-gate-core.mjs');
const WRAPPER_REL = 'review-gate.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 62;

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
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

/** The core's [B] block rebound the way installs do, and the test's [B] block kept matching it. */
const REBOUND_CRITICAL = 'export const CRITICAL = [/^src\\/(core|ui)\\//, /(^|\\/)AGENTS\\.md$/];';
const CORE_CRITICAL = [CORE_REL, 'export const CRITICAL = [];', REBOUND_CRITICAL];
const REBINDINGS = [
  CORE_CRITICAL,
  [CORE_REL, "'security-reviewer': [/auth|session|token|crypto|permission|rbac|tenant|webhook|public/i],", "'security-reviewer': [/./],"],
  [CORE_REL, '/\\.(test|spec)\\.[cm]?[jt]sx?$/]; // paths that are not production', '/\\.(test|spec)\\.[cm]?[jt]sx?$/, /^scripts\\//]; // paths that are not production'],
  [CORE_REL, '/\\.(test|spec)\\.[cm]?[jt]sx?$/]; // paths that count as tests', '/\\.(test|spec)\\.[cm]?[jt]sx?$/, /(^|\\/)\\.maestro\\//]; // paths that count as tests'],
  [CORE_REL, 'export const FIX_LINES = 40;', 'export const FIX_LINES = 25;'],
  [TEST_REL, 'const EXPECTED_CRITICAL = [];', REBOUND_CRITICAL.replace('export const CRITICAL', 'const EXPECTED_CRITICAL')],
];

/** Copy the shipped scripts, apply each rebinding (each needle exactly once), run the suite. */
function reboundRun(rebindings) {
  const copy = tmp('review-gate-rebound-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  for (const [rel, needle, replacement] of rebindings) {
    const file = path.join(copy, rel);
    const before = fs.readFileSync(file, 'utf8');
    assert.strictEqual(before.split(needle).length - 1, 1, `${needle} is not in ${rel} exactly once`);
    fs.writeFileSync(file, before.replace(needle, () => replacement));
  }
  const res = runSuite(copy);
  return { res, out: res.stdout + res.stderr };
}

test('the shipped suite passes with the core\'s bindings rebound as an install binds them', () => {
  const { res, out } = reboundRun(REBINDINGS);
  const failing = out.match(/^not ok .*$/gm) ?? [];
  assert.strictEqual(res.status, 0, `rebound: ${failing.length} failing, first: ${failing.slice(0, 3).join(' | ')}\n${out.slice(-1200)}`);
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1200));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

test('the core\'s CRITICAL rebound alone fails exactly one test: the [B] CRITICAL test', () => {
  const { out } = reboundRun([CORE_CRITICAL]);
  const failing = out.match(/^not ok .*$/gm) ?? [];
  assert.strictEqual(failing.length, 1, `expected one failing test, got ${failing.length}: ${failing.join(' | ')}`);
  assert.match(failing[0], /^not ok \d+ - \[B\] the core's CRITICAL is EXPECTED_CRITICAL/);
});

// the paths the template's NON_PRODUCTION must keep out of production
const NINE = ['README.md', 'docs/x.ts', 'src/__tests__/a.ts', 'tests/a.js', 'test/a.js', 'e2e/a.ts', 'src/fixtures/a.json', 'src/a.test.ts', 'src/a.spec.mjs'];
/** The template core's default bindings, read in a child process (the shipped suite no longer pins them). */
function checkDefaults(scriptsDir) {
  const url = pathToFileURL(path.join(scriptsDir, CORE_REL)).href;
  const paths = { db: ['db/migrations/001_init.sql', 'src/db/schema.ts', 'src/ui/panel.tsx', 'src/a.ts'], production: ['src/a.ts', ...NINE] };
  const code = `import * as c from ${JSON.stringify(url)};
const p = ${JSON.stringify(paths)};
console.log(JSON.stringify({
  critical: c.CRITICAL.length,
  triggers: Object.keys(c.TRIGGERS),
  db: p.db.map((x) => c.TRIGGERS['database-reviewer'].some((re) => re.test(x))),
  fixLines: c.FIX_LINES,
  production: p.production.map(c.isProduction),
}));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: hermeticEnv() });
  assert.strictEqual(res.status, 0, res.stderr);
  const got = JSON.parse(res.stdout);
  assert.strictEqual(got.critical, 0, 'the template CRITICAL is not empty');
  assert.deepStrictEqual(got.triggers, ['security-reviewer', 'silent-failure-hunter', 'database-reviewer'], 'the template TRIGGERS keys');
  assert.deepStrictEqual(got.db, [true, true, false, false], `database-reviewer matches ${paths.db.join(', ')} as ${got.db.join(', ')}`);
  assert.strictEqual(got.fixLines, 40, 'the template FIX_LINES');
  assert.deepStrictEqual(got.production, [true, ...NINE.map(() => false)], `production: ${paths.production.join(', ')} as ${got.production.join(', ')}`);
}

test('the template core ships its default bindings', () => {
  checkDefaults(SCRIPTS);
});

test('mutant: the database trigger matching every path fails the defaults check', () => {
  const copy = tmp('review-gate-defaults-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  const mutated = before.replace('/\\.sql$/i,', '/./,');
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(corePath, mutated);
  assert.throws(() => checkDefaults(copy), /database-reviewer matches/);
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

test('mutant: a P3-only fix round that is no longer the P3 batch makes the suite fail', () => {
  mutantRun("maxFixed === 'P3')", "maxFixed === 'P3x')");
});

test('mutant: a P3 batch over critical code by Sonnet or the second family is the P3 batch again, read by nobody', () => {
  mutantRun("if (critical.length > 0 && writer !== 'claude')", 'if (false)');
});

test('mutant: the P3 batch\'s writer check dropped, so Opus\'s own batch gets the Opus reviewer too', () => {
  mutantRun("if (critical.length > 0 && writer !== 'claude')", 'if (critical.length > 0)');
});

test('mutant: critical code written by the second family no longer gets a Claude reviewer', () => {
  mutantRun('secondFamilyWrote(writer) && critical.length === 0', 'secondFamilyWrote(writer)');
});

test('mutant: a default writer comes back, so a cold Codex slice run without --writer is not caught', () => {
  mutantRun("tier = 'full', writer, maxFixed", "tier = 'full', writer = 'claude', maxFixed");
});

test('mutant: writer mixed no longer routes like the second family', () => {
  mutantRun("writer === 'codex' || writer === 'mixed'", "writer === 'codex'");
});

test('mutant: critical code written by Sonnet no longer gets an Opus reviewer', () => {
  mutantRun("if (writer !== 'claude' && critical.length > 0) {", "if (secondFamilyWrote(writer) && critical.length > 0) {");
});

test('mutant: a family name on a Codex, ZCode or Kimi host is no longer refused, so it routes as Claude Code\'s', () => {
  mutantRun('WRITERS.includes(writer) && !FAMILY_HOSTS.includes(host)', 'WRITERS.includes(writer) && false');
});

test('mutant: a missing or unknown --writer falls through to decide()\'s message, which names refused family names', () => {
  mutantRun('  if (WRITERS.includes(writer)) return writer;\n', '  return writer;\n');
});

test('mutant: the small-unit reason prints the routing value again, naming the wrong family off Claude Code', () => {
  mutantRun('small unit written by ${WRITER_NAMES[writer]}', 'small unit written by ${writer}');
});

test('mutant: the FIX_LINES boundary moved by one makes the suite fail', () => {
  mutantRun('prodLines <= FIX_LINES', 'prodLines < FIX_LINES');
});

test('mutant: critical computed over production files only, so a test under a critical path is cold again', () => {
  mutantRun('const critical = reviewed.filter(', 'const critical = prod.filter(');
});

test('mutant: the skip back to "no production file", so a tests-only diff owes no reviewer', () => {
  mutantRun('const docsOnly = reviewed.length === 0;', 'const docsOnly = prod.length === 0;');
});

test('mutant: isProduction ignoring INSTRUCTIONS, so AGENTS.md and .claude/ are docs again', () => {
  mutantRun('(isInstruction(path) ? !isTest(path) : !isExempt(path))', '!isExempt(path)');
});

test('mutant: a test in an instruction directory counted as production again, so its lines make a fix large', () => {
  mutantRun('(isInstruction(path) ? !isTest(path) : !isExempt(path))', 'isInstruction(path) || !isExempt(path)');
});

test('mutant: critical code at --tier small no longer escalates to the full lineup', () => {
  mutantRun("const escalate = tier === 'small' && critical.length > 0;", 'const escalate = false;');
});

test('mutant: the specialists matching an instruction file\'s prose makes the suite fail', () => {
  mutantRun('files.some((f) => !isExempt(f.path) && TRIGGERS', 'files.some((f) => isProduction(f.path) && TRIGGERS');
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
