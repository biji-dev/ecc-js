// harness-bootstrap admission tests (generated YYYY-MM-DD). Run: node --test scripts/lib/admission-core.test.mjs
// [M] mechanism (ships as-is): everything except the "bindings" test, which pins the [B] block of
// admission-core.mjs and moves with it. The core is driven with injected readers and a fake clock, so the
// 60-minute bound runs in milliseconds; the CLI runs over a `--reading` file (the test seam) and, twice, over
// the real machine with floors no machine misses or meets.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DISK_FLOOR_GB,
  EXIT,
  FLOORS,
  FREE_COMMAND,
  LOAD_PER_CPU,
  MEM_RESERVE_GB,
  POLL_S,
  WAIT_S,
  admit,
  darwinMem,
  decide,
  diskFree,
  formatRefusal,
  formatWait,
  linuxMem,
  parseArgs,
  readMachine,
} from './admission-core.mjs';
import { parseOwnerWait } from './unit-record-core.mjs';

const CLI = fileURLToPath(new URL('./admission.mjs', import.meta.url));
const T0 = Date.parse('2026-01-15T10:00:00Z');
const F = { mem: 4, disk: 5, load: 3 };
const OK = { mem: 9e9, disk: 20e9, load: 5, cpus: 10 };
const SHORT = { ...OK, mem: 3.9e9 };
const MIN = 60_000;

const tempDirs = [];
function tmpDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'admission-')));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * admit() over a fake clock: `readings` is a list (the last repeats) or a function of the elapsed ms. Sleep
 * advances the monotonic clock by what it was asked, and the wall clock by that plus `wallJump(n)` on the
 * n-th sleep (a clock step); a loop that reads 10,000 times is a runaway, never a pass. `notes` are the
 * stderr lines.
 */
async function fakeRun(readings, opts = {}) {
  const { wallJump = () => 0, ...rest } = opts;
  let t = T0;
  let wall = T0;
  let reads = 0;
  const lines = [];
  const notes = [];
  const sleeps = [];
  const read = () => {
    reads += 1;
    if (reads > 10_000) throw new Error('runaway: 10,000 reads');
    return typeof readings === 'function' ? readings(t - T0) : readings[Math.min(reads - 1, readings.length - 1)];
  };
  const code = await admit({
    read,
    now: () => wall,
    clock: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
      wall += ms + wallJump(sleeps.length);
    },
    write: (l) => lines.push(l),
    note: (l) => notes.push(l),
    ...rest,
  });
  return { code, lines, notes, sleeps, reads, elapsed: t - T0 };
}

const waits = (lines) => lines.filter((l) => l.startsWith('MACHINE WAIT '));

// ---- the bindings

test('the bindings: a 4 GB memory reserve, a 5 GB disk floor, load 3.0 per CPU, a 60-minute wait at 30 s polls', () => {
  assert.equal(MEM_RESERVE_GB, 4);
  assert.equal(DISK_FLOOR_GB, 5);
  assert.equal(LOAD_PER_CPU, 3);
  assert.equal(WAIT_S, 3600);
  assert.equal(POLL_S, 30);
  assert.deepEqual(FLOORS, { mem: 4, disk: 5, load: 3 });
  assert.deepEqual(EXIT, { admitted: 0, refused: 1, usage: 2, interrupted: 3 });
  assert.equal(FREE_COMMAND, 'node ~/.agents/harness/machine-sweep/machine-sweep.mjs --report');
});

// ---- decide: each floor at, just above and just below its threshold

test('memory: 3.9e9 is short, exactly 4e9 is admitted, one byte under is short, just above is admitted (GB is 1e9)', () => {
  const at = (mem) => decide({ ...OK, mem }, F);
  assert.deepEqual(at(3.9e9).short, ['memory']);
  assert.equal(at(3.9e9).ok, false);
  assert.equal(at(3.9e9).reason, 'memory 3.9 GB available < 4');
  assert.equal(at(4e9).ok, true);
  assert.deepEqual(at(4e9).short, []);
  assert.equal(at(4e9 - 1).ok, false);
  assert.equal(at(4e9 + 1).ok, true);
  assert.equal(at(4.1e9).ok, true);
});

