'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, listFiles, run } = require('./git');
const { loadSlim, loadState, loadQueue, buildDropMatcher, removedNames, ITEM_KINDS } = require('./config');
const { pluginVersion, VERSIONED_MANIFESTS } = require('../transforms/overlays');

const ALLOWED_WORKFLOWS = ['fork-ci.yml', 'fork-sync.yml'];

function exists(p) {
  return fs.existsSync(path.join(REPO_ROOT, p));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, p), 'utf8'));
}

function keptItemFiles(slim) {
  const files = [];
  for (const name of [...slim.commands.keep, ...slim.commands.own]) files.push(`commands/${name}.md`);
  for (const name of [...slim.agents.keep, ...slim.agents.own]) files.push(`agents/${name}.md`);
  for (const name of [...slim.skills.keep, ...slim.skills.own]) files.push(`skills/${name}/SKILL.md`);
  return files.filter(exists);
}

/** Script paths mentioned by kept commands/agents/skills and hook configs must exist. */
function scriptReferences(slim) {
  const missing = [];
  const sources = [...keptItemFiles(slim), 'hooks/hooks.json', 'hooks/codex-hooks.json'].filter(exists);
  for (const file of sources) {
    const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const itemDir = path.dirname(file);
    for (const match of text.matchAll(/(?<![\w./-])scripts\/[\w./-]+\.(?:js|mjs|cjs|sh)\b/g)) {
      const resolved = exists(match[0]) || (file.startsWith('skills/') && exists(path.join(itemDir, match[0])));
      if (!resolved && !missing.some(m => m.file === file && m.ref === match[0])) missing.push({ file, ref: match[0] });
    }
  }
  return missing;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Kept prose that still names dropped catalog items: whole-word skill/agent/command names
 * (hyphenated or 6+ chars, to avoid common words) and rules/<pack> paths for rule packs.
 */
function danglingReferences(slim, queue) {
  const itemNames = ['skills', 'agents', 'commands'].flatMap(kind => removedNames(slim, queue, kind)).filter(name => name.includes('-') || name.length >= 6);
  const ruleNames = removedNames(slim, queue, 'rules');
  const patterns = [];
  if (itemNames.length) patterns.push(`(?<![\\w-])(${itemNames.map(escapeRegex).join('|')})(?![\\w-])`);
  if (ruleNames.length) patterns.push(`rules/(${ruleNames.map(escapeRegex).join('|')})(?![\\w-])`);
  if (!patterns.length) return [];
  const regex = new RegExp(patterns.join('|'), 'g');
  const hits = [];
  const files = [...keptItemFiles(slim), '.codex/AGENTS.md'].filter(exists);
  for (const file of files) {
    const lines = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(regex)) hits.push(`${file}:${index + 1}: ${match[1] || match[2]}`);
    });
  }
  return [...new Set(hits)];
}

const SHIPPED_PREFIXES = [
  'skills/',
  'agents/',
  'commands/',
  'rules/',
  'hooks/',
  'scripts/',
  'ecc/',
  'mcp-configs/',
  'workflows/',
  '.claude-plugin/',
  '.codex-plugin/',
  '.codex/',
  '.agents/',
  'plugins/',
  '.mcp.json'
];

/**
 * Harnesses cache the plugin by version, so shipped changes without a pluginBuild bump never reach
 * users. Compares against a base ref (FORK_VERIFY_BASE or --since); skipped when no usable base.
 */
function bumpCheck(state, baseRef) {
  if (!baseRef || /^0+$/.test(baseRef)) return [];
  if (run('git', ['cat-file', '-e', `${baseRef}^{commit}`], { allowFailure: true }).status !== 0) return [];
  const changed = run('git', ['diff', '--name-only', baseRef, 'HEAD']).stdout.split('\n').filter(Boolean);
  const shipped = changed.filter(file => SHIPPED_PREFIXES.some(prefix => file === prefix || file.startsWith(prefix)));
  if (!shipped.length) return [];
  const base = run('git', ['show', `${baseRef}:fork/state.json`], { allowFailure: true });
  if (base.status !== 0) return [];
  const before = JSON.parse(base.stdout);
  if (before.upstreamVersion === state.upstreamVersion && before.pluginBuild === state.pluginBuild) {
    return [`shipped content changed since ${baseRef.slice(0, 12)} (${shipped.length} files, e.g. ${shipped.slice(0, 3).join(', ')}) without a plugin build bump; run npm run fork:bump`];
  }
  return [];
}

function kimiPlanCheck(slim) {
  const errors = [];
  const result = run(process.execPath, ['scripts/install-plan.js', '--config', 'fork/install/kimi.json', '--json'], { allowFailure: true });
  if (result.status !== 0) return [`install-plan for fork/install/kimi.json failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`];
  const plan = JSON.parse(result.stdout);
  if ((plan.skippedModuleIds || []).length) errors.push(`kimi plan skipped modules: ${plan.skippedModuleIds.join(', ')}`);
  const sources = (plan.operations || []).map(op => String(op.sourceRelativePath || ''));
  for (const name of [...slim.skills.keep, ...slim.skills.own]) {
    const covered = sources.some(src => src === 'skills' || src === `skills/${name}` || src.startsWith(`skills/${name}/`));
    if (!covered) errors.push(`kimi plan does not install skills/${name}`);
  }
  return errors;
}

