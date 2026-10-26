#!/usr/bin/env node
// harness-bootstrap machine-sweep: this skill's own script, never generated into a repository.
/**
 * The machine sweep (scripts/lib/machine-sweep-core.mjs holds every rule).
 *
 *   node scripts/machine-sweep.mjs [--report] [--only <ids>] [--json] [--home <dir>]
 *   node scripts/machine-sweep.mjs --approve <ids> | --unapprove <ids> [--home <dir>]
 *   node scripts/machine-sweep.mjs --apply-approved [--only <ids>] [--dry-run] [--json] [--home <dir>]
 *   node scripts/machine-sweep.mjs --record <pid> [--home <dir>]
 *
 *   --report          the default: each category's size, what freeing it runs and what it keeps,
 *                     and the orphaned dev processes. It changes nothing
 *   --approve <ids>   the owner's approval, once per category, in <home>/.agents/harness/sweep.json;
 *                     it also installs this script at <home>/.agents/harness/machine-sweep/, the
 *                     path harness-due's DUE disk line runs
 *   --unapprove <ids> withdraws approvals
 *   --apply-approved  frees the approved categories alone (with --only, the approved ones named)
 *                     and appends one line to <home>/.agents/harness/sweep-log.jsonl; --dry-run
 *                     prints what it would run instead
 *   --record <pid>    records a process a harness run started, in <home>/.agents/harness/pids.jsonl
 *   --only <ids>      these categories alone: comma-separated ids, or `all`
 *   --home <dir>      the home directory to sweep and keep state in (default the user's); another
 *                     home leaves out the categories its tools keep in the real one
 *
 * exit: 0 done | 1 a category failed, a recorded PID is gone, or another sweep holds the lock |
 * 2 usage, or run as root.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FRESH_HOURS,
  IDS,
  PROCESS_IDS,
  approvalsFile,
  clonesToRemove,
  deletable,
  devOrphans,
  dockerBytes,
  fmtBytes,
  formatReport,
  heldRows,
  inUse,
  lockDecision,
  lockEntry,
  logEntry,
  mainCheckout,
  mcpOrphans,
  olderReleases,
  parseArgs,
  parseListeners,
  parseLstart,
  parsePs,
  treePorts,
  parseRecords,
  parseWorktrees,
  readApprovals,
  recordedToStop,
  settled,
  staleStores,
  unusedBrowsers,
  worktreeVerdict,
} from './lib/machine-sweep-core.mjs';

const USAGE =
  'usage: node scripts/machine-sweep.mjs [--report | --apply-approved [--dry-run]] [--only <ids>] [--json] [--home <dir>] | --approve <ids> | --unapprove <ids> | --record <pid>';
const HERE = path.dirname(fileURLToPath(import.meta.url));
// what --approve installs, relative to HERE
const COPIED = ['machine-sweep.mjs', path.join('lib', 'machine-sweep-core.mjs')];

function usage(msg) {
  process.stderr.write(`machine-sweep: ${msg}\n${USAGE}\n`);
  process.exit(2);
}

// ---- small readers; each answers null or [] instead of throwing

function run(cmd, args, { cwd, timeout = 120_000, env = {} } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', ...env } });
  return { ok: r.status === 0, out: r.stdout ?? '', err: (r.stderr || r.error?.message || '').trim(), missing: r.error?.code === 'ENOENT' };
}
function git(args, cwd) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') && k !== 'GIT_OPTIONAL_LOCKS') delete env[k];
  try {
    return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
}
const exists = (p) => fs.existsSync(p);
const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
const list = (dir) => {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
};
const lstat = (p) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};
const mtime = (p) => lstat(p)?.mtimeMs ?? null;
/** The newest write at `p` or within `depth` levels below it: a store or cache entry's last use. */
function written(p, depth = 2) {
  const st = lstat(p);
  if (!st) return null;
  let newest = st.mtimeMs;
  if (depth > 0 && st.isDirectory()) for (const n of list(p)) newest = Math.max(newest, written(path.join(p, n), depth - 1) ?? 0);
  return newest;
}
/** Bytes on disk under `p`, as du counts them; a link is never followed. */
function size(p) {
  if (!lstat(p)) return 0;
  if (process.platform !== 'win32') {
    const kb = Number(/^(\d+)/.exec(run('du', ['-sk', p], { timeout: 600_000 }).out)?.[1]);
    if (Number.isFinite(kb)) return kb * 1024;
  }
  let sum = 0;
  const stack = [p];
  while (stack.length) {
    const d = stack.pop();
    const st = lstat(d);
    if (st?.isDirectory()) stack.push(...list(d).map((n) => path.join(d, n)));
    else if (st) sum += st.size;
  }
  return sum;
}
const ago = (t, now) => (Number.isFinite(t) ? `${Math.max(0, Math.round((now - t) / 86_400_000))} d ago` : 'never');

