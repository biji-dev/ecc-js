/**
 * Tests for the harness-bootstrap unit-cost template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'unit-cost-core.test.mjs');
const CORE_REL = path.join('lib', 'unit-cost-core.mjs');
const CLI_REL = 'unit-cost.mjs';
const SOURCES_REL = path.join('lib', 'run-sources.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 61;

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

/** Env with a fresh HOME and no GIT_* or CODEX_HOME variable; `extra` is applied last. */
function hermeticEnv(cleanup, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key === 'CODEX_HOME') delete env[key];
  env.HOME = tmp('unit-cost-suite-home-');
  cleanup.push(env.HOME);
  return { ...env, ...extra };
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(scriptsDir, cleanup, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(scriptsDir, TEST_REL)],
    { encoding: 'utf8', env: hermeticEnv(cleanup, extraEnv), timeout: 120_000 },
  );
}

/** Run the shipped CLI from `scriptsDir` with `cwd` as the working directory. */
function runCli(scriptsDir, args, cwd, cleanup) {
  return spawnSync(process.execPath, [path.join(scriptsDir, CLI_REL), ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv(cleanup),
    timeout: 60_000,
  });
}

const cleanup = [];

/** Copy the shipped scripts, apply a one-line mutation to the core (or `fileRel`), and assert the suite fails. */
function mutantFails(name, needle, replacement, fileRel = CORE_REL) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('unit-cost-mutant-');
    cleanup.push(copy);
    fs.cpSync(SCRIPTS, copy, { recursive: true });
    const filePath = path.join(copy, fileRel);
    const before = fs.readFileSync(filePath, 'utf8');
    const mutated = before.replace(needle, replacement);
    assert.notStrictEqual(mutated, before, 'the mutation did not apply');
    fs.writeFileSync(filePath, mutated);
    const res = runSuite(copy, cleanup);
    const out = res.stdout + res.stderr;
    assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
    assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
  });
}

console.log('\nharness-bootstrap unit-cost template');

