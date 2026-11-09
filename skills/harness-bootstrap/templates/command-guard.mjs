#!/usr/bin/env node
// harness-bootstrap command-guard hook (generated YYYY-MM-DD). Claude Code, PreToolUse(Bash).
// [M] mechanism (ship as-is): the command parser and the built-in rules - no-verify (commit
//   --no-verify / -n, push --no-verify, merge/pull --no-verify; also HUSKY=0, or a HUSKY value the
//   guard cannot resolve, on any git subcommand), hooks-path-override (on any git subcommand, since
//   every ref move runs the reference-transaction hook: -c core.hooksPath, an inline or exported
//   GIT_CONFIG_PARAMETERS or GIT_CONFIG_KEY_<n>=core.hooksPath, and a PATH that adds an entry that
//   could hold a planted node, which can replace the node the guard runs: an empty, relative or
//   unresolvable entry, or one under a temporary directory or inside the repository, read from the
//   PATH git runs with, composed from the values its environment gives in order; and git config
//   core.hooksPath), force-push-mainline,
//   delete-mainline, codex-background (a codex, codex-run.mjs or claude-run.mjs launch, or node or
//   bun with either script in any later word, sent to the background with a shell `&`),
//   landing-override (a line that sets HARNESS_LANDING, the owner's override of the commit guard's
//   landing check, in any form: an assignment, inline or on its own, export, declare, typeset,
//   readonly, local or env, on any command), host-override (a git command whose environment sets
//   or drops a variable the landing check reads the host from: HARNESS_HOST, CLAUDECODE,
//   CODEX_THREAD_ID, CODEX_SANDBOX or a ZCODE_* name, by an assignment, env -u, env -i or exec -c;
//   or a declaration, assignment, `unset` or `export -n` of one on a line that runs a git command)
//   and merge-ff-mainline (a `git merge` onto a MAINLINE
//   branch without --no-ff, which may fast-forward and so run no hook, or a `git pull .` there).
//   On a line that runs git (at any depth), a guarded name in any form the guard does not read is
//   refused: a whole word of a command that is not git names it (read, printf -v, for, mapfile, a
//   nameref, a subscripted NAME[i]=), or a double-quoted string holds ${NAME= or ${NAME:=. A read
//   ($NAME, ${NAME:-x}), git's own arguments and the forms the guard reads by value (an assignment
//   or a declaration, unset or export -n of PATH, HUSKY or a GIT_CONFIG_* name) do not count.
//   HARNESS_LANDING is landing-override, a host variable host-override, PATH and GIT_CONFIG_*
//   hooks-path-override, HUSKY no-verify; the reason says to run a search or a print of the name
//   apart from git. [B]
//   binding (re-derived per project): the MAINLINE, HOOKS_DIR and EXTRA_RULES lines below.
// The command is PARSED, never pattern-matched: heredoc bodies are removed and quoted strings are
// held aside first (a commit message that mentions --no-verify is text, not a bypass), then each
// simple command is read with the directory `cd` / `git -C` moved it to (a `cd` reaches the later
// commands of its own shell, as an export does). The program is compared by basename
// (/usr/bin/git), and the wrappers command, builtin, exec, time, nohup, env, nice, timeout, sudo
// and xargs are stripped with their options (`command -p`, `exec -a name`, `time -p`,
// `time -o file`, `time -f fmt`, `env -P dir`; a long option also by an unambiguous prefix, as GNU
// tools take it: `env --u`), as are a shell's `-c "<script>"` (bash, sh, dash, zsh, ksh, csh,
// fish and their kin; options may come before or after the -c: `bash -c -x "<script>"`) and
// `eval "<script>"` (each re-parsed). `env -S "<string>"` is split as env splits it, not as a shell
// would (its quotes and backslash escapes; `;` and `|` are text; `\c`, or a word that starts with
// an unquoted `#`, ends the string but not the words after it), and its words are read in its
// place. A command's environment is its inline VAR=value words (also those after env or sudo), any
// variable exported earlier in the same shell (not past a `( ... )`, a backtick, a pipeline or a
// backgrounded list: each runs in a subshell), and, inside a `bash -c` or `eval` script, the
// shell's own; a later assignment wins; `env -i` and `exec -c` clear it. An assignment word is
// NAME=, NAME+= (an append: NAME= the value the line gave NAME, else ${NAME}, then the text) or
// NAME[i]= (a value the guard cannot resolve). The shell's plain variables are tracked the same
// way: an assignment-only command sets one; a bare `export NAME` exports the shell's value (an
// inherited name keeps its own, ${NAME}; a name never assigned is exported by the first assignment
// that gives it one), as do `declare -x` and `typeset -x`; `export -n`, `declare +x` and `unset`
// drop it; and an assignment to a name already exported (on the line, or in the hook's own
// environment, as PATH is) changes the exported value. A command runs in the background when its
// and-or list
// (back over &&, || and | to the previous ;, newline, & or `(`; a newline after &&, || or |
// continues the list) ends in a single `&` (`a && b &` backgrounds both), when it sits in a
// `( ... ) &` or `{ ...; } &` group, or in a `bash -c` / `eval` script that is backgrounded;
// `&>file`, `&>>file` and `|&` do not background.
// A quoted word without whitespace is unquoted before options are read ("--no-verify" is seen);
// a quoted string with whitespace stays one opaque word. A block exits 2 with
// `BLOCKED (<rule>): <reason>` on stderr; any parse failure or exception exits 0.
// This stops an agent's own mistakes; it is not a sandbox. Known limits: command substitution
// inside double quotes is not parsed (a nested `$(...)` with its own quotes is skipped as one
// string; quotes nested inside backticks are not); a program named by a variable or substitution
// ($(which git)), an `env -S` string's `${VAR}`, shell aliases and git aliases (`git ci`) are not
// resolved; an export or cd in an `eval` script does not reach the commands after the eval (bash
// runs it in the current shell);
// settings made in an earlier Bash call (export HUSKY=0, GIT_CONFIG_* variables, a HARNESS_LANDING,
// a changed or unset HARNESS_HOST, CLAUDECODE, CODEX_THREAD_ID, CODEX_SANDBOX or ZCODE_* variable)
// or in the host's settings, or on this line by `set -a`, are not tracked; the files or input a
// line runs (a script, source, a heredoc fed to a shell, a git alias, a scheduler) are not read;
// what runs there can set any variable; a merge argument that
// looks like `<remote>/<mainline>` is taken as the remote mainline unread; an assignment whose value is an
// unquoted `$(...)` or backtick substitution is cut from its command (GIT_CONFIG_KEY_0=$(...) git
// commit is allowed; the quoted "$(...)" is refused); GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM,
// GIT_DIR or a config include that points at a file setting core.hooksPath is not read; rebase and
// am --no-verify are allowed (they skip pre-rebase and applypatch, not the commit guard); a
// background form other than those above is not detected (`if ...; fi &`, a loop's `done &`,
// coproc, setsid, a launch through a script of its own); git's abbreviations of long options are
// expanded only for --no-verify, --force-with-lease, --delete and --tags; a push counts as forced
// when any of its refspecs is `+`-prefixed (so `+a main` is refused); glob refspecs
// (`+refs/heads/*:refs/heads/*`) are not read; a force push whose only selection is --tags (no
// refspec) is allowed; a delete is refused only when its target is literally the mainline (an
// unresolved `$VAR` target is allowed, a force push's is not); a node planted in a directory outside
// the repository and the temporary directories, put first on PATH, is not refused.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// [B] Branches that must never be force-pushed.
export const MAINLINE = ['main', 'master'];

