#!/usr/bin/env node
// harness-bootstrap session-resume hook (generated YYYY-MM-DD). Claude Code, SessionStart + UserPromptSubmit.
// [M] mechanism (ships as-is): everything except the lines marked [B]. [B] binding: REGISTRY, STATE_DIR,
// MAX_BYTES and MAIN below, re-derived per project: the commit guard's REGISTRY, the directory its state
// files sit in (unit-step-core.mjs's STEPS_DIR), the cap on what this puts into the context and the
// mainline branch's name.
// Auto-compaction is the reset; this restores the unit. On a compaction, a clear, a resume or a
// startup it reads the registry's held and parked rows and each unit's state file, and hands the
// model the resume point the owner used to paste by hand:
//   compact                 -> continue the held unit's next step, re-reading process.md (Step 0a)
// A session started in a linked worktree that a held row names sees only the rows that name its
// checkout in full; the others are one `HELD ELSEWHERE` line each, other sessions' units it never
// continues. A session started in the main checkout sees every held row, as before: it may drive a
// unit in a linked worktree with `cd`.
//   startup, resume, clear  -> context only: nothing starts until the owner asks
// The registry and the state files are the record; a compaction summary is not (harness-bootstrap's
// reference/context.md). Reads files and runs `git rev-parse`, `git show`, `git rev-list`, `git log` and
// `git merge-base` only: writes only its own tmp state file (harness-seen-<session>.json), never blocks,
// never starts work, and says nothing when anything fails, or when no row is held or parked but on a
// compaction, which points a queue run at its next unit.
// On UserPromptSubmit it tells the session what other sessions did since its last turn: the mainline's
// head and the registry's held and parked units, compared with the tmp file the last run (this hook's
// SessionStart included) left; the first run of a session prints nothing.
// The standing grant comes from AGENTS.md's merge block, read here from the main checkout: it is written
// once, so it survives a compaction and needs no kickoff; a unit's state-file Grant: line only narrows it.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REGISTRY = '.claude/registry.md'; // [B] the lock file, relative to the main checkout (the guard's REGISTRY)
export const STATE_DIR = 'docs/plans'; // [B] where <unit>.state.md sits in the unit's checkout (unit-step-core.mjs's STEPS_DIR)
export const MAX_BYTES = 4000; // [B] the cap on the text put into the context
export const MAIN = 'main'; // [B] the mainline branch, whose head the since-last-turn line follows

const SOURCES = ['startup', 'resume', 'clear', 'compact'];
const NEXT_LINES = 3; // the first non-empty lines of `## Next` that are quoted
const CLIP = 160; // characters of any one quoted cell or line
const GIT_TIMEOUT_MS = 2000;
const SINCE_MAX = 300; // characters of the since-last-turn line
const SUBJECT_MAX = 60; // characters of the newest commit's subject in it
// A unit id names a file (unit-step-core.mjs's UNIT_ID_SOURCE): one `/` at most, each segment starting
// with a letter or digit, so an absolute id never matches; `..` inside a segment is refused on its own.
const UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const PLACEHOLDER = /^(?:-|—|n\/a|none)$/i;
const QID = /^Q-\d+$/;
// A Branch cell git may take as a branch name: no option, no range, no revision syntax.
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const CLOSING = {
  compact: "Continue the held unit's next step from its state file and the runner's process.md (Step 0a: verify, do not trust the marker); parked units wait for the owner's answers.",
  one: (unit) => `Continue ${unit}'s next step from its state file and the runner's process.md (Step 0a: verify, do not trust the marker); units held elsewhere are other sessions', never continue one; parked units wait for the owner's answers.`,
  several: "Several units are held: continue only the one this session was running, from its state file and the runner's process.md (Step 0a: verify, do not trust the marker); the others are other sessions'. A controller (coordinate-sessions) re-reads its board and runs board-check instead. Parked units wait for the owner's answers.",
  elsewhere: "No unit is held in this checkout; units held elsewhere are other sessions', never continue one. Parked units wait for the owner's answers. If a queue run is on, start the next ready unit (the runner's Shape); a worker under a controller waits for its next message.",
  parkedOnly: "No unit is held; parked units wait for the owner's answers. If a queue run is on, start the next ready unit (the runner's Shape).",
  none: "No unit is held or parked. If a queue run is on, run harness-due and start the next unit in the runner's order (the runner's Shape) under the standing grant and any Stop: line.",
  context: 'Context only: start nothing until the owner asks; /task-runner resumes the held unit, then answered parked units, then the next original plan row.',
};

