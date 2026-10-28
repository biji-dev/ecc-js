// harness-bootstrap check-agent-docs tests (generated YYYY-MM-DD). Run: node --test <this file>
// [M] mechanism: ships as-is next to check-agent-docs.mjs. Fixtures are temp git repos; the shipped
// script runs with cwd = fixture. Only the CONFIG block ([B]) is ever substituted, never the checks.
// The whole CONFIG block is fixed here (CONFIG_BLOCK), so the suite passes whatever an install bound in it.
// CHECK_AGENT_DOCS_SCRIPT=<path> points the suite at another copy of the script.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
  readFileSync,
  copyFileSync,
  unlinkSync,
  symlinkSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir, devNull } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHIPPED =
  process.env.CHECK_AGENT_DOCS_SCRIPT || join(dirname(fileURLToPath(import.meta.url)), '..', 'check-agent-docs.mjs');

// The [B] budgets the suite runs under. Small, so over-budget fixtures stay small; skillLines is the shipped default.
const BUDGETS = { agents: 4096, claude: 1024, rule: 2048, skillLines: 500, stateFile: 1024, base: 6144 };
const BUDGETS_LINE = `budgets: { 'AGENTS.md': ${BUDGETS.agents}, 'CLAUDE.md': ${BUDGETS.claude}, rule: ${BUDGETS.rule}, skillLines: ${BUDGETS.skillLines}, stateFile: ${BUDGETS.stateFile}, base: ${BUDGETS.base} },`;
// The same line with some keys replaced by source text (`null`, a bad value) or, for `undefined`, left out.
const budgetsLine = (over = {}) => {
  const all = { 'AGENTS.md': BUDGETS.agents, 'CLAUDE.md': BUDGETS.claude, rule: BUDGETS.rule, skillLines: BUDGETS.skillLines, stateFile: BUDGETS.stateFile, base: BUDGETS.base, ...over };
  const parts = Object.entries(all)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k.includes('.') ? `'${k}'` : k}: ${v}`);
  return `budgets: { ${parts.join(', ')} },`;
};
const BUDGET_KEYS = ['AGENTS.md', 'CLAUDE.md', 'rule', 'stateFile', 'skillLines', 'base'];
// The rest is the shipped default, which the fixtures below are written against.
const CONFIG_BLOCK = `export const CONFIG = {
  ${BUDGETS_LINE}
  rulesDir: '.claude/rules',
  indexFile: 'AGENTS.md',
  skillDirs: ['.claude/skills', '.agents/skills'],
  agentDirs: ['.claude/agents'],
  statePattern: 'docs/plans/**/*.state.md',
  pathPrefixes: ['src/', 'apps/', 'packages/', 'lib/', 'docs/', 'scripts/', '.claude/', '.agents/'],
  intentionallyAbsent: [],
  requireImport: true,
  citeFiles: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
  citeExempt: ['scripts/check-agent-docs.mjs', 'scripts/lib/check-agent-docs.test.mjs'],
};`;

// Hermetic: no developer HOME, global or system git config reaches a fixture.
const ENV = {
  ...process.env,
  HOME: realpathSync(mkdtempSync(join(tmpdir(), 'check-agent-docs-home-'))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete ENV[k];

// The script under test: the shipped one with its CONFIG block replaced by CONFIG_BLOCK (removed after the file).
const SCRIPT_DIR = realpathSync(mkdtempSync(join(tmpdir(), 'check-agent-docs-script-')));
const SCRIPT = join(SCRIPT_DIR, 'check-agent-docs.mjs');
{
  const text = readFileSync(SHIPPED, 'utf8');
  const block = /^export const CONFIG = \{\n[\s\S]*?\n\};$/m;
  assert.ok(block.test(text), 'the CONFIG block was not found in the script');
  writeFileSync(SCRIPT, text.replace(block, () => CONFIG_BLOCK));
}

// Every temp dir a test makes is removed after that test (and the HOME and script dirs after the file).
const made = [];
const track = (dir) => {
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
after(() => {
  rmSync(ENV.HOME, { recursive: true, force: true });
  rmSync(SCRIPT_DIR, { recursive: true, force: true });
});

const FAKE = 'a'.repeat(24); // an obviously fake secret value

/** A well-formed project; `overrides` replaces or (with null) removes files. */
function baseFiles() {
  return {
    'AGENTS.md': '# Agents\n\n## Area rules\n\n- `db.md` — database rules, see [guide](docs/guide.md) and `src/index.js`.\n',
    'CLAUDE.md': '@AGENTS.md\n\nClaude-only notes.\n',
    'src/index.js': 'export {};\n',
    'src/db/schema.js': 'export {};\n',
    'docs/guide.md': '# Guide\n',
    'docs/plans/a.state.md': '# State\n',
    '.claude/rules/db.md': '---\npaths:\n  - "src/db/**"\n---\n\nUse the schema helpers.\n',
    '.claude/skills/demo/SKILL.md': '---\nname: demo\ndescription: "Demo skill: does a thing"\n---\n\n# Demo\n',
    '.claude/agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\n---\n\nReview it.\n',
  };
}

/** `after(dir)` runs once the files are staged, to make untracked or deleted-but-unstaged state. */
function fixture(overrides = {}, after = null) {
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'check-agent-docs-'))));
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { env: ENV });
  const files = { ...baseFiles(), ...overrides };
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir, env: ENV });
  if (after) after(dir);
  return dir;
}

function run(dir, args = [], script = SCRIPT) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', env: ENV });
  return { status: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}${r.stderr}` };
}

