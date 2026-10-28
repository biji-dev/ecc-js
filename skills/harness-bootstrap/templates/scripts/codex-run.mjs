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
 *                          takes no --prompt/--rules-for -- codex refuses a prompt with --base)
 *   --critical             the diff touches critical code (adversarial -> xhigh)
 *   --route                ask the router model even for a table kind
 *   --model <m> --effort <e>  explicit override (still clamped)
 *   --allow-ultra --allow-max --allow-frontier  lift the clamp (`max` is lowered to xhigh
 *                          without --allow-max; --allow-ultra implies it)
 *   --network              workspace-write kinds: allow network (local services for tests)
 *   --image <files...>     attach screenshots (ui-review; any exec kind)
 *   --threshold <pct>      budget guard (default CODEX_RUN_THRESHOLD, else 85)
 *   --timeout-min <n>      kill the run after n minutes (default 45)
 *   --dry-run              print the resolved route and the codex argv, run nothing
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
 * Every run appends a row to <main checkout>/<LEDGER_DIR>/ledger.jsonl.
 */
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

function usage(msg) {
  process.stderr.write(
    `codex-run: ${msg}\nusage: node scripts/codex-run.mjs <kind> --prompt <file> --out <file> [options] (see the file header)\n`,
  );
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

/** SIGTERM alone can be ignored; escalation and settlement must not depend on `close`. */
export function runCodex(argv, { cwd, stdin, logFile, errFile, timeoutMin, spawnProcess = spawn }) {
  return new Promise((resolve) => {
    const log = fs.openSync(logFile, 'w');
    const err = fs.openSync(errFile, 'w');
    const child = spawnProcess(CODEX, argv, { cwd, stdio: ['pipe', log, err] });
    let timedOut = false;
    let settled = false;
    let killTimer;
    let settleTimer;
    const finish = (code, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(settleTimer);
      fs.closeSync(log);
      fs.closeSync(err);
      resolve({ code, timedOut, spawnError });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTimer = setTimeout(() => {
        settleTimer = setTimeout(() => finish(1), 1_000);
        child.kill('SIGKILL');
      }, 20_000);
      child.kill('SIGTERM');
    }, timeoutMin * 60_000);
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

/** Ask the router model; on any failure fall back to the table row. */
async function askRouter(kind, brief, a, scratch) {
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
  let a;
  try {
    a = parseArgs(process.argv.slice(2), process.env);
  } catch (e) {
    usage(e.message);
  }
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
  const { route, budget, routerReason } = await planRun(a, limitsBefore, () =>
    askRouter(a.kind, prompt, a, scratch),
  );
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
  const base = {
    at: new Date(startedAt).toISOString(),
    kind: a.kind,
    model: route.model,
    effort: route.effort,
    sandbox: route.sandbox,
    cwd: a.cwd,
    routerReason,
    clampNotes: route.notes,
    limitsBefore,
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
  const leftovers = writes
    ? worktreeLeftovers({
        before: before.files,
        after: after.files,
        headBefore: before.head,
        headAfter: after.head,
      })
    : null;
  // The wrapper's own verdict and logs are not the slice's work. Real paths: a /tmp or
  // /var scratchpad is a symlink on macOS, and git reports paths under the real root.
  if (leftovers) {
    const outReal = path.join(fs.realpathSync(scratch), path.basename(outFile));
    const own = new Set([outReal, `${outReal}.log`, `${outReal}.stderr.log`]);
    const topReal = fs.realpathSync(after.top);
    const mine = (f) => !own.has(path.join(topReal, f));
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
