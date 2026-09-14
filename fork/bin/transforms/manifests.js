'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('../lib/git');

const MANIFEST_DIR = path.join(REPO_ROOT, 'manifests');
const REQUIRED_PROFILES = ['core', 'developer', 'security', 'research', 'full'];
const KIMI_TARGET = 'kimi';

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, name), 'utf8'));
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(MANIFEST_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function normalize(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '');
}

let trackedExists = null;

/** A path exists when git tracks it (or tracks files under it); untracked leftovers on disk do not count. */
function exists(p) {
  if (!trackedExists) trackedExists = require('../lib/git').createTrackedExists();
  return trackedExists(normalize(p));
}

function dedupe(values) {
  return [...new Set(values)];
}

function listSkillDirs() {
  const root = path.join(REPO_ROOT, 'skills');
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .filter(entry => fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
    .map(entry => entry.name);
}

/**
 * Prune install manifests after items and trees are removed so that
 * scripts/ci/validate-install-manifests.js passes, own skills are claimed by
 * a fork-own module, and every skill module can install to the Kimi target.
 */
function transformManifests(slim) {
  trackedExists = null;
  const modulesFile = readJson('install-modules.json');
  const componentsFile = readJson('install-components.json');
  const profilesFile = readJson('install-profiles.json');

  // 1. Paths must exist; each path is claimed once. A previous fork-own module is rebuilt below.
  modulesFile.modules = modulesFile.modules.filter(mod => mod.id !== 'fork-own');
  const claimed = new Set();
  for (const mod of modulesFile.modules) {
    mod.paths = dedupe(mod.paths.map(normalize)).filter(p => exists(p) && !claimed.has(p));
    mod.paths.forEach(p => claimed.add(p));
  }

  // 1b. Hook runtime ships the fork allowlist so installer-route hooks keep the same gating.
  const hooksRuntime = modulesFile.modules.find(mod => mod.id === 'hooks-runtime');
  if (hooksRuntime && fs.existsSync(path.join(REPO_ROOT, 'ecc', 'setup.json')) && !claimed.has('ecc')) {
    hooksRuntime.paths.push('ecc');
    claimed.add('ecc');
  }

  // 2. Fork-own skills get their own module (declared on purpose, so on-disk presence counts).
  const ownSkills = ((slim.skills && slim.skills.own) || [])
    .filter(name => fs.existsSync(path.join(REPO_ROOT, 'skills', name, 'SKILL.md')));
  const unclaimedOwn = ownSkills.map(name => `skills/${name}`).filter(p => !claimed.has(p));
  if (unclaimedOwn.length > 0) {
    modulesFile.modules.push({
      id: 'fork-own',
      kind: 'skills',
      description: 'Skills authored in the biji-dev/ecc-js fork.',
      paths: unclaimedOwn,
      targets: ['claude', 'claude-project', 'codex', KIMI_TARGET],
      dependencies: ['platform-configs'],
      defaultInstall: false,
      cost: 'light',
      stability: 'beta',
    });
  }

  // 3. Drop empty modules, then strip dependencies on removed modules (fix-point).
  modulesFile.modules = modulesFile.modules.filter(mod => mod.paths.length > 0);
  let changed = true;
  while (changed) {
    changed = false;
    const live = new Set(modulesFile.modules.map(mod => mod.id));
    for (const mod of modulesFile.modules) {
      const next = dedupe(mod.dependencies.filter(dep => live.has(dep) && dep !== mod.id));
      if (next.length !== mod.dependencies.length) {
        mod.dependencies = next;
        changed = true;
      }
    }
  }
  const liveIds = new Set(modulesFile.modules.map(mod => mod.id));

  // 4. Kimi can install every skill module (explicit skill:<id> components route through them).
  for (const mod of modulesFile.modules) {
    const shipsSkills = mod.kind === 'skills' || mod.paths.some(p => p.startsWith('skills/'));
    if (shipsSkills && !mod.targets.includes(KIMI_TARGET)) mod.targets.push(KIMI_TARGET);
  }

  // 5. Components: live modules only; drop stale skill:/agent: components.
  componentsFile.components = componentsFile.components
    .map(component => ({ ...component, modules: dedupe(component.modules.filter(id => liveIds.has(id))) }))
    .filter(component => {
      if (component.modules.length === 0) return false;
      const name = component.id.slice(component.id.indexOf(':') + 1);
      if (component.family === 'skill') return exists(`skills/${name}`);
      if (component.family === 'agent') return exists(`agents/${name}.md`);
      return true;
    });

  // 6. Profiles: live modules only; required profiles never empty; full lists everything.
  const profiles = profilesFile.profiles;
  const coreModules = dedupe((profiles.core && profiles.core.modules) || []).filter(id => liveIds.has(id));
  for (const [name, profile] of Object.entries(profiles)) {
    profile.modules = dedupe(profile.modules.filter(id => liveIds.has(id)));
    if (profile.modules.length === 0) {
      if (REQUIRED_PROFILES.includes(name)) profile.modules = [...coreModules];
      else delete profiles[name];
    }
  }
  const full = profiles.full;
  for (const mod of modulesFile.modules) {
    const exempt = mod.kind === 'docs' && mod.defaultInstall === false;
    if (!exempt && !full.modules.includes(mod.id)) full.modules.push(mod.id);
  }

  // 7. Every curated skill dir must be claimed by some module.
  const unclaimedSkills = listSkillDirs().filter(name => {
    const skillPath = `skills/${name}`;
    return !modulesFile.modules.some(mod => mod.paths.some(p => p === skillPath || p.startsWith(`${skillPath}/`)));
  });
  if (unclaimedSkills.length > 0) {
    throw new Error(`skills not claimed by any install module (add them to slim.skills.own or a module): ${unclaimedSkills.join(', ')}`);
  }

  writeJson('install-modules.json', modulesFile);
  writeJson('install-components.json', componentsFile);
  writeJson('install-profiles.json', profilesFile);
  return { modules: modulesFile.modules.length, components: componentsFile.components.length, profiles: Object.keys(profiles).length };
}

module.exports = { transformManifests };
