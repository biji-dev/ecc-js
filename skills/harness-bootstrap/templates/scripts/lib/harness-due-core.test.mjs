// harness-bootstrap harness-due tests (generated YYYY-MM-DD). Run: node --test scripts/lib/harness-due-core.test.mjs
// [M] mechanism (ships as-is): every test but the [B] one. [B] binding: the ids of the fixtures' rows (ROW and
// PHASE_EXAMPLE, below); the rest reads the bindings of this core (MAIN, LOG, REGISTRY, REPORTS, CADENCE, WORKTREE_IDLE_HOURS ...)
// and of estimate-core (the log's columns, a tier word), never their values. A wrapper test a binding cannot
// express asserts that binding's own behaviour, never skips.
// Hermetic: the wrapper tests run in a temp git repo with every GIT_* variable stripped,
// GIT_CONFIG_GLOBAL=/dev/null, a fixed identity and dated commits, and a temp --home.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COLUMNS, TIER_WORDS } from './estimate-core.mjs';
import { blameDates } from './retro-gather.mjs';
import { SEVERITY_COLUMNS, STATUS_COLUMNS, STATUS_WORDS } from './retro-core.mjs';
import {
  CADENCE,
  FOLLOW_UPS,
  LOG,
  MAIN,
  PHASE_OF,
  REBUILDABLE,
  REGISTRY,
  REPORTS,
  WORKTREE_IDLE_HOURS,
  cadenceDue,
  checkAll,
  diskDue,
  formatDue,
  inboxLines,
  markSeen,
  matchReports,
  newestProposals,
  p3Due,
  p3Note,
  parkedUnits,
  parseArgs,
  parseWorktrees,
  phaseOf,
  preflightDue,
  projectName,
  proposalCounts,
  proposalsDue,
  registryWorktrees,
  reportShape,
  worktreesDue,
} from './harness-due-core.mjs';

const RUNNER = fileURLToPath(new URL('../harness-due.mjs', import.meta.url));
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const at = (s) => Date.parse(`2026-10-${s}Z`);
const PHASE = /^([A-Za-z]+-?\d+)[-.]\w/;
// a PHASE_OF given as a function: the phase is the word between T- and the number, which no prefix of the id gives
const TABLE_PHASE = (id) => /^T-([A-Z]+)-\d/.exec(id)?.[1] ?? null;
const PREFLIGHT = 'docs/preflight/<phase>.md';
const fill = (template, value) => template.replace(/<\w+>/, value);
// A follow-ups table for code that reads the project's own bindings: the status and severity headers
// and the open word come from them, so a project that rebinds them still passes. The file a fixture
// writes it to is FOLLOW_UPS (a list's first entry; a `dir/*.md` entry becomes `dir/follow-ups.md`).
const ST = STATUS_COLUMNS[0];
const SEV = SEVERITY_COLUMNS[0];
const OPEN = STATUS_WORDS.open[0];
const FU_FILE = [FOLLOW_UPS].flat()[0].replace(/\/\*\.md$/, '/follow-ups.md');

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
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);
// The log's header as estimate-core's COLUMNS name it, and a tier cell from its first TIER_WORD.
const LOG_HEAD = [`${cap(COLUMNS.unit)} · Mode · ${cap(COLUMNS.type)} · ${cap(COLUMNS.tier)}`, `${cap(COLUMNS.elapsed)} (work)`, cap(COLUMNS.cost)];
const TIER = cap(TIER_WORDS[0]);
const logRow = (id) => `| ${id} · plan · Code · ${TIER} | 60m | Cost $1 |`;

// ---- [B] project bindings
// The id of row n (1-based) of phase number p, in the shape the project's PHASE_OF reads, and one row's id with the
// phase PHASE_OF gives it. The fixtures name their rows with ROW, so a project binds both and the [B] test holds them to PHASE_OF.
const ROW = (p, n) => `P${p}-${String(n).padStart(2, '0')}`;
const PHASE_EXAMPLE = [ROW(2, 16), 'P2'];
// ---- end [B]
const PH1 = phaseOf(ROW(1, 1));
const PH2 = phaseOf(ROW(2, 1));

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

test('[B] PHASE_OF gives PHASE_EXAMPLE its phase; the rows ROW builds fall in two phases, or in none when the project has no phases', () => {
  assert.equal(phaseOf(PHASE_EXAMPLE[0]), PHASE_EXAMPLE[1]);
  if (PHASE_EXAMPLE[1] === null) {
    // a project with no phases: no row has one, so no claim opens a phase and no preflight is due
    for (const [p, n] of [[1, 1], [1, 9], [2, 1], [2, 16]]) assert.equal(phaseOf(ROW(p, n)), null, `row ${n} of phase ${p}`);
    const base = { reports: [], template: REPORTS.preflight ?? PREFLIGHT, pattern: PHASE_OF, command: 'preflight <phase>', logIds: [], merges: [] };
    assert.equal(preflightDue({ ...base, claim: ROW(1, 1) }), null);
    return;
  }
  assert.equal(PH2, PHASE_EXAMPLE[1]);
  for (const n of [1, 2, 9]) assert.equal(phaseOf(ROW(2, n)), PH2, `row ${n} of phase 2`);
  for (const n of [1, 8, 9]) assert.equal(phaseOf(ROW(1, n)), PH1, `row ${n} of phase 1`);
  assert.ok(PH1 !== null && PH1 !== PH2, `phases 1 and 2 are ${PH1} and ${PH2}`);
});