test('disk: 4.9e9 is refused, exactly 5e9 is admitted, one byte under is short, just above is admitted', () => {
  const at = (disk) => decide({ ...OK, disk }, F);
  assert.deepEqual(at(4.9e9).short, ['disk']);
  assert.equal(at(4.9e9).reason, 'disk 4.9 GB free < 5');
  assert.equal(at(5e9).ok, true);
  assert.equal(at(5e9 - 1).ok, false);
  assert.equal(at(5e9 + 1).ok, true);
});

test('load: on 10 CPUs 30.1 is refused, exactly 30 is admitted, 29.9 is admitted; the ceiling scales with the CPUs', () => {
  const at = (load, cpus = 10) => decide({ ...OK, load, cpus }, F);
  assert.deepEqual(at(30.1).short, ['load']);
  assert.equal(at(30.1).reason, 'load 30.1 > 30');
  assert.equal(at(30).ok, true);
  assert.equal(at(29.9).ok, true);
  assert.equal(at(30.1, 11).ok, true, '3.0 x 11 CPUs is 33');
  assert.equal(at(3.1, 1).ok, false, '3.0 x 1 CPU is 3');
  assert.equal(at(3, 1).ok, true);
  const frac = (load) => decide({ ...OK, load, cpus: 3 }, { ...F, load: 2.5 });
  assert.equal(frac(7.5).ok, true, '2.5 x 3 CPUs is 7.5, not rounded');
  assert.equal(frac(7.6).ok, false);
  assert.equal(frac(7.6).reason, 'load 7.6 > 7.5');
});

test('a null floor turns its check off; the load check can be turned off; a floor of 0 is a check', () => {
  assert.equal(decide({ ...OK, load: 500 }, { ...F, load: null }).ok, true);
  assert.equal(decide({ ...OK, load: 0.5 }, { ...F, load: 0 }).ok, false, 'a load ceiling of 0 admits only an idle machine');
  assert.equal(decide({ ...OK, load: 0 }, { ...F, load: 0 }).ok, true);
  assert.equal(decide({ ...OK, mem: 0 }, { ...F, mem: 0 }).detail.startsWith('memory 0.0 GB available ≥ 0;'), true);
  assert.equal(decide({ ...OK, mem: 1 }, { ...F, mem: null }).ok, true);
  assert.equal(decide({ ...OK, disk: 1 }, { ...F, disk: null }).ok, true);
});

test('the default floors are the bindings, at their thresholds', () => {
  assert.equal(decide({ ...OK, mem: 4e9 }).ok, true);
  assert.equal(decide({ ...OK, mem: 4e9 - 1 }).ok, false);
  assert.equal(decide({ ...OK, disk: 5e9 }).ok, true);
  assert.equal(decide({ ...OK, disk: 5e9 - 1 }).ok, false);
  assert.equal(decide({ ...OK, load: 30 }).ok, true);
  assert.equal(decide({ ...OK, load: 30.01 }).ok, false);
});

test('every short reading is named, memory, disk, load, in one reason; the readings read are listed in detail', () => {
  const d = decide({ mem: 3.9e9, disk: 20e9, load: 41, cpus: 10 }, F);
  assert.equal(d.ok, false);
  assert.deepEqual(d.short, ['memory', 'load']);
  assert.equal(d.reason, 'memory 3.9 GB available < 4; load 41.0 > 30');
  const all = decide({ mem: 1e9, disk: 2e9, load: 99, cpus: 10 }, F);
  assert.deepEqual(all.short, ['memory', 'disk', 'load']);
  assert.equal(decide(OK, F).detail, 'memory 9.0 GB available ≥ 4; disk 20.0 GB free ≥ 5; load 5.0 ≤ 30');
  assert.equal(decide(OK, F).reason, '');
});

