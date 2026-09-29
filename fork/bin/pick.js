#!/usr/bin/env node
'use strict';

/**
 * One-time tier pick.
 *   node fork/bin/pick.js generate [--prefill <json>] [--projects-root <dir>]  -> fork/pick.md
 *   node fork/bin/pick.js apply                                                 -> fork/slim.json, ecc/setup.json
 * --prefill JSON: { "core": { "skills": [], "agents": [], "commands": [] }, "library": { ...same }, "hooks": { "keep": [] } }.
 * Items not named in the prefill default to their current tier (keep -> core).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO_ROOT, run } = require('./lib/git');
const { loadSlim, loadState, writeJson, SLIM_PATH } = require('./lib/config');
const { frontmatterDescription } = require('./lib/queue');
const { PICK_KINDS, renderPick, parsePick, validatePick, applyPick, findReferences } = require('./lib/pick');

const PICK_PATH = path.join(REPO_ROOT, 'fork', 'pick.md');
const SETUP_PATH = path.join(REPO_ROOT, 'ecc', 'setup.json');
const REFS_PATH = path.join(REPO_ROOT, 'fork', '.pick-refs.json');

function itemFile(kind, name) {
  const base = kind === 'skills' ? `${kind}/${name}/SKILL.md` : `${kind}/${name}.md`;
  for (const root of ['', 'library/']) {
    const file = path.join(REPO_ROOT, root + base);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function itemText(kind, name) {
  const file = itemFile(kind, name);
  if (file) return fs.readFileSync(file, 'utf8');
  const state = loadState();
  const base = kind === 'skills' ? `${kind}/${name}/SKILL.md` : `${kind}/${name}.md`;
  const shown = run('git', ['show', `${state.lastUpstreamRef}:${base}`], { allowFailure: true });
  return shown.status === 0 ? shown.stdout : '';
}

/** ecc: names referenced from CLAUDE.md, AGENTS.md, .claude/ and .agents/ markdown of every other project. */
function externalReferences(projectsRoot) {
  const refs = {};
  if (!fs.existsSync(projectsRoot)) return refs;
  const scan = (project, file) => {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    for (const match of text.matchAll(/(?:ecc|everything-claude-code):([a-z0-9-]+)/g)) {
      refs[match[1]] = [...new Set([...(refs[match[1]] || []), project])];
    }
  };
  const walk = (project, dir, depth) => {
    if (depth > 6 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', '.git', '.worktrees'].includes(entry.name)) walk(project, full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.md')) scan(project, full);
    }
  };
  for (const project of fs.readdirSync(projectsRoot)) {
    const dir = path.join(projectsRoot, project);
    if (!fs.statSync(dir).isDirectory() || path.resolve(dir) === REPO_ROOT) continue;
    for (const top of ['CLAUDE.md', 'AGENTS.md']) scan(project, path.join(dir, top));
    walk(project, path.join(dir, '.claude'), 0);
    walk(project, path.join(dir, '.agents'), 0);
  }
  return refs;
}

/** Use counts by item name across every project (ecc:<name> and bare <name>). */
function usageByName() {
  const { collectSessions, summarise } = require('../../skills/skill-advisor/scripts/lib/sessions');
  const { usage } = summarise(collectSessions({ home: os.homedir(), project: null }));
  const counts = {};
  for (const [key, value] of Object.entries(usage)) {
    const name = key.split(':').pop();
    const invoked = key.slice(key.indexOf(':') + 1);
    if (invoked === name || invoked === `ecc:${name}`) counts[name] = (counts[name] || 0) + value;
  }
  return counts;
}

/** Same list as PROTECTED_TESTS in lib/queue.js: tests of kept installer and hook code are never dropped automatically. */
const PROTECTED_TESTS = /(?:install|hook-flags|resolve-ecc-root|hooks-config|dispatcher)/;

function coupledTests(ref, kind, name) {
  const needles = [kind === 'skills' ? `skills/${name}/` : `${kind}/${name}.md`];
  if (name.includes('-') || name.length >= 6) needles.push(name);
  const result = run('git', ['grep', '-l', '-w', '-F', ...needles.flatMap(needle => ['-e', needle]), ref, '--', 'tests/'], { allowFailure: true });
  const files = result.stdout.split('\n').filter(Boolean).map(line => line.slice(ref.length + 1)).filter(file => !file.startsWith('tests/fork/'));
  return { coupled: files.filter(file => !PROTECTED_TESTS.test(file)), protectedTests: files.filter(file => PROTECTED_TESTS.test(file)) };
}