// ---- the machine: processes, their working directories, launchd's jobs, free disk
// A ps, lsof or launchctl that failed -- missing, denied, timed out -- reads as null, never as an
// empty inventory: an empty one would show every worktree, clone and release unused.

function machine(home, now) {
  const cache = {};
  const once = (key, fn) => (key in cache ? cache[key] : (cache[key] = fn()));
  return {
    home,
    now,
    // tools keep their caches in the real home: with another --home, those categories are left out
    foreign: path.resolve(home) !== path.resolve(os.homedir()),
    get rows() {
      return once('rows', () => {
        const r = run('ps', ['-axo', 'pid=,ppid=,etime=,rss=,command=']);
        return r.ok ? parsePs(r.out) : null;
      });
    },
    get services() {
      return once('services', () => {
        if (process.platform !== 'darwin') return new Set();
        const r = run('launchctl', ['list']);
        return r.ok ? new Set(r.out.split('\n').slice(1).map((l) => Number(l.split('\t')[0])).filter((n) => Number.isInteger(n) && n > 0)) : null;
      });
    },
    get cwds() {
      return once('cwds', () => {
        const r = run('lsof', ['-a', '-d', 'cwd', '-Fpn'], { timeout: 60_000 });
        if (!r.ok) return null;
        const byPid = new Map();
        let pid = null;
        for (const line of r.out.split('\n')) {
          if (line[0] === 'p') pid = Number(line.slice(1));
          else if (line[0] === 'n' && pid !== null) byPid.set(pid, line.slice(1));
        }
        return byPid;
      });
    },
    get listeners() {
      return once('listeners', () => {
        const r = run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], { timeout: 60_000 });
        return r.ok ? parseListeners(r.out) : null;
      });
    },
    /** The files the processes whose command matches `re` execute or map (lsof's txt): what they truly run; null when unknown. */
    mapped(re) {
      const rows = this.rows;
      if (!rows) return null;
      const pids = rows.filter((r) => re.test(r.command)).map((r) => r.pid);
      if (!pids.length) return [];
      // lsof exits 1 when a listed process has exited since ps: unknown too, so this run frees none
      const r = run('lsof', ['-a', '-d', 'txt', '-Fn', '-p', pids.join(',')], { timeout: 60_000 });
      return r.ok ? r.out.split('\n').filter((l) => l[0] === 'n').map((l) => l.slice(1)) : null;
    },
  };
}

function freeDisk(home) {
  try {
    const s = fs.statfsSync(home);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return { free: NaN, total: NaN };
  }
}

// ---- worktrees: the facts worktreeVerdict reads

function mainlineOf(top) {
  const remote = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], top)?.trim().replace(/^origin\//, '');
  return [remote, 'main', 'master'].filter(Boolean).find((b) => git(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], top) !== null) ?? null;
}

