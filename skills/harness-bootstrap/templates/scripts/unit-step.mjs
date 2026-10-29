#!/usr/bin/env node
// harness-bootstrap unit-step (generated YYYY-MM-DD). Appends one step marker beside the unit's state file.
// [M] mechanism (ships as-is): everything. The [B] binding (the steps directory) lives at the top of
// scripts/lib/unit-step-core.mjs.
/**
 * The runner calls it when each step starts (a start closes the step before it) and with `done` after
 * the last step or before a stop, so the unit's steps file carries a time per step and
 * `unit-cost.mjs --by-step` can split the unit's cost and time by step.
 *
 *   node scripts/unit-step.mjs <unit> <step> start|done [--round <n>] [--dir <dir>] [--at <ISO>]
 *   node scripts/unit-step.mjs <unit> --list [--dir <dir>]
 *
 * options:
 *   --round <n>   the review or fix round the step belongs to (default 1)
 *   --dir <dir>   the steps directory (default: the [B] STEPS_DIR under the repository top)
 *   --at <ISO>    the marker's time (default now), for a marker written late; never to invent one
 *   --list        print the unit's step intervals and anything out of order; append nothing
 *
 * The file is `<dir>/<unit>.steps.jsonl`, one `{t, unit, step, event, round}` line per marker. A
 * marker out of order (a done with no open start, a repeated start) is appended anyway and warned
 * about on stderr: the file is evidence, and the runner never stops for a marker.
 *
 * exit: 0 ok, warnings included | 2 usage (bad arguments, unreadable or unwritable steps file).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  STEPS_DIR,
  checkNext,
  formatIntervals,
  parseArgs,
  parseSteps,
  stepIntervals,
  stepLine,
} from './lib/unit-step-core.mjs';

const USAGE =
  'usage: node scripts/unit-step.mjs <unit> <step> start|done [--round <n>] [--dir <dir>] [--at <ISO>] | <unit> --list [--dir <dir>]';

function usage(msg) {
  process.stderr.write(`unit-step: ${msg}\n${USAGE}\n`);
  process.exitCode = 2;
}

function repoTop() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function readSteps(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw new Error(`cannot read ${file}: ${e.code ?? e.message}`, { cause: e });
  }
}

function main() {
  if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  let args;
  let file;
  let markers;
  try {
    args = parseArgs(process.argv.slice(2));
    const dir = args.dir ? path.resolve(args.dir) : path.join(repoTop(), STEPS_DIR);
    file = path.join(dir, `${args.unit}.steps.jsonl`);
    markers = parseSteps(readSteps(file));
  } catch (e) {
    return usage(e.message);
  }
  if (args.list) {
    process.stdout.write(formatIntervals(stepIntervals(markers, Date.now())));
    return;
  }
  const t = args.at ? new Date(args.at).toISOString() : new Date().toISOString();
  const next = { t, ts: Date.parse(t), unit: args.unit, step: args.step, event: args.event, round: args.round };
  const warning = checkNext(markers, next);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${stepLine(next)}\n`);
  } catch (e) {
    return usage(`cannot write ${file}: ${e.code ?? e.message}`);
  }
  if (warning) process.stderr.write(`unit-step: warning: ${warning}\n`);
  process.stdout.write(`unit-step: ${args.unit} ${args.step} r${args.round} ${args.event} ${t}\n`);
}

main();
