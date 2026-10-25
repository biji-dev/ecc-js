// harness-bootstrap docs-drift tests (generated YYYY-MM-DD). Run: node --test scripts/lib/docs-drift-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the tests read GENERIC, MIN_IDENT and
// DOC_GLOBS from the core, never a project literal beyond the docs/ folder the default globs name.
// Hermetic: the one wrapper run happens in a temp git repo with GIT_* variables stripped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DOC_GLOBS,
  EXIT,
  GENERIC,
  IGNORE_TOKENS,
  isLivingDoc,
  MIN_IDENT,
  deletedFromNameStatus,
  exportedNames,
  isDoc,
  findMentions,
  formatReport,
  globToRegExp,
  isExcludedDir,
  matchesAny,
  parseArgs,
  tokensFor,
  untrackedDiff,
} from './docs-drift-core.mjs';

const WRAPPER = fileURLToPath(new URL('../docs-drift.mjs', import.meta.url));

const tempDirs = [];
function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Env for git and the wrapper: no inherited GIT_* variable (a hook sets some), no global config. */
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
}

function git(cwd, ...args) {
  const r = spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, env: cleanEnv(), encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function write(repo, rel, text) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}

function drift(repo, ...args) {
  return spawnSync(process.execPath, [WRAPPER, ...args], {
    cwd: repo,
    env: cleanEnv(),
    encoding: 'utf8',
  });
}

test('globToRegExp: ** spans zero or many directories, * and ? stay inside one', () => {
  const docs = globToRegExp('docs/**/*.md');
  assert.equal(docs.test('docs/a.md'), true, 'zero directories');
  assert.equal(docs.test('docs/x/a.md'), true);
  assert.equal(docs.test('docs/x/y/z/a.md'), true, 'many directories');
  assert.equal(docs.test('docs/a.txt'), false);
  assert.equal(docs.test('other/docs/a.md'), false, 'anchored at the start');
  assert.equal(docs.test('docs/a.md.bak'), false, 'anchored at the end');

  const top = globToRegExp('*.md');
  assert.equal(top.test('README.md'), true);
  assert.equal(top.test('docs/README.md'), false, '* does not cross /');
  assert.equal(globToRegExp('a?.md').test('ab.md'), true);
  assert.equal(globToRegExp('a?.md').test('a/.md'), false, '? does not cross /');
  assert.equal(globToRegExp('a.md').test('aXmd'), false, 'a dot is literal');
  assert.equal(globToRegExp('docs/**').test('docs/x/y.md'), true, 'a trailing ** takes any depth');
});

test('matchesAny and the default DOC_GLOBS pick documents, not source', () => {
  assert.equal(matchesAny('docs/guide/setup.md', DOC_GLOBS), true);
  assert.equal(matchesAny('README.md', DOC_GLOBS), true);
  assert.equal(matchesAny('src/README.md', DOC_GLOBS), false);
  assert.equal(matchesAny('src/api.ts', DOC_GLOBS), false);
  assert.equal(matchesAny('x.md', []), false);
});

test('isExcludedDir matches a name at any depth and a path from the top', () => {
  assert.equal(isExcludedDir('node_modules'), true);
  assert.equal(isExcludedDir('apps/web/node_modules'), true);
  assert.equal(isExcludedDir('.claude/worktrees'), true);
  assert.equal(isExcludedDir('.claude'), false);
  assert.equal(isExcludedDir('docs'), false);
  assert.equal(isExcludedDir('not_node_modules'), false);
});

test('exportedNames: added and removed declarations, sorted and deduped', () => {
  const diff = [
    'diff --git a/src/api.ts b/src/api.ts',
    '--- a/src/api.ts',
    '+++ b/src/api.ts',
    '@@ -1,4 +1,5 @@',
    '-export function getUser(id) {',
    '+export function fetchUser(id) {',
    '+export const zeta = 1;',
    '+export const zeta = 2;',
    '+export class Alpha {}',
    '+export type Shape = {};',
    '+export interface Opts {}',
    '+export enum Mode {}',
    '+export let counter = 0;',
    '+export var legacy = 1;',
    ' export const unchanged = 1;',
    '+const internal = 3;',
  ].join('\n');
  assert.deepEqual(exportedNames(diff), {
    added: ['Alpha', 'Mode', 'Opts', 'Shape', 'counter', 'fetchUser', 'legacy', 'zeta'],
    removed: ['getUser'],
  });
});

