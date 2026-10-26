#!/usr/bin/env node
// harness-bootstrap context-budget hook (generated YYYY-MM-DD). Claude Code, Stop + UserPromptSubmit + PostToolUse.
// [M] mechanism (ships as-is): everything except the lines marked [B]. [B] binding: the WARN, GATE_TEXT,
// MARGIN and DEFAULT_LIMIT figures and BAND below, re-derived per project from its harness file's
// Context budget section.
// Every API call re-reads the whole context, so a session at 900K costs ~4x one at 200K per
// turn. This reads the main thread's last `usage` from the transcript (none since a compaction: it
// stays silent until the next reply) and:
//   Stop             -> systemMessage to the user (a /compact is welcome; the work continues)
//   UserPromptSubmit -> additionalContext to the model (offer a /compact at a step boundary; keep working)
//   PostToolUse      -> the same, so a session that runs on while the owner is away (no prompts)
//                       still sees the figure; past GATE_TEXT only, once per BAND or level change
// Below WARN only the model hears: the figure (UserPromptSubmit), and past GATE_TEXT that an owner gate
// goes out as text so idle compaction can run while it waits. The limit sits MARGIN under the
// auto-compact window Claude Code uses, so "compaction imminent" arrives before the compaction does.
// Never blocks; never fails the turn.
import { openSync, readSync, fstatSync, closeSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WARN = Number(process.env.CONTEXT_BUDGET_WARN ?? 220_000); // [B] past this, the model and the owner are told
export const GATE_TEXT = 150_000; // [B] past this, an owner gate goes out as text and the turn ends
const MARGIN = 40_000; // [B] the limit sits this far under the auto-compact window (compaction fired ~33K under it)
const DEFAULT_LIMIT = 260_000; // [B] with no window set: the harness's 300K window less MARGIN
const TAIL_BYTES = 4 * 1024 * 1024;
const BAND = 25_000; // [B] tokens of growth between PostToolUse reminders

/** A window size as Claude Code takes it — 300000, "300000" or "300k" — or null. */
function parseSize(value) {
  const m = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*([km]?)$/i);
  const n = m ? Number(m[1]) * { '': 1, k: 1_000, m: 1_000_000 }[m[2].toLowerCase()] : 0;
  return n > 0 ? Math.round(n) : null;
}

/**
 * The auto-compact window this session runs under, in Claude Code's own order: the environment
 * variable, then local, project and user settings (CLAUDE_CONFIG_DIR when set, as Claude Code reads
 * them, else ~/.claude). The first file that sets it decides, so a project's "auto" (or a value
 * Claude Code would reject) means the model's default: unknown, null.
 */
