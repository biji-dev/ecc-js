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

// the template's SCOPED_PATHS, which no RUN_GATES_ variable overrides: runCopy writes it into every copy
const TEMPLATE_SCOPED = String.raw`^(src|apps|packages|lib|docs|tests?)/|\.md$`;

/**
 * A copy of the runner, its gate block replaced by `lines`, run in a repo (a new one unless `repo`
 * is given) with a cache dir (a new one unless `cache` is given), so two runs can share both. The
 * docs-only pattern, KEY_EXTRA, the snapshot copy and admission are off unless `env` sets them, and
 * every other binding runs at the template's value; SCOPED_PATHS is `scoped` or the template's; `admit` replaces the
 * ADMIT line in the copy (and leaves admission on); `out` ([stdout file, stderr file]) starts the
 * run in the background and returns its child. No bound value is read. Returns the spawn result
 * with `repo`, `cache` and `lines`.
 */
function runCopy(lines, args, opts = {}) {
  const o = typeof opts === 'function' ? { prepare: opts } : opts;
  const repo = o.repo ?? newRepo();
  const cache = o.cache ?? tmp('run-gates-cache-');
  if (o.prepare) o.prepare(repo);
  const copy = path.join(tmp('run-gates-copy-'), 'run-gates.sh');
  // A replacer function, not a string: a gate line may hold `$'`, a replacement pattern.
  let text = SOURCE.replace(BLOCK, () => ['# >>> harness:gates', ...lines, '# <<< harness:gates'].join('\n'));
  assert.match(text, /^SCOPED_PATHS=.*$/m, 'no SCOPED_PATHS line in scripts/run-gates.sh');
  text = text.replace(/^SCOPED_PATHS=.*$/m, () => `SCOPED_PATHS='${o.scoped ?? TEMPLATE_SCOPED}'`);
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
    // the template's values, so an install's bindings never reach a test; a test that needs another sets it
    RUN_GATES_MAINLINE: 'main',
    RUN_GATES_PRODUCT_PATHS: '',
    RUN_GATES_RECORDS: String.raw`(^|/)[^/]+\.(state\.md|steps\.jsonl)$`,
    RUN_GATES_RETRY_FLAKY: '1',
    RUN_GATES_GATE_JOBS: '1',
    RUN_GATES_SERIAL: '',
    RUN_GATES_GATE_TIMEOUT: '3600',
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
  const calls = fs.readFileSync(a.calls, 'utf8').trim().split('\n');
  assert.equal(calls.length, 1, 'the bound ADMIT was not run once');
  assert.match(calls[0], /^--holder [1-9][0-9]* --top (\S+)$/);
  assert.equal(calls[0].replace(/^--holder \d+ --top /, ''), r.repo, 'not run with --holder <pid> --top <repo top>');
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

/**
 * A leasing admission stand-in: writes slot-1 in `dir` naming its --holder the way admission.mjs does,
 * prints `LEASE <slot>` (unless `print` is false) and exits `code`.
 */
function leaser(dir, { code = 0, print = true } = {}) {
  const script = path.join(tmp('run-gates-lease-'), 'admit.sh');
  const slot = path.join(dir, 'slot-1');
  fs.writeFileSync(
    script,
    [
      "h=''; p=''",
      'for a in "$@"; do [ "$p" = --holder ] && h=$a; p=$a; done',
      `mkdir -p ${dir}`,
      `printf '{"pid":%s,"top":"/repo/shop","at":"2026-01-15T10:00:00Z"}\\n' "$h" > ${slot}`,
      print ? `echo "LEASE ${slot}"` : ':',
      `exit ${code}`,
      '',
    ].join('\n'),
  );
  return { cmd: `sh ${script}`, slot };
}

test('lease: a FULL run holds its slot while its gates run and removes it at exit, passed, failed or refused', () => {
  const dir = path.join(tmp('run-gates-leases-'), 'leases');
  const seen = path.join(tmp('run-gates-seen-'), 'seen');
  const l = leaser(dir);
  const env = { HARNESS_LEASE_DIR: dir };
  const pass = runCopy([`gate t always 'cat ${l.slot} > ${seen}'`], ['--no-cache'], { admit: l.cmd, env });
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.ok(pass.lines.includes(`LEASE ${l.slot}`), pass.stdout);
  assert.match(fs.readFileSync(seen, 'utf8'), /^\{"pid":[1-9][0-9]*,/, 'the gate ran without the slot');
  assert.ok(!fs.existsSync(l.slot), 'a passing run left its slot');
  const fail = runCopy(["gate t always 'exit 1'"], ['--no-cache'], { admit: l.cmd, env });
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  assert.ok(!fs.existsSync(l.slot), 'a failing run left its slot');
  const refused = runCopy(["gate t always 'true'"], ['--no-cache'], { admit: leaser(dir, { code: 1 }).cmd, env });
  assert.equal(refused.status, 97, refused.stdout + refused.stderr);
  assert.ok(!fs.existsSync(l.slot), 'a refused run left its slot');
});

test('lease: a slot naming this run that admission never printed is removed; one naming another pid is left', () => {
  const dir = path.join(tmp('run-gates-leases-'), 'leases');
  const l = leaser(dir, { print: false });
  fs.mkdirSync(dir, { recursive: true });
  const other = path.join(dir, 'slot-2');
  fs.writeFileSync(other, '{"pid":1,"top":"/repo/ledger","at":"2026-01-15T09:00:00Z"}\n');
  const r = runCopy(["gate t always 'true'"], ['--no-cache'], { admit: l.cmd, env: { HARNESS_LEASE_DIR: dir } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(l.slot), 'the unprinted slot naming this run was left');
  assert.ok(fs.existsSync(other), "another run's slot was removed");
});

test('lease: TERM during a gate removes the slot', () => {
  const dir = path.join(tmp('run-gates-leases-'), 'leases');
  const started = path.join(tmp('run-gates-started-'), 'started');
  const l = leaser(dir);
  const out = path.join(tmp('run-gates-out-'), 'out');
  const r = runCopy([`gate t always 'touch ${started}; sleep 30'`], ['--no-cache'], { admit: l.cmd, env: { HARNESS_LEASE_DIR: dir }, out: [out, out] });
  try {
    waitFor(started);
    assert.ok(fs.existsSync(l.slot));
    r.child.kill('SIGTERM');
    const end = Date.now() + 15000;
    while (fs.existsSync(l.slot) && Date.now() < end) sleepMs(50);
    assert.ok(!fs.existsSync(l.slot), `TERM left the slot: ${fs.readFileSync(out, 'utf8')}`);
  } finally {
    r.child.kill('SIGKILL');
  }
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

/** git in `repo`, asserting it succeeds; returns stdout. */
function gitOk(repo, ...a) {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: repo, encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
/** Writes `file` (relative to `repo`, directories made) and commits it. */
function commitFile(repo, file, text) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
  gitOk(repo, 'add', file);
  gitOk(repo, 'commit', '-q', '-m', file);
}
const SKIP_PATHS_RX = /^SKIP h \(no path outside PRODUCT_PATHS changed since [0-9a-f]{12}\)$/;

test('paths: a FULL run whose every change since the merge base is in PRODUCT_PATHS skips the paths gate, naming the merge base', () => {
  const h = counter();
  const lines = [h.gate('h', 'paths'), "gate ok always 'true'"];
  const repo = newRepo();
  const mb = gitOk(repo, 'rev-parse', 'HEAD').trim();
  gitOk(repo, 'checkout', '-q', '-b', 'unit');
  commitFile(repo, 'src/a.js', 'a\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'untracked\n');
  const r = runCopy(lines, [], { repo, env: { RUN_GATES_PRODUCT_PATHS: '^src/' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.lines.includes(`SKIP h (no path outside PRODUCT_PATHS changed since ${mb.slice(0, 12)})`), r.stdout);
  assert.equal(r.lines.at(-1), 'SUMMARY 1 passed, 0 failed, 1 skipped (full)');
  assert.equal(h.n(), 0, 'the paths gate ran');
});

test('paths: the gate runs on the mainline tip, with no merge base, with nothing changed and with one path outside PRODUCT_PATHS', () => {
  const h = counter();
  const lines = [h.gate('h', 'paths')];
  const env = { RUN_GATES_PRODUCT_PATHS: '^src/' };
  const runs = (why, repo, extra = {}) => {
    const before = h.n();
    const r = runCopy(lines, ['--no-cache'], { repo, env: { ...env, ...extra } });
    assert.equal(r.status, 0, `${why}: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /^SKIP /m, why);
    assert.equal(h.n(), before + 1, `${why}: the paths gate did not run`);
  };
  const repo = newRepo();
  // on the mainline: HEAD at its tip, product edits included
  commitFile(repo, 'src/a.js', 'a\n');
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'edit\n');
  runs('the mainline tip', repo);
  gitOk(repo, 'checkout', '-q', '--', 'src/a.js');
  gitOk(repo, 'checkout', '-q', '-b', 'unit');
  commitFile(repo, 'src/b.js', 'b\n');
  runs('no mainline', repo, { RUN_GATES_MAINLINE: '' });
  runs('a mainline that does not exist', repo, { RUN_GATES_MAINLINE: 'trunk' });
  const orphan = newRepo();
  gitOk(orphan, 'checkout', '-q', '--orphan', 'other');
  gitOk(orphan, 'rm', '-q', '-r', '--cached', '.');
  commitFile(orphan, 'src/c.js', 'c\n');
  runs('no merge base', orphan);
  const empty = newRepo();
  gitOk(empty, 'checkout', '-q', '-b', 'unit');
  gitOk(empty, 'commit', '-q', '--allow-empty', '-m', 'nothing');
  runs('nothing changed since the merge base', empty);
  fs.writeFileSync(path.join(repo, 'harness.md'), 'outside\n');
  runs('one path outside PRODUCT_PATHS', repo);
});

test('paths: PRODUCT_PATHS empty makes a paths gate a full one; a scoped run runs it only for a change outside PRODUCT_PATHS', () => {
  const h = counter();
  const lines = [h.gate('h', 'paths'), "gate ok always 'true'"];
  const repo = newRepo();
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  const off = runCopy(lines, ['--since', 'HEAD'], { repo, scoped: '.*' });
  assert.ok(off.lines.includes('SKIP h (full only)'), `PRODUCT_PATHS off: not a full gate in a scoped run: ${off.stdout}`);
  assert.equal(h.n(), 0);
  const head = gitOk(repo, 'rev-parse', 'HEAD').trim();
  const env = { RUN_GATES_PRODUCT_PATHS: '^src/' };
  const inside = runCopy(lines, ['--since', 'HEAD'], { repo, scoped: '.*', env });
  assert.ok(inside.lines.includes(`SKIP h (no path outside PRODUCT_PATHS changed since ${head.slice(0, 12)})`), inside.stdout);
  assert.equal(h.n(), 0, 'a scoped run with product changes only ran the paths gate');
  fs.writeFileSync(path.join(repo, 'tool.sh'), 'x\n');
  const outside = runCopy(lines, ['--since', 'HEAD'], { repo, scoped: '.*', env });
  assert.equal(outside.lines.at(-1), 'SUMMARY 2 passed, 0 failed, 0 skipped (scoped)', outside.stdout);
  assert.equal(h.n(), 1, 'a scoped run with a change outside PRODUCT_PATHS did not run the paths gate');
});

test('paths: the run-or-skip decision joins the cache: a skip never answers a run of the same tree, nor a run a skip', () => {
  const h = counter();
  const lines = [h.gate('h', 'paths'), "gate ok always 'true'"];
  const repo = newRepo();
  gitOk(repo, 'checkout', '-q', '-b', 'unit');
  commitFile(repo, 'src/a.js', 'a\n');
  const cache = tmp('run-gates-cache-');
  const go = (rx) => runCopy(lines, [], { repo, cache, env: { RUN_GATES_PRODUCT_PATHS: rx } });
  const skip = go('^src/');
  assert.ok(skip.lines.some((l) => SKIP_PATHS_RX.test(l)), skip.stdout);
  assert.equal(h.n(), 0);
  const run = go('^lib/');
  assert.doesNotMatch(run.stdout, /^REUSED /m, `a skipped run answered one that must run the gate: ${run.stdout}`);
  assert.equal(h.n(), 1, 'the run after a skip did not run the paths gate');
  const skipAgain = go('^src/');
  assert.match(skipAgain.lines[0], REUSED_RX, `the skip was not reused for the same tree and decision: ${skipAgain.stdout}`);
  assert.ok(skipAgain.lines.some((l) => SKIP_PATHS_RX.test(l)), skipAgain.stdout);
  const runAgain = go('^lib/');
  assert.match(runAgain.lines[0], REUSED_RX, runAgain.stdout);
  assert.equal(h.n(), 1);
});

test('RECORDS: a records-only change prints REUSED (untracked, committed, and in a snapshot); RUN_GATES_RECORDS empty runs again', () => {
  const c = counter();
  const repo = newRepo();
  gitOk(repo, 'checkout', '-q', '-b', 'unit');
  commitFile(repo, 'src/a.js', 'a\n');
  const cache = tmp('run-gates-cache-');
  const first = runCopy([c.gate()], [], { repo, cache });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  fs.mkdirSync(path.join(repo, 'plans', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plans', 'unit', 'u1.state.md'), '# state\n');
  fs.writeFileSync(path.join(repo, 'plans', 'unit', 'u1.steps.jsonl'), '{}\n');
  const untracked = runCopy([c.gate()], [], { repo, cache });
  assert.match(untracked.lines[0], REUSED_RX, `untracked records were not reused: ${untracked.stdout}`);
  gitOk(repo, 'add', 'plans');
  gitOk(repo, 'commit', '-q', '-m', 'land');
  const landed = runCopy([c.gate()], [], { repo, cache });
  assert.match(landed.lines[0], REUSED_RX, `the land commit was not reused: ${landed.stdout}`);
  const snap = runCopy([c.gate()], ['--snapshot'], { repo, cache });
  assert.equal(snap.status, 0, snap.stdout + snap.stderr);
  assert.equal(c.n(), 2, 'the snapshot did not run once for its own mode');
  fs.appendFileSync(path.join(repo, 'plans', 'unit', 'u1.state.md'), 'more\n');
  gitOk(repo, 'commit', '-q', '-am', 'state');
  const snap2 = runCopy([c.gate()], ['--snapshot'], { repo, cache });
  assert.match(snap2.lines[0], REUSED_RX, `a snapshot whose commit differs only in records was not reused: ${snap2.stdout}`);
  assert.equal(c.n(), 2);
  const off = runCopy([c.gate()], [], { repo, cache, env: { RUN_GATES_RECORDS: '' } });
  assert.doesNotMatch(off.stdout, /^REUSED /m, `with RECORDS off a records change was reused: ${off.stdout}`);
  assert.equal(c.n(), 3);
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'product\n');
  const product = runCopy([c.gate()], [], { repo, cache });
  assert.doesNotMatch(product.stdout, /^REUSED /m, `a product edit was reused: ${product.stdout}`);
  assert.equal(c.n(), 4);
});

test('RECORDS: a scoped run does not list records as changed, so they never promote it; an invalid RECORDS or PRODUCT_PATHS exits 99', () => {
  const c = counter();
  const repo = newRepo();
  fs.writeFileSync(path.join(repo, 'x.state.md'), '# s\n');
  const r = runCopy([c.gate()], ['--since', 'HEAD'], { repo, scoped: '^src/' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.lines.includes('SCOPED: nothing changed since HEAD'), r.stdout);
  const bad = runCopy([c.gate()], [], { repo, env: { RUN_GATES_RECORDS: '(' } });
  assert.equal(bad.status, 99, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /RECORDS is not a valid extended regex/);
  const badPaths = runCopy([c.gate('h', 'paths')], [], { repo, env: { RUN_GATES_PRODUCT_PATHS: '(' } });
  assert.equal(badPaths.status, 99, badPaths.stdout + badPaths.stderr);
  assert.match(badPaths.stderr, /PRODUCT_PATHS is not a valid extended regex/);
});

/**
 * A stand-in run-counted (`bash <dir>/run-counted.mjs`): each call is counted; while the count is at or
 * under the number `setFails` wrote, a call ends as run-counted ends a failing run naming `ids` and
 * exits 1, after `sleep` seconds. Later calls pass with a count line.
 */
function flaky(ids, { sleep = 0 } = {}) {
  const dir = tmp('run-gates-flaky-');
  const calls = path.join(dir, 'calls');
  const fails = path.join(dir, 'fails');
  const fake = path.join(dir, 'run-counted.mjs');
  fs.writeFileSync(
    fake,
    [
      `echo x >> ${calls}`,
      `n=$(grep -c . ${calls})`,
      `sleep ${sleep}`,
      `if [ "$n" -le "$(cat ${fails} 2>/dev/null || echo 0)" ]; then`,
      `  echo 'run-counted: FAIL ${ids.length} failed (must be 0)'`,
      ...ids.map((id) => `  echo 'run-counted: FAILED ${id}'`),
      '  exit 1',
      'fi',
      "echo 'COUNTED node 3 passed (min 1)'",
      '',
    ].join('\n'),
  );
  const setFails = (n) => fs.writeFileSync(fails, `${n}\n`);
  const n = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).length : 0);
  const line = (name = 't') => `gate_counted ${name} always '^COUNTED node [1-9][0-9]* passed' 'bash ${fake}'`;
  return { fake, setFails, n, line };
}
/** A repo on the mainline with a committed test file the ids name. */
function flakyRepo() {
  const repo = newRepo();
  commitFile(repo, 'tests/a.test.mjs', "test('one')\ntest('two')\n");
  return repo;
}
const FLAKY_ENV = { RUN_GATES_INSTANT_SECS: '0' };

test('flaky retry: a failure in untouched test files runs once more; a pass prints the flaky PASS line, is registered and cached', () => {
  const ids = ['tests/a.test.mjs :: one', 'tests/a.test.mjs :: two'];
  const f = flaky(ids);
  f.setFails(1);
  const repo = flakyRepo();
  gitOk(repo, 'checkout', '-q', '-b', 'unit');
  commitFile(repo, 'src/x.js', 'x\n');
  const cache = tmp('run-gates-cache-');
  const r = runCopy([f.line()], [], { repo, cache, env: FLAKY_ENV });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^PASS t \d+s \S+\/t\.retry\.log \(flaky: tests\/a\.test\.mjs :: one; tests\/a\.test\.mjs :: two, retried\)$/m);
  assert.equal(r.lines.at(-1), 'SUMMARY 1 passed, 0 failed, 0 skipped (full)');
  assert.equal(f.n(), 2, 'the gate did not run exactly twice');
  const reg = fs.readFileSync(path.join(cache, 'flakes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(reg.length, 1);
  assert.deepEqual(Object.keys(reg[0]), ['at', 'gate', 'ids', 'tree', 'top']);
  assert.match(reg[0].at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(reg[0].gate, 't');
  assert.deepEqual(reg[0].ids, ids);
  assert.match(reg[0].tree, /^[0-9a-f]{40,64}$/);
  assert.equal(reg[0].top, repo);
  const again = runCopy([f.line()], [], { repo, cache, env: FLAKY_ENV });
  assert.match(again.lines[0], REUSED_RX, `a run healed by its retry was not cached: ${again.stdout}`);
  assert.equal(f.n(), 2);
  // the same through a parallel worker's result file
  f.setFails(3);
  const par = runCopy([f.line(), "gate ok always 'true'"], ['--no-cache'], { repo, cache, env: { ...FLAKY_ENV, RUN_GATES_GATE_JOBS: '2' } });
  assert.equal(par.status, 0, par.stdout + par.stderr);
  assert.match(par.stdout, /^PASS t \d+s \S+\/t\.retry\.log \(flaky: tests\/a\.test\.mjs :: one; tests\/a\.test\.mjs :: two, retried\)$/m);
  assert.equal(par.lines.at(-1), 'SUMMARY 2 passed, 0 failed, 0 skipped (full)');
  assert.equal(f.n(), 4);
  assert.equal(fs.readFileSync(path.join(cache, 'flakes.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('flaky retry: a second fail is a FAIL and registers nothing; RUN_GATES_RETRY_FLAKY=0 never retries', () => {
  const f = flaky(['tests/a.test.mjs :: one']);
  f.setFails(2);
  const repo = flakyRepo();
  const r = runCopy([f.line()], ['--no-cache'], { repo, env: FLAKY_ENV });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^FAIL t \d+s \S+\/t\.retry\.log \(exit 1\)$/m);
  assert.equal(f.n(), 2);
  assert.ok(!fs.existsSync(path.join(r.cache, 'flakes.jsonl')), 'a red that repeated was registered as a flake');
  f.setFails(99);
  const off = runCopy([f.line()], ['--no-cache'], { repo, env: { ...FLAKY_ENV, RUN_GATES_RETRY_FLAKY: '0' } });
  assert.equal(off.status, 1, off.stdout + off.stderr);
  assert.equal(f.n(), 3, 'RUN_GATES_RETRY_FLAKY=0 retried');
});

test('flaky retry: never on a timeout, an instant exit, a missing count line, a touched test file, a file not in the tree or no mainline', () => {
  const once = (why, ids, opts, check) => {
    const f = flaky(ids, opts.fake);
    f.setFails(opts.fails ?? 1);
    const repo = flakyRepo();
    if (opts.prepare) opts.prepare(repo);
    const r = runCopy([opts.line ? opts.line(f) : f.line()], ['--no-cache'], { repo, env: { ...FLAKY_ENV, ...opts.env } });
    assert.equal(f.n(), 1, `${why}: the gate was retried: ${r.stdout}`);
    assert.doesNotMatch(r.stdout, /flaky/, why);
    if (check) check(r);
  };
  const ONE = ['tests/a.test.mjs :: one'];
  once('a timeout', ONE, { fake: { sleep: 3 }, env: { RUN_GATES_GATE_TIMEOUT: '1' } }, (r) => assert.match(r.stdout, /\(timeout after 1s\)/));
  once('an instant exit', ONE, { env: { RUN_GATES_INSTANT_SECS: '10' } }, (r) => assert.match(r.stdout, /\(instant: /));
  once('a missing count line', ONE, { line: (f) => `gate_counted t always '^NEVER' 'bash ${f.fake}'`, fails: 0 }, (r) =>
    assert.match(r.stdout, /\(no count line matched\)/),
  );
  once('an uncommitted edit to the test file', ONE, { prepare: (repo) => fs.appendFileSync(path.join(repo, 'tests', 'a.test.mjs'), 'edit\n') });
  once('a committed edit on the branch', ONE, {
    prepare: (repo) => {
      gitOk(repo, 'checkout', '-q', '-b', 'unit');
      commitFile(repo, 'tests/a.test.mjs', "test('one')\n");
    },
  });
  once('a file not in the tree', ['tests/gone.test.mjs :: gone'], {});
  once('an ignored file the merge base lacks', ['gen/b.test.mjs :: b'], {
    prepare: (repo) => {
      commitFile(repo, '.gitignore', 'gen/\n');
      fs.mkdirSync(path.join(repo, 'gen'));
      fs.writeFileSync(path.join(repo, 'gen', 'b.test.mjs'), "test('b')\n");
    },
  });
  once('a title the file does not spell', ['tests/a.test.mjs :: three'], {});
  once('a failure run-counted could not name', ['?'], {});
  once('two commands in the gate', ONE, { line: (f) => `gate_counted t always '^COUNTED node [1-9][0-9]* passed' 'true && bash ${f.fake}'` });
  once('no mainline', ONE, { env: { RUN_GATES_MAINLINE: '' } });
});

/** The pids of `sleep <secs>` processes: each test below uses its own number, which nothing else starts. */
function sleepersOf(secs) {
  return spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .stdout.split('\n')
    .map((l) => (new RegExp(`^\\s*(\\d+)\\s+sleep ${secs}$`).exec(l) || [])[1])
    .filter(Boolean)
    .map(Number);
}
/** Waits up to 15 s for no `sleep <secs>` to be left. */
function noSleepers(secs, why) {
  const end = Date.now() + 15000;
  while (sleepersOf(secs).length > 0 && Date.now() < end) sleepMs(100);
  assert.deepEqual(sleepersOf(secs), [], why);
}
/** A result line with its seconds and log path dropped, so runs at different GATE_JOBS compare. */
const shape = (l) => l.replace(/^(PASS|FAIL|KNOWN) (\S+) \d+s \S+/, '$1 $2').replace(/ \(instant: .*\)$/, '');

test('parallel: GATE_JOBS runs gates at once and prints them in registration order, as GATE_JOBS=1 would', () => {
  const dir = tmp('run-gates-par-');
  const mark = path.join(dir, 'b-ran');
  // a waits for b: one at a time, a would give up after 10 s and fail
  const wait = `n=0; while [ ! -f ${mark} ]; do n=$((n + 1)); [ $n -lt 100 ] || exit 7; sleep 0.1; done`;
  const lines = [`gate a always '${wait}'`, `gate b always 'touch ${mark}'`, "gate c always 'true'", "gate d full 'true'"];
  const r = runCopy(lines, ['--no-cache'], { env: { RUN_GATES_GATE_JOBS: '3' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const gates = r.lines.filter((l) => /^(PASS|FAIL|SKIP) /.test(l));
  assert.deepEqual(gates.map(shape), ['PASS a', 'PASS b', 'PASS c', 'PASS d']);
  assert.equal(r.lines.at(-1), 'SUMMARY 4 passed, 0 failed, 0 skipped (full)');
  const seq = runCopy(["gate a always 'true'", "gate b always 'exit 4'", "gate c always 'true'", "gate d full 'true'"], ['--since', 'HEAD', '--no-cache'], { scoped: '.*' });
  const par = runCopy(["gate a always 'true'", "gate b always 'exit 4'", "gate c always 'true'", "gate d full 'true'"], ['--since', 'HEAD', '--no-cache'], {
    repo: seq.repo,
    scoped: '.*',
    env: { RUN_GATES_GATE_JOBS: '2' },
  });
  assert.equal(par.status, seq.status, 'the exit status differs from a GATE_JOBS=1 run');
  assert.equal(seq.status, 1);
  assert.deepEqual(par.lines.slice(1).map(shape), seq.lines.slice(1).map(shape), `GATE_JOBS=2 printed other lines than 1:\n${par.stdout}\n${seq.stdout}`);
  assert.deepEqual(seq.lines.slice(1).map(shape), ['SCOPED: nothing changed since HEAD', 'PASS a', 'FAIL b (exit 4)', 'PASS c', 'SKIP d (full only)', 'SUMMARY 2 passed, 1 failed, 1 skipped (scoped)']);
});

test('parallel: a timeout in one gate is its FAIL alone; its group is gone; the others print their own results', () => {
  const lines = ["gate hang always 'sh -c \"sleep 66 & sleep 66\"'", "gate ok always 'true'", "gate bad always 'exit 3'"];
  const r = runCopy(lines, ['--no-cache'], { env: { RUN_GATES_GATE_JOBS: '3', RUN_GATES_GATE_TIMEOUT: '1' } });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const gates = r.lines.filter((l) => /^(PASS|FAIL) /.test(l));
  assert.deepEqual(gates.map(shape), ['FAIL hang (timeout after 1s)', 'PASS ok', 'FAIL bad (exit 3)']);
  assert.equal(r.lines.at(-1), 'SUMMARY 1 passed, 2 failed, 0 skipped (full)');
  noSleepers(66, "the timed-out gate's group outlived it");
  assert.deepEqual(
    fs.readdirSync(r.lines[0].replace(/^logs: /, '')).filter((f) => f.startsWith('.job-')),
    [],
    'a worker result file was left in the log dir',
  );
});

test('parallel: a SERIAL gate starts once the running gates end, and none starts while it runs; a SERIAL name that is no gate exits 99', () => {
  const ev = path.join(tmp('run-gates-serial-'), 'events');
  const g = (name) => `gate ${name} always 'echo start ${name} >> ${ev}; sleep 0.5; echo end ${name} >> ${ev}'`;
  const r = runCopy([g('a'), g('s'), g('b'), g('c')], ['--no-cache'], { env: { RUN_GATES_GATE_JOBS: '4', RUN_GATES_SERIAL: '\ts\n' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const e = fs.readFileSync(ev, 'utf8').trim().split('\n');
  const at = (x) => e.indexOf(x);
  assert.ok(at('end a') < at('start s'), `s started while a ran: ${e.join(', ')}`);
  assert.ok(at('end s') < at('start b') && at('end s') < at('start c'), `a gate started while s ran: ${e.join(', ')}`);
  assert.ok(at('start c') < at('end b'), `b and c after s did not run at once: ${e.join(', ')}`);
  assert.deepEqual(r.lines.filter((l) => /^PASS /.test(l)).map(shape), ['PASS a', 'PASS s', 'PASS b', 'PASS c']);
  const bad = runCopy([g('a')], ['--no-cache'], { env: { RUN_GATES_SERIAL: 'a nope' } });
  assert.equal(bad.status, 99, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /SERIAL names nope, which is no gate/);
});

test('parallel: TERM to run-gates stops every running gate group and exits 143', () => {
  const dir = tmp('run-gates-par-term-');
  const [s1, s2, out] = ['s1', 's2', 'out'].map((f) => path.join(dir, f));
  const lines = [`gate x always 'touch ${s1}; sh -c "sleep 67 & sleep 67"'`, `gate y always 'touch ${s2}; sleep 67'`];
  const r = runCopy(lines, ['--no-cache'], { env: { RUN_GATES_GATE_JOBS: '2' }, out: [out, out] });
  try {
    waitFor(s1);
    waitFor(s2);
    const exited = new Promise((resolve) => r.child.on('exit', (code, sig) => resolve(code ?? sig)));
    r.child.kill('SIGTERM');
    noSleepers(67, 'TERM left a gate running');
    return exited.then((code) => assert.equal(code, 143, fs.readFileSync(out, 'utf8')));
  } finally {
    setTimeout(() => r.child.kill('SIGKILL'), 20000).unref();
  }
});

test('watchdog: a run-gates killed with KILL (no trap runs) still has its gate stopped within seconds', async () => {
  const dir = tmp('run-gates-orphan-');
  const [started, out] = ['started', 'out'].map((f) => path.join(dir, f));
  for (const jobs of ['1', '2']) {
    fs.rmSync(started, { force: true });
    const r = runCopy([`gate x always 'touch ${started}; sleep 68'`], ['--no-cache'], { env: { RUN_GATES_GATE_JOBS: jobs, RUN_GATES_GATE_TIMEOUT: '600' }, out: [out, out] });
    waitFor(started);
    // awaited: until node reaps it, the KILLed run-gates is a zombie, and a zombie answers kill -0
    const exited = new Promise((resolve) => r.child.on('exit', resolve));
    r.child.kill('SIGKILL');
    await exited;
    noSleepers(68, `GATE_JOBS=${jobs}: the gate outlived a KILLed run-gates`);
  }
});

test('usage: a gate name registered twice, and a PRODUCT_PATHS or RECORDS that matches an empty path, exit 99 before anything runs', () => {
  const h = counter();
  const twice = runCopy([h.gate('t'), h.gate('t')], ['--no-cache']);
  assert.equal(twice.status, 99, twice.stdout + twice.stderr);
  assert.match(twice.stderr, /gate 't' is registered twice/);
  for (const [name, env] of [
    ['RECORDS', { RUN_GATES_RECORDS: '.*' }],
    ['RECORDS', { RUN_GATES_RECORDS: '(\\.state\\.md)?$' }],
    ['PRODUCT_PATHS', { RUN_GATES_PRODUCT_PATHS: 'x*' }],
  ]) {
    const r = runCopy([h.gate('t')], ['--no-cache'], { env });
    assert.equal(r.status, 99, `${JSON.stringify(env)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`${name} matches an empty path, so every path`));
  }
  assert.equal(h.n(), 0, 'a gate ran');
});

test('paths: --snapshot decides on the commit: a product-only commit skips the paths gate, a committed path outside runs it', () => {
  const h = counter();
  const lines = [h.gate('h', 'paths')];
  const env = { RUN_GATES_PRODUCT_PATHS: '^src/' };
  const repo = newRepo();
  gitOk(repo, 'checkout', '-q', '-b', 'unit');
  commitFile(repo, 'src/a.js', 'a\n');
  fs.writeFileSync(path.join(repo, 'tool.sh'), 'untracked: not in the snapshot\n');
  const skip = runCopy(lines, ['--snapshot', '--no-cache'], { repo, env });
  assert.equal(skip.status, 0, skip.stdout + skip.stderr);
  assert.ok(skip.lines.some((l) => SKIP_PATHS_RX.test(l)), skip.stdout);
  assert.equal(h.n(), 0);
  commitFile(repo, 'tool.sh', 'outside\n');
  const run = runCopy(lines, ['--snapshot', '--no-cache'], { repo, env });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.doesNotMatch(run.stdout, /^SKIP /m);
  assert.equal(h.n(), 1);
});
