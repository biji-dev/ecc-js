#!/usr/bin/env node
// harness-bootstrap harness-status (generated 2026-10-19)
// [M] mechanism: this whole file ships as-is. It has no [B] binding lines; it reads
// the target repository and never writes anything.
//
// Usage:
//   node harness-status.js <repo>                 JSON report on stdout
//   node harness-status.js <repo> --text          human-readable report
//   node harness-status.js <repo> --hash <spec>.. sha256 lines, spec = path or path#block
// Exit 0 on success, 2 on bad arguments or a missing path/block.
//
// Read-only: the only commands run are `git rev-parse --show-toplevel`,
// `git rev-parse --git-path hooks` (finds the hooks directory of a linked worktree, a
// submodule, or a core.hooksPath, including a relative or ~/ path) and
// `git check-ignore -q` (a gitignored scaffold that is absent reads `ignored`). This is an
// accepted deviation from "git config --get / ls-files only": none of them writes, every
// inherited GIT_* variable is removed (a git hook's GIT_DIR must not redirect the lookup) and
// GIT_OPTIONAL_LOCKS=0 is set so no git command refreshes the index. When git fails, or
// <repo> is not itself a repository top level, the hooks directory falls back to
// <repo>/.git/hooks and nothing counts as ignored. Outside <repo> it reads only
// $CODEX_HOME/config.toml (default ~/.codex/config.toml) for project_doc_max_bytes.
//
// The read-only claim rule is exported (READONLY_CLAIM) so the agent-docs lint can use the
// same regex: `require('./harness-status.js').READONLY_CLAIM`.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawnSync } = require('child_process');

