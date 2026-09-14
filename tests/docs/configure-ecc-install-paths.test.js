'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function readConfigureEccDoc(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

console.log('\n=== Testing configure-ecc install path guidance ===\n');

test('Codex legacy sync docs do not require an unrelated package install', () => {
  const content = readConfigureEccDoc('.codex-plugin/README.md');

  assert.ok(content.includes('bash scripts/sync-ecc-to-codex.sh'));
  assert.ok(!content.includes('npm install && bash scripts/sync-ecc-to-codex.sh'));
});

test('Kimi docs scope hooks and compatibility to the verified adapter', () => {
  const content = readConfigureEccDoc('.kimi/README.md');

  assert.ok(content.includes('verified against Kimi Code 0.31.x'));
  assert.ok(content.includes("newer provider releases are outside this adapter's verified range"));
  assert.ok(content.includes('does not configure or map provider lifecycle hooks'));
  assert.ok(!content.includes('Kimi Code 0.31.x does not expose'));
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
