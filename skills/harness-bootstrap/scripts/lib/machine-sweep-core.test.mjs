// harness-bootstrap machine-sweep tests. Run: node --test scripts/lib/machine-sweep-core.test.mjs
// [M] mechanism (ships as-is): every test. Hermetic: the CLI tests run against a temp --home, which
// leaves out every category whose tool keeps its cache in the real home, and temp git
// repositories with every GIT_* variable stripped; they stop no process but the ones they start.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  IDS,
  REBUILDABLE,
  SCHEMA,
  WORKTREE_IDLE_HOURS,
  approvalsFile,
  categoryList,
  deletable,
  devOrphans,
  dockerBytes,
  fmtBytes,
  formatReport,
  heldRows,
  inUse,
  logEntry,
  mcpOrphans,
  olderReleases,
  parseArgs,
  parseListeners,
  parseLstart,
  parsePs,
  parseRecords,
  parseWorktrees,
  readApprovals,
  recordedToStop,
  settled,
  staleStores,
  treePorts,
  unusedBrowsers,
  worktreeVerdict,
} from './machine-sweep-core.mjs';

const CLI = fileURLToPath(new URL('../machine-sweep.mjs', import.meta.url));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const posixOnly = { skip: process.platform === 'win32' ? 'the CLI reads ps, du and lsof' : false };

const tempDirs = [];
function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ---- the pure core

test('parseArgs takes one mode and its options, and refuses the rest before anything runs', () => {
  assert.deepEqual(parseArgs([]), { mode: 'report', approve: null, unapprove: null, only: null, home: null, record: null, dryRun: false, json: false });
  assert.equal(parseArgs(['--apply-approved', '--dry-run', '--only', 'uv,pnpm']).mode, 'apply');
  assert.deepEqual(parseArgs(['--apply-approved', '--only', 'uv,pnpm']).only, ['pnpm', 'uv']);
  assert.deepEqual(parseArgs(['--approve', 'all']).approve, IDS);
  assert.equal(parseArgs(['--approve', 'npm']).mode, 'approve');
  assert.equal(parseArgs(['--unapprove', 'npm']).mode, 'unapprove');
  assert.deepEqual([parseArgs(['--record', '4242']).mode, parseArgs(['--record', '4242']).record], ['record', 4242]);
  assert.throws(() => parseArgs(['--report', '--apply-approved']), /pick one/);
  assert.throws(() => parseArgs(['--approve', 'npm', '--apply-approved']), /each run alone/);
  assert.throws(() => parseArgs(['--approve', 'npm', '--record', '1']), /each run alone/);
  assert.throws(() => parseArgs(['--dry-run']), /--dry-run goes with --apply-approved/);
  assert.throws(() => parseArgs(['--approve', 'npm,nope']), /unknown category nope; the categories are pnpm, npm/);
  assert.throws(() => parseArgs(['--record', 'x1']), /process id/);
  assert.throws(() => parseArgs(['--only']), /needs a value/);
  assert.throws(() => parseArgs(['--force']), /unknown option --force/);
  assert.throws(() => parseArgs(['all']), /unexpected argument/);
});

test('approvals: read from sweep.json in category order, nothing from a torn or foreign file', () => {
  assert.deepEqual(categoryList(' uv , npm ,uv'), ['npm', 'uv']);
  assert.deepEqual(readApprovals(JSON.stringify({ schema: SCHEMA, approved: ['uv', 'gone', 'npm'] })), ['npm', 'uv']);
  assert.deepEqual(readApprovals('{"schema":99,"approved":["npm"]}'), []);
  assert.deepEqual(readApprovals('{"schema":1,"appr'), []);
  assert.deepEqual(readApprovals(''), []);
  const on = approvalsFile(['uv'], ['npm', 'uv'], true, NOW);
  assert.deepEqual(on, { schema: SCHEMA, approved: ['npm', 'uv'], updated: '2026-10-26T12:00:00.000Z' });
  assert.deepEqual(approvalsFile(on.approved, ['uv'], false, NOW).approved, ['npm']);
});

