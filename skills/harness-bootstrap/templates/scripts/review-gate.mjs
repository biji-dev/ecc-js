#!/usr/bin/env node
// harness-bootstrap review-gate (generated YYYY-MM-DD). Which review is this diff owed?
// [M] mechanism (ships as-is): this whole file; the bindings [B] live at the top of
// scripts/lib/review-gate-core.mjs (CRITICAL, NON_PRODUCTION, TESTS, INSTRUCTIONS, TRIGGERS, FIX_LINES).
/**
 * Decides from facts (paths, production lines, what a fix round fixed) which reviewers a diff is
 * owed, so the main thread does not guess: nothing, the second model family, one Opus
 * code-reviewer over the whole unit, or an adversarial pass. The rules are in the core's header.
 *
 *   node scripts/review-gate.mjs --base <sha> --kind slice|unit|fix --writer main|bounded|second|mixed
 *        [--host claude|codex|zcode|kimi] [--head <ref>] [--tier small|full] [--max-fixed P0|P1|P2|P3]
 *        [--round N] [--json]
 *
 *   --kind slice   after a slice passes its gate, before the next builds on it
 *   --kind unit    step 8, once, over the whole unit diff from the merge base
 *   --kind fix     once per fix round, over <sha-before-the-fixes>.. (pass the whole round once,
 *                  after its last fix group); --max-fixed is the highest severity it fixed (required),
 *                  --round counts fix rounds on this area (1, 2, 3 ...)
 *   --writer       REQUIRED, never assumed: the ROLE that wrote the diff (for --kind fix: the fix),
 *                  on this host (gate-design.md › Model and effort): main = the judgment model (Opus
 *                  on Claude Code) | bounded = the bounded model (Sonnet) | second = the second
 *                  family | mixed = several executors (a fix round split between main and second;
 *                  routes like second). On Claude Code claude|sonnet|codex name the same roles; on
 *                  another host they are a usage error. Code is never reviewed only by the family
 *                  that wrote it, and critical code written by anyone but main gets a main reviewer
 *   --host         the host whose roles --writer names. Default: harness-host's detection
 *                  (HARNESS_HOST, then each host's own variables); unknown reads like Claude Code
 *   --head <ref>   limit the diff to the committed range base..ref. Default: the WORKING TREE
 *                  against <base> (committed, staged, unstaged and untracked changes; a review is
 *                  often owed before the commit; a binary file counts 0 lines but is a changed file)
 *
 * Prints exactly one line (`--json`: the result object, with `host` and `role` -- the --writer given):
 *   review-gate: <decision> — <reason> → <reviewers joined by ' + ' or 'none'> [<n> production files, <n> lines; not checked: ...]
 *
 * exit: 0 for ANY decision (a decision is not an error) | 2 on a usage error or a git failure
 * (message on stderr). Read-only: it never writes into the repository.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectHost } from './lib/harness-host-core.mjs';
import { decide, formatLine, parseArgs, parseNumstat, writerRole } from './lib/review-gate-core.mjs';

const USAGE =
  'usage: review-gate.mjs --base <sha> --kind slice|unit|fix --writer main|bounded|second|mixed (on Claude Code also claude|sonnet|codex) [--host claude|codex|zcode|kimi] [--head <ref>] [--tier small|full] [--max-fixed P0|P1|P2|P3] [--round N] [--json]';

function fail(msg, withUsage) {
  process.stderr.write(`review-gate: ${msg}\n${withUsage ? `${USAGE}\n` : ''}`);
  process.exit(2);
}

const git = (cwd, ...a) =>
  execFileSync('git', ['-c', 'core.quotepath=false', ...a], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  fail(e.message, true);
}

// The host decides what a --writer name means; a bad HARNESS_HOST is a usage error, not a guess.
let host;
try {
  host = args.host ?? detectHost(process.env).host;
} catch (e) {
  fail(e.message, true);
}

/** Throws unless `rev` names a commit (a file name would otherwise become a path filter). */
function commitOf(top, rev) {
  try {
    return git(top, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`).trim();
  } catch {
    throw new Error(`${rev} is not a commit`);
  }
}

let files;
try {
  const top = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
  const base = commitOf(top, args.base);
  if (args.head) {
    const head = commitOf(top, args.head);
    files = parseNumstat(git(top, 'diff', '--numstat', '-z', '--no-renames', `${base}..${head}`, '--'));
  } else {
    files = parseNumstat(git(top, 'diff', '--numstat', '-z', '--no-renames', base, '--'));
    // Untracked files count by lines (binary = 0): `git diff` does not list them.
    for (const path of git(top, 'ls-files', '-z', '--others', '--exclude-standard')
      .split('\0')
      .filter(Boolean)) {
      let lines = 0;
      try {
        const buf = readFileSync(join(top, path));
        if (!buf.includes(0))
          lines = buf.toString('utf8').split('\n').length - (buf.at(-1) === 10 ? 1 : 0);
      } catch {
        // unreadable (a broken symlink): counts 0 lines
      }
      files.push({ path, lines });
    }
  }
} catch (e) {
  fail(`git failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`, false);
}

let result;
try {
  result = decide({
    files,
    kind: args.kind,
    tier: args.tier,
    writer: writerRole(args.writer, host),
    maxFixed: args.maxFixed,
    round: args.round,
  });
} catch (e) {
  fail(e.message, true);
}

console.log(args.json ? JSON.stringify({ ...result, host, role: args.writer }, null, 2) : formatLine(result));