test('exportedNames: default, async and generator forms; export { a as b } takes the exported name', () => {
  const diff = [
    '+export default function main() {}',
    '+export default async function loadAll() {}',
    '+export async function* stream() {}',
    '+export function* pages() {}',
    '+export default class Widget {}',
    '-export { oldName, other as renamed }',
    '+export { a, b as c, type T, x as default } from "./y"',
    '+export default function () {}',
    '+export default class extends Base {}',
  ].join('\n');
  const { added, removed } = exportedNames(diff);
  assert.deepEqual(added, ['Widget', 'a', 'c', 'default', 'loadAll', 'main', 'pages', 'stream', 'T'].sort());
  assert.deepEqual(removed, ['oldName', 'renamed']);
  assert.equal(added.includes('b'), false, 'the local name of `b as c` is not exported');
});

test('exportedNames ignores the +++ and --- file headers and non-export lines', () => {
  const diff = [
    '--- a/export function fake.ts',
    '+++ b/export function fake.ts',
    '+import { thing } from "./x";',
    '+const exportName = 1;',
    '+// export function commented() {}',
  ].join('\n');
  assert.deepEqual(exportedNames(diff), { added: [], removed: [] });
});

test('exportedNames: a name removed from a multi-line export list is a removed export', () => {
  const diff = [
    'diff --git a/src/index.ts b/src/index.ts',
    '--- a/src/index.ts',
    '+++ b/src/index.ts',
    '@@ -1,6 +1,5 @@',
    ' export {',
    '-  getUser,',
    '   type Session,',
    '+  fetchUser as loadUser,',
    '   listUsers',
    ' } from "./users";',
    '-const notExported = 1;',
    '@@ -40,3 +40,3 @@',
    '-  orphanedInHunk,',
  ].join('\n');
  assert.deepEqual(exportedNames(diff), { added: ['loadUser'], removed: ['getUser'] });
});

test('tokensFor: code paths and REMOVED exports only, GENERIC and MIN_IDENT filtered', () => {
  assert.ok(GENERIC.includes('index') && MIN_IDENT === 4, 'the test reads the binding it filters on');
  const diff = [
    'diff --git a/src/api/user.ts b/src/api/user.ts',
    '+++ b/src/api/user.ts',
    '+export function getUser() {}',
    '-export function oldUser() {}',
    '-export const id = 1;',
    '-export const main = 2;',
    '+export const brandNew = 3;',
    'diff --git a/src/index.ts b/src/index.ts',
    '+++ b/src/index.ts',
    '-export const Registry = 1;',
    '+export const Registry = 2;',
  ].join('\n');
  const changedPaths = ['src/api/user.ts', 'src/index.ts'];
  const tokens = tokensFor({ changedPaths, diffText: diff });
  const byToken = Object.fromEntries(tokens.map((t) => [t.token, t]));
  assert.deepEqual(byToken['src/api/user.ts'], { token: 'src/api/user.ts', kind: 'path', from: 'src/api/user.ts' });
  assert.equal(byToken['user.ts'], undefined, 'no basename token by default');
  assert.deepEqual(byToken.oldUser, { token: 'oldUser', kind: 'ident', from: 'src/api/user.ts' });
  assert.equal(byToken.Registry.from, 'src/index.ts', 'a modified export (removed and re-added) is a token');
  assert.equal(byToken.getUser, undefined, 'a purely added export cannot make a document stale');
  assert.equal(byToken.brandNew, undefined);
  assert.equal(byToken.id, undefined, 'shorter than MIN_IDENT');
  assert.equal(byToken.main, undefined, 'generic name');
  assert.ok(tokens.every((t) => t.kind !== 'file'));
});

test('tokensFor: basenames are opt-in, and a generic stem is never a basename token', () => {
  const changedPaths = ['src/api/user.ts', 'src/index.ts', 'Makefile'];
  const tokens = tokensFor({ changedPaths, diffText: '', basenames: true });
  const byToken = Object.fromEntries(tokens.map((t) => [t.token, t]));
  assert.deepEqual(byToken['user.ts'], { token: 'user.ts', kind: 'file', from: 'src/api/user.ts' });
  assert.equal(byToken['index.ts'], undefined, 'index is a generic stem');
  assert.equal(tokens.filter((t) => t.token === 'Makefile').length, 1, 'a top-level file is one token');
  assert.equal(tokensFor({ changedPaths, diffText: '' }).some((t) => t.kind === 'file'), false);
});

