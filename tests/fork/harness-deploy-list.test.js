/**
 * Tests for the harness-bootstrap deploy-list template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, proves it can fail by mutating the core, then runs the
 * CLI against a temp git repository holding land merges, a land commit with no merge and both run ledgers.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'deploy-list-core.test.mjs');
const CORE_REL = path.join('lib', 'deploy-list-core.mjs');
const CLI = path.join(SCRIPTS, 'deploy-list.mjs');

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 32;
const DOT = String.fromCodePoint(0xb7);
const NOT_A_MERGE = 'land is not a merge: its critical paths cover that commit only';

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

const cleanup = [];

function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

/** Env with a fresh HOME and no GIT_* variable. */
function hermeticEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.HOME = tmp('deploy-list-home-');
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  return { ...env, ...extra };
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(scriptsDir) {
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(scriptsDir, TEST_REL)], {
    encoding: 'utf8',
    env: hermeticEnv(),
    timeout: 120_000,
  });
}

/** Copy the shipped scripts, apply each [file, needle, replacement] (each needle exactly once), run the suite. */
function reboundRun(rebindings) {
  const copy = tmp('deploy-list-rebound-');
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

/** Copy the shipped scripts, apply a one-line mutation to the core, and assert the suite fails. */
function mutantFails(name, needle, replacement) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const { res, out } = reboundRun([[CORE_REL, needle, replacement]]);
    assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
    assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
  });
}

console.log('\nharness-bootstrap deploy-list template');

