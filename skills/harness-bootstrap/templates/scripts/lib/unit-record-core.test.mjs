// harness-bootstrap unit-record tests (generated YYYY-MM-DD). Run: node --test scripts/lib/unit-record-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the tests read MAX_COMMITS, never its value.
// Hermetic: no network and no real repository. The wrapper runs in a temp git repo with every GIT_*
// variable stripped, GIT_CONFIG_GLOBAL=/dev/null and a fixed identity, so a suite run from a git hook
// can never write into the caller's repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MAX_COMMITS,
  buildRecord,
  formatElapsed,
  lastSummary,
  normalizeSeverity,
  normalizeStatus,
  parseArgs,
  parseState,
  splitRow,
  summarizeFindings,
} from './unit-record-core.mjs';

const RUNNER = fileURLToPath(new URL('../unit-record.mjs', import.meta.url));

const tempDirs = [];
function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Env for a spawned git or wrapper: no GIT_* variable, no global or system git config. */
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.HOME = tmpDir('unit-record-home-');
  return env;
}

const STATE = [
  '# Unit state',
  '',
  'Unit: EP-27.04',
  'Mode: plan',
  'Type: Code',
  'Tier: Full',
  'Branch: ep-27.04-foo',
  'Base: 1a2b3c4',
  'Claimed: 2026-10-24T03:10:00Z',
  'Owner wait: 1h20m',
  '',
  '## Ledger',
  '| Step | Status | Evidence |',
  '|---|---|---|',
  '| 8 review — code-reviewer | ran | 3 findings |',
  '',
  '## Findings',
  '| ID | Sev | Source | Also | Status | Note |',
  '|---|---|---|---|---|---|',
  '| F-1 | P1 | codex-review | | fixed abc1234 | a |',
  '| F-2 | P2 | opus-code-reviewer | codex-review | follow-up | b |',
  '| F-3 | P3 | silent-failure-hunter | | retracted | c |',
  '',
].join('\n');

const finding = (over) => ({
  id: 'F',
  sev: 'P1',
  source: 'codex-review',
  also: [],
  status: 'fixed',
  ...over,
});

test('splitRow honours an escaped pipe, trims cells and drops only the outer pipes', () => {
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
  assert.deepEqual(splitRow('a | b'), ['a', 'b']);
  assert.deepEqual(splitRow('| a | | c |'), ['a', '', 'c']);
  assert.deepEqual(splitRow('| a |  |'), ['a', '']);
  assert.deepEqual(splitRow('| ends with a pipe \\|'), ['ends with a pipe |']);
  assert.deepEqual(splitRow('| back\\slash | x |'), ['back\\slash', 'x']);
});

test('parseState reads the header, the ledger and the findings', () => {
  const s = parseState(STATE);
  assert.deepEqual(s.header, {
    unit: 'EP-27.04',
    mode: 'plan',
    type: 'Code',
    tier: 'Full',
    branch: 'ep-27.04-foo',
    base: '1a2b3c4',
    claimed: '2026-10-24T03:10:00Z',
    ownerWait: '1h20m',
  });
  assert.deepEqual(s.ledger, [{ step: '8 review — code-reviewer', status: 'ran', evidence: '3 findings' }]);
  assert.deepEqual(
    s.findings.map((f) => [f.id, f.sev, f.source, f.also, f.status]),
    [
      ['F-1', 'P1', 'codex-review', [], 'fixed'],
      ['F-2', 'P2', 'opus-code-reviewer', ['codex-review'], 'follow-up'],
      ['F-3', 'P3', 'silent-failure-hunter', [], 'retracted'],
    ],
  );
});

test('parseState finds columns by name: other order, an extra column, no Also column, an escaped pipe', () => {
  const s = parseState(
    [
      '## findings',
      '| Status | Note | Source | Extra | Sev | ID |',
      '|:--|---|:-:|---|---|---|',
      '| open | a \\| b, with a comma | codex-review | x | HIGH | F-9 |',
      '',
      '## LEDGER',
      '| Evidence | Step |',
      '|---|---|',
      '| 2 findings | 8 review \\| round 2 |',
    ].join('\n'),
  );
  assert.deepEqual(s.findings, [
    { id: 'F-9', sev: 'P1', source: 'codex-review', also: [], status: 'open' },
  ]);
  assert.deepEqual(s.ledger, [{ step: '8 review | round 2', status: '', evidence: '2 findings' }]);
});