function expectFail(overrides, check, needle, after = null) {
  const r = run(fixture(overrides, after));
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}: ${r.all}`);
  assert.match(r.err, new RegExp(`^FAIL ${check}: .*${needle}`, 'm'), r.all);
  return r;
}

function expectOk(overrides = {}, after = null) {
  const r = run(fixture(overrides, after));
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /^check-agent-docs: OK \(\d+ checks\)$/m);
  return r;
}

/** Copy of the shipped script with one [B] CONFIG line replaced. */
function withConfig(from, to) {
  const text = readFileSync(SCRIPT, 'utf8');
  assert.ok(text.includes(from), `CONFIG line not found: ${from}`);
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'check-agent-docs-copy-'))));
  const file = join(dir, 'check-agent-docs.mjs');
  writeFileSync(file, text.replace(from, to));
  return file;
}

/** Like withConfig, with several [B] CONFIG lines replaced. */
function withConfigs(pairs) {
  let text = readFileSync(SCRIPT, 'utf8');
  for (const [from, to] of pairs) {
    assert.ok(text.includes(from), `CONFIG line not found: ${from}`);
    text = text.replace(from, to);
  }
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'check-agent-docs-copy-'))));
  const file = join(dir, 'check-agent-docs.mjs');
  writeFileSync(file, text);
  return file;
}

test('baseline project passes and reports a check count', () => {
  const r = expectOk();
  assert.ok(Number(r.out.match(/\((\d+) checks\)/)[1]) > 5);
});

test('all checks run: two failures in different checks are both reported', () => {
  const dir = fixture({ 'CLAUDE.md': '# no import\n', 'docs/guide.md': null });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.err, /^FAIL import: /m);
  assert.match(r.err, /^FAIL links: AGENTS\.md/m);
});

// 1. import
test('import: passes with the import line, with leading blank lines, and without CLAUDE.md', () => {
  expectOk({ 'CLAUDE.md': '\n\n@AGENTS.md\n' });
  expectOk({ 'CLAUDE.md': null });
});

test('import: fails when CLAUDE.md does not open with @AGENTS.md', () => {
  expectFail({ 'CLAUDE.md': '# Claude\n\n@AGENTS.md\n' }, 'import', 'CLAUDE\\.md:1');
});

test('import: requireImport false turns the check off', () => {
  const script = withConfig('requireImport: true', 'requireImport: false');
  const r = run(fixture({ 'CLAUDE.md': '# no import\n' }), [], script);
  assert.equal(r.status, 0, r.all);
});

// 2. budget
test('budget: a file at its budget passes', () => {
  expectOk({ 'CLAUDE.md': `@AGENTS.md\n${'x'.repeat(BUDGETS.claude - 12)}\n` });
});

test('budget: CLAUDE.md over its byte budget fails', () => {
  expectFail({ 'CLAUDE.md': `@AGENTS.md\n${'x'.repeat(BUDGETS.claude)}\n` }, 'budget', `CLAUDE\\.md .*budget ${BUDGETS.claude}`);
});

test('budget: AGENTS.md over its byte budget fails', () => {
  const text = `${baseFiles()['AGENTS.md']}${'x'.repeat(BUDGETS.agents)}\n`;
  expectFail({ 'AGENTS.md': text }, 'budget', `AGENTS\\.md .*budget ${BUDGETS.agents}`);
});

test('budget: a rule file over its byte budget fails', () => {
  const rule = `---\npaths:\n  - "src/db/**"\n---\n${'x'.repeat(BUDGETS.rule)}\n`;
  expectFail({ '.claude/rules/db.md': rule }, 'budget', `db\\.md .*budget ${BUDGETS.rule}`);
});

test('budget: a state file over its byte budget fails', () => {
  expectFail({ 'docs/plans/a.state.md': `${'x'.repeat(BUDGETS.stateFile)}\n` }, 'budget', `a\\.state\\.md .*budget ${BUDGETS.stateFile}`);
});

test('budget: a state file that git ignores is still read, from the pattern\'s static prefix only', () => {
  const ignore = { 'docs/plans/.gitignore': '*.state.md\n' };
  expectFail({ ...ignore, 'docs/plans/a.state.md': 'x'.repeat(9216) }, 'budget', 'docs/plans/a\\.state\\.md 9216 bytes, budget 1024');
  // An ignored small one passes, and is counted like a tracked one.
  assert.equal(checksIn(expectOk(ignore)), checksIn(expectOk()), 'an ignored state file is not counted');
  // With no static prefix the git list is the only source: an ignored match elsewhere is never read.
  const anywhere = withConfig("statePattern: 'docs/plans/**/*.state.md'", "statePattern: '**/*.state.md'");
  const big = { 'notes/b.state.md': 'x'.repeat(9216) };
  const hidden = run(fixture({ '.gitignore': 'notes/\n', ...big }), [], anywhere);
  assert.equal(hidden.status, 0, `an ignored file outside any static prefix was read: ${hidden.all}`);
  const shown = run(fixture(big), [], anywhere);
  assert.equal(shown.status, 1, `the control (not ignored) did not fail: ${shown.all}`);
  assert.match(shown.err, /^FAIL budget: notes\/b\.state\.md 9216 bytes/m, shown.all);
});

test('budget: a state pattern with a leading ./ still finds an ignored state file', () => {
  const dotted = withConfig("statePattern: 'docs/plans/**/*.state.md'", "statePattern: './docs/plans/**/*.state.md'");
  const dir = fixture({ 'docs/plans/.gitignore': '*.state.md\n', 'docs/plans/a.state.md': 'x'.repeat(9216) });
  const r = run(dir, [], dotted);
  assert.equal(r.status, 1, `the ignored state file was not read through a ./ pattern: ${r.all}`);
  assert.match(r.err, /^FAIL budget: docs\/plans\/a\.state\.md 9216 bytes/m, r.all);
});

test('budget: the state walk follows the pattern\'s own segments - a workspace glob and braces still find ignored files', () => {
  const big = 'x'.repeat(9216);
  const ignore = { '.gitignore': 'apps/*/docs/plans/\n' };
  const star = withConfig("statePattern: 'docs/plans/**/*.state.md'", "statePattern: 'apps/*/docs/plans/**/*.state.md'");
  const files = { ...ignore, 'apps/web/docs/plans/a.state.md': big, 'apps/api/docs/plans/sub/deep/b.state.md': big };
  const found = run(fixture(files), [], star);
  assert.equal(found.status, 1, found.all);
  assert.match(found.err, /^FAIL budget: apps\/web\/docs\/plans\/a\.state\.md /m, `the workspace glob missed a state file: ${found.all}`);
  assert.match(found.err, /^FAIL budget: apps\/api\/docs\/plans\/sub\/deep\/b\.state\.md /m, `a file under ** was pruned: ${found.all}`);
  const braces = withConfig("statePattern: 'docs/plans/**/*.state.md'", "statePattern: 'apps/{web,api}/docs/plans/*.state.md'");
  const both = run(fixture(files), [], braces);
  assert.match(both.err, /^FAIL budget: apps\/web\/docs\/plans\/a\.state\.md /m, `a brace alternative missed its file: ${both.all}`);
  assert.doesNotMatch(both.err, /deep\/b\.state\.md/, `a file below a single-segment pattern was read: ${both.all}`);
});

test('budget: the state walk stays out of directories the pattern cannot match, and does not run for --rules-for or a null stateFile', () => {
  const STAR = "statePattern: 'apps/*/docs/plans/**/*.state.md'";
  const WALK = "statePattern: 'docs/plans/**/*.state.md'";
  const star = withConfigs([[WALK, STAR]]);
  const starNoState = withConfigs([[WALK, STAR], [BUDGETS_LINE, budgetsLine({ stateFile: 'null' })]]);
  const files = { 'apps/web/docs/plans/a.state.md': '# State\n', 'apps/web/node_modules/locked/x.txt': 'x\n' };
  const locked = (d) => join(d, 'apps/web/node_modules/locked');
  const dir = fixture(files, (d) => chmodSync(locked(d), 0o000)); // under root a read still works: the test then passes anyway
  try {
    const r = run(dir, [], star);
    assert.equal(r.status, 0, `the walk went into node_modules: ${r.all}`);
    assert.match(r.out, /^check-agent-docs: OK/m, r.all);
    // A `--rules-for` run returns before the state files are read; so does a run with the budget off.
    const rules = run(dir, ['--rules-for', 'src/db/schema.js'], star);
    assert.equal(rules.status, 0, `--rules-for walked the state directories: ${rules.all}`);
    assert.equal(rules.out, '.claude/rules/db.md\n', rules.all);
    const off = run(dir, [], starNoState);
    assert.equal(off.status, 0, `a null stateFile budget still walked the state directories: ${off.all}`);
  } finally {
    chmodSync(locked(dir), 0o755); // so the temp dir can be removed
  }
});

test('budget: a SKILL.md over its line budget fails and exactly the budget passes', () => {
  const head = '---\nname: demo\ndescription: Demo\n---\n';
  const body = (n) => `${head}${'line\n'.repeat(n - 4)}`;
  const max = BUDGETS.skillLines;
  expectOk({ '.claude/skills/demo/SKILL.md': body(max) });
  expectFail({ '.claude/skills/demo/SKILL.md': body(max + 1) }, 'budget', `SKILL\\.md ${max + 1} lines, budget ${max}`);
});

/** Every file over its test budget, and so the always-loaded total over the base. */
function overEveryBudget() {
  return {
    'AGENTS.md': `${baseFiles()['AGENTS.md']}${'x'.repeat(BUDGETS.agents)}\n`,
    'CLAUDE.md': `@AGENTS.md\n${'x'.repeat(BUDGETS.claude)}\n`,
    '.claude/rules/db.md': `---\npaths:\n  - "src/db/**"\n---\n${'x'.repeat(BUDGETS.rule)}\n`,
    'docs/plans/a.state.md': `${'x'.repeat(BUDGETS.stateFile)}\n`,
    '.claude/skills/demo/SKILL.md': `---\nname: demo\ndescription: Demo\n---\n${'line\n'.repeat(BUDGETS.skillLines)}`,
  };
}
const allNull = Object.fromEntries(BUDGET_KEYS.map((k) => [k, 'null']));

test('budget: a null budget is off - files over the default budgets pass and no budget check is counted', () => {
  const nulls = withConfig(BUDGETS_LINE, budgetsLine(allNull));
  const dir = fixture(overEveryBudget());
  assert.equal(run(dir).status, 1, 'the default budgets must fail this fixture, or the null run proves nothing');
  const off = run(dir, [], nulls);
  assert.equal(off.status, 0, `every budget null still fails: ${off.all}`);
  // AGENTS.md, CLAUDE.md, rule, state file, skill and base: one check each in a default run.
  assert.equal(checksIn(run(fixture(), [], nulls)), checksIn(run(fixture())) - 6, 'a null budget still counts a check');
});

test('budget: a missing key fails once, names the key and its files are not checked', () => {
  const dir = fixture(overEveryBudget());
  for (const key of BUDGET_KEYS) {
    const script = withConfig(BUDGETS_LINE, budgetsLine({ ...allNull, [key]: undefined }));
    const r = run(dir, [], script);
    assert.equal(r.status, 1, `${key} missing: expected exit 1, got ${r.status}: ${r.all}`);
    const lines = r.err.match(/^FAIL budget: .*$/gm) ?? [];
    assert.deepEqual(lines, [`FAIL budget: CONFIG.budgets.${key} is missing - set a number, or null to turn it off`], `${key} missing: ${r.all}`);
  }
});

test('budget: a value that is not a whole number or null fails once, with the value', () => {
  const dir = fixture(overEveryBudget());
  const bad = [['rule', "'16384'", '"16384"'], ['stateFile', '-1', '-1'], ['skillLines', '1.5', '1.5'], ['AGENTS.md', 'true', 'true'], ['base', 'NaN', 'NaN']];
  for (const [key, source, shown] of bad) {
    const r = run(dir, [], withConfig(BUDGETS_LINE, budgetsLine({ ...allNull, [key]: source })));
    assert.equal(r.status, 1, `${key} ${source}: expected exit 1, got ${r.status}: ${r.all}`);
    const lines = r.err.match(/^FAIL budget: .*$/gm) ?? [];
    assert.deepEqual(lines, [`FAIL budget: CONFIG.budgets.${key} is ${shown}, not a whole number or null`], `${key} ${source}: ${r.all}`);
  }
});

// 3. rule-paths
test('rule-paths: a rule with no paths list fails', () => {
  expectFail({ '.claude/rules/db.md': '---\ndescription: x\n---\nBody\n' }, 'rule-paths', 'db\\.md .*no non-empty');
  expectFail({ '.claude/rules/db.md': 'No frontmatter at all\n' }, 'rule-paths', 'db\\.md .*no non-empty');
});

test('rule-paths: a glob that matches no file fails; inline arrays and braces work', () => {
  expectFail({ '.claude/rules/db.md': '---\npaths:\n  - "src/nothing/**"\n---\nx\n' }, 'rule-paths', 'src/nothing/\\*\\*');
  expectOk({ '.claude/rules/db.md': "---\npaths: ['src/{db,none}/**/*.js', \"docs/*.md\"]\n---\nx\n" });
});

test('rule-paths: a single * or ? never crosses a slash', () => {
  const rule = '---\npaths:\n  - "docs/*.txt"\n  - "docs/d?a.txt"\n---\nx\n';
  const r = run(fixture({ '.claude/rules/db.md': rule, 'docs/d/a.txt': 'x\n' }));
  assert.equal(r.status, 1, r.all);
  assert.match(r.err, /^FAIL rule-paths: .*db\.md .*`docs\/\*\.txt` matches no file/m, r.all);
  assert.match(r.err, /^FAIL rule-paths: .*db\.md .*`docs\/d\?a\.txt` matches no file/m, r.all);
  const ok = '---\npaths:\n  - "docs/*/a.txt"\n  - "docs/d?a.txt"\n---\nx\n';
  expectOk({ '.claude/rules/db.md': ok.replace('docs/d?a.txt', 'docs/?/a.txt'), 'docs/d/a.txt': 'x\n' });
  const rf = run(fixture({ '.claude/rules/db.md': rule, 'docs/d/a.txt': 'x\n' }), ['--rules-for', 'docs/d/a.txt']);
  assert.equal(rf.out, '', 'neither * nor ? may reach into docs/d/');
});

test('rule-paths: [abc] and [!abc] character classes match one non-slash character', () => {
  const rule = (g) => `---\npaths:\n  - "${g}"\n---\nx\n`;
  expectOk({ '.claude/rules/db.md': rule('src/[d]b/**') });
  expectOk({ '.claude/rules/db.md': rule('src/[a-f]b/**') });
  expectOk({ '.claude/rules/db.md': rule('src/[!x]b/**') });
  expectFail({ '.claude/rules/db.md': rule('src/[x]b/**') }, 'rule-paths', 'src/\\[x\\]b/\\*\\*` matches no file');
  expectFail({ '.claude/rules/db.md': rule('src/[!d]b/**') }, 'rule-paths', 'matches no file');
  expectFail({ '.claude/rules/db.md': rule('src[!x]db/**') }, 'rule-paths', 'matches no file');
  expectFail({ '.claude/rules/db.md': rule('src[/]db/**') }, 'rule-paths', 'matches no file');
  expectFail({ '.claude/rules/db.md': rule('src/[z-a]b/**') }, 'rule-paths', 'matches no file');
  expectFail({ '.claude/rules/db.md': rule('src/[db/**') }, 'rule-paths', 'matches no file');
});