test('the shipped deploy-list suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

const AUDIT_CORE = ['export const AUDIT_KIND = /audit|post-merge/i;', 'export const AUDIT_KIND = /deep-read/i;'];
const AUDIT_TEST = ["const AUDIT_EXAMPLE = 'post-merge-audit';", "const AUDIT_EXAMPLE = 'deep-read';"];

test('the shipped suite passes with the audit kind rebound as an install binds it', () => {
  const { res, out } = reboundRun([[CORE_REL, ...AUDIT_CORE], [TEST_REL, ...AUDIT_TEST]]);
  assert.strictEqual(res.status, 0, out.slice(-1200));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
});

test('the AUDIT_KIND rebound alone fails the [B] AUDIT_KIND test', () => {
  const { res, out } = reboundRun([[CORE_REL, ...AUDIT_CORE]]);
  assert.notStrictEqual(res.status, 0, 'the suite still passed');
  assert.match(out, /^not ok \d+ - \[B\] the core's AUDIT_KIND takes AUDIT_EXAMPLE/m);
});

mutantFails('reading the last paragraph only for trailers', '.slice(1)\n    .flatMap((p) => trailerBlock(p) ?? [])', '.slice(-1)\n    .flatMap((p) => trailerBlock(p) ?? [])');
mutantFails('reading the subject paragraph as a trailer block', '.slice(1)\n    .flatMap((p) => trailerBlock(p) ?? [])', '.slice(0)\n    .flatMap((p) => trailerBlock(p) ?? [])');
mutantFails('reading only a merge message, not its branch commits', 'commit.parents.length > 1 ? [commit, ...branch] : [commit]', '[commit]');
const UNION = '    if (!land) lands.set(unit, { unit, categories, carrier });\n    else for (const c of categories) if (!land.categories.includes(c)) land.categories.push(c);';
mutantFails('letting an older commit of a unit give its categories', UNION, '    lands.set(unit, { unit, categories, carrier });');
mutantFails('listing each commit of a unit as a land', UNION, '    lands.set(carrier.sha, { unit, categories, carrier });');
mutantFails('giving a unit the categories of its newest commit only', '    else for (const c of categories) if (!land.categories.includes(c)) land.categories.push(c);', '');
mutantFails('listing a category of a unit once per commit that names it', '!land.categories.includes(c)', 'true');
mutantFails('taking the last Landing line of a unit instead of the first', 'landings.get(unit) ?? landingOf(carrier.message)', 'landingOf(carrier.message) ?? landings.get(unit)');
mutantFails('reading a trailer key with no space before its colon only', "const TRAILER = /^([A-Za-z][A-Za-z0-9-]*)[ \\t]*:[ \\t]*(.*?)\\s*$/;", "const TRAILER = /^([A-Za-z][A-Za-z0-9-]*):[ \\t]*(.*?)\\s*$/;");
mutantFails('reading an indented trailer paragraph as no trailers', 'if (lines.every((l) => /^[ \\t]+\\S/.test(l))) {', 'if (false) {');
mutantFails('looking for an unindented Never-auto line only', "const STRAY_LINE = /^[ \\t>*_`-]*never[-_ ]?auto[ \\t*_`]*:/i;", "const STRAY_LINE = /^never[-_ ]?auto[ \\t*_`]*:/i;");
mutantFails('looking for a hyphenated Never-auto line only', "const STRAY_LINE = /^[ \\t>*_`-]*never[-_ ]?auto[ \\t*_`]*:/i;", "const STRAY_LINE = /^[ \\t>*_`-]*never-?auto[ \\t*_`]*:/i;");
mutantFails('looking for a Never-auto line with no space before its colon only', "const STRAY_LINE = /^[ \\t>*_`-]*never[-_ ]?auto[ \\t*_`]*:/i;", "const STRAY_LINE = /^[ \\t>*_`-]*never[-_ ]?auto:/i;");
mutantFails('looking for a Never-auto line with no markdown prefix only', "const STRAY_LINE = /^[ \\t>*_`-]*never[-_ ]?auto[ \\t*_`]*:/i;", "const STRAY_LINE = /^[ \\t]*never[-_ ]?auto[ \\t]*:/i;");
mutantFails('looking for a Never-auto line with no bullet or quote before it', "const STRAY_LINE = /^[ \\t>*_`-]*never[-_ ]?auto[ \\t*_`]*:/i;", "const STRAY_LINE = /^[ \\t*_`]*never[-_ ]?auto[ \\t*_`]*:/i;");
mutantFails('looking for a Never-auto line with no markup before its colon', "const STRAY_LINE = /^[ \\t>*_`-]*never[-_ ]?auto[ \\t*_`]*:/i;", "const STRAY_LINE = /^[ \\t>*_`-]*never[-_ ]?auto[ \\t]*:/i;");
mutantFails('saying nothing of a Never-auto value that names no category', '.map((c) => `WARN ${short(c.sha)} has a ${KEY_TEXT}: value that names no category`),', '.map(() => null).filter(Boolean),');
mutantFails('not counting a log record that did not parse', 'unparsed += 1;', 'unparsed += 0;');
mutantFails('saying nothing of a land that is no merge', '.filter((c) => c.parents.length <= 1 && landsOf(c).length > 0)', '.filter(() => false)');
mutantFails('warning of a merge as a land that is no merge', '.filter((c) => c.parents.length <= 1 && landsOf(c).length > 0)', '.filter((c) => landsOf(c).length > 0)');
mutantFails('reading an audit of the land itself as no audit of it', 'const later = commits.slice(i);', 'const later = commits.slice(i + 1);');
mutantFails('printing the empty tree shortened', 'isRoot(live) ? root : short(live)', 'short(isRoot(live) ? root : live)');
mutantFails('saying nothing of a Never-auto line outside a trailer block', '.filter((c) => strayNeverAuto(c.message))', '.filter(() => false)');
mutantFails('warning of a Never-auto line that is a trailer', 'return lines > parseTrailers(message).filter((t) => t.key.toLowerCase() === NEVER_AUTO_KEY).length;', 'return lines > 0;');
mutantFails('counting a row of any kind as a review', 'REVIEW_KINDS.includes(r.kind) &&', '');
mutantFails('counting a failed run as the audit', "r.outcome === 'ok' &&", '');
mutantFails('giving a plain commit no parent tree', 'else if (parentTree) trees.add(parentTree);', '');
mutantFails('giving a merge no unit branch trees', 'if (commit.parents.length > 1) for (const t of branchTrees) trees.add(t);', '');
mutantFails('listing the critical paths unsorted', '].sort();\n}\n\n/** One review row', '];\n}\n\n/** One review row');
mutantFails('listing a land without a category', 'if (categories.length === 0) continue;', '');
mutantFails('taking the first Landing line instead of the last', '.at(-1)[1] : null', '[0][1] : null');

// ---- the CLI, in a temp repository

const git = (cwd, args, env) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: env ?? hermeticEnv(),
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

function run(cwd, args, cli = CLI) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: hermeticEnv(), encoding: 'utf8' });
}

const write = (repo, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};

const jsonl = (rows) => `${rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`;

/**
 * A repository with `live` (tagged), then on its first-parent line: a merge of u1 (a trailer on the merge message,
 * a Landing line, two categories, two files), a merge of u2 (no trailer; a `Never-auto:` line inside a prose
 * paragraph of its message), a plain commit u3 with a trailer, and a docs commit. Both ledgers hold rows for them,
 * and one for the tree of `live`, which belongs to no unit.
 */