test('tokensFor: an edited document is not a token; a deleted or renamed-away one is', () => {
  assert.equal(isDoc('docs/a.md'), true);
  assert.equal(isDoc('notes/todo.md'), true, 'any .md is a document');
  assert.equal(isDoc('.claude/rules/x.md'), true);
  assert.equal(isDoc('src/a.ts'), false);
  const changedPaths = ['docs/edited.md', 'docs/gone.md', 'notes/gone.md', 'src/a.ts'];
  const deletedPaths = ['docs/gone.md', 'notes/gone.md'];
  const names = (o) => tokensFor({ changedPaths, diffText: '', basenames: true, ...o }).map((t) => t.token).sort();
  assert.deepEqual(names({}), ['a.ts', 'src/a.ts']);
  assert.deepEqual(names({ deletedPaths }), ['a.ts', 'docs/gone.md', 'gone.md', 'notes/gone.md', 'src/a.ts']);
  // A deleted code path stays a token.
  assert.ok(tokensFor({ changedPaths: ['src/old.ts'], diffText: '', deletedPaths: ['src/old.ts'] }).length === 1);
});

test('deletedFromNameStatus keeps only status D paths from -z name-status output', () => {
  assert.deepEqual(deletedFromNameStatus('M\0src/a.ts\0D\0docs/gone.md\0A\0new.ts\0D\0old name.ts\0'), [
    'docs/gone.md',
    'old name.ts',
  ]);
  assert.deepEqual(deletedFromNameStatus(''), []);
});

test('tokensFor: IGNORE_TOKENS (lockfiles, package.json) are never tokens, as a path or a name', () => {
  assert.ok(IGNORE_TOKENS.includes('package.json') && IGNORE_TOKENS.includes('tsconfig.json'));
  const tokens = tokensFor({
    changedPaths: [...IGNORE_TOKENS, 'apps/web/package.json'],
    diffText: '',
    basenames: true,
  }).map((t) => t.token);
  assert.deepEqual(tokens, ['apps/web/package.json'], 'the nested path is specific; its bare name is ignored');
});

test('tokensFor dedupes by token', () => {
  const diff = ['+++ b/a/widget.ts', '-export const Widget = 0;', '-export function Widget() {}'].join('\n');
  const tokens = tokensFor({ changedPaths: ['a/widget.ts'], diffText: diff });
  assert.equal(tokens.filter((t) => t.token === 'Widget').length, 1);
});

const doc = (p, text) => ({ path: p, text });

test('findMentions: identifiers match on word boundaries, paths and files as substrings', () => {
  const tokens = [
    { token: 'getUser', kind: 'ident', from: 'src/a.ts' },
    { token: 'src/a.ts', kind: 'path', from: 'src/a.ts' },
    { token: 'a.ts', kind: 'file', from: 'src/a.ts' },
  ];
  const docs = [
    doc('docs/one.md', 'call getUsers() for the list\nthen getUser(id)\n$getUser and x.getUser too\nmy_getUser_x'),
    doc('docs/two.md', 'see `src/a.ts` for details\nrename a.tsx later'),
  ];
  const found = findMentions({ docs, tokens, changedPaths: [] });
  const one = found.filter((m) => m.doc === 'docs/one.md');
  assert.deepEqual(
    one.map((m) => [m.line, m.token]),
    [
      [2, 'getUser'],
      [3, 'getUser'],
    ],
    'getUsers, $getUser and my_getUser_x are other words',
  );
  const two = found.filter((m) => m.doc === 'docs/two.md').map((m) => [m.line, m.token]);
  assert.deepEqual(two, [
    [1, 'src/a.ts'],
    [1, 'a.ts'],
    [2, 'a.ts'],
  ]);
  assert.deepEqual(found[0], { doc: 'docs/one.md', line: 2, token: 'getUser', from: 'src/a.ts', kind: 'ident' });
});

test('findMentions: a document edited in this diff is skipped unless includeChanged', () => {
  const tokens = [{ token: 'fetchUser', kind: 'ident', from: 'src/a.ts' }];
  const docs = [doc('docs/edited.md', 'uses fetchUser'), doc('docs/stale.md', 'uses fetchUser')];
  const changedPaths = ['src/a.ts', 'docs/edited.md'];
  assert.deepEqual(
    findMentions({ docs, tokens, changedPaths }).map((m) => m.doc),
    ['docs/stale.md'],
  );
  assert.deepEqual(
    findMentions({ docs, tokens, changedPaths, includeChanged: true }).map((m) => m.doc),
    ['docs/edited.md', 'docs/stale.md'],
  );
});

