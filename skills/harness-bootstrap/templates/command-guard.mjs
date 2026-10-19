#!/usr/bin/env node
// harness-bootstrap command-guard hook (generated YYYY-MM-DD). Claude Code, PreToolUse(Bash).
// [M] mechanism (ship as-is): the command parser and the built-in rules - no-verify (commit,
//   and merge/pull --no-verify; also HUSKY=0), hooks-path-override (-c core.hooksPath, git config core.hooksPath),
//   force-push-mainline, delete-mainline. [B] binding (re-derived per project): the MAINLINE,
//   HOOKS_DIR and EXTRA_RULES lines below.
// The command is PARSED, never pattern-matched: heredoc bodies are removed and quoted strings
// are held aside first (a commit message that mentions --no-verify is text, not a bypass), then
// each simple command is read with the directory `cd` / `git -C` moved it to. The program is
// compared by basename (/usr/bin/git), and the wrappers command, exec, env, nice, timeout,
// sudo and xargs are stripped, as are `bash -c "<script>"` and `eval "<script>"` (re-parsed).
// A quoted word without whitespace is unquoted before options are read ("--no-verify" is seen);
// a quoted string with whitespace stays one opaque word. A block exits 2 with
// `BLOCKED (<rule>): <reason>` on stderr; any parse failure or exception exits 0.
// This stops an agent's own mistakes; it is not a sandbox. Known limits: command substitution
// inside double quotes is not parsed (a nested `$(...)` with its own quotes is skipped as one
// string; quotes nested inside backticks are not); a program named by a variable or substitution
// ($(which git)), shell aliases and git aliases (`git ci`) are not resolved; settings made
// earlier in the session (export HUSKY=0, GIT_CONFIG_* variables) are not tracked; git's
// abbreviations of long options are expanded only for --no-verify, --force-with-lease, --delete
// and --tags; a push counts as forced when any of its refspecs is `+`-prefixed (so `+a main` is
// refused); glob refspecs (`+refs/heads/*:refs/heads/*`) are not read; a force push whose only
// selection is --tags (no refspec) is allowed; a delete is refused only when its target is
// literally the mainline (an unresolved `$VAR` target is allowed, a force push's is not).
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// [B] Branches that must never be force-pushed.
export const MAINLINE = ['main', 'master'];

// [B] The directory the commit guard's hooks live in. `git config core.hooksPath <this>` is the
// documented install command and is allowed (local scope only); any other value, --unset, a
// --global / --system scope and `-c core.hooksPath=...` stay refused.
export const HOOKS_DIR = '.githooks';

// [B] Project-specific rules: { name, test: ({ argv, cwd }) => boolean, reason }.
// `argv` holds the words of one simple command with wrappers stripped (argv[0] may be a path:
// compare basename). A quoted string with whitespace appears as an opaque placeholder word and
// one without is unquoted, so match on argv[0] and flags, not on message text.
// Example (import { existsSync } from 'node:fs'; and { resolve } is already imported): refuse a
// full dev stack started at the workspace root.
//   {
//     name: 'full-stack-dev',
//     test: ({ argv, cwd }) =>
//       argv[0] === 'pnpm' && argv.slice(1).includes('dev') && existsSync(resolve(cwd, 'pnpm-workspace.yaml')),
//     reason: 'start only the services the check needs, not the whole stack from the workspace root',
//   },
export const EXTRA_RULES = [];

