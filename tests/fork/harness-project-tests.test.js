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
  'edit-guard': 9,
  'harness-guard': 10,
  'context-budget': 7,
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

const GUARD_COPIES = ['.githooks/pre-commit', '.githooks/pre-merge-commit'];
const TEST_COPY = 'scripts/lib/harness-guard.test.mjs';
// A husky install (commit-guard.md): the guard kept at .githooks/harness-guard.sh and called first from
// .husky/pre-commit and .husky/pre-merge-commit, which husky v9 runs with sh from .husky/_ (no exec bit
// needed). core.hooksPath stays unset: the suite runs GUARD itself in its throwaway repos and reads the
// two .husky files it is bound to, so nothing here commits through them.
const HUSKY_CALL = 'sh .githooks/harness-guard.sh || exit 1\n';
// The hook's next command succeeds anywhere, so a refusal the hook does not pass on ends it with 0.
const HUSKY_REST = 'echo "pre-commit checks passed"\n';
const GUARD_LINES = "const GUARD = '.githooks/pre-commit';\nconst MERGE_GUARD = '.githooks/pre-merge-commit';";
const HOOK_FILES_LINE = "const HOOK_FILES = ['.githooks/pre-commit', '.githooks/pre-merge-commit'];";

/**
 * A fresh install in a temp git repo: every template where it lands, the [B] lines bound unless `bind`
 * is false. `variant` 'husky' installs the guard for husky; 'checkout' binds SCOPE="checkout" in it.
 */
function install({ bind = true, variant = 'default' } = {}) {
  const dir = tmp('harness-project-');
  for (const [from, to] of LAYOUT) {
    fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
    fs.copyFileSync(path.join(TEMPLATES, from), path.join(dir, to));
  }
  for (const hook of GUARD_COPIES) fs.chmodSync(path.join(dir, hook), 0o755);
  edit(dir, 'scripts/run-gates.sh', /# >>> harness:gates[\s\S]*?# <<< harness:gates/, GATE_BLOCK);
  if (bind) edit(dir, TEST_COPY, IDS_LINE, "const IDS = ['P2-20', 'EP-27', 'CR-025b'];");
  if (variant === 'husky') {
    fs.renameSync(path.join(dir, GUARD_COPIES[0]), path.join(dir, '.githooks/harness-guard.sh'));
    fs.rmSync(path.join(dir, GUARD_COPIES[1]));
    fs.mkdirSync(path.join(dir, '.husky'));
    for (const hook of ['pre-commit', 'pre-merge-commit']) fs.writeFileSync(path.join(dir, '.husky', hook), `${HUSKY_CALL}${HUSKY_REST}`, { mode: 0o644 });
    edit(dir, TEST_COPY, GUARD_LINES, "const GUARD = '.githooks/harness-guard.sh';\nconst MERGE_GUARD = '.githooks/harness-guard.sh';");
    edit(dir, TEST_COPY, HOOK_FILES_LINE, "const HOOK_FILES = ['.husky/pre-commit', '.husky/pre-merge-commit'];");
  }
  if (variant === 'checkout') for (const hook of GUARD_COPIES) edit(dir, hook, 'SCOPE="repo"', 'SCOPE="checkout"');
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

function assertAllPass(res, expected) {
  const out = `${res.stdout}${res.stderr}`;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), expected, 'the suite size changed: update SUITES on purpose');
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.strictEqual(tapCount(out, key), 0, key);
}

for (const [name, expected] of Object.entries(SUITES)) {
  test(`${name}: all ${expected} pass, none skipped`, () => {
    assertAllPass(runSuite(install(), name), expected);
  });
}

for (const variant of ['husky', 'checkout']) {
  test(`harness-guard, ${variant} install: all ${SUITES['harness-guard']} pass, none skipped`, () => {
    assertAllPass(runSuite(install({ variant }), 'harness-guard'), SUITES['harness-guard']);
  });
}

test('harness-guard: a plan-mode guard with no ids bound fails, naming the binding', () => {
  const res = runSuite(install({ bind: false }), 'harness-guard');
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stdout, /ID_PATTERN is set but IDS lists no id to hold it to/);
});