test('phaseOf takes the phase from a row id; an id outside every phase has none', () => {
  assert.equal(phaseOf('P2-16', PHASE), 'P2');
  assert.equal(phaseOf('EP-27.04', PHASE), 'EP-27');
  assert.equal(phaseOf('p3-12a', PHASE), 'p3');
  for (const id of ['T-DATA-037', 'CR-021', 'harness/hygiene-2026-10-26', 'P2', '', null]) assert.equal(phaseOf(id, PHASE), null);
});

test('phaseOf also takes a function id -> phase | null; a result that is not a non-empty string is no phase', () => {
  assert.equal(phaseOf('T-DATA-037', TABLE_PHASE), 'DATA');
  assert.equal(phaseOf('CR-021', TABLE_PHASE), null);
  assert.equal(phaseOf('T-DATA-037', () => ''), null);
  assert.equal(phaseOf('T-DATA-037', () => undefined), null);
  assert.equal(phaseOf('T-DATA-037', () => 42), null);
  const seen = [];
  phaseOf('  T-DATA-037 ', (id) => (seen.push(id), null));
  assert.deepEqual(seen, ['T-DATA-037'], 'the function is called with the trimmed id');
});

test('preflightDue with a function PHASE_OF: the opening row blocks; a log row or a merge naming a row of the phase does not', () => {
  const base = { reports: [], template: PREFLIGHT, pattern: TABLE_PHASE, command: 'preflight <phase>' };
  const opens = preflightDue({ ...base, claim: 'T-DATA-001', logIds: ['T-OPS-001'], merges: ['Merge task/T-OPS-001: done'] });
  assert.deepEqual(opens, {
    kind: 'preflight',
    subject: 'DATA',
    why: 'no report at docs/preflight/DATA.md, and T-DATA-001 opens the phase: the claim waits for it',
    command: 'preflight DATA',
    blocking: true,
  });
  const logged = preflightDue({ ...base, claim: 'T-DATA-002', logIds: ['T-DATA-001', 'T-OPS-001'], merges: [] });
  assert.equal(logged.blocking, false);
  assert.match(logged.why, /the phase is under way \(1 log row, 0 merges\)$/);
  const merged = preflightDue({ ...base, claim: 'T-DATA-002', logIds: [], merges: ['Merge task/T-DATA-002: first'] });
  assert.equal(merged.blocking, false);
  assert.match(merged.why, /\(0 log rows, 1 merge\)$/);
  // a subject that names another phase's id, or an id the function gives no phase, does not count
  assert.equal(preflightDue({ ...base, claim: 'T-DATA-001', logIds: [], merges: ['Merge T-DATAX-1: other', 'Merge CR-021: none'] }).blocking, true);
  // a report clears it, whatever its case; a claim the function gives no phase has nothing to check
  assert.equal(preflightDue({ ...base, claim: 'T-DATA-001', reports: [{ rel: 'docs/preflight/data.md', time: NOW }] }), null);
  assert.equal(preflightDue({ ...base, claim: 'CR-021' }), null);
});

test('preflightDue with a function PHASE_OF sees every id ROW_ID allows in a merge subject: `_`, and no separator at all', () => {
  const fn = (id) => (/^TASK_\d+$/.test(id) ? 'TASKS' : /^T\d+$/.test(id) ? 'TPHASE' : /^T-[A-Z]+-\d+$/.test(id) ? 'DASHED' : null);
  const base = { reports: [], template: PREFLIGHT, pattern: fn, logIds: [] };
  for (const [claim, subject, phase] of [
    ['TASK_002', "Merge branch 'task/TASK_001'", 'TASKS'],
    ['T002', "Merge branch 'task/T001'", 'TPHASE'],
    ['T-AB-2', "Merge branch 'task/T-AB-1'", 'DASHED'],
  ]) {
    const named = preflightDue({ ...base, claim, merges: [subject] });
    assert.equal(named.subject, phase);
    assert.equal(named.blocking, false, `${subject} names a row of ${phase}, so ${claim} does not open it`);
    assert.match(named.why, /the phase is under way \(0 log rows, 1 merge\)$/, subject);
  }
  // a trailing `.` ends the sentence, not the id
  const dotted = preflightDue({ ...base, claim: 'T002', merges: ['Merge branch task/T001.'] });
  assert.equal(dotted.blocking, false, 'a subject ending "T001." still names T001');
  assert.match(dotted.why, /\(0 log rows, 1 merge\)$/);
  // a subject that names no id of the phase leaves the claim opening it
  assert.equal(preflightDue({ ...base, claim: 'TASK_002', merges: ["Merge branch 'task/T001'", 'Merge TASK_x: none'] }).blocking, true);
  assert.equal(preflightDue({ ...base, claim: 'T002', merges: ['Merge branch task/T-AB-1'] }).blocking, true);
});

