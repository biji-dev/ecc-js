// harness-bootstrap codex-run tests (generated YYYY-MM-DD). Run: node --test scripts/lib/codex-run-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the tests read CATALOG, never a model literal.
// Hermetic: every spawned wrapper gets a temp HOME and CODEX_HOME and no CODEX_RUN* variable, so
// the developer's real ~/.codex quota can never change an outcome. No test needs a real codex binary.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../codex-run.mjs', import.meta.url));
import {
  CATALOG,
  CODEX_CANDIDATES,
  EXIT,
  MODELS,
  ROUTES,
  ROUTER_SCHEMA,
  RUN_MODES,
  budgetDecision,
  buildRouterPrompt,
  classify,
  codexArgv,
  codexBinary,
  formatTokens,
  freshestLimits,
  lastRateLimits,
  parseArgs,
  parseEvents,
  planRun,
  resolveRoute,
  runUsage,
  validateRouterAnswer,
  parsePorcelainZ,
  worktreeLeftovers,
} from './codex-run-core.mjs';
import { knownLimits, runCodex } from '../codex-run.mjs';

const tempDirs = [];
function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

// A stub `codex` first on PATH for every spawned run: a regression that drops CODEX_BIN (or lets a
// run through without one) reaches this script, which only records the call and exits 1, never the
// developer's real binary and its quota. The last test asserts the marker was never written.
const GUARD_DIR = tmpDir('codex-run-guard-');
const GUARD_MARKER = path.join(GUARD_DIR, 'codex-was-called');
fs.writeFileSync(
  path.join(GUARD_DIR, 'codex'),
  `#!/bin/sh\necho "$@" >> "${GUARD_MARKER}"\nexit 1\n`,
  { mode: 0o755 },
);

/**
 * Env for a spawned wrapper: fresh HOME and CODEX_HOME, no CODEX_RUN* or GIT_* variable, stub codex first on PATH.
 * The fresh HOME also keeps the CLI's own install path (CODEX_CANDIDATES under HOME) empty, so every test
 * that sets no CODEX_BIN still reaches the PATH stub, never a codex installed on this machine.
 */
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CODEX_RUN') || k.startsWith('GIT_')) delete env[k];
  delete env.CODEX_BIN;
  // Git sets GIT_DIR, GIT_WORK_TREE and an absolute GIT_INDEX_FILE inside hooks; a suite run from a
  // hook would otherwise write its fixture repos into the caller's repository. Only hermetic ones stay.
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.HOME = tmpDir('codex-run-home-');
  env.CODEX_HOME = tmpDir('codex-run-codexhome-');
  env.PATH = [GUARD_DIR, env.PATH].filter(Boolean).join(path.delimiter);
  return { ...env, ...extra };
}

/** An executable fake codex in its own temp dir (outside any repo under test). */
function fakeCodex(script) {
  const file = path.join(tmpDir('codex-run-fake-'), 'fake-codex.sh');
  fs.writeFileSync(file, script, { mode: 0o755 });
  return file;
}

test('table rows route by task, never the global default', () => {
  assert.deepEqual(
    (({ model, effort, sandbox, mode }) => ({ model, effort, sandbox, mode }))(
      resolveRoute('review'),
    ),
    { model: CATALOG.default, effort: 'high', sandbox: 'read-only', mode: 'review' },
  );
  assert.equal(resolveRoute('plan-blind').effort, 'xhigh');
  // A kind that writes never runs below high — not from the table, the router or an override.
  for (const kind of ['implement-cold', 'fix-cold', 'docs']) {
    assert.equal(resolveRoute(kind).effort, 'high', kind);
    const routed = resolveRoute(kind, { routed: { model: CATALOG.router, effort: 'low' } });
    assert.equal(routed.effort, 'high', kind);
    assert.match(routed.notes.join(' '), /below the write floor/);
    assert.equal(resolveRoute(kind, { override: { effort: 'medium' } }).effort, 'high', kind);
    assert.equal(resolveRoute(kind, { override: { effort: 'xhigh' } }).effort, 'xhigh', kind);
  }
  // Read-only kinds keep their low rows (the router, lane-a).
  assert.equal(resolveRoute('lane-a').effort, 'medium');
  assert.equal(resolveRoute('route').effort, 'low');
  assert.equal(resolveRoute('adversarial').effort, 'high');
  assert.equal(resolveRoute('adversarial', { critical: true }).effort, 'xhigh');
  assert.equal(resolveRoute('adversarial-frontier').model, CATALOG.frontier);
  assert.equal(resolveRoute('implement-cold').sandbox, 'workspace-write');
  assert.throws(() => resolveRoute('challenge'), /unknown kind "challenge"/);
});

test('the clamp bounds a router answer: ultra, frontier and a writable sandbox are not for sale', () => {
  const r = resolveRoute('investigate', {
    routed: { model: CATALOG.frontier, effort: 'ultra', sandbox: 'workspace-write' },
  });
  assert.equal(r.model, CATALOG.default);
  assert.equal(r.effort, 'xhigh');
  assert.equal(r.sandbox, 'read-only');
  assert.equal(r.notes.length, 3);

  const lifted = resolveRoute('investigate', {
    routed: { model: CATALOG.frontier, effort: 'ultra' },
    allowFrontier: true,
    allowUltra: true,
  });
  assert.equal(lifted.model, CATALOG.frontier);
  assert.equal(lifted.effort, 'ultra');

  assert.equal(
    resolveRoute('auto', { routed: { model: 'gpt-9', effort: 'huge' } }).model,
    CATALOG.default,
  );
  assert.equal(resolveRoute('auto', { routed: { model: 'gpt-9', effort: 'huge' } }).effort, 'high');
  assert.equal(
    resolveRoute('docs', { override: { model: CATALOG.router, effort: 'ultra' }, allowUltra: true })
      .effort,
    'max',
  );
});

test('max needs --allow-max: an override or a routed max drops to xhigh with a note', () => {
  const dropped = resolveRoute('investigate', { override: { effort: 'max' } });
  assert.equal(dropped.effort, 'xhigh');
  assert.match(dropped.notes.join(' '), /max needs --allow-max -> xhigh/);
  const routed = resolveRoute('investigate', { routed: { model: CATALOG.default, effort: 'max' } });
  assert.equal(routed.effort, 'xhigh');
  assert.match(routed.notes.join(' '), /max needs --allow-max -> xhigh/);
  // Lifted by --allow-max, or by --allow-ultra, which implies it.
  for (const lift of [{ allowMax: true }, { allowUltra: true }]) {
    const r = resolveRoute('investigate', { override: { effort: 'max' }, ...lift });
    assert.equal(r.effort, 'max', JSON.stringify(lift));
    assert.deepEqual(r.notes, []);
  }
  // Nothing below max is touched.
  assert.equal(resolveRoute('investigate', { override: { effort: 'xhigh' } }).effort, 'xhigh');
});

