#!/usr/bin/env node
// harness-bootstrap run-counted (generated YYYY-MM-DD). The command a counted test gate in
// scripts/run-gates.sh runs through. [M] mechanism (ships as-is): everything; the kinds and their
// rules live in scripts/lib/run-counted-core.mjs. The floors are the gates' own: --min in each line.
/**
 * Runs one test command and passes it only when the runner's own summary shows nothing failed,
 * skipped or left out, and at least `--min` passes.
 *
 *   node scripts/run-counted.mjs --kind <vitest|node|pytest|bun|playwright> --min <n> -- <cmd> [args…]
 *
 * bound in run-gates.sh as, for example:
 *
 *   gate_counted test always '^COUNTED vitest [1-9][0-9]* passed' 'node scripts/run-counted.mjs --kind vitest --min 412 -- pnpm -s --filter web test'
 *
 * 1. `<cmd> args…` runs without a shell; its stdout and stderr stream through unchanged. The run
 *    stops first (exit 1) when this process's `NODE_OPTIONS` names a `--test…` flag. On POSIX the
 *    command leads a process group of its own with stdin ignored: outside the terminal's
 *    foreground group a read of the tty would stop it, and a gate reads no input. A terminal
 *    Ctrl-C then reaches the command once, through this process, not twice.
 * 2. The stream its runner writes the summary to (stdout; bun's stderr) holds exactly one summary of
 *    `--kind`, which is read (the rules are in run-counted-core.mjs). A summary on the other stream
 *    alone is not read: the run fails closed.
 * 3. A newline, then the verdict lines, so `COUNTED` always starts a line of the gate's log.
 *
 * exit: 0 when the command exited 0 and its one summary has no failed, errors, skipped, todo,
 * flaky, interrupted, not-run, cancelled, filtered-out, deselected, xfailed or xpassed count, no
 * marker, no unknown counter, its totals add up, and passed >= --min; the last line is then exactly
 * `COUNTED <kind> <passed> passed (min <n>)`. 1 otherwise, one `run-counted: FAIL` line per reason.
 * 2 usage (`--min` missing, 0 or not an integer, an unknown kind, no command, a node command with
 * `--test-name-pattern`, `--test-skip-pattern`, `--test-only` or `--test-shard`). A SIGINT, SIGTERM
 * or SIGHUP sent to this process is forwarded to the command, which is still waited for; the run
 * then fails (`run-counted: FAIL interrupted by <SIG>`) and exits as a shell would report the
 * command: its own code when non-zero, else 128 + the number of the signal it died of (or of the
 * one forwarded), never 0. On POSIX the signal goes to the command's whole process group, so the
 * processes it started stop with it. Once the command has exited, a process it left holding its
 * pipes open is waited for at most STOP_GRACE_MS, and the run ends with what was read. A second
 * stop signal kills the command's group with SIGKILL (exit 137), and the verdict names the first.
 * A SIGKILL to this process cannot be forwarded, and the command's own group does not receive it:
 * the command runs on until a write to its closed pipes ends it, or to its end if it writes nothing.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { EXIT, SUMMARY_STREAM, nodeOptionsProblem, parseArgs, parseSummary, verdict } from './lib/run-counted-core.mjs';

const USAGE =
  'usage: node scripts/run-counted.mjs --kind <vitest|node|pytest|bun|playwright> --min <n> -- <cmd> [args...]';

function usage(msg) {
  process.stderr.write(`run-counted: ${msg}\n${USAGE}\n`);
  return EXIT.usage;
}

/** The signals a gate runner stops a run with: each goes on to the command, and the run fails. */
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'];
/** After a forwarded signal and the command's exit, how long its pipes may stay open. */
const STOP_GRACE_MS = 2000;
/** POSIX: the command leads its own process group, so a signal reaches what it started. */
const GROUP = process.platform !== 'win32';

/** Spawn without a shell, stream both outputs through, keep both for the parser, forward a stop signal. */
function run(cmd, args) {
  return new Promise((resolve) => {
    const out = [];
    const err = [];
    let settled = false;
    let interrupted = null;
    let exited = null;
    let grace = null;
    const child = spawn(cmd, args, { stdio: [GROUP ? 'ignore' : 'inherit', 'pipe', 'pipe'], detached: GROUP });
    const read = (code, signal) => ({ exitCode: code, signal, spawnError: null, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() });
    const signalCommand = (sig) => {
      try {
        if (!GROUP) throw new Error('no process group');
        process.kill(-child.pid, sig);
      } catch {
        child.kill(sig);
      }
    };
    // A command that exited may leave a process it started holding the pipes: `close` would never
    // come. After a forwarded signal, wait for it STOP_GRACE_MS past the exit, then end the read.
    const waitForClose = () => {
      if (!interrupted || !exited || grace) return;
      grace = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        if (!settled) settle(read(exited.code, exited.signal));
      }, STOP_GRACE_MS);
    };
    // Without a handler the signal ends this process at once and leaves the command running with
    // no reader. The first signal is the one reported; a second kills the command's group.
    const forward = (sig) => {
      if (interrupted) return signalCommand('SIGKILL');
      interrupted = sig;
      signalCommand(sig);
      waitForClose();
    };
    for (const sig of FORWARDED) process.on(sig, forward);
    const settle = (res) => {
      settled = true;
      clearTimeout(grace);
      for (const sig of FORWARDED) process.off(sig, forward);
      resolve({ ...res, interrupted });
    };
    child.stdout.on('data', (b) => {
      out.push(b);
      process.stdout.write(b);
    });
    child.stderr.on('data', (b) => {
      err.push(b);
      process.stderr.write(b);
    });
    child.on('error', (e) => {
      if (settled) return;
      settle({ exitCode: null, signal: null, spawnError: e.message, stdout: '', stderr: '' });
    });
    child.on('exit', (code, signal) => {
      exited = { code, signal };
      waitForClose();
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settle(read(code, signal));
    });
  });
}

async function main() {
  // Only what precedes a bare `--` is ours; the wrapped command keeps its own --help.
  const own = process.argv.slice(2);
  if (own.slice(0, own.includes('--') ? own.indexOf('--') : own.length).some((arg) => arg === '--help' || arg === '-h')) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  let a;
  try {
    a = parseArgs(process.argv.slice(2));
  } catch (e) {
    return usage(e.message);
  }
  const envProblem = nodeOptionsProblem(process.env);
  if (envProblem) {
    console.log(`run-counted: FAIL ${envProblem}`);
    return EXIT.failed;
  }
  const res = await run(a.cmd, a.args);
  const v = verdict({
    kind: a.kind,
    min: a.min,
    exitCode: res.exitCode,
    signal: res.signal,
    spawnError: res.spawnError,
    interrupted: res.interrupted,
    summary: res.spawnError ? null : parseSummary(a.kind, res[SUMMARY_STREAM[a.kind]]),
  });
  // The verdict starts a line of its own: the child's output (both land in the gate's one log)
  // may have ended without a newline.
  process.stdout.write('\n');
  for (const l of v.lines) console.log(l);
  if (res.interrupted) return res.exitCode || 128 + os.constants.signals[res.signal ?? res.interrupted];
  return v.ok ? EXIT.ok : EXIT.failed;
}

// Run only as the entry script; compare real paths (macOS /tmp is a symlink). The exit code is
// set, never forced: process.exit() can cut a pipe's pending output short.
function isEntry() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry())
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`run-counted: ${e.stack ?? e}\n`);
      process.exitCode = EXIT.failed;
    },
  );
