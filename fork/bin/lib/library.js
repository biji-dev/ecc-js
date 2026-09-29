'use strict';

const fs = require('fs');
const path = require('path');

/** Kinds that have a library tier. Rule packs are installed separately and have none. */
const LIBRARY_KINDS = ['skills', 'agents', 'commands'];

/** Upstream path of a library item and its path under library/ (skill paths end with a slash). */
function itemPaths(kind, name) {
  if (kind === 'skills') return { upstream: `skills/${name}/`, library: `library/skills/${name}/` };
  return { upstream: `${kind}/${name}.md`, library: `library/${kind}/${name}.md` };
}

function filesOf(refFiles, upstream) {
  return upstream.endsWith('/') ? refFiles.filter(file => file.startsWith(upstream)) : refFiles.filter(file => file === upstream);
}

/**
 * Rewrite library/ from an upstream file list. library/ is deleted first, so files of items that
 * left the library tier and files upstream deleted do not survive.
 * refFiles: repo-relative paths at the ref. readBlob(file) -> Buffer. root: repo root.
 */
function materialiseLibrary({ slim, refFiles, readBlob, root }) {
  const written = [];
  const missing = [];
  fs.rmSync(path.join(root, 'library'), { recursive: true, force: true });
  for (const kind of LIBRARY_KINDS) {
    for (const name of (slim[kind] && slim[kind].library) || []) {
      const { upstream, library } = itemPaths(kind, name);
      const files = filesOf(refFiles, upstream);
      if (!files.length) {
        missing.push({ kind, name });
        continue;
      }
      for (const file of files) {
        const target = upstream.endsWith('/') ? `${library}${file.slice(upstream.length)}` : library;
        const absolute = path.join(root, target);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, readBlob(file));
        written.push(target);
      }
    }
  }
  return { written, missing };
}

const TIER_KINDS = ['skills', 'agents', 'commands', 'rules'];

/** Each item is in exactly one of keep/library/drop/own, and every pinned item is in keep. */
function tierViolations(slim) {
  const errors = [];
  for (const kind of TIER_KINDS) {
    const section = slim[kind] || {};
    const tiers = { keep: section.keep || [], library: section.library || [], drop: Object.keys(section.drop || {}), own: section.own || [] };
    const seen = new Map();
    for (const [tier, names] of Object.entries(tiers)) {
      for (const name of names) {
        if (seen.has(name)) errors.push(`${kind}:${name} is in both ${seen.get(name)} and ${tier}`);
        else seen.set(name, tier);
      }
    }
    for (const name of section.pinned || []) {
      if (seen.get(name) !== 'keep') errors.push(`pinned ${kind}:${name} must be in keep (is ${seen.get(name) || 'unlisted'})`);
    }
  }
  return errors;
}

/** Own items whose name upstream also uses at the given ref. */
function ownCollisions(slim, refFiles) {
  const files = new Set(refFiles);
  const hasDir = prefix => refFiles.some(file => file.startsWith(prefix));
  const hits = [];
  for (const name of (slim.skills && slim.skills.own) || []) if (hasDir(`skills/${name}/`)) hits.push(`skills:${name}`);
  for (const name of (slim.agents && slim.agents.own) || []) if (files.has(`agents/${name}.md`)) hits.push(`agents:${name}`);
  for (const name of (slim.commands && slim.commands.own) || []) if (files.has(`commands/${name}.md`)) hits.push(`commands:${name}`);
  for (const name of (slim.rules && slim.rules.own) || []) if (hasDir(`rules/${name}/`)) hits.push(`rules:${name}`);
  return hits;
}

function collisionMessage(hits) {
  return `own items collide with upstream names: ${hits.join(', ')}; rename yours, or adopt upstream's by moving the name to keep and deleting yours`;
}

/** Every library item is materialised and library/ holds nothing else. */
function libraryDrift(slim, trackedFiles) {
  const errors = [];
  const libraryFiles = trackedFiles.filter(file => file.startsWith('library/'));
  const owned = new Set();
  for (const kind of LIBRARY_KINDS) {
    for (const name of (slim[kind] && slim[kind].library) || []) {
      const { library } = itemPaths(kind, name);
      const mine = filesOf(libraryFiles, library);
      if (!mine.length) errors.push(`library ${kind}:${name} is not materialised at ${library} (gone upstream? move it to drop)`);
      mine.forEach(file => owned.add(file));
    }
  }
  const strays = libraryFiles.filter(file => !owned.has(file));
  if (strays.length) errors.push(`library/ holds files of no library item (${strays.length}): ${strays.slice(0, 5).join(', ')}`);
  return errors;
}

module.exports = { LIBRARY_KINDS, itemPaths, materialiseLibrary, tierViolations, ownCollisions, collisionMessage, libraryDrift };