// [B] The directory the commit guard's hooks live in. `git config core.hooksPath <this>` is the
// documented install command and is allowed (local scope only), as are its absolute forms
// "$(git rev-parse --show-toplevel)/<this>" and the repository top's real path followed by
// /<this>; any other value, --unset, a --global / --system scope and `-c core.hooksPath=...` stay
// refused.
export const HOOKS_DIR = '.githooks';

// [B] Project-specific rules: { name, test: ({ argv, cwd, env, background }) => boolean, reason }.
// `argv` holds the words of one simple command with wrappers stripped (argv[0] may be a path:
// compare basename). A quoted string with whitespace appears as an opaque placeholder word and
// one without is unquoted, so match on argv[0] and flags, not on message text. `env` is the
// command's environment as the header describes it, { NAME: value } with values unquoted (a later
// assignment wins); `background` is true when the command runs asynchronously (`&`).
// Example (import { existsSync } from 'node:fs'; and { resolve } is already imported): refuse a
// full dev stack started at the workspace root, unless the owner runs it as `ALLOW_STACK=1 pnpm dev`.
//   {
//     name: 'full-stack-dev',
//     test: ({ argv, cwd, env }) =>
//       argv[0] === 'pnpm' && argv.slice(1).includes('dev') && env.ALLOW_STACK !== '1' &&
//       existsSync(resolve(cwd, 'pnpm-workspace.yaml')),
//     reason: 'start only the services the check needs, not the whole stack from the workspace root',
//   },
export const EXTRA_RULES = [];

