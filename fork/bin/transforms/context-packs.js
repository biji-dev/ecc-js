'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('../lib/git');

const TRIGGERS_PATH = path.join(REPO_ROOT, 'manifests', 'context-packs', 'skill-triggers@1.json');
const PROFILES_DIR = path.join(REPO_ROOT, 'manifests', 'context-profiles');

/**
 * Prune skill ids from manifests/context-profiles/*.json selections. The upstream
 * profiles require skills this fork drops (configure-ecc), and compileContextProfile()
 * rejects any id the registry does not know. "all" is a keyword, not a list.
 */
function pruneProfiles(known) {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  const removed = [];
  for (const file of fs.readdirSync(PROFILES_DIR).filter(name => name.endsWith('.json')).sort()) {
    const filePath = path.join(PROFILES_DIR, file);
    const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let changed = false;
    for (const key of Object.keys(profile.selection || {})) {
      const value = profile.selection[key];
      if (!Array.isArray(value)) continue;
      const next = value.filter(id => !String(id).startsWith('skill:') || known.has(id));
      if (next.length === value.length) continue;
      value.filter(id => !next.includes(id)).forEach(id => removed.push(`${file}:${key}:${id}`));
      profile.selection[key] = next;
      changed = true;
    }
    if (changed) fs.writeFileSync(filePath, `${JSON.stringify(profile, null, 2)}\n`);
  }
  return removed;
}

/**
 * Prune manifests/context-packs/skill-triggers@1.json to the skills this fork
 * actually ships and recompute its digests.
 *
 * Upstream generates the manifest with an LLM provider
 * (scripts/dev/generate-skill-triggers.js), which is not reproducible here, so
 * the trigger phrasings are kept verbatim and only entries for pruned skills are
 * removed. scripts/ci/validate-context-profiles.js then passes: it rejects
 * triggers for skills the registry does not know, and compares the manifest's
 * registryDigest and triggersDigest against values recomputed from the tree.
 *
 * The digests must be derived with upstream's own helpers, and triggersDigest is
 * taken over the *normalised* triggers (lower-cased, trimmed, de-duplicated,
 * empty lists dropped) exactly as loadSkillTriggers() returns them.
 */
function transformContextPacks() {
  if (!fs.existsSync(TRIGGERS_PATH)) return { skipped: true };

  const { loadContextRegistry, loadSkillTriggers } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'context-pack-registry.js'));
  const { digestObject } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'context-profile-support.js'));

  const manifest = JSON.parse(fs.readFileSync(TRIGGERS_PATH, 'utf8'));
  const registry = loadContextRegistry({ repoRoot: REPO_ROOT });
  const known = new Set(registry.entries.map(entry => entry.id));

  const triggers = {};
  const removed = [];
  for (const [id, list] of Object.entries(manifest.triggers || {})) {
    if (known.has(id)) triggers[id] = list;
    else removed.push(id);
  }

  manifest.triggers = triggers;
  manifest.registryDigest = registry.registryDigest;
  fs.writeFileSync(TRIGGERS_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  // Re-read through the loader so the digest covers the normalised shape.
  const { triggers: normalised } = loadSkillTriggers({ repoRoot: REPO_ROOT });
  manifest.coverage = { skills: registry.entries.length, withTriggers: Object.keys(normalised).length };
  manifest.triggersDigest = digestObject(normalised);
  fs.writeFileSync(TRIGGERS_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    skills: registry.entries.length,
    withTriggers: Object.keys(normalised).length,
    removed,
    profilesPruned: pruneProfiles(known)
  };
}

module.exports = { transformContextPacks };
