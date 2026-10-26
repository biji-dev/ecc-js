/**
 * Tests for the harness-bootstrap claude-run template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, proves it can fail by mutating the core and the
 * wrapper, and runs the D7 demo: a dry run prints the read-only command.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TEMPLATES = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates');
const SCRIPTS = path.join(TEMPLATES, 'scripts');
const TEST_REL = path.join('lib', 'claude-run-core.test.mjs');
const CORE_REL = path.join('lib', 'claude-run-core.mjs');
const CLI_REL = 'claude-run.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 9;

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
  env.HOME = tmp('claude-run-suite-home-');
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
    const copy = tmp('claude-run-mutant-');
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

console.log('\nharness-bootstrap claude-run template');

test('the shipped claude-run suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('a command tool among the tools', "export const TOOLS = ['Read', 'Grep', 'Glob'];", "export const TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];");
mutantFails('dropping --restricted', "    '--restricted',\n", '');
mutantFails('running under a Claude Code host', "if (host === 'claude')", 'if (false)');
mutantFails('starting claude in a sandbox with no network', "if (env.CODEX_SANDBOX_NETWORK_DISABLED === '1')", 'if (false)');
mutantFails('reading an error result as a verdict', '  if (r.is_error) {', '  if (false) {');
mutantFails('reporting the budget cap as a bare subtype', "if (r.subtype === 'error_max_budget_usd') return", "if (false) return");
mutantFails('calling an error result failed without reading its errors', 'errors.some((e) => UNAVAILABLE.test(e))', 'false');
mutantFails('reserving the review under CLAUDE_RUN=essential', "if (m === 'essential' && !ROUTES[kind].essential)", "if (m === 'essential')");
mutantFails('taking max effort from a flag', "if (a.effort === 'max') throw", 'if (false) throw');
mutantFails('a dry run that goes on to run', '    console.log(JSON.stringify(shown, null, 2));\n    return EXIT.ok;', '    console.log(JSON.stringify(shown, null, 2));', CLI_REL);
mutantFails('a review with no diff file', '    const problem = writeDiff(a, run.diffFile);', '    const problem = null;', CLI_REL);

test('demo: a dry run from a Codex host prints the read-only command and writes nothing', () => {
  const repo = tmp('claude-run-demo-');
  cleanup.push(repo);
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, CLI_REL), '--kind', 'review', '--base', 'main', '--dry-run', '--cwd', repo], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: repo, CODEX_THREAD_ID: 'x' },
  });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const shown = JSON.parse(res.stdout);
  const argv = shown.argv;
  const value = (flag) => argv[argv.indexOf(flag) + 1];
  assert.deepStrictEqual([argv[0], argv[1], argv[2]], ['claude', '-p', '--restricted']);
  assert.strictEqual(value('--tools'), 'Read,Grep,Glob');
  assert.strictEqual(value('--allowedTools'), 'Read,Grep,Glob');
  assert.strictEqual(value('--permission-mode'), 'dontAsk');
  assert.strictEqual(value('--max-budget-usd'), '5');
  assert.ok(argv.includes('--strict-mcp-config') && argv.includes('--no-session-persistence'));
  assert.ok(!argv.some((x) => /Bash|Edit|Write|WebFetch/.test(x)), argv.join(' '));
  assert.strictEqual(shown.diff, `git diff --merge-base main > ${path.join(repo, '.review-work', 'claude-review', 'diff.patch')}`);
  assert.deepStrictEqual(fs.readdirSync(repo), []);
});

test('demo: under Claude Code it refuses, pointing at codex-run', () => {
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, CLI_REL), 'review', '--base', 'main', '--dry-run'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: os.tmpdir(), CLAUDECODE: '1' },
  });
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /the host is Claude Code \(CLAUDECODE\): its second family is Codex, through scripts\/codex-run\.mjs/);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
