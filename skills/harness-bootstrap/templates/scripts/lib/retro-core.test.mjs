// harness-bootstrap retro tests (generated YYYY-MM-DD). Run: node --test scripts/lib/retro-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the tests read the bindings, never their values.
// Hermetic: no network, no real transcripts. The wrapper tests run in a temp git repo with every GIT_*
// variable stripped, GIT_CONFIG_GLOBAL=/dev/null and a fixed identity, and a temp projects dir.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_WEEKS,
  FOLLOW_UPS,
  LOG,
  MAX_BYTES,
  MAX_CANDIDATES,
  MIN_COHORT,
  MIN_SHARE,
  OUTLIER_X,
  PLANS_DIR,
  REPORTS_DIR,
  agentCosts,
  buildRetro,
  candidates,
  claimRows,
  dispatchOwners,
  fitDigest,
  followUpsSummary,
  formatDigest,
  frictionThemes,
  isoWeek,
  logKpis,
  logRecords,
  markerUnits,
  parseArgs,
  parseDefects,
  previousData,
  previousKpis,
  rowsForUnit,
  stateSummary,
  stepOfDescription,
  stepOutliers,
  stepShares,
  transcriptKpis,
  unitOutliers,
  unitSteps,
  windowFor,
} from './retro-core.mjs';
import { parseCodexSession } from './unit-cost-core.mjs';
import { stepIntervals, stepLine } from './unit-step-core.mjs';

const RUNNER = fileURLToPath(new URL('../retro.mjs', import.meta.url));
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const NOW = Date.parse('2026-10-26T12:00:00Z'); // Monday of 2026-W44
const at = (s) => Date.parse(`2026-10-${s}Z`);

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
const LOG_HEAD = ['Unit · Mode · Type · Tier', 'Elapsed (work)', 'Owner wait', 'Defects', 'Cost', '★ Missed by harness', 'Friction'];
const logRow = (id, tier, work, cost, missed = '—', friction = '—', defects = '0/1') => [
  `${id} · plan · Code · ${tier}`,
  `${work}m`,
  '10m',
  defects,
  `Cost $${cost} · Claude 1% · Codex 2% (1 runs)`,
  missed,
  friction,
];
// The table's first data row is line 3.
const datesFor = (...days) => new Map(days.map((d, i) => [i + 3, at(d)]));

let rowKey = 0;
function row({ ts, cost = 1, kind = 'main', session = 's1', agentId = null, desc = null, cacheRead = 0, cacheWrite = 0, input = 0, writeCost = 0 }) {
  rowKey += 1;
  return { key: `m${rowKey}|r${rowKey}`, ts, cost, kind, session, agentId, agentType: kind === 'sub' ? 'x' : null, agentDescription: desc, family: 'opus', exact: true, model: 'claude-opus-5-5', output: 0, input, cacheRead, cacheWrite, writeCost };
}
const marker = (t, step, event, round = 1) => ({ t: new Date(t).toISOString(), ts: t, unit: 'U-1', step, event, round });

test('parseArgs takes the window, the sources and one output mode, and rejects the rest', () => {
  assert.deepEqual(parseArgs([]), { since: null, until: null, dryRun: false, json: false, export: null, projectsDir: null, ledger: null });
  assert.deepEqual(parseArgs(['--since', '2026-10-01', '--until', '2026-10-08', '--projects-dir', 'p', '--ledger', 'l.jsonl', '--export', 'out']), {
    since: '2026-10-01',
    until: '2026-10-08',
    dryRun: false,
    json: false,
    export: 'out',
    projectsDir: 'p',
    ledger: 'l.jsonl',
  });
  assert.throws(() => parseArgs(['--since']), /--since needs a value/);
  assert.throws(() => parseArgs(['--since', 'soon']), /--since is not a date/);
  assert.throws(() => parseArgs(['--since', '2026-10-08', '--until', '2026-10-01']), /--since must be before --until/);
  assert.throws(() => parseArgs(['--dry-run', '--json']), /pick one of/);
  assert.throws(() => parseArgs(['--export', 'x', '--dry-run']), /pick one of/);
  assert.throws(() => parseArgs(['--write']), /unknown option --write/);
  assert.throws(() => parseArgs(['toString']), /unknown option toString/);
});

test('isoWeek follows ISO 8601 at the year edges, in UTC', () => {
  assert.equal(isoWeek(NOW), '2026-W44');
  assert.equal(isoWeek(Date.parse('2026-11-01T23:59:00Z')), '2026-W44'); // Sunday ends the week
  assert.equal(isoWeek(Date.parse('2026-11-02T00:00:00Z')), '2026-W45');
  assert.equal(isoWeek(Date.parse('2026-01-01T00:00:00Z')), '2026-W01');
  assert.equal(isoWeek(Date.parse('2027-01-01T00:00:00Z')), '2026-W53');
  assert.equal(isoWeek(Date.parse('2021-01-03T12:00:00Z')), '2020-W53');
});

test('windowFor: a week back by default, from the last digest of another week, never from this week\'s own', () => {
  const plain = windowFor({ now: NOW });
  assert.equal(plain.until, new Date(NOW).toISOString());
  assert.equal(Date.parse(plain.since), NOW - WEEK);
  assert.equal(Date.parse(plain.baselineSince), NOW - WEEK - BASELINE_WEEKS * WEEK);
  assert.equal(plain.week, '2026-W44');
  const previous = [
    { week: '2026-W42', until: '2026-10-12T09:00:00.000Z' },
    { week: '2026-W43', until: '2026-10-19T09:00:00.000Z' },
    { week: '2026-W44', until: '2026-10-26T08:00:00.000Z' },
  ];
  assert.equal(windowFor({ now: NOW, previous }).since, '2026-10-19T09:00:00.000Z');
  const explicit = windowFor({ since: '2026-10-01T00:00:00Z', until: '2026-10-08T00:00:00Z', now: NOW, previous });
  assert.deepEqual([explicit.since, explicit.until, explicit.week], ['2026-10-01T00:00:00.000Z', '2026-10-08T00:00:00.000Z', '2026-W41']);
});

