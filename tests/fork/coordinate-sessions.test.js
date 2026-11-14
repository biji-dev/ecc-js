/**
 * Tests for skills/coordinate-sessions (biji-dev/ecc-js): the skill's shape, and scripts/board-check.mjs
 * run against throwaway repositories with real worktrees: --plan refuses a file in two write sets, the
 * event check prints FENCE (committed and uncommitted), OVERLAP, BEHIND, QUIET and MISSING, and a clean
 * board prints BOARD OK.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(ROOT, 'skills', 'coordinate-sessions');
const CHECK = path.join(SKILL, 'scripts', 'board-check.mjs');

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

const cleanup = [];
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(ENV, {
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
});

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

/** A repo on main with src/orders, src/invoices, src/router.ts and docs/log.md committed. */
function repo() {
  const dir = tmp('board-check-');
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, '.gitignore', '.review-work/\n');
  write(dir, 'src/orders/a.ts', 'a\n');
  write(dir, 'src/invoices/b.ts', 'b\n');
  write(dir, 'src/router.ts', 'r\n');
  write(dir, 'docs/log.md', 'log\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const HEADER = '| Worker | Unit | Wave | Branch | Worktree | Write set | IDs | State |\n|---|---|---|---|---|---|---|---|';

/** Writes the board under <dir>/.review-work/sessions/r1/ and returns its path. */
function board(dir, rows, { hub = 'src/router.ts', shared = 'docs/log.md' } = {}) {
  const text = [
    '# Board: r1',
    '',
    'Mainline: main',
    `Hub: ${hub}`,
    `Shared: ${shared}`,
    '',
    '## Units',
    '',
    '<!-- board:units -->',
    HEADER,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '<!-- /board:units -->',
    '',
  ].join('\n');
  const file = path.join(dir, '.review-work', 'sessions', 'r1', 'board.md');
  write(dir, path.relative(dir, file), text);
  return file;
}

function check(file, ...args) {
  return spawnSync(process.execPath, [CHECK, ...args, file], { cwd: os.tmpdir(), encoding: 'utf8', env: ENV });
}

/** Two worker worktrees, A (orders) and B (invoices), branched from main, each with a fresh log line. */
function twoWorkers({ stateB = 's1' } = {}) {
  const dir = repo();
  const a = path.join(dir, '..', `${path.basename(dir)}-a`);
  const b = path.join(dir, '..', `${path.basename(dir)}-b`);
  cleanup.push(a, b);
  git(dir, 'worktree', 'add', '-q', '-b', 'work/orders', a, 'main');
  git(dir, 'worktree', 'add', '-q', '-b', 'work/invoices', b, 'main');
  const file = board(dir, [
    ['A', 'orders', '1', 'work/orders', a, '`src/orders/**`, tests/orders/**', 'FU-200..219', 's1'],
    ['B', 'invoices', '1', 'work/invoices', path.relative(dir, b), 'src/invoices/**', 'FU-220..239', stateB],
  ]);
  write(path.dirname(file), 'A.log', 'STARTED orders\n');
  write(path.dirname(file), 'B.log', 'STARTED invoices\n');
  return { dir, a, b, file };
}

console.log('\ncoordinate-sessions: the skill');

test('SKILL.md: frontmatter, sections, and every shipped file named', () => {
  const body = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const fm = body.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm, 'frontmatter');
  assert.match(fm[1], /^name: coordinate-sessions$/m);
  const description = /^description: "(.*)"$/m.exec(fm[1]);
  assert.ok(description && description[1].length <= 1024, 'description present and within 1024 characters');
  for (const heading of ['## When to Use', '## How It Works', '## Examples', '## Constraints']) {
    assert.ok(body.includes(heading), `missing ${heading}`);
  }
  for (const rel of ['reference/board.md', 'scripts/board-check.mjs']) {
    assert.ok(fs.existsSync(path.join(SKILL, rel)), `${rel} ships`);
    assert.ok(body.includes(rel), `SKILL.md names ${rel}`);
  }
});

test('the skill is an own skill in fork/slim.json', () => {
  const slim = JSON.parse(fs.readFileSync(path.join(ROOT, 'fork', 'slim.json'), 'utf8'));
  assert.ok(slim.skills.own.includes('coordinate-sessions'));
});

test('the board template in reference/board.md parses: --plan passes it', () => {
  const dir = repo();
  const ref = fs.readFileSync(path.join(SKILL, 'reference', 'board.md'), 'utf8');
  const template = /```markdown\n(# Board:[\s\S]*?)```/.exec(ref);
  assert.ok(template, 'reference/board.md has the board template');
  const file = path.join(dir, '.review-work', 'sessions', 'r1', 'board.md');
  write(dir, path.relative(dir, file), template[1]);
  const r = check(file, '--plan');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^PLAN OK 3 units/m);
});

console.log('\ncoordinate-sessions: board-check --plan');

test('--plan: disjoint write sets pass', () => {
  const dir = repo();
  const file = board(dir, [
    ['A', 'orders', '1', '-', '-', 'src/orders/**', '-', '-'],
    ['B', 'invoices', '1', '-', '-', 'src/invoices/', '-', '-'],
  ]);
  const r = check(file, '--plan');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(r.stdout, 'PLAN OK 2 units, write sets disjoint in each wave\n');
});

test('--plan: two sets sharing a file fail, naming the file and both units', () => {
  const dir = repo();
  const file = board(dir, [
    ['A', 'orders', '1', '-', '-', 'src/orders/**, src/*.ts', '-', '-'],
    ['B', 'invoices', '1', '-', '-', 'src/invoices/**, src/router.ts', '-', '-'],
  ], { hub: '-' });
  const r = check(file, '--plan');
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('CONFLICT src/router.ts orders invoices (wave 1)'), r.stdout);
  assert.match(r.stdout, /^PLAN REFUSED: /m);
});

