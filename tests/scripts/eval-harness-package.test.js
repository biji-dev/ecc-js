'use strict';

// Aggregation contract for the eval-harness suites. The npm tarball cases were
// removed in the slim fork, which does not publish to npm.
// Run serially: node tests/scripts/eval-harness-package.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, tempDir, cleanup, finish } = require('../lib/eval-harness/helpers');

const repo = path.resolve(__dirname, '../..');
const work = tempDir('package smoke');
const childEnv = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' };
const command = (binary, args, options = {}) => spawnSync(binary, args, {
  encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  env: childEnv, ...options,
});

// Match the actual aggregation contract in tests/run-all.js.
function counts(stdout) {
  const passed = stdout.match(/Passed:\s*(\d+)/);
  const failed = stdout.match(/Failed:\s*(\d+)/);
  assert.ok(passed && failed, 'result tokens must be parseable by tests/run-all.js');
  return { passed: Number(passed[1]), failed: Number(failed[1]) };
}

try {
  test('aggregator regexes count every real framework check accurately', () => {
    const suites = fs.readdirSync(path.join(repo, 'tests/lib/eval-harness')).filter(file => file.endsWith('.test.js')).sort();
    let total = 0;
    for (const suite of suites) {
      const result = command(process.execPath, [path.join(repo, 'tests/lib/eval-harness', suite)], { cwd: work });
      assert.strictEqual(result.status, 0, `${suite}: ${result.error?.message || result.stderr || result.stdout}`);
      const parsed = counts(result.stdout);
      const actualPassed = (result.stdout.match(/^\s*✓ /gm) || []).length;
      const actualFailed = (result.stdout.match(/^\s*✗ /gm) || []).length;
      assert.deepStrictEqual(parsed, { passed: actualPassed, failed: actualFailed }, suite);
      assert.ok(actualPassed > 0, `${suite} must run actual checks`);
      assert.strictEqual(parsed.failed, 0);
      total += parsed.passed;
    }
    assert.ok(suites.length > 0);
    console.log(`    framework aggregation: ${suites.length} suites, ${total} actual checks`);
  });

  test('failed checks remain visible to aggregation and return a failing exit', () => {
    const helper = path.join(repo, 'tests/lib/eval-harness/helpers.js');
    const script = `const h=require(${JSON.stringify(helper)});h.test('pass fixture',()=>{});h.test('failure fixture',()=>{throw new Error('synthetic failure');});h.finish('count fixture');`;
    const result = command(process.execPath, ['-e', script], { cwd: work });
    assert.strictEqual(result.status, 1);
    assert.deepStrictEqual(counts(result.stdout), { passed: 1, failed: 1 });
  });
} finally {
  cleanup(work);
}

finish('eval-harness package');
