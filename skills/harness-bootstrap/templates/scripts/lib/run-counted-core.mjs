// harness-bootstrap run-counted core (generated YYYY-MM-DD). Pure core of scripts/run-counted.mjs.
// [M] mechanism (ships as-is): everything. A runner no kind reads gets a kind of its own here,
// with a fixture of its real output in run-counted-core.test.mjs.
/**
 * Argument parsing, the summary parsers and the verdict. No I/O here, so
 * `run-counted-core.test.mjs` can pin each rule.
 *
 * WHY. Gates passed on what never ran. One project's `pnpm -r --if-present run build` stayed
 * green with no build script anywhere, and a `--filter` that matched no package exited 0; its
 * counted gate, a grep for `Tests +[1-9][0-9]* passed`, matched one pass among a hundred skips
 * and a suite that had lost half its tests. Two other projects wrote their own fix: a summary
 * check against a ratcheted floor, and a grep for skips. This wrapper reads the runner's own
 * summary from the command's stdout, fails on any failed, errors, skipped, todo, flaky,
 * interrupted, not-run, filtered-out, deselected, xfailed or xpassed count, and holds the pass
 * count to a floor (`--min`) kept in the gate's binding. No summary is a FAIL: a filter that
 * matched nothing and a script that is not there print none.
 *
 * WHAT EACH KIND READS, from the stream its runner writes the summary to (`SUMMARY_STREAM`: stdout,
 * bun's stderr). A summary on the other stream alone is not seen, and the run fails closed with "no
 * summary line". Every kind but node is read after CSI escape sequences
 * (`ESC [ … final byte`, colour) are stripped; any other escape stays in the text, so a stripped
 * sequence never runs across a line. The node kind's TAP is read as printed: the TAP reporter
 * writes no colour, and a test title holding `ESC [` would otherwise swallow the ` # SKIP` after it.
 * - vitest: the whole line `Tests  <n> <word> | … (<total>)`, anchored at both ends; its parts
 *   must add up to `<total>`. An `Errors  <n> error(s)` line after it counts as errors.
 * - node: the TAP reporter (the binding passes `--test-reporter=tap`). The summary is the
 *   top-level `# <word> <n>` lines after the last top-level `1..N` plan line; `tests`, `pass`,
 *   `fail`, `cancelled`, `skipped` and `todo` must each be there, and `tests` must equal pass +
 *   fail + cancelled + skipped + todo. Every `ok` / `not ok` result line, at any indent, whose
 *   text holds an unescaped `#` carries a directive (`# SKIP`, `# TODO`, `# EXPECTED FAILURE`)
 *   and is a marker that fails the run: node registers no children for a skipped suite, so
 *   `describe.skip` reports `# skipped 0` and its result line is the only trace. A console line
 *   a test prints is a TAP comment written before the plan line, so it is never read as a
 *   counter; a second top-level plan, or a `# tests <n>` line anywhere with `# suites <n>` on
 *   the next line (a console `# tests 5` alone has none), is a second summary (a suite's own plan
 *   is indented). A file that registers no tests is reported as one passing top-level test named
 *   by its path, so a top-level `ok` named like a file (no whitespace unless the name is an
 *   absolute path, `/…` or `C:\…`; a `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, `.jsx` or
 *   `.tsx` ending; no directive; not `type: 'suite'`) fails the run; a test whose whole title is
 *   a bare file name reads the same, and the fix is to retitle it. `--test-name-pattern`,
 *   `--test-skip-pattern`, `--test-only` and `--test-shard` in a node command are a usage error,
 *   and the same flags in `NODE_OPTIONS` stop the run: each drops tests without counting them.
 * - pytest: the whole line `<n> <word>, … in <t>s`, bare or between `=` rules.
 * - bun: the block of ` <n> pass`, ` <n> skip`, ` <n> todo`, ` <n> filtered out`, ` <n> fail`
 *   lines (with its `expect() calls` and `snapshots` lines) that ends at `Ran <n> tests across
 *   <m> files. […]`; pass + skip + todo + fail must equal the Ran count.
 * - playwright (the list, line or dot reporter): `  <n> passed (<time>)` with the `  <n> failed`,
 *   `  <n> interrupted`, `  <n> flaky`, `  <n> skipped` and `  <n> did not run` lines above it,
 *   and `  <n> error(s) was/were not a part of any test`. A flaky test passed only on a retry,
 *   so it fails the run too.
 *
 * ONE SUMMARY. More than one summary of the kind fails the run, so a script that runs its runner
 * twice cannot hide the first run's skips: bind one counted gate per package. A counter word a
 * parser does not know fails the run, never ignored (an own key of the parser's word table only:
 * `constructor` is unknown). A test title or a log line saying "5 passed" counts for nothing:
 * only the whole summary line is read.
 */