test('a phase report is named by any phase either form of PHASE_OF can give, a digit or none', () => {
  assert.deepEqual(matchReports('docs/r/preflight-<phase>.md', ['preflight-DATA.md', 'preflight-P2.md', 'preflight-EP-27.md', 'preflight-.md', 'preflight-a b.md', 'notes.md']).map((r) => r.value), ['DATA', 'P2', 'EP-27']);
  assert.deepEqual(matchReports('docs/r/<date>.md', ['DATA.md', '2026-10-18.md']).map((r) => r.value), ['2026-10-18'], 'a date and a week keep their shapes');
});

test('PHASE_OF is a RegExp or a function, and phaseOf takes the binding as it is', () => {
  assert.ok(PHASE_OF instanceof RegExp || typeof PHASE_OF === 'function', 'PHASE_OF is neither a RegExp nor a function');
  for (const id of ['P2-16', 'EP-27.04', 'T-DATA-037', 'CR-021', '']) {
    const phase = phaseOf(id);
    assert.ok(phase === null || (typeof phase === 'string' && phase !== ''), `phaseOf(${JSON.stringify(id)}) is ${JSON.stringify(phase)}`);
  }
});

test('reportShape keeps the placeholder in the file name, and matchReports finds a directory\'s reports', () => {
  assert.deepEqual(matchReports('docs/sweeps/<date>.md', ['2026-10-18.md', 'latest.md', '2026-10-18.md.bak', 'README.md']), [
    { rel: 'docs/sweeps/2026-10-18.md', value: '2026-10-18' },
  ]);
  assert.deepEqual(matchReports('r/retro-<week>.md', ['retro-2026-W43.md', 'retro-2026-43.md']), [{ rel: 'r/retro-2026-W43.md', value: '2026-W43' }]);
  assert.deepEqual(matchReports(PREFLIGHT, ['P2.md', 'p3.md', 'P2.notes.md']).map((r) => r.value), ['P2', 'p3']);
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
  const fuText = `${table(['#', SEV, 'Area', ST], [['FU-1', 'P1', 'the P3 cleanup of a.ts', OPEN], ['FU-2', 'P3', 'b.ts', OPEN]])}\n`;
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
  const logText = `# Log\n\n${table(LOG_HEAD, [])}\n${[1, 2, 3].map((n) => logRow(ROW(1, n))).join('\n')}\n`;
  // header lines 1-4 at the log's birth, a day older than the hygiene cadence, then one landing a day
  const birth = NOW - (CADENCE.hygiene.days + 1) * DAY;
  const logDates = new Map([[1, birth], [2, birth], [3, birth], [4, birth], [5, at('19T10:00:00')], [6, at('20T10:00:00')], [7, at('21T10:00:00')]]);
  const fuText = `${table(['#', SEV, ST], [['FU-1', 'P3', OPEN], ['FU-2', 'P2', OPEN]])}\n`;
  const fuDates = new Map([[3, at('06T10:00:00')], [4, at('25T10:00:00')]]);
  const report = (kind, value, time) => ({ rel: fill(REPORTS[kind], value), time });
  const facts = {
    now: NOW,
    claim: ROW(2, 1),
    log: { text: logText, dates: logDates },
    followUps: { text: fuText, dates: fuDates },
    reports: {
      preflight: REPORTS.preflight ? [report('preflight', PH1, at('09T10:00:00'))] : [],
      sweep: REPORTS.sweep ? [report('sweep', '2026-10-18', NOW - (CADENCE.sweep.days + 1) * DAY)] : [],
      retro: REPORTS.retro ? [report('retro', '2026-W44', NOW - HOUR)] : [],
      hygiene: [],
    },
    merges: [{ t: at('22T10:00:00'), subject: `Merge task/${ROW(1, 3)}: x` }],
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
  // no preflight bound, or no phase for the claim to open: nothing waits
  if (REPORTS.preflight === null || PH2 === null) assert.ok(!kinds.includes('preflight'), 'no preflight is due');
  else assert.equal(preflight.blocking, true);
  const text = formatDue([
    { kind: 'sweep', subject: null, why: '8 d, 5 landings since sweep-2026-10-18.md', command: 'run the sweep', blocking: false },
    { kind: 'proposals', subject: '2026-W44', why: '2 of 3 proposals name p, unread', command: 'read f', blocking: false, tag: 'NEW' },
  ]);
  assert.equal(text, 'DUE sweep — 8 d, 5 landings since sweep-2026-10-18.md — run the sweep\nNEW proposals 2026-W44 — 2 of 3 proposals name p, unread — read f\n');
  assert.equal(formatDue([]), 'harness-due: nothing due\n');
});

// ---- the registry: the parked table is the owner's inbox
// A registry as the commit guard reads it, with the parked table after the active one
// (harness-bootstrap's reference/commit-guard.md › The registry).
const activeSection = (rows) =>
  ['<!-- harness:active -->', '| # | Unit | Step | Branch | Worktree | Resources | Claimed (UTC) |', '|---|---|---|---|---|---|---|', '| 0 | mainline — never claimed | | | main | | |', ...rows, '<!-- /harness:active -->'].join('\n');
const PARKED_HEAD = ['| Unit | Gate | Parked (UTC) | Branch | Worktree | Cards |', '|---|---|---|---|---|---|'];
const parkedSection = (rows, head = PARKED_HEAD) => ['<!-- harness:parked -->', ...head, ...rows, '<!-- /harness:parked -->'].join('\n');
const registryFile = (...sections) => `# Registry\n\n${sections.join('\n\n')}\n`;
const CR_ROW = '| CR-021 | Gate 2 | 2026-11-06T04:10Z | change/cr-021 | ../wt-cr-021 | Q-1 merge or hold · Q-2 button copy |';
const CR_LINE = 'INBOX CR-021 Gate 2 since 2026-11-06T04:10Z · Q-1 merge or hold · Q-2 button copy';

test('inboxLines: one `INBOX <unit> <gate> since <Parked> · <Cards>` line per parked row, in table order, and nothing from the active table', () => {
  const held = '| 1 | P2-16 | 2 implement | task/p2-16 | main | | 2026-11-06T03:00:00Z |';
  const text = registryFile(activeSection([held]), parkedSection([CR_ROW, '| P2-17 | Gate 1 | 2026-11-06T05:30Z | task/p2-17 | main | Q-1 scope |']));
  assert.deepEqual(inboxLines(text), [CR_LINE, 'INBOX P2-17 Gate 1 since 2026-11-06T05:30Z · Q-1 scope']);
  assert.deepEqual(inboxLines(registryFile(activeSection([held]))), [], 'a held row is not parked');
  assert.deepEqual(inboxLines(registryFile(parkedSection([]))), [], 'a parked table with no row');
});

test('inboxLines reads the columns by header name, tolerates empty cells, and drops the words of a cell that is empty', () => {
  const reordered = parkedSection(['| Q-1 merge | `CR-021` | 2026-11-06T04:10Z | Gate 2 | note |'], ['| Cards | Unit | Parked | Gate | Notes |', '|---|---|---|---|---|']);
  assert.deepEqual(inboxLines(registryFile(reordered)), ['INBOX CR-021 Gate 2 since 2026-11-06T04:10Z · Q-1 merge']);
  const sparse = parkedSection(['| CR-021 | | | | | |', '| CR-022 | Gate 2 |', '| CR-023 | | 2026-11-06T04:10Z | | | Q-1 |', '| | Gate 1 | 2026-11-06T04:10Z | | | Q-2 |', '|  |  |  |  |  |  |']);
  assert.deepEqual(inboxLines(registryFile(sparse)), ['INBOX CR-021', 'INBOX CR-022 Gate 2', 'INBOX CR-023 since 2026-11-06T04:10Z · Q-1']);
  // a table with no Cards, Gate or Parked column still lists its units; CRLF line ends and an escaped pipe in a cell read as text
  assert.deepEqual(inboxLines(registryFile(parkedSection(['| CR-021 |'], ['| Unit |', '|---|']))), ['INBOX CR-021']);
  const crlf = registryFile(parkedSection(['| CR-021 | Gate 2 | 2026-11-06T04:10Z | b | w | Q-1 a\\|b |'])).replace(/\n/g, '\r\n');
  assert.deepEqual(inboxLines(crlf), ['INBOX CR-021 Gate 2 since 2026-11-06T04:10Z · Q-1 a|b']);
});

test('inboxLines: a section that is missing or malformed is no inbox, and rows outside the markers are never read', () => {
  const rows = [CR_ROW];
  for (const [what, text] of [
    ['no text', null],
    ['an empty file', ''],
    ['no parked section', registryFile(activeSection([]))],
    ['no end marker', registryFile(['<!-- harness:parked -->', ...PARKED_HEAD, ...rows].join('\n'))],
    ['no begin marker', registryFile([...PARKED_HEAD, ...rows, '<!-- /harness:parked -->'].join('\n'))],
    ['the end marker before the begin marker', registryFile(['<!-- /harness:parked -->', '<!-- harness:parked -->', ...PARKED_HEAD, ...rows].join('\n'))],
    ['no header', registryFile(['<!-- harness:parked -->', ...rows, '<!-- /harness:parked -->'].join('\n'))],
    ['no separator row', registryFile(['<!-- harness:parked -->', PARKED_HEAD[0], ...rows, '<!-- /harness:parked -->'].join('\n'))],
    ['no Unit column', registryFile(parkedSection(['| Gate 2 | 2026-11-06T04:10Z |'], ['| Gate | Parked (UTC) |', '|---|---|']))],
    ['a header above the begin marker', registryFile([...PARKED_HEAD, '<!-- harness:parked -->', ...rows, '<!-- /harness:parked -->'].join('\n'))],
    ['a marker cited in a line of prose', registryFile('Parked units sit between `<!-- harness:parked -->` and `<!-- /harness:parked -->`.', activeSection([]))],
  ]) assert.deepEqual(inboxLines(text), [], what);
  // rows above and below the markers belong to no table; a prose line naming the markers does not open one
  const around = registryFile(`${PARKED_HEAD.join('\n')}\n${rows[0]}`, 'The parked units sit between `<!-- harness:parked -->` and `<!-- /harness:parked -->`.', parkedSection(['| CR-022 | Gate 1 | 2026-11-06T04:11Z | b | w | Q-1 |']), `${PARKED_HEAD.join('\n')}\n${rows[0]}`);
  assert.deepEqual(inboxLines(around), ['INBOX CR-022 Gate 1 since 2026-11-06T04:11Z · Q-1']);
});

test('parkedUnits gives each row by column with the command filled for its unit; a parked table needs no other column than Unit', () => {
  assert.deepEqual(parkedUnits(registryFile(parkedSection([CR_ROW])), 'resume <unit> (<unit>)'), [
    { unit: 'CR-021', gate: 'Gate 2', parked: '2026-11-06T04:10Z', branch: 'change/cr-021', worktree: '../wt-cr-021', cards: 'Q-1 merge or hold · Q-2 button copy', command: 'resume CR-021 (CR-021)' },
  ]);
  const bound = parkedUnits(registryFile(parkedSection([CR_ROW])))[0].command;
  assert.ok(typeof bound === 'string' && bound !== '' && !bound.includes('<unit>'), `the bound command: ${bound}`);
  assert.deepEqual(parkedUnits(registryFile(parkedSection(['| CR-021 |'], ['| Unit |', '|---|'])), 'x'), [
    { unit: 'CR-021', gate: '', parked: '', branch: '', worktree: '', cards: '', command: 'x' },
  ]);
});

test('registryWorktrees: the checkouts named by a held row or a parked row, from the main checkout; row 0, main and a placeholder name none', () => {
  const text = registryFile(
    ['<!-- harness:active -->', '| # | Unit | Step | Branch | Worktree | Claimed (UTC) |', '|---|---|---|---|---|---|', '| 0 | mainline | | | .worktrees/zero | |', '| 1 | P2-16 | 2 | task/p2-16 | .worktrees/p2-16 | |', '| 2 | P2-18 | 3 | task/p2-18 | main | |', '| 3 | P2-19 | 3 | task/p2-19 | - | |', '| 4 | P2-20 | 3 | task/p2-20 | `.worktrees/p2-20` · note | |', '<!-- /harness:active -->'].join('\n'),
    parkedSection([CR_ROW, '| CR-022 | Gate 1 | 2026-11-06T04:11Z | change/cr-022 | /abs/wt-cr-022 | Q-1 |', '| CR-023 | Gate 1 | | | | |', '| CR-024 | Gate 1 | | | n/a | |', '| CR-025 | Gate 1 | | | . | |']),
  );
  assert.deepEqual(registryWorktrees(text, '/r/main'), ['/r/main/.worktrees/p2-16', '/r/main/.worktrees/p2-20', '/r/wt-cr-021', '/abs/wt-cr-022']);
  assert.deepEqual(registryWorktrees(registryFile(parkedSection([CR_ROW])), '/r/main'), ['/r/wt-cr-021']);
  // no registry, no root, or no Worktree column: none
  assert.deepEqual(registryWorktrees(null, '/r'), []);
  assert.deepEqual(registryWorktrees(text, ''), []);
  assert.deepEqual(registryWorktrees(registryFile(parkedSection(['| CR-021 |'], ['| Unit |', '|---|'])), '/r'), []);
});

test('worktreesDue never names a worktree that a registry row names; checkAll takes the rows from the registry it is given', () => {
  const idle = NOW - (WORKTREE_IDLE_HOURS + 1) * HOUR;
  const done = { merged: true, own: true, clean: true, ignored: [], active: idle };
  const worktrees = [{ path: '/r', head: 'a1', branch: MAIN }, ...['a', 'b', 'c'].map((n) => ({ ...done, path: `/r/.worktrees/${n}` }))];
  const named = ['/r/.worktrees/b', '/r/.worktrees/c/'];
  const due = worktreesDue({ worktrees, now: NOW, top: '/r', named });
  assert.equal(due.why, `1 worktree merged into ${MAIN}, clean and idle over ${WORKTREE_IDLE_HOURS} h: .worktrees/a`);
  assert.equal(worktreesDue({ worktrees, now: NOW, top: '/r', named: ['/r/.worktrees/a', '/r/.worktrees/b', '/r/.worktrees/c'] }), null);
  assert.equal(worktreesDue({ worktrees, now: NOW, top: '/r' }).why.split(': ')[1], '.worktrees/a, .worktrees/b, .worktrees/c');
  const facts = { now: NOW, log: null, followUps: null, reports: {}, merges: [], worktrees, top: '/r', proposals: null, seen: {}, project: 'p' };
  const text = registryFile(parkedSection(['| CR-021 | Gate 2 | 2026-11-06T04:10Z | change/cr-021 | .worktrees/b | Q-1 |']));
  const line = (f) => checkAll(f).find((i) => i.kind === 'worktrees')?.why.split(': ')[1];
  assert.equal(line(facts), '.worktrees/a, .worktrees/b, .worktrees/c');
  assert.equal(line({ ...facts, registry: { text, root: '/r' } }), '.worktrees/a, .worktrees/c');
});

test('formatDue puts the inbox lines last, and nothing due stays nothing due while the owner has an inbox', () => {
  const item = { kind: 'sweep', subject: null, why: '8 d', command: 'run the sweep', blocking: false };
  assert.equal(formatDue([item], [CR_LINE, 'INBOX P2-17']), `DUE sweep — 8 d — run the sweep\n${CR_LINE}\nINBOX P2-17\n`);
  assert.equal(formatDue([], [CR_LINE]), `harness-due: nothing due\n${CR_LINE}\n`);
  assert.equal(formatDue([], []), 'harness-due: nothing due\n');
  assert.equal(formatDue([item]), 'DUE sweep — 8 d — run the sweep\n');
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
  write(LOG, `# Log\n\n${table(LOG_HEAD, [])}\n${logRow(ROW(1, 1))}\n${logRow(ROW(1, 2))}\n`);
  write(FU_FILE, `${table(['#', SEV, ST], [['1', 'P3', OPEN]])}\n`);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'the log']);
  if (REPORTS.sweep !== null) {
    write(fill(REPORTS.sweep, '2026-10-18'), '# Sweep\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'sweep'], '2026-10-18T10:00:00Z');
  }
  for (const [i, d] of ['19', '20', '21', '22', '23'].entries()) {
    fs.appendFileSync(path.join(repo, LOG), `${logRow(ROW(1, i + 3))}\n`);
    git(['commit', '-q', '-a', '-m', `${ROW(1, i + 3)} landed`], `2026-10-${d}T10:00:00Z`);
  }
  const home = tmpDir('harness-due-agents-');
  return { repo, home, git, write };
}

// The fixture's sweep report is dated 2026-10-18 and its five landings follow, so the runner's clock stands CADENCE.sweep.days + 1
// days on (8, with the template's 7): the sweep is due by days, whatever the binding, with the 5 landings the fixture holds.
const SWEEP_DAYS = Math.max(8, CADENCE.sweep.days + 1);
const RUN_NOW = new Date(Date.UTC(2026, 9, 18 + SWEEP_DAYS, 12)).toISOString();
// a day of the fixture as YYYY-MM-DD; a day past the month's end rolls into the next month
const dayOf = (n) => new Date(Date.UTC(2026, 9, n)).toISOString().slice(0, 10);
const DUE_SWEEP = new RegExp(`^DUE sweep — ${SWEEP_DAYS} d, 5 landings since .*2026-10-18.* — `, 'm');

function run(f, args, cwd = f.repo) {
  return spawnSync(process.execPath, [RUNNER, '--now', RUN_NOW, '--home', f.home, ...args], { cwd, env: cleanEnv(), encoding: 'utf8' });
}

test('the wrapper: claiming the row that opens a phase with no preflight stops with exit 1; a phase under way is named, never stopped', () => {
  const f = fixture();
  const opens = run(f, ['--claim', ROW(2, 1)]);
  if (REPORTS.preflight === null || PH2 === null) {
    // the binding's own behaviour: no preflight bound, or no phase for the claim to open: nothing to stop for
    assert.equal(opens.status, 0, opens.stderr);
    assert.doesNotMatch(opens.stdout, /^DUE preflight/m);
    return;
  }
  assert.equal(opens.status, 1, opens.stderr);
  assert.match(opens.stdout, new RegExp(`^DUE preflight ${PH2} — no report at ${fill(REPORTS.preflight, PH2).replace(/[.]/g, '\\.')}, and ${ROW(2, 1).replace(/[.]/g, '\\.')} opens the phase: the claim waits for it — `, 'm'));
  const underWay = run(f, ['--claim', ROW(1, 8)]);
  assert.equal(underWay.status, 0, underWay.stderr);
  assert.match(underWay.stdout, new RegExp(`^DUE preflight ${PH1} — no report at .*, and the phase is under way \\(7 log rows, 0 merges\\) — `, 'm'));
  // a report on disk that no commit holds clears nothing: the unit stays due until its report is committed
  f.write(fill(REPORTS.preflight, PH2), `# Preflight ${PH2}\n`);
  const unsaved = run(f, ['--claim', ROW(2, 1)]);
  assert.equal(unsaved.status, 1, unsaved.stdout + unsaved.stderr);
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', `${PH2} preflight`], '2026-10-24T10:00:00Z');
  const cleared = run(f, ['--claim', ROW(2, 1), '--json']);
  assert.equal(cleared.status, 0, cleared.stderr);
  const json = JSON.parse(cleared.stdout);
  assert.equal(json.blocking, 0);
  assert.ok(!json.due.some((d) => d.kind === 'preflight'));
});

test('the wrapper: a sweep report that no commit holds does not clear the sweep; committed, it does', () => {
  const f = fixture();
  const yesterday = dayOf(17 + SWEEP_DAYS);
  if (REPORTS.sweep !== null) f.write(fill(REPORTS.sweep, yesterday), '# Sweep\n');
  const unsaved = run(f, []);
  assert.equal(unsaved.status, 0, unsaved.stderr);
  if (REPORTS.sweep !== null) assert.match(unsaved.stdout, DUE_SWEEP);
  if (REPORTS.sweep === null) return;
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'sweep'], `${yesterday}T10:00:00Z`);
  assert.doesNotMatch(run(f, []).stdout, /^DUE sweep/m);
});