test('parseState ignores other sections and a missing header; every field is optional', () => {
  const s = parseState(
    [
      'Unit: U-1',
      '',
      '## Notes',
      '| ID | Sev | Source |',
      '|---|---|---|',
      '| N-1 | P0 | not-a-finding |',
      '',
      '### Findings',
      '| ID | Sev | Source |',
      '| F-1 | P0 | not under a ## heading |',
    ].join('\n'),
  );
  assert.equal(s.header.unit, 'U-1');
  assert.equal(s.header.base, '');
  assert.deepEqual(s.findings, []);
  assert.deepEqual(s.ledger, []);
  assert.deepEqual(parseState('').header.unit, '');
  // A `Key: value` line after the first heading is prose, not a header line.
  assert.equal(parseState('## Notes\nBase: deadbeef\n').header.base, '');
});

const TABLE_STATE = [
  '# EP-27.04 — state',
  '',
  '| Field | Value |',
  '|---|---|',
  '| Branch | `ep-27.04-role-switcher` |',
  '| Base | `438801c` |',
  '| Claimed | 2026-10-24T00:55:49Z |',
  '| Owner-wait | Gate 1 asked \\| answered |',
  '| Tier | Full |',
  '',
  '## Ledger',
  '| Step | Status | Evidence |',
  '|---|---|---|',
  '| 1 | ran | x |',
].join('\n');

test('parseState reads a two-column header table as key/value rows, any column names', () => {
  const h = parseState(TABLE_STATE).header;
  assert.deepEqual(h, {
    unit: 'EP-27.04',
    mode: '',
    type: '',
    tier: 'Full',
    branch: 'ep-27.04-role-switcher',
    base: '438801c',
    claimed: '2026-10-24T00:55:49Z',
    ownerWait: 'Gate 1 asked | answered',
  });
  assert.equal(parseState(TABLE_STATE).ledger.length, 1);
  assert.equal(parseState('| Name | Meaning |\n|:--|--|\n| Base | abc |\n').header.base, 'abc');
  // Three columns is not a key/value table; Key: value lines still work beside a table.
  assert.equal(parseState('| Field | Value | Note |\n|---|---|---|\n| Base | abc | x |\n').header.base, '');
  const mixed = parseState('Mode: plan\n\n| Field | Value |\n|---|---|\n| Base | abc |\n');
  assert.deepEqual([mixed.header.mode, mixed.header.base], ['plan', 'abc']);
  // The first value wins, and a table after the first ## is never header data.
  assert.equal(parseState('Base: one\n| K | V |\n|---|---|\n| Base | two |\n').header.base, 'one');
  assert.equal(parseState('## Notes\n| K | V |\n|---|---|\n| Base | two |\n').header.base, '');
});

test('header keys ignore case, spaces, hyphens and underscores; one pair of backticks is stripped', () => {
  for (const key of ['Owner wait', 'Owner-wait', 'owner_wait', 'OWNERWAIT', 'Owner - Wait'])
    assert.equal(parseState(`${key}: 2h\n`).header.ownerWait, '2h', key);
  assert.equal(parseState('| K | V |\n|-|-|\n| owner_wait | 2h |\n').header.ownerWait, '2h');
  assert.equal(parseState('Base: `abc123`\n').header.base, 'abc123');
  assert.equal(parseState('Base: ``abc``\n').header.base, '`abc`');
  assert.equal(parseState('Base: `abc\n').header.base, '`abc');
});

test('with no Unit key the unit is the first token of the first # heading, if it holds a digit or hyphen', () => {
  assert.equal(parseState('# EP-27.04 — state\n').header.unit, 'EP-27.04');
  assert.equal(parseState('# U7 notes\n').header.unit, 'U7');
  assert.equal(parseState('# harness-fix state\n').header.unit, 'harness-fix');
  assert.equal(parseState('# State\n').header.unit, '');
  assert.equal(parseState('# Unit state\n').header.unit, '');
  assert.equal(parseState('').header.unit, '');
  // An explicit Unit wins, and only the first # heading is considered.
  assert.equal(parseState('# EP-1 state\nUnit: EP-2\n').header.unit, 'EP-2');
  assert.equal(parseState('# State\n# EP-9 later\n').header.unit, '');
  assert.equal(parseState('| K | V |\n|-|-|\n| Unit | `EP-3` |\n# EP-1\n').header.unit, 'EP-3');
});