test('an unread reading is admitted and noted; a reading under its floor never admits beside it', () => {
  const memUnread = decide({ ...OK, mem: null }, F);
  assert.equal(memUnread.ok, true);
  assert.deepEqual(memUnread.unread, ['memory']);
  const cpusUnread = decide({ ...OK, load: 500, cpus: null }, F);
  assert.equal(cpusUnread.ok, true);
  assert.deepEqual(cpusUnread.unread, ['load']);
  for (const bad of [undefined, NaN, -1, Infinity, '5']) assert.deepEqual(decide({ ...OK, disk: bad }, F).unread, ['disk'], String(bad));
  assert.deepEqual(decide({ ...OK, cpus: 0 }, F).unread, ['load']);
  const mixed = decide({ ...OK, mem: null, disk: 4.9e9 }, F);
  assert.equal(mixed.ok, false);
  assert.deepEqual(mixed.short, ['disk']);
  assert.deepEqual(decide({}, F), { ok: true, short: [], unread: ['memory', 'disk', 'load'], reason: '', detail: '' });
});

// ---- the readers

test('darwin memory is kern.memorystatus_level % x hw.memsize: 54 of 17179869184 is 9.28e9', () => {
  assert.equal(darwinMem('54\n', '17179869184\n'), (54 * 17179869184) / 100);
  assert.ok(Math.abs(darwinMem('54', '17179869184') - 9.28e9) < 0.005e9);
  assert.equal(darwinMem('100', '16000000000'), 16e9);
  assert.equal(darwinMem('0', '16000000000'), 0, 'level 0 is a reading, under every floor');
  for (const [level, size] of [['', '1'], ['abc', '1'], ['101', '1'], ['-1', '1'], ['5.5x', '1'], ['54', ''], ['54', '0'], ['54', 'x'], [null, '1'], ['54', undefined]]) {
    assert.equal(darwinMem(level, size), null, `${level} / ${size}`);
  }
});

test('linux memory is MemAvailable in kB x 1024; no MemAvailable line is unread', () => {
  const info = 'MemTotal:       16000000 kB\nMemFree:          100000 kB\nMemAvailable:    8000000 kB\nBuffers: 1 kB\n';
  assert.equal(linuxMem(info), 8000000 * 1024);
  assert.equal(linuxMem('MemTotal: 1 kB\nMemFree: 2 kB\n'), null);
  assert.equal(linuxMem(''), null);
  assert.equal(linuxMem(null), null);
});

test('free disk is bavail x bsize; a statfs without them is unread', () => {
  assert.equal(diskFree({ bavail: 1000, bsize: 4096, bfree: 99999 }), 4096000);
  assert.equal(diskFree({ bavail: 0, bsize: 4096 }), 0);
  for (const s of [null, {}, { bavail: 1 }, { bsize: 1 }, { bavail: -1, bsize: 1 }, { bavail: NaN, bsize: 1 }]) assert.equal(diskFree(s), null, JSON.stringify(s));
});

/** readMachine's injected readers, recording what each was asked. */
function machine(over = {}) {
  const asked = [];
  const deps = {
    platform: 'darwin',
    top: '/the/top',
    sysctl: (name) => {
      asked.push(['sysctl', name]);
      return { 'kern.memorystatus_level': '54\n', 'hw.memsize': '17179869184\n' }[name];
    },
    readFile: (p) => {
      asked.push(['readFile', p]);
      return 'MemAvailable:    8000000 kB\n';
    },
    statfs: (p) => {
      asked.push(['statfs', p]);
      return { bavail: 2_500_000, bsize: 4096 };
    },
    loadavg: () => [5.5, 50, 500],
    cpus: () => 10,
    ...over,
  };
  return { reading: readMachine(deps), asked };
}

test('readMachine on darwin: the sysctl pair, statfs of the top, the 1-minute load and the CPU count', () => {
  const { reading, asked } = machine();
  assert.deepEqual(reading, { mem: (54 * 17179869184) / 100, disk: 2_500_000 * 4096, load: 5.5, cpus: 10 });
  assert.deepEqual(asked, [['sysctl', 'kern.memorystatus_level'], ['sysctl', 'hw.memsize'], ['statfs', '/the/top']]);
});