export const EXIT = { ok: 0, failed: 1, usage: 2 };
export const KINDS = ['vitest', 'node', 'pytest', 'bun', 'playwright'];

/** Where each runner writes its summary (bun 1.3 writes its results to stderr, its version line alone to stdout). */
export const SUMMARY_STREAM = { vitest: 'stdout', node: 'stdout', pytest: 'stdout', bun: 'stderr', playwright: 'stdout' };

/** Counters that fail the run when above zero (`passed` is held to `--min` instead). */
export const BAD_COUNTERS = [
  'failed',
  'errors',
  'skipped',
  'todo',
  'flaky',
  'interrupted',
  'not run',
  'cancelled',
  'filtered out',
  'deselected',
  'xfailed',
  'xpassed',
];

/** node --test options that drop tests without counting them: a usage error in a node command. */
export const NODE_FILTER_FLAGS = ['--test-name-pattern', '--test-skip-pattern', '--test-only', '--test-shard'];

const FLAGS = { '--kind': 'kind', '--min': 'min' };
const USAGE_ERROR = (msg) => Object.assign(new Error(msg), { usage: true });

/** `--kind <k> --min <n> -- <cmd> [args…]` -> `{ kind, min, cmd, args }`. Throws on a usage error (`err.usage`). */
export function parseArgs(argv) {
  const sep = argv.indexOf('--');
  if (sep === -1) throw USAGE_ERROR('missing `--` before the command');
  const opts = argv.slice(0, sep);
  const command = argv.slice(sep + 1);
  if (command.length === 0 || command[0] === '') throw USAGE_ERROR('no command after `--`');
  const a = { kind: null, min: null };
  for (let i = 0; i < opts.length; i += 2) {
    const flag = opts[i];
    const value = opts[i + 1];
    if (!Object.hasOwn(FLAGS, flag)) throw USAGE_ERROR(`unknown option: ${flag}`);
    const key = FLAGS[flag];
    if (value === undefined || value === '') throw USAGE_ERROR(`${flag} needs a value`);
    if (a[key] !== null) throw USAGE_ERROR(`${flag} given twice`);
    a[key] = value;
  }
  if (!KINDS.includes(a.kind)) throw USAGE_ERROR(`--kind must be one of: ${KINDS.join(', ')}`);
  if (a.min === null || !/^[1-9][0-9]*$/.test(a.min)) throw USAGE_ERROR("--min must be an integer of 1 or more: the gate's floor, today's count");
  if (a.kind === 'node') {
    const dropped = command.find((w) => NODE_FILTER_FLAGS.some((f) => w === f || w.startsWith(`${f}=`)));
    if (dropped !== undefined) throw USAGE_ERROR(`${dropped} in a node command drops tests without counting them`);
  }
  return { ...a, min: Number(a.min), cmd: command[0], args: command.slice(1) };
}

/** The reason the wrapper must not run when `env.NODE_OPTIONS` names a `--test…` flag (any kind: a node child inherits it), or null. */
export function nodeOptionsProblem(env) {
  const v = env.NODE_OPTIONS ?? '';
  if (!/--test/.test(v)) return null;
  return `NODE_OPTIONS holds a --test flag (${v}): it can drop tests without counting them; the command was not run`;
}

// CSI escape sequences only (ESC [ parameters intermediates final byte: colour, cursor). An OSC
// or any other escape stays in the text: an OSC ends at BEL or ST, which may be lines away.
// eslint-disable-next-line no-control-regex
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(text) {
  return String(text).replace(CSI, '');
}

const lines = (text) => stripAnsi(text).split(/\r?\n/);
const rawLines = (text) => String(text).split(/\r?\n/);

/** `"1 passed | 2 skipped"` style parts -> counters; unknown words go to `unknown`. */
export function countParts(parts, words) {
  const counts = { passed: 0, unknown: [], problems: [] };
  for (const part of parts) {
    const m = /^(\d+) ([A-Za-z_]+(?: [a-z]+)*)$/.exec(part.trim());
    const word = m && Object.hasOwn(words, m[2]) && words[m[2]];
    if (!word) counts.unknown.push(part.trim());
    else counts[word] = (counts[word] ?? 0) + Number(m[1]);
  }
  return counts;
}

