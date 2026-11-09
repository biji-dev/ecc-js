// harness-bootstrap command-guard tests (generated YYYY-MM-DD). Run: node --test scripts/lib/command-guard.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED hook, .claude/hooks/command-guard.mjs,
// with this project's MAINLINE, HOOKS_DIR and EXTRA_RULES, never a copy: through its check() and
// through its own entry point, the way Claude Code calls it. A project rule gets its own case here.
// [B] binding (re-derived per project): the EXPECTED line below. It holds the same values as the
// hook's MAINLINE and HOOKS_DIR [B] lines, and the tests read it, not the import: a hook whose
// binding was changed fails here instead of testing itself against its own values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  for (const c of ['git commit --no-verify -m x', 'git commit -n -m x', 'HUSKY=0 git commit -m x', 'git merge --no-verify topic', 'git pull --no-verify', 'HUSKY=0 git pull']) {
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

test('env -S, a shell\'s options after -c and the other shells do not hide a bypass', () => {
  for (const c of ["env -S 'git commit --no-verify -m x'", "env -S '# note' git commit -n -m x", "env -S 'FOO=\"a b\" git commit -n -m x'", 'env -P /usr/bin git commit -n -m x', "bash -c -x 'git commit -n -m x'", "bash -c -- 'git commit -n -m x'", "ksh -c 'git commit -n -m x'", "csh -c 'git commit -n -m x'"]) {
    assert.equal(rule(c), 'no-verify', c);
  }
  for (const c of ["env -S 'git status'", "env -S 'echo x; git commit -n -m y'", "bash -c -x 'git commit -m x'", "ksh -c 'git log -n 5'"]) {
    assert.equal(rule(c), null, c);
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

test("HARNESS_LANDING, the owner's override of the landing check, is refused on any command: inline, exported or through env", () => {
  for (const c of ['HARNESS_LANDING=owner git merge --no-ff task', 'export HARNESS_LANDING=owner && git merge --no-ff task', 'env HARNESS_LANDING=owner git commit -m x', 'HARNESS_LANDING= git status', 'HARNESS_LANDING=owner npm test', 'export HARNESS_LANDING=owner | true; git commit -m x']) {
    assert.equal(rule(c), 'landing-override', c);
  }
  assert.equal(rule('git commit -m "HARNESS_LANDING=owner"'), null);
});

test('HARNESS_LANDING set on its own, by a bare export, by readonly or inside a bash -c script is refused; a mention is text', () => {
  for (const c of [
    'HARNESS_LANDING=owner; export HARNESS_LANDING; git commit -m x',
    'export HARNESS_LANDING=owner',
    'HARNESS_LANDING=owner',
    'readonly HARNESS_LANDING=owner',
    "bash -c 'HARNESS_LANDING=owner; export HARNESS_LANDING; git commit -m x'",
    'declare -x HARNESS_LANDING=owner',
    'typeset -x HARNESS_LANDING=owner; git commit -m x',
    'export HARNESS_LANDING; git commit -m x',
  ]) {
    assert.equal(rule(c), 'landing-override', c);
  }
  for (const c of ["git commit -m \"HARNESS_LANDING=owner is the owner's word\"", 'echo HARNESS_LANDING']) assert.equal(rule(c), null, c);
});

test('a git command that sets or drops a host variable the landing check reads is refused, as is an unset of one on a line that runs git', () => {
  for (const c of [
    'HARNESS_HOST=zcode git merge --no-ff task',
    'ZCODE_APP_VERSION=1 git merge --no-ff task',
    'export CLAUDECODE=; git merge --no-ff task',
    'env -u CLAUDECODE git merge --no-ff task',
    'env -i PATH="$PATH" git merge --no-ff task',
    'unset CODEX_THREAD_ID; git commit -m x',
    'env --unset=CODEX_SANDBOX git commit -m x',
    'env - git merge --no-ff task',
    'export -n CLAUDECODE; git merge --no-ff task',
  ]) {
    assert.equal(rule(c), 'host-override', c);
  }
  assert.equal(rule('HARNESS_HOST=kimi node scripts/harness-host.mjs'), null, 'a host variable on a command that is not git');
});

test('the hooks path stays put on every git subcommand: -c core.hooksPath, and a PATH that can pick the guard\'s node; NODE_OPTIONS and NODE_PATH never reach it', () => {
  for (const c of [
    'PATH=/tmp/x:$PATH git merge --no-ff task',
    'PATH=/tmp/x:$PATH; git commit -m x',
    'git -c core.hooksPath=/dev/null update-ref refs/heads/main task',
    'git -c core.hooksPath=/dev/null reset --hard task',
  ]) {
    assert.equal(rule(c), 'hooks-path-override', c);
  }
  for (const c of ['PATH=/opt/x:$PATH node build.js', 'NODE_OPTIONS=--max-old-space-size=4096 npm run build', 'env -u NODE_OPTIONS node x.js', 'FOO=1; export FOO; git status', 'NODE_OPTIONS=--require=./x.js git commit -m x', 'export NODE_PATH=/x; git commit -m y']) {
    assert.equal(rule(c), null, c);
  }
});

/** Run `fn(at)` with `at(command)` the rule `check` gives in a scratch repository; `at.repo` is its real path. */
function inScratchRepo(fn) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'guard-path-')));
  try {
    const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const at = (c) => check(c, { cwd: repo, currentBranch: TOPIC })?.rule ?? null;
    at.repo = repo;
    fn(at);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test('a PATH that adds only entries outside the repository and the temporary directories is allowed on git, as are NODE_OPTIONS and NODE_PATH', () => {
  inScratchRepo((at) => {
    for (const c of [
      'export PATH="$HOME/.bun/bin:$PATH" && git status',
      'export PATH="$HOME/.bun/bin:$PATH" && git add -A && git commit -m "feat: x"',
      'PATH=/opt/homebrew/bin:$PATH git commit -m x',
      'NODE_OPTIONS=--max-old-space-size=8192 git commit -m x',
      'PATH="$HOME/.local/bin:$PATH" git push origin task',
      'PATH=~/bin:$PATH git commit -m x',
      'PATH=/usr/bin:/bin git commit -m x',
      'export NODE_PATH=/x; git commit -m y',
      'NODE_OPTIONS=--require=./x.js git commit -m x',
    ]) {
      assert.equal(at(c), null, c);
    }
  });
});

test('a PATH entry on git that is empty, relative, temporary, inside the repository or unresolvable is refused; quoted text is data', () => {
  inScratchRepo((at) => {
    for (const c of [
      'PATH=./bin:$PATH git commit -m x',
      'PATH=bin:$PATH git commit -m x',
      'PATH=:$PATH git commit -m x',
      'PATH=$PATH: git commit -m x',
      'PATH=/tmp/x:$PATH git merge --no-ff task',
      'PATH=/private/var/folders/ab/T/x:$PATH git merge --no-ff task',
      'PATH="$TMPDIR/x:$PATH" git commit -m x',
      'PATH="$PWD/bin:$PATH" git commit -m x',
      `PATH=${at.repo}/scripts:$PATH git commit -m x`,
      'PATH="$(mktemp -d):$PATH" git commit -m x',
      'PATH=$FOO:$PATH git commit -m x',
      'export PATH=./x:$PATH; git commit -m x',
      'PATH=./x:$PATH; git commit -m x',
      'PATH="~/bin:$PATH" git commit -m x',
      'HOME=/opt/h PATH=$HOME/bin:$PATH git commit -m x',
    ]) {
      assert.equal(at(c), 'hooks-path-override', c);
    }
    assert.match(check('PATH=:$PATH git commit -m x', { cwd: at.repo, currentBranch: TOPIC }).reason, /puts \(the current directory\) first/);
    for (const c of ['git commit -m "PATH=./x:$PATH"', 'PATH=./x:$PATH npm test']) assert.equal(at(c), null, c);
  });
});

test('an unset of a host variable is refused only on a line that runs git, a bash -c script included', () => {
  for (const c of ['unset CLAUDECODE; git merge --no-ff task', 'unset CODEX_THREAD_ID; git commit -m x', "bash -c 'unset ZCODE_APP_VERSION; git commit -m x'"]) {
    assert.equal(rule(c), 'host-override', c);
  }
  for (const c of ['unset CLAUDECODE', 'unset CLAUDECODE; claude -p "summarise"']) assert.equal(rule(c), null, c);
});

test('every assignment form the guard can see is read: NAME+=, NAME[i]=, and a HUSKY value it cannot resolve', () => {
  inScratchRepo((at) => {
    for (const [c, name] of [
      ['HARNESS_LANDING+=owner git commit -m unread', 'landing-override'],
      ['export HARNESS_LANDING+=owner; git commit -m unread', 'landing-override'],
      ['HARNESS_LANDING[0]=owner git commit -m x', 'landing-override'],
      ['HARNESS_HOST+=zcode git commit -m x', 'host-override'],
      ['CODEX_THREAD_ID+=x git merge --no-ff task', 'host-override'],
      ['GIT_CONFIG_KEY_0+=core.hooksPath git commit -m x', 'hooks-path-override'],
      ['PATH+=:./bin git commit -m x', 'hooks-path-override'],
      ['PATH[0]=./bin; git commit -m x', 'hooks-path-override'],
      ['HUSKY+=0 git commit -m x', 'no-verify'],
      ['HUSKY=$X git commit -m x', 'no-verify'],
    ]) {
      assert.equal(at(c), name, c);
    }
    for (const c of ['PATH+=:/opt/homebrew/bin git commit -m x', 'X+=1; git status']) assert.equal(at(c), null, c);
  });
});

test('a guarded name changed by a form the guard does not read is refused on a line that runs git; a read, git\'s own arguments and a line without git are not', () => {
  inScratchRepo((at) => {
    for (const [c, name] of [
      ['read CLAUDECODE </dev/null; git merge --no-ff task', 'host-override'],
      ["printf -v CLAUDECODE ''; git merge --no-ff task", 'host-override'],
      ["for CLAUDECODE in ''; do git merge --no-ff task; done", 'host-override'],
      ['declare -a CLAUDECODE; git merge --no-ff task', 'host-override'],
      ['f(){ local CLAUDECODE; git merge --no-ff task; }; f', 'host-override'],
      [': ${CLAUDECODE:=}; git merge --no-ff task', 'host-override'],
      ['declare -n r=CLAUDECODE; r=; git merge --no-ff task', 'host-override'],
      ['mapfile -t CLAUDECODE </dev/null; git merge --no-ff task', 'host-override'],
      ['read "CLAUDECODE" </dev/null; git merge --no-ff task', 'host-override'],
      ["bash -c 'read CLAUDECODE </dev/null; git merge --no-ff task'", 'host-override'],
      ['exec -c git merge --no-ff task', 'host-override'],
      ['set -a; read HARNESS_LANDING <<< owner; git commit -m x', 'landing-override'],
      ['for HARNESS_LANDING in owner; do git commit -m x; done', 'landing-override'],
      [': ${HARNESS_LANDING:=owner}; git commit -m x', 'landing-override'],
      ['read PATH <<< ./bin; git commit -m x', 'hooks-path-override'],
      ['for GIT_CONFIG_COUNT in 1; do git commit -m x; done', 'hooks-path-override'],
      ['read HUSKY <<< 0; git commit -m x', 'no-verify'],
    ]) {
      assert.equal(at(c), name, c);
    }
    const reason = (c) => check(c, { cwd: at.repo, currentBranch: TOPIC })?.reason;
    // A name only named gets the advice that works: split the line (quoting a one-word name does not).
    for (const [c, name] of [
      ['read PATH <<< ./bin; git commit -m x', 'PATH'],
      ['git diff && rg -n HARNESS_LANDING scripts', 'HARNESS_LANDING'],
      ['git log --oneline && grep -n "CLAUDECODE" README.md', 'CLAUDECODE'],
    ]) {
      assert.match(reason(c), new RegExp(`^\`${name}\` is named by another command on a line that runs git.*Run that command and git as separate commands`), c);
    }
    assert.match(reason('unset CODEX_THREAD_ID; git commit -m x'), /^the landing check reads the host/);
    assert.match(reason('HARNESS_LANDING=owner; git commit -m x'), /^HARNESS_LANDING is the owner's override/);
    for (const c of [
      'echo $PATH; git status',
      'echo "${PATH:-}"; git status',
      'for p in ${PATH//:/ }; do ls $p; done; git status',
      'echo $CLAUDECODE; git status',
      'git log --grep PATH',
      'git grep -n HARNESS_LANDING',
      'git commit -m "docs: HARNESS_LANDING and CLAUDECODE"',
      'read CLAUDECODE </dev/null; claude -p x',
      'grep -rn HARNESS_LANDING docs',
    ]) {
      assert.equal(at(c), null, c);
    }
  });
});

test('a bare export keeps the shell\'s value, and only the PATH git runs with is read: its values composed in order', () => {
  inScratchRepo((at) => {
    for (const c of ['export PATH; git status --short', 'export PATH=./node_modules/.bin:$PATH; export PATH=/usr/bin:/bin; git status --short', 'export FOO; FOO=1; git status']) {
      assert.equal(at(c), null, c);
    }
    const composed = 'export PATH=./x:$PATH; export PATH=/usr/bin:$PATH; git commit -m x';
    assert.equal(at(composed), 'hooks-path-override', composed);
    assert.match(check(composed, { cwd: at.repo, currentBranch: TOPIC }).reason, /puts \.\/x first/);
  });
});

test('HUSKY=0 is refused on every git subcommand: husky skips reference-transaction under it too', () => {
  for (const c of ['HUSKY=0 git reset --hard task', 'HUSKY=0 git update-ref refs/heads/main task', 'HUSKY=0; export HUSKY; git branch -f main task', 'export HUSKY=1; bash -c "HUSKY=0; git reset --hard task"']) {
    assert.equal(rule(c), 'no-verify', c);
  }
});

test('the install command may set the hooks path absolute; any other absolute or relative value is refused', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'guard-install-')));
  try {
    const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const at = (c) => check(c, { cwd: repo, currentBranch: TOPIC })?.rule ?? null;
    const dir = EXPECTED.HOOKS_DIR;
    for (const c of [`git config core.hooksPath "$(git rev-parse --show-toplevel)/${dir}"`, `git config core.hooksPath ${repo}/${dir}`, `git config core.hooksPath ${dir}`]) {
      assert.equal(at(c), null, c);
    }
    for (const c of [`git config core.hooksPath /tmp/x/${dir}`, `git config core.hooksPath "$PWD/${dir}"`, `git config core.hooksPath ../other/${dir}`, `git config core.hooksPath '$(git rev-parse --show-toplevel)/${dir}'`]) {
      assert.equal(at(c), 'hooks-path-override', c);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a merge into a mainline branch that could fast-forward is refused; --no-ff, --abort, --squash and a remote mainline are not', () => {
  for (const m of EXPECTED.MAINLINE) {
    for (const c of ['git merge task', 'git merge --no-ff --ff-only task', 'git merge --no-ff --ff task', 'git merge -m "merge task" task', 'git merge task origin/main']) {
      assert.equal(rule(c, m), 'merge-ff-mainline', `${c} on ${m}`);
    }
    for (const c of ['git merge --no-ff task', 'git merge --ff-only --no-ff task', 'git merge --abort', 'git merge --continue', 'git merge --quit', 'git merge --squash task', `git merge origin/${m}`, 'git merge --ff-only @{u}', 'git merge @{upstream}']) {
      assert.equal(rule(c, m), null, `${c} on ${m}`);
    }
  }
  assert.equal(rule('git merge task', TOPIC), null, 'a merge on a branch that is not a mainline');
});

