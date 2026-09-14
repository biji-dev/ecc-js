'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./git');
const { createMatcher } = require('./glob');

const SLIM_PATH = path.join(REPO_ROOT, 'fork', 'slim.json');
const STATE_PATH = path.join(REPO_ROOT, 'fork', 'state.json');
const QUEUE_PATH = path.join(REPO_ROOT, 'fork', 'review-queue.json');

const ITEM_KINDS = ['skills', 'agents', 'commands', 'rules'];

/** Glob patterns that make up one catalog item in the repo tree. */
const ITEM_PATTERNS = {
  skills: name => [`skills/${name}/**`],
  agents: name => [`agents/${name}.md`],
  commands: name => [`commands/${name}.md`],
  rules: name => [`rules/${name}/**`]
};

/**
 * Fork-owned paths: never merged from upstream, restored from HEAD after merges.
 * Own catalog items use the biji- prefix so upstream can never add a same-named item.
 */
const FORK_OWNED = [
  'fork/**',
  'tests/fork/**',
  'ecc/**',
  'FORK.md',
  'docs/ECC-JS.md',
  '.github/workflows/fork-*.yml',
  '.claude/rules/ecc-js-fork.md',
  'skills/biji-*/**',
  '.agents/skills/biji-*/**',
  'agents/biji-*.md',
  'commands/biji-*.md',
  'rules/biji-*/**'
];

const TRIGGER_KIND = { skill: 'skills', agent: 'agents', command: 'commands', rule: 'rules' };

/**
 * A tests.drop entry stops applying once every trigger is an item that is kept again
 * (e.g. a dropped skill moved back to keep restores its dedicated tests).
 */
function isTestDropActive(slim, entry) {
  const triggers = (entry && entry.triggeredBy) || [];
  if (triggers.length === 0) return true;
  return !triggers.every(trigger => {
    const match = String(trigger).match(/^(skill|agent|command|rule):([\w.-]+)$/);
    if (!match) return false;
    const section = slim[TRIGGER_KIND[match[1]]] || {};
    return (section.keep || []).includes(match[2]) || (section.own || []).includes(match[2]);
  });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadSlim() {
  return readJson(SLIM_PATH);
}

function loadState() {
  return readJson(STATE_PATH, {});
}

function loadQueue() {
  return readJson(QUEUE_PATH, { entries: [] });
}

function pendingNames(queue, kind) {
  return queue.entries.filter(entry => entry.kind === kind && entry.status === 'pending').map(entry => entry.name);
}

/**
 * Names of a kind that must not be present in the tree: dropped plus pending review.
 * An explicit decision (keep/own/drop) always wins over a stale pending queue entry.
 */
function removedNames(slim, queue, kind) {
  const section = slim[kind] || {};
  const decided = new Set([...(section.keep || []), ...(section.own || []), ...Object.keys(section.drop || {})]);
  const pending = pendingNames(queue, kind).filter(name => !decided.has(name));
  return [...new Set([...Object.keys(section.drop || {}), ...pending])];
}

function knownNames(slim, queue, kind) {
  const section = slim[kind] || {};
  return new Set([...(section.keep || []), ...(section.own || []), ...Object.keys(section.drop || {}), ...pendingNames(queue, kind)]);
}

/**
 * Build the drop-set predicate for repo-relative paths.
 * A path is dropped when it matches an item/mirror/path/test drop pattern
 * and does not match an explicit keep pattern or a fork-owned pattern.
 */
function buildDropMatcher(slim, queue = loadQueue()) {
  const patterns = [];
  for (const kind of ITEM_KINDS) {
    for (const name of removedNames(slim, queue, kind)) {
      patterns.push(...ITEM_PATTERNS[kind](name));
      if (kind === 'skills') {
        for (const mirror of slim.mirrors || []) patterns.push(`${mirror.replace('{name}', name)}/**`);
      }
    }
  }
  patterns.push(...((slim.paths && slim.paths.drop) || []));
  const testDrops = (slim.tests && slim.tests.drop) || {};
  patterns.push(...Object.keys(testDrops).filter(file => isTestDropActive(slim, testDrops[file])));
  // Upstream tests coupled to undecided queue items leave with the item until it is kept.
  for (const kind of ITEM_KINDS) {
    const removed = new Set(removedNames(slim, queue, kind));
    for (const entry of queue.entries) {
      if (entry.kind === kind && entry.status === 'pending' && removed.has(entry.name)) {
        patterns.push(...(entry.coupledTests || []));
      }
    }
  }
  const isDropPattern = createMatcher(patterns);
  const isKeepPattern = createMatcher([...((slim.paths && slim.paths.keep) || []), ...FORK_OWNED]);
  return filePath => isDropPattern(filePath) && !isKeepPattern(filePath);
}

/** Tracked paths belonging to kept or own items (used to materialize them from a ref). */
function keptItemMatcher(slim) {
  const patterns = [];
  for (const kind of ITEM_KINDS) {
    const section = slim[kind] || {};
    for (const name of [...(section.keep || []), ...(section.own || [])]) {
      patterns.push(...ITEM_PATTERNS[kind](name));
      if (kind === 'skills') {
        for (const mirror of slim.mirrors || []) patterns.push(`${mirror.replace('{name}', name)}/**`);
      }
    }
  }
  return createMatcher(patterns);
}

module.exports = {
  SLIM_PATH,
  STATE_PATH,
  QUEUE_PATH,
  ITEM_KINDS,
  ITEM_PATTERNS,
  FORK_OWNED,
  readJson,
  writeJson,
  loadSlim,
  loadState,
  loadQueue,
  removedNames,
  knownNames,
  isTestDropActive,
  buildDropMatcher,
  keptItemMatcher
};
