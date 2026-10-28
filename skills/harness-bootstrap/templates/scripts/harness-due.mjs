#!/usr/bin/env node
// harness-bootstrap harness-due (generated YYYY-MM-DD). What the harness owes before the next unit.
// [M] mechanism (ships as-is): everything. The [B] bindings (the mainline, the paths, the phase in a
// row id, the cadences, the limits, the commands) live at the top of scripts/lib/harness-due-core.mjs.
/**
 * The runner runs it at step 0, before the claim, and at step 9, after the merge (harness-bootstrap's
 * reference/runner.md › Due-checks):
 *
 *   node scripts/harness-due.mjs [--claim <row id>] [--json] [--now <ISO>] [--home <dir>]
 *   node scripts/harness-due.mjs --seen <YYYY-Www> [--home <dir>]
 *
 * options:
 *   --claim <id>   also check the row about to be claimed: the preflight of the phase it opens
 *   --json         { due: [{ kind, subject, why, command, blocking }], blocking } instead of lines
 *   --now <ISO>    the time to check against (default now)
 *   --home <dir>   the directory holding .agents/harness (default the home directory): the machine
 *                  sweep's approvals and log, the weekly job's registry and its proposals
 *   --seen <week>  record that this project read its proposals of that week, in
 *                  <home>/.agents/harness/retro/seen.json; it checks nothing else
 *
 * One line per thing due -- `DUE <kind> [<subject>] — <why> — <what to run>`, `NEW proposals
 * <week> — …` for the week's unread proposals -- or `harness-due: nothing due`. It reads files and
 * git (`log`, `blame`, `worktree list`, `merge-base`, `rev-list`, `reflog`, `status`) and writes
 * nothing but --seen's file: it starts no sweep itself, the runner does what each line says.
 *
 * exit: 0 nothing blocks | 1 the claimed row opens a phase with no preflight report | 2 usage.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FOLLOW_UPS,
  LOG,
  MAIN,
  REPORTS,
  checkAll,
  formatDue,
  markSeen,
  matchReports,
  newestProposals,
  parseArgs,
  parseWorktrees,
  projectName,
  reportShape,
} from './lib/harness-due-core.mjs';
import { blameDates, lastCommitTimes, readFollowUps, repoTop } from './lib/retro-gather.mjs';
import { gitRead } from './lib/run-sources.mjs';

const USAGE =
  'usage: node scripts/harness-due.mjs [--claim <row id>] [--json] [--now <ISO>] [--home <dir>] | --seen <YYYY-Www> [--home <dir>]';

function usage(msg) {
  process.stderr.write(`harness-due: ${msg}\n${USAGE}\n`);
  process.exitCode = 2;
}

const git = (args, cwd) => {
  try {
    return gitRead(args, cwd);
  } catch {
    return null;
  }
};
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
};
const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** A tracked file as { text, dates } (line -> commit ms), or null when it does not exist. */
function withDates(top, rel) {
  const file = path.join(top, rel);
  if (!fs.existsSync(file)) return null;
  return { text: fs.readFileSync(file, 'utf8'), dates: blameDates(top, rel) };
}

/**
 * Each bound kind's reports as [{ rel, time }]: the last commit that touched it. A report no commit
 * holds is left out, whatever its file time: a unit stays due until its report is committed.
 */
function readReports(top) {
  const out = {};
  for (const [kind, template] of Object.entries(REPORTS)) {
    if (template === null) continue;
    const { dir } = reportShape(template);
    let names = [];
    try {
      names = fs.readdirSync(path.join(top, dir));
    } catch {
      names = [];
    }
    const found = matchReports(template, names);
    const times = found.length ? lastCommitTimes(top, [dir]) : new Map();
    out[kind] = found.filter((r) => times.has(r.rel)).map((r) => ({ rel: r.rel, time: times.get(r.rel) }));
  }
  return out;
}

/** The main checkout of the repository `top` is in (a linked worktree's is its common directory's parent). */
function mainCheckout(top) {
  const common = git(['rev-parse', '--git-common-dir'], top)?.trim();
  if (!common) return top;
  const dir = path.resolve(top, common);
  return path.basename(dir) === '.git' ? path.dirname(dir) : top;
}

/**
 * The mainline's merges, newest first, as [{ t, subject }]: the landings, and the phases they name.
 * First-parent only: a landed branch that merged the mainline into itself is one landing, not two.
 */
function readMerges(top) {
  return (git(['log', '--merges', '--first-parent', '--format=%ct%x09%s', MAIN], top) ?? '').split('\n').flatMap((line) => {
    const tab = line.indexOf('\t');
    return tab === -1 ? [] : [{ t: Number(line.slice(0, tab)) * 1000, subject: line.slice(tab + 1) }];
  });
}

/**
 * The linked worktrees, each measured: merged into MAIN, with commits of its own (its HEAD off
 * the mainline's first-parent line, or a branch reflog that moved after its creation), its changes
 * and ignored paths, and its last activity.
 */
