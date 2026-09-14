'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, run, git, gitLines, revParse, isAncestor, listFiles, removePaths, checkoutPaths, stagePaths, mergeHead } = require('./git');
const { ITEM_PATTERNS, FORK_OWNED, STATE_PATH, QUEUE_PATH, writeJson, buildDropMatcher } = require('./config');
const { createMatcher } = require('./glob');
const { inventoryAt, diffInventory, addedBetween, successorHints, showFile } = require('./inventory');
const { queueNewItems, pruneDecided } = require('./queue');
const { applyDecisions } = require('./apply');
const { writeReport } = require('./report');

const PROGRESS_PATH = path.join(REPO_ROOT, 'fork', '.sync-in-progress.json');

function semverKey(tag) {
  return tag
    .replace(/^v/, '')
    .split('.')
    .map(part => part.padStart(6, '0'))
    .join('.');
}

function latestReleaseTag(slim) {
  const namespace = slim.upstream.tagNamespace || 'upstream/';
  const pattern = new RegExp(slim.upstream.tagPattern || '^v\\d+\\.\\d+\\.\\d+$');
  const tags = gitLines(['tag', '-l', `${namespace}*`])
    .map(tag => tag.slice(namespace.length))
    .filter(tag => pattern.test(tag))
    .sort((a, b) => semverKey(a).localeCompare(semverKey(b)));
  if (tags.length === 0) throw new Error(`No upstream release tags under ${namespace}`);
  return { tag: tags[tags.length - 1], ref: `${namespace}${tags[tags.length - 1]}` };
}

function resolveTarget(args, slim) {
  run('git', ['fetch', slim.upstream.remote, '--prune']);
  if (!args.ref) return latestReleaseTag(slim);
  const namespace = slim.upstream.tagNamespace || 'upstream/';
  const tagged = gitLines(['tag', '-l', `${namespace}${args.ref}`]);
  return tagged.length ? { tag: args.ref, ref: tagged[0] } : { tag: null, ref: args.ref };
}

/** State after syncing to target: commit sha, tag, upstream version and next plugin build. */
function nextState(state, target) {
  const pkg = showFile(target.ref, 'package.json');
  const version = (pkg && JSON.parse(pkg).version) || state.upstreamVersion;
  return {
    ...state,
    lastUpstreamRef: revParse(target.ref),
    lastUpstreamTag: target.tag || state.lastUpstreamTag,
    pluginBuild: version === state.upstreamVersion ? state.pluginBuild + 1 : 1,
    upstreamVersion: version,
    syncedAt: new Date().toISOString()
  };
}

/** Forecast and inventory: what a sync to this ref would do, without touching the tree. */
function analyze({ slim, state, queue, target }) {
  const fromRef = state.lastUpstreamRef;
  const inventory = inventoryAt(target.ref);
  const head = inventoryAt('HEAD');
  const headSubHooks = new Set(head.subHookIds);
  const headLibDirs = new Set(head.libDirs);
  const { added, gone } = diffInventory(slim, queue, inventory);
  const hints = {};
  for (const kind of Object.keys(ITEM_PATTERNS)) {
    for (const item of gone[kind]) {
      const key = `${kind}:${item.name}`;
      hints[key] = successorHints(
        fromRef,
        target.ref,
        ITEM_PATTERNS[kind](item.name).map(p => p.replace('/**', ''))
      );
      // Same-name conversions across kinds (e.g. a command turned into a skill).
      for (const other of ['skills', 'agents', 'commands']) {
        if (other !== kind && inventory[other].includes(item.name)) {
          const queued = (added[other] || []).includes(item.name) ? ' (queued for review)' : '';
          hints[key].push(`successor (same name): ${other}:${item.name}${queued}`);
        }
      }
    }
  }
  // Compare bins with the last synced upstream package.json: the fork prunes bins, so HEAD would re-report them every sync.
  const fromPkg = showFile(fromRef, 'package.json');
  const fromBins = new Set(Object.keys((fromPkg && JSON.parse(fromPkg).bin) || {}));
  const upstreamChanged = git(['diff', '--name-only', fromRef, target.ref]).split('\n').filter(Boolean);
  const forkChanged = new Set(git(['diff', '--name-only', fromRef, 'HEAD']).split('\n').filter(Boolean));
  const isDropped = buildDropMatcher(slim, queue);
  const isDerived = createMatcher(slim.derived || []);
  const isForkOwned = createMatcher(FORK_OWNED);
  const manualCandidates = upstreamChanged.filter(f => forkChanged.has(f) && !isDropped(f) && !isDerived(f) && !isForkOwned(f));
  const fromTopLevel = new Set(listFiles(fromRef).map(f => f.split('/')[0]));
  const targetFiles = listFiles(target.ref);
  const newTopLevel = inventory.topLevel.filter(top => !fromTopLevel.has(top) && !targetFiles.filter(f => f.split('/')[0] === top).every(isDropped));
  return {
    fromRef,
    target,
    added,
    gone,
    successorHints: hints,
    newScripts: addedBetween(fromRef, target.ref, ['scripts/']).filter(file => /^scripts\/[^/]+\.(?:js|mjs|cjs|sh)$/.test(file)),
    newLibDirs: inventory.libDirs.filter(dir => !headLibDirs.has(dir)),
    newSubHooks: inventory.subHookIds.filter(id => !headSubHooks.has(id)),
    newTopLevel,
    newBins: inventory.bins.filter(bin => !fromBins.has(bin)),
    diverged: !isAncestor(fromRef, target.ref),
    counts: {
      upstreamChanged: upstreamChanged.length,
      autoDropped: upstreamChanged.filter(isDropped).length,
      derived: upstreamChanged.filter(isDerived).length,
      manualCandidates: manualCandidates.length
    },
    manualCandidates
  };
}

