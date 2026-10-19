#!/usr/bin/env node
// harness-bootstrap context-budget hook (generated YYYY-MM-DD). Claude Code, Stop + UserPromptSubmit + PostToolUse.
// [M] mechanism (ships as-is): everything except the lines marked [B]. [B] binding: the
// CONTEXT_BUDGET_WARN / CONTEXT_BUDGET_LIMIT defaults and BAND below, re-derived per project from
// its harness file's Context budget section.
// Every API call re-reads the whole context, so a session at 900K costs ~4x one at 200K per
// turn. This reads the main thread's last `usage` from the transcript and:
//   Stop             -> systemMessage to the user (a /compact is welcome; the work continues)
//   UserPromptSubmit -> additionalContext to the model (offer a /compact at a step boundary; keep working)
//   PostToolUse      -> the same, so a session that runs on while the owner is away (no prompts)
//                       still sees the figure; past WARN only, once per BAND of context growth
// Below WARN only the model gets a one-line figure (UserPromptSubmit only). Never blocks; never fails the turn.
import { openSync, readSync, fstatSync, closeSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WARN = Number(process.env.CONTEXT_BUDGET_WARN ?? 250_000); // [B] past this, the model and the owner are told
const LIMIT = Number(process.env.CONTEXT_BUDGET_LIMIT ?? 400_000); // [B] the budget; past it, auto-compaction is imminent
const TAIL_BYTES = 4 * 1024 * 1024;
const BAND = 25_000; // [B] tokens of growth between PostToolUse reminders

// PostToolUse fires on every tool call; speak only when the figure enters a new BAND, so
// the model is told a handful of times on the way to LIMIT, not on every call.
export function newBand(sessionId, ctx, dir = process.env.CONTEXT_BUDGET_STATE_DIR || tmpdir()) {
  const band = Math.floor(ctx / BAND);
  const file = join(dir, `claude-context-budget-${String(sessionId).replace(/[^\w-]/g, '')}.json`);
  let last = -1;
  try {
    last = JSON.parse(readFileSync(file, 'utf8')).band ?? -1;
  } catch {
    // first call of the session, or the file was cleared
  }
  // Context only grows between compactions, so any change of band is news,
  // including a lower band after a compact that is already past WARN again.
  if (band === last) return false;
  writeFileSync(file, JSON.stringify({ band }));
  return true;
}

export function lastContextTokens(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue; // the first line of the tail window may be cut mid-record
      }
      const u = d?.message?.usage;
      if (d?.type !== 'assistant' || d.isSidechain || !u) continue;
      if (d.message.model === '<synthetic>') continue;
      return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

export function budgetMessage(event, ctx, warn = WARN, limit = LIMIT) {
  const k = `${Math.round(ctx / 1000)}K`;
  if (ctx < warn) {
    if (event !== 'UserPromptSubmit') return null;
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `[context-budget] ~${k} (under ${warn / 1000}K).` } };
  }
  const over = ctx >= limit;
  if (event === 'Stop') {
    return {
      systemMessage: over
        ? `Context ${k} - over the ${limit / 1000}K budget; every turn re-reads ~${k} tokens. /compact at a step boundary if you are here; otherwise the session continues and auto-compaction takes over.`
        : `Context ${k} - past ${warn / 1000}K. A /compact at the next step boundary helps if you are here; the work does not wait for it.`,
    };
  }
  if (event === 'UserPromptSubmit' || event === 'PostToolUse') {
    const additionalContext = over
      ? `[context-budget] Main-thread context is ~${k} tokens, over the ${limit / 1000}K budget (harness file, "Context budget"). Auto-compaction is imminent: make sure the state file is current (decision log, step done / next, open findings) and keep working. Do not stop, and never ask for a new session.`
      : `[context-budget] Main-thread context is ~${k} tokens, past the ${warn / 1000}K mark (harness file, "Context budget"). At the next step boundary, update the state file and offer the owner a /compact with the keep-line ready to paste, then continue without waiting. Never ask for a new session; delegate bulk reading to subagents.`;
    return { hookSpecificOutput: { hookEventName: event, additionalContext } };
  }
  return null;
}

async function main() {
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const input = JSON.parse(raw || '{}');
    const ctx = input.transcript_path ? lastContextTokens(input.transcript_path) : null;
    if (ctx == null) return;
    // Past WARN, PostToolUse speaks once per band; below WARN it prints nothing and needs no state.
    if (input.hook_event_name === 'PostToolUse' && ctx >= WARN && !newBand(input.session_id, ctx)) return;
    const out = budgetMessage(input.hook_event_name, ctx);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {
    // A budget warning must never break a turn.
  }
}

// import.meta.url is a realpath, so compare against the realpath of argv[1] (a symlinked hooks
// or project dir, or macOS /var -> /private/var, would otherwise make the hook silently do nothing).
function isMain() {
  const arg = process.argv[1] ?? '';
  let resolved = arg;
  try {
    resolved = realpathSync(arg);
  } catch {
    // keep the plain path
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

if (isMain()) {
  await main();
  process.exit(0);
}
