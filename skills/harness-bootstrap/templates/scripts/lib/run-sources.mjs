// harness-bootstrap run sources (generated YYYY-MM-DD). Where a run's measurements are on disk.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right below.
/**
 * Finds the Claude Code transcripts (a session's main file and its subagents, by session id or by
 * the repository a session ran in), a Codex host's rollouts (a thread and its subagents, the same
 * two ways) and the two run ledgers, codex-run's and claude-run's, for unit-cost.mjs and retro.mjs.
 * Read-only: it lists and reads files and runs read-only git (`rev-parse`, `worktree list`, and for
 * retro-gather `blame` and `log`); it never writes.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexMeta } from './unit-cost-core.mjs';

// ---- [B] project bindings
// [B] Where the Codex ledger lives, relative to the main checkout (the same name as in codex-run.mjs).
export const LEDGER_DIR = '.codex-runs';
// [B] Where claude-run's ledger lives, relative to the main checkout (the same name as in claude-run.mjs).
export const CLAUDE_LEDGER_DIR = '.claude-runs';
// ---- end [B]

// How much of a transcript is read to find the directory its session ran in.
const HEAD_BYTES = 64 * 1024;
// A rollout is read this much at a time: one can pass 512 MB, more than a string holds.
const CHUNK_BYTES = 1024 * 1024;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Read-only git with no inherited GIT_* variable, so a git hook's GIT_DIR cannot redirect the lookup. */
export function gitRead(args, cwd) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') && k !== 'GIT_OPTIONAL_LOCKS') delete env[k];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
}

/** A session's main file and its subagent files in project directory `dir`, as [{ file, ctx }]. */
export function transcriptFiles(dir, id) {
  const files = [{ file: path.join(dir, `${id}.jsonl`), ctx: { kind: 'main', session: id } }];
  const subDir = path.join(dir, id, 'subagents');
  if (fs.existsSync(subDir)) {
    for (const name of fs.readdirSync(subDir).filter((n) => n.endsWith('.jsonl')).sort()) {
      const meta = readJson(path.join(subDir, name.replace(/\.jsonl$/, '.meta.json')));
      files.push({
        file: path.join(subDir, name),
        ctx: {
          kind: 'sub',
          agentId: `${id}/${name}`,
          agentType: meta.agentType ?? null,
          session: id,
          description: typeof meta.description === 'string' ? meta.description : null,
        },
      });
    }
  }
  return files;
}

/** The session's main file and its subagent files, found by scanning <projectsDir>/*\/<id>.jsonl. */
export function sessionFiles(projectsDir, id) {
  let projects;
  try {
    projects = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (e) {
    throw new Error(`cannot read projects dir ${projectsDir}: ${e.code ?? e.message}`, { cause: e });
  }
  const dir = projects.map((p) => path.join(projectsDir, p.name)).find((p) => fs.existsSync(path.join(p, `${id}.jsonl`)));
  if (!dir) throw new Error(`session ${id} not found under ${projectsDir}`);
  return transcriptFiles(dir, id);
}

/** Main checkout root, so worktrees share one ledger (the same resolution as codex-run.mjs and claude-run.mjs). */
export function defaultLedger(cwd = process.cwd(), dir = LEDGER_DIR) {
  try {
    const common = gitRead(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).trim();
    return path.join(path.dirname(common), dir, 'ledger.jsonl');
  } catch {
    return path.join(cwd, dir, 'ledger.jsonl');
  }
}

/** The repository's worktree paths, the main checkout first; just `top` when git cannot list them. */
export function worktreePaths(top) {
  try {
    const paths = gitRead(['worktree', 'list', '--porcelain'], top)
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length));
    return paths.length ? paths : [top];
  } catch {
    return [top];
  }
}

/** The working directory a transcript's session ran in: the first `cwd` in its first 64 KB, else null. */
export function firstCwd(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(buf.toString('utf8', 0, n));
    return m ? JSON.parse(`"${m[1]}"`) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Claude Code names a project directory after the session's working directory, every character
// other than a letter or digit turned into `-` (/a/b.c -> -a-b-c).
const projectDirName = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

/** A test for a working directory inside one of `roots`: `shop` must not take `shopbiz`'s sessions. */
const insideRoots = (roots) => (cwd) => typeof cwd === 'string' && roots.some((r) => cwd === r || cwd.startsWith(`${r}${path.sep}`));

const realPath = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p); // gone since, or never there
  }
};

/**
 * Which of `roots` (the repository's worktrees) holds a directory: the deepest one that is it or
 * contains it, else null. Both sides are compared as real paths, so a run given its worktree through
 * a link still belongs to it.
 */
