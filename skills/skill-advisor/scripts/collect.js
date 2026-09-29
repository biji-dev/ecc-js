#!/usr/bin/env node
'use strict';

/**
 * skill-advisor evidence collector. Deterministic: reads local sessions, docs, package files
 * and the library catalog of one project. No network, no model calls.
 * Usage: node collect.js [--project <dir>] [--home <dir>] [--library <dir>] [--out <file>]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectSessions, summarise, UNAVAILABLE_TOOLS } = require('./lib/sessions');
const { DEFAULT_LIBRARY, catalog, readState, itemStatus } = require('./lib/state');

const DOC_CAP = 8 * 1024;
const DOCS_TOTAL = 200 * 1024;
const DOC_NAME = /(prd|trd|spec|plan)/i;
const ROOT_DOCS = new Set(['CLAUDE.md', 'AGENTS.md', 'README.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.turbo', 'coverage', '.venv']);
const LOCKFILES = [['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['package-lock.json', 'npm']];
const CONFIG_PATTERN = /^(next|vite|astro|nuxt|svelte|remix|drizzle|tailwind|playwright|vitest|jest)\.config\.[cm]?[jt]s$|^(app\.json|app\.config\.[jt]s|eas\.json|docker-compose\.ya?ml|schema\.prisma|wrangler\.toml|turbo\.json)$/;

function walk(dir, visit, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, visit, depth + 1);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

/** Is a project-relative markdown path a planning doc? Installed skills and harness config are not. */
function isDoc(rel) {
  const parts = rel.split(path.sep);
  if (parts.some(part => part === '.claude' || part === '.agents' || part === '.codex')) {
    const at = parts.indexOf('.claude');
    return at >= 0 && parts[at + 1] === 'plans';
  }
  return parts.includes('docs') || DOC_NAME.test(path.basename(rel)) || ROOT_DOCS.has(rel);
}

function findDocs(project, sessionDocs) {
  const found = new Set();
  walk(project, file => {
    if (file.endsWith('.md') && isDoc(path.relative(project, file))) found.add(file);
  });
  for (const file of sessionDocs) {
    if (file.startsWith(project + path.sep) && file.endsWith('.md') && fs.existsSync(file) && !path.relative(project, file).split(path.sep).includes('node_modules')) found.add(file);
  }
  return [...found].sort();
}

function readDocs(files) {
  const result = { files: [], truncated: [], omitted: [] };
  let total = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (total >= DOCS_TOTAL) {
      result.omitted.push(file);
      continue;
    }
    const kept = text.slice(0, Math.min(DOC_CAP, DOCS_TOTAL - total));
    if (kept.length < text.length) result.truncated.push(file);
    total += kept.length;
    result.files.push({ path: file, bytes: text.length, text: kept });
  }
  return result;
}

function detectStack(project) {
  const dependencies = new Set();
  const configs = new Set();
  walk(project, file => {
    const name = path.basename(file);
    if (name === 'package.json') {
      try {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) Object.keys(pkg[key] || {}).forEach(dep => dependencies.add(dep));
      } catch {
        // A malformed package.json is skipped; it is evidence, not a requirement.
      }
    }
    if (CONFIG_PATTERN.test(name)) configs.add(name);
  });
  const lock = LOCKFILES.find(([file]) => fs.existsSync(path.join(project, file)));
  return { dependencies: [...dependencies].sort(), lockfile: lock ? lock[1] : null, configs: [...configs].sort() };
}

function collect({ project, home, libraryRoot }) {
  const summary = summarise(collectSessions({ home, project }));
  const current = readState(project);
  return {
    project,
    generatedAt: new Date().toISOString(),
    sessions: { ...summary, unavailable: UNAVAILABLE_TOOLS },
    docs: readDocs(findDocs(project, summary.docsWritten)),
    stack: detectStack(project),
    catalog: catalog(libraryRoot),
    state: { items: current.items.map(item => ({ ...item, status: itemStatus(project, libraryRoot, item) })), declined: current.declined }
  };
}

function parseArgs(argv) {
  const args = { project: process.cwd(), home: os.homedir(), library: DEFAULT_LIBRARY, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args)) throw new Error(`Unknown argument: ${argv[i]}`);
    args[key] = argv[++i];
  }
  return args;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const evidence = collect({ project: path.resolve(args.project), home: args.home, libraryRoot: path.resolve(args.library) });
    const text = `${JSON.stringify(evidence, null, 2)}\n`;
    if (args.out) fs.writeFileSync(args.out, text);
    else process.stdout.write(text);
  } catch (error) {
    process.stderr.write(`[skill-advisor] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { collect };