test('a long Owner wait is truncated to 80 characters plus an ellipsis in the Elapsed line only', () => {
  const long = 'Gate 1 asked ' + 'x'.repeat(100);
  const state = parseState(`Unit: U-1\nClaimed: 2026-10-24T03:10:00Z\nOwner wait: ${long}\n`);
  const rec = buildRecord({ state, commits: [], diffstat: '', gatesSummary: null, now: NOW });
  assert.match(rec, new RegExp(`^- Elapsed: 3h12m since claim · owner wait ${long.slice(0, 80)}…$`, 'm'));
  assert.equal(state.header.ownerWait, long);
  const exact = parseState(`Owner wait: ${'y'.repeat(80)}\n`);
  assert.match(
    buildRecord({ state: exact, commits: [], diffstat: '', gatesSummary: null, now: NOW }),
    new RegExp(`owner wait ${'y'.repeat(80)}$`, 'm'),
  );
});

test('severity words map to P0-P3 and unknown severities are not counted', () => {
  for (const [raw, want] of [
    ['P0', 'P0'],
    ['p2', 'P2'],
    ['CRITICAL', 'P0'],
    ['High', 'P1'],
    ['MEDIUM', 'P2'],
    ['low', 'P3'],
    ['P1 (blocking)', 'P1'],
    ['P4', ''],
    ['urgent', ''],
    ['', ''],
  ])
    assert.equal(normalizeSeverity(raw), want, raw);
  const sum = summarizeFindings([finding({ sev: '' }), finding({ sev: 'P2' })]);
  assert.deepEqual(sum.bySev, { P0: 0, P1: 0, P2: 1, P3: 0 });
});

test('status is normalised to fixed | follow-up | retracted | open; anything else is open', () => {
  for (const [raw, want] of [
    ['fixed', 'fixed'],
    ['Fixed abc1234', 'fixed'],
    ['follow-up', 'follow-up'],
    ['followup', 'follow-up'],
    ['out of scope', 'follow-up'],
    ['deferred to EP-28', 'follow-up'],
    ['retracted', 'retracted'],
    ['rejected: not reproducible', 'retracted'],
    ['open', 'open'],
    ['', 'open'],
    ['wontfix', 'open'],
    ['outstanding', 'open'],
    ['unfixed', 'open'],
  ])
    assert.equal(normalizeStatus(raw), want, raw);
});

test('defects counts P0/P1 not raised by an auditor lane, and never a retracted finding', () => {
  const sum = summarizeFindings([
    finding({ id: 'a', sev: 'P1', source: 'codex-review' }),
    finding({ id: 'b', sev: 'P0', source: 'opus-code-reviewer' }),
    finding({ id: 'c', sev: 'P1', source: 'plan-conformance-auditor' }),
    finding({ id: 'd', sev: 'P1', source: 'claim-auditor' }),
    finding({ id: 'e', sev: 'P0', source: 'Lane-A' }),
    finding({ id: 'f', sev: 'P1', source: 'lane-c' }),
    finding({ id: 'g', sev: 'P1', source: 'codex-review', status: 'retracted' }),
    finding({ id: 'h', sev: 'P2', source: 'codex-review' }),
  ]);
  assert.equal(sum.defects, '1/1');
  assert.equal(summarizeFindings([]).defects, '0/0');
});

