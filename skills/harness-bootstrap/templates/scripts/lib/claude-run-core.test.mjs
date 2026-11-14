// harness-bootstrap claude-run tests (generated YYYY-MM-DD). Run: node --test scripts/lib/claude-run-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the tests read CATALOG and
// BUDGET_USD rather than their values, and a stub `claude` first on PATH answers, so they never
// spend anything.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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

test('parseArgs: a --timeout-min under 20 is raised to 20 and remembered; 20 and over stay', () => {
  const a = parseArgs(['lane-a', '--prompt', 'p', '--timeout-min', '9']);
  assert.equal(a.timeoutMin, 20);
  assert.equal(a.timeoutRaisedFrom, 9);
  assert.equal(parseArgs(['lane-a', '--prompt', 'p', '--timeout-min', '25']).timeoutRaisedFrom, undefined);
  assert.equal(parseArgs(['lane-a', '--prompt', 'p', '--timeout-min', '0.5'], { CLAUDE_RUN_TIMEOUT_FLOOR: '0' }).timeoutMin, 0.5);
  assert.equal(parseArgs(['lane-a', '--prompt', 'p', '--timeout-min', '9'], { CLAUDE_RUN_TIMEOUT_FLOOR: '1e9' }).timeoutMin, 20, 'a floor past a Node timer is unset');
});

