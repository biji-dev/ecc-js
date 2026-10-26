// harness-bootstrap machine-sweep core. Pure core of scripts/machine-sweep.mjs, this skill's own
// script: it is never generated into a repository. No I/O here (scripts/machine-sweep.mjs
// measures, approves, frees and logs), so `machine-sweep-core.test.mjs` can pin each rule.
/**
 * The machine sweep: the caches, build output and residue that agent work leaves on the owner's
 * machine, one category each, with what it holds, what freeing it runs, and whether the owner
 * approved it. The report changes nothing. Approving is the owner's, once per category; after
 * that, `harness-due` says `DUE disk` under 25 GB free and the runner starts the approved
 * categories in the background.
 *
 * WHY. One project's incident: 73 MCP server processes, 11.25 of 12 GB of swap in use and 3.1 GB
 * of disk free; its leftover-processes hook then fired in 39 sessions, and the owner typed "close"
 * or "cleanup" 79 times. On 2026-10-26 the owner's machine had 20 GB free of 245 GB.
 *
 * NEVER: sudo; a path where the agents keep their sessions (the retro reads them) or the harness
 * keeps its state; a worktree with work in it; a cache entry something still uses; any process
 * but an MCP server its agent left behind or a process a harness run recorded.
 */
import path from 'node:path';

// ---- settings
export const SCHEMA = 1;
// A releases directory keeps its current release and the newest one before it.
export const KEEP_RELEASES = 2;
// A worktree merged with commits of its own and untouched this long is residue (harness-due's
// WORKTREE_IDLE_HOURS).
export const WORKTREE_IDLE_HOURS = 6;
// A cache entry written this recently may be mid-download or about to be used.
export const FRESH_HOURS = 1;
// A pnpm store version the installed pnpm does not read goes only after this long unwritten:
// another project's pnpm may still read it.
export const STORE_IDLE_DAYS = 30;
// A recorded process is stopped only this long after it was recorded, and never while its
// repository holds a registry row.
export const RECORDED_IDLE_HOURS = 6;
// A second run stops while the first runs, however long that takes. A lock entry whose process is
// gone is a finished or crashed run's; one naming no process id, a stray one's after this long.
export const LOCK_STALE_MINUTES = 60;
// The ignored paths a removed worktree may lose (harness-due's REBUILDABLE).
export const REBUILDABLE = /(^|\/)(node_modules|dist|build|out|coverage|test-results|playwright-report|\.next|\.turbo|\.expo|\.vite|\.cache|\.husky\/_)\/?$|\.DS_Store$|\.tsbuildinfo$/;
// ---- end settings

/** The categories, in report order, with what the report says each one holds and frees. */
export const CATEGORIES = [
  { id: 'pnpm', what: 'the pnpm store: `pnpm store prune`; a store version the installed pnpm does not read, once unwritten for 30 days' },
  { id: 'npm', what: 'the npm cache: `npm cache clean --force`; the next install downloads again' },
  { id: 'bun', what: 'the bun install cache (what `bun pm cache rm` clears); the next install downloads again' },
  { id: 'uv', what: 'the uv cache: `uv cache prune`, which keeps what an environment uses' },
  { id: 'homebrew', what: 'Homebrew downloads and old versions: `brew cleanup --prune=all`' },
  { id: 'derived-data', what: "Xcode's DerivedData, rebuilt by the next build; never while Xcode runs" },
  { id: 'docker', what: 'Docker build cache and dangling images: `docker builder prune -f`, `docker image prune -f`; the next image build starts cold' },
  { id: 'playwright', what: "Playwright browsers no live installation names (Playwright's own rule); `npx playwright install` brings one back" },
  { id: 'updaters', what: 'downloaded app updates (`*-updater`, `*.ShipIt`) not written in the last hour; the app downloads again' },
  { id: 'codex', what: 'Codex releases older than the current one and the one before it, none in use; Codex worktrees that are residue' },
  { id: 'chrome-clones', what: "Chrome's code-sign clones no running Chrome uses, none from the last hour; copy-on-write, so they free less than their size" },
  { id: 'worktrees', what: "registered repositories' worktrees that are residue: merged with commits of their own, no change, rebuildable ignored files alone, idle 6 h, no held registry row or process in them" },
  { id: 'orphan-mcp', what: 'MCP servers whose agent is gone: every process above them, up to process 1, is an MCP launcher; stopped with SIGTERM' },
  { id: 'recorded-pids', what: 'processes a harness run recorded (`--record`), still the same process, recorded over 6 h ago, no registry row held in their repository; stopped with SIGTERM' },
];
export const IDS = CATEGORIES.map((c) => c.id);
export const PROCESS_IDS = ['orphan-mcp', 'recorded-pids'];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const GB = 1e9;
const VALUE_FLAGS = { '--approve': 'approve', '--unapprove': 'unapprove', '--only': 'only', '--home': 'home', '--record': 'record' };
const MODES = { '--report': 'report', '--apply-approved': 'apply' };

