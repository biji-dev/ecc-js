// harness-bootstrap unit-step tests (generated YYYY-MM-DD). Run: node --test scripts/lib/unit-step-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the CLI tests pass --dir and read
// MAIN_CHECKOUT_STEPS from the core, so a project's own bindings keep them green.
// Hermetic: the wrapper runs in a temp directory with a fresh HOME; the branch cases run in throwaway
// git repositories that no GIT_* variable or global config reaches.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MAIN_CHECKOUT_STEPS,
  MAX_ROUND,
  UNIT_ID_SOURCE,
  branchCheck,
  branchMatchesUnit,
  checkNext,
  formatIntervals,
  formatMinutes,
  label,
  parseArgs,
  parseSteps,
  parseWorktrees,
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
  assert.throws(() => parseArgs(['a/b/c', '8b', 'start']), /bad unit id/);
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

test('parseArgs reads --check <unit>, --where and --where <unit> [--dir], and refuses them with anything else', () => {
  const check = parseArgs(['--check', 'EP-7']);
  assert.deepEqual([check.check, check.where, check.list, check.unit, check.step], [true, false, false, 'EP-7', null]);
  assert.equal(parseArgs(['harness/x', '--check']).unit, 'harness/x');
  const where = parseArgs(['--where']);
  assert.deepEqual([where.where, where.check, where.unit, where.dir], [true, false, null, null]);
  const named = parseArgs(['--where', 'EP-7', '--dir', 'x/y']);
  assert.deepEqual([named.where, named.unit, named.dir], [true, 'EP-7', 'x/y']);
  assert.throws(() => parseArgs(['--check']), /--check takes the unit id only/);
  assert.throws(() => parseArgs(['--check', 'EP-7', '8', 'start']), /--check takes the unit id only/);
  assert.throws(() => parseArgs(['--where', 'EP-7', 'EP-8']), /--where takes one unit id at most/);
  for (const extra of [['--list'], ['--round', '2'], ['--at', '2026-10-26T01:00:00Z']]) {
    assert.throws(() => parseArgs(['--check', 'EP-7', ...extra]), /--check runs alone/, extra[0]);
    assert.throws(() => parseArgs(['--where', 'EP-7', ...extra]), /--where runs alone/, extra[0]);
  }
  assert.throws(() => parseArgs(['--check', 'EP-7', '--dir', 'x']), /--check runs alone, not with --dir/);
  assert.throws(() => parseArgs(['--check', '--where', 'EP-7']), /runs alone/);
  assert.throws(() => parseArgs(['--check', '../x']), /bad unit id/);
  assert.throws(() => parseArgs(['--where', 'a/b/c']), /bad unit id/);
  assert.throws(() => parseArgs(['--where', '--wat']), /unknown option --wat/);
});

