// harness-bootstrap command-guard tests (generated YYYY-MM-DD). Run: node --test scripts/lib/command-guard.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED hook, .claude/hooks/command-guard.mjs,
// with this project's MAINLINE, HOOKS_DIR and EXTRA_RULES, never a copy: through its check() and
// through its own entry point, the way Claude Code calls it. A project rule gets its own case here.
// [B] binding (re-derived per project): the EXPECTED line below. It holds the same values as the
// hook's MAINLINE and HOOKS_DIR [B] lines, and the tests read it, not the import: a hook whose
// binding was changed fails here instead of testing itself against its own values.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOK = fileURLToPath(new URL('../../.claude/hooks/command-guard.mjs', import.meta.url));
// Imported by its path at run time: the hook exists in the project, never beside this template.
const { EXTRA_RULES, HOOKS_DIR, MAINLINE, askable, check, decide } = await import(pathToFileURL(HOOK).href);
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
    // A name set by a form the guard does not read gets the advice that works: split the line.
    for (const [c, name] of [
      ['read PATH <<< ./bin; git commit -m x', 'PATH'],
      ['for GIT_CONFIG_COUNT in 1; do git commit -m x; done', 'GIT_CONFIG_COUNT'],
      ['echo HUSKY; git commit -m x', 'HUSKY'],
    ]) {
      assert.equal(reason(c), `\`${name}\` is named by another command on a line that runs git, in a form the guard does not read. A search (grep, rg, cat, head, tail) that prints to the terminal, alone or piped only into other searches, may name it; run anything else apart from git. An agent never changes \`${name}\`.`, c);
    }
    assert.match(reason('unset CODEX_THREAD_ID; git commit -m x'), /^the landing check reads the host/);
    assert.match(reason('HARNESS_LANDING=owner; git commit -m x'), /^HARNESS_LANDING is the owner's override.*Run it alone, as one line: HARNESS_LANDING=owner git merge --no-ff <branch>\.$/);
    // A name only mentioned (a search pattern, a printed value) is not a change to it.
    for (const c of [
      'git diff && rg -n HARNESS_LANDING scripts',
      'git log --oneline && grep -n "CLAUDECODE" README.md',
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

/**
 * Run `fn(repo)` in a scratch repository whose AGENTS.md merge block says `Push deploys: <deploys>`
 * (null: no AGENTS.md); `files` are written into it as well.
 */
function inDeployRepo(deploys, fn, files = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'guard-owner-')));
  try {
    const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    if (deploys !== null) {
      files['AGENTS.md'] = ['# Agents', '', '<!-- harness:begin merge -->', 'Grant: none', `Push deploys: ${deploys}`, '<!-- harness:end merge -->', ''].join('\n');
    }
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(repo, rel, '..'), { recursive: true });
      writeFileSync(join(repo, rel), text);
    }
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

const M = EXPECTED.MAINLINE[0];
// The environment and input in which Claude Code asks the owner.
const ASK_ENV = { CLAUDE_PROJECT_DIR: '/project' };
const ASK_INPUT = (command) => ({ tool_name: 'Bash', tool_input: { command }, permission_mode: 'auto' });

test('the owner key: the single-line landing override and a push that deploys are owner-class; nothing beside them is', () => {
  inDeployRepo('yes', (repo) => {
    const at = (c, currentBranch = TOPIC) => check(c, { cwd: repo, currentBranch });
    for (const c of ['HARNESS_LANDING=owner git merge --no-ff task/x', 'HARNESS_LANDING=\'owner\' git commit -m "x"']) {
      assert.deepEqual({ ...at(c) }, { rule: 'landing-override', reason: at(c).reason, owner: true }, c);
    }
    assert.equal(at(`git push origin ${M}`)?.owner, true, `git push origin ${M}`);
    assert.equal(at(`git push origin ${M}`)?.rule, 'push-deploys');
    assert.equal(at('git push', M)?.owner, true, `a bare push on ${M}`);
    for (const c of [
      'HARNESS_LANDING=owner git merge x && git push',
      'HARNESS_LANDING=owner git -c core.hooksPath=/dev/null merge x',
      'export HARNESS_LANDING=owner; git merge x',
      'HARNESS_LANDING=yes git merge x',
      "HARNESS_LANDING=owner bash -c 'git merge x'",
      `HARNESS_LANDING=owner git push origin ${M}`,
      'HARNESS_LANDING=owner git commit -m "$(cat msg)"',
    ]) {
      const hit = at(c);
      assert.equal(hit?.rule, 'landing-override', c);
      assert.equal(hit.owner, undefined, `not owner-class: ${c}`);
    }
    // Every other rule runs on the owner form first.
    assert.equal(at('HARNESS_LANDING=owner git merge --no-verify --no-ff task/x')?.rule, 'no-verify');
    assert.equal(at('HARNESS_LANDING=owner git merge task/x', M)?.rule, 'merge-ff-mainline');
    assert.equal(at(`git push origin ${M} && git commit -n -m x`)?.rule, 'no-verify', 'another command\'s refusal wins over a deploying push');
    assert.equal(at(`git push origin ${TOPIC}`), null, 'a push of a topic branch');
  });
  inDeployRepo('no', (repo) => assert.equal(check(`git push origin ${M}`, { cwd: repo, currentBranch: TOPIC }), null, 'Push deploys: no'));
  inDeployRepo(null, (repo) => assert.equal(check(`git push origin ${M}`, { cwd: repo, currentBranch: TOPIC }), null, 'no AGENTS.md'));
});

