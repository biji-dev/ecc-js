'use strict';

const { run } = require('../lib/git');
const { transformHooks } = require('./hooks');
const { transformManifests } = require('./manifests');
const { transformPackage, transformAgentYaml } = require('./package');
const { renderOverlays, writeInstallConfigs } = require('./overlays');

/**
 * Regenerate every derived file from the current tree, in dependency order.
 * Idempotent: running twice on the same tree produces no diff.
 */
function runTransforms(slim, state, log = () => {}) {
  const report = {};
  report.hooks = transformHooks(slim);
  log(`hooks: kept ${report.hooks.kept.length}, removed ${report.hooks.removed.length}`);
  report.manifests = transformManifests(slim);
  log(`manifests: ${JSON.stringify(report.manifests)}`);
  report.package = transformPackage(slim);
  log(`package: removed files ${report.package.files.length}, bin ${report.package.bin.length}, scripts ${report.package.scripts.length}`);
  report.agentYaml = transformAgentYaml();
  log(`agent.yaml: ${JSON.stringify(report.agentYaml)}`);
  run(process.execPath, ['scripts/ci/catalog.js', '--write', '--text']);
  run(process.execPath, ['scripts/ci/generate-command-registry.js', '--write']);
  log('catalog counts and command registry regenerated');
  report.overlays = renderOverlays(slim, state);
  log(`plugin version ${report.overlays.version}`);
  report.installConfigs = writeInstallConfigs(slim);
  run(process.execPath, ['scripts/ci/check-unicode-safety.js']);
  return report;
}

module.exports = { runTransforms };
