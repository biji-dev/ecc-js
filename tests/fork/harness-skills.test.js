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

/** Every file under a skill's shipped folders, as paths relative to the skill. */
function shippedFiles(skillDir) {
  const out = [];
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(skillDir, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else out.push(child);
    }
  };
  for (const sub of ['reference', 'templates', 'scripts']) {
    if (fs.existsSync(path.join(skillDir, sub))) walk(sub);
  }
  return out;
}

/**
 * Every `reference/…`, `templates/…` or `scripts/…` path a skill's markdown names must ship, and every
 * shipped file must be named somewhere — by its path under `templates/`, or by its basename elsewhere.
 */
function checkReferences(skillDir) {
  const docs = [path.join(skillDir, 'SKILL.md')];
  const refDir = path.join(skillDir, 'reference');
  if (fs.existsSync(refDir)) for (const f of fs.readdirSync(refDir)) docs.push(path.join(refDir, f));
  const text = docs.map(f => fs.readFileSync(f, 'utf8')).join('\n');

  const shipped = shippedFiles(skillDir);
  for (const rel of shipped) {
    const named = rel.startsWith('templates/') ? text.includes(rel) : text.includes(path.basename(rel));
    assert.ok(named, `${rel} is never named — orphaned`);
  }
  // A path under the skill's own folders must exist exactly.
  for (const m of text.matchAll(/`((?:reference|templates)\/[a-z0-9./-]+\.(?:md|sh|mjs|js|json))`/g)) {
    assert.ok(shipped.includes(m[1]), `${m[1]} is named but not shipped in ${path.basename(skillDir)}`);
  }
  // A bare file name must be shipped, or be a file the harness generates in a target project.
  const generated = [
    'context-budget.mjs', 'harness-guard.sh', 'registry.md', 'plan-conformance-auditor.md', 'claim-auditor.md',
    'implementer.md', 'harness-manifest.json', 'command-guard.mjs', 'run-gates.sh', 'codex-run.mjs',
    'check-agent-docs.mjs', 'review.workflow.js', 'settings.json', 'settings.local.json', 'package.json',
    'review-gate.mjs', 'docs-drift.mjs', 'unit-record.mjs'
  ];
  for (const m of text.matchAll(/`([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:md|sh|mjs|js|json))`/g)) {
    const name = m[1];
    if (name === 'SKILL.md' || /^(AGENTS|CLAUDE|README)\.md$/.test(name)) continue;
    const exists = shipped.some(rel => path.basename(rel) === name);
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

  test(`${name}: names no machine path in any shipped file, and no GLM default`, () => {
    const files = [path.join(dir, 'SKILL.md'), ...shippedFiles(dir).map(rel => path.join(dir, rel))];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!/\/Users\/|\/home\/[a-z]/.test(text), `${path.relative(dir, file)} names a machine path`);
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

// A rule is a bold span that opens a line (`**…**` or `- **…**`), wrapped lines joined.
function boldRules(text) {
  return [...text.matchAll(/^\s*(?:- )?\*\*([\s\S]+?)\*\*/gm)].map(m => m[1].replace(/\s+/g, ' ').trim());
}

function rulesBlockMismatch(rulesMd, template) {
  const section = rulesMd.slice(rulesMd.indexOf('## 1 · Ship these'), rulesMd.indexOf('## 2 · '));
  const begin = template.indexOf('<!-- harness:begin rules -->');
  const end = template.indexOf('<!-- harness:end rules -->');
  if (begin < 0 || end < begin) return ['rules markers missing'];
  const want = boldRules(section);
  const have = boldRules(template.slice(begin, end));
  return [
    ...want.filter(r => !have.includes(r)).map(r => `missing: ${r}`),
    ...have.filter(r => !want.includes(r)).map(r => `not in rules.md §1: ${r}`),
  ];
}

test('the rules-block template carries every rules.md §1 rule verbatim, and nothing else in bold', () => {
  const rulesMd = fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'rules.md'), 'utf8');
  const template = fs.readFileSync(path.join(BOOTSTRAP, 'templates', 'agents-rules.md'), 'utf8');
  assert.ok(boldRules(rulesMd).length >= 40, 'rule extraction found too few rules');
  assert.deepStrictEqual(rulesBlockMismatch(rulesMd, template), []);
  // mutant: a template that lost one rule must fail the check
  const dropped = template.replace(/^- \*\*Taste is not a risk tier\.\*\*.*\n/m, '');
  assert.notStrictEqual(dropped, template, 'mutation did not apply');
  assert.deepStrictEqual(rulesBlockMismatch(rulesMd, dropped), ['missing: Taste is not a risk tier.']);
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
  // Hermetic: no developer settings file or window variable moves the limit.
  const env = { ...process.env, HOME: tmp('ctx-budget-home-') };
  for (const key of ['CONTEXT_BUDGET_WARN', 'CONTEXT_BUDGET_LIMIT', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_PROJECT_DIR']) delete env[key];
  const result = spawnSync(process.execPath, [BUDGET], { input, encoding: 'utf8', env });
  return { status: result.status, out: result.stdout ? JSON.parse(result.stdout) : null };
}

test('under the warning budget: the model gets the figure, Stop prints nothing', () => {
  const file = transcript(219_000);
  const prompt = runHook('UserPromptSubmit', file);
  assert.strictEqual(prompt.status, 0);
  assert.match(prompt.out.hookSpecificOutput.additionalContext, /~219K \(under 220K/);
  assert.strictEqual(runHook('Stop', file).out, null);
});

test('past the warning budget: Stop tells the user to plan a compaction', () => {
  const { status, out } = runHook('Stop', transcript(221_000));
  assert.strictEqual(status, 0);
  assert.match(out.systemMessage, /past 220K/);
});

test('past the limit: the model is told to persist state and keep working, never to hand off', () => {
  const { out } = runHook('UserPromptSubmit', transcript(261_000));
  const text = out.hookSpecificOutput.additionalContext;
  assert.match(text, /over the 260K budget/);
  assert.doesNotMatch(text.replace(/never ask for a new session/gi, ''), /new session|hand ?off/i);
});

test('the skill references never tell a run to start a new session', () => {
  for (const file of fs.readdirSync(path.join(BOOTSTRAP, 'reference'))) {
    const text = fs.readFileSync(path.join(BOOTSTRAP, 'reference', file), 'utf8');
    for (const line of text.split('\n')) {
      if (/\b(start|open) a new session\b/i.test(line)) {
        // Only allowed where the line records or forbids it.
        assert.match(line, /never|origin|said|budget rule|reversed|recommended|"start a new session"/i, `${file}: ${line.trim()}`);
      }
    }
  }
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

// ── reference text (js.8) ───────────────────────────────────────────────────

console.log('\nharness skills: reference text (js.8)');

const gateRef = name => fs.readFileSync(path.join(BOOTSTRAP, 'reference', name), 'utf8').replace(/\s+/g, ' ');

test('--writer mixed is a diff the second family wrote part of; Opus and Sonnet together are bounded', () => {
  for (const name of ['runner.md', 'gate-design.md', 'cross-model.md']) {
    const text = gateRef(name);
    assert.ok(/`mixed`[^.;]*second family|second family[^.;]*`mixed`/.test(text), `${name} does not say \`mixed\` is a diff the second family wrote part of`);
    assert.ok(/Opus and Sonnet[^.;]*`bounded`|`bounded`[^.;]*Opus and Sonnet/.test(text), `${name} does not say Opus and Sonnet together are \`bounded\``);
    assert.ok(!text.includes('more than one did'), `${name} still says \`mixed\` "when more than one did"`);
    assert.ok(!text.includes('more than one executor is `mixed`'), `${name} still says a round split between executors is \`mixed\``);
  }
  const design = gateRef('gate-design.md');
  const start = design.indexOf('**One fix brief per area, not per finding.**');
  assert.ok(start >= 0, 'gate-design.md has no fix-brief paragraph');
  const para = design.slice(start, design.indexOf('`[M]`', start));
  assert.ok(!/the review gate then runs with `--writer second`/.test(para), 'the fix-brief paragraph still runs the gate with `--writer second` always');
  assert.ok(para.includes('`bounded`') && para.includes('`mixed`'), 'the fix-brief paragraph does not name `mixed` and `bounded` for the round');
});

test('a P3 batch over critical code that Opus did not write gets the Opus code-reviewer, in gate-design.md and runner.md', () => {
  const notOpus = /not written by Opus|Opus did not write/;
  const design = gateRef('gate-design.md');
  const row = design.slice(design.indexOf('| P3 only |'), design.indexOf('| P2 |', design.indexOf('| P3 only |')));
  assert.ok(row.startsWith('| P3 only |'), 'gate-design.md has no `P3 only` row');
  assert.ok(notOpus.test(row) && row.includes('Opus `code-reviewer`'), 'the `P3 only` row does not give a batch not written by Opus the Opus `code-reviewer`');
  const start = design.indexOf('**P3s never open a fix round.**');
  assert.ok(start >= 0, 'gate-design.md has no P3-batch paragraph');
  const para = design.slice(start, design.indexOf('> Origin', start));
  assert.ok(notOpus.test(para) && para.includes('Opus `code-reviewer`'), 'the P3-batch paragraph does not name the Opus `code-reviewer` for a batch over critical code');
  assert.ok(para.includes('--max-fixed P3'), 'the P3-batch paragraph does not cite `review-gate.mjs --kind fix --max-fixed P3`');
  const runner = gateRef('runner.md');
  const at = runner.indexOf('**The P3 batch** runs once per slice set');
  assert.ok(at >= 0, 'runner.md has no P3-batch bullet');
  const bullet = runner.slice(at, runner.indexOf('- `[M]`', at));
  assert.ok(notOpus.test(bullet) && bullet.includes('Opus `code-reviewer`'), "runner.md's P3-batch bullet does not name the Opus `code-reviewer` for a batch over critical code");
});

test('gate-design.md maps a three-level severity scale to P1 / P2 / P3, and P0 by its row', () => {
  const design = gateRef('gate-design.md');
  const start = design.indexOf('Agents that report CRITICAL / HIGH / MEDIUM / LOW');
  assert.ok(start >= 0, 'gate-design.md has no severity-map sentence');
  const para = design.slice(start, design.indexOf('Severity decides', start));
  assert.ok(para.includes('three-level scale'), 'the severity map does not name a three-level scale');
  for (const need of [/important or warning|warning or important/, /nice-to-have or suggestion|suggestion or nice-to-have/, /P1 \/ P2 \/ P3/]) {
    assert.ok(need.test(para), `the three-level map does not say ${need}`);
  }
  assert.ok(/meets the P0 row is P0/.test(para), 'the severity map does not say a finding that meets the P0 row is P0');
});

test("runner.md's reuse paragraph names NODE_OPTIONS as part of the key", () => {
  const runner = fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'runner.md'), 'utf8').replace(/\s+/g, ' ');
  const start = runner.indexOf('`run-gates.sh` reuses an all-PASS result');
  assert.ok(start >= 0, 'runner.md has no run-gates reuse paragraph');
  const para = runner.slice(start, runner.indexOf('share the cache', start));
  assert.ok(/The key is [^.]*`RUN_GATES_KEY_EXTRA` names and `NODE_OPTIONS`/.test(para), 'the reuse paragraph does not name NODE_OPTIONS as part of the key');
});

test('gate-design.md says the review gate reads tests and instruction files, skips docs alone, and reviews a critical test at Full', () => {
  const design = fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'gate-design.md'), 'utf8').replace(/\s+/g, ' ');
  const start = design.indexOf('`[M]` **What the gate reviews.**');
  assert.ok(start >= 0, 'gate-design.md has no "What the gate reviews" paragraph');
  const para = design.slice(start, design.indexOf('`[M]`', start + 1));
  for (const need of ['tests', "harness's instruction files", '`INSTRUCTIONS`', 'docs alone', 'a weakened test is a weakened control']) {
    assert.ok(para.includes(need), `the "What the gate reviews" paragraph does not name ${need}`);
  }
  assert.ok(/test or an instruction file under a critical path is critical/.test(para), 'the paragraph does not say a test under a critical path is critical');
  assert.ok(/reviewed at Full whatever `--tier` says/.test(para), 'the paragraph does not say such a unit is reviewed at Full whatever --tier says');
});

test('a background run uses the host\'s own background option, never a shell `&`; the guard bullet names codex-background', () => {
  for (const rel of [
    path.join(BOOTSTRAP, 'reference', 'cross-model.md'),
    path.join(DELEGATE, 'reference', 'other-harnesses.md'),
    path.join(DELEGATE, 'SKILL.md'),
  ]) {
    const text = fs.readFileSync(rel, 'utf8').replace(/\s+/g, ' ');
    assert.ok(text.includes("host's own background option"), `${path.relative(ROOT, rel)} does not name the host's own background option`);
    assert.ok(text.includes('never a shell `&`'), `${path.relative(ROOT, rel)} does not say never a shell \`&\``);
  }
  const targets = fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'harness-targets.md'), 'utf8');
  const start = targets.indexOf('- **The command guard**');
  assert.ok(start >= 0, 'harness-targets.md has no command-guard bullet');
  const bullet = targets.slice(start, targets.indexOf('\n- **', start + 1));
  assert.ok(bullet.includes('codex-background'), 'the command-guard bullet does not name codex-background');
});

test('a run with no ledger row or output file did not finish: check what it left before a relaunch', () => {
  const crossModel = fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'cross-model.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(/no row means the run did not finish/i.test(crossModel), 'cross-model.md does not say a missing row means the run did not finish');
  assert.ok(crossModel.includes('`git status`'), 'cross-model.md does not name `git status` before a relaunch');
  assert.ok(!crossModel.includes('never ran: relaunch it'), 'cross-model.md still says "never ran: relaunch it"');
  const other = fs.readFileSync(path.join(DELEGATE, 'reference', 'other-harnesses.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(!other.includes('never appears never ran'), 'other-harnesses.md still says a missing output file "never ran"');
  assert.ok(other.includes('never appears did not finish'), 'other-harnesses.md does not say a launch without an output file did not finish');
});

test('policy-derivation.md holds the one list of the harness\'s own critical paths; SKILL.md cites it', () => {
  const policy = fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'policy-derivation.md'), 'utf8').replace(/\s+/g, ' ');
  const start = policy.indexOf("The harness's own paths");
  assert.ok(start >= 0, "policy-derivation.md has no \"The harness's own paths\" passage");
  const end = policy.indexOf('## ', start);
  const list = policy.slice(start, end < 0 ? undefined : end);
  for (const need of ['commit guard', 'command guard', 'edit guard', '.claude/settings.json', '.codex/hooks.json', '.zcode/config.json', 'run-gates.sh', 'run-counted', 'review-gate', 'critical', 'never-auto']) {
    assert.ok(list.includes(need), `the list of the harness's own paths does not name ${need}`);
  }
  const skill = fs.readFileSync(path.join(BOOTSTRAP, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(/policy-derivation\.md`? [›>] The harness's own paths/.test(skill), "SKILL.md does not cite policy-derivation.md › The harness's own paths");
  assert.ok(!skill.includes('the guard, the command and edit guards and `run-gates.sh`'), 'SKILL.md still repeats its own shorter list');
});

test('scope-guard.md says the follow-ups path may be a list with <dir>/*.md entries, and names the three retro-core bindings of another doc shape', () => {
  const guard = fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'scope-guard.md'), 'utf8').replace(/\s+/g, ' ');
  const start = guard.indexOf('## The follow-ups doc');
  assert.ok(start >= 0, 'scope-guard.md has no "The follow-ups doc" section');
  const end = guard.indexOf(' ## ', start + 1);
  const section = guard.slice(start, end < 0 ? undefined : end);
  for (const need of ['STATUS_COLUMNS', 'STATUS_WORDS', 'SEVERITY_COLUMNS', '/*.md']) {
    assert.ok(section.includes(need), `the follow-ups section of scope-guard.md does not name ${need}`);
  }
});

test('no test source under tests/fork or the templates holds an AWS-key-shaped literal', () => {
  const hits = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(test\.)?(js|mjs)$/.test(entry.name) || entry.name.includes('.test.')) {
        if (/AKIA[0-9A-Z]{16}/.test(fs.readFileSync(full, 'utf8'))) hits.push(path.relative(ROOT, full));
      }
    }
  };
  walk(path.join(ROOT, 'tests', 'fork'));
  walk(path.join(BOOTSTRAP, 'templates'));
  assert.deepStrictEqual(hits, [], `AWS-key-shaped literal in ${hits.join(', ')}`);
});

const squashed = rel => fs.readFileSync(path.join(BOOTSTRAP, rel), 'utf8').replace(/\s+/g, ' ');
const BOUND_PATH = (kind) => `\`REPORTS.${kind}\` in \`harness-due-core.mjs\` (default \`docs/harness/reports/`;

for (const [rel, kind] of [['reference/preflight.md', 'preflight'], ['reference/sweep.md', 'sweep'], ['reference/hygiene.md', 'hygiene']]) {
  test(`${rel} names its report at REPORTS.${kind} in harness-due-core.mjs, with the default`, () => {
    assert.ok(squashed(rel).includes(BOUND_PATH(kind)), `${rel} does not name the report at \`REPORTS.${kind}\` in \`harness-due-core.mjs\` with its default`);
  });
}

test('runner.md "No queue is stored" names the reports at REPORTS.<kind> in harness-due-core.mjs', () => {
  const runner = squashed('reference/runner.md');
  const from = runner.indexOf('**No queue is stored.**');
  assert.ok(from >= 0, 'runner.md has no "No queue is stored" paragraph');
  const paragraph = runner.slice(from, runner.indexOf('> Origin', from));
  assert.ok(paragraph.includes('`REPORTS.<kind>` in `harness-due-core.mjs` (default `docs/harness/reports/<file>`)'), 'the paragraph does not name `REPORTS.<kind>` in `harness-due-core.mjs`');
});

for (const code of ['preflight-missing', 'sweep-overdue']) {
  test(`upgrade.md's ${code} row names the report at REPORTS.<kind> in harness-due-core.mjs`, () => {
    const upgrade = squashed('reference/upgrade.md');
    const at = upgrade.indexOf(`| \`${code}\``);
    assert.ok(at >= 0, `upgrade.md has no ${code} row`);
    const row = upgrade.slice(at, upgrade.indexOf(' | ', upgrade.indexOf(' | ', at + 3) + 3));
    assert.ok(/`REPORTS\.(<kind>|preflight)` in `harness-due-core\.mjs` \(default `docs\/harness\/reports\//.test(row), `the ${code} row does not name the report at \`REPORTS.<kind>\` in \`harness-due-core.mjs\``);
  });
}

for (const [rel, row] of [['reference/learning.md', '| the retro |'], ['SKILL.md', '| `scripts/retro.mjs` + ']]) {
  test(`${rel}'s retro row cites retro-core's REPORTS_DIR with its default`, () => {
    const text = squashed(rel);
    const at = text.indexOf(row);
    assert.ok(at >= 0, `${rel} has no ${row} row`);
    const cell = text.slice(at, text.indexOf(' | ', text.indexOf(' | ', at + row.length + 3) + 3) + 400);
    assert.ok(cell.includes('`REPORTS_DIR`') && cell.includes('default `docs/harness/reports/`'), `${rel}'s retro row does not cite retro-core's \`REPORTS_DIR\` (default \`docs/harness/reports/\`)`);
  });
}

test('preflight.md says the first row of a phase is the first row whose id PHASE_OF gives that phase', () => {
  const text = fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'preflight.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(text.includes('first row whose id `PHASE_OF` gives that phase'), 'preflight.md does not define the first row of a phase by `PHASE_OF`');
});

test('upgrade.md owes the models file an entry for each host the project runs, not for every manifest target', () => {
  const text = fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'upgrade.md'), 'utf8').replace(/\s+/g, ' ');
  const at = text.indexOf('| `host-models-missing`');
  assert.ok(at >= 0, 'upgrade.md has no host-models-missing row');
  const row = text.slice(at, text.indexOf(' | `second-family-absent`', at));
  assert.ok(!row.includes('every target the manifest names'), 'the host-models-missing row still asks for every manifest target');
  assert.ok(row.includes('each host the project runs'), 'the host-models-missing row does not ask for an entry for each host the project runs');
  assert.ok(/harness-host[^|]*flags the session's own host/.test(row), "the host-models-missing row does not say step 0's harness-host flags the session's own host");
});

test('SKILL.md lists COMMANDS among the harness-due bindings', () => {
  const text = squashed('SKILL.md');
  const at = text.indexOf('| `scripts/harness-due.mjs` + ');
  assert.ok(at >= 0, 'SKILL.md has no harness-due row');
  const row = text.slice(at, text.indexOf(' | `scripts/lib/run-sources.mjs`', at));
  assert.ok(row.includes('`PHASE_OF`, `COMMANDS`,'), 'the harness-due row does not list `COMMANDS` among the bindings');
});

test("SKILL.md's phase preflight row says the due-checks' COMMANDS cite these references, and to bind COMMANDS to the project's own skill", () => {
  const text = squashed('SKILL.md');
  const at = text.indexOf('| phase preflight · workstream sweep |');
  assert.ok(at >= 0, 'SKILL.md has no phase preflight row');
  const row = text.slice(at, text.indexOf('| segment runner |', at));
  assert.ok(row.includes('`COMMANDS` cite these references'), "the row does not say the due-checks' `COMMANDS` cite these references");
  assert.ok(row.includes("bind `COMMANDS` to the project's own skill"), "the row does not say to bind `COMMANDS` to the project's own skill where it generates one");
});

test('"rounded up" always says to what: the next 1,024 bytes', () => {
  const refs = fs.readdirSync(path.join(BOOTSTRAP, 'reference')).filter(f => f.endsWith('.md')).map(f => path.join('reference', f));
  for (const rel of ['SKILL.md', ...refs, path.join('templates', 'scripts', 'check-agent-docs.mjs')]) {
    // a comment wraps behind `//`: squash those markers too
    const text = squashed(rel).replace(/ \/\/ /g, ' ');
    let at = text.indexOf('rounded up');
    while (at >= 0) {
      const after = text.slice(at + 'rounded up'.length, at + 'rounded up'.length + ' to the next 1,024 bytes'.length);
      assert.strictEqual(after, ' to the next 1,024 bytes', `${rel} says "rounded up" without "to the next 1,024 bytes" after it: ...${text.slice(Math.max(0, at - 40), at + 50)}...`);
      at = text.indexOf('rounded up', at + 1);
    }
  }
});

test("SKILL.md's \"Fit the project's tooling\" paragraph names every other CI check (run-gates.sh) and scoping disableTypeChecked to the harness's scripts", () => {
  const text = squashed('SKILL.md');
  const start = text.indexOf("**Fit the project's tooling.**");
  assert.ok(start >= 0, 'SKILL.md has no "Fit the project\'s tooling" paragraph');
  const para = text.slice(start, text.indexOf('**Project rules tighten', start));
  assert.ok(para.includes('`run-gates.sh`'), "the tooling paragraph does not name `run-gates.sh` (the gates bind every other check the project's CI runs)");
  assert.ok(para.includes('`tseslint.configs.disableTypeChecked`'), 'the tooling paragraph does not name `tseslint.configs.disableTypeChecked` for a type-aware lint');
});

test("harness-targets.md: ZCode's shells name the host, and its guards run from .zcode/config.json with hooks.enabled", () => {
  const raw = fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'harness-targets.md'), 'utf8');
  const text = raw.replace(/\s+/g, ' ');
  assert.ok(!text.includes('No ZCode variable is verified'), 'harness-targets.md still says no ZCode variable is verified');
  assert.ok(!/ZCode needs `HARNESS_HOST=zcode`/.test(text), 'harness-targets.md still says ZCode needs HARNESS_HOST=zcode');
  assert.ok(!text.includes('a ZCode session reads as `claude`'), 'harness-targets.md still says a ZCode session reads as claude');
  assert.ok(text.includes('`ZCODE_APP_VERSION`'), 'harness-targets.md does not name ZCODE_APP_VERSION');
  const start = raw.indexOf('\n## ZCode');
  assert.ok(start >= 0, 'harness-targets.md has no ZCode section');
  const section = raw.slice(start, raw.indexOf('\n## Kimi', start));
  const squash = section.replace(/\s+/g, ' ');
  for (const need of ['.zcode/config.json', 'hooks.enabled', 'ZCODE_PROJECT_DIR', 'UserPromptSubmit']) {
    assert.ok(squash.includes(need), `the ZCode section does not name ${need}`);
  }
  assert.ok(/context-budget hook stays Claude Code's/.test(squash), "the ZCode section does not say the context budget stays Claude Code's");
  const block = section.match(/```json\n([\s\S]*?)```/);
  assert.ok(block, 'the ZCode section has no JSON block');
  const config = JSON.parse(block[1]);
  assert.strictEqual(config.hooks.enabled, true);
  const pre = config.hooks.events.PreToolUse;
  const guards = Object.fromEntries(pre.map(e => [e.matcher, e.hooks[0]]));
  assert.deepStrictEqual(Object.keys(guards).sort(), ['Bash', 'Edit|Write']);
  assert.ok(guards['Edit|Write'].command.includes('${ZCODE_PROJECT_DIR}/.claude/hooks/edit-guard.mjs'), 'the edit guard is not wired');
  assert.ok(guards.Bash.command.includes('${ZCODE_PROJECT_DIR}/.claude/hooks/command-guard.mjs'), 'the command guard is not wired');
  assert.ok(pre.every(e => e.hooks.every(h => h.type === 'command' && h.timeout === 10)), 'a ZCode guard has no timeout of 10');
});

test("edit-guard.mjs's header names ZCode and its hooks.enabled switch", () => {
  const head = fs.readFileSync(path.join(BOOTSTRAP, 'templates', 'edit-guard.mjs'), 'utf8').split('\n').slice(0, 24).join('\n');
  assert.ok(head.includes('ZCode'), "edit-guard.mjs's header does not name ZCode");
  assert.ok(/hooks\.enabled: true/.test(head), "edit-guard.mjs's header does not say ZCode needs hooks.enabled: true");
});

test('autoCompactWindow only lowers: context.md names the order and what the hook cannot see; runner.md and harness-targets.md say so', () => {
  const context = squashed('reference/context.md');
  for (const need of ['--autocompact', 'modelSettings', 'managed settings', '--settings', 'CONTEXT_BUDGET_LIMIT']) {
    assert.ok(context.includes(need), `context.md does not name ${need}`);
  }
  assert.ok(/is not seen: set `CONTEXT_BUDGET_LIMIT`/.test(context), 'context.md does not say the hook does not read a window set that way');
  const runner = squashed('reference/runner.md');
  const para = runner.slice(runner.indexOf('## The implementer agent'));
  assert.ok(/only lowers: it applies when 250000 is below the window the subagent inherits/.test(para), "runner.md's implementer paragraph does not say the frontmatter window only lowers");
  assert.ok(para.includes('v2.1.296'), "runner.md's implementer paragraph does not name v2.1.296");
  const targets = squashed('reference/harness-targets.md');
  const agents = targets.slice(targets.indexOf('- **Agents:** `.claude/agents/*.md`'));
  assert.ok(agents.slice(0, 400).includes('`effort:` and `autoCompactWindow:`'), "harness-targets.md's Claude Code agents bullet does not name effort: and autoCompactWindow:");
  assert.ok(/`autoCompactWindow` only lowers/.test(agents.slice(0, 500)), "harness-targets.md's agents bullet does not say autoCompactWindow only lowers");
});

test('rules.md tells the generated rule-origins to open with a line saying a bare <name>.md is a harness-bootstrap reference file', () => {
  const rules = squashed('reference/rules.md');
  const preamble = rules.slice(0, rules.indexOf('## 1 · Ship these'));
  assert.ok(preamble.includes('rule-origins') && preamble.includes('harness-bootstrap'), 'the rules.md preamble does not name rule-origins and harness-bootstrap');
  assert.ok(/bare `<name>\.md` it cites is a reference file of the harness-bootstrap skill, not a project file/.test(preamble), 'the rules.md preamble does not say a bare <name>.md is a reference file, not a project file');
});

test('cross-model.md names CODEX_CANDIDATES before codex on PATH, and says codex-run lowers max without --allow-max', () => {
  const text = squashed('reference/cross-model.md');
  assert.ok(/`CODEX_CANDIDATES` in the core .{0,160}tried before `codex` on `PATH`.{0,120}`CODEX_BIN` overrides both/.test(text), 'cross-model.md does not place CODEX_CANDIDATES before codex on PATH, with CODEX_BIN over both');
  assert.ok(/codex-run lowers `max` to `xhigh` without `--allow-max`/.test(text), 'cross-model.md does not say codex-run lowers max without --allow-max');
});

const upgradeStep = (from, to) => {
  const upgrade = squashed('reference/upgrade.md');
  const start = upgrade.indexOf(from);
  assert.ok(start >= 0, `upgrade.md has no ${from}`);
  return upgrade.slice(start, upgrade.indexOf(to, start));
};

test('upgrade.md step 1 names the template states and --base, with the clone --history the script asks for', () => {
  const step1 = upgradeStep('## Step 1', '## Step 2');
  for (const state of ['`current`', '`newer`', '`gone`', '`unrecorded`', '`invalid`']) {
    assert.ok(step1.includes(state), `step 1 does not name the template state ${state}`);
  }
  assert.ok(step1.includes('`--base <path>` prints the template an entry was generated from'), 'step 1 does not name --base');
  const script = fs.readFileSync(path.join(BOOTSTRAP, 'scripts', 'harness-status.js'), 'utf8');
  const clone = /const FULL_CLONE = 'pass (--history <[^>]+>)';/.exec(script);
  assert.ok(clone, 'harness-status.js has no FULL_CLONE line');
  assert.ok(step1.includes(`\`${clone[1]}\``), `step 1 does not name ${clone[1]} as the script does`);
});

test('upgrade.md step 2: a file generated from a template whose template is newer is merged three-way, never replaced', () => {
  const step2 = upgradeStep('## Step 2', '## Step 3');
  assert.ok(step2.includes('`Default` is one of `replace · merge · keep · generate · ask · wait`'), "step 2's defaults do not include merge");
  assert.ok(/\| `unchanged` or `edited`, template `newer` \| the three-way merge below[^|]*\| \*\*merge\*\* when clean; \*\*ask\*\* on a conflict/.test(step2), 'step 2 has no merge row for a newer template');
  assert.ok(/\| `unchanged` or `edited`, template `current` \| nothing/.test(step2), 'step 2 has no row for a current template');
  assert.ok(!step2.includes('replace with the newer template'), 'step 2 still replaces a file generated from a template');
  const at = step2.indexOf('**A file generated from a template is merged, never regenerated.**');
  assert.ok(at >= 0, 'step 2 has no merge paragraph');
  const para = step2.slice(at, step2.indexOf('`[M]`', at));
  assert.ok(para.includes('folds in every fix the project made before the manifest was written'), 'the merge paragraph does not say why unchanged is not the template');
  assert.ok(para.includes('Format the base and the current template as the project formats the file first'), 'the merge paragraph does not format the base and the template first');
  assert.ok(para.includes('--base <path> > base') && para.includes('git merge-file -p <path> base theirs > merged'), 'the merge paragraph has no recipe');
  assert.ok(para.includes("where the template now carries the project's own fix, take the template's side"), 'the merge paragraph does not say how a conflict resolves');
  assert.ok(/`edited` \(generated from a reference, hash differs\) \| where a version row names the reference: the block regenerated, and its diff against the file, in which a hunk the reference change does not explain is a project edit and stays/.test(step2), 'an edited reference-generated block does not keep the hunks its reference change does not explain');
  assert.ok(step2.includes('Adopting it in place wraps the legacy text in `policy` markers where it stands, and the manifest records that block as `reviewed`; until it is wrapped, the status line is its only record'), 'step 2 does not say how a legacy policy adopted in place is recorded');
});

test('upgrade.md step 3: a kept row keeps its old hashes, a merged row records the template it merged in, and project-own and renamed entries are covered', () => {
  const step3 = upgradeStep('## Step 3', '## Markers in shared files');
  assert.ok(step3.includes("**A kept row keeps its old hashes.** A `keep` row's `sha256` and `templateSha256` stay as the old manifest recorded them"), 'step 3 re-hashes a kept row');
  assert.ok(step3.includes('A merged row records the template it merged in (`templateSha256`) and the merged file (`sha256`)'), 'step 3 does not say what a merged row records');
  assert.ok(/\*\*Entries no template covers\.\*\* A harness file the project wrote itself in place of a template[^.]*is a `reviewed` entry with no `template`: an upgrade proposes section-level changes and never merges into it/.test(step3), 'step 3 does not cover a project-own harness file');
  assert.ok(step3.includes('A renamed file moves its entry, `template` and `templateSha256` included, to the new path'), 'step 3 does not cover a renamed entry');
});

const TEMPLATES = path.join(BOOTSTRAP, 'templates');
const templateFiles = (dir = TEMPLATES) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? templateFiles(full) : [full];
});
const templateRel = file => path.relative(TEMPLATES, file).split(path.sep).join('/');

test("every template cites a reference file as harness-bootstrap's reference/<file>, never by its bare name", () => {
  const refs = fs.readdirSync(path.join(BOOTSTRAP, 'reference')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));
  const cite = new RegExp(`(^|[^\\w.-])((?:[\\w.-]+/)*)(${refs.join('|')})\\.md\\b`, 'g');
  // harness-host-core.test.mjs asserts which references the templates cite, so it names them bare. The
  // comment above harness-guard.test.mjs's [B] IDS line keeps its old text: an install fills the line
  // below it, and a three-way merge conflicts when both sides change adjacent lines.
  const exemptFile = 'scripts/lib/harness-host-core.test.mjs';
  const exemptLine = '// [B] Every id shape the plan uses: ID_PATTERN must take each one whole (commit-guard.md).';
  const hits = [];
  for (const file of templateFiles()) {
    const rel = templateRel(file);
    if (rel === exemptFile) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.trim() === exemptLine) return;
      const named = line.includes('harness-bootstrap') || (lines[i - 1] || '').includes('harness-bootstrap');
      for (const [, , dir, name] of line.matchAll(cite)) {
        if (dir && dir !== 'reference/') continue; // a project's own file of the same name
        if (dir === 'reference/' && named) continue;
        hits.push(`${rel}:${i + 1} ${dir}${name}.md`);
      }
    });
  }
  assert.deepStrictEqual(hits, [], `a template cites a reference without naming the skill: ${hits.join('; ')}`);
});

