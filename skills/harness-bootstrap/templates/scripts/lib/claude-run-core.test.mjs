// harness-bootstrap claude-run tests (generated YYYY-MM-DD). Run: node --test scripts/lib/claude-run-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the tests read CATALOG and
// BUDGET_USD rather than their values, and a stub `claude` first on PATH answers, so they never
// spend anything.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BUDGET_USD,
  CATALOG,
  EXIT,
  TOOLS,
  budgetDecision,
  claudeArgv,
  classify,
  hostCheck,
  networkCheck,
  parseArgs,
  resolveRoute,
  reviewPrompt,
} from './claude-run-core.mjs';

test('parseArgs: the kind as a word or --kind; review needs --base, the others a --prompt', () => {
  const a = parseArgs(['review', '--base', 'main']);
  assert.equal(a.kind, 'review');
  assert.equal(a.base, 'main');
  assert.equal(a.budgetUsd, BUDGET_USD);
  assert.equal(a.timeoutMin, 45);
  assert.equal(parseArgs(['--kind', 'adversarial', '--prompt', 'p.md', '--critical']).critical, true);
  assert.equal(parseArgs(['review', '--base', 'a1b2c3', '--prompt', 'focus.md']).prompt, 'focus.md');
  assert.throws(() => parseArgs([]), /a kind is required/);
  assert.throws(() => parseArgs(['implement-cold', '--prompt', 'p.md']), /kind must be one of review, adversarial, plan-blind, investigate, lane-a/);
  assert.throws(() => parseArgs(['review']), /review needs --base/);
  assert.throws(() => parseArgs(['investigate']), /investigate needs --prompt/);
  assert.throws(() => parseArgs(['review', 'lane-a', '--base', 'main']), /one kind/);
  assert.throws(() => parseArgs(['review', '--base', '--output=x']), /--base needs a value/);
  assert.throws(() => parseArgs(['review', '--base', '-x']), /--base is not a ref/);
  assert.throws(() => parseArgs(['lane-a', '--prompt', 'p', '--effort', 'max']), /max only on the owner's word/);
  assert.throws(() => parseArgs(['lane-a', '--prompt', 'p', '--model', 'haiku']), new RegExp(`--model must be one of ${Object.values(CATALOG).join(', ')}`));
  assert.throws(() => parseArgs(['lane-a', '--prompt', 'p', '--budget-usd', '0']), /--budget-usd must be a positive number/);
  assert.throws(() => parseArgs(['lane-a', '--prompt', 'p', '--timeout-min', 'NaN']), /--timeout-min must be positive/);
  assert.throws(() => parseArgs(['lane-a', '--prompt', 'p', '--write']), /unknown option --write/);
});

test('resolveRoute: the table row, the critical effort, then an explicit override', () => {
  assert.deepEqual(resolveRoute(parseArgs(['review', '--base', 'main'])), { model: CATALOG.judgment, effort: 'high' });
  assert.deepEqual(resolveRoute(parseArgs(['lane-a', '--prompt', 'p'])), { model: CATALOG.bounded, effort: 'high' });
  assert.equal(resolveRoute(parseArgs(['adversarial', '--prompt', 'p', '--critical'])).effort, 'xhigh');
  assert.equal(resolveRoute(parseArgs(['review', '--base', 'main', '--critical'])).effort, 'high');
  assert.deepEqual(resolveRoute(parseArgs(['plan-blind', '--prompt', 'p', '--effort', 'xhigh', '--model', CATALOG.bounded])), { model: CATALOG.bounded, effort: 'xhigh' });
});

test('claudeArgv: print mode, read-only tools only, no settings, hooks or MCP, the dollar cap, nothing saved -- and no prompt', () => {
  const args = claudeArgv({ model: 'opus', effort: 'high' }, { budgetUsd: 5 });
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(args[0], '-p');
  for (const flag of ['--restricted', '--strict-mcp-config', '--no-session-persistence']) assert.ok(args.includes(flag), flag);
  assert.equal(value('--tools'), TOOLS.join(','));
  assert.equal(value('--allowedTools'), TOOLS.join(','));
  assert.deepEqual(TOOLS, ['Read', 'Grep', 'Glob']);
  assert.equal(value('--permission-mode'), 'dontAsk');
  assert.equal(value('--model'), 'opus');
  assert.equal(value('--effort'), 'high');
  assert.equal(value('--max-budget-usd'), '5');
  assert.equal(value('--output-format'), 'json');
  assert.ok(!args.some((x) => /^(Bash|Edit|Write|WebFetch)/.test(x)), 'no write or command tool');
  assert.ok(!args.includes('--add-dir'));
  const outside = claudeArgv({ model: 'opus', effort: 'high' }, { budgetUsd: 2 }, { addDirs: ['/tmp/run'] });
  assert.deepEqual(outside.slice(-2), ['--add-dir', '/tmp/run']);
});

test('hostCheck and networkCheck: never under Claude Code, never into a sandbox with no network', () => {
  const claude = hostCheck({ CLAUDECODE: '1' });
  assert.equal(claude.ok, false);
  assert.match(claude.why, /the host is Claude Code \(CLAUDECODE\): its second family is Codex, through scripts\/codex-run\.mjs/);
  assert.equal(hostCheck({ CODEX_THREAD_ID: 't', CLAUDECODE: '1' }).ok, true);
  assert.equal(hostCheck({ ZCODE_SESSION_ID: 'z', CLAUDECODE: '1' }).ok, true);
  assert.equal(hostCheck({}).ok, true);
  assert.throws(() => hostCheck({ HARNESS_HOST: 'cursor' }), /HARNESS_HOST must be one of/);
  assert.deepEqual(networkCheck({ CODEX_SANDBOX: 'seatbelt' }), { ok: true, why: '' });
  const sandboxed = networkCheck({ CODEX_SANDBOX: 'seatbelt', CODEX_SANDBOX_NETWORK_DISABLED: '1' });
  assert.equal(sandboxed.ok, false);
  assert.match(sandboxed.why, /^this shell's sandbox has no network \(CODEX_SANDBOX_NETWORK_DISABLED=1\)/);
});

test('budgetDecision: the owner switch CLAUDE_RUN=on|essential|off; a misspelt value is a usage error', () => {
  assert.deepEqual(budgetDecision('lane-a', parseArgs(['lane-a', '--prompt', 'p'], {}).mode), { run: true, reason: '' });
  const essential = parseArgs(['lane-a', '--prompt', 'p'], { CLAUDE_RUN: 'essential' }).mode;
  assert.equal(budgetDecision('lane-a', essential).run, false);
  assert.equal(budgetDecision('review', essential).run, true);
  assert.equal(budgetDecision('adversarial', essential).run, true);
  const off = budgetDecision('review', parseArgs(['review', '--base', 'main'], { CLAUDE_RUN: 'off' }).mode);
  assert.deepEqual(off, { run: false, reason: 'CLAUDE_RUN=off: every kind is reserved' });
  assert.throws(() => parseArgs(['review', '--base', 'main'], { CLAUDE_RUN: 'of' }), /CLAUDE_RUN must be on, essential or off/);
});

const result = (o) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 4, total_cost_usd: 0.42, result: 'No findings.', ...o });

