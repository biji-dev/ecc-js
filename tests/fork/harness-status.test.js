/**
 * Tests for skills/harness-bootstrap/scripts/harness-status.js (biji-dev/ecc-js):
 * lineage detection, manifest status, hazards, hashing, read-only behaviour.
 * All fixtures are built in temp directories; nothing outside them is touched.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'skills', 'harness-bootstrap', 'scripts', 'harness-status.js');

// Env for every child: no inherited GIT_* variable (git sets GIT_DIR and friends inside hooks),
// a throwaway HOME so no global git config is read, and hermetic config switches.
const SUITE_HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-status-home-')));
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  delete env.CODEX_HOME; // the script reads <CODEX_HOME>/config.toml; never the developer's
  return {
    ...env,
    HOME: SUITE_HOME,
    XDG_CONFIG_HOME: path.join(SUITE_HOME, '.config'),
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
  };
}
const ENV = cleanEnv();

// Every fixture is removed after the test that made it.
let created = [];
const everCreated = [];
function cleanupFixtures() {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  created = [];
}
process.on('exit', () => fs.rmSync(SUITE_HOME, { recursive: true, force: true }));

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
  } finally {
    cleanupFixtures();
  }
}

function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  everCreated.push(dir);
  return dir;
}

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: ENV });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function write(repo, rel, content) {
  const file = path.join(repo, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A fixture repo from a {relpath: content} map. */
function mk(files, { initGit = true } = {}) {
  const repo = tmp('harness-status-');
  if (initGit) {
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'test@example.invalid']);
    git(repo, ['config', 'user.name', 'Test']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
  }
  for (const [rel, content] of Object.entries(files)) write(repo, rel, content);
  return repo;
}

function run(repo, args = [], script = SCRIPT) {
  return spawnSync(process.execPath, [script, repo, ...args], { encoding: 'utf8', env: ENV });
}