export function worktreeOwner(roots) {
  const real = roots.map(realPath).sort((a, b) => b.length - a.length);
  return (dir) => {
    if (typeof dir !== 'string') return null;
    const d = realPath(dir);
    return real.find((r) => d === r || d.startsWith(`${r}${path.sep}`)) ?? null;
  };
}

/**
 * The sessions that ran inside one of `roots` (the repository and its worktrees), as
 * [{ id, files: [{ file, ctx }] }], skipping main files last modified before `sinceMs`. A directory is
 * read only when its name could belong to a root, and a session is kept only when its own `cwd` is
 * inside one: `shop` must not take `shopbiz`'s sessions.
 */
export function projectSessions(projectsDir, roots, sinceMs = 0) {
  const names = roots.map(projectDirName);
  let dirs;
  try {
    dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  const inside = insideRoots(roots);
  const out = [];
  for (const d of dirs) {
    if (!names.some((n) => d.name === n || d.name.startsWith(`${n}-`))) continue;
    const dir = path.join(projectsDir, d.name);
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()) {
      const file = path.join(dir, name);
      if (fs.statSync(file).mtimeMs < sinceMs) continue;
      const cwd = firstCwd(file);
      if (cwd === null || !inside(cwd)) continue;
      const id = name.slice(0, -'.jsonl'.length);
      out.push({ id, files: transcriptFiles(dir, id) });
    }
  }
  return out;
}

/** Where Codex keeps its rollouts: $CODEX_HOME/sessions, else ~/.codex/sessions (archived ones beside it). */
export function codexSessionsDir(env = process.env) {
  return path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
}

/** A file's lines, read `chunkBytes` at a time; a line or a character split across reads is joined. */
export function* fileLines(file, chunkBytes = CHUNK_BYTES) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(chunkBytes);
    let rest = Buffer.alloc(0);
    let n;
    while ((n = fs.readSync(fd, buf, 0, chunkBytes, null)) > 0) {
      const data = Buffer.concat([rest, buf.subarray(0, n)]);
      let start = 0;
      let nl;
      while ((nl = data.indexOf(10, start)) !== -1) {
        yield data.toString('utf8', start, nl);
        start = nl + 1;
      }
      rest = data.subarray(start);
    }
    if (rest.length) yield rest.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** A rollout's thread (codexMeta of its first line), or null when that line is no session_meta. */
function rolloutMeta(file) {
  try {
    for (const line of fileLines(file, HEAD_BYTES)) {
      const d = JSON.parse(line);
      return d?.type === 'session_meta' ? codexMeta(d.payload) : null;
    }
  } catch {
    // unreadable, or a torn first line
  }
  return null;
}

/**
 * The rollout files under `dir` (`<CODEX_HOME>/sessions`, by day) and in the archive beside it
 * (`archived_sessions`, where Codex moves an archived thread), sorted; a missing directory adds none.
 */
function rolloutFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(dir);
  walk(path.join(path.dirname(dir), 'archived_sessions'));
  return out.sort();
}

/** The host's rollouts under `dir` changed since `sinceMs`, as [{ file, meta }]; `codex exec` runs are left out. */
function hostRollouts(dir, sinceMs = 0) {
  const out = [];
  for (const file of rolloutFiles(dir)) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue; // another session may have removed it
    }
    if (!st.isFile() || st.mtimeMs < sinceMs) continue;
    const meta = rolloutMeta(file);
    if (meta?.host) out.push({ file, meta });
  }
  return out;
}

/**
 * A Codex thread's rollout and its subagents' (a subagent names the thread as its session or its
 * parent), as [{ file, meta }]; [] when `dir` holds no rollout of the owner's by that id. Codex names
 * a rollout `rollout-<time>-<thread id>.jsonl`.
 */
export function codexSessionFiles(dir, id) {
  const own = rolloutFiles(dir).find((f) => path.basename(f).endsWith(`-${id}.jsonl`));
  const meta = own ? rolloutMeta(own) : null;
  if (!meta?.host || meta.id !== id) return [];
  const subs = hostRollouts(dir, meta.started ?? 0).filter(({ meta: m }) => m.kind === 'sub' && m.id !== id && (m.session === id || m.parent === id));
  return [{ file: own, meta }, ...subs];
}

/**
 * The Codex host's threads that ran inside one of `roots` (the repository and its worktrees), main
 * sessions and subagents alike, judged by each rollout's own cwd, skipping files last changed before
 * `sinceMs`, as [{ file, meta }]. A `codex exec` run is not the host's: codex-run's ledger has its own.
 */
export function codexProjectSessions(dir, roots, sinceMs = 0) {
  const inside = insideRoots(roots);
  return hostRollouts(dir, sinceMs).filter(({ meta }) => inside(meta.cwd));
}