/** The single summary hit, or null; a second hit becomes a problem. */
function oneHit(ls, re, kind, trim) {
  const hits = ls.map((l, index) => Object.assign(re.exec(trim ? l.trim() : l) ?? {}, { index })).filter((h) => h[0] !== undefined);
  if (hits.length === 0) return { hit: null, problems: [] };
  return { hit: hits.at(-1), problems: hits.length > 1 ? [`${hits.length} ${kind} summary lines in the output (one expected)`] : [] };
}

// vitest: `      Tests  1 passed | 1 skipped | 1 todo (3)`. `Test Files …` is not this line.
const VITEST_LINE = /^\s*Tests\s{2,}(\d+ [a-z]+(?: \| \d+ [a-z]+)*) \((\d+)\)\s*$/;
const VITEST_WORDS = { passed: 'passed', failed: 'failed', skipped: 'skipped', todo: 'todo' };
const VITEST_ERRORS = /^\s*Errors\s{2,}(\d+) errors?\b/;

// pytest: `1 passed, 1 skipped, 1 xfailed in 0.01s`, bare (-q) or between `=` rules, any order.
const PYTEST_LINE = /^=*\s*(\d+ [a-z]+(?:, \d+ [a-z]+)*) in \d+(?:\.\d+)?s(?: \(\d+:\d{2}:\d{2}\))?\s*=*$/;
const PYTEST_WORDS = {
  passed: 'passed',
  failed: 'failed',
  error: 'errors',
  errors: 'errors',
  skipped: 'skipped',
  xfailed: 'xfailed',
  xpassed: 'xpassed',
  deselected: 'deselected',
  warning: 'warnings', // reported by pytest, harmless to the count
  warnings: 'warnings',
};

// bun test: ` 2 pass`, ` 1 skip`, ` 1 todo`, ` 3 filtered out`, ` 0 fail`, ` 2 expect() calls`, then `Ran 4 tests across 2 files. [12.00ms]`.
const BUN_RAN = /^Ran (\d+) tests? across (\d+) files?\. \[[^\]]*\]$/;
const BUN_COUNTER = /^(\d+) (pass|skip|todo|fail|filtered out)$/;
const BUN_INFO = /^(?:\d+ snapshots, )?\d+ expect\(\) calls$|^snapshots: /;
const BUN_WORDS = { pass: 'passed', skip: 'skipped', todo: 'todo', fail: 'failed', 'filtered out': 'filtered out' };

// playwright test, list / line / dot reporter: each count on its own line, two spaces in, the tests of
// failed, interrupted and flaky listed four spaces in below their line.
const PW_PASSED = /^ {2}(\d+) passed \([^()]+\)$/;
const PW_COUNTER = /^ {2}(\d+) (failed|interrupted|flaky|skipped|did not run)$/;
const PW_ERRORS = /^ {2}(\d+) errors? (?:was|were) not a part of any test, see above for details$/;
const PW_WORDS = { failed: 'failed', interrupted: 'interrupted', flaky: 'flaky', skipped: 'skipped', 'did not run': 'not run' };

// node --test, TAP reporter: the top-level summary counters, a result line at any indent, the top-level plan line.
const NODE_COUNTER = /^# ([a-z_]+) (\d+(?:\.\d+)?)$/;
const NODE_KNOWN = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'];
const NODE_SUMMED = ['pass', 'fail', 'cancelled', 'skipped', 'todo'];
const NODE_WORDS = { pass: 'passed', fail: 'failed', cancelled: 'cancelled', skipped: 'skipped', todo: 'todo' };
const NODE_RESULT = /^\s*(?:not )?ok \d+(.*)$/;
const NODE_PLAN = /^1\.\.\d+$/;
// A top-level pass named like a file: node's report of a file that registered no tests. An
// absolute path (`/…`, `C:\…`, `C:/…`) may hold whitespace; a relative one is read without.
const NODE_FILE_RESULT = /^ok \d+ - ((?:\/|[A-Za-z]:[\\/]).*\.(?:[cm]?[jt]s|[jt]sx)|\S+\.(?:[cm]?[jt]s|[jt]sx))$/;
// The spec reporter's info glyph (U+2139), built so no pictograph is in the file.
const NODE_SPEC = new RegExp(`^${String.fromCodePoint(0x2139)} (tests|pass) \\d+$`);

/** The text after the first unescaped `#` of a TAP result line's tail, or null. */
function tapDirective(tail) {
  for (let i = 0; i < tail.length; i++) {
    if (tail[i] === '\\') i++;
    else if (tail[i] === '#') return tail.slice(i + 1).trim();
  }
  return null;
}

/** node --test TAP result lines that carry a directive (skip, todo, …), trimmed, each once. */
export function nodeDirectiveMarkers(text) {
  const out = [];
  for (const l of rawLines(text)) {
    const m = NODE_RESULT.exec(l);
    if (m && tapDirective(m[1]) !== null && !out.includes(l.trim())) out.push(l.trim());
  }
  return out;
}

