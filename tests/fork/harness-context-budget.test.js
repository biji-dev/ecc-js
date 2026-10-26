/**
 * Tests for the harness-bootstrap context-budget hook template (biji-dev/ecc-js):
 * PostToolUse banding, the gate line, the limit taken from the auto-compact window,
 * silence after a compaction, no-handoff wording, exported newBand, and mutation checks.
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

/** A main-thread assistant record whose usage adds up to `tokens`. */
function reading(tokens, extra = {}) {
  return { type: 'assistant', message: { model: 'claude-opus', usage: { input_tokens: 10, cache_read_input_tokens: tokens - 10, cache_creation_input_tokens: 0 } }, ...extra };
}

function transcriptOf(records) {
  const file = path.join(tmp('ctx-budget-t-'), 't.jsonl');
  fs.writeFileSync(file, `${records.map(l => JSON.stringify(l)).join('\n')}\n`);
  return file;
}

function transcript(tokens) {
  return transcriptOf([{ type: 'user', message: { content: 'hi' } }, reading(tokens)]);
}

// Hermetic: no developer settings file or window variable reaches the hook unless a test passes one.
const EMPTY_HOME = tmp('ctx-budget-home-');

/** A directory holding `.claude/<name>` files with the given contents (objects are written as JSON). */
function settingsDir(files) {
  const dir = tmp('ctx-budget-p-');
  fs.mkdirSync(path.join(dir, '.claude'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, '.claude', name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

/** Run a hook script (default: the shipped template) with an isolated state dir. */
function runHook(event, tokens, stateDir, opts = {}) {
  const input = JSON.stringify({
    hook_event_name: event,
    transcript_path: opts.records ? transcriptOf(opts.records) : transcript(tokens),
    session_id: opts.session || 'sess-1',
    ...(opts.cwd ? { cwd: opts.cwd } : {})
  });
  const env = { ...process.env, CONTEXT_BUDGET_STATE_DIR: stateDir, HOME: opts.home || EMPTY_HOME };
  for (const key of ['CONTEXT_BUDGET_WARN', 'CONTEXT_BUDGET_LIMIT', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CONFIG_DIR']) delete env[key];
  Object.assign(env, opts.env);
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
  const first = runHook('PostToolUse', 230_000, dir);
  assert.strictEqual(first.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(first.hookSpecificOutput.additionalContext, /past the 220K mark/);
  assert.strictEqual(runHook('PostToolUse', 232_000, dir), null);
  const next = runHook('PostToolUse', 251_000, dir);
  assert.ok(next && next.hookSpecificOutput.additionalContext);
});

test('PostToolUse: two sessions in the same band and state dir each speak once', () => {
  const dir = tmp('ctx-budget-s-');
  assert.ok(runHook('PostToolUse', 230_000, dir, { session: 'sess-a' }), 'session a speaks');
  assert.ok(runHook('PostToolUse', 231_000, dir, { session: 'sess-b' }), 'session b speaks despite a having spoken');
  assert.strictEqual(runHook('PostToolUse', 232_000, dir, { session: 'sess-a' }), null, 'session a stays quiet in its band');
  assert.strictEqual(runHook('PostToolUse', 233_000, dir, { session: 'sess-b' }), null, 'session b stays quiet in its band');
});

test('PostToolUse: a lower band after a compact is news (falling sequence)', () => {
  const dir = tmp('ctx-budget-s-');
  assert.ok(runHook('PostToolUse', 310_000, dir), '310K speaks');
  assert.ok(runHook('PostToolUse', 230_000, dir), '230K speaks again because the band changed');
  assert.strictEqual(runHook('PostToolUse', 232_000, dir), null, 'and is quiet within the new band');
});

test('PostToolUse: crossing WARN inside one band is news (the level changed)', () => {
  const dir = tmp('ctx-budget-s-');
  assert.match(runHook('PostToolUse', 205_000, dir).hookSpecificOutput.additionalContext, /goes out as text/);
  const warn = runHook('PostToolUse', 221_000, dir);
  assert.ok(warn, '221K is in the 200-225K band too, and still speaks');
  assert.match(warn.hookSpecificOutput.additionalContext, /past the 220K mark/);
  assert.strictEqual(runHook('PostToolUse', 223_000, dir), null);
});

test('PostToolUse below GATE_TEXT prints nothing', () => {
  const dir = tmp('ctx-budget-s-');
  assert.strictEqual(runHook('PostToolUse', 100_000, dir), null);
  assert.strictEqual(runHook('PostToolUse', 149_000, dir), null);
});

test('past GATE_TEXT and under WARN: the gate line, once per band on PostToolUse, never on Stop', () => {
  const dir = tmp('ctx-budget-s-');
  const line = /^\[context-budget\] ~(\d+)K \(under 220K; past 150K an owner gate goes out as text, then the turn ends\)\.$/;
  assert.match(runHook('UserPromptSubmit', 180_000, dir).hookSpecificOutput.additionalContext, line);
  assert.match(runHook('PostToolUse', 151_000, dir).hookSpecificOutput.additionalContext, line);
  assert.strictEqual(runHook('PostToolUse', 160_000, dir), null, 'quiet within the 150-175K band');
  assert.match(runHook('PostToolUse', 176_000, dir).hookSpecificOutput.additionalContext, line);
  assert.strictEqual(runHook('Stop', 180_000, dir), null);
});

test('past the limit on UserPromptSubmit: quotable figure, never a new session', () => {
  const out = runHook('UserPromptSubmit', 261_000, tmp('ctx-budget-s-'));
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /over the 260K budget \(harness file, "Context budget"\)/);
  assert.match(ctx, /can land on any turn/, 'no window is set, so nothing is claimed imminent');
  assert.match(ctx, /never ask for a new session/i);
});

test('Stop past WARN: systemMessage names the mark and never a new session', () => {
  const out = runHook('Stop', 221_000, tmp('ctx-budget-s-'));
  assert.match(out.systemMessage, /past 220K/);
  assert.doesNotMatch(out.systemMessage, /new session/i);
});

test('below GATE_TEXT: only UserPromptSubmit speaks', () => {
  const dir = tmp('ctx-budget-s-');
  assert.match(runHook('UserPromptSubmit', 100_000, dir).hookSpecificOutput.additionalContext, /^\[context-budget\] ~100K \(under 220K\)\.$/);
  assert.strictEqual(runHook('Stop', 100_000, dir), null);
  assert.strictEqual(runHook('PostToolUse', 100_000, dir), null);
});

console.log('\nharness context-budget: the limit follows the auto-compact window');

test('autoCompactWindow 300000 in the project: at 230K the warning names the 260K budget', () => {
  const project = settingsDir({ 'settings.json': { autoCompactWindow: 300000 } });
  const ctx = runHook('UserPromptSubmit', 230_000, tmp('ctx-budget-s-'), { cwd: project }).hookSpecificOutput.additionalContext;
  assert.match(ctx, /past the 220K mark; the budget is 260K \(40K under the 300K auto-compact window\)/);
  const over = runHook('UserPromptSubmit', 262_000, tmp('ctx-budget-s-'), { cwd: project }).hookSpecificOutput.additionalContext;
  assert.match(over, /over the 260K budget \(40K under the 300K auto-compact window\)\. Auto-compaction is imminent/);
});

test('a 400K window moves the limit to 360K: 300K is past the mark, not over', () => {
  const project = settingsDir({ 'settings.json': { autoCompactWindow: 400000 } });
  const ctx = runHook('UserPromptSubmit', 300_000, tmp('ctx-budget-s-'), { cwd: project }).hookSpecificOutput.additionalContext;
  assert.match(ctx, /past the 220K mark; the budget is 360K \(40K under the 400K auto-compact window\)/);
});

test('order: the window variable, then settings.local.json, settings.json and the user settings', () => {
  const both = settingsDir({ 'settings.local.json': { autoCompactWindow: 350000 }, 'settings.json': { autoCompactWindow: 300000 } });
  const home = settingsDir({ 'settings.json': { autoCompactWindow: 500000 } });
  const figure = (opts) => runHook('UserPromptSubmit', 230_000, tmp('ctx-budget-s-'), opts).hookSpecificOutput.additionalContext.match(/the budget is (\d+)K/)?.[1];
  assert.strictEqual(figure({ cwd: both, home }), '310', 'settings.local.json beats settings.json');
  assert.strictEqual(figure({ cwd: settingsDir({ 'settings.json': { autoCompactWindow: 300000 } }), home }), '260', 'the project beats the user');
  assert.strictEqual(figure({ home }), '460', 'the user settings when the project sets none');
  assert.strictEqual(figure({ cwd: both, home, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '450k' } }), '410', 'the variable beats every file, "450k" included');
  assert.strictEqual(figure({ home, env: { CLAUDE_PROJECT_DIR: both } }), '310', 'CLAUDE_PROJECT_DIR names the project too');
});

test('CLAUDE_CONFIG_DIR holds the user settings: its 200K window decides, not ~/.claude\'s', () => {
  const config = tmp('ctx-budget-c-');
  fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ autoCompactWindow: 200000 }));
  const home = settingsDir({ 'settings.json': { autoCompactWindow: 500000 } });
  const ctx = runHook('UserPromptSubmit', 170_000, tmp('ctx-budget-s-'), { home, env: { CLAUDE_CONFIG_DIR: config } }).hookSpecificOutput.additionalContext;
  assert.match(ctx, /over the 160K budget \(40K under the 200K auto-compact window\)/);
  const project = settingsDir({ 'settings.json': { autoCompactWindow: 300000 } });
  const figure = (opts) => runHook('UserPromptSubmit', 230_000, tmp('ctx-budget-s-'), opts).hookSpecificOutput.additionalContext.match(/the budget is (\d+)K/)?.[1];
  assert.strictEqual(figure({ cwd: project, home, env: { CLAUDE_CONFIG_DIR: config } }), '260', 'the project still beats the user');
  assert.strictEqual(figure({ home, env: { CLAUDE_CONFIG_DIR: '' } }), '460', 'an empty CLAUDE_CONFIG_DIR means ~/.claude');
});

