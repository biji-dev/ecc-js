// harness-bootstrap run-status tests (generated YYYY-MM-DD). Run: node --test scripts/lib/run-status.test.mjs
// [M] mechanism (ships as-is): every test. Every verdict runs on an injected process table (`ps`
// and `kill`); one case spawns a real busy node process, samples it with the real `ps`, kills it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  START_SLACK_MS,
  cpuSeconds,
  formatAge,
  openSidecar,
  parseLstart,
  parseProcStat,
  parsePsTime,
  readSidecars,
  removeSidecar,
  runId,
  runVerdict,
  sameProcess,
  sidecarDir,
  status,
  writeSidecar,
} from './run-status.mjs';

const tempDirs = [];
function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

const T0 = Date.parse('2026-11-04T05:53:10.000Z');
const iso = (ms) => new Date(ms).toISOString();

/** `ps -o lstart=` for an epoch ms, as macOS and Linux print it: local time, the day padded with a space. */
function lstart(ms) {
  const d = new Date(ms);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const p = (n) => String(n).padStart(2, '0');
  return `${day} ${month} ${String(d.getDate()).padStart(2, ' ')} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getFullYear()}\n`;
}

/**
 * An injected process table: pid -> { start (ms), cpu: [seconds per `time=` call] }. `kill` throws
 * ESRCH for a pid not in it (EPERM for one marked `other`); `ps` answers lstart and time, or throws
 * for every call when `psFails`.
 */