const clip = (value) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > CLIP ? `${s.slice(0, CLIP - 1)}…` : s;
};
const cellsOf = (line) => (/^\s*\|/.test(line) ? line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()) : null);
const isSep = (line) => /^\s*\|[\s:|-]*-[\s:|-]*$/.test(line);
const trimCell = (value) => String(value ?? '').replace(/^[\s`]+|[\s`]+$/g, '');

/**
 * The table between `<!-- harness:<name> -->` and `<!-- /harness:<name> -->`, read as the commit guard
 * reads the active one: the header is the row right above a |---| row inside the markers, else the
 * table header right above the begin marker (markers around the data rows only), else none: no column
 * is named, as the guard names none. { header: lower-cased names or null, rows: cells } or null without
 * both markers. Nothing outside is read.
 */
export function section(text, name) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const begin = lines.findIndex((l) => l.includes(`<!-- harness:${name} -->`));
  const end = lines.findIndex((l, i) => i > begin && l.includes(`<!-- /harness:${name} -->`));
  if (begin < 0 || end < 0) return null;
  const above = begin >= 2 && isSep(lines[begin - 1]) && cellsOf(lines[begin - 2]) ? lines[begin - 2] : null;
  const body = lines.slice(begin + 1, end).filter((l) => cellsOf(l));
  const at = body.findIndex((l, i) => i + 1 < body.length && isSep(body[i + 1]));
  const header = at >= 0 ? body[at] : above;
  const rows = body.filter((l, i) => i !== at && !isSep(l)).map(cellsOf);
  return { header: header ? cellsOf(header).map((c) => trimCell(c).toLowerCase()) : null, rows };
}

/**
 * The standing grant in AGENTS.md's merge block (`<!-- harness:begin merge -->` … `<!-- harness:end merge -->`,
 * each marker alone on its line): the first `Grant:` line's value and the `Push deploys:` value (yes or no),
 * each a string or null. Lines outside the block are never read, and a block with no end marker reads nothing.
 */
export function standingGrant(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const begin = lines.findIndex((l) => l.trim() === '<!-- harness:begin merge -->');
  const end = lines.findIndex((l, i) => i > begin && l.trim() === '<!-- harness:end merge -->');
  const block = begin < 0 || end < 0 ? [] : lines.slice(begin + 1, end);
  const grant = block.map((l) => /^\s*Grant:(.*)$/.exec(l)).find(Boolean);
  const push = block.map((l) => /^\s*Push deploys:\s*(yes|no)\b/i.exec(l)).find(Boolean);
  return { grant: grant ? clip(grant[1]) || null : null, pushDeploys: push ? push[1].toLowerCase() : null };
}

