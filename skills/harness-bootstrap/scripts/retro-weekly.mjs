#!/usr/bin/env node
// harness-bootstrap retro-weekly. The weekly learning job across every registered repository.
// [M] mechanism: ships as-is. Its settings (model, cap, schedule) are at the top of
// scripts/lib/retro-weekly-core.mjs; the digest rules are the templates' own retro core.
/**
 * Registers repositories, then once a week exports each one's retro data and runs one read-only
 * review of the digests (`learning.md` › The weekly job).
 *
 *   node <skill dir>/scripts/retro-weekly.mjs --register <repo> [--project <name>] [--log <rel>]
 *     [--follow-ups <rel>] [--plans <rel>]...
 *   node <skill dir>/scripts/retro-weekly.mjs --unregister <repo | project>
 *   node <skill dir>/scripts/retro-weekly.mjs --list
 *   node <skill dir>/scripts/retro-weekly.mjs --run [--no-review] [--no-notify] [--budget <usd>] [--dry-run]
 *   node <skill dir>/scripts/retro-weekly.mjs --install [--dry-run] | --uninstall [--dry-run] | --print-schedule
 *
 * options: --home <dir> (default ~/.agents/harness) · --projects-dir <dir> (default $CLAUDE_CONFIG_DIR/projects
 *          when that is set, else ~/.claude/projects) · --config-dir <dir> (the CLAUDE_CONFIG_DIR for this
 *          run and its review; the Windows task passes it, schtasks setting no environment)
 *          · --claude <path> (default: claude on PATH)
 *
 * Files under the home: repos.json (the registry) · retro/<project>/retro-<YYYY-Www>.{json,md} (each
 * export) · retro/proposals-<YYYY-Www>.md (the review) · retro/weekly-log.jsonl (one line a run) ·
 * retro-weekly/ (the copy the schedule runs, so a plugin update cannot move it).
 *
 * In a repository it only reads: git `ls-files`, `blame`, `log`, `rev-parse` and `worktree list`.
 * The review runs `claude -p` in retro/ with Read, Grep and Glob only, `--restricted` (no settings
 * file, file tools confined to retro/), no MCP server, and `--max-budget-usd`.
 *
 * exit: 0 ok | 1 an export or the review failed (the rest still ran) | 2 usage.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPORTS_DIR, buildRetro, fitDigest, isoWeek, windowFor } from '../templates/scripts/lib/retro-core.mjs';
import { gather, readPrevious, repoTop } from '../templates/scripts/lib/retro-gather.mjs';
import { gitRead } from '../templates/scripts/lib/run-sources.mjs';
import {
  LABEL,
  PROJECT_NAME,
  REVIEW_TIMEOUT_MS,
  SCHEDULE,
  addRepo,
  countProposals,
  emptyRegistry,
  importsOf,
  launchdPlist,
  logColumns,
  notifyCommand,
  parseArgs,
  parseReview,
  proposalsMarkdown,
  readRegistry,
  removeRepo,
  resolveRepo,
  reviewArgs,
  reviewPrompt,
  scheduleLines,
  shellLine,
} from './lib/retro-weekly-core.mjs';

const USAGE =
  'usage: node scripts/retro-weekly.mjs --register <repo> | --unregister <repo|project> | --list | --run [--no-review] [--no-notify] | --dry-run | --install | --uninstall | --print-schedule';
const MANIFEST = '.agents/harness-manifest.json';
const SELF = fileURLToPath(import.meta.url);
const SKILL_DIR = path.resolve(path.dirname(SELF), '..');

class Usage extends Error {}

const out = (s = '') => process.stdout.write(`${s}\n`);

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function loadRegistry(home) {
  const file = path.join(home, 'repos.json');
  if (!fs.existsSync(file)) return emptyRegistry();
  try {
    return readRegistry(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Usage(`${file}: ${e.message}`);
  }
}

/** What resolveRepo reads from a repository: its manifest (or null) and its tracked files. */
function repoFacts(top) {
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(top, MANIFEST), 'utf8'));
  } catch {
    // no manifest, or not one: the candidates decide
  }
  let tracked = [];
  try {
    tracked = gitRead(['ls-files', '-z'], top).split('\0').filter(Boolean);
  } catch {
    // resolveRepo then finds nothing it was not given
  }
  return { manifest, tracked };
}

function resolved(entry) {
  return resolveRepo(entry, repoFacts(entry.path));
}

function describe(r) {
  const f = (rel, from) => (rel ? `${rel} (${from})` : 'none');
  return `log ${f(r.log, r.from.log)} · follow-ups ${f(r.followUps, r.from.followUps)} · plans ${r.plans.length ? `${r.plans.join(', ')} (${r.from.plans})` : 'none'}`;
}