test("playwright: a browser stays while a live installation names its revision, for any platform (Playwright's own rule)", () => {
  const dirs = ['.links', 'b', 'daemon', 'chromium-1228', 'chromium-1243', 'chromium_headless_shell-1228', 'ffmpeg-1011', 'webkit-2311', 'webkit-2300'];
  const installs = [
    [{ name: 'chromium', revision: '1243' }, { name: 'ffmpeg', revision: '1011' }],
    [{ name: 'chromium', revision: '1228' }, { name: 'chromium-headless-shell', revision: '1228' }, { name: 'webkit', revision: '2311', revisionOverrides: { 'mac12': '2300' } }],
  ];
  assert.deepEqual(unusedBrowsers(dirs, installs), []);
  assert.deepEqual(unusedBrowsers(dirs, installs.slice(0, 1)), ['chromium-1228', 'chromium_headless_shell-1228', 'webkit-2300', 'webkit-2311']);
  assert.deepEqual(unusedBrowsers(dirs, []), ['chromium-1228', 'chromium-1243', 'chromium_headless_shell-1228', 'ffmpeg-1011', 'webkit-2300', 'webkit-2311']);
});

test('releases keep the current one and the one before it, never one in use; a store version and a cache entry wait out their idle time', () => {
  const names = ['0.146.0-arm', '0.154.0-arm', '0.162.0-arm', '0.163.0-arm', '0.170.0-arm', 'tmp'];
  assert.deepEqual(olderReleases(names, '0.163.0-arm'), ['0.146.0-arm', '0.154.0-arm']);
  assert.deepEqual(olderReleases(names, '0.163.0-arm', new Set(['0.146.0-arm'])), ['0.154.0-arm']);
  assert.deepEqual(olderReleases(names, '0.163.0-arm', new Set(), 1), ['0.146.0-arm', '0.154.0-arm', '0.162.0-arm']);
  assert.deepEqual(olderReleases(names, '0.200.0-arm'), []);
  assert.deepEqual(olderReleases(names, null), []);
  const versions = [
    { name: 'v3', written: NOW - 2 * DAY },
    { name: 'v2', written: NOW - 40 * DAY },
    { name: 'v10', written: NOW - 90 * DAY },
    { name: 'v1', written: null },
    { name: 'tmp', written: NOW - 90 * DAY },
  ];
  assert.deepEqual(staleStores(versions, 'v10', NOW), ['v2']);
  assert.deepEqual(staleStores(versions, 'v10', NOW, 1), ['v2', 'v3']);
  const entries = [
    { name: 'a-updater', written: NOW - 2 * HOUR },
    { name: 'b-updater', written: NOW - 10 * 60_000 },
    { name: 'c.ShipIt', written: null },
  ];
  assert.deepEqual(settled(entries, NOW).map((e) => e.name), ['a-updater']);
});

test('MCP orphans: a server whose every process above, up to process 1, is an MCP launcher; never one under an agent, an editor or a service', () => {
  const rows = parsePs(
    [
      '    1     0 10-00:00:00  9000 /sbin/launchd',
      '  100     1 01:00:00  9000 /Applications/cmux.app/Contents/MacOS/cmux',
      '  101   100 01:00:00  9000 -fish',
      '  102   101 01:00:00  9000 claude --resume',
      '  103   102 01:00:00  9000 npm exec @playwright/mcp@latest  ',
      '  104   103 01:00:00  9000 node /x/node_modules/.bin/playwright-mcp',
      '  200     1 2-01:00:00  9000 npm exec @playwright/mcp@latest  ',
      '  201   200 2-01:00:00  9000 node /x/node_modules/.bin/playwright-mcp',
      '  202   201 2-01:00:00  9000 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-pipe',
      '  300     1 05:00:00  9000 /Applications/Visual Studio Code.app/Contents/MacOS/Electron',
      '  301   300 05:00:00  9000 node /y/mcp-server-git',
      '  400     1 05:00:00  9000 /opt/homebrew/bin/uvx mcp-server-fetch',
      '  500     1 05:00:00  9000 /bin/zsh -c npx -y chrome-devtools-mcp@latest',
      '  501   500 05:00:00  9000 node /z/node_modules/.bin/chrome-devtools-mcp',
      '  600     1 05:00:00  9000 /bin/zsh -c echo mcp-server',
      '  700     1 2-13:00:00 61440 bun --env-file=../../.env run src/main.ts',
      '  701     1 1-18:00:00  1024 npm exec vite --port 5173 --host 127.0.0.1',
      '  702     1 10-00:00:00  2048 /usr/libexec/trustd',
      '  703     1 10-00:00:00  2048 /opt/homebrew/bin/node server.js',
      'not a ps line',
    ].join('\n'),
  );
  assert.equal(rows.length, 19);
  assert.deepEqual(rows[0], { pid: 1, ppid: 0, etime: '10-00:00:00', rss: 9000 * 1024, command: '/sbin/launchd' });
  const services = new Set([400, 703]);
  assert.deepEqual(mcpOrphans(rows, services).map((r) => r.pid), [200, 201, 500, 501]);
  assert.deepEqual(mcpOrphans(rows).map((r) => r.pid), [200, 201, 400, 500, 501]);
  assert.deepEqual(devOrphans(rows, services).map((r) => r.pid), [700, 701]);
});

