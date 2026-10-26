// harness-bootstrap edit-guard tests (generated YYYY-MM-DD). Run: node --test scripts/lib/edit-guard.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED hook, .claude/hooks/edit-guard.mjs,
// never a copy: each case pipes a Claude Code or Codex payload into it, the way both hosts call it.
// [B] binding: the REFUSED and ALLOWED lists, re-derived with the hook's PROTECTED line.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// [B] Repo-relative paths PROTECTED must refuse, and look-alikes it must allow.
const REFUSED = ['.env', 'apps/web/.env.local', 'node_modules/left-pad/index.js'];
const ALLOWED = ['.env.example', 'src/env.ts', 'docs/environment.md', 'scripts/node_modules-audit.md'];

const HOOK = fileURLToPath(new URL('../../.claude/hooks/edit-guard.mjs', import.meta.url));
const ROOT = path.resolve(path.dirname(HOOK), '..', '..');
// Imported by its path at run time: the hook exists in the project, never beside this template.
const { PROTECTED, editedPaths, protectedHit } = await import(pathToFileURL(HOOK).href);

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

test('case variants are refused too: on a macOS or Windows volume .ENV is .env', () => {
  for (const rel of REFUSED.map((r) => r.toUpperCase())) {
    assert.equal(pipe(claude('Write', rel)).status, 2, rel);
    assert.equal(pipe(codex([`*** Add File: ${rel}`, '+x'])).status, 2, rel);
  }
  for (const rel of ALLOWED.map((r) => r.toUpperCase())) assert.equal(pipe(claude('Write', rel)).status, 0, rel);
});

test('an edit through a link is checked where the write lands, and where it is named', () => {
  const temps = [];
  const tmpRepo = () => {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'edit-guard-')));
    temps.push(d);
    return d;
  };
  const write = (rel, root) => ({ tool_name: 'Write', tool_input: { file_path: path.join(root, rel) }, cwd: root });
  // These repos sit outside the hook's root, where it tests absolute paths and a project's anchored
  // pattern never matches: the link cases call protectedHit with the temp repo as root, the function the hook runs.
  const refused = (rel, root) => assert.ok(protectedHit(write(rel, root), root), `${rel} writes a protected path`);
  try {
    REFUSED.forEach((r, i) => {
      const repo = tmpRepo();
      const [top, ...rest] = r.split('/');
      // a link to nothing yet: a write through it creates r
      fs.symlinkSync(r, path.join(repo, `link-${i}.txt`));
      refused(`link-${i}.txt`, repo);
      // a new file under a linked directory
      const viaDir = rest.length > 0 ? `dir-${i}/${rest.join('/')}` : null;
      if (viaDir) {
        fs.mkdirSync(path.join(repo, top));
        fs.symlinkSync(top, path.join(repo, `dir-${i}`), 'dir');
        refused(viaDir, repo);
        assert.deepEqual(editedPaths(write(viaDir, repo), repo).map((p) => p.real), [r]);
      }
      // the same writes once r exists
      fs.mkdirSync(path.dirname(path.join(repo, r)), { recursive: true });
      fs.writeFileSync(path.join(repo, r), 'x\n');
      refused(`link-${i}.txt`, repo);
      if (viaDir) refused(viaDir, repo);
    });
    const repo = tmpRepo();
    fs.symlinkSync('.', path.join(repo, 'here'), 'dir'); // the control: every ALLOWED path, reached through a link
    for (const rel of ALLOWED) {
      assert.equal(protectedHit(write(`here/${rel}`, repo), repo), null, `here/${rel} writes ${rel}, which ALLOWED allows`);
    }
    // the other way round: a protected name that links to an allowed file is still refused by its name
    const other = tmpRepo();
    fs.mkdirSync(path.dirname(path.join(other, REFUSED[0])), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(other, ALLOWED[0])), { recursive: true });
    fs.writeFileSync(path.join(other, ALLOWED[0]), 'x\n');
    fs.symlinkSync(path.join(other, ALLOWED[0]), path.join(other, REFUSED[0]));
    assert.ok(protectedHit(write(REFUSED[0], other), other), `${REFUSED[0]} -> ${ALLOWED[0]} is refused`);
  } finally {
    for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('a `..` after a link climbs out of where the link leads, as the file system does, not out of the link', () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'edit-guard-')));
  try {
    REFUSED.forEach((r, i) => {
      if (!r.includes('/')) return;
      // jump-<i>/.. is dirname(r) on the disk, though the text reads as the repo root
      fs.mkdirSync(path.join(repo, path.dirname(r), 'sub'), { recursive: true });
      fs.symlinkSync(`${path.dirname(r)}/sub`, path.join(repo, `jump-${i}`), 'dir');
      fs.symlinkSync(`jump-${i}/../${path.basename(r)}`, path.join(repo, `alias-${i}`));
      const write = { tool_name: 'Write', tool_input: { file_path: path.join(repo, `alias-${i}`) }, cwd: repo };
      assert.deepEqual(editedPaths(write, repo).map((p) => p.real), [r]);
      assert.ok(protectedHit(write, repo), `alias-${i} -> jump-${i}/../${path.basename(r)} writes ${r}`);
      assert.ok(protectedHit(codex([`*** Add File: jump-${i}/../${path.basename(r)}`, '+x'], repo), repo), `the patch path jump-${i}/../${path.basename(r)} writes ${r}`);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
