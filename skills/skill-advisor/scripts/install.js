#!/usr/bin/env node
'use strict';

/**
 * skill-advisor installer: applies an approved plan to one project and records it in
 * .claude/skill-advisor.json. Never overwrites files it did not install.
 * Usage: node install.js --project <dir> --plan <file> [--dry-run] [--library <dir>]
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_LIBRARY, hashPath, librarySource, destinations, readState, writeState, itemStatus, pluginVersionOf } = require('./lib/state');

const KINDS = new Set(['skill', 'agent', 'command']);
const LISTS = ['add', 'refresh', 'remove', 'untrack', 'decline'];

function validate(plan) {
  for (const list of LISTS) {
    for (const ref of plan[list] || []) {
      if (!ref || !KINDS.has(ref.kind) || typeof ref.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(ref.name)) {
        throw new Error(`invalid plan entry in ${list}: ${JSON.stringify(ref)}`);
      }
    }
  }
}

const key = ref => `${ref.kind}:${ref.name}`;

function applyPlan({ project, libraryRoot, plan, dryRun = false, today = new Date().toISOString().slice(0, 10) }) {
  try {
    validate(plan);
  } catch (error) {
    throw new Error(`invalid plan: ${error.message}`);
  }
  const current = readState(project);
  const actions = [];
  const warnings = [];
  const tracked = new Map(current.items.map(item => [key(item), item]));
  const version = pluginVersionOf(libraryRoot);

  const copyInto = (source, rels) => {
    for (const rel of rels) {
      const target = path.join(project, rel);
      actions.push(`copy ${path.relative(libraryRoot, source)} -> ${rel}`);
      if (dryRun) continue;
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(source, target, { recursive: true });
    }
  };

  for (const ref of plan.add || []) {
    if (tracked.has(key(ref))) {
      warnings.push(`${key(ref)} is already installed; use refresh`);
      continue;
    }
    const source = librarySource(libraryRoot, ref.kind, ref.name);
    if (!fs.existsSync(source)) {
      warnings.push(`${key(ref)} is not in the library`);
      continue;
    }
    const rels = destinations(ref.kind, ref.name);
    const taken = rels.filter(rel => fs.existsSync(path.join(project, rel)));
    if (taken.length) {
      warnings.push(`${key(ref)} skipped: ${taken.join(', ')} already exists and was not installed by skill-advisor`);
      continue;
    }
    copyInto(source, rels);
    tracked.set(key(ref), { kind: ref.kind, name: ref.name, hash: hashPath(source), paths: rels, pluginVersion: version, installedAt: today });
    current.declined = current.declined.filter(entry => key(entry) !== key(ref));
  }

  for (const ref of plan.refresh || []) {
    const item = tracked.get(key(ref));
    if (!item) {
      warnings.push(`${key(ref)} is not installed; use add`);
      continue;
    }
    const status = itemStatus(project, libraryRoot, item);
    if (status === 'gone') {
      warnings.push(`${key(ref)} is no longer in the library; use remove or untrack`);
      continue;
    }
    if (status === 'modified' && !ref.overwrite) {
      warnings.push(`${key(ref)} was edited by hand; refresh it with "overwrite": true, or untrack it`);
      continue;
    }
    const source = librarySource(libraryRoot, ref.kind, ref.name);
    copyInto(source, item.paths);
    tracked.set(key(ref), { ...item, hash: hashPath(source), pluginVersion: version, installedAt: today });
  }

  for (const ref of plan.remove || []) {
    const item = tracked.get(key(ref));
    if (!item) {
      warnings.push(`${key(ref)} is not installed`);
      continue;
    }
    for (const rel of item.paths) {
      actions.push(`delete ${rel}`);
      if (!dryRun) fs.rmSync(path.join(project, rel), { recursive: true, force: true });
    }
    tracked.delete(key(ref));
  }

  for (const ref of plan.untrack || []) {
    if (!tracked.delete(key(ref))) warnings.push(`${key(ref)} is not installed`);
    else actions.push(`untrack ${key(ref)} (files kept)`);
  }

  for (const ref of plan.decline || []) {
    if (current.declined.some(entry => key(entry) === key(ref))) continue;
    current.declined.push({ kind: ref.kind, name: ref.name, at: today });
    actions.push(`decline ${key(ref)}`);
  }

  if (!dryRun) writeState(project, { version: 1, items: [...tracked.values()], declined: current.declined });
  return { actions, warnings };
}

function parseArgs(argv) {
  const args = { project: process.cwd(), plan: null, library: DEFAULT_LIBRARY, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--project') args.project = argv[++i];
    else if (argv[i] === '--plan') args.plan = argv[++i];
    else if (argv[i] === '--library') args.library = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.plan) throw new Error('--plan <file> is required');
  return args;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const plan = JSON.parse(fs.readFileSync(args.plan, 'utf8'));
    const { actions, warnings } = applyPlan({ project: path.resolve(args.project), libraryRoot: path.resolve(args.library), plan, dryRun: args.dryRun });
    for (const action of actions) process.stdout.write(`${args.dryRun ? '[dry-run] ' : ''}${action}\n`);
    for (const warning of warnings) process.stdout.write(`WARN ${warning}\n`);
    if (!actions.length && !warnings.length) process.stdout.write('nothing to do\n');
  } catch (error) {
    process.stderr.write(`[skill-advisor] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { applyPlan };
