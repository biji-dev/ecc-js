/**
 * Tests for the harness-bootstrap review workflow template (biji-dev/ecc-js):
 * skills/harness-bootstrap/templates/workflows/review.workflow.js, executed in a
 * `vm` sandbox with stubbed Workflow globals (agent, parallel, pipeline, phase, log, args).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SHIPPED = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'workflows', 'review.workflow.js');
const SOURCE = fs.readFileSync(SHIPPED, 'utf8');

let passed = 0;
let failed = 0;
const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
}

const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function diffFor(...files) {
  return files.map(f => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-old\n+new\n`).join('');
}

/**
 * Run the workflow source in a vm context with stubbed globals.
 * handlers.review(dimension, call) -> result; handlers.verify(finding title, call) -> result.
 */
async function run(args, handlers = {}, src = SOURCE) {
  const calls = [];
  const phases = [];
  const code = src.replace(/^export const meta/m, 'const meta');
  const sandbox = {
    args,
    phase: title => { phases.push(title); },
    log: () => {},
    agent: async (prompt, opts) => {
      const call = { prompt, opts };
      calls.push(call);
      if (opts.phase === 'Review') {
        const dimension = opts.label.replace(/^review:/, '');
        if (handlers.review) return handlers.review(dimension, call);
        return { findings: [], checkedClean: [`${dimension} ok`] };
      }
      const title = (prompt.match(/: (.+)\nEvidence:/) || [])[1];
      return handlers.verify ? handlers.verify(title, call) : { isReal: true, confidence: 0.9, reasoning: 'r', reproduction: 'p' };
    },
    parallel: thunks => Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null))),
    pipeline: async (items, ...stages) => {
      const out = await Promise.all(items.map(async (item, i) => {
        let prev = item;
        for (const stage of stages) prev = await stage(prev, item, i);
        return prev;
      }));
      // handlers.reorderPipeline simulates a runtime that does not return results in input order.
      return handlers.reorderPipeline ? out.slice().reverse() : out;
    }
  };
  vm.createContext(sandbox);
  const result = await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox);
  return { result: plain(result), calls, phases };
}

const finding = (over = {}) => ({
  title: 'Unchecked input',
  severity: 'P1',
  file: 'src/app.tsx',
  line: 3,
  evidence: 'const x = req.body.id',
  why: 'not validated',
  repro: 'post an empty body',
  introduced: 'this-diff',
  scopeClass: 'IN',
  ...over
});

const dimsOf = async (files, extra = {}) => {
  const { calls } = await run({ diff: diffFor(...files), tier: 'small', ...extra });
  return calls.filter(c => c.opts.phase === 'Review').map(c => c.opts.label.replace(/^review:/, ''));
};

// ── static shape ─────────────────────────────────────────────────────────────

console.log('\nreview workflow: shape');

