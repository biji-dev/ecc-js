/**
 * Tests for skills/harness-bootstrap/templates/run-gates.sh (biji-dev/ecc-js):
 * the never-bail verification runner, its result lines, exit status and scoped mode.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TEMPLATE = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'run-gates.sh');

/**
 * Hermetic git env for every spawn: all inherited GIT_* variables are dropped first (a stray
 * GIT_DIR or GIT_INDEX_FILE would redirect the fixtures), then no global or system config
 * (and so no global hooks) is read. `extra` is applied last.
 */
function gitEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return { ...env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', ...extra };
}

const OPEN_MARKER = '# >>> harness:gates';
const CLOSE_MARKER = '# <<< harness:gates';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** Replace ONLY the text between the two gate markers, keeping the marker lines. */
function withGates(source, gates) {
  const open = source.indexOf(OPEN_MARKER);
  const close = source.indexOf(CLOSE_MARKER);
  assert.ok(open !== -1 && close > open, 'template has both harness:gates markers');
  const afterOpen = source.indexOf('\n', open) + 1;
  const out = source.slice(0, afterOpen) + gates.map(g => `${g}\n`).join('') + source.slice(close);
  assert.notStrictEqual(out, source, 'gate replacement applied');
  assert.ok(out.includes(gates[0]), 'new gate text present');
  return out;
}

/** A temp git repo with one commit; the runner (given text) is committed at scripts/run-gates.sh. */
function makeRepo(runnerText) {
  const dir = tmp('run-gates-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.hooksPath', os.devNull);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'run-gates.sh'), runnerText);
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

/**
 * Runs the runner in `repo`. By default the result cache is off and instant-failure notes are
 * off, so one test's earlier run never answers another's and FAIL lines keep the plain shape;
 * pass `cache: true` to use the real cache, and `env` to override anything.
 */
function runnerEnv(repo, args, { logDir, env: extraEnv, cache } = {}) {
  const base = { RUN_GATES_INSTANT_SECS: '0' };
  if (!cache) base.RUN_GATES_NO_CACHE = '1';
  const env = gitEnv({ ...base, ...extraEnv });
  delete env.RUN_GATES_LOG_DIR;
  if (cache && !(extraEnv && 'RUN_GATES_NO_CACHE' in extraEnv)) delete env.RUN_GATES_NO_CACHE;
  if (logDir) env.RUN_GATES_LOG_DIR = logDir;
  return { cmd: ['bash', [path.join(repo, 'scripts', 'run-gates.sh'), ...args]], env };
}

function run(repo, args, opts = {}) {
  const { cmd, env } = runnerEnv(repo, args, opts);
  const r = spawnSync(cmd[0], cmd[1], { cwd: repo, env, encoding: 'utf8' });
  const lines = r.stdout.split('\n').filter(l => l !== '');
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, lines };
}

const SOURCE = fs.readFileSync(TEMPLATE, 'utf8');

/** Gates for the never-bail case; `marker` is touched by `ok` so tests can see it ran. */
function neverBailGates(markerFile) {
  return [
    "gate bad always 'echo bad-out; echo bad-err >&2; exit 3'",
    `gate ok always 'echo ok-out; touch ${markerFile}'`,
    "gate bad2 always 'false'",
  ];
}

// ── template shape ───────────────────────────────────────────────────────────

console.log('\nrun-gates.sh: template');

test('template parses with bash -n', () => {
  const r = spawnSync('bash', ['-n', TEMPLATE], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('template has header, markers, SCOPED_PATHS and default gates', () => {
  const lines = SOURCE.split('\n');
  assert.strictEqual(lines[0], '#!/usr/bin/env bash');
  assert.ok(/^# harness-bootstrap run-gates \(generated YYYY-MM-DD\)$/.test(lines[1]), 'header line');
  assert.ok(SOURCE.includes('# >>> harness:gates [B] — one line per gate: gate <name> <always|full> \'<command>\''));
  assert.ok(SOURCE.includes('# <<< harness:gates'));
  assert.ok(SOURCE.includes("SCOPED_PATHS='^(src|apps|packages|lib|docs|tests?)/|\\.md$'"));
  for (const g of [
    "gate typecheck always 'npm run -s typecheck'",
    "gate lint always 'npm run -s lint'",
    "gate test always 'npm test'",
    "gate build full 'npm run -s build'",
  ]) {
    assert.ok(SOURCE.includes(g), `default gate: ${g}`);
  }
  assert.ok(!/^set -e/m.test(SOURCE), 'never set -e');
});

test('--list prints each gate and mode, exit 0', () => {
  const repo = makeRepo(withGates(SOURCE, ["gate a always 'true'", "gate b full 'true'"]));
  const r = run(repo, ['--list']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.lines, ['a always', 'b full']);
});

// ── full run ─────────────────────────────────────────────────────────────────

console.log('\nrun-gates.sh: full run');

const fullDir = tmp('run-gates-full-');
const fullMarker = path.join(fullDir, 'ok-ran');
const fullRepo = makeRepo(withGates(SOURCE, neverBailGates(fullMarker)));
const fullLogs = path.join(fullDir, 'logs');
const full = run(fullRepo, [], { logDir: fullLogs });

test('never bails: exit 2, lines in registration order, ok ran after bad failed', () => {
  assert.strictEqual(full.status, 2, full.stdout + full.stderr);
  assert.strictEqual(full.lines[0], `logs: ${fullLogs}`);
  assert.ok(/^FAIL bad \d+s \S+bad\.log \(exit 3\)$/.test(full.lines[1]), full.lines[1]);
  assert.ok(/^PASS ok \d+s \S+ok\.log$/.test(full.lines[2]), full.lines[2]);
  assert.ok(/^FAIL bad2 \d+s \S+bad2\.log \(exit 1\)$/.test(full.lines[3]), full.lines[3]);
  assert.strictEqual(full.lines[4], 'SUMMARY 1 passed, 2 failed, 0 skipped (full)');
  assert.strictEqual(full.lines.length, 5);
  assert.ok(fs.existsSync(fullMarker), 'ok ran although bad failed first');
});

test('each gate has a log file holding its output', () => {
  const bad = fs.readFileSync(path.join(fullLogs, 'bad.log'), 'utf8');
  assert.ok(bad.includes('bad-out') && bad.includes('bad-err'), 'stdout and stderr captured');
  assert.ok(fs.readFileSync(path.join(fullLogs, 'ok.log'), 'utf8').includes('ok-out'));
  assert.ok(fs.existsSync(path.join(fullLogs, 'bad2.log')));
});

test('default log dir is created under .review-work/verify and printed first', () => {
  const repo = makeRepo(withGates(SOURCE, ["gate a always 'true'"]));
  const r = run(repo, []);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const m = r.lines[0].match(/^logs: (\.review-work\/verify\/\d{8}T\d{6}-\d+)$/);
  assert.ok(m, r.lines[0]);
  assert.ok(fs.existsSync(path.join(repo, m[1], 'a.log')));
});

// ── scoped mode ──────────────────────────────────────────────────────────────

console.log('\nrun-gates.sh: --since');

const SCOPED_GATES = [
  "gate quick always 'echo mode=$RUN_GATES_MODE since=$RUN_GATES_SINCE'",
  "gate slow full 'echo slow ran'",
];

test('--since HEAD with only an untracked src file: scoped, full gate SKIPs, list has the file', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'new.ts'), 'export {};\n');
  const r = run(repo, ['--since', 'HEAD']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.lines.includes('SKIP slow (full only)'), r.stdout);
  assert.ok(!r.stdout.includes('PROMOTED'), r.stdout);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 1 passed, 0 failed, 1 skipped (scoped)');
  const logsDir = path.join(repo, r.lines[0].replace(/^logs: /, ''));
  const changed = fs.readFileSync(path.join(logsDir, 'changed-files.txt'), 'utf8').split('\n').filter(Boolean);
  assert.deepStrictEqual(changed, ['src/new.ts']);
});

test('a second scoped run does not count the first run\'s logs as a change', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'new.ts'), 'export {};\n');
  run(repo, ['--since', 'HEAD']);
  const r = run(repo, ['--since', 'HEAD']);
  assert.ok(!r.stdout.includes('PROMOTED'), r.stdout);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 1 passed, 0 failed, 1 skipped (scoped)');
});