test('a background wait with no bound is refused; a foreground one, and one a timeout encloses, are not', () => {
  const at = (c, background = false) => check(c, { currentBranch: TOPIC, background })?.rule ?? null;
  for (const [c, background] of [
    ['until grep -q x f; do sleep 3; done', true],
    ['tail -f log &', false],
    ['while :; do sleep 5; done &', false],
    ['watch -n 5 ls', true],
    ['tail -n 20 -F log', true],
    ["bash -c 'tail --follow=name log' &", false],
    ['until timeout 5 grep -q x f; do sleep 1; done', true],
  ]) {
    assert.equal(at(c, background), 'unbounded-wait', `${c} (background: ${background})`);
  }
  for (const [c, background] of [
    ['tail -f log', false],
    ['until grep -q x f; do sleep 1; done', false],
    ["timeout 600 bash -c 'until grep -q x f; do sleep 3; done'", true],
    ['gtimeout 60 tail -f log &', false],
    ['tail -n 5 log', true],
    ['sleep 30', true],
  ]) {
    assert.equal(at(c, background), null, `${c} (background: ${background})`);
  }
  assert.match(check('tail -f log &', { currentBranch: TOPIC }).reason, /^a background wait with no bound runs until someone kills it\. Bound it with timeout <seconds>/);
});

test('inside a host subagent, a FULL run of run-gates.sh is refused; a scoped run, a listing and the session\'s own run are not', () => {
  const at = (c, agentId) => check(c, { currentBranch: TOPIC, agentId })?.rule ?? null;
  for (const c of ['bash scripts/run-gates.sh', 'bash ./scripts/run-gates.sh --no-cache', 'scripts/run-gates.sh --snapshot', "bash -c 'bash scripts/run-gates.sh'"]) {
    assert.equal(at(c, 'agent-1'), 'full-verify-executor', c);
  }
  for (const c of ['bash scripts/run-gates.sh --since main', 'bash scripts/run-gates.sh --list', 'cat scripts/run-gates.sh']) assert.equal(at(c, 'agent-1'), null, c);
  assert.equal(at('bash scripts/run-gates.sh', null), null, 'no agentId: the session runs FULL');
  assert.equal(check('bash scripts/run-gates.sh', { agentId: 'a' }).reason, "FULL is the session's, once at landing; an executor runs bash scripts/run-gates.sh --since <the slice's base>");
});

test('a guarded name is refused on a git line where it is set, and where a command other than a search that prints names it', () => {
  inScratchRepo((at) => {
    for (const [c, name] of [
      ['read PATH; git commit -m x', 'hooks-path-override'],
      ['export HARNESS_HOST=x; git commit -m x', 'host-override'],
      ['for PATH in /tmp; do git commit -m x; done', 'hooks-path-override'],
      ['let HUSKY=0; git commit -m x', 'no-verify'],
      ['select CLAUDECODE in a; do git commit -m x; done', 'host-override'],
      ['printf -v PATH %s ./bin; git commit -m x', 'hooks-path-override'],
      ['getopts ab HARNESS_LANDING; git commit -m x', 'landing-override'],
      // a name a command that is not a search names can become the name of a set (js.14 fix round)
      ['printf "%s\\n" PATH && git status', 'hooks-path-override'],
      ['echo CLAUDECODE HUSKY; git status', 'host-override'],
    ]) {
      assert.equal(at(c), name, c);
    }
    for (const c of ['grep -rn HARNESS_LANDING docs && git status', 'echo "$PATH" && git commit -m x']) {
      assert.equal(at(c), null, c);
    }
  });
});