function blockingGone(analysis) {
  return Object.entries(analysis.gone).flatMap(([kind, items]) => items.map(item => ({ kind, ...item })));
}

function finish({ slim, state, queue, target, analysis, log }) {
  const next = nextState(state, target);
  applyDecisions({ ref: target.ref, slim, state: next, queue, log });
  writeJson(STATE_PATH, next);
  writeJson(QUEUE_PATH, queue);
  stagePaths(['fork/state.json', 'fork/review-queue.json']);
  fs.rmSync(PROGRESS_PATH, { force: true });
  writeReport({ analysis, state: next, queue, mode: 'merge' });
  log(`merged ${target.tag || target.ref}; plugin version ${next.upstreamVersion}-js.${next.pluginBuild} (outputs staged)`);
  log('next: npm test && node fork/bin/verify.js --drift, git commit (merge commit), push the sync branch and wait for fork-ci,');
  log('      then: git switch main && git merge --no-ff <sync branch> && git push origin main');
  return 0;
}

function continueMerge({ slim, state, queue, log }) {
  if (!fs.existsSync(PROGRESS_PATH)) throw new Error('No sync in progress');
  const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  const targetSha = revParse(progress.target.ref);
  const inProgress = mergeHead();
  if (inProgress !== targetSha && !isAncestor(targetSha, 'HEAD')) {
    throw new Error(`No merge of ${progress.target.tag || progress.target.ref} in progress; rerun node fork/bin/sync.js`);
  }
  const unmerged = gitLines(['diff', '--name-only', '--diff-filter=U']);
  if (unmerged.length) throw new Error(`Unresolved paths remain: ${unmerged.join(', ')}`);
  const analysis = analyze({ slim, state, queue, target: progress.target });
  return finish({ slim, state, queue, target: progress.target, analysis, log });
}

function runMerge({ args, slim, state, queue, log }) {
  const pruned = pruneDecided(slim, queue);
  if (pruned) log(`removed ${pruned} decided entries from the review queue`);
  if (args.mode === 'continue') return continueMerge({ slim, state, queue, log });

  const target = resolveTarget(args, slim);
  if (isAncestor(target.ref, 'HEAD')) {
    log(`${target.tag || target.ref} is already merged; nothing to do`);
    return 0;
  }
  const analysis = analyze({ slim, state, queue, target });
  const blocked = blockingGone(analysis);

  if (args.mode === 'plan' || blocked.length || analysis.diverged) {
    const forecastQueue = JSON.parse(JSON.stringify(queue));
    queueNewItems({ slim, queue: forecastQueue, added: analysis.added, fromRef: analysis.fromRef, toRef: target.ref });
    writeReport({ analysis, state: nextState(state, target), queue: forecastQueue, mode: 'plan' });
    if (args.mode === 'plan') {
      log(`plan written to fork/.sync-report.md (new items: ${Object.values(analysis.added).flat().length}, gone: ${blocked.length}${analysis.diverged ? ', upstream history diverged' : ''})`);
      return blocked.length || analysis.diverged ? 3 : 0;
    }
    if (analysis.diverged) log(`BLOCKED: lastUpstreamRef ${state.lastUpstreamRef} is not an ancestor of ${target.ref}; upstream history diverged`);
    if (blocked.length) log(`BLOCKED: kept items are gone upstream: ${blocked.map(i => `${i.kind}:${i.name}`).join(', ')}`);
    log('see fork/.sync-report.md; resolve in fork/slim.json (FORK.md "Resolving a blocked sync") and rerun');
    return 3;
  }
  run('git', ['fetch', 'origin', '--prune'], { allowFailure: true });
  if (run('git', ['rev-parse', '-q', '--verify', 'refs/remotes/origin/main'], { allowFailure: true }).status === 0 && !isAncestor('origin/main', 'HEAD')) {
    throw new Error('HEAD does not contain origin/main; run git switch main && git pull --ff-only first');
  }
  if (mergeHead()) throw new Error('A merge is already in progress; conclude or abort it first');
  if (gitLines(['status', '--porcelain', '--untracked-files=no']).length) throw new Error('Working tree has uncommitted changes');

  queueNewItems({ slim, queue, added: analysis.added, fromRef: analysis.fromRef, toRef: target.ref });
  const merge = run('git', ['merge', '--no-ff', '--no-commit', target.ref], { allowFailure: true });
  const conflicted = gitLines(['diff', '--name-only', '--diff-filter=U']);
  if (merge.status !== 0 && !conflicted.length && !mergeHead()) {
    throw new Error(`git merge failed: ${(merge.stderr || merge.stdout).trim()}`);
  }

  const isDropped = buildDropMatcher(slim, queue);
  const isDerived = createMatcher(slim.derived || []);
  const isForkOwned = createMatcher(FORK_OWNED);
  const targetFiles = new Set(listFiles(target.ref));
  removePaths(conflicted.filter(isDropped));
  checkoutPaths(
    target.ref,
    conflicted.filter(f => isDerived(f) && targetFiles.has(f))
  );
  checkoutPaths('HEAD', listFiles('HEAD').filter(isForkOwned));

  // Persist progress and the queue before anything that can fail, so --continue can always resume.
  writeJson(PROGRESS_PATH, { target, startedAt: new Date().toISOString() });
  writeJson(QUEUE_PATH, queue);

  const manual = gitLines(['diff', '--name-only', '--diff-filter=U']);
  if (manual.length) {
    log(`MANUAL conflicts (${manual.length}); resolve, git add, then run: node fork/bin/sync.js --continue`);
    manual.forEach(file => log(`  ${file}`));
    return 2;
  }
  return finish({ slim, state, queue, target, analysis, log });
}

module.exports = { runMerge, latestReleaseTag, analyze, nextState };