test('readMachine on linux reads /proc/meminfo; another platform has no memory reading', () => {
  const linux = machine({ platform: 'linux' });
  assert.equal(linux.reading.mem, 8000000 * 1024);
  assert.deepEqual(linux.asked[0], ['readFile', '/proc/meminfo']);
  assert.equal(machine({ platform: 'win32' }).reading.mem, null);
});

test('readMachine: an unreadable sysctl, statfs, loadavg or CPU count is null, never a throw', () => {
  const boom = () => {
    throw new Error('ENOENT');
  };
  assert.equal(machine({ sysctl: boom }).reading.mem, null);
  assert.equal(machine({ sysctl: () => 'garbage' }).reading.mem, null);
  assert.equal(machine({ statfs: boom }).reading.disk, null);
  assert.equal(machine({ loadavg: boom }).reading.load, null);
  assert.equal(machine({ loadavg: () => [] }).reading.load, null);
  assert.equal(machine({ cpus: boom }).reading.cpus, null);
  const d = decide(machine({ sysctl: boom }).reading, F);
  assert.equal(d.ok, true);
  assert.deepEqual(d.unread, ['memory']);
});

// ---- the output pair

test('formatWait is `MACHINE WAIT <ISO> → <ISO> <reason>`, a pair the unit record reads as its wait span', () => {
  const line = formatWait(T0, T0 + 90_000, 'memory 3.9 GB available < 4');
  assert.equal(line, 'MACHINE WAIT 2026-01-15T10:00:00Z → 2026-01-15T10:01:30Z memory 3.9 GB available < 4');
  const parsed = parseOwnerWait(line, '2026-01-15T11:00:00Z');
  assert.deepEqual(parsed, { ms: 90_000, pairs: true, waiting: false });
});

test('formatRefusal names the reason and the read-only sweep report', () => {
  assert.equal(formatRefusal('disk 4.9 GB free < 5'), 'NOT ADMITTED disk 4.9 GB free < 5; free: node ~/.agents/harness/machine-sweep/machine-sweep.mjs --report');
});

// ---- admit: the loop, on a fake clock

test('admitted at once: no wait line, no sleep, one admitted line', async () => {
  const r = await fakeRun([OK], { floors: F });
  assert.equal(r.code, EXIT.admitted);
  assert.equal(r.reads, 1);
  assert.deepEqual(r.sleeps, []);
  assert.deepEqual(r.lines, ['ADMISSION admitted — memory 9.0 GB available ≥ 4; disk 20.0 GB free ≥ 5; load 5.0 ≤ 30']);
});

test('short, short, ok: admitted with one MACHINE WAIT pair over the wait, at the poll interval', async () => {
  const r = await fakeRun([SHORT, { ...SHORT, mem: 3.5e9 }, OK], { floors: F, pollS: 30 });
  assert.equal(r.code, EXIT.admitted);
  assert.deepEqual(r.sleeps, [30_000, 30_000]);
  assert.deepEqual(waits(r.lines), ['MACHINE WAIT 2026-01-15T10:00:00Z → 2026-01-15T10:01:00Z memory 3.5 GB available < 4']);
  assert.equal(r.lines.length, 2);
  assert.match(r.lines[1], /^ADMISSION admitted — /);
});

test('never admitted: refused at exactly 60 minutes, by the defaults, with the pair and NOT ADMITTED', async () => {
  const r = await fakeRun([SHORT], { floors: F });
  assert.equal(r.code, EXIT.refused);
  assert.equal(r.elapsed, 60 * MIN);
  assert.equal(r.reads, 121, 'a read at 0, every 30 s, and one at the bound');
  assert.ok(r.sleeps.every((ms) => ms === 30_000));
  assert.deepEqual(r.lines, [
    'MACHINE WAIT 2026-01-15T10:00:00Z → 2026-01-15T11:00:00Z memory 3.9 GB available < 4',
    'NOT ADMITTED memory 3.9 GB available < 4; free: node ~/.agents/harness/machine-sweep/machine-sweep.mjs --report',
  ]);
});