test('previousData reads a digest\'s data block and an export\'s JSON; a torn or missing block is null', () => {
  const data = { week: '2026-W43', since: 'a', until: '2026-10-19T00:00:00.000Z', kpis: { log: { units: 2 } } };
  assert.deepEqual(previousData(`# Retro\n\ntext\n<!-- retro-data ${JSON.stringify(data)} -->\n`), data);
  assert.deepEqual(previousData(JSON.stringify({ ...data, schema: 1, steps: [] }, null, 2)), data);
  assert.equal(previousData('<!-- retro-data {"week": -->'), null);
  assert.equal(previousData('# no block'), null);
  assert.equal(previousData('{"until":"x"}'), null);
});

test('parseDefects reads 0/2, P0 0 · P1 2 and the older 2C/6H; anything else is null', () => {
  assert.deepEqual(parseDefects('0/2'), { p0: 0, p1: 2 });
  assert.deepEqual(parseDefects('P0 1 · P1 3 (lane B)'), { p0: 1, p1: 3 });
  assert.deepEqual(parseDefects('2C/6H'), { p0: 2, p1: 6 });
  assert.equal(parseDefects('—'), null);
  assert.equal(parseDefects(''), null);
});

test('logRecords adds Defects, Missed by harness and Friction, empties every way of saying none, and dates rows by line', () => {
  const text = table(LOG_HEAD, [
    logRow('EP-1', 'Full', 60, 10, 'a gate passed having run nothing', 'stale env file'),
    logRow('EP-2', 'Small', 30, 5, 'none (owner, Gate 2)', '—'),
    logRow('EP-3', 'Full', 90, 20, '— (none named at Gate 2)', 'none'),
  ]);
  const recs = logRecords(text, datesFor('20T10:00:00', '21T10:00:00'));
  assert.deepEqual(recs.map((r) => [r.id, r.tier, r.work, r.cost, r.missed, r.friction, r.landed]), [
    ['EP-1', 'full', 60, 10, 'a gate passed having run nothing', 'stale env file', at('20T10:00:00')],
    ['EP-2', 'small', 30, 5, '', '', at('21T10:00:00')],
    ['EP-3', 'full', 90, 20, '', '', null],
  ]);
  assert.deepEqual(recs[0].defects, { p0: 0, p1: 1 });
});

test('followUpsSummary counts rows by status, the open ones naming a P3, and the oldest open row\'s and open P3\'s age', () => {
  const text = table(['#', 'Area', 'Why it waits', 'Filed by', 'Status'], [
    ['1', 'a.ts:3', 'P3 naming', 'EP-1', 'open'],
    ['2', 'b.ts', 'later', 'EP-1', 'scheduled EP-4'],
    ['3', 'c.ts', 'done', 'EP-2', 'fixed `abc1234`'],
    ['4', 'd.ts', 'no', 'EP-2', 'dropped — not ours'],
    ['5', 'e.ts', 'wait', 'EP-3', 'Open'],
    ['6', 'f.ts', '?', 'EP-3', 'parked'],
  ]);
  const dates = new Map([[3, NOW - 20 * DAY], [7, NOW - 30 * DAY]]);
  assert.deepEqual(followUpsSummary(text, dates, NOW), { open: 2, scheduled: 1, fixed: 1, dropped: 1, other: 1, openP3: 1, oldestOpenDays: 30, oldestOpenP3Days: 20 });
  assert.equal(followUpsSummary('no table', new Map(), NOW).oldestOpenDays, null);
  assert.equal(followUpsSummary('no table', new Map(), NOW).oldestOpenP3Days, null);
});

test('stateSummary counts the decision log by Class and By, open questions apart, and the P3s still to do', () => {
  const text = [
    'Unit: EP-9',
    '',
    '## Decisions',
    table(['ID', 'Date', 'Class (P / C / T)', 'Decision', 'By (owner / default / agent)'], [
      ['DEC-1', 'd', 'P', 'x', 'owner'],
      ['DEC-2', 'd', 'T', 'x', 'agent'],
      ['DEC-3', 'd', 'C — cost', 'x', 'default'],
      ['Q-1', 'd', 'C', 'open?', 'owner'],
      ['DEC-4', 'd', '?', 'x', 'someone'],
    ]),
    '',
    '## Findings',
    table(['ID', 'Sev', 'Source', 'Also', 'Status', 'Note'], [
      ['F-1', 'P3', 'codex-review', '', 'follow-up', 'a'],
      ['F-2', 'P3', 'codex-review', '', 'fixed abc1234', 'b'],
      ['F-3', 'low', 'opus-code-reviewer', '', 'open', 'c'],
      ['F-4', 'P2', 'codex-review', '', 'open', 'd'],
    ]),
  ].join('\n');
  assert.deepEqual(stateSummary(text), {
    unit: 'EP-9',
    classes: { P: 1, C: 1, T: 1, other: 1, unclassified: 0 },
    by: { owner: 1, default: 1, agent: 1, other: 1 },
    questions: 1,
    p3: 2,
  });
  // A decision log from before the classes is counted as unclassified, never guessed at.
  const old = stateSummary(`Unit: EP-8\n\n## Decisions\n${table(['Id', 'Decision'], [['HD-1', 'a'], ['HD-2', 'b']])}\n`);
  assert.deepEqual(old.classes, { P: 0, C: 0, T: 0, other: 0, unclassified: 2 });
});

test('markerUnits reads the unit of each unit-step command in a raw transcript, never a placeholder or an id cut short', () => {
  const tool = (command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  const text = [
    tool('node scripts/unit-step.mjs EP-27.04 8 start && node scripts/review-gate.mjs --kind unit'),
    tool('node scripts/unit-step.mjs harness/x 0 start'), // unit-step refuses a slash; never read as `harness`
    tool('node scripts/unit-step.mjs U-2\nnode other.mjs'),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'run `node scripts/unit-step.mjs <unit> <step> start`' }] } }),
  ].join('\n');
  assert.deepEqual([...markerUnits(text)].sort(), ['EP-27.04', 'U-2']);
});

