#!/usr/bin/env node
// harness-bootstrap unit-cost (generated YYYY-MM-DD). Prints what one unit cost, measured, not guessed.
// [M] mechanism (ships as-is): everything. The [B] bindings (price table, cache-write multipliers,
// dollars per percent of the weekly limit) live at the top of scripts/lib/unit-cost-core.mjs.
/**
 * Reads the unit's Claude Code transcripts (main thread plus every subagent) and the Codex run
 * ledger, and prints the cost, the Claude % and the Codex % for the harness log row.
 *
 *   node scripts/unit-cost.mjs --session <id>[,<id>...] [--projects-dir <dir>] [--since <ISO>]
 *     [--until <ISO>] [--ledger <path>] [--cwd-match <substring>] [--times] [--by-step <steps file>
 *     [--unit <id>]] [--json | --line]
 *
 * options:
 *   --session <ids>      one or more session ids (comma-separated); the files are found by scanning
 *                        <projects-dir>/*\/<id>.jsonl, subagents in <id>/subagents/*.jsonl
 *   --projects-dir <d>   default ~/.claude/projects
 *   --since / --until    only turns (and Codex runs) inside this ISO window
 *   --ledger <path>      Codex ledger JSONL (default: the main checkout's .codex-runs/ledger.jsonl, the
 *                        one codex-run.mjs writes -- the same file from a linked worktree -- if present)
 *   --cwd-match <s>      only Codex runs whose cwd contains this substring
 *   --times              add the main thread's wall, owner-wait and work time (owner wait: each question
 *                        until its answer, each typed prompt back to the last turn before it), its
 *                        compactions, its cache-hit share and its cache-expiry rewrites
 *   --by-step <file>     add dollars and time per runner step, from the unit's steps file
 *                        (unit-step.mjs); subagents go by their `[<unit> s<step> r<n>]` dispatch tag
 *   --unit <id>          the unit whose tags count (default: the steps file's name, `<unit>.steps.jsonl`)
 *   --json               print { claude, codex, summary } instead (plus times, compactions, cache and
 *                        steps when asked for)
 *   --line               print only the one-line summary (`Cost $<x> · Claude <p>% · Codex <q>% (<n> runs)`),
 *                        for `unit-record.mjs --cost "$(node scripts/unit-cost.mjs ... --line)"`
 *
 * The Codex % is account-wide: it is the growth of the account's weekly quota during the Codex runs,
 * so it includes any other work on the same account in that window. Overlapping runs count once.
 *
 * exit: 0 ok | 2 usage (bad flag, session not found, unreadable transcript).
 *
 * Read-only. It prints; it never writes into the repo or the transcripts.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  formatReport,
  parseArgs,
  parseEvents,
  parseLedger,
  parseTranscript,
  summarizeCache,
  summarizeClaude,
  summarizeCompactions,
  summarizeLedger,
  summarizeSteps,
  summarizeTimes,
  summaryLine,
} from './lib/unit-cost-core.mjs';
import { parseSteps } from './lib/unit-step-core.mjs';

// [B] Where the ledger lives, relative to the main checkout (the same name as in codex-run.mjs).
const LEDGER_DIR = '.codex-runs';

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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** The session's main file and its subagent files, as [{ file, ctx }]. */
function sessionFiles(projectsDir, id) {
  let projects;
  try {
    projects = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (e) {
    throw new Error(`cannot read projects dir ${projectsDir}: ${e.code ?? e.message}`, { cause: e });
  }
  const dir = projects.map((p) => path.join(projectsDir, p.name)).find((p) => fs.existsSync(path.join(p, `${id}.jsonl`)));
  if (!dir) throw new Error(`session ${id} not found under ${projectsDir}`);
  const files = [{ file: path.join(dir, `${id}.jsonl`), ctx: { kind: 'main', session: id } }];
  const subDir = path.join(dir, id, 'subagents');
  if (fs.existsSync(subDir)) {
    for (const name of fs.readdirSync(subDir).filter((n) => n.endsWith('.jsonl')).sort()) {
      const meta = readJson(path.join(subDir, name.replace(/\.jsonl$/, '.meta.json')));
      files.push({
        file: path.join(subDir, name),
        ctx: {
          kind: 'sub',
          agentId: `${id}/${name}`,
          agentType: meta.agentType ?? null,
          session: id,
          description: typeof meta.description === 'string' ? meta.description : null,
        },
      });
    }
  }
  return files;
}

/** Main checkout root, so worktrees share one ledger (the same resolution as codex-run.mjs). */
function defaultLedger(cwd = process.cwd()) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.join(path.dirname(common), LEDGER_DIR, 'ledger.jsonl');
  } catch {
    return path.join(cwd, LEDGER_DIR, 'ledger.jsonl');
  }
}

function main() {
  let args;
  let claude;
  let codex = null;
  const extra = {};
  try {
    args = parseArgs(process.argv.slice(2));
    const projectsDir = args.projectsDir ?? path.join(os.homedir(), '.claude', 'projects');
    const texts = args.session.flatMap((id) =>
      sessionFiles(projectsDir, id).map(({ file, ctx }) => ({ ctx, text: readText(file) })),
    );
    const rows = texts.flatMap(({ text, ctx }) => parseTranscript(text, ctx));
    const window = { since: args.since, until: args.until };
    claude = summarizeClaude(rows, window);
    if (args.times) {
      const events = texts.filter(({ ctx }) => ctx.kind === 'main').flatMap(({ text }) => parseEvents(text));
      extra.times = summarizeTimes(events, window);
      extra.compactions = summarizeCompactions(events, window);
      extra.cache = summarizeCache(rows, window);
    }
    if (args.byStep) {
      const unit = args.unit ?? path.basename(args.byStep).replace(/\.steps\.jsonl$/, '');
      extra.steps = summarizeSteps(rows, parseSteps(readText(args.byStep)), { ...window, unit });
    }
    const ledger = args.ledger ?? defaultLedger();
    if (ledger && fs.existsSync(ledger)) {
      codex = summarizeLedger(parseLedger(readText(ledger)), { ...window, cwdMatch: args.cwdMatch });
    }
  } catch (e) {
    return usage(e.message);
  }
  if (args.line) process.stdout.write(`${summaryLine(claude, codex)}\n`);
  else if (args.json) {
    process.stdout.write(`${JSON.stringify({ claude, codex, summary: summaryLine(claude, codex), ...extra }, null, 2)}\n`);
  } else process.stdout.write(formatReport(claude, codex, extra));
}

main();