test('the wrapper: a landed branch that merged the mainline into itself is one landing, not two', () => {
  const f = fixture();
  const branch = `task/${ROW(1, 9)}`;
  f.git(['checkout', '-q', '-b', branch]);
  f.write('own.txt', 'own');
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'own work'], '2026-10-24T09:00:00Z');
  f.git(['checkout', '-q', MAIN]);
  f.write('main.txt', 'main moved');
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'main moved on'], '2026-10-24T10:00:00Z');
  f.git(['checkout', '-q', branch]);
  f.git(['merge', '-q', '--no-ff', '-m', `Merge ${MAIN} into ${branch}`, MAIN], '2026-10-24T11:00:00Z');
  f.git(['checkout', '-q', MAIN]);
  f.git(['merge', '-q', '--no-ff', '-m', `Merge ${branch}`, branch], '2026-10-24T12:00:00Z');
  const res = run(f, ['--claim', ROW(1, 9)]);
  assert.equal(res.status, 0, res.stderr);
  if (REPORTS.preflight !== null && PH1 !== null) {
    assert.match(res.stdout, new RegExp(`^DUE preflight ${PH1} — no report at .*, and the phase is under way \\(7 log rows, 1 merge\\) — `, 'm'));
  } else assert.doesNotMatch(res.stdout, /^DUE preflight/m);
});

