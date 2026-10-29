// harness-bootstrap commit-guard tests (generated YYYY-MM-DD). Run: node --test scripts/lib/harness-guard.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED guard, never a copy: each case
// is a throwaway repo whose pre-commit and pre-merge-commit exec it, the way git runs it, with
// this project's REGISTRY, ID_PATTERN, SCOPE and MAINLINE read from the guard itself. No other hook
// of the project runs there, and no GIT_* variable or global config reaches it.
// [B] binding: GUARD and MERGE_GUARD (the guard scripts the two hooks run, relative to the repo root),
// HOOK_FILES (the hook files git runs for them), MAINLINE (the guard's expected MAINLINE: a binding
// that is itself a control has its expected literal here) and IDS (the plan's ids; empty in change
// mode, where branches carry none).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// [B] .githooks/pre-commit and .githooks/pre-merge-commit with no hook manager; with husky or
// lefthook, the one script both hooks call (.githooks/harness-guard.sh) for both.
const GUARD = '.githooks/pre-commit';
const MERGE_GUARD = '.githooks/pre-merge-commit';
// [B] The files git runs for pre-commit and pre-merge-commit, each the guard itself or running GUARD
// as its first command: GUARD and MERGE_GUARD with no hook manager; with husky,
// ['.husky/pre-commit', '.husky/pre-merge-commit'].
const HOOK_FILES = ['.githooks/pre-commit', '.githooks/pre-merge-commit'];
// [B] The branch lands merge into, as the guard's MAINLINE must read; the throwaway repos use it too.
const MAINLINE = 'main';
// [B] Every id shape the plan uses: ID_PATTERN must take each one whole (commit-guard.md).
const IDS = [];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, GUARD), 'utf8');
const binding = (name) => new RegExp(`^${name}=(["']?)(.*?)\\1(?:\\s|$)`, 'm').exec(SOURCE)?.[2];
const REGISTRY = binding('REGISTRY');
const ID_PATTERN = binding('ID_PATTERN') ?? '';
const SCOPE = binding('SCOPE');

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(ENV, { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' });

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
};
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
const head = (d) => git(d, 'rev-parse', 'HEAD').stdout.trim();

/** A repo with one commit on main, then hooks that exec the installed guard. */
function repo() {
  const d = tmp('harness-guard-repo-');
  const hooks = tmp('harness-guard-hooks-');
  for (const [name, target] of [['pre-commit', GUARD], ['pre-merge-commit', MERGE_GUARD]]) {
    fs.writeFileSync(path.join(hooks, name), `#!/bin/sh\nexec "${path.join(ROOT, target)}" "$@"\n`, { mode: 0o755 });
  }
  git(d, 'init', '-q', '-b', MAINLINE);
  git(d, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(d, 'a.txt'), '0\n');
  git(d, 'add', 'a.txt');
  assert.equal(git(d, 'commit', '-q', '-m', 'init').status, 0, 'the first commit, before the hooks are on');
  git(d, 'config', 'core.hooksPath', hooks);
  return d;
}

/** The registry: row 0, then the held rows ([unit, branch, worktree], Worktree `main` by default), inside the active markers. */
function registry(d, rows, markers = true) {
  const held = rows.map(([unit, branch, wt = 'main'], i) => `| ${i + 1} | ${unit} | 2 implement | ${branch} | ${wt} | | 2026-10-26T00:00:00Z |`);
  const table = ['| # | Unit | Step | Branch | Worktree | Resources | Claimed (UTC) |', '|---|---|---|---|---|---|---|', '| 0 | mainline, never claimed | | | main | | |', ...held].join('\n');
  const file = path.join(d, REGISTRY);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, markers ? `<!-- harness:active -->\n${table}\n<!-- /harness:active -->\n` : `${table}\n`);
}

/** Stages one more line of `file` and commits it; `moved` says whether HEAD moved. */
function commit(d, msg, file = 'a.txt') {
  fs.appendFileSync(path.join(d, file), `${msg}\n`);
  git(d, 'add', file);
  const before = head(d);
  const r = git(d, 'commit', '-q', '-m', msg);
  return { ...r, moved: head(d) !== before };
}