test('parseArgs takes a unit id of one segment, or two joined by one slash, and refuses every other path', () => {
  assert.equal(parseArgs(['harness/x', '0', 'start']).unit, 'harness/x');
  assert.equal(parseArgs(['harness/sweep-2026-10-28', '0', 'start']).unit, 'harness/sweep-2026-10-28');
  assert.equal(parseArgs(['change/fix-login', '0', 'done']).unit, 'change/fix-login');
  assert.equal(parseArgs(['harness/x', '--list']).unit, 'harness/x');
  for (const bad of ['../x', '/x', 'x/', 'a//b', 'a/b/c', 'x/..', 'x/.hidden', '.x/y', 'x/../y']) {
    assert.throws(() => parseArgs([bad, '0', 'start']), /bad unit id/, bad);
    assert.throws(() => parseArgs([bad, '--list']), /bad unit id/, bad);
  }
  assert.match(UNIT_ID_SOURCE, /\//);
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

test('branchMatchesUnit takes the unit id as a whole branch segment or a segment prefix before - _ or ., in any case', () => {
  const cases = [
    ['task/EP-7-login', 'EP-7', true],
    ['task/EP-70', 'EP-7', false],
    ['EP-7', 'EP-7', true],
    ['harness/proportional-tier', 'proportional-tier', true],
    ['harness/fu-10-edit-guard-scope', 'fu-10', true],
    ['change/fix-login', 'change/fix-login', true],
    ['harness/sweep-2026-10-28', 'sweep-2026-10-28', true],
    ['harness/sweep-2026-10-28', 'harness/sweep-2026-10-28', true],
    ['main', 'EP-7', false],
    ['task/xEP-7', 'EP-7', false],
    ['task/ep-7-login', 'EP-7', true],
    ['task/EP-7.2', 'EP-7', true],
    ['task/EP-7_b', 'EP-7', true],
  ];
  for (const [branch, unit, want] of cases) assert.equal(branchMatchesUnit(branch, unit), want, `${branch} x ${unit}`);
  // A unit id is matched literally: its `.` is no wildcard.
  assert.equal(branchMatchesUnit('task/EPx7', 'EP.7'), false);
});

test('branchCheck lets an exempt step run anywhere, refuses a wrong branch, and lets no branch or a detached HEAD through', () => {
  assert.deepEqual(MAIN_CHECKOUT_STEPS.map((step) => branchCheck({ unit: 'EP-7', step, branch: 'main' })), MAIN_CHECKOUT_STEPS.map(() => ({ ok: true })));
  assert.deepEqual(branchCheck({ unit: 'EP-7', step: '11', branch: 'main', mainCheckoutSteps: ['0', '11'] }), { ok: true });
  assert.equal(branchCheck({ unit: 'EP-7', step: '0', branch: 'main', mainCheckoutSteps: ['11'] }).ok, false);
  assert.deepEqual(branchCheck({ unit: 'EP-7', step: '8', branch: 'task/EP-7-login' }), { ok: true });
  assert.deepEqual(branchCheck({ unit: 'EP-7', step: '8', branch: 'task/EP-8' }), {
    ok: false,
    reason: 'EP-7 runs on its own branch; this checkout is on task/EP-8',
  });
  assert.deepEqual(branchCheck({ unit: 'EP-7', step: '8', branch: null }), { ok: true });
  assert.deepEqual(branchCheck({ unit: 'EP-7', step: '8', branch: 'HEAD' }), { ok: true });
  // --check (step null): nothing is exempt, so the main checkout is refused.
  assert.deepEqual(branchCheck({ unit: 'EP-7', step: null, branch: 'main' }), {
    ok: false,
    reason: 'EP-7 runs on its own branch; this checkout is on main',
  });
  assert.deepEqual(branchCheck({ unit: 'EP-7', step: null, branch: 'task/EP-7' }), { ok: true });
});

test('parseWorktrees reads each porcelain block; a detached or bare worktree has no branch; other keys are ignored', () => {
  const text = [
    'worktree /repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /repo/.worktrees/ep-7',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/task/EP-7-login',
    'locked reason given',
    '',
    'worktree /repo/.worktrees/snap',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\n');
  assert.deepEqual(parseWorktrees(text), [
    { path: '/repo', branch: 'main', head: '1111111111111111111111111111111111111111', detached: false, bare: false },
    { path: '/repo/.worktrees/ep-7', branch: 'task/EP-7-login', head: '2222222222222222222222222222222222222222', detached: false, bare: false },
    { path: '/repo/.worktrees/snap', branch: null, head: '3333333333333333333333333333333333333333', detached: true, bare: false },
  ]);
  assert.deepEqual(parseWorktrees('worktree /bare.git\nbare\n'), [{ path: '/bare.git', branch: null, head: null, detached: false, bare: true }]);
  assert.deepEqual(parseWorktrees(''), []);
});

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

function hermeticEnv() {
  const env = { ...process.env, HOME: tmpDir('unit-step-home-') };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return Object.assign(env, GIT_ENV);
}

function cli(cwd, args) {
  return spawnSync(process.execPath, [RUNNER, ...args], { cwd, env: hermeticEnv(), encoding: 'utf8' });
}

const GIT = hermeticEnv();
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT });

/** Makes `dir` a git repository with one commit on `branch`. */
function gitRepo(dir, branch) {
  assert.equal(git(dir, 'init', '-q', '-b', branch).status, 0, 'git init');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'README'), '0\n');
  git(dir, 'add', 'README');
  assert.equal(git(dir, 'commit', '-q', '-m', 'init').status, 0, 'the first commit');
}

const PLANS = path.join('docs', 'plans');
const WORK_STEP = '2';

/**
 * A repository on main with two linked worktrees: harness/lane-a holding unit lane-a's steps file and
 * harness/lane-b holding the nested unit harness/lane-b's. The main checkout holds landed units' files.
 */
