#!/usr/bin/env node
// harness-bootstrap review-gate (generated YYYY-MM-DD). Which review is this diff owed?
// [M] mechanism (ships as-is): this whole file; the bindings [B] live at the top of
// scripts/lib/review-gate-core.mjs (CRITICAL, NON_PRODUCTION, TESTS, INSTRUCTIONS, TRIGGERS, FIX_LINES, GUARDS).
/**
 * Decides from facts (paths, production lines, what a fix round fixed) which reviewers a diff is
 * owed, so the main thread does not guess: nothing, the second model family, one Opus
 * code-reviewer over the whole unit, or an adversarial pass. The rules are in the core's header.
 *
 *   node scripts/review-gate.mjs --base <sha> --kind slice|unit|fix --writer main|bounded|second|mixed
 *        [--host claude|codex|zcode|kimi] [--head <ref>] [--tier small|full|harness] [--max-fixed P0|P1|P2|P3]
 *        [--round N] [--stakes none|live] [--json]
 *   node scripts/review-gate.mjs --landing <result> --base <mainline-commit> [--trust <commit>]... [--json]
 *
 *   --kind slice   after a slice passes its gate, before the next builds on it
 *   --kind unit    step 8, once, over the whole unit diff from the merge base
 *   --kind fix     once per fix round, over <sha-before-the-fixes>.. (pass the whole round once,
 *                  after its last fix group); --max-fixed is the highest severity it fixed (required),
 *                  --round counts fix rounds on this area (1, 2, 3 ...)
 *   --writer       REQUIRED, never assumed: the ROLE that wrote the diff (for --kind fix: the fix),
 *                  on this host (harness-bootstrap's reference/gate-design.md › Model and effort):
 *                  main = the judgment model (Opus
 *                  on Claude Code) | bounded = the bounded model (Sonnet) | second = the second
 *                  family | mixed = several executors, the second family among them (routes like
 *                  second); main and bounded together are bounded. On Claude Code
 *                  claude|sonnet|codex name the same roles; on another host they are a usage
 *                  error. Code is never reviewed only by the family that wrote it, and critical
 *                  code written by anyone but main gets a main reviewer
 *   --host         the host whose roles --writer names. Default: harness-host's detection
 *                  (HARNESS_HOST, then each host's own variables); unknown reads like Claude Code
 *   --head <ref>   limit the diff to the committed range base..ref. Default: the WORKING TREE
 *                  against <base> (committed, staged, unstaged and untracked changes; a review is
 *                  often owed before the commit; a binary file counts 0 lines but is a changed file)
 *   --stakes       what a wrong answer costs: none (no production users) or live. Default: the
 *                  `Stakes:` line's `production:` value in AGENTS.md as committed at --base, so a
 *                  branch cannot lower its own review; unbound or ambiguous routes as live and says so
 *   --landing <result>  the landing check, before a merge onto the mainline: <result> is the tree
 *                  the merge writes (a `git write-tree` id, a commit or a branch). Each critical path
 *                  that differs from --base must be content the other family's reviews read: its
 *                  blob in <result> follows from its blob at --base (or at a --trust commit, content
 *                  the remote mainline already holds) through the `baseTree -> tree` changes their
 *                  ledger rows recorded. A changed guard, gate or reviewed harness block is the
 *                  owner's to merge. It takes only --base, --trust and --json; a decision option
 *                  beside it is a usage error
 *
 * Prints exactly one line (`--json`: the result object, with `host` and `role` -- the --writer given):
 *   review-gate: <decision> — <reason> → <reviewers joined by ' + ' or 'none'> [<n> production files, <n> lines; stakes <none|live>; not checked: ...]
 * With --landing (`--json`: { verdict, result, base, trust, changed, guards, critical, unreached, from, rows, host, reason }):
 *   Landing: <result 12-hex> <PASS|RE-REVIEW|NONE> — <reason>
 *
 * exit, a decision: 0 for ANY decision (a decision is not an error) | 2 on a usage error or a git
 * failure (message on stderr). `--help` or `-h`, as an option of its own, prints the usage and exits 0.
 * exit, --landing: 0 PASS | 1 RE-REVIEW or NONE | 2 on a usage error or a git failure.
 * Read-only in both modes: it never writes into the repository.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { join, posix } from 'node:path';
import { detectHost } from './lib/harness-host-core.mjs';
import {
  blocksDiffer,
  decide,
  formatLanding,
  formatLine,
  holdsBlocks,
  isGuard,
  isLandingCritical,
  landing,
  parseArgs,
  parseNumstat,
  qualifyingRows,
  readStakes,
  writerRole,
} from './lib/review-gate-core.mjs';
import { CLAUDE_LEDGER_DIR, LEDGER_DIR, defaultLedger } from './lib/run-sources.mjs';

const USAGE = [
  'usage: review-gate.mjs --base <sha> --kind slice|unit|fix --writer main|bounded|second|mixed (on Claude Code also claude|sonnet|codex) [--host claude|codex|zcode|kimi] [--head <ref>] [--tier small|full|harness] [--max-fixed P0|P1|P2|P3] [--round N] [--stakes none|live] [--json]',
  '       review-gate.mjs --landing <result> --base <mainline-commit> [--trust <commit>]... [--json]',
].join('\n');

function fail(msg, withUsage) {
  process.stderr.write(`review-gate: ${msg}\n${withUsage ? `${USAGE}\n` : ''}`);
  process.exit(2);
}

const MAX_BUFFER = 64 * 1024 * 1024;
const git = (cwd, ...a) =>
  execFileSync('git', ['-c', 'core.quotepath=false', ...a], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: os.devNull },
  });

const gitFailure = (e) => `git failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`;

// Options are parsed before anything else, so `--help` is help only as an option of its own:
// `--landing --help` is a usage error, never the usage text and exit 0.
let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  fail(e.message, true);
}
if (args.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

/** Throws unless `rev` names a commit (a file name would otherwise become a path filter). */
function commitOf(top, rev) {
  try {
    return git(top, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`).trim();
  } catch {
    throw new Error(`${rev} is not a commit`);
  }
}

/** The tree `rev` peels to: a tree id, a commit or a branch. */
function treeOf(top, rev) {
  try {
    return git(top, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{tree}`).trim();
  } catch {
    throw new Error(`${rev} does not name a tree`);
  }
}

