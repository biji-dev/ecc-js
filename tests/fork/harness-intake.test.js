/**
 * Tests for the harness-bootstrap intake template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'intake-core.test.mjs');
const CORE_REL = path.join('lib', 'intake-core.mjs');
const CLI_REL = 'intake.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 18;

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
  env.HOME = tmp('intake-suite-home-');
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
    const copy = tmp('intake-mutant-');
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

console.log('\nharness-bootstrap intake template');

test('the shipped intake suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('putting a T card on the owner sheet', "if (c.cls !== 'P' && c.cls !== 'C') {", 'if (false) {');
mutantFails('counting a Demo: label with nothing after it', 'const DEMO = /\\bDemo:\\s+\\S/;', 'const DEMO = /Demo:/;');
mutantFails('letting the next unit\'s Scope block overwrite the first', 'if (fields.has(label)) break;', '');
mutantFails('reading the first Approved: line instead of the last', 'lines.at(-1).match(APPROVED)', 'lines[0].match(APPROVED)');
mutantFails('taking a default for the owner\'s approval', "if (a.by !== 'owner')", 'if (false)');
mutantFails('missing a re-tier since the approval', "if (a.tier && (st.Tier ?? '').toLowerCase() !== a.tier.toLowerCase())", 'if (false)');
mutantFails('trusting the request\'s block without the state file\'s', 'else if (a.scope && own.hash !== a.scope)', 'else if (false)');
mutantFails('missing a request edited after its approval', 'if (scope && approval.scope && !scopeSame) {', 'if (false) {');
mutantFails('missing an edit outside the Scope block after the approval', 'a.request && now !== a.request ?', 'false ?');
mutantFails('dropping leading whitespace from the request sha', 'map((l) => l.trimEnd())', 'map((l) => l.trim())');
mutantFails('testing the capture and the cards for stray questions', 'if (capture.has(i) || covered.has(i)) return;', '');
mutantFails('taking a section heading for the title above the capture', 'const TITLE = /^\\s*#\\s/;', 'const TITLE = /^\\s*#{1,6}\\s/;');
mutantFails('counting an empty Scope label as present', 'empty: REQUIRED.filter((l) => fields.has(l) && !squash(fields.get(l))),', 'empty: [],');
mutantFails('exiting 0 when the owner decides Gate 1', 'if (!result.auto) process.exitCode = 1;', '', CLI_REL);

test('CLI smoke: a ready draft, then the approved unit 1 gets an automatic Gate 1', () => {
  const dir = tmp('intake-cli-');
  cleanup.push(dir);
  const scope = 'In scope: the CSV download\nOut of scope: filters\nDone when: the export test passes';
  const card = 'Q-1 · P · Which columns?\nRecommend: A — what the list shows\n  A the visible ones — reversal cost: edit + tests\n  B all — reversal cost: edit + tests\nDefault if unanswered: A';
  const draft = `# Toy\n\n1. CSV — Demo: /orders → Export → a file opens\n\n${card}\n\nNever-auto: none\nRisk map: none\nEstimate: no history (n=0, need 3)\n\n${scope}\n`;
  fs.writeFileSync(path.join(dir, 'req.md'), draft);
  const check = spawnSync(process.execPath, [path.join(SCRIPTS, CLI_REL), '--check', path.join(dir, 'req.md')], { encoding: 'utf8' });
  assert.strictEqual(check.status, 0, check.stdout + check.stderr);
  const sha = check.stdout.match(/ sha ([0-9a-f]{8})$/m)[1];
  const req = check.stdout.match(/^request — sha ([0-9a-f]{8})$/m)[1];
  fs.writeFileSync(path.join(dir, 'req.md'), `${draft}\nApproved: 2026-10-27 · owner · toy/DEC-1 · unit toy-1 · tier Small · scope ${sha} · request ${req}\n`);
  fs.writeFileSync(path.join(dir, 'toy-1.state.md'), `Unit: toy-1\nTier: Small\n\n## Scope\n\n${scope}\n`);
  const g1 = spawnSync(process.execPath, [path.join(SCRIPTS, CLI_REL), '--gate1', path.join(dir, 'req.md'), '--state', path.join(dir, 'toy-1.state.md')], { encoding: 'utf8' });
  assert.strictEqual(g1.status, 0, g1.stdout + g1.stderr);
  assert.match(g1.stdout, new RegExp(`^Gate 1: auto — .*req\\.md approved 2026-10-27 by the owner \\(toy/DEC-1\\) for toy-1 at Small; the request and its Scope block are unchanged \\(request ${req}, scope ${sha}\\)$`, 'm'));
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
