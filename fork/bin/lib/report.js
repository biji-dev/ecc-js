'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, git } = require('./git');

const ITEM_FILE = {
  skills: name => `skills/${name}/SKILL.md`,
  agents: name => `agents/${name}.md`,
  commands: name => `commands/${name}.md`,
  rules: name => `rules/${name}`,
};

function sourceLink(entry) {
  const ref = String(entry.firstSeenRef || 'main').replace(/^upstream\//, '');
  const file = entry.file || (ITEM_FILE[entry.kind] ? ITEM_FILE[entry.kind](entry.name) : entry.name);
  return `${UPSTREAM_BLOB}/${ref}/${file}`;
}

const REPORT_PATH = path.join(REPO_ROOT, 'fork', '.sync-report.md');
const UPSTREAM_BLOB = 'https://github.com/affaan-m/ECC/blob';

function list(items, format = item => `- ${item}`) {
  return items.length ? items.map(format).join('\n') : '- none';
}

/** Security-relevant upstream diffs to kept content: agent tools/model, hook commands, child_process/network use. */
function securityDiffs(fromRef, toRef) {
  const lines = [];
  const agentDiff = git(['diff', '-U0', fromRef, toRef, '--', 'agents/*.md']);
  const toolLines = agentDiff.split('\n').filter(line => /^[+-](tools|model):/.test(line));
  if (toolLines.length) lines.push('Agent tools/model frontmatter changes:', '```', ...toolLines, '```');
  const hookDiff = git(['diff', '--stat', fromRef, toRef, '--', 'hooks/hooks.json', 'hooks/codex-hooks.json']).trim();
  if (hookDiff) lines.push('Hook config changed upstream:', '```', hookDiff, '```');
  const scriptDiff = git(['diff', '-U0', fromRef, toRef, '--', 'scripts/hooks', 'scripts/lib']);
  const risky = scriptDiff.split('\n').filter(line => /^\+.*(child_process|spawn\(|exec\(|execSync|https?\.request|fetch\(|net\.connect)/.test(line));
  if (risky.length) lines.push(`New process/network calls in scripts/hooks or scripts/lib (${risky.length}):`, '```', ...risky.slice(0, 40), '```');
  return lines.length ? lines.join('\n') : '- none detected';
}

function writeReport({ analysis, state, queue, mode }) {
  const { target, counts, added, gone, successorHints } = analysis;
  const pending = queue.entries.filter(entry => entry.status === 'pending');
  const bySuggestion = {};
  for (const entry of pending) (bySuggestion[entry.suggestion] = bySuggestion[entry.suggestion] || []).push(entry);

  const goneItems = Object.entries(gone).flatMap(([kind, items]) => items.map(item => ({ kind, ...item })));
  const body = [
    `# Upstream sync ${mode === 'plan' ? 'forecast' : 'report'}: ${target.tag || target.ref}`,
    '',
    `From \`${analysis.fromRef.slice(0, 12)}\` to \`${target.ref}\` — plugin version after sync: \`${state.upstreamVersion}-js.${state.pluginBuild}\`.`,
    '',
    '## Changed paths',
    `- upstream changed: ${counts.upstreamChanged}`,
    `- auto-resolved as dropped: ${counts.autoDropped}`,
    `- derived (regenerated): ${counts.derived}`,
    `- possible MANUAL (kept files changed on both sides): ${counts.manualCandidates}`,
    list(analysis.manualCandidates.slice(0, 50), file => `  - \`${file}\``),
    '',
    '## Review queue (new upstream items, not shipped until decided in fork/slim.json)',
    ...Object.entries(bySuggestion).flatMap(([suggestion, entries]) => [
      `### ${suggestion} (${entries.length})`,
      ...entries.map(entry => `- [ ] **${entry.kind}:${entry.name}**${entry.overlapHint ? ` _(overlaps ${entry.overlapHint})_` : ''} — ${entry.description || 'no description'} ${entry.introducedBy ? `(${entry.introducedBy.sha} ${entry.introducedBy.subject})` : ''} [source](${sourceLink(entry)})`),
    ]),
    pending.length ? '' : '- queue is empty',
    '',
    '## New hook ids upstream (removed until listed in slim.hooks.keep or slim.hooks.drop)',
    list(added.hooks || []),
    '',
    '## New top-level upstream paths (shipped unless added to slim.paths.drop)',
    list(analysis.newTopLevel || [], top => `- \`${top}\``),
    '',
    '## Kept items gone upstream (sync blocks until resolved)',
    list(goneItems, item => `- ${item.kind}:${item.name}${item.pinned ? ' (pinned)' : ''}\n${list(successorHints[`${item.kind}:${item.name}`] || [], hint => `  - ${hint}`)}`),
    '',
    '## New scripts, lib dirs and dispatcher sub-hooks (kept; sub-hooks stay off unless allowlisted)',
    list(analysis.newScripts, file => `- script \`${file}\``),
    list(analysis.newLibDirs, dir => `- lib dir \`${dir}\``),
    list(analysis.newSubHooks, id => `- sub-hook \`${id}\``),
    '',
    '## Security-relevant upstream diffs to kept content',
    securityDiffs(analysis.fromRef, target.ref),
    '',
  ].join('\n');
  fs.writeFileSync(REPORT_PATH, body);
  return REPORT_PATH;
}

module.exports = { writeReport, REPORT_PATH };
