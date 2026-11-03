/**
 * Tests for the harness-bootstrap run sidecar and `--status` (skills/harness-bootstrap/templates/scripts):
 * runs the shipped run-status suite hermetically, proves it can fail by mutating the liveness rules,
 * and runs both wrappers against a stub that sleeps: the sidecar is there and `--status` sees the run
 * while it works (codex-run's router call included), the sidecar is gone and `--status --out` reads
 * `done <outcome>` once it ends, a reserved or unavailable run included.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'run-status.test.mjs');
const CORE_REL = path.join('lib', 'run-status.mjs');
const CODEX_RUN = path.join(SCRIPTS, 'codex-run.mjs');
const CLAUDE_RUN = path.join(SCRIPTS, 'claude-run.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 19;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
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

/**
 * Env with a fresh HOME and CODEX_HOME, no CODEX_RUN*, CLAUDE_RUN*, GIT_* or host variable and no
 * global git config: the real quota, the host this runs under and a hook environment never matter.
 */
function hermeticEnv(cleanup, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(CODEX_RUN|CLAUDE_RUN|GIT_|ZCODE_|CODEX_)/.test(key)) delete env[key];
  }
  for (const key of ['CLAUDECODE', 'HARNESS_HOST', 'CLAUDE_BIN']) delete env[key];
  env.HOME = tmp('run-status-home-');
  env.CODEX_HOME = tmp('run-status-codex-');
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  cleanup.push(env.HOME, env.CODEX_HOME);
  return { ...env, ...extra };
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(scriptsDir, cleanup) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(scriptsDir, TEST_REL)],
    { encoding: 'utf8', env: hermeticEnv(cleanup), timeout: 120_000 },
  );
}

const cleanup = [];
const started = [];

/** Copy the shipped scripts, apply a one-line mutation to run-status.mjs, and assert the suite fails. */
function mutantFails(name, needle, replacement) {
  return test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('run-status-mutant-');
    cleanup.push(copy);
    fs.cpSync(SCRIPTS, copy, { recursive: true });
    const filePath = path.join(copy, CORE_REL);
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

/** Run node on `args`; resolves { code, stdout, stderr }. */
function node(args, opts) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    started.push(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Poll `probe` every 50 ms until it returns a value, for at most `ms`. */
async function waitFor(probe, ms, what) {
  const until = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The one sidecar in `dir` once its child pid is in, or null. */
function spawnedSidecar(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  if (names.length !== 1) return null;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, names[0]), 'utf8'));
    return s.childPid ? { file: path.join(dir, names[0]), sidecar: s } : null;
  } catch {
    return null;
  }
}

/**
 * Start a wrapper run on a stub that sleeps, check the sidecar and `--status` while it works, then
 * the exit, the removal, the ledger row and `--status --out` once it ended.
 */
async function wrapperRun(opts) {
  const stub = { pid: null };
  try {
    await checkRun(opts, stub);
  } catch (error) {
    // The wrapper is killed at the end; its stub would outlive it.
    if (stub.pid) spawnSync('kill', ['-9', String(stub.pid)]);
    throw error;
  }
}