test('the bound: ok on the read at 60 minutes is admitted; ok only after it is never reached', async () => {
  const at = await fakeRun((ms) => (ms >= 60 * MIN ? OK : SHORT), { floors: F });
  assert.equal(at.code, EXIT.admitted);
  assert.equal(at.elapsed, 60 * MIN);
  assert.deepEqual(waits(at.lines), ['MACHINE WAIT 2026-01-15T10:00:00Z → 2026-01-15T11:00:00Z memory 3.9 GB available < 4']);
  const after = await fakeRun((ms) => (ms > 60 * MIN ? OK : SHORT), { floors: F });
  assert.equal(after.code, EXIT.refused);
  assert.equal(after.elapsed, 60 * MIN);
  const before = await fakeRun((ms) => (ms >= 59.5 * MIN ? OK : SHORT), { floors: F });
  assert.equal(before.code, EXIT.admitted);
  assert.equal(before.elapsed, 59.5 * MIN);
});

test('the last sleep is cut to the bound: --wait 45 at 30 s polls reads at 0, 30 and 45 s', async () => {
  const r = await fakeRun([SHORT], { floors: F, waitS: 45, pollS: 30 });
  assert.equal(r.code, EXIT.refused);
  assert.deepEqual(r.sleeps, [30_000, 15_000]);
  assert.equal(r.elapsed, 45_000);
  const zero = await fakeRun([SHORT], { floors: F, waitS: 0 });
  assert.equal(zero.code, EXIT.refused);
  assert.equal(zero.reads, 1);
  assert.deepEqual(waits(zero.lines), ['MACHINE WAIT 2026-01-15T10:00:00Z → 2026-01-15T10:00:00Z memory 3.9 GB available < 4']);
});

test('an unread reading is noted once, `ADMISSION unread <what>`, and the run is admitted on the rest', async () => {
  const r = await fakeRun([{ ...SHORT, cpus: null }, { ...OK, cpus: null }], { floors: F, pollS: 1 });
  assert.equal(r.code, EXIT.admitted);
  assert.equal(r.lines.filter((l) => l === 'ADMISSION unread load').length, 1);
  assert.equal(r.lines[0], 'ADMISSION unread load');
  const none = await fakeRun([{}], { floors: F });
  assert.equal(none.code, EXIT.admitted);
  assert.deepEqual(none.lines, ['ADMISSION unread memory', 'ADMISSION unread disk', 'ADMISSION unread load', 'ADMISSION admitted — nothing read']);
});

test('the bound is on the monotonic clock: a wall clock stepped back an hour during a sleep still refuses at 60 minutes, and the pair spans them', async () => {
  const r = await fakeRun([SHORT], { floors: F, wallJump: (n) => (n === 1 ? -60 * MIN : 0) });
  assert.equal(r.code, EXIT.refused);
  assert.equal(r.elapsed, 60 * MIN, 'the wait ran past its 60-minute bound');
  assert.equal(r.reads, 121);
  // The pair starts at the wall time of the first short read and spans the monotonic wait: 60 minutes, never 0 or 120.
  assert.deepEqual(waits(r.lines), ['MACHINE WAIT 2026-01-15T10:00:00Z → 2026-01-15T11:00:00Z memory 3.9 GB available < 4']);
  const fwd = await fakeRun([SHORT], { floors: F, wallJump: (n) => (n === 1 ? 60 * MIN : 0) });
  assert.equal(fwd.elapsed, 60 * MIN, 'a wall clock stepped forward cut the wait short');
  assert.deepEqual(waits(fwd.lines), ['MACHINE WAIT 2026-01-15T10:00:00Z → 2026-01-15T11:00:00Z memory 3.9 GB available < 4']);
});

test('the first short reading notes `ADMISSION waiting <reason>` once, on the note channel, never on stdout', async () => {
  const r = await fakeRun([SHORT, { ...SHORT, mem: 3.5e9 }, OK], { floors: F, pollS: 30 });
  assert.deepEqual(r.notes, ['ADMISSION waiting memory 3.9 GB available < 4']);
  assert.ok(!r.lines.some((l) => l.startsWith('ADMISSION waiting')), r.lines.join('\n'));
  const once = await fakeRun([OK], { floors: F });
  assert.deepEqual(once.notes, [], 'admitted at once is no wait');
});

