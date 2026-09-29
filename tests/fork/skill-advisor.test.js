/**
 * Tests for skills/skill-advisor (biji-dev/ecc-js): session reading, evidence collection and installs.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sessions = require('../../skills/skill-advisor/scripts/lib/sessions');
const state = require('../../skills/skill-advisor/scripts/lib/state');
const { collect } = require('../../skills/skill-advisor/scripts/collect');
const { applyPlan } = require('../../skills/skill-advisor/scripts/install');

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

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function jsonl(lines) {
  return `${lines.map(line => JSON.stringify(line)).join('\n')}\n`;
}

/** A fake HOME with Claude and Codex sessions for `project`, a worktree, and a prefix-sharing sibling. */
function fixture() {
  const home = tmp('advisor-home-');
  const workspace = tmp('advisor-ws-');
  const project = path.join(workspace, 'shop');
  const sibling = path.join(workspace, 'shop-api');
  const worktree = path.join(project, '.worktrees', 'feat-a');
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  const claudeDir = dir => path.join(home, '.claude', 'projects', sessions.encodeClaudeDir(dir));
  write(path.join(claudeDir(project), 's1.jsonl'), jsonl([
    { type: 'user', cwd: project, timestamp: '2026-09-20T10:00:00Z', message: { role: 'user', content: 'Add a Postgres migration for orders' } },
    { type: 'user', cwd: project, timestamp: '2026-09-20T10:01:00Z', message: { role: 'user', content: '<command-name>/ecc:plan-prd</command-name>' } },
    { type: 'assistant', cwd: project, message: { role: 'assistant', content: [
      { type: 'tool_use', name: 'Agent', input: { subagent_type: 'ecc:security-reviewer' } },
      { type: 'tool_use', name: 'Skill', input: { skill: 'postgres-patterns' } },
      { type: 'tool_use', name: 'Write', input: { file_path: path.join(project, 'docs', 'orders-prd.md') } },
      { type: 'tool_use', name: 'Edit', input: { file_path: path.join(project, 'src', 'orders.ts') } }
    ] } },
    { type: 'user', cwd: project, message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }
  ]));
  write(path.join(claudeDir(worktree), 's2.jsonl'), jsonl([
    { type: 'user', cwd: worktree, timestamp: '2026-09-21T09:00:00Z', message: { role: 'user', content: 'Fix the checkout test' } }
  ]));
  write(path.join(claudeDir(sibling), 's3.jsonl'), jsonl([
    { type: 'user', cwd: sibling, timestamp: '2026-09-22T09:00:00Z', message: { role: 'user', content: 'sibling prompt' } }
  ]));
  write(path.join(home, '.codex', 'sessions', '2026', '09', '23', 'r1.jsonl'), jsonl([
    { timestamp: '2026-09-23T08:00:00Z', type: 'session_meta', payload: { cwd: worktree } },
    { timestamp: '2026-09-23T08:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'Tune the slow query' } },
    { timestamp: '2026-09-23T08:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'Tune the slow query' } },
    { timestamp: '2026-09-23T08:00:02Z', type: 'event_msg', payload: { type: 'user_message', message: '<environment_context>x</environment_context>' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'sed -n 1,80p /x/ecc/skills/latency-critical-systems/SKILL.md' }) } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: docs/trd.md\n+x\n*** End Patch' } }
  ]));
  write(path.join(home, '.codex', 'sessions', '2026', '09', '23', 'r2.jsonl'), jsonl([
    { type: 'session_meta', payload: { cwd: sibling } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'sibling codex prompt' } }
  ]));
  return { home, project, sibling, worktree };
}

console.log('\n=== skill-advisor sessions ===\n');

test('project folder encoding matches Claude Code', () => {
  assert.strictEqual(sessions.encodeClaudeDir('/x/grobiz/.worktrees/cr-1'), '-x-grobiz--worktrees-cr-1');
  assert.strictEqual(sessions.encodeClaudeDir('/x/My App'), '-x-My-App');
});