test('RUN_GATES_MODE and RUN_GATES_SINCE are visible to a gate command', () => {
  const logs = path.join(tmp('run-gates-env-'), 'logs');
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export {};\n');
  const r = run(repo, ['--since', 'HEAD'], { logDir: logs });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(fs.readFileSync(path.join(logs, 'quick.log'), 'utf8').trim(), 'mode=scoped since=HEAD');
  const f = run(repo, [], { logDir: path.join(logs, 'full') });
  assert.strictEqual(fs.readFileSync(path.join(logs, 'full', 'quick.log'), 'utf8').trim(), 'mode=full since=');
  assert.strictEqual(f.status, 0);
});

test('RUN_GATES_CHANGED_FILE points at the changed-file list in scoped mode', () => {
  const logs = path.join(tmp('run-gates-cf-'), 'logs');
  const repo = makeRepo(withGates(SOURCE, ["gate show always 'cat \"$RUN_GATES_CHANGED_FILE\"'"]));
  fs.writeFileSync(path.join(repo, 'README.md'), '# changed\n');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'b.ts'), 'export {};\n');
  const r = run(repo, ['--since', 'HEAD'], { logDir: logs });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const seen = fs.readFileSync(path.join(logs, 'show.log'), 'utf8').split('\n').filter(Boolean).sort();
  assert.deepStrictEqual(seen, ['README.md', 'src/b.ts']);
});

test('a change outside the scoped paths promotes the run to FULL', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'infra'));
  fs.writeFileSync(path.join(repo, 'infra', 'x.yml'), 'a: 1\n');
  const r = run(repo, ['--since', 'HEAD']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.lines.includes('PROMOTED to FULL: infra/x.yml'), r.stdout);
  assert.ok(r.lines.some(l => /^PASS slow /.test(l)), 'full gate ran');
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 2 passed, 0 failed, 0 skipped (full)');
});

test('nothing changed: says so and still runs the always gates', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  const r = run(repo, ['--since', 'HEAD']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.lines.includes('SCOPED: nothing changed since HEAD'), r.stdout);
  assert.ok(r.lines.some(l => /^PASS quick /.test(l)));
  assert.ok(r.lines.includes('SKIP slow (full only)'));
});

test('committed changes since a ref count too', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'c.ts'), 'export {};\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'add c');
  const r = run(repo, ['--since', 'HEAD~1']);
  assert.ok(!r.stdout.includes('nothing changed'), r.stdout);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 1 passed, 0 failed, 1 skipped (scoped)');
});

function changedList(repo, r) {
  const logsDir = path.resolve(repo, r.lines[0].replace(/^logs: /, ''));
  return fs.readFileSync(path.join(logsDir, 'changed-files.txt'), 'utf8').split('\n').filter(Boolean);
}

test('a ref named like a path (tag docs and directory docs/) is read as the ref', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'docs', 'a.md'), '# a\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'docs');
  git(repo, 'tag', 'docs', 'HEAD~1');
  fs.mkdirSync(path.join(repo, 'infra'));
  fs.writeFileSync(path.join(repo, 'infra', 'x.yml'), 'a: 1\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'infra');
  const r = run(repo, ['--since', 'docs']);
  assert.ok(!r.stdout.includes('nothing changed'), r.stdout);
  assert.ok(r.lines.includes('PROMOTED to FULL: infra/x.yml'), r.stdout + r.stderr);
});

test('a log dir name with regex metacharacters does not hide changes (fail-open)', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'infra'));
  fs.writeFileSync(path.join(repo, 'infra', 'x.yml'), 'a: 1\n');
  const r = run(repo, ['--since', 'HEAD'], { logDir: 'logs[x' });
  assert.ok(!r.stdout.includes('nothing changed'), r.stdout);
  assert.ok(r.lines.includes('PROMOTED to FULL: infra/x.yml'), r.stdout + r.stderr);
});

test('the log dir is filtered by literal prefix, not as a pattern', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'lxgs'));
  fs.writeFileSync(path.join(repo, 'lxgs', 'q.txt'), 'q\n');
  const r = run(repo, ['--since', 'HEAD'], { logDir: 'l.gs' });
  assert.ok(r.lines.includes('PROMOTED to FULL: lxgs/q.txt'), r.stdout + r.stderr);
});

test('a git failure while listing changes exits 99 instead of reading as nothing changed', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.writeFileSync(path.join(repo, '.git', 'index'), 'not an index');
  const r = run(repo, ['--since', 'HEAD']);
  assert.strictEqual(r.status, 99, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes('nothing changed'), r.stdout);
  assert.ok(r.stderr.length > 0, 'a message on stderr');
  assert.ok(!r.lines.some(l => /^(PASS|FAIL) /.test(l)), 'no gate ran');
});

test('a non-ASCII path is listed as written and is not promoted to FULL', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'café.ts'), 'export {};\n');
  const r = run(repo, ['--since', 'HEAD']);
  assert.ok(!r.stdout.includes('PROMOTED'), r.stdout);
  assert.deepStrictEqual(changedList(repo, r), ['src/café.ts']);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 1 passed, 0 failed, 1 skipped (scoped)');
});

/** A `git` shim first on PATH that fails for one subcommand and runs the real git otherwise. */
function failingGitEnv(subcommand) {
  const realGit = (process.env.PATH || '')
    .split(path.delimiter)
    .map(d => path.join(d, 'git'))
    .find(p => fs.existsSync(p));
  assert.ok(realGit, 'a real git is on PATH');
  const bin = tmp('run-gates-shim-');
  const shim = [
    '#!/bin/sh',
    'for a in "$@"; do',
    `  if [ "$a" = '${subcommand}' ]; then echo "shim: ${subcommand} failed" >&2; exit 2; fi`,
    'done',
    `exec '${realGit}' "$@"`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(bin, 'git'), shim, { mode: 0o755 });
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

test('a failing git diff alone exits 99 instead of reading as nothing changed', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  // The base commit exists (the ref check passes) but its tree is gone, so only the diff fails.
  const tree = git(repo, 'rev-parse', 'HEAD^{tree}').trim();
  fs.rmSync(path.join(repo, '.git', 'objects', tree.slice(0, 2), tree.slice(2)));
  assert.strictEqual(git(repo, 'ls-files', '--others', '--exclude-standard'), '', 'ls-files still works');
  const r = run(repo, ['--since', 'HEAD']);
  assert.strictEqual(r.status, 99, r.stdout + r.stderr);
  assert.ok(r.stderr.includes('git diff against HEAD failed'), r.stderr);
  assert.ok(!r.stdout.includes('nothing changed'), r.stdout);
  assert.ok(!r.lines.some(l => /^(PASS|FAIL) /.test(l)), 'no gate ran');
});

