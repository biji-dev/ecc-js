#!/usr/bin/env node
// harness-bootstrap codex-run (generated YYYY-MM-DD). The one entry point for every Codex call.
// [M] mechanism (ships as-is): everything below except the two [B] constants (LEDGER_DIR, RULES_FOR);
// the model catalog and the CLI's install paths [B] live at the top of scripts/lib/codex-run-core.mjs.
/**
 * Picks model + effort per task, attaches the area rules Codex never loads itself, runs it,
 * and reports an HONEST exit code with one result line.
 *
 *   node scripts/codex-run.mjs <kind> --prompt <file> --out <verdict.md> [options]
 *
 * kinds: the route table rows in scripts/lib/codex-run-core.mjs (investigate, plan-blind,
 * review, lane-a, adversarial, adversarial-frontier, implement-cold, fix-cold, docs,
 * ui-review) or `auto` (a cheap router-model call picks; the clamp bounds it).
 *
 * options:
 *   --cwd <dir>            repo/worktree Codex works in (default: cwd)
 *   --rules-for <files...> append the rule files the project's resolver selects for these paths
 *   --base <sha>           review: the base to diff against (required for `review`; review
 *                          takes no --prompt/--rules-for -- codex refuses a prompt with --base).
 *                          adversarial, adversarial-frontier: optional, a commit or a tree the
 *                          brief's diff starts from; recorded in the ledger, never passed to codex
 *   --critical             the diff touches critical code (adversarial -> xhigh)
 *   --route                ask the router model even for a table kind
 *   --model <m> --effort <e>  explicit override (still clamped)
 *   --allow-ultra --allow-max --allow-frontier  lift the clamp (`max` is lowered to xhigh
 *                          without --allow-max; --allow-ultra implies it)
 *   --network              workspace-write kinds: allow network (local services for tests)
 *   --image <files...>     attach screenshots (ui-review; any exec kind)
 *   --threshold <pct>      budget guard (default CODEX_RUN_THRESHOLD, else 85)
 *   --timeout-min <n>      kill the run after n minutes (default 45; under 20 is raised to 20)
 *   --dry-run              print the resolved route and the codex argv, run nothing
 *
 *   node scripts/codex-run.mjs --status [--out <file>] [--cwd <dir>] [--sample-ms <n>]
 *
 * --status says of each run in flight whether it is `running` (CPU time or its log grew over
 * --sample-ms, default 5000), `quiet` (alive, no growth: reported, never acted on), `dead` (no pid
 * alive: check the worktree, then remove the sidecar it names) or `done <outcome>` (its ledger row
 * is in); with --out, only that run, from the ledger once it finished. It exits 0, never kills and
 * never deletes. A run in flight, from its router call on (`auto`, --route), is
 * <ledger dir>/running/<startMs>-<pid>.json (scripts/lib/run-status.mjs); its ledger row carries that
 * stem as `run`, and every row carries --out as `out`.
 *
 * exit: 0 ok (non-empty verdict, recovered retries allowed) | 1 failed | 2 usage | 3 unavailable
 * (quota/login/missing binary -> take the Claude fallback, ledger row `unavailable`) | 4 reserved
 * by the budget guard or the owner's switch (-> do it with Claude).
 *
 * env: CODEX_RUN=on|essential|off -- `essential` runs only the essential kinds (review,
 * adversarial, adversarial-frontier); `off` reserves every kind. CODEX_RUN_THRESHOLD=<pct>
 * moves the budget guard. The codex binary is CODEX_BIN, else the CLI installed under the
 * home directory (CODEX_CANDIDATES in the core), else `codex` on PATH: a terminal's own
 * `codex` shim can come first on PATH, and the installed CLI is the one to run.
 * CODEX_HOME is where session rollouts are read for the weekly reading (default ~/.codex).
 *
 * Write kinds report what they left: `commits=<a>..<b>`, `uncommitted=<n>` and
 * `dirty-before=<k>` (of those, paths that already held uncommitted work; ledger
 * `leftovers`) -- a run that died mid-slice leaves partial work in the worktree.
 *
 * The model runs in a process group of its own (POSIX) with HARNESS_ROLE=executor in its env. A timeout
 * sends SIGTERM, then SIGKILL, to the whole group, so no shell or test runner it started outlives the
 * run; this wrapper's own SIGINT or SIGTERM passes SIGTERM to the group first.
 *
 * Every run appends a row to <main checkout>/<LEDGER_DIR>/ledger.jsonl. A run whose sandbox is not
 * workspace-write (a read or review run) also records `tree` (the git tree id of the tracked files
 * at dispatch) and `branch` (the checked-out branch, null when detached), taken before the model
 * starts. A review, adversarial or adversarial-frontier row adds `baseTree` (the tree its diff
 * starts from: review's merge base with --base, else the adversarial --base, else null) and
 * `treeAfter` (the same snapshot once the model exits, with `treeMoved: true` when it differs). The
 * landing check (review-gate.mjs --landing) follows each critical file from the mainline through the
 * reviewed `baseTree -> tree` changes. Each tree is null when git fails.
 */
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  EXIT,
  ROUTES,
  ROUTER_SCHEMA,
  buildRouterPrompt,
  classify,
  codexArgv,
  codexBinary,
  formatDuration,
  formatTokens,
  freshestLimits,
  lastRateLimits,
  parseArgs,
  parseEvents,
  parsePorcelainZ,
  planRun,
  resolveRoute,
  runUsage,
  validateRouterAnswer,
  worktreeLeftovers,
} from './lib/codex-run-core.mjs';
import { baseTreeOf, currentBranch, snapshotTree } from './lib/snapshot-tree.mjs';