test('blameDates dates a committed line by its commit and a line not committed yet by nothing', () => {
  const f = fixture();
  const file = path.join(f.repo, LOG);
  assert.ok([...blameDates(f.repo, LOG).values()].every(Number.isFinite));
  // line 5 is the first log row, edited here; line 12 is a row appended here; neither is committed
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8').replace(`${ROW(1, 1)} · plan · Code · ${TIER} | 60m`, `${ROW(1, 1)} · plan · Code · ${TIER} | 61m`)}${logRow(ROW(1, 9))}\n`);
  const dates = blameDates(f.repo, LOG);
  assert.equal(dates.size, 12);
  assert.equal(dates.get(5), null);
  assert.equal(dates.get(12), null);
  assert.equal(dates.get(6), at('17T10:00:00'));
  assert.equal(dates.get(7), at('19T10:00:00'));
});

test('the wrapper: a sweep report past its cadence with 5 landings since is due; the unread proposals are NEW until --seen', () => {
  const f = fixture();
  const proposals = path.join(f.home, '.agents', 'harness', 'retro');
  fs.mkdirSync(proposals, { recursive: true });
  fs.writeFileSync(path.join(proposals, 'proposals-2026-W44.md'), `### 1. [rule] x\n- Projects: ${path.basename(f.repo)}\n### 2. [rule] y\n- Projects: elsewhere\n`);
  const res = run(f, []);
  assert.equal(res.status, 0, res.stderr);
  if (REPORTS.sweep !== null) assert.match(res.stdout, DUE_SWEEP);
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

test('the wrapper: the parked units follow the due lines, with a claim or without, and never change the exit code', () => {
  const f = fixture();
  const second = 'INBOX P2-17 Gate 1 since 2026-11-06T05:30Z · Q-1 scope';
  f.write(REGISTRY, registryFile(activeSection([]), parkedSection([CR_ROW, '| P2-17 | Gate 1 | 2026-11-06T05:30Z | task/p2-17 | main | Q-1 scope |'])));
  const inbox = (res) => res.stdout.trimEnd().split('\n').filter((l) => l.startsWith('INBOX '));
  const plain = run(f, []);
  assert.equal(plain.status, 0, plain.stderr);
  assert.deepEqual(inbox(plain), [CR_LINE, second]);
  assert.deepEqual(plain.stdout.trimEnd().split('\n').slice(-2), [CR_LINE, second], 'the inbox is last');
  if (REPORTS.sweep !== null) assert.match(plain.stdout, DUE_SWEEP);
  // a claim that stops (exit 1) still prints the inbox; one that does not stop exits 0
  const stops = REPORTS.preflight !== null && PH2 !== null;
  const claimed = run(f, ['--claim', ROW(2, 1)]);
  assert.equal(claimed.status, stops ? 1 : 0, claimed.stdout + claimed.stderr);
  assert.deepEqual(claimed.stdout.trimEnd().split('\n').slice(-2), [CR_LINE, second]);
  const json = JSON.parse(run(f, ['--json']).stdout);
  assert.deepEqual(json.inbox.map((p) => [p.unit, p.gate, p.parked, p.branch, p.worktree, p.cards]), [
    ['CR-021', 'Gate 2', '2026-11-06T04:10Z', 'change/cr-021', '../wt-cr-021', 'Q-1 merge or hold · Q-2 button copy'],
    ['P2-17', 'Gate 1', '2026-11-06T05:30Z', 'task/p2-17', 'main', 'Q-1 scope'],
  ]);
  assert.ok(json.inbox.every((p) => p.command !== '' && !p.command.includes('<unit>')));
});

test('the wrapper: a registry that is missing, unreadable or without a parked section prints no INBOX line and fails nothing', () => {
  const f = fixture();
  const sans = (res) => {
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /INBOX/);
    assert.equal(JSON.parse(run(f, ['--json']).stdout).inbox.length, 0);
  };
  sans(run(f, []));
  f.write(REGISTRY, registryFile(activeSection(['| 1 | P2-16 | 2 implement | task/p2-16 | main | | 2026-11-06T03:00:00Z |'])));
  sans(run(f, []));
  f.write(REGISTRY, registryFile(['<!-- harness:parked -->', '| Unit | Gate |'].join('\n')));
  sans(run(f, []));
  fs.rmSync(path.join(f.repo, REGISTRY));
  fs.mkdirSync(path.join(f.repo, REGISTRY), { recursive: true });
  sans(run(f, []));
});

test('the wrapper: run from a linked worktree it reads the registry of the main checkout', () => {
  const f = fixture();
  f.write(REGISTRY, registryFile(activeSection([]), parkedSection([CR_ROW])));
  const linked = path.join(f.repo, '.worktrees', 'linked');
  f.git(['worktree', 'add', '-q', '-b', 'task/linked', linked, MAIN]);
  assert.ok(!fs.existsSync(path.join(linked, REGISTRY)), 'the registry is untracked: only the main checkout has it');
  const res = run(f, [], linked);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stdout.split('\n').includes(CR_LINE), res.stdout);
});

