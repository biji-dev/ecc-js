// harness-bootstrap admission core (generated YYYY-MM-DD). Pure core of scripts/lib/admission.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right below
// -- the floors, the wait and the command a refusal names.
/**
 * Admission: a FULL verify starts only on a machine with the memory, the disk and the CPU it needs.
 * No I/O here: the readers, the clock, the sleep and the writer are injected (the CLI passes the real
 * ones), so `admission-core.test.mjs` can pin each floor and run the 60-minute bound on a fake clock.
 *
 * WHY. A FULL verify was killed when another session's test process peaked over 3 GiB; another went red
 * at a 1-minute load of 15 per CPU and was green on a re-run at 2. Nothing stopped either from starting.
 * Admission reads the machine before the gates, waits while it is short and refuses at the bound: a run
 * that goes ahead regardless is what both runs were.
 *
 * WHAT IT READS. Memory available: on darwin `kern.memorystatus_level` % x `hw.memsize`, never
 * `os.freemem()`, which read 0.14 GiB while the OS reported 54% available; on Linux
 * `MemAvailable`. Disk: `statfs(top)`, bavail x bsize, the space this user may write. Load: the
 * 1-minute average against LOAD_PER_CPU x the CPU count. A reading that cannot be read is admitted
 * and noted (`ADMISSION unread <what>`): admission then falls back to the old behaviour, visibly. A
 * reading under its floor never admits. This is check-time admission: a machine that turns short
 * mid-run still runs short.
 *
 * THE LEASE. Given `--holder <pid>` (run-gates passes its own), an admitted run also holds one of the
 * host's LEASE_SLOTS slots, files in ~/.harness/leases (HARNESS_LEASE_DIR overrides), until run-gates'
 * EXIT trap removes it: two worktrees admitted in the same second no longer both run, whatever the
 * memory read. The slot is taken only once the machine reads ok; with every slot held by a live run the
 * machine counts as short (`lease held by <top> since <at>`) and the wait and the bound are the same as
 * for memory. A dead holder's slot is taken over. A lease that cannot be read or written is noted
 * (`ADMISSION unread lease`) and the run is admitted without one.
 */

// ---- [B] project bindings
// [B] Memory the verify reserves, GB (1e9): the measured peak of the heaviest gate x 1.5, rounded.
export const MEM_RESERVE_GB = 4;
// [B] Free disk under which no verify starts, GB: above the line where the machine starts failing. A separate
// line from harness-due-core's DISK_MIN_GB (10), where the machine sweep comes due.
export const DISK_FLOOR_GB = 5;
// [B] The 1-minute load ceiling per CPU; null turns the load check off.
export const LOAD_PER_CPU = 3;
// [B] How long admission waits for the machine before it refuses, and how often it reads it, seconds.
export const WAIT_S = 3600;
export const POLL_S = 30;
// [B] What a refusal tells the owner to run: the sweep's read-only report.
export const FREE_COMMAND = 'node ~/.agents/harness/machine-sweep/machine-sweep.mjs --report';
// [B] How many FULL verifies may run on this host at once (the lease slots); null is
// max(1, min(2, floor(memory GB / 8))) of the machine's total memory.
export const LEASE_SLOTS = null;
// ---- end [B]

export const FLOORS = { mem: MEM_RESERVE_GB, disk: DISK_FLOOR_GB, load: LOAD_PER_CPU };
// interrupted: admit()'s return when its signal aborted it; the CLI exits 128 + the signal's number instead.
export const EXIT = { admitted: 0, refused: 1, usage: 2, interrupted: 3 };
const GB = 1e9;
const NUMBER = /^\d+(?:\.\d+)?$/;
const NUMBER_FLAGS = { '--mem-gb': 'mem', '--disk-gb': 'disk', '--load-per-cpu': 'load', '--wait': 'wait', '--poll': 'poll' };
const PATH_FLAGS = { '--top': 'top', '--reading': 'reading' };
const COUNT_FLAGS = { '--holder': 'holder', '--lease-slots': 'leaseSlots' };

/**
 * Reject an unknown flag, a repeated one, a value missing or not a plain number of 0 or more (a whole number of
 * 1 or more for --holder and --lease-slots), before anything is read.
 */
