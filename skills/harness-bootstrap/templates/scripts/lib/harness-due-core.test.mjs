// harness-bootstrap harness-due tests (generated YYYY-MM-DD). Run: node --test scripts/lib/harness-due-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the tests pass their own templates and
// patterns, or read the bindings, never their values; a wrapper test a binding cannot express asserts
// that binding's own behaviour instead, never skips (a skip fails the project's counted gate).
// Hermetic: the wrapper tests run in a temp git repo with every GIT_* variable stripped,
// GIT_CONFIG_GLOBAL=/dev/null, a fixed identity and dated commits, and a temp --home.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { blameDates } from './retro-gather.mjs';
import {
  CADENCE,
  FOLLOW_UPS,
  LOG,
  MAIN,
  REBUILDABLE,
  REPORTS,
  WORKTREE_IDLE_HOURS,
  cadenceDue,
  checkAll,
  diskDue,
  formatDue,
  markSeen,
  matchReports,
  newestProposals,
  p3Due,
  p3Note,
  parseArgs,
  parseWorktrees,
  phaseOf,
  preflightDue,
  projectName,
  proposalCounts,
  proposalsDue,
  reportShape,
  worktreesDue,
} from './harness-due-core.mjs';

const RUNNER = fileURLToPath(new URL('../harness-due.mjs', import.meta.url));
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const at = (s) => Date.parse(`2026-10-${s}Z`);
const PHASE = /^([A-Za-z]+-?\d+)[-.]\w/;
const PREFLIGHT = 'docs/preflight/<phase>.md';
const fill = (template, value) => template.replace(/<\w+>/, value);

const tempDirs = [];
function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const LOG_HEAD = ['Unit · Mode · Type · Tier', 'Elapsed (work)', 'Cost'];
const logRow = (id) => `| ${id} · plan · Code · Small | 60m | Cost $1 |`;

test('parseArgs takes a claim, --seen, --json, --now and --home, and rejects the rest', () => {
  assert.deepEqual(parseArgs([]), { claim: null, seen: null, json: false, now: null, home: null });
  assert.deepEqual(parseArgs(['--claim', 'P2-01', '--json', '--now', '2026-10-26T00:00:00Z', '--home', 'h']), {
    claim: 'P2-01',
    seen: null,
    json: true,
    now: '2026-10-26T00:00:00Z',
    home: 'h',
  });
  assert.equal(parseArgs(['--claim', 'harness/hygiene-2026-10-26']).claim, 'harness/hygiene-2026-10-26');
  assert.equal(parseArgs(['--seen', '2026-W44']).seen, '2026-W44');
  assert.throws(() => parseArgs(['--claim']), /--claim needs a value/);
  assert.throws(() => parseArgs(['--claim', '../P2-01']), /bad row id/);
  assert.throws(() => parseArgs(['--seen', '2026-44']), /--seen takes a week/);
  assert.throws(() => parseArgs(['--seen', '2026-W44', '--claim', 'P2-01']), /checks nothing/);
  assert.throws(() => parseArgs(['--now', 'soon']), /--now is not an ISO time/);
  assert.throws(() => parseArgs(['--fix']), /unknown option --fix/);
  assert.throws(() => parseArgs(['P2-01']), /unexpected argument "P2-01"/);
});

test('phaseOf takes the phase from a row id; an id outside every phase has none', () => {
  assert.equal(phaseOf('P2-16', PHASE), 'P2');
  assert.equal(phaseOf('EP-27.04', PHASE), 'EP-27');
  assert.equal(phaseOf('p3-12a', PHASE), 'p3');
  for (const id of ['T-DATA-037', 'CR-021', 'harness/hygiene-2026-10-26', 'P2', '', null]) assert.equal(phaseOf(id, PHASE), null);
});

