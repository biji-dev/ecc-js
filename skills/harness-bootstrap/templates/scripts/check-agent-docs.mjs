#!/usr/bin/env node
// harness-bootstrap check-agent-docs (generated YYYY-MM-DD). Verify gate for the shared agent instruction files.
// [M] mechanism (ship as-is): everything below the CONFIG block - the eight checks, the glob matcher,
//     `--rules-for` and `--json`.
// [B] binding (re-derived per project): the CONFIG block only. Generation sets each budget to the
//     file's current size rounded up, so a budget is a ratchet: a check fails only ABOVE it.
//
// Checks (all run; every failure is reported; exit 1 if any failed):
//   import       CLAUDE.md's first non-blank line is `@AGENTS.md`
//   budget       byte size of AGENTS.md, CLAUDE.md, rule files, state files; line count of each SKILL.md
//   rule-paths   each rule file has a non-empty `paths:` list and every glob matches a file in the repo
//   rule-index   rule files and the index in `indexFile` agree both ways
//   links        relative markdown links resolve (a gitignored target counts as present)
//   paths        backticked repo paths exist on disk (a gitignored path counts as present)
//   frontmatter  skills and agents carry valid frontmatter; read-only agents hold no write tools
//   secrets      no credential-shaped strings in the instruction files
//
// `--rules-for <file...>` prints the rule files whose `paths:` globs match the given paths and exits 0.
// `--json` prints {ok, failures:[{check, file, line, detail}]} instead of text.
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, normalize, relative, isAbsolute, sep } from 'node:path';

// ---- [B] binding: re-derive per project -------------------------------------------------------
export const CONFIG = {
  // Bytes (files) and lines (skillLines). Set to the current size rounded up at generation time.
  budgets: { 'AGENTS.md': 40960, 'CLAUDE.md': 8192, rule: 16384, skillLines: 500, stateFile: 8192 },
  rulesDir: '.claude/rules',
  indexFile: 'AGENTS.md', // holds the area-rules index
  skillDirs: ['.claude/skills', '.agents/skills'],
  agentDirs: ['.claude/agents'],
  statePattern: 'docs/plans/**/*.state.md',
  pathPrefixes: ['src/', 'apps/', 'packages/', 'lib/', 'docs/', 'scripts/', '.claude/', '.agents/'],
  intentionallyAbsent: [], // backticked paths cited as deliberately absent
  requireImport: true, // CLAUDE.md line 1 must be @AGENTS.md
};
// ---- [M] mechanism: ship as-is ----------------------------------------------------------------

// ---- glob matcher: `**` (any depth), `*`, `?`, `[abc]`, `[a-z]`, `[!abc]`, `{a,b}`; no extglob -----
// `*`, `?` and a class match within one path segment: none of them ever matches `/`.
function escapeRegex(char) {
  return /[\\^$.*+?()[\]{}|/]/.test(char) ? `\\${char}` : char;
}

function expandBraces(pattern) {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];
  const close = pattern.indexOf('}', open);
  if (close === -1) return [pattern];
  const head = pattern.slice(0, open);
  const tail = pattern.slice(close + 1);
  return pattern
    .slice(open + 1, close)
    .split(',')
    .flatMap((option) => expandBraces(`${head}${option}${tail}`));
}

/** A `[...]` / `[!...]` class starting at `start`: {source, end} (index of the `]`), or null when not a class. */
function parseClass(pattern, start) {
  let j = start + 1;
  const negated = pattern[j] === '!' || pattern[j] === '^';
  if (negated) j += 1;
  const bodyStart = j;
  if (pattern[j] === ']') j += 1; // a leading `]` is a literal member
  const end = pattern.indexOf(']', j);
  if (end === -1) return null;
  const body = pattern.slice(bodyStart, end).replace(/[\\[\]^]/g, '\\$&');
  const source = negated ? `[^/${body}]` : `(?!/)[${body}]`;
  try {
    new RegExp(source);
  } catch {
    return null; // e.g. a reversed range: treat the `[` as a literal character
  }
  return { source, end };
}

