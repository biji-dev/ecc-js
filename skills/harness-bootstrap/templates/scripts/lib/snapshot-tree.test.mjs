// harness-bootstrap snapshot-tree tests (generated YYYY-MM-DD). Run: node --test scripts/lib/snapshot-tree.test.mjs
// [M] mechanism (ships as-is): every test. Each case builds a temp repository; the environment has
// no GIT_* variable and no global git config, so nothing outside the temp directories is read.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { baseTreeOf, currentBranch, snapshotTree } from './snapshot-tree.mjs';

const tempDirs = [];
function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

// Hermetic for this process too: snapshotTree scrubs its own children, but the helpers below do not.
for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];
process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_NOSYSTEM = '1';

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

/** A repository with one commit holding tracked.txt and a .gitignore. */
function repo() {
  const dir = tmpDir('snapshot-tree-');
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'tracked.txt', 'base\n');
  write(dir, '.gitignore', 'ignored.log\nbuild/\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

/** The content git holds for `rel` in `tree`, or null when the tree has no such file. */
function inTree(dir, tree, rel) {
  const r = spawnSync('git', ['cat-file', '-p', `${tree}:${rel}`], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

test('a modified tracked file is in the tree with its working-tree content', () => {
  const dir = repo();
  write(dir, 'tracked.txt', 'edited, not staged\n');
  const tree = snapshotTree(dir);
  assert.match(tree, /^[0-9a-f]{40}$/);
  assert.equal(inTree(dir, tree, 'tracked.txt'), 'edited, not staged\n');
});

test('an untracked file is not in the tree: no reviewer\'s diff shows it', () => {
  const dir = repo();
  write(dir, 'sub/new.txt', 'untracked\n');
  const tree = snapshotTree(dir);
  assert.equal(tree, git(dir, 'rev-parse', 'HEAD^{tree}'));
  assert.equal(inTree(dir, tree, 'sub/new.txt'), null);
});

test('a deleted tracked file is absent from the tree', () => {
  const dir = repo();
  fs.rmSync(path.join(dir, 'tracked.txt'));
  const tree = snapshotTree(dir);
  assert.match(tree, /^[0-9a-f]{40}$/);
  assert.equal(inTree(dir, tree, 'tracked.txt'), null);
  assert.equal(inTree(dir, tree, '.gitignore'), 'ignored.log\nbuild/\n');
});

// a flag hides the edit from `git diff`, so from every reviewer's diff: the review read other bytes
test('an assume-unchanged edit gives no tree, and the real index keeps its flag', () => {
  const dir = repo();
  git(dir, 'update-index', '--assume-unchanged', 'tracked.txt');
  write(dir, 'tracked.txt', 'edited under assume-unchanged\n');
  assert.equal(snapshotTree(dir), null);
  assert.match(git(dir, 'ls-files', '-v', 'tracked.txt'), /^h tracked\.txt$/);
});

test('a skip-worktree edit gives no tree, and the real index keeps its flag', () => {
  const dir = repo();
  git(dir, 'update-index', '--skip-worktree', 'tracked.txt');
  write(dir, 'tracked.txt', 'edited under skip-worktree\n');
  assert.equal(snapshotTree(dir), null);
  assert.match(git(dir, 'ls-files', '-v', 'tracked.txt'), /^S tracked\.txt$/);
});

test('a flagged file with no change on disk gives the same tree as without the flag', () => {
  const dir = repo();
  write(dir, '.gitignore', 'edited, not flagged\n');
  const plain = snapshotTree(dir);
  assert.match(plain, /^[0-9a-f]{40}$/);
  git(dir, 'update-index', '--assume-unchanged', 'tracked.txt');
  assert.equal(snapshotTree(dir), plain);
  git(dir, 'update-index', '--no-assume-unchanged', 'tracked.txt');
  git(dir, 'update-index', '--skip-worktree', 'tracked.txt');
  assert.equal(snapshotTree(dir), plain);
  assert.match(git(dir, 'ls-files', '-v', 'tracked.txt'), /^S tracked\.txt$/);
});

test('a cleanup that throws still returns the tree, never the throw', () => {
  const dir = repo();
  write(dir, 'tracked.txt', 'edited\n');
  const seen = [];
  const removeFile = (f) => {
    seen.push(f);
    throw Object.assign(new Error(`EACCES: permission denied, unlink '${f}'`), { code: 'EACCES' });
  };
  let tree;
  try {
    tree = snapshotTree(dir, { removeFile });
  } finally {
    for (const f of seen) fs.rmSync(f, { force: true });
  }
  assert.equal(seen.length, 1, 'the cleanup was not called through the seam');
  assert.equal(inTree(dir, tree, 'tracked.txt'), 'edited\n');
  // A failure before the cleanup and a throwing cleanup together are still null, not a throw.
  assert.equal(snapshotTree(path.join(dir, 'missing'), { removeFile }), null);
});

test('baseTreeOf: the merge-base form, the plain form, a tree id, and a bad rev is null', () => {
  const dir = repo();
  const forkPoint = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'feature');
  write(dir, 'tracked.txt', 'feature\n');
  git(dir, 'commit', '-q', '-am', 'feature');
  git(dir, 'checkout', '-q', 'main');
  write(dir, 'tracked.txt', 'mainline moved on\n');
  git(dir, 'commit', '-q', '-am', 'main');
  git(dir, 'checkout', '-q', 'feature');
  const forkTree = git(dir, 'rev-parse', `${forkPoint}^{tree}`);
  const mainTree = git(dir, 'rev-parse', 'main^{tree}');
  assert.notEqual(forkTree, mainTree);
  assert.equal(baseTreeOf(dir, 'main', { mergeBase: true }), forkTree);
  assert.equal(baseTreeOf(dir, 'main'), mainTree);
  assert.equal(baseTreeOf(dir, mainTree), mainTree);
  for (const bad of ['no-such-ref', '--help', '', null, undefined])
    assert.equal(baseTreeOf(dir, bad), null, String(bad));
  assert.equal(baseTreeOf(dir, 'no-such-ref', { mergeBase: true }), null);
  assert.equal(baseTreeOf(tmpDir('snapshot-tree-none-'), 'HEAD'), null);
});

test('an ignored file is not in the tree; a clean tree snapshots to HEAD\'s tree', () => {
  const dir = repo();
  assert.equal(snapshotTree(dir), git(dir, 'rev-parse', 'HEAD^{tree}'));
  write(dir, 'ignored.log', 'noise\n');
  write(dir, 'build/out.js', 'x\n');
  const tree = snapshotTree(dir);
  assert.equal(tree, git(dir, 'rev-parse', 'HEAD^{tree}'));
  assert.equal(inTree(dir, tree, 'ignored.log'), null);
  assert.equal(inTree(dir, tree, 'build/out.js'), null);
});

test('the real index, the status and HEAD are the same before and after', () => {
  const dir = repo();
  write(dir, 'tracked.txt', 'staged\n');
  git(dir, 'add', 'tracked.txt');
  write(dir, 'tracked.txt', 'staged then edited\n');
  write(dir, 'untracked.txt', 'u\n');
  const state = () => ({
    cached: git(dir, 'diff', '--cached', '--name-only'),
    status: git(dir, 'status', '--porcelain'),
    head: git(dir, 'rev-parse', 'HEAD'),
    refs: git(dir, 'for-each-ref'),
    index: fs.readFileSync(path.join(dir, '.git', 'index')).toString('hex'),
    work: fs.readFileSync(path.join(dir, 'tracked.txt'), 'utf8'),
  });
  const before = state();
  assert.ok(snapshotTree(dir));
  assert.deepEqual(state(), before);
  assert.equal(before.cached, 'tracked.txt');
  assert.match(before.status, /\?\? untracked\.txt/);
});

test('it leaves no temp index behind', () => {
  const dir = repo();
  const list = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`snapshot-tree-${process.pid}-`));
  const before = list();
  assert.ok(snapshotTree(dir));
  assert.deepEqual(list(), before);
});