const SKIP_DIRS = new Set(['node_modules', '.git', '.worktrees', 'dist', 'build', 'coverage']);
const MAX_READ = 2 * 1024 * 1024;
const MANIFEST = '.agents/harness-manifest.json';
const SKILL_ROOTS = ['.claude/skills', '.agents/skills'];
const DOCS = ['AGENTS.md', 'CLAUDE.md'];
const PLAN_SKILLS = ['task-runner', 'segment-runner', 'phase-preflight', 'workstream-sweep'];
const CHANGE_SKILLS = ['change-workflow', 'crosscheck', 'verify'];
const PLAN_AGENTS = ['plan-conformance-auditor.md', 'claim-auditor.md'];
const CHANGE_AGENTS = ['crosscheck-auditor.md', 'implementer.md'];
const MARKER = /^\s*<!-- harness:(begin|end) (\S+) -->\s*$/;
const WRITE_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit']);
// A claim of read-only: the words "read-only" not directly preceded by a negation
// (not, never, no longer, isn't / aren't / wasn't ..., optionally followed by "a").
// "you hold Bash, so you are not read-only" is therefore not a claim.
const READONLY_CLAIM = /(?<!\b(?:not|never|no longer|\w+n['\u2019]t)\s+(?:a\s+)?)\bread-only\b/i;
const CODEX_DEFAULT_BYTES = 32768;
const V2_CORE_SKILLS = new Set(['task-runner']);
const NEUTRAL_FILES = [
  'scripts/codex-run.mjs', 'scripts/lib/codex-run-core.mjs', 'scripts/check-agent-docs.mjs', 'scripts/run-gates.sh',
  'scripts/review-gate.mjs', 'scripts/docs-drift.mjs', 'scripts/unit-record.mjs', 'scripts/unit-cost.mjs', 'scripts/estimate.mjs',
  '.claude/hooks/context-budget.mjs', '.claude/hooks/command-guard.mjs', 'docs/plans/decision-log.md',
  'docs/harness/follow-ups.md', 'docs/follow-ups.md', 'docs/guides/agent-workflow.md',
  // v5
  'scripts/unit-step.mjs', 'scripts/retro.mjs', 'scripts/harness-due.mjs', 'scripts/run-counted.mjs', 'scripts/unit-stack.sh',
  'scripts/intake.mjs', 'scripts/harness-host.mjs', 'scripts/claude-run.mjs', '.agents/harness-models.json',
  '.claude/hooks/edit-guard.mjs', '.claude/hooks/leftover-processes.mjs',
];
// harness-due's checks, from files alone (templates/scripts/lib/harness-due-core.mjs holds the
// generated defaults): where its reports are -- the v5 default first, then the paths earlier
// installs used -- the phase in a row id, and each cadence in days. A report's date is in its name.
const DUE_REPORTS = {
  preflight: ['docs/harness/reports/preflight-<phase>.md', 'docs/preflight/<phase>.md'],
  sweep: ['docs/harness/reports/sweep-<date>.md', 'docs/sweeps/<date>.md'],
  retro: ['docs/harness/reports/retro-<week>.md'],
  hygiene: ['docs/harness/reports/hygiene-<date>.md'],
};
// harness-host's models file (templates/harness-models.json), the hosts it may name, and the wrapper
// each second family runs through (templates/scripts/lib/harness-host-core.mjs holds the same).
const MODELS_FILE = '.agents/harness-models.json';
const MODEL_HOSTS = { claude: true, codex: true, zcode: true, kimi: true };
const WRAPPER_OF = { codex: 'scripts/codex-run.mjs', claude: 'scripts/claude-run.mjs' };
const DUE_VALUE = { preflight: /^[A-Za-z]+-?\d+$/, sweep: /^\d{4}-\d{2}-\d{2}$/, retro: /^\d{4}-W\d{2}$/, hygiene: /^\d{4}-\d{2}-\d{2}$/ };
const DUE_DAYS = { sweep: 7, retro: 7, hygiene: 14, p3: 14 };
const PHASE_OF = /^([A-Za-z]+-?\d+)[-.]\w/;
const LOG_FILES = ['docs/harness/log.md', 'docs/harness-log.md', 'harness/log.md'];
const FOLLOW_UP_FILES = ['docs/harness/follow-ups.md', 'docs/follow-ups.md', 'harness/follow-ups.md'];
const DAY_MS = 86400000;
const GUARD_RUN = /harness[- ]guard|commit guard|pre-commit/i;
const NEVER_AUTO = /never[- ]auto|never merged on agent output|manual review categories/i;
const POLICY_STATUS = /Never-auto policy:\s*(DRAFT|REVIEWED)/;
const SECRET_PATTERNS = [
  [/(api[_-]?key|secret|token|password|passwd)\\?['"]?\s*[:=]\s*\\?['"]?[A-Za-z0-9_\-/+]{12,}/i, 'credential-like assignment'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/sk-[A-Za-z0-9]{20,}/, 'API key with sk- prefix'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key header'],
];

let REPO = '';

function fail(message) {
  if (message) process.stderr.write(`harness-status: ${message}\n`);
  process.stderr.write(
    'usage: node harness-status.js <repo> [--text]\n' +
    '       node harness-status.js <repo> --hash <path|path#block>...\n'
  );
  process.exit(2);
}

// ---- file helpers -----------------------------------------------------------

function abs(rel) {
  return path.join(REPO, ...rel.split('/'));
}

function stat(rel) {
  try { return fs.statSync(abs(rel)); } catch { return null; }
}

function isFile(rel) {
  const s = stat(rel);
  return Boolean(s && s.isFile());
}

function isDir(rel) {
  const s = stat(rel);
  return Boolean(s && s.isDirectory());
}

function read(rel, cap = MAX_READ) {
  const s = stat(rel);
  if (!s || !s.isFile() || s.size > cap) return null;
  try { return fs.readFileSync(abs(rel), 'utf8'); } catch { return null; }
}

function norm(text) {
  return text.replace(/\r\n/g, '\n');
}

function sha(text) {
  return crypto.createHash('sha256').update(norm(text)).digest('hex');
}

/** Repo-relative posix path, or null when empty, absolute or escaping the repo. */
function safeRel(p) {
  if (typeof p !== 'string' || !p) return null;
  const n = path.posix.normalize(p.replace(/\\/g, '/'));
  if (n === '.' || n === '..' || n.startsWith('../') || n.startsWith('/') || /^[A-Za-z]:/.test(n)) return null;
  return n;
}

/** Files below startRel (not following symlinks, skipping SKIP_DIRS, .claude/worktrees and any
 *  directory that holds its own .git entry); maxDepth = directory levels below start. */
function walk(startRel, maxDepth = Infinity) {
  const out = [];
  (function rec(rel, depth) {
    let entries;
    try { entries = fs.readdirSync(abs(rel), { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || depth >= maxDepth) continue;
        // another checkout (Claude Code worktrees, nested clones, submodules) is not this repo
        if (rel === '.claude' && e.name === 'worktrees') continue;
        if (fs.existsSync(path.join(abs(child), '.git'))) continue;
        rec(child, depth + 1);
      } else if (e.isFile()) {
        out.push(child);
      }
    }
  })(startRel, 0);
  return out;
}

function skillNames(root) {
  try {
    return fs.readdirSync(abs(root))
      .filter(n => !n.startsWith('.') && isDir(`${root}/${n}`))
      .sort();
  } catch { return []; }
}

// ---- hashing and blocks -----------------------------------------------------

/** Text strictly between the begin and end marker lines of a block, or null. */
function blockText(text, block) {
  const ls = norm(text).split('\n');
  let begin = -1;
  for (let i = 0; i < ls.length; i += 1) {
    const m = ls[i].match(MARKER);
    if (!m || m[2] !== block) continue;
    if (m[1] === 'begin' && begin < 0) begin = i;
    else if (m[1] === 'end' && begin >= 0) return ls.slice(begin + 1, i).join('\n');
  }
  return null;
}

function hashSpec(spec) {
  const cut = spec.lastIndexOf('#');
  const relRaw = cut > 0 ? spec.slice(0, cut) : spec;
  const block = cut > 0 ? spec.slice(cut + 1) : null;
  const rel = safeRel(relRaw);
  if (!rel) return { error: `invalid path in ${spec}` };
  const text = read(rel, Infinity);
  if (text === null) return { error: `file not found: ${rel}` };
  if (block === null) return { hash: sha(text) };
  const inner = blockText(text, block);
  if (inner === null) return { error: `block not found: ${rel}#${block}` };
  return { hash: sha(inner) };
}

// ---- git --------------------------------------------------------------------

/** Environment for git: every inherited GIT_* variable removed (GIT_DIR, GIT_WORK_TREE,
 *  GIT_INDEX_FILE ... are set inside hooks and would point git at some other repository). */
function gitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_OPTIONAL_LOCKS = '0';
  return env;
}

function gitOut(args) {
  const r = spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', env: gitEnv() });
  if (r.error || r.status !== 0) return null;
  return r.stdout.replace(/\r?\n$/, '');
}

/** True when <repo> is itself a repository top level (not a plain directory nested in another one). */
function isRepoTop() {
  const top = gitOut(['rev-parse', '--show-toplevel']);
  if (!top) return false;
  try {
    return fs.realpathSync(top) === fs.realpathSync(REPO);
  } catch { return false; }
}

/** True when git reports <rel> as ignored (`git check-ignore -q`, exit 0). */
function isGitIgnored(rel) {
  if (!isRepoTop()) return false;
  const r = spawnSync('git', ['-C', REPO, 'check-ignore', '-q', '--', rel], { encoding: 'utf8', env: gitEnv() });
  return !r.error && r.status === 0;
}

/** Directory git runs hooks from: linked worktrees, submodules and core.hooksPath included.
 *  Only a repository whose top level IS <repo> counts: a plain directory nested inside another
 *  repository must not inherit that outer repository's hooks (it falls back to <repo>/.git/hooks). */
function hooksDir() {
  const fallback = path.join(REPO, '.git', 'hooks');
  if (!isRepoTop()) return fallback;
  const out = gitOut(['rev-parse', '--git-path', 'hooks']);
  return out ? path.resolve(REPO, out) : fallback;
}

/** AGENTS.md / CLAUDE.md that exist, one per real file (CLAUDE.md -> AGENTS.md counts once). */
function docFiles() {
  const seen = new Set();
  const out = [];
  for (const rel of DOCS) {
    let real;
    try { real = fs.realpathSync(abs(rel)); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(rel);
  }
  return out;
}

function readAbs(file) {
  try {
    const s = fs.statSync(file);
    return s.isFile() && s.size <= MAX_READ ? fs.readFileSync(file, 'utf8') : null;
  } catch { return null; }
}

/** project_doc_max_bytes from $CODEX_HOME/config.toml (default ~/.codex/config.toml), else Codex's default. */
function codexLimit() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const file = path.join(home, 'config.toml');
  const text = readAbs(file);
  const m = text === null ? null : /^\s*project_doc_max_bytes\s*=\s*([0-9_]+)\s*(?:#.*)?$/m.exec(norm(text));
  const bytes = m ? Number(m[1].replace(/_/g, '')) : 0;
  return bytes > 0 ? { bytes, source: file } : { bytes: CODEX_DEFAULT_BYTES, source: 'Codex default' };
}

/** Text with every balanced harness marker block (markers included) removed. */
function stripMarkerBlocks(text) {
  const ls = norm(text).split('\n');
  const skip = new Array(ls.length).fill(false);
  for (let i = 0; i < ls.length; i += 1) {
    const m = ls[i].match(MARKER);
    if (!m || m[1] !== 'begin') continue;
    for (let j = i + 1; j < ls.length; j += 1) {
      const e = ls[j].match(MARKER);
      if (!e) continue;
      if (e[1] === 'end' && e[2] === m[2]) {
        for (let k = i; k <= j; k += 1) skip[k] = true;
        i = j;
      }
      break;
    }
  }
  return ls.filter((_, i) => !skip[i]).join('\n');
}

/** Held rows of the registry: rows inside the active markers whose first cell is a number >= 1. */
function registryHeld() {
  const text = read('.claude/registry.md');
  if (text === null) return null;
  const ls = norm(text).split('\n');
  const b = ls.findIndex(l => l.includes('<!-- harness:active -->'));
  const e = ls.findIndex(l => l.includes('<!-- /harness:active -->'));
  const scoped = b >= 0 && e > b;
  const rows = scoped ? ls.slice(b + 1, e) : ls;
  const held = rows.filter(l => {
    const m = l.match(/^\s*\|\s*(\d+)\s*\|/);
    return m && Number(m[1]) >= 1;
  }).length;
  return { path: '.claude/registry.md', held, scope: scoped ? 'active-markers' : 'whole-file' };
}

/** The installed guard and its ID_PATTERN: { file, pattern } for the first candidate with an
 *  ID_PATTERN='...' line (hooks dir, a guard named in husky / lefthook, .githooks, scripts), else null. */
function guardIdPattern() {
  const re = /^ID_PATTERN='([^']*)'/m;
  const found = (file, text) => {
    const m = text === null ? null : re.exec(norm(text));
    return m ? { file, pattern: m[1] } : null;
  };
  const hookFile = path.join(hooksDir(), 'pre-commit');
  const inRepo = path.relative(REPO, hookFile).split(path.sep).join('/');
  const hit = found(inRepo && !inRepo.startsWith('..') && !path.isAbsolute(inRepo) ? inRepo : hookFile, readAbs(hookFile));
  if (hit) return hit;
  for (const src of ['.husky/pre-commit', 'lefthook.yml']) {
    const text = read(src);
    const named = text === null ? null : /[\w./-]*harness-guard\.sh/.exec(text);
    const rel = named ? safeRel(named[0]) : null;
    const got = rel ? found(rel, read(rel)) : null;
    if (got) return got;
  }
  for (const rel of ['.githooks/harness-guard.sh', 'scripts/harness-guard.sh']) {
    const got = found(rel, read(rel));
    if (got) return got;
  }
  return null;
}

/** Cells of a registry data row: the trimmed text between its pipes. */
function tableCells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

/** The markdown tables in `text`: each one's lower-cased header names and its data rows' cells. */
function mdTables(text) {
  const out = [];
  const ls = norm(text).split('\n');
  for (let i = 0; i + 1 < ls.length; i += 1) {
    if (!/^\s*\|/.test(ls[i]) || !/^\s*\|?\s*:?-{3,}/.test(ls[i + 1])) continue;
    const names = tableCells(ls[i]).map(c => c.replace(/^[\u2605*\s]+/, '').toLowerCase());
    const rows = [];
    let j = i + 2;
    for (; j < ls.length && /^\s*\|/.test(ls[j]); j += 1) rows.push(tableCells(ls[j]));
    out.push({ names, rows });
    i = j - 1;
  }
  return out;
}

/** A due kind's reports at any of its places, newest first: [{ rel, value, time }]. A week's time is its end. */
function dueReports(kind) {
  const out = [];
  for (const place of DUE_REPORTS[kind]) {
    const dir = path.posix.dirname(place);
    const [head, tail] = path.posix.basename(place).split(/<\w+>/);
    let names = [];
    try { names = fs.readdirSync(abs(dir)); } catch { continue; }
    for (const name of names) {
      if (name.length <= head.length + tail.length || !name.startsWith(head) || !name.endsWith(tail)) continue;
      const value = name.slice(head.length, name.length - tail.length);
      if (!DUE_VALUE[kind].test(value)) continue;
      let time = NaN;
      if (kind === 'retro') {
        const [y, w] = value.split('-W').map(Number);
        const jan4 = Date.UTC(y, 0, 4);
        time = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS + w * 7 * DAY_MS;
      } else if (kind !== 'preflight') {
        time = Date.parse(`${value}T00:00:00Z`);
      }
      out.push({ rel: `${dir}/${name}`, value, time });
    }
  }
  return out.sort((a, b) => (b.time || 0) - (a.time || 0));
}

/** Registry table cells inside the active markers (else the whole file), header and separator rows left out. */
function registryCells() {
  const text = read('.claude/registry.md');
  if (text === null) return [];
  const ls = norm(text).split('\n');
  const b = ls.findIndex(l => l.includes('<!-- harness:active -->'));
  const e = ls.findIndex(l => l.includes('<!-- /harness:active -->'));
  const rows = b >= 0 && e > b ? ls.slice(b + 1, e) : ls;
  const isSep = l => /^\s*\|[\s|:-]*-[\s|:-]*$/.test(l);
  const out = [];
  rows.forEach((l, i) => {
    const cells = tableCells(l);
    if (!cells || isSep(l) || (i + 1 < rows.length && isSep(rows[i + 1]))) return;
    out.push(...cells);
  });
  return out;
}

/** Section of a lefthook.yml below a top-level `key:` (up to the next top-level key). */
function lefthookSection(text, key) {
  const ls = norm(text).split('\n');
  const at = ls.findIndex(l => l.startsWith(`${key}:`));
  if (at < 0) return null;
  const out = [];
  for (let i = at + 1; i < ls.length && (ls[i] === '' || /^\s/.test(ls[i])); i += 1) out.push(ls[i]);
  return out.join('\n');
}

/** Legacy entries from lineage evidence, listed once per real file (a symlinked skill is one entry). */
function legacyEntries(sources) {
  let realRepo = REPO;
  try { realRepo = fs.realpathSync(REPO); } catch { realRepo = REPO; }
  const groups = new Map();
  for (const [ev, tag] of sources) {
    const rel = ev.split(': ')[0];
    let key = rel;
    try { key = fs.realpathSync(abs(rel)); } catch { key = rel; }
    if (!groups.has(key)) groups.set(key, { rels: [], tag });
    const g = groups.get(key);
    if (!g.rels.includes(rel)) g.rels.push(rel);
  }
  const out = [];
  for (const [key, g] of groups) {
    const own = path.relative(realRepo, key).split(path.sep).join('/');
    const canonical = g.rels.includes(own) ? own : g.rels[0];
    const others = g.rels.filter(r => r !== canonical);
    const label = g.tag === 'neutral' ? 'harness file (lineage-neutral)' : `${g.tag} lineage`;
    const detail = others.length ? `${label}; also reached as ${others.join(', ')} (symlink)` : label;
    out.push({ path: canonical, kind: 'unknown', status: 'legacy', detail });
  }
  return out;
}

// ---- report -----------------------------------------------------------------

function buildReport() {
  const hazards = [];
  const haz = (id, detail, rel, line) => {
    const h = { id };
    if (rel !== undefined) h.path = rel;
    if (line !== undefined) h.line = line;
    h.detail = detail;
    hazards.push(h);
  };
  const lineOf = (text, re) => {
    const ls = norm(text).split('\n');
    for (let i = 0; i < ls.length; i += 1) if (re.test(ls[i])) return i + 1;
    return undefined;
  };

  // manifest and entries
  let manifest = null;
  let entries = [];
  const manifestText = read(MANIFEST, Infinity);
  if (manifestText !== null) {
    let parsed = null;
    let problem = null;
    try {
      parsed = JSON.parse(manifestText);
    } catch (e) {
      // the parser message can quote input characters; report the position only
      const pos = /position (\d+)/.exec(String(e && e.message));
      problem = pos ? `invalid JSON at position ${pos[1]}` : 'invalid JSON';
    }
    if (!problem && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) problem = 'not a JSON object';
    if (!problem && parsed.schema !== 1) problem = typeof parsed.schema === 'number' ? `unknown schema ${parsed.schema}` : `unknown schema (${typeof parsed.schema})`;
    if (!problem && parsed.entries !== undefined && !Array.isArray(parsed.entries)) problem = 'entries is not an array';
    if (problem) {
      haz('manifest-invalid', problem, MANIFEST);
    } else {
      manifest = {
        path: MANIFEST,
        schema: parsed.schema,
        skillVersion: parsed.skillVersion,
        generated: parsed.generated,
        modes: parsed.modes,
        targets: parsed.targets,
        roles: parsed.roles,
        // a foundation-stage install (reference/foundation.md) until its flip; no stage means full
        stage: parsed.stage === 'foundation' ? 'foundation' : 'full',
        flipAfter: typeof parsed.flipAfter === 'string' ? parsed.flipAfter : null,
      };
      entries = (parsed.entries || []).map(manifestEntry);
    }
  }

  // lineage: a manifest names its modes; without one the fingerprints decide, and the v2 core
  // files (registry, task-runner, plan auditors, a log with "Missed by harness") are plan evidence
  // (v1 was plan-only). With a manifest they are plan evidence only when it lists the plan mode.
  const modes = manifest && Array.isArray(manifest.modes) ? manifest.modes.filter(m => m === 'plan' || m === 'change') : [];
  const coreIsPlan = !manifest || modes.includes('plan');
  const plan = [];
  const change = [];
  if (coreIsPlan && isFile('.claude/registry.md')) plan.push('.claude/registry.md');
  for (const root of SKILL_ROOTS) {
    for (const name of PLAN_SKILLS) {
      if ((coreIsPlan || !V2_CORE_SKILLS.has(name)) && isFile(`${root}/${name}/SKILL.md`)) plan.push(`${root}/${name}/SKILL.md`);
    }
    for (const name of CHANGE_SKILLS) if (isFile(`${root}/${name}/SKILL.md`)) change.push(`${root}/${name}/SKILL.md`);
  }
  if (coreIsPlan) for (const name of PLAN_AGENTS) if (isFile(`.claude/agents/${name}`)) plan.push(`.claude/agents/${name}`);
  for (const name of CHANGE_AGENTS) if (isFile(`.claude/agents/${name}`)) change.push(`.claude/agents/${name}`);
  if (isFile('scripts/codex-run.mjs')) change.push('scripts/codex-run.mjs');
  if (coreIsPlan) {
    for (const f of [...walk('', 0), ...walk('docs', 1)]) {
      if (!/\.md$/i.test(f)) continue;
      const t = read(f);
      if (t !== null && t.includes('Missed by harness')) plan.push(`${f}: contains "Missed by harness"`);
    }
  }
  // a marked block is this skill's own output (a Phase B draft has no manifest yet), never a legacy fingerprint
  for (const f of docFiles()) {
    const raw = read(f);
    if (raw === null) continue;
    const t = stripMarkerBlocks(raw);
    const hasTierRow = t.split('\n').some(l => /\b(Trivial|Hot-small)\b/.test(l));
    if (hasTierRow && /\btier\b/i.test(t) && /\bFull\b/.test(t)) change.push(`${f}: tier table`);
  }
  let verdict = plan.length && change.length ? 'both' : plan.length ? 'plan' : change.length ? 'change' : 'none';
  let lineageSource = 'fingerprints';
  if (modes.length) {
    verdict = modes.length === 2 ? 'both' : modes[0];
    lineageSource = 'manifest';
  }

  if (manifestText === null) {
    const sources = [...plan.map(e => [e, 'plan']), ...change.map(e => [e, 'change'])];
    for (const f of NEUTRAL_FILES) if (isFile(f)) sources.push([f, 'neutral']);
    entries = legacyEntries(sources);
  }

  // markers
  const markers = [];
  for (const rel of docFiles()) scanMarkers(rel, markers, haz);

  // sizes
  const sizes = { 'AGENTS.md': null, 'CLAUDE.md': null, stateFiles: [], codexLimit: codexLimit() };
  for (const rel of DOCS) {
    const s = stat(rel);
    if (s && s.isFile()) sizes[rel] = s.size;
  }
  if (sizes['AGENTS.md'] !== null && sizes['AGENTS.md'] > sizes.codexLimit.bytes) {
    const src = sizes.codexLimit.source === 'Codex default'
      ? 'the Codex default project_doc_max_bytes'
      : `project_doc_max_bytes from ${sizes.codexLimit.source}`;
    haz('agents-md-codex-truncation', `AGENTS.md is ${sizes['AGENTS.md']} bytes; Codex reads at most ${sizes.codexLimit.bytes} (${src})`, 'AGENTS.md');
  }
  if (sizes['CLAUDE.md'] !== null && sizes['CLAUDE.md'] > 40000) {
    haz('claude-md-large', `CLAUDE.md is ${sizes['CLAUDE.md']} bytes; over 40000`, 'CLAUDE.md');
  }
  // anywhere: the harness docs live in docs/ by default, elsewhere when docs/ is a governed set
  for (const rel of walk('')) {
    if (!rel.endsWith('.state.md')) continue;
    const bytes = stat(rel).size;
    sizes.stateFiles.push({ path: rel, bytes });
    if (bytes > 8192) haz('state-file-over-budget', `${bytes} bytes; budget is 8192`, rel);
  }

  // ids
  // text inside harness marker blocks (the keep-line template names DEC-1) is not an id in use;
  // D<digits> (no hyphen) is its own bucket, Dnum
  const idSets = { DEC: new Set(), D: new Set(), Q: new Set(), Dnum: new Set() };
  for (const f of [...walk('', 0), ...walk('docs'), ...walk('harness'), ...walk('.claude', 0), ...walk('.claude/plans')]) {
    if (!/\.md$/i.test(f)) continue;
    const raw = read(f);
    if (raw === null) continue;
    const t = stripMarkerBlocks(raw);
    for (const m of t.matchAll(/\b(DEC|D|Q)-(\d+)\b/g)) idSets[m[1]].add(Number(m[2]));
    for (const m of t.matchAll(/\bD(\d{2,4})\b/g)) idSets.Dnum.add(Number(m[1]));
  }
  const ids = { DEC: idSets.DEC.size, D: idSets.D.size, Q: idSets.Q.size, Dnum: idSets.Dnum.size };

  // registry and guard
  const registry = registryHeld();
  if (registry) {
    const reg = read('.claude/registry.md') || '';
    if (!reg.includes('<!-- harness:active -->') || !reg.includes('<!-- /harness:active -->')) {
      haz('registry-no-markers', 'registry lacks the <!-- harness:active --> / <!-- /harness:active --> markers', '.claude/registry.md');
    }
    // a guard in the hooks dir, or in husky / lefthook; each must be paired with a pre-merge-commit
    // hook that runs it, because a non-conflicting `git merge` runs pre-merge-commit, not pre-commit
    const hooks = hooksDir();
    const husky = read('.husky/pre-commit');
    const lefthook = read('lefthook.yml') || '';
    const hooksPre = readAbs(path.join(hooks, 'pre-commit'));
    let installed = hooksPre !== null;
    let mergeGuarded = installed && GUARD_RUN.test(readAbs(path.join(hooks, 'pre-merge-commit')) || '');
    if (husky !== null && /harness-guard/.test(husky)) {
      installed = true;
      if (GUARD_RUN.test(read('.husky/pre-merge-commit') || '')) mergeGuarded = true;
    }
    if (/harness-guard/.test(lefthook)) {
      installed = true;
      if (/harness-guard/.test(lefthookSection(lefthook, 'pre-merge-commit') || '')) mergeGuarded = true;
    }
    if (!installed) {
      const snippet = DOCS.some(f => {
        const t = read(f) || '';
        return /registry/i.test(t) && /refuse/i.test(t);
      });
      if (snippet) {
        haz('guard-snippet-only', 'registry exists; AGENTS.md/CLAUDE.md describe refusing commits but no pre-commit guard is installed');
      } else {
        haz('guard-missing', 'registry exists but no pre-commit guard is installed');
      }
    } else if (!mergeGuarded) {
      haz('merge-unguarded', 'a pre-commit guard is installed but no pre-merge-commit hook runs it; a non-conflicting `git merge` runs pre-merge-commit, not pre-commit');
    }
  } else if (verdict !== 'none' || manifest) {
    haz('lock-missing', 'a harness is installed but no commit lock: no registry, no guard', '.claude/registry.md');
  }

  // the guard's ID_PATTERN must take whole task ids: it is cut short by '.' or a trailing alnum run
  const guardId = guardIdPattern();
  if (guardId && guardId.pattern !== '') {
    let idRe = null;
    try { idRe = new RegExp(guardId.pattern); } catch { idRe = null; }
    if (!idRe) {
      haz('id-pattern-invalid', `ID_PATTERN '${guardId.pattern}' is not a valid expression`, guardId.file);
    } else {
      const cut = [];
      const continues = ch => ch !== undefined && /[A-Z0-9.]/.test(ch); // the id goes on past the match
      const refs = gitOut(['for-each-ref', 'refs/heads', '--format=%(refname:short)']);
      for (const name of refs ? refs.split('\n').filter(Boolean) : []) {
        const s = name.toUpperCase();
        const m = s.match(idRe);
        if (m && m[0] !== '' && continues(s[m.index + m[0].length])) {
          const run = /^[A-Z0-9.-]+/.exec(s.slice(m.index))[0];
          cut.push(`branch '${name}': ID_PATTERN takes '${m[0]}' from '${run}'`);
        }
      }
      for (const cell of registryCells()) {
        if (!cell || /\s/.test(cell) || cell.includes('/')) continue;
        const c = cell.toUpperCase();
        const m = c.match(idRe);
        if (m && m.index === 0 && m[0].length < c.length && continues(c[m[0].length])) {
          cut.push(`registry id '${cell}': ID_PATTERN takes '${m[0]}'`);
        }
      }
      if (cut.length) {
        haz('id-pattern-truncates', `${cut.slice(0, 5).join('; ')} — the guard can match these rows only by their Branch cell, never by id; bind ID_PATTERN to the full id shape`, guardId.file);
      }
    }
  }

  // skills
  const agentSkills = skillNames('.agents/skills');
  for (const name of agentSkills) {
    const a = `.agents/skills/${name}`;
    const c = `.claude/skills/${name}`;
    let link = null;
    try { link = fs.lstatSync(abs(c)); } catch { link = null; }
    const linked = link !== null;
    if (!linked) {
      if (isDir('.claude/skills')) haz('skill-unlinked', `skill ${name} has no .claude/skills counterpart`, a);
      continue;
    }
    let same = false;
    let dangling = false;
    try { same = fs.realpathSync(abs(a)) === fs.realpathSync(abs(c)); } catch { same = false; dangling = link.isSymbolicLink(); }
    if (same) continue;
    const ta = read(`${a}/SKILL.md`);
    const tc = read(`${c}/SKILL.md`);
    if ((ta !== null || tc !== null) && (ta === null || tc === null || norm(ta) !== norm(tc))) {
      const how = !link.isSymbolicLink() ? 'is not a symlink' : dangling ? 'is a dangling symlink' : 'is a symlink that points elsewhere';
      haz('skill-link-drift', `skill ${name} differs between .agents/skills and .claude/skills and the .claude copy ${how}`, c);
    }
  }

  // read-only agents with write tools
  for (const rel of walk('.claude/agents')) {
    if (!rel.endsWith('.md')) continue;
    const t = read(rel);
    if (t === null || !READONLY_CLAIM.test(t)) continue;
    const tools = frontmatterTools(t);
    if (tools === null) {
      haz('readonly-agent-has-write-tools', 'says read-only but has no tools: line, so it inherits every tool (Bash, Edit, Write)', rel);
      continue;
    }
    const bad = tools.map(x => x.replace(/\(.*$/, '')).filter(x => WRITE_TOOLS.has(x));
    if (bad.length) haz('readonly-agent-has-write-tools', `says read-only but tools include ${[...new Set(bad)].join(', ')}`, rel);
  }

  // effort: every agent pins its own (frontmatter beats the session level), and nothing sits above high
  const ABOVE_HIGH = /^(xhigh|max)$/i;
  for (const rel of walk('.claude/agents')) {
    if (!rel.endsWith('.md')) continue;
    const t = read(rel);
    const fm = t === null ? null : t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    // `effort: high`, `"effort": 'high'`, indented or with a comment; a key with no value is unpinned
    const EFFORT_KEY = /^[ \t]*["']?effort["']?[ \t]*:[ \t]*(.*)$/m;
    const key = fm[1].match(EFFORT_KEY);
    const value = key ? key[1].replace(/[ \t]+#.*$/, '').trim().replace(/^["']|["']$/g, '') : '';
    if (!value || /^(null|~)$/i.test(value)) haz('agent-effort-unpinned', 'no effort: in its frontmatter, so it inherits the session level (a session at max reaches it)', rel);
    else if (ABOVE_HIGH.test(value)) haz('effort-above-high', `effort: ${value} in its frontmatter`, rel, lineOf(t, EFFORT_KEY));
    // a dispatch that names no model falls back to the agent's; an agent with none runs on the session model (Opus)
    const model = (fm[1].match(/^[ \t]*["']?model["']?[ \t]*:[ \t]*(.*)$/m) || [])[1];
    const modelValue = model ? model.replace(/[ \t]+#.*$/, '').trim().replace(/^["']|["']$/g, '') : '';
    if (!modelValue || /^(null|~|inherit)$/i.test(modelValue)) haz('agent-model-unpinned', 'no model: in its frontmatter, so a dispatch that names none runs it on the session model (Opus)', rel);
  }
  for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
    const t = read(rel);
    if (t === null) continue;
    let cfg;
    try { cfg = JSON.parse(t); } catch { continue; }
    const levels = [['effortLevel', cfg && cfg.effortLevel], ['env.CLAUDE_CODE_EFFORT_LEVEL', cfg && cfg.env && cfg.env.CLAUDE_CODE_EFFORT_LEVEL]];
    for (const [key, value] of levels) {
      if (typeof value === 'string' && ABOVE_HIGH.test(value)) haz('effort-above-high', `${key} is ${value}: every session and subagent starts there`, rel);
    }
  }

  hostHazards(manifest, haz);

  // hooks
  for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
    const t = read(rel);
    if (t === null) continue;
    const re = /\$\{?CLAUDE_FILE_PATHS\}?/;
    let hit = false;
    try { hit = hookCommands(JSON.parse(t).hooks).some(cmd => re.test(cmd)); } catch { hit = re.test(t); }
    if (!hit) continue;
    const detail = 'hook command uses $CLAUDE_FILE_PATHS; the variable is not set, so the hook receives nothing and never acts on the edited file';
    const lines = norm(t).split('\n').map((l, i) => (re.test(l) ? i + 1 : 0)).filter(Boolean);
    if (!lines.length) haz('hook-undocumented-var', detail, rel);
    for (const n of lines) haz('hook-undocumented-var', detail, rel, n);
  }

  // secrets
  // agent folders, plus the settings and instruction files every session reads
  const secretFiles = ['.claude/settings.json', '.claude/settings.local.json', 'AGENTS.md', 'CLAUDE.md'];
  for (const root of ['.claude/skills', '.agents/skills', '.claude/agents', '.claude/rules', ...secretFiles]) {
    for (const rel of secretFiles.includes(root) ? [root] : walk(root)) {
      const t = read(rel);
      if (t === null || t.includes('\0')) continue;
      norm(t).split('\n').forEach((l, i) => {
        const hit = SECRET_PATTERNS.find(([re]) => re.test(l));
        if (hit) haz('secret-in-agent-files', `${hit[1]} (value masked)`, rel, i + 1);
      });
    }
  }

  // never-auto policy status
  const policy = [];
  for (const rel of docFiles()) {
    const t = read(rel);
    if (t === null) continue;
    const status = t.match(POLICY_STATUS);
    if (status) policy.push({ path: rel, status: status[1] });
    if (!NEVER_AUTO.test(t) || status) continue;
    const heading = norm(t).split('\n').findIndex(l => /^#{1,6}\s/.test(l) && /never.?auto/i.test(l));
    haz('policy-no-status', 'has a never-auto section but no "Never-auto policy: DRAFT|REVIEWED" line', rel, heading >= 0 ? heading + 1 : lineOf(t, NEVER_AUTO));
  }

  // keyword commit-msg hooks
  for (const rel of ['.githooks/commit-msg', '.husky/commit-msg']) {
    const t = read(rel);
    if (t !== null && /\[(tier|fresh-agent|codex|review)/.test(t)) {
      haz('keyword-commit-hook', 'commit-msg hook inspects the message for self-written review tags', rel, lineOf(t, /\[(tier|fresh-agent|codex|review)/));
    }
  }

  // due-checks: what harness-due would say, from files alone -- no git, so a report is dated by its
  // name and a landing is not counted; with no manifest the install is taken to be an older one
  const now = Date.now();
  // a role is a path, or a list of them; `<dir>/*.md` is that directory's markdown files by name;
  // one unsafe entry drops the whole role
  const roleNamed = role => {
    const v = manifest && manifest.roles ? manifest.roles[role] : null;
    const rels = (typeof v === 'string' ? [v] : Array.isArray(v) ? v : []).map(safeRel);
    if (!rels.length || !rels.every(Boolean)) return [];
    return rels.flatMap(rel => {
      if (!rel.endsWith('/*.md')) return [rel];
      const dir = rel.slice(0, -'/*.md'.length);
      let names = [];
      try { names = fs.readdirSync(abs(dir)).filter(n => n.endsWith('.md')).sort(); } catch { /* no such directory */ }
      return names.map(n => `${dir}/${n}`);
    });
  };
  const roleFile = (role, list) => [...roleNamed(role), ...list].find(isFile) || null;
  const roleFiles = (role, list) => {
    const named = roleNamed(role).filter(isFile);
    return named.length ? named : [list.find(isFile)].filter(Boolean);
  };
  const hasSkill = name => SKILL_ROOTS.some(root => isDir(`${root}/${name}`));
  const installed = manifest ? Date.parse(manifest.generated) : NaN;
  const settled = days => !Number.isFinite(installed) || now - installed >= days * DAY_MS;
  const ageOf = r => Math.floor((now - r.time) / DAY_MS);
  const logRel = roleFile('log', LOG_FILES);
  const phaseOf = id => ((PHASE_OF.exec(id) || [])[1] || '').toLowerCase();
  const logIds = [];
  for (const t of mdTables(logRel ? read(logRel) || '' : '')) {
    const col = t.names.findIndex(n => n.startsWith('unit') || n.startsWith('task'));
    if (col === -1) continue;
    for (const cells of t.rows) {
      const id = (cells[col] || '').split('\u00b7')[0].replace(/[`*]/g, '').trim();
      if (id) logIds.push(id);
    }
  }
  // the phase under way -- the last phased log row's -- with no preflight report
  const preflights = dueReports('preflight');
  if (hasSkill('phase-preflight') || preflights.length) {
    const current = logIds.filter(phaseOf).pop();
    if (current && !preflights.some(r => r.value.toLowerCase() === phaseOf(current))) {
      const phase = PHASE_OF.exec(current)[1];
      const rows = logIds.filter(id => phaseOf(id) === phaseOf(current)).length;
      haz('preflight-missing', `phase ${phase} is under way (${rows} log row${rows === 1 ? '' : 's'}) and has no preflight report at ${DUE_REPORTS.preflight.map(p => p.replace('<phase>', phase)).join(' or ')}`, logRel);
    }
  }
  // a recurring report older than its cadence, or none once the install is that old
  const overdue = (kind, runs) => {
    if (!runs) return;
    const r = dueReports(kind)[0];
    if (r && ageOf(r) >= DUE_DAYS[kind]) haz(`${kind}-overdue`, `the newest ${kind} report is ${ageOf(r)} days old; due every ${DUE_DAYS[kind]} days`, r.rel);
    else if (!r && settled(DUE_DAYS[kind])) haz(`${kind}-overdue`, `no ${kind} report at ${DUE_REPORTS[kind].join(' or ')}`);
  };
  overdue('sweep', hasSkill('workstream-sweep') || dueReports('sweep').length > 0);
  overdue('retro', isFile('scripts/retro.mjs'));
  overdue('hygiene', isFile('scripts/harness-due.mjs'));
  // open P3s, and no P3 batch (a hygiene unit) for as long as a P3 may wait
  // The template's own rules, not a project's retro-core bindings (this script never imports a core): the
  // status column starts with `status`, open is the word `open`, and a table with a column starting with
  // `sev` or `priority` makes a P3 of that cell alone, else of any cell.
  let openP3 = 0;
  let fuRel = null;
  for (const rel of roleFiles('follow-ups', FOLLOW_UP_FILES)) {
    const text = read(rel);
    if (text === null) continue;
    let here = 0;
    for (const t of mdTables(text)) {
      const st = t.names.findIndex(n => n.startsWith('status'));
      if (st === -1) continue;
      const sev = t.names.findIndex(n => n.startsWith('sev') || n.startsWith('priority'));
      for (const cells of t.rows) {
        if (/^open\b/i.test(cells[st] || '') && (sev === -1 ? cells.some(c => /\bP3\b/.test(c)) : /\bP3\b/.test(cells[sev] || ''))) here += 1;
      }
    }
    openP3 += here;
    if (here && fuRel === null) fuRel = rel;
  }
  const h = dueReports('hygiene')[0];
  if (openP3 && (!h || ageOf(h) >= DUE_DAYS.p3) && settled(DUE_DAYS.p3)) {
    haz('p3-queue-aging', `${openP3} open P3 row${openP3 === 1 ? '' : 's'}, and ${h ? `the newest hygiene report is ${ageOf(h)} days old` : 'no hygiene report'}: the P3 batch has not taken them`, fuRel);
  }

  // foundation stage: the pass-signal unit landed and the flip did not run
  if (manifest && manifest.stage === 'foundation') {
    const TEST_FILE = /(^|\/)([^/]+\.(test|spec)\.[cm]?[jt]sx?|test_[^/]+\.py|[^/]+_test\.(py|go)|[^/]+_spec\.rb)$/;
    // the harness's own template tests are manifest entries, not the project's first test
    const own = new Set(entries.map((e) => e.path));
    const found = walk('').find((rel) => TEST_FILE.test(rel) && !own.has(rel));
    if (found) haz('foundation-stage-has-tests', `manifest says foundation, and test files exist (e.g. ${found}): run the flip`, MANIFEST);
  }

  return {
    repo: REPO,
    manifest,
    lineage: { plan, change, verdict, source: lineageSource },
    entries,
    markers,
    sizes,
    ids,
    registry,
    policy,
    hazards,
  };
}

// models by host: harness-host.mjs reads the models file; each second family runs through its
// wrapper (from files alone -- the login checks are harness-host's)
/** The models file's hosts, or null; a missing or malformed file is host-models-missing where harness-host needs it. */
function hostModelsOf(haz) {
  const text = read(MODELS_FILE);
  if (text === null) {
    if (isFile('scripts/harness-host.mjs')) haz('host-models-missing', `scripts/harness-host.mjs reads ${MODELS_FILE}, which is missing: no host has models for its roles`, MODELS_FILE);
    return null;
  }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* reported below */ }
  if (parsed && parsed.schema === 1 && parsed.hosts && typeof parsed.hosts === 'object' && !Array.isArray(parsed.hosts)) return parsed.hosts;
  haz('host-models-missing', parsed ? 'not a schema 1 models file with a hosts object' : 'invalid JSON', MODELS_FILE);
  return null;
}

/** second-family-absent for one host: none named, or its wrapper not installed (an installed fallback is named). */
function secondFamilyHazard(host, entry, haz) {
  const second = entry && entry.second;
  if (!second) {
    haz('second-family-absent', `${host} names no second family: every cross-family pass is degraded by design`, MODELS_FILE);
    return;
  }
  const wrapper = WRAPPER_OF[second];
  if (!wrapper || isFile(wrapper)) return;
  const fallback = entry.fallback;
  const fbWrapper = fallback && WRAPPER_OF[fallback];
  const then = fbWrapper && isFile(fbWrapper) ? `; the fallback, ${fallback}, takes its passes` : `: every cross-family pass on ${host} is degraded`;
  // the template lists every host: one the project never runs on is an entry to drop, not a wrapper to install
  haz('second-family-absent', `${host}'s second family, ${second}, runs through ${wrapper}, which is not installed${then} (if the project never runs on ${host}, drop its entry)`, MODELS_FILE);
}

function hostHazards(manifest, haz) {
  const hostModels = hostModelsOf(haz);
  if (!hostModels) return;
  const targets = manifest && Array.isArray(manifest.targets) ? manifest.targets : [];
  for (const t of targets) {
    if (Object.prototype.hasOwnProperty.call(MODEL_HOSTS, t) && !hostModels[t]) haz('host-models-missing', `the manifest targets ${t} and ${MODELS_FILE} has no ${t} entry`, MODELS_FILE);
  }
  for (const [host, entry] of Object.entries(hostModels)) secondFamilyHazard(host, entry, haz);
}

function manifestEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || typeof entry.kind !== 'string') {
    return { path: String(entry && entry.path), kind: String(entry && entry.kind), status: 'invalid', detail: 'malformed entry' };
  }
  const row = { path: entry.path };
  if (entry.block) row.block = entry.block;
  row.kind = entry.kind;
  const rel = safeRel(entry.path);
  if (!rel) return { ...row, status: 'missing', detail: 'path is not repo-relative' };
  const text = read(rel, Infinity);
  if (text === null) {
    if (entry.kind === 'scaffold' && isGitIgnored(rel)) {
      return { ...row, status: 'ignored', detail: 'gitignored and absent: a fresh clone has no such file' };
    }
    return { ...row, status: 'missing', detail: 'file not found' };
  }
  let content = text;
  if (entry.block) {
    content = blockText(text, entry.block);
    if (content === null) return { ...row, status: 'missing', detail: 'block not found or unbalanced' };
  }
  if (entry.kind === 'generated') {
    const actual = sha(content);
    const status = actual === entry.sha256 ? 'unchanged' : 'edited';
    return entry.sha256 ? { ...row, status } : { ...row, status, detail: 'no recorded hash' };
  }
  if (entry.kind === 'scaffold') return { ...row, status: 'scaffold' };
  if (entry.kind === 'reviewed') return { ...row, status: 'reviewed' };
  return { ...row, status: 'unknown', detail: `unrecognised kind ${entry.kind}` };
}

function scanMarkers(rel, markers, haz) {
  const text = read(rel);
  if (text === null) return;
  const open = [];
  const bad = (rec, line, detail) => {
    rec.ok = false;
    rec.detail = rec.detail ? `${rec.detail}; ${detail}` : detail;
    haz('marker-unbalanced', `${rec.block}: ${detail}`, rel, line);
  };
  norm(text).split('\n').forEach((l, i) => {
    const m = l.match(MARKER);
    if (!m) return;
    const line = i + 1;
    if (m[1] === 'begin') {
      const rec = { path: rel, block: m[2], ok: true };
      markers.push(rec);
      if (open.length) {
        const outer = open[open.length - 1];
        outer.rec.ok = false;
        outer.rec.detail = `contains nested block ${m[2]}`;
        bad(rec, line, `nested inside block ${outer.rec.block}`);
      }
      open.push({ rec, line });
    } else if (open.length && open[open.length - 1].rec.block === m[2]) {
      open.pop();
    } else {
      const rec = { path: rel, block: m[2], ok: true };
      markers.push(rec);
      bad(rec, line, 'end marker without a matching begin');
    }
  });
  for (const o of open) bad(o.rec, o.line, 'begin marker without an end');
}

/** Tool names from the frontmatter `tools:` line; null when there is frontmatter but no such line (all tools). */
function frontmatterTools(text) {
  const m = norm(text).match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!m) return [];
  const fm = m[1].split('\n');
  const out = [];
  let found = false;
  for (let i = 0; i < fm.length; i += 1) {
    const kv = fm[i].match(/^tools:\s*(.*)$/);
    if (!kv) continue;
    found = true;
    const value = kv[1].trim();
    if (value) {
      out.push(...value.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
    } else {
      for (let j = i + 1; j < fm.length && /^\s*-\s+/.test(fm[j]); j += 1) out.push(fm[j].replace(/^\s*-\s+/, '').trim());
    }
  }
  return found ? out : null;
}

function hookCommands(node) {
  const out = [];
  (function rec(n) {
    if (Array.isArray(n)) { n.forEach(rec); return; }
    if (!n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) {
      if (k === 'command' && typeof v === 'string') out.push(v);
      else rec(v);
    }
  })(node);
  return out;
}

// ---- text output ------------------------------------------------------------

function renderText(r) {
  const out = [];
  out.push(`harness-status: ${r.repo}`);
  out.push(r.manifest
    ? `manifest: ${r.manifest.path} (schema ${r.manifest.schema}, skillVersion ${r.manifest.skillVersion}, generated ${r.manifest.generated}, stage ${r.manifest.stage}${r.manifest.flipAfter ? `, flip after ${r.manifest.flipAfter}` : ''})`
    : 'manifest: no manifest');
  out.push('');
  out.push(`lineage: ${r.lineage.verdict}${r.lineage.source === 'manifest' ? ' (from manifest modes)' : ''}`);
  for (const tag of ['plan', 'change']) {
    for (const ev of r.lineage[tag]) out.push(`  ${tag}: ${ev}`);
  }
  out.push('');
  out.push('entries:');
  if (!r.entries.length) {
    out.push('  (none)');
  } else {
    out.push('  Path[#block] | Kind | Status');
    for (const e of r.entries) out.push(`  ${e.path}${e.block ? `#${e.block}` : ''} | ${e.kind} | ${e.status}`);
  }
  out.push('');
  if (!r.markers.length) {
    out.push('markers: none');
  } else {
    out.push('markers:');
    const byPath = new Map();
    for (const m of r.markers) byPath.set(m.path, [...(byPath.get(m.path) || []), m]);
    for (const [file, recs] of byPath) {
      const bad = recs.filter(m => !m.ok);
      const state = bad.length ? `UNBALANCED: ${bad.map(m => `${m.block}: ${m.detail}`).join('; ')}` : 'balanced';
      out.push(`  ${file}: ${recs.map(m => m.block).join(', ')} (${state})`);
    }
  }
  out.push('');
  out.push('sizes:');
  for (const f of DOCS) out.push(`  ${f}: ${r.sizes[f] === null ? 'absent' : `${r.sizes[f]} bytes`}`);
  for (const s of r.sizes.stateFiles) out.push(`  ${s.path}: ${s.bytes} bytes`);
  out.push(`codex project_doc_max_bytes: ${r.sizes.codexLimit.bytes} (${r.sizes.codexLimit.source === 'Codex default' ? 'Codex default' : r.sizes.codexLimit.source})`);
  out.push(`ids: DEC ${r.ids.DEC}, D ${r.ids.D}, Q ${r.ids.Q}, Dnum ${r.ids.Dnum}`);
  out.push(r.registry
    ? `registry: ${r.registry.held} held row(s)${r.registry.scope === 'whole-file' ? ' (no active markers: counted the whole file)' : ''}`
    : 'registry: absent');
  out.push(`policy: ${r.policy.length ? r.policy.map(p => `${p.path} ${p.status}`).join(', ') : 'no status line'}`);
  out.push('');
  if (!r.hazards.length) {
    out.push('hazards: none');
  } else {
    out.push(`hazards (${r.hazards.length}):`);
    for (const h of r.hazards) {
      const where = h.path ? ` ${h.path}${h.line ? `:${h.line}` : ''}` : '';
      out.push(`- ${h.id}${where} -- ${h.detail}`);
    }
  }
  return `${out.join('\n').replace(/[^\x20-\x7e\n]/g, '?')}\n`;
}

// ---- main -------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  let repoArg = null;
  let text = false;
  let specs = null;
  for (const a of argv) {
    if (a === '--text') text = true;
    else if (specs) specs.push(a);
    else if (a === '--hash') specs = [];
    else if (a.startsWith('--')) fail(`unknown option ${a}`);
    else if (repoArg === null) repoArg = a;
    else fail(`unexpected argument ${a}`);
  }
  if (repoArg === null) fail('missing <repo>');
  if (specs && text) fail('--hash and --text cannot be combined');
  if (specs && !specs.length) fail('--hash needs at least one path or path#block');
  REPO = path.resolve(repoArg);
  let s = null;
  try { s = fs.statSync(REPO); } catch { s = null; }
  if (!s || !s.isDirectory()) fail(`not a directory: ${repoArg}`);

  if (specs) {
    let missing = false;
    for (const spec of specs) {
      const r = hashSpec(spec);
      if (r.error) {
        process.stderr.write(`harness-status: ${r.error}\n`);
        missing = true;
      } else {
        process.stdout.write(`${r.hash}  ${spec}\n`);
      }
    }
    process.exit(missing ? 2 : 0);
  }

  const report = buildReport();
  process.stdout.write(text ? renderText(report) : `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { READONLY_CLAIM };

if (require.main === module) main();