test('the shipped unit-cost suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

mutantFails('pricing a 1h cache write at the 5m rate', 'export const CACHE_WRITE_1H = 2;', 'export const CACHE_WRITE_1H = 1.25;');
mutantFails('dropping the flat cache-write fallback', 'if (w1h + w5m === 0) w5m = num(usage.cache_creation_input_tokens);', '');
mutantFails('counting a repeated (message.id, requestId) twice', 'if (seen.has(r.key)) return false;', 'if (false) return false;');
mutantFails('counting synthetic turns', "if (msg.model === '<synthetic>') continue;", '');
mutantFails('ignoring the upper bound of the window', 'return (lo === null || ts >= lo) && (hi === null || ts <= hi);', 'return lo === null || ts >= lo;');
mutantFails('attributing subagent dollars to the main thread', 'out[r.kind] += r.cost;', 'out.main += r.cost;');
mutantFails('counting a quota delta across a reset', 'Math.abs(b.resetsAt - a.resetsAt) <= SAME_WINDOW_S', 'true');
mutantFails('counting a negative quota delta', 'if (i.hi <= i.lo) continue;', '');
mutantFails('counting overlapping quota intervals twice', 'if (l <= hi) hi = Math.max(hi, h);', 'if (false) hi = Math.max(hi, h);');
mutantFails('counting a reserved ledger row as a run', "if (NOT_RUN.has(String(e.outcome ?? e.status ?? '').toLowerCase())) {", 'if (false) {');
mutantFails('looking for the ledger under the worktree instead of the main checkout', "return path.join(path.dirname(common), dir, 'ledger.jsonl');", "return path.join(cwd, dir, 'ledger.jsonl');", SOURCES_REL);
mutantFails('printing the full report for --line', 'if (args.line)', 'if (false)', CLI_REL);
mutantFails('dropping the family-rate note for an unlisted model id', 'else if (r.exact === false) familyRated.add(r.model);', '');
mutantFails('accepting an unknown flag', '} else throw new Error(`unknown option ${t}`);', '}');
mutantFails('counting a background notice as a typed prompt', '(?:task-notification|local-command-stdout', '(?:local-command-stdout');
mutantFails('starting a prompt wait at any line instead of the last turn or result', "if (e.type === 'turn' || e.type === 'result') lastWork = e.ts;", 'lastWork = e.ts;');
mutantFails('counting overlapping waits twice', 'if (hi === null || a > hi) {', 'if (true) {');
mutantFails('reading a sidechain line as the main thread', 'if (!d || d.isSidechain) continue;', 'if (!d) continue;');
mutantFails('counting a compaction outside the window', "events.filter((e) => e.type === 'compact' && inWindow(e.ts, since, until))", "events.filter((e) => e.type === 'compact')");
mutantFails('taking a new session\'s first turn for an expiry rewrite', 'const prev = lastTurn.get(r.session);\n    lastTurn.set(r.session, r.ts);', 'const prev = lastTurn.get(0);\n    lastTurn.set(0, r.ts);');
mutantFails('placing a tagged subagent by its first turn', 'tag && (unit === null || tag.unit === unit) ? label(tag) : stepAt', 'false ? label(tag) : stepAt');
mutantFails("honouring another unit's tag", 'tag && (unit === null || tag.unit === unit) ? label(tag)', 'tag ? label(tag)');
mutantFails('dropping the dispatch description from the meta file', "description: typeof meta.description === 'string' ? meta.description : null,", 'description: null,', SOURCES_REL);
mutantFails('pairing waits over the window\'s events only', 'for (const e of all) {', 'for (const e of ev) {');
mutantFails('counting a wait\'s whole length instead of its part inside the wall', 'out.waitMs = unionMs(spans.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]));', 'out.waitMs = unionMs(spans);');
mutantFails('adding a step interval\'s whole length to its wall time', 'Math.max(0, Math.min(iv.end, winHi) - Math.max(iv.start, winLo))', 'iv.end - iv.start');
mutantFails('placing a subagent by its first turn inside the window', 'firstTurns(deduped, agentKey)', 'firstTurns(used, agentKey)');
mutantFails('counting an ask from before the window as unanswered', 'out.unanswered = [...asks.values()].filter((ts) => inWindow(ts, since, until)).length;', 'out.unanswered = asks.size;');
mutantFails('ignoring CLAUDE_CONFIG_DIR', 'process.env.CLAUDE_CONFIG_DIR || ', '', CLI_REL);
mutantFails('ending an open step at the window\'s last turn', 'const lastTs = deduped.reduce', 'const lastTs = used.reduce');
mutantFails('letting an unreadable time set a subagent\'s first turn', "if (r.kind !== 'sub' || !Number.isFinite(r.ts)) continue;", "if (r.kind !== 'sub') continue;");
mutantFails('taking a subagent rollout\'s copy of its parent\'s meta for its own', 'if (!state.meta) Object.assign(s, codexMeta(p));', 'Object.assign(s, codexMeta(p));');
mutantFails('counting a codex exec run as the host\'s', "host: id !== null && m.originator !== 'codex_exec' && src !== 'exec',", 'host: id !== null,');
mutantFails('holding an async question open until a result', 'if (!e.async) asks.set(e.id, e.ts);', 'asks.set(e.id, e.ts);');
mutantFails('taking the owner\'s reply to an async question for a line Codex wrote', 'const CODEX_INJECTED = /^\\s*<(?!send_user_message_question_reply>)/;', 'const CODEX_INJECTED = /^\\s*</;');
mutantFails('adding a running total instead of its growth', 'const before = prev?.[k] ?? 0;', 'const before = 0;');
mutantFails('counting the quota between two turns', 'if (cur && cur.seg === r.seg && Math.abs(r.resets - cur.reset) <= SAME_WINDOW_S) cur.hi = r.used;', 'if (cur && Math.abs(r.resets - cur.reset) <= SAME_WINDOW_S) cur.hi = r.used;');
mutantFails('leaving claude-run\'s dollars out of the cost', 'const total = claude.total + (claudeRuns?.usd ?? 0);', 'const total = claude.total;');
mutantFails('printing Claude\'s cache line for a Codex thread alone', 'if (texts.length || !threads.length) extra.cache = summarizeCache(rows, window);', 'extra.cache = summarizeCache(rows, window);', CLI_REL);
mutantFails('taking another thread\'s subagent', '(m.session === id || m.parent === id)', 'true', SOURCES_REL);
mutantFails('splitting a line at a read boundary', 'const data = Buffer.concat([rest, buf.subarray(0, n)]);', 'const data = Buffer.from(buf.subarray(0, n));', SOURCES_REL);

/** A synthetic projects dir (one session, one subagent) and a Codex ledger under a fresh temp root. */
function fixture() {
  const root = tmp('unit-cost-cli-');
  cleanup.push(root);
  const proj = path.join(root, 'projects', '-p-app');
  fs.mkdirSync(path.join(proj, 's1', 'subagents'), { recursive: true });
  const turn = (id, model, out) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-10-24T01:00:00Z',
      requestId: `req-${id}`,
      message: { id, model, usage: { input_tokens: 0, output_tokens: out } },
    });
  fs.writeFileSync(path.join(proj, 's1.jsonl'), `${turn('a', 'claude-opus-5-5', 1_000_000)}\n${turn('a', 'claude-opus-5-5', 1_000_000)}\n`);
  fs.writeFileSync(path.join(proj, 's1', 'subagents', 'agent-x.jsonl'), `${turn('b', 'claude-sonnet-5-5', 1_000_000)}\n`);
  fs.writeFileSync(path.join(proj, 's1', 'subagents', 'agent-x.meta.json'), JSON.stringify({ agentType: 'implementer' }));
  const run = { at: '2026-10-24T01:00:00Z', kind: 'review', cwd: '/p/app', ms: 10, limitsBefore: { usedPercent: 1, resetsAt: 5 }, limitsAfter: { usedPercent: 3, resetsAt: 5 } };
  fs.writeFileSync(path.join(root, 'ledger.jsonl'), `${JSON.stringify(run)}\n`);
  return root;
}

