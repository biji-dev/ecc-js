/**
 * Tests for the harness-bootstrap project tests (skills/harness-bootstrap/templates/scripts/lib):
 * the command-guard, edit-guard, commit-guard, context-budget and run-gates suites a project runs
 * against its installed copies. Lays the templates out as an install does, binds the [B] lines a
 * fresh install binds, runs each suite hermetically with its count pinned, then proves each can
 * fail by mutating the installed copy it tests.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TEMPLATES = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates');

// The number of tests in each shipped suite. Adding or removing a test changes this on purpose.
const SUITES = {
  'command-guard': 15,
  'edit-guard': 8,
  'harness-guard': 7,
  'context-budget': 6,
  'run-gates': 4,
};

// Where each template lands in a project (SKILL.md, Phase C).
const LAYOUT = [
  ['command-guard.mjs', '.claude/hooks/command-guard.mjs'],
  ['edit-guard.mjs', '.claude/hooks/edit-guard.mjs'],
  ['context-budget.mjs', '.claude/hooks/context-budget.mjs'],
  ['harness-guard.sh', '.githooks/pre-commit'],
  ['harness-guard.sh', '.githooks/pre-merge-commit'],
  ['run-gates.sh', 'scripts/run-gates.sh'],
  ['scripts/run-counted.mjs', 'scripts/run-counted.mjs'],
  ['scripts/lib/run-counted-core.mjs', 'scripts/lib/run-counted-core.mjs'],
  ...Object.keys(SUITES).map(name => [`scripts/lib/${name}.test.mjs`, `scripts/lib/${name}.test.mjs`]),
];

const IDS_LINE = 'const IDS = [];';
const GATE_BLOCK = [
  '# >>> harness:gates [B]',
  "gate lint always 'true'",
  "gate_counted harness full '^COUNTED node [1-9][0-9]* passed' 'node scripts/run-counted.mjs --kind node --min 1 -- node --test --test-reporter=tap scripts/lib/*.test.mjs'",
  '# <<< harness:gates',
].join('\n');

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

const cleanup = [];

function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

/** Replace one occurrence in an installed file; `to` is literal text. */
function edit(dir, rel, from, to) {
  const file = path.join(dir, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(from, () => to);
  assert.notStrictEqual(after, before, `${rel}: ${from} is not in the file`);
  fs.writeFileSync(file, after);
}

/** A fresh install in a temp git repo: every template where it lands, the [B] lines bound unless `bind` is false. */
function install({ bind = true } = {}) {
  const dir = tmp('harness-project-');
  for (const [from, to] of LAYOUT) {
    fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
    fs.copyFileSync(path.join(TEMPLATES, from), path.join(dir, to));
  }
  for (const hook of ['.githooks/pre-commit', '.githooks/pre-merge-commit']) fs.chmodSync(path.join(dir, hook), 0o755);
  edit(dir, 'scripts/run-gates.sh', /# >>> harness:gates[\s\S]*?# <<< harness:gates/, GATE_BLOCK);
  if (bind) edit(dir, 'scripts/lib/harness-guard.test.mjs', IDS_LINE, "const IDS = ['P2-20', 'EP-27', 'CR-025b'];");
  const init = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(init.status, 0, init.stderr);
  return dir;
}

/** Env with a fresh HOME and no GIT_*, NODE_OPTIONS or NODE_TEST_CONTEXT (node's runner would obey them). */
function hermeticEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  env.HOME = tmp('harness-project-home-');
  return env;
}

function runSuite(dir, name) {
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join('scripts', 'lib', `${name}.test.mjs`)], {
    cwd: dir,
    encoding: 'utf8',
    env: hermeticEnv(),
    timeout: 120_000,
  });
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

console.log('\nharness project tests: each suite against the installed templates');

for (const [name, expected] of Object.entries(SUITES)) {
  test(`${name}: all ${expected} pass, none skipped`, () => {
    const res = runSuite(install(), name);
    const out = `${res.stdout}${res.stderr}`;
    assert.strictEqual(res.status, 0, out.slice(-1500));
    assert.strictEqual(tapCount(out, 'pass'), expected, 'the suite size changed: update SUITES on purpose');
    for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.strictEqual(tapCount(out, key), 0, key);
  });
}

