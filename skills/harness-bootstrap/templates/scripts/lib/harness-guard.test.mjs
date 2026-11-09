// harness-bootstrap commit-guard tests (generated YYYY-MM-DD). Run: node --test scripts/lib/harness-guard.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED guard, never a copy: each case
// is a throwaway repo whose pre-commit, pre-merge-commit and reference-transaction exec it, the way git runs it, with
// this project's REGISTRY, ID_PATTERN, SCOPE and MAINLINE read from the guard itself. No other hook
// of the project runs there, and no GIT_* variable or global config reaches it. The landing cases copy
// this project's scripts/review-gate.mjs and every file it imports into the throwaway repo and commit
// them there (the guard runs the mainline's committed copy), with CRITICAL in that copy rebound to
// LANDING_CRITICAL, and read the ledger directories from run-sources.
// [B] binding: GUARD, MERGE_GUARD and REF_GUARD (the guard scripts the three hooks run, relative to the
// repo root), HOOK_FILES (the hook files git runs for them), MAINLINE (the guard's expected MAINLINE: a binding
// that is itself a control has its expected literal here) and IDS (the plan's ids; empty in change
// mode, where branches carry none).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// [B] .githooks/pre-commit, .githooks/pre-merge-commit and .githooks/reference-transaction with no hook
// manager; with husky or lefthook, the one script every hook calls (.githooks/harness-guard.sh) for all three.
const GUARD = '.githooks/pre-commit';
const MERGE_GUARD = '.githooks/pre-merge-commit';
const REF_GUARD = '.githooks/reference-transaction';
// [B] The files git runs for pre-commit, pre-merge-commit and reference-transaction, each the guard
// itself or running GUARD as its first command (reference-transaction passing "$@" and its stdin on):
// GUARD, MERGE_GUARD and REF_GUARD with no hook manager; with husky,
// ['.husky/pre-commit', '.husky/pre-merge-commit', '.husky/reference-transaction'].
const HOOK_FILES = ['.githooks/pre-commit', '.githooks/pre-merge-commit', '.githooks/reference-transaction'];
// [B] The branch lands merge into, as the guard's MAINLINE must read; the throwaway repos use it too.
const MAINLINE = 'main';
// [B] Every id shape the plan uses: ID_PATTERN must take each one whole (commit-guard.md).
const IDS = [];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, GUARD), 'utf8');
const binding = (name) => new RegExp(`^${name}=(["']?)(.*?)\\1(?:\\s|$)`, 'm').exec(SOURCE)?.[2];
const REGISTRY = binding('REGISTRY');
const ID_PATTERN = binding('ID_PATTERN') ?? '';
const SCOPE = binding('SCOPE');

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(ENV, { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' });
// The landing check reads the host from the environment it inherits, and the host decides which
// ledger counts. Pinned, so the cases know: on claude only codex-run's rows certify content. The
// landing reads a host's own variables before HARNESS_HOST, so those are cleared: the suite run
// inside a Codex or ZCode session pins the same host.
const HOST = 'claude';
const COUNTS = 'codex';
for (const k of Object.keys(ENV)) if (k.startsWith('ZCODE_') || ['CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_SANDBOX'].includes(k)) delete ENV[k];
ENV.HARNESS_HOST = HOST;
delete ENV.HARNESS_LANDING;

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
};
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
const head = (d) => git(d, 'rev-parse', 'HEAD').stdout.trim();
// git with the hooks off, for a fixture step that is not the action a test checks: every ref update
// runs the reference-transaction hook, and a mainline commit runs two landing checks.
const setup = (cwd, args, env = {}) => spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: { ...ENV, ...env } });

/** The hooks directory every throwaway repo runs (absolute), each hook exec'ing the installed guard. Written once: a new executable's first run can cost a scan. */
let HOOKS = '';
function hooksDir() {
  if (HOOKS) return HOOKS;
  HOOKS = tmp('harness-guard-hooks-');
  for (const [name, target] of [['pre-commit', GUARD], ['pre-merge-commit', MERGE_GUARD], ['reference-transaction', REF_GUARD]]) {
    fs.writeFileSync(path.join(HOOKS, name), `#!/bin/sh\nexec "${path.join(ROOT, target)}" "$@"\n`, { mode: 0o755 });
  }
  return HOOKS;
}

/** A repo with one commit on main, then hooks that exec the installed guard (`gitDir`: its git directory kept there, apart from the checkout). */
function repo({ gitDir } = {}) {
  const d = tmp('harness-guard-repo-');
  const hooks = hooksDir();
  git(d, 'init', '-q', '-b', MAINLINE, ...(gitDir ? [`--separate-git-dir=${gitDir}`] : []));
  git(d, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(d, 'a.txt'), '0\n');
  git(d, 'add', 'a.txt');
  assert.equal(git(d, 'commit', '-q', '-m', 'init').status, 0, 'the first commit, before the hooks are on');
  git(d, 'config', 'core.hooksPath', hooks);
  return d;
}

/** The registry: row 0, then the held rows ([unit, branch, worktree], Worktree `main` by default), inside the active markers. */
function registry(d, rows, markers = true) {
  const held = rows.map(([unit, branch, wt = 'main'], i) => `| ${i + 1} | ${unit} | 2 implement | ${branch} | ${wt} | | 2026-10-26T00:00:00Z |`);
  const table = ['| # | Unit | Step | Branch | Worktree | Resources | Claimed (UTC) |', '|---|---|---|---|---|---|---|', '| 0 | mainline, never claimed | | | main | | |', ...held].join('\n');
  const file = path.join(d, REGISTRY);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, markers ? `<!-- harness:active -->\n${table}\n<!-- /harness:active -->\n` : `${table}\n`);
}

/** Stages one more line of `file` and commits it; `moved` says whether HEAD moved. */
function commit(d, msg, file = 'a.txt') {
  fs.appendFileSync(path.join(d, file), `${msg}\n`);
  git(d, 'add', file);
  const before = head(d);
  const r = git(d, 'commit', '-q', '-m', msg);
  return { ...r, moved: head(d) !== before };
}

/** The same commit as a fixture step, with the hooks off. */
function seed(d, msg, file = 'a.txt') {
  fs.appendFileSync(path.join(d, file), `${msg}\n`);
  git(d, 'add', file);
  const before = head(d);
  const r = setup(d, ['commit', '-q', '-m', msg]);
  return { ...r, moved: head(d) !== before };
}

const OWNER = 'harness/guard-probe';
const REFUSAL = /: REFUSE - /;
const taskBranch = (id) => `task/${id.toLowerCase()}`;