test('a template citation reference/<file> › <heading> names a heading that file has', () => {
  const headings = file => [...fs.readFileSync(path.join(BOOTSTRAP, 'reference', file), 'utf8')
    .matchAll(/^(?:#+ (.+)|(?:`\[[MB]\]` )?\*\*([^*]+?)\.?\*\*)/gm)].map(m => (m[1] || m[2]).trim());
  const missing = [];
  let seen = 0;
  for (const file of templateFiles()) {
    // a comment wrapped over two lines reads as one
    const text = fs.readFileSync(file, 'utf8').replace(/\n[ \t]*(?:\/\/|\*|#)?[ \t]*/g, ' ');
    for (const [, ref, heading] of text.matchAll(/reference\/([a-z-]+\.md) › ([^)]+)\)/g)) {
      seen += 1;
      if (!headings(ref).some(h => h === heading || h.startsWith(`${heading} —`))) missing.push(`${templateRel(file)}: ${ref} › ${heading}`);
    }
  }
  assert.ok(seen > 0, 'no template cites a reference heading');
  assert.deepStrictEqual(missing, [], `a citation names no heading of its reference: ${missing.join('; ')}`);
});

test('the FULL verify runs once, at the end of step 8a after the doc sweep: the sequence, the tier table, the steps and every reference that names it', () => {
  const runner = squashed('reference/runner.md');
  assert.ok(runner.includes('8a docs the doc sweep · then the FULL verify run'), "runner.md's sequence does not end step 8a with the FULL verify");
  assert.ok(!runner.includes('bounded fix rounds · the FULL verify run'), "runner.md's sequence still runs the FULL verify in step 8");
  assert.ok(runner.includes('| 8a verify | scoped | FULL once before merge | FULL |') && !runner.includes('| 8 verify |'), "runner.md's tier table does not give the verify to step 8a");
  const at8 = runner.indexOf('**Step 8 — review.**');
  const at8a = runner.indexOf('**Step 8a — docs, then the FULL verify.**');
  assert.ok(at8 >= 0 && at8a > at8, 'runner.md has no step 8 heading followed by "Step 8a — docs, then the FULL verify."');
  assert.ok(!runner.slice(at8, at8a).includes('FULL'), 'step 8 still holds the FULL verify');
  const step8a = runner.slice(at8a, runner.indexOf('**Step 8b', at8a));
  const sweepAt = step8a.indexOf('**The doc sweep**');
  assert.ok(sweepAt >= 0 && step8a.indexOf("Then the **FULL verify** (`context.md`), after the sweep's edits and every test a step added") > sweepAt, 'step 8a does not run the doc sweep, then the FULL verify');
  assert.ok(runner.includes('verify once, at the end of step 8a — **never once per slice**'), 'step 2 does not place the one FULL verify at the end of step 8a');
  assert.ok(runner.includes("since step 8a's verify") && runner.includes('reuses the step 8a result'), 'step 9 does not re-verify against the step 8a result');
  assert.ok(runner.includes('a tests step after regression → before the FULL verify · doc sweep → 8a, then the FULL verify · ship → 9'), 'the eleven-step correspondence does not place a tests step before the FULL verify');
  assert.ok(squashed('reference/rules.md').includes('the full run belongs to step 8a and to the merge'), 'rules.md does not give the full run to step 8a');
  const context = squashed('reference/context.md');
  assert.ok(context.includes('| 8a verify FULL | ran |') && !context.includes('| 8 verify FULL |'), "context.md's ledger example does not name the FULL verify 8a");
  const delegate = fs.readFileSync(path.join(DELEGATE, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(delegate.includes("the runner's step 8a FULL verify is that check"), "delegate-tasks' SKILL.md does not name step 8a's FULL verify");
});

test("the record and Gate 2 measure a deliverable from its own start, and Gate 2 also shows the unit's total since the claim", () => {
  const runner = squashed('reference/runner.md');
  assert.ok(runner.includes('--session <every session id since the start, comma-separated> --since <start>)"') && !runner.includes('--since <claimed>'), "step 8b's cost line does not run from <start>");
  assert.ok(runner.includes("`<start>` is the state file's `Deliverable started:`, else the claim: the row's own window, as for Elapsed (`log-format.md`)"), 'step 8b does not say where <start> comes from');
  assert.ok(runner.includes("the deliverable's window (the record's Cost line) and the unit's total since the claim (`unit-cost.mjs`; `--by-step` for where it went)"), 'Gate 2 does not show both windows');
  const log = squashed('reference/log-format.md');
  assert.ok(log.includes("`unit-cost.mjs`'s line over the deliverable's window (from `Deliverable started:`, else the claim, as for Elapsed)"), "log-format.md's Cost row does not name the deliverable's window");
  assert.ok(log.includes("Both run ledgers, codex-run's and claude-run's, count only the runs made in the unit's worktree, from the window's start to its sessions' last line."), "log-format.md's Cost row does not say which runs the ledgers count");
});

test("the step markers name the done command, tell review-gate's rounds from a step's, and keep an eleven-step install's own ids", () => {
  const runner = squashed('reference/runner.md');
  assert.ok(runner.includes('so `done` (`node scripts/unit-step.mjs <unit> <step> done`) is needed only after the last step and before a stop'), 'runner.md does not give the done command');
  const core = fs.readFileSync(path.join(TEMPLATES, 'scripts', 'lib', 'unit-step-core.mjs'), 'utf8');
  assert.ok(core.includes("export const EVENTS = ['start', 'done'];"), 'unit-step-core.mjs has no done event');
  assert.ok(runner.includes("review-gate counts fix rounds, not step rounds, so its `--round 1` runs inside step 8's round 2"), 'runner.md does not tell review-gate rounds from step rounds');
  assert.ok(runner.includes('keep their numbers, and those numbers are their step ids: in the markers, the dispatch tags and the ledger'), "an eleven-step install's numbers are not its step ids");
  assert.ok(runner.includes('Such an install reads this file\'s step numbers through the correspondence: "step 9" is its ship step.'), 'runner.md does not say how an eleven-step install reads its step numbers');
  assert.ok(runner.includes('the land step (9) ends with `node scripts/harness-due.mjs`'), 'the due-check names step 9 by its number alone');
});

test('a Missed by harness that comes after the land gets a commit of its own, and the row is undated until then', () => {
  const runner = squashed('reference/runner.md');
  const at9 = runner.indexOf('**Step 9 — land.**');
  assert.ok(at9 >= 0, 'runner.md has no step 9 heading');
  const step9 = runner.slice(at9, runner.indexOf('**Step 10', at9));
  assert.ok(step9.includes('**A Missed that comes after the land** — the merge policy merged, and the owner spoke later — goes in a commit of its own that edits that row'), 'step 9 has no rule for a Missed after the land');
  assert.ok(step9.includes('(under `SCOPE=repo` the guard refuses a mainline commit while any row is held)') && step9.includes("Until it is committed the row has no date, and the retro's digest says so (`learning.md`)"), "step 9's Missed rule does not say where it commits or what the retro shows");
  const log = squashed('reference/log-format.md');
  assert.ok(log.includes('filled from what the owner volunteered at Gate 2, before the land commit, never asked as a question'), "log-format.md's Missed row does not say it is filled before the land commit");
  assert.ok(log.includes('One the owner volunteers after the land gets a commit of its own (`runner.md` › Step 9)'), "log-format.md's Missed row does not cover one that comes after the land");
});

test('the claim auditor and a reviewer that mutates code work in a worktree of their own, and prove each restore with cmp', () => {
  const auditor = squashed('reference/claim-auditor.md');
  assert.ok(auditor.includes('it sabotages only in a worktree of its own, never the shared tree another agent may be reading; every protection it removes, it restores from a copy taken first, and it proves the restore with `cmp` before reporting'), "claim-auditor.md's tools paragraph does not confine sabotage to its own worktree");
  assert.ok(!auditor.includes('`git diff --stat` being empty'), 'claim-auditor.md still proves a restore with git diff --stat');
  const at = auditor.indexOf('- **Mutation-check the top suspects');
  assert.ok(at >= 0, 'claim-auditor.md has no mutation-check bullet');
  const bullet = auditor.slice(at, auditor.indexOf('- **The fix commits are a fresh diff.**', at));
  for (const step of ['`git worktree add --detach <temp dir> HEAD` outside the repository', '`cp` it to the scratch directory', 'prove it with `cmp <copy> <file>` before the next suspect', 'Remove the worktree at the end. Never `git checkout -- <file>`.']) {
    assert.ok(bullet.includes(step), `the mutation bullet lacks: ${step}`);
  }
  assert.ok(!bullet.includes('`git apply` it back'), 'the mutation bullet still restores by re-applying the patch');
  assert.ok(squashed('reference/runner.md').includes('A reviewer that mutates code to prove a test does it in a worktree of its own, never the shared tree (`claim-auditor.md`).'), 'runner.md does not confine a mutating reviewer to its own worktree');
  assert.ok(squashed('SKILL.md').includes('states that it sabotages only in a worktree of its own and restores'), "SKILL.md's claim-auditor row does not say where it sabotages");
});

test("the record rule's prose audit is at Full, in rules.md, the rules block and SKILL.md; a rule the project states keeps its words and cites them", () => {
  const rule = '**The record is written last, from the diff — its fields generated, its prose audited at Full by someone who did not write it.**';
  const rules = squashed('reference/rules.md');
  const block = squashed('templates/agents-rules.md');
  assert.ok(rules.includes(rule), "rules.md's record rule does not say at Full");
  assert.ok(block.includes(rule), "the rules block's record rule does not say at Full");
  assert.ok(squashed('SKILL.md').includes('fields generated, prose audited at Full by someone else.**'), "SKILL.md's record rule does not say at Full");
  const citation = "`Stated in the project's words: <path> › <heading>`";
  const preamble = rules.slice(0, rules.indexOf('## 1 · Ship these'));
  assert.ok(preamble.includes(`A rule the project already states in its own words keeps them: the rules block keeps the bold rule and, in place of its why clause, ${citation}, so no section is left a bare heading.`), 'the rules.md preamble does not give the citation form');
  assert.ok(block.includes(`keep the bold rule, and in place of its why clause write ${citation}. No section is left a bare heading.`), 'the rules block does not give the citation form');
});

test('sweep.md: a status advances only on a mainline commit, velocity reads Elapsed (work) as log-format.md reconciles it, and landings come from --first-parent', () => {
  const sweep = squashed('reference/sweep.md');
  assert.ok(sweep.includes('only on a commit you can name that is on the mainline (`git merge-base --is-ancestor <sha> <mainline>`): a fix still on an unmerged branch is reported, never advanced'), 'sweep.md advances a status on a commit off the mainline');
  assert.ok(sweep.includes('`fixed <sha>` against the commit once it is on the mainline'), "sweep.md's fixed rows are not checked against the mainline");
  assert.ok(sweep.includes("the work time per unit from the log's Elapsed (work), reconciled as `log-format.md` says: a row that cannot be reconciled is marked, left out and counted"), "sweep.md's velocity does not read Elapsed (work) as log-format.md reconciles it");
  assert.ok(sweep.includes('with the tier reported alongside only to show whether it tracks') && !sweep.includes('`Size`'), 'sweep.md reports a Size the log does not have');
  assert.ok(sweep.includes("which tripwires fired (`rules.md` §2: read from the log's Verdicts, Retries and Friction cells and the state files' decision logs)"), 'sweep.md does not say where the tripwires are read');
  assert.ok(sweep.includes('landing shapes, read from `git log --first-parent --format=%s <mainline>` on the real history — merges and direct landings both —') && !sweep.includes('git log --merges'), 'sweep.md reads only merge commits');
});

test('preflight.md probes the ports the repo declares, and the defaults of the tools it runs where it declares none', () => {
  const preflight = squashed('reference/preflight.md');
  assert.ok(preflight.includes('the ports the repo declares (dev and preview scripts, env examples, compose and server config), and the defaults of the tools it runs where it declares none, against what is listening (`lsof -nP -iTCP -sTCP:LISTEN`)'), 'preflight.md does not say which ports it probes');
  assert.ok(!preflight.includes('claimed ports'), 'preflight.md still probes only claimed ports');
});

test("SKILL.md says generating stamps each template's generated date, and the templates carry the placeholder", () => {
  assert.ok(squashed('SKILL.md').includes("and stamps each template's `generated YYYY-MM-DD` header with the day it ran (an upgrade's merge keeps the stamp the install has)"), 'SKILL.md does not say who stamps the generated date');
  assert.ok(fs.readFileSync(path.join(TEMPLATES, 'run-gates.sh'), 'utf8').includes('(generated YYYY-MM-DD)'), 'run-gates.sh carries no generated placeholder');
});

test('a copy stands in for the skill link where a project refuses committed symlinks, and harness-status compares it file by file', () => {
  assert.ok(squashed('reference/harness-targets.md').includes('On Windows without symlink support, or where the project refuses committed symlinks, copy instead: `harness-status.js` compares the copy with the real store file by file (`skill-link-drift`).'), 'harness-targets.md does not cover a project that refuses committed symlinks');
  assert.ok(fs.readFileSync(path.join(BOOTSTRAP, 'scripts', 'harness-status.js'), 'utf8').includes("haz('skill-link-drift'"), 'harness-status.js raises no skill-link-drift');
  assert.ok(squashed('SKILL.md').includes('(a copy where the project refuses committed symlinks, `harness-targets.md`)'), "SKILL.md's runner row does not name the copy");
});

test('scope-guard.md: the steps file is committed when the state file is, and stays on the machine where state files stay out of git', () => {
  assert.ok(squashed('reference/scope-guard.md').includes('Committed when the state file is — where the project keeps its state files out of git, both stay on this machine — and kept after the unit lands'), 'scope-guard.md commits the steps file whatever the state file does');
});

test("learning.md: the digest is committed as written, and a row is dated by git blame -w with only the repository's ignore file, as retro-gather runs it", () => {
  const learning = squashed('reference/learning.md');
  assert.ok(learning.includes('**The digest is committed as the retro wrote it.**') && learning.includes("list `REPORTS_DIR` in the project formatter's ignore file (`.prettierignore` or its equivalent)"), "learning.md does not keep the digest out of the project's formatter");
  const at = learning.indexOf('**How a row gets its date.**');
  assert.ok(at >= 0 && learning.includes('› How a row gets its date)'), 'learning.md has no "How a row gets its date" paragraph for the retro to cite');
  const para = learning.slice(at, learning.indexOf('`[M]`', at));
  for (const part of ['`git blame -w`', "`--no-ignore-revs-file` clears whatever `blame.ignoreRevsFile` a machine's git config names", '`.git-blame-ignore-revs`', '`git mv`', 'With `FILED_AT` bound (off by default)']) {
    assert.ok(para.includes(part), `"How a row gets its date" lacks: ${part}`);
  }
  const gather = fs.readFileSync(path.join(TEMPLATES, 'scripts', 'lib', 'retro-gather.mjs'), 'utf8');
  assert.ok(gather.includes("['blame', '-w', '--line-porcelain', '--no-ignore-revs-file']"), 'retro-gather.mjs does not blame as learning.md says');
  assert.ok(learning.includes('out, with a `Warn:` line under Read and the same line on stderr'), 'learning.md does not say an undated row gets a Warn: line');
  assert.ok(learning.includes('`FILED_AT` (`null`)'), "learning.md's bindings do not list FILED_AT");
});

test("run-counted's raise message names the gate's line, and context.md quotes it", () => {
  const core = fs.readFileSync(path.join(TEMPLATES, 'scripts', 'lib', 'run-counted-core.mjs'), 'utf8');
  assert.ok(core.includes(": raise --min on the gate's line`") && !core.includes('raise --min in scripts/run-gates.sh'), "run-counted's raise message names a file the project may not have");
  assert.ok(squashed('reference/context.md').includes("raise --min on the gate's line`), wherever the project defines its gates"), 'context.md does not quote the raise message');
});

const upgradeMd = () => fs.readFileSync(path.join(BOOTSTRAP, 'reference', 'upgrade.md'), 'utf8');
const metadataVersion = dir => {
  const head = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
  const version = head && head[1].match(/^ {2}version: (\d+)$/m);
  assert.ok(version, `${path.basename(dir)}'s SKILL.md names no metadata version`);
  return Number(version[1]);
};
/** A template module's exports, run in node: RegExps (alone or in a list) as their source text. */
function exported(rel, names) {
  const url = require('url').pathToFileURL(path.join(TEMPLATES, rel)).href;
  const code = `const m = await import(${JSON.stringify(url)}); const show = (v) => (v instanceof RegExp ? String(v) : Array.isArray(v) ? v.map((x) => (x instanceof RegExp ? String(x) : x)) : v); console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map((n) => [n, show(m[n])]))));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
const cleanGit = { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } };

test("upgrade.md has a version row 6 for 2.2.3-js.8, and both skills, the manifest example and the upgrade's last step name its newest row", () => {
  const text = upgradeMd();
  assert.match(text, /^\| 6 \| 2\.2\.3-js\.8 \| /m, 'the version table has no row 6 for 2.2.3-js.8');
  const table = text.slice(text.indexOf('## Version table'));
  const newest = Math.max(...[...table.matchAll(/^\| (\d+) \| /gm)].map(m => Number(m[1])));
  for (const dir of [BOOTSTRAP, DELEGATE]) {
    assert.strictEqual(metadataVersion(dir), newest, `${path.basename(dir)}'s version is not the version table's newest row (the two skills move together)`);
  }
  assert.ok(text.includes(`"skillVersion": ${newest},`), 'the manifest example is not at the newest version');
  const flat = squashed('reference/upgrade.md');
  assert.ok(flat.includes(`and the manifest written at \`skillVersion\` ${newest}.`), 'the upgrade does not end at the newest version');
  assert.ok(flat.includes('a v5 install the v6 row, a v3 install the v4 to v6 rows, a v2 install the v3 row as well'), 'Skipping versions does not route a v5 or a v3 install to v6');
});

test("Step 2's merge gives the base and the template the file's own date, and a conflict on a binding keeps the project's value", () => {
  const text = squashed('reference/upgrade.md');
  assert.ok(text.includes("and give both the file's own date in place of `generated YYYY-MM-DD`"), "the merge does not give the base and the template the file's date");
  assert.ok(text.includes("Where it marks a binding the project set, keep the project's value and take the template's lines around it"), 'the merge says nothing of a conflict on a binding');
  if (!hasGit) return;
  // why, in git: a stamped header next to a header line the template changed conflicts, unless both carry the stamp
  const dir = tmp('hb-stamp-');
  const write = (name, lines) => fs.writeFileSync(path.join(dir, name), `${lines.join('\n')}\n`);
  write('base', ['// tool (generated YYYY-MM-DD).', '// says one thing.', 'body']);
  write('theirs', ['// tool (generated YYYY-MM-DD).', '// says another.', 'body']);
  write('file', ['// tool (generated 2026-10-27).', '// says one thing.', 'body']);
  assert.notStrictEqual(git(dir, ['merge-file', '-p', 'file', 'base', 'theirs'], cleanGit).status, 0, 'an unstamped base merged clean: the stamp step would not be needed');
  for (const name of ['base', 'theirs']) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('generated YYYY-MM-DD', 'generated 2026-10-27'));
  }
  const merged = git(dir, ['merge-file', '-p', 'file', 'base', 'theirs'], cleanGit);
  assert.strictEqual(merged.status, 0, 'a stamped base and template still conflict');
  assert.strictEqual(merged.stdout, '// tool (generated 2026-10-27).\n// says another.\nbody\n');
});

