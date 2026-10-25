#!/usr/bin/env node
// harness-bootstrap docs-drift (generated YYYY-MM-DD). Lists the documents that mention what a diff changed.
// [M] mechanism (ships as-is): everything below. [B] binding: the doc tree and identifier filters
// at the top of scripts/lib/docs-drift-core.mjs (DOC_GLOBS, HISTORICAL_GLOBS, EXCLUDE_DIRS, MIN_IDENT, IGNORE_TOKENS, GENERIC).
/**
 * Prints every documentation line that mentions a path, a file name or an exported name the diff
 * since <base> changed (committed, staged, unstaged and untracked work all count), so the doc
 * sweep rewrites only the stale sections instead of re-reading every document.
 *
 *   node scripts/docs-drift.mjs --since <base> [--basenames] [--max <n>] [--include-changed]
 *                               [--strict] [--json]
 *
 * options:
 *   --since <base>       the git revision to diff against (required)
 *   --basenames          also search for each changed file's bare name (noisy: `auth.ts` is in
 *                        every document that discusses any auth.ts; default: full paths only)
 *   --max <n>            print at most n candidate lines (default 200), then `… and <k> more`;
 *                        the summary still counts all of them
 *   --include-changed    also scan documents the diff itself edited (default: they are skipped)
 *   --strict             exit 1 when there is at least one candidate
 *   --json               print { candidates, docs, skipped } instead of text (`docs`: the
 *                        documents that have a candidate)
 *
 * tokens: changed code paths (an edited document is not one; a deleted or renamed-away one is),
 * and exports the diff removed or modified (a new export cannot make a document stale).
 *
 * output: `<doc>:<line> — mentions <token> (changed in <path>)` per candidate, `skipped: <path>
 * (size)` per document over 2 MB, then `docs-drift: <n> candidates in <m> docs`.
 *
 * exit: 0 ok (candidates or not) | 1 --strict and at least one candidate | 2 usage or git failure.
 *
 * Read-only: it runs git and reads files, and never writes into the repository.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  EXIT,
  MAX_DOC_BYTES,
  deletedFromNameStatus,
  findMentions,
  formatReport,
  isExcludedDir,
  isLivingDoc,
  parseArgs,
  tokensFor,
  untrackedDiff,
} from './lib/docs-drift-core.mjs';

const USAGE = 'usage: node scripts/docs-drift.mjs --since <base> [--basenames] [--max <n>] [--include-changed] [--strict] [--json]';

function usage(msg) {
  process.stderr.write(`docs-drift: ${msg}\n${USAGE}\n`);
  process.exit(EXIT.usage);
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/** Text of an untracked file, or null when it is a symlink, unreadable, huge or binary. */
function readUntracked(top, rel) {
  try {
    const file = path.join(top, rel);
    if (fs.lstatSync(file).isSymbolicLink()) return null;
    const buf = fs.readFileSync(file);
    if (buf.length > MAX_DOC_BYTES || buf.subarray(0, 8000).includes(0)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

/** Every living document under `top` (DOC_GLOBS, minus HISTORICAL_GLOBS), as { path, text } plus the ones too big to read. */
function collectDocs(top) {
  const docs = [];
  const skipped = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(top, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(top, child);
      const isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          if (fs.statSync(abs).isDirectory()) continue; // a symlinked dir is never walked
          isFile = true;
        } catch {
          continue; // dangling link
        }
      }
      if (isDir) {
        if (!isExcludedDir(child)) walk(child);
      } else if (isFile && isLivingDoc(child)) {
        try {
          if (fs.statSync(abs).size > MAX_DOC_BYTES) skipped.push({ path: child, reason: 'size' });
          else docs.push({ path: child, text: fs.readFileSync(abs, 'utf8') });
        } catch {
          /* removed while walking */
        }
      }
    }
  };
  walk('');
  return { docs, skipped };
}

function main() {
  let a;
  try {
    a = parseArgs(process.argv.slice(2));
  } catch (e) {
    usage(e.message);
  }
  if (a.since.startsWith('-')) usage('--since must be a revision, not an option');

  let top;
  let changedPaths;
  let diffText;
  let deletedPaths;
  try {
    top = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
    const tracked = git(['diff', '--name-only', '--no-renames', '-z', a.since, '--'], top);
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], top);
    const names = (z) => z.split('\0').filter(Boolean);
    changedPaths = [...new Set([...names(tracked), ...names(untracked)])];
    deletedPaths = deletedFromNameStatus(
      git(['diff', '--name-status', '--no-renames', '-z', a.since, '--'], top),
    );
    diffText = git(['diff', '--no-renames', a.since, '--'], top);
    for (const rel of names(untracked)) {
      const text = readUntracked(top, rel);
      if (text !== null) diffText += `\n${untrackedDiff(rel, text)}`;
    }
  } catch (e) {
    usage(`git failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }

  const { docs, skipped } = collectDocs(top);
  const tokens = tokensFor({ changedPaths, diffText, deletedPaths, basenames: a.basenames });
  const mentions = findMentions({
    docs,
    tokens,
    changedPaths,
    includeChanged: a.includeChanged,
  });

  if (a.json)
    console.log(
      JSON.stringify(
        { candidates: mentions, docs: [...new Set(mentions.map((m) => m.doc))], skipped },
        null,
        2,
      ),
    );
  else console.log(formatReport(mentions, skipped, a.max));
  return a.strict && mentions.length > 0 ? EXIT.strict : EXIT.ok;
}

try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write(`docs-drift: ${e.stack ?? e}\n`);
  process.exit(EXIT.usage);
}