/** The rows of one ledger, each tagged with its ledger and family; an unreadable ledger or a bad line is skipped. */
function ledgerRows(file, family) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') rows.push({ ...row, ledger: file, family });
    } catch {
      // a torn or foreign line: not a review
    }
  }
  return rows;
}

/**
 * Looks up every `<treeish>:<path>` or object name in `lines` through ONE `git cat-file
 * --batch-check` child and returns one answer per line, in order: { oid, type }, or { missing }.
 * A missing answer is an absent file; an answer of any other shape never equals another node.
 */
function batchCheck(top, lines) {
  if (lines.length === 0) return [];
  const out = execFileSync('git', ['cat-file', '--batch-check'], {
    cwd: top,
    encoding: 'utf8',
    input: `${lines.join('\n')}\n`,
    maxBuffer: MAX_BUFFER,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: os.devNull },
  });
  const answers = out.split('\n');
  if (answers.at(-1) === '') answers.pop();
  if (answers.length !== lines.length) throw new Error(`git cat-file --batch-check answered ${answers.length} of ${lines.length} lookups`);
  return answers.map((a, i) => {
    const m = /^([0-9a-f]{40,64}) (\S+) \d+$/.exec(a);
    if (m) return { oid: m[1], type: m[2] };
    return a.endsWith(' missing') ? { missing: true } : { odd: `?${i}` };
  });
}

// the instruction files whose harness blocks are a guard, read through a symlink when one is
const LINKED_FILES = ['AGENTS.md', 'CLAUDE.md'];
const isLink = (e) => e?.mode === '120000';
const isRegular = (e) => e?.mode === '100644' || e?.mode === '100755';

/** `git ls-tree -z <treeish> -- <paths>` → Map path → { mode, type, oid }, exact names only. */
function entriesAt(top, treeish, paths) {
  const out = git(top, '--literal-pathspecs', 'ls-tree', '-z', treeish, '--', ...paths);
  const map = new Map();
  for (const rec of out.split('\0')) {
    const m = /^(\d{6}) (\S+) ([0-9a-f]{40,64})\t([\s\S]*)$/.exec(rec);
    if (m && paths.includes(m[4])) map.set(m[4], { mode: m[1], type: m[2], oid: m[3] });
  }
  return map;
}

