#!/usr/bin/env node
// harness-bootstrap edit-guard hook (generated YYYY-MM-DD). Claude Code PreToolUse
// (Edit|Write|MultiEdit|NotebookEdit) and Codex PreToolUse (apply_patch|Edit|Write).
// [M] mechanism (ship as-is): reading the edited paths from the hook's stdin JSON, the refusal
//   and the entry check. [B] binding (re-derived per project): the PROTECTED line below.
// WHY. A hook that reads the paths from an environment variable never runs: one project's .env
// guard and formatter read $CLAUDE_FILE_PATHS, which Claude Code does not set (none in the
// 2.1.308 binary), so the guard never blocked and the formatter never formatted. Both hosts hand
// the hook one JSON object on stdin instead:
//   Claude Code  Edit, Write, MultiEdit: tool_input.file_path; NotebookEdit: tool_input.notebook_path
//   Codex        apply_patch (the Edit and Write matchers alias it; tool_name stays apply_patch):
//                tool_input.command holds the patch, whose `*** Add File:`, `*** Update File:`,
//                `*** Delete File:` and `*** Move to:` lines name the paths, relative to `cwd`
//                (indented, one counts where a file section may start; inside an Update hunk a
//                space-led line is context)
// A refusal exits 2 with `BLOCKED (protected-path): <path> ...` on stderr, which both hosts read
// as a block. Input that does not parse, or names no path, exits 0: the hook never blocks on its
// own failure. Codex loads a project's .codex/hooks.json only once its .codex/ layer is trusted.
// A PostToolUse formatter reads the same paths: import { editedPaths } from this file.
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// [B] Repo-relative paths (`/` separators) an agent never edits: env files that hold secrets and
// installed packages. An env file is `.env` or `.envrc`, either with a suffix after `.`, `-`, `_` or
// `~` (.env.local, .env-local, .env~, .envrc.local), or any `<name>.env` (prod.env); a committed
// template whose last suffix is example, sample or template (.env.example, .env.production.example)
// stays editable. A project adds its own: a lock file, an auth-state directory, generated code. Every
// pattern takes `i`, a project's own too: macOS and Windows volumes are case-insensitive by default,
// so `.ENV` is `.env` there and `NODE_MODULES/x` writes into node_modules.
export const PROTECTED = [/(^|\/)(?:\.env(?:rc)?(?:[.~_-](?!(?:[^/]*\.)?(?:example|sample|template)$)[^/]*)?|[^/]+\.env)$/i, /(^|\/)node_modules(\/|$)/i];

/** `p` relative to `root` with `/` separators when inside it, else `p` itself. */
function repoRel(root, p) {
  const rel = relative(root, p);
  const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  return (inside ? rel : p).split(sep).join('/');
}

/**
 * The path the file system writes for `written`: the deepest part that exists, links resolved, then
 * the rest as written (a new file's parent may not exist yet). A link to nothing is followed too: a
 * write through it creates its target. Nothing is normalised before its links are followed: the file
 * system takes `jump/..` from where `jump` leads, and resolve() (like the JS realpathSync, which
 * calls it) drops `jump/..` as text; realpathSync.native asks the file system.
 */
function physicalPath(written) {
  let head = written;
  let rest = [];
  let hops = 0;
  for (;;) {
    try {
      return join(realpathSync.native(head), ...rest);
    } catch {
      // not there yet, or a link to nothing
    }
    let target = null;
    try {
      if (lstatSync(head).isSymbolicLink()) target = readlinkSync(head);
    } catch {
      // absent
    }
    if (target !== null && hops++ < 40) {
      head = isAbsolute(target) ? target : `${dirname(head)}${sep}${target}`;
      continue;
    }
    const parent = dirname(head);
    if (parent === head) return written;
    rest = [basename(head), ...rest];
    head = parent;
  }
}

/**
 * Every path one tool call writes, moves or deletes: `{ abs, rel, real }`, rel repo-relative when
 * inside `root`, real the same for the path the file system writes. Both are checked: resolve() and
 * relative() only normalise text, so `deps/x` with `deps -> node_modules` reads as an ordinary path.
 */
export function editedPaths(input, root = ROOT) {
  const toolInput = input?.tool_input ?? {};
  const base = typeof input?.cwd === 'string' && input.cwd !== '' ? input.cwd : root;
  const raw = [];
  for (const key of ['file_path', 'notebook_path']) if (typeof toolInput[key] === 'string' && toolInput[key] !== '') raw.push(toolInput[key]);
  // The patch as one string; an argv-style array is read the same way.
  const patch = Array.isArray(toolInput.command) ? toolInput.command.join('\n') : toolInput.command;
  if (typeof patch === 'string' && patch.includes('*** Begin Patch')) {
    // Inside an Update File hunk, up to the next header or column-0 `***` line, a space-led line is
    // context: a doc that holds a patch example names paths the patch never writes.
    let inUpdate = false;
    for (const line of patch.split(/\r?\n/)) {
      const m = /^\s*\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
      const head = line.trimStart();
      const move = head.startsWith('*** Move to: ');
      const context = inUpdate && line.startsWith(' ');
      // `*** Move to:` counts at any indent and keeps its Update section: refuse more than Codex applies, never less.
      if (m && (!context || move)) raw.push(m[1].trim());
      if (!move && !context && head.startsWith('***')) inUpdate = m !== null && head.startsWith('*** Update File: ');
    }
  }
  let realRoot = root;
  try {
    realRoot = realpathSync.native(root);
  } catch {
    // keep the root as given
  }
  return raw.map((p) => {
    const abs = isAbsolute(p) ? p : resolve(base, p);
    const rel = repoRel(root, abs);
    let real = rel;
    try {
      real = repoRel(realRoot, physicalPath(isAbsolute(p) ? p : `${resolve(base)}${sep}${p}`));
    } catch {
      // the lexical path still decides: never less than before
    }
    return { abs, rel, real };
  });
}

/** The first protected path the call edits, or null. */
export function protectedHit(input, root = ROOT) {
  return editedPaths(input, root).find(({ rel, real }) => PROTECTED.some((re) => re.test(rel) || re.test(real))) ?? null;
}

function main() {
  try {
    const hit = protectedHit(JSON.parse(readFileSync(0, 'utf8') || '{}'));
    if (!hit) return 0;
    const via = hit.real === hit.rel ? '' : ` (it writes ${hit.real})`;
    process.stderr.write(`BLOCKED (protected-path): ${hit.rel}${via} is a path an agent never edits (secrets or installed packages); ask the owner.\n`);
    return 2;
  } catch {
    return 0; // never block on a parse failure
  }
}

// Run only as the entry script. Compare REAL paths: a symlinked hooks directory (or macOS /tmp)
// would otherwise skip main() and allow every edit.
function isEntry() {
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  return Boolean(process.argv[1]) && real(process.argv[1]) === real(fileURLToPath(import.meta.url));
}

if (isEntry()) process.exitCode = main();