test('aborted during a sleep, admit writes the closing pair (interrupted) up to the abort and returns EXIT.interrupted', async () => {
  const ac = new AbortController();
  let t = T0;
  const lines = [];
  const code = await admit({
    read: () => SHORT,
    now: () => t,
    clock: () => t,
    sleep: async (ms, signal) => {
      assert.equal(signal, ac.signal, 'the sleep is not given the signal, so an abort cannot cut it short');
      t += 30 * MIN;
      ac.abort('SIGTERM');
      throw signal.reason;
    },
    write: (l) => lines.push(l),
    floors: F,
    signal: ac.signal,
  });
  assert.equal(code, EXIT.interrupted);
  assert.deepEqual(lines, ['MACHINE WAIT 2026-01-15T10:00:00Z → 2026-01-15T10:30:00Z memory 3.9 GB available < 4 (interrupted)']);
  assert.equal(parseOwnerWait(lines[0], '2026-01-15T11:00:00Z').ms, 30 * MIN, 'the unit record reads the 30 minutes');
  // A sleep that resolves although the signal was aborted meanwhile ends the wait too.
  const ac2 = new AbortController();
  let t2 = T0;
  const lines2 = [];
  const code2 = await admit({
    read: () => SHORT,
    now: () => t2,
    clock: () => t2,
    sleep: async () => {
      t2 += MIN;
      ac2.abort('SIGINT');
    },
    write: (l) => lines2.push(l),
    floors: F,
    signal: ac2.signal,
  });
  assert.equal(code2, EXIT.interrupted);
  assert.deepEqual(lines2, ['MACHINE WAIT 2026-01-15T10:00:00Z → 2026-01-15T10:01:00Z memory 3.9 GB available < 4 (interrupted)']);
  // A sleep that fails for another reason is not an interrupt.
  await assert.rejects(
    admit({ read: () => SHORT, now: () => T0, clock: () => T0, sleep: async () => { throw new Error('boom'); }, write: () => {}, floors: F, signal: new AbortController().signal }),
    /boom/,
  );
});

// ---- parseArgs

test('parseArgs: the defaults are the bindings; each flag reads a number of 0 or more, or a path', () => {
  assert.deepEqual(parseArgs([]), { mem: 4, disk: 5, load: 3, wait: 3600, poll: 30, top: null, reading: null });
  assert.deepEqual(parseArgs(['--mem-gb', '999', '--disk-gb', '0', '--load-per-cpu', '2.5', '--wait', '5', '--poll', '0.2', '--top', '/x', '--reading', 'r.json']), {
    mem: 999,
    disk: 0,
    load: 2.5,
    wait: 5,
    poll: 0.2,
    top: '/x',
    reading: 'r.json',
  });
  for (const argv of [['--bogus'], ['stray'], ['--wait'], ['--wait', '--poll', '1'], ['--wait', 'abc'], ['--wait', '-1'], ['--mem-gb', ''], ['--mem-gb', '1e3'], ['--top', ''], ['--wait', '1', '--wait', '2']]) {
    assert.throws(() => parseArgs(argv), Error, JSON.stringify(argv));
  }
});

// ---- the CLI

