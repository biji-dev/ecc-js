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
  for (const need of ['commit guard', 'command guard', 'edit guard', '.claude/settings.json', '.codex/hooks.json', 'run-gates.sh', 'run-counted', 'review-gate', 'critical', 'never-auto']) {
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

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
