/**
 * Tests for skills/harness-bootstrap and skills/delegate-tasks (biji-dev/ecc-js):
 * skill structure, the shipped commit guard, and the context-budget hook template.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BOOTSTRAP = path.join(ROOT, 'skills', 'harness-bootstrap');
const DELEGATE = path.join(ROOT, 'skills', 'delegate-tasks');
const GUARD = path.join(BOOTSTRAP, 'templates', 'harness-guard.sh');
const BUDGET = path.join(BOOTSTRAP, 'templates', 'context-budget.mjs');

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

function frontmatter(file) {
  const match = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${file} has frontmatter`);
  const fields = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return fields;
}

/** Every `reference/<x>.md` or `templates/<x>` a skill's markdown names must exist, and every file must be named. */
function checkReferences(skillDir) {
  const docs = [path.join(skillDir, 'SKILL.md')];
  const refDir = path.join(skillDir, 'reference');
  if (fs.existsSync(refDir)) for (const f of fs.readdirSync(refDir)) docs.push(path.join(refDir, f));
  const text = docs.map(f => fs.readFileSync(f, 'utf8')).join('\n');

  const shipped = [];
  for (const sub of ['reference', 'templates']) {
    const dir = path.join(skillDir, sub);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) shipped.push(`${sub}/${f}`);
  }
  for (const rel of shipped) {
    assert.ok(text.includes(path.basename(rel)), `${rel} is never named — orphaned`);
  }
  const named = new Set();
  for (const m of text.matchAll(/`(?:reference\/|templates\/)?([a-z][a-z0-9-]*\.(?:md|sh|mjs))`/g)) named.add(m[1]);
  for (const name of named) {
    if (name === 'SKILL.md' || /^(AGENTS|CLAUDE|README)\.md$/.test(name)) continue;
    const exists = shipped.some(rel => path.basename(rel) === name);
    // Names of files the harness *generates* in a target project are not shipped here.
    const generated = ['context-budget.mjs', 'harness-guard.sh', 'registry.md', 'plan-conformance-auditor.md', 'claim-auditor.md'];
    if (!exists && !generated.includes(name)) {
      assert.fail(`${name} is named but not shipped in ${path.basename(skillDir)}`);
    }
  }
}

// ── structure ────────────────────────────────────────────────────────────────

console.log('\nharness skills: structure');

for (const [dir, name] of [[BOOTSTRAP, 'harness-bootstrap'], [DELEGATE, 'delegate-tasks']]) {
  test(`${name}: frontmatter names the skill and fits the 1024-char description limit`, () => {
    const fm = frontmatter(path.join(dir, 'SKILL.md'));
    assert.strictEqual(fm.name, name);
    assert.ok(fm.description && fm.description.length > 50, 'description present');
    assert.ok(fm.description.length <= 1024, `description is ${fm.description.length} chars`);
  });

  test(`${name}: has When to Use, How It Works and Examples sections`, () => {
    const body = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    for (const heading of ['## When to Use', '## How It Works', '## Examples']) {
      assert.ok(body.includes(heading), `missing ${heading}`);
    }
  });

  test(`${name}: every referenced file ships and no shipped file is orphaned`, () => {
    checkReferences(dir);
  });

  test(`${name}: names no machine path and no GLM default`, () => {
    const files = [path.join(dir, 'SKILL.md')];
    const refDir = path.join(dir, 'reference');
    if (fs.existsSync(refDir)) for (const f of fs.readdirSync(refDir)) files.push(path.join(refDir, f));
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!/\/Users\/|\/home\/[a-z]/.test(text), `${path.basename(file)} names a machine path`);
    }
    const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    assert.ok(!/GLM|Flash/.test(skill), 'SKILL.md defaults to a non-Claude model');
  });
}

test('both skills are listed as own skills in fork/slim.json', () => {
  const slim = JSON.parse(fs.readFileSync(path.join(ROOT, 'fork', 'slim.json'), 'utf8'));
  for (const name of ['harness-bootstrap', 'delegate-tasks']) {
    assert.ok(slim.skills.own.includes(name), `${name} not in skills.own`);
  }
});

// ── the commit guard ────────────────────────────────────────────────────────

