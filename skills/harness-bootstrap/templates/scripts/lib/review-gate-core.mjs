// harness-bootstrap review-gate core (generated YYYY-MM-DD). Pure core of scripts/review-gate.mjs.
// [M] mechanism (ships as-is): everything below except the [B] block right under this header.
// [B] binding: the block between `---- [B]` and `---- end [B]`, from the reviewed risk map in the
// harness file (critical paths, the non-production and test shapes, specialist triggers).
//
// WHY THESE RULES. A 14-day usage study (1,094 review runs, 2,961 ledger findings): the second
// model family found 43% of the valid P0/P1 at no Claude cost, while the per-slice Opus
// code-reviewer found 0 P0/P1 in a 50-slice milestone, and 20 of its 50 fix rounds were opened by
// P3 findings only. So: a slice goes to the second family, ONE Opus code-reviewer runs over the
// whole unit diff, P3s never open a fix round, Opus re-reviews only critical code with a P1
// fixed, at most two Opus rounds, and a re-review is scoped to the fix. A fix written by the
// second family is re-read by Claude, never by the family that wrote it. Critical code written by
// anyone but Opus (the second family, Sonnet, or a mix) gets an Opus reviewer per slice, and a P3
// batch over it gets one too. The writer is never assumed: every decision names who wrote the
// diff (`--writer`, required).
//
// V10: THE PROCESS FITS THE STAKES, AND ROUNDS END. A project with no production users
// (`Stakes: ... production: none` in AGENTS.md) runs one cross-family review over the unit,
// plus the adversarial pass when critical code is in it; no Opus reviewer, no test analyzer, no
// silent-failure hunter. A diff that only adds tests under a critical path, with
// no line deleted, is routed as cold: no assertion was weakened, so there is no control to recheck.
// And fix rounds on critical code end by themselves: round 3 is an adversarial pass, round 4 a
// redesign the adversarial pass reviews, round 5 cuts the area; the harness lane drops a change at
// its third round. None of them waits for the owner. The landing check (`--landing`) then reads the
// merge RESULT, not a branch: each critical path it lands must be content the other family's
// reviews read, followed from the mainline through their recorded `baseTree -> tree` changes, and a
// change to a guard, a gate or a reviewed block is the owner's to merge.
//
// Decides from FACTS about a diff (paths, production lines, what a fix round fixed) which review
// it is owed, so the main thread does not guess. No I/O here, so the test can pin each rule.
// It reviews production files, tests and the harness's instruction files, and skips only docs
// alone: a weakened test is a weakened control, and a test under a critical path is critical.
//
// V12: PAY ONLY FOR STEPS THAT FIND THINGS. A 10-day study of 14 installs: fix re-reviews found a
// defect in 5% of 281 runs, the Sonnet code-reviewer no P0/P1 at all. So a fix that closed only P2s
// on cold code gets no re-review of its own (`defer`: the unit review reads it when one is still to
// come, its regression tests otherwise); P2s go in one batch round, and a P2-only round on critical
// code past round 2 is `defer` too, never the adversarial, redesign or cut ladder: the landing check
// re-reads every critical path it changed beyond reviewed content. A fix that closed a P0 or P1, or
// touched critical code in rounds 1 and 2, keeps its re-review. The Claude-side reader of what the
// second family wrote is the Opus code-reviewer; a Sonnet one runs only where no second family does
// (the session's degraded fallback, harness-bootstrap's reference/gate-design.md › Review lineup).
//
// THE WRITER IS A ROLE. A harness runs on Claude Code, Codex, ZCode or Kimi, each with a judgment
// model, a bounded model and a second family (harness-bootstrap's reference/gate-design.md › Model
// and effort). Read as Claude Code's names, `--writer codex` on a Codex host meant "the second family wrote it", and a small
// unit went to the bounded model -- the family that wrote it. So `--writer` names the role, and a
// family name counts only on Claude Code (or an unknown host, where every v4 install ran).

import { HOSTS } from './harness-host-core.mjs';

