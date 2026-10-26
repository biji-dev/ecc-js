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
// A refusal exits 2 with `BLOCKED (protected-path): <path> ...` on stderr, which both hosts read
// as a block. Input that does not parse, or names no path, exits 0: the hook never blocks on its
// own failure. Codex loads a project's .codex/hooks.json only once its .codex/ layer is trusted.
// A PostToolUse formatter reads the same paths: import { editedPaths } from this file.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// [B] Repo-relative paths (`/` separators) an agent never edits: env files that hold secrets (a
// committed template, .env.example, .env.sample or .env.template, stays editable) and installed
// packages. A project adds its own: a lock file, an auth-state directory, generated code.
export const PROTECTED = [/(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/, /(^|\/)node_modules(\/|$)/];

/** Every path one tool call writes, moves or deletes: `{ abs, rel }`, rel repo-relative when inside `root`. */
export function editedPaths(input, root = ROOT) {
  const toolInput = input?.tool_input ?? {};
  const base = typeof input?.cwd === 'string' && input.cwd !== '' ? input.cwd : root;
  const raw = [];
  for (const key of ['file_path', 'notebook_path']) if (typeof toolInput[key] === 'string' && toolInput[key] !== '') raw.push(toolInput[key]);
  // The patch as one string; an argv-style array is read the same way.
  const patch = Array.isArray(toolInput.command) ? toolInput.command.join('\n') : toolInput.command;
  if (typeof patch === 'string' && patch.includes('*** Begin Patch')) {
    for (const line of patch.split(/\r?\n/)) {
      const m = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
      if (m) raw.push(m[1].trim());
    }
  }
  return raw.map((p) => {
    const abs = isAbsolute(p) ? p : resolve(base, p);
    const rel = relative(root, abs);
    const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    return { abs, rel: (inside ? rel : abs).split(sep).join('/') };
  });
}

/** The first protected path the call edits, or null. */
export function protectedHit(input, root = ROOT) {
  return editedPaths(input, root).find(({ rel }) => PROTECTED.some((re) => re.test(rel))) ?? null;
}

function main() {
  try {
    const hit = protectedHit(JSON.parse(readFileSync(0, 'utf8') || '{}'));
    if (!hit) return 0;
    process.stderr.write(`BLOCKED (protected-path): ${hit.rel} is a path an agent never edits (secrets or installed packages); ask the owner.\n`);
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
