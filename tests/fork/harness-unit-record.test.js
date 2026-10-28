/**
 * Tests for the harness-bootstrap unit-record template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'unit-record-core.test.mjs');
const CORE_REL = path.join('lib', 'unit-record-core.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 40;

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

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Env with a fresh HOME and no GIT_* variable; `extra` is applied last (the decoy test sets GIT_*). */
function hermeticEnv(cleanup, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.HOME = tmp('unit-record-suite-home-');
  cleanup.push(env.HOME);
  return { ...env, ...extra };
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(scriptsDir, cleanup, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(scriptsDir, TEST_REL)],
    { encoding: 'utf8', env: hermeticEnv(cleanup, extraEnv), timeout: 120_000 },
  );
}

/** Run git in `cwd` with only hermetic GIT_* variables; returns trimmed stdout. */
function git(cwd, ...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}

const cleanup = [];

/** Copy the shipped scripts, apply a one-line mutation to the core (or `fileRel`), and assert the suite fails. */
function mutantFails(name, needle, replacement, fileRel = CORE_REL) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('unit-record-mutant-');
    cleanup.push(copy);
    fs.cpSync(SCRIPTS, copy, { recursive: true });
    const corePath = path.join(copy, fileRel);
    const before = fs.readFileSync(corePath, 'utf8');
    const mutated = before.replace(needle, replacement);
    assert.notStrictEqual(mutated, before, 'the mutation did not apply');
    fs.writeFileSync(corePath, mutated);
    const res = runSuite(copy, cleanup);
    const out = res.stdout + res.stderr;
    assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
    assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
  });
}

console.log('\nharness-bootstrap unit-record template');

test('the shipped unit-record suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
});

mutantFails('counting a finding another source also reported as unique', 'f.also.length === 0 &&', 'true &&');
mutantFails('splitting a table row on an escaped pipe', "if (ch === '\\\\' && text[i + 1] === '|') {", "if (false && text[i + 1] === '|') {");
mutantFails('counting retracted findings in the severity totals', "if (f.status === 'retracted') continue;", 'if (false) continue;');
mutantFails('counting auditor-lane findings as defects', 'if (!AUDITOR_SOURCE.test(f.source)) {', 'if (true) {');
mutantFails('taking the first SUMMARY line instead of the last', 'all[all.length - 1][0].trim()', 'all[0][0].trim()');
mutantFails('dropping the first-heading fallback for the unit', "header.unit === '' && title !== null", "false && title !== null");
mutantFails('reading a two-column header table as nothing', 'kvTable = cells.length === 2;', 'kvTable = false;');
mutantFails('printing wall time as work time', 'wallMs - wait.ms', 'wallMs');
mutantFails('letting a newline in the cost line break the draft row', ".replace(/[\\r\\n]+/g, ' ')", '');
mutantFails('measuring a deliverable from the unit claim', 'h.deliverableStarted || h.claimed', 'h.claimed');
mutantFails('counting owner-wait pairs from before the deliverable started', 'if (Number.isFinite(since) && to <= since) continue;', '');
mutantFails('listing every commit instead of capping the list', 'commits.slice(0, MAX_COMMITS)', 'commits');
mutantFails('counting a step again on its later ledger rows', 'if (seen.has(id)) return `(${id} above)`;', '');
mutantFails('reading a Gate row as no step', ".replace(/^Gate (\\d+)(?=\\s|$)/i, 'g$1')", '');
mutantFails('leaving the open step without a time up to now', 'stepIntervals(markers, Date.parse(now))', 'stepIntervals(markers)');
mutantFails('dropping the Steps line', '...(times ? [`- Steps: ${times.line}`] : []),', '');
mutantFails('reading a bare 0 owner wait as unreadable', "if (term === '0') continue;", '');
mutantFails('swapping the Yield and Friction columns of the draft row', "'Yield by source',\n  'Friction',", "'Friction',\n  'Yield by source',");
mutantFails('ignoring the bound log columns', '${columns.map((name) => logCell(name, known)).join', '${LOG_COLUMNS.map((name) => logCell(name, known)).join');
mutantFails('ignoring --steps', "if (args.steps) steps = parseSteps(readFile(args.steps, 'steps file'));", '', 'unit-record.mjs');

test('the core\'s default LOG_COLUMNS are log-format.md\'s columns, in its order, and each one has a cell (Yield, Friction, Missed)', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'skills', 'harness-bootstrap', 'reference', 'log-format.md'), 'utf8');
  const columns = [];
  for (const line of doc.slice(doc.indexOf('| Unit · Mode · Type · Tier')).split('\n')) {
    if (!line.startsWith('| ')) break;
    columns.push(line.split(' | ')[0].replace(/^\| /, '').replace(/[*★]/g, '').trim());
  }
  const core = path.join(SCRIPTS, CORE_REL);
  const probe = `
    import { LOG_COLUMNS, buildRecord, parseState } from ${JSON.stringify(pathToFileURL(core).href)};
    const state = parseState('Unit: U-1\\nClaimed: 2026-10-24T03:10:00Z\\n\\n## Findings\\n| ID | Sev | Source | Also | Status | Note |\\n|---|---|---|---|---|---|\\n| F-1 | P1 | codex-review | | fixed abc1234 | a |\\n');
    const rec = buildRecord({ state, commits: [], diffstat: '', gatesSummary: null, now: '2026-10-24T06:22:00Z' });
    const lines = rec.split('\\n');
    process.stdout.write(JSON.stringify({ columns: LOG_COLUMNS, row: lines[lines.indexOf('Draft log row:') + 1] }));
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', env: hermeticEnv(cleanup) });
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.deepStrictEqual(out.columns.map((c) => c.replace(/[*★]/g, '').trim()), columns);
  const cells = out.row.slice(2, -2).split(' | ');
  assert.strictEqual(cells.length, columns.length, `${cells.length} cells for ${columns.length} columns`);
  assert.strictEqual(cells[columns.indexOf('Yield by source')], 'codex-review 0/1/0');
  assert.match(cells[columns.indexOf('Friction')], /friction/);
  assert.match(cells[columns.indexOf('Missed by harness')], /missed by harness/);
  for (const [i, name] of columns.entries()) assert.ok(!cells[i].startsWith(`<fill: ${name}>`), `${name} has no cell of its own`);
});

test('a suite run with GIT_DIR and GIT_INDEX_FILE set (as inside a git hook) leaves that repo untouched', () => {
  const decoy = tmp('unit-record-decoy-');
  cleanup.push(decoy);
  git(decoy, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(decoy, 'f.txt'), 'x\n');
  git(decoy, 'add', '.');
  git(decoy, 'commit', '-q', '-m', 'base');
  const snapshot = () => ({
    log: git(decoy, 'log', '--all', '--format=%H'),
    branches: git(decoy, 'branch', '--format=%(refname)'),
    status: git(decoy, 'status', '--porcelain'),
  });
  const before = snapshot();
  const res = runSuite(SCRIPTS, cleanup, {
    GIT_DIR: path.join(decoy, '.git'),
    GIT_WORK_TREE: decoy,
    GIT_INDEX_FILE: path.join(decoy, '.git', 'index'),
  });
  const out = res.stdout + res.stderr;
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS, out.slice(-1500));
  assert.deepStrictEqual(snapshot(), before, 'the suite wrote into the repository named by GIT_DIR');
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
