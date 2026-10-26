/**
 * Tests for the harness-bootstrap unit-stack template (biji-dev/ecc-js): the slot lock it keeps in the
 * registry, in real repositories with linked worktrees. The [B] block is replaced by a binding whose stack is
 * a few files, and a fake lsof on PATH answers which ports listen. Then mutation checks.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TEMPLATE = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'unit-stack.sh');

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

const created = [];
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

// The stack is files under $FAKE: serves-<slot> holds the checkout it serves, calls logs every up and down,
// sick keeps it from answering. MIN_FREE_GB and HEALTH_WAIT come from the environment so a test can move them.
const BLOCK = /^# >>> unit-stack \[B\][^\n]*\n[\s\S]*?^# <<< unit-stack$/m;
const BINDING = `# >>> unit-stack [B] - the test binding
REGISTRY=.claude/registry.md
SLOTS="1 2 3"
MIN_FREE_GB=\${FAKE_MIN_FREE_GB:-0}
HEALTH_WAIT=\${FAKE_HEALTH_WAIT:-0}
slot_vars() {
  UNIT_SLOT=$1
  UNIT_PROJECT="t-u$1"
  UNIT_APP_PORT=$((4800 + 20 * $1))
  UNIT_DB_PORT=$((UNIT_APP_PORT + 1))
  UNIT_PORTS="$UNIT_APP_PORT $UNIT_DB_PORT"
}
stack_up() {
  echo "up $UNIT_SLOT $HERE" >>"$FAKE/calls"
  printf '%s\\n' "$HERE" >"$FAKE/serves-$UNIT_SLOT"
}
stack_down() {
  echo "down $UNIT_SLOT $HERE" >>"$FAKE/calls"
  rm -f "$FAKE/serves-$UNIT_SLOT"
}
stack_healthy() {
  [ -f "$FAKE/serves-$UNIT_SLOT" ] && [ ! -f "$FAKE/sick" ]
}
slot_env() {
  echo "BASE_URL=http://localhost:$UNIT_APP_PORT"
}
stack_serves() {
  cat "$FAKE/serves-$UNIT_SLOT" 2>/dev/null || true
}
# <<< unit-stack`;

const LSOF = '#!/bin/sh\nport=""\nfor a in "$@"; do case "$a" in -iTCP:*) port=${a#-iTCP:} ;; esac; done\n[ -n "$port" ] && [ -f "$FAKE/listen-$port" ]\n';

function boundText(text = fs.readFileSync(TEMPLATE, 'utf8')) {
  assert.match(text, BLOCK, 'the [B] block was not found in the template');
  return text.replace(BLOCK, () => BINDING);
}

// Hermetic git: no developer HOME, global or system config, and no GIT_* from a calling hook.
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
for (const key of Object.keys(ENV)) if (key.startsWith('GIT_') && !key.startsWith('GIT_CONFIG')) delete ENV[key];
Object.assign(ENV, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' });

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

/** A main checkout with two linked worktrees, a fake stack and the bound script (or `text`, a mutant). */
function world(text = boundText()) {
  const base = tmp('unit-stack-');
  const main = path.join(base, 'repo');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'README.md'), 'x\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  for (const u of ['u1', 'u2']) git(main, 'worktree', 'add', '-q', path.join('.worktrees', u), '-b', `task/${u}`);
  const fake = path.join(base, 'fake');
  fs.mkdirSync(path.join(fake, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(fake, 'bin', 'lsof'), LSOF, { mode: 0o755 });
  const script = path.join(fake, 'unit-stack.sh');
  fs.writeFileSync(script, text);
  fs.mkdirSync(path.join(main, '.claude'));
  const w = {
    main,
    u1: path.join(main, '.worktrees', 'u1'),
    u2: path.join(main, '.worktrees', 'u2'),
    fake,
    run(cwd, args, extra = {}) {
      const env = { ...ENV, HOME: base, FAKE: fake, PATH: `${path.join(fake, 'bin')}${path.delimiter}${process.env.PATH}`, ...extra };
      const r = spawnSync('/bin/bash', [script, ...args], { cwd, encoding: 'utf8', env });
      return { status: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}${r.stderr}` };
    },
    registry(rows, { before = '', after = '' } = {}) {
      const lines = [
        before,
        '<!-- harness:active -->',
        '| # | Unit | Step | Branch | Worktree | Resources | Claimed (UTC) |',
        '|---|---|---|---|---|---|---|',
        '| 0 | mainline, never claimed | | | main | | |',
        ...rows.map(([n, wt, res]) => `| ${n} | U-${n} | 3 | task/u${n} | ${wt} | ${res} | 2026-10-26 10:00 |`),
        '<!-- /harness:active -->',
        after,
      ];
      fs.writeFileSync(path.join(main, '.claude', 'registry.md'), lines.join('\n'));
    },
    listen(port, on = true) {
      const f = path.join(fake, `listen-${port}`);
      if (on) fs.writeFileSync(f, '');
      else fs.rmSync(f, { force: true });
    },
    calls() {
      const f = path.join(fake, 'calls');
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : [];
    },
    state(dir) {
      const f = path.join(dir, '.unit-stack.env');
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    },
  };
  w.registry([]);
  return w;
}

function refused(r, needle) {
  assert.strictEqual(r.status, 1, `expected exit 1: ${r.all}`);
  assert.match(r.err, needle, r.all);
}

console.log('\nharness unit-stack: the slot lock');

test('free-slot: the lowest slot no held row names, no stack serves and nothing listens on', () => {
  const w = world();
  assert.strictEqual(w.run(w.u1, ['free-slot']).out.trim(), '1');
  w.registry([[1, '.worktrees/u1', 'slot 1']]);
  assert.strictEqual(w.run(w.u1, ['free-slot']).out.trim(), '2');
  w.listen(4841); // slot 2's second port
  assert.strictEqual(w.run(w.u1, ['free-slot']).out.trim(), '3');
  fs.writeFileSync(path.join(w.fake, 'serves-3'), `${w.u2}\n`);
  refused(w.run(w.u1, ['free-slot']), /^unit-stack: no free slot in: 1 2 3$/m);
});

test('up refuses the main checkout, a bad slot, an unclaimed slot and a slot two rows hold, and starts nothing', () => {
  const w = world();
  w.registry([[1, 'main', 'slot 1']]);
  refused(w.run(w.main, ['up', '1']), /the main checkout is the owner's/);
  refused(w.run(w.u1, ['up', '9']), /usage: unit-stack\.sh up <slot> \(one of: 1 2 3\)/);
  refused(w.run(w.u1, ['up', '1']), /no held registry row names slot 1 for this worktree: claim it first/);
  w.registry([[1, '.worktrees/u1', 'slot 1'], [2, '.worktrees/u2', 'slot 1']]);
  refused(w.run(w.u1, ['up', '1']), new RegExp(`slot 1 is held by the registry row of ${w.u2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.deepStrictEqual(w.calls(), []);
  assert.strictEqual(w.state(w.u1), null);
});

test('up with its row starts the stack, records the slot and prints env; again it only re-runs stack_up', () => {
  const w = world();
  w.registry([[1, '.worktrees/u1', 'slot 2']]);
  const r = w.run(w.u1, ['up', '2']);
  assert.strictEqual(r.status, 0, r.all);
  assert.match(r.out, /^unit-stack: slot 2 is up\nUNIT_SLOT=2\nUNIT_PROJECT=t-u2\nUNIT_PORTS="4840 4841"\nBASE_URL=http:\/\/localhost:4840$/m);
  assert.strictEqual(w.state(w.u1), 'UNIT_SLOT=2\n');
  assert.deepStrictEqual(w.calls(), [`up 2 ${w.u1}`]);
  w.listen(4840); // the stack's own ports listen now
  w.listen(4841);
  const again = w.run(w.u1, ['up', '2']);
  assert.strictEqual(again.status, 0, again.all);
  refused(w.run(w.u1, ['up', '3']), /this worktree already runs slot 2; down it first/);
  assert.match(w.run(w.u1, ['status']).out, new RegExp(`serves ${w.u1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\nunit-stack: answering`));
  assert.strictEqual(w.run(w.u1, ['env']).out, 'UNIT_SLOT=2\nUNIT_PROJECT=t-u2\nUNIT_PORTS="4840 4841"\nBASE_URL=http://localhost:4840\n');
});

test('up refuses a port another process holds, a disk below the floor and a stack that never answers', () => {
  const w = world();
  w.registry([[1, w.u2, 'slot 1']]); // an absolute Worktree cell
  w.listen(4820);
  refused(w.run(w.u2, ['up', '1']), /port 4820 is in use by another process/);
  w.listen(4820, false);
  refused(w.run(w.u2, ['up', '1'], { FAKE_MIN_FREE_GB: '999999' }), /GB free, 999999 GB needed/);
  assert.deepStrictEqual(w.calls(), []);
  fs.writeFileSync(path.join(w.fake, 'sick'), '');
  refused(w.run(w.u2, ['up', '1']), /slot 1 did not answer within 0s/);
  assert.strictEqual(w.state(w.u2), 'UNIT_SLOT=1\n', 'the slot stays recorded, so down can remove the half-started stack');
  assert.strictEqual(w.run(w.u2, ['down']).status, 0);
});

test('down removes only what this worktree owns: a stale state file is refused, ports are checked after', () => {
  const w = world();
  w.registry([[1, '.worktrees/u1', 'slot 2']]);
  assert.strictEqual(w.run(w.u1, ['up', '2']).status, 0);
  fs.writeFileSync(path.join(w.u2, '.unit-stack.env'), 'UNIT_SLOT=2\n'); // left from an earlier run of slot 2
  refused(w.run(w.u2, ['down']), /slot 2 is held by the registry row of /);
  w.registry([]); // the row is gone, but u1's stack still runs
  refused(w.run(w.u2, ['down']), /slot 2 serves .*\/u1, not this worktree \(a stale \.unit-stack\.env here\?\)/);
  assert.deepStrictEqual(w.calls(), [`up 2 ${w.u1}`], 'nothing of u1 was removed');
  const down = w.run(w.u1, ['down']);
  assert.strictEqual(down.status, 0, down.all);
  assert.match(down.out, /slot 2 removed; its ports are free/);
  assert.strictEqual(w.state(w.u1), null);
  w.registry([[1, '.worktrees/u1', 'slot 2']]);
  assert.strictEqual(w.run(w.u1, ['up', '2']).status, 0);
  w.listen(4841); // a process the stack did not own
  refused(w.run(w.u1, ['down']), /port 4841 still listens after down/);
});

// A table after the active section whose numbered row names a slot in the Resources column: not a held row.
const PORT_TABLE_AFTER = '\n| # | Use | | | | Resources | |\n|---|---|---|---|---|---|---|\n| 1 | the owner\'s ports | | | | slot 1 | |\n';

test('the registry is read as the commit guard reads it: markers, a header above them, row 0, cell notes', () => {
  const w = world();
  // rows outside the markers and row 0 never hold a slot
  w.registry([], { before: '| # | Use | | | | Resources | |\n|---|---|---|---|---|---|---|\n| 1 | x | | | | slot 1 | |\n', after: PORT_TABLE_AFTER });
  assert.strictEqual(w.run(w.u1, ['free-slot']).out.trim(), '1');
  const reg = path.join(w.main, '.claude', 'registry.md');
  fs.writeFileSync(reg, fs.readFileSync(reg, 'utf8').replace('| 0 | mainline, never claimed | | | main | | |', '| 0 | mainline, never claimed | | | main | slot 1 | |'));
  assert.strictEqual(w.run(w.u1, ['free-slot']).out.trim(), '1');
  // markers around the data rows only, the header above them; a Worktree cell with a note, Resources with more
  const table = [
    '| # | Unit | Step | Branch | Worktree | Resources | Claimed (UTC) |',
    '|---|---|---|---|---|---|---|',
    '<!-- harness:active -->',
    '| 1 | U-1 | 3 | task/u1 | `.worktrees/u1` (unit 1) | ports 4820-4821, Slot 1 | 2026-10-26 10:00 |',
    '<!-- /harness:active -->',
    '',
  ];
  fs.writeFileSync(path.join(w.main, '.claude', 'registry.md'), table.join('\n'));
  assert.strictEqual(w.run(w.u1, ['free-slot']).out.trim(), '2');
  const r = w.run(w.u1, ['up', '1']);
  assert.strictEqual(r.status, 0, r.all);
});

// The commit guard binds the registry's path ([B] REGISTRY); unit-stack binds the same path, not a fixed one.
const MOVED = () => boundText().replace('REGISTRY=.claude/registry.md', 'REGISTRY=docs/registry.md');
function moveRegistry(w) {
  fs.mkdirSync(path.join(w.main, 'docs'), { recursive: true });
  fs.renameSync(path.join(w.main, '.claude', 'registry.md'), path.join(w.main, 'docs', 'registry.md'));
}

test('a registry kept at the bound REGISTRY path is the one read: free-slot skips its claim, up starts the stack', () => {
  const w = world(MOVED());
  w.registry([[1, '.worktrees/u1', 'slot 1']]);
  moveRegistry(w);
  assert.strictEqual(w.run(w.u2, ['free-slot']).out.trim(), '2');
  const r = w.run(w.u1, ['up', '1']);
  assert.strictEqual(r.status, 0, r.all);
  assert.deepStrictEqual(w.calls(), [`up 1 ${w.u1}`]);
});

test('no registry file at the bound path is an error naming the binding, never "nothing held"', () => {
  const w = world(MOVED());
  w.registry([[1, '.worktrees/u1', 'slot 1']]); // written at .claude/, where the binding does not look
  const needle = /no registry at .*\/docs\/registry\.md: bind REGISTRY in the \[B\] block of scripts\/unit-stack\.sh \(the commit guard's REGISTRY\)/;
  refused(w.run(w.u1, ['free-slot']), needle);
  refused(w.run(w.u1, ['up', '1']), needle);
  assert.deepStrictEqual(w.calls(), []);
  assert.strictEqual(w.state(w.u1), null);
});

test('down with the registry gone refuses before any teardown: the stack and its state file stay', () => {
  const w = world(MOVED());
  w.registry([[1, '.worktrees/u1', 'slot 2']]);
  moveRegistry(w);
  assert.strictEqual(w.run(w.u1, ['up', '2']).status, 0);
  fs.rmSync(path.join(w.main, 'docs', 'registry.md'));
  refused(w.run(w.u1, ['down']), /no registry at .*\/docs\/registry\.md: bind REGISTRY in the \[B\] block of scripts\/unit-stack\.sh \(the commit guard's REGISTRY\)/);
  assert.deepStrictEqual(w.calls(), [`up 2 ${w.u1}`], 'no down call');
  assert.strictEqual(w.state(w.u1), 'UNIT_SLOT=2\n');
});

test('the shipped [B] block is unbound: up names the block to edit and starts nothing', () => {
  const w = world(fs.readFileSync(TEMPLATE, 'utf8'));
  w.registry([[1, '.worktrees/u1', 'slot 1']]);
  refused(w.run(w.u1, ['up', '1']), /stack_up is not bound - edit the \[B\] block of scripts\/unit-stack\.sh/);
});

console.log('\nharness unit-stack: mutation');

/** The bound script with one line of the mechanism replaced. */
function mutant(from, to) {
  const text = boundText();
  assert.ok(text.includes(from), `not in the template: ${from}`);
  return text.replace(from, () => to);
}

test('mutant without the main-checkout refusal starts a unit stack serving the owner checkout', () => {
  const line = `[ "$HERE" != "$MAIN" ] || die "the main checkout is the owner's; a unit stack serves a worktree"`;
  const w = world(mutant(line, 'true'));
  w.registry([[1, 'main', 'slot 1']]);
  assert.strictEqual(w.run(w.main, ['up', '1']).status, 0);
  assert.deepStrictEqual(w.calls(), [`up 1 ${w.main}`]);
});

test('mutant without the other-row refusal starts a slot two rows hold', () => {
  const w = world(mutant('[ -z "$other" ] || die "slot $UNIT_SLOT is held by the registry row of $other"', 'true'));
  w.registry([[1, '.worktrees/u1', 'slot 1'], [2, '.worktrees/u2', 'slot 1']]);
  assert.strictEqual(w.run(w.u1, ['up', '1']).status, 0);
});

test('mutant without the served-checkout refusal removes another unit\'s stack through a stale state file', () => {
  const w = world(mutant('[ "$src" = "$HERE" ] || die "slot $UNIT_SLOT serves $src, not this worktree (a stale $STATE here?)"', 'true'));
  w.registry([[1, '.worktrees/u1', 'slot 2']]);
  assert.strictEqual(w.run(w.u1, ['up', '2']).status, 0);
  w.registry([]);
  fs.writeFileSync(path.join(w.u2, '.unit-stack.env'), 'UNIT_SLOT=2\n');
  assert.strictEqual(w.run(w.u2, ['down']).status, 0);
  assert.deepStrictEqual(w.calls(), [`up 2 ${w.u1}`, `down 2 ${w.u2}`]);
});

test('mutant that reads on past the end marker holds a slot the table after it names', () => {
  const w = world(mutant('    /<!-- \\/harness:active -->/ { on = 0 }', '    /<!-- \\/harness:active -->/ { }'));
  w.registry([], { after: PORT_TABLE_AFTER });
  assert.strictEqual(w.run(w.u1, ['free-slot']).out.trim(), '2');
});

test('mutant that counts row 0 holds the slot the mainline row names', () => {
  const w = world(mutant('if (num !~ /^[1-9][0-9]*$/) continue', 'if (num !~ /^[0-9]+$/) continue'));
  const reg = path.join(w.main, '.claude', 'registry.md');
  fs.writeFileSync(reg, fs.readFileSync(reg, 'utf8').replace('| main | | |', '| main | slot 1 | |'));
  assert.strictEqual(w.run(w.u1, ['free-slot']).out.trim(), '2');
});

test('mutant without the port check after down reports a leftover listener as free', () => {
  const w = world(mutant('  for p in $UNIT_PORTS; do listening "$p" && die "port $p still listens after down"; done\n', ''));
  w.registry([[1, '.worktrees/u1', 'slot 2']]);
  assert.strictEqual(w.run(w.u1, ['up', '2']).status, 0);
  w.listen(4841);
  const r = w.run(w.u1, ['down']);
  assert.strictEqual(r.status, 0, r.all);
  assert.match(r.out, /its ports are free/);
});

for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
