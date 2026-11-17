// harness-bootstrap deploy-list tests (generated YYYY-MM-DD). Run: node --test scripts/lib/deploy-list-core.test.mjs
// [M] mechanism (ships as-is): every test but the [B] one. [B] binding: the block below -- a ledger kind the core's
// AUDIT_KIND takes for a post-merge audit; keep it matching the core. The trailer keys and the review kinds are read
// from the core (NEVER_AUTO_KEY, UNIT_KEY, REVIEW_KINDS), never restated.
// Pure: no repository, no ledger; scripts/deploy-list.mjs reads those and is tried against a temp repository by the
// harness-bootstrap skill's own suite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIT_KIND,
  NEVER_AUTO_KEY,
  REVIEW_KINDS,
  UNIT_KEY,
  auditRow,
  countsOf,
  criticalPaths,
  formatEntry,
  formatList,
  isRoot,
  landingOf,
  landsOf,
  listEntries,
  neverAutoOf,
  parseArgs,
  parseLog,
  parseLogChecked,
  parseTrailers,
  reviewLine,
  reviewRows,
  reviewTrees,
  shellWord,
  strayNeverAuto,
  unitOf,
  unparsedWarning,
  warningsOf,
} from './deploy-list-core.mjs';

// ---- [B] project bindings
// A ledger kind the core's AUDIT_KIND takes for a post-merge audit, and one it does not. A project that rebinds the
// core rebinds these in the same edit; the [B] test names a mismatch.
const AUDIT_EXAMPLE = 'post-merge-audit';
const NOT_AUDIT = REVIEW_KINDS[0];
// ---- end [B]

const DOT = String.fromCodePoint(0xb7);
const hex = (c, n = 40) => c.repeat(n);
const SHA = { a: hex('a'), b: hex('b'), c: hex('c'), d: hex('d') };
const TREE = { a: hex('1'), b: hex('2'), c: hex('3'), d: hex('4'), unit: hex('5'), parent: hex('6') };
const msg = (subject, ...paragraphs) => [subject, ...paragraphs].join('\n\n');
const KEY = (k) => k.replace(/(^|-)([a-z])/g, (_, d, c) => d + c.toUpperCase());
const trailer = (cats) => `${KEY(NEVER_AUTO_KEY)}: ${cats}`;
const unitLine = (id) => `${KEY(UNIT_KEY)}: ${id}`;

test('parseTrailers reads every paragraph after the subject whose lines are all Key: value, and none when the message is one paragraph', () => {
  assert.deepEqual(parseTrailers(msg('Merge x', 'Body text.', 'Unit: U-1\nNever-auto: money')), [
    { key: 'Unit', value: 'U-1' },
    { key: 'Never-auto', value: 'money' },
  ]);
  assert.deepEqual(parseTrailers('Never-auto: money'), [], 'one paragraph is a subject, not a trailer block');
  assert.deepEqual(parseTrailers(msg('Merge x', 'Body only.')), []);
  assert.deepEqual(parseTrailers(''), []);
  assert.deepEqual(parseTrailers(msg('Merge x', 'Unit: U-1\r\nNever-auto: money\r\n')), [
    { key: 'Unit', value: 'U-1' },
    { key: 'Never-auto', value: 'money' },
  ]);
  assert.deepEqual(parseTrailers(`Merge x\n\n\n\nUnit: U-1\n\n`), [{ key: 'Unit', value: 'U-1' }], 'extra blank lines');
  assert.deepEqual(parseTrailers(msg('Merge x', 'Unit: U-1\n  and more\nNever-auto: money')), [
    { key: 'Unit', value: 'U-1 and more' },
    { key: 'Never-auto', value: 'money' },
  ], 'an indented line continues the value');
});

test('parseTrailers: a trailer block followed by Co-Authored-By and Claude-Session paragraphs keeps all of them', () => {
  const both = msg('feat: pay', 'Body text.', 'Unit: U-1\nNever-auto: money', 'Co-Authored-By: A <a@b.c>\nClaude-Session: https://x/y');
  assert.deepEqual(parseTrailers(both), [
    { key: 'Unit', value: 'U-1' },
    { key: 'Never-auto', value: 'money' },
    { key: 'Co-Authored-By', value: 'A <a@b.c>' },
    { key: 'Claude-Session', value: 'https://x/y' },
  ]);
  assert.deepEqual(neverAutoOf(both), ['money']);
  assert.equal(unitOf(both), 'U-1');
  assert.deepEqual(neverAutoOf(msg('feat: pay', 'Unit: U-1\nNever-auto: money', 'Closing prose, not a trailer.')), ['money'], 'prose after the block does not hide it');
  assert.deepEqual(neverAutoOf(msg('feat: pay', 'Never-auto: money', 'Unit: U-1')), ['money'], 'a block of its own, not the last');
  assert.deepEqual(parseTrailers(msg('feat: pay', 'Some prose.\nUnit: U-1', 'Co-Authored-By: A <a@b.c>')), [{ key: 'Co-Authored-By', value: 'A <a@b.c>' }], 'a paragraph with a prose line is no block, whatever it holds');
});