/** Top-level passes named like a file whose YAML block is not a suite's: files that registered no tests, each once. */
function nodeEmptyFiles(ls) {
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    const m = NODE_FILE_RESULT.exec(ls[i]);
    if (!m || tapDirective(m[1]) !== null || out.includes(m[1])) continue;
    let suite = false;
    if (ls[i + 1] === '  ---') for (let j = i + 2; j < ls.length && ls[j] !== '  ...'; j++) if (ls[j] === "  type: 'suite'") suite = true;
    if (!suite) out.push(m[1]);
  }
  return out;
}

function parseNode(text) {
  const ls = rawLines(text);
  const plan = ls.findLastIndex((l) => NODE_PLAN.test(l));
  if (plan === -1) {
    if (ls.some((l) => NODE_COUNTER.test(l))) return { passed: 0, unknown: [], problems: ['the TAP output has no top-level 1..N plan line before its summary'], markers: nodeDirectiveMarkers(text) };
    if (lines(text).some((l) => NODE_SPEC.test(l.trim()))) return { passed: 0, unknown: [], problems: ["a spec reporter's summary, not TAP: the node kind reads --test-reporter=tap"], markers: [] };
    return null;
  }
  const seen = {};
  const unknown = [];
  for (const l of ls.slice(plan + 1)) {
    const m = NODE_COUNTER.exec(l);
    if (!m) continue;
    if (!NODE_KNOWN.includes(m[1])) unknown.push(`${m[1]} ${m[2]}`);
    else (seen[m[1]] ??= []).push(Number(m[2]));
  }
  if (!seen.tests) return null;
  const problems = [];
  // Two runs in one command print two summaries, and the counters after the last plan are the last
  // run's alone: a red first run would pass. A repeat after the last plan is the twice check's.
  // A summary's `# tests` line has `# suites` next; a console line's has not.
  const isRun = (l, i) => NODE_COUNTER.exec(l)?.[1] === 'tests' && NODE_COUNTER.exec(ls[i + 1] ?? '')?.[1] === 'suites';
  const plans = ls.filter((l) => NODE_PLAN.test(l)).length;
  const runs = Math.max(plans, ls.filter(isRun).length);
  if (plans > 1 || ls.slice(0, plan).some(isRun)) problems.push(`${runs} node summaries in the output (one expected)`);
  for (const f of nodeEmptyFiles(ls)) problems.push(`${f} registered no tests: node counted the file itself as one passing test`);
  const twice = NODE_KNOWN.filter((w) => seen[w]?.length > 1);
  if (twice.length) problems.push(`more than one node summary in the output (# ${twice.join(', # ')} repeated)`);
  const missing = ['tests', ...NODE_SUMMED].filter((w) => !seen[w]);
  if (missing.length) problems.push(`the node summary has no # ${missing.join(', # ')} line`);
  const counts = { passed: 0, unknown, problems, markers: nodeDirectiveMarkers(text) };
  for (const [w, key] of Object.entries(NODE_WORDS)) if (seen[w]) counts[key] = seen[w].at(-1);
  if (!missing.length) {
    const sum = NODE_SUMMED.reduce((t, w) => t + seen[w].at(-1), 0);
    if (seen.tests.at(-1) !== sum) problems.push(`# tests ${seen.tests.at(-1)} is not pass + fail + cancelled + skipped + todo (${sum})`);
  }
  return counts;
}

function parseBun(text) {
  const ls = lines(text).map((l) => l.trim());
  const { hit, problems } = oneHit(ls, BUN_RAN, 'bun', false);
  if (!hit) return null;
  const parts = [];
  for (let i = hit.index - 1; i >= 0 && ls[i] !== ''; i--) {
    if (BUN_INFO.test(ls[i])) continue;
    parts.unshift(ls[i]);
  }
  const counts = countParts(parts, BUN_WORDS);
  counts.problems.push(...problems);
  for (const w of ['pass', 'fail']) if (!parts.some((p) => BUN_COUNTER.exec(p)?.[2] === w)) counts.problems.push(`the bun summary has no ${w} line`);
  const twice = Object.keys(BUN_WORDS).filter((w) => parts.filter((p) => BUN_COUNTER.exec(p)?.[2] === w).length > 1);
  if (twice.length) counts.problems.push(`more than one bun summary in the output (${twice.join(', ')} repeated)`);
  const ran = (counts.passed ?? 0) + (counts.skipped ?? 0) + (counts.todo ?? 0) + (counts.failed ?? 0);
  if (ran !== Number(hit[1])) counts.problems.push(`pass + skip + todo + fail is ${ran}, not the ${hit[1]} tests bun ran`);
  return counts;
}

