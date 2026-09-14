/**
 * Fork plugin manifests (biji-dev/ecc-js): replaces the upstream
 * plugin-manifest test, whose npm/OpenCode/version-equality assertions do not
 * apply to the slim fork.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { runChecks, danglingReferences, bumpCheck } = require('../../fork/bin/lib/checks');
const { mergeHooksMetadata } = require('../../scripts/lib/hooks-config');

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

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

const state = readJson('fork/state.json');
const expectedVersion = `${state.upstreamVersion}-js.${state.pluginBuild}`;

console.log('\n=== fork plugin manifests ===\n');

test('Claude plugin keeps the ecc identity and component shape', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.strictEqual(plugin.name, 'ecc');
  assert.strictEqual(plugin.version, expectedVersion);
  assert.ok(!('agents' in plugin), 'plugin.json must not declare agents');
  assert.ok(!('hooks' in plugin), 'plugin.json must not declare hooks');
  assert.deepStrictEqual(plugin.skills, ['./skills/']);
  assert.deepStrictEqual(plugin.commands, ['./commands/']);
  assert.deepStrictEqual(plugin.mcpServers, {});
});

test('Claude marketplace serves the repo root as plugin ecc', () => {
  const marketplace = readJson('.claude-plugin/marketplace.json');
  assert.strictEqual(marketplace.name, 'ecc');
  assert.strictEqual(marketplace.plugins[0].name, 'ecc');
  assert.strictEqual(marketplace.plugins[0].source, './');
  assert.strictEqual(marketplace.plugins[0].version, expectedVersion);
});

test('Codex manifests point at existing slim surfaces', () => {
  for (const file of ['.codex-plugin/plugin.json', 'plugins/ecc/.codex-plugin/plugin.json']) {
    const manifest = readJson(file);
    assert.strictEqual(manifest.name, 'ecc', file);
    assert.strictEqual(manifest.version, expectedVersion, file);
    const base = path.dirname(path.dirname(path.join(REPO_ROOT, file)));
    for (const key of ['skills', 'mcpServers', 'hooks']) {
      if (manifest[key]) assert.ok(fs.existsSync(path.resolve(base, manifest[key])), `${file} ${key} -> ${manifest[key]}`);
    }
  }
  const agentsMarketplace = readJson('.agents/plugins/marketplace.json');
  assert.strictEqual(agentsMarketplace.plugins[0].version, expectedVersion);
});

test('Codex SessionStart hook mirrors the Claude session:start hook id', () => {
  const codex = readJson('hooks/codex-hooks.json');
  assert.deepStrictEqual(Object.keys(codex.hooks), ['SessionStart']);
  assert.strictEqual(codex.hooks.SessionStart[0].id, 'session:start');
  const claude = mergeHooksMetadata(readJson('hooks/hooks.json'), readJson('hooks/hooks.metadata.json'));
  assert.ok(
    claude.hooks.SessionStart.some(entry => entry.id === 'session:start'),
    'Claude hooks lack session:start'
  );
});

test('bundled MCP config keeps chrome-devtools only', () => {
  const mcp = readJson('.mcp.json');
  assert.deepStrictEqual(Object.keys(mcp.mcpServers), ['chrome-devtools']);
});

test('fork invariants hold (verify checks without drift)', () => {
  const { errors } = runChecks({ drift: false, kimi: true, since: null });
  assert.deepStrictEqual(errors, []);
});

test('README carries one fork banner and live directory-tree counts', () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  assert.strictEqual(readme.split('<!-- ecc-js:banner -->').length - 1, 1, 'banner must appear exactly once');
  const live = {
    skills: fs.readdirSync(path.join(REPO_ROOT, 'skills')).filter(name => fs.existsSync(path.join(REPO_ROOT, 'skills', name, 'SKILL.md'))).length,
    agents: fs.readdirSync(path.join(REPO_ROOT, 'agents')).filter(name => name.endsWith('.md')).length,
    commands: fs.readdirSync(path.join(REPO_ROOT, 'commands')).filter(name => name.endsWith('.md')).length
  };
  const trees = [...readme.matchAll(/^\|-- (agents|skills|commands)\/\s+# (\d+)/gm)];
  assert.ok(trees.length >= 3, 'expected directory-tree count lines in README.md');
  for (const [, kind, count] of trees) assert.strictEqual(Number(count), live[kind], `README tree count for ${kind}`);
});

test('Codex project guidance names no dropped catalog items', () => {
  const { loadSlim, loadQueue } = require('../../fork/bin/lib/config');
  const hits = danglingReferences(loadSlim(), loadQueue()).filter(hit => hit.startsWith('.codex/AGENTS.md:'));
  assert.deepStrictEqual(hits, []);
});

test('bump check skips without a usable base', () => {
  assert.deepStrictEqual(bumpCheck(state, null), []);
  assert.deepStrictEqual(bumpCheck(state, '0000000000000000000000000000000000000000'), []);
  assert.deepStrictEqual(bumpCheck(state, 'ffffffffffffffffffffffffffffffffffffffff'), []);
  assert.deepStrictEqual(bumpCheck(state, 'HEAD'), []);
});

test('bump check flags shipped changes without a build bump', () => {
  // bc9900e2 is the slim migration merge (2.2.1-js.1); later commits changed shipped files.
  const base = 'bc9900e2';
  const { spawnSync } = require('child_process');
  if (spawnSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: REPO_ROOT }).status !== 0) return;
  const baseState = JSON.parse(spawnSync('git', ['show', `${base}:fork/state.json`], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout);
  const changed = spawnSync('git', ['diff', '--name-only', base, 'HEAD', '--', 'scripts', 'skills', '.codex'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
  if (!changed) return;
  assert.strictEqual(bumpCheck(baseState, base).length, 1);
  assert.deepStrictEqual(bumpCheck({ ...baseState, pluginBuild: baseState.pluginBuild + 1 }, base), []);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
