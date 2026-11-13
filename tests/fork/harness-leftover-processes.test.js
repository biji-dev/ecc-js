/**
 * Tests for the harness-bootstrap leftover-processes hook template (biji-dev/ecc-js): the reaper's
 * selection over fixture `ps` text (own-uid orphans in the checkout or runaway shells anywhere, and
 * nothing with a TTY, a live parent, another uid, a listener or too little age), the stuck tool
 * shells a Stop reports once, a real orphan reaped by its process group, the daily disk notice, the
 * leftover listing to the model (a main checkout's worktrees and a prefix-sharing sibling left out,
 * at most once per window), and mutation checks.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { randomBytes } = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
// LEFTOVER_UNDER_TEST points the suite at another copy of the hook; unset, it tests the shipped file.
const HOOK = process.env.LEFTOVER_UNDER_TEST || path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'leftover-processes.mjs');
const LSOF = process.platform !== 'win32' && spawnSync('lsof', ['-v'], { encoding: 'utf8' }).error?.code !== 'ENOENT';
const UID = typeof process.getuid === 'function' ? process.getuid() : 0;

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name, fn, { skip = false } = {}) {
  if (skip) {
    console.log(`  - ${name} (skipped: ${skip})`);
    skipped += 1;
    return;
  }
  try {
    await fn();
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

/** Kill a detached child's whole process group. */
function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

/** A main checkout (a .git directory) with a linked worktree under .worktrees/ (a .git file). */
function checkout() {
  const root = tmp('leftover-co-');
  fs.mkdirSync(path.join(root, '.git'));
  const worktree = path.join(root, '.worktrees', 'p1-01');
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(root, '.git', 'worktrees', 'p1-01')}\n`);
  return { root, worktree };
}

/** A TCP listener in its own process group, whose working directory is `cwd`, `args` on its command line; resolves once it listens. */
function listen(cwd, args = []) {
  const child = spawn(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => console.log(s.address().port)); setTimeout(() => {}, 120000);", '--', ...args], { cwd, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  cleanup.push(() => killGroup(child.pid));
  return new Promise((resolve, reject) => {
    child.stdout.once('data', (d) => resolve({ pid: child.pid, port: Number(String(d).trim()) }));
    child.once('error', reject);
  });
}

function mutant(from, to, source = fs.readFileSync(HOOK, 'utf8')) {
  assert.ok(source.includes(from), `not in the shipped file: ${from}`);
  const script = path.join(tmp('leftover-m-'), 'leftover-processes.mjs');
  fs.writeFileSync(script, source.replace(from, to));
  return script;
}

// Hermetic: an emulator or a VM running on this machine is named whoever started it, so every case
// but the machine-wide one runs a copy that names none.
const MACHINE_WIDE = 'const MACHINE_WIDE = /^(qemu-system|emulator64-)/;';
const QUIET = mutant(MACHINE_WIDE, 'const MACHINE_WIDE = /(?!)/;');
const quiet = (from, to) => mutant(from, to, fs.readFileSync(QUIET, 'utf8'));

const outputs = [];
/**
 * Run the hook for `event` from `dir`; returns its parsed output, or null when it says nothing. By
 * default nothing on this machine is old enough to reap, the machine-wide runaway rule is off (a
 * live run would take any just-started orphaned `sh -c`), and nothing is killed or notified.
 */
function runHook(event, dir, { script = QUIET, session = 's', tmpdir = tmp('leftover-t-'), env: extra = {}, input = {} } = {}) {
  const env = { ...process.env, TMPDIR: tmpdir, LEFTOVER_REAP_MINUTES: '100000000', LEFTOVER_RUNAWAY: '0', LEFTOVER_KILL: '0', LEFTOVER_NOTIFY: '0', LEFTOVER_HOME: tmp('leftover-h-'), LEFTOVER_FREE_GB: '100', ...extra };
  delete env.CLAUDE_PROJECT_DIR;
  // fixture pids are no real processes: their service-manager reading is a fixture too
  if (extra.LEFTOVER_PS && !('LEFTOVER_MANAGED' in extra)) env.LEFTOVER_MANAGED = managedFile([]);
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  const res = spawnSync(process.execPath, [script], { input: JSON.stringify({ hook_event_name: event, cwd: dir, session_id: session, ...input }), env, encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(res.status, 0, res.stderr);
  outputs.push(res.stdout);
  return res.stdout.trim() ? JSON.parse(res.stdout) : null;
}

// ---- fixture ps text, in the hook's format (macOS's columns: comm padded to 16)
function psLine({ pid, ppid = 1, pgid = pid, uid = UID, tty = '??', etime, time = '0:00.00', comm, args }) {
  return `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${String(pgid).padStart(5)} ${String(uid).padStart(5)} ${tty.padEnd(8)} ${etime.padStart(11)} ${time.padStart(9)} ${comm.slice(0, 16).padEnd(16)} ${args}`;
}
function managedFile(pids) {
  const file = path.join(tmp('leftover-mg-'), 'managed.txt');
  fs.writeFileSync(file, pids.join('\n'));
  return file;
}
const fixture = (lines) => {
  const file = path.join(tmp('leftover-ps-'), 'ps.txt');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
};

/** A directory of stand-in commands (POSIX shell scripts), to put first on the hook's PATH. */
function fakeBin(scripts) {
  const dir = tmp('leftover-bin-');
  for (const [name, body] of Object.entries(scripts)) {
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`);
    fs.chmodSync(path.join(dir, name), 0o755);
  }
  return dir;
}
/** A pid no process holds now, so a hook run that would signal it signals nothing. */
function freePid() {
  for (let pid = 99_990; pid > 90_000; pid -= 7) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') return pid;
    }
  }
  throw new Error('no free pid');
}
const d0 = new Date();
const TODAY = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT = '/work/project';
// 91900 is a group leader with no row: the tool shell that started them is gone
const inRoot = { pid: 91001, pgid: 91900, etime: '11:00', comm: '/usr/local/bin/node', args: 'node server.js' };
const argvRoot = { pid: 91002, pgid: 91900, etime: '11:00', comm: '/usr/local/bin/node', args: `node ${PROJECT}/scripts/probe.mjs` };
const runaway = { pid: 91003, pgid: 91900, etime: '12:00', time: '4:48.00', comm: '/bin/zsh', args: '/bin/zsh -c until false; do :; done' };
// what each reaped line ends with
const HINT = " — each outlived the shell that started it (one that listens is kept 6 h, while its directory exists); start what must keep running with the host's own background option (Claude Code: the Bash tool's run_in_background), not a shell `&`.";

