/**
 * Tests for the harness-bootstrap run-counted template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core or
 * the wrapper, and that a project's own kind and flag do not fail it.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'run-counted-core.test.mjs');
const CORE_REL = path.join('lib', 'run-counted-core.mjs');
const CLI_REL = 'run-counted.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 38;

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

/**
 * Env with a fresh HOME and no GIT_* variable. NODE_OPTIONS and NODE_TEST_CONTEXT are dropped
 * too: the suite runs node's own test runner, which either would redirect or filter.
 */
function hermeticEnv(cleanup) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  env.HOME = tmp('run-counted-suite-home-');
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

/** Copy the shipped scripts and replace each needle (it must occur exactly once) in the file at `rel`. */
function mutatedCopy(edits) {
  const copy = tmp('run-counted-mutant-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  for (const [rel, needle, replacement] of edits) {
    const file = path.join(copy, rel);
    const before = fs.readFileSync(file, 'utf8');
    assert.strictEqual(before.split(needle).length, 2, `the needle must occur exactly once in ${rel}: ${needle}`);
    fs.writeFileSync(file, before.replace(needle, () => replacement));
  }
  return copy;
}

/** Copy the shipped scripts, apply a one-line mutation to the core (or the file at `rel`), and assert the suite fails. */
function mutantFails(name, needle, replacement, rel = CORE_REL) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = mutatedCopy([[rel, needle, replacement]]);
    const res = runSuite(copy, cleanup);
    const out = res.stdout + res.stderr;
    assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
    assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
  });
}

console.log('\nharness-bootstrap run-counted template');

test('the shipped run-counted suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails(
  'hiding a second summary',
  'problems: hits.length > 1 ? [`${hits.length} ${kind} summary lines in the output (one expected)`] : [] };',
  'problems: [] };',
);
mutantFails('reading only the last of two node summaries', 'if (plans > 1 || ls.slice(0, plan).some(isRun)) problems.push(', 'if (false) problems.push(');
mutantFails('reading a second node summary by its # tests line alone', 'if (plans > 1 || ls.slice(0, plan).some(isRun))', 'if (ls.slice(0, plan).some(isRun))');
mutantFails('reading a console # tests line as a node summary', " && NODE_COUNTER.exec(ls[i + 1] ?? '')?.[1] === 'suites'", '');
mutantFails('counting a file that registered no tests as a pass', 'for (const f of nodeEmptyFiles(ls)) problems.push(', 'for (const f of []) problems.push(');
mutantFails('not forwarding a stop signal to the command', 'for (const sig of FORWARDED) process.on(sig, forward);', '', CLI_REL);
mutantFails("signalling the command alone, not its process group", 'process.kill(-child.pid, sig);', 'child.kill(sig);', CLI_REL);
mutantFails('waiting for close forever after a forwarded signal', 'if (!interrupted || !exited || grace) return;', 'return;', CLI_REL);
mutantFails('forwarding a second stop signal instead of SIGKILL', "if (interrupted) return signalCommand('SIGKILL');", 'if (interrupted) return signalCommand(sig);', CLI_REL);
mutantFails('letting a skip through', "  'skipped',\n  'todo',", "  'todo',");
mutantFails('letting a flaky test through', "  'flaky',\n", '');
mutantFails('ignoring the node skip and todo markers', 'for (const m of summary.markers ?? [])', 'for (const m of [])');
mutantFails('reading the escapes instead of the text', 'const lines = (text) => stripAnsi(text).split(/\\r?\\n/);', 'const lines = (text) => String(text).split(/\\r?\\n/);');
mutantFails('trusting bun counters that do not add up to its Ran count', 'if (ran !== Number(hit[1])) counts.problems.push(', 'if (false) counts.problems.push(');
mutantFails('ignoring the floor', 'if (summary.passed < min) reasons.push(', 'if (false) reasons.push(');
mutantFails('ignoring the exit code', 'else if (exitCode !== 0) reasons.push(', 'else if (false) reasons.push(');
mutantFails("reading bun's summary from stdout", "bun: 'stderr'", "bun: 'stdout'");
mutantFails('reading an inherited key as a counter word', 'Object.hasOwn(words, m[2]) && words[m[2]]', 'words[m[2]]');
mutantFails('ignoring a --test flag in NODE_OPTIONS', "if (!/--test/.test(v)) return null;", 'return null;');

