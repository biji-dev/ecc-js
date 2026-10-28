// harness-bootstrap command-guard tests (generated YYYY-MM-DD). Run: node --test scripts/lib/command-guard.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED hook, .claude/hooks/command-guard.mjs,
// with this project's MAINLINE, HOOKS_DIR and EXTRA_RULES, never a copy: through its check() and
// through its own entry point, the way Claude Code calls it. A project rule gets its own case here.
// [B] binding (re-derived per project): the EXPECTED line below. It holds the same values as the
// hook's MAINLINE and HOOKS_DIR [B] lines, and the tests read it, not the import: a hook whose
// binding was changed fails here instead of testing itself against its own values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOK = fileURLToPath(new URL('../../.claude/hooks/command-guard.mjs', import.meta.url));
// Imported by its path at run time: the hook exists in the project, never beside this template.
const { EXTRA_RULES, HOOKS_DIR, MAINLINE, check } = await import(pathToFileURL(HOOK).href);
// [B] The hook's MAINLINE and HOOKS_DIR, as this project binds them.
const EXPECTED = { MAINLINE: ['main', 'master'], HOOKS_DIR: '.githooks' };
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
  assert.equal(rule(`git config core.hooksPath ${EXPECTED.HOOKS_DIR}`), null);
  for (const c of ['git config core.hooksPath /tmp/x', 'git config --unset core.hooksPath', `git config --global core.hooksPath ${EXPECTED.HOOKS_DIR}`, 'git -c core.hooksPath=/dev/null commit -m x']) {
    assert.equal(rule(c), 'hooks-path-override', c);
  }
});

test('a force push or a delete of each mainline branch is refused; a topic branch is not', () => {
  assert.ok(EXPECTED.MAINLINE.length > 0, 'EXPECTED.MAINLINE is empty: no branch is protected');
  for (const m of EXPECTED.MAINLINE) {
    for (const c of [`git push --force origin ${m}`, `git push -f origin ${m}`, `git push origin +${m}`]) assert.equal(rule(c), 'force-push-mainline', c);
    for (const c of [`git push origin :${m}`, `git push origin --delete ${m}`]) assert.equal(rule(c), 'delete-mainline', c);
    assert.equal(rule('git push --force', m), 'force-push-mainline', `a bare force push while on ${m}`);
  }
  for (const c of [`git push origin ${TOPIC}`, `git push --force-with-lease origin ${TOPIC}`, 'git push --force']) assert.equal(rule(c), null, c);
});

test('the hook binds the MAINLINE and HOOKS_DIR this test expects', () => {
  assert.deepEqual({ MAINLINE, HOOKS_DIR }, EXPECTED, 'the hook\'s [B] lines differ from EXPECTED: bind both the same');
});

test('git push --no-verify (or --no-veri) and HUSKY=0 on a push are refused; push -n and --no-ver are not', () => {
  for (const c of [`git push --no-verify origin ${TOPIC}`, `git push --no-veri origin ${TOPIC}`, `git push origin ${TOPIC} --no-verify`, `HUSKY=0 git push origin ${TOPIC}`]) {
    assert.equal(rule(c), 'no-verify', c);
  }
  // -n is --dry-run (pre-push still runs); --no-ver is ambiguous and git refuses it; an -o value is text.
  for (const c of [`git push -n origin ${TOPIC}`, `git push --no-ver origin ${TOPIC}`, `git push -o --no-verify origin ${TOPIC}`]) {
    assert.equal(rule(c), null, c);
  }
});