function fixture() {
  const repo = tmp('deploy-list-repo-');
  const g = (...args) => git(repo, args);
  g('init', '-q', '-b', 'main');
  write(repo, 'a.txt', 'base\n');
  g('add', '.');
  g('commit', '-q', '-m', 'base');
  g('tag', 'live');
  const live = g('rev-parse', 'HEAD');
  const liveTree = g('rev-parse', 'HEAD^{tree}');

  g('checkout', '-q', '-b', 'u1');
  write(repo, 'src/pay.js', 'p\n');
  g('add', '.');
  g('commit', '-q', '-m', 'feat: pay');
  write(repo, 'db/001.sql', 'create table t();\n');
  g('add', '.');
  g('commit', '-q', '-m', 'feat: table');
  const u1Tree = g('rev-parse', 'HEAD^{tree}');
  g('checkout', '-q', 'main');
  g('merge', '-q', '--no-ff', '-m', "Merge branch 'u1'\n\nLanding: PASS 3f2a - 2 critical paths read\n\nUnit: U-1\nNever-auto: Money, migration", 'u1');
  const m1 = g('rev-parse', 'HEAD');

  g('checkout', '-q', '-b', 'u2', 'live');
  write(repo, 'docs/x.md', 'x\n');
  g('add', '.');
  g('commit', '-q', '-m', 'docs: x');
  const u2Tree = g('rev-parse', 'HEAD^{tree}');
  g('checkout', '-q', 'main');
  g('merge', '-q', '--no-ff', '-m', "Merge branch 'u2'\n\nA note, not a trailer\nNever-auto: money\n\nUnit: U-2", 'u2');
  const m2 = g('rev-parse', 'HEAD');

  const u3Parent = g('rev-parse', 'HEAD^{tree}');
  write(repo, 'package.json', '{}\n');
  g('add', '.');
  g('commit', '-q', '-m', 'chore: bump a dependency\n\nUnit: U-3\nNever-auto: dependency');
  const c3 = g('rev-parse', 'HEAD');

  write(repo, 'notes.md', 'n\n');
  g('add', '.');
  g('commit', '-q', '-m', 'docs: notes');
  const head = g('rev-parse', 'HEAD');
  const headTree = g('rev-parse', 'HEAD^{tree}');

  write(repo, '.codex-runs/verdicts/r1-review.md', '# Review\n\nP0: none\nP1: src/pay.js:3 rounds half up\n');
  write(repo, '.codex-runs/ledger.jsonl', jsonl([
    { at: '2026-11-01T10:00:00.000Z', kind: 'review', model: 'gpt-x', outcome: 'ok', tree: u1Tree, baseTree: u3Parent, verdictCopy: 'verdicts/r1-review.md' },
    { at: '2026-11-01T11:00:00.000Z', kind: 'review', model: 'gpt-x', outcome: 'ok', tree: u2Tree, baseTree: u3Parent },
    { at: '2026-11-01T09:00:00.000Z', kind: 'review', model: 'gpt-x', outcome: 'ok', tree: liveTree },
    { at: '2026-11-02T10:00:00.000Z', kind: 'review', model: 'gpt-x', outcome: 'failed', tree: u3Parent },
    'a torn line',
    { at: '2026-11-03T10:00:00.000Z', kind: 'post-merge-audit', model: 'gpt-x', outcome: 'ok', tree: headTree },
    { at: '2026-11-03T11:00:00.000Z', kind: 'investigate', model: 'gpt-x', outcome: 'ok', tree: u1Tree },
  ]));
  write(repo, '.claude-runs/ledger.jsonl', jsonl([
    { at: '2026-11-01T12:00:00.000Z', kind: 'adversarial', model: 'opus', outcome: 'ok', tree: u1Tree },
  ]));
  return { repo, g, live, m1, m2, c3, head };
}

const s12 = (sha) => sha.slice(0, 12);

function expected(f, from) {
  return [
    `NEVER-AUTO ${s12(f.m1)} U-1 ${DOT} money, migration`,
    '  landing: PASS 3f2a - 2 critical paths read',
    `  review review gpt-x/codex P0=0 P1=1 ${DOT} ok`,
    `  review adversarial opus/claude P0=? P1=? ${DOT} ok`,
    `  audit: post-merge-audit ${s12(f.head)}`,
    `NEVER-AUTO ${s12(f.c3)} U-3 ${DOT} dependency`,
    '  landing: not recorded',
    `  review review gpt-x/codex P0=? P1=? ${DOT} failed`,
    `  audit: post-merge-audit ${s12(f.head)}`,
    `WARN ${s12(f.m2)} has a Never-auto: line outside a trailer block`,
    `WARN ${s12(f.c3)} ${NOT_A_MERGE}`,
    `DEPLOY LIST 2 never-auto lands in ${from}..${s12(f.head)}`,
    '',
  ];
}

/** The first fixture's list since `live`, whole, with the CLI at `cli`: a mutated copy of the CLI fails it. */
function mainScenario(cli) {
  const f = fixture();
  const res = run(f.repo, [f.live], cli);
  assert.strictEqual(res.status, 0, res.stderr);
  const lines = res.stdout.split('\n');
  const critical = lines.splice(-2, 1)[0];
  assert.deepStrictEqual(lines, expected(f, s12(f.live)));
  assert.strictEqual(
    critical,
    `CRITICAL PATHS 3 files: run one adversarial pass over git diff ${s12(f.live)}..${s12(f.head)} -- db/001.sql package.json src/pay.js`,
  );
  assert.strictEqual(res.stderr, '');
}

test('CLI: the never-auto lands since live, each with its landing line, its reviews and its audit; the others are left out', () => {
  mainScenario(CLI);
});

