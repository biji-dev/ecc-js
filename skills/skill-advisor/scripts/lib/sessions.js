'use strict';

/**
 * Reads Claude Code and Codex session transcripts for one project (or all projects).
 * Local files only; no network.
 */

const fs = require('fs');
const path = require('path');

const PROMPT_LIMIT = 300;
const PROMPT_CHARS = 300;
const TOUCHED_LIMIT = 200;
/** Harnesses whose sessions cannot be read (no readable transcript store found). */
const UNAVAILABLE_TOOLS = ['zcode'];

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function count(map, key) {
  map[key] = (map[key] || 0) + 1;
}

/** Claude Code names a project's transcript folder by replacing every non-alphanumeric character with '-'. */
function encodeClaudeDir(dir) {
  return dir.replace(/[^a-zA-Z0-9]/g, '-');
}

/** True when cwd is the project or inside it; a null project accepts any cwd. */
function inside(project, cwd) {
  if (!project) return true;
  if (!cwd) return false;
  const rel = path.relative(project, cwd);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function walkJsonl(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonl(full));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

/** Top-level transcripts of every Claude project folder whose name starts with the project's encoding. */
function findClaudeSessions({ home, project }) {
  const root = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(root)) return [];
  const prefix = project ? encodeClaudeDir(project) : '';
  const files = [];
  for (const dir of fs.readdirSync(root)) {
    if (prefix && !dir.startsWith(prefix)) continue;
    const full = path.join(root, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const name of fs.readdirSync(full)) if (name.endsWith('.jsonl')) files.push(path.join(full, name));
  }
  return files;
}

function emptySession(tool, file) {
  return { tool, file, cwd: null, prompts: [], usage: {}, touched: [], docsWritten: [] };
}

function readClaudeSession(file) {
  const session = emptySession('claude', file);
  for (const line of readLines(file)) {
    const entry = parse(line);
    if (!entry || !entry.message) continue;
    if (!session.cwd && entry.cwd) session.cwd = entry.cwd;
    const content = entry.message.content;
    if (entry.type === 'user') {
      const texts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text) : [];
      for (const text of texts) {
        const command = text.match(/<command-name>\/?([\w:-]+)<\/command-name>/);
        if (command) count(session.usage, `command:${command[1]}`);
        else if (!text.startsWith('<')) session.prompts.push({ at: entry.timestamp || null, text: text.slice(0, PROMPT_CHARS) });
      }
    }
    if (entry.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        const input = block.input || {};
        if (block.name === 'Skill' && input.skill) count(session.usage, `skill:${input.skill}`);
        if ((block.name === 'Agent' || block.name === 'Task') && input.subagent_type) count(session.usage, `agent:${input.subagent_type}`);
        if (typeof input.file_path === 'string') {
          session.touched.push(input.file_path);
          if ((block.name === 'Write' || block.name === 'Edit') && input.file_path.endsWith('.md')) session.docsWritten.push(input.file_path);
        }
      }
    }
  }
  return session;
}

function readCodexSession(file) {
  const session = emptySession('codex', file);
  for (const line of readLines(file)) {
    const entry = parse(line);
    if (!entry || !entry.payload) continue;
    const payload = entry.payload;
    if (entry.type === 'session_meta' && payload.cwd) session.cwd = payload.cwd;
    if (entry.type === 'event_msg' && payload.type === 'user_message' && typeof payload.message === 'string' && !payload.message.startsWith('<')) {
      session.prompts.push({ at: entry.timestamp || null, text: payload.message.slice(0, PROMPT_CHARS) });
    }
    if (entry.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
      const args = String(payload.arguments || payload.input || '');
      for (const match of args.matchAll(/skills\/([a-z0-9-]+)\/SKILL\.md/g)) count(session.usage, `skill:${match[1]}`);
      for (const match of args.matchAll(/\*\*\* (?:Add|Update) File: (\S+)/g)) {
        session.touched.push(match[1]);
        if (match[1].endsWith('.md')) session.docsWritten.push(match[1]);
      }
    }
  }
  return session;
}

/** Sessions of a project (and its worktrees and subfolders), or of every project when project is null. */
function collectSessions({ home, project }) {
  const found = [
    ...findClaudeSessions({ home, project }).map(readClaudeSession),
    ...walkJsonl(path.join(home, '.codex', 'sessions')).map(readCodexSession)
  ].filter(session => inside(project, session.cwd));
  for (const session of found) {
    session.touched = session.touched.map(file => path.resolve(session.cwd || '', file));
    session.docsWritten = session.docsWritten.map(file => path.resolve(session.cwd || '', file));
  }
  return found;
}

function summarise(found) {
  const bySession = {};
  const usage = {};
  const prompts = [];
  const seen = new Set();
  const touched = new Map();
  const docsWritten = new Set();
  const touchedExtensions = {};
  for (const session of found) {
    count(bySession, session.tool);
    for (const [key, value] of Object.entries(session.usage)) usage[key] = (usage[key] || 0) + value;
    for (const prompt of session.prompts) {
      const key = `${prompt.at}|${prompt.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      prompts.push({ ...prompt, tool: session.tool });
    }
    for (const file of session.touched) {
      touched.set(file, (touched.get(file) || 0) + 1);
      const ext = path.extname(file);
      if (ext) count(touchedExtensions, ext);
    }
    session.docsWritten.forEach(file => docsWritten.add(file));
  }
  prompts.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    sessions: bySession,
    usage,
    prompts: prompts.slice(0, PROMPT_LIMIT),
    touchedExtensions,
    touched: [...touched.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOUCHED_LIMIT).map(([file]) => file),
    docsWritten: [...docsWritten].sort()
  };
}

module.exports = { UNAVAILABLE_TOOLS, encodeClaudeDir, inside, collectSessions, summarise };
