'use strict';

const { git, listFiles, run } = require('./git');
const { ITEM_KINDS, knownNames } = require('./config');

function showFile(ref, filePath) {
  const result = run('git', ['show', `${ref}:${filePath}`], { allowFailure: true });
  return result.status === 0 ? result.stdout : null;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

/** Catalog, hook and script inventory of an upstream ref (read from git objects, not the working tree). */
function inventoryAt(ref) {
  const files = listFiles(ref);
  const inventory = {
    skills: uniqueSorted(files.map(f => f.match(/^skills\/([^/]+)\/SKILL\.md$/)).filter(Boolean).map(m => m[1])),
    agents: uniqueSorted(files.map(f => f.match(/^agents\/([^/]+)\.md$/)).filter(Boolean).map(m => m[1])),
    commands: uniqueSorted(files.map(f => f.match(/^commands\/([^/]+)\.md$/)).filter(Boolean).map(m => m[1])),
    rules: uniqueSorted(files.map(f => f.match(/^rules\/([^/]+)\/.+/)).filter(Boolean).map(m => m[1])),
    scripts: uniqueSorted(files.filter(f => /^scripts\/[^/]+\.(?:js|mjs|cjs|sh)$/.test(f))),
    libDirs: uniqueSorted(files.map(f => f.match(/^scripts\/lib\/([^/]+)\/.+/)).filter(Boolean).map(m => `scripts/lib/${m[1]}`)),
    topLevel: uniqueSorted(files.map(f => f.split('/')[0])),
    hookIds: [],
    subHookIds: [],
    bins: [],
  };

  const metadata = showFile(ref, 'hooks/hooks.metadata.json');
  const hooks = showFile(ref, 'hooks/hooks.json');
  if (metadata) {
    const entries = JSON.parse(metadata).entries || {};
    inventory.hookIds = uniqueSorted(Object.values(entries).flat().map(entry => entry.id));
  } else if (hooks) {
    inventory.hookIds = uniqueSorted(Object.values(JSON.parse(hooks).hooks || {}).flat().map(entry => entry.id).filter(Boolean));
  }

  for (const dispatcher of ['scripts/hooks/bash-hook-dispatcher.js', 'scripts/hooks/posttooluse-dispatcher.js']) {
    const source = showFile(ref, dispatcher) || '';
    inventory.subHookIds.push(...[...source.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]));
  }
  inventory.subHookIds = uniqueSorted(inventory.subHookIds);

  const pkg = showFile(ref, 'package.json');
  if (pkg) inventory.bins = uniqueSorted(Object.keys(JSON.parse(pkg).bin || {}));
  return inventory;
}

/** Items present at the ref but unknown to slim.json (NEW), and kept items missing at the ref (GONE). */
function diffInventory(slim, queue, inventory) {
  const added = {};
  const gone = {};
  for (const kind of ITEM_KINDS) {
    const known = knownNames(slim, queue, kind);
    const present = new Set(inventory[kind]);
    added[kind] = inventory[kind].filter(name => !known.has(name));
    const section = slim[kind] || {};
    const pinned = new Set(section.pinned || []);
    gone[kind] = (section.keep || []).filter(name => !present.has(name)).map(name => ({ name, pinned: pinned.has(name) }));
  }
  const knownHooks = new Set([...(slim.hooks.keep || []), ...Object.keys(slim.hooks.drop || {})]);
  added.hooks = inventory.hookIds.filter(id => !knownHooks.has(id));
  gone.hooks = (slim.hooks.keep || []).filter(id => !inventory.hookIds.includes(id)).map(name => ({ name, pinned: true }));
  return { added, gone };
}

/** Upstream paths added between two refs that match a predicate (e.g. new scripts, lib dirs). */
function addedBetween(fromRef, toRef, pathspecs) {
  return git(['diff', '--name-only', '--diff-filter=A', fromRef, toRef, '--', ...pathspecs])
    .split('\n')
    .filter(Boolean);
}

/**
 * Successor hints for a GONE item: renames/deletes whose source is one of its paths.
 * The diff spans every catalog tree so git can pair renames into other kinds or trees.
 */
function successorHints(fromRef, toRef, itemPaths) {
  const prefixes = itemPaths.map(p => (p.endsWith('.md') ? p : `${p.replace(/\/$/, '')}/`));
  const out = git(['diff', '-M', '-l0', '--name-status', fromRef, toRef, '--', 'skills/', 'agents/', 'commands/', 'rules/', 'legacy-command-shims/']);
  return [...new Set(out.split('\n').filter(line => {
    const match = line.match(/^(R\d*|D)\t([^\t]+)/);
    return match && prefixes.some(prefix => match[2] === prefix || match[2].startsWith(prefix));
  }))];
}

module.exports = { inventoryAt, diffInventory, addedBetween, successorHints, showFile };
