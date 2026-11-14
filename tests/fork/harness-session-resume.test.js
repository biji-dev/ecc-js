/**
 * Tests for the harness-bootstrap session-resume hook template (biji-dev/ecc-js): the held and parked
 * rows of the main checkout's registry, read by header name inside their markers only; each unit's
 * state file (next, open Q rows, Tier/Parked/Grant/Stop); silence; the byte cap; the closing line per
 * source; no field or wording that starts work or hands the context to the owner; the UserPromptSubmit
 * note on what other sessions did since the last turn (mainline head, claimed, released, parked units,
 * the 300-character cap); mutation checks.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
// RESUME_UNDER_TEST points the suite at a mutant to prove each case can fail; unset, it tests the shipped file.
const HOOK = process.env.RESUME_UNDER_TEST || path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'session-resume.mjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

const cleanup = [];
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

// No inherited GIT_* variable (a git hook's GIT_DIR would redirect every fixture) or global config.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CLAUDE_PROJECT_DIR'));
Object.assign(ENV, { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' });

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

function put(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

/** A main checkout with one commit, alone in its own directory: { base, main }. */
function checkout() {
  const base = tmp('session-resume-');
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'init');
  return { base, main };
}

/** A linked worktree of `main` at <base>/<name> on a new branch. */
function worktree({ base, main }, name, branch) {
  const wt = path.join(base, name);
  git(main, 'worktree', 'add', '-q', '-b', branch, wt);
  return wt;
}

const ACTIVE_HEAD = ['| # | Unit | Step | Branch | Worktree | Resources | Claimed (UTC) |', '|---|---|---|---|---|---|---|', '| 0 | mainline — never claimed | | | main | | |'];
const PARKED_HEAD = ['| Unit | Gate | Parked (UTC) | Branch | Worktree | Cards |', '|---|---|---|---|---|---|'];

/** A registry: the held rows after row 0 in the active table, the parked rows in the parked table, `outside` above both. */
function registry({ held = [], parked = [], outside = [], activeHead = ACTIVE_HEAD, parkedHead = PARKED_HEAD } = {}) {
  return [
    '# Registry', ...outside, '',
    '<!-- harness:active -->', ...activeHead, ...held, '<!-- /harness:active -->', '',
    '<!-- harness:parked -->', ...parkedHead, ...parked, '<!-- /harness:parked -->', '',
  ].join('\n');
}

const heldRow = (n, unit, { step = '5 implement', branch = `change/${unit.toLowerCase()}`, wt = 'main' } = {}) => `| ${n} | ${unit} | ${step} | ${branch} | ${wt} | | 2026-11-06T02:00Z |`;

/** A state file in the contract's shape. */
function stateFile({ unit = 'CR-021', head = ['Tier: Full'], scope = ['Done when: the export runs.'], decisions = [], findings = [], next = [] } = {}) {
  return [
    `Unit: ${unit}`, 'Mode: change', ...head, '',
    '## Scope', ...scope, '',
    '## Findings', '| ID | Sev | Source | Also | Status | Note |', '|---|---|---|---|---|---|', ...findings, '',
    '## Decisions', '| ID | Date | Class (P / C / T) | Decision | By |', '|---|---|---|---|---|', ...decisions, '',
    '## Next', ...next, '',
  ].join('\n');
}

const OUTPUTS = [];
// The seen-state files these runs leave in the tmp dir (the hook's own); removed at the end.
const SESSIONS = ['sess-1'];
const seenPath = id => path.join(os.tmpdir(), `harness-seen-${id}.json`);

/**
 * Run a hook script (default: the shipped template) for one SessionStart in `dir`; its additionalContext,
 * or null when it prints nothing. git looks no higher than `dir`'s parent, so a temp dir inside some
 * other repository cannot leak in.
 */
function runHook(dir, opts = {}) {
  const input = opts.raw !== undefined ? opts.raw : JSON.stringify({
    hook_event_name: 'SessionStart', source: 'compact', session_id: 'sess-1', transcript_path: path.join(dir, 't.jsonl'), cwd: dir, ...opts.input,
  });
  const env = { ...ENV, GIT_CEILING_DIRECTORIES: path.dirname(dir), ...opts.env };
  const result = spawnSync(process.execPath, [opts.script || HOOK], { input, encoding: 'utf8', env });
  assert.strictEqual(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  assert.strictEqual(result.stderr, '', 'the hook writes nothing to stderr');
  if (!opts.script) OUTPUTS.push(result.stdout);
  if (result.stdout === '') return null;
  const out = JSON.parse(result.stdout);
  assert.deepStrictEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.deepStrictEqual(Object.keys(out.hookSpecificOutput), ['hookEventName', 'additionalContext']);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
  return out.hookSpecificOutput.additionalContext;
}

/** One UserPromptSubmit of session `id` run through `script` (default: the shipped template): its additionalContext, or null. */
function prompt(dir, id, script = HOOK, env = {}) {
  const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: dir, session_id: id, prompt: 'go on' });
  const result = spawnSync(process.execPath, [script], { input, encoding: 'utf8', env: { ...ENV, GIT_CEILING_DIRECTORIES: path.dirname(dir), ...env } });
  assert.strictEqual(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  assert.strictEqual(result.stderr, '', 'the hook writes nothing to stderr');
  if (result.stdout === '') return null;
  const out = JSON.parse(result.stdout);
  assert.deepStrictEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.deepStrictEqual(Object.keys(out.hookSpecificOutput), ['hookEventName', 'additionalContext']);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  return out.hookSpecificOutput.additionalContext;
}

let sessionCount = 0;
function newSession() {
  sessionCount += 1;
  const id = `since-${process.pid}-${sessionCount}`;
  SESSIONS.push(id);
  return id;
}

