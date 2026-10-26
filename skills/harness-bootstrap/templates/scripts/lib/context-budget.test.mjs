// harness-bootstrap context-budget tests (generated YYYY-MM-DD). Run: node --test scripts/lib/context-budget.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED hook, .claude/hooks/context-budget.mjs,
// at this project's own figures: each case writes a transcript and pipes a real hook payload into
// it. Hermetic: no settings file, window variable or CONTEXT_BUDGET_* setting reaches the hook,
// so the figures are its defaults (the window lookup is the template's own suite).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOK = fileURLToPath(new URL('../../.claude/hooks/context-budget.mjs', import.meta.url));
const EVENTS = ['Stop', 'UserPromptSubmit', 'PostToolUse'];

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
};

const HOME = tmp('context-budget-home-');
const ENV = { ...process.env, HOME };
for (const k of ['CONTEXT_BUDGET_WARN', 'CONTEXT_BUDGET_LIMIT', 'CONTEXT_BUDGET_STATE_DIR', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_PROJECT_DIR']) delete ENV[k];
// The hook's figures, as it reads them under that environment (its WARN is read at import).
delete process.env.CONTEXT_BUDGET_WARN;
const { GATE_TEXT, budgetFigures } = await import(pathToFileURL(HOOK).href);
const { warn: WARN, limit: LIMIT } = budgetFigures(ENV, tmp('context-budget-project-'), HOME);
const GATE = Math.min(GATE_TEXT, WARN);
const K = (n) => `${n / 1000}K`;

const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const reply = (tokens, extra = {}) => ({
  type: 'assistant',
  message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, cache_read_input_tokens: tokens - 1_010, cache_creation_input_tokens: 1_000, output_tokens: 50 } },
  ...extra,
});
const compacted = (extra = {}) => ({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'manual', preTokens: LIMIT + 40_000 }, ...extra });

/** Runs the installed hook for one event; its parsed output, or null when it says nothing. */
function run(records, event, stateDir = tmp('context-budget-state-')) {
  const dir = tmp('context-budget-t-');
  const transcript = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(transcript, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const input = JSON.stringify({ hook_event_name: event, session_id: 'test-session', transcript_path: transcript, cwd: dir });
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: { ...ENV, CONTEXT_BUDGET_STATE_DIR: stateDir } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout === '' ? null : JSON.parse(r.stdout);
}
const said = (out) => out?.systemMessage ?? out?.hookSpecificOutput?.additionalContext ?? null;
const at = (tokens, event) => said(run([user('hi'), reply(tokens)], event));

test('below the gate line only UserPromptSubmit speaks: the figure and the mark', () => {
  const tokens = GATE - 1_000;
  assert.equal(at(tokens, 'Stop'), null);
  assert.equal(at(tokens, 'PostToolUse'), null);
  assert.equal(at(tokens, 'UserPromptSubmit'), `[context-budget] ~${K(tokens)} (under ${K(WARN)}).`);
});

test('from the gate line up, the model hears that an owner gate goes out as text', () => {
  assert.match(at(GATE, 'UserPromptSubmit'), /as text/);
  assert.doesNotMatch(at(GATE - 1_000, 'UserPromptSubmit'), /as text/);
});

test('at the warning mark Stop tells the owner; below it Stop is silent', () => {
  assert.match(at(WARN, 'Stop'), /^Context /);
  assert.equal(at(WARN - 1_000, 'Stop'), null);
});

test('at the limit the model hears it is over the budget, and PostToolUse says so once per band', () => {
  assert.match(at(LIMIT, 'UserPromptSubmit'), new RegExp(`over the ${K(LIMIT)} budget`));
  assert.doesNotMatch(at(LIMIT - 1_000, 'UserPromptSubmit'), /over the/);
  const state = tmp('context-budget-state-');
  assert.match(said(run([reply(LIMIT)], 'PostToolUse', state)), /over the/);
  assert.equal(run([reply(LIMIT)], 'PostToolUse', state), null, 'the same band twice');
});

test('a compaction since the last reply silences every event until the next reply', () => {
  const records = [user('hi'), reply(LIMIT + 40_000), compacted(), user('next')];
  for (const event of EVENTS) assert.equal(run(records, event), null, event);
  const later = [...records, reply(GATE - 1_000)];
  assert.equal(said(run(later, 'UserPromptSubmit')), `[context-budget] ~${K(GATE - 1_000)} (under ${K(WARN)}).`);
});

test("subagent and synthetic records are not readings, and a subagent's compaction is not a boundary", () => {
  const synthetic = { type: 'assistant', message: { model: '<synthetic>', role: 'assistant', content: [], usage: { input_tokens: 0, output_tokens: 0 } } };
  const records = [user('hi'), reply(LIMIT + 40_000), reply(1_000, { isSidechain: true }), synthetic, compacted({ isSidechain: true })];
  assert.match(said(run(records, 'Stop')), new RegExp(`over the ${K(LIMIT)} budget`));
});