/** The linked worktrees of the repository at `top`, each with its verdict; `held` are its registry's held rows. */
function worktreesOf(top, m) {
  const mainline = mainlineOf(top);
  if (!mainline) return [];
  const held = heldRows(read(path.join(top, '.claude', 'registry.md')));
  const firstParent = new Set((git(['rev-list', '--first-parent', mainline], top) ?? '').split('\n').filter(Boolean));
  const cwds = m.cwds ? [...m.cwds.values()] : null;
  return parseWorktrees(git(['worktree', 'list', '--porcelain'], top))
    .slice(1)
    .filter((w) => !w.bare && !w.prunable && w.head && exists(w.path))
    .map((w) => {
      const merged = git(['merge-base', '--is-ancestor', w.head, mainline], top) !== null;
      const moved = w.branch ? (git(['reflog', 'show', '-n', '2', '--format=%H', `refs/heads/${w.branch}`, '--'], top) ?? '').trim().split('\n').filter(Boolean).length > 1 : false;
      const own = merged && (!firstParent.has(w.head) || moved);
      const status = own ? git(['status', '--porcelain', '--ignored'], w.path) : null;
      const lines = status === null ? [] : status.split('\n').filter(Boolean);
      // a link is left out: removing it never touches what it points to
      const ignored = lines.filter((l) => l.startsWith('!! ')).map((l) => l.slice(3)).filter((p) => !lstat(path.join(w.path, p.replace(/\/$/, '')))?.isSymbolicLink());
      const gitdir = /^gitdir:\s*(.+)$/m.exec(read(path.join(w.path, '.git')) ?? '')?.[1];
      const times = [Number(git(['log', '-1', '--format=%ct', w.head], top)?.trim()) * 1000, mtime(path.join(w.path, '.git')), gitdir ? mtime(path.join(path.resolve(w.path, gitdir), 'logs', 'HEAD')) : null];
      const facts = { ...w, rel: path.relative(top, w.path), merged, own, clean: status !== null && lines.every((l) => l.startsWith('!! ')), ignored, active: Math.max(...times.filter(Number.isFinite)) };
      return { ...facts, top, verdict: worktreeVerdict(facts, { now: m.now, held, cwds }) };
    });
}

function worktreePlan(trees) {
  const go = trees.filter((t) => t.verdict === 'remove');
  const reasons = new Map();
  for (const t of trees.filter((x) => x.verdict !== 'remove')) reasons.set(t.verdict, (reasons.get(t.verdict) ?? 0) + 1);
  const kept = [...reasons].map(([why, n]) => `${n} ${why.replace(/^keep: /, '')}`).join('; ');
  const plan = go.map((t) => ({ worktree: t.path, top: t.top, bytes: size(t.path) }));
  return { plan, detail: `${go.length ? `remove ${go.map((t) => t.rel).join(', ')}` : 'none to remove'}${kept ? `; keep ${kept}` : ''}` };
}

// ---- the categories: each measures what it would free, and the plan that frees it

const absent = (why) => ({ absent: why });
const foreignHome = 'another --home: this tool keeps its cache in the real one';

function cachesRoot(m) {
  if (process.platform === 'darwin') return path.join(m.home, 'Library', 'Caches');
  if (process.platform === 'win32') return (!m.foreign && process.env.LOCALAPPDATA) || path.join(m.home, 'AppData', 'Local');
  return (!m.foreign && process.env.XDG_CACHE_HOME) || path.join(m.home, '.cache');
}

function rmPlan(root, names) {
  return names.map((n) => ({ rm: path.join(root, n), root, bytes: size(path.join(root, n)) }));
}
const sum = (plan) => plan.reduce((s, p) => s + (p.bytes ?? 0), 0);

