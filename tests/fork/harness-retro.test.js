/**
 * Tests for the harness-bootstrap retro template (skills/harness-bootstrap/templates/scripts):
 * runs the shipped node:test suite hermetically, then proves it can fail by mutating the core.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'harness-bootstrap', 'templates', 'scripts');
const TEST_REL = path.join('lib', 'retro-core.test.mjs');
const CORE_REL = path.join('lib', 'retro-core.mjs');
const SOURCES_REL = path.join('lib', 'run-sources.mjs');
const GATHER_REL = path.join('lib', 'retro-gather.mjs');
const CLI_REL = 'retro.mjs';

// The number of tests in the shipped suite. Adding or removing a test changes this on purpose.
const EXPECTED_TESTS = 75;

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

/** Env with a fresh HOME and no GIT_* or CODEX_HOME variable. */
function hermeticEnv(cleanup) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key === 'CODEX_HOME') delete env[key];
  env.HOME = tmp('retro-suite-home-');
  cleanup.push(env.HOME);
  return env;
}

function tapCount(output, key) {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `no "# ${key} <n>" line in the TAP output:\n${output.slice(-600)}`);
  return Number(match[1]);
}

function runSuite(scriptsDir, cleanup) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(scriptsDir, TEST_REL)],
    { encoding: 'utf8', env: hermeticEnv(cleanup), timeout: 120_000 },
  );
}

const cleanup = [];

/** Copy the shipped scripts, apply a one-line mutation to the core (or `fileRel`), and assert the suite fails. */
function mutantFails(name, needle, replacement, fileRel = CORE_REL) {
  test(`mutant: ${name} makes the suite fail`, () => {
    const copy = tmp('retro-mutant-');
    cleanup.push(copy);
    fs.cpSync(SCRIPTS, copy, { recursive: true });
    const filePath = path.join(copy, fileRel);
    const before = fs.readFileSync(filePath, 'utf8');
    const mutated = before.replace(needle, replacement);
    assert.notStrictEqual(mutated, before, 'the mutation did not apply');
    fs.writeFileSync(filePath, mutated);
    const res = runSuite(copy, cleanup);
    const out = res.stdout + res.stderr;
    assert.notStrictEqual(res.status, 0, 'the mutant suite still passed');
    assert.ok(tapCount(out, 'fail') > 0, out.slice(-800));
  });
}

console.log('\nharness-bootstrap retro template');

test('the shipped retro suite passes with the pinned test count', () => {
  const res = runSuite(SCRIPTS, cleanup);
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1500));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

