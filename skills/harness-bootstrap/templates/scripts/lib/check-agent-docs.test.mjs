// harness-bootstrap check-agent-docs tests (generated YYYY-MM-DD). Run: node --test <this file>
// [M] mechanism: ships as-is next to check-agent-docs.mjs. Fixtures are temp git repos; the shipped
// script runs with cwd = fixture. Only the CONFIG block ([B]) is ever substituted, never the checks.
// The budgets are fixed here (BUDGETS), so the suite passes whatever budgets an install ratcheted the script to.
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
  rmSync,
} from 'node:fs';
import { tmpdir, devNull } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHIPPED =
  process.env.CHECK_AGENT_DOCS_SCRIPT || join(dirname(fileURLToPath(import.meta.url)), '..', 'check-agent-docs.mjs');

// The [B] budgets the suite runs under. Small, so over-budget fixtures stay small; skillLines is the shipped default.
const BUDGETS = { agents: 4096, claude: 1024, rule: 2048, skillLines: 500, stateFile: 1024 };
const BUDGETS_LINE = `budgets: { 'AGENTS.md': ${BUDGETS.agents}, 'CLAUDE.md': ${BUDGETS.claude}, rule: ${BUDGETS.rule}, skillLines: ${BUDGETS.skillLines}, stateFile: ${BUDGETS.stateFile} },`;

// Hermetic: no developer HOME, global or system git config reaches a fixture.
const ENV = {
  ...process.env,
  HOME: realpathSync(mkdtempSync(join(tmpdir(), 'check-agent-docs-home-'))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete ENV[k];

// The script under test: the shipped one with only the CONFIG `budgets` line set to BUDGETS (removed after the file).
const SCRIPT_DIR = realpathSync(mkdtempSync(join(tmpdir(), 'check-agent-docs-script-')));
const SCRIPT = join(SCRIPT_DIR, 'check-agent-docs.mjs');
{
  const text = readFileSync(SHIPPED, 'utf8');
  const line = /^[ \t]*budgets: \{[^}\n]*\},?[ \t]*$/m;
  assert.ok(line.test(text), 'the CONFIG budgets line was not found in the script');
  writeFileSync(SCRIPT, text.replace(line, `  ${BUDGETS_LINE}`));
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

test('budget: a SKILL.md over its line budget fails and exactly the budget passes', () => {
  const head = '---\nname: demo\ndescription: Demo\n---\n';
  const body = (n) => `${head}${'line\n'.repeat(n - 4)}`;
  const max = BUDGETS.skillLines;
  expectOk({ '.claude/skills/demo/SKILL.md': body(max) });
  expectFail({ '.claude/skills/demo/SKILL.md': body(max + 1) }, 'budget', `SKILL\\.md ${max + 1} lines, budget ${max}`);
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
  const cases = [
    ['api_key = abcdefghijklmnop1234', 'abcdefghijklmnop1234'],
    ['AWS AKIAABCDEFGHIJKLMNOP here', 'AKIAABCDEFGHIJKLMNOP'],
    ['key sk-abcdefghijklmnopqrstuvwxyz', 'sk-abcdefghijklmnopqrstuvwxyz'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'BEGIN RSA PRIVATE KEY'],
    ['Password: "hunter2hunter2hunter2"', 'hunter2hunter2hunter2'],
  ];
  for (const [line, secret] of cases) {
    const r = expectFail({ 'CLAUDE.md': `@AGENTS.md\n${line}\n` }, 'secrets', 'CLAUDE\\.md:2 ');
    assert.ok(!r.all.includes(secret), `output leaked ${secret}`);
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