function toRegexSource(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const cls = char === '[' ? parseClass(pattern, i) : null;
    if (cls) {
      source += cls.source;
      i = cls.end;
    } else if (char === '*' && pattern[i + 1] === '*') {
      const slashAfter = pattern[i + 2] === '/';
      source += slashAfter ? '(?:.*/)?' : '.*';
      i += slashAfter ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegex(char);
    }
  }
  return source;
}

export function globToRegExp(pattern) {
  const normalized = String(pattern).replace(/\\/g, '/').replace(/^\.\//, '');
  const alternatives = expandBraces(normalized).map(toRegexSource);
  return new RegExp(`^(?:${alternatives.join('|')})$`);
}

export function matchGlob(filePath, glob) {
  return globToRegExp(glob).test(String(filePath).replace(/\\/g, '/'));
}

// ---- text helpers -------------------------------------------------------------------------------
const FM = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

/** Parsed top-level frontmatter keys, or null when the file has none. */
function frontmatter(text) {
  const m = text.match(FM);
  if (!m) return null;
  const fields = new Map();
  let cur = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (kv) {
      cur = { value: kv[2].trim(), extra: [] };
      fields.set(kv[1], cur);
    } else if (cur && /^\s+\S/.test(line)) {
      cur.extra.push(line.trim());
    }
  }
  return { fields, body: text.slice(m[0].length) };
}

/**
 * Does the text claim read-only? Each `read-only` counts unless the 20 characters before it end in a negation
 * ("not", "isn't", "is not", "never", "no longer", optionally followed by "be"): "so you are not read-only" is no claim.
 */