test('reportShape keeps the placeholder in the file name, and matchReports finds a directory\'s reports', () => {
  assert.deepEqual(matchReports('docs/sweeps/<date>.md', ['2026-10-18.md', 'latest.md', '2026-10-18.md.bak', 'README.md']), [
    { rel: 'docs/sweeps/2026-10-18.md', value: '2026-10-18' },
  ]);
  assert.deepEqual(matchReports('r/retro-<week>.md', ['retro-2026-W43.md', 'retro-2026-43.md']), [{ rel: 'r/retro-2026-W43.md', value: '2026-W43' }]);
  assert.deepEqual(matchReports(PREFLIGHT, ['P2.md', 'p3.md', 'P2-notes.md']).map((r) => r.value), ['P2', 'p3']);
  assert.throws(() => reportShape('docs/<phase>/report.md'), /belongs in its file name/);
  assert.throws(() => reportShape('docs/<phase>-<date>.md'), /carries one of/);
  assert.throws(() => reportShape('docs/<slug>.md'), /carries one of/);
  for (const template of Object.values(REPORTS).filter((t) => t !== null)) assert.ok(reportShape(template));
});

test('preflightDue blocks the claim of the row that opens a phase with no report, and only names a phase under way', () => {
  const base = { reports: [], template: PREFLIGHT, pattern: PHASE, command: 'preflight <phase>' };
  const opens = preflightDue({ ...base, claim: 'P2-01', logIds: ['P1-01', 'P1-02'], merges: ['Merge task/p1-02: done'] });
  assert.deepEqual(opens, {
    kind: 'preflight',
    subject: 'P2',
    why: 'no report at docs/preflight/P2.md, and P2-01 opens the phase: the claim waits for it',
    command: 'preflight P2',
    blocking: true,
  });
  const underWay = preflightDue({ ...base, claim: 'P1-03', logIds: ['P1-01', 'P1-02'], merges: [] });
  assert.equal(underWay.blocking, false);
  assert.match(underWay.why, /the phase is under way \(2 log rows, 0 merges\)$/);
  // a merge of the phase counts, in any case; another phase's id that ends the same way does not
  const merged = preflightDue({ ...base, claim: 'P2-02', logIds: [], merges: ['Merge task/p2-01: first', 'Merge EP2-01: other'] });
  assert.equal(merged.blocking, false);
  assert.match(merged.why, /\(0 log rows, 1 merge\)$/);
  assert.equal(preflightDue({ ...base, claim: 'P2-01', logIds: [], merges: ['Merge EP2-01: other', 'Merge P21-01: later'] }).blocking, true);
  // a report clears it, whatever its case; no phase, no claim or no binding: nothing to check
  assert.equal(preflightDue({ ...base, claim: 'p2-01', reports: [{ rel: 'docs/preflight/P2.md', time: NOW }] }), null);
  assert.equal(preflightDue({ ...base, claim: 'CR-021' }), null);
  assert.equal(preflightDue({ ...base, claim: null }), null);
  assert.equal(preflightDue({ ...base, claim: 'P2-01', template: null }), null);
});

test('cadenceDue: due at its days or its landings (log rows or merges, the larger) since the newest report, from the log\'s birth when there is none', () => {
  const cadence = { days: 7, landings: 5 };
  const reports = [{ rel: 'r/sweep-2026-10-11.md', time: at('11T10:00:00') }, { rel: 'r/sweep-2026-10-18.md', time: at('18T10:00:00') }];
  const landed = ['19', '20', '21', '22', '23'].map((d) => at(`${d}T10:00:00`));
  assert.deepEqual(cadenceDue('sweep', { reports, landed, now: NOW, cadence, command: 'sweep on <date>' }), {
    kind: 'sweep',
    subject: null,
    why: '8 d, 5 landings since sweep-2026-10-18.md',
    command: 'sweep on 2026-10-26',
    blocking: false,
  });
  // under both: nothing; the landings alone; the days alone
  assert.equal(cadenceDue('sweep', { reports, landed: landed.slice(0, 4), now: at('24T12:00:00'), cadence }), null);
  assert.match(cadenceDue('sweep', { reports, landed, now: at('24T12:00:00'), cadence }).why, /^6 d, 5 landings/);
  assert.match(cadenceDue('sweep', { reports, landed: [], now: NOW, cadence }).why, /^8 d, 0 landings/);
  // a row the log's table does not parse still merged: the larger count wins
  assert.match(cadenceDue('sweep', { reports, landed: landed.slice(0, 2), merged: [at('17T10:00:00'), ...landed], now: at('24T12:00:00'), cadence }).why, /^6 d, 5 landings/);
  assert.equal(cadenceDue('sweep', { reports, landed: landed.slice(0, 2), merged: landed.slice(0, 3), now: at('24T12:00:00'), cadence }), null);
  // by days only: landings never make it due
  assert.equal(cadenceDue('retro', { reports, landed, now: at('24T12:00:00'), cadence: { days: 7, landings: null } }), null);
  // no report: from the log's first commit; no log either: due, and said so
  assert.match(cadenceDue('hygiene', { landed, logBorn: at('17T10:00:00'), now: NOW, cadence: { days: 14, landings: 5 } }).why, /^9 d, 5 landings since the log began, and no report yet$/);
  assert.equal(cadenceDue('hygiene', { landed: landed.slice(0, 2), logBorn: at('17T10:00:00'), now: NOW, cadence: { days: 14, landings: 5 } }), null);
  assert.match(cadenceDue('sweep', { now: NOW, cadence }).why, /^no report yet, and no log to count from/);
});