const MEASURE = {
  pnpm(m) {
    if (m.foreign) return absent(foreignHome);
    const r = run('pnpm', ['store', 'path'], { cwd: m.home, timeout: 30_000 });
    if (r.missing) return absent('pnpm is not installed');
    const store = r.out.trim();
    if (!r.ok || !store || !exists(store)) return absent('`pnpm store path` names no store');
    const root = path.dirname(store);
    const current = path.basename(store);
    const versions = list(root).filter((n) => /^v\d+$/.test(n)).map((name) => ({ name, written: written(path.join(root, name)) }));
    const stale = staleStores(versions, current, m.now);
    const kept = versions.filter((v) => v.name !== current && !stale.includes(v.name));
    const prune = { cmd: 'pnpm', args: ['store', 'prune'], cwd: m.home, measure: store, bytes: size(store) };
    const plan = [prune, ...rmPlan(root, stale)];
    const keep = kept.map((v) => `keep ${v.name}, written ${ago(v.written, m.now)}`);
    return { bytes: sum(plan), upTo: true, plan, detail: [`\`pnpm store prune\` on ${current} (${fmtBytes(prune.bytes)})`, ...stale.map((n) => `remove ${n}`), ...keep].join('; ') };
  },
  npm(m) {
    if (m.foreign) return absent(foreignHome);
    const r = run('npm', ['config', 'get', 'cache'], { cwd: m.home, timeout: 30_000 });
    if (r.missing) return absent('npm is not installed');
    const dir = path.join(r.out.trim() || path.join(m.home, '.npm'), '_cacache');
    const plan = exists(dir) ? [{ cmd: 'npm', args: ['cache', 'clean', '--force'], cwd: m.home, measure: dir, bytes: size(dir) }] : [];
    return { bytes: sum(plan), plan };
  },
  bun(m) {
    // `bun pm cache rm` refuses to run outside a project: clear the cache directory itself
    const custom = !m.foreign && (process.env.BUN_INSTALL_CACHE_DIR || (process.env.BUN_INSTALL && path.join(process.env.BUN_INSTALL, 'install', 'cache')));
    const root = custom || path.join(m.home, '.bun', 'install', 'cache');
    if (!exists(root)) return absent('no bun install cache');
    const plan = rmPlan(root, list(root));
    return { bytes: sum(plan), plan };
  },
  uv(m) {
    if (m.foreign) return absent(foreignHome);
    const r = run('uv', ['cache', 'dir'], { cwd: m.home, timeout: 30_000 });
    if (r.missing) return absent('uv is not installed');
    const dir = r.out.trim();
    const plan = dir && exists(dir) ? [{ cmd: 'uv', args: ['cache', 'prune'], cwd: m.home, measure: dir, bytes: size(dir) }] : [];
    return { bytes: sum(plan), upTo: true, plan };
  },
  homebrew(m) {
    if (m.foreign) return absent(foreignHome);
    const r = run('brew', ['--cache'], { timeout: 30_000, env: { HOMEBREW_NO_AUTO_UPDATE: '1' } });
    if (r.missing) return absent('Homebrew is not installed');
    const dir = r.out.trim();
    const plan = dir && exists(dir) ? [{ cmd: 'brew', args: ['cleanup', '--prune=all'], env: { HOMEBREW_NO_AUTO_UPDATE: '1' }, measure: dir, bytes: size(dir), timeout: 600_000 }] : [];
    return { bytes: sum(plan), upTo: true, plan };
  },
  'derived-data'(m) {
    if (process.platform !== 'darwin') return absent('not macOS');
    const root = path.join(m.home, 'Library', 'Developer', 'Xcode', 'DerivedData');
    if (!exists(root)) return absent('no DerivedData');
    if (!m.rows) return { bytes: 0, plan: [], detail: 'could not tell whether Xcode runs (ps failed): kept' };
    if (m.rows.some((r) => /\/Xcode\.app\/Contents\/MacOS\/Xcode(\s|$)|(^|\/)xcodebuild(\s|$)/.test(r.command))) return { bytes: 0, plan: [], detail: 'Xcode is running: kept' };
    const plan = rmPlan(root, list(root));
    return { bytes: sum(plan), plan };
  },
  docker(m) {
    if (m.foreign) return absent(foreignHome);
    const info = run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 10_000 });
    if (info.missing) return absent('docker is not installed');
    if (!info.ok) return absent('the docker daemon is not running');
    const types = run('docker', ['system', 'df', '--format', '{{json .}}'], { timeout: 60_000 }).out.split('\n').flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
    const cache = types.find((t) => t.Type === 'Build Cache');
    const dangling = run('docker', ['images', '-f', 'dangling=true', '--format', '{{.Size}}'], { timeout: 60_000 }).out.split('\n').filter(Boolean);
    const plan = [
      { cmd: 'docker', args: ['builder', 'prune', '-f'], bytes: dockerBytes(cache?.Reclaimable), timeout: 600_000 },
      { cmd: 'docker', args: ['image', 'prune', '-f'], bytes: dangling.reduce((s, x) => s + dockerBytes(x), 0), timeout: 600_000 },
    ];
    return { bytes: sum(plan), plan, detail: `build cache ${fmtBytes(dockerBytes(cache?.Size))}, of it no image's ${fmtBytes(plan[0].bytes)}; ${dangling.length} dangling images` };
  },
  playwright(m) {
    const custom = !m.foreign && process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0' && process.env.PLAYWRIGHT_BROWSERS_PATH;
    const base = { darwin: path.join(m.home, 'Library', 'Caches'), win32: path.join(m.home, 'AppData', 'Local') }[process.platform] ?? cachesRoot(m);
    const root = custom || path.join(base, 'ms-playwright');
    if (!exists(root)) return absent('no Playwright browsers');
    const links = path.join(root, '.links');
    if (!exists(links)) return { bytes: 0, plan: [], detail: 'no .links directory: nothing is known to be unused' };
    const live = list(links).map((f) => read(path.join(links, f))?.trim()).filter((p) => p && exists(p));
    const installs = live.map((p) => readJson(path.join(p, 'browsers.json'))?.browsers);
    if (installs.some((b) => !Array.isArray(b))) return { bytes: 0, plan: [], detail: "a live installation's browsers.json is unreadable: kept all" };
    const unused = unusedBrowsers(list(root), installs);
    const plan = rmPlan(root, unused);
    return { bytes: sum(plan), plan, detail: `${unused.length ? `remove ${unused.join(', ')}` : 'every browser is in use'}; ${live.length} live installation${live.length === 1 ? '' : 's'}` };
  },
  updaters(m) {
    const root = cachesRoot(m);
    const entries = list(root).filter((n) => /-updater$|\.ShipIt$/.test(n)).map((name) => ({ name, written: written(path.join(root, name)) }));
    if (!entries.length) return absent('no updater caches');
    const ready = settled(entries, m.now).map((e) => e.name);
    const plan = rmPlan(root, ready);
    const fresh = entries.filter((e) => !ready.includes(e.name)).map((e) => e.name);
    return { bytes: sum(plan), plan, detail: `${ready.length ? `remove ${ready.join(', ')}` : 'none to remove'}${fresh.length ? `; keep ${fresh.join(', ')}, written in the last ${FRESH_HOURS} h` : ''}` };
  },
  codex(m) {
    const base = path.join(m.home, '.codex');
    if (!exists(base)) return absent('no ~/.codex');
    const plan = [];
    const notes = [];
    let mapped;
    for (const pkg of list(path.join(base, 'packages'))) {
      const releases = path.join(base, 'packages', pkg, 'releases');
      let current = null;
      try {
        current = path.basename(fs.readlinkSync(path.join(base, 'packages', pkg, 'current')));
      } catch {
        notes.push(`${pkg}: no current link, kept`);
        continue;
      }
      const names = list(releases);
      // a session started before an update runs an older release under the same command line
      if (mapped === undefined) mapped = m.mapped(/codex/i);
      const used = inUse(names.map((n) => path.join(releases, n)), mapped?.map((f) => ({ command: f })) ?? null);
      const busy = used && new Set([...used].map((d) => path.basename(d)));
      const drop = olderReleases(names, current, busy);
      plan.push(...rmPlan(releases, drop));
      notes.push(`${pkg}: keep ${names.filter((n) => !drop.includes(n)).join(', ') || 'none'}${busy ? '' : ', could not tell which run (ps or lsof failed)'}`);
    }
    const trees = [];
    for (const slot of list(path.join(base, 'worktrees'))) {
      for (const name of list(path.join(base, 'worktrees', slot))) {
        const dir = path.join(base, 'worktrees', slot, name);
        if (!lstat(path.join(dir, '.git'))?.isFile()) continue;
        const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir)?.trim();
        const top = common && path.basename(common) === '.git' ? path.dirname(common) : null;
        if (top) trees.push(...worktreesOf(top, m).filter((t) => path.resolve(t.path) === path.resolve(dir)));
      }
    }
    const wt = worktreePlan(trees);
    plan.push(...wt.plan);
    return { bytes: sum(plan), plan, detail: `${notes.join('; ')}; worktrees: ${wt.detail}` };
  },
  'chrome-clones'(m) {
    if (process.platform !== 'darwin') return absent('not macOS');
    if (m.foreign) return absent("another --home: Chrome's clones live in the user's temporary directory");
    const temp = run('getconf', ['DARWIN_USER_TEMP_DIR']).out.trim().replace(/\/$/, '');
    const root = temp && path.join(path.dirname(temp), 'X', 'com.google.Chrome.code_sign_clone');
    if (!root || !exists(root)) return absent('no Chrome code-sign clones');
    const entries = list(root).filter((n) => n.startsWith('code_sign_clone.')).map((name) => ({ name, written: written(path.join(root, name), 1) }));
    const clones = clonesToRemove(entries, root, m.rows, m.now);
    if (!clones) return { bytes: 0, unknown: true, plan: [], detail: `none of ${entries.length} clones: could not tell which a running Chrome uses (ps failed)` };
    // copy-on-write: their size says nothing of the disk they free, so none is counted
    const plan = clones.remove.map((n) => ({ rm: path.join(root, n), root, bytes: 0 }));
    return { bytes: 0, unknown: true, plan, detail: `${clones.remove.length} of ${entries.length} clones (${clones.busy} in use); copy-on-write: what they free shows in the sweep log` };
  },
  worktrees(m) {
    const repos = readJson(path.join(m.home, '.agents', 'harness', 'repos.json'))?.repos ?? [];
    if (!repos.length) return absent('no registered repository (~/.agents/harness/repos.json)');
    const trees = repos.filter((r) => r?.path && exists(r.path)).flatMap((r) => worktreesOf(r.path, m));
    const wt = worktreePlan(trees);
    return { bytes: sum(wt.plan), plan: wt.plan, detail: wt.detail };
  },
  'orphan-mcp'(m) {
    if (m.foreign) return absent("another --home: the processes are this machine's");
    if (!m.rows || !m.services) return { count: 0, plan: [], detail: 'could not list the processes or launchd\'s jobs (ps or launchctl failed): none stopped' };
    const procs = mcpOrphans(m.rows, m.services);
    return { count: procs.length, plan: procs.map((p) => ({ kill: p.pid, command: p.command })), detail: procs.length ? `${procs.length}: ${procs.map((p) => p.pid).join(', ')}` : 'none' };
  },
  'recorded-pids'(m) {
    const records = parseRecords(read(path.join(m.home, '.agents', 'harness', 'pids.jsonl')));
    if (!records.length) return { count: 0, plan: [], detail: 'none recorded' };
    const ps = run('ps', ['-o', 'pid=,lstart=,command=', '-p', records.map((r) => r.pid).join(',')]);
    if (!ps.ok) return { count: 0, plan: [], detail: `${records.length} recorded; could not tell which still run (ps failed): none stopped` };
    const live = parseLstart(ps.out);
    // the registry is the main checkout's; a repository that is gone, or that git cannot place, counts as held
    const held = (repo) => {
      const main = exists(repo) ? mainCheckout(repo, git(['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'])?.trim()) : null;
      return main === null || heldRows(read(path.join(main, '.claude', 'registry.md'))).length > 0;
    };
    const heldRepos = new Set(records.map((r) => r.repo).filter((repo) => repo && held(repo)));
    const stop = recordedToStop(records, live, { now: m.now, heldRepos });
    return { count: stop.length, plan: stop.map((r) => ({ kill: r.pid, command: r.command })), detail: `${stop.length} of ${records.length} recorded, ${live.length} still running` };
  },
};