function register(opts, home) {
  let top;
  try {
    top = repoTop(path.resolve(opts.target));
  } catch {
    throw new Usage(`${opts.target}: not inside a git repository`);
  }
  const entry = { path: top, project: opts.project ?? path.basename(top), log: opts.log, followUps: opts.followUps, plans: opts.plans };
  if (!PROJECT_NAME.test(entry.project)) throw new Usage(`"${entry.project}" cannot name an export directory; pass --project <name>`);
  const r = resolved(entry);
  if (opts.log && !fs.existsSync(path.join(top, opts.log))) throw new Usage(`${opts.log}: no such file in ${top}`);
  let reg;
  try {
    reg = addRepo(loadRegistry(home), entry);
  } catch (e) {
    throw new Usage(e.message);
  }
  writeAtomic(path.join(home, 'repos.json'), `${JSON.stringify(reg, null, 2)}\n`);
  out(`registered ${entry.project}  ${top}`);
  out(`  ${describe(r)}`);
}

/** One repository's export: its data and its digest into retro/<project>/, both for the week of `now`. */
function exportOne(r, { retroDir, projectsDir, now }) {
  const top = repoTop(r.path);
  const dir = path.join(retroDir, r.project);
  const previous = readPrevious([path.join(top, REPORTS_DIR), dir]);
  const win = windowFor({ now, previous });
  const g = gather({ top, log: r.log, followUps: r.followUps, plansDirs: r.plans, projectsDir, sinceMs: Date.parse(win.baselineSince) });
  const d = buildRetro({ ...g, previous }, { project: r.project, now, columns: logColumns(g.log.text) });
  const base = path.join(dir, `retro-${d.week}`);
  writeAtomic(`${base}.json`, `${JSON.stringify(d, null, 2)}\n`);
  writeAtomic(`${base}.md`, fitDigest(d));
  return { week: d.week, file: path.relative(retroDir, `${base}.md`), units: d.kpis.log.units, sessions: d.sources.sessions };
}

/** `claude` on PATH, or null. */
function findOnPath(name) {
  for (const dir of String(process.env.PATH ?? '').split(path.delimiter)) {
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // not here
    }
  }
  return null;
}

function notify(opts, title, text) {
  if (!opts.notify) return;
  const cmd = notifyCommand(process.platform, { title, text });
  if (cmd) spawnSync(cmd[0], cmd[1], { stdio: 'ignore', timeout: 10_000 });
}

function run(opts, home) {
  const reg = loadRegistry(home);
  const retroDir = path.join(home, 'retro');
  const projectsDir = opts.projectsDir ?? path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const now = Date.now();
  const week = isoWeek(now);
  const claude = opts.claude ?? findOnPath('claude');
  if (opts.dryRun) return dryRun({ opts, reg, retroDir, week, claude });
  if (reg.repos.length === 0) {
    out(`no repositories registered in ${path.join(home, 'repos.json')}: run --register <repo>`);
    return 0;
  }
  const exported = [];
  const failed = [];
  for (const entry of reg.repos) {
    try {
      const x = exportOne(resolved(entry), { retroDir, projectsDir, now });
      exported.push({ project: entry.project, ...x });
      out(`exported ${entry.project}: ${x.file} (${x.units} units, ${x.sessions} sessions)`);
    } catch (e) {
      failed.push({ project: entry.project, error: e.message });
      out(`FAILED ${entry.project}: ${e.message}`);
    }
  }
  const digests = exported.map((x) => ({ project: x.project, file: x.file }));
  let review = { skipped: opts.review ? 'no digest' : '--no-review' };
  if (opts.review && digests.length) review = runReview({ opts, retroDir, week, digests, claude });
  const entry = { t: new Date(now).toISOString(), week, exported: exported.map((x) => x.project), failed, review };
  fs.mkdirSync(retroDir, { recursive: true });
  fs.appendFileSync(path.join(retroDir, 'weekly-log.jsonl'), `${JSON.stringify(entry)}\n`);
  if (review.ok) notify(opts, 'Harness retro', `${week}: ${review.proposals} proposals from ${digests.length} repos — ${review.file}`);
  else if (opts.review) notify(opts, 'Harness retro', `${week}: review ${review.skipped ? `skipped (${review.skipped})` : `failed (${review.reason})`} — digests in ${retroDir}`);
  return failed.length || (opts.review && !review.ok && !review.skipped) ? 1 : 0;
}

function previousProposals(retroDir, week) {
  let names = [];
  try {
    names = fs.readdirSync(retroDir);
  } catch {
    return null;
  }
  return names.filter((n) => /^proposals-\d{4}-W\d{2}\.md$/.test(n) && n < `proposals-${week}.md`).sort().at(-1) ?? null;
}