test('stepOfDescription: the tag of this unit wins, another unit\'s tag is not ours, else the step words, by whole id', () => {
  assert.equal(stepOfDescription('[EP-7 s8b r2] codex review', 'EP-7'), '8b');
  assert.equal(stepOfDescription('[EP-8 s8 r1] review', 'EP-7'), null);
  assert.equal(stepOfDescription('EP-27.04 8b record writer', 'EP-27.04'), '8b');
  assert.equal(stepOfDescription('EP-27.04 8c claims audit r2', 'EP-27.04'), '8c');
  assert.equal(stepOfDescription('EP-27.04 lane A conformance r1', 'EP-27.04'), '4');
  assert.equal(stepOfDescription('EP-27.04 fix round 1', 'EP-27.04'), '8');
  assert.equal(stepOfDescription('EP-27.04 slice 2 mock', 'EP-27.04'), '2');
  assert.equal(stepOfDescription('EP-27.04 live walk r1', 'EP-27.04'), '5');
  assert.equal(stepOfDescription('EP-27.04 something else', 'EP-27.04'), 'other');
  assert.equal(stepOfDescription('EP-27.04 8b record writer', 'EP-27.0'), null);
  assert.equal(stepOfDescription('EP-27.04. record', 'EP-27.04'), '8b');
  assert.equal(stepOfDescription('general search', 'EP-27.04'), null);
});

test('unitSteps without markers: subagent dollars by dispatch description, shares of the unit; null when none names it', () => {
  const t = at('20T10:00:00');
  const rows = [
    row({ ts: t, kind: 'sub', agentId: 'a1', desc: 'EP-7 8b record writer', cost: 6 }),
    row({ ts: t + 1, kind: 'sub', agentId: 'a1', desc: 'EP-7 8b record writer', cost: 2 }),
    row({ ts: t, kind: 'sub', agentId: 'a2', desc: 'EP-7 code-reviewer r1', cost: 8 }),
    row({ ts: t, kind: 'sub', agentId: 'a3', desc: 'EP-7 r2 code review', cost: 4 }),
    row({ ts: t, kind: 'sub', agentId: 'a4', desc: 'EP-8 8b record', cost: 50 }),
    row({ ts: t, kind: 'main', cost: 99 }),
  ];
  assert.deepEqual(agentCosts(rows).map((a) => [a.agentId, a.usd]), [['a1', 8], ['a2', 8], ['a3', 4], ['a4', 50]]);
  const s = unitSteps('EP-7', { rows });
  assert.equal(s.source, 'descriptions');
  assert.equal(s.total, 20);
  assert.deepEqual(s.steps.map((x) => [x.step, x.usd, x.agents, x.share, x.wallMs]), [['8', 12, 2, 60, null], ['8b', 8, 1, 40, null]]);
  assert.equal(unitSteps('EP-9', { rows }), null);
});

test('unitSteps with markers: main turns by interval, a tagged subagent by its tag, rounds summed per step', () => {
  const t = at('20T10:00:00');
  const markers = [marker(t, '2', 'start'), marker(t + 10 * 60_000, '8', 'start'), marker(t + 20 * 60_000, '8', 'start', 2), marker(t + 30 * 60_000, '8', 'done', 2)];
  const rows = [
    row({ ts: t + 60_000, cost: 1 }),
    row({ ts: t + 11 * 60_000, cost: 2 }),
    row({ ts: t + 21 * 60_000, cost: 3 }),
    row({ ts: t + 25 * 60_000, kind: 'sub', agentId: 'b1', desc: '[U-1 s2 r1] late slice', cost: 4 }),
  ];
  const s = unitSteps('U-1', { markers, rows });
  assert.equal(s.source, 'markers');
  assert.equal(s.total, 10);
  assert.deepEqual(s.steps.map((x) => [x.step, x.usd, x.wallMs / 60_000, x.share]), [['2', 5, 10, 50], ['8', 5, 20, 50]]);
});

test('rowsForUnit keeps the sessions that wrote the unit\'s markers, inside its span, to `until` while a step is open', () => {
  const t = at('20T10:00:00');
  const markers = [marker(t, '2', 'start'), marker(t + 10 * 60_000, '8', 'start')];
  const rows = [row({ ts: t + 60_000, session: 'a' }), row({ ts: t + 60_000, session: 'b' }), row({ ts: t - 60_000, session: 'a' }), row({ ts: t + 50 * 60_000, session: 'a' })];
  const until = new Date(t + 60 * 60_000).toISOString();
  const kept = rowsForUnit(rows, new Map([['a', new Set(['U-1'])], ['b', new Set(['U-2'])]]), 'U-1', markers, until);
  assert.deepEqual(kept.map((r) => [r.session, (r.ts - t) / 60_000]), [['a', 1], ['a', 50]]);
  // No session is known to have written them: every session counts. A closed unit ends at its last marker.
  const closed = [...markers, marker(t + 20 * 60_000, '8', 'done')];
  assert.deepEqual(rowsForUnit(rows, new Map(), 'U-1', closed, until).map((r) => r.session), ['a', 'b']);
});

