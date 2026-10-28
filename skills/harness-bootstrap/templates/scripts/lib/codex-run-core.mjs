// harness-bootstrap codex-run core (generated YYYY-MM-DD). Pure core of scripts/codex-run.mjs.
// [M] mechanism (ships as-is): everything below except the model catalog. [B] binding: the
// CATALOG block, re-derived from the models this machine's codex CLI offers; the route table
// rows (ROUTES) are a starting point to tune per project, the clamp and exit codes are not.
/**
 * The per-task route table, the clamp a router's answer passes through, the `--json` event
 * parser, the run verdict and the budget guard. No I/O here, so `codex-run-core.test.mjs`
 * can pin each rule.
 *
 * WHY A TABLE. A bare `codex review` inherits the global `model_reasoning_effort` (often the
 * most expensive setting), while the adversarial pass, where a second model family earns its
 * keep, only ran at `high` when the calling skill remembered to ask. Model and effort follow
 * the task, so the wrapper decides, not the caller's memory.
 */

// [B] Model catalog -- re-derive from the models this machine's codex CLI offers.
// Validated against codex-cli 0.163.
export const CATALOG = {
  default: 'gpt-6.1-sol', // most kinds
  frontier: 'gpt-6-astra', // the frontier adversarial pass only
  router: 'gpt-6-luna', // the cheap router for `auto`
  previous: 'gpt-6-sol', // allowed explicit override
};
export const MODELS = Object.values(CATALOG);
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const DEFAULT_MODEL = CATALOG.default;

// [B] Where the codex CLI's installer puts it, relative to the home directory, tried in order
// before `codex` on PATH: a terminal can put its own `codex` shim first on PATH, and the shim
// adds flags and a hook-trust warning to every run. CODEX_BIN overrides both.
export const CODEX_CANDIDATES = ['.local/bin/codex'];

/**
 * The codex binary a run spawns: a non-empty `env.CODEX_BIN`, else the first
 * CODEX_CANDIDATES path under `home` that `isExecutable` accepts, else `codex` (resolved on
 * PATH; a missing binary classifies as `unavailable`). The caller owns the file system probe.
 */
export function codexBinary(env, home, isExecutable) {
  if (env.CODEX_BIN) return env.CODEX_BIN;
  if (home) {
    for (const c of CODEX_CANDIDATES) {
      const file = `${home.replace(/[\\/]+$/, '')}/${c}`;
      if (isExecutable(file)) return file;
    }
  }
  return 'codex';
}

/**
 * kind -> { model, effort, sandbox, mode, essential }.
 * `essential` kinds are the decorrelated checks: they run even when the weekly
 * budget is low. Everything else yields to Claude past the threshold.
 */
export const ROUTES = {
  route: {
    model: CATALOG.router,
    effort: 'low',
    sandbox: 'read-only',
    mode: 'exec',
    essential: true,
  },
  investigate: {
    model: DEFAULT_MODEL,
    effort: 'high',
    sandbox: 'read-only',
    mode: 'exec',
    essential: false,
  },
  'plan-blind': {
    model: DEFAULT_MODEL,
    effort: 'xhigh',
    sandbox: 'read-only',
    mode: 'exec',
    essential: false,
  },
  review: {
    model: DEFAULT_MODEL,
    effort: 'high',
    sandbox: 'read-only',
    mode: 'review',
    essential: true,
  },
  'lane-a': {
    model: DEFAULT_MODEL,
    effort: 'medium',
    sandbox: 'read-only',
    mode: 'exec',
    essential: false,
  },
  adversarial: {
    model: DEFAULT_MODEL,
    effort: 'high',
    criticalEffort: 'xhigh',
    sandbox: 'read-only',
    mode: 'exec',
    essential: true,
  },
  'adversarial-frontier': {
    model: CATALOG.frontier,
    effort: 'high',
    sandbox: 'read-only',
    mode: 'exec',
    essential: true,
  },
  // Every kind that WRITES runs at high or above; medium/low stay only on lane-a (a literal
  // checklist) and the router (a routing decision).
  'implement-cold': {
    model: DEFAULT_MODEL,
    effort: 'high',
    sandbox: 'workspace-write',
    mode: 'exec',
    essential: false,
  },
  'fix-cold': {
    model: DEFAULT_MODEL,
    effort: 'high',
    sandbox: 'workspace-write',
    mode: 'exec',
    essential: false,
  },
  docs: {
    model: DEFAULT_MODEL,
    effort: 'high',
    sandbox: 'workspace-write',
    mode: 'exec',
    essential: false,
  },
  // The second-family half of a dual UI/UX critique: screenshots go in with --image.
  'ui-review': {
    model: DEFAULT_MODEL,
    effort: 'high',
    sandbox: 'read-only',
    mode: 'exec',
    essential: false,
  },
  // `auto`: no table row fits -- the router model picks, the clamp bounds it.
  auto: {
    model: DEFAULT_MODEL,
    effort: 'high',
    sandbox: 'read-only',
    mode: 'exec',
    essential: false,
  },
};