const SEP = String.fromCharCode(1); // brackets a placeholder; cannot occur in a typed command
const PH = new RegExp(`${SEP}Q(\\d+)${SEP}`, 'g');
const WRAPPERS = new Set(['!', 'if', 'then', 'else', 'elif', 'while', 'until', 'do', '{']);
// An assignment word: NAME=, NAME+=, NAME[<subscript>]= or NAME[<subscript>]+=.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;
const ASSIGNMENT_PARTS = /^([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?(\+?)=/;
// The value a subscripted assignment gives its name: one the guard cannot resolve.
const UNRESOLVED = '$(...)';
// Programs that run the rest of their line as a command, options dropped (`command -p git`,
// `exec -a name git`, `time -p git`). Short options that take a value (a letter that ends a
// cluster takes the next word; otherwise the rest of the cluster) ...
const WRAPPER_SHORT_VALUE = new Map([
  ['command', ''],
  ['builtin', ''],
  ['exec', 'a'],
  ['time', 'of'],
  ['nohup', ''],
  ['env', 'uCSaP'],
  ['nice', 'n'],
  ['timeout', 'sk'],
  ['sudo', 'ughpCDRrtTU'],
  ['xargs', 'InLPsdEa'],
]);
// ... and long options that take a value as a separate word.
const WRAPPER_LONG_VALUE = new Map([
  ['command', []],
  ['builtin', []],
  ['exec', []],
  ['time', ['--output', '--format']],
  ['nohup', []],
  ['env', ['--unset', '--chdir', '--split-string', '--argv0']],
  ['nice', ['--adjustment']],
  ['timeout', ['--signal', '--kill-after']],
  ['sudo', ['--user', '--group', '--host', '--prompt', '--close-from', '--chdir', '--chroot', '--role', '--type', '--command-timeout', '--other-user']],
  ['xargs', ['--max-args', '--max-lines', '--max-procs', '--max-chars', '--delimiter', '--arg-file']],
]);
const SHELLS = new Set(['bash', 'rbash', 'sh', 'ash', 'dash', 'zsh', 'ksh', 'mksh', 'oksh', 'pdksh', 'yash', 'posh', 'csh', 'tcsh', 'fish']);
// The variables the landing check reads the host from (beside any ZCODE_* name).
const HOST_VARS = new Set(['HARNESS_HOST', 'CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_SANDBOX']);
const isHostVar = (name) => HOST_VARS.has(name) || name.startsWith('ZCODE_');
// The names the guard reads by value (PATH, HUSKY, the GIT_CONFIG_* overrides), and with them the
// names a form it does not read must not change on a line that runs git.
const isValueVar = (name) => name === 'PATH' || name === 'HUSKY' || /^GIT_CONFIG_(?:PARAMETERS|COUNT|(?:KEY|VALUE)_\d+)$/.test(name);
const isGuarded = (name) => name === 'HARNESS_LANDING' || isHostVar(name) || isValueVar(name);
const IDENT = /[A-Za-z0-9_]+/g;
// A word that is a name, NAME= or NAME+= (no subscript): the shapes the guard reads by value.
const READ_SHAPE = /^[A-Za-z_][A-Za-z0-9_]*(?:\+?=|$)/;
// A reference to PATH inside a PATH value: $PATH (not $PATHX) or ${PATH}.
const PATH_REF = /\$PATH(?![A-Za-z0-9_])|\$\{PATH\}/;
// Directories any process may write to: a PATH entry under one can hold a planted node. (NODE_OPTIONS
// and NODE_PATH are not read: the commit guard unsets every NODE_* before it runs node.)
const TEMP_DIRS = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders', '/dev/shm'];
// What a quoted `~`, and a `$` in a string the shell does not expand, become in a PATH value: text.
const LITERAL_TILDE = String.fromCharCode(2);
const LITERAL_DOLLAR = String.fromCharCode(3);
// Subcommands with a no-verify reason of their own; HUSKY=0 on any other is refused after them.
const NO_VERIFY_OWN = new Set(['commit', 'merge', 'pull', 'push']);
// Commands that set or export shell variables by name (export is read, then dropped as a command).
const DECLARATIONS = new Set(['export', 'declare', 'typeset', 'readonly', 'local']);
// What `env -i` (or `--ignore-environment`, or a lone `-`) drops: every variable.
const ALL_VARS = '*';
// The install command's substitution, as the double-quoted word holds it.
const TOPLEVEL = '$(git rev-parse --show-toplevel)';
const GIT_VALUE_OPTIONS = new Set(['--git-dir', '--work-tree', '--namespace', '--super-prefix']);
const COMMIT_VALUE_LONG = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--template', '--author', '--date', '--cleanup', '--trailer', '--pathspec-from-file']);
const COMMIT_VALUE_SHORT = 'mFCct';
const PUSH_VALUE_LONG = new Set(['--repo', '--receive-pack', '--exec', '--push-option']);
// Launches a shell `&` must not detach: the Codex CLI and the harness's run wrappers.
const RUNNERS = new Set(['codex', 'codex-run.mjs', 'claude-run.mjs']);
const SCRIPT_RUNNERS = new Set(['codex-run.mjs', 'claude-run.mjs']);

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
      const body = src.slice(i + 1, j);
      out += hold(body.replace(/\\(["\\$`])/g, '$1'));
      // The shell expands a substitution here; a backslash may have escaped it, so only a string
      // without one is marked.
      if (!body.includes('\\')) quoted.expands?.add(quoted.length - 1);
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
 * The words `env -S` makes of its string, by env's rules (FreeBSD's and GNU's agree), not a shell's:
 * blanks (space, tab, newline, \v, \f, \r) separate words outside quotes; '...' keeps everything but
 * \' and \\; elsewhere \" \' \\ \# \$ \f \n \r \t \v and an escaped blank stand for the character,
 * and \_ is a blank inside "..." and a separator outside; \c, or a word that starts with an unquoted
 * #, ends the string. `;`, `|` and `$(...)` are text, and `${NAME}` stays as written. A string env
 * refuses (an unknown escape, an open quote) is read as far as it goes. Each word comes back masked
 * as the shell's words are: a quoted run, or an escaped character, that holds whitespace is held
 * (`hold`) and the rest stays text, so a VAR= prefix or an option cluster before it is still read.
 */
function envSplit(text, hold) {
  const words = [];
  const mask = (s) => (/\s/.test(s) ? hold(s) : s);
  let word = null; // null between words; a quote starts one, even an empty one
  let quote = null;
  let run = ''; // the open quote's text so far
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'" && c !== "'" && !(c === '\\' && (text[i + 1] === "'" || text[i + 1] === '\\'))) {
      run += c;
    } else if (c === '\\') {
      const e = text[++i];
      if (e === undefined || e === 'c') break;
      if (e === '_' && !quote) {
        if (word !== null) words.push(word);
        word = null;
        continue;
      }
      const ch = e === '_' ? ' ' : ({ f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }[e] ?? e);
      if (quote) run += ch;
      else word = (word ?? '') + mask(ch);
    } else if (c === quote) {
      word += mask(run);
      quote = null;
    } else if (quote) {
      run += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      run = '';
      word ??= '';
    } else if (/[ \t\n\v\f\r]/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
    } else if (c === '#' && word === null) {
      break;
    } else {
      word = (word ?? '') + c;
    }
  }
  if (quote) word += mask(run);
  if (word !== null) words.push(word);
  return words;
}

/**
 * The variables an option word `w` of env drops (`next` is the word after it): the name of
 * `-u NAME`, `-uNAME`, `--unset NAME` or `--unset=NAME` (a long option also by its prefix), and
 * ALL_VARS for `-i` in a cluster, `--ignore-environment` or a lone `-`.
 */
function envDrops(w, next, unq) {
  if (w === '-') return [ALL_VARS];
  if (w.startsWith('--')) {
    const eq = w.indexOf('=');
    const opt = eq === -1 ? w : w.slice(0, eq);
    if (opt.length <= 2) return [];
    if ('--unset'.startsWith(opt)) return [unq((eq === -1 ? next : w.slice(eq + 1)) ?? '')];
    return '--ignore-environment'.startsWith(opt) ? [ALL_VARS] : [];
  }
  const drops = [];
  for (let k = 1; k < w.length; k++) {
    if (w[k] === 'i') drops.push(ALL_VARS);
    if ((WRAPPER_SHORT_VALUE.get('env') ?? '').includes(w[k])) {
      // a value-taking letter ends the options of the cluster: the rest of it, or the next word
      if (w[k] === 'u') drops.push(unq((k === w.length - 1 ? next : w.slice(k + 1)) ?? ''));
      break;
    }
  }
  return drops;
}

/**
 * If words[0] is a wrapper in WRAPPER_SHORT_VALUE (command, exec, time, env, sudo, ...), drop it
 * with its options (and, for env and sudo, VAR=value words, which are appended to `assignments`).
 * `env -S "<string>"` instead puts the words env makes of the string (envSplit) in place of env's
 * options and the string, ahead of the words after it, which stay: the next pass reads them as env
 * does (options, VAR=value words, the command). True when something was dropped. The names env
 * drops (`-u NAME`, `--unset NAME`) are appended to `cleared`, and ALL_VARS for `-i`,
 * `--ignore-environment` or a lone `-`, and for `exec -c`.
 */
function unwrap(words, assignments, unq, hold, cleared) {
  const name = basename(words[0]);
  const shortValue = WRAPPER_SHORT_VALUE.get(name);
  if (shortValue === undefined) return false;
  const longValue = WRAPPER_LONG_VALUE.get(name);
  let i = 1;
  let split = null; // env -S: [the string, the index of the first word after it]
  for (; i < words.length && !split; i++) {
    const w = words[i];
    if (w === '--') {
      i++;
      break;
    }
    if (!w.startsWith('-')) break;
    if (name === 'env') cleared.push(...envDrops(w, words[i + 1], unq));
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const opt = eq === -1 ? w : w.slice(0, eq);
      if (name === 'env' && opt.length > 2 && '--split-string'.startsWith(opt)) {
        split = eq === -1 ? [words[i + 1], i + 2] : [w.slice(eq + 1), i + 1];
      } else if (eq === -1 && opt.length > 2 && longValue.some((o) => o.startsWith(opt))) i++;
      continue;
    }
    for (let k = 1; k < w.length; k++) {
      // `exec -c` runs the command with an empty environment, as `env -i` does.
      if (name === 'exec' && w[k] === 'c') cleared.push(ALL_VARS);
      if (shortValue.includes(w[k])) {
        const last = k === w.length - 1; // otherwise the rest of the cluster is the value
        if (name === 'env' && w[k] === 'S') split = last ? [words[i + 1], i + 2] : [w.slice(k + 1), i + 1];
        else if (last) i++;
        break;
      }
    }
  }
  if (split) {
    const [string, after] = split;
    words.splice(0, after, 'env', ...envSplit(unq(string ?? ''), hold));
    return true;
  }
  // `command -v` and `-V` only look a name up: nothing runs.
  if (name === 'command' && words.slice(1, i).some((w) => /^-[^-]*[vV]/.test(w))) {
    words.length = 0;
    return true;
  }
  if (name === 'timeout') i++; // the duration
  if (name === 'env' || name === 'sudo') {
    for (; i < words.length && ASSIGNMENT.test(words[i]); i++) assignments.push(words[i]);
  }
  words.splice(0, i);
  return true;
}

/**
 * Split masked text on the shell operators into segments, each { text, background, node }:
 * background when its and-or list ends in `&`, or it sits in a ( ), { } or backtick group whose
 * list does. `node` is the pipeline element the segment sits in, in a tree of { parent, subshell }
 * (groups, and-or lists, pipeline elements); `subshell` marks the ones bash runs in a child shell:
 * a ( ) or backtick group, a list that ends in `&`, each element of a pipeline of two or more.
 */
function splitLists(text) {
  const tokens = text.split(/(&&|\|\||[;&|()`\n])/);
  const segments = [];
  const node = (parent, subshell = false) => ({ parent, subshell });
  // Each open group: the token that closes it, the segments of its current and-or list, all of its
  // segments, its node, and the nodes of its current and-or list, pipeline and pipeline element.
  const frame = (close, groupNode) => ({ close, list: [], all: [], node: groupNode, andOr: null, pipe: [], elem: null });
  const stack = [frame(null, node(null, true))];
  const top = () => stack[stack.length - 1];
  const element = () => {
    const f = top();
    f.andOr ??= node(f.node);
    if (!f.elem) f.pipe.push((f.elem = node(f.andOr)));
    return f.elem;
  };
  const endPipe = () => {
    const f = top();
    if (f.pipe.length > 1) for (const e of f.pipe) e.subshell = true;
    f.pipe = [];
    f.elem = null;
  };
  const endList = (background) => {
    if (background) for (const seg of top().list) seg.background = true;
    top().list = [];
    endPipe();
    if (background && top().andOr) top().andOr.subshell = true;
    top().andOr = null;
  };
  const open = (close) => stack.push(frame(close, node(element(), close !== '}')));
  // A closed group is one item of the enclosing and-or list: `( a; b ) &` backgrounds both.
  const shut = () => {
    endList(false);
    const group = stack.pop();
    top().list.push(...group.all);
    top().all.push(...group.all);
  };
  const operator = (t) => {
    if (t === '&') endList(true);
    else if (t === ';' || t === '\n') endList(false);
    else if (t === '(') open(')');
    else if (t === ')') top().close === ')' ? shut() : endList(false);
    else if (t === '`') top().close === '`' ? shut() : open('`');
    else if (t === '|') top().elem = null;
    else endPipe(); // && and || end a pipeline, not the and-or list
  };
  let continued = false; // the last operator was && || or |, with only whitespace since
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i % 2 === 1) {
      if (t === '\n' && continued) continue; // a newline after && || or | continues the list
      continued = t === '&&' || t === '||' || t === '|';
      operator(t);
      continue; // && || and | continue the and-or list
    }
    if (t.trim()) continued = false;
    const first = t.trim().split(/\s+/)[0];
    if (first === '}' && top().close === '}') shut();
    else if (first === '{') open('}');
    const seg = { text: t, background: false, node: element() };
    segments.push(seg);
    top().list.push(seg);
    top().all.push(seg);
  }
  while (stack.length > 1) shut();
  endPipe(); // a pipeline at the end of the line
  return segments;
}

/**
 * The script a shell's -c runs: the first word after its options, which may follow the -c
 * (`bash -c -x '<script>'`, `-c -- '<script>'`); an o or O in a cluster takes the next word
 * (`-o pipefail`, `-co pipefail`), and fish also spells it `--command`. null when there is none.
 */
function shellScript(words, unq) {
  const at = words.findIndex((w) => /^-[A-Za-z]*c[A-Za-z]*$/.test(w) || w === '--command' || w.startsWith('--command='));
  if (at === -1) return null;
  if (words[at].startsWith('--command=')) return unq(words[at].slice('--command='.length));
  const takes = (w) => (/^[-+][A-Za-z]+$/.test(w) ? (w.match(/[oO]/g) ?? []).length : 0);
  let j = at + 1 + takes(words[at]);
  for (; j < words.length && /^[-+]/.test(words[j]); j += 1 + takes(words[j])) {
    if (words[j] === '--' || words[j] === '-') {
      j++;
      break;
    }
  }
  return words[j] ? unq(words[j]) : null;
}

/** The name of an assignment word (NAME=, NAME+=, NAME[i]=) or of a bare NAME. */
const nameOf = (w) => /^[A-Za-z_][A-Za-z0-9_]*/.exec(w)?.[0] ?? w.split('=')[0];

/**
 * True when the shell exports `name`: exported earlier on the line, marked by a bare export with no
 * value yet (`state.bare`), or inherited (`inherited`).
 */
const isExported = (state, name, inherited) => state.exported.some((e) => nameOf(e) === name) || state.bare.has(name) || inherited.has(name);

/**
 * An assignment word `w` as NAME=value. NAME=v stays as written. An append NAME+=v is NAME=<the
 * value the line gave NAME, `known(NAME)`, else ${NAME}>v; PATH keeps ${PATH}, which the composed
 * PATH reads as the value before. A subscripted NAME[i]=v or NAME[i]+=v sets NAME to a value the
 * guard cannot resolve; on a guarded name it is a form the guard does not read (line.forms).
 */
function canonical(w, known, line) {
  const [head, name, subscript, plus] = ASSIGNMENT_PARTS.exec(w);
  if (subscript) {
    if (isGuarded(name)) line.forms.add(name);
    return `${name}=${UNRESOLVED}`;
  }
  if (!plus) return w;
  const before = name === 'PATH' ? undefined : known(name);
  return `${name}=${before ?? `\${${name}}`}${w.slice(head.length)}`;
}

/**
 * Add to `found` each guarded name `word` holds as a whole identifier, except a read ($NAME, or
 * ${NAME...} whose operator is neither = nor :=, ${#NAME} and ${!NAME} too) and, when `skip`, a
 * PATH, HUSKY or GIT_CONFIG_* name that starts the word. With `assignOnly` (the text of an
 * expanding double-quoted string) only ${NAME= and ${NAME:= count. One pass over the word.
 */
function guardedNames(word, found, skip, assignOnly) {
  for (const m of word.matchAll(IDENT)) {
    const name = m[0];
    if (!isGuarded(name) || (skip && m.index === 0 && isValueVar(name))) continue;
    const before = word.slice(Math.max(0, m.index - 3), m.index);
    const after = word.slice(m.index + name.length, m.index + name.length + 2);
    if (/\$\{[#!]$/.test(before)) continue;
    if (before.endsWith('${') ? after[0] !== '=' && after !== ':=' : assignOnly || before.endsWith('$')) continue;
    found.add(name);
  }
}

/**
 * The guarded names the words of a command that is not git name (guardedNames), into line.forms.
 * `exempt` holds the words the guard reads by value: its assignment words, and the operands of a
 * declaration or unset; a placeholder for an expanding double-quoted string is read for ${NAME=.
 */
function collectForms(words, exempt, quoted) {
  const found = quoted.line.forms;
  for (const w of words) {
    guardedNames(w, found, exempt.has(w) && READ_SHAPE.test(w), false);
    for (const [, n] of w.matchAll(PH)) {
      if (quoted.expands?.has(Number(n))) guardedNames(quoted[Number(n)], found, false, true);
    }
  }
}

/**
 * An assignment-only command (`NAME=value`, no program): it sets the shell's plain variables, and
 * changes the exported value of a name the shell already exports.
 */
function assign(state, assignments, inherited) {
  for (const a of assignments) {
    const name = nameOf(a);
    state.vars.set(name, a.slice(name.length + 1));
    if (isExported(state, name, inherited)) state.exported.push(a);
  }
}

/**
 * A declaration command (export, declare, typeset, readonly, local) applied to the shell's state.
 * Each assignment word (canonical) sets the variable. export, and declare or typeset with -x, export
 * every name it names, a bare NAME with the shell's value: the one the line gave it, else, for an
 * inherited name, its own (${NAME}); a name neither assigned nor inherited is marked (`state.bare`)
 * and exported by the first assignment that gives it a value. export -n and declare or typeset +x
 * drop the export. Any other declaration changes the exported value of a name already exported, as
 * an assignment does. Every name named is recorded in line.sets.
 */
function declare(argv, state, line, inherited) {
  const options = argv.slice(1).filter((w) => /^[-+]/.test(w));
  const flag = (sign, ch) => options.some((o) => o[0] === sign && o.slice(1).includes(ch));
  const unexport = argv[0] === 'export' ? flag('-', 'n') : flag('+', 'x');
  const exporting = !unexport && (argv[0] === 'export' || flag('-', 'x'));
  const names = argv.slice(1).filter((w) => ASSIGNMENT.test(w) || /^[A-Za-z_][A-Za-z0-9_]*$/.test(w))
    .map((w) => (w.includes('=') ? canonical(w, (n) => state.vars.get(n), line) : w));
  for (const w of names) {
    line.sets.add(nameOf(w));
    if (w.includes('=')) state.vars.set(nameOf(w), w.slice(w.indexOf('=') + 1));
  }
  if (unexport) {
    const gone = new Set(names.map(nameOf));
    state.exported = state.exported.filter((e) => !gone.has(nameOf(e)));
    for (const name of gone) state.bare.delete(name);
    return;
  }
  const bare = (w) => {
    if (state.vars.has(w)) return `${w}=${state.vars.get(w)}`;
    if (inherited.has(w)) return `${w}=\${${w}}`;
    state.bare.add(w);
    return null;
  };
  const words = exporting
    ? names.map((w) => (w.includes('=') ? w : bare(w))).filter((w) => w !== null)
    : names.filter((w) => w.includes('=') && isExported(state, nameOf(w), inherited));
  state.exported.push(...words);
}

/**
 * The simple commands of `command`. `quoted` is the line's shared parse state: the quoted strings,
 * `expands` (the double-quoted ones the shell expands), `line` ({ sets, unsets, forms }: every
 * variable name the line sets or drops, and every guarded name a form the guard does not read
 * names, at any depth) and `inherited[depth]` (the names the shell at this
 * depth inherits as exported: the hook's own environment, and in a script the shell's or eval's
 * environment too).
 */
function parse(command, cwd, quoted, depth, background) {
  const commands = [];
  const { line } = quoted;
  const inherited = quoted.inherited[depth];
  // A `cd`, an assignment or an `export` changes the shell it runs in: { dir, exported, vars, bare }
  // per subshell node of splitLists' tree, made on first use as a copy of the nearest enclosing
  // subshell's state.
  const states = new Map();
  const stateOf = (n) => {
    while (!n.subshell) n = n.parent;
    if (!states.has(n)) {
      const outer = n.parent ? stateOf(n.parent) : { dir: cwd, exported: [], vars: new Map(), bare: new Set() };
      states.set(n, { dir: outer.dir, exported: [...outer.exported], vars: new Map(outer.vars), bare: new Set(outer.bare) });
    }
    return states.get(n);
  };
  // `2>&1`, `>&2` and `>&file` are dropped before the split on `&` would cut them in two; so are
  // `&>file` and `&>>file` (redirections), and `|&` (a pipe of both streams) becomes `|`.
  const text = maskQuotes(stripHeredocs(command), quoted)
    .replace(/(?<!\d)\d*[<>]&\s*[^\s;&|()<>]*/g, ' ')
    .replace(/(?<!&)&>>?\s*[^\s;&|()<>]*/g, ' ')
    .replace(/\|&/g, '|');
  const unq = (w) => w.replace(PH, (_, n) => quoted[Number(n)]);
  const hold = (content) => `${SEP}Q${quoted.push(content) - 1}${SEP}`;
  // A quoted string without whitespace becomes plain text, so a quoted flag is still a flag. In an
  // assignment word one that holds a `~` or `$` stays held, so a PATH entry knows the shell left it
  // as text (envObject unquotes it).
  const open = (w) => w.replace(PH, (m, n) => {
    const c = quoted[Number(n)];
    if (ASSIGNMENT.test(w) && /[~$]/.test(c ?? '')) return m;
    return c && !/\s/.test(c) && !c.includes(SEP) ? c : m;
  });
  for (const segment of splitLists(text)) {
    // Redirections (with an optional space before the target) are not words. (?<!\d) keeps the
    // scan linear on a long run of digits.
    const words = segment.text.replace(/(?<!\d)\d*(?:>>?|<{1,3})\s*\S*/g, ' ').trim().split(/\s+/).filter(Boolean).map(open);
    const shellWords = [...words]; // as the shell hands them over, wrappers and assignments included
    const env = [];
    const cleared = [];
    let wrapped = false;
    for (;;) {
      if (!words.length) break;
      if (ASSIGNMENT.test(words[0])) env.push(words.shift());
      else if (WRAPPERS.has(words[0])) words.shift();
      else if (unwrap(words, env, unq, hold, cleared)) wrapped = true;
      else break;
    }
    // A guarded name a command that is not git names, in a form the guard does not read; the words
    // env -S made are read too. git's own arguments never set a shell variable.
    if (basename(words[0] ?? '') !== 'git') {
      const operands = DECLARATIONS.has(words[0]) || words[0] === 'unset' ? words.slice(1) : [];
      collectForms(wrapped ? [...shellWords, ...env, ...words] : shellWords, new Set([...env, ...operands]), quoted);
    }
    const state = stateOf(segment.node);
    const given = new Map(); // the values the command's earlier assignment words gave
    for (let k = 0; k < env.length; k++) {
      env[k] = canonical(env[k], (n) => (given.has(n) ? given.get(n) : state.vars.get(n)), line);
      given.set(nameOf(env[k]), env[k].slice(nameOf(env[k]).length + 1));
    }
    for (const a of env) line.sets.add(nameOf(a));
    if (!words.length) {
      // `NAME=value` alone sets the shell's variable; `env NAME=value` alone only prints.
      if (env.length && !wrapped) assign(state, env, inherited);
      continue;
    }
    if (words[0] === 'cd') {
      const target = words.slice(1).find((w) => w !== '--' && w !== '-L' && w !== '-P');
      if (!target) state.dir = homedir();
      else if (target !== '-') state.dir = resolve(state.dir, expand(unq(target)));
      continue;
    }
    if (DECLARATIONS.has(words[0])) {
      declare(words, state, line, inherited);
      if (words[0] === 'export') continue;
    }
    if (words[0] === 'unset') {
      const names = words.slice(1).map(unq).filter((w) => !w.startsWith('-'));
      for (const name of names) {
        line.unsets.add(name);
        state.vars.delete(name);
        state.bare.delete(name);
      }
      state.exported = state.exported.filter((e) => !names.includes(nameOf(e)));
    }
    // The inline assignments come after those exported earlier in this shell, so a later one wins.
    env.unshift(...state.exported);
    const bg = background || segment.background;
    const dir = state.dir;
    const cmd = { argv: words, cwd: dir };
    Object.defineProperty(cmd, 'env', { value: env, enumerable: false });
    Object.defineProperty(cmd, 'background', { value: bg, enumerable: false });
    Object.defineProperty(cmd, 'cleared', { value: cleared, enumerable: false });
    commands.push(cmd);
    if (depth >= 3) continue;
    // `bash -c "<script>"` and `eval "<script>"` run their quoted text as commands.
    let script = null;
    if (SHELLS.has(basename(words[0]))) {
      script = shellScript(words, unq);
    } else if (words[0] === 'eval') {
      script = words.slice(1).map(unq).join(' ');
    }
    if (!script) continue;
    // The script's commands inherit the environment the shell or eval was given (and what it
    // dropped), and its background.
    quoted.inherited[depth + 1] = new Set([...(cleared.includes(ALL_VARS) ? [] : inherited), ...env.map(nameOf)]);
    for (const inner of parse(script, dir, quoted, depth + 1, bg)) {
      inner.env.unshift(...env);
      inner.cleared.unshift(...cleared);
      commands.push(inner);
    }
  }
  return commands;
}

/** Simple commands of a shell command line: [{ argv, cwd }] (env, background and quoted not enumerable). Quoted text is an opaque word. */
export function parseCommands(command, cwd = process.cwd()) {
  const quoted = [];
  Object.assign(quoted, { expands: new Set(), line: { sets: new Set(), unsets: new Set(), forms: new Set() }, inherited: [new Set(Object.keys(process.env))] });
  const commands = parse(String(command ?? ''), cwd, quoted, 0, false);
  // check() needs the quoted values for git options like `-c "core.hooksPath=..."`.
  for (const c of commands) Object.defineProperty(c, 'quoted', { value: quoted, enumerable: false });
  // ... and the variables the whole line sets or drops.
  Object.defineProperty(commands, 'line', { value: quoted.line, enumerable: false });
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
 * A `--` does not end the scan: a value-taking option can take it as its value, and after
 * `git merge -m -- --no-verify` the hook is skipped. After a real `--`, git reads --no-verify as a
 * commit it cannot merge and stops, so refusing that form costs nothing.
 */
function mergeSkipsHooks(rest) {
  for (const t of rest) {
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

/**
 * True when a `git push` argument list asks to skip pre-push: --no-verify, or --no-veri / --no-verif,
 * which git accepts as its abbreviation (--no-ver and shorter are ambiguous with --no-verbose, and
 * git refuses them). -n is --dry-run, which still runs the hook.
 */
function pushSkipsHooks(rest) {
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t === '--') break;
    if (t.startsWith('--')) {
      const name = t.split('=')[0];
      if (name.length >= 9 && '--no-verify'.startsWith(name)) return true;
      if (PUSH_VALUE_LONG.has(name) && !t.includes('=')) j++;
    } else if (/^-[^-]/.test(t) && t.indexOf('o') === t.length - 1) {
      j++; // -o <push-option>: the value is the next word
    }
  }
  return false;
}

/**
 * The name of a variable in the command's resolved environment ({ NAME: value }, a later assignment
 * winning) that can point git's hooks elsewhere, else null.
 * GIT_CONFIG_PARAMETERS is what `git -c` hands its children; nothing an agent runs sets it inline,
 * so any value is refused rather than its quoting read. GIT_CONFIG_KEY_<n> (paired with
 * GIT_CONFIG_COUNT and GIT_CONFIG_VALUE_<n>) is refused when it names core.hooksPath in any case,
 * or when its key is not literal ($VAR, a substitution).
 */
function envOverridesHooks(env) {
  for (const [name, raw] of Object.entries(env)) {
    const value = raw.trim();
    if (name === 'GIT_CONFIG_PARAMETERS') return name;
    if (/^GIT_CONFIG_KEY_\d+$/.test(name) && (/^core\.hookspath$/i.test(value) || /[$`]/.test(value))) return name;
  }
  return null;
}

/**
 * Every value the command's environment gives PATH (exported, then inline), quoted text put back
 * with a quoted `~` marked LITERAL_TILDE and the `$` of a string the shell does not expand marked
 * LITERAL_DOLLAR: the shell expands neither.
 */
function pathValues(cmd) {
  return (cmd.env ?? [])
    .filter((e) => nameOf(e) === 'PATH')
    .map((e) => e.slice('PATH='.length).replace(PH, (_, n) => {
      const text = cmd.quoted[Number(n)].replaceAll('~', LITERAL_TILDE);
      return cmd.quoted.expands?.has(Number(n)) ? text : text.replaceAll('$', LITERAL_DOLLAR);
    }));
}

/**
 * The PATH a command runs with: its environment's PATH values (pathValues) composed in order, each
 * $PATH or ${PATH} in a value standing for the value before it, the inherited PATH first, which
 * stays `$PATH`. Built entry by entry, each entry kept once (the first), so a value that names PATH
 * twice does not double the text.
 */
function composedPath(values) {
  let entries = ['$PATH'];
  for (const value of values) {
    const next = new Set();
    for (const entry of value.split(':')) {
      const parts = entry.split(PATH_REF);
      let current = parts[0];
      for (let k = 1; k < parts.length; k++) {
        if (entries.length === 1) {
          current += entries[0];
        } else {
          next.add(current + entries[0]);
          for (const e of entries.slice(1, -1)) next.add(e);
          current = entries.at(-1);
        }
        current += parts[k];
      }
      next.add(current);
    }
    entries = [...next];
  }
  return entries.join(':');
}

const pathTops = new Map();
/** The real path of the top of the repository `dir` is in, else null: one git call per directory and check. */
function repoTop(dir) {
  if (!pathTops.has(dir)) {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 2000 });
    pathTops.set(dir, r.status === 0 && r.stdout.trim() ? realOr(r.stdout.trim()) : null);
  }
  return pathTops.get(dir);
}

const realOr = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const under = (p, dirs) => dirs.some((d) => p === d || p.startsWith(`${d}/`));

/**
 * The first entry of a PATH value, as written, that could hold a planted node, else null: an empty
 * one (the current directory); one that is relative, a quoted `~` included; one the guard cannot
 * resolve (a substitution, or a variable other than PATH and a leading HOME: `$PWD…` and `$TMPDIR…`
 * among them; HOME too when the line changes it, `homeSet`); one equal to or under a temporary
 * directory; or one inside the repository `cwd` is in. `$PATH` and `${PATH}` themselves pass. The
 * repository is looked up only when an absolute entry gets that far; an entry is compared as
 * written and by its real path.
 */
function plantedEntry(value, cwd, homeSet) {
  for (const entry of value.split(':')) {
    if (entry === '$PATH' || entry === '${PATH}') continue;
    if (entry === '') return '';
    const home = homeSet ? null : /^(?:~|\$HOME|\$\{HOME\})\//.exec(entry);
    const rest = home ? entry.slice(home[0].length - 1) : entry;
    if (/[$`]/.test(rest)) return entry;
    if (/^[^/]/.test(rest)) return entry;
    const homeDir = resolve(homedir());
    const abs = resolve(home ? homeDir + rest : rest);
    const real = realOr(abs);
    // The user's own home is not a temporary directory, even where a test points HOME at one.
    const inHome = Boolean(home) && under(abs, [homeDir]) && under(real, [realOr(homeDir)]);
    if (!inHome && (under(abs, TEMP_DIRS) || under(real, TEMP_DIRS))) return entry;
    const top = repoTop(cwd);
    if (top && (under(abs, [top]) || under(real, [top]))) return entry;
  }
  return null;
}

/**
 * True when argv launches Codex or a harness run wrapper (`codex`, `node scripts/codex-run.mjs`).
 * For node and bun any later word counts, so an option's value (`--title x`, `-r x`) cannot hide it.
 */
function runnerLaunch(argv) {
  const name = basename(argv[0]);
  if (RUNNERS.has(name)) return true;
  if (name !== 'node' && name !== 'bun') return false;
  return argv.slice(1).some((w) => SCRIPT_RUNNERS.has(basename(w)));
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

/**
 * True when `value` (the word `raw` as the shell hands it over) is HOOKS_DIR as an absolute path:
 * the install command's literal "$(git rev-parse --show-toplevel)/<HOOKS_DIR>", where every quoted
 * part of the word is a double-quoted string the shell expands; or an absolute path equal to
 * <top>/<HOOKS_DIR>, <top> being the real path of `git rev-parse --show-toplevel` in `cwd`.
 */
function installPath(value, raw, cwd, quoted, key) {
  const v = value.trim().replace(/\/+$/, '');
  if (v === `${TOPLEVEL}/${key}`) return [...raw.matchAll(PH)].every((m) => quoted.expands?.has(Number(m[1])));
  if (!v.startsWith('/') || /[$`]/.test(v)) return false;
  const r = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 2000 });
  if (r.status !== 0 || !r.stdout.trim()) return false;
  try {
    const want = `${realpathSync(r.stdout.trim())}/${key}`;
    if (v === want) return true;
    return realpathSync(v) === realpathSync(want);
  } catch {
    return false; // a path that does not exist is only the install path when it is literally it
  }
}

/**
 * True when `git config ...` writes or removes core.hooksPath (reads, other keys and HOOKS_DIR, also
 * as an absolute path (installPath), are fine). `cwd` is where the command runs; `quoted` its line's.
 */
function configChangesHooksPath(rest, unq, cwd, quoted) {
  const positionals = [];
  let last = ''; // the word the last positional came from, as written
  let read = false;
  let unset = false;
  let plain = true; // no option other than --local (so not --global, --system, --file, --add, ...)
  for (let j = 0; j < rest.length; j++) {
    const t = unq(rest[j]);
    if (t === '--') {
      positionals.push(...rest.slice(j + 1).map(unq));
      last = rest.at(-1) ?? '';
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
      last = rest[j];
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
  // The documented install command of the commit guard: a plain local set to HOOKS_DIR, or to it as
  // an absolute path.
  const dirKey = (p) => p.trim().replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  return !(plain && positionals.length === 2 && HOOKS_DIR && (dirKey(positionals[1]) === dirKey(HOOKS_DIR) || installPath(positionals[1], last, cwd, quoted, dirKey(HOOKS_DIR))));
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

/** The codex-background hit when a Codex or run-wrapper launch runs in the background, else null. */
function backgroundHit(cmd) {
  if (!cmd.background || !runnerLaunch(cmd.argv)) return null;
  return {
    rule: 'codex-background',
    reason:
      "a `&` launch detaches the run from the session, so the host never reports its exit and a run that died with its shell leaves no verdict. Use the host's own background option (Claude Code: the Bash tool's run_in_background), then count the run only once its ledger row or output file exists.",
  };
}

function builtinRule(cmd, opts) {
  if (basename(cmd.argv[0]) !== 'git') return null;
  const parts = gitParts(cmd);
  const git = parts.sub ? `git ${parts.sub}` : 'git';
  // Every ref move runs the reference-transaction hook, so the hooks-path checks hold on every
  // git subcommand.
  if (parts.config.some((c) => /^core\.hookspath(=|$)/i.test(c.trim()))) {
    return {
      rule: 'hooks-path-override',
      reason: `\`${git}\` with -c core.hooksPath replaces the repository hooks, which bypasses the commit guard. Run it without the override.`,
    };
  }
  // The value git gets for each name: exported first, then inline, a later assignment winning.
  const env = envObject(cmd);
  const overridden = envOverridesHooks(env);
  if (overridden) {
    return {
      rule: 'hooks-path-override',
      reason: `\`${git}\` with ${overridden} set on this line can replace core.hooksPath, which bypasses the commit guard. Run it without the override.`,
    };
  }
  if (parts.sub === 'config' && configChangesHooksPath(parts.rest, parts.unq, parts.cwd, cmd.quoted)) {
    return {
      rule: 'hooks-path-override',
      reason: '`git config core.hooksPath` (set or unset) replaces the repository hooks, which bypasses the commit guard. Leave the setting alone.',
    };
  }
  // husky is off at 0, and at a value the guard cannot resolve ($X, a substitution, ${HUSKY}).
  const huskyOff = env.HUSKY === '0' || /[$`]/.test(env.HUSKY ?? '');
  if (parts.sub === 'commit' && (commitSkipsHooks(parts.rest) || huskyOff)) {
    return {
      rule: 'no-verify',
      reason: '`git commit --no-verify` (or -n, or HUSKY=0) skips the commit guard. Fix what the hook reports, or ask the owner to override.',
    };
  }
  if ((parts.sub === 'merge' || parts.sub === 'pull') && (mergeSkipsHooks(parts.rest) || huskyOff)) {
    return {
      rule: 'no-verify',
      reason: `\`git ${parts.sub} --no-verify\` (or HUSKY=0) skips the pre-merge-commit guard. Fix what the hook reports, or ask the owner to override.`,
    };
  }
  if (parts.sub === 'push' && (pushSkipsHooks(parts.rest) || huskyOff)) {
    return {
      rule: 'no-verify',
      reason: '`git push --no-verify` (or HUSKY=0) skips the pre-push guard. Fix what the hook reports, or ask the owner to override.',
    };
  }
  // husky's stub exits 0 under HUSKY=0 for every hook, reference-transaction included.
  if (huskyOff && !NO_VERIFY_OWN.has(parts.sub)) {
    return {
      rule: 'no-verify',
      reason: `\`${git}\` with HUSKY=0 skips the commit guard's reference-transaction check of every ref it moves. Run it without HUSKY=0, or ask the owner to override.`,
    };
  }
  const host = Object.keys(env).find(isHostVar) ?? cmd.cleared?.find((n) => n === ALL_VARS || isHostVar(n));
  if (host) return HOST_HIT;
  const planted = plantedEntry(composedPath(pathValues(cmd)), parts.cwd, opts.homeSet);
  if (planted !== null) {
    const entry = planted === '' ? '(the current directory)' : planted.replaceAll(LITERAL_TILDE, '~').replaceAll(LITERAL_DOLLAR, '$');
    return {
      rule: 'hooks-path-override',
      reason: `\`${git}\` with a PATH that puts ${entry} first can replace the node the commit guard runs, which bypasses it. Use a directory outside the repository and temporary directories, or run it without the override.`,
    };
  }
  const ff = fastForwardHit(parts, opts.currentBranch);
  if (ff) return ff;
  if (parts.sub === 'push') return pushHit(parts, opts.currentBranch);
  return null;
}

const HOST_HIT = {
  rule: 'host-override',
  reason: 'the landing check reads the host from these variables; an agent never changes them. Ask the owner to merge.',
};

const LANDING_HIT = {
  rule: 'landing-override',
  reason: "HARNESS_LANDING is the owner's override of the landing check; an agent never sets it. Ask the owner to merge.",
};

/**
 * The hit of what the whole line sets or names, at any depth, else null: HARNESS_LANDING set in any
 * form, on any command (landing-override); and on a line that runs a git command, `runsGit`, a
 * guarded name in a form the guard does not read (line.forms; a declaration, assignment, `unset`
 * or `export -n` naming a host variable is one): HARNESS_LANDING (landing-override), a host
 * variable (host-override), PATH or a GIT_CONFIG_* name (hooks-path-override), HUSKY (no-verify).
 * A host variable the line declares, assigns or unsets keeps host-override's reason; a name only
 * named is most often a search pattern or a printed value, so its reason says how to run that.
 * Alone, or before `claude -p`, such a form reaches no landing check.
 */
function lineHit(line, runsGit) {
  // The owner's override of the landing check (harness-guard.sh): an agent that sets it merges
  // past the review it owes, so it is refused on any command, whatever the value.
  if (line?.sets.has('HARNESS_LANDING')) return LANDING_HIT;
  const forms = runsGit ? [...(line?.forms ?? [])] : [];
  const name = forms.find((n) => n === 'HARNESS_LANDING') ?? forms.find(isHostVar) ?? forms.find(isValueVar);
  if (!name) return null;
  if (isHostVar(name) && (line.sets.has(name) || line.unsets.has(name))) return HOST_HIT;
  const rule = name === 'HARNESS_LANDING' ? 'landing-override'
    : isHostVar(name) ? 'host-override'
    : name === 'HUSKY' ? 'no-verify' : 'hooks-path-override';
  return {
    rule,
    reason: `\`${name}\` is named by another command on a line that runs git, and the guard cannot tell a search or a printed value from a change to it. Run that command and git as separate commands; an agent never changes \`${name}\`.`,
  };
}

// git merge options that take the next word as their value (a short one also takes the rest of its cluster).
const MERGE_VALUE_LONG = new Set(['--message', '--file', '--strategy', '--strategy-option', '--cleanup', '--into-name']);
const MERGE_VALUE_SHORT = 'mFsX';
// git pull options that take the next word as their value, beside the merge ones.
const PULL_VALUE_LONG = new Set([...MERGE_VALUE_LONG, '--upload-pack', '--server-option', '--depth', '--deepen', '--shallow-since', '--shallow-exclude', '--jobs', '--negotiation-tip', '--refmap']);
const PULL_VALUE_SHORT = 'mFsXoj';

/** A merge or pull argument list → { options, positionals }; a value-taking option's value is neither. */
function mergeWords(rest, valueLong, valueShort) {
  const options = [];
  const positionals = [];
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t === '--') {
      positionals.push(...rest.slice(j + 1));
      break;
    }
    if (t.startsWith('--')) {
      options.push(t);
      if (valueLong.has(t)) j++;
    } else if (/^-[^-]/.test(t)) {
      options.push(t);
      for (const [k, ch] of [...t.slice(1)].entries()) {
        if (ch === 'S') break; // -S<keyid>: the rest of the cluster is its key
        if (!valueShort.includes(ch)) continue;
        if (k === t.length - 2) j++; // the letter ends the cluster, so its value is the next word
        break;
      }
    } else {
      positionals.push(t);
    }
  }
  return { options, positionals };
}

/**
 * { rule, reason } when a `git merge` onto a MAINLINE branch could fast-forward, or a `git pull .`
 * merges a local branch there, else null. A fast-forward writes no commit, so neither pre-commit nor
 * pre-merge-commit runs and the landing check never reads what lands. A merge with --no-ff (and no
 * --ff or --ff-only after it), --abort / --continue / --quit, a --squash (its commit runs pre-commit)
 * and a merge of the remote mainline alone (`origin/main`, `@{u}`: content the remote holds) pass.
 */
function fastForwardHit(parts, currentBranch) {
  if (parts.sub !== 'merge' && parts.sub !== 'pull') return null;
  const branch = currentBranch ?? branchOf(parts.cwd);
  if (!branch || !MAINLINE.includes(branch)) return null;
  const hit = {
    rule: 'merge-ff-mainline',
    reason: `a fast-forward into ${branch} runs no hook, so the landing check never reads it. Merge with --no-ff.`,
  };
  if (parts.sub === 'pull') {
    // a pull from the local repository is a local merge
    const { positionals } = mergeWords(parts.rest.map(parts.unq), PULL_VALUE_LONG, PULL_VALUE_SHORT);
    return positionals[0] === '.' ? hit : null;
  }
  const { options, positionals } = mergeWords(parts.rest.map(parts.unq), MERGE_VALUE_LONG, MERGE_VALUE_SHORT);
  if (options.some((o) => o === '--abort' || o === '--continue' || o === '--quit' || o === '--squash')) return null;
  const noFf = options.lastIndexOf('--no-ff');
  if (noFf !== -1 && !options.slice(noFf + 1).some((o) => o === '--ff' || o === '--ff-only')) return null;
  const remoteMainline = (a) => a === '@{u}' || a === '@{upstream}' || MAINLINE.some((m) => new RegExp(`^[^/\\s]+/${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(a));
  if (positionals.every(remoteMainline)) return null;
  return hit;
}

/** A command's environment as { NAME: value }, values unquoted; a later assignment wins. */
function envObject(cmd) {
  const env = {};
  for (const e of cmd.env ?? []) {
    const at = e.indexOf('=');
    env[e.slice(0, at)] = e.slice(at + 1).replace(PH, (_, n) => cmd.quoted[Number(n)]);
  }
  return env;
}

/** null when the command is allowed, else { rule, reason }. */
export function check(command, { cwd = process.cwd(), currentBranch } = {}) {
  branchCache.clear();
  pathTops.clear();
  const commands = parseCommands(command, cwd);
  const runsGit = commands.some((c) => basename(c.argv[0]) === 'git');
  const settings = lineHit(commands.line, runsGit);
  if (settings) return settings;
  // A line that changes HOME leaves `$HOME` and `~` in a PATH entry unresolvable.
  const homeSet = commands.line.sets.has('HOME') || commands.line.unsets.has('HOME');
  for (const cmd of commands) {
    const hit = backgroundHit(cmd) ?? builtinRule(cmd, { currentBranch, homeSet });
    if (hit) return hit;
    for (const extra of EXTRA_RULES) {
      let matched = false;
      try {
        matched = Boolean(extra.test({ argv: cmd.argv, cwd: cmd.cwd, env: envObject(cmd), background: cmd.background }));
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