test('the P3 queue is named on the hygiene line, and due on its own only with no hygiene unit bound', () => {
  const summary = { openP3: 12, oldestOpenP3Days: 20 };
  assert.equal(p3Note(summary), '; 12 open P3, the oldest 20 d');
  assert.equal(p3Note({ openP3: 2, oldestOpenP3Days: null }), '; 2 open P3');
  assert.equal(p3Note({ openP3: 0, oldestOpenP3Days: null }), '');
  assert.equal(p3Note(null), '');
  assert.equal(p3Due({ summary, hygieneBound: true, now: NOW }), null);
  assert.deepEqual(p3Due({ summary, hygieneBound: false, now: NOW, ageDays: 14, command: 'batch <date>' }), {
    kind: 'p3',
    subject: null,
    why: '12 open P3, the oldest 20 d (over 14)',
    command: 'batch 2026-10-26',
    blocking: false,
  });
  assert.equal(p3Due({ summary: { openP3: 12, oldestOpenP3Days: 13 }, hygieneBound: false, now: NOW, ageDays: 14 }), null);
});

test('p3Note and p3Due name the oldest open P3 row when the summary knows it, and read as before when it does not', () => {
  const summary = { openP3: 12, oldestOpenP3Days: 20, oldestOpenP3Row: 'FU-3' };
  assert.equal(p3Note(summary), '; 12 open P3, the oldest FU-3 at 20 d', 'p3Note names the row');
  assert.equal(p3Note({ ...summary, oldestOpenP3Row: null }), '; 12 open P3, the oldest 20 d');
  assert.equal(p3Note({ openP3: 2, oldestOpenP3Days: null, oldestOpenP3Row: null }), '; 2 open P3');
  assert.equal(p3Due({ summary, hygieneBound: false, now: NOW, ageDays: 14, command: 'batch <date>' }).why, '12 open P3, the oldest FU-3 at 20 d (over 14)', 'p3Due names the row');
  assert.equal(p3Due({ summary: { ...summary, oldestOpenP3Row: null }, hygieneBound: false, now: NOW, ageDays: 14 }).why, '12 open P3, the oldest 20 d (over 14)');
});

test('checkAll counts a P3 by the Severity cell when the doc has one: a P1 row that names P3 elsewhere is not counted, and the oldest P3 is named', () => {
  const fuText = `${table(['#', 'Severity', 'Area', 'Status'], [['FU-1', 'P1', 'the P3 cleanup of a.ts', 'open'], ['FU-2', 'P3', 'b.ts', 'open']])}\n`;
  const fuDates = new Map([[3, NOW - 90 * DAY], [4, NOW - 60 * DAY]]);
  const items = checkAll({ now: NOW, log: null, followUps: { text: fuText, dates: fuDates }, reports: {}, merges: [], worktrees: [], proposals: null, seen: {}, project: 'p' });
  const line = items.find((i) => i.kind === 'hygiene' || i.kind === 'p3');
  assert.ok(line, `no hygiene or p3 line: ${items.map((i) => i.kind)}`);
  assert.match(line.why, /1 open P3, the oldest FU-2 at 60 d/, 'one P3, and it is FU-2');
});