async function checkRun({ wrapper, script, args, env, dir, out, ledgerDir, log }, stub) {
  const run = node([script, ...args], { cwd: dir, env });
  const running = path.join(ledgerDir, 'running');
  const { file, sidecar } = await waitFor(() => spawnedSidecar(running), 5000, 'the sidecar with the child pid');
  stub.pid = sidecar.childPid;
  assert.deepStrictEqual(Object.keys(sidecar).sort(), ['at', 'childPid', 'childStart', 'cwd', 'kind', 'log', 'out', 'run', 'wrapperPid', 'wrapperStart']);
  assert.strictEqual(sidecar.out, out);
  assert.strictEqual(sidecar.log, log);
  assert.strictEqual(sidecar.run, `${Date.parse(sidecar.at)}-${sidecar.wrapperPid}`);
  assert.strictEqual(path.basename(file), `${sidecar.run}.json`);
  const status = (...extra) => node([script, '--status', '--cwd', dir, '--sample-ms', '300', ...extra], { cwd: dir, env });
  const live = await status();
  assert.strictEqual(live.code, 0, live.stdout + live.stderr);
  const pids = `pids=${sidecar.wrapperPid}/${sidecar.childPid} out=`;
  assert.match(live.stdout, new RegExp(`^${wrapper}: (running|quiet) kind=investigate started=${sidecar.at} \\(\\d+s\\) ${pids}`));
  const byOut = await status('--out', out);
  assert.match(byOut.stdout, new RegExp(`^${wrapper}: (running|quiet) kind=investigate `));
  const res = await run;
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  stub.pid = null;
  assert.deepStrictEqual(fs.readdirSync(running), [], 'the sidecar outlived the run');
  const rows = ledgerRows(ledgerDir);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual([rows[0].run, rows[0].at, rows[0].outcome, rows[0].out, rows[0].verdict], [sidecar.run, sidecar.at, 'ok', out, out]);
  const done = await status('--out', out);
  assert.strictEqual(done.code, 0, done.stdout + done.stderr);
  assert.match(done.stdout, new RegExp(`^${wrapper}: done ok kind=investigate started=${sidecar.at} `));
  assert.strictEqual((await status()).stdout.trim(), `${wrapper}: no run in flight (${ledgerDir})`);
}

