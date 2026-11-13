#!/usr/bin/env node
// harness-bootstrap admission (generated YYYY-MM-DD).
// [M] mechanism (ships as-is): everything. The [B] bindings (the floors, the wait, the command a refusal
// names) live at the top of scripts/lib/admission-core.mjs.
/**
 * run-gates.sh runs it before a verify's gates, after the cache check and before the lock and the snapshot:
 *
 *   node scripts/lib/admission.mjs [--mem-gb <n>] [--disk-gb <n>] [--load-per-cpu <n>] [--wait <s>]
 *                                  [--poll <s>] [--top <dir>] [--reading <file>]
 *
 * options (numbers of 0 or more, fractions allowed):
 *   --mem-gb <n>        memory available the run needs, GB (default MEM_RESERVE_GB)
 *   --disk-gb <n>       free disk under which no run starts, GB (default DISK_FLOOR_GB)
 *   --load-per-cpu <n>  the 1-minute load ceiling per CPU (default LOAD_PER_CPU)
 *   --wait <s>          how long to wait for the machine before refusing (default WAIT_S)
 *   --poll <s>          how often to read it while waiting (default POLL_S)
 *   --top <dir>         the directory whose file system the disk floor reads (default the cwd)
 *   --reading <file>    the test seam: a JSON reading { mem, disk, load, cpus } (bytes, bytes, load, CPUs; a
 *                       null is unread), or a list of them, one per read, the last repeated; the machine is
 *                       not read
 *
 * It prints on stdout: `ADMISSION unread <what>` once for a reading it could not read (admitted on the
 * rest); after a wait, `MACHINE WAIT <ISO> → <ISO> <reason>`; then `ADMISSION admitted — <readings>` or
 * `NOT ADMITTED <reason>; free: <command>`. On stderr, once, at the first short reading: `ADMISSION waiting
 * <reason>`. SIGTERM or SIGINT during a wait ends it with the pair, `<reason> (interrupted)`, so the wait
 * is not lost from the record. The wait limit is on the monotonic clock; the pair's times are wall-clock.
 * It reads sysctl, /proc/meminfo, statfs and the load average and writes nothing; it starts nothing.
 *
 * exit: 0 admitted | 1 not admitted at the wait limit | 2 usage | 128 + the signal (143 SIGTERM, 130
 * SIGINT) interrupted.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { EXIT, admit, parseArgs, readMachine } from './admission-core.mjs';

const USAGE =
  'usage: node scripts/lib/admission.mjs [--mem-gb <n>] [--disk-gb <n>] [--load-per-cpu <n>] [--wait <s>] [--poll <s>] [--top <dir>] [--reading <file>]';

function usage(msg) {
  process.stderr.write(`admission: ${msg}\n${USAGE}\n`);
  process.exitCode = EXIT.usage;
}

/** The --reading file as a reader: each call gives the next reading, the last repeated. Throws on a bad file. */
function seam(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length === 0 || !list.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
    throw new Error(`${file} holds no reading object`);
  }
  let i = 0;
  return () => list[Math.min(i++, list.length - 1)];
}

const sysctl = (name) => execFileSync('sysctl', ['-n', name], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });

async function main() {
  let a;
  let read;
  try {
    a = parseArgs(process.argv.slice(2));
    read = a.reading
      ? seam(a.reading)
      : () =>
          readMachine({
            platform: process.platform,
            sysctl,
            readFile: (p) => fs.readFileSync(p, 'utf8'),
            statfs: (p) => fs.statfsSync(p),
            loadavg: () => os.loadavg(),
            cpus: () => os.availableParallelism(),
            top: a.top ?? process.cwd(),
          });
  } catch (e) {
    usage(e.message);
    return;
  }
  // A signal ends the wait through the abort: admit() writes the closing pair, then the exit is the signal's.
  const ac = new AbortController();
  let caught = null;
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      caught ??= sig;
      ac.abort(sig);
    });
  }
  const code = await admit({
    read,
    now: () => Date.now(),
    clock: () => performance.now(),
    sleep: (ms, signal) => delay(ms, undefined, { signal }),
    write: (line) => process.stdout.write(`${line}\n`),
    note: (line) => process.stderr.write(`${line}\n`),
    signal: ac.signal,
    floors: { mem: a.mem, disk: a.disk, load: a.load },
    waitS: a.wait,
    pollS: a.poll,
  });
  process.exitCode = code === EXIT.interrupted ? 128 + os.constants.signals[caught] : code;
}

await main();
