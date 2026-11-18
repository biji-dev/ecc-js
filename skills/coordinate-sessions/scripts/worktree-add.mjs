#!/usr/bin/env node
// coordinate-sessions worktree setup. No dependencies, Node 18+.
//
//   node worktree-add.mjs --branch <b> --path <p> --base <ref> [--board <board.md>] [--dry-run]
//     Run from inside the main checkout (or any worktree of it; main is the first working tree
//     `git worktree list` gives, so a repository whose git dir is outside its checkout works when run
//     from the main checkout, and a bare repository is refused before anything is created). Makes one worker's worktree ready
//     to build in, the steps three projects each did by hand:
//       1. git worktree add -b <b> <p> <ref>, under umask 022 (a worktree another user's tool can read)
//       2. every untracked or ignored `.env*` file of the main checkout (not under node_modules or
//          .review-work/) is symlinked to the same place in the worktree, never copied; one that
//          already exists there (a tracked .env.example) is left alone
//       3. COPY (the [B] binding below) is copied in, recursively, never a `.env*` file: what the
//          main checkout has and git does not carry (the plans folder, a red-team certificate an
//          install adds to the list)
//       4. the board's `Setup: <command>` line (a `Key: value` line before the first heading; `-`,
//          `none` or no line = no install) runs with /bin/sh -c in the worktree, its output on stderr
//       5. core.hooksPath is read before the install and put back after it. The config is shared by
//          every worktree, so the value written is absolute and in the main checkout: a relative
//          value resolves against the main checkout, one inside a linked worktree moves to the same
//          place under the main checkout, and a relative value the install left alone is rewritten
//          too; a value git expands itself (`~/...`, `%(prefix)/...`) is left as it is; unset stays
//          unset (and is unset again when the install set it)
//       6. LEFTOVERS (the [B] binding below): untracked files that match are deleted, the probe files
//          a gate killed mid-run leaves behind
//     Prints one line per step:
//       WORKTREE <path> <branch> from <base sha, 12 characters>
//       ENV <n> linked
//       COPY <path>                  one per COPY path the main checkout has
//       SETUP <command> exit <code>  (`exit timeout` when it ran past 15 minutes)
//       HOOKS restored <value>       (the value written; `unset` when it was unset before)
//       LEFTOVER removed <path>
//     and ends with `WORKTREE READY <path>` (exit 0) or `WORKTREE FAILED <step>: <reason>` (exit 1;
//     step is worktree, env, copy, setup, hooks or leftovers; a worktree made before the failure stays,
//     and the line says so). A path that already exists is refused and never touched. Exit 2: usage.
//     --dry-run checks the path and the base, then prints `PLAN <step> ...` lines and
//     `WORKTREE DRY RUN <path>` without changing anything (exit 0).
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// [B] COPY: paths of the main checkout copied (not linked) into each new worktree. Installs add their
// certificates here (a red-team certificate file, for one).
export const COPY = ['.claude/plans'];
// [B] LEFTOVERS: ERE strings; untracked files in the new worktree whose path matches are deleted
// after the install (probe files a killed lint or test gate can leave).
export const LEFTOVERS = [];

const GIT_TIMEOUT_MS = 30000;
const SETUP_TIMEOUT_MS = 15 * 60 * 1000;