const source = (dir, s, opts = {}) => runHook(dir, { ...opts, input: { source: s, ...opts.input } });
const lastLine = text => text.split('\n').at(-1);
const COMPACT = "Continue the held unit's next step from its state file and the runner's process.md (Step 0a: verify, do not trust the marker); parked units wait for the owner's answers.";
// a compaction with several held rows, in the main checkout: no unit is named
const SEVERAL = "Several units are held: continue only the one this session was running, from its state file and the runner's process.md (Step 0a: verify, do not trust the marker); the others are other sessions'. A controller (coordinate-sessions) re-reads its board and runs board-check instead. Parked units wait for the owner's answers.";
// a compaction in a linked worktree a held row names: that row's unit
const ONE = (unit) => `Continue ${unit}'s next step from its state file and the runner's process.md (Step 0a: verify, do not trust the marker); units held elsewhere are other sessions', never continue one; parked units wait for the owner's answers.`;
const CONTEXT = 'Context only: start nothing until the owner asks; /task-runner resumes the held unit, then answered parked units, then the next original plan row.';
const PARKED_ONLY = "No unit is held; parked units wait for the owner's answers. If a queue run is on, start the next ready unit (the runner's Shape).";
const NO_ROWS = "No unit is held or parked. If a queue run is on, run harness-due and start the next unit in the runner's order (the runner's Shape) under the standing grant and any Stop: line.";
const FIRST = s => `[session-resume] ${s}: the harness's resume point, read from the registry and the state files (newer than any summary).`;

console.log('\nharness session-resume: the registry');

test("a held row in a linked worktree: CLAUDE_PROJECT_DIR wins over cwd, and the main checkout's registry is read", () => {
  const co = checkout();
  const wt = worktree(co, 'wt-cr-021', 'change/cr-021');
  put(co.main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021', { wt: '../wt-cr-021' })] }));
  put(wt, 'docs/plans/CR-021.state.md', stateFile({ head: ['Tier: Full', 'Grant: merge clean Full', 'Stop: after CR-021'], next: ['- next: 5 implement, slice 2'], decisions: ['| Q-1 | 2026-11-06 | P | Merge or hold? | owner |'] }));
  const elsewhere = path.join(tmp('session-resume-elsewhere-'), 'x');
  fs.mkdirSync(elsewhere);
  const text = runHook(elsewhere, { env: { CLAUDE_PROJECT_DIR: wt, GIT_CEILING_DIRECTORIES: co.base } });
  assert.strictEqual(text, [
    "[session-resume] compact: the harness's resume point, read from the registry and the state files (newer than any summary).",
    'HELD CR-021 · step 5 implement · change/cr-021 · ../wt-cr-021 · tier Full',
    '  next: next: 5 implement, slice 2',
    '  open: Q-1 Merge or hold?',
    '  kickoff narrows: merge clean Full; stop: after CR-021',
    ONE('CR-021'),
  ].join('\n'));
  // the same rows from the main checkout, through cwd alone: it may drive the unit with cd, so the closing names none
  assert.strictEqual(runHook(co.main), [...text.split('\n').slice(0, -1), COMPACT].join('\n'));
});

test('a parked row: gate, since and cards from the registry; its state file\'s Parked line when the cells are empty', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ parked: [
    '| CR-030 | Gate 2 | 2026-11-06T04:10Z | change/cr-030 | main | Q-1 merge or hold · Q-2 button copy |',
    '| CR-031 | | | change/cr-031 | main | |',
  ] }));
  put(main, 'docs/plans/CR-030.state.md', stateFile({ unit: 'CR-030', head: ['Parked: Gate 2 2026-11-06T04:10Z'], decisions: ['| Q-1 | 2026-11-06 | P | Merge or hold? | owner |'] }));
  put(main, 'docs/plans/CR-031.state.md', stateFile({ unit: 'CR-031', head: ['Parked: Gate 1 2026-11-06T05:00Z'], decisions: ['| Q-1 | 2026-11-06 | C | May the export carry phone numbers? | owner |'] }));
  const text = runHook(main);
  assert.match(text, /^PARKED CR-030 · Gate 2 since 2026-11-06T04:10Z · Q-1 merge or hold · Q-2 button copy$/m);
  assert.doesNotMatch(text, /Merge or hold\?/, "a Cards cell stands for the parked unit's open rows");
  assert.match(text, /^PARKED CR-031 · Gate 1 2026-11-06T05:00Z\n {2}open: Q-1 May the export carry phone numbers\?$/m);
  assert.strictEqual(lastLine(text), PARKED_ONLY);
});

test('held rows come before parked rows, in registry order', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(2, 'CR-022'), heldRow(1, 'CR-021')], parked: ['| CR-030 | Gate 2 | 2026-11-06T04:10Z | change/cr-030 | main | Q-1 x |'] }));
  const heads = runHook(main).split('\n').filter(l => /^(HELD|PARKED) /.test(l)).map(l => l.split(' · ')[0]);
  assert.deepStrictEqual(heads, ['HELD CR-022', 'HELD CR-021', 'PARKED CR-030']);
});