export function claimsReadOnly(text) {
  for (const m of String(text).matchAll(/\bread-only\b/gi)) {
    const before = text.slice(Math.max(0, m.index - 20), m.index);
    if (!/\b(not|isn't|is not|never|no longer)\s+(be\s+)?$/i.test(before)) return true;
  }
  return false;
}

const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

/** The `paths:` globs of a rule file, or null when it has no frontmatter. */
export function parsePaths(text) {
  const fm = frontmatter(text);
  if (!fm) return null;
  const field = fm.fields.get('paths');
  if (!field) return [];
  const out = [];
  const inline = field.value.match(/^\[(.*)\]$/);
  if (inline) {
    for (const part of inline[1].split(/,(?![^{]*\})/)) if (unquote(part)) out.push(unquote(part));
  } else if (field.value !== '') {
    out.push(unquote(field.value));
  }
  for (const line of field.extra) {
    const item = line.match(/^-\s+(.+)$/);
    if (item && unquote(item[1])) out.push(unquote(item[1]));
  }
  return out;
}

/** Lines of a markdown file with frontmatter and fenced code blocks blanked (line numbers kept). */
function proseLines(text) {
  const lines = text.split('\n');
  const fmMatch = text.match(FM);
  const fmLines = fmMatch ? fmMatch[0].split('\n').length - 1 : 0;
  let fenced = false;
  return lines.map((line, i) => {
    if (i < fmLines) return '';
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return '';
    }
    return fenced ? '' : line;
  });
}

// ---- main ---------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const rulesForAt = args.indexOf('--rules-for');

const failures = [];
let checks = 0;

// Credential-shaped strings. Any value that matches is masked in every message, whichever check quotes it.
const SECRET_PATTERNS = [
  // `\\?['"]?`: the value may open with a quote, or with a JSON-escaped one (\") when the text was stringified.
  ['credential assignment', /(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*\\?['"]?[A-Za-z0-9_\-/+]{12,}/i],
  ['AWS access key id', /AKIA[0-9A-Z]{16}/],
  ['API key (sk-)', /(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}/], // not inside a word: `task-<20 letters>` is a name
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const mask = (text) =>
  SECRET_PATTERNS.reduce((s, [, re]) => s.replace(new RegExp(re.source, `${re.flags}g`), '[masked]'), String(text));

function finish() {
  // Every result passes through here, so no check can quote a secret into text or JSON output.
  const shown = failures.map((f) => ({ ...f, file: mask(f.file), detail: mask(f.detail) }));
  if (wantJson) {
    console.log(JSON.stringify({ ok: shown.length === 0, failures: shown }, null, 2));
  } else if (shown.length) {
    for (const f of shown) {
      const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''} ` : '';
      console.error(`FAIL ${f.check}: ${where}${f.detail}`);
    }
  } else {
    console.log(`check-agent-docs: OK (${checks} checks)`);
  }
  process.exitCode = failures.length ? 1 : 0;
}

let ROOT;
try {
  ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  if (rulesForAt !== -1) {
    process.exitCode = 0;
  } else {
    failures.push({ check: 'root', file: '', line: 0, detail: 'not inside a git repository' });
    finish();
  }
}

if (ROOT) main();

function main() {
  const abs = (p) => join(ROOT, p);
  const exists = (p) => existsSync(abs(p));
  const isFile = (p) => {
    try {
      return statSync(abs(p)).isFile(); // follows symlinks; a dangling one throws
    } catch {
      return false;
    }
  };
  const read = (p) => readFileSync(abs(p), 'utf8').replace(/\r\n/g, '\n');
  const size = (p) => statSync(abs(p)).size;
  const fail = (check, file, line, detail) => failures.push({ check, file, line: line || 0, detail });
  const verify = (cond, check, file, line, detail) => {
    checks += 1;
    if (!cond) fail(check, file, line, detail);
  };

  // On disk and in the index or untracked-but-not-ignored: a file deleted but not yet staged
  // still shows in the index, and a new file is not in it until `git add`.
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((f) => f && exists(f));

  /** Of the repo-relative `candidates`, those git ignores. On any git error: none (every absent path then fails). */
  function gitIgnored(candidates) {
    const inside = [...new Set(candidates)].filter((p) => p && p !== '..' && !p.startsWith('../') && !isAbsolute(p));
    if (inside.length === 0) return new Set();
    try {
      const out = execFileSync('git', ['check-ignore', '--stdin', '-z'], {
        cwd: ROOT,
        input: `${inside.join('\0')}\0`,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      });
      return new Set(out.split('\0').filter(Boolean));
    } catch {
      return new Set(); // exit 1 = nothing ignored; anything else = git failed: keep today's behaviour
    }
  }

  const listMd = (dir, filter) =>
    existsSync(abs(dir))
      ? readdirSync(abs(dir))
          .filter(filter)
          .sort()
          .map((f) => `${dir}/${f}`)
          .filter(isFile)
      : [];

  const ruleDirExists = existsSync(abs(CONFIG.rulesDir));
  const ruleFiles = listMd(CONFIG.rulesDir, (f) => f.endsWith('.md'));
  const skillFiles = CONFIG.skillDirs.flatMap((dir) =>
    existsSync(abs(dir))
      ? readdirSync(abs(dir))
          .sort()
          .map((d) => `${dir}/${d}/SKILL.md`)
          .filter(isFile)
      : [],
  );
  const agentFiles = CONFIG.agentDirs.flatMap((dir) => listMd(dir, (f) => f.endsWith('.md')));
  const stateFiles = files.filter((f) => matchGlob(f, CONFIG.statePattern));
  const topFiles = ['AGENTS.md', 'CLAUDE.md'].filter(isFile);
  const docFiles = [...topFiles, ...ruleFiles, ...skillFiles, ...agentFiles];

  // `--rules-for <file...>`: rule files that apply to the given paths, then exit.
  if (rulesForAt !== -1) {
    const real = (p) => {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    };
    const realRoot = real(ROOT);
    const targets = args
      .slice(rulesForAt + 1)
      .filter((a) => a && !a.startsWith('--'))
      .map((a) => {
        const rel = isAbsolute(a) ? relative(realRoot, real(a)) : normalize(a);
        return rel.split(sep).join('/').replace(/^\.\//, '');
      })
      .filter((t) => t && !t.startsWith('../') && t !== '..');
    for (const f of ruleFiles) {
      const globs = parsePaths(read(f)) ?? [];
      if (targets.some((t) => globs.some((g) => matchGlob(t, g)))) console.log(f);
    }
    return;
  }

  // 1. import
  if (CONFIG.requireImport && isFile('AGENTS.md') && isFile('CLAUDE.md')) {
    const first = read('CLAUDE.md')
      .split('\n')
      .find((l) => l.trim() !== '');
    verify(
      first?.trim() === '@AGENTS.md',
      'import',
      'CLAUDE.md',
      1,
      // Mask the raw line before quoting it: JSON.stringify would turn a value's quotes into \" first.
      `must open with the line "@AGENTS.md" (found: ${JSON.stringify(mask(first ?? ''))})`,
    );
  }

  // 2. budget
  for (const f of topFiles) {
    const limit = CONFIG.budgets[f];
    if (limit === undefined) continue;
    const n = size(f);
    verify(n <= limit, 'budget', f, 0, `${n} bytes, budget ${limit} - move content into path-scoped rules`);
  }
  for (const f of ruleFiles) {
    const n = size(f);
    verify(n <= CONFIG.budgets.rule, 'budget', f, 0, `${n} bytes, budget ${CONFIG.budgets.rule} - split or trim it`);
  }
  for (const f of stateFiles) {
    const n = size(f);
    verify(
      n <= CONFIG.budgets.stateFile,
      'budget',
      f,
      0,
      `${n} bytes, budget ${CONFIG.budgets.stateFile} - archive finished entries`,
    );
  }
  for (const f of skillFiles) {
    const n = read(f).replace(/\n$/, '').split('\n').length;
    verify(
      n <= CONFIG.budgets.skillLines,
      'budget',
      f,
      0,
      `${n} lines, budget ${CONFIG.budgets.skillLines} - move detail into reference files`,
    );
  }

  // 3. rule-paths
  const ruleNames = new Set();
  for (const f of ruleFiles) {
    ruleNames.add(f.slice(CONFIG.rulesDir.length + 1));
    const globs = parsePaths(read(f));
    const hasPaths = Boolean(globs && globs.length > 0);
    verify(
      hasPaths,
      'rule-paths',
      f,
      0,
      'has no non-empty `paths:` frontmatter list - an unscoped rule loads in every session',
    );
    if (!hasPaths) continue;
    for (const glob of globs) {
      verify(
        files.some((t) => matchGlob(t, glob)),
        'rule-paths',
        f,
        0,
        `glob \`${glob}\` matches no file in the repo - the rule never loads for it`,
      );
    }
  }

  // 4. rule-index
  // The index is the markdown section (its heading up to the next heading of the same or a higher level)
  // that holds the first bullet naming an existing rule file. Bullets elsewhere (a "key docs" list) are not
  // part of it. With no such bullet there is no index section: every rule file is missing, no extras.
  const indexExists = isFile(CONFIG.indexFile);
  if (ruleDirExists && indexExists) {
    const lines = proseLines(read(CONFIG.indexFile));
    const bulletOf = (line) => line.match(/^[ \t]*[-*] `([^`/]+\.md)`[ \t]*(?:—|–|-|:)(?:\s|$)/)?.[1];
    const levelOf = (line) => line.match(/^ {0,3}(#{1,6})(?:[ \t]|$)/)?.[1].length ?? 0;
    const first = lines.findIndex((l) => ruleNames.has(bulletOf(l) ?? ''));
    const indexed = new Set();
    if (first !== -1) {
      let start = first;
      while (start > 0 && !levelOf(lines[start])) start -= 1;
      const level = levelOf(lines[start]) || 7; // no heading above: the section ends at the first heading
      let end = first + 1;
      while (end < lines.length && !(levelOf(lines[end]) && levelOf(lines[end]) <= level)) end += 1;
      for (const l of lines.slice(start, end)) if (bulletOf(l)) indexed.add(bulletOf(l));
    }
    for (const n of ruleNames) {
      verify(
        indexed.has(n),
        'rule-index',
        CONFIG.indexFile,
        0,
        `${CONFIG.rulesDir}/${n} is missing from the rules index - add a line like: - \`${n}\` — what it covers`,
      );
    }
    for (const n of indexed) {
      verify(
        ruleNames.has(n),
        'rule-index',
        CONFIG.indexFile,
        0,
        `indexes ${n}, which does not exist in ${CONFIG.rulesDir}/`,
      );
    }
  }

  // 5. links and 6. paths cite files that may be gitignored (a registry kept out of the repo by design): a cited
  // path that is absent but ignored passes. Candidates are collected first so git is asked once per run.
  const refs = [];
  const ref = (check, file, line, p, detail) => refs.push({ check, file, line, p, detail });

  // 5. links
  for (const f of docFiles) {
    proseLines(read(f)).forEach((line, i) => {
      const noCode = line.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length));
      for (const m of noCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1].split('#')[0];
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // anchor, http:, mailto:
        let decoded = target;
        try {
          decoded = decodeURI(target);
        } catch {
          // keep the raw target
        }
        const resolved = decoded.startsWith('/') ? normalize(decoded.slice(1)) : normalize(join(dirname(f), decoded));
        ref('links', f, i + 1, resolved, `link target \`${target}\` does not exist`);
      }
    });
  }

  // 6. paths
  const absent = new Set(CONFIG.intentionallyAbsent);
  for (const f of docFiles) {
    proseLines(read(f)).forEach((line, i) => {
      for (const m of line.matchAll(/`([^`\n]+)`/g)) {
        const span = m[1].trim().replace(/[:,;.]+$/, '');
        if (!CONFIG.pathPrefixes.some((p) => span.startsWith(p))) continue;
        if (/\s/.test(span) || /[*?[{]/.test(span) || /<[^>]*>/.test(span)) continue;
        const p = span.replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '').replace(/\/$/, '');
        if (absent.has(p) || absent.has(span)) continue;
        ref('paths', f, i + 1, p, `\`${span}\` does not exist - fix the path or say what replaced it`);
      }
    });
  }
  const ignored = gitIgnored(refs.filter((r) => !exists(r.p)).map((r) => r.p));
  for (const r of refs) verify(exists(r.p) || ignored.has(r.p), r.check, r.file, r.line, r.detail);

  // 7. frontmatter
  const WRITE_TOOLS = /\b(Bash|Edit|Write|NotebookEdit)\b/g;
  const fieldText = (field) => (field ? [field.value, ...field.extra].join(' ') : '');
  for (const f of [...skillFiles, ...agentFiles]) {
    const isAgent = agentFiles.includes(f);
    const fm = frontmatter(read(f));
    verify(Boolean(fm), 'frontmatter', f, 1, 'has no frontmatter');
    if (!fm) continue;
    for (const key of ['name', 'description']) {
      const field = fm.fields.get(key);
      verify(
        Boolean(field && (field.value !== '' || field.extra.length > 0)),
        'frontmatter',
        f,
        0,
        `missing \`${key}\``,
      );
    }
    const desc = fm.fields.get('description');
    if (desc && desc.value !== '' && !/^['"|>]/.test(desc.value)) {
      // An unquoted ": " or " #" opens a second YAML mapping or a comment: strict parsers drop the file.
      verify(
        !/: |\s#/.test(desc.value),
        'frontmatter',
        f,
        0,
        'plain `description` contains ": " or " #" - quote the value',
      );
    }
    if (isAgent) {
      const tools = fm.fields.get('tools');
      verify(Boolean(tools), 'frontmatter', f, 0, 'agent is missing `tools:`');
      if (tools && claimsReadOnly(`${fieldText(desc)}\n${fm.body}`)) {
        const held = [...new Set(fieldText(tools).match(WRITE_TOOLS) ?? [])];
        verify(
          held.length === 0,
          'frontmatter',
          f,
          0,
          `agent says "read-only" but lists ${held.join(', ')} in \`tools\``,
        );
      }
    }
  }

  // 8. secrets (values are never printed)
  for (const f of docFiles) {
    const lines = read(f).split('\n');
    const hits = [];
    lines.forEach((line, i) => {
      for (const [name, re] of SECRET_PATTERNS) if (re.test(line)) hits.push([i + 1, name]);
    });
    checks += 1;
    for (const [line, name] of hits) {
      fail('secrets', f, line, `looks like a secret (${name}); value masked`);
    }
  }
}

if (ROOT && rulesForAt === -1) finish();
