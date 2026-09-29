/**
 * Tests for skills/skill-advisor (biji-dev/ecc-js): session reading, evidence collection and installs.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sessions = require('../../skills/skill-advisor/scripts/lib/sessions');

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

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
