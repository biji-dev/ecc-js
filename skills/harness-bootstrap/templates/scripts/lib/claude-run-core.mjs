// harness-bootstrap claude-run core (generated YYYY-MM-DD). Pure core of scripts/claude-run.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- the models `claude --model` takes and the dollar cap of one run.
/**
 * The route table, the `claude -p` argv, the owner's switch, the host and sandbox checks and the
 * run verdict of claude-run, the second family for a host that is not Claude Code. No I/O here,
 * so `claude-run-core.test.mjs` can pin each rule.
 *
 * WHY A WRAPPER. The cross-family rule held only where Claude Code was the host: a project run
 * from Codex or ZCode had no read-only, capped way to ask Claude, and `claude -p` reports its
 * failures inside its JSON. Measured inside Codex's workspace sandbox (no network, no write to
 * ~/.claude): it ran 177 s, then returned `is_error` with "API Error: Can't reach the API
 * server", at $0.
 */
import { detectHost } from './harness-host-core.mjs';

// ---- [B] project bindings
// [B] The models by role, as `claude --model` takes them: aliases follow the newest release.
export const CATALOG = { judgment: 'opus', bounded: 'sonnet' };
// [B] Dollars one run may spend (`--max-budget-usd`).
export const BUDGET_USD = 5;
// ---- end [B]

// Read-only, always: no command, edit or web tool reaches a run.
export const TOOLS = ['Read', 'Grep', 'Glob'];
// kind -> { model, effort, criticalEffort?, essential }; `essential` kinds run under CLAUDE_RUN=essential.
export const ROUTES = {
  review: { model: CATALOG.judgment, effort: 'high', essential: true },
  adversarial: { model: CATALOG.judgment, effort: 'high', criticalEffort: 'xhigh', essential: true },
  'plan-blind': { model: CATALOG.judgment, effort: 'high', essential: false },
  investigate: { model: CATALOG.judgment, effort: 'high', essential: false },
  'lane-a': { model: CATALOG.bounded, effort: 'high', essential: false },
};
// The effort floor is high; max is the owner's word, never a wrapper flag (harness-bootstrap's reference/gate-design.md).
export const EFFORTS = ['high', 'xhigh'];
export const EXIT = { ok: 0, failed: 1, usage: 2, unavailable: 3, reserved: 4 };
export const MODES = ['on', 'essential', 'off'];

const VALUE_FLAGS = {
  '--kind': 'kind',
  '--prompt': 'prompt',
  '--base': 'base',
  '--out': 'out',
  '--cwd': 'cwd',
  '--model': 'model',
  '--effort': 'effort',
  '--budget-usd': 'budgetUsd',
  '--timeout-min': 'timeoutMin',
};
const BOOL_FLAGS = { '--critical': 'critical', '--dry-run': 'dryRun' };
// A ref git cannot read as an option.
const REF = /^[A-Za-z0-9_][\w./~^@{}-]*$/;
// What a run that never reached the model says: the network, the login, the plan's limits.
const UNAVAILABLE = /can't reach the api|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|not logged in|\/login|invalid api key|authenticat|usage limit|rate limit|overloaded/i;

function mode(env) {
  const m = env.CLAUDE_RUN ?? 'on';
  if (!MODES.includes(m)) throw new Error(`CLAUDE_RUN must be on, essential or off, not "${m}"`);
  return m;
}

