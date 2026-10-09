#!/usr/bin/env node
// harness-bootstrap context-budget hook (generated YYYY-MM-DD). Claude Code, Stop + UserPromptSubmit.
// Every API call re-reads the whole context, so a session at 900K costs ~4x one at 200K per
// turn. This reads the main thread's last `usage` from the transcript and:
//   Stop             -> systemMessage to the user (compact / new session)
//   UserPromptSubmit -> additionalContext to the model (hand off at a step boundary)
// Below WARN only the model gets a one-line figure. Never blocks; never fails the turn.
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const WARN = Number(process.env.CONTEXT_BUDGET_WARN ?? 250_000);
const LIMIT = Number(process.env.CONTEXT_BUDGET_LIMIT ?? 400_000);
const TAIL_BYTES = 4 * 1024 * 1024;

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
        ? `Context ${k} - over the ${limit / 1000}K budget. Finish this step, then /compact or start a new session; every turn now re-reads ~${k} tokens.`
        : `Context ${k} - past ${warn / 1000}K. Plan a /compact or a new session at the next step boundary.`,
    };
  }
  if (event === 'UserPromptSubmit') {
    const additionalContext = over
      ? `[context-budget] Main-thread context is ~${k} tokens, over the ${limit / 1000}K budget (harness file, "Context"). Finish only the current step, update the run's state file, then tell the user to /compact or start a new session.`
      : `[context-budget] Main-thread context is ~${k} tokens, past ${warn / 1000}K (harness file, "Context"). At the next step boundary, suggest /compact or a new session; delegate bulk reading to subagents.`;
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } };
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
    const out = budgetMessage(input.hook_event_name, ctx);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {
    // A budget warning must never break a turn.
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
  process.exit(0);
}