test('claimRows: a dispatch to the unit it names, an overlapping turn to the unit whose step started last, a gap to both', () => {
  const t = at('20T10:00:00');
  const m = (unit, mins, step, event) => ({ ...marker(t + mins * 60_000, step, event), unit });
  const a = [m('A', 0, '8', 'start'), m('A', 10, 'g2', 'start'), m('A', 40, '9', 'start'), m('A', 50, '9', 'done')];
  const b = [m('B', 20, '1', 'start'), m('B', 30, '1', 'done'), m('B', 45, '2', 'start'), m('B', 55, '2', 'done')];
  const turn = (mins, cost) => row({ ts: t + mins * 60_000, cost });
  const sub = (mins, agentId, desc) => row({ ts: t + mins * 60_000, kind: 'sub', agentId, desc });
  const rows = [turn(5, 1), turn(25, 2), turn(35, 4), turn(42, 8), turn(47, 16), sub(25, 'x', '[A s8 r1] late review'), sub(26, 'y', 'B grounding'), sub(27, 'z', 'search')];
  const agents = agentCosts(rows);
  const owners = dispatchOwners(agents, new Set(['A', 'B', 'EP-7']));
  assert.deepEqual([...owners], [['x', 'A'], ['y', 'B']]);
  const spans = new Map(
    [['A', a], ['B', b]].map(([u, markers]) => [u, { rows: rowsForUnit(rows, new Map(), u, markers, new Date(t + 60 * 60_000).toISOString()), intervals: stepIntervals(markers).intervals }]),
  );
  const got = claimRows(spans, owners);
  const minutesOf = (list) => list.map((r) => `${r.agentId ?? 'main'}@${(r.ts - t) / 60_000}`);
  // 25 and z (27): B's step 1 started after A's g2. 35: inside A's g2 only, B's span has a gap there, so it stays A's.
  // 42: A's step 9 started after B's step 1 closed; 47: B's step 2 started after A's step 9.
  assert.deepEqual(minutesOf(got.get('A')), ['main@5', 'main@35', 'main@42', 'x@25']);
  assert.deepEqual(minutesOf(got.get('B')), ['main@25', 'main@47', 'y@26', 'z@27']);
  // One unit alone keeps every row its span holds.
  assert.equal(claimRows(new Map([['A', spans.get('A')]]), owners).get('A').length, spans.get('A').rows.length - 1);
});

test('logKpis: units landed in the window, medians per unit, P0/P1 sums and rows with Missed by harness', () => {
  const text = table(LOG_HEAD, [
    logRow('EP-1', 'Full', 60, 10, 'caught x', '—', '1/2'),
    logRow('EP-1', 'Full', 30, 5, '—', '—', '0/1'),
    logRow('EP-2', 'Full', 90, 30, '—', '—', '0/0'),
    logRow('EP-3', 'Full', 10, 1, '—', '—', '0/9'),
  ]);
  const recs = logRecords(text, datesFor('20T10:00:00', '21T10:00:00', '22T10:00:00', '01T10:00:00'));
  assert.deepEqual(logKpis(recs, '2026-10-19T00:00:00Z', '2026-10-26T00:00:00Z'), { units: 2, work: 90, ownerWait: 15, cost: 22.5, p0: 1, p1: 3, missed: 1 });
  assert.deepEqual(logKpis(recs, '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'), { units: 0, work: null, ownerWait: null, cost: null, p0: 0, p1: 0, missed: 0 });
});

test('transcriptKpis: spend, sessions, questions, compactions and the expiry-rewrite share of main-thread dollars', () => {
  const t = at('20T10:00:00');
  const rows = [
    row({ ts: t, session: 'a', cost: 2, input: 10, cacheRead: 990 }),
    row({ ts: t + 2 * 3_600_000, session: 'a', cost: 6, input: 0, cacheRead: 0, cacheWrite: 1000, writeCost: 4 }),
    row({ ts: t, session: 'b', cost: 2, input: 0, cacheRead: 1000 }),
    row({ ts: t, kind: 'sub', agentId: 'x', session: 'b', cost: 5 }),
    row({ ts: t - 30 * DAY, session: 'c', cost: 100 }),
  ];
  const events = [
    { ts: t, type: 'ask', id: 'q1' },
    { ts: t + 1, type: 'result', id: 'q1' },
    { ts: t, type: 'compact', trigger: 'auto', preTokens: 300_000, durationMs: 60_000 },
    { ts: t, type: 'compact', trigger: 'manual', preTokens: 100_000, durationMs: 30_000 },
  ];
  const k = transcriptKpis(rows, events, { since: '2026-10-19T00:00:00Z', until: '2026-10-26T00:00:00Z' });
  assert.deepEqual(k, {
    claudeUsd: 15,
    mainUsd: 10,
    subUsd: 5,
    sessions: 2,
    subagents: 1,
    questions: 1,
    compactions: 2,
    autoCompactions: 1,
    compactPreTokens: 200_000,
    cacheHit: 66.3,
    rewrites: 1,
    rewriteUsd: 4,
    rewriteShare: 40,
  });
});

test('previousKpis: each transcript KPI\'s median over the newest four earlier weeks; this week and later never count', () => {
  const p = (week, cacheHit) => ({ week, until: 'x', kpis: { transcripts: { cacheHit, rewrites: 1 } } });
  const list = [p('2026-W38', 10), p('2026-W40', 50), p('2026-W41', 60), p('2026-W42', 70), p('2026-W43', 80), p('2026-W44', 0), p('2026-W45', 0)];
  assert.deepEqual(previousKpis(list, '2026-W44'), { weeks: 4, cacheHit: 65, rewrites: 1 });
  assert.equal(previousKpis([p('2026-W44', 1)], '2026-W44'), null);
  assert.equal(previousKpis([{ week: '2026-W40', until: 'x', kpis: { log: {} } }], '2026-W44'), null);
});

