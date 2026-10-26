#!/usr/bin/env node
// harness-bootstrap claude-run (generated YYYY-MM-DD). The one entry point for every Claude call from a
// host that is not Claude Code. [M] mechanism (ships as-is): everything below except LEDGER_DIR [B];
// the models and the dollar cap [B] live at the top of scripts/lib/claude-run-core.mjs.
/**
 * The mirror of codex-run for Codex and ZCode hosts: `claude -p`, read-only (Read, Grep, Glob),
 * no settings, hooks or MCP servers, capped in dollars, with an HONEST exit code and one result line.
 *
 *   node scripts/claude-run.mjs <kind> [--prompt <file>] [--base <ref>] [--out <verdict.md>] [options]
 *
 * kinds: review (the diff against --base; --prompt adds a focus), adversarial, plan-blind,
 * investigate, lane-a (each from its --prompt brief). Writing is never a kind: the second family
 * reviews from here, and the host builds.
 *
 * options:
 *   --kind <kind>          the kind, as a flag
 *   --cwd <dir>            repo/worktree the run reads (default: cwd); the file tools stay inside it
 *   --out <file>           the verdict (default <cwd>/.review-work/claude-<kind>/verdict.md)
 *   --critical             the diff touches critical code (adversarial -> xhigh)
 *   --model <m> --effort <high|xhigh>  explicit override (max is the owner's word, not a flag)
 *   --budget-usd <n>       the dollar cap of this run (default BUDGET_USD)
 *   --timeout-min <n>      kill the run after n minutes (default 45)
 *   --dry-run              print the route and the claude argv, run and write nothing
 *
 * review writes `git diff --merge-base <base>` (the working tree against the merge base) beside
 * the verdict and has the reviewer Read it: commit or stage new files first, an untracked file is
 * not in the diff.
 *
 * exit: 0 ok (a non-empty verdict) | 1 failed | 2 usage, or the host is Claude Code (its second
 * family is Codex: codex-run.mjs) | 3 unavailable (no binary, not logged in, no network -- a
 * Codex sandbox has none -- a usage limit: take the fallback, ledger `unavailable`) | 4 reserved
 * by the owner's switch.
 *
 * env: CLAUDE_RUN=on|essential|off -- `essential` runs only review and adversarial; `off`
 * reserves every kind. CLAUDE_BIN overrides the claude binary (default `claude` on PATH).
 *
 * Every run but a dry run or a usage error appends a row to <main checkout>/<LEDGER_DIR>/ledger.jsonl.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT,
  budgetDecision,
  claudeArgv,
  classify,
  framePrompt,
  hostCheck,
  networkCheck,
  parseArgs,
  resolveRoute,
  reviewPrompt,
} from './lib/claude-run-core.mjs';

// [B] Where the ledger lives, relative to the main checkout (gitignore it).
const LEDGER_DIR = '.claude-runs';

const CLAUDE = process.env.CLAUDE_BIN || 'claude';

function usage(msg) {
  process.stderr.write(
    `claude-run: ${msg}\nusage: node scripts/claude-run.mjs <kind> [--prompt <file>] [--base <ref>] [--out <file>] [options] (see the file header)\n`,
  );
  return EXIT.usage;
}

/** Main checkout root, so worktrees share one ledger. */
function ledgerPath(cwd) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.join(path.dirname(common), LEDGER_DIR, 'ledger.jsonl');
  } catch {
    return path.join(cwd, LEDGER_DIR, 'ledger.jsonl');
  }
}

