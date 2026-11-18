#!/usr/bin/env node
// harness-bootstrap deploy-list (generated YYYY-MM-DD). The never-auto lands since what production runs.
// [M] mechanism (ships as-is): everything. The [B] bindings (the trailer keys, the audit ledger kind) live at
// the top of scripts/lib/deploy-list-core.mjs.
/**
 * The owner's checkpoint before a deploy (harness-bootstrap's reference/gate-design.md, The merge policy).
 * A never-auto product category -- money, stored-data formats, dependency changes, shared contracts and
 * schemas, migrations -- merges on a green gate and a cross-family review, and its land commit carries a
 * `Never-auto: <category>` trailer (unit-record.mjs --trailer). The owner reads that code once per deploy,
 * not once per merge: this lists every such land since what production runs, and the files to give one
 * adversarial pass over the combined diff.
 *
 *   node scripts/deploy-list.mjs <live-sha> [<sha>]
 *
 *   <live-sha>   the commit production runs; `-` (or an empty argument) means nothing is live yet:
 *                everything since the root
 *   <sha>        the commit to deploy (default HEAD)
 *
 * For each first-parent commit M of <live>..<sha> that carries a `Never-auto:` trailer, oldest first. The
 * runner puts `Unit:` and `Never-auto:` on the land commit of the unit branch and merges it with a message that
 * has none, so for a merge the commits of its own branch (M^1..M^2, less what <live> already holds) are read
 * as well as M's message; each unit is one entry, its categories those of all its commits that name one (newest
 * first, each once), and the entry is M (a fast-forwarded or direct land is its own commit, and says `WARN
 * <sha12> land is not a merge: its critical paths cover that commit only`). A trailer is a `Key: value` line
 * (spaces before the colon allowed) in any paragraph after the subject whose lines are all of that form,
 * indented alike or not (a squash message indents the commits it quotes), so `Co-Authored-By:` lines after the
 * block do not hide it; a `Never-auto:` line inside prose is none, and says `WARN <sha12> has a Never-auto:
 * line outside a trailer block` before the count line. Every git log runs with --no-show-signature, and a log
 * record that still does not parse says `WARN <n> log records did not parse`:
 *
 *   NEVER-AUTO <sha12> <unit> <middot> <categories>
 *     landing: <the message's `Landing:` line, or "not recorded">
 *     review <kind> <model>/<family> P0=<n> P1=<n> <middot> <outcome>      (one line per row, or "  review: none recorded")
 *     audit: <post-merge audit row kind + sha12 | none recorded>
 *
 * then, always, `DEPLOY LIST <n> never-auto lands in <live12|root>..<sha12>` and, when n > 0, `CRITICAL
 * PATHS <k> files: run one adversarial pass over git diff <live12>..<sha12> -- <paths>` (with no live, the
 * full hash of the empty tree stands for <live12>: git refuses it shortened), the paths being the union of
 * what those first-parent commits changed (a merge: its diff against its first parent), sorted.
 *
 * <middot> is U+00B7, a middle dot. The unit is the `Unit:` trailer of the commit that names the categories, else
 * the merge's, else its subject. The review rows are the Codex and Claude
 * run ledgers' rows (the main checkout's, as review-gate.mjs reads them) of a review kind (review,
 * adversarial, adversarial-frontier) whose recorded tree is the land commit's, or, for a merge, that of
 * any commit of the unit branch (reachable from its second parent, not from its first); for any other
 * commit its own tree and its parent's. P0 and P1 are counted from the row's kept verdict
 * (`verdictCopy`), or from `p0` and `p1` fields when the row has them; `P0=? P1=?` when it records
 * neither. The audit is an ok row of an audit kind (AUDIT_KIND) whose tree is the land commit's or a
 * later commit's in the range; the sha is the commit whose tree it read.
 *
 * exit: 0 a list was printed (a list is not a gate: an empty one is exit 0 too) | 2 usage (no <live-sha>,
 * an unknown option or ref, not inside a git repository, git failed) or <live-sha> is not an ancestor of
 * <sha>: nothing on stdout and `WARN <live12> is not an ancestor of <sha12>` on stderr.
 *
 * Read-only. It prints; it never writes into the repository or a ledger.
 */
import fs from 'node:fs';
import { formatList, isRoot, landsOf, listEntries, parseArgs, parseLogChecked, unparsedWarning, warningsOf } from './lib/deploy-list-core.mjs';
import { countFindings } from './lib/retro-core.mjs';
import { readVerdicts, repoTop } from './lib/retro-gather.mjs';
import { CLAUDE_LEDGER_DIR, LEDGER_DIR, defaultLedger, gitRead } from './lib/run-sources.mjs';