test('parseArgs --status: no kind, only --out, --cwd and --sample-ms (default 5000), and the env is not read', () => {
  assert.deepEqual(parseArgs(['--status']), { status: true, out: null, cwd: null, sampleMs: 5000 });
  assert.deepEqual(parseArgs(['--status', '--out', 'v.md', '--cwd', '/w', '--sample-ms', '250'], { CLAUDE_RUN: 'of' }), { status: true, out: 'v.md', cwd: '/w', sampleMs: 250 });
  assert.throws(() => parseArgs(['review', '--status']), /--status takes no kind \(got "review"\)/);
  assert.throws(() => parseArgs(['--status', '--kind', 'review']), /--status takes only --out, --cwd and --sample-ms, not --kind/);
  assert.throws(() => parseArgs(['--status', '--sample-ms']), /--sample-ms needs a value/);
  for (const value of ['abc', '-1', 'Infinity']) assert.throws(() => parseArgs(['--status', '--sample-ms', value]), /--sample-ms must be/);
  assert.throws(() => parseArgs(['lane-a', '--prompt', 'p', '--sample-ms', '10']), /unknown option --sample-ms/);
  assert.equal(parseArgs(['lane-a', '--prompt', 'p']).status, undefined);
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
  // Every review row carries the tree the reviewer read (the edited fee, uncommitted) and the branch.
  const editedTree = execFileSync('git', ['show', `${rows[2].tree}:pay.js`], { cwd: repo, encoding: 'utf8' });
  assert.equal(editedTree, 'export const fee = 2;\n');
  assert.notEqual(rows[2].tree, git('rev-parse', 'HEAD^{tree}'));
  assert.deepEqual(rows.map((r) => r.branch), ['main', 'main', 'main', 'main']);
  assert.ok(rows.every((r) => /^[0-9a-f]{40}$/.test(r.tree)));
  assert.equal(run({ CODEX_THREAD_ID: 't' }, 'review', '--base', 'no-such-ref').status, EXIT.usage);
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A repository on branch `feature`, forked from `main` at `fork`, with `main` one commit further on
 * and pay.js edited in the working tree, and a stub `claude` that keeps its stdin and answers ok
 * (and, with STUB_EDIT set, edits pay.js while it runs). `run(env, ...args)` returns the exit and the ledger's last row.
 */
function landingRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-run-landing-'));
  const bin = path.join(dir, 'bin');
  const repo = path.join(dir, 'repo');
  for (const d of [bin, repo]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$STUB_DIR/argv.txt"\ncat > "$STUB_DIR/stdin.txt"\n[ -n "$STUB_EDIT" ] && echo "// during" >> pay.js\ncat "$STUB_DIR/answer.json"\n');
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  fs.writeFileSync(path.join(dir, 'answer.json'), result());
  fs.writeFileSync(path.join(dir, 'p.md'), 'the focus');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude-runs/\n.review-work/\n');
  fs.writeFileSync(path.join(repo, 'pay.js'), 'export const fee = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const fork = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'pay.js'), 'export const fee = 2;\n');
  git('commit', '-qam', 'feature');
  git('checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, 'other.js'), 'export const x = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'main');
  git('checkout', '-q', 'feature');
  fs.writeFileSync(path.join(repo, 'pay.js'), 'export const fee = 3;\n');
  const run = (env, ...args) => {
    const res = spawnSync(process.execPath, [RUNNER, ...args, '--cwd', repo], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir, CODEX_THREAD_ID: 't', ...env },
    });
    const rows = fs.readFileSync(path.join(repo, '.claude-runs', 'ledger.jsonl'), 'utf8').trim().split('\n');
    return { res, row: JSON.parse(rows.at(-1)) };
  };
  return { dir, repo, git, fork, run, prompt: path.join(dir, 'p.md') };
}

test('the wrapper: a review row records baseTree, the tree of its merge base, and treeAfter; lane-a does not', () => {
  const { dir, git, fork, run, prompt } = landingRepo();
  try {
    const { res, row } = run({}, 'review', '--base', 'main');
    assert.equal(res.status, EXIT.ok, res.stderr + res.stdout);
    assert.equal(row.kind, 'review');
    assert.equal(row.baseTree, git('rev-parse', `${fork}^{tree}`));
    assert.notEqual(row.baseTree, git('rev-parse', 'main^{tree}'));
    assert.match(row.tree, /^[0-9a-f]{40}$/);
    assert.equal(row.treeAfter, row.tree);
    assert.equal('treeMoved' in row, false);
    const { row: other } = run({}, 'lane-a', '--prompt', prompt);
    assert.equal(other.kind, 'lane-a');
    assert.equal('baseTree' in other || 'treeAfter' in other || 'treeMoved' in other || 'tree' in other, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the wrapper: adversarial records its optional --base as baseTree, never on the claude command line, and lists the range in the brief', () => {
  const { dir, git, run, prompt } = landingRepo();
  try {
    const { res, row } = run({}, 'adversarial', '--prompt', prompt, '--base', 'main');
    assert.equal(res.status, EXIT.ok, res.stderr + res.stdout);
    assert.equal(row.baseTree, git('rev-parse', 'main^{tree}'));
    const argv = fs.readFileSync(path.join(dir, 'argv.txt'), 'utf8').split('\n');
    assert.equal(argv.includes('--base') || argv.includes('main'), false, argv.join(' '));
    // The landing check counts the pass as a read of main..working tree: pay.js and other.js both.
    const brief = fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8');
    assert.ok(brief.includes(`from tree ${row.baseTree} to the working tree`), brief);
    assert.ok(brief.includes('\n- pay.js\n') && brief.includes('\n- other.js\n'), brief);
    const { row: without } = run({}, 'adversarial', '--prompt', prompt);
    assert.equal(without.baseTree, null);
    assert.equal(without.treeAfter, without.tree);
    assert.equal(fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8').includes('## The range'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the wrapper: a tracked file edited while the model runs gives treeMoved: true, and treeAfter holds the edit', () => {
  const { dir, git, run, prompt } = landingRepo();
  try {
    const { res, row } = run({ STUB_EDIT: '1' }, 'adversarial', '--prompt', prompt, '--base', 'main');
    assert.equal(res.status, EXIT.ok, res.stderr + res.stdout);
    assert.equal(row.outcome, 'ok');
    assert.equal(row.treeMoved, true);
    assert.equal(git('cat-file', '-p', `${row.tree}:pay.js`), 'export const fee = 3;');
    assert.equal(git('cat-file', '-p', `${row.treeAfter}:pay.js`), 'export const fee = 3;\n// during');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A scratch dir with a stub `claude` (the given shell body) first on PATH, and a prompt file. */
function stubDir(body) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-run-stub-')));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'claude'), `#!/bin/sh\n${body}`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'p.md'), 'the task');
  // the timeout cases run in seconds: no floor
  const env = (extra = {}) => ({ PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, HOME: dir, CODEX_THREAD_ID: 't', CLAUDE_RUN_TIMEOUT_FLOOR: '0', ...extra });
  const args = ['lane-a', '--prompt', path.join(dir, 'p.md'), '--out', path.join(dir, 'v.md'), '--cwd', dir];
  return { dir, env, args };
}

// A fake model that starts a grandchild (`sleep 62`) and never exits by itself. Its pid goes to $PIDFILE.
const GRANDCHILD = 'sleep 62 &\necho $! > "$PIDFILE"\nwait\n';
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleepMs(50)) if (fn()) return true;
  return fn();
}
const readPid = (file) => (fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) || 0 : 0);
const killQuietly = (pid, sig = 'SIGKILL') => {
  try {
    process.kill(pid, sig);
  } catch {
    /* already gone */
  }
};

test('the wrapper: a timed-out run takes the model\'s whole process group with it: no grandchild survives', async () => {
  const { dir, env, args } = stubDir(GRANDCHILD);
  const pidFile = path.join(dir, 'grandchild.pid');
  try {
    const res = spawnSync(process.execPath, [RUNNER, ...args, '--timeout-min', '0.02'], { encoding: 'utf8', env: env({ PIDFILE: pidFile }) });
    assert.equal(res.status, EXIT.failed, res.stdout + res.stderr);
    assert.match(res.stdout, /timed out after 0\.02 min/);
    const pid = readPid(pidFile);
    assert.ok(pid > 0, 'the fake model never started its grandchild');
    assert.equal(await until(() => !alive(pid)), true, `grandchild ${pid} survived the timeout`);
  } finally {
    const pid = readPid(pidFile);
    if (pid) killQuietly(pid);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the wrapper: SIGTERM to the wrapper itself reaches the model\'s process group first', async () => {
  const { dir, env, args } = stubDir(GRANDCHILD);
  const pidFile = path.join(dir, 'grandchild.pid');
  const wrapper = spawn(process.execPath, [RUNNER, ...args, '--timeout-min', '5'], { env: env({ PIDFILE: pidFile }), stdio: 'ignore', detached: true });
  const exited = new Promise((resolve) => wrapper.on('exit', resolve));
  try {
    assert.equal(await until(() => readPid(pidFile) > 0), true, 'the fake model never started its grandchild');
    const pid = readPid(pidFile);
    process.kill(wrapper.pid, 'SIGTERM');
    await Promise.race([exited, sleepMs(10_000)]);
    assert.equal(await until(() => !alive(pid)), true, `grandchild ${pid} survived the wrapper's SIGTERM`);
  } finally {
    killQuietly(-wrapper.pid);
    const pid = readPid(pidFile);
    if (pid) killQuietly(pid);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the wrapper: every run carries HARNESS_ROLE=executor in the model\'s env, whatever the caller had', () => {
  const { dir, env, args } = stubDir('cat > /dev/null\nprintf \'{"type":"result","subtype":"success","is_error":false,"num_turns":1,"total_cost_usd":0.1,"result":"role=%s"}\' "$HARNESS_ROLE"\n');
  try {
    const res = spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', env: env({ HARNESS_ROLE: 'session' }) });
    assert.equal(res.status, EXIT.ok, res.stdout + res.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'v.md'), 'utf8'), 'role=executor\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
