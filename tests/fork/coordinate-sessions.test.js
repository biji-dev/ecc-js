/**
 * Tests for skills/coordinate-sessions (biji-dev/ecc-js): the skill's shape, and scripts/board-check.mjs
 * run against throwaway repositories with real worktrees: --plan refuses a file in two write sets, the
 * event check prints FENCE (committed and uncommitted), OVERLAP, BEHIND, QUIET and MISSING, and a clean
 * board prints BOARD OK; --transcripts classifies a worker from a synthetic transcript tail (PROMPT, IDLE,
 * NOTRANSCRIPT), --watch exits on its first finding, --host counts workers in a registry directory, and
 * scripts/worktree-add.mjs sets up a worktree. Nothing here reads the real ~/.claude or ~/.harness.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(ROOT, 'skills', 'coordinate-sessions');
const CHECK = path.join(SKILL, 'scripts', 'board-check.mjs');
const WTADD = path.join(SKILL, 'scripts', 'worktree-add.mjs');

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

// the real ~/.claude and ~/.harness are never read: both locations point at empty temp directories
const EMPTY_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-projects-'));
const EMPTY_SESSIONS = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-sessions-'));
cleanup.push(EMPTY_PROJECTS, EMPTY_SESSIONS);
const SAFE_ENV = { ...ENV, CLAUDE_PROJECTS_DIR: EMPTY_PROJECTS, HARNESS_SESSIONS_DIR: EMPTY_SESSIONS };

function check(file, ...args) {
  return spawnSync(process.execPath, [CHECK, ...args, file], { cwd: os.tmpdir(), encoding: 'utf8', env: SAFE_ENV, timeout: 60000 });
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

test('--plan: two globs that can match one file no tracked file shows yet conflict; globs apart by name pass', () => {
  const dir = repo();
  const file = board(dir, [
    ['A', 'reports', '1', '-', '-', 'src/reports/**', '-', '-'],
    ['B', 'exports', '1', '-', '-', 'src/reports/*.ts', '-', '-'],
    ['C', 'orders', '1', '-', '-', 'src/orders/**', '-', '-'],
    ['D', 'orders-new', '1', '-', '-', 'src/orders/new.ts', '-', '-'],
  ]);
  const r = check(file, '--plan');
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('CONFLICT src/reports/** ~ src/reports/*.ts reports exports (wave 1: the globs can match one new file)'), r.stdout);
  assert.ok(r.stdout.includes('CONFLICT src/orders/** ~ src/orders/new.ts orders orders-new'), r.stdout);
  assert.strictEqual(r.stdout.split('\n').filter((l) => l.startsWith('CONFLICT')).length, 2, r.stdout);
  const apart = board(dir, [
    ['A', 'styles', '1', '-', '-', 'src/gen/*.css', '-', '-'],
    ['B', 'types', '1', '-', '-', 'src/gen/*.ts', '-', '-'],
  ]);
  const ok = check(apart, '--plan');
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
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

test('events: a hub file inside a worker\'s own write set is still FENCE', () => {
  const { dir, a } = twoWorkers();
  const file = board(dir, [['A', 'orders', '1', 'work/orders', a, 'src/**', '-', 's1']]);
  write(path.dirname(file), 'A.log', 'STARTED orders\n');
  write(a, 'src/router.ts', 'hub edit\n');
  write(a, 'src/orders/c.ts', 'mine\n');
  const r = check(file);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(r.stdout.split('\n').filter((l) => l.startsWith('FENCE')), ['FENCE A src/router.ts']);
});

test('events: a path git prints with a leading space keeps it, so a write beside the set is FENCE', () => {
  const { a, file } = twoWorkers();
  write(a, ' src/orders/x.ts', 'not in src/\n');
  const r = check(file);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.split('\n').includes('FENCE A  src/orders/x.ts'), JSON.stringify(r.stdout));
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

test('events: no log line, commit or file change for 15 minutes prints QUIET; --quiet-min moves the line', () => {
  const { file } = twoWorkers();
  const soon = new Date(Date.now() + 10 * 60000).toISOString();
  assert.strictEqual(check(file, '--now', soon).status, 0, 'ten quiet minutes is not QUIET');
  assert.match(check(file, '--now', new Date(Date.now() + 20 * 60000).toISOString()).stdout, /^QUIET A (?:19|20|21)m$/m);
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
  const none = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', env: SAFE_ENV });
  assert.strictEqual(none.status, 2, none.stderr);
  const dir = repo();
  write(dir, '.review-work/sessions/r1/board.md', '# Board\n\nMainline: main\n');
  const r = check(path.join(dir, '.review-work/sessions/r1/board.md'));
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /no <!-- board:units -->/);
});

// ---------------------------------------------------------------------------------------------------
// transcripts: synthetic records in the shape Claude Code writes (one content block per assistant record,
// tool results as user records, background completions as <task-notification> queue-operation records)

const NOW = Date.parse('2026-01-01T12:00:00.000Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
let seq = 0;
const asstTool = (min, name, input = {}, id = `toolu_${(seq += 1)}`) => ({ type: 'assistant', timestamp: ago(min), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
const asstText = (min, text, stop = 'end_turn') => ({ type: 'assistant', timestamp: ago(min), message: { stop_reason: stop, content: [{ type: 'text', text }] } });
const asstThink = (min) => ({ type: 'assistant', timestamp: ago(min), message: { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '' }] } });
const result = (min, id, content = 'ok') => ({ type: 'user', timestamp: ago(min), message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const note = (min, id) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: ago(min), content: `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n</task-notification>` });
const noiseRecords = [{ type: 'mode' }, { type: 'api-request-blob', message: { content: [{ type: 'text', text: 'x' }] } }, { type: 'system', subtype: 'turn_duration', timestamp: ago(0) }];

/** An export of board-check.mjs called with JSON arguments, in a child process (the module is ESM, this file is CommonJS). */
function callExport(name, ...args) {
  const code = `import * as m from ${JSON.stringify(pathToFileURL(CHECK).href)};
    let t = ''; process.stdin.on('data', (d) => (t += d)).on('end', () => { console.log(JSON.stringify(m[${JSON.stringify(name)}](...JSON.parse(t)))); });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { input: JSON.stringify(args), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const classify = (entries, now = NOW) => callExport('classifyTail', entries, now);
/** An export of worktree-add.mjs called with JSON arguments, in a child process. */
function callWt(name, ...args) {
  const code = `import * as m from ${JSON.stringify(pathToFileURL(WTADD).href)};
    let t = ''; process.stdin.on('data', (d) => (t += d)).on('end', () => { console.log(JSON.stringify(m[${JSON.stringify(name)}](...JSON.parse(t)))); });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { input: JSON.stringify(args), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

console.log('\ncoordinate-sessions: board-check --transcripts (classifier)');

test('classify: a tool call with no result for 5 minutes or more is PROMPT; under 5 minutes, or with a result, is not', () => {
  assert.deepStrictEqual(classify([asstTool(12, 'Edit', { file_path: 'a' })]), { kind: 'PROMPT', tool: 'Edit', minutes: 12 });
  assert.strictEqual(classify([asstTool(4, 'Edit')]), null);
  const done = asstTool(12, 'Edit', {}, 'toolu_done');
  assert.strictEqual(classify([done, result(11, 'toolu_done')]), null);
  // parallel calls: one answered, one still waiting
  const [x, y] = [asstTool(9, 'Read', {}, 'toolu_x'), asstTool(9, 'Write', {}, 'toolu_y')];
  assert.deepStrictEqual(classify([x, y, result(8, 'toolu_x')]), { kind: 'PROMPT', tool: 'Write', minutes: 9 });
});

test('classify: a pending Bash within its timeout is not PROMPT, past it plus a minute is; a pending Agent call never is', () => {
  assert.strictEqual(classify([asstTool(8, 'Bash', { command: 'sleep 400', timeout: 600000 })]), null);
  assert.deepStrictEqual(classify([asstTool(8, 'Bash', { command: 'npm test' })]), { kind: 'PROMPT', tool: 'Bash', minutes: 8 }, 'default timeout 120 s + 60 s: 8 minutes is past it');
  assert.strictEqual(classify([asstTool(2.5, 'Bash', { command: 'npm test' })]), null);
  assert.deepStrictEqual(classify([asstTool(8, 'Bash', { command: 'npm run dev', run_in_background: true })]), { kind: 'PROMPT', tool: 'Bash', minutes: 8 }, 'a background launch has no foreground wait');
  assert.deepStrictEqual(classify([asstTool(12, 'Bash', { command: 'x', timeout: 300000 })]), { kind: 'PROMPT', tool: 'Bash', minutes: 12 });
  assert.strictEqual(classify([asstTool(90, 'Agent', { prompt: 'p' })]), null);
  assert.strictEqual(classify([asstTool(90, 'Task', { prompt: 'p' })]), null);
});

test('classify: a finished turn with no state line is IDLE once 5 minutes old; a fresh one, or one still thinking, is not', () => {
  assert.deepStrictEqual(classify([asstTool(30, 'Read', {}, 't1'), result(29, 't1'), asstText(20, 'Done with the part.\n\nNext I would run the tests.'), ...noiseRecords]), { kind: 'IDLE', minutes: 20 });
  assert.strictEqual(classify([asstText(3, 'Fine.')]), null);
  assert.strictEqual(classify([asstText(20, 'Fine.'), asstThink(1)]), null);
  assert.strictEqual(classify([asstText(20, 'I will look at it now.', 'tool_use')]), null, 'text before a tool call is mid-turn');
});

test('classify: RUNNING with a background task still running is nothing; with none left, or none ever, it is IDLE', () => {
  const launch = asstTool(40, 'Bash', { command: 'npm test', run_in_background: true }, 'toolu_bg');
  const launched = result(40, 'toolu_bg', 'Command running in background with ID: b1');
  const running = [launch, launched, asstText(30, 'RUNNING the suite in the background, will read it when it ends')];
  assert.strictEqual(classify(running), null);
  assert.deepStrictEqual(classify([...running, note(10, 'toolu_bg')]), { kind: 'IDLE', minutes: 30 });
  assert.deepStrictEqual(classify([asstText(30, 'RUNNING the suite')]), { kind: 'IDLE', minutes: 30 });
});

test('classify: a turn ending on WAITING ON .., DONE, BLOCKED or STOPPED is nothing, markup around the word included', () => {
  for (const text of ['WAITING ON CONTROLLER v13-controller - which hub?', 'WAITING ON OWNER: the key', 'DONE s5 landed', 'BLOCKED the gate is red', 'STOPPED', 'Notes.\n\n**DONE** all tests green\n']) {
    assert.strictEqual(classify([asstText(40, text)]), null, text);
  }
  assert.deepStrictEqual(classify([asstText(40, 'DONE-ish, maybe. Not sure what to do next.\n\nWaiting for you')]), { kind: 'IDLE', minutes: 40 }, 'only the last line counts');
});

test('classify: a pending Bash is PROMPT once past its timeout plus 60 s, not before (kills: the +60 s dropped)', () => {
  assert.strictEqual(classify([asstTool(5.5, 'Bash', { command: 'x', timeout: 300000 })]), null, '330 s is inside 300 s + 60 s');
  assert.deepStrictEqual(classify([asstTool(6.5, 'Bash', { command: 'x', timeout: 300000 })]), { kind: 'PROMPT', tool: 'Bash', minutes: 6 });
});

test('classify: records of a subagent (isSidechain) are not the worker\'s own (kills: sidechain not skipped)', () => {
  const side = { ...asstTool(2, 'Edit'), isSidechain: true };
  assert.deepStrictEqual(classify([asstText(40, 'Fine.'), side]), { kind: 'IDLE', minutes: 40 });
  const sideOld = { ...asstTool(30, 'Write'), isSidechain: true };
  assert.deepStrictEqual(classify([asstText(40, 'Fine.'), sideOld]), { kind: 'IDLE', minutes: 40 }, 'a sidechain call with no result is no PROMPT');
});

test('classify: a background launch with no run_in_background flag is running until its notice: flagless Agent, Monitor, a Bash moved to the background', () => {
  const agent = [asstTool(30, 'Agent', { description: 'review', prompt: 'p' }, 'toolu_ag'), result(30, 'toolu_ag', 'Async agent launched successfully.\nagentId: a1 (internal ID)'), asstText(25, 'RUNNING two reviews (a1)')];
  assert.strictEqual(classify(agent), null);
  assert.deepStrictEqual(classify([...agent, note(5, 'toolu_ag')]), { kind: 'IDLE', minutes: 25 }, 'its notice closes it');
  const monitor = [asstTool(30, 'Monitor', { description: 'build', command: 'tail -f x' }, 'toolu_mo'), result(30, 'toolu_mo', 'Monitor started (task m1)'), asstText(25, 'RUNNING a monitor on the build')];
  assert.strictEqual(classify(monitor), null);
  assert.deepStrictEqual(classify([...monitor, note(5, 'toolu_mo')]), { kind: 'IDLE', minutes: 25 });
  const moved = [asstTool(30, 'Bash', { command: 'npm test', timeout: 600000 }, 'toolu_fg'), result(28, 'toolu_fg', 'Command was moved to background with ID: b7.'), asstText(25, 'RUNNING the suite (b7)')];
  assert.strictEqual(classify(moved), null);
  assert.deepStrictEqual(classify([...moved, note(5, 'toolu_fg')]), { kind: 'IDLE', minutes: 25 });
  // a notice that names the task id instead of the launching call's id closes it too
  const byTask = { type: 'queue-operation', operation: 'enqueue', timestamp: ago(5), content: '<task-notification>\n<task-id>b7</task-id>\n<status>completed</status>\n</task-notification>' };
  assert.deepStrictEqual(classify([...moved, byTask]), { kind: 'IDLE', minutes: 25 });
});

test('classify: a foreground Agent that returned its result is not running, whatever id its result names', () => {
  const done = [asstTool(30, 'Agent', { description: 'review', prompt: 'p' }, 'toolu_fa'), result(28, 'toolu_fa', 'The review found two issues.\nagentId: a9 (use SendMessage to continue)'), asstText(25, 'RUNNING the fixes')];
  assert.deepStrictEqual(classify(done), { kind: 'IDLE', minutes: 25 });
});

test('classify: a notice in a user record closes a background task, as a string or as a text block (kills: user records ignored)', () => {
  const launch = [asstTool(40, 'Bash', { command: 'npm test', run_in_background: true }, 'toolu_bg'), result(40, 'toolu_bg', 'Command running in background with ID: b1'), asstText(30, 'RUNNING the suite')];
  const text = '<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>toolu_bg</tool-use-id>\n<status>completed</status>\n</task-notification>';
  assert.strictEqual(classify(launch), null);
  const asString = { type: 'user', timestamp: ago(20), message: { content: text } };
  const asBlock = { type: 'user', timestamp: ago(20), message: { content: [{ type: 'text', text }] } };
  // the notice wakes the worker, so the turn is not the last record: add the later text turn
  assert.deepStrictEqual(classify([...launch, asString, asstText(15, 'RUNNING the suite')]), { kind: 'IDLE', minutes: 15 });
  assert.deepStrictEqual(classify([...launch, asBlock, asstText(15, 'RUNNING the suite')]), { kind: 'IDLE', minutes: 15 });
});

const reply = (min, id, content, toolUseResult, extra = {}) => ({ type: 'user', timestamp: ago(min), ...(toolUseResult ? { toolUseResult } : {}), message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] } });
const BG_LINE = 'Command running in background with ID: b9. Output is being written to: /tmp/x';

