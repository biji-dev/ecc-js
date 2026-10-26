// harness-bootstrap intake tests (generated YYYY-MM-DD). Run: node --test scripts/lib/intake-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the tests carry their own
// requests and state files, and read STRAY rather than its words.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  STRAY,
  checkRequest,
  formatCheck,
  gate1,
  parseApproval,
  parseArgs,
  parseCards,
  scopeBlock,
} from './intake-core.mjs';

const SCOPE = [
  'In scope: the CSV download of the orders list',
  'Out of scope: the date-range filter (unit 2), other lists',
  'Done when: the orders-export test passes and the demo file opens',
].join('\n');

const CARDS = [
  '```',
  'Q-1 · P · Which columns does the file carry?',
  'Recommend: A — the columns the list shows; merchants asked for what they see',
  '  A the six visible columns — pros: matches the screen · cons: no phone · reversal cost: edit + tests · data: 4 of 5 tickets',
  '  B every order field — pros: complete · cons: 31 columns · reversal cost: edit + tests · data: the schema',
  'Default if unanswered: A (park-and-carry: work that depends on it waits)',
  '',
  'Q-2 · P · What is the file called?',
  'Recommend: A — a dated name sorts in a downloads folder',
  '  A orders-<date>.csv — pros: sorts · cons: none · reversal cost: edit + tests · data: —',
  '  B orders.csv — pros: short · cons: overwrites · reversal cost: edit + tests · data: —',
  'Default if unanswered: A (park-and-carry: work that depends on it waits)',
  '',
  'Q-3 · C · May the export include customer phone numbers?',
  'Recommend: B — personal data leaving the product is a one-way door',
  '  A include them — pros: complete · cons: data leaves the product · reversal cost: files already sent · data: policy §2',
  '  B leave them out — pros: nothing leaves · cons: one column fewer · reversal cost: edit + tests · data: policy §2',
  'Default if unanswered: B (park-and-carry: work that depends on it waits)',
  '```',
].join('\n');

function request({ scope = SCOPE, cards = CARDS, extra = '', approved = '' } = {}) {
  return [
    '# CR-030 — Export the orders list as CSV',
    '',
    '> Owner, 2026-10-26: "merchants keep copying the orders list into spreadsheets by hand"',
    '',
    '## Deliverables',
    '',
    '1. Orders CSV — Demo: /orders → "Export CSV" → a file with the 12 orders shown opens in a spreadsheet',
    '2. Date filter — Demo: /orders?from=2026-10-01 → "Export CSV" → only October\'s rows',
    '',
    'Each deliverable carries a `Demo:` line.',
    '',
    '## Decisions',
    '',
    cards,
    '',
    'Never-auto: none',
    'Risk map: none — src/orders/ is cold',
    'Estimate: no history (n=0, need 3)',
    extra,
    '',
    '## Unit 1',
    '',
    scope,
    '',
    approved,
  ].join('\n');
}

function state({ unit = 'CR-030-1', tier = 'Small', scope = SCOPE } = {}) {
  return [`Unit: ${unit}`, 'Mode: change', 'Type: Code', `Tier: ${tier}`, '', '## Scope', '', scope, '', '## Ledger', ''].join('\n');
}

const sha = (text) => scopeBlock(text).hash;
const approvedLine = (over = {}) => {
  const f = { date: '2026-10-27', by: 'owner', ref: 'CR-030/DEC-1', unit: 'unit CR-030-1', tier: 'tier Small', scope: `scope ${sha(SCOPE)}`, ...over };
  return `Approved: ${[f.date, f.by, f.ref, f.unit, f.tier, f.scope].filter(Boolean).join(' · ')}`;
};

test('parseArgs takes --check or --gate1 with --state, and refuses everything else', () => {
  assert.deepEqual(parseArgs(['--check', 'r.md']), { mode: 'check', request: 'r.md', state: null, json: false });
  assert.deepEqual(parseArgs(['--gate1', 'r.md', '--state', 's.md', '--json']), { mode: 'gate1', request: 'r.md', state: 's.md', json: true });
  for (const bad of [[], ['--check'], ['--check', 'a', '--gate1', 'b'], ['--gate1', 'r.md'], ['--check', 'r.md', '--state', 's.md'], ['--check', 'r.md', '--nope']]) {
    assert.ok(parseArgs(bad).error, `accepted ${bad.join(' ')}`);
  }
});

test('a ready request: two deliverables, three cards, the estimate, both hit lines and the Scope block', () => {
  const r = checkRequest(request());
  assert.deepEqual(r.problems, []);
  assert.equal(r.deliverables.length, 2);
  assert.deepEqual(
    r.cards.map((c) => [c.id, c.cls]),
    [['Q-1', 'P'], ['Q-2', 'P'], ['Q-3', 'C']],
  );
  assert.equal(r.estimate, 'no history (n=0, need 3)');
  assert.equal(r.neverAuto, 'none');
  assert.equal(r.riskMap, 'none — src/orders/ is cold');
  assert.deepEqual(r.scope.missing, []);
  assert.match(r.scope.hash, /^[0-9a-f]{8}$/);
  assert.equal(r.approval, null);
});