test('recorded processes: stopped only while the same process, past the idle time, with no registry row held in their repository', () => {
  const live = parseLstart(['  4242 Mon Oct 26  9:00:00 2026     node server.js --port 3000  ', '  4243 Sun Oct 25 08:00:00 2026     vite', 'junk'].join('\n'));
  assert.deepEqual(live, [
    { pid: 4242, lstart: 'Mon Oct 26 9:00:00 2026', command: 'node server.js --port 3000' },
    { pid: 4243, lstart: 'Sun Oct 25 08:00:00 2026', command: 'vite' },
  ]);
  const at = (h) => new Date(NOW - h * HOUR).toISOString();
  const records = parseRecords(
    [
      JSON.stringify({ t: at(7), pid: 4242, lstart: 'Mon Oct 26 9:00:00 2026', command: 'node server.js --port 3000', repo: '/r/free' }),
      JSON.stringify({ t: at(7), pid: 4243, lstart: 'Sat Oct 24 08:00:00 2026', command: 'vite', repo: null }),
      JSON.stringify({ t: at(1), pid: 4242, lstart: 'Mon Oct 26 9:00:00 2026', command: 'node server.js --port 3000', repo: null }),
      JSON.stringify({ t: at(9), pid: 4242, lstart: 'Mon Oct 26 9:00:00 2026', command: 'node server.js --port 3000', repo: '/r/busy' }),
      '{"t":"x","pid":"4242"}',
      '{torn',
    ].join('\n'),
  );
  assert.equal(records.length, 4);
  const stop = recordedToStop(records, live, { now: NOW, heldRepos: new Set(['/r/busy']) });
  assert.deepEqual(stop.map((r) => [r.pid, r.repo]), [[4242, '/r/free']]);
  assert.equal(recordedToStop(records, [], { now: NOW }).length, 0);
});

test('in use: by a running executable or a working directory, macOS /private/var or not; held registry rows as harness-status reads them', () => {
  const dirs = ['/var/folders/ab/X/clone.1', '/var/folders/ab/X/clone.2', '/h/.codex/releases/0.1.0'];
  const rows = [{ command: '/private/var/folders/ab/X/clone.1/Google Chrome.app/Contents/MacOS/Google Chrome --type=renderer' }];
  assert.deepEqual([...inUse(dirs, rows, ['/h/.codex/releases/0.1.0/bin'])], ['/var/folders/ab/X/clone.1', '/h/.codex/releases/0.1.0']);
  assert.deepEqual([...inUse(dirs, [{ command: '/var/folders/ab/X/clone.10/x' }])], []);
  const registry = ['| # | Unit | Worktree |', '|---|---|---|', '| 0 | idle | - |', '<!-- harness:active -->', '| 1 | P2-01 | .worktrees/p2-01 |', '| 0 | P2-02 | - |', '<!-- /harness:active -->', '| 2 | outside | .worktrees/x |'].join('\n');
  assert.deepEqual(heldRows(registry), ['| 1 | P2-01 | .worktrees/p2-01 |']);
  assert.deepEqual(heldRows('| 3 | P1-01 | - |\n| 0 | P1-02 | - |'), ['| 3 | P1-01 | - |']);
  assert.deepEqual(heldRows(null), []);
});