test('yield counts only unique valid P0-P2 findings per source', () => {
  const sum = summarizeFindings([
    finding({ id: '1', sev: 'P0', source: 'codex-review' }),
    finding({ id: '2', sev: 'P1', source: 'codex-review', status: 'follow-up' }),
    finding({ id: '3', sev: 'P1', source: 'codex-review', also: ['opus-code-reviewer'] }),
    finding({ id: '4', sev: 'P2', source: 'opus-code-reviewer', also: [] }),
    finding({ id: '5', sev: 'P3', source: 'opus-code-reviewer' }),
    finding({ id: '6', sev: 'P1', source: 'opus-code-reviewer', status: 'open' }),
    finding({ id: '7', sev: 'P1', source: 'opus-code-reviewer', status: 'retracted' }),
    finding({ id: '8', sev: '', source: 'silent-failure-hunter' }),
  ]);
  assert.deepEqual(sum.yield, {
    'codex-review': { P0: 1, P1: 1, P2: 0 },
    'opus-code-reviewer': { P0: 0, P1: 0, P2: 1 },
  });
  // `also` cells of '', '-' and '—' are empty; a real co-reporter is not.
  const s = parseState(
    [
      '## Findings',
      '| ID | Sev | Source | Also | Status |',
      '|---|---|---|---|---|',
      '| a | P1 | s1 | - | fixed |',
      '| b | P1 | s1 | — | fixed |',
      '| c | P1 | s1 |  | fixed |',
      '| d | P1 | s1 | s2, s3 | fixed |',
    ].join('\n'),
  );
  assert.deepEqual(summarizeFindings(s.findings).yield, { s1: { P0: 0, P1: 3, P2: 0 } });
  // A source called __proto__ is a key like any other.
  const odd = summarizeFindings([finding({ source: '__proto__' })]).yield;
  assert.deepEqual(Object.keys(odd), ['__proto__']);
});

test('retracted findings are out of bySev but still counted in byStatus', () => {
  const sum = summarizeFindings(parseState(STATE).findings);
  assert.deepEqual(sum.bySev, { P0: 0, P1: 1, P2: 1, P3: 0 });
  assert.deepEqual(sum.byStatus, { open: 0, fixed: 1, 'follow-up': 1, retracted: 1 });
  assert.equal(sum.defects, '0/1');
  assert.deepEqual(sum.yield, {
    'codex-review': { P0: 0, P1: 1, P2: 0 },
  });
});

test('formatElapsed: hours and minutes, minutes alone under an hour, unknown for a bad date', () => {
  assert.equal(formatElapsed('2026-10-24T03:10:00Z', '2026-10-24T06:22:00Z'), '3h12m');
  assert.equal(formatElapsed('2026-10-24T03:10:00Z', '2026-10-24T03:55:00Z'), '45m');
  assert.equal(formatElapsed('2026-10-24T03:10:00Z', '2026-10-24T04:10:59Z'), '1h00m');
  assert.equal(formatElapsed('2026-10-24T03:10:00Z', '2026-10-24T03:10:00Z'), '0m');
  assert.equal(formatElapsed('2026-10-24T03:10:00Z', new Date('2026-10-24T05:15:00Z')), '2h05m');
  for (const bad of ['yesterday', '', null, undefined])
    assert.equal(formatElapsed(bad, '2026-10-24T03:10:00Z'), 'unknown', String(bad));
  assert.equal(formatElapsed('2026-10-24T03:10:00Z', 'soon'), 'unknown');
  assert.equal(formatElapsed('2026-10-24T05:00:00Z', '2026-10-24T03:00:00Z'), 'unknown');
});

test('lastSummary picks the last of two SUMMARY lines, and null when there is none', () => {
  const log = [
    'running gates',
    'SUMMARY 3 passed, 1 failed, 0 skipped',
    'retry',
    'SUMMARY 4 passed, 0 failed, 1 skipped (retry)',
    'done',
  ].join('\n');
  assert.equal(lastSummary(log), 'SUMMARY 4 passed, 0 failed, 1 skipped (retry)');
  assert.equal(lastSummary('SUMMARY 1 passed, 0 failed, 0 skipped\r\nbye'), 'SUMMARY 1 passed, 0 failed, 0 skipped');
  assert.equal(lastSummary('no summary here\n  SUMMARY 1 passed, 0 failed, 0 skipped'), null);
  assert.equal(lastSummary(''), null);
});

const NOW = '2026-10-24T06:22:00Z';
const COMMITS = [
  { sha: 'aaaaaaa', subject: 'feat: one' },
  { sha: 'bbbbbbb', subject: 'fix: two' },
];

