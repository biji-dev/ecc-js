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
// fixed, at most two Opus rounds, and a re-review is scoped to the fix.
//
// Decides from FACTS about a diff (paths, production lines, what a fix round fixed) which review
// it is owed, so the main thread does not guess. No I/O here, so the test can pin each rule.

// ---- [B] project bindings — from the reviewed risk map in the harness file
export const CRITICAL = []; // path regexes of critical code (risk map › critical); empty until bound
export const NON_PRODUCTION = [/\.md$/, /^docs\//, /(^|\/)(__tests__|tests?|e2e|fixtures)\//, /\.(test|spec)\.[cm]?[jt]sx?$/]; // paths that are not production code (docs, tests, fixtures)
export const TESTS = [/(^|\/)(__tests__|tests?|e2e)\//, /\.(test|spec)\.[cm]?[jt]sx?$/]; // paths that count as tests (calls the test analyzer at the unit review)
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
// ---- end [B]

export const KINDS = ['slice', 'unit', 'fix'];
export const TIERS = ['small', 'full'];
export const WRITERS = ['claude', 'codex'];
export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];

const UNBOUND_NOTE = 'CRITICAL unbound — every path treated as cold';

export const isProduction = (path) => !NON_PRODUCTION.some((re) => re.test(path));
export const isCritical = (path) => CRITICAL.some((re) => re.test(path));
export const isTest = (path) => TESTS.some((re) => re.test(path));

/** `git diff --numstat --no-renames` output → [{ path, lines }] (binary files count 0 lines). */
export function parseNumstat(text) {
  return String(text)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...rest] = line.split('\t');
      return {
        path: rest.join('\t'),
        lines: (Number(added) || 0) + (Number(deleted) || 0),
      };
    });
}

/**
 * CLI arguments → options. Throws on an unknown option or a missing value; `--base` is required.
 * `kind` is validated by `decide`, so a bad or missing kind is the same usage error everywhere.
 */
export function parseArgs(argv) {
  const a = { tier: 'full', writer: 'claude', round: 1, maxFixed: null, json: false };
  const names = {
    '--base': 'base',
    '--head': 'head',
    '--kind': 'kind',
    '--tier': 'tier',
    '--writer': 'writer',
    '--max-fixed': 'maxFixed',
    '--round': 'round',
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (names[t]) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[names[t]] = v;
    } else throw new Error(`unknown option ${t}`);
  }
  if (!a.base) throw new Error('--base <sha> is required');
  a.round = Number(a.round);
  return a;
}

/**
 * kind 'slice': after a slice passes its gate, before the next builds on it.
 * kind 'unit':  step 8, once, over the whole unit diff from the merge base.
 * kind 'fix':   once per fix round, over `<sha-before-the-fixes>..` (pass the whole round once,
 *               after its last fix group); `maxFixed` is the highest severity the round fixed
 *               (P0 counts as P1) and `round` counts fix rounds on this area from 1.
 * decision: 'skip' | 'defer' | 'required' | 'second-family' | 'review' | 'sweep' |
 *           'second-family+opus' | 'escalate-adversarial'.
 * `files` is [{ path, lines }]; `reviewers` is the ordered list of reviewers to run (maybe empty).
 */
export function decide({ files, kind, tier = 'full', writer = 'claude', maxFixed = null, round = 1 }) {
  if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join('|')}`);
  if (!TIERS.includes(tier)) throw new Error(`--tier must be one of ${TIERS.join('|')}`);
  if (!WRITERS.includes(writer)) throw new Error(`--writer must be one of ${WRITERS.join('|')}`);
  if (!Number.isInteger(round) || round < 1) throw new Error('--round must be an integer >= 1');
  if (kind === 'fix' && !SEVERITIES.includes(maxFixed))
    throw new Error(`--max-fixed must be one of ${SEVERITIES.join('|')} for --kind fix`);

  const prod = files.filter((f) => isProduction(f.path));
  const critical = prod.filter((f) => isCritical(f.path)).map((f) => f.path);
  const prodLines = prod.reduce((n, f) => n + f.lines, 0);
  const notChecked = [
    'importers>=10',
    'critical code outside the CRITICAL path set',
    ...(CRITICAL.length === 0 ? [UNBOUND_NOTE] : []),
  ];
  const facts = {
    kind,
    tier,
    writer,
    round,
    maxFixed,
    prodFiles: prod.length,
    prodLines,
    critical,
    notChecked,
  };
  const out = (decision, reviewers, reason) => ({ decision, reviewers, reason, ...facts });

  if (kind === 'slice') {
    if (prodLines === 0) return out('skip', [], 'no production code: tests or docs only');
    if (writer === 'codex' && critical.length === 0)
      return out(
        'defer',
        [],
        'cold slice written by the second family: the unit review covers it',
      );
    if (writer === 'codex')
      return out(
        'required',
        ['opus-code-reviewer'],
        `critical code written by the second family: a Claude reviewer now (${critical[0]}${critical.length > 1 ? ` +${critical.length - 1}` : ''}; critical code should not go to the second family)`,
      );
    return out(
      'second-family',
      ['second-family-review'],
      'slice review goes to the second family, not to Opus',
    );
  }

  if (kind === 'unit') {
    if (prodLines === 0) return out('skip', [], 'no production code: tests or docs only');
    const specialists = Object.keys(TRIGGERS).filter((name) =>
      prod.some((f) => TRIGGERS[name].some((re) => re.test(f.path))),
    );
    if (tier === 'small') {
      const base = writer === 'claude' ? 'second-family-review' : 'sonnet-code-reviewer';
      return out(
        'review',
        [base, ...specialists],
        `small unit written by ${writer}: the other model family reviews the whole unit diff`,
      );
    }
    const reviewers = [
      'opus-code-reviewer',
      'second-family-adversarial',
      ...specialists,
      ...(files.some((f) => isTest(f.path)) ? ['pr-test-analyzer'] : []),
    ];
    return out('review', reviewers, 'full unit: one review pass over the whole unit diff');
  }

  // kind 'fix'
  if (maxFixed === 'P3')
    return out(
      'sweep',
      [],
      'P3s never open a fix round: batch them into one sweep per slice set, no re-review',
    );
  if (prodLines === 0) return out('skip', [], 'no production code: tests or docs only');
  if (critical.length === 0) {
    if (round === 1)
      return out('second-family', ['second-family-review'], 'cold fix round 1: the second family re-reviews the fix');
    return out('skip', [], 'cold fix round: its regression tests prove it, not another review');
  }
  if (round >= 3)
    return out(
      'escalate-adversarial',
      ['second-family-adversarial'],
      `fix round ${round} on critical code: an adversarial pass instead of another review`,
    );
  if (maxFixed === 'P2')
    return out('second-family', ['second-family-review'], 'critical code, P2 fixed: the second family re-reviews');
  if (prodLines <= FIX_LINES)
    return out(
      'second-family',
      ['second-family-review'],
      `critical code, P1 fixed in ${prodLines} <= ${FIX_LINES} production lines: the second family re-reviews, no Opus pass`,
    );
  return out(
    'second-family+opus',
    ['second-family-review', 'opus-code-reviewer'],
    `critical code, P1 fixed in ${prodLines} > ${FIX_LINES} production lines: Opus re-reviews only critical code with a P1 fixed; at most two Opus rounds`,
  );
}

/** The one line the CLI prints. */
export function formatLine(r) {
  return `review-gate: ${r.decision} — ${r.reason} → ${r.reviewers.join(' + ') || 'none'} [${r.prodFiles} production files, ${r.prodLines} lines; not checked: ${r.notChecked.join(', ')}]`;
}