test('worktrees: removed only when merged with commits of its own, no change, rebuildable ignored files alone, unheld, no process inside, idle', () => {
  const ctx = { now: NOW, idleHours: 6, rebuildable: /(^|\/)(node_modules|\.next)\/?$|\.DS_Store$/ };
  const done = { path: '/r/.worktrees/a', rel: '.worktrees/a', branch: 'task/a', merged: true, own: true, clean: true, ignored: [], active: NOW - 7 * HOUR };
  const verdict = (w, extra = {}) => worktreeVerdict({ ...done, ...w }, { ...ctx, ...extra });
  assert.equal(verdict({}), 'remove');
  assert.equal(verdict({ ignored: ['node_modules/', 'apps/web/.next/', '.DS_Store'] }), 'remove');
  assert.equal(verdict({ locked: true }), 'keep: locked');
  assert.equal(verdict({ branch: null }), 'keep: detached HEAD');
  assert.equal(verdict({ merged: false }), 'keep: not merged into the mainline');
  assert.equal(verdict({ own: false }), 'keep: no commits of its own');
  assert.equal(verdict({ clean: false }), 'keep: uncommitted or untracked changes');
  assert.equal(verdict({ ignored: ['node_modules/', '.env.local', 'key.json', 'notes/', 'more.txt'] }), 'keep: ignored files that are not rebuildable (.env.local, key.json, notes/, …)');
  assert.equal(verdict({}, { held: ['| 1 | P1-01 | task/a |'] }), 'keep: a held registry row names it');
  assert.equal(verdict({}, { held: ['| 1 | P1-01 | .worktrees/a |'] }), 'keep: a held registry row names it');
  assert.equal(verdict({}, { cwds: ['/r/.worktrees/a/apps/api'] }), 'keep: a process runs inside it');
  assert.equal(verdict({}, { cwds: ['/r/.worktrees/ab'] }), 'remove');
  assert.equal(verdict({ active: NOW - HOUR }), 'keep: used in the last 6 h');
  assert.equal(verdict({ active: NaN }), 'keep: used in the last 6 h');
  const list = parseWorktrees('worktree /r\nHEAD a1\nbranch refs/heads/main\n\nworktree /r/.worktrees/a\nHEAD b2\nbranch refs/heads/task/a\nlocked\n\nworktree /gone\nHEAD c3\ndetached\nprunable gitdir file points to non-existent location\n');
  assert.deepEqual(list.map((w) => [w.path, w.branch, w.locked, w.prunable]), [['/r', 'main', false, false], ['/r/.worktrees/a', 'task/a', true, false], ['/gone', null, false, true]]);
});

test('deletable: strictly inside its root, the root strictly inside the home (or Chrome\'s clone directory), nothing the agents or the harness keep', () => {
  assert.equal(deletable('/h/Library/Caches/x-updater', '/h/Library/Caches', '/h'), true);
  assert.equal(deletable('/h/Library/Caches', '/h/Library/Caches', '/h'), false);
  assert.equal(deletable('/h/Library/Caches/../Preferences', '/h/Library/Caches', '/h'), false);
  assert.equal(deletable('/h/Library/Other/x', '/h/Library/Caches', '/h'), false);
  assert.equal(deletable('/opt/cache/x', '/opt/cache', '/h'), false);
  assert.equal(deletable('/h/x', '/h', '/h'), false);
  assert.equal(deletable('/Library/Caches/x', '/Library/Caches', '/'), false);
  assert.equal(deletable('/h/.claude/projects/p/s.jsonl', '/h/.claude', '/h'), false);
  assert.equal(deletable('/h/.codex/sessions/2026', '/h/.codex', '/h'), false);
  assert.equal(deletable('/h/.agents/harness/retro/p', '/h/.agents', '/h'), false);
  assert.equal(deletable('/h/.codex/packages/standalone/releases/0.1.0', '/h/.codex/packages/standalone/releases', '/h'), true);
  const clones = '/private/var/folders/ab/cdef/X/com.google.Chrome.code_sign_clone';
  assert.equal(deletable(`${clones}/code_sign_clone.Ab12`, clones, '/h'), true);
  assert.equal(deletable('/var/folders/ab/cdef/T/x', '/var/folders/ab/cdef/T', '/h'), false);
});

