// harness-bootstrap session-resume tests (generated YYYY-MM-DD). Run: node --test scripts/lib/session-resume.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED hook, .claude/hooks/session-resume.mjs:
// each case builds a throwaway main checkout (and for one a linked worktree) holding a registry and
// state files, and pipes a real SessionStart payload into the hook. Hermetic: no GIT_* variable,
// global git config or CLAUDE_PROJECT_DIR reaches git or the hook, and git looks no higher than the
// case's own directory.
// [B] binding: the EXPECTED line, bound with the hook's [B] REGISTRY, STATE_DIR and MAX_BYTES lines
// and equal to them. The cases lay their files out at these paths, never at the hook's: a rebound hook
// fails here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// [B] The hook's bindings: its REGISTRY, STATE_DIR and MAX_BYTES.
const EXPECTED = { REGISTRY: '.claude/registry.md', STATE_DIR: 'docs/plans', MAX_BYTES: 4000 };

const HOOK = fileURLToPath(new URL('../../.claude/hooks/session-resume.mjs', import.meta.url));
const bound = await import(pathToFileURL(HOOK).href);
const { REGISTRY, STATE_DIR, MAX_BYTES } = EXPECTED;

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CLAUDE_PROJECT_DIR'));
Object.assign(ENV, { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' });

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

/** A main checkout with one commit, alone in its own directory: { base, main }. */
function checkout() {
  const base = tmp('session-resume-');
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'init');
  return { base, main };
}

/** A registry: row 0 and the held rows inside the active markers, the parked rows in the parked table, `outside` above both. */
const registry = ({ held = [], parked = [], outside = [] } = {}) => [
  '# Registry', ...outside, '',
  '<!-- harness:active -->',
  '| # | Unit | Step | Branch | Worktree | Resources | Claimed (UTC) |', '|---|---|---|---|---|---|---|',
  '| 0 | mainline, never claimed | | | main | | |', ...held,
  '<!-- /harness:active -->', '',
  '<!-- harness:parked -->',
  '| Unit | Gate | Parked (UTC) | Branch | Worktree | Cards |', '|---|---|---|---|---|---|', ...parked,
  '<!-- /harness:parked -->', '',
].join('\n');

/** A state file in the contract's shape: header lines, then the sections. */
const stateFile = ({ unit = 'CR-021', head = ['Tier: Full'], decisions = [], next = [] } = {}) => [
  `Unit: ${unit}`, ...head, '',
  '## Scope', 'Done when: the export runs.', '',
  '## Decisions', '| ID | Date | Class (P / C / T) | Decision | By |', '|---|---|---|---|---|', ...decisions, '',
  '## Next', ...next, '',
].join('\n');

/** Runs the installed hook for one SessionStart; its additionalContext, or null when it prints nothing. */
function run(dir, source = 'compact', env = {}) {
  const input = JSON.stringify({ hook_event_name: 'SessionStart', source, cwd: dir, session_id: 'test-session', transcript_path: path.join(dir, 'none.jsonl') });
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: { ...ENV, GIT_CEILING_DIRECTORIES: path.dirname(dir), ...env } });
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout === '') return null;
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.deepEqual(Object.keys(out.hookSpecificOutput), ['hookEventName', 'additionalContext']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const text = out.hookSpecificOutput.additionalContext;
  assert.doesNotMatch(text, /initialUserMessage|\/compact|\/clear|new session/i, 'the text starts work or offers a hand-off');
  return text;
}
const lastLine = (text) => text.split('\n').at(-1);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the hook runs at the bound registry, state directory and cap', () => {
  const { REGISTRY: registryPath, STATE_DIR: stateDir, MAX_BYTES: cap } = bound;
  assert.deepEqual({ REGISTRY: registryPath, STATE_DIR: stateDir, MAX_BYTES: cap }, EXPECTED, "the hook's REGISTRY, STATE_DIR or MAX_BYTES is not the EXPECTED binding");
});