test('classify: a SendMessage that resumed an agent is a launch; its notice, under the call id, closes it (kills: resumed ids not a launch)', () => {
  const resumed = [asstTool(30, 'SendMessage', { to: 'a1', message: 'continue' }, 'toolu_sm'), reply(30, 'toolu_sm', 'Message delivered; agent resumed.', { success: true, resumedAgentId: 'a1' }), asstText(25, 'RUNNING the resumed reviewer (a1)')];
  assert.strictEqual(classify(resumed), null);
  assert.deepStrictEqual(classify([...resumed, note(10, 'toolu_sm')]), { kind: 'IDLE', minutes: 25 }, 'the notice names the SendMessage call');
  const byAgent = { type: 'queue-operation', operation: 'enqueue', timestamp: ago(10), content: '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>' };
  assert.deepStrictEqual(classify([...resumed, byAgent]), { kind: 'IDLE', minutes: 25 }, 'or the agent id');
  const revived = [asstTool(30, 'SendMessage', { to: 'a2', message: 'go' }, 'toolu_sm2'), reply(30, 'toolu_sm2', 'ok', { success: true, revivedAgentId: 'a2' }), asstText(25, 'RUNNING the revived agent')];
  assert.strictEqual(classify(revived), null);
  const plain = [asstTool(30, 'SendMessage', { to: 'a3', message: 'hi' }, 'toolu_sm3'), reply(30, 'toolu_sm3', 'Message queued.', { success: true }), asstText(25, 'RUNNING after a plain message')];
  assert.deepStrictEqual(classify(plain), { kind: 'IDLE', minutes: 25 }, 'a plain message launches nothing');
});

test('classify: a launch whose result is an error never ran (kills: error launches kept)', () => {
  const denied = [asstTool(30, 'Bash', { command: 'npm run dev', run_in_background: true }, 'toolu_d'), reply(30, 'toolu_d', 'Permission to use Bash has been denied.', null, { is_error: true }), asstText(15, 'RUNNING the next unit')];
  assert.deepStrictEqual(classify(denied), { kind: 'IDLE', minutes: 15 });
  const badMonitor = [asstTool(30, 'Monitor', { command: 'x' }, 'toolu_m'), reply(30, 'toolu_m', 'bad input', null, { is_error: true }), asstText(15, 'RUNNING a monitor')];
  assert.deepStrictEqual(classify(badMonitor), { kind: 'IDLE', minutes: 15 });
  const errAgent = [asstTool(30, 'Agent', { description: 'x', prompt: 'p' }, 'toolu_e'), reply(30, 'toolu_e', 'Async agent launched successfully.\nagentId: a7', { isAsync: true, status: 'async_launched', agentId: 'a7' }, { is_error: true }), asstText(15, 'RUNNING the review')];
  assert.deepStrictEqual(classify(errAgent), { kind: 'IDLE', minutes: 15 });
});

