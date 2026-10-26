/**
 * Tests for skills/harness-bootstrap/templates/scripts/check-agent-docs.mjs (biji-dev/ecc-js):
 * runs the template's own node:test suite, then proves the rule-index, base and citations checks are load-bearing with mutants.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const SCRIPT = path.join(SCRIPTS, 'check-agent-docs.mjs');
const TEMPLATE_TEST = path.join(SCRIPTS, 'lib', 'check-agent-docs.test.mjs');

// Pinned: the number of tests in the template suite. Update it when tests are added or removed.
const EXPECTED_PASS = 69;

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

// Hermetic: no developer HOME, global or system git config reaches a fixture.
const GIT_ENV = {
  ...process.env,
  HOME: tmp('agent-docs-home-'),
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete GIT_ENV[key];

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

/**
 * A repo whose rules index and rule files disagree: db.md exists but AGENTS.md does not list it, and the
 * index lists ghost.md, which does not exist. api.md is indexed, so the index section is found.
 */
function indexMismatchFixture() {
  const dir = tmp('agent-docs-mismatch-');
  git(dir, 'init', '-q', '-b', 'main');
  const files = {
    'AGENTS.md': '# Agents\n\n- `api.md` — an indexed rule.\n- `ghost.md` — a rule that does not exist.\n',
    'CLAUDE.md': '@AGENTS.md\n',
    'src/x.js': 'module.exports = {};\n',
    '.claude/rules/db.md': '---\npaths:\n  - "src/x.js"\n---\nRule body.\n',
    '.claude/rules/api.md': '---\npaths:\n  - "src/x.js"\n---\nRule body.\n',
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  return dir;
}

function runScript(script, cwd, args = []) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: GIT_ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

console.log('\nharness agent-docs: template suite');

// One run of the template suite, with TMPDIR pointed at a scratch dir, serves both tests below (it is the slow part).
let suiteRun = null;
function templateSuite() {
  if (!suiteRun) {
    const scratch = tmp('agent-docs-scratch-');
    const env = { ...GIT_ENV, TMPDIR: scratch, TEMP: scratch, TMP: scratch };
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', TEMPLATE_TEST], { encoding: 'utf8', env });
    suiteRun = { r, left: fs.readdirSync(scratch) };
  }
  return suiteRun;
}

test('the template test suite passes with the pinned count', () => {
  const { r } = templateSuite();
  assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stdout.slice(-2000)}\n${r.stderr}`);
  assert.match(r.stdout, /^# fail 0$/m);
  assert.match(r.stdout, new RegExp(`^# pass ${EXPECTED_PASS}$`, 'm'));
});

test('the template test suite leaves no temp directories behind', () => {
  const { r, left } = templateSuite();
  assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stdout.slice(-2000)}\n${r.stderr}`);
  assert.deepStrictEqual(left, [], `left ${left.length} temp entries behind`);
});

test('the template test suite passes against a copy whose [B] CONFIG an install bound', () => {
  // A new repository binds more than the budgets: its own state-file path and path prefixes.
  const original = fs.readFileSync(SCRIPT, 'utf8');
  const bindings = [
    [/^ {2}budgets: \{[^}\n]*\},$/m, "  budgets: { 'AGENTS.md': 20480, 'CLAUDE.md': 10240, rule: 16384, skillLines: 500, stateFile: 8192, base: 30720 },"],
    [/^ {2}statePattern: .*$/m, "  statePattern: 'harness/units/**/*.state.md',"],
    [/^ {2}pathPrefixes: .*$/m, "  pathPrefixes: ['frontend/', 'tests/', 'harness/', '.claude/', '.agents/'],"],
  ];
  let bound = original;
  for (const [from, to] of bindings) {
    assert.match(bound, from, `binding line not found: ${from}`);
    bound = bound.replace(from, () => to);
  }
  const copy = path.join(tmp('agent-docs-bound-'), 'check-agent-docs.mjs');
  fs.writeFileSync(copy, bound);
  const scratch = tmp('agent-docs-bound-scratch-');
  const env = { ...GIT_ENV, TMPDIR: scratch, TEMP: scratch, TMP: scratch, CHECK_AGENT_DOCS_SCRIPT: copy };
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', TEMPLATE_TEST], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stdout.slice(-2000)}\n${r.stderr}`);
  assert.match(r.stdout, new RegExp(`^# pass ${EXPECTED_PASS}$`, 'm'));
});