test('meta is a pure literal with name, description and exactly the Review and Verify phases', () => {
  const m = SOURCE.match(/^export const meta = (\{[\s\S]*?\n\});/m);
  assert.ok(m, 'export const meta literal found');
  const meta = plain(vm.runInNewContext(`(${m[1]})`, {}));
  assert.strictEqual(meta.name, 'harness-review');
  assert.ok(meta.description && meta.description.length > 10);
  assert.deepStrictEqual(meta.phases.map(p => p.title), ['Review', 'Verify']);
  const used = [...SOURCE.matchAll(/\bphase\('([^']+)'\)/g)].map(x => x[1]);
  assert.deepStrictEqual(used, ['Review', 'Verify']);
  for (const title of used) assert.ok(meta.phases.some(p => p.title === title), `${title} is in meta.phases`);
});

test('the script begins with export const meta (Workflow tool runtime contract)', () => {
  const first = SOURCE.split('\n').find(line => line.trim() !== '');
  assert.ok(first.startsWith('export const meta'), `first non-empty line is: ${first}`);
  assert.ok(SOURCE.indexOf('harness-bootstrap review workflow (generated') > SOURCE.indexOf('export const meta'), 'header follows meta');
});

test('source avoids nondeterministic APIs that break resume', () => {
  assert.ok(!/Date\.now/.test(SOURCE), 'no Date.now');
  assert.ok(!/Math\.random/.test(SOURCE), 'no Math.random');
  assert.ok(!/new Date\(\)/.test(SOURCE), 'no argless new Date()');
});

test('every agent() call receives model, effort and agentType', async () => {
  const { calls } = await run(
    { diff: diffFor('src/app.tsx'), tier: 'full', plan: 'do the thing', secondFamily: 'unavailable' },
    { review: dim => ({ findings: dim === 'quality' ? [finding()] : [], checkedClean: [] }) }
  );
  assert.ok(calls.length >= 3);
  for (const { opts } of calls) {
    assert.ok(opts.model, `${opts.label} has model`);
    assert.ok(opts.effort, `${opts.label} has effort`);
    assert.ok(opts.agentType, `${opts.label} has agentType`);
  }
  const byLabel = Object.fromEntries(calls.map(c => [c.opts.label, c.opts]));
  assert.strictEqual(byLabel['review:quality'].model, 'opus');
  assert.strictEqual(byLabel['review:conformance'].model, 'sonnet');
  assert.strictEqual(byLabel['review:blastRadius'].model, 'opus');
  assert.ok(calls.some(c => c.opts.phase === 'Verify'), 'a verifier ran');
});

test('every dimension gets its own agentType, effort high and the right model per tier (tests runs on sonnet in both)', async () => {
  const all = ['quality', 'typescript', 'react', 'security', 'database', 'silentFailure', 'tests', 'conformance', 'blastRadius'];
  const expectedAgent = {
    quality: 'code-reviewer', conformance: 'plan-conformance-auditor', blastRadius: 'blast-radius-auditor',
    typescript: 'ecc:typescript-reviewer', react: 'ecc:react-reviewer', security: 'ecc:security-reviewer',
    database: 'ecc:database-reviewer', silentFailure: 'ecc:silent-failure-hunter', tests: 'ecc:pr-test-analyzer'
  };
  for (const tier of ['small', 'full']) {
    const standard = tier === 'full' ? 'opus' : 'sonnet';
    const { calls } = await run(
      { diff: diffFor('src/app.tsx'), tier, dimensions: all },
      { review: dim => ({ findings: dim === 'quality' ? [finding()] : [], checkedClean: [] }) }
    );
    const reviews = calls.filter(c => c.opts.phase === 'Review');
    assert.strictEqual(reviews.length, all.length);
    for (const { opts } of calls) assert.strictEqual(opts.effort, 'high', `${opts.label} effort (${tier})`);
    for (const dim of all) {
      const opts = reviews.find(c => c.opts.label === `review:${dim}`).opts;
      assert.strictEqual(opts.agentType, expectedAgent[dim], `${dim} agentType (${tier})`);
      const model = dim === 'conformance' || dim === 'tests' ? 'sonnet' : dim === 'blastRadius' ? 'opus' : standard;
      assert.strictEqual(opts.model, model, `${dim} model (${tier})`);
    }
    const verifiers = calls.filter(c => c.opts.phase === 'Verify');
    assert.strictEqual(verifiers.length, 1);
    assert.strictEqual(verifiers[0].opts.model, 'opus', `verifier model (${tier})`);
    assert.ok(verifiers[0].opts.agentType, 'verifier agentType');
  }
});

test('prompts carry plan, scope, impact and the lane B outside-the-diff instruction', async () => {
  const { calls } = await run({ diff: diffFor('src/app.tsx'), tier: 'small', plan: 'PLAN-TEXT', scope: 'SCOPE-TEXT', impact: 'IMPACT-TEXT', secondFamily: 'unavailable' });
  const prompt = label => calls.find(c => c.opts.label === label).prompt;
  assert.ok(prompt('review:conformance').includes('PLAN-TEXT'));
  assert.ok(!prompt('review:quality').includes('PLAN-TEXT'));
  for (const label of ['review:quality', 'review:blastRadius']) {
    assert.ok(prompt(label).includes('SCOPE-TEXT') && prompt(label).includes('IMPACT-TEXT'));
  }
  assert.ok(prompt('review:blastRadius').includes('Look OUTSIDE the diff'));
  assert.ok(prompt('review:quality').includes('You did not write this code. Read-only'));
});

// ── selection ────────────────────────────────────────────────────────────────

console.log('\nreview workflow: dimension selection');

test('src/app.tsx routes to quality only (tests added for tier full); typescript and react are never auto-selected', async () => {
  assert.deepStrictEqual(await dimsOf(['src/app.tsx']), ['quality']);
  const { calls } = await run({ diff: diffFor('src/app.tsx'), tier: 'full' });
  assert.deepStrictEqual(calls.map(c => c.opts.label.replace(/^review:/, '')), ['quality', 'tests']);
  // even with every trigger and a plan, they stay out unless named
  const busy = await dimsOf(['src/auth/app.tsx', 'db/migrations/0001.sql', 'src/util.test.ts'], { plan: 'p', secondFamily: 'unavailable' });
  assert.ok(!busy.includes('typescript') && !busy.includes('react'), `got ${busy.join(',')}`);
});

test('typescript and react run when named in dimensions', async () => {
  assert.deepStrictEqual(await dimsOf(['src/app.tsx'], { dimensions: ['typescript', 'react'] }), ['typescript', 'react']);
});

test('secondFamily unavailable adds blastRadius; available or unset does not', async () => {
  assert.deepStrictEqual(await dimsOf(['src/app.tsx'], { secondFamily: 'unavailable' }), ['quality', 'blastRadius']);
  assert.deepStrictEqual(await dimsOf(['src/app.tsx'], { secondFamily: 'available' }), ['quality']);
  assert.ok(!(await dimsOf(['src/app.tsx'])).includes('blastRadius'));
});

test('secondFamily other than available/unavailable throws', async () => {
  await assert.rejects(
    () => run({ diff: diffFor('src/app.tsx'), tier: 'small', secondFamily: 'bogus' }),
    /harness-review: args\.secondFamily must be 'available' or 'unavailable'/
  );
});

test('a migration .sql path adds database', async () => {
  assert.ok((await dimsOf(['db/migrations/0003.sql'])).includes('database'));
});

test('database is triggered by migration and schema paths, not by a query-only file', async () => {
  assert.ok(!(await dimsOf(['src/db/query.ts'])).includes('database'), 'query.ts is not a schema change');
  assert.ok((await dimsOf(['db/migrations/0003.sql'])).includes('database'));
  assert.ok((await dimsOf(['src/db/migrations/0003.ts'])).includes('database'));
  assert.ok((await dimsOf(['drizzle/0003_x.ts'])).includes('database'));
  assert.ok((await dimsOf(['src/db/schema.ts'])).includes('database'));
  assert.ok(!(await dimsOf(['src/schema-utils.ts'])).includes('database'));
});

test('every review and verify prompt contains a Tool discipline line', async () => {
  const { calls } = await run(
    { diff: diffFor('src/app.tsx'), tier: 'full', plan: 'p', secondFamily: 'unavailable', dimensions: ['quality', 'typescript', 'react', 'security', 'database', 'silentFailure', 'tests', 'conformance', 'blastRadius'] },
    { review: dim => ({ findings: dim === 'quality' ? [finding()] : [], checkedClean: [] }) }
  );
  assert.ok(calls.some(c => c.opts.phase === 'Review') && calls.some(c => c.opts.phase === 'Verify'), 'both phases ran');
  for (const { opts, prompt } of calls) {
    assert.ok(prompt.split('\n').some(line => line.startsWith('Tool discipline:')), `${opts.label} has a Tool discipline line`);
  }
});

test('src/util.ts with tier small has no security reviewer; trigger paths add security and silentFailure', async () => {
  assert.ok(!(await dimsOf(['src/util.ts'])).includes('security'));
  const dims = await dimsOf(['src/auth/webhook.ts']);
  assert.ok(dims.includes('security') && dims.includes('silentFailure'));
});

test('trigger words in the diff text do not select security; changedFiles overrides parsing', async () => {
  const diff = diffFor('src/util.ts') + '+const token = await fetch(request).then(hash)\n';
  const { calls } = await run({ diff, tier: 'small' });
  assert.ok(!calls.some(c => c.opts.label === 'review:security'));
  assert.ok((await dimsOf(['src/util.ts'], { changedFiles: ['src/session.ts'] })).includes('security'));
});

test('a plan or a scope adds conformance; a test path adds tests; explicit dimensions override', async () => {
  assert.ok((await dimsOf(['src/util.ts'], { plan: 'p' })).includes('conformance'));
  assert.ok((await dimsOf(['src/util.ts'], { scope: 's' })).includes('conformance'));
  assert.ok(!(await dimsOf(['src/util.ts'])).includes('conformance'));
  assert.ok((await dimsOf(['src/util.test.ts'])).includes('tests'));
  assert.deepStrictEqual(await dimsOf(['src/app.tsx'], { dimensions: ['security'] }), ['security']);
});

test('changedFiles is unioned with the paths parsed from the diff', async () => {
  const dims = await dimsOf(['src/auth/login.ts'], { changedFiles: ['db/migrations/0001.sql'] });
  assert.ok(dims.includes('security'), 'parsed path kept');
  assert.ok(dims.includes('database'), 'changedFiles path added');
});

console.log('\nreview workflow: diff path parsing');

const gitHeader = (a, b, extra = '') => `diff --git ${a} ${b}\n${extra}`;
const pathCases = [
  // paths contain a trigger word (auth/session) or a migrations/ directory so the parsed path decides the auto-selected dimension
  ['mnemonic i/ w/', gitHeader('i/src/auth/login.ts', 'w/src/auth/login.ts', '--- i/src/auth/login.ts\n+++ w/src/auth/login.ts\n@@ -1 +1 @@\n-a\n+b\n'), ['security']],
  ['mnemonic c/ o/', gitHeader('c/src/auth/login.ts', 'o/src/auth/login.ts', '--- c/src/auth/login.ts\n+++ o/src/auth/login.ts\n@@ -1 +1 @@\n-a\n+b\n'), ['security']],
  ['--no-prefix', gitHeader('src/auth/login.ts', 'src/auth/login.ts', '--- src/auth/login.ts\n+++ src/auth/login.ts\n@@ -1 +1 @@\n-a\n+b\n'), ['security']],
  ['quoted non-ASCII path', gitHeader('"a/src/caf\\303\\251/auth.ts"', '"b/src/caf\\303\\251/auth.ts"', 'index 1..2 100644\n'), ['security']],
  ['rename-only entry', gitHeader('a/src/old.txt', 'b/src/session.ts', 'similarity index 100%\nrename from src/old.txt\nrename to src/session.ts\n'), ['security']],
  ['binary-only entry', gitHeader('a/db/migrations/0003.sql', 'b/db/migrations/0003.sql', 'Binary files a/db/migrations/0003.sql and b/db/migrations/0003.sql differ\n'), ['database']],
  ['path with spaces', gitHeader('a/src/my auth file.ts', 'b/src/my auth file.ts', 'index 1..2 100644\n'), ['security']]
];
for (const [name, diff, expected] of pathCases) {
  test(`path parsing: ${name}`, async () => {
    const { calls } = await run({ diff, tier: 'small' });
    const dims = calls.filter(c => c.opts.phase === 'Review').map(c => c.opts.label.replace(/^review:/, ''));
    for (const dim of expected) assert.ok(dims.includes(dim), `${dim} selected; got ${dims.join(',')}`);
  });
}

// The parser itself, lifted from the shipped source (everything above the input section is declarations only).
function loadParser() {
  const head = SOURCE.slice(0, SOURCE.indexOf('// ---- input')).replace(/^export const meta/m, 'const meta');
  assert.ok(head.includes('function parseChangedFiles'), 'parser found above the input section');
  return vm.runInNewContext(`(() => {\n${head}\nreturn parseChangedFiles;\n})()`, {});
}

test('path parsing: a one-letter top directory is a prefix only when the pair differs (a/b, c/w, i/w, o/w)', () => {
  const parse = loadParser();
  const git = (a, b) => `diff --git ${a} ${b}\nindex 1..2 100644\n--- ${a}\n+++ ${b}\n@@ -1 +1 @@\n-a\n+b\n`;
  // --no-prefix: both sides are the same path, so `x/` is a real directory
  assert.deepStrictEqual(plain(parse(git('x/y.ts', 'x/y.ts'))), ['x/y.ts']);
  assert.deepStrictEqual(plain(parse('diff --git x/y.ts x/y.ts\n')), ['x/y.ts']);
  assert.deepStrictEqual(plain(parse('diff --git x/my file.ts x/my file.ts\n')), ['x/my file.ts']);
  assert.deepStrictEqual(plain(parse(git('"x/caf\\303\\251.ts"', '"x/caf\\303\\251.ts"'))), ['x/caf\\303\\251.ts']);
  // default and mnemonic prefixes still strip
  for (const [a, b] of [['a', 'b'], ['c', 'w'], ['i', 'w'], ['o', 'w'], ['c', 'o']]) {
    assert.deepStrictEqual(plain(parse(git(`${a}/y.ts`, `${b}/y.ts`))), ['y.ts'], `${a}/ ${b}/`);
    assert.deepStrictEqual(plain(parse(git(`${a}/x/y.ts`, `${b}/x/y.ts`))), ['x/y.ts'], `${a}/ ${b}/ keeps x/`);
  }
  assert.deepStrictEqual(plain(parse(git('a/a/y.ts', 'b/a/y.ts'))), ['a/y.ts']);
  assert.deepStrictEqual(plain(parse(git('a/src/old.txt', 'b/src/new.ts'))), ['src/new.ts']);
});

test('path parsing: the ---/+++ pair of a diff with no git header follows the same rule', () => {
  const parse = loadParser();
  const plainDiff = (a, b) => `--- ${a}\n+++ ${b}\n@@ -1 +1 @@\n-a\n+b\n`;
  assert.deepStrictEqual(plain(parse(plainDiff('x/y.ts', 'x/y.ts'))), ['x/y.ts']);
  assert.deepStrictEqual(plain(parse(plainDiff('a/y.ts', 'b/y.ts'))), ['y.ts']);
  assert.deepStrictEqual(plain(parse(plainDiff('i/y.ts\t2020-01-01', 'w/y.ts\t2020-01-02'))), ['y.ts']);
  assert.deepStrictEqual(plain(parse(plainDiff('/dev/null', 'b/new.ts'))), ['new.ts']);
  assert.deepStrictEqual(plain(parse(plainDiff('/dev/null', 'x/new.ts'))), ['x/new.ts']);
  assert.deepStrictEqual(plain(parse(plainDiff('a/gone.ts', '/dev/null'))), ['gone.ts']);
  assert.deepStrictEqual(plain(parse(plainDiff('x/gone.ts', '/dev/null'))), ['x/gone.ts']);
});

test('path parsing: the ---/+++ lines of a file whose git header gave a path add nothing', () => {
  const parse = loadParser();
  const diff = 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n--- note\n+++ note\n';
  assert.deepStrictEqual(plain(parse(diff)), ['src/app.ts']);
});

test('path parsing fails closed: unparseable diff without changedFiles throws, with changedFiles runs', async () => {
  const diff = 'this is not a unified diff, just some text\n';
  await assert.rejects(() => run({ diff, tier: 'small' }), /changedFiles/);
  await assert.rejects(() => run({ diff, tier: 'small', changedFiles: [] }), /changedFiles/);
  const dims = await dimsOf([], { diff, changedFiles: ['src/auth/login.ts'] });
  assert.ok(dims.includes('security'));
});

// ── verification and verdict ─────────────────────────────────────────────────

console.log('\nreview workflow: verification (fail closed)');

const withP1 = { review: dim => ({ findings: dim === 'quality' ? [finding()] : [], checkedClean: ['clean'] }) };
const verdictCases = [
  [{ isReal: false, confidence: 0.9, reasoning: 'r', reproduction: 'p' }, 'advisory', 'APPROVE'],
  [{ isReal: false, confidence: 0.5, reasoning: 'r', reproduction: 'p' }, 'blocking', 'CHANGES_REQUESTED'],
  [null, 'blocking', 'CHANGES_REQUESTED'],
  [{ isReal: true, confidence: 0.99, reasoning: 'r', reproduction: 'p' }, 'blocking', 'CHANGES_REQUESTED']
];

async function checkVerdictCases(src) {
  const out = [];
  for (const [verdict, bucket, expected] of verdictCases) {
    const { result } = await run({ diff: diffFor('src/app.tsx'), tier: 'small' }, { ...withP1, verify: () => verdict }, src);
    const inBucket = result[bucket].some(f => f.title === 'Unchecked input');
    out.push(inBucket && result.verdict === expected);
  }
  return out;
}

test('P1 refuted at 0.9 is advisory (APPROVE); at 0.5, null or isReal=true it stays blocking', async () => {
  assert.deepStrictEqual(await checkVerdictCases(SOURCE), [true, true, true, true]);
});

test('a P0 is verified too: refuted at 0.5 it stays blocking, refuted at 0.9 it is advisory', async () => {
  const p0 = { review: dim => ({ findings: dim === 'quality' ? [finding({ severity: 'P0', title: 'Data loss' })] : [], checkedClean: [] }) };
  const weak = await run({ diff: diffFor('src/app.tsx'), tier: 'small' }, { ...p0, verify: () => ({ isReal: false, confidence: 0.5, reasoning: 'r', reproduction: 'p' }) });
  assert.ok(weak.calls.some(c => c.opts.phase === 'Verify'), 'a verifier ran for the P0');
  assert.deepStrictEqual(weak.result.blocking.map(f => f.title), ['Data loss']);
  assert.strictEqual(weak.result.verdict, 'CHANGES_REQUESTED');
  const strong = await run({ diff: diffFor('src/app.tsx'), tier: 'small' }, { ...p0, verify: () => ({ isReal: false, confidence: 0.9, reasoning: 'r', reproduction: 'p' }) });
  assert.deepStrictEqual(strong.result.advisory.map(f => f.title), ['Data loss']);
  assert.strictEqual(strong.result.verdict, 'APPROVE');
});

test('verdicts are paired with their finding, not by position', async () => {
  const two = { review: dim => ({
    findings: dim === 'quality' ? [finding({ title: 'Alpha', evidence: 'a' }), finding({ title: 'Beta', evidence: 'b' })] : [],
    checkedClean: []
  }) };
  const verify = title => (title === 'Alpha'
    ? { isReal: false, confidence: 0.95, reasoning: 'r', reproduction: 'p' }
    : { isReal: true, confidence: 0.95, reasoning: 'r', reproduction: 'p' });
  const { result } = await run({ diff: diffFor('src/app.tsx'), tier: 'small' }, { ...two, verify, reorderPipeline: true });
  assert.deepStrictEqual(result.advisory.map(f => f.title), ['Alpha']);
  assert.deepStrictEqual(result.blocking.map(f => f.title), ['Beta']);
});

test('a finding with an unknown severity fails its dimension', async () => {
  for (const bad of [finding({ severity: 'P9' }), finding({ severity: 'constructor' }), finding({ severity: undefined }), null]) {
    const { result } = await run(
      { diff: diffFor('src/app.tsx'), tier: 'small', dimensions: ['quality', 'react'] },
      { review: dim => ({ findings: dim === 'react' ? [bad,finding({ severity: 'P3', evidence: 'ok' })] : [], checkedClean: [] }) }
    );
    assert.deepStrictEqual(result.failedDimensions, ['react'], `severity ${bad && bad.severity}`);
    assert.strictEqual(result.incomplete, true);
    assert.strictEqual(result.verdict, 'CHANGES_REQUESTED');
  }
});

test('P2 and P3 are advisory without verification', async () => {
  const { result, calls } = await run(
    { diff: diffFor('src/app.tsx'), tier: 'small' },
    { review: dim => ({ findings: dim === 'quality' ? [finding({ severity: 'P2' }), finding({ severity: 'P3', evidence: 'other' })] : [], checkedClean: [] }) }
  );
  assert.ok(!calls.some(c => c.opts.phase === 'Verify'));
  assert.strictEqual(result.verdict, 'APPROVE');
  assert.strictEqual(result.advisory.length, 2);
  assert.deepStrictEqual(result.counts, { P0: 0, P1: 0, P2: 1, P3: 1 });
});

test('a failed dimension makes the run incomplete and CHANGES_REQUESTED', async () => {
  const { result } = await run(
    { diff: diffFor('src/app.tsx'), tier: 'small', dimensions: ['quality', 'react'] },
    { review: dim => (dim === 'react' ? null :{ findings: [], checkedClean: ['ok'] }) }
  );
  assert.strictEqual(result.incomplete, true);
  assert.strictEqual(result.verdict, 'CHANGES_REQUESTED');
  assert.deepStrictEqual(result.failedDimensions, ['react']);
  assert.ok(!result.dimensionsRun.includes('react') && result.dimensionsRun.includes('quality'));
  assert.deepStrictEqual(result.checkedClean.quality, ['ok']);
});

test('a clean run approves and reports checkedClean per dimension', async () => {
  const { result } = await run({ diff: diffFor('src/util.ts'), tier: 'small', secondFamily: 'unavailable' });
  assert.strictEqual(result.verdict, 'APPROVE');
  assert.strictEqual(result.incomplete, false);
  assert.deepStrictEqual(result.dimensionsRun, ['quality', 'blastRadius']);
  assert.deepStrictEqual(result.checkedClean.blastRadius, ['blastRadius ok']);
});

test('same evidence but different claims are not merged: both are verified', async () => {
  const { result, calls } = await run(
    { diff: diffFor('src/app.tsx'), tier: 'small', dimensions: ['quality', 'react'] },
    {
      review: dim => {
        if (dim === 'quality') return { findings: [finding({ title: 'Style nit about the line', evidence: 'db.query(sql + id)' })], checkedClean: [] };
        if (dim === 'react') return { findings: [finding({ title: 'SQL injection', evidence: 'db.query(sql + id)' })], checkedClean: [] };
        return { findings: [], checkedClean: [] };
      },
      verify: title => (title === 'SQL injection'
        ? { isReal: true, confidence: 0.9, reasoning: 'r', reproduction: 'p' }
        : { isReal: false, confidence: 0.95, reasoning: 'r', reproduction: 'p' })
    }
  );
  assert.strictEqual(calls.filter(c => c.opts.phase === 'Verify').length, 2);
  assert.deepStrictEqual(result.blocking.map(f => f.title), ['SQL injection']);
  assert.strictEqual(result.verdict, 'CHANGES_REQUESTED');
});

test('titles that differ only by case or whitespace still dedup; empty evidence keys on file, line and title', async () => {
  const { result } = await run(
    { diff: diffFor('src/app.tsx'), tier: 'small', dimensions: ['quality', 'react', 'typescript'] },
    { review: dim => {
      if (dim === 'quality') return { findings: [finding({ severity: 'P3', title: 'Unchecked   INPUT' })], checkedClean: [] };
      if (dim === 'react') return { findings: [finding({ severity: 'P3', title: 'unchecked input' })], checkedClean: [] };
      if (dim === 'typescript') return { findings: [finding({ severity: 'P3', evidence: '', line: 1, title: 'First' }), finding({ severity: 'P3', evidence: '', line: 2, title: 'Second' })], checkedClean: [] };
      return { findings: [], checkedClean: [] };
    } }
  );
  const titles = result.advisory.map(f => f.title).sort();
  assert.strictEqual(titles.length, 3, `got ${titles.join(' | ')}`);
  assert.ok(titles.includes('First') && titles.includes('Second'));
});

test('FINDINGS_SCHEMA requires non-empty evidence, title, file, why and repro', async () => {
  const { calls } = await run({ diff: diffFor('src/app.tsx'), tier: 'small' });
  const props = calls[0].opts.schema.properties.findings.items.properties;
  for (const key of ['evidence', 'title', 'file', 'why', 'repro']) assert.strictEqual(props[key].minLength, 1, key);
});

test('FINDINGS_SCHEMA rejects whitespace-only title, file and evidence (they feed the dedup key)', async () => {
  const { calls } = await run({ diff: diffFor('src/app.tsx'), tier: 'small' });
  const props = calls[0].opts.schema.properties.findings.items.properties;
  for (const key of ['title', 'file', 'evidence']) {
    const re = new RegExp(props[key].pattern);
    for (const blank of [' ', '   ', '\t\n']) assert.ok(!re.test(blank), `${key} rejects ${JSON.stringify(blank)}`);
    assert.ok(re.test('a') && re.test(' a '), `${key} accepts text`);
  }
});

test('the same finding from two dimensions dedups to one at the strictest severity', async () => {
  const { result } = await run(
    { diff: diffFor('src/app.tsx'), tier: 'small', dimensions: ['quality', 'react'] },
    {
      review: dim => {
        if (dim === 'quality') return { findings: [finding({ severity: 'P2', evidence: '  const X =   req.body.id ' })], checkedClean: [] };
        if (dim === 'react') return { findings: [finding({ severity: 'P1' })], checkedClean: [] };
        return { findings: [], checkedClean: [] };
      },
      verify: () => ({ isReal: true, confidence: 0.9, reasoning: 'r', reproduction: 'p' })
    }
  );
  const all = [...result.blocking, ...result.advisory];
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].severity, 'P1');
  assert.deepStrictEqual([...all[0].dimensions].sort(), ['quality', 'react']);
  assert.deepStrictEqual(result.counts, { P0: 0, P1: 1, P2: 0, P3: 0 });
});

