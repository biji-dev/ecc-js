'use strict';

/**
 * Contract tests for the generic desk-pattern skills kept in this fork
 * (counterparty channel discipline). They must stay vendor-neutral and free
 * of local paths.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const SKILLS = [
  'counterparty-channel-discipline',
];
const REQUIRED_SECTIONS = ['## When to Use', '## How It Works', '## Examples'];
const FORBIDDEN_WORDS = [
  'ito', 'itô', 'hermes', 'docusign', 'pluto', 'stellon', 'mayfield',
  'affaan', 'alejandro', 'graphiti', 'itomarkets',
];
const EM_DASH = '—';

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

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

console.log('\n=== Desk pattern skills ===\n');

for (const skill of SKILLS) {
  const skillDir = path.join(repoRoot, 'skills', skill);
  const skillPath = path.join(skillDir, 'SKILL.md');

  test(`${skill}: SKILL.md has name and description frontmatter`, () => {
    assert.ok(fs.existsSync(skillPath), `${skill}/SKILL.md is missing`);
    const source = fs.readFileSync(skillPath, 'utf8');
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, 'frontmatter missing');
    const keys = frontmatter[1].split('\n').map(line => line.split(':')[0]);
    assert.deepStrictEqual(keys, ['name', 'description']);
    assert.match(frontmatter[1], new RegExp(`^name: ${skill}$`, 'm'));
    assert.match(frontmatter[1], /^description: .*Use when/m);
  });

  test(`${skill}: SKILL.md has the required sections`, () => {
    const source = fs.readFileSync(skillPath, 'utf8');
    for (const section of REQUIRED_SECTIONS) {
      assert.ok(source.includes(section), `missing ${section}`);
    }
  });

  test(`${skill}: files contain no em dashes, vendor names, or local paths`, () => {
    for (const file of walk(skillDir)) {
      const relative = path.relative(repoRoot, file);
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(!source.includes(EM_DASH), `${relative} contains an em dash`);
      assert.ok(!/\/Users\//.test(source), `${relative} contains a /Users/ path`);
      for (const word of FORBIDDEN_WORDS) {
        const pattern = new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i');
        assert.ok(!pattern.test(source), `${relative} mentions "${word}"`);
      }
    }
  });
}

test('approval notices stay quiet for unknown origins and have no external fallback', () => {
  const policy = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(policy, /unknown channels default to quiet/i);
  assert.match(policy, /never_silent_ack: true.*internal channels only/i);
});

test('counterparty-channel-discipline ships a policy example and a strict prompt template', () => {
  const policy = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/references/channel-policy.example.yaml'), 'utf8');
  assert.match(policy, /require_mention: true/);
  assert.match(policy, /observe_unmentioned_group_messages: true/);
  assert.match(policy, /default: auto/);
  const template = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/references/strict-prompt.template.md'), 'utf8');
  assert.doesNotMatch(template, /\{\{CHANNEL_NAME\}\}/);
  assert.match(template, /untrusted data/);
  assert.match(template, /Never reveal one counterparty/);
});

test('channel policy separates audience, participation and output permission', () => {
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  const template = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/references/strict-prompt.template.md'), 'utf8');
  const policy = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/references/channel-policy.example.yaml'), 'utf8');
  assert.match(skill, /platform.*workspace.*channel.*identity/i);
  assert.match(skill, /historical.*thread.*never.*consent/i);
  assert.match(skill, /before.*model.*context.*media/i);
  assert.match(skill, /output.*permission.*not.*delivery.*grant/i);
  assert.match(skill, /one-to-one.*DM.*not.*audience/i);
  assert.match(skill, /no.*second.*policy.*engine/i);
  assert.doesNotMatch(template, /\{\{CHANNEL_NAME\}\}|own a direct answer|Never say you cannot|config, or capabilities/i);
  assert.match(template, /cannot read that attachment/i);
  assert.match(template, /untrusted data/i);
  assert.match(template, /internal filing notices/i);
  assert.match(policy, /schema: illustrative/);
  assert.match(policy, /workspace_id:/);
  assert.match(policy, /channel_id:/);
  assert.match(policy, /unknown_audience: external/);
  assert.match(policy, /bot_requires_scoped_operator_request: true/);
  assert.doesNotMatch(policy, /allow_bots: mentions|groups:\s*\n\s*"#/);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