function measure(id, m) {
  try {
    return { id, ...MEASURE[id](m) };
  } catch (error) {
    return { id, absent: `could not measure: ${error.message}` };
  }
}

// ---- freeing

/** Carries out one step of a plan; returns the bytes it freed, or 1 for a process it signalled. Throws on a refused or failed step. */
function step(p, m) {
  if (p.rm) {
    // the native realpath climbs a `..` after a link as the removal does; fs.realpathSync cancels it as text
    if (!deletable(p.rm, p.root, m.home, (x) => fs.realpathSync.native(x))) throw new Error(`refused ${p.rm}: outside ${p.root} or protected`);
    fs.rmSync(p.rm, { recursive: true, force: true });
    return p.bytes ?? 0;
  }
  if (p.cmd) {
    const r = run(p.cmd, p.args, { cwd: p.cwd, env: p.env, timeout: p.timeout ?? 300_000 });
    if (!r.ok) throw new Error(`${p.cmd} ${p.args.join(' ')}: ${r.err.split('\n').pop() || 'failed'}`);
    return p.measure ? Math.max(0, (p.bytes ?? 0) - size(p.measure)) : p.bytes ?? 0;
  }
  if (p.worktree) {
    // never --force: git refuses a worktree with changes, and the verdict already refused the rest
    const r = run('git', ['-C', p.top, 'worktree', 'remove', p.worktree]);
    if (!r.ok) throw new Error(`git worktree remove ${p.worktree}: ${r.err.split('\n').pop()}`);
    return p.bytes ?? 0;
  }
  if (p.kill) {
    // only an ok ps that still names the planned command: a failed one is unknown, and stops nothing
    const now = run('ps', ['-o', 'command=', '-p', String(p.kill)]);
    if (!now.ok || now.out.trim() !== p.command.trim()) return 0;
    process.kill(p.kill, 'SIGTERM');
    return 1;
  }
  return 0;
}