test('a Never-auto: line that is not in an all-trailer paragraph is no trailer', () => {
  assert.deepEqual(neverAutoOf(msg('Merge x', 'Notes\nNever-auto: money')), [], 'a paragraph that is not all Key: value lines');
  assert.deepEqual(neverAutoOf(msg('Merge x', 'Unit: U-1\nsee also: elsewhere\nwhat is this line')), []);
  assert.deepEqual(neverAutoOf(msg('Merge x')), []);
  assert.deepEqual(neverAutoOf('Never-auto: money'), []);
});

test('strayNeverAuto: a Never-auto: line in no trailer block; warningsOf names each such commit', () => {
  assert.equal(strayNeverAuto(msg('Merge x', 'Notes\nNever-auto: money')), true);
  assert.equal(strayNeverAuto(msg('Merge x', 'Never-auto: money')), false, 'a block of its own is a trailer');
  assert.equal(strayNeverAuto(msg('Merge x', 'Unit: U-1\nNever-auto: money', 'Notes\nnever-auto: data-format')), true, 'one in the block, one outside');
  assert.equal(strayNeverAuto(msg('Merge x', 'Unit: U-1\nNever-auto: money')), false);
  assert.equal(strayNeverAuto('Never-auto: money'), true, 'one paragraph is a subject, never a trailer block');
  assert.equal(strayNeverAuto(msg('Merge x', 'Prose that says Never-auto: money mid-line.')), false, 'only a line that starts with the key');
  assert.equal(strayNeverAuto(''), false);
  const stray = { sha: SHA.c, tree: TREE.c, parents: [SHA.a], message: msg('docs', 'Notes\nNever-auto: money') };
  const inBranch = { sha: SHA.d, tree: TREE.d, parents: [SHA.a], message: msg('feat', 'x\nNever-auto: money') };
  const merge = { sha: SHA.b, tree: TREE.b, parents: [SHA.a, SHA.d], message: msg('Merge', 'ok') };
  assert.deepEqual(warningsOf([stray, merge], { [SHA.b]: { branch: [inBranch] } }), [
    `WARN ${SHA.c.slice(0, 12)} has a Never-auto: line outside a trailer block`,
    `WARN ${SHA.d.slice(0, 12)} has a Never-auto: line outside a trailer block`,
  ]);
  assert.deepEqual(warningsOf([PLAIN, LAND], {}), []);
});

test('a trailer key may take spaces before the colon (`Never-auto : money` is a trailer to git, and the Unit line beside it stays one)', () => {
  const spaced = msg('Merge x', 'Unit : U-1\nNever-auto : money');
  assert.deepEqual(parseTrailers(spaced), [
    { key: 'Unit', value: 'U-1' },
    { key: 'Never-auto', value: 'money' },
  ]);
  assert.deepEqual(neverAutoOf(spaced), ['money']);
  assert.equal(unitOf(spaced), 'U-1');
  assert.equal(strayNeverAuto(spaced), false);
  assert.deepEqual(neverAutoOf(msg('Merge x', 'Unit: U-1\nNever-auto\t:\tmoney')), ['money']);
});

test('a squash message indents the original trailers by 4 spaces: an all-indented trailer paragraph is read as that land\'s trailers; an indented line in prose is still stray', () => {
  const squash = msg(
    'Squashed commit of the following:',
    'commit ' + SHA.c + '\nAuthor: A <a@b.c>\nDate:   Mon Nov 16 10:00:00 2026',
    '    land U-7',
    '    Landing: PASS U-7',
    '    Unit: U-7\n    Never-auto: money, migrations',
  );
  assert.deepEqual(neverAutoOf(squash), ['money', 'migrations']);
  assert.equal(unitOf(squash), 'U-7');
  assert.equal(strayNeverAuto(squash), false, 'read, so nothing to warn of');
  assert.deepEqual(neverAutoOf(msg('Merge x', '    Never-auto: money')), ['money'], 'any all-indented trailer paragraph');
  assert.deepEqual(neverAutoOf(msg('Merge x', '    Unit: U-1\n      continued\n    Never-auto: money')), ['money']);
  const prose = msg('Merge x', 'Some prose first.\n    Never-auto: money');
  assert.deepEqual(neverAutoOf(prose), [], 'prose around the line: no trailer');
  assert.equal(strayNeverAuto(prose), true, 'an indented line in prose is the typo the WARN is for');
  assert.equal(strayNeverAuto(msg('Merge x', 'Notes\nNever_auto: money')), true, 'an underscore is no key, and the line is seen');
  assert.equal(strayNeverAuto(msg('Merge x', 'Notes\nNever auto : money')), true);
  assert.equal(strayNeverAuto(msg('Merge x', 'Notes\nNEVER-AUTO :money')), true);
  assert.equal(strayNeverAuto(msg('Merge x', 'Notes\nNever-automatic: money')), false, 'a longer word is another key');
});