test('upgrade.md: a reference change takes a version, the base gets a sheet row, and a directory becomes the skill link in two commits', () => {
  const text = squashed('reference/upgrade.md');
  assert.ok(text.includes('**A reference change takes a version.**') && text.includes('the row is the only record that a reference-generated entry is stale'), 'upgrade.md does not say a reference change takes a version');
  assert.ok(text.includes('**The base gets a row of its own.**') && text.includes('(`node scripts/check-agent-docs.mjs --base`)') && text.includes('Never trim a shipped rule to fit.'), 'upgrade.md gives the base no row on the sheet');
  assert.ok(text.includes('cites them in place of its why clause (`rules.md` §1)') && squashed('reference/rules.md').includes('in place of its why clause'), 'the citation form upgrade.md sends the base row to is not in rules.md §1');
  assert.ok(text.includes('A directory becomes the symlink in two commits, the removal and then the link'), 'the skill-link hazard does not say a directory takes two commits');
});

test('upgrade.md names, as the cores that land together, exactly the import sets of the template cores', () => {
  const lib = path.join(TEMPLATES, 'scripts', 'lib');
  const cores = fs.readdirSync(lib).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map(f => f.slice(0, -4));
  const up = Object.fromEntries(cores.map(core => [core, core]));
  const find = core => (up[core] === core ? core : (up[core] = find(up[core])));
  for (const core of cores) {
    for (const m of fs.readFileSync(path.join(lib, `${core}.mjs`), 'utf8').matchAll(/from '\.\/([a-z-]+)\.mjs'/g)) {
      if (m[1] in up) up[find(core)] = find(m[1]);
    }
  }
  const groups = {};
  for (const core of cores) (groups[find(core)] ??= []).push(core);
  const expected = Object.values(groups).filter(group => group.length > 1).map(group => group.sort().join(' ')).sort();
  const text = squashed('reference/upgrade.md');
  const at = text.indexOf('**Cores that import each other land together.**');
  assert.ok(at >= 0, 'upgrade.md does not say that cores which import each other land together');
  const named = text.slice(text.indexOf('today:', at), text.indexOf('Applied one by one', at)).split('; and ')
    .map(set => [...set.matchAll(/`([a-z-]+)`/g)].map(m => m[1]).sort().join(' ')).sort();
  assert.deepStrictEqual(named, expected, 'the sets upgrade.md names are not the import sets of the template cores');
});