test('findMentions: one result per (doc, line, token), sorted by doc then line', () => {
  const tokens = [{ token: 'Alpha', kind: 'ident', from: 'x.ts' }];
  const docs = [doc('docs/b.md', 'Alpha Alpha\nnone\nAlpha'), doc('docs/a.md', 'x\nAlpha')];
  const found = findMentions({ docs, tokens, changedPaths: [] });
  assert.deepEqual(
    found.map((m) => `${m.doc}:${m.line}`),
    ['docs/a.md:2', 'docs/b.md:1', 'docs/b.md:3'],
  );
});

test('formatReport: one line per candidate, skipped files, then the summary', () => {
  const mentions = [
    { doc: 'docs/a.md', line: 3, token: 'getUser', from: 'src/api.ts', kind: 'ident' },
    { doc: 'docs/a.md', line: 9, token: 'src/api.ts', from: 'src/api.ts', kind: 'path' },
    { doc: 'docs/b.md', line: 1, token: 'api.ts', from: 'src/api.ts', kind: 'file' },
  ];
  assert.equal(
    formatReport(mentions),
    [
      'docs/a.md:3 — mentions getUser (changed in src/api.ts)',
      'docs/a.md:9 — mentions src/api.ts (changed in src/api.ts)',
      'docs/b.md:1 — mentions api.ts (changed in src/api.ts)',
      'docs-drift: 3 candidates in 2 docs',
    ].join('\n'),
  );
  assert.equal(formatReport([]), 'docs-drift: 0 candidates');
  assert.equal(
    formatReport([], [{ path: 'docs/huge.md', reason: 'size' }]),
    'skipped: docs/huge.md (size)\ndocs-drift: 0 candidates',
  );
});

test('formatReport caps candidate lines at max, names the rest, and still counts all of them', () => {
  const mentions = [1, 2, 3, 4, 5].map((line) => ({
    doc: 'docs/a.md',
    line,
    token: 'getUser',
    from: 'src/api.ts',
    kind: 'ident',
  }));
  const out = formatReport(mentions, [{ path: 'docs/huge.md', reason: 'size' }], 2).split('\n');
  assert.deepEqual(out, [
    'docs/a.md:1 — mentions getUser (changed in src/api.ts)',
    'docs/a.md:2 — mentions getUser (changed in src/api.ts)',
    '… and 3 more (--json for all)',
    'skipped: docs/huge.md (size)',
    'docs-drift: 5 candidates in 1 docs',
  ]);
  assert.equal(formatReport(mentions, [], 5).includes('more'), false, 'exactly max lines need no tail');
  assert.equal(formatReport(mentions).split('\n').length, 6, 'the default cap is 200');
  assert.equal(formatReport(mentions, [], 0), '… and 5 more (--json for all)\ndocs-drift: 5 candidates in 1 docs');
});

test('untrackedDiff turns a new file into an added block whose exports are scanned', () => {
  const diff = untrackedDiff('src/new.ts', 'export const brandNew = 1;\nconst x = 2;\n');
  assert.deepEqual(exportedNames(diff).added, ['brandNew']);
  // Everything in a new file is added, so it never becomes an ident token.
  assert.deepEqual(tokensFor({ changedPaths: ['src/new.ts'], diffText: diff }), [
    { token: 'src/new.ts', kind: 'path', from: 'src/new.ts' },
  ]);
});

test('parseArgs: --since is required, unknown options and a missing value are errors', () => {
  assert.deepEqual(parseArgs(['--since', 'main', '--strict', '--json', '--include-changed']), {
    since: 'main',
    includeChanged: true,
    strict: true,
    json: true,
    basenames: false,
    max: 200,
  });
  assert.deepEqual(parseArgs(['--since', 'main', '--basenames', '--max', '7']).max, 7);
  assert.equal(parseArgs(['--since', 'main', '--basenames']).basenames, true);
  for (const bad of [[], ['x'], ['-1'], ['1.5']])
    assert.throws(() => parseArgs(['--since', 'main', '--max', ...bad]), /--max needs a non-negative integer/);
  assert.throws(() => parseArgs([]), /--since <base> is required/);
  assert.throws(() => parseArgs(['--since']), /--since needs a value/);
  assert.throws(() => parseArgs(['--since', '--strict']), /--since needs a value/);
  assert.throws(() => parseArgs(['--since', 'main', '--wat']), /unknown option --wat/);
});