function lanes() {
  const root = tmpDir('unit-step-repo-');
  const main = path.join(root, 'main');
  fs.mkdirSync(main);
  gitRepo(main, 'main');
  const marker = (unit, step, event, min) => `${stepLine({ t: new Date(Date.parse('2026-10-26T01:00:00Z') + min * MIN).toISOString(), unit, step, event, round: 1 })}\n`;
  fs.mkdirSync(path.join(main, PLANS, 'harness'), { recursive: true });
  fs.writeFileSync(path.join(main, PLANS, 'EP-1.steps.jsonl'), marker('EP-1', '9', 'done', 0));
  fs.writeFileSync(path.join(main, PLANS, 'harness', 'landed.steps.jsonl'), marker('harness/landed', '9', 'done', 0));
  const files = {};
  for (const [lane, unit] of [['lane-a', 'lane-a'], ['lane-b', 'harness/lane-b']]) {
    const wt = path.join(root, lane);
    const r = git(main, 'worktree', 'add', '-q', wt, '-b', `harness/${lane}`);
    assert.equal(r.status, 0, `git worktree add: ${r.stderr}`);
    files[lane] = path.join(wt, PLANS, `${unit}.steps.jsonl`);
    fs.mkdirSync(path.dirname(files[lane]), { recursive: true });
    fs.writeFileSync(files[lane], marker(unit, '1', 'start', 0) + marker(unit, '1', 'done', 5));
  }
  return { main, a: path.join(root, 'lane-a'), b: path.join(root, 'lane-b'), files };
}

const lineCount = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').length;

test('a marker off the unit\'s branch is refused, appends nothing and names the unit\'s checkout', () => {
  const w = lanes();
  const before = { a: lineCount(w.files['lane-a']), b: lineCount(w.files['lane-b']) };
  const fromMain = cli(w.main, ['lane-a', WORK_STEP, 'start', '--dir', PLANS]);
  assert.equal(fromMain.status, 1, fromMain.stderr);
  assert.match(fromMain.stderr, /^unit-step: refused: lane-a runs on its own branch; this checkout is on main$/m);
  assert.ok(fromMain.stderr.includes(`unit-step: the unit's checkout: cd ${w.a}\n`), fromMain.stderr);
  assert.equal(fromMain.stdout, '');
  const fromB = cli(w.b, ['lane-a', WORK_STEP, 'done', '--dir', path.join(w.a, PLANS)]);
  assert.equal(fromB.status, 1, fromB.stderr);
  assert.match(fromB.stderr, /this checkout is on harness\/lane-b$/m);
  assert.ok(fromB.stderr.includes(`cd ${w.a}\n`), fromB.stderr);
  const nobody = cli(w.main, ['EP-9', WORK_STEP, 'start', '--dir', PLANS]);
  assert.equal(nobody.status, 1);
  assert.match(nobody.stderr, /^unit-step: no worktree is on a branch for EP-9$/m);
  assert.deepEqual({ a: lineCount(w.files['lane-a']), b: lineCount(w.files['lane-b']) }, before);
  assert.equal(fs.existsSync(path.join(w.main, PLANS, 'lane-a.steps.jsonl')), false);
  assert.equal(fs.existsSync(path.join(w.main, PLANS, 'EP-9.steps.jsonl')), false);
  assert.equal(fs.existsSync(path.join(w.b, PLANS, 'lane-a.steps.jsonl')), false);
});