test('classify: an honest outcome from the JSON result, whatever the exit code says', () => {
  assert.deepEqual(classify({ exitCode: 0, stdout: result() }), { outcome: 'ok', exit: EXIT.ok, reason: '', text: 'No findings.', costUsd: 0.42, turns: 4 });
  // measured: claude -p inside Codex's workspace sandbox, 177 s, then this
  const offline = classify({
    exitCode: 1,
    stdout: result({ is_error: true, terminal_reason: 'api_error', total_cost_usd: 0, result: "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)" }),
  });
  assert.equal(offline.outcome, 'unavailable');
  assert.equal(offline.exit, EXIT.unavailable);
  assert.match(offline.reason, /Can't reach the API server/);
  const login = classify({ exitCode: 1, stdout: result({ is_error: true, result: 'Not logged in · Please run /login' }) });
  assert.equal(login.outcome, 'unavailable');
  const limit = classify({ exitCode: 1, stdout: result({ is_error: true, result: 'Claude usage limit reached. Your limit will reset at 5pm' }) });
  assert.equal(limit.outcome, 'unavailable');
  const capped = classify({ exitCode: 1, stdout: result({ subtype: 'error_max_budget_usd', is_error: true, result: undefined }), budgetUsd: 5 });
  assert.deepEqual([capped.outcome, capped.exit, capped.reason], ['failed', EXIT.failed, 'the $5 budget cap was reached']);
  assert.equal(classify({ exitCode: 1, stdout: result({ subtype: 'error_max_turns', is_error: true }) }).reason, 'error_max_turns');
  assert.equal(classify({ exitCode: 0, stdout: result({ result: '  ' }) }).reason, 'an empty verdict');
  assert.equal(classify({ exitCode: 1, stdout: result({ is_error: true, result: 'Tool use failed' }) }).outcome, 'failed');
  assert.equal(classify({ exitCode: 0, stdout: 'not json' }).reason, 'no result in the output (exit 0)');
  assert.equal(classify({ exitCode: 0, stdout: `progress\n${result()}\n` }).outcome, 'ok');
  assert.deepEqual(classify({ spawnError: 'ENOENT', binary: 'claude' }).outcome, 'unavailable');
  assert.equal(classify({ timedOut: true, timeoutMin: 45 }).reason, 'timed out after 45 min');
});

test('classify: an error result is read for its errors before the run is called failed', () => {
  const errored = (errors, o = {}) => classify({ exitCode: 1, stdout: result({ subtype: 'error_during_execution', is_error: true, result: undefined, errors, ...o }) });
  const login = errored(['Not logged in · Please run /login']);
  assert.deepEqual([login.outcome, login.exit], ['unavailable', EXIT.unavailable]);
  assert.equal(login.reason, 'error_during_execution: Not logged in · Please run /login');
  const denied = errored(['Tool permission denied\nsecond line']);
  assert.deepEqual([denied.outcome, denied.exit], ['failed', EXIT.failed]);
  assert.equal(denied.reason, 'error_during_execution: Tool permission denied');
  // an entry may be an object, and any entry (not only the first) can say the run never reached the model
  assert.equal(errored([{ message: 'Claude usage limit reached' }]).reason, 'error_during_execution: Claude usage limit reached');
  assert.equal(errored([{ message: 'Claude usage limit reached' }]).outcome, 'unavailable');
  assert.equal(errored(['Tool permission denied', 'API Error: Can\'t reach the API server']).outcome, 'unavailable');
  assert.equal(errored(['Tool permission denied'], { terminal_reason: 'api_error' }).outcome, 'unavailable');
  // no entry: the subtype alone, as before
  assert.deepEqual([errored([]).outcome, errored([]).reason], ['failed', 'error_during_execution']);
  assert.deepEqual([errored(undefined).outcome, errored(undefined).reason], ['failed', 'error_during_execution']);
});

test('reviewPrompt: the diff file and its base, the one severity scale, the session\'s focus last', () => {
  const p = reviewPrompt({ diffRel: '.review-work/claude-review/diff.patch', base: 'main' });
  assert.match(p, /\.review-work\/claude-review\/diff\.patch/);
  assert.match(p, /git diff --merge-base main/);
  for (const sev of ['P0', 'P1', 'P2', 'P3']) assert.match(p, new RegExp(`- ${sev} — `));
  assert.match(p, /No findings\./);
  assert.ok(!/Focus/.test(p));
  assert.match(reviewPrompt({ diffRel: 'd', base: 'main', focus: 'the refund path' }), /\n\nFocus from the session:\nthe refund path$/);
});

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'claude-run.mjs');