test('strayNeverAuto: a markdown prefix (a bullet, bold, a quote, backticks) or markup before the colon is still the line, and is no trailer', () => {
  for (const line of ['- Never-auto: money', '* Never-auto: money', '**Never-auto:** money', '**Never-auto**: money', '> Never-auto: money', '> - **Never-auto:** money', '`Never-auto`: money', '_Never-auto_: money', '  - Never-auto: money']) {
    const m = msg('Merge x', `Notes\n${line}`);
    assert.equal(strayNeverAuto(m), true, line);
    assert.deepEqual(neverAutoOf(m), [], line);
    assert.deepEqual(warningsOf([{ sha: SHA.c, tree: TREE.c, parents: [SHA.a], message: m }], {}).slice(0, 1), [`WARN ${SHA.c.slice(0, 12)} has a Never-auto: line outside a trailer block`], line);
  }
  assert.equal(strayNeverAuto(msg('Merge x', 'Unit: U-1\nNever-auto: money')), false, 'a real trailer is no stray');
  assert.equal(strayNeverAuto(msg('Merge x', '- Never-automatic: money')), false, 'a longer word is another key');
  assert.equal(strayNeverAuto(msg('Merge x', 'We say Never-auto: money mid-line.')), false);
});

test('warningsOf: a Never-auto trailer whose value names no category and is not none (`(money)`) is a WARN; none, empty, n/a and a dash are not', () => {
  const at = (value) => ({ sha: SHA.c, tree: TREE.c, parents: [SHA.a, SHA.d], message: msg('Merge x', `Unit: U-1\nNever-auto: ${value}`) });
  const warn = `WARN ${SHA.c.slice(0, 12)} has a Never-auto: value that names no category`;
  assert.deepEqual(warningsOf([at('(money)')], {}), [warn]);
  assert.deepEqual(warningsOf([at('( )')], {}), [warn]);
  for (const v of ['none', '', 'n/a', '-', 'none (docs only)', 'money', 'money (refunds)']) assert.deepEqual(warningsOf([at(v)], {}), [], v);
  const inBranch = { sha: SHA.d, tree: TREE.d, parents: [SHA.a], message: msg('feat', 'Unit: U-1\nNever-auto: (money)') };
  const merge = { sha: SHA.b, tree: TREE.b, parents: [SHA.a, SHA.d], message: 'Merge x' };
  assert.deepEqual(warningsOf([merge], { [SHA.b]: { branch: [inBranch] } }), [`WARN ${SHA.d.slice(0, 12)} has a Never-auto: value that names no category`], 'a merge\'s branch commits are read too');
});

test('neverAutoOf: several categories, several trailers, any case, each once; none for `none` or empty', () => {
  assert.deepEqual(neverAutoOf(msg('Merge x', trailer('Money, migration'))), ['money', 'migration']);
  assert.deepEqual(neverAutoOf(msg('Merge x', `${trailer('money')}\n${trailer('data-format, Money')}`)), ['money', 'data-format']);
  assert.deepEqual(neverAutoOf(msg('Merge x', `${unitLine('U-1')}\n${trailer('none')}`)), []);
  assert.deepEqual(neverAutoOf(msg('Merge x', `${unitLine('U-1')}\n${trailer('')}`)), []);
  assert.deepEqual(neverAutoOf(msg('Merge x', `${unitLine('U-1')}\n${trailer('-')}`)), []);
});

test('unitOf: the Unit trailer, else the subject; landingOf: the last Landing line anywhere, else null', () => {
  assert.equal(unitOf(msg('Merge branch x', unitLine('EP-9.01'))), 'EP-9.01');
  assert.equal(unitOf(msg('Merge branch x', 'Body.')), 'Merge branch x');
  assert.equal(unitOf(msg('Merge   branch\tx', `${unitLine('')}\nNever-auto: money`)), 'Merge branch x', 'an empty Unit trailer is no unit');
  assert.equal(unitOf(''), '?');
  assert.equal(landingOf(msg('Merge x', 'Landing: PASS 3f2a - 1 critical read', unitLine('U-1'))), 'PASS 3f2a - 1 critical read');
  assert.equal(landingOf(msg('Merge x', 'Landing: RE-REVIEW\nLanding:   PASS later  ')), 'PASS later');
  assert.equal(landingOf(msg('Merge x', 'No such line.')), null);
  assert.equal(landingOf('Merge x\n\nLanding:'), null);
});