test('--plan: a file two units will create (no wildcard, not yet in git) conflicts too', () => {
  const dir = repo();
  const file = board(dir, [
    ['A', 'orders', '1', '-', '-', 'src/orders/**, src/new-shared.ts', '-', '-'],
    ['B', 'invoices', '1', '-', '-', 'src/invoices/**, src/new-shared.ts', '-', '-'],
  ]);
  const r = check(file, '--plan');
  assert.strictEqual(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('CONFLICT src/new-shared.ts orders invoices'), r.stdout);
});

test('--plan: units in different waves may share a file; a hub file in a write set fails', () => {
  const dir = repo();
  const waves = board(dir, [
    ['A', 'orders', '1', '-', '-', 'src/orders/**, docs/**', '-', '-'],
    ['-', 'reports', '2', '-', '-', 'src/orders/a.ts', '-', '-'],
  ], { shared: '-' });
  const r = check(waves, '--plan');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const hub = board(dir, [['A', 'orders', '1', '-', '-', 'src/**', '-', '-']]);
  const h = check(hub, '--plan');
  assert.strictEqual(h.status, 1, h.stdout);
  assert.ok(h.stdout.includes('HUB orders src/router.ts'), h.stdout);
});

test('--plan: a shared append-only file in two sets is no conflict', () => {
  const dir = repo();
  const file = board(dir, [
    ['A', 'orders', '1', '-', '-', 'src/orders/**, docs/log.md', '-', '-'],
    ['B', 'invoices', '1', '-', '-', 'src/invoices/**, docs/log.md', '-', '-'],
  ]);
  const r = check(file, '--plan');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

console.log('\ncoordinate-sessions: board-check events');

test('events: a fresh board with two workers prints BOARD OK', () => {
  const { file } = twoWorkers();
  const r = check(file);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(r.stdout, 'BOARD OK 2 workers\n');
});

test('events: a write outside the set prints FENCE, committed and uncommitted alike; shared files do not', () => {
  const { a, file } = twoWorkers();
  write(a, 'src/orders/c.ts', 'mine\n');
  write(a, 'src/invoices/b.ts', 'not mine\n');
  git(a, 'add', '-A');
  git(a, 'commit', '-q', '-m', 'orders work');
  write(a, 'src/router.ts', 'hub edit, uncommitted\n');
  write(a, 'notes.txt', 'untracked\n');
  write(a, 'docs/log.md', 'log\nappended\n');
  const r = check(file);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  for (const line of ['FENCE A src/invoices/b.ts', 'FENCE A src/router.ts', 'FENCE A notes.txt']) {
    assert.ok(r.stdout.split('\n').includes(line), `missing "${line}": ${r.stdout}`);
  }
  assert.ok(!r.stdout.includes('src/orders/c.ts'), r.stdout);
  assert.ok(!r.stdout.includes('docs/log.md'), r.stdout);
  assert.match(r.stdout, /^BOARD 3 findings$/m);
});

test('events: two workers touching one file print OVERLAP', () => {
  const { a, b, file } = twoWorkers();
  write(a, 'src/router.ts', 'a\n');
  write(b, 'src/router.ts', 'b\n');
  git(b, 'commit', '-q', '-am', 'b touches the router');
  const r = check(file);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.ok(r.stdout.split('\n').includes('OVERLAP A B src/router.ts'), r.stdout);
});

test('events: a branch that lacks the mainline tip prints BEHIND with the count', () => {
  const { dir, file } = twoWorkers();
  write(dir, 'src/router.ts', 'landed\n');
  git(dir, 'commit', '-q', '-am', 'a landing');
  write(dir, 'src/router.ts', 'landed again\n');
  git(dir, 'commit', '-q', '-am', 'another landing');
  const r = check(file);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('BEHIND A 2'), r.stdout);
  assert.ok(r.stdout.includes('BEHIND B 2'), r.stdout);
});

test('events: no log line, commit or file change for 30 minutes prints QUIET; --quiet-min moves the line', () => {
  const { file } = twoWorkers();
  const later = new Date(Date.now() + 45 * 60000).toISOString();
  const r = check(file, '--now', later);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /^QUIET A 4[45]m$/m);
  assert.match(r.stdout, /^QUIET B 4[45]m$/m);
  const q = check(file, '--now', later, '--quiet-min', '60');
  assert.strictEqual(q.status, 0, q.stdout);
  // a log line written "now" (at --now) keeps the worker out of QUIET
  const log = path.join(path.dirname(file), 'A.log');
  const at = new Date(later);
  fs.utimesSync(log, at, at);
  const s = check(file, '--now', later);
  assert.ok(!/QUIET A/.test(s.stdout), s.stdout);
  assert.match(s.stdout, /^QUIET B/m);
});

test('events: a LANDED row is out of the check; a missing worktree prints MISSING', () => {
  const { a, b, file } = twoWorkers({ stateB: 'LANDED' });
  write(b, 'src/router.ts', 'b\n');
  const landed = check(file);
  assert.strictEqual(landed.status, 0, landed.stdout);
  assert.strictEqual(landed.stdout, 'BOARD OK 1 workers\n');
  fs.rmSync(a, { recursive: true, force: true });
  const r = check(file);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^MISSING A /m);
});

test('usage: no board, or a board with no units table, exits 2', () => {
  const none = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', env: ENV });
  assert.strictEqual(none.status, 2, none.stderr);
  const dir = repo();
  write(dir, '.review-work/sessions/r1/board.md', '# Board\n\nMainline: main\n');
  const r = check(path.join(dir, '.review-work/sessions/r1/board.md'));
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /no <!-- board:units -->/);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