test('a failing git ls-files alone exits 99 instead of dropping the untracked files', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'infra'));
  fs.writeFileSync(path.join(repo, 'infra', 'u.yml'), 'a: 1\n');
  const r = run(repo, ['--since', 'HEAD'], { env: failingGitEnv('ls-files') });
  assert.strictEqual(r.status, 99, r.stdout + r.stderr);
  assert.ok(r.stderr.includes('git ls-files failed'), r.stderr);
  assert.ok(!r.stdout.includes('nothing changed') && !r.stdout.includes('PROMOTED'), r.stdout);
  assert.ok(!r.lines.some(l => /^(PASS|FAIL) /.test(l)), 'no gate ran');
  // Control: the same shim for a subcommand the runner does not use changes nothing.
  const ok = run(repo, ['--since', 'HEAD'], { env: failingGitEnv('no-such-subcommand') });
  assert.ok(ok.lines.includes('PROMOTED to FULL: infra/u.yml'), ok.stdout + ok.stderr);
});

test('a relative log dir inside the repo never counts as a change (two runs)', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'new.ts'), 'export {};\n');
  run(repo, ['--since', 'HEAD'], { logDir: 'mylogs' });
  assert.ok(fs.existsSync(path.join(repo, 'mylogs', 'changed-files.txt')), 'first run left logs in the repo');
  const r = run(repo, ['--since', 'HEAD'], { logDir: 'mylogs' });
  assert.ok(!r.stdout.includes('PROMOTED'), r.stdout);
  assert.deepStrictEqual(changedList(repo, r), ['src/new.ts']);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 1 passed, 0 failed, 1 skipped (scoped)');
});

test('an absolute log dir inside the repo never counts as a change (two runs)', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'new.ts'), 'export {};\n');
  const logs = path.join(repo, 'abslogs');
  run(repo, ['--since', 'HEAD'], { logDir: logs });
  assert.ok(fs.existsSync(path.join(logs, 'changed-files.txt')), 'first run left logs in the repo');
  const r = run(repo, ['--since', 'HEAD'], { logDir: logs });
  assert.ok(!r.stdout.includes('PROMOTED'), r.stdout);
  assert.deepStrictEqual(changedList(repo, r), ['src/new.ts']);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 1 passed, 0 failed, 1 skipped (scoped)');
});

test('a rename out of a non-scoped path is seen as its old path and promotes to FULL', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'infra'));
  fs.writeFileSync(path.join(repo, 'infra', 'k.ts'), 'export const k = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'infra k');
  fs.mkdirSync(path.join(repo, 'src'));
  git(repo, 'mv', 'infra/k.ts', 'src/k.ts');
  const r = run(repo, ['--since', 'HEAD']);
  assert.ok(r.lines.includes('PROMOTED to FULL: infra/k.ts'), r.stdout + r.stderr);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 2 passed, 0 failed, 0 skipped (full)');
});

test('a tracked non-ASCII path changed since the base is listed as written and stays scoped', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'café.ts'), 'export const a = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'cafe');
  fs.writeFileSync(path.join(repo, 'src', 'café.ts'), 'export const a = 2;\n');
  const r = run(repo, ['--since', 'HEAD']);
  assert.ok(!r.stdout.includes('PROMOTED'), r.stdout + r.stderr);
  assert.deepStrictEqual(changedList(repo, r), ['src/café.ts']);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 1 passed, 0 failed, 1 skipped (scoped)');
});

test('a path that is both in git diff and untracked is listed once', () => {
  const repo = makeRepo(withGates(SOURCE, SCOPED_GATES));
  git(repo, 'rm', '-q', '--cached', 'README.md');
  const r = run(repo, ['--since', 'HEAD']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(changedList(repo, r), ['README.md']);
});

// ── usage errors ─────────────────────────────────────────────────────────────

console.log('\nrun-gates.sh: usage errors');

test('bad flag exits 99 with a message on stderr', () => {
  const repo = makeRepo(withGates(SOURCE, ["gate a always 'true'"]));
  const r = run(repo, ['--bogus']);
  assert.strictEqual(r.status, 99);
  assert.ok(r.stderr.includes('unknown argument'), r.stderr);
});

test('--since with an unknown ref or no ref exits 99', () => {
  const repo = makeRepo(withGates(SOURCE, ["gate a always 'true'"]));
  const bad = run(repo, ['--since', 'nonexistent-ref']);
  assert.strictEqual(bad.status, 99);
  assert.ok(bad.stderr.includes('unknown ref'), bad.stderr);
  const none = run(repo, ['--since']);
  assert.strictEqual(none.status, 99);
});

test('outside a git repository exits 99', () => {
  const dir = tmp('run-gates-nogit-');
  const script = path.join(dir, 'run-gates.sh');
  fs.writeFileSync(script, withGates(SOURCE, ["gate a always 'true'"]));
  const env = gitEnv({ GIT_CEILING_DIRECTORIES: path.dirname(dir) });
  const r = spawnSync('bash', [script], { cwd: dir, env, encoding: 'utf8' });
  assert.strictEqual(r.status, 99, r.stdout + r.stderr);
});

test('an invalid gate mode exits 99', () => {
  const repo = makeRepo(withGates(SOURCE, ["gate a sometimes 'true'"]));
  const r = run(repo, ['--list']);
  assert.strictEqual(r.status, 99);
});

test('--since with an empty ref exits 99', () => {
  const repo = makeRepo(withGates(SOURCE, ["gate a always 'true'"]));
  const r = run(repo, ['--since', '']);
  assert.strictEqual(r.status, 99, r.stdout + r.stderr);
  assert.ok(!r.lines.some(l => /^(PASS|FAIL) /.test(l)), 'no gate ran');
});

test('a gate line with the wrong argument count or an empty command exits 99 naming the gate', () => {
  for (const line of ["gate t always make test", "gate t always ''", "gate t always", "gate t always 'true' extra"]) {
    const repo = makeRepo(withGates(SOURCE, [line]));
    const r = run(repo, ['--list']);
    assert.strictEqual(r.status, 99, `${line}: ${r.stdout}${r.stderr}`);
    assert.ok(r.stderr.includes("gate 't'"), `${line}: ${r.stderr}`);
  }
});

test('two runs in the same second get different default log dirs', () => {
  const repo = makeRepo(withGates(SOURCE, ["gate a always 'true'"]));
  const a = run(repo, []).lines[0];
  const b = run(repo, []).lines[0];
  assert.notStrictEqual(a, b);
});

test('99 or more failing gates cap the exit status at 98', () => {
  const gates = [];
  for (let n = 0; n < 100; n += 1) gates.push(`gate f${n} always 'false'`);
  const repo = makeRepo(withGates(SOURCE, gates));
  const r = run(repo, []);
  assert.strictEqual(r.status, 98, r.stdout + r.stderr);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 0 passed, 100 failed, 0 skipped (full)');
});

// ── counted gates ────────────────────────────────────────────────────────────

console.log('\nrun-gates.sh: gate_counted');

// Runners print an info glyph (U+2139) before the count; built here so no pictograph is in the file.
const INFO = String.fromCodePoint(0x2139);
const COUNT_RX = `(${INFO}|#) pass [1-9]`;

/** A node:test file with `pass` passing tests and `skip` skipped ones. */
function nodeTestFile(dir, pass, skip) {
  const lines = ["const t = require('node:test');"];
  for (let n = 0; n < pass; n += 1) lines.push(`t.test('p${n}', () => {});`);
  for (let n = 0; n < skip; n += 1) lines.push(`t.test.skip('s${n}', () => {});`);
  const file = path.join(dir, 'sample.test.js');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

function countedOutcome(command, extraLines = []) {
  const logs = path.join(tmp('run-gates-cnt-'), 'logs');
  const repo = makeRepo(withGates(SOURCE, [`gate_counted t always '${COUNT_RX}' '${command}'`, ...extraLines]));
  const r = run(repo, [], { logDir: logs });
  return { r, logs, repo };
}

test('gate_counted: a runner that ran zero tests (exit 0) FAILs with the no-count message', () => {
  const { r, logs } = countedOutcome(`echo "${INFO} tests 0"; echo "${INFO} pass 0"`);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/^FAIL t \d+s \S+t\.log \(no count line matched\)$/.test(r.lines[1]), r.lines[1]);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 0 passed, 1 failed, 0 skipped (full)');
  assert.ok(fs.readFileSync(path.join(logs, 't.log'), 'utf8').includes('pass 0'), 'log holds the output');
});

test('gate_counted: node --test with every test skipped (exit 0) FAILs', () => {
  const dir = tmp('run-gates-skip-');
  const file = nodeTestFile(dir, 0, 2);
  const direct = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8' });
  assert.strictEqual(direct.status, 0, 'precondition: node --test exits 0 with only skipped tests');
  const { r } = countedOutcome(`${process.execPath} --test ${file}`);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/^FAIL t .*\(no count line matched\)$/.test(r.lines[1]), r.lines[1]);
});

