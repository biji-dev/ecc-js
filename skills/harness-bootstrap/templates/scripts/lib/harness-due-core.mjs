// harness-bootstrap harness-due core (generated YYYY-MM-DD). Pure core of scripts/harness-due.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- the mainline, where the log, the follow-ups doc and each kind's reports live, the phase
// in a row id, the cadences, the limits and what each line tells the runner to run, each
// re-derived from the project.
/**
 * Due-checks: what the harness owes before the next unit -- a phase's preflight, a sweep, a retro,
 * a hygiene unit, free disk, finished worktrees, the week's proposals -- from the repository's
 * files and git alone. No I/O here (scripts/harness-due.mjs reads them), so
 * `harness-due-core.test.mjs` can pin each rule.
 *
 * WHY A CHECK. Preflights and sweeps ran 13 times in two projects and caught real problems -- a
 * warning four sweeps running that then failed a phase's entry, fifteen open decisions -- but each
 * ran because someone asked: the owner asked six times, two sweeps ran overdue ("the weekly cadence
 * is enforced by nothing mechanical"), and one project's note that a sweep was due lived in a
 * session's memory only. A check the runner runs at every claim and every landing is the trigger
 * those runs lacked.
 */
import path from 'node:path';
import { followUpsSummary, logRecords } from './retro-core.mjs';

// ---- [B] project bindings
// [B] The mainline; the harness log and the follow-ups doc. FOLLOW_UPS may also be a list of paths;
// an entry ending in `/*.md` is every markdown file in that directory, sorted by name.
export const MAIN = 'main';
export const LOG = 'docs/harness/log.md';
export const FOLLOW_UPS = 'docs/harness/follow-ups.md';
// [B] Each kind's committed reports. The file name carries `<phase>`, `<date>` (YYYY-MM-DD) or
// `<week>` (YYYY-Www); a kind the project does not run is null and is never due.
export const REPORTS = {
  preflight: 'docs/harness/reports/preflight-<phase>.md',
  sweep: 'docs/harness/reports/sweep-<date>.md',
  retro: 'docs/harness/reports/retro-<week>.md',
  hygiene: 'docs/harness/reports/hygiene-<date>.md',
};
// [B] The phase a row id belongs to: the first group. An id it does not match belongs to no
// phase (P2-16 -> P2, EP-27.04 -> EP-27; T-DATA-037 and CR-021 -> none).
export const PHASE_OF = /^([A-Za-z]+-?\d+)[-.]\w/;
// [B] A recurring report is due this many days after the newest one, or once this many units
// have landed since it (null: by days only). The log moves them.
export const CADENCE = {
  sweep: { days: 7, landings: 5 },
  retro: { days: 7, landings: null },
  hygiene: { days: 14, landings: 5 },
};
// [B] An open P3 older than this many days is named on the hygiene line; with no hygiene unit
// bound, it is due on its own.
export const P3_AGE_DAYS = 14;
// [B] Below this much free disk (GB), the approved machine-sweep categories run.
export const DISK_MIN_GB = 25;
// [B] A worktree merged into MAIN, with commits of its own, clean, and untouched this many hours
// is residue.
export const WORKTREE_IDLE_HOURS = 6;
// [B] The ignored paths such a worktree may still hold: rebuildable output and litter. Any other
// ignored file -- a key, a hand-written .env.local -- keeps it, because `git worktree remove`
// deletes ignored files without a word. A link never counts: removing one never touches what it
// points to.
export const REBUILDABLE = /(^|\/)(node_modules|dist|build|out|coverage|test-results|playwright-report|\.next|\.turbo|\.expo|\.vite|\.cache|\.husky\/_)\/?$|\.DS_Store$|\.tsbuildinfo$/;
// [B] What each line tells the runner to run; `<phase>`, `<date>`, `<file>`, `<week>` and
// `<paths>` are filled in.
export const COMMANDS = {
  preflight: 'run the phase preflight for <phase> (the phase-preflight skill); its escalations are Gate 1 cards',
  sweep: 'the next unit: harness/sweep-<date> (the workstream-sweep skill)',
  retro: 'the next unit: harness/retro-<date> (node scripts/retro.mjs, then commit the digest)',
  hygiene: 'the next unit: harness/hygiene-<date> (the task-runner › The hygiene unit)',
  p3: 'the next unit: harness/p3-batch-<date>, the hygiene unit\'s P3 batch alone (the task-runner › The hygiene unit)',
  disk: 'node ~/.agents/harness/machine-sweep/machine-sweep.mjs --apply-approved, in the background',
  worktrees: 'git worktree remove <paths>, each once no registry row names it',
  proposals: 'read <file>; route each proposal (T: a harness/<slug> unit, C: the next Gate 2 brief), then node scripts/harness-due.mjs --seen <week>',
};
// ---- end [B]