test('a project "auto" ends the lookup: the user\'s window does not apply, the default 260K does', () => {
  const project = settingsDir({ 'settings.json': { autoCompactWindow: 'auto' } });
  const home = settingsDir({ 'settings.json': { autoCompactWindow: 500000 } });
  const ctx = runHook('UserPromptSubmit', 230_000, tmp('ctx-budget-s-'), { cwd: project, home }).hookSpecificOutput.additionalContext;
  assert.match(ctx, /the budget is 260K \(harness file, "Context budget"\)/);
});

test('an unreadable settings file is skipped; CONTEXT_BUDGET_LIMIT beats the window', () => {
  const project = settingsDir({ 'settings.json': '{ not json' });
  const home = settingsDir({ 'settings.json': { autoCompactWindow: 300000 } });
  const ctx = runHook('UserPromptSubmit', 230_000, tmp('ctx-budget-s-'), { cwd: project, home }).hookSpecificOutput.additionalContext;
  assert.match(ctx, /the budget is 260K \(40K under the 300K auto-compact window\)/);
  const pinned = runHook('UserPromptSubmit', 230_000, tmp('ctx-budget-s-'), { cwd: project, home, env: { CONTEXT_BUDGET_LIMIT: '280000' } });
  assert.match(pinned.hookSpecificOutput.additionalContext, /the budget is 280K \(harness file, "Context budget"\)/);
});