test('gate_counted: node --test with 3 passing tests PASSes', () => {
  const dir = tmp('run-gates-pass3-');
  const file = nodeTestFile(dir, 3, 0);
  const { r } = countedOutcome(`${process.execPath} --test ${file}`);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/^PASS t \d+s \S+t\.log$/.test(r.lines[1]), r.lines[1]);
  assert.strictEqual(r.lines[r.lines.length - 1], 'SUMMARY 1 passed, 0 failed, 0 skipped (full)');
});

test('gate_counted: a command that exits 1 with a matching line FAILs with its exit code', () => {
  const { r } = countedOutcome(`echo "${INFO} pass 3"; exit 1`);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/^FAIL t \d+s \S+t\.log \(exit 1\)$/.test(r.lines[1]), r.lines[1]);
});

test('gate_counted: stderr counts as output, and plain gates around it are unaffected', () => {
  const { r } = countedOutcome('echo "# pass 2" >&2', ["gate z always 'true'"]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/^PASS t /.test(r.lines[1]) && /^PASS z /.test(r.lines[2]), r.stdout);
});

test('gate_counted: --list shows it like any gate, and scoped mode skips a full one', () => {
  const repo = makeRepo(withGates(SOURCE, ["gate_counted a always 'x' 'true'", "gate_counted b full 'x' 'true'"]));
  const list = run(repo, ['--list']);
  assert.deepStrictEqual(list.lines, ['a always', 'b full']);
  const scoped = run(repo, ['--since', 'HEAD']);
  assert.ok(scoped.lines.includes('SKIP b (full only)'), scoped.stdout);
});

test('gate_counted: wrong arg count, empty regex or command, bad mode or bad regex exits 99 naming the gate', () => {
  const bad = [
    "gate_counted t always 'x'",
    "gate_counted t always 'x' 'true' extra",
    "gate_counted t always '' 'true'",
    "gate_counted t always 'x' ''",
    "gate_counted t sometimes 'x' 'true'",
    "gate_counted t always '[' 'true'",
  ];
  for (const line of bad) {
    const repo = makeRepo(withGates(SOURCE, [line]));
    const r = run(repo, ['--list']);
    assert.strictEqual(r.status, 99, `${line}: ${r.stdout}${r.stderr}`);
    assert.ok(r.stderr.includes("gate 't'"), `${line}: ${r.stderr}`);
  }
});

// ── result cache, single-flight lock, instant failures ───────────────────────

console.log('\nrun-gates.sh: result cache, lock and instant failures');

const REUSED_RX = /^REUSED [0-9a-f]{40} \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const DOCS = { RUN_GATES_DOCS_ONLY: '\\.md$|^docs/' }; // docs-only reuse is opt-in
const DOCS_ONLY_RX = /^REUSED [0-9a-f]{40} docs-only change since \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

