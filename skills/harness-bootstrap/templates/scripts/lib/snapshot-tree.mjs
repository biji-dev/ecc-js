// harness-bootstrap snapshot-tree (generated YYYY-MM-DD). [M] mechanism (ships as-is).
/**
 * The git tree id of a working tree's tracked files as they are on disk right now (deletions
 * included), the tree a review diffed from, and the branch checked out there. Untracked files are
 * left out: no reviewer's diff shows them, so they are not reviewed content. An assume-unchanged or
 * skip-worktree flag hides a file's edit from `git diff`, so from every reviewer's diff (claude-run's
 * and `codex review --base` alike): with any flagged entry the tree is built twice in the copy, once
 * with the flags honoured (what the diff shows) and once with them cleared (what is on disk), and an
 * edit the flags hide, where the two differ, gives no tree. A sparse checkout therefore gets no tree:
 * its skip-worktree files are absent on disk. With no flagged entry the tree is built once.
 * codex-run and claude-run write these into the ledger row of every review they dispatch. The landing
 * check (`review-gate.mjs --landing`) follows each critical file from the mainline through the
 * reviewed `baseTree -> tree` changes, so content no review read cannot reach the mainline. Since
 * that check counts an adversarial pass with a base as a read of its whole range, `rangeText` lists
 * the range's files for both wrappers to append to that pass's prompt.
 *
 * The tree is built in a throwaway copy of the index (`GIT_INDEX_FILE`): the real index, the working
 * tree, HEAD and every ref are never touched. No function here throws; a failure returns `null`.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TREE_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// A snapshot of a very large tree can take a while; a hung git must not hold a dispatch forever.
const TIMEOUT_MS = 120_000;

/** Run git in `cwd` with no inherited GIT_* variable, so a hook's GIT_DIR cannot redirect it. */
function git(args, cwd, extraEnv = {}, input = undefined) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') && k !== 'GIT_OPTIONAL_LOCKS') delete env[k];
  return execFileSync('git', args, {
    cwd,
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
    timeout: TIMEOUT_MS,
  });
}

const removeTemp = (file) => fs.rmSync(file, { force: true });

/**
 * The tree id of the tracked files in `cwd` (a hex string), or null when it cannot be built.
 * `removeFile` is the temp index's cleanup, a seam for the tests; its failure never escapes.
 */
export function snapshotTree(cwd, { removeFile = removeTemp } = {}) {
  let temp = null;
  try {
    const real = path.resolve(cwd, git(['rev-parse', '--git-path', 'index'], cwd).trim());
    temp = path.join(os.tmpdir(), `snapshot-tree-${process.pid}-${crypto.randomBytes(6).toString('hex')}.index`);
    // No index yet (a fresh clone mid-checkout): git starts from an empty one at a missing path.
    if (fs.existsSync(real)) {
      // The copy's mtime is now; git re-reads an entry's content only when it is not older than the
      // index file, so a fresh mtime would hide a same-size edit made in the second of the last write.
      // Stat before the copy: a write in between leaves the stamp older than the content, never newer.
      const st = fs.statSync(real);
      fs.copyFileSync(real, temp);
      fs.utimesSync(temp, st.atime, st.mtime);
    }
    const env = { GIT_INDEX_FILE: temp };
    // Tracked files only (`-u`): an untracked file is in no reviewer's diff.
    const build = () => {
      git(['add', '-u'], cwd, env);
      const id = git(['write-tree'], cwd, env).trim();
      return TREE_ID.test(id) ? id : null;
    };
    // git never re-reads an entry flagged assume-unchanged (a lowercase tag) or skip-worktree (`S`,
    // or `s` with both), and neither does `git diff`, so the reviewer never saw an edit under a flag.
    const entries = git(['ls-files', '-v', '-z'], cwd, env).split('\0');
    const flagged = (tag) => entries.filter((e) => e[1] === ' ' && tag.test(e[0])).map((e) => e.slice(2));
    const assumed = flagged(/[a-z]/);
    const skipped = flagged(/[Ss]/);
    const honoured = build();
    if (assumed.length === 0 && skipped.length === 0) return honoured;
    // Clear both in the copy only (one call per flag: update-index applies only the first such flag
    // it is given) and build again from disk: a difference is an edit no reviewer's diff showed.
    for (const [flag, paths] of [['--no-assume-unchanged', assumed], ['--no-skip-worktree', skipped]])
      if (paths.length) git(['update-index', flag, '-z', '--stdin'], cwd, env, `${paths.join('\0')}\0`);
    const onDisk = build();
    return honoured !== null && onDisk === honoured ? onDisk : null;
  } catch {
    return null;
  } finally {
    try {
      if (temp) removeFile(temp);
    } catch {
      // A temp file left behind is harmless; a throw here would break the never-throws contract.
    }
  }
}

/**
 * The tree a review diffed from, as a hex tree id, or null when git cannot resolve it. With
 * `mergeBase`, the tree of `git merge-base HEAD <rev>` (what `codex review --base` and
 * `git diff --merge-base` diff from); otherwise `<rev>` itself, a commit or a tree. Never throws.
 */
export function baseTreeOf(cwd, rev, { mergeBase = false } = {}) {
  try {
    if (typeof rev !== 'string' || !rev || rev.startsWith('-')) return null;
    const from = mergeBase ? git(['merge-base', '--end-of-options', 'HEAD', rev], cwd).split('\n')[0].trim() : rev;
    if (!from) return null;
    const id = git(['rev-parse', '--verify', '--end-of-options', `${from}^{tree}`], cwd).trim();
    return TREE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The branch checked out in `cwd`, or null when HEAD is detached or git fails. */
export function currentBranch(cwd) {
  try {
    return git(['branch', '--show-current'], cwd).trim() || null;
  } catch {
    return null;
  }
}

// ---- the range a landing pass is recorded as reading -------------------------------------------

/** At most this many paths go into a range block; the rest are counted, with the command that lists them. */
export const RANGE_MAX = 200;

/**
 * The prompt block for an adversarial pass with a base: the landing check (review-gate.mjs --landing)
 * counts such a row as a review of every change from `from` to the working tree, whatever its brief
 * narrowed, so the pass is told the range and asked to read each changed file. '' for no file.
 */
export function rangeBlock(files, from, max = RANGE_MAX) {
  const list = files.filter(Boolean);
  if (list.length === 0) return '';
  const shown = list.slice(0, max).map((f) => `- ${f}`);
  if (list.length > max) shown.push(`- and ${list.length - max} more: \`git diff --name-only ${from}\``);
  return (
    '\n\n## The range this pass is recorded as reading\n\n' +
    `The harness's landing check counts this pass as a review of every change from tree ${from} to the ` +
    `working tree (\`git diff ${from}\`). Read each changed file below in that diff, whatever the brief ` +
    'above narrows, and report on any of them that holds a finding:\n\n' +
    `${shown.join('\n')}\n`
  );
}

/** The range block for the paths that differ between trees `from` and `to`, or '' when git fails. */
export function rangeText(cwd, from, to) {
  try {
    if (!TREE_ID.test(from ?? '') || !TREE_ID.test(to ?? '')) return '';
    return rangeBlock(git(['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', from, to, '--'], cwd).split('\n'), from);
  } catch {
    return '';
  }
}