const SEP = String.fromCharCode(1); // brackets a placeholder; cannot occur in a typed command
const PH = new RegExp(`${SEP}Q(\\d+)${SEP}`, 'g');
const WRAPPERS = new Set(['command', 'exec', 'builtin', 'time', 'nohup', '!', 'if', 'then', 'else', 'elif', 'while', 'until', 'do', '{']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Programs that run the rest of their line as a command. Short options that take a value (a
// letter that ends a cluster takes the next word; otherwise the rest of the cluster) ...
const WRAPPER_SHORT_VALUE = new Map([['env', 'uCS'], ['nice', 'n'], ['timeout', 'sk'], ['sudo', 'ughpCDRrtTU'], ['xargs', 'InLPsdEa']]);
// ... and long options that take a value as a separate word.
const WRAPPER_LONG_VALUE = new Map([
  ['env', ['--unset', '--chdir', '--split-string']],
  ['nice', ['--adjustment']],
  ['timeout', ['--signal', '--kill-after']],
  ['sudo', ['--user', '--group', '--host', '--prompt', '--close-from', '--chdir', '--chroot', '--role', '--type', '--command-timeout', '--other-user']],
  ['xargs', ['--max-args', '--max-lines', '--max-procs', '--max-chars', '--delimiter', '--arg-file']],
]);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const HOOK_SUBCOMMANDS = new Set(['commit', 'merge', 'push', 'rebase', 'am']);
const GIT_VALUE_OPTIONS = new Set(['--git-dir', '--work-tree', '--namespace', '--super-prefix']);
const COMMIT_VALUE_LONG = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--template', '--author', '--date', '--cleanup', '--trailer', '--pathspec-from-file']);
const COMMIT_VALUE_SHORT = 'mFCct';
const PUSH_VALUE_LONG = new Set(['--repo', '--receive-pack', '--exec', '--push-option']);

const expand = (p) => (p.startsWith('~') ? homedir() + p.slice(1) : p);

/** Drop heredoc bodies (and their markers), keeping the rest of the marker's line. */
function stripHeredocs(text) {
  // The delimiter may be bare, 'quoted', "quoted" or backslash-quoted (<<\EOF).
  const marker = /(?<!<)<<(-?)\s*(?:(['"])([A-Za-z_][\w.-]*)\2|\\?([A-Za-z_][\w.-]*))/;
  for (let guard = 0; guard < 50; guard++) {
    const m = marker.exec(text);
    if (!m) break;
    const afterMarker = m.index + m[0].length;
    const lineEnd = text.indexOf('\n', afterMarker);
    const head = text.slice(0, m.index) + ' ';
    if (lineEnd === -1) {
      text = head + text.slice(afterMarker);
      continue;
    }
    const lines = text.slice(lineEnd + 1).split('\n');
    const delimiter = m[3] ?? m[4];
    const end = lines.findIndex((l) => l.trim() === delimiter);
    const rest = end === -1 ? '' : lines.slice(end + 1).join('\n');
    text = head + text.slice(afterMarker, lineEnd + 1) + rest;
  }
  return text;
}

function ansiDecode(text) {
  return text.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|[0-7]{1,3}|[\s\S])/g, (_, e) => {
    if (/^[xu]./.test(e)) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return { n: '\n', t: '\t', r: '\r' }[e] ?? e;
  });
}

/** Index just after the `)` that closes the `$(` at src[i]; nested quotes and parentheses are skipped. */
function skipSubstitution(src, i) {
  let depth = 1;
  let j = i + 2;
  while (j < src.length && depth > 0) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
    } else if (c === "'") {
      const end = src.indexOf("'", j + 1);
      j = end === -1 ? src.length : end + 1;
    } else if (c === '"') {
      j = closeDouble(src, j) + 1;
    } else {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
  }
  return j;
}

/** Index of the `"` that closes the double-quoted string opened at src[i] (src.length if none). */
function closeDouble(src, i) {
  let j = i + 1;
  while (j < src.length && src[j] !== '"') {
    if (src[j] === '\\') j += 2;
    else if (src[j] === '$' && src[j + 1] === '(') j = skipSubstitution(src, j);
    else j++;
  }
  return Math.min(j, src.length);
}

/** Replace quoted strings with opaque placeholders (kept in `quoted`); drop comments. */
function maskQuotes(src, quoted) {
  const hold = (content) => `${SEP}Q${quoted.push(content) - 1}${SEP}`;
  let out = '';
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === "'") {
      let j = src.indexOf("'", i + 1);
      if (j === -1) j = src.length;
      out += hold(src.slice(i + 1, j));
      i = j + 1;
    } else if (c === '"') {
      const j = closeDouble(src, i);
      out += hold(src.slice(i + 1, j).replace(/\\(["\\$`])/g, '$1'));
      i = j + 1;
    } else if (c === '$' && src[i + 1] === "'") {
      // ANSI-C quoting: $'--no-verify', with escapes decoded.
      let j = i + 2;
      while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
      out += hold(ansiDecode(src.slice(i + 2, j)));
      i = j + 1;
    } else if (c === '$' && src[i + 1] === '"') {
      i++; // $"..." is a plain double-quoted string
    } else if (c === '\\') {
      const next = src[i + 1];
      if (next === '\n' || next === undefined) out += ' ';
      else out += /[\w./-]/.test(next) ? next : hold(next);
      i += 2;
    } else if (c === '#' && (out === '' || /[\s;&|()`]$/.test(out))) {
      while (i < src.length && src[i] !== '\n') i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * If words[0] is env, nice, timeout, sudo or xargs, drop it with its options (and, for env and
 * sudo, VAR=value words, which are appended to `assignments`). True when something was dropped.
 */
function unwrap(words, assignments) {
  const name = basename(words[0]);
  const shortValue = WRAPPER_SHORT_VALUE.get(name);
  if (shortValue === undefined) return false;
  const longValue = WRAPPER_LONG_VALUE.get(name);
  let i = 1;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === '--') {
      i++;
      break;
    }
    if (!w.startsWith('-')) break;
    if (w.startsWith('--')) {
      if (longValue.includes(w)) i++;
      continue;
    }
    for (let k = 1; k < w.length; k++) {
      if (shortValue.includes(w[k])) {
        if (k === w.length - 1) i++; // otherwise the rest of the cluster is the value
        break;
      }
    }
  }
  if (name === 'timeout') i++; // the duration
  if (name === 'env' || name === 'sudo') {
    for (; i < words.length && ASSIGNMENT.test(words[i]); i++) assignments.push(words[i]);
  }
  words.splice(0, i);
  return true;
}

function parse(command, cwd, quoted, depth) {
  const commands = [];
  let dir = cwd;
  // `2>&1`, `>&2` and `>&file` are dropped before the split on `&` would cut them in two.
  const text = maskQuotes(stripHeredocs(command), quoted).replace(/(?<!\d)\d*[<>]&\s*[^\s;&|()<>]*/g, ' ');
  const unq = (w) => w.replace(PH, (_, n) => quoted[Number(n)]);
  // A quoted string without whitespace becomes plain text, so a quoted flag is still a flag.
  const open = (w) => w.replace(PH, (m, n) => {
    const c = quoted[Number(n)];
    return c && !/\s/.test(c) && !c.includes(SEP) ? c : m;
  });
  for (const segment of text.split(/&&|\|\||[;&|()`\n]/)) {
    // Redirections (with an optional space before the target) are not words. (?<!\d) keeps the
    // scan linear on a long run of digits.
    const words = segment.replace(/(?<!\d)\d*(?:>>?|<{1,3})\s*\S*/g, ' ').trim().split(/\s+/).filter(Boolean).map(open);
    const env = [];
    for (;;) {
      if (!words.length) break;
      if (ASSIGNMENT.test(words[0])) env.push(words.shift());
      else if (WRAPPERS.has(words[0])) words.shift();
      else if (!unwrap(words, env)) break;
    }
    if (!words.length) continue;
    if (words[0] === 'cd') {
      const target = words.slice(1).find((w) => w !== '--' && w !== '-L' && w !== '-P');
      if (!target) dir = homedir();
      else if (target !== '-') dir = resolve(dir, expand(unq(target)));
      continue;
    }
    const cmd = { argv: words, cwd: dir };
    Object.defineProperty(cmd, 'env', { value: env, enumerable: false });
    commands.push(cmd);
    if (depth >= 3) continue;
    // `bash -c "<script>"` and `eval "<script>"` run their quoted text as commands.
    let script = null;
    if (SHELLS.has(basename(words[0]))) {
      const at = words.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w));
      if (at !== -1 && words[at + 1]) script = unq(words[at + 1]);
    } else if (words[0] === 'eval') {
      script = words.slice(1).map(unq).join(' ');
    }
    if (script) commands.push(...parse(script, dir, quoted, depth + 1));
  }
  return commands;
}

/** Simple commands of a shell command line: [{ argv, cwd }]. Quoted text is an opaque word. */
export function parseCommands(command, cwd = process.cwd()) {
  const quoted = [];
  const commands = parse(String(command ?? ''), cwd, quoted, 0);
  // check() needs the quoted values for git options like `-c "core.hooksPath=..."`.
  for (const c of commands) Object.defineProperty(c, 'quoted', { value: quoted, enumerable: false });
  return commands;
}

function gitParts(cmd) {
  const unq = (w) => w.replace(PH, (_, n) => cmd.quoted[Number(n)]);
  const { argv } = cmd;
  const config = [];
  let cwd = cmd.cwd;
  let i = 1;
  for (; i < argv.length && argv[i].startsWith('-'); i++) {
    const w = argv[i];
    if (w === '-C') {
      const v = argv[++i];
      if (v) cwd = resolve(cwd, expand(unq(v)));
    } else if (w === '-c' || w === '--config-env') {
      config.push(unq(argv[++i] ?? ''));
    } else if (w.startsWith('--config-env=')) {
      config.push(unq(w.slice('--config-env='.length)));
    } else if (GIT_VALUE_OPTIONS.has(w)) {
      i++;
    }
  }
  return { sub: argv[i], rest: argv.slice(i + 1), config, cwd, unq };
}

/**
 * True when a `git merge` or `git pull` argument list asks to skip pre-merge-commit. Only the exact
 * --no-verify: an abbreviation is ambiguous with --no-verify-signatures, and -n is --no-stat.
 */
function mergeSkipsHooks(rest) {
  for (const t of rest) {
    if (t === '--') break;
    if (t === '--no-verify') return true;
  }
  return false;
}

/** True when a `git commit` argument list asks to skip hooks (--no-verify or -n in a cluster). */
function commitSkipsHooks(rest) {
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t === '--') break;
    if (t.startsWith('--')) {
      const name = t.split('=')[0];
      if (name.length >= 6 && '--no-verify'.startsWith(name)) return true;
      if (COMMIT_VALUE_LONG.has(name) && !t.includes('=')) j++;
    } else if (/^-[^-]/.test(t)) {
      const cluster = t.slice(1);
      for (let k = 0; k < cluster.length; k++) {
        const ch = cluster[k];
        if (ch === 'n') return true;
        if (COMMIT_VALUE_SHORT.includes(ch)) {
          if (k === cluster.length - 1) j++; // the value is the next word
          break; // otherwise the rest of the cluster is the value
        }
        if (ch === 'S' || ch === 'u') break; // optional value, attached
      }
    }
  }
  return false;
}

const branchCache = new Map();
function branchOf(dir) {
  if (!branchCache.has(dir)) {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 2000 });
    branchCache.set(dir, r.status === 0 ? r.stdout.trim() : null);
  }
  return branchCache.get(dir);
}