test('buildRecord prints every field with its exact label, in order', () => {
  const rec = buildRecord({
    state: parseState(STATE),
    commits: COMMITS,
    diffstat: ' 3 files changed, 10 insertions(+)\n',
    gatesSummary: 'SUMMARY 4 passed, 0 failed, 0 skipped',
    now: NOW,
  });
  const lines = rec.split('\n');
  assert.equal(
    lines[0],
    '## Record — EP-27.04 (generated by unit-record.mjs — regenerate, never edit by hand)',
  );
  assert.deepEqual(lines.slice(2, 12), [
    '- Base: 1a2b3c4 · Head: bbbbbbb',
    '- Commits: 2',
    '  - aaaaaaa feat: one',
    '  - bbbbbbb fix: two',
    '- Diffstat: 3 files changed, 10 insertions(+)',
    '- Gates: SUMMARY 4 passed, 0 failed, 0 skipped',
    '- Findings: P0 0 · P1 1 · P2 1 · P3 0 (open 0 · fixed 1 · follow-up 1 · retracted 1)',
    '- Yield by source: codex-review P0/P1/P2 0/1/0',
    '- Elapsed: 3h12m since claim · owner wait 1h20m',
    '- Ledger:',
  ]);
  assert.deepEqual(lines.slice(12), [
    '',
    '| Step | Status | Evidence |',
    '|---|---|---|',
    '| 8 review — code-reviewer | ran | 3 findings |',
    '',
    'Draft log row:',
    '| EP-27.04 · plan · Code · Full | 3h12m | 0/1 | <fill: scope counts> | <fill: gates as decided> | <fill: verdicts> | <fill: retries> | <fill: models as dispatched> | <fill: missed by harness> | codex-review 0/1/0 | <fill: friction> |',
    '',
  ]);
  // An explicit base and head win over the state file and the newest commit.
  const explicit = buildRecord({
    state: parseState(STATE),
    commits: COMMITS,
    diffstat: '',
    gatesSummary: null,
    now: NOW,
    base: 'f00dfee',
    head: 'cafe123',
  });
  assert.match(explicit, /^- Base: f00dfee · Head: cafe123$/m);
  assert.match(explicit, /^- Diffstat: none$/m);
});