export const KINDS = ['preflight', 'sweep', 'retro', 'hygiene', 'p3', 'disk', 'worktrees', 'proposals'];
const DAY = 86_400_000;
const HOUR = 3_600_000;
const GB = 1e9;
// A row id names a branch's unit: plan ids, change slugs, harness/<slug>.
const ROW_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const WEEK_ID = /^\d{4}-W\d{2}$/;
const PLACEHOLDERS = { phase: '([A-Za-z]+-?\\d+)', date: '(\\d{4}-\\d{2}-\\d{2})', week: '(\\d{4}-W\\d{2})' };
const VALUE_FLAGS = { '--claim': 'claim', '--seen': 'seen', '--now': 'now', '--home': 'home' };
// A Projects line that names every project.
const EVERY = /\b(?:all|every|each)\b/i;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fill = (text, values) => Object.entries(values).reduce((t, [k, v]) => t.replaceAll(`<${k}>`, v), text);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Reject unknown flags, a bad id or week, and `--seen` with `--claim`, before anything is read. */
export function parseArgs(argv) {
  const a = { claim: null, seen: null, json: false, now: null, home: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t in VALUE_FLAGS) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[VALUE_FLAGS[t]] = v;
    } else throw new Error(t.startsWith('--') ? `unknown option ${t}` : `unexpected argument "${t}"`);
  }
  if (a.claim !== null && !ROW_ID.test(a.claim)) throw new Error(`bad row id "${a.claim}"`);
  if (a.seen !== null && !WEEK_ID.test(a.seen)) throw new Error(`--seen takes a week, YYYY-Www, not "${a.seen}"`);
  if (a.seen !== null && a.claim !== null) throw new Error('--seen records a week and checks nothing; run it without --claim');
  if (a.now !== null && Number.isNaN(Date.parse(a.now))) throw new Error(`--now is not an ISO time: ${a.now}`);
  return a;
}

/** The phase a row id belongs to (PHASE_OF's first group), or null. */
export function phaseOf(id, pattern = PHASE_OF) {
  return pattern.exec(String(id ?? '').trim())?.[1] ?? null;
}

/** A report template -> its directory, its placeholder and a file-name pattern whose group is the placeholder's value. */
export function reportShape(template) {
  const dir = path.posix.dirname(template);
  const base = path.posix.basename(template);
  if (/[<>]/.test(dir)) throw new Error(`a report's placeholder belongs in its file name: ${template}`);
  const keys = [...base.matchAll(/<(\w+)>/g)].map((m) => m[1]);
  if (keys.length !== 1 || !(keys[0] in PLACEHOLDERS)) throw new Error(`a report's file name carries one of <phase>, <date>, <week>: ${template}`);
  const [head, tail] = base.split(`<${keys[0]}>`);
  return { dir, key: keys[0], pattern: new RegExp(`^${esc(head)}${PLACEHOLDERS[keys[0]]}${esc(tail)}$`, 'i') };
}

/** The file names in a report's directory that are its reports, as { rel, value }. */
export function matchReports(template, names) {
  const { dir, pattern } = reportShape(template);
  return names.flatMap((name) => {
    const m = pattern.exec(name);
    return m ? [{ rel: path.posix.join(dir, name), value: m[1] }] : [];
  });
}