/** Run the `git diff` a CRITICAL PATHS line prints, in the repository: a diff git refuses is a command the owner cannot run. */
function runPrinted(repo, stdout) {
  const line = stdout.split('\n').find((l) => l.startsWith('CRITICAL PATHS '));
  assert.ok(line, stdout);
  const command = line.slice(line.indexOf('git diff '));
  const r = spawnSync('sh', ['-c', `${command} --stat`], { cwd: repo, env: hermeticEnv(), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `${command}: ${r.stderr}`);
  return r.stdout;
}

test('CLI: the printed CRITICAL PATHS command runs, from a live commit and from the root (the empty tree whole)', () => {
  const f = fixture();
  const sinceLive = runPrinted(f.repo, run(f.repo, [f.live]).stdout);
  assert.match(sinceLive, /src\/pay\.js/);
  const empty = git(f.repo, ['hash-object', '-t', 'tree', '--stdin']);
  const fromRoot = run(f.repo, ['-']).stdout;
  assert.ok(fromRoot.includes(`git diff ${empty}..`), fromRoot);
  assert.match(runPrinted(f.repo, fromRoot), /package\.json/);
});

test('CLI: a tag or a branch names live, and <sha> ends the range: the audit of a later commit is not in it', () => {
  const f = fixture();
  const byTag = run(f.repo, ['live', f.m1]);
  assert.strictEqual(byTag.status, 0, byTag.stderr);
  assert.strictEqual(
    byTag.stdout,
    [
      `NEVER-AUTO ${s12(f.m1)} U-1 ${DOT} money, migration`,
      '  landing: PASS 3f2a - 2 critical paths read',
      `  review review gpt-x/codex P0=0 P1=1 ${DOT} ok`,
      `  review adversarial opus/claude P0=? P1=? ${DOT} ok`,
      '  audit: none recorded',
      `DEPLOY LIST 1 never-auto lands in ${s12(f.live)}..${s12(f.m1)}`,
      `CRITICAL PATHS 2 files: run one adversarial pass over git diff ${s12(f.live)}..${s12(f.m1)} -- db/001.sql src/pay.js`,
      '',
    ].join('\n'),
  );
});

test('CLI: an empty <live> or `-` is no production yet: everything since the root, diffed from the empty tree', () => {
  const f = fixture();
  const empty = git(f.repo, ['hash-object', '-t', 'tree', '--stdin']);
  for (const live of ['-', '']) {
    const res = run(f.repo, [live]);
    assert.strictEqual(res.status, 0, res.stderr);
    const lines = res.stdout.split('\n');
    const critical = lines.splice(-2, 1)[0];
    assert.deepStrictEqual(lines, expected(f, 'root'));
    assert.strictEqual(
      critical,
      `CRITICAL PATHS 3 files: run one adversarial pass over git diff ${empty}..${s12(f.head)} -- db/001.sql package.json src/pay.js`,
    );
  }
});

test('CLI: nothing never-auto in the range is an empty list, exit 0, and no critical paths line', () => {
  const f = fixture();
  const res = run(f.repo, [f.head]);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, `DEPLOY LIST 0 never-auto lands in ${s12(f.head)}..${s12(f.head)}\n`);
});

test('CLI: a Never-auto line inside a prose paragraph lists nothing and is a WARN line before the count', () => {
  const f = fixture();
  const res = run(f.repo, [f.live]);
  assert.doesNotMatch(res.stdout, /U-2/);
  assert.match(res.stdout, new RegExp(`^WARN ${s12(f.m2)} has a Never-auto: line outside a trailer block\\nWARN ${s12(f.c3)} ${NOT_A_MERGE}\\nDEPLOY LIST 2 `, 'm'));
});

test('CLI: a message with a Never-auto trailer and no Landing line says "landing: not recorded"; a commit that is not a merge reads its parent\'s tree', () => {
  const f = fixture();
  const out = run(f.repo, [f.live]).stdout;
  assert.match(out, new RegExp(`NEVER-AUTO ${s12(f.c3)} U-3 ${DOT} dependency\\n  landing: not recorded\\n  review review gpt-x/codex P0=\\? P1=\\? ${DOT} failed\\n`));
});

test('CLI: run from a linked worktree it reads the ledgers of the main checkout', () => {
  const f = fixture();
  const wt = path.join(tmp('deploy-list-wt-'), 'wt');
  f.g('worktree', 'add', '-q', '--detach', wt, f.head);
  const res = run(wt, [f.live]);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, new RegExp(`review review gpt-x/codex P0=0 P1=1 ${DOT} ok`));
});

