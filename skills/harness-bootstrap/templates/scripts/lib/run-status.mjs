// harness-bootstrap run-status (generated YYYY-MM-DD). Shared by scripts/codex-run.mjs and scripts/claude-run.mjs.
// [M] mechanism (ships as-is): everything.
/**
 * The run sidecar and `--status`. A wrapper writes <ledger dir>/running/<run>.json, `run` being
 * <startMs>-<wrapperPid>, before it spawns its model (codex-run: before its router call), rewrites
 * it with the child's pid once spawned, and removes it after the run's ledger row, which carries the
 * same `run`, is appended; a wrapper killed outright leaves it behind. `--status` reads the sidecars
 * and the ledger and says, per run: `done <outcome>` (the row is there), `dead` (no pid alive),
 * `running` (CPU time or the log grew between two samples) or `quiet` (alive, no growth); the row
 * and the pids are read again after the samples, so a run that ends between them is not reported
 * alive. It never kills and never deletes. The verdict is a pure function; the I/O helpers take an
 * injected `ps` and `kill`, so `run-status.test.mjs` can pin every verdict without real processes.
 *
 * WHY. Owners asked "is it still running, done or dead?" about 18 times in three weeks, and a
 * session answering from memory was wrong both ways: it called runs finished that were alive, and
 * runs hung that were working silently (one tool prints nothing for many minutes). A pid alone is
 * not an answer either: the system reuses pids, so a pid counts only while its start time matches
 * the recorded one. `quiet` is reported, never acted on: --timeout-min stays the only automatic kill.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// How far a pid's start time (`ps -o lstart=`: whole seconds, local time) may sit from the recorded one.
export const START_SLACK_MS = 10_000;
// The default gap between the two samples of `--status`.
export const SAMPLE_MS = 5000;

const SIDECAR_NAME = /^\d+-\d+\.json$/;

/** Where a ledger's sidecars live: `running/` beside `ledger.jsonl`. */
export function sidecarDir(ledgerFile) {
  return path.join(path.dirname(ledgerFile), 'running');
}

/** A run's id, `<startMs>-<wrapperPid>`, the start being the ledger row's `at`: its sidecar's stem and its ledger rows' `run`. */
export function runId({ at, wrapperPid }) {
  return `${Date.parse(at)}-${wrapperPid}`;
}

/** A run's sidecar: `<run>.json`. */
export function sidecarFile(ledgerFile, record) {
  return path.join(sidecarDir(ledgerFile), `${runId(record)}.json`);
}