const OWNER = 'harness/guard-probe';
const REFUSAL = /: REFUSE - /;
const taskBranch = (id) => `task/${id.toLowerCase()}`;

/** A linked worktree of `d` at .worktrees/probe, on a new `branch`. */
function worktree(d, branch) {
  const wt = path.join(d, '.worktrees', 'probe');
  const r = git(d, 'worktree', 'add', '-q', wt, '-b', branch);
  assert.equal(r.status, 0, `git worktree add: ${r.stderr}`);
  return wt;
}

test('the guard is installed as git runs it: executable, and the merge hook is the same script', () => {
  for (const f of new Set([GUARD, MERGE_GUARD])) fs.accessSync(path.join(ROOT, f), fs.constants.X_OK);
  if (MERGE_GUARD !== GUARD) assert.equal(fs.readFileSync(path.join(ROOT, MERGE_GUARD), 'utf8'), SOURCE, `${MERGE_GUARD} differs from ${GUARD}`);
});

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// GUARD run so that its refusal fails the hook, nothing else on the line: `exec [sh] GUARD ["$@"]`, or
// `[sh] GUARD ["$@"] || exit` with no argument, `$?` or a non-zero literal.
const call = (n) => `(?:(?:/bin/)?sh\\s+)?(["']?)(?:\\./)?${escape(GUARD)}\\${n}(?:\\s+"\\$@")?`;
const CALLS_GUARD = new RegExp(`^(?:exec\\s+${call(1)}|${call(2)}\\s*\\|\\|\\s*exit(?:\\s+(?:\\$\\?|[1-9][0-9]*))?)$`);

test('each hook file git runs exists and is the guard, or runs it first and passes its refusal on', () => {
  assert.equal(HOOK_FILES.length, 2, 'HOOK_FILES lists the pre-commit and the pre-merge-commit hook file');
  for (const f of HOOK_FILES) {
    const file = path.join(ROOT, f);
    assert.ok(fs.existsSync(file), `${f} does not exist`);
    // husky v9 runs .husky/<hook> with sh from its .husky/_ stubs; git runs any other hook file itself
    if (!f.startsWith('.husky/')) assert.ok((fs.statSync(file).mode & 0o111) !== 0, `${f} is not executable`);
    const text = fs.readFileSync(file, 'utf8');
    if (text === SOURCE) continue;
    // by behaviour: GUARD stubbed to refuse, the hook run by plain sh (no -e) must fail
    const box = tmp('harness-guard-hookfile-');
    for (const [rel, body, mode] of [[f, text, 0o644], [GUARD, '#!/bin/sh\nexit 1\n', 0o755]]) {
      fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
      fs.writeFileSync(path.join(box, rel), body, { mode });
    }
    const run = spawnSync('sh', [f], { cwd: box, encoding: 'utf8', env: ENV });
    assert.notEqual(run.status, 0, `${f} exits 0 when ${GUARD} refuses: it does not pass the refusal on`);
    const first = text.split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#'));
    assert.match(first ?? '', CALLS_GUARD, `${f} does not run ${GUARD} as its first command (it runs: ${first ?? 'nothing'})`);
  }
});

test('the bindings: REGISTRY is set, SCOPE is repo or checkout, MAINLINE is the expected one, and ID_PATTERN takes every id whole', () => {
  assert.ok(REGISTRY, `no REGISTRY= line in ${GUARD}`);
  assert.ok(['repo', 'checkout'].includes(SCOPE), `SCOPE is ${SCOPE}`);
  assert.equal(binding('MAINLINE'), MAINLINE, `${GUARD} binds MAINLINE to ${binding('MAINLINE')}, not ${MAINLINE}`);
  if (ID_PATTERN === '') assert.deepEqual(IDS, [], 'IDS lists ids but ID_PATTERN is empty');
  else assert.ok(IDS.length > 0, 'ID_PATTERN is set but IDS lists no id to hold it to');
  // the guard's own extraction: uppercase the branch, first grep -oE match
  const extract = (branch) => spawnSync('sh', ['-c', 'printf "%s\\n" "$B" | tr "[:lower:]" "[:upper:]" | grep -oE "$P" | head -n 1'], { encoding: 'utf8', env: { ...ENV, B: branch, P: ID_PATTERN } }).stdout.trim();
  for (const id of IDS) {
    const got = extract(taskBranch(id));
    assert.equal(got, id.toUpperCase(), `ID_PATTERN takes '${got}' from ${taskBranch(id)}, not ${id}`);
  }
});