const WRITE_KINDS = new Set(['implement-cold', 'fix-cold', 'docs']);

/** Exit codes the callers branch on (the CLI's own exit code lies both ways). */
export const EXIT = { ok: 0, failed: 1, usage: 2, unavailable: 3, reserved: 4 };

/**
 * The owner's switch, `CODEX_RUN`: `on` (default), `essential` (only the decorrelated
 * checks run; the rest go to Claude), `off` (every kind goes to Claude). A misspelt value
 * is a usage error, never a silent `on`.
 */
export const RUN_MODES = ['on', 'essential', 'off'];

/** Reject bad numeric flags before NaN can silently reserve every task or disable the timeout. */
export function parseArgs(argv, env = {}) {
  const a = { flags: new Set(), rulesFor: [], images: [], kind: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      return v;
    };
    if (t === '--rules-for' || t === '--image') {
      const list = t === '--image' ? a.images : a.rulesFor;
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) list.push(argv[++i]);
    } else if (
      [
        '--prompt',
        '--out',
        '--cwd',
        '--base',
        '--model',
        '--effort',
        '--threshold',
        '--timeout-min',
      ].includes(t)
    ) {
      a[t.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = val();
    } else if (
      [
        '--critical',
        '--route',
        '--allow-ultra',
        '--allow-max',
        '--allow-frontier',
        '--network',
        '--dry-run',
      ].includes(t)
    ) {
      a.flags.add(t.slice(2));
    } else throw new Error(`unknown option ${t}`);
  }
  // An empty env value means unset, not 0.
  a.threshold = Number(a.threshold ?? (env.CODEX_RUN_THRESHOLD || 85));
  a.timeoutMin = Number(a.timeoutMin ?? 45);
  a.mode = env.CODEX_RUN || 'on';
  if (!RUN_MODES.includes(a.mode))
    throw new Error(`CODEX_RUN must be one of ${RUN_MODES.join('|')} (got "${a.mode}")`);
  if (!Number.isFinite(a.threshold) || a.threshold < 1 || a.threshold > 100)
    throw new Error('--threshold / CODEX_RUN_THRESHOLD must be a number from 1 to 100');
  if (!Number.isFinite(a.timeoutMin) || a.timeoutMin <= 0 || a.timeoutMin * 60_000 > 2_147_483_647)
    throw new Error('--timeout-min must be positive and fit a Node timer');
  return a;
}

/**
 * The route a run uses: the table row, then a router answer or an explicit
 * override, then the clamp. The clamp is what keeps a cheap router from buying an
 * expensive run: `ultra` needs `allowUltra`, `max` needs `allowMax` (or `allowUltra`, which
 * implies it), the frontier model needs its own kind or `allowFrontier`, only write kinds get
 * a writable sandbox, and a write kind never runs below `high`.
 */