function appendLedger(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

/** SIGTERM alone can be ignored; escalation and settlement must not depend on `close`. */
export function runClaude(argv, { cwd, stdin, timeoutMin, spawnProcess = spawn }) {
  return new Promise((resolve) => {
    const child = spawnProcess(CLAUDE, argv, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
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
      resolve({ code, stdout, stderr, timedOut, spawnError });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTimer = setTimeout(() => {
        settleTimer = setTimeout(() => finish(1), 1_000);
        child.kill('SIGKILL');
      }, 20_000);
      child.kill('SIGTERM');
    }, timeoutMin * 60_000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => finish(127, e.code));
    child.on('close', (code) => finish(code ?? 1));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** The review's diff, or a usage error: a ref git cannot read, or nothing to review. */
function writeDiff(a, file) {
  let diff;
  try {
    diff = execFileSync('git', ['diff', '--merge-base', a.base], { cwd: a.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    return `git diff --merge-base ${a.base} failed: ${String(e.stderr ?? e.message).trim().split('\n')[0]}`;
  }
  if (!diff.trim()) return `nothing to review: the working tree matches its merge base with ${a.base}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, diff);
  return null;
}

/** Where the run writes, its route, its argv and its brief; throws when the --prompt file is unreadable. */
function planRun(a) {
  const outFile = a.out ? path.resolve(a.out) : path.join(a.cwd, '.review-work', `claude-${a.kind}`, 'verdict.md');
  const scratch = path.dirname(outFile);
  const diffFile = path.join(scratch, 'diff.patch');
  const rel = path.relative(a.cwd, scratch);
  // --restricted keeps the file tools inside the working directories: a scratch outside is added
  const inside = !rel.startsWith('..') && !path.isAbsolute(rel);
  const route = resolveRoute(a);
  const argv = claudeArgv(route, a, { addDirs: inside ? [] : [scratch] });
  let given = '';
  try {
    given = a.prompt ? fs.readFileSync(a.prompt, 'utf8') : '';
  } catch (e) {
    throw new Error(`--prompt ${a.prompt}: ${e.code ?? e.message}`);
  }
  const brief =
    a.kind === 'review'
      ? reviewPrompt({ diffRel: inside ? path.relative(a.cwd, diffFile) : diffFile, base: a.base, focus: given })
      : framePrompt(a.kind, given);
  return { outFile, scratch, diffFile, route, argv, brief };
}

/** The verdict (or the run's output, for a failure), the ledger row and the one result line. */
function record({ a, run, res, result, ms, ledger, base }) {
  if (result.outcome === 'ok') fs.writeFileSync(run.outFile, `${result.text}\n`);
  else fs.writeFileSync(`${run.outFile}.stderr.log`, `${res.stderr}${res.stdout}`);
  const ok = result.outcome === 'ok';
  appendLedger(ledger, {
    ...base,
    outcome: result.outcome,
    reason: result.reason,
    claudeExit: res.code,
    costUsd: result.costUsd ?? null,
    turns: result.turns ?? null,
    ms,
    verdict: ok ? run.outFile : null,
  });
  const cost = Number.isFinite(result.costUsd) ? `$${result.costUsd.toFixed(2)}` : '?';
  console.log(
    `claude-run: ${result.outcome} kind=${a.kind} model=${run.route.model} effort=${run.route.effort} cost=${cost} turns=${result.turns ?? '?'} ${formatDuration(ms)}${ok ? ` verdict=${run.outFile}` : ''}${result.reason ? ` — ${result.reason}` : ''}`,
  );
  return result.exit;
}

async function main() {
  let a;
  let run;
  try {
    a = parseArgs(process.argv.slice(2), process.env);
    const host = hostCheck(process.env);
    if (!host.ok) throw new Error(host.why);
    a.cwd = path.resolve(a.cwd ?? process.cwd());
    run = planRun(a);
  } catch (e) {
    return usage(e.message);
  }
  const network = networkCheck(process.env);
  const budget = budgetDecision(a.kind, a.mode);

  if (a.dryRun) {
    const diff = a.kind === 'review' ? { diff: `git diff --merge-base ${a.base} > ${run.diffFile}` } : {};
    const shown = { kind: a.kind, route: run.route, budget, network, ...diff, argv: [CLAUDE, ...run.argv], promptBytes: Buffer.byteLength(run.brief) };
    console.log(JSON.stringify(shown, null, 2));
    return EXIT.ok;
  }

  const ledger = ledgerPath(a.cwd);
  const base = { at: new Date().toISOString(), kind: a.kind, model: run.route.model, effort: run.route.effort, budgetUsd: a.budgetUsd, cwd: a.cwd };
  const stop = !budget.run ? ['reserved', budget.reason] : !network.ok ? ['unavailable', network.why] : null;
  if (stop) {
    appendLedger(ledger, { ...base, outcome: stop[0], reason: stop[1] });
    console.log(`claude-run: ${stop[0]} kind=${a.kind} — ${stop[1]}`);
    return EXIT[stop[0]];
  }
  if (a.kind === 'review') {
    const problem = writeDiff(a, run.diffFile);
    if (problem) return usage(problem);
  }

  fs.mkdirSync(run.scratch, { recursive: true });
  fs.rmSync(run.outFile, { force: true });
  const startedAt = Date.now();
  const res = await runClaude(run.argv, { cwd: a.cwd, stdin: run.brief, timeoutMin: a.timeoutMin });
  const result = classify({
    exitCode: res.code,
    stdout: res.stdout,
    spawnError: res.spawnError,
    timedOut: res.timedOut,
    timeoutMin: a.timeoutMin,
    budgetUsd: a.budgetUsd,
    binary: CLAUDE,
  });
  return record({ a, run, res, result, ms: Date.now() - startedAt, ledger, base });
}

// Run only as the entry script (the tests may import runClaude). Compare REAL paths: macOS /tmp
// is a symlink, and a mismatch would skip main() and exit 0 with no verdict.
function isEntry() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry())
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`claude-run: ${e.stack ?? e}\n`);
      process.exit(EXIT.failed);
    },
  );
