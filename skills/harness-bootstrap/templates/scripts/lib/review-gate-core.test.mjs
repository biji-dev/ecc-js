// harness-bootstrap review-gate tests (generated YYYY-MM-DD). Run: node --test scripts/lib/review-gate-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: the block below -- EXPECTED_CRITICAL (the
// risk map's critical paths, kept equal to the core's CRITICAL), the paths the core's NON_PRODUCTION
// and TESTS must classify, and the paths its INSTRUCTIONS must name and must not; keep them
// matching the core. Only the [B] tests read the core's bound values (and one shape test each);
// every behaviour test runs under INJECTED, the tests' own copy of the template's bindings, with
// CRITICAL set per call, so a project's bindings never change what they assert. FIX_LINES is read
// relatively (FIX_LINES, FIX_LINES + 1), which holds for any value.
// Hermetic: the one wrapper test runs in a temp git repo with GIT_* variables stripped and no
// global git config; no network, no real repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CRITICAL,
  FIX_LINES,
  GUARDS,
  HARNESS,
  INSTRUCTIONS,
  LANDING_KINDS,
  NON_PRODUCTION,
  ROLES,
  STAKES,
  TESTS,
  TRIGGERS,
  WRITERS,
  decide as decideCore,
  blocksDiffer,
  formatLanding,
  formatLine,
  harnessBlocks,
  isGuard,
  isHarness,
  isInstruction,
  isProduction,
  isTest,
  landing as landingCore,
  parseArgs,
  parseNumstat,
  qualifyingRows,
  readStakes,
  writerRole,
} from './review-gate-core.mjs';

const RUNNER = fileURLToPath(new URL('../review-gate.mjs', import.meta.url));