test('rule-paths: a leading ] in a class is a literal member', () => {
  const rule = (g) => `---\npaths:\n  - "${g}"\n---\nx\n`;
  const extra = { 'src/ab/x.js': 'x\n', 'src/]b/x.js': 'x\n' };
  expectOk({ '.claude/rules/db.md': rule('src/[]a]b/**'), ...extra });
  expectOk({ '.claude/rules/db.md': rule('src/[]x]b/**'), ...extra });
  expectOk({ '.claude/rules/db.md': rule('src/[!]a]b/**'), ...extra });
  expectFail({ '.claude/rules/db.md': rule('src/[]x]c/**') }, 'rule-paths', 'matches no file');
  const dir = fixture({ '.claude/rules/db.md': rule('src/[]a]b/**'), ...extra });
  assert.equal(run(dir, ['--rules-for', 'src/ab/x.js']).out, '.claude/rules/db.md\n');
  assert.equal(run(dir, ['--rules-for', 'src/]b/x.js']).out, '.claude/rules/db.md\n');
  assert.equal(run(dir, ['--rules-for', 'src/cb/x.js']).out, '');
});

test('--rules-for: character classes select the rule', () => {
  const rule = '---\npaths:\n  - "src/[d]b/**"\n---\nx\n';
  const dir = fixture({ '.claude/rules/db.md': rule });
  assert.equal(run(dir, ['--rules-for', 'src/db/schema.js']).out, '.claude/rules/db.md\n');
  assert.equal(run(dir, ['--rules-for', 'src/xb/schema.js']).out, '');
});

test('rule-paths: untracked files count, and tracked files deleted from disk do not', () => {
  const newRule = '---\npaths:\n  - "src/new/**"\n---\nx\n';
  expectOk({ '.claude/rules/db.md': newRule }, (dir) => {
    mkdirSync(join(dir, 'src/new'), { recursive: true });
    writeFileSync(join(dir, 'src/new/a.js'), 'x\n');
  });
  const goneRule = '---\npaths:\n  - "src/gone/**"\n---\nx\n';
  expectFail({ '.claude/rules/db.md': goneRule, 'src/gone/a.js': 'x\n' }, 'rule-paths', 'src/gone/\\*\\*` matches no file', (dir) =>
    unlinkSync(join(dir, 'src/gone/a.js')),
  );
});

// 4. rule-index
test('rule-index: a rule missing from the index fails', () => {
  expectFail({ '.claude/rules/api.md': '---\npaths:\n  - "src/**"\n---\nx\n' }, 'rule-index', 'api\\.md is missing');
});

test('rule-index: an index entry with no rule file fails', () => {
  const agents = `${baseFiles()['AGENTS.md']}- \`ghost.md\` — nothing here.\n`;
  expectFail({ 'AGENTS.md': agents }, 'rule-index', 'indexes ghost\\.md');
});

test('rule-index: a key-docs list elsewhere in AGENTS.md is not part of the index', () => {
  const keyDocs = '## Key docs\n\n- `README.md` — overview.\n- `CONTRIBUTING.md` — how to contribute.\n';
  expectOk({ 'AGENTS.md': `${baseFiles()['AGENTS.md']}\n${keyDocs}` });
  expectOk({ 'AGENTS.md': `# Agents\n\n${keyDocs}\n## Area rules\n\n- \`db.md\` — database rules.\n` });
});

test('rule-index: an extra inside the index section fails, also under a nested heading', () => {
  const agents = (extra) => `# Agents\n\n## Area rules\n\n- \`db.md\` — database rules.\n${extra}\n## Key docs\n\n- \`README.md\` — overview.\n`;
  expectFail({ 'AGENTS.md': agents('- `ghost.md` — nothing here.\n') }, 'rule-index', 'indexes ghost\\.md');
  const nested = expectFail({ 'AGENTS.md': agents('\n### More\n\n- `other.md` — nothing here.\n') }, 'rule-index', 'indexes other\\.md');
  assert.doesNotMatch(nested.err, /README/, nested.all);
});

test('rule-index: with no bullet naming an existing rule there is no index: every rule is missing, no extras', () => {
  const r = expectFail({ 'AGENTS.md': '# Agents\n\n- `ghost.md` — nothing here.\n' }, 'rule-index', 'db\\.md is missing');
  assert.doesNotMatch(r.err, /indexes/, r.all);
});