test('inside() accepts the project, its subfolders and any cwd for a null project', () => {
  assert.ok(sessions.inside('/a/shop', '/a/shop'));
  assert.ok(sessions.inside('/a/shop', '/a/shop/.worktrees/x'));
  assert.ok(!sessions.inside('/a/shop', '/a/shop-api'));
  assert.ok(!sessions.inside('/a/shop', null));
  assert.ok(sessions.inside(null, '/anything'));
});

test('sessions of the project and its worktrees are collected from Claude and Codex', () => {
  const { home, project } = fixture();
  const found = sessions.collectSessions({ home, project });
  assert.deepStrictEqual(found.map(s => s.tool).sort(), ['claude', 'claude', 'codex']);
});

test('sibling project with a shared prefix is excluded', () => {
  const { home, project } = fixture();
  const texts = sessions.summarise(sessions.collectSessions({ home, project })).prompts.map(p => p.text);
  assert.ok(!texts.includes('sibling prompt'));
  assert.ok(!texts.includes('sibling codex prompt'));
});

test('summary holds prompts, usage, touched files and docs written', () => {
  const { home, project } = fixture();
  const summary = sessions.summarise(sessions.collectSessions({ home, project }));
  assert.deepStrictEqual(summary.sessions, { claude: 2, codex: 1 });
  assert.deepStrictEqual(summary.prompts.map(p => p.text), ['Tune the slow query', 'Fix the checkout test', 'Add a Postgres migration for orders']);
  assert.deepStrictEqual(summary.usage, {
    'command:ecc:plan-prd': 1,
    'agent:ecc:security-reviewer': 1,
    'skill:postgres-patterns': 1,
    'skill:latency-critical-systems': 1
  });
  assert.ok(summary.docsWritten.includes(path.join(project, 'docs', 'orders-prd.md')));
  assert.ok(summary.docsWritten.includes(path.join(project, '.worktrees', 'feat-a', 'docs', 'trd.md')));
  assert.strictEqual(summary.touchedExtensions['.ts'], 1);
});

test('prompts are capped at 300 characters', () => {
  const home = tmp('advisor-home-');
  const project = tmp('advisor-proj-');
  write(path.join(home, '.claude', 'projects', sessions.encodeClaudeDir(project), 's.jsonl'), jsonl([
    { type: 'user', cwd: project, timestamp: '2026-09-20T10:00:00Z', message: { role: 'user', content: 'x'.repeat(500) } }
  ]));
  const summary = sessions.summarise(sessions.collectSessions({ home, project }));
  assert.strictEqual(summary.prompts[0].text.length, 300);
});

/** A fake library with one skill (with a binary asset), one agent and one command. */
function libraryFixture() {
  const root = tmp('advisor-lib-');
  write(path.join(root, 'skills', 'postgres-patterns', 'SKILL.md'), '---\nname: postgres-patterns\ndescription: PostgreSQL query and schema patterns.\n---\n# PG\n');
  write(path.join(root, 'skills', 'postgres-patterns', 'assets', 'erd.png'), Buffer.from([0xff, 0x00, 0x01]));
  write(path.join(root, 'agents', 'a11y-architect.md'), '---\nname: a11y-architect\ndescription: Accessibility architect.\n---\nBody\n');
  write(path.join(root, 'commands', 'plan-canvas.md'), '---\ndescription: Open a plan in the browser canvas.\n---\nBody\n');
  return root;
}

console.log('\n=== skill-advisor state and collect ===\n');

test('catalog lists library items with descriptions', () => {
  assert.deepStrictEqual(state.catalog(libraryFixture()), [
    { kind: 'skill', name: 'postgres-patterns', description: 'PostgreSQL query and schema patterns.' },
    { kind: 'agent', name: 'a11y-architect', description: 'Accessibility architect.' },
    { kind: 'command', name: 'plan-canvas', description: 'Open a plan in the browser canvas.' }
  ]);
});