test('unitOutliers flags a window unit at OUTLIER_X times its tier\'s median, only in a cohort of MIN_COHORT', () => {
  assert.equal(OUTLIER_X, 2);
  assert.equal(MIN_COHORT, 3);
  const text = table(LOG_HEAD, [
    logRow('EP-1', 'Full', 60, 10),
    logRow('EP-2', 'Full', 60, 10),
    logRow('EP-3', 'Full', 60, 40),
    logRow('EP-4', 'Full', 200, 10),
    logRow('EP-5', 'Small', 900, 900),
    logRow('EP-6', 'Small', 10, 1),
  ]);
  const recs = logRecords(text, datesFor('10T10:00:00', '11T10:00:00', '22T10:00:00', '23T10:00:00', '22T10:00:00', '22T10:00:00'));
  const win = windowFor({ since: '2026-10-19T00:00:00Z', until: '2026-10-26T00:00:00Z', now: NOW });
  assert.deepEqual(unitOutliers(recs, win).map((o) => [o.unit, o.metric, o.x, o.n]), [['EP-3', 'cost', 4, 4], ['EP-4', 'work', 3.3, 4]]);
  // A log with no tier column is one cohort, and says so.
  const flat = logRecords(table(['Unit', 'Elapsed'], [['A', '10m'], ['B', '10m'], ['C', '40m']]), datesFor('22T10:00:00', '22T10:00:00', '22T10:00:00'));
  const [o] = unitOutliers(flat, win);
  assert.deepEqual([o.unit, o.tier, o.x], ['C', null, 4]);
  const d = { missed: [], stepOutliers: [], unitOutliers: [o], friction: [], kpis: { transcripts: null }, queue: { followUps: null } };
  assert.match(candidates(d)[0].text, /^C's work 40m is 4× the median \(n=3\)$/);
});

test('stepOutliers compares a step\'s share with the same kind of step data only, and never flags a step under MIN_SHARE', () => {
  assert.equal(MIN_SHARE, 5);
  const u = (unit, source, steps) => ({ unit, source, total: 100, steps: Object.entries(steps).map(([step, usd]) => ({ step, usd })) });
  const all = [
    u('A', 'descriptions', { 8: 50, '8b': 10, '8a': 1 }),
    u('B', 'descriptions', { 8: 50, '8b': 10, '8a': 1 }),
    u('C', 'descriptions', { 8: 50, '8b': 30, '8a': 4 }),
    u('D', 'markers', { '8b': 1 }),
    u('E', 'markers', { '8b': 1 }),
  ];
  const out = stepOutliers(all, new Set(['C', 'D']));
  assert.deepEqual(out.map((o) => [o.unit, o.step, o.share, o.median, o.x]), [['C', '8b', 30, 10, 3]]);
  assert.deepEqual(stepShares(all, 'descriptions').map((x) => [x.step, x.median, x.n]), [['8', 50, 3], ['8b', 10, 3], ['8a', 1, 3]]);
});

test('frictionThemes: two-word phrases in the Friction of two or more units, one of them in the window', () => {
  const text = table(LOG_HEAD, [
    logRow('EP-1', 'Full', 1, 1, '—', 'the state file grew past its budget; a stale env file'),
    logRow('EP-2', 'Full', 1, 1, '—', 'The state file over budget again'),
    logRow('EP-3', 'Full', 1, 1, '—', 'stale env file and a wrong port'),
    logRow('EP-4', 'Full', 1, 1, '—', 'wrong port and the stale env'),
    logRow('EP-5', 'Full', 1, 1, '—', 'wrong port'),
  ]);
  const recs = logRecords(text, datesFor('20T10:00:00', '21T10:00:00', '01T10:00:00', '01T10:00:00', '02T10:00:00'));
  const win = windowFor({ since: '2026-10-19T00:00:00Z', until: '2026-10-26T00:00:00Z', now: NOW });
  // "wrong port" recurs only before the window; "the state" recurs too, but `the` is a stop word.
  assert.deepEqual(frictionThemes(recs, win), [
    { word: 'stale env', units: ['EP-1', 'EP-3', 'EP-4'] },
    { word: 'env file', units: ['EP-1', 'EP-3'] },
    { word: 'state file', units: ['EP-1', 'EP-2'] },
  ]);
});

test('candidates take one of each source in turn, capped at MAX_CANDIDATES', () => {
  assert.equal(MAX_CANDIDATES, 5);
  const d = {
    missed: [{ unit: 'EP-1', missed: 'm1' }, { unit: 'EP-2', missed: 'm2' }, { unit: 'EP-3', missed: 'm3' }],
    stepOutliers: [{ step: '8b', unit: 'EP-1', share: 30, x: 3, median: 10, n: 3, source: 'markers' }],
    unitOutliers: [],
    friction: [{ word: 'stale env', units: ['EP-1', 'EP-3'] }, { word: 'wrong port', units: ['EP-2', 'EP-4'] }],
    kpis: { transcripts: { rewriteShare: 11.3, rewriteUsd: 32.27, rewrites: 25 } },
    queue: { followUps: { oldestOpenDays: 30, open: 4, openP3: 2 } },
  };
  assert.deepEqual(candidates(d).map((c) => [c.kind, c.text.slice(0, 22)]), [
    ['rule', 'EP-1: the owner caught'],
    ['threshold', 'cache-expiry rewrites '],
    ['machinery', 'step 8b took 30% of EP'],
    ['machinery', '"stale env" recurs in '],
    ['machinery', 'the oldest open follow'],
  ]);
  assert.equal(candidates({ ...d, kpis: { transcripts: { rewriteShare: 1 } }, queue: { followUps: null }, missed: [], stepOutliers: [], friction: [] }).length, 0);
});

function fixtureData() {
  const text = table(LOG_HEAD, [
    logRow('EP-1', 'Full', 60, 10, 'a gate passed having run nothing', 'the stale env file'),
    logRow('EP-2', 'Full', 120, 20, '—', 'stale env file again'),
    logRow('EP-3', 'Full', 60, 10),
  ]);
  const t = at('22T10:00:00');
  const g = {
    log: { text, dates: datesFor('22T10:00:00', '23T10:00:00', '10T10:00:00') },
    followUps: { text: table(['#', 'Status'], [['1', 'open']]), dates: new Map([[3, NOW - 15 * DAY]]) },
    states: [{ text: 'Unit: EP-1\n\n## Decisions\n| ID | Class | By |\n|---|---|---|\n| DEC-1 | T | agent |\n', changed: t }],
    steps: new Map([['EP-2', [marker(t, '2', 'start'), marker(t + 30 * 60_000, '8b', 'start'), marker(t + 40 * 60_000, '8b', 'done')]]]),
    rows: [row({ ts: t + 60_000, cost: 3 }), row({ ts: t + 31 * 60_000, cost: 1 }), row({ ts: t, kind: 'sub', agentId: 'z', desc: 'EP-1 8b record writer', cost: 7 })],
    events: [{ ts: t, type: 'ask', id: 'q' }],
    sessionUnits: new Map([['s1', new Set(['EP-2'])]]),
    sessions: 1,
    ledger: [],
    previous: [{ week: '2026-W43', since: 'x', until: '2026-10-19T12:00:00.000Z', kpis: { transcripts: { claudeUsd: 5, cacheHit: 90, rewriteShare: 1, sessions: 1, questions: 0, compactions: 0, compactPreTokens: 0 } } }],
  };
  return buildRetro(g, { project: 'demo', now: NOW });
}

test('buildRetro and formatDigest: every section in order, the numbers from the inputs, a data block that reads back', () => {
  const d = fixtureData();
  assert.equal(d.since, '2026-10-19T12:00:00.000Z'); // from the W43 digest
  assert.deepEqual(d.sources, { logRows: 3, undated: 0, stepsFiles: 1, stateFiles: 1, sessions: 1, codexSessions: 0, ledgerRows: 0, claudeRunRows: null });
  assert.deepEqual(d.steps.map((u) => [u.unit, u.source, u.total]), [['EP-1', 'descriptions', 7], ['EP-2', 'markers', 4]]);
  const text = formatDigest(d);
  const headings = text.split('\n').filter((l) => l.startsWith('#'));
  assert.deepEqual(headings, ['# Retro 2026-W44 — demo', '## KPIs', '## Outliers', '## Where the money went, by step', '## Friction', '## Missed by harness', '## Queue', '## Candidates for the retro review']);
  assert.match(text, /^\| Units landed \| 2 \| 0\.3\/wk \|$/m);
  assert.match(text, /^\| Claude spend \(main · subagents\) \| \$11\.00 \(\$4\.00 · \$7\.00\) \| \$5\.00 \|$/m);
  assert.match(text, /^- EP-2 \(markers\): \$4\.00 — 2 \$3\.00 \(75%\) · 8b \$1\.00 \(25%\)$/m);
  assert.match(text, /^- "stale env" — EP-1, EP-2$/m);
  assert.match(text, /^- EP-1: a gate passed having run nothing$/m);
  assert.match(text, /^- Follow-ups: 1 open \(0 naming a P3; oldest 15 d\)/m);
  assert.match(text, /^- Decisions in 1 state files changed this window: P 0 · C 0 · T 1 \(owner 0 · default 0 · agent 1\)/m);
  assert.match(text, /^1\. \[rule\] EP-1: the owner caught what the harness missed — a gate passed having run nothing — log › Missed by harness$/m);
  const back = previousData(text);
  assert.deepEqual([back.week, back.until, back.kpis.log.units], ['2026-W44', '2026-10-26T12:00:00.000Z', 2]);
});

test("buildRetro: a dispatch tagged for a unit counts whole, its turns after the unit's last marker and in another session too", () => {
  const t = at('22T10:00:00');
  const sub = (mins, session) => row({ ts: t + mins * 60_000, kind: 'sub', agentId: 'x', desc: '[EP-2 s8b r1] record writer', session, cost: 5 });
  const g = {
    log: { text: table(LOG_HEAD, [logRow('EP-2', 'Full', 120, 20)]), dates: datesFor('22T10:00:00') },
    followUps: null,
    states: [],
    steps: new Map([['EP-2', [marker(t, '2', 'start'), marker(t + 30 * 60_000, '8b', 'start'), marker(t + 40 * 60_000, '8b', 'done')]]]),
    rows: [row({ ts: t + 60_000, cost: 3 }), sub(35, 's1'), sub(50, 's1'), sub(55, 's2')],
    events: [],
    sessionUnits: new Map([['s1', new Set(['EP-2'])]]),
    sessions: 2,
    ledger: [],
    previous: [],
  };
  const ep2 = buildRetro(g, { project: 'demo', now: NOW }).steps.find((u) => u.unit === 'EP-2');
  assert.deepEqual([ep2.total, ep2.steps.find((s) => s.step === '8b').usd], [18, 15]);
});

/** A Codex rollout line, and a token_count with the thread's running total and a weekly quota reading. */
const cxLine = (ts, type, payload) => JSON.stringify({ timestamp: new Date(ts).toISOString(), type, payload });
const cxTokens = (ts, total, used, cached = 0) =>
  cxLine(ts, 'event_msg', {
    type: 'token_count',
    info: { total_token_usage: { input_tokens: total, cached_input_tokens: cached, output_tokens: 0, total_tokens: total } },
    rate_limits: { primary: { used_percent: used, window_minutes: 10080, resets_at: 1_800_000_000 } },
  });

test('buildRetro on a Codex host: its threads and claude-run\'s ledger become KPIs, digest rows and a baseline', () => {
  const t = at('22T10:00:00');
  const min = (m) => t + m * 60_000;
  const thread = parseCodexSession([
    cxLine(min(0), 'session_meta', { id: 'th-1', session_id: 'th-1', cwd: '/r', originator: 'Codex Desktop', source: 'vscode' }),
    cxLine(min(0), 'event_msg', { type: 'task_started' }),
    cxTokens(min(1), 4000, 10, 2000),
    cxLine(min(2), 'response_item', { type: 'function_call', name: 'request_user_input', call_id: 'c1', arguments: '{}' }),
    cxTokens(min(3), 10_000, 14, 5000),
    cxLine(min(4), 'event_msg', { type: 'task_complete' }),
  ]);
  const g = {
    log: { text: table(LOG_HEAD, [logRow('EP-1', 'Full', 60, 10)]), dates: datesFor('22T10:00:00') },
    followUps: null,
    states: [],
    steps: new Map(),
    rows: [],
    events: [],
    sessionUnits: new Map(),
    sessions: 0,
    ledger: null,
    codex: [thread],
    claudeRuns: [
      { at: new Date(min(2)).toISOString(), kind: 'review', outcome: 'ok', costUsd: 1.5, ms: 1000 },
      { at: new Date(min(3)).toISOString(), kind: 'adversarial', outcome: 'reserved' },
    ],
    previous: [
      {
        week: '2026-W43',
        since: 'x',
        until: '2026-10-19T12:00:00.000Z',
        kpis: { codexHost: { sessions: 3, subagents: 0, turns: 9, questions: 2, compactions: 1, compactPreTokens: 0, tokens: 2_000_000, cacheHit: 50, percent: 20 } },
      },
    ],
  };
  const d = buildRetro(g, { project: 'demo', now: NOW });
  assert.deepEqual(d.kpis.codexHost, { sessions: 1, subagents: 0, turns: 1, questions: 1, compactions: 0, compactPreTokens: 0, tokens: 10_000, cacheHit: 50, percent: 4 });
  assert.deepEqual(d.kpis.claudeRuns, { runs: 1, notRun: 1, usd: 1.5, unpriced: 0 });
  assert.deepEqual([d.sources.codexSessions, d.sources.claudeRunRows], [1, 2]);
  const text = formatDigest(d);
  assert.match(text, /^Read: 1 log rows · 0 steps files · 0 state files · 0 sessions · 1 Codex threads · no Codex ledger · 2 claude-run ledger rows$/m);
  assert.match(text, /^\| Transcripts \| none found for this repository \| — \|$/m);
  assert.match(text, /^\| Claude runs \(claude-run\) · spend \| 1 · \$1\.50 \| — \|$/m);
  assert.match(text, /^\| Codex host: sessions · turns · questions asked \| 1 · 1 · 1 \| 3 · 9 · 2 \|$/m);
  assert.match(text, /^\| Codex host: tokens \(input cached\) · weekly quota used \| 10K \(50%\) · 4% \| 2M \(50%\) · 20% \|$/m);
  assert.match(text, /^\| Codex host: compactions · median tokens before \| 0 · 0 \| 1 · 0 \|$/m);
  assert.deepEqual(previousData(text).kpis.codexHost, d.kpis.codexHost);
  // Without either, the digest has none of their rows.
  assert.doesNotMatch(formatDigest(fixtureData()), /Codex host|claude-run/);
});

test('fitDigest keeps a worst-case digest within MAX_BYTES, every section and the data block kept', () => {
  const d = fixtureData();
  const long = (i) => `${'a long cell that quotes the log at length '.repeat(10)}${i}`;
  const ids = Array.from({ length: 40 }, (_, i) => `EP-${String(i).padStart(2, '0')}.01`);
  d.frictionCells = ids.slice(0, 12).map((unit, i) => ({ unit, friction: long(i) }));
  d.missed = ids.slice(0, 12).map((unit, i) => ({ unit, missed: long(i) }));
  d.friction = ['state file', 'stale env', 'fix round', 'false claims', 'wrong port', 'env file'].map((word) => ({ word, units: ids }));
  d.stepOutliers = ids.slice(0, 12).map((unit) => ({ step: '8b', unit, source: 'descriptions', usd: 12.65, share: 32.9, median: 13.9, x: 2.4, n: 14 }));
  d.unitOutliers = ids.slice(0, 12).map((unit) => ({ unit, tier: 'full', metric: 'work', value: 461, median: 128, x: 3.6, n: 14 }));
  d.steps = ids.slice(0, 12).map((unit) => ({ unit, source: 'descriptions', total: 57.83, steps: ['8', '2', '8c', '8b'].map((step) => ({ step, usd: 10, share: 25 })) }));
  d.candidates = candidates(d);
  const size = (text) => new TextEncoder().encode(text).length;
  assert.ok(size(formatDigest(d)) > MAX_BYTES, `the unfitted digest is ${size(formatDigest(d))} bytes`);
  const fitted = fitDigest(d);
  assert.ok(size(fitted) <= MAX_BYTES, `${size(fitted)} bytes`);
  for (const h of ['## KPIs', '## Outliers', '## Where the money went, by step', '## Friction', '## Missed by harness', '## Queue', '## Candidates for the retro review']) {
    assert.ok(fitted.includes(`\n${h}\n`), h);
  }
  assert.match(fitted, /^- EP-00\.01: a long cell/m, 'it shrinks the lists, never empties them first');
  assert.equal(previousData(fitted).week, d.week);
});

// ---- the wrapper, in a temp repo with dated commits and a temp projects dir

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k === 'CODEX_HOME') delete env[k];
  return { ...env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', HOME: tmpDir('retro-home-'), ...extra };
}