test('decide: an owner hit asks where Claude Code can ask, and is refused with the command for the owner everywhere else', () => {
  inDeployRepo('yes', (repo) => {
    const command = 'HARNESS_LANDING=owner git commit -m x';
    const hit = check(command, { cwd: repo, currentBranch: TOPIC });
    const asked = decide(hit, { input: ASK_INPUT(command), env: ASK_ENV });
    assert.equal(asked.exit, 0);
    assert.deepEqual(JSON.parse(asked.stdout), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: "Owner key: commit past the commit guard's landing check. Approve to run it as the owner." } });
    const push = check(`git push origin ${M}`, { cwd: repo, currentBranch: TOPIC });
    assert.equal(JSON.parse(decide(push, { input: ASK_INPUT(`git push origin ${M}`), env: ASK_ENV }).stdout).hookSpecificOutput.permissionDecisionReason, `Owner key: this push to ${M} deploys (AGENTS.md: Push deploys: yes). Approve to push.`);
    for (const [input, env, why] of [
      [{ ...ASK_INPUT(command), permission_mode: 'bypassPermissions' }, ASK_ENV, 'bypassPermissions'],
      [{ ...ASK_INPUT(command), permission_mode: 'dontAsk' }, ASK_ENV, 'dontAsk'],
      [ASK_INPUT(command), { ...ASK_ENV, CODEX_THREAD_ID: 't' }, 'CODEX_THREAD_ID'],
      [ASK_INPUT(command), { ...ASK_ENV, ZCODE_PROJECT_DIR: '/p' }, 'ZCODE_PROJECT_DIR'],
      [ASK_INPUT(command), {}, 'no CLAUDE_PROJECT_DIR'],
      [{ tool_name: 'Bash', tool_input: { command } }, ASK_ENV, 'no permission_mode'],
    ]) {
      const r = decide(hit, { input, env });
      assert.equal(r.exit, 2, why);
      assert.equal(r.stdout, undefined, why);
      assert.ok(r.stderr.startsWith('BLOCKED (landing-override): '), why);
      assert.ok(r.stderr.endsWith(` The owner runs it: \`! ${command}\`.\n`), `${why}: ${r.stderr}`);
      assert.equal(askable(input, env), false, why);
    }
    assert.deepEqual(decide(null, { input: ASK_INPUT('git status'), env: ASK_ENV }), { exit: 0 });
    const plain = decide(check('git commit -n -m x', { cwd: repo, currentBranch: TOPIC }), { input: ASK_INPUT('git commit -n -m x'), env: ASK_ENV });
    assert.equal(plain.exit, 2, 'a hit that is not owner-class is refused even where the host can ask');
    assert.ok(!plain.stderr.includes('The owner runs it'), plain.stderr);
  });
});

test('the merge ask text carries the landing check\'s first line, run without NODE_* and clipped to one line of 300 characters', () => {
  const gate = "const n = Object.keys(process.env).filter((k) => k.startsWith('NODE_')).length;\nconsole.log(`Landing: ${process.argv.slice(2).join(' ')} node-vars ${n}${process.argv.includes('long') ? 'x'.repeat(400) : ''}`);\nconsole.log('second line');\n";
  inDeployRepo(null, (repo) => {
    const ask = (c) => JSON.parse(decide(check(c, { cwd: repo, currentBranch: TOPIC }), { input: ASK_INPUT(c), env: ASK_ENV }).stdout).hookSpecificOutput.permissionDecisionReason;
    process.env.NODE_GUARD_PROBE = '1';
    try {
      assert.equal(ask('HARNESS_LANDING=owner git merge --no-ff task/x'), `Owner key: merge past the landing check. Landing: --landing task/x --base ${TOPIC} node-vars 0 Approve to run it as the owner.`);
      const long = ask('HARNESS_LANDING=owner git merge --no-ff long');
      assert.ok(long.length <= 300 && long.endsWith(' Approve to run it as the owner.') && !long.includes('\n'), long);
    } finally {
      delete process.env.NODE_GUARD_PROBE;
    }
    assert.equal(ask('HARNESS_LANDING=owner git merge --no-ff a b'), 'Owner key: merge past the landing check. (landing check not run) Approve to run it as the owner.', 'two branches');
  }, { 'scripts/review-gate.mjs': gate });
  inDeployRepo(null, (repo) => {
    const c = 'HARNESS_LANDING=owner git merge --no-ff task/x';
    const r = decide(check(c, { cwd: repo, currentBranch: TOPIC }), { input: ASK_INPUT(c), env: ASK_ENV });
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, 'Owner key: merge past the landing check. (landing check not run) Approve to run it as the owner.', 'no review-gate.mjs');
  });
});

