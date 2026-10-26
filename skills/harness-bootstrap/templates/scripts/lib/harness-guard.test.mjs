// harness-bootstrap commit-guard tests (generated YYYY-MM-DD). Run: node --test scripts/lib/harness-guard.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED guard, never a copy: each case
// is a throwaway repo whose pre-commit and pre-merge-commit exec it, the way git runs it, with
// this project's REGISTRY, ID_PATTERN and SCOPE read from the guard itself. No other hook of the
// project runs there, and no GIT_* variable or global config reaches it.
// [B] binding: GUARD and MERGE_GUARD (the files the two hooks run, relative to the repo root) and
// IDS (the plan's ids; empty in change mode, where branches carry none).
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
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(d, 'a.txt'), '0\n');
  git(d, 'add', 'a.txt');
  assert.equal(git(d, 'commit', '-q', '-m', 'init').status, 0, 'the first commit, before the hooks are on');
  git(d, 'config', 'core.hooksPath', hooks);
  return d;
}

/** The registry: row 0, then the held rows ([unit, branch], Worktree `main`), inside the active markers. */
function registry(d, rows, markers = true) {
  const held = rows.map(([unit, branch], i) => `| ${i + 1} | ${unit} | 2 implement | ${branch} | main | | 2026-10-26T00:00:00Z |`);
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

test('the guard is installed as git runs it: executable, and the merge hook is the same script', () => {
  for (const f of [GUARD, MERGE_GUARD]) fs.accessSync(path.join(ROOT, f), fs.constants.X_OK);
  assert.equal(fs.readFileSync(path.join(ROOT, MERGE_GUARD), 'utf8'), SOURCE, `${MERGE_GUARD} differs from ${GUARD}`);
});

test('the bindings: REGISTRY is set, SCOPE is repo or checkout, and ID_PATTERN takes every id whole', () => {
  assert.ok(REGISTRY, `no REGISTRY= line in ${GUARD}`);
  assert.ok(['repo', 'checkout'].includes(SCOPE), `SCOPE is ${SCOPE}`);
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
  for (const branch of ['main', OWNER]) {
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
  for (const branch of ['main', 'other/branch']) {
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
  git(d, 'switch', '-q', 'main');
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