test("a held row in a linked worktree: the main checkout's registry, and its state file's next, open Q rows and grant", () => {
  const { base, main } = checkout();
  const wt = path.join(base, 'wt-cr-021');
  git(main, 'worktree', 'add', '-q', '-b', 'change/cr-021', wt);
  put(main, REGISTRY, registry({ held: ['| 1 | CR-021 | 5 implement | change/cr-021 | ../wt-cr-021 | | 2026-11-06T02:00Z |'] }));
  put(wt, `${STATE_DIR}/CR-021.state.md`, stateFile({
    head: ['Tier: Full', 'Grant: merge clean Full · push after merge', 'Stop: after CR-021'],
    decisions: ['| DEC-1 | 2026-11-05 | T | Keep the column order | agent |', '| Q-1 | 2026-11-06 | P | Merge or hold? | owner |', '| Q-2 | 2026-11-06 | P | Which button copy? | owner |'],
    next: ['- done: 4 tests', '- next: 5 implement, slice 2', '', '- then: 6 review', '- later: 7 docs'],
  }));
  const text = run(wt, 'compact', { CLAUDE_PROJECT_DIR: wt });
  assert.match(text, /^HELD CR-021 · step 5 implement · change\/cr-021 · \.\.\/wt-cr-021 · tier Full$/m);
  assert.match(text, /^ {2}next: done: 4 tests \/ next: 5 implement, slice 2 \/ then: 6 review$/m, 'the first three non-empty lines of ## Next');
  assert.match(text, /^ {2}open: Q-1 Merge or hold\? · Q-2 Which button copy\?$/m);
  assert.doesNotMatch(text, /DEC-1/, 'an answered card is a DEC row, not open');
  assert.match(text, /^ {2}grant: merge clean Full · push after merge; stop: after CR-021$/m);
});

