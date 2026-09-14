#!/usr/bin/env node
'use strict';

const { runChecks } = require('./lib/checks');
const { loadSlim, loadState, writeJson, STATE_PATH } = require('./lib/config');
const { renderOverlays, VERSIONED_MANIFESTS } = require('./transforms/overlays');
const { stagePaths } = require('./lib/git');

function bump() {
  const slim = loadSlim();
  const state = loadState();
  state.pluginBuild += 1;
  writeJson(STATE_PATH, state);
  const { version } = renderOverlays(slim, state);
  stagePaths(['fork/state.json', 'README.md', ...VERSIONED_MANIFESTS.map(entry => entry.file)]);
  process.stdout.write(`[fork:verify] plugin version bumped to ${version} (staged)\n`);
  return 0;
}

function main(argv) {
  if (argv.includes('--bump')) return bump();
  const sinceIndex = argv.indexOf('--since');
  const since = sinceIndex >= 0 ? argv[sinceIndex + 1] : process.env.FORK_VERIFY_BASE;
  const { errors, warnings } = runChecks({ drift: argv.includes('--drift'), kimi: !argv.includes('--no-kimi'), since });
  for (const warning of warnings) process.stdout.write(`[fork:verify] WARN ${warning}\n`);
  for (const error of errors) process.stderr.write(`[fork:verify] ERROR ${error}\n`);
  process.stdout.write(`[fork:verify] ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  return errors.length ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[fork:verify] ERROR ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
