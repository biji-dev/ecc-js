// harness-bootstrap run-counted tests (generated YYYY-MM-DD). Run: node --test scripts/lib/run-counted-core.test.mjs
// [M] mechanism (ships as-is): every test. Each kind's fixtures are real output, captured 2026-10-26:
// vitest 3.2.4 and 5.0.5, node 26.5.0 (TAP and spec reporters), pytest via uv, bun 1.3.6 and
// Playwright 1.58.2 (list reporter). Hermetic: the wrapper runs fake runners and node's own test
// runner on files in a temp directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BAD_COUNTERS, KINDS, SUMMARY_STREAM, nodeDirectiveMarkers, nodeOptionsProblem, parseArgs, parseSummary, stripAnsi, verdict } from './run-counted-core.mjs';

const WRAPPER = fileURLToPath(new URL('../run-counted.mjs', import.meta.url));
const ESC = '\u001b';

// ---- the pure core

test('parseArgs reads the kind, the floor and the command after --; anything else is a usage error', () => {
  assert.deepEqual(parseArgs(['--kind', 'vitest', '--min', '12', '--', 'pnpm', '-s', 'test']), { kind: 'vitest', min: 12, cmd: 'pnpm', args: ['-s', 'test'] });
  assert.deepEqual(KINDS, ['vitest', 'node', 'pytest', 'bun', 'playwright']);
  assert.deepEqual(KINDS.map((k) => SUMMARY_STREAM[k]), ['stdout', 'stdout', 'stdout', 'stderr', 'stdout']);
  const usage = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e.usage === true && re.test(e.message));
  usage(['--kind', 'vitest', '--min', '1', 'npm', 'test'], /missing `--`/);
  usage(['--kind', 'vitest', '--min', '1', '--'], /no command/);
  usage(['--kind', 'jest', '--min', '1', '--', 'jest'], /--kind must be one of: vitest, node, pytest, bun, playwright/);
  for (const min of [null, '0', '-3', '2.5', 'x']) usage(['--kind', 'bun', ...(min === null ? [] : ['--min', min]), '--', 'bun', 'test'], /--min must be an integer of 1 or more/);
  usage(['--kind', 'bun', '--kind', 'bun', '--min', '1', '--', 'bun', 'test'], /--kind given twice/);
  usage(['--kind', 'bun', '--min', '1', '--root', '.', '--', 'bun', 'test'], /unknown option: --root/);
  usage(['--kind', 'bun', '--min', '', '--', 'bun', 'test'], /--min needs a value/);
  for (const flag of ['--test-name-pattern=x', '--test-skip-pattern', '--test-only', '--test-shard=1/2']) usage(['--kind', 'node', '--min', '1', '--', 'node', '--test', flag, 'a.test.mjs'], /drops tests without counting them/);
  assert.equal(parseArgs(['--kind', 'vitest', '--min', '1', '--', 'vitest', 'run', '--test-name-pattern=x']).kind, 'vitest');
});

test('NODE_OPTIONS with any --test flag stops the run, quoted or not', () => {
  assert.equal(nodeOptionsProblem({}), null);
  assert.equal(nodeOptionsProblem({ NODE_OPTIONS: '--max-old-space-size=4096' }), null);
  for (const v of ['--test-only', '"--test-name-pattern=a b"', '--enable-source-maps --test-shard=1/3']) assert.match(nodeOptionsProblem({ NODE_OPTIONS: v }), /NODE_OPTIONS holds a --test flag .*the command was not run/);
});

// vitest 5.0.5 (vitest 3.2.4 prints the same summary): a pass, a skip, a todo and a failure in two files.
const VITEST = [
  ' Test Files  1 failed | 1 passed (2)',
  '      Tests  1 failed | 1 passed | 1 skipped | 1 todo (4)',
  '   Start at  19:22:38',
  '   Duration  92ms (transform 48%, import 27%, tests 14%, worker 11%)',
].join('\n');

