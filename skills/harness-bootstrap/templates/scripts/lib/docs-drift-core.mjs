// harness-bootstrap docs-drift core (generated YYYY-MM-DD). Pure core of scripts/docs-drift.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the doc tree and the
// identifier filters, re-derived per project (which folders hold documents, which names are too
// generic to search for).
/**
 * Lists the documents that mention something a diff changed: a changed code path, an exported
 * name the diff removed or modified, and (with `basenames`) a changed file's bare name. A changed
 * document is not a token unless it was deleted (a mention of a path that no longer exists is a
 * broken link); a brand-new export cannot make an existing document stale. No I/O here, so
 * `docs-drift-core.test.mjs` can pin each rule.
 *
 * WHY. A runner's doc sweep (step 8a) asks "which documents went stale?". Opus cross-check lanes
 * spent $181 in 14 days mostly finding P3 docs drift -- mechanical work. This lists the
 * candidates deterministically; a cheap model rewrites only the stale sections it lists.
 */

// ---- [B] project bindings — the project's doc tree
// Which files count as documents (globs relative to the repo top; see globToRegExp).
export const DOC_GLOBS = [
  '*.md',
  'docs/**/*.md',
  'harness/**/*.md',
  '.claude/rules/**/*.md',
  '.claude/skills/**/*.md',
  '.agents/skills/**/*.md',
  '.claude/agents/**/*.md',
];
// Historical documents: they record what was true when written, so a mention there is not drift.
export const HISTORICAL_GLOBS = [
  'docs/plans/**',
  'docs/archive/**',
  'docs/**/archive/**',
  'docs/change-requests/**',
  'docs/changes/**',
  '**/follow-ups*.md',
  '**/followups*.md',
  '**/decision-log.md',
  '**/log.md',
  '**/*-log.md',
  'CHANGELOG.md',
  'harness/units/**',
];
// Directories the document walk never enters (a name matches at any depth; a path from the top too).
export const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.worktrees',
  '.claude/worktrees',
  '.review-work',
  '.codex-runs',
];
export const MIN_IDENT = 4; // shorter identifiers are too generic to search
// Files every project changes all the time: their paths and names are never tokens.
export const IGNORE_TOKENS = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock', // bun 1.2 and later
  'tsconfig.json',
];
// File stems and exported names so common that a mention proves nothing.
export const GENERIC = ['index', 'main', 'utils', 'types', 'config', 'default', 'test', 'README', 'decide'];
// ---- end [B]

/** Exit codes the caller branches on. */
export const EXIT = { ok: 0, strict: 1, usage: 2 };

/** Candidate lines printed before the `… and <k> more` line (`--max` overrides). */
export const DEFAULT_MAX = 200;

/** Documents larger than this are skipped and reported, never read. */
/** A file the walk reads as a living document: in DOC_GLOBS and not historical. */
export function isLivingDoc(rel, globs = DOC_GLOBS, historical = HISTORICAL_GLOBS) {
  return matchesAny(rel, globs) && !matchesAny(rel, historical);
}

export const MAX_DOC_BYTES = 2 * 1024 * 1024;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Glob -> anchored RegExp. `**` crosses directories (`a/**` + `/b` also matches `a/b`, zero
 * dirs), `*` and `?` never cross `/`. Everything else is literal.
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(filePath, globs) {
  return globs.some((g) => globToRegExp(g).test(filePath));
}

/** Whether the document walk must not enter this directory (`rel` is relative to the repo top). */
export function isExcludedDir(rel, excludes = EXCLUDE_DIRS) {
  return excludes.some((e) => rel === e || rel.endsWith(`/${e}`));
}

const DECL =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|type|interface|enum)\s+(?!extends\b|implements\b)([A-Za-z_$][\w$]*)/;
const NAMED = /^export\s*(?:type\s*)?\{([^}]*)\}/;

const LIST_OPEN = /^export\s*(?:type\s*)?\{([^}]*)$/; // `export {` whose list continues on later lines

/** The exported names in part of an export list: `a, type b, c as d` → [a, b, d]. */
function namesOfList(list) {
  return list
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, ''))
    .filter(Boolean)
    .map((part) => {
      const m = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(part);
      return m ? m[1] : part;
    })
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/** The names one source line exports (declaration form or `export { a, b as c }`). */
function exportsOfLine(line) {
  const text = line.trim();
  const decl = DECL.exec(text);
  if (decl) return [decl[1]];
  const named = NAMED.exec(text);
  return named ? namesOfList(named[1]) : [];
}

/**
 * Every export the diff touches, in order: `{ side: 'added'|'removed', name, path }`, where
 * `path` is the file whose hunk declared it (tracked from the `diff --git` / `+++ b/` headers).
 */
function scanExports(diffText) {
  const found = [];
  let current = null;
  // Inside a multi-line `export {` list: a name on its own line is an export too. Context lines
  // keep the state; a hunk that starts inside a list it cannot see does not know it (a known gap).
  let inList = false;
  for (const line of diffText.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      current = header[2];
      inList = false;
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (line.startsWith('+++ b/')) current = line.slice(6);
      continue;
    }
    if (line.startsWith('--- ')) continue;
    if (line.startsWith('@@')) {
      inList = false;
      continue;
    }
    const side = line[0] === '+' ? 'added' : line[0] === '-' ? 'removed' : null;
    const text = line.slice(1).trim();
    let names;
    if (inList) {
      const end = text.indexOf('}');
      names = namesOfList(end === -1 ? text : text.slice(0, end));
      if (end !== -1) inList = false;
    } else {
      const open = LIST_OPEN.exec(text);
      if (open) {
        inList = true;
        names = namesOfList(open[1]);
      } else names = exportsOfLine(text);
    }
    if (!side) continue;
    for (const name of names) found.push({ side, name, path: current });
  }
  return found;
}