/** A linked worktree of `d` at .worktrees/probe, on a new `branch`. */
function worktree(d, branch) {
  const wt = path.join(d, '.worktrees', 'probe');
  const r = setup(d, ['worktree', 'add', '-q', wt, '-b', branch]);
  assert.equal(r.status, 0, `git worktree add: ${r.stderr}`);
  return wt;
}

test('the guard is installed as git runs it: executable, and the merge and ref hooks are the same script', () => {
  for (const f of new Set([GUARD, MERGE_GUARD, REF_GUARD])) fs.accessSync(path.join(ROOT, f), fs.constants.X_OK);
  for (const f of [MERGE_GUARD, REF_GUARD]) {
    if (f !== GUARD) assert.equal(fs.readFileSync(path.join(ROOT, f), 'utf8'), SOURCE, `${f} differs from ${GUARD}`);
  }
});

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// GUARD run so that its refusal fails the hook, nothing else on the line: `exec [sh] GUARD ["$@"]`, or
// `[sh] GUARD ["$@"] || exit` with no argument, `$?` or a non-zero literal.
const call = (n) => `(?:(?:/bin/)?sh\\s+)?(["']?)(?:\\./)?${escape(GUARD)}\\${n}(?:\\s+"\\$@")?`;
const CALLS_GUARD = new RegExp(`^(?:exec\\s+${call(1)}|${call(2)}\\s*\\|\\|\\s*exit(?:\\s+(?:\\$\\?|[1-9][0-9]*))?)$`);

// The reference-transaction hook gets its state as "$1" and its ref lines on stdin: a stub that refuses
// only when both reach it proves the hook file passes them on.
const REF_LINE = '0 1 refs/heads/probe';
const REF_STUB = `#!/bin/sh\nIFS= read -r l\n[ "$1" = prepared ] && [ "$l" = '${REF_LINE}' ] && exit 1\nexit 0\n`;

test('each hook file git runs exists and is the guard, or runs it first and passes its refusal on', () => {
  assert.equal(HOOK_FILES.length, 3, 'HOOK_FILES lists the pre-commit, the pre-merge-commit and the reference-transaction hook file');
  for (const [k, f] of HOOK_FILES.entries()) {
    const ref = k === 2;
    const file = path.join(ROOT, f);
    assert.ok(fs.existsSync(file), `${f} does not exist`);
    // husky v9 runs .husky/<hook> with sh from its .husky/_ stubs; git runs any other hook file itself
    if (!f.startsWith('.husky/')) assert.ok((fs.statSync(file).mode & 0o111) !== 0, `${f} is not executable`);
    const text = fs.readFileSync(file, 'utf8');
    if (text === SOURCE) continue;
    // by behaviour: GUARD stubbed to refuse, the hook run by plain sh (no -e) must fail
    const box = tmp('harness-guard-hookfile-');
    for (const [rel, body, mode] of [[f, text, 0o644], [GUARD, ref ? REF_STUB : '#!/bin/sh\nexit 1\n', 0o755]]) {
      fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
      fs.writeFileSync(path.join(box, rel), body, { mode });
    }
    const run = spawnSync('sh', ref ? [f, 'prepared'] : [f], { cwd: box, encoding: 'utf8', env: ENV, input: ref ? `${REF_LINE}\n` : '' });
    assert.notEqual(run.status, 0, ref
      ? `${f} exits 0 when ${GUARD} refuses a prepared transaction: it does not pass "$@" and its stdin to the guard, or not the refusal`
      : `${f} exits 0 when ${GUARD} refuses: it does not pass the refusal on`);
    const first = text.split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#'));
    assert.match(first ?? '', CALLS_GUARD, `${f} does not run ${GUARD} as its first command (it runs: ${first ?? 'nothing'})`);
  }
});

test('the bindings: REGISTRY is set, SCOPE is repo or checkout, MAINLINE is the expected one, and ID_PATTERN takes every id whole', () => {
  assert.ok(REGISTRY, `no REGISTRY= line in ${GUARD}`);
  assert.ok(['repo', 'checkout'].includes(SCOPE), `SCOPE is ${SCOPE}`);
  assert.equal(binding('MAINLINE'), MAINLINE, `${GUARD} binds MAINLINE to ${binding('MAINLINE')}, not ${MAINLINE}`);
  if (ID_PATTERN === '') assert.deepEqual(IDS, [], 'IDS lists ids but ID_PATTERN is empty');
  else assert.ok(IDS.length > 0, 'ID_PATTERN is set but IDS lists no id to hold it to');
  // the guard's own extraction: uppercase the branch, first grep -oE match
  const extract = (branch) => spawnSync('sh', ['-c', 'printf "%s\\n" "$B" | tr "[:lower:]" "[:upper:]" | grep -oE "$P" | head -n 1'], { encoding: 'utf8', env: { ...ENV, B: branch, P: ID_PATTERN } }).stdout.trim();
  for (const id of IDS) {
    const got = extract(taskBranch(id));
    assert.equal(got, id.toUpperCase(), `ID_PATTERN takes '${got}' from ${taskBranch(id)}, not ${id}`);
  }
});

test('no registry, or row 0 alone: every branch commits', () => {
  const d = repo();
  assert.equal(commit(d, 'free').moved, true, 'no registry');
  registry(d, []);
  for (const branch of [MAINLINE, OWNER]) {
    git(d, 'switch', '-q', '-C', branch);
    const r = commit(d, branch);
    assert.equal(r.moved, true, `${branch} with row 0 alone: ${r.stderr}`);
  }
});

test('a registry without its active markers is refused', () => {
  const d = repo();
  registry(d, [['probe', OWNER]], false);
  const r = commit(d, 'x');
  assert.equal(r.moved, false);
  assert.match(r.stderr, /harness:active/);
});

test('the run that holds a row commits on its branch; the mainline and any other branch are refused meanwhile', () => {
  const d = repo();
  registry(d, [['probe', OWNER]]);
  assert.equal(setup(d, ['switch', '-q', '-c', OWNER]).status, 0);
  const own = commit(d, 'owner');
  assert.equal(own.moved, true, own.stderr);
  for (const branch of [MAINLINE, 'other/branch']) {
    setup(d, ['switch', '-q', '-C', branch]);
    const r = commit(d, branch);
    assert.equal(r.moved, false, `${branch} committed while ${OWNER} holds the row`);
    assert.match(r.stderr, REFUSAL);
  }
});