test('vitest: the Tests line and every counter; Test Files and words elsewhere count for nothing; Errors counts', () => {
  assert.deepEqual(parseSummary('vitest', ` ✓ t/a.test.mjs (3 tests) 4ms\n   ✓ says 5 passed (5)\n${VITEST}\n`), { passed: 1, failed: 1, skipped: 1, todo: 1, unknown: [], problems: [] });
  assert.equal(parseSummary('vitest', ' Test Files  9 passed (9)\nTests 5 passed\n'), null);
  const errors = ' Test Files  1 passed (1)\n      Tests  2 passed (2)\n     Errors  1 error\n   Start at  19:23:49\n';
  assert.equal(parseSummary('vitest', errors).errors, 1);
  assert.deepEqual(verdict({ kind: 'vitest', min: 2, exitCode: 1, summary: parseSummary('vitest', errors) }).lines, ['run-counted: FAIL the command exited 1', 'run-counted: FAIL 1 errors (must be 0)']);
  assert.deepEqual(parseSummary('vitest', '      Tests  1 passed (7)\n').problems, ['the vitest parts add up to 1, not the total (7)']);
  assert.deepEqual(parseSummary('vitest', '      Tests  2 passed | 1 flaky (3)\n').unknown, ['1 flaky']);
});

test('vitest: colour is stripped (FORCE_COLOR=1, vitest 5.0.5)', () => {
  const coloured = `${ESC}[2m      Tests ${ESC}[22m ${ESC}[1m${ESC}[32m1 passed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[33m1 skipped${ESC}[39m${ESC}[2m | ${ESC}[22m${ESC}[90m1 todo${ESC}[39m${ESC}[90m (3)${ESC}[39m\n`;
  assert.deepEqual(parseSummary('vitest', coloured), { passed: 1, skipped: 1, todo: 1, unknown: [], problems: [] });
});

test('one summary only: a second vitest, pytest, bun or playwright summary is a problem', () => {
  const two = '      Tests  10 passed | 5 skipped (15)\n      Tests  3 passed (3)\n';
  assert.deepEqual(parseSummary('vitest', two).problems, ['2 vitest summary lines in the output (one expected)']);
  assert.deepEqual(parseSummary('pytest', '1 passed, 1 skipped in 0.01s\n2 passed in 0.01s\n').problems, ['2 pytest summary lines in the output (one expected)']);
  const bun = '\n 3 pass\n 0 fail\nRan 3 tests across 1 file. [5.00ms]\n';
  assert.deepEqual(parseSummary('bun', `${bun}${bun}`).problems, ['2 bun summary lines in the output (one expected)']);
  assert.deepEqual(parseSummary('playwright', '  2 skipped\n  1 passed (1.0s)\n  4 passed (2.0s)\n').problems, ['more than one playwright summary in the output (passed repeated)']);
  assert.equal(verdict({ kind: 'vitest', min: 1, exitCode: 0, summary: parseSummary('vitest', two) }).ok, false);
});

// node 26.5.0, `node --test --test-reporter=tap`: a pass, a describe.skip with a test inside, a todo.
const TAP = [
  'TAP version 13',
  '# Subtest: one',
  'ok 1 - one',
  '  ---',
  '  duration_ms: 0.4',
  "  type: 'test'",
  '  ...',
  '# Subtest: later',
  'ok 2 - later # SKIP',
  '# Subtest: two',
  'ok 3 - two # TODO',
  '1..3',
  '# tests 2',
  '# suites 1',
  '# pass 1',
  '# fail 0',
  '# cancelled 0',
  '# skipped 0',
  '# todo 1',
  '# duration_ms 36.695959',
].join('\n');

