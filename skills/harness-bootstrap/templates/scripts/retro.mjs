#!/usr/bin/env node
// harness-bootstrap retro (generated YYYY-MM-DD). Writes the week's retro digest from what is on disk.
// [M] mechanism (ships as-is): everything. The [B] bindings (paths, log columns, outlier rule, alert
// levels, step words) live at the top of scripts/lib/retro-core.mjs.
/**
 * Reads the harness log, the follow-ups doc, the state and steps files, earlier digests, this
 * repository's Claude Code transcripts and the Codex ledger, and writes
 * `<REPORTS_DIR>/retro-<YYYY-Www>.md`, at most 8 KB: KPIs against the four weeks before, outliers,
 * where the money went by step, friction, what the owner caught, the queue, and at most five
 * candidates for the retro review (`learning.md`).
 *
 *   node scripts/retro.mjs [--since <ISO>] [--until <ISO>] [--projects-dir <dir>] [--ledger <path>]
 *     [--dry-run | --json | --export <dir>]
 *
 * options:
 *   --since / --until   the window (default: from the end of the last digest's window, else one week
 *                       back, up to now)
 *   --projects-dir <d>  the Claude Code transcripts (default ~/.claude/projects)
 *   --ledger <path>     the Codex ledger (default: the main checkout's .codex-runs/ledger.jsonl)
 *   --dry-run           print the digest; write nothing
 *   --json              print the digest's data as JSON; write nothing
 *   --export <dir>      write only <dir>/retro-<YYYY-Www>.json, the data, which outlives the transcripts
 *
 * exit: 0 ok | 2 usage (bad flag, not in a git repository, no log, unreadable file).
 *
 * It writes the digest (or, with --export, the one JSON file) and nothing else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FOLLOW_UPS, LOG, PLANS_DIR, REPORTS_DIR, buildRetro, fitDigest, parseArgs, windowFor } from './lib/retro-core.mjs';
import { gather, readPrevious, repoTop } from './lib/retro-gather.mjs';

const USAGE =
  'usage: node scripts/retro.mjs [--since <ISO>] [--until <ISO>] [--projects-dir <dir>] [--ledger <path>] [--dry-run | --json | --export <dir>]';

function usage(msg) {
  process.stderr.write(`retro: ${msg}\n${USAGE}\n`);
  process.exitCode = 2;
}

function main() {
  let args;
  let top;
  let data;
  try {
    args = parseArgs(process.argv.slice(2));
    top = repoTop(process.cwd());
    const now = Date.now();
    const previous = readPrevious([path.join(top, REPORTS_DIR)]);
    const win = windowFor({ since: args.since, until: args.until, now, previous });
    const g = gather({
      top,
      log: LOG,
      followUps: FOLLOW_UPS,
      plansDirs: [PLANS_DIR],
      projectsDir: args.projectsDir ?? path.join(os.homedir(), '.claude', 'projects'),
      ledger: args.ledger,
      sinceMs: Date.parse(win.baselineSince),
    });
    data = buildRetro({ ...g, previous }, { project: path.basename(top), now, since: args.since, until: args.until });
  } catch (e) {
    return usage(e.message);
  }
  if (args.json) return process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  if (args.dryRun) return process.stdout.write(fitDigest(data));
  const dir = args.export ? path.resolve(args.export) : path.join(top, REPORTS_DIR);
  const file = path.join(dir, `retro-${data.week}.${args.export ? 'json' : 'md'}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, args.export ? `${JSON.stringify(data, null, 2)}\n` : fitDigest(data));
  } catch (e) {
    return usage(`cannot write ${file}: ${e.code ?? e.message}`);
  }
  process.stdout.write(`${file}\n`);
}

main();