/** A Worktree cell as the guard reads it: the first word, a placeholder (-, n/a, none) read as empty. */
function worktreeCell(value) {
  const wt = String(value ?? '').replace(/`/g, '').trim().split(/\s/)[0].split('·')[0];
  return PLACEHOLDER.test(wt) ? '' : wt;
}

/** Each row's cells by header name: Unit (Task in an older registry), Step, Branch, Worktree, Gate, Parked, Cards. */
function byName(header, cells) {
  const at = (...names) => {
    const i = header.findIndex((h) => names.some((n) => h === n || h.startsWith(`${n} `)));
    return i >= 0 ? trimCell(cells[i]) : '';
  };
  return { unit: at('unit', 'task'), step: at('step'), branch: at('branch'), worktree: worktreeCell(at('worktree')), gate: at('gate'), since: at('parked'), cards: at('cards') };
}

/**
 * The registry's held rows, then its parked ones. Held: a first cell of 1 or more (row 0 is the mainline,
 * never held). With no header a held row keeps its cells unnamed (`cells`), and a parked table gives none.
 */
export function registryRows(text) {
  const out = [];
  const active = section(text, 'active');
  for (const cells of active?.rows ?? []) {
    if (!/^[1-9][0-9]*$/.test((cells[0] ?? '').replace(/\s/g, ''))) continue;
    out.push(active.header ? { kind: 'held', ...byName(active.header, cells) } : { kind: 'held', cells: cells.map(trimCell) });
  }
  const parked = section(text, 'parked');
  for (const cells of parked?.header ? parked.rows : []) {
    const row = byName(parked.header, cells);
    if (row.unit && !PLACEHOLDER.test(row.unit)) out.push({ kind: 'parked', ...row });
  }
  return out;
}

/**
 * A state file's `Key: value` header lines (before the first `##`, keys lower-cased, the first of each
 * kept) and its sections by the heading's first word (harness-bootstrap's reference/scope-guard.md › The state file).
 */
export function readState(text) {
  const head = {};
  const sections = {};
  let at = null;
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^##\s+(\w+)/.exec(line);
    if (h) {
      at = h[1].toLowerCase();
      sections[at] ??= [];
    } else if (at !== null) {
      sections[at].push(line);
    } else {
      const kv = /^([A-Za-z][A-Za-z ]*?):\s*(.*)$/.exec(line);
      if (kv && !(kv[1].toLowerCase() in head)) head[kv[1].toLowerCase()] = kv[2].trim();
    }
  }
  return { head, sections };
}

/**
 * The open owner questions in `## Decisions`: lines whose first table cell or first word is Q-<n>. A
 * card is a Q-n row until it is answered and becomes a DEC row, so every Q row present is open. A table
 * row is quoted by its Question or Decision cell, else its other cells.
 */
export function openQuestions(lines = []) {
  const out = [];
  let header = null;
  lines.forEach((line, i) => {
    const cells = cellsOf(line);
    if (cells) {
      if (isSep(line)) return;
      if (i + 1 < lines.length && isSep(lines[i + 1])) {
        header = cells.map((c) => c.toLowerCase());
        return;
      }
      const id = trimCell(cells[0]);
      if (!QID.test(id)) return;
      const q = header ? header.findIndex((h, j) => j > 0 && /^(?:question|decision)\b/.test(h)) : -1;
      out.push(`${id} ${clip(q > 0 && cells[q] ? cells[q] : cells.slice(1).filter(Boolean).join(' · '))}`.trim());
      return;
    }
    const m = /^\s*(?:[-*+]\s+)?(Q-\d+)\b[\s·:.,—–-]*(.*)$/.exec(line);
    if (m) out.push(`${m[1]} ${clip(m[2])}`.trim());
  });
  return out;
}

const nextLines = (lines = []) => lines.map((l) => clip(l.replace(/^\s*[-*+]\s+/, ''))).filter(Boolean).slice(0, NEXT_LINES);

/**
 * A row's state file, read from the checkout its Worktree cell names, else from its Branch cell's branch:
 * a unit parked on the main checkout under SCOPE=repo keeps its file on its branch while the checkout is
 * on another unit's. { head, sections } or { note }.
 */
function stateOf(row, root) {
  if (row.cells) return { note: 'state file not read: the registry table has no header row' };
  if (!UNIT_ID.test(row.unit) || row.unit.includes('..')) return { note: `state file not read: '${clip(row.unit)}' is not a unit id` };
  const file = join(rowCheckout(row, root), STATE_DIR, `${row.unit}.state.md`);
  try {
    return readState(readFileSync(file, 'utf8'));
  } catch {
    const missing = `state file not found: ${relative(root, file).split(sep).join('/')}`;
    if (!BRANCH.test(row.branch) || row.branch.includes('..')) return { note: missing };
    try {
      const text = execFileSync('git', ['show', `${row.branch}:${STATE_DIR}/${row.unit}.state.md`], { cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] });
      return readState(text);
    } catch {
      return { note: `${missing} (in this checkout or on ${clip(row.branch)})` };
    }
  }
}