test("node (TAP): the top-level counters after the plan line; a skipped suite's result line is the only trace of it", () => {
  const s = parseSummary('node', TAP);
  assert.deepEqual(s, { passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 1, unknown: [], problems: [], markers: ['ok 2 - later # SKIP', 'ok 3 - two # TODO'] });
  assert.deepEqual(verdict({ kind: 'node', min: 1, exitCode: 0, summary: s }).lines, [
    'run-counted: FAIL 1 todo (must be 0)',
    'run-counted: FAIL skip, todo or expected-failure marker in the output: "ok 2 - later # SKIP"',
    'run-counted: FAIL skip, todo or expected-failure marker in the output: "ok 3 - two # TODO"',
  ]);
  const ok = '# tests 2\n# suites 0\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  // a console line a test prints is a TAP comment before the plan line: never a counter
  assert.deepEqual(parseSummary('node', `TAP version 13\n# items 2\n# pass 1\nok 1 - a\nok 2 - b\n1..2\n${ok}`).problems, []);
  assert.deepEqual(parseSummary('node', ok).problems, ['the TAP output has no top-level 1..N plan line before its summary']);
  assert.deepEqual(parseSummary('node', `    1..4\n${ok}`).problems, ['the TAP output has no top-level 1..N plan line before its summary']);
  // node 26.5.0's default reporter in a gate's log is spec, not TAP
  // its glyphs (U+2714, U+2139) are built here so no pictograph is in the file
  const [tick, info] = [0x2714, 0x2139].map((c) => String.fromCodePoint(c));
  const spec = `${tick} one (0.4ms)\n${['tests 2', 'suites 1', 'pass 1', 'fail 0', 'cancelled 0', 'skipped 0', 'todo 1'].map((l) => `${info} ${l}\n`).join('')}`;
  assert.deepEqual(parseSummary('node', spec).problems, ["a spec reporter's summary, not TAP: the node kind reads --test-reporter=tap"]);
  assert.equal(parseSummary('node', 'nothing ran\n'), null);
});

test('node (TAP): an escaped # is no directive; an unknown, repeated or missing counter, or tests != the sum, is a problem', () => {
  assert.deepEqual(nodeDirectiveMarkers(['ok 1 - a \\# SKIP', 'not ok 2 - b \\\\\\# TODO', '# ok 3 - c # SKIP', 'ok 4', '    ok 1 - in # SKIP'].join('\n')), ['ok 1 - in # SKIP']);
  const ok = '1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(parseSummary('node', `${ok}# xfail 2\n`).unknown, ['xfail 2']);
  assert.deepEqual(parseSummary('node', ok.replace('# tests 1\n', '# tests 1\n# tests 1\n')).problems, ['more than one node summary in the output (# tests repeated)']);
  assert.deepEqual(parseSummary('node', ok.replace('# tests 1', '# tests 3')).problems, ['# tests 3 is not pass + fail + cancelled + skipped + todo (1)']);
  assert.deepEqual(parseSummary('node', ok.replace('# todo 0\n', '')).problems, ['the node summary has no # todo line']);
});

test('pytest: the final counts line in any order, bare (-q) or between = rules; deselected and xfailed count', () => {
  assert.deepEqual(parseSummary('pytest', '============== 1 failed, 1 passed, 1 skipped, 1 xfailed in 0.02s ===============\n'), { passed: 1, failed: 1, skipped: 1, xfailed: 1, unknown: [], problems: [] });
  assert.deepEqual(parseSummary('pytest', '.                                                                        [100%]\n1 passed, 3 deselected in 0.00s\n'), { passed: 1, deselected: 3, unknown: [], problems: [] });
  // `-k` matching nothing: pytest exits 5
  const none = parseSummary('pytest', '============================ 4 deselected in 0.00s =============================\n');
  assert.deepEqual(verdict({ kind: 'pytest', min: 1, exitCode: 5, summary: none }).lines, ['run-counted: FAIL the command exited 5', 'run-counted: FAIL 4 deselected (must be 0)', 'run-counted: FAIL 0 passed, below --min 1']);
  assert.deepEqual(parseSummary('pytest', '3 passed, 2 warnings in 1.10s (0:00:01)\n').problems, []);
});