test('upgrade.md: a scaffold gains a column in place, and the readers it rebinds are bindings of the cores it names', () => {
  const text = squashed('reference/upgrade.md');
  assert.ok(text.includes('**A scaffold gains a column in place.**') && text.includes('never a second table'), 'upgrade.md does not say how a log gains a column');
  for (const [name, core] of [['LOG_COLUMNS', 'unit-record-core'], ['COLUMNS', 'estimate-core'], ['EXTRA_COLUMNS', 'retro-core']]) {
    assert.ok(text.includes(`\`${name}\` in \`${core}.mjs\``), `upgrade.md does not name ${name} in ${core}.mjs`);
    assert.match(fs.readFileSync(path.join(TEMPLATES, 'scripts', 'lib', `${core}.mjs`), 'utf8'), new RegExp(`^export const ${name} = `, 'm'), `${core}.mjs binds no ${name}`);
  }
  assert.ok(text.includes('scaffolds gain, in place (Step 3)'), 'Skipping versions does not send the log columns to Step 3');
});

test("upgrade.md checks each path SKILL.md's .gitignore row names, a directory by a path inside it", () => {
  const text = squashed('reference/upgrade.md');
  assert.ok(text.includes('**The ignored paths are checked too.**') && text.includes('`git check-ignore -q <path>` exits 0'), 'upgrade.md does not check the ignored paths');
  const row = squashed('SKILL.md').match(/\| `\.gitignore` entries \|[^|]+\|([^|]+)\|/);
  assert.ok(row, 'SKILL.md has no .gitignore row');
  for (const [entry, checked] of [['.claude/registry.md', 'the registry'], ['.review-work/', '`.review-work/x`'], ['.codex-runs/', '`.codex-runs/x`'], ['.claude-runs/', '`.claude-runs/x`']]) {
    assert.ok(row[1].includes(`\`${entry}\``), `SKILL.md's .gitignore row lacks ${entry}`);
    assert.ok(text.includes(checked), `upgrade.md's check lacks ${checked}`);
  }
  if (!hasGit) return;
  const dir = tmp('hb-ignore-');
  git(dir, ['init', '-q'], cleanGit);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.review-work/\n');
  assert.strictEqual(git(dir, ['check-ignore', '-q', '.review-work'], cleanGit).status, 1, "git reads an absent directory's bare name as ignored: the path inside would not be needed");
  assert.strictEqual(git(dir, ['check-ignore', '-q', '.review-work/x'], cleanGit).status, 0, 'a path inside an ignored directory reads as not ignored');
});