// The failing-test ids run-counted prints after its verdict (the known-red baseline reads them).
mutantFails('naming a node suite as a failing test', "    if (type === 'suite') {\n", '    if (false) {\n');
mutantFails("leaving vitest's Failed Suites out of the ids", "if (section === 'Suites') out.push(", 'if (false) out.push(');
mutantFails('naming the ids whole when they are fewer than the failed count', '    summary.failed === ids.length &&\n', '');
mutantFails('naming the ids whole after the command died of a signal', '    !signal &&\n', '');
mutantFails("reading bun's failing tests past its summary list", 'if (BUN_FAILED_LIST.test(l)) break;', '');
mutantFails('naming ids relative to the cwd, not the gate tree', 'const top = realTop(process.env.RUN_GATES_TOP);', 'const top = null;', CLI_REL);
mutantFails('ignoring the files git lists under the gate tree', 'files: () => topFiles(top)', 'files: null', CLI_REL);
mutantFails("ignoring vitest's RUN root", "root: m[1] ? null : root }", 'root: null }');
mutantFails("reading a |project| path against the RUN root", "root: m[1] ? null : root }", 'root }');
mutantFails("keeping a hook's GIT_INDEX_FILE for the file list", "  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR']) delete env[k];\n", '', CLI_REL);
mutantFails('guessing between two package files with one tail', '    if (hit !== null) return null;\n', '');
mutantFails('matching a tail inside a directory name', "tailMatch(files, `/${path.posix.normalize(local.split(path.sep).join('/'))}`)", "tailMatch(files, path.posix.normalize(local.split(path.sep).join('/')))");
mutantFails('searching a tree with a nested repository', "    if (f.endsWith('/')) return null; // a nested repository\n", '', CLI_REL);
mutantFails('searching a tree with a submodule', "    if (rec.startsWith('160000 ')) return null; // a submodule\n", '', CLI_REL);
mutantFails('taking the gate tree through a symlink as given', 'return fs.realpathSync(top);', 'return top;', CLI_REL);
mutantFails("ending a pytest id at a space inside a parameter's brackets", "if (rest[i] === '[') depth++;", 'if (false) depth++;');
mutantFails('skipping a node suite whose own hook failed', "if (failure !== 'subtestsFailed') out.push({ file: '?', title });", '');

test('a suite run with GIT_DIR and GIT_INDEX_FILE set (as inside a git hook) leaves that repo untouched', () => {
  const decoy = tmp('run-counted-decoy-');
  cleanup.push(decoy);
  const git = (...args) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    env.GIT_CONFIG_GLOBAL = os.devNull;
    env.GIT_CONFIG_NOSYSTEM = '1';
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-C', decoy, ...args], { env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(decoy, 'f.txt'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const snapshot = () => [git('log', '--all', '--format=%H'), git('status', '--porcelain'), git('ls-files', '-s'), fs.readdirSync(path.join(decoy, '.git')).sort().join(','), fs.readFileSync(path.join(decoy, '.git', 'config'), 'utf8')].join('\n');
  const before = snapshot();
  const env = { ...hermeticEnv(cleanup), GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: path.join(decoy, '.git', 'index') };
  const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(SCRIPTS, TEST_REL)], { encoding: 'utf8', env, timeout: 120_000 });
  const out = res.stdout + res.stderr;
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS, out.slice(-1500));
  assert.strictEqual(snapshot(), before, 'the suite wrote into the repository named by GIT_DIR');
});

test("a project's own kind and flag in its core do not fail the shipped suite", () => {
  const copy = mutatedCopy([
    [CORE_REL, "export const KINDS = ['vitest', 'node', 'pytest', 'bun', 'playwright'];", "export const KINDS = ['vitest', 'node', 'pytest', 'bun', 'playwright', 'extra'];"],
    [CORE_REL, "playwright: 'stdout' };", "playwright: 'stdout', extra: 'stdout' };"],
    [CORE_REL, "  if (kind === 'playwright') return parsePlaywright(text);\n", "  if (kind === 'playwright') return parsePlaywright(text);\n  if (kind === 'extra') return null;\n"],
    [CORE_REL, "const FLAGS = { '--kind': 'kind', '--min': 'min' };", "const FLAGS = { '--kind': 'kind', '--min': 'min', '--root': 'root' };"],
  ]);
  const res = runSuite(copy, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

test('the header says what a SIGKILL to the wrapper leaves running', () => {
  const header = fs.readFileSync(path.join(SCRIPTS, CLI_REL), 'utf8').split('*/')[0];
  assert.match(header, /A SIGKILL to this process cannot be forwarded/);
  assert.match(header, /the command runs on until a write to its closed pipes ends it/);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