function parsePlaywright(text) {
  const ls = lines(text);
  const counts = { passed: 0, unknown: [], problems: [] };
  const seen = {};
  let any = false;
  for (const l of ls) {
    let m = PW_PASSED.exec(l);
    if (m) {
      any = true;
      (seen.passed ??= []).push(Number(m[1]));
      continue;
    }
    m = PW_COUNTER.exec(l);
    if (m) {
      any = true;
      (seen[PW_WORDS[m[2]]] ??= []).push(Number(m[1]));
      continue;
    }
    m = PW_ERRORS.exec(l);
    if (m) {
      any = true;
      (seen.errors ??= []).push(Number(m[1]));
    }
  }
  if (!any) return null;
  const twice = Object.keys(seen).filter((k) => seen[k].length > 1);
  if (twice.length) counts.problems.push(`more than one playwright summary in the output (${twice.join(', ')} repeated)`);
  for (const [k, v] of Object.entries(seen)) counts[k] = v.at(-1);
  return counts;
}

/** The summary of `kind` in `text` as counters (`passed`, the bad counters, `unknown`, `problems`, `markers` for node), or null when there is none. */
export function parseSummary(kind, text) {
  if (kind === 'vitest') {
    const ls = lines(text);
    const { hit, problems } = oneHit(ls, VITEST_LINE, kind, false);
    if (!hit) return null;
    const parts = hit[1].split(' | ');
    const counts = countParts(parts, VITEST_WORDS);
    counts.problems.push(...problems);
    const sum = parts.reduce((t, p) => t + Number(p.trim().split(' ')[0]), 0);
    if (sum !== Number(hit[2])) counts.problems.push(`the vitest parts add up to ${sum}, not the total (${hit[2]})`);
    const errors = ls.slice(hit.index + 1).map((l) => VITEST_ERRORS.exec(l)).find(Boolean);
    if (errors) counts.errors = Number(errors[1]);
    return counts;
  }
  if (kind === 'pytest') {
    const { hit, problems } = oneHit(lines(text), PYTEST_LINE, kind, true);
    if (!hit) return null;
    const counts = countParts(hit[1].split(', '), PYTEST_WORDS);
    counts.problems.push(...problems);
    return counts;
  }
  if (kind === 'node') return parseNode(text);
  if (kind === 'bun') return parseBun(text);
  if (kind === 'playwright') return parsePlaywright(text);
  throw new Error(`unknown kind: ${kind}`);
}

/**
 * The run's verdict: `{ ok, lines }`, printed in order. On success the last line is exactly
 * `COUNTED <kind> <passed> passed (min <n>)`; a count above the floor adds the raise hint above it.
 * On failure every reason gets its own line, and no line starts with `COUNTED`. `interrupted` is
 * the signal this process received and forwarded to the command: the run fails whatever it printed.
 */
export function verdict({ kind, min, exitCode, signal = null, spawnError = null, interrupted, summary }) {
  const reasons = [];
  if (interrupted) reasons.push(`interrupted by ${interrupted} (forwarded to the command)`);
  if (spawnError) reasons.push(`the command did not start: ${spawnError}`);
  else if (signal) {
    if (signal !== interrupted) reasons.push(`the command was killed by ${signal}`);
  } else if (exitCode !== 0) reasons.push(`the command exited ${exitCode}`);
  if (!summary) reasons.push(`no ${kind} summary line in the output: nothing ran, or it ran somewhere this gate does not read`);
  else {
    for (const p of summary.problems ?? []) reasons.push(p);
    for (const c of BAD_COUNTERS) if ((summary[c] ?? 0) > 0) reasons.push(`${summary[c]} ${c} (must be 0)`);
    for (const u of summary.unknown) reasons.push(`unknown counter in the summary: "${u}"`);
    for (const m of summary.markers ?? []) reasons.push(`skip, todo or expected-failure marker in the output: "${m}"`);
    if (summary.passed < min) reasons.push(`${summary.passed} passed, below --min ${min}`);
  }
  if (reasons.length) return { ok: false, lines: reasons.map((r) => `run-counted: FAIL ${r}`) };
  const out = [];
  if (summary.passed > min) out.push(`run-counted: ${min} → ${summary.passed}: raise --min in scripts/run-gates.sh`);
  out.push(`COUNTED ${kind} ${summary.passed} passed (min ${min})`);
  return { ok: true, lines: out };
}
