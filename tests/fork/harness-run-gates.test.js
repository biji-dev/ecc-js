/**
 * Tests for skills/harness-bootstrap/templates/run-gates.sh (biji-dev/ecc-js):
 * the never-bail verification runner, its result lines, exit status and scoped mode.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

function run(repo, args, { logDir, env: extraEnv } = {}) {
  const env = gitEnv(extraEnv);
  delete env.RUN_GATES_LOG_DIR;
  if (logDir) env.RUN_GATES_LOG_DIR = logDir;
  const r = spawnSync('bash', [path.join(repo, 'scripts', 'run-gates.sh'), ...args], {
    cwd: repo,
    env,
    encoding: 'utf8',
  });
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
