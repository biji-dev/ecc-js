#!/usr/bin/env node
// harness-bootstrap command-guard hook (generated YYYY-MM-DD). Claude Code, PreToolUse(Bash).
// [M] mechanism (ship as-is): the command parser and the built-in rules - no-verify (commit
//   --no-verify / -n, push --no-verify, merge/pull --no-verify; also HUSKY=0), hooks-path-override
//   (-c core.hooksPath, git config core.hooksPath, and on a hook-running subcommand an inline
//   GIT_CONFIG_PARAMETERS or GIT_CONFIG_KEY_<n>=core.hooksPath), force-push-mainline,
//   delete-mainline, codex-background (a codex, codex-run.mjs or claude-run.mjs launch, or node or
//   bun with either script in any later word, sent to the background with a shell `&`). [B]
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
// `export VAR=value` earlier in the same shell (not past a `( ... )`, a backtick, a pipeline or a
// backgrounded list: each runs in a subshell), and, inside a `bash -c` or `eval` script, the
// shell's own; a later assignment wins. A command runs in the background when its and-or list
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
// settings made in an earlier Bash call (export HUSKY=0, GIT_CONFIG_* variables), or on this line
// by `declare -x`, `typeset -x` or `set -a`, are not tracked; an assignment whose value is an
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
// unresolved `$VAR` target is allowed, a force push's is not).
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
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
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
const HOOK_SUBCOMMANDS = new Set(['commit', 'merge', 'pull', 'push', 'rebase', 'am']);
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
 * If words[0] is a wrapper in WRAPPER_SHORT_VALUE (command, exec, time, env, sudo, ...), drop it
 * with its options (and, for env and sudo, VAR=value words, which are appended to `assignments`).
 * `env -S "<string>"` instead puts the words env makes of the string (envSplit) in place of env's
 * options and the string, ahead of the words after it, which stay: the next pass reads them as env
 * does (options, VAR=value words, the command). True when something was dropped.
 */
function unwrap(words, assignments, unq, hold) {
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
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const opt = eq === -1 ? w : w.slice(0, eq);
      if (name === 'env' && opt.length > 2 && '--split-string'.startsWith(opt)) {
        split = eq === -1 ? [words[i + 1], i + 2] : [w.slice(eq + 1), i + 1];
      } else if (eq === -1 && opt.length > 2 && longValue.some((o) => o.startsWith(opt))) i++;
      continue;
    }
    for (let k = 1; k < w.length; k++) {
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

function parse(command, cwd, quoted, depth, background) {
  const commands = [];
  // A `cd` or `export VAR=value` changes the shell it runs in: { dir, exported } per subshell node
  // of splitLists' tree, made on first use as a copy of the nearest enclosing subshell's state.
  const states = new Map();
  const stateOf = (n) => {
    while (!n.subshell) n = n.parent;
    if (!states.has(n)) {
      const outer = n.parent ? stateOf(n.parent) : { dir: cwd, exported: [] };
      states.set(n, { dir: outer.dir, exported: [...outer.exported] });
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
  // A quoted string without whitespace becomes plain text, so a quoted flag is still a flag.
  const open = (w) => w.replace(PH, (m, n) => {
    const c = quoted[Number(n)];
    return c && !/\s/.test(c) && !c.includes(SEP) ? c : m;
  });
  for (const segment of splitLists(text)) {
    // Redirections (with an optional space before the target) are not words. (?<!\d) keeps the
    // scan linear on a long run of digits.
    const words = segment.text.replace(/(?<!\d)\d*(?:>>?|<{1,3})\s*\S*/g, ' ').trim().split(/\s+/).filter(Boolean).map(open);
    const env = [];
    for (;;) {
      if (!words.length) break;
      if (ASSIGNMENT.test(words[0])) env.push(words.shift());
      else if (WRAPPERS.has(words[0])) words.shift();
      else if (!unwrap(words, env, unq, hold)) break;
    }
    if (!words.length) continue;
    const state = stateOf(segment.node);
    if (words[0] === 'cd') {
      const target = words.slice(1).find((w) => w !== '--' && w !== '-L' && w !== '-P');
      if (!target) state.dir = homedir();
      else if (target !== '-') state.dir = resolve(state.dir, expand(unq(target)));
      continue;
    }
    if (words[0] === 'export') {
      state.exported.push(...words.slice(1).filter((w) => ASSIGNMENT.test(w)));
      continue;
    }
    // The inline assignments come after those exported earlier in this shell, so a later one wins.
    env.unshift(...state.exported);
    const bg = background || segment.background;
    const dir = state.dir;
    const cmd = { argv: words, cwd: dir };
    Object.defineProperty(cmd, 'env', { value: env, enumerable: false });
    Object.defineProperty(cmd, 'background', { value: bg, enumerable: false });
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
    // The script's commands inherit the environment the shell or eval was given, and its background.
    for (const inner of parse(script, dir, quoted, depth + 1, bg)) {
      inner.env.unshift(...env);
      commands.push(inner);
    }
  }
  return commands;
}

/** Simple commands of a shell command line: [{ argv, cwd }] (env, background and quoted not enumerable). Quoted text is an opaque word. */
export function parseCommands(command, cwd = process.cwd()) {
  const quoted = [];
  const commands = parse(String(command ?? ''), cwd, quoted, 0, false);
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
  if (parts.config.some((c) => /^core\.hookspath(=|$)/i.test(c.trim())) && HOOK_SUBCOMMANDS.has(parts.sub)) {
    return {
      rule: 'hooks-path-override',
      reason: `\`git ${parts.sub}\` with -c core.hooksPath replaces the repository hooks, which bypasses the commit guard. Run it without the override.`,
    };
  }
  // The value git gets for each name: exported first, then inline, a later assignment winning.
  const env = envObject(cmd);
  const overridden = HOOK_SUBCOMMANDS.has(parts.sub) ? envOverridesHooks(env) : null;
  if (overridden) {
    return {
      rule: 'hooks-path-override',
      reason: `\`git ${parts.sub}\` with ${overridden} set on this line can replace core.hooksPath, which bypasses the commit guard. Run it without the override.`,
    };
  }
  if (parts.sub === 'config' && configChangesHooksPath(parts.rest, parts.unq)) {
    return {
      rule: 'hooks-path-override',
      reason: '`git config core.hooksPath` (set or unset) replaces the repository hooks, which bypasses the commit guard. Leave the setting alone.',
    };
  }
  const huskyOff = env.HUSKY === '0';
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
  if (parts.sub === 'push') return pushHit(parts, opts.currentBranch);
  return null;
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
  for (const cmd of parseCommands(command, cwd)) {
    const hit = backgroundHit(cmd) ?? builtinRule(cmd, { currentBranch });
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