function procs(table, { psFails = false } = {}) {
  const calls = new Map();
  const kill = (pid) => {
    const p = table[pid];
    if (!p) throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    if (p.other) throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
    return true;
  };
  const ps = (args) => {
    if (psFails) throw Object.assign(new Error('spawn ps ENOENT'), { code: 'ENOENT' });
    const pid = Number(args.at(-1));
    const p = table[pid];
    if (!p) return '';
    if (args[1] === 'lstart=') return lstart(p.start);
    const n = calls.get(pid) ?? 0;
    calls.set(pid, n + 1);
    const s = p.cpu[Math.min(n, p.cpu.length - 1)];
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}\n`;
  };
  return { ps, kill };
}

/** A ledger in a temp dir and one run's sidecar beside it: wrapper 101 started at T0, its child 102 half a second later. */
function fixture(over = {}) {
  const dir = tmpDir('run-status-');
  const ledgerFile = path.join(dir, 'ledger.jsonl');
  const record = {
    at: iso(T0 + 1000),
    kind: 'investigate',
    cwd: dir,
    out: path.join(dir, 'v.md'),
    log: path.join(dir, 'v.md.log'),
    wrapperPid: 101,
    wrapperStart: iso(T0),
    childPid: 102,
    childStart: iso(T0 + 1500),
    ...over,
  };
  const file = writeSidecar(ledgerFile, record);
  return { dir, ledgerFile, record, file };
}

const NOW = T0 + 66_000;
const flatLog = () => 100;
const run = (f, injected, extra = {}) =>
  status({ wrapper: 'codex-run', ledgerFile: f.ledgerFile, sampleMs: 0, now: NOW, sizeOf: flatLog, ...injected, ...extra });

test('parsePsTime reads the CPU time ps prints on macOS and Linux', () => {
  assert.equal(parsePsTime('05:03'), 303);
  assert.equal(parsePsTime('1:02:03'), 3723);
  assert.equal(parsePsTime('2-01:02:03'), 2 * 86400 + 3723);
  assert.equal(parsePsTime('00:00.52'), 0.52);
  assert.equal(parsePsTime('  0:00.52\n'), 0.52);
  assert.equal(parsePsTime('1:02.03'), 62.03);
  assert.equal(parsePsTime('00:00:00'), 0);
  for (const junk of ['', 'TIME', '1:2:3:4', '-', null]) assert.equal(parsePsTime(junk), null, String(junk));
});

test('parseLstart reads local time with spaces collapsed; sameProcess holds the slack both ways', () => {
  assert.equal(parseLstart('Wed Nov  4 05:53:10 2026\n'), new Date(2026, 10, 4, 5, 53, 10).getTime());
  assert.equal(parseLstart(lstart(T0)), T0);
  assert.equal(parseLstart(''), null);
  assert.equal(parseLstart('STARTED'), null);
  assert.equal(sameProcess({ startedMs: T0, recordedIso: iso(T0 + START_SLACK_MS) }), true);
  assert.equal(sameProcess({ startedMs: T0, recordedIso: iso(T0 - START_SLACK_MS - 1) }), false);
  assert.equal(sameProcess({ startedMs: T0, recordedIso: iso(T0 + 3_600_000) }), false);
  assert.equal(sameProcess({ startedMs: T0, recordedIso: null }), false);
  assert.equal(sameProcess({ startedMs: null, recordedIso: iso(T0) }), false);
});

test('the sidecar: named <startMs>-<wrapperPid>.json, rewritten in place, read back, a torn file skipped, removed', () => {
  const f = fixture();
  assert.equal(f.file, path.join(f.dir, 'running', `${T0 + 1000}-101.json`));
  assert.equal(sidecarDir(f.ledgerFile), path.join(f.dir, 'running'));
  assert.equal(writeSidecar(f.ledgerFile, { ...f.record, childPid: 7, childStart: iso(T0 + 2000) }), f.file);
  fs.writeFileSync(path.join(f.dir, 'running', '1-2.json'), '{"at":"2026-11-04T05:5');
  fs.writeFileSync(path.join(f.dir, 'running', 'notes.txt'), 'x');
  const found = readSidecars(sidecarDir(f.ledgerFile));
  assert.deepEqual(found, [{ file: f.file, sidecar: { ...f.record, childPid: 7, childStart: iso(T0 + 2000) } }]);
  assert.deepEqual(fs.readdirSync(path.join(f.dir, 'running')).sort(), ['1-2.json', `${T0 + 1000}-101.json`, 'notes.txt']);
  removeSidecar(f.file);
  removeSidecar(f.file);
  removeSidecar(null);
  assert.deepEqual(readSidecars(sidecarDir(f.ledgerFile)), []);
  assert.deepEqual(readSidecars(path.join(f.dir, 'nowhere')), []);
});

test('openSidecar: written with its run id as its stem, rewritten in place by update, gone after remove', () => {
  const dir = tmpDir('run-status-open-');
  const ledgerFile = path.join(dir, 'ledger.jsonl');
  const record = { at: iso(T0), kind: 'auto', cwd: dir, out: path.join(dir, 'v.md'), log: null, wrapperPid: 301, wrapperStart: iso(T0), childPid: null, childStart: null };
  const s = openSidecar(ledgerFile, record);
  assert.equal(runId(record), `${T0}-301`);
  assert.equal(s.file, path.join(dir, 'running', `${T0}-301.json`));
  assert.deepEqual(readSidecars(sidecarDir(ledgerFile)), [{ file: s.file, sidecar: { run: `${T0}-301`, ...record } }]);
  s.update({ kind: 'investigate', childPid: 302, childStart: iso(T0 + 500) });
  const [only] = readSidecars(sidecarDir(ledgerFile));
  assert.deepEqual([only.file, only.sidecar.run, only.sidecar.kind, only.sidecar.childPid], [s.file, `${T0}-301`, 'investigate', 302]);
  s.remove();
  assert.deepEqual(fs.readdirSync(path.join(dir, 'running')), []);
});

test('runVerdict: a ledger row wins, then no pid alive is dead, then growth tells running from quiet', () => {
  const sidecar = { at: iso(T0), kind: 'review' };
  const rows = [{ at: iso(T0), kind: 'docs', outcome: 'ok' }];
  assert.equal(runVerdict({ sidecar, ledgerRows: [...rows, { at: iso(T0), kind: 'review', outcome: 'failed' }], alive: true, grew: true }), 'done failed');
  assert.equal(runVerdict({ sidecar, ledgerRows: rows, alive: false, grew: false }), 'dead');
  assert.equal(runVerdict({ sidecar, ledgerRows: rows, alive: true, grew: true }), 'running');
  assert.equal(runVerdict({ sidecar, ledgerRows: [], alive: true, grew: false }), 'quiet');
  assert.deepEqual([formatAge(42_000), formatAge(185_000), formatAge(7_620_000), formatAge(100_800_000)], ['42s', '3m05s', '2h07m', '1d04h']);
});

test('status: running when an alive pid gained CPU time', async () => {
  const f = fixture();
  const { lines, runs } = await run(f, procs({ 101: { start: T0, cpu: [1, 1] }, 102: { start: T0 + 1500, cpu: [4, 4.75] } }));
  assert.equal(runs[0].verdict, 'running');
  assert.equal(lines[0], `codex-run: running kind=investigate started=${f.record.at} (1m05s) pids=101/102 out=${f.record.out} log=${f.record.log} +0B cpu+0.75s`);
});

test('status: running when the log grew while the CPU time stayed flat', async () => {
  const f = fixture();
  const sizes = [100, 350];
  const { lines, runs } = await run(f, procs({ 101: { start: T0, cpu: [1] }, 102: { start: T0 + 1500, cpu: [4] } }), { sizeOf: () => sizes.shift() });
  assert.equal(runs[0].verdict, 'running');
  assert.match(lines[0], / log=\S+ \+250B cpu\+0\.00s$/);
});

test('status: quiet when every alive pid and the log stood still -- reported, nothing else', async () => {
  const f = fixture();
  const { lines, runs } = await run(f, procs({ 101: { start: T0, cpu: [1] }, 102: { start: T0 + 1500, cpu: [4] } }));
  assert.equal(runs[0].verdict, 'quiet');
  assert.match(lines[0], /^codex-run: quiet kind=investigate .* pids=101\/102 .*\+0B cpu\+0\.00s$/);
  assert.equal(fs.existsSync(f.file), true, 'status removed the sidecar');
});

test('status: done <outcome> when the run\'s ledger row is in (the wrapper died between the append and the removal)', async () => {
  const f = fixture();
  fs.writeFileSync(f.ledgerFile, `${JSON.stringify({ at: f.record.at, kind: 'investigate', outcome: 'ok', out: f.record.out })}\n`);
  const { lines, runs } = await run(f, procs({}));
  assert.equal(runs[0].verdict, 'done ok');
  assert.match(lines[0], /^codex-run: done ok kind=investigate .* pids=101✗\/102✗ out=\S+$/);
});

test('status: dead when no pid is alive, with what to check and the sidecar to remove', async () => {
  const f = fixture();
  const { lines, runs } = await run(f, procs({}));
  assert.equal(runs[0].verdict, 'dead');
  assert.equal(lines[0], `codex-run: dead kind=investigate started=${f.record.at} (1m05s) pids=101✗/102✗ out=${f.record.out} — check ${f.dir} for partial writes, then rm ${f.file}`);
  // Before the spawn the child is not recorded: `-`, never a ✗.
  const g = fixture({ childPid: null, childStart: null });
  assert.match((await run(g, procs({}))).lines[0], / pids=101✗\/- out=/);
  assert.equal(fs.existsSync(f.file), true, 'status removed the sidecar');
});

test('status: a killed wrapper whose child still runs is not dead', async () => {
  const f = fixture();
  const { lines, runs } = await run(f, procs({ 102: { start: T0 + 1500, cpu: [4, 9] } }));
  assert.equal(runs[0].verdict, 'running');
  assert.match(lines[0], / pids=101✗\/102 /);
  const quiet = await run(fixture(), procs({ 102: { start: T0 + 1500, other: true, cpu: [4] } }));
  assert.equal(quiet.runs[0].verdict, 'quiet', 'EPERM is alive');
});

test('status: a reused pid (alive, started an hour off the record) is not the run: dead', async () => {
  const f = fixture();
  const { lines, runs } = await run(f, procs({ 101: { start: T0 + 3_600_000, cpu: [1, 2] }, 102: { start: T0 - 3_600_000, cpu: [1, 2] } }));
  assert.equal(runs[0].verdict, 'dead');
  assert.match(lines[0], / pids=101✗\/102✗ /);
});

test('status: ps failing leaves kill -0 alone, and the line says (start unchecked)', async () => {
  const f = fixture();
  const { lines, runs } = await run(f, procs({ 101: { start: T0, cpu: [1] }, 102: { start: T0, cpu: [1] } }, { psFails: true }));
  assert.equal(runs[0].verdict, 'quiet');
  assert.match(lines[0], / pids=101\/102 out=\S+ log=\S+ \+0B \(start unchecked\)$/);
  const gone = await run(fixture(), procs({}, { psFails: true }));
  assert.equal(gone.runs[0].verdict, 'dead');
});

test('status: a sidecar takes the ledger row that carries its run, not one that shares its at and kind', async () => {
  // Two invocations of one kind in the same millisecond, or two worktrees on the one ledger.
  const f = fixture({ run: `${T0 + 1000}-101` });
  writeSidecar(f.ledgerFile, { ...f.record, run: `${T0 + 1000}-201`, out: path.join(f.dir, 'w.md'), wrapperPid: 201, childPid: 202 });
  fs.writeFileSync(f.ledgerFile, `${JSON.stringify({ run: f.record.run, at: f.record.at, kind: 'investigate', outcome: 'ok', out: f.record.out })}\n`);
  const { runs } = await run(f, procs({ 201: { start: T0, cpu: [1, 2] }, 202: { start: T0 + 1500, cpu: [4] } }));
  assert.deepEqual(Object.fromEntries(runs.map((r) => [r.sidecar.run, r.verdict])), { [`${T0 + 1000}-101`]: 'done ok', [`${T0 + 1000}-201`]: 'running' });
});

test('status: a ledger row appended while the run is sampled makes it done, not running', async () => {
  const f = fixture({ run: `${T0 + 1000}-101` });
  const p = procs({ 101: { start: T0, cpu: [1, 2] }, 102: { start: T0 + 1500, cpu: [4, 5] } });
  // The run appends its row once status has read the ledger and taken the first sample.
  let appended = false;
  const ps = (args) => {
    if (args[1] === 'time=' && !appended) {
      appended = true;
      fs.appendFileSync(f.ledgerFile, `${JSON.stringify({ run: f.record.run, at: f.record.at, kind: 'investigate', outcome: 'failed', out: f.record.out })}\n`);
    }
    return p.ps(args);
  };
  const { lines, runs } = await run(f, { ps, kill: p.kill });
  assert.equal(appended, true);
  assert.equal(runs[0].verdict, 'done failed');
  assert.match(lines[0], /^codex-run: done failed kind=investigate /);
});

test('status: a run whose pids exit while it is sampled is dead, not quiet', async () => {
  const f = fixture();
  const table = { 101: { start: T0, cpu: [1] }, 102: { start: T0 + 1500, cpu: [4] } };
  const p = procs(table);
  // Each pid exits once its first CPU sample is taken: the probe after the wait finds neither.
  const ps = (args) => {
    const text = p.ps(args);
    if (args[1] === 'time=') delete table[Number(args.at(-1))];
    return text;
  };
  const { lines, runs } = await run(f, { ps, kill: p.kill });
  assert.equal(runs[0].verdict, 'dead');
  assert.match(lines[0], / pids=101✗\/102✗ .* — check /);
});

test('status --out: the sidecar for that path, else the ledger\'s last row for it, else unknown', async () => {
  const f = fixture();
  const other = path.join(f.dir, 'other.md');
  writeSidecar(f.ledgerFile, { ...f.record, at: iso(T0 + 9000), out: other, wrapperPid: 201, childPid: null, childStart: null });
  // A fresh table per call: each one's CPU samples start over.
  const table = () => procs({ 101: { start: T0, cpu: [1, 2] }, 102: { start: T0 + 1500, cpu: [1] } });
  assert.equal((await run(f, table())).lines.length, 2);
  const one = await run(f, table(), { out: f.record.out });
  assert.deepEqual(one.runs.map((r) => r.verdict), ['running']);
  assert.equal(one.runs[0].sidecar.out, f.record.out);
  // Through a symlinked directory the same file is the same run (macOS /tmp and /var are links).
  const link = path.join(tmpDir('run-status-link-'), 'l');
  fs.symlinkSync(f.dir, link);
  assert.equal((await run(f, table(), { out: path.join(link, 'v.md') })).runs.length, 1);
  const done = path.join(f.dir, 'done.md');
  const failed = path.join(f.dir, 'failed.md');
  const rows = [
    { at: iso(T0 - 9000), kind: 'docs', outcome: 'failed', verdict: done },
    { at: iso(T0 - 5000), kind: 'docs', outcome: 'ok', verdict: done },
    { at: iso(T0 - 4000), kind: 'review', outcome: 'failed', verdict: null, out: failed },
  ];
  fs.writeFileSync(f.ledgerFile, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n{"torn`);
  assert.deepEqual((await run(f, table(), { out: done })).lines, [`codex-run: done ok kind=docs started=${iso(T0 - 5000)} (1m11s) out=${done}`]);
  assert.match((await run(f, table(), { out: failed })).lines[0], /^codex-run: done failed kind=review /);
  const none = path.join(f.dir, 'none.md');
  assert.deepEqual((await run(f, table(), { out: none })).lines, [`codex-run: unknown — no run recorded for ${none}`]);
  for (const r of readSidecars(sidecarDir(f.ledgerFile))) removeSidecar(r.file);
  assert.deepEqual((await run(f, table())).lines, [`codex-run: no run in flight (${f.dir})`]);
});