test('buildRecord degrades loudly: no gates, no Claimed, no ledger, no findings, no commits', () => {
  const rec = buildRecord({
    state: parseState('Unit: U-2\n'),
    commits: [],
    diffstat: '',
    gatesSummary: null,
    now: NOW,
  });
  assert.match(rec, /^- Base: unknown · Head: unknown$/m);
  assert.match(rec, /^- Commits: 0$/m);
  assert.match(rec, /^- Gates: not run — no SUMMARY line found$/m);
  assert.match(rec, /^- Findings: P0 0 · P1 0 · P2 0 · P3 0 \(open 0 · fixed 0 · follow-up 0 · retracted 0\)$/m);
  assert.match(rec, /^- Yield by source: none$/m);
  assert.match(
    rec,
    /^- Elapsed: unknown — no Claimed: line in the state file · owner wait none recorded$/m,
  );
  assert.match(rec, /^\| — \| missing \| no ## Ledger section \|$/m);
  assert.match(rec, /^\| U-2 · \? · \? · \? \| unknown \| 0\/0 \|/m);
  assert.match(rec, /\| none \| <fill: friction> \|$/m);
  assert.match(buildRecord({ state: parseState(''), commits: [], diffstat: '', gatesSummary: null, now: NOW }), /^## Record — unit \(/);
});

test('buildRecord caps the commit list and says how many more there were', () => {
  const many = Array.from({ length: MAX_COMMITS + 5 }, (_, i) => ({
    sha: `c${String(i).padStart(6, '0')}`,
    subject: `commit ${i}`,
  }));
  const rec = buildRecord({
    state: parseState('Unit: U-3\n'),
    commits: many,
    diffstat: '',
    gatesSummary: null,
    now: NOW,
  });
  const listed = rec.split('\n').filter((l) => /^ {2}- c\d{6} /.test(l));
  assert.equal(listed.length, MAX_COMMITS);
  assert.equal(listed.at(-1), `  - c${String(MAX_COMMITS - 1).padStart(6, '0')} commit ${MAX_COMMITS - 1}`);
  assert.match(rec, /^ {2}- … and 5 more$/m);
  assert.match(rec, new RegExp(`^- Commits: ${MAX_COMMITS + 5}$`, 'm'));
  assert.match(rec, new RegExp(`Head: c${String(MAX_COMMITS + 4).padStart(6, '0')}$`, 'm'));
  // Exactly at the cap there is no "more" line.
  const exact = buildRecord({
    state: parseState(''),
    commits: many.slice(0, MAX_COMMITS),
    diffstat: '',
    gatesSummary: null,
    now: NOW,
  });
  assert.doesNotMatch(exact, /and \d+ more/);
});

test('buildRecord escapes a pipe inside a ledger cell, a source name and the unit', () => {
  const state = parseState(
    [
      'Unit: A | B',
      '## Ledger',
      '| Step | Status | Evidence |',
      '|---|---|---|',
      '| a \\| b | ran | c \\| d |',
      '## Findings',
      '| ID | Sev | Source | Status |',
      '|---|---|---|---|',
      '| F-1 | P1 | x \\| y | fixed |',
    ].join('\n'),
  );
  const rec = buildRecord({ state, commits: [], diffstat: '', gatesSummary: null, now: NOW });
  assert.match(rec, /^\| a \\\| b \| ran \| c \\\| d \|$/m);
  assert.match(rec, /^\| A \\\| B · \? · \? · \? \|/m);
  assert.match(rec, /\| x \\\| y 0\/1\/0 \| <fill: friction> \|$/m);
  // The escaped row splits back into the same three cells.
  assert.deepEqual(splitRow('| a \\| b | ran | c \\| d |'), ['a | b', 'ran', 'c | d']);
});

test('parseArgs needs --state and rejects unknown options and valueless flags', () => {
  assert.deepEqual(parseArgs(['--state', 's.md']), { state: 's.md', base: null, gates: null, json: false });
  assert.deepEqual(parseArgs(['--json', '--state', 's.md', '--base', 'abc', '--gates', 'g.out']), {
    state: 's.md',
    base: 'abc',
    gates: 'g.out',
    json: true,
  });
  assert.throws(() => parseArgs([]), /--state <file> is required/);
  assert.throws(() => parseArgs(['--state']), /--state needs a value/);
  assert.throws(() => parseArgs(['--state', '--json']), /--state needs a value/);
  assert.throws(() => parseArgs(['--state', 's.md', '--frobnicate']), /unknown option --frobnicate/);
});

/** A temp repo with three commits (base, one, two) and an untracked state file and gates file. */
function fixture({ state = true } = {}) {
  const repo = tmpDir('unit-record-repo-');
  const env = cleanEnv();
  const git = (...args) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { cwd: repo, env, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', '--short', 'HEAD');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base\nchanged\n');
  git('commit', '-q', '-a', '-m', 'feat: one');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'new\n');
  git('add', '.');
  git('commit', '-q', '-m', 'fix: two | with a pipe');
  const head = git('rev-parse', '--short', 'HEAD');
  const stateFile = path.join(repo, 'docs/plans/u.state.md');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  if (state) fs.writeFileSync(stateFile, STATE.replace('Base: 1a2b3c4', `Base: ${base}`));
  const gates = path.join(repo, 'docs/plans/u.gates.out');
  fs.writeFileSync(
    gates,
    'SUMMARY 3 passed, 1 failed, 0 skipped\nfixed it\nSUMMARY 4 passed, 0 failed, 0 skipped\n',
  );
  return { repo, env, git, base, head, stateFile, gates };
}

function run(f, args, cwd = f.repo) {
  return spawnSync(process.execPath, [RUNNER, ...args], { cwd, env: f.env, encoding: 'utf8' });
}

test('the wrapper prints the record from git, the gate log and the state file', () => {
  const f = fixture();
  const res = run(f, ['--state', f.stateFile, '--gates', f.gates]);
  assert.equal(res.status, 0, res.stderr);
  const lines = res.stdout.split('\n');
  assert.ok(lines.includes('- Commits: 2'), res.stdout);
  assert.ok(lines.includes('- Gates: SUMMARY 4 passed, 0 failed, 0 skipped'), res.stdout);
  assert.ok(lines.includes(`- Base: ${f.base} · Head: ${f.head}`), res.stdout);
  const i = lines.indexOf('- Commits: 2');
  assert.match(lines[i + 1], /^ {2}- [0-9a-f]+ feat: one$/);
  assert.match(lines[i + 2], /^ {2}- [0-9a-f]+ fix: two \| with a pipe$/);
  assert.match(res.stdout, /^- Diffstat: 2 files changed, 2 insertions\(\+\)$/m);
  assert.match(res.stdout, /^- Findings: P0 0 · P1 1 · P2 1 · P3 0 /m);
  assert.match(res.stdout, /^- Elapsed: .* since claim · owner wait 1h20m$/m);
});

test('the wrapper: --base overrides the state file, no --gates says "not run", works from a subdirectory', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.repo, 'deep/er'), { recursive: true });
  const res = run(f, ['--state', f.stateFile, '--base', 'HEAD~1'], path.join(f.repo, 'deep/er'));
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^- Commits: 1$/m);
  assert.match(res.stdout, /^- Gates: not run — no SUMMARY line found$/m);
  assert.match(res.stdout, /^- Diffstat: 1 file changed, 1 insertion\(\+\)$/m);
});