function ledgerRows(ledgerDir) {
  return fs.readFileSync(path.join(ledgerDir, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

/** A run that stops before its model (reserved, unavailable): its row carries --out, it leaves no sidecar, `--status --out` reads it. */
async function stoppedRun({ wrapper, script, args, env, dir, out, ledgerDir, outcome, code }) {
  const res = await node([script, ...args], { cwd: dir, env });
  assert.strictEqual(res.code, code, res.stdout + res.stderr);
  const row = ledgerRows(ledgerDir).at(-1);
  assert.deepStrictEqual([row.outcome, row.out], [outcome, out]);
  const running = path.join(ledgerDir, 'running');
  assert.ok(!fs.existsSync(running) || fs.readdirSync(running).length === 0, 'a run that never started left a sidecar');
  const done = await node([script, '--status', '--cwd', dir, '--out', out, '--sample-ms', '0'], { cwd: dir, env });
  assert.strictEqual(done.code, 0, done.stdout + done.stderr);
  assert.match(done.stdout, new RegExp(`^${wrapper}: done ${outcome} kind=investigate started=${row.at} `));
}

/** The pid a stub wrote to `file`, or null. */
function pidIn(file) {
  try {
    return Number(fs.readFileSync(file, 'utf8').trim()) || null;
  } catch {
    return null;
  }
}

/**
 * codex-run `auto` on a stub whose router call sleeps: the sidecar is there while it routes, with the
 * router as its child, then the model's child replaces it; one row with the sidecar's run once it ends.
 */
async function checkRoutedRun({ args, env, dir, out, ledgerDir, routerPidFile }, pids) {
  const run = node([CODEX_RUN, ...args], { cwd: dir, env });
  const running = path.join(ledgerDir, 'running');
  pids.router = await waitFor(() => pidIn(routerPidFile), 5000, 'the router stub');
  const routing = (s) => (s && s.sidecar.childPid === pids.router ? s : null);
  const { file, sidecar } = await waitFor(() => routing(spawnedSidecar(running)), 5000, 'the sidecar with the router pid');
  assert.deepStrictEqual([sidecar.kind, sidecar.out, path.basename(file)], ['auto', out, `${sidecar.run}.json`]);
  const status = (...extra) => node([CODEX_RUN, '--status', '--cwd', dir, '--sample-ms', '300', ...extra], { cwd: dir, env });
  const live = await status();
  assert.strictEqual(live.code, 0, live.stdout + live.stderr);
  assert.match(live.stdout, new RegExp(`^codex-run: (running|quiet) kind=auto started=${sidecar.at} \\(\\d+s\\) pids=${sidecar.wrapperPid}/${pids.router} out=`));
  const model = await waitFor(() => {
    const s = spawnedSidecar(running);
    return s && s.sidecar.childPid !== pids.router ? s : null;
  }, 5000, "the model's child in the sidecar");
  pids.model = model.sidecar.childPid;
  assert.deepStrictEqual([model.file, model.sidecar.run, model.sidecar.at, model.sidecar.kind], [file, sidecar.run, sidecar.at, 'auto']);
  const res = await run;
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  pids.router = pids.model = null;
  assert.deepStrictEqual(fs.readdirSync(running), [], 'the sidecar outlived the run');
  const rows = ledgerRows(ledgerDir);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual([rows[0].run, rows[0].at, rows[0].kind, rows[0].outcome, rows[0].out], [sidecar.run, sidecar.at, 'auto', 'ok', out]);
  assert.match((await status('--out', out)).stdout, new RegExp(`^codex-run: done ok kind=auto started=${sidecar.at} `));
}

async function main() {
  console.log('\nharness-bootstrap run sidecar and --status');

  await test('the shipped run-status suite passes with the pinned test count', () => {
    const res = runSuite(SCRIPTS, cleanup);
    const out = res.stdout + res.stderr;
    assert.strictEqual(res.status, 0, out.slice(-1500));
    assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
    assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
    assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
  });

  await mutantFails('a pid that counts without its start time (pid reuse)', 'Math.abs(startedMs - recorded) <= slackMs', 'true');
  await mutantFails('a run judged by the wrapper pid alone', 'alive: r.alive.wrapper || r.alive.child', 'alive: r.alive.wrapper');

  await test('codex-run: a sidecar and --status while the stub works; gone, and done ok, once it ends', async () => {
    const dir = tmp('run-status-codex-run-');
    cleanup.push(dir);
    fs.writeFileSync(path.join(dir, 'p.md'), 'task');
    const stub = path.join(tmp('run-status-stub-'), 'codex');
    cleanup.push(path.dirname(stub));
    fs.writeFileSync(
      stub,
      '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done\ncat > /dev/null\n' +
        'echo \'{"type":"thread.started","thread_id":"t-1"}\'\nsleep 3\n' +
        'echo \'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\'\necho "No findings." > "$out"\n',
      { mode: 0o755 },
    );
    const out = path.join(dir, 'v.md');
    await wrapperRun({
      wrapper: 'codex-run',
      script: CODEX_RUN,
      args: ['investigate', '--prompt', 'p.md', '--out', out, '--cwd', dir],
      env: hermeticEnv(cleanup, { CODEX_BIN: stub }),
      dir,
      out,
      ledgerDir: path.join(dir, '.codex-runs'),
      log: `${out}.log`,
    });
  });

  await test('claude-run: a sidecar and --status while the stub works; gone, and done ok, once it ends', async () => {
    const dir = tmp('run-status-claude-run-');
    cleanup.push(dir);
    fs.writeFileSync(path.join(dir, 'p.md'), 'task');
    const stub = path.join(tmp('run-status-stub-'), 'claude');
    cleanup.push(path.dirname(stub));
    const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.01, result: 'No findings.' });
    fs.writeFileSync(stub, `#!/bin/sh\ncat > /dev/null\nsleep 3\nprintf '%s\\n' '${result}'\n`, { mode: 0o755 });
    const out = path.join(dir, 'v.md');
    await wrapperRun({
      wrapper: 'claude-run',
      script: CLAUDE_RUN,
      args: ['investigate', '--prompt', 'p.md', '--out', out, '--cwd', dir],
      env: hermeticEnv(cleanup, { CLAUDE_BIN: stub, HARNESS_HOST: 'codex' }),
      dir,
      out,
      ledgerDir: path.join(dir, '.claude-runs'),
      log: null,
    });
  });

  await test('codex-run auto: the sidecar is there while the router runs, then the model\'s child replaces the router\'s', async () => {
    const dir = tmp('run-status-codex-route-');
    cleanup.push(dir);
    fs.writeFileSync(path.join(dir, 'p.md'), 'task');
    const stubDir = tmp('run-status-stub-');
    cleanup.push(stubDir);
    const stub = path.join(stubDir, 'codex');
    const routerPidFile = path.join(stubDir, 'router.pid');
    // The router call is the one with --output-schema: it sleeps, then answers with the model it was run on.
    fs.writeFileSync(
      stub,
      '#!/bin/sh\nschema=\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2";; -m) model="$2";; --output-schema) schema="$2";; esac; shift; done\n' +
        `cat > /dev/null\nif [ -n "$schema" ]; then\n  echo $$ > '${routerPidFile}'\n  sleep 2\n` +
        '  printf \'{"model":"%s","effort":"low","reason":"stub"}\\n\' "$model" > "$out"\n  exit 0\nfi\nsleep 1\n' +
        'echo \'{"type":"thread.started","thread_id":"t-1"}\'\necho \'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\'\necho "No findings." > "$out"\n',
      { mode: 0o755 },
    );
    const out = path.join(dir, 'v.md');
    const ledgerDir = path.join(dir, '.codex-runs');
    const env = hermeticEnv(cleanup, { CODEX_BIN: stub });
    const args = ['auto', '--prompt', 'p.md', '--out', out, '--cwd', dir];
    // A dry run asks no router and writes no sidecar.
    const dry = await node([CODEX_RUN, ...args, '--dry-run'], { cwd: dir, env });
    assert.strictEqual(dry.code, 0, dry.stdout + dry.stderr);
    assert.strictEqual(fs.existsSync(ledgerDir), false, 'a dry run wrote under the ledger dir');
    const pids = { router: null, model: null };
    try {
      await checkRoutedRun({ args, env, dir, out, ledgerDir, routerPidFile }, pids);
    } catch (error) {
      // The wrapper is killed at the end; its stubs would outlive it.
      for (const pid of [pids.router, pids.model]) if (pid) spawnSync('kill', ['-9', String(pid)]);
      throw error;
    }
  });

  await test('codex-run: a reserved run (CODEX_RUN=off) records its out, and --status --out reads done reserved', async () => {
    const dir = tmp('run-status-codex-off-');
    cleanup.push(dir);
    fs.writeFileSync(path.join(dir, 'p.md'), 'task');
    const out = path.join(dir, 'v.md');
    await stoppedRun({
      wrapper: 'codex-run',
      script: CODEX_RUN,
      args: ['investigate', '--prompt', 'p.md', '--out', out, '--cwd', dir],
      env: hermeticEnv(cleanup, { CODEX_RUN: 'off', CODEX_BIN: path.join(dir, 'no-such-codex') }),
      dir,
      out,
      ledgerDir: path.join(dir, '.codex-runs'),
      outcome: 'reserved',
      code: 4,
    });
  });

  await test('claude-run: a reserved run (CLAUDE_RUN=off) and an unavailable one record their out, and --status --out reads them', async () => {
    const dir = tmp('run-status-claude-off-');
    cleanup.push(dir);
    fs.writeFileSync(path.join(dir, 'p.md'), 'task');
    const out = path.join(dir, 'v.md');
    const common = { wrapper: 'claude-run', script: CLAUDE_RUN, args: ['investigate', '--prompt', 'p.md', '--out', out, '--cwd', dir], dir, out, ledgerDir: path.join(dir, '.claude-runs') };
    const env = (extra) => hermeticEnv(cleanup, { CLAUDE_BIN: path.join(dir, 'no-such-claude'), HARNESS_HOST: 'codex', ...extra });
    await stoppedRun({ ...common, env: env({ CLAUDE_RUN: 'off' }), outcome: 'reserved', code: 4 });
    await stoppedRun({ ...common, env: env({ CODEX_SANDBOX_NETWORK_DISABLED: '1' }), outcome: 'unavailable', code: 3 });
  });

  await test('--help and a usage error need no run-status.mjs, in both wrappers', async () => {
    const copy = tmp('run-status-nomodule-');
    cleanup.push(copy);
    fs.cpSync(SCRIPTS, copy, { recursive: true });
    fs.rmSync(path.join(copy, CORE_REL));
    const env = hermeticEnv(cleanup);
    for (const wrapper of ['codex-run', 'claude-run']) {
      const script = path.join(copy, `${wrapper}.mjs`);
      const help = await node([script, '--help'], { cwd: copy, env });
      assert.strictEqual(help.code, 0, help.stdout + help.stderr);
      assert.match(help.stdout, new RegExp(`^usage: node scripts/${wrapper}\\.mjs `));
      const bad = await node([script, '--no-such-flag'], { cwd: copy, env });
      assert.strictEqual(bad.code, 2, bad.stdout + bad.stderr);
      assert.match(bad.stderr, new RegExp(`^${wrapper}: `));
    }
  });
}

main().finally(() => {
  for (const child of started) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
});