const describe = (p) =>
  p.rm ? `remove ${p.rm}` : p.cmd ? `${p.cmd} ${p.args.join(' ')}` : p.worktree ? `git -C ${p.top} worktree remove ${p.worktree}` : `kill -TERM ${p.kill}  # ${p.command.slice(0, 80)}`;

/** Whether process `pid` runs: kill -0 fails with ESRCH only when it is gone (EPERM: another user's). */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

/**
 * The sweep's lock: { release }, or { holder } when another sweep holds it. Each run writes its own
 * entry in machine-sweep.locks/, then lists the directory (lockDecision decides): it removes only
 * the entries of runs that are gone and, beside a live one, its own, so no run ever removes a live
 * run's entry and two runs never free at once.
 */
function lock(dir) {
  const locks = path.join(dir, 'machine-sweep.locks');
  const mine = lockEntry(process.pid, Date.now());
  const own = path.join(locks, mine);
  try {
    fs.mkdirSync(locks, { recursive: true });
    fs.writeFileSync(own, `${process.pid}\n`, { flag: 'wx' });
  } catch {
    return { holder: 'unknown' };
  }
  let entries;
  try {
    entries = fs.readdirSync(locks).map((name) => ({ name, written: lstat(path.join(locks, name))?.mtimeMs ?? null }));
  } catch {
    // a directory it cannot list may hold a live run's entry
    fs.rmSync(own, { force: true });
    return { holder: 'unknown' };
  }
  const { remove, holder } = lockDecision({ mine, entries, alive, now: Date.now() });
  for (const name of remove) fs.rmSync(path.join(locks, name), { force: true });
  if (holder !== null) {
    fs.rmSync(own, { force: true });
    return { holder };
  }
  return { release: () => fs.rmSync(own, { force: true }) };
}