console.log('\nharness skills: commit guard (the shipped file)');

const hasGit = spawnSync('git', ['--version']).status === 0;

function git(cwd, args, extra = {}) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', ...extra });
}

/** A repo whose pre-commit hook is the guard text given (the shipped file by default). */
function guardedRepo(guardText = fs.readFileSync(GUARD, 'utf8'), { trackRegistry = false } = {}) {
  const dir = tmp('harness-guard-');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(dir, '.githooks'));
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.githooks', 'pre-commit'), guardText, { mode: 0o755 });
  git(dir, ['config', 'core.hooksPath', '.githooks']);
  if (!trackRegistry) fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/registry.md\n');
  setRegistry(dir, '');
  git(dir, ['add', '-A']);
  const init = git(dir, ['commit', '-qm', 'init']);
  assert.strictEqual(init.status, 0, `init commit failed: ${init.stderr}`);
  return dir;
}

function setRegistry(dir, rows) {
  fs.writeFileSync(
    path.join(dir, '.claude', 'registry.md'),
    [
      '# Registry',
      '<!-- harness:active -->',
      '| # | Task | Step | Branch | Claimed (UTC) |',
      '|---|---|---|---|---|',
      '| 0 | mainline | | | |',
      rows,
      '<!-- /harness:active -->',
      '',
      '| 3000 | T-ZZ-9 port range | |',
      ''
    ].join('\n')
  );
}

function tryCommit(dir) {
  fs.appendFileSync(path.join(dir, 'work.txt'), 'x\n');
  git(dir, ['add', 'work.txt']);
  const result = git(dir, ['commit', '-qm', 'work']);
  if (result.status !== 0) git(dir, ['reset', '-q']);
  return result;
}

const HELD = '| 1 | `T-AB-12` | 2 | task/T-AB-12-thing | 2026-10-09T10:00Z |';

/** The four cases the guard exists for, as [label, setup, expectAllowed]. */
const CASES = [
  ['mainline, no rows held → allow', dir => setRegistry(dir, ''), true],
  ['mainline while a run holds a row → refuse', dir => setRegistry(dir, HELD), false],
  ['the owning task branch → allow', dir => { git(dir, ['switch', '-qc', 'task/T-AB-12-thing']); setRegistry(dir, HELD); }, true],
  ['a foreign task branch whose id appears only outside the active section → refuse', dir => { git(dir, ['switch', '-qc', 'task/T-ZZ-9-other']); setRegistry(dir, HELD); }, false]
];

if (!hasGit) {
  console.log('  - skipped: git is not available');
} else {
  for (const [label, setup, allowed] of CASES) {
    test(label, () => {
      const dir = guardedRepo();
      setup(dir);
      const result = tryCommit(dir);
      assert.strictEqual(result.status === 0, allowed, `status ${result.status}: ${result.stderr.trim()}`);
      if (!allowed) assert.match(result.stderr, /harness guard: REFUSE/);
    });
  }

  test('id pattern takes the whole multi-part id and only the first id of a range branch', () => {
    const pattern = fs.readFileSync(GUARD, 'utf8').match(/^ID_PATTERN='([^']+)'/m)[1];
    const re = new RegExp(pattern);
    const cases = { 'task/T-AB-12-thing': 'T-AB-12', 'segment/P0-12-P0-11': 'P0-12', 'x/T-SEC-030b-edge': 'T-SEC-030b', 'T-I18N-003': 'T-I18N-003' };
    for (const [branch, id] of Object.entries(cases)) {
      assert.strictEqual((branch.match(re) || [])[0], id, branch);
    }
  });

  test('a linked worktree reads the lock held in the main checkout', () => {
    const dir = guardedRepo();
    const wt = `${dir}-wt`;
    assert.strictEqual(git(dir, ['worktree', 'add', '-q', wt, '-b', 'task/T-QQ-1-wt']).status, 0);
    try {
      assert.notStrictEqual(tryCommit(wt).status, 0, 'refused before its row is claimed');
      setRegistry(dir, '| 1 | `T-QQ-1` | 1 | task/T-QQ-1-wt | 2026-10-09T11:00Z |');
      const allowed = tryCommit(wt);
      assert.strictEqual(allowed.status, 0, allowed.stderr);
    } finally {
      git(dir, ['worktree', 'remove', '--force', wt]);
    }
  });

  test('a tracked registry: the release commit is allowed, other commits after release are not', () => {
    const dir = guardedRepo(undefined, { trackRegistry: true });
    git(dir, ['switch', '-qc', 'task/T-AB-12-thing']);
    setRegistry(dir, HELD);
    git(dir, ['add', '.claude/registry.md']);
    assert.strictEqual(git(dir, ['commit', '-qm', 'claim']).status, 0, 'claim commit');
    setRegistry(dir, '');
    git(dir, ['add', '.claude/registry.md']);
    const release = git(dir, ['commit', '-qm', 'release']);
    assert.strictEqual(release.status, 0, release.stderr);
    assert.notStrictEqual(tryCommit(dir).status, 0, 'work after release is refused');
  });

  test('mutation: with the refuse logic removed, the refusing cases go green (the tests can fail)', () => {
    const mutant = fs.readFileSync(GUARD, 'utf8').replace(/exit 1\n/, 'exit 0\n');
    assert.notStrictEqual(mutant, fs.readFileSync(GUARD, 'utf8'), 'mutation applied');
    for (const [label, setup, allowed] of CASES.filter(c => !c[2])) {
      const dir = guardedRepo(mutant);
      setup(dir);
      assert.strictEqual(tryCommit(dir).status, 0, `mutant still refused: ${label}`);
      assert.strictEqual(allowed, false);
    }
  });
}