function fixture() {
  const repo = tmpDir('retro-repo-');
  const git = (args, date = '2026-10-22T10:00:00Z') => {
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
  git(['init', '-q', '-b', 'main']);
  const head = table(LOG_HEAD, [logRow('EP-1', 'Full', 60, 10, 'caught it', 'stale env file')]);
  write(LOG, `# Log\n\n${head}\n`);
  write(FOLLOW_UPS, `${table(['#', 'Status'], [['1', 'open']])}\n`);
  write(`${PLANS_DIR}/EP-2.state.md`, 'Unit: EP-2\n');
  write(`${PLANS_DIR}/EP-2.steps.jsonl`, `${stepLine({ t: '2026-10-23T10:00:00Z', unit: 'EP-2', step: '2', event: 'start', round: 1 })}\n${stepLine({ t: '2026-10-23T10:30:00Z', unit: 'EP-2', step: '2', event: 'done', round: 1 })}\n`);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'one']);
  fs.appendFileSync(path.join(repo, LOG), `${`| ${logRow('EP-2', 'Full', 90, 20).join(' | ')} |`}\n`);
  git(['commit', '-q', '-a', '-m', 'two'], '2026-10-23T11:00:00Z');
  const projects = tmpDir('retro-projects-');
  const dir = path.join(projects, repo.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const turn = (ts, id, command) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: ts,
      cwd: repo,
      requestId: `r${id}`,
      message: { id: `m${id}`, model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: command ? [{ type: 'tool_use', id: `t${id}`, name: 'Bash', input: { command } }] : [] },
    });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), `${[turn('2026-10-23T10:05:00Z', 1, 'node scripts/unit-step.mjs EP-2 2 start'), turn('2026-10-23T10:10:00Z', 2)].join('\n')}\n`);
  // A session of another repository whose directory name starts the same way is not this one's.
  const other = path.join(projects, `${repo.replace(/[^A-Za-z0-9]/g, '-')}-sibling`);
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 's2.jsonl'), `${JSON.stringify({ type: 'user', cwd: `${repo}-sibling`, timestamp: '2026-10-23T10:00:00Z' })}\n${turn('2026-10-23T10:06:00Z', 3).replace(repo, `${repo}-sibling`)}\n`);
  return { repo, projects, git };
}

