'use strict';

const { spawnSync } = require('child_process');

const REPO_ROOT = require('path').resolve(__dirname, '..', '..', '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    input: options.input,
    env: options.env || process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${detail}`);
  }
  return result;
}

function git(args, options = {}) {
  return run('git', args, options).stdout;
}

function gitLines(args, options = {}) {
  return git(args, options).split('\n').filter(Boolean);
}

/** Tracked files in the index (working tree) or at a ref. */
function listFiles(ref) {
  if (ref) return gitLines(['ls-tree', '-r', '--name-only', ref]);
  return gitLines(['ls-files']);
}

/** Remove tracked paths from index and working tree, in chunks. */
function removePaths(paths) {
  const unique = [...new Set(paths)];
  for (let i = 0; i < unique.length; i += 500) {
    run('git', ['rm', '-r', '-q', '-f', '--ignore-unmatch', '--', ...unique.slice(i, i + 500)]);
  }
  return unique.length;
}

/** Restore paths from a ref into index and working tree. */
function checkoutPaths(ref, paths) {
  const unique = [...new Set(paths)];
  for (let i = 0; i < unique.length; i += 500) {
    run('git', ['checkout', ref, '--', ...unique.slice(i, i + 500)]);
  }
  return unique.length;
}

/**
 * Existence check against git-tracked paths (a file, or a directory with tracked files).
 * Untracked leftovers on disk (ignored node_modules, emptied dirs) do not count.
 */
function createTrackedExists() {
  const files = listFiles();
  const tracked = new Set(files);
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  return p => {
    const target = String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    return tracked.has(target) || dirs.has(target);
  };
}

/** Stage additions, modifications and deletions for the given paths (missing paths are skipped). */
function stagePaths(paths) {
  const fs = require('fs');
  const pathModule = require('path');
  const tracked = new Set(listFiles());
  const unique = [...new Set(paths)].filter(p => fs.existsSync(pathModule.join(REPO_ROOT, p)) || tracked.has(p));
  for (let i = 0; i < unique.length; i += 500) {
    run('git', ['add', '-A', '--', ...unique.slice(i, i + 500)]);
  }
  return unique.length;
}

/** Commit sha for a ref (peels annotated tags). */
function revParse(ref) {
  return git(['rev-parse', `${ref}^{commit}`]).trim();
}

function isAncestor(ancestor, descendant) {
  const result = run('git', ['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`git merge-base --is-ancestor ${ancestor} ${descendant} failed: ${(result.stderr || '').trim()}`);
}

function mergeHead() {
  const result = run('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

module.exports = {
  REPO_ROOT,
  run,
  git,
  gitLines,
  listFiles,
  removePaths,
  checkoutPaths,
  stagePaths,
  createTrackedExists,
  revParse,
  isAncestor,
  mergeHead,
};