// The kinds the landing check reads (LANDING_KINDS in scripts/lib/review-gate-core.mjs).
const LANDING_KINDS = ['review', 'adversarial', 'adversarial-frontier'];

// [B] Where the ledger lives, relative to the main checkout (gitignore it).
const LEDGER_DIR = '.codex-runs';
// [B] The project's rule resolver: [script relative to the repo this wrapper lives in, flag].
// Run as `node <script> <flag> <changed files...>`; it prints one rule-file path per line.
const RULES_FOR = ['scripts/check-agent-docs.mjs', '--rules-for'];

/** True for a regular file the current user can execute; any error reads as no. */
function isExecutable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// A missing binary classifies as `unavailable` (exit 3), never a crash.
const CODEX = codexBinary(process.env, os.homedir(), isExecutable);
const SESSIONS = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
const SCRIPT_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES_RESOLVER = path.join(SCRIPT_REPO, RULES_FOR[0]);

const USAGE =
  'usage: node scripts/codex-run.mjs <kind> --prompt <file> --out <file> [options] | --status [--out <file>] (see the file header)';

// Loaded on first use: a dry run, a usage error and a reserved run need only the core.
const runStatus = () => import('./lib/run-status.mjs');

function usage(msg) {
  process.stderr.write(`codex-run: ${msg}\n${USAGE}\n`);
  process.exit(EXIT.usage);
}

/** Main checkout root, so worktrees share one ledger. */
function ledgerPath(cwd) {
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd, encoding: 'utf8' },
    ).trim();
    return path.join(path.dirname(common), LEDGER_DIR, 'ledger.jsonl');
  } catch {
    return path.join(cwd, LEDGER_DIR, 'ledger.jsonl');
  }
}

/** Raw output: callers trim what they need (a trimmed porcelain loses its leading space). */
function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
  } catch {
    return '';
  }
}

function fileHash(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null; // deleted, or not a regular file
  }
}

/** HEAD plus every dirty path's status and content hash (porcelain paths are root-relative). */
function worktreeState(cwd) {
  const top = git(['rev-parse', '--show-toplevel'], cwd).trim() || cwd;
  const status = parsePorcelainZ(
    git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd),
  );
  const files = {};
  for (const [f, st] of Object.entries(status))
    files[f] = { status: st, hash: fileHash(path.join(top, f)) };
  return { head: git(['rev-parse', 'HEAD'], cwd).trim(), top, files };
}

