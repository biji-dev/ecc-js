/**
 * Tests for the harness-bootstrap harness-due template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'harness-due-core.test.mjs');
const CORE_REL = path.join('lib', 'harness-due-core.mjs');
const CLI_REL = 'harness-due.mjs';
const GATHER_REL = path.join('lib', 'retro-gather.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 19;

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
  env.HOME = tmp('harness-due-suite-home-');
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
    const copy = tmp('harness-due-mutant-');
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

console.log('\nharness-bootstrap harness-due template');

test('the shipped harness-due suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('blocking a phase that a merge already opened', 'const opens = rows === 0 && merged === 0;', 'const opens = rows === 0;');
mutantFails('matching a preflight report by case', '.some((r) => path.posix.basename(r.rel).toLowerCase() === want)', '.some((r) => path.posix.basename(r.rel) === want)');
mutantFails('counting landings from the log rows alone', 'const landings = Math.max(after(landed), after(merged));', 'const landings = after(landed);');
mutantFails('dropping the P3 queue from the hygiene line', "note: kind === 'hygiene' ? p3Note(summary) : ''", "note: ''");
mutantFails('taking a dirty worktree for residue', 'w.merged && w.own && w.clean)', 'w.merged && w.own)');
mutantFails('taking a branch with no commits of its own for residue', 'w.merged && w.own && w.clean)', 'w.merged && w.clean)');
mutantFails('losing an ignored file that is not rebuildable', '.every((p) => rebuildable.test(p))', '.every(() => true)');
mutantFails('counting an ignored link as a file it would lose', ".filter((p) => !isLink(path.join(w.path, p.replace(/\\/$/, ''))))", '', CLI_REL);
mutantFails('reading a fast-forwarded branch as one cut and never started', 'const own = merged && (!mainline.has(w.head) || moved);', 'const own = merged && !mainline.has(w.head);', CLI_REL);
mutantFails('matching a project name inside a longer one', '${esc(project)}(?![A-Za-z0-9_-])', '${esc(project)}');
mutantFails('moving a seen week backward', "if (!(typeof out[project] === 'string' && out[project] >= week)) out[project] = week;", 'out[project] = week;');
mutantFails('counting a report no commit holds by its file time', 'found.filter((r) => times.has(r.rel)).map((r) => ({ rel: r.rel, time: times.get(r.rel) }))', 'found.map((r) => ({ rel: r.rel, time: times.get(r.rel) ?? mtime(path.join(top, r.rel)) }))', CLI_REL);
mutantFails("counting a landed branch's merge of the mainline as a landing", "'--merges', '--first-parent', ", "'--merges', ", CLI_REL);
mutantFails('dating a line not committed yet by the time of the blame', 'committed ? time : null', 'time', GATHER_REL);
mutantFails('exiting 0 when the claim is blocked', 'if (blocking) process.exitCode = 1;', '', CLI_REL);

test('the shipped suite never skips: bound to no preflight and a 72 h idle time it still passes with skipped 0 and todo 0', () => {
  const copy = tmp('harness-due-binding-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const file = path.join(copy, CORE_REL);
  const before = fs.readFileSync(file, 'utf8');
  const bound = before
    .replace("preflight: 'docs/harness/reports/preflight-<phase>.md',", 'preflight: null,')
    .replace('WORKTREE_IDLE_HOURS = 6;', 'WORKTREE_IDLE_HOURS = 72;');
  assert.ok(bound.includes('preflight: null,') && bound.includes('WORKTREE_IDLE_HOURS = 72;'), 'the binding did not apply');
  fs.writeFileSync(file, bound);
  const res = runSuite(copy, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'skipped'), 0, out.slice(-800));
  assert.strictEqual(tapCount(out, 'todo'), 0, out.slice(-800));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
});

test('CLI smoke: claiming the first row of a phase with no preflight report exits 1 and names the report', () => {
  const repo = tmp('harness-due-cli-');
  cleanup.push(repo);
  const env = hermeticEnv(cleanup, { GIT_AUTHOR_DATE: '2026-10-20T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-20T10:00:00Z' });
  const git = (args) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
  };
  git(['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(repo, 'docs', 'harness'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'harness', 'log.md'), '| Unit · Mode · Type · Tier | Elapsed (work) | Cost |\n|---|---|---|\n| P1-01 · plan · Code · Small | 60m | $1 |\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'log']);
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, CLI_REL), '--claim', 'P2-01', '--home', repo, '--now', '2026-10-21T10:00:00Z'], { cwd: repo, encoding: 'utf8', env });
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /^DUE preflight P2 — no report at docs\/harness\/reports\/preflight-P2\.md, and P2-01 opens the phase: the claim waits for it — /m);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
