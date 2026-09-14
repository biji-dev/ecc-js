/**
 * Fork hook surface (biji-dev/ecc-js): the shipped hook graph matches
 * fork/slim.json and the ecc/setup.json allowlist is the effective gate.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const slim = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'fork', 'slim.json'), 'utf8'));
const setup = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'ecc', 'setup.json'), 'utf8'));
const { listHookIds } = require('../../fork/bin/transforms/hooks');
const { isHookEnabled } = require('../../scripts/lib/hook-flags');
const { PRE_BASH_HOOKS, POST_BASH_HOOKS } = require('../../scripts/hooks/bash-hook-dispatcher');
const { SYNC_HOOKS, ASYNC_HOOKS } = require('../../scripts/hooks/posttooluse-dispatcher');

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

function forkEnv(extra = {}) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT };
  delete env.ECC_HOOK_ALLOWLIST;
  delete env.ECC_HOOK_PROFILE;
  delete env.ECC_DISABLED_HOOKS;
  delete env.ECC_HOOKS_ENABLED;
  delete env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE;
  delete env.CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED;
  delete env.GATEGUARD_BASH_ROUTINE_DISABLED;
  delete env.GATEGUARD_DISABLED;
  delete env.ECC_GATEGUARD;
  delete env.ECC_HOOK_CONFIG;
  delete env.ECC_PLUGIN_ROOT;
  return { ...env, ...extra };
}

function runPreBash(command, home) {
  return spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-bash-dispatcher.js')], {
    cwd: home,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'fork-hooks-graph', cwd: home }),
    encoding: 'utf8',
    env: forkEnv({ HOME: home, USERPROFILE: home, GATEGUARD_STATE_DIR: path.join(home, '.gateguard'), CLAUDE_PROJECT_DIR: home }),
    timeout: 20000,
  });
}

function isDenied(result) {
  return result.status === 2 || /"permissionDecision"\s*:\s*"deny"/.test(result.stdout || '');
}

console.log('\n=== fork hook graph ===\n');

test('hooks.json top-level ids equal slim.hooks.keep', () => {
  assert.deepStrictEqual([...listHookIds()].sort(), [...slim.hooks.keep].sort());
});

test('every script referenced by hooks.json exists', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8');
  const refs = [...new Set([...text.matchAll(/scripts\/hooks\/[\w.-]+\.js/g)].map(match => match[0]))];
  assert.ok(refs.length > 0, 'expected hook script references');
  for (const ref of refs) assert.ok(fs.existsSync(path.join(REPO_ROOT, ref)), `missing ${ref}`);
});

test('allowlist ids all exist as top-level runtime ids or dispatcher sub-hooks', () => {
  const subIds = [...PRE_BASH_HOOKS, ...POST_BASH_HOOKS, ...SYNC_HOOKS, ...ASYNC_HOOKS].map(hook => hook.id);
  const text = fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8');
  const runtimeIds = [
    ...listHookIds(),
    ...[...text.matchAll(/run-with-flags\.js\s+([a-z0-9:-]+)/g)].map(match => match[1]),
    ...[...text.matchAll(/'((?:stop|session|pre|post)[a-z0-9:-]*)'/g)].map(match => match[1]),
  ];
  for (const id of setup.hooks.allow) {
    assert.ok(subIds.includes(id) || runtimeIds.includes(id), `allowlisted id ${id} is not wired anywhere`);
  }
});

test('allowlisted sub-hooks have their parent dispatchers allowlisted too', () => {
  const allow = new Set(setup.hooks.allow);
  const parents = new Map();
  for (const hook of SYNC_HOOKS) parents.set(hook.id, ['post:dispatcher:sync']);
  for (const hook of ASYNC_HOOKS) parents.set(hook.id, ['post:dispatcher:async']);
  for (const hook of POST_BASH_HOOKS) parents.set(hook.id, ['post:bash:dispatcher', 'post:dispatcher:async']);
  for (const [id, chain] of parents) {
    if (!allow.has(id)) continue;
    for (const parent of chain) assert.ok(allow.has(parent), `allowlisted id ${id} requires parent ${parent}`);
  }
  // PRE_BASH_HOOKS run under pre:bash:dispatcher, which is not gated at top level; it must be a kept hook.
  if (PRE_BASH_HOOKS.some(hook => allow.has(hook.id))) {
    assert.ok(slim.hooks.keep.includes('pre:bash:dispatcher'), 'pre:bash:dispatcher must be kept for allowlisted Bash sub-hooks');
  }
});

test('dispatcher sub-hooks are enabled exactly when allowlisted', () => {
  const allow = new Set(setup.hooks.allow);
  const env = forkEnv();
  for (const hook of [...PRE_BASH_HOOKS, ...POST_BASH_HOOKS, ...SYNC_HOOKS, ...ASYNC_HOOKS]) {
    assert.strictEqual(isHookEnabled(hook.id, { env, profiles: hook.profiles }), allow.has(hook.id), hook.id);
  }
});

test('ECC_HOOK_ALLOWLIST=off restores upstream profile gating', () => {
  const env = { ...forkEnv(), ECC_HOOK_ALLOWLIST: 'off' };
  assert.strictEqual(isHookEnabled('pre:bash:commit-quality', { env, profiles: 'strict' }), false);
  assert.strictEqual(isHookEnabled('pre:bash:gateguard-fact-force', { env, profiles: 'standard,strict' }), true);
});

test('GateGuard lets a routine first Bash command through', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-hooks-'));
  const result = runPreBash('ls -la', home);
  assert.ok(!isDenied(result), `routine command was denied: ${result.stdout}${result.stderr}`);
});

test('control: without the fork allowlist the routine first-Bash gate returns', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-hooks-'));
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-bash-dispatcher.js')], {
    cwd: home,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' }, session_id: 'fork-control', cwd: home }),
    encoding: 'utf8',
    env: forkEnv({ HOME: home, USERPROFILE: home, GATEGUARD_STATE_DIR: path.join(home, '.gateguard'), CLAUDE_PROJECT_DIR: home, ECC_HOOK_ALLOWLIST: 'off' }),
    timeout: 20000,
  });
  assert.ok(isDenied(result), 'expected upstream routine gate to deny the first Bash command');
});

test('GateGuard still blocks destructive Bash commands', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-hooks-'));
  runPreBash('ls', home);
  const result = runPreBash('rm -rf ./build-output', home);
  assert.ok(isDenied(result), `destructive command was not denied: ${result.stdout}${result.stderr}`);
});

test('block-no-verify still blocks git commit --no-verify', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-hooks-'));
  const result = runPreBash('git commit --no-verify -m "x"', home);
  assert.ok(isDenied(result), `--no-verify was not blocked: ${result.stdout}${result.stderr}`);
});

test('stop:cost-tracker writes a cost row under the allowlist', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-hooks-'));
  const transcript = path.join(home, 'transcript.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet', usage: { input_tokens: 10, output_tokens: 5 } } })}\n`);
  const result = spawnSync(process.execPath, [
    path.join(REPO_ROOT, 'scripts', 'hooks', 'run-with-flags.js'),
    'stop:cost-tracker', 'scripts/hooks/cost-tracker.js', 'minimal,standard,strict',
  ], {
    cwd: home,
    input: JSON.stringify({ session_id: 'fork-cost', transcript_path: transcript, cwd: home, hook_event_name: 'Stop' }),
    encoding: 'utf8',
    env: forkEnv({ HOME: home, USERPROFILE: home }),
    timeout: 20000,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'metrics', 'costs.jsonl')), 'costs.jsonl not written');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