test('bun: the counter block that ends at its Ran line; filtered out, snapshot and colour lines', () => {
  const run = 'bun test v1.3.6 (d530ed99)\n\n 2 pass\n 1 skip\n 1 todo\n 0 fail\n 2 expect() calls\nRan 4 tests across 2 files. [12.00ms]\n';
  assert.deepEqual(parseSummary('bun', run), { passed: 2, skipped: 1, todo: 1, failed: 0, unknown: [], problems: [] });
  const failing = '(fail) five [0.44ms]\n\n 2 pass\n 1 skip\n 1 todo\n 1 fail\n 3 expect() calls\nRan 5 tests across 3 files. [5.00ms]\n';
  assert.equal(parseSummary('bun', failing).failed, 1);
  const filtered = parseSummary('bun', '\n 1 pass\n 3 filtered out\n 0 fail\n 1 expect() calls\nRan 1 test across 2 files. [12.00ms]\n');
  assert.deepEqual(verdict({ kind: 'bun', min: 1, exitCode: 0, summary: filtered }).lines, ['run-counted: FAIL 3 filtered out (must be 0)']);
  for (const snap of ['snapshots: +1 added\n 1 expect() calls', ' 1 snapshots, 1 expect() calls']) {
    assert.deepEqual(parseSummary('bun', `\n 1 pass\n 0 fail\n${snap}\nRan 1 test across 1 file. [5.00ms]\n`).problems, []);
  }
  const coloured = `${ESC}[0m${ESC}[1mbun test ${ESC}[0m${ESC}[2mv1.3.6 (d530ed99)${ESC}[0m\n\n${ESC}[0m${ESC}[32m 1 pass${ESC}[0m\n${ESC}[0m${ESC}[2m 0 fail${ESC}[0m\n 1 expect() calls\nRan 1 test across 1 file. ${ESC}[0m${ESC}[2m[${ESC}[1m4.00ms${ESC}[0m${ESC}[2m]${ESC}[0m\n`;
  assert.deepEqual(parseSummary('bun', coloured), { passed: 1, failed: 0, unknown: [], problems: [] });
  assert.deepEqual(parseSummary('bun', '\n 1 pass\n 0 fail\nRan 3 tests across 1 file. [1.00ms]\n').problems, ['pass + skip + todo + fail is 1, not the 3 tests bun ran']);
  assert.deepEqual(parseSummary('bun', '\n 1 pass\nRan 1 test across 1 file. [1.00ms]\n').problems, ['the bun summary has no fail line']);
  // `bun test -t nomatch` prints no summary
  assert.equal(parseSummary('bun', 'error: regex "nomatch" matched 0 tests. Searched 2 files (skipping 4 tests) [12.00ms]\n'), null);
});

test("playwright: each count on its own line, the tests listed below; flaky, interrupted, not run and errors fail", () => {
  const run = [
    '  1 failed',
    '    t/a.spec.mjs:5:1 › broken ──────────────────────',
    '  1 flaky',
    '    t/a.spec.mjs:4:1 › flaky ───────────────────────',
    '  1 skipped',
    '  1 passed (1.3s)',
  ].join('\n');
  assert.deepEqual(parseSummary('playwright', run), { passed: 1, failed: 1, flaky: 1, skipped: 1, unknown: [], problems: [] });
  const rest = parseSummary('playwright', '  1 interrupted\n    t/a.spec.mjs:9:1 › slow\n  2 did not run\n  3 passed (2.1m)\n  2 errors were not a part of any test, see above for details\n');
  assert.deepEqual(verdict({ kind: 'playwright', min: 3, exitCode: 1, summary: rest }).lines, [
    'run-counted: FAIL the command exited 1',
    'run-counted: FAIL 2 errors (must be 0)',
    'run-counted: FAIL 1 interrupted (must be 0)',
    'run-counted: FAIL 2 not run (must be 0)',
  ]);
  assert.deepEqual(parseSummary('playwright', `${ESC}[32m  1 passed${ESC}[39m${ESC}[2m (441ms)${ESC}[22m\n`), { passed: 1, unknown: [], problems: [] });
  assert.equal(parseSummary('playwright', '  1 error was not a part of any test, see above for details\n').errors, 1);
  // a flaky test passed on a retry, and playwright exits 0
  const flaky = parseSummary('playwright', '  1 flaky\n    t/a.spec.mjs:4:1 › flaky\n  2 passed (1.0s)\n');
  assert.deepEqual(verdict({ kind: 'playwright', min: 2, exitCode: 0, summary: flaky }).lines, ['run-counted: FAIL 1 flaky (must be 0)']);
  // `--pass-with-no-tests` with a grep that matches nothing exits 0 and prints no summary
  assert.equal(parseSummary('playwright', 'Running 0 tests using 0 workers\n'), null);
  assert.equal(parseSummary('playwright', '    2 passed (1.0s)\n'), null);
});