function appendLedger(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

/** Read account-wide rollouts first, then compare their mtime with the ledger's observation. */
export function knownLimits(ledger, sessions = SESSIONS) {
  const rollout = newestRolloutLimits(0, sessions);
  let latest = null;
  try {
    const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n');
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = JSON.parse(rows[i]);
      const observedAt = Date.parse(r.at);
      if (
        r.limitsAfter &&
        Number.isFinite(observedAt) &&
        (!latest || observedAt > latest.observedAt)
      )
        latest = { limits: r.limitsAfter, observedAt };
    }
  } catch {
    /* no ledger yet */
  }
  return freshestLimits(rollout, latest);
}

/** Resumed sessions keep their original date directory: discover all rollouts, order by mtime. */
function newestRolloutLimits(sinceMs, sessions = SESSIONS) {
  let entries;
  try {
    entries = fs.readdirSync(sessions, { recursive: true, withFileTypes: true });
  } catch {
    return null;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    try {
      // `parentPath` is Node >=20.12 / 18.20; older 20.x only has `path`. Resolving it inside the
      // try means an odd entry is "no reading", never a crash of every run.
      const f = path.join(entry.parentPath ?? entry.path, entry.name);
      const m = fs.statSync(f).mtimeMs;
      if (m >= sinceMs) files.push({ f, m });
    } catch {
      /* another session may have removed the file */
    }
  }
  files.sort((x, y) => y.m - x.m);
  for (const { f, m } of files) {
    try {
      const limits = lastRateLimits(fs.readFileSync(f, 'utf8'));
      if (limits) return { limits, observedAt: m };
    } catch {
      /* another session may have removed the file */
    }
  }
  return null;
}

/** The rule files the resolver selects for these paths, as one prompt section ('' when none). */
function rulesText(files, cwd) {
  if (files.length === 0) return '';
  const out = execFileSync(process.execPath, [RULES_RESOLVER, RULES_FOR[1], ...files], {
    cwd: SCRIPT_REPO,
    encoding: 'utf8',
  });
  const rules = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (rules.length === 0) return '';
  const body = rules
    .map(
      (r) =>
        `### ${r}\n\n${fs.readFileSync(path.join(fs.existsSync(path.join(cwd, r)) ? cwd : SCRIPT_REPO, r), 'utf8')}`,
    )
    .join('\n\n');
  return `\n\n## Area rules that apply to this change (from the project's rule files; you do not load these yourself)\n\n${body}`;
}

/** POSIX: the model leads a process group of its own, so a signal reaches whatever it started. */
const GROUP = process.platform !== 'win32';