function cli(args, readings) {
  const dir = tmpDir();
  const file = path.join(dir, 'reading.json');
  if (readings !== undefined) fs.writeFileSync(file, JSON.stringify(readings));
  return spawnSync(process.execPath, [CLI, ...(readings !== undefined ? ['--reading', file] : []), ...args], { encoding: 'utf8', timeout: 30_000 });
}
const ISO = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z`;

test('CLI over a --reading sequence short, short, ok: exit 0, one MACHINE WAIT line, then admitted', () => {
  const r = cli(['--poll', '0'], [SHORT, SHORT, OK]);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 2, r.stdout);
  assert.match(lines[0], new RegExp(`^MACHINE WAIT ${ISO} → ${ISO} memory 3\\.9 GB available < 4$`));
  assert.match(lines[1], /^ADMISSION admitted — memory 9\.0 GB available ≥ 4; disk 20\.0 GB free ≥ 5; load 5\.0 ≤ 30$/);
});

test('CLI always short with --wait 1: exit 1, the pair, then NOT ADMITTED', () => {
  const r = cli(['--wait', '1', '--poll', '0.2'], [{ ...OK, disk: 4.9e9 }]);
  assert.equal(r.status, 1, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 2, r.stdout);
  assert.match(lines[0], new RegExp(`^MACHINE WAIT ${ISO} → ${ISO} disk 4\\.9 GB free < 5$`));
  assert.equal(lines[1], `NOT ADMITTED disk 4.9 GB free < 5; free: ${FREE_COMMAND}`);
});

test('CLI --poll sets the read interval: short, short, short, ok at --poll 0.1 is admitted well inside --wait 10', () => {
  const r = cli(['--wait', '10', '--poll', '0.1'], [SHORT, SHORT, SHORT, OK]);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(waits(r.stdout.trim().split('\n')).length, 1);
});

test('CLI floors come from the flags: --mem-gb, --disk-gb and --load-per-cpu move each threshold', () => {
  const reading = [{ mem: 3e9, disk: 3e9, load: 15, cpus: 10 }];
  assert.equal(cli(['--wait', '0'], reading).status, 1);
  assert.equal(cli(['--wait', '0', '--mem-gb', '3', '--disk-gb', '3', '--load-per-cpu', '1.5'], reading).status, 0);
  assert.equal(cli(['--wait', '0', '--mem-gb', '3.1', '--disk-gb', '3', '--load-per-cpu', '1.5'], reading).status, 1);
  assert.equal(cli(['--wait', '0', '--mem-gb', '3', '--disk-gb', '3.1', '--load-per-cpu', '1.5'], reading).status, 1);
  assert.equal(cli(['--wait', '0', '--mem-gb', '3', '--disk-gb', '3', '--load-per-cpu', '1.4'], reading).status, 1);
});

test('CLI usage errors exit 2 and print the usage: a bad flag, a bad number, an unreadable or malformed --reading', () => {
  for (const [args, readings] of [[['--bogus']], [['--wait', 'abc']], [['--reading', '/no/such/file.json']], [['--wait', '0'], 'not an object'], [['--wait', '0'], []]]) {
    const r = cli(args, readings);
    assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /usage: node scripts\/lib\/admission\.mjs/);
    assert.equal(r.stdout, '');
  }
});

test('CLI on the real machine: disk and load are read, a missing --top is unread disk, and --mem-gb 999 decides by the memory it read', () => {
  // The values are the machine's and move; only their presence, the format, the CPU ceiling and the exit the
  // printed reading gives are checked, never a value. A memory that cannot be read (sysctl failing or slow) is
  // the approved unread fallback: it admits.
  const top = tmpDir();
  const admitted = cli(['--mem-gb', '0', '--disk-gb', '0', '--load-per-cpu', '100000', '--wait', '0', '--top', top]);
  assert.equal(admitted.status, 0, admitted.stderr);
  assert.doesNotMatch(admitted.stdout, /^ADMISSION unread (disk|load)$/m, admitted.stdout);
  const memUnread = /^ADMISSION unread memory$/m.test(admitted.stdout);
  const m = /^ADMISSION admitted — (memory \d+\.\d GB available ≥ 0; )?disk \d+\.\d GB free ≥ 0; load \d+\.\d ≤ (\d+)$/m.exec(admitted.stdout);
  assert.ok(m, admitted.stdout);
  assert.equal(m[1] === undefined, memUnread, `memory is in the admitted line exactly when it was read: ${admitted.stdout}`);
  assert.equal(Number(m[2]), 100000 * os.availableParallelism());
  const missing = cli(['--mem-gb', '0', '--disk-gb', '0', '--load-per-cpu', '100000', '--wait', '0', '--top', path.join(top, 'no-such-dir')]);
  assert.equal(missing.status, 0, missing.stderr);
  assert.match(missing.stdout, /^ADMISSION unread disk$/m, 'statfs of the --top given, not the cwd');
  // The memory floor is the only one that can refuse here, so the exit follows from the memory line printed.
  const r = cli(['--mem-gb', '999', '--disk-gb', '0', '--load-per-cpu', '100000', '--wait', '0', '--top', tmpDir()]);
  const out = r.stdout + r.stderr;
  if (/^ADMISSION unread memory$/m.test(r.stdout)) {
    assert.equal(r.status, 0, `an unread memory admits: ${out}`);
    assert.match(r.stdout, /^ADMISSION admitted — disk /m, out);
    return;
  }
  const ok = /^ADMISSION admitted — memory (\d+\.\d) GB available ≥ 999; /m.exec(r.stdout);
  const short = /^NOT ADMITTED memory (\d+\.\d) GB available < 999; free: /m.exec(r.stdout);
  assert.ok(Boolean(ok) !== Boolean(short), `exactly one of admitted or refused on memory: ${out}`);
  if (ok) {
    assert.equal(r.status, 0, out);
    assert.ok(Number(ok[1]) >= 998.95, out); // printed to one decimal
  } else {
    assert.equal(r.status, 1, out);
    assert.ok(Number(short[1]) <= 999.05, out);
  }
});

test('CLI: the bound is monotonic — with Date.now stepping back an hour on every call, --wait 1 still refuses in about a second', () => {
  const dir = tmpDir();
  const stub = path.join(dir, 'clock-back.mjs');
  fs.writeFileSync(stub, 'const real = Date.now;\nlet n = 0;\nDate.now = () => real() - 3_600_000 * n++;\n');
  const file = path.join(dir, 'reading.json');
  fs.writeFileSync(file, JSON.stringify([SHORT]));
  const t = performance.now();
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, CLI, '--reading', file, '--wait', '1', '--poll', '0.2'], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(r.status, 1, `not refused at the bound (status ${r.status}, signal ${r.signal}): ${r.stdout}${r.stderr}`);
  assert.ok(performance.now() - t < 10_000, 'the wait ran far past --wait 1');
  const pair = waits(r.stdout.trim().split('\n'))[0] ?? '';
  const span = parseOwnerWait(pair, new Date(8.64e15).toISOString());
  assert.ok(span && span.ms >= 0 && span.ms <= 5_000, `the pair does not span the ~1 s wait: ${pair}`);
});

/** The CLI in the background over a --reading file: { child, out(), err(), exited } (exited resolves to { code, signal }). */
function cliBackground(args, readings) {
  const file = path.join(tmpDir(), 'reading.json');
  fs.writeFileSync(file, JSON.stringify(readings));
  const child = spawn(process.execPath, [CLI, '--reading', file, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const exited = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  return { child, out: () => out, err: () => err, exited };
}
const until = async (pred, ms, what) => {
  const end = Date.now() + ms;
  while (!pred()) {
    assert.ok(Date.now() < end, `timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('timeout'), ms))]);

test('CLI: SIGTERM or SIGINT during a wait prints the closing MACHINE WAIT pair and exits 128 + the signal', async () => {
  for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    const run = cliBackground(['--wait', '30', '--poll', '0.2'], [SHORT]);
    try {
      await until(() => run.err().includes('ADMISSION waiting '), 15_000, `${sig}: the ADMISSION waiting line on stderr`);
      assert.match(run.err(), /^ADMISSION waiting memory 3\.9 GB available < 4$/m);
      assert.equal(run.out(), '', 'nothing on stdout before the wait ends');
      run.child.kill(sig);
      const r = await within(run.exited, 10_000);
      assert.deepEqual(r, { code, signal: null }, `${sig}: ${run.out()}${run.err()}`);
      const lines = run.out().trim().split('\n');
      assert.equal(lines.length, 1, run.out());
      assert.match(lines[0], new RegExp(`^MACHINE WAIT ${ISO} → ${ISO} memory 3\\.9 GB available < 4 \\(interrupted\\)$`));
      const span = parseOwnerWait(lines[0], new Date(8.64e15).toISOString());
      assert.ok(span && span.ms >= 0 && span.ms < 30_000, lines[0]);
    } finally {
      run.child.kill('SIGKILL');
    }
  }
});