/** How many times a gate appended to `file`. */
function count(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForFile(file, ms = 10000) {
  const end = Date.now() + ms;
  while (!fs.existsSync(file)) {
    assert.ok(Date.now() < end, `timed out waiting for ${file}`);
    sleepMs(50);
  }
}

/** Starts a run in the background, stdout and stderr going to one file; returns { child, out }. */
function spawnRun(repo, args, opts = {}) {
  const { cmd, env } = runnerEnv(repo, args, opts);
  const out = path.join(tmp('run-gates-out-'), 'out');
  const fd = fs.openSync(out, 'w');
  const child = spawn(cmd[0], cmd[1], { cwd: repo, env, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  return { child, out };
}

function waitForText(file, text, ms = 15000) {
  const end = Date.now() + ms;
  while (!(fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(text))) {
    assert.ok(Date.now() < end, `timed out waiting for "${text}" in ${file}`);
    sleepMs(50);
  }
}

/** True once no lock directory is left, i.e. the run holding it has exited. */
function waitLocksGone(repo, ms = 15000) {
  const locks = path.join(repo, '.git', 'run-gates-cache', 'locks');
  const end = Date.now() + ms;
  while (fs.existsSync(locks) && fs.readdirSync(locks).length > 0) {
    assert.ok(Date.now() < end, 'timed out waiting for the lock to be released');
    sleepMs(50);
  }
}

/** A repo whose one gate appends a line to a counter file kept outside the repo. */
function counterRepo(gateBody = '') {
  const dir = tmp('run-gates-cache-');
  const counter = path.join(dir, 'count');
  const repo = makeRepo(withGates(SOURCE, [`gate t always '${gateBody}echo x >> ${counter}'`, "gate u full 'true'"]));
  return { dir, counter, repo };
}

test('header documents the cache, the lock and the instant note', () => {
  const header = SOURCE.slice(0, SOURCE.indexOf('set -u'));
  const words = ['--no-cache', 'REUSED', 'docs-only', 'WAITING for run', 'RUN_GATES_CACHE_DIR', 'instant:',
    'NOT CACHED', 'RUN_GATES_KEY_EXTRA', 'ignored inputs', 'share the cache', 'outside the working tree'];
  for (const word of words) {
    assert.ok(header.includes(word), `header mentions ${word}`);
  }
});

test('cache: a second identical run prints REUSED and does not execute the gate', () => {
  const { counter, repo } = counterRepo();
  const a = run(repo, [], { cache: true });
  assert.strictEqual(a.status, 0, a.stdout + a.stderr);
  assert.strictEqual(count(counter), 1);
  assert.ok(a.lines[0].startsWith('logs: '), a.lines[0]);
  const b = run(repo, [], { cache: true });
  assert.strictEqual(b.status, 0, b.stdout + b.stderr);
  assert.strictEqual(count(counter), 1, 'gate was not executed again');
  assert.ok(REUSED_RX.test(b.lines[0]), b.lines[0]);
  assert.deepStrictEqual(b.lines.slice(1), a.lines.slice(1), 'original result lines and SUMMARY');
  assert.strictEqual(b.lines[b.lines.length - 1], 'SUMMARY 2 passed, 0 failed, 0 skipped (full)');
  assert.ok(!b.lines.some(l => l.startsWith('logs: ')), 'a reused run creates no log dir');
});

test('cache: a docs-only change since the recorded tree reuses it when a docs pattern is bound', () => {
  const { counter, repo } = counterRepo();
  const a = run(repo, [], { cache: true });
  fs.writeFileSync(path.join(repo, 'README.md'), '# changed docs\n');
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'docs', 'guide.txt'), 'new guide\n');
  const b = run(repo, [], { cache: true, env: DOCS });
  assert.strictEqual(b.status, 0, b.stdout + b.stderr);
  assert.strictEqual(count(counter), 1, 'gate was not executed again');
  assert.ok(DOCS_ONLY_RX.test(b.lines[0]), b.lines[0]);
  assert.deepStrictEqual(b.lines.slice(1), a.lines.slice(1));
});

test('cache: RUN_GATES_DOCS_ONLY narrows what counts as docs', () => {
  const { counter, repo } = counterRepo();
  run(repo, [], { cache: true, env: { RUN_GATES_DOCS_ONLY: '^docs/' } });
  fs.writeFileSync(path.join(repo, 'README.md'), '# changed\n');
  const b = run(repo, [], { cache: true, env: { RUN_GATES_DOCS_ONLY: '^docs/' } });
  assert.ok(b.lines[0].startsWith('logs: '), 'README.md is not docs under this pattern: ' + b.lines[0]);
  assert.strictEqual(count(counter), 2);
});

test('cache: with no docs pattern (or an empty one) a README edit runs a gate that reads it again', () => {
  const repo = makeRepo(withGates(SOURCE, [`gate readme always 'grep -q GOOD README.md'`]));
  fs.writeFileSync(path.join(repo, 'README.md'), '# GOOD\n');
  assert.strictEqual(run(repo, [], { cache: true }).status, 0, 'GOOD README passes');
  fs.writeFileSync(path.join(repo, 'README.md'), '# BAD\n');
  for (const env of [undefined, { RUN_GATES_DOCS_ONLY: '' }]) {
    const b = run(repo, [], { cache: true, env });
    assert.strictEqual(b.status, 1, 'the gate re-ran and failed on the edited README: ' + b.stdout);
    assert.ok(!b.stdout.includes('REUSED'), b.stdout);
  }
});

test('mutant that falls back to a default docs regex reuses a stale PASS for a README edit', () => {
  const from = 'DOCS_RX="${RUN_GATES_DOCS_ONLY-$DOCS_ONLY}"';
  assert.ok(SOURCE.includes(from), 'mutation anchor present in the shipped file');
  const mutant = SOURCE.replace(from, `DOCS_RX="\${RUN_GATES_DOCS_ONLY:-\\.md$|^docs/}"`);
  const repo = makeRepo(withGates(mutant, [`gate readme always 'grep -q GOOD README.md'`]));
  fs.writeFileSync(path.join(repo, 'README.md'), '# GOOD\n');
  run(repo, [], { cache: true });
  fs.writeFileSync(path.join(repo, 'README.md'), '# BAD\n');
  const b = run(repo, [], { cache: true });
  assert.ok(DOCS_ONLY_RX.test(b.lines[0]) && b.status === 0, 'the mutant reuses: ' + b.stdout);
});

test('cache: a code change runs the gates again', () => {
  const { counter, repo } = counterRepo();
  run(repo, [], { cache: true });
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'module.exports = 1;\n');
  const b = run(repo, [], { cache: true });
  assert.strictEqual(b.status, 0, b.stdout + b.stderr);
  assert.strictEqual(count(counter), 2, 'gate executed again');
  assert.ok(b.lines[0].startsWith('logs: '), b.lines[0]);
  assert.ok(!b.stdout.includes('REUSED'), b.stdout);
  // A docs edit on top of a code change is not covered by the older record either.
  fs.writeFileSync(path.join(repo, 'README.md'), '# docs again\n');
  const c = run(repo, [], { cache: true, env: DOCS });
  assert.ok(DOCS_ONLY_RX.test(c.lines[0]), c.lines[0]);
  assert.strictEqual(count(counter), 2);
});

test('cache: a FAIL is never cached', () => {
  const dir = tmp('run-gates-cache-fail-');
  const counter = path.join(dir, 'count');
  const repo = makeRepo(withGates(SOURCE, [`gate bad always 'echo x >> ${counter}; exit 1'`]));
  const a = run(repo, [], { cache: true });
  const b = run(repo, [], { cache: true });
  assert.strictEqual(a.status, 1);
  assert.strictEqual(b.status, 1, b.stdout + b.stderr);
  assert.strictEqual(count(counter), 2, 'the failing gate ran both times');
  assert.ok(!b.stdout.includes('REUSED'), b.stdout);
  assert.ok(/^FAIL bad \d+s \S+bad\.log \(exit 1\)$/.test(b.lines[1]), b.lines[1]);
});

test('cache: --no-cache and RUN_GATES_NO_CACHE=1 force a run, which still refreshes the cache', () => {
  const { counter, repo } = counterRepo();
  run(repo, [], { cache: true });
  const b = run(repo, ['--no-cache'], { cache: true });
  assert.ok(b.lines[0].startsWith('logs: '), b.lines[0]);
  assert.strictEqual(count(counter), 2);
  const c = run(repo, [], { cache: true, env: { RUN_GATES_NO_CACHE: '1' } });
  assert.ok(c.lines[0].startsWith('logs: '), c.lines[0]);
  assert.strictEqual(count(counter), 3);
  const d = run(repo, [], { cache: true });
  assert.ok(REUSED_RX.test(d.lines[0]), d.lines[0]);
  assert.strictEqual(count(counter), 3);
});

test('cache: scoped and full runs are cached apart, and a scoped hit keeps its (scoped) SUMMARY', () => {
  const { counter, repo } = counterRepo();
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export {};\n');
  const a = run(repo, ['--since', 'HEAD'], { cache: true });
  assert.strictEqual(a.lines[a.lines.length - 1], 'SUMMARY 1 passed, 0 failed, 1 skipped (scoped)');
  const b = run(repo, ['--since', 'HEAD'], { cache: true });
  assert.ok(REUSED_RX.test(b.lines[0]), b.lines[0]);
  assert.strictEqual(b.lines[b.lines.length - 1], 'SUMMARY 1 passed, 0 failed, 1 skipped (scoped)');
  assert.strictEqual(count(counter), 1);
  const full = run(repo, [], { cache: true });
  assert.ok(full.lines[0].startsWith('logs: '), 'a full run is not answered by a scoped record: ' + full.lines[0]);
  assert.strictEqual(count(counter), 2);
});

test('cache: the real index and the working tree state are untouched', () => {
  const { repo } = counterRepo();
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'staged.ts'), 'export {};\n');
  git(repo, 'add', 'src/staged.ts');
  fs.writeFileSync(path.join(repo, 'README.md'), '# unstaged edit\n');
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'u\n');
  const logs = path.join(tmp('run-gates-idx-logs-'), 'logs');
  const snapshot = () => ({
    status: git(repo, 'status', '--porcelain'),
    cached: git(repo, 'diff', '--cached'),
    staged: git(repo, 'ls-files', '-s'),
    index: fs.readFileSync(path.join(repo, '.git', 'index')).toString('hex'),
  });
  snapshot(); // a first `git status` may refresh the index itself
  const before = snapshot();
  const a = run(repo, [], { cache: true, logDir: logs });
  const b = run(repo, [], { cache: true, logDir: logs });
  assert.strictEqual(a.status, 0, a.stdout + a.stderr);
  assert.ok(REUSED_RX.test(b.lines[0]), 'the cache was exercised: ' + b.lines[0]);
  assert.deepStrictEqual(snapshot(), before);
  assert.ok(before.status.includes('?? untracked.txt') && before.cached.includes('staged.ts'), 'fixture is dirty');
});