function checkValues(a) {
  if (!a.kind) throw new Error('a kind is required');
  if (!ROUTES[a.kind]) throw new Error(`kind must be one of ${Object.keys(ROUTES).join(', ')}`);
  if (a.kind === 'review' && !a.base) throw new Error('review needs --base <ref>');
  if (a.kind !== 'review' && !a.prompt) throw new Error(`${a.kind} needs --prompt <file>`);
  if (a.base && !REF.test(a.base)) throw new Error(`--base is not a ref: ${a.base}`);
  if (a.effort === 'max') throw new Error("--effort max only on the owner's word: run claude yourself");
  if (a.effort && !EFFORTS.includes(a.effort)) throw new Error(`--effort must be one of ${EFFORTS.join(', ')}`);
  if (a.model && !Object.values(CATALOG).includes(a.model)) throw new Error(`--model must be one of ${Object.values(CATALOG).join(', ')}`);
  if (!Number.isFinite(a.budgetUsd) || a.budgetUsd <= 0) throw new Error('--budget-usd must be a positive number');
  if (!Number.isFinite(a.timeoutMin) || a.timeoutMin <= 0 || a.timeoutMin * 60_000 > 2_147_483_647)
    throw new Error('--timeout-min must be positive and fit a Node timer');
}

export function parseArgs(argv, env = {}) {
  const a = {
    kind: null,
    prompt: null,
    base: null,
    out: null,
    cwd: null,
    model: null,
    effort: null,
    budgetUsd: BUDGET_USD,
    timeoutMin: 45,
    critical: false,
    dryRun: false,
    mode: mode(env),
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t in BOOL_FLAGS) a[BOOL_FLAGS[t]] = true;
    else if (t in VALUE_FLAGS) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      if (t === '--kind' && a.kind) throw new Error('one kind per run');
      a[VALUE_FLAGS[t]] = t === '--budget-usd' || t === '--timeout-min' ? Number(v) : v;
    } else if (t.startsWith('--')) throw new Error(`unknown option ${t}`);
    else if (a.kind) throw new Error(`one kind per run: "${a.kind}", then "${t}"`);
    else a.kind = t;
  }
  checkValues(a);
  return a;
}

/** The table row's model and effort; --critical raises a kind that has a critical effort; an explicit flag wins. */
export function resolveRoute(a) {
  const row = ROUTES[a.kind];
  return {
    model: a.model ?? row.model,
    effort: a.effort ?? (a.critical && row.criticalEffort ? row.criticalEffort : row.effort),
  };
}

/** The `claude` argv. The prompt is not in it: it goes on stdin. */
export function claudeArgv(route, a, { addDirs = [] } = {}) {
  const tools = TOOLS.join(',');
  return [
    '-p',
    '--restricted',
    '--strict-mcp-config',
    '--tools',
    tools,
    '--allowedTools',
    tools,
    '--permission-mode',
    'dontAsk',
    '--model',
    route.model,
    '--effort',
    route.effort,
    '--max-budget-usd',
    String(a.budgetUsd),
    '--no-session-persistence',
    '--output-format',
    'json',
    ...addDirs.flatMap((d) => ['--add-dir', d]),
  ];
}

/** Claude Code's second family is Codex; this wrapper is for the hosts whose second family is Claude. */
export function hostCheck(env) {
  const { host, by } = detectHost(env);
  if (host === 'claude')
    return { ok: false, why: `the host is Claude Code (${by}): its second family is Codex, through scripts/codex-run.mjs` };
  return { ok: true, why: '' };
}

/** `claude -p` needs the network and ~/.claude; Codex's sandbox marks a shell that has no network. */
export function networkCheck(env) {
  if (env.CODEX_SANDBOX_NETWORK_DISABLED === '1')
    return {
      ok: false,
      why: "this shell's sandbox has no network (CODEX_SANDBOX_NETWORK_DISABLED=1): run claude-run outside it -- Codex asks for the approval -- or take the fallback",
    };
  return { ok: true, why: '' };
}

/** The owner's switch, CLAUDE_RUN: `on`, `essential` (only the decorrelated checks) or `off`. */
export function budgetDecision(kind, m) {
  if (m === 'off') return { run: false, reason: 'CLAUDE_RUN=off: every kind is reserved' };
  if (m === 'essential' && !ROUTES[kind].essential) return { run: false, reason: `CLAUDE_RUN=essential: ${kind} is not an essential kind` };
  return { run: true, reason: '' };
}

