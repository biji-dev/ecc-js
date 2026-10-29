// harness-bootstrap harness-host tests (generated YYYY-MM-DD). Run: node --test scripts/lib/harness-host-core.test.mjs
// [M] mechanism (ships as-is): every test. [B] binding: none -- the tests carry their own
// environments, models files and login answers, and read WRAPPERS rather than its paths.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MODELS_FILE,
  WRAPPERS,
  detectHost,
  effortHazards,
  familyHazards,
  familyState,
  formatHost,
  hostReport,
  parseArgs,
  parseModels,
  tomlTopLevel,
} from './harness-host-core.mjs';

const MODELS = {
  schema: 1,
  hosts: {
    claude: { main: { model: 'opus', effort: 'high' }, bounded: { model: 'sonnet', effort: 'high' }, second: 'codex' },
    codex: { main: { model: 'gpt-6.1-sol', effort: 'high' }, bounded: { model: 'gpt-6-luna', effort: 'high' }, second: 'claude' },
    zcode: { main: { model: 'GLM-5.3' }, bounded: { model: 'GLM-5.3-Flash' }, second: 'codex', fallback: 'claude' },
  },
};
const json = (o) => JSON.stringify(o, null, 2);
const OK = { ok: true, why: '' };

test('parseArgs: --json and --repo; anything else is a usage error', () => {
  assert.deepEqual(parseArgs([]), { json: false, repo: null });
  assert.deepEqual(parseArgs(['--json', '--repo', '/r']), { json: true, repo: '/r' });
  assert.throws(() => parseArgs(['--repo']), /--repo needs a value/);
  assert.throws(() => parseArgs(['--host', 'codex']), /unknown option --host/);
  assert.throws(() => parseArgs(['codex']), /unexpected argument/);
});

test('detectHost: HARNESS_HOST, then ZCODE_*, then Codex, then CLAUDECODE -- a host started from another inherits its variables', () => {
  assert.deepEqual(detectHost({ HARNESS_HOST: 'Kimi', CODEX_THREAD_ID: 't', CLAUDECODE: '1' }), { host: 'kimi', by: 'HARNESS_HOST' });
  // ZCode also sets CLAUDE_* variables, so it is probed before Claude Code
  assert.deepEqual(detectHost({ ZCODE_SESSION_ID: 'z', CLAUDECODE: '1' }), { host: 'zcode', by: 'ZCODE_SESSION_ID' });
  // a Codex started from a Claude Code shell keeps CLAUDECODE
  assert.deepEqual(detectHost({ CODEX_THREAD_ID: 't', CLAUDECODE: '1' }), { host: 'codex', by: 'CODEX_THREAD_ID' });
  assert.deepEqual(detectHost({ CODEX_SANDBOX: 'seatbelt' }), { host: 'codex', by: 'CODEX_SANDBOX' });
  assert.deepEqual(detectHost({ CLAUDECODE: '1' }), { host: 'claude', by: 'CLAUDECODE' });
  assert.deepEqual(detectHost({ CLAUDECODE: '' }), { host: 'unknown', by: '' });
  assert.deepEqual(detectHost({}), { host: 'unknown', by: '' });
  assert.throws(() => detectHost({ HARNESS_HOST: 'cursor' }), /HARNESS_HOST must be one of claude, codex, zcode, kimi/);
});