test('parseArgs takes --allow-max as a flag', () => {
  assert.equal(parseArgs(['investigate', '--allow-max']).flags.has('allow-max'), true);
});

test('an explicit override beats the router answer', () => {
  const r = resolveRoute('auto', {
    routed: { model: CATALOG.router, effort: 'low' },
    override: { effort: 'high' },
  });
  assert.equal(r.model, CATALOG.router);
  assert.equal(r.effort, 'high');
});

const ok = [
  '{"type":"thread.started","thread_id":"t-1"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"done"}}',
  '{"type":"turn.completed","usage":{"input_tokens":28629,"cached_input_tokens":20000,"output_tokens":40,"reasoning_output_tokens":7}}',
].join('\n');

// Shape captured from codex-cli 0.162.0 with `-m gpt-nope` (exit 1).
const refused = [
  '{"type":"thread.started","thread_id":"t-2"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `gpt-nope` not found. Defaulting to fallback metadata"}}',
  '{"type":"turn.started"}',
  '{"type":"error","message":"{\\"status\\":400,\\"error\\":{\\"message\\":\\"The \'gpt-nope\' model is not supported when using Codex with a ChatGPT account.\\"}}"}',
  '{"type":"turn.failed","error":{"message":"The \'gpt-nope\' model is not supported when using Codex with a ChatGPT account."}}',
].join('\n');

test('parseEvents sums usage and separates errors from warnings', () => {
  const e = parseEvents(ok);
  assert.equal(e.threadId, 't-1');
  assert.deepEqual(e.usage, {
    input: 28629,
    cached: 20000,
    output: 40,
    reasoning: 7,
    total: 28669,
  });
  assert.equal(e.failed, false);

  const f = parseEvents(refused);
  assert.equal(f.failed, true);
  assert.equal(f.warnings.length, 1);
  assert.match(f.errors[0], /gpt-nope' model is not supported/);
});

test('classify: a verdict counts only when non-empty and error-free, whatever the exit code', () => {
  assert.equal(classify({ exitCode: 0, events: parseEvents(ok), verdict: 'P1: …' }).exit, EXIT.ok);
  assert.equal(
    classify({ exitCode: 0, events: parseEvents(ok), verdict: '  \n' }).exit,
    EXIT.failed,
  );
  assert.equal(
    classify({ exitCode: 1, events: parseEvents(refused), verdict: '' }).exit,
    EXIT.failed,
  );
  // The old failure: usage limit printed, exit 0.
  const limit = parseEvents(
    '{"type":"error","message":"You\'ve hit your usage limit. Try again at Oct 7th, 2026 8:15 AM."}',
  );
  const c = classify({ exitCode: 0, events: limit, verdict: '' });
  assert.equal(c.exit, EXIT.unavailable);
  assert.match(c.reason, /usage limit/);
  assert.equal(
    classify({
      exitCode: 0,
      events: parseEvents(''),
      verdict: '',
      stderr: 'ERROR: refresh token was revoked',
    }).exit,
    EXIT.unavailable,
  );
  // A verdict that quotes the words "usage limit" (Codex reading our skill files) is not a failure.
  assert.equal(
    classify({
      exitCode: 0,
      events: parseEvents(ok),
      verdict: 'the skill says: usage limit → fallback',
    }).exit,
    EXIT.ok,
  );
});

test('lastRateLimits reads the newest weekly reading from a rollout', () => {
  const line = (pct) =>
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          primary: { used_percent: pct, window_minutes: 10080, resets_at: 1792649583 },
          secondary: null,
          plan_type: 'prolite',
        },
      },
    });
  const l = lastRateLimits(
    [line(25), '{"type":"event_msg","payload":{"type":"agent_message"}}', line(27)].join('\n'),
  );
  assert.deepEqual(l, {
    usedPercent: 27,
    windowMinutes: 10080,
    resetsAt: 1792649583,
    planType: 'prolite',
  });
  assert.equal(lastRateLimits('{"type":"session_meta"}'), null);
});

test('budget guard reserves non-essential kinds past the threshold, never the decorrelated checks', () => {
  const now = 1_000;
  const high = { usedPercent: 90, resetsAt: 2_000 };
  assert.equal(budgetDecision(resolveRoute('implement-cold'), high, { now }).run, false);
  assert.match(budgetDecision(resolveRoute('plan-blind'), high, { now }).reason, /90% ≥ 85%/);
  assert.equal(budgetDecision(resolveRoute('adversarial'), high, { now }).run, true);
  assert.equal(budgetDecision(resolveRoute('review'), high, { now }).run, true);
  assert.equal(
    budgetDecision(resolveRoute('implement-cold'), { usedPercent: 84, resetsAt: 2_000 }, { now })
      .run,
    true,
  );
  // A reading from a window that has already reset does not count.
  assert.equal(
    budgetDecision(resolveRoute('implement-cold'), { usedPercent: 99, resetsAt: 500 }, { now }).run,
    true,
  );
  assert.equal(budgetDecision(resolveRoute('implement-cold'), null, { now }).run, true);
});

test('a CLI argument error (stderr only, no events) is quoted in the failure reason', () => {
  const c = classify({
    exitCode: 2,
    events: parseEvents(''),
    verdict: '',
    stderr: "error: the argument '--base <BRANCH>' cannot be used with '[PROMPT]'\n\nUsage: …",
  });
  assert.equal(c.exit, EXIT.failed);
  assert.match(
    c.reason,
    /codex exit 2\): error: the argument '--base <BRANCH>' cannot be used with '\[PROMPT\]'/,
  );
});