test('parseLog reads %H %T %P %B records; a root commit has no parents, a bad record is skipped', () => {
  const text = [
    `${SHA.a}\0${TREE.a}\0\0first\n\nbody\n\x1e`,
    `\n${SHA.b}\0${TREE.b}\0${SHA.a} ${SHA.c}\0Merge x\n\nUnit: U-1\nNever-auto: money\n\n\x1e`,
    'garbage\0nope\0\0text\x1e',
    '\n',
  ].join('');
  const commits = parseLog(text);
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0], { sha: SHA.a, tree: TREE.a, parents: [], message: 'first\n\nbody' });
  assert.deepEqual(commits[1].parents, [SHA.a, SHA.c]);
  assert.equal(commits[1].message, 'Merge x\n\nUnit: U-1\nNever-auto: money');
  assert.deepEqual(parseLog(''), []);
  assert.deepEqual(parseLog(undefined), []);
});

const row = (over) => ({ at: '2026-11-01T10:00:00.000Z', kind: REVIEW_KINDS[0], model: 'gpt-x', family: 'codex', outcome: 'ok', tree: TREE.unit, ...over });

test('parseLogChecked counts the records that did not parse (a signature line git printed ahead of a record), and parseLog drops them as before', () => {
  const good = `${SHA.a}\0${TREE.a}\0\0first\n\n\x1e`;
  const signed = `gpg: Signature made Mon\ngpg: Good signature\n${SHA.b}\0${TREE.b}\0${SHA.a}\0second\n\x1e`;
  const out = parseLogChecked(`${good}\n${signed}\n`);
  assert.deepEqual(out.commits.map((c) => c.sha), [SHA.a]);
  assert.equal(out.unparsed, 1);
  assert.deepEqual(parseLog(`${good}\n${signed}\n`).map((c) => c.sha), [SHA.a]);
  assert.deepEqual(parseLogChecked(good), { commits: parseLog(good), unparsed: 0 });
  assert.deepEqual(parseLogChecked(''), { commits: [], unparsed: 0 });
  assert.deepEqual(parseLogChecked(undefined), { commits: [], unparsed: 0 });
  assert.deepEqual(parseLogChecked('\n\x1e\n  \x1e'), { commits: [], unparsed: 0 }, 'blank records are no records');
  assert.equal(unparsedWarning(3), 'WARN 3 log records did not parse');
  assert.equal(unparsedWarning(1), 'WARN 1 log records did not parse');
  assert.equal(unparsedWarning(0), null);
});

test('warningsOf: a land on a commit that is not a merge warns that its critical paths cover that commit only; a merge, or a plain commit with no land, does not', () => {
  const ff = { sha: SHA.c, tree: TREE.c, parents: [SHA.a], message: msg('feat: pay', `${unitLine('U-2')}\n${trailer('money')}`) };
  const root = { sha: SHA.d, tree: TREE.d, parents: [], message: msg('feat: first', `${unitLine('U-3')}\n${trailer('migrations')}`) };
  const none = { sha: SHA.a, tree: TREE.a, parents: [SHA.b], message: msg('feat: x', `${unitLine('U-4')}\n${trailer('none')}`) };
  assert.deepEqual(warningsOf([ff, root, none, LAND, PLAIN], {}), [
    `WARN ${SHA.c.slice(0, 12)} land is not a merge: its critical paths cover that commit only`,
    `WARN ${SHA.d.slice(0, 12)} land is not a merge: its critical paths cover that commit only`,
  ]);
});

test('reviewTrees: a merge reads its own tree and the unit branch; any other commit its own and its parent', () => {
  const merge = { sha: SHA.b, tree: TREE.b, parents: [SHA.a, SHA.c], message: '' };
  assert.deepEqual([...reviewTrees(merge, { branchTrees: [TREE.unit, TREE.d], parentTree: TREE.parent })].sort(), [TREE.b, TREE.d, TREE.unit].sort());
  const plain = { sha: SHA.b, tree: TREE.b, parents: [SHA.a], message: '' };
  assert.deepEqual([...reviewTrees(plain, { branchTrees: [TREE.unit], parentTree: TREE.parent })].sort(), [TREE.b, TREE.parent].sort());
  assert.deepEqual([...reviewTrees({ ...plain, parents: [] }, { parentTree: null })], [TREE.b], 'a root commit has no parent tree');
  assert.deepEqual([...reviewTrees(merge)], [TREE.b]);
});