function report(repo, script = SCRIPT) {
  const r = run(repo, [], script);
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function ids(rep) {
  return rep.hazards.map(h => h.id);
}

function statusOf(rep, rel, block) {
  const row = rep.entries.find(e => e.path === rel && (e.block || undefined) === block);
  assert.ok(row, `no entry for ${rel}${block ? `#${block}` : ''}`);
  return row.status;
}

function sha(text) {
  return crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

function hashes(repo, specs) {
  const r = run(repo, ['--hash', ...specs]);
  assert.strictEqual(r.status, 0, `hash exit ${r.status}: ${r.stderr}`);
  const out = {};
  for (const line of r.stdout.trim().split('\n')) {
    const m = line.match(/^([0-9a-f]{64}) {2}(.+)$/);
    assert.ok(m, `bad hash line: ${line}`);
    out[m[2]] = m[1];
  }
  return out;
}

function snapshot(dir) {
  const out = [];
  (function rec(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { out.push(`d ${path.relative(dir, full)}`); rec(full); }
      else { const s = fs.lstatSync(full); out.push(`f ${path.relative(dir, full)} ${s.size} ${s.mtimeMs}`); }
    }
  })(dir);
  return out.sort().join('\n');
}

/** Writes a copy of the shipped script with one named replacement applied; asserts it applied. */
function mutantOf(from, to) {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const mutated = src.replace(from, to);
  assert.notStrictEqual(mutated, src, `replacement did not apply: ${from}`);
  const file = path.join(tmp('harness-status-mutant-'), 'harness-status.js');
  fs.writeFileSync(file, mutated);
  return file;
}

const GATES = 'Gate rule one\nGate rule two';
const AGENTS_MD = [
  '# Agents', '',
  '<!-- harness:begin gates -->', GATES, '<!-- harness:end gates -->', '',
  '<!-- harness:begin policy -->', 'Never-auto policy: REVIEWED', 'Money paths are never merged on agent output.', '<!-- harness:end policy -->', '',
].join('\n');
const PRE_COMMIT = '#!/bin/sh\n# harness-bootstrap commit guard\nexit 0\n';

/** A manifest install whose manifest hashes come from the script's own --hash. */
function manifestFixture() {
  const repo = mk({
    'AGENTS.md': AGENTS_MD,
    '.githooks/pre-commit': PRE_COMMIT,
    'docs/harness-log.md': '# Harness log\n',
    'scripts/gone.sh': 'echo hi\n',
    // the commit lock (item 3) and its merge hook (item 4) of a complete install
    '.claude/registry.md': '# Registry\n<!-- harness:active -->\n<!-- /harness:active -->\n',
    '.githooks/pre-merge-commit': '#!/bin/sh\nsh .githooks/harness-guard.sh\n',
  });
  git(repo, ['config', 'core.hooksPath', '.githooks']);
  const h = hashes(repo, ['AGENTS.md#gates', '.githooks/pre-commit', 'scripts/gone.sh']);
  const manifest = {
    schema: 1, skill: 'harness-bootstrap', skillVersion: 2, generated: '2026-10-19',
    modes: ['change'], targets: ['claude'], roles: { runner: 'task-runner' },
    entries: [
      { path: 'AGENTS.md', block: 'gates', kind: 'generated', sha256: h['AGENTS.md#gates'] },
      { path: 'AGENTS.md', block: 'policy', kind: 'reviewed' },
      { path: '.githooks/pre-commit', kind: 'generated', template: 'templates/harness-guard.sh', templateSha256: 'f'.repeat(64), sha256: h['.githooks/pre-commit'] },
      { path: 'docs/harness-log.md', kind: 'scaffold' },
      { path: 'scripts/gone.sh', kind: 'generated', sha256: h['scripts/gone.sh'] },
    ],
  };
  write(repo, '.agents/harness-manifest.json', JSON.stringify(manifest, null, 2));
  fs.unlinkSync(path.join(repo, 'scripts', 'gone.sh'));
  return repo;
}

// ── fresh and legacy repos ───────────────────────────────────────────────────

console.log('\nharness-status: lineage and hazards');

test('empty fresh repo: verdict none, no hazards, manifest null', () => {
  const rep = report(mk({}));
  assert.strictEqual(rep.lineage.verdict, 'none');
  assert.deepStrictEqual(rep.hazards, []);
  assert.strictEqual(rep.manifest, null);
  assert.deepStrictEqual(rep.entries, []);
  assert.strictEqual(rep.sizes['AGENTS.md'], null);
  assert.deepStrictEqual(rep.ids, { DEC: 0, D: 0, Q: 0, Dnum: 0 });
});

test('a non-git directory is tolerated', () => {
  const rep = report(mk({ 'AGENTS.md': '# x\n' }, { initGit: false }));
  assert.strictEqual(rep.lineage.verdict, 'none');
  assert.strictEqual(rep.sizes['AGENTS.md'], 4);
});

function legacyPlan() {
  return mk({
    '.claude/registry.md': '# Registry\n',
    '.claude/skills/task-runner/SKILL.md': '# task-runner\n',
    '.claude/agents/plan-conformance-auditor.md': '---\nname: plan-conformance-auditor\ntools: Read, Grep\n---\nAudits.\n',
    'CLAUDE.md': '# Project\n\nThe registry lists open work; the guard will refuse commits otherwise.\n\n## Never-auto categories\n\n- money\n',
    '.agents/skills/vendor-x/SKILL.md': '# vendor-x\n',
  });
}

test('legacy plan install: verdict plan and the four hazards', () => {
  const rep = report(legacyPlan());
  assert.strictEqual(rep.lineage.verdict, 'plan');
  assert.deepStrictEqual(rep.lineage.change, []);
  for (const id of ['registry-no-markers', 'guard-snippet-only', 'policy-no-status', 'skill-unlinked']) {
    assert.ok(ids(rep).includes(id), `missing hazard ${id}; got ${ids(rep)}`);
  }
  assert.ok(!ids(rep).includes('guard-missing'));
  assert.strictEqual(rep.manifest, null);
  assert.ok(rep.entries.length >= 3);
  assert.ok(rep.entries.every(e => e.kind === 'unknown' && e.status === 'legacy'));
  assert.ok(rep.entries.some(e => e.path === '.claude/registry.md'));
});

test('registry with markers and a pre-commit hook raises neither hazard', () => {
  const repo = mk({
    '.claude/registry.md': '# Registry\n<!-- harness:active -->\n<!-- /harness:active -->\n',
    '.git/hooks/pre-commit': '#!/bin/sh\nexit 0\n',
  });
  const got = ids(report(repo));
  assert.ok(!got.includes('registry-no-markers') && !got.includes('guard-missing') && !got.includes('guard-snippet-only'), got.join());
});

test('registry without any guard and no snippet: guard-missing; husky mention clears it', () => {
  const repo = mk({ '.claude/registry.md': '# Registry\n<!-- harness:active -->\n<!-- /harness:active -->\n' });
  assert.ok(ids(report(repo)).includes('guard-missing'));
  write(repo, '.husky/pre-commit', 'sh .githooks/harness-guard.sh\n');
  const got = ids(report(repo));
  assert.ok(!got.includes('guard-missing') && !got.includes('guard-snippet-only'));
});

test('core.hooksPath is honoured for the guard check', () => {
  const repo = mk({ '.claude/registry.md': '<!-- harness:active -->\n<!-- /harness:active -->\n', '.githooks/pre-commit': 'exit 0\n' });
  assert.ok(ids(report(repo)).includes('guard-missing'));
  git(repo, ['config', 'core.hooksPath', '.githooks']);
  assert.ok(!ids(report(repo)).includes('guard-missing'));
});

const SECRET = 'abcd1234efgh5678ijkl';

function legacyChange() {
  return mk({
    '.claude/skills/change-workflow/SKILL.md': `# change-workflow\napi_key: "${SECRET}"\n`,
    '.claude/agents/crosscheck-auditor.md': '---\nname: crosscheck-auditor\ndescription: Read-only auditor.\ntools: Read, Grep, Glob, Bash\n---\nBody.\n',
    '.claude/settings.json': JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write $CLAUDE_FILE_PATHS' }] }] } }, null, 2),
    'docs/plans/x.state.md': 'x'.repeat(9000),
    '.githooks/commit-msg': '#!/bin/sh\ngrep -q "\\[tier:" "$1" || exit 1\n',
  });
}

test('legacy change install: verdict change and the five hazards', () => {
  const rep = report(legacyChange());
  assert.strictEqual(rep.lineage.verdict, 'change');
  assert.deepStrictEqual(rep.lineage.plan, []);
  for (const id of ['readonly-agent-has-write-tools', 'hook-undocumented-var', 'secret-in-agent-files', 'state-file-over-budget', 'keyword-commit-hook']) {
    assert.ok(ids(rep).includes(id), `missing hazard ${id}; got ${ids(rep)}`);
  }
  const secret = rep.hazards.find(h => h.id === 'secret-in-agent-files');
  assert.strictEqual(secret.path, '.claude/skills/change-workflow/SKILL.md');
  assert.strictEqual(secret.line, 2);
  assert.deepStrictEqual(rep.sizes.stateFiles, [{ path: 'docs/plans/x.state.md', bytes: 9000 }]);
});

test('the secret value never appears in stdout (json or text)', () => {
  const repo = legacyChange();
  assert.ok(!run(repo).stdout.includes(SECRET));
  assert.ok(!run(repo, ['--text']).stdout.includes(SECRET));
  assert.ok(!run(repo, ['--text']).stdout.includes('abcd1234'));
});

test('other secret shapes are found', () => {
  const repo = mk({
    '.claude/rules/a.md': 'key AKIAABCDEFGHIJKLMNOP\n',
    '.agents/skills/s/SKILL.md': '-----BEGIN RSA PRIVATE KEY-----\n',
    '.claude/agents/a.md': 'token sk-abcdefghijklmnopqrstuv\n',
  });
  const found = report(repo).hazards.filter(h => h.id === 'secret-in-agent-files').map(h => h.path).sort();
  assert.deepStrictEqual(found, ['.agents/skills/s/SKILL.md', '.claude/agents/a.md', '.claude/rules/a.md']);
});

test('lineage fingerprints: Missed by harness, codex-run, tier table, both', () => {
  const repo = mk({
    'docs/notes.md': 'Missed by harness: a thing\n',
    'scripts/codex-run.mjs': '// x\n',
    'AGENTS.md': '| tier | route |\n| Trivial | direct |\n| Full | everything |\n',
  });
  const rep = report(repo);
  assert.strictEqual(rep.lineage.verdict, 'both');
  assert.ok(rep.lineage.plan.some(e => e.startsWith('docs/notes.md')));
  assert.ok(rep.lineage.change.includes('scripts/codex-run.mjs'));
  assert.ok(rep.lineage.change.some(e => e.startsWith('AGENTS.md')));
});

test('size hazards, skill drift, id counts', () => {
  const repo = mk({
    'AGENTS.md': 'a'.repeat(32769),
    'CLAUDE.md': 'b'.repeat(40001),
    '.agents/skills/s/SKILL.md': 'one\n',
    '.claude/skills/s/SKILL.md': 'two\n',
    'docs/decisions.md': 'DEC-1 DEC-2 DEC-2 D-7 Q-1 Q-2 Q-3\n',
  });
  const rep = report(repo);
  for (const id of ['agents-md-codex-truncation', 'claude-md-large', 'skill-link-drift']) assert.ok(ids(rep).includes(id), id);
  assert.deepStrictEqual(rep.ids, { DEC: 2, D: 1, Q: 3, Dnum: 0 });
  // an identical copy is not drift, and a symlink to the .agents skill is not drift
  write(repo, '.claude/skills/s/SKILL.md', 'one\n');
  assert.ok(!ids(report(repo)).includes('skill-link-drift'));
  fs.rmSync(path.join(repo, '.claude', 'skills', 's'), { recursive: true });
  fs.symlinkSync(path.join(repo, '.agents', 'skills', 's'), path.join(repo, '.claude', 'skills', 's'), 'dir');
  assert.ok(!ids(report(repo)).includes('skill-link-drift'));
});

test('a read-only agent without write tools is fine', () => {
  const repo = mk({ '.claude/agents/a.md': '---\nname: a\ntools: Read, Grep\n---\nRead-only reviewer.\n' });
  assert.ok(!ids(report(repo)).includes('readonly-agent-has-write-tools'));
});

const REGISTRY = '# Registry\n<!-- harness:active -->\n<!-- /harness:active -->\n';

test('linked worktree: the shared hooks dir is found, no false guard-missing', () => {
  const repo = mk({ '.claude/registry.md': REGISTRY, '.git/hooks/pre-commit': '#!/bin/sh\nexit 0\n' });
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'fixture']);
  const wt = `${repo}-wt1`;
  created.push(wt);
  git(repo, ['worktree', 'add', '-q', wt]);
  assert.ok(fs.statSync(path.join(wt, '.git')).isFile(), 'worktree .git should be a file');
  assert.ok(!ids(report(repo)).includes('guard-missing'));
  assert.ok(!ids(report(wt)).includes('guard-missing'), 'false guard-missing in a linked worktree');
  // and a worktree of a repo with no guard still reports it
  fs.unlinkSync(path.join(repo, '.git', 'hooks', 'pre-commit'));
  assert.ok(ids(report(wt)).includes('guard-missing'));
});

test('a plain directory nested inside another repository does not inherit its hooks', () => {
  const outer = mk({ '.git/hooks/pre-commit': '#!/bin/sh\nexit 0\n' });
  write(outer, 'sub/.claude/registry.md', REGISTRY);
  const nested = path.join(outer, 'sub');
  assert.ok(ids(report(nested)).includes('guard-missing'), 'the outer repo hooks hid guard-missing');
  // the outer repository itself still sees its own hook
  write(outer, '.claude/registry.md', REGISTRY);
  assert.ok(!ids(report(outer)).includes('guard-missing'));
});