test('a clean merge onto the mainline while a row is held is refused by the merge hook; released, it goes through', () => {
  const d = repo();
  setup(d, ['switch', '-q', '-c', OWNER]);
  seed(d, 'owner work', 'b.txt');
  setup(d, ['switch', '-q', MAINLINE]);
  seed(d, 'mainline moved');
  registry(d, [['probe', OWNER]]);
  const before = head(d);
  const m = git(d, 'merge', '--no-ff', '-q', '-m', 'merge', OWNER);
  assert.notEqual(m.status, 0, 'a --no-ff merge onto main while a row is held');
  assert.match(m.stderr, REFUSAL);
  assert.equal(head(d), before);
  setup(d, ['merge', '--abort']);
  fs.rmSync(path.join(d, REGISTRY));
  const r = git(d, 'merge', '--no-ff', '-q', '-m', 'merge', OWNER);
  assert.equal(r.status, 0, r.stderr);
});

test('a row that locks a linked worktree: under checkout the main checkout commits and the worktree refuses another branch; under repo the mainline is refused', () => {
  const d = repo();
  const wt = worktree(d, OWNER);
  registry(d, [['probe', OWNER, '.worktrees/probe']]);
  const own = commit(wt, 'owner');
  assert.equal(own.moved, true, `the owner in its worktree: ${own.stderr}`);
  const main = commit(d, 'mainline');
  if (SCOPE === 'checkout') {
    assert.equal(main.moved, true, `SCOPE=checkout: the main checkout was refused for a row that locks .worktrees/probe: ${main.stderr}`);
    setup(wt, ['switch', '-q', '-c', 'other/branch']);
    const other = commit(wt, 'other');
    assert.equal(other.moved, false, 'SCOPE=checkout: another branch committed in the worktree the row locks');
    assert.match(other.stderr, REFUSAL);
  } else {
    assert.equal(main.moved, false, 'SCOPE=repo: the mainline committed while a row is held');
    assert.match(main.stderr, REFUSAL);
  }
});

test('merging a branch that still holds a row is refused, naming it; once its row is released it merges', () => {
  const d = repo();
  const wt = worktree(d, OWNER);
  seed(wt, 'owner work', 'b.txt');
  seed(d, 'mainline moved');
  registry(d, [['probe', OWNER, '.worktrees/probe']]);
  const before = head(d);
  const m = git(d, 'merge', '--no-ff', '-q', '-m', 'merge', OWNER);
  assert.notEqual(m.status, 0, `SCOPE=${SCOPE}: a --no-ff merge of ${OWNER} went through while its row is held`);
  assert.ok(m.stderr.includes(`'${OWNER}', which still holds a row`), `the refusal does not name ${OWNER} as still holding a row: ${m.stderr}`);
  assert.equal(head(d), before);
  setup(d, ['merge', '--abort']);
  registry(d, []);
  const r = git(d, 'merge', '--no-ff', '-q', '-m', 'merge', OWNER);
  assert.equal(r.status, 0, `released, the merge is refused: ${r.stderr}`);
});

test("each plan id: its task branch is refused until the id's row is held, then commits", () => {
  const d = repo();
  for (const id of IDS) {
    setup(d, ['switch', '-q', '-C', taskBranch(id)]);
    registry(d, [['probe', OWNER]]);
    const r = commit(d, `${id} without its row`);
    assert.equal(r.moved, false, `${taskBranch(id)} committed with no row for ${id}`);
    assert.match(r.stderr, REFUSAL);
    registry(d, [[id, '']]);
    const own = commit(d, `${id} with its row`);
    assert.equal(own.moved, true, `${id}: ${own.stderr}`);
  }
});

test('the run that holds a row pulls its own branch back, diverged: its own row does not refuse the merge', () => {
  const d = repo();
  const origin = tmp('harness-guard-origin-');
  git(origin, 'init', '-q', '--bare');
  git(d, 'remote', 'add', 'origin', origin);
  registry(d, [['probe', OWNER]]);
  setup(d, ['switch', '-q', '-c', OWNER]);
  assert.equal(seed(d, 'owner work', 'b.txt').moved, true);
  assert.equal(setup(d, ['push', '-q', 'origin', OWNER]).status, 0, 'push');
  // the pushed branch moves on elsewhere: a copy, committed past the hooks, pushed over it
  setup(d, ['switch', '-q', '-c', 'probe/elsewhere']);
  fs.writeFileSync(path.join(d, 'c.txt'), 'elsewhere\n');
  git(d, 'add', 'c.txt');
  assert.equal(setup(d, ['commit', '-q', '--no-verify', '-m', 'elsewhere']).status, 0);
  assert.equal(setup(d, ['push', '-q', 'origin', `probe/elsewhere:${OWNER}`]).status, 0, 'push over it');
  setup(d, ['switch', '-q', OWNER]);
  assert.equal(seed(d, 'owner again', 'b.txt').moved, true);
  const pull = git(d, 'pull', '-q', '--no-rebase', '--no-edit', 'origin', OWNER);
  assert.equal(pull.status, 0, `the owning run's pull of its own branch was refused: ${pull.stderr}`);
  assert.ok(fs.existsSync(path.join(d, 'c.txt')), 'the pull merged');
});

test("each plan id: a branch carrying the id merges into the id's task branch while its row is held", () => {
  const d = repo();
  for (const id of IDS) {
    setup(d, ['switch', '-q', '-C', taskBranch(id), MAINLINE]);
    registry(d, [[id, '']]);
    assert.equal(seed(d, `${id} work`, 'b.txt').moved, true, `${id}: the owning run's commit`);
    const sub = `${taskBranch(id)}-review`;
    setup(d, ['switch', '-q', '-c', sub]);
    const r = commit(d, `${id} review`, 'c.txt');
    assert.equal(r.moved, true, `${sub} carries ${id}, whose row is held: ${r.stderr}`);
    setup(d, ['switch', '-q', taskBranch(id)]);
    const m = git(d, 'merge', '--no-ff', '-q', '-m', `merge ${sub}`, sub);
    assert.equal(m.status, 0, `the owning run's merge of ${sub} was refused: ${m.stderr}`);
  }
});

// ---- the landing check: a merge into the mainline carries no critical edit its last review did not read

const GATE = 'scripts/review-gate.mjs';
const LANDING_CRITICAL = '[/^src\\/money\\//]';
const SOURCES = fs.readFileSync(path.join(ROOT, 'scripts/lib/run-sources.mjs'), 'utf8');
const ledgerDir = (name) => new RegExp(`^export const ${name} = (["'])(.*?)\\1;`, 'm').exec(SOURCES)?.[2];
const LEDGERS = { codex: ledgerDir('LEDGER_DIR'), claude: ledgerDir('CLAUDE_LEDGER_DIR') };
const LANDS = 'land/money';