/** One mode (`report` by default) and its options; an unknown category or flag throws before anything runs. */
export function parseArgs(argv) {
  const a = { mode: null, approve: null, unapprove: null, only: null, home: null, record: null, dryRun: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t in MODES) {
      if (a.mode && a.mode !== MODES[t]) throw new Error('pick one of --report and --apply-approved');
      a.mode = MODES[t];
    } else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--json') a.json = true;
    else if (t in VALUE_FLAGS) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[VALUE_FLAGS[t]] = v;
    } else throw new Error(t.startsWith('--') ? `unknown option ${t}` : `unexpected argument "${t}"`);
  }
  const changes = ['approve', 'unapprove', 'record'].filter((k) => a[k] !== null);
  if (changes.length > 1 || (changes.length && a.mode)) throw new Error('--approve, --unapprove and --record each run alone');
  for (const k of ['approve', 'unapprove', 'only']) if (a[k] !== null) a[k] = categoryList(a[k]);
  if (a.record !== null) {
    if (!/^[1-9]\d*$/.test(a.record)) throw new Error(`--record takes a process id, not "${a.record}"`);
    a.record = Number(a.record);
  }
  if (a.dryRun && a.mode !== 'apply') throw new Error('--dry-run goes with --apply-approved');
  a.mode ??= changes[0] ?? 'report';
  return a;
}

/** `pnpm,uv` -> ['pnpm', 'uv']; `all` -> every category; an unknown id throws. */
export function categoryList(text) {
  const ids = String(text).split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 1 && ids[0] === 'all') return [...IDS];
  const bad = ids.filter((id) => !IDS.includes(id));
  if (bad.length || !ids.length) throw new Error(`unknown categor${bad.length === 1 ? 'y' : 'ies'} ${bad.join(', ') || '(none)'}; the categories are ${IDS.join(', ')}`);
  return IDS.filter((id) => ids.includes(id));
}

/** sweep.json -> its approved categories; a missing, torn or foreign file approves nothing. */
export function readApprovals(text) {
  try {
    const j = JSON.parse(text);
    return j && j.schema === SCHEMA && Array.isArray(j.approved) ? IDS.filter((id) => j.approved.includes(id)) : [];
  } catch {
    return [];
  }
}

/** The approvals file after approving (`on`) or withdrawing `ids`, in category order. */
export function approvalsFile(current, ids, on, now) {
  const set = new Set(current);
  for (const id of ids) {
    if (on) set.add(id);
    else set.delete(id);
  }
  return { schema: SCHEMA, approved: IDS.filter((id) => set.has(id)), updated: new Date(now).toISOString() };
}

/**
 * Playwright's own rule: a browser directory (`chromium-1228`) stays while a live installation's
 * browsers.json names that revision, for any platform. `installs` holds each live installation's
 * `browsers` list.
 */
export function unusedBrowsers(dirNames, installs) {
  const wanted = new Set();
  for (const browsers of installs) {
    for (const b of browsers ?? []) {
      const base = String(b.name).replace(/-/g, '_');
      for (const rev of [b.revision, ...Object.values(b.revisionOverrides ?? {})]) wanted.add(`${base}-${rev}`);
    }
  }
  return dirNames.filter((n) => /^[a-z][a-z0-9_]*-\d+$/.test(n) && !wanted.has(n)).sort();
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)/;
const cmpVersion = (x, y) => {
  const a = VERSION.exec(x).slice(1).map(Number);
  const b = VERSION.exec(y).slice(1).map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
};

/**
 * A releases directory's names -> the ones to remove: older than `current`, past the newest
 * KEEP_RELEASES - 1 of those, none in `inUse`; none at all when `inUse` is null (unknown).
 */