test('an inherited GIT_DIR (as inside a git hook) does not redirect the hooks lookup', () => {
  const decoy = mk({ '.git/hooks/pre-commit': '#!/bin/sh\nexit 0\n' });
  const plain = mk({ '.claude/registry.md': REGISTRY }, { initGit: false });
  const r = spawnSync(process.execPath, [SCRIPT, plain], {
    encoding: 'utf8',
    env: { ...ENV, GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: path.join(decoy, '.git', 'index') },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).hazards.some(h => h.id === 'guard-missing'), 'the decoy GIT_DIR hid guard-missing');
  // and a real repo is still judged by its own hooks, not the decoy's
  const real = mk({ '.claude/registry.md': REGISTRY, '.git/hooks/pre-commit': '#!/bin/sh\nexit 0\n' });
  const r2 = spawnSync(process.execPath, [SCRIPT, real], {
    encoding: 'utf8',
    env: { ...ENV, GIT_DIR: path.join(decoy, '.git') },
  });
  assert.ok(!JSON.parse(r2.stdout).hazards.some(h => h.id === 'guard-missing'));
});

test('the suite itself builds child envs without GIT_* variables', () => {
  process.env.GIT_DIR = '/nonexistent-decoy';
  try {
    assert.ok(!('GIT_DIR' in cleanEnv()));
  } finally {
    delete process.env.GIT_DIR;
  }
});