test('CLI: it is read-only: the repository and the ledgers are byte-identical after a run', () => {
  const f = fixture();
  const snapshot = () => ({
    log: f.g('log', '--all', '--format=%H'),
    status: f.g('status', '--porcelain', '--ignored'),
    codex: fs.readFileSync(path.join(f.repo, '.codex-runs', 'ledger.jsonl'), 'utf8'),
    claude: fs.readFileSync(path.join(f.repo, '.claude-runs', 'ledger.jsonl'), 'utf8'),
  });
  const before = snapshot();
  assert.strictEqual(run(f.repo, [f.live]).status, 0);
  assert.deepStrictEqual(snapshot(), before);
});

test('CLI: an unknown ref, an unknown option, a missing <live> and a third argument exit 2 with a usage line and no list', () => {
  const f = fixture();
  for (const args of [['no-such-ref'], [f.live, 'no-such-ref'], ['--all'], [f.live, '--nope'], [], [f.live, f.head, 'extra'], ['a.txt']]) {
    const res = run(f.repo, args);
    assert.strictEqual(res.status, 2, `${args.join(' ')}: ${res.stdout}${res.stderr}`);
    assert.strictEqual(res.stdout, '', args.join(' '));
    assert.match(res.stderr, /^deploy-list: .+\nusage: node scripts\/deploy-list\.mjs <live-sha\|-> \[<sha>\]\n$/, args.join(' '));
  }
});

test('CLI: outside a git repository it exits 2', () => {
  const res = run(tmp('deploy-list-bare-'), ['-']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /not inside a git repository/);
});

test('CLI: --help and -h print the usage and exit 0', () => {
  for (const flag of ['--help', '-h']) {
    const res = run(tmp('deploy-list-help-'), [flag]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, 'usage: node scripts/deploy-list.mjs <live-sha|-> [<sha>]\n');
  }
});

/**
 * The runner's flow (reference/runner.md, Step 9): the land commit with `Unit:` and `Never-auto:` is on the unit
 * branch, and the merge message has no trailer. u1: two commits of one unit name categories (the newer, with a
 * Co-Authored-By block after the trailers, wins), merged with git's own message; u2: merged with a message file
 * `Merge <branch>: <title>`; u3: `Never-auto: none`; u4: a prose line that says `Never-auto:` on a branch
 * commit; then a direct commit with trailers and a Co-Authored-By block.
 */
function runnerFlow() {
  const repo = tmp('deploy-list-runner-');
  const g = (...args) => git(repo, args);
  g('init', '-q', '-b', 'main');
  write(repo, 'a.txt', 'base\n');
  g('add', '.');
  g('commit', '-q', '-m', 'base');
  g('tag', 'live');
  const live = g('rev-parse', 'HEAD');
  const liveTree = g('rev-parse', 'HEAD^{tree}');
  const unit = (branch, files, messages) => {
    g('checkout', '-q', '-b', branch, 'main');
    const trees = [];
    messages.forEach((m, i) => {
      for (const [rel, text] of files[i] ?? []) write(repo, rel, text);
      g('add', '.');
      g('commit', '-q', '-m', m);
      trees.push(g('rev-parse', 'HEAD^{tree}'));
    });
    g('checkout', '-q', 'main');
    return trees;
  };
  const [oldTree, u1Tree] = unit('u1', [[['src/pay.js', 'p\n']], [['db/001.sql', 'create table t();\n']]], [
    'feat: pay\n\nUnit: U-1\nNever-auto: money',
    'land: U-1\n\nLanding: PASS 7c1 - 2 critical paths read\n\nUnit: U-1\nNever-auto: Money, migration\n\nCo-Authored-By: A <a@b.c>\nClaude-Session: https://example.com/s/1',
  ]);
  g('merge', '-q', '--no-ff', '--no-edit', 'u1');
  const m1 = g('rev-parse', 'HEAD');
  const msgFile = path.join(tmp('deploy-list-msg-'), 'msg');
  fs.writeFileSync(msgFile, 'Merge u2: Add the refund export\n');
  unit('u2', [[['src/refund.js', 'r\n']]], ['land: U-2\n\nUnit: U-2\nNever-auto: data-format']);
  g('merge', '-q', '--no-ff', '-F', msgFile, 'u2');
  const m2 = g('rev-parse', 'HEAD');
  unit('u3', [[['src/u3.js', '3\n']]], ['land: U-3\n\nUnit: U-3\nNever-auto: none']);
  g('merge', '-q', '--no-ff', '--no-edit', 'u3');
  unit('u4', [[['src/u4.js', '4\n']]], ['land: U-4\n\nSee the notes\nNever-auto: money\n\nUnit: U-4']);
  const u4Commit = g('rev-parse', 'u4');
  g('merge', '-q', '--no-ff', '--no-edit', 'u4');
  write(repo, 'package.json', '{}\n');
  g('add', '.');
  g('commit', '-q', '-m', 'chore: bump a dependency\n\nUnit: U-5\nNever-auto: dependency\n\nCo-Authored-By: A <a@b.c>');
  const c5 = g('rev-parse', 'HEAD');
  const head = c5;
  write(repo, '.codex-runs/ledger.jsonl', jsonl([
    { at: '2026-11-01T10:00:00.000Z', kind: 'review', model: 'gpt-x', outcome: 'ok', tree: u1Tree, p0: 0, p1: 0 },
    { at: '2026-11-01T11:00:00.000Z', kind: 'review', model: 'gpt-x', outcome: 'ok', tree: liveTree },
  ]));
  write(repo, '.claude-runs/ledger.jsonl', jsonl([{ at: '2026-11-01T12:00:00.000Z', kind: 'adversarial', model: 'opus', outcome: 'ok', tree: oldTree }]));
  return { repo, g, live, m1, m2, c5, head, u4Commit };
}