/** A repo with one source file, one doc that mentions it, and an unrelated doc. */
function fixtureRepo() {
  const repo = tmpDir('docs-drift-repo-');
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, 'src/api.ts', 'export function getUser(id) { return id; }\n');
  write(repo, 'docs/guide.md', '# Guide\n\nCall `getUser(id)` to load a user.\nSee src/api.ts.\n');
  write(repo, 'docs/other.md', '# Other\n\nNothing about the api here.\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  return repo;
}

test('wrapper: a doc that mentions a renamed export is listed; --strict exits 1, default exits 0', () => {
  const repo = fixtureRepo();
  write(repo, 'src/api.ts', 'export function fetchUser(id) { return id; }\n');

  const plain = drift(repo, '--since', 'HEAD');
  assert.equal(plain.status, EXIT.ok, plain.stderr);
  const lines = plain.stdout.trim().split('\n');
  assert.deepEqual(lines, [
    'docs/guide.md:3 — mentions getUser (changed in src/api.ts)',
    'docs/guide.md:4 — mentions src/api.ts (changed in src/api.ts)',
    'docs-drift: 2 candidates in 1 docs',
  ]);
  assert.equal(plain.stdout.includes('mentions fetchUser'), false, 'the new name cannot be stale anywhere');

  const strict = drift(repo, '--since', 'HEAD', '--strict');
  assert.equal(strict.status, EXIT.strict, strict.stdout + strict.stderr);

  const json = JSON.parse(drift(repo, '--since', 'HEAD', '--json').stdout);
  assert.deepEqual(json.docs, ['docs/guide.md']);
  assert.deepEqual(json.skipped, []);
  assert.ok(json.candidates.some((c) => c.token === 'getUser' && c.line === 3));
});

test('wrapper: --basenames adds the bare file name; --max caps the printed lines but not the count', () => {
  const repo = fixtureRepo();
  write(repo, 'src/api.ts', 'export function fetchUser(id) { return id; }\n');
  const withNames = drift(repo, '--since', 'HEAD', '--basenames');
  assert.ok(
    withNames.stdout.includes('docs/guide.md:4 — mentions api.ts (changed in src/api.ts)'),
    withNames.stdout,
  );
  assert.match(withNames.stdout.trim(), /docs-drift: 3 candidates in 1 docs$/);

  const capped = drift(repo, '--since', 'HEAD', '--basenames', '--max', '1');
  assert.deepEqual(capped.stdout.trim().split('\n'), [
    'docs/guide.md:3 — mentions getUser (changed in src/api.ts)',
    '… and 2 more (--json for all)',
    'docs-drift: 3 candidates in 1 docs',
  ]);
  const json = JSON.parse(drift(repo, '--since', 'HEAD', '--basenames', '--max', '1', '--json').stdout);
  assert.equal(json.candidates.length, 3, '--json prints all of them');
});

test('wrapper: untracked files add no ident tokens; an edited doc is skipped unless --include-changed', () => {
  const repo = fixtureRepo();
  write(repo, 'src/brand.ts', 'export const brandNewThing = 1;\n');
  write(repo, 'docs/other.md', '# Other\n\nbrandNewThing is described here.\n');
  const added = drift(repo, '--since', 'HEAD', '--include-changed');
  assert.equal(added.stdout.trim(), 'docs-drift: 0 candidates', 'a new export cannot make a doc stale');

  write(repo, 'src/api.ts', 'export function fetchUser(id) { return id; }\n');
  write(repo, 'docs/guide.md', '# Guide\n\nCall `getUser(id)` to load a user.\n');
  const skipped = drift(repo, '--since', 'HEAD');
  assert.equal(skipped.stdout.trim(), 'docs-drift: 0 candidates', 'guide.md was edited in this diff');
  const included = drift(repo, '--since', 'HEAD', '--include-changed');
  assert.match(included.stdout, /docs\/guide\.md:3 — mentions getUser \(changed in src\/api\.ts\)/);
});

