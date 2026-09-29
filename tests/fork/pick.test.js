/**
 * Tests for the one-time tier pick (fork/bin/lib/pick.js).
 */

const assert = require('assert');
const { orderItems, renderPick, parsePick, validatePick, applyPick, allowOwner, findReferences } = require('../../fork/bin/lib/pick');

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

const slim = {
  skills: { keep: ['react-patterns', 'postgres-patterns', 'accessibility'], drop: { django: 'lang' }, pinned: ['react-patterns'], own: ['skill-advisor'] },
  agents: { keep: ['security-reviewer', 'seo-specialist'], drop: {}, pinned: [], own: [] },
  commands: { keep: ['react-review'], drop: {}, pinned: [], own: [] },
  hooks: { keep: ['pre:bash:dispatcher', 'post:dispatcher:sync', 'stop:cost-tracker'], drop: { 'pre:compact': 'paid' } }
};

const subHooks = { preBash: ['pre:bash:block-no-verify'], postBash: ['post:bash:build-complete'], sync: ['post:edit:console-warn'], async: ['post:skill:track'] };

console.log('\n=== fork pick ===\n');

test('render and parse round-trip tags per kind and hooks', () => {
  const text = renderPick({
    items: [
      { kind: 'skills', name: 'react-patterns', tag: 'core', description: 'React patterns.', signals: 'pinned' },
      { kind: 'skills', name: 'postgres-patterns', tag: 'library', description: 'PG.', signals: 'no use' },
      { kind: 'agents', name: 'seo-specialist', tag: 'drop', description: 'SEO.', signals: '' }
    ],
    hooks: [{ id: 'pre:bash:dispatcher', tag: 'keep' }, { id: 'stop:cost-tracker', tag: 'drop' }]
  });
  assert.ok(text.includes('- [core] react-patterns — React patterns. (pinned)'));
  assert.deepStrictEqual(parsePick(text), {
    skills: { 'react-patterns': 'core', 'postgres-patterns': 'library' },
    agents: { 'seo-specialist': 'drop' },
    commands: {},
    hooks: { 'pre:bash:dispatcher': 'keep', 'stop:cost-tracker': 'drop' }
  });
});

test('parse rejects unknown tags', () => {
  assert.throws(() => parsePick('## skills\n\n- [maybe] x — y\n'), /line 3: unknown tag "maybe"/);
  assert.throws(() => parsePick('## hooks\n\n- [core] pre:x\n'), /line 3: unknown tag "core"/);
});

test('validation errors: pinned not core, external ref not core, core references a dropped item', () => {
  const picked = { skills: { 'react-patterns': 'library', 'postgres-patterns': 'core', accessibility: 'drop' }, agents: { 'security-reviewer': 'drop', 'seo-specialist': 'drop' }, commands: { 'react-review': 'core' }, hooks: {} };
  const { errors } = validatePick({
    picked,
    slim,
    externalRefs: { 'security-reviewer': ['grobiz'] },
    references: { 'commands:react-review': ['accessibility'] }
  });
  assert.deepStrictEqual(errors, [
    'skills:react-patterns is pinned; tag it core',
    'agents:security-reviewer is used as ecc:security-reviewer by grobiz; tag it core',
    'commands:react-review (core) references accessibility, which is tagged drop'
  ]);
});

test('validation warns when a core item references a library item', () => {
  const picked = { skills: { 'react-patterns': 'core', 'postgres-patterns': 'library', accessibility: 'library' }, agents: { 'security-reviewer': 'core', 'seo-specialist': 'drop' }, commands: { 'react-review': 'core' }, hooks: {} };
  const { errors, warnings } = validatePick({ picked, slim, externalRefs: {}, references: { 'commands:react-review': ['accessibility'] } });
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(warnings, ['commands:react-review (core) references accessibility, which is tagged library']);
});