/** The runner flow's list since live, whole: a mutated copy of the CLI fails it. */
function runnerScenario(cli) {
  const f = runnerFlow();
  const res = run(f.repo, [f.live], cli);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(
    res.stdout,
    [
      `NEVER-AUTO ${s12(f.m1)} U-1 ${DOT} money, migration`,
      '  landing: PASS 7c1 - 2 critical paths read',
      `  review review gpt-x/codex P0=0 P1=0 ${DOT} ok`,
      `  review adversarial opus/claude P0=? P1=? ${DOT} ok`,
      '  audit: none recorded',
      `NEVER-AUTO ${s12(f.m2)} U-2 ${DOT} data-format`,
      '  landing: not recorded',
      '  review: none recorded',
      '  audit: none recorded',
      `NEVER-AUTO ${s12(f.c5)} U-5 ${DOT} dependency`,
      '  landing: not recorded',
      '  review: none recorded',
      '  audit: none recorded',
      `WARN ${s12(f.u4Commit)} has a Never-auto: line outside a trailer block`,
      `WARN ${s12(f.c5)} ${NOT_A_MERGE}`,
      `DEPLOY LIST 3 never-auto lands in ${s12(f.live)}..${s12(f.head)}`,
      `CRITICAL PATHS 4 files: run one adversarial pass over git diff ${s12(f.live)}..${s12(f.head)} -- db/001.sql package.json src/pay.js src/refund.js`,
      '',
    ].join('\n'),
  );
  assert.strictEqual(res.stderr, '');
  return f;
}

test("CLI: the runner's flow, trailers on the unit branch's land commit and a merge message with none, lists every unit once", () => {
  const f = runnerScenario(CLI);
  runPrinted(f.repo, run(f.repo, [f.live]).stdout);
  const some = run(f.repo, [f.live, f.m1]);
  assert.match(some.stdout, new RegExp(`^NEVER-AUTO ${s12(f.m1)} U-1 `, 'm'));
  assert.match(some.stdout, /^DEPLOY LIST 1 /m);
});

test('CLI: a live commit that is not an ancestor of <sha> is `WARN <live12> is not an ancestor of <sha12>` on stderr, exit 2, no list', () => {
  const f = fixture();
  f.g('checkout', '-q', '-b', 'side', 'live');
  write(f.repo, 'side.txt', 's\n');
  f.g('add', '.');
  f.g('commit', '-q', '-m', 'side');
  const side = f.g('rev-parse', 'HEAD');
  f.g('checkout', '-q', 'main');
  for (const [live, sha] of [[side, f.head], [f.head, f.live]]) {
    const res = run(f.repo, [live, sha]);
    assert.strictEqual(res.status, 2, res.stdout + res.stderr);
    assert.strictEqual(res.stdout, '');
    assert.strictEqual(res.stderr, `WARN ${s12(live)} is not an ancestor of ${s12(sha)}\n`);
  }
  assert.strictEqual(run(f.repo, [f.head, f.head]).status, 0, 'a commit is its own ancestor');
});

/** A copy of the shipped scripts with one line of the CLI changed: the scenario must fail against it. */
function cliMutantFails(name, needle, replacement, scenario) {
  test(`mutant: ${name} makes the CLI scenario fail`, () => {
    const copy = tmp('deploy-list-cli-mutant-');
    fs.cpSync(SCRIPTS, copy, { recursive: true });
    const file = path.join(copy, 'deploy-list.mjs');
    const before = fs.readFileSync(file, 'utf8');
    assert.strictEqual(before.split(needle).length - 1, 1, `${needle} is not in deploy-list.mjs exactly once`);
    fs.writeFileSync(file, before.replace(needle, () => replacement));
    assert.throws(() => scenario(file), `${name}: the scenario still passed`);
  });
}

cliMutantFails('reading the unit branch from the base too (no ^first)', '...others, `^${first}`, ...', '...others, ...', runnerScenario);
cliMutantFails('reading no commit of a merge but its message', "others.length ? read([LOG_FORMAT, ...others, `^${first}`, ...(live === null ? [] : [`^${live}`])]) : []", '[]', runnerScenario);
cliMutantFails('leaving the ancestor check out', 'if (live !== null && !isAncestor(top, live, sha)) {', 'if (false) {', (cli) => {
  const f = fixture();
  assert.strictEqual(run(f.repo, [f.head, f.live], cli).status, 2);
});