test('F1: an interrupted review is a failed verdict even after turn.completed', () => {
  for (const verdict of [
    'Review was interrupted',
    '  review WAS interrupted. Please run it again.\n',
    'Review was interrupted: reviewer failed',
  ]) {
    const c = classify({ exitCode: 0, events: parseEvents(ok), verdict, mode: 'review' });
    assert.equal(c.exit, EXIT.failed);
    assert.match(c.reason, /interrupted review: ".*interrupted/i);
  }
  assert.equal(
    classify({
      exitCode: 0,
      events: parseEvents(ok),
      verdict: 'The code handles "Review was interrupted".',
      mode: 'review',
    }).exit,
    EXIT.ok,
  );
});

test('F2: completed turns recover retry errors and retain them as warnings', () => {
  for (const message of ['Reconnecting… 1/5', 'rate limit while reconnecting']) {
    const events = parseEvents(`${JSON.stringify({ type: 'error', message })}\n${ok}`);
    const c = classify({ exitCode: 0, events, verdict: 'No findings.' });
    assert.equal(c.exit, EXIT.ok);
    assert.ok(c.reason.includes(`warnings: ${message}`));
    const failed = parseEvents(
      `${JSON.stringify({ type: 'error', message })}\n${ok}\n${JSON.stringify({ type: 'turn.failed', error: { message: 'failed after completion' } })}`,
    );
    assert.notEqual(
      classify({ exitCode: 1, events: failed, verdict: 'stale verdict' }).exit,
      EXIT.ok,
    );
    assert.notEqual(
      classify({
        exitCode: 1,
        events: parseEvents(JSON.stringify({ type: 'error', message })),
        verdict: 'partial verdict',
      }).exit,
      EXIT.ok,
    );
  }
});

test('F3: budget readings use the later rollout mtime or ledger at', () => {
  const old = { limits: { usedPercent: 2 }, observedAt: Date.parse('2026-10-16T00:00:00Z') };
  const recent = { limits: { usedPercent: 98 }, observedAt: Date.parse('2026-10-17T00:00:00Z') };
  assert.deepEqual(freshestLimits(recent, old), recent.limits);
  assert.deepEqual(freshestLimits(old, recent), recent.limits);
  assert.deepEqual(freshestLimits(null, recent), recent.limits);
  assert.deepEqual(freshestLimits(recent, null), recent.limits);
  assert.equal(freshestLimits(null, null), null);
});

test('F3: a resumed rollout in an old date directory beats a stale ledger', (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-limits-test-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const sessions = path.join(scratch, 'sessions');
  const oldDir = path.join(sessions, '2020', '01', '01');
  fs.mkdirSync(oldDir, { recursive: true });
  const file = path.join(oldDir, 'rollout.jsonl');
  fs.writeFileSync(
    file,
    JSON.stringify({
      payload: { rate_limits: { secondary: { used_percent: 98, window_minutes: 10080 } } },
    }),
  );
  fs.utimesSync(file, new Date('2026-10-17T00:00:00Z'), new Date('2026-10-17T00:00:00Z'));
  const ledger = path.join(scratch, 'ledger.jsonl');
  fs.writeFileSync(
    ledger,
    JSON.stringify({ at: '2026-10-16T00:00:00Z', limitsAfter: { usedPercent: 2 } }),
  );
  assert.equal(knownLimits(ledger, sessions).usedPercent, 98);
  fs.writeFileSync(
    ledger,
    JSON.stringify({ at: '2026-10-18T00:00:00Z', limitsAfter: { usedPercent: 99 } }),
  );
  assert.equal(knownLimits(ledger, sessions).usedPercent, 99);
  fs.rmSync(file);
  assert.equal(knownLimits(ledger, sessions).usedPercent, 99);
});

test('F4: weekly usage follows window duration rather than primary position', () => {
  const short = { used_percent: 2, window_minutes: 300, resets_at: 2000 };
  const weekly = { used_percent: 98, window_minutes: 10080, resets_at: 3000 };
  const reading = (primary, secondary) =>
    lastRateLimits(JSON.stringify({ payload: { rate_limits: { primary, secondary } } }));
  assert.deepEqual(reading(short, weekly), {
    usedPercent: 98,
    windowMinutes: 10080,
    resetsAt: 3000,
    planType: null,
  });
  assert.equal(reading(weekly, short).usedPercent, 98);
  assert.equal(reading(short, { ...weekly, window_minutes: 600 }).windowMinutes, 600);
  assert.equal(reading(null, weekly).usedPercent, 98);
});

test('F5: router answers require a successful exit and catalog model and effort', () => {
  const answer = { model: CATALOG.router, effort: 'low', reason: 'mechanical task' };
  assert.deepEqual(validateRouterAnswer(0, answer), answer);
  assert.equal(validateRouterAnswer(1, answer), null);
  assert.equal(validateRouterAnswer(0, { ...answer, model: 'gpt-nope' }), null);
  assert.equal(validateRouterAnswer(0, { ...answer, effort: 'huge' }), null);
  assert.equal(validateRouterAnswer(0, null), null);
});

// Fake children and virtual time exercise lifecycle failures without ever invoking Codex.
function fakeRun(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-run-test-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  const signals = [];
  child.kill = (signal) => signals.push(signal);
  const result = runCodex([], {
    cwd: process.cwd(),
    stdin: '',
    logFile: path.join(scratch, 'out.log'),
    errFile: path.join(scratch, 'err.log'),
    timeoutMin: 1,
    spawnProcess: () => child,
  });
  return { child, signals, result };
}

test('F6: timeout escalates after 20 seconds and settles without close', async (t) => {
  const { child, signals, result } = fakeRun(t);
  t.mock.timers.tick(60_000);
  assert.deepEqual(signals, ['SIGTERM']);
  t.mock.timers.tick(19_999);
  assert.deepEqual(signals, ['SIGTERM']);
  t.mock.timers.tick(1);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  t.mock.timers.tick(1_000);
  assert.equal((await result).timedOut, true);
  child.emit('close', null, 'SIGKILL');
});

test('F6: timeout state comes from the timer rather than the exit signal', async (t) => {
  const { child, signals, result } = fakeRun(t);
  t.mock.timers.tick(60_000);
  child.emit('close', 0, null);
  assert.equal((await result).timedOut, true);
  t.mock.timers.tick(30_000);
  assert.deepEqual(signals, ['SIGTERM']);
});

test('F6: an external SIGTERM is not a wrapper timeout', async (t) => {
  const { child, signals, result } = fakeRun(t);
  child.emit('close', null, 'SIGTERM');
  assert.equal((await result).timedOut, false);
  t.mock.timers.tick(90_000);
  assert.deepEqual(signals, []);
});

test('F7: review argv pins read-only sandbox and the clamped review model', () => {
  const route = resolveRoute('review', { override: { model: CATALOG.frontier, effort: 'ultra' } });
  const argv = codexArgv(route, { base: 'HEAD', flags: new Set(['network']) }, 'review.md');
  assert.deepEqual(argv, [
    'exec',
    'review',
    '--base',
    'HEAD',
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    `review_model="${CATALOG.default}"`,
    '-m',
    CATALOG.default,
    '-c',
    'model_reasoning_effort="xhigh"',
    '--json',
    '-o',
    'review.md',
  ]);
});

test('F8: zero parent review usage is null and prints tokens=?', () => {
  const zero = parseEvents(
    '{"type":"turn.completed","usage":{"input_tokens":0,"output_tokens":0}}',
  ).usage;
  assert.equal(runUsage('review', zero), null);
  assert.equal(formatTokens(runUsage('review', zero)?.total ?? null), '?');
  assert.equal(runUsage('exec', zero), zero);
  assert.equal(runUsage('review', parseEvents(ok).usage).total, 28669);
});

test('F9: invalid threshold and timeout flags are usage errors', () => {
  for (const value of ['abc', 'NaN', 'Infinity', '0', '-1', '101', '']) {
    assert.throws(() => parseArgs(['docs', '--threshold', value]), /--threshold/);
  }
  for (const value of ['abc', 'NaN', 'Infinity', '0', '-1', '', '999999999']) {
    assert.throws(() => parseArgs(['docs', '--timeout-min', value]), /--timeout-min/);
  }
  for (const flag of ['--threshold', '--timeout-min']) {
    const res = spawnSync(process.execPath, [RUNNER, 'docs', flag, 'abc', '--dry-run'], {
      encoding: 'utf8',
      cwd: os.tmpdir(),
      env: cleanEnv(),
    });
    assert.equal(res.status, EXIT.usage);
    assert.ok(res.stderr.includes(flag));
  }
  assert.equal(parseArgs(['docs', '--threshold', '100', '--timeout-min', '0.5']).timeoutMin, 0.5);
  assert.equal(parseArgs(['docs', '--threshold', '1']).threshold, 1);
});

test('F10: reserved auto and routed kinds never call the router', async () => {
  const limits = { usedPercent: 98, resetsAt: Date.now() / 1000 + 3600 };
  for (const argv of [['auto'], ['investigate', '--route']]) {
    const plan = await planRun(parseArgs(argv), limits, () =>
      assert.fail('reserved task spent a router call'),
    );
    assert.equal(plan.budget.run, false);
    assert.equal(plan.route.model, CATALOG.default);
  }
  const answer = { model: CATALOG.router, effort: 'low', reason: 'small' };
  assert.equal(
    (await planRun(parseArgs(['auto']), null, async () => answer)).route.model,
    answer.model,
  );
  assert.equal(
    (
      await planRun(parseArgs(['auto', '--dry-run']), null, () =>
        assert.fail('dry run called router'),
      )
    ).budget.run,
    true,
  );
});

test('F11: missing codex binary is unavailable with its exact path', async (t) => {
  const { child, result } = fakeRun(t);
  child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
  const res = await result;
  assert.equal(res.code, 127);
  assert.equal(res.spawnError, 'ENOENT');
  assert.deepEqual(
    classify({
      exitCode: res.code,
      spawnError: res.spawnError,
      binary: '/missing/codex',
      events: parseEvents(''),
      verdict: '',
    }),
    {
      outcome: 'unavailable',
      exit: EXIT.unavailable,
      reason: 'codex binary not found: /missing/codex',
    },
  );
  assert.equal(
    classify({
      exitCode: 127,
      spawnError: 'EACCES',
      binary: '/denied/codex',
      events: parseEvents(''),
      verdict: '',
    }).exit,
    EXIT.failed,
  );
});

test('run through a symlinked path the wrapper still runs (it used to exit 0 silently)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-run-link-'));
  const link = path.join(dir, 'scripts');
  fs.symlinkSync(path.dirname(RUNNER), link);
  try {
    const res = spawnSync(
      process.execPath,
      [path.join(link, 'codex-run.mjs'), 'docs', '--threshold', 'abc', '--dry-run'],
      { encoding: 'utf8', env: cleanEnv() },
    );
    assert.equal(res.status, EXIT.usage);
    assert.ok(res.stderr.includes('--threshold'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an interrupted review caused by quota is unavailable, not "fix the call"', () => {
  const events = parseEvents(
    '{"type":"error","message":"You\'ve hit your usage limit."}\n{"type":"turn.completed","usage":{}}',
  );
  assert.equal(
    classify({
      exitCode: 0,
      events,
      verdict: 'Review was interrupted. Please re-run.',
      mode: 'review',
    }).exit,
    EXIT.unavailable,
  );
  assert.equal(
    classify({
      exitCode: 0,
      events: parseEvents('{"type":"turn.completed","usage":{}}'),
      verdict: 'Review was interrupted.',
      mode: 'review',
    }).exit,
    EXIT.failed,
  );
});

test('CODEX_RUN: essential keeps only the decorrelated checks, off reserves everything', () => {
  const fresh = { usedPercent: 5, resetsAt: Date.now() / 1000 + 3600 };
  const run = (kind, mode) => budgetDecision(resolveRoute(kind), fresh, { mode }).run;
  for (const kind of ['review', 'adversarial', 'adversarial-frontier']) {
    assert.equal(run(kind, 'essential'), true, kind);
    assert.equal(run(kind, 'off'), false, kind);
  }
  for (const kind of ['implement-cold', 'docs', 'plan-blind', 'ui-review', 'auto']) {
    assert.equal(run(kind, 'essential'), false, kind);
    assert.equal(run(kind, 'on'), true, kind);
  }
  assert.match(
    budgetDecision(resolveRoute('review'), null, { mode: 'off' }).reason,
    /CODEX_RUN=off/,
  );
});

test('CODEX_RUN and CODEX_RUN_THRESHOLD come from env; a typo is a usage error, never "on"', async () => {
  assert.equal(parseArgs(['docs']).mode, 'on');
  assert.equal(parseArgs(['docs'], { CODEX_RUN: 'essential' }).mode, 'essential');
  assert.throws(() => parseArgs(['docs'], { CODEX_RUN: 'of' }), /CODEX_RUN must be one of/);
  assert.equal(parseArgs(['docs'], { CODEX_RUN_THRESHOLD: '70' }).threshold, 70);
  assert.equal(
    parseArgs(['docs', '--threshold', '90'], { CODEX_RUN_THRESHOLD: '70' }).threshold,
    90,
  );
  assert.throws(() => parseArgs(['docs'], { CODEX_RUN_THRESHOLD: 'x' }), /CODEX_RUN_THRESHOLD/);
  const plan = await planRun(parseArgs(['auto'], { CODEX_RUN: 'off' }), null, () =>
    assert.fail('switched-off run spent a router call'),
  );
  assert.equal(plan.budget.run, false);
});

test('CODEX_RUN=off: the wrapper exits 4 and writes a reserved ledger row', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-run-off-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'p.md'), 'x');
  const res = spawnSync(
    process.execPath,
    [RUNNER, 'review', '--base', 'HEAD', '--out', path.join(dir, 'v.md'), '--cwd', dir],
    {
      encoding: 'utf8',
      cwd: dir,
      env: cleanEnv({ CODEX_RUN: 'off', CODEX_BIN: '/nonexistent' }),
    },
  );
  assert.equal(res.status, EXIT.reserved);
  assert.match(res.stdout, /reserved kind=review — CODEX_RUN=off/);
  const row = JSON.parse(fs.readFileSync(path.join(dir, '.codex-runs/ledger.jsonl'), 'utf8'));
  assert.equal(row.outcome, 'reserved');
});

