#!/usr/bin/env node
// harness-bootstrap unit-step (generated YYYY-MM-DD). Appends one step marker beside the unit's state file.
// [M] mechanism (ships as-is): everything. The [B] bindings (the steps directory, the steps that run off
// the unit's branch) live at the top of scripts/lib/unit-step-core.mjs.
/**
 * The runner calls it when each step starts (a start closes the step before it) and with `done` after
 * the last step or before a stop, so the unit's steps file carries a time per step and
 * `unit-cost.mjs --by-step` can split the unit's cost and time by step.
 *
 *   node scripts/unit-step.mjs <unit> <step> start|done [--round <n>] [--dir <dir>] [--at <ISO>]
 *   node scripts/unit-step.mjs <unit> --list [--dir <dir>]
 *   node scripts/unit-step.mjs --check <unit>
 *   node scripts/unit-step.mjs --where [<unit>] [--dir <dir>]
 *
 * options:
 *   --round <n>   the review or fix round the step belongs to (default 1)
 *   --dir <dir>   the steps directory (default: the [B] STEPS_DIR under the repository top; for --where,
 *                 relative to each worktree)
 *   --at <ISO>    the marker's time (default now), for a marker written late; never to invent one
 *   --list        print the unit's step intervals and anything out of order; append nothing
 *   --check       refuse unless this checkout is on the unit's branch; append nothing, read no steps file
 *   --where       list the worktrees on a unit's branch (any unit with a steps file there, without one)
 *                 with each one's last marker; exit 0 only for exactly one
 *
 * The file is `<dir>/<unit>.steps.jsonl`, one `{t, unit, step, event, round}` line per marker. A
 * marker out of order (a done with no open start, a repeated start) is appended anyway and warned
 * about on stderr: the file is evidence, and the runner never stops for a marker out of order. A
 * marker on the wrong branch is refused: a step outside the [B] MAIN_CHECKOUT_STEPS runs only on a
 * branch that names the unit (the branch is read in the current directory, not `--dir`), and the
 * refusal names the worktree that is on one. `--list` is never refused.
 *
 * exit: 0 ok, warnings included | 1 refused (the checkout is not the unit's, or --where found not
 * exactly one candidate) | 2 usage (bad arguments, unreadable or unwritable steps file).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAIN_CHECKOUT_STEPS,
  STEPS_DIR,
  UNIT_ID_SOURCE,
  branchCheck,
  branchMatchesUnit,
  checkNext,
  formatIntervals,
  label,
  parseArgs,
  parseSteps,
  parseWorktrees,
  stepIntervals,
  stepLine,
} from './lib/unit-step-core.mjs';

const USAGE =
  'usage: node scripts/unit-step.mjs <unit> <step> start|done [--round <n>] [--dir <dir>] [--at <ISO>] | <unit> --list [--dir <dir>] | --check <unit> | --where [<unit>] [--dir <dir>]';
const SUFFIX = '.steps.jsonl';
const UNIT_ID = new RegExp(`^${UNIT_ID_SOURCE}$`);

function usage(msg) {
  process.stderr.write(`unit-step: ${msg}\n${USAGE}\n`);
  process.exitCode = 2;
}

/** `git <args>` in the current directory: its stdout, or null when git fails or is missing. */
function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function repoTop() {
  return git('rev-parse', '--show-toplevel')?.trim() || process.cwd();
}

/** The current branch; `HEAD` when detached, null outside a git checkout. */
function currentBranch() {
  return git('rev-parse', '--abbrev-ref', 'HEAD')?.trim() || null;
}

const worktrees = () => parseWorktrees(git('worktree', 'list', '--porcelain') ?? '');

function readSteps(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw new Error(`cannot read ${file}: ${e.code ?? e.message}`, { cause: e });
  }
}