test('the hook asks through its own entry point, and reads run_in_background and agent_id from its input', () => {
  inDeployRepo(null, (repo) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CODEX_THREAD_ID' && !k.startsWith('ZCODE_')));
    const pipe = (input, extra = {}) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', cwd: repo, ...input }), encoding: 'utf8', env: { ...env, ...extra } });
    const asked = pipe({ tool_input: { command: 'HARNESS_LANDING=owner git commit -m x' }, permission_mode: 'default' }, { CLAUDE_PROJECT_DIR: repo });
    assert.equal(asked.status, 0, asked.stderr);
    assert.equal(JSON.parse(asked.stdout).hookSpecificOutput.permissionDecision, 'ask');
    const refused = pipe({ tool_input: { command: 'HARNESS_LANDING=owner git commit -m x' }, permission_mode: 'bypassPermissions' }, { CLAUDE_PROJECT_DIR: repo });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /^BLOCKED \(landing-override\): .* The owner runs it: `! HARNESS_LANDING=owner git commit -m x`\.$/m);
    const bg = pipe({ tool_input: { command: 'tail -f log', run_in_background: true } });
    assert.equal(bg.status, 2);
    assert.match(bg.stderr, /^BLOCKED \(unbounded-wait\): /);
    assert.equal(pipe({ tool_input: { command: 'tail -f log' } }).status, 0, 'the same tail in the foreground');
    const sub = pipe({ tool_input: { command: 'bash scripts/run-gates.sh' }, agent_id: 'agent-1' });
    assert.equal(sub.status, 2);
    assert.match(sub.stderr, /^BLOCKED \(full-verify-executor\): /);
    assert.equal(pipe({ tool_input: { command: 'bash scripts/run-gates.sh' } }).status, 0, 'the session\'s own FULL run');
  });
});

test('a guarded name a command other than a search names on a git line is refused: it can become the name of a set', () => {
  inScratchRepo((at) => {
    for (const [c, name] of [
      ['name=HARNESS_HOST; export "$name=human"; git commit --allow-empty -m x', 'host-override'],
      [`n=GIT_CONFIG_PARAMETERS; export "$n='core.hooksPath'='/dev/null'"; git commit --allow-empty -m x`, 'hooks-path-override'],
      ['source HARNESS_LANDING; git commit -m x', 'landing-override'],
      ['. HARNESS_LANDING; git commit -m x', 'landing-override'],
      ['BASH_ENV=HARNESS_LANDING bash -c "git commit -m x"', 'landing-override'],
      ['zsh -c "vared HARNESS_LANDING; git commit -m x"', 'landing-override'],
      ['zsh -c "sysread -o HARNESS_LANDING; git commit -m x"', 'landing-override'],
      ["rg -o HARNESS_LANDING f | xargs -I{} sh -c 'git commit -m x'", 'landing-override'],
      ['n=$(grep -o HUSKY f); export "$n=0"; git commit -m x', 'no-verify'],
      ['grep HUSKY f > x.sh; git commit -m x', 'no-verify'],
      // a search whose output does not reach the terminal, or that runs a command of its own
      ['grep HUSKY f >> x.sh; git commit -m x', 'no-verify'],
      ['grep HUSKY f 1> x.sh; git commit -m x', 'no-verify'],
      ['grep HUSKY f &> x.sh; git commit -m x', 'no-verify'],
      ['grep HUSKY f >/dev/null 2>&1; git commit -m x', 'no-verify'],
      ['(grep HUSKY f) > x.sh; git commit -m x', 'no-verify'],
      ['{ grep HUSKY f; } > x.sh; git commit -m x', 'no-verify'],
      ['n=`grep -o HUSKY f`; git commit -m x', 'no-verify'],
      ['eval "grep HUSKY f"; git commit -m x', 'no-verify'],
      ['rg --pre=./x HUSKY f; git commit -m x', 'no-verify'],
      ['grep --filter=./x HUSKY f; git commit -m x', 'no-verify'],
      ['sed -n /HUSKY/p f; git commit -m x', 'no-verify'],
      // piped into a command that is not a search, or a pipeline that ends in a file
      ['grep -rn HUSKY docs | head -5 > out; git commit -m x', 'no-verify'],
      ['grep HUSKY f | xargs echo; git status', 'no-verify'],
      ['grep HUSKY f | sh; git status', 'no-verify'],
      ['grep HUSKY f | tee out; git status', 'no-verify'],
      ['(grep HUSKY f | head) | sh; git status', 'no-verify'],
      ['grep HUSKY f | { head; sh; }; git status', 'no-verify'],
      // a terminal search still counts a set form
      ['grep ${HARNESS_LANDING:=owner} f; git commit -m x', 'landing-override'],
      ['HARNESS_LANDING=owner grep x f; git commit -m x', 'landing-override'],
    ]) {
      assert.equal(at(c), name, c);
    }
    // the measured friction: a search beside git that prints what it finds
    for (const c of [
      'git diff && rg -n HARNESS_LANDING scripts',
      'git log --oneline && grep -n "CLAUDECODE" README.md',
      'git status; cat docs/x.md | grep -n GIT_CONFIG_COUNT',
      'git diff --stat && tail -20 log.txt | grep HUSKY',
      'git status; grep -rn HUSKY docs 2>/dev/null',
      'git status; grep -rn HUSKY docs 2>&1 | head -5',
      'git status; rg HUSKY | wc -l',
      'git log --oneline | grep HUSKY',
      'git status; cat docs/x.md | grep HUSKY | head -3',
      'git status; (grep -rn PATH docs)',
      'ls HARNESS_LANDING; git status',
    ]) {
      assert.equal(at(c), null, c);
    }
  });
});