test('ui-review: screenshots attach one --image= each, before -m, and never swallow the stdin dash', () => {
  const route = resolveRoute('ui-review');
  assert.deepEqual(
    [route.model, route.effort, route.sandbox],
    [CATALOG.default, 'high', 'read-only'],
  );
  const a = parseArgs(['ui-review', '--image', '/s/390.png', '/s/1280.png', '--out', 'v.md']);
  assert.deepEqual(a.images, ['/s/390.png', '/s/1280.png']);
  const argv = codexArgv(route, { ...a, cwd: '/w' }, 'v.md');
  assert.equal(argv.at(-1), '-');
  const m = argv.indexOf('-m');
  assert.deepEqual(argv.slice(m - 2, m), ['--image=/s/390.png', '--image=/s/1280.png']);
  const res = spawnSync(
    process.execPath,
    [RUNNER, 'review', '--base', 'HEAD', '--image', RUNNER, '--out', 'v.md', '--dry-run'],
    { encoding: 'utf8', cwd: os.tmpdir(), env: cleanEnv() },
  );
  assert.equal(res.status, EXIT.usage);
  assert.match(res.stderr, /review takes no --image/);
});

test('parsePorcelainZ keeps a leading-space first entry and skips a rename source', () => {
  assert.deepEqual(parsePorcelainZ(' M apps/a.tsx\0R  new name.ts\0old.ts\0?? b.ts\0'), {
    'apps/a.tsx': ' M',
    'new name.ts': 'R ',
    'b.ts': '??',
  });
  assert.deepEqual(parsePorcelainZ(''), {});
});

