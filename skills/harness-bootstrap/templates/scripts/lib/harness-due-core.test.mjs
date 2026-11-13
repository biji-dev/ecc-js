// harness-bootstrap harness-due tests (generated YYYY-MM-DD). Run: node --test scripts/lib/harness-due-core.test.mjs
// [M] mechanism (ships as-is): every test but the [B] one. [B] binding: the ids of the fixtures' rows (ROW and
// PHASE_EXAMPLE, below); the rest reads the bindings of this core (MAIN, LOG, REGISTRY, REPORTS, CADENCE, WORKTREE_IDLE_HOURS,
// STATE_DIR, OWED_DAYS, DIGEST_LINES, DISK_MIN_GB, SPLIT_LINES ...)
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
import { ASK_DEFAULT, SEVERITY_COLUMNS, STATUS_COLUMNS, STATUS_WORDS, askKinds } from './retro-core.mjs';
import { isProduction } from './review-gate-core.mjs';
import {
  CADENCE,
  COMMANDS,
  DIGEST_LINES,
  DISK_MIN_GB,
  FOLLOW_UPS,
  KINDS,
  LOG,
  MAIN,
  OWED_DAYS,
  PHASE_OF,
  REBUILDABLE,
  REGISTRY,
  REPORTS,
  SPLIT_LINES,
  STATE_DIR,
  WORKTREE_IDLE_HOURS,
  askLine,
  cadenceDue,
  checkAll,
  digest,
  diskDue,
  dueParts,
  formatClaim,
  formatDue,
  heldBranches,
  heldKinds,
  inboxLines,
  isHarnessMerge,
  isHarnessUnit,
  lastReadOf,
  markDigestRead,
  markSeen,
  matchReports,
  owedItems,
  parkedUnits,
  parseArgs,
  parseWorktrees,
  phaseOf,
  preflightDue,
  productUnits,
  projectName,
  registryWorktrees,
  reportShape,
  splitItems,
  waitDue,
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

test('parseArgs takes a claim, --owner, --seen, --digest-read, --json, --now and --home, and rejects the rest', () => {
  assert.deepEqual(parseArgs([]), { claim: null, seen: null, json: false, now: null, home: null, digestRead: false, owner: false });
  assert.deepEqual(parseArgs(['--claim', 'P2-01', '--json', '--now', '2026-10-26T00:00:00Z', '--home', 'h']), {
    claim: 'P2-01',
    seen: null,
    json: true,
    now: '2026-10-26T00:00:00Z',
    home: 'h',
    digestRead: false,
    owner: false,
  });
  assert.equal(parseArgs(['--claim', 'harness/x', '--owner']).owner, true);
  assert.equal(parseArgs(['--owner', '--claim', 'harness/x']).claim, 'harness/x', '--owner takes no value');
  assert.equal(parseArgs(['--digest-read', '--now', '2026-10-26T00:00:00Z']).digestRead, true);
  assert.throws(() => parseArgs(['--digest-read', '--claim', 'P2-01']), /--digest-read records the read and checks nothing/);
  assert.throws(() => parseArgs(['--digest-read', '--seen', '2026-W44']), /pick one of --seen and --digest-read/);
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

test('a due sweep, retro or hygiene is a REPORT line written in the background, never the next unit', () => {
  for (const kind of ['sweep', 'retro', 'hygiene']) {
    const days = CADENCE[kind].days + 1;
    const item = cadenceDue(kind, { reports: [{ rel: `r/${kind}-x.md`, time: NOW - days * DAY }], now: NOW });
    assert.equal(item.command, COMMANDS[kind], `${kind} runs its bound command`);
    const text = formatDue({ items: [item] });
    assert.equal(text, `REPORT ${kind} — ${days} d, 0 landings since ${kind}-x.md — ${COMMANDS[kind]}\n`, kind);
    assert.doesNotMatch(text, /^DUE /m, `${kind} is no DUE line`);
    assert.doesNotMatch(text, /the next unit: /, `${kind} is never the next unit`);
  }
  // with every cadence due, checkAll's items print as REPORT lines and the all-clear goes
  const facts = { now: NOW, log: null, followUps: null, reports: {}, merges: [], worktrees: [] };
  const items = checkAll(facts);
  const bound = ['sweep', 'retro', 'hygiene'].filter((k) => REPORTS[k] !== null);
  assert.deepEqual(items.map((i) => i.kind), bound);
  const text = formatDue({ items });
  assert.deepEqual(text.trimEnd().split('\n').map((l) => l.split(' — ')[0]), bound.length ? bound.map((k) => `REPORT ${k}`) : ['harness-due: nothing due']);
});

test('no p3 and no proposals item ever: an old P3 queue and the week\'s proposals print nothing, and the hygiene line names no P3', () => {
  assert.ok(!KINDS.includes('p3') && !KINDS.includes('proposals'), `KINDS: ${KINDS}`);
  assert.ok(!('p3' in COMMANDS) && !('proposals' in COMMANDS), 'no p3 or proposals command');
  const fuText = `${table(['#', SEV, 'Area', ST], [['FU-1', 'P3', 'a.ts', OPEN], ['FU-2', 'P3', 'b.ts', OPEN]])}\n`;
  const fuDates = new Map([[3, NOW - 90 * DAY], [4, NOW - 60 * DAY]]);
  const proposals = { newest: { name: 'proposals-2026-W44.md', week: '2026-W44' }, text: '### 1. [rule] x\n- Projects: all\n', file: 'f' };
  for (const stage of [null, 'foundation']) {
    const facts = { now: NOW, log: null, followUps: { text: fuText, dates: fuDates }, reports: {}, merges: [], worktrees: [], proposals, seen: {}, project: 'p', stage };
    const items = checkAll(facts);
    assert.ok(items.every((i) => KINDS.includes(i.kind)), `${items.map((i) => i.kind)}`);
    for (const i of items) assert.doesNotMatch(i.why, /P3/, `${i.kind}: ${i.why}`);
    const text = formatDue({ ...dueParts(facts), inbox: [] });
    assert.doesNotMatch(text, /^(?:DUE|NEW|REPORT) (?:p3|proposals)\b/m, text);
    assert.doesNotMatch(text, /\bP3\b|proposal/i, text);
  }
  assert.deepEqual(heldKinds('foundation').filter((k) => k === 'p3'), []);
});

test('owedItems: an open row the owner supplies or decides, past OWED_DAYS, oldest first; not a younger one, a fixed one or one owing nothing', () => {
  const FIXED = STATUS_WORDS.fixed[0];
  const long = `Owner decides: ${'which export format the report keeps '.repeat(4)}`;
  const fuText = `${table(['#', SEV, 'What', ST], [
    ['FU-1', 'P2', 'Owner supplies: the staging API key name', OPEN],
    ['FU-2', 'P2', 'Owner decides: keep or drop the export', OPEN],
    ['FU-3', 'P2', 'Owner supplies: the logo file', FIXED],
    ['FU-4', 'P2', 'a typo in the footer', OPEN],
    ['FU-5', 'P1', long, OPEN],
    ['FU-6', 'P2', 'Owner supplies: the boundary', OPEN],
    ['FU-7', 'P2', 'Owner supplies: a row not committed yet', OPEN],
  ])}\n`;
  const ago = (days) => NOW - days * DAY;
  // rows sit on lines 3-9: FU-1 one day past the binding, FU-2 one day short of it, FU-6 at it exactly
  const dates = new Map([[3, ago(OWED_DAYS + 1)], [4, ago(OWED_DAYS - 1)], [5, ago(40)], [6, ago(40)], [7, ago(30)], [8, ago(OWED_DAYS)], [9, null]]);
  const owed = owedItems(fuText, dates, NOW);
  assert.deepEqual(owed.map((o) => o.id), ['FU-5', 'FU-1']);
  assert.deepEqual(owed[1], { id: 'FU-1', since: new Date(ago(OWED_DAYS + 1)).toISOString().slice(0, 10), what: 'the staging API key name' });
  assert.equal(owed[0].what.length, 80, 'the text after the label, cut to 80 characters');
  assert.ok(owed[0].what.startsWith('which export format') && owed[0].what.endsWith('…'), owed[0].what);
  assert.equal(formatDue({ owed: owed.slice(1) }), `OWED FU-1 since ${owed[1].since} — the staging API key name\nharness-due: nothing due\n`);
  // the age is the binding's: the same rows, a day later, owe FU-6 too
  assert.deepEqual(owedItems(fuText, dates, NOW + DAY).map((o) => o.id), ['FU-5', 'FU-1', 'FU-6']);
  assert.deepEqual(owedItems('', new Map(), NOW), []);
});

// A decision row as retro-core's decisionRows gives one (C6).
const dec = (unit, id, by, { date = null, decision = `decision ${id}`, cost = 'one file', cardKind = 'code', kind = 'decision', reverses = null } = {}) => ({
  unit, id, date, cls: 'C', by, cardKind, decision, cost, kind, reverses, line: `| ${id} |`,
});

test('the digest counts the grant and default rows and the merged records after the last read, newest first', () => {
  const lastRead = NOW - 5 * DAY;
  const rows = [
    dec('P2-16', 'DEC-1', 'grant', { date: '2026-10-25', cost: 'low: one file' }),
    dec('P2-16', 'DEC-2', 'default', { date: '2026-10-24', cost: '' }),
    dec('P2-16', 'DEC-3', 'grant', { date: '2026-10-01' }), // its line was committed before the last read
    dec('P2-16', 'DEC-4', 'owner', { date: '2026-10-25' }),
    dec('P2-16', 'DEC-5', 'agent', { date: '2026-10-25' }),
    dec('P2-16', 'DEC-6', 'owner-other', { date: '2026-10-25' }),
    dec('P2-17', 'DEC-1', 'grant', { decision: `${'a long decision '.repeat(10)}`, cost: 'a migration' }), // no date, no blame: unknown
    dec('P2-18', 'DEC-1', 'grant', { date: '2026-10-02' }), // no blame: the end of its day, before the read
  ];
  const rowTimes = new Map([['P2-16/DEC-1', NOW - DAY], ['P2-16/DEC-3', NOW - 9 * DAY]]);
  const records = [
    { id: 'P1-03', landed: NOW - 2 * DAY },
    { id: 'P1-02', landed: NOW - 10 * DAY },
    { id: 'P1-04', landed: null },
  ];
  const d = digest({ rows, rowTimes, records, lastRead, now: NOW, housekeeping: [{ kind: 'disk', why: '20.0 GB free', command: 'sweep' }] });
  assert.equal(d.unread, 4);
  assert.deepEqual(d.lines, [
    `DIGEST 4 unread since ${new Date(lastRead).toISOString()}`,
    'DIGEST P2-16/DEC-1 2026-10-25 · decision DEC-1 · reversal: low: one file',
    'DIGEST P2-16/DEC-2 2026-10-24 · decision DEC-2 · reversal: ?',
    'DIGEST merged P1-03 2026-10-24',
    `DIGEST P2-17/DEC-1 ? · ${'a long decision '.repeat(10).trim().slice(0, 79)}… · reversal: a migration`,
    'DIGEST disk — 20.0 GB free — sweep',
  ]);
  // never read: every grant and default row and every landed record is unread
  const never = digest({ rows, rowTimes, records, lastRead: null, now: NOW });
  assert.equal(never.unread, 7);
  assert.equal(never.lines[0], 'DIGEST 7 unread since never');
  assert.equal(lastReadOf({ p: new Date(lastRead).toISOString(), q: 'not a time' }, 'p'), lastRead);
  assert.equal(lastReadOf({ q: 'not a time' }, 'q'), null);
  assert.equal(lastReadOf(null, 'p'), null);
  assert.deepEqual(markDigestRead({ q: 'x' }, 'p', 'y'), { q: 'x', p: 'y' });
  assert.deepEqual(markDigestRead(['x'], 'p', 'y'), { p: 'y' });
});

test('the digest lists at most DIGEST_LINES unread items, newest first, then `… k more`', () => {
  const n = DIGEST_LINES + 5;
  const rows = Array.from({ length: n }, (_, i) => dec('P2-16', `DEC-${i + 1}`, i % 2 ? 'grant' : 'default'));
  const rowTimes = new Map(rows.map((r, i) => [`${r.unit}/${r.id}`, NOW - (n - i) * HOUR]));
  const d = digest({ rows, rowTimes, records: [], lastRead: null, now: NOW });
  assert.equal(d.unread, n);
  assert.equal(d.lines.length, 1 + DIGEST_LINES + 1);
  assert.equal(d.lines[1].split(' ')[1], `P2-16/DEC-${n}`, 'the newest first');
  assert.equal(d.lines[DIGEST_LINES].split(' ')[1], `P2-16/DEC-${n - DIGEST_LINES + 1}`);
  assert.equal(d.lines.at(-1), '… 5 more');
  assert.equal(digest({ rows: rows.slice(0, DIGEST_LINES), rowTimes, now: NOW }).lines.length, 1 + DIGEST_LINES, 'no `more` line at the cap');
});

test('housekeeping lines are in the digest, never unread, and never hold a claim', () => {
  const housekeeping = Array.from({ length: DIGEST_LINES + 10 }, (_, i) => ({ kind: i % 2 ? 'disk' : 'worktrees', why: `w${i}`, command: 'c' }));
  const d = digest({ rows: [], records: [], lastRead: null, now: NOW, housekeeping });
  assert.equal(d.unread, 0);
  assert.equal(d.lines[0], 'DIGEST 0 unread since never');
  assert.equal(d.lines.length, 1 + housekeeping.length);
  // checkAll's disk and worktrees items reach the digest, not a DUE line
  const parts = dueParts({ now: NOW, log: null, followUps: null, reports: {}, merges: [], worktrees: [], disk: { free: 1e9, approved: ['caches'], last: null }, stage: 'foundation' });
  assert.ok(parts.items.some((i) => i.kind === 'disk'));
  assert.ok(parts.items.every((i) => !i.blocking), 'housekeeping blocks nothing');
  assert.equal(parts.digest.unread, 0);
  const text = formatDue(parts);
  assert.match(text, /^DIGEST disk — .* — /m);
  assert.doesNotMatch(text, /^DUE disk/m);
  assert.match(text, /^harness-due: nothing due$/m, 'housekeeping leaves the all-clear in place');
});

test('there is no HOLD: 30 unread digest items over 4 days block nothing, with a claim or without, and print at most DIGEST_LINES', () => {
  const old = NOW - 4 * DAY;
  const rows = Array.from({ length: 30 }, (_, i) => dec('P2-16', `DEC-${i + 1}`, 'grant'));
  const rowTimes = new Map(rows.map((r) => [`${r.unit}/${r.id}`, old]));
  const facts = { now: NOW, log: null, followUps: null, reports: {}, merges: [], worktrees: [], stage: 'foundation', decisions: rows, rowTimes };
  for (const claim of [null, 'T-1', 'harness/x']) {
    const parts = dueParts({ ...facts, claim });
    assert.equal(parts.digest.unread, 30);
    assert.ok(!('hold' in parts) && !('holdCount' in parts.digest), 'the valve is gone');
    assert.ok(parts.items.every((i) => !i.blocking), `claim ${claim}`);
    const text = formatDue(parts);
    assert.doesNotMatch(text, /HOLD/);
    assert.equal(text.split('\n').filter((l) => /^DIGEST P2-16\//.test(l)).length, DIGEST_LINES);
    assert.ok(text.split('\n').includes(`… ${30 - DIGEST_LINES} more`));
    assert.equal(formatClaim(parts), 'harness-due: nothing due\n', 'the digest never reaches a claim');
  }
});

test('the ASK line names the asked kinds: the default, and a granted kind demoted by its reversals', () => {
  assert.equal(askLine(askKinds([])), `ASK ${ASK_DEFAULT.join(', ')} — default`);
  const granted = Array.from({ length: 20 }, (_, i) => dec('P2-16', `DEC-${i + 1}`, 'grant', { date: `2026-10-${String(i + 1).padStart(2, '0')}` }));
  const reversal = (n, target) => dec('P2-16', `DEC-${100 + n}`, 'owner', { date: '2026-10-25', kind: 'reversal', cardKind: null, decision: `reverses ${target}`, reverses: `P2-16/${target}` });
  const three = [...granted, reversal(1, 'DEC-1'), reversal(2, 'DEC-2'), reversal(3, 'DEC-3')];
  assert.equal(askLine(askKinds(three)), 'ASK code, owner-fact, never-auto — demoted: code 3/20');
  assert.equal(askLine(askKinds(three.slice(0, 22))), `ASK ${ASK_DEFAULT.join(', ')} — default`, '2 of 20 does not demote');
  assert.equal(askLine(null), `ASK ${ASK_DEFAULT.join(', ')} — default`);
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
  // the bound minimum: 2 GB over it nothing is due, 1 GB under it the check is
  assert.equal(diskDue({ free: (DISK_MIN_GB + 2) * 1e9, approved: ['pnpm'] }), null);
  assert.match(diskDue({ free: (DISK_MIN_GB - 1) * 1e9, approved: ['pnpm'] }).why, new RegExp(`^${DISK_MIN_GB - 1}\\.0 GB free, under ${DISK_MIN_GB}; approved: pnpm$`));
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

test('markSeen moves a project\'s seen week forward only, and projectName reads the weekly job\'s registry', () => {
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
    assert.match(hygiene.why, /since the log began, and no report yet$/);
  }
  assert.ok(!kinds.includes('p3'));
  assert.ok(!kinds.includes('disk'));
  assert.deepEqual(kinds, [...kinds].sort((x, y) => KINDS.indexOf(x) - KINDS.indexOf(y)));
  const preflight = items.find((i) => i.kind === 'preflight');
  // no preflight bound, or no phase for the claim to open: nothing waits
  if (REPORTS.preflight === null || PH2 === null) assert.ok(!kinds.includes('preflight'), 'no preflight is due');
  else assert.equal(preflight.blocking, true);
  const text = formatDue({
    items: [
      { kind: 'preflight', subject: 'P2', why: 'no report', command: 'run the preflight', blocking: true },
      { kind: 'sweep', subject: null, why: '8 d, 5 landings since sweep-2026-10-18.md', command: 'run the sweep', blocking: false },
    ],
  });
  assert.equal(text, 'DUE preflight P2 — no report — run the preflight\nREPORT sweep — 8 d, 5 landings since sweep-2026-10-18.md — run the sweep\n');
  assert.equal(formatDue({}), 'harness-due: nothing due\n');
  assert.equal(formatDue(), 'harness-due: nothing due\n');
});

test('isHarnessUnit: a harness/<slug> row id; a plan row, a task branch or a mention is not', () => {
  for (const s of ['harness/install', 'Harness/flip', '`harness/x`'])
    assert.equal(isHarnessUnit(s), true, s);
  for (const s of [ROW(1, 1), `task/${ROW(1, 3)}`, 'the harness/ docs', 'noharness/x', 'app/harness/x', '', null])
    assert.equal(isHarnessUnit(s), false, s);
});

test('isHarnessMerge: the merged branch is a harness/ branch, in the runner\'s, git\'s and GitHub\'s forms; a title naming one is not', () => {
  for (const s of ['Merge harness/risk-map: re-derive', "Merge branch 'harness/sweep-2026-11-07'", "Merge branch 'harness/x' into main", 'Merge `harness/x`',
    "Merge remote-tracking branch 'origin/harness/x'", 'Merge pull request #4 from user/harness/sweep-x'])
    assert.equal(isHarnessMerge(s), true, s);
  for (const s of [`Merge task/${ROW(1, 3)}: x`, 'Merge t0.01-project-setup: T0.01 Project setup', "Merge branch 'task/P1-05': document harness/sweep-x syntax",
    'Merge pull request #5 from user/task/P1-05', 'Merge noharness/x', 'Squash harness/x', ''])
    assert.equal(isHarnessMerge(s), false, s);
});

test('checkAll counts product landings only: seven harness units and one product unit since the sweep are one landing', () => {
  const ids = [...[1, 2, 3, 4, 5, 6, 7].map((n) => `harness/h${n}`), ROW(1, 1)];
  const logText = `# Log\n\n${table(LOG_HEAD, [])}\n${ids.map(logRow).join('\n')}\n`;
  const birth = NOW - 3 * DAY;
  // header lines 1-4 at the log's birth, then one row an hour, all after the sweep report
  const logDates = new Map([[1, birth], [2, birth], [3, birth], [4, birth], ...ids.map((_, i) => [5 + i, birth + (i + 2) * HOUR])]);
  const sweep = { rel: fill(REPORTS.sweep ?? 'r/sweep-<date>.md', '2026-10-24'), time: birth + HOUR };
  const facts = (merges) => ({
    now: NOW,
    claim: null,
    log: { text: logText, dates: logDates },
    followUps: null,
    reports: { sweep: [sweep], retro: [], hygiene: [] },
    merges,
    worktrees: [],
    proposals: null,
    seen: {},
    project: 'p',
  });
  const harnessMerges = ids.slice(0, 7).map((id, i) => ({ t: birth + (i + 2) * HOUR, subject: `Merge ${id}: x` }));
  const productMerge = { t: birth + 9 * HOUR, subject: `Merge task/${ROW(1, 1)}: x` };
  const kinds = (f) => checkAll(f).map((i) => i.kind);
  if (REPORTS.sweep !== null && CADENCE.sweep.landings !== null && CADENCE.sweep.landings > 1 && CADENCE.sweep.days > 3) {
    assert.ok(!kinds(facts([...harnessMerges, productMerge])).includes('sweep'), 'harness units are no landings');
    // the same count of product units is due
    const product = ids.map((_, i) => ROW(1, i + 1));
    const productLog = `# Log\n\n${table(LOG_HEAD, [])}\n${product.map(logRow).join('\n')}\n`;
    const due = checkAll({ ...facts([]), log: { text: productLog, dates: logDates } }).find((i) => i.kind === 'sweep');
    assert.match(due.why, /^2 d, 8 landings since /);
  }
});

test('the foundation stage holds the cadences; the preflight still blocks, and formatDue names what it holds', () => {
  const logText = `# Log\n\n${table(LOG_HEAD, [])}\n${logRow('harness/install')}\n`;
  const old = NOW - 40 * DAY;
  const fuText = `${table(['#', SEV, ST], [['FU-1', 'P3', OPEN]])}\n`;
  const facts = {
    now: NOW,
    claim: ROW(2, 1),
    log: { text: logText, dates: new Map([[1, old], [2, old], [3, old], [4, old], [5, old]]) },
    followUps: { text: fuText, dates: new Map([[3, old]]) },
    reports: { preflight: [], sweep: [], retro: [], hygiene: [] },
    merges: [],
    disk: { free: 1e9, approved: ['caches'], last: null },
    worktrees: [],
    proposals: null,
    seen: {},
    project: 'p',
  };
  const full = checkAll({ ...facts, stage: 'full' }).map((i) => i.kind);
  const held = checkAll({ ...facts, stage: 'foundation' }).map((i) => i.kind);
  for (const kind of ['sweep', 'retro', 'hygiene', 'p3']) assert.ok(!held.includes(kind), kind);
  assert.ok(held.includes('disk'));
  if (REPORTS.preflight !== null && PH2 !== null) assert.ok(held.includes('preflight'));
  // what a full stage, or no stage, finds is what v8 found
  assert.deepEqual(checkAll(facts).map((i) => i.kind), full);
  const bound = ['sweep', 'retro', 'hygiene'].filter((k) => REPORTS[k] !== null);
  assert.deepEqual(heldKinds('foundation'), bound);
  assert.deepEqual(heldKinds('full'), []);
  assert.deepEqual(heldKinds(null), []);
  assert.equal(formatDue({ held: ['sweep', 'hygiene'] }), 'harness-due: nothing due\nHELD sweep, hygiene — foundation stage — they wait for the flip\n');
  assert.equal(formatDue({ inbox: ['INBOX P2-17'], held: ['sweep'] }), 'INBOX P2-17\nharness-due: nothing due\nHELD sweep — foundation stage — they wait for the flip\n');
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
    ['no header', registryFile(['<!-- harness:parked -->', ...rows, '<!-- /harness:parked -->'].join('\n'))],
    ['no separator row', registryFile(['<!-- harness:parked -->', PARKED_HEAD[0], ...rows, '<!-- /harness:parked -->'].join('\n'))],
    ['no Unit column', registryFile(parkedSection(['| Gate 2 | 2026-11-06T04:10Z |'], ['| Gate | Parked (UTC) |', '|---|---|']))],
  ]) assert.deepEqual(inboxLines(text), [], what);
  // the markers as the commit guard reads its active ones (harness-guard.sh's rows()): the header right above the begin
  // marker, a marker inside a line of text, and a section not closed after its begin marker, read to the file's end
  for (const [what, text] of [
    ['a header above the begin marker', registryFile([...PARKED_HEAD, '<!-- harness:parked -->', ...rows, '<!-- /harness:parked -->'].join('\n'))],
    ['markers inside lines of text', registryFile(['The parked units: <!-- harness:parked -->', ...PARKED_HEAD, ...rows, 'and no more <!-- /harness:parked --> here'].join('\n'))],
    ['the end marker before the begin marker', registryFile(['<!-- /harness:parked -->', '<!-- harness:parked -->', ...PARKED_HEAD, ...rows].join('\n'))],
  ]) assert.deepEqual(inboxLines(text), [CR_LINE], what);
  // rows above and below the markers belong to no table; a prose line naming both markers opens the section, as it opens the guard's, and the end marker below closes it
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
  // every row the commit guard holds keeps its worktree (harness-guard.sh's rows()): the header right above the begin
  // marker, markers inside lines of text, a row number with a space in it, a row above the header, every marked section
  // and one not closed, to the file's end; every Worktree column, and a cell split at an escaped pipe as the guard splits it
  const guard = (...lines) => registryWorktrees(lines.join('\n'), '/r/main');
  const HEAD = ['| # | Unit | Step | Branch | Worktree |', '|---|---|---|---|---|'];
  const at = (n, wt) => `| ${n} | CR-02${n} | 5 | change/cr-02${n} | ${wt} |`;
  assert.deepEqual(guard(...HEAD, '<!-- harness:active -->', at(1, '../wt-held'), '<!-- /harness:active -->'), ['/r/wt-held']);
  assert.deepEqual(guard('Held rows: <!-- harness:active -->', ...HEAD, '| 1 0 | CR-021 | 5 | b | ../wt-a |', 'held rows end <!-- /harness:active --> here'), ['/r/wt-a']);
  assert.deepEqual(
    guard('<!-- harness:active -->', at(2, '../wt-above'), ...HEAD, at(1, '../wt-a'), '<!-- /harness:active -->', '', '<!-- harness:active -->', at(3, '../wt-second'), '<!-- /harness:active -->', '<!-- harness:active -->', at(4, '../wt-open')),
    ['/r/wt-above', '/r/wt-a', '/r/wt-second', '/r/wt-open'],
  );
  assert.deepEqual(guard('<!-- harness:active -->', '| # | Worktree | Unit | Worktree |', '|---|---|---|---|', '| 1 | ../wt-x | CR-021 | ../wt-y |', '<!-- /harness:active -->'), ['/r/wt-x', '/r/wt-y']);
  assert.deepEqual(guard('<!-- harness:active -->', '| # | Unit | Notes | Worktree |', '|---|---|---|---|', '| 1 | CR-021 | a\\|../wt-split | main |', '<!-- /harness:active -->'), ['/r/wt-split']);
  // no header row: no column is the Worktree one, so a held row locks the main checkout and a parked one names nothing
  assert.deepEqual(guard('<!-- harness:active -->', at(1, '../wt-a'), '<!-- /harness:active -->', '<!-- harness:parked -->', CR_ROW, '<!-- /harness:parked -->'), []);
  assert.deepEqual(registryWorktrees(registryFile([...PARKED_HEAD, '<!-- harness:parked -->', CR_ROW, '<!-- /harness:parked -->'].join('\n')), '/r/main'), ['/r/wt-cr-021']);
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
  // a row or git may name a checkout through a link: both sides are compared as `real` gives them, as the guard compares
  // them (cd and pwd -P); `real` is the identity unless the facts give one
  const links = { '/r/alias-a': '/r/.worktrees/a', '/r/.worktrees/c': '/r/real-c', '/r/alias-c': '/r/real-c' };
  const real = (p) => links[p] ?? p;
  assert.equal(worktreesDue({ worktrees, now: NOW, top: '/r', named: ['/r/alias-a', '/r/alias-c'] }).why.split(': ')[1], '.worktrees/a, .worktrees/b, .worktrees/c');
  assert.equal(worktreesDue({ worktrees, now: NOW, top: '/r', named: ['/r/alias-a', '/r/alias-c'], real }).why.split(': ')[1], '.worktrees/b');
  const aliased = registryFile(parkedSection(['| CR-021 | Gate 2 | 2026-11-06T04:10Z | change/cr-021 | alias-a | Q-1 |']));
  assert.equal(line({ ...facts, registry: { text: aliased, root: '/r' } }), '.worktrees/a, .worktrees/b, .worktrees/c');
  assert.equal(line({ ...facts, registry: { text: aliased, root: '/r', real } }), '.worktrees/b, .worktrees/c');
});

test('formatDue puts the inbox lines right after the owed ones, ahead of the due lines, and nothing due stays nothing due while the owner has an inbox', () => {
  const item = { kind: 'sweep', subject: null, why: '8 d', command: 'run the sweep', blocking: false };
  assert.equal(formatDue({ items: [item], inbox: [CR_LINE, 'INBOX P2-17'] }), `${CR_LINE}\nINBOX P2-17\nREPORT sweep — 8 d — run the sweep\n`);
  assert.equal(formatDue({ inbox: [CR_LINE] }), `${CR_LINE}\nharness-due: nothing due\n`);
  assert.equal(formatDue({ inbox: [] }), 'harness-due: nothing due\n');
  assert.equal(formatDue({ items: [item] }), 'REPORT sweep — 8 d — run the sweep\n');
});

test('SPLIT: a held unit past SPLIT_LINES production lines against the mainline, docs and tests aside; not at SPLIT_LINES', () => {
  const exempt = ['docs/plan.md', 'README.md', 'src/a.test.ts', 'tests/b.js', 'e2e/c.spec.ts'];
  for (const p of exempt) assert.equal(isProduction(p), false, `${p} counts as docs or tests`);
  assert.equal(isProduction('src/a.ts'), true);
  const numstat = (extra) => [`${SPLIT_LINES - 1}\t1\tsrc/a.ts`, ...exempt.map((p) => `900\t100\t${p}`), '-\t-\tsrc/logo.png', ...extra].join('\n');
  assert.deepEqual(splitItems([{ unit: 'P2-16', branch: 'task/p2-16', numstat: numstat([]) }]), [], 'exactly the cap is no split');
  const over = splitItems([{ unit: 'P2-16', branch: 'task/p2-16', numstat: numstat(['1\t0\tsrc/b.ts']) }, { unit: 'P2-17', branch: 'task/p2-17', numstat: '' }]);
  assert.deepEqual(over, [{ unit: 'P2-16', branch: 'task/p2-16', lines: SPLIT_LINES + 1, cap: SPLIT_LINES }]);
  assert.equal(
    formatDue({ split: over }),
    `SPLIT P2-16 — ${SPLIT_LINES + 1} production lines past the ${SPLIT_LINES}-line cap — land the green slices (flag-off where unfinished); the rest is the next unit\n`,
  );
  // the held rows' branches: row 0, a parked row, an empty or placeholder cell and an option-like word name none
  const text = registryFile(
    activeSection(['| 1 | P2-16 | 2 implement | `task/p2-16` | main | | |', '| 2 | P2-17 | 2 | - | main | | |', '| 3 | P2-18 | 2 | | main | | |', '| 4 | P2-19 | 2 | --output=x | main | | |', '| 5 | | 2 | task/no-unit | main | | |']),
    parkedSection([CR_ROW]),
  );
  assert.deepEqual(heldBranches(text), [{ unit: 'P2-16', branch: 'task/p2-16' }, { unit: 'task/no-unit', branch: 'task/no-unit' }]);
  assert.deepEqual(heldBranches(registryFile(parkedSection([CR_ROW]))), []);
  assert.deepEqual(heldBranches(null), []);
});

test('formatDue prints the parts in C7\'s order: OWED, INBOX, SPLIT, DUE (WAIT first), REPORT, ASK, then the digest', () => {
  const wait = { kind: 'wait', subject: 'harness/x', why: '1 product unit held or parked: T-7', command: 'product units come first', blocking: true };
  const preflight = { kind: 'preflight', subject: 'P2', why: 'no report', command: 'run the preflight', blocking: true };
  const sweep = { kind: 'sweep', subject: null, why: '8 d', command: 'write the sweep', blocking: false };
  const disk = { kind: 'disk', subject: null, why: '20.0 GB free', command: 'free disk', blocking: false };
  const rows = Array.from({ length: 3 }, (_, i) => dec('P2-16', `DEC-${i + 1}`, 'grant', { date: '2026-10-20' }));
  const d = digest({ rows, rowTimes: new Map(rows.map((r) => [`${r.unit}/${r.id}`, NOW - DAY])), lastRead: null, now: NOW, housekeeping: [disk], max: 1 });
  const text = formatDue({
    items: [wait, preflight, sweep, disk],
    owed: [{ id: 'FU-1', since: '2026-10-20', what: 'the key name' }],
    inbox: [CR_LINE],
    split: [{ unit: 'P2-16', branch: 'b', lines: SPLIT_LINES + 1, cap: SPLIT_LINES }],
    ask: askKinds([]),
    digest: d,
    held: [],
  });
  const lines = text.trimEnd().split('\n');
  assert.deepEqual(lines.map((l) => l.split(' ')[0]), ['OWED', 'INBOX', 'SPLIT', 'WAIT', 'DUE', 'REPORT', 'ASK', 'DIGEST', 'DIGEST', '…', 'DIGEST']);
  assert.equal(lines[0], 'OWED FU-1 since 2026-10-20 — the key name');
  assert.equal(lines[1], CR_LINE);
  assert.equal(lines[3], 'WAIT harness/x — 1 product unit held or parked: T-7 — product units come first');
  assert.equal(lines[4], 'DUE preflight P2 — no report — run the preflight');
  assert.equal(lines[5], 'REPORT sweep — 8 d — write the sweep');
  assert.equal(lines[6], `ASK ${ASK_DEFAULT.join(', ')} — default`);
  assert.equal(lines.at(-1), 'DIGEST disk — 20.0 GB free — free disk');
  assert.ok(!lines.includes('harness-due: nothing due'));
  // the all-clear: nothing that splits, is due or is a report; OWED and INBOX lines leave it in place, before ASK
  assert.deepEqual(
    formatDue({ owed: [{ id: 'FU-1', since: '2026-10-20', what: 'x' }], inbox: [CR_LINE], ask: askKinds([]), digest: digest({ now: NOW }) }).trimEnd().split('\n'),
    ['OWED FU-1 since 2026-10-20 — x', CR_LINE, 'harness-due: nothing due', `ASK ${ASK_DEFAULT.join(', ')} — default`, 'DIGEST 0 unread since never'],
  );
  for (const part of [{ split: [{ unit: 'u', lines: 2, cap: 1 }] }, { items: [wait] }, { items: [preflight] }, { items: [sweep] }]) {
    assert.doesNotMatch(formatDue(part), /nothing due/, Object.keys(part)[0]);
  }
});

test('waitDue: a harness claim waits while the active or parked table holds a product unit; a product claim, --owner and harness rows do not', () => {
  const held = (unit) => `| 1 | ${unit} | 2 implement | task/${unit} | main | | 2026-11-06T03:00:00Z |`;
  const registry = (...rows) => registryFile(activeSection(rows));
  const wait = (claim, text, owner = false) => waitDue({ claim, registryText: text, owner, command: 'product first' });
  const one = wait('harness/x', registry(held('T-7')));
  assert.deepEqual(one, { kind: 'wait', subject: 'harness/x', why: '1 product unit held or parked: T-7', command: 'product first', blocking: true });
  assert.equal(formatDue({ items: [one] }), 'WAIT harness/x — 1 product unit held or parked: T-7 — product first\n');
  assert.equal(formatClaim({ items: [one] }), 'WAIT harness/x — 1 product unit held or parked: T-7 — product first\n');
  // a parked row counts as well; both tables, in table order, without repeats
  const both = registryFile(activeSection([held('T-7'), held('T-8')]), parkedSection([CR_ROW, '| T-7 | Gate 1 | 2026-11-06T05:30Z | b | main | Q-1 |']));
  assert.equal(wait('harness/x', both).why, '3 product units held or parked: T-7, T-8, CR-021');
  assert.equal(wait('harness/x', registryFile(parkedSection([CR_ROW]))).why, '1 product unit held or parked: CR-021');
  // at most five are named
  const many = registry(...[1, 2, 3, 4, 5, 6, 7].map((n) => held(`T-${n}`)));
  assert.equal(wait('harness/x', many).why, '7 product units held or parked: T-1, T-2, T-3, T-4, T-5, +2 more');
  // nothing waits: row 0 (the mainline), harness rows, a row with no unit, the claim itself, no registry
  assert.equal(wait('harness/x', registry(held('harness/y'), '| 2 | | 2 | task/z | main | | |')), null);
  assert.equal(wait('harness/x', registryFile(activeSection([]))), null);
  assert.equal(wait('harness/x', registry(held('harness/x'))), null);
  assert.equal(wait('harness/x', null), null);
  assert.equal(wait('harness/x', 'not a registry'), null);
  assert.equal(wait('harness/x', registry(held('T-7')), true), null, '--owner skips the wait');
  assert.equal(wait('T-9', registry(held('T-7'))), null, 'a product claim never waits');
  assert.equal(wait(null, registry(held('T-7'))), null);
  assert.equal(wait('`harness/x`', registry(held('T-7'))).blocking, true);
  assert.deepEqual(productUnits(both, 'T-8'), ['T-7', 'CR-021']);
  assert.ok(typeof COMMANDS.wait === 'string' && COMMANDS.wait !== '');
  // through checkAll and dueParts: first among the items, blocking; the owner's word and a product claim leave it out
  const facts = { now: NOW, claim: 'harness/x', log: null, followUps: null, reports: {}, merges: [], worktrees: [], registry: { text: registry(held('T-7')), root: '/r' } };
  assert.equal(checkAll(facts)[0].kind, 'wait');
  assert.equal(dueParts(facts).items[0].blocking, true);
  assert.ok(!checkAll({ ...facts, owner: true }).some((i) => i.kind === 'wait'));
  assert.ok(!checkAll({ ...facts, claim: 'P1-03' }).some((i) => i.kind === 'wait'));
  assert.ok(!checkAll({ ...facts, claim: null }).some((i) => i.kind === 'wait'));
});

test('formatClaim prints only what blocks the claim: the wait and the opening preflight; a phase under way, a report, an owed row are left out', () => {
  const wait = { kind: 'wait', subject: 'harness/x', why: 'w', command: 'c', blocking: true };
  const opens = { kind: 'preflight', subject: 'P2', why: 'no report', command: 'run it', blocking: true };
  const underWay = { kind: 'preflight', subject: 'P1', why: 'under way', command: 'run it', blocking: false };
  const sweep = { kind: 'sweep', subject: null, why: '8 d', command: 'write the sweep', blocking: false };
  const disk = { kind: 'disk', subject: null, why: '5 GB free', command: 'free it', blocking: false };
  assert.equal(formatClaim({ items: [wait, opens, underWay, sweep, disk] }), 'WAIT harness/x — w — c\nDUE preflight P2 — no report — run it\n');
  assert.equal(formatClaim({ items: [underWay, sweep, disk] }), 'harness-due: nothing due\n');
  assert.equal(formatClaim({}), 'harness-due: nothing due\n');
  assert.equal(formatClaim(), 'harness-due: nothing due\n');
  // a sweep due, an owed row, a parked unit and an unread digest: a product claim hears none of them
  const facts = {
    now: NOW,
    claim: 'T-1',
    log: null,
    followUps: { text: `${table(['#', SEV, 'What', ST], [['FU-1', 'P2', 'Owner supplies: the key name', OPEN]])}\n`, dates: new Map([[3, NOW - 9 * DAY]]) },
    reports: {},
    merges: [],
    worktrees: [],
    registry: { text: registryFile(activeSection([]), parkedSection([CR_ROW])), root: '/r' },
    decisions: [dec('P2-16', 'DEC-1', 'grant')],
    rowTimes: new Map([['P2-16/DEC-1', NOW - DAY]]),
  };
  const parts = dueParts(facts);
  assert.ok(parts.items.some((i) => i.kind === 'sweep') && parts.owed.length === 1 && parts.digest.unread === 1, 'they are all there to print');
  assert.equal(formatClaim(parts), 'harness-due: nothing due\n');
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
  // the owner read the digest after the fixture's last landing: a test that is not about the digest sees no unread item
  const project = path.basename(repo);
  fs.mkdirSync(path.join(home, '.agents', 'harness'), { recursive: true });
  fs.writeFileSync(path.join(home, '.agents', 'harness', 'digest-read.json'), JSON.stringify({ [project]: '2026-10-24T00:00:00.000Z' }));
  return { repo, home, git, write, project };
}

// The fixture's sweep report is dated 2026-10-18 and its five landings follow, so the runner's clock stands CADENCE.sweep.days + 1
// days on (8, with the template's 7): the sweep is due by days, whatever the binding, with the 5 landings the fixture holds.
const SWEEP_DAYS = Math.max(8, CADENCE.sweep.days + 1);
const RUN_NOW = new Date(Date.UTC(2026, 9, 18 + SWEEP_DAYS, 12)).toISOString();
// a day of the fixture as YYYY-MM-DD; a day past the month's end rolls into the next month
const dayOf = (n) => new Date(Date.UTC(2026, 9, n)).toISOString().slice(0, 10);
const DUE_SWEEP = new RegExp(`^REPORT sweep — ${SWEEP_DAYS} d, 5 landings since .*2026-10-18.* — `, 'm');

function run(f, args, cwd = f.repo) {
  return spawnSync(process.execPath, [RUNNER, '--now', RUN_NOW, '--home', f.home, ...args], { cwd, env: cleanEnv(), encoding: 'utf8' });
}

test('the wrapper: claiming the row that opens a phase with no preflight stops with exit 1; a phase under way is no line of a claim', () => {
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
  // only the line that blocks: a claim of a phase under way prints nothing but the all-clear (the item is in --json)
  assert.equal(opens.stdout.trimEnd().split('\n').length, 1, opens.stdout);
  const underWay = run(f, ['--claim', ROW(1, 8)]);
  assert.equal(underWay.status, 0, underWay.stderr);
  assert.equal(underWay.stdout, 'harness-due: nothing due\n');
  const underWayJson = JSON.parse(run(f, ['--claim', ROW(1, 8), '--json']).stdout);
  assert.match(underWayJson.due.find((d) => d.kind === 'preflight').why, /, and the phase is under way \(7 log rows, 0 merges\)$/);
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

test('the wrapper: a sweep report written but not committed yet clears the sweep, dated by its file; committed, it still does', () => {
  const f = fixture();
  const yesterday = dayOf(17 + SWEEP_DAYS);
  if (REPORTS.sweep === null) return;
  assert.match(run(f, []).stdout, DUE_SWEEP);
  // The report is written in the background and rides in the next unit's land commit: until then no commit holds it.
  const file = fill(REPORTS.sweep, yesterday);
  f.write(file, '# Sweep\n');
  const stamp = new Date(`${yesterday}T10:00:00Z`);
  fs.utimesSync(path.join(f.repo, file), stamp, stamp);
  const pending = run(f, []);
  assert.equal(pending.status, 0, pending.stderr);
  assert.doesNotMatch(pending.stdout, /^REPORT sweep/m, 'an uncommitted report clears the line: the runner must not start the same report twice');
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'sweep'], `${yesterday}T10:00:00Z`);
  assert.doesNotMatch(run(f, []).stdout, /^REPORT sweep/m);
});

test('the wrapper: a foundation-stage manifest holds the sweep and says so; a full one, or none, does not', () => {
  const f = fixture();
  if (REPORTS.sweep === null) return;
  assert.match(run(f, []).stdout, DUE_SWEEP);
  f.write('.agents/harness-manifest.json', '{ "stage": "foundation" }\n');
  const held = run(f, ['--json']);
  assert.equal(held.status, 0, held.stderr);
  const json = JSON.parse(held.stdout);
  assert.ok(!json.due.some((d) => d.kind === 'sweep'));
  assert.ok(json.held.includes('sweep'));
  assert.match(run(f, []).stdout, /^HELD sweep.* — foundation stage — they wait for the flip$/m);
  f.write('.agents/harness-manifest.json', '{ "stage": "full" }\n');
  assert.match(run(f, []).stdout, DUE_SWEEP);
  f.write('.agents/harness-manifest.json', 'not json');
  assert.match(run(f, []).stdout, DUE_SWEEP);
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
  const res = run(f, ['--claim', ROW(1, 9), '--json']);
  assert.equal(res.status, 0, res.stderr);
  const preflight = JSON.parse(res.stdout).due.find((d) => d.kind === 'preflight');
  if (REPORTS.preflight !== null && PH1 !== null) {
    assert.match(preflight.why, /, and the phase is under way \(7 log rows, 1 merge\)$/);
  } else assert.equal(preflight, undefined);
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

test('the wrapper: a sweep report past its cadence with 5 landings since is a REPORT; the week\'s proposals print nothing, and --seen still records the week', () => {
  const f = fixture();
  const proposals = path.join(f.home, '.agents', 'harness', 'retro');
  fs.mkdirSync(proposals, { recursive: true });
  fs.writeFileSync(path.join(proposals, 'proposals-2026-W44.md'), `### 1. [rule] x\n- Projects: ${path.basename(f.repo)}\n### 2. [rule] y\n- Projects: elsewhere\n`);
  const res = run(f, []);
  assert.equal(res.status, 0, res.stderr);
  if (REPORTS.sweep !== null) assert.match(res.stdout, DUE_SWEEP);
  assert.doesNotMatch(res.stdout, /proposals/);
  const seen = run(f, ['--seen', '2026-W44']);
  assert.equal(seen.status, 0, seen.stderr);
  assert.match(seen.stdout, /has read the proposals of 2026-W44/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(proposals, 'seen.json'), 'utf8')), { [path.basename(f.repo)]: '2026-W44' });
  assert.doesNotMatch(run(f, []).stdout, /proposals/);
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

test('the wrapper: the parked units come before the due lines, and never change the exit code', () => {
  const f = fixture();
  const second = 'INBOX P2-17 Gate 1 since 2026-11-06T05:30Z · Q-1 scope';
  f.write(REGISTRY, registryFile(activeSection([]), parkedSection([CR_ROW, '| P2-17 | Gate 1 | 2026-11-06T05:30Z | task/p2-17 | main | Q-1 scope |'])));
  const inbox = (res) => res.stdout.trimEnd().split('\n').filter((l) => l.startsWith('INBOX '));
  const plain = run(f, []);
  assert.equal(plain.status, 0, plain.stderr);
  assert.deepEqual(inbox(plain), [CR_LINE, second]);
  assert.deepEqual(plain.stdout.split('\n').slice(0, 2), [CR_LINE, second], 'the inbox is first, with nothing owed');
  if (REPORTS.sweep !== null) assert.match(plain.stdout, DUE_SWEEP);
  // a claim prints only what blocks it, so not the inbox; it never changes the exit code
  const stops = REPORTS.preflight !== null && PH2 !== null;
  const claimed = run(f, ['--claim', ROW(2, 1)]);
  assert.equal(claimed.status, stops ? 1 : 0, claimed.stdout + claimed.stderr);
  assert.doesNotMatch(claimed.stdout, /INBOX/);
  if (!stops) assert.equal(claimed.stdout, 'harness-due: nothing due\n');
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
  // rows that name each worktree through a link outside the repository keep it: the paths are compared as real paths
  const links = tmpDir('harness-due-links-');
  for (const name of ['held', 'parked']) fs.symlinkSync(path.join(f.repo, '.worktrees', name), path.join(links, name), 'dir');
  const via = (name) => path.relative(f.repo, path.join(links, name));
  f.write(REGISTRY, registryFile(activeSection([held.replace('.worktrees/held', via('held'))]), parkedSection([parked.replace('.worktrees/parked', via('parked'))])));
  assert.deepEqual(residue(), ['plain']);
});

const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DECISIONS_HEAD = ['ID', 'Date', 'Class', 'Decision', 'By', 'Card kind', 'Why', 'Rejected alternative', 'Reversal cost', 'Kind'];
// A unit's state file with a `## Decisions` table: [id, date, decision, by, cost] rows.
const stateFile = (rows) => `Status: landed\n\n## Decisions\n\n${table(DECISIONS_HEAD, rows.map(([id, date, decision, by, cost]) => [id, date, 'C', decision, by, 'code', 'why', 'the other way', cost, 'decision']))}\n`;

test('the wrapper: --digest-read records now for this project and keeps the others; the next run reads DIGEST 0 unread', () => {
  const f = fixture();
  const file = path.join(f.home, '.agents', 'harness', 'digest-read.json');
  fs.writeFileSync(file, JSON.stringify({ other: '2026-01-01T00:00:00.000Z' }));
  const before = run(f, []);
  assert.equal(before.status, 0, before.stderr);
  assert.match(before.stdout, /^DIGEST 7 unread since never$/m, before.stdout);
  assert.match(before.stdout, new RegExp(`^DIGEST merged ${reEsc(ROW(1, 7))} 2026-10-23$`, 'm'));
  const read = run(f, ['--digest-read']);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(read.stdout, `harness-due: ${f.project} has read the digest at ${RUN_NOW}\n`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { other: '2026-01-01T00:00:00.000Z', [f.project]: RUN_NOW });
  const after = run(f, []);
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, new RegExp(`^DIGEST 0 unread since ${reEsc(RUN_NOW)}$`, 'm'));
  assert.doesNotMatch(after.stdout, /^DIGEST merged/m);
  assert.equal(JSON.parse(run(f, ['--json']).stdout).digest.unread, 0);
  assert.equal(run(f, ['--digest-read', '--claim', ROW(1, 8)]).status, 2);
  // a home with no harness directory yet: --digest-read makes it
  fs.rmSync(path.join(f.home, '.agents'), { recursive: true, force: true });
  assert.equal(run(f, ['--digest-read']).status, 0);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), [f.project]);
  assert.equal(f.git(['status', '--porcelain']), '');
});

test('the wrapper: the state files at the mainline feed ASK and the digest, each row dated by its line\'s commit; the valve stops a claim only', () => {
  const f = fixture();
  // the owner last read the digest on 10-24; these rows land on 10-25, one of them dated 10-01 in its cell
  f.write(`${STATE_DIR}/unit-a.state.md`, stateFile([['DEC-1', '2026-10-25', 'use the queue', 'grant', 'one file'], ['DEC-2', '2026-10-01', 'keep the old name', 'default', 'low'], ['DEC-3', '2026-10-25', 'the owner chose', 'owner', 'x']]));
  f.write(`${STATE_DIR}/archive/unit-c.state.md`, stateFile([['DEC-1', '2026-10-25', 'one level down', 'grant', 'x']]));
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'unit-a landed'], '2026-10-25T10:00:00Z');
  f.write(`${STATE_DIR}/unit-b.state.md`, stateFile([['DEC-1', '2026-10-25', 'not landed yet', 'grant', 'x']]));
  const res = run(f, []);
  assert.equal(res.status, 0, res.stderr);
  // the machine's own disk may add a housekeeping line: it is no item
  const digestLines = res.stdout.split('\n').filter((l) => l.startsWith('DIGEST ') && !/^DIGEST (?:disk|worktrees) — /.test(l));
  assert.deepEqual(digestLines, [
    'DIGEST 2 unread since 2026-10-24T00:00:00.000Z',
    'DIGEST unit-a/DEC-1 2026-10-25 · use the queue · reversal: one file',
    'DIGEST unit-a/DEC-2 2026-10-01 · keep the old name · reversal: low',
  ]);
  assert.ok(res.stdout.split('\n').includes(askLine(askKinds([]))), res.stdout);
  assert.ok(res.stdout.indexOf('\nASK ') < res.stdout.indexOf('\nDIGEST '), 'the ASK line comes before the digest');
  // 30 unread rows, four days old: no HOLD, no stop, and the digest prints DIGEST_LINES of them then `… k more`
  f.write(`${STATE_DIR}/unit-d.state.md`, stateFile(Array.from({ length: 28 }, (_, i) => [`DEC-${i + 1}`, '2026-10-25', `step ${i + 1}`, 'grant', 'x'])));
  f.git(['add', `${STATE_DIR}/unit-d.state.md`]);
  f.git(['commit', '-q', '-m', 'unit-d landed'], '2026-10-25T11:00:00Z');
  const later = new Date(Date.parse('2026-10-25T11:00:00Z') + 4 * DAY).toISOString();
  const plain = run(f, ['--now', later]);
  assert.equal(plain.status, 0);
  assert.doesNotMatch(plain.stdout, /HOLD/);
  assert.match(plain.stdout, /^DIGEST 30 unread since /m);
  assert.equal(plain.stdout.split('\n').filter((l) => /^DIGEST unit-[a-d]\//.test(l)).length, DIGEST_LINES);
  assert.ok(plain.stdout.split('\n').includes(`… ${30 - DIGEST_LINES} more`), plain.stdout);
  const claimed = run(f, ['--now', later, '--claim', ROW(1, 8)]);
  assert.equal(claimed.status, 0, claimed.stdout + claimed.stderr);
  assert.equal(claimed.stdout, 'harness-due: nothing due\n', 'a claim hears nothing of the digest');
  const json = JSON.parse(run(f, ['--now', later, '--claim', ROW(1, 8), '--json']).stdout);
  assert.ok(!('hold' in json) && !('holdCount' in json.digest), 'the valve is gone');
  assert.equal(json.blocking, 0);
  assert.deepEqual(json.ask.ask, askKinds([]).ask);
  assert.equal(run(f, ['--now', later, '--digest-read']).status, 0);
  assert.match(run(f, ['--now', later]).stdout, /^DIGEST 0 unread since /m);
});

test('the wrapper: --claim prints only what blocks it: with a sweep due, an owed row and a parked unit a product claim hears nothing; an opening phase prints its DUE line alone', () => {
  const f = fixture();
  f.write(FU_FILE, `${table(['#', SEV, 'What', ST], [['FU-1', 'P2', 'Owner supplies: the key name', OPEN]])}\n`);
  f.git(['add', '.']);
  f.git(['commit', '-q', '-m', 'owed'], '2026-10-17T11:00:00Z');
  f.write(REGISTRY, registryFile(activeSection([]), parkedSection([CR_ROW])));
  const plain = run(f, []);
  if (REPORTS.sweep !== null) assert.match(plain.stdout, DUE_SWEEP);
  assert.match(plain.stdout, /^OWED FU-1 since 2026-10-17 — the key name$/m);
  assert.ok(plain.stdout.split('\n').includes(CR_LINE));
  const quiet = run(f, ['--claim', 'T-1']);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stdout, 'harness-due: nothing due\n');
  const opens = run(f, ['--claim', ROW(2, 1)]);
  if (REPORTS.preflight === null || PH2 === null) {
    assert.equal(opens.status, 0, opens.stderr);
    assert.equal(opens.stdout, 'harness-due: nothing due\n');
    return;
  }
  assert.equal(opens.status, 1, opens.stderr);
  const lines = opens.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 1, opens.stdout);
  assert.match(lines[0], new RegExp(`^DUE preflight ${PH2} — no report at `));
});

test('the wrapper: a harness claim waits for a held or parked product unit (WAIT, exit 1); --owner skips it, and held harness units do not make it wait', () => {
  const f = fixture();
  const held = (unit) => `| 1 | ${unit} | 2 implement | task/x | main | | 2026-11-06T03:00:00Z |`;
  f.write(REGISTRY, registryFile(activeSection([held('T-7')])));
  const wait = run(f, ['--claim', 'harness/x']);
  assert.equal(wait.status, 1, wait.stdout + wait.stderr);
  assert.match(wait.stdout, /^WAIT harness\/x — 1 product unit held or parked: T-7 — product units come first; a harness unit starts when none is, or on the owner's word \(--owner\)\n$/);
  assert.equal(wait.stdout.trimEnd().split('\n').length, 1, 'nothing else prints with --claim');
  const owner = run(f, ['--claim', 'harness/x', '--owner']);
  assert.equal(owner.status, 0, owner.stdout + owner.stderr);
  assert.equal(owner.stdout, 'harness-due: nothing due\n');
  assert.equal(JSON.parse(run(f, ['--claim', 'harness/x', '--json']).stdout).due[0].kind, 'wait');
  assert.equal(run(f, ['--claim', 'T-9']).stdout, 'harness-due: nothing due\n', 'a product claim does not wait');
  // a parked product unit holds it as well; a row 0 mainline and harness units do not
  f.write(REGISTRY, registryFile(activeSection([]), parkedSection([CR_ROW])));
  assert.match(run(f, ['--claim', 'harness/x']).stdout, /^WAIT harness\/x — 1 product unit held or parked: CR-021 — /);
  f.write(REGISTRY, registryFile(activeSection([held('harness/y')]), parkedSection(['| harness/z | Gate 1 | 2026-11-06T04:10Z | b | main | Q-1 |'])));
  const free = run(f, ['--claim', 'harness/x']);
  assert.equal(free.status, 0, free.stdout + free.stderr);
  assert.equal(free.stdout, 'harness-due: nothing due\n');
  // no registry: nothing to wait for
  fs.rmSync(path.join(f.repo, REGISTRY));
  assert.equal(run(f, ['--claim', 'harness/x']).status, 0);
});

test('the wrapper: a held row whose local branch is past SPLIT_LINES production lines against the mainline is a SPLIT line', () => {
  const f = fixture();
  const branch = (name, lines) => {
    f.git(['checkout', '-q', '-b', name, MAIN]);
    f.write(`src/${name.replace(/\W/g, '-')}.js`, 'x\n'.repeat(lines));
    f.write(`tests/${name.replace(/\W/g, '-')}.test.js`, 'x\n'.repeat(50));
    f.write(`docs/${name.replace(/\W/g, '-')}.md`, 'x\n'.repeat(50));
    f.git(['add', '.']);
    f.git(['commit', '-q', '-m', name], '2026-10-24T10:00:00Z');
    f.git(['checkout', '-q', MAIN]);
  };
  branch('task/big', SPLIT_LINES + 1);
  branch('task/even', SPLIT_LINES);
  f.write(REGISTRY, registryFile(
    activeSection(['| 1 | P2-16 | 2 implement | task/big | main | | |', '| 2 | P2-17 | 2 implement | task/even | main | | |', '| 3 | P2-18 | 2 implement | task/missing | main | | |']),
    parkedSection(['| CR-021 | Gate 2 | 2026-11-06T04:10Z | task/big | main | Q-1 |']),
  ));
  const res = run(f, []);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.stdout.split('\n').filter((l) => l.startsWith('SPLIT ')), [
    `SPLIT P2-16 — ${SPLIT_LINES + 1} production lines past the ${SPLIT_LINES}-line cap — land the green slices (flag-off where unfinished); the rest is the next unit`,
  ]);
  assert.doesNotMatch(res.stdout, /nothing due/);
  assert.deepEqual(JSON.parse(run(f, ['--json']).stdout).split, [{ unit: 'P2-16', branch: 'task/big', lines: SPLIT_LINES + 1, cap: SPLIT_LINES }]);
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