test('harness-guard: a plan-mode guard with no ids bound fails, naming the binding', () => {
  const res = runSuite(install({ bind: false }), 'harness-guard');
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stdout, /ID_PATTERN is set but IDS lists no id to hold it to/);
});

console.log('\nharness project tests: each suite fails on a broken install');

/** Install, break one line of the copy a suite tests, and assert the suite fails. */
function mutantFails(name, rel, from, to) {
  test(`mutant: ${name}`, () => {
    const dir = install();
    edit(dir, rel, from, to);
    const suite = Object.keys(SUITES).find(s => rel.includes(s)) ?? (rel.startsWith('.githooks/') ? 'harness-guard' : null);
    const res = runSuite(dir, suite);
    assert.notStrictEqual(res.status, 0, `the ${suite} suite passed the mutant`);
    assert.ok(tapCount(`${res.stdout}${res.stderr}`, 'fail') >= 1);
  });
}

mutantFails(
  'a command guard that lets `git merge --no-verify` through',
  '.claude/hooks/command-guard.mjs',
  "if (t === '--no-verify') return true;\n  }\n  return false;",
  "if (t === '--no-verify') return false;\n  }\n  return false;",
);
mutantFails(
  'a command guard whose MAINLINE was rebound, which its own suite would loop over',
  '.claude/hooks/command-guard.mjs',
  "export const MAINLINE = ['main', 'master'];",
  "export const MAINLINE = ['mainline'];",
);
mutantFails(
  'a command guard whose HOOKS_DIR was rebound, which its own suite would allow',
  '.claude/hooks/command-guard.mjs',
  "export const HOOKS_DIR = '.githooks';",
  "export const HOOKS_DIR = '/dev/null';",
);
mutantFails(
  'an edit guard that ignores a Codex move',
  '.claude/hooks/edit-guard.mjs',
  '(?:Add File|Update File|Delete File|Move to)',
  '(?:Add File|Update File|Delete File)',
);
mutantFails(
  'an edit guard that checks only the lexical path, so a link to a protected path gets through',
  '.claude/hooks/edit-guard.mjs',
  'PROTECTED.some((re) => re.test(rel) || re.test(real))',
  'PROTECTED.some((re) => re.test(rel))',
);
mutantFails(
  'an edit guard that checks only the physical path, so a .env link to an allowed file gets through',
  '.claude/hooks/edit-guard.mjs',
  'PROTECTED.some((re) => re.test(rel) || re.test(real))',
  'PROTECTED.some((re) => re.test(real))',
);
mutantFails(
  'an edit guard that drops `..` from a link target as text, so alias -> jump/../x gets through',
  '.claude/hooks/edit-guard.mjs',
  'head = isAbsolute(target) ? target : `${dirname(head)}${sep}${target}`;',
  'head = resolve(dirname(head), target);',
);
mutantFails(
  'an edit guard that normalises a patch path before its links, so jump/../x gets through',
  '.claude/hooks/edit-guard.mjs',
  'physicalPath(isAbsolute(p) ? p : `${resolve(base)}${sep}${p}`)',
  'physicalPath(resolve(base, p))',
);
mutantFails(
  'an edit guard whose .env pattern is case-sensitive, so .ENV gets through',
  '.claude/hooks/edit-guard.mjs',
  '[^/]*)?$/i,',
  '[^/]*)?$/,',
);
mutantFails(
  'a commit guard that never refuses the mainline while a row is held',
  '.githooks/pre-commit',
  'if [ "$lock_here" = 1 ]; then',
  'if false; then',
);
mutantFails(
  'a context budget that reads past a compaction',
  '.claude/hooks/context-budget.mjs',
  'if (isCompaction(line)) return null;',
  '',
);
mutantFails(
  'a runner that matches the count regex on the coloured log',
  'scripts/run-gates.sh',
  '! strip_csi <"$logfile" | grep -Eq -- "$rx"',
  '! grep -Eq -- "$rx" "$logfile"',
);

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