test('hashPath changes with content and file names, not with location', () => {
  const lib = libraryFixture();
  const copy = tmp('advisor-copy-');
  fs.cpSync(path.join(lib, 'skills', 'postgres-patterns'), path.join(copy, 'pg'), { recursive: true });
  const original = state.hashPath(path.join(lib, 'skills', 'postgres-patterns'));
  assert.strictEqual(state.hashPath(path.join(copy, 'pg')), original);
  fs.writeFileSync(path.join(copy, 'pg', 'SKILL.md'), 'changed');
  assert.notStrictEqual(state.hashPath(path.join(copy, 'pg')), original);
});

test('destinations put skills in both harness folders and agents/commands in .claude only', () => {
  assert.deepStrictEqual(state.destinations('skill', 'x'), [path.join('.claude', 'skills', 'x'), path.join('.agents', 'skills', 'x')]);
  assert.deepStrictEqual(state.destinations('agent', 'y'), [path.join('.claude', 'agents', 'y.md')]);
  assert.deepStrictEqual(state.destinations('command', 'z'), [path.join('.claude', 'commands', 'z.md')]);
});

test('itemStatus reports current, outdated, modified, missing and gone', () => {
  const lib = libraryFixture();
  const project = tmp('advisor-proj-');
  const source = state.librarySource(lib, 'agent', 'a11y-architect');
  const dest = path.join(project, '.claude', 'agents', 'a11y-architect.md');
  write(dest, fs.readFileSync(source));
  const item = { kind: 'agent', name: 'a11y-architect', hash: state.hashPath(source), paths: [path.join('.claude', 'agents', 'a11y-architect.md')] };
  assert.strictEqual(state.itemStatus(project, lib, item), 'current');
  fs.writeFileSync(source, 'new library version');
  assert.strictEqual(state.itemStatus(project, lib, item), 'outdated');
  fs.writeFileSync(dest, 'hand edit');
  assert.strictEqual(state.itemStatus(project, lib, item), 'modified');
  fs.rmSync(dest);
  assert.strictEqual(state.itemStatus(project, lib, item), 'missing');
  write(dest, 'x');
  fs.rmSync(source);
  assert.strictEqual(state.itemStatus(project, lib, { ...item, hash: state.hashPath(dest) }), 'gone');
});