test('no registry, or row 0 alone: every branch commits', () => {
  const d = repo();
  assert.equal(commit(d, 'free').moved, true, 'no registry');
  registry(d, []);
  for (const branch of [MAINLINE, OWNER]) {
    git(d, 'switch', '-q', '-C', branch);
    const r = commit(d, branch);
    assert.equal(r.moved, true, `${branch} with row 0 alone: ${r.stderr}`);
  }
});

test('a registry without its active markers is refused', () => {
  const d = repo();
  registry(d, [['probe', OWNER]], false);
  const r = commit(d, 'x');
  assert.equal(r.moved, false);
  assert.match(r.stderr, /harness:active/);
});

test('the run that holds a row commits on its branch; the mainline and any other branch are refused meanwhile', () => {
  const d = repo();
  registry(d, [['probe', OWNER]]);
  assert.equal(git(d, 'switch', '-q', '-c', OWNER).status, 0);
  const own = commit(d, 'owner');
  assert.equal(own.moved, true, own.stderr);
  for (const branch of [MAINLINE, 'other/branch']) {
    git(d, 'switch', '-q', '-C', branch);
    const r = commit(d, branch);
    assert.equal(r.moved, false, `${branch} committed while ${OWNER} holds the row`);
    assert.match(r.stderr, REFUSAL);
  }
});

test('a clean merge onto the mainline while a row is held is refused by the merge hook; released, it goes through', () => {
  const d = repo();
  git(d, 'switch', '-q', '-c', OWNER);
  commit(d, 'owner work', 'b.txt');
  git(d, 'switch', '-q', MAINLINE);
  commit(d, 'mainline moved');
  registry(d, [['probe', OWNER]]);
  const before = head(d);
  const m = git(d, 'merge', '--no-ff', '-q', '-m', 'merge', OWNER);
  assert.notEqual(m.status, 0, 'a --no-ff merge onto main while a row is held');
  assert.match(m.stderr, REFUSAL);
  assert.equal(head(d), before);
  git(d, 'merge', '--abort');
  fs.rmSync(path.join(d, REGISTRY));
  const r = git(d, 'merge', '--no-ff', '-q', '-m', 'merge', OWNER);
  assert.equal(r.status, 0, r.stderr);
});

test('a row that locks a linked worktree: under checkout the main checkout commits and the worktree refuses another branch; under repo the mainline is refused', () => {
  const d = repo();
  const wt = worktree(d, OWNER);
  registry(d, [['probe', OWNER, '.worktrees/probe']]);
  const own = commit(wt, 'owner');
  assert.equal(own.moved, true, `the owner in its worktree: ${own.stderr}`);
  const main = commit(d, 'mainline');
  if (SCOPE === 'checkout') {
    assert.equal(main.moved, true, `SCOPE=checkout: the main checkout was refused for a row that locks .worktrees/probe: ${main.stderr}`);
    git(wt, 'switch', '-q', '-c', 'other/branch');
    const other = commit(wt, 'other');
    assert.equal(other.moved, false, 'SCOPE=checkout: another branch committed in the worktree the row locks');
    assert.match(other.stderr, REFUSAL);
  } else {
    assert.equal(main.moved, false, 'SCOPE=repo: the mainline committed while a row is held');
    assert.match(main.stderr, REFUSAL);
  }
});