test('sizes, the report and the log line', () => {
  assert.equal(dockerBytes('3.251GB'), 3_251_000_000);
  assert.equal(dockerBytes('12.29kB'), 12_290);
  assert.equal(dockerBytes('0B (0%)'), 0);
  assert.equal(dockerBytes(undefined), 0);
  assert.deepEqual([fmtBytes(0), fmtBytes(NaN), fmtBytes(400_000), fmtBytes(5e8), fmtBytes(2.14e9)], ['0', '0', '1 MB', '500 MB', '2.1 GB']);
  const text = formatReport({
    free: 20.1e9,
    total: 245.1e9,
    approved: ['npm'],
    measured: [
      { id: 'pnpm', bytes: 1.1e9, upTo: true, detail: '`pnpm store prune` on v10 (1.1 GB); keep v3, written 2 d ago' },
      { id: 'npm', bytes: 4.55e8 },
      { id: 'docker', absent: 'the docker daemon is not running' },
      { id: 'chrome-clones', bytes: 0, unknown: true, detail: '123 of 123 clones (0 in use)' },
      { id: 'orphan-mcp', count: 2, detail: '2: 200, 201' },
    ],
    dev: [{ pid: 700, etime: '2-13:00:00', rss: 61_440 * 1024, command: 'bun run src/main.ts', cwd: '~/p/worker', ports: [5173, 24678] }],
  });
  const listeners = parseListeners('p700\nf12\nn*:5173\nf13\nn[::1]:5173\nf14\nn127.0.0.1:24678\np701\nf9\nn*:http\np900\nf3\nn*:9000\n');
  assert.deepEqual([...listeners], [[700, [5173, 24678]], [900, [9000]]]);
  const procs = [{ pid: 690, ppid: 1 }, { pid: 695, ppid: 690 }, { pid: 700, ppid: 695 }, { pid: 900, ppid: 1 }];
  assert.deepEqual([treePorts(690, procs, listeners), treePorts(700, procs, listeners), treePorts(901, procs, listeners)], [[5173, 24678], [5173, 24678], []]);
  assert.match(text, /^machine-sweep: 20\.1 GB free of 245\.1 GB · approved: npm\n/);
  assert.match(text, /^pnpm +≤1\.1 GB {12}`pnpm store prune` on v10/m);
  assert.match(text, /^npm +455 MB {2}approved {2}the npm cache: /m);
  assert.match(text, /^docker +- {12}absent: the docker daemon is not running$/m);
  assert.match(text, /^chrome-clones +\? {12}123 of 123 clones/m);
  assert.match(text, /^orphan-mcp +2 proc {12}2: 200, 201$/m);
  assert.match(text, /^reclaimable: at most 1\.6 GB$/m);
  assert.match(text, /^ {2}700 +up 2-13:00:00 +63 MB {2}bun run src\/main\.ts {2}\(in ~\/p\/worker\) {2}listening on 5173, 24678$/m);
  assert.match(formatReport({ free: 1, total: 2, approved: [], measured: [{ id: 'npm', bytes: 1e9 }] }), /approved: none[\s\S]*reclaimable: about 1\.0 GB/);
  assert.deepEqual(logEntry({ now: NOW, before: 20e9, after: 26e9, categories: { npm: 4.5e8 }, errors: [] }), { t: '2026-10-26T12:00:00.000Z', freed: 6e9, before: 20e9, after: 26e9, categories: { npm: 4.5e8 }, errors: [] });
  assert.equal(logEntry({ now: NOW, before: 20e9, after: 19e9, categories: {}, errors: [] }).freed, 0);
});

// ---- the CLI, against a temp --home