function usage(message) {
  process.stderr.write(`worktree-add: ${message}\nusage: node worktree-add.mjs --branch <b> --path <p> --base <ref> [--board <board.md>] [--dry-run]\n`);
  process.exit(2);
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

const zlist = (text) => String(text).split('\0').filter(Boolean);
const say = (line) => process.stdout.write(`${line}\n`);
const firstLine = (error) => String(error?.stderr || error?.message || error).trim().split('\n')[0];

/**
 * The working trees `git worktree list` gives, main one first, and `bare` marks a repository that has no
 * main working tree. It is the one source of "main" in this script. A repository whose git dir is not
 * inside its checkout (--separate-git-dir) lists that git dir, not the checkout, as the main entry.
 */
function worktreeList(cwd) {
  const trees = [];
  for (const l of git(cwd, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (l.startsWith('worktree ')) {
      const p = l.slice('worktree '.length);
      trees.push({ path: existsSync(p) ? realpathSync(p) : p, bare: false });
    } else if (l === 'bare' && trees.length) trees[trees.length - 1].bare = true;
  }
  if (!trees.length) throw new Error('git lists no working tree');
  return trees;
}

const refusal = (message) => Object.assign(new Error(message), { refused: true });

/** The paths of the working trees that are checkouts (a `.git` entry in them), for hooksValue. */
const checkoutPaths = (cwd) => worktreeList(cwd).filter((t) => !t.bare && exists(join(t.path, '.git'))).map((t) => t.path);

/**
 * The main working tree: the first one git lists. A bare repository has none and is refused. When git
 * lists the git dir itself (--separate-git-dir), the main checkout is the current top level if this is
 * it, and otherwise cannot be found from here: run it from the main checkout.
 */
function mainCheckout(cwd) {
  const first = worktreeList(cwd)[0];
  if (first.bare) throw refusal(`${first.path} is a bare repository: it has no main checkout`);
  if (exists(join(first.path, '.git'))) return first.path;
  const gitDir = realpathSync(git(cwd, ['rev-parse', '--absolute-git-dir']).trim());
  if (gitDir === first.path) return realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim());
  throw refusal(`the main checkout of ${first.path} cannot be found from a linked worktree (its git dir is outside it); run this from the main checkout`);
}

/** The board's `Setup:` command, or null: the `Key: value` lines before the first heading. */
export function setupCommand(text) {
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (/^#{2,}\s/.test(line) || line.includes('<!-- board:')) break;
    const kv = /^Setup:\s*(.*)$/i.exec(line);
    if (!kv) continue;
    const value = kv[1].trim().replace(/^`([^`]*)`$/, '$1').trim();
    return /^(?:|-|\u2014|n\/a|none)$/i.test(value) ? null : value;
  }
  return null;
}

/** The untracked or ignored .env* files of a checkout, outside node_modules and .review-work/. */
export function envFiles(main) {
  const pathspec = ['--', ':(glob).env*', ':(glob)**/.env*'];
  const ignored = zlist(git(main, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', ...pathspec]));
  const untracked = zlist(git(main, ['ls-files', '-z', '--others', '--exclude-standard', ...pathspec]));
  return [...new Set([...ignored, ...untracked])]
    .filter((f) => /^\.env/.test(basename(f)) && !f.split('/').includes('node_modules') && !f.startsWith('.review-work/'))
    .sort();
}

const exists = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * A core.hooksPath value as an absolute path in the main checkout: relative values resolve there, and one
 * inside a linked worktree moves to the same place there. A value git expands itself (`~/...` and
 * `%(prefix)/...`) is left as it is.
 */
export function hooksValue(main, value, worktrees) {
  if (value.startsWith('~') || value.startsWith('%(prefix)/')) return value;
  if (!isAbsolute(value)) return resolve(main, value);
  const real = existsSync(value) ? realpathSync(value) : value;
  for (const wt of worktrees) {
    if (wt === main) continue;
    for (const v of [value, real]) if (v === wt || v.startsWith(wt + sep)) return join(main, relative(wt, v));
  }
  return value;
}

const hooksPath = (cwd) => {
  try {
    return git(cwd, ['config', '--local', '--get', 'core.hooksPath']).replace(/\n$/, '');
  } catch {
    return undefined;
  }
};

function run(argv) {
  const opts = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--branch' || a === '--path' || a === '--base' || a === '--board') {
      const v = argv[(i += 1)];
      if (!v || v.startsWith('--')) usage(`${a} takes a value`);
      opts[a.slice(2)] = v;
    } else usage(a === '-h' || a === '--help' ? 'help' : `unexpected argument: ${a}`);
  }
  for (const need of ['branch', 'path', 'base']) if (!opts[need]) usage(`--${need} is required`);
  let setup = null;
  if (opts.board) {
    try {
      setup = setupCommand(readFileSync(resolve(opts.board), 'utf8'));
    } catch (error) {
      usage(`cannot read the board: ${firstLine(error)}`);
    }
  }
  const fail = (step, reason) => {
    say(`WORKTREE FAILED ${step}: ${reason}`);
    return 1;
  };
  let main;
  try {
    main = mainCheckout(process.cwd());
  } catch (error) {
    if (error?.refused) return fail('worktree', firstLine(error));
    usage(`run it inside a git checkout: ${firstLine(error)}`);
  }
  const target = resolve(opts.path);
  if (exists(target)) return fail('worktree', `${target} already exists`);
  let sha;
  try {
    sha = git(main, ['rev-parse', '--verify', '--quiet', `${opts.base}^{commit}`]).trim().slice(0, 12);
  } catch {
    return fail('worktree', `base ${opts.base} is not a commit`);
  }
  let envList;
  try {
    envList = envFiles(main);
  } catch (error) {
    return fail('env', firstLine(error));
  }
  const copies = COPY.filter((c) => exists(join(main, c)));

  if (opts.dryRun) {
    say(`PLAN worktree git worktree add -b ${opts.branch} ${target} ${opts.base} (${sha})`);
    say(`PLAN env ${envList.length} linked${envList.length ? `: ${envList.join(' ')}` : ''}`);
    for (const c of copies) say(`PLAN copy ${c}`);
    say(`PLAN setup ${setup ?? 'none'}`);
    say(`PLAN hooks core.hooksPath restored after the install (now ${hooksPath(main) ?? 'unset'})`);
    say(`PLAN leftovers ${LEFTOVERS.length} patterns`);
    say(`WORKTREE DRY RUN ${target}`);
    return 0;
  }

  process.umask(0o022);
  try {
    git(main, ['worktree', 'add', '-b', opts.branch, target, opts.base]);
  } catch (error) {
    return fail('worktree', firstLine(error));
  }
  say(`WORKTREE ${target} ${opts.branch} from ${sha}`);
  const kept = `; the worktree at ${target} stays`;

  let linked = 0;
  try {
    for (const f of envList) {
      const dest = join(target, f);
      if (exists(dest)) continue;
      mkdirSync(dirname(dest), { recursive: true });
      symlinkSync(join(main, f), dest);
      linked += 1;
    }
  } catch (error) {
    return fail('env', firstLine(error) + kept);
  }
  say(`ENV ${linked} linked`);

  try {
    for (const c of copies) {
      mkdirSync(dirname(join(target, c)), { recursive: true });
      // an env file is linked by the env step, never copied (its destination may already be that link)
      cpSync(join(main, c), join(target, c), { recursive: true, force: false, errorOnExist: false, filter: (src) => !/^\.env/.test(basename(src)) });
      say(`COPY ${c}`);
    }
  } catch (error) {
    return fail('copy', firstLine(error) + kept);
  }

  const before = hooksPath(target);
  let failed = null;
  if (setup) {
    const r = spawnSync('/bin/sh', ['-c', setup], { cwd: target, stdio: ['ignore', 2, 2], timeout: SETUP_TIMEOUT_MS });
    const code = r.error?.code === 'ETIMEDOUT' ? 'timeout' : String(r.status ?? r.signal ?? 'error');
    say(`SETUP ${setup} exit ${code}`);
    if (code !== '0') failed = `exit ${code}`;
  }
  const after = hooksPath(target);
  // The config is shared by every worktree, so the value written back is absolute and in the main
  // checkout: a relative one would follow whichever worktree runs git, and one in the new worktree
  // would leave no hook running once that worktree is deleted.
  if (before !== undefined || after !== undefined) {
    try {
      const want = before === undefined ? undefined : hooksValue(main, before, checkoutPaths(main));
      if (after !== want) {
        if (want === undefined) git(target, ['config', '--local', '--unset', 'core.hooksPath']);
        else git(target, ['config', '--local', 'core.hooksPath', want]);
        say(`HOOKS restored ${want ?? 'unset'}`);
      }
    } catch (error) {
      return fail('hooks', `core.hooksPath could not be restored: ${firstLine(error)}${kept}`);
    }
  }
  if (failed) return fail('setup', failed + kept);

  try {
    if (LEFTOVERS.length) {
      const patterns = LEFTOVERS.map((p) => new RegExp(p));
      for (const f of zlist(git(target, ['ls-files', '-z', '--others', '--exclude-standard']))) {
        if (!patterns.some((re) => re.test(f))) continue;
        rmSync(join(target, f), { recursive: true, force: true });
        say(`LEFTOVER removed ${f}`);
      }
    }
  } catch (error) {
    return fail('leftovers', firstLine(error) + kept);
  }
  say(`WORKTREE READY ${target}`);
  return 0;
}

function isMain() {
  const arg = process.argv[1] ?? '';
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`worktree-add: ${firstLine(error)}\n`);
    process.exitCode = 2;
  }
}