test('merging a branch that still holds a row is refused, naming it; once its row is released it merges', () => {
  const d = repo();
  const wt = worktree(d, OWNER);
  commit(wt, 'owner work', 'b.txt');
  commit(d, 'mainline moved');
  registry(d, [['probe', OWNER, '.worktrees/probe']]);
  const before = head(d);
  const m = git(d, 'merge', '--no-ff', '-q', '-m', 'merge', OWNER);
  assert.notEqual(m.status, 0, `SCOPE=${SCOPE}: a --no-ff merge of ${OWNER} went through while its row is held`);
  assert.ok(m.stderr.includes(`'${OWNER}', which still holds a row`), `the refusal does not name ${OWNER} as still holding a row: ${m.stderr}`);
  assert.equal(head(d), before);
  git(d, 'merge', '--abort');
  registry(d, []);
  const r = git(d, 'merge', '--no-ff', '-q', '-m', 'merge', OWNER);
  assert.equal(r.status, 0, `released, the merge is refused: ${r.stderr}`);
});

test("each plan id: its task branch is refused until the id's row is held, then commits", () => {
  const d = repo();
  for (const id of IDS) {
    git(d, 'switch', '-q', '-C', taskBranch(id));
    registry(d, [['probe', OWNER]]);
    const r = commit(d, `${id} without its row`);
    assert.equal(r.moved, false, `${taskBranch(id)} committed with no row for ${id}`);
    assert.match(r.stderr, REFUSAL);
    registry(d, [[id, '']]);
    const own = commit(d, `${id} with its row`);
    assert.equal(own.moved, true, `${id}: ${own.stderr}`);
  }
});

test('the run that holds a row pulls its own branch back, diverged: its own row does not refuse the merge', () => {
  const d = repo();
  const origin = tmp('harness-guard-origin-');
  git(origin, 'init', '-q', '--bare');
  git(d, 'remote', 'add', 'origin', origin);
  registry(d, [['probe', OWNER]]);
  git(d, 'switch', '-q', '-c', OWNER);
  assert.equal(commit(d, 'owner work', 'b.txt').moved, true);
  assert.equal(git(d, 'push', '-q', 'origin', OWNER).status, 0, 'push');
  // the pushed branch moves on elsewhere: a copy, committed past the hooks, pushed over it
  git(d, 'switch', '-q', '-c', 'probe/elsewhere');
  fs.writeFileSync(path.join(d, 'c.txt'), 'elsewhere\n');
  git(d, 'add', 'c.txt');
  assert.equal(git(d, 'commit', '-q', '--no-verify', '-m', 'elsewhere').status, 0);
  assert.equal(git(d, 'push', '-q', 'origin', `probe/elsewhere:${OWNER}`).status, 0, 'push over it');
  git(d, 'switch', '-q', OWNER);
  assert.equal(commit(d, 'owner again', 'b.txt').moved, true);
  const pull = git(d, 'pull', '-q', '--no-rebase', '--no-edit', 'origin', OWNER);
  assert.equal(pull.status, 0, `the owning run's pull of its own branch was refused: ${pull.stderr}`);
  assert.ok(fs.existsSync(path.join(d, 'c.txt')), 'the pull merged');
});

test("each plan id: a branch carrying the id merges into the id's task branch while its row is held", () => {
  const d = repo();
  for (const id of IDS) {
    git(d, 'switch', '-q', '-C', taskBranch(id), MAINLINE);
    registry(d, [[id, '']]);
    assert.equal(commit(d, `${id} work`, 'b.txt').moved, true, `${id}: the owning run's commit`);
    const sub = `${taskBranch(id)}-review`;
    git(d, 'switch', '-q', '-c', sub);
    const r = commit(d, `${id} review`, 'c.txt');
    assert.equal(r.moved, true, `${sub} carries ${id}, whose row is held: ${r.stderr}`);
    git(d, 'switch', '-q', taskBranch(id));
    const m = git(d, 'merge', '--no-ff', '-q', '-m', `merge ${sub}`, sub);
    assert.equal(m.status, 0, `the owning run's merge of ${sub} was refused: ${m.stderr}`);
  }
});