test('classify: a TaskStop or KillShell that succeeded closes the task it names, by task id or by the launching call id (kills: stops ignored)', () => {
  const launch = [asstTool(40, 'Bash', { command: 'npm run dev', run_in_background: true }, 'toolu_l'), reply(40, 'toolu_l', BG_LINE)];
  const running = [...launch, asstText(15, 'RUNNING the dev server')];
  assert.strictEqual(classify(running), null);
  const stop = (name, input, ok = true) => [asstTool(35, name, input, 'toolu_s'), reply(35, 'toolu_s', ok ? 'Successfully stopped task: b9' : 'No task found with ID: b9', null, ok ? {} : { is_error: true })];
  assert.deepStrictEqual(classify([...launch, ...stop('TaskStop', { task_id: 'b9' }), asstText(15, 'RUNNING the next unit')]), { kind: 'IDLE', minutes: 15 }, 'by task id');
  assert.deepStrictEqual(classify([...launch, ...stop('KillShell', { shell_id: 'b9' }), asstText(15, 'RUNNING the next unit')]), { kind: 'IDLE', minutes: 15 }, 'KillShell by shell id');
  assert.deepStrictEqual(classify([...launch, ...stop('TaskStop', { task_id: 'toolu_l' }), asstText(15, 'RUNNING the next unit')]), { kind: 'IDLE', minutes: 15 }, 'by the launching call id');
  assert.strictEqual(classify([...launch, ...stop('TaskStop', { task_id: 'b9' }, false), asstText(15, 'RUNNING the dev server')]), null, 'a stop that failed closes nothing');
  assert.strictEqual(classify([...launch, ...stop('TaskStop', { task_id: 'other' }), asstText(15, 'RUNNING the dev server')]), null, 'another task id closes nothing');
});

test('classify: the launch phrase counts only in the opening words of a launching tool\'s result, never in a report or a file read (kills: phrase gate and anchor)', () => {
  const idle = (records) => assert.deepStrictEqual(classify(records), { kind: 'IDLE', minutes: 15 });
  idle([asstTool(30, 'Agent', { description: 'x', prompt: 'p' }, 'toolu_a'), reply(30, 'toolu_a', 'Done. The dev server is running in the background on port 3000; tests pass.'), asstText(15, 'RUNNING the next unit')]);
  idle([asstTool(30, 'Agent', { description: 'x', prompt: 'p' }, 'toolu_a'), reply(30, 'toolu_a', `Done. The log said: ${BG_LINE}`), asstText(15, 'RUNNING the next unit')]);
  idle([asstTool(30, 'Read', { file_path: '/x' }, 'toolu_r'), reply(30, 'toolu_r', BG_LINE), asstText(15, 'RUNNING the next unit')]);
  idle([asstTool(30, 'Grep', { pattern: 'x' }, 'toolu_g'), reply(30, 'toolu_g', 'Async agent launched successfully.\nagentId: a1'), asstText(15, 'RUNNING the next unit')]);
  // the real launches still count
  assert.strictEqual(classify([asstTool(30, 'Workflow', { name: 'w' }, 'toolu_w'), reply(30, 'toolu_w', 'Workflow launched in background. Task ID: w1\nSummary: x'), asstText(15, 'RUNNING the workflow')]), null);
  assert.strictEqual(classify([asstTool(30, 'Bash', { command: 'make', timeout: 120000 }, 'toolu_b'), reply(30, 'toolu_b', 'Command did not complete within its 120s timeout and was moved to the background with ID: b4'), asstText(15, 'RUNNING make')]), null);
});

test('lineKey: a standing condition keeps one key whatever its minutes or count; another type or path is another key', () => {
  const key = (l) => callExport('lineKey', l);
  assert.strictEqual(key('QUIET A 20m'), key('QUIET A 35m'));
  assert.strictEqual(key('IDLE A 6m'), key('IDLE A 12m'));
  assert.strictEqual(key('BEHIND A 1'), key('BEHIND A 2'));
  assert.strictEqual(key('PROMPT A Write 6m'), key('PROMPT A Write 9m'));
  assert.strictEqual(key('NOTRANSCRIPT A /x/y'), key('NOTRANSCRIPT A /z'));
  assert.notStrictEqual(key('IDLE A 6m'), key('PROMPT A Write 6m'));
  assert.notStrictEqual(key('PROMPT A Write 6m'), key('PROMPT A Edit 6m'));
  assert.notStrictEqual(key('QUIET A 20m'), key('QUIET B 20m'));
  assert.notStrictEqual(key('FENCE A x.ts'), key('FENCE A y.ts'));
});

test('classify: torn lines and unknown record types are skipped; an empty tail is nothing', () => {
  assert.strictEqual(classify([]), null);
  assert.strictEqual(classify([...noiseRecords, null, 'x', 7]), null);
});

console.log('\ncoordinate-sessions: board-check --transcripts (events)');

/** A temp projects dir with one transcript per worktree under the slug directory name Claude Code uses. */
function transcriptDir(projects, worktree, name = 's1.jsonl', records = [], mtime = null) {
  const dir = path.join(projects, fs.realpathSync(worktree).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return dir;
}
const real = (min) => new Date(Date.now() - min * 60000).toISOString();
const realTool = (min, name, input = {}) => ({ type: 'assistant', timestamp: real(min), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `toolu_r${min}${name}`, name, input }] } });
const realText = (min, text) => ({ type: 'assistant', timestamp: real(min), message: { stop_reason: 'end_turn', content: [{ type: 'text', text }] } });

test('--transcripts: no transcript prints NOTRANSCRIPT with the slug directory; never PROMPT', () => {
  const { a, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  const r = check(file, '--transcripts', '--projects-dir', projects);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  const slug = fs.realpathSync(a).replace(/[^A-Za-z0-9]/g, '-');
  assert.ok(r.stdout.split('\n').includes(`NOTRANSCRIPT A ${path.join(projects, slug)}`), r.stdout);
  assert.match(r.stdout, /^NOTRANSCRIPT B /m);
  assert.match(r.stdout, /^BOARD 2 findings$/m);
  assert.ok(!/PROMPT|IDLE/.test(r.stdout), r.stdout);
});

test('--transcripts: PROMPT names the tool and the minutes, IDLE the minutes; healthy workers print nothing', () => {
  const { a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  transcriptDir(projects, a, 's1.jsonl', [realText(40, 'starting'), realTool(12, 'Write', { file_path: 'x' })]);
  transcriptDir(projects, b, 's1.jsonl', [realText(9, 'Ran the checks.\n\nNothing else to do right now.')]);
  const r = check(file, '--transcripts', '--projects-dir', projects);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^PROMPT A Write 1[12]m$/m);
  assert.match(r.stdout, /^IDLE B (?:8|9)m$/m);
  assert.match(r.stdout, /^BOARD 2 findings$/m);
  const ok = tmp('bc-proj-');
  transcriptDir(ok, a, 's1.jsonl', [realTool(1, 'Read')]);
  transcriptDir(ok, b, 's1.jsonl', [realText(30, 'WAITING ON CONTROLLER v13-controller - which hub?')]);
  const clean = check(file, '--transcripts', '--projects-dir', ok);
  assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);
  assert.strictEqual(clean.stdout, 'BOARD OK 2 workers\n');
});

