// harness-bootstrap review-gate tests (generated YYYY-MM-DD). Run: node --test scripts/lib/review-gate-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the tests inject their own
// CRITICAL set (and restore it) and read FIX_LINES / TRIGGERS, never a project path or number.
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
  NON_PRODUCTION,
  TESTS,
  TRIGGERS,
  WRITERS,
  decide as decideCore,
  formatLine,
  isCritical,
  isProduction,
  parseArgs,
  parseNumstat,
} from './review-gate-core.mjs';

const RUNNER = fileURLToPath(new URL('../review-gate.mjs', import.meta.url));

// `writer` has no default in the core; the tests that are not about the writer name Opus ('claude').
const decide = (o) => decideCore({ writer: 'claude', ...o });
const f = (p, lines) => ({ path: p, lines });
const COLD = 'src/ui/panel.tsx';
const HOT = 'src/core/engine.ts';
const TEST_FILE = 'src/core/engine.test.ts';

/** Run `fn` with CRITICAL bound to `patterns`, then restore it (decide reads the live array). */
function withCritical(patterns, fn) {
  const saved = CRITICAL.splice(0, CRITICAL.length, ...patterns);
  try {
    return fn();
  } finally {
    CRITICAL.splice(0, CRITICAL.length, ...saved);
  }
}
const bound = (fn) => withCritical([/^src\/core\//], fn);

// ---- the shipped bindings

test('the shipped bindings: CRITICAL is empty, and production / test shapes are recognised', () => {
  assert.deepEqual(CRITICAL, []);
  assert.ok(isProduction('src/a.ts'));
  for (const p of [
    'README.md',
    'docs/x.ts',
    'src/__tests__/a.ts',
    'tests/a.js',
    'test/a.js',
    'e2e/a.ts',
    'src/fixtures/a.json',
    'src/a.test.ts',
    'src/a.spec.mjs',
  ])
    assert.ok(!isProduction(p), p);
  assert.ok(NON_PRODUCTION.length > 0 && TESTS.length > 0);
  assert.ok(!isCritical(HOT), 'nothing is critical while CRITICAL is empty');
  assert.deepEqual(Object.keys(TRIGGERS), [
    'security-reviewer',
    'silent-failure-hunter',
    'database-reviewer',
  ]);
  assert.ok(Number.isInteger(FIX_LINES) && FIX_LINES > 0);
});

test('parseNumstat sums added and deleted, binary files count 0, tabs in a path survive', () => {
  assert.deepEqual(parseNumstat('3\t4\ta.ts\n-\t-\timg.png\n0\t2\tdir/we\tird.ts\n'), [
    f('a.ts', 7),
    f('img.png', 0),
    f('dir/we\tird.ts', 2),
  ]);
  assert.deepEqual(parseNumstat(''), []);
});

test('parseNumstat reads the -z form, where git never quotes a path', () => {
  assert.deepEqual(
    parseNumstat('2\t1\tsrc/core/odd\tname.ts\0-\t-\tsrc/core/runtime.wasm\x000\t1\tsrc/a "q".ts\0'),
    [f('src/core/odd\tname.ts', 3), f('src/core/runtime.wasm', 0), f('src/a "q".ts', 1)],
  );
  // so a critical path with an odd name stays critical
  const r = bound(() =>
    decide({ files: parseNumstat('2\t1\tsrc/core/odd\tname.ts\0'), kind: 'fix', maxFixed: 'P1', round: 3 }),
  );
  assert.equal(r.decision, 'escalate-adversarial');
});

// ---- kind slice

test('slice 1: no production file is skipped', () => {
  for (const files of [[], [f('docs/x.md', 90), f(TEST_FILE, 40)]]) {
    const r = bound(() => decide({ files, kind: 'slice' }));
    assert.equal(r.decision, 'skip');
    assert.deepEqual(r.reviewers, []);
    assert.match(r.reason, /no production code/);
  }
  // The codex writer does not change that.
  assert.equal(decide({ files: [f(TEST_FILE, 9)], kind: 'slice', writer: 'codex' }).decision, 'skip');
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

test('unit 1: no production file is skipped, at either tier', () => {
  for (const tier of ['small', 'full'])
    assert.equal(decide({ files: [f('docs/a.md', 50)], kind: 'unit', tier }).decision, 'skip');
});

test('a binary or mode-only production file (0 lines) is still a change to review', () => {
  const bin = [f('src/core/runtime.wasm', 0)];
  assert.equal(bound(() => decide({ files: bin, kind: 'slice' })).decision, 'second-family');
  assert.equal(bound(() => decide({ files: bin, kind: 'unit' })).decision, 'review');
  const r = bound(() => decide({ files: bin, kind: 'fix', maxFixed: 'P1', round: 3 }));
  assert.equal(r.decision, 'escalate-adversarial');
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
  // A non-production path never calls a specialist; a test file alone calls the analyzer only
  // when production code is also in the diff.
  const testOnlyTrigger = decide({ files: [f(COLD, 5), f('src/auth/login.test.ts', 5)], kind: 'unit' });
  assert.deepEqual(testOnlyTrigger.reviewers, [
    'opus-code-reviewer',
    'second-family-adversarial',
    'pr-test-analyzer',
  ]);
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

test('fix 2: a fix round with no production lines is skipped', () => {
  const r = bound(() => decide({ files: [f(TEST_FILE, 200)], kind: 'fix', maxFixed: 'P1' }));
  assert.equal(r.decision, 'skip');
  assert.deepEqual(r.reviewers, []);
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

test('fix 4: round 3+ on critical code escalates to the adversarial pass', () => {
  for (const [maxFixed, round] of [['P1', 3], ['P2', 3], ['P0', 4], ['P1', 9]]) {
    const r = bound(() => decide({ files: [f(HOT, 5)], kind: 'fix', maxFixed, round }));
    assert.equal(r.decision, 'escalate-adversarial', `${maxFixed} round ${round}`);
    assert.deepEqual(r.reviewers, ['second-family-adversarial']);
  }
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

test('fix codex 6: critical round 3+ by the second family is an Opus adversarial pass, same tripwire wording', () => {
  for (const round of [3, 5]) {
    const r = codexFix([f(HOT, 5)], 'P1', round);
    assert.equal(r.decision, 'escalate-adversarial', `round ${round}`);
    assert.deepEqual(r.reviewers, ['opus-adversarial']);
    assert.match(r.reason, /owner-stop tripwire/);
    assert.match(r.reason, /an adversarial pass by Opus \(the fix was not written by Opus\), never another standard code-review round/);
    // the reason names the reviewer the routing names
    const claude = bound(() => decide({ files: [f(HOT, 5)], kind: 'fix', maxFixed: 'P1', round }));
    assert.deepEqual(claude.reviewers, ['second-family-adversarial']);
    assert.match(claude.reason, /an adversarial pass by the second family, never another standard code-review round/);
  }
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
    assert.ok(r.notChecked.includes('importers>=10'));
    assert.ok(r.notChecked.includes('critical code outside the CRITICAL path set'));
  }
  const boundResult = bound(() => decide({ files: [f(COLD, 5)], kind: 'slice' }));
  assert.deepEqual(boundResult.notChecked, [
    'importers>=10',
    'critical code outside the CRITICAL path set',
  ]);
});

test('the result carries every fact the decision used', () => {
  const r = bound(() =>
    decide({
      files: [f(HOT, 7), f(COLD, 3), f('docs/a.md', 99)],
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
    'tier',
    'writer',
  ]);
  assert.equal(r.prodFiles, 2);
  assert.equal(r.prodLines, 10);
  assert.deepEqual(r.critical, [HOT]);
  assert.deepEqual([r.kind, r.tier, r.writer, r.maxFixed, r.round], ['fix', 'small', 'codex', 'P2', 2]);
});

test('invalid kind, tier, writer and round are errors the wrapper turns into exit 2', () => {
  const ok = { files: [f(COLD, 1)], kind: 'slice' };
  assert.throws(() => decide({ ...ok, kind: 'first' }), /--kind must be one of slice\|unit\|fix/);
  assert.throws(() => decide({ ...ok, kind: undefined }), /--kind/);
  assert.throws(() => decide({ ...ok, tier: 'medium' }), /--tier must be one of small\|full/);
  assert.throws(() => decide({ ...ok, writer: 'gemini' }), /--writer is required and must be one of claude\|codex\|sonnet\|mixed/);
  for (const round of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => decide({ ...ok, round }), /--round must be an integer >= 1/, String(round));
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

test('formatLine prints one line: decision, reason, reviewers, facts, what was not checked', () => {
  const line = formatLine(decide({ files: [f(COLD, 12), f('docs/a.md', 5)], kind: 'unit' }));
  assert.ok(!line.includes('\n'));
  assert.match(
    line,
    /^review-gate: review — full unit: one review pass over the whole unit diff → opus-code-reviewer \+ second-family-adversarial \[1 production files, 12 lines; not checked: importers>=10, critical code outside the CRITICAL path set, CRITICAL unbound — every path treated as cold\]$/,
  );
  assert.match(formatLine(decide({ files: [], kind: 'slice' })), /→ none \[0 production files, 0 lines;/);
});

// ---- the wrapper, end to end, in a temp repo

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
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
  assert.match(res.stdout, /^review-gate: skip — no production code: tests or docs only → none \[0 production files, 0 lines; not checked: .*\]\n$/);

  // An untracked production file is seen (3 lines), and --kind unit names the full-tier reviewers.
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/new.ts'), 'a\nb\nc\n');
  res = gate('--base', base, '--kind', 'unit');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim().split('\n').length, 1);
  assert.match(res.stdout, /^review-gate: review — .* → opus-code-reviewer \+ second-family-adversarial \[1 production files, 3 lines; /);
  res = gate('--base', base, '--kind', 'slice', '--json');
  assert.equal(res.status, 0, res.stderr);
  const json = JSON.parse(res.stdout);
  assert.equal(json.decision, 'second-family');
  assert.equal(json.prodLines, 3);

  // --head limits the diff to the committed range: the untracked file is not in it.
  res = gate('--base', base, '--head', 'HEAD', '--kind', 'slice');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^review-gate: skip /);
  git('add', '.');
  git('commit', '-q', '-m', 'work');
  res = gate('--base', base, '--head', 'HEAD', '--kind', 'slice', '--writer', 'codex');
  assert.match(res.stdout, /^review-gate: defer — cold slice written by the second family/);

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
    assert.match(res.stderr, /--writer is required and must be one of claude\|codex\|sonnet\|mixed/, args.join(' '));
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