const CONFIG_READ = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l', '--show-origin', '--show-scope', '--name-only']);
const CONFIG_UNSET = new Set(['--unset', '--unset-all']);
const CONFIG_VALUE_LONG = new Set(['--file', '--blob', '--type', '--default', '--comment']);

/** True when `git config ...` writes or removes core.hooksPath (reads, other keys and HOOKS_DIR are fine). */
function configChangesHooksPath(rest, unq) {
  const positionals = [];
  let read = false;
  let unset = false;
  let plain = true; // no option other than --local (so not --global, --system, --file, --add, ...)
  for (let j = 0; j < rest.length; j++) {
    const t = unq(rest[j]);
    if (t === '--') {
      positionals.push(...rest.slice(j + 1).map(unq));
      break;
    }
    if (t.startsWith('--')) {
      const name = t.split('=')[0];
      if (name !== '--local') plain = false;
      if (CONFIG_READ.has(name)) read = true;
      else if (CONFIG_UNSET.has(name)) unset = true;
      else if (CONFIG_VALUE_LONG.has(name) && !t.includes('=')) j++;
    } else if (t.startsWith('-') && t.length > 1) {
      plain = false;
      if (t === '-f') j++;
      else if (t === '-l') read = true;
    } else {
      positionals.push(t);
    }
  }
  // git 2.46 spelling: `git config get|set|unset <key> [<value>]`.
  const verb = positionals[0];
  if (verb === 'get' || verb === 'list') read = true;
  if (verb === 'unset') unset = true;
  if (verb === 'get' || verb === 'list' || verb === 'set' || verb === 'unset') positionals.shift();
  if (read || (positionals[0] ?? '').toLowerCase() !== 'core.hookspath') return false;
  if (unset) return true;
  if (positionals.length < 2) return false;
  // The documented install command of the commit guard: a plain local set to HOOKS_DIR.
  const dirKey = (p) => p.trim().replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  return !(plain && positionals.length === 2 && HOOKS_DIR && dirKey(positionals[1]) === dirKey(HOOKS_DIR));
}