test('diskDue: under the minimum it runs the approved categories, or says none is approved; with what the last sweep freed', () => {
  assert.equal(diskDue({ free: 30e9, minGb: 25, approved: ['pnpm'] }), null);
  const due = diskDue({ free: 21.5e9, minGb: 25, approved: ['pnpm', 'uv'], last: { t: '2026-10-20T09:00:00Z', freed: 3.14e9 }, command: 'sweep --apply-approved' });
  assert.deepEqual(due, {
    kind: 'disk',
    subject: null,
    why: '21.5 GB free, under 25; the last sweep (2026-10-20) freed 3.1 GB; approved: pnpm, uv',
    command: 'sweep --apply-approved',
    blocking: false,
  });
  const none = diskDue({ free: 21.5e9, minGb: 25 });
  assert.match(none.why, /no sweep category is approved$/);
  assert.match(none.command, /approves categories once$/);
  assert.equal(diskDue({ free: null }), null);
});

test('worktrees: the porcelain list parses, and only a merged linked worktree with commits of its own, clean, rebuildable ignored files alone and idle is residue', () => {
  const list = parseWorktrees(
    [
      'worktree /r',
      'HEAD a1',
      'branch refs/heads/main',
      '',
      'worktree /r/.worktrees/done',
      'HEAD b2',
      'branch refs/heads/task/p1-01',
      '',
      'worktree /r/.worktrees/held',
      'HEAD c3',
      'detached',
      'locked',
      '',
      'worktree /elsewhere/gone',
      'HEAD d4',
      'branch refs/heads/task/p1-02',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n'),
  );
  assert.deepEqual(list.map((w) => [w.path, w.branch, w.locked, w.prunable]), [
    ['/r', 'main', false, false],
    ['/r/.worktrees/done', 'task/p1-01', false, false],
    ['/r/.worktrees/held', null, true, false],
    ['/elsewhere/gone', 'task/p1-02', false, true],
  ]);
  const idle = NOW - 7 * HOUR;
  const done = { merged: true, own: true, clean: true, ignored: [], active: idle };
  const measured = [
    { ...list[0], ...done },
    { ...list[1], ...done },
    { ...list[2], ...done },
    { ...list[3], ...done },
    { ...done, path: '/r/.worktrees/dirty', clean: false },
    { ...done, path: '/r/.worktrees/open', merged: false },
    { ...done, path: '/r/.worktrees/cut', own: false },
    { ...done, path: '/r/.worktrees/built', ignored: ['node_modules/', 'apps/web/.next/', '.DS_Store'] },
    { ...done, path: '/r/.worktrees/keys', ignored: ['node_modules/', '.env.local'] },
    { ...done, path: '/r/.worktrees/fresh', active: NOW - HOUR },
  ];
  const rebuildable = /(^|\/)(node_modules|\.next)\/?$|\.DS_Store$/;
  const due = worktreesDue({ worktrees: measured, now: NOW, idleHours: 6, rebuildable, top: '/r', command: 'git worktree remove <paths>' });
  assert.equal(due.why, `2 worktrees merged into ${MAIN}, clean and idle over 6 h: .worktrees/done, .worktrees/built`);
  assert.equal(due.command, 'git worktree remove .worktrees/done .worktrees/built');
  assert.equal(worktreesDue({ worktrees: measured.slice(0, 1), now: NOW }), null);
  const many = Array.from({ length: 6 }, (_, i) => ({ ...done, path: `/r/w${i}` }));
  assert.match(worktreesDue({ worktrees: [list[0], ...many], now: NOW, idleHours: 6, top: '/r' }).why, /: w0, w1, w2, w3 and 2 more$/);
});

test('proposals: the newest week\'s file, the sections naming this project or every project, and seen weeks', () => {
  assert.deepEqual(newestProposals(['proposals-2026-W43.md', 'proposals-2026-W44.md', 'weekly-log.jsonl', 'proposals-latest.md']), {
    name: 'proposals-2026-W44.md',
    week: '2026-W44',
  });
  assert.equal(newestProposals(['seen.json']), null);
  const text = [
    '# Proposals 2026-W44',
    '### 1. [rule] a gate that passed having run nothing',
    '- Projects: shopbiz, ledger',
    '### 2. [threshold] the sweep cadence',
    '- Projects: shop',
    '### 3. [promote] counted gates',
    '- Projects: all four',
  ].join('\n');
  assert.deepEqual(proposalCounts(text, 'shop'), { total: 3, mine: 2 });
  assert.deepEqual(proposalCounts(text, 'shopbiz'), { total: 3, mine: 2 });
  assert.deepEqual(proposalCounts('No proposals this week: nothing cleared the bar.', 'shop'), { total: 0, mine: 0 });
  const newest = { name: 'proposals-2026-W44.md', week: '2026-W44' };
  const due = proposalsDue({ newest, text, seen: { shop: '2026-W43' }, project: 'shop', file: '/h/proposals-2026-W44.md', command: 'read <file>; --seen <week>' });
  assert.deepEqual(due, {
    kind: 'proposals',
    subject: '2026-W44',
    why: '2 of 3 proposals name shop, unread',
    command: 'read /h/proposals-2026-W44.md; --seen 2026-W44',
    blocking: false,
    tag: 'NEW',
  });
  assert.equal(proposalsDue({ newest, text, seen: { shop: '2026-W44' }, project: 'shop', file: 'f' }), null);
  assert.equal(proposalsDue({ newest, text: '### 1. [rule] x\n- Projects: ledger', seen: {}, project: 'shop', file: 'f' }), null);
  assert.deepEqual(markSeen({ shop: '2026-W44', ledger: '2026-W40' }, 'shop', '2026-W43'), { shop: '2026-W44', ledger: '2026-W40' });
  assert.deepEqual(markSeen(null, 'shop', '2026-W44'), { shop: '2026-W44' });
  assert.equal(projectName({ repos: [{ path: '/p/a', project: 'alpha' }] }, '/p/a'), 'alpha');
  assert.equal(projectName({ repos: [{ path: '/p/a', project: 'alpha' }] }, '/p/b'), 'b');
  assert.equal(projectName(null, '/p/c'), 'c');
});

test('checkAll runs every bound check from what was read, in order, and formatDue prints one line each', () => {
  const logText = `# Log\n\n${table(LOG_HEAD, [])}\n${['P1-01', 'P1-02', 'P1-03'].map(logRow).join('\n')}\n`;
  // header lines 1-4 at the log's birth, then one landing a day
  const logDates = new Map([[1, at('10T10:00:00')], [2, at('10T10:00:00')], [3, at('10T10:00:00')], [4, at('10T10:00:00')], [5, at('19T10:00:00')], [6, at('20T10:00:00')], [7, at('21T10:00:00')]]);
  const fuText = `${table(['#', 'Severity', 'Status'], [['FU-1', 'P3', 'open'], ['FU-2', 'P2', 'open']])}\n`;
  const fuDates = new Map([[3, at('06T10:00:00')], [4, at('25T10:00:00')]]);
  const report = (kind, value, time) => ({ rel: fill(REPORTS[kind], value), time });
  const facts = {
    now: NOW,
    claim: 'P2-01',
    log: { text: logText, dates: logDates },
    followUps: { text: fuText, dates: fuDates },
    reports: {
      preflight: REPORTS.preflight ? [report('preflight', 'P1', at('09T10:00:00'))] : [],
      sweep: REPORTS.sweep ? [report('sweep', '2026-10-18', NOW - (CADENCE.sweep.days + 1) * DAY)] : [],
      retro: REPORTS.retro ? [report('retro', '2026-W44', NOW - HOUR)] : [],
      hygiene: [],
    },
    merges: [{ t: at('22T10:00:00'), subject: 'Merge task/p1-03: x' }],
    disk: { free: 1e12, approved: [], last: null },
    worktrees: [],
    proposals: null,
    seen: {},
    project: 'p',
  };
  const items = checkAll(facts);
  const kinds = items.map((i) => i.kind);
  if (REPORTS.retro !== null) assert.ok(!kinds.includes('retro'), 'a retro an hour old is not due');
  if (REPORTS.sweep !== null) assert.ok(kinds.includes('sweep'));
  if (REPORTS.hygiene !== null) {
    const hygiene = items.find((i) => i.kind === 'hygiene');
    assert.match(hygiene.why, /since the log began, and no report yet; 1 open P3, the oldest FU-1 at 20 d$/);
    assert.ok(!kinds.includes('p3'));
  } else assert.ok(kinds.includes('p3'));
  assert.ok(!kinds.includes('disk'));
  assert.deepEqual(kinds, [...kinds].sort((x, y) => ['preflight', 'sweep', 'retro', 'hygiene', 'p3', 'disk', 'worktrees', 'proposals'].indexOf(x) - ['preflight', 'sweep', 'retro', 'hygiene', 'p3', 'disk', 'worktrees', 'proposals'].indexOf(y)));
  const preflight = items.find((i) => i.kind === 'preflight');
  if (REPORTS.preflight !== null && phaseOf('P2-01') !== null && phaseOf('P1-01') !== phaseOf('P2-01')) assert.equal(preflight.blocking, true);
  const text = formatDue([
    { kind: 'sweep', subject: null, why: '8 d, 5 landings since sweep-2026-10-18.md', command: 'run the sweep', blocking: false },
    { kind: 'proposals', subject: '2026-W44', why: '2 of 3 proposals name p, unread', command: 'read f', blocking: false, tag: 'NEW' },
  ]);
  assert.equal(text, 'DUE sweep — 8 d, 5 landings since sweep-2026-10-18.md — run the sweep\nNEW proposals 2026-W44 — 2 of 3 proposals name p, unread — read f\n');
  assert.equal(formatDue([]), 'harness-due: nothing due\n');
});

// ---- the wrapper, in a temp repo with dated commits and a temp --home

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return { ...env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', HOME: tmpDir('harness-due-home-'), ...extra };
}

function fixture() {
  const repo = tmpDir('harness-due-repo-');
  const git = (args, date = '2026-10-17T10:00:00Z') => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      env: cleanEnv({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  git(['init', '-q', '-b', MAIN]);
  write(LOG, `# Log\n\n${table(LOG_HEAD, [])}\n${logRow('P1-01')}\n${logRow('P1-02')}\n`);
  write(FOLLOW_UPS, `${table(['#', 'Severity', 'Status'], [['1', 'P3', 'open']])}\n`);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'the log']);
  if (REPORTS.sweep !== null) {
    write(fill(REPORTS.sweep, '2026-10-18'), '# Sweep\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'sweep'], '2026-10-18T10:00:00Z');
  }
  for (const [i, d] of ['19', '20', '21', '22', '23'].entries()) {
    fs.appendFileSync(path.join(repo, LOG), `${logRow(`P1-0${i + 3}`)}\n`);
    git(['commit', '-q', '-a', '-m', `P1-0${i + 3} landed`], `2026-10-${d}T10:00:00Z`);
  }
  const home = tmpDir('harness-due-agents-');
  return { repo, home, git, write };
}

function run(f, args, cwd = f.repo) {
  return spawnSync(process.execPath, [RUNNER, '--now', '2026-10-26T12:00:00Z', '--home', f.home, ...args], { cwd, env: cleanEnv(), encoding: 'utf8' });
}

// The claim of P2-01 stops only where a preflight is bound and P2-01 is in another phase than the log's rows.
const canClaim = REPORTS.preflight !== null && phaseOf('P2-01') !== null && phaseOf('P1-01') !== null && phaseOf('P1-01') !== phaseOf('P2-01');

test('the wrapper: claiming the row that opens a phase with no preflight stops with exit 1; a phase under way is named, never stopped', () => {
  const f = fixture();
  const opens = run(f, ['--claim', 'P2-01']);
  if (!canClaim) {
    // the binding's own behaviour: it stops only for a bound preflight in a phase of its own
    const stops = REPORTS.preflight !== null && phaseOf('P2-01') !== null && phaseOf('P1-01') !== phaseOf('P2-01');
    assert.equal(opens.status, stops ? 1 : 0, opens.stderr);
    if (REPORTS.preflight === null || phaseOf('P2-01') === null) assert.doesNotMatch(opens.stdout, /^DUE preflight/m);
    return;
  }
  assert.equal(opens.status, 1, opens.stderr);
  assert.match(opens.stdout, new RegExp(`^DUE preflight P2 — no report at ${fill(REPORTS.preflight, 'P2').replace(/[.]/g, '\\.')}, and P2-01 opens the phase: the claim waits for it — `, 'm'));
  const underWay = run(f, ['--claim', 'P1-08']);
  assert.equal(underWay.status, 0, underWay.stderr);
  assert.match(underWay.stdout, /^DUE preflight P1 — no report at .*, and the phase is under way \(7 log rows, 0 merges\) — /m);
  // a report on disk that no commit holds clears nothing: the unit stays due until its report is committed
  f.write(fill(REPORTS.preflight, 'P2'), '# Preflight P2\n');
  const unsaved = run(f, ['--claim', 'P2-01']);
  assert.equal(unsaved.status, 1, unsaved.stdout + unsaved.stderr);
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'P2 preflight'], '2026-10-24T10:00:00Z');
  const cleared = run(f, ['--claim', 'P2-01', '--json']);
  assert.equal(cleared.status, 0, cleared.stderr);
  const json = JSON.parse(cleared.stdout);
  assert.equal(json.blocking, 0);
  assert.ok(!json.due.some((d) => d.kind === 'preflight'));
});