/** Exported names the diff added and removed, deduped and sorted. */
export function exportedNames(diffText) {
  const sets = { added: new Set(), removed: new Set() };
  for (const { side, name } of scanExports(diffText)) sets[side].add(name);
  return { added: [...sets.added].sort(), removed: [...sets.removed].sort() };
}

/** Whether a path is a document (and so not a token when it was merely edited). */
export function isDoc(filePath) {
  return filePath.endsWith('.md') || matchesAny(filePath, DOC_GLOBS);
}

/** Paths with status `D` in `git diff --name-status --no-renames -z` output (`S\0path\0` pairs). */
export function deletedFromNameStatus(z) {
  const parts = z.split('\0');
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i] === 'D') out.push(parts[i + 1]);
  return out;
}

const stemOf = (base) => (base.lastIndexOf('.') > 0 ? base.slice(0, base.lastIndexOf('.')) : base);

/**
 * What to search the docs for: each changed path, except an edited document (a deleted or
 * renamed-away one stays: `deletedPaths`) and anything in IGNORE_TOKENS; with `basenames`, also
 * its bare file name unless the stem is generic; each export the diff REMOVED or modified
 * (a name on a removed line) of length >= MIN_IDENT that is not generic. Deduped by token; the
 * first reason wins.
 */
export function tokensFor({ changedPaths, diffText, deletedPaths = [], basenames = false }) {
  const tokens = new Map();
  const add = (token, kind, from) => {
    if (!IGNORE_TOKENS.includes(token) && !tokens.has(token)) tokens.set(token, { token, kind, from });
  };
  const deleted = new Set(deletedPaths);
  for (const p of changedPaths) {
    if (isDoc(p) && !deleted.has(p)) continue;
    add(p, 'path', p);
    const base = p.split('/').pop();
    if (basenames && !GENERIC.includes(stemOf(base))) add(base, 'file', p);
  }
  for (const { side, name, path: from } of scanExports(diffText)) {
    if (side === 'removed' && name.length >= MIN_IDENT && !GENERIC.includes(name))
      add(name, 'ident', from);
  }
  return [...tokens.values()];
}

/**
 * Where the docs mention a token. Path and file tokens match as substrings, identifiers on word
 * boundaries (`getUser` is not `getUsers`). A document edited in this diff is skipped unless
 * `includeChanged`. One result per (doc, line, token); sorted by doc, then line.
 */
export function findMentions({ docs, tokens, changedPaths, includeChanged = false }) {
  const changed = new Set(changedPaths);
  const matchers = tokens.map((t) => {
    if (t.kind !== 'ident') return { ...t, test: (line) => line.includes(t.token) };
    const word = new RegExp(`(?<![\\w$])${escapeRe(t.token)}(?![\\w$])`);
    return { ...t, test: (line) => word.test(line) };
  });
  const out = [];
  for (const doc of docs) {
    if (!includeChanged && changed.has(doc.path)) continue;
    const lines = doc.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++)
      for (const m of matchers)
        if (m.test(lines[i]))
          out.push({ doc: doc.path, line: i + 1, token: m.token, from: m.from, kind: m.kind });
  }
  return out.sort((a, b) => (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : a.line - b.line));
}

/**
 * Up to `max` candidate lines, `… and <k> more (--json for all)` for the rest, the skipped
 * documents, then the summary line (which counts every candidate).
 */
export function formatReport(mentions, skipped = [], max = DEFAULT_MAX) {
  const lines = mentions
    .slice(0, max)
    .map((m) => `${m.doc}:${m.line} — mentions ${m.token} (changed in ${m.from})`);
  if (mentions.length > max) lines.push(`… and ${mentions.length - max} more (--json for all)`);
  for (const s of skipped) lines.push(`skipped: ${s.path} (${s.reason})`);
  const docCount = new Set(mentions.map((m) => m.doc)).size;
  lines.push(
    mentions.length === 0
      ? 'docs-drift: 0 candidates'
      : `docs-drift: ${mentions.length} candidates in ${docCount} docs`,
  );
  return lines.join('\n');
}

/** A diff block for an untracked text file: every line added, so its exports count. */
export function untrackedDiff(filePath, text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return `diff --git a/${filePath} b/${filePath}\n+++ b/${filePath}\n${lines.map((l) => `+${l}`).join('\n')}`;
}

/** Parse the wrapper's argv; a bad one throws (the wrapper prints usage and exits 2). */
export function parseArgs(argv) {
  const a = {
    since: null,
    includeChanged: false,
    strict: false,
    json: false,
    basenames: false,
    max: DEFAULT_MAX,
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--since') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) throw new Error('--since needs a value');
      a.since = v;
    } else if (t === '--max') {
      const v = argv[++i];
      if (v === undefined || !/^\d+$/.test(v)) throw new Error('--max needs a non-negative integer');
      a.max = Number(v);
    } else if (t === '--basenames') a.basenames = true;
    else if (t === '--include-changed') a.includeChanged = true;
    else if (t === '--strict') a.strict = true;
    else if (t === '--json') a.json = true;
    else throw new Error(`unknown option ${t}`);
  }
  if (!a.since) throw new Error('--since <base> is required');
  return a;
}