test('parseModels: schema 1, a model per role, and a second family that is never the host\'s own', () => {
  assert.deepEqual(parseModels(json(MODELS)).hosts.zcode.fallback, 'claude');
  assert.equal(parseModels(json({ schema: 1, hosts: { zcode: { ...MODELS.hosts.zcode, second: null, fallback: null } } })).hosts.zcode.second, null);
  const orphan = { schema: 1, hosts: { zcode: { ...MODELS.hosts.zcode, second: null } } };
  assert.throws(() => parseModels(json(orphan)), /zcode: a fallback needs a second family/);
  assert.throws(() => parseModels('{'), /invalid JSON/);
  assert.throws(() => parseModels(json({ ...MODELS, schema: 2 })), /schema 1/);
  assert.throws(() => parseModels(json({ schema: 1, hosts: [] })), /no hosts object/);
  assert.throws(() => parseModels(json({ schema: 1, hosts: { cursor: MODELS.hosts.codex } })), /unknown host cursor/);
  const own = { schema: 1, hosts: { codex: { ...MODELS.hosts.codex, second: 'codex' } } };
  assert.throws(() => parseModels(json(own)), /codex: its second family is its own/);
  const typo = { schema: 1, hosts: { claude: { ...MODELS.hosts.claude, second: 'gemini' } } };
  assert.throws(() => parseModels(json(typo)), /claude: second must be codex, claude or null/);
  const bare = { schema: 1, hosts: { claude: { ...MODELS.hosts.claude, bounded: { effort: 'high' } } } };
  assert.throws(() => parseModels(json(bare)), /claude: bounded\.model is missing/);
});

test('tomlTopLevel: a key above the first table, quoted either way, comments ignored', () => {
  const text = ['# model_reasoning_effort = "max"', 'model = "gpt-6.1-sol"', "model_reasoning_effort = 'xhigh' # set 2026-10-17", '', '[sandbox_workspace_write]', 'model_reasoning_effort = "low"'].join('\n');
  assert.equal(tomlTopLevel(text, 'model_reasoning_effort'), 'xhigh');
  assert.equal(tomlTopLevel('[agents]\nmodel_reasoning_effort = "max"\n', 'model_reasoning_effort'), null);
  assert.equal(tomlTopLevel('', 'model'), null);
});

test('effortHazards: Codex reads the project config before the user one; Claude reads both effort variables', () => {
  const user = { source: '~/.codex/config.toml', text: 'model_reasoning_effort = "xhigh"\n' };
  const [codex] = effortHazards('codex', { env: {}, codexConfigs: [null, user] });
  assert.equal(codex.id, 'effort-above-high');
  assert.match(codex.detail, /^model_reasoning_effort = "xhigh" in ~\/\.codex\/config\.toml: /);
  assert.match(codex.detail, /-c model_reasoning_effort=high/);
  const project = { source: '.codex/config.toml', text: 'model_reasoning_effort = "high"\n' };
  assert.deepEqual(effortHazards('codex', { env: {}, codexConfigs: [project, user] }), []);
  assert.deepEqual(effortHazards('codex', { env: { CLAUDE_EFFORT: 'max' }, codexConfigs: [] }), []);
  const claude = effortHazards('claude', { env: { CLAUDE_EFFORT: 'max', CLAUDE_CODE_EFFORT_LEVEL: 'xhigh' }, codexConfigs: [user] });
  assert.deepEqual(claude.map((h) => h.detail.split(':')[0]), ['CLAUDE_CODE_EFFORT_LEVEL=xhigh', 'CLAUDE_EFFORT=max']);
  assert.deepEqual(effortHazards('claude', { env: { CLAUDE_EFFORT: 'high' }, codexConfigs: [] }), []);
  assert.deepEqual(effortHazards('zcode', { env: { CLAUDE_EFFORT: 'max' }, codexConfigs: [user] }), []);
});

test('familyState: the wrapper first, then the login check, read the way each CLI answers', () => {
  assert.deepEqual(familyState('codex', { wrapper: false, login: { status: 0, stdout: 'Logged in using ChatGPT\n' } }), { ok: false, why: `${WRAPPERS.codex} is not installed` });
  assert.deepEqual(familyState('codex', { wrapper: true, login: { status: 0, stdout: 'Logged in using ChatGPT\n' } }), OK);
  assert.deepEqual(familyState('codex', { wrapper: true, login: { status: 1, stdout: 'Not logged in\n' } }), { ok: false, why: '`codex login status`: Not logged in' });
  assert.deepEqual(familyState('codex', { wrapper: true, login: { error: 'ENOENT' } }), { ok: false, why: 'codex is not on PATH' });
  assert.deepEqual(familyState('claude', { wrapper: true, login: { status: 0, stdout: '{"loggedIn": true}' } }), OK);
  assert.deepEqual(familyState('claude', { wrapper: true, login: { status: 1, stdout: '{"loggedIn": false}' } }), { ok: false, why: '`claude auth status`: not logged in' });
  assert.deepEqual(familyState('claude', { wrapper: true, login: { status: 0, stdout: 'Logged in' } }), { ok: false, why: '`claude auth status` printed no JSON (exit 0)' });
  assert.deepEqual(familyState('claude', { wrapper: true, login: { error: 'ETIMEDOUT' } }), { ok: false, why: '`claude auth status` timed out' });
});