test('the wrapper: --json prints header, summary, commits, diffstat, gates and the record', () => {
  const f = fixture();
  const res = run(f, ['--state', f.stateFile, '--gates', f.gates, '--json']);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.deepEqual(Object.keys(out), ['header', 'summary', 'commits', 'diffstat', 'gates', 'record']);
  assert.equal(out.header.unit, 'EP-27.04');
  assert.equal(out.summary.defects, '0/1');
  assert.equal(out.commits.length, 2);
  assert.deepEqual(out.commits[1], { sha: f.head, subject: 'fix: two | with a pipe' });
  assert.equal(out.gates, 'SUMMARY 4 passed, 0 failed, 0 skipped');
  assert.match(out.record, /^## Record — EP-27\.04 /);
  assert.equal(JSON.parse(run(f, ['--state', f.stateFile, '--json']).stdout).gates, null);
});

test('the wrapper exits 2 with a usage line: no base, no --state, unknown flag, unreadable files, bad base', () => {
  const f = fixture({ state: false });
  fs.writeFileSync(f.stateFile, 'Unit: U-9\n');
  const cases = [
    [['--state', f.stateFile], /no base/],
    [[], /--state <file> is required/],
    [['--state', f.stateFile, '--base', 'HEAD~1', '--nope'], /unknown option --nope/],
    [['--state', path.join(f.repo, 'missing.state.md'), '--base', 'HEAD~1'], /cannot read state file/],
    [['--state', f.stateFile, '--base', 'HEAD~1', '--gates', path.join(f.repo, 'nope.out')], /cannot read gates file/],
    [['--state', f.stateFile, '--base', 'no-such-ref'], /git log failed/],
    [['--state', f.stateFile, '--base', '--output=x'], /--base needs a value/],
  ];
  for (const [args, message] of cases) {
    const res = run(f, args);
    assert.equal(res.status, 2, `${args.join(' ')}: ${res.stdout}${res.stderr}`);
    assert.equal(res.stdout, '');
    assert.match(res.stderr, message);
    assert.match(res.stderr, /^usage: node scripts\/unit-record\.mjs /m);
  }
  // A base that looks like an option never reaches git.
  fs.writeFileSync(f.stateFile, 'Unit: U-9\nBase: --output=x\n');
  const res = run(f, ['--state', f.stateFile]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /base must be a commit/);
});

test('the wrapper outside a git repository is a usage error, not a crash', () => {
  const f = fixture();
  const outside = tmpDir('unit-record-nogit-');
  const res = run(f, ['--state', f.stateFile, '--base', 'HEAD~1'], outside);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /git rev-parse failed/);
});

test('the wrapper is read-only: the repository is byte-identical after a run', () => {
  const f = fixture();
  const snapshot = () => ({
    status: f.git('status', '--porcelain', '--untracked-files=all'),
    log: f.git('log', '--all', '--format=%H'),
    files: fs.readdirSync(f.repo, { recursive: true }).sort(),
    state: fs.readFileSync(f.stateFile, 'utf8'),
  });
  const before = snapshot();
  const res = run(f, ['--state', f.stateFile, '--gates', f.gates]);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(snapshot(), before);
});
