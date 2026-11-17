#!/usr/bin/env node
// harness-bootstrap unit-record (generated YYYY-MM-DD). Prints the unit's record block, generated.
// [M] mechanism (ships as-is): everything. The [B] bindings (auditor lanes, gate summary line,
// state-file sections, commit cap) live at the top of scripts/lib/unit-record-core.mjs.
/**
 * Builds the unit's record from what is already true: the commits and diffstat from git, the last
 * SUMMARY line of the gate log, and the Base/Claimed/Deliverable started/Owner wait lines, ledger
 * and findings tables of the unit's state file. A `Deliverable started: <ISO>` line opens the row's
 * Elapsed, wall and owner-wait window at that time (owner-wait pairs before it are left out); without
 * it the window opens at `Claimed:`, so a unit's second deliverable would include its first. A batch
 * unit's `Rows: <id>, <id>` line starts the row's Deliverable cell with `rows <id>, <id> — `. The session pastes or redirects the output; nothing is hand-written.
 *
 *   node scripts/unit-record.mjs --state <state file> [--base <sha>] [--gates <file>] [--cost "<line>"]
 *     [--steps <steps file>] [--json]
 *   node scripts/unit-record.mjs --state <state file> --trailer
 *
 * options:
 *   --state <file>   the unit's state file (docs/plans/<unit>.state.md by default layout)
 *   --base <sha>     the base to diff against (default: the state file's `Base:` line)
 *   --gates <file>   a run-gates log or captured output; absent -> "Gates: not run"
 *   --cost "<line>"  the output of `scripts/unit-cost.mjs ... --line`; goes in the draft row's Cost cell
 *                    (CR/LF in it become one space, so the row stays one line)
 *   --steps <file>   the unit's steps file (unit-step.mjs, `<unit>.steps.jsonl`): adds a `Steps:` line
 *                    and each ledger step's time; a missing file is a usage error, an empty one adds nothing
 *   --json           print { header, summary, commits, diffstat, gates, trailer, record } instead
 *   --trailer        print the land commit's trailer lines and nothing else, from the state file alone (no
 *                    git, no other option): `Unit: <unit id>` and, when the state names never-auto product
 *                    categories (the state file's `Never-auto: <categories, comma-separated, or none>` header
 *                    line, which must be there: with no such line, or an empty one, it exits 2 saying so, and so it does for a value that names no category
 *                    (`(money)`) and is not none; `-`, `none`, `none (docs only)` and `n/a` are none, and a parenthesised note
 *                    is no part of a category), `Never-auto: <cat>[, <cat>]` (lower-cased, in the file's
 *                    order, once each). Pass them
 *                    to `git commit --trailer` or paste them at the end of the land commit message: the
 *                    owner reads them at the deploy (deploy-list.mjs). The record carries the same
 *                    category list as a `Land commit trailer:` line, only when categories are set
 *
 * Commits are `git log --reverse <base>..HEAD`, the diffstat is `git diff --shortstat
 * <base>..HEAD`, both from the repository top.
 *
 * exit: 0 ok | 2 usage (no --state, no base anywhere, --trailer on a state with no unit or no Never-auto line, unreadable state or gates file, git failure).
 *
 * Read-only. It prints; it never writes into the repo.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  buildRecord,
  landTrailer,
  lastSummary,
  neverAutoUnreadable,
  parseArgs,
  parseState,
  summarizeFindings,
} from './lib/unit-record-core.mjs';
import { parseSteps } from './lib/unit-step-core.mjs';

const USAGE =
  'usage: node scripts/unit-record.mjs --state <state file> [--base <sha>] [--gates <file>] [--cost "<line>"] [--steps <steps file>] [--json] | --state <state file> --trailer';

function usage(msg) {
  process.stderr.write(`unit-record: ${msg}\n${USAGE}\n`);
  process.exitCode = 2;
}

function readFile(file, what) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`cannot read ${what} ${file}: ${e.code ?? e.message}`, { cause: e });
  }
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const detail = String(e.stderr ?? e.message).trim().split('\n')[0];
    throw new Error(`git ${args[0]} failed: ${detail}`, { cause: e });
  }
}

function main() {
  if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    return usage(e.message);
  }
  if (args.trailer) {
    try {
      const { header } = parseState(readFile(args.state, 'state file'));
      if (!header.unit) throw new Error('no unit: add a `Unit:` line to the state file');
      if (neverAutoUnreadable(header.neverAuto)) {
        process.stderr.write(`unit-record: ${args.state} has a Never-auto: value that names no category (write none when there are none)\n`);
        process.exitCode = 2;
        return;
      }
      if (!header.neverAuto.trim()) {
        // a missing line is not `none`: the land commit would go out without the category the owner reads at the deploy
        process.stderr.write(`unit-record: ${args.state} has no Never-auto: line (write none when there are none)\n`);
        process.exitCode = 2;
        return;
      }
      process.stdout.write(`${landTrailer(header).join('\n')}\n`);
    } catch (e) {
      usage(e.message);
    }
    return;
  }
  let state;
  let gatesText = null;
  let steps = null;
  let commits;
  let diffstat;
  let head;
  let base;
  try {
    state = parseState(readFile(args.state, 'state file'));
    base = args.base || state.header.base;
    if (!base) throw new Error('no base: pass --base <sha> or add a `Base:` line to the state file');
    if (base.startsWith('-')) throw new Error(`base must be a commit, not an option (got "${base}")`);
    if (args.gates) gatesText = readFile(args.gates, 'gates file');
    if (args.steps) steps = parseSteps(readFile(args.steps, 'steps file'));
    const top = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
    const range = `${base}..HEAD`;
    commits = git(['log', '--no-show-signature', '--reverse', '--format=%h%x09%s', range], top)
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t');
        return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
      });
    diffstat = git(['diff', '--shortstat', range], top).trim();
    head = git(['rev-parse', '--short', 'HEAD'], top).trim();
  } catch (e) {
    return usage(e.message);
  }
  const gates = gatesText === null ? null : lastSummary(gatesText);
  const record = buildRecord({
    state,
    commits,
    diffstat,
    gatesSummary: gates,
    now: new Date().toISOString(),
    base,
    head,
    cost: args.cost,
    steps,
  });
  if (args.json) {
    const summary = summarizeFindings(state.findings);
    process.stdout.write(
      `${JSON.stringify({ header: state.header, summary, commits, diffstat, gates, trailer: landTrailer(state.header), record }, null, 2)}\n`,
    );
  } else process.stdout.write(record);
}

main();