/** The review brief: the diff file, the one severity scale (harness-bootstrap's reference/gate-design.md › Severity), the focus last. */
export function reviewPrompt({ diffRel, base, focus = '' }) {
  const text = [
    'You are the second-family reviewer of one change: read-only, with Read, Grep and Glob, and no way to run commands or edit files.',
    '',
    `The change is the diff in ${diffRel} -- \`git diff --merge-base ${base}\`, the working tree against its merge base with ${base}. Read it, then open the files it touches for the context each hunk needs.`,
    '',
    'Report each defect the diff introduces, worst first: severity, `file:line`, the line quoted, why it is wrong, and how to reproduce it. One scale:',
    '- P0 — data loss, a security or isolation breach, wrong money, an outage',
    '- P1 — a correctness defect the change introduces',
    '- P2 — a robustness gap, an edge case, a missing test for a real path',
    '- P3 — a nit, a style point',
    'Mark a defect that was there before the diff as pre-existing. With none, answer "No findings." No summary of the change, no praise.',
  ].join('\n');
  return focus.trim() ? `${text}\n\nFocus from the session:\n${focus.trim()}` : text;
}

/** Every other kind: the caller's brief, after one line that says what the run may do. */
export function framePrompt(kind, brief) {
  return `You are a read-only second-family pass (${kind}): Read, Grep and Glob only -- no commands, no edits.\n\n${brief}`;
}

function lastResult(stdout) {
  const text = String(stdout ?? '').trim();
  for (const candidate of [text, ...text.split('\n').reverse()]) {
    try {
      const r = JSON.parse(candidate);
      if (r && r.type === 'result') return r;
    } catch {
      // not this one
    }
  }
  return null;
}

const firstLine = (s) => String(s ?? '').trim().split('\n')[0].slice(0, 200);

/**
 * A result that is not a success. An error_during_execution result keeps its reasons in `errors`: a
 * login, a limit or the network there makes the pass "unavailable" (the fallback), not a failure.
 */
function errorResult(r, cost, out) {
  const errors = (Array.isArray(r.errors) ? r.errors : []).map((e) => (typeof e === 'string' ? e : e?.message)).filter((e) => typeof e === 'string');
  const first = firstLine(errors[0]);
  const kind = r.subtype || 'an error result';
  const unavailable = r.terminal_reason === 'api_error' || errors.some((e) => UNAVAILABLE.test(e));
  return out(unavailable ? 'unavailable' : 'failed', first ? `${kind}: ${first}` : kind, cost);
}

/** The run's outcome from its JSON result, never from the exit code alone. */
export function classify({ exitCode, stdout, spawnError, timedOut, timeoutMin, budgetUsd = BUDGET_USD, binary = 'claude' }) {
  const out = (outcome, reason, extra = {}) => ({ outcome, exit: EXIT[outcome], reason, ...extra });
  if (spawnError === 'ENOENT') return out('unavailable', `${binary} is not on PATH`);
  if (timedOut) return out('failed', `timed out after ${timeoutMin} min`);
  const r = lastResult(stdout);
  if (!r) return out('failed', `no result in the output (exit ${exitCode})`);
  const cost = { costUsd: Number.isFinite(r.total_cost_usd) ? r.total_cost_usd : null, turns: r.num_turns ?? null };
  if (r.subtype === 'error_max_budget_usd') return out('failed', `the $${budgetUsd} budget cap was reached`, cost);
  if (r.subtype !== 'success') return errorResult(r, cost, out);
  if (r.is_error) {
    const why = firstLine(r.result) || 'an error result';
    return out(r.terminal_reason === 'api_error' || UNAVAILABLE.test(why) ? 'unavailable' : 'failed', why, cost);
  }
  const text = typeof r.result === 'string' ? r.result.trim() : '';
  if (!text) return out('failed', 'an empty verdict', cost);
  return { outcome: 'ok', exit: EXIT.ok, reason: '', text, ...cost };
}
