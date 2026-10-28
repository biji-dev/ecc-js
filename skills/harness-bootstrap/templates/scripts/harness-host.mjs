#!/usr/bin/env node
// harness-bootstrap harness-host (generated YYYY-MM-DD). Which host runs this session, and its models.
// [M] mechanism (ships as-is): everything. The [B] bindings (the models file, the login checks, the
// wrappers) live at the top of scripts/lib/harness-host-core.mjs.
/**
 * The runner runs it once a session, before the first switch line (harness-bootstrap's
 * reference/runner.md › The sequence):
 *
 *   node scripts/harness-host.mjs [--json] [--repo <dir>]
 *
 * The first line is the role line the switch line quotes -- `host codex · main gpt-6.1-sol high ·
 * second family claude` -- then the bounded model and what named the host, one `HAZARD <id> — …`
 * line per hazard (effort-above-high, second-family-absent, host-models-missing) and a verdict.
 * The host comes from HARNESS_HOST, any ZCODE_* variable, CODEX_THREAD_ID or CODEX_SANDBOX, then
 * CLAUDECODE, in that order. The models come from .agents/harness-models.json.
 *
 * Read-only: it reads the environment, the models file, the project's .codex/config.toml and
 * $CODEX_HOME/config.toml (default ~/.codex), and runs the second family's login check
 * (`codex login status`, `claude auth status`, 10 s each). It writes nothing.
 *
 * exit: 0 the host and its models are known (hazards may follow) | 1 the host is unknown, or the
 * models file has none for it | 2 usage, or a HARNESS_HOST that names no host.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LOGIN,
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
} from './lib/harness-host-core.mjs';

const USAGE = 'usage: node scripts/harness-host.mjs [--json] [--repo <dir>]';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function tilde(file) {
  const home = os.homedir();
  return file.startsWith(`${home}${path.sep}`) ? `~${file.slice(home.length)}` : file;
}

function login(fam) {
  const { command, args } = LOGIN[fam];
  const res = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });
  return { status: res.status, stdout: res.stdout, error: res.error?.code ?? null };
}

function main() {
  if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  let a;
  let found;
  try {
    a = parseArgs(process.argv.slice(2));
    found = detectHost(process.env);
  } catch (e) {
    process.stderr.write(`harness-host: ${e.message}\n${USAGE}\n`);
    return 2;
  }
  const repo = path.resolve(a.repo ?? process.cwd());
  let models = null;
  let modelsError = null;
  const text = readText(path.join(repo, MODELS_FILE));
  if (text === null) modelsError = 'missing';
  else {
    try {
      models = parseModels(text);
    } catch (e) {
      modelsError = e.message;
    }
  }
  const userConfig = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
  const codexConfigs = [
    [path.join(repo, '.codex', 'config.toml'), '.codex/config.toml'],
    [userConfig, tilde(userConfig)],
  ].map(([file, source]) => {
    const t = readText(file);
    return t === null ? null : { source, text: t };
  });
  const hazards = found.host === 'unknown' ? [] : effortHazards(found.host, { env: process.env, codexConfigs });
  const entry = models?.hosts?.[found.host];
  if (entry) {
    const states = {};
    for (const fam of [entry.second, entry.fallback]) {
      if (!fam) continue;
      const wrapper = fs.existsSync(path.join(repo, WRAPPERS[fam]));
      states[fam] = familyState(fam, { wrapper, login: wrapper ? login(fam) : undefined });
      if (states[fam].ok) break; // the fallback is asked only when the second family cannot run
    }
    hazards.push(...familyHazards(found.host, entry, states));
  }
  const report = hostReport({ ...found, models, modelsError, hazards });
  process.stdout.write(`${a.json ? JSON.stringify(report, null, 2) : formatHost(report)}\n`);
  return report.known ? 0 : 1;
}

process.exitCode = main();