export function resolveRoute(kind, opts = {}) {
  const row = ROUTES[kind];
  if (!row) throw new Error(`unknown kind "${kind}" (one of: ${Object.keys(ROUTES).join(', ')})`);
  const notes = [];
  const pick = { ...(opts.routed ?? {}), ...(opts.override ?? {}) };

  let model = pick.model ?? row.model;
  let effort =
    pick.effort ?? (opts.critical && row.criticalEffort ? row.criticalEffort : row.effort);

  if (!MODELS.includes(model)) {
    notes.push(`model ${model} not in catalog -> ${row.model}`);
    model = row.model;
  }
  if (model === CATALOG.frontier && kind !== 'adversarial-frontier' && !opts.allowFrontier) {
    notes.push(`${CATALOG.frontier} needs --allow-frontier -> ${DEFAULT_MODEL}`);
    model = DEFAULT_MODEL;
  }
  if (!EFFORTS.includes(effort)) {
    notes.push(`effort ${effort} unknown -> ${row.effort}`);
    effort = row.effort;
  }
  if (effort === 'ultra' && !opts.allowUltra) {
    notes.push('ultra needs --allow-ultra -> xhigh');
    effort = 'xhigh';
  }
  if (effort === 'max' && !opts.allowMax && !opts.allowUltra) {
    notes.push('max needs --allow-max -> xhigh');
    effort = 'xhigh';
  }
  // A kind that writes never runs below high -- the router and an override included.
  if (WRITE_KINDS.has(kind) && EFFORTS.indexOf(effort) < EFFORTS.indexOf('high')) {
    notes.push(`effort ${effort} below the write floor -> high`);
    effort = 'high';
  }
  // The router model has no ultra; max is its ceiling.
  if (model === CATALOG.router && effort === 'ultra') effort = 'max';

  const sandbox = WRITE_KINDS.has(kind) ? 'workspace-write' : 'read-only';
  if (pick.sandbox && pick.sandbox !== sandbox)
    notes.push(`sandbox ${pick.sandbox} refused -> ${sandbox}`);

  return { kind, model, effort, sandbox, mode: row.mode, essential: row.essential, notes };
}

/** JSON schema the router answers in (`codex exec --output-schema`: strict, all required). */
export const ROUTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['model', 'effort', 'reason'],
  properties: {
    model: { type: 'string', enum: MODELS },
    effort: { type: 'string', enum: EFFORTS },
    reason: { type: 'string' },
  },
};

/** A stale or partial router answer must never override the table after a failed call. */
export function validateRouterAnswer(exitCode, answer) {
  if (exitCode !== 0 || !MODELS.includes(answer?.model) || !EFFORTS.includes(answer?.effort))
    return null;
  return {
    model: answer.model,
    effort: answer.effort,
    reason: typeof answer.reason === 'string' ? answer.reason : '',
  };
}

/** Review has its own model setting and cannot inherit the global writable sandbox. */
export function codexArgv(route, a, outFile, extra = []) {
  const common = [
    '-m',
    route.model,
    '-c',
    `model_reasoning_effort="${route.effort}"`,
    '--json',
    '-o',
    outFile,
    ...extra,
  ];
  if (route.mode === 'review')
    return [
      'exec',
      'review',
      '--base',
      a.base,
      '-c',
      'sandbox_mode="read-only"',
      '-c',
      `review_model="${route.model}"`,
      ...common,
    ];
  const net =
    route.sandbox === 'workspace-write' && a.flags.has('network')
      ? ['-c', 'sandbox_workspace_write.network_access=true']
      : [];
  // `--image=<f>` per file, before `-m`: the flag is variadic and a bare list would swallow `-`.
  const images = (a.images ?? []).map((f) => `--image=${f}`);
  return ['exec', '-s', route.sandbox, '-C', a.cwd, ...net, ...images, ...common, '-'];
}

export function buildRouterPrompt(kind, brief) {
  const table = Object.entries(ROUTES)
    .filter(([k]) => k !== 'route' && k !== 'auto')
    .map(([k, r]) => `- ${k}: ${r.model} / ${r.effort}`)
    .join('\n');
  return [
    'You route one coding-agent task to a Codex model and reasoning effort. Do not do the task.',
    '',
    `Models: ${CATALOG.default} (workhorse, the default), ${CATALOG.frontier} (frontier, several times the cost of the`,
    `default: only for security- or money-critical analysis), ${CATALOG.previous} (previous generation of the default),`,
    `${CATALOG.router} (cheap: mechanical, low-risk work).`,
    'Efforts: low, medium, high, xhigh, max, ultra. Higher effort = slower and costlier; most tasks need medium or high;',
    'xhigh for planning or deep analysis; ultra only when the task splits into 3+ independent parts.',
    '',
    'Known task kinds and their routes, for calibration:',
    table,
    '',
    `Task kind requested: ${kind}`,
    'Task brief (may be truncated):',
    '"""',
    brief.slice(0, 6000),
    '"""',
    '',
    'Answer with the cheapest model and effort that will do this task well, and one sentence why.',
  ].join('\n');
}