test('rule-index: skipped when there is no rules directory', () => {
  expectOk({ '.claude/rules/db.md': null, 'AGENTS.md': '# Agents\n\n- `ghost.md` — nothing here.\n' });
});

test('rule-index: any rule file name works, and the index line may use -, *, en dash or colon', () => {
  const rule = '---\npaths:\n  - "src/**"\n---\nx\n';
  const lines = [
    '- `api_design.md` — snake case name.',
    '- `API.md` — upper case name.',
    '* `v2.1.md` - star bullet, hyphen separator.',
    '- `db.md` – en dash.',
    '  - `misc.md`: colon.',
  ];
  expectOk({
    'AGENTS.md': `# Agents\n\n${lines.join('\n')}\n`,
    '.claude/rules/api_design.md': rule,
    '.claude/rules/API.md': rule,
    '.claude/rules/v2.1.md': rule,
    '.claude/rules/misc.md': rule,
  });
});

test('rule-index: the missing-entry message shows what an index line looks like', () => {
  const r = expectFail({ 'AGENTS.md': '# Agents\n', '.claude/rules/db.md': baseFiles()['.claude/rules/db.md'] }, 'rule-index', 'db\\.md is missing');
  assert.match(r.err, /add a line like: - `db\.md` — /, r.all);
});

test('nested rules: a rule under a subdirectory is checked, indexed by its relative path and listed', () => {
  const nested = '.claude/rules/web/deep/react.md';
  const bare = '---\ndescription: x\n---\nBody\n';
  // Without `paths:` and without an index line it fails both checks and is always loaded.
  const r = expectFail({ '.claude/rules/web/react.md': bare, [nested]: bare }, 'rule-paths', 'web/react\\.md .*no non-empty');
  assert.match(r.err, /^FAIL rule-paths: .*web\/deep\/react\.md .*no non-empty/m, r.all);
  assert.match(r.err, /^FAIL rule-index: .*web\/react\.md is missing/m, r.all);
  assert.match(r.err, /^FAIL rule-index: .*web\/deep\/react\.md is missing/m, r.all);
  const loaded = run(fixture({ '.claude/rules/web/react.md': bare }), ['--base']).out;
  assert.match(loaded, /\.claude\/rules\/web\/react\.md \(a rule without paths:\)/, loaded);
  // Scoped and indexed by its path relative to the rules dir it passes; a slash bullet naming no rule is no index entry.
  const scoped = '---\npaths:\n  - "src/**"\n---\nBody\n';
  const agents = `${baseFiles()['AGENTS.md']}- \`web/react.md\` — react.\n- \`docs/guide.md\` — another doc, not a rule.\n`;
  const ok = fixture({ '.claude/rules/web/react.md': scoped, 'AGENTS.md': agents });
  expectOk({ '.claude/rules/web/react.md': scoped, 'AGENTS.md': agents });
  assert.equal(run(ok, ['--rules-for', 'src/index.js']).out, '.claude/rules/web/react.md\n');
  // A slash-free bullet that names no rule file is still an extra.
  expectFail({ '.claude/rules/web/react.md': scoped, 'AGENTS.md': `${agents}- \`ghost.md\` — nothing.\n` }, 'rule-index', 'indexes ghost\\.md');
});

// 5. links
test('links: a broken relative link fails with its line number', () => {
  expectFail({ 'AGENTS.md': `${baseFiles()['AGENTS.md']}\nSee [gone](docs/gone.md).\n` }, 'links', 'AGENTS\\.md:7 .*docs/gone\\.md');
});

test('links: root-relative, file-relative, fragment, anchor, http and mailto links pass', () => {
  const text = [
    baseFiles()['AGENTS.md'],
    '[a](/docs/guide.md) [b](docs/guide.md#top) [c](#local) [d](https://example.com/x) [e](mailto:a@example.com)',
  ].join('\n');
  const rule = '---\npaths:\n  - "src/db/**"\n---\nSee [up](../../docs/guide.md).\n';
  expectOk({ 'AGENTS.md': text, '.claude/rules/db.md': rule });
});

test('links: a link in a nested file is read against the file and against the repository root', () => {
  const head = '---\npaths:\n  - "src/db/**"\n---\n\n';
  const rule = (link) => ({ '.claude/rules/db.md': `${head}See ${link}.\n` });
  expectOk(rule('[g](docs/guide.md)'));
  const gone = expectFail(rule('[g](docs/gone.md)'), 'links', '\\.claude/rules/db\\.md:6 link target `docs/gone\\.md` does not exist');
  assert.equal(gone.err.match(/^FAIL /gm).length, 1, gone.err);
  // A skill's own reference file, beside it, passes as before.
  const skill = '---\nname: demo\ndescription: Demo\n---\n\nSee [r](reference/a.md).\n';
  expectOk({ '.claude/skills/demo/SKILL.md': skill, '.claude/skills/demo/reference/a.md': '# A\n' });
  // A target that is absent and gitignored at the root passes; absent and not ignored fails.
  expectOk({ '.gitignore': 'docs/private/\n', ...rule('[p](docs/private/notes.md)') });
  expectFail(rule('[p](docs/private/notes.md)'), 'links', 'docs/private/notes\\.md');
  // A root-relative reading never leaves the repository: `../<this repo>/docs/guide.md` is not the repository's guide.
  const out = fixture({}, (d) => {
    writeFileSync(join(d, '.claude/rules/db.md'), `${head}See [g](../${basename(d)}/docs/guide.md).\n`);
  });
  const r = run(out);
  assert.equal(r.status, 1, `a root-relative link out of the repository passed: ${r.all}`);
  assert.match(r.err, /^FAIL links: \.claude\/rules\/db\.md:6 /m, r.all);
});

test('links: links inside code fences and inline code are ignored', () => {
  expectOk({ 'AGENTS.md': `${baseFiles()['AGENTS.md']}\n\`[x](docs/nope.md)\`\n\n\`\`\`\n[y](docs/nope2.md)\n\`\`\`\n` });
});

// 6. paths
test('paths: a backticked path that does not exist fails', () => {
  expectFail({ 'AGENTS.md': `${baseFiles()['AGENTS.md']}\nSee \`src/missing.js:12\`.\n` }, 'paths', 'AGENTS\\.md:7 .*src/missing\\.js:12');
});

test('paths: globs, placeholders, other prefixes and existing paths pass', () => {
  const extra = '\nSee `src/**/*.js`, `src/<name>/x.js`, `docs/{a,b}.md`, `other/missing.js`, `src/index.js:3-9`, `src/db/`.\n';
  expectOk({ 'AGENTS.md': `${baseFiles()['AGENTS.md']}${extra}` });
});

test('paths: a prefix whose directory is absent at the root is skipped (a monorepo cites workspace paths)', () => {
  const rule = (cited, glob = 'src/db/**') => `---\npaths:\n  - "${glob}"\n---\n\nSee ${cited}.\n`;
  const monorepo = (cited) => ({
    'src/index.js': null,
    'src/db/schema.js': null,
    'apps/web/src/a.ts': 'export {};\n',
    'AGENTS.md': baseFiles()['AGENTS.md'].replace('`src/index.js`', '`apps/web/src/a.ts`'),
    '.claude/rules/db.md': rule(cited, 'apps/web/src/**'),
  });
  const skipped = run(fixture(monorepo('`src/outcome.ts`')));
  assert.equal(skipped.status, 0, `a workspace-relative citation was read as a root path: ${skipped.all}`);
  // The prefix that does name a root directory still counts.
  expectFail({ '.claude/rules/db.md': rule('`src/gone.ts`') }, 'paths', 'src/gone\\.ts');
  expectOk({ '.claude/rules/db.md': rule('`src/index.js`') });
  // A file named like the directory does not make the prefix count.
  const file = run(fixture({ lib: 'not a directory\n', ...monorepo('`lib/x.ts`') }));
  assert.equal(file.status, 0, `a file named lib made the lib/ prefix count: ${file.all}`);
  expectFail({ 'lib/y.ts': 'export {};\n', '.claude/rules/db.md': rule('`lib/x.ts`') }, 'paths', 'lib/x\\.ts');
});

test('paths: intentionallyAbsent exempts a path', () => {
  const agents = `${baseFiles()['AGENTS.md']}\nMust not exist: \`src/legacy.js\`.\n`;
  assert.equal(run(fixture({ 'AGENTS.md': agents })).status, 1);
  const script = withConfig('intentionallyAbsent: []', "intentionallyAbsent: ['src/legacy.js']");
  assert.equal(run(fixture({ 'AGENTS.md': agents }), [], script).status, 0);
});