test('worktreeLeftovers: status or content change counts, untouched earlier dirt does not', () => {
  const left = worktreeLeftovers({
    before: { 'y.ts': { status: ' M', hash: 'y1' }, 'z.ts': { status: ' M', hash: 'z1' } },
    after: {
      'y.ts': { status: ' M', hash: 'y1' },
      'z.ts': { status: ' M', hash: 'z2' },
      'a.ts': { status: ' M', hash: 'a1' },
    },
    headBefore: 'aaaaaaaaaaaa',
    headAfter: 'bbbbbbbbbbbb',
  });
  assert.deepEqual(left, {
    files: ['z.ts', 'a.ts'],
    dirtyBefore: ['z.ts'],
    commits: 'aaaaaaaaa..bbbbbbbbb',
  });
  assert.deepEqual(worktreeLeftovers({ before: {}, after: {}, headBefore: 'a', headAfter: 'a' }), {
    files: [],
    dirtyBefore: [],
    commits: null,
  });
});

test('a write run that dies mid-slice reports its leftovers, earlier dirt flagged, own files excluded', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-run-left-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = cleanEnv({ CODEX_RUN: 'on' });
  const sh = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env });
  const commit = (m) =>
    sh(
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      m,
    );
  sh('init', '-q', '-b', 'main');
  for (const f of ['a.ts', 'y.ts', 'z.ts']) fs.writeFileSync(path.join(dir, f), 'base\n');
  const fake = path.join(dir, 'fake-codex.sh');
  // a.ts sorts first: its porcelain line starts with a space (the trimmed-first-line bug)
  fs.writeFileSync(
    fake,
    '#!/bin/sh\necho half >> a.ts\necho more >> z.ts\necho new > n.ts\necho quota >&2\nexit 1\n',
  );
  fs.chmodSync(fake, 0o755);
  fs.writeFileSync(path.join(dir, 'p.md'), 'slice');
  sh('add', '.');
  commit('base');
  fs.writeFileSync(path.join(dir, 'y.ts'), 'owner wip, untouched\n');
  fs.writeFileSync(path.join(dir, 'z.ts'), 'owner wip\n');
  const res = spawnSync(
    process.execPath,
    [RUNNER, 'implement-cold', '--prompt', 'p.md', '--out', path.join(dir, 'out/v.md')],
    { encoding: 'utf8', cwd: dir, env: { ...env, CODEX_BIN: fake } },
  );
  assert.notEqual(res.status, EXIT.ok);
  assert.match(res.stdout, /uncommitted=3 dirty-before=1/);
  const ledger = path.join(dir, '.codex-runs/ledger.jsonl');
  const row = JSON.parse(fs.readFileSync(ledger, 'utf8').trim().split('\n').at(-1));
  assert.deepEqual(row.leftovers.files.sort(), ['a.ts', 'n.ts', 'z.ts']);
  assert.deepEqual(row.leftovers.dirtyBefore, ['z.ts']);
});

test('usage: empty CODEX_RUN_THRESHOLD is unset; ui-review needs existing screenshots', () => {
  assert.equal(parseArgs(['docs'], { CODEX_RUN_THRESHOLD: '' }).threshold, 85);
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [RUNNER, 'ui-review', '--prompt', RUNNER, '--out', 'v.md', ...args],
      {
        encoding: 'utf8',
        cwd: os.tmpdir(),
        env: cleanEnv(),
      },
    );
  let res = run();
  assert.equal(res.status, EXIT.usage);
  assert.match(res.stderr, /ui-review needs --image/);
  res = run('--image', '/nonexistent/390.png');
  assert.equal(res.status, EXIT.usage);
  assert.match(res.stderr, /does not exist/);
});

test('CATALOG is the only source of model names: every route and the router schema stay inside it', () => {
  assert.deepEqual(Object.keys(CATALOG).sort(), ['default', 'frontier', 'previous', 'router']);
  assert.deepEqual(MODELS, Object.values(CATALOG));
  assert.equal(new Set(MODELS).size, MODELS.length);
  for (const [kind, row] of Object.entries(ROUTES)) assert.ok(MODELS.includes(row.model), kind);
  assert.deepEqual(ROUTER_SCHEMA.properties.model.enum, MODELS);
  assert.deepEqual(RUN_MODES, ['on', 'essential', 'off']);
  // Only the frontier kind may use the frontier model out of the box.
  assert.deepEqual(
    Object.entries(ROUTES)
      .filter(([, row]) => row.model === CATALOG.frontier)
      .map(([kind]) => kind),
    ['adversarial-frontier'],
  );
});