test('columns are read by header name after the first: another order, a header above the begin marker, an older Task column', () => {
  const { main } = checkout();
  const moved = ['| # | Worktree | Branch | Step | Unit |', '|---|---|---|---|---|'];
  put(main, '.claude/registry.md', registry({ activeHead: moved, held: ['| 1 | main | change/cr-021 | 4 tests | CR-021 |'] }));
  assert.match(runHook(main), /^HELD CR-021 · step 4 tests · change\/cr-021 · main$/m);
  // the markers around the data rows only: the header sits right above the begin marker
  put(main, '.claude/registry.md', ['# Registry', '| # | Unit | Step | Branch | Worktree |', '|---|---|---|---|---|', '<!-- harness:active -->', '| 1 | CR-021 | 4 tests | change/cr-021 | main |', '<!-- /harness:active -->', ''].join('\n'));
  assert.match(runHook(main), /^HELD CR-021 · step 4 tests · change\/cr-021 · main$/m);
  put(main, '.claude/registry.md', registry({ activeHead: ['| # | Task | Branch | Notes |', '|---|---|---|---|'], held: ['| 1 | P2-16 | task/p2-16 | open |'] }));
  assert.match(runHook(main), /^HELD P2-16 · task\/p2-16 · main$/m);
  // no header at all: no column is named, as the guard names none (its row locks the main checkout), so no column
  // order is invented and no state file is read, here or in the checkout a cell names; a held row shows its cells,
  // and a parked table with no header gives nothing, as harness-due gives no INBOX line
  put(path.dirname(main), 'wt/docs/plans/CR-021.state.md', stateFile({ head: ['Tier: Foreign'], next: ['a foreign next step'] }));
  put(main, 'docs/plans/CR-021.state.md', stateFile({ head: ['Tier: Full'], next: ['the main next step'] }));
  put(main, '.claude/registry.md', registry({ activeHead: [], parkedHead: [], held: ['| 1 | CR-021 | 4 tests | change/cr-021 | ../wt |'], parked: ['| CR-030 | Gate 2 | 2026-11-06T04:10Z | b | main | Q-1 x |'] }));
  const bare = runHook(main);
  assert.strictEqual(bare, [FIRST('compact'), 'HELD 1 · CR-021 · 4 tests · change/cr-021 · ../wt', '  state file not read: the registry table has no header row', COMPACT].join('\n'));
  put(main, '.claude/registry.md', registry({ parkedHead: [], parked: ['| CR-030 | Gate 2 | 2026-11-06T04:10Z | b | main | Q-1 x |'] }));
  assert.strictEqual(source(main, 'startup'), null, 'a parked table with no header');
});

test('a Worktree cell that is empty, main, -, n/a, none or `main · <branch>` reads the main checkout', () => {
  const { main } = checkout();
  const cells = ['', 'main', '-', '—', 'n/a', 'none', 'NONE', '`main` · task/p2-16', '.'];
  put(main, '.claude/registry.md', registry({ held: cells.map((wt, i) => heldRow(i + 1, `CR-${i + 1}`, { wt })) }));
  cells.forEach((_, i) => put(main, `docs/plans/CR-${i + 1}.state.md`, stateFile({ unit: `CR-${i + 1}`, next: [`step for CR-${i + 1}`] })));
  const text = runHook(main);
  cells.forEach((_, i) => assert.match(text, new RegExp(`^ {2}next: step for CR-${i + 1}$`, 'm'), JSON.stringify(cells[i])));
  assert.doesNotMatch(text, /not found/);
});

test('rows outside the marked sections are never read, and a section without its end marker reads nothing', () => {
  const { main } = checkout();
  const outside = ['| # | Unit | Step | Branch | Worktree |', '|---|---|---|---|---|', '| 2 | CR-099 | 3 tests | change/cr-099 | main |', '', ...PARKED_HEAD, '| CR-098 | Gate 2 | 2026-11-06T04:10Z | change/cr-098 | main | Q-1 x |'];
  put(main, '.claude/registry.md', registry({ outside, held: [heldRow(1, 'CR-021')] }));
  const text = runHook(main);
  assert.match(text, /^HELD CR-021 /m);
  assert.doesNotMatch(text, /CR-099|CR-098/);
  put(main, '.claude/registry.md', `${registry({ held: [heldRow(1, 'CR-021')] }).replace('<!-- /harness:active -->', '')}\n`);
  assert.doesNotMatch(runHook(main) || '', /HELD/, 'an active section with no end marker');
  put(main, '.claude/registry.md', `${registry({ outside, parked: ['| CR-030 | Gate 2 | t | b | main | c |'] }).replace('<!-- /harness:parked -->', '')}\n`);
  assert.strictEqual(source(main, 'startup'), null, 'a parked section with no end marker, and rows outside');
});

test('row 0 and a first cell that is not a number of 1 or more are never held', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: ['| - | CR-021 | | | main | | |', '| # | CR-022 | | | main | | |', '| 00 | CR-023 | | | main | | |', '| 1a | CR-024 | | | main | | |'] }));
  assert.strictEqual(source(main, 'startup'), null);
  assert.strictEqual(runHook(main), [FIRST('compact'), NO_ROWS].join('\n'));
  put(main, '.claude/registry.md', registry({ held: ['| 12 | CR-025 | | | main | | |'] }));
  assert.match(runHook(main), /^HELD CR-025 · main$/m);
});

console.log('\nharness session-resume: silence');

test('no registry or not a checkout: nothing printed, exit 0; no row held or parked: nothing, but a compaction points at the queue', () => {
  const { main } = checkout();
  assert.strictEqual(runHook(main), null, 'no registry');
  put(main, '.claude/registry.md', registry());
  for (const s of ['startup', 'resume', 'clear', 'something-new']) assert.strictEqual(source(main, s), null, `row 0 and an empty parked table: ${s}`);
  assert.strictEqual(source(main, 'compact'), [FIRST('compact'), NO_ROWS].join('\n'), 'a compaction with no unit held or parked');
  put(main, '.claude/registry.md', '# Registry\n| # | Unit |\n|---|---|\n| 1 | CR-021 |\n');
  assert.strictEqual(source(main, 'startup'), null, 'no markers: nothing is inside them');
  assert.strictEqual(source(main, 'compact'), [FIRST('compact'), NO_ROWS].join('\n'), 'no markers, on a compaction');
  const plain = path.join(tmp('session-resume-plain-'), 'plain');
  put(plain, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  assert.strictEqual(runHook(plain), null, 'not a git checkout');
});

test('another event, a payload that is not JSON, or no directory at all: nothing printed, exit 0', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  assert.ok(runHook(main), 'the fixture holds a row');
  assert.strictEqual(runHook(main, { input: { hook_event_name: 'UserPromptSubmit' } }), null);
  assert.strictEqual(runHook(main, { input: { hook_event_name: undefined } }), null);
  assert.strictEqual(runHook(main, { raw: '{ not json' }), null);
  assert.strictEqual(runHook(main, { raw: '' }), null);
  assert.strictEqual(runHook(main, { input: { cwd: undefined } }), null);
});

console.log('\nharness session-resume: the state file');

