'use strict';

/**
 * Library catalog, content hashes and the per-project state file of skill-advisor.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** library/ at the plugin root: scripts/lib -> scripts -> skill-advisor -> skills -> root. */
const DEFAULT_LIBRARY = path.resolve(__dirname, '..', '..', '..', '..', 'library');
const STATE_FILE = path.join('.claude', 'skill-advisor.json');
const KIND_DIRS = { skill: 'skills', agent: 'agents', command: 'commands' };

function listFilesRecursive(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** sha256 over sorted relative paths and contents (a single file hashes its content only). */
function hashPath(target) {
  const hash = crypto.createHash('sha256');
  const files = fs.statSync(target).isDirectory() ? listFilesRecursive(target) : [''];
  for (const rel of files) {
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(rel ? path.join(target, rel) : target));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function librarySource(libraryRoot, kind, name) {
  return kind === 'skill' ? path.join(libraryRoot, 'skills', name) : path.join(libraryRoot, KIND_DIRS[kind], `${name}.md`);
}

/** Project-relative install paths: skills go to Claude Code (.claude) and Codex (.agents). */
function destinations(kind, name) {
  if (kind === 'skill') return [path.join('.claude', 'skills', name), path.join('.agents', 'skills', name)];
  return [path.join('.claude', KIND_DIRS[kind], `${name}.md`)];
}

function readState(project) {
  const file = path.join(project, STATE_FILE);
  if (!fs.existsSync(file)) return { version: 1, items: [], declined: [] };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { version: 1, items: parsed.items || [], declined: parsed.declined || [] };
}

function writeState(project, value) {
  const file = path.join(project, STATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function frontmatterDescription(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return '';
  const line = match[1].split('\n').find(entry => entry.startsWith('description:'));
  return line ? line.slice('description:'.length).trim().replace(/^["']|["']$/g, '') : '';
}

/** Every item in library/, skills first, each kind sorted by name. */
function catalog(libraryRoot) {
  const items = [];
  const skillsDir = path.join(libraryRoot, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir).sort()) {
      const file = path.join(skillsDir, name, 'SKILL.md');
      if (fs.existsSync(file)) items.push({ kind: 'skill', name, description: frontmatterDescription(fs.readFileSync(file, 'utf8')) });
    }
  }
  for (const kind of ['agent', 'command']) {
    const dir = path.join(libraryRoot, KIND_DIRS[kind]);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.md')).sort()) {
      items.push({ kind, name: file.slice(0, -3), description: frontmatterDescription(fs.readFileSync(path.join(dir, file), 'utf8')) });
    }
  }
  return items;
}

/**
 * current: copies match the recorded hash and the library; outdated: the library changed;
 * modified: a copy was edited; missing: a copy was deleted; gone: the item left the library.
 */
function itemStatus(project, libraryRoot, item) {
  const present = item.paths.filter(rel => fs.existsSync(path.join(project, rel)));
  if (present.length < item.paths.length) return 'missing';
  if (present.some(rel => hashPath(path.join(project, rel)) !== item.hash)) return 'modified';
  const source = librarySource(libraryRoot, item.kind, item.name);
  if (!fs.existsSync(source)) return 'gone';
  return hashPath(source) === item.hash ? 'current' : 'outdated';
}

function pluginVersionOf(libraryRoot) {
  for (const manifest of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const file = path.join(libraryRoot, '..', manifest);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).version || 'unknown';
  }
  return 'unknown';
}

module.exports = {
  DEFAULT_LIBRARY,
  STATE_FILE,
  hashPath,
  librarySource,
  destinations,
  readState,
  writeState,
  catalog,
  itemStatus,
  pluginVersionOf
};