export function olderReleases(names, current, inUse = new Set(), keep = KEEP_RELEASES) {
  if (inUse === null || !current || !VERSION.test(current) || !names.includes(current)) return [];
  const older = names.filter((n) => n !== current && VERSION.test(n) && cmpVersion(n, current) < 0).sort(cmpVersion);
  return older.slice(0, Math.max(0, older.length - (keep - 1))).filter((n) => !inUse.has(n));
}

/** pnpm store versions ({ name: 'v3', written }) to remove: not `current`, unwritten for STORE_IDLE_DAYS. */
export function staleStores(versions, current, now, idleDays = STORE_IDLE_DAYS) {
  return versions
    .filter((v) => /^v\d+$/.test(v.name) && v.name !== current && Number.isFinite(v.written) && now - v.written >= idleDays * DAY)
    .map((v) => v.name)
    .sort();
}

/** Cache entries ({ name, written }) not written in the last FRESH_HOURS. */
export function settled(entries, now, hours = FRESH_HOURS) {
  return entries.filter((e) => Number.isFinite(e.written) && now - e.written >= hours * HOUR);
}

/** `ps -axo pid=,ppid=,etime=,rss=,command=` -> rows. */
export function parsePs(text) {
  return String(text ?? '')
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map(([, pid, ppid, etime, rss, command]) => ({ pid: Number(pid), ppid: Number(ppid), etime, rss: Number(rss) * 1024, command }));
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn` -> Map pid -> the ports it listens on, ascending. */
export function parseListeners(text) {
  const byPid = new Map();
  let pid = null;
  for (const line of String(text ?? '').split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid !== null) {
      const port = Number(/:(\d+)$/.exec(line)?.[1]);
      if (port > 0) byPid.set(pid, [...new Set([...(byPid.get(pid) ?? []), port])].sort((a, b) => a - b));
    }
  }
  return byPid;
}

/** The ports `pid` and every process under it listen on, ascending: a launcher's server is its child. */
export function treePorts(pid, rows, listeners) {
  const kids = new Map();
  for (const r of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r.pid]);
  const ports = new Set();
  const seen = new Set();
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    for (const port of listeners.get(p) ?? []) ports.add(port);
    stack.push(...(kids.get(p) ?? []));
  }
  return [...ports].sort((a, b) => a - b);
}

// An MCP server or its launcher (`npm exec @playwright/mcp`, `uvx mcp-server-fetch`, `codex mcp-server`).
const MCP = /mcp[-_]server|-mcp(?=[\s/@.]|$)|@playwright\/mcp|@modelcontextprotocol\/|(^|[\s/])mcp-[a-z0-9-]+(?=[\s/@.]|$)/i;
// Dev tooling worth listing when it has lost its parent.
const DEV_EXE = /(^|\/)(node|bun|deno|python3?(\.\d+)?)$/;
const DEV_CMD = /\b(vite|next dev|next-server|tsx|vitest|expo|metro|webpack|nodemon|turbo|cliDaemon)\b/;
const SYSTEM = /^\/(System|usr\/libexec|usr\/sbin|sbin)\//;
// A shell whose `-c` text names an MCP server launches one; it is never the server itself.
const SHELL = /(^|\/)-?(sh|bash|zsh|fish|dash)$/;

/**
 * The MCP servers whose agent is gone: an MCP process whose every ancestor, up to process 1, is an
 * MCP launcher too, and whose topmost one is no service (`services`: launchd's own jobs). An MCP
 * server under a live agent, an editor, a terminal or tmux has a non-MCP process above it and is
 * never one. Returns every process of each such chain, the launchers included.
 */
export function mcpOrphans(rows, services = new Set()) {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const out = new Map();
  for (const r of rows) {
    if (!MCP.test(r.command) || SHELL.test(r.command.split(/\s+/)[0])) continue;
    const chain = [r];
    let p = byPid.get(r.ppid);
    while (p && p.pid > 1 && chain.length < 32) {
      chain.push(p);
      p = byPid.get(p.ppid);
    }
    const top = chain[chain.length - 1];
    if (top.ppid === 1 && !services.has(top.pid) && chain.every((c) => MCP.test(c.command))) for (const c of chain) out.set(c.pid, c);
  }
  return [...out.values()].sort((x, y) => x.pid - y.pid);
}

/** Dev tooling whose parent is gone (PPID 1) and that no service manager runs: listed for the owner, never stopped here. */
export function devOrphans(rows, services = new Set()) {
  return rows.filter((r) => {
    const exe = r.command.split(/\s+/)[0];
    return r.ppid === 1 && !services.has(r.pid) && !MCP.test(r.command) && !SYSTEM.test(exe) && (DEV_EXE.test(exe) || DEV_CMD.test(r.command));
  });
}

/** `ps -o pid=,lstart=,command=` -> [{ pid, lstart, command }], the start time's spaces collapsed. */
export function parseLstart(text) {
  return String(text ?? '')
    .split('\n')
    .flatMap((l) => {
      const m = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})\s+(.*?)\s*$/.exec(l);
      return m ? [{ pid: Number(m[1]), lstart: m[2].replace(/\s+/g, ' '), command: m[3] }] : [];
    });
}

/** A `pids.jsonl` text -> its records; a torn or foreign line is skipped. */
export function parseRecords(text) {
  return String(text ?? '')
    .split('\n')
    .flatMap((line) => {
      try {
        const r = JSON.parse(line);
        return r && Number.isInteger(r.pid) && typeof r.lstart === 'string' && typeof r.command === 'string' && typeof r.t === 'string' ? [r] : [];
      } catch {
        return [];
      }
    });
}

/**
 * The recorded processes to stop: still the same process (start time and command, so a reused
 * PID never matches), recorded RECORDED_IDLE_HOURS ago or more, in a repository that holds no
 * registry row (`heldRepos`).
 */
export function recordedToStop(records, live, { now, heldRepos = new Set(), idleHours = RECORDED_IDLE_HOURS }) {
  const byPid = new Map(live.map((l) => [l.pid, l]));
  return records.filter((r) => {
    const l = byPid.get(r.pid);
    return l && l.lstart === r.lstart && l.command === r.command && now - Date.parse(r.t) >= idleHours * HOUR && !(r.repo && heldRepos.has(r.repo));
  });
}

/** Docker's sizes (`3.251GB`, `12.29kB`, `0B (0%)`) -> bytes; Docker counts in powers of 1000. */
export function dockerBytes(text) {
  const m = /^([\d.]+)\s*([kMGT]?B)\b/i.exec(String(text ?? '').trim());
  return m ? Math.round(Number(m[1]) * { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2].toUpperCase()]) : 0;
}

/** `git worktree list --porcelain` -> [{ path, head, branch, bare, locked, prunable }], the main worktree first. */
export function parseWorktrees(text) {
  const out = [];
  for (const block of String(text ?? '').split(/\n\s*\n/)) {
    const w = { path: null, head: null, branch: null, bare: false, locked: false, prunable: false };
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ');
      if (key === 'worktree') w.path = rest.join(' ');
      else if (key === 'HEAD') w.head = rest.join(' ');
      else if (key === 'branch') w.branch = rest.join(' ').replace(/^refs\/heads\//, '');
      else if (key === 'bare') w.bare = true;
      else if (key === 'locked') w.locked = true;
      else if (key === 'prunable') w.prunable = true;
    }
    if (w.path) out.push(w);
  }
  return out;
}

/** A path as `ps` and `realpath` may print it: macOS's /var is /private/var. */
const canon = (p) => String(p).replace(/^\/private\//, '/');

/**
 * The directories among `dirs` that a running process's executable or cwd lives in. null when
 * `rows` or `cwds` is null -- ps or lsof failed -- so a failed reading is unknown, never none.
 */
export function inUse(dirs, rows, cwds = []) {
  if (!rows || !cwds) return null;
  const under = (p, d) => canon(p) === canon(d) || canon(p).startsWith(`${canon(d)}/`);
  return new Set(dirs.filter((d) => rows.some((r) => under(r.command, d)) || cwds.some((c) => under(c, d))));
}

/** Chrome's clones ({ name, written }) under `root` to remove: settled, none a running Chrome uses; null when `rows` is null (ps failed). */
export function clonesToRemove(entries, root, rows, now) {
  const busy = inUse(entries.map((e) => path.join(root, e.name)), rows);
  if (!busy) return null;
  return { remove: settled(entries, now).filter((e) => !busy.has(path.join(root, e.name))).map((e) => e.name), busy: busy.size };
}

/**
 * The checkout whose registry holds a recorded repository's rows: the main one, as the commit
 * guard finds it from git's common directory (`commonDir`). A linked worktree records its own top
 * level, but the registry is untracked and lives in the main checkout. null when git could not
 * say: the caller counts the repository held.
 */
export function mainCheckout(repo, commonDir) {
  if (!commonDir) return null;
  return path.basename(commonDir) === '.git' ? path.dirname(commonDir) : repo;
}

/** A registry's held rows: inside the active markers (the whole file without them), first cell a number of 1 or more -- as harness-status reads them. */
export function heldRows(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const b = lines.findIndex((l) => l.includes('<!-- harness:active -->'));
  const e = lines.findIndex((l) => l.includes('<!-- /harness:active -->'));
  const rows = b >= 0 && e > b ? lines.slice(b + 1, e) : lines;
  return rows.filter((l) => Number(/^\s*\|\s*(\d+)\s*\|/.exec(l)?.[1] ?? 0) >= 1);
}

/**
 * A linked worktree's verdict from what the CLI measured: 'remove', or 'keep: <why>'. The rails are
 * one project's, earned: a branch cut from the mainline and not yet started is an ancestor of it
 * too, hence `own`; `git worktree remove` deletes ignored files without a word, hence REBUILDABLE.
 * `ignored` leaves out symbolic links: removing one never touches what it points to.
 */
export function worktreeVerdict(w, { now, idleHours = WORKTREE_IDLE_HOURS, rebuildable = REBUILDABLE, held = [], cwds = [] }) {
  if (w.locked) return 'keep: locked';
  if (!w.branch) return 'keep: detached HEAD';
  if (!w.merged) return 'keep: not merged into the mainline';
  if (!w.own) return 'keep: no commits of its own';
  if (!w.clean) return 'keep: uncommitted or untracked changes';
  const kept = (w.ignored ?? []).filter((p) => !rebuildable.test(p));
  if (kept.length) return `keep: ignored files that are not rebuildable (${kept.slice(0, 3).join(', ')}${kept.length > 3 ? ', …' : ''})`;
  if (held.some((row) => [w.path, w.rel, w.branch].some((s) => s && row.includes(s)))) return 'keep: a held registry row names it';
  const busy = inUse([w.path], [], cwds);
  if (!busy) return 'keep: could not tell which processes run in it (lsof failed)';
  if (busy.size) return 'keep: a process runs inside it';
  if (!Number.isFinite(w.active) || now - w.active < idleHours * HOUR) return `keep: used in the last ${idleHours} h`;
  return 'remove';
}

// Where the agents keep their sessions and the harness its state, relative to the home directory.
const PROTECTED = /^(\.claude\/projects|\.codex\/(sessions|archived_sessions)|\.agents\/harness|Library\/Application Support\/(Claude|ZCode))(\/|$)/;
// Chrome's clone directory, the one root outside the home directory.
const CLONE_ROOT = /^\/var\/folders\/[^/]+\/[^/]+\/X\/com\.google\.Chrome\.code_sign_clone$/;

/**
 * Whether `target` may be deleted: strictly inside its category's `root`; the root strictly inside
 * the home directory (or Chrome's clone directory); and nothing where the agents keep sessions or
 * the harness keeps state. A computed path that went wrong -- an empty variable, a home of `/` --
 * fails here before anything is removed. The same holds again where the links lead (`real`, the
 * CLI's native realpath): a cache directory, or one above it, linked into the sessions would
 * otherwise carry the removal there. That check starts from the target as written, so a `..`
 * after a link climbs from where the link leads, as the removal would. The target's own name is
 * never followed: removing a link removes the link. A `real` that throws refuses.
 */
export function deletable(target, root, home, real = (p) => p) {
  const inside = (child, parent) => {
    const rel = path.relative(parent, child);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const allowed = (t, r, h) => {
    if (!inside(t, r)) return false;
    if (CLONE_ROOT.test(canon(r))) return true;
    if (h === path.parse(h).root || !inside(r, h)) return false;
    return !PROTECTED.test(path.relative(h, t).split(path.sep).join('/'));
  };
  const t = path.resolve(target);
  const r = path.resolve(root);
  const h = path.resolve(home);
  if (!allowed(t, r, h)) return false;
  let physical;
  try {
    // path.resolve(target) above cancels `x/..` as text; the filesystem climbs from where x leads
    physical = [path.join(path.resolve(real(path.dirname(target))), path.basename(target)), path.resolve(real(r)), path.resolve(real(h))];
  } catch {
    return false;
  }
  return allowed(...physical);
}

/** The process id a lock entry's name (`<pid>-<start>`, or a bare pid) holds, or null when it holds none. */
export function lockPid(text) {
  const m = /^\s*([1-9]\d*)(?:-[0-9a-z]+)?\s*$/.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

/** The name of a run's lock entry: its pid and its start, so a reused pid never names an older run's entry. */
export const lockEntry = (pid, now) => `${pid}-${now.toString(36)}`;

/**
 * What a run does with the lock directory's `entries` ([{ name, written }]) once its own entry,
 * `mine`, is among them: `remove` the entries of runs that are gone (staleLock; an entry with this
 * run's pid and another start is an earlier boot's), and stop when any other entry is a live run's
 * (`holder`, its pid or 'unknown'), else go on. Each run writes its entry before it lists the
 * directory and removes no live run's entry, so of two runs that start together each finds the
 * other's and both stop: the takeover of a dead run's lock can never let two runs free at once.
 */
export function lockDecision({ mine, entries, alive, now }, minutes = LOCK_STALE_MINUTES) {
  const own = lockPid(mine);
  const remove = [];
  let holder = null;
  for (const e of entries) {
    if (e.name === mine) continue;
    const pid = lockPid(e.name);
    if (pid === own || staleLock({ pid, alive: pid !== null && alive(pid), written: e.written, now }, minutes)) remove.push(e.name);
    else if (holder === null) holder = pid ?? 'unknown';
  }
  return { remove, holder };
}

/**
 * Whether a lock entry is a dead run's, to remove: the process it names is gone (`alive`, the CLI's
 * kill -0), or it names none and was `written` over LOCK_STALE_MINUTES ago. Age alone never frees
 * a live run's entry: du, `brew cleanup` and the docker prunes may each take ten minutes.
 */
export function staleLock({ pid, alive, written, now }, minutes = LOCK_STALE_MINUTES) {
  if (Number.isInteger(pid)) return !alive;
  return Number.isFinite(written) && now - written > minutes * 60_000;
}

/** Bytes as the report prints them. */
export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;
}

/** One orphaned dev process as the report lists it; `ports` null: lsof failed. */
function devLine(r) {
  const ports = r.ports === null ? '  ports unknown (lsof failed)' : r.ports?.length ? `  listening on ${r.ports.join(', ')}` : '';
  return `  ${String(r.pid).padEnd(6)} up ${r.etime.padEnd(11)} ${fmtBytes(r.rss).padStart(7)}  ${r.command.slice(0, 96)}${r.cwd ? `  (in ${r.cwd})` : ''}${ports}`;
}

/**
 * The report: free disk, one line per category (its size, `≤` where freeing it keeps what is in
 * use, `?` where its size says nothing of what it frees, or why it is absent), the orphaned dev
 * processes (null: ps failed), and how to approve.
 */
export function formatReport({ free, total, measured, approved, dev = [] }) {
  const on = new Set(approved);
  const width = Math.max(...IDS.map((id) => id.length));
  const lines = [`machine-sweep: ${fmtBytes(free)} free of ${fmtBytes(total)} · approved: ${approved.length ? approved.join(', ') : 'none'}`, ''];
  let sum = 0;
  let upTo = false;
  for (const m of measured) {
    const proc = PROCESS_IDS.includes(m.id);
    const size = m.absent ? '-' : proc ? `${m.count ?? 0} proc` : m.unknown ? '?' : `${m.upTo ? '≤' : ''}${fmtBytes(m.bytes)}`;
    if (!m.absent && !proc) {
      sum += m.bytes ?? 0;
      upTo ||= Boolean(m.upTo && m.bytes);
    }
    const what = m.absent ? `absent: ${m.absent}` : m.detail || CATEGORIES.find((c) => c.id === m.id).what;
    lines.push(`${m.id.padEnd(width)}  ${size.padStart(8)}  ${on.has(m.id) ? 'approved' : '        '}  ${what}`);
  }
  lines.push('', `reclaimable: ${upTo ? 'at most' : 'about'} ${fmtBytes(sum)}`);
  lines.push('', `orphaned dev processes, listed and never stopped here: ${dev === null ? 'unknown (ps failed)' : dev.length || 'none'}`);
  for (const r of dev ?? []) lines.push(devLine(r));
  lines.push('', "Approving is the owner's, once: node <this skill>/scripts/machine-sweep.mjs --approve <category>[,<category>…]");
  return `${lines.join('\n')}\n`;
}

/** The sweep log's line for one run: the disk freed (free before and after) and each category's share. */
export function logEntry({ now, before, after, categories, errors }) {
  return { t: new Date(now).toISOString(), freed: Math.max(0, after - before), before, after, categories, errors };
}
