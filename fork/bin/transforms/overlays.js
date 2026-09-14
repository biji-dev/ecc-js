'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('../lib/git');

/** Manifests carrying the plugin version, with a setter for each. */
const VERSIONED_MANIFESTS = [
  {
    file: '.claude-plugin/plugin.json',
    set: (json, v) => {
      json.version = v;
    }
  },
  {
    file: '.claude-plugin/marketplace.json',
    set: (json, v) => {
      json.plugins[0].version = v;
    }
  },
  {
    file: '.codex-plugin/plugin.json',
    set: (json, v) => {
      json.version = v;
    }
  },
  {
    file: 'plugins/ecc/.codex-plugin/plugin.json',
    set: (json, v) => {
      json.version = v;
    }
  },
  {
    file: '.agents/plugins/marketplace.json',
    set: (json, v) => {
      json.plugins[0].version = v;
    }
  }
];

const CODEX_DESCRIPTIONS = ['.codex-plugin/plugin.json', 'plugins/ecc/.codex-plugin/plugin.json'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
}

function writeJson(file, value) {
  const target = path.join(REPO_ROOT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function pluginVersion(slim, state) {
  const scheme = (slim.versioning && slim.versioning.scheme) || '{upstreamVersion}-js.{pluginBuild}';
  return scheme.replace('{upstreamVersion}', state.upstreamVersion).replace('{pluginBuild}', String(state.pluginBuild));
}

function countSkills() {
  const root = path.join(REPO_ROOT, 'skills');
  return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md'))).length;
}

function countMarkdown(dir) {
  const root = path.join(REPO_ROOT, dir);
  return fs.readdirSync(root).filter(name => name.endsWith('.md')).length;
}

const BANNER_START = '<!-- ecc-js:banner -->';
const BANNER_END = '<!-- /ecc-js:banner -->';

/**
 * README.md is upstream prose: prepend an idempotent fork banner after the hero block and
 * render the directory-tree item counts, which catalog:sync leaves untouched.
 */
function renderReadme(slim, counts) {
  const target = path.join(REPO_ROOT, 'README.md');
  if (!fs.existsSync(target)) return;
  const text = fs.readFileSync(target, 'utf8');
  const rules = [...slim.rules.keep, ...(slim.rules.own || [])].length;
  const banner = [
    BANNER_START,
    '',
    `> **ECC-JS** is a slim fork of [affaan-m/ECC](https://github.com/affaan-m/ECC) for JavaScript/TypeScript, Bun, React, Next.js and React Native/Expo work: ${counts.skills} skills, ${counts.agents} agents, ${counts.commands} commands and ${rules} rule packs. Install, scope and hooks: [docs/ECC-JS.md](docs/ECC-JS.md). Upstream sync and maintenance: [FORK.md](FORK.md). The rest of this README is upstream prose.`,
    '',
    BANNER_END
  ].join('\n');
  let next = text.includes(BANNER_START) ? text.replace(new RegExp(`${BANNER_START}[\\s\\S]*?${BANNER_END}`), banner) : text.replace(/<\/p>\r?\n/, match => `${match}\n${banner}\n`);
  next = next.replace(/^(\|-- (agents|skills|commands)\/\s+# )\d+/gm, (match, head, kind) => `${head}${counts[kind]}`);
  if (next !== text) fs.writeFileSync(target, next);
}

const LANGUAGE_SWITCHER_FILES = ['README.md', 'README.zh-CN.md', 'docs/zh-CN/README.md'];

/**
 * Remove language-switcher links to localized READMEs the fork does not ship.
 * Handles the HTML switcher (one <a> per line) and markdown rows ("[x](a.md) | [y](b.md)"),
 * resolving link targets relative to the README's own directory.
 */
function stripDeadLanguageLinks(file) {
  const target = path.join(REPO_ROOT, file);
  if (!fs.existsSync(target)) return;
  const baseDir = path.dirname(target);
  const alive = href => /^https?:/.test(href) || fs.existsSync(path.resolve(baseDir, href));
  const text = fs.readFileSync(target, 'utf8');

  let next = text.replace(/(<strong>Language:<\/strong>\r?\n)([\s\S]*?)(\r?\n<\/p>)/, (match, head, body, tail) => {
    const links = body.split('\n').filter(line => {
      const href = line.match(/href="([^"]+\.md)"/);
      return !href || alive(href[1]);
    });
    const cleaned = links.map((line, index) => (index === links.length - 1 ? line.replace(/\s*\|\s*$/, '') : line.replace(/\s*\|?\s*$/, ' |')));
    return `${head}${cleaned.join('\n')}${tail}`;
  });

  next = next
    .split('\n')
    .map(line => {
      const segments = line.split(/\s+\|\s+/);
      const readmeLinks = segments.filter(segment => /\]\([^)]*README[^)]*\.md\)/.test(segment));
      if (readmeLinks.length < 3) return line;
      const prefix = segments[0].match(/^(.*?)(\[\**[^\]]*\**\]\([^)]*\))$/);
      const kept = segments.filter((segment, index) => {
        const href = segment.match(/\]\(([^)]+\.md)\)/);
        if (!href) return true;
        return alive(href[1]) || (index === 0 && !prefix);
      });
      return kept.join(' | ');
    })
    .join('\n');

  if (next !== text) fs.writeFileSync(target, next);
}

/** Render pluginVersion (from fork/state.json) and Codex skill counts. */
function renderOverlays(slim, state) {
  LANGUAGE_SWITCHER_FILES.forEach(stripDeadLanguageLinks);
  const version = pluginVersion(slim, state);
  for (const { file, set } of VERSIONED_MANIFESTS) {
    if (!fs.existsSync(path.join(REPO_ROOT, file))) continue;
    const json = readJson(file);
    set(json, version);
    writeJson(file, json);
  }
  const skills = countSkills();
  renderReadme(slim, { skills, agents: countMarkdown('agents'), commands: countMarkdown('commands') });
  for (const file of CODEX_DESCRIPTIONS) {
    if (!fs.existsSync(path.join(REPO_ROOT, file))) continue;
    const json = readJson(file);
    if (json.interface && typeof json.interface.shortDescription === 'string') {
      json.interface.shortDescription = json.interface.shortDescription.replace(/^\d+ ECC skills/, `${skills} ECC skills`);
    }
    writeJson(file, json);
  }
  return { version, skills };
}

/**
 * Generated installer configs for harnesses that are not plugin-based.
 * Kimi gets rules plus every skill module; Claude rules-only config never
 * duplicates what the plugin already ships.
 */
function writeInstallConfigs() {
  const modules = readJson('manifests/install-modules.json').modules;
  const skillModules = modules.filter(mod => (mod.kind === 'skills' || mod.paths.some(p => p.startsWith('skills/'))) && mod.targets.includes('kimi')).map(mod => mod.id);
  writeJson('fork/install/kimi.json', {
    version: 1,
    target: 'kimi',
    modules: ['rules-core', ...skillModules]
  });
  writeJson('fork/install/claude-rules.json', {
    version: 1,
    target: 'claude',
    modules: ['rules-core']
  });
  return { kimiModules: skillModules.length + 1 };
}

module.exports = { renderOverlays, writeInstallConfigs, pluginVersion, VERSIONED_MANIFESTS };