// ---- [B] project bindings — from the reviewed risk map in the harness file
export const CRITICAL = []; // path regexes of critical code (risk map › critical); empty until bound
export const NON_PRODUCTION = [/\.md$/, /^docs\//, /(^|\/)(__tests__|tests?|e2e|fixtures)\//, /\.(test|spec)\.[cm]?[jt]sx?$/]; // paths that are not production code (docs, tests, fixtures)
export const TESTS = [/(^|\/)(__tests__|tests?|e2e)\//, /\.(test|spec)\.[cm]?[jt]sx?$/]; // paths that count as tests (calls the test analyzer at the unit review)
// the harness's own instruction files and host config: Code, never docs (harness-bootstrap's reference/runner.md › Task type first)
export const INSTRUCTIONS = [/(^|\/)(AGENTS|CLAUDE)\.md$/, /^\.(claude|agents|codex|zcode)\//];
// the harness lane's paths (--tier harness): the instruction files, the guard's hooks, and the harness's
// own scripts and records folder, which the install adds (harness-bootstrap's reference/runner.md › The harness lane)
export const HARNESS = [...INSTRUCTIONS, /^\.githooks\//];
export const TRIGGERS = {
  // specialist reviewer → path regexes that call it at the unit review (the project's risk map)
  'security-reviewer': [/auth|session|token|crypto|permission|rbac|tenant|webhook|public/i],
  'silent-failure-hunter': [
    /payment|billing|money|settle|ledger|invoice|refund|webhook|queue|job|notif/i,
  ],
  'database-reviewer': [
    /(^|\/)migrations?\//i,
    /(^|\/)drizzle\//i,
    /\.sql$/i,
    /(^|\/)schema\.(ts|js|prisma|sql)$/i,
  ],
};
export const FIX_LINES = 40; // a critical P1 fix at or under this many production lines skips the Opus pass
// [B] Paths only the owner merges: the guards, the gates and the files that hold reviewed blocks.
// The landing check says NONE when a merge changes one, so no agent judges its own edit to them.
export const GUARDS = [
  /^(AGENTS|CLAUDE)\.md$/,
  /^\.githooks\//,
  /^\.claude\/(settings(\.local)?\.json|hooks\/|agents\/)/,
  /^\.codex\/(hooks\.json|config\.toml|agents\/)/,
  /^\.agents\/(harness-manifest\.json|harness-models\.json|skills\/task-runner\/)/,
  /^\.claude\/skills\/task-runner(\/|$)/,
  /^scripts\/(run-gates\.sh|run-counted\.mjs|review-gate\.mjs|check-agent-docs\.mjs|codex-run\.mjs|claude-run\.mjs)$/,
  /^scripts\/lib\/(run-counted-core|review-gate-core|snapshot-tree|run-sources|unit-cost-core|unit-step-core|harness-host-core|codex-run-core|claude-run-core)\.mjs$/,
];
// ---- end [B]

export const KINDS = ['slice', 'unit', 'fix'];
export const TIERS = ['small', 'full', 'harness'];
// what is at stake if the code is wrong: AGENTS.md's `Stakes:` line, `production: none | live`
export const STAKES = ['none', 'live'];
// the ledger kinds that count as a cross-family review at landing
export const LANDING_KINDS = ['review', 'adversarial', 'adversarial-frontier'];
// who wrote the diff, as decide() routes it, in Claude Code's names: claude = Opus (main thread /
// implementer), codex = the second family, sonnet = a Sonnet builder (or Opus and Sonnet
// together), mixed = several executors, the second family among them (routes like codex). The
// CLI takes a role and maps it with writerRole. What the second family wrote is read on the Claude
// side by the Opus code-reviewer: decide() never names `sonnet-code-reviewer` (v12).
export const WRITERS = ['claude', 'codex', 'sonnet', 'mixed'];
// --writer's role → the routing value; the same on every host
export const ROLES = { main: 'claude', bounded: 'sonnet', second: 'codex', mixed: 'mixed' };
const FAMILY_HOSTS = ['claude', 'unknown']; // where a family name keeps Claude Code's meaning
export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];

const WRITER_NAMES = {
  claude: 'Opus',
  codex: 'the second family',
  sonnet: 'Sonnet',
  mixed: 'several executors',
};
const secondFamilyWrote = (writer) => writer === 'codex' || writer === 'mixed'; // routes like codex

const UNBOUND_NOTE = 'CRITICAL unbound — every path treated as cold';
const STAKES_NOTE = 'stakes unbound — routed as live';
const P3_BATCH = 'P3s never open a fix round: they wait for the P3 batch, one per slice set, no re-review';
// harness-bootstrap's reference/gate-design.md: the P3 batch runs at live only; with no production
// users a P3 rides along
const NO_P3_BATCH = 'production: none: no P3 batch — a P3 rides along on a line a round already changes';

/**
 * `--writer` on `host` → the routing value decide() takes. A role (main | bounded | second |
 * mixed) maps the same on every host; a family name (claude | sonnet | codex) is itself on Claude
 * Code or an unknown host and a usage error anywhere else -- there it names the wrong model, so it
 * is refused, never guessed. A missing or unknown writer is refused here too: decide()'s own message
 * lists routing values, which on another host are the names it refuses.
 */
export function writerRole(writer, host) {
  if (!FAMILY_HOSTS.includes(host) && !HOSTS.includes(host))
    throw new Error(`--host must be one of ${HOSTS.join('|')}, not "${host}"`);
  if (Object.hasOwn(ROLES, writer)) return ROLES[writer];
  if (WRITERS.includes(writer) && !FAMILY_HOSTS.includes(host))
    throw new Error(`--writer ${writer} names a model family; on a ${host} host name the role: main | bounded | second | mixed`);
  if (WRITERS.includes(writer)) return writer;
  const also = FAMILY_HOSTS.includes(host) ? ' (on Claude Code also claude | sonnet | codex)' : '';
  throw new Error(`--writer is required and names the role that wrote the diff: main | bounded | second | mixed${also}`);
}

const isExempt = (path) => NON_PRODUCTION.some((re) => re.test(path));
export const isInstruction = (path) => INSTRUCTIONS.some((re) => re.test(path));
// a test in an instruction directory stays a test: reviewed and critical, but its lines and count are a test's
export const isProduction = (path) => (isInstruction(path) ? !isTest(path) : !isExempt(path));
export const isCritical = (path) => CRITICAL.some((re) => re.test(path));
export const isHarness = (path) => HARNESS.some((re) => re.test(path));
export const isTest = (path) => TESTS.some((re) => re.test(path));
export const isGuard = (path) => GUARDS.some((re) => re.test(path));
// the files whose guard is their harness blocks, not their whole text: the project's own prose in
// AGENTS.md or CLAUDE.md is the project's to edit
export const holdsBlocks = (path) => /(^|\/)(AGENTS|CLAUDE)\.md$/.test(path);
// what the landing check follows: the production files and tests under CRITICAL
export const isLandingCritical = (path) => (isProduction(path) || isTest(path)) && isCritical(path);
const name = (paths) => `${paths[0]}${paths.length > 1 ? ` +${paths.length - 1}` : ''}`;

const BEGIN = /^\s*<!--\s*harness:begin\s+(\S+)\s*-->\s*$/;
const END = /^\s*<!--\s*harness:end\s+(\S+)\s*-->\s*$/;

/**
 * A file's text → its harness blocks in order, [{ id, text }]: each `<!-- harness:begin <id> -->`
 * … `<!-- harness:end <id> -->` span, markers on lines of their own, the text between them. A
 * fence is text here, never a hiding place, and a block with no end marker runs to the end of the
 * file, so an edit after a removed end marker still counts.
 */
export function harnessBlocks(text) {
  const blocks = [];
  let open = null;
  for (const line of String(text ?? '').split('\n')) {
    if (open) {
      const end = END.exec(line);
      if (end && end[1] === open.id) {
        blocks.push({ id: open.id, text: open.lines.join('\n') });
        open = null;
      } else open.lines.push(line);
      continue;
    }
    const begin = BEGIN.exec(line);
    if (begin) open = { id: begin[1], lines: [] };
  }
  if (open) blocks.push({ id: open.id, text: open.lines.join('\n') });
  return blocks;
}

/**
 * Whether two versions of AGENTS.md or CLAUDE.md differ in their harness blocks: one added,
 * removed or edited. `null` is a file absent on that side, which holds no block.
 */
export function blocksDiffer(before, after) {
  const list = (t) => JSON.stringify(t === null || t === undefined ? [] : harnessBlocks(t));
  return list(before) !== list(after);
}

/** `text` with every fenced code block (``` or ~~~) dropped; a fence left open runs to the end. */
function dropFences(text) {
  const out = [];
  let fence = null;
  for (const line of String(text ?? '').split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = null;
      continue;
    }
    if (m) fence = m[1];
    else out.push(line);
  }
  return out.join('\n');
}

/**
 * AGENTS.md's text → its `Stakes:` line's production value: 'none' | 'live', or null when no
 * Stakes line names one. Fenced examples are dropped first, so a sample line never binds; then
 * only the policy block is read when the file has one. Two Stakes lines naming different values
 * are null, which routes as live: an ambiguous threat model never lowers a review. A
 * `production:` anywhere else in the file is not the stakes.
 */
export function readStakes(text) {
  const prose = dropFences(text);
  const policy = harnessBlocks(prose).filter((b) => b.id === 'policy');
  const scope = policy.length ? policy.map((b) => b.text).join('\n') : prose;
  const values = new Set([...scope.matchAll(/^\s*Stakes:.*?\bproduction:\s*(none|live)\b/gm)].map((m) => m[1]));
  return values.size === 1 ? [...values][0] : null;
}

/**
 * `git diff --numstat --no-renames` output → [{ path, lines, added, deleted, binary }]. Takes the
 * `-z` form (records end in NUL, paths never quoted) or the plain one; a binary file (`-\t-`)
 * counts 0 lines but still counts as a changed file. `deleted` tells a test that only grew from
 * one whose assertions were edited, which is what routes a test-only diff as cold.
 */
export function parseNumstat(text) {
  const s = String(text);
  return s
    .split(s.includes('\0') ? '\0' : '\n')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...rest] = line.replace(/^\n/, '').split('\t');
      const binary = added === '-' && deleted === '-';
      return {
        path: rest.join('\t'),
        lines: (Number(added) || 0) + (Number(deleted) || 0),
        added: Number(added) || 0,
        deleted: Number(deleted) || 0,
        binary,
      };
    })
    .filter((f) => f.path);
}

