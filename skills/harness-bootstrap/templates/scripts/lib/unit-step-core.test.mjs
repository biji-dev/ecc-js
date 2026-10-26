// harness-bootstrap unit-step tests (generated YYYY-MM-DD). Run: node --test scripts/lib/unit-step-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the CLI tests pass --dir, so a
// project's own STEPS_DIR keeps them green.
// Hermetic: the wrapper runs in a temp directory with a fresh HOME.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MAX_ROUND,
  checkNext,
  formatIntervals,
  formatMinutes,
  label,
  parseArgs,
  parseSteps,
  stepIntervals,
  stepLine,
} from './unit-step-core.mjs';

const RUNNER = fileURLToPath(new URL('../unit-step.mjs', import.meta.url));
const MIN = 60_000;

const tempDirs = [];
function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** One marker as parseSteps returns it, `min` minutes after 01:00Z. */
function mark(step, event, min, round = 1) {
  const t = new Date(Date.parse('2026-10-26T01:00:00Z') + min * MIN).toISOString();
  return { t, ts: Date.parse(t), unit: 'U-1', step, event, round };
}

test('parseArgs reads the unit, the step and the event, with --round, --dir and --at', () => {
  const a = parseArgs(['EP-27.03', '8b', 'start', '--round', '2', '--dir', 'x/y', '--at', '2026-10-26T01:00:00Z']);
  assert.equal(a.unit, 'EP-27.03');
  assert.equal(a.step, '8b');
  assert.equal(a.event, 'start');
  assert.equal(a.round, 2);
  assert.equal(a.dir, 'x/y');
  assert.equal(a.at, '2026-10-26T01:00:00Z');
  assert.equal(parseArgs(['U-1', '0a', 'done']).round, 1);
  const list = parseArgs(['U-1', '--list']);
  assert.equal(list.list, true);
  assert.equal(list.step, null);
});

test('parseArgs rejects a wrong count, a path in the unit id, a bad step, event or round, a bad --at and an unknown flag', () => {
  assert.throws(() => parseArgs(['U-1', '8b']), /needs <unit> <step> start\|done/);
  assert.throws(() => parseArgs(['U-1', '8b', 'start', 'extra']), /needs <unit>/);
  assert.throws(() => parseArgs(['../U-1', '8b', 'start']), /bad unit id/);
  assert.throws(() => parseArgs(['a/b', '8b', 'start']), /bad unit id/);
  assert.throws(() => parseArgs(['U-1', '8 b', 'start']), /bad step/);
  assert.throws(() => parseArgs(['U-1', '8b', 'begin']), /start or done/);
  assert.throws(() => parseArgs(['U-1', '8b', 'start', '--round', '0']), /--round/);
  assert.throws(() => parseArgs(['U-1', '8b', 'start', '--round', String(MAX_ROUND + 1)]), /--round/);
  assert.throws(() => parseArgs(['U-1', '8b', 'start', '--round', '1.5']), /--round/);
  assert.throws(() => parseArgs(['U-1', '8b', 'start', '--at', 'yesterday']), /not an ISO time/);
  assert.throws(() => parseArgs(['U-1', '8b', 'start', '--dir']), /needs a value/);
  assert.throws(() => parseArgs(['U-1', '8b', 'start', '--wat']), /unknown option --wat/);
  assert.throws(() => parseArgs(['U-1', '8b', '--list']), /--list takes the unit id only/);
});

test('stepLine and parseSteps round-trip; torn, foreign and incomplete lines are skipped; round defaults to 1', () => {
  const line = stepLine({ t: '2026-10-26T01:00:00.000Z', unit: 'U-1', step: '8b', event: 'start', round: 2 });
  const text = [
    line,
    '{"t":"2026-10-26T01:05:00Z","step":"8b","event":"done"}',
    '{"t":"2026-10-26T01:0',
    '[1,2]',
    '{"t":"not a time","step":"8c","event":"start"}',
    '{"t":"2026-10-26T01:06:00Z","step":"","event":"start"}',
    '{"t":"2026-10-26T01:07:00Z","step":"9","event":"paused"}',
    '',
  ].join('\n');
  const m = parseSteps(text);
  assert.equal(m.length, 2);
  assert.deepEqual(
    m.map((x) => [x.unit, x.step, x.event, x.round]),
    [
      ['U-1', '8b', 'start', 2],
      ['', '8b', 'done', 1],
    ],
  );
  assert.equal(m[0].ts, Date.parse('2026-10-26T01:00:00Z'));
});

test('stepIntervals pairs each start with its done, in time order whatever the file order', () => {
  const { intervals, problems } = stepIntervals([mark('1', 'done', 10), mark('0a', 'start', 0), mark('0a', 'done', 3), mark('1', 'start', 3)]);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    intervals.map((iv) => [label(iv), (iv.end - iv.start) / MIN, iv.implicit, iv.open]),
    [
      ['0a r1', 3, false, false],
      ['1 r1', 7, false, false],
    ],
  );
});