function runReview({ opts, retroDir, week, digests, claude }) {
  if (!claude) {
    out('review FAILED: claude is not on PATH; pass --claude <path>');
    return { ok: false, reason: 'claude not found' };
  }
  const prompt = reviewPrompt({ week, digests, previous: previousProposals(retroDir, week) });
  const started = Date.now();
  const res = spawnSync(claude, reviewArgs({ prompt, budget: opts.budget }), {
    cwd: retroDir,
    encoding: 'utf8',
    timeout: REVIEW_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ms = Date.now() - started;
  const r = res.error ? { ok: false, reason: res.error.code ?? res.error.message, costUsd: null } : parseReview(res.stdout, res.status);
  if (!r.ok) {
    out(`review FAILED: ${r.reason}${res.stderr ? ` — ${res.stderr.trim().split('\n').at(-1)}` : ''}`);
    return { ok: false, reason: r.reason, costUsd: r.costUsd, ms };
  }
  const file = path.join(retroDir, `proposals-${week}.md`);
  writeAtomic(file, proposalsMarkdown({ week, generated: new Date().toISOString(), digests, review: r, budget: opts.budget }));
  const proposals = countProposals(r.text);
  out(`review: ${proposals} proposals in ${file} ($${(r.costUsd ?? 0).toFixed(2)}, ${Math.round(ms / 1000)} s)`);
  return { ok: true, file, proposals, costUsd: r.costUsd, ms };
}

function dryRun({ opts, reg, retroDir, week, claude }) {
  out(`retro-weekly dry run — ${week}; writes nothing`);
  out(`repositories (${reg.repos.length}):`);
  for (const entry of reg.repos) {
    const r = resolved(entry);
    out(`  ${entry.project}  ${entry.path}`);
    out(`    ${describe(r)}`);
    out(`    export → ${path.join(retroDir, entry.project, `retro-${week}.{json,md}`)}`);
  }
  if (!opts.review) {
    out('review: skipped (--no-review)');
    return 0;
  }
  const digests = reg.repos.map((e) => ({ project: e.project, file: `${e.project}/retro-${week}.md` }));
  const prompt = reviewPrompt({ week, digests, previous: previousProposals(retroDir, week) });
  out(`review, in ${retroDir}:`);
  out(`  ${shellLine([claude ?? 'claude', ...reviewArgs({ prompt: '$PROMPT', budget: opts.budget })]).replace("'$PROMPT'", '"$PROMPT"')}`);
  out(`  then writes ${path.join(retroDir, `proposals-${week}.md`)} and a desktop notice${claude ? '' : ' (claude is not on PATH: pass --claude <path>)'}`);
  out('PROMPT:');
  for (const line of prompt.split('\n')) out(`  ${line}`);
  return 0;
}

/** The files the scheduled copy needs: this script and every module it imports, relative to the skill. */
function closure() {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of importsOf(fs.readFileSync(file, 'utf8'))) walk(path.resolve(path.dirname(file), spec));
  };
  walk(SELF);
  return [...seen].map((f) => path.relative(SKILL_DIR, f)).sort();
}

