/**
 * Tests for docs/HARNESS.md (biji-dev/ecc-js): the versions it states match the skills and the plugin,
 * every skill path and relative link it names resolves, and no machine path reaches this public file.
 * The checks take the doc's text as an argument, so each failure is seen once against a wrong copy.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'HARNESS.md');
const BOOTSTRAP = path.join(ROOT, 'skills', 'harness-bootstrap');
const DELEGATE = path.join(ROOT, 'skills', 'delegate-tasks');

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

function skillVersion(dir) {
  const match = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').match(/^ {2}version: (\d+)$/m);
  assert.ok(match, `${dir}/SKILL.md has no metadata.version`);
  return Number(match[1]);
}

const pluginVersion = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

function statedVersions(text) {
  const line = text.split('\n').find(l => l.startsWith('**Describes:**'));
  assert.ok(line, 'no **Describes:** line');
  const skills = line.match(/`version: (\d+)`/);
  const plugin = line.match(/plugin `([^`]+)`/);
  assert.ok(skills && plugin, `the Describes line names no skills or plugin version: ${line}`);
  return { skills: Number(skills[1]), plugin: plugin[1] };
}

function buildParts(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)-js\.(\d+)$/);
  assert.ok(match, `not a fork plugin version: ${version}`);
  return match.slice(1).map(Number);
}

/** Lexicographic, so that a new upstream version may restart the build number. */
function isAhead(version, other) {
  const [a, b] = [buildParts(version), buildParts(other)];
  const first = a.findIndex((part, i) => part !== b[i]);
  return first !== -1 && a[first] > b[first];
}

// The plugin build moves for any shipped change, so a build later than the stated one is fine. The skills version moves
// only when an install must upgrade, and that is when this doc is stale. Same-version rounds rest on FORK.md's checklist.
function checkVersions(text) {
  const stated = statedVersions(text);
  assert.strictEqual(stated.skills, skillVersion(BOOTSTRAP), 'skills version differs from harness-bootstrap');
  assert.strictEqual(stated.skills, skillVersion(DELEGATE), 'skills version differs from delegate-tasks');
  assert.ok(!isAhead(stated.plugin, pluginVersion()), `stated plugin ${stated.plugin} is ahead of .claude-plugin/plugin.json`);
}

const codeSpans = text => [...text.matchAll(/`([^`\n]+)`/g)].map(m => m[1]);

/** What each backticked skill path resolves to, with any `:line` and any glob or placeholder path left out. */
function namedSkillPaths(text) {
  const named = new Set();
  for (const span of codeSpans(text)) {
    if (/[<>*{}\s]/.test(span)) continue;
    const bare = span.replace(/:\d+$/, '');
    if (/^skills\/(harness-bootstrap|delegate-tasks)\//.test(bare)) named.add(bare);
    else if (/^delegate-tasks\/reference\/[\w.-]+$/.test(bare)) named.add(`skills/${bare}`);
    else if (/^reference\/[\w.-]+\.md$/.test(bare) || /^templates\/[\w./-]+$/.test(bare)) named.add(`skills/harness-bootstrap/${bare}`);
  }
  return [...named];
}

function checkSkillPaths(text) {
  const named = namedSkillPaths(text);
  assert.ok(named.length > 0, 'found no skill paths, so the check is not reading the doc');
  const missing = named.filter(p => !fs.existsSync(path.join(ROOT, p)));
  assert.deepStrictEqual(missing, [], `missing skill paths: ${missing.join(', ')}`);
}

const withoutFences = text => text.replace(/^```[\s\S]*?^```$/gm, '');
const markdownLinks = text => [...withoutFences(text).matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]);

function checkRelativeLinks(text) {
  const links = markdownLinks(text).filter(l => !l.startsWith('#') && !/^[a-z]+:/.test(l));
  assert.ok(links.length > 0, 'found no relative links, so the check is not reading the doc');
  const missing = links.filter(l => !fs.existsSync(path.join(path.dirname(DOC), l.split('#')[0])));
  assert.deepStrictEqual(missing, [], `broken relative links: ${missing.join(', ')}`);
}

/** GitHub's heading anchor, for the characters this doc's headings use. */
function slug(heading) {
  return heading
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');
}

function checkAnchors(text) {
  const anchors = new Set(withoutFences(text).split('\n').filter(l => /^#{1,6} /.test(l)).map(l => slug(l.replace(/^#+ /, ''))));
  const links = markdownLinks(text).filter(l => l.startsWith('#'));
  assert.ok(links.length > 0, 'found no anchor links, so the check is not reading the doc');
  const missing = links.filter(l => !anchors.has(l.slice(1)));
  assert.deepStrictEqual(missing, [], `broken anchors: ${missing.join(', ')}`);
}

function checkNoMachinePaths(text) {
  const hits = text.split('\n').filter(l => /(^|[\s`("'])\/(Users|home|root)\//.test(l));
  assert.deepStrictEqual(hits, [], `machine paths in a public file: ${hits.join(' | ')}`);
}

const doc = fs.readFileSync(DOC, 'utf8');

console.log('\n=== Testing docs/HARNESS.md ===\n');

test('the stated skills version matches both skills, and the stated plugin is not ahead of the manifest', () => checkVersions(doc));
test('every skill path it names exists', () => checkSkillPaths(doc));
test('every relative Markdown link resolves', () => checkRelativeLinks(doc));
test('every anchor link has its heading', () => checkAnchors(doc));
test('it holds no machine path', () => checkNoMachinePaths(doc));

test('each check fails on a wrong copy of the doc', () => {
  const describes = doc.split('\n').find(l => l.startsWith('**Describes:**'));
  const mutants = [
    [checkVersions, doc.replace(describes, describes.replace(/`version: \d+`/, '`version: 999`')), /skills version differs/],
    [checkVersions, doc.replace(describes, describes.replace(/plugin `[^`]+`/, 'plugin `99.0.0-js.0`')), /is ahead of/],
    [checkVersions, doc.replace(describes, describes.replace(/plugin `[^`]+`/, 'plugin `next`')), /not a fork plugin version/],
    [checkSkillPaths, `${doc}\n\`reference/no-such-file.md\`\n`, /missing skill paths/],
    [checkSkillPaths, `${doc}\n\`templates/no-such-file.mjs:12\`\n`, /missing skill paths/],
    [checkRelativeLinks, `${doc}\n[gone](../no-such-file.md)\n`, /broken relative links/],
    [checkAnchors, `${doc}\n[gone](#no-such-heading)\n`, /broken anchors/],
    [checkNoMachinePaths, `${doc}\nsee /Users/someone/plan.md\n`, /machine paths/],
  ];
  for (const [check, copy, expected] of mutants) assert.throws(() => check(copy), expected);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