test('open questions: Q table rows by their Decision cell, Q first words and bullets; DEC rows and other sections are not open', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  put(main, 'docs/plans/CR-021.state.md', stateFile({
    findings: ['| Q-9 | HIGH | codex-review | | open | a finding id, not a card |'],
    scope: ['Q-8 · a scope note, not a card'],
    decisions: [
      '| DEC-1 | 2026-11-05 | T | Keep the column order | agent |',
      '| Q-1 | 2026-11-06 | P | Merge or hold? | owner |',
      '',
      'Q-2 · P · Which button copy?',
      '- Q-3: May the export carry phone numbers?',
      'Q-1a is not a card id',
      'See Q-4 later, not a first word',
    ],
  }));
  assert.match(runHook(main), /^ {2}open: Q-1 Merge or hold\? · Q-2 P · Which button copy\? · Q-3 May the export carry phone numbers\?$/m);
  // a table with no Question or Decision column quotes the row's other cells
  put(main, 'docs/plans/CR-021.state.md', ['Unit: CR-021', '', '## Decisions', '| ID | Class | Note |', '|---|---|---|', '| Q-5 | P | the copy |', ''].join('\n'));
  assert.match(runHook(main), /^ {2}open: Q-5 P · the copy$/m);
});

test('headers before the first ## only, each present part only; ## Next quoted to its first three non-empty lines, long ones clipped', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  const long = `next: ${'x'.repeat(400)}`;
  put(main, 'docs/plans/CR-021.state.md', stateFile({ head: ['Stop: after CR-021', 'Stop: a second Stop line is not read'], scope: ['Grant: inside a section, not a header'], next: ['', `* ${long}`, '', '+ two', '- three', '- four'] }));
  const text = runHook(main);
  assert.match(text, /^ {2}stop: after CR-021$/m);
  assert.doesNotMatch(text, /grant:|narrows|tier|second Stop/);
  const next = /^ {2}next: (.*)$/m.exec(text)[1].split(' / ');
  assert.strictEqual(next.length, 3);
  assert.strictEqual(next[0].length, 160);
  assert.ok(next[0].endsWith('…') && next[0].startsWith('next: xxx'), next[0]);
  assert.deepStrictEqual(next.slice(1), ['two', 'three']);
  // a held unit whose state file still carries a Parked line says so
  put(main, 'docs/plans/CR-021.state.md', stateFile({ head: ['Parked: Gate 2 2026-11-06T04:10Z', 'Grant: merge clean Full · push after merge'] }));
  assert.match(runHook(main), /^ {2}parked: Gate 2 2026-11-06T04:10Z; kickoff narrows: merge clean Full · push after merge$/m);
});

test('a missing, unreadable or broken state file prints the row; an id that leaves the state directory is never read', () => {
  const co = checkout();
  const { main } = co;
  put(path.dirname(main), 'etc/secret.state.md', 'Tier: leaked\n## Next\nleaked\n');
  put(main, '.claude/registry.md', registry({ held: [
    heldRow(1, 'CR-021'), heldRow(2, 'CR-022', { wt: '../gone' }), heldRow(3, 'CR-023'), heldRow(4, 'CR-024'),
    heldRow(5, '../etc/secret'), heldRow(6, 'CR..1'), heldRow(7, '/etc/secret'), heldRow(8, 'a/b/c'), heldRow(9, 'change/fix-login'),
  ] }));
  fs.mkdirSync(path.join(main, 'docs/plans/CR-023.state.md'), { recursive: true });
  put(main, 'docs/plans/CR-024.state.md', Buffer.from([0, 1, 2, 0xff, 0xfe, 10, 35, 35, 10, 124, 124]).toString('latin1'));
  put(main, 'docs/plans/change/fix-login.state.md', stateFile({ unit: 'change/fix-login', next: ['the nested one'] }));
  const text = runHook(main);
  assert.match(text, /^HELD CR-021 · step 5 implement · change\/cr-021 · main\n {2}state file not found: docs\/plans\/CR-021\.state\.md \(in this checkout or on change\/cr-021\)$/m);
  assert.match(text, /^ {2}state file not found: \.\.\/gone\/docs\/plans\/CR-022\.state\.md \(in this checkout or on change\/cr-022\)$/m);
  assert.match(text, /^ {2}state file not found: docs\/plans\/CR-023\.state\.md \(in this checkout or on change\/cr-023\)$/m);
  assert.match(text, /^HELD CR-024 · step 5 implement · change\/cr-024 · main\nHELD /m, 'a broken file prints the row alone');
  for (const id of ['../etc/secret', 'CR..1', '/etc/secret', 'a/b/c']) {
    assert.ok(text.includes(`  state file not read: '${id}' is not a unit id`), id);
  }
  assert.doesNotMatch(text, /leaked/);
  assert.match(text, /^ {2}next: the nested one$/m, 'one / nests the state file');
});

test("a state file that is not in the row's checkout is read from its Branch cell's branch: a unit parked on a main checkout now on another unit's branch", () => {
  const { main } = checkout();
  git(main, 'checkout', '-q', '-b', 'change/cr-030');
  put(main, 'docs/plans/CR-030.state.md', stateFile({ unit: 'CR-030', head: ['Tier: Small', 'Parked: Gate 2 2026-11-06T04:10Z'], decisions: ['| Q-1 | 2026-11-06 | P | Merge or hold? | owner |'], next: ["wait for the owner's answers"] }));
  git(main, 'add', '.');
  git(main, 'commit', '-q', '--no-verify', '-m', 'park CR-030');
  git(main, 'checkout', '-q', '-b', 'change/cr-031', 'main');
  assert.ok(!fs.existsSync(path.join(main, 'docs/plans/CR-030.state.md')), 'the main checkout is on another branch');
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-031')], parked: [
    '| CR-030 | Gate 2 | 2026-11-06T04:10Z | `change/cr-030` | main | |',
    '| CR-032 | Gate 1 | t | change/cr-032 | | |',
    '| CR-033 | Gate 1 | t | -c | main | |',
    '| CR-034 | Gate 1 | t | change/cr-030..main | main | |',
    '| CR-035 | Gate 1 | t | change/cr-030~1 | main | |',
  ] }));
  const text = runHook(main);
  assert.match(text, /^PARKED CR-030 · Gate 2 since 2026-11-06T04:10Z\n {2}next: wait for the owner's answers\n {2}open: Q-1 Merge or hold\?$/m);
  assert.match(text, /^HELD CR-031 · step 5 implement · change\/cr-031 · main\n {2}state file not found: docs\/plans\/CR-031\.state\.md \(in this checkout or on change\/cr-031\)$/m, 'the branch has no state file');
  assert.match(text, /^ {2}state file not found: docs\/plans\/CR-032\.state\.md \(in this checkout or on change\/cr-032\)$/m, 'no such branch');
  // a Branch cell that is no plain branch name is never handed to git
  for (const id of ['CR-033', 'CR-034', 'CR-035']) assert.match(text, new RegExp(`^PARKED ${id} · .*\\n {2}state file not found: docs/plans/${id}\\.state\\.md$`, 'm'), id);
  assert.strictEqual(lastLine(text), COMPACT);
});