console.log('\nharness agent-docs: mutation');

test('mutant without the rule-index check misses the index mismatch the shipped file catches', () => {
  const dir = indexMismatchFixture();

  const shipped = runScript(SCRIPT, dir);
  assert.strictEqual(shipped.status, 1, `shipped file should fail: ${shipped.out}${shipped.err}`);
  assert.match(shipped.err, /^FAIL rule-index: .*db\.md is missing/m);
  assert.match(shipped.err, /^FAIL rule-index: .*indexes ghost\.md/m);

  const original = fs.readFileSync(SCRIPT, 'utf8');
  const from = 'if (ruleDirExists && indexExists) {';
  const mutated = original.replace(from, 'if (false) {');
  assert.notStrictEqual(mutated, original, 'mutation did not apply');
  const copyDir = tmp('agent-docs-mutant-');
  const mutant = path.join(copyDir, 'check-agent-docs.mjs');
  fs.writeFileSync(mutant, mutated);

  const result = runScript(mutant, dir);
  assert.strictEqual(result.status, 0, `mutant should report OK: ${result.out}${result.err}`);
  assert.match(result.out, /^check-agent-docs: OK \(\d+ checks\)$/m);
});

/** A copy of the shipped script with one line replaced. */
function mutantOf(from, to) {
  const original = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(original.includes(from), `not in the shipped file: ${from}`);
  const mutant = path.join(tmp('agent-docs-mutant-'), 'check-agent-docs.mjs');
  fs.writeFileSync(mutant, original.replace(from, to));
  return mutant;
}

