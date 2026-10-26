/**
 * Tests for the harness-bootstrap harness-host template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, proves it can fail by mutating the core, and runs
 * the D7 demo lines against the shipped templates/harness-models.json.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TEMPLATES = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates');
const SCRIPTS = path.join(TEMPLATES, 'scripts');
const TEST_REL = path.join('lib', 'harness-host-core.test.mjs');
const CORE_REL = path.join('lib', 'harness-host-core.mjs');
const CLI_REL = 'harness-host.mjs';

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
  env.HOME = tmp('harness-host-suite-home-');
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
    const copy = tmp('harness-host-mutant-');
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

console.log('\nharness-bootstrap harness-host template');

test('the shipped harness-host suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('probing CLAUDECODE before every other host variable', "  if (set('HARNESS_HOST')) {", "  if (set('CLAUDECODE')) return { host: 'claude', by: 'CLAUDECODE' };\n  if (set('HARNESS_HOST')) {");
mutantFails('dropping CODEX_SANDBOX from the Codex variables', "for (const k of ['CODEX_THREAD_ID', 'CODEX_SANDBOX'])", "for (const k of ['CODEX_THREAD_ID'])");
mutantFails('letting a host name its own family as the second', 'if (f === FAMILY_OF[host]) throw', 'if (false) throw');
mutantFails('reading an effort set inside a TOML table', "if (/^\\s*\\[/.test(line)) break;", 'if (false) break;');
mutantFails('the user config beating the project one', 'for (const c of codexConfigs) {', 'for (const c of [...codexConfigs].reverse()) {');
mutantFails('missing an effort of max', 'const ABOVE_HIGH = /^(xhigh|max|ultra)$/i;', 'const ABOVE_HIGH = /^(xhigh)$/i;');
mutantFails('trusting a codex login that exited non-zero', 'return login?.status === 0 ?', 'return login?.status !== undefined ?');
mutantFails('reporting the fallback while the second family runs', 'if (second?.ok) return [];', 'if (false) return [];');
mutantFails('counting a host with no models as known', 'known: Boolean(entry)', 'known: true');
mutantFails('skipping the wrapper check', 'const wrapper = fs.existsSync(path.join(repo, WRAPPERS[fam]));', 'const wrapper = true;', CLI_REL);
mutantFails('exiting 0 when the models are missing', 'return report.known ? 0 : 1;', 'return 0;', CLI_REL);

/** A repo holding the shipped models file, logged-in stubs first on PATH, and an empty Codex home. */
function demoRun(extraEnv) {
  const dir = tmp('harness-host-demo-');
  cleanup.push(dir);
  const bin = path.join(dir, 'bin');
  const repo = path.join(dir, 'repo');
  for (const d of [bin, path.join(repo, '.agents'), path.join(repo, 'scripts'), path.join(dir, '.codex')]) fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'harness-models.json'), path.join(repo, '.agents', 'harness-models.json'));
  for (const f of ['codex-run.mjs', 'claude-run.mjs']) fs.writeFileSync(path.join(repo, 'scripts', f), '');
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\necho "Logged in using ChatGPT"\n');
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho \'{"loggedIn": true}\'\n');
  for (const f of ['codex', 'claude']) fs.chmodSync(path.join(bin, f), 0o755);
  return spawnSync(process.execPath, [path.join(SCRIPTS, CLI_REL), '--repo', repo], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, ...extraEnv },
  });
}

test('demo: CODEX_THREAD_ID=x prints the Codex role line from the shipped models file', () => {
  const res = demoRun({ CODEX_THREAD_ID: 'x' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.deepStrictEqual(res.stdout.trim().split('\n'), [
    'host codex · main gpt-6.1-sol high · second family claude',
    '  bounded gpt-6-luna high · detected by CODEX_THREAD_ID',
    'harness-host: no hazards',
  ]);
});

test('demo: ZCODE_SESSION_ID with CLAUDECODE set prints the ZCode line, not Claude Code\'s', () => {
  const res = demoRun({ ZCODE_SESSION_ID: 'z', CLAUDECODE: '1' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.strictEqual(res.stdout.split('\n')[0], 'host zcode · main GLM-5.3 · second family codex');
});

test('the shipped models file: every host the role table names, each second family another family', () => {
  const models = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'harness-models.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(models.hosts), ['claude', 'codex', 'zcode']);
  assert.deepStrictEqual(models.hosts.claude.main, { model: 'opus', effort: 'high' });
  assert.deepStrictEqual(models.hosts.claude.bounded, { model: 'sonnet', effort: 'high' });
  assert.deepStrictEqual([models.hosts.claude.second, models.hosts.codex.second, models.hosts.zcode.second, models.hosts.zcode.fallback], ['codex', 'claude', 'codex', 'claude']);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
