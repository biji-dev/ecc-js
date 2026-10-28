/**
 * Tests for the checkout scope and Branch-cell matching of the shipped commit guard
 * (skills/harness-bootstrap/templates/harness-guard.sh).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const GUARD = process.env.GUARD_UNDER_TEST
  || path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'harness-guard.sh');
// GUARD_SHELL=/bin/dash runs the whole suite with the hook executed by that shell.
const GUARD_SHELL = process.env.GUARD_SHELL || '/bin/sh';

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

/**
 * Hermetic env for every git spawn. git sets GIT_DIR and GIT_INDEX_FILE inside hooks, so a
 * suite run from a hook would otherwise write into the parent repository.
 */
function gitEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return { ...env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', ...extra };
}

function git(cwd, args, extra = {}) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(), ...extra });
}

/** The shipped guard with its SCOPE binding line (and, when given, its ID_PATTERN line) replaced. */
function guardText(scope, { idPattern } = {}) {
  const text = fs.readFileSync(GUARD, 'utf8').replace(/^#!.*\n/, `#!${GUARD_SHELL}\n`);
  let out = text.replace(/^SCOPE="[^"]*"/m, `SCOPE="${scope}"`);
  assert.ok(out.includes(`SCOPE="${scope}"`), 'SCOPE binding substituted');
  if (idPattern !== undefined) {
    out = out.replace(/^ID_PATTERN='[^']*'/m, `ID_PATTERN='${idPattern}'`);
    assert.ok(out.includes(`ID_PATTERN='${idPattern}'`), 'ID_PATTERN binding substituted');
  }
  return out;
}

function guardedRepo(guard, { tracked = false } = {}) {
  const dir = tmp('harness-scope-');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(dir, '.githooks'));
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.githooks', 'pre-commit'), guard, { mode: 0o755 });
  git(dir, ['config', 'core.hooksPath', '.githooks']);
  fs.writeFileSync(path.join(dir, '.gitignore'), `${tracked ? '' : '.claude/registry.md\n'}.worktrees/\n`);
  setRegistry(dir, '');
  git(dir, ['add', '-A']);
  const init = git(dir, ['commit', '-qm', 'init']);
  assert.strictEqual(init.status, 0, `init commit failed: ${init.stderr}`);
  return dir;
}

const WT_HEADER = '| # | Task | Step | Branch | Worktree | Claimed (UTC) |';
const PLAIN_HEADER = '| # | Task | Step | Branch | Claimed (UTC) |';

function setRegistry(dir, rows, header = PLAIN_HEADER) {
  const sep = `|${header.split('|').slice(1, -1).map(() => '---').join('|')}|`;
  fs.writeFileSync(
    path.join(dir, '.claude', 'registry.md'),
    ['# Registry', '<!-- harness:active -->', header, sep, '| 0 | mainline | | | |', rows, '<!-- /harness:active -->', ''].join('\n')
  );
}

/** Section lines written as given: no header, separator or row 0 added. */
function setRegistryRaw(dir, lines, eol = '\n') {
  fs.writeFileSync(
    path.join(dir, '.claude', 'registry.md'),
    ['# Registry', '<!-- harness:active -->', ...lines, '<!-- /harness:active -->', ''].join(eol)
  );
}

/** Markers around the data rows only: `above` (header, separator) sits outside the section. */
function setRegistryAround(dir, above, inside) {
  fs.writeFileSync(
    path.join(dir, '.claude', 'registry.md'),
    ['# Registry', ...above, '<!-- harness:active -->', ...inside, '<!-- /harness:active -->', ''].join('\n')
  );
}

function addWorktree(dir, rel, branch) {
  const target = path.resolve(dir, rel);
  const result = git(dir, ['worktree', 'add', '-q', target, '-b', branch]);
  assert.strictEqual(result.status, 0, `worktree add failed: ${result.stderr}`);
  return fs.realpathSync(target);
}

function tryCommit(dir) {
  fs.appendFileSync(path.join(dir, 'work.txt'), 'x\n');
  git(dir, ['add', 'work.txt']);
  const result = git(dir, ['commit', '-qm', 'work']);
  if (result.status !== 0) git(dir, ['reset', '-q']);
  return result;
}

function cleanup(dir, ...extra) {
  git(dir, ['worktree', 'prune']);
  for (const p of [dir, ...extra]) fs.rmSync(p, { recursive: true, force: true });
}

function assertAllowed(result) {
  assert.strictEqual(result.status, 0, `expected allow, got ${result.status}: ${result.stderr.trim()}`);
}

function assertRefused(result, pattern) {
  assert.notStrictEqual(result.status, 0, 'expected refuse, commit went through');
  assert.match(result.stderr, /harness guard: REFUSE/);
  if (pattern) assert.match(result.stderr, pattern);
}

const hasGit = spawnSync('git', ['--version'], { env: gitEnv() }).status === 0;

// Row locking the linked worktree .worktrees/fix-a, no matching branch on main.
const ROW_FIX_A = '| 1 | `fix-a` | 1 | fix/a | `.worktrees/fix-a` | 2026-10-09T10:00Z |';

/** Case 1's setup: main checkout on main, a held row whose Worktree is a real linked worktree. */
function case1Setup() {
  const dir = guardedRepo(guardText('checkout'));
  addWorktree(dir, '.worktrees/fix-a', 'fix/a');
  setRegistry(dir, ROW_FIX_A, WT_HEADER);
  return dir;
}

console.log('\nharness guard: checkout scope and Branch-cell matching (the shipped file)');