test('a Demo: line counts once it carries text; a mention of the label does not', () => {
  const r = checkRequest(request());
  assert.ok(r.deliverables.every((d) => /Demo: \S/.test(d.text)));
  const none = checkRequest(request().replace(/ — Demo: [^\n]*/g, ''));
  assert.equal(none.deliverables.length, 0);
  assert.ok(none.problems.some((p) => /no deliverable has a Demo: line/.test(p)), none.problems.join('\n'));
});

test('a card needs a recommendation, two options and a default, and only P and C reach the owner', () => {
  const broken = [
    'Q-1 · P · Which columns?',
    '  A six — reversal cost: edit + tests',
    '',
    'Q-2 · T · Which timeout?',
    'Recommend: A — fine',
    '  A 30 s',
    '  B 60 s',
    'Default if unanswered: A',
  ].join('\n');
  const cards = parseCards(broken);
  assert.deepEqual(cards.map((c) => c.id), ['Q-1', 'Q-2']);
  const r = checkRequest(request({ cards: broken }));
  const text = r.problems.join('\n');
  assert.match(text, /card Q-1: no Recommend: line/);
  assert.match(text, /card Q-1: 1 option, a card offers two or three/);
  assert.match(text, /card Q-1: no Default if unanswered: line/);
  assert.match(text, /card Q-2: class T — only P and C reach the owner/);
  assert.doesNotMatch(text, /card Q-2: no Recommend/);
});

test('a card id used twice and a question left open outside a card are problems', () => {
  const twice = `${CARDS}\n\`\`\`\nQ-1 · P · Again?\nRecommend: A — x\n  A a\n  B b\nDefault if unanswered: A\n\`\`\``;
  assert.ok(checkRequest(request({ cards: twice })).problems.some((p) => /card Q-1 appears twice/.test(p)));
  const stray = checkRequest(request({ extra: 'The retention period is TBD.' }));
  assert.ok(STRAY.test('TBD'));
  assert.ok(stray.problems.some((p) => /line \d+: an open question outside a card — The retention period is TBD\./.test(p)), stray.problems.join('\n'));
});

test('missing Estimate, Never-auto and Risk map lines are each named', () => {
  const text = request().replace(/^Never-auto: .*\n/m, '').replace(/^Risk map: .*\n/m, '').replace(/^Estimate: .*\n/m, '');
  const problems = checkRequest(text).problems.join('\n');
  assert.match(problems, /no Estimate: line/);
  assert.match(problems, /no Never-auto: line/);
  assert.match(problems, /no Risk map: line/);
  const pasted = 'Estimate per unit (small, n=0 units): work no history (n=0, need 3) — a range from this project\'s log, not a promise';
  const asIs = checkRequest(request().replace(/^Estimate: .*$/m, pasted));
  assert.deepEqual(asIs.problems, [], 'estimate.mjs\'s line, pasted as-is, is the Estimate line');
  assert.equal(asIs.estimate, pasted);
});