test('allowOwner maps runtime and sub-hook ids to their top-level entry', () => {
  assert.strictEqual(allowOwner('pre:bash:block-no-verify', subHooks), 'pre:bash:dispatcher');
  assert.strictEqual(allowOwner('post:edit:console-warn', subHooks), 'post:dispatcher:sync');
  assert.strictEqual(allowOwner('post:skill:track', subHooks), 'post:dispatcher:async');
  assert.strictEqual(allowOwner('post:bash:build-complete', subHooks), 'post:dispatcher:async');
  assert.strictEqual(allowOwner('post:bash:dispatcher', subHooks), 'post:dispatcher:async');
  assert.strictEqual(allowOwner('pre:observe', subHooks), 'pre:observe:continuous-learning');
  assert.strictEqual(allowOwner('stop:cost-tracker', subHooks), 'stop:cost-tracker');
});

test('apply writes tiers, keeps drop reasons, and prunes the allowlist to kept owners', () => {
  const picked = {
    skills: { 'react-patterns': 'core', 'postgres-patterns': 'library', accessibility: 'core', django: 'library' },
    agents: { 'security-reviewer': 'core', 'seo-specialist': 'drop' },
    commands: { 'react-review': 'core' },
    hooks: { 'pre:bash:dispatcher': 'keep', 'post:dispatcher:sync': 'drop', 'stop:cost-tracker': 'drop', 'pre:compact': 'drop' }
  };
  const allow = ['pre:bash:block-no-verify', 'post:dispatcher:sync', 'post:edit:console-warn', 'stop:cost-tracker'];
  const result = applyPick({ slim, picked, allow, subHooks, today: '2026-09-29' });
  assert.deepStrictEqual(result.slim.skills.keep, ['accessibility', 'react-patterns']);
  assert.deepStrictEqual(result.slim.skills.library, ['django', 'postgres-patterns']);
  assert.deepStrictEqual(result.slim.skills.drop, {});
  assert.deepStrictEqual(result.slim.skills.own, ['skill-advisor']);
  assert.deepStrictEqual(result.slim.agents.drop, { 'seo-specialist': 'pick 2026-09-29' });
  assert.deepStrictEqual(result.slim.hooks.keep, ['pre:bash:dispatcher']);
  assert.deepStrictEqual(result.slim.hooks.drop, { 'pre:compact': 'paid', 'post:dispatcher:sync': 'pick 2026-09-29', 'stop:cost-tracker': 'pick 2026-09-29' });
  assert.deepStrictEqual(result.allow, ['pre:bash:block-no-verify']);
});

test('apply refuses items or hooks that are not in the pick', () => {
  const picked = { skills: { 'react-patterns': 'core' }, agents: {}, commands: {}, hooks: {} };
  assert.throws(() => applyPick({ slim, picked, allow: [], subHooks, today: '2026-09-29' }), /not tagged in the pick: skills:postgres-patterns/);
});

test('findReferences finds distinctive names and ecc: or path forms of short names', () => {
  const refs = findReferences(
    { 'commands:react-review': 'Use the accessibility skill. See skills/seo/SKILL.md. Not seo alone. Also /plan.' },
    ['accessibility', 'seo', 'plan', 'react-review']
  );
  assert.deepStrictEqual(refs, { 'commands:react-review': ['accessibility', 'seo', 'plan'] });
});

test('orderItems puts current items first and flags earlier drops', () => {
  const items = [
    { kind: 'skills', name: 'a', tag: 'drop', description: '', signals: 'used 2x' },
    { kind: 'skills', name: 'b', tag: 'core', description: '', signals: '' }
  ];
  const result = orderItems(items, { skills: { keep: ['b'], library: [], drop: { a: 'lang' } } });
  assert.deepStrictEqual(result.map(item => item.name), ['b', 'a']);
  assert.strictEqual(result[1].signals, 'dropped earlier: lang; used 2x');
  assert.strictEqual(result[0].signals, '');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