test('--transcripts: the newest top-level transcript is read; a subagents/ file and an older file are not', () => {
  const { a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  const old = new Date(Date.now() - 3600000);
  const dirA = transcriptDir(projects, a, 'old.jsonl', [realTool(50, 'Write')], old);
  transcriptDir(projects, a, 'new.jsonl', [realText(1, 'WAITING ON CONTROLLER x')]);
  fs.mkdirSync(path.join(dirA, 'subagents'));
  fs.writeFileSync(path.join(dirA, 'subagents', 'agent-1.jsonl'), `${JSON.stringify(realTool(40, 'Write'))}\n`);
  transcriptDir(projects, b, 's.jsonl', [realTool(1, 'Read')]);
  const r = check(file, '--transcripts', '--projects-dir', projects);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('--transcripts: only the tail is read, a torn first line is skipped, and $CLAUDE_PROJECTS_DIR is the default', () => {
  const { a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  const filler = `${JSON.stringify({ type: 'attachment', pad: 'x'.repeat(2000) })}\n`.repeat(400);
  const dirA = transcriptDir(projects, a, 's.jsonl', [realTool(1, 'Read')]);
  fs.writeFileSync(path.join(dirA, 's.jsonl'), `${JSON.stringify(realTool(60, 'Write'))}\n${filler}{"type":"assis\n${JSON.stringify(realText(1, 'DONE'))}\n`);
  transcriptDir(projects, b, 's.jsonl', [realTool(1, 'Read')]);
  const r = spawnSync(process.execPath, [CHECK, '--transcripts', file], { cwd: os.tmpdir(), encoding: 'utf8', env: { ...SAFE_ENV, CLAUDE_PROJECTS_DIR: projects } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('--transcripts: a worktree named through a symlink is read by its real path (kills: realpath not resolved)', () => {
  const { dir, a, b } = twoWorkers();
  const link = path.join(tmp('bc-link-'), 'link-a');
  fs.symlinkSync(a, link);
  const file = board(dir, [
    ['A', 'orders', '1', 'work/orders', link, 'src/orders/**', 'FU-200..219', 's1'],
    ['B', 'invoices', '1', 'work/invoices', b, 'src/invoices/**', 'FU-220..239', 's1'],
  ]);
  write(path.dirname(file), 'A.log', 'STARTED orders\n');
  write(path.dirname(file), 'B.log', 'STARTED invoices\n');
  const projects = tmp('bc-proj-');
  transcriptDir(projects, a, 's.jsonl', [realTool(1, 'Read')]);
  transcriptDir(projects, b, 's.jsonl', [realTool(1, 'Read')]);
  const r = check(file, '--transcripts', '--projects-dir', projects);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('--transcripts: a worker that entered its worktree from the main checkout is found by cwd in the main slug directory', () => {
  const { dir, a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  const withCwd = (cwd, records) => records.map((r) => ({ ...r, cwd }));
  const hour = (h) => new Date(Date.now() - h * 3600000);
  // in the main slug directory: one session now working in worker A's worktree (its newest cwd, under it), one still in main
  transcriptDir(projects, dir, 'in-worktree.jsonl', withCwd(a, [realText(50, 'started'), realTool(12, 'Write', { file_path: 'x' })]), hour(1));
  transcriptDir(projects, dir, 'in-main.jsonl', withCwd(dir, [realTool(1, 'Read')]), hour(0.1));
  // a session that was in the worktree earlier and has left it
  transcriptDir(projects, dir, 'left.jsonl', [...withCwd(a, [realTool(70, 'Edit')]), ...withCwd(dir, [realText(60, 'back in main')])], hour(0.5));
  transcriptDir(projects, b, 's.jsonl', [realTool(1, 'Read')]);
  const r = check(file, '--transcripts', '--projects-dir', projects);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^PROMPT A Write 1[12]m$/m);
  assert.ok(!/NOTRANSCRIPT/.test(r.stdout), r.stdout);
  // a worktree's own slug directory wins when it has a transcript
  transcriptDir(projects, a, 'own.jsonl', [realTool(1, 'Read')]);
  assert.strictEqual(check(file, '--transcripts', '--projects-dir', projects).status, 0);
});

test('--transcripts: with no transcript in the main slug directory in or under the worktree, NOTRANSCRIPT as before', () => {
  const { dir, a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  transcriptDir(projects, dir, 'in-main.jsonl', [{ ...realTool(1, 'Read'), cwd: dir }]);
  transcriptDir(projects, dir, 'sibling.jsonl', [{ ...realTool(1, 'Read'), cwd: `${a}-other` }]);
  transcriptDir(projects, b, 's.jsonl', [realTool(1, 'Read')]);
  const r = check(file, '--transcripts', '--projects-dir', projects);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.split('\n').includes(`NOTRANSCRIPT A ${path.join(projects, fs.realpathSync(a).replace(/[^A-Za-z0-9]/g, '-'))}`), r.stdout);
});

test('--transcripts: a launch further back than the 256 KB tail still counts: RUNNING is not IDLE, and a notice that far back closes it (kills: no longer read)', () => {
  const { a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  const id = (n) => `toolu_far${n}`;
  const launch = [realTool(60, 'Bash', { command: 'npm test', run_in_background: true }), { type: 'user', timestamp: real(60), message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_r60Bash', content: 'Command running in background with ID: b1' }] } }];
  const filler = Array.from({ length: 40 }, (_, i) => [
    { type: 'assistant', timestamp: real(50 - i), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: id(i), name: 'Read', input: {} }] } },
    { type: 'user', timestamp: real(50 - i), message: { content: [{ type: 'tool_result', tool_use_id: id(i), content: 'x'.repeat(10000) }] } },
  ]).flat();
  const ended = { type: 'queue-operation', operation: 'enqueue', timestamp: real(55), content: '<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>toolu_r60Bash</tool-use-id>\n<status>completed</status>\n</task-notification>' };
  transcriptDir(projects, b, 's.jsonl', [realTool(0, 'Read')]);
  const dir = transcriptDir(projects, a, 's.jsonl', [...launch, ...filler, realText(10, 'RUNNING the suite (b1)')]);
  assert.ok(fs.statSync(path.join(dir, 's.jsonl')).size > 300 * 1024, 'the launch is beyond the 256 KB tail');
  const open = check(file, '--transcripts', '--projects-dir', projects);
  assert.strictEqual(open.status, 0, open.stdout + open.stderr);
  assert.ok(!/IDLE/.test(open.stdout), open.stdout);
  transcriptDir(projects, a, 's.jsonl', [...launch, ended, ...filler, realText(10, 'RUNNING the suite (b1)')]);
  const closed = check(file, '--transcripts', '--projects-dir', projects);
  assert.strictEqual(closed.status, 1, closed.stdout + closed.stderr);
  assert.match(closed.stdout, /^IDLE A 10m$/m);
  // a RUNNING worker with no launch anywhere is IDLE as before
  transcriptDir(projects, a, 's.jsonl', [...filler, realText(10, 'RUNNING the suite')]);
  assert.match(check(file, '--transcripts', '--projects-dir', projects).stdout, /^IDLE A 10m$/m);
});

test('--transcripts: two transcripts in the main slug directory that end in the worktree are no worker\'s: NOTRANSCRIPT with the count (kills: the first is taken)', () => {
  const { dir, a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  const hour = (h) => new Date(Date.now() - h * 3600000);
  // the worker's own session, stuck on a dialog, and the controller that only cd'd into the worktree for a look
  transcriptDir(projects, dir, 'worker.jsonl', [{ ...realTool(30, 'Write', { file_path: 'x' }), cwd: a }], hour(0.5));
  transcriptDir(projects, dir, 'controller.jsonl', [{ ...realTool(0, 'Read'), cwd: a }], hour(0.01));
  transcriptDir(projects, b, 's.jsonl', [realTool(0, 'Read')]);
  const slug = path.join(projects, fs.realpathSync(a).replace(/[^A-Za-z0-9]/g, '-'));
  const r = check(file, '--transcripts', '--projects-dir', projects);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.split('\n').includes(`NOTRANSCRIPT A ${slug} (2 candidates)`), r.stdout);
  assert.ok(!/^PROMPT/m.test(r.stdout), 'neither is read');
  // exactly one candidate is used, as before
  fs.rmSync(path.join(projects, fs.realpathSync(dir).replace(/[^A-Za-z0-9]/g, '-'), 'controller.jsonl'));
  assert.match(check(file, '--transcripts', '--projects-dir', projects).stdout, /^PROMPT A Write (29|30)m$/m);
});

test('--transcripts: only the 20 newest transcripts of the main slug directory are looked at (kills: no bound, bound moved)', () => {
  const { dir, a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  transcriptDir(projects, b, 's.jsonl', [realTool(0, 'Read')]);
  const at = (rank) => new Date(Date.now() - (rank + 1) * 60000);
  const build = (rankOfWorker) => {
    const mainSlug = path.join(projects, fs.realpathSync(dir).replace(/[^A-Za-z0-9]/g, '-'));
    fs.rmSync(mainSlug, { recursive: true, force: true });
    for (let i = 0; i < 25; i += 1) {
      if (i === rankOfWorker) transcriptDir(projects, dir, 'worker.jsonl', [{ ...realTool(30, 'Write', { file_path: 'x' }), cwd: a }], at(i));
      else transcriptDir(projects, dir, `f${i}.jsonl`, [{ ...realTool(1, 'Read'), cwd: dir }], at(i));
    }
  };
  build(19);
  assert.match(check(file, '--transcripts', '--projects-dir', projects).stdout, /^PROMPT A Write (29|30)m$/m, 'the 20th newest is looked at');
  build(20);
  assert.match(check(file, '--transcripts', '--projects-dir', projects).stdout, /^NOTRANSCRIPT A /m, 'the 21st is not');
});

console.log('\ncoordinate-sessions: board-check --watch');

test('--watch: findings that stand at the first check do not end the watch (BEHIND before READY, a worker with no transcript)', () => {
  const { dir, a, file } = twoWorkers();
  write(dir, 'src/router.ts', 'landed\n');
  git(dir, 'commit', '-q', '-am', 'a landing');
  write(dir, 'src/router.ts', 'landed again\n');
  git(dir, 'commit', '-q', '-am', 'another landing');
  const projects = tmp('bc-proj-');
  transcriptDir(projects, a, 's.jsonl', [realTool(0, 'Read')]);
  const watch = () => spawnSync(process.execPath, [CHECK, '--watch', '--every', '1', '--max-seconds', '3', '--projects-dir', projects, file], { cwd: os.tmpdir(), encoding: 'utf8', env: SAFE_ENV, timeout: 60000 });
  const r = watch();
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^WATCH BASELINE 3 standing findings\n/);
  assert.match(r.stdout, /WATCH END [3-9] checks, 3 still standing\n$/);
  assert.ok(!/^(?:BEHIND|NOTRANSCRIPT|BOARD)/m.test(r.stdout), 'standing lines are not repeated');
});

test('--watch: nothing found by the end of --max prints WATCH END and exits 0; a finding that appears later exits 1', () => {
  const { a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  transcriptDir(projects, a, 's.jsonl', [realTool(0, 'Read')]);
  transcriptDir(projects, b, 's.jsonl', [realTool(0, 'Read')]);
  const r = spawnSync(process.execPath, [CHECK, '--watch', '--every', '1', '--max-seconds', '2', '--projects-dir', projects, file], { cwd: os.tmpdir(), encoding: 'utf8', env: SAFE_ENV, timeout: 60000 });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^WATCH END [2-9] checks, nothing found\n$/);
  // a fence breach written after the first check is caught by a later one
  const later = spawnSync('/bin/sh', ['-c', `(sleep 1.2; echo x > "${path.join(a, 'stray.txt')}") & exec "${process.execPath}" "${CHECK}" --watch --every 1 --max-seconds 20 --projects-dir "${projects}" "${file}"`], { cwd: os.tmpdir(), encoding: 'utf8', env: SAFE_ENV, timeout: 60000 });
  assert.strictEqual(later.status, 1, later.stdout + later.stderr);
  assert.match(later.stdout, /^FENCE A stray\.txt$/m);
  assert.match(later.stdout, /^BOARD 1 findings$/m);
});

test('--watch: a standing line that changes its number is not new; one that changes its type is; one that goes and returns is', () => {
  const { a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  const own = transcriptDir(projects, a, 's.jsonl', [realText(30, 'Done with the first part.')]);
  transcriptDir(projects, b, 's.jsonl', [realTool(0, 'Read')]);
  // A is IDLE at the first check; IDLE gets older (not new); then A is on a dialog: PROMPT (new)
  const script = `(sleep 1.3; echo '${JSON.stringify(realTool(9, 'Write', { file_path: 'x' }))}' >> "${path.join(own, 's.jsonl')}") & exec "${process.execPath}" "${CHECK}" --watch --every 1 --max-seconds 20 --projects-dir "${projects}" "${file}"`;
  const r = spawnSync('/bin/sh', ['-c', script], { cwd: os.tmpdir(), encoding: 'utf8', env: SAFE_ENV, timeout: 60000 });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^WATCH BASELINE 1 standing findings$/m);
  assert.match(r.stdout, /^PROMPT A Write [89]m$/m);
  assert.ok(!/^IDLE/m.test(r.stdout), r.stdout);
});

test('--watchStep: IDLE and PROMPT stand until their minutes are 30 or more past the minutes they were reported with; others never refire', () => {
  const step = (prev, ...lines) => callExport('watchStep', prev, lines);
  assert.deepStrictEqual(step({}, 'IDLE A 10m', 'BEHIND B 2'), { fresh: ['IDLE A 10m', 'BEHIND B 2'], next: { 'IDLE A': 10, 'BEHIND B': null } });
  assert.deepStrictEqual(step({ 'IDLE A': 10 }, 'IDLE A 39m').fresh, [], '29 minutes older: still standing');
  assert.deepStrictEqual(step({ 'IDLE A': 10 }, 'IDLE A 40m'), { fresh: ['IDLE A 40m'], next: { 'IDLE A': 40 } }, '30 minutes older: new again, reported from 40');
  // a standing line keeps the minutes it was reported with, so growth is counted from the report
  assert.deepStrictEqual(step({ 'IDLE A': 10 }, 'IDLE A 25m').next, { 'IDLE A': 10 });
  assert.deepStrictEqual(step({ 'PROMPT A Write': 8 }, 'PROMPT A Write 38m').fresh, ['PROMPT A Write 38m']);
  assert.deepStrictEqual(step({ 'PROMPT A Write': 8 }, 'PROMPT A Write 37m').fresh, []);
  assert.deepStrictEqual(step({ 'PROMPT A Write': 8 }, 'PROMPT A Read 60m').fresh, ['PROMPT A Read 60m'], 'another tool is another line');
  assert.deepStrictEqual(step({ 'BEHIND A': null, 'QUIET A': null }, 'BEHIND A 9', 'QUIET A 500m').fresh, []);
  assert.deepStrictEqual(step({ 'IDLE A': 10 }, 'BEHIND A 1').next, { 'BEHIND A': null }, 'a line that is gone leaves the map');
});

test('--watch: an IDLE that stands and has grown 30 minutes since it was reported wakes the controller again', () => {
  const { a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  const own = transcriptDir(projects, a, 's.jsonl', [realText(10, 'Done with the first part.')]);
  transcriptDir(projects, b, 's.jsonl', [realTool(0, 'Read')]);
  // the baseline has IDLE A 10m; the transcript is then rewritten as if the worker had been idle 35 minutes longer
  const older = JSON.stringify(realText(45, 'Done with the first part.'));
  const script = `(sleep 1.3; echo '${older}' > "${path.join(own, 's.jsonl')}") & exec "${process.execPath}" "${CHECK}" --watch --every 1 --max-seconds 20 --projects-dir "${projects}" "${file}"`;
  const r = spawnSync('/bin/sh', ['-c', script], { cwd: os.tmpdir(), encoding: 'utf8', env: SAFE_ENV, timeout: 60000 });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^WATCH BASELINE 1 standing findings$/m);
  assert.match(r.stdout, /^IDLE A 4[45]m$/m);
});

test('--watch: the baseline is the previous check, so a line that clears and comes back is new (kills: the first check kept as the baseline)', () => {
  const { a, b, file } = twoWorkers();
  const projects = tmp('bc-proj-');
  transcriptDir(projects, b, 's.jsonl', [realTool(0, 'Read')]);
  const slug = path.join(projects, fs.realpathSync(a).replace(/[^A-Za-z0-9]/g, '-'));
  const line = JSON.stringify(realTool(0, 'Read'));
  // A has no transcript at the first check (NOTRANSCRIPT, the baseline), gets one, and loses it again
  const script = `(sleep 0.4; mkdir -p "${slug}"; echo '${line}' > "${slug}/s.jsonl"; sleep 2; rm -rf "${slug}") & exec "${process.execPath}" "${CHECK}" --watch --every 1 --max-seconds 15 --projects-dir "${projects}" "${file}"`;
  const r = spawnSync('/bin/sh', ['-c', script], { cwd: os.tmpdir(), encoding: 'utf8', env: SAFE_ENV, timeout: 60000 });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^WATCH BASELINE 1 standing findings$/m);
  assert.match(r.stdout, /^NOTRANSCRIPT A /m);
  assert.match(r.stdout, /^BOARD 1 findings$/m);
});

test('--watch: the board is read again at each check, so a row added during the watch is seen (kills: never re-read)', () => {
  const { dir, a, file } = twoWorkers();
  const full = fs.readFileSync(file, 'utf8');
  const onlyA = board(dir, [['A', 'orders', '1', 'work/orders', a, 'src/orders/**', 'FU-200..219', 's1']]);
  assert.strictEqual(onlyA, file);
  write(path.dirname(file), 'A.log', 'STARTED orders\n');
  const projects = tmp('bc-proj-');
  transcriptDir(projects, a, 's.jsonl', [realTool(0, 'Read')]);
  const stash = path.join(tmp('bc-full-'), 'full.md');
  fs.writeFileSync(stash, full);
  const script = `(sleep 1.3; cp "${stash}" "${file}") & exec "${process.execPath}" "${CHECK}" --watch --every 1 --max-seconds 20 --projects-dir "${projects}" "${file}"`;
  const r = spawnSync('/bin/sh', ['-c', script], { cwd: os.tmpdir(), encoding: 'utf8', env: SAFE_ENV, timeout: 60000 });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^NOTRANSCRIPT B /m);
});

test('--watch: a bad board or a mode clash exits 2 at once', () => {
  const dir = repo();
  write(dir, 'bad.md', '# Board\n');
  const bad = spawnSync(process.execPath, [CHECK, '--watch', path.join(dir, 'bad.md')], { encoding: 'utf8', env: SAFE_ENV, timeout: 20000 });
  assert.strictEqual(bad.status, 2, bad.stdout + bad.stderr);
  const clash = spawnSync(process.execPath, [CHECK, '--watch', '--plan', path.join(dir, 'bad.md')], { encoding: 'utf8', env: SAFE_ENV, timeout: 20000 });
  assert.strictEqual(clash.status, 2, clash.stderr);
});

console.log('\ncoordinate-sessions: board-check --host');

const host = (sessions, ...args) => spawnSync(process.execPath, [CHECK, '--host', '--sessions-dir', sessions, ...args], { cwd: os.tmpdir(), encoding: 'utf8', env: SAFE_ENV, timeout: 20000 });

test('--host: an empty registry is 0 workers in 0 runs; the cap is min(cores / 2, free GB / peak GB, 3)', () => {
  const sessions = path.join(tmp('hs-'), 'sessions');
  const r = host(sessions, '--cores', '8', '--free-gb', '30');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(r.stdout, 'HOST 0 workers in 0 runs (cap 3; 30.0 GB free by --free-gb)\n');
  assert.match(host(sessions, '--cores', '4', '--free-gb', '30').stdout, /\(cap 2;/);
  assert.match(host(sessions, '--cores', '16', '--free-gb', '7', '--peak-gb', '3').stdout, /\(cap 2;/);
  assert.match(host(sessions, '--cores', '16', '--free-gb', '7', '--peak-gb', '2').stdout, /\(cap 3;/);
  const none = host(sessions, '--cores', '16', '--free-gb', '1');
  assert.strictEqual(none.status, 1, 'no memory for a worker: at the cap');
  assert.match(none.stdout, /\(cap 0;/);
});

/** Sets the mtime of a board and of every worker log beside it. */
const ageRun = (boardFile, when) => {
  for (const n of fs.readdirSync(path.dirname(boardFile))) if (n === path.basename(boardFile) || n.endsWith('.log')) fs.utimesSync(path.join(path.dirname(boardFile), n), when, when);
};
const hostFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

test('--host --register / --release: workers are counted across runs, the cap stops at n >= cap, and release removes the file', () => {
  const sessions = tmp('hs-');
  const one = twoWorkers();
  const reg = host(sessions, '--register', one.file);
  assert.strictEqual(reg.status, 0, reg.stdout + reg.stderr);
  assert.strictEqual(reg.stdout, 'HOST REGISTERED r1 2 workers\n');
  const [name] = hostFiles(sessions);
  assert.match(name, /^r1-[0-9a-f]{8}\.json$/);
  const saved = JSON.parse(fs.readFileSync(path.join(sessions, name), 'utf8'));
  assert.deepStrictEqual(Object.keys(saved), ['board', 'workers', 'started']);
  assert.strictEqual(saved.board, fs.realpathSync(one.file));
  assert.strictEqual(saved.workers, 2);
  assert.ok(!Number.isNaN(Date.parse(saved.started)));
  const under = host(sessions, '--cores', '8', '--free-gb', '30');
  assert.strictEqual(under.status, 0, under.stdout);
  assert.strictEqual(under.stdout, 'HOST 2 workers in 1 runs (cap 3; 30.0 GB free by --free-gb)\n');
  // a second run in another repository that is also called r1 gets its own file, one worker (LANDED rows do not count)
  const two = twoWorkers({ stateB: 'LANDED' });
  assert.strictEqual(host(sessions, '--register', two.file).stdout, 'HOST REGISTERED r1 1 workers\n');
  assert.strictEqual(hostFiles(sessions).length, 2);
  const full = host(sessions, '--cores', '8', '--free-gb', '30');
  assert.strictEqual(full.status, 1, full.stdout);
  assert.strictEqual(full.stdout, 'HOST 3 workers in 2 runs (cap 3; 30.0 GB free by --free-gb)\nHOST AT CAP: start no new worker\n');
  // registering again updates in place, keeping the start time
  host(sessions, '--register', one.file);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(sessions, name), 'utf8')).started, saved.started);
  assert.strictEqual(hostFiles(sessions).length, 2);
  const rel = host(sessions, '--release', one.file);
  assert.strictEqual(rel.status, 0, rel.stdout + rel.stderr);
  assert.strictEqual(rel.stdout, 'HOST RELEASED r1\n');
  assert.strictEqual(host(sessions, '--cores', '8', '--free-gb', '30').stdout, 'HOST 1 workers in 1 runs (cap 3; 30.0 GB free by --free-gb)\n');
  assert.strictEqual(host(sessions, '--release', one.file).stdout, 'HOST NOT REGISTERED r1\n');
});

test('--host --register: two repositories registering the same run name at once never lose a record', () => {
  const x = twoWorkers();
  const y = twoWorkers();
  for (let round = 0; round < 6; round += 1) {
    const sessions = tmp('hs-');
    const script = `"${process.execPath}" "${CHECK}" --host --sessions-dir "${sessions}" --register "${x.file}" >/dev/null 2>&1 & "${process.execPath}" "${CHECK}" --host --sessions-dir "${sessions}" --register "${y.file}" >/dev/null 2>&1 & wait`;
    spawnSync('/bin/sh', ['-c', script], { env: SAFE_ENV, timeout: 60000 });
    assert.strictEqual(hostFiles(sessions).length, 2, `round ${round}: ${fs.readdirSync(sessions)}`);
    assert.strictEqual(fs.readdirSync(sessions).filter((f) => f.endsWith('.tmp')).length, 0, 'no temp file is left');
  }
});

test('--host --register: several registrations of one board at once all succeed and leave one complete file (kills: a shared temp name)', () => {
  const x = twoWorkers();
  for (let round = 0; round < 4; round += 1) {
    const sessions = tmp('hs-');
    const one = `"${process.execPath}" "${CHECK}" --host --sessions-dir "${sessions}" --register "${x.file}" >/dev/null 2>>"${sessions}/errors.log"`;
    const script = `${Array.from({ length: 8 }, () => `${one} || echo failed >> "${sessions}/failed.log" &`).join('\n')}\nwait`;
    spawnSync('/bin/sh', ['-c', script], { env: SAFE_ENV, timeout: 60000 });
    assert.ok(!fs.existsSync(path.join(sessions, 'failed.log')), `round ${round}: ${fs.existsSync(path.join(sessions, 'errors.log')) ? fs.readFileSync(path.join(sessions, 'errors.log'), 'utf8') : ''}`);
    assert.strictEqual(hostFiles(sessions).length, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(sessions, hostFiles(sessions)[0]), 'utf8')).workers, 2);
  }
});

test('--host: the worker count is read from the board now, not from the registration', () => {
  const sessions = tmp('hs-');
  const { file } = twoWorkers();
  host(sessions, '--register', file);
  assert.strictEqual(host(sessions, '--cores', '8', '--free-gb', '30').stdout, 'HOST 2 workers in 1 runs (cap 3; 30.0 GB free by --free-gb)\n');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(\| B \|[^\n]*\| )s1 \|/, '$1LANDED |'));
  assert.strictEqual(host(sessions, '--cores', '8', '--free-gb', '30').stdout, 'HOST 1 workers in 1 runs (cap 3; 30.0 GB free by --free-gb)\n');
});

test('--host: a board not written for 6 hours is HOST STALE, left out of the count, and its file is kept', () => {
  const sessions = tmp('hs-');
  const old = twoWorkers();
  const fresh = twoWorkers();
  host(sessions, '--register', old.file);
  host(sessions, '--register', fresh.file);
  const long = new Date(Date.now() - 7 * 3600000);
  ageRun(old.file, long);
  const r = host(sessions, '--cores', '8', '--free-gb', '30');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(r.stdout, `HOST 2 workers in 1 runs (cap 3; 30.0 GB free by --free-gb)\nHOST STALE r1 ${fs.realpathSync(old.file)}\n`);
  assert.strictEqual(hostFiles(sessions).length, 2, 'nothing is deleted');
  const edge = new Date(Date.now() - 5 * 3600000);
  ageRun(old.file, edge);
  assert.strictEqual(host(sessions, '--cores', '8', '--free-gb', '30').stdout, 'HOST 4 workers in 2 runs (cap 3; 30.0 GB free by --free-gb)\nHOST AT CAP: start no new worker\n');
});

test('--host: a run is as live as its newest write: a worker log newer than 6 hours keeps a stale board live (kills: the board mtime alone)', () => {
  const sessions = tmp('hs-');
  const run = twoWorkers();
  host(sessions, '--register', run.file);
  const long = new Date(Date.now() - 7 * 3600000);
  ageRun(run.file, long);
  assert.match(host(sessions, '--cores', '8', '--free-gb', '30').stdout, /^HOST 0 workers in 0 runs .*\nHOST STALE r1 /, 'board and logs old: stale');
  fs.utimesSync(path.join(path.dirname(run.file), 'A.log'), new Date(), new Date());
  const live = host(sessions, '--cores', '8', '--free-gb', '30');
  assert.strictEqual(live.stdout, 'HOST 2 workers in 1 runs (cap 3; 30.0 GB free by --free-gb)\n', 'a worker wrote its log a moment ago');
});

test('--host: the HOST line says where the free memory came from; vm_stat is run by its absolute path, and a failing one falls back to freemem (kills: PATH lookup, silent fallback)', () => {
  const sessions = tmp('hs-');
  const run = (extraEnv) => spawnSync(process.execPath, [CHECK, '--host', '--sessions-dir', sessions, '--cores', '8'], { cwd: os.tmpdir(), encoding: 'utf8', env: { ...SAFE_ENV, ...extraEnv }, timeout: 20000 });
  const line = /^HOST 0 workers in 0 runs \(cap \d; \d+\.\d GB free by (vm_stat|freemem)\)$/m;
  const plain = run({});
  assert.match(plain.stdout, line, plain.stdout + plain.stderr);
  if (process.platform === 'darwin') {
    assert.match(plain.stdout, /by vm_stat\)/);
    assert.match(run({ PATH: '/nonexistent' }).stdout, /by vm_stat\)/, 'no PATH needed');
    assert.match(run({ BOARD_CHECK_VM_STAT: '/nonexistent/vm_stat' }).stdout, /by freemem\)/, 'vm_stat failed: the fallback is named');
    const junk = path.join(tmp('hs-bin-'), 'vm_stat');
    fs.writeFileSync(junk, '#!/bin/sh\necho nothing useful\n', { mode: 0o755 });
    assert.match(run({ BOARD_CHECK_VM_STAT: junk }).stdout, /by freemem\)/, 'output that does not parse: the fallback is named');
  } else {
    assert.match(plain.stdout, /by freemem\)/);
  }
});