(async () => {
  console.log('\nharness-bootstrap leftover-processes hook');
  const noLsof = !LSOF && 'lsof is not installed';
  const hook = await import(pathToFileURL(HOOK).href);
  const cwds = new Map([['91001', [`${PROJECT}/app`]], ['91002', ['/elsewhere']], ['91003', ['/elsewhere']]]);
  // the fixture directories exist unless a case says otherwise
  const opts = (extra = {}) => ({ uid: UID, root: PROJECT, worktrees: null, listeners: new Map(), cwds, selfChain: new Set(), gone: () => false, ...extra });
  const pick = (specs, extra) => hook.reapable(hook.parsePsRows(specs.map(psLine).join('\n')), opts(extra)).map((r) => r.pid);

  await test('parsePsRows reads both platforms\' columns, and completes a comm ps cut short from argv[0]', () => {
    const rows = hook.parsePsRows([
      '  110     1   110     0 ??       04-09:20:57   3:10.16 /usr/libexec/Use /usr/libexec/UserEventAgent (System)',
      '  812     1   812  1000 ?          12:00 00:04:48 bash            bash -c yes',
      '  913     1   913   501 ??          01:00   0:00.10 /Users/a b/bin/t /Users/a b/bin/tool --flag',
    ].join('\n'));
    assert.deepStrictEqual(rows.map((r) => r.name), ['UserEventAgent', 'bash', 'tool']);
    assert.strictEqual(rows[0].elapsed, (((4 * 24 + 9) * 60 + 20) * 60 + 57) * 1000);
    assert.strictEqual(rows[0].cpu, 190160);
    assert.strictEqual(rows[1].cpu, 288000);
    assert.strictEqual(rows[1].args, 'bash -c yes');
    assert.strictEqual(rows[2].args, '/Users/a b/bin/tool --flag');
  });

  await test('reaped: an orphan with its cwd in the checkout, one whose argv holds the checkout, a runaway `zsh -c` anywhere', () => {
    assert.deepStrictEqual(pick([inRoot, argvRoot, runaway]), [91001, 91002, 91003]);
    assert.deepStrictEqual(hook.reapable(hook.parsePsRows(psLine({ pid: 812, pgid: 899, etime: '12:00', time: '00:04:48', comm: 'bash', args: 'bash -c yes', tty: '?' })), opts()).map((r) => r.pid), [812], 'Linux columns');
  });

  await test('kept: a TTY, a live parent, another uid, 9 minutes, a listener, the hook\'s own chain', () => {
    assert.deepStrictEqual(pick([{ ...inRoot, tty: 'ttys003' }]), []);
    assert.deepStrictEqual(pick([{ ...inRoot, ppid: 4242 }]), []);
    assert.deepStrictEqual(pick([{ ...inRoot, uid: UID + 1 }]), []);
    assert.deepStrictEqual(pick([{ ...inRoot, etime: '09:00' }]), []);
    assert.deepStrictEqual(pick([inRoot], { listeners: new Map([['91001', ['*:3000']]]) }), []);
    assert.deepStrictEqual(pick([inRoot], { selfChain: new Set([91001]) }), []);
    assert.deepStrictEqual(pick([{ ...runaway, tty: 'ttys003' }]), [], 'a runaway shell on a terminal is the owner\'s');
  });

  await test('kept: `npm run dev &` and the like, whose server listens as a child or grandchild of the orphaned runner', () => {
    const npm = { pid: 91010, pgid: 91900, etime: '14:00', comm: '/usr/local/bin/npm', args: 'npm run dev' };
    const sh = { pid: 91011, ppid: 91010, pgid: 91900, etime: '14:00', comm: '/bin/sh', args: 'sh -c next dev' };
    const server = { pid: 91012, ppid: 91011, pgid: 91900, etime: '14:00', comm: '/usr/local/bin/node', args: 'node node_modules/.bin/next dev' };
    const at = new Map([['91010', [`${PROJECT}/web`]]]);
    assert.deepStrictEqual(pick([npm, sh, server], { cwds: at }), [91010], 'control: nothing listens');
    assert.deepStrictEqual(pick([npm, sh, server], { cwds: at, listeners: new Map([['91012', ['*:3000']]]) }), [], 'the grandchild listens');
    assert.deepStrictEqual(pick([npm, { ...server, ppid: 91010 }], { cwds: at, listeners: new Map([['91012', ['*:3000']]]) }), [], 'the child listens');
    assert.deepStrictEqual(pick([npm, sh, server, inRoot], { cwds: new Map([...cwds, ...at]), listeners: new Map([['91012', ['*:3000']]]) }), [91001], 'an unrelated orphan is still reaped');
  });

  await test('a server left running in the checkout is kept LISTEN_HOURS, and only while its directory exists; elsewhere, or named by KEEP, it stays', () => {
    const listens = { listeners: new Map([['91001', ['*:3000']]]) };
    const at = (etime) => [{ ...inRoot, etime }];
    const why = (specs, extra) => hook.reapable(hook.parsePsRows(specs.map(psLine).join('\n')), opts({ ...listens, ...extra })).map((r) => [r.pid, r.why]);
    assert.deepStrictEqual(why(at('05:59:59')), [], 'under 6 h');
    assert.deepStrictEqual(why(at('06:00:00')), [[91001, 'listening']], 'at 6 h');
    assert.deepStrictEqual(why(at('30:00'), { gone: (p) => p === `${PROJECT}/app` }), [[91001, 'listening, its directory gone']], 'its directory removed');
    const wt = { worktrees: '/work/wt', cwds: new Map([['91001', ['/work/wt/p1-01 (deleted)']]]), gone: hook.dirGone };
    assert.deepStrictEqual(why(at('30:00'), wt), [[91001, 'listening, its directory gone']], 'a worktree removed, as Linux names its cwd');
    assert.deepStrictEqual(why([{ ...argvRoot, etime: '30:00' }], { listeners: new Map([['91002', ['*:3000']]]), cwds: new Map(), gone: () => true }), [], 'a cwd not read counts as there');
    assert.deepStrictEqual(why(at('07:00:00'), { root: null, gone: () => true }), [], 'outside the checkout');
    assert.deepStrictEqual(why([{ ...runaway, etime: '07:00:00', time: '3:00:00' }], { listeners: new Map([['91003', ['*:3000']]]) }), [], 'a runaway shell that listens, anywhere');
    assert.deepStrictEqual(why(at('07:00:00'), { keep: /server\.js/, gone: () => true }), [], 'KEEP names it');
    assert.deepStrictEqual(why(at('07:00:00'), { managed: new Set([91001]) }), [], 'its service manager runs it');
    assert.match(hook.formatReaped([{ name: 'pnpm', pid: 7, elapsed: 7 * 3_600_000, why: 'listening' }, { name: 'zsh', pid: 8, elapsed: 660_000 }]), /^reaped 2: pnpm \(pid 7, 7h, listening\), zsh \(pid 8, 11m\) — /);
    assert.match(fs.readFileSync(HOOK, 'utf8'), /^const LISTEN_HOURS = 6; \/\/ \[B\] /m);
  });

  await test('kept: an orphan whose command line, or a child\'s, matches the KEEP binding; none is kept by default', () => {
    const worker = { ...inRoot, args: 'node artisan queue:work' };
    const child = { pid: 91020, ppid: 91001, pgid: 91900, etime: '11:00', comm: '/usr/local/bin/php', args: 'php artisan queue:work' };
    assert.deepStrictEqual(pick([worker]), [91001], 'control: KEEP is empty');
    assert.deepStrictEqual(pick([worker], { keep: /\bqueue:work\b/ }), []);
    assert.deepStrictEqual(pick([inRoot, child], { keep: /\bqueue:work\b/ }), [], 'a child matches');
    assert.deepStrictEqual(pick([inRoot], { keep: /\bqueue:work\b/ }), [91001]);
    const twin = { ...argvRoot, args: `${argvRoot.args} queue:work` };
    assert.deepStrictEqual(pick([twin, worker], { keep: /\bqueue:work\b/g }), [], 'a g flag carries nothing from row to row');
    const g = /\bqueue:work\b/g;
    assert.deepStrictEqual([pick([worker], { keep: g }), pick([worker], { keep: g })], [[], []], 'nor from call to call');
    assert.deepStrictEqual(pick([worker], { keep: /queue:work/y }), [], 'a y flag matches anywhere too');
    assert.match(fs.readFileSync(HOOK, 'utf8'), /^const KEEP = null; \/\/ \[B\] /m);
  });

  await test('kept elsewhere: a `zsh -c` at 10% CPU, a `node` at 90%, a shell with no `-c`, and nothing in a checkout when there is none', () => {
    assert.deepStrictEqual(pick([{ ...runaway, time: '1:12.00' }]), []);
    assert.deepStrictEqual(pick([{ ...runaway, comm: '/usr/local/bin/node', args: 'node spin.js', time: '10:48.00' }]), []);
    assert.deepStrictEqual(pick([{ ...runaway, args: '/bin/zsh spin.zsh' }]), []);
    assert.deepStrictEqual(pick([inRoot, argvRoot], { root: null }), []);
  });

  await test('a main checkout reaps in its worktrees too; a sibling that only shares the prefix is not inside', () => {
    const wt = new Map([['91001', ['/work/wt/p1-01']]]);
    assert.deepStrictEqual(pick([inRoot], { cwds: wt, worktrees: '/work/wt' }), [91001]);
    assert.deepStrictEqual(pick([inRoot], { cwds: new Map([['91001', [`${PROJECT}-other`]]]) }), []);
  });

  await test('in the checkout, only an orphan whose group leader is gone: a live leader row, or leading its own group, spares it', () => {
    const leader = { pid: 91900, ppid: 4242, etime: '20:00', comm: '/bin/zsh', args: '/bin/zsh -c node server.js &' };
    assert.deepStrictEqual(pick([inRoot, leader]), [], 'its tool shell still runs');
    assert.deepStrictEqual(pick([{ ...inRoot, pgid: 91001 }]), [], 'it leads its own group (tmux, an editor, ssh -f)');
    assert.deepStrictEqual(pick([{ ...argvRoot, pgid: 91002 }]), []);
    assert.deepStrictEqual(pick([inRoot]), [91001]);
  });

  await test('a runaway shell is reaped only in a group whose leader is gone, and not at all with the runaway rule off', () => {
    assert.deepStrictEqual(pick([runaway]), [91003], 'a tool shell\'s leftover job');
    assert.deepStrictEqual(pick([{ ...runaway, pgid: 91003 }]), [], 'it leads its group (a terminal\'s nohup job, a daemon)');
    assert.deepStrictEqual(pick([runaway, { pid: 91900, ppid: 4242, etime: '20:00', comm: '/bin/zsh', args: '/bin/zsh' }]), [], 'its leader still runs');
    assert.deepStrictEqual(pick([runaway], { runaway: false }), []);
    assert.strictEqual(runHook('SessionStart', checkout().root, { env: { LEFTOVER_PS: fixture([psLine(runaway)]), LEFTOVER_REAP_MINUTES: undefined } }), null, 'LEFTOVER_RUNAWAY=0');
  });

  await test('a process its service manager runs is spared by both rules; an unknown reading reaps nothing', () => {
    assert.deepStrictEqual(pick([inRoot, argvRoot, runaway], { managed: new Set([91001, 91003]) }), [91002]);
    assert.deepStrictEqual(pick([inRoot, runaway], { managed: null }), []);
    const managed = managedFile([91003]);
    assert.strictEqual(runHook('SessionStart', checkout().root, { env: { LEFTOVER_PS: fixture([psLine(runaway)]), LEFTOVER_MANAGED: managed, LEFTOVER_REAP_MINUTES: undefined, LEFTOVER_RUNAWAY: undefined } }), null);
  });

  await test('managedPids: a systemd .service cgroup (system or a user manager\'s) or an unreadable one is managed, a .scope is not; launchd\'s list, or nothing when it fails', () => {
    const cgroups = {
      1: '0::/system.slice/cron.service\n',
      2: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/worker.service\n',
      3: '0::/user.slice/user-1000.slice/session-3.scope\n',
      4: '12:pids:/user.slice/user-1000.slice/session-3.scope\n1:name=systemd:/user.slice/user-1000.slice/session-3.scope\n',
    };
    const readCgroup = (pid) => {
      if (!(pid in cgroups)) throw new Error('ENOENT');
      return cgroups[pid];
    };
    const elsewhere = () => '0::/user.slice/user-1000.slice/session-9.scope\n';
    assert.deepStrictEqual([...hook.managedPids([1, 2, 3, 4, 5], { platform: 'linux', readCgroup, ownCgroup: elsewhere })], [1, 2, 5]);
  });

  await test('managedPids on Linux: the hook\'s own .service cgroup is the session\'s (its leftovers are its own); another service, or an unreadable own cgroup, is managed', () => {
    const cgroups = {
      1: '0::/system.slice/ci-runner.service\n',
      2: '0::/system.slice/cron.service\n',
      3: '11:pids:/system.slice/ci-runner.service\n1:name=systemd:/system.slice/ci-runner.service\n',
    };
    const readCgroup = (pid) => cgroups[pid];
    assert.deepStrictEqual([...hook.managedPids([1, 2], { platform: 'linux', readCgroup, ownCgroup: () => cgroups[1] })], [2]);
    assert.deepStrictEqual([...hook.managedPids([3], { platform: 'linux', readCgroup, ownCgroup: () => cgroups[3] })], [], 'cgroup v1: the systemd line');
    assert.deepStrictEqual([...hook.managedPids([1, 2], { platform: 'linux', readCgroup, ownCgroup: () => { throw new Error('EACCES'); } })], [1, 2]);
    assert.strictEqual(hook.cgroupPath(cgroups[3]), '/system.slice/ci-runner.service');
    assert.strictEqual(hook.cgroupPath(cgroups[1]), '/system.slice/ci-runner.service');
    const launchctl = () => 'PID\tStatus\tLabel\n-\t0\tcom.example.idle\n301\t0\tcom.example.agent\n302\t-9\tcom.example.other\n';
    assert.deepStrictEqual([...hook.managedPids([301, 400], { platform: 'darwin', launchctl })], [301]);
    assert.strictEqual(hook.managedPids([301], { platform: 'darwin', launchctl: () => { throw new Error('failed'); } }), null);
    assert.strictEqual(hook.managedPids([301], { platform: 'darwin', launchctl: () => 'Could not list\n' }), null);
    assert.deepStrictEqual([...hook.managedPids([], { platform: 'darwin', launchctl: () => { throw new Error('not called'); } })], []);
  });

  const CLAUDE = 5000;
  const shell = (extra = {}) => ({ pid: 6001, ppid: CLAUDE, tty: 'ttys004', etime: '31:00', comm: '/bin/zsh', args: '/bin/zsh -c until grep -q done out.log; do sleep 3; done', ...extra });
  const child = (extra = {}) => ({ pid: 6002, ppid: 6001, pgid: 6001, tty: 'ttys004', etime: '00:02', comm: '/bin/sleep', args: 'sleep 3', ...extra });
  const stuck = (specs, extra = {}) => hook.stuckShells(hook.parsePsRows(specs.map(psLine).join('\n')), { claudePid: CLAUDE, listeners: new Map(), ...extra }).map((r) => r.pid);

  await test('stuck: a tool shell of the claude process at 31 minutes whose subtree used no CPU', () => {
    assert.deepStrictEqual(stuck([shell(), child()]), [6001]);
  });

  await test('not stuck: 29 minutes, a listener in its subtree, 5% CPU in its subtree, or not a tool shell', () => {
    assert.deepStrictEqual(stuck([shell({ etime: '29:00' }), child()]), []);
    assert.deepStrictEqual(stuck([shell(), child()], { listeners: new Map([['6002', ['*:5173']]]) }), []);
    assert.deepStrictEqual(stuck([shell(), child({ time: '1:33.00' })]), []);
    assert.deepStrictEqual(stuck([shell({ comm: '/usr/local/bin/node', args: 'node watch.js' })]), []);
    assert.deepStrictEqual(stuck([shell({ ppid: 4242 })]), []);
  });

  await test('formatReaped names five and counts the rest', () => {
    const list = Array.from({ length: 7 }, (_, i) => ({ name: 'zsh', pid: 100 + i, elapsed: 12 * 60_000 }));
    const line = hook.formatReaped(list);
    assert.strictEqual(line, `reaped 7: zsh (pid 100, 12m), zsh (pid 101, 12m), zsh (pid 102, 12m), zsh (pid 103, 12m), zsh (pid 104, 12m), +2 more${HINT}`);
    assert.strictEqual(hook.formatReaped([]), null);
  });

  await test('SessionStart prints the reaped line to the model', () => {
    const out = runHook('SessionStart', checkout().root, { env: { LEFTOVER_PS: fixture([psLine(runaway)]), LEFTOVER_REAP_MINUTES: undefined, LEFTOVER_RUNAWAY: undefined } });
    assert.deepStrictEqual(out, { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `reaped 1: zsh (pid 91003, 12m)${HINT}` } });
  });

  await test('Stop blocks once on a stuck tool shell; a second Stop with the same pid says nothing', () => {
    // the hook's parent is this process: with no claude process among its ancestors, it is the claude pid
    const long = `/bin/zsh -c until grep -q ready ${'x'.repeat(100)}; do sleep 3; done`;
    const ps = fixture([psLine(shell({ ppid: process.pid, args: long })), psLine(child())]);
    const state = tmp('leftover-t-');
    const dir = checkout().root;
    const first = runHook('Stop', dir, { tmpdir: state, env: { LEFTOVER_PS: ps } });
    assert.strictEqual(first.decision, 'block');
    assert.strictEqual(first.reason, `STUCK 1: ${long.slice(0, 79)}… (pid 6001, 31m, no CPU) — stop each with TaskStop (or kill its process group) unless it is still needed, then finish.`);
    assert.strictEqual(runHook('Stop', dir, { tmpdir: state, env: { LEFTOVER_PS: ps } }), null);
    assert.strictEqual(runHook('Stop', dir, { tmpdir: state, session: 'other', env: { LEFTOVER_PS: ps } }).decision, 'block', 'another session reports it again');
  });

  await test('Stop with stop_hook_active says nothing; a Stop with only a reap says nothing; a stuck report carries the reaped line', () => {
    const dir = checkout().root;
    const ps = fixture([psLine(shell({ ppid: process.pid })), psLine(child()), psLine(runaway)]);
    assert.strictEqual(runHook('Stop', dir, { env: { LEFTOVER_PS: ps, LEFTOVER_REAP_MINUTES: undefined, LEFTOVER_RUNAWAY: undefined }, input: { stop_hook_active: true } }), null);
    assert.strictEqual(runHook('Stop', dir, { env: { LEFTOVER_PS: fixture([psLine(runaway)]), LEFTOVER_REAP_MINUTES: undefined, LEFTOVER_RUNAWAY: undefined } }), null);
    const both = runHook('Stop', dir, { env: { LEFTOVER_PS: ps, LEFTOVER_REAP_MINUTES: undefined, LEFTOVER_RUNAWAY: undefined } });
    assert.strictEqual(both.reason.split('\n')[1], `reaped 1: zsh (pid 91003, 12m)${HINT}`);
    assert.match(both.reason, /^STUCK 1: .* then finish\.\n/);
  });

  await test('a reaped line no Stop block carried reaches the model at the next prompt, once; another session never sees it', () => {
    const dir = checkout().root;
    const state = tmp('leftover-t-');
    const reap = { LEFTOVER_PS: fixture([psLine(runaway)]), LEFTOVER_REAP_MINUTES: undefined, LEFTOVER_RUNAWAY: undefined };
    const idle = { LEFTOVER_PS: fixture([]) };
    const line = `reaped 1: zsh (pid 91003, 12m)${HINT}`;
    assert.strictEqual(runHook('Stop', dir, { tmpdir: state, env: reap }), null);
    assert.strictEqual(runHook('Stop', dir, { tmpdir: state, env: reap, input: { stop_hook_active: true } }), null);
    assert.strictEqual(runHook('UserPromptSubmit', dir, { tmpdir: state, session: 'other', env: idle }), null, 'another session');
    assert.strictEqual(runHook('UserPromptSubmit', dir, { tmpdir: state, env: idle })?.hookSpecificOutput?.additionalContext, `${line}\n${line}`);
    assert.strictEqual(runHook('UserPromptSubmit', dir, { tmpdir: state, env: idle }), null, 'only once');
    assert.deepStrictEqual(hook.parseState(JSON.stringify({ reported: [1], listed: 2, pending: [line, 7, 'rm -rf /', ...Array(6).fill(line)] })).pending, Array(5).fill(line), 'only reaped lines, five at most');
  });

  await test('under 5 GB free, one disk notice a day machine-wide: the creator of the day\'s lock notifies, never in model text', async () => {
    if (process.platform !== 'darwin' && process.platform !== 'linux') return;
    const log = path.join(tmp('leftover-n-'), 'notified.log');
    const bin = fakeBin({ [process.platform === 'darwin' ? 'osascript' : 'notify-send']: `printf '%s\\n' "$*" >> '${log}'` });
    const dir = checkout().root;
    const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
    const waitFor = async (n) => {
      for (let i = 0; i < 40 && lines().length < n; i++) await sleep(50);
    };
    const home = tmp('leftover-h-');
    const state = path.join(home, '.agents', 'harness');
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'disk-notice-2000-01-01.lock'), '');
    const env = { LEFTOVER_HOME: home, LEFTOVER_FREE_GB: '3', LEFTOVER_PS: fixture([]), LEFTOVER_NOTIFY: undefined, PATH: `${bin}:${process.env.PATH}` };
    assert.strictEqual(runHook('SessionStart', dir, { env }), null);
    await waitFor(1);
    assert.strictEqual(lines().length, 1, 'the first low-disk run notifies once');
    assert.match(lines()[0], /3\.0 GB free on this disk\. Free space: node ~\/\.agents\/harness\/machine-sweep\/machine-sweep\.mjs --report/);
    assert.ok(fs.existsSync(path.join(state, `disk-notice-${TODAY}.lock`)), 'the day is claimed');
    assert.ok(!fs.existsSync(path.join(state, 'disk-notice-2000-01-01.lock')), 'an older lock stays');
    assert.strictEqual(runHook('Stop', dir, { env }), null);
    await sleep(400);
    assert.strictEqual(lines().length, 1, 'a second run the same day notified again');
    const claimed = tmp('leftover-h-');
    fs.mkdirSync(path.join(claimed, '.agents', 'harness'), { recursive: true });
    fs.writeFileSync(path.join(claimed, '.agents', 'harness', `disk-notice-${TODAY}.lock`), '');
    runHook('SessionStart', dir, { env: { ...env, LEFTOVER_HOME: claimed } });
    await sleep(400);
    assert.strictEqual(lines().length, 1, 'notified although another session claimed the day');
    const roomy = tmp('leftover-h-');
    runHook('SessionStart', dir, { env: { ...env, LEFTOVER_HOME: roomy, LEFTOVER_FREE_GB: '50' } });
    await sleep(200);
    assert.strictEqual(lines().length, 1, 'notified with room to spare');
    assert.ok(!fs.existsSync(path.join(roomy, '.agents', 'harness', `disk-notice-${TODAY}.lock`)));
  });

  await test('managedPids: a .service anywhere in the path (its delegated subgroups too) is managed, a bare user manager is not; the deepest one is compared with the hook\'s own', () => {
    const cgroups = {
      1: '0::/system.slice/worker.service/jobs\n',
      2: '1:name=systemd:/system.slice/worker.service/jobs\n',
      3: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-term.scope\n',
      4: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/foo.service/x\n',
    };
    const readCgroup = (pid) => cgroups[pid];
    const own = (text) => () => text;
    assert.deepStrictEqual([...hook.managedPids([1, 2, 3, 4], { platform: 'linux', readCgroup, ownCgroup: own('0::/user.slice/user-1000.slice/session-9.scope\n') })], [1, 2, 4]);
    assert.deepStrictEqual([...hook.managedPids([1, 2, 4], { platform: 'linux', readCgroup, ownCgroup: own('0::/system.slice/worker.service\n') })], [4], 'the same service, a subgroup of it');
    assert.deepStrictEqual([...hook.managedPids([1, 4], { platform: 'linux', readCgroup, ownCgroup: own('0::/user.slice/user-1000.slice/user@1000.service/app.slice/foo.service/y\n') })], [1]);
    assert.deepStrictEqual([...hook.managedPids([3], { platform: 'linux', readCgroup, ownCgroup: own('0::/user.slice/user-1000.slice/user@1000.service/app.slice/other.scope\n') })], [], 'a terminal under the user manager');
  });

  await test('a failed or missing listener reading reaps nothing that run', () => {
    if (process.platform === 'win32') return;
    const dir = checkout().root;
    const ps = fixture([psLine(argvRoot).replace(PROJECT, dir)]);
    const env = { LEFTOVER_PS: ps, LEFTOVER_REAP_MINUTES: undefined };
    assert.match(runHook('SessionStart', dir, { env })?.hookSpecificOutput?.additionalContext ?? '', /^reaped 1: node \(pid 91002, 11m\) — /, 'control');
    assert.strictEqual(runHook('SessionStart', dir, { env: { ...env, PATH: `${fakeBin({ lsof: 'exit 2' })}:${process.env.PATH}` } }), null, 'lsof failed');
    assert.strictEqual(runHook('SessionStart', dir, { env: { ...env, PATH: fakeBin({}) } }), null, 'no lsof');
  });

  await test('a KEEP with a g or y flag matches in both of the hook\'s readings of the rows (candidates, then reapable)', () => {
    if (process.platform === 'win32') return;
    const dir = checkout().root;
    const env = { LEFTOVER_PS: fixture([psLine({ ...argvRoot, args: `${argvRoot.args} queue:work` }).replace(PROJECT, dir)]), LEFTOVER_REAP_MINUTES: undefined };
    assert.match(runHook('SessionStart', dir, { env })?.hookSpecificOutput?.additionalContext ?? '', /^reaped 1: node \(pid 91002, 11m\) — /, 'control: KEEP is empty');
    for (const re of ['/\\bqueue:work\\b/g', '/queue:work/y'])
      assert.strictEqual(runHook('SessionStart', dir, { script: quiet('const KEEP = null;', `const KEEP = ${re};`), env }), null, re);
  });

  await test('lsof exit 1 counts as no match only with nothing on stderr; both scans run with -w', () => {
    if (process.platform === 'win32') return;
    const dir = checkout().root;
    const ps = fixture([psLine(argvRoot).replace(PROJECT, dir)]);
    const log = path.join(tmp('leftover-n-'), 'lsof.log');
    const env = (body) => ({ LEFTOVER_PS: ps, LEFTOVER_REAP_MINUTES: undefined, PATH: `${fakeBin({ lsof: `printf '%s\\n' "$*" >> '${log}'\n${body}` })}:${process.env.PATH}` });
    assert.match(runHook('SessionStart', dir, { env: env('exit 1') })?.hookSpecificOutput?.additionalContext ?? '', /^reaped 1: node \(pid 91002, 11m\) — /, 'control: no match');
    const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    assert.ok(calls.length >= 2 && calls.every((c) => c.split(' ').includes('-w')), calls.join(' | '));
    assert.strictEqual(runHook('SessionStart', dir, { env: env("printf 'p92000\\nn*:1\\n'\necho 'lsof: status error on /some/path' >&2\nexit 1") }), null, 'a partial scan with an error');
  });

  await test('a failed or partial re-read before the signals sends none', () => {
    if (process.platform === 'win32') return;
    const dir = checkout().root;
    const pid = freePid();
    const ps = fixture([psLine({ ...argvRoot, pid }).replace(PROJECT, dir)]);
    const again = `${pid}     1 91900 ??          11:01`;
    const env = (status) => ({ LEFTOVER_PS: undefined, LEFTOVER_MANAGED: managedFile([]), LEFTOVER_REAP_MINUTES: undefined, LEFTOVER_KILL: undefined, PATH: `${fakeBin({ ps: `if [ "$1" = "-axo" ]; then cat '${ps}'; exit 0; fi\necho '${again}'\nexit ${status}` })}:${process.env.PATH}` });
    assert.match(runHook('SessionStart', dir, { env: env(0) })?.hookSpecificOutput?.additionalContext ?? '', new RegExp(`^reaped 1: node \\(pid ${pid}, 11m\\) — `), 'control: a whole re-read');
    assert.strictEqual(runHook('SessionStart', dir, { env: env(2) }), null, 'a failed re-read with output');
  });

  await test('managedPids reads every cgroup line: a service on the systemd line beside a unified scope is managed', () => {
    const text = '0::/user.slice/session-3.scope\n1:name=systemd:/system.slice/worker.service/jobs\n';
    const readCgroup = () => text;
    assert.deepStrictEqual([...hook.managedPids([91001], { platform: 'linux', readCgroup, ownCgroup: () => '0::/user.slice/session-9.scope\n' })], [91001]);
    assert.deepStrictEqual([...hook.managedPids([91001], { platform: 'linux', readCgroup, ownCgroup: () => '0::/user.slice/session-9.scope\n1:name=systemd:/system.slice/worker.service\n' })], [], 'the hook\'s own service');
    assert.deepStrictEqual(hook.cgroupUnits(text), ['/system.slice/worker.service']);
  });

  await test('a failed ps reading, partial output included, reaps nothing that run', () => {
    if (process.platform === 'win32') return;
    const dir = checkout().root;
    const ps = fixture([psLine(argvRoot).replace(PROJECT, dir)]);
    const env = (status) => ({ LEFTOVER_PS: undefined, LEFTOVER_MANAGED: managedFile([]), LEFTOVER_REAP_MINUTES: undefined, PATH: `${fakeBin({ ps: `cat '${ps}'\nexit ${status}` })}:${process.env.PATH}` });
    assert.match(runHook('SessionStart', dir, { env: env(0) })?.hookSpecificOutput?.additionalContext ?? '', /^reaped 1: node \(pid 91002, 11m\) — /, 'control');
    assert.strictEqual(runHook('SessionStart', dir, { env: env(1) }), null);
  });

  await test('the kill re-reads each pid first and spares one that is no longer the orphan it was (a reused pid)', () => {
    const was = { ...argvRoot, pid: 91002, etime: '11:00' };
    const rows = hook.parsePsRows(psLine(was));
    const again = (spec) => hook.parsePsRows(spec ? psLine({ ...was, ...spec }) : '');
    assert.deepStrictEqual(hook.stillOrphans(rows, again({ etime: '11:01' })).map((r) => r.pid), [91002]);
    for (const [why, spec] of [['a live parent', { ppid: 4242 }], ['a TTY', { tty: 'ttys003' }], ['another group', { pgid: 4100 }], ['seconds old', { etime: '00:03' }], ['gone', null]]) {
      assert.deepStrictEqual(hook.stillOrphans(rows, again(spec)), [], why);
    }
    const pid = freePid();
    const dir = checkout().root;
    const first = fixture([psLine({ ...was, pid }).replace(PROJECT, dir)]);
    const reused = fixture([psLine({ ...was, pid, ppid: 4242, tty: 'ttys003', etime: '00:03' }).replace(PROJECT, dir)]);
    const env = { LEFTOVER_PS: first, LEFTOVER_REAP_MINUTES: undefined, LEFTOVER_KILL: undefined };
    assert.strictEqual(runHook('SessionStart', dir, { env: { ...env, LEFTOVER_PS_RECHECK: reused } }), null, 'a reused pid was signalled');
    assert.strictEqual(runHook('SessionStart', dir, { env: { ...env, LEFTOVER_PS_RECHECK: fixture([]) } }), null, 'a gone pid was signalled');
  });

  await test('a wrong-shaped session state starts fresh: one report per pid, and a report still goes out', () => {
    const ps = fixture([psLine(shell({ ppid: process.pid })), psLine(child())]);
    const dir = checkout().root;
    for (const bad of ['[]', '17', '{"reported":"6001","listed":"later"}']) {
      const state = tmp('leftover-t-');
      fs.writeFileSync(path.join(state, 'harness-stuck-s.json'), bad);
      assert.strictEqual(runHook('Stop', dir, { tmpdir: state, env: { LEFTOVER_PS: ps } })?.decision, 'block', `state ${bad}: no report`);
      assert.strictEqual(runHook('Stop', dir, { tmpdir: state, env: { LEFTOVER_PS: ps } }), null, `state ${bad}: the report repeats`);
    }
  });

  await test('an unwritable session state emits neither the stuck report nor the listing (each would repeat every turn)', () => {
    const dir = checkout().root;
    const state = tmp('leftover-t-');
    fs.mkdirSync(path.join(state, 'harness-stuck-s.json'));
    const stuckPs = fixture([psLine(shell({ ppid: process.pid })), psLine(child())]);
    assert.strictEqual(runHook('Stop', dir, { tmpdir: state, env: { LEFTOVER_PS: stuckPs } }), null);
    const emulator = fixture([psLine({ pid: 91500, ppid: 4242, pgid: 91500, tty: '??', etime: '05:00', comm: '/opt/emu/emulator64-arm64', args: '/opt/emu/emulator64-arm64 -avd test' })]);
    assert.ok(runHook('UserPromptSubmit', dir, { script: HOOK, env: { LEFTOVER_PS: emulator } }), 'control: the listing goes out with a writable state');
    assert.strictEqual(runHook('UserPromptSubmit', dir, { script: HOOK, tmpdir: state, env: { LEFTOVER_PS: emulator } }), null);
  });

  await test('a real orphan in the checkout whose leader is gone is reaped and named; one leading its own group is not', async () => {
    if (process.platform === 'win32') return;
    const dir = tmp('leftover-live-');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const groups = [];
    try {
      // a tool shell's background job: the shell leads the group and exits, its sleep goes to process 1
      const sh = spawn('/bin/sh', ['-c', 'sleep 300 &'], { cwd: dir, detached: true, stdio: 'ignore' });
      const pgid = sh.pid;
      groups.push(pgid);
      await new Promise((resolve) => sh.once('exit', resolve));
      // what the owner starts there: a process that leads its own group, its parent gone
      const starter = spawn(process.execPath, ['-e', "const c = require('child_process').spawn('/bin/sleep', ['300'], { detached: true, stdio: 'ignore' }); c.unref(); console.log(c.pid);"], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
      groups.push(starter.pid);
      let text = '';
      starter.stdout.on('data', (d) => (text += d));
      await new Promise((resolve) => starter.once('exit', resolve));
      const leaderPid = Number(text.trim());
      assert.ok(leaderPid > 1, 'the starter printed no pid');
      groups.push(leaderPid);
      let sleeper = null;
      let led = null;
      for (let i = 0; i < 40 && !(sleeper && led); i++) {
        const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,args='], { encoding: 'utf8' }).stdout.split('\n').map((l) => l.trim().split(/\s+/));
        sleeper = ps.find((f) => Number(f[1]) === 1 && Number(f[2]) === pgid && f[3] === 'sleep');
        led = ps.find((f) => Number(f[0]) === leaderPid && Number(f[1]) === 1 && Number(f[2]) === leaderPid);
        if (!(sleeper && led)) await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(sleeper, 'the sleep was not re-parented to process 1');
      assert.ok(led, 'the group-leading sleep was not re-parented to process 1');
      const out = runHook('SessionStart', dir, { env: { CLAUDE_PROJECT_DIR: dir, LEFTOVER_REAP_MINUTES: '0', LEFTOVER_KILL: undefined } });
      const context = out?.hookSpecificOutput?.additionalContext ?? '';
      assert.match(context, new RegExp(`(: |, )sleep \\(pid ${sleeper[0]}, 0m\\)`));
      assert.ok(!context.includes(`pid ${leaderPid},`), 'the group leader was reaped');
      let gone = false;
      for (let i = 0; i < 40 && !gone; i++) {
        try {
          process.kill(-pgid, 0);
          await new Promise((r) => setTimeout(r, 50));
        } catch {
          gone = true;
        }
      }
      assert.ok(gone, 'the process group still runs');
      process.kill(leaderPid, 0); // throws when the group leader was killed
    } finally {
      for (const g of groups) killGroup(g);
    }
  });

  await test('a real server left with `&` in a worktree is kept while it listens, and reaped once the worktree directory is gone; a name lsof escapes, or a directory stat cannot reach, is no proof', async () => {
    if (process.platform === 'win32') return;
    const { root: dir, worktree } = checkout();
    const escaped = path.join(dir, '.worktrees', 'p1\\02'); // lsof prints its backslash doubled
    const locked = path.join(dir, '.worktrees', 'locked'); // its search permission goes after the start
    fs.mkdirSync(escaped);
    fs.mkdirSync(path.join(locked, 'p1-03'), { recursive: true });
    const groups = [];
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    // a tool shell's `npm run dev &`, in short: the shell leads the group and exits, its server goes to process 1
    const orphanServer = async (cwd) => {
      const portFile = path.join(tmp('leftover-port-'), 'port');
      const server = `require('net').createServer().listen(0, '127.0.0.1', function () { require('fs').writeFileSync(${JSON.stringify(portFile)}, String(this.address().port)); }); setTimeout(() => {}, 120000);`;
      const sh = spawn('/bin/sh', ['-c', `"${process.execPath}" -e "$0" &`, server], { cwd, detached: true, stdio: 'ignore' });
      groups.push(sh.pid);
      await new Promise((resolve) => sh.once('exit', resolve));
      for (let i = 0; i < 100; i++) {
        const row = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).stdout.split('\n').map((l) => l.trim().split(/\s+/).map(Number)).find((f) => f[1] === 1 && f[2] === sh.pid);
        if (row && fs.existsSync(portFile)) return row[0];
        await new Promise((r) => setTimeout(r, 50));
      }
      return assert.fail(`the server in ${cwd} did not start listening under process 1`);
    };
    try {
      const plain = await orphanServer(worktree);
      const odd = await orphanServer(escaped);
      const shut = await orphanServer(path.join(locked, 'p1-03'));
      const env = { CLAUDE_PROJECT_DIR: dir, LEFTOVER_REAP_MINUTES: '0', LEFTOVER_KILL: undefined };
      const reaped = () => runHook('SessionStart', dir, { env })?.hookSpecificOutput?.additionalContext ?? '';
      const first = reaped();
      for (const pid of [plain, odd, shut]) assert.ok(!first.includes(`pid ${pid},`), `pid ${pid} was reaped while its directory exists`);
      fs.rmSync(worktree, { recursive: true, force: true });
      fs.chmodSync(locked, 0o600);
      const second = reaped();
      assert.match(second, new RegExp(`(: |, )node \\(pid ${plain}, 0m, listening, its directory gone\\)`));
      assert.ok(!second.includes(`pid ${odd},`), 'a backslash in its name, doubled by lsof, read as gone');
      assert.ok(!second.includes(`pid ${shut},`), 'a directory stat cannot reach read as gone');
      for (let i = 0; i < 40 && alive(plain); i++) await new Promise((r) => setTimeout(r, 50));
      assert.ok(!alive(plain), 'the server still runs');
      assert.ok(alive(odd) && alive(shut), 'a kept server was killed');
    } finally {
      try {
        fs.chmodSync(locked, 0o700);
      } catch {
        // already removed
      }
      for (const g of groups) killGroup(g);
    }
  }, { skip: noLsof });

  await test('dirGone: proof only — a removed directory is gone; one there, one lsof printed escaped, or one stat cannot reach is not', () => {
    const base = tmp('leftover-gone-');
    const removed = path.join(base, 'p1-01');
    fs.mkdirSync(removed);
    fs.rmdirSync(removed);
    fs.writeFileSync(path.join(base, 'file'), '');
    fs.mkdirSync(path.join(base, 'a\\b'));
    assert.strictEqual(hook.dirGone(removed), true, 'removed');
    assert.strictEqual(hook.dirGone(path.join(base, 'file', 'x')), true, 'ENOTDIR');
    assert.strictEqual(hook.dirGone(base), false, 'there');
    assert.strictEqual(hook.dirGone(path.join(base, 'a\\\\b')), false, 'a backslash, doubled as lsof prints it');
    assert.strictEqual(hook.dirGone(path.join(base, 'a\\tb')), false, 'a tab, as lsof prints it');
    assert.strictEqual(hook.dirGone(path.join(base, 'a^Ab')), false, 'a control character, as lsof prints it');
    const failing = (code) => () => {
      throw Object.assign(new Error(code), { code });
    };
    assert.strictEqual(hook.dirGone('/x', failing('EACCES')), false, 'a parent without search permission');
    assert.strictEqual(hook.dirGone('/x', failing('ELOOP')), false);
    assert.strictEqual(hook.dirGone(undefined), false, 'not read');
  });

  await test('silent when nothing runs from the checkout', () => {
    const dir = checkout().root;
    assert.strictEqual(runHook('SessionStart', dir), null);
    assert.strictEqual(runHook('UserPromptSubmit', dir), null);
    assert.strictEqual(runHook('Stop', dir, { env: { LEFTOVER_PS: fixture([]) } }), null);
  });

  await test('a listener started in the checkout is named to the model, by its executable only, once per window', async () => {
    const co = checkout();
    // a command line can carry a secret: the hook names the executable, never its arguments
    const secret = `--token=${randomBytes(12).toString('hex')}`;
    const { pid, port } = await listen(co.root, [secret]);
    const named = `:${port} ${path.basename(process.execPath)} (pid ${pid})`;
    const state = tmp('leftover-t-');
    const prompt = runHook('UserPromptSubmit', co.root, { tmpdir: state });
    assert.strictEqual(prompt.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.ok(prompt.hookSpecificOutput.additionalContext.startsWith(`[leftover-processes] Still running from this checkout: ${named}. `), prompt.hookSpecificOutput.additionalContext);
    assert.match(prompt.hookSpecificOutput.additionalContext, /by recorded PID, never pkill/);
    assert.ok(!prompt.hookSpecificOutput.additionalContext.includes(secret.slice(8)), 'the listener\'s arguments are told to the model');
    assert.strictEqual(runHook('UserPromptSubmit', co.root, { tmpdir: state }), null, 'listed again within the window');
    assert.ok(runHook('UserPromptSubmit', co.root, { tmpdir: state, session: 'other' }), 'another session is not told');
    assert.strictEqual(runHook('Stop', co.root, { env: { LEFTOVER_PS: fixture([]) } }), null, 'Stop says nothing to the owner');
  }, { skip: noLsof });

  await test("a main checkout leaves out its worktrees' listeners; the worktree's own session names them", async () => {
    const co = checkout();
    const { port } = await listen(co.worktree);
    assert.strictEqual(runHook('UserPromptSubmit', co.root), null);
    assert.match(runHook('UserPromptSubmit', co.worktree).hookSpecificOutput.additionalContext, new RegExp(`:${port} `));
  }, { skip: noLsof });

  await test('a directory that only shares the checkout\'s prefix is not inside it', async () => {
    const co = checkout();
    const sibling = `${co.root}-other`;
    fs.mkdirSync(sibling);
    cleanup.push(sibling);
    await listen(sibling);
    assert.strictEqual(runHook('UserPromptSubmit', co.root), null);
  }, { skip: noLsof });

  await test('a machine-wide process (an emulator) is named, whoever started it', async () => {
    if (process.platform === 'win32') return;
    const exe = path.join(tmp('leftover-e-'), 'emulator64-arm64-test');
    fs.symlinkSync(process.execPath, exe);
    const emu = spawn(exe, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore' });
    cleanup.push(() => killGroup(emu.pid));
    const decoy = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', 'qemu-system-decoy'], { detached: true, stdio: 'ignore' });
    cleanup.push(() => killGroup(decoy.pid));
    await new Promise((r) => setTimeout(r, 300));
    const text = runHook('UserPromptSubmit', checkout().root, { script: HOOK })?.hookSpecificOutput?.additionalContext ?? '';
    assert.match(text, new RegExp(`emulator64-arm64-test \\(pid ${emu.pid}, machine-wide\\)`));
    assert.ok(!text.includes(`pid ${decoy.pid}`), 'a process whose arguments name an emulator is not one');
  });

  await test('mutation: dropping the worktree exclusion names another session\'s listener', async () => {
    const script = quiet('if (main && cwd.startsWith(worktrees)) continue;', '');
    const co = checkout();
    await listen(co.worktree);
    assert.ok(runHook('UserPromptSubmit', co.root, { script }), 'the mutant names the worktree listener');
  }, { skip: noLsof });

  await test('mutation: a bare prefix match takes a sibling directory for the checkout', async () => {
    const script = quiet('cwd !== root && !cwd.startsWith(root + sep)', 'cwd !== root && !cwd.startsWith(root)');
    const co = checkout();
    const sibling = `${co.root}-other`;
    fs.mkdirSync(sibling);
    cleanup.push(sibling);
    await listen(sibling);
    assert.ok(runHook('UserPromptSubmit', co.root, { script }), 'the mutant names the sibling listener');
  }, { skip: noLsof });

  await test('mutation: no listing window repeats the listing at every prompt', async () => {
    const script = quiet('!(now - state.listed < LIST_MINUTES * 60_000)', 'true');
    const co = checkout();
    await listen(co.root);
    const state = tmp('leftover-t-');
    runHook('UserPromptSubmit', co.root, { script, tmpdir: state });
    assert.ok(runHook('UserPromptSubmit', co.root, { script, tmpdir: state }), 'the mutant repeats the listing');
  }, { skip: noLsof });

  await test('mutation: the reaper without its TTY or parent check takes a terminal\'s or a live parent\'s process', async () => {
    for (const [from, to, spec] of [
      ['NO_TTY.has(r.tty) && ', '', { ...inRoot, tty: 'ttys003' }],
      ['r.ppid === 1 && ', '', { ...inRoot, ppid: 4242 }],
    ]) {
      const m = await import(pathToFileURL(mutant(from, to)).href);
      assert.deepStrictEqual(m.reapable(m.parsePsRows(psLine(spec)), opts()).map((r) => r.pid), [91001], `the mutant without ${from.trim()} keeps it`);
    }
  });

  await test('mutation: a stuck report without its once-per-session record repeats at every Stop', () => {
    const script = quiet('.filter((r) => !reported.has(r.pid))', '');
    const ps = fixture([psLine(shell({ ppid: process.pid })), psLine(child())]);
    const state = tmp('leftover-t-');
    const dir = checkout().root;
    runHook('Stop', dir, { script, tmpdir: state, env: { LEFTOVER_PS: ps } });
    assert.ok(runHook('Stop', dir, { script, tmpdir: state, env: { LEFTOVER_PS: ps } }), 'the mutant repeats the report');
  });

  await test('no output names memory or a tight machine', () => {
    assert.ok(outputs.length > 10, `only ${outputs.length} runs recorded`);
    for (const out of outputs) assert.ok(!/memory|tight/i.test(out), out);
  });

  for (const c of cleanup.reverse()) {
    if (typeof c === 'function') c();
    else fs.rmSync(c, { recursive: true, force: true });
  }
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (skipped) console.log(`Skipped: ${skipped}`);
  process.exit(failed > 0 ? 1 : 0);
})();