test('paths: a #fragment on a backticked path is ignored', () => {
  expectOk({ 'AGENTS.md': `${baseFiles()['AGENTS.md']}\nSee \`docs/guide.md#install\` and \`src/index.js:3#x\`.\n` });
  expectFail({ 'AGENTS.md': `${baseFiles()['AGENTS.md']}\nSee \`docs/gone.md#install\`.\n` }, 'paths', 'docs/gone\\.md#install');
});

test('paths and links: an absent path that git ignores passes; an absent path that is not ignored fails', () => {
  const agents = (extra) => `${baseFiles()['AGENTS.md']}\n${extra}\n`;
  const ignore = '.claude/registry.md\ndocs/private/\n';
  const cited = 'Registry: `.claude/registry.md`, [r](.claude/registry.md), `docs/private/notes.md`, [n](docs/private/notes.md).';
  expectOk({ '.gitignore': ignore, 'AGENTS.md': agents(cited) });
  // Without the ignore rule the same text fails: the pass comes from git, not from the citation.
  const bare = expectFail({ 'AGENTS.md': agents(cited) }, 'paths', '`\\.claude/registry\\.md` does not exist');
  assert.match(bare.err, /^FAIL links: AGENTS\.md:\d+ link target `\.claude\/registry\.md` does not exist/m, bare.all);
  // Mixed: only the citation git does not ignore is reported.
  const mixed = expectFail(
    { '.gitignore': ignore, 'AGENTS.md': agents(`${cited} Also \`.claude/other.md\` and [o](docs/other.md).`) },
    'paths',
    '`\\.claude/other\\.md` does not exist',
  );
  assert.match(mixed.err, /^FAIL links: AGENTS\.md:\d+ link target `docs\/other\.md` does not exist/m, mixed.all);
  assert.doesNotMatch(mixed.err, /registry|private/, mixed.all);
});

test('paths: when git cannot answer, an absent path fails as before (no crash)', () => {
  // `docs/link/x.md` lies beyond a symlink: `git check-ignore` refuses the whole batch with a fatal error.
  const agents = `${baseFiles()['AGENTS.md']}\nSee \`.claude/registry.md\` and \`docs/link/x.md\`.\n`;
  const dir = fixture({ '.gitignore': '.claude/registry.md\n', 'AGENTS.md': agents }, (d) => {
    try {
      symlinkSync('../src', join(d, 'docs/link'));
    } catch {
      // symlinks may be unavailable (Windows without privileges); the test then only checks the failure
    }
  });
  const r = run(dir);
  assert.equal(r.status, 1, r.all);
  assert.match(r.err, /^FAIL paths: AGENTS\.md:\d+ `\.claude\/registry\.md` does not exist/m, r.all);
  assert.doesNotMatch(r.all, /EISDIR|ENOENT|at .*\.mjs/);
});

test('directories and dangling symlinks named *.md or SKILL.md are skipped, never a crash', () => {
  const r = run(
    fixture(
      {
        '.claude/rules/x.md/a.txt': 'x\n',
        '.claude/agents/y.md/a.txt': 'x\n',
        '.claude/skills/other/SKILL.md/a.txt': 'x\n',
      },
      (dir) => {
        try {
          symlinkSync('missing-target', join(dir, '.claude/rules/dangling.md'));
          symlinkSync('missing-target', join(dir, '.claude/agents/dangling.md'));
        } catch {
          // symlinks may be unavailable (Windows without privileges); the directories still count
        }
      },
    ),
  );
  assert.equal(r.status, 0, r.all);
  assert.doesNotMatch(r.all, /EISDIR|ENOENT|at .*\.mjs/);
});

test('a skill reached through both skill directories is read once and reported by the path a fix edits', () => {
  for (const [realDir, linkDir] of [
    ['.agents/skills', '.claude/skills'],
    ['.claude/skills', '.agents/skills'],
  ]) {
    const dir = fixture({ [`${realDir}/x/SKILL.md`]: '# No frontmatter\n' }, (d) => {
      try {
        mkdirSync(join(d, linkDir), { recursive: true });
        symlinkSync(`../../${realDir}/x`, join(d, linkDir, 'x'));
      } catch {
        // symlinks may be unavailable (Windows without privileges); then only the real skill exists
      }
    });
    const r = run(dir);
    assert.equal(r.status, 1, r.all);
    const found = r.err.match(/^FAIL frontmatter: .*$/gm) ?? [];
    assert.equal(found.length, 1, `${realDir}: the skill is reported ${found.length} times: ${r.err}`);
    assert.match(found[0], new RegExp(`^FAIL frontmatter: ${realDir.replace('.', '\\.')}/x/SKILL\\.md:1 has no frontmatter$`), r.all);
  }
});

// 7. frontmatter
test('frontmatter: a skill without frontmatter or without description fails', () => {
  expectFail({ '.claude/skills/demo/SKILL.md': '# Demo\n' }, 'frontmatter', 'SKILL\\.md:1 has no frontmatter');
  expectFail({ '.claude/skills/demo/SKILL.md': '---\nname: demo\n---\nx\n' }, 'frontmatter', 'missing `description`');
  expectFail({ '.claude/skills/demo/SKILL.md': '---\ndescription: d\n---\nx\n' }, 'frontmatter', 'missing `name`');
});

test('frontmatter: a plain description with ": " or " #" fails, quoted or block values pass', () => {
  const skill = (d) => `---\nname: demo\ndescription: ${d}\n---\nx\n`;
  expectFail({ '.claude/skills/demo/SKILL.md': skill('Use when: it helps') }, 'frontmatter', 'quote the value');
  expectFail({ '.claude/skills/demo/SKILL.md': skill('Use it # now') }, 'frontmatter', 'quote the value');
  expectOk({ '.claude/skills/demo/SKILL.md': skill('"Use when: it helps"') });
  expectOk({ '.claude/skills/demo/SKILL.md': '---\nname: demo\ndescription: >-\n  Use when: it helps\n---\nx\n' });
});

test('frontmatter: an agent without tools fails', () => {
  expectFail({ '.claude/agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews\n---\nx\n' }, 'frontmatter', 'missing `tools:`');
});

test('frontmatter: a read-only agent must not list write tools', () => {
  const agent = (desc, tools, body = 'Review it.') => `---\nname: reviewer\ndescription: ${desc}\ntools: ${tools}\n---\n${body}\n`;
  expectFail({ '.claude/agents/reviewer.md': agent('A Read-Only reviewer', 'Read, Bash') }, 'frontmatter', 'lists Bash');
  expectFail({ '.claude/agents/reviewer.md': agent('Reviews', 'Read, Edit, Write', 'This agent is read-only.') }, 'frontmatter', 'lists Edit, Write');
  expectOk({ '.claude/agents/reviewer.md': agent('A read-only reviewer', 'Read, Grep, Glob') });
  expectOk({ '.claude/agents/reviewer.md': agent('Reviews and fixes', 'Read, Edit, Bash') });
});

test('frontmatter: an agent that says it is not read-only (or never, no longer) may hold Bash', () => {
  const agent = (body) => `---\nname: reviewer\ndescription: Reviews\ntools: Read, Bash\n---\n${body}\n`;
  const denials = [
    'You hold Bash, so you are not read-only.',
    "This agent isn't read-only.",
    'It is not read-only: it runs the tests.',
    'The reviewer is never read-only.',
    'It is no longer read-only.',
    'It will not be read-only.',
    'NOT READ-ONLY.',
  ];
  for (const body of denials) expectOk({ '.claude/agents/reviewer.md': agent(body) });
  expectOk({ '.claude/agents/reviewer.md': `---\nname: reviewer\ndescription: "Not read-only: runs checks"\ntools: Read, Bash\n---\nx\n` });
});

test('frontmatter: a read-only claim still fails when a negation is not directly before it', () => {
  const agent = (body) => `---\nname: reviewer\ndescription: Reviews\ntools: Read, Bash\n---\n${body}\n`;
  const claims = [
    'This agent is read-only.',
    'Not sure, but it is read-only.',
    'It is not read-only for notes, though read-only for code.', // the second one is a claim
    'It is never meant to change anything, and is read-only.',
    'not at all, in any sense whatsoever, read-only',
    'Never mind: read-only.',
  ];
  for (const body of claims) {
    expectFail({ '.claude/agents/reviewer.md': agent(body) }, 'frontmatter', 'agent says "read-only" but lists Bash');
  }
});