test('a start while another step is open closes that one at the new start; a repeated start is ignored', () => {
  const { intervals, problems } = stepIntervals([
    mark('4', 'start', 0),
    mark('5', 'start', 20),
    mark('5', 'start', 25),
    mark('5', 'done', 30),
  ]);
  assert.deepEqual(
    intervals.map((iv) => [label(iv), iv.start, iv.end, iv.implicit]),
    [
      ['4 r1', mark('4', 'start', 0).ts, mark('5', 'start', 20).ts, true],
      ['5 r1', mark('5', 'start', 20).ts, mark('5', 'done', 30).ts, false],
    ],
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /repeated start of 5 r1/);
});

test('a done that matches no open step is a problem and never becomes an interval; rounds are distinct steps', () => {
  const { intervals, problems } = stepIntervals([mark('8b', 'done', 5), mark('8c', 'start', 6, 1), mark('8c', 'done', 9, 2)]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /done of 8b r1 .* matches no open step/);
  assert.match(problems[1], /done of 8c r2 /);
  assert.equal(intervals.length, 1);
  assert.equal(label(intervals[0]), '8c r1');
  assert.equal(intervals[0].open, true);
});

test('a step still open at the end runs to untilMs, or has no end without it', () => {
  const marks = [mark('6', 'start', 0)];
  const until = mark('x', 'start', 45).ts;
  const withEnd = stepIntervals(marks, until).intervals[0];
  assert.equal(withEnd.open, true);
  assert.equal(withEnd.end, until);
  assert.equal(stepIntervals(marks).intervals[0].end, null);
  // An untilMs before the start is not a time the step ran to.
  assert.equal(stepIntervals(marks, mark('x', 'start', -5).ts).intervals[0].end, null);
});

test('checkNext warns on a done with no start, a done for another step, a repeated start and a marker earlier than the last', () => {
  assert.match(checkNext([], mark('8b', 'done', 1)), /no step is open/);
  assert.match(checkNext([mark('8b', 'start', 0)], mark('8c', 'done', 1)), /the open step is 8b r1, not 8c r1/);
  assert.match(checkNext([mark('8b', 'start', 0)], mark('8b', 'start', 1)), /8b r1 is already open/);
  assert.match(checkNext([mark('8b', 'start', 10)], mark('8c', 'start', 5)), /earlier than the last marker/);
  assert.equal(checkNext([mark('8b', 'start', 0)], mark('8b', 'done', 4)), '');
  assert.equal(checkNext([mark('8b', 'start', 0)], mark('8c', 'start', 4)), '');
});

test('formatMinutes and formatIntervals print durations, open steps and every problem; a step the next start closed has no note', () => {
  assert.equal(formatMinutes(59_999), '0m');
  assert.equal(formatMinutes(37 * MIN), '37m');
  assert.equal(formatMinutes(65 * MIN), '1h05m');
  const text = formatIntervals(stepIntervals([mark('4', 'start', 0), mark('5', 'start', 20), mark('9', 'done', 25)]));
  assert.match(text, /^4 r1 +2026-10-26 01:00 → 01:20 {2}20m$/m);
  assert.match(text, /^5 r1 +2026-10-26 01:20 → open \(open\)$/m);
  assert.match(text, /^! done of 9 r1 /m);
  assert.equal(formatIntervals({ intervals: [], problems: [] }), 'no step markers\n');
});

function cli(cwd, args) {
  const env = { ...process.env, HOME: tmpDir('unit-step-home-') };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return spawnSync(process.execPath, [RUNNER, ...args], { cwd, env, encoding: 'utf8' });
}

test('the wrapper appends one line per marker to <dir>/<unit>.steps.jsonl and --list prints the intervals', () => {
  const root = tmpDir('unit-step-cli-');
  const dir = path.join(root, 'plans');
  const at = (min) => new Date(Date.parse('2026-10-26T01:00:00Z') + min * MIN).toISOString();
  const start = cli(root, ['U-1', '8b', 'start', '--dir', dir, '--at', at(0)]);
  assert.equal(start.status, 0, start.stderr);
  assert.equal(start.stderr, '');
  assert.match(start.stdout, /^unit-step: U-1 8b r1 start 2026-10-26T01:00:00\.000Z\n$/);
  assert.equal(cli(root, ['U-1', '8b', 'done', '--dir', dir, '--at', at(14)]).status, 0);
  const lines = fs.readFileSync(path.join(dir, 'U-1.steps.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]), { t: at(14), unit: 'U-1', step: '8b', event: 'done', round: 1 });
  const list = cli(root, ['U-1', '--list', '--dir', dir]);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /^8b r1 +2026-10-26 01:00 → 01:14 {2}14m$/m);
});

test('the wrapper appends an out-of-order marker with a warning, and exits 2 on bad arguments without writing', () => {
  const root = tmpDir('unit-step-cli-');
  const dir = path.join(root, 'plans');
  const done = cli(root, ['U-1', '8b', 'done', '--dir', dir]);
  assert.equal(done.status, 0);
  assert.match(done.stderr, /warning: no step is open/);
  assert.equal(fs.readFileSync(path.join(dir, 'U-1.steps.jsonl'), 'utf8').trim().split('\n').length, 1);
  const bad = cli(root, ['U/1', '8b', 'start', '--dir', path.join(root, 'other')]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: node scripts\/unit-step\.mjs/);
  assert.equal(fs.existsSync(path.join(root, 'other')), false);
});