test('cpuSeconds: an injected ps answers; a Linux /proc/<pid>/stat line is read in clock ticks', () => {
  assert.equal(cpuSeconds(101, procs({ 101: { start: T0, cpu: [61.5] } }).ps), 61.5);
  assert.equal(cpuSeconds(101, procs({}).ps), null);
  assert.equal(cpuSeconds(101, procs({}, { psFails: true }).ps), null);
  // A comm with spaces and a parenthesis: fields are counted after the last `)`.
  const stat = '4242 (node (worker) x) S 1 4242 4242 0 -1 4194560 2391 0 0 0 152 37 0 0 20 0 11 0 9917 1155 0';
  assert.equal(parseProcStat(stat), 1.89);
  assert.equal(parseProcStat('4242 (node) S 1'), null);
});

test('a real process: running while it burns CPU, dead once killed', async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{let x=0;for(let i=0;i<1e7;i++)x+=i},50)'], { stdio: 'ignore' });
  t.after(() => child.kill('SIGKILL'));
  await once(child, 'spawn');
  const started = new Date().toISOString();
  const dir = tmpDir('run-status-real-');
  const ledgerFile = path.join(dir, 'ledger.jsonl');
  writeSidecar(ledgerFile, { at: started, kind: 'investigate', cwd: dir, out: path.join(dir, 'v.md'), log: null, wrapperPid: child.pid, wrapperStart: started, childPid: null, childStart: null });
  const live = await status({ wrapper: 'codex-run', ledgerFile, sampleMs: 600 });
  assert.equal(live.runs[0].verdict, 'running', live.lines.join('\n'));
  assert.match(live.lines[0], new RegExp(`pids=${child.pid}/- out=\\S+ cpu\\+\\d+\\.\\d\\ds$`));
  child.kill('SIGKILL');
  await once(child, 'exit');
  const gone = await status({ wrapper: 'codex-run', ledgerFile, sampleMs: 600 });
  assert.equal(gone.runs[0].verdict, 'dead', gone.lines.join('\n'));
});
