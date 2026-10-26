/**
 * Tests for the harness-bootstrap machine sweep (skills/harness-bootstrap/scripts/machine-sweep.mjs):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the script.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(ROOT, 'skills', 'harness-bootstrap');
const TEST_REL = path.join('scripts', 'lib', 'machine-sweep-core.test.mjs');
const CORE_REL = path.join('scripts', 'lib', 'machine-sweep-core.mjs');
const CLI_REL = path.join('scripts', 'machine-sweep.mjs');

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
  env.HOME = tmp('machine-sweep-suite-home-');
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
    { encoding: 'utf8', env: hermeticEnv(cleanup), timeout: 300_000 },
  );
}

const cleanup = [];

/** Copy the skill's scripts, apply a one-line mutation, and assert the suite fails. */
function mutantFails(name, needle, replacement, fileRel = CORE_REL) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('machine-sweep-mutant-');
    cleanup.push(copy);
    fs.cpSync(path.join(SKILL, 'scripts'), path.join(copy, 'scripts'), { recursive: true });
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

console.log('\nharness-bootstrap machine-sweep script');

test('the shipped machine-sweep suite passes with the pinned test count', () => {
  const res = runSuite(SKILL, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('an MCP server under a live agent taken for an orphan', 'chain.every((c) => MCP.test(c.command))', 'true');
mutantFails('stopping a launchd job', '!services.has(top.pid) && chain.every', 'chain.every');
mutantFails('dropping a browser revision override', '[b.revision, ...Object.values(b.revisionOverrides ?? {})]', '[b.revision]');
mutantFails('removing a release in use', '.filter((n) => !inUse.has(n));', ';');
mutantFails('a store version removed before its idle time', ' && now - v.written >= idleDays * DAY)', ')');
mutantFails('a reused PID taken for the recorded process', 'l && l.lstart === r.lstart && l.command', 'l && l.command');
mutantFails('stopping a process recorded just now', ' && now - Date.parse(r.t) >= idleHours * HOUR', '');
mutantFails('a worktree with no commits of its own removed', "  if (!w.own) return 'keep: no commits of its own';\n", '');
mutantFails('deleting under a root outside the home', "if (h === path.parse(h).root || !inside(r, h)) return false;", 'if (h === path.parse(h).root) return false;');
mutantFails('applying categories nobody approved', 'const ids = approved.filter((id) => !args.only || args.only.includes(id));', 'const ids = (args.only ?? IDS).filter((id) => !args.only || args.only.includes(id));', CLI_REL);
mutantFails('an installed copy with a changed core read as current', 'COPIED.some((f) =>', 'COPIED.slice(0, 1).some((f) =>', CLI_REL);
mutantFails('a linked category directory followed out of its root', 'return allowed(...physical);', 'return true;');
mutantFails("a linked worktree's record reading its own registry", "read(path.join(main, '.claude', 'registry.md'))", "read(path.join(repo, '.claude', 'registry.md'))", CLI_REL);
mutantFails('a failed ps or lsof read as no process', 'if (!rows || !cwds) return null;', 'rows ??= []; cwds ??= [];');
mutantFails("a live sweep's lock taken by its age", '  if (Number.isInteger(pid)) return !alive;\n', '');
mutantFails('a failed ps before the signal read as the planned process', 'if (!now.ok || now.out.trim() !== p.command.trim()) return 0;', 'if (now.out.trim() !== p.command.trim()) return 0;', CLI_REL);
mutantFails("a run's end removing the entry another sweep wrote", 'return { release: () => fs.rmSync(own, { force: true }) };', 'return { release: () => fs.rmSync(locks, { recursive: true, force: true }) };', CLI_REL);
mutantFails('a run going on beside a live one', "    else if (holder === null) holder = pid ?? 'unknown';\n", '');
mutantFails("an earlier boot's entry with this run's pid held as a live run's", 'if (pid === own || staleLock(', 'if (staleLock(');
mutantFails('a removal checked where its path reads as text, not where a `..` after a link climbs', 'real(path.dirname(target))), path.basename(target))', 'real(path.dirname(t))), path.basename(t))');
mutantFails('a dry run that frees', "        if (args.dryRun) {\n          lines.push(`would  ${id}: ${describe(p)}`);\n          continue;\n        }\n", '', CLI_REL);

// No CLI path yields a `..` (measure() joins its paths), so this pins the wiring the core test needs.
test('the CLI checks a removal with the native realpath, which climbs a `..` after a link as the removal does', () => {
  const src = fs.readFileSync(path.join(SKILL, CLI_REL), 'utf8');
  assert.match(src, /deletable\(p\.rm, p\.root, m\.home, \(x\) => fs\.realpathSync\.native\(x\)\)/);
});

test('CLI smoke: the report on an empty home says each category is absent and writes nothing', () => {
  const home = tmp('machine-sweep-cli-');
  cleanup.push(home);
  const res = spawnSync(process.execPath, [path.join(SKILL, CLI_REL), '--home', home, '--only', 'bun,updaters,worktrees,recorded-pids'], { encoding: 'utf8', env: hermeticEnv(cleanup) });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /^bun +- +absent: no bun install cache$/m);
  assert.match(res.stdout, /^updaters +- +absent: no updater caches$/m);
  assert.match(res.stdout, /^worktrees +- +absent: no registered repository/m);
  assert.match(res.stdout, /^recorded-pids +0 proc +none recorded$/m);
  assert.deepStrictEqual(fs.readdirSync(home), []);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