// The four report cores' [B] bindings as one install rewrites them, [file, needle, replacement], each needle once
// in its file. The values need not agree across cores: each suite builds its own fixtures from the core it tests.
const MID = String.fromCodePoint(0xb7);
const STAR = String.fromCodePoint(0x2605);
const UNIT_RECORD_CORE = path.join('lib', 'unit-record-core.mjs');
const ESTIMATE_CORE = path.join('lib', 'estimate-core.mjs');
const RETRO_CORE = path.join('lib', 'retro-core.mjs');
const DUE_CORE = path.join('lib', 'harness-due-core.mjs');
const logColumns = (names) => `export const LOG_COLUMNS = [\n${names.map((n) => `  '${n}',`).join('\n')}\n];`;
const FOLLOW_UPS_LIST = "export const FOLLOW_UPS = ['docs/fu/*.md', 'docs/other.md'];";
const INSTALL = [
  // unit-record-core
  [UNIT_RECORD_CORE, 'export const AUDITOR_SOURCE = /conform|claim|lane-a|lane-c/i;', 'export const AUDITOR_SOURCE = /auditor|spec-check/i;'],
  [UNIT_RECORD_CORE, 'export const SUMMARY_LINE = /^SUMMARY \\d+ passed, \\d+ failed, \\d+ skipped.*$/gm;', 'export const SUMMARY_LINE = /^All \\d+ stages passed in \\d+s\\.$/gm;'],
  [UNIT_RECORD_CORE, "export const LEDGER_HEADING = 'ledger';", "export const LEDGER_HEADING = 'steps';"],
  [UNIT_RECORD_CORE, "export const FINDINGS_HEADING = 'findings';", "export const FINDINGS_HEADING = 'review findings';"],
  [UNIT_RECORD_CORE, 'export const MAX_COMMITS = 40;', 'export const MAX_COMMITS = 12;'],
  [
    UNIT_RECORD_CORE,
    logColumns([`Unit ${MID} Mode ${MID} Type ${MID} Tier`, 'Deliverable', 'Elapsed (work)', 'Owner wait', 'Defects', 'Scope', `Gate 1 ${MID} Gate 2`, 'Verdicts', 'Retries', 'Model', 'Cost', `${STAR} Missed by harness`, 'Yield by source', 'Friction']),
    logColumns([`Unit ${MID} Type ${MID} Tier`, 'Deliverable', 'Elapsed (work)', 'Owner wait', 'Cost', 'Defects', `${STAR} Missed by harness`, 'Notes']),
  ],
  // estimate-core
  [ESTIMATE_CORE, 'export const MIN_ROWS = 3;', 'export const MIN_ROWS = 5;'],
  [ESTIMATE_CORE, "export const TIERS = ['small', 'full'];", "export const TIERS = ['s', 'm', 'l'];"],
  [ESTIMATE_CORE, "export const TIER_WORDS = ['trivial', 'hot-small', 'small', 'full', 'docs'];", "export const TIER_WORDS = ['s', 'm', 'l'];"],
  [ESTIMATE_CORE, "  unit: 'unit',\n  type: 'type',\n  tier: 'tier',", "  unit: 'task',\n  type: 'type',\n  tier: 'size',"],
  // retro-core
  [RETRO_CORE, "export const REPORTS_DIR = 'docs/harness/reports';", "export const REPORTS_DIR = 'docs/reports/harness';"],
  [RETRO_CORE, "export const LOG = 'docs/harness/log.md';", "export const LOG = 'docs/harness-log.md';"],
  [RETRO_CORE, "export const FOLLOW_UPS = 'docs/harness/follow-ups.md';", FOLLOW_UPS_LIST],
  [RETRO_CORE, "export const PLANS_DIR = 'docs/plans';", "export const PLANS_DIR = '.claude/plans';"],
  [RETRO_CORE, "export const STATUS_COLUMNS = ['status'];", "export const STATUS_COLUMNS = ['decision'];"],
  [
    RETRO_CORE,
    "export const STATUS_WORDS = { open: ['open'], scheduled: ['scheduled'], fixed: ['fixed'], dropped: ['dropped'] };",
    "export const STATUS_WORDS = { open: ['todo'], scheduled: ['planned'], fixed: ['done'], dropped: ['wontfix'] };",
  ],
  [RETRO_CORE, "export const SEVERITY_COLUMNS = ['sev', 'priority'];", "export const SEVERITY_COLUMNS = ['impact'];"],
  [RETRO_CORE, 'export const FILED_AT = null;', 'export const FILED_AT = /(?:^|[^\\d])(\\d{4}-\\d{2}-\\d{2})-[a-z]/i;'],
  [RETRO_CORE, "export const EXTRA_COLUMNS = { defects: 'defects', missed: 'missed by harness', friction: 'friction', deliverable: 'deliverable' };", "export const EXTRA_COLUMNS = { defects: 'bugs', missed: 'missed', friction: 'notes', deliverable: 'item' };"],
  [RETRO_CORE, 'export const OUTLIER_X = 2;', 'export const OUTLIER_X = 3;'],
  [RETRO_CORE, 'export const MIN_COHORT = 3;', 'export const MIN_COHORT = 4;'],
  [RETRO_CORE, 'export const MIN_SHARE = 5;', 'export const MIN_SHARE = 8;'],
  [RETRO_CORE, 'export const REWRITE_ALERT_PERCENT = 5;', 'export const REWRITE_ALERT_PERCENT = 10;'],
  [RETRO_CORE, 'export const QUEUE_ALERT_DAYS = 14;', 'export const QUEUE_ALERT_DAYS = 21;'],
  [RETRO_CORE, "  [/\\blive\\b|\\bwalk\\b/i, '5'],", "  [/\\bsmoke\\b/i, '5'],\n  [/\\blive\\b|\\bwalk\\b/i, '5'],"],
  // harness-due-core
  [DUE_CORE, "export const MAIN = 'main';", "export const MAIN = 'trunk';"],
  [DUE_CORE, "export const LOG = 'docs/harness/log.md';", "export const LOG = 'docs/harness-log.md';"],
  [DUE_CORE, "export const FOLLOW_UPS = 'docs/harness/follow-ups.md';", FOLLOW_UPS_LIST],
  [DUE_CORE, "export const REGISTRY = '.claude/registry.md';", "export const REGISTRY = 'harness/registry.md';"],
  [DUE_CORE, "  preflight: 'docs/harness/reports/preflight-<phase>.md',", "  preflight: 'docs/preflight/<phase>.md',"],
  [DUE_CORE, "  sweep: 'docs/harness/reports/sweep-<date>.md',", "  sweep: 'docs/sweeps/<date>.md',"],
  [DUE_CORE, 'export const PHASE_OF = /^([A-Za-z]+-?\\d+)[-.]\\w/;', 'export const PHASE_OF = (id) => /^(M\\d+)\\.\\d/.exec(id)?.[1] ?? null;'],
  [DUE_CORE, '  sweep: { days: 7, landings: 5 },', '  sweep: { days: 10, landings: 8 },'],
  [DUE_CORE, '  hygiene: { days: 14, landings: 5 },', '  hygiene: { days: 21, landings: null },'],
  [DUE_CORE, "export const STATE_DIR = 'docs/plans';", "export const STATE_DIR = '.claude/plans';"],
  [DUE_CORE, 'export const OWED_DAYS = 3;', 'export const OWED_DAYS = 5;'],
  [DUE_CORE, 'export const DIGEST_LINES = 5;', 'export const DIGEST_LINES = 12;'],
  [DUE_CORE, 'export const SPLIT_LINES = 10000;', 'export const SPLIT_LINES = 4000;'],
  [DUE_CORE, 'export const DISK_MIN_GB = 10;', 'export const DISK_MIN_GB = 40;'],
  [DUE_CORE, 'export const WORKTREE_IDLE_HOURS = 6;', 'export const WORKTREE_IDLE_HOURS = 72;'],
  [
    DUE_CORE,
    'export const REBUILDABLE = /(^|\\/)(node_modules|dist|build|out|coverage|test-results|playwright-report|\\.next|\\.turbo|\\.expo|\\.vite|\\.cache|\\.husky\\/_)\\/?$|\\.DS_Store$|\\.tsbuildinfo$/;',
    'export const REBUILDABLE = /(^|\\/)(node_modules|dist|\\.turbo|\\.output)\\/?$|\\.DS_Store$/;',
  ],
  [DUE_CORE, String.raw`  preflight: 'run the phase preflight for <phase> (harness-bootstrap\'s reference/preflight.md); its escalations are Gate 1 cards',`, "  preflight: 'run /phase-check <phase>; its escalations are Gate 1 cards',"],
  [DUE_CORE, String.raw`  sweep: 'once the product queue is empty: write the sweep report in the background (a Sonnet runner, harness-bootstrap\'s reference/sweep.md); it rides in the next unit\'s land commit',`, "  sweep: 'run /sweep-check in the background; the report rides in the next land commit',"],
  [DUE_CORE, String.raw`  retro: 'once the product queue is empty: node scripts/retro.mjs in the background; the report rides in the next unit\'s land commit',`, "  retro: 'run /weekly-retro in the background; the report rides in the next land commit',"],
  [DUE_CORE, String.raw`  hygiene: 'once the product queue is empty: write the hygiene report in the background (harness-bootstrap\'s reference/hygiene.md); it rides in the next unit\'s land commit',`, "  hygiene: 'run /hygiene-pass in the background; the report rides in the next land commit',"],
  [DUE_CORE, "  disk: 'node ~/.agents/harness/machine-sweep/machine-sweep.mjs --apply-approved, in the background',", "  disk: 'run /free-disk, in the background',"],
  [DUE_CORE, "  worktrees: 'git worktree remove <paths>, each once no registry row names it',", "  worktrees: 'run /prune-worktrees <paths>, each once no registry row names it',"],
  [DUE_CORE, String.raw`  inbox: 'nothing to run, the run moves on to the next ready unit; the owner\'s answers resume <unit> through the runner (harness-bootstrap\'s reference/runner.md)',`, "  inbox: 'carry on; /resume-parked <unit> once the owner has answered',"],
];

