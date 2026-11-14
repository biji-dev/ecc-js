/**
 * Tests for the harness-bootstrap review-gate template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating named rules.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'review-gate-core.test.mjs');
const CORE_REL = path.join('lib', 'review-gate-core.mjs');
const WRAPPER_REL = 'review-gate.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 97;

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

/** Env without any GIT_* variable (an inherited hook environment never matters). */
function hermeticEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  return { ...env, ...extra };
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(scriptsDir, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(scriptsDir, TEST_REL)],
    { encoding: 'utf8', env: hermeticEnv(extraEnv), timeout: 120_000 }
  );
}

const cleanup = [];

/** Copy the shipped scripts, replace `needle` with `replacement` in the core, run the suite. */
function mutantRun(needle, replacement) {
  const copy = tmp('review-gate-mutant-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  const mutated = before.replace(needle, replacement);
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(corePath, mutated);
  const res = runSuite(copy);
  const out = res.stdout + res.stderr;
  assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
  assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
}

console.log('\nharness-bootstrap review-gate template');

test('the shipped review-gate suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

/** The core's [B] block rebound the way installs do, and the test's [B] block kept matching it. */
const REBOUND_CRITICAL = 'export const CRITICAL = [/^src\\/(core|ui)\\//, /(^|\\/)AGENTS\\.md$/];';
const CORE_CRITICAL = [CORE_REL, 'export const CRITICAL = [];', REBOUND_CRITICAL];
const REBINDINGS = [
  CORE_CRITICAL,
  [CORE_REL, "'security-reviewer': [/auth|session|token|crypto|permission|rbac|tenant|webhook|public/i],", "'security-reviewer': [/./],"],
  [CORE_REL, '/\\.(test|spec)\\.[cm]?[jt]sx?$/]; // paths that are not production', '/\\.(test|spec)\\.[cm]?[jt]sx?$/, /^scripts\\//]; // paths that are not production'],
  [CORE_REL, '/\\.(test|spec)\\.[cm]?[jt]sx?$/]; // paths that count as tests', '/\\.(test|spec)\\.[cm]?[jt]sx?$/, /(^|\\/)\\.maestro\\//]; // paths that count as tests'],
  [CORE_REL, 'export const FIX_LINES = 40;', 'export const FIX_LINES = 25;'],
  [CORE_REL, 'export const HARNESS = [...INSTRUCTIONS, /^\\.githooks\\//];', 'export const HARNESS = [...INSTRUCTIONS, /^\\.githooks\\//, /^scripts\\//, /^harness\\//];'],
  [TEST_REL, 'const EXPECTED_CRITICAL = [];', REBOUND_CRITICAL.replace('export const CRITICAL', 'const EXPECTED_CRITICAL')],
];

/** Copy the shipped scripts, apply each rebinding (each needle exactly once), run the suite. */
function reboundRun(rebindings) {
  const copy = tmp('review-gate-rebound-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  for (const [rel, needle, replacement] of rebindings) {
    const file = path.join(copy, rel);
    const before = fs.readFileSync(file, 'utf8');
    assert.strictEqual(before.split(needle).length - 1, 1, `${needle} is not in ${rel} exactly once`);
    fs.writeFileSync(file, before.replace(needle, () => replacement));
  }
  const res = runSuite(copy);
  return { res, out: res.stdout + res.stderr };
}

test('the shipped suite passes with the core\'s bindings rebound as an install binds them', () => {
  const { res, out } = reboundRun(REBINDINGS);
  const failing = out.match(/^not ok .*$/gm) ?? [];
  assert.strictEqual(res.status, 0, `rebound: ${failing.length} failing, first: ${failing.slice(0, 3).join(' | ')}\n${out.slice(-1200)}`);
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1200));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

test('the core\'s CRITICAL rebound alone fails exactly one test: the [B] CRITICAL test', () => {
  const { out } = reboundRun([CORE_CRITICAL]);
  const failing = out.match(/^not ok .*$/gm) ?? [];
  assert.strictEqual(failing.length, 1, `expected one failing test, got ${failing.length}: ${failing.join(' | ')}`);
  assert.match(failing[0], /^not ok \d+ - \[B\] the core's CRITICAL is EXPECTED_CRITICAL/);
});

// the paths the template's NON_PRODUCTION must keep out of production
const NINE = ['README.md', 'docs/x.ts', 'src/__tests__/a.ts', 'tests/a.js', 'test/a.js', 'e2e/a.ts', 'src/fixtures/a.json', 'src/a.test.ts', 'src/a.spec.mjs'];
/** The template core's default bindings, read in a child process (the shipped suite no longer pins them). */
function checkDefaults(scriptsDir) {
  const url = pathToFileURL(path.join(scriptsDir, CORE_REL)).href;
  const paths = { db: ['db/migrations/001_init.sql', 'src/db/schema.ts', 'src/ui/panel.tsx', 'src/a.ts'], production: ['src/a.ts', ...NINE] };
  const code = `import * as c from ${JSON.stringify(url)};
const p = ${JSON.stringify(paths)};
console.log(JSON.stringify({
  critical: c.CRITICAL.length,
  triggers: Object.keys(c.TRIGGERS),
  db: p.db.map((x) => c.TRIGGERS['database-reviewer'].some((re) => re.test(x))),
  fixLines: c.FIX_LINES,
  production: p.production.map(c.isProduction),
  harness: ['AGENTS.md', '.claude/settings.json', '.githooks/pre-commit', 'scripts/run-gates.sh', 'src/a.ts'].map(c.isHarness),
  tiers: c.TIERS,
}));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: hermeticEnv() });
  assert.strictEqual(res.status, 0, res.stderr);
  const got = JSON.parse(res.stdout);
  assert.strictEqual(got.critical, 0, 'the template CRITICAL is not empty');
  assert.deepStrictEqual(got.triggers, ['security-reviewer', 'silent-failure-hunter', 'database-reviewer'], 'the template TRIGGERS keys');
  assert.deepStrictEqual(got.db, [true, true, false, false], `database-reviewer matches ${paths.db.join(', ')} as ${got.db.join(', ')}`);
  assert.strictEqual(got.fixLines, 40, 'the template FIX_LINES');
  assert.deepStrictEqual(got.production, [true, ...NINE.map(() => false)], `production: ${paths.production.join(', ')} as ${got.production.join(', ')}`);
  assert.deepStrictEqual(got.harness, [true, true, true, false, false], 'the template HARNESS: the instruction files and .githooks/ until the install adds its scripts');
  assert.deepStrictEqual(got.tiers, ['small', 'full', 'harness'], 'the template TIERS');
}

test('the template core ships its default bindings', () => {
  checkDefaults(SCRIPTS);
});

test('mutant: the database trigger matching every path fails the defaults check', () => {
  const copy = tmp('review-gate-defaults-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  const mutated = before.replace('/\\.sql$/i,', '/./,');
  assert.notStrictEqual(mutated, before, 'the mutation did not apply');
  fs.writeFileSync(corePath, mutated);
  assert.throws(() => checkDefaults(copy), /database-reviewer matches/);
});

test('the suite is unaffected by GIT_DIR / GIT_INDEX_FILE of a caller repo (as inside a git hook)', () => {
  const decoy = tmp('review-gate-decoy-');
  cleanup.push(decoy);
  const run = (...args) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { cwd: decoy, env: hermeticEnv(), encoding: 'utf8' }
    );
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  run('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(decoy, 'f.txt'), 'x\n');
  run('add', '.');
  run('commit', '-q', '-m', 'base');
  const snapshot = () => [run('log', '--all', '--format=%H'), run('status', '--porcelain')];
  const before = snapshot();
  const res = runSuite(SCRIPTS, {
    GIT_DIR: path.join(decoy, '.git'),
    GIT_WORK_TREE: decoy,
    GIT_INDEX_FILE: path.join(decoy, '.git', 'index'),
  });
  // The suite must still pass and must not have written into the decoy repository.
  assert.strictEqual(tapCount(res.stdout + res.stderr, 'pass'), EXPECTED_TESTS);
  assert.deepStrictEqual(snapshot(), before, 'the suite wrote into the repository named by GIT_DIR');
});

test('mutant: a P3-only fix round that is no longer the P3 batch makes the suite fail', () => {
  mutantRun("maxFixed === 'P3')", "maxFixed === 'P3x')");
});

test('mutant: a P3 batch over critical code by Sonnet or the second family is the P3 batch again, read by nobody', () => {
  mutantRun("if (critical.length > 0 && writer !== 'claude')", 'if (false)');
});

test('mutant: the P3 batch\'s writer check dropped, so Opus\'s own batch gets the Opus reviewer too', () => {
  mutantRun("if (critical.length > 0 && writer !== 'claude')", 'if (critical.length > 0)');
});

test('mutant: critical code written by the second family no longer gets a Claude reviewer', () => {
  mutantRun('secondFamilyWrote(writer) && critical.length === 0', 'secondFamilyWrote(writer)');
});

test('mutant: a default writer comes back, so a cold Codex slice run without --writer is not caught', () => {
  mutantRun("tier = 'full', writer, maxFixed", "tier = 'full', writer = 'claude', maxFixed");
});

test('mutant: writer mixed no longer routes like the second family', () => {
  mutantRun("writer === 'codex' || writer === 'mixed'", "writer === 'codex'");
});

test('mutant: critical code written by Sonnet no longer gets an Opus reviewer', () => {
  mutantRun("if (writer !== 'claude' && critical.length > 0) {", "if (secondFamilyWrote(writer) && critical.length > 0) {");
});

test('mutant: a family name on a Codex, ZCode or Kimi host is no longer refused, so it routes as Claude Code\'s', () => {
  mutantRun('WRITERS.includes(writer) && !FAMILY_HOSTS.includes(host)', 'WRITERS.includes(writer) && false');
});

test('mutant: a missing or unknown --writer falls through to decide()\'s message, which names refused family names', () => {
  mutantRun('  if (WRITERS.includes(writer)) return writer;\n', '  return writer;\n');
});

test('mutant: the small-unit reason prints the routing value again, naming the wrong family off Claude Code', () => {
  mutantRun('small unit written by ${WRITER_NAMES[writer]}', 'small unit written by ${writer}');
});

test('mutant: the FIX_LINES boundary moved by one makes the suite fail', () => {
  mutantRun('prodLines <= FIX_LINES', 'prodLines < FIX_LINES');
});

test('mutant: critical computed over production files only, so a test under a critical path is cold again', () => {
  mutantRun('const critical = reviewed.filter(', 'const critical = prod.filter(');
});

test('mutant: the skip back to "no production file", so a tests-only diff owes no reviewer', () => {
  mutantRun('const docsOnly = reviewed.length === 0;', 'const docsOnly = prod.length === 0;');
});

test('mutant: isProduction ignoring INSTRUCTIONS, so AGENTS.md and .claude/ are docs again', () => {
  mutantRun('(isInstruction(path) ? !isTest(path) : !isExempt(path))', '!isExempt(path)');
});

test('mutant: a test in an instruction directory counted as production again, so its lines make a fix large', () => {
  mutantRun('(isInstruction(path) ? !isTest(path) : !isExempt(path))', 'isInstruction(path) || !isExempt(path)');
});

test('mutant: critical code at --tier small no longer escalates to the full lineup', () => {
  mutantRun("const escalate = tier === 'small' && critical.length > 0;", 'const escalate = false;');
});

test('mutant: the specialists matching an instruction file\'s prose makes the suite fail', () => {
  mutantRun('files.some((f) => !isExempt(f.path) && TRIGGERS', 'files.some((f) => isProduction(f.path) && TRIGGERS');
});

test('mutant: the harness lane gone, so a harness-only unit gets the full lineup again', () => {
  mutantRun('const lane = tier === \'harness\' && stray.length === 0;', 'const lane = false;');
});

test('mutant: the harness lane taking a product path, so a stray app file gets one reviewer', () => {
  mutantRun('reviewed.filter((f) => !isHarness(f.path))', 'reviewed.filter(() => false)');
});

test('mutant: the harness lane allowing a second standard fix round', () => {
  mutantRun("    if (round === 2)\n      return out(\n        'adversarial',", "    if (round === 9)\n      return out(\n        'adversarial',");
});

test('mutant: the harness lane running a third round instead of dropping the change', () => {
  mutantRun("    if (round >= 3)\n      return out(\n        'drop',", "    if (round >= 9)\n      return out(\n        'drop',");
});

test('mutant: a cold fix that closed only P2s is re-reviewed again (v12)', () => {
  mutantRun("if (maxFixed === 'P2')\n", "if (false)\n");
});

test('mutant: a P2-only round on critical code past round 2 climbs the adversarial ladder again (v12)', () => {
  mutantRun("if (maxFixed === 'P2' && round >= 3)", 'if (false)');
});

test('mutant: a deferred fix drops the triggered specialist (v12)', () => {
  mutantRun("if (r.decision === 'skip' || r.decision === 'defer')", "if (r.decision === 'skip')");
});

test('mutant: the Sonnet code-reviewer reads what the second family wrote again (v12)', () => {
  mutantRun("secondFamilyWrote(writer) ? 'opus-code-reviewer' : 'second-family-review'", "secondFamilyWrote(writer) ? 'sonnet-code-reviewer' : 'second-family-review'");
});

test('mutant: production none takes the Opus reader off a fix the second family wrote (v12)', () => {
  mutantRun('if (none && !secondFamilyWrote(writer) && r.reviewers', 'if (none && r.reviewers');
});

test('mutant: a critical round 5 redesigned again instead of cut', () => {
  mutantRun('  if (round >= 5)\n    return d(\n      \'cut\',', '  if (round >= 6)\n    return d(\n      \'cut\',');
});

test('mutant: a test diff with a deleted line routed as cold, so a weakened assertion skips the critical lineup', () => {
  mutantRun('isTest(f.path) && f.deleted === 0 && !f.binary', 'isTest(f.path) && !f.binary');
});

test('mutant: production none keeping the Opus code-reviewer on a critical fix', () => {
  mutantRun("if (none && !secondFamilyWrote(writer) && r.reviewers.includes('opus-code-reviewer'))", 'if (false)');
});

test('mutant: production none dropping the adversarial pass over critical code', () => {
  mutantRun('...(critical.length ? [adv] : [])', '...[]');
});

test('mutant: a self-loop edge counted as a read change, so an empty review certifies unread edits', () => {
  mutantRun('const read = unreached.some((p) => (paths[p]?.edges ?? []).some((e) => e.from !== e.to));', 'const read = unreached.some((p) => (paths[p]?.edges ?? []).length > 0);');
});

test('mutant: the latest row read as the reviewed content, so a narrow later review certifies the gap', () => {
  mutantRun('reachable(facts.starts, facts.edges.filter((e) => e.from !== e.to))', 'reachable([...facts.starts, ...facts.edges.map((e) => e.from)], facts.edges)');
});

test('mutant: the host filter dropped, so a row of the host\'s own family counts', () => {
  mutantRun('row.family !== OWN_LEDGER[host]', 'true');
});

test('mutant: a moved tree counted, so a review whose tree changed during the run certifies it', () => {
  mutantRun('row.treeMoved !== true &&', '');
});

test('mutant: the guards checked after the critical paths, so a reviewed gate edit merges on a self-judgement', () => {
  mutantRun("const guards = changed.filter((p) => isGuard(p) && (!holdsBlocks(p) || blockChanged[p] !== false));", 'const guards = [];');
});

test('mutant: the AGENTS.md exception widened to every edit, so a reviewed block is edited unseen', () => {
  mutantRun('blockChanged[p] !== false', 'false');
});

test('mutant: readStakes reading fenced examples again, so a sample production: none lowers the review', () => {
  mutantRun('const prose = dropFences(text);', 'const prose = String(text ?? \'\');');
});

test('mutant: production none keeping the P3 batch', () => {
  mutantRun("return none ? out('skip', [], NO_P3_BATCH) : out('p3-batch', [], P3_BATCH);\n  }", "return out('p3-batch', [], P3_BATCH);\n  }");
});

// ---- the CLI in a temp repo, under CRITICAL bound as an install binds it

/**
 * A copy of the shipped scripts with the core's CRITICAL rebound (REBOUND_CRITICAL), for the CLI.
 * `mutations` ([rel, needle, replacement], each needle exactly once) make a mutant of the copy.
 */
function boundScripts(mutations = []) {
  const copy = tmp('review-gate-cli-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  for (const [rel, needle, replacement] of [[CORE_REL, 'export const CRITICAL = [];', REBOUND_CRITICAL], ...mutations]) {
    const file = path.join(copy, rel);
    const before = fs.readFileSync(file, 'utf8');
    assert.strictEqual(before.split(needle).length - 1, 1, `${needle} is not in ${rel} exactly once`);
    fs.writeFileSync(file, before.replace(needle, () => replacement));
  }
  return copy;
}

// The variables a host sets for itself, and the owner's HARNESS_HOST. The CLI cases clear them all
// (this suite may run inside Claude Code or Codex) and each case sets the ones it needs.
const HOST_VARS = /^(HARNESS_HOST|CLAUDECODE|CODEX_THREAD_ID|CODEX_SANDBOX|ZCODE_.*)$/;
/** hermeticEnv with no host variable, then `extra`; a value of undefined leaves that variable unset. */
function gateEnv(extra) {
  const env = hermeticEnv();
  for (const key of Object.keys(env)) if (HOST_VARS.test(key)) delete env[key];
  Object.assign(env, extra);
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return env;
}

/** A temp repo on main with one base commit; `git` runs in it, `gate` runs the bound CLI in it. */
function cliRepo(mutations = []) {
  const repo = tmp('review-gate-repo-');
  cleanup.push(repo);
  const scripts = boundScripts(mutations);
  const git = (...args) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { cwd: repo, env: hermeticEnv(), encoding: 'utf8' }
    );
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  const commit = (msg) => {
    git('add', '-A');
    git('commit', '-q', '-m', msg);
  };
  const gateWith = (env, ...args) =>
    spawnSync(process.execPath, [path.join(scripts, WRAPPER_REL), ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: gateEnv({ HARNESS_HOST: 'claude', ...env }),
    });
  const gate = (...args) => gateWith({}, ...args);
  git('init', '-q', '-b', 'main');
  // the ledgers are run records, never part of a unit
  write('.gitignore', '.codex-runs/\n.claude-runs/\n');
  write('README.md', 'x\n');
  commit('base');
  return { repo, git, write, commit, gate, gateWith };
}

const ledgerLine = (row) => `${JSON.stringify(row)}\n`;
const ENGINE = 'src/core/engine.js';
/** A review row as codex-run and claude-run write it: it read `baseTree` → `tree`. */
const reviewRow = (baseTree, tree, o = {}) => ({ at: '2026-11-09T10:00:00.000Z', kind: 'review', outcome: 'ok', branch: 'feat', baseTree, tree, treeAfter: tree, ...o });
const RE_REVIEW = (from, result, paths) =>
  `critical paths changed beyond the reviewed content: ${paths[0]}${paths.length > 1 ? ` +${paths.length - 1}` : ''} → second-family-adversarial --base ${from} over git diff ${from} ${result} -- ${paths.join(' ')}, on the branch with the mainline merged in`;

/** A repo whose branch feat edited the first line of a critical file the mainline holds. */
function featRepo(mutations = []) {
  const r = cliRepo(mutations);
  r.write(ENGINE, 'a\nb\nc\nd\ne\n');
  r.commit('engine');
  r.git('checkout', '-q', '-b', 'feat');
  r.write(ENGINE, 'A\nb\nc\nd\ne\n');
  r.write('lib/helper.js', 'h\n');
  r.commit('work');
  const tree = (rev) => r.git('rev-parse', `${rev}^{tree}`);
  const ledger = (dir, ...rows) => fs.appendFileSync(path.join(r.repo, dir, 'ledger.jsonl'), rows.map(ledgerLine).join(''));
  fs.mkdirSync(path.join(r.repo, '.codex-runs'), { recursive: true });
  fs.mkdirSync(path.join(r.repo, '.claude-runs'), { recursive: true });
  return { ...r, tree, ledger };
}

test('--landing: NONE without a review, noise rows never count, PASS once the other family read the change', () => {
  const { git, gate, gateWith, tree, ledger } = featRepo();
  const base = tree('main');
  const feat = tree('feat');
  let res = gate('--landing', 'feat', '--base', 'main');
  assert.strictEqual(res.status, 1, res.stderr);
  assert.strictEqual(res.stdout, `Landing: ${feat.slice(0, 12)} NONE — no recorded cross-family review of ${ENGINE}: the owner merges\n`);

  // a bad line, a failed run, another kind, a moved tree, a ref name, a pruned tree and Claude's own row
  fs.writeFileSync(path.join(git('rev-parse', '--show-toplevel'), '.codex-runs', 'ledger.jsonl'), '{not json\n');
  ledger('.codex-runs',
    reviewRow(base, feat, { outcome: 'failed' }),
    reviewRow(base, feat, { kind: 'implement' }),
    reviewRow(base, feat, { treeMoved: true, treeAfter: base }),
    reviewRow('main', feat),
    reviewRow(base, 'f'.repeat(40)));
  ledger('.claude-runs', reviewRow(base, feat));
  res = gate('--landing', 'feat', '--base', 'main');
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, / NONE — no recorded cross-family review of src\/core\/engine\.js: the owner merges\n$/);

  // the second family's review of base → feat passes on Claude Code; on Codex that row is its own
  ledger('.codex-runs', reviewRow(base, feat, { kind: 'adversarial' }));
  res = gate('--landing', 'feat', '--base', 'main');
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.strictEqual(res.stdout, `Landing: ${feat.slice(0, 12)} PASS — every critical path is reviewed content (1 review rows)\n`);
  res = gateWith({ HARNESS_HOST: 'codex' }, '--landing', 'feat', '--base', 'main');
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, / PASS — every critical path is reviewed content \(1 review rows\)\n$/, 'on Codex the claude-run row counts');
  fs.rmSync(path.join(git('rev-parse', '--show-toplevel'), '.claude-runs', 'ledger.jsonl'));
  res = gateWith({ HARNESS_HOST: 'codex' }, '--landing', 'feat', '--base', 'main');
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, / NONE — /);

  res = gate('--landing', 'feat', '--base', 'main', '--json');
  assert.strictEqual(res.status, 0, res.stderr);
  const json = JSON.parse(res.stdout);
  assert.deepStrictEqual(Object.keys(json).sort(), ['base', 'changed', 'critical', 'from', 'guards', 'host', 'reason', 'result', 'rows', 'trust', 'unreached', 'verdict']);
  assert.deepStrictEqual(
    [json.verdict, json.result, json.base, json.trust, json.changed, json.guards, json.critical, json.unreached, json.from, json.rows.length, json.host],
    ['PASS', feat, git('rev-parse', 'main'), [], ['lib/helper.js', ENGINE], [], [ENGINE], [], null, 1, 'claude']
  );
  assert.ok(json.rows[0].ledger.endsWith(path.join('.codex-runs', 'ledger.jsonl')), json.rows[0].ledger);
});

test('--landing: an unread critical edit is RE-REVIEW from the reviewed tree; a narrow later review or an empty one never covers it', () => {
  const { write, commit, gate, tree, ledger } = featRepo();
  const base = tree('main');
  const t1 = tree('feat');
  ledger('.codex-runs', reviewRow(base, t1, { at: '2026-11-09T09:00:00.000Z' }));
  // an edit no review read, then a fix review of the next edit alone, then `review --base HEAD` over nothing
  write(ENGINE, 'A\nB\nc\nd\ne\n');
  commit('unread');
  const t2 = tree('feat');
  write(ENGINE, 'A\nB\nC\nd\ne\n');
  commit('fix');
  const t3 = tree('feat');
  ledger('.codex-runs', reviewRow(t2, t3, { at: '2026-11-09T10:00:00.000Z' }), reviewRow(t3, t3, { at: '2026-11-09T11:00:00.000Z' }));
  let res = gate('--landing', 'feat', '--base', 'main');
  assert.strictEqual(res.status, 1, res.stderr);
  assert.strictEqual(res.stdout, `Landing: ${t3.slice(0, 12)} RE-REVIEW — ${RE_REVIEW(t1, t3, [ENGINE])}\n`);
  res = gate('--landing', 'feat', '--base', 'main', '--json');
  const json = JSON.parse(res.stdout);
  assert.deepStrictEqual([json.verdict, json.unreached, json.from, json.rows.length], ['RE-REVIEW', [ENGINE], t1, 3]);
  // the re-review the line names, t1 → t3, lands it
  ledger('.codex-runs', reviewRow(t1, t3, { at: '2026-11-09T12:00:00.000Z', kind: 'adversarial' }));
  res = gate('--landing', 'feat', '--base', 'main');
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, / PASS — every critical path is reviewed content \(4 review rows\)\n$/);
});

test('--landing: an auto-merge result no review read is refused; a --trust commit of the remote mainline is a start', () => {
  const { git, write, commit, gate, tree, ledger } = featRepo();
  ledger('.codex-runs', reviewRow(tree('main'), tree('feat')));
  // the mainline changed another line of the same critical file: the merge writes content no review read
  git('checkout', '-q', 'main');
  write(ENGINE, 'a\nb\nc\nd\nE\n');
  commit('mainline edit');
  const head = git('rev-parse', 'HEAD');
  git('merge', '--no-ff', '--no-commit', 'feat');
  const result = git('write-tree');
  let res = gate('--landing', result, '--base', 'HEAD');
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  assert.strictEqual(res.stdout, `Landing: ${result.slice(0, 12)} RE-REVIEW — ${RE_REVIEW(head, result, [ENGINE])}\n`);
  git('merge', '--abort');
  // a remote mainline's commit no ledger row reached is refused, and passes once trusted (a pull)
  git('checkout', '-q', '-b', 'remote-main', 'main');
  write(ENGINE, 'a\nb\nc\nD\nE\n');
  commit('remote edit');
  git('checkout', '-q', 'main');
  assert.strictEqual(gate('--landing', 'remote-main', '--base', 'main').status, 1);
  res = gate('--landing', 'remote-main', '--base', 'main', '--trust', 'remote-main');
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, / PASS — every critical path is reviewed content \(1 review rows\)\n$/);
  for (const bad of [['--trust', 'no-such-rev'], ['--trust', 'README.md']]) {
    res = gate('--landing', 'remote-main', '--base', 'main', ...bad);
    assert.strictEqual(res.status, 2, bad.join(' '));
    assert.match(res.stderr, /review-gate: git failed: .* is not a commit/, bad.join(' '));
  }
});

test('--landing: a unit with no critical path is PASS, with or without a ledger; a guard path is NONE', () => {
  const { git, write, commit, gate } = cliRepo();
  git('checkout', '-q', '-b', 'cold');
  write('lib/helper.js', 'h\n');
  write('docs/src/core/notes.md', 'n\n');
  write('src/core/README.md', 'a doc under a critical path\n');
  commit('cold work');
  git('checkout', '-q', 'main');
  let res = gate('--landing', 'cold', '--base', 'main');
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.strictEqual(res.stdout, `Landing: ${git('rev-parse', 'cold^{tree}').slice(0, 12)} PASS — no critical path changed\n`);
  // CLAUDE.md: the project's own text is no guard; a harness block is (AGENTS.md is critical in
  // REBOUND_CRITICAL, so its own text is checked as critical code there)
  write('CLAUDE.md', '# Project\n\n<!-- harness:begin rules -->\nRule one.\n<!-- harness:end rules -->\n');
  commit('agents');
  git('checkout', '-q', '-b', 'docs');
  write('CLAUDE.md', '# Project, renamed\n\n<!-- harness:begin rules -->\nRule one.\n<!-- harness:end rules -->\n');
  commit('own text');
  res = gate('--landing', 'docs', '--base', 'main');
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, / PASS — no critical path changed\n$/);
  write('CLAUDE.md', '# Project, renamed\n\n<!-- harness:begin rules -->\nRule two.\n<!-- harness:end rules -->\n');
  write('scripts/review-gate.mjs', '// a gate\n');
  commit('block and gate');
  res = gate('--landing', 'docs', '--base', 'main');
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, / NONE — a guard, a gate or a reviewed block changed \(CLAUDE\.md \+1\): the owner merges\n$/);
});

/**
 * The host the landing reads: a host's own variable first, HARNESS_HOST only where none is set. Each
 * case clears every host variable and sets its own. Throws on the first verdict that differs.
 */
function landingHostCases(mutations = []) {
  const { gateWith, tree, ledger, repo } = featRepo(mutations);
  const run = (env) => gateWith({ HARNESS_HOST: undefined, ...env }, '--landing', 'feat', '--base', 'main');
  ledger('.codex-runs', reviewRow(tree('main'), tree('feat')));
  // 1. a Codex shell's own row: HARNESS_HOST=zcode, which reads both ledgers, does not widen it
  let res = run({ CODEX_THREAD_ID: 'thread', HARNESS_HOST: 'zcode' });
  assert.strictEqual(res.status, 1, `codex host with HARNESS_HOST=zcode: ${res.stdout}${res.stderr}`);
  assert.match(res.stdout, / NONE — no recorded cross-family review of src\/core\/engine\.js: the owner merges\n$/, 'codex host with HARNESS_HOST=zcode');
  // 2. no host variable: the owner's word decides, and zcode reads either ledger
  res = run({ HARNESS_HOST: 'zcode' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, / PASS — every critical path is reviewed content \(1 review rows\)\n$/, 'zcode from HARNESS_HOST, codex-run row');
  fs.renameSync(path.join(repo, '.codex-runs', 'ledger.jsonl'), path.join(repo, '.claude-runs', 'ledger.jsonl'));
  res = run({ HARNESS_HOST: 'zcode' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, / PASS — /, 'zcode from HARNESS_HOST, claude-run row');
  // and a Claude Code shell's own row stays its own
  res = run({ CLAUDECODE: '1', HARNESS_HOST: 'zcode' });
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, / NONE — /, 'claude host with HARNESS_HOST=zcode');
}

test('--landing: the host is the host\'s own variable; HARNESS_HOST decides only where none is set', () => {
  landingHostCases();
});

const NO_HOST = 'no host named itself (ZCODE_*, CODEX_THREAD_ID, CODEX_SANDBOX, CLAUDECODE or HARNESS_HOST), so no review row counts: run git from the host, or ask the owner to merge it';

test('--landing: with no host variable at all a critical change is NONE, whatever the ledgers hold; CLAUDECODE=1 names the host', () => {
  const { gateWith, tree, ledger } = featRepo();
  ledger('.codex-runs', reviewRow(tree('main'), tree('feat')));
  let res = gateWith({ HARNESS_HOST: undefined }, '--landing', 'feat', '--base', 'main');
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  assert.strictEqual(res.stdout, `Landing: ${tree('feat').slice(0, 12)} NONE — ${NO_HOST}\n`);
  res = gateWith({ HARNESS_HOST: undefined, CLAUDECODE: '1' }, '--landing', 'feat', '--base', 'main');
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, / PASS — every critical path is reviewed content \(1 review rows\)\n$/);
});

test('--landing: with no host variable a pull of the remote mainline\'s tip, trusted, passes with no review row', () => {
  const { git, gateWith, tree } = featRepo();
  git('update-ref', 'refs/remotes/origin/main', 'feat');
  const res = gateWith({ HARNESS_HOST: undefined }, '--landing', 'origin/main', '--base', 'main', '--trust', 'origin/main');
  assert.strictEqual(res.stdout, `Landing: ${tree('feat').slice(0, 12)} PASS — every critical path is reviewed content (0 review rows)\n`);
  assert.strictEqual(res.status, 0, res.stderr);
});

/**
 * A result tree that carries an unread critical edit, replaced in git by the base tree: the gate reads
 * the real objects, so it is NONE, not "no critical path changed". Throws on a verdict that differs.
 */
function landingReplaceCase(mutations = []) {
  const { git, gate, tree } = featRepo(mutations);
  git('replace', tree('feat'), tree('main'));
  const res = gate('--landing', 'feat', '--base', 'main');
  assert.strictEqual(res.stdout, `Landing: ${tree('feat').slice(0, 12)} NONE — no recorded cross-family review of ${ENGINE}: the owner merges\n`, 'the replaced result tree');
  assert.strictEqual(res.status, 1, res.stderr);
}

test('--landing: a replacement of the result tree by the base tree does not hide the unread edit', () => {
  landingReplaceCase();
});

const GUARD_LINE = (result, paths) => `Landing: ${result.slice(0, 12)} NONE — a guard, a gate or a reviewed block changed (${paths}): the owner merges\n`;
const POLICY = (rule) => `# Policy\n\nOur own text.\n\n<!-- harness:begin policy -->\n${rule}\n<!-- harness:end policy -->\n`;

/**
 * AGENTS.md and CLAUDE.md as symlinks: read through one link to a regular file inside the tree, the
 * blocks compared there; a type change or a link that leaves the tree is the owner's. Throws on the
 * first verdict that differs.
 */
function landingLinkCases(mutations = []) {
  const link = (r, rel, target) => {
    fs.rmSync(path.join(r.repo, rel), { force: true });
    fs.symlinkSync(target, path.join(r.repo, rel));
  };
  const land = (r, branch) => {
    const res = r.gate('--landing', branch, '--base', 'main');
    return { ...res, tree: r.git('rev-parse', `${branch}^{tree}`) };
  };

  // 3. a regular AGENTS.md replaced by a link whose text is the old bytes: the blob id is the same
  let r = cliRepo(mutations);
  r.write('docs/policy.md', POLICY('Stakes: production: none'));
  r.write('AGENTS.md', 'docs/policy.md');
  r.commit('regular');
  r.git('checkout', '-q', '-b', 'typed');
  link(r, 'AGENTS.md', 'docs/policy.md');
  r.commit('a link now');
  assert.strictEqual(r.git('rev-parse', 'typed:AGENTS.md'), r.git('rev-parse', 'main:AGENTS.md'), 'the fixture keeps the blob id');
  let res = land(r, 'typed');
  assert.strictEqual(res.stdout, GUARD_LINE(res.tree, 'AGENTS.md'), 'a type change');
  assert.strictEqual(res.status, 1);

  // 4. AGENTS.md -> docs/harness-policy.md, the link unchanged: the target's block is the guard
  r = cliRepo(mutations);
  r.write('docs/harness-policy.md', POLICY('Rule one.'));
  link(r, 'AGENTS.md', 'docs/harness-policy.md');
  r.commit('linked');
  r.git('checkout', '-q', '-b', 'block');
  r.write('docs/harness-policy.md', POLICY('Rule two.'));
  r.commit('block edit');
  res = land(r, 'block');
  assert.strictEqual(res.stdout, GUARD_LINE(res.tree, 'AGENTS.md'), 'the target\'s block changed');
  assert.strictEqual(res.status, 1);
  r.git('checkout', '-q', '-b', 'prose', 'main');
  r.write('docs/harness-policy.md', POLICY('Rule one.').replace('Our own text.', 'Our text, edited.'));
  r.commit('prose edit');
  res = land(r, 'prose');
  assert.strictEqual(res.stdout, `Landing: ${res.tree.slice(0, 12)} PASS — no critical path changed\n`, 'the target changed outside its blocks');
  assert.strictEqual(res.status, 0);

  // 5. CLAUDE.md -> AGENTS.md, AGENTS.md edited outside its blocks (AGENTS.md is critical here, so a
  // codex-run review of the edit lands it)
  r = cliRepo(mutations);
  r.write('AGENTS.md', POLICY('Rule one.'));
  link(r, 'CLAUDE.md', 'AGENTS.md');
  r.commit('claude links agents');
  r.git('checkout', '-q', '-b', 'own');
  r.write('AGENTS.md', POLICY('Rule one.').replace('Our own text.', 'Our text, edited.'));
  r.commit('own text');
  fs.mkdirSync(path.join(r.repo, '.codex-runs'));
  fs.writeFileSync(path.join(r.repo, '.codex-runs', 'ledger.jsonl'), ledgerLine(reviewRow(r.git('rev-parse', 'main^{tree}'), r.git('rev-parse', 'own^{tree}'))));
  res = land(r, 'own');
  assert.strictEqual(res.stdout, `Landing: ${res.tree.slice(0, 12)} PASS — every critical path is reviewed content (1 review rows)\n`, 'a link to AGENTS.md, edited outside its blocks');
  assert.strictEqual(res.status, 0);

  // 6. a link that leaves the tree
  r = cliRepo(mutations);
  r.write('docs/a.md', 'a\n');
  link(r, 'CLAUDE.md', 'docs/a.md');
  r.commit('inside');
  r.git('checkout', '-q', '-b', 'out');
  link(r, 'CLAUDE.md', '../x.md');
  r.commit('outside');
  res = land(r, 'out');
  assert.strictEqual(res.stdout, GUARD_LINE(res.tree, 'CLAUDE.md'), 'a link out of the tree');
  assert.strictEqual(res.status, 1);
}

test('--landing: AGENTS.md or CLAUDE.md as a symlink is read through its link; a type change or a link out of the tree is NONE', () => {
  landingLinkCases();
});

test('--landing: an option as its value, a decision option beside it, or a revision that is no tree is exit 2; --help alone is the usage', () => {
  const { gate } = cliRepo();
  for (const args of [
    ['--landing', '--help', '--base', 'main'],
    ['--landing', '-h', '--base', 'main'],
    ['--landing', '-x', '--base', 'main'],
    ['--landing', 'x', '--kind', 'unit', '--base', 'main'],
    ['--landing', 'x', '--writer', 'main', '--base', 'main'],
    ['--landing', 'x', '--tier', 'small', '--base', 'main'],
    ['--landing', 'x', '--host', 'codex', '--base', 'main'],
    ['--landing', 'main', '--base', 'main', '--trust', '--help'],
    ['--landing', 'x'],
  ]) {
    const res = gate(...args);
    assert.strictEqual(res.status, 2, args.join(' '));
    assert.strictEqual(res.stdout, '', args.join(' '));
    assert.match(res.stderr, /usage: review-gate\.mjs/, args.join(' '));
  }
  let res = gate('--landing', 'no-such-rev', '--base', 'main');
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /review-gate: git failed: no-such-rev does not name a tree/);
  for (const args of [['--help'], ['--landing', 'main', '--base', 'main', '-h']]) {
    res = gate(...args);
    assert.strictEqual(res.status, 0, args.join(' '));
    assert.match(res.stdout, /^usage: review-gate\.mjs/, args.join(' '));
  }
});

test('the decision CLI reads the stakes from AGENTS.md at --base; --stakes overrides; none unbound says so', () => {
  const { git, write, gate } = cliRepo();
  write('src/core/engine.js', 'a\nb\n');
  const run = (...extra) => {
    const res = gate('--base', 'main', '--kind', 'unit', '--writer', 'claude', '--json', ...extra);
    assert.strictEqual(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  };
  let r = run();
  assert.strictEqual(r.stakes, 'live');
  assert.ok(r.notChecked.includes('stakes unbound — routed as live'), r.notChecked.join(', '));
  assert.strictEqual(r.reviewers[0], 'opus-code-reviewer');
  // an AGENTS.md only in the working tree is not the base's
  write('AGENTS.md', '# Project\n\nStakes: production: none · data: synthetic\n');
  r = run();
  assert.ok(r.notChecked.includes('stakes unbound — routed as live'), r.notChecked.join(', '));
  git('add', 'AGENTS.md');
  git('commit', '-q', '-m', 'stakes');
  r = run();
  assert.deepStrictEqual([r.stakes, r.reviewers], ['none', ['second-family-review', 'second-family-adversarial']]);
  assert.ok(!r.notChecked.includes('stakes unbound — routed as live'));
  r = run('--stakes', 'live');
  assert.deepStrictEqual([r.stakes, r.reviewers[0]], ['live', 'opus-code-reviewer']);
  const bad = gate('--base', 'main', '--kind', 'unit', '--writer', 'claude', '--stakes', 'prod');
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /--stakes must be one of none\|live/);
});

test('the stakes come from the base: a branch that edits its Stakes line to none still routes as live', () => {
  const { git, write, commit, gate } = cliRepo();
  // the mainline's policy block says live; a fenced example of none before it never counts
  write('AGENTS.md', '# Project\n\n```\nStakes: production: none\n```\n\n<!-- harness:begin policy -->\nStakes: production: live\n<!-- harness:end policy -->\n');
  commit('policy');
  git('checkout', '-q', '-b', 'feat');
  write('AGENTS.md', '# Project\n\n<!-- harness:begin policy -->\nStakes: production: none\n<!-- harness:end policy -->\n');
  write('src/core/engine.js', 'a\nb\n');
  commit('lower the stakes');
  for (const extra of [[], ['--head', 'feat']]) {
    const res = gate('--base', 'main', '--kind', 'unit', '--writer', 'claude', '--json', ...extra);
    assert.strictEqual(res.status, 0, res.stderr);
    const r = JSON.parse(res.stdout);
    assert.deepStrictEqual([r.stakes, r.reviewers[0]], ['live', 'opus-code-reviewer'], extra.join(' '));
    assert.ok(!r.notChecked.includes('stakes unbound — routed as live'), extra.join(' '));
  }
});

/** Every relative module `file` imports (static, re-export, side-effect or a literal import()), transitively. */
function importClosure(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  const specs = [
    ...text.matchAll(/\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g),
    ...text.matchAll(/\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g),
    ...text.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]);
  for (const spec of specs) {
    const next = path.resolve(path.dirname(file), spec);
    assert.ok(fs.existsSync(next), `${path.relative(SCRIPTS, file)} imports ${spec}, which is not shipped`);
    importClosure(next, seen);
  }
  return seen;
}

test('every file review-gate.mjs imports, transitively, is a GUARDS path at its install path', () => {
  const installed = [...importClosure(path.join(SCRIPTS, WRAPPER_REL))].map((f) => `scripts/${path.relative(SCRIPTS, f).split(path.sep).join('/')}`);
  for (const p of ['scripts/review-gate.mjs', 'scripts/lib/review-gate-core.mjs', 'scripts/lib/run-sources.mjs', 'scripts/lib/unit-cost-core.mjs', 'scripts/lib/unit-step-core.mjs'])
    assert.ok(installed.includes(p), `the closure misses ${p}: ${installed.join(', ')}`);
  const url = pathToFileURL(path.join(SCRIPTS, CORE_REL)).href;
  const code = `import { isGuard } from ${JSON.stringify(url)};
console.log(JSON.stringify(${JSON.stringify(installed)}.filter((p) => !isGuard(p))));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: hermeticEnv() });
  assert.strictEqual(res.status, 0, res.stderr);
  const unguarded = JSON.parse(res.stdout);
  assert.deepStrictEqual(unguarded, [], `the landing check runs ${unguarded.join(', ')}, which no GUARDS pattern holds`);
});

test('mutant: the landing host read from HARNESS_HOST first again, so a Codex shell counts its own review', () => {
  assert.throws(() => landingHostCases([[WRAPPER_REL, 'host = detectHost(own).host;', 'host = detectHost(process.env).host;']]), /codex host with HARNESS_HOST=zcode/);
});

test('mutant: an unknown host keeping every row, so a stripped environment counts the host\'s own review', () => {
  mutantRun("if (host === 'unknown') return [];", '');
});

test('mutant: GIT_NO_REPLACE_OBJECTS dropped from the gate\'s git calls, so a replacement hides the edit', () => {
  const drop = (stdio) => [WRAPPER_REL, `${stdio}\n    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: os.devNull },`, `${stdio}\n    env: { ...process.env, GIT_GRAFT_FILE: os.devNull },`];
  assert.throws(() => landingReplaceCase([drop("stdio: ['ignore', 'pipe', 'pipe'],"), drop("stdio: ['pipe', 'pipe', 'pipe'],")]), /the replaced result tree/);
});

test('mutant: the instruction files\' links no longer read through, so a type change or a linked block merges', () => {
  assert.throws(() => landingLinkCases([[WRAPPER_REL, 'if (!isLink(b) && !isLink(t)) continue;', 'continue;']]), /a type change/);
});

test('shipped files carry no machine paths', () => {
  const machinePath = new RegExp('/(Users|home)/[A-Za-z]');
  for (const rel of [WRAPPER_REL, CORE_REL, TEST_REL]) {
    const text = fs.readFileSync(path.join(SCRIPTS, rel), 'utf8');
    assert.ok(!machinePath.test(text), `${rel} contains a machine path`);
  }
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
