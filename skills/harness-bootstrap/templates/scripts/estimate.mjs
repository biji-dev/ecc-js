#!/usr/bin/env node
// harness-bootstrap estimate (generated YYYY-MM-DD). Prints Gate 1's range from the project's own log.
// [M] mechanism (ships as-is): everything. The [B] bindings (column header names, tiers, the
// history threshold) live at the top of scripts/lib/estimate-core.mjs.
/**
 * Reads the harness log's table and prints a RANGE (p25-p75), never a single number, for work time,
 * owner wait, Claude % and Codex % -- and says "no history" when a metric has fewer rows than the
 * threshold. Gate 1 quotes the line as-is.
 *
 *   node scripts/estimate.mjs --log <docs/harness/log.md> [--tier <small|full>] [--cohort <regex>]
 *     [--json]
 *
 * options:
 *   --log <file>      the harness log (a markdown table; `\|` is a literal pipe inside a cell)
 *   --tier <t>        only rows of this tier (read from the Tier column, or the last part of
 *                     the `Unit · Mode · Type · Tier` cell)
 *   --cohort <re>     only rows whose Unit or Type cell matches this regular expression (case-insensitive)
 *   --json            print { tier, rows, metrics, line } instead (`rows` counts units)
 *
 * One sample per UNIT: rows are grouped by the unit id (the first cell, before ` · `) and a unit's
 * deliverable rows are summed, so a unit with three deliverables is one sample, not three.
 *
 * A row below a table with no header of its own and no earlier table with as many columns is read by
 * nothing; it is named on stderr (`estimate: warning: ...`), and the exit status is the same.
 *
 * exit: 0 ok, warnings included | 2 usage (bad flag, unreadable log, no usable table).
 *
 * Read-only. It prints; it never writes into the repo.
 */
import fs from 'node:fs';
import { estimate, formatLine, formatReport, hasLogTable, leftOutRows, leftOutWarning, parseArgs, parseLog } from './lib/estimate-core.mjs';

const USAGE =
  'usage: node scripts/estimate.mjs --log <docs/harness/log.md> [--tier <small|full>] [--cohort <regex>] [--json]';

function usage(msg) {
  process.stderr.write(`estimate: ${msg}\n${USAGE}\n`);
  process.exitCode = 2;
}

function main() {
  if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  let args;
  let est;
  let leftOut;
  try {
    args = parseArgs(process.argv.slice(2));
    let text;
    try {
      text = fs.readFileSync(args.log, 'utf8');
    } catch (e) {
      throw new Error(`cannot read log ${args.log}: ${e.code ?? e.message}`, { cause: e });
    }
    if (!hasLogTable(text)) throw new Error(`no harness-log table (Unit and Elapsed or Cost columns) in ${args.log}`);
    const records = parseLog(text);
    leftOut = leftOutWarning(leftOutRows(text));
    est = estimate(records, { tier: args.tier, cohort: args.cohort });
  } catch (e) {
    return usage(e.message);
  }
  if (leftOut) process.stderr.write(`estimate: warning: ${leftOut}\n`);
  if (args.json) process.stdout.write(`${JSON.stringify({ ...est, line: formatLine(est) }, null, 2)}\n`);
  else process.stdout.write(formatReport(est));
}

main();