/**
 * Rebuild every derived file from upstream (state.lastUpstreamRef) and regenerate it with the
 * transforms, then compare with the committed tree. Catches hand edits to derived files, not
 * only transform instability. The working tree is always restored afterwards.
 */
function driftCheck(slim, state) {
  const { runTransforms } = require('../transforms');
  const { GENERATED_EXTRA } = require('./apply');
  const { showFile } = require('./inventory');
  const files = [...new Set([...slim.derived, ...GENERATED_EXTRA])];
  const read = file => (exists(file) ? fs.readFileSync(path.join(REPO_ROOT, file), 'utf8') : null);
  const snapshot = new Map(files.map(file => [file, read(file)]));
  const drifted = [];
  try {
    for (const file of slim.derived) {
      const upstream = showFile(state.lastUpstreamRef, file);
      if (upstream !== null) fs.writeFileSync(path.join(REPO_ROOT, file), upstream);
    }
    runTransforms(slim, state);
    for (const [file, before] of snapshot) {
      if (read(file) !== before) drifted.push(file);
    }
  } finally {
    for (const [file, before] of snapshot) {
      const target = path.join(REPO_ROOT, file);
      if (before === null) fs.rmSync(target, { force: true });
      else fs.writeFileSync(target, before);
    }
  }
  return drifted;
}

function runChecks({ drift = false, kimi = true, since = process.env.FORK_VERIFY_BASE } = {}) {
  const slim = loadSlim();
  const state = loadState();
  const queue = loadQueue();
  const errors = [];
  const warnings = [];

  const isDropped = buildDropMatcher(slim, queue);
  const tracked = listFiles();
  const leaked = tracked.filter(isDropped);
  if (leaked.length) errors.push(`tracked paths in the drop set (${leaked.length}): ${leaked.slice(0, 10).join(', ')}`);

  // Every upstream path the fork removed must be covered by the drop set, or syncs hit MANUAL modify/delete conflicts.
  if (state.lastUpstreamRef) {
    const trackedSet = new Set(tracked);
    const uncovered = listFiles(state.lastUpstreamRef).filter(file => !trackedSet.has(file) && !isDropped(file));
    if (uncovered.length) errors.push(`fork-deleted paths outside the drop set (${uncovered.length}): ${uncovered.slice(0, 10).join(', ')}`);
  }

  const workflows = exists('.github/workflows') ? fs.readdirSync(path.join(REPO_ROOT, '.github/workflows')).sort() : [];
  if (JSON.stringify(workflows) !== JSON.stringify(ALLOWED_WORKFLOWS)) {
    errors.push(`.github/workflows must contain exactly ${ALLOWED_WORKFLOWS.join(', ')}; found ${workflows.join(', ') || 'nothing'}`);
  }

  const pinPaths = { skills: n => `skills/${n}/SKILL.md`, agents: n => `agents/${n}.md`, commands: n => `commands/${n}.md`, rules: n => `rules/${n}` };
  for (const kind of ITEM_KINDS) {
    for (const name of slim[kind].pinned || []) if (!exists(pinPaths[kind](name))) errors.push(`pinned ${kind}:${name} missing`);
    for (const name of slim[kind].keep) if (!exists(pinPaths[kind](name))) errors.push(`kept ${kind}:${name} missing`);
  }
  for (const req of slim.requires || []) if (!exists(req.path)) errors.push(`required path missing: ${req.path} (${req.why})`);

  const expected = pluginVersion(slim, state);
  for (const { file } of VERSIONED_MANIFESTS) {
    if (!exists(file)) continue;
    const json = readJson(file);
    const actual = json.version || (json.plugins && json.plugins[0] && json.plugins[0].version);
    if (actual !== expected) errors.push(`${file} version ${actual} != ${expected}`);
  }

  for (const miss of scriptReferences(slim)) {
    const bucket = miss.file.startsWith('skills/') || miss.file.startsWith('agents/') ? warnings : errors;
    bucket.push(`${miss.file} references missing ${miss.ref}`);
  }

  const codex = readJson('.codex-plugin/plugin.json');
  for (const key of ['skills', 'mcpServers', 'hooks']) if (codex[key] && !exists(codex[key])) errors.push(`.codex-plugin ${key} path missing: ${codex[key]}`);

  if (kimi) errors.push(...kimiPlanCheck(slim));
  if (drift) {
    const drifted = driftCheck(slim, state);
    if (drifted.length) errors.push(`derived files drift from transforms: ${drifted.join(', ')}`);
  }
  errors.push(...bumpCheck(state, since));
  const dangling = danglingReferences(slim, queue);
  if (dangling.length) warnings.push(`kept prose names dropped items (${dangling.length}), e.g. ${dangling.slice(0, 5).join('; ')}`);
  return { errors, warnings };
}

module.exports = { runChecks, scriptReferences, danglingReferences, bumpCheck, ALLOWED_WORKFLOWS };
