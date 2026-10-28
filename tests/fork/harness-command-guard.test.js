/**
 * Tests for skills/harness-bootstrap/templates/command-guard.mjs (biji-dev/ecc-js):
 * the PreToolUse(Bash) hook that refuses commit-guard bypasses and mainline force pushes.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const GUARD = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'command-guard.mjs');

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

// A git spawn must not see the developer's GIT_* variables, global config or system config.
function gitEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
}
// The guard runs `git rev-parse` inside this process: give it the same clean environment.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key];
}
Object.assign(process.env, { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' });

function runHook(file, payload) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync(process.execPath, [file], { input, encoding: 'utf8', timeout: 20000, env: gitEnv() });
}

const bash = (command, cwd) => ({ tool_name: 'Bash', tool_input: { command }, cwd });

let importCount = 0;
async function load(file) {
  // A query string keeps each mutant a distinct module instance.
  importCount += 1;
  return import(`${pathToFileURL(file).href}?v=${importCount}`);
}

async function main() {
  const dir = tmp('command-guard-');
  const guard = await load(GUARD);
  const check = (command, opts) => guard.check(command, { cwd: dir, ...opts });

  console.log('\ncommand-guard: blocked commands');
  const blocked = [
    ['git commit --no-verify -m x', 'no-verify'],
    ['git commit -nm x', 'no-verify'],
    ['git commit -anm x', 'no-verify'],
    ['git commit -n -m x', 'no-verify'],
    ['cd sub && git commit -n -m x', 'no-verify'],
    ['FOO=1 git commit --no-verify -m x', 'no-verify'],
    ['git -C . commit --no-verify -m x', 'no-verify'],
    ['git add . && git commit --no-verify -m "x"', 'no-verify'],
    ['git commit -m x # fine\ngit commit -n -m y', 'no-verify'],
    ['bash -c "git commit --no-verify -m x"', 'no-verify'],
    ['git commit --no-verify <<EOF\nbody\nEOF', 'no-verify'],
    ['cat <<EOF && git commit -n -m x\nbody\nEOF', 'no-verify'],
    ['git -c core.hooksPath=/dev/null commit -m x', 'hooks-path-override'],
    ['git -c core.hookspath=/dev/null push', 'hooks-path-override'],
    ['git -c "core.hooksPath=/dev/null" merge topic', 'hooks-path-override'],
    ['git push --force origin main', 'force-push-mainline'],
    ['git push origin +main', 'force-push-mainline'],
    ['git push --force-with-lease=main origin main', 'force-push-mainline'],
    ['git push origin +HEAD:master', 'force-push-mainline'],
    ['git push -uf origin refs/heads/main', 'force-push-mainline'],
    // wrapper programs and an absolute or relative git path
    ['/usr/bin/git commit -n -m x', 'no-verify'],
    ['./git commit -n -m x', 'no-verify'],
    ['"git" commit -n -m x', 'no-verify'],
    ['env git commit -n', 'no-verify'],
    ['/usr/bin/env git commit -n', 'no-verify'],
    ['env FOO=1 git commit -n', 'no-verify'],
    ['env -i git commit -n', 'no-verify'],
    ['env -u FOO -i BAR=2 git commit -n', 'no-verify'],
    ['timeout 60 git commit -n', 'no-verify'],
    ['timeout -s KILL -k 5 60 git commit -n', 'no-verify'],
    ['timeout --signal=KILL 60 git commit -n', 'no-verify'],
    ['nice git commit -n', 'no-verify'],
    ['nice -n 5 git commit -n', 'no-verify'],
    ['nice -5 git commit -n', 'no-verify'],
    ['sudo git commit -n', 'no-verify'],
    ['sudo -u root -E git commit -n', 'no-verify'],
    ['sudo -- git commit -n', 'no-verify'],
    ['xargs git commit -n', 'no-verify'],
    ['xargs -n 1 -I {} git commit -n', 'no-verify'],
    ['sudo env FOO=1 nice -n 5 timeout 9 git commit -n -m x', 'no-verify'],
    ['/bin/bash -c "git commit -n -m x"', 'no-verify'],
    ['sudo /usr/bin/zsh -lc \'git commit --no-verify\'', 'no-verify'],
    ['env bash -c "git commit -n"', 'no-verify'],
    ['eval "git commit -n -m x"', 'no-verify'],
    ['eval git commit -n -m x', 'no-verify'],
    ['git commit -n -m x 2>&1 | tail -3', 'no-verify'],
    ['git commit --no-verif -m x', 'no-verify'],
    ['git commit --no-v -m x', 'no-verify'],
    // quoted flags
    ['git commit "--no-verify"', 'no-verify'],
    ["git commit '-n'", 'no-verify'],
    ["git commit $'--no-verify'", 'no-verify'],
    ["git commit $'\\x2d\\x2dno-verify'", 'no-verify'],
    ['git commit --no-"verify" -m x', 'no-verify'],
    ['git commit "-n" -m x', 'no-verify'],
    ['git push "--force" origin main', 'force-push-mainline'],
    ['git push --force origin "main"', 'force-push-mainline'],
    ['git push origin "+main"', 'force-push-mainline'],
    // other ways to switch the hooks off
    ['git config core.hooksPath /dev/null', 'hooks-path-override'],
    ['git config --global core.hooksPath /dev/null', 'hooks-path-override'],
    ['git config --local core.hooksPath x', 'hooks-path-override'],
    ['git config --add core.hooksPath x', 'hooks-path-override'],
    ['git config --file .git/config core.hooksPath x', 'hooks-path-override'],
    ['git -C sub config core.hookspath x', 'hooks-path-override'],
    ['git config "core.hooksPath" x', 'hooks-path-override'],
    ['git config --unset core.hooksPath', 'hooks-path-override'],
    ['git config --global --unset-all CORE.HOOKSPATH', 'hooks-path-override'],
    // only the documented install value of the commit guard is allowed (HOOKS_DIR)
    ['git config core.hooksPath .git/hooks', 'hooks-path-override'],
    ['git config core.hooksPath /dev/null', 'hooks-path-override'],
    ['git config core.hooksPath .githooks-evil', 'hooks-path-override'],
    ['git config core.hooksPath ../.githooks', 'hooks-path-override'],
    ['git config core.hooksPath ""', 'hooks-path-override'],
    ['git config --unset core.hooksPath .githooks', 'hooks-path-override'],
    ['git config --global core.hooksPath .githooks', 'hooks-path-override'],
    ['git config --system core.hooksPath .githooks', 'hooks-path-override'],
    ['git config --global core.hooksPath ./.githooks', 'hooks-path-override'],
    ['git config --add core.hooksPath .githooks', 'hooks-path-override'],
    ['git config --file other.cfg core.hooksPath .githooks', 'hooks-path-override'],
    ['git config --worktree core.hooksPath .githooks', 'hooks-path-override'],
    ['git config core.hooksPath .githooks extra', 'hooks-path-override'],
    ['git -c core.hooksPath=.githooks commit -m x', 'hooks-path-override'],
    ['git -c core.hooksPath=.githooks push', 'hooks-path-override'],
    ['git config set core.hooksPath x', 'hooks-path-override'],
    ['git config unset core.hooksPath', 'hooks-path-override'],
    ['git --config-env=core.hooksPath=HP commit -m x', 'hooks-path-override'],
    ['git --config-env core.hooksPath=HP commit -m x', 'hooks-path-override'],
    ['git config core.hooksPath /dev/null && git commit -m x', 'hooks-path-override'],
    ['HUSKY=0 git commit -m x', 'no-verify'],
    ['env HUSKY=0 git commit -m x', 'no-verify'],
    ['HUSKY="0" git commit -m x', 'no-verify'],
    // deleting the mainline on a remote
    ['git push origin :main', 'delete-mainline'],
    ['git push origin :refs/heads/master', 'delete-mainline'],
    ['git push --delete origin main', 'delete-mainline'],
    ['git push -d origin main', 'delete-mainline'],
    ['git push origin --delete master', 'delete-mainline'],
    ['git push --del origin main', 'delete-mainline'],
    // pushes of everything
    ['git push --mirror origin', 'force-push-mainline'],
    ['git push --all --force origin', 'force-push-mainline'],
    ['git push --force --all origin', 'force-push-mainline'],
    // --tags next to anything that selects a branch still pushes it
    ['git push -f --tags origin main', 'force-push-mainline'],
    ['git push -f --tags --all origin', 'force-push-mainline'],
    ['git push -f --tags --mirror origin', 'force-push-mainline'],
    // a space before a redirect target does not turn the target into a refspec, and a bare
    // redirect leaves the current branch (main) as the pushed one
    ['git push -f origin main > /tmp/log', 'force-push-mainline'],
    ['git push -f origin main 2> /tmp/err', 'force-push-mainline'],
    ['git push -f 2>&1 origin main', 'force-push-mainline'],
    // control-flow wrappers
    ['if git commit -n -m x; then echo ok; fi', 'no-verify'],
    ['if true; then git commit -n -m x; fi', 'no-verify'],
    ['for i in 1 2; do git commit -n -m x; done', 'no-verify'],
    ['git --git-dir .git commit -n -m x', 'no-verify'],
    ['git --git-dir=.git --work-tree . commit -n', 'no-verify'],
    ['git push --force-with origin main', 'force-push-mainline'],
    ['git push --force-w origin main', 'force-push-mainline'],
    ['git push -o ci.skip -f origin main', 'force-push-mainline'],
    ['git push --push-option ci.skip -f origin main', 'force-push-mainline'],
    ['git commit -m x # fine\ngit commit -nm y', 'no-verify'],
    // merge and pull skip pre-merge-commit with --no-verify
    ['git merge --no-verify feature/x', 'no-verify'],
    ['git merge --no-ff --no-verify -m msg feature/x', 'no-verify'],
    ['git checkout main && git merge --no-ff --no-verify feature/x', 'no-verify'],
    ['git pull --no-verify origin main', 'no-verify'],
    ['HUSKY=0 git merge feature/x', 'no-verify'],
    // push skips pre-push with --no-verify (git takes --no-veri and --no-verif as abbreviations)
    ['git push --no-verify origin feature/x', 'no-verify'],
    ['git push --no-veri origin feature/x', 'no-verify'],
    ['git push --no-verif origin feature/x', 'no-verify'],
    ['git push origin feature/x --no-verify', 'no-verify'],
    ['git push -o ci.skip --no-verify origin feature/x', 'no-verify'],
    ['HUSKY=0 git push origin feature/x', 'no-verify'],
    // an inline GIT_CONFIG_* override of core.hooksPath on a hook-running subcommand
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x', 'hooks-path-override'],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hookspath GIT_CONFIG_VALUE_0=/dev/null git commit -m x', 'hooks-path-override'],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=CORE.HOOKSPATH GIT_CONFIG_VALUE_0=/dev/null git push origin feature/x', 'hooks-path-override'],
    ['GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=p GIT_CONFIG_KEY_1=core.hooksPath GIT_CONFIG_VALUE_1=/dev/null git merge topic', 'hooks-path-override'],
    ["GIT_CONFIG_PARAMETERS=\"'core.hooksPath'='/dev/null'\" git commit -m x", 'hooks-path-override'],
    ['GIT_CONFIG_PARAMETERS=x git pull', 'hooks-path-override'],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="$K" GIT_CONFIG_VALUE_0=/dev/null git commit -m x', 'hooks-path-override'],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="$(echo k)" GIT_CONFIG_VALUE_0=/dev/null git commit -m x', 'hooks-path-override'],
    ['env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x', 'hooks-path-override'],
    ['git -c core.hooksPath=/dev/null pull', 'hooks-path-override'],
    // an export earlier on the line, and the environment a bash -c or eval script inherits
    ['export HUSKY=0; git commit -m x', 'no-verify'],
    ['export HUSKY=0 && cd sub && git commit -m x', 'no-verify'],
    ['export GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_COUNT=1 GIT_CONFIG_VALUE_0=/dev/null && git commit -m x', 'hooks-path-override'],
    ['HUSKY=0 bash -c "git commit -m x"', 'no-verify'],
    ['HUSKY=0 eval "git commit -m x"', 'no-verify'],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null bash -c "git commit -m x"', 'hooks-path-override'],
    // wrappers with options
    ['command -p git commit -n -m x', 'no-verify'],
    ['command git commit -n -m x', 'no-verify'],
    ['builtin git commit --no-verify -m x', 'no-verify'],
    ['exec -a x git commit -n -m x', 'no-verify'],
    ['exec -cl git commit -n -m x', 'no-verify'],
    ['time -p git commit -n -m x', 'no-verify'],
    ['time -o /tmp/t git commit -n -m x', 'no-verify'],
    ['time -f %e git commit -n -m x', 'no-verify'],
    ['time --output /tmp/t git commit -n -m x', 'no-verify'],
    ['nohup git push --no-verify origin feature/x', 'no-verify'],
    // a value-taking option can take `--` as its value; git still honours a later --no-verify
    ['git merge -m -- --no-verify feature/x', 'no-verify'],
    ['git merge -- --no-verify feature/x', 'no-verify'],
    // a Codex or run-wrapper launch sent to the background with a shell `&`
    ['codex exec x &', 'codex-background'],
    ['codex exec x&', 'codex-background'],
    ['(codex exec x) &', 'codex-background'],
    ['nohup codex exec - < b.md > o.md 2>&1 &', 'codex-background'],
    ['node scripts/codex-run.mjs review &', 'codex-background'],
    ['node --no-warnings scripts/codex-run.mjs review &', 'codex-background'],
    ['bun ./scripts/claude-run.mjs build &', 'codex-background'],
    ['scripts/codex-run.mjs review &', 'codex-background'],
    ['/opt/bin/codex exec x &', 'codex-background'],
    ['codex exec x && echo ok &', 'codex-background'],
    ['echo start && codex exec x | tee log &', 'codex-background'],
    ['codex exec x & echo started', 'codex-background'],
    ['(echo start; codex exec x &)', 'codex-background'],
    ['(cd sub && (codex exec x)) &', 'codex-background'],
    ['{ codex exec x; } &', 'codex-background'],
    ['bash -c "codex exec x" &', 'codex-background'],
    ['bash -c "codex exec x &"', 'codex-background'],
    ['eval "codex exec x" &', 'codex-background'],
    ['codex exec x >/dev/null 2>&1 &', 'codex-background'],
    ['codex exec x &> log &', 'codex-background'],
    // a newline after &&, || or | continues the and-or list, so its `&` still backgrounds the launch
    ['codex exec x &&\n echo ok &', 'codex-background'],
    ['codex exec x |\n tee out &', 'codex-background'],
    ['codex exec x &&\n\n echo ok &', 'codex-background'],
    ['codex exec x ||\n echo failed &', 'codex-background'],
    // an option's value does not hide the wrapper script from node or bun
    ['node --title harness scripts/codex-run.mjs review --base HEAD --out v.md &', 'codex-background'],
    ['node -r ./x.cjs scripts/codex-run.mjs review &', 'codex-background'],
    ['node --import ./x.mjs scripts/codex-run.mjs review &', 'codex-background'],
    ['bun --cwd . scripts/codex-run.mjs review &', 'codex-background'],
    // controls (blocked before the shell model too): an export reaches the rest of its own shell,
    // a backgrounded list's commands, a { } group's followers and a later ( ) subshell, and an
    // inline value after it wins
    ['export HUSKY=0 && git commit -m x &', 'no-verify'],
    ['{ export HUSKY=0; }; git commit -m x', 'no-verify'],
    ['export HUSKY=0; (git commit -m x)', 'no-verify'],
    ['export HUSKY=1; HUSKY=0 git commit -m x', 'no-verify'],
  ];
  for (const [command, rule] of blocked) {
    test(`blocks: ${command.replace(/\n/g, '\\n')}`, () => {
      const hit = check(command, { currentBranch: 'feature/x' });
      assert.ok(hit, 'expected a block');
      assert.strictEqual(hit.rule, rule);
      assert.ok(hit.reason.length > 0);
    });
  }
  test('blocks: git push -f when the current branch is main', () => {
    assert.strictEqual(check('git push -f', { currentBranch: 'main' }).rule, 'force-push-mainline');
  });
  test('blocks: git push -f origin HEAD when the current branch is master', () => {
    assert.strictEqual(check('git push -f origin HEAD', { currentBranch: 'master' }).rule, 'force-push-mainline');
  });

  test('blocks: a force push whose refspec cannot be resolved falls back to the current branch (main)', () => {
    for (const command of [
      'git push -f origin $(git branch --show-current)',
      'git push --force origin "$BRANCH"',
      'git push --force origin $BRANCH',
      "git push --force origin '$BRANCH'",
      'git push -f origin "$(git branch --show-current)"',
      'git push -f origin HEAD:$BRANCH',
      'git push -f origin @',
      'git push -f origin +@',
      'git push -f origin @:refs/heads/main',
    ]) {
      assert.ok(check(command, { currentBranch: 'main' }), `expected a block: ${command}`);
    }
  });
  // Spec correction (approved by the session, not a weakening): the current-branch fallback is
  // right for force pushes and wrong for deletes. A delete whose target cannot be resolved is not
  // the mainline, so `git push --delete origin $BRANCH` on main is allowed; only a target that is
  // literally the mainline is refused.
  test('allows: a delete whose target cannot be resolved, even on main', () => {
    for (const command of [
      'git push --delete origin $BRANCH',
      'git push origin --delete "$OLD"',
      'for b in fix/a fix/b; do git push origin --delete "$b"; done',
      'git push origin :$OLD',
      'git push -d origin "$(git branch --show-current)"',
      'git push origin --delete HEAD',
    ]) {
      assert.strictEqual(check(command, { currentBranch: 'main' }), null, command);
    }
  });
  test('blocks: a delete whose target is literally the mainline, on any branch', () => {
    for (const command of ['git push origin --delete main', 'git push origin --delete refs/heads/main', 'git push origin :main', 'git push -d origin master']) {
      assert.strictEqual(check(command, { currentBranch: 'main' }).rule, 'delete-mainline', command);
      assert.strictEqual(check(command, { currentBranch: 'feature/x' }).rule, 'delete-mainline', command);
    }
  });
  test('allows: the same unresolvable refspecs when the current branch is feature/x', () => {
    for (const command of [
      'git push -f origin $(git branch --show-current)',
      'git push --force origin "$BRANCH"',
      'git push -f origin @',
      'git push --delete origin $BRANCH',
    ]) {
      assert.strictEqual(check(command, { currentBranch: 'feature/x' }), null, command);
    }
  });

  test('on main: a redirect target with a space before it is not a refspec', () => {
    const main = { currentBranch: 'main' };
    for (const command of ['git push -f origin > /tmp/log 2>&1', 'git push -f origin 2> /tmp/err', 'git push -f origin >> /tmp/log', 'git push -f origin &> /tmp/log', 'git push -f > /tmp/log']) {
      assert.strictEqual(check(command, main).rule, 'force-push-mainline', command);
    }
    for (const command of ['git push -f origin feature > /tmp/log', 'git push -f origin feature 2> /tmp/err', 'git push -f origin feature < /dev/null', 'git push -f origin HEAD:feature &> /tmp/log']) {
      assert.strictEqual(check(command, main), null, command);
    }
  });
  test('on main: a force push whose only selection is --tags is allowed', () => {
    const main = { currentBranch: 'main' };
    for (const command of ['git push -f --tags', 'git push --force --tags origin', 'git push --tags --force origin', 'git push origin --tags --force-with-lease']) {
      assert.strictEqual(check(command, main), null, command);
    }
    for (const command of ['git push -f --tags origin main', 'git push -f --tags origin HEAD', 'git push -f --tags --all origin', 'git push --force --tags --mirror origin', 'git push -f origin']) {
      assert.strictEqual(check(command, main).rule, 'force-push-mainline', command);
    }
  });

  console.log('\ncommand-guard: allowed commands');
  const allowed = [
    'git commit -m x',
    'git commit -m "mention --no-verify in the message"',
    "git commit -m 'run git commit -n later'",
    'git commit -m -n',
    'git commit -am "fix" --amend',
    'git commit -mn',
    'git commit -m "x" -- -n',
    // the body lines below are real bypass commands: only heredoc stripping lets these through
    "git commit -F - <<'EOF'\nsubject\n\ngit commit --no-verify\nEOF",
    "git commit -F - <<-EOF\n\tgit commit -n\n\tEOF",
    'git commit -F - <<EOF\ngit commit --no-verify -m x\nEOF',
    'git commit -F - <<"EOF"\ngit commit -n\nEOF',
    'echo git commit --no-verify',
    'echo "git commit -n" | cat',
    'git log -n 5',
    'git log -n 5 && git status',
    'git push --force origin feature/x',
    'git push origin +feature/x',
    'git push --force-with-lease origin HEAD:feature/x',
    'git push origin main',
    'git -c user.name=x commit -m x',
    'git -c core.editor=true commit -m x',
    'git status # git commit -n',
    '',
    // wrappers around harmless commands
    'env git commit -m x',
    'timeout 60 git commit -m x',
    'nice -n 5 git commit -m x',
    'sudo -u root git status',
    'xargs -n 1 echo git commit -n',
    'env FOO=1 echo git commit -n',
    'env',
    'sudo',
    '/usr/bin/git commit -m x',
    '/bin/bash -c "git commit -m x"',
    'eval "git commit -m x"',
    'eval "echo git commit -n"',
    // quoted values stay values
    'git commit -m "--no-verify"',
    'git commit --message="--no-verify"',
    'git commit --message "-n"',
    'git commit --author "-n" -m x',
    'git commit --author=-n -m x',
    'git commit --trailer "-n" -m x',
    "git commit -F '-n'",
    'git commit -m x -- "-n"',
    'git push -o "-f" origin feature/x',
    // hooksPath outside commit-like subcommands, and reads of the setting
    'git -c core.hooksPath=x status',
    'git -c core.hooksPath=x log -n 5',
    'git config --get core.hooksPath',
    'git config core.hooksPath',
    'git config --global --get core.hooksPath',
    'git config get core.hooksPath',
    'git config --list',
    // reading with a value pattern, and the commit guard's own install command (HOOKS_DIR)
    'git config --get core.hooksPath dev',
    'git config --get-all core.hooksPath dev',
    'git config core.hooksPath .githooks',
    'git config --local core.hooksPath .githooks',
    'git config core.hooksPath ./.githooks',
    'git config core.hooksPath .githooks/',
    'git config core.hooksPath "./.githooks/"',
    "git config --local core.hookspath '.githooks'",
    'git config set core.hooksPath .githooks',
    'git -C sub config core.hooksPath .githooks',
    'git config core.hooksPath .githooks && git commit -m x',
    'git config user.name x',
    'git config --global core.editor vim',
    'git config --unset user.signingkey',
    'git config --file hookspath.cfg user.name x',
    'HUSKY=1 git commit -m x',
    'HUSKY=0 git status',
    'HUSKY=0 npm test',
    // deleting a branch that is not the mainline, and pushes that are not forced
    'git push origin --delete feature/x',
    'git push -d origin feature',
    'git push origin :feature/x',
    'git push origin main:feature/x',
    'git push --all origin',
    'git push origin feature/x',
    // -f --tags with no refspec pushes only tags; a mainline branch is not touched
    'git push -f --tags',
    'git push --force --tags origin',
    'git push --tags --force origin',
    'git push origin --tags -f',
    // redirects with a space before the target
    'git push -f origin feature > /tmp/log',
    'git push -f origin feature 2> /tmp/err',
    'git push -f origin feature >> /tmp/log 2>&1',
    'git push -f origin feature &> /tmp/log',
    'git push -f origin feature < /dev/null',
    // heredocs with a backslash-quoted delimiter
    'git commit -F - <<\\EOF\nUse `git commit -n` never\nEOF',
    'git commit -F - <<\\EOF\n- `git push -f origin main` is refused\nEOF',
    // nested double quotes inside a command substitution inside double quotes
    'git commit -m "$(echo "retry -ing")"',
    'git commit -m "$(printf \'%s\\n\' "subject" "" "body -n")"',
    'git commit -m "$(git log -1 --format="%s -n")" -m "$(echo \'a -n\')"',
    // option values and options that look like -n
    'git commit -uno -m x',
    'git commit -Sabcn -m x',
    'git push -o -f origin main',
    'git push --push-option -f origin main',
    'git commit -m x # -n',
    'git commit -m x # --no-verify\n# git commit -n',
    // merge: -n is --no-stat; --no-verify-signatures is not a hook bypass; a message is text
    'git merge -n feature/x',
    'git merge --no-verify-signatures feature/x',
    'git merge --no-ff -m "never use --no-verify" feature/x',
    'git merge --no-ff -F .review-work/u/merge-msg.txt feature/x',
    'git pull --rebase origin main',
    // push: -n is --dry-run (pre-push still runs); --no-ver is ambiguous with --no-verbose (git refuses it)
    'git push -n origin feature/x',
    'git push --no-ver origin feature/x',
    'git push -o --no-verify origin feature/x',
    'git push --push-option --no-verify origin feature/x',
    // GIT_CONFIG_* that cannot touch the hooks, or on a subcommand that runs none
    'GIT_CONFIG_PARAMETERS=x git status',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=p git commit -m x',
    'GIT_AUTHOR_DATE="2026-01-01 00:00" git commit -m x',
    'git commit -m "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null"',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git log -n 1',
    'git -c core.hooksPath=x fetch',
    'export FOO=1; git commit -m x',
    'export HUSKY=1; git commit -m x',
    'HUSKY=0 bash -c "npm test"',
    'command -v git',
    'time git commit -m x',
    'exec -a name git status',
    // merge: --no-verify-signatures and -n (--no-stat) are not hook bypasses
    'git merge -- feature/x',
    'git merge -m -- feature/x',
    // a foreground Codex run, and `&` operators that do not background
    'codex exec x',
    'codex exec x && echo ok',
    'codex exec x; echo done',
    'node scripts/codex-run.mjs review',
    'node scripts/codex-run.mjs review 2>&1 | tail -3',
    'codex exec x &> log',
    'codex exec x &>> log',
    'codex exec x &>log',
    'codex exec x |& tee log',
    'codex exec x 2>&1 >&2',
    'codex exec x && echo ok &> log',
    'sleep 1 & codex exec x',
    '(sleep 1 &) ; codex exec x',
    'echo codex exec x &',
    'node scripts/other.mjs &',
    'node -e "1" &',
    'bash -c "codex exec x"',
    'git commit -m "run codex exec x &"',
    // an export in a subshell (( ), a pipeline, a backgrounded list, a backtick) stays in it
    '(export HUSKY=0); git commit -m x',
    'export HUSKY=0 | true; git commit -m x',
    'export HUSKY=0 & git commit -m x',
    '`export HUSKY=0`; git commit -m x',
    // the value git gets is the last one assigned
    'export HUSKY=0; HUSKY=1 git commit -m x',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x git commit -m x',
    'export GIT_CONFIG_KEY_0=core.hooksPath; GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x git commit -m x',
  ];
  for (const command of allowed) {
    test(`allows: ${command.replace(/\n/g, '\\n') || '(empty)'}`, () => {
      assert.strictEqual(check(command, { currentBranch: 'feature/x' }), null);
    });
  }
  test('allows: git push -f when the current branch is feature/x', () => {
    assert.strictEqual(check('git push -f', { currentBranch: 'feature/x' }), null);
  });
  test('allows: a force push when not on the mainline', () => {
    assert.strictEqual(check('git push --force origin', { currentBranch: 'develop' }), null);
  });

  console.log('\ncommand-guard: parser');
  test('parseCommands: splits operators, drops env and leading command, tracks cd', () => {
    const cmds = guard.parseCommands('FOO=1 command git status && cd sub; git diff | cat', dir);
    assert.deepStrictEqual(cmds.map(c => c.argv), [['git', 'status'], ['git', 'diff'], ['cat']]);
    assert.strictEqual(cmds[0].cwd, dir);
    assert.strictEqual(cmds[1].cwd, path.join(dir, 'sub'));
  });
  test('parseCommands: quoted text never becomes argv words', () => {
    const [cmd] = guard.parseCommands('git commit -m "a b && git push --force" -n', dir);
    assert.strictEqual(cmd.argv.length, 5);
    assert.ok(!cmd.argv.join(' ').includes('push'), cmd.argv.join(' '));
  });
  test('parseCommands: heredoc bodies are removed, the marker line is kept', () => {
    const cmds = guard.parseCommands('cat <<EOF && ls\ngit push --force\nEOF\npwd', dir);
    assert.deepStrictEqual(cmds.map(c => c.argv), [['cat'], ['ls'], ['pwd']]);
  });
  test('parseCommands: git -C moves the working directory used by the push rule', () => {
    const repo = tmp('command-guard-repo-');
    const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: gitEnv() });
    assert.strictEqual(git('init', '-q', '-b', 'main').status, 0);
    const commit = git('-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false',
      'commit', '-q', '--allow-empty', '-m', 'init');
    assert.strictEqual(commit.status, 0, commit.stderr);
    assert.strictEqual(guard.check(`git -C ${repo} push --force`, { cwd: dir }).rule, 'force-push-mainline');
    assert.strictEqual(guard.check(`cd ${repo} && git push -f`, { cwd: dir }).rule, 'force-push-mainline');
    assert.strictEqual(git('checkout', '-q', '-b', 'topic').status, 0);
    assert.strictEqual(guard.check(`cd ${repo} && git push -f`, { cwd: dir }), null);
    fs.rmSync(repo, { recursive: true, force: true });
  });
  test('parseCommands: wrappers and an absolute git path are stripped, env assignments are kept aside', () => {
    const cmds = guard.parseCommands('sudo -u root env A=1 B=2 nice -n 5 timeout 9 /usr/bin/git status && xargs -n 1 -I{} echo x', dir);
    assert.deepStrictEqual(cmds.map(c => c.argv), [['/usr/bin/git', 'status'], ['echo', 'x']]);
    assert.deepStrictEqual(cmds[0].env, ['A=1', 'B=2']);
  });
  test('parseCommands: a quoted word without whitespace is unquoted, one with whitespace stays opaque', () => {
    const [cmd] = guard.parseCommands('git commit "--no-verify" "a b" \'c\' $\'d\'', dir);
    assert.deepStrictEqual(cmd.argv.slice(0, 3), ['git', 'commit', '--no-verify']);
    assert.ok(!cmd.argv.join(' ').includes('a b'), 'whitespace text is not split into words');
    assert.deepStrictEqual(cmd.argv.slice(4), ['c', 'd']);
  });
  test('check: a failing git lookup is ignored (not a repository)', () => {
    const plain = tmp('command-guard-plain-');
    assert.strictEqual(guard.check('git push -f', { cwd: plain }), null);
    fs.rmSync(plain, { recursive: true, force: true });
  });

  test('check: long digit runs are parsed in linear time', () => {
    for (const digits of [20000, 80000]) {
      const started = process.hrtime.bigint();
      assert.strictEqual(check(`echo ${'1'.repeat(digits)}`, { currentBranch: 'feature/x' }), null);
      assert.strictEqual(check(`echo ${'1'.repeat(digits)}>out && git commit -n -m x`, { currentBranch: 'feature/x' }).rule, 'no-verify');
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      assert.ok(ms < 1000, `${digits} digits took ${ms.toFixed(0)}ms`);
    }
  });
  test('check: redirections are not words', () => {
    assert.strictEqual(check('git commit -m x 2>&1', { currentBranch: 'feature/x' }), null);
    assert.strictEqual(check('git commit -m x 2>/dev/null >out <in', { currentBranch: 'feature/x' }), null);
    assert.strictEqual(check('git commit -n 2>/dev/null', { currentBranch: 'feature/x' }).rule, 'no-verify');
  });

  console.log('\ncommand-guard: the shipped hook');
  test('spawn: a blocked command exits 2 with BLOCKED (no-verify) on stderr', () => {
    const r = runHook(GUARD, bash('git commit --no-verify -m x', dir));
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('BLOCKED (no-verify)'), r.stderr);
  });
  test('spawn: the hook still runs when started through a symlinked directory', () => {
    const real = tmp('command-guard-real-');
    const links = tmp('command-guard-links-');
    const link = path.join(links, 'hooks');
    fs.copyFileSync(GUARD, path.join(real, 'command-guard.mjs'));
    try {
      fs.symlinkSync(real, link, 'dir');
    } catch {
      return; // no symlink support on this platform
    }
    const hook = path.join(link, 'command-guard.mjs');
    assert.notStrictEqual(fs.realpathSync(hook), hook, 'the path goes through a link');
    const blockedRun = runHook(hook, bash('git commit --no-verify -m x', dir));
    assert.strictEqual(blockedRun.status, 2, blockedRun.stderr);
    assert.ok(blockedRun.stderr.includes('BLOCKED (no-verify)'), blockedRun.stderr);
    assert.strictEqual(runHook(hook, bash('git commit -m x', dir)).status, 0);
    // a symlink to the file itself
    const fileLink = path.join(links, 'guard-link.mjs');
    fs.symlinkSync(path.join(real, 'command-guard.mjs'), fileLink);
    assert.strictEqual(runHook(fileLink, bash('git commit -n -m x', dir)).status, 2);
    fs.rmSync(real, { recursive: true, force: true });
    fs.rmSync(links, { recursive: true, force: true });
  });
  test('spawn: a force push to main exits 2 with the rule name', () => {
    const r = runHook(GUARD, bash('git push --force origin main', dir));
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('BLOCKED (force-push-mainline)'), r.stderr);
  });
  test('spawn: an allowed command exits 0 silently', () => {
    const r = runHook(GUARD, bash('git commit -m "mention --no-verify"', dir));
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stderr, '');
  });
  test('spawn: a non-Bash tool exits 0', () => {
    const r = runHook(GUARD, { tool_name: 'Edit', tool_input: { command: 'git commit --no-verify' }, cwd: dir });
    assert.strictEqual(r.status, 0, r.stderr);
  });
  test('spawn: malformed JSON exits 0', () => {
    const r = runHook(GUARD, '{not json');
    assert.strictEqual(r.status, 0, r.stderr);
  });
  test('spawn: empty stdin exits 0', () => {
    assert.strictEqual(runHook(GUARD, '').status, 0);
  });

  console.log('\ncommand-guard: [B] binding and mutation');
  const original = fs.readFileSync(GUARD, 'utf8');
  const work = tmp('command-guard-copy-');

  test('EXTRA_RULES: an entry substituted into the [B] line blocks its command', () => {
    const line = 'export const EXTRA_RULES = [];';
    assert.ok(original.includes(line), 'EXTRA_RULES line present');
    const rule = "{ name: 'no-frobnicate', test: ({ argv }) => argv[0] === 'frobnicate', reason: 'frobnicate is refused here' }";
    const patched = original.replace(line, `export const EXTRA_RULES = [${rule}];`);
    assert.notStrictEqual(patched, original, 'substitution applied');
    const file = path.join(work, 'extra.mjs');
    fs.writeFileSync(file, patched);
    const r = runHook(file, bash('echo ok && frobnicate --now', dir));
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('BLOCKED (no-frobnicate): frobnicate is refused here'), r.stderr);
    assert.strictEqual(runHook(file, bash('echo frobnicate', dir)).status, 0, 'a mention is not a run');
    assert.strictEqual(runHook(GUARD, bash('frobnicate --now', dir)).status, 0, 'the shipped file is unchanged');
  });
  test('EXTRA_RULES: a substituted rule sees the command\'s env and whether it runs in the background', () => {
    const line = 'export const EXTRA_RULES = [];';
    const rule = "{ name: 'bg-frobnicate', test: ({ argv, env, background }) => argv[0] === 'frobnicate' && background === true && env.ALLOW !== '1', reason: 'frobnicate runs in the foreground here' }";
    const patched = original.replace(line, `export const EXTRA_RULES = [${rule}];`);
    assert.notStrictEqual(patched, original, 'substitution applied');
    const file = path.join(work, 'extra-env.mjs');
    fs.writeFileSync(file, patched);
    for (const command of [
      'frobnicate --now &', '(frobnicate --now) &', 'echo a && frobnicate &', 'ALLOW=0 frobnicate &', 'bash -c "frobnicate" &',
      // an export in a ( ), a pipeline or a backgrounded list does not reach the shell after it
      '(export ALLOW=1); frobnicate &', 'export ALLOW=1 | true; frobnicate &', 'export ALLOW=1 & frobnicate &',
    ]) {
      const r = runHook(file, bash(command, dir));
      assert.strictEqual(r.status, 2, `${command}: ${r.stderr}`);
      assert.ok(r.stderr.includes('BLOCKED (bg-frobnicate): frobnicate runs in the foreground here'), r.stderr);
    }
    for (const command of [
      'frobnicate --now', 'ALLOW=1 frobnicate &', 'export ALLOW=1; frobnicate &', 'env ALLOW=1 frobnicate &', 'ALLOW="1" frobnicate &', 'frobnicate &> log', 'frobnicate |& tee log',
      // the backgrounded list carries its own export; a { } group is the current shell
      'export ALLOW=1 && frobnicate &', '{ export ALLOW=1; }; frobnicate &',
    ]) {
      assert.strictEqual(runHook(file, bash(command, dir)).status, 0, command);
    }
  });
  test('EXTRA_RULES: a substituted rule sees the directory a `cd` in the same shell moved it to', () => {
    const line = 'export const EXTRA_RULES = [];';
    const rule = "{ name: 'sub-frobnicate', test: ({ argv, cwd }) => argv[0] === 'frobnicate' && cwd.endsWith('/sub'), reason: 'frobnicate runs from the root here' }";
    const patched = original.replace(line, `export const EXTRA_RULES = [${rule}];`);
    assert.notStrictEqual(patched, original, 'substitution applied');
    const file = path.join(work, 'extra-cd.mjs');
    fs.writeFileSync(file, patched);
    for (const command of ['cd sub && frobnicate', '{ cd sub; }; frobnicate', 'cd sub; (frobnicate)']) {
      const r = runHook(file, bash(command, dir));
      assert.strictEqual(r.status, 2, `${command}: ${r.stderr}`);
      assert.ok(r.stderr.includes('BLOCKED (sub-frobnicate): frobnicate runs from the root here'), r.stderr);
    }
    // a cd in a ( ), a pipeline, a backgrounded list or a backtick stays in that subshell
    for (const command of ['(cd sub); frobnicate', 'cd sub | true; frobnicate', 'cd sub & frobnicate', '`cd sub`; frobnicate']) {
      assert.strictEqual(runHook(file, bash(command, dir)).status, 0, command);
    }
  });
  test('MAINLINE: substituting the [B] line changes which branches are protected', () => {
    const line = "export const MAINLINE = ['main', 'master'];";
    assert.ok(original.includes(line), 'MAINLINE line present');
    const patched = original.replace(line, "export const MAINLINE = ['release'];");
    assert.notStrictEqual(patched, original, 'substitution applied');
    const file = path.join(work, 'mainline.mjs');
    fs.writeFileSync(file, patched);
    assert.strictEqual(runHook(file, bash('git push --force origin release', dir)).status, 2);
    assert.strictEqual(runHook(file, bash('git push --force origin main', dir)).status, 0);
  });

  // Mutants are loaded outside test() because test() is synchronous. Each mutant removes one
  // piece of the guard; the matching case must stop being blocked (or start being blocked).
  const loaded = {};
  const mutants = new Proxy(loaded, {
    get(target, label) {
      if (target[label] instanceof Error) throw target[label];
      return target[label];
    },
  });
  const mutate = async (label, needle, replacement) => {
    const text = original.replace(needle, replacement);
    if (!original.includes(needle) || text === original) {
      loaded[label] = new Error(`mutant ${label}: needle not found in the shipped file: ${needle}`);
      return;
    }
    if (original.split(needle).length !== 2) {
      loaded[label] = new Error(`mutant ${label}: needle occurs more than once in the shipped file: ${needle}`);
      return;
    }
    const file = path.join(work, `mutant-${label}.mjs`);
    fs.writeFileSync(file, text);
    loaded[label] = await load(file);
  };
  const specs = [
    ['short-n', "if (ch === 'n') return true;", ''],
    ['abbrev', "if (name.length >= 6 && '--no-verify'.startsWith(name)) return true;", ''],
    ['mirror', "else if (name === '--mirror') force = everything = true;", ''],
    ['all', "else if (name === '--all') everything = true;", ''],
    ['hooks-subcommands', ' && HOOK_SUBCOMMANDS.has(parts.sub)', ''],
    ['eval', "words[0] === 'eval'", "words[0] === 'eval-x'"],
    ['commit-values', 'if (COMMIT_VALUE_LONG.has(name) && !t.includes(\'=\')) j++;', ''],
    ['config-env', "|| w === '--config-env'", ''],
    ['config-env-eq', "w.startsWith('--config-env=')", 'false'],
    ['heredoc', 'const m = marker.exec(text);', 'const m = null;'],
    ['basename', 'basename(cmd.argv[0]) !== \'git\'', "cmd.argv[0] !== 'git'"],
    ['unquote', 'return c && !/\\s/.test(c) && !c.includes(SEP) ? c : m;', 'return m;'],
    ['at-head', "name === 'HEAD' || name === '@'", "name === 'HEAD'"],
    ['dollar', "name.includes('$')", 'false'],
    ['husky', "env.HUSKY === '0'", "env.HUSKY === 'never'"],
    ['config-unset', 'if (unset) return true;', ''],
    ['delete', "const dropped = del ? refs : refs.filter((r) => r.startsWith(':'));", 'const dropped = [];'],
    ['wrapper-env', "['env', 'uCS']", "['env-x', 'uCS']"],
    ['wrapper-timeout', "['timeout', 'sk']", "['timeout-x', 'sk']"],
    ['wrapper-nice', "['nice', 'n']", "['nice-x', 'n']"],
    ['wrapper-sudo', "['sudo', 'ughpCDRrtTU']", "['sudo-x', 'ughpCDRrtTU']"],
    ['wrapper-xargs', "['xargs', 'InLPsdEa']", "['xargs-x', 'InLPsdEa']"],
    ['shell-basename', 'SHELLS.has(basename(words[0]))', 'SHELLS.has(words[0])'],
    ['push-o', "if (cluster[k] === 'o') {", 'if (false) {'],
    ['push-option-long', "'--exec', '--push-option']", "'--exec']"],
    ['comment', "c === '#' && (out", 'false && (out'],
    ['wrapper-if', "'!', 'if', ", "'!', "],
    ['wrapper-then', "'then', 'else'", "'else'"],
    ['wrapper-do', "'until', 'do', ", "'until', "],
    ['force-with', "(name.length >= 9 && '--force-with-lease'.startsWith(name))", 'false'],
    ['short-u', "if (ch === 'S' || ch === 'u') break; // optional value, attached", ''],
    ['git-dir', 'GIT_VALUE_OPTIONS.has(w)', 'false'],
    ['config-read', "if (read || (positionals[0] ?? '')", "if ((positionals[0] ?? '')"],
    ['hooks-dir', 'dirKey(positionals[1]) === dirKey(HOOKS_DIR)', 'false'],
    ['hooks-scope', '(plain && positionals.length === 2', '(positionals.length === 2'],
    ['delete-fallback', 'for (const name of dropped.map(nameOf)) {', 'for (const name of dropped.map(target)) {'],
    ['redirect-space', '(?:>>?|<{1,3})\\s*\\S*', '(?:>>?|<{1,3})\\S*'],
    ['fd-dup', '.replace(/(?<!\\d)\\d*[<>]&\\s*[^\\s;&|()<>]*/g, \' \')', ''],
    ['heredoc-backslash', '|\\\\?([A-Za-z_]', '|([A-Za-z_]'],
    ['heredoc-trim', 'l.trim() === delimiter', 'l === delimiter'],
    ['tags-only', 'if (tags && !everything && !refs.length) return null;', ''],
    ['nested-subst', "else if (src[j] === '$' && src[j + 1] === '(') j = skipSubstitution(src, j);", 'else if (false) j = skipSubstitution(src, j);'],
    ['push-no-verify', "if (parts.sub === 'push' && (pushSkipsHooks(parts.rest) || huskyOff)) {", "if (parts.sub === 'push' && huskyOff) {"],
    ['push-husky', "if (parts.sub === 'push' && (pushSkipsHooks(parts.rest) || huskyOff)) {", "if (parts.sub === 'push' && pushSkipsHooks(parts.rest)) {"],
    ['push-abbrev', "if (name.length >= 9 && '--no-verify'.startsWith(name)) return true;", "if (name === '--no-verify') return true;"],
    ['push-nv-o', 'j++; // -o <push-option>: the value is the next word', ''],
    ['env-override', 'HOOK_SUBCOMMANDS.has(parts.sub) ? envOverridesHooks(env) : null', 'null'],
    ['env-subcommand', 'HOOK_SUBCOMMANDS.has(parts.sub) ? envOverridesHooks', 'true ? envOverridesHooks'],
    ['env-key-case', '/^core\\.hookspath$/i.test(value)', '/^core\\.hookspath$/.test(value)'],
    ['env-key-dynamic', ' || /[$`]/.test(value)', ''],
    ['env-parameters', "if (name === 'GIT_CONFIG_PARAMETERS') return name;", ''],
    ['export', 'state.exported.push(...words', '[].push(...words'],
    ['script-env', 'inner.env.unshift(...env);', ''],
    ['wrapper-command', "['command', '']", "['command-x', '']"],
    ['wrapper-exec-a', "['exec', 'a']", "['exec', '']"],
    ['wrapper-time-o', "['time', 'of']", "['time', '']"],
    ['wrapper-time-long', "['time', ['--output', '--format']]", "['time', []]"],
    ['pull-hooks', "'merge', 'pull', 'push'", "'merge', 'push'"],
    ['merge-dashdash', "for (const t of rest) {\n    if (t === '--no-verify') return true;", "for (const t of rest) {\n    if (t === '--') break;\n    if (t === '--no-verify') return true;"],
    ['background', "if (t === '&') endList(true);", "if (t === '&') endList(false);"],
    ['background-list', 'if (background) for (const seg of top().list) seg.background = true;', 'if (background && top().list.length) top().list[top().list.length - 1].background = true;'],
    ['background-group', 'top().list.push(...group.all);', ''],
    ['background-brace', "else if (first === '{') open('}');", ''],
    ['background-script', 'parse(script, dir, quoted, depth + 1, bg)', 'parse(script, dir, quoted, depth + 1)'],
    ['amp-redirect', ".replace(/(?<!&)&>>?\\s*[^\\s;&|()<>]*/g, ' ')", ''],
    ['pipe-amp', ".replace(/\\|&/g, '|')", ''],
    ['runner-names', "new Set(['codex', 'codex-run.mjs', 'claude-run.mjs'])", 'new Set([])'],
    ['runner-node', "if (name !== 'node' && name !== 'bun') return false;", 'return false;'],
    ['runner-basename', 'SCRIPT_RUNNERS.has(basename(w))', 'SCRIPT_RUNNERS.has(w)'],
    ['flat-state', 'while (!n.subshell) n = n.parent;', 'while (n.parent) n = n.parent;'],
    ['newline-continue', "if (t === '\\n' && continued) continue;", ''],
    ['runner-first-word', 'argv.slice(1).some((w) => SCRIPT_RUNNERS.has(basename(w)))', "SCRIPT_RUNNERS.has(basename(argv.slice(1).find((w) => !w.startsWith('-')) ?? ''))"],
    ['resolved-env', "const huskyOff = env.HUSKY === '0';", 'const huskyOff = cmd.env.some((e) => /^HUSKY=0$/.test(parts.unq(e)));'],
  ];
  for (const [label, needle, replacement] of specs) await mutate(label, needle, replacement);

  const opts = { cwd: dir, currentBranch: 'feature/x' };
  const surviving = (label, command, o = opts) => {
    assert.ok(guard.check(command, o), `shipped guard blocks: ${command}`);
    assert.strictEqual(mutants[label].check(command, o), null, `mutant ${label} lets through: ${command}`);
  };
  const kills = [
    ['short-n', 'removing the short-cluster n detection stops blocking `git commit -nm x`', 'git commit -nm x'],
    ['abbrev', 'ignoring --no-verify abbreviations lets `git commit --no-verif` through', 'git commit --no-verif -m x'],
    ['mirror', 'ignoring --mirror lets `git push --mirror origin` through', 'git push --mirror origin'],
    ['all', 'ignoring --all lets `git push --all --force origin` through', 'git push --all --force origin'],
    ['eval', 'not parsing eval lets `eval "git commit -n"` through', 'eval "git commit -n -m x"'],
    ['commit-values', 'not skipping value-taking commit options mistakes the value for a flag', null],
    ['config-env', 'ignoring --config-env lets the separate-word form through', 'git --config-env core.hooksPath=HP commit -m x'],
    ['config-env-eq', 'ignoring --config-env= lets the attached form through', 'git --config-env=core.hooksPath=HP commit -m x'],
    ['basename', 'comparing argv[0] literally lets /usr/bin/git through', '/usr/bin/git commit -n -m x'],
    ['unquote', 'not unquoting words lets a quoted flag through', 'git commit "--no-verify"'],
    ['at-head', 'not reading @ as HEAD lets `git push -f origin @` through', 'git push -f origin @', { cwd: dir, currentBranch: 'main' }],
    ['dollar', 'not treating $ refspecs as unresolved lets `git push -f origin "$B"` through', 'git push -f origin "$B"', { cwd: dir, currentBranch: 'main' }],
    ['husky', 'ignoring HUSKY=0 lets it through', 'HUSKY=0 git commit -m x'],
    ['config-unset', 'ignoring --unset lets `git config --unset core.hooksPath` through', 'git config --unset core.hooksPath'],
    ['delete', 'ignoring deletes lets `git push origin :main` through', 'git push origin :main'],
    ['wrapper-env', 'not stripping env', 'env git commit -n'],
    ['wrapper-timeout', 'not stripping timeout', 'timeout 60 git commit -n'],
    ['wrapper-nice', 'not stripping nice', 'nice -n 5 git commit -n'],
    ['wrapper-sudo', 'not stripping sudo', 'sudo git commit -n'],
    ['wrapper-xargs', 'not stripping xargs', 'xargs git commit -n'],
    ['shell-basename', 'comparing the shell name literally lets /bin/bash -c through', '/bin/bash -c "git commit -n -m x"'],
    ['push-no-verify', 'ignoring push --no-verify lets it skip pre-push', 'git push --no-verify origin feature/x'],
    ['push-husky', 'ignoring HUSKY=0 on a push lets it through', 'HUSKY=0 git push origin feature/x'],
    ['push-abbrev', 'not expanding push --no-veri lets the abbreviation through', 'git push --no-veri origin feature/x'],
    ['env-override', 'ignoring inline GIT_CONFIG_* lets a hooksPath override through', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x'],
    ['env-key-case', 'a case-sensitive key match lets core.hooksPath through', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x'],
    ['env-key-dynamic', 'trusting a non-literal key lets "$K" through', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="$K" GIT_CONFIG_VALUE_0=/dev/null git commit -m x'],
    ['env-parameters', 'ignoring GIT_CONFIG_PARAMETERS lets it through', 'GIT_CONFIG_PARAMETERS=x git pull'],
    ['export', 'not tracking export lets `export HUSKY=0; git commit` through', 'export HUSKY=0; git commit -m x'],
    ['script-env', 'not inheriting the shell env lets `HUSKY=0 bash -c` through', 'HUSKY=0 bash -c "git commit -m x"'],
    ['wrapper-command', 'not stripping command (with -p)', 'command -p git commit -n -m x'],
    ['wrapper-exec-a', 'not skipping the exec -a value', 'exec -a x git commit -n -m x'],
    ['wrapper-time-o', 'not skipping the time -o value', 'time -o /tmp/t git commit -n -m x'],
    ['wrapper-time-long', 'not skipping the time --output value', 'time --output /tmp/t git commit -n -m x'],
    ['pull-hooks', 'leaving pull out of the hook subcommands lets -c core.hooksPath on pull through', 'git -c core.hooksPath=/dev/null pull'],
    ['merge-dashdash', 'stopping at `--` lets `git merge -m -- --no-verify` through', 'git merge -m -- --no-verify feature/x'],
    ['background', 'ignoring `&` lets a backgrounded codex run through', 'codex exec x &'],
    ['background-list', 'backgrounding only the last pipeline lets `codex exec x && echo ok &` through', 'codex exec x && echo ok &'],
    ['background-group', 'not propagating a group lets `(codex exec x) &` through', '(codex exec x) &'],
    ['background-brace', 'not reading a brace group lets `{ codex exec x; } &` through', '{ codex exec x; } &'],
    ['background-script', 'not passing background into a script lets `bash -c "codex exec x" &` through', 'bash -c "codex exec x" &'],
    ['runner-names', 'an empty runner list lets `codex exec x &` through', 'codex exec x &'],
    ['runner-node', 'not reading node scripts lets `node scripts/codex-run.mjs &` through', 'node scripts/codex-run.mjs review &'],
    ['runner-basename', 'comparing the script path literally lets scripts/codex-run.mjs through', 'node scripts/codex-run.mjs review &'],
    ['newline-continue', 'ending the list at a newline after && lets `codex exec x &&\\n echo ok &` through', 'codex exec x &&\n echo ok &'],
    ['runner-first-word', 'taking the first non-option word as the script lets `node --title harness ...` through', 'node --title harness scripts/codex-run.mjs review &'],
  ];
  for (const [label, title, command, o] of kills) {
    test(`mutation (${label}): ${title}`, () => {
      if (command === null) {
        assert.strictEqual(guard.check('git commit --author "-n" -m x', opts), null);
        assert.ok(mutants[label].check('git commit --author "-n" -m x', opts), 'mutant reads the --author value as a flag');
        return;
      }
      surviving(label, command, o);
    });
  }
  // Shipped allows the command, the mutant blocks it (a false positive the mutant would add).
  const main = { cwd: dir, currentBranch: 'main' };
  const allowedOnlyByShipped = [
    ['push-o', 'a push option value that looks like -f is not a flag', 'git push -o -f origin main'],
    ['push-option-long', 'a --push-option value that looks like -f is not a flag', 'git push --push-option -f origin main'],
    ['comment', 'a trailing comment is not parsed', 'git commit -m x # -n'],
    ['short-u', 'an attached -uno value is not a -n flag', 'git commit -uno -m x'],
    ['config-read', 'a read with a value pattern is not a write', 'git config --get core.hooksPath dev'],
    ['hooks-dir', 'the documented install command is allowed', 'git config core.hooksPath .githooks'],
    ['hooks-dir', 'the documented install command is allowed (./ and / forms)', 'git config --local core.hooksPath ./.githooks/'],
    ['delete-fallback', 'an unresolved delete target is not the mainline', 'git push origin --delete "$OLD"', main],
    ['delete-fallback', 'an unresolved delete target in a loop is not the mainline', 'for b in fix/a fix/b; do git push origin --delete "$b"; done', main],
    ['heredoc-backslash', 'a <<\\EOF body is not parsed', 'git commit -F - <<\\EOF\ngit commit -n\nEOF'],
    ['tags-only', 'a force push of only tags is allowed', 'git push -f --tags', main],
    ['nested-subst', 'nested quotes in "$(...)" do not flip the masking', 'git commit -m "$(echo "retry -ing")"'],
    ['push-nv-o', 'a push option value that looks like --no-verify is not a flag', 'git push -o --no-verify origin feature/x'],
    ['env-subcommand', 'an inline GIT_CONFIG_* on a subcommand that runs no hook is allowed', 'GIT_CONFIG_PARAMETERS=x git status'],
    ['amp-redirect', '`&>` is a redirection, not a background launch', 'codex exec x &> log'],
    ['pipe-amp', '`|&` is a pipe, not a background launch', 'codex exec x |& tee log'],
    ['flat-state', 'an export in a ( ) subshell does not reach the command after it', '(export HUSKY=0); git commit -m x'],
    ['resolved-env', 'an inline HUSKY=1 after an exported HUSKY=0 is the value git gets', 'export HUSKY=0; HUSKY=1 git commit -m x'],
  ];
  for (const [label, title, command, o = opts] of allowedOnlyByShipped) {
    test(`mutation (${label}): ${title}`, () => {
      assert.strictEqual(guard.check(command, o), null, `shipped guard allows: ${command}`);
      assert.ok(mutants[label].check(command, o), `mutant ${label} blocks: ${command}`);
    });
  }
  // Shipped blocks the command, the mutant lets it through.
  const blockedOnlyByShipped = [
    ['wrapper-if', 'not stripping `if` lets `if git commit -n; then` through', 'if git commit -n -m x; then echo ok; fi'],
    ['wrapper-then', 'not stripping `then`', 'if true; then git commit -n -m x; fi'],
    ['wrapper-do', 'not stripping `do`', 'for i in 1 2; do git commit -n -m x; done'],
    ['force-with', 'not expanding --force-with lets `git push --force-with origin main` through', 'git push --force-with origin main'],
    ['git-dir', 'not skipping the --git-dir value hides the subcommand', 'git --git-dir .git commit -n -m x'],
    ['hooks-scope', 'allowing every scope lets `git config --global core.hooksPath .githooks` through', 'git config --global core.hooksPath .githooks'],
    ['redirect-space', 'a spaced redirect target becomes a refspec and hides the push of the current branch', 'git push -f origin > /tmp/log 2>&1', main],
    ['fd-dup', 'splitting `2>&1` on & hides the refspec after it', 'git push -f 2>&1 origin main'],
    ['heredoc-trim', 'an indented <<- terminator is found', 'cat <<-EOF\n\tbody\n\tEOF\ngit commit -n -m x'],
  ];
  for (const [label, title, command, o = opts] of blockedOnlyByShipped) {
    test(`mutation (${label}): ${title}`, () => surviving(label, command, o));
  }
  test('mutation (hooks-subcommands): the hooksPath rule applied to every subcommand blocks `git -c core.hooksPath=x status`', () => {
    assert.strictEqual(guard.check('git -c core.hooksPath=x status', opts), null);
    assert.strictEqual(mutants['hooks-subcommands'].check('git -c core.hooksPath=x status', opts).rule, 'hooks-path-override');
  });
  test('mutation (heredoc): without heredoc stripping a heredoc body of bypass commands is blocked', () => {
    const command = "git commit -F - <<'EOF'\ngit commit --no-verify\nEOF";
    assert.strictEqual(guard.check(command, opts), null);
    assert.ok(mutants.heredoc.check(command, opts), 'mutant sees the body');
    const dashed = 'git commit -F - <<-EOF\n\tgit commit -n\n\tEOF';
    assert.strictEqual(guard.check(dashed, opts), null);
    assert.ok(mutants.heredoc.check(dashed, opts), 'mutant sees the <<- body');
  });
  test('mutation: the short-cluster mutant still catches the long form', () => {
    assert.strictEqual(mutants['short-n'].check('git commit --no-verify -m x', opts).rule, 'no-verify');
  });

  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

main()
  .catch(error => {
    console.log(`  ✗ test run crashed\n    Error: ${error.stack}`);
    failed += 1;
  })
  .finally(() => {
    console.log(`\nPassed: ${passed}`);
    console.log(`Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
  });