/**
 * CLI arguments → options. Throws on an unknown option or a missing value; `--base` is required.
 * `kind` and `writer` are validated by `decide` (`writer` has no default), so a bad or missing
 * one is the same usage error everywhere. `--host` is set only when given (the CLI detects it
 * otherwise) and must name a host; `--stakes` likewise (the CLI reads AGENTS.md at --base otherwise).
 * `--landing <result>` is the landing check: it takes `--base`, `--trust` (repeatable) and `--json`
 * only, so an option that steers a review decision beside it is a usage error, never silently
 * ignored. Every option's value is read first, so `--help` or `-h` is help (`help: true`) only as a
 * flag of its own: `--landing --help` is a missing value, a usage error, never exit 0.
 */
export function parseArgs(argv) {
  const a = { tier: 'full', writer: null, round: 1, maxFixed: null, json: false };
  const names = {
    '--base': 'base',
    '--head': 'head',
    '--kind': 'kind',
    '--tier': 'tier',
    '--writer': 'writer',
    '--max-fixed': 'maxFixed',
    '--round': 'round',
    '--host': 'host',
    '--stakes': 'stakes',
    '--landing': 'landing',
    '--trust': 'trust',
  };
  // a revision becomes a git argument: one that starts with `-` would be read as an option
  const revisions = { '--base': 'a revision', '--head': 'a revision', '--landing': 'a revision', '--trust': 'a commit' };
  const given = new Set();
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--help' || t === '-h') help = true;
    else if (names[t]) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      if (revisions[t] && v.startsWith('-')) throw new Error(`${t} must be ${revisions[t]}, not an option`);
      if (t === '--trust') a.trust = [...(a.trust ?? []), v];
      else a[names[t]] = v;
      given.add(t);
    } else throw new Error(`unknown option ${t}`);
  }
  if (help) return { ...a, help: true };
  if (!a.base) throw new Error('--base <sha> is required');
  if (a.host !== undefined && !HOSTS.includes(a.host))
    throw new Error(`--host must be one of ${HOSTS.join('|')}, not "${a.host}"`);
  if (a.stakes !== undefined && !STAKES.includes(a.stakes))
    throw new Error(`--stakes must be one of ${STAKES.join('|')}, not "${a.stakes}"`);
  checkLanding(a, given);
  a.round = Number(a.round);
  return a;
}