/** The list (stdout) of a run that must succeed with an empty stderr, as lines. */
function listOf(res) {
  assert.strictEqual(res.status, 0, res.stderr);
  return res.stdout.split('\n');
}

/** A repository with a root commit tagged `live`, and a `land(branch, files, message)` that commits on a branch off main. */
function bare(prefix) {
  const repo = tmp(prefix);
  const g = (...args) => git(repo, args);
  g('init', '-q', '-b', 'main');
  write(repo, 'a.txt', 'base\n');
  g('add', '.');
  g('commit', '-q', '-m', 'base');
  g('tag', 'live');
  return { repo, g };
}

/** A land already in live, reached through a branch that merged live in: it is not part of what is left to deploy. */
function liveInBranchScenario(cli) {
  const { repo, g } = bare('deploy-list-livein-');
  const root = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'u0');
  write(repo, 'u0.js', '0\n');
  g('add', '.');
  g('commit', '-q', '-m', 'land U-0\n\nLanding: PASS U-0\n\nUnit: U-0\nNever-auto: money');
  g('checkout', '-q', 'main');
  g('merge', '-q', '--no-ff', '-m', 'Merge u0', 'u0');
  const live = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'u1', root);
  write(repo, 'u1.js', '1\n');
  g('add', '.');
  g('commit', '-q', '-m', 'u1 work');
  g('merge', '-q', '-m', 'sync', live);
  write(repo, 'u1b.js', '1\n');
  g('add', '.');
  g('commit', '-q', '-m', 'land U-1\n\nLanding: PASS U-1\n\nUnit: U-1\nNever-auto: none');
  g('checkout', '-q', '-B', 'main', root);
  g('merge', '-q', '--no-ff', '-m', 'Merge u1', 'u1');
  const head = g('rev-parse', 'HEAD');
  const res = run(repo, [live], cli);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, `DEPLOY LIST 0 never-auto lands in ${s12(live)}..${s12(head)}\n`);
  assert.strictEqual(res.stderr, '');
  assert.match(run(repo, ['-'], cli).stdout, /^NEVER-AUTO \w+ U-0 /m, 'with nothing live, the land of u0 is on the list');
}

test('CLI: a land that live already holds, read again through a branch that merged live in, is not listed (git log ^live)', () => {
  liveInBranchScenario(CLI);
});

cliMutantFails('not leaving what live holds out of a merge\'s branch', ', ...(live === null ? [] : [`^${live}`])', '', liveInBranchScenario);

/** Fast-forward and squash lands (no merge commit), a trailer key with a space before its colon, and git's own squash message. */
function plainLandsScenario(cli) {
  const { repo, g } = bare('deploy-list-plain-');
  g('checkout', '-q', '-b', 'sq');
  write(repo, 'sq.js', '1\n');
  g('add', '.');
  g('commit', '-q', '-m', 'feat: part one');
  write(repo, 'sq2.js', '2\n');
  g('add', '.');
  g('commit', '-q', '-m', 'land U-9\n\nLanding: PASS U-9 - 2 critical paths read\n\nUnit: U-9\nNever-auto: money, migrations');
  g('checkout', '-q', 'main');
  g('merge', '-q', '--squash', 'sq');
  const squash = fs.readFileSync(path.join(repo, '.git', 'SQUASH_MSG'), 'utf8');
  assert.match(squash, /^ {4}Never-auto: money, migrations$/m, 'git indents the quoted trailers by 4 spaces');
  g('commit', '-q', '-F', path.join(repo, '.git', 'SQUASH_MSG'));
  const sq = g('rev-parse', 'HEAD');
  write(repo, 'dep.json', '{}\n');
  g('add', '.');
  g('commit', '-q', '-m', 'chore: bump\n\nUnit : U-8\nNever-auto : dependency');
  const spaced = g('rev-parse', 'HEAD');
  const res = run(repo, ['live'], cli);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(
    res.stdout,
    [
      `NEVER-AUTO ${s12(sq)} U-9 ${DOT} money, migrations`,
      '  landing: PASS U-9 - 2 critical paths read',
      '  review: none recorded',
      '  audit: none recorded',
      `NEVER-AUTO ${s12(spaced)} U-8 ${DOT} dependency`,
      '  landing: not recorded',
      '  review: none recorded',
      '  audit: none recorded',
      `WARN ${s12(sq)} ${NOT_A_MERGE}`,
      `WARN ${s12(spaced)} ${NOT_A_MERGE}`,
      `DEPLOY LIST 2 never-auto lands in ${s12(g('rev-parse', 'live'))}..${s12(spaced)}`,
      `CRITICAL PATHS 3 files: run one adversarial pass over git diff ${s12(g('rev-parse', 'live'))}..${s12(spaced)} -- dep.json sq.js sq2.js`,
      '',
    ].join('\n'),
  );
  assert.strictEqual(res.stderr, '');
}

