'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, run } = require('../lib/git');

const HOOKS_PATH = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const METADATA_PATH = path.join(REPO_ROOT, 'hooks', 'hooks.metadata.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Filter hooks.json (and its metadata sidecar, in lockstep) to the top-level
 * hook ids listed in slim.hooks.keep. Ids not listed in keep or drop are
 * removed and reported as `unknown`; the sync report lists them for a decision.
 */
function transformHooks(slim) {
  const keep = new Set((slim.hooks && slim.hooks.keep) || []);
  const drop = new Set(Object.keys((slim.hooks && slim.hooks.drop) || {}));
  const config = readJson(HOOKS_PATH);
  const hasSidecar = fs.existsSync(METADATA_PATH);
  const metadata = hasSidecar ? readJson(METADATA_PATH) : null;
  const report = { kept: [], removed: [], unknown: [] };

  for (const event of Object.keys(config.hooks)) {
    const entries = config.hooks[event];
    const sidecar = hasSidecar ? (metadata.entries[event] || []) : null;
    if (hasSidecar && sidecar.length !== entries.length) {
      throw new Error(`hooks.metadata.json ${event} has ${sidecar.length} entries but hooks.json has ${entries.length}`);
    }
    const nextEntries = [];
    const nextSidecar = [];
    entries.forEach((entry, index) => {
      const id = hasSidecar ? sidecar[index].id : entry.id;
      if (keep.has(id)) {
        nextEntries.push(entry);
        if (hasSidecar) nextSidecar.push(sidecar[index]);
        report.kept.push(id);
        return;
      }
      if (!drop.has(id)) report.unknown.push(id);
      report.removed.push(id);
    });
    // The installer rejects empty event arrays, so events with no kept hooks are removed.
    if (nextEntries.length === 0) {
      delete config.hooks[event];
      if (hasSidecar) delete metadata.entries[event];
      continue;
    }
    config.hooks[event] = nextEntries;
    if (hasSidecar) metadata.entries[event] = nextSidecar;
  }

  const missing = [...keep].filter(id => !report.kept.includes(id));
  if (missing.length > 0) {
    throw new Error(`hooks.keep ids not present upstream: ${missing.join(', ')}`);
  }

  writeJson(HOOKS_PATH, config);
  if (hasSidecar) writeJson(METADATA_PATH, metadata);
  run(process.execPath, ['scripts/ci/validate-hooks.js']);
  return report;
}

/** Top-level hook ids present in a hooks config (sidecar ids when available). */
function listHookIds() {
  const config = readJson(HOOKS_PATH);
  const metadata = fs.existsSync(METADATA_PATH) ? readJson(METADATA_PATH) : null;
  const ids = [];
  for (const event of Object.keys(config.hooks)) {
    config.hooks[event].forEach((entry, index) => {
      ids.push(metadata ? metadata.entries[event][index].id : entry.id);
    });
  }
  return ids;
}

module.exports = { transformHooks, listHookIds };
