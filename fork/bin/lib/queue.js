'use strict';

const { git } = require('./git');
const { ITEM_PATTERNS } = require('./config');
const { showFile } = require('./inventory');

const ITEM_FILE = {
  skills: name => `skills/${name}/SKILL.md`,
  agents: name => `agents/${name}.md`,
  commands: name => `commands/${name}.md`,
  rules: name => `rules/${name}`,
};

function frontmatterDescription(text) {
  if (!text) return '';
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return '';
  const line = match[1].split('\n').find(entry => entry.startsWith('description:'));
  return line ? line.slice('description:'.length).trim().replace(/^["']|["']$/g, '').slice(0, 240) : '';
}

function introducedBy(fromRef, toRef, filePath) {
  const out = git(['log', '--diff-filter=A', '-1', '--format=%h%x09%s', `${fromRef}..${toRef}`, '--', filePath]).trim();
  if (!out) return null;
  const [sha, subject] = out.split('\t');
  return { sha, subject };
}

function suggest(slim, kind, name, description) {
  const hints = slim.queueHints || {};
  const haystack = `${name} ${description}`.toLowerCase();
  let overlapHint = null;
  for (const [plugin, needles] of Object.entries(hints.overlaps || {})) {
    if (needles.some(needle => haystack.includes(needle))) {
      overlapHint = plugin;
      break;
    }
  }
  if (hints.dropRegex && new RegExp(hints.dropRegex, 'i').test(name)) return { suggestion: 'drop:stack', overlapHint };
  if (hints.keepRegex && new RegExp(hints.keepRegex, 'i').test(haystack)) return { suggestion: 'keep:stack', overlapHint };
  return { suggestion: 'review', overlapHint };
}

/**
 * Append NEW upstream items to the review queue as pending. Pending items are
 * treated as dropped until a decision is recorded in fork/slim.json.
 */
function queueNewItems({ slim, queue, added, fromRef, toRef }) {
  const queued = [];
  for (const kind of Object.keys(ITEM_PATTERNS)) {
    for (const name of added[kind] || []) {
      if (queue.entries.some(entry => entry.kind === kind && entry.name === name)) continue;
      const file = ITEM_FILE[kind](name);
      const description = kind === 'rules' ? '' : frontmatterDescription(showFile(toRef, file));
      const entry = {
        kind,
        name,
        file,
        status: 'pending',
        firstSeenRef: toRef,
        introducedBy: introducedBy(fromRef, toRef, file),
        description,
        ...suggest(slim, kind, name, description),
      };
      queue.entries.push(entry);
      queued.push(entry);
    }
  }
  return queued;
}

/** Remove queue entries whose names now appear in slim keep/own/drop lists. */
function pruneDecided(slim, queue) {
  const before = queue.entries.length;
  queue.entries = queue.entries.filter(entry => {
    const section = slim[entry.kind] || {};
    const decided = (section.keep || []).includes(entry.name)
      || (section.own || []).includes(entry.name)
      || entry.name in (section.drop || {});
    return !decided;
  });
  return before - queue.entries.length;
}

module.exports = { queueNewItems, pruneDecided, frontmatterDescription, ITEM_FILE };