test('counter words are own keys only, and colour is the one escape stripped', () => {
  for (const w of ['constructor', '__proto__', 'toString']) {
    assert.deepEqual(parseSummary('bun', `\n 1 pass\n 1 ${w}\n 0 fail\nRan 1 test across 1 file. [1.00ms]\n`).unknown, [`1 ${w}`]);
  }
  assert.deepEqual(parseSummary('vitest', '      Tests  1 passed | 1 constructor (2)\n').unknown, ['1 constructor']);
  assert.deepEqual(parseSummary('pytest', '1 passed, 1 constructor in 0.01s\n').unknown, ['1 constructor']);
  assert.equal(stripAnsi(`${ESC}[1;32mok${ESC}[0m`), 'ok');
  assert.equal(stripAnsi(`${ESC}]8;;https://x${ESC}\\link${ESC}]8;;${ESC}\\`), `${ESC}]8;;https://x${ESC}\\link${ESC}]8;;${ESC}\\`);
});

test('verdict: success ends with exactly the COUNTED line, above the floor with the raise hint; every reason is a line', () => {
  const s = parseSummary('vitest', '      Tests  52 passed (52)\n');
  assert.deepEqual(verdict({ kind: 'vitest', min: 52, exitCode: 0, summary: s }), { ok: true, lines: ['COUNTED vitest 52 passed (min 52)'] });
  assert.deepEqual(verdict({ kind: 'vitest', min: 50, exitCode: 0, summary: s }).lines, ['run-counted: 50 → 52: raise --min in scripts/run-gates.sh', 'COUNTED vitest 52 passed (min 50)']);
  assert.deepEqual(verdict({ kind: 'vitest', min: 60, exitCode: 0, summary: s }).lines, ['run-counted: FAIL 52 passed, below --min 60']);
  assert.deepEqual(BAD_COUNTERS, ['failed', 'errors', 'skipped', 'todo', 'flaky', 'interrupted', 'not run', 'cancelled', 'filtered out', 'deselected', 'xfailed', 'xpassed']);
  const all = Object.fromEntries(BAD_COUNTERS.map((c) => [c, 1]));
  const bad = verdict({ kind: 'bun', min: 1, exitCode: 0, summary: { passed: 1, unknown: ['2 odd'], problems: [], ...all } });
  assert.deepEqual(bad.lines, [...BAD_COUNTERS.map((c) => `run-counted: FAIL 1 ${c} (must be 0)`), 'run-counted: FAIL unknown counter in the summary: "2 odd"']);
  assert.deepEqual(verdict({ kind: 'bun', min: 1, exitCode: null, signal: 'SIGTERM', summary: null }).lines, [
    'run-counted: FAIL the command was killed by SIGTERM',
    'run-counted: FAIL no bun summary line in the output: nothing ran, or it ran somewhere this gate does not read',
  ]);
  assert.match(verdict({ kind: 'bun', min: 1, exitCode: null, spawnError: 'spawn nope ENOENT', summary: null }).lines[0], /FAIL the command did not start: spawn nope ENOENT/);
  assert.ok(bad.lines.every((l) => !l.startsWith('COUNTED')));
});

// ---- the wrapper

const tempDirs = [];
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});
function tmp() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'run-counted-')));
  tempDirs.push(d);
  return d;
}