/** { rule, reason } when a `git push` rewrites or deletes a mainline branch, else null. */
function pushHit(parts, currentBranch) {
  let force = false;
  let everything = false;
  let del = false;
  let tags = false;
  const positionals = [];
  const { rest, unq } = parts;
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t === '--') {
      positionals.push(...rest.slice(j + 1));
      break;
    }
    if (t.startsWith('--')) {
      const name = t.split('=')[0];
      if (name === '--force' || (name.length >= 9 && '--force-with-lease'.startsWith(name))) force = true;
      else if (name === '--mirror') force = everything = true;
      else if (name === '--all') everything = true;
      else if (name.length >= 5 && '--delete'.startsWith(name)) del = true;
      else if (name.length >= 5 && '--tags'.startsWith(name)) tags = true;
      else if (PUSH_VALUE_LONG.has(name) && !t.includes('=')) j++;
    } else if (/^-[^-]/.test(t)) {
      const cluster = t.slice(1);
      for (let k = 0; k < cluster.length; k++) {
        if (cluster[k] === 'f') force = true;
        if (cluster[k] === 'd') del = true;
        if (cluster[k] === 'o') {
          if (k === cluster.length - 1) j++;
          break;
        }
      }
    } else {
      positionals.push(t);
    }
  }
  const refs = positionals.slice(1).map(unq); // positionals[0] is the remote
  if (refs.some((r) => r.startsWith('+'))) force = true;
  const branch = () => currentBranch ?? branchOf(parts.cwd);
  const nameOf = (r) => r.replace(/^\+/, '').replace(/^.*:/, '').replace(/^refs\/heads\//, '');
  // The branch a refspec updates; an unresolvable one ($VAR, $(...)) or HEAD / @ is the current branch.
  const target = (r) => {
    const name = nameOf(r);
    return name === 'HEAD' || name === '@' || name.includes('$') ? branch() : name;
  };
  // A delete is refused only when its target is literally the mainline: unlike a force push, an
  // unresolved target (`--delete origin "$b"`) does not fall back to the current branch.
  const dropped = del ? refs : refs.filter((r) => r.startsWith(':'));
  for (const name of dropped.map(nameOf)) {
    if (name && MAINLINE.includes(name)) {
      return {
        rule: 'delete-mainline',
        reason: `this push would delete \`${name}\` on the remote. Delete a feature branch instead, or ask the owner to do this one.`,
      };
    }
  }
  if (!force || del) return null;
  if (tags && !everything && !refs.length) return null; // -f --tags alone pushes only tags
  const rewritten = everything ? [MAINLINE[0] ?? 'mainline'] : (refs.length ? refs.map(target) : [branch()]);
  const hit = rewritten.find((name) => name && (everything || MAINLINE.includes(name)));
  if (!hit) return null;
  return {
    rule: 'force-push-mainline',
    reason: `a force push would rewrite \`${hit}\`. Push a feature branch, or ask the owner to do this one.`,
  };
}

