/**
 * Unit tests for the fork sync tooling in fork/bin/lib (biji-dev/ecc-js).
 */

const assert = require('assert');

const { globToRegExp, createMatcher } = require('../../fork/bin/lib/glob');
const { buildDropMatcher, keptItemMatcher, removedNames } = require('../../fork/bin/lib/config');
const { diffInventory } = require('../../fork/bin/lib/inventory');
const { pruneDecided } = require('../../fork/bin/lib/queue');

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

function section(name, keep = [], drop = {}, extra = {}) {
  return { keep, drop, pinned: [], own: [], ...extra, name };
}

const slim = {
  skills: section('skills', ['react-patterns'], { 'django-patterns': 'lang' }, { pinned: ['react-patterns'] }),
  agents: section('agents', ['code-reviewer'], { 'go-reviewer': 'lang' }),
  commands: section('commands', ['plan'], { jira: 'jira' }),
  rules: section('rules', ['typescript'], { python: 'lang' }),
  hooks: { keep: ['session:start'], drop: { 'pre:compact': 'noise' } },
  mirrors: ['.agents/skills/{name}'],
  paths: { drop: ['docs/**', '.opencode/**', '.github/workflows/**'], keep: ['docs/COMMAND-REGISTRY.json'] },
  tests: { drop: { 'tests/scripts/ito.test.js': { reason: 'ito' } } },
};

console.log('\n=== fork glob ===\n');

test('** matches any depth including zero segments', () => {
  const regex = globToRegExp('docs/**');
  assert.ok(regex.test('docs/a.md'));
  assert.ok(regex.test('docs/zh-CN/skills/x/SKILL.md'));
  assert.ok(!regex.test('documents/a.md'));
  assert.ok(globToRegExp('tests/**/*.py').test('tests/a.py'));
  assert.ok(globToRegExp('tests/**/*.py').test('tests/skills/deep/a.py'));
});

test('* stays within a segment and braces expand', () => {
  assert.ok(globToRegExp('scripts/*.js').test('scripts/ito.js'));
  assert.ok(!globToRegExp('scripts/*.js').test('scripts/lib/ito.js'));
  const matcher = createMatcher(['.github/{dependabot,FUNDING}.yml']);
  assert.ok(matcher('.github/dependabot.yml'));
  assert.ok(matcher('.github/FUNDING.yml'));
  assert.ok(!matcher('.github/release.yml'));
});

console.log('\n=== fork drop set ===\n');

test('dropped items, mirrors, paths and tests are in the drop set', () => {
  const isDropped = buildDropMatcher(slim, { entries: [] });
  assert.ok(isDropped('skills/django-patterns/SKILL.md'));
  assert.ok(isDropped('.agents/skills/django-patterns/agents/openai.yaml'));
  assert.ok(isDropped('agents/go-reviewer.md'));
  assert.ok(isDropped('commands/jira.md'));
  assert.ok(isDropped('rules/python/coding-style.md'));
  assert.ok(isDropped('docs/ja-JP/README.md'));
  assert.ok(isDropped('tests/scripts/ito.test.js'));
});

test('kept items, keep paths and fork-owned paths are never dropped', () => {
  const isDropped = buildDropMatcher(slim, { entries: [] });
  assert.ok(!isDropped('skills/react-patterns/SKILL.md'));
  assert.ok(!isDropped('docs/COMMAND-REGISTRY.json'));
  assert.ok(!isDropped('.github/workflows/fork-ci.yml'));
  assert.ok(!isDropped('fork/slim.json'));
  assert.ok(!isDropped('tests/fork/slim-tooling.test.js'));
  assert.ok(!isDropped('skills/django-patterns-extra/SKILL.md'), 'prefix of a dropped name must not match');
});

test('pending review items are treated as dropped until decided', () => {
  const queue = { entries: [{ kind: 'skills', name: 'new-upstream-skill', status: 'pending' }] };
  assert.deepStrictEqual(removedNames(slim, queue, 'skills').sort(), ['django-patterns', 'new-upstream-skill']);
  assert.ok(buildDropMatcher(slim, queue)('skills/new-upstream-skill/SKILL.md'));
});

test('an explicit keep decision wins over a stale pending queue entry', () => {
  const decided = { ...slim, skills: { ...slim.skills, keep: [...slim.skills.keep, 'queued-then-kept'] } };
  const queue = { entries: [{ kind: 'skills', name: 'queued-then-kept', status: 'pending' }] };
  assert.ok(!removedNames(decided, queue, 'skills').includes('queued-then-kept'));
  assert.ok(!buildDropMatcher(decided, queue)('skills/queued-then-kept/SKILL.md'));
});

test('kept item matcher covers item files and skill mirrors', () => {
  const isKept = keptItemMatcher(slim);
  assert.ok(isKept('skills/react-patterns/references/a.md'));
  assert.ok(isKept('.agents/skills/react-patterns/SKILL.md'));
  assert.ok(isKept('commands/plan.md'));
  assert.ok(!isKept('commands/jira.md'));
});

console.log('\n=== fork inventory diff and queue ===\n');

test('NEW upstream items and GONE kept items are detected', () => {
  const inventory = {
    skills: ['django-patterns', 'brand-new-skill'],
    agents: ['code-reviewer', 'go-reviewer'],
    commands: ['plan', 'jira'],
    rules: ['typescript', 'python', 'elixir'],
    hookIds: ['session:start', 'pre:compact', 'pre:new-hook'],
  };
  const { added, gone } = diffInventory(slim, { entries: [] }, inventory);
  assert.deepStrictEqual(added.skills, ['brand-new-skill']);
  assert.deepStrictEqual(added.rules, ['elixir']);
  assert.deepStrictEqual(added.hooks, ['pre:new-hook']);
  assert.deepStrictEqual(gone.skills, [{ name: 'react-patterns', pinned: true }]);
  assert.deepStrictEqual(gone.agents, []);
});

test('decided queue entries are pruned', () => {
  const queue = {
    entries: [
      { kind: 'skills', name: 'react-patterns', status: 'pending' },
      { kind: 'skills', name: 'undecided', status: 'pending' },
    ],
  };
  assert.strictEqual(pruneDecided(slim, queue), 1);
  assert.deepStrictEqual(queue.entries.map(entry => entry.name), ['undecided']);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