test('familyHazards: the second family, then the fallback; none named is degraded by design', () => {
  const zcode = MODELS.hosts.zcode;
  assert.deepEqual(familyHazards('zcode', zcode, { codex: OK, claude: OK }), []);
  const fellBack = familyHazards('zcode', zcode, { codex: { ok: false, why: 'codex is not on PATH' }, claude: OK });
  assert.deepEqual(fellBack.map((h) => h.id), ['second-family-absent']);
  assert.match(fellBack[0].detail, /^codex: codex is not on PATH; the fallback, claude, takes the second-family passes$/);
  const both = familyHazards('zcode', zcode, { codex: { ok: false, why: 'a' }, claude: { ok: false, why: 'b' } });
  assert.match(both[0].detail, /^codex: a; claude: b: every cross-family pass is degraded until one is back/);
  const none = familyHazards('zcode', { ...zcode, second: null, fallback: null }, {});
  assert.match(none[0].detail, /^zcode names no second family in \.agents\/harness-models\.json: every cross-family pass is degraded by design/);
  assert.match(familyHazards('codex', MODELS.hosts.codex, { claude: { ok: false, why: 'x' } })[0].detail, /^claude: x: every cross-family pass/);
});

test('formatHost: the role line first, exactly as the switch line quotes it', () => {
  const codex = hostReport({ host: 'codex', by: 'CODEX_THREAD_ID', models: parseModels(json(MODELS)), hazards: [] });
  assert.deepEqual(formatHost(codex).split('\n'), [
    'host codex · main gpt-6.1-sol high · second family claude',
    '  bounded gpt-6-luna high · detected by CODEX_THREAD_ID',
    'harness-host: no hazards',
  ]);
  const zcode = hostReport({ host: 'zcode', by: 'ZCODE_SESSION_ID', models: parseModels(json(MODELS)), hazards: [{ id: 'effort-above-high', detail: 'd' }] });
  assert.deepEqual(formatHost(zcode).split('\n'), [
    'host zcode · main GLM-5.3 · second family codex',
    '  bounded GLM-5.3-Flash · fallback claude · detected by ZCODE_SESSION_ID',
    'HAZARD effort-above-high — d',
    'harness-host: 1 hazard',
  ]);
  const missing = hostReport({ host: 'kimi', by: 'HARNESS_HOST', models: parseModels(json(MODELS)), hazards: [] });
  assert.equal(missing.known, false);
  assert.deepEqual(formatHost(missing).split('\n'), [
    'host kimi · main ? · second family ?',
    '  detected by HARNESS_HOST',
    `HAZARD host-models-missing — ${MODELS_FILE} has no kimi entry: the roles have no models on this host (harness-bootstrap's reference/gate-design.md › Model and effort)`,
    'harness-host: 1 hazard',
  ]);
  const noFile = hostReport({ host: 'codex', by: 'CODEX_SANDBOX', models: null, modelsError: 'missing', hazards: [] });
  assert.match(formatHost(noFile), new RegExp(`^HAZARD host-models-missing — ${MODELS_FILE.replace(/\./g, '\\.')} is missing: `, 'm'));
  const unknown = hostReport({ host: 'unknown', by: '', models: null, hazards: [] });
  assert.equal(unknown.known, false);
  assert.match(formatHost(unknown), /^host unknown · no host variable is set: set HARNESS_HOST/);
});