test('core.hooksPath with ~/ and a relative path resolve through git', () => {
  const home = tmp('harness-status-home-');
  write(home, 'hooks/pre-commit', 'exit 0\n');
  const repo = mk({ '.claude/registry.md': REGISTRY });
  git(repo, ['config', 'core.hooksPath', '~/hooks']);
  const r = spawnSync(process.execPath, [SCRIPT, repo], { encoding: 'utf8', env: { ...ENV, HOME: home, USERPROFILE: home } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!ids(JSON.parse(r.stdout)).includes('guard-missing'), 'tilde hooksPath not honoured');
});

test('lefthook.yml mentioning harness-guard counts as a guard; one that does not does not', () => {
  const repo = mk({ '.claude/registry.md': REGISTRY, 'lefthook.yml': 'pre-commit:\n  commands:\n    lint:\n      run: npm run lint\n' });
  assert.ok(ids(report(repo)).includes('guard-missing'));
  write(repo, 'lefthook.yml', 'pre-commit:\n  commands:\n    guard:\n      run: sh .githooks/harness-guard.sh\n');
  const got = ids(report(repo));
  assert.ok(!got.includes('guard-missing') && !got.includes('guard-snippet-only'), got.join());
});

test('mutant: lefthook lookup removed -> the lefthook assertion fails', () => {
  const mutantScript = mutantOf("read('lefthook.yml')", "read('lefthook.none')");
  const repo = mk({ '.claude/registry.md': REGISTRY, 'lefthook.yml': 'run: sh harness-guard.sh\n' });
  assert.ok(!ids(report(repo)).includes('guard-missing'));
  assert.ok(ids(report(repo, mutantScript)).includes('guard-missing'));
});

test('.agents/skills without .claude/skills is the expected layout: skill-unlinked stays quiet', () => {
  const repo = mk({ '.agents/skills/s/SKILL.md': 'one\n' });
  assert.ok(!ids(report(repo)).includes('skill-unlinked'));
  fs.mkdirSync(path.join(repo, '.claude', 'skills'), { recursive: true });
  assert.ok(ids(report(repo)).includes('skill-unlinked'));
  const mutantScript = mutantOf("if (isDir('.claude/skills')) haz('skill-unlinked'", "if (true) haz('skill-unlinked'");
  fs.rmSync(path.join(repo, '.claude'), { recursive: true });
  assert.ok(ids(report(repo, mutantScript)).includes('skill-unlinked'), 'mutant should be noisy');
});

test('state files inside other checkouts (.claude/worktrees, any dir with .git) are ignored', () => {
  const repo = mk({
    'docs/ok.md': 'x\n',
    '.claude/worktrees/w1/docs/plans/old.state.md': 'x'.repeat(9000),
    '.claude/worktrees/w1/.git': 'gitdir: /nonexistent\n',
    '.claude/worktrees/w2/big.state.md': 'x'.repeat(9000),
    'docs/nested/.git': 'gitdir: /nonexistent\n',
    'docs/nested/big.state.md': 'x'.repeat(9000),
    '.claude/agents/note.md': 'Fine.\n',
    '.claude/worktrees/w1/.claude/agents/bad.md': 'token = abcdefghijklmnop1234\n',
  });
  const rep = report(repo);
  assert.deepStrictEqual(rep.sizes.stateFiles, []);
  assert.ok(!ids(rep).includes('state-file-over-budget'), JSON.stringify(rep.hazards));
  // each rule on its own
  const onlyPath = mk({ '.claude/worktrees/w2/big.state.md': 'x'.repeat(9000) });
  assert.deepStrictEqual(report(onlyPath).sizes.stateFiles, []);
  const onlyGit = mk({ 'docs/nested/.git': 'gitdir: x\n', 'docs/nested/big.state.md': 'x'.repeat(9000) });
  assert.deepStrictEqual(report(onlyGit).sizes.stateFiles, []);
  const normal = mk({ 'docs/plans/big.state.md': 'x'.repeat(9000) });
  assert.strictEqual(report(normal).sizes.stateFiles.length, 1);
});

test('mutants: the .claude/worktrees skip and the nested .git skip each matter', () => {
  const repo = mk({
    '.claude/worktrees/w2/big.state.md': 'x'.repeat(9000),
    'docs/nested/.git': 'gitdir: x\n',
    'docs/nested/big.state.md': 'x'.repeat(9000),
  });
  assert.strictEqual(report(repo).sizes.stateFiles.length, 0);
  const noPath = mutantOf("rel === '.claude' && e.name === 'worktrees'", 'false');
  assert.strictEqual(report(repo, noPath).sizes.stateFiles.length, 1);
  const noGit = mutantOf("fs.existsSync(path.join(abs(child), '.git'))", 'false');
  assert.strictEqual(report(repo, noGit).sizes.stateFiles.length, 1);
});

test('a read-only agent with no tools line inherits every tool and is flagged', () => {
  const repo = mk({
    '.claude/agents/a.md': '---\nname: a\n---\nRead-only reviewer.\n',
    '.claude/agents/b.md': '---\nname: b\ndescription: Read-only auditor\ntools: Read, Grep\n---\nBody.\n',
    '.claude/agents/c.md': '---\nname: c\n---\nWrites freely.\n',
  });
  const found = report(repo).hazards.filter(h => h.id === 'readonly-agent-has-write-tools');
  assert.deepStrictEqual(found.map(h => h.path), ['.claude/agents/a.md']);
  assert.ok(/no tools: line/.test(found[0].detail), found[0].detail);
});

test('a symlinked CLAUDE.md -> AGENTS.md is reported once (markers, policy, tier table)', () => {
  const repo = mk({
    'AGENTS.md': '<!-- harness:begin gates -->\n| tier | route |\n| Trivial | direct |\n| Full | all |\nNever-auto categories:\n- money\n',
  });
  fs.symlinkSync('AGENTS.md', path.join(repo, 'CLAUDE.md'));
  const rep = report(repo);
  const count = id => rep.hazards.filter(h => h.id === id).length;
  assert.strictEqual(count('marker-unbalanced'), 1, JSON.stringify(rep.hazards));
  assert.strictEqual(count('policy-no-status'), 1);
  assert.strictEqual(rep.markers.length, 1);
  assert.strictEqual(rep.lineage.change.filter(e => /tier table/.test(e)).length, 1);
  assert.strictEqual(rep.sizes['AGENTS.md'], rep.sizes['CLAUDE.md']);
});

test('skill-link-drift words a dangling link and a link elsewhere truthfully', () => {
  const dangling = mk({ '.agents/skills/s/SKILL.md': 'one\n' });
  fs.mkdirSync(path.join(dangling, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(path.join(dangling, 'nowhere'), path.join(dangling, '.claude', 'skills', 's'), 'dir');
  const d = report(dangling).hazards.find(h => h.id === 'skill-link-drift');
  assert.ok(d, 'dangling link not flagged');
  assert.ok(/dangling/.test(d.detail) && !/not a symlink/.test(d.detail), d.detail);

  const elsewhere = mk({ '.agents/skills/s/SKILL.md': 'one\n', 'other/s/SKILL.md': 'two\n' });
  fs.mkdirSync(path.join(elsewhere, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(path.join(elsewhere, 'other', 's'), path.join(elsewhere, '.claude', 'skills', 's'), 'dir');
  const e = report(elsewhere).hazards.find(h => h.id === 'skill-link-drift');
  assert.ok(e, 'link to another copy not flagged');
  assert.ok(/points elsewhere/.test(e.detail) && !/not a symlink/.test(e.detail), e.detail);

  const copy = mk({ '.agents/skills/s/SKILL.md': 'one\n', '.claude/skills/s/SKILL.md': 'two\n' });
  assert.ok(/not a symlink/.test(report(copy).hazards.find(h => h.id === 'skill-link-drift').detail));
});

// ── manifest ─────────────────────────────────────────────────────────────────

console.log('\nharness-status: manifest status');

test('--hash: block text excludes the marker lines and newlines; file hash is of the whole text', () => {
  const repo = manifestFixture();
  const h = hashes(repo, ['AGENTS.md#gates', 'AGENTS.md', '.githooks/pre-commit']);
  assert.strictEqual(h['AGENTS.md#gates'], sha(GATES));
  assert.strictEqual(h['AGENTS.md'], sha(AGENTS_MD));
  assert.strictEqual(h['.githooks/pre-commit'], sha(PRE_COMMIT));
});

test('manifest install: unchanged, reviewed, scaffold, and a deleted file is missing', () => {
  const rep = report(manifestFixture());
  assert.strictEqual(rep.manifest.schema, 1);
  assert.strictEqual(rep.manifest.skillVersion, 2);
  assert.deepStrictEqual(rep.manifest.modes, ['change']);
  assert.strictEqual(statusOf(rep, 'AGENTS.md', 'gates'), 'unchanged');
  assert.strictEqual(statusOf(rep, 'AGENTS.md', 'policy'), 'reviewed');
  assert.strictEqual(statusOf(rep, '.githooks/pre-commit'), 'unchanged');
  assert.strictEqual(statusOf(rep, 'docs/harness-log.md'), 'scaffold');
  assert.strictEqual(statusOf(rep, 'scripts/gone.sh'), 'missing');
  assert.deepStrictEqual(rep.markers.map(m => [m.block, m.ok]), [['gates', true], ['policy', true]]);
  assert.deepStrictEqual(rep.hazards, []);
});

test('editing a generated file marks it edited; editing the gates block marks only gates', () => {
  const repo = manifestFixture();
  write(repo, '.githooks/pre-commit', `${PRE_COMMIT}# local tweak\n`);
  let rep = report(repo);
  assert.strictEqual(statusOf(rep, '.githooks/pre-commit'), 'edited');
  assert.strictEqual(statusOf(rep, 'AGENTS.md', 'gates'), 'unchanged');
  write(repo, 'AGENTS.md', AGENTS_MD.replace('Gate rule two', 'Gate rule TWO'));
  rep = report(repo);
  assert.strictEqual(statusOf(rep, 'AGENTS.md', 'gates'), 'edited');
  assert.strictEqual(statusOf(rep, 'AGENTS.md', 'policy'), 'reviewed');
});

test('editing outside the block leaves the block unchanged', () => {
  const repo = manifestFixture();
  write(repo, 'AGENTS.md', `Intro line\n${AGENTS_MD}\nTrailing\n`);
  assert.strictEqual(statusOf(report(repo), 'AGENTS.md', 'gates'), 'unchanged');
});

test('a removed block is missing', () => {
  const repo = manifestFixture();
  write(repo, 'AGENTS.md', '# Agents\n');
  assert.strictEqual(statusOf(report(repo), 'AGENTS.md', 'gates'), 'missing');
});

test('CRLF copies of unchanged files stay unchanged', () => {
  const repo = manifestFixture();
  for (const rel of ['AGENTS.md', '.githooks/pre-commit']) {
    const file = path.join(repo, ...rel.split('/'));
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  }
  const rep = report(repo);
  assert.strictEqual(statusOf(rep, 'AGENTS.md', 'gates'), 'unchanged');
  assert.strictEqual(statusOf(rep, '.githooks/pre-commit'), 'unchanged');
});

test('invalid JSON and unknown schema give manifest-invalid with no entries', () => {
  for (const body of ['{ not json', JSON.stringify({ schema: 2, entries: [{ path: 'a', kind: 'scaffold' }] })]) {
    const repo = mk({ '.agents/harness-manifest.json': body, '.claude/registry.md': 'x' });
    const rep = report(repo);
    assert.ok(ids(rep).includes('manifest-invalid'));
    assert.strictEqual(rep.manifest, null);
    assert.deepStrictEqual(rep.entries, []);
  }
});

test('manifest-invalid reports a position or fixed text, never input characters', () => {
  const secret = 'SECRETWORD9876';
  const bodies = [
    `{ "schema": 1, "token": ${secret} }`,
    JSON.stringify({ schema: secret, entries: [] }),
    JSON.stringify({ schema: 1, entries: secret }),
  ];
  for (const body of bodies) {
    const repo = mk({ '.agents/harness-manifest.json': body });
    for (const r of [run(repo), run(repo, ['--text'])]) {
      assert.strictEqual(r.status, 0, r.stderr);
      assert.ok(!r.stdout.includes(secret), `input text leaked: ${r.stdout}`);
    }
    assert.ok(ids(report(repo)).includes('manifest-invalid'));
  }
  const pos = report(mk({ '.agents/harness-manifest.json': '{ "schema": 1,, }' })).hazards.find(h => h.id === 'manifest-invalid');
  assert.ok(/^invalid JSON( at position \d+)?$/.test(pos.detail), pos.detail);
});

test('manifest paths that escape the repo are reported missing, not read', () => {
  const repo = mk({
    '.agents/harness-manifest.json': JSON.stringify({ schema: 1, entries: [{ path: '../outside.txt', kind: 'generated', sha256: 'x' }] }),
  });
  assert.strictEqual(statusOf(report(repo), '../outside.txt'), 'missing');
});

test('marker-unbalanced for a begin without an end, an orphan end, and nesting', () => {
  const rep1 = report(mk({ 'AGENTS.md': '<!-- harness:begin gates -->\ntext\n' }));
  assert.ok(ids(rep1).includes('marker-unbalanced'));
  assert.deepStrictEqual(rep1.markers.map(m => [m.block, m.ok]), [['gates', false]]);
  const rep2 = report(mk({ 'CLAUDE.md': 'text\n<!-- harness:end gates -->\n' }));
  assert.ok(ids(rep2).includes('marker-unbalanced'));
  const rep3 = report(mk({ 'AGENTS.md': '<!-- harness:begin a -->\n<!-- harness:begin b -->\n<!-- harness:end b -->\n<!-- harness:end a -->\n' }));
  assert.ok(ids(rep3).includes('marker-unbalanced'));
  assert.ok(rep3.markers.every(m => m.ok === false));
});

// ── CLI behaviour ────────────────────────────────────────────────────────────

console.log('\nharness-status: cli');

/** Fixture whose run reaches the git hooks lookup: registry present, core.hooksPath set. */
function readOnlyFixture() {
  const repo = legacyChange();
  write(repo, 'AGENTS.md', AGENTS_MD);
  write(repo, '.claude/registry.md', '# Registry\n<!-- harness:active -->\n<!-- /harness:active -->\n');
  git(repo, ['config', 'core.hooksPath', '.githooks']);
  return repo;
}

test('a run never writes anything (git status and file tree identical)', () => {
  const repo = readOnlyFixture();
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'fixture']);
  const statusBefore = git(repo, ['status', '--porcelain']);
  const before = snapshot(repo);
  assert.strictEqual(run(repo).status, 0);
  assert.strictEqual(run(repo, ['--text']).status, 0);
  assert.strictEqual(run(repo, ['--hash', 'AGENTS.md', 'AGENTS.md#gates']).status, 0);
  const after = snapshot(repo);
  assert.strictEqual(after, before);
  assert.strictEqual(git(repo, ['status', '--porcelain']), statusBefore);
  assert.strictEqual(statusBefore, '');
});

test('read-only snapshot catches a git write in the hooks lookup (in-suite mutant)', () => {
  const mutantScript = mutantOf(
    'function hooksDir() {',
    "function hooksDir() { spawnSync('git', ['-C', REPO, 'config', 'harness.mutant', '1']);"
  );
  const repo = readOnlyFixture();
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'fixture']);
  git(repo, ['status', '--porcelain']);
  const before = snapshot(repo);
  assert.strictEqual(run(repo, [], mutantScript).status, 0);
  assert.notStrictEqual(snapshot(repo), before, 'the snapshot did not notice a write to .git/config');
});

test('--text mentions the verdict, evidence, every hazard id, and is ASCII', () => {
  const repo = legacyChange();
  const rep = report(repo);
  const r = run(repo, ['--text']);
  assert.strictEqual(r.status, 0);
  assert.ok(/lineage: change/.test(r.stdout));
  assert.ok(r.stdout.includes('.claude/skills/change-workflow/SKILL.md'));
  for (const id of new Set(ids(rep))) assert.ok(r.stdout.includes(id), `text lacks ${id}`);
  assert.ok([...r.stdout].every(c => c.charCodeAt(0) < 128), 'non-ASCII in text output');
  const m = run(manifestFixture(), ['--text']).stdout;
  assert.ok(/Path\[#block\] \| Kind \| Status/.test(m));
  assert.ok(m.includes('AGENTS.md#gates | generated | unchanged'));
  assert.ok(run(mk({}), ['--text']).stdout.includes('no manifest'));
});

test('usage errors exit 2', () => {
  const repo = mk({ 'a.txt': 'x\n' });
  const bad = [
    spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: ENV }),
    run(path.join(repo, 'does-not-exist')),
    run(path.join(repo, 'a.txt')),
    run(repo, ['--bogus']),
    run(repo, ['--hash']),
    run(repo, ['--hash', 'a.txt', '--text']),
    spawnSync(process.execPath, [SCRIPT, repo, 'second'], { encoding: 'utf8', env: ENV }),
  ];
  for (const r of bad) {
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}: ${r.stdout}`);
    assert.ok(r.stderr.length > 0);
  }
});

test('--hash and --text cannot be combined, in either order, and nothing is hashed', () => {
  const repo = mk({ 'a.txt': 'x\n' });
  for (const args of [['--hash', 'a.txt', '--text'], ['--text', '--hash', 'a.txt'], ['--hash', '--text']]) {
    const r = run(repo, args);
    assert.strictEqual(r.status, 2, args.join(' '));
    assert.ok(/cannot be combined/.test(r.stderr), `stderr for ${args.join(' ')}: ${r.stderr}`);
    assert.strictEqual(r.stdout, '', `stdout for ${args.join(' ')}: ${r.stdout}`);
  }
});

test('--hash on a missing path or block exits 2 but still prints the others', () => {
  const repo = manifestFixture();
  for (const spec of ['nope.md', 'AGENTS.md#nope', '../x']) {
    const r = run(repo, ['--hash', spec]);
    assert.strictEqual(r.status, 2, spec);
  }
  const r = run(repo, ['--hash', 'AGENTS.md', 'nope.md']);
  assert.strictEqual(r.status, 2);
  assert.ok(/^[0-9a-f]{64} {2}AGENTS\.md\n/.test(r.stdout));
});

test('node_modules, dist and .worktrees are not descended into', () => {
  const repo = mk({
    'docs/ok.md': 'x\n',
    'docs/node_modules/p/big.state.md': 'x'.repeat(9000),
    'docs/dist/big.state.md': 'x'.repeat(9000),
    '.claude/.worktrees/w/big.state.md': 'x'.repeat(9000),
  });
  assert.ok(!ids(report(repo)).includes('state-file-over-budget'));
});

// ── verification-round gaps ──────────────────────────────────────────────────

console.log('\nharness-status: verification round');

function reportEnv(repo, extra, script = SCRIPT) {
  const r = spawnSync(process.execPath, [script, repo], { encoding: 'utf8', env: { ...ENV, ...extra } });
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function agentFlagged(body) {
  const repo = mk({ '.claude/agents/a.md': `---\nname: a\ntools: Read, Grep, Bash\n---\n${body}\n` });
  return ids(report(repo)).includes('readonly-agent-has-write-tools');
}

test('1. read-only claims: a negation is not a claim, a claim next to a negation still is', () => {
  for (const neg of [
    'You hold Bash, so you are not read-only.',
    "This agent isn't read-only.",
    'It is never read-only.',
    'No longer read-only since the tools changed.',
    'It is not a read-only agent.',
  ]) assert.ok(!agentFlagged(neg), `flagged a negation: ${neg}`);
  for (const claim of ['Read-only reviewer.', 'You are read-only. Report only.', 'You are not read-only here.\nElsewhere: a read-only pass.']) {
    assert.ok(agentFlagged(claim), `missed a claim: ${claim}`);
  }
});

test('1. the claim rule is exported for the agent-docs lint', () => {
  const { READONLY_CLAIM } = require(SCRIPT);
  assert.ok(READONLY_CLAIM instanceof RegExp);
  assert.ok(READONLY_CLAIM.test('Read-only auditor') && !READONLY_CLAIM.test('you are not read-only'));
});

test('1. mutant: the old anywhere-match flags the negation', () => {
  const m = mutantOf('!READONLY_CLAIM.test(t)', '!/read-only/i.test(t)');
  const repo = mk({ '.claude/agents/a.md': '---\nname: a\ntools: Bash\n---\nYou are not read-only.\n' });
  assert.ok(!ids(report(repo)).includes('readonly-agent-has-write-tools'));
  assert.ok(ids(report(repo, m)).includes('readonly-agent-has-write-tools'));
});

const V2_CORE = {
  '.claude/registry.md': '# Registry\n<!-- harness:active -->\n<!-- /harness:active -->\n',
  '.claude/skills/task-runner/SKILL.md': '# task-runner\n',
  '.claude/agents/plan-conformance-auditor.md': '---\nname: p\ntools: Read\n---\nx\n',
  '.claude/agents/claim-auditor.md': '---\nname: c\ntools: Read\n---\nx\n',
  'docs/harness/log.md': '# Log\n\nMissed by harness: none\n',
};

function v2(modes, extra = {}) {
  const manifest = { schema: 1, skill: 'harness-bootstrap', skillVersion: 2, generated: '2026-10-19', modes, targets: ['claude'], entries: [] };
  return mk({ ...V2_CORE, ...extra, '.agents/harness-manifest.json': JSON.stringify(manifest) });
}

test('2. lineage on a v2 install comes from manifest.modes; v2 core files are plan evidence only without a manifest', () => {
  const change = report(v2(['change'], { '.claude/skills/change-workflow/SKILL.md': '# cw\n' }));
  assert.strictEqual(change.lineage.verdict, 'change');
  assert.deepStrictEqual(change.lineage.plan, []);
  assert.strictEqual(report(v2(['plan'])).lineage.verdict, 'plan');
  assert.strictEqual(report(v2(['plan', 'change'])).lineage.verdict, 'both');
  assert.strictEqual(report(v2(['change'])).lineage.verdict, 'change');
  // the same files with no manifest are a v1 plan install
  const v1 = mk({ ...V2_CORE });
  assert.strictEqual(report(v1).lineage.verdict, 'plan');
  assert.ok(report(v1).lineage.plan.length >= 4);
});

test('3. lock-missing: a lineage or a manifest without a registry; not otherwise', () => {
  const lineage = mk({ '.claude/skills/change-workflow/SKILL.md': '# cw\n' });
  const rep = report(lineage);
  assert.ok(ids(rep).includes('lock-missing'), ids(rep).join());
  assert.ok(/no registry, no guard/.test(rep.hazards.find(h => h.id === 'lock-missing').detail));
  const man = mk({ '.agents/harness-manifest.json': JSON.stringify({ schema: 1, modes: ['change'], entries: [] }) });
  assert.ok(ids(report(man)).includes('lock-missing'));
  assert.ok(!ids(report(mk({}))).includes('lock-missing'));
  assert.ok(!ids(report(mk({ '.claude/registry.md': REGISTRY }))).includes('lock-missing'));
});

test('3. mutant: lock-missing keyed on the wrong condition is noticed', () => {
  const m = mutantOf("haz('lock-missing'", "haz('lock-missing-x'");
  const repo = mk({ '.claude/skills/change-workflow/SKILL.md': '# cw\n' });
  assert.ok(ids(report(repo)).includes('lock-missing') && !ids(report(repo, m)).includes('lock-missing'));
});

test('4. merge-unguarded: a pre-commit guard without a pre-merge-commit guard', () => {
  const repo = mk({ '.claude/registry.md': REGISTRY, '.git/hooks/pre-commit': '#!/bin/sh\nexit 0\n' });
  const rep = report(repo);
  assert.ok(ids(rep).includes('merge-unguarded') && !ids(rep).includes('guard-missing'));
  assert.ok(/pre-merge-commit/.test(rep.hazards.find(h => h.id === 'merge-unguarded').detail));
  write(repo, '.git/hooks/pre-merge-commit', '#!/bin/sh\nexit 0\n');
  assert.ok(ids(report(repo)).includes('merge-unguarded'), 'a hook that does not run the guard');
  write(repo, '.git/hooks/pre-merge-commit', '#!/bin/sh\nexec "$(dirname "$0")/pre-commit"\n');
  assert.ok(!ids(report(repo)).includes('merge-unguarded'));
  // no guard at all: guard-missing, not merge-unguarded
  const none = ids(report(mk({ '.claude/registry.md': REGISTRY })));
  assert.ok(none.includes('guard-missing') && !none.includes('merge-unguarded'));
});

test('4. merge-unguarded: husky and lefthook', () => {
  const husky = mk({ '.claude/registry.md': REGISTRY, '.husky/pre-commit': 'sh .githooks/harness-guard.sh\n' });
  assert.ok(ids(report(husky)).includes('merge-unguarded'));
  write(husky, '.husky/pre-merge-commit', 'sh .githooks/harness-guard.sh\n');
  assert.ok(!ids(report(husky)).includes('merge-unguarded'));
  const guardOnly = 'pre-commit:\n  commands:\n    guard:\n      run: sh .githooks/harness-guard.sh\n';
  const lh = mk({ '.claude/registry.md': REGISTRY, 'lefthook.yml': guardOnly });
  assert.ok(ids(report(lh)).includes('merge-unguarded'));
  write(lh, 'lefthook.yml', `${guardOnly}pre-merge-commit:\n  commands:\n    guard:\n      run: sh .githooks/harness-guard.sh\n`);
  assert.ok(!ids(report(lh)).includes('merge-unguarded'));
  write(lh, 'lefthook.yml', `${guardOnly}pre-merge-commit:\n  commands:\n    lint:\n      run: npm run lint\n`);
  assert.ok(ids(report(lh)).includes('merge-unguarded'));
});

test('5. hook-undocumented-var: every line, and the detail says the hook receives nothing', () => {
  const settings = [
    '{', '  "hooks": { "PostToolUse": [', '    { "matcher": "Edit", "hooks": [',
    '      { "type": "command", "command": "prettier --write $CLAUDE_FILE_PATHS" },',
    '      { "type": "command", "command": "echo ok" },',
    '      { "type": "command", "command": "eslint ${CLAUDE_FILE_PATHS}" }',
    '    ] } ] } }', '',
  ].join('\n');
  const rep = report(mk({ '.claude/settings.json': settings }));
  const found = rep.hazards.filter(h => h.id === 'hook-undocumented-var');
  assert.deepStrictEqual(found.map(h => h.line), [4, 6]);
  for (const h of found) assert.ok(/receives nothing/.test(h.detail) && /not set/.test(h.detail), h.detail);
});

test('6. the Codex size limit is read from CODEX_HOME or ~/.codex config.toml', () => {
  const agents = 'a'.repeat(40000);
  const home = tmp('harness-status-codexhome-');
  const repo = mk({ 'AGENTS.md': agents });
  const hz = r => r.hazards.find(h => h.id === 'agents-md-codex-truncation');
  const none = reportEnv(repo, { HOME: home, USERPROFILE: home });
  assert.ok(/32768/.test(hz(none).detail), 'default limit');
  write(home, '.codex/config.toml', 'model = "x"\nproject_doc_max_bytes = 65536\n');
  const raised = reportEnv(repo, { HOME: home, USERPROFILE: home });
  assert.strictEqual(hz(raised), undefined);
  assert.strictEqual(raised.sizes.codexLimit.bytes, 65536);
  assert.ok(raised.sizes.codexLimit.source.includes('config.toml'));
  // a smaller limit flags a smaller file and names the source; CODEX_HOME wins over ~/.codex
  const other = tmp('harness-status-codexenv-');
  write(other, 'config.toml', 'project_doc_max_bytes = 20000\n');
  const small = mk({ 'AGENTS.md': 'a'.repeat(25000) });
  const got = hz(reportEnv(small, { HOME: home, USERPROFILE: home, CODEX_HOME: other }));
  assert.ok(got, 'limit from CODEX_HOME not used');
  assert.ok(/20000/.test(got.detail) && got.detail.includes(path.join(other, 'config.toml')), got.detail);
});

test('6. mutant: the hard-coded limit would flag a raised-limit install', () => {
  const m = mutantOf('sizes.codexLimit.bytes', '32768');
  const home = tmp('harness-status-codexhome-');
  write(home, '.codex/config.toml', 'project_doc_max_bytes = 65536\n');
  const repo = mk({ 'AGENTS.md': 'a'.repeat(40000) });
  assert.ok(!ids(reportEnv(repo, { HOME: home })).includes('agents-md-codex-truncation'));
  assert.ok(ids(reportEnv(repo, { HOME: home }, m)).includes('agents-md-codex-truncation'));
});

test('7. ids: marker blocks ignored, D<digits> in its own bucket, .claude/plans walked', () => {
  const repo = mk({
    'AGENTS.md': '# A\n<!-- harness:begin rules -->\nkeep line: DEC-1 D-9 Q-9 D99\n<!-- harness:end rules -->\nDEC-2\n',
    'docs/d.md': 'D12 D345 D12 D1 D12345 d77 and D-3\n',
    '.claude/plans/p.md': 'DEC-5 Q-4 D200\n',
    '.claude/notes/deep.md': 'DEC-77\n',
  });
  assert.deepStrictEqual(report(repo).ids, { DEC: 2, D: 1, Q: 1, Dnum: 3 });
  // an unbalanced begin does not hide the rest of the file
  const open = mk({ 'AGENTS.md': '<!-- harness:begin rules -->\nDEC-1 DEC-2\n' });
  assert.strictEqual(report(open).ids.DEC, 2);
  const txt = run(repo, ['--text']).stdout;
  assert.ok(/Dnum 3/.test(txt), txt);
});

test('8. --text prints the markers section, balanced and unbalanced', () => {
  const ok = run(mk({ 'AGENTS.md': AGENTS_MD }), ['--text']).stdout;
  assert.ok(/markers:/.test(ok) && /AGENTS\.md: .*gates.*policy/.test(ok), ok);
  const bad = run(mk({ 'AGENTS.md': '<!-- harness:begin gates -->\ntext\n' }), ['--text']).stdout;
  assert.ok(/markers:/.test(bad) && /unbalanced/i.test(bad) && /gates/.test(bad), bad);
  assert.ok(/markers: none/.test(run(mk({}), ['--text']).stdout));
});

test('9. held registry rows are counted in both outputs', () => {
  const reg = [
    '# Registry', '', '| Held | Unit |', '|---|---|', '| 3 | outside the markers |', '',
    '<!-- harness:active -->', '| Held | Unit |', '|---|---|', '| 0 | idle |', '| 1 | busy |', '| - | none |', '<!-- /harness:active -->', '',
  ].join('\n');
  const repo = mk({ '.claude/registry.md': reg });
  assert.strictEqual(report(repo).registry.held, 1);
  assert.ok(run(repo, ['--text']).stdout.includes('registry: 1 held row(s)'));
  write(repo, '.claude/registry.md', reg.replace('| 1 | busy |', '| 2 | busy |\n| 1 | other |'));
  assert.strictEqual(report(repo).registry.held, 2);
  write(repo, '.claude/registry.md', REGISTRY);
  assert.strictEqual(report(repo).registry.held, 0);
  assert.strictEqual(report(mk({})).registry, null);
  assert.ok(/registry: absent/.test(run(mk({}), ['--text']).stdout));
});

test('10. a skill reached through a symlink is listed once, noting the link', () => {
  const repo = mk({ '.agents/skills/task-runner/SKILL.md': '# task-runner\n' });
  fs.mkdirSync(path.join(repo, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(path.join(repo, '.agents', 'skills', 'task-runner'), path.join(repo, '.claude', 'skills', 'task-runner'), 'dir');
  const rows = report(repo).entries.filter(e => /task-runner\/SKILL\.md$/.test(e.path));
  assert.strictEqual(rows.length, 1, JSON.stringify(rows));
  assert.strictEqual(rows[0].path, '.agents/skills/task-runner/SKILL.md');
  assert.ok(/symlink/.test(rows[0].detail) && rows[0].detail.includes('.claude/skills/task-runner/SKILL.md'), rows[0].detail);
  // two real copies are two entries
  const copies = mk({ '.agents/skills/task-runner/SKILL.md': 'a\n', '.claude/skills/task-runner/SKILL.md': 'b\n' });
  assert.strictEqual(report(copies).entries.filter(e => /task-runner\/SKILL\.md$/.test(e.path)).length, 2);
});

test('11. policy-no-status cites the never-auto heading, else the first match', () => {
  const withHeading = mk({ 'CLAUDE.md': '# P\n\nWe have a never-auto list somewhere.\n\n## Never-auto categories\n\n- money\n' });
  assert.strictEqual(report(withHeading).hazards.find(h => h.id === 'policy-no-status').line, 5);
  const noHeading = mk({ 'CLAUDE.md': '# P\n\nBody\n\nAnything on the never-auto list.\nNever-auto again.\n' });
  assert.strictEqual(report(noHeading).hazards.find(h => h.id === 'policy-no-status').line, 5);
});

test('12. lineage-neutral harness files are legacy entries and do not change the lineage', () => {
  const files = [
    'scripts/codex-run.mjs', 'scripts/lib/codex-run-core.mjs', 'scripts/check-agent-docs.mjs', 'scripts/run-gates.sh',
    '.claude/hooks/context-budget.mjs', '.claude/hooks/command-guard.mjs', 'docs/plans/decision-log.md',
    'docs/harness/follow-ups.md', 'docs/follow-ups.md', 'docs/guides/agent-workflow.md',
  ];
  const repo = mk(Object.fromEntries(files.map(f => [f, 'x\n'])));
  const rep = report(repo);
  for (const f of files) {
    const row = rep.entries.find(e => e.path === f);
    assert.ok(row, `no entry for ${f}`);
    assert.strictEqual(row.kind, 'unknown');
    assert.strictEqual(row.status, 'legacy');
  }
  // codex-run.mjs alone is a change fingerprint (existing rule); the others are neutral
  const neutral = files.filter(f => f !== 'scripts/codex-run.mjs');
  const rep2 = report(mk(Object.fromEntries(neutral.map(f => [f, 'x\n']))));
  assert.strictEqual(rep2.lineage.verdict, 'none');
  assert.strictEqual(rep2.entries.length, neutral.length);
  // with a manifest they are not invented as entries
  const man = mk({ 'scripts/run-gates.sh': 'x\n', '.agents/harness-manifest.json': JSON.stringify({ schema: 1, modes: ['change'], entries: [] }) });
  assert.deepStrictEqual(report(man).entries, []);
});

test('13. a gitignored scaffold that is absent reads ignored, not missing', () => {
  const manifest = JSON.stringify({ schema: 1, modes: ['plan'], entries: [{ path: '.claude/registry.md', kind: 'scaffold' }, { path: 'docs/log.md', kind: 'scaffold' }] });
  const repo = mk({ '.agents/harness-manifest.json': manifest, '.gitignore': '.claude/registry.md\n' });
  const rep = report(repo);
  assert.strictEqual(statusOf(rep, '.claude/registry.md'), 'ignored');
  assert.strictEqual(statusOf(rep, 'docs/log.md'), 'missing');
  write(repo, '.claude/registry.md', REGISTRY);
  assert.strictEqual(statusOf(report(repo), '.claude/registry.md'), 'scaffold');
  // not a git repository: nothing is ignored
  const plain = mk({ '.agents/harness-manifest.json': manifest, '.gitignore': '.claude/registry.md\n' }, { initGit: false });
  assert.strictEqual(statusOf(report(plain), '.claude/registry.md'), 'missing');
  // a generated entry is never softened
  const gen = JSON.stringify({ schema: 1, modes: ['plan'], entries: [{ path: 'x.sh', kind: 'generated', sha256: 'a' }] });
  const g = mk({ '.agents/harness-manifest.json': gen, '.gitignore': 'x.sh\n' });
  assert.strictEqual(statusOf(report(g), 'x.sh'), 'missing');
});

// ── guard ID_PATTERN hazard ──────────────────────────────────────────────────

console.log('\nharness-status: guard ID_PATTERN');

const DEFAULT_ID_PATTERN = '[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[0-9]+[A-Za-z]?';
const idRegistry = rows => [
  '# Registry', '<!-- harness:active -->',
  '| # | Task | Branch | Notes |', '|---|---|---|---|',
  ...rows,
  '<!-- /harness:active -->', '',
].join('\n');

/** A repo with a guard that carries <pattern>, a registry, one commit and the given local branches. */
function patternFixture(pattern, rows, branches, guardRel = '.githooks/harness-guard.sh') {
  const repo = mk({
    [guardRel]: `#!/bin/sh\nREGISTRY='.claude/registry.md'\nID_PATTERN='${pattern}'  # [B]\nexit 0\n`,
    '.claude/registry.md': idRegistry(rows),
  });
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'init']);
  for (const b of branches) git(repo, ['branch', b]);
  return repo;
}