/** Run `fn(repo, remote)` in a scratch repository (Push deploys: yes) with a bare repository as its remote origin. */
function inRemoteRepo(fn) {
  const remote = realpathSync(mkdtempSync(join(tmpdir(), 'guard-remote-')));
  try {
    assert.equal(spawnSync('git', ['init', '-q', '--bare', remote], { encoding: 'utf8' }).status, 0);
    inDeployRepo('yes', (repo) => {
      const git = (...args) => {
        const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
        assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
      };
      git('remote', 'add', 'origin', remote);
      fn(repo, git);
    });
  } finally {
    rmSync(remote, { recursive: true, force: true });
  }
}

test('a push with no refspec goes where the repository config sends it: remote.<name>.push, push.default upstream, else the current branch', () => {
  inRemoteRepo((repo, git) => {
    const at = (c, currentBranch) => check(c, { cwd: repo, currentBranch });
    git('config', 'push.default', 'simple');
    git('config', 'remote.origin.push', `refs/heads/x:refs/heads/${M}`);
    for (const c of ['git push', 'git push origin', 'git push --repo origin', 'git push --repo=origin']) {
      assert.equal(at(c, 'x')?.rule, 'push-deploys', c);
      assert.equal(at(c, 'x').owner, true, c);
    }
    git('config', 'remote.origin.push', 'HEAD:refs/heads/feature');
    assert.equal(at('git push', M), null, `a ${M} whose push config targets a feature branch`);
    git('config', 'remote.origin.push', `+HEAD:refs/heads/${M}`);
    assert.equal(at('git push', 'feature')?.rule, 'force-push-mainline', 'a + refspec in the config forces');
    git('config', '--unset-all', 'remote.origin.push');
    git('config', 'branch.feature.remote', 'origin');
    git('config', 'branch.feature.merge', `refs/heads/${M}`);
    assert.equal(at('git push', 'feature'), null, 'push.default simple: the current branch');
    for (const mode of ['upstream', 'tracking']) {
      git('config', 'push.default', mode);
      assert.equal(at('git push', 'feature')?.rule, 'push-deploys', `push.default ${mode}`);
    }
    // the remote is branch.<current>.remote when no positional names one
    git('config', 'push.default', 'simple');
    git('remote', 'add', 'up', repo);
    git('config', 'branch.feature.remote', 'up');
    git('config', 'remote.up.push', `HEAD:refs/heads/${M}`);
    assert.equal(at('git push', 'feature')?.rule, 'push-deploys', 'branch.feature.remote');
    assert.equal(at('git push origin', 'feature'), null, 'origin has no push config');
    // --repo names the remote beside refspecs
    assert.equal(at(`git push --repo origin HEAD:refs/heads/${M}`, 'feature')?.rule, 'push-deploys');
    assert.equal(at(`git push --repo=origin HEAD:refs/heads/${M}`, 'feature')?.rule, 'push-deploys');
  });
});

test('a dry run is never a push-deploys owner hit; its force and delete refusals stay', () => {
  inDeployRepo('yes', (repo) => {
    const at = (c) => check(c, { cwd: repo, currentBranch: TOPIC });
    for (const c of [`git push --dry-run origin ${M}:${M}`, `git push -n origin ${M}`, `git push --dry-run origin ${M}`, `git push -un origin ${M}`]) {
      assert.equal(at(c), null, c);
    }
    assert.equal(at(`git push origin ${M}`)?.rule, 'push-deploys');
    assert.equal(at(`git push --dry-run --force origin ${M}`)?.rule, 'force-push-mainline');
    assert.equal(at(`git push -n origin :${M}`)?.rule, 'delete-mainline');
  });
});