test('reviewRows: review kinds whose tree is one of the trees, oldest first; other kinds and unreadable trees are not reviews', () => {
  const trees = new Set([TREE.unit, TREE.b]);
  const rows = [
    row({ at: '2026-11-02T00:00:00Z', tree: TREE.b }),
    row({ at: '2026-11-01T00:00:00Z' }),
    row({ tree: TREE.c }),
    row({ kind: 'investigate' }),
    row({ kind: AUDIT_EXAMPLE }),
    row({ tree: 'abc' }),
    row({ tree: undefined }),
    null,
  ];
  assert.deepEqual(reviewRows(rows, trees).map((r) => r.at), ['2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z']);
  for (const kind of REVIEW_KINDS) assert.equal(reviewRows([row({ kind })], trees).length, 1, kind);
});

test('auditRow: an ok audit-kind row whose tree is in the later trees, the newest; a failed one or another kind is not an audit', () => {
  const trees = new Set([TREE.c, TREE.d]);
  const a1 = row({ kind: AUDIT_EXAMPLE, tree: TREE.c, at: '2026-11-02T00:00:00Z' });
  const a2 = row({ kind: AUDIT_EXAMPLE, tree: TREE.d, at: '2026-11-03T00:00:00Z' });
  assert.equal(auditRow([a2, a1], trees), a2);
  assert.equal(auditRow([row({ kind: AUDIT_EXAMPLE, tree: TREE.c, outcome: 'failed' })], trees), null);
  assert.equal(auditRow([row({ kind: AUDIT_EXAMPLE, tree: TREE.a })], trees), null);
  assert.equal(auditRow([row({ kind: NOT_AUDIT, tree: TREE.c })], trees), null);
  assert.equal(auditRow([], trees), null);
});

test('[B] the core\'s AUDIT_KIND takes AUDIT_EXAMPLE and not a review kind', () => {
  assert.ok(AUDIT_KIND.test(AUDIT_EXAMPLE), `AUDIT_KIND does not match ${AUDIT_EXAMPLE}`);
  assert.ok(!AUDIT_KIND.test(NOT_AUDIT), `AUDIT_KIND matches ${NOT_AUDIT}`);
});

test('countsOf: the row\'s counts, else its p0 and p1, else none', () => {
  assert.deepEqual(countsOf({ counts: { P0: 0, P1: 2, P2: 5, P3: 0 } }), { P0: 0, P1: 2 });
  assert.deepEqual(countsOf({ p0: 1, p1: 0 }), { P0: 1, P1: 0 });
  assert.equal(countsOf({ p0: 1 }), null);
  assert.equal(countsOf({ counts: { P0: 'x', P1: 1 } }), null);
  assert.equal(countsOf({}), null);
  assert.equal(countsOf(null), null);
});

test('reviewLine: kind, model/family, counts or ?, outcome', () => {
  assert.equal(reviewLine(row({ counts: { P0: 0, P1: 1 } })), `  review ${REVIEW_KINDS[0]} gpt-x/codex P0=0 P1=1 ${DOT} ok`);
  assert.equal(reviewLine(row({ model: undefined, family: 'claude', outcome: 'failed' })), `  review ${REVIEW_KINDS[0]} ?/claude P0=? P1=? ${DOT} failed`);
});

const LAND = {
  sha: SHA.b,
  tree: TREE.b,
  parents: [SHA.a, SHA.c],
  message: msg('Merge branch u1', 'Landing: PASS 3f2a', `${unitLine('U-1')}\n${trailer('money, migration')}`),
};
const PLAIN = { sha: SHA.a, tree: TREE.a, parents: [], message: msg('Merge branch u0', unitLine('U-0')) };
const LATER = { sha: SHA.d, tree: TREE.d, parents: [SHA.b], message: 'docs: after' };

test('listEntries: one entry per land commit with a category, each with its own reviews, audit and files', () => {
  const rows = [
    row({ tree: TREE.unit, counts: { P0: 0, P1: 0 } }),
    row({ tree: TREE.a }),
    row({ kind: AUDIT_EXAMPLE, tree: TREE.d, at: '2026-11-05T00:00:00Z' }),
  ];
  const extra = { [SHA.b]: { branch: [{ sha: SHA.c, tree: TREE.unit, parents: [SHA.a], message: 'feat: pay' }], parentTree: null, files: ['src/pay.js', 'db/m1.sql'] } };
  const entries = listEntries([PLAIN, LAND, LATER], extra, rows);
  assert.equal(entries.length, 1);
  const [e] = entries;
  assert.equal(e.commit, LAND);
  assert.equal(e.unit, 'U-1');
  assert.deepEqual(e.categories, ['money', 'migration']);
  assert.equal(e.landing, 'PASS 3f2a');
  assert.deepEqual(e.reviews.map((r) => r.tree), [TREE.unit], 'the row on the plain commit\'s tree belongs to no listed land');
  assert.equal(e.audit.row.kind, AUDIT_EXAMPLE);
  assert.equal(e.audit.sha, SHA.d, 'the sha of the later commit whose tree the audit read');
  assert.deepEqual(e.files, ['src/pay.js', 'db/m1.sql']);
  assert.deepEqual(listEntries([PLAIN, LATER], {}, rows), [], 'no category: no entry');
  assert.deepEqual(listEntries([], {}, rows), []);
});