test('the hook writes nothing: the fixture tree is the same after a run', () => {
  const co = checkout();
  put(co.main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')], parked: ['| CR-030 | Gate 2 | t | b | main | Q-1 x |'] }));
  put(co.main, 'docs/plans/CR-021.state.md', stateFile());
  // every path below `dir` with its size and mtime (a walk: readdirSync's recursive option is Node 18.17+)
  const tree = dir => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap(entry => {
    const file = path.join(dir, entry.name);
    const s = fs.statSync(file);
    return [`${file} ${s.isFile() ? s.size : 'dir'} ${s.mtimeMs}`, ...(entry.isDirectory() ? tree(file) : [])];
  });
  const before = tree(co.base);
  for (const s of ['compact', 'startup', 'resume', 'clear']) assert.ok(source(co.main, s));
  assert.deepStrictEqual(tree(co.base), before);
});

console.log('\nharness session-resume: the standing grant');

const STANDING = 'merge when green · push after merge · recommendation on reversible cards';
const mergeBlock = (...lines) => ['# Agents', '', '<!-- harness:begin merge -->', ...lines, '<!-- harness:end merge -->', ''].join('\n');
const standingLine = (push = 'no') => `standing grant (AGENTS.md › merge): ${STANDING}; push deploys: ${push}`;

/** The shipped module's exports, loaded in a child (the hook is ESM, this suite CommonJS): `expr` over `m`, as JSON. */
function fromModule(expr) {
  const code = `import * as m from ${JSON.stringify(pathToFileURL(HOOK).href)}; process.stdout.write(JSON.stringify(${expr}));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("standingGrant reads the merge block's Grant: and Push deploys: lines, the first Grant: only, and nothing outside the block", () => {
  const got = fromModule(`[
    m.standingGrant(${JSON.stringify(mergeBlock(`Grant: ${STANDING}`, 'Push deploys: no'))}),
    m.standingGrant(${JSON.stringify(mergeBlock('Grant:   none  ', 'Push deploys: Yes', 'Grant: a second line'))}),
    m.standingGrant(${JSON.stringify(['Grant: before', 'Push deploys: yes', '<!-- harness:begin merge -->', '<!-- harness:end merge -->', 'Grant: after'].join('\n'))}),
    m.standingGrant('<!-- harness:begin merge -->\\nGrant: never closed\\n'),
    m.standingGrant(${JSON.stringify(mergeBlock(`Grant: ${'x'.repeat(400)}`))}).grant.length,
    m.standingGrant(undefined),
  ]`);
  assert.deepStrictEqual(got[0], { grant: STANDING, pushDeploys: 'no' });
  assert.deepStrictEqual(got[1], { grant: 'none', pushDeploys: 'yes' });
  assert.deepStrictEqual(got[2], { grant: null, pushDeploys: null }, 'outside the block');
  assert.deepStrictEqual(got[3], { grant: null, pushDeploys: null }, 'no end marker');
  assert.strictEqual(got[4], 160, 'clipped like any quoted cell');
  assert.deepStrictEqual(got[5], { grant: null, pushDeploys: null });
});

test('the standing grant line sits right after the first line, on every source, and with no row on a compaction', () => {
  const { main } = checkout();
  put(main, 'AGENTS.md', mergeBlock(`Grant: ${STANDING}`, 'Push deploys: no'));
  put(main, '.claude/registry.md', registry());
  assert.strictEqual(source(main, 'compact'), [FIRST('compact'), standingLine(), NO_ROWS].join('\n'));
  assert.strictEqual(source(main, 'startup'), null, 'context sources stay silent with no row');
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  for (const s of ['compact', 'startup', 'resume', 'clear']) assert.strictEqual(source(main, s).split('\n').slice(0, 2).join('\n'), `${FIRST(s)}\n${standingLine()}`, s);
  put(main, 'AGENTS.md', mergeBlock(`Grant: ${STANDING}`, 'Push deploys: yes'));
  assert.strictEqual(source(main, 'compact').split('\n')[1], standingLine('yes'));
  put(main, 'AGENTS.md', mergeBlock(`Grant: ${STANDING}`));
  assert.strictEqual(source(main, 'compact').split('\n')[1], standingLine('?'));
});

test("a state Grant: that equals the standing grant prints nothing; a different one prints as 'kickoff narrows'", () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  put(main, 'AGENTS.md', mergeBlock(`Grant: ${STANDING}`, 'Push deploys: no'));
  put(main, 'docs/plans/CR-021.state.md', stateFile({ head: [`Grant: ${STANDING}`, 'Stop: after CR-021'] }));
  const same = source(main, 'compact');
  assert.doesNotMatch(same, /narrows|^ {2}grant:/m);
  assert.match(same, /^ {2}stop: after CR-021$/m);
  put(main, 'docs/plans/CR-021.state.md', stateFile({ head: ['Grant: merge when green', 'Stop: after CR-021'] }));
  assert.match(source(main, 'compact'), /^ {2}kickoff narrows: merge when green; stop: after CR-021$/m);
  // no standing grant: nothing to equal, so the state line shows
  fs.rmSync(path.join(main, 'AGENTS.md'));
  assert.match(source(main, 'compact'), /^ {2}kickoff narrows: merge when green; stop: after CR-021$/m);
});

test('a missing, unreadable or block-less AGENTS.md gives no grant line and no failure; a Grant: outside the block is not read', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  assert.doesNotMatch(runHook(main), /standing grant/, 'no AGENTS.md');
  fs.mkdirSync(path.join(main, 'AGENTS.md'));
  assert.doesNotMatch(runHook(main), /standing grant/, 'a directory');
  fs.rmdirSync(path.join(main, 'AGENTS.md'));
  put(main, 'AGENTS.md', '# Agents\nGrant: outside any block\nPush deploys: yes\n');
  assert.doesNotMatch(runHook(main), /standing grant/, 'no merge block');
  put(main, 'AGENTS.md', `${mergeBlock('Grant: inside')}Grant: after the block\n`);
  assert.match(runHook(main), /^standing grant \(AGENTS\.md › merge\): inside; push deploys: \?$/m);
});

test('the standing grant line is kept inside MAX_BYTES with the closing line, and is the last body line cut', () => {
  const { main } = checkout();
  put(main, 'AGENTS.md', mergeBlock(`Grant: ${STANDING}`, 'Push deploys: no'));
  put(main, '.claude/registry.md', registry({ held: Array.from({ length: 60 }, (_, i) => heldRow(i + 1, `CR-${100 + i}`, { branch: `change/cr-${100 + i}-a-long-branch-name`, wt: `../wt-cr-${100 + i}` })) }));
  const text = runHook(main);
  assert.ok(Buffer.byteLength(text) <= 4000, `${Buffer.byteLength(text)} bytes`);
  const lines = text.split('\n');
  assert.strictEqual(lines[1], standingLine());
  assert.match(lines.at(-2), /^… \d+ more lines: read /);
  assert.strictEqual(lines.at(-1), SEVERAL);
});

console.log('\nharness session-resume: the text');

test('the closing line: compact continues the held unit; startup, resume, clear and an unknown source are context only', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  const compact = source(main, 'compact');
  assert.match(compact, /^\[session-resume\] compact: /);
  assert.strictEqual(lastLine(compact), COMPACT);
  for (const s of ['startup', 'resume', 'clear']) {
    const text = source(main, s);
    assert.match(text, new RegExp(`^\\[session-resume\\] ${s}: `), s);
    assert.strictEqual(lastLine(text), CONTEXT, s);
  }
  for (const odd of ['something-new', undefined, 42]) {
    const text = source(main, odd);
    assert.match(text, /^\[session-resume\] startup: /, String(odd));
    assert.strictEqual(lastLine(text), CONTEXT, String(odd));
  }
  // parked rows alone: a compaction says the run may go on with the next ready unit; context only on the rest
  put(main, '.claude/registry.md', registry({ parked: ['| CR-030 | Gate 2 | 2026-11-06T04:10Z | change/cr-030 | main | Q-1 x |'] }));
  assert.strictEqual(lastLine(source(main, 'compact')), PARKED_ONLY);
  assert.strictEqual(lastLine(source(main, 'resume')), CONTEXT);
});

test('over MAX_BYTES: whole lines to the cap, a tail that counts the rest, the closing line kept; under it, no tail', () => {
  const { main } = checkout();
  const held = Array.from({ length: 60 }, (_, i) => heldRow(i + 1, `CR-${100 + i}`, { branch: `change/cr-${100 + i}-a-long-branch-name`, wt: `../wt-cr-${100 + i}` }));
  put(main, '.claude/registry.md', registry({ held, parked: ['| CR-300 | Gate 2 | 2026-11-06T04:10Z | change/cr-300 | main | Q-1 x |'] }));
  const text = runHook(main);
  assert.ok(Buffer.byteLength(text) <= 4000, `${Buffer.byteLength(text)} bytes`);
  assert.ok(Buffer.byteLength(text) > 3700, 'the cap keeps as many lines as fit');
  const lines = text.split('\n');
  const tail = /^… (\d+) more lines: read \.claude\/registry\.md and the state files$/.exec(lines.at(-2));
  assert.ok(tail, lines.at(-2));
  const kept = lines.slice(1, -2);
  assert.ok(kept.every(l => /^HELD CR-\d+ · step 5 implement · change\/cr-\d+-a-long-branch-name · \.\.\/wt-cr-\d+$|^ {2}state file not found: \.\.\/wt-cr-\d+\/docs\/plans\/CR-\d+\.state\.md \(in this checkout or on change\/cr-\d+-a-long-branch-name\)$/.test(l)), 'a kept line was cut');
  assert.strictEqual(kept.length + Number(tail[1]), 122);
  assert.doesNotMatch(text, /PARKED/, 'parked rows come after held rows, so they are cut first');
  assert.strictEqual(lastLine(text), SEVERAL);
  // multi-byte text is counted in bytes, not characters
  const wide = Array.from({ length: 40 }, (_, i) => heldRow(i + 1, `CR-${i + 1}`, { step: '— · ' + '…'.repeat(40) }));
  put(main, '.claude/registry.md', registry({ held: wide }));
  assert.ok(Buffer.byteLength(runHook(main)) <= 4000);
  put(main, '.claude/registry.md', registry({ held: held.slice(0, 3) }));
  assert.doesNotMatch(runHook(main), /more lines/);
});

test('the hook still runs when its path goes through a symlinked directory', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  const base = tmp('session-resume-l-');
  fs.mkdirSync(path.join(base, 'real'));
  fs.copyFileSync(HOOK, path.join(base, 'real', 'session-resume.mjs'));
  fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), 'dir');
  const text = runHook(main, { script: path.join(base, 'link', 'session-resume.mjs') });
  assert.ok(text, 'the hook printed nothing through the symlink');
  assert.match(text, /^HELD CR-021 /m);
});

test('the bindings and the readers are exported', () => {
  const code = `
    import * as m from ${JSON.stringify(pathToFileURL(HOOK).href)};
    const reg = ${JSON.stringify(registry({ held: ['| 1 | CR-021 | 5 implement | change/cr-021 | ../wt | | |'], parked: ['| CR-030 | Gate 2 | t | b | main | Q-1 x |'] }))};
    process.stdout.write(JSON.stringify({
      bindings: [m.REGISTRY, m.STATE_DIR, m.MAX_BYTES],
      rows: m.registryRows(reg).map((r) => [r.kind, r.unit, r.step, r.branch, r.worktree, r.gate, r.cards]),
      head: m.readState('Unit: x\\nTier: Small\\n## Next\\nTier: no\\n').head,
      open: m.openQuestions(['Q-1 a', '| Q-2 | b |', 'DEC-1 c']),
      // 163 bytes whole; 124 with one body line kept and the tail, 175 with two
      capped: m.capped('first', ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)], 'last', 130),
      // a cap under the first line, the tail and the closing: no tail, the text cut where no character is split
      // (€ is 3 bytes: 10 of them and \\nz make 32, cut to 9 at a cap of 10 or 11, to 12 at 12)
      tiny: [10, 11, 12].map((max) => m.capped('€'.repeat(10), ['x'], 'z', max)),
      zero: m.capped('first', [], 'last', 0),
    }));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepStrictEqual(got.bindings, ['.claude/registry.md', 'docs/plans', 4000]);
  assert.deepStrictEqual(got.rows, [['held', 'CR-021', '5 implement', 'change/cr-021', '../wt', '', ''], ['parked', 'CR-030', '', 'b', 'main', 'Gate 2', 'Q-1 x']]);
  assert.deepStrictEqual(got.head, { unit: 'x', tier: 'Small' });
  assert.deepStrictEqual(got.open, ['Q-1 a', 'Q-2 b']);
  assert.strictEqual(got.capped, `first\n${'a'.repeat(50)}\n… 2 more lines: read .claude/registry.md and the state files\nlast`);
  assert.deepStrictEqual(got.tiny, ['€€€', '€€€', '€€€€']);
  assert.strictEqual(got.zero, '');
});