// ── input validation ─────────────────────────────────────────────────────────

console.log('\nreview workflow: input validation');

test('missing or empty diff, bad tier, or malformed optional args throw', async () => {
  const bad = [
    { tier: 'small' },
    { diff: '   ', tier: 'small' },
    { diff: diffFor('a.ts') },
    { diff: diffFor('a.ts'), tier: 'medium' },
    { diff: diffFor('a.ts'), tier: 'small', changedFiles: 'a.ts' },
    { diff: diffFor('a.ts'), tier: 'small', plan: 5 },
    { diff: diffFor('a.ts'), tier: 'small', secondFamily: 'bogus' },
    { diff: diffFor('a.ts'), tier: 'small', dimensions: ['nonsense'] },
    { diff: diffFor('a.ts'), tier: 'small', dimensions: [] },
    null
  ];
  for (const args of bad) {
    await assert.rejects(() => run(args), /harness-review/, `rejects ${JSON.stringify(args)}`);
  }
});

// ── mutation ─────────────────────────────────────────────────────────────────

console.log('\nreview workflow: mutation');

function mutate(src, from, to) {
  assert.ok(src.includes(from), `mutation target present: ${from}`);
  const out = src.replace(from, to);
  assert.notStrictEqual(out, src, `mutation applied: ${from}`);
  return out;
}

test('mutant: confidence threshold >= 0 lets a 0.5 refutation clear a blocker', async () => {
  const mutant = mutate(SOURCE, 'v.confidence >= 0.8', 'v.confidence >= 0');
  assert.deepStrictEqual(await checkVerdictCases(mutant), [true, false, true, true]);
});

test('mutant: a null verdict counted as refuted lets an unverified blocker clear', async () => {
  const mutant = mutate(SOURCE, 'return !!v &&', 'return !v ||');
  assert.deepStrictEqual(await checkVerdictCases(mutant), [true, true, false, true]);
});

// ── runner ───────────────────────────────────────────────────────────────────

(async () => {
  for (const { name, fn } of queue) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${error.message}`);
      failed += 1;
    }
  }
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