test('frontmatter values are not link- or path-checked', () => {
  const skill = '---\nname: demo\ndescription: "See [x](docs/nope.md) and `docs/nope2.md`"\n---\n\n# Demo\n';
  expectOk({ '.claude/skills/demo/SKILL.md': skill });
  const agent = '---\nname: reviewer\ndescription: "See [x](docs/nope.md) and `docs/nope2.md`"\ntools: Read\n---\nx\n';
  expectOk({ '.claude/agents/reviewer.md': agent });
});

// 8. secrets
test('secrets: credential-shaped strings fail and are never printed', () => {
  // Every value is built at run time, so this file never holds a literal a secret scanner flags.
  const aws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const val = ['abcdefghij', 'klmnop1234'].join('');
  const sk = 'sk-' + 'abcdefghijklmnopqrstuvwxyz';
  const pw = ['hunter2', 'hunter2', 'hunter2'].join('');
  const cases = [
    [`api_key = ${val}`, val],
    [`AWS ${aws} here`, aws],
    [`key ${sk}`, sk],
    ['-----BEGIN RSA ' + 'PRIVATE KEY-----', 'BEGIN RSA PRIVATE KEY'],
    [`Password: "${pw}"`, pw],
    [`"password": "${val}"`, val], // a JSON key
    [`\\"api_key\\": \\"${val}\\"`, val], // a JSON-escaped key and value, as in a stringified settings file
  ];
  for (const [line, secret] of cases) {
    const r = expectFail({ 'CLAUDE.md': `@AGENTS.md\n${line}\n` }, 'secrets', 'CLAUDE\\.md:2 ');
    assert.ok(!r.all.includes(secret), `output leaked a ${secret.length}-character value`);
  }
});

test('secrets: short values and prose pass; rules, skills and agents are scanned too', () => {
  expectOk({ 'CLAUDE.md': '@AGENTS.md\nSet the token: short\nRotate the password regularly.\n' });
  expectFail({ '.claude/rules/db.md': '---\npaths:\n  - "src/db/**"\n---\nsecret=abcdefghijklmnop1234\n' }, 'secrets', 'db\\.md:5 ');
  const skill = `---\nname: demo\ndescription: Demo\n---\nkey sk-${FAKE}\n`;
  expectFail({ '.claude/skills/demo/SKILL.md': skill }, 'secrets', 'SKILL\\.md:5 ');
  const agent = `---\nname: reviewer\ndescription: Reviews\ntools: Read\n---\nkey sk-${FAKE}\n`;
  expectFail({ '.claude/agents/reviewer.md': agent }, 'secrets', 'reviewer\\.md:6 ');
});

// Other checks quote text from the file (the first line, a link target, a path): masked values must not leak there.
test('secrets: masked values never leak through the import, links or paths messages', () => {
  const cases = [
    { 'CLAUDE.md': `api_key = ${FAKE}\n@AGENTS.md\n` },
    { 'AGENTS.md': `${baseFiles()['AGENTS.md']}\nSee [x](docs/setup.md?token=${FAKE}).\n` },
    { 'AGENTS.md': `${baseFiles()['AGENTS.md']}\nSee \`docs/sk-${FAKE}\`.\n` },
  ];
  const checks = ['import', 'links', 'paths'];
  cases.forEach((overrides, i) => {
    for (const flags of [[], ['--json']]) {
      const r = run(fixture(overrides), flags);
      assert.equal(r.status, 1, r.all);
      assert.ok(!r.all.includes(FAKE), `${checks[i]} ${flags.join(' ')} leaked the value: ${r.all}`);
      assert.ok(r.all.includes(checks[i]), `${checks[i]} check did not report: ${r.all}`);
      assert.ok(r.all.includes('[masked]'), r.all);
    }
  });
});

test('secrets: quoted values on the first line of CLAUDE.md are masked in text and --json', () => {
  const lines = [`password = "${FAKE}"`, `password = '${FAKE}'`, `token: "${FAKE}"`, `api_key = "${FAKE}"`, `secret: '${FAKE}'`];
  for (const line of lines) {
    for (const flags of [[], ['--json']]) {
      const r = run(fixture({ 'CLAUDE.md': `${line}\n@AGENTS.md\n` }), flags);
      assert.equal(r.status, 1, r.all);
      assert.ok(!r.all.includes(FAKE), `${line} ${flags.join(' ')} leaked the value: ${r.all}`);
      assert.ok(r.all.includes('import') && r.all.includes('[masked]'), r.all);
    }
  }
});

test('secrets: a file name that holds a key is masked; task-<20 alnum> is not a key', () => {
  const noFm = '# no frontmatter\n';
  for (const flags of [[], ['--json']]) {
    const r = run(fixture({ [`.claude/skills/sk-${FAKE}/SKILL.md`]: noFm }), flags);
    assert.equal(r.status, 1, r.all);
    assert.ok(r.all.includes('frontmatter'), r.all);
    assert.ok(!r.all.includes(FAKE), `file name leaked the key ${flags.join(' ')}: ${r.all}`);
    assert.ok(r.all.includes('.claude/skills/[masked]/SKILL.md'), r.all);
    const plain = run(fixture({ [`.claude/skills/task-${FAKE}/SKILL.md`]: noFm }), flags);
    assert.equal(plain.status, 1, plain.all);
    assert.ok(plain.all.includes(`.claude/skills/task-${FAKE}/SKILL.md`), `a file name was masked ${flags.join(' ')}: ${plain.all}`);
    assert.ok(!plain.all.includes('[masked]'), plain.all);
  }
});

// 9. base and --base
test('base: the always-loaded total over its budget fails, though every file is under its own', () => {
  const big = 'x'.repeat(3500);
  const agents = `${baseFiles()['AGENTS.md']}${big}\n`;
  expectOk({ 'AGENTS.md': agents, 'docs/notes.md': `${big}\n` });
  const r = expectFail(
    { 'AGENTS.md': agents, 'CLAUDE.md': '@AGENTS.md\n@docs/notes.md\n', 'docs/notes.md': `${big}\n` },
    'base',
    `every session loads \\d+ bytes from this repository, budget ${BUDGETS.base}`,
  );
  assert.doesNotMatch(r.err, /^FAIL budget: /m, r.all);
});

test('--base: CLAUDE.md, imports relative to the importer, AGENTS.md and rules without paths, largest first', () => {
  const dir = fixture({
    'CLAUDE.md': '@AGENTS.md\nSee @docs/a.md and `@docs/code.md` in code.\n```\n@docs/fenced.md\n```\n@~/.claude/mine.md\n@../outside.md\n',
    'AGENTS.md': `${baseFiles()['AGENTS.md']}${'x'.repeat(150)}\n`,
    '.claude/CLAUDE.md': '@../docs/c.md\n',
    'docs/a.md': `@b.md\n${'a'.repeat(300)}\n`,
    'docs/b.md': `${'b'.repeat(200)}\n`,
    'docs/c.md': `${'c'.repeat(100)}\n`,
    'docs/code.md': 'never loaded\n',
    'docs/fenced.md': 'never loaded\n',
    '.claude/rules/always.md': '---\ndescription: x\n---\nAlways.\n',
  });
  const r = run(dir, ['--base']);
  assert.equal(r.status, 0, r.all);
  const listed = r.out
    .split('\n')
    .slice(1)
    .map((l) => l.trim().replace(/^\d+\s+/, ''))
    .filter(Boolean);
  assert.deepEqual(listed, [
    'docs/a.md (imported by CLAUDE.md)',
    'AGENTS.md (imported by CLAUDE.md)',
    'docs/b.md (imported by docs/a.md)',
    'CLAUDE.md',
    'docs/c.md (imported by .claude/CLAUDE.md)',
    '.claude/rules/always.md (a rule without paths:)',
    '.claude/CLAUDE.md',
  ]);
  assert.match(r.out, new RegExp(`^check-agent-docs --base: every session loads \\d+ bytes from this repository, target ${BUDGETS.base}$`, 'm'));
  assert.equal(run(dir).status, 1, 'the checks still fail the rule without paths: --base is a report');
});