test('it works in a linked worktree and sees that worktree\'s files, not the main checkout\'s', () => {
  const main = repo();
  const linked = path.join(tmpDir('snapshot-tree-wt-'), 'linked');
  git(main, 'worktree', 'add', '-q', '-b', 'side', linked);
  write(linked, 'tracked.txt', 'linked\n');
  write(main, '.gitignore', 'main\n');
  const tree = snapshotTree(linked);
  assert.match(tree, /^[0-9a-f]{40}$/);
  assert.equal(inTree(main, tree, 'tracked.txt'), 'linked\n');
  assert.equal(inTree(main, tree, '.gitignore'), 'ignored.log\nbuild/\n');
  assert.equal(git(linked, 'status', '--porcelain'), 'M tracked.txt');
  assert.equal(currentBranch(linked), 'side');
});

test('it returns null outside a git repository, for both functions', () => {
  const dir = tmpDir('snapshot-tree-none-');
  assert.equal(snapshotTree(dir), null);
  assert.equal(currentBranch(dir), null);
  assert.equal(snapshotTree(path.join(dir, 'missing')), null);
});

test('a decoy GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE in the environment do not redirect it', () => {
  const dir = repo();
  const decoy = repo();
  write(decoy, 'tracked.txt', 'decoy\n');
  write(dir, 'tracked.txt', 'real\n');
  const saved = {};
  const decoyEnv = {
    GIT_DIR: path.join(decoy, '.git'),
    GIT_WORK_TREE: decoy,
    GIT_INDEX_FILE: path.join(decoy, '.git', 'index'),
  };
  for (const k of Object.keys(decoyEnv)) saved[k] = process.env[k];
  Object.assign(process.env, decoyEnv);
  const decoyBefore = fs.readFileSync(path.join(decoy, '.git', 'index')).toString('hex');
  let tree;
  let branch;
  try {
    tree = snapshotTree(dir);
    branch = currentBranch(dir);
  } finally {
    for (const k of Object.keys(decoyEnv)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  assert.equal(inTree(dir, tree, 'tracked.txt'), 'real\n');
  assert.equal(branch, 'main');
  assert.equal(fs.readFileSync(path.join(decoy, '.git', 'index')).toString('hex'), decoyBefore);
});

test('currentBranch names the branch and is null when HEAD is detached', () => {
  const dir = repo();
  assert.equal(currentBranch(dir), 'main');
  git(dir, 'checkout', '-q', '-b', 'feature/x');
  assert.equal(currentBranch(dir), 'feature/x');
  git(dir, 'checkout', '-q', '--detach');
  assert.equal(currentBranch(dir), null);
});

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** Sleep until the next whole second of the wall clock has begun. */
const untilNextSecond = () => sleep(1000 - (Date.now() % 1000) + 20);

test('a same-size edit made in the second of the last index write is in the tree', () => {
  const dir = tmpDir('snapshot-tree-racy-');
  git(dir, 'init', '-q', '-b', 'main');
  untilNextSecond();
  write(dir, 'pay.txt', 'fee = 1;\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  write(dir, 'pay.txt', 'fee = 2;\n'); // same size, same second as the index write above
  untilNextSecond();
  // A copy of the index with a fresh mtime would make that entry look clean to git.
  const tree = snapshotTree(dir);
  assert.equal(inTree(dir, tree, 'pay.txt'), 'fee = 2;\n');
});