/** `--landing` takes `--base`, `--trust` and `--json` only, and `--trust` goes with it alone. */
function checkLanding(a, given) {
  if (a.landing === undefined) {
    if (a.trust) throw new Error('--trust goes with --landing');
    return;
  }
  const steering = ['--kind', '--writer', '--tier', '--head', '--max-fixed', '--round', '--stakes', '--host'].filter((o) => given.has(o));
  if (steering.length) throw new Error(`--landing takes only --base, --trust and --json, not ${steering.join(', ')}`);
}

/**
 * kind 'slice': after a slice passes its gate, before the next builds on it.
 * kind 'unit':  step 8, once, over the whole unit diff from the merge base.
 * `writer` (required) is who wrote the diff: claude (Opus) | codex (the second family) | sonnet
 * (Sonnet, or Opus and Sonnet together) | mixed (several executors, the second family among them;
 * routes like codex).
 * kind 'fix':   once per fix round, over `<sha-before-the-fixes>..` (pass the whole round once,
 *               after its last fix group); `maxFixed` is the highest severity the round fixed
 *               (P0 counts as P1) and `round` counts fix rounds on this area from 1. For this
 *               kind `writer` is who wrote THE FIX: a codex, sonnet or mixed fix on critical code
 *               is re-read by Opus ('review'); a codex or mixed cold fix that closed a P1 too.
 *               A cold fix that closed only P2s is 'defer': no re-review of its own.
 *               A P3 round is the P3 batch ('p3-batch', no re-review) unless it touches critical
 *               code and Opus did not write it: then the Opus reviewer reads it ('review').
 *               On critical code round 3 is an adversarial pass over the fix diff ('adversarial'),
 *               round 4 a redesign that pass reviews ('redesign'), round 5 and later a cut ('cut');
 *               a round that closed only P2s is 'defer' from round 3 on, never on the ladder.
 * tier 'harness': the harness lane, a diff of HARNESS paths alone -- one cross-family review over the
 *               unit, one fix round re-read by the other family, an adversarial second round, and
 *               the change dropped at the third ('drop'). A reviewed path outside HARNESS takes the
 *               ordinary rules, and a unit says to re-tier.
 * stakes 'none': no production users. A unit (small or full) is one cross-family review, plus the
 *               adversarial pass when critical code is in it, plus the specialists but the
 *               silent-failure hunter; a fix on critical code is re-read by the cross-family
 *               reviewer where live would name the Opus code-reviewer. A slice is the same at both.
 *               null is unbound: routed as live, and said so in notChecked.
 * A diff of tests alone with no line deleted and no binary (assertions only added) routes as cold,
 * even under a critical path; `critical` still lists those paths.
 * decision: 'skip' | 'defer' | 'required' | 'second-family' | 'review' | 'p3-batch' |
 *           'second-family+opus' | 'adversarial' | 'redesign' | 'cut' | 'drop'.
 * `files` is [{ path, lines, added?, deleted?, binary? }]; `reviewers` is the ordered list of
 * reviewers to run (maybe empty). `critical` covers production files and tests; `testFiles` counts
 * the tests that are not production.
 */
