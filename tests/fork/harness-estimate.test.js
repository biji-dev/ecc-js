/**
 * Tests for the harness-bootstrap estimate template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'estimate-core.test.mjs');
const CORE_REL = path.join('lib', 'estimate-core.mjs');
const CLI_REL = 'estimate.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 22;

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
  env.HOME = tmp('estimate-suite-home-');
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
    const copy = tmp('estimate-mutant-');
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

console.log('\nharness-bootstrap estimate template');

test('the shipped estimate suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('using the nearest rank instead of interpolating', 'const pos = (v.length - 1) * p;', 'const pos = Math.floor((v.length - 1) * p);');
mutantFails('showing a range below the history threshold', 'export const MIN_ROWS = 3;', 'export const MIN_ROWS = 1;');
mutantFails('reading the tier from the wrong part of the combined cell', "parts.length > 1 ? parts.at(-1) : ''", "''");
mutantFails('ignoring the Type cell in the cohort filter', 'cohort.test(r.unit) || cohort.test(r.type)', 'cohort.test(r.unit)');
mutantFails('reading hours as 6 minutes each', 'n * 60 +', 'n * 6 +');
mutantFails('counting each deliverable row as its own sample', 'if (!byId.has(r.id)) byId.set(r.id, []);\n    byId.get(r.id).push(r);', 'byId.set(`${byId.size}`, [r]);');
mutantFails('reading only the first term of an owner wait', 'return wait === null ? parseDuration(cell) : wait.ms / 60_000;', 'return parseDuration(cell);');
mutantFails('accepting an unknown flag', '} else throw new Error(`unknown option ${t}`);', '}');
mutantFails('dropping the rows below a later table', 'for (const r of loose) out.findLast((x) => x.names.length === r.cells.length)?.rows.push(r);', 'void out;');
mutantFails('keeping the code ticks in the unit id', "id: parts[0].replace(/^[`*]+|[`*]+$/g, ''),", 'id: parts[0],');

test('CLI smoke: a log file gives the Gate 1 line, and a thin cohort says no history', () => {
  const dir = tmp('estimate-cli-');
  cleanup.push(dir);
  const log = path.join(dir, 'log.md');
  const rows = [60, 120, 180, 240].map((m, i) => `| EP-${i} | plan | Code | Full | work ${m}m · owner 30m | $${m / 10}.00 · Claude ${i + 1}% · Codex 1% | admitted 0 \\| x |`);
  fs.writeFileSync(log, ['# Harness log', '', '| Unit | Mode | Type | Tier | Elapsed | Cost | Scope |', '|---|---|---|---|---|---|---|', ...rows, ''].join('\n'));
  const res = runCli(SCRIPTS, ['--log', log, '--tier', 'full'], dir, cleanup);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(
    res.stdout.startsWith("Estimate per unit (full, n=4 units): work 1h45m–3h15m · owner wait 30m–30m · Claude 1.8–3.3% · Codex 1–1% — a range from this project's log, not a promise\n"),
    res.stdout,
  );
  const thin = runCli(SCRIPTS, ['--log', log, '--tier', 'full', '--cohort', '^EP-[01]$', '--json'], dir, cleanup);
  assert.strictEqual(thin.status, 0, thin.stderr);
  const j = JSON.parse(thin.stdout);
  assert.strictEqual(j.metrics.work.message, 'no history (n=2, need 3)');
  assert.match(j.line, /work no history \(n=2, need 3\)/);
});

test('CLI smoke: a missing log, a table-less file and a bad flag exit 2', () => {
  const dir = tmp('estimate-cli-');
  cleanup.push(dir);
  assert.strictEqual(runCli(SCRIPTS, ['--log', path.join(dir, 'no.md')], dir, cleanup).status, 2);
  fs.writeFileSync(path.join(dir, 'empty.md'), '# nothing\n');
  const none = runCli(SCRIPTS, ['--log', path.join(dir, 'empty.md')], dir, cleanup);
  assert.strictEqual(none.status, 2);
  assert.match(none.stderr, /usage: node scripts\/estimate\.mjs/);
  assert.strictEqual(runCli(SCRIPTS, ['--log', path.join(dir, 'empty.md'), '--tier', 'huge'], dir, cleanup).status, 2);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
