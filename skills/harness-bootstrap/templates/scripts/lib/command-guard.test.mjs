// harness-bootstrap command-guard tests (generated YYYY-MM-DD). Run: node --test scripts/lib/command-guard.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED hook, .claude/hooks/command-guard.mjs,
// with this project's MAINLINE, HOOKS_DIR and EXTRA_RULES, never a copy: through its check() and
// through its own entry point, the way Claude Code calls it. A project rule gets its own case here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOK = fileURLToPath(new URL('../../.claude/hooks/command-guard.mjs', import.meta.url));
// Imported by its path at run time: the hook exists in the project, never beside this template.
const { EXTRA_RULES, HOOKS_DIR, MAINLINE, check } = await import(pathToFileURL(HOOK).href);
const TOPIC = 'harness/guard-probe';
const rule = (command, currentBranch = TOPIC) => check(command, { currentBranch })?.rule ?? null;

test('a hook bypass on commit, merge or pull is refused; a message that mentions one is text', () => {
  for (const c of ['git commit --no-verify -m x', 'git commit -n -m x', 'HUSKY=0 git commit -m x', 'git merge --no-verify topic', 'git pull --no-verify']) {
    assert.equal(rule(c), 'no-verify', c);
  }
  for (const c of ['git commit -m "mentions --no-verify"', "git commit -F - <<'EOF'\nskip it with --no-verify\nEOF", 'git merge -n topic']) {
    assert.equal(rule(c), null, c);
  }
});

test('wrappers, paths and chains do not hide a bypass', () => {
  for (const c of ['cd /tmp && git commit --no-verify -m x', 'env FOO=1 git commit --no-verify -m x', 'bash -c "git commit --no-verify -m x"', '/usr/bin/git commit --no-verify -m x', 'git status; git commit "--no-verify" -m x']) {
    assert.equal(rule(c), 'no-verify', c);
  }
});

test('the hooks path stays put: only `git config core.hooksPath <HOOKS_DIR>` is allowed', () => {
  assert.equal(rule(`git config core.hooksPath ${HOOKS_DIR}`), null);
  for (const c of ['git config core.hooksPath /tmp/x', 'git config --unset core.hooksPath', `git config --global core.hooksPath ${HOOKS_DIR}`, 'git -c core.hooksPath=/dev/null commit -m x']) {
    assert.equal(rule(c), 'hooks-path-override', c);
  }
});

test('a force push or a delete of each mainline branch is refused; a topic branch is not', () => {
  assert.ok(MAINLINE.length > 0, 'MAINLINE is empty: no branch is protected');
  for (const m of MAINLINE) {
    for (const c of [`git push --force origin ${m}`, `git push -f origin ${m}`, `git push origin +${m}`]) assert.equal(rule(c), 'force-push-mainline', c);
    for (const c of [`git push origin :${m}`, `git push origin --delete ${m}`]) assert.equal(rule(c), 'delete-mainline', c);
    assert.equal(rule('git push --force', m), 'force-push-mainline', `a bare force push while on ${m}`);
  }
  for (const c of [`git push origin ${TOPIC}`, `git push --force-with-lease origin ${TOPIC}`, 'git push --force']) assert.equal(rule(c), null, c);
});

test('each project rule has a name, a test and a reason', () => {
  for (const r of EXTRA_RULES) {
    assert.ok(typeof r.name === 'string' && r.name !== '', 'a rule without a name');
    assert.equal(typeof r.test, 'function', r.name);
    assert.ok(typeof r.reason === 'string' && r.reason !== '', `${r.name} has no reason`);
  }
});

test('the hook blocks through its own entry point: exit 2 and the BLOCKED line; other tools and bad input pass', () => {
  const pipe = (input) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  const blocked = pipe(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m x' }, cwd: process.cwd() }));
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.match(blocked.stderr, /^BLOCKED \(no-verify\): /);
  assert.equal(pipe(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: process.cwd() })).status, 0);
  assert.equal(pipe(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } })).status, 0);
  assert.equal(pipe('not json').status, 0);
});