test('the wrapper: a sweep report that no commit holds does not clear the sweep; committed, it does', () => {
  const f = fixture();
  if (REPORTS.sweep !== null) f.write(fill(REPORTS.sweep, '2026-10-25'), '# Sweep\n');
  const unsaved = run(f, []);
  assert.equal(unsaved.status, 0, unsaved.stderr);
  if (REPORTS.sweep !== null && CADENCE.sweep.days <= 8) assert.match(unsaved.stdout, /^DUE sweep — 8 d, 5 landings since .*2026-10-18.* — /m);
  if (REPORTS.sweep === null) return;
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'sweep'], '2026-10-25T10:00:00Z');
  assert.doesNotMatch(run(f, []).stdout, /^DUE sweep/m);
});

test('the wrapper: a landed branch that merged the mainline into itself is one landing, not two', () => {
  const f = fixture();
  f.git(['checkout', '-q', '-b', 'task/p1-09']);
  f.write('own.txt', 'own');
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'own work'], '2026-10-24T09:00:00Z');
  f.git(['checkout', '-q', MAIN]);
  f.write('main.txt', 'main moved');
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'main moved on'], '2026-10-24T10:00:00Z');
  f.git(['checkout', '-q', 'task/p1-09']);
  f.git(['merge', '-q', '--no-ff', '-m', 'Merge main into task/p1-09', MAIN], '2026-10-24T11:00:00Z');
  f.git(['checkout', '-q', MAIN]);
  f.git(['merge', '-q', '--no-ff', '-m', 'Merge task/p1-09', 'task/p1-09'], '2026-10-24T12:00:00Z');
  const res = run(f, ['--claim', 'P1-09']);
  assert.equal(res.status, 0, res.stderr);
  if (REPORTS.preflight !== null && phaseOf('P1-09') !== null) {
    assert.match(res.stdout, /^DUE preflight P1 — no report at .*, and the phase is under way \(7 log rows, 1 merge\) — /m);
  }
});

