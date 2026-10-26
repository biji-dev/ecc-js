#!/usr/bin/env node
// harness-bootstrap intake (generated YYYY-MM-DD). The intake draft's check and unit 1's Gate 1.
// [M] mechanism (ships as-is): everything. The [B] binding (the words that mark an open question)
// lives at the top of scripts/lib/intake-core.mjs.
/**
 * Feature intake (task-runner › Task type first, reference: intake): before the owner sheet,
 * check the drafted request; at unit 1's Gate 1, decide whether the sheet already approved it.
 *
 *   node scripts/intake.mjs --check <request> [--json]
 *   node scripts/intake.mjs --gate1 <request> --state <state file> [--json]
 *
 * options:
 *   --check <file>   every property the sheet needs: each deliverable's Demo: line, every P and C
 *                    decision as a card (recommendation, two or three options, a default), the
 *                    Never-auto:, Risk map: and Estimate: lines, unit 1's Scope block and its sha,
 *                    and no question left open outside a card. Once the owner approves, the
 *                    session writes `Approved: <date> · owner · <unit>/DEC-n · unit <id> · tier
 *                    <tier> · scope <sha>` into the request, the sha copied from this report
 *   --gate1 <file>   with --state: `Gate 1: auto — …` when the claimed unit is the approved one, at
 *                    its tier, with the approved Scope block, and the request's block is unchanged;
 *                    else `Gate 1: owner — <what changed>`. The ledger's Gate 1 row quotes the line
 *   --json           the result object instead of lines
 *
 * exit: --check 0 ready or approved | 1 a property is missing; --gate1 0 auto | 1 the owner decides;
 * 2 usage or an unreadable file.
 *
 * Read-only. It prints; it never writes into the repo.
 */
import fs from 'node:fs';
import { checkRequest, formatCheck, gate1, parseArgs } from './lib/intake-core.mjs';

const USAGE = 'usage: node scripts/intake.mjs --check <request> [--json] | --gate1 <request> --state <state file> [--json]';

function usage(msg) {
  process.stderr.write(`intake: ${msg}\n${USAGE}\n`);
  process.exitCode = 2;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) return usage(args.error);
  let request;
  let state;
  try {
    request = fs.readFileSync(args.request, 'utf8');
    if (args.state) state = fs.readFileSync(args.state, 'utf8');
  } catch (e) {
    return usage(`cannot read ${e.path ?? args.request}: ${e.code ?? e.message}`);
  }
  if (args.mode === 'check') {
    const result = checkRequest(request);
    process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : formatCheck(result, args.request));
    if (result.problems.length > 0) process.exitCode = 1;
    return undefined;
  }
  const result = gate1(request, state, args.request);
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${result.line}\n`);
  if (!result.auto) process.exitCode = 1;
  return undefined;
}

main();
