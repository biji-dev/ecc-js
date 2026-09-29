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

module.exports = { LIBRARY_KINDS, itemPaths, materialiseLibrary };