function readWorktrees(top) {
  const list = parseWorktrees(git(['worktree', 'list', '--porcelain'], top) ?? '');
  let mainline = null;
  return list.map((w, i) => {
    if (i === 0 || w.bare || w.locked || w.prunable || !w.head) return w;
    const merged = git(['merge-base', '--is-ancestor', w.head, MAIN], top) !== null;
    mainline ??= new Set((git(['rev-list', '--first-parent', MAIN], top) ?? '').split('\n').filter(Boolean));
    const moved = w.branch ? (git(['reflog', 'show', '-n', '2', '--format=%H', `refs/heads/${w.branch}`, '--'], top) ?? '').trim().split('\n').filter(Boolean).length > 1 : false;
    const own = merged && (!mainline.has(w.head) || moved);
    const commit = Number(git(['log', '-1', '--format=%ct', w.head], top)?.trim()) * 1000;
    // the worktree's own reflog moves at every commit, checkout and reset in it; its .git file at creation
    const gitdir = /^gitdir:\s*(.+)$/m.exec(fs.existsSync(path.join(w.path, '.git')) ? fs.readFileSync(path.join(w.path, '.git'), 'utf8') : '')?.[1];
    const times = [commit, mtime(path.join(w.path, '.git')), gitdir ? mtime(path.join(path.resolve(w.path, gitdir), 'logs', 'HEAD')) : null];
    const active = Math.max(...times.filter(Number.isFinite));
    const status = own ? git(['status', '--porcelain', '--ignored'], w.path) : null;
    const lines = status === null ? [] : status.split('\n').filter(Boolean);
    const clean = status !== null && lines.every((l) => l.startsWith('!! '));
    // a link is left out: removing it never touches what it points to
    const ignored = lines.filter((l) => l.startsWith('!! ')).map((l) => l.slice(3)).filter((p) => !isLink(path.join(w.path, p.replace(/\/$/, ''))));
    return { ...w, merged, own, clean, ignored, active };
  });
}

/** The machine sweep's approvals and its last run, from <home>/.agents/harness. */
function readDisk(top, harness) {
  let free = null;
  try {
    const s = fs.statfsSync(top);
    free = s.bavail * s.bsize;
  } catch {
    return null;
  }
  const approvals = readJson(path.join(harness, 'sweep.json'));
  const approved = Array.isArray(approvals?.approved) ? approvals.approved.filter((c) => typeof c === 'string') : [];
  let last = null;
  try {
    const lines = fs.readFileSync(path.join(harness, 'sweep-log.jsonl'), 'utf8').trim().split('\n');
    for (const line of lines.reverse()) {
      try {
        const e = JSON.parse(line);
        if (e && typeof e.t === 'string' && Number.isFinite(e.freed)) {
          last = e;
          break;
        }
      } catch {
        // a torn line
      }
    }
  } catch {
    last = null;
  }
  return { free, approved, last };
}

function readProposals(harness) {
  const dir = path.join(harness, 'retro');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const newest = newestProposals(names);
  if (!newest) return null;
  const file = path.join(dir, newest.name);
  return { newest, file, text: fs.readFileSync(file, 'utf8') };
}

function main() {
  let args;
  let top;
  try {
    args = parseArgs(process.argv.slice(2));
    top = repoTop(process.cwd());
  } catch (e) {
    return usage(e.message);
  }
  const harness = path.join(path.resolve(args.home ?? os.homedir()), '.agents', 'harness');
  const registry = readJson(path.join(harness, 'repos.json'));
  const repos = Array.isArray(registry?.repos) ? registry.repos.map((r) => ({ ...r, path: real(String(r?.path ?? '')) })) : [];
  const project = projectName({ repos }, real(mainCheckout(top)));
  const seenFile = path.join(harness, 'retro', 'seen.json');
  if (args.seen !== null) {
    try {
      fs.mkdirSync(path.dirname(seenFile), { recursive: true });
      fs.writeFileSync(seenFile, `${JSON.stringify(markSeen(readJson(seenFile), project, args.seen), null, 2)}\n`);
    } catch (e) {
      return usage(`cannot write ${seenFile}: ${e.code ?? e.message}`);
    }
    process.stdout.write(`harness-due: ${project} has read the proposals of ${args.seen}\n`);
    return;
  }
  let items;
  try {
    const facts = {
      now: args.now === null ? Date.now() : Date.parse(args.now),
      claim: args.claim,
      top,
      project,
      log: withDates(top, LOG),
      followUps: readFollowUps(top, FOLLOW_UPS),
      reports: readReports(top),
      merges: readMerges(top),
      disk: readDisk(top, harness),
      worktrees: readWorktrees(top),
      proposals: readProposals(harness),
      seen: readJson(seenFile) ?? {},
    };
    items = checkAll(facts);
  } catch (e) {
    return usage(e.message);
  }
  const blocking = items.filter((i) => i.blocking).length;
  process.stdout.write(args.json ? `${JSON.stringify({ due: items, blocking }, null, 2)}\n` : formatDue(items));
  if (blocking) process.exitCode = 1;
}

main();