// The bindings every behaviour test runs under: copies of the template's values, the tests' own
// fixtures (they need not match a project's). CRITICAL is empty here; withCritical sets it per call.
const INJECTED = {
  CRITICAL: [],
  NON_PRODUCTION: [/\.md$/, /^docs\//, /(^|\/)(__tests__|tests?|e2e|fixtures)\//, /\.(test|spec)\.[cm]?[jt]sx?$/],
  TESTS: [/(^|\/)(__tests__|tests?|e2e)\//, /\.(test|spec)\.[cm]?[jt]sx?$/],
  INSTRUCTIONS: [/(^|\/)(AGENTS|CLAUDE)\.md$/, /^\.(claude|agents|codex|zcode)\//],
  HARNESS: [/(^|\/)(AGENTS|CLAUDE)\.md$/, /^\.(claude|agents|codex|zcode)\//, /^\.githooks\//, /^scripts\//],
  GUARDS: [
    /^(AGENTS|CLAUDE)\.md$/,
    /^\.githooks\//,
    /^\.claude\/(settings(\.local)?\.json|hooks\/|agents\/)/,
    /^\.codex\/(hooks\.json|config\.toml|agents\/)/,
    /^\.agents\/(harness-manifest\.json|harness-models\.json|skills\/task-runner\/)/,
    /^\.claude\/skills\/task-runner(\/|$)/,
    /^scripts\/(run-gates\.sh|run-counted\.mjs|review-gate\.mjs|check-agent-docs\.mjs|codex-run\.mjs|claude-run\.mjs)$/,
    /^scripts\/lib\/(run-counted-core|review-gate-core|snapshot-tree|run-sources|unit-cost-core|unit-step-core|harness-host-core|codex-run-core|claude-run-core)\.mjs$/,
  ],
  TRIGGERS: {
    'security-reviewer': [/auth|session|token|crypto|permission|rbac|tenant|webhook|public/i],
    'silent-failure-hunter': [/payment|billing|money|settle|ledger|invoice|refund|webhook|queue|job|notif/i],
    'database-reviewer': [/(^|\/)migrations?\//i, /(^|\/)drizzle\//i, /\.sql$/i, /(^|\/)schema\.(ts|js|prisma|sql)$/i],
  },
};
// the paths INJECTED's INSTRUCTIONS names: instruction files, then tests in an instruction directory
const INSTRUCTION_FIXTURES = ['AGENTS.md', 'CLAUDE.md', 'packages/a/AGENTS.md', '.claude/agents/x.md', '.claude/skills/x/SKILL.md', '.claude/rules/x.md', '.agents/skills/x/SKILL.md', '.codex/config.toml', '.zcode/skills/x/SKILL.md'];
const INSTRUCTION_TEST_FIXTURES = ['.agents/skills/checker/tests/checker.test.js', '.claude/hooks/x.test.mjs'];

let injecting = 0;
/**
 * Run `fn` with the core's bindings replaced by INJECTED (and `overrides`), then restore them. The
 * core reads its arrays and TRIGGERS live, so they are spliced and reassigned in place, in key order.
 */
function withBindings(overrides, fn) {
  const want = { ...INJECTED, ...overrides };
  const arrays = { CRITICAL, NON_PRODUCTION, TESTS, INSTRUCTIONS, HARNESS, GUARDS };
  const saved = {};
  for (const [name, arr] of Object.entries(arrays)) saved[name] = arr.splice(0, arr.length, ...want[name]);
  const savedTriggers = { ...TRIGGERS };
  const assign = (from) => {
    for (const key of Object.keys(TRIGGERS)) delete TRIGGERS[key];
    Object.assign(TRIGGERS, from);
  };
  assign(want.TRIGGERS);
  injecting += 1;
  try {
    return fn();
  } finally {
    injecting -= 1;
    for (const [name, arr] of Object.entries(arrays)) arr.splice(0, arr.length, ...saved[name]);
    assign(savedTriggers);
  }
}
/** Run `fn` under INJECTED, unless a caller already injected (then its CRITICAL holds). */
const injected = (fn) => (injecting > 0 ? fn() : withBindings({}, fn));
/** Run `fn` under INJECTED with CRITICAL bound to `patterns`. */
const withCritical = (patterns, fn) => withBindings({ CRITICAL: patterns }, fn);
const bound = (fn) => withCritical([/^src\/core\//], fn);

// `writer` has no default in the core; the tests that are not about the writer name Opus ('claude').
const decide = (o) => injected(() => decideCore({ writer: 'claude', ...o }));
const f = (p, lines) => ({ path: p, lines });
// a numstat record: what parseNumstat returns and what the CLI builds for an untracked file
const ns = (p, added, deleted, binary = false) => ({ path: p, lines: added + deleted, added, deleted, binary });
const COLD = 'src/ui/panel.tsx';
const HOT = 'src/core/engine.ts';
const TEST_FILE = 'src/core/engine.test.ts';

// ---- [B] the risk map's critical paths: keep this equal to the core's CRITICAL
const EXPECTED_CRITICAL = [];
// what the core's NON_PRODUCTION and TESTS must classify so: production, not production, tests
const PRODUCTION_PATHS = ['src/a.ts'];
const NON_PRODUCTION_PATHS = [
  'README.md',
  'docs/x.ts',
  'src/__tests__/a.ts',
  'tests/a.js',
  'test/a.js',
  'e2e/a.ts',
  'src/fixtures/a.json',
  'src/a.test.ts',
  'src/a.spec.mjs',
];
const TEST_PATHS = ['src/__tests__/a.ts', 'tests/a.js', 'test/a.js', 'e2e/a.ts', 'src/a.test.ts', 'src/a.spec.mjs'];
// the harness's own instruction files and host config: keep these matching INSTRUCTIONS
const INSTRUCTION_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  'packages/a/AGENTS.md',
  '.claude/agents/x.md',
  '.claude/skills/x/SKILL.md',
  '.claude/rules/x.md',
  '.agents/skills/x/SKILL.md',
  '.codex/config.toml',
  '.zcode/skills/x/SKILL.md',
];
// tests in an instruction directory: tests, not production
const INSTRUCTION_TEST_PATHS = ['.agents/skills/checker/tests/checker.test.js', '.claude/hooks/x.test.mjs'];
// prose INSTRUCTIONS must not name: the first three stay docs
const DOCS_PATHS = ['README.md', 'docs/a.md', 'packages/a/README.md', 'notes/AGENTS.md.bak'];
// the harness lane's paths beyond the instruction files: keep these matching HARNESS (an install adds its
// harness scripts and records folder); PRODUCT_PATHS are no harness path
const HARNESS_PATHS = ['.githooks/pre-commit', '.githooks/pre-merge-commit'];
const PRODUCT_PATHS = ['src/a.ts', 'app/src/main.tsx', 'README.md'];
// ---- end [B]
const DOCS_ONLY = /^no production code and no tests: docs only$/;

// ---- the bound values: the [B] tests read them, the shape tests read their shape only

test('[B] the core\'s CRITICAL is EXPECTED_CRITICAL, pattern for pattern', () => {
  const shape = (list) => list.map((re) => `${re.source} /${re.flags}`);
  assert.deepEqual(
    shape(CRITICAL),
    shape(EXPECTED_CRITICAL),
    `the core's CRITICAL [${CRITICAL.join(', ')}] is not the test's EXPECTED_CRITICAL [${EXPECTED_CRITICAL.join(', ')}]: keep both on the risk map`,
  );
});

test('[B] the core classifies PRODUCTION_PATHS, NON_PRODUCTION_PATHS and TEST_PATHS so', () => {
  for (const p of PRODUCTION_PATHS) assert.ok(isProduction(p), `${p} is not production`);
  for (const p of NON_PRODUCTION_PATHS) assert.ok(!isProduction(p), `${p} is production`);
  for (const p of TEST_PATHS) assert.ok(isTest(p), `${p} is not a test`);
});

const regexps = (v) => Array.isArray(v) && v.every((re) => re instanceof RegExp);
for (const [name, value, ok, what] of [
  ['CRITICAL', CRITICAL, regexps(CRITICAL), 'an array of RegExp'],
  ['NON_PRODUCTION', NON_PRODUCTION, regexps(NON_PRODUCTION) && NON_PRODUCTION.length > 0, 'a non-empty array of RegExp'],
  ['TESTS', TESTS, regexps(TESTS) && TESTS.length > 0, 'a non-empty array of RegExp'],
  ['INSTRUCTIONS', INSTRUCTIONS, regexps(INSTRUCTIONS) && INSTRUCTIONS.length > 0, 'a non-empty array of RegExp'],
  ['HARNESS', HARNESS, regexps(HARNESS) && HARNESS.length > 0, 'a non-empty array of RegExp'],
  ['GUARDS', GUARDS, regexps(GUARDS) && GUARDS.length > 0, 'a non-empty array of RegExp'],
  [
    'TRIGGERS',
    TRIGGERS,
    Object.getPrototypeOf(TRIGGERS) === Object.prototype &&
      Object.entries(TRIGGERS).every(([k, v]) => /^[a-z][a-z0-9-]*$/.test(k) && regexps(v) && v.length > 0),
    'a plain object of reviewer name to a non-empty array of RegExp',
  ],
  ['FIX_LINES', FIX_LINES, Number.isInteger(FIX_LINES) && FIX_LINES > 0, 'a positive integer'],
])
  test(`the bound ${name} is ${what}`, () => {
    const shown = Array.isArray(value) || typeof value !== 'object' ? String(value) : Object.keys(value).join(', ');
    assert.ok(ok, `the core's ${name} is not ${what}: ${shown}`);
  });

test('[B] the core\'s GUARDS hold every file the landing check runs: unit-cost-core and unit-step-core too', () => {
  // the guard runs the mainline's scripts/review-gate.mjs and what it imports: run-sources.mjs imports
  // unit-cost-core.mjs, which imports unit-step-core.mjs. One of them unguarded is an exit 0 on import.
  for (const p of ['scripts/review-gate.mjs', 'scripts/lib/review-gate-core.mjs', 'scripts/lib/harness-host-core.mjs', 'scripts/lib/run-sources.mjs', 'scripts/lib/unit-cost-core.mjs', 'scripts/lib/unit-step-core.mjs'])
    assert.ok(isGuard(p), `${p} is not in the core's GUARDS: the landing check imports it`);
});

test('[B] the harness paths are the instruction files plus HARNESS_PATHS; a product path is none', () => {
  for (const p of [...INSTRUCTION_PATHS, ...INSTRUCTION_TEST_PATHS, ...HARNESS_PATHS]) assert.ok(isHarness(p), `${p} is not a harness path`);
  for (const p of PRODUCT_PATHS) assert.ok(!isHarness(p), `${p} is a harness path`);
});

test('[B] the instruction files are production, whatever NON_PRODUCTION says; prose elsewhere stays docs', () => {
  assert.ok(INSTRUCTIONS.length > 0);
  for (const p of INSTRUCTION_PATHS) {
    assert.ok(isInstruction(p), `${p} is not an instruction file`);
    assert.ok(isProduction(p), `${p} is not production`);
  }
  for (const p of INSTRUCTION_TEST_PATHS) {
    assert.ok(isInstruction(p), `${p} is not in an instruction directory`);
    assert.ok(isTest(p), `${p} is not a test`);
    assert.ok(!isProduction(p), `${p} is a test, not production`);
  }
  for (const p of DOCS_PATHS) assert.ok(!isInstruction(p), `${p} is an instruction file`);
  for (const p of DOCS_PATHS.slice(0, 3)) assert.ok(!isProduction(p), `${p} is production`);
});

test('parseNumstat sums added and deleted, binary files count 0, tabs in a path survive', () => {
  assert.deepEqual(parseNumstat('3\t4\ta.ts\n-\t-\timg.png\n0\t2\tdir/we\tird.ts\n'), [
    ns('a.ts', 3, 4),
    ns('img.png', 0, 0, true),
    ns('dir/we\tird.ts', 0, 2),
  ]);
  assert.deepEqual(parseNumstat(''), []);
});

test('parseNumstat reads the -z form, where git never quotes a path', () => {
  assert.deepEqual(
    parseNumstat('2\t1\tsrc/core/odd\tname.ts\0-\t-\tsrc/core/runtime.wasm\x000\t1\tsrc/a "q".ts\0'),
    [ns('src/core/odd\tname.ts', 2, 1), ns('src/core/runtime.wasm', 0, 0, true), ns('src/a "q".ts', 0, 1)],
  );
  // so a critical path with an odd name stays critical
  const r = bound(() =>
    decide({ files: parseNumstat('2\t1\tsrc/core/odd\tname.ts\0'), kind: 'fix', maxFixed: 'P1', round: 3 }),
  );
  assert.equal(r.decision, 'adversarial');
});

test('parseNumstat keeps added, deleted and binary apart: a pure addition, a deletion, a binary', () => {
  const [add, del, bin] = parseNumstat('12\t0\tsrc/a.test.ts\x000\t3\tsrc/b.ts\0-\t-\tsrc/c.png\0');
  assert.deepEqual([add.added, add.deleted, add.binary, add.lines], [12, 0, false, 12]);
  assert.deepEqual([del.added, del.deleted, del.binary, del.lines], [0, 3, false, 3]);
  assert.deepEqual([bin.added, bin.deleted, bin.binary, bin.lines], [0, 0, true, 0]);
});

// ---- kind slice

test('slice 1: an empty or docs-only slice is skipped; a test in it is reviewed', () => {
  for (const files of [[], [f('docs/x.md', 90)]]) {
    const r = bound(() => decide({ files, kind: 'slice' }));
    assert.equal(r.decision, 'skip');
    assert.deepEqual(r.reviewers, []);
    assert.match(r.reason, DOCS_ONLY);
  }
  // docs plus a test is not docs only; a cold test slice by the second family waits for the unit
  const withTest = bound(() => decide({ files: [f('docs/x.md', 90), f(TEST_FILE, 40)], kind: 'slice' }));
  assert.equal(withTest.decision, 'second-family');
  assert.equal(decide({ files: [f(TEST_FILE, 9)], kind: 'slice', writer: 'codex' }).decision, 'defer');
});

test('slice 2: a cold slice written by the second family is deferred to the unit review', () => {
  const r = bound(() => decide({ files: [f(COLD, 80)], kind: 'slice', writer: 'codex' }));
  assert.equal(r.decision, 'defer');
  assert.deepEqual(r.reviewers, []);
  assert.match(r.reason, /unit review covers it/);
});

test('slice 3: critical code written by the second family gets a Claude reviewer now', () => {
  const r = bound(() =>
    decide({ files: [f(HOT, 5), f(COLD, 5)], kind: 'slice', writer: 'codex' }),
  );
  assert.equal(r.decision, 'required');
  assert.deepEqual(r.reviewers, ['opus-code-reviewer']);
  assert.match(r.reason, /critical code written by the second family \(an owner override, executor: codex\): Opus reviews it now/);
  assert.doesNotMatch(r.reason, /should not go/);
  assert.ok(r.reason.endsWith(`now (${HOT})`), r.reason);
  assert.deepEqual(r.critical, [HOT]);
});

test('slice 4: otherwise the slice review goes to the second family, cold or critical', () => {
  for (const file of [COLD, HOT]) {
    const r = bound(() => decide({ files: [f(file, 30)], kind: 'slice' }));
    assert.equal(r.decision, 'second-family', file);
    assert.deepEqual(r.reviewers, ['second-family-review'], file);
  }
});

// ---- kind unit

test('unit 1: a docs-only unit is skipped, at either tier', () => {
  for (const tier of ['small', 'full']) {
    const r = decide({ files: [f('docs/a.md', 50)], kind: 'unit', tier });
    assert.equal(r.decision, 'skip');
    assert.match(r.reason, DOCS_ONLY);
  }
});

test('a binary or mode-only production file (0 lines) is still a change to review', () => {
  const bin = [f('src/core/runtime.wasm', 0)];
  assert.equal(bound(() => decide({ files: bin, kind: 'slice' })).decision, 'second-family');
  assert.equal(bound(() => decide({ files: bin, kind: 'unit' })).decision, 'review');
  const r = bound(() => decide({ files: bin, kind: 'fix', maxFixed: 'P1', round: 3 }));
  assert.equal(r.decision, 'adversarial');
  assert.equal(r.prodFiles, 1);
  assert.equal(r.prodLines, 0);
});

test('unit 2: a small unit is reviewed by the OTHER family, plus matching specialists', () => {
  const claude = decide({ files: [f(COLD, 20)], kind: 'unit', tier: 'small' });
  assert.equal(claude.decision, 'review');
  assert.deepEqual(claude.reviewers, ['second-family-review']);
  const codex = decide({ files: [f(COLD, 20)], kind: 'unit', tier: 'small', writer: 'codex' });
  assert.deepEqual(codex.reviewers, ['sonnet-code-reviewer']);
  const withDb = decide({
    files: [f(COLD, 20), f('db/migrations/001_init.sql', 9)],
    kind: 'unit',
    tier: 'small',
  });
  assert.deepEqual(withDb.reviewers, ['second-family-review', 'database-reviewer']);
  const small = decide({
    files: [f('src/auth/login.ts', 9)],
    kind: 'unit',
    tier: 'small',
    writer: 'codex',
  });
  assert.deepEqual(small.reviewers, ['sonnet-code-reviewer', 'security-reviewer']);
});

test('unit 3: a full unit is Opus + adversarial, then specialists in TRIGGERS order, then the test analyzer', () => {
  const plain = decide({ files: [f(COLD, 20)], kind: 'unit' });
  assert.equal(plain.decision, 'review');
  assert.deepEqual(plain.reviewers, ['opus-code-reviewer', 'second-family-adversarial']);
  // Paths listed in the reverse of the TRIGGERS key order: the output still follows the keys.
  const all = decide({
    files: [
      f('db/migrations/002_add.sql', 4),
      f('src/billing/invoice.ts', 4),
      f('src/auth/session.ts', 4),
      f(TEST_FILE, 30),
    ],
    kind: 'unit',
  });
  assert.deepEqual(all.reviewers, [
    'opus-code-reviewer',
    'second-family-adversarial',
    'security-reviewer',
    'silent-failure-hunter',
    'database-reviewer',
    'pr-test-analyzer',
  ]);
  // database-reviewer fires only on migration / schema paths, never on a plain source path.
  assert.ok(!plain.reviewers.includes('database-reviewer'));
  assert.ok(
    decide({ files: [f('src/db/schema.ts', 3)], kind: 'unit' }).reviewers.includes('database-reviewer'),
  );
  // A non-production path never calls a specialist: a test under a trigger calls the analyzer only.
  const testOnlyTrigger = decide({ files: [f(COLD, 5), f('src/auth/login.test.ts', 5)], kind: 'unit' });
  assert.deepEqual(testOnlyTrigger.reviewers, [
    'opus-code-reviewer',
    'second-family-adversarial',
    'pr-test-analyzer',
  ]);
});

test('unit 4: the harness lane is one cross-family review over a harness-only diff, critical or not, no specialist', () => {
  const lane = [f('AGENTS.md', 12), f('.githooks/pre-commit', 30), f('scripts/check-agent-docs.mjs', 8), f('scripts/lib/auth-token.test.mjs', 40)];
  for (const [writer, reviewer] of [['claude', 'second-family-review'], ['sonnet', 'second-family-review'], ['codex', 'sonnet-code-reviewer'], ['mixed', 'sonnet-code-reviewer']]) {
    const r = withCritical([/^\.githooks\//], () => decide({ files: lane, kind: 'unit', tier: 'harness', writer }));
    assert.equal(r.decision, 'review', writer);
    assert.deepEqual(r.reviewers, [reviewer], writer);
    assert.match(r.reason, /^harness lane: one cross-family review over the diff/);
  }
  // docs alone is still skipped
  assert.equal(decide({ files: [f('docs/harness/log.md', 3)], kind: 'unit', tier: 'harness' }).decision, 'skip');
  // a doc outside HARNESS (the unit's record, a README) leaves the lane as it is: no tier reviews a doc
  const withDocs = decide({ files: [...lane, f('docs/harness/log.md', 3), f('README.md', 2)], kind: 'unit', tier: 'harness' });
  assert.match(withDocs.reason, /^harness lane: /);
  assert.equal(withDocs.reviewers.length, 1);
  // a path outside HARNESS: the full lineup, and the unit is told to re-tier
  const stray = decide({ files: [...lane, f('app/src/main.tsx', 4)], kind: 'unit', tier: 'harness' });
  assert.deepEqual(stray.reviewers.slice(0, 2), ['opus-code-reviewer', 'second-family-adversarial']);
  assert.match(stray.reason, /; path outside HARNESS at --tier harness \(app\/src\/main\.tsx\): reviewed as full, re-tier the unit$/);
  const two = decide({ files: [...lane, f('app/src/main.tsx', 4), f('src/a.ts', 1)], kind: 'unit', tier: 'harness' });
  assert.match(two.reason, /\(app\/src\/main\.tsx \+1\)/);
});

// ---- kind fix

test('fix: kind fix needs a valid --max-fixed', () => {
  for (const maxFixed of [undefined, null, 'P4', 'p1', '']) {
    assert.throws(
      () => decide({ files: [f(COLD, 1)], kind: 'fix', maxFixed }),
      /--max-fixed must be one of P0\|P1\|P2\|P3/,
    );
  }
  // Not needed for the other kinds.
  assert.doesNotThrow(() => decide({ files: [f(COLD, 1)], kind: 'slice' }));
});

test('fix 1: a round that fixed only P3s is the P3 batch with no re-review, whatever the diff', () => {
  for (const files of [[f(HOT, 300)], [f(COLD, 3)], [f(TEST_FILE, 9)]]) {
    const r = bound(() => decide({ files, kind: 'fix', maxFixed: 'P3' }));
    assert.equal(r.decision, 'p3-batch');
    assert.deepEqual(r.reviewers, []);
    assert.match(r.reason, /P3s never open a fix round/);
  }
});

test('fix 1b: a P3 batch over critical code that Opus did not write is read by the Opus reviewer, no specialist', () => {
  const writers = [
    ['sonnet', 'Sonnet'],
    ['codex', 'the second family'],
    ['mixed', 'several executors'],
    [writerRole('bounded', 'codex'), 'Sonnet'],
    [writerRole('second', 'codex'), 'the second family'],
  ];
  for (const file of [HOT, TEST_FILE])
    for (const [writer, name] of writers) {
      const r = bound(() => decide({ files: [f(file, 9)], kind: 'fix', maxFixed: 'P3', writer }));
      assert.equal(r.decision, 'review', `a P3 batch over ${file} by ${writer} is not reviewed`);
      assert.deepEqual(r.reviewers, ['opus-code-reviewer'], `${file} by ${writer}`);
      assert.equal(r.reason, `the P3 batch over critical code was written by ${name}, so Opus reads it (${file})`);
    }
  // Opus's own batch, and cold code or docs by anyone, stay the P3 batch with no re-review
  for (const [files, writer] of [
    [[f(HOT, 9)], 'claude'],
    [[f(TEST_FILE, 9)], 'claude'],
    ...writers.flatMap(([w]) => [[[f(COLD, 9)], w], [[f('docs/x.md', 9)], w], [[f(COLD, 9), f('docs/x.md', 9)], w]]),
  ]) {
    const r = bound(() => decide({ files, kind: 'fix', maxFixed: 'P3', writer }));
    assert.equal(r.decision, 'p3-batch', `${files.map((x) => x.path).join(' ')} by ${writer} is not the P3 batch`);
    assert.deepEqual(r.reviewers, [], `${files.map((x) => x.path).join(' ')} by ${writer}`);
  }
  // a triggered specialist does not join it: P3s are nits
  const auth = withCritical([/^src\/auth\//], () =>
    decide({ files: [f('src/auth/login.ts', 5)], kind: 'fix', maxFixed: 'P3', writer: 'sonnet' }),
  );
  assert.deepEqual(auth.reviewers, ['opus-code-reviewer'], 'a specialist joined the P3 batch');
});

test('fix 2: a fix round of docs alone is skipped', () => {
  const r = bound(() => decide({ files: [f('docs/x.md', 200)], kind: 'fix', maxFixed: 'P1' }));
  assert.equal(r.decision, 'skip');
  assert.deepEqual(r.reviewers, []);
  assert.match(r.reason, DOCS_ONLY);
});

test('fix 3: a cold fix round is reviewed by the second family once, never again', () => {
  const r1 = bound(() => decide({ files: [f(COLD, 80)], kind: 'fix', maxFixed: 'P1', round: 1 }));
  assert.equal(r1.decision, 'second-family');
  assert.deepEqual(r1.reviewers, ['second-family-review']);
  for (const round of [2, 3, 7]) {
    const r = bound(() => decide({ files: [f(COLD, 80)], kind: 'fix', maxFixed: 'P1', round }));
    assert.equal(r.decision, 'skip', `round ${round}`);
    assert.match(r.reason, /regression tests prove it/);
  }
});

test('fix 8: the specialist whose trigger the fix hits joins its re-review', () => {
  const auth = [f('src/auth/login.ts', 5)];
  const r1 = decide({ files: auth, kind: 'fix', maxFixed: 'P1', round: 1 });
  assert.equal(r1.decision, 'second-family');
  assert.deepEqual(r1.reviewers, ['second-family-review', 'security-reviewer']);
  // a cold round 2 is otherwise skipped; with a trigger hit, the specialist alone re-reads it
  const r2 = decide({ files: auth, kind: 'fix', maxFixed: 'P2', round: 2 });
  assert.equal(r2.decision, 'review');
  assert.deepEqual(r2.reviewers, ['security-reviewer']);
  assert.match(r2.reason, /triggered specialist/);
  // critical, round 3: adversarial plus the specialist; P3 stays the P3 batch
  const hot = [f('src/core/migrations/0002.sql', 90)];
  const r3 = bound(() => decide({ files: hot, kind: 'fix', maxFixed: 'P1', round: 3 }));
  assert.deepEqual(r3.reviewers, ['second-family-adversarial', 'database-reviewer']);
  assert.equal(decide({ files: auth, kind: 'fix', maxFixed: 'P3' }).decision, 'p3-batch');
});

test('fix 9: the harness lane has one fix round, re-read by the other family; a second is adversarial, a third drops the change', () => {
  const lane = [f('.githooks/pre-commit', 30), f('CLAUDE.md', 4)];
  const r1 = withCritical([/^\.githooks\//], () => decide({ files: lane, kind: 'fix', tier: 'harness', maxFixed: 'P1', round: 1 }));
  assert.equal(r1.decision, 'second-family');
  assert.deepEqual(r1.reviewers, ['second-family-review']);
  assert.match(r1.reason, /^harness lane, fix round 1: the second family re-reads the fix/);
  const c1 = decide({ files: lane, kind: 'fix', tier: 'harness', maxFixed: 'P2', round: 1, writer: 'codex' });
  assert.deepEqual([c1.decision, c1.reviewers], ['review', ['sonnet-code-reviewer']]);
  // round 2: an adversarial pass by the family that did not write the fix, run without asking
  for (const [writer, reviewer] of [['claude', 'second-family-adversarial'], ['sonnet', 'opus-adversarial'], ['codex', 'opus-adversarial']]) {
    const r = decide({ files: lane, kind: 'fix', tier: 'harness', maxFixed: 'P2', round: 2, writer });
    assert.equal(r.decision, 'adversarial', writer);
    assert.deepEqual(r.reviewers, [reviewer], writer);
    assert.match(r.reason, /^harness lane, fix round 2: /);
    assert.doesNotMatch(r.reason, /owner/);
  }
  // round 3 and later: drop the change, one line in the upstream notes, no reviewer
  for (const round of [3, 4, 8]) {
    const r = decide({ files: lane, kind: 'fix', tier: 'harness', maxFixed: 'P1', round });
    assert.equal(r.decision, 'drop', `round ${round}`);
    assert.deepEqual(r.reviewers, [], `round ${round}`);
    assert.match(r.reason, new RegExp(`^harness lane, fix round ${round}: drop the change`));
    assert.match(r.reason, /docs\/harness\/upstream-notes\.md/);
    assert.doesNotMatch(r.reason, /owner/);
  }
  // P3s stay the P3 batch; a stray path takes the ordinary fix rules
  assert.equal(withCritical([/^\.githooks\//], () => decide({ files: lane, kind: 'fix', tier: 'harness', maxFixed: 'P3', writer: 'codex' })).decision, 'p3-batch');
  const stray = decide({ files: [...lane, f(COLD, 9)], kind: 'fix', tier: 'harness', maxFixed: 'P1', round: 2 });
  assert.equal(stray.decision, 'skip');
});

test('fix 4: on critical code round 3 is an adversarial pass, round 4 a redesign, round 5 and later a cut', () => {
  for (const [writer, reviewer] of [['claude', 'second-family-adversarial'], ['sonnet', 'opus-adversarial']]) {
    for (const maxFixed of ['P1', 'P2', 'P0']) {
      const r3 = bound(() => decide({ files: [f(HOT, 5)], kind: 'fix', maxFixed, round: 3, writer }));
      assert.equal(r3.decision, 'adversarial', `${writer} ${maxFixed} round 3`);
      assert.deepEqual(r3.reviewers, [reviewer], `${writer} ${maxFixed} round 3`);
      assert.match(r3.reason, /an adversarial pass over the fix diff/);
      assert.match(r3.reason, /run without asking/);
      const r4 = bound(() => decide({ files: [f(HOT, 5)], kind: 'fix', maxFixed, round: 4, writer }));
      assert.equal(r4.decision, 'redesign', `${writer} ${maxFixed} round 4`);
      assert.deepEqual(r4.reviewers, [reviewer], `${writer} ${maxFixed} round 4`);
      assert.match(r4.reason, /the judgment model re-plans this area once/);
      assert.match(r4.reason, /reviews the new approach/);
    }
    for (const round of [5, 6, 9]) {
      const r = bound(() => decide({ files: [f(HOT, 5)], kind: 'fix', maxFixed: 'P1', round, writer }));
      assert.equal(r.decision, 'cut', `${writer} round ${round}`);
      assert.deepEqual(r.reviewers, [], `${writer} round ${round}`);
      assert.match(r.reason, /cut the area \(flag-off or out of the diff\), land what is green, file one follow-up/);
      assert.match(r.reason, /parks only when the way forward is never-auto/);
    }
  }
  // no round tells anyone to ask the owner
  for (const round of [3, 4, 5])
    for (const writer of ['claude', 'sonnet', 'codex', 'mixed'])
      assert.doesNotMatch(bound(() => decide({ files: [f(HOT, 5)], kind: 'fix', maxFixed: 'P1', round, writer })).reason, /owner/);
  // a cut has no reviewer, so a triggered specialist does not join it either
  const cut = withCritical([/^src\/auth\//], () => decide({ files: [f('src/auth/login.ts', 5)], kind: 'fix', maxFixed: 'P1', round: 5 }));
  assert.deepEqual([cut.decision, cut.reviewers], ['cut', []]);
  const redesign = withCritical([/^src\/auth\//], () => decide({ files: [f('src/auth/login.ts', 5)], kind: 'fix', maxFixed: 'P1', round: 4 }));
  assert.deepEqual(redesign.reviewers, ['second-family-adversarial', 'security-reviewer']);
});

test('fix 5: critical code with a P2 fixed is re-reviewed by the second family, however big', () => {
  const r = bound(() =>
    decide({ files: [f(HOT, FIX_LINES * 5)], kind: 'fix', maxFixed: 'P2', round: 2 }),
  );
  assert.equal(r.decision, 'second-family');
  assert.deepEqual(r.reviewers, ['second-family-review']);
});

test('fix 6: critical code with a P1 fixed in at most FIX_LINES lines skips the Opus pass', () => {
  for (const maxFixed of ['P1', 'P0']) {
    const r = bound(() => decide({ files: [f(HOT, FIX_LINES)], kind: 'fix', maxFixed }));
    assert.equal(r.decision, 'second-family', maxFixed);
    assert.deepEqual(r.reviewers, ['second-family-review'], maxFixed);
  }
  // Lines of non-production files in the round do not count.
  const withTests = bound(() =>
    decide({ files: [f(HOT, FIX_LINES), f(TEST_FILE, 500)], kind: 'fix', maxFixed: 'P1' }),
  );
  assert.equal(withTests.decision, 'second-family');
});

test('fix 7: critical code with a P1 fixed in more than FIX_LINES lines adds Opus, rounds 1 and 2', () => {
  for (const [maxFixed, round] of [['P1', 1], ['P1', 2], ['P0', 1]]) {
    const r = bound(() =>
      decide({ files: [f(HOT, FIX_LINES + 1)], kind: 'fix', maxFixed, round }),
    );
    assert.equal(r.decision, 'second-family+opus', `${maxFixed} round ${round}`);
    assert.deepEqual(r.reviewers, ['second-family-review', 'opus-code-reviewer']);
    assert.match(r.reason, /at most two Opus rounds/);
  }
});

// ---- a fix written by the second family is re-read by Claude

const codexFix = (files, maxFixed, round = 1) =>
  bound(() => decide({ files, kind: 'fix', writer: 'codex', maxFixed, round }));

test('fix codex 1: a cold round 1 fix by the second family goes to a Sonnet reviewer', () => {
  const r = codexFix([f(COLD, 80)], 'P1');
  assert.equal(r.decision, 'review');
  assert.deepEqual(r.reviewers, ['sonnet-code-reviewer']);
  assert.match(r.reason, /cold fix round 1 written by the second family: a Claude reviewer \(Sonnet\) re-reads the fix/);
});

test('fix codex 2: a cold round 2+ fix by the second family is still skipped', () => {
  for (const round of [2, 3, 7]) {
    const r = codexFix([f(COLD, 80)], 'P1', round);
    assert.equal(r.decision, 'skip', `round ${round}`);
    assert.deepEqual(r.reviewers, []);
    assert.match(r.reason, /regression tests prove it/);
  }
});

test('fix codex 3: critical P2 fixed by the second family is re-read by Opus, however big', () => {
  const r = codexFix([f(HOT, FIX_LINES * 5)], 'P2', 2);
  assert.equal(r.decision, 'review');
  assert.deepEqual(r.reviewers, ['opus-code-reviewer']);
  assert.match(r.reason, /P2 fixed: the fix was written by the second family, so Opus reads it/);
});

test('fix codex 4: critical P1 fixed in at most FIX_LINES lines is re-read by Opus, no second family', () => {
  for (const maxFixed of ['P1', 'P0']) {
    const r = codexFix([f(HOT, FIX_LINES)], maxFixed);
    assert.equal(r.decision, 'review', maxFixed);
    assert.deepEqual(r.reviewers, ['opus-code-reviewer'], maxFixed);
    assert.match(r.reason, new RegExp(`<= ${FIX_LINES} production lines: the fix was written by the second family`));
  }
});

test('fix codex 5: critical P1 fixed in more than FIX_LINES lines is re-read by Opus alone', () => {
  const r = codexFix([f(HOT, FIX_LINES + 1)], 'P1');
  assert.equal(r.decision, 'review');
  assert.deepEqual(r.reviewers, ['opus-code-reviewer']);
  assert.match(r.reason, new RegExp(`> ${FIX_LINES} production lines: the fix was written by the second family`));
  assert.match(r.reason, /at most two Opus rounds/);
});

test('fix codex 6: critical rounds 3 and 4 by the second family are read by an Opus adversarial pass', () => {
  for (const [round, decision] of [[3, 'adversarial'], [4, 'redesign']]) {
    const r = codexFix([f(HOT, 5)], 'P1', round);
    assert.equal(r.decision, decision, `round ${round}`);
    assert.deepEqual(r.reviewers, ['opus-adversarial']);
    assert.match(r.reason, /the adversarial pass by Opus \(the fix was not written by Opus\)/);
    // the reason names the reviewer the routing names
    const claude = bound(() => decide({ files: [f(HOT, 5)], kind: 'fix', maxFixed: 'P1', round }));
    assert.deepEqual(claude.reviewers, ['second-family-adversarial']);
    assert.match(claude.reason, /the adversarial pass by the second family/);
  }
  assert.equal(codexFix([f(HOT, 5)], 'P1', 5).decision, 'cut');
});

test('fix codex 7: triggered specialists still join a codex fix re-review', () => {
  const r = decide({ files: [f('src/auth/login.ts', 5)], kind: 'fix', writer: 'codex', maxFixed: 'P1' });
  assert.deepEqual(r.reviewers, ['sonnet-code-reviewer', 'security-reviewer']);
});

test('unit codex: a full unit written by the second family keeps Opus first and says it is the cross-family review', () => {
  const r = decide({ files: [f(COLD, 20)], kind: 'unit', writer: 'codex' });
  assert.deepEqual(r.reviewers, ['opus-code-reviewer', 'second-family-adversarial']);
  assert.match(r.reason, /; the unit was written by the second family, so the Opus code-reviewer is the cross-family review$/);
  assert.doesNotMatch(decide({ files: [f(COLD, 20)], kind: 'unit' }).reason, /second family/);
});

// ---- tests and the harness's instruction files are reviewed; docs alone skip

const FULL_WITH_TESTS = ['opus-code-reviewer', 'second-family-adversarial', 'pr-test-analyzer'];
const RE_TIER = /; critical path at --tier small \((.+)\): reviewed as full, re-tier the row$/;

test('reviewed 1: a test under a critical path is critical, and its unit is reviewed as full at either tier', () => {
  for (const tier of ['small', 'full']) {
    const r = bound(() => decide({ files: [f(TEST_FILE, 30)], kind: 'unit', tier }));
    assert.equal(r.decision, 'review', tier);
    assert.deepEqual(r.reviewers, FULL_WITH_TESTS, tier);
    assert.deepEqual(r.critical, [TEST_FILE], tier);
    assert.match(r.reason, /; tests only, no production code/, tier);
    assert.equal(r.testFiles, 1, tier);
    assert.equal(r.prodLines, 0, tier);
  }
  const small = bound(() => decide({ files: [f(TEST_FILE, 30)], kind: 'unit', tier: 'small' }));
  assert.equal(small.reason.match(RE_TIER)?.[1], TEST_FILE, small.reason);
  const full = bound(() => decide({ files: [f(TEST_FILE, 30)], kind: 'unit', tier: 'full' }));
  assert.doesNotMatch(full.reason, /re-tier/);
  // the same test as a slice written by Sonnet is critical code not written by Opus
  const slice = bound(() => decide({ files: [f(TEST_FILE, 30)], kind: 'slice', writer: 'sonnet' }));
  assert.equal(slice.decision, 'required');
  assert.deepEqual(slice.reviewers, ['opus-code-reviewer']);
});

test('reviewed 2: an instruction file alone is reviewed, never skipped', () => {
  for (const p of INSTRUCTION_FIXTURES)
    for (const tier of ['small', 'full']) {
      const r = decide({ files: [f(p, 4)], kind: 'unit', tier });
      assert.equal(r.decision, 'review', `${p} ${tier}`);
      assert.equal(r.prodFiles, 1, `${p} ${tier}`);
      assert.match(r.reason, /; instruction files, no other production code/, `${p} ${tier}`);
    }
});

test('reviewed 3: a cold test alone at --tier small gets the small lineup; docs alone skip at every kind', () => {
  const r = decide({ files: [f('tests/a.test.js', 12)], kind: 'unit', tier: 'small' });
  assert.equal(r.decision, 'review');
  assert.deepEqual(r.reviewers, ['second-family-review']);
  assert.match(r.reason, /^small unit written by Opus: the other model family reviews the whole unit diff; tests only, no production code$/);
  for (const p of ['docs/a.md', 'README.md'])
    for (const [kind, tier] of [['slice', 'full'], ['unit', 'small'], ['unit', 'full'], ['fix', 'full']]) {
      const d = decide({ files: [f(p, 9)], kind, tier, maxFixed: 'P1' });
      assert.equal(d.decision, 'skip', `${p} ${kind} ${tier}`);
      assert.match(d.reason, DOCS_ONLY, `${p} ${kind} ${tier}`);
    }
});

test('reviewed 4: a specialist reads code, never an instruction file\'s prose', () => {
  const prose = decide({ files: [f('.claude/skills/session-notes/SKILL.md', 20)], kind: 'unit' });
  assert.equal(prose.decision, 'review');
  assert.deepEqual(prose.reviewers, ['opus-code-reviewer', 'second-family-adversarial']);
  const hook = decide({ files: [f('.claude/hooks/auth-check.mjs', 20)], kind: 'unit' });
  assert.deepEqual(hook.reviewers, ['opus-code-reviewer', 'second-family-adversarial', 'security-reviewer']);
});

test('reviewed 5: critical production code at --tier small is reviewed as full and says to re-tier', () => {
  const one = bound(() => decide({ files: [f(HOT, 9), f(COLD, 3)], kind: 'unit', tier: 'small' }));
  assert.equal(one.decision, 'review');
  assert.deepEqual(one.reviewers, ['opus-code-reviewer', 'second-family-adversarial']);
  assert.equal(one.reason.match(RE_TIER)?.[1], HOT, one.reason);
  assert.doesNotMatch(one.reason, /tests only|instruction files/);
  const two = bound(() =>
    decide({ files: [f(HOT, 9), f('src/core/b.ts', 3)], kind: 'unit', tier: 'small', writer: 'codex' }),
  );
  assert.deepEqual(two.reviewers, ['opus-code-reviewer', 'second-family-adversarial']);
  assert.equal(two.reason.match(RE_TIER)?.[1], `${HOT} +1`, two.reason);
});

test('reviewed 6: a fix round of tests is routed like code: critical is re-reviewed, cold round 2 is proven by its tests', () => {
  const hot = bound(() => decide({ files: [f(TEST_FILE, 60)], kind: 'fix', maxFixed: 'P2', round: 2 }));
  assert.equal(hot.decision, 'second-family');
  assert.deepEqual(hot.critical, [TEST_FILE]);
  const cold1 = decide({ files: [f('tests/a.test.js', 60)], kind: 'fix', maxFixed: 'P1', round: 1 });
  assert.equal(cold1.decision, 'second-family');
  const cold2 = decide({ files: [f('tests/a.test.js', 60)], kind: 'fix', maxFixed: 'P1', round: 2 });
  assert.equal(cold2.decision, 'skip');
  assert.match(cold2.reason, /^cold fix round: its regression tests prove it/);
});

test('reviewed 7: a test in an instruction directory is a test: its lines never make a fix large, and it counts as one', () => {
  const hotA = (files) => withCritical([/^src\/a\.ts$/], () => decide({ files, kind: 'fix', maxFixed: 'P1' }));
  const alone = hotA([f('src/a.ts', 5)]);
  const withTest = hotA([f('src/a.ts', 5), f(INSTRUCTION_TEST_FIXTURES[0], 100)]);
  assert.deepEqual([withTest.prodLines, withTest.prodFiles, withTest.testFiles], [5, 1, 1]);
  assert.equal(withTest.decision, alone.decision);
  assert.deepEqual(withTest.reviewers, alone.reviewers);
  const hook = decide({ files: [f(INSTRUCTION_TEST_FIXTURES[1], 12)], kind: 'unit', tier: 'small' });
  assert.equal(hook.decision, 'review');
  assert.deepEqual([hook.prodFiles, hook.testFiles], [0, 1]);
  assert.match(hook.reason, /; tests only, no production code$/);
});

// ---- result shape and notChecked

test('an unbound CRITICAL says so in every result; a bound one does not', () => {
  const unbound = [
    decide({ files: [f(COLD, 5)], kind: 'slice' }),
    decide({ files: [f(COLD, 5)], kind: 'unit' }),
    decide({ files: [f(COLD, 5)], kind: 'fix', maxFixed: 'P1' }),
    decide({ files: [], kind: 'slice' }),
  ];
  for (const r of unbound) {
    assert.ok(r.notChecked.includes('CRITICAL unbound — every path treated as cold'), r.decision);
    assert.ok(r.notChecked.includes('critical code outside the CRITICAL path set'));
    // the importer count makes a module hot, never critical: the gate never claimed to check it
    assert.ok(!r.notChecked.includes('importers>=10'));
  }
  const boundResult = bound(() => decide({ files: [f(COLD, 5)], kind: 'slice' }));
  assert.deepEqual(boundResult.notChecked, ['critical code outside the CRITICAL path set']);
});

test('unbound stakes (null) route as live and say so; a bound value does not', () => {
  const files = [f(HOT, 9), f('src/billing/pay.ts', 4)];
  for (const kind of ['slice', 'unit'])
    for (const tier of ['small', 'full']) {
      const unbound = bound(() => decide({ files, kind, tier, stakes: null }));
      const live = bound(() => decide({ files, kind, tier, stakes: 'live' }));
      assert.deepEqual([unbound.decision, unbound.reviewers, unbound.reason], [live.decision, live.reviewers, live.reason], `${kind} ${tier}`);
      assert.equal(unbound.stakes, 'live');
      assert.deepEqual(unbound.notChecked, [...live.notChecked, 'stakes unbound — routed as live']);
      assert.ok(!live.notChecked.includes('stakes unbound — routed as live'));
    }
  // the default is live
  assert.equal(decide({ files: [f(COLD, 1)], kind: 'slice' }).stakes, 'live');
  assert.deepEqual(STAKES, ['none', 'live']);
});

test('the result carries every fact the decision used', () => {
  const r = bound(() =>
    decide({
      files: [f(HOT, 7), f(COLD, 3), f('docs/a.md', 99), f('tests/a.test.js', 40)],
      kind: 'fix',
      tier: 'small',
      writer: 'codex',
      maxFixed: 'P2',
      round: 2,
    }),
  );
  assert.deepEqual(Object.keys(r).sort(), [
    'critical',
    'decision',
    'kind',
    'maxFixed',
    'notChecked',
    'prodFiles',
    'prodLines',
    'reason',
    'reviewers',
    'round',
    'stakes',
    'testFiles',
    'tier',
    'writer',
  ]);
  assert.equal(r.prodFiles, 2);
  assert.equal(r.prodLines, 10);
  assert.equal(r.testFiles, 1);
  assert.deepEqual(r.critical, [HOT]);
  assert.deepEqual([r.kind, r.tier, r.writer, r.maxFixed, r.round], ['fix', 'small', 'codex', 'P2', 2]);
});

test('invalid kind, tier, writer and round are errors the wrapper turns into exit 2', () => {
  const ok = { files: [f(COLD, 1)], kind: 'slice' };
  assert.throws(() => decide({ ...ok, kind: 'first' }), /--kind must be one of slice\|unit\|fix/);
  assert.throws(() => decide({ ...ok, kind: undefined }), /--kind/);
  assert.throws(() => decide({ ...ok, tier: 'medium' }), /--tier must be one of small\|full\|harness/);
  assert.throws(() => decide({ ...ok, writer: 'gemini' }), /--writer is required and must be one of claude\|codex\|sonnet\|mixed/);
  for (const round of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => decide({ ...ok, round }), /--round must be an integer >= 1/, String(round));
  for (const stakes of ['', 'prod', 'None', 'off'])
    assert.throws(() => decide({ ...ok, stakes }), /--stakes must be one of none\|live/, stakes);
});

test('parseArgs: defaults, values, and the usage errors', () => {
  assert.deepEqual(parseArgs(['--base', 'abc', '--kind', 'unit']), {
    base: 'abc',
    kind: 'unit',
    tier: 'full',
    writer: null,
    round: 1,
    maxFixed: null,
    json: false,
  });
  const a = parseArgs([
    '--base', 'a', '--head', 'b', '--kind', 'fix', '--tier', 'small', '--writer', 'codex',
    '--max-fixed', 'P1', '--round', '2', '--json',
  ]);
  assert.deepEqual(
    [a.head, a.tier, a.writer, a.maxFixed, a.round, a.json],
    ['b', 'small', 'codex', 'P1', 2, true],
  );
  assert.throws(() => parseArgs(['--kind', 'unit']), /--base <sha> is required/);
  assert.throws(() => parseArgs(['--base']), /--base needs a value/);
  assert.throws(() => parseArgs(['--base', '--kind']), /--base needs a value/);
  assert.throws(() => parseArgs(['--base', 'a', '--fix']), /unknown option --fix/);
  assert.throws(() => parseArgs(['--base', '-R', '--kind', 'unit']), /--base must be a revision/);
  assert.throws(() => parseArgs(['--base', 'a', '--head', '-p']), /--head must be a revision/);
  assert.ok(Number.isNaN(parseArgs(['--base', 'a', '--round', 'x']).round), 'decide rejects it');
});

test('parseArgs: --stakes names a stake, --landing a revision, and the landing check takes no decision option', () => {
  for (const stakes of ['none', 'live']) assert.equal(parseArgs(['--base', 'a', '--stakes', stakes]).stakes, stakes);
  assert.ok(!('stakes' in parseArgs(['--base', 'a'])), 'no --stakes: the CLI reads AGENTS.md');
  assert.throws(() => parseArgs(['--base', 'a', '--stakes', 'prod']), /--stakes must be one of none\|live/);
  const l = parseArgs(['--landing', 'feat/x', '--base', 'main', '--json']);
  assert.deepEqual([l.landing, l.base, l.json], ['feat/x', 'main', true]);
  assert.ok(!('landing' in parseArgs(['--base', 'a'])));
  assert.throws(() => parseArgs(['--landing', 'feat']), /--base <sha> is required/);
  assert.throws(() => parseArgs(['--base', 'main', '--landing']), /--landing needs a value/);
  assert.throws(() => parseArgs(['--base', 'main', '--landing', '-x']), /--landing must be a revision, not an option/);
  for (const extra of [['--kind', 'unit'], ['--writer', 'main'], ['--tier', 'small'], ['--head', 'x'], ['--max-fixed', 'P1'], ['--round', '2'], ['--stakes', 'none'], ['--host', 'codex']])
    assert.throws(() => parseArgs(['--landing', 'feat', '--base', 'main', ...extra]), new RegExp(`--landing takes only --base, --trust and --json, not ${extra[0]}`), extra[0]);
});

test('parseArgs: --trust repeats beside --landing; --help is help only as a flag of its own, never as a value', () => {
  const l = parseArgs(['--landing', 'abc', '--base', 'HEAD', '--trust', 'x', '--trust', 'y']);
  assert.deepEqual([l.landing, l.base, l.trust], ['abc', 'HEAD', ['x', 'y']]);
  assert.ok(!('trust' in parseArgs(['--landing', 'abc', '--base', 'HEAD'])));
  assert.throws(() => parseArgs(['--base', 'a', '--kind', 'unit', '--trust', 'x']), /--trust goes with --landing/);
  assert.throws(() => parseArgs(['--landing', 'a', '--base', 'b', '--trust', '-x']), /--trust must be a commit, not an option/);
  assert.throws(() => parseArgs(['--landing', 'a', '--base', 'b', '--trust']), /--trust needs a value/);
  // options are parsed first: the value of an option is never help
  for (const [flag, why] of [['--help', 'needs a value'], ['-h', 'must be (a revision|a commit), not an option']]) {
    assert.throws(() => parseArgs(['--landing', flag, '--base', 'HEAD']), new RegExp(`--landing ${why}`), flag);
    assert.throws(() => parseArgs(['--base', flag, '--kind', 'unit']), new RegExp(`--base ${why}`), flag);
    assert.throws(() => parseArgs(['--landing', 'a', '--base', 'b', '--trust', flag]), new RegExp(`--trust ${why}`), flag);
  }
  // a flag of its own is help, with or without the other options
  for (const argv of [['--help'], ['-h'], ['--base', 'a', '--help'], ['--landing', 'a', '--base', 'b', '-h'], ['--kind', 'unit', '--help']])
    assert.equal(parseArgs(argv).help, true, argv.join(' '));
  assert.ok(!('help' in parseArgs(['--base', 'a'])));
  // a token parseArgs cannot read is still an error beside it
  assert.throws(() => parseArgs(['--help', '--nope']), /unknown option --nope/);
});

// ---- stakes: production none runs one cross-family review, plus the adversarial pass on critical code

test('readStakes: the Stakes line names production none or live; anything else is unbound', () => {
  assert.equal(readStakes('# A\n\nStakes: production: none · data: test\n'), 'none');
  assert.equal(readStakes('  Stakes: users: 40 · production: live\n'), 'live');
  assert.equal(readStakes('Stakes: production:live'), 'live');
  assert.equal(readStakes('# A\n\nNo stakes here.\n'), null);
  assert.equal(readStakes(''), null);
  assert.equal(readStakes(null), null);
  // a production: outside a Stakes line is not the stakes
  assert.equal(readStakes('Deploy: production: live\nStakes: users: none\n'), null);
  assert.equal(readStakes('Stakes: users: none\nproduction: none\n'), null);
  // two Stakes lines naming different values are unbound, routed as live
  assert.equal(readStakes('Stakes: production: none\nStakes: production: live\n'), null);
});

test('readStakes reads the policy block, never a fenced example; the same value twice is that value', () => {
  const policy = (...lines) => ['<!-- harness:begin policy -->', ...lines, '<!-- harness:end policy -->'].join('\n');
  // a fenced example before the policy block never wins over the live line
  assert.equal(readStakes(['# A', '```', 'Stakes: users: 0 · production: none', '```', policy('Stakes: production: live')].join('\n')), 'live');
  assert.equal(readStakes(['~~~md', 'Stakes: production: none', '~~~', 'Stakes: production: live'].join('\n')), 'live');
  assert.equal(readStakes('```\nStakes: production: none\n```\n'), null);
  // an unclosed fence runs to the end of the file
  assert.equal(readStakes('Stakes: production: live\n```\nStakes: production: none\n'), 'live');
  // with a policy block, a Stakes line outside it is not the stakes
  assert.equal(readStakes(['Stakes: production: none', policy('Stakes: production: live')].join('\n')), 'live');
  assert.equal(readStakes(['Stakes: production: live', policy('No stakes line here.')].join('\n')), null);
  // a policy block inside a fence is an example, not the policy block
  assert.equal(readStakes(['```', policy('Stakes: production: none'), '```', 'Stakes: production: live'].join('\n')), 'live');
  // two lines inside the block: conflicting is null, the same value twice is that value
  assert.equal(readStakes(policy('Stakes: production: none', 'Stakes: production: live')), null);
  assert.equal(readStakes(policy('Stakes: production: none', 'Stakes: users: 0 · production: none')), 'none');
});

test('stakes none 1: a critical full unit by Opus is the cross-family review plus the adversarial pass, no Opus reviewer or test analyzer', () => {
  const files = [f(HOT, 30), f('src/core/payment/charge.ts', 9), f(TEST_FILE, 20), f('src/auth/session.ts', 3)];
  const none = withCritical([/^src\/core\//, /^src\/auth\//], () => decide({ files, kind: 'unit', tier: 'full', stakes: 'none' }));
  assert.equal(none.decision, 'review');
  assert.deepEqual(none.reviewers, ['second-family-review', 'second-family-adversarial', 'security-reviewer']);
  assert.ok(!none.reviewers.includes('opus-code-reviewer'));
  assert.ok(!none.reviewers.includes('pr-test-analyzer'));
  assert.ok(!none.reviewers.includes('silent-failure-hunter'), 'silent-failure-hunter at production none');
  assert.match(none.reason, /^production: none: /);
  assert.match(none.reason, /cross-family review/);
  assert.match(none.reason, /adversarial pass/);
  assert.equal(none.stakes, 'none');
  // at live the same unit has the full lineup, the silent-failure hunter among it
  const live = withCritical([/^src\/core\//, /^src\/auth\//], () => decide({ files, kind: 'unit', tier: 'full', stakes: 'live' }));
  assert.deepEqual(live.reviewers, ['opus-code-reviewer', 'second-family-adversarial', 'security-reviewer', 'silent-failure-hunter', 'pr-test-analyzer']);
});

test('stakes none 2: the second family\'s unit is read by Sonnet and Opus\'s adversarial pass; a small tier gets no re-tier advice', () => {
  for (const writer of ['codex', 'mixed']) {
    const r = bound(() => decide({ files: [f(HOT, 9)], kind: 'unit', tier: 'small', writer, stakes: 'none' }));
    assert.deepEqual(r.reviewers, ['sonnet-code-reviewer', 'opus-adversarial'], writer);
    assert.doesNotMatch(r.reason, /re-tier/, writer);
  }
  for (const writer of ['claude', 'sonnet']) {
    const r = bound(() => decide({ files: [f(HOT, 9)], kind: 'unit', tier: 'small', writer, stakes: 'none' }));
    assert.deepEqual(r.reviewers, ['second-family-review', 'second-family-adversarial'], writer);
  }
  // a path outside HARNESS at --tier harness is reviewed the same way, with no advice either
  const stray = decide({ files: [f('AGENTS.md', 3), f('app/src/main.tsx', 4)], kind: 'unit', tier: 'harness', stakes: 'none' });
  assert.deepEqual(stray.reviewers, ['second-family-review']);
  assert.doesNotMatch(stray.reason, /re-tier/);
  // the harness lane itself is unchanged
  const lane = decide({ files: [f('AGENTS.md', 3)], kind: 'unit', tier: 'harness', stakes: 'none' });
  assert.equal(lane.reason, decide({ files: [f('AGENTS.md', 3)], kind: 'unit', tier: 'harness' }).reason);
});

test('stakes none 3: a cold unit at production none is one cross-family review, no adversarial pass', () => {
  for (const tier of ['small', 'full'])
    for (const [writer, reviewer] of [['claude', 'second-family-review'], ['codex', 'sonnet-code-reviewer']]) {
      const r = bound(() => decide({ files: [f(COLD, 40), f('tests/a.test.js', 9), f('db/migrations/001.sql', 3)], kind: 'unit', tier, writer, stakes: 'none' }));
      assert.deepEqual(r.reviewers, [reviewer, 'database-reviewer'], `${tier} ${writer}`);
      assert.ok(!r.reviewers.some((x) => /adversarial/.test(x)), `${tier} ${writer}`);
      assert.match(r.reason, /^production: none: /);
      assert.doesNotMatch(r.reason, /adversarial/);
    }
  // docs alone still skip
  assert.equal(decide({ files: [f('docs/a.md', 3)], kind: 'unit', stakes: 'none' }).decision, 'skip');
});

test('stakes none 4: a fix on critical code never names the Opus reviewer; the cross-family reviewer reads it', () => {
  const at = (stakes, o) => bound(() => decide({ kind: 'fix', stakes, ...o }));
  // where live names the Opus reviewer alone (a fix not written by Opus)
  for (const [writer, reviewer, decision] of [['sonnet', 'second-family-review', 'second-family'], ['codex', 'sonnet-code-reviewer', 'review'], ['mixed', 'sonnet-code-reviewer', 'review']])
    for (const [maxFixed, lines] of [['P2', FIX_LINES * 5], ['P1', FIX_LINES], ['P1', FIX_LINES + 1]]) {
      const live = at('live', { files: [f(HOT, lines)], maxFixed, writer });
      assert.deepEqual(live.reviewers, ['opus-code-reviewer'], `live ${writer} ${maxFixed} ${lines}`);
      const none = at('none', { files: [f(HOT, lines)], maxFixed, writer });
      assert.deepEqual([none.decision, none.reviewers], [decision, [reviewer]], `none ${writer} ${maxFixed} ${lines}`);
      assert.match(none.reason, /^production: none: /);
    }
  // where live names the second family plus Opus (Opus's own large P1 fix)
  const live = at('live', { files: [f(HOT, FIX_LINES + 1)], maxFixed: 'P1', writer: 'claude' });
  assert.equal(live.decision, 'second-family+opus');
  const none = at('none', { files: [f(HOT, FIX_LINES + 1)], maxFixed: 'P1', writer: 'claude' });
  assert.deepEqual([none.decision, none.reviewers], ['second-family', ['second-family-review']]);
  // the P3 batch over critical code by Sonnet is read by the cross-family reviewer too
  const p3 = at('none', { files: [f(HOT, 9)], maxFixed: 'P3', writer: 'sonnet' });
  assert.deepEqual([p3.decision, p3.reviewers], ['second-family', ['second-family-review']]);
  // a specialist still joins; rounds 3 to 5 are unchanged
  const auth = withCritical([/^src\/auth\//], () => decide({ files: [f('src/auth/login.ts', 5)], kind: 'fix', maxFixed: 'P1', writer: 'codex', stakes: 'none' }));
  assert.deepEqual(auth.reviewers, ['sonnet-code-reviewer', 'security-reviewer']);
  for (const round of [3, 4, 5])
    for (const writer of ['claude', 'codex']) {
      const a = at('none', { files: [f(HOT, 5)], maxFixed: 'P1', round, writer });
      const b = at('live', { files: [f(HOT, 5)], maxFixed: 'P1', round, writer });
      assert.deepEqual([a.decision, a.reviewers], [b.decision, b.reviewers], `round ${round} ${writer}`);
    }
  // no fix decision at none names the Opus code-reviewer
  for (const writer of ['claude', 'sonnet', 'codex', 'mixed'])
    for (const maxFixed of ['P0', 'P1', 'P2', 'P3'])
      for (const round of [1, 2])
        for (const lines of [1, FIX_LINES + 1])
          assert.ok(!at('none', { files: [f(HOT, lines)], maxFixed, round, writer }).reviewers.includes('opus-code-reviewer'), `${writer} ${maxFixed} ${round} ${lines}`);
});

test('stakes none 5: a slice is unchanged: critical code not written by Opus still gets the Opus reviewer', () => {
  for (const writer of ['claude', 'sonnet', 'codex', 'mixed'])
    for (const file of [HOT, COLD]) {
      const a = bound(() => decide({ files: [f(file, 9)], kind: 'slice', writer, stakes: 'none' }));
      const b = bound(() => decide({ files: [f(file, 9)], kind: 'slice', writer, stakes: 'live' }));
      assert.deepEqual([a.decision, a.reviewers, a.reason], [b.decision, b.reviewers, b.reason], `${writer} ${file}`);
    }
  assert.deepEqual(bound(() => decide({ files: [f(HOT, 9)], kind: 'slice', writer: 'codex', stakes: 'none' })).reviewers, ['opus-code-reviewer']);
});

test('stakes none 6: a P3-only fix round has no P3 batch at production none; critical code by another writer is still read', () => {
  const NO_BATCH = 'production: none: no P3 batch — a P3 rides along on a line a round already changes';
  for (const [files, writer] of [[[f(COLD, 3)], 'codex'], [[f(HOT, 30)], 'claude'], [[f(TEST_FILE, 9)], 'claude'], [[f('docs/x.md', 4)], 'sonnet']]) {
    const r = bound(() => decide({ files, kind: 'fix', maxFixed: 'P3', writer, stakes: 'none' }));
    assert.deepEqual([r.decision, r.reviewers, r.reason], ['skip', [], NO_BATCH], `${files[0].path} by ${writer}`);
    // at live the same round is the P3 batch
    assert.equal(bound(() => decide({ files, kind: 'fix', maxFixed: 'P3', writer })).decision, 'p3-batch', `${files[0].path} by ${writer}`);
  }
  // critical code not written by Opus is still read, by the cross-family reviewer
  for (const [writer, decision, reviewer] of [['sonnet', 'second-family', 'second-family-review'], ['codex', 'review', 'sonnet-code-reviewer']]) {
    const r = bound(() => decide({ files: [f(HOT, 9)], kind: 'fix', maxFixed: 'P3', writer, stakes: 'none' }));
    assert.deepEqual([r.decision, r.reviewers], [decision, [reviewer]], writer);
  }
  // the harness lane has no P3 batch at none either
  const lane = decide({ files: [f('.githooks/pre-commit', 3)], kind: 'fix', tier: 'harness', maxFixed: 'P3', stakes: 'none' });
  assert.deepEqual([lane.decision, lane.reason], ['skip', NO_BATCH]);
});

// ---- tier by diff: tests only added under a critical path route as cold

const COLD_TESTS = /; tests added under a critical path, nothing deleted: routed as cold$/;

test('tier by diff 1: a test-only diff with nothing deleted under a critical path routes as cold, and still lists it', () => {
  const added = [ns(TEST_FILE, 40, 0), ns('tests/a.test.js', 9, 0)];
  const unit = bound(() => decide({ files: added, kind: 'unit', tier: 'small' }));
  assert.equal(unit.decision, 'review');
  assert.deepEqual(unit.reviewers, ['second-family-review']);
  assert.deepEqual(unit.critical, [TEST_FILE]);
  assert.match(unit.reason, COLD_TESTS);
  assert.doesNotMatch(unit.reason, /re-tier/);
  // a slice by Sonnet is no longer critical code not written by Opus
  const slice = bound(() => decide({ files: added, kind: 'slice', writer: 'sonnet' }));
  assert.deepEqual([slice.decision, slice.reviewers], ['second-family', ['second-family-review']]);
  // a fix round 2 is proven by its tests, as a cold one is
  const fix = bound(() => decide({ files: added, kind: 'fix', maxFixed: 'P1', round: 2 }));
  assert.equal(fix.decision, 'skip');
  assert.match(fix.reason, COLD_TESTS);
  // with no critical path in it, nothing is said
  assert.doesNotMatch(bound(() => decide({ files: [ns('tests/a.test.js', 9, 0)], kind: 'unit', tier: 'small' })).reason, /routed as cold/);
});

test('tier by diff 2: one deleted line, a binary, a production file or an unknown count keeps the test critical', () => {
  const FULL = ['opus-code-reviewer', 'second-family-adversarial', 'pr-test-analyzer'];
  for (const [what, files] of [
    ['one deleted line', [ns(TEST_FILE, 40, 1)]],
    ['a deleted line in another test', [ns(TEST_FILE, 40, 0), ns('tests/a.test.js', 0, 1)]],
    ['a binary test fixture', [ns(TEST_FILE, 40, 0), ns('src/core/__tests__/snap.png', 0, 0, true)]],
    ['a production file beside it', [ns(TEST_FILE, 40, 0), ns(COLD, 3, 0)]],
    ['no added and deleted counts', [f(TEST_FILE, 40)]],
  ]) {
    const r = bound(() => decide({ files, kind: 'unit', tier: 'small' }));
    assert.ok(r.critical.length > 0, what);
    assert.deepEqual(r.reviewers.slice(0, 2), FULL.slice(0, 2), what);
    assert.doesNotMatch(r.reason, /routed as cold/, what);
  }
});

// ---- the landing check: every critical path the merge lands is content a cross-family review read

const BASE = 'b'.repeat(40);
const RESULT = 'c'.repeat(40);
const T0 = '0'.repeat(40);
const T1 = '1'.repeat(40);
const T2 = '2'.repeat(40);
const T3 = '3'.repeat(40);
/** A qualifying ledger row; `family` is the ledger the CLI read it from. */
const reviewRow = (o = {}) => ({ kind: 'review', outcome: 'ok', at: '2026-11-09T10:00:00.000Z', ledger: '/r/.codex-runs/ledger.jsonl', family: 'codex', baseTree: T0, tree: T1, ...o });
/** One edge of a path's graph: the row's blob at its baseTree → its blob at its tree. */
const edge = (from, to, row) => ({ from, to, row });
const NO_HOST = 'no host named itself (ZCODE_*, CODEX_THREAD_ID, CODEX_SANDBOX, CLAUDECODE or HARNESS_HOST), so no review row counts: run git from the host, or ask the owner to merge it';
const landing = (o) => bound(() => landingCore({ result: RESULT, base: BASE, trust: [], changed: [HOT], blockChanged: {}, rows: [], paths: {}, host: 'claude', ...o }));
const RE_REVIEW = (from, paths, named = paths[0]) =>
  `critical paths changed beyond the reviewed content: ${named} → second-family-adversarial --base ${from} over git diff ${from} ${RESULT} -- ${paths.join(' ')}, on the branch with the mainline merged in`;

test('landing 1: an empty review (a self-loop edge) reaches nothing: NONE, the owner merges', () => {
  // `review --base HEAD` over the tip: the reviewer read no diff, so its row is B → B
  const row = reviewRow({ baseTree: T1, tree: T1 });
  const r = landing({ rows: [row], paths: { [HOT]: { starts: ['A'], result: 'B', edges: [edge('B', 'B', row)] } } });
  assert.equal(r.verdict, 'NONE');
  assert.deepEqual([r.critical, r.unreached, r.from], [[HOT], [HOT], null]);
  assert.equal(r.reason, `no recorded cross-family review of ${HOT}: the owner merges`);
});

test('landing 2: a two-round chain reaches: the unit review A → B, the fix review B → C, result C', () => {
  const unit = reviewRow({ at: '2026-11-09T09:00:00.000Z', baseTree: T0, tree: T1 });
  const fix = reviewRow({ at: '2026-11-09T10:00:00.000Z', baseTree: T1, tree: T2, kind: 'adversarial' });
  // the edges in either order, and a second critical path reached by the unit review alone
  const r = landing({
    changed: [HOT, TEST_FILE, COLD],
    rows: [unit, fix],
    paths: {
      [HOT]: { starts: ['A'], result: 'C', edges: [edge('B', 'C', fix), edge('A', 'B', unit)] },
      [TEST_FILE]: { starts: ['absent'], result: 'T', edges: [edge('absent', 'T', unit), edge('T', 'T', fix)] },
    },
  });
  assert.equal(r.verdict, 'PASS');
  assert.deepEqual([r.critical, r.unreached, r.from], [[HOT, TEST_FILE], [], null]);
  assert.equal(r.reason, 'every critical path is reviewed content (2 review rows)');
  assert.deepEqual(r.rows, [unit, fix].map(({ kind, at, ledger, tree, baseTree }) => ({ kind, at, ledger, tree, baseTree })));
  assert.deepEqual(Object.keys(r).sort(), ['base', 'changed', 'critical', 'from', 'guards', 'host', 'reason', 'result', 'rows', 'trust', 'unreached', 'verdict']);
});

test('landing 3: an edit between the unit review\'s tree and the fix base is RE-REVIEW from the latest reached tree', () => {
  // A → B and B → B2 were read; B2 → C was not; the fix review read C → D; the result is D
  const early = reviewRow({ at: '2026-11-09T08:00:00.000Z', baseTree: T0, tree: T3 });
  const unit = reviewRow({ at: '2026-11-09T09:00:00.000Z', baseTree: T3, tree: T1 });
  const fix = reviewRow({ at: '2026-11-09T10:00:00.000Z', baseTree: T2, tree: T2 });
  const graph = { starts: ['A'], result: 'D', edges: [edge('C', 'D', fix), edge('B', 'B2', unit), edge('A', 'B', early)] };
  const r = landing({ rows: [fix, unit, early], paths: { [HOT]: graph } });
  assert.equal(r.verdict, 'RE-REVIEW');
  assert.deepEqual([r.unreached, r.from], [[HOT], T1]);
  assert.equal(r.reason, RE_REVIEW(T1, [HOT]));
  // a second unreached path whose reviewed blobs no start reaches: no row's tree holds reached
  // content for both, so the re-review reads the whole change from the base
  const two = landing({
    changed: [HOT, TEST_FILE],
    rows: [fix, unit, early],
    paths: { [HOT]: graph, [TEST_FILE]: { starts: ['X'], result: 'Z', edges: [edge('W', 'V', unit), edge('Y', 'Z', fix), edge('P', 'Q', early)] } },
  });
  assert.deepEqual([two.verdict, two.unreached, two.from], ['RE-REVIEW', [HOT, TEST_FILE], BASE]);
  assert.equal(two.reason, RE_REVIEW(BASE, [HOT, TEST_FILE], `${HOT} +1`));
});

test('landing 4: an auto-merge result that no edge reaches from the base blob is RE-REVIEW from the base', () => {
  // the branch's A → B was reviewed; the mainline holds M; the merge wrote R, which no review read
  const row = reviewRow();
  const r = landing({ rows: [row], paths: { [HOT]: { starts: ['M'], result: 'R', edges: [edge('A', 'B', row)] } } });
  assert.deepEqual([r.verdict, r.unreached, r.from], ['RE-REVIEW', [HOT], BASE]);
  assert.equal(r.reason, RE_REVIEW(BASE, [HOT]));
  // a critical path the CLI could not look up (a name holding a newline) is never reached
  const odd = landing({ changed: [HOT, 'src/core/odd\nname.ts'], rows: [row], paths: { [HOT]: { starts: ['A'], result: 'B', edges: [edge('A', 'B', row)] } } });
  assert.deepEqual([odd.verdict, odd.unreached], ['NONE', ['src/core/odd\nname.ts']]);
});

test('landing 5: a deletion is reached when a review read it, and not when none did', () => {
  const row = reviewRow();
  const deleted = landing({ rows: [row], paths: { [HOT]: { starts: ['A'], result: 'absent', edges: [edge('A', 'absent', row)] } } });
  assert.equal(deleted.verdict, 'PASS');
  // the review read A → B, so the deletion after it is the delta to read, from that review's tree
  const unread = landing({ rows: [row], paths: { [HOT]: { starts: ['A'], result: 'absent', edges: [edge('A', 'B', row)] } } });
  assert.deepEqual([unread.verdict, unread.unreached, unread.from], ['RE-REVIEW', [HOT], T1]);
  // a new file is a path absent at the base
  const added = landing({ rows: [row], paths: { [HOT]: { starts: ['absent'], result: 'N', edges: [edge('absent', 'N', row)] } } });
  assert.equal(added.verdict, 'PASS');
});

test('landing 6: a --trust commit is a start: a pull of what the remote holds reaches', () => {
  const pull = landing({ trust: [T2], paths: { [HOT]: { starts: ['A', 'X'], result: 'X', edges: [] } } });
  assert.deepEqual([pull.verdict, pull.trust, pull.reason], ['PASS', [T2], 'every critical path is reviewed content (0 review rows)']);
  // a reviewed change on top of the trusted content reaches too
  const row = reviewRow();
  const onTop = landing({ trust: [T2], rows: [row], paths: { [HOT]: { starts: ['A', 'X'], result: 'Y', edges: [edge('X', 'Y', row)] } } });
  assert.equal(onTop.verdict, 'PASS');
  // without the trusted start the same content is no recorded review
  assert.equal(landing({ paths: { [HOT]: { starts: ['A'], result: 'X', edges: [] } } }).verdict, 'NONE');
});

test('landing 7: no critical path changed is PASS; a critical path with no qualifying row is NONE', () => {
  const pass = landing({ changed: [COLD, 'docs/a.md', 'src/core/README.md'] });
  assert.deepEqual([pass.verdict, pass.critical, pass.reason], ['PASS', [], 'no critical path changed']);
  const none = landing({ changed: [HOT, TEST_FILE, COLD], paths: { [HOT]: { starts: ['A'], result: 'B', edges: [] }, [TEST_FILE]: { starts: ['A'], result: 'B', edges: [] } } });
  assert.deepEqual([none.verdict, none.critical, none.unreached, none.rows], ['NONE', [HOT, TEST_FILE], [HOT, TEST_FILE], []]);
  assert.equal(none.reason, `no recorded cross-family review of ${HOT} +1: the owner merges`);
});

test('landing 8: a GUARDS path is NONE, before the critical check', () => {
  const guards = ['AGENTS.md', 'CLAUDE.md', '.githooks/pre-commit', '.claude/settings.json', '.claude/settings.local.json', '.claude/hooks/guard.sh', '.claude/agents/reviewer.md', '.codex/hooks.json', '.codex/config.toml', '.codex/agents/x.toml', '.agents/harness-manifest.json', '.agents/harness-models.json', '.agents/skills/task-runner/SKILL.md', '.claude/skills/task-runner', '.claude/skills/task-runner/SKILL.md', 'scripts/run-gates.sh', 'scripts/run-counted.mjs', 'scripts/review-gate.mjs', 'scripts/check-agent-docs.mjs', 'scripts/codex-run.mjs', 'scripts/claude-run.mjs', 'scripts/lib/review-gate-core.mjs', 'scripts/lib/snapshot-tree.mjs', 'scripts/lib/run-sources.mjs', 'scripts/lib/harness-host-core.mjs', 'scripts/lib/codex-run-core.mjs', 'scripts/lib/claude-run-core.mjs', 'scripts/lib/run-counted-core.mjs'];
  const others = ['packages/a/AGENTS.md', 'docs/AGENTS.md', '.claude/rules/x.md', '.claude/skills/task-runner-x/SKILL.md', '.claude/skills/other/SKILL.md', '.codex/prompts/x.md', 'scripts/retro.mjs', 'scripts/lib/retro-core.mjs', 'scripts/lib/review-gate-core.test.mjs', 'xscripts/run-gates.sh', HOT];
  injected(() => {
    for (const p of guards) assert.ok(isGuard(p), `${p} is not a guard`);
    for (const p of others) assert.ok(!isGuard(p), `${p} is a guard`);
  });
  // every critical path reached, and still NONE: no agent judges its own edit to a gate
  const row = reviewRow();
  const r = landing({ changed: [HOT, '.githooks/pre-commit', 'scripts/review-gate.mjs'], rows: [row], paths: { [HOT]: { starts: ['A'], result: 'B', edges: [edge('A', 'B', row)] } } });
  assert.equal(r.verdict, 'NONE');
  assert.deepEqual([r.guards, r.unreached], [['.githooks/pre-commit', 'scripts/review-gate.mjs'], []]);
  assert.equal(r.reason, 'a guard, a gate or a reviewed block changed (.githooks/pre-commit +1): the owner merges');
});

test('landing 9: an AGENTS.md edit outside the harness markers is not a guard; inside a block it is', () => {
  const AG = ['# Project', 'Our own text.', '<!-- harness:begin rules -->', 'Rule one.', '<!-- harness:end rules -->', '', '  <!-- harness:begin policy -->  ', 'Stakes: production: live', '<!-- harness:end policy -->', ''].join('\n');
  assert.deepEqual(harnessBlocks(AG), [{ id: 'rules', text: 'Rule one.' }, { id: 'policy', text: 'Stakes: production: live' }]);
  assert.equal(blocksDiffer(AG, AG.replace('Our own text.', 'Our text, edited.')), false);
  assert.equal(blocksDiffer(AG, AG.replace('Rule one.', 'Rule two.')), true);
  assert.equal(blocksDiffer(AG, AG.replace('<!-- harness:begin rules -->\nRule one.\n<!-- harness:end rules -->\n', '')), true, 'a block removed');
  assert.equal(blocksDiffer(AG, `${AG}<!-- harness:begin merge -->\nGrant: none\n<!-- harness:end merge -->\n`), true, 'a block added');
  // a file absent on one side counts when the other side holds a block
  assert.deepEqual([blocksDiffer(null, AG), blocksDiffer(AG, null), blocksDiffer(null, '# Project\n')], [true, true, false]);
  // a fence never hides a block's text from the comparison, and an unclosed block runs to the end
  const fenced = AG.replace('Rule one.', '```\nRule one.\n```');
  assert.equal(blocksDiffer(fenced, fenced.replace('Rule one.', 'Rule two.')), true);
  assert.deepEqual(harnessBlocks('<!-- harness:begin rules -->\na\n<!-- harness:end other -->\nb'), [{ id: 'rules', text: 'a\n<!-- harness:end other -->\nb' }]);
  // in the verdict: the CLI's comparison decides; a comparison it did not make counts as changed
  const outside = landing({ changed: ['AGENTS.md', COLD], blockChanged: { 'AGENTS.md': false } });
  assert.deepEqual([outside.verdict, outside.guards, outside.reason], ['PASS', [], 'no critical path changed']);
  const block = landing({ changed: ['AGENTS.md', 'CLAUDE.md'], blockChanged: { 'AGENTS.md': false, 'CLAUDE.md': true } });
  assert.deepEqual([block.verdict, block.guards], ['NONE', ['CLAUDE.md']]);
  assert.deepEqual([landing({ changed: ['AGENTS.md'] }).verdict, landing({ changed: ['AGENTS.md'] }).guards], ['NONE', ['AGENTS.md']]);
});

test('landing 10: the host filter counts only the other family\'s ledger; zcode and kimi count both, an unknown host none', () => {
  const codexRow = reviewRow({ family: 'codex' });
  const claudeRow = reviewRow({ family: 'claude', ledger: '/r/.claude-runs/ledger.jsonl', kind: 'adversarial-frontier' });
  const rejected = [
    reviewRow({ outcome: 'failed' }),
    reviewRow({ kind: 'implement' }),
    reviewRow({ baseTree: null }),
    reviewRow({ tree: undefined }),
    reviewRow({ tree: 'HEAD' }),
    reviewRow({ baseTree: '--output=x' }),
    reviewRow({ tree: 'a'.repeat(39) }),
    reviewRow({ tree: 'A'.repeat(40) }),
    reviewRow({ treeMoved: true }),
    reviewRow({ family: undefined }),
    null,
    'not a row',
  ];
  const all = [codexRow, claudeRow, ...rejected];
  assert.deepEqual(qualifyingRows(all, 'claude'), [codexRow]);
  assert.deepEqual(qualifyingRows(all, 'codex'), [claudeRow]);
  for (const host of ['zcode', 'kimi']) assert.deepEqual(qualifyingRows(all, host), [codexRow, claudeRow], host);
  assert.deepEqual(qualifyingRows(all, 'unknown'), []);
  // a SHA-256 repository's 64-hex ids count, and a row that did not move counts
  const sha256 = reviewRow({ tree: '3'.repeat(64), baseTree: '4'.repeat(64), treeMoved: false });
  assert.deepEqual(qualifyingRows([sha256], 'claude'), [sha256]);
  // an unknown host counts no row: a path only a row reaches is NONE, even with facts a known host would pass
  const facts = { rows: [codexRow], paths: { [HOT]: { starts: ['A'], result: 'B', edges: [edge('A', 'B', codexRow)] } } };
  const unknown = landing({ ...facts, host: 'unknown' });
  assert.deepEqual([unknown.host, unknown.verdict, unknown.reason, unknown.unreached], ['unknown', 'NONE', NO_HOST, [HOT]]);
  // and never RE-REVIEW: a row that read part of the change is no row there
  const partial = { rows: [codexRow], paths: { [HOT]: { starts: ['A'], result: 'C', edges: [edge('A', 'B', codexRow)] } } };
  assert.equal(landing(partial).verdict, 'RE-REVIEW');
  const partialUnknown = landing({ ...partial, host: 'unknown' });
  assert.deepEqual([partialUnknown.verdict, partialUnknown.reason, partialUnknown.unreached, partialUnknown.from], ['NONE', NO_HOST, [HOT], null]);
  for (const host of ['claude', 'codex', 'zcode', 'kimi'])
    assert.equal(landing({ ...facts, host }).reason, 'every critical path is reviewed content (1 review rows)', host);
  assert.deepEqual(LANDING_KINDS, ['review', 'adversarial', 'adversarial-frontier']);
});

test('landing 11: an unknown host with no critical path changed passes; a guard is still NONE first', () => {
  const cold = landing({ changed: [COLD, 'docs/a.md'], host: 'unknown' });
  assert.deepEqual([cold.verdict, cold.reason], ['PASS', 'no critical path changed']);
  const guard = landing({ changed: [HOT, '.githooks/pre-commit'], host: 'unknown' });
  assert.deepEqual([guard.verdict, guard.reason], ['NONE', 'a guard, a gate or a reviewed block changed (.githooks/pre-commit): the owner merges']);
});

test('landing 12: an unknown host passes a critical path whose result is content a trusted tip holds', () => {
  const pull = landing({ host: 'unknown', trust: [T2], paths: { [HOT]: { starts: ['A', 'X'], result: 'X', edges: [] } } });
  assert.deepEqual([pull.verdict, pull.reason, pull.unreached], ['PASS', 'every critical path is reviewed content (0 review rows)', []]);
});

test('formatLanding prints one line: the result in 12 hex, the verdict, the reason', () => {
  const line = formatLanding(landing({ changed: [COLD] }));
  assert.equal(line, `Landing: ${'c'.repeat(12)} PASS — no critical path changed`);
});

test('formatLine prints one line: decision, reason, reviewers, facts, what was not checked', () => {
  const line = formatLine(decide({ files: [f(COLD, 12), f('docs/a.md', 5)], kind: 'unit' }));
  assert.ok(!line.includes('\n'));
  assert.match(
    line,
    /^review-gate: review — full unit: one review pass over the whole unit diff → opus-code-reviewer \+ second-family-adversarial \[1 production files, 12 lines; stakes live; not checked: critical code outside the CRITICAL path set, CRITICAL unbound — every path treated as cold\]$/,
  );
  assert.match(formatLine(decide({ files: [], kind: 'slice' })), /→ none \[0 production files, 0 lines;/);
  assert.match(formatLine(decide({ files: [f(COLD, 1)], kind: 'unit', stakes: 'none' })), /\[1 production files, 1 lines; stakes none; not checked: /);
});

// ---- the wrapper, end to end, in a temp repo

// The CLI runs in a child process under the BOUND values: what it decides is compared with the
// core's own result for the same files under them (no injection), so a project's bindings hold too.
// The temp repos carry no AGENTS.md, so the CLI's stakes are unbound (null) unless --stakes names them.
const bareLine = (o) => `${formatLine(decideCore({ writer: 'claude', stakes: null, ...o }))}\n`;
const NEW = [ns('src/new.ts', 3, 0)];

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  // the CLI tests pass Claude Code's family names; on another host (CODEX_THREAD_ID under Codex)
  // those are a usage error, so the suite names its host and runs the same on every one
  env.HARNESS_HOST = 'claude';
  return env;
}

test('the wrapper: one line and exit 0 for a decision, exit 2 for a usage error or a git failure', (t) => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'review-gate-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const env = cleanEnv();
  const git = (...a) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a],
      { cwd: repo, env, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const rawGate = (...args) =>
    spawnSync(process.execPath, [RUNNER, ...args], { cwd: repo, env, encoding: 'utf8' });
  // --writer is required; the calls that are not about it name Opus
  const gate = (...args) => rawGate(...(args.includes('--writer') ? args : [...args, '--writer', 'claude']));

  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');

  // A clean tree has nothing to review: exit 0, one line.
  let res = gate('--base', base, '--kind', 'slice');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, bareLine({ files: [], kind: 'slice' }));

  // An untracked production file is seen (3 lines), and --kind unit names the full-tier reviewers.
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/new.ts'), 'a\nb\nc\n');
  res = gate('--base', base, '--kind', 'unit');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim().split('\n').length, 1);
  assert.equal(res.stdout, bareLine({ files: NEW, kind: 'unit' }));
  res = gate('--base', base, '--kind', 'slice', '--json');
  assert.equal(res.status, 0, res.stderr);
  const json = JSON.parse(res.stdout);
  const slice = decideCore({ files: NEW, kind: 'slice', writer: 'claude' });
  assert.equal(json.decision, slice.decision);
  assert.equal(json.prodLines, slice.prodLines);

  // --head limits the diff to the committed range: the untracked file is not in it.
  res = gate('--base', base, '--head', 'HEAD', '--kind', 'slice');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, bareLine({ files: [], kind: 'slice' }));
  git('add', '.');
  git('commit', '-q', '-m', 'work');
  res = gate('--base', base, '--head', 'HEAD', '--kind', 'slice', '--writer', 'codex');
  assert.equal(res.stdout, bareLine({ files: NEW, kind: 'slice', writer: 'codex' }));

  // Usage errors: a missing --base, a missing or bad --kind, a fix without --max-fixed, a bad flag.
  for (const args of [
    ['--kind', 'slice'],
    ['--base', base],
    ['--base', base, '--kind', 'first'],
    ['--base', base, '--kind', 'fix'],
    ['--base', base, '--kind', 'slice', '--round', '0'],
    ['--base', base, '--kind', 'slice', '--nope'],
  ]) {
    res = gate(...args);
    assert.equal(res.status, 2, args.join(' '));
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /usage: review-gate\.mjs --base <sha> --kind slice\|unit\|fix/, args.join(' '));
  }

  // --writer is required for every kind: missing or unknown is a usage error naming the values.
  for (const args of [
    ['--base', base, '--kind', 'slice'],
    ['--base', base, '--kind', 'unit', '--tier', 'small'],
    ['--base', base, '--kind', 'fix', '--max-fixed', 'P1'],
    ['--base', base, '--kind', 'slice', '--writer', 'gemini'],
  ]) {
    res = rawGate(...args);
    assert.equal(res.status, 2, args.join(' '));
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /--writer is required and names the role that wrote the diff: main \| bounded \| second \| mixed \(on Claude Code also claude \| sonnet \| codex\)/, args.join(' '));
    assert.match(res.stderr, /usage: review-gate\.mjs/, args.join(' '));
  }
  res = rawGate('--base', base, '--kind', 'slice', '--writer', 'mixed');
  assert.equal(res.status, 0, res.stderr);

  // A git failure (a base that is not a commit) is exit 2 with the message on stderr.
  res = gate('--base', 'no-such-ref', '--kind', 'slice');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /review-gate: git failed/);
  // A base that names a file, not a revision, is the same failure -- never a path filter.
  res = gate('--base', 'README.md', '--kind', 'unit');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /review-gate: git failed: README\.md is not a commit/);
  res = gate('--base', base, '--head', 'README.md', '--kind', 'unit');
  assert.equal(res.status, 2);
});

// ---- the writer is never assumed; sonnet and mixed are writers too

test('writer: it has no default -- missing, empty or unknown is an error for every kind', () => {
  for (const kind of ['slice', 'unit', 'fix'])
    for (const writer of [undefined, null, '', 'gemini'])
      assert.throws(
        () => decideCore({ files: [f(COLD, 5)], kind, maxFixed: 'P1', writer }),
        /--writer is required and must be one of claude\|codex\|sonnet\|mixed/,
        `${kind} ${String(writer)}`,
      );
  assert.deepEqual(WRITERS, ['claude', 'codex', 'sonnet', 'mixed']);
  assert.throws(() => decideCore({ files: [], kind: 'slice' }), /--writer is required/);
  assert.equal(parseArgs(['--base', 'a']).writer, null, 'parseArgs does not invent a writer');
});

test('writer sonnet 1: a critical slice written by Sonnet gets an Opus reviewer now', () => {
  const r = bound(() => decide({ files: [f(HOT, 5), f(COLD, 5)], kind: 'slice', writer: 'sonnet' }));
  assert.equal(r.decision, 'required');
  assert.deepEqual(r.reviewers, ['opus-code-reviewer']);
  assert.match(r.reason, /critical code written by Sonnet .*: Opus reviews it now/);
  assert.ok(r.reason.endsWith(`now (${HOT})`), r.reason);
});

test('writer sonnet 2: a cold slice written by Sonnet goes to the second family, a different family', () => {
  const r = bound(() => decide({ files: [f(COLD, 80)], kind: 'slice', writer: 'sonnet' }));
  assert.equal(r.decision, 'second-family');
  assert.deepEqual(r.reviewers, ['second-family-review']);
});

test('writer sonnet 3: a small unit by Sonnet is read by the second family; critical fixes are re-read by Opus', () => {
  const unit = decide({ files: [f(COLD, 20)], kind: 'unit', tier: 'small', writer: 'sonnet' });
  assert.deepEqual(unit.reviewers, ['second-family-review']);
  const cold = decide({ files: [f(COLD, 80)], kind: 'fix', maxFixed: 'P1', writer: 'sonnet' });
  assert.equal(cold.decision, 'second-family');
  assert.deepEqual(cold.reviewers, ['second-family-review']);
  const hot = bound(() => decide({ files: [f(HOT, 5)], kind: 'fix', maxFixed: 'P1', writer: 'sonnet' }));
  assert.equal(hot.decision, 'review');
  assert.deepEqual(hot.reviewers, ['opus-code-reviewer']);
  assert.match(hot.reason, /the fix was written by Sonnet, so Opus reads it/);
});

test('writer mixed 1: a critical fix round from several executors is re-read by Opus, never the second family alone', () => {
  for (const [maxFixed, lines] of [['P1', FIX_LINES], ['P1', FIX_LINES + 1], ['P2', FIX_LINES * 5]]) {
    const r = bound(() => decide({ files: [f(HOT, lines)], kind: 'fix', maxFixed, writer: 'mixed' }));
    assert.equal(r.decision, 'review', `${maxFixed} ${lines}`);
    assert.deepEqual(r.reviewers, ['opus-code-reviewer'], `${maxFixed} ${lines}`);
    assert.match(r.reason, /the fix was written by several executors, so Opus reads it/);
  }
  const r3 = bound(() => decide({ files: [f(HOT, 5)], kind: 'fix', maxFixed: 'P1', round: 3, writer: 'mixed' }));
  assert.deepEqual(r3.reviewers, ['opus-adversarial']);
  // a critical slice from several executors gets Opus now
  const slice = bound(() => decide({ files: [f(HOT, 5)], kind: 'slice', writer: 'mixed' }));
  assert.equal(slice.decision, 'required');
  assert.deepEqual(slice.reviewers, ['opus-code-reviewer']);
});

test('writer mixed 2: a cold mixed fix round or slice is never a second-family-only review', () => {
  const fix = decide({ files: [f(COLD, 80)], kind: 'fix', maxFixed: 'P1', writer: 'mixed' });
  assert.equal(fix.decision, 'review');
  assert.deepEqual(fix.reviewers, ['sonnet-code-reviewer']);
  assert.ok(!fix.reviewers.some((x) => x.startsWith('second-family')));
  const slice = bound(() => decide({ files: [f(COLD, 80)], kind: 'slice', writer: 'mixed' }));
  assert.equal(slice.decision, 'defer');
  const unit = decide({ files: [f(COLD, 20)], kind: 'unit', tier: 'small', writer: 'mixed' });
  assert.deepEqual(unit.reviewers, ['sonnet-code-reviewer']);
});

test('writer bounded: Opus and Sonnet together are bounded (sonnet on Claude Code), read by the second family; mixed means the second family wrote part of it', () => {
  const coldSlice = (writer) => bound(() => decide({ files: [f(COLD, 20)], kind: 'slice', writer }));
  const smallUnit = (writer) => decide({ files: [f(COLD, 20)], kind: 'unit', tier: 'small', writer });
  const hotSlice = (writer) => bound(() => decide({ files: [f(HOT, 20)], kind: 'slice', writer }));
  for (const writer of [writerRole('bounded', 'codex'), writerRole('sonnet', 'claude')]) {
    assert.deepEqual(coldSlice(writer).reviewers, ['second-family-review'], `a cold slice by ${writer}`);
    assert.deepEqual(smallUnit(writer).reviewers, ['second-family-review'], `a small unit by ${writer}`);
    const hot = hotSlice(writer);
    assert.equal(hot.decision, 'required', `a critical slice by ${writer}`);
    assert.deepEqual(hot.reviewers, ['opus-code-reviewer'], `a critical slice by ${writer}`);
  }
  const mixed = writerRole('mixed', 'codex');
  assert.equal(coldSlice(mixed).decision, 'defer', 'a cold mixed slice');
  assert.deepEqual(smallUnit(mixed).reviewers, ['sonnet-code-reviewer'], 'a small mixed unit');
  assert.equal(hotSlice(mixed).decision, 'required', 'a critical mixed slice');
});

// ---- the host: --writer names the writer's role, so a family name never routes as Claude Code's

/** A temp repo whose working tree holds a small unit: one untracked 3-line production file. */
function smallUnitRepo(t, env) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'review-gate-host-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...a) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a],
      { cwd: repo, env, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/new.ts'), 'a\nb\nc\n');
  const base = git('rev-parse', 'HEAD');
  return (extraEnv, ...args) =>
    spawnSync(process.execPath, [RUNNER, '--base', base, '--kind', 'unit', '--tier', 'small', ...args], {
      cwd: repo,
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
    });
}

test('host 1: on a Codex host a family name is refused, and the role main sends a small unit to the second family', (t) => {
  const gate = smallUnitRepo(t, cleanEnv());
  const codex = { HARNESS_HOST: 'codex' };
  // the session's own code on Codex is Codex's: read as Claude Code's "codex" it went to the bounded
  // model, the family that wrote it
  let res = gate(codex, '--writer', 'codex');
  assert.equal(res.status, 2, res.stdout);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /--writer codex names a model family; on a codex host name the role: main \| bounded \| second \| mixed/);
  // a missing or unknown writer names the roles only, never a family this host refuses
  for (const args of [['--writer', 'gemini'], []]) {
    res = gate(codex, ...args);
    assert.equal(res.status, 2, args.join(' '));
    assert.match(res.stderr, /^review-gate: --writer is required and names the role that wrote the diff: main \| bounded \| second \| mixed\n/, args.join(' '));
  }
  // the reason names the writer, never the routing value (on Codex, "claude" would be the other family)
  res = gate(codex, '--writer', 'main');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, bareLine({ files: NEW, kind: 'unit', tier: 'small', writer: 'claude' }));
  res = gate(codex, '--writer', 'main', '--json');
  assert.equal(res.status, 0, res.stderr);
  const json = JSON.parse(res.stdout);
  const main = decideCore({ files: NEW, kind: 'unit', tier: 'small', writer: 'claude' });
  assert.equal(json.decision, main.decision);
  assert.deepEqual(json.reviewers, main.reviewers);
  assert.deepEqual([json.host, json.role], ['codex', 'main']);
});

test('host 2: --host beats the environment, family names still route on Claude Code, a bad HARNESS_HOST is exit 2', (t) => {
  const gate = smallUnitRepo(t, cleanEnv());
  let res = gate({ HARNESS_HOST: 'claude' }, '--writer', 'sonnet', '--host', 'kimi');
  assert.equal(res.status, 2, res.stdout);
  assert.match(res.stderr, /--writer sonnet names a model family; on a kimi host name the role/);
  res = gate({ HARNESS_HOST: 'zcode' }, '--writer', 'codex', '--host', 'claude', '--json');
  assert.equal(res.status, 0, res.stderr);
  const json = JSON.parse(res.stdout);
  assert.deepEqual(json.reviewers, decideCore({ files: NEW, kind: 'unit', tier: 'small', writer: 'codex' }).reviewers);
  assert.deepEqual([json.host, json.role, json.writer], ['claude', 'codex', 'codex']);
  // the printed line is unchanged by the host
  res = gate({ HARNESS_HOST: 'codex' }, '--writer', 'second');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, bareLine({ files: NEW, kind: 'unit', tier: 'small', writer: 'codex' }));
  res = gate({ HARNESS_HOST: 'gemini' }, '--writer', 'main');
  assert.equal(res.status, 2, res.stdout);
  assert.match(res.stderr, /HARNESS_HOST must be one of claude, codex, zcode, kimi, not "gemini"/);
  assert.match(res.stderr, /usage: review-gate\.mjs/);
});

test('host 3: writerRole maps each role to the same routing value on every host', () => {
  assert.deepEqual(ROLES, { main: 'claude', bounded: 'sonnet', second: 'codex', mixed: 'mixed' });
  for (const host of ['claude', 'codex', 'zcode', 'kimi', 'unknown'])
    for (const [role, routed] of [['main', 'claude'], ['bounded', 'sonnet'], ['second', 'codex'], ['mixed', 'mixed']])
      assert.equal(writerRole(role, host), routed, `${role} on ${host}`);
  // so on any host the role main sends a small unit to the second family, second to the bounded model
  const unit = (writer) => decide({ files: [f(COLD, 20)], kind: 'unit', tier: 'small', writer }).reviewers;
  assert.deepEqual(unit(writerRole('main', 'codex')), ['second-family-review']);
  assert.deepEqual(unit(writerRole('second', 'zcode')), ['sonnet-code-reviewer']);
});

test('host 4: a family name keeps its meaning on Claude Code or an unknown host, and is refused on any other', () => {
  for (const host of ['claude', 'unknown'])
    for (const w of ['claude', 'sonnet', 'codex']) assert.equal(writerRole(w, host), w, `${w} on ${host}`);
  for (const host of ['codex', 'zcode', 'kimi'])
    for (const w of ['claude', 'sonnet', 'codex'])
      assert.throws(
        () => writerRole(w, host),
        new RegExp(`^Error: --writer ${w} names a model family; on a ${host} host name the role: main \\| bounded \\| second \\| mixed$`),
        `${w} on ${host}`,
      );
  // a missing or unknown writer is refused here, naming the roles (and on Claude Code the family names)
  for (const w of [null, undefined, '', 'gemini', 'opus']) {
    for (const host of ['claude', 'unknown'])
      assert.throws(
        () => writerRole(w, host),
        /^Error: --writer is required and names the role that wrote the diff: main \| bounded \| second \| mixed \(on Claude Code also claude \| sonnet \| codex\)$/,
        `${String(w)} on ${host}`,
      );
    for (const host of ['codex', 'zcode', 'kimi'])
      assert.throws(
        () => writerRole(w, host),
        /^Error: --writer is required and names the role that wrote the diff: main \| bounded \| second \| mixed$/,
        `${String(w)} on ${host}`,
      );
  }
  assert.throws(() => writerRole('main', 'gemini'), /--host must be one of claude\|codex\|zcode\|kimi/);
});

test('host 5: parseArgs takes --host for a known host only, and sets it only when given', () => {
  for (const host of ['claude', 'codex', 'zcode', 'kimi'])
    assert.equal(parseArgs(['--base', 'a', '--host', host]).host, host);
  assert.ok(!('host' in parseArgs(['--base', 'a'])), 'no --host: the CLI detects it');
  for (const bad of ['unknown', 'gemini', 'Codex', ''])
    assert.throws(() => parseArgs(['--base', 'a', '--host', bad]), /--host must be one of claude\|codex\|zcode\|kimi/, bad);
  assert.throws(() => parseArgs(['--base', 'a', '--host']), /--host needs a value/);
});