function apply(args, m, state) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) usage('refusing to run as root: the sweep never needs sudo');
  const approved = readApprovals(read(path.join(state, 'sweep.json')) ?? '');
  const ids = approved.filter((id) => !args.only || args.only.includes(id));
  if (!ids.length) {
    process.stdout.write(approved.length ? 'machine-sweep: none of --only is approved; nothing to do\n' : 'machine-sweep: nothing is approved, so nothing was touched; the owner approves categories once with --approve <ids>\n');
    return 0;
  }
  const { release, holder } = args.dryRun ? { release: () => {} } : lock(state);
  if (!release) {
    process.stderr.write(`machine-sweep: another sweep (pid ${holder}) holds the lock; run again once it ends\n`);
    return 1;
  }
  try {
    const before = freeDisk(m.home).free;
    const categories = {};
    const errors = [];
    const lines = [];
    for (const id of ids) {
      const c = measure(id, m);
      if (c.absent) {
        lines.push(`skip   ${id}: ${c.absent}`);
        continue;
      }
      // bytes, or in a process category the processes signalled
      let freed = 0;
      for (const p of c.plan ?? []) {
        if (args.dryRun) {
          lines.push(`would  ${id}: ${describe(p)}`);
          continue;
        }
        try {
          freed += step(p, m);
        } catch (error) {
          errors.push({ id, error: error.message });
          lines.push(`error  ${id}: ${error.message}`);
        }
      }
      if (!args.dryRun) {
        categories[id] = freed;
        lines.push(`done   ${id}: ${PROCESS_IDS.includes(id) ? `${freed} stopped` : `about ${fmtBytes(freed)}`}`);
      }
    }
    if (args.dryRun) {
      process.stdout.write(`${lines.join('\n')}\n`);
      return 0;
    }
    const entry = logEntry({ now: Date.now(), before, after: freeDisk(m.home).free, categories, errors });
    fs.appendFileSync(path.join(state, 'sweep-log.jsonl'), `${JSON.stringify(entry)}\n`);
    process.stdout.write(args.json ? `${JSON.stringify(entry, null, 2)}\n` : `${lines.join('\n')}\nmachine-sweep: freed ${fmtBytes(entry.freed)} (${fmtBytes(entry.after)} free)\n`);
    return errors.length ? 1 : 0;
  } finally {
    release();
  }
}