export function parseArgs(argv) {
  const a = { mem: MEM_RESERVE_GB, disk: DISK_FLOOR_GB, load: LOAD_PER_CPU, wait: WAIT_S, poll: POLL_S, top: null, reading: null, holder: null, leaseSlots: null };
  const given = new Set();
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!(t in NUMBER_FLAGS) && !(t in PATH_FLAGS) && !(t in COUNT_FLAGS)) throw new Error(t.startsWith('--') ? `unknown option ${t}` : `unexpected argument "${t}"`);
    if (given.has(t)) throw new Error(`${t} is given twice; give it once`);
    given.add(t);
    const v = argv[++i];
    if (v === undefined || v === '' || v.startsWith('--')) throw new Error(`${t} needs a value`);
    if (t in NUMBER_FLAGS) {
      if (!NUMBER.test(v)) throw new Error(`${t} takes a number of 0 or more, not "${v}"`);
      a[NUMBER_FLAGS[t]] = Number(v);
    } else if (t in COUNT_FLAGS) {
      if (!/^[1-9]\d*$/.test(v)) throw new Error(`${t} takes a whole number of 1 or more, not "${v}"`);
      a[COUNT_FLAGS[t]] = Number(v);
    } else a[PATH_FLAGS[t]] = v;
  }
  return a;
}