const USAGE = 'usage: node scripts/deploy-list.mjs <live-sha|-> [<sha>]';

function usage(msg) {
  process.stderr.write(`deploy-list: ${msg}\n${USAGE}\n`);
  process.exitCode = 2;
}

/** The rows of one ledger, each tagged with its ledger file and family; an unreadable ledger or a bad line is skipped. */
function ledgerRows(file, family) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
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
      // a torn or foreign line: not a run
    }
  }
  return rows;
}

/** The commit `ref` names, or throws: a name that is no commit (a path, an option) is never passed on to git. */
function commitOf(top, ref) {
  if (ref.startsWith('-')) throw new Error(`${ref} is not a commit`);
  try {
    return gitRead(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], top).trim();
  } catch (e) {
    throw new Error(`unknown ref ${ref}`, { cause: e });
  }
}

const LOG_FORMAT = '--format=%H%x00%T%x00%P%x00%B%x1e';

/** Whether commit `a` is `b` or one of its ancestors. */
function isAncestor(top, a, b) {
  try {
    gitRead(['merge-base', '--is-ancestor', a, b], top);
    return true;
  } catch {
    return false;
  }
}

/** What the entries need beyond the first-parent commit's message: a merge's own commits, the parent's tree, the files the land changed. */
function factsOf(top, commit, branch) {
  const [first, ...others] = commit.parents;
  const parentTree = first && others.length === 0 ? gitRead(['rev-parse', `${first}^{tree}`], top).trim() : null;
  const diff = first ? ['diff-tree', '-r', '--name-only', '-z', '--no-renames', first, commit.sha] : ['diff-tree', '-r', '--name-only', '-z', '--no-renames', '--root', commit.sha];
  return { branch, parentTree, files: gitRead(diff, top).split('\0').filter(Boolean) };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.some((arg) => arg === '--help' || arg === '-h')) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    return usage(e.message);
  }
  let out;
  try {
    const top = repoTop(process.cwd());
    const sha = commitOf(top, args.sha);
    const live = isRoot(args.live) ? null : commitOf(top, args.live);
    if (live !== null && !isAncestor(top, live, sha)) {
      process.stderr.write(`WARN ${live.slice(0, 12)} is not an ancestor of ${sha.slice(0, 12)}\n`);
      process.exitCode = 2;
      return;
    }
    const range = live === null ? [sha] : [`${live}..${sha}`];
    // --no-show-signature on every log: log.showSignature=true prints signature lines ahead of each record
    let unparsed = 0;
    const read = (args) => {
      const r = parseLogChecked(gitRead(['log', '--no-show-signature', ...args], top));
      unparsed += r.unparsed;
      return r.commits;
    };
    const commits = read(['--first-parent', '--reverse', LOG_FORMAT, ...range]);
    const rows = [
      ...ledgerRows(defaultLedger(top, LEDGER_DIR), 'codex'),
      ...ledgerRows(defaultLedger(top, CLAUDE_LEDGER_DIR), 'claude'),
    ];
    // The land commit sits on the unit branch, so a merge's own commits are read (one log each); the diff and
    // the tree only for the commits that carry a land.
    const extra = {};
    for (const c of commits) {
      const [first, ...others] = c.parents;
      // not what live already holds: a branch that merged live in carries commits production has
      const branch = others.length ? read([LOG_FORMAT, ...others, `^${first}`, ...(live === null ? [] : [`^${live}`])]) : [];
      extra[c.sha] = landsOf(c, branch).length ? factsOf(top, c, branch) : { branch };
    }
    const entries = listEntries(commits, extra, rows);
    // a review row's counts, from the verdict copy its ledger kept
    for (const file of new Set(entries.flatMap((e) => e.reviews.map((r) => r.ledger)))) {
      const own = entries.flatMap((e) => e.reviews).filter((r) => r.ledger === file);
      const verdicts = readVerdicts(file, own);
      for (const r of own) if (verdicts.has(r.verdictCopy)) r.counts = countFindings(verdicts.get(r.verdictCopy));
    }
    const root = gitRead(['hash-object', '-t', 'tree', '--stdin'], top).trim();
    out = formatList(entries, { live, sha, root, warnings: [...warningsOf(commits, extra), unparsedWarning(unparsed)].filter(Boolean) });
  } catch (e) {
    return usage(e.message);
  }
  process.stdout.write(out);
}

main();