function builtinRule(cmd, opts) {
  if (basename(cmd.argv[0]) !== 'git') return null;
  const parts = gitParts(cmd);
  if (parts.config.some((c) => /^core\.hookspath(=|$)/i.test(c.trim())) && HOOK_SUBCOMMANDS.has(parts.sub)) {
    return {
      rule: 'hooks-path-override',
      reason: `\`git ${parts.sub}\` with -c core.hooksPath replaces the repository hooks, which bypasses the commit guard. Run it without the override.`,
    };
  }
  if (parts.sub === 'config' && configChangesHooksPath(parts.rest, parts.unq)) {
    return {
      rule: 'hooks-path-override',
      reason: '`git config core.hooksPath` (set or unset) replaces the repository hooks, which bypasses the commit guard. Leave the setting alone.',
    };
  }
  if (parts.sub === 'commit' && (commitSkipsHooks(parts.rest) || (cmd.env ?? []).some((e) => /^HUSKY=0$/.test(parts.unq(e))))) {
    return {
      rule: 'no-verify',
      reason: '`git commit --no-verify` (or -n, or HUSKY=0) skips the commit guard. Fix what the hook reports, or ask the owner to override.',
    };
  }
  if (
    (parts.sub === 'merge' || parts.sub === 'pull') &&
    (mergeSkipsHooks(parts.rest) || (cmd.env ?? []).some((e) => /^HUSKY=0$/.test(parts.unq(e))))
  ) {
    return {
      rule: 'no-verify',
      reason: `\`git ${parts.sub} --no-verify\` (or HUSKY=0) skips the pre-merge-commit guard. Fix what the hook reports, or ask the owner to override.`,
    };
  }
  if (parts.sub === 'push') return pushHit(parts, opts.currentBranch);
  return null;
}