/**
 * The checkout a row's Worktree cell names, as the commit guard reads it: the main checkout for an empty
 * cell, `main` or `.`, else the path from the main checkout; a realpath when it exists.
 */
function rowCheckout(row, root) {
  const path = !row.worktree || row.worktree === 'main' || row.worktree === '.' ? root : resolve(root, row.worktree);
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A unit's `; `-joined terms (a Grant line lists its own with ` · `): parked, kickoff narrows, stop. */
function termsOf(row, head, standing) {
  // a state Grant: only narrows the standing one, so it shows when it differs from it
  const narrows = head.grant && clip(head.grant) !== standing && `kickoff narrows: ${head.grant}`;
  return [row.kind === 'held' && head.parked && `parked: ${head.parked}`, narrows, head.stop && `stop: ${head.stop}`].filter(Boolean);
}

/** One row's lines: its head line, then what its state file says (or why it says nothing). */
export function unitLines(row, { head = {}, sections = {}, note } = {}, standing = null) {
  const parts = (list) => list.filter(Boolean).map(clip).join(' · ');
  const lines = [];
  if (row.kind === 'held') {
    lines.push(`HELD ${parts(row.cells ?? [row.unit, row.step && `step ${row.step}`, row.branch, row.worktree || 'main', head.tier && `tier ${head.tier}`])}`);
  } else {
    const gate = [row.gate, row.since && `since ${row.since}`].filter(Boolean).join(' ') || head.parked;
    lines.push(`PARKED ${parts([row.unit, gate, row.cards])}`);
  }
  if (note) return [...lines, `  ${note}`];
  const next = nextLines(sections.next);
  if (next.length) lines.push(`  next: ${next.join(' / ')}`);
  // a parked row's Cards cell already names its open cards
  const open = row.kind === 'parked' && row.cards ? [] : openQuestions(sections.decisions);
  if (open.length) lines.push(`  open: ${open.join(' · ')}`);
  const terms = termsOf(row, head, standing);
  if (terms.length) lines.push(`  ${terms.map(clip).join('; ')}`);
  return lines;
}

/**
 * The first line, the body and the closing line, held to `max` bytes: whole body lines while they fit, then how
 * many were cut. A cap too small for even the first line, that count and the closing line drops the count and
 * cuts the text, never inside a character.
 */
export function capped(first, body, last, max = MAX_BYTES) {
  const size = (ls) => Buffer.byteLength(ls.join('\n'));
  if (size([first, ...body, last]) <= max) return [first, ...body, last].join('\n');
  const tail = (n) => `… ${n} more lines: read ${REGISTRY} and the state files`;
  const kept = [];
  for (const line of body) {
    if (size([first, ...kept, line, tail(body.length - kept.length - 1), last]) > max) break;
    kept.push(line);
  }
  const lines = [first, ...kept, tail(body.length - kept.length), last];
  if (size(lines) <= max) return lines.join('\n');
  const bytes = Buffer.from([first, last].join('\n'));
  let end = Math.max(0, Math.min(bytes.length, max));
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1; // a UTF-8 continuation byte: back to its character's start
  return bytes.subarray(0, end).toString('utf8');
}

/** A held row of another session: one line, its state file unread. */
const elsewhereLine = (row) => `HELD ELSEWHERE ${[row.unit, row.step && `step ${row.step}`, row.branch, row.worktree].filter(Boolean).map(clip).join(' · ')}`;

/**
 * The text for a SessionStart from `source`; with no held or parked row, a compaction's pointer at the queue,
 * else null. `grant` is standingGrant's { grant, pushDeploys }; a grant line follows the first line.
 * `checkout` is the checkout the session started in (a realpath). Started in a linked worktree while a held
 * row names a linked worktree, the session's units are the held rows that name its checkout, and every other
 * held row is one HELD ELSEWHERE line. Anywhere else, or with no `checkout`, every held row is the session's.
 */
export function resumeText(source, rows, root, grant = null, { checkout } = {}) {
  if (!rows.length && source !== 'compact') return null;
  const first = `[session-resume] ${source}: the harness's resume point, read from the registry and the state files (newer than any summary).`;
  const standing = grant?.grant ?? null;
  const held = rows.filter((row) => row.kind === 'held');
  const located = checkout !== undefined && checkout !== root && held.some((row) => !row.cells && rowCheckout(row, root) !== root);
  const mine = held.filter((row) => !located || rowCheckout(row, root) === checkout);
  const body = [
    ...mine.flatMap((row) => unitLines(row, stateOf(row, root), standing)),
    ...held.filter((row) => !mine.includes(row)).map(elsewhereLine),
    ...rows.filter((row) => row.kind !== 'held').flatMap((row) => unitLines(row, stateOf(row, root), standing)),
  ];
  if (standing !== null) body.unshift(`standing grant (AGENTS.md › merge): ${standing}; push deploys: ${grant.pushDeploys ?? '?'}`);
  let last = CLOSING.context;
  if (source === 'compact') {
    if (located) last = mine.length === 0 ? CLOSING.elsewhere : mine.length === 1 ? CLOSING.one(clip(mine[0].unit)) : CLOSING.several;
    else last = mine.length > 1 ? CLOSING.several : mine.length ? CLOSING.compact : rows.length ? CLOSING.parkedOnly : CLOSING.none;
  }
  return capped(first, body, last);
}

/** The main checkout, as the commit guard finds it: the parent of git's common dir when that is a .git, else the top level. */
export function mainCheckout(dir) {
  const git = (cwd, arg) => execFileSync('git', ['rev-parse', arg], { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const top = git(dir, '--show-toplevel');
  const common = resolve(top, git(top, '--git-common-dir'));
  return realpathSync(basename(common) === '.git' ? dirname(common) : top);
}

/** The main checkout's standing grant; no AGENTS.md, or one that cannot be read, is no grant. */
function readGrant(root) {
  try {
    return standingGrant(readFileSync(join(root, 'AGENTS.md'), 'utf8'));
  } catch {
    return null;
  }
}

/** `git <args>` in `cwd`: its trimmed stdout; throws on a non-zero exit. */
function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** The registry's units as { kind, unit } (backticks stripped, rows with no unit cell left out); no registry file is none. */
function seenRows(root) {
  let text;
  try {
    text = readFileSync(join(root, REGISTRY), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return registryRows(text).map((row) => ({ kind: row.kind, unit: String(row.unit ?? '').replace(/`/g, '').trim() })).filter((row) => row.unit);
}

/** What is seen of the other sessions' work now: { head: the mainline's commit or null, rows: [{ kind, unit }] }. */
export function seenNow(root) {
  let head;
  try {
    head = gitOut(root, ['rev-parse', '--verify', '-q', `refs/heads/${MAIN}`]) || null;
  } catch {
    head = null;
  }
  return { head, rows: seenRows(root) };
}

/** Is `old` an ancestor of `now`? Any git failure (an object gone) reads as no. */
function isAncestor(root, old, now) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', old, now], { cwd: root, timeout: GIT_TIMEOUT_MS, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The one-line note on what changed between two sightings, or null when nothing did: `MAIN +<n> (<newest
 * subject>)` or `MAIN moved`, then `<unit> claimed`, `<unit> released` and `<unit> parked`, at most
 * SINCE_MAX characters (units cut from the end are counted as `+<k> more`).
 */
export function sinceLine(before, after, root) {
  const parts = [];
  if (before.head && after.head && before.head !== after.head) {
    let moved = `${MAIN} moved`;
    if (isAncestor(root, before.head, after.head)) {
      try {
        const n = gitOut(root, ['rev-list', '--count', `${before.head}..${after.head}`]);
        const subject = gitOut(root, ['log', '-1', '--format=%s', after.head]).replace(/\s+/g, ' ');
        const cut = subject.length > SUBJECT_MAX ? `${subject.slice(0, SUBJECT_MAX - 1)}…` : subject;
        moved = `${MAIN} +${n}${cut ? ` (${cut})` : ''}`;
      } catch {
        // keep "moved"
      }
    }
    parts.push(moved);
  }
  const kindOf = (rows) => new Map(rows.map((row) => [row.unit, row.kind]));
  const was = kindOf(before.rows);
  const is = kindOf(after.rows);
  const claimed = [...is].filter(([unit, kind]) => kind === 'held' && was.get(unit) !== 'held').map(([unit]) => `${unit} claimed`);
  const released = [...was].filter(([unit]) => !is.has(unit)).map(([unit]) => `${unit} released`);
  const parked = [...is].filter(([unit, kind]) => kind === 'parked' && was.get(unit) === 'held').map(([unit]) => `${unit} parked`);
  parts.push(...claimed, ...released, ...parked);
  if (!parts.length) return null;
  const lead = '[other sessions] since your last turn: ';
  const fits = (list, more) => `${lead}${[...list, ...(more ? [`+${more} more`] : [])].join(' · ')}`.length <= SINCE_MAX;
  let kept = parts.length;
  while (kept > 1 && !fits(parts.slice(0, kept), parts.length - kept)) kept -= 1;
  const line = `${lead}${[...parts.slice(0, kept), ...(kept < parts.length ? [`+${parts.length - kept} more`] : [])].join(' · ')}`;
  return line.length > SINCE_MAX ? `${line.slice(0, SINCE_MAX - 1)}…` : line;
}

/** This session's seen-state file in the tmp dir; null without a usable session id. */
function seenFile(input) {
  const id = String(input.session_id ?? '').replace(/[^\w-]/g, '');
  return id ? join(tmpdir(), `harness-seen-${id}.json`) : null;
}

/** The previous sighting from the tmp file, or null (none, or unreadable). */
function readSeen(file) {
  try {
    const seen = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(seen?.rows) ? { head: typeof seen.head === 'string' ? seen.head : null, rows: seen.rows } : null;
  } catch {
    return null;
  }
}

/** Records the sighting for the session's next run; a failed write is ignored. */
function writeSeen(file, seen) {
  try {
    writeFileSync(file, JSON.stringify(seen));
  } catch {
    // the next turn then counts as a first one
  }
}

async function main() {
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const input = JSON.parse(raw || '{}');
    const event = input.hook_event_name;
    if (event !== 'SessionStart' && event !== 'UserPromptSubmit') return;
    const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd;
    if (!dir) return;
    // the registry lives in the main checkout, so every linked worktree reads the same lock
    const root = mainCheckout(dir);
    const file = seenFile(input);
    if (event === 'UserPromptSubmit') {
      if (!file) return;
      const before = readSeen(file);
      const after = seenNow(root);
      writeSeen(file, after);
      const line = before ? sinceLine(before, after, root) : null;
      if (line) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: line } }));
      return;
    }
    // what this start shows is seen: the first prompt after it says nothing about it
    if (file) {
      try {
        writeSeen(file, seenNow(root));
      } catch {
        // a resume note comes first
      }
    }
    const rows = registryRows(readFileSync(join(root, REGISTRY), 'utf8'));
    const checkout = realpathSync(gitOut(dir, ['rev-parse', '--show-toplevel']));
    const text = resumeText(SOURCES.includes(input.source) ? input.source : 'startup', rows, root, readGrant(root), { checkout });
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
  } catch {
    // No registry, not a checkout, or anything else: a resume note must never break a session's start.
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