test('an inline GIT_CONFIG_* that can replace core.hooksPath is refused on a hook-running subcommand', () => {
  for (const c of [
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hookspath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
    `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=CORE.HOOKSPATH GIT_CONFIG_VALUE_0=/dev/null git push origin ${TOPIC}`,
    `GIT_CONFIG_PARAMETERS="'core.hooksPath'='/dev/null'" git commit -m x`,
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="$K" GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
    'git -c core.hooksPath=/dev/null pull',
  ]) {
    assert.equal(rule(c), 'hooks-path-override', c);
  }
  for (const c of ['GIT_CONFIG_PARAMETERS=x git status', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=p git commit -m x', 'git commit -m "GIT_CONFIG_KEY_0=core.hooksPath"']) {
    assert.equal(rule(c), null, c);
  }
});

test('an export earlier in the same shell and the environment of a bash -c script reach the git command; a subshell\'s export and an overridden value do not', () => {
  assert.equal(rule('export HUSKY=0; git commit -m x'), 'no-verify', 'export HUSKY=0; git commit');
  assert.equal(rule('{ export HUSKY=0; }; git commit -m x'), 'no-verify', 'a { } group is the same shell');
  assert.equal(rule('export GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_COUNT=1 GIT_CONFIG_VALUE_0=/dev/null && git commit -m x'), 'hooks-path-override', 'export GIT_CONFIG_*');
  assert.equal(rule('HUSKY=0 bash -c "git commit -m x"'), 'no-verify', 'HUSKY=0 bash -c');
  assert.equal(rule('export FOO=1; git commit -m x'), null, 'a harmless export');
  for (const c of ['(export HUSKY=0); git commit -m x', 'export HUSKY=0 | true; git commit -m x']) {
    assert.equal(rule(c), null, `the export stays in its subshell: ${c}`);
  }
  assert.equal(rule('export HUSKY=0; HUSKY=1 git commit -m x'), null, 'the later HUSKY=1 is the value git gets');
});

test('git behind a wrapper with options is still read: command -p, exec -a, time -p, time -o', () => {
  for (const c of ['command -p git commit -n -m x', 'exec -a x git commit -n -m x', 'time -p git commit -n -m x', 'time -o /tmp/t git commit -n -m x', `nohup git push --no-verify origin ${TOPIC}`]) {
    assert.equal(rule(c), 'no-verify', c);
  }
  assert.equal(rule('command -v git'), null);
});

test('command -v and -V look a name up and run nothing; command -p and -- still run it', () => {
  for (const c of ['command -v codex &', 'command -V codex &', 'command -pv codex &', 'command -v git commit -n -m x', 'command -v -- git push --no-verify origin topic']) {
    assert.equal(rule(c), null, c);
  }
  for (const c of ['command -p git commit -n -m x', 'command -- git commit -n -m x']) assert.equal(rule(c), 'no-verify', c);
  assert.equal(rule('command -p codex exec x &'), 'codex-background');
});

test('a merge --no-verify after a `--` that an option took as its value is refused', () => {
  for (const c of ['git merge -m -- --no-verify topic', 'git merge -- --no-verify topic']) assert.equal(rule(c), 'no-verify', c);
  for (const c of ['git merge --no-verify-signatures topic', 'git merge -n topic']) assert.equal(rule(c), null, c);
});

test('a Codex run sent to the background with a shell `&` is refused; a foreground run and `&>` or `|&` are not', () => {
  for (const c of [
    'codex exec x &',
    '(codex exec x) &',
    'nohup codex exec - < b.md > o.md 2>&1 &',
    'node scripts/codex-run.mjs review &',
    'codex exec x && echo ok &',
    '(echo start; codex exec x &)',
    'bash -c "codex exec x" &',
    'bash -c "codex exec x &"',
    'bun scripts/claude-run.mjs build &',
    '{ codex exec x; } &',
    'codex exec x &&\n echo ok &',
    'node --title harness scripts/codex-run.mjs review &',
  ]) {
    assert.equal(rule(c), 'codex-background', c);
  }
  for (const c of ['codex exec x', 'codex exec x && echo ok', 'node scripts/codex-run.mjs review', 'codex exec x &> log', 'codex exec x &>> log', 'codex exec x |& tee log', 'echo codex &']) {
    assert.equal(rule(c), null, c);
  }
});

test('a project rule is handed the command\'s env and whether it runs in the background', () => {
  const seen = [];
  const probe = {
    name: 'guard-probe-rule',
    test: (c) => {
      seen.push(c);
      return c.argv[0] === 'guard-probe' && c.background === true && c.env.ALLOW !== '1';
    },
    reason: 'probe',
  };
  EXTRA_RULES.push(probe);
  try {
    assert.equal(rule('guard-probe run &'), 'guard-probe-rule', 'a backgrounded probe without ALLOW=1 is refused');
    assert.equal(rule('ALLOW=1 guard-probe run &'), null, 'ALLOW=1 is the owner escape');
    assert.equal(rule('export ALLOW=1; guard-probe run &'), null, 'an exported ALLOW=1 counts');
    assert.equal(rule('guard-probe run'), null, 'a foreground run is not refused');
    seen.length = 0;
    rule('export A=1; B="two words" A=2 guard-probe run');
    const last = seen.at(-1);
    assert.deepEqual({ ...last.env }, { A: '2', B: 'two words' }, 'env: exported, then inline; values unquoted; a later one wins');
    assert.equal(last.background, false);
  } finally {
    EXTRA_RULES.splice(EXTRA_RULES.indexOf(probe), 1);
  }
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

test('the push, inline-env and background refusals block through the entry point', () => {
  const pipe = (command) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: process.cwd() }), encoding: 'utf8' });
  for (const [c, name] of [
    [`git push --no-verify origin ${TOPIC}`, 'no-verify'],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x', 'hooks-path-override'],
    ['codex exec x &', 'codex-background'],
  ]) {
    const r = pipe(c);
    assert.equal(r.status, 2, c);
    assert.match(r.stderr, new RegExp(`^BLOCKED \\(${name}\\): `), c);
  }
  assert.equal(pipe('codex exec x &> log').status, 0, 'codex exec x &> log');
});