test('a hazard that cites a skill file cites it as harness-bootstrap\'s reference/<file>, which a project does have', () => {
  // The templates install into a project with no gate-design.md, context.md or cross-model.md.
  const zcode = MODELS.hosts.zcode;
  const details = [
    ...effortHazards('claude', { env: { CLAUDE_CODE_EFFORT_LEVEL: 'max', CLAUDE_EFFORT: 'xhigh' } }),
    ...familyHazards('zcode', { ...zcode, second: null, fallback: null }, {}),
    ...familyHazards('zcode', zcode, { codex: { ok: false, why: 'a' }, claude: { ok: false, why: 'b' } }),
    ...hostReport({ host: 'kimi', by: 'HARNESS_HOST', models: parseModels(json(MODELS)), hazards: [] }).hazards,
  ].map((h) => h.detail);
  const cited = details.flatMap((d) => d.match(/[\w-]+\.md/g) ?? []);
  assert.deepEqual([...new Set(cited)].sort(), ['context.md', 'cross-model.md', 'gate-design.md']);
  for (const d of details)
    for (const [, name] of d.matchAll(/([\w-]+\.md)/g))
      assert.ok(d.includes(`harness-bootstrap's reference/${name}`), `${name} is cited bare in: ${d}`);
});

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'harness-host.mjs');

test('the wrapper reads the environment, the models file and the login checks; exit 0 known, 1 unknown or no models, 2 usage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-host-'));
  const bin = path.join(dir, 'bin');
  const repo = path.join(dir, 'repo');
  const codexHome = path.join(dir, 'codex-home');
  for (const d of [bin, path.join(repo, path.dirname(MODELS_FILE)), path.join(repo, 'scripts'), codexHome]) fs.mkdirSync(d, { recursive: true });
  const stub = (name, body) => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  };
  stub('codex', 'echo "Logged in using ChatGPT"');
  stub('claude', 'echo \'{"loggedIn": false}\'; exit 1');
  fs.writeFileSync(path.join(repo, MODELS_FILE), json(MODELS));
  for (const f of Object.values(WRAPPERS)) fs.writeFileSync(path.join(repo, f), '');
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model_reasoning_effort = "xhigh"\n');
  const before = fs.readdirSync(repo, { recursive: true }).sort();
  const run = (env, ...args) =>
    spawnSync(process.execPath, [RUNNER, '--repo', repo, ...args], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, CODEX_HOME: codexHome, ...env },
    });
  const codex = run({ CODEX_THREAD_ID: 'x' });
  assert.equal(codex.status, 0, codex.stderr);
  assert.equal(codex.stdout.split('\n')[0], 'host codex · main gpt-6.1-sol high · second family claude');
  assert.match(codex.stdout, /^HAZARD effort-above-high — model_reasoning_effort = "xhigh" in /m);
  assert.match(codex.stdout, /^HAZARD second-family-absent — claude: `claude auth status`: not logged in: /m);
  const zcode = run({ ZCODE_SESSION_ID: 'z', CLAUDECODE: '1' }, '--json');
  assert.equal(zcode.status, 0, zcode.stderr);
  const report = JSON.parse(zcode.stdout);
  assert.equal(report.line, 'host zcode · main GLM-5.3 · second family codex');
  assert.deepEqual(report.hazards, []);
  fs.rmSync(path.join(repo, WRAPPERS.codex));
  const noWrapper = run({ ZCODE_SESSION_ID: 'z' });
  assert.match(noWrapper.stdout, new RegExp(`^HAZARD second-family-absent — codex: ${WRAPPERS.codex} is not installed; claude: `, 'm'));
  fs.writeFileSync(path.join(repo, WRAPPERS.codex), '');
  assert.equal(run({}).status, 1);
  assert.equal(run({ HARNESS_HOST: 'kimi' }).status, 1);
  assert.equal(run({ HARNESS_HOST: 'cursor' }).status, 2);
  fs.rmSync(path.join(repo, MODELS_FILE));
  const noModels = run({ CLAUDECODE: '1' });
  assert.equal(noModels.status, 1);
  assert.match(noModels.stdout, /^HAZARD host-models-missing — /m);
  assert.deepEqual(fs.readdirSync(repo, { recursive: true }).sort(), before.filter((f) => f !== MODELS_FILE));
  fs.rmSync(dir, { recursive: true, force: true });
});