test('a 200K window pulls the warning down to its 160K limit', () => {
  const project = settingsDir({ 'settings.json': { autoCompactWindow: 200000 } });
  const ctx = runHook('UserPromptSubmit', 170_000, tmp('ctx-budget-s-'), { cwd: project }).hookSpecificOutput.additionalContext;
  assert.match(ctx, /over the 160K budget \(40K under the 200K auto-compact window\)/);
  const under = runHook('UserPromptSubmit', 140_000, tmp('ctx-budget-s-'), { cwd: project }).hookSpecificOutput.additionalContext;
  assert.match(under, /^\[context-budget\] ~140K \(under 160K\)\.$/);
});

console.log('\nharness context-budget: a compaction since the last reading');

function boundary(extra = {}) {
  return { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'manual', preTokens: 300000 }, ...extra };
}

test('a main-thread compaction after a 300K reading: no event speaks until the next reply', () => {
  const records = [{ type: 'user', message: { content: 'hi' } }, reading(300_000), boundary(), { type: 'user', message: { content: 'next' } }];
  for (const event of ['Stop', 'UserPromptSubmit', 'PostToolUse']) {
    assert.strictEqual(runHook(event, 0, tmp('ctx-budget-s-'), { records }), null, event);
  }
});

test('the first reply after the compaction is the figure', () => {
  const records = [reading(300_000), boundary(), { type: 'user', message: { content: 'next' } }, reading(120_000)];
  const out = runHook('UserPromptSubmit', 0, tmp('ctx-budget-s-'), { records });
  assert.match(out.hookSpecificOutput.additionalContext, /^\[context-budget\] ~120K \(under 220K\)\.$/);
});

test("a subagent's compaction, or a record that only names one, is not a boundary", () => {
  const markers = [boundary({ isSidechain: true }), { type: 'user', message: { content: 'compact_boundary' } }, { type: 'user', subtype: 'compact_boundary' }];
  for (const marker of markers) {
    const out = runHook('Stop', 0, tmp('ctx-budget-s-'), { records: [reading(300_000), marker] });
    assert.match(text(out), /Context 300K - over the 260K budget/, JSON.stringify(marker));
  }
});

console.log('\nharness context-budget: no hand-off wording');