function generate(args) {
  const slim = loadSlim();
  const prefill = args.prefill ? JSON.parse(fs.readFileSync(args.prefill, 'utf8')) : null;
  const refs = externalReferences(args.projectsRoot);
  const usage = usageByName();
  const items = [];
  const texts = {};
  const names = [];
  for (const kind of PICK_KINDS) {
    const section = slim[kind];
    const own = new Set(section.own || []);
    const all = [...new Set([...section.keep, ...(section.library || []), ...Object.keys(section.drop || {})])].filter(name => !own.has(name)).sort();
    for (const name of all) {
      const text = itemText(kind, name);
      texts[`${kind}:${name}`] = text;
      names.push(name);
      let tag = section.keep.includes(name) ? 'core' : (section.library || []).includes(name) ? 'library' : 'drop';
      if (prefill) tag = (prefill.core[kind] || []).includes(name) ? 'core' : (prefill.library[kind] || []).includes(name) ? 'library' : 'drop';
      const signals = [];
      if ((section.pinned || []).includes(name)) signals.push('pinned');
      if (usage[name]) signals.push(`used ${usage[name]}x`);
      if (refs[name]) signals.push(`ecc:${name} in ${refs[name].join(', ')}`);
      items.push({ kind, name, tag, description: frontmatterDescription(text).slice(0, 140), signals: signals.join('; ') });
    }
  }
  const references = findReferences(texts, names);
  for (const item of items) {
    const by = Object.entries(references).filter(([, hits]) => hits.includes(item.name)).map(([source]) => source);
    if (by.length) item.signals = [item.signals, `referenced by ${by.slice(0, 4).join(', ')}${by.length > 4 ? ` +${by.length - 4}` : ''}`].filter(Boolean).join('; ');
  }
  const hookIds = [...new Set([...slim.hooks.keep, ...Object.keys(slim.hooks.drop || {})])];
  const hooks = hookIds.map(id => ({ id, tag: prefill && prefill.hooks ? (prefill.hooks.keep.includes(id) ? 'keep' : 'drop') : slim.hooks.keep.includes(id) ? 'keep' : 'drop' }));
  fs.writeFileSync(PICK_PATH, renderPick({ items, hooks }));
  writeJson(REFS_PATH, { externalRefs: refs, references });
  process.stdout.write(`[fork:pick] wrote ${path.relative(REPO_ROOT, PICK_PATH)} (${items.length} items, ${hooks.length} hooks); edit the tags, then run: node fork/bin/pick.js apply\n`);
  return 0;
}

function apply() {
  const slim = loadSlim();
  const state = loadState();
  const picked = parsePick(fs.readFileSync(PICK_PATH, 'utf8'));
  const { externalRefs, references } = JSON.parse(fs.readFileSync(REFS_PATH, 'utf8'));
  const { errors, warnings } = validatePick({ picked, slim, externalRefs, references });
  for (const warning of warnings) process.stdout.write(`[fork:pick] WARN ${warning}\n`);
  if (errors.length) {
    for (const error of errors) process.stderr.write(`[fork:pick] ERROR ${error}\n`);
    process.stderr.write('[fork:pick] fix the tags in fork/pick.md and rerun apply\n');
    return 1;
  }
  const { PRE_BASH_HOOKS, POST_BASH_HOOKS } = require('../../scripts/hooks/bash-hook-dispatcher');
  const { SYNC_HOOKS, ASYNC_HOOKS } = require('../../scripts/hooks/posttooluse-dispatcher');
  const subHooks = {
    preBash: PRE_BASH_HOOKS.map(hook => hook.id),
    postBash: POST_BASH_HOOKS.map(hook => hook.id),
    sync: SYNC_HOOKS.map(hook => hook.id),
    async: ASYNC_HOOKS.map(hook => hook.id)
  };
  const setup = JSON.parse(fs.readFileSync(SETUP_PATH, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const result = applyPick({ slim, picked, allow: setup.hooks.allow, subHooks, today });
  // Upstream tests coupled to items that are no longer kept leave with them (restored if kept again).
  const drops = result.slim.tests.drop;
  const trigger = { skills: 'skill', agents: 'agent', commands: 'command' };
  for (const kind of PICK_KINDS) {
    const newlyRemoved = slim[kind].keep.filter(name => !result.slim[kind].keep.includes(name));
    for (const name of newlyRemoved) {
      const { coupled, protectedTests } = coupledTests(state.lastUpstreamRef, kind, name);
      for (const file of coupled) {
        const entry = drops[file] || { reason: `coupled to items removed by pick ${today}`, triggeredBy: [] };
        entry.triggeredBy = [...new Set([...(entry.triggeredBy || []), `${trigger[kind]}:${name}`])];
        drops[file] = entry;
      }
      for (const file of protectedTests) process.stdout.write(`[fork:pick] WARN protected test ${file} mentions removed ${kind}:${name}; kept, check it in npm test\n`);
    }
  }
  writeJson(SLIM_PATH, result.slim);
  writeJson(SETUP_PATH, { ...setup, hooks: { ...setup.hooks, allow: result.allow } });
  fs.rmSync(PICK_PATH, { force: true });
  fs.rmSync(REFS_PATH, { force: true });
  const count = kind => `${result.slim[kind].keep.length} core / ${result.slim[kind].library.length} library / ${Object.keys(result.slim[kind].drop).length} drop`;
  process.stdout.write(`[fork:pick] skills ${count('skills')}; agents ${count('agents')}; commands ${count('commands')}; hooks keep ${result.slim.hooks.keep.length}\n`);
  process.stdout.write('[fork:pick] next: npm run fork:apply && npm test\n');
  return 0;
}

function parseArgs(argv) {
  const args = { command: argv[0], prefill: null, projectsRoot: path.join(os.homedir(), 'Projects') };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--prefill') args.prefill = argv[++i];
    else if (argv[i] === '--projects-root') args.projectsRoot = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'generate') process.exitCode = generate(args);
  else if (args.command === 'apply') process.exitCode = apply();
  else {
    process.stdout.write('Usage: node fork/bin/pick.js generate [--prefill <json>] [--projects-root <dir>] | apply\n');
    process.exitCode = args.command ? 1 : 0;
  }
} catch (error) {
  process.stderr.write(`[fork:pick] ERROR ${error.message}\n`);
  process.exitCode = 1;
}