/**
 * The claimed row's phase preflight. It blocks the claim when the row opens its phase -- no log
 * row and no mainline merge names the phase yet -- and the phase has no report. A phase already
 * under way without one is named, never blocked: a stop mid-phase fixes nothing.
 */
export function preflightDue({ claim, reports = [], logIds = [], merges = [], template = REPORTS.preflight, pattern = PHASE_OF, command = COMMANDS.preflight }) {
  if (claim === null || template === null) return null;
  const phase = phaseOf(claim, pattern);
  if (phase === null) return null;
  const want = path.posix.basename(template).replace('<phase>', phase).toLowerCase();
  if (reports.some((r) => path.posix.basename(r.rel).toLowerCase() === want)) return null;
  const rel = template.replace('<phase>', phase);
  const rows = logIds.filter((id) => phaseOf(id, pattern)?.toLowerCase() === phase.toLowerCase()).length;
  const mention = new RegExp(`\\b${esc(phase)}[-.]\\w`, 'i');
  const merged = merges.filter((s) => mention.test(s)).length;
  const opens = rows === 0 && merged === 0;
  const why = opens
    ? `no report at ${rel}, and ${claim} opens the phase: the claim waits for it`
    : `no report at ${rel}, and the phase is under way (${plural(rows, 'log row')}, ${plural(merged, 'merge')})`;
  return { kind: 'preflight', subject: phase, why, command: fill(command, { phase }), blocking: opens };
}

/**
 * A recurring kind: due when its newest report is CADENCE days old, or CADENCE landings behind.
 * `reports` are { rel, time } (time: its last commit; a report no commit holds is never one); with none, the count
 * starts at `logBorn`, the log's first commit. A landing is a log row (`landed`, the commit time
 * of each row) or a mainline merge (`merged`, each merge's time), whichever counts more: a row the
 * log's table does not parse still merged.
 */
export function cadenceDue(kind, { reports = [], landed = [], merged = [], logBorn = null, now, cadence = CADENCE[kind], command = COMMANDS[kind], note = '' }) {
  const newest = reports.reduce((a, r) => (Number.isFinite(r.time) && (a === null || r.time > a.time) ? r : a), null);
  const from = newest?.time ?? logBorn;
  const values = { date: day(now) };
  if (!Number.isFinite(from)) {
    return { kind, subject: null, why: `no report yet, and no log to count from${note}`, command: fill(command, values), blocking: false };
  }
  const days = Math.floor((now - from) / DAY);
  const after = (times) => times.filter((t) => Number.isFinite(t) && t > from).length;
  const landings = Math.max(after(landed), after(merged));
  const byCount = cadence.landings !== null && landings >= cadence.landings;
  if (days < cadence.days && !byCount) return null;
  const since = newest ? `since ${path.posix.basename(newest.rel)}` : 'since the log began, and no report yet';
  return { kind, subject: null, why: `${days} d, ${plural(landings, 'landing')} ${since}${note}`, command: fill(command, values), blocking: false };
}

/** The oldest open P3 as `the oldest FU-3 at 20 d` (the row, when the summary knows it), or `the oldest 20 d`. */
const oldestP3 = (summary) => `the oldest ${summary.oldestOpenP3Row ? `${summary.oldestOpenP3Row} at ` : ''}${summary.oldestOpenP3Days} d`;

/** The follow-ups summary -> `; 12 open P3, the oldest FU-3 at 20 d` for the hygiene line, or ''. */
export function p3Note(summary) {
  if (!summary || summary.openP3 === 0) return '';
  const age = summary.oldestOpenP3Days === null ? '' : `, ${oldestP3(summary)}`;
  return `; ${summary.openP3} open P3${age}`;
}

/** With no hygiene unit bound, an open P3 older than P3_AGE_DAYS is due on its own. */
export function p3Due({ summary, hygieneBound = REPORTS.hygiene !== null, now, ageDays = P3_AGE_DAYS, command = COMMANDS.p3 }) {
  if (hygieneBound || !summary || summary.oldestOpenP3Days === null || summary.oldestOpenP3Days < ageDays) return null;
  return { kind: 'p3', subject: null, why: `${summary.openP3} open P3, ${oldestP3(summary)} (over ${ageDays})`, command: fill(command, { date: day(now) }), blocking: false };
}