export function decide({ files, kind, tier = 'full', writer, maxFixed = null, round = 1, stakes = 'live' }) {
  if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join('|')}`);
  if (!TIERS.includes(tier)) throw new Error(`--tier must be one of ${TIERS.join('|')}`);
  if (!WRITERS.includes(writer)) throw new Error(`--writer is required and must be one of ${WRITERS.join('|')} (who wrote the diff)`);
  if (!Number.isInteger(round) || round < 1) throw new Error('--round must be an integer >= 1');
  if (kind === 'fix' && !SEVERITIES.includes(maxFixed))
    throw new Error(`--max-fixed must be one of ${SEVERITIES.join('|')} for --kind fix`);
  if (stakes !== null && !STAKES.includes(stakes)) throw new Error(`--stakes must be one of ${STAKES.join('|')}`);
  const none = stakes === 'none';

  const prod = files.filter((f) => isProduction(f.path));
  // what the gate reviews: production files plus tests; test lines never make a fix "large"
  const reviewed = files.filter((f) => isProduction(f.path) || isTest(f.path));
  const docsOnly = reviewed.length === 0;
  // tests only added (no line deleted, no binary): no assertion was weakened, so no control to recheck;
  // a file without counts is never assumed to be an addition
  const testsAdded = !docsOnly && prod.length === 0 && reviewed.every((f) => isTest(f.path) && f.deleted === 0 && !f.binary);
  const underCritical = reviewed.filter((f) => isCritical(f.path)).map((f) => f.path);
  // what routing treats as critical: the tests-added diff is routed as cold
  const critical = reviewed.filter((f) => !testsAdded && isCritical(f.path)).map((f) => f.path);
  const named = name(critical);
  // the harness lane covers harness paths alone: any other reviewed path takes the tier's ordinary rules; a doc
  // outside HARNESS (the unit's record, a README) is reviewed at no tier, so it leaves the lane as it is
  const stray = tier === 'harness' ? reviewed.filter((f) => !isHarness(f.path)).map((f) => f.path) : [];
  const lane = tier === 'harness' && stray.length === 0;
  const prodLines = prod.reduce((n, f) => n + f.lines, 0);
  const notChecked = [
    'critical code outside the CRITICAL path set',
    ...(CRITICAL.length === 0 ? [UNBOUND_NOTE] : []),
    ...(stakes === null ? [STAKES_NOTE] : []),
  ];
  const facts = {
    kind,
    tier,
    writer,
    round,
    maxFixed,
    prodFiles: prod.length,
    prodLines,
    testFiles: reviewed.length - prod.length,
    critical: underCritical,
    stakes: none ? 'none' : 'live',
    notChecked,
  };
  const coldTests = testsAdded && underCritical.length > 0 ? '; tests added under a critical path, nothing deleted: routed as cold' : '';
  const out = (decision, reviewers, reason) => ({ decision, reviewers, reason: `${reason}${coldTests}`, ...facts });
  // the reviewer from the family that did not write the diff: the second family's review, or for what
  // the second family wrote the Opus code-reviewer (a Sonnet one found no P0/P1 in the v12 study);
  // where live names the Opus code-reviewer on a fix, production none names this one
  const crossFamily = secondFamilyWrote(writer) ? 'opus-code-reviewer' : 'second-family-review';
  const crossDecision = crossFamily === 'opus-code-reviewer' ? 'review' : 'second-family';
  const DOCS_ONLY = 'no production code and no tests: docs only';
  // a specialist reads code: an instruction file's prose names auth or sessions without being either
  const specialists = Object.keys(TRIGGERS).filter((name) =>
    files.some((f) => !isExempt(f.path) && TRIGGERS[name].some((re) => re.test(f.path))),
  );

  if (kind === 'slice') {
    if (docsOnly) return out('skip', [], DOCS_ONLY);
    if (secondFamilyWrote(writer) && critical.length === 0)
      return out(
        'defer',
        [],
        writer === 'codex'
          ? 'cold slice written by the second family: the unit review covers it'
          : 'cold slice written partly by the second family: the unit review covers it',
      );
    if (writer !== 'claude' && critical.length > 0) {
      const by =
        writer === 'codex'
          ? 'the second family (an owner override, executor: codex)'
          : writer === 'sonnet'
            ? 'Sonnet (an owner override, executor: sonnet)'
            : 'several executors (the second family among them)';
      return out(
        'required',
        ['opus-code-reviewer'],
        `critical code written by ${by}: Opus reviews it now (${named})`,
      );
    }
    return out(
      'second-family',
      ['second-family-review'],
      'slice review goes to the second family, not to Opus',
    );
  }

  if (kind === 'unit') {
    if (docsOnly) return out('skip', [], DOCS_ONLY);
    const what =
      prod.length === 0
        ? '; tests only, no production code'
        : prod.every((f) => isInstruction(f.path))
          ? '; instruction files, no other production code'
          : '';
    if (lane)
      return out(
        'review',
        [crossFamily],
        `harness lane: one cross-family review over the diff, written by ${WRITER_NAMES[writer]}${what}`,
      );
    if (none) {
      // no production users: one cross-family read, the adversarial pass where a wrong answer costs most;
      // no silent-failure hunter (no live money or queue to fail quietly) and no re-tier advice
      const adv = secondFamilyWrote(writer) ? 'opus-adversarial' : 'second-family-adversarial';
      return out(
        'review',
        [crossFamily, ...(critical.length ? [adv] : []), ...specialists.filter((s) => s !== 'silent-failure-hunter')],
        `production: none: one cross-family review over the whole unit diff, written by ${WRITER_NAMES[writer]}${critical.length ? `, plus the adversarial pass over the critical code in it (${named})` : ''}${what}`,
      );
    }
    // critical code is Full (harness-bootstrap's reference/gate-design.md › Tiers): a mis-tiered unit gets the full lineup anyway
    const escalate = tier === 'small' && critical.length > 0;
    if (tier === 'small' && !escalate) {
      // a Claude-family writer (Opus, Sonnet) is read by the second family; codex or mixed by Opus
      return out(
        'review',
        [crossFamily, ...specialists],
        `small unit written by ${WRITER_NAMES[writer]}: the other model family reviews the whole unit diff${what}`,
      );
    }
    const reviewers = [
      'opus-code-reviewer',
      'second-family-adversarial',
      ...specialists,
      ...(files.some((f) => isTest(f.path)) ? ['pr-test-analyzer'] : []),
    ];
    return out(
      'review',
      reviewers,
      `full unit: one review pass over the whole unit diff${what}${secondFamilyWrote(writer) ? '; the unit was written by the second family, so the Opus code-reviewer is the cross-family review' : ''}${escalate ? `; critical path at --tier small (${named}): reviewed as full, re-tier the row` : ''}${stray.length ? `; path outside HARNESS at --tier harness (${name(stray)}): reviewed as full, re-tier the unit` : ''}`,
    );
  }

  // kind 'fix'
  const p3Only = maxFixed === 'P3';
  if (lane && p3Only) return none ? out('skip', [], NO_P3_BATCH) : out('p3-batch', [], P3_BATCH);
  if (lane && !docsOnly) {
    // the lane allows one standard fix round, re-read by the family that did not write it; the second
    // is an adversarial pass, and a third means the change costs more than it earns: drop it
    if (round >= 3)
      return out(
        'drop',
        [],
        `harness lane, fix round ${round}: drop the change and file one line in docs/harness/upstream-notes.md; the lane does not run a third round`,
      );
    if (round === 2)
      return out(
        'adversarial',
        [writer !== 'claude' ? 'opus-adversarial' : 'second-family-adversarial'],
        'harness lane, fix round 2: the lane allows one standard fix round, so this one is an adversarial pass over the fix diff, run without asking',
      );
    return secondFamilyWrote(writer)
      ? out('review', ['opus-code-reviewer'], 'harness lane, fix round 1: the Opus reviewer re-reads the fix written by the second family')
      : out('second-family', ['second-family-review'], 'harness lane, fix round 1: the second family re-reads the fix');
  }
  if (maxFixed === 'P3') {
    // the batch is Sonnet's or the second family's: critical code in it still gets the Opus reader;
    // no specialist joins (P3s are nits)
    if (critical.length > 0 && writer !== 'claude')
      return none
        ? out(
            crossDecision,
            [crossFamily],
            `production: none: the P3 batch over critical code was written by ${WRITER_NAMES[writer]}, so the cross-family reviewer reads it (${named})`,
          )
        : out(
            'review',
            ['opus-code-reviewer'],
            `the P3 batch over critical code was written by ${WRITER_NAMES[writer]}, so Opus reads it (${named})`,
          );
    return none ? out('skip', [], NO_P3_BATCH) : out('p3-batch', [], P3_BATCH);
  }
  if (docsOnly) return out('skip', [], DOCS_ONLY);
  let r = fixRound({ critical, maxFixed, round, prodLines, writer });
  // what the second family wrote keeps its Opus reader at none: it is the cross-family one
  if (none && !secondFamilyWrote(writer) && r.reviewers.includes('opus-code-reviewer'))
    r = {
      decision: crossDecision,
      reviewers: [crossFamily],
      reason: `production: none: critical code, ${maxFixed === 'P2' ? 'P2' : 'P1'} fixed in ${prodLines} production lines: the cross-family reviewer re-reads the fix written by ${WRITER_NAMES[writer]}, no Opus pass`,
    };
  // the specialist whose trigger the fix hits joins its re-review (harness-bootstrap's reference/gate-design.md › Fix rounds),
  // and re-reads a fix that has none; a cut has nothing left to review
  if (specialists.length === 0 || r.decision === 'cut') return out(r.decision, r.reviewers, r.reason);
  if (r.decision === 'skip' || r.decision === 'defer')
    return out('review', specialists, `${r.reason}; the triggered specialist re-reads the fix`);
  return out(r.decision, [...r.reviewers, ...specialists], r.reason);
}

/** A fix round's decision before triggered specialists join it. `writer` wrote the fix. */
function fixRound({ critical, maxFixed, round, prodLines, writer }) {
  const d = (decision, reviewers, reason) => ({ decision, reviewers, reason });
  // the fix is not Opus's (the second family's, Sonnet's, or a mix): critical code gets an Opus
  // reviewer; a cold fix from the second family gets a Claude one
  const notOpus = writer !== 'claude';
  const byCodex = secondFamilyWrote(writer);
  if (critical.length === 0) {
    // fix re-reviews found a defect in 5% of 281 runs: only a fix that closed a P0 or P1 earns one
    if (maxFixed === 'P2')
      return d(
        'defer',
        [],
        'cold fix that closed only P2s: no re-review of its own -- the unit review reads it when one is still to come, its regression tests otherwise',
      );
    if (round === 1) {
      if (byCodex)
        return d(
          'review',
          ['opus-code-reviewer'],
          'cold fix round 1 closed a P1, written by the second family: the Opus reviewer re-reads the fix',
        );
      return d('second-family', ['second-family-review'], 'cold fix round 1 closed a P1: the second family re-reviews the fix');
    }
    return d('skip', [], 'cold fix round: its regression tests prove it, not another review');
  }
  // P2s go in one batch round: past round 2 a round that closed only P2s opens no ladder, and the
  // landing check re-reads each critical path it changed beyond reviewed content
  if (maxFixed === 'P2' && round >= 3)
    return d(
      'defer',
      [],
      `fix round ${round} on critical code closed only P2s: no re-review loop past round 2 -- the landing check reads what it changed (RE-REVIEW), no adversarial pass, redesign or cut`,
    );
  // rounds end by themselves: a third is adversarial, a fourth re-plans the area, a fifth cuts it
  const adversary = notOpus ? 'opus-adversarial' : 'second-family-adversarial';
  const byAdversary = notOpus ? 'the adversarial pass by Opus (the fix was not written by Opus)' : 'the adversarial pass by the second family';
  if (round >= 5)
    return d(
      'cut',
      [],
      `fix round ${round} on critical code: the redesign tripped again -- cut the area (flag-off or out of the diff), land what is green, file one follow-up; it parks only when the way forward is never-auto`,
    );
  if (round === 4)
    return d(
      'redesign',
      [adversary],
      `fix round 4 on critical code: the adversarial round tripped again -- the judgment model re-plans this area once, and ${byAdversary} reviews the new approach`,
    );
  if (round === 3)
    return d(
      'adversarial',
      [adversary],
      `fix round 3 on critical code: an adversarial pass over the fix diff, run without asking; ${byAdversary} reads it -- never another standard code-review round`,
    );
  const small = prodLines <= FIX_LINES;
  if (notOpus) {
    const by = `the fix was written by ${WRITER_NAMES[writer]}, so Opus reads it`;
    if (maxFixed === 'P2') return d('review', ['opus-code-reviewer'], `critical code, P2 fixed: ${by}`);
    if (small)
      return d(
        'review',
        ['opus-code-reviewer'],
        `critical code, P1 fixed in ${prodLines} <= ${FIX_LINES} production lines: ${by}`,
      );
    return d(
      'review',
      ['opus-code-reviewer'],
      `critical code, P1 fixed in ${prodLines} > ${FIX_LINES} production lines: ${by}; at most two Opus rounds`,
    );
  }
  if (maxFixed === 'P2')
    return d('second-family', ['second-family-review'], 'critical code, P2 fixed: the second family re-reviews');
  if (small)
    return d(
      'second-family',
      ['second-family-review'],
      `critical code, P1 fixed in ${prodLines} <= ${FIX_LINES} production lines: the second family re-reviews, no Opus pass`,
    );
  return d(
    'second-family+opus',
    ['second-family-review', 'opus-code-reviewer'],
    `critical code, P1 fixed in ${prodLines} > ${FIX_LINES} production lines: Opus re-reviews only critical code with a P1 fixed; at most two Opus rounds`,
  );
}

/** The one line the CLI prints. */
export function formatLine(r) {
  return `review-gate: ${r.decision} — ${r.reason} → ${r.reviewers.join(' + ') || 'none'} [${r.prodFiles} production files, ${r.prodLines} lines; stakes ${r.stakes}; not checked: ${r.notChecked.join(', ')}]`;
}

// ---- the landing check: every critical path the merge lands is content a cross-family review read

const HEX_TREE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// the ledger each host's own family writes: its rows are that family reviewing itself
const OWN_LEDGER = { claude: 'claude', codex: 'codex' };
// why a critical path left unreached is NONE when no host variable named the host
const NO_HOST = 'no host named itself (ZCODE_*, CODEX_THREAD_ID, CODEX_SANDBOX, CLAUDECODE or HARNESS_HOST), so no review row counts: run git from the host, or ask the owner to merge it';

const stamp = (at) => {
  const t = Date.parse(at);
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * Ledger rows (codex-run's and claude-run's, read by the CLI, each with its `ledger` and the
 * `family` that ledger belongs to) → the rows that can certify content at landing: an ok run of a
 * kind in LANDING_KINDS that recorded a hex `tree` and `baseTree` and whose tree did not move during
 * the run, from the ledger of the family that is not the host's. On Claude Code a claude-run row is
 * Claude reviewing Claude, so only codex-run's count, and the reverse on Codex; ZCode and Kimi
 * count both. An unknown host counts none: the hook trusts the environment, which a process can
 * strip, so an unidentified host fails closed. The CLI still drops a row whose trees git cannot read.
 */
export function qualifyingRows(rows, host) {
  if (host === 'unknown') return [];
  return rows.filter(
    (row) =>
      row &&
      typeof row === 'object' &&
      row.outcome === 'ok' &&
      LANDING_KINDS.includes(row.kind) &&
      HEX_TREE.test(row.tree ?? '') &&
      HEX_TREE.test(row.baseTree ?? '') &&
      row.treeMoved !== true &&
      (row.family === 'codex' || row.family === 'claude') &&
      row.family !== OWN_LEDGER[host],
  );
}

/** The nodes reachable from `starts` over `edges` ({ from, to }): a blob id, or 'absent'. */
function reachable(starts, edges) {
  const seen = new Set(starts);
  const queue = [...starts];
  while (queue.length) {
    const node = queue.shift();
    for (const e of edges) {
      if (e.from === node && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return seen;
}

/**
 * The landing verdict, from facts the CLI gathered. `changed` is every path that differs between
 * `base` (the mainline commit) and `result` (the tree the merge writes). `blockChanged[p]` says
 * whether AGENTS.md or CLAUDE.md changed its harness blocks (blocksDiffer); a comparison not made
 * counts as changed. `rows` are the qualifying rows, and `paths[p]`, for each critical path, holds
 * its `starts` (its blob at the base and at each `trust` commit), its `result` blob and one edge
 * `{ from, to, row }` per row (its blob at the row's baseTree → at its tree), 'absent' for no file.
 *
 * Why reachability, not the latest row's tree: a later narrow review, or one over an empty diff,
 * read only its own range, so it says nothing about the edits before it; and a merge can write
 * content no branch held. A path is reached when its result blob follows from a start through
 * changes some review read. A self-loop is a review that read no change to the path: it adds
 * nothing. A guard is checked first, so no agent judges its own edit to a gate. An unknown host
 * counts no row, so only the base and the trusted tips reach, and a path left unreached is NONE: the
 * hook trusts the environment, which a process can strip, so an unidentified host fails closed.
 */
export function landing({ result, base, trust = [], changed, blockChanged = {}, rows = [], paths = {}, host }) {
  const guards = changed.filter((p) => isGuard(p) && (!holdsBlocks(p) || blockChanged[p] !== false));
  const critical = changed.filter(isLandingCritical);
  const out = (verdict, reason, { unreached = [], from = null } = {}) => ({
    verdict,
    result,
    base,
    trust,
    changed,
    guards,
    critical,
    unreached,
    from,
    rows: rows.map(({ kind, at, ledger, tree, baseTree }) => ({ kind, at, ledger: ledger ?? null, tree, baseTree })),
    host,
    reason,
  });
  if (guards.length) return out('NONE', `a guard, a gate or a reviewed block changed (${name(guards)}): the owner merges`);
  if (critical.length === 0) return out('PASS', 'no critical path changed');

  // per path, what the starts reach; a path the CLI could not look up has no facts and is unreached.
  // An unknown host counts no row: only the base and the trusted tips reach.
  const closure = new Map();
  for (const p of critical) {
    const facts = paths[p] && (host === 'unknown' ? { ...paths[p], edges: [] } : paths[p]);
    if (facts) closure.set(p, reachable(facts.starts, facts.edges.filter((e) => e.from !== e.to)));
  }
  const unreached = critical.filter((p) => !closure.get(p)?.has(paths[p].result));
  if (unreached.length === 0) return out('PASS', `every critical path is reviewed content (${rows.length} review rows)`);
  if (host === 'unknown') return out('NONE', NO_HOST, { unreached });

  const read = unreached.some((p) => (paths[p]?.edges ?? []).some((e) => e.from !== e.to));
  if (!read) return out('NONE', `no recorded cross-family review of ${name(unreached)}: the owner merges`, { unreached });

  // the re-review starts at the latest reviewed tree that holds reviewed content for every unreached
  // path, so it reads only the delta; with none, it reads the whole change from the base
  const holdsReached = (row) =>
    unreached.every((p) => (paths[p]?.edges ?? []).some((e) => e.row === row && closure.get(p).has(e.to)));
  let latest = null;
  for (const row of rows) if (holdsReached(row) && (!latest || stamp(row.at) >= stamp(latest.at))) latest = row;
  const from = latest ? latest.tree : base;
  return out(
    'RE-REVIEW',
    `critical paths changed beyond the reviewed content: ${name(unreached)} → second-family-adversarial --base ${from} over git diff ${from} ${result} -- ${unreached.join(' ')}, on the branch with the mainline merged in`,
    { unreached, from },
  );
}

/** The one line the landing check prints. */
export function formatLanding(r) {
  return `Landing: ${String(r.result).slice(0, 12)} ${r.verdict} — ${r.reason}`;
}