test('an audit only counts for lands it came after: a row on an earlier commit\'s tree does not read a later land', () => {
  const rows = [row({ kind: AUDIT_EXAMPLE, tree: TREE.a })];
  const [e] = listEntries([PLAIN, LAND], { [SHA.b]: { branch: [] } }, rows);
  assert.equal(e.audit, null);
});

test('an audit whose tree is the land commit\'s own tree reads that land: the sha is the land\'s, not a later one', () => {
  const rows = [row({ kind: AUDIT_EXAMPLE, tree: LAND.tree })];
  const [e] = listEntries([PLAIN, LAND], { [SHA.b]: { branch: [] } }, rows);
  assert.equal(e.audit.sha, SHA.b);
  const [again] = listEntries([PLAIN, LAND, LATER], { [SHA.b]: { branch: [] } }, [row({ kind: AUDIT_EXAMPLE, tree: LAND.tree }), row({ kind: AUDIT_EXAMPLE, tree: TREE.d, at: '2026-11-09T00:00:00Z' })]);
  assert.equal(again.audit.sha, SHA.d, 'the newest audit row of the later trees wins');
});

// The runner's flow: the land commit with the trailers sits on the unit branch; the merge message has none.
const BRANCH_OLD = { sha: SHA.c, tree: TREE.c, parents: [SHA.a], message: msg('feat: pay', `${unitLine('U-1')}\n${trailer('money')}`) };
const BRANCH_LAND = { sha: SHA.d, tree: TREE.d, parents: [SHA.c], message: msg('land: U-1', 'Landing: PASS 9e1', `${unitLine('U-1')}\n${trailer('Money, migration')}`, 'Co-Authored-By: A <a@b.c>') };
const BRANCH_PLAIN = { sha: hex('e'), tree: hex('7'), parents: [SHA.a], message: 'feat: wire it' };
const MERGE_PLAIN = { sha: SHA.b, tree: TREE.b, parents: [SHA.a, SHA.d], message: "Merge branch 'u1'" };
const MERGE_TITLED = { ...MERGE_PLAIN, message: 'Merge u1: Add refunds' };

test('landsOf: a merge reads its branch commits, newest first, one land per unit, the categories of every commit of the unit once each', () => {
  const lands = landsOf(MERGE_PLAIN, [BRANCH_LAND, BRANCH_PLAIN, BRANCH_OLD]);
  assert.equal(lands.length, 1, 'the two commits of U-1 are one land');
  assert.equal(lands[0].unit, 'U-1');
  assert.deepEqual(lands[0].categories, ['money', 'migration']);
  assert.equal(lands[0].carrier, BRANCH_LAND);
  assert.deepEqual(landsOf(MERGE_TITLED, [BRANCH_PLAIN, BRANCH_OLD]).map((l) => [l.unit, l.categories.join()]), [['U-1', 'money']]);
  assert.deepEqual(landsOf(MERGE_PLAIN, [BRANCH_PLAIN]), [], 'no trailer anywhere');
  assert.deepEqual(landsOf(MERGE_PLAIN, []), []);
});

test('landsOf: a trailer on the merge itself counts, first; a merge of two units lists both; a plain commit reads only itself', () => {
  const onMerge = { ...MERGE_PLAIN, message: msg("Merge branch 'u1'", `${unitLine('U-9')}\n${trailer('dependency')}`) };
  assert.deepEqual(landsOf(onMerge, [BRANCH_LAND]).map((l) => [l.unit, l.categories.join()]), [['U-9', 'dependency'], ['U-1', 'money,migration']]);
  assert.deepEqual(landsOf(onMerge, [BRANCH_LAND])[0].carrier, onMerge);
  const sameUnit = { ...MERGE_PLAIN, message: msg("Merge branch 'u1'", `${unitLine('U-1')}\n${trailer('data-format')}`) };
  assert.deepEqual(landsOf(sameUnit, [BRANCH_LAND]).map((l) => l.categories.join()), ['data-format,money,migration'], 'the merge first, then its branch: a category the newest commit drops is not lost');
  const plain = { sha: SHA.a, tree: TREE.a, parents: [SHA.c], message: msg('chore: dep', `${unitLine('U-3')}\n${trailer('dependency')}`) };
  assert.deepEqual(landsOf(plain, [BRANCH_LAND]).map((l) => l.unit), ['U-3'], 'a plain commit has no branch');
  const noUnit = { sha: SHA.d, tree: TREE.d, parents: [SHA.a], message: msg('feat: pay', trailer('money')) };
  assert.deepEqual(landsOf(MERGE_PLAIN, [noUnit]).map((l) => l.unit), ['feat: pay'], 'no Unit trailer: the subject');
  assert.deepEqual(landsOf({ ...MERGE_PLAIN, message: msg('Merge', unitLine('U-5')) }, [noUnit]).map((l) => l.unit), ['U-5'], 'no Unit trailer on the commit: the merge\'s');
});