/** Prints the refusal and where the unit's checkout is; exit 1. */
function refuse(unit, reason) {
  const lines = [`unit-step: refused: ${reason}`];
  const own = worktrees().filter((w) => w.branch !== null && branchMatchesUnit(w.branch, unit));
  for (const w of own) lines.push(`unit-step: the unit's checkout: cd ${w.path}`);
  if (own.length === 0) lines.push(`unit-step: no worktree is on a branch for ${unit}`);
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exitCode = 1;
}

/** The branch check for `step` (null for --check): `{ ok, branch }`, the refusal or the warning already printed. */
function branchGate(unit, step) {
  if (step !== null && MAIN_CHECKOUT_STEPS.includes(step)) return { ok: true, branch: null };
  const branch = currentBranch();
  const verdict = branchCheck({ unit, step, branch });
  if (!verdict.ok) {
    refuse(unit, verdict.reason);
    return { ok: false, branch };
  }
  if (branch === null) process.stderr.write('unit-step: warning: not in a git checkout, branch not checked\n');
  else if (branch === 'HEAD') process.stderr.write('unit-step: warning: detached HEAD, branch not checked\n');
  return { ok: true, branch };
}

/** The unit ids with a steps file in `dir`, one level down included (`harness/<slug>`). */
function stepsUnits(dir) {
  const units = [];
  const files = (d) => {
    try {
      return fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const e of files(dir)) {
    if (e.isFile() && e.name.endsWith(SUFFIX)) units.push(e.name.slice(0, -SUFFIX.length));
    else if (e.isDirectory()) {
      for (const s of files(path.join(dir, e.name))) {
        if (s.isFile() && s.name.endsWith(SUFFIX)) units.push(`${e.name}/${s.name.slice(0, -SUFFIX.length)}`);
      }
    }
  }
  return units.filter((u) => UNIT_ID.test(u)).sort();
}

/** `<step> r<round> <event> <t>` of the latest marker, or `no markers`. */
function lastMarker(markers) {
  const last = markers.reduce((best, m) => (best === null || m.ts >= best.ts ? m : best), null);
  return last === null ? 'no markers' : `${label(last)} ${last.event} ${last.t}`;
}

/** --where: every worktree on the unit's branch (without a unit, on the branch of a unit it has a steps file for). */
function where(unit, dirArg) {
  const candidates = [];
  for (const w of worktrees()) {
    if (w.branch === null) continue;
    const dir = path.resolve(w.path, dirArg ?? STEPS_DIR);
    for (const u of unit === null ? stepsUnits(dir) : [unit]) {
      if (branchMatchesUnit(w.branch, u)) candidates.push({ unit: u, branch: w.branch, path: w.path, file: path.join(dir, `${u}${SUFFIX}`) });
    }
  }
  const lines = [];
  try {
    for (const c of candidates) lines.push(`${c.unit} · ${c.branch} · ${c.path} · ${lastMarker(parseSteps(readSteps(c.file)))}`);
  } catch (e) {
    return usage(e.message);
  }
  if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
  if (candidates.length === 1) return;
  if (candidates.length === 0) {
    process.stderr.write(unit === null ? 'unit-step: no unit worktree found\n' : `unit-step: no worktree is on a branch for ${unit}\n`);
  } else {
    process.stderr.write(`unit-step: ${candidates.length} candidates: name the unit (/task-runner <unit>)\n`);
  }
  process.exitCode = 1;
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
  if (args.where) return where(args.unit, args.dir);
  if (args.check) {
    const gate = branchGate(args.unit, null);
    if (gate.ok) process.stdout.write(`unit-step: ${args.unit} on ${gate.branch ?? 'no branch'} (${repoTop()})\n`);
    return;
  }
  let file;
  let markers;
  try {
    const dir = args.dir ? path.resolve(args.dir) : path.join(repoTop(), STEPS_DIR);
    file = path.join(dir, `${args.unit}${SUFFIX}`);
    markers = parseSteps(readSteps(file));
  } catch (e) {
    return usage(e.message);
  }
  if (args.list) {
    process.stdout.write(formatIntervals(stepIntervals(markers, Date.now())));
    return;
  }
  if (!branchGate(args.unit, args.step).ok) return;
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