test('a marker on the unit\'s branch lands, and the main-checkout steps land from the main checkout', () => {
  const w = lanes();
  const own = cli(w.a, ['lane-a', WORK_STEP, 'start', '--dir', PLANS]);
  assert.equal(own.status, 0, own.stderr);
  assert.equal(own.stderr, '');
  assert.equal(lineCount(w.files['lane-a']), 3);
  const nested = cli(w.b, ['harness/lane-b', WORK_STEP, 'start', '--dir', PLANS]);
  assert.equal(nested.status, 0, nested.stderr);
  assert.equal(lineCount(w.files['lane-b']), 3);
  for (const step of MAIN_CHECKOUT_STEPS) {
    const r = cli(w.main, ['lane-a', step, 'start', '--dir', PLANS]);
    assert.equal(r.status, 0, `${step}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /refused/);
  }
  assert.equal(lineCount(path.join(w.main, PLANS, 'lane-a.steps.jsonl')), MAIN_CHECKOUT_STEPS.length);
  // --list is never refused.
  assert.equal(cli(w.main, ['lane-a', '--list', '--dir', path.join(w.a, PLANS)]).status, 0);
});

test('outside a git checkout or on a detached HEAD a marker lands with a warning', () => {
  const w = lanes();
  assert.equal(git(w.a, 'switch', '-q', '--detach').status, 0);
  const detached = cli(w.a, ['EP-9', WORK_STEP, 'start', '--dir', PLANS]);
  assert.equal(detached.status, 0, detached.stderr);
  assert.match(detached.stderr, /^unit-step: warning: detached HEAD, branch not checked$/m);
  const bare = tmpDir('unit-step-nogit-');
  const outside = cli(bare, ['EP-9', WORK_STEP, 'start', '--dir', bare]);
  assert.equal(outside.status, 0, outside.stderr);
  assert.match(outside.stderr, /^unit-step: warning: not in a git checkout, branch not checked$/m);
  assert.equal(lineCount(path.join(bare, 'EP-9.steps.jsonl')), 1);
});

test('--where lists every unit worktree with its last marker and picks one only when it is the only one', () => {
  const w = lanes();
  const all = cli(w.main, ['--where', '--dir', PLANS]);
  assert.equal(all.status, 1, all.stderr);
  assert.equal(
    all.stdout,
    [
      `lane-a · harness/lane-a · ${w.a} · 1 r1 done 2026-10-26T01:05:00.000Z`,
      `harness/lane-b · harness/lane-b · ${w.b} · 1 r1 done 2026-10-26T01:05:00.000Z`,
      '',
    ].join('\n'),
  );
  assert.match(all.stderr, /^unit-step: 2 candidates: name the unit \(\/task-runner <unit>\)$/m);
  const one = cli(w.main, ['--where', 'lane-a', '--dir', PLANS]);
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stdout, `lane-a · harness/lane-a · ${w.a} · 1 r1 done 2026-10-26T01:05:00.000Z\n`);
  fs.rmSync(w.files['lane-a']);
  assert.equal(cli(w.main, ['--where', 'lane-a', '--dir', PLANS]).stdout, `lane-a · harness/lane-a · ${w.a} · no markers\n`);
  const none = cli(w.main, ['--where', 'EP-1', '--dir', PLANS]);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /^unit-step: no worktree is on a branch for EP-1$/m);
  const nogit = cli(tmpDir('unit-step-nogit-'), ['--where']);
  assert.equal(nogit.status, 1);
  assert.match(nogit.stderr, /^unit-step: no unit worktree found$/m);
});

test('--check passes on the unit\'s branch and refuses everywhere else, writing nothing', () => {
  const w = lanes();
  const own = cli(w.a, ['--check', 'lane-a']);
  assert.equal(own.status, 0, own.stderr);
  assert.equal(own.stdout, `unit-step: lane-a on harness/lane-a (${w.a})\n`);
  const main = cli(w.main, ['--check', 'lane-a']);
  assert.equal(main.status, 1);
  assert.match(main.stderr, /^unit-step: refused: lane-a runs on its own branch; this checkout is on main$/m);
  assert.ok(main.stderr.includes(`cd ${w.a}\n`), main.stderr);
  assert.equal(cli(w.b, ['--check', 'lane-a']).status, 1);
  assert.equal(fs.existsSync(path.join(w.main, PLANS, 'lane-a.steps.jsonl')), false);
});

test('the wrapper appends one line per marker to <dir>/<unit>.steps.jsonl and --list prints the intervals', () => {
  const root = tmpDir('unit-step-cli-');
  gitRepo(root, 'task/U-1');
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
  const bad = cli(root, ['U//1', '8b', 'start', '--dir', path.join(root, 'other')]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: node scripts\/unit-step\.mjs/);
  assert.equal(fs.existsSync(path.join(root, 'other')), false);
});

test('the wrapper nests a harness/<slug> unit under its first segment, beside its state file, and --list reads it back', () => {
  const root = tmpDir('unit-step-cli-');
  const dir = path.join(root, 'plans');
  const at = (min) => new Date(Date.parse('2026-10-26T01:00:00Z') + min * MIN).toISOString();
  const start = cli(root, ['harness/x', '0', 'start', '--dir', dir, '--at', at(0)]);
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /^unit-step: harness\/x 0 r1 start /);
  const file = path.join(dir, 'harness', 'x.steps.jsonl');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8').trim()).unit, 'harness/x');
  assert.equal(fs.existsSync(path.join(dir, 'x.steps.jsonl')), false);
  assert.equal(cli(root, ['harness/x', '0', 'done', '--dir', dir, '--at', at(9)]).status, 0);
  const list = cli(root, ['--list', 'harness/x', '--dir', dir]);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /^0 r1 +2026-10-26 01:00 → 01:09 {2}9m$/m);
});