test('collect finds docs, session docs, stack and state', () => {
  const { home, project } = fixture();
  const lib = libraryFixture();
  write(path.join(project, 'docs', 'orders-prd.md'), '# PRD\nUse PostgreSQL.\n');
  write(path.join(project, 'PLAN.md'), '# Plan\n');
  write(path.join(project, 'CLAUDE.md'), '# Rules\n');
  write(path.join(project, 'notes.md'), 'not a doc');
  write(path.join(project, '.claude', 'skills', 'x', 'SKILL.md'), 'installed skill, not a doc');
  write(path.join(project, 'node_modules', 'pkg', 'docs', 'a.md'), 'dependency doc');
  write(path.join(project, '.worktrees', 'feat-a', 'docs', 'trd.md'), '# TRD\n');
  write(path.join(project, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' }, devDependencies: { prisma: '6.0.0' } }));
  write(path.join(project, 'apps', 'web', 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  write(path.join(project, 'bun.lock'), '');
  write(path.join(project, 'next.config.ts'), '');
  const evidence = collect({ project, home, libraryRoot: lib });
  const docPaths = evidence.docs.files.map(doc => path.relative(project, doc.path)).sort();
  assert.deepStrictEqual(docPaths, ['.worktrees/feat-a/docs/trd.md', 'CLAUDE.md', 'PLAN.md', 'docs/orders-prd.md'].map(p => p.split('/').join(path.sep)));
  assert.deepStrictEqual(evidence.stack.dependencies, ['next', 'prisma', 'react']);
  assert.strictEqual(evidence.stack.lockfile, 'bun');
  assert.deepStrictEqual(evidence.stack.configs, ['next.config.ts']);
  assert.deepStrictEqual(evidence.sessions.unavailable, ['zcode']);
  assert.strictEqual(evidence.catalog.length, 3);
  assert.deepStrictEqual(evidence.state, { items: [], declined: [] });
});

test('collect caps each doc at 8 KB and lists truncated docs', () => {
  const home = tmp('advisor-home-');
  const project = tmp('advisor-proj-');
  write(path.join(project, 'docs', 'big-spec.md'), 'a'.repeat(9000));
  const evidence = collect({ project, home, libraryRoot: libraryFixture() });
  assert.strictEqual(evidence.docs.files[0].text.length, 8192);
  assert.deepStrictEqual(evidence.docs.truncated, [path.join(project, 'docs', 'big-spec.md')]);
});

test('hashPath orders files by code point, independent of locale', () => {
  const dir = tmp('advisor-codepoint-');
  write(path.join(dir, 'B.md'), 'b');
  write(path.join(dir, 'a.md'), 'a');
  const expected = crypto.createHash('sha256');
  expected.update('B.md');
  expected.update('\0');
  expected.update('b');
  expected.update('\0');
  expected.update('a.md');
  expected.update('\0');
  expected.update('a');
  expected.update('\0');
  assert.strictEqual(state.hashPath(dir), expected.digest('hex'));
});

console.log('\n=== skill-advisor install ===\n');

function installFixture() {
  return { lib: libraryFixture(), project: tmp('advisor-proj-') };
}

const PG = { kind: 'skill', name: 'postgres-patterns' };
const A11Y = { kind: 'agent', name: 'a11y-architect' };

test('add installs skills into both harness folders and agents into .claude', () => {
  const { lib, project } = installFixture();
  const result = applyPlan({ project, libraryRoot: lib, plan: { add: [PG, A11Y] }, today: '2026-09-29' });
  assert.deepStrictEqual(result.warnings, []);
  assert.ok(fs.existsSync(path.join(project, '.claude', 'skills', 'postgres-patterns', 'SKILL.md')));
  assert.ok(fs.readFileSync(path.join(project, '.agents', 'skills', 'postgres-patterns', 'assets', 'erd.png')).equals(Buffer.from([0xff, 0x00, 0x01])));
  assert.ok(fs.existsSync(path.join(project, '.claude', 'agents', 'a11y-architect.md')));
  const saved = state.readState(project);
  assert.deepStrictEqual(saved.items.map(item => `${item.kind}:${item.name}`), ['skill:postgres-patterns', 'agent:a11y-architect']);
  assert.strictEqual(saved.items[0].installedAt, '2026-09-29');
  assert.strictEqual(saved.items[0].hash, state.hashPath(path.join(lib, 'skills', 'postgres-patterns')));
});

test('dry run changes nothing', () => {
  const { lib, project } = installFixture();
  const result = applyPlan({ project, libraryRoot: lib, plan: { add: [PG] }, dryRun: true, today: '2026-09-29' });
  assert.ok(result.actions.length > 0);
  assert.deepStrictEqual(fs.readdirSync(project), []);
});

test('an existing untracked destination is skipped, never overwritten', () => {
  const { lib, project } = installFixture();
  write(path.join(project, '.claude', 'agents', 'a11y-architect.md'), 'the project own agent');
  const result = applyPlan({ project, libraryRoot: lib, plan: { add: [A11Y] }, today: '2026-09-29' });
  assert.strictEqual(fs.readFileSync(path.join(project, '.claude', 'agents', 'a11y-architect.md'), 'utf8'), 'the project own agent');
  assert.strictEqual(result.warnings.length, 1);
  assert.deepStrictEqual(state.readState(project).items, []);
});

test('a partially present destination skips the whole item', () => {
  const { lib, project } = installFixture();
  write(path.join(project, '.agents', 'skills', 'postgres-patterns', 'SKILL.md'), 'codex own copy');
  applyPlan({ project, libraryRoot: lib, plan: { add: [PG] }, today: '2026-09-29' });
  assert.ok(!fs.existsSync(path.join(project, '.claude', 'skills', 'postgres-patterns')));
  assert.deepStrictEqual(state.readState(project).items, []);
});

test('re-running an add is a no-op with a warning', () => {
  const { lib, project } = installFixture();
  applyPlan({ project, libraryRoot: lib, plan: { add: [PG] }, today: '2026-09-29' });
  const again = applyPlan({ project, libraryRoot: lib, plan: { add: [PG] }, today: '2026-09-30' });
  assert.strictEqual(again.warnings.length, 1);
  assert.strictEqual(state.readState(project).items.length, 1);
  assert.strictEqual(state.readState(project).items[0].installedAt, '2026-09-29');
});

test('refresh updates outdated copies and skips modified ones unless overwrite', () => {
  const { lib, project } = installFixture();
  applyPlan({ project, libraryRoot: lib, plan: { add: [A11Y] }, today: '2026-09-29' });
  fs.writeFileSync(path.join(lib, 'agents', 'a11y-architect.md'), 'v2');
  applyPlan({ project, libraryRoot: lib, plan: { refresh: [A11Y] }, today: '2026-09-30' });
  const dest = path.join(project, '.claude', 'agents', 'a11y-architect.md');
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'v2');
  fs.writeFileSync(dest, 'hand edit');
  fs.writeFileSync(path.join(lib, 'agents', 'a11y-architect.md'), 'v3');
  const skipped = applyPlan({ project, libraryRoot: lib, plan: { refresh: [A11Y] }, today: '2026-10-01' });
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'hand edit');
  assert.strictEqual(skipped.warnings.length, 1);
  applyPlan({ project, libraryRoot: lib, plan: { refresh: [{ ...A11Y, overwrite: true }] }, today: '2026-10-01' });
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'v3');
});

test('remove deletes only recorded paths; untrack keeps files', () => {
  const { lib, project } = installFixture();
  applyPlan({ project, libraryRoot: lib, plan: { add: [PG, A11Y] }, today: '2026-09-29' });
  write(path.join(project, '.claude', 'skills', 'other', 'SKILL.md'), 'not ours');
  applyPlan({ project, libraryRoot: lib, plan: { remove: [PG], untrack: [A11Y] }, today: '2026-09-30' });
  assert.ok(!fs.existsSync(path.join(project, '.claude', 'skills', 'postgres-patterns')));
  assert.ok(!fs.existsSync(path.join(project, '.agents', 'skills', 'postgres-patterns')));
  assert.ok(fs.existsSync(path.join(project, '.claude', 'skills', 'other', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(project, '.claude', 'agents', 'a11y-architect.md')));
  assert.deepStrictEqual(state.readState(project).items, []);
});

test('declined items are remembered and cleared when later added', () => {
  const { lib, project } = installFixture();
  applyPlan({ project, libraryRoot: lib, plan: { decline: [PG, PG] }, today: '2026-09-29' });
  assert.deepStrictEqual(state.readState(project).declined, [{ kind: 'skill', name: 'postgres-patterns', at: '2026-09-29' }]);
  applyPlan({ project, libraryRoot: lib, plan: { add: [PG] }, today: '2026-09-30' });
  assert.deepStrictEqual(state.readState(project).declined, []);
});

test('an unknown library item is a warning, and an invalid plan throws', () => {
  const { lib, project } = installFixture();
  const result = applyPlan({ project, libraryRoot: lib, plan: { add: [{ kind: 'skill', name: 'nope' }] }, today: '2026-09-29' });
  assert.strictEqual(result.warnings.length, 1);
  assert.throws(() => applyPlan({ project, libraryRoot: lib, plan: { add: [{ kind: 'rule', name: 'x' }] }, today: '2026-09-29' }), /invalid plan/);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