const WINDOW = ['--since', '2026-10-19T00:00:00Z', '--until', '2026-10-26T00:00:00Z'];
function run(f, args, cwd = f.repo, extra = {}) {
  return spawnSync(process.execPath, [RUNNER, ...args], { cwd, env: cleanEnv(extra), encoding: 'utf8' });
}

test('the wrapper: --dry-run prints the digest from the dated log, steps, follow-ups and this repo\'s sessions, writing nothing', () => {
  const f = fixture();
  const res = run(f, [...WINDOW, '--projects-dir', f.projects, '--dry-run']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^# Retro 2026-W44 — retro-repo-/m);
  assert.match(res.stdout, /^Read: 2 log rows · 1 steps files · 1 state files · 1 sessions · no Codex ledger$/m);
  assert.match(res.stdout, /^\| Units landed \| 2 \|/m);
  // $0.004 input + $0.02 output per turn at Opus prices: the sibling directory's session is left out.
  assert.match(res.stdout, /^\| Claude spend \(main · subagents\) \| \$0\.05 \(\$0\.05 · \$0\.00\) \|/m);
  assert.match(res.stdout, /^- EP-2 \(markers\): \$0\.05 — 2 \$0\.05 \(100%\)$/m);
  assert.match(res.stdout, /^- EP-1: caught it$/m);
  assert.equal(fs.existsSync(path.join(f.repo, REPORTS_DIR)), false);
  assert.equal(f.git(['status', '--porcelain']), '');
});

test('the wrapper writes only the digest by default, only one JSON file with --export, and prints JSON with --json', () => {
  const f = fixture();
  const res = run(f, [...WINDOW, '--projects-dir', f.projects]);
  assert.equal(res.status, 0, res.stderr);
  const digest = path.join(f.repo, REPORTS_DIR, 'retro-2026-W44.md');
  assert.equal(res.stdout.trim(), digest);
  assert.equal(f.git(['status', '--porcelain', '-uall']).trim(), `?? ${REPORTS_DIR}/retro-2026-W44.md`);
  assert.ok(previousData(fs.readFileSync(digest, 'utf8')));
  const out = tmpDir('retro-export-');
  const exp = run(f, [...WINDOW, '--projects-dir', f.projects, '--export', out]);
  assert.equal(exp.status, 0, exp.stderr);
  assert.deepEqual(fs.readdirSync(out), ['retro-2026-W44.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'retro-2026-W44.json'), 'utf8')).kpis.log.units, 2);
  const json = run(f, [...WINDOW, '--projects-dir', f.projects, '--json']);
  assert.equal(JSON.parse(json.stdout).project, path.basename(f.repo));
});

test('the wrapper exits 2 with a usage line on a bad flag, outside a repository and without a log', () => {
  const f = fixture();
  const bad = run(f, ['--nope']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /^retro: unknown option --nope\nusage: /);
  const outside = run(f, ['--dry-run'], tmpDir('retro-outside-'));
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /not inside a git repository/);
  fs.rmSync(path.join(f.repo, LOG));
  const noLog = run(f, ['--dry-run']);
  assert.equal(noLog.status, 2);
  assert.match(noLog.stderr, /no harness log at /);
});

test('the wrapper reads this repository\'s Codex host threads and claude-run ledger, never a sibling\'s thread or an exec run', () => {
  const f = fixture();
  const codexHome = tmpDir('retro-codex-');
  const day = path.join(codexHome, 'sessions', '2026', '10', '23');
  fs.mkdirSync(day, { recursive: true });
  const t = Date.parse('2026-10-23T10:00:00Z');
  const rollout = (name, meta, [lo, hi]) =>
    fs.writeFileSync(
      path.join(day, name),
      `${[
        cxLine(t, 'session_meta', { originator: 'Codex Desktop', source: 'vscode', ...meta }),
        cxLine(t, 'event_msg', { type: 'task_started' }),
        cxTokens(t + 60_000, 1000, lo),
        cxTokens(t + 120_000, 3000, hi),
      ].join('\n')}\n`,
    );
  rollout('rollout-2026-10-23T17-00-00-th-1.jsonl', { id: 'th-1', session_id: 'th-1', cwd: f.repo }, [10, 12]);
  rollout('rollout-2026-10-23T17-00-01-th-2.jsonl', { id: 'th-2', session_id: 'th-2', cwd: `${f.repo}-sibling` }, [20, 30]);
  rollout('rollout-2026-10-23T17-00-02-ex-1.jsonl', { id: 'ex-1', session_id: 'ex-1', cwd: f.repo, originator: 'codex_exec', source: 'exec' }, [40, 50]);
  fs.mkdirSync(path.join(f.repo, '.claude-runs'));
  fs.writeFileSync(path.join(f.repo, '.claude-runs', 'ledger.jsonl'), `${JSON.stringify({ at: '2026-10-23T10:03:00Z', kind: 'review', cwd: f.repo, outcome: 'ok', costUsd: 2, ms: 1000 })}\n`);
  const res = run(f, [...WINDOW, '--projects-dir', f.projects, '--json'], f.repo, { CODEX_HOME: codexHome });
  assert.equal(res.status, 0, res.stderr);
  const d = JSON.parse(res.stdout);
  assert.deepEqual([d.sources.codexSessions, d.kpis.codexHost.sessions, d.kpis.codexHost.tokens, d.kpis.codexHost.percent], [1, 1, 3000, 2]);
  assert.deepEqual([d.sources.claudeRunRows, d.kpis.claudeRuns.runs, d.kpis.claudeRuns.usd], [1, 1, 2]);
});