/** Copy the shipped scripts, apply each rebinding (each needle exactly once), run the suite. */
function reboundRun(rebindings) {
  const copy = tmp('retro-rebound-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  for (const [rel, needle, replacement] of rebindings) {
    const file = path.join(copy, rel);
    const before = fs.readFileSync(file, 'utf8');
    assert.strictEqual(before.split(needle).length - 1, 1, `${needle} is not in ${rel} exactly once`);
    fs.writeFileSync(file, before.replace(needle, () => replacement));
  }
  const res = runSuite(copy, cleanup);
  return { res, out: res.stdout + res.stderr };
}

test('the shipped suite passes with every binding rebound as an install binds them', () => {
  const { res, out } = reboundRun(INSTALL);
  const failing = out.match(/^not ok .*$/gm) ?? [];
  assert.strictEqual(res.status, 0, `rebound: ${failing.length} failing, first: ${failing.slice(0, 3).join(' | ')}\n${out.slice(-1200)}`);
  assert.strictEqual(tapCount(out, 'fail'), 0, out.slice(-1200));
  assert.strictEqual(tapCount(out, 'pass'), EXPECTED_TESTS);
  assert.strictEqual(tapCount(out, 'tests'), EXPECTED_TESTS);
});

test('time budget: 30,000 open follow-up rows in one file are read and summarised in under 3 s', () => {
  const repo = tmp('retro-budget-');
  cleanup.push(repo);
  const rows = Array.from({ length: 30_000 }, (_, i) => `| FU-${i} | P3 | open |`);
  fs.writeFileSync(path.join(repo, 'fu.md'), `| # | Sev | Status |\n|---|---|---|\n${rows.join('\n')}\n`);
  // A child process imports the template modules, so this wrapper needs no async test.
  const script = `
    import { readFollowUps } from ${JSON.stringify(pathToFileURL(path.join(SCRIPTS, GATHER_REL)).href)};
    import { followUpsSummary } from ${JSON.stringify(pathToFileURL(path.join(SCRIPTS, CORE_REL)).href)};
    const stub = () => ({ get: (line) => 1_000_000 + line });
    const t0 = performance.now();
    const got = readFollowUps(process.argv[1], 'fu.md', stub);
    const s = followUpsSummary(got.text, got.dates, 2_000_000_000, { statusColumns: ['status'], statusWords: { open: ['open'] }, severityColumns: ['sev'] });
    process.stdout.write(JSON.stringify({ ms: Math.round(performance.now() - t0), open: s.open, openP3: s.openP3 }));
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script, repo], { encoding: 'utf8', env: hermeticEnv(cleanup), timeout: 120_000 });
  assert.strictEqual(res.status, 0, res.stderr.slice(-800));
  const got = JSON.parse(res.stdout);
  console.log(`    measured ${got.ms} ms`);
  assert.deepStrictEqual([got.open, got.openP3], [30_000, 30_000]);
  assert.ok(got.ms < 3000, `30,000 rows took ${got.ms} ms`);
});

mutantFails('reading "none (owner, Gate 2)" as a missed finding', 'const EMPTY = /^(?:|none|nothing|n\\/a|-|—|–)(?:[\\s.,;:]*\\(.*\\))?[\\s.]*$/i;', 'const EMPTY = /^(?:|—)$/;');
mutantFails('filling the candidates from the first source', 'for (let i = 0; out.length < MAX_CANDIDATES && sources.some((s) => s.length > i); i++) {\n    for (const s of sources) if (s[i] && out.length < MAX_CANDIDATES) out.push(s[i]);\n  }', 'for (const x of sources.flat()) if (out.length < MAX_CANDIDATES) out.push(x);');
mutantFails('flagging a step under MIN_SHARE', 'x.share >= MIN_SHARE && ', '');
mutantFails('starting the week on Sunday', 'd.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3', 'd.getUTCDate() - d.getUTCDay() + 3');
mutantFails("starting the window at this week's own digest", '.filter((p) => p.week !== week && Date.parse(p.until) < end)', '.filter((p) => Date.parse(p.until) < end)');
mutantFails("taking a sibling repository's sessions", 'if (cwd === null || !inside(cwd)) continue;', 'if (cwd === null) continue;', SOURCES_REL);
mutantFails('giving an overlapping turn to the unit that started first', 'if (iv && !(best.get(id(r))?.start >= iv.start))', 'if (iv && !best.has(id(r)))');
mutantFails("charging a unit for another unit's dispatch", 'const claimed = claimRows(spans, owners);', 'const claimed = claimRows(spans);');
mutantFails("dropping a tagged dispatch's turns after its unit's last marker", 'return rows.filter((r) => own(r) || ', 'return rows.filter((r) => ');
mutantFails("a unit's span built without its dispatches", 'rowsForUnit(g.rows, g.sessionUnits, id, markers, win.until, owners)', 'rowsForUnit(g.rows, g.sessionUnits, id, markers, win.until)');
mutantFails('matching a unit id inside a longer one', '(?![A-Za-z0-9]|\\\\.[A-Za-z0-9])', '');
mutantFails('cutting a marker command\'s unit id short', '(?=[\\\\s"\\\\\\\\]|$)`, \'g\'', '`, \'g\'');
mutantFails('keying a nested steps file by its basename', 'path.relative(path.join(top, dir), file)', 'path.basename(file)', GATHER_REL);
mutantFails('leaving the log rows no table took unmentioned', 'if (leftOut.length) out.push(leftOutWarning(leftOut));', '');
mutantFails('keeping stop-word pairs as friction themes', ' && !STOP.has(a) && !STOP.has(b)', '');
mutantFails("taking a sibling repository's Codex thread", 'return hostRollouts(dir, sinceMs).filter(({ meta }) => inside(meta.cwd));', 'return hostRollouts(dir, sinceMs);', SOURCES_REL);
mutantFails("leaving claude-run's ledger unread", 'if (fs.existsSync(claudeFile)) g.claudeRuns = parseLedger(readText(claudeFile));', '', GATHER_REL);
mutantFails("reading a command tag quoted in a sentence as the owner's /clear", 'const COMMAND_START = /^\\s*<command-(?:name|message)>/;', 'const COMMAND_START = /<command-/;');
mutantFails('counting a /clear that is no owner prompt', 'if (!isOwnerPrompt(d)) return null;', '');
mutantFails("ending an agent run at the owner's answer to a question", "if (e.type === 'prompt') {\n        close();", "if (e.type === 'prompt' || e.type === 'result') {\n        close();");
mutantFails('ending an agent run at the next prompt, not at the last record before it', "if (e.type === 'prompt') {\n        close();", "if (e.type === 'prompt') {\n        end = e.ts;\n        close();");
mutantFails('counting a prompt from before the window', 'if (start === null || !inWindow(start, since, until)) return;', 'if (start === null) return;');
mutantFails('counting a batch row as one plan row', 'n + (ids.size || 1)', 'n + 1');
mutantFails('counting the harness units as product plan rows', 'for (const r of rows) if (!isHarnessUnit(r.id)) named.set(', 'for (const r of rows) if (true) named.set(');
mutantFails('counting a typed /clear or /compact as an agent run', 'if (!typedAt.has(`${session}|${start}`)) runs.push(end - start);', 'runs.push(end - start);');
mutantFails("running two sessions' records together", 'g.events.push({ ...e, session: id });', 'g.events.push(e);', GATHER_REL);
mutantFails("taking the Codex host's baseline from the transcripts'", "codexHost: previousKpis(g.previous, win.week, 'codexHost'),", 'codexHost: previousKpis(g.previous, win.week),');
mutantFails('reading owner-other as owner', 'const BY_WORD = /owner[- ]other|owner|grant|default|agent/i;', 'const BY_WORD = /owner|owner[- ]other|grant|default|agent/i;');
mutantFails('demoting a kind at the bar, not past it', 'if (last.length > 0 && n / last.length > bar) {', 'if (last.length > 0 && n / last.length >= bar) {');
mutantFails("counting a grant row dated the newest promotion's day", '(r.date !== null && (cut === null || r.date > cut))', '(r.date !== null && (cut === null || r.date >= cut))');
mutantFails('counting the undated grant rows of a promotion with no date', '(!promotedKind || (r.date !== null', '(cut === null || (r.date !== null');
mutantFails("counting the owner's other choices as taking the recommendation", "const took = last.filter((r) => r.by === 'owner').length;", 'const took = last.length;');
mutantFails('proposing never-auto for the grant', "    if (k === 'never-auto') continue;\n    const last = newestFirst(", '    const last = newestFirst(');
mutantFails('linking a fix past the defect window', 'after(f, m) && f.t <= m.t + days * DAY && ', 'after(f, m) && ');
mutantFails('letting a defect link beat a reversal', "      if (reversed.has(rowKey(r))) return { ...r, outcome: 'reversed' };\n", '');
mutantFails("reading a unit branch's own commits as the mainline's", "['log', '--first-parent', ", "['log', ", GATHER_REL);
// Yield by step: the finding counter, the per-kind rate and the verdict copies the gather reads.
mutantFails('counting a "P1: none" line as a finding', '(P[0-3])\\\\b${FINDING_NOT_NONE}', '(P[0-3])\\\\b');
mutantFails('counting a heading as a finding', '(?:[-*+]\\s+|', '(?:#{1,6}\\s+|[-*+]\\s+|');
mutantFails('missing a finding line that starts with its id', '${FINDING_LEAD}${FINDING_ID}', '${FINDING_LEAD}');
mutantFails('missing a finding behind two openers', "const FINDING_OPEN = String.raw`(?:(?:\\*\\*|__|\\[|\\(|\\x60)\\s*){0,2}`;", "const FINDING_OPEN = String.raw`(?:(?:\\*\\*|__|\\[|\\(|\\x60)\\s*)?`;");
mutantFails('counting "P1: None found" as a finding', 'found|reported|', 'reported|');
mutantFails('reading "P2: 0.5s slower" as a none', '0(?![.,]\\d)', '0');
mutantFails('counting "P0/P1: none" as a P0', '(?:(?:[^A-Za-z0-9]*|\\s+(?:and|or)\\s+)P[0-3]\\b)*', '');
mutantFails('counting a dash table cell as a finding', '|[\\-–—]+(?=\\s*(?:\\||$))', '');
mutantFails("missing a finding after a none line's semicolon", ": line.split(';');", ': [line];');
mutantFails('counting a run that did not end ok', "if (e.outcome !== 'ok' || !inWindow(Date.parse(e.at), since, until)) continue;", 'if (!inWindow(Date.parse(e.at), since, until)) continue;');
mutantFails('taking the rate over runs, lost copies included', 'Math.round((s.hits / s.kept) * 100)', 'Math.round((s.hits / s.runs) * 100)');
mutantFails("reading a verdict copy outside the ledger's verdicts/", 'if (path.dirname(file) !== dir) continue;', '', GATHER_REL);
mutantFails('reading the copies of rows before the window', 'if (!(Date.parse(e.at) >= sinceMs)) continue;', '', GATHER_REL);
mutantFails('reading an oversized verdict copy', 'st.size > MAX_VERDICT_BYTES', 'false', GATHER_REL);

/** What the shipped suite no longer pins: it builds its fixtures from the bound values, so the template's own are read here. */
function checkDefaults(scriptsDir) {
  const url = pathToFileURL(path.join(scriptsDir, CORE_REL)).href;
  const code = `import * as c from ${JSON.stringify(url)};
console.log(JSON.stringify({
  paths: [c.REPORTS_DIR, c.LOG, c.FOLLOW_UPS, c.PLANS_DIR],
  follow: [c.STATUS_COLUMNS, c.STATUS_WORDS, c.SEVERITY_COLUMNS, c.FILED_AT],
  extra: c.EXTRA_COLUMNS,
  levels: [c.OUTLIER_X, c.MIN_COHORT, c.MIN_SHARE, c.REWRITE_ALERT_PERCENT, c.QUEUE_ALERT_DAYS],
  steps: ['EP-1 8c claims audit', 'EP-1 lane A conformance', 'EP-1 live walk', 'EP-1 integration', 'EP-1 screenshots', 'EP-1 code review', 'EP-1 slice 2', 'EP-1 grounding', 'EP-1 8b record', 'EP-1 8a docs sweep'].map((d) => c.stepOfDescription(d, 'EP-1')),
}));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: hermeticEnv(cleanup) });
  assert.strictEqual(res.status, 0, res.stderr);
  const got = JSON.parse(res.stdout);
  assert.deepStrictEqual(got.paths, ['docs/harness/reports', 'docs/harness/log.md', 'docs/harness/follow-ups.md', 'docs/plans'], 'the template paths');
  assert.deepStrictEqual(got.follow, [['status'], { open: ['open'], scheduled: ['scheduled'], fixed: ['fixed'], dropped: ['dropped'] }, ['sev', 'priority'], null], 'the template follow-ups shape (the filing date binding is off)');
  assert.deepStrictEqual(got.extra, { defects: 'defects', missed: 'missed by harness', friction: 'friction', deliverable: 'deliverable' }, 'the template EXTRA_COLUMNS');
  assert.deepStrictEqual(got.levels, [2, 3, 5, 5, 14], `OUTLIER_X, MIN_COHORT, MIN_SHARE, REWRITE_ALERT_PERCENT and QUEUE_ALERT_DAYS: ${got.levels.join(', ')}`);
  assert.deepStrictEqual(got.steps, ['8c', '4', '5', '6', '7', '8', '2', '1', '8b', '8a'], 'the template STEP_WORDS');
}

test('the template core ships its default bindings', () => {
  checkDefaults(SCRIPTS);
});

test('mutant: a template OUTLIER_X of 3 fails the defaults check', () => {
  const copy = tmp('retro-defaults-');
  cleanup.push(copy);
  fs.cpSync(SCRIPTS, copy, { recursive: true });
  const corePath = path.join(copy, CORE_REL);
  const before = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(before.split('export const OUTLIER_X = 2;').length - 1, 1);
  fs.writeFileSync(corePath, before.replace('export const OUTLIER_X = 2;', 'export const OUTLIER_X = 3;'));
  assert.throws(() => checkDefaults(copy), /OUTLIER_X/);
});

test('CLI smoke: a bad flag and two output modes each exit 2 with the usage line, reading nothing', () => {
  const cwd = tmp('retro-cli-');
  cleanup.push(cwd);
  const run = (args) => spawnSync(process.execPath, [path.join(SCRIPTS, CLI_REL), ...args], { cwd, encoding: 'utf8', env: hermeticEnv(cleanup) });
  for (const [args, message] of [
    [['--weekly'], /unknown option --weekly/],
    [['--dry-run', '--export', cwd], /pick one of --dry-run, --json and --export/],
  ]) {
    const res = run(args);
    assert.strictEqual(res.status, 2, res.stderr);
    assert.match(res.stderr, message);
    assert.match(res.stderr, /^usage: node scripts\/retro\.mjs /m);
  }
  assert.deepStrictEqual(fs.readdirSync(cwd), []);
});

test('end to end: a granted decision whose unit merged and then got a fix on its file within 7 days shows defect-linked 1, with an Ask kinds line', () => {
  const repo = tmp('retro-e2e-');
  cleanup.push(repo);
  const env = hermeticEnv(cleanup);
  const git = (args, date) => {
    const res = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    assert.strictEqual(res.status, 0, res.stderr);
  };
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  const head = `| Unit ${MID} Mode ${MID} Type ${MID} Tier | Elapsed (work) | Owner wait | Defects | Cost |\n|---|---|---|---|---|\n`;
  git(['init', '-q', '-b', 'main'], '2026-10-20T10:00:00Z');
  write('docs/harness/log.md', `# Log\n\n${head}`);
  write('src/a.js', 'one\n');
  git(['add', '.'], '2026-10-20T10:00:00Z');
  git(['commit', '-q', '-m', 'base'], '2026-10-20T10:00:00Z');
  git(['checkout', '-q', '-b', 'EP-2'], '2026-10-21T10:00:00Z');
  write('src/a.js', 'two\n');
  write(
    'docs/plans/EP-2.state.md',
    [
      'Unit: EP-2',
      '',
      '## Decisions',
      '| ID | Date | Class | Decision | By | Card kind | Why | Rejected alternative | Reversal cost | Kind |',
      '|---|---|---|---|---|---|---|---|---|---|',
      '| DEC-1 | 2026-10-21 | T | read the file once | grant | code | faster | read per call | edit + tests | default |',
      '',
    ].join('\n'),
  );
  git(['add', '.'], '2026-10-21T10:00:00Z');
  git(['commit', '-q', '-m', 'feat(a): read once'], '2026-10-21T10:00:00Z');
  git(['checkout', '-q', 'main'], '2026-10-22T10:00:00Z');
  git(['merge', '-q', '--no-ff', '-m', "Merge branch 'EP-2'", 'EP-2'], '2026-10-22T10:00:00Z');
  fs.appendFileSync(path.join(repo, 'docs/harness/log.md'), `| EP-2 ${MID} plan ${MID} Code ${MID} Full | 60m | 10m | 0/0 | Cost $1 |\n`);
  git(['commit', '-q', '-a', '-m', 'docs: log EP-2'], '2026-10-22T11:00:00Z');
  write('src/a.js', 'three\n');
  git(['commit', '-q', '-a', '-m', 'fix(a): the off-by-one'], '2026-10-24T10:00:00Z');
  const projects = tmp('retro-e2e-projects-');
  cleanup.push(projects);
  const res = spawnSync(
    process.execPath,
    [path.join(SCRIPTS, CLI_REL), '--since', '2026-10-19T00:00:00Z', '--until', '2026-10-26T00:00:00Z', '--projects-dir', projects, '--dry-run'],
    { cwd: repo, encoding: 'utf8', env },
  );
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /^Grant decisions: 1 · reversed 0 \(0%\) · defect-linked 1$/m);
  assert.match(res.stdout, /^Ask kinds: owner-fact, never-auto$/m);
  assert.match(res.stdout, /^Escaped-defect proxy: 0 reverts · 1 fixes within 7 days of a merge, on its files · 0 open P0\/P1 follow-ups filed this week$/m);
  assert.match(res.stdout, /^- EP-2\/DEC-1 · read the file once · [0-9a-f]{7} fix\(a\): the off-by-one$/m);
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