test('--base: imports go five hops deep and no further', () => {
  const chain = {};
  for (let i = 1; i <= 6; i += 1) chain[`docs/d${i}.md`] = `@d${i + 1}.md\n`;
  const r = run(fixture({ 'CLAUDE.md': '@AGENTS.md\n@docs/d1.md\n', ...chain }), ['--base', '--json']);
  const files = JSON.parse(r.out).files.map((f) => f.file);
  assert.ok(files.includes('docs/d5.md'), files.join(' '));
  assert.ok(!files.includes('docs/d6.md'), files.join(' '));
});

test('--base: an import first met at the depth limit is still followed when a shallower path reaches it', () => {
  // d1 > d2 > d3 > d4 > shared is five hops (recorded, not followed); CLAUDE.md then imports shared directly.
  const files = {
    'CLAUDE.md': '@AGENTS.md\n@docs/d1.md\n@docs/shared.md\n',
    'docs/d1.md': '@d2.md\n',
    'docs/d2.md': '@d3.md\n',
    'docs/d3.md': '@d4.md\n',
    'docs/d4.md': '@shared.md\n',
    'docs/shared.md': '@deep.md\nShared.\n',
    'docs/deep.md': 'Deep.\n',
  };
  const listed = JSON.parse(run(fixture(files), ['--base', '--json']).out).files;
  const via = Object.fromEntries(listed.map((f) => [f.file, f.via]));
  assert.equal(via['docs/deep.md'], 'imported by docs/shared.md', JSON.stringify(via));
  assert.equal(via['docs/shared.md'], 'imported by docs/d4.md', 'a file keeps the first path that reached it');
  assert.equal(listed.filter((f) => f.file === 'docs/shared.md').length, 1, 'a file is counted once');
  // An import cycle ends.
  const cycle = run(fixture({ 'CLAUDE.md': '@AGENTS.md\n@docs/a.md\n', 'docs/a.md': '@b.md\n', 'docs/b.md': '@a.md\n' }), ['--base']);
  assert.equal(cycle.status, 0, cycle.all);
});

test('--base --json: the files, their total, the target and the excess', () => {
  const r = run(fixture({ 'CLAUDE.md': '@AGENTS.md\n@docs/notes.md\n', 'docs/notes.md': `${'n'.repeat(7000)}\n` }), ['--base', '--json']);
  assert.equal(r.status, 0, r.all);
  const parsed = JSON.parse(r.out);
  assert.equal(parsed.total, parsed.files.reduce((n, f) => n + f.bytes, 0));
  assert.equal(parsed.target, BUDGETS.base);
  assert.equal(parsed.over, parsed.total - BUDGETS.base);
  assert.ok(parsed.over > 0);
  assert.deepEqual(Object.keys(parsed.files[0]).sort(), ['bytes', 'file', 'via']);
});

test('base: an install with a null base budget skips the check, and --base says no target is set', () => {
  const script = withConfig(`, base: ${BUDGETS.base} }`, ', base: null }');
  const dir = fixture({ 'CLAUDE.md': '@AGENTS.md\n@docs/notes.md\n', 'docs/notes.md': `${'n'.repeat(7000)}\n` });
  assert.equal(run(dir).status, 1, 'the shipped copy fails the base');
  assert.equal(run(dir, [], script).status, 0);
  assert.match(run(dir, ['--base'], script).out, /no target set \(budgets\.base\)/);
});

test('base: --base and --base --json with a null or a missing base budget print no target and no excess', () => {
  const dir = fixture({ 'CLAUDE.md': '@AGENTS.md\n@docs/notes.md\n', 'docs/notes.md': `${'n'.repeat(7000)}\n` });
  for (const base of ['null', undefined]) {
    const script = withConfig(BUDGETS_LINE, budgetsLine({ base }));
    const text = run(dir, ['--base'], script);
    assert.equal(text.status, 0, text.all);
    assert.match(text.out, /no target set \(budgets\.base\)/, `base ${base}: ${text.out}`);
    assert.doesNotMatch(text.out, /over the target/, `base ${base}: ${text.out}`);
    const json = JSON.parse(run(dir, ['--base', '--json'], script).out);
    assert.equal(json.target, null, `base ${base}: target ${json.target}`);
    assert.equal(json.over, null, `base ${base}: over ${json.over}`);
  }
  // Missing is a mistake the full run reports once; null is a choice it does not.
  const full = run(dir, [], withConfig(BUDGETS_LINE, budgetsLine({ base: undefined })));
  assert.deepEqual(full.err.match(/^FAIL .*$/gm), ['FAIL budget: CONFIG.budgets.base is missing - set a number, or null to turn it off'], full.all);
});

// 10. citations
// An AGENTS.md with the shapes citations name: headings with a tail after a comma, a bold lead with a dash, a table's bold cell.
const CITED_AGENTS = `${baseFiles()['AGENTS.md']}
## Owner stops, and what is not one

**Fix rounds - the review gate decides.** Keep handlers thin.

## Context budget and reporting

| **Spec** | a change to docs |
`;
const RULE_HEAD = '---\npaths:\n  - "src/db/**"\n---\n\n';
const checksIn = (r) => Number(r.out.match(/\((\d+) checks\)/)?.[1]);

test('citations: every form that names a section AGENTS.md has passes, and each cited name is one check', () => {
  const plain = expectOk({ 'AGENTS.md': CITED_AGENTS });
  const cited = expectOk({
    'AGENTS.md': CITED_AGENTS,
    // the section, an abbreviation, the name and more words, a quoted name, a quoted phrase, a parenthesis (7)
    '.claude/rules/db.md': `${RULE_HEAD}Per \`AGENTS.md\` › Area rules, use the helpers (\`AGENTS.md\` › Owner stops).\nSee \`AGENTS.md\` › Context; \`AGENTS.md\` › Fix rounds apply here.\nAGENTS.md "Owner stops" and AGENTS.md's "keep handlers thin", as \`AGENTS.md\` (Spec) says.\n`,
    // a path, a sibling, a quoted name after a parenthesis, a wrapped `›` and a wrapped quote (6)
    'src/index.js': '// `AGENTS.md` › Area rules › Spec, Owner stops.\n/* AGENTS.md ("Context budget and reporting") and `AGENTS.md` ›\n * Context, read together. AGENTS.md\n * "Fix rounds" too.\n */\nexport {};\n',
  });
  assert.equal(checksIn(cited) - checksIn(plain), 13, cited.out);
});

test('citations: a section AGENTS.md no longer has fails at each citing line, in a rule, a skill, an agent and code', () => {
  const renamed = CITED_AGENTS.replace('## Owner stops, and what is not one', '## Owner gates');
  const r = expectFail(
    {
      'AGENTS.md': renamed,
      '.claude/rules/db.md': `${RULE_HEAD}Stop per \`AGENTS.md\` › Owner stops.\n`,
      '.claude/skills/demo/SKILL.md': '---\nname: demo\ndescription: Demo\n---\n\n# Demo\n\nSee `AGENTS.md` › Owner stops, Context.\n',
      '.claude/agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\n---\n\nAs `AGENTS.md` (Owner stops) says.\n',
      'src/index.js': 'export {};\n// AGENTS.md › Owner stops: never ask twice\n',
    },
    'citations',
    '\\.claude/rules/db\\.md:6 cites `AGENTS\\.md` › Owner stops, which names no heading',
  );
  assert.match(r.err, /^FAIL citations: \.claude\/skills\/demo\/SKILL\.md:8 cites `AGENTS\.md` › Owner stops,/m);
  assert.match(r.err, /^FAIL citations: \.claude\/agents\/reviewer\.md:7 cites `AGENTS\.md` › Owner stops,/m);
  assert.match(r.err, /^FAIL citations: src\/index\.js:2 cites `AGENTS\.md` › Owner stops,/m);
  assert.equal(r.err.match(/^FAIL citations: /gm).length, 4, 'Context still holds');
});

test('citations: a quoted name or phrase AGENTS.md no longer has fails, part by part', () => {
  const r = expectFail(
    { 'AGENTS.md': CITED_AGENTS, 'src/index.js': '// AGENTS.md "Deploy order" and AGENTS.md "Area rules → Gone".\nexport {};\n' },
    'citations',
    'src/index\\.js:1 cites "Deploy order", which AGENTS\\.md no longer has',
  );
  assert.match(r.err, /^FAIL citations: src\/index\.js:1 cites "Gone",/m);
  assert.doesNotMatch(r.err, /cites "Area rules"/);
});