test('--host: memory bounds only the workers still to add; the running ones are already in the free figure', () => {
  const sessions = tmp('hs-');
  const { file } = twoWorkers();
  host(sessions, '--register', file);
  // 2 workers run; 4 GB free at 3 GB each leaves room for 1 more: cap 3 (the third-worker limit), not 1
  const room = host(sessions, '--cores', '16', '--free-gb', '4', '--peak-gb', '3');
  assert.strictEqual(room.status, 0, room.stdout);
  assert.strictEqual(room.stdout, 'HOST 2 workers in 1 runs (cap 3; 4.0 GB free by --free-gb)\n');
  const none = host(sessions, '--cores', '16', '--free-gb', '2', '--peak-gb', '3');
  assert.strictEqual(none.status, 1, none.stdout);
  assert.strictEqual(none.stdout, 'HOST 2 workers in 1 runs (cap 2; 2.0 GB free by --free-gb)\nHOST AT CAP: start no new worker\n');
  // the cores bound is host-wide
  assert.match(host(sessions, '--cores', '4', '--free-gb', '30').stdout, /\(cap 2;/);
});

test('parseVmStat: free + inactive + speculative + purgeable pages times the page size', () => {
  const text = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                               10000.',
    'Pages active:                            400000.',
    'Pages inactive:                          300000.',
    'Pages speculative:                         5000.',
    'Pages throttled:                              0.',
    'Pages wired down:                        150000.',
    'Pages purgeable:                          20000.',
    '"Translation faults":                  123456789.',
  ].join('\n');
  assert.strictEqual(callExport('parseVmStat', text), (10000 + 300000 + 5000 + 20000) * 16384);
  assert.strictEqual(callExport('parseVmStat', text.replace('16384', '4096')), (10000 + 300000 + 5000 + 20000) * 4096);
  assert.strictEqual(callExport('parseVmStat', 'not vm_stat output'), null);
  assert.strictEqual(callExport('parseVmStat', text.replace(/^Pages purgeable.*$/m, '')), null);
});