const idPatternIds = rep => ids(rep).filter(i => i.startsWith('id-pattern-'));
const DOT_ROW = '| 1 | EP-27.01 | ep-27.01-contract | open |';

test('id-pattern: the default pattern cuts EP-27.01 to EP-27 and the hazard names branch and id', () => {
  const repo = patternFixture(DEFAULT_ID_PATTERN, [DOT_ROW], ['ep-27.01-contract']);
  const rep = report(repo);
  const h = rep.hazards.find(x => x.id === 'id-pattern-truncates');
  assert.ok(h, `no id-pattern-truncates in ${ids(rep)}`);
  assert.strictEqual(h.path, '.githooks/harness-guard.sh');
  assert.ok(h.detail.includes("branch 'ep-27.01-contract'") && h.detail.includes('EP-27.01'), h.detail);
  assert.ok(h.detail.includes("takes 'EP-27' from 'EP-27.01-CONTRACT'"), h.detail);
  assert.ok(h.detail.includes("registry id 'EP-27.01'"), h.detail);
  assert.ok(h.detail.includes('bind ID_PATTERN to the full id shape'), h.detail);
});

test('id-pattern: a pattern that covers the dotted id raises nothing', () => {
  const repo = patternFixture('EP-[0-9]+\\.[0-9]+', [DOT_ROW], ['ep-27.01-contract']);
  assert.deepStrictEqual(idPatternIds(report(repo)), []);
});