/**
 * The text an instruction file's entry stands for at `treeish`: null when absent, a regular file's
 * own text, or a symlink's target read through ONE link -- the link text normalised from the
 * repository root, naming a regular file inside the tree. undefined when it cannot be read so.
 */
function linkedText(top, treeish, entry) {
  const blob = (oid) => git(top, 'cat-file', 'blob', oid);
  if (!entry) return null;
  if (isRegular(entry)) return blob(entry.oid);
  if (!isLink(entry)) return undefined;
  const text = blob(entry.oid);
  if (text.startsWith('/') || /[\n\0]/.test(text)) return undefined;
  const target = posix.normalize(text);
  if (target === '.' || target === '..' || target.startsWith('../') || target.startsWith('/')) return undefined;
  const at = entriesAt(top, treeish, [target]).get(target);
  return isRegular(at) ? blob(at.oid) : undefined;
}

/**
 * For AGENTS.md and CLAUDE.md with a symlink on either side: whether their harness blocks changed,
 * read through the link (true | false), or undefined (a guard change: a type change, a link to a
 * link, out of the tree or to nothing). A file regular or absent on both sides is not in the map.
 */
function linkedBlocks(top, base, result) {
  const before = entriesAt(top, base, LINKED_FILES);
  const after = entriesAt(top, result, LINKED_FILES);
  const out = new Map();
  for (const f of LINKED_FILES) {
    const b = before.get(f);
    const t = after.get(f);
    if (!isLink(b) && !isLink(t)) continue;
    if ((isRegular(b) && isLink(t)) || (isLink(b) && isRegular(t))) {
      out.set(f, undefined);
      continue;
    }
    const [x, y] = [linkedText(top, base, b), linkedText(top, result, t)];
    out.set(f, x === undefined || y === undefined ? undefined : blocksDiffer(x, y));
  }
  return out;
}