test('no event/level combination recommends a new session or hand-off', () => {
  const banned = /(start|open|begin) a new session|new session at|or a new session|hand ?off/i;
  const bannedWide = /hand[- ]?(off|over)|(new|fresh) (session|conversation)/i;
  for (const event of ['Stop', 'UserPromptSubmit', 'PostToolUse']) {
    for (const tokens of [100_000, 180_000, 230_000, 420_000]) {
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
  assert.match(out.hookSpecificOutput.additionalContext, /^\[context-budget\] ~100K \(under 220K\)\.$/);
  const post = runHook('PostToolUse', 230_000, tmp('ctx-budget-s-'), { script });
  assert.match(post.hookSpecificOutput.additionalContext, /past the 220K mark/);
});

console.log('\nharness context-budget: mutation');

/** A copy of the shipped hook with one line replaced. */
function mutant(from, to) {
  const source = fs.readFileSync(BUDGET, 'utf8');
  assert.ok(source.includes(from), `not in the shipped file: ${from}`);
  const script = path.join(tmp('ctx-budget-m-'), 'context-budget.mjs');
  fs.writeFileSync(script, source.replace(from, to));
  return script;
}

test('mutation: a band comparison that never matches makes the second call print again', () => {
  const script = mutant('if (band === last.band && level === last.level) return false;', 'if (band !== band) return false;');
  const dir = tmp('ctx-budget-s-');
  assert.ok(runHook('PostToolUse', 230_000, dir, { script }));
  const second = runHook('PostToolUse', 232_000, dir, { script });
  assert.ok(second, 'the mutant prints a second time in the same band');
  // and the shipped file stays quiet for the same sequence
  const dir2 = tmp('ctx-budget-s-');
  runHook('PostToolUse', 230_000, dir2);
  assert.strictEqual(runHook('PostToolUse', 232_000, dir2), null);
});

test('mutation: a limit that ignores the window reads 300K as over a 260K budget under a 400K window', () => {
  const script = mutant('window ? window - MARGIN : DEFAULT_LIMIT', 'DEFAULT_LIMIT');
  const project = settingsDir({ 'settings.json': { autoCompactWindow: 400000 } });
  const out = runHook('UserPromptSubmit', 300_000, tmp('ctx-budget-s-'), { cwd: project, script });
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /the budget is 360K/, 'the mutant must lose the derived limit');
});

test('mutation: user settings read before the project make the project lose', () => {
  const script = mutant(
    'for (const file of [...files, join(env.CLAUDE_CONFIG_DIR || join(home, \'.claude\'), \'settings.json\')]) {',
    'for (const file of [join(env.CLAUDE_CONFIG_DIR || join(home, \'.claude\'), \'settings.json\'), ...files]) {'
  );
  const project = settingsDir({ 'settings.json': { autoCompactWindow: 300000 } });
  const home = settingsDir({ 'settings.json': { autoCompactWindow: 500000 } });
  const out = runHook('UserPromptSubmit', 230_000, tmp('ctx-budget-s-'), { cwd: project, home, script });
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /the budget is 260K/, 'the mutant must read the user window first');
});

test('mutation: a user lookup that ignores CLAUDE_CONFIG_DIR reads ~/.claude\'s window instead', () => {
  const script = mutant("join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json')", "join(home, '.claude', 'settings.json')");
  const config = tmp('ctx-budget-c-');
  fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ autoCompactWindow: 200000 }));
  const home = settingsDir({ 'settings.json': { autoCompactWindow: 500000 } });
  const out = runHook('UserPromptSubmit', 170_000, tmp('ctx-budget-s-'), { home, env: { CLAUDE_CONFIG_DIR: config }, script });
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /over the 160K budget/, 'the mutant must miss the config dir window');
});

test('mutation: a gate line on Stop too is caught (Stop stays quiet under WARN)', () => {
  const script = mutant(
    "if (event !== 'UserPromptSubmit' && !(event === 'PostToolUse' && ctx >= gate)) return null;",
    "if (event !== 'UserPromptSubmit' && !(event !== 'UserPromptSubmit' && ctx >= gate)) return null;"
  );
  assert.ok(runHook('Stop', 180_000, tmp('ctx-budget-s-'), { script }), 'the mutant speaks on Stop');
  assert.strictEqual(runHook('Stop', 180_000, tmp('ctx-budget-s-')), null);
});

test('mutation: a scan that reads past the compaction reports the size before it', () => {
  const script = mutant('if (isCompaction(line)) return null;', '');
  const records = [reading(300_000), boundary()];
  assert.ok(runHook('UserPromptSubmit', 0, tmp('ctx-budget-s-'), { records, script }), 'the mutant reports the stale 300K');
  assert.strictEqual(runHook('UserPromptSubmit', 0, tmp('ctx-budget-s-'), { records }), null);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