// ── the context-budget hook ─────────────────────────────────────────────────

console.log('\nharness skills: context-budget hook template');

function transcript(tokens, extra = []) {
  const dir = tmp('ctx-budget-');
  const file = path.join(dir, 't.jsonl');
  const lines = [
    { type: 'user', message: { content: 'hi' } },
    { type: 'assistant', message: { model: 'claude-opus', usage: { input_tokens: 10, cache_read_input_tokens: tokens - 10, cache_creation_input_tokens: 0 } } },
    ...extra
  ];
  fs.writeFileSync(file, `${lines.map(l => JSON.stringify(l)).join('\n')}\n`);
  return file;
}

function runHook(event, file, raw) {
  const input = raw ?? JSON.stringify({ hook_event_name: event, transcript_path: file });
  const env = { ...process.env };
  delete env.CONTEXT_BUDGET_WARN;
  delete env.CONTEXT_BUDGET_LIMIT;
  const result = spawnSync(process.execPath, [BUDGET], { input, encoding: 'utf8', env });
  return { status: result.status, out: result.stdout ? JSON.parse(result.stdout) : null };
}

test('under the warning budget: the model gets the figure, Stop prints nothing', () => {
  const file = transcript(249_000);
  const prompt = runHook('UserPromptSubmit', file);
  assert.strictEqual(prompt.status, 0);
  assert.match(prompt.out.hookSpecificOutput.additionalContext, /~249K \(under 250K\)/);
  assert.strictEqual(runHook('Stop', file).out, null);
});

test('past the warning budget: Stop tells the user to plan a compaction', () => {
  const { status, out } = runHook('Stop', transcript(251_000));
  assert.strictEqual(status, 0);
  assert.match(out.systemMessage, /past 250K/);
});

test('past the limit: the model is told to finish the step and hand off', () => {
  const { out } = runHook('UserPromptSubmit', transcript(401_000));
  assert.match(out.hookSpecificOutput.additionalContext, /over the 400K budget/);
});

test('sidechain (subagent) usage is ignored — the main thread figure wins', () => {
  const file = transcript(100_000, [{ type: 'assistant', isSidechain: true, message: { model: 'claude-sonnet', usage: { input_tokens: 900_000 } } }]);
  const { out } = runHook('UserPromptSubmit', file);
  assert.match(out.hookSpecificOutput.additionalContext, /~100K/);
});

test('malformed input or a missing transcript never fails the turn', () => {
  assert.deepStrictEqual(runHook('Stop', null, 'not json'), { status: 0, out: null });
  assert.deepStrictEqual(runHook('Stop', '/nonexistent/t.jsonl'), { status: 0, out: null });
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
