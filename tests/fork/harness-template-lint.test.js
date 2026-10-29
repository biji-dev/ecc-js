/**
 * Tests that the templates in skills/harness-bootstrap/templates pass the lint a project runs over them once
 * installed (biji-dev/ecc-js): no-useless-assignment and no-unused-vars at their defaults, over every .mjs.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Linter } = require('eslint');

const ROOT = path.join(__dirname, '..', '..');
const TEMPLATES = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates');

// The two rules one project's lint failed on: no-useless-assignment is in @eslint/js 10's recommended set,
// which this repository's own lint (9.x) does not run. A directive for a rule left out here is not
// reported: the templates disable no-control-regex where they mean it, and a recommended set runs it.
const CONFIG = {
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  linterOptions: { reportUnusedDisableDirectives: 'off' },
  rules: { 'no-useless-assignment': 'error', 'no-unused-vars': 'error' },
};

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

function mjsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mjsFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(file);
  }
  return out.sort();
}

const linter = new Linter({ cwd: ROOT });
const lint = (text, file) => linter.verify(text, CONFIG, { filename: file });
const rel = (file) => path.relative(TEMPLATES, file).split(path.sep).join('/');
const files = mjsFiles(TEMPLATES);

console.log('\nharness template lint');

test('the lint reports both rules on a file that breaks them', () => {
  const probe = 'let a = 1;\ntry {\n  a = 2;\n} catch {\n  throw new Error();\n}\nconsole.log(a);\nexport const f = (b) => 1;\n';
  const found = lint(probe, path.join(TEMPLATES, 'probe.mjs')).map((m) => `${m.line} ${m.ruleId}`);
  assert.deepStrictEqual(found, ['1 no-useless-assignment', '8 no-unused-vars']);
});

test('the hooks, the CLIs, the cores and the shipped tests are all read', () => {
  for (const want of ['command-guard.mjs', 'scripts/check-agent-docs.mjs', 'scripts/lib/unit-cost-core.mjs', 'scripts/lib/retro-core.test.mjs']) {
    assert.ok(files.some((file) => rel(file) === want), `${want} is not read (${files.length} files)`);
  }
});

test('no template has a useless assignment, an unused variable or a parse error', () => {
  const found = [];
  for (const file of files) {
    for (const m of lint(fs.readFileSync(file, 'utf8'), file)) found.push(`${rel(file)}:${m.line} ${m.ruleId ?? 'parse'}: ${m.message}`);
  }
  assert.ok(found.length === 0, `${found.length} findings:\n${found.join('\n')}`);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