/** A clean repo whose CLAUDE.md imports a 60 KB notes file: every file is under its budget, the base is not. */
function heavyBaseFixture() {
  const dir = tmp('agent-docs-base-');
  git(dir, 'init', '-q', '-b', 'main');
  const files = {
    'AGENTS.md': '# Agents\n',
    'CLAUDE.md': '@AGENTS.md\n@docs/notes.md\nSee `@docs/code.md` too.\n',
    'docs/notes.md': `${'n'.repeat(60 * 1024)}\n`,
    'docs/code.md': 'never loaded\n',
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  return dir;
}

test('mutant without the base check passes a repo whose imports are over the base the shipped file catches', () => {
  const dir = heavyBaseFixture();
  const shipped = runScript(SCRIPT, dir);
  assert.strictEqual(shipped.status, 1, `shipped file should fail: ${shipped.out}${shipped.err}`);
  assert.match(shipped.err, /^FAIL base: every session loads \d+ bytes from this repository, budget 49152/m);
  assert.doesNotMatch(shipped.err, /^FAIL budget: /m);
  const result = runScript(mutantOf('if (baseTarget !== undefined) {', 'if (false) {'), dir);
  assert.strictEqual(result.status, 0, `mutant should report OK: ${result.out}${result.err}`);
});

test('mutant that reads @ inside code spans lists a file the shipped --base does not', () => {
  const dir = heavyBaseFixture();
  assert.doesNotMatch(runScript(SCRIPT, dir, ['--base']).out, /docs\/code\.md/);
  const mutant = mutantOf("line.replace(/`[^`]*`/g, ' ').matchAll", 'line.replace(/`/g, " ").matchAll');
  assert.match(runScript(mutant, dir, ['--base']).out, /docs\/code\.md \(imported by CLAUDE\.md\)/);
});

/** A repo whose AGENTS.md renamed "Owner stops" while a rule and a code comment still cite it; "Context" still holds. */
function renamedSectionFixture() {
  const dir = tmp('agent-docs-cite-');
  git(dir, 'init', '-q', '-b', 'main');
  const files = {
    'AGENTS.md': '# Agents\n\n- `x.md` — the x rule.\n\n## Owner gates\n\n## Context budget and reporting\n',
    'CLAUDE.md': '@AGENTS.md\n',
    'src/x.js': '// Stop (`AGENTS.md` › Owner stops).\nmodule.exports = {};\n',
    '.claude/rules/x.md': '---\npaths:\n  - "src/x.js"\n---\nPer `AGENTS.md` › Owner stops, and `AGENTS.md` › Context.\n',
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  return dir;
}

test('mutant without the citations check passes a repo citing a renamed section the shipped file catches', () => {
  const dir = renamedSectionFixture();
  const shipped = runScript(SCRIPT, dir);
  assert.strictEqual(shipped.status, 1, `shipped file should fail: ${shipped.out}${shipped.err}`);
  assert.match(shipped.err, /^FAIL citations: \.claude\/rules\/x\.md:5 cites `AGENTS\.md` › Owner stops,/m);
  assert.match(shipped.err, /^FAIL citations: src\/x\.js:1 cites `AGENTS\.md` › Owner stops,/m);
  assert.strictEqual(shipped.err.match(/^FAIL /gm).length, 2, shipped.err);
  const result = runScript(mutantOf("if (isFile('AGENTS.md')) checkCitations(", 'if (false) checkCitations('), dir);
  assert.strictEqual(result.status, 0, `mutant should report OK: ${result.out}${result.err}`);
});

/** A repo with the given files, staged; `after(dir)` runs once they are. */
function repoOf(prefix, files, after = null) {
  const dir = tmp(prefix);
  git(dir, 'init', '-q', '-b', 'main');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  if (after) after(dir);
  return dir;
}

test('mutant that reads the rules dir one level deep misses a nested rule without paths: the shipped file catches', () => {
  const dir = repoOf('agent-docs-nested-', {
    'AGENTS.md': '# Agents\n\n- `api.md` — an indexed rule.\n',
    'CLAUDE.md': '@AGENTS.md\n',
    'src/x.js': 'module.exports = {};\n',
    '.claude/rules/api.md': '---\npaths:\n  - "src/x.js"\n---\nRule body.\n',
    '.claude/rules/web/react.md': 'No frontmatter.\n',
  });
  const shipped = runScript(SCRIPT, dir);
  assert.strictEqual(shipped.status, 1, `shipped file should fail: ${shipped.out}${shipped.err}`);
  assert.match(shipped.err, /^FAIL rule-paths: \.claude\/rules\/web\/react\.md /m);
  assert.match(shipped.err, /^FAIL rule-index: .*web\/react\.md is missing/m);
  const result = runScript(mutantOf('if (entry.isDirectory()) out.push(...listRules(p));', 'if (false) out.push(...listRules(p));'), dir);
  assert.strictEqual(result.status, 0, `mutant should report OK: ${result.out}${result.err}`);
});

test('mutant that never walks an import again from a shallower path drops what the shipped --base lists', () => {
  const dir = repoOf('agent-docs-depth-', {
    'AGENTS.md': '# Agents\n',
    'CLAUDE.md': '@AGENTS.md\n@docs/d1.md\n@docs/shared.md\n',
    'docs/d1.md': '@d2.md\n',
    'docs/d2.md': '@d3.md\n',
    'docs/d3.md': '@d4.md\n',
    'docs/d4.md': '@shared.md\n',
    'docs/shared.md': '@deep.md\n',
    'docs/deep.md': 'Deep.\n',
  });
  assert.match(runScript(SCRIPT, dir, ['--base']).out, /docs\/deep\.md \(imported by docs\/shared\.md\)/);
  const mutant = mutantOf('else if (depth >= reached.get(f)) return;', 'else return;');
  assert.doesNotMatch(runScript(mutant, dir, ['--base']).out, /docs\/deep\.md/);
});

test('mutant that reads every glob match as a file crashes on a symlinked directory the shipped file skips', () => {
  const dir = repoOf(
    'agent-docs-dirlink-',
    { 'AGENTS.md': '# Agents\n', 'CLAUDE.md': '@AGENTS.md\n', 'src/x.js': 'module.exports = {};\n' },
    (d) => fs.symlinkSync('src', path.join(d, 'vendor-pdf.js')),
  );
  const shipped = runScript(SCRIPT, dir);
  assert.strictEqual(shipped.status, 0, `shipped file should pass: ${shipped.out}${shipped.err}`);
  const mutant = mutantOf(')])].filter(isFile);', ')])];');
  const result = runScript(mutant, dir);
  assert.notStrictEqual(result.status, 0, `mutant should crash: ${result.out}${result.err}`);
  assert.match(result.err, /EISDIR/);
});

for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