test('wrapper: a deleted or renamed-away document is a token (a broken link); an edited one is not', () => {
  const repo = fixtureRepo();
  write(repo, 'docs/other.md', '# Other\n\nSee docs/guide.md for the guide.\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'link');

  write(repo, 'docs/guide.md', '# Guide\n\nrewritten\n');
  assert.equal(drift(repo, '--since', 'HEAD').stdout.trim(), 'docs-drift: 0 candidates', 'edited');

  git(repo, 'checkout', '-q', '--', 'docs/guide.md');
  fs.rmSync(path.join(repo, 'docs/guide.md'));
  assert.deepEqual(drift(repo, '--since', 'HEAD').stdout.trim().split('\n'), [
    'docs/other.md:3 — mentions docs/guide.md (changed in docs/guide.md)',
    'docs-drift: 1 candidates in 1 docs',
  ]);

  git(repo, 'checkout', '-q', '--', 'docs/guide.md');
  git(repo, 'mv', 'docs/guide.md', 'docs/handbook.md');
  const renamed = drift(repo, '--since', 'HEAD');
  assert.ok(renamed.stdout.includes('docs/other.md:3 — mentions docs/guide.md'), renamed.stdout);
  assert.equal(renamed.stdout.includes('handbook'), false, 'the new name is an added path, not stale');
});

test('wrapper: nothing to report exits 0 even with --strict; node_modules docs are never scanned', () => {
  const repo = fixtureRepo();
  write(repo, 'src/api.ts', 'export function getUser(id) { return id + 1; }\n');
  write(repo, 'node_modules/pkg/README.md', 'mentions src/api.ts and getUser\n');
  fs.rmSync(path.join(repo, 'docs/guide.md'));
  const res = drift(repo, '--since', 'HEAD', '--strict');
  assert.equal(res.status, EXIT.ok, res.stdout + res.stderr);
  assert.equal(res.stdout.trim(), 'docs-drift: 0 candidates');
});

test('wrapper: a document over 2 MB is reported as skipped before the summary', () => {
  const repo = fixtureRepo();
  write(repo, 'docs/huge.md', 'x'.repeat(2 * 1024 * 1024 + 1));
  write(repo, 'src/api.ts', 'export function fetchUser(id) { return id; }\n');
  const res = drift(repo, '--since', 'HEAD');
  assert.equal(res.status, EXIT.ok, res.stderr);
  const lines = res.stdout.trim().split('\n');
  assert.equal(lines.at(-2), 'skipped: docs/huge.md (size)');
  assert.match(lines.at(-1), /^docs-drift: /);
});

test('wrapper: usage errors and git failures print usage to stderr and exit 2', () => {
  const repo = fixtureRepo();
  for (const args of [[], ['--since'], ['--since', 'HEAD', '--bogus'], ['--since', '--json']]) {
    const res = drift(repo, ...args);
    assert.equal(res.status, EXIT.usage, args.join(' '));
    assert.match(res.stderr, /usage: node scripts\/docs-drift\.mjs --since <base>/);
  }
  const badBase = drift(repo, '--since', 'no-such-revision');
  assert.equal(badBase.status, EXIT.usage);
  assert.match(badBase.stderr, /git failed/);
  const outside = drift(tmpDir('docs-drift-nogit-'), '--since', 'HEAD');
  assert.equal(outside.status, EXIT.usage);
  assert.match(outside.stderr, /usage: /);
});

test('wrapper is read-only: the repository is byte-identical after a run', () => {
  const repo = fixtureRepo();
  write(repo, 'src/api.ts', 'export function fetchUser(id) { return id; }\n');
  const snapshot = () => git(repo, 'status', '--porcelain=v1', '--untracked-files=all') + git(repo, 'diff');
  const before = snapshot();
  drift(repo, '--since', 'HEAD', '--strict');
  assert.equal(snapshot(), before);
});

test('isLivingDoc: historical documents (plans, change requests, follow-ups, logs) are not searched', () => {
  assert.equal(isLivingDoc('docs/guides/setup.md'), true);
  assert.equal(isLivingDoc('README.md'), true);
  assert.equal(isLivingDoc('docs/plans/2026-10-01-x.state.md'), false);
  assert.equal(isLivingDoc('docs/change-requests/CR-019.md'), false);
  assert.equal(isLivingDoc('docs/harness/follow-ups.md'), false);
  assert.equal(isLivingDoc('harness/log.md'), false);
  assert.equal(isLivingDoc('log.md'), false);
  assert.equal(isLivingDoc('docs/ops/deploy-log.md'), false);
  assert.equal(isLivingDoc('CHANGELOG.md'), false);
  assert.equal(isLivingDoc('src/notes.md'), false);
});