test('a pull from the local repository onto a mainline branch is a local merge and is refused', () => {
  for (const m of EXPECTED.MAINLINE) {
    for (const c of ['git pull . task', 'git pull --no-rebase . task']) assert.equal(rule(c, m), 'merge-ff-mainline', `${c} on ${m}`);
    for (const c of ['git pull', `git pull origin ${m}`, `git pull --rebase origin ${m}`]) assert.equal(rule(c, m), null, `${c} on ${m}`);
  }
  assert.equal(rule('git pull . task', TOPIC), null, 'a local pull on a branch that is not a mainline');
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

test('an inline GIT_CONFIG_* that can replace core.hooksPath is refused on any git subcommand', () => {
  for (const c of [
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hookspath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
    `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=CORE.HOOKSPATH GIT_CONFIG_VALUE_0=/dev/null git push origin ${TOPIC}`,
    `GIT_CONFIG_PARAMETERS="'core.hooksPath'='/dev/null'" git commit -m x`,
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="$K" GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
    'git -c core.hooksPath=/dev/null pull',
    'GIT_CONFIG_PARAMETERS=x git status',
  ]) {
    assert.equal(rule(c), 'hooks-path-override', c);
  }
  for (const c of ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=p git commit -m x', 'git commit -m "GIT_CONFIG_KEY_0=core.hooksPath"']) {
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