test('cache: worktrees of one repository share it', () => {
  const { counter, repo } = counterRepo();
  const wt = path.join(tmp('run-gates-wt-'), 'wt');
  git(repo, 'worktree', 'add', '-q', '--detach', wt);
  run(repo, [], { cache: true });
  const b = run(wt, [], { cache: true });
  assert.strictEqual(b.status, 0, b.stdout + b.stderr);
  assert.ok(REUSED_RX.test(b.lines[0]), b.lines[0]);
  assert.strictEqual(count(counter), 1);
});

test('cache: RUN_GATES_CACHE_DIR moves the cache', () => {
  const { counter, repo } = counterRepo();
  const cacheDir = path.join(tmp('run-gates-cdir-'), 'cache');
  run(repo, [], { cache: true, env: { RUN_GATES_CACHE_DIR: cacheDir } });
  assert.ok(fs.existsSync(path.join(cacheDir, 'records')), 'records written there');
  assert.ok(!fs.existsSync(path.join(repo, '.git', 'run-gates-cache')), 'default location unused');
  const b = run(repo, [], { cache: true, env: { RUN_GATES_CACHE_DIR: cacheDir } });
  assert.ok(REUSED_RX.test(b.lines[0]), b.lines[0]);
  assert.strictEqual(count(counter), 1);
});

test('lock: a concurrent run waits, then reuses the first run\'s result', () => {
  const dir = tmp('run-gates-lock-');
  const counter = path.join(dir, 'count');
  const started = path.join(dir, 'started');
  const repo = makeRepo(withGates(SOURCE, [`gate slow always 'touch ${started}; sleep 3; echo x >> ${counter}'`]));
  const { cmd, env } = runnerEnv(repo, [], { cache: true });
  const first = spawn(cmd[0], cmd[1], { cwd: repo, env, stdio: 'ignore' });
  try {
    waitForFile(started);
    const second = run(repo, [], { cache: true, env: { RUN_GATES_LOCK_POLL: '1' } });
    assert.strictEqual(second.status, 0, second.stdout + second.stderr);
    assert.ok(second.stderr.includes(`WAITING for run ${first.pid}`), second.stderr);
    assert.ok(REUSED_RX.test(second.lines[0]), second.stdout);
    assert.strictEqual(count(counter), 1, 'the gate ran once for both');
  } finally {
    first.kill();
  }
});

test('lock: after the wait limit the run goes ahead without the lock', () => {
  const dir = tmp('run-gates-lockwait-');
  const counter = path.join(dir, 'count');
  const started = path.join(dir, 'started');
  const repo = makeRepo(withGates(SOURCE, [`gate slow always 'touch ${started}; sleep 3; echo x >> ${counter}'`]));
  const { cmd, env } = runnerEnv(repo, [], { cache: true });
  const first = spawn(cmd[0], cmd[1], { cwd: repo, env, stdio: 'ignore' });
  try {
    waitForFile(started);
    const second = run(repo, [], { cache: true, env: { RUN_GATES_LOCK_POLL: '1', RUN_GATES_LOCK_WAIT: '1' } });
    assert.strictEqual(second.status, 0, second.stdout + second.stderr);
    assert.ok(second.stderr.includes('WAITING for run') && second.stderr.includes('without the lock'), second.stderr);
    assert.ok(second.lines.some(l => /^PASS slow /.test(l)), second.stdout);
  } finally {
    first.kill();
  }
});

test('lock: a lock left by a dead run is taken over without waiting', () => {
  const dir = tmp('run-gates-stale-');
  const counter = path.join(dir, 'count');
  const started = path.join(dir, 'started');
  const body = `touch ${started}; echo x >> ${counter}; [ "$(wc -l < ${counter} | tr -d " ")" -gt 1 ] || sleep 4`;
  const repo = makeRepo(withGates(SOURCE, [`gate slow always '${body}'`]));
  const { cmd, env } = runnerEnv(repo, [], { cache: true });
  // SIGKILL after 1.5s (spawnSync also reaps it, so the dead pid is not a zombie): no trap runs
  // and the lock directory stays behind.
  spawnSync(cmd[0], cmd[1], { cwd: repo, env, stdio: 'ignore', timeout: 1500, killSignal: 'SIGKILL' });
  assert.ok(fs.existsSync(started), 'the first run got as far as its gate');
  assert.strictEqual(fs.readdirSync(path.join(repo, '.git', 'run-gates-cache', 'locks')).length, 1, 'stale lock left');
  const second = run(repo, [], { cache: true });
  assert.strictEqual(second.status, 0, second.stdout + second.stderr);
  assert.ok(!second.stderr.includes('WAITING'), second.stderr);
  assert.ok(second.lines.some(l => /^PASS slow /.test(l)), second.stdout);
  assert.strictEqual(count(counter), 2);
});

test('lock: the lock is released when a run ends, so the next run does not wait', () => {
  const repo = makeRepo(withGates(SOURCE, [`gate bad always 'exit 1'`]));
  for (let n = 0; n < 2; n += 1) {
    const r = run(repo, [], { cache: true });
    assert.strictEqual(r.status, 1);
    assert.ok(!r.stderr.includes('WAITING'), r.stderr);
  }
  const locks = path.join(repo, '.git', 'run-gates-cache', 'locks');
  assert.deepStrictEqual(fs.readdirSync(locks), [], 'no lock directory left behind');
});

/**
 * A slow-gate repo for the tree-changes-during-the-run cases: the gate signals `started`, waits for
 * `go`, then appends to the counter. Returns the paths the test drives it with.
 */
function slowRepo(source = SOURCE, extraGates = []) {
  const dir = tmp('run-gates-slow-');
  const p = { dir, counter: path.join(dir, 'count'), started: path.join(dir, 'started'), go: path.join(dir, 'go') };
  const body = `touch ${p.started}; while [ ! -f ${p.go} ]; do sleep 0.1; done; echo x >> ${p.counter}`;
  p.repo = makeRepo(withGates(source, [`gate slow always '${body}'`, ...extraGates]));
  return p;
}

function notCachedScenario(source) {
  const p = slowRepo(source);
  const a = spawnRun(p.repo, [], { cache: true });
  try {
    waitForFile(p.started);
    fs.writeFileSync(path.join(p.repo, 'edit.txt'), 'edited while the gates ran\n');
    fs.writeFileSync(p.go, '');
    waitLocksGone(p.repo);
    fs.rmSync(path.join(p.repo, 'edit.txt'));
    const b = run(p.repo, [], { cache: true }); // the tree is the one the first run started from
    return { p, a, b };
  } finally {
    a.child.kill();
  }
}

test('cache: a result is not recorded when the tree changed during the run (reverting does not REUSE)', () => {
  const { p, a, b } = notCachedScenario(SOURCE);
  assert.ok(fs.readFileSync(a.out, 'utf8').includes('NOT CACHED tree changed during the run'), fs.readFileSync(a.out, 'utf8'));
  assert.ok(!b.stdout.includes('REUSED'), b.stdout);
  assert.strictEqual(count(p.counter), 2, 'the gate ran again');
});

