/**
 * Fork plugin manifests (biji-dev/ecc-js): replaces the upstream
 * plugin-manifest test, whose npm/OpenCode/version-equality assertions do not
 * apply to the slim fork.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { runChecks } = require('../../fork/bin/lib/checks');
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
  assert.ok(claude.hooks.SessionStart.some(entry => entry.id === 'session:start'), 'Claude hooks lack session:start');
});

test('bundled MCP config keeps chrome-devtools only', () => {
  const mcp = readJson('.mcp.json');
  assert.deepStrictEqual(Object.keys(mcp.mcpServers), ['chrome-devtools']);
});

test('fork invariants hold (verify checks without drift)', () => {
  const { errors } = runChecks({ drift: false, kimi: true });
  assert.deepStrictEqual(errors, []);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