test('CLI: a squash land (git\'s own indented message) and a `Never-auto : x` trailer are lands, and a land that is no merge says so', () => {
  plainLandsScenario(CLI);
});

cliMutantFails('printing no warning for a land that is no merge', '[...warningsOf(commits, extra), ', '[', plainLandsScenario);

/** A log record git cannot be read as one (the message holds the record separator): counted, and said before the count line. */
function unparsedScenario(cli) {
  const { repo, g } = bare('deploy-list-unparsed-');
  const msgFile = path.join(tmp('deploy-list-msg-'), 'msg');
  fs.writeFileSync(msgFile, 'feat: pay\n\nUnit: U-4\nNever-auto: money\n\nnote\x1e tail of the message\n');
  write(repo, 'p.js', 'p\n');
  g('add', '.');
  g('commit', '-q', '-F', msgFile);
  const c = g('rev-parse', 'HEAD');
  const res = run(repo, ['live'], cli);
  assert.strictEqual(res.status, 0, res.stderr);
  const lines = res.stdout.split('\n');
  assert.deepStrictEqual(lines.slice(4), [
    `WARN ${s12(c)} ${NOT_A_MERGE}`,
    'WARN 1 log records did not parse',
    `DEPLOY LIST 1 never-auto lands in ${s12(g('rev-parse', 'live'))}..${s12(c)}`,
    `CRITICAL PATHS 1 files: run one adversarial pass over git diff ${s12(g('rev-parse', 'live'))}..${s12(c)} -- p.js`,
    '',
  ]);
  assert.strictEqual(lines[0], `NEVER-AUTO ${s12(c)} U-4 ${DOT} money`);
}

test('CLI: a log record that does not parse is `WARN <n> log records did not parse` before the count line, the rest still listed', () => {
  unparsedScenario(CLI);
});

cliMutantFails('printing no warning for a log record that did not parse', ', unparsedWarning(unparsed)]', ']', unparsedScenario);

const hasSshKeygen = spawnSync('ssh-keygen', ['-?'], { encoding: 'utf8' }).error === undefined;

/**
 * Signed commits in a repository whose config has log.showSignature=true (git then prints the signature lines ahead of
 * each log record): the list must read them. The repository's own config carries the setting: the CLI's git runs with no
 * GIT_* variable, so GIT_CONFIG_* could not reach it.
 */
function signedScenario(cli) {
  const { repo, g } = bare('deploy-list-signed-');
  const keyDir = tmp('deploy-list-key-');
  const key = path.join(keyDir, 'key');
  assert.strictEqual(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { encoding: 'utf8' }).status, 0);
  fs.writeFileSync(path.join(keyDir, 'allowed'), `t@t ${fs.readFileSync(`${key}.pub`, 'utf8')}`);
  for (const [k, v] of [['gpg.format', 'ssh'], ['user.signingkey', `${key}.pub`], ['gpg.ssh.allowedSignersFile', path.join(keyDir, 'allowed')], ['log.showSignature', 'true']]) g('config', k, v);
  g('checkout', '-q', '-b', 'us');
  write(repo, 's.js', 's\n');
  g('add', '.');
  g('commit', '-q', '-S', '-m', 'land U-S\n\nLanding: PASS U-S\n\nUnit: U-S\nNever-auto: money');
  g('checkout', '-q', 'main');
  g('merge', '-q', '--no-ff', '-S', '-m', 'Merge us', 'us');
  const m = g('rev-parse', 'HEAD');
  assert.doesNotMatch(g('log', '-1', '--format=%H'), /^[0-9a-f]{40}$/, 'the repository config makes git print signature lines ahead of each record');
  const res = run(repo, ['live'], cli);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(
    res.stdout,
    [
      `NEVER-AUTO ${s12(m)} U-S ${DOT} money`,
      '  landing: PASS U-S',
      '  review: none recorded',
      '  audit: none recorded',
      `DEPLOY LIST 1 never-auto lands in ${s12(g('rev-parse', 'live'))}..${s12(m)}`,
      `CRITICAL PATHS 1 files: run one adversarial pass over git diff ${s12(g('rev-parse', 'live'))}..${s12(m)} -- s.js`,
      '',
    ].join('\n'),
  );
  assert.strictEqual(res.stderr, '');
}

if (hasSshKeygen) {
  test('CLI: signed commits under log.showSignature=true are listed (every git log runs with --no-show-signature)', () => {
    signedScenario(CLI);
  });
  cliMutantFails('leaving --no-show-signature off the first-parent log', "['log', '--no-show-signature', ...args]", "['log', ...args]", signedScenario);
} else {
  console.log('  - skipped the signed-commit cases: ssh-keygen is not installed, so there is no commit to sign (the CLI flag is unpinned on this machine)');
}

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