test('the frontier model needs its own kind or --allow-frontier; the retired names are gone', () => {
  const clamped = resolveRoute('adversarial', { override: { model: CATALOG.frontier } });
  assert.equal(clamped.model, CATALOG.default);
  assert.match(clamped.notes.join(' '), /--allow-frontier/);
  assert.equal(
    resolveRoute('adversarial', { override: { model: CATALOG.frontier }, allowFrontier: true })
      .model,
    CATALOG.frontier,
  );
  assert.equal(parseArgs(['adversarial', '--allow-frontier']).flags.has('allow-frontier'), true);
  // Built from parts so this file never spells the retired names.
  const retired = 'astra';
  assert.throws(
    () => parseArgs(['adversarial', `--allow-${retired}`]),
    new RegExp(`unknown option --allow-${retired}`),
  );
  assert.throws(() => resolveRoute(`adversarial-${retired}`), /unknown kind/);
  assert.match(buildRouterPrompt('auto', 'x'), new RegExp(CATALOG.frontier));
  assert.match(buildRouterPrompt('auto', 'x'), /adversarial-frontier/);
});

/** Run the wrapper in a scratch dir; --dry-run unless the case needs a real run. */
function runWrapper(dir, args, env = {}) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    cwd: dir,
    env: cleanEnv(env),
  });
}

test('--dry-run spends nothing: default binary is `codex` on PATH, no ledger row, no verdict', () => {
  const dir = tmpDir('codex-run-dry-');
  fs.writeFileSync(path.join(dir, 'p.md'), 'task');
  const res = runWrapper(dir, ['adversarial', '--prompt', 'p.md', '--out', 'v.md', '--dry-run']);
  assert.equal(res.status, EXIT.ok, res.stderr);
  const plan = JSON.parse(res.stdout);
  assert.equal(plan.argv[0], 'codex');
  assert.equal(plan.route.model, CATALOG.default);
  assert.equal(plan.promptBytes, 4);
  assert.equal(fs.existsSync(path.join(dir, '.codex-runs')), false);
  assert.equal(fs.existsSync(path.join(dir, 'v.md')), false);
  const bin = runWrapper(
    dir,
    ['adversarial', '--prompt', 'p.md', '--out', 'v.md', '--dry-run'],
    { CODEX_BIN: '/elsewhere/codex' },
  );
  assert.equal(JSON.parse(bin.stdout).argv[0], '/elsewhere/codex');
});

test('codexBinary: CODEX_BIN, then the CLI install paths under HOME, then codex on PATH', () => {
  assert.ok(CODEX_CANDIDATES.length > 0 && CODEX_CANDIDATES.every((c) => !c.startsWith('/')));
  const first = `/h/u/${CODEX_CANDIDATES[0]}`;
  const present = (...files) => (p) => files.includes(p);
  // CODEX_BIN wins over a present candidate.
  assert.equal(codexBinary({ CODEX_BIN: '/x/codex' }, '/h/u', present(first)), '/x/codex');
  // A present candidate beats PATH.
  assert.equal(codexBinary({}, '/h/u', present(first)), first);
  // No candidate present: PATH.
  assert.equal(codexBinary({}, '/h/u', present()), 'codex');
  // An empty CODEX_BIN reads as unset, both ways.
  assert.equal(codexBinary({ CODEX_BIN: '' }, '/h/u', present(first)), first);
  assert.equal(codexBinary({ CODEX_BIN: '' }, '/h/u', present()), 'codex');
  // Candidates are tried in order, under the home directory given.
  const seen = [];
  codexBinary({}, '/h/u', (p) => (seen.push(p), false));
  assert.deepEqual(seen, CODEX_CANDIDATES.map((c) => `/h/u/${c}`));
});

test('--dry-run runs the CLI installed under HOME before a codex shim on PATH; CODEX_BIN beats both', () => {
  const dir = tmpDir('codex-run-installed-');
  fs.writeFileSync(path.join(dir, 'p.md'), 'task');
  const home = tmpDir('codex-run-installed-home-');
  const installed = path.join(home, CODEX_CANDIDATES[0]);
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  // Only records a call; the run is a dry run, so it is never called.
  fs.writeFileSync(installed, `#!/bin/sh\necho "$@" >> "${GUARD_MARKER}"\nexit 1\n`, { mode: 0o755 });
  const args = ['adversarial', '--prompt', 'p.md', '--out', 'v.md', '--dry-run'];
  const res = runWrapper(dir, args, { HOME: home });
  assert.equal(res.status, EXIT.ok, res.stderr);
  assert.equal(JSON.parse(res.stdout).argv[0], installed);
  const bin = runWrapper(dir, args, { HOME: home, CODEX_BIN: '/elsewhere/codex' });
  assert.equal(JSON.parse(bin.stdout).argv[0], '/elsewhere/codex');
  // A candidate that is not executable is passed over.
  fs.chmodSync(installed, 0o644);
  assert.equal(JSON.parse(runWrapper(dir, args, { HOME: home }).stdout).argv[0], 'codex');
});

test('--dry-run --effort max prints xhigh; with --allow-max it prints max', () => {
  const dir = tmpDir('codex-run-allowmax-');
  fs.writeFileSync(path.join(dir, 'p.md'), 'task');
  const args = ['investigate', '--prompt', 'p.md', '--out', 'v.md', '--dry-run', '--effort', 'max'];
  const clamped = runWrapper(dir, args);
  assert.equal(clamped.status, EXIT.ok, clamped.stderr);
  assert.equal(JSON.parse(clamped.stdout).route.effort, 'xhigh');
  const lifted = runWrapper(dir, [...args, '--allow-max']);
  assert.equal(lifted.status, EXIT.ok, lifted.stderr);
  assert.equal(JSON.parse(lifted.stdout).route.effort, 'max');
});

test('a missing codex binary exits 3 (unavailable) and writes an unavailable ledger row', () => {
  const dir = tmpDir('codex-run-missing-');
  fs.writeFileSync(path.join(dir, 'p.md'), 'task');
  const missing = path.join(dir, 'no-such-codex');
  const res = runWrapper(
    dir,
    ['investigate', '--prompt', 'p.md', '--out', path.join(dir, 'v.md'), '--cwd', dir],
    { CODEX_BIN: missing },
  );
  assert.equal(res.status, EXIT.unavailable, res.stdout + res.stderr);
  assert.match(res.stdout, /codex-run: unavailable kind=investigate/);
  assert.ok(res.stdout.includes(`codex binary not found: ${missing}`));
  const row = JSON.parse(fs.readFileSync(path.join(dir, '.codex-runs/ledger.jsonl'), 'utf8'));
  assert.equal(row.outcome, 'unavailable');
});

