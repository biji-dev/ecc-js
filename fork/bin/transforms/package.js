'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, createTrackedExists } = require('../lib/git');

const FORK_SCRIPTS = {
  'fork:sync': 'node fork/bin/sync.js',
  'fork:apply': 'node fork/bin/sync.js --decisions-only',
  'fork:plan': 'node fork/bin/sync.js --plan',
  'fork:verify': 'node fork/bin/verify.js',
  'fork:bump': 'node fork/bin/verify.js --bump',
};

let trackedExists = null;

function exists(p) {
  if (!trackedExists) trackedExists = createTrackedExists();
  return trackedExists(p);
}

/** Script command strings reference repo files; keep an entry only if they all still exist. */
function referencedFilesExist(command) {
  const pattern = /(?<![\w./-])(?:\.\/)?((?:scripts|docker|tests|fork|tools)\/[\w./-]+\.(?:js|mjs|cjs|sh|py)|[\w-]+\.py)\b/g;
  return [...command.matchAll(pattern)].every(match => exists(match[1]));
}

function npmRunRefs(command) {
  return [...command.matchAll(/npm run(?:-script)?(?:\s+--?[\w-]+)*\s+([\w:.-]+)/g)].map(match => match[1]);
}

function transformPackage() {
  trackedExists = null;
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const removed = { files: [], bin: [], scripts: [] };

  pkg.files = pkg.files.filter(entry => {
    if (entry.startsWith('!')) return true;
    const keep = exists(entry);
    if (!keep) removed.files.push(entry);
    return keep;
  });

  for (const [name, target] of Object.entries(pkg.bin || {})) {
    if (!exists(target)) {
      delete pkg.bin[name];
      removed.bin.push(name);
    }
  }

  pkg.scripts = pkg.scripts || {};
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (!referencedFilesExist(command)) {
      delete pkg.scripts[name];
      removed.scripts.push(name);
    }
  }
  // Fixed point: drop scripts chaining to scripts removed above (transitively).
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (npmRunRefs(command).some(ref => !(ref in pkg.scripts) && !(ref in FORK_SCRIPTS))) {
        delete pkg.scripts[name];
        removed.scripts.push(name);
        changed = true;
      }
    }
  }
  // Harness package blocks (e.g. Pi) whose entrypoints were pruned would fail to load.
  if (pkg.pi && (pkg.pi.extensions || []).some(entry => !exists(entry.replace(/^\.\//, '')))) {
    delete pkg.pi;
    removed.scripts.push('pi (package block)');
  }
  Object.assign(pkg.scripts, FORK_SCRIPTS);
  // Upstream tests exercise upstream hook gating; the fork allowlist is covered by tests/fork.
  const testPrefix = 'export ECC_HOOK_ALLOWLIST=off && ';
  if (pkg.scripts.test && !pkg.scripts.test.startsWith(testPrefix)) {
    pkg.scripts.test = `${testPrefix}${pkg.scripts.test}`;
  }

  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  syncLockBin(pkg);
  return removed;
}

/** package-lock.json mirrors package.json bin in packages[""]. */
function syncLockBin(pkg) {
  const lockPath = path.join(REPO_ROOT, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return;
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const root = lock.packages && lock.packages[''];
  if (!root || !root.bin) return;
  root.bin = { ...pkg.bin };
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

/** Line range of a top-level YAML list: from `key:` to the next top-level key or end of file. */
function yamlListRange(lines, key) {
  const start = lines.findIndex(line => line.trimEnd() === `${key}:`);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_-]+:/.test(lines[end])) end += 1;
  return { start, end };
}

function readYamlList(text, key) {
  const lines = text.split('\n');
  const range = yamlListRange(lines, key);
  if (!range) return [];
  return lines.slice(range.start + 1, range.end)
    .map(line => line.match(/^\s*-\s+(.+?)\s*$/))
    .filter(Boolean)
    .map(match => match[1].replace(/^["']|["']$/g, ''));
}

function replaceYamlList(text, key, values) {
  const lines = text.split('\n');
  const range = yamlListRange(lines, key);
  if (!range) return text;
  const body = lines.slice(range.start + 1, range.end);
  const firstItem = body.find(line => /^\s*-\s+/.test(line));
  const indent = firstItem ? firstItem.match(/^(\s*)/)[1] : '  ';
  const trailingBlank = body.length && body[body.length - 1].trim() === '' ? [''] : [];
  lines.splice(range.start + 1, range.end - range.start - 1, ...values.map(value => `${indent}- ${value}`), ...trailingBlank);
  return lines.join('\n');
}

/** agent.yaml: commands must equal commands/*.md; skills filtered to existing dirs. */
function transformAgentYaml() {
  const yamlPath = path.join(REPO_ROOT, 'agent.yaml');
  if (!fs.existsSync(yamlPath)) return null;
  let text = fs.readFileSync(yamlPath, 'utf8');
  const commands = fs.readdirSync(path.join(REPO_ROOT, 'commands'))
    .filter(file => file.endsWith('.md'))
    .map(file => file.slice(0, -3))
    .sort();
  const skills = readYamlList(text, 'skills').filter(name => exists(`skills/${name}/SKILL.md`));
  text = replaceYamlList(text, 'skills', skills);
  text = replaceYamlList(text, 'commands', commands);
  fs.writeFileSync(yamlPath, text);
  return { skills: skills.length, commands: commands.length };
}

module.exports = { transformPackage, transformAgentYaml, FORK_SCRIPTS };