/** A runner that prints `out` on stdout (and `err` on stderr) and exits `code`. */
function fakeRunner(dir, out, { code = 0, err = '' } = {}) {
  const file = path.join(dir, `fake-${tempDirs.length}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, `process.stdout.write(${JSON.stringify(out)});\nprocess.stderr.write(${JSON.stringify(err)});\nprocess.exitCode = ${code};\n`);
  return [process.execPath, file];
}

function wrap(args, env = {}) {
  const base = { ...process.env };
  delete base.NODE_OPTIONS;
  // node --test marks its children with NODE_TEST_CONTEXT: a nested `node --test` that inherits it
  // reports to this run instead of printing its own TAP
  delete base.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [WRAPPER, ...args], { encoding: 'utf8', env: { ...base, ...env } });
}

test('the wrapper: a passing run ends with COUNTED; a skip, a floor above the count or a non-zero exit fails', () => {
  const d = tmp();
  const pass = wrap(['--kind', 'vitest', '--min', '3', '--', ...fakeRunner(d, '      Tests  3 passed (3)\n')]);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.equal(pass.stdout.trim().split('\n').at(-1), 'COUNTED vitest 3 passed (min 3)');
  const skip = wrap(['--kind', 'vitest', '--min', '2', '--', ...fakeRunner(d, '      Tests  2 passed | 1 skipped (3)\n')]);
  assert.equal(skip.status, 1);
  assert.match(skip.stdout, /^run-counted: FAIL 1 skipped \(must be 0\)$/m);
  assert.equal(wrap(['--kind', 'vitest', '--min', '4', '--', ...fakeRunner(d, '      Tests  3 passed (3)\n')]).status, 1);
  const exit = wrap(['--kind', 'vitest', '--min', '3', '--', ...fakeRunner(d, '      Tests  3 passed (3)\n', { code: 2 })]);
  assert.equal(exit.status, 1);
  assert.match(exit.stdout, /^run-counted: FAIL the command exited 2$/m);
});

test('the wrapper: nothing ran is a FAIL — a filter that matched nothing, a summary on the wrong stream, a missing binary', () => {
  const d = tmp();
  const none = wrap(['--kind', 'vitest', '--min', '1', '--', ...fakeRunner(d, 'No projects matched the filters in "/repo"\n')]);
  assert.equal(none.status, 1);
  assert.match(none.stdout, /^run-counted: FAIL no vitest summary line in the output: nothing ran/m);
  assert.equal(wrap(['--kind', 'vitest', '--min', '1', '--', ...fakeRunner(d, '', { err: '      Tests  3 passed (3)\n' })]).status, 1);
  // bun 1.3 prints its version line on stdout and its results on stderr
  const bun = '\n 1 pass\n 0 fail\nRan 1 test across 1 file. [1.00ms]\n';
  assert.equal(wrap(['--kind', 'bun', '--min', '1', '--', ...fakeRunner(d, 'bun test v1.3.6 (d530ed99)\n', { err: bun })]).status, 0);
  assert.equal(wrap(['--kind', 'bun', '--min', '1', '--', ...fakeRunner(d, bun)]).status, 1);
  const missing = wrap(['--kind', 'bun', '--min', '1', '--', path.join(d, 'no-such-runner')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /^run-counted: FAIL the command did not start: /m);
  // the child's output ended without a newline: COUNTED still starts a line
  const tail = wrap(['--kind', 'vitest', '--min', '1', '--', ...fakeRunner(d, '      Tests  1 passed (1)\nno newline')]);
  assert.match(tail.stdout, /^COUNTED vitest 1 passed \(min 1\)$/m);
});

test("the wrapper over node's own runner: TAP passes, a skipped suite fails, the spec reporter names the fix, a filter is a usage error", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'a.test.mjs'), "import { test } from 'node:test';\ntest('one', () => {});\ntest('two', () => {});\n");
  fs.writeFileSync(path.join(d, 'b.test.mjs'), "import { describe, test } from 'node:test';\ntest('one', () => {});\ndescribe.skip('later', () => { test('inner', () => {}); });\n");
  const tap = (file, extra = []) => wrap(['--kind', 'node', '--min', '1', '--', process.execPath, '--test', '--test-reporter=tap', ...extra, path.join(d, file)]);
  const ok = tap('a.test.mjs');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^COUNTED node 2 passed \(min 1\)$/m);
  const skipped = tap('b.test.mjs');
  assert.equal(skipped.status, 1);
  assert.match(skipped.stdout, /^run-counted: FAIL skip, todo or expected-failure marker in the output: "ok 2 - later # SKIP"$/m);
  const spec = wrap(['--kind', 'node', '--min', '1', '--', process.execPath, '--test', '--test-reporter=spec', path.join(d, 'a.test.mjs')]);
  assert.equal(spec.status, 1);
  assert.match(spec.stdout, /the node kind reads --test-reporter=tap/);
  assert.equal(tap('a.test.mjs', ['--test-name-pattern=one']).status, 2);
});

test('the wrapper: a --test flag in its own NODE_OPTIONS fails before the command runs; a usage error exits 2', () => {
  const d = tmp();
  const marker = path.join(d, 'ran');
  const r = wrap(['--kind', 'node', '--min', '1', '--', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, '')`], { NODE_OPTIONS: '--test-only' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^run-counted: FAIL NODE_OPTIONS holds a --test flag/m);
  assert.ok(!fs.existsSync(marker), 'the command ran');
  const usage = wrap(['--kind', 'vitest', '--', 'vitest']);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /^run-counted: --min must be an integer[^\n]*\nusage: node scripts\/run-counted\.mjs --kind/);
});