test('a parked row: its gate, since when and its cards, its state file read from its branch when the checkout is on another; with no held row a compaction points at the next ready unit', () => {
  const { main } = checkout();
  put(main, REGISTRY, registry({ parked: ['| CR-030 | Gate 2 | 2026-11-06T04:10Z | change/cr-030 | main | Q-1 merge or hold · Q-2 button copy |'] }));
  put(main, `${STATE_DIR}/CR-030.state.md`, stateFile({ unit: 'CR-030', head: ['Tier: Full', 'Parked: Gate 2 2026-11-06T04:10Z'], next: ["wait for the owner's answers"] }));
  const text = run(main, 'compact');
  assert.match(text, /^PARKED CR-030 · Gate 2 since 2026-11-06T04:10Z · Q-1 merge or hold · Q-2 button copy\n {2}next: wait for the owner's answers$/m);
  assert.doesNotMatch(text, /^HELD/m);
  assert.equal(lastLine(text), "No unit is held; parked units wait for the owner's answers. If a queue run is on, start the next ready unit (the runner's Shape).");
  // the unit's state file committed on its branch, and the main checkout moved to another unit's branch
  git(main, 'checkout', '-q', '-b', 'change/cr-030');
  git(main, 'add', `${STATE_DIR}/CR-030.state.md`);
  git(main, 'commit', '-q', '--no-verify', '-m', 'park CR-030');
  git(main, 'checkout', '-q', '-b', 'change/cr-031', 'main');
  assert.ok(!fs.existsSync(path.join(main, STATE_DIR, 'CR-030.state.md')));
  assert.equal(run(main, 'compact'), text, 'read from change/cr-030');
});

test('no held or parked row, rows outside the marked sections only, or no registry: silent, but a compaction points a queue run at its next unit', () => {
  const { main } = checkout();
  assert.equal(run(main), null, 'no registry');
  const none = [
    "[session-resume] compact: the harness's resume point, read from the registry and the state files (newer than any summary).",
    "No unit is held or parked. If a queue run is on, run harness-due and start the next ready unit under the kickoff's Grant: and Stop: lines (the runner's Shape).",
  ].join('\n');
  put(main, REGISTRY, registry());
  assert.equal(run(main, 'startup'), null, 'row 0 alone is the mainline, never held');
  assert.equal(run(main, 'compact'), none, 'row 0 alone, on a compaction');
  put(main, REGISTRY, registry({ outside: ['| # | Unit | Step | Branch | Worktree |', '|---|---|---|---|---|', '| 2 | CR-099 | 3 tests | change/cr-099 | main |'] }));
  assert.equal(run(main, 'resume'), null, 'a numbered row outside the active markers is not held');
  assert.equal(run(main, 'compact'), none, 'a numbered row outside the active markers, on a compaction');
});

test('a missing, unreadable or broken state file still prints its row, and the hook exits 0', () => {
  const { main } = checkout();
  put(main, REGISTRY, registry({
    held: ['| 1 | CR-021 | 5 implement | change/cr-021 | main | | |', '| 2 | CR-022 | 3 tests | change/cr-022 | - | | |', '| 3 | CR-023 | 2 plan | change/cr-023 | n/a | | |', '| 4 | ../../outside | 1 | x | main | | |'],
  }));
  fs.mkdirSync(path.join(main, STATE_DIR, 'CR-022.state.md'), { recursive: true }); // a directory: unreadable
  put(main, `${STATE_DIR}/CR-023.state.md`, '\u0000\u0001 not a state file ÿ\n## \n|||\n');
  const text = run(main);
  assert.match(text, new RegExp(`^HELD CR-021 · step 5 implement · change/cr-021 · main\\n {2}state file not found: ${esc(STATE_DIR)}/CR-021\\.state\\.md \\(in this checkout or on change/cr-021\\)$`, 'm'));
  assert.match(text, new RegExp(`^HELD CR-022 · step 3 tests · change/cr-022 · main\\n {2}state file not found: ${esc(STATE_DIR)}/CR-022\\.state\\.md \\(in this checkout or on change/cr-022\\)$`, 'm'));
  assert.match(text, /^HELD CR-023 · step 2 plan · change\/cr-023 · main$/m, 'a broken state file prints the row alone');
  assert.match(text, /^ {2}state file not read: '\.\.\/\.\.\/outside' is not a unit id$/m, 'an id that leaves the state directory is refused');
});

test('over MAX_BYTES: whole lines up to the cap, held rows before parked, then how many more and where to read them', () => {
  const { main } = checkout();
  const held = Array.from({ length: 60 }, (_, i) => `| ${i + 1} | CR-${100 + i} | 5 implement | change/cr-${100 + i}-a-long-branch-name | ../wt-cr-${100 + i} | | |`);
  put(main, REGISTRY, registry({ held, parked: ['| CR-300 | Gate 2 | 2026-11-06T04:10Z | change/cr-300 | main | Q-1 merge or hold |'] }));
  const text = run(main);
  assert.ok(Buffer.byteLength(text) <= MAX_BYTES, `${Buffer.byteLength(text)} bytes`);
  const lines = text.split('\n');
  const tail = new RegExp(`^… (\\d+) more lines: read ${esc(REGISTRY)} and the state files$`).exec(lines.at(-2));
  assert.ok(tail, `no tail line: ${lines.at(-2)}`);
  const kept = lines.slice(1, -2);
  const whole = new RegExp(`^HELD CR-\\d+ · step 5 implement · change/cr-\\d+-a-long-branch-name · \\.\\./wt-cr-\\d+$|^ {2}state file not found: \\.\\./wt-cr-\\d+/${esc(STATE_DIR)}/CR-\\d+\\.state\\.md \\(in this checkout or on change/cr-\\d+-a-long-branch-name\\)$`);
  assert.ok(kept.every((l) => whole.test(l)), 'a kept line was cut');
  assert.equal(kept.length + Number(tail[1]), 2 * 61, 'the tail counts every line it cut');
  assert.match(text, /^HELD CR-100 /m);
  assert.doesNotMatch(text, /PARKED/, 'the parked row comes last, so it is cut first');
  assert.match(lastLine(text), /^Continue the held unit's next step/, 'the closing line is kept');
  // a cap too small for the first line, the count and the closing line: the text is cut to it, never inside a character
  for (const max of [10, 11, 12]) {
    const cut = bound.capped('€'.repeat(10), ['x'], 'z', max);
    assert.ok(Buffer.byteLength(cut) <= max && /^€+$/.test(cut), `${max}: ${cut}`);
  }
});

test('compact says continue the held unit; startup, resume and clear are context only', () => {
  const { main } = checkout();
  put(main, REGISTRY, registry({ held: ['| 1 | CR-021 | 5 implement | change/cr-021 | main | | |'] }));
  const compact = run(main, 'compact');
  assert.match(compact, /^\[session-resume\] compact: /);
  assert.equal(lastLine(compact), "Continue the held unit's next step from its state file and the runner's process.md (Step 0a: verify, do not trust the marker); parked units wait for the owner's answers.");
  for (const source of ['startup', 'resume', 'clear']) {
    const text = run(main, source);
    assert.match(text, new RegExp(`^\\[session-resume\\] ${source}: `));
    assert.equal(lastLine(text), 'Context only: start nothing until the owner asks; /task-runner resumes the held unit, then answered parked units, then due-checks, then the queue.', source);
  }
});

test('not a git checkout: silent, even with a registry holding a row', () => {
  const dir = path.join(tmp('session-resume-plain-'), 'plain');
  put(dir, REGISTRY, registry({ held: ['| 1 | CR-021 | 5 implement | change/cr-021 | main | | |'] }));
  assert.equal(run(dir), null);
});