test('blameDates dates a committed line by its commit and a line not committed yet by nothing', () => {
  const f = fixture();
  const file = path.join(f.repo, LOG);
  assert.ok([...blameDates(f.repo, LOG).values()].every(Number.isFinite));
  // line 5 is the first log row, edited here; line 12 is a row appended here; neither is committed
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8').replace('P1-01 · plan · Code · Small | 60m', 'P1-01 · plan · Code · Small | 61m')}${logRow('P1-09')}\n`);
  const dates = blameDates(f.repo, LOG);
  assert.equal(dates.size, 12);
  assert.equal(dates.get(5), null);
  assert.equal(dates.get(12), null);
  assert.equal(dates.get(6), at('17T10:00:00'));
  assert.equal(dates.get(7), at('19T10:00:00'));
});

test('the wrapper: a sweep report 8 days back with 5 landings since is due; the unread proposals are NEW until --seen', () => {
  const f = fixture();
  const proposals = path.join(f.home, '.agents', 'harness', 'retro');
  fs.mkdirSync(proposals, { recursive: true });
  fs.writeFileSync(path.join(proposals, 'proposals-2026-W44.md'), `### 1. [rule] x\n- Projects: ${path.basename(f.repo)}\n### 2. [rule] y\n- Projects: elsewhere\n`);
  const res = run(f, []);
  assert.equal(res.status, 0, res.stderr);
  if (REPORTS.sweep !== null && CADENCE.sweep.days <= 8) assert.match(res.stdout, /^DUE sweep — 8 d, 5 landings since .*2026-10-18.* — /m);
  assert.match(res.stdout, new RegExp(`^NEW proposals 2026-W44 — 1 of 2 proposals name ${path.basename(f.repo)}, unread — .*--seen 2026-W44`, 'm'));
  const seen = run(f, ['--seen', '2026-W44']);
  assert.equal(seen.status, 0, seen.stderr);
  assert.match(seen.stdout, /has read the proposals of 2026-W44/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(proposals, 'seen.json'), 'utf8')), { [path.basename(f.repo)]: '2026-W44' });
  assert.ok(!/^NEW proposals/m.test(run(f, []).stdout));
  assert.equal(f.git(['status', '--porcelain']), '');
});