test('the ask text drops line and paragraph separators, bidi, zero-width and control characters', () => {
  const gate = "console.log('REJECTED\\u2028APPROVED\\u2029APPROVED\\u202eREADY\\u200b\\u2060\\ufeff\\u001b[2J');\n";
  inDeployRepo(null, (repo) => {
    const c = 'HARNESS_LANDING=owner git merge --no-ff feature';
    const text = JSON.parse(decide(check(c, { cwd: repo, currentBranch: TOPIC }), { input: ASK_INPUT(c), env: ASK_ENV }).stdout).hookSpecificOutput.permissionDecisionReason;
    assert.equal(text, 'Owner key: merge past the landing check. REJECTED APPROVED APPROVED READY [2J Approve to run it as the owner.');
    assert.doesNotMatch(text, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  }, { 'scripts/review-gate.mjs': gate });
});

test('a landing check that prints more than its buffer still gives its first line; its stderr is not read', () => {
  for (const gate of [
    "process.stdout.write('REJECTED\\n' + 'x'.repeat(2 * 1024 * 1024));\n",
    "process.stdout.write('REJECTED\\n'); process.stderr.write('x'.repeat(2 * 1024 * 1024));\n",
  ]) {
    inDeployRepo(null, (repo) => {
      const c = 'HARNESS_LANDING=owner git merge --no-ff feature';
      const text = JSON.parse(decide(check(c, { cwd: repo, currentBranch: TOPIC }), { input: ASK_INPUT(c), env: ASK_ENV }).stdout).hookSpecificOutput.permissionDecisionReason;
      assert.equal(text, 'Owner key: merge past the landing check. REJECTED Approve to run it as the owner.', gate);
    }, { 'scripts/review-gate.mjs': gate });
  }
});

/**
 * Run the hook as a process in a group of its own with `input` on stdin; the group is killed after
 * `limit` ms, and once the hook is done. Resolves { status, stdout, stderr, ms, timedOut }.
 */
function hookRun(input, env, limit) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, [HOOK], { detached: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const kill = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // the group is gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, limit);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => {
      clearTimeout(timer);
      kill();
      done({ status, stdout, stderr, ms: Date.now() - started, timedOut });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

test('a landing check that ignores SIGTERM is killed at its timeout: the hook still asks, within 7 s', async () => {
  const gate = 'process.on(\'SIGTERM\', () => {});\nsetInterval(() => {}, 1000);\n';
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'guard-slow-')));
  try {
    mkdirSync(join(repo, 'scripts'));
    writeFileSync(join(repo, 'scripts', 'review-gate.mjs'), gate);
    for (const args of [['init', '-q'], ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'init']]) {
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    }
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CODEX_THREAD_ID' && !k.startsWith('ZCODE_')));
    const input = { tool_name: 'Bash', cwd: repo, permission_mode: 'default', tool_input: { command: 'HARNESS_LANDING=owner git merge --no-ff feature' } };
    const r = await hookRun(input, { ...env, CLAUDE_PROJECT_DIR: repo }, 7000);
    assert.equal(r.timedOut, false, `the hook still ran after ${r.ms} ms`);
    assert.ok(r.ms < 7000, `${r.ms} ms`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, 'Owner key: merge past the landing check. (landing check not run) Approve to run it as the owner.');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('background is per command: a `&` backgrounds its own list, group or loop, never the commands before it', () => {
  const at = (c, background = false) => check(c, { currentBranch: TOPIC, background })?.rule ?? null;
  for (const [c, background] of [
    ['while true; do sleep 1; done & echo done', false],
    ['until false; do sleep 1; done & echo done', false],
    ['for i in 1 2; do tail -f log; done & echo done', false],
    ['{ tail -f log; } & echo done', false],
    ['(while :; do sleep 1; done) & echo done', false],
    ['while X=1; do sleep 1; done', true],
    ['while cd .; do sleep 1; done', true],
    ['while export X=1; do sleep 1; done', true],
    ['while X=1; do sleep 1; done & echo done', false],
    ['setsid tail -f log', true],
    ['setsid -f --wait tail -F log', true],
  ]) {
    assert.equal(at(c, background), 'unbounded-wait', `${c} (background: ${background})`);
  }
  for (const [c, background] of [
    ['tail -f log; echo done &', false],
    ['while true; do sleep 1; done; echo done &', false],
    ['tail -f log && echo a; sleep 1 &', false],
    ['while X=1; do sleep 1; done', false],
    ['setsid tail -f log', false],
  ]) {
    assert.equal(at(c, background), null, `${c} (background: ${background})`);
  }
});

test('full-verify-executor reads the script past setsid, bash\'s --rcfile / --init-file values and quotes', () => {
  const at = (c) => check(c, { currentBranch: TOPIC, agentId: 'agent-1' })?.rule ?? null;
  for (const c of [
    'setsid bash scripts/run-gates.sh',
    'bash --rcfile foo scripts/run-gates.sh',
    'bash --init-file foo scripts/run-gates.sh',
    "bash 'some dir/run-gates.sh'",
    "'some dir/run-gates.sh'",
    'bash "scripts/run-gates.sh" --no-cache',
  ]) {
    assert.equal(at(c), 'full-verify-executor', c);
  }
  for (const c of ["bash --rcfile foo 'some dir/run-gates.sh' --since main", "bash -c 'cat scripts/run-gates.sh'", 'bash --rcfile run-gates.sh other.sh']) {
    assert.equal(at(c), null, c);
  }
});

test('a search loses the terminal-search exemption when a word can assign, or any redirection but 2>&1 and 2>/dev/null sends its output elsewhere', () => {
  inScratchRepo((at) => {
    for (const [c, name] of [
      // a ${n:=X} default or an arithmetic assignment in a word
      [`grep \${n:=GIT_CONFIG_PARAMETERS} names; export "$n='core.hooksPath'='/dev/null'"; git commit --allow-empty -m parameter-config`, 'hooks-path-override'],
      ['grep ${n:=HARNESS_HOST} names; export "$n=human"; git commit --allow-empty -m x', 'host-override'],
      ['grep ${n:=HARNESS_LANDING} names; export "$n=owner"; git commit --allow-empty -m x', 'landing-override'],
      ['export HUSKY; grep "$((HUSKY=0))" names; git commit --allow-empty -m arithmetic-exported', 'no-verify'],
      ['grep "$[HUSKY=0]" names; git commit -m x', 'no-verify'],
      // stdout duplicated onto a descriptor that goes to a file, or any other redirection
      ['grep -o HUSKY names 2>name 1>&2; read n <name; export "$n=0"; git commit --allow-empty -m fd-name', 'no-verify'],
      ['grep -o HUSKY names 3>name 1>&3; read n <name; export "$n=0"; git commit --allow-empty -m fd3-name', 'no-verify'],
      ['grep HUSKY f 1>&2; git commit -m x', 'no-verify'],
      ['grep HUSKY f >&3; git commit -m x', 'no-verify'],
      ['grep HUSKY f >| x; git commit -m x', 'no-verify'],
      ['grep HUSKY f 2>x; git commit -m x', 'no-verify'],
      ['{ grep HUSKY f; } 1>&2; git commit -m x', 'no-verify'],
    ]) {
      assert.equal(at(c), name, c);
    }
    for (const c of [
      'git status; grep -rn HUSKY docs 2>&1 | head -5',
      'git status; grep -rn HUSKY docs 2>/dev/null',
      'git status; grep -rn "$PAT" docs',
      'git status; grep -rn "$PAT" docs/HUSKY.md',
      'git status; grep -rn HUSKY docs < list',
    ]) {
      assert.equal(at(c), null, c);
    }
  });
});

test('a push with no refspec reads its target from config only on a line that sets nothing, moves only where the guard follows and passes git no config option', () => {
  inRemoteRepo((repo, git) => {
    const at = (c, currentBranch) => check(c, { cwd: repo, currentBranch })?.rule ?? null;
    git('config', 'remote.origin.push', 'HEAD:refs/heads/feature');
    assert.equal(at('git push', M), null, 'the config sends it to feature');
    for (const c of [
      `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.push GIT_CONFIG_VALUE_0=HEAD:refs/heads/${M} git push --force`,
      `git -c remote.origin.push=HEAD:refs/heads/${M} push --force`,
      `git --config-env=remote.origin.push=V push --force`,
    ]) {
      assert.equal(at(c, M), 'force-push-mainline', c);
    }
    for (const c of [
      'X=1; git push',
      'export X=1; git push',
      'env X=1 git push',
      'declare X=1; git push',
      'set -a; git push',
      'cd - && git push',
      'cd "$D" && git push',
      'pushd && git push',
      'popd && git push',
      'pushd "$D" && git push',
      'git --git-dir=.git push',
      'git --work-tree=. push',
      'git --exec-path=/x push',
    ]) {
      assert.equal(at(c, 'feature'), 'push-deploys', c);
    }
    assert.equal(at(`cd "$D" && git push --force`, 'feature'), 'force-push-mainline');
    // an unresolved -C points the deploy read nowhere, but its force push still counts as a mainline
    assert.equal(at('git -C "$D" push --force', 'feature'), 'force-push-mainline');
    // a move the guard follows reads the config of the directory it moves to
    for (const c of [`cd ${repo} && git push`, `git -C ${repo} push`, `pushd ${repo} && git push`, 'cd . && git push']) {
      assert.equal(at(c, M), null, `${c}: its config sends ${M} to feature`);
    }
    git('config', '--unset-all', 'remote.origin.push');
    for (const c of [`cd ${repo} && git push`, `git -C ${repo} push`, `cd ${repo} && git push --force`]) {
      assert.equal(at(c, 'feature'), null, `${c} of a feature branch`);
    }
    assert.equal(at('git push', 'feature'), null, 'a bare push of a feature branch, no config overrides');
    assert.equal(at('git push origin', 'feature'), null);
  });
});

test('--dry-run, -n and --no-dry-run are read in order: the last one wins', () => {
  inDeployRepo('yes', (repo) => {
    const at = (c) => check(c, { cwd: repo, currentBranch: TOPIC })?.rule ?? null;
    assert.equal(at(`git push --dry-run --no-dry-run origin HEAD:${M}`), 'push-deploys');
    assert.equal(at(`git push -n --no-dry-run origin ${M}`), 'push-deploys');
    assert.equal(at(`git push --no-dry-run --dry-run origin ${M}:${M}`), null);
    assert.equal(at(`git push --no-dry-run -n origin ${M}`), null);
  });
});

test('the wait rule unquotes the program word: a quoted path with spaces to tail or watch is read', () => {
  const at = (c, background = true) => check(c, { currentBranch: TOPIC, background })?.rule ?? null;
  for (const c of ["'some dir/tail' -f log", '"some dir/watch" date', "'some dir/tail' '-f' log"]) {
    assert.equal(at(c), 'unbounded-wait', c);
  }
  assert.equal(at("'some dir/tail' -f log", false), null, 'in the foreground');
  assert.equal(at("'some dir/tail' -n 5 log"), null, 'no follow');
});

test('a push into a directory the guard cannot name reads Push deploys from the hook\'s own repository; a named one reads its own', () => {
  inDeployRepo('yes', (repo) => {
    inDeployRepo('no', (other) => {
      const at = (c) => check(c, { cwd: repo, currentBranch: TOPIC })?.rule ?? null;
      for (const c of [
        `git -C "$D" push origin ${M}`,
        `cd "$D" && git push origin ${M}`,
        `cd ${other} && cd "$D" && git push origin ${M}`,
        `cd - && git push origin ${M}`,
        `popd && git push origin ${M}`,
        `cd ./missing && git push origin ${M}`,
        `git -C ./missing push origin ${M}`,
      ]) {
        assert.equal(at(c), 'push-deploys', c);
      }
      for (const c of [`git -C ${other} push origin ${M}`, `cd ${other} && git push origin ${M}`, `cd "$D" && cd ${other} && git push origin ${M}`]) {
        assert.equal(at(c), null, `${c}: its own AGENTS.md says no`);
      }
    });
  });
});

test('round 5: a wrapper argument that can assign, a global option before -c, pushd -n and a move to a missing directory are read', () => {
  inScratchRepo((at) => {
    assert.equal(at('env -u ${n:=HUSKY} grep x names; export "$n=0"; git commit --allow-empty -m wrapper-name'), 'no-verify');
    assert.equal(at('git status; env grep -rn HUSKY docs'), null, 'a search behind a plain wrapper keeps the exemption');
  });
  inRemoteRepo((repo, git) => {
    const at = (c, currentBranch) => check(c, { cwd: repo, currentBranch })?.rule ?? null;
    git('config', 'remote.origin.push', 'HEAD:refs/heads/feature');
    // a value-taking global option does not hide a later -c or -C
    assert.equal(at(`git --namespace '' -c remote.origin.push=HEAD:refs/heads/${M} push --force`, 'feature'), 'force-push-mainline');
    assert.equal(at('git --namespace x -C "$D" push --force', 'feature'), 'force-push-mainline');
    assert.equal(at('git --namespace x push --force', 'feature'), null, 'the config sends it to feature');
    // a move to a directory that does not exist leaves the push where it was, its target unread
    for (const c of ['cd ./missing-directory; git push --force', 'cd ./missing-directory && git push --force', 'pushd ./missing-directory; git push --force']) {
      assert.equal(at(c, 'feature'), 'force-push-mainline', c);
    }
    inDeployRepo('yes', (other) => {
      spawnSync('git', ['config', 'remote.origin.push', 'HEAD:refs/heads/feature'], { cwd: other });
      git('config', '--unset-all', 'remote.origin.push');
      // pushd -n changes the directory stack only: the push reads this repository's config
      assert.equal(at(`pushd -n ${other} && git push --force`, M), 'force-push-mainline');
      assert.equal(at(`pushd ${other} && git push --force`, M), null, `pushd moves: ${other}'s config sends it to feature`);
    });
  });
});
