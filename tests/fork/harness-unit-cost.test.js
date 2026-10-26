/**
 * Tests for the harness-bootstrap unit-cost template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'unit-cost-core.test.mjs');
const CORE_REL = path.join('lib', 'unit-cost-core.mjs');
const CLI_REL = 'unit-cost.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 23;

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

/** Env with a fresh HOME and no GIT_* variable; `extra` is applied last. */
function hermeticEnv(cleanup, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.HOME = tmp('unit-cost-suite-home-');
  cleanup.push(env.HOME);
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

/** Run the shipped CLI from `scriptsDir` with `cwd` as the working directory. */
function runCli(scriptsDir, args, cwd, cleanup) {
  return spawnSync(process.execPath, [path.join(scriptsDir, CLI_REL), ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv(cleanup),
    timeout: 60_000,
  });
}

const cleanup = [];

/** Copy the shipped scripts, apply a one-line mutation to the core, and assert the suite fails. */
function mutantFails(name, needle, replacement) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('unit-cost-mutant-');
    cleanup.push(copy);
    fs.cpSync(SCRIPTS, copy, { recursive: true });
    const corePath = path.join(copy, CORE_REL);
    const before = fs.readFileSync(corePath, 'utf8');
    const mutated = before.replace(needle, replacement);
    assert.notStrictEqual(mutated, before, 'the mutation did not apply');
    fs.writeFileSync(corePath, mutated);
    const res = runSuite(copy, cleanup);
    const out = res.stdout + res.stderr;
    assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
    assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
  });
}

console.log('\nharness-bootstrap unit-cost template');

test('the shipped unit-cost suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('pricing a 1h cache write at the 5m rate', 'export const CACHE_WRITE_1H = 2;', 'export const CACHE_WRITE_1H = 1.25;');
mutantFails('dropping the flat cache-write fallback', 'if (w1h + w5m === 0) w5m = num(usage.cache_creation_input_tokens);', '');
mutantFails('counting a repeated (message.id, requestId) twice', 'if (seen.has(r.key)) return false;', 'if (false) return false;');
mutantFails('counting synthetic turns', "if (msg.model === '<synthetic>') continue;", '');
mutantFails('ignoring the upper bound of the window', 'return (lo === null || ts >= lo) && (hi === null || ts <= hi);', 'return lo === null || ts >= lo;');
mutantFails('attributing subagent dollars to the main thread', 'out[r.kind] += r.cost;', 'out.main += r.cost;');
mutantFails('counting a quota delta across a reset', 'b.resetsAt === a.resetsAt', 'true');
mutantFails('counting a negative quota delta', 'Math.max(0, a.usedPercent - b.usedPercent)', 'a.usedPercent - b.usedPercent');
mutantFails('accepting an unknown flag', '} else throw new Error(`unknown option ${t}`);', '}');

/** A synthetic projects dir (one session, one subagent) and a Codex ledger under a fresh temp root. */
function fixture() {
  const root = tmp('unit-cost-cli-');
  cleanup.push(root);
  const proj = path.join(root, 'projects', '-p-app');
  fs.mkdirSync(path.join(proj, 's1', 'subagents'), { recursive: true });
  const turn = (id, model, out) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-10-24T01:00:00Z',
      requestId: `req-${id}`,
      message: { id, model, usage: { input_tokens: 0, output_tokens: out } },
    });
  fs.writeFileSync(path.join(proj, 's1.jsonl'), `${turn('a', 'claude-opus-5-5', 1_000_000)}\n${turn('a', 'claude-opus-5-5', 1_000_000)}\n`);
  fs.writeFileSync(path.join(proj, 's1', 'subagents', 'agent-x.jsonl'), `${turn('b', 'claude-sonnet-5-5', 1_000_000)}\n`);
  fs.writeFileSync(path.join(proj, 's1', 'subagents', 'agent-x.meta.json'), JSON.stringify({ agentType: 'implementer' }));
  const run = { at: '2026-10-24T01:00:00Z', kind: 'review', cwd: '/p/app', ms: 10, limitsBefore: { usedPercent: 1, resetsAt: 5 }, limitsAfter: { usedPercent: 3, resetsAt: 5 } };
  fs.writeFileSync(path.join(root, 'ledger.jsonl'), `${JSON.stringify(run)}\n`);
  return root;
}

test('CLI smoke: a synthetic session prices main plus subagent, dedupes, and reads the ledger', () => {
  const root = fixture();
  const projects = path.join(root, 'projects');
  const res = runCli(SCRIPTS, ['--session', 's1', '--projects-dir', projects, '--ledger', path.join(root, 'ledger.jsonl'), '--json'], root, cleanup);
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.claude.turns, 2);
  assert.strictEqual(out.claude.main, 20);
  assert.strictEqual(out.claude.sub, 10);
  assert.strictEqual(out.claude.total, 30);
  assert.deepStrictEqual(out.claude.subagents, { implementer: 1 });
  assert.strictEqual(out.codex.percent, 2);
  assert.strictEqual(out.summary, 'Cost $30.00 · Claude 1.5% · Codex 2% (1 runs)');
  const text = runCli(SCRIPTS, ['--session', 's1', '--projects-dir', projects], root, cleanup);
  assert.ok(text.stdout.startsWith('Cost $30.00 · Claude 1.5% · Codex no ledger\n'), text.stdout);
});

test('CLI smoke: a missing session and an unknown flag exit 2 with usage', () => {
  const root = fixture();
  const missing = runCli(SCRIPTS, ['--session', 'nope', '--projects-dir', path.join(root, 'projects')], root, cleanup);
  assert.strictEqual(missing.status, 2);
  assert.match(missing.stderr, /not found/);
  const bad = runCli(SCRIPTS, ['--session', 's1', '--wat'], root, cleanup);
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /usage: node scripts\/unit-cost\.mjs/);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