test('landsOf: one unit across carriers is one land with the union of its categories, in order and once each, and the first Landing line any of them has', () => {
  const merge = { ...MERGE_PLAIN, message: "Merge branch 'u1'" };
  const newest = { ...BRANCH_LAND, message: msg('land: U-1 again', `${unitLine('U-1')}\n${trailer('migrations, dependency')}`) };
  const none = { sha: hex('9'), tree: hex('8'), parents: [SHA.a], message: msg('land: U-1 final', `Landing: PASS final\n${unitLine('U-1')}\n${trailer('none')}`) };
  const lands = landsOf(merge, [none, newest, BRANCH_LAND, BRANCH_OLD]);
  assert.equal(lands.length, 1);
  assert.deepEqual(lands[0].categories, ['migrations', 'dependency', 'money', 'migration'], 'newest first, a repeat once');
  assert.equal(lands[0].carrier, newest, 'the carrier is the first that names a category');
  assert.equal(lands[0].landing, 'PASS final', 'the first Landing line, a none commit\'s too');
  const noLanding = landsOf(merge, [newest, BRANCH_OLD]);
  assert.equal(noLanding[0].landing, null);
  assert.equal(landsOf(merge, [BRANCH_LAND, BRANCH_OLD])[0].landing, 'PASS 9e1');
  const entries = listEntries([merge], { [merge.sha]: { branch: [none, newest, BRANCH_LAND, BRANCH_OLD] } }, []);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].categories, ['migrations', 'dependency', 'money', 'migration']);
  assert.equal(entries[0].landing, 'PASS final');
  assert.equal(listEntries([{ ...merge, message: msg('Merge', 'Landing: PASS merge') }], { [merge.sha]: { branch: [newest] } }, [])[0].landing, 'PASS merge', 'the merge\'s own Landing is the last resort');
});

test('listEntries: the runner flow lists the merge, with the branch commit\'s categories and landing, and the branch trees for its reviews', () => {
  const rows = [row({ tree: BRANCH_OLD.tree }), row({ tree: TREE.a, family: 'claude', model: 'opus' })];
  const extra = { [SHA.b]: { branch: [BRANCH_LAND, BRANCH_PLAIN, BRANCH_OLD], files: ['src/pay.js'] } };
  const entries = listEntries([PLAIN, MERGE_PLAIN], extra, rows);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].commit, MERGE_PLAIN, 'the entry is the merge on the first-parent line');
  assert.equal(entries[0].unit, 'U-1');
  assert.deepEqual(entries[0].categories, ['money', 'migration']);
  assert.equal(entries[0].landing, 'PASS 9e1', 'the Landing line of the branch commit');
  assert.deepEqual(entries[0].reviews.map((r) => r.tree), [BRANCH_OLD.tree], 'a row on the base tree is no review of the branch');
  assert.deepEqual(entries[0].files, ['src/pay.js']);
});

test('formatEntry: the four lines, `not recorded` and `none recorded` where there is nothing', () => {
  const bare = { commit: LAND, unit: 'U-1', categories: ['money'], landing: null, reviews: [], audit: null, files: [] };
  assert.deepEqual(formatEntry(bare), [
    `NEVER-AUTO ${SHA.b.slice(0, 12)} U-1 ${DOT} money`,
    '  landing: not recorded',
    '  review: none recorded',
    '  audit: none recorded',
  ]);
  const full = {
    ...bare,
    categories: ['money', 'migration'],
    landing: 'PASS 3f2a',
    reviews: [row({ counts: { P0: 0, P1: 1 } }), row({ family: 'claude', model: 'opus' })],
    audit: { row: row({ kind: AUDIT_EXAMPLE }), sha: SHA.d },
  };
  assert.deepEqual(formatEntry(full), [
    `NEVER-AUTO ${SHA.b.slice(0, 12)} U-1 ${DOT} money, migration`,
    '  landing: PASS 3f2a',
    `  review ${REVIEW_KINDS[0]} gpt-x/codex P0=0 P1=1 ${DOT} ok`,
    `  review ${REVIEW_KINDS[0]} opus/claude P0=? P1=? ${DOT} ok`,
    `  audit: ${AUDIT_EXAMPLE} ${SHA.d.slice(0, 12)}`,
  ]);
});