function approve(args, state) {
  const file = path.join(state, 'sweep.json');
  const current = readApprovals(read(file) ?? '');
  const next = approvalsFile(current, args.approve ?? args.unapprove, Boolean(args.approve), Date.now());
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  let installed = '';
  if (args.approve) {
    const dest = path.join(state, 'machine-sweep');
    if (path.resolve(dest) !== path.resolve(HERE)) {
      fs.mkdirSync(path.join(dest, 'lib'), { recursive: true });
      for (const f of COPIED) fs.copyFileSync(path.join(HERE, f), path.join(dest, f));
    }
    installed = `; the copy harness-due runs: ${path.join(dest, 'machine-sweep.mjs')}`;
  }
  process.stdout.write(`machine-sweep: approved ${next.approved.length ? next.approved.join(', ') : 'nothing'}${installed}\n`);
  return 0;
}

function record(args, state) {
  const live = parseLstart(run('ps', ['-o', 'pid=,lstart=,command=', '-p', String(args.record)]).out)[0];
  if (!live) {
    process.stderr.write(`machine-sweep: no process ${args.record}\n`);
    return 1;
  }
  const repo = git(['rev-parse', '--show-toplevel'], process.cwd())?.trim() || null;
  fs.mkdirSync(state, { recursive: true });
  fs.appendFileSync(path.join(state, 'pids.jsonl'), `${JSON.stringify({ t: new Date().toISOString(), ...live, repo })}\n`);
  process.stdout.write(`machine-sweep: recorded ${live.pid} (${live.command.slice(0, 80)})\n`);
  return 0;
}

function report(args, m, state) {
  const ids = args.only ?? IDS;
  const approved = readApprovals(read(path.join(state, 'sweep.json')) ?? '');
  const measured = ids.map((id) => measure(id, m));
  // report-only: a failed reading says unknown and the report still prints
  const dev = m.rows && devOrphans(m.rows, m.services ?? new Set()).map((r) => ({ ...r, cwd: m.cwds?.get(r.pid)?.replace(m.home, '~') ?? null, ports: m.listeners && treePorts(r.pid, m.rows, m.listeners) }));
  const { free, total } = freeDisk(m.home);
  if (args.json) {
    const plain = measured.map(({ plan, ...c }) => ({ ...c, plan: (plan ?? []).map(describe) }));
    process.stdout.write(`${JSON.stringify({ free, total, approved, categories: plain, dev }, null, 2)}\n`);
    return 0;
  }
  const dest = path.join(state, 'machine-sweep');
  const copy = path.join(dest, 'machine-sweep.mjs');
  const stale = exists(copy) && path.resolve(dest) !== path.resolve(HERE) && COPIED.some((f) => read(path.join(dest, f)) !== read(path.join(HERE, f)));
  process.stdout.write(formatReport({ free, total, measured, approved, dev }));
  if (stale) process.stdout.write(`The installed copy (${copy}) differs from this skill's: --approve <ids> again refreshes it.\n`);
  return 0;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage(error.message);
  }
  const home = path.resolve(args.home ?? os.homedir());
  if (!exists(home)) usage(`no home directory ${home}`);
  const state = path.join(home, '.agents', 'harness');
  const m = machine(home, Date.now());
  if (args.mode === 'apply') return apply(args, m, state);
  if (args.mode === 'approve' || args.mode === 'unapprove') return approve(args, state);
  if (args.mode === 'record') return record(args, state);
  return report(args, m, state);
}

process.exitCode = main();