test('the budget guard reads CODEX_HOME rollouts: past the threshold non-essential kinds exit 4, essential ones run', () => {
  const dir = tmpDir('codex-run-budget-');
  const codexHome = tmpDir('codex-run-budget-home-');
  const day = path.join(codexHome, 'sessions', '2030', '01', '01');
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(
    path.join(day, 'rollout.jsonl'),
    JSON.stringify({
      payload: {
        rate_limits: {
          primary: {
            used_percent: 99,
            window_minutes: 10080,
            resets_at: Math.floor(Date.now() / 1000) + 3600,
          },
        },
      },
    }),
  );
  fs.writeFileSync(path.join(dir, 'p.md'), 'task');
  const args = (kind) => [kind, '--prompt', 'p.md', '--out', path.join(dir, 'v.md'), '--cwd', dir];
  const reserved = runWrapper(dir, args('docs'), { CODEX_HOME: codexHome });
  assert.equal(reserved.status, EXIT.reserved, reserved.stdout + reserved.stderr);
  assert.match(reserved.stdout, /reserved kind=docs — weekly 99% ≥ 85%/);
  // Essential kinds are never reserved by the guard.
  for (const kind of ['adversarial', 'adversarial-frontier']) {
    const plan = runWrapper(dir, [...args(kind), '--dry-run'], { CODEX_HOME: codexHome });
    assert.equal(plan.status, EXIT.ok, plan.stderr);
    assert.equal(JSON.parse(plan.stdout).budget.run, true, kind);
  }
  // A higher threshold lets the same reading through.
  const raised = runWrapper(dir, [...args('docs'), '--threshold', '100', '--dry-run'], {
    CODEX_HOME: codexHome,
  });
  assert.equal(JSON.parse(raised.stdout).budget.run, true);
});

/** A repo-shaped fixture: the shipped wrapper and core copied to <repo>/scripts, nothing else. */
function wrapperFixture({ resolver } = {}) {
  const repo = tmpDir('codex-run-rules-');
  fs.mkdirSync(path.join(repo, 'scripts/lib'), { recursive: true });
  fs.copyFileSync(RUNNER, path.join(repo, 'scripts/codex-run.mjs'));
  fs.copyFileSync(
    fileURLToPath(new URL('./codex-run-core.mjs', import.meta.url)),
    path.join(repo, 'scripts/lib/codex-run-core.mjs'),
  );
  fs.writeFileSync(path.join(repo, 'task.md'), 'the task');
  if (resolver !== undefined)
    fs.writeFileSync(path.join(repo, 'scripts/check-agent-docs.mjs'), resolver);
  return repo;
}

function dryRunInFixture(repo, extra, env = {}) {
  return spawnSync(
    process.execPath,
    [
      path.join(repo, 'scripts/codex-run.mjs'),
      'adversarial',
      '--prompt',
      'task.md',
      '--out',
      'v.md',
      '--dry-run',
      ...extra,
    ],
    { encoding: 'utf8', cwd: repo, env: cleanEnv(env) },
  );
}

test('--rules-for appends the resolver-selected rule files to the prompt', () => {
  const rule = '# Rule\nAlways validate input at the boundary.\n';
  // The stub proves the call shape: it fails unless argv[2] is the configured flag.
  const repo = wrapperFixture({
    resolver:
      "if (process.argv[2] !== '--rules-for') process.exit(9);\nconsole.log('rules/area.md');\n",
  });
  fs.mkdirSync(path.join(repo, 'rules'));
  fs.writeFileSync(path.join(repo, 'rules/area.md'), rule);
  const without = JSON.parse(dryRunInFixture(repo, []).stdout);
  const withRules = dryRunInFixture(repo, ['--rules-for', 'src/a.ts', 'src/b.ts']);
  assert.equal(withRules.status, EXIT.ok, withRules.stderr);
  const added = JSON.parse(withRules.stdout).promptBytes - without.promptBytes;
  // The section carries the rule file's whole text plus its heading.
  assert.ok(added >= Buffer.byteLength(rule) + 'rules/area.md'.length, `added ${added} bytes`);
  assert.ok(added < Buffer.byteLength(rule) + 400, `added ${added} bytes`);
});

test('--rules-for with a resolver that selects nothing leaves the prompt unchanged', () => {
  const repo = wrapperFixture({ resolver: '' });
  const without = JSON.parse(dryRunInFixture(repo, []).stdout);
  const withRules = JSON.parse(dryRunInFixture(repo, ['--rules-for', 'src/a.ts']).stdout);
  assert.equal(withRules.promptBytes, without.promptBytes);
});

test('--rules-for without the resolver is a usage error, never a silent skip', () => {
  const repo = wrapperFixture();
  const res = dryRunInFixture(repo, ['--rules-for', 'src/a.ts']);
  assert.equal(res.status, EXIT.usage);
  assert.match(res.stderr, /--rules-for needs the rule resolver scripts\/check-agent-docs\.mjs/);
  // Without --rules-for the same fixture runs fine: the resolver is only needed on request.
  assert.equal(dryRunInFixture(repo, []).status, EXIT.ok);
});

test('--rules-for puts the rule file text in the prompt: the prompt grows by exactly the rule bytes', () => {
  // The first test above cannot tell the text from the section header; this one differences two
  // runs that share every header byte and differ only in the rule body.
  const body = 'RULE-SENTINEL ' + 'x'.repeat(200);
  const promptBytes = (ruleText) => {
    const repo = wrapperFixture({ resolver: "console.log('rules/area.md');\n" });
    fs.mkdirSync(path.join(repo, 'rules'));
    fs.writeFileSync(path.join(repo, 'rules/area.md'), ruleText);
    const res = dryRunInFixture(repo, ['--rules-for', 'src/a.ts']);
    assert.equal(res.status, EXIT.ok, res.stderr);
    return JSON.parse(res.stdout).promptBytes;
  };
  assert.equal(promptBytes(body) - promptBytes(''), Buffer.byteLength(body));
});