test('a small MAX_BYTES binding is still a cap: the text is never longer, whatever the first and closing lines take', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021', { step: '5 implement — étape' })] }));
  put(main, 'docs/plans/CR-021.state.md', stateFile({ next: ['the next step'] }));
  for (const cap of [200, 120, 61, 1]) {
    const script = mutant('export const MAX_BYTES = 4000;', `export const MAX_BYTES = ${cap};`);
    const text = runHook(main, { script });
    assert.ok(Buffer.byteLength(text) <= cap, `${Buffer.byteLength(text)} bytes over a cap of ${cap}`);
    assert.ok(!text.includes('�'), 'a character was split');
    assert.ok(text.startsWith('[session-resume] compact: '.slice(0, Math.min(cap, 26))), text);
  }
});

test('no output starts work, offers /compact or /clear, or mentions a new session', () => {
  const said = OUTPUTS.filter(Boolean);
  assert.ok(said.length >= 20, `only ${said.length} outputs collected`);
  for (const out of said) {
    assert.doesNotMatch(out, /initialUserMessage|sessionTitle|watchPaths|reloadSkills|"decision"|"continue"|systemMessage/, out.slice(0, 200));
    assert.doesNotMatch(out, /\/compact|\/clear|new session/i, out.slice(0, 200));
  }
});