test('citations: other files, imports, string literals, § references, prose, code blocks and exempt files are not read', () => {
  expectOk({
    'AGENTS.md': CITED_AGENTS,
    '.claude/rules/db.md': `${RULE_HEAD}\`apps/web/AGENTS.md\` › Gone. \`AGENTS.md\` › gone in lowercase. AGENTS.md: Gone. AGENTS.md Gone.\n\n\`\`\`text\n\`AGENTS.md\` › Gone\n\`\`\`\n`,
    'src/index.js': 'const FILES = ["AGENTS.md", "Gone"];\n// `AGENTS.md` (TRD §13.5) and docs/AGENTS.md "Gone"\nexport { FILES };\n',
    'apps/web/AGENTS.md': '# Web\n',
    'scripts/x.py': '# `AGENTS.md` › Gone\n',
    'scripts/check-agent-docs.mjs': '// `AGENTS.md` › Gone\n',
  });
});

test('citations: a sibling or a lower level that is gone fails; an install without citeFiles reads only the instruction files', () => {
  const files = {
    'AGENTS.md': CITED_AGENTS,
    'CLAUDE.md': '@AGENTS.md\n\n`AGENTS.md` › Area rules, Gone, read with `AGENTS.md` › Area rules › Missing.\n',
    'src/index.js': '// `AGENTS.md` › Gone\nexport {};\n',
  };
  const r = expectFail(files, 'citations', 'CLAUDE\\.md:3 cites `AGENTS\\.md` › Gone,');
  assert.match(r.err, /^FAIL citations: CLAUDE\.md:3 cites `AGENTS\.md` › Missing,/m);
  assert.match(r.err, /^FAIL citations: src\/index\.js:1 /m);
  const script = withConfig("  citeFiles: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],\n", '');
  const bare = run(fixture(files), [], script);
  assert.equal(bare.status, 1, bare.all);
  assert.equal(bare.err.match(/^FAIL citations: CLAUDE\.md:3 /gm).length, 2, bare.all);
  assert.doesNotMatch(bare.err, /src\/index\.js/);
});

test('citations: a citeFiles glob that matches a directory symlink or a submodule is skipped, never a crash', () => {
  // `vendor/pdf.js` is a directory symlink and `vendor/lib.js` a gitlink: git lists each as one entry.
  const after = (dir) => {
    mkdirSync(join(dir, 'vendor/lib.js'), { recursive: true });
    // The gitlink is mandatory and its id has the repo's own length (40 hex for sha1, 64 for sha256).
    const format = execFileSync('git', ['rev-parse', '--show-object-format'], { cwd: dir, env: ENV, encoding: 'utf8' }).trim();
    const id = 'a'.repeat(format === 'sha256' ? 64 : 40);
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `160000,${id},vendor/lib.js`], { cwd: dir, env: ENV });
    try {
      symlinkSync('../src', join(dir, 'vendor/pdf.js'));
    } catch {
      // symlinks may be unavailable (Windows without privileges); the gitlink still counts
    }
  };
  const files = { 'AGENTS.md': CITED_AGENTS, 'src/index.js': '// AGENTS.md "Deploy order"\nexport {};\n' };
  const r = expectFail(files, 'citations', 'src/index\\.js:1 cites "Deploy order"', after);
  assert.doesNotMatch(r.all, /EISDIR|at .*\.mjs/, r.all);
  const clean = run(fixture({ 'AGENTS.md': CITED_AGENTS }, after));
  assert.equal(clean.status, 0, clean.all);
  assert.doesNotMatch(clean.all, /EISDIR|at .*\.mjs/, clean.all);
});

// --rules-for
test('--rules-for: prints the rule files whose globs match', () => {
  const dir = fixture({ '.claude/rules/docs.md': '---\npaths:\n  - "docs/**/*.md"\n---\nx\n', 'AGENTS.md': `${baseFiles()['AGENTS.md']}- \`docs.md\` — docs.\n` });
  const r = run(dir, ['--rules-for', 'src/db/schema.js', 'src/index.js']);
  assert.equal(r.status, 0);
  assert.equal(r.out, '.claude/rules/db.md\n');
  const both = run(dir, ['--rules-for', 'src/db/schema.js', 'docs/guide.md']);
  assert.equal(both.out, '.claude/rules/db.md\n.claude/rules/docs.md\n');
});

test('--rules-for: prints nothing and exits 0 when nothing matches', () => {
  const r = run(fixture(), ['--rules-for', 'src/index.js', 'README.md']);
  assert.equal(r.status, 0);
  assert.equal(r.out, '');
  const none = run(fixture(), ['--rules-for']);
  assert.equal(none.status, 0);
  assert.equal(none.out, '');
});

test('--rules-for: accepts absolute paths and ignores paths outside the repo', () => {
  const dir = fixture();
  const r = run(dir, ['--rules-for', join(dir, 'src/db/schema.js')]);
  assert.equal(r.out, '.claude/rules/db.md\n');
  const outside = run(dir, ['--rules-for', join(tmpdir(), 'src/db/schema.js')]);
  assert.equal(outside.out, '');
});

test('--rules-for: does not run the checks (a failing repo still exits 0)', () => {
  const dir = fixture({ 'CLAUDE.md': '# no import\n' });
  assert.equal(run(dir).status, 1);
  assert.equal(run(dir, ['--rules-for', 'src/db/schema.js']).status, 0);
});

// --json
test('--json: ok on a clean repo', () => {
  const r = run(fixture(), ['--json']);
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(JSON.parse(r.out), { ok: true, failures: [] });
});

test('--json: failures carry check, file, line and detail', () => {
  const r = run(fixture({ 'AGENTS.md': `${baseFiles()['AGENTS.md']}\nSee [gone](docs/gone.md).\n` }), ['--json']);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.out);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.failures.length, 1);
  assert.deepEqual(Object.keys(parsed.failures[0]).sort(), ['check', 'detail', 'file', 'line']);
  assert.equal(parsed.failures[0].check, 'links');
  assert.equal(parsed.failures[0].file, 'AGENTS.md');
  assert.equal(parsed.failures[0].line, 7);
});

// run from a subdirectory and outside a repo
test('runs from the repo root even when started in a subdirectory', () => {
  const dir = fixture();
  const r = run(join(dir, 'src'));
  assert.equal(r.status, 0, r.all);
});

test('outside a git repository: fails the check, but --rules-for just prints nothing', () => {
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'check-agent-docs-nogit-'))));
  const copy = join(dir, 'check-agent-docs.mjs');
  copyFileSync(SCRIPT, copy);
  const env = { ...ENV, GIT_CEILING_DIRECTORIES: dirname(dir) };
  const r = spawnSync(process.execPath, [copy], { cwd: dir, encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^FAIL root: /m);
  const rf = spawnSync(process.execPath, [copy, '--rules-for', 'x'], { cwd: dir, encoding: 'utf8', env });
  assert.equal(rf.status, 0);
  assert.equal(rf.stdout, '');
});

// arguments: --help prints the usage; an unknown flag is a usage error, never a lint run
test('--help and -h print the usage on stdout and exit 0, even outside a git repository', () => {
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'check-agent-docs-help-'))));
  const copy = join(dir, 'check-agent-docs.mjs');
  copyFileSync(SCRIPT, copy);
  const env = { ...ENV, GIT_CEILING_DIRECTORIES: dirname(dir) };
  for (const flag of ['--help', '-h']) {
    const r = spawnSync(process.execPath, [copy, flag], { cwd: dir, encoding: 'utf8', env });
    assert.equal(r.status, 0, `${flag}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /^usage: node scripts\/check-agent-docs\.mjs \[--json\] \[--base\] \| --rules-for <file\.\.\.>\n$/);
  }
});

test('an unknown flag is a usage error with exit 2, and no check runs', () => {
  const r = run(fixture(), ['--bogus']);
  assert.equal(r.status, 2, r.all);
  assert.match(r.err, /^check-agent-docs: unknown option --bogus$/m);
  assert.match(r.err, /^usage: node scripts\/check-agent-docs\.mjs /m);
  assert.doesNotMatch(r.all, /FAIL|OK \(/);
  assert.equal(r.out, '');
});

test('a bare word before --rules-for is a usage error; the paths after --rules-for are still paths', () => {
  const dir = fixture();
  const r = run(dir, ['stray']);
  assert.equal(r.status, 2, r.all);
  assert.match(r.err, /^check-agent-docs: unexpected argument stray$/m);
  const ok = run(dir, ['--json', '--rules-for', 'src/db/schema.js', '--not-a-path', 'other.txt']);
  assert.equal(ok.status, 0, ok.all);
  assert.equal(ok.out, '.claude/rules/db.md\n');
});