/** null when the command is allowed, else { rule, reason }. */
export function check(command, { cwd = process.cwd(), currentBranch } = {}) {
  branchCache.clear();
  for (const cmd of parseCommands(command, cwd)) {
    const hit = builtinRule(cmd, { currentBranch });
    if (hit) return hit;
    for (const extra of EXTRA_RULES) {
      let matched = false;
      try {
        matched = Boolean(extra.test({ argv: cmd.argv, cwd: cmd.cwd }));
      } catch {
        // A broken project rule must not block the session.
      }
      if (matched) return { rule: extra.name, reason: extra.reason };
    }
  }
  return null;
}

async function main() {
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const input = JSON.parse(raw || '{}');
    if (input?.tool_name !== 'Bash') return 0;
    const hit = check(String(input?.tool_input?.command ?? ''), { cwd: input.cwd || process.cwd() });
    if (hit) {
      process.stderr.write(`BLOCKED (${hit.rule}): ${hit.reason}\n`);
      return 2;
    }
  } catch {
    // Never block on a parse failure.
  }
  return 0;
}

// Run only as the entry script. Compare REAL paths: import.meta.url is symlink-resolved while
// argv[1] is not (macOS /tmp -> /private/tmp, a symlinked hooks directory), and a mismatch would
// skip main() and allow every command.
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

if (isEntry()) {
  process.exit(await main());
}