const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const integerText = (s) => (typeof s === 'string' && /^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** darwin memory available, bytes: `kern.memorystatus_level` (0-100) % of `hw.memsize`; null when either is not read. */
export function darwinMem(levelText, memsizeText) {
  const level = integerText(levelText);
  const size = integerText(memsizeText);
  if (level === null || level > 100 || size === null || size === 0) return null;
  return (level * size) / 100;
}

/** Linux memory available, bytes: /proc/meminfo's `MemAvailable` (kB); null without the line. */
export function linuxMem(meminfo) {
  const m = /^MemAvailable:\s+(\d+)\s*kB\s*$/m.exec(String(meminfo ?? ''));
  return m ? Number(m[1]) * 1024 : null;
}

/** Free disk this user may write, bytes: a statfs result's bavail x bsize; null when either is missing. */
export function diskFree(stat) {
  const bavail = count(stat?.bavail);
  const bsize = count(stat?.bsize);
  return bavail === null || bsize === null ? null : bavail * bsize;
}

const attempt = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/**
 * The machine as { mem, disk, load, cpus } (bytes, bytes, the 1-minute load, CPUs), each null when its
 * reader throws or gives nothing usable. The readers are injected: `platform`, `sysctl(name)` -> its
 * text, `readFile(path)` -> text, `statfs(top)`, `loadavg()` -> [1, 5, 15 min] and `cpus()` -> a count.
 */
export function readMachine({ platform, sysctl, readFile, statfs, loadavg, cpus, top }) {
  let mem = null;
  if (platform === 'darwin') mem = attempt(() => darwinMem(sysctl('kern.memorystatus_level'), sysctl('hw.memsize')));
  else if (platform === 'linux') mem = attempt(() => linuxMem(readFile('/proc/meminfo')));
  return {
    mem,
    disk: attempt(() => diskFree(statfs(top))),
    load: attempt(() => count(loadavg()[0])),
    cpus: attempt(() => count(cpus())),
  };
}

const gb = (bytes) => (bytes / GB).toFixed(1);
const num = (x) => String(Number(x.toFixed(2)));

/**
 * One reading against the floors (GB, GB, load per CPU; a null floor is no check) -> { ok, short, unread,
 * reason, detail }. Memory and disk admit at or above their floor, load at or under its ceiling. `short`
 * and `unread` name the checks, memory, disk, load in that order; `reason` joins the short ones' texts,
 * `detail` every check read. A reading that is not a number of 0 or more, or a load with no CPU count of
 * 1 or more, is unread: it admits and is noted. `ok` is no short check.
 */
export function decide(reading, floors = FLOORS) {
  const r = reading ?? {};
  const checks = [];
  const unread = [];
  const check = (what, value, ok, text) => {
    if (value === null) unread.push(what);
    else checks.push({ what, ok, text: text(ok) });
  };
  if (floors.mem !== null) {
    const mem = count(r.mem);
    check('memory', mem, mem >= floors.mem * GB, (ok) => `memory ${gb(mem)} GB available ${ok ? '≥' : '<'} ${num(floors.mem)}`);
  }
  if (floors.disk !== null) {
    const disk = count(r.disk);
    check('disk', disk, disk >= floors.disk * GB, (ok) => `disk ${gb(disk)} GB free ${ok ? '≥' : '<'} ${num(floors.disk)}`);
  }
  if (floors.load !== null) {
    const cpus = count(r.cpus);
    const load = cpus === null || cpus < 1 ? null : count(r.load);
    const ceiling = floors.load * cpus;
    check('load', load, load <= ceiling, (ok) => `load ${load.toFixed(1)} ${ok ? '≤' : '>'} ${num(ceiling)}`);
  }
  const short = checks.filter((c) => !c.ok);
  return {
    ok: short.length === 0,
    short: short.map((c) => c.what),
    unread,
    reason: short.map((c) => c.text).join('; '),
    detail: checks.map((c) => c.text).join('; '),
  };
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The lease slot count: `slots` (LEASE_SLOTS) when set, else max(1, min(2, floor(total memory GB / 8))). */
export function leaseSlots(totalBytes, slots = LEASE_SLOTS) {
  if (slots !== null) return slots;
  const eighths = Number.isFinite(totalBytes) && totalBytes > 0 ? Math.floor(totalBytes / GB / 8) : 0;
  return Math.max(1, Math.min(2, eighths));
}

/**
 * Takes a host lease slot for `holder` (the pid of the run that holds it) in `dir` (made 0700): the files
 * slot-1 .. slot-<slots>, each one JSON line {"pid","top","at"} (mode 0600), written to a temp file and
 * linked into place, so a slot is never seen half-written and two takers never share one. A slot that
 * already names `holder` is its own (a second admission of the same run). A slot whose pid is dead
 * (`alive(pid)` false), or that is not a lease line, is taken over under a `slot-<i>.reap` mutex
 * directory: re-read, removed only when unchanged, then linked like a free one; a mutex older than
 * `reapMs` is a dead reaper's and is removed. Returns { path } or, every slot held by a live pid,
 * { held: 'lease held by <top> since <at>' } naming the oldest holder. Throws on an I/O error. `fs` is
 * node:fs or a stand-in, `now()` wall ms. The run releases its slot itself (run-gates' EXIT trap); a
 * pid reused by another process after its run died keeps the slot held until that process ends.
 */
export function takeLease({ dir, slots, holder, top, now, fs, alive, reapMs = 60_000 }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const slot = (i) => `${dir}/slot-${i}`;
  const read = (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  };
  const parse = (text) => {
    try {
      const o = JSON.parse(text);
      return o !== null && typeof o === 'object' && Number.isInteger(o.pid) && o.pid > 0 ? o : null;
    } catch {
      return null;
    }
  };
  const ids = Array.from({ length: slots }, (_, k) => k + 1);
  const seen = ids.map((i) => read(slot(i)));
  const own = ids.find((i, k) => seen[k] !== null && parse(seen[k])?.pid === holder);
  if (own !== undefined) return { path: slot(own) };
  // A dead holder's slot: removed under the mutex when it still holds what was read; false = leave it.
  const reap = (i, text) => {
    const mutex = `${slot(i)}.reap`;
    try {
      fs.mkdirSync(mutex);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const st = attempt(() => fs.statSync(mutex));
      if (st === null || now() - st.mtimeMs < reapMs) return false;
      attempt(() => fs.rmdirSync(mutex));
      if (attempt(() => fs.mkdirSync(mutex) ?? true) === null) return false;
    }
    try {
      if (read(slot(i)) !== text) return false;
      try {
        fs.unlinkSync(slot(i));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      return true;
    } finally {
      attempt(() => fs.rmdirSync(mutex));
    }
  };
  const tmp = `${dir}/.take-${holder}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, `${JSON.stringify({ pid: holder, top: top ?? null, at: iso(now()) })}\n`, { mode: 0o600 });
  try {
    for (const [k, i] of ids.entries()) {
      if (seen[k] !== null) {
        const o = parse(seen[k]);
        if ((o !== null && alive(o.pid)) || !reap(i, seen[k])) continue;
      }
      try {
        fs.linkSync(tmp, slot(i));
        return { path: slot(i) };
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
  } finally {
    attempt(() => fs.unlinkSync(tmp));
  }
  const holders = ids
    .map((i) => parse(read(slot(i)) ?? ''))
    .filter((o) => o !== null)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const oldest = holders[0];
  return { held: oldest ? `lease held by ${oldest.top} since ${oldest.at}` : 'lease slots taken while read' };
}

/** `MACHINE WAIT <ISO> → <ISO> <reason>`: one wait episode, the pair unit-record subtracts from Work. */
export const formatWait = (startMs, endMs, reason) => `MACHINE WAIT ${iso(startMs)} → ${iso(endMs)} ${reason}`;

/** `NOT ADMITTED <reason>; free: <FREE_COMMAND>`: the refusal at the bound. */
export const formatRefusal = (reason) => `NOT ADMITTED ${reason}; free: ${FREE_COMMAND}`;

const formatAdmitted = (d) => `ADMISSION admitted — ${d.detail || 'nothing read'}`;

/**
 * Read the machine until it is admitted or `waitS` has passed since the first read; returns the exit code.
 * Each read's unread checks are noted once (`ADMISSION unread <what>`). Admitted at once: one admitted
 * line. Short: `note` gets `ADMISSION waiting <reason>` once (stderr in the CLI, so a wait is visible while
 * it lasts), then it reads again every `pollS`, the last sleep cut to the bound, so a read falls on it;
 * admitted later, the episode's `MACHINE WAIT` pair (with the last short reason) and then the admitted
 * line; still short on the read at the bound, the pair and then NOT ADMITTED. `signal` aborted (the CLI's
 * SIGTERM or SIGINT): the pair, its reason ending ` (interrupted)`, and EXIT.interrupted.
 * The bound and every span are on `clock`, a monotonic ms clock (a wall clock stepped back would stretch
 * the wait); `now` (wall ms) only places the pair: it starts at the wall time of the first short read and
 * ends the monotonic span later. `read`, `now`, `clock` (default `now`), `sleep(ms, signal)` (a promise),
 * `write(line)` and `note(line)` are injected. `lease` (null: none) is called on a read that is ok, and
 * gives takeLease's answer: { path } admits with `LEASE <path>` after the pair, before the admitted line;
 * { held } makes the read short with that reason; a throw is noted `ADMISSION unread lease` and admits.
 */
export async function admit({ read, now, clock = now, sleep, write, note = () => {}, signal, floors = FLOORS, waitS = WAIT_S, pollS = POLL_S, lease = null }) {
  const start = clock();
  const bound = start + waitS * 1000;
  const noted = new Set();
  let first = null;
  let firstWall = null;
  let reason = '';
  const pair = (t, why) => formatWait(firstWall, firstWall + (t - first), why);
  for (;;) {
    const t = clock();
    if (signal?.aborted) {
      if (first !== null) write(pair(t, `${reason} (interrupted)`));
      return EXIT.interrupted;
    }
    let d = decide(read(), floors);
    for (const what of d.unread) {
      if (!noted.has(what)) write(`ADMISSION unread ${what}`);
      noted.add(what);
    }
    let leased = null;
    if (d.ok && lease) {
      let l = null;
      try {
        l = lease();
      } catch {
        if (!noted.has('lease')) write('ADMISSION unread lease');
        noted.add('lease');
      }
      if (l?.held) d = { ...d, ok: false, short: [...d.short, 'lease'], reason: l.held };
      else leased = l?.path ?? null;
    }
    if (d.ok) {
      if (first !== null) write(pair(t, reason));
      if (leased) write(`LEASE ${leased}`);
      write(formatAdmitted(d));
      return EXIT.admitted;
    }
    if (first === null) {
      first = t;
      firstWall = now();
      note(`ADMISSION waiting ${d.reason}`);
    }
    reason = d.reason;
    if (t >= bound) {
      write(pair(t, reason));
      write(formatRefusal(reason));
      return EXIT.refused;
    }
    try {
      await sleep(Math.min(pollS * 1000, bound - t), signal);
    } catch (e) {
      if (!signal?.aborted) throw e;
    }
  }
}