/**
 * Parse `codex exec --json` output. Top-level `error` events can be retries;
 * classify decides whether a completed turn recovered. Item errors are warnings.
 */
export function parseEvents(jsonl) {
  const out = {
    threadId: null,
    usage: { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 },
    errors: [],
    warnings: [],
    failed: false,
    turns: 0,
  };
  for (const line of jsonl.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === 'thread.started') out.threadId ??= ev.thread_id ?? null;
    else if (ev.type === 'turn.completed') {
      out.turns += 1;
      const u = ev.usage ?? {};
      out.usage.input += u.input_tokens ?? 0;
      out.usage.cached += u.cached_input_tokens ?? 0;
      out.usage.output += u.output_tokens ?? 0;
      out.usage.reasoning += u.reasoning_output_tokens ?? 0;
    } else if (ev.type === 'turn.failed') {
      out.failed = true;
      out.errors.push(String(ev.error?.message ?? 'turn failed'));
    } else if (ev.type === 'error') {
      out.errors.push(String(ev.message ?? 'error'));
    } else if (ev.type === 'item.completed' && ev.item?.type === 'error') {
      out.warnings.push(String(ev.item.message ?? ''));
    }
  }
  out.usage.total = out.usage.input + out.usage.output;
  return out;
}

const UNAVAILABLE =
  /usage limit|rate.?limit|hit your usage|spend.?control|not logged in|log ?in again|unauthori[sz]ed|\b401\b|refresh token|token (?:has )?expired|credits/i;

/**
 * A completed turn can recover retry errors, but a review's generated interruption
 * message is not a verdict. Quota, login and missing-binary failures allow fallback.
 */
export function classify({
  exitCode,
  events,
  verdict,
  stderr = '',
  mode = 'exec',
  spawnError,
  binary,
}) {
  if (spawnError === 'ENOENT')
    return {
      outcome: 'unavailable',
      exit: EXIT.unavailable,
      reason: `codex binary not found: ${binary}`,
    };
  const errorText = [
    ...events.errors,
    stderr
      .split('\n')
      .filter((l) => /^ERROR/.test(l))
      .join('\n'),
  ].join('\n');
  if (mode === 'review' && /^review was interrupted\b/i.test(verdict?.trim() ?? '')) {
    // Interrupted by quota/login -> still the Claude fallback, not "fix the call".
    if (UNAVAILABLE.test(errorText))
      return { outcome: 'unavailable', exit: EXIT.unavailable, reason: firstLine(errorText) };
    return {
      outcome: 'failed',
      exit: EXIT.failed,
      reason: `interrupted review: "${firstLine(verdict.trim())}"`,
    };
  }
  if (events.turns > 0 && !events.failed && verdict?.trim()) {
    const warnings = [...events.warnings, ...events.errors];
    const reasons = exitCode === 0 ? [] : [`codex exit ${exitCode} but verdict present`];
    if (warnings.length) reasons.push(`warnings: ${warnings.join('; ')}`);
    return { outcome: 'ok', exit: EXIT.ok, reason: reasons.join('; ') };
  }
  if (UNAVAILABLE.test(errorText))
    return { outcome: 'unavailable', exit: EXIT.unavailable, reason: firstLine(errorText) };
  if (events.failed || events.errors.length > 0)
    return { outcome: 'failed', exit: EXIT.failed, reason: firstLine(errorText) };
  if (!verdict || !verdict.trim()) {
    // A CLI argument error never reaches the event stream -- its message is on stderr.
    const cli = firstLine(stderr);
    return {
      outcome: 'failed',
      exit: EXIT.failed,
      reason: `empty verdict (codex exit ${exitCode})${cli ? `: ${cli}` : ''}`,
    };
  }
  return {
    outcome: 'ok',
    exit: EXIT.ok,
    reason: exitCode === 0 ? '' : `codex exit ${exitCode} but verdict present`,
  };
}

function firstLine(text) {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}