test('mutant that records without re-checking the tree reuses a result for a tree it never ran against', () => {
  const from = '[ "$KEY" != "$START_KEY" ] || ';
  assert.ok(SOURCE.includes(from), 'mutation anchor present in the shipped file');
  const { p, b } = notCachedScenario(SOURCE.replace(from, ''));
  assert.ok(REUSED_RX.test(b.lines[0]), 'the mutant reuses: ' + b.stdout);
  assert.strictEqual(count(p.counter), 1);
});

test('lock: after a wait the changed files, the mode and the variant are worked out again', () => {
  const scenario = source => {
    const dir = tmp('run-gates-promote-');
    const fullCounter = path.join(dir, 'full');
    const p = slowRepo(source, [`gate fullonly full 'echo x >> ${fullCounter}'`]);
    fs.mkdirSync(path.join(p.repo, 'src'));
    fs.writeFileSync(path.join(p.repo, 'src', 'a.ts'), 'export {};\n');
    const args = ['--since', 'HEAD'];
    const a = spawnRun(p.repo, args, { cache: true, env: { RUN_GATES_LOCK_POLL: '1' } });
    let b;
    try {
      waitForFile(p.started);
      b = spawnRun(p.repo, args, { cache: true, env: { RUN_GATES_LOCK_POLL: '1' } });
      waitForText(b.out, 'WAITING for run');
      fs.writeFileSync(path.join(p.repo, 'package.json'), '{}\n'); // outside SCOPED_PATHS: promotes to full
      fs.writeFileSync(p.go, '');
      waitForText(b.out, 'SUMMARY');
      waitLocksGone(p.repo);
      return { out: fs.readFileSync(b.out, 'utf8'), fullRuns: count(fullCounter) };
    } finally {
      a.child.kill();
      if (b) b.child.kill();
    }
  };
  const r = scenario(SOURCE);
  assert.ok(r.out.includes('PROMOTED to FULL: package.json'), r.out);
  assert.ok(r.out.includes('SUMMARY 2 passed, 0 failed, 0 skipped (full)'), r.out);
  assert.strictEqual(r.fullRuns, 1, 'the full gate ran');
  // Mutant: refresh only the tree key after the wait, as before.
  const from = '      refresh_state || CACHE_ON=0\n';
  assert.ok(SOURCE.includes(from), 'mutation anchor present in the shipped file');
  const m = scenario(SOURCE.replace(from, '      compute_key || CACHE_ON=0\n'));
  assert.ok(m.out.includes('(scoped)') && m.fullRuns === 0, 'the mutant stays scoped: ' + m.out);
});

test('cache: RUN_GATES_KEY_EXTRA output joins the key, so changing it forces a run', () => {
  const { counter, repo } = counterRepo();
  const extra = path.join(path.dirname(counter), 'extra');
  fs.writeFileSync(extra, 'lock v1\n');
  const env = { RUN_GATES_KEY_EXTRA: `cat ${extra}` };
  run(repo, [], { cache: true, env });
  const same = run(repo, [], { cache: true, env });
  assert.ok(REUSED_RX.test(same.lines[0]), 'same extra output reuses: ' + same.lines[0]);
  fs.writeFileSync(extra, 'lock v2\n');
  const changed = run(repo, [], { cache: true, env });
  assert.ok(changed.lines[0].startsWith('logs: '), 'changed extra output runs: ' + changed.lines[0]);
  assert.strictEqual(count(counter), 2);
  const none = run(repo, [], { cache: true }); // no extra at all is a variant of its own
  assert.ok(none.lines[0].startsWith('logs: '), none.lines[0]);
  assert.strictEqual(count(counter), 3);
  // A [B] constant in the file works too, and an empty env value switches it off again.
  const bound = SOURCE.replace("KEY_EXTRA=''", `KEY_EXTRA='cat ${extra}'`);
  assert.notStrictEqual(bound, SOURCE, 'constant bound');
  const c2 = path.join(path.dirname(counter), 'count2');
  const repoB = makeRepo(withGates(bound, [`gate t always 'echo x >> ${c2}'`]));
  run(repoB, [], { cache: true });
  fs.writeFileSync(extra, 'lock v3\n');
  assert.ok(run(repoB, [], { cache: true }).lines[0].startsWith('logs: '), 'bound constant is in the key');
  assert.strictEqual(count(c2), 2);
});

test('lock: release_lock removes only a lock whose pid is ours', () => {
  const scenario = source => {
    const repo = makeRepo(withGates(source, [`gate steal always 'for f in .git/run-gates-cache/locks/*/pid; do echo 999999 > "$f"; done'`]));
    const r = run(repo, [], { cache: true });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    return fs.readdirSync(path.join(repo, '.git', 'run-gates-cache', 'locks')).length;
  };
  assert.strictEqual(scenario(SOURCE), 1, "another pid's lock is left alone");
  const from = '[ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ]';
  assert.ok(SOURCE.includes(from), 'mutation anchor present in the shipped file');
  assert.strictEqual(scenario(SOURCE.replace(from, 'true')), 0, 'the mutant removes it');
});

/** Runs acquire_lock from `source` alone, with `shims` (bash function definitions) in front of it. */
function acquireHarness(source, lockDir, shims) {
  const fn = source.slice(source.indexOf('acquire_lock() {'), source.indexOf('\nif [ "$CACHE_ON" -eq 1 ]; then'));
  const script = [
    `LOCK_DIR='${lockDir}'; LOCK_WAIT=0; LOCK_POLL=1; LOCK_OWNED=0; LOCK_WAITED=0`,
    fn,
    shims,
    'acquire_lock; rc=$?',
    'echo "rc=$rc owned=$LOCK_OWNED pid=$(cat "$LOCK_DIR/pid" 2>/dev/null)"',
  ].join('\n');
  return spawnSync('bash', ['-c', script], { encoding: 'utf8', env: gitEnv() });
}

test('lock: a stale lock is taken over only while it still names the stale pid', () => {
  const lockDir = path.join(tmp('run-gates-race-'), 'lock');
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, 'pid'), '111\n');
  // Checking pid 111 finds it dead, but meanwhile another waiter has replaced the lock with its own (live) 222.
  const shims = `kill() { if [ "$2" = 111 ]; then echo 222 > "$LOCK_DIR/pid"; return 1; fi; return 0; }`;
  const r = acquireHarness(SOURCE, lockDir, shims);
  assert.ok(/rc=1 owned=0 pid=222/.test(r.stdout), r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(lockDir, 'pid')), "the other waiter's lock was not moved away");
  // Mutant: take over without re-reading the pid.
  const from = 'if [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$holder" ]; then';
  assert.ok(SOURCE.includes(from), 'mutation anchor present in the shipped file');
  fs.writeFileSync(path.join(lockDir, 'pid'), '111\n');
  const m = acquireHarness(SOURCE.replace(from, 'if true; then'), lockDir, shims);
  assert.ok(!/pid=222/.test(m.stdout), 'the mutant moved the live lock: ' + m.stdout);
});