/** SIGTERM alone can be ignored; escalation and settlement must not depend on `close`. */
export function runCodex(argv, { cwd, stdin, logFile, errFile, timeoutMin, spawnProcess = spawn, onSpawn }) {
  return new Promise((resolve) => {
    const log = fs.openSync(logFile, 'w');
    const err = fs.openSync(errFile, 'w');
    const child = spawnProcess(CODEX, argv, {
      cwd,
      stdio: ['pipe', log, err],
      env: { ...process.env, HARNESS_ROLE: 'executor' },
      detached: GROUP,
    });
    if (onSpawn && child.pid) onSpawn(child.pid);
    let timedOut = false;
    let settled = false;
    let killTimer;
    let settleTimer;
    // The whole group, so a shell or test runner the model started stops with it; the child alone
    // when the group kill throws (no pid, already gone) and on Windows.
    const killTree = (sig) => {
      try {
        if (!GROUP || !child.pid) throw new Error('no process group');
        process.kill(-child.pid, sig);
      } catch {
        child.kill(sig);
      }
    };
    // A detached child no longer gets the terminal's signal: pass this wrapper's own stop on, then
    // let the close or the timeout settle the run as usual.
    const forward = () => killTree('SIGTERM');
    const finish = (code, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(settleTimer);
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
      fs.closeSync(log);
      fs.closeSync(err);
      resolve({ code, timedOut, spawnError });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTimer = setTimeout(() => {
        settleTimer = setTimeout(() => finish(1), 1_000);
        killTree('SIGKILL');
      }, 20_000);
      killTree('SIGTERM');
    }, timeoutMin * 60_000);
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
    child.on('error', (e) => {
      if (settled) return;
      fs.appendFileSync(errFile, `ERROR: spawn ${CODEX}: ${e.message}\n`);
      finish(127, e.code);
    });
    child.on('close', (code) => finish(code ?? 1));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

/** The tree a landing kind's diff starts from: review's merge base with --base, else the adversarial --base. */
function landingBase(a, route) {
  if (route.mode === 'review') return baseTreeOf(a.cwd, a.base, { mergeBase: true });
  return a.base ? baseTreeOf(a.cwd, a.base) : null;
}

/** The reviewer read the live working tree: an edit during the run detaches the row from `tree`. */
function treeAfterRun(cwd, tree) {
  const treeAfter = snapshotTree(cwd);
  return treeAfter === tree ? { treeAfter } : { treeAfter, treeMoved: true };
}

/** `--status`: each run in flight beside this checkout's ledger, or the ledger's word on --out. */
async function showStatus(a) {
  const { status } = await runStatus();
  const cwd = path.resolve(a.cwd ?? process.cwd());
  const { lines } = await status({
    wrapper: 'codex-run',
    ledgerFile: ledgerPath(cwd),
    out: a.out ? path.resolve(a.out) : null,
    sampleMs: a.sampleMs,
  });
  for (const line of lines) console.log(line);
  return EXIT.ok;
}

/** Ask the router model; on any failure fall back to the table row. `onSpawn` gets the router's pid and log. */
async function askRouter(kind, brief, a, scratch, onSpawn) {
  const r = resolveRoute('route');
  const invocation = `${process.pid}-${Date.now()}`;
  const schema = path.join(scratch, `router-schema.${invocation}.json`);
  const out = path.join(scratch, `router.${invocation}.out.json`);
  fs.rmSync(schema, { force: true });
  fs.rmSync(out, { force: true });
  fs.writeFileSync(schema, JSON.stringify(ROUTER_SCHEMA));
  const argv = codexArgv(r, a, out, ['--ephemeral', '--output-schema', schema]);
  const res = await runCodex(argv, {
    cwd: a.cwd,
    stdin: buildRouterPrompt(kind, brief),
    logFile: `${out}.log`,
    errFile: `${out}.stderr.log`,
    timeoutMin: 5,
    onSpawn: (pid) => onSpawn(pid, `${out}.log`),
  });
  try {
    const answer = validateRouterAnswer(
      res.timedOut ? 1 : res.code,
      JSON.parse(fs.readFileSync(out, 'utf8')),
    );
    if (answer) return answer;
  } catch {
    /* missing or malformed answer */
  } finally {
    for (const f of [schema, out, `${out}.log`, `${out}.stderr.log`]) fs.rmSync(f, { force: true });
  }
  process.stderr.write(
    `codex-run: router gave no valid answer (codex exit ${res.code}); using the table row\n`,
  );
  return null;
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  let a;
  try {
    a = parseArgs(process.argv.slice(2), process.env);
  } catch (e) {
    usage(e.message);
  }
  if (a.status) return showStatus(a);
  if (a.timeoutRaisedFrom !== undefined)
    process.stderr.write(`codex-run: --timeout-min ${a.timeoutRaisedFrom} raised to ${a.timeoutMin}: a run keeps its time; launch it with the host's own background option (Claude Code: the Bash tool's run_in_background) instead of shortening it\n`);
  if (!a.kind || !ROUTES[a.kind] || a.kind === 'route')
    usage(
      `kind must be one of: ${Object.keys(ROUTES)
        .filter((k) => k !== 'route')
        .join(', ')}`,
    );
  if (!a.out) usage('--out is required');
  a.cwd = path.resolve(a.cwd ?? process.cwd());
  const isReview = ROUTES[a.kind].mode === 'review';
  if (isReview && !a.base) usage('review needs --base <sha>');
  // codex: "the argument '--base <BRANCH>' cannot be used with '[PROMPT]'". The built-in
  // reviewer reads AGENTS.md only; a focus or the area rules go to `adversarial`, which takes both.
  if (isReview && (a.prompt || a.rulesFor.length))
    usage(
      'review takes no --prompt/--rules-for (codex: --base cannot be used with a prompt) -- put the focus and rules in an `adversarial` run',
    );
  if (!isReview && !a.prompt) usage('--prompt is required');
  // Never silently skip the rules the caller asked for.
  if (a.rulesFor.length && !fs.existsSync(RULES_RESOLVER))
    usage(
      `--rules-for needs the rule resolver ${RULES_FOR[0]} (not found at ${RULES_RESOLVER}); install it or drop --rules-for`,
    );
  if (isReview && a.images.length) usage('review takes no --image -- use `ui-review`');
  if (a.kind === 'ui-review' && !a.images.length)
    usage('ui-review needs --image <screenshots...> -- a critique without them reads only code');
  for (const f of a.images) if (!fs.existsSync(f)) usage(`--image ${f} does not exist`);
  a.images = a.images.map((f) => path.resolve(f));

  const outFile = path.resolve(a.out);
  const scratch = path.dirname(outFile);
  fs.mkdirSync(scratch, { recursive: true });
  const ledger = ledgerPath(a.cwd);
  const prompt = a.prompt ? fs.readFileSync(a.prompt, 'utf8') : '';

  const limitsBefore = knownLimits(ledger);
  // The run's sidecar says it is in flight (--status): written before the router call when there is
  // one, else once the budget guard lets the run go; the finally removes it once the ledger row is in.
  // A dry run and a reserved run write none.
  let sidecar = null;
  const inFlight = async (at) => {
    const { openSidecar } = await runStatus();
    sidecar = openSidecar(ledger, {
      at,
      kind: a.kind,
      cwd: a.cwd,
      out: outFile,
      log: `${outFile}.log`,
      wrapperPid: process.pid,
      wrapperStart: new Date(performance.timeOrigin).toISOString(),
      childPid: null,
      childStart: null,
    });
  };
  const childSpawned = (pid, log = `${outFile}.log`) =>
    sidecar.update({ childPid: pid, childStart: new Date().toISOString(), log });
  try {
    const { route, budget, routerReason } = await planRun(a, limitsBefore, async () => {
      await inFlight(new Date().toISOString());
      return askRouter(a.kind, prompt, a, scratch, childSpawned);
    });
    // Routing is done: the router's pid and log go, the model's child and log take their place at the spawn.
    sidecar?.update({ kind: route.kind, childPid: null, childStart: null, log: `${outFile}.log` });
    const fullPrompt = prompt + rulesText(a.rulesFor, a.cwd);
    const argv = codexArgv(route, a, outFile);

    if (a.flags.has('dry-run')) {
      console.log(
        JSON.stringify(
          {
            route,
            budget,
            limitsBefore,
            argv: [CODEX, ...argv],
            promptBytes: Buffer.byteLength(fullPrompt),
          },
          null,
          2,
        ),
      );
      return EXIT.ok;
    }

    const startedAt = Date.now();
    if (budget.run && !sidecar) await inFlight(new Date(startedAt).toISOString());
    // A run that cannot write is a review or a read: the tree it reads is recorded before the model
    // starts. A landing kind also records the tree its diff starts from, so its row names a range.
    const landing = LANDING_KINDS.includes(a.kind) && route.sandbox !== 'workspace-write';
    const snapshot =
      route.sandbox === 'workspace-write'
        ? {}
        : { tree: snapshotTree(a.cwd), branch: currentBranch(a.cwd), ...(landing ? { baseTree: landingBase(a, route) } : {}) };
    // Every row carries --out; a row written while the sidecar exists carries its run and its start
    // (a routed run's is the router call's).
    const base = {
      ...(sidecar ? { run: sidecar.record.run } : {}),
      at: sidecar ? sidecar.record.at : new Date(startedAt).toISOString(),
      kind: a.kind,
      model: route.model,
      effort: route.effort,
      sandbox: route.sandbox,
      cwd: a.cwd,
      out: outFile,
      routerReason,
      clampNotes: route.notes,
      limitsBefore,
      ...snapshot,
    };
    if (!budget.run) {
      appendLedger(ledger, { ...base, outcome: 'reserved', reason: budget.reason });
      console.log(`codex-run: reserved kind=${a.kind} — ${budget.reason}`);
      return EXIT.reserved;
    }

    fs.rmSync(outFile, { force: true });
    const writes = route.sandbox === 'workspace-write';
    const before = writes ? worktreeState(a.cwd) : null;
    const logFile = `${outFile}.log`;
    const errFile = `${outFile}.stderr.log`;
    const res = await runCodex(argv, {
      cwd: a.cwd,
      stdin: fullPrompt,
      logFile,
      errFile,
      timeoutMin: a.timeoutMin,
      onSpawn: childSpawned,
    });
    const events = parseEvents(fs.readFileSync(logFile, 'utf8'));
    const verdict = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    const stderr = fs.readFileSync(errFile, 'utf8');
    const result = res.timedOut
      ? { outcome: 'failed', exit: EXIT.failed, reason: `timed out after ${a.timeoutMin} min` }
      : classify({
          exitCode: res.code,
          events,
          verdict,
          stderr,
          mode: route.mode,
          spawnError: res.spawnError,
          binary: CODEX,
        });
    const limitsAfter = newestRolloutLimits(startedAt)?.limits ?? null;
    const tokenUsage = runUsage(route.mode, events.usage);
    const ms = Date.now() - startedAt;
    const after = writes ? worktreeState(a.cwd) : null;
    const moved = landing ? treeAfterRun(a.cwd, snapshot.tree) : {};
    const leftovers = writes
      ? worktreeLeftovers({
          before: before.files,
          after: after.files,
          headBefore: before.head,
          headAfter: after.head,
        })
      : null;
    // The wrapper's own verdict, logs and run sidecars are not the slice's work. Real paths: a
    // /tmp or /var scratchpad is a symlink on macOS, and git reports paths under the real root.
    if (leftovers) {
      const outReal = path.join(fs.realpathSync(scratch), path.basename(outFile));
      const own = new Set([outReal, `${outReal}.log`, `${outReal}.stderr.log`]);
      const sidecars = `${fs.realpathSync(path.dirname(sidecar.file))}${path.sep}`;
      const topReal = fs.realpathSync(after.top);
      const mine = (f) => !own.has(path.join(topReal, f)) && !path.join(topReal, f).startsWith(sidecars);
      leftovers.files = leftovers.files.filter(mine);
      leftovers.dirtyBefore = leftovers.dirtyBefore.filter(mine);
    }

    appendLedger(ledger, {
      ...base,
      outcome: result.outcome,
      reason: result.reason,
      codexExit: res.code,
      threadId: events.threadId,
      usage: tokenUsage,
      ms,
      limitsAfter,
      verdict: outFile,
      ...moved,
      ...(leftovers ? { leftovers } : {}),
    });

    const weekly = (l) => (l ? `${l.usedPercent}%` : '?');
    const notes = route.notes.length ? ` clamp=[${route.notes.join('; ')}]` : '';
    const left = !leftovers
      ? ''
      : `${leftovers.commits ? ` commits=${leftovers.commits}` : ''}${leftovers.files.length ? ` uncommitted=${leftovers.files.length}` : ''}${leftovers.dirtyBefore.length ? ` dirty-before=${leftovers.dirtyBefore.length}` : ''}`;
    console.log(
      `codex-run: ${result.outcome} kind=${a.kind} model=${route.model} effort=${route.effort} tokens=${formatTokens(tokenUsage?.total ?? null)} weekly=${weekly(limitsBefore)}→${weekly(limitsAfter)} ${formatDuration(ms)} verdict=${outFile}${left}${notes}${result.reason ? ` — ${result.reason}` : ''}`,
    );
    return result.exit;
  } finally {
    sidecar?.remove();
  }
}

// Run only as the entry script (the tests import knownLimits/runCodex). Compare REAL paths:
// import.meta.url is symlink-resolved, argv[1] is not (macOS /tmp -> /private/tmp), and a
// mismatch here used to skip main() and exit 0 with no verdict -- a false success.
function isEntry() {
  try {
    return (
      Boolean(process.argv[1]) &&
      fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isEntry())
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`codex-run: ${e.stack ?? e}\n`);
      process.exit(EXIT.failed);
    },
  );