test('the wrapper: a worktree that a held row or a parked row names is never residue, whatever its state', () => {
  const f = fixture();
  const names = ['plain', 'held', 'parked'];
  for (const name of names) {
    const dir = path.join(f.repo, '.worktrees', name);
    f.git(['worktree', 'add', '-q', '-b', `task/${name}`, dir, MAIN]);
    fs.writeFileSync(path.join(dir, `${name}.txt`), name);
    f.git(['-C', dir, 'add', '.']);
    f.git(['-C', dir, 'commit', '-q', '-m', name], '2026-10-23T12:00:00Z');
    f.git(['merge', '-q', '--no-ff', '-m', `Merge task/${name}`, `task/${name}`], '2026-10-23T13:00:00Z');
  }
  const past = new Date('2026-10-24T00:00:00Z');
  for (const name of names) {
    fs.utimesSync(path.join(f.repo, '.worktrees', name, '.git'), past, past);
    fs.utimesSync(path.join(f.repo, '.git', 'worktrees', name, 'logs', 'HEAD'), past, past);
  }
  const now = new Date(past.getTime() + (WORKTREE_IDLE_HOURS + 12) * HOUR).toISOString();
  const residue = () => {
    const res = run(f, ['--json', '--now', now]);
    assert.equal(res.status, 0, res.stderr);
    const line = JSON.parse(res.stdout).due.find((d) => d.kind === 'worktrees');
    return (line?.why.split(': ')[1] ?? '').split(', ').map((p) => path.basename(p)).filter(Boolean).sort();
  };
  assert.deepEqual(residue(), names.slice().sort(), 'with no registry all three are residue');
  const held = '| 1 | P2-16 | 2 implement | task/held | .worktrees/held | | 2026-11-06T03:00:00Z |';
  const parked = '| CR-021 | Gate 2 | 2026-11-06T04:10Z | task/parked | .worktrees/parked | Q-1 merge or hold |';
  f.write(REGISTRY, registryFile(activeSection([held]), parkedSection([parked])));
  assert.deepEqual(residue(), ['plain']);
  // the same rows outside their markers name nothing
  f.write(REGISTRY, `${activeSection([])}\n\n${parkedSection([])}\n\n${held}\n${parked}\n`);
  assert.deepEqual(residue(), names.slice().sort());
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