test('id-pattern: an empty ID_PATTERN is skipped', () => {
  const repo = patternFixture('', [DOT_ROW], ['ep-27.01-contract']);
  assert.deepStrictEqual(idPatternIds(report(repo)), []);
});

test('id-pattern: ids the default pattern takes whole raise nothing', () => {
  const rows = ['| 1 | T-AB-12 | task/t-ab-12-thing | open |', '| 2 | T-AB-13 | task/t-ab-13-more | open |'];
  const repo = patternFixture(DEFAULT_ID_PATTERN, rows, ['task/t-ab-12-thing', 'task/t-ab-13-more']);
  assert.deepStrictEqual(idPatternIds(report(repo)), []);
});

test('id-pattern: a pattern that does not compile is id-pattern-invalid', () => {
  const repo = patternFixture('EP-[0-9+', [DOT_ROW], ['ep-27.01-contract']);
  const rep = report(repo);
  const h = rep.hazards.find(x => x.id === 'id-pattern-invalid');
  assert.ok(h, `no id-pattern-invalid in ${ids(rep)}`);
  assert.strictEqual(h.path, '.githooks/harness-guard.sh');
  assert.ok(h.detail.includes('EP-[0-9+'), h.detail);
  assert.ok(!ids(rep).includes('id-pattern-truncates'));
});

