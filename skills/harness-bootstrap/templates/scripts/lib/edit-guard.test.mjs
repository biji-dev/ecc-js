// harness-bootstrap edit-guard tests (generated YYYY-MM-DD). Run: node --test scripts/lib/edit-guard.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED hook, .claude/hooks/edit-guard.mjs,
// never a copy: each case pipes a Claude Code or Codex payload into it, the way both hosts call it.
// [B] binding: the REFUSED and ALLOWED lists, re-derived with the hook's PROTECTED line.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// [B] Repo-relative paths PROTECTED must refuse, and look-alikes it must allow.
const REFUSED = ['.env', 'apps/web/.env.local', 'node_modules/left-pad/index.js'];
const ALLOWED = ['.env.example', 'src/env.ts', 'docs/environment.md', 'scripts/node_modules-audit.md'];

const HOOK = fileURLToPath(new URL('../../.claude/hooks/edit-guard.mjs', import.meta.url));
const ROOT = path.resolve(path.dirname(HOOK), '..', '..');
// Imported by its path at run time: the hook exists in the project, never beside this template.
const { PROTECTED, editedPaths } = await import(pathToFileURL(HOOK).href);

const pipe = (payload) => spawnSync(process.execPath, [HOOK], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8' });
const claude = (tool, rel) => ({
  tool_name: tool,
  tool_input: tool === 'NotebookEdit' ? { notebook_path: path.join(ROOT, rel) } : { file_path: path.join(ROOT, rel) },
  cwd: ROOT,
});
const patchOf = (lines) => ['*** Begin Patch', ...lines, '*** End Patch', ''].join('\n');
const codex = (lines, cwd = ROOT) => ({ tool_name: 'apply_patch', tool_input: { command: patchOf(lines) }, cwd });
const PATCHES = (rel) => [[`*** Add File: ${rel}`, '+x'], [`*** Update File: ${rel}`, '@@', '-a', '+b'], [`*** Delete File: ${rel}`], ['*** Update File: README.md', `*** Move to: ${rel}`, '@@', '-a', '+b']];

test('the bound lists agree with PROTECTED', () => {
  assert.ok(PROTECTED.length > 0, 'PROTECTED is empty: the hook allows every edit');
  for (const rel of REFUSED) assert.ok(PROTECTED.some((re) => re.test(rel)), `${rel} is in REFUSED but PROTECTED allows it`);
  for (const rel of ALLOWED) assert.ok(!PROTECTED.some((re) => re.test(rel)), `${rel} is in ALLOWED but PROTECTED refuses it`);
});

test('Claude Code: Edit, Write, MultiEdit and NotebookEdit of a protected path are refused through the hook', () => {
  for (const rel of REFUSED) {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      const r = pipe(claude(tool, rel));
      assert.equal(r.status, 2, `${tool} ${rel}: ${r.stderr}`);
      assert.match(r.stderr, /^BLOCKED \(protected-path\): /);
    }
  }
});

test('Codex: a patch that adds, updates, deletes or moves onto a protected path is refused', () => {
  for (const rel of REFUSED) {
    for (const lines of PATCHES(rel)) assert.equal(pipe(codex(lines)).status, 2, `${lines[0]} -> ${rel}`);
  }
  // one protected file among ordinary ones is enough, and an argv-style array reads the same
  const mixed = ['*** Update File: README.md', '@@', '-a', '+b', `*** Add File: ${REFUSED[0]}`, '+x'];
  assert.equal(pipe(codex(mixed)).status, 2);
  assert.equal(pipe({ tool_name: 'apply_patch', tool_input: { command: ['apply_patch', patchOf(mixed)] }, cwd: ROOT }).status, 2);
});

test("Codex: a patch path is read against the call's cwd", () => {
  const sub = path.join(ROOT, 'docs');
  assert.deepEqual(editedPaths(codex([`*** Add File: ../${REFUSED[0]}`, '+x'], sub)).map((p) => p.rel), [REFUSED[0]]);
  assert.equal(pipe(codex([`*** Add File: ../${REFUSED[0]}`, '+x'], sub)).status, 2);
});

test('the look-alikes, other tools and input that does not parse pass', () => {
  for (const rel of ALLOWED) {
    assert.equal(pipe(claude('Write', rel)).status, 0, rel);
    assert.equal(pipe(codex([`*** Add File: ${rel}`, '+x'])).status, 0, rel);
  }
  assert.equal(pipe({ tool_name: 'Bash', tool_input: { command: 'cat .env' } }).status, 0, "a Bash command is the command guard's, not this hook's");
  assert.equal(pipe({ tool_name: 'Edit', tool_input: {} }).status, 0);
  assert.equal(pipe('not json').status, 0);
  assert.equal(pipe('').status, 0);
});
