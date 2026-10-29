/**
 * Tests for the --help flag on every CLI in skills/harness-bootstrap/templates/scripts (biji-dev/ecc-js):
 * --help and -h print the usage on stdout and exit 0 without reading anything; an unknown flag is refused.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');

// Pinned: the number of CLIs in the scripts directory. Update it when one is added or removed.
const EXPECTED_CLIS = 14;

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

const created = [];
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

// Hermetic: an empty directory outside any repository, and an environment with nothing from a host or a hook.
const CWD = tmp('cli-help-cwd-');
const ENV = { HOME: tmp('cli-help-home-'), PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };

function run(cli, args) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, cli), ...args], {
    cwd: CWD,
    env: ENV,
    encoding: 'utf8',
    timeout: 10000,
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const clis = fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')).sort();

console.log('\nharness cli help: the CLIs');

test(`there are ${EXPECTED_CLIS} CLIs`, () => {
  assert.strictEqual(clis.length, EXPECTED_CLIS, clis.join(', '));
});

for (const cli of clis) {
  const name = cli.replace(/\.mjs$/, '');
  for (const flag of ['--help', '-h']) {
    test(`${name} ${flag} prints the usage on stdout and exits 0`, () => {
      const r = run(cli, [flag]);
      assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.out}${r.err}`);
      assert.strictEqual(r.err, '', `stderr: ${r.err}`);
      const first = r.out.split('\n')[0];
      assert.ok(first.startsWith('usage: '), `first line: ${first}`);
      assert.ok(first.includes(cli), `first line does not name ${cli}: ${first}`);
    });
  }
  test(`${name} refuses an unknown flag`, () => {
    const r = run(cli, ['--no-such-flag']);
    if (name === 'check-agent-docs') assert.strictEqual(r.status, 2, `exit ${r.status}\n${r.out}${r.err}`);
    else assert.notStrictEqual(r.status, 0, `exit ${r.status}\n${r.out}${r.err}`);
    assert.strictEqual(r.out, '', `stdout: ${r.out}`);
  });
}

test('run-counted passes --help after -- to the wrapped command', () => {
  const r = run('run-counted.mjs', ['--kind', 'node', '--min', '1', '--', process.execPath, '-e', '0', '--help']);
  assert.ok(!r.out.includes('usage: node scripts/run-counted.mjs'), `stdout: ${r.out}`);
});

for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