console.log('\nharness session-resume: since your last turn');

const LEAD = '[other sessions] since your last turn: ';
const commit = (dir, subject) => git(dir, 'commit', '-q', '--allow-empty', '--no-verify', '-m', subject);

test('the first prompt of a session prints nothing and records what it saw; nothing changed prints nothing; a commit on main is main +<n> with its subject', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  const id = newSession();
  assert.strictEqual(prompt(main, id), null);
  assert.ok(fs.existsSync(seenPath(id)), 'the seen file is written');
  assert.strictEqual(prompt(main, id), null, 'nothing changed');
  commit(main, 'fix the export header');
  assert.strictEqual(prompt(main, id), `${LEAD}main +1 (fix the export header)`);
  assert.strictEqual(prompt(main, id), null, 'told once');
  commit(main, 'one');
  commit(main, `a long subject ${'x'.repeat(100)}`);
  const line = prompt(main, id);
  assert.match(line, /^\[other sessions\] since your last turn: main \+2 \(a long subject x+…\)$/);
  assert.strictEqual(/\((.*)\)$/.exec(line)[1].length, 60);
});

test('a unit newly held is claimed, one gone from both tables released, one moved from held to parked parked', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  const id = newSession();
  assert.strictEqual(prompt(main, id), null);
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021'), heldRow(2, 'CR-022')] }));
  assert.strictEqual(prompt(main, id), `${LEAD}CR-022 claimed`);
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-022')] }));
  assert.strictEqual(prompt(main, id), `${LEAD}CR-021 released`);
  put(main, '.claude/registry.md', registry({ parked: ['| CR-022 | Gate 2 | 2026-11-06T04:10Z | change/cr-022 | main | Q-1 x |'] }));
  assert.strictEqual(prompt(main, id), `${LEAD}CR-022 parked`);
  assert.strictEqual(prompt(main, id), null, 'told once');
  put(main, '.claude/registry.md', registry({ held: ['| 1 | `CR-030` | 5 implement | change/cr-030 | main | | |'], parked: ['| CR-022 | Gate 2 | t | b | main | Q-1 x |'] }));
  commit(main, 'land it');
  assert.strictEqual(prompt(main, id), `${LEAD}main +1 (land it) · CR-030 claimed`, 'the head first, backticks stripped');
});

test('main rewound, or replaced by an unrelated commit, is main moved', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry());
  commit(main, 'second');
  const id = newSession();
  assert.strictEqual(prompt(main, id), null);
  git(main, 'reset', '-q', '--hard', 'HEAD~1');
  assert.strictEqual(prompt(main, id), `${LEAD}main moved`, 'rewound');
  git(main, 'checkout', '-q', '--orphan', 'other');
  commit(main, 'unrelated');
  git(main, 'branch', '-q', '-f', 'main', 'other');
  git(main, 'checkout', '-q', 'main');
  assert.strictEqual(prompt(main, id), `${LEAD}main moved`, 'unrelated');
});