test('--host: usage errors exit 2 (a board without --register, a board with no heading)', () => {
  const sessions = tmp('hs-');
  const { file } = twoWorkers();
  assert.strictEqual(spawnSync(process.execPath, [CHECK, '--host', file], { encoding: 'utf8', env: SAFE_ENV }).status, 2);
  const noHeading = path.join(tmp('hs-'), 'board.md');
  fs.writeFileSync(noHeading, fs.readFileSync(file, 'utf8').replace(/^# Board: r1\n/m, ''));
  const r = host(sessions, '--register', noHeading);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /# Board: <run>/);
});

console.log('\ncoordinate-sessions: worktree-add');

/** A main checkout with ignored env files, a tracked .env.example, untracked plans, and a board with a Setup line. */
function mainWithEnv(setup = 'touch installed.txt') {
  const dir = tmp('wt-main-');
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, '.gitignore', '.env\n.env.*\n!.env.example\nnode_modules/\n');
  write(dir, '.env.example', 'KEY=\n');
  write(dir, 'src/a.ts', 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  write(dir, '.env', 'KEY=secret\n');
  write(dir, 'apps/web/.env.local', 'WEB=1\n');
  write(dir, 'node_modules/pkg/.env', 'skip\n');
  write(dir, '.review-work/sessions/r1/.env.board', 'skip\n');
  write(dir, '.claude/plans/plan.md', 'the plan\n');
  write(dir, '.claude/plans/.env.local', 'PLANS=1\n');
  write(dir, '.claude/plans/node_modules/x/.env', 'NESTED=secret\n');
  const board = path.join(tmp('wt-board-'), 'board.md');
  fs.writeFileSync(board, `# Board: r1\n\nMainline: main\nSetup: ${setup}\n\n## Units\n`);
  return { dir, board };
}

function addWorktree(main, extra = [], { script = WTADD, wt = null, umask = null } = {}) {
  const target = wt ?? path.join(tmp('wt-out-'), 'wt');
  const args = [script, '--branch', 'work/shop', '--path', target, '--base', 'main', '--board', main.board, ...extra];
  const r = umask
    ? spawnSync('/bin/sh', ['-c', `umask ${umask}; exec "$0" "$@"`, process.execPath, ...args], { cwd: main.dir, encoding: 'utf8', env: ENV, timeout: 60000 })
    : spawnSync(process.execPath, args, { cwd: main.dir, encoding: 'utf8', env: ENV, timeout: 60000 });
  return { r, target };
}

test('worktree-add: makes the worktree, links env files, copies the plans, runs Setup, ends READY', () => {
  const main = mainWithEnv();
  const { r, target } = addWorktree(main);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const sha = git(main.dir, 'rev-parse', 'main').slice(0, 12);
  const out = r.stdout.trim().split('\n');
  assert.deepStrictEqual(out, [
    `WORKTREE ${target} work/shop from ${sha}`,
    'ENV 3 linked',
    'COPY .claude/plans',
    'SETUP touch installed.txt exit 0',
    `WORKTREE READY ${target}`,
  ]);
  for (const f of ['.env', 'apps/web/.env.local', '.claude/plans/.env.local']) {
    assert.ok(fs.lstatSync(path.join(target, f)).isSymbolicLink(), `${f} is a symlink`);
    assert.strictEqual(fs.readlinkSync(path.join(target, f)), path.join(fs.realpathSync(main.dir), f));
  }
  assert.ok(!fs.existsSync(path.join(target, 'node_modules')), 'node_modules env files are skipped');
  assert.ok(!fs.existsSync(path.join(target, '.review-work')), '.review-work/ env files are skipped (kills: the scan takes them)');
  assert.ok(!fs.existsSync(path.join(target, '.claude/plans/node_modules/x/.env')), 'an env file inside a copied folder is never copied');
  assert.ok(!fs.lstatSync(path.join(target, '.env.example')).isSymbolicLink(), 'the tracked example stays a file');
  assert.strictEqual(fs.readFileSync(path.join(target, '.claude/plans/plan.md'), 'utf8'), 'the plan\n');
  assert.ok(!fs.lstatSync(path.join(target, '.claude/plans/plan.md')).isSymbolicLink(), 'copied, not linked');
  assert.ok(fs.existsSync(path.join(target, 'installed.txt')), 'Setup ran in the worktree');
  assert.strictEqual(git(target, 'rev-parse', '--abbrev-ref', 'HEAD'), 'work/shop');
});

test('worktree-add: runs under umask 022 whatever the caller\'s umask', () => {
  const main = mainWithEnv();
  const { r, target } = addWorktree(main, [], { umask: '077' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(fs.statSync(target).mode & 0o777, 0o755);
});

const hooksOf = (cwd) => {
  const r = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd, encoding: 'utf8', env: ENV });
  return r.status === 0 ? r.stdout.trim() : undefined;
};

test('worktree-add: core.hooksPath is put back after the install, unset when it was unset', () => {
  const unset = mainWithEnv('git config core.hooksPath .husky/_');
  const a = addWorktree(unset);
  assert.strictEqual(a.r.status, 0, a.r.stdout + a.r.stderr);
  assert.ok(a.r.stdout.includes('HOOKS restored unset\n'), a.r.stdout);
  assert.ok(a.r.stdout.indexOf('SETUP') < a.r.stdout.indexOf('HOOKS restored'), 'after the install');
  assert.strictEqual(hooksOf(unset.dir), undefined, 'unset again');
  const quiet = addWorktree(mainWithEnv('true'));
  assert.ok(!quiet.r.stdout.includes('HOOKS'), 'unset before and after: no line');
  const outside = mainWithEnv('true');
  git(outside.dir, 'config', '--local', 'core.hooksPath', '/opt/shared-hooks');
  const o = addWorktree(outside);
  assert.ok(!o.r.stdout.includes('HOOKS'), 'an absolute value outside every worktree, left alone: no line');
  assert.strictEqual(hooksOf(outside.dir), '/opt/shared-hooks');
});

test('worktree-add: the value written back is absolute and in the main checkout', () => {
  // the install points the shared config at the NEW worktree, which a later delete would leave without hooks
  const flip = mainWithEnv('git config core.hooksPath "$(git rev-parse --show-toplevel)/.githooks"');
  git(flip.dir, 'config', '--local', 'core.hooksPath', '.githooks');
  const a = addWorktree(flip);
  assert.strictEqual(a.r.status, 0, a.r.stdout + a.r.stderr);
  const want = path.join(fs.realpathSync(flip.dir), '.githooks');
  assert.strictEqual(hooksOf(flip.dir), want);
  assert.ok(a.r.stdout.includes(`HOOKS restored ${want}\n`), a.r.stdout);
  // a relative value the install left alone is rewritten too
  const rel = mainWithEnv('true');
  git(rel.dir, 'config', '--local', 'core.hooksPath', '.githooks');
  const b = addWorktree(rel);
  assert.strictEqual(hooksOf(rel.dir), path.join(fs.realpathSync(rel.dir), '.githooks'));
  assert.ok(b.r.stdout.includes(`HOOKS restored ${path.join(fs.realpathSync(rel.dir), '.githooks')}\n`), b.r.stdout);
  // a value inside a linked worktree moves to the same place in the main checkout
  const moved = mainWithEnv('true');
  const other = path.join(tmp('wt-other-'), 'other');
  git(moved.dir, 'worktree', 'add', '-q', '-b', 'other', other, 'main');
  git(moved.dir, 'config', '--local', 'core.hooksPath', path.join(other, 'tools', 'hooks'));
  const c = addWorktree(moved);
  assert.strictEqual(c.r.status, 0, c.r.stdout + c.r.stderr);
  assert.strictEqual(hooksOf(moved.dir), path.join(fs.realpathSync(moved.dir), 'tools', 'hooks'));
  // an absolute value in the main checkout stays as it is, even when the install moved it
  const kept = mainWithEnv('git config core.hooksPath .other');
  const mainHooks = path.join(fs.realpathSync(kept.dir), '.githooks');
  git(kept.dir, 'config', '--local', 'core.hooksPath', mainHooks);
  const d = addWorktree(kept);
  assert.strictEqual(hooksOf(kept.dir), mainHooks);
  assert.ok(d.r.stdout.includes(`HOOKS restored ${mainHooks}\n`), d.r.stdout);
});

test('worktree-add: a value git expands itself (~/ and %(prefix)/) is left as it is (kills: resolved against the main checkout)', () => {
  assert.strictEqual(callWt('hooksValue', '/m', '~/.githooks', ['/m']), '~/.githooks');
  assert.strictEqual(callWt('hooksValue', '/m', '~', ['/m']), '~');
  assert.strictEqual(callWt('hooksValue', '/m', '%(prefix)/share/hooks', ['/m']), '%(prefix)/share/hooks');
  assert.strictEqual(callWt('hooksValue', '/m', '.githooks', ['/m']), '/m/.githooks', 'a relative value still resolves');
  const home = mainWithEnv('true');
  git(home.dir, 'config', '--local', 'core.hooksPath', '~/.githooks');
  const r = addWorktree(home);
  assert.strictEqual(r.r.status, 0, r.r.stdout + r.r.stderr);
  assert.ok(!r.r.stdout.includes('HOOKS'), r.r.stdout);
  assert.strictEqual(hooksOf(home.dir), '~/.githooks');
});

test('worktree-add: hooksValue moves a value inside another worktree by its real path, and leaves one that is in main alone (kills: realpath dropped, main not skipped)', () => {
  const base = fs.realpathSync(tmp('wt-hv-'));
  const main = path.join(base, 'main');
  const other = path.join(base, 'other');
  fs.mkdirSync(path.join(main, '.githooks'), { recursive: true });
  fs.mkdirSync(path.join(other, 'tools', 'hooks'), { recursive: true });
  fs.symlinkSync(other, path.join(base, 'link-to-other'));
  fs.symlinkSync(path.join(main, '.githooks'), path.join(base, 'link-to-main-hooks'));
  assert.strictEqual(callWt('hooksValue', main, path.join(base, 'link-to-other', 'tools', 'hooks'), [main, other]), path.join(main, 'tools', 'hooks'), 'a symlink into another worktree');
  assert.strictEqual(callWt('hooksValue', main, path.join(other, 'tools', 'hooks'), [main, other]), path.join(main, 'tools', 'hooks'));
  assert.strictEqual(callWt('hooksValue', main, path.join(base, 'link-to-main-hooks'), [main, other]), path.join(base, 'link-to-main-hooks'), 'a path already reaching main is not rewritten');
  assert.strictEqual(callWt('hooksValue', main, path.join(base, 'elsewhere'), [main, other]), path.join(base, 'elsewhere'));
});

test('worktree-add: a repository whose git dir is outside its checkout (--separate-git-dir) works from the main checkout, and the hooks value is restored (kills: main from the common dir)', () => {
  const root = fs.realpathSync(tmp('wt-sep-'));
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main', '--separate-git-dir', path.join(root, 'gitdir.git'));
  write(work, 'a.txt', 'a\n');
  write(work, '.gitignore', '.env\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'init');
  write(work, '.env', 'KEY=1\n');
  git(work, 'config', '--local', 'core.hooksPath', '.githooks');
  const board = path.join(root, 'board.md');
  fs.writeFileSync(board, '# Board: r1\n\nMainline: main\nSetup: git config core.hooksPath "$PWD/.githooks" && touch probe-1.tmp\n\n## Units\n');
  const script = path.join(root, 'worktree-add.mjs');
  fs.writeFileSync(script, fs.readFileSync(WTADD, 'utf8').replace('export const LEFTOVERS = [];', () => "export const LEFTOVERS = ['(^|/)probe-[0-9]+\\\\.tmp$'];"));
  const target = path.join(root, 'wt');
  const run = (cwd, to, extra = []) => spawnSync(process.execPath, [script, '--branch', 'work/shop', '--path', to, '--base', 'main', '--board', board, ...extra], { cwd, encoding: 'utf8', env: ENV, timeout: 60000 });
  const r = run(work, target);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(hooksOf(work), path.join(work, '.githooks'), 'absolute, in the main checkout');
  assert.ok(r.stdout.includes(`HOOKS restored ${path.join(work, '.githooks')}\n`), r.stdout);
  assert.ok(r.stdout.includes('ENV 1 linked\n'), r.stdout);
  assert.ok(r.stdout.includes('LEFTOVER removed probe-1.tmp\n'), 'the later steps run (kills: LEFTOVERS skipped after a failed hooks step)');
  assert.ok(r.stdout.trim().endsWith(`WORKTREE READY ${target}`), r.stdout);
  // from a linked worktree the main checkout of such a repository cannot be found: refused before anything is made
  const second = path.join(root, 'wt2');
  const linked = run(target, second);
  assert.strictEqual(linked.status, 1, linked.stdout + linked.stderr);
  assert.match(linked.stdout, /^WORKTREE FAILED worktree: .*run this from the main checkout$/m);
  assert.ok(!fs.existsSync(second), 'nothing was made');
  assert.strictEqual(git(work, 'branch', '--list', 'work/shop').includes('work/shop'), true);
});

test('worktree-add: a bare repository has no main checkout: refused before anything is created, from itself or from a worktree of it (kills: bare accepted)', () => {
  const root = fs.realpathSync(tmp('wt-bare-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  git(src, 'init', '-q', '-b', 'main');
  write(src, 'a.txt', 'a\n');
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', 'init');
  const bare = path.join(root, 'bare.git');
  git(root, 'clone', '-q', '--bare', src, bare);
  const other = path.join(root, 'bare-wt');
  git(bare, 'worktree', 'add', '-q', other, 'main');
  for (const [cwd, name] of [[bare, 'itself'], [other, 'a worktree of it']]) {
    const to = path.join(root, `made-from-${name.split(' ')[0]}`);
    const r = spawnSync(process.execPath, [WTADD, '--branch', 'work/shop', '--path', to, '--base', 'main'], { cwd, encoding: 'utf8', env: ENV, timeout: 60000 });
    assert.strictEqual(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^WORKTREE FAILED worktree: /m, name);
    assert.ok(!fs.existsSync(to), `${name}: nothing was made`);
  }
  const itself = spawnSync(process.execPath, [WTADD, '--branch', 'work/shop', '--path', path.join(root, 'x'), '--base', 'main'], { cwd: bare, encoding: 'utf8', env: ENV });
  assert.match(itself.stdout, /is a bare repository: it has no main checkout/);
  assert.strictEqual(git(bare, 'branch', '--list', 'work/shop'), '', 'no branch was made');
});

test('worktree-add: no Setup line, or `-`, means no install; a failing install ends FAILED but keeps the worktree', () => {
  const none = mainWithEnv('-');
  const a = addWorktree(none);
  assert.strictEqual(a.r.status, 0, a.r.stdout + a.r.stderr);
  assert.ok(!a.r.stdout.includes('SETUP'), a.r.stdout);
  const bare = mainWithEnv();
  const noBoard = spawnSync(process.execPath, [WTADD, '--branch', 'work/shop', '--path', path.join(tmp('wt-out-'), 'wt'), '--base', 'main'], { cwd: bare.dir, encoding: 'utf8', env: ENV });
  assert.strictEqual(noBoard.status, 0, noBoard.stdout + noBoard.stderr);
  assert.ok(!noBoard.stdout.includes('SETUP'));
  const bad = mainWithEnv('exit 3');
  const f = addWorktree(bad);
  assert.strictEqual(f.r.status, 1, f.r.stdout + f.r.stderr);
  assert.ok(f.r.stdout.includes('SETUP exit 3 exit 3\n'), f.r.stdout);
  assert.match(f.r.stdout, /^WORKTREE FAILED setup: exit 3; the worktree at .+ stays$/m);
  assert.ok(fs.existsSync(f.target), 'the worktree stays for the controller to look at');
});

test('worktree-add: a path that already exists is refused and left alone; so is a base that is no commit', () => {
  const main = mainWithEnv();
  const taken = tmp('wt-taken-');
  write(taken, 'keep.txt', 'mine\n');
  const { r } = addWorktree(main, [], { wt: taken });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^WORKTREE FAILED worktree: .* already exists$/m);
  assert.deepStrictEqual(fs.readdirSync(taken), ['keep.txt']);
  assert.strictEqual(git(main.dir, 'worktree', 'list').split('\n').length, 1);
  const badBase = spawnSync(process.execPath, [WTADD, '--branch', 'b', '--path', path.join(tmp('wt-out-'), 'wt'), '--base', 'no-such-ref'], { cwd: main.dir, encoding: 'utf8', env: ENV });
  assert.strictEqual(badBase.status, 1, badBase.stdout + badBase.stderr);
  assert.match(badBase.stdout, /^WORKTREE FAILED worktree: base no-such-ref is not a commit$/m);
});

test('worktree-add: --dry-run prints the plan and changes nothing', () => {
  const main = mainWithEnv('git config core.hooksPath .husky/_');
  const { r, target } = addWorktree(main, ['--dry-run']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^PLAN worktree git worktree add -b work\/shop /m);
  assert.match(r.stdout, /^PLAN env 3 linked: \.claude\/plans\/\.env\.local \.env apps\/web\/\.env\.local$/m);
  assert.match(r.stdout, /^PLAN copy \.claude\/plans$/m);
  assert.match(r.stdout, /^PLAN setup git config core\.hooksPath \.husky\/_$/m);
  assert.ok(r.stdout.endsWith(`WORKTREE DRY RUN ${target}\n`), r.stdout);
  assert.ok(!fs.existsSync(target), 'no directory');
  assert.strictEqual(git(main.dir, 'worktree', 'list').split('\n').length, 1);
  assert.strictEqual(git(main.dir, 'branch', '--list', 'work/shop'), '');
  assert.strictEqual(spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: main.dir, encoding: 'utf8', env: ENV }).status, 1);
});

test('worktree-add: LEFTOVERS patterns delete matching untracked files after the install and nothing else', () => {
  const main = mainWithEnv('touch probe-1.tmp keep.txt; mkdir -p src && touch src/probe-2.tmp');
  write(main.dir, 'probe-7.tmp', 'tracked on purpose\n');
  git(main.dir, 'add', 'probe-7.tmp');
  git(main.dir, 'commit', '-q', '-m', 'a tracked file the pattern matches');
  const script = path.join(tmp('wt-script-'), 'worktree-add.mjs');
  fs.writeFileSync(script, fs.readFileSync(WTADD, 'utf8').replace('export const LEFTOVERS = [];', () => "export const LEFTOVERS = ['(^|/)probe-[0-9]+\\\\.tmp$'];"));
  const { r, target } = addWorktree(main, [], { script });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('LEFTOVER removed probe-1.tmp\n'), r.stdout);
  assert.ok(r.stdout.includes('LEFTOVER removed src/probe-2.tmp\n'), r.stdout);
  assert.ok(!fs.existsSync(path.join(target, 'probe-1.tmp')) && !fs.existsSync(path.join(target, 'src/probe-2.tmp')));
  assert.ok(fs.existsSync(path.join(target, 'keep.txt')));
  assert.ok(fs.existsSync(path.join(target, 'probe-7.tmp')), 'a tracked file that matches stays (kills: tracked files listed too)');
  assert.ok(r.stdout.trim().endsWith(`WORKTREE READY ${target}`));
});

test('worktree-add: missing flags exit 2', () => {
  const main = mainWithEnv();
  assert.strictEqual(spawnSync(process.execPath, [WTADD, '--branch', 'x'], { cwd: main.dir, encoding: 'utf8', env: ENV }).status, 2);
  assert.strictEqual(spawnSync(process.execPath, [WTADD, '--bogus'], { cwd: main.dir, encoding: 'utf8', env: ENV }).status, 2);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