function installPlan(opts, home) {
  const copyDir = path.join(home, 'retro-weekly');
  const claude = opts.claude ?? findOnPath('claude');
  const programArguments = [process.execPath, path.join(copyDir, 'scripts', 'retro-weekly.mjs'), '--run', '--home', home];
  if (claude) programArguments.push('--claude', claude);
  if (opts.projectsDir) programArguments.push('--projects-dir', path.resolve(opts.projectsDir));
  const pathEnv = [...new Set([path.dirname(process.execPath), ...(claude ? [path.dirname(claude)] : []), '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':');
  const logFile = path.join(home, 'retro', 'weekly.out.log');
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  // the schedule runs without the shell's environment: Claude Code's config directory goes in with it
  const configDir = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : null;
  return { copyDir, claude, programArguments, pathEnv, logFile, plist, configDir, files: closure() };
}

function install(opts, home) {
  const p = installPlan(opts, home);
  if (!p.claude) throw new Usage('claude is not on PATH; pass --claude <path>');
  if (path.resolve(SKILL_DIR) === path.resolve(p.copyDir)) throw new Usage(`this is the installed copy; run --install from the skill itself`);
  const domain = `gui/${process.getuid?.() ?? 0}`;
  const lines = scheduleLines({ programArguments: p.programArguments, logFile: p.logFile, configDir: p.configDir });
  if (opts.dryRun) {
    out(`install dry run; writes nothing`);
    out(`copy ${p.files.length} files to ${p.copyDir}: ${p.files.join(', ')}`);
    if (process.platform === 'darwin') {
      out(`write ${p.plist}, then: launchctl bootout ${domain}/${LABEL}; launchctl bootstrap ${domain} ${p.plist}`);
      out(`runs: ${shellLine(p.programArguments)} — Mondays ${String(SCHEDULE.hour).padStart(2, '0')}:00, or at the next wake`);
    } else out(`schedule it with: ${process.platform === 'win32' ? lines.schtasks : lines.cron}`);
    return 0;
  }
  fs.rmSync(p.copyDir, { recursive: true, force: true });
  for (const rel of p.files) {
    fs.mkdirSync(path.dirname(path.join(p.copyDir, rel)), { recursive: true });
    fs.copyFileSync(path.join(SKILL_DIR, rel), path.join(p.copyDir, rel));
  }
  out(`copied ${p.files.length} files to ${p.copyDir}`);
  if (process.platform !== 'darwin') {
    out(`schedule it with: ${process.platform === 'win32' ? lines.schtasks : lines.cron}`);
    return 0;
  }
  writeAtomic(p.plist, launchdPlist({ programArguments: p.programArguments, pathEnv: p.pathEnv, logFile: p.logFile, configDir: p.configDir }));
  fs.mkdirSync(path.dirname(p.logFile), { recursive: true });
  spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' });
  const res = spawnSync('launchctl', ['bootstrap', domain, p.plist], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`launchctl bootstrap failed: ${(res.stderr || '').trim()}`);
  out(`installed ${LABEL}: Mondays ${String(SCHEDULE.hour).padStart(2, '0')}:00 (a missed run starts at the next wake); log ${p.logFile}`);
  return 0;
}

function uninstall(opts, home) {
  const p = installPlan(opts, home);
  const domain = `gui/${process.getuid?.() ?? 0}`;
  if (opts.dryRun) {
    out(`uninstall dry run; writes nothing`);
    out(`launchctl bootout ${domain}/${LABEL}; remove ${p.plist} and ${p.copyDir}; keep ${path.join(home, 'retro')}`);
    return 0;
  }
  if (process.platform === 'darwin') spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' });
  fs.rmSync(p.plist, { force: true });
  fs.rmSync(p.copyDir, { recursive: true, force: true });
  out(`removed the schedule and ${p.copyDir}; the exports and proposals in ${path.join(home, 'retro')} stay`);
  return 0;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`retro-weekly: ${e.message}\n${USAGE}\n`);
    return 2;
  }
  // set first: the transcripts' directory, the review's claude and the schedule read it
  if (opts.configDir) process.env.CLAUDE_CONFIG_DIR = path.resolve(opts.configDir);
  const home = path.resolve(opts.home ?? path.join(os.homedir(), '.agents', 'harness'));
  try {
    switch (opts.command) {
      case 'register':
        register(opts, home);
        return 0;
      case 'unregister': {
        const reg = loadRegistry(home);
        let key = opts.target;
        if (!reg.repos.some((x) => x.project === key)) {
          try {
            key = repoTop(path.resolve(key));
          } catch {
            key = path.resolve(key);
          }
        }
        let next;
        try {
          next = removeRepo(reg, key);
        } catch (e) {
          throw new Usage(e.message);
        }
        writeAtomic(path.join(home, 'repos.json'), `${JSON.stringify(next, null, 2)}\n`);
        out(`unregistered ${opts.target}`);
        return 0;
      }
      case 'list': {
        const reg = loadRegistry(home);
        if (reg.repos.length === 0) out('no repositories registered');
        for (const entry of reg.repos) out(`${entry.project}  ${entry.path}\n  ${describe(resolved(entry))}`);
        return 0;
      }
      case 'run':
        return run(opts, home);
      case 'install':
        return install(opts, home);
      case 'uninstall':
        return uninstall(opts, home);
      case 'printSchedule': {
        const p = installPlan(opts, home);
        const lines = scheduleLines({ programArguments: p.programArguments, logFile: p.logFile, configDir: p.configDir });
        out(`cron (Linux; a missed run does not catch up): ${lines.cron}`);
        out(`Task Scheduler (Windows): ${lines.schtasks}`);
        out(`both run the copy in ${p.copyDir}: run --install first to make it`);
        return 0;
      }
      default:
        throw new Usage(`no command ${opts.command}`);
    }
  } catch (e) {
    process.stderr.write(`retro-weekly: ${e.message}\n`);
    if (e instanceof Usage) {
      process.stderr.write(`${USAGE}\n`);
      return 2;
    }
    return 1;
  }
}

process.exitCode = main();
