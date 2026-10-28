#!/usr/bin/env node
// harness-bootstrap unit-cost (generated YYYY-MM-DD). Prints what one unit cost, measured, not guessed.
// [M] mechanism (ships as-is): everything. The [B] bindings (price table, cache-write multipliers,
// dollars per percent of the weekly limit) live at the top of scripts/lib/unit-cost-core.mjs, the
// two ledger directories at the top of scripts/lib/run-sources.mjs.
/**
 * Reads the unit's Claude Code transcripts (main thread plus every subagent), a Codex host's threads,
 * the Codex run ledger and claude-run's, and prints the cost, the Claude % and the Codex % for the
 * harness log row.
 *
 *   node scripts/unit-cost.mjs --session <id>[,<id>...] [--projects-dir <dir>] [--since <ISO>]
 *     [--until <ISO>] [--ledger <path>] [--cwd-match <substring>] [--times] [--by-step <steps file>
 *     [--unit <id>]] [--json | --line]
 *
 * options:
 *   --session <ids>      one or more session ids (comma-separated); the files are found by scanning
 *                        <projects-dir>/*\/<id>.jsonl, subagents in <id>/subagents/*.jsonl. An id that
 *                        is no Claude Code session is a Codex thread's (`$CODEX_THREAD_ID` on a Codex
 *                        host): its rollout and its subagents' under $CODEX_HOME/sessions or, once
 *                        archived, $CODEX_HOME/archived_sessions (CODEX_HOME defaults to ~/.codex).
 *                        Codex reports tokens and quota, not dollars
 *   --projects-dir <d>   default $CLAUDE_CONFIG_DIR/projects when set, else ~/.claude/projects
 *   --since / --until    only turns inside this ISO window; a ledger's runs are counted only between
 *                        the sessions' first and last turn, so a bound left out ends there
 *   --ledger <path>      Codex ledger JSONL (default: the main checkout's .codex-runs/ledger.jsonl, the
 *                        one codex-run.mjs writes -- the same file from a linked worktree -- if present)
 *   --cwd-match <s>      only ledger runs (Codex and claude-run) whose cwd contains this substring;
 *                        it replaces the default, the runs made in this worktree, for both ledgers
 *   --times              add the main thread's wall, owner-wait and work time (owner wait: each question
 *                        until its answer, each typed prompt back to the last turn before it), its
 *                        compactions, its cache-hit share and its cache-expiry rewrites
 *   --by-step <file>     add dollars and time per runner step, from the unit's steps file
 *                        (unit-step.mjs); subagents go by their `[<unit> s<step> r<n>]` dispatch tag
 *   --unit <id>          the unit whose tags count (default: the steps file's name, `<unit>.steps.jsonl`)
 *   --json               print { claude, codex, claudeRuns, codexHost, summary } instead (plus times,
 *                        compactions, cache and steps when asked for)
 *   --line               print only the one-line summary (`Cost $<x> · Claude <p>% · Codex <q>% (<n> runs)`),
 *                        for `unit-record.mjs --cost "$(node scripts/unit-cost.mjs ... --line)"`
 *
 * The two run ledgers (the main checkout's .codex-runs/ledger.jsonl and .claude-runs/ledger.jsonl, when
 * there are any) are written by every worktree of the repository, so a ledger's runs are this unit's
 * only when made in this worktree, judged by each run's real cwd, and between the sessions' first and
 * last turn. claude-run's add their dollars to the cost: it keeps no transcript.
 *
 * The Codex % is account-wide: it is the growth of the account's weekly quota during the Codex runs
 * and a Codex host's turns, so it includes any other work on the same account in that window.
 * Overlapping runs and turns count once.
 *
 * exit: 0 ok | 2 usage (bad flag, session not found, unreadable transcript).
 *
 * Read-only. It prints; it never writes into the repo or the transcripts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  codexPercent,
  formatReport,
  ledgerWindow,
  parseArgs,
  parseCodexSession,
  parseEvents,
  parseLedger,
  parseTranscript,
  summarizeCache,
  summarizeClaude,
  summarizeClaudeRuns,
  summarizeCodexHost,
  summarizeCompactions,
  summarizeLedger,
  summarizeSteps,
  summarizeTimes,
  summaryLine,
} from './lib/unit-cost-core.mjs';
import {
  CLAUDE_LEDGER_DIR,
  codexSessionFiles,
  codexSessionsDir,
  defaultLedger,
  fileLines,
  sessionFiles,
  worktreeOwner,
  worktreePaths,
} from './lib/run-sources.mjs';
import { parseSteps } from './lib/unit-step-core.mjs';

const USAGE =
  'usage: node scripts/unit-cost.mjs --session <id>[,<id>...] [--projects-dir <dir>] [--since <ISO>] [--until <ISO>] [--ledger <path>] [--cwd-match <substring>] [--times] [--by-step <steps file> [--unit <id>]] [--json | --line]';

function usage(msg) {
  process.stderr.write(`unit-cost: ${msg}\n${USAGE}\n`);
  process.exitCode = 2;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`cannot read ${file}: ${e.code ?? e.message}`, { cause: e });
  }
}

/** A session id's files: a Claude Code session's transcripts, else a Codex thread's rollouts. */
function findSession(projectsDir, codexDir, id) {
  try {
    return { claude: sessionFiles(projectsDir, id), codex: [] };
  } catch (e) {
    const codex = codexSessionFiles(codexDir, id);
    if (codex.length) return { claude: [], codex };
    throw new Error(/ not found under /.test(e.message) ? `${e.message} or ${codexDir}` : e.message, { cause: e });
  }
}