/** Copies `rel` and every file it imports by a relative path from ROOT into `d`, once each. */
function copyClosure(d, rel, done = new Set()) {
  if (done.has(rel)) return;
  done.add(rel);
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
  fs.writeFileSync(path.join(d, rel), text);
  for (const [, spec] of text.matchAll(/\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g)) copyClosure(d, path.posix.join(path.posix.dirname(rel), spec), done);
}

const MONEY = 'src/money/x.js';
const OWNER_ENV = { HARNESS_LANDING: 'owner' };
const lines = (...l) => `${l.join('\n')}\n`;

/**
 * A repo with the landing check installed (CRITICAL = LANDING_CRITICAL) and committed on the
 * mainline, with `seed` ({ path: text }) committed beside it, row 0 alone. `commit: false` leaves the
 * copy in the working tree only, as an install whose mainline has no landing check yet. `gitDir`
 * keeps the git directory apart from the checkout (`git init --separate-git-dir`).
 */
function landingRepo({ seed = {}, commit: install = true, gitDir } = {}) {
  const d = repo({ gitDir });
  copyClosure(d, GATE);
  const core = path.join(d, 'scripts/lib/review-gate-core.mjs');
  const text = fs.readFileSync(core, 'utf8');
  const bound = text.replace(/^export const CRITICAL = \[[\s\S]*?\];/m, `export const CRITICAL = ${LANDING_CRITICAL};`);
  assert.notEqual(bound, text, 'no `export const CRITICAL = [...];` line in review-gate-core.mjs to rebind');
  fs.writeFileSync(core, bound);
  for (const [rel, body] of Object.entries(seed)) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    fs.writeFileSync(path.join(d, rel), body);
  }
  if (install) {
    git(d, 'add', '--', 'scripts', ...Object.keys(seed));
    const r = setup(d, ['commit', '-q', '-m', 'install the landing check']);
    assert.equal(r.status, 0, `commit the landing check: ${r.stderr}`);
  }
  registry(d, []);
  return d;
}

const run = (d, args, env = {}) => spawnSync('git', args, { cwd: d, encoding: 'utf8', env: { ...ENV, ...env } });

/** Writes `rel` with `text` and commits it on the current branch, a fixture step with the hooks off (`env`: extra variables for the commit). */
function commitFile(d, rel, text, env = {}) {
  fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
  fs.writeFileSync(path.join(d, rel), text);
  git(d, 'add', rel);
  const r = setup(d, ['commit', '-q', '-m', `edit ${rel}`], env);
  assert.equal(r.status, 0, `commit ${rel}: ${r.stderr}`);
}