test('the wrapper: a merged worktree is residue only with commits of its own, no change, and rebuildable ignored files or links alone', () => {
  const f = fixture();
  f.write('.gitignore', '.worktrees/\nnode_modules/\n.env.local\n');
  f.git(['add', '.gitignore']);
  f.git(['commit', '-q', '-m', 'ignore'], '2026-10-23T11:00:00Z');
  const add = (name, { commit = true, merge = '--no-ff' } = {}) => {
    const dir = path.join(f.repo, '.worktrees', name);
    f.git(['worktree', 'add', '-q', '-b', `task/${name}`, dir, MAIN]);
    if (commit) {
      fs.writeFileSync(path.join(dir, `${name}.txt`), name);
      f.git(['-C', dir, 'add', '.']);
      f.git(['-C', dir, 'commit', '-q', '-m', name], '2026-10-23T12:00:00Z');
    }
    if (merge) f.git(['merge', '-q', merge, '-m', `Merge task/${name}`, `task/${name}`], '2026-10-23T13:00:00Z');
    return dir;
  };
  add('done');
  add('ff', { merge: '--ff-only' }); // on the mainline's first-parent line: its own commits show in the branch reflog
  fs.mkdirSync(path.join(add('built'), 'node_modules'));
  fs.writeFileSync(path.join(f.repo, '.worktrees', 'built', 'node_modules', 'x.js'), '');
  fs.writeFileSync(path.join(add('keys'), '.env.local'), 'TOKEN=x\n');
  fs.symlinkSync(path.join(f.repo, '.gitignore'), path.join(add('linked'), '.env.local')); // a link to the main checkout's file
  add('cut', { commit: false, merge: null });
  fs.appendFileSync(path.join(add('dirty'), 'dirty.txt'), ' changed');
  const past = new Date('2026-10-24T00:00:00Z');
  for (const name of ['done', 'ff', 'built', 'keys', 'linked', 'cut', 'dirty']) {
    fs.utimesSync(path.join(f.repo, '.worktrees', name, '.git'), past, past);
    fs.utimesSync(path.join(f.repo, '.git', 'worktrees', name, 'logs', 'HEAD'), past, past);
  }
  // idle for WORKTREE_IDLE_HOURS and 12 more, whatever the binding: the clock moves, not the fixture's commits
  const now = new Date(past.getTime() + (WORKTREE_IDLE_HOURS + 12) * HOUR).toISOString();
  const res = run(f, ['--json', '--now', now]);
  assert.equal(res.status, 0, res.stderr);
  const line = JSON.parse(res.stdout).due.find((d) => d.kind === 'worktrees');
  const named = (line?.why.split(': ')[1] ?? '').split(', ').map((p) => path.basename(p)).sort();
  const residue = ['done', 'ff', 'linked', ...(REBUILDABLE.test('node_modules/') ? ['built'] : []), ...(REBUILDABLE.test('.env.local') ? ['keys'] : [])].sort();
  assert.deepEqual(named, residue, res.stdout);
});

test('the wrapper exits 2 with a usage line on a bad flag and outside a repository', () => {
  const f = fixture();
  const bad = run(f, ['--nope']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /^harness-due: unknown option --nope\nusage: /);
  const outside = run(f, [], tmpDir('harness-due-outside-'));
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /not inside a git repository/);
});