test('the rule resolver runs on the wrapper\'s own node, never the `node` on PATH', () => {
  // A machine whose PATH `node` is another version (a version manager, a shim) must not run it.
  const shimDir = tmpDir('codex-run-nodeshim-');
  const marker = path.join(shimDir, 'node-was-called');
  fs.writeFileSync(path.join(shimDir, 'node'), `#!/bin/sh\necho "$@" >> "${marker}"\nexit 1\n`, {
    mode: 0o755,
  });
  const rule = '# Rule\nAlways validate input at the boundary.\n';
  const repo = wrapperFixture({ resolver: "console.log('rules/area.md');\n" });
  fs.mkdirSync(path.join(repo, 'rules'));
  fs.writeFileSync(path.join(repo, 'rules/area.md'), rule);
  const without = JSON.parse(dryRunInFixture(repo, []).stdout);
  // cleanEnv's extra replaces PATH whole, so the codex stub (GUARD_DIR) stays first.
  const PATH = [GUARD_DIR, shimDir, process.env.PATH].filter(Boolean).join(path.delimiter);
  const res = dryRunInFixture(repo, ['--rules-for', 'src/a.ts'], { PATH });
  assert.equal(res.status, EXIT.ok, res.stderr);
  assert.ok(JSON.parse(res.stdout).promptBytes - without.promptBytes >= Buffer.byteLength(rule));
  assert.equal(fs.existsSync(marker), false, 'the resolver ran on the PATH node');
});

test('the prompt reaches codex on stdin, byte for byte', () => {
  const dir = tmpDir('codex-run-stdin-');
  const prompt = 'line one of the task\nline two\n';
  fs.writeFileSync(path.join(dir, 'p.md'), prompt);
  // Copies stdin into the -o verdict file; a wrapper that sends nothing leaves an empty verdict.
  const fake = fakeCodex(
    '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done\ncat > "$out"\nexit 0\n',
  );
  const verdict = path.join(dir, 'v.md');
  const res = runWrapper(
    dir,
    ['investigate', '--prompt', 'p.md', '--out', verdict, '--cwd', dir],
    { CODEX_BIN: fake },
  );
  assert.equal(res.status, EXIT.ok, res.stdout + res.stderr);
  assert.equal(fs.readFileSync(verdict, 'utf8'), prompt);
});

test('a run that outlives --timeout-min is failed, with a ledger row that says it timed out', () => {
  const dir = tmpDir('codex-run-timeout-');
  fs.writeFileSync(path.join(dir, 'p.md'), 'task');
  const fake = fakeCodex('#!/bin/sh\nexec sleep 30\n');
  const startedAt = Date.now();
  const res = runWrapper(
    dir,
    ['investigate', '--prompt', 'p.md', '--out', path.join(dir, 'v.md'), '--cwd', dir, '--timeout-min', '0.01'],
    { CODEX_BIN: fake },
  );
  assert.ok(Date.now() - startedAt < 15_000, 'the wrapper did not stop the sleeping codex');
  assert.equal(res.status, EXIT.failed, res.stdout + res.stderr);
  assert.match(res.stdout, /timed out after 0\.01 min/);
  const row = JSON.parse(fs.readFileSync(path.join(dir, '.codex-runs/ledger.jsonl'), 'utf8'));
  assert.equal(row.outcome, 'failed');
  assert.match(row.reason, /timed out after 0\.01 min/);
});

test('the ledger of a linked worktree run lands in the main checkout, not the worktree', () => {
  const root = tmpDir('codex-run-wt-');
  const main = path.join(root, 'main');
  const linked = path.join(root, 'linked');
  fs.mkdirSync(main);
  const env = cleanEnv();
  const git = (cwd, ...args) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { cwd, env, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
  };
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'p.md'), 'task');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'base');
  git(main, 'worktree', 'add', '-q', '-b', 'side', linked);
  const fake = fakeCodex('#!/bin/sh\necho nope >&2\nexit 1\n');
  const res = spawnSync(
    process.execPath,
    [RUNNER, 'investigate', '--prompt', path.join(main, 'p.md'), '--out', path.join(root, 'v.md'), '--cwd', linked],
    { encoding: 'utf8', cwd: root, env: { ...env, CODEX_BIN: fake } },
  );
  assert.notEqual(res.status, EXIT.ok, res.stdout + res.stderr);
  assert.equal(fs.existsSync(path.join(main, '.codex-runs/ledger.jsonl')), true);
  assert.equal(fs.existsSync(path.join(linked, '.codex-runs')), false);
  const row = JSON.parse(fs.readFileSync(path.join(main, '.codex-runs/ledger.jsonl'), 'utf8'));
  assert.equal(row.cwd, linked);
});

/** Dirent-shaped entries as old Node 20.x returns them: `path` only, no `parentPath`. */
function rolloutEntries(t, entries) {
  t.mock.method(fs, 'readdirSync', () => entries);
}

test('rollouts are found on a Node whose Dirent has `path` but no `parentPath`', (t) => {
  const dir = tmpDir('codex-run-oldnode-');
  const sessions = path.join(dir, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(
    path.join(sessions, 'rollout.jsonl'),
    JSON.stringify({
      payload: { rate_limits: { secondary: { used_percent: 77, window_minutes: 10080 } } },
    }),
  );
  rolloutEntries(t, [{ name: 'rollout.jsonl', path: sessions, isFile: () => true }]);
  assert.equal(knownLimits(path.join(dir, 'no-ledger.jsonl'), sessions).usedPercent, 77);
});

test('an unreadable rollout entry means no reading, never a crash', (t) => {
  const dir = tmpDir('codex-run-oddentry-');
  rolloutEntries(t, [{ name: 'rollout.jsonl', isFile: () => true }]);
  assert.equal(knownLimits(path.join(dir, 'no-ledger.jsonl'), path.join(dir, 'sessions')), null);
});

test('a run with no CODEX_BIN reaches the PATH stub, proving the guard is first on PATH', () => {
  // An earlier test that let a run reach the PATH stub leaves the marker behind; fail here, not never.
  assert.equal(fs.existsSync(GUARD_MARKER), false, 'an earlier test called the PATH codex');
  const dir = tmpDir('codex-run-guardcheck-');
  fs.writeFileSync(path.join(dir, 'p.md'), 'task');
  const res = runWrapper(dir, [
    'investigate',
    '--prompt',
    'p.md',
    '--out',
    path.join(dir, 'v.md'),
    '--cwd',
    dir,
  ]);
  assert.equal(res.status, EXIT.failed, res.stdout + res.stderr);
  assert.match(fs.readFileSync(GUARD_MARKER, 'utf8'), /exec/);
  fs.rmSync(GUARD_MARKER); // deliberate: the closing test asserts nothing else called codex
});

test('no spawned run reached a codex binary other than a deliberately set CODEX_BIN', () => {
  assert.equal(fs.existsSync(GUARD_MARKER), false, 'a run called the PATH codex');
});
