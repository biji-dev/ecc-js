/**
 * Tests for the harness-bootstrap retro template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'retro-core.test.mjs');
const CORE_REL = path.join('lib', 'retro-core.mjs');
const SOURCES_REL = path.join('lib', 'run-sources.mjs');
const CLI_REL = 'retro.mjs';

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

/** Env with a fresh HOME and no GIT_* variable. */
function hermeticEnv(cleanup) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.HOME = tmp('retro-suite-home-');
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
    const copy = tmp('retro-mutant-');
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

console.log('\nharness-bootstrap retro template');

test('the shipped retro suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('reading "none (owner, Gate 2)" as a missed finding', 'const EMPTY = /^(?:|none|nothing|n\\/a|-|—|–)(?:[\\s.,;:]*\\(.*\\))?[\\s.]*$/i;', 'const EMPTY = /^(?:|—)$/;');
mutantFails('filling the candidates from the first source', 'for (let i = 0; out.length < MAX_CANDIDATES && sources.some((s) => s.length > i); i++) {\n    for (const s of sources) if (s[i] && out.length < MAX_CANDIDATES) out.push(s[i]);\n  }', 'for (const x of sources.flat()) if (out.length < MAX_CANDIDATES) out.push(x);');
mutantFails('flagging a step under MIN_SHARE', 'x.share >= MIN_SHARE && ', '');
mutantFails('starting the week on Sunday', 'd.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3', 'd.getUTCDate() - d.getUTCDay() + 3');
mutantFails("starting the window at this week's own digest", '.filter((p) => p.week !== week && Date.parse(p.until) < end)', '.filter((p) => Date.parse(p.until) < end)');
mutantFails("taking a sibling repository's sessions", 'if (cwd === null || !inside(cwd)) continue;', 'if (cwd === null) continue;', SOURCES_REL);
mutantFails('giving an overlapping turn to the unit that started first', 'if (iv && !(best.get(id(r))?.start >= iv.start))', 'if (iv && !best.has(id(r)))');
mutantFails("charging a unit for another unit's dispatch", 'const claimed = claimRows(spans, dispatchOwners(agents, ids));', 'const claimed = claimRows(spans);');
mutantFails('matching a unit id inside a longer one', '(?![A-Za-z0-9]|\\\\.[A-Za-z0-9])', '');
mutantFails('cutting a marker command\'s unit id short', '(?=[\\s"\\\\]|$)/g', '/g');
mutantFails('keeping stop-word pairs as friction themes', ' && !STOP.has(a) && !STOP.has(b)', '');

test('CLI smoke: a bad flag and two output modes each exit 2 with the usage line, reading nothing', () => {
  const cwd = tmp('retro-cli-');
  cleanup.push(cwd);
  const run = (args) => spawnSync(process.execPath, [path.join(SCRIPTS, CLI_REL), ...args], { cwd, encoding: 'utf8', env: hermeticEnv(cleanup) });
  for (const [args, message] of [
    [['--weekly'], /unknown option --weekly/],
    [['--dry-run', '--export', cwd], /pick one of --dry-run, --json and --export/],
  ]) {
    const res = run(args);
    assert.strictEqual(res.status, 2, res.stderr);
    assert.match(res.stderr, message);
    assert.match(res.stderr, /^usage: node scripts\/retro\.mjs /m);
  }
  assert.deepStrictEqual(fs.readdirSync(cwd), []);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
