// harness-bootstrap run-gates tests (generated YYYY-MM-DD). Run: node --test scripts/lib/run-gates.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED scripts/run-gates.sh: its gate
// block is read by bash itself, every count regex runs through grep -E (the script's own engine),
// and the runner runs as a copy in a throwaway repo with its gate block replaced by stubs, so no
// project gate runs here.
// [B] binding: UNCOUNTED, the counted gates whose count is not a test runner's (run-counted does
// not apply to them).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// [B] Counted gates that count something other than tests.
const UNCOUNTED = [];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-gates.sh');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');
const BLOCK = /# >>> harness:gates[\s\S]*?# <<< harness:gates/;

// HARNESS_ROLE is dropped too: under a wrapped run (HARNESS_ROLE=executor) every FULL run here would be refused.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('RUN_GATES_') && k !== 'HARNESS_ROLE'));
Object.assign(ENV, { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' });

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
};

/** The bound gates in order: the block run by bash with gate and gate_counted only printing. */
function gates() {
  const block = BLOCK.exec(SOURCE)?.[0];
  assert.ok(block, 'no harness:gates block in scripts/run-gates.sh');
  const prelude = "gate() { printf 'gate\\0%s\\0%s\\0\\0%s\\0' \"$@\"; }\ngate_counted() { printf 'gate_counted\\0%s\\0%s\\0%s\\0%s\\0' \"$@\"; }\n";
  const r = spawnSync('bash', ['-c', prelude + block], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  const f = r.stdout.split('\0');
  const out = [];
  for (let i = 0; i + 4 < f.length; i += 5) out.push({ kind: f[i], name: f[i + 1], mode: f[i + 2], rx: f[i + 3], cmd: f[i + 4] });
  return out;
}

/** Whether `grep -E` matches `text`, as the runner checks a count line. */
function grepMatches(rx, text) {
  const r = spawnSync('grep', ['-Eq', '--', rx], { input: text, encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1, `grep: ${r.stderr}`);
  return r.status === 0;
}

/** A throwaway repo with one commit (a.txt). */
function newRepo() {
  const repo = tmp('run-gates-repo-');
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8', env: ENV });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), '0\n');
  git('add', 'a.txt');
  assert.equal(git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init').status, 0);
  return repo;
}

/**
 * A copy of the runner, its gate block replaced by `lines`, run in a repo (a new one unless `repo`
 * is given) with a cache dir (a new one unless `cache` is given), so two runs can share both. The
 * docs-only pattern, KEY_EXTRA and admission are off unless `env` sets them; `scoped` replaces
 * SCOPED_PATHS in the copy; `admit` replaces the ADMIT line in the copy (and leaves admission on);
 * `out` ([stdout file, stderr file]) starts the run in the background and returns its child. No
 * bound value is read. Returns the spawn result with `repo`, `cache` and `lines`.
 */
function runCopy(lines, args, opts = {}) {
  const o = typeof opts === 'function' ? { prepare: opts } : opts;
  const repo = o.repo ?? newRepo();
  const cache = o.cache ?? tmp('run-gates-cache-');
  if (o.prepare) o.prepare(repo);
  const copy = path.join(tmp('run-gates-copy-'), 'run-gates.sh');
  // A replacer function, not a string: a gate line may hold `$'`, a replacement pattern.
  let text = SOURCE.replace(BLOCK, () => ['# >>> harness:gates', ...lines, '# <<< harness:gates'].join('\n'));
  if (o.scoped !== undefined) {
    const before = text;
    text = text.replace(/^SCOPED_PATHS=.*$/m, () => `SCOPED_PATHS='${o.scoped}'`);
    assert.notEqual(text, before, 'no SCOPED_PATHS line in scripts/run-gates.sh');
  }
  if (o.admit !== undefined) {
    const before = text;
    text = text.replace(/^ADMIT=.*$/m, () => `ADMIT='${o.admit}'`);
    assert.notEqual(text, before, 'no ADMIT line in scripts/run-gates.sh');
  }
  fs.writeFileSync(copy, text);
  const env = {
    ...ENV,
    RUN_GATES_LOG_DIR: tmp('run-gates-logs-'),
    RUN_GATES_CACHE_DIR: cache,
    RUN_GATES_SNAPSHOT_COPY: '',
    RUN_GATES_DOCS_ONLY: '',
    RUN_GATES_KEY_EXTRA: '',
    ...(o.admit === undefined ? { RUN_GATES_ADMIT: '' } : {}),
    ...o.env,
  };
  if (o.out) {
    const fds = o.out.map((f) => fs.openSync(f, 'w'));
    const child = spawn('bash', [copy, ...args], { cwd: repo, env, stdio: ['ignore', ...fds] });
    for (const fd of fds) fs.closeSync(fd);
    return { child, repo, cache };
  }
  const r = spawnSync('bash', [copy, ...args], { cwd: repo, encoding: 'utf8', env });
  return Object.assign(r, { repo, cache, lines: r.stdout.split('\n').filter(Boolean) });
}

const REUSED_RX = /^REUSED [0-9a-f]{40,64} \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const DOCS_ONLY_RX = /^REUSED [0-9a-f]{40,64} docs-only change since \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

/** A counter file outside every repo (counting never changes a tree), a gate line that appends to it, its count. */
function counter() {
  const file = path.join(tmp('run-gates-count-'), 'count');
  const gate = (name = 't', mode = 'always', body = '') => `gate ${name} ${mode} '${body}echo x >> ${file}'`;
  const n = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0);
  return { file, gate, n };
}

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** Waits until `file` exists (and holds `text`, when given); fails after 15 s. */
function waitFor(file, text) {
  const end = Date.now() + 15000;
  while (!(fs.existsSync(file) && (text === undefined || fs.readFileSync(file, 'utf8').includes(text)))) {
    assert.ok(Date.now() < end, `timed out waiting for ${text === undefined ? file : `"${text}" in ${file}`}`);
    sleepMs(50);
  }
}

test('--list names every bound gate with its mode, in order', () => {
  const bound = gates();
  assert.ok(bound.length > 0, 'no gate is bound');
  const r = spawnSync('bash', [SCRIPT, '--list'], { cwd: ROOT, encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), bound.map((g) => `${g.name} ${g.mode}`));
});

test("every counted gate runs through run-counted, and its regex takes run-counted's line and no FAIL", () => {
  const counted = gates().filter((g) => g.kind === 'gate_counted');
  for (const name of UNCOUNTED) assert.ok(counted.some((g) => g.name === name), `UNCOUNTED names ${name}, which is not a counted gate`);
  for (const g of counted.filter((c) => !UNCOUNTED.includes(c.name))) {
    const kind = /--kind (\S+)/.exec(g.cmd)?.[1];
    const min = /--min (\d+)/.exec(g.cmd)?.[1];
    assert.ok(g.cmd.includes('run-counted.mjs') && kind && min, `${g.name} counts without run-counted --kind --min: ${g.cmd}`);
    fs.accessSync(path.join(ROOT, 'scripts', 'run-counted.mjs'));
    assert.ok(grepMatches(g.rx, `COUNTED ${kind} ${min} passed (min ${min})\n`), `${g.name}: '${g.rx}' misses run-counted's COUNTED line`);
    for (const bad of [`run-counted: FAIL 1 skipped (must be 0)\n`, `run-counted: FAIL no ${kind} summary line\n`, `COUNTED ${kind} 0 passed (min ${min})\n`]) {
      assert.ok(!grepMatches(g.rx, bad), `${g.name}: '${g.rx}' takes ${bad.trim()}`);
    }
  }
});

test('the runner never bails: a FAIL is an exit or a missing count line, colour is stripped, exit = failures', () => {
  const r = runCopy(
    [
      "gate ok always 'true'",
      "gate bad always 'false'",
      "gate_counted zero always '^COUNTED node [1-9][0-9]* passed' 'echo \"COUNTED node 0 passed (min 1)\"'",
      "gate_counted coloured always '^COUNTED node [1-9][0-9]* passed' 'printf \"\\033[32mCOUNTED node 3 passed (min 1)\\033[0m\\n\"'",
    ],
    ['--no-cache'],
  );
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /^PASS ok \d+s \S+$/m);
  assert.match(r.stdout, /^FAIL bad \d+s \S+ \(exit 1\)/m);
  assert.match(r.stdout, /^FAIL zero \d+s \S+ \(no count line matched\)/m);
  assert.match(r.stdout, /^PASS coloured \d+s \S+$/m);
  assert.match(r.stdout, /^SUMMARY 2 passed, 2 failed, 0 skipped \(full\)$/m);
});

test('--snapshot refuses a tracked change and names it (99): the gates read the commit or nothing', () => {
  const r = runCopy(["gate ok always 'true'"], ['--snapshot'], (repo) => fs.appendFileSync(path.join(repo, 'a.txt'), 'edit\n'));
  assert.equal(r.status, 99, r.stdout + r.stderr);
  assert.match(r.stderr, /M a\.txt/);
  assert.doesNotMatch(r.stdout, /^PASS /m);
});

test('reuse: the same tree again prints REUSED and the first result without running a gate; a tracked edit runs again', () => {
  const c = counter();
  const a = runCopy([c.gate()], []);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  const b = runCopy([c.gate()], [], { repo: a.repo, cache: a.cache });
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.match(b.lines[0], REUSED_RX, `the same tree was not reused: ${b.stdout}`);
  assert.equal(c.n(), 1, 'the gate ran again for the same tree');
  assert.deepEqual(b.lines.slice(1), a.lines.slice(1), "the reused lines are not the first run's result and SUMMARY");
  fs.appendFileSync(path.join(a.repo, 'a.txt'), 'edit\n');
  const d = runCopy([c.gate()], [], { repo: a.repo, cache: a.cache });
  assert.doesNotMatch(d.stdout, /^REUSED /m, `a tracked edit was answered from the cache: ${d.stdout}`);
  assert.equal(c.n(), 2, 'a tracked edit did not run the gate again');
});

test('reuse: a FAIL is never recorded', () => {
  const c = counter();
  const lines = [`gate bad always 'echo x >> ${c.file}; exit 1'`];
  const a = runCopy(lines, []);
  const b = runCopy(lines, [], { repo: a.repo, cache: a.cache });
  assert.equal(a.status, 1, a.stdout + a.stderr);
  assert.equal(b.status, 1, b.stdout + b.stderr);
  assert.doesNotMatch(b.stdout, /^REUSED /m, `a FAIL was reused: ${b.stdout}`);
  assert.equal(c.n(), 2, 'the failing gate did not run twice');
});

test('reuse: NODE_OPTIONS joins the key: another value runs the gates again, the same value reuses', () => {
  const c = counter();
  const a = runCopy([c.gate()], [], { env: { NODE_OPTIONS: '' } });
  const shared = { repo: a.repo, cache: a.cache };
  const b = runCopy([c.gate()], [], { ...shared, env: { NODE_OPTIONS: '--no-deprecation' } });
  assert.doesNotMatch(b.stdout, /^REUSED /m, `a run under another NODE_OPTIONS was answered from the cache: ${b.stdout}`);
  assert.equal(c.n(), 2, 'another NODE_OPTIONS did not run the gate');
  const d = runCopy([c.gate()], [], { ...shared, env: { NODE_OPTIONS: '--no-deprecation' } });
  assert.match(d.lines[0], REUSED_RX, `the same NODE_OPTIONS was not reused: ${d.stdout}`);
  assert.equal(c.n(), 2);
});

test('reuse: a docs-only edit reuses only under a docs pattern (RUN_GATES_DOCS_ONLY, never the bound one)', () => {
  const c = counter();
  const a = runCopy([c.gate()], []);
  const shared = { repo: a.repo, cache: a.cache };
  fs.writeFileSync(path.join(a.repo, 'notes.md'), '# notes\n');
  const b = runCopy([c.gate()], [], { ...shared, env: { RUN_GATES_DOCS_ONLY: '\\.md$' } });
  assert.match(b.lines[0], DOCS_ONLY_RX, `a .md edit under '\\.md$' was not a docs-only reuse: ${b.stdout}`);
  assert.equal(c.n(), 1, 'the gate ran for a docs-only edit');
  assert.deepEqual(b.lines.slice(1), a.lines.slice(1));
  const d = runCopy([c.gate()], [], { ...shared, env: { RUN_GATES_DOCS_ONLY: '' } });
  assert.doesNotMatch(d.stdout, /^REUSED /m, `a .md edit with docs-only reuse off was answered from the cache: ${d.stdout}`);
  assert.equal(c.n(), 2, 'with docs-only reuse off a .md edit did not run the gate');
});

test('--since: a change inside SCOPED_PATHS skips a full gate (scoped); a change outside promotes the run to full', () => {
  const always = counter();
  const full = counter();
  const lines = [always.gate('a'), full.gate('b', 'full')];
  const a = runCopy(lines, ['--since', 'HEAD'], {
    scoped: '^src/',
    prepare: (repo) => {
      fs.mkdirSync(path.join(repo, 'src'));
      fs.writeFileSync(path.join(repo, 'src', 'x.js'), 'x\n');
    },
  });
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.ok(a.lines.includes('SKIP b (full only)'), `a scoped run did not skip the full gate: ${a.stdout}`);
  assert.match(a.lines.at(-1), /^SUMMARY 1 passed, 0 failed, 1 skipped \(scoped\)$/);
  assert.equal(full.n(), 0, 'the full gate ran in a scoped run');
  fs.writeFileSync(path.join(a.repo, 'other.txt'), 'y\n');
  const b = runCopy(lines, ['--since', 'HEAD'], { repo: a.repo, cache: a.cache, scoped: '^src/' });
  assert.ok(b.lines.includes('PROMOTED to FULL: other.txt'), `a change outside SCOPED_PATHS did not promote the run: ${b.stdout}`);
  assert.match(b.lines.at(-1), /^SUMMARY 2 passed, 0 failed, 0 skipped \(full\)$/);
  assert.equal(full.n(), 1, 'the promoted run did not run the full gate');
});

test('lock: a second run waits for the first, looks at the cache again and reuses its result', async () => {
  const c = counter();
  const dir = tmp('run-gates-lock-');
  const [started, go, out1, out2, err2] = ['started', 'go', 'out1', 'out2', 'err2'].map((f) => path.join(dir, f));
  // The gate holds the lock until the test writes `go`, then counts. Its cap (60 s) is well above
  // waitFor's 15 s, so on a loaded machine the lock is still held when the second run reaches it.
  const lines = [c.gate('slow', 'always', `touch ${started}; i=0; while [ ! -f ${go} ] && [ $i -lt 600 ]; do sleep 0.1; i=$((i + 1)); done; `)];
  const first = runCopy(lines, [], { out: [out1, out1] });
  let second;
  try {
    waitFor(started);
    second = runCopy(lines, [], { repo: first.repo, cache: first.cache, env: { RUN_GATES_LOCK_POLL: '1' }, out: [out2, err2] });
    const exited = new Promise((resolve) => second.child.on('exit', (code) => resolve(code)));
    waitFor(err2, 'WAITING for run');
    fs.writeFileSync(go, '');
    assert.equal(await exited, 0, fs.readFileSync(out2, 'utf8') + fs.readFileSync(err2, 'utf8'));
    assert.ok(fs.readFileSync(err2, 'utf8').includes(`WAITING for run ${first.child.pid}`), fs.readFileSync(err2, 'utf8'));
    const lines2 = fs.readFileSync(out2, 'utf8').split('\n').filter(Boolean);
    assert.match(lines2[0] ?? '', REUSED_RX, `after the wait the second run did not reuse the first's result: ${lines2.join('\n')}`);
    assert.equal(c.n(), 1, 'the gate ran twice: the second run did not look at the cache after its wait');
  } finally {
    fs.writeFileSync(go, ''); // first, so no gate shell lingers for the cap after a failure
    first.child.kill();
    if (second) second.child.kill();
  }
});

/** The pids whose command is exactly `sleep 61`: the marker only the timeout test's gate starts. */
function sleepers() {
  const r = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout
    .split('\n')
    .map((l) => /^\s*(\d+)\s+sleep 61$/.exec(l)?.[1])
    .filter(Boolean)
    .map(Number);
}

test('timeout: a gate past RUN_GATES_GATE_TIMEOUT FAILs as a timeout, and its whole process group is stopped', () => {
  try {
    const t0 = Date.now();
    const r = runCopy(["gate hang always 'sh -c \"sleep 61 & sleep 61\"'", "gate ok always 'true'"], ['--no-cache'], { env: { RUN_GATES_GATE_TIMEOUT: '2' } });
    const ms = Date.now() - t0;
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^FAIL hang \d+s \S+ \(timeout after 2s\)$/m);
    assert.match(r.stdout, /^PASS ok \d+s \S+$/m, 'the gate after the timeout did not run');
    assert.match(r.stdout, /^SUMMARY 1 passed, 1 failed, 0 skipped \(full\)$/m);
    assert.ok(ms < 20000, `the timed-out run took ${ms} ms`);
    assert.deepEqual(sleepers(), [], 'a child of the timed-out gate outlived it');
  } finally {
    for (const pid of sleepers()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
});

test('timeout: RUN_GATES_GATE_TIMEOUT=0 sets no limit', () => {
  const r = runCopy(["gate slow always 'sleep 1'"], ['--no-cache'], { env: { RUN_GATES_GATE_TIMEOUT: '0' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^PASS slow \d+s \S+$/m);
});

test('HARNESS_ROLE=executor: a FULL run (no arguments, --snapshot) exits 99 before anything runs; --since and --list run', () => {
  const c = counter();
  const env = { HARNESS_ROLE: 'executor' };
  const refusal = "run-gates: FULL is the session's, once at landing; an executor runs bash scripts/run-gates.sh --since <the slice's base>\n";
  const full = runCopy([c.gate()], [], { env });
  const shared = { repo: full.repo, cache: full.cache, env };
  for (const r of [full, runCopy([c.gate()], ['--snapshot'], shared), runCopy([c.gate()], ['--no-cache'], shared)]) {
    assert.equal(r.status, 99, r.stdout + r.stderr);
    assert.equal(r.stderr, refusal);
    assert.equal(r.stdout, '', 'something ran before the refusal');
  }
  assert.equal(c.n(), 0, 'a gate ran in a refused run');
  const list = runCopy([c.gate()], ['--list'], shared);
  assert.equal(list.status, 0, list.stdout + list.stderr);
  assert.deepEqual(list.lines, ['t always']);
  const since = runCopy([c.gate()], ['--since', 'HEAD'], shared);
  assert.equal(since.status, 0, since.stdout + since.stderr);
  assert.match(since.lines.at(-1), /^SUMMARY 1 passed, 0 failed, 0 skipped \(scoped\)$/);
  assert.equal(c.n(), 1, 'the scoped run did not run its gate');
});

test('HARNESS_ROLE=executor: a scoped run promoted to FULL exits 99 naming the path, before the cache or any gate; inside SCOPED_PATHS it runs', () => {
  const c = counter();
  const env = { HARNESS_ROLE: 'executor' };
  const inside = runCopy([c.gate(), c.gate('f', 'full')], ['--since', 'HEAD'], {
    env,
    scoped: '^src/',
    prepare: (repo) => {
      fs.mkdirSync(path.join(repo, 'src'));
      fs.writeFileSync(path.join(repo, 'src', 'x.js'), 'x\n');
    },
  });
  assert.equal(inside.status, 0, inside.stdout + inside.stderr);
  assert.match(inside.lines.at(-1), /^SUMMARY 1 passed, 0 failed, 1 skipped \(scoped\)$/);
  assert.equal(c.n(), 1, 'the scoped run did not run its gate');
  // the same tree promoted, with a FULL PASS cached for it: still refused, nothing reused
  fs.writeFileSync(path.join(inside.repo, 'other.txt'), 'y\n');
  const cached = runCopy([c.gate(), c.gate('f', 'full')], [], { repo: inside.repo, cache: inside.cache, scoped: '^src/' });
  assert.equal(cached.status, 0, cached.stdout + cached.stderr);
  const promoted = runCopy([c.gate(), c.gate('f', 'full')], ['--since', 'HEAD'], { repo: inside.repo, cache: inside.cache, scoped: '^src/', env });
  assert.equal(promoted.status, 99, promoted.stdout + promoted.stderr);
  assert.equal(promoted.stderr, "run-gates: PROMOTED to FULL by other.txt, outside SCOPED_PATHS: FULL is the session's, once at landing; an executor stops and reports the path\n");
  assert.equal(promoted.stdout, '', 'something ran or was reused before the refusal');
  assert.equal(c.n(), 3, 'a gate ran in the refused run');
});

/** An admission stand-in: appends its arguments to a calls file and exits `code`; `n()` counts the calls. */
function admitter(code) {
  const dir = tmp('run-gates-admit-');
  const calls = path.join(dir, 'calls');
  const script = path.join(dir, 'admit.sh');
  fs.writeFileSync(script, `echo "$*" >> ${calls}\nexit ${code}\n`);
  const n = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).length : 0);
  return { cmd: `sh ${script}`, calls, n };
}

test('admission: a refused FULL run prints NOT ADMITTED (exit <n>) and exits 97, with no gate run and no SUMMARY', () => {
  const c = counter();
  const a = admitter(1);
  const r = runCopy([c.gate()], [], { admit: a.cmd });
  assert.equal(r.status, 97, r.stdout + r.stderr);
  assert.ok(r.lines.includes('NOT ADMITTED (exit 1)'), r.stdout);
  assert.doesNotMatch(r.stdout, /^(SUMMARY|PASS|FAIL|logs:) /m);
  assert.equal(c.n(), 0, 'a gate ran in a refused run');
  assert.deepEqual(fs.readFileSync(a.calls, 'utf8').trim().split('\n'), [`--top ${r.repo}`], 'the bound ADMIT was not run once with --top <repo top>');
  const env = runCopy([c.gate()], [], { repo: r.repo, cache: r.cache, env: { RUN_GATES_ADMIT: admitter(3).cmd } });
  assert.equal(env.status, 97, env.stdout + env.stderr);
  assert.ok(env.lines.includes('NOT ADMITTED (exit 3)'), `RUN_GATES_ADMIT does not override ADMIT: ${env.stdout}`);
});

test('admission: a scoped run, RUN_GATES_ADMIT=\'\' and a cache hit never call it; an admitted FULL run runs its gates', () => {
  const c = counter();
  const a = admitter(0);
  const scoped = runCopy([c.gate()], ['--since', 'HEAD'], { admit: a.cmd });
  assert.equal(scoped.status, 0, scoped.stdout + scoped.stderr);
  assert.equal(a.n(), 0, 'a scoped run was admitted');
  assert.equal(c.n(), 1, 'the scoped run did not run its gate');
  const shared = { repo: scoped.repo, cache: scoped.cache, admit: a.cmd };
  const first = runCopy([c.gate()], [], shared);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(a.n(), 1, 'an uncached FULL run was not admitted');
  assert.match(first.lines.at(-1), /^SUMMARY 1 passed, 0 failed, 0 skipped \(full\)$/);
  assert.equal(c.n(), 2);
  const hit = runCopy([c.gate()], [], shared);
  assert.match(hit.lines[0], REUSED_RX, `the same tree was not reused: ${hit.stdout}`);
  assert.equal(a.n(), 1, 'a cache hit was admitted');
  assert.equal(c.n(), 2);
  const off = runCopy([c.gate()], ['--no-cache'], { ...shared, env: { RUN_GATES_ADMIT: '' } });
  assert.equal(off.status, 0, off.stdout + off.stderr);
  assert.equal(a.n(), 1, "RUN_GATES_ADMIT='' did not turn admission off");
  assert.equal(c.n(), 3, 'the run with admission off did not run its gate');
});

test('lock: a run promoted to FULL after a lock wait takes the FULL lock, so a later FULL run waits for it', async () => {
  const dir = tmp('run-gates-promote-lock-');
  const [started, go, glog, outA, outB, errB, outC, errC] = ['started', 'go', 'glog', 'outA', 'outB', 'errB', 'outC', 'errC'].map((f) => path.join(dir, f));
  // `hold` keeps a scoped run on the scoped lock until the test writes `go` (cap 60 s); `gfull` logs
  // its start and end, so two FULL runs whose full-only gates overlap show as start, start.
  const lines = [
    `gate hold always 'if [ "$RUN_GATES_MODE" = scoped ]; then touch ${started}; i=0; while [ ! -f ${go} ] && [ $i -lt 600 ]; do sleep 0.1; i=$((i + 1)); done; fi'`,
    `gate gfull full 'echo start >> ${glog}; sleep 3; echo end >> ${glog}'`,
  ];
  const env = { RUN_GATES_LOCK_POLL: '1' };
  const exited = (run) => new Promise((resolve) => run.child.on('exit', (code) => resolve(code)));
  const a = runCopy(lines, ['--since', 'HEAD', '--no-cache'], { out: [outA, outA] });
  const shared = { repo: a.repo, cache: a.cache, env };
  const aDone = exited(a);
  let b;
  let c;
  try {
    waitFor(started);
    b = runCopy(lines, ['--since', 'HEAD', '--no-cache'], { ...shared, out: [outB, errB] });
    const bDone = exited(b);
    waitFor(errB, 'WAITING for run');
    fs.writeFileSync(path.join(a.repo, 'config.json'), '{}\n'); // untracked, outside SCOPED_PATHS: promotes b
    fs.writeFileSync(go, '');
    assert.equal(await aDone, 0, fs.readFileSync(outA, 'utf8'));
    waitFor(glog, 'start');
    c = runCopy(lines, ['--no-cache'], { ...shared, out: [outC, errC] });
    const cDone = exited(c);
    assert.equal(await bDone, 0, fs.readFileSync(outB, 'utf8') + fs.readFileSync(errB, 'utf8'));
    assert.equal(await cDone, 0, fs.readFileSync(outC, 'utf8') + fs.readFileSync(errC, 'utf8'));
    assert.ok(fs.readFileSync(outB, 'utf8').includes('PROMOTED to FULL: config.json'), fs.readFileSync(outB, 'utf8'));
    assert.deepEqual(fs.readFileSync(glog, 'utf8').split('\n').filter(Boolean), ['start', 'end', 'start', 'end'], 'the two FULL runs ran their full-only gate at the same time');
    assert.ok(fs.readFileSync(errC, 'utf8').includes(`WAITING for run ${b.child.pid}`), fs.readFileSync(errC, 'utf8'));
  } finally {
    fs.writeFileSync(go, ''); // first, so no gate shell lingers for the cap after a failure
    for (const r of [a, b, c]) if (r) r.child.kill();
  }
});

test('known reds: a red the mainline FULL run named, in a file the branch did not touch, is KNOWN -- no exit count, never cached; anything else FAILs', () => {
  const dir = tmp('run-gates-said-');
  const said = path.join(dir, 'said');
  // gate t, one call of a stand-in run-counted.mjs, ends as run-counted ends a failing run, with the
  // ids `say` wrote, and passes when none are written
  const fake = path.join(dir, 'run-counted.mjs');
  fs.writeFileSync(fake, `if [ -s ${said} ]; then cat ${said}; exit 1; fi\n`);
  const lines = [`gate t always 'bash ${fake}'`, "gate ok always 'true'"];
  const say = (...ids) =>
    fs.writeFileSync(said, ids.length ? ['run-counted: FAIL the command exited 1', `run-counted: FAIL ${ids.length} failed (must be 0)`, ...ids.map((id) => `run-counted: FAILED ${id}`), ''].join('\n') : '');
  const git = (repo, ...a) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: repo, encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
  };
  const commit = (repo, file, text) => {
    fs.writeFileSync(path.join(repo, file), text);
    git(repo, 'add', file);
    git(repo, 'commit', '-q', '-m', file);
  };
  const prepare = (repo) => {
    fs.mkdirSync(path.join(repo, 'tests'));
    commit(repo, 'tests/a.test.mjs', "test('one')\ntest('two')\ntest('three')\n");
    commit(repo, '.gitignore', 'tests/ignored.test.mjs\n');
    fs.writeFileSync(path.join(repo, 'tests', 'new.test.mjs'), "test('fresh')\n");
    fs.writeFileSync(path.join(repo, 'tests', 'ignored.test.mjs'), "test('hidden')\n");
  };
  const A1 = 'tests/a.test.mjs :: one';
  const A2 = 'tests/a.test.mjs :: group > two';
  const IGNORED = 'tests/ignored.test.mjs :: hidden';
  say(A1, A2, IGNORED, 'tests/new.test.mjs :: fresh', 'tests/gone.test.mjs :: gone', '/abs/x.test.mjs :: abs');
  const main = runCopy(lines, [], { prepare });
  const shared = { repo: main.repo, cache: main.cache };
  // the mainline's own reds are FAIL: its run records them
  assert.equal(main.status, 1, main.stdout + main.stderr);
  assert.match(main.stdout, /^FAIL t \d+s \S+ \(exit 1\)/m);
  git(main.repo, 'checkout', '-q', '-b', 'unit');
  commit(main.repo, 'b.txt', 'b\n');
  say(A1, A2);
  const known = runCopy(lines, [], shared);
  assert.equal(known.status, 0, known.stdout + known.stderr);
  assert.match(known.stdout, /^KNOWN t \d+s \S+ \(2 failing test\(s\) in the main baseline, their files untouched\)$/m);
  assert.equal(known.lines.at(-1), 'SUMMARY 1 passed, 0 failed, 0 skipped, 1 known (full)');
  const again = runCopy(lines, [], shared);
  assert.doesNotMatch(again.stdout, /^REUSED /m, 'a run with a KNOWN gate was cached');
  assert.match(again.stdout, /^KNOWN t /m);
  say(A2);
  assert.match(runCopy(lines, [], shared).stdout, /^KNOWN t \d+s \S+ \(1 failing test\(s\) in the main baseline/m);
  assert.match(runCopy(lines, ['--since', 'main'], { ...shared, scoped: '.*' }).stdout, /^KNOWN t /m, 'a scoped run');
  const fails = (why, opts = {}) => {
    const r = runCopy(lines, [], { ...shared, ...opts });
    assert.equal(r.status, 1, `${why}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^FAIL t \d+s \S+ \(exit 1\)/m, why);
    assert.doesNotMatch(r.stdout, /^KNOWN /m, why);
  };
  fails('no baseline: RUN_GATES_MAINLINE empty', { env: { RUN_GATES_MAINLINE: '' } });
  fails('no merge base: a mainline that does not exist', { env: { RUN_GATES_MAINLINE: 'trunk' } });
  say(A1, 'tests/a.test.mjs :: three');
  fails('a failing test the baseline does not name');
  say(A1, '?');
  fails('a failure run-counted could not name');
  say(A1);
  fs.appendFileSync(said, 'more output\n');
  fails('output after the FAILED block');
  say('tests/gone.test.mjs :: gone');
  fails('a file that is not in the tree');
  say('/abs/x.test.mjs :: abs');
  fails('a file outside the tree');
  say('tests/new.test.mjs :: fresh');
  fails('an untracked test file');
  say(IGNORED);
  fails('an ignored test file the merge base lacks');
  say(A1);
  fs.appendFileSync(path.join(main.repo, 'tests', 'a.test.mjs'), 'edit\n');
  fails('an uncommitted edit to the test file');
  git(main.repo, 'add', 'tests/a.test.mjs');
  git(main.repo, 'commit', '-q', '-m', 'edit a');
  fails('a committed edit to the test file');
  // the mainline passes: its record is cleared, and the branch's red FAILs again
  git(main.repo, 'checkout', '-q', 'main');
  say();
  assert.equal(runCopy(lines, ['--no-cache'], shared).status, 0);
  git(main.repo, 'checkout', '-q', '-b', 'unit2');
  commit(main.repo, 'c.txt', 'c\n');
  say(A2);
  fails('the mainline passed since');
});

test('known reds: only a gate of one run-counted call, a file that spells the title, an id with one ` :: `; the record is made at the tip, detached too, never when the tree moved, and holds only from its commit on', () => {
  const dir = tmp('run-gates-said-');
  const said = path.join(dir, 'said');
  const fake = path.join(dir, 'run-counted.mjs');
  fs.writeFileSync(fake, `if [ -s ${said} ]; then cat ${said}; exit 1; fi\n`);
  const editFlag = path.join(dir, 'edit');
  const lines = [
    `gate t always 'bash ${fake}'`,
    `gate pair always 'true && bash ${fake}'`,
    `gate e always 'if [ -e ${editFlag} ]; then echo during >> a.txt; fi'`,
  ];
  const say = (...ids) =>
    fs.writeFileSync(said, ['run-counted: FAIL the command exited 1', ...ids.map((id) => `run-counted: FAILED ${id}`), ''].join('\n'));
  const git = (repo, ...a) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: repo, encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
  };
  const commit = (repo, file, text) => {
    fs.writeFileSync(path.join(repo, file), text);
    git(repo, 'add', file);
    git(repo, 'commit', '-q', '-m', file);
  };
  const prepare = (repo) => {
    fs.mkdirSync(path.join(repo, 'tests'));
    commit(repo, 'tests/a.test.mjs', "test('one', () => {})\n");
  };
  const T1 = 'tests/a.test.mjs :: one';
  const LACKS = 'tests/a.test.mjs :: a title the file lacks';
  // a mainline run whose tree moved before its last gate records nothing
  say(T1, LACKS);
  fs.writeFileSync(editFlag, '');
  const moved = runCopy(lines, [], { prepare });
  assert.match(moved.stderr, /^run-gates: the tree changed during the run: the known-red record is not updated$/m);
  fs.rmSync(editFlag);
  const { repo } = moved;
  const shared = { repo, cache: moved.cache };
  git(repo, 'checkout', '--', 'a.txt');
  // so does a --snapshot run whose gate wrote a tracked file of the snapshot
  fs.writeFileSync(editFlag, '');
  const snapMoved = runCopy(lines, ['--snapshot', '--no-cache'], shared);
  assert.match(snapMoved.stderr, /^run-gates: the tree changed during the run: the known-red record is not updated$/m, snapMoved.stdout + snapMoved.stderr);
  fs.rmSync(editFlag);
  git(repo, 'checkout', '-q', '-b', 'unit');
  commit(repo, 'b.txt', 'b\n');
  say(T1);
  assert.match(runCopy(lines, [], shared).stdout, /^FAIL t /m, 'a record from the run whose tree moved');
  // made detached at the mainline's tip (a worktree cannot check the branch out a second time)
  git(repo, 'checkout', '-q', '--detach', 'main');
  say(T1, LACKS);
  assert.doesNotMatch(runCopy(lines, [], shared).stderr, /tree changed/);
  git(repo, 'checkout', '-q', 'unit');
  say(T1);
  const r = runCopy(lines, [], shared);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^KNOWN t /m);
  assert.match(r.stdout, /^FAIL pair \d+s \S+ \(exit 1\)/m, 'a gate of two commands is never KNOWN');
  say(LACKS);
  assert.match(runCopy(lines, [], shared).stdout, /^FAIL t /m, 'a title its file does not spell');
  // an id with a second ` :: ` has no sure split: the run records none for its gate
  git(repo, 'checkout', '-q', '--detach', 'main');
  say(T1, 'tests/a.test.mjs :: x :: y');
  runCopy(lines, [], shared);
  git(repo, 'checkout', '-q', 'unit');
  say(T1);
  assert.match(runCopy(lines, [], shared).stdout, /^FAIL t /m, 'the record outlived a run with an ambiguous id');
  // a record made before the branch's merge base is stale: the mainline may have fixed the test since
  git(repo, 'checkout', '-q', '--detach', 'main');
  say(T1);
  runCopy(lines, [], shared);
  git(repo, 'checkout', '-q', 'main');
  commit(repo, 'm.txt', 'm\n');
  git(repo, 'checkout', '-q', '-b', 'unit3');
  commit(repo, 'd.txt', 'd\n');
  say(T1);
  assert.match(runCopy(lines, [], shared).stdout, /^FAIL t /m, 'a record older than the merge base');
  git(repo, 'checkout', '-q', 'unit');
  assert.match(runCopy(lines, [], shared).stdout, /^KNOWN t /m, 'a branch from the commit the record was made at');
});