test('lock: a holder that releases between the failed mkdir and the check makes the run retry, not go unlocked', () => {
  const lockDir = path.join(tmp('run-gates-retry-'), 'lock');
  const shims = 'mkdir() { n=$((${n:-0} + 1)); if [ "$n" -eq 1 ]; then return 1; fi; command mkdir "$@"; }';
  const r = acquireHarness(SOURCE, lockDir, shims);
  assert.ok(/rc=0 owned=1/.test(r.stdout), r.stdout + r.stderr);
  const from = '      [ "$retries" -le 5 ] || return 1\n      continue\n';
  assert.ok(SOURCE.includes(from), 'mutation anchor present in the shipped file');
  const m = acquireHarness(SOURCE.replace(from, '      return 1\n'), lockDir + '2', shims);
  assert.ok(/rc=1 owned=0/.test(m.stdout), 'the mutant goes unlocked: ' + m.stdout);
});

test('cache: a record name that is not a 40-64 char lowercase hex id is never handed to git', () => {
  const scenario = source => {
    const counter = path.join(tmp('run-gates-hex-'), 'count');
    const repo = makeRepo(withGates(source, [`gate t always 'echo x >> ${counter}'`]));
    run(repo, [], { cache: true, env: DOCS });
    const recs = path.join(repo, '.git', 'run-gates-cache', 'records');
    const variant = path.join(recs, fs.readdirSync(recs)[0]);
    const evil = `--output=pwned-${'x'.repeat(36)}`; // 51 chars; git would take it as an option
    fs.writeFileSync(path.join(variant, evil), 'T\nSUMMARY 1 passed, 0 failed, 0 skipped (full)\n');
    const future = new Date(Date.now() + 60000);
    fs.utimesSync(path.join(variant, evil), future, future);
    fs.writeFileSync(path.join(repo, 'README.md'), '# docs edit\n');
    const b = run(repo, [], { cache: true, env: DOCS });
    return { b, created: fs.existsSync(path.join(repo, `pwned-${'x'.repeat(36)}`)) };
  };
  const r = scenario(SOURCE);
  assert.ok(!r.created, 'git did not see the record name as an option');
  assert.ok(DOCS_ONLY_RX.test(r.b.lines[0]), 'the genuine record still answers: ' + r.b.lines[0]);
  const from = '    case "$t" in *[!0-9a-f]*) continue ;; esac\n';
  assert.ok(SOURCE.includes(from), 'mutation anchor present in the shipped file');
  assert.ok(scenario(SOURCE.replace(from, '')).created, 'the mutant lets git create the --output file');
});

test('instant failures: a FAIL under RUN_GATES_INSTANT_SECS is annotated, a slower one is not', () => {
  const repo = makeRepo(withGates(SOURCE, ["gate quick always 'exit 3'", "gate slow always 'sleep 2; exit 1'"]));
  const a = run(repo, [], { env: { RUN_GATES_INSTANT_SECS: '1' } });
  assert.ok(
    /^FAIL quick \d+s \S+quick\.log \(exit 3\) \(instant: if the log shows no real failure, check the command\/env before re-running\)$/.test(a.lines[1]),
    a.lines[1],
  );
  assert.ok(/^FAIL slow \d+s \S+slow\.log \(exit 1\)$/.test(a.lines[2]), a.lines[2]);
  assert.strictEqual(a.status, 2);
  const d = run(repo, [], { env: { RUN_GATES_INSTANT_SECS: '' } }); // default threshold: 10s
  assert.ok(/\(exit 3\) \(instant: /.test(d.lines[1]) && /\(exit 1\) \(instant: /.test(d.lines[2]), d.stdout);
  assert.ok(d.lines[1].startsWith('FAIL quick '), 'the FAIL prefix is unchanged');
  assert.strictEqual(d.lines[d.lines.length - 1], 'SUMMARY 0 passed, 2 failed, 0 skipped (full)');
});

// ── unbound and interpreter ──────────────────────────────────────────────────

console.log('\nrun-gates.sh: unbound template and interpreter');

test('every shipped example gate is commented out', () => {
  const block = SOURCE.slice(SOURCE.indexOf(OPEN_MARKER), SOURCE.indexOf(CLOSE_MARKER));
  const live = block.split('\n').filter(l => /^\s*gate(_counted)?\s/.test(l));
  assert.deepStrictEqual(live, [], 'no live gate line in the shipped [B] block');
  assert.ok(/^# gate_counted /m.test(block), 'a counted example is shown');
});

test('a run with no gates bound exits 99 with a clear message and no SUMMARY', () => {
  const repo = makeRepo(SOURCE);
  for (const args of [[], ['--list'], ['--since', 'HEAD']]) {
    const r = run(repo, args);
    assert.strictEqual(r.status, 99, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.ok(r.stderr.includes('no gates bound') && r.stderr.includes('[B] block'), r.stderr);
    assert.ok(!r.stdout.includes('SUMMARY') && !r.lines.some(l => /^(PASS|FAIL) /.test(l)), r.stdout);
  }
});

test('the header tells the reader to invoke it as bash scripts/run-gates.sh', () => {
  assert.ok(SOURCE.split('\n').slice(0, 12).some(l => l.includes('bash scripts/run-gates.sh')));
});

test('a non-bash shell (dash) exits 99 with a message instead of a syntax error', () => {
  const dash = ['/bin/dash', '/usr/bin/dash'].find(p => fs.existsSync(p));
  if (!dash) {
    console.log('    (dash not installed here; case not exercised)');
    return;
  }
  const repo = makeRepo(withGates(SOURCE, ["gate a always 'true'"]));
  const r = spawnSync(dash, [path.join(repo, 'scripts', 'run-gates.sh')], { cwd: repo, env: gitEnv(), encoding: 'utf8' });
  assert.strictEqual(r.status, 99, r.stdout + r.stderr);
  assert.ok(r.stderr.includes('needs bash'), r.stderr);
  assert.strictEqual(r.stdout, '', 'nothing ran');
});

// ── mutation ─────────────────────────────────────────────────────────────────

console.log('\nrun-gates.sh: mutation');

test('mutant that stops after the first FAIL no longer runs later gates', () => {
  const from = '    failed=$((failed + 1))\n  fi\ndone';
  const to = '    failed=$((failed + 1))\n    break\n  fi\ndone';
  assert.ok(SOURCE.includes(from), 'mutation anchor present in the shipped file');
  const mutant = SOURCE.replace(from, to);
  assert.notStrictEqual(mutant, SOURCE, 'mutation applied');

  const dir = tmp('run-gates-mut-');
  const marker = path.join(dir, 'ok-ran');
  const repo = makeRepo(withGates(mutant, neverBailGates(marker)));
  const r = run(repo, [], { logDir: path.join(dir, 'logs') });
  assert.ok(!fs.existsSync(marker), 'ok did not run against the mutant');
  assert.notStrictEqual(r.status, 2, 'exit status differs from the shipped runner');
  assert.ok(!r.lines.some(l => /^PASS ok /.test(l)), 'no PASS ok line against the mutant');
});

test('mutant that ignores the count regex lets a zero-test runner PASS', () => {
  const from = '! grep -Eq -- "$rx" "$logfile"';
  assert.ok(SOURCE.includes(from), 'mutation anchor present in the shipped file');
  const mutant = SOURCE.replace(from, 'false');
  assert.notStrictEqual(mutant, SOURCE, 'mutation applied');
  const gates = [`gate_counted t always '${COUNT_RX}' 'echo "# pass 0"'`];
  const shipped = run(makeRepo(withGates(SOURCE, gates)), []);
  assert.strictEqual(shipped.status, 1, 'shipped runner FAILs the zero-test gate');
  const r = run(makeRepo(withGates(mutant, gates)), []);
  assert.strictEqual(r.status, 0, 'mutant passes a gate that checked nothing');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