/** The landing check (C8.3): prints its line and exits 0 PASS, 1 RE-REVIEW or NONE. */
function runLanding() {
  let host;
  try {
    // the host's own variables first: an agent's HARNESS_HOST=zcode on the line would otherwise make
    // its own family's ledger count; the owner's word decides only where no host names itself
    const own = { ...process.env };
    delete own.HARNESS_HOST;
    host = detectHost(own).host;
    if (host === 'unknown') host = detectHost(process.env).host;
  } catch (e) {
    fail(e.message, true);
  }
  let r;
  try {
    const top = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
    const base = commitOf(top, args.base);
    const result = treeOf(top, args.landing);
    const trust = (args.trust ?? []).map((t) => commitOf(top, t));
    const changed = git(top, 'diff', '--name-only', '-z', '--no-renames', base, result, '--').split('\0').filter(Boolean);
    // an instruction file that is a symlink: its blocks are read through the link, and a change of
    // them counts even when the link entry itself did not change
    const linked = linkedBlocks(top, base, result);
    for (const [f, differ] of linked) if (differ !== false && !changed.includes(f)) changed.push(f);
    // both ledgers live in the main checkout, so a review run from a worktree counts here too
    const candidates = qualifyingRows(
      [...ledgerRows(defaultLedger(top, LEDGER_DIR), 'codex'), ...ledgerRows(defaultLedger(top, CLAUDE_LEDGER_DIR), 'claude')],
      host,
    );
    // a path holding a newline cannot be one batch line: it gets no facts, so it stays unreached
    const blockFiles = changed.filter((p) => isGuard(p) && holdsBlocks(p) && !linked.has(p) && !p.includes('\n'));
    const critical = changed.filter((p) => isLandingCritical(p) && !p.includes('\n'));

    // one batch: each row's two trees (a ledger's ids are data: only hex ids reach git, and
    // qualifyingRows let only those through), then each lookup the verdict needs
    const lines = [];
    const ask = (line) => lines.push(line) - 1;
    const rowTrees = candidates.map((row) => [ask(row.baseTree), ask(row.tree)]);
    const blockAt = blockFiles.map((p) => [ask(`${base}:${p}`), ask(`${result}:${p}`)]);
    const pathAt = critical.map((p) => ({
      starts: [base, ...trust].map((c) => ask(`${c}:${p}`)),
      result: ask(`${result}:${p}`),
      rows: candidates.map((row) => [ask(`${row.baseTree}:${p}`), ask(`${row.tree}:${p}`)]),
    }));
    const answers = batchCheck(top, lines);
    const node = (i) => answers[i].oid ?? (answers[i].missing ? 'absent' : answers[i].odd);

    // a row whose trees git no longer has (pruned, or never in this repository) proves nothing
    const readable = candidates.map((_, k) => rowTrees[k].every((i) => answers[i].type === 'tree'));
    const rows = candidates.filter((_, k) => readable[k]);

    const blockChanged = {};
    for (const [f, differ] of linked) if (differ !== undefined) blockChanged[f] = differ;
    blockFiles.forEach((p, k) => {
      const [b, t] = blockAt[k].map((i) => answers[i]);
      // a side that is no blob is not compared, so the guard counts as changed
      if ((b.type !== 'blob' && !b.missing) || (t.type !== 'blob' && !t.missing)) return;
      const text = (a) => (a.missing ? null : git(top, 'cat-file', 'blob', a.oid));
      blockChanged[p] = blocksDiffer(text(b), text(t));
    });

    const paths = {};
    critical.forEach((p, k) => {
      const at = pathAt[k];
      paths[p] = {
        starts: at.starts.map(node),
        result: node(at.result),
        edges: candidates.flatMap((row, j) => (readable[j] ? [{ from: node(at.rows[j][0]), to: node(at.rows[j][1]), row }] : [])),
      };
    });
    r = landing({ result, base, trust, changed, blockChanged, rows, paths, host });
  } catch (e) {
    fail(gitFailure(e), false);
  }
  console.log(args.json ? JSON.stringify(r, null, 2) : formatLanding(r));
  // exitCode, not exit(): stdout to a pipe can still be draining
  process.exitCode = r.verdict === 'PASS' ? 0 : 1;
}

/** The review decision: which reviewers the diff is owed. */
function runDecision() {
  // The host decides what a --writer name means; a bad HARNESS_HOST is a usage error, not a guess.
  let host;
  try {
    host = args.host ?? detectHost(process.env).host;
  } catch (e) {
    fail(e.message, true);
  }

  let files;
  let stakes = args.stakes ?? null;
  try {
    const top = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
    const base = commitOf(top, args.base);
    // the stakes as the mainline holds them: a branch that edits its own Stakes line cannot lower
    // the review that branch is owed
    if (args.stakes === undefined) {
      try {
        stakes = readStakes(git(top, 'show', `${base}:AGENTS.md`));
      } catch {
        stakes = null; // no AGENTS.md at the base: unbound, routed as live
      }
    }
    if (args.head) {
      const head = commitOf(top, args.head);
      files = parseNumstat(git(top, 'diff', '--numstat', '-z', '--no-renames', `${base}..${head}`, '--'));
    } else {
      files = parseNumstat(git(top, 'diff', '--numstat', '-z', '--no-renames', base, '--'));
      // Untracked files count by lines (binary = 0), every line an addition: `git diff` does not list them.
      for (const path of git(top, 'ls-files', '-z', '--others', '--exclude-standard')
        .split('\0')
        .filter(Boolean)) {
        let lines = 0;
        let binary = false;
        try {
          const buf = readFileSync(join(top, path));
          binary = buf.includes(0);
          if (!binary) lines = buf.toString('utf8').split('\n').length - (buf.at(-1) === 10 ? 1 : 0);
        } catch {
          // unreadable (a broken symlink): counts 0 lines
        }
        files.push({ path, lines, added: lines, deleted: 0, binary });
      }
    }
  } catch (e) {
    fail(gitFailure(e), false);
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
      stakes,
    });
  } catch (e) {
    fail(e.message, true);
  }

  console.log(args.json ? JSON.stringify({ ...result, host, role: args.writer }, null, 2) : formatLine(result));
}

if (args.landing !== undefined) runLanding();
else runDecision();