test('the Scope block hash ignores wrapping, bullets and fences, and changes with a word', () => {
  const plain = sha(SCOPE);
  const wrapped = ['```', '- In scope: the CSV download', '  of the orders list', '- Out of scope:   the date-range filter (unit 2), other lists', '', '- Done when: the orders-export test passes and the demo file opens', '```'].join('\n');
  assert.equal(sha(wrapped), plain);
  assert.notEqual(sha(SCOPE.replace('orders list', 'order list')), plain);
  const reordered = SCOPE.split('\n').reverse().join('\n');
  assert.deepEqual(scopeBlock(reordered).missing, ['Out of scope', 'Done when'], 'a block opens at its In scope: line');
  assert.equal(scopeBlock('no block here'), null);
  const missing = scopeBlock(SCOPE.replace(/\nDone when: .*/, ''));
  assert.deepEqual(missing.missing, ['Done when']);
  assert.ok(checkRequest(request({ scope: SCOPE.replace(/\nDone when: .*/, '') })).problems.some((p) => /unit 1's Scope block lacks Done when:/.test(p)));
});

test('a second Scope block ends the first: unit 1 is the first block', () => {
  const two = `${SCOPE}\nIn scope: the date filter\nOut of scope: other lists\nDone when: the filter test passes`;
  assert.equal(sha(two), sha(SCOPE));
});

test('parseApproval reads the last Approved: line and names what it lacks', () => {
  const a = parseApproval(`${approvedLine({ by: 'default' })}\n${approvedLine()}`);
  assert.deepEqual(
    { date: a.date, by: a.by, ref: a.ref, unit: a.unit, tier: a.tier, scope: a.scope, lacks: a.lacks },
    { date: '2026-10-27', by: 'owner', ref: 'CR-030/DEC-1', unit: 'CR-030-1', tier: 'Small', scope: sha(SCOPE), lacks: [] },
  );
  assert.equal(parseApproval('no approval here'), null);
  assert.deepEqual(parseApproval(approvedLine({ unit: '', scope: '' })).lacks, ['unit', 'scope']);
  assert.ok(checkRequest(request({ approved: approvedLine({ tier: '' }) })).problems.some((p) => /Approved: line lacks tier/.test(p)));
});

test('an approved request whose Scope block was edited afterwards re-opens the sheet', () => {
  const ok = checkRequest(request({ approved: approvedLine() }));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.approval.unchanged, true);
  const edited = checkRequest(request({ scope: SCOPE.replace('other lists', 'the invoices list'), approved: approvedLine() }));
  assert.ok(edited.problems.some((p) => /unit 1's Scope block changed since the approval \(approved [0-9a-f]{8}, now [0-9a-f]{8}\): the sheet re-opens/.test(p)), edited.problems.join('\n'));
});

test('gate1 is auto only for the approved unit, at its tier, with the approved Scope block', () => {
  const req = request({ approved: approvedLine() });
  const auto = gate1(req, state(), 'docs/changes/CR-030.md');
  assert.equal(auto.auto, true);
  assert.equal(
    auto.line,
    `Gate 1: auto — docs/changes/CR-030.md approved 2026-10-27 by the owner (CR-030/DEC-1) for CR-030-1 at Small; its Scope block is unchanged (sha ${sha(SCOPE)})`,
  );
  const cases = [
    [request(), state(), /the request carries no Approved: line/],
    [request({ approved: approvedLine({ by: 'default' }) }), state(), /approved by default, not the owner/],
    [req, state({ unit: 'CR-030-2' }), /the approval covers CR-030-1, this claim is CR-030-2/],
    [req, state({ tier: 'Full' }), /the tier is Full, approved at Small: a re-tier re-asks/],
    [req, state({ scope: SCOPE.replace('other lists', 'every list') }), /the unit's Scope block differs from the approved one/],
    [request({ scope: SCOPE.replace('other lists', 'every list'), approved: approvedLine() }), state(), /the request's Scope block changed since the approval/],
    [req, 'Unit: CR-030-1\nTier: Small\n\n## Ledger\n', /the state file has no Scope block/],
  ];
  for (const [r, s, want] of cases) {
    const g = gate1(r, s, 'r.md');
    assert.equal(g.auto, false, `auto for ${want}`);
    assert.match(g.line, /^Gate 1: owner — /);
    assert.match(g.line, want);
  }
  assert.equal(gate1(req, state({ tier: 'small' }), 'r.md').auto, true, 'tier words compare without case');
});

test('formatCheck prints one line per property, then the verdict', () => {
  const ready = formatCheck(checkRequest(request()), 'docs/changes/CR-030.md');
  assert.deepEqual(ready.split('\n').filter(Boolean), [
    'intake: docs/changes/CR-030.md',
    'deliverables 2 — each named by its Demo: line',
    'cards 3 — P 2 · C 1; each with a recommendation, its options and a default',
    'estimate — no history (n=0, need 3)',
    'never-auto — none · risk map — none — src/orders/ is cold',
    `scope 1 — In scope · Out of scope · Done when · sha ${sha(SCOPE)}`,
    'approval — none yet: the owner sheet approves it',
    'intake: ready for the owner sheet',
  ]);
  const approved = formatCheck(checkRequest(request({ approved: approvedLine() })), 'r.md');
  assert.match(approved, /^approval — 2026-10-27 by owner \(CR-030\/DEC-1\) for CR-030-1 at Small; the Scope block is unchanged$/m);
  assert.match(approved, /^intake: approved$/m);
  const missing = formatCheck(checkRequest(request().replace(/^Estimate: .*\n/m, '')), 'r.md');
  assert.match(missing, /^PROBLEM no Estimate: line/m);
  assert.match(missing, /^intake: 1 problem — not ready for the owner sheet$/m);
});

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'intake.mjs');

test('the wrapper exits 0 when ready or auto, 1 on a problem or an owner Gate 1, 2 on usage, and writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-'));
  const write = (name, text) => {
    fs.writeFileSync(path.join(dir, name), text);
    return path.join(dir, name);
  };
  const run = (...args) => spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8' });
  const ready = run('--check', write('ready.md', request()));
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /^intake: ready for the owner sheet$/m);
  assert.equal(run('--check', write('thin.md', request().replace(/^Estimate: .*\n/m, ''))).status, 1);
  const approved = write('approved.md', request({ approved: approvedLine() }));
  const auto = run('--gate1', approved, '--state', write('state.md', state()));
  assert.equal(auto.status, 0, auto.stderr);
  assert.match(auto.stdout, /^Gate 1: auto — /);
  const owner = run('--gate1', approved, '--state', write('full.state.md', state({ tier: 'Full' })));
  assert.equal(owner.status, 1);
  assert.match(owner.stdout, /^Gate 1: owner — the tier is Full/);
  assert.equal(JSON.parse(run('--check', approved, '--json').stdout).approval.unchanged, true);
  assert.equal(run('--gate1', approved).status, 2);
  assert.equal(run('--check', path.join(dir, 'missing.md')).status, 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['approved.md', 'full.state.md', 'ready.md', 'state.md', 'thin.md']);
  fs.rmSync(dir, { recursive: true, force: true });
});