export function compactWindow(env = process.env, projectDir = env.CLAUDE_PROJECT_DIR, home = homedir()) {
  if (env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) return parseSize(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  const files = projectDir ? [join(projectDir, '.claude', 'settings.local.json'), join(projectDir, '.claude', 'settings.json')] : [];
  for (const file of [...files, join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json')]) {
    let value;
    try {
      value = JSON.parse(readFileSync(file, 'utf8'))?.autoCompactWindow;
    } catch {
      continue; // absent or unreadable: the next file decides
    }
    if (value !== undefined) return parseSize(value);
  }
  return null;
}

/** {warn, limit, window}: CONTEXT_BUDGET_LIMIT, else MARGIN under the window, else DEFAULT_LIMIT. */
export function budgetFigures(env = process.env, projectDir = env.CLAUDE_PROJECT_DIR, home = homedir()) {
  const window = env.CONTEXT_BUDGET_LIMIT ? null : compactWindow(env, projectDir, home);
  const limit = env.CONTEXT_BUDGET_LIMIT ? Number(env.CONTEXT_BUDGET_LIMIT) : window ? window - MARGIN : DEFAULT_LIMIT;
  return { warn: Math.min(WARN, limit), limit, window };
}

// PostToolUse fires on every tool call; speak only when the figure enters a new BAND or a new
// level (gate, warn, over), so the model is told a handful of times on the way to the limit.
export function newBand(sessionId, ctx, dir = process.env.CONTEXT_BUDGET_STATE_DIR || tmpdir(), level) {
  const band = Math.floor(ctx / BAND);
  const file = join(dir, `claude-context-budget-${String(sessionId).replace(/[^\w-]/g, '')}.json`);
  let last = {};
  try {
    last = JSON.parse(readFileSync(file, 'utf8')) ?? {};
  } catch {
    // first call of the session, or the file was cleared
  }
  // Context only grows between compactions, so any change of band is news,
  // including a lower band after a compact that is already past GATE_TEXT again.
  if (band === last.band && level === last.level) return false;
  writeFileSync(file, JSON.stringify({ band, level }));
  return true;
}

/** True for the main thread's compaction record (a subagent's compacts only its own context). */
function isCompaction(line) {
  if (!line.includes('"compact_boundary"')) return false;
  try {
    const b = JSON.parse(line);
    return b?.type === 'system' && b.subtype === 'compact_boundary' && !b.isSidechain;
  } catch {
    return false; // cut mid-record: not a boundary this scan can trust
  }
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
      // A main-thread compaction makes every earlier reading stale: with no reply since, there is
      // no figure. Read past it, the first prompt after a /compact (or an idle compaction) was
      // told the size it had before.
      if (isCompaction(line)) return null;
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

export function budgetMessage(event, ctx, { warn = WARN, limit = DEFAULT_LIMIT, window = null } = {}) {
  const k = `${Math.round(ctx / 1000)}K`;
  const gate = Math.min(GATE_TEXT, warn);
  if (ctx < warn) {
    if (event !== 'UserPromptSubmit' && !(event === 'PostToolUse' && ctx >= gate)) return null;
    const note = ctx < gate ? '' : `; past ${gate / 1000}K an owner gate goes out as text, then the turn ends`;
    return { hookSpecificOutput: { hookEventName: event, additionalContext: `[context-budget] ~${k} (under ${warn / 1000}K${note}).` } };
  }
  const over = ctx >= limit;
  const basis = window ? `${(window - limit) / 1000}K under the ${window / 1000}K auto-compact window` : 'harness file, "Context budget"';
  if (event === 'Stop') {
    return {
      systemMessage: over
        ? `Context ${k} - over the ${limit / 1000}K budget; every turn re-reads ~${k} tokens. /compact at a step boundary if you are here; otherwise the session continues and auto-compaction takes over.`
        : `Context ${k} - past ${warn / 1000}K. A /compact at the next step boundary helps if you are here (or /clear and the runner's resume command while it waits on you at a gate); the work does not wait for it.`,
    };
  }
  if (event === 'UserPromptSubmit' || event === 'PostToolUse') {
    const additionalContext = over
      ? `[context-budget] Main-thread context is ~${k} tokens, over the ${limit / 1000}K budget (${basis}). Auto-compaction ${window ? 'is imminent' : 'can land on any turn'}: make sure the state file is current (decision log, step done / next, open findings) and keep working. At an owner gate, the cards go out as text and the turn ends. Do not stop, and never ask for a new session.`
      : `[context-budget] Main-thread context is ~${k} tokens, past the ${warn / 1000}K mark; the budget is ${limit / 1000}K (${basis}). At the next step boundary, update the state file and offer the owner a /compact with the keep-line ready to paste, then continue without waiting. At an owner gate, give the cards as text with /clear and the runner's resume command, and end the turn. Never ask for a new session; delegate bulk reading to subagents.`;
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
    const figures = budgetFigures(process.env, process.env.CLAUDE_PROJECT_DIR || input.cwd);
    if (input.hook_event_name === 'PostToolUse') {
      // Past GATE_TEXT, PostToolUse speaks once per band or level; below it, it prints nothing and needs no state.
      const level = ctx >= figures.limit ? 'over' : ctx >= figures.warn ? 'warn' : 'gate';
      if (ctx < Math.min(GATE_TEXT, figures.warn) || !newBand(input.session_id, ctx, undefined, level)) return;
    }
    const out = budgetMessage(input.hook_event_name, ctx, figures);
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
