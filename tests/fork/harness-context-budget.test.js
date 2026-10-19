/**
 * Tests for the harness-bootstrap context-budget hook template (biji-dev/ecc-js):
 * PostToolUse banding, no-handoff wording, exported newBand, and a mutation check.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
// BUDGET_UNDER_TEST points the suite at a mutant to prove each case can fail; unset, it tests the shipped file.
const BUDGET = process.env.BUDGET_UNDER_TEST || path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'context-budget.mjs');

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

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function transcript(tokens) {
  const file = path.join(tmp('ctx-budget-t-'), 't.jsonl');
  const lines = [
    { type: 'user', message: { content: 'hi' } },
    { type: 'assistant', message: { model: 'claude-opus', usage: { input_tokens: 10, cache_read_input_tokens: tokens - 10, cache_creation_input_tokens: 0 } } }
  ];
  fs.writeFileSync(file, `${lines.map(l => JSON.stringify(l)).join('\n')}\n`);
  return file;
}

/** Run a hook script (default: the shipped template) with an isolated state dir. */
function runHook(event, tokens, stateDir, opts = {}) {
  const input = JSON.stringify({
    hook_event_name: event,
    transcript_path: transcript(tokens),
    session_id: opts.session || 'sess-1'
  });
  const env = { ...process.env, CONTEXT_BUDGET_STATE_DIR: stateDir };
  delete env.CONTEXT_BUDGET_WARN;
  delete env.CONTEXT_BUDGET_LIMIT;
  const result = spawnSync(process.execPath, [opts.script || BUDGET], { input, encoding: 'utf8', env });
  assert.strictEqual(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  return result.stdout ? JSON.parse(result.stdout) : null;
}

function text(out) {
  return out ? JSON.stringify(out) : '';
}

console.log('\nharness context-budget: PostToolUse banding');

test('PostToolUse past WARN speaks once per band and again in the next band', () => {
  const dir = tmp('ctx-budget-s-');
  const first = runHook('PostToolUse', 260_000, dir);
  assert.strictEqual(first.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(first.hookSpecificOutput.additionalContext, /past the 250K mark/);
  assert.strictEqual(runHook('PostToolUse', 262_000, dir), null);
  const next = runHook('PostToolUse', 290_000, dir);
  assert.ok(next && next.hookSpecificOutput.additionalContext);
});

test('PostToolUse: two sessions in the same band and state dir each speak once', () => {
  const dir = tmp('ctx-budget-s-');
  assert.ok(runHook('PostToolUse', 260_000, dir, { session: 'sess-a' }), 'session a speaks');
  assert.ok(runHook('PostToolUse', 261_000, dir, { session: 'sess-b' }), 'session b speaks despite a having spoken');
  assert.strictEqual(runHook('PostToolUse', 262_000, dir, { session: 'sess-a' }), null, 'session a stays quiet in its band');
  assert.strictEqual(runHook('PostToolUse', 263_000, dir, { session: 'sess-b' }), null, 'session b stays quiet in its band');
});

test('PostToolUse: a lower band after a compact is news (falling sequence)', () => {
  const dir = tmp('ctx-budget-s-');
  assert.ok(runHook('PostToolUse', 310_000, dir), '310K speaks');
  assert.ok(runHook('PostToolUse', 260_000, dir), '260K speaks again because the band changed');
  assert.strictEqual(runHook('PostToolUse', 262_000, dir), null, 'and is quiet within the new band');
});

test('PostToolUse below WARN prints nothing', () => {
  const dir = tmp('ctx-budget-s-');
  assert.strictEqual(runHook('PostToolUse', 200_000, dir), null);
  assert.strictEqual(runHook('PostToolUse', 249_000, dir), null);
});

test('past the limit on UserPromptSubmit: quotable figure, never a new session', () => {
  const out = runHook('UserPromptSubmit', 401_000, tmp('ctx-budget-s-'));
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /over the 400K budget/);
  assert.match(ctx, /never ask for a new session/i);
});

test('Stop past WARN: systemMessage names the mark and never a new session', () => {
  const out = runHook('Stop', 251_000, tmp('ctx-budget-s-'));
  assert.match(out.systemMessage, /past 250K/);
  assert.doesNotMatch(out.systemMessage, /new session/i);
});

test('below WARN: only UserPromptSubmit speaks', () => {
  const dir = tmp('ctx-budget-s-');
  assert.match(runHook('UserPromptSubmit', 100_000, dir).hookSpecificOutput.additionalContext, /^\[context-budget\] ~100K \(under 250K\)\.$/);
  assert.strictEqual(runHook('Stop', 100_000, dir), null);
  assert.strictEqual(runHook('PostToolUse', 100_000, dir), null);
});

console.log('\nharness context-budget: no hand-off wording');

test('no event/level combination recommends a new session or hand-off', () => {
  const banned = /(start|open|begin) a new session|new session at|or a new session|hand ?off/i;
  const bannedWide = /hand[- ]?(off|over)|(new|fresh) (session|conversation)/i;
  for (const event of ['Stop', 'UserPromptSubmit', 'PostToolUse']) {
    for (const tokens of [100_000, 260_000, 420_000]) {
      const out = runHook(event, tokens, tmp('ctx-budget-s-'));
      // "never ask for a new session" is the one allowed occurrence, and it contains "or a new session"
      // as a substring, so strip it before applying the banned pattern.
      const stripped = text(out).replace(/never ask for a new session/gi, '');
      assert.doesNotMatch(stripped, banned, `${event} @ ${tokens}`);
      assert.doesNotMatch(stripped, /new session/i, `${event} @ ${tokens}`);
      assert.doesNotMatch(stripped, bannedWide, `${event} @ ${tokens}`);
    }
  }
});

console.log('\nharness context-budget: newBand');

test('newBand is exported and returns true then false for the same band', () => {
  const dir = tmp('ctx-budget-s-');
  const code = `
    import { newBand } from ${JSON.stringify(require('url').pathToFileURL(BUDGET).href)};
    const dir = process.argv[1];
    process.stdout.write(JSON.stringify([typeof newBand, newBand('abc/../def', 260000, dir), newBand('abc/../def', 262000, dir), newBand('abc/../def', 290000, dir)]));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, dir], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), ['function', true, false, true]);
  const file = path.join(dir, 'claude-context-budget-abcdef.json');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { band: 11 });
});

console.log('\nharness context-budget: run through a symlinked path');

test('the hook still runs when its path goes through a symlinked directory', () => {
  const base = tmp('ctx-budget-l-');
  const real = path.join(base, 'real');
  fs.mkdirSync(real);
  fs.copyFileSync(BUDGET, path.join(real, 'context-budget.mjs'));
  const link = path.join(base, 'link');
  fs.symlinkSync(real, link, 'dir');
  const script = path.join(link, 'context-budget.mjs');
  const out = runHook('UserPromptSubmit', 100_000, tmp('ctx-budget-s-'), { script });
  assert.ok(out, 'the hook printed nothing through the symlink');
  assert.match(out.hookSpecificOutput.additionalContext, /^\[context-budget\] ~100K \(under 250K\)\.$/);
  const post = runHook('PostToolUse', 260_000, tmp('ctx-budget-s-'), { script });
  assert.match(post.hookSpecificOutput.additionalContext, /past the 250K mark/);
});

console.log('\nharness context-budget: mutation');

test('mutation: a band comparison that never matches makes the second call print again', () => {
  const source = fs.readFileSync(BUDGET, 'utf8');
  const from = 'if (band === last) return false;';
  const to = 'if (band !== band) return false;';
  assert.ok(source.includes(from), 'the band comparison exists in the shipped file');
  const mutant = source.replace(from, to);
  assert.notStrictEqual(mutant, source, 'the replacement applied');
  const script = path.join(tmp('ctx-budget-m-'), 'context-budget.mjs');
  fs.writeFileSync(script, mutant);
  const dir = tmp('ctx-budget-s-');
  assert.ok(runHook('PostToolUse', 260_000, dir, { script }));
  const second = runHook('PostToolUse', 262_000, dir, { script });
  assert.ok(second, 'the mutant prints a second time in the same band');
  // and the shipped file stays quiet for the same sequence
  const dir2 = tmp('ctx-budget-s-');
  runHook('PostToolUse', 260_000, dir2);
  assert.strictEqual(runHook('PostToolUse', 262_000, dir2), null);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