test("upgrade.md's v6 section states each new binding's template default, and each binding its conflict list names exists", () => {
  const text = squashed('reference/upgrade.md');
  assert.ok(text.includes('the rest of an upgrade to v6 is in *Upgrading to v6* below') && /^### Upgrading to v6$/m.test(upgradeMd()), 'row 6 points to no Upgrading to v6 section');
  const v6 = text.slice(text.indexOf('### Upgrading to v6'));
  const source = rel => fs.readFileSync(path.join(TEMPLATES, rel), 'utf8');
  const lib = name => `scripts/lib/${name}.mjs`;
  const list = words => words.map(word => `\`${word}\``).join(', ');
  assert.match(source('harness-guard.sh'), /^MAINLINE="main" /m, "the commit guard's MAINLINE default is not main");
  assert.ok(v6.includes('`MAINLINE` in the commit guard (`main`)'), 'the v6 section does not state MAINLINE');
  const { CODEX_CANDIDATES } = exported(lib('codex-run-core'), ['CODEX_CANDIDATES']);
  assert.ok(v6.includes(`\`CODEX_CANDIDATES\` in \`codex-run-core.mjs\` (${list(CODEX_CANDIDATES)} under the home directory`), 'the v6 section does not state CODEX_CANDIDATES as the core binds it');
  const { TIER_WORDS } = exported(lib('estimate-core'), ['TIER_WORDS']);
  assert.ok(v6.includes(`\`TIER_WORDS\` in \`estimate-core.mjs\` (${list(TIER_WORDS)})`), 'the v6 section does not state TIER_WORDS as the core binds it');
  const retro = exported(lib('retro-core'), ['STATUS_COLUMNS', 'STATUS_WORDS', 'SEVERITY_COLUMNS', 'FILED_AT']);
  assert.strictEqual(retro.FILED_AT, null);
  assert.ok(Array.isArray(retro.STATUS_COLUMNS) && Array.isArray(retro.SEVERITY_COLUMNS) && typeof retro.STATUS_WORDS === 'object');
  assert.ok(v6.includes('`STATUS_COLUMNS`, `STATUS_WORDS`, `SEVERITY_COLUMNS` and `FILED_AT` (`null`, off) in `retro-core.mjs`'), 'the v6 section does not state the follow-up bindings');
  const { INSTRUCTIONS } = exported(lib('review-gate-core'), ['INSTRUCTIONS']);
  const instruction = file => INSTRUCTIONS.some(source => new RegExp(source.slice(1, source.lastIndexOf('/'))).test(file));
  for (const file of ['AGENTS.md', 'CLAUDE.md', '.claude/x', '.agents/x', '.codex/x', '.zcode/x']) assert.ok(instruction(file), `INSTRUCTIONS does not take ${file}`);
  assert.ok(v6.includes('`INSTRUCTIONS` in `review-gate-core.mjs` (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `.codex/` and `.zcode/`'), 'the v6 section does not state INSTRUCTIONS');
  assert.ok(v6.includes('`LOG_COLUMNS` in `unit-record-core.mjs`'), 'the v6 section does not state LOG_COLUMNS');
  const conflicts = v6.slice(v6.indexOf('**Where else the merge conflicts.**'), v6.indexOf('**What the owner reviews again.**'));
  const bound = [
    ['harness-guard.sh', ['SCOPE']], [lib('harness-guard.test'), ['MERGE_GUARD', 'HOOK_FILES']], ['edit-guard.mjs', ['PROTECTED']],
    ['scripts/check-agent-docs.mjs', ['budgets', 'statePattern', 'pathPrefixes']], [lib('docs-drift-core'), ['IGNORE_TOKENS', 'GENERIC']],
    [lib('estimate-core'), ['TIERS']], [lib('harness-due-core'), ['MAIN', 'PHASE_OF', 'COMMANDS']], [lib('harness-host-core'), ['MODELS_FILE']],
    [lib('retro-core'), ['REPORTS_DIR', 'PLANS_DIR']], [lib('review-gate-core'), ['TESTS']], [lib('unit-record-core'), ['MAX_COMMITS']],
  ];
  for (const [file, names] of bound) {
    for (const name of names) {
      assert.ok(conflicts.includes(`\`${name}\``), `the conflict list does not name ${name}`);
      assert.match(source(file), new RegExp(`^\\s*(?:export const |const )?${name}(?:=| = |: )`, 'm'), `${file} binds no ${name}`);
    }
  }
});

test("upgrade.md's v6 section names what the owner reviews again and the machine's weekly job", () => {
  const v6 = squashed('reference/upgrade.md').split('### Upgrading to v6')[1] || '';
  for (const part of [
    'A unit of only tests or instruction files is reviewed, no longer skipped, and at the full tier under a critical path',
    'The commit guard refuses, in either scope, the merge of a branch that still holds a row',
    '`run-counted.mjs` fails a test file that registered no tests, which it used to count as a pass',
    '`check-agent-docs.mjs` exits 2 on an argument it does not know',
    'so its time moves from step 8 to 8a in the by-step figures',
    'Once per machine, run `retro-weekly.mjs --install` again (`learning.md` › The weekly job), so the job carries `CODEX_HOME`',
  ]) assert.ok(v6.includes(part), `the v6 section lacks: ${part}`);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