test('formatList: the blocks, the count line, and the critical paths of every land (unique, sorted, quoted when needed)', () => {
  const e1 = { commit: LAND, unit: 'U-1', categories: ['money'], landing: null, reviews: [], audit: null, files: ['src/pay.js', 'src/a b.js'] };
  const e2 = { ...e1, commit: { ...LAND, sha: SHA.d }, unit: 'U-2', files: ['src/pay.js', 'db/m1.sql', "it's.js"] };
  const out = formatList([e1, e2], { live: SHA.a, sha: SHA.d, root: hex('e') });
  const lines = out.split('\n');
  assert.equal(lines.at(-1), '');
  assert.equal(lines.at(-3), `DEPLOY LIST 2 never-auto lands in ${SHA.a.slice(0, 12)}..${SHA.d.slice(0, 12)}`);
  assert.equal(
    lines.at(-2),
    `CRITICAL PATHS 4 files: run one adversarial pass over git diff ${SHA.a.slice(0, 12)}..${SHA.d.slice(0, 12)} -- db/m1.sql 'it'\\''s.js' 'src/a b.js' src/pay.js`,
  );
  assert.equal(lines.filter((l) => l.startsWith('NEVER-AUTO ')).length, 2);
});

test('formatList: no live is `root` and diffs from the empty tree; an empty list has the count line only', () => {
  const e = { commit: LAND, unit: 'U-1', categories: ['money'], landing: null, reviews: [], audit: null, files: ['a.js'] };
  const from = formatList([e], { live: null, sha: SHA.b, root: hex('e') }).split('\n');
  assert.equal(from.at(-3), `DEPLOY LIST 1 never-auto lands in root..${SHA.b.slice(0, 12)}`);
  assert.equal(from.at(-2), `CRITICAL PATHS 1 files: run one adversarial pass over git diff ${hex('e')}..${SHA.b.slice(0, 12)} -- a.js`, 'the empty tree is printed whole: git refuses it shortened');
  assert.equal(formatList([], { live: SHA.a, sha: SHA.b, root: hex('e') }), `DEPLOY LIST 0 never-auto lands in ${SHA.a.slice(0, 12)}..${SHA.b.slice(0, 12)}\n`);
  const noFiles = formatList([{ ...e, files: [] }], { live: null, sha: SHA.b, root: hex('e') });
  assert.match(noFiles, /^CRITICAL PATHS 0 files: the lands changed no file$/m);
});

test('formatList: the WARN lines come before the count line, and an empty list with a warning still prints both', () => {
  const warn = `WARN ${SHA.c.slice(0, 12)} has a Never-auto: line outside a trailer block`;
  const e = { commit: LAND, unit: 'U-1', categories: ['money'], landing: null, reviews: [], audit: null, files: ['a.js'] };
  const lines = formatList([e], { live: SHA.a, sha: SHA.b, root: hex('e'), warnings: [warn] }).split('\n');
  assert.equal(lines[lines.indexOf(warn) + 1], `DEPLOY LIST 1 never-auto lands in ${SHA.a.slice(0, 12)}..${SHA.b.slice(0, 12)}`);
  assert.equal(formatList([], { live: SHA.a, sha: SHA.b, root: hex('e'), warnings: [warn] }), `${warn}\nDEPLOY LIST 0 never-auto lands in ${SHA.a.slice(0, 12)}..${SHA.b.slice(0, 12)}\n`);
});

test('criticalPaths, shellWord and isRoot', () => {
  assert.deepEqual(criticalPaths([{ files: ['b', 'a'] }, { files: ['a', 'c'] }]), ['a', 'b', 'c']);
  assert.equal(shellWord('src/a-b_c.test.js'), 'src/a-b_c.test.js');
  assert.equal(shellWord('a b'), "'a b'");
  assert.equal(shellWord('$(x)'), "'$(x)'");
  for (const root of [null, undefined, '', ' ', '-']) assert.equal(isRoot(root), true, String(root));
  assert.equal(isRoot('abc123'), false);
});

test('parseArgs: <live> and an optional <sha> (HEAD); no live, a third argument or an option is an error', () => {
  assert.deepEqual(parseArgs(['abc']), { live: 'abc', sha: 'HEAD' });
  assert.deepEqual(parseArgs(['-', 'def']), { live: '-', sha: 'def' });
  assert.deepEqual(parseArgs(['', 'def']), { live: '', sha: 'def' });
  assert.throws(() => parseArgs([]), /<live-sha> is required/);
  assert.throws(() => parseArgs(['a', 'b', 'c']), /unexpected argument c/);
  assert.throws(() => parseArgs(['--nope']), /unknown option --nope/);
  assert.throws(() => parseArgs(['a', '-x']), /unknown option -x/);
});