test('the line is at most 300 characters with 20 units claimed at once, the rest counted', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry());
  const id = newSession();
  assert.strictEqual(prompt(main, id), null);
  put(main, '.claude/registry.md', registry({ held: Array.from({ length: 20 }, (_, i) => heldRow(i + 1, `CR-${1000 + i}-a-long-unit-name`)) }));
  const line = prompt(main, id);
  assert.ok(line.length <= 300, `${line.length} characters`);
  assert.ok(line.startsWith(`${LEAD}CR-1000-a-long-unit-name claimed · `), line);
  assert.match(line, / · \+\d+ more$/);
});

test('a SessionStart records what it showed, so the first prompt after it is silent; each session has its own file; no session id, an id of odd characters, no checkout or a broken seen file is silent', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: [heldRow(1, 'CR-021')] }));
  const id = newSession();
  assert.ok(runHook(main, { input: { session_id: id } }), 'the start prints as before');
  assert.ok(fs.existsSync(seenPath(id)));
  assert.strictEqual(prompt(main, id), null, 'the start already showed it');
  const other = newSession();
  assert.strictEqual(prompt(main, other), null);
  commit(main, 'next');
  assert.strictEqual(prompt(main, id), `${LEAD}main +1 (next)`);
  assert.strictEqual(prompt(main, other), `${LEAD}main +1 (next)`);
  assert.strictEqual(prompt(main, undefined), null, 'no session id');
  assert.strictEqual(prompt(main, '../..'), null, 'an id with nothing left once sanitised');
  const plain = path.join(tmp('session-resume-plain-'), 'plain');
  put(plain, '.claude/registry.md', registry());
  assert.strictEqual(prompt(plain, newSession()), null, 'not a checkout');
  const broken = newSession();
  fs.writeFileSync(seenPath(broken), '{ not json');
  commit(main, 'again');
  assert.strictEqual(prompt(main, broken), null, 'an unreadable seen file is a first run');
});

console.log('\nharness session-resume: mutation');

/** A copy of the shipped hook with one line replaced. */
function mutant(from, to) {
  const text = fs.readFileSync(HOOK, 'utf8');
  assert.ok(text.includes(from), `not in the shipped file: ${from}`);
  const script = path.join(tmp('session-resume-m-'), 'session-resume.mjs');
  fs.writeFileSync(script, text.replace(from, () => to));
  return script;
}

test('mutation: a parse that also reads rows outside the marked sections is caught', () => {
  const script = mutant('const body = lines.slice(begin + 1, end).filter(', 'const body = lines.filter(');
  const { main } = checkout();
  const outside = ['| # | Unit | Step | Branch | Worktree |', '|---|---|---|---|---|', '| 2 | CR-099 | 3 tests | change/cr-099 | main |'];
  put(main, '.claude/registry.md', registry({ outside }));
  assert.match(runHook(main, { script }) || '', /HELD CR-099/, 'the mutant reads the row outside the markers');
  assert.strictEqual(source(main, 'startup'), null);
});

test('mutation: a cap that is never applied is caught', () => {
  const script = mutant('if (size([first, ...body, last]) <= max)', 'if (size([first, ...body, last]) <= Infinity)');
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ held: Array.from({ length: 60 }, (_, i) => heldRow(i + 1, `CR-${100 + i}`)) }));
  assert.ok(Buffer.byteLength(runHook(main, { script })) > 4000, 'the mutant prints past the cap');
  const text = runHook(main);
  assert.ok(Buffer.byteLength(text) <= 4000 && /more lines: read/.test(text));
});

test('mutation: row 0 counted as held is caught', () => {
  const script = mutant('if (!/^[1-9][0-9]*$/.test(', 'if (!/^[0-9]+$/.test(');
  const { main } = checkout();
  put(main, '.claude/registry.md', registry());
  assert.match(runHook(main, { script }) || '', /HELD mainline/, 'the mutant holds the mainline row');
  assert.strictEqual(source(main, 'startup'), null);
});

test('mutation: a Branch cell handed to git unchecked is caught', () => {
  const script = mutant("if (!BRANCH.test(row.branch) || row.branch.includes('..'))", 'if (!row.branch)');
  const { main } = checkout();
  put(main, '.claude/registry.md', registry({ parked: ['| CR-030 | Gate 2 | t | change/cr-030..main | main | |'] }));
  assert.match(runHook(main, { script }), /\(in this checkout or on change\/cr-030\.\.main\)$/m, 'the mutant hands a range to git');
  assert.doesNotMatch(runHook(main), /in this checkout or on/);
});

test('mutation: a head compared without the ancestor check, or a line without its cap, is caught', () => {
  const { main } = checkout();
  put(main, '.claude/registry.md', registry());
  commit(main, 'second');
  const noAncestor = mutant("if (isAncestor(root, before.head, after.head)) {", 'if (true) {');
  const id = newSession();
  assert.strictEqual(prompt(main, id, noAncestor), null);
  git(main, 'reset', '-q', '--hard', 'HEAD~1');
  assert.notStrictEqual(prompt(main, id, noAncestor), `${LEAD}main moved`, 'the mutant counts a rewind as a gain');
  assert.strictEqual(prompt(main, newSession(), HOOK), null);
  const uncapped = mutant('const SINCE_MAX = 300;', 'const SINCE_MAX = 30000;');
  const cap = newSession();
  assert.strictEqual(prompt(main, cap, uncapped), null);
  put(main, '.claude/registry.md', registry({ held: Array.from({ length: 20 }, (_, i) => heldRow(i + 1, `CR-${1000 + i}-a-long-unit-name`)) }));
  assert.ok(prompt(main, cap, uncapped).length > 300, 'the mutant prints past the cap');
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
for (const id of SESSIONS) fs.rmSync(seenPath(id), { force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
