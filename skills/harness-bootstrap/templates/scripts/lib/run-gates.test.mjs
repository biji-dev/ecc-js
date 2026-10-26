// harness-bootstrap run-gates tests (generated YYYY-MM-DD). Run: node --test scripts/lib/run-gates.test.mjs
// [M] mechanism (ships as-is): every test. They test the INSTALLED scripts/run-gates.sh: its gate
// block is read by bash itself, every count regex runs through grep -E (the script's own engine),
// and the runner runs as a copy in a throwaway repo with its gate block replaced by stubs, so no
// project gate runs here.
// [B] binding: UNCOUNTED, the counted gates whose count is not a test runner's (run-counted does
// not apply to them).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('RUN_GATES_')));
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

/** A copy of the runner, its gate block replaced by `lines`, run in a throwaway repo with one commit. */
function runCopy(lines, args, prepare = () => {}) {
  const repo = tmp('run-gates-repo-');
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8', env: ENV });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), '0\n');
  git('add', 'a.txt');
  assert.equal(git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init').status, 0);
  prepare(repo);
  const copy = path.join(tmp('run-gates-copy-'), 'run-gates.sh');
  // A replacer function, not a string: a gate line may hold `$'`, a replacement pattern.
  fs.writeFileSync(copy, SOURCE.replace(BLOCK, () => ['# >>> harness:gates', ...lines, '# <<< harness:gates'].join('\n')));
  const env = { ...ENV, RUN_GATES_LOG_DIR: tmp('run-gates-logs-'), RUN_GATES_CACHE_DIR: tmp('run-gates-cache-'), RUN_GATES_SNAPSHOT_COPY: '' };
  return spawnSync('bash', [copy, ...args], { cwd: repo, encoding: 'utf8', env });
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
    for (const bad of [`run-counted: FAIL 1 skipped (must be 0)\n`, `run-counted: FAIL no ${kind} summary line\n`]) {
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