/**
 * A ledger's runs that are this unit's: both ledgers live in the main checkout and every worktree writes
 * them, so the ones made in this worktree (a run with no cwd is no worktree's), or with --cwd-match every
 * run (the summaries then keep the matching ones).
 */
function worktreeRuns(runs, cwdMatch) {
  if (cwdMatch) return runs;
  const owner = worktreeOwner(worktreePaths(process.cwd()));
  const here = owner(process.cwd());
  return runs.filter((e) => here !== null && owner(e.cwd) === here);
}

function main() {
  let args;
  let claude;
  let codex = null;
  const extra = {};
  try {
    args = parseArgs(process.argv.slice(2));
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const projectsDir = args.projectsDir ?? path.join(configDir, 'projects');
    const codexDir = codexSessionsDir();
    const found = args.session.map((id) => findSession(projectsDir, codexDir, id));
    const texts = found.flatMap((f) => f.claude).map(({ file, ctx }) => ({ ctx, text: readText(file) }));
    const files = [...new Set(found.flatMap((f) => f.codex).map(({ file }) => file))];
    const threads = files.map((file) => parseCodexSession(fileLines(file)));
    const rows = texts.flatMap(({ text, ctx }) => parseTranscript(text, ctx));
    const window = { since: args.since, until: args.until };
    // The sessions' own turns keep the window as given; a ledger's runs are counted between their first and last time.
    const times = [...rows.map((r) => r.ts), ...threads.flatMap((t) => [...t.starts, ...t.readings.map((r) => r.ts)])];
    const runWindow = ledgerWindow(window, times);
    claude = summarizeClaude(rows, window);
    if (args.times) {
      const events = [
        ...texts.filter(({ ctx }) => ctx.kind === 'main').flatMap(({ text }) => parseEvents(text)),
        ...threads.filter((t) => t.kind === 'main').flatMap((t) => t.events),
      ];
      extra.times = summarizeTimes(events, window);
      extra.compactions = summarizeCompactions(events, window);
      // Claude's prompt cache; a Codex thread's cache share is on the host line.
      if (texts.length || !threads.length) extra.cache = summarizeCache(rows, window);
    }
    if (args.byStep) {
      const unit = args.unit ?? path.basename(args.byStep).replace(/\.steps\.jsonl$/, '');
      extra.steps = summarizeSteps(rows, parseSteps(readText(args.byStep)), { ...window, unit });
    }
    const ledger = args.ledger ?? defaultLedger();
    const entries = ledger && fs.existsSync(ledger) ? worktreeRuns(parseLedger(readText(ledger)), args.cwdMatch) : null;
    if (entries) codex = summarizeLedger(entries, { ...runWindow, cwdMatch: args.cwdMatch });
    const claudeLedger = defaultLedger(process.cwd(), CLAUDE_LEDGER_DIR);
    if (fs.existsSync(claudeLedger)) {
      const runs = worktreeRuns(parseLedger(readText(claudeLedger)), args.cwdMatch);
      extra.claudeRuns = summarizeClaudeRuns(runs, { ...runWindow, cwdMatch: args.cwdMatch });
    }
    if (threads.length) {
      extra.host = summarizeCodexHost(threads, window);
      extra.percent = codexPercent(entries ?? [], threads, { ...runWindow, cwdMatch: args.cwdMatch });
    }
  } catch (e) {
    return usage(e.message);
  }
  if (args.line) process.stdout.write(`${summaryLine(claude, codex, extra)}\n`);
  else if (args.json) {
    const { claudeRuns = null, host = null, percent: _percent, ...rest } = extra;
    const summary = summaryLine(claude, codex, extra);
    process.stdout.write(`${JSON.stringify({ claude, codex, claudeRuns, codexHost: host, summary, ...rest }, null, 2)}\n`);
  } else process.stdout.write(formatReport(claude, codex, extra));
}

main();
