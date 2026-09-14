#!/usr/bin/env node
'use strict';

const { loadSlim, loadState, loadQueue, writeJson, STATE_PATH, QUEUE_PATH } = require('./lib/config');
const { applyDecisions } = require('./lib/apply');
const { pruneDecided } = require('./lib/queue');
const { stagePaths } = require('./lib/git');

function parseArgs(argv) {
  const args = { mode: 'merge', ref: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--decisions-only') args.mode = 'decisions';
    else if (arg === '--plan') args.mode = 'plan';
    else if (arg === '--continue') args.mode = 'continue';
    else if (arg === '--ref') args.ref = argv[++i];
    else if (arg === '--help' || arg === '-h') args.mode = 'help';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function log(message) {
  process.stdout.write(`[fork:sync] ${message}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'help') {
    process.stdout.write('Usage: node fork/bin/sync.js [--decisions-only|--plan|--continue] [--ref <tag|sha>]\n');
    return 0;
  }
  const slim = loadSlim();
  const state = loadState();
  const queue = loadQueue();

  if (args.mode === 'decisions') {
    const ref = args.ref || state.lastUpstreamRef;
    if (!ref) throw new Error('No --ref given and fork/state.json has no lastUpstreamRef');
    const pruned = pruneDecided(slim, queue);
    if (pruned) log(`removed ${pruned} decided entries from the review queue`);
    const report = applyDecisions({ ref, slim, state, queue, log });
    state.counts = {
      skills: slim.skills.keep.length + slim.skills.own.length,
      agents: slim.agents.keep.length + slim.agents.own.length,
      commands: slim.commands.keep.length + slim.commands.own.length,
      rules: slim.rules.keep.length + slim.rules.own.length,
    };
    writeJson(STATE_PATH, state);
    writeJson(QUEUE_PATH, queue);
    stagePaths(['fork/state.json', 'fork/review-queue.json']);
    log(`done: removed ${report.removed}, restored ${report.restored}; version ${report.transforms.overlays.version}`);
    log('outputs are staged; run npm run fork:bump if shipped content changed, then npm test and commit');
    return 0;
  }

  // Merge, plan and continue modes are implemented in lib/merge.js.
  const { runMerge } = require('./lib/merge');
  return runMerge({ args, slim, state, queue, log });
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`[fork:sync] ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
