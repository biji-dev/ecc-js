/**
 * Tests for the harness-bootstrap leftover-processes hook template (biji-dev/ecc-js): a listener
 * started inside the checkout is named on Stop and on UserPromptSubmit; one in a main checkout's
 * worktree, or in a directory that only shares the checkout's prefix, is not; the memory notice
 * repeats only when it gets worse; and mutation checks.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { randomBytes } = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
// LEFTOVER_UNDER_TEST points the suite at another copy of the hook; unset, it tests the shipped file.
const HOOK = process.env.LEFTOVER_UNDER_TEST || path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'leftover-processes.mjs');
const LSOF = process.platform !== 'win32' && spawnSync('lsof', ['-v'], { encoding: 'utf8' }).error?.code !== 'ENOENT';

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name, fn, { skip = false } = {}) {
  if (skip) {
    console.log(`  - ${name} (skipped: ${skip})`);
    skipped += 1;
    return;
  }
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

const cleanup = [];
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

/** A main checkout (a .git directory) with a linked worktree under .worktrees/ (a .git file). */
function checkout() {
  const root = tmp('leftover-co-');
  fs.mkdirSync(path.join(root, '.git'));
  const worktree = path.join(root, '.worktrees', 'p1-01');
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(root, '.git', 'worktrees', 'p1-01')}\n`);
  return { root, worktree };
}

/** A TCP listener whose working directory is `cwd`, `args` on its command line; resolves once it listens, with its pid and port. */
function listen(cwd, args = []) {
  const child = spawn(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => console.log(s.address().port)); setTimeout(() => {}, 120000);", '--', ...args], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
  cleanup.push(() => child.kill());
  return new Promise((resolve, reject) => {
    child.stdout.once('data', (d) => resolve({ pid: child.pid, port: Number(String(d).trim()) }));
    child.once('error', reject);
  });
}

function mutant(from, to) {
  const source = fs.readFileSync(HOOK, 'utf8');
  assert.ok(source.includes(from), `not in the shipped file: ${from}`);
  const script = path.join(tmp('leftover-m-'), 'leftover-processes.mjs');
  fs.writeFileSync(script, source.replace(from, to));
  return script;
}

// Hermetic: an emulator or a VM running on this machine is named whoever started it, so every case
// but the machine-wide one runs a copy that names none.
const MACHINE_WIDE = 'const MACHINE_WIDE = /^(qemu-system|emulator64-)/;';
const QUIET = mutant(MACHINE_WIDE, 'const MACHINE_WIDE = /(?!)/;');
const quiet = (from, to) => {
  const script = path.join(tmp('leftover-m-'), 'leftover-processes.mjs');
  const source = fs.readFileSync(QUIET, 'utf8');
  assert.ok(source.includes(from), `not in the shipped file: ${from}`);
  fs.writeFileSync(script, source.replace(from, to));
  return script;
};

/** Run the hook for `event` from `dir`; returns its parsed output, or null when it says nothing. */
function runHook(event, dir, { script = QUIET, pressure = '0', session = 's', tmpdir = tmp('leftover-t-') } = {}) {
  const env = { ...process.env, LEFTOVER_PRESSURE: pressure, TMPDIR: tmpdir };
  delete env.CLAUDE_PROJECT_DIR;
  const res = spawnSync(process.execPath, [script], { input: JSON.stringify({ hook_event_name: event, cwd: dir, session_id: session }), env, encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(res.status, 0, res.stderr);
  return res.stdout.trim() ? JSON.parse(res.stdout) : null;
}

(async () => {
  console.log('\nharness-bootstrap leftover-processes hook');
  const noLsof = !LSOF && 'lsof is not installed';

  await test('silent when nothing runs from the checkout and memory is fine', () => {
    assert.strictEqual(runHook('Stop', checkout().root), null);
    assert.strictEqual(runHook('UserPromptSubmit', checkout().root), null);
  });

  await test('a listener started in the checkout is named, by its executable only, to the owner on Stop and to the model on UserPromptSubmit', async () => {
    const co = checkout();
    // a command line can carry a secret: the hook names the executable, never its arguments
    const secret = `--token=${randomBytes(12).toString('hex')}`;
    const { pid, port } = await listen(path.join(co.root), [secret]);
    const named = `:${port} ${path.basename(process.execPath)} (pid ${pid})`;
    const stop = runHook('Stop', co.root);
    assert.strictEqual(stop.systemMessage, `Still running from this checkout: ${named}`, 'the listener is named as `:<port> <executable> (pid <pid>)`');
    assert.ok(!stop.systemMessage.includes(secret.slice(8)), 'the listener\'s arguments are printed');
    const prompt = runHook('UserPromptSubmit', co.root);
    assert.strictEqual(prompt.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.ok(prompt.hookSpecificOutput.additionalContext.startsWith(`[leftover-processes] Still running from this checkout: ${named}. `), prompt.hookSpecificOutput.additionalContext);
    assert.match(prompt.hookSpecificOutput.additionalContext, /by recorded PID, never pkill/);
    assert.ok(!prompt.hookSpecificOutput.additionalContext.includes(secret.slice(8)), 'the listener\'s arguments are told to the model');
  }, { skip: noLsof });

  await test("a main checkout leaves out its worktrees' listeners; the worktree's own session names them", async () => {
    const co = checkout();
    const { port } = await listen(co.worktree);
    assert.strictEqual(runHook('Stop', co.root), null);
    assert.match(runHook('Stop', co.worktree).systemMessage, new RegExp(`:${port} `));
  }, { skip: noLsof });

  await test('a directory that only shares the checkout\'s prefix is not inside it', async () => {
    const co = checkout();
    const sibling = `${co.root}-other`;
    fs.mkdirSync(sibling);
    cleanup.push(sibling);
    await listen(sibling);
    assert.strictEqual(runHook('Stop', co.root), null);
  }, { skip: noLsof });

  await test('tight memory is said once per window, and again sooner only when it gets worse', () => {
    const dir = checkout().root;
    const state = tmp('leftover-t-');
    const first = runHook('UserPromptSubmit', dir, { pressure: '2', tmpdir: state });
    assert.match(first.hookSpecificOutput.additionalContext, /^\[resources\] The machine is tight \(memory pressure warn\)\. .*machine-sweep\.mjs --report/);
    assert.strictEqual(runHook('UserPromptSubmit', dir, { pressure: '2', tmpdir: state }), null);
    assert.match(runHook('UserPromptSubmit', dir, { pressure: '4', tmpdir: state }).hookSpecificOutput.additionalContext, /memory pressure critical/);
    assert.match(runHook('Stop', dir, { pressure: '4', tmpdir: state }).systemMessage, /^The machine is tight \(memory pressure critical\)/);
  });

  await test('a machine-wide process (an emulator) is named, whoever started it', async () => {
    const exe = path.join(tmp('leftover-e-'), 'emulator64-arm64-test');
    fs.symlinkSync(process.execPath, exe);
    const child = spawn(exe, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    cleanup.push(() => child.kill());
    const decoy = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', 'qemu-system-decoy'], { stdio: 'ignore' });
    cleanup.push(() => decoy.kill());
    await new Promise((r) => setTimeout(r, 300));
    const out = runHook('Stop', checkout().root, { script: HOOK });
    assert.match(out?.systemMessage ?? '', new RegExp(`emulator64-arm64-test \\(pid ${child.pid}, machine-wide\\)`));
    assert.ok(!(out?.systemMessage ?? '').includes(`pid ${decoy.pid}`), 'a process whose arguments name an emulator is not one');
  }, { skip: process.platform === 'win32' && 'ps lists no command lines' });

  await test("the sweep pointer names the installed copy only where the owner installed it, the skill's script otherwise", () => {
    const dir = checkout().root;
    const message = (home) => {
      const env = { ...process.env, LEFTOVER_PRESSURE: '2', TMPDIR: tmp('leftover-t-'), HOME: home };
      delete env.CLAUDE_PROJECT_DIR;
      const res = spawnSync(process.execPath, [QUIET], { input: JSON.stringify({ hook_event_name: 'Stop', cwd: dir, session_id: 's' }), env, encoding: 'utf8', timeout: 30000 });
      assert.strictEqual(res.status, 0, res.stderr);
      return JSON.parse(res.stdout).systemMessage;
    };
    assert.match(message(tmp('leftover-h-')), /The machine is tight \(memory pressure warn\)\. the harness-bootstrap skill's scripts\/machine-sweep\.mjs --report lists the rest \(machine\.md\)\.$/);
    const installed = tmp('leftover-h-');
    fs.mkdirSync(path.join(installed, '.agents', 'harness', 'machine-sweep'), { recursive: true });
    fs.writeFileSync(path.join(installed, '.agents', 'harness', 'machine-sweep', 'machine-sweep.mjs'), '');
    assert.match(message(installed), /The machine is tight \(memory pressure warn\)\. node ~\/\.agents\/harness\/machine-sweep\/machine-sweep\.mjs --report lists the rest\.$/);
  });

  await test('mutation: dropping the worktree exclusion names another session\'s listener', async () => {
    const script = quiet('if (main && cwd.startsWith(worktrees)) continue;', '');
    const co = checkout();
    await listen(co.worktree);
    assert.ok(runHook('Stop', co.root, { script }), 'the mutant names the worktree listener');
  }, { skip: noLsof });

  await test('mutation: a bare prefix match takes a sibling directory for the checkout', async () => {
    const script = quiet('cwd !== root && !cwd.startsWith(root + sep)', 'cwd !== root && !cwd.startsWith(root)');
    const co = checkout();
    const sibling = `${co.root}-other`;
    fs.mkdirSync(sibling);
    cleanup.push(sibling);
    await listen(sibling);
    assert.ok(runHook('Stop', co.root, { script }), 'the mutant names the sibling listener');
  }, { skip: noLsof });

  await test('mutation: no throttle repeats the memory notice at every prompt', () => {
    const script = quiet('if (now - last.at < NOTICE_MINUTES * 60_000 && level <= last.level) return null;', '');
    const dir = checkout().root;
    const state = tmp('leftover-t-');
    runHook('UserPromptSubmit', dir, { script, pressure: '2', tmpdir: state });
    assert.ok(runHook('UserPromptSubmit', dir, { script, pressure: '2', tmpdir: state }), 'the mutant repeats the notice');
  });

  for (const c of cleanup.reverse()) {
    if (typeof c === 'function') c();
    else fs.rmSync(c, { recursive: true, force: true });
  }
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (skipped) console.log(`Skipped: ${skipped}`);
  process.exit(failed > 0 ? 1 : 0);
})();