const cachesRel = process.platform === 'darwin' ? ['Library', 'Caches'] : process.platform === 'win32' ? ['AppData', 'Local'] : ['.cache'];
const past = (h) => new Date(Date.now() - h * HOUR);

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k.startsWith('PLAYWRIGHT_') || k.startsWith('BUN_') || k === 'XDG_CACHE_HOME') delete env[k];
  return { ...env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
}

function cli(home, args, cwd = home) {
  return spawnSync(process.execPath, [CLI, '--home', home, ...args], { cwd, env: cleanEnv(), encoding: 'utf8', timeout: 120_000 });
}

/** Write a file and backdate it and its directories up to `stopAt`. */
function put(file, text = 'x', hoursAgo = 0, stopAt = null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (!hoursAgo) return;
  for (let p = file; p !== stopAt && p !== path.dirname(p); p = path.dirname(p)) fs.utimesSync(p, past(hoursAgo), past(hoursAgo));
}

/** A home holding one category of each fs kind: Playwright browsers, updater caches, Codex releases, a bun cache. */
function fakeHome() {
  const home = tmpDir('machine-sweep-home-');
  const caches = path.join(home, ...cachesRel);
  const pw = path.join(caches, 'ms-playwright');
  for (const dir of ['chromium-1100', 'chromium-1200', 'ffmpeg-1000']) put(path.join(pw, dir, 'INSTALLATION_COMPLETE'));
  const core = path.join(home, 'proj', 'node_modules', 'playwright-core');
  put(path.join(core, 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium', revision: '1200' }, { name: 'ffmpeg', revision: '1000' }] }));
  put(path.join(pw, '.links', 'abc'), core);
  put(path.join(caches, 'old-updater', 'pending', 'u.zip'), 'zip', 2, caches);
  put(path.join(caches, 'new-updater', 'pending', 'u.zip'), 'zip');
  const releases = path.join(home, '.codex', 'packages', 'standalone', 'releases');
  for (const v of ['0.1.0-x', '0.2.0-x', '0.3.0-x', '0.4.0-x']) put(path.join(releases, v, 'bin', 'codex'));
  fs.symlinkSync(path.join(releases, '0.4.0-x'), path.join(home, '.codex', 'packages', 'standalone', 'current'));
  put(path.join(home, '.bun', 'install', 'cache', 'pkg@1.0.0', 'index.js'));
  return { home, caches, pw, releases };
}

const tree = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .sort();

test('the CLI: the report names what each category would free and changes nothing; with nothing approved, applying touches nothing', posixOnly, () => {
  const h = fakeHome();
  const before = tree(h.home);
  const res = cli(h.home, ['--only', 'pnpm,bun,playwright,updaters,codex,orphan-mcp']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^machine-sweep: .* free of .* · approved: none$/m);
  assert.match(res.stdout, /^pnpm +- {12}absent: another --home: this tool keeps its cache in the real one$/m);
  assert.match(res.stdout, /^playwright +\d+ MB {12}remove chromium-1100; 1 live installation$/m);
  assert.match(res.stdout, /^updaters +\d+ MB {12}remove old-updater; keep new-updater, written in the last 1 h$/m);
  assert.match(res.stdout, /^codex +\d+ MB {12}standalone: keep 0\.3\.0-x, 0\.4\.0-x; worktrees: none to remove$/m);
  assert.match(res.stdout, /^orphan-mcp +- {12}absent: another --home: the processes are this machine's$/m);
  const json = JSON.parse(cli(h.home, ['--only', 'codex', '--json']).stdout);
  assert.deepEqual(json.categories[0].plan, ['0.1.0-x', '0.2.0-x'].map((v) => `remove ${path.join(h.releases, v)}`));
  const nothing = cli(h.home, ['--apply-approved']);
  assert.equal(nothing.status, 0, nothing.stderr);
  assert.match(nothing.stdout, /nothing is approved, so nothing was touched; the owner approves categories once with --approve/);
  assert.deepEqual(tree(h.home), before);
});

test('the CLI: --approve records the categories and installs the copy harness-due runs; a dry run changes nothing; applying frees only the approved categories named, and logs one line', posixOnly, () => {
  const h = fakeHome();
  const approved = cli(h.home, ['--approve', 'updaters,codex,playwright,bun']);
  assert.equal(approved.status, 0, approved.stderr);
  const state = path.join(h.home, '.agents', 'harness');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'sweep.json'), 'utf8')).approved, ['bun', 'playwright', 'updaters', 'codex']);
  assert.ok(fs.existsSync(path.join(state, 'machine-sweep', 'machine-sweep.mjs')) && fs.existsSync(path.join(state, 'machine-sweep', 'lib', 'machine-sweep-core.mjs')));
  assert.match(approved.stdout, new RegExp(`the copy harness-due runs: ${path.join(state, 'machine-sweep', 'machine-sweep.mjs').replace(/[.]/g, '\\.')}`));
  assert.ok(!/installed copy/.test(cli(h.home, ['--only', 'npm']).stdout), 'a fresh copy read as changed');
  fs.appendFileSync(path.join(state, 'machine-sweep', 'lib', 'machine-sweep-core.mjs'), '// another release\n');
  assert.match(cli(h.home, ['--only', 'npm']).stdout, /^The installed copy \(.+\) differs from this skill's: --approve <ids> again refreshes it\.$/m);
  assert.equal(cli(h.home, ['--approve', 'bun']).status, 0);
  assert.ok(!/installed copy/.test(cli(h.home, ['--only', 'npm']).stdout), 'approving again left the copy as it was');
  const before = tree(h.home);
  const dry = cli(h.home, ['--apply-approved', '--dry-run', '--only', 'playwright,updaters,codex,npm']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, new RegExp(`^would  playwright: remove ${path.join(h.pw, 'chromium-1100').replace(/[.]/g, '\\.')}$`, 'm'));
  assert.ok(!/npm/.test(dry.stdout), 'an unapproved category ran');
  assert.deepEqual(tree(h.home), before);
  const res = spawnSync(process.execPath, [path.join(state, 'machine-sweep', 'machine-sweep.mjs'), '--home', h.home, '--apply-approved', '--only', 'playwright,updaters,codex'], { env: cleanEnv(), encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.deepEqual(fs.readdirSync(h.pw).sort(), ['.links', 'chromium-1200', 'ffmpeg-1000']);
  assert.ok(!fs.existsSync(path.join(h.caches, 'old-updater')) && fs.existsSync(path.join(h.caches, 'new-updater')));
  assert.deepEqual(fs.readdirSync(h.releases).sort(), ['0.3.0-x', '0.4.0-x']);
  assert.ok(fs.existsSync(path.join(h.home, '.bun', 'install', 'cache', 'pkg@1.0.0')), 'bun was not in --only');
  const lines = fs.readFileSync(path.join(state, 'sweep-log.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.ok(typeof entry.t === 'string' && Number.isFinite(entry.freed) && entry.freed >= 0, lines[0]);
  assert.deepEqual(Object.keys(entry.categories), ['playwright', 'updaters', 'codex']);
  assert.deepEqual(entry.errors, []);
});

test('the CLI: a recorded process is stopped once idle and still the same process; one recorded just now is not', posixOnly, async () => {
  const h = fakeHome();
  const state = path.join(h.home, '.agents', 'harness');
  const start = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
  const old = start();
  const fresh = start();
  try {
    const outside = tmpDir('machine-sweep-cwd-');
    for (const child of [old, fresh]) assert.equal(cli(h.home, ['--record', String(child.pid)], outside).status, 0);
    const file = path.join(state, 'pids.jsonl');
    const records = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(records.map((r) => [r.pid, r.repo]), [[old.pid, null], [fresh.pid, null]]);
    records[0].t = past(7).toISOString();
    fs.writeFileSync(file, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
    assert.equal(cli(h.home, ['--approve', 'recorded-pids']).status, 0);
    const exited = new Promise((resolve) => old.once('exit', (code, signal) => resolve(signal)));
    const res = cli(h.home, ['--apply-approved', '--only', 'recorded-pids']);
    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, /^done {3}recorded-pids: 1 stopped$/m);
    assert.equal(await Promise.race([exited, new Promise((r) => setTimeout(() => r('still running'), 5000))]), 'SIGTERM');
    assert.equal(fresh.exitCode, null, 'the process recorded just now was stopped');
    assert.equal(cli(h.home, ['--record', '999999999']).status, 1);
  } finally {
    old.kill();
    fresh.kill();
  }
});

test('the CLI: a registered repository\'s worktree is removed only when it is residue; one holding a hand-written ignored file stays', { ...posixOnly, skip: posixOnly.skip || (WORKTREE_IDLE_HOURS > 48 && 'WORKTREE_IDLE_HOURS is over the fixture\'s 2 days') }, () => {
  const h = fakeHome();
  const repo = tmpDir('machine-sweep-repo-');
  const date = past(48).toISOString();
  const git = (args, cwd = repo) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...cleanEnv(), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git(['init', '-q', '-b', 'main']);
  put(path.join(repo, '.gitignore'), '.worktrees/\nnode_modules/\n.env.local\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  for (const name of ['done', 'keys']) {
    const dir = path.join(repo, '.worktrees', name);
    git(['worktree', 'add', '-q', '-b', `task/${name}`, dir, 'main']);
    put(path.join(dir, `${name}.txt`), name);
    git(['add', '.'], dir);
    git(['commit', '-q', '-m', name], dir);
    git(['merge', '-q', '--no-ff', '-m', `Merge task/${name}`, `task/${name}`]);
  }
  put(path.join(repo, '.worktrees', 'done', 'node_modules', 'x.js'));
  put(path.join(repo, '.worktrees', 'keys', '.env.local'), 'TOKEN=x\n');
  for (const name of ['done', 'keys']) {
    for (const p of [path.join(repo, '.worktrees', name, '.git'), path.join(repo, '.git', 'worktrees', name, 'logs', 'HEAD')]) fs.utimesSync(p, past(48), past(48));
  }
  put(path.join(h.home, '.agents', 'harness', 'repos.json'), JSON.stringify({ schema: 1, repos: [{ path: repo, project: 'r' }] }));
  const report = cli(h.home, ['--only', 'worktrees']);
  assert.equal(report.status, 0, report.stderr);
  const keepsKeys = !REBUILDABLE.test('.env.local');
  assert.match(report.stdout, keepsKeys ? /remove \.worktrees\/done; keep 1 ignored files that are not rebuildable \(\.env\.local\)$/m : /remove \.worktrees\/done, \.worktrees\/keys$/m);
  assert.equal(cli(h.home, ['--approve', 'worktrees']).status, 0);
  const res = cli(h.home, ['--apply-approved', '--only', 'worktrees']);
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.ok(!fs.existsSync(path.join(repo, '.worktrees', 'done')));
  assert.equal(fs.existsSync(path.join(repo, '.worktrees', 'keys', '.env.local')), keepsKeys);
  const listed = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout;
  assert.ok(!listed.includes('.worktrees/done'), listed);
});

test('the CLI: a held lock makes a second run wait, a stale one is replaced; usage errors exit 2', posixOnly, () => {
  const h = fakeHome();
  const state = path.join(h.home, '.agents', 'harness');
  assert.equal(cli(h.home, ['--approve', 'updaters']).status, 0);
  const lockFile = path.join(state, 'machine-sweep.lock');
  fs.writeFileSync(lockFile, '1\n');
  const held = cli(h.home, ['--apply-approved']);
  assert.equal(held.status, 1);
  assert.match(held.stderr, /another sweep holds the lock/);
  assert.ok(fs.existsSync(path.join(h.caches, 'old-updater')));
  fs.utimesSync(lockFile, past(2), past(2));
  const stale = cli(h.home, ['--apply-approved']);
  assert.equal(stale.status, 0, stale.stderr);
  assert.ok(!fs.existsSync(path.join(h.caches, 'old-updater')) && !fs.existsSync(lockFile));
  for (const args of [['--approve', 'nope'], ['--dry-run'], ['--report', '--apply-approved'], ['--nope']]) {
    const bad = cli(h.home, args);
    assert.equal(bad.status, 2, args.join(' '));
    assert.match(bad.stderr, /^machine-sweep: .*\nusage: /);
  }
});