/** Write (or rewrite) a run's sidecar through a temp file and a rename, so no reader sees half of one; returns its path. */
export function writeSidecar(ledgerFile, record) {
  const file = sidecarFile(ledgerFile, record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

/** Remove a run's sidecar. Never throws: it runs in a `finally`, and a sidecar left behind reads as `done` or `dead`. */
export function removeSidecar(file) {
  try {
    if (file) fs.rmSync(file, { force: true });
  } catch {
    /* --status names the file to remove */
  }
}

/**
 * A wrapper's run sidecar, written now with its `run` id: `update` rewrites it with changed fields
 * (the child's pid, the routed kind; never `at` or `wrapperPid`, which name the file), `remove`
 * takes it away. Returns { file, record, update, remove }.
 */
export function openSidecar(ledgerFile, record) {
  const sidecar = { record: { run: runId(record), ...record } };
  sidecar.file = writeSidecar(ledgerFile, sidecar.record);
  sidecar.update = (changes) => {
    sidecar.record = { ...sidecar.record, ...changes };
    writeSidecar(ledgerFile, sidecar.record);
  };
  sidecar.remove = () => removeSidecar(sidecar.file);
  return sidecar;
}

/** The sidecars in `dir` as [{ file, sidecar }], oldest first; a torn or foreign file is skipped. */
export function readSidecars(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => SIDECAR_NAME.test(n))
    .sort((x, y) => parseInt(x, 10) - parseInt(y, 10))
    .flatMap((n) => {
      const file = path.join(dir, n);
      try {
        const s = JSON.parse(fs.readFileSync(file, 'utf8'));
        return s && typeof s.at === 'string' && typeof s.kind === 'string' && Number.isInteger(s.wrapperPid) ? [{ file, sidecar: s }] : [];
      } catch {
        return [];
      }
    });
}

/** A ledger's rows; a missing ledger is none, a torn line is skipped. */
export function readLedger(ledgerFile) {
  let text;
  try {
    text = fs.readFileSync(ledgerFile, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    try {
      const r = JSON.parse(line);
      return r && typeof r === 'object' ? [r] : [];
    } catch {
      return [];
    }
  });
}

/** Seconds in the CPU time `ps -o time=` prints: `[[dd-]hh:]mm:ss[.ss]` (macOS `0:00.52`, Linux `00:00:00`); null for anything else. */
export function parsePsTime(text) {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const [d, h, min] = [m[1], m[2], m[3]].map((x) => (x === undefined ? 0 : Number(x)));
  return ((d * 24 + h) * 60 + min) * 60 + Number(m[4]);
}

/** Epoch ms of the start time `ps -o lstart=` prints (`Wed Nov  4 05:53:10 2026`, local time); null for anything else. */
export function parseLstart(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!/^\w{3} \w{3} \d{1,2} \d{1,2}:\d{2}:\d{2} \d{4}$/.test(t)) return null;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Whether a process that started at `startedMs` is the one recorded as started at `recordedIso`. */
export function sameProcess({ startedMs, recordedIso, slackMs = START_SLACK_MS }) {
  const recorded = Date.parse(recordedIso ?? '');
  return Number.isFinite(startedMs) && Number.isFinite(recorded) && Math.abs(startedMs - recorded) <= slackMs;
}

/**
 * The ledger row of a sidecar's run, or null: the row that carries its `run`. Two runs of one kind
 * can share an `at` (the same millisecond, or two worktrees on one ledger), so `at` and `kind` match
 * only for a sidecar written before runs had an id.
 */
export function rowFor(sidecar, ledgerRows) {
  const mine = sidecar.run ? (r) => r.run === sidecar.run : (r) => r.at === sidecar.at && r.kind === sidecar.kind;
  for (let i = ledgerRows.length - 1; i >= 0; i--) if (mine(ledgerRows[i])) return ledgerRows[i];
  return null;
}

/**
 * The verdict on one run: `done <outcome>` when its ledger row exists (the wrapper died between
 * the append and the removal), `dead` when no pid of it is alive, else `running` when a sample
 * grew and `quiet` when none did.
 */
export function runVerdict({ sidecar, ledgerRows = [], alive, grew }) {
  const row = rowFor(sidecar, ledgerRows);
  if (row) return `done ${row.outcome}`;
  if (!alive) return 'dead';
  return grew ? 'running' : 'quiet';
}

/** `ps <args>`'s stdout, '' when ps ran and found no such process; throws when ps cannot run. */
export function realPs(args) {
  try {
    return execFileSync('ps', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    if (typeof e.status === 'number') return String(e.stdout ?? '');
    throw e;
  }
}

const realKill = (pid, signal) => process.kill(pid, signal);

/**
 * Whether `pid` is the process recorded as started at `recordedIso`: kill -0 succeeds or throws
 * EPERM, and its `ps -o lstart=` start is within START_SLACK_MS of the record (a reused pid is not
 * alive). When ps cannot run, kill -0 alone decides and the answer is `unchecked`.
 */
export function probePid(pid, recordedIso, { ps, kill }) {
  const no = { alive: false, unchecked: false };
  if (!Number.isInteger(pid) || pid <= 0) return no;
  try {
    kill(pid, 0);
  } catch (e) {
    if (e?.code !== 'EPERM') return no;
  }
  let text;
  try {
    text = ps(['-o', 'lstart=', '-p', String(pid)]);
  } catch {
    return { alive: true, unchecked: true };
  }
  if (!String(text ?? '').trim()) return no; // exited between the two calls
  const startedMs = parseLstart(text);
  if (startedMs === null) return { alive: true, unchecked: true };
  return { alive: sameProcess({ startedMs, recordedIso }), unchecked: false };
}

/** Seconds of CPU in a `/proc/<pid>/stat` line: utime + stime, fields 14 and 15, in clock ticks (100 a second). */
export function parseProcStat(text) {
  const rest = String(text ?? '').slice(String(text ?? '').lastIndexOf(')') + 2).split(' ');
  const [utime, stime] = [Number(rest[11]), Number(rest[12])];
  return Number.isFinite(utime) && Number.isFinite(stime) && rest.length > 12 ? (utime + stime) / 100 : null;
}

function procCpuSeconds(pid) {
  if (process.platform !== 'linux') return null;
  try {
    return parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * A pid's CPU seconds, or null when nothing tells: `ps -o time=`, except that with the real `ps` on
 * Linux, whose `time` counts whole seconds, /proc/<pid>/stat comes first.
 */
export function cpuSeconds(pid, ps = realPs) {
  const proc = ps === realPs ? procCpuSeconds(pid) : null;
  if (proc !== null) return proc;
  try {
    return parsePsTime(ps(['-o', 'time=', '-p', String(pid)]));
  } catch {
    return null;
  }
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

/** A path as the file system names it: the real directory (macOS /tmp and /var are links) and the base name. */
function realish(p) {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      return abs;
    }
  }
}

const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && realish(a) === realish(b);

/** A run's age: `42s`, `3m05s`, `2h07m`, `1d04h`. */
export function formatAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${pad(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${pad(Math.floor(s / 60) % 60)}m`;
  return `${Math.floor(s / 86400)}d${pad(Math.floor(s / 3600) % 24)}h`;
}

/**
 * One run's line: `<wrapper>: <verdict> kind=<kind> started=<at> (<age>) pids=<wrapperPid>[✗]/<childPid|->[✗]
 * out=<out>[ log=<log> +<bytes>B][ cpu+<s>s]`, ✗ marking a pid that is not alive; ` (start unchecked)`
 * when ps could not tell a start time; a `dead` line ends with what to check and the sidecar to remove.
 */
export function formatStatusLine({ wrapper, verdict, sidecar: s, file, now, alive = {}, unchecked = false, logGrowth = null, cpuGrowth = null }) {
  const mark = (pid, ok) => (pid === null || pid === undefined ? '-' : `${pid}${ok ? '' : '✗'}`);
  let line = `${wrapper}: ${verdict} kind=${s.kind} started=${s.at} (${formatAge(now - Date.parse(s.at))}) pids=${mark(s.wrapperPid, alive.wrapper)}/${mark(s.childPid, alive.child)} out=${s.out}`;
  if (s.log && logGrowth !== null) line += ` log=${s.log} +${logGrowth}B`;
  if (cpuGrowth !== null) line += ` cpu+${cpuGrowth.toFixed(2)}s`;
  if (unchecked) line += ' (start unchecked)';
  if (verdict === 'dead') line += ` — check ${s.cwd} for partial writes, then rm ${file}`;
  return line;
}

/** The line for no sidecar: the ledger's last row for `out`, or nothing recorded, or nothing in flight. */
function noRunLine({ wrapper, ledgerFile, rows, out, now }) {
  if (!out) return `${wrapper}: no run in flight (${path.dirname(ledgerFile)})`;
  const row = rows.findLast((r) => samePath(r.out ?? r.verdict, out));
  if (!row) return `${wrapper}: unknown — no run recorded for ${out}`;
  return `${wrapper}: done ${row.outcome} kind=${row.kind} started=${row.at} (${formatAge(now - Date.parse(row.at))}) out=${out}`;
}

/** Sum of the positive differences of the samples both readings have; null when no pair was read. */
function growth(before, after) {
  let sum = null;
  before.forEach((b, i) => {
    if (b !== null && after[i] !== null) sum = (sum ?? 0) + Math.max(0, after[i] - b);
  });
  return sum;
}

/**
 * `--status`: every sidecar beside `ledgerFile` (only the one whose `out` is `out`, when given),
 * each pid probed, the alive ones and the log sampled twice `sampleMs` apart, then the pids probed
 * and the ledger read again: the verdict is on the facts after the wait. Returns
 * { lines, runs: [{ verdict, line, file, sidecar }] }. Never kills, never deletes.
 */
export async function status({ wrapper, ledgerFile, out = null, sampleMs = SAMPLE_MS, now = Date.now(), ps = realPs, kill = realKill, sizeOf = fileSize }) {
  let rows = readLedger(ledgerFile);
  const found = readSidecars(sidecarDir(ledgerFile)).filter(({ sidecar }) => !out || samePath(sidecar.out, out));
  if (found.length === 0) return { lines: [noRunLine({ wrapper, ledgerFile, rows, out, now })], runs: [] };
  const probe = (r) => {
    const w = probePid(r.sidecar.wrapperPid, r.sidecar.wrapperStart, { ps, kill });
    const c = probePid(r.sidecar.childPid, r.sidecar.childStart, { ps, kill });
    r.alive = { wrapper: w.alive, child: c.alive };
    r.unchecked = (w.alive && w.unchecked) || (c.alive && c.unchecked);
  };
  const runs = found.map(({ file, sidecar }) => {
    const r = { file, sidecar };
    probe(r);
    const pids = [r.alive.wrapper ? sidecar.wrapperPid : null, r.alive.child ? sidecar.childPid : null].filter((p) => p !== null);
    // A run whose row is in needs no sample: it is done whatever its pids do.
    r.sampled = rowFor(sidecar, rows) || pids.length === 0 ? [] : pids;
    return r;
  });
  const take = (r) => ({ cpu: r.sampled.map((pid) => cpuSeconds(pid, ps)), log: r.sidecar.log ? sizeOf(r.sidecar.log) : null });
  const toSample = runs.filter((r) => r.sampled.length > 0);
  const first = toSample.map(take);
  if (toSample.length > 0) await new Promise((resolve) => setTimeout(resolve, sampleMs));
  toSample.forEach((r, i) => {
    const second = take(r);
    r.cpuGrowth = growth(first[i].cpu, second.cpu);
    r.logGrowth = first[i].log !== null && second.log !== null ? second.log - first[i].log : null;
    // The run can end during the wait: its pids are probed again, then its row looked for again.
    probe(r);
  });
  if (toSample.length > 0) rows = readLedger(ledgerFile);
  const results = runs.map((r) => {
    const grew = (r.cpuGrowth ?? 0) > 0 || (r.logGrowth ?? 0) > 0;
    const verdict = runVerdict({ sidecar: r.sidecar, ledgerRows: rows, alive: r.alive.wrapper || r.alive.child, grew });
    const line = formatStatusLine({ wrapper, verdict, sidecar: r.sidecar, file: r.file, now, alive: r.alive, unchecked: r.unchecked, logGrowth: r.logGrowth ?? null, cpuGrowth: r.cpuGrowth ?? null });
    return { verdict, line, file: r.file, sidecar: r.sidecar };
  });
  return { lines: results.map((r) => r.line), runs: results };
}