/**
 * Free disk under DISK_MIN_GB: the approved machine-sweep categories run in the background. With
 * none approved the line says so -- approving one is the owner's, once. The last run's line, when
 * there is one, says what it freed.
 */
export function diskDue({ free, minGb = DISK_MIN_GB, approved = [], last = null, command = COMMANDS.disk }) {
  if (!Number.isFinite(free) || free >= minGb * GB) return null;
  const freed = last && Number.isFinite(last.freed) ? `; the last sweep (${String(last.t).slice(0, 10)}) freed ${(last.freed / GB).toFixed(1)} GB` : '';
  const why = `${(free / GB).toFixed(1)} GB free, under ${minGb}${freed}`;
  if (!approved.length) {
    return { kind: 'disk', subject: null, why: `${why}; no sweep category is approved`, command: 'the owner reads machine-sweep.mjs --report (the harness-bootstrap skill) and approves categories once', blocking: false };
  }
  return { kind: 'disk', subject: null, why: `${why}; approved: ${approved.join(', ')}`, command, blocking: false };
}

/** `git worktree list --porcelain` -> [{ path, head, branch, locked, prunable }], the main worktree first. */
export function parseWorktrees(text) {
  const out = [];
  for (const block of String(text ?? '').split(/\n\s*\n/)) {
    const w = { path: null, head: null, branch: null, bare: false, locked: false, prunable: false };
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ');
      const value = rest.join(' ');
      if (key === 'worktree') w.path = value;
      else if (key === 'HEAD') w.head = value;
      else if (key === 'branch') w.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'bare') w.bare = true;
      else if (key === 'locked') w.locked = true;
      else if (key === 'prunable') w.prunable = true;
    }
    if (w.path) out.push(w);
  }
  return out;
}

/**
 * The linked worktrees that are residue: merged into MAIN with commits of their own, no change
 * in them, no ignored file that is not REBUILDABLE, and untouched for WORKTREE_IDLE_HOURS. Each
 * comes with `merged`, `own`, `clean`, `ignored` (its ignored paths) and `active` (its last
 * activity, ms) as the CLI measured them; the main worktree, a locked one and a prunable one are
 * never residue. The rails are one project's, earned: a branch cut from the mainline and not yet
 * started is an ancestor of it too, hence `own`.
 */
export function worktreesDue({ worktrees = [], now, idleHours = WORKTREE_IDLE_HOURS, rebuildable = REBUILDABLE, top = null, command = COMMANDS.worktrees }) {
  const stale = worktrees
    .slice(1)
    .filter((w) => !w.bare && !w.locked && !w.prunable && w.merged && w.own && w.clean)
    .filter((w) => (w.ignored ?? []).every((p) => rebuildable.test(p)))
    .filter((w) => Number.isFinite(w.active) && now - w.active >= idleHours * HOUR);
  if (!stale.length) return null;
  const shown = stale.map((w) => (top && w.path.startsWith(`${top}/`) ? w.path.slice(top.length + 1) : w.path));
  const names = shown.length > 4 ? `${shown.slice(0, 4).join(', ')} and ${shown.length - 4} more` : shown.join(', ');
  return { kind: 'worktrees', subject: null, why: `${plural(stale.length, 'worktree')} merged into ${MAIN}, clean and idle over ${idleHours} h: ${names}`, command: fill(command, { paths: shown.join(' ') }), blocking: false };
}

/** The newest proposals file among `names` (`proposals-<YYYY-Www>.md`), as { name, week }, or null. */
export function newestProposals(names) {
  const weeks = names.flatMap((n) => {
    const m = /^proposals-(\d{4}-W\d{2})\.md$/.exec(n);
    return m ? [{ name: n, week: m[1] }] : [];
  });
  return weeks.sort((x, y) => (x.week < y.week ? 1 : -1))[0] ?? null;
}

