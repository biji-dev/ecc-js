'use strict';

/**
 * The tier pick: a markdown checklist of every skill, agent, command and hook that the
 * maintainer tags, then turns into fork/slim.json tiers and the hook allowlist.
 */

const PICK_KINDS = ['skills', 'agents', 'commands'];
const ITEM_TAGS = new Set(['core', 'library', 'drop']);
const HOOK_TAGS = new Set(['keep', 'drop']);

function renderPick({ items, hooks }) {
  const lines = [
    '# ECC-JS tier pick',
    '',
    'Change the tag of any line: `core` (always loaded), `library` (installable per project',
    'with skill-advisor) or `drop` (removed). Hooks take `keep` or `drop`.',
    'Then run `node fork/bin/pick.js apply`. Own items (skill-advisor) are not listed.',
    ''
  ];
  for (const kind of PICK_KINDS) {
    lines.push(`## ${kind}`, '');
    for (const item of items.filter(entry => entry.kind === kind)) {
      lines.push(`- [${item.tag}] ${item.name} — ${item.description || 'no description'}${item.signals ? ` (${item.signals})` : ''}`);
    }
    lines.push('');
  }
  lines.push('## hooks', '');
  for (const hook of hooks) lines.push(`- [${hook.tag}] ${hook.id}`);
  lines.push('');
  return lines.join('\n');
}

/** Per kind: current keep/library items first, then items dropped earlier (with that reason as a signal). */
function orderItems(items, slim) {
  const ordered = [];
  for (const kind of PICK_KINDS) {
    const drop = (slim[kind] && slim[kind].drop) || {};
    const ofKind = items.filter(item => item.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
    ordered.push(...ofKind.filter(item => !(item.name in drop)));
    for (const item of ofKind.filter(entry => entry.name in drop)) {
      ordered.push({ ...item, signals: [`dropped earlier: ${drop[item.name]}`, item.signals].filter(Boolean).join('; ') });
    }
  }
  return ordered;
}

function parsePick(text) {
  const picked = { skills: {}, agents: {}, commands: {}, hooks: {} };
  let section = null;
  text.split('\n').forEach((line, index) => {
    const heading = line.match(/^## (skills|agents|commands|hooks)\s*$/);
    if (heading) {
      section = heading[1];
      return;
    }
    const entry = line.match(/^- \[([a-z]+)\] ([a-z0-9:.-]+)/);
    if (!entry || !section) return;
    const allowed = section === 'hooks' ? HOOK_TAGS : ITEM_TAGS;
    if (!allowed.has(entry[1])) throw new Error(`line ${index + 1}: unknown tag "${entry[1]}" (use ${[...allowed].join(', ')})`);
    picked[section][entry[2]] = entry[1];
  });
  return picked;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Names each source text references. Distinctive names (hyphenated or 6+ chars) match as whole
 * words; short names only in path, ecc: or slash-command form, to avoid common words.
 */
function findReferences(texts, names) {
  const result = {};
  for (const [source, text] of Object.entries(texts)) {
    const own = source.split(':')[1];
    const hits = names.filter(name => {
      if (name === own) return false;
      const n = escapeRegex(name);
      const pattern = name.includes('-') || name.length >= 6
        ? new RegExp(`(?<![\\w-])${n}(?![\\w-])`)
        : new RegExp(`(?:skills/|agents/|commands/|ecc:|(?<![\\w/.-])/)${n}(?![\\w-])`);
      return pattern.test(text);
    });
    if (hits.length) result[source] = hits;
  }
  return result;
}

function tagOf(picked, name) {
  for (const kind of PICK_KINDS) if (picked[kind][name]) return picked[kind][name];
  return null;
}

function validatePick({ picked, slim, externalRefs, references }) {
  const errors = [];
  const warnings = [];
  for (const kind of PICK_KINDS) {
    for (const name of (slim[kind] && slim[kind].pinned) || []) {
      if (picked[kind][name] !== 'core') errors.push(`${kind}:${name} is pinned; tag it core`);
    }
  }
  for (const kind of PICK_KINDS) {
    for (const [name, tag] of Object.entries(picked[kind])) {
      if (tag !== 'core' && externalRefs[name]) errors.push(`${kind}:${name} is used as ecc:${name} by ${externalRefs[name].join(', ')}; tag it core`);
    }
  }
  for (const [source, names] of Object.entries(references)) {
    const [kind, name] = source.split(':');
    if (picked[kind][name] !== 'core') continue;
    for (const target of names) {
      const tag = tagOf(picked, target);
      if (tag === 'drop') errors.push(`${source} (core) references ${target}, which is tagged drop`);
      if (tag === 'library') warnings.push(`${source} (core) references ${target}, which is tagged library`);
    }
  }
  return { errors, warnings };
}

/** Top-level hooks.json entry that must be kept for an allowlisted runtime or sub-hook id to run. */
function allowOwner(id, subHooks) {
  if (subHooks.preBash.includes(id)) return 'pre:bash:dispatcher';
  if (subHooks.sync.includes(id)) return 'post:dispatcher:sync';
  if (subHooks.async.includes(id) || subHooks.postBash.includes(id) || id === 'post:bash:dispatcher') return 'post:dispatcher:async';
  if (id === 'pre:observe') return 'pre:observe:continuous-learning';
  return id;
}

function applyPick({ slim, picked, allow, subHooks, today }) {
  const next = JSON.parse(JSON.stringify(slim));
  const reason = `pick ${today}`;
  const untagged = [];
  for (const kind of PICK_KINDS) {
    const section = next[kind];
    const own = new Set(section.own || []);
    const all = [...new Set([...(section.keep || []), ...(section.library || []), ...Object.keys(section.drop || {})])].filter(name => !own.has(name));
    untagged.push(...all.filter(name => !picked[kind][name]).map(name => `${kind}:${name}`));
    const tags = picked[kind];
    const oldDrop = section.drop || {};
    section.keep = Object.keys(tags).filter(name => tags[name] === 'core').sort();
    section.library = Object.keys(tags).filter(name => tags[name] === 'library').sort();
    section.drop = Object.fromEntries(Object.keys(tags).filter(name => tags[name] === 'drop').sort().map(name => [name, oldDrop[name] || reason]));
  }
  const hookIds = [...new Set([...(next.hooks.keep || []), ...Object.keys(next.hooks.drop || {})])];
  untagged.push(...hookIds.filter(id => !picked.hooks[id]).map(id => `hooks:${id}`));
  if (untagged.length) throw new Error(`not tagged in the pick: ${untagged.join(', ')}`);
  const oldHookDrop = next.hooks.drop || {};
  next.hooks.keep = hookIds.filter(id => picked.hooks[id] === 'keep');
  next.hooks.drop = {};
  for (const id of Object.keys(oldHookDrop)) if (picked.hooks[id] === 'drop') next.hooks.drop[id] = oldHookDrop[id];
  for (const id of hookIds) if (picked.hooks[id] === 'drop' && !(id in next.hooks.drop)) next.hooks.drop[id] = reason;
  const kept = new Set(next.hooks.keep);
  return { slim: next, allow: allow.filter(id => kept.has(allowOwner(id, subHooks))) };
}

module.exports = { PICK_KINDS, orderItems, renderPick, parsePick, validatePick, applyPick, allowOwner, findReferences };