test('id-pattern: no guard installed means no check', () => {
  const repo = mk({ '.claude/registry.md': idRegistry([DOT_ROW]) });
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'init']);
  git(repo, ['branch', 'ep-27.01-contract']);
  assert.deepStrictEqual(idPatternIds(report(repo)), []);
});

test('id-pattern: the registry rows alone can show the hazard, header and separator rows are skipped', () => {
  const repo = patternFixture(DEFAULT_ID_PATTERN, ['| 1 | EP-27.01 | ep-27.01-contract | open |', '| 2 | AB-7 | ab-7-x | open |'], []);
  const h = report(repo).hazards.find(x => x.id === 'id-pattern-truncates');
  assert.ok(h);
  assert.ok(h.detail.includes("registry id 'EP-27.01'") && !h.detail.includes("registry id 'AB-7'"), h.detail);
  assert.ok(!h.detail.includes("registry id '#'") && !h.detail.includes('---'), h.detail);
});

test('id-pattern: the detail lists at most five items', () => {
  const rows = [];
  const branches = [];
  for (let i = 1; i <= 8; i += 1) { rows.push(`| ${i} | EP-${i}.01 | x | open |`); branches.push(`ep-${i}.01-c`); }
  const h = report(patternFixture(DEFAULT_ID_PATTERN, rows, branches)).hazards.find(x => x.id === 'id-pattern-truncates');
  assert.ok(h);
  assert.strictEqual(h.detail.split('ID_PATTERN takes').length - 1, 5, h.detail);
});

