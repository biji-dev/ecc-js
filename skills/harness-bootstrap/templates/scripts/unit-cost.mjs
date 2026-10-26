#!/usr/bin/env node
// harness-bootstrap unit-cost (generated YYYY-MM-DD). Prints what one unit cost, measured, not guessed.
// [M] mechanism (ships as-is): everything. The [B] bindings (price table, cache-write multipliers,
// dollars per percent of the weekly limit) live at the top of scripts/lib/unit-cost-core.mjs.
/**
 * Reads the unit's Claude Code transcripts (main thread plus every subagent) and the Codex run
 * ledger, and prints the cost, the Claude % and the Codex % for the harness log row.
 *
 *   node scripts/unit-cost.mjs --session <id>[,<id>...] [--projects-dir <dir>] [--since <ISO>]
 *     [--until <ISO>] [--ledger <path>] [--cwd-match <substring>] [--json]
 *
 * options:
 *   --session <ids>      one or more session ids (comma-separated); the files are found by scanning
 *                        <projects-dir>/*\/<id>.jsonl, subagents in <id>/subagents/*.jsonl
 *   --projects-dir <d>   default ~/.claude/projects
 *   --since / --until    only turns (and Codex runs) inside this ISO window
 *   --ledger <path>      Codex ledger JSONL (default <git toplevel>/.codex-runs/ledger.jsonl if present)
 *   --cwd-match <s>      only Codex runs whose cwd contains this substring
 *   --json               print { claude, codex, summary } instead
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
  parseLedger,
  parseTranscript,
  summarizeClaude,
  summarizeLedger,
  summaryLine,
} from './lib/unit-cost-core.mjs';

const USAGE =
  'usage: node scripts/unit-cost.mjs --session <id>[,<id>...] [--projects-dir <dir>] [--since <ISO>] [--until <ISO>] [--ledger <path>] [--cwd-match <substring>] [--json]';

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
  const files = [{ file: path.join(dir, `${id}.jsonl`), ctx: { kind: 'main' } }];
  const subDir = path.join(dir, id, 'subagents');
  if (fs.existsSync(subDir)) {
    for (const name of fs.readdirSync(subDir).filter((n) => n.endsWith('.jsonl')).sort()) {
      const meta = readJson(path.join(subDir, name.replace(/\.jsonl$/, '.meta.json')));
      files.push({
        file: path.join(subDir, name),
        ctx: { kind: 'sub', agentId: `${id}/${name}`, agentType: meta.agentType ?? null },
      });
    }
  }
  return files;
}

function defaultLedger() {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.join(top, '.codex-runs', 'ledger.jsonl');
  } catch {
    return null;
  }
}

function main() {
  let args;
  let claude;
  let codex = null;
  try {
    args = parseArgs(process.argv.slice(2));
    const projectsDir = args.projectsDir ?? path.join(os.homedir(), '.claude', 'projects');
    const rows = args.session.flatMap((id) =>
      sessionFiles(projectsDir, id).flatMap(({ file, ctx }) => parseTranscript(readText(file), ctx)),
    );
    const window = { since: args.since, until: args.until };
    claude = summarizeClaude(rows, window);
    const ledger = args.ledger ?? defaultLedger();
    if (ledger && fs.existsSync(ledger)) {
      codex = summarizeLedger(parseLedger(readText(ledger)), { ...window, cwdMatch: args.cwdMatch });
    }
  } catch (e) {
    return usage(e.message);
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ claude, codex, summary: summaryLine(claude, codex) }, null, 2)}\n`);
  } else process.stdout.write(formatReport(claude, codex));
}

main();