test('CLI smoke: a synthetic session prices main plus subagent, dedupes, and reads the ledger', () => {
  const root = fixture();
  const projects = path.join(root, 'projects');
  const res = runCli(SCRIPTS, ['--session', 's1', '--projects-dir', projects, '--ledger', path.join(root, 'ledger.jsonl'), '--json'], root, cleanup);
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.claude.turns, 2);
  assert.strictEqual(out.claude.main, 20);
  assert.strictEqual(out.claude.sub, 10);
  assert.strictEqual(out.claude.total, 30);
  assert.deepStrictEqual(out.claude.subagents, { implementer: 1 });
  assert.strictEqual(out.codex.percent, 2);
  assert.strictEqual(out.summary, 'Cost $30.00 · Claude 1.5% · Codex 2% (1 runs)');
  const text = runCli(SCRIPTS, ['--session', 's1', '--projects-dir', projects], root, cleanup);
  assert.ok(text.stdout.startsWith('Cost $30.00 · Claude 1.5% · Codex no ledger\n'), text.stdout);
});

test('CLI smoke: --line prints one summary line, and a session list sums its sessions', () => {
  const root = fixture();
  const projects = path.join(root, 'projects');
  const other = path.join(projects, '-p-other');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(
    path.join(other, 's2.jsonl'),
    `${JSON.stringify({ type: 'assistant', timestamp: '2026-10-24T01:00:00Z', requestId: 'req-z', message: { id: 'z', model: 'claude-opus-5-5', usage: { output_tokens: 1_000_000 } } })}\n`,
  );
  const res = runCli(SCRIPTS, ['--session', 's1,s2', '--projects-dir', projects, '--ledger', path.join(root, 'ledger.jsonl'), '--line'], root, cleanup);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, 'Cost $50.00 · Claude 2.5% · Codex 2% (1 runs)\n');
});

test('CLI smoke: a missing session and an unknown flag exit 2 with usage', () => {
  const root = fixture();
  const missing = runCli(SCRIPTS, ['--session', 'nope', '--projects-dir', path.join(root, 'projects')], root, cleanup);
  assert.strictEqual(missing.status, 2);
  assert.match(missing.stderr, /not found/);
  const bad = runCli(SCRIPTS, ['--session', 's1', '--wat'], root, cleanup);
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /usage: node scripts\/unit-cost\.mjs/);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