console.log('\nharness project tests: each suite fails on a broken install');

/**
 * Install (the `variant` install when given), break one line of the copy a suite tests (each copy when
 * `rel` lists several, as the two hook copies of the guard), and assert the suite fails.
 */
function mutantFails(name, rel, from, to, { variant } = {}) {
  test(`mutant: ${name}`, () => {
    const dir = install({ variant });
    const rels = [].concat(rel);
    for (const r of rels) edit(dir, r, from, to);
    const suite = Object.keys(SUITES).find(s => rels[0].includes(s)) ?? (/^\.(?:githooks|husky)\//.test(rels[0]) ? 'harness-guard' : null);
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
  '\\.env)$/i,',
  '\\.env)$/,',
);
mutantFails(
  'an edit guard that reads a Codex patch header only at column 0, so an indented one gets through',
  '.claude/hooks/edit-guard.mjs',
  '/^\\s*\\*\\*\\* (?:',
  '/^\\*\\*\\* (?:',
);
mutantFails(
  'an edit guard with the old .env pattern, which allows .envrc and prod.env and refuses .env.production.example',
  '.claude/hooks/edit-guard.mjs',
  '/(^|\\/)(?:\\.env(?:rc)?(?:[.~_-](?!(?:[^/]*\\.)?(?:example|sample|template)$)[^/]*)?|[^/]+\\.env)$/i',
  '/(^|\\/)\\.env(\\.(?!example$|sample$|template$)[^/]*)?$/i',
);
mutantFails(
  'a commit guard that never refuses the mainline while a row is held',
  '.githooks/pre-commit',
  'if [ "$lock_here" = 1 ]; then',
  'if false; then',
);
mutantFails(
  'a husky install whose pre-merge-commit no longer calls the guard',
  '.husky/pre-merge-commit',
  HUSKY_CALL,
  '',
  { variant: 'husky' },
);
mutantFails(
  'a husky hook whose guard call is followed by another command, which ends the hook with 0 after a refusal',
  '.husky/pre-merge-commit',
  HUSKY_CALL,
  'sh .githooks/harness-guard.sh\n',
  { variant: 'husky' },
);
mutantFails(
  'a husky hook whose guard call ends `|| exit 0`, which turns a refusal into a pass',
  '.husky/pre-merge-commit',
  HUSKY_CALL,
  'sh .githooks/harness-guard.sh || exit 0\n',
  { variant: 'husky' },
);
mutantFails(
  'a checkout-scope guard that resolves no Worktree cell, so every row locks the main checkout',
  GUARD_COPIES,
  'if [ "$SCOPE" = "checkout" ]; then resolve "$wt"; else res=$curp; fi',
  'res=$curp',
  { variant: 'checkout' },
);
mutantFails(
  'a checkout-scope guard without the merge refusal, so the main checkout merges a branch whose row is held',
  GUARD_COPIES,
  'if [ "$merging" = 1 ] && [ -n "$held" ]; then',
  'if false; then',
  { variant: 'checkout' },
);
mutantFails(
  'a commit guard whose MAINLINE was rebound, which its own suite would read back',
  GUARD_COPIES,
  'MAINLINE="main"',
  'MAINLINE="trunk"',
);
mutantFails(
  'a context budget that reads past a compaction',
  '.claude/hooks/context-budget.mjs',
  'if (isCompaction(line)) return null;',
  '',
);
mutantFails(
  'a context budget whose GATE_TEXT was rebound, which its own suite would read back',
  '.claude/hooks/context-budget.mjs',
  'export const GATE_TEXT = 150_000;',
  'export const GATE_TEXT = 1_000_000;',
);
mutantFails(
  'a context budget whose WARN default was rebound, which its own suite would read back',
  '.claude/hooks/context-budget.mjs',
  'const WARN = Number(process.env.CONTEXT_BUDGET_WARN ?? 220_000);',
  'const WARN = Number(process.env.CONTEXT_BUDGET_WARN ?? 900_000);',
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