test('id-pattern: the guard is found in the hooks dir, then through husky and lefthook', () => {
  const body = `#!/bin/sh\nID_PATTERN='${DEFAULT_ID_PATTERN}'\n`;
  const reg = { '.claude/registry.md': idRegistry([DOT_ROW]) };
  const viaHooks = mk({ ...reg, '.git/hooks/pre-commit': body });
  const viaHusky = mk({ ...reg, '.husky/pre-commit': 'sh tools/harness-guard.sh\n', 'tools/harness-guard.sh': body });
  const viaLefthook = mk({ ...reg, 'lefthook.yml': 'pre-commit:\n  commands:\n    g:\n      run: sh scripts/x/harness-guard.sh\n', 'scripts/x/harness-guard.sh': body });
  const escaping = mk({ ...reg, '.husky/pre-commit': 'sh ../harness-guard.sh\n' });
  for (const repo of [viaHooks, viaHusky, viaLefthook]) {
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'init']);
    git(repo, ['branch', 'ep-27.01-contract']);
    assert.ok(ids(report(repo)).includes('id-pattern-truncates'));
  }
  assert.deepStrictEqual(idPatternIds(report(escaping)), []);
});

test('id-pattern: a run reads branches only and writes nothing', () => {
  const repo = patternFixture(DEFAULT_ID_PATTERN, [DOT_ROW], ['ep-27.01-contract']);
  const before = git(repo, ['for-each-ref']) + snapshot(repo);
  report(repo);
  assert.strictEqual(git(repo, ['for-each-ref']) + snapshot(repo), before);
});

test('id-pattern: mutant that drops the character-after-the-match test changes the outcome', () => {
  const m = mutantOf('/[A-Z0-9.]/.test(ch)', 'true');
  const whole = patternFixture(DEFAULT_ID_PATTERN, ['| 1 | T-AB-12 | task/t-ab-12-thing | open |'], ['task/t-ab-12-thing']);
  assert.deepStrictEqual(idPatternIds(report(whole)), []);
  assert.ok(ids(report(whole, m)).includes('id-pattern-truncates'), 'mutant still silent on whole ids');
  const cut = patternFixture(DEFAULT_ID_PATTERN, [DOT_ROW], ['ep-27.01-contract']);
  assert.ok(ids(report(cut)).includes('id-pattern-truncates'));
  const mutantCut = mutantOf('/[A-Z0-9.]/.test(ch)', 'false');
  assert.deepStrictEqual(idPatternIds(report(cut, mutantCut)), []);
});

// ── mutation ─────────────────────────────────────────────────────────────────

console.log('\nharness-status: mutation');

test('mutant: generated status ignores the hash -> the edited assertion fails', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const from = "actual === entry.sha256 ? 'unchanged' : 'edited'";
  const mutated = src.replace(from, "'unchanged'");
  assert.notStrictEqual(mutated, src, 'replacement did not apply');
  const dir = tmp('harness-status-mutant-');
  const mutantScript = path.join(dir, 'harness-status.js');
  fs.writeFileSync(mutantScript, mutated);

  const repo = manifestFixture();
  write(repo, '.githooks/pre-commit', `${PRE_COMMIT}# local tweak\n`);
  assert.strictEqual(statusOf(report(repo), '.githooks/pre-commit'), 'edited');
  assert.strictEqual(statusOf(report(repo, mutantScript), '.githooks/pre-commit'), 'unchanged');
});

test('fixtures of earlier tests are removed (the suite leaves no temp directories)', () => {
  const mine = created.slice();
  const left = everCreated.filter(dir => !mine.includes(dir) && fs.existsSync(dir));
  assert.deepStrictEqual(left, []);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