/** The proposals that name `project` on their `- Projects:` line (or name every project), and how many there are. */
export function proposalCounts(text, project) {
  const word = new RegExp(`(?:^|[^A-Za-z0-9._-])${esc(project)}(?![A-Za-z0-9_-])`, 'i');
  let total = 0;
  let mine = 0;
  for (const section of String(text ?? '').split(/^(?=###\s+\d+\.)/m)) {
    if (!/^###\s+\d+\./.test(section)) continue;
    total += 1;
    const line = /^-\s*Projects:\s*(.*)$/im.exec(section)?.[1] ?? '';
    if (word.test(line) || EVERY.test(line)) mine += 1;
  }
  return { total, mine };
}

/** The newest week's proposals, while this project has not marked that week seen and one of them names it. */
export function proposalsDue({ newest, text, seen = {}, project, file, command = COMMANDS.proposals }) {
  if (!newest || !project) return null;
  const last = typeof seen[project] === 'string' ? seen[project] : '';
  if (last >= newest.week) return null;
  const { total, mine } = proposalCounts(text, project);
  if (mine === 0) return null;
  return { kind: 'proposals', subject: newest.week, why: `${mine} of ${plural(total, 'proposal')} name ${project}, unread`, command: fill(command, { file, week: newest.week }), blocking: false, tag: 'NEW' };
}

/** seen.json after `--seen <week>`: the project's week only moves forward. */
export function markSeen(seen, project, week) {
  const out = { ...(seen && typeof seen === 'object' && !Array.isArray(seen) ? seen : {}) };
  if (!(typeof out[project] === 'string' && out[project] >= week)) out[project] = week;
  return out;
}

/** The project's name: the weekly job's registry entry for the main checkout, else its directory's name. */
export function projectName(registry, mainTop) {
  const entry = Array.isArray(registry?.repos) ? registry.repos.find((r) => r && r.path === mainTop) : null;
  return entry?.project ?? path.basename(mainTop);
}

/**
 * Every check, in KINDS order, from what the CLI read: `log` and `followUps` as { text, dates }
 * (line -> commit ms) or null; `reports` by kind as [{ rel, time }]; `merges` the mainline's
 * merges as [{ t, subject }]; `disk` { free, approved, last }; `worktrees` measured; `proposals`
 * { newest, text, file }; `seen`; `project`. Nothing here reads a file.
 */
export function checkAll(f) {
  const now = f.now;
  const records = f.log ? logRecords(f.log.text, f.log.dates) : [];
  const logBorn = f.log ? [...f.log.dates.values()].reduce((a, t) => (Number.isFinite(t) && (a === null || t < a) ? t : a), null) : null;
  const landed = records.map((r) => r.landed);
  const merged = (f.merges ?? []).map((m) => m.t);
  const summary = f.followUps ? followUpsSummary(f.followUps.text, f.followUps.dates, now) : null;
  const reports = (kind) => f.reports?.[kind] ?? [];
  const items = [
    preflightDue({ claim: f.claim ?? null, reports: reports('preflight'), logIds: records.map((r) => r.id), merges: (f.merges ?? []).map((m) => m.subject) }),
    ...['sweep', 'retro', 'hygiene'].map((kind) =>
      REPORTS[kind] === null ? null : cadenceDue(kind, { reports: reports(kind), landed, merged, logBorn, now, note: kind === 'hygiene' ? p3Note(summary) : '' }),
    ),
    p3Due({ summary, now }),
    f.disk ? diskDue(f.disk) : null,
    worktreesDue({ worktrees: f.worktrees ?? [], now, top: f.top ?? null }),
    proposalsDue({ newest: f.proposals?.newest ?? null, text: f.proposals?.text ?? '', seen: f.seen ?? {}, project: f.project, file: f.proposals?.file ?? '' }),
  ];
  return items.filter(Boolean);
}

/** One line per item, `DUE <kind> [<subject>] — <why> — <command>` (`NEW` for proposals); or the all-clear. */
export function formatDue(items) {
  if (!items.length) return 'harness-due: nothing due\n';
  return items.map((i) => `${i.tag ?? 'DUE'} ${i.kind}${i.subject ? ` ${i.subject}` : ''} — ${i.why} — ${i.command}\n`).join('');
}