test('the wrapper: refuses Claude Code and a sandbox with no network, honours the switch, runs read-only, writes the verdict and one ledger row', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-run-'));
  const bin = path.join(dir, 'bin');
  const repo = path.join(dir, 'repo');
  const stubDir = path.join(dir, 'stub');
  for (const d of [bin, repo, stubDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$STUB_DIR/argv.txt"\ncat > "$STUB_DIR/stdin.txt"\ncat "$STUB_DIR/answer.json"\n');
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'pay.js'), 'export const fee = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'pay.js'), 'export const fee = 2;\n');
  const answer = (o) => fs.writeFileSync(path.join(stubDir, 'answer.json'), result(o));
  const run = (env, ...args) =>
    spawnSync(process.execPath, [RUNNER, ...args, '--cwd', repo], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, STUB_DIR: stubDir, ...env },
    });
  const ledger = path.join(repo, '.claude-runs', 'ledger.jsonl');
  const verdict = path.join(repo, '.review-work', 'claude-review', 'verdict.md');

  const dry = run({ HARNESS_HOST: 'codex' }, 'review', '--base', base, '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(JSON.parse(dry.stdout).argv.includes('--restricted'));
  assert.ok(!fs.existsSync(path.join(repo, '.claude-runs')) && !fs.existsSync(path.join(repo, '.review-work')), 'a dry run writes nothing');
  assert.equal(run({ CLAUDECODE: '1' }, 'review', '--base', base).status, EXIT.usage);
  const sandboxed = run({ CODEX_THREAD_ID: 't', CODEX_SANDBOX_NETWORK_DISABLED: '1' }, 'review', '--base', base);
  assert.equal(sandboxed.status, EXIT.unavailable);
  assert.ok(!fs.existsSync(path.join(stubDir, 'argv.txt')), 'claude never started');
  assert.equal(run({ CODEX_THREAD_ID: 't', CLAUDE_RUN: 'off' }, 'review', '--base', base).status, EXIT.reserved);

  answer({ result: 'P1 pay.js:1 — the fee doubled' });
  const ok = run({ CODEX_THREAD_ID: 't' }, 'review', '--base', base);
  assert.equal(ok.status, EXIT.ok, ok.stderr + ok.stdout);
  assert.match(ok.stdout, /^claude-run: ok kind=review model=\S+ effort=high cost=\$0\.42 turns=4 /);
  assert.equal(fs.readFileSync(verdict, 'utf8'), 'P1 pay.js:1 — the fee doubled\n');
  const argv = fs.readFileSync(path.join(stubDir, 'argv.txt'), 'utf8').split('\n');
  assert.ok(argv.includes('--restricted') && argv.includes('dontAsk'));
  const stdin = fs.readFileSync(path.join(stubDir, 'stdin.txt'), 'utf8');
  assert.match(stdin, /\.review-work\/claude-review\/diff\.patch/);
  assert.match(fs.readFileSync(path.join(repo, '.review-work', 'claude-review', 'diff.patch'), 'utf8'), /^\+export const fee = 2;$/m);

  answer({ is_error: true, terminal_reason: 'api_error', total_cost_usd: 0, result: "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)" });
  assert.equal(run({ CODEX_THREAD_ID: 't' }, 'review', '--base', base).status, EXIT.unavailable);
  const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.outcome), ['unavailable', 'reserved', 'ok', 'unavailable']);
  assert.equal(rows[2].costUsd, 0.42);
  assert.equal(rows[2].verdict, verdict);
  assert.equal(run({ CODEX_THREAD_ID: 't' }, 'review', '--base', 'no-such-ref').status, EXIT.usage);
  fs.rmSync(dir, { recursive: true, force: true });
});