/** The last `rate_limits` in a rollout file's text (account-wide, so any recent rollout will do). */
export function lastRateLimits(rolloutText) {
  let last = null;
  for (const line of rolloutText.split('\n')) {
    if (!line.includes('"rate_limits"')) continue;
    try {
      const rl = JSON.parse(line)?.payload?.rate_limits;
      const windows = [rl?.primary, rl?.secondary]
        .filter(Boolean)
        .sort((a, b) => b.window_minutes - a.window_minutes);
      const window = windows.find((w) => w.window_minutes >= 10080) ?? windows[0];
      if (window) {
        last = {
          usedPercent: window.used_percent,
          windowMinutes: window.window_minutes,
          resetsAt: window.resets_at,
          planType: rl.plan_type ?? null,
        };
      }
    } catch {
      /* partial line */
    }
  }
  return last;
}

/** Other projects update rollouts without touching our ledger; observation time wins. */
export function freshestLimits(rollout, ledger) {
  if (!rollout) return ledger?.limits ?? null;
  if (!ledger || rollout.observedAt >= ledger.observedAt) return rollout.limits;
  return ledger.limits;
}

/** Review's parent usage can be zero while its child spent tokens: that total is unknown. */
export function runUsage(mode, usage) {
  return mode === 'review' && usage.total === 0 ? null : usage;
}

/**
 * Budget guard: the owner's `CODEX_RUN` switch first; then, past `threshold` percent of
 * the window, non-essential kinds are reserved (exit 4) so the quota is kept for the
 * review and adversarial passes. A reading from a window that has since reset does not count.
 */
export function budgetDecision(
  route,
  limits,
  { threshold = 85, now = Date.now() / 1000, mode = 'on' } = {},
) {
  if (mode === 'off') return { run: false, reason: `CODEX_RUN=off — ${route.kind} goes to Claude` };
  if (mode === 'essential' && !route.essential)
    return { run: false, reason: `CODEX_RUN=essential — ${route.kind} goes to Claude` };
  if (!limits || typeof limits.usedPercent !== 'number') return { run: true };
  if (limits.resetsAt && limits.resetsAt <= now) return { run: true };
  if (route.essential || limits.usedPercent < threshold) return { run: true };
  return {
    run: false,
    reason: `weekly ${limits.usedPercent}% ≥ ${threshold}% — ${route.kind} reserved for Claude`,
  };
}

/** Reserve the table kind before the optional paid router call, including `auto`. */
export async function planRun(a, limitsBefore, router) {
  const override = {};
  if (a.model) override.model = a.model;
  if (a.effort) override.effort = a.effort;
  const opts = {
    override,
    critical: a.flags.has('critical'),
    allowUltra: a.flags.has('allow-ultra'),
    allowMax: a.flags.has('allow-max'),
    allowFrontier: a.flags.has('allow-frontier'),
  };
  let route = resolveRoute(a.kind, opts);
  const budget = budgetDecision(route, limitsBefore, { threshold: a.threshold, mode: a.mode });
  let routed = null;
  if (budget.run && (a.kind === 'auto' || a.flags.has('route')) && !a.flags.has('dry-run')) {
    routed = await router();
    route = resolveRoute(a.kind, { ...opts, routed: routed ?? undefined });
  }
  return { route, budget, routerReason: routed?.reason ?? '' };
}

/**
 * `git status --porcelain=v1 -z` -> path -> status. NUL-separated, so no quoting and no
 * trimmed leading space (a trimmed ` M a.ts` loses its first characters); a rename/copy
 * entry is followed by its source path, which is skipped.
 */
export function parsePorcelainZ(text) {
  const out = {};
  const recs = text.split('\0');
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.length < 4) continue;
    const status = r.slice(0, 2);
    out[r.slice(3)] = status;
    if (status[0] === 'R' || status[0] === 'C') i++;
  }
  return out;
}

/**
 * What a write run left in the worktree: commits since the start, and dirty paths whose
 * status OR content changed (`before`/`after`: path -> { status, hash }). An already-dirty
 * file Codex edited further keeps its status line, so only the hash catches it. Such paths
 * are also listed in `dirtyBefore`: they hold earlier work, so they are never restored blind.
 */
export function worktreeLeftovers({ before, after, headBefore, headAfter }) {
  const files = Object.keys(after).filter(
    (f) => !before[f] || before[f].status !== after[f].status || before[f].hash !== after[f].hash,
  );
  const commits =
    headBefore && headAfter && headBefore !== headAfter
      ? `${headBefore.slice(0, 9)}..${headAfter.slice(0, 9)}`
      : null;
  return { files, dirtyBefore: files.filter((f) => before[f]), commits };
}

export function formatTokens(n) {
  if (n === null) return '?';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