if (!hasGit) {
  console.log('  - skipped: git is not available');
} else {
  test('checkout scope: main commit allowed while the only held row locks .worktrees/fix-a', () => {
    const dir = case1Setup();
    try { assertAllowed(tryCommit(dir)); } finally { cleanup(dir); }
  });

  test('checkout scope: main commit refused while a held row has Worktree main', () => {
    const dir = guardedRepo(guardText('checkout'));
    try {
      setRegistry(dir, '| 1 | `fix-b` | 1 | fix/b | main | 2026-10-09T10:00Z |', WT_HEADER);
      assertRefused(tryCommit(dir), /not the task branch|not its task branch/);
    } finally { cleanup(dir); }
  });

  test('checkout scope: linked worktree on id-less fix/login commits via its Branch cell and Worktree', () => {
    const dir = guardedRepo(guardText('checkout'));
    try {
      const wt = addWorktree(dir, '.worktrees/fix-login', 'fix/login');
      setRegistry(dir, '| 1 | `fix-login` | 1 | `fix/login` | `.worktrees/fix-login` · 2 files | 2026-10-09T10:00Z |', WT_HEADER);
      assertAllowed(tryCommit(wt));
    } finally { cleanup(dir); }
  });

  test('checkout scope: linked worktree with no row is not blocked by a row locking another worktree', () => {
    const dir = guardedRepo(guardText('checkout'));
    try {
      addWorktree(dir, '.worktrees/fix-a', 'fix/a');
      const other = addWorktree(dir, '.worktrees/fix-other', 'fix/other');
      setRegistry(dir, ROW_FIX_A, WT_HEADER);
      assertAllowed(tryCommit(other));
    } finally { cleanup(dir); }
  });

  test('checkout scope: row for the branch that locks another checkout refuses with "locks ... not this checkout"', () => {
    const dir = guardedRepo(guardText('checkout'));
    try {
      git(dir, ['switch', '-qc', 'fix/login']);
      setRegistry(dir, '| 1 | `fix-login` | 1 | fix/login | `.worktrees/elsewhere` | 2026-10-09T10:00Z |', WT_HEADER);
      const result = tryCommit(dir);
      assertRefused(result, /row for fix\/login locks .*elsewhere, not this checkout/);
    } finally { cleanup(dir); }
  });

  for (const scope of ['repo', 'checkout']) {
    test(`${scope} scope: task-id branch with no row is refused`, () => {
      const dir = guardedRepo(guardText(scope));
      try {
        git(dir, ['switch', '-qc', 'task/T-AB-12-x']);
        setRegistry(dir, '', scope === 'checkout' ? WT_HEADER : PLAIN_HEADER);
        assertRefused(tryCommit(dir), /Claim the lock first/);
      } finally { cleanup(dir); }
    });
  }

  test('repo scope: the checkout-scope setup is refused (one lock for the whole clone)', () => {
    const dir = guardedRepo(guardText('repo'));
    try {
      addWorktree(dir, '.worktrees/fix-a', 'fix/a');
      setRegistry(dir, ROW_FIX_A, WT_HEADER);
      assertRefused(tryCommit(dir));
    } finally { cleanup(dir); }
  });

  test('repo scope: id-less branch fix/login matching a held row Branch cell is allowed', () => {
    const dir = guardedRepo(guardText('repo'));
    try {
      git(dir, ['switch', '-qc', 'fix/login']);
      setRegistry(dir, '| 1 | `fix-login` | 1 | `fix/login` | 2026-10-09T10:00Z |');
      assertAllowed(tryCommit(dir));
    } finally { cleanup(dir); }
  });

  test('checkout scope: a registry without a Worktree column locks the main checkout', () => {
    const dir = guardedRepo(guardText('checkout'));
    try {
      setRegistry(dir, '| 1 | `fix-c` | 1 | fix/c | 2026-10-09T10:00Z |');
      assertRefused(tryCommit(dir));
      setRegistry(dir, '');
      assertAllowed(tryCommit(dir));
    } finally { cleanup(dir); }
  });

  // ---- Branch column: the branch name matches only that column's cell ----
  const BASE_HEADER = '| # | Task | Step | Branch | Base | Claimed (UTC) |';
  for (const scope of ['repo', 'checkout']) {
    test(`${scope} scope: a Base cell equal to main does not let a mainline commit through`, () => {
      const dir = guardedRepo(guardText(scope));
      try {
        setRegistry(dir, '| 1 | T-AB-12 | 1 | task/T-AB-12-x | main | 2026-10-09T10:00Z |', BASE_HEADER);
        assertRefused(tryCommit(dir), /not its task branch/);
      } finally { cleanup(dir); }
    });

    test(`${scope} scope: a branch named like a Task cell does not match that row`, () => {
      const dir = guardedRepo(guardText(scope));
      try {
        git(dir, ['switch', '-qc', 'login']);
        setRegistry(dir, '| 1 | login | 1 | fix/login | 2026-10-09T10:00Z |');
        assertRefused(tryCommit(dir), /not its task branch/);
      } finally { cleanup(dir); }
    });
  }

  test('a registry with no Branch column still matches the branch name against any other cell', () => {
    const dir = guardedRepo(guardText('repo'));
    try {
      git(dir, ['switch', '-qc', 'fix/login']);
      setRegistry(dir, '| 1 | `fix/login` | 1 | 2026-10-09T10:00Z |', '| # | Name | Step | Claimed (UTC) |');
      assertAllowed(tryCommit(dir));
    } finally { cleanup(dir); }
  });

  // ---- Worktree placeholders lock the main checkout like an empty cell ----
  for (const cell of ['-', '—', 'n/a', 'N/A', 'none', 'None']) {
    test(`checkout scope: Worktree placeholder '${cell}' locks the main checkout`, () => {
      const dir = guardedRepo(guardText('checkout'));
      try {
        setRegistry(dir, `| 1 | fix-b | 1 | fix/b | ${cell} | 2026-10-09T10:00Z |`, WT_HEADER);
        assertRefused(tryCommit(dir), /not its task branch/);
      } finally { cleanup(dir); }
    });
  }

  // ---- Worktree cells are compared as physical paths ----
  const wtSpecs = [
    ['a sibling worktree given as ../<name>', (dir) => {
      const sib = `${dir}-sib`;
      const wt = addWorktree(dir, sib, 'fix/x');
      return { cell: `../${path.basename(sib)}`, wt, extra: [sib] };
    }],
    ['a ./ prefix and a trailing slash', (dir) => {
      const wt = addWorktree(dir, '.worktrees/x', 'fix/x');
      return { cell: './.worktrees/x/', wt, extra: [] };
    }],
    ['an absolute path reached through a symlink', (dir) => {
      const wt = addWorktree(dir, '.worktrees/x', 'fix/x');
      const link = `${dir}-link`;
      fs.symlinkSync(dir, link);
      return { cell: `${link}/.worktrees/x`, wt, extra: [link] };
    }],
  ];
  function wtScenario(spec, ownerBranch, dirScope = 'checkout', mutate = (t) => t) {
    const dir = guardedRepo(mutate(guardText(dirScope)));
    const { cell, wt, extra } = spec(dir);
    const other = addWorktree(dir, '.worktrees/other', 'fix/other');
    setRegistry(dir, `| 1 | job | 1 | ${ownerBranch} | ${cell} | 2026-10-09T10:00Z |`, WT_HEADER);
    return { dir, other, wt, extra };
  }
  for (const [label, spec] of wtSpecs) {
    test(`checkout scope: ${label} -> allowed from the worktree it names, refused from the wrong one`, () => {
      const right = wtScenario(spec, 'fix/x');
      try {
        assertAllowed(tryCommit(right.wt));
      } finally { cleanup(right.dir, ...right.extra); }
      const wrong = wtScenario(spec, 'fix/other');
      try {
        assertRefused(tryCommit(wrong.other), /row for fix\/other locks .*, not this checkout/);
      } finally { cleanup(wrong.dir, ...wrong.extra); }
    });
  }

  test('checkout scope: a Worktree cell like `x`·2 files (no space before the dot) names that path', () => {
    const dir = guardedRepo(guardText('checkout'));
    try {
      const wt = addWorktree(dir, '.worktrees/x', 'fix/x');
      setRegistry(dir, '| 1 | job | 1 | fix/x | `.worktrees/x`·2 files | 2026-10-09T10:00Z |', WT_HEADER);
      assertAllowed(tryCommit(wt));
    } finally { cleanup(dir); }
  });

  // ---- The header is the row directly above a separator row ----
  for (const scope of ['repo', 'checkout']) {
    test(`${scope} scope: a section with data rows only (no separator) treats every numbered row as held`, () => {
      const dir = guardedRepo(guardText(scope));
      try {
        setRegistryRaw(dir, ['| 1 | T-AB-12 | 1 | task/T-AB-12-x | 2026-10-09T10:00Z |']);
        assertRefused(tryCommit(dir), /not its task branch/);
      } finally { cleanup(dir); }
    });
  }

  // ---- Markers around the data rows only: the table header sits right above the begin marker ----
  const HL_ROW = '| 1 | T-AB-12 | 1 | task/T-AB-12-x | main | t |';
  const aboveOf = (header) => [header, `|${header.split('|').slice(1, -1).map(() => '---').join('|')}|`];
  for (const scope of ['repo', 'checkout']) {
    for (const [label, header] of [['Base', BASE_HEADER], ['Worktree', WT_HEADER]]) {
      test(`${scope} scope: header above the markers, a ${label} cell main refuses a mainline commit`, () => {
        const dir = guardedRepo(guardText(scope));
        try {
          setRegistryAround(dir, aboveOf(header), [HL_ROW]);
          assertRefused(tryCommit(dir), /not its task branch/);
          git(dir, ['switch', '-qc', 'task/T-AB-12-x']);
          assertAllowed(tryCommit(dir));
        } finally { cleanup(dir); }
      });
    }
  }

  // ---- Rows without a trailing pipe (valid GFM) keep their last cell ----
  test('checkout scope: a Worktree column in last position, rows without a trailing pipe', () => {
    const dir = guardedRepo(guardText('checkout'));
    try {
      const wt = addWorktree(dir, '.worktrees/fix-a', 'fix/a');
      setRegistryRaw(dir, [
        '| # | Task | Branch | Worktree',
        '|---|---|---|---',
        '| 0 | mainline | |',
        '| 1 | fix-a | fix/a | .worktrees/fix-a',
      ]);
      assertAllowed(tryCommit(dir));
      assertAllowed(tryCommit(wt));
      setRegistryRaw(dir, ['| # | Task | Branch | Worktree', '|---|---|---|---', '| 1 | fix-b | fix/b | main']);
      assertRefused(tryCommit(dir), /not its task branch/);
    } finally { cleanup(dir); }
  });

  // ---- CRLF registries (written on Windows) keep their last cell ----
  test('a CRLF registry: a last-position Worktree cell and a last-position Branch cell still match', () => {
    const dir = guardedRepo(guardText('checkout'));
    try {
      setRegistryRaw(dir, ['| # | Task | Branch | Worktree', '|---|---|---|---', '| 0 | mainline | |', '| 1 | fix-b | fix/b | main'], '\r\n');
      assertRefused(tryCommit(dir), /not its task branch/);
      fs.writeFileSync(path.join(dir, '.githooks', 'pre-commit'), guardText('repo'), { mode: 0o755 });
      git(dir, ['switch', '-qc', 'fix/login']);
      setRegistryRaw(dir, ['| # | Task | Branch', '|---|---|---', '| 1 | fix-login | fix/login'], '\r\n');
      assertAllowed(tryCommit(dir));
    } finally { cleanup(dir); }
  });

  // ---- A Worktree cell is a path, never a name match ----
  test('a Worktree cell equal to the branch name is not a match (no Branch column)', () => {
    const header = '| # | Task | Worktree | Claimed (UTC) |';
    const row = '| 1 | job | fix/login | 2026-10-09T10:00Z |';
    const dir = guardedRepo(guardText('checkout'));
    const repoDir = guardedRepo(guardText('repo'));
    try {
      git(dir, ['switch', '-qc', 'fix/login']);
      setRegistry(dir, row, header);
      assertAllowed(tryCommit(dir)); // the row locks another path, not this checkout
      git(repoDir, ['switch', '-qc', 'fix/login']);
      setRegistry(repoDir, row, header);
      assertRefused(tryCommit(repoDir), /not its task branch/); // unmatched: refused while a row is held
    } finally { cleanup(dir, repoDir); }
  });

  // ---- The current checkout is compared physically even when git reports a symlinked path ----
  test('the current checkout is resolved physically when rev-parse --show-toplevel returns a symlink', () => {
    const dir = guardedRepo(guardText('checkout'));
    const link = `${dir}-link`;
    const shimDir = tmp('harness-shim-');
    try {
      const wt = addWorktree(dir, '.worktrees/x', 'fix/x');
      fs.symlinkSync(dir, link);
      setRegistry(dir, '| 1 | job | 1 | fix/x | `.worktrees/x` | 2026-10-09T10:00Z |', WT_HEADER);
      const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
      fs.writeFileSync(path.join(shimDir, 'git'), [
        '#!/bin/sh',
        'if [ "$1" = rev-parse ] && [ "$2" = --show-toplevel ]; then printf "%s\\n" "$SHIM_TOP"; exit 0; fi',
        'exec "$SHIM_REAL_GIT" "$@"',
        '',
      ].join('\n'), { mode: 0o755 });
      const result = spawnSync(GUARD_SHELL, [path.join(dir, '.githooks', 'pre-commit')], {
        cwd: wt,
        encoding: 'utf8',
        env: gitEnv({
          PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
          SHIM_TOP: `${link}/.worktrees/x`,
          SHIM_REAL_GIT: realGit,
        }),
      });
      assertAllowed(result);
    } finally { cleanup(dir, link, shimDir); }
  });

  // ---- A tracked registry: the release commit is the only commit allowed without a row ----
  test('checkout scope: a tracked registry allows a commit that only removes this task row', () => {
    const dir = guardedRepo(guardText('checkout'), { tracked: true });
    try {
      git(dir, ['switch', '-qc', 'task/T-AB-12-x']);
      setRegistry(dir, '| 1 | T-AB-12 | 1 | task/T-AB-12-x | main | 2026-10-09T10:00Z |', WT_HEADER);
      git(dir, ['add', '.claude/registry.md']);
      assertAllowed(git(dir, ['commit', '-qm', 'claim']));
      setRegistry(dir, '', WT_HEADER);
      fs.appendFileSync(path.join(dir, 'work.txt'), 'x\n');
      git(dir, ['add', '.claude/registry.md', 'work.txt']);
      assertRefused(git(dir, ['commit', '-qm', 'release and work']), /Claim the lock first/);
      git(dir, ['reset', '-q', 'work.txt']);
      assertAllowed(git(dir, ['commit', '-qm', 'release']));
    } finally { cleanup(dir); }
  });

  // ---- Task ids match case-insensitively: ids are uppercase, branches conventionally lowercase ----
  for (const scope of ['repo', 'checkout']) {
    const header = scope === 'checkout' ? WT_HEADER : PLAIN_HEADER;
    const row = scope === 'checkout'
      ? '| 1 | P2-20 | 1 | seg/other | main | 2026-10-09T10:00Z |'
      : '| 1 | P2-20 | 1 | seg/other | 2026-10-09T10:00Z |';
    test(`${scope} scope: lowercase branch task/p2-20 owns the row whose Task cell is P2-20`, () => {
      const dir = guardedRepo(guardText(scope));
      try {
        setRegistry(dir, row, header);
        assertRefused(tryCommit(dir), /not its task branch/); // the mainline stays refused while held
        git(dir, ['switch', '-qc', 'task/p2-20']);
        assertAllowed(tryCommit(dir));
        git(dir, ['switch', '-qc', 'task/p2-21']);
        assertRefused(tryCommit(dir), /Claim the lock first/); // another lowercase id: no row
      } finally { cleanup(dir); }
    });
  }

  test('a suffixed id (T-SEC-030b) matches from a lowercase or mixed-case branch', () => {
    const dir = guardedRepo(guardText('repo'));
    try {
      setRegistry(dir, '| 1 | T-SEC-030b | 1 | seg/other | 2026-10-09T10:00Z |');
      for (const branch of ['task/t-sec-030b-x', 'task/T-Sec-030b-y']) {
        git(dir, ['switch', '-qc', branch]);
        assertAllowed(tryCommit(dir));
        git(dir, ['switch', '-q', 'main']);
      }
    } finally { cleanup(dir); }
  });

  // ---- Dotted ids (EP-27.01): the default pattern cuts them; the bound one owns the row ----
  test('dotted ids: the default pattern cuts EP-27.01 and refuses its owner; EP-[0-9]+\\.[0-9]+ allows it', () => {
    const row = '| 1 | EP-27.01 | 1 | seg/other | 2026-10-19T09:00Z |'; // Branch cell elsewhere: only the id can match
    const cut = guardedRepo(guardText('repo'));
    try {
      setRegistry(cut, row);
      git(cut, ['switch', '-qc', 'ep-27.01-contract']);
      assertRefused(tryCommit(cut)); // EP-27 holds no row: why the id self-test exists
    } finally { cleanup(cut); }
    const dir = guardedRepo(guardText('repo', { idPattern: 'EP-[0-9]+\\.[0-9]+' }));
    try {
      setRegistry(dir, row);
      assertRefused(tryCommit(dir), /not its task branch/);
      git(dir, ['switch', '-qc', 'ep-27.01-contract']);
      assertAllowed(tryCommit(dir));
      git(dir, ['switch', '-qc', 'ep-27.02-mock']);
      assertRefused(tryCommit(dir), /Claim the lock first/); // a neighbouring dotted id: no row
    } finally { cleanup(dir); }
  });

  test('a tracked registry: the release commit on a lowercase branch is allowed, other commits are not', () => {
    const dir = guardedRepo(guardText('repo'), { tracked: true });
    try {
      git(dir, ['switch', '-qc', 'task/p2-20']);
      setRegistry(dir, '| 1 | P2-20 | 1 | seg/other | 2026-10-09T10:00Z |');
      git(dir, ['add', '.claude/registry.md']);
      assertAllowed(git(dir, ['commit', '-qm', 'claim']));
      setRegistry(dir, '');
      fs.appendFileSync(path.join(dir, 'work.txt'), 'x\n');
      git(dir, ['add', '.claude/registry.md', 'work.txt']);
      assertRefused(git(dir, ['commit', '-qm', 'release and work']), /Claim the lock first/);
      git(dir, ['reset', '-q', 'work.txt']);
      assertAllowed(git(dir, ['commit', '-qm', 'release']));
    } finally { cleanup(dir); }
  });

  test('mutation: matching the id without uppercasing the branch refuses the lowercase owner', () => {
    const from = "tr '[:lower:]' '[:upper:]' | grep -oE";
    assert.ok(fs.readFileSync(GUARD, 'utf8').includes(from), 'the uppercasing exists in the shipped file');
    const mutant = guardText('repo').replace(from, 'grep -oE');
    assert.ok(!mutant.includes(from), 'replacement applied');
    const dir = guardedRepo(mutant);
    try {
      setRegistry(dir, '| 1 | P2-20 | 1 | seg/other | 2026-10-09T10:00Z |');
      git(dir, ['switch', '-qc', 'task/p2-20']);
      assertRefused(tryCommit(dir));
    } finally { cleanup(dir); }
  });

  // ---- Change mode: ID_PATTERN='' means no id matching; plan mode keeps the plan's id shape ----
  for (const scope of ['repo', 'checkout']) {
    const header = scope === 'checkout' ? WT_HEADER : PLAIN_HEADER;
    const cell = (v) => (scope === 'checkout' ? `| 1 | job | 1 | ${v} | main | 2026-10-09T10:00Z |` : `| 1 | job | 1 | ${v} | 2026-10-09T10:00Z |`);
    test(`${scope} scope: plan-mode pattern reads fix/UTF-8-bom as a task id and refuses it with no row`, () => {
      const dir = guardedRepo(guardText(scope));
      try {
        git(dir, ['switch', '-qc', 'fix/UTF-8-bom']);
        assertRefused(tryCommit(dir), /carries UTF-8, which holds no row/);
      } finally { cleanup(dir); }
    });

    test(`${scope} scope: empty ID_PATTERN allows fix/UTF-8-bom with no row held`, () => {
      const dir = guardedRepo(guardText(scope, { idPattern: '' }));
      try {
        git(dir, ['switch', '-qc', 'fix/UTF-8-bom']);
        setRegistry(dir, '', header);
        assertAllowed(tryCommit(dir));
      } finally { cleanup(dir); }
    });

    test(`${scope} scope: empty ID_PATTERN matches a row by its Branch cell only`, () => {
      const dir = guardedRepo(guardText(scope, { idPattern: '' }));
      try {
        git(dir, ['switch', '-qc', 'fix/UTF-8-bom']);
        setRegistry(dir, cell('fix/UTF-8-bom'), header);
        assertAllowed(tryCommit(dir)); // its own row
        setRegistry(dir, cell('fix/other'), header);
        assertRefused(tryCommit(dir), /not its task branch/); // another unit's row is held
        git(dir, ['switch', '-q', 'main']);
        assertRefused(tryCommit(dir), /not its task branch/); // the mainline is still locked
      } finally { cleanup(dir); }
    });

    test(`${scope} scope: empty ID_PATTERN does not let an id-shaped Task cell claim a row`, () => {
      const dir = guardedRepo(guardText(scope, { idPattern: '' }));
      try {
        git(dir, ['switch', '-qc', 'fix/UTF-8-bom']);
        setRegistry(dir, scope === 'checkout'
          ? '| 1 | UTF-8 | 1 | fix/other | main | 2026-10-09T10:00Z |'
          : '| 1 | UTF-8 | 1 | fix/other | 2026-10-09T10:00Z |', header);
        assertRefused(tryCommit(dir), /not its task branch/);
      } finally { cleanup(dir); }
    });
  }

  // ---- Merges: a --no-ff merge runs pre-merge-commit, not pre-commit ----
  function installMergeHook(dir, guard) {
    fs.writeFileSync(path.join(dir, '.githooks', 'pre-merge-commit'), guard, { mode: 0o755 });
  }
  /** feature branch with one commit, then back on main; the registry is not written yet. */
  function featureBranch(dir) {
    git(dir, ['switch', '-qc', 'feature']);
    fs.writeFileSync(path.join(dir, 'feature.txt'), 'f\n');
    git(dir, ['add', 'feature.txt']);
    assertAllowed(git(dir, ['commit', '-qm', 'feature work']));
    git(dir, ['switch', '-q', 'main']);
  }
  const mergeFeature = (dir) => git(dir, ['merge', '--no-ff', '-m', 'merge feature', 'feature']);

  for (const scope of ['repo', 'checkout']) {
    const header = scope === 'checkout' ? WT_HEADER : PLAIN_HEADER;
    const held = scope === 'checkout'
      ? '| 1 | T-AB-12 | 1 | task/T-AB-12-x | main | 2026-10-09T10:00Z |'
      : '| 1 | T-AB-12 | 1 | task/T-AB-12-x | 2026-10-09T10:00Z |';
    test(`${scope} scope: installed as pre-commit only, a no-ff merge goes through while a row is held (why pre-merge-commit is needed)`, () => {
      const dir = guardedRepo(guardText(scope));
      try {
        featureBranch(dir);
        setRegistry(dir, held, header);
        assertAllowed(mergeFeature(dir));
      } finally { cleanup(dir); }
    });

    test(`${scope} scope: installed as pre-merge-commit too, a no-ff merge into main is refused while a row is held, allowed after release`, () => {
      const guard = guardText(scope);
      const dir = guardedRepo(guard);
      installMergeHook(dir, guard);
      try {
        featureBranch(dir);
        setRegistry(dir, held, header);
        assertRefused(mergeFeature(dir), /not its task branch/);
        git(dir, ['merge', '--abort']);
        git(dir, ['reset', '-q', '--hard']);
        setRegistry(dir, '', header); // land order: release, then merge
        assertAllowed(mergeFeature(dir));
        assert.ok(fs.existsSync(path.join(dir, 'feature.txt')), 'the merge landed');
      } finally { cleanup(dir); }
    });
  }

  // ---- Merging a branch whose row is still held: refused in either scope (land order: release first) ----
  /** Checkout scope, both hooks; task/p2-20 in the linked worktree .worktrees/held with one commit to `file`. */
  function heldBranchSetup(file = 'held.txt') {
    const guard = guardText('checkout');
    const dir = guardedRepo(guard);
    installMergeHook(dir, guard);
    const wt = addWorktree(dir, '.worktrees/held', 'task/p2-20');
    fs.writeFileSync(path.join(wt, file), 'held\n');
    git(wt, ['add', file]);
    assertAllowed(git(wt, ['commit', '-qm', 'held work', '--no-verify'])); // set-up: before its row is written
    return { dir, wt };
  }
  const HELD_ROWS = [
    ['its Branch cell', '| 1 | P2-20 | 2 | task/p2-20 | `.worktrees/held` | 2026-10-09T10:00Z |'],
    ['the task id the merged name carries', '| 1 | P2-20 | 2 | seg/other | `.worktrees/held` | 2026-10-09T10:00Z |'],
  ];
  const mergeHeld = (dir) => git(dir, ['merge', '--no-ff', '-m', 'merge task/p2-20', 'task/p2-20']);
  const STILL_HELD = /merging 'task\/p2-20', which still holds a row in \.claude\/registry\.md.*release its row first/;

  for (const [label, row] of HELD_ROWS) {
    test(`checkout scope: a clean --no-ff merge of a branch whose row is held (matched by ${label}) is refused by pre-merge-commit; released, it merges`, () => {
      const { dir } = heldBranchSetup();
      try {
        setRegistry(dir, row, WT_HEADER);
        assertAllowed(tryCommit(dir)); // the row locks .worktrees/held, not the main checkout
        assertRefused(mergeHeld(dir), STILL_HELD);
        git(dir, ['merge', '--abort']);
        setRegistry(dir, '', WT_HEADER);
        assertAllowed(mergeHeld(dir));
        assert.ok(fs.existsSync(path.join(dir, 'held.txt')), 'the merge landed');
      } finally { cleanup(dir); }
    });
  }

  /** A conflicted merge of `branch` into main, resolved and staged: the commit that concludes it runs pre-commit. */
  function conflictedMerge(dir, branch) {
    fs.writeFileSync(path.join(dir, 'work.txt'), 'main\n');
    git(dir, ['add', 'work.txt']);
    assertAllowed(git(dir, ['commit', '-qm', 'main work']));
    const m = git(dir, ['merge', '--no-ff', '-m', `merge ${branch}`, branch]);
    assert.notStrictEqual(m.status, 0, 'the merge conflicts');
    assert.ok(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD')), 'the merge is in progress');
    fs.writeFileSync(path.join(dir, 'work.txt'), 'resolved\n');
    git(dir, ['add', 'work.txt']);
  }

  test('checkout scope: a conflicted merge of a branch whose row is held, concluded with git commit, is refused (MERGE_HEAD, no reflog action); released, it commits', () => {
    const { dir } = heldBranchSetup('work.txt');
    try {
      setRegistry(dir, HELD_ROWS[0][1], WT_HEADER);
      conflictedMerge(dir, 'task/p2-20');
      assertRefused(git(dir, ['commit', '-qm', 'conclude merge']), /merging 'task\/p2-20', which still holds a row.*release its row first/);
      setRegistry(dir, '', WT_HEADER);
      assertAllowed(git(dir, ['commit', '-qm', 'conclude merge']));
      assert.ok(!fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD')), 'the merge is concluded');
    } finally { cleanup(dir); }
  });

  test('checkout scope: merging a branch that holds no row goes through, clean or concluded with git commit, while another branch holds one', () => {
    const { dir } = heldBranchSetup();
    try {
      featureBranch(dir);
      setRegistry(dir, HELD_ROWS[0][1], WT_HEADER);
      assertAllowed(mergeFeature(dir));
      git(dir, ['switch', '-qc', 'other']);
      fs.writeFileSync(path.join(dir, 'work.txt'), 'other\n');
      git(dir, ['add', 'work.txt']);
      assertAllowed(git(dir, ['commit', '-qm', 'other work']));
      git(dir, ['switch', '-q', 'main']);
      conflictedMerge(dir, 'other');
      assertAllowed(git(dir, ['commit', '-qm', 'conclude merge']));
    } finally { cleanup(dir); }
  });

  test("checkout scope: a held branch claimed at main's tip with no commits of its own; another branch merging main, concluded with git commit, is allowed", () => {
    const guard = guardText('checkout');
    const dir = guardedRepo(guard);
    installMergeHook(dir, guard);
    try {
      git(dir, ['switch', '-qc', 'other']);
      fs.writeFileSync(path.join(dir, 'work.txt'), 'other\n');
      git(dir, ['add', 'work.txt']);
      assertAllowed(git(dir, ['commit', '-qm', 'other work']));
      git(dir, ['switch', '-q', 'main']);
      fs.writeFileSync(path.join(dir, 'work.txt'), 'main\n');
      git(dir, ['add', 'work.txt']);
      assertAllowed(git(dir, ['commit', '-qm', 'main work']));
      addWorktree(dir, '.worktrees/held', 'task/p2-20'); // claimed at main's tip, no commits yet
      setRegistry(dir, HELD_ROWS[0][1], WT_HEADER);
      git(dir, ['switch', '-q', 'other']);
      assert.notStrictEqual(git(dir, ['merge', '--no-ff', '-m', 'merge main', 'main']).status, 0, 'the merge conflicts');
      fs.writeFileSync(path.join(dir, 'work.txt'), 'resolved\n');
      git(dir, ['add', 'work.txt']);
      const tip = git(dir, ['rev-parse', 'task/p2-20']).stdout.trim();
      assert.strictEqual(git(dir, ['rev-parse', 'MERGE_HEAD']).stdout.trim(), tip, 'MERGE_HEAD is the held branch tip');
      assertAllowed(git(dir, ['commit', '-qm', 'conclude merge'])); // main points at it too and holds no row
    } finally { cleanup(dir); }
  });

  test('checkout scope: a held branch with work of its own, also at refs/remotes/origin/task/p2-20, merged with a conflict and concluded, is still refused', () => {
    const { dir } = heldBranchSetup('work.txt');
    try {
      const tip = git(dir, ['rev-parse', 'task/p2-20']).stdout.trim();
      assert.strictEqual(git(dir, ['update-ref', 'refs/remotes/origin/task/p2-20', tip]).status, 0, 'update-ref');
      setRegistry(dir, HELD_ROWS[0][1], WT_HEADER);
      conflictedMerge(dir, 'task/p2-20');
      assertRefused(git(dir, ['commit', '-qm', 'conclude merge']), STILL_HELD);
    } finally { cleanup(dir); }
  });

  // ---- Names as typed, pulls and commit matches: refused while held work is merged ----
  /** Checkout scope, both hooks; task/held in .worktrees/held with a commit of its own to `file`, its row held. */
  function heldWorkSetup({ idPattern, file = 'held.txt' } = {}) {
    const guard = guardText('checkout', { idPattern });
    const dir = guardedRepo(guard);
    installMergeHook(dir, guard);
    const wt = addWorktree(dir, '.worktrees/held', 'task/held');
    fs.writeFileSync(path.join(wt, file), 'held\n');
    git(wt, ['add', file]);
    assertAllowed(git(wt, ['commit', '-qm', 'held work', '--no-verify'])); // set-up: before its row is written
    setRegistry(dir, '| 1 | held | 2 | task/held | `.worktrees/held` | 2026-10-09T10:00Z |', WT_HEADER);
    return { dir, wt };
  }
  const HELD_WORK = /merging 'task\/held', which still holds a row.*release its row first/;
  /** A bare remote `origin` with task/held pushed to it and fetched back. */
  function pushedHeld(dir, wt) {
    const bare = tmp('harness-scope-remote-');
    git(bare, ['init', '-q', '--bare']);
    assert.strictEqual(git(dir, ['remote', 'add', 'origin', bare]).status, 0, 'remote add');
    assertAllowed(git(wt, ['push', '-q', 'origin', 'task/held']));
    assertAllowed(git(dir, ['fetch', '-q', 'origin']));
    return bare;
  }

  test('checkout scope, change mode: a clean --no-ff merge of refs/heads/task/held is refused', () => {
    const { dir } = heldWorkSetup({ idPattern: '' });
    try {
      assertRefused(git(dir, ['merge', '--no-ff', '-m', 'merge', 'refs/heads/task/held']), HELD_WORK);
    } finally { cleanup(dir); }
  });

  test('checkout scope, change mode: a clean --no-ff merge of origin/task/held, pushed to a bare remote, is refused', () => {
    const { dir, wt } = heldWorkSetup({ idPattern: '' });
    const bare = pushedHeld(dir, wt);
    try {
      assertRefused(git(dir, ['merge', '--no-ff', '-m', 'merge', 'origin/task/held']), HELD_WORK);
    } finally { cleanup(dir, bare); }
  });

  test('checkout scope: git pull --no-ff origin task/held is refused', () => {
    const { dir, wt } = heldWorkSetup();
    const bare = pushedHeld(dir, wt);
    try {
      assertRefused(git(dir, ['pull', '-q', '--no-ff', '--no-edit', 'origin', 'task/held']), HELD_WORK);
    } finally { cleanup(dir, bare); }
  });

  test('checkout scope: a clean --no-ff merge of an unheld copy branch at the held tip (held work of its own) is refused', () => {
    const { dir } = heldWorkSetup();
    try {
      assert.strictEqual(git(dir, ['branch', 'copy', 'task/held']).status, 0, 'branch copy');
      assertRefused(git(dir, ['merge', '--no-ff', '-m', 'merge copy', 'copy']), HELD_WORK);
    } finally { cleanup(dir); }
  });

  test('checkout scope: a conflicted merge of that copy branch, concluded with git commit, is refused', () => {
    const { dir } = heldWorkSetup({ file: 'work.txt' });
    try {
      assert.strictEqual(git(dir, ['branch', 'copy', 'task/held']).status, 0, 'branch copy');
      conflictedMerge(dir, 'copy');
      assertRefused(git(dir, ['commit', '-qm', 'conclude merge']), HELD_WORK);
    } finally { cleanup(dir); }
  });

  /** Tracked registry; task/T-AB-12-x has no row left after merging `side`, which only releases it. */
  function releaseMergeSetup(install) {
    const guard = guardText('repo');
    const dir = guardedRepo(guard, { tracked: true });
    install(dir, guard);
    const row = '| 1 | T-AB-12 | 1 | seg/other | 2026-10-09T10:00Z |';
    setRegistry(dir, row);
    git(dir, ['add', '.claude/registry.md']);
    assertAllowed(git(dir, ['commit', '-qm', 'claim', '--no-verify'])); // set-up: claimed on main
    // a side branch whose only change is the release; --no-verify: the row is still held here
    git(dir, ['switch', '-qc', 'side']);
    setRegistry(dir, '');
    git(dir, ['add', '.claude/registry.md']);
    assertAllowed(git(dir, ['commit', '-qm', 'release', '--no-verify']));
    git(dir, ['switch', '-q', 'main']);
    git(dir, ['switch', '-qc', 'task/T-AB-12-x']);
    fs.writeFileSync(path.join(dir, 'own.txt'), 'o\n');
    git(dir, ['add', 'own.txt']);
    assertAllowed(git(dir, ['commit', '-qm', 'own work'])); // its row is held: allowed
    return dir;
  }
  const asMergeHook = (dir, guard) => installMergeHook(dir, guard);
  // husky-style: the hook files are wrappers, so $0 of the guard is harness-guard.sh
  const asWrappedHooks = (dir, guard) => {
    fs.writeFileSync(path.join(dir, '.githooks', 'harness-guard.sh'), guard, { mode: 0o755 });
    const wrapper = '#!/bin/sh\nsh .githooks/harness-guard.sh || exit 1\n';
    fs.writeFileSync(path.join(dir, '.githooks', 'pre-commit'), wrapper, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, '.githooks', 'pre-merge-commit'), wrapper, { mode: 0o755 });
  };

  test('a merge that only removes this task row from a tracked registry is not a release commit', () => {
    const dir = releaseMergeSetup(asMergeHook);
    try {
      assertRefused(git(dir, ['merge', '--no-ff', '-m', 'merge side', 'side']), /Claim the lock first/);
    } finally { cleanup(dir); }
  });

  test('the same merge through a wrapper hook (guard run as harness-guard.sh) is refused, clean and --no-commit', () => {
    const dir = releaseMergeSetup(asWrappedHooks);
    try {
      assertRefused(git(dir, ['merge', '--no-ff', '-m', 'merge side', 'side']), /Claim the lock first/);
      git(dir, ['merge', '--abort']);
      git(dir, ['reset', '-q', '--hard']);
      assertAllowed(git(dir, ['merge', '--no-ff', '--no-commit', 'side']));
      assertRefused(git(dir, ['commit', '-qm', 'conclude merge']), /Claim the lock first/); // MERGE_HEAD is set here
    } finally { cleanup(dir); }
  });

  test('mutation: dropping the merge check lets that merge through as a release commit', () => {
    const from = 'if [ "$merging" = 0 ] && [ "$staged"';
    assert.ok(fs.readFileSync(GUARD, 'utf8').includes(from), 'the merge check exists in the shipped file');
    const apply = (install) => (dir, guard) => {
      const out = guard.replace(from, 'if [ "$staged"');
      assert.ok(!out.includes(from), 'replacement applied');
      install(dir, out);
    };
    const dir = releaseMergeSetup(apply(asMergeHook));
    try {
      assertAllowed(git(dir, ['merge', '--no-ff', '-m', 'merge side', 'side']));
    } finally { cleanup(dir); }
  });

  test('the header comment lists exactly the [B] lines the file has', () => {
    const lines = fs.readFileSync(GUARD, 'utf8').split('\n');
    const bound = lines.filter((l) => /^[A-Z_]+=.*#\s*\[B\]/.test(l)).map((l) => l.split('=')[0]);
    assert.deepStrictEqual(bound, ['REGISTRY', 'ID_PATTERN', 'SCOPE', 'MAINLINE']);
    const header = lines.slice(0, 6).join('\n');
    assert.match(header, /\[B\] REGISTRY, ID_PATTERN, SCOPE and MAINLINE/);
    assert.ok(!/four settings|three settings/.test(header), 'no stale count');
    const stray = lines.slice(6).filter((l) => /\[B\]/.test(l) && !/^[A-Z_]+=/.test(l));
    assert.deepStrictEqual(stray, [], '[B] appears only on binding lines after the header');
  });

  test('an invalid SCOPE value is refused', () => {
    const dir = guardedRepo(guardText('repo'));
    try {
      const text = guardText('repo').replace('SCOPE="repo"', 'SCOPE="everything"');
      assert.ok(text.includes('SCOPE="everything"'), 'replacement applied');
      fs.writeFileSync(path.join(dir, '.githooks', 'pre-commit'), text, { mode: 0o755 });
      assertRefused(tryCommit(dir), /invalid SCOPE 'everything'/);
    } finally { cleanup(dir); }
  });

  test('mutation: counting every row as locking this checkout makes case 1 refuse', () => {
    const original = fs.readFileSync(GUARD, 'utf8');
    const from = 'is_here() { [ "$1" = "$curp" ]; }';
    const mutant = guardText('checkout').replace(from, 'is_here() { true; }');
    assert.ok(original.includes(from), 'the comparison exists in the shipped file');
    assert.ok(!mutant.includes(from), 'replacement applied');
    const dir = guardedRepo(mutant);
    try {
      addWorktree(dir, '.worktrees/fix-a', 'fix/a');
      setRegistry(dir, ROW_FIX_A, WT_HEADER);
      assertRefused(tryCommit(dir));
    } finally { cleanup(dir); }
  });

  test('mutation: dropping the physical-path resolve makes every non-trivial Worktree spelling refuse its owner', () => {
    const from = 'res=$(cd "$p" 2>/dev/null && pwd -P) || res=$p';
    assert.ok(fs.readFileSync(GUARD, 'utf8').includes(from), 'the resolve exists in the shipped file');
    const apply = (t) => {
      const out = t.replace(from, 'res=$p');
      assert.ok(!out.includes(from), 'replacement applied');
      return out;
    };
    for (const [label, spec] of wtSpecs) {
      const s = wtScenario(spec, 'fix/x', 'checkout', apply);
      try {
        assertRefused(tryCommit(s.wt), /not this checkout/);
      } catch (error) {
        error.message = `${label}: ${error.message}`;
        throw error;
      } finally { cleanup(s.dir, ...s.extra); }
    }
  });
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