/** One ledger row of a review that read `baseTree -> tree`, in the codex or claude ledger. */
function ledgerRow(d, tree, baseTree, { which = COUNTS, branch = LANDS, kind = 'adversarial' } = {}) {
  assert.ok(LEDGERS[which], `no ${which} ledger directory bound in scripts/lib/run-sources.mjs`);
  const file = path.join(d, LEDGERS[which], 'ledger.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ kind, outcome: 'ok', branch, tree, baseTree, at: new Date().toISOString() })}\n`);
}

const treeOf = (d, rev) => git(d, 'rev-parse', `${rev}^{tree}`).stdout.trim();
/** A ledger row of a review of `branch` as it stands: from its merge base with the mainline to its tip. */
function reviewed(d, branch = LANDS, opts = {}) {
  const base = git(d, 'merge-base', MAINLINE, branch).stdout.trim();
  ledgerRow(d, treeOf(d, branch), treeOf(d, base), opts);
}
const merge = (d, branch, env = {}) => run(d, ['merge', '--no-ff', '-q', '-m', `merge ${branch}`, branch], env);

/** A landing repo whose branch LANDS changed `rel`, back on the mainline. */
function landing(rel = MONEY, opts = {}) {
  const d = landingRepo(opts);
  setup(d, ['switch', '-q', '-c', LANDS]);
  commitFile(d, rel, 'export const x = 1;\n');
  setup(d, ['switch', '-q', MAINLINE]);
  return d;
}

// The refusal quotes the landing line and never names the owner's override: an agent that reads it
// must not learn the way past the check from it.
function assertLandingRefused(d, m, verdict) {
  assert.notEqual(m.status, 0, `a merge of ${LANDS} into ${MAINLINE} went through: ${m.stderr}`);
  assert.match(m.stderr, REFUSAL);
  assert.ok(m.stderr.includes('the landing check refused this merge: Landing: '), `the refusal does not quote the landing line: ${m.stderr}`);
  assert.ok(m.stderr.includes(verdict), `the refusal is not ${verdict}: ${m.stderr}`);
  assert.ok(!m.stderr.includes('HARNESS_LANDING'), `the refusal names the owner's override: ${m.stderr}`);
}

test('landing: a merge into the mainline of a branch that changed a critical path with no recorded review is refused', () => {
  const d = landing();
  const before = head(d);
  const m = merge(d, LANDS);
  assertLandingRefused(d, m, 'NONE');
  assert.equal(head(d), before);
});

test('landing: a cross-family review row that read the branch lets the merge through', () => {
  const d = landing();
  reviewed(d);
  const m = merge(d, LANDS);
  assert.equal(m.status, 0, `refused with a review of the branch: ${m.stderr}`);
});

test('landing: a critical edit after the review is refused for a re-review', () => {
  const d = landing();
  setup(d, ['switch', '-q', LANDS]);
  reviewed(d, LANDS, { kind: 'review' });
  commitFile(d, MONEY, 'export const x = 2;\n');
  setup(d, ['switch', '-q', MAINLINE]);
  const before = head(d);
  const m = merge(d, LANDS);
  assertLandingRefused(d, m, 'RE-REVIEW');
  assert.equal(head(d), before);
});

test(`landing: on host ${HOST} a review in its own family's ledger alone is not enough`, () => {
  const own = Object.keys(LEDGERS).find((k) => k !== COUNTS);
  const d = landing();
  reviewed(d, LANDS, { which: own });
  const before = head(d);
  const m = merge(d, LANDS);
  assertLandingRefused(d, m, 'NONE');
  assert.equal(head(d), before);
});

test('landing: HARNESS_LANDING=owner merges past the check', () => {
  const d = landing();
  const m = merge(d, LANDS, OWNER_ENV);
  assert.equal(m.status, 0, `the owner's merge was refused: ${m.stderr}`);
});

test('landing: a branch with no critical path merges with no review recorded', () => {
  const d = landing('src/cold/y.js');
  const m = merge(d, LANDS);
  assert.equal(m.status, 0, `a cold branch was refused: ${m.stderr}`);
});

test('landing: the working-tree copy of the review gate is never what runs; a mainline without a committed one skips the check', () => {
  const d = landing();
  fs.rmSync(path.join(d, GATE));
  assertLandingRefused(d, merge(d, LANDS), 'NONE');
  setup(d, ['merge', '--abort']);
  const bare = landing(MONEY, { commit: false });
  const m = merge(bare, LANDS);
  assert.equal(m.status, 0, `refused with no committed ${GATE}: ${m.stderr}`);
});

test('landing: a conflicted merge concluded by a commit is checked by its result the same way', () => {
  const d = landingRepo();
  setup(d, ['switch', '-q', '-c', LANDS]);
  commitFile(d, MONEY, 'export const x = 1;\n');
  commitFile(d, 'a.txt', 'branch\n');
  setup(d, ['switch', '-q', MAINLINE]);
  commitFile(d, 'a.txt', 'mainline\n');
  const m = setup(d, ['merge', '--no-ff', '-q', '-m', `merge ${LANDS}`, LANDS]);
  assert.notEqual(m.status, 0, 'the merge was meant to conflict on a.txt');
  assert.ok(fs.existsSync(path.join(d, '.git', 'MERGE_HEAD')), `no MERGE_HEAD after the conflict: ${m.stderr}`);
  fs.writeFileSync(path.join(d, 'a.txt'), 'resolved\n');
  git(d, 'add', 'a.txt');
  const before = head(d);
  const c = git(d, 'commit', '-q', '--no-edit');
  assertLandingRefused(d, c, 'NONE');
  assert.equal(head(d), before);
  reviewed(d);
  const ok = git(d, 'commit', '-q', '--no-edit');
  assert.equal(ok.status, 0, `refused with a review of the branch: ${ok.stderr}`);
});

test('landing: a clean auto-merge of a reviewed branch, where the mainline changed other lines of the same critical file, is refused', () => {
  const d = landingRepo({ seed: { [MONEY]: lines('a', 'b', 'c', 'd', 'e', 'f', 'g') } });
  setup(d, ['switch', '-q', '-c', LANDS]);
  commitFile(d, MONEY, lines('A', 'b', 'c', 'd', 'e', 'f', 'g'));
  reviewed(d);
  setup(d, ['switch', '-q', MAINLINE]);
  commitFile(d, MONEY, lines('a', 'b', 'c', 'd', 'e', 'f', 'G'), OWNER_ENV);
  const before = head(d);
  const m = merge(d, LANDS);
  assertLandingRefused(d, m, 'RE-REVIEW');
  assert.equal(head(d), before);
  assert.equal(fs.readFileSync(path.join(d, MONEY), 'utf8'), lines('A', 'b', 'c', 'd', 'e', 'f', 'G'), 'the merge was meant to be clean');
});

test('landing: a conflict resolved to new critical content and concluded by git commit is refused', () => {
  const d = landingRepo({ seed: { [MONEY]: lines('a', 'b') } });
  setup(d, ['switch', '-q', '-c', LANDS]);
  commitFile(d, MONEY, lines('branch', 'b'));
  reviewed(d);
  setup(d, ['switch', '-q', MAINLINE]);
  commitFile(d, MONEY, lines('mainline', 'b'), OWNER_ENV);
  assert.notEqual(setup(d, ['merge', '--no-ff', '-q', '-m', `merge ${LANDS}`, LANDS]).status, 0, `the merge was meant to conflict on ${MONEY}`);
  fs.writeFileSync(path.join(d, MONEY), lines('neither', 'b'));
  git(d, 'add', MONEY);
  const before = head(d);
  const c = git(d, 'commit', '-q', '--no-edit');
  assertLandingRefused(d, c, 'RE-REVIEW');
  assert.equal(head(d), before);
});

test('landing: a squash merge of an unreviewed critical edit, concluded by git commit on the mainline, is refused', () => {
  const d = landing();
  const s = setup(d, ['merge', '--squash', '-q', LANDS]);
  assert.equal(s.status, 0, `git merge --squash: ${s.stderr}`);
  const before = head(d);
  const c = git(d, 'commit', '-q', '-m', 'squash');
  assertLandingRefused(d, c, 'NONE');
  assert.equal(head(d), before);
});

test('landing: a merge by SHA, and a merge of a tag, of an unreviewed critical edit are refused', () => {
  const d = landing();
  const before = head(d);
  const sha = git(d, 'rev-parse', LANDS).stdout.trim();
  assertLandingRefused(d, merge(d, sha), 'NONE');
  assert.equal(head(d), before);
  setup(d, ['merge', '--abort']);
  setup(d, ['tag', 'landing-tag', LANDS]);
  assertLandingRefused(d, merge(d, 'landing-tag'), 'NONE');
  assert.equal(head(d), before);
});

test('landing: a merge that spoofs a pull in GIT_REFLOG_ACTION is still checked', () => {
  const d = landing();
  const before = head(d);
  assertLandingRefused(d, merge(d, LANDS, { GIT_REFLOG_ACTION: 'pull x' }), 'NONE');
  assert.equal(head(d), before);
});

test('landing: a branch that rebinds CRITICAL = [] (and GUARDS = []) in its own review-gate-core.mjs is refused: the mainline copy runs and sees a guard change', () => {
  const d = landing();
  setup(d, ['switch', '-q', LANDS]);
  const core = 'scripts/lib/review-gate-core.mjs';
  const text = fs.readFileSync(path.join(d, core), 'utf8');
  const open = text
    .replace(/^export const CRITICAL = \[[\s\S]*?\];/m, 'export const CRITICAL = [];')
    .replace(/^export const GUARDS = \[[\s\S]*?\];/m, 'export const GUARDS = [];');
  assert.notEqual(open, text, `no CRITICAL or GUARDS binding in ${core} to rebind`);
  commitFile(d, core, open);
  setup(d, ['switch', '-q', MAINLINE]);
  const before = head(d);
  const m = merge(d, LANDS);
  assertLandingRefused(d, m, 'NONE');
  assert.ok(m.stderr.includes('a guard, a gate or a reviewed block changed'), `the refusal does not name the guard change: ${m.stderr}`);
  assert.equal(head(d), before);
});

/**
 * A landing repo with a bare origin whose mainline holds an unreviewed critical edit (written from
 * another clone, where no hook runs), fetched, and a local mainline that diverged from it, editing
 * a.txt to `local`. The remote's copy of a.txt is `remote`, so a merge of the two conflicts only when
 * `conflict` is set; otherwise the remote leaves a.txt alone.
 */
function remoteLanding({ conflict = false } = {}) {
  const d = landingRepo();
  const origin = tmp('harness-guard-origin-');
  git(origin, 'init', '-q', '--bare', '-b', MAINLINE);
  git(d, 'remote', 'add', 'origin', origin);
  assert.equal(setup(d, ['push', '-q', 'origin', MAINLINE]).status, 0, 'push the mainline');
  const other = path.join(tmp('harness-guard-clone-'), 'c');
  assert.equal(git(path.dirname(other), 'clone', '-q', origin, other).status, 0, 'clone');
  fs.mkdirSync(path.join(other, path.dirname(MONEY)), { recursive: true });
  fs.writeFileSync(path.join(other, MONEY), 'export const x = 9;\n');
  if (conflict) fs.writeFileSync(path.join(other, 'a.txt'), 'remote\n');
  git(other, 'add', '-A');
  assert.equal(git(other, 'commit', '-q', '-m', 'remote edit').status, 0, 'the remote edit');
  assert.equal(git(other, 'push', '-q', 'origin', MAINLINE).status, 0, 'push the remote edit');
  commitFile(d, 'a.txt', 'local\n');
  assert.equal(setup(d, ['fetch', '-q', 'origin']).status, 0, 'fetch');
  return d;
}

test('landing: a clean merge of the remote mainline into a diverged local mainline trusts what the remote holds', () => {
  const d = remoteLanding();
  const m = merge(d, `origin/${MAINLINE}`);
  assert.equal(m.status, 0, `the merge of origin/${MAINLINE} was refused: ${m.stderr}`);
  assert.ok(fs.existsSync(path.join(d, MONEY)), 'the merge landed');
  const p = remoteLanding();
  const pull = run(p, ['pull', '-q', '--no-rebase', '--no-edit', 'origin', MAINLINE]);
  assert.equal(pull.status, 0, `the pull of origin ${MAINLINE} was refused: ${pull.stderr}`);
});

test('landing: a conflicted pull of the remote mainline, concluded by git commit, trusts what the remote holds', () => {
  const d = remoteLanding({ conflict: true });
  assert.notEqual(setup(d, ['pull', '-q', '--no-rebase', '--no-edit', 'origin', MAINLINE]).status, 0, 'the pull was meant to conflict on a.txt');
  fs.writeFileSync(path.join(d, 'a.txt'), 'resolved\n');
  git(d, 'add', 'a.txt');
  const c = git(d, 'commit', '-q', '--no-edit');
  assert.equal(c.status, 0, `the commit that concludes the pull was refused: ${c.stderr}`);
});

/** A bin directory that holds the tools git and the guard run, and no node; `git` runs a command with it as PATH. */
function noNode() {
  const bin = tmp('harness-guard-bin-');
  for (const tool of ['git', 'sh', 'awk', 'grep', 'sed', 'tr', 'head', 'basename', 'mktemp', 'rm', 'tar', 'cat']) {
    const at = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8', env: ENV }).stdout.trim();
    if (at.startsWith('/')) fs.symlinkSync(at, path.join(bin, tool));
  }
  const env = { ...ENV, PATH: bin };
  assert.notEqual(spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8', env }).status, 0, 'node is still on the test PATH');
  return { bin, git: (d, args) => spawnSync(path.join(bin, 'git'), args, { cwd: d, encoding: 'utf8', env }) };
}

test('landing: with no node on PATH the merge is refused, not let through', () => {
  const d = landing();
  const { bin } = noNode();
  const env = { PATH: bin };
  const before = head(d);
  const m = spawnSync(path.join(bin, 'git'), ['merge', '--no-ff', '-q', '-m', 'merge', LANDS], { cwd: d, encoding: 'utf8', env: { ...ENV, ...env } });
  assert.notEqual(m.status, 0, `merged with no node on PATH: ${m.stderr}`);
  assert.match(m.stderr, REFUSAL);
  assert.ok(m.stderr.includes('needs node, which is not on PATH'), `the refusal does not name the missing node: ${m.stderr}`);
  assert.ok(!m.stderr.includes('HARNESS_LANDING'), `the refusal names the owner's override: ${m.stderr}`);
  assert.equal(head(d), before);
});

// ---- every move of the mainline ref: the reference-transaction hook runs the same landing check

const MAIN_REF = `refs/heads/${MAINLINE}`;
const tip = (d, ref = MAIN_REF) => git(d, 'rev-parse', '-q', '--verify', ref).stdout.trim();

// A refused move: git aborts the transaction, the mainline keeps `before` ('' for a ref that was
// absent), and the refusal names the move and never the owner's override.
function assertMoveRefused(d, r, before) {
  assert.notEqual(r.status, 0, `the mainline moved to unreviewed critical content: ${r.stderr}`);
  assert.match(r.stderr, REFUSAL);
  assert.ok(r.stderr.includes(`move of ${MAINLINE}`), `the refusal does not name the move of ${MAINLINE}: ${r.stderr}`);
  assert.ok(!r.stderr.includes('HARNESS_LANDING'), `the refusal names the owner's override: ${r.stderr}`);
  assert.equal(tip(d), before, `${MAINLINE} moved`);
}

test('move: a fast-forward merge of an unreviewed critical edit onto the mainline is refused, and the mainline does not move', () => {
  const d = landing();
  assertMoveRefused(d, run(d, ['merge', '--ff-only', '-q', LANDS]), tip(d));
});

test('move: a fast-forward pull from the repository itself is refused', () => {
  const d = landing();
  assertMoveRefused(d, run(d, ['pull', '-q', '--ff-only', d, LANDS]), tip(d));
});

test('move: update-ref of the mainline to the edit is refused', () => {
  const d = landing();
  assertMoveRefused(d, run(d, ['update-ref', MAIN_REF, LANDS]), tip(d));
});

test('move: reset --hard of the mainline to the edit is refused', () => {
  const d = landing();
  assertMoveRefused(d, run(d, ['reset', '-q', '--hard', LANDS]), tip(d));
});

test('move: branch -f of the mainline from the branch checked out is refused', () => {
  const d = landing();
  setup(d, ['switch', '-q', LANDS]);
  assertMoveRefused(d, run(d, ['branch', '-f', MAINLINE, LANDS]), tip(d));
});

/** A bare origin cloned from `d` whose mainline holds `d`'s LANDS tip (moved there, where no hook runs), as d's origin. */
function originAt(d) {
  const origin = path.join(tmp('harness-guard-origin-'), 'o.git');
  assert.equal(git(path.dirname(origin), 'clone', '-q', '--bare', d, origin).status, 0, 'clone --bare');
  assert.equal(git(origin, 'update-ref', MAIN_REF, `refs/heads/${LANDS}`).status, 0, 'the origin mainline at the edit');
  git(d, 'remote', 'add', 'origin', origin);
  return tip(d, LANDS);
}

test('move: a fast-forward to what the remote mainline holds passes, fetched first or fetched into the mainline', () => {
  const d = landing();
  const at = originAt(d);
  const f = setup(d, ['fetch', '-q', 'origin']);
  assert.equal(f.status, 0, `git fetch origin: ${f.stderr}`);
  const m = run(d, ['merge', '--ff-only', '-q', `origin/${MAINLINE}`]);
  assert.equal(m.status, 0, `the fast-forward to origin/${MAINLINE} was refused: ${m.stderr}`);
  assert.equal(tip(d), at);
  // one transaction moves the mainline and its remote-tracking ref: the remote line is trusted
  const e = landing();
  const there = originAt(e);
  setup(e, ['switch', '-q', LANDS]);
  const g = run(e, ['fetch', '-q', 'origin', `${MAINLINE}:${MAINLINE}`]);
  assert.equal(g.status, 0, `git fetch origin ${MAINLINE}:${MAINLINE} was refused: ${g.stderr}`);
  assert.equal(tip(e), there);
});

test('move: a rewind of the mainline to content it held passes', () => {
  const d = landing();
  const back = tip(d, `${MAINLINE}~1`);
  const r = run(d, ['reset', '-q', '--hard', 'HEAD~1']);
  assert.equal(r.status, 0, `the rewind was refused: ${r.stderr}`);
  assert.equal(tip(d), back);
});

test('replace: a replacement that makes the edit read as the mainline is no rewind; update-ref to it is refused', () => {
  const d = landing();
  const before = tip(d);
  assert.equal(setup(d, ['replace', tip(d, LANDS), before]).status, 0, 'git replace');
  assertMoveRefused(d, run(d, ['update-ref', MAIN_REF, LANDS]), before);
});

test('graft: a graft that makes the edit an ancestor of the mainline is no rewind; update-ref to it is refused', () => {
  const d = landing();
  const before = tip(d);
  fs.mkdirSync(path.join(d, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(d, '.git', 'info', 'grafts'), `${before} ${tip(d, LANDS)}\n`);
  assertMoveRefused(d, run(d, ['update-ref', MAIN_REF, LANDS]), before);
});

test('replace, commit: a replacement of the staged tree by the mainline\'s does not hide the unread edit from the commit', () => {
  const d = landingRepo();
  fs.mkdirSync(path.join(d, path.dirname(MONEY)), { recursive: true });
  fs.writeFileSync(path.join(d, MONEY), 'export const x = 1;\n');
  git(d, 'add', MONEY);
  const staged = setup(d, ['write-tree']).stdout.trim();
  assert.equal(setup(d, ['replace', staged, `${MAINLINE}^{tree}`]).status, 0, 'git replace of the staged tree');
  const before = head(d);
  const c = git(d, 'commit', '-q', '-m', 'unread');
  assert.notEqual(c.status, 0, `committed the unread edit behind a replacement: ${c.stderr}`);
  assert.match(c.stderr, REFUSAL);
  assert.ok(c.stderr.includes('the landing check refused this '), `not refused by the landing check: ${c.stderr}`);
  assert.equal(head(d), before);
});

test('move: a cross-family review row that read the edit lets the fast-forward through', () => {
  const d = landing();
  reviewed(d);
  const r = run(d, ['merge', '--ff-only', '-q', LANDS]);
  assert.equal(r.status, 0, `refused with a review of the branch: ${r.stderr}`);
  assert.equal(tip(d), tip(d, LANDS));
});

test('move: HARNESS_LANDING=owner fast-forwards past the check', () => {
  const d = landing();
  const r = run(d, ['merge', '--ff-only', '-q', LANDS], OWNER_ENV);
  assert.equal(r.status, 0, `the owner's fast-forward was refused: ${r.stderr}`);
  assert.equal(tip(d), tip(d, LANDS));
});

test('move: with no node on PATH a commit on a branch passes (no mainline line, nothing spawned) and the fast-forward is refused', () => {
  const d = landing();
  const nn = noNode();
  setup(d, ['switch', '-q', LANDS]);
  fs.writeFileSync(path.join(d, 'b.txt'), 'branch\n');
  git(d, 'add', 'b.txt');
  const c = nn.git(d, ['commit', '-q', '-m', 'branch work']);
  assert.equal(c.status, 0, `a commit on ${LANDS} with no node: ${c.stderr}`);
  setup(d, ['switch', '-q', MAINLINE]);
  const before = tip(d);
  const m = nn.git(d, ['merge', '--ff-only', '-q', LANDS]);
  assert.notEqual(m.status, 0, `fast-forwarded with no node on PATH: ${m.stderr}`);
  assert.ok(m.stderr.includes('needs node, which is not on PATH'), `the refusal does not name the missing node: ${m.stderr}`);
  assert.ok(!m.stderr.includes('HARNESS_LANDING'), `the refusal names the owner's override: ${m.stderr}`);
  assert.equal(tip(d), before);
});

test('move: deleting the mainline passes; creating it again at the edit is checked against the remote mainline', () => {
  const d = landing();
  assert.equal(setup(d, ['update-ref', `refs/remotes/origin/${MAINLINE}`, MAIN_REF]).status, 0, 'a remote mainline at the old tip');
  setup(d, ['switch', '-q', LANDS]);
  const del = run(d, ['update-ref', '-d', MAIN_REF]);
  assert.equal(del.status, 0, `the deletion was refused: ${del.stderr}`);
  assert.equal(tip(d), '');
  assertMoveRefused(d, run(d, ['update-ref', MAIN_REF, LANDS]), '');
});

// ---- a move made from outside the working tree: inside .git, or with --git-dir or GIT_DIR from another
// directory, the guard cannot read the working tree, so it refuses (the hooks path is absolute, so git runs it)

const OUTSIDE = 'outside the working tree';
/** A refused move that names git running outside the working tree. */
function assertOutsideRefused(d, r, before) {
  assertMoveRefused(d, r, before);
  assert.ok(r.stderr.includes(OUTSIDE), `the refusal does not say git ran ${OUTSIDE}: ${r.stderr}`);
}

test('outside: update-ref of the mainline run from inside .git is refused', () => {
  const d = landing();
  assertOutsideRefused(d, run(path.join(d, '.git'), ['update-ref', MAIN_REF, LANDS]), tip(d));
});

test('outside: update-ref of the mainline run from under .git is refused', () => {
  const d = landing();
  assertOutsideRefused(d, run(path.join(d, '.git', 'refs'), ['update-ref', MAIN_REF, LANDS]), tip(d));
});

test('outside: update-ref with GIT_DIR from another directory is refused', () => {
  const d = landing();
  assertOutsideRefused(d, run(tmp('harness-guard-elsewhere-'), ['update-ref', MAIN_REF, LANDS], { GIT_DIR: path.join(d, '.git') }), tip(d));
});

test('outside: update-ref with --git-dir from another directory is refused', () => {
  const d = landing();
  assertOutsideRefused(d, run(tmp('harness-guard-elsewhere-'), [`--git-dir=${path.join(d, '.git')}`, 'update-ref', MAIN_REF, LANDS]), tip(d));
});

test('outside: -c core.bare=true from inside .git is still refused', () => {
  const d = landing();
  assertOutsideRefused(d, run(path.join(d, '.git'), ['-c', 'core.bare=true', 'update-ref', MAIN_REF, LANDS]), tip(d));
});

test('outside: a bare clone, with the same absolute hooks path, moves its mainline', () => {
  const d = landing();
  const bare = path.join(tmp('harness-guard-bare-'), 'b.git');
  assert.equal(setup(path.dirname(bare), ['clone', '-q', '--bare', d, bare]).status, 0, 'clone --bare');
  assert.equal(git(bare, 'config', 'core.hooksPath', hooksDir()).status, 0);
  const at = tip(d, LANDS);
  const r = run(bare, ['update-ref', MAIN_REF, at]);
  assert.equal(r.status, 0, `the bare repository's move was refused: ${r.stderr}`);
  assert.equal(tip(bare), at);
});

/** A landing repo whose git directory is kept apart from the checkout; returns both. */
function separate() {
  const gd = path.join(tmp('harness-guard-gitdir-'), 'g');
  return { d: landing(MONEY, { gitDir: gd }), gd };
}

test('outside: a separate git directory is no bare repository; update-ref of the mainline run from it is refused', () => {
  const { d, gd } = separate();
  const before = tip(d);
  const r = run(d, ['update-ref', MAIN_REF, LANDS]);
  assertMoveRefused(d, r, before);
  assert.ok(!r.stderr.includes(OUTSIDE), `from the working tree, refused as ${OUTSIDE}: ${r.stderr}`);
  assertOutsideRefused(d, run(gd, ['update-ref', MAIN_REF, LANDS]), before);
});

test('outside: a separate git directory with core.bare set in its config is still refused', () => {
  const { d, gd } = separate();
  assert.equal(setup(gd, ['config', 'core.bare', 'true']).status, 0);
  assertOutsideRefused(d, run(gd, ['update-ref', MAIN_REF, LANDS]), tip(d));
});

test('outside: a separate git directory with -c core.bare=true on the move is still refused', () => {
  const { d, gd } = separate();
  assertOutsideRefused(d, run(gd, ['-c', 'core.bare=true', 'update-ref', MAIN_REF, LANDS]), tip(d));
});

test('outside: a bare clone with a linked worktree, run from the bare directory, is refused', () => {
  const d = landing();
  const bare = path.join(tmp('harness-guard-bare-'), 'b.git');
  assert.equal(setup(path.dirname(bare), ['clone', '-q', '--bare', d, bare]).status, 0, 'clone --bare');
  assert.equal(git(bare, 'config', 'core.hooksPath', hooksDir()).status, 0);
  const wt = path.join(tmp('harness-guard-wt-'), 'w');
  const w = setup(bare, ['worktree', 'add', '-q', wt, '-b', 'side']);
  assert.equal(w.status, 0, `git worktree add: ${w.stderr}`);
  assertOutsideRefused(bare, run(bare, ['update-ref', MAIN_REF, tip(d, LANDS)]), tip(bare));
});

test('outside: GIT_DIR with GIT_WORK_TREE from another directory reaches the landing check, which refuses the move', () => {
  const d = landing();
  const r = run(tmp('harness-guard-elsewhere-'), ['update-ref', MAIN_REF, LANDS], { GIT_DIR: path.join(d, '.git'), GIT_WORK_TREE: d });
  assertMoveRefused(d, r, tip(d));
  assert.ok(r.stderr.includes(`the landing check refused this move of ${MAINLINE}: Landing: `), `not refused by the landing check: ${r.stderr}`);
  assert.ok(!r.stderr.includes(OUTSIDE), `refused as ${OUTSIDE}: ${r.stderr}`);
});

test('outside: a fetch of the remote mainline into the mainline from a linked worktree passes', () => {
  const d = landing();
  const there = originAt(d);
  setup(d, ['switch', '-q', LANDS]);
  const wt = worktree(d, 'probe/third');
  const r = run(wt, ['fetch', '-q', 'origin', `${MAINLINE}:${MAINLINE}`]);
  assert.equal(r.status, 0, `git fetch origin ${MAINLINE}:${MAINLINE} from a linked worktree was refused: ${r.stderr}`);
  assert.equal(tip(d), there);
});

test('landing: NODE_OPTIONS cannot run code before the gate; the unread edit committed on the mainline is refused', () => {
  const d = landingRepo();
  fs.mkdirSync(path.join(d, path.dirname(MONEY)), { recursive: true });
  fs.writeFileSync(path.join(d, MONEY), 'export const x = 1;\n');
  git(d, 'add', MONEY);
  const before = head(d);
  const c = run(d, ['commit', '-q', '-m', 'unread'], { NODE_OPTIONS: '--import=data:text/javascript,process.exit(0)' });
  assertLandingRefused(d, c, 'NONE');
  assert.equal(head(d), before);
});

test('landing: a node that exits 0 and prints no PASS line is refused', () => {
  const d = landingRepo();
  const shim = tmp('harness-guard-shim-');
  fs.writeFileSync(path.join(shim, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.mkdirSync(path.join(d, path.dirname(MONEY)), { recursive: true });
  fs.writeFileSync(path.join(d, MONEY), 'export const x = 1;\n');
  git(d, 'add', MONEY);
  const before = head(d);
  const c = run(d, ['commit', '-q', '-m', 'unread'], { PATH: `${shim}${path.delimiter}${ENV.PATH}` });
  assert.notEqual(c.status, 0, `committed past a node that printed nothing: ${c.stderr}`);
  assert.match(c.stderr, REFUSAL);
  assert.ok(c.stderr.includes('printed no PASS line'), `the refusal does not say no PASS line was printed: ${c.stderr}`);
  assert.equal(head(d), before);
});
