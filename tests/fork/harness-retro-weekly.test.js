/**
 * Tests for the harness-bootstrap weekly retro job (skills/harness-bootstrap/scripts/retro-weekly.mjs):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the script.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(ROOT, 'skills', 'harness-bootstrap');
const TEST_REL = path.join('scripts', 'lib', 'retro-weekly-core.test.mjs');
const CORE_REL = path.join('scripts', 'lib', 'retro-weekly-core.mjs');
const CLI_REL = path.join('scripts', 'retro-weekly.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 20;

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
  env.HOME = tmp('retro-weekly-suite-home-');
  cleanup.push(env.HOME);
  return env;
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(skillDir, cleanup) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(skillDir, TEST_REL)],
    { encoding: 'utf8', env: hermeticEnv(cleanup), timeout: 120_000 },
  );
}

const cleanup = [];

/** Copy the skill's scripts and templates, apply a one-line mutation, and assert the suite fails. */
function mutantFails(name, needle, replacement, fileRel = CORE_REL) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('retro-weekly-mutant-');
    cleanup.push(copy);
    for (const dir of ['scripts', 'templates']) fs.cpSync(path.join(SKILL, dir), path.join(copy, dir), { recursive: true });
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

console.log('\nharness-bootstrap retro-weekly script');

test('the shipped retro-weekly suite passes with the pinned test count', () => {
  const res = runSuite(SKILL, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('running the review without --restricted', "    '--restricted',\n", '');
mutantFails('a fixed $50 cap', "    String(budget),\n", "    '50',\n");
mutantFails('reading an error result as proposals', "if (r.is_error || r.subtype !== 'success' || typeof r.result !== 'string'", "if (typeof r.result !== 'string'");
mutantFails('taking a manifest role outside the repository', "typeof roleValue === 'string' && safe(roleValue)", "typeof roleValue === 'string'");
mutantFails('dropping the escape of quotes in the notice', "replace(/[\\\\\"]/g, '\\\\$&')", "replace(/^$/g, '')");
mutantFails('running the review outside retro/', '    cwd: retroDir,\n    encoding', '    cwd: path.dirname(retroDir),\n    encoding', CLI_REL);
mutantFails('a dry run that exports', '  if (opts.dryRun) return dryRun({ opts, reg, retroDir, week, claude });\n', '', CLI_REL);
mutantFails('a cron line that redirects into a log directory that may not exist', 'mkdir -p ${shq(path.dirname(logFile))} && ', '');
mutantFails('a cron line without the Claude Code config directory', "configDir ? `CLAUDE_CONFIG_DIR=${shq(configDir)} ` : ''", "''");
mutantFails('a Windows task without the Claude Code config directory', "...(configDir ? ['--config-dir', configDir] : [])", '');
mutantFails('--config-dir read and dropped', '  if (opts.configDir) process.env.CLAUDE_CONFIG_DIR = path.resolve(opts.configDir);\n', '', CLI_REL);
mutantFails('reading the transcripts from ~/.claude whatever CLAUDE_CONFIG_DIR says', "path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')", "path.join(os.homedir(), '.claude', 'projects')", CLI_REL);
mutantFails('exiting 0 when the review failed', 'return failed.length || (opts.review && !review.ok && !review.skipped) ? 1 : 0;', 'return failed.length ? 1 : 0;', CLI_REL);

test('CLI smoke: --print-schedule names the installed copy and --list says when nothing is registered', () => {
  const home = tmp('retro-weekly-cli-');
  cleanup.push(home);
  const run = (args) => spawnSync(process.execPath, [path.join(SKILL, CLI_REL), ...args, '--home', home, '--claude', '/usr/bin/true'], { encoding: 'utf8', env: hermeticEnv(cleanup) });
  const sched = run(['--print-schedule']);
  assert.strictEqual(sched.status, 0, sched.stderr);
  assert.ok(sched.stdout.includes(path.join(home, 'retro-weekly', 'scripts', 'retro-weekly.mjs')), sched.stdout);
  const list = spawnSync(process.execPath, [path.join(SKILL, CLI_REL), '--list', '--home', home], { encoding: 'utf8', env: hermeticEnv(cleanup) });
  assert.strictEqual(list.status, 0, list.stderr);
  assert.strictEqual(list.stdout.trim(), 'no repositories registered');
  assert.deepStrictEqual(fs.readdirSync(home), []);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
