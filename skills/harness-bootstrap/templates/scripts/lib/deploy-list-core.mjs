// harness-bootstrap deploy-list core (generated YYYY-MM-DD). Pure core of scripts/deploy-list.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- the trailer names of the land commit and the ledger kind of a post-merge audit, each
// re-derived from the project's own harness.
/**
 * The owner's checkpoint at a deploy: every land commit since what production runs whose message
 * carries a `Never-auto: <category>` trailer (unit-record.mjs --trailer writes it), with the unit, the
 * landing line, the cross-family review rows that read its content and the post-merge audit that read
 * it. No I/O here (scripts/deploy-list.mjs reads git and the ledgers), so `deploy-list-core.test.mjs`
 * can pin each rule.
 *
 * WHY A LIST. A never-auto product category (money, stored-data formats, dependency changes, shared
 * contracts and schemas, migrations) merges on a green gate and a cross-family review, no owner key per
 * merge. The owner reads that code once per deploy instead: the list names every such land since live,
 * what reviewed it, and the files to give one adversarial pass over the combined diff, before the deploy
 * is approved. A per-unit review never saw how two of these lands interact; the batch pass does.
 */
import { LANDING_KINDS } from './review-gate-core.mjs';
import { neverAutoCategories, neverAutoUnreadable } from './unit-record-core.mjs';

// ---- [B] project bindings
// [B] The trailer keys of a land commit's message, matched case-insensitively: the categories the unit
// touches, and the unit id (the subject names the unit when there is none).
export const NEVER_AUTO_KEY = 'never-auto';
export const UNIT_KEY = 'unit';
// [B] The ledger kinds that are a post-merge audit: a run of one of them whose tree is a land commit's
// or a later commit's read that land. No ledger kind a default runner writes matches it (codex-run and
// claude-run write the review kinds and `investigate`), so `audit:` reads `none recorded` until the install
// binds the kind its own post-merge audit is recorded under.
export const AUDIT_KIND = /audit|post-merge/i;
// ---- end [B]

// The review kinds whose rows count: the landing check's own (review-gate-core's LANDING_KINDS).
export const REVIEW_KINDS = LANDING_KINDS;

const DOT = '\u00b7';
const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TRAILER = /^([A-Za-z][A-Za-z0-9-]*)[ \t]*:[ \t]*(.*?)\s*$/;
const NOT_RECORDED = 'not recorded';
const NONE_RECORDED = 'none recorded';
const KEY_TEXT = 'Never-auto';

const short = (sha) => String(sha).slice(0, 12);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The ref pair of a run: `-`, an empty text or null is no production yet (everything since the root). */
export const isRoot = (live) => live === null || live === undefined || ['', '-'].includes(String(live).trim());

/**
 * `git log --format=%H%x00%T%x00%P%x00%B%x1e` output -> { commits: [{ sha, tree, parents, message }], unparsed },
 * in the order git printed. A record that does not hold the three ids is skipped and counted in `unparsed`
 * (a signature line git printed ahead of a record, with log.showSignature, is one); a blank record is none.
 */
export function parseLogChecked(text) {
  const out = [];
  let unparsed = 0;
  for (const record of String(text ?? '').split('\x1e')) {
    if (record.trim() === '') continue;
    const [sha, tree, parents, ...body] = record.replace(/^\s+/, '').split('\x00');
    if (!HEX.test(sha ?? '') || !HEX.test(tree ?? '')) {
      unparsed += 1;
      continue;
    }
    out.push({ sha, tree, parents: (parents ?? '').split(' ').filter(Boolean), message: body.join('\x00').replace(/\s+$/, '') });
  }
  return { commits: out, unparsed };
}

/** The commits of a log text (parseLogChecked's `commits`). */
export const parseLog = (text) => parseLogChecked(text).commits;

/** `WARN <n> log records did not parse` for n > 0, else null: git printed something the list cannot read, so lands may be missing. */
export const unparsedWarning = (n) => (n > 0 ? `WARN ${n} log records did not parse` : null);

const paragraphsOf = (message) => String(message ?? '').replace(/\r\n?/g, '\n').trim().split(/\n(?:[ \t]*\n)+/);

/**
 * One paragraph's lines as trailers, or null when any line is not `Key: value` (an indented line continues
 * the value before it). A paragraph whose every line is indented is read without the indent it shares: git
 * indents the commits a default squash message quotes by 4 spaces, trailers included. The same rule reads a
 * quoted block (a message that quotes a land commit, indented, in a body) as a land of its own: that lists
 * a land that did not happen, the safe direction for a list the owner reads before a deploy, so it is kept.
 */
function trailerBlock(paragraph) {
  const out = [];
  let lines = paragraph.split('\n');
  if (lines.every((l) => /^[ \t]+\S/.test(l))) {
    const indent = Math.min(...lines.map((l) => /^[ \t]*/.exec(l)[0].length));
    lines = lines.map((l) => l.slice(indent));
  }
  for (const line of lines) {
    const m = TRAILER.exec(line);
    if (m) out.push({ key: m[1], value: m[2] });
    else if (/^[ \t]+\S/.test(line) && out.length) out.at(-1).value = `${out.at(-1).value} ${line.trim()}`.trim();
    else return null;
  }
  return out;
}

/**
 * A commit message's trailers: those of every paragraph after the subject whose lines are all `Key: value`
 * (a message with one paragraph is a subject and has none). A land message that ends with the trailer
 * block, a blank line and `Co-Authored-By:` lines keeps both blocks. A paragraph with any prose line
 * holds none, so a `Never-auto:` line inside prose is not a trailer.
 */
export function parseTrailers(message) {
  return paragraphsOf(message)
    .slice(1)
    .flatMap((p) => trailerBlock(p) ?? []);
}

const STRAY_LINE = /^[ \t>*_`-]*never[-_ ]?auto[ \t*_`]*:/i;

/**
 * Whether a line of the message looks like a `Never-auto:` line (any case, an indent or a markdown prefix:
 * a bullet, bold, a quote, backticks; `_` or a space for the hyphen; spaces or markup before the colon) but is read as no trailer: more such lines than Never-auto trailers parsed
 * (a typo or a prose paragraph the list would miss).
 */
export function strayNeverAuto(message) {
  const lines = String(message ?? '').split(/\r?\n/).filter((l) => STRAY_LINE.test(l)).length;
  return lines > parseTrailers(message).filter((t) => t.key.toLowerCase() === NEVER_AUTO_KEY).length;
}

/** The never-auto categories of a message's trailers: every `Never-auto:` trailer, a comma list, each once, lower-cased. */
export function neverAutoOf(message) {
  const out = [];
  for (const t of parseTrailers(message)) {
    if (t.key.toLowerCase() !== NEVER_AUTO_KEY) continue;
    for (const c of neverAutoCategories(t.value)) if (!out.includes(c)) out.push(c);
  }
  return out;
}

const unitTrailer = (message) => parseTrailers(message).find((x) => x.key.toLowerCase() === UNIT_KEY && x.value)?.value ?? null;

/** The unit a land commit is for: its `Unit:` trailer, else its subject. */
export function unitOf(message) {
  return unitTrailer(message) ?? (oneLine(String(message ?? '').split('\n')[0]) || '?');
}

/** The message's `Landing:` line (the last one, anywhere in the message), or null. */
export function landingOf(message) {
  const lines = String(message ?? '').split(/\r?\n/).map((l) => /^\s*Landing:\s*(.*?)\s*$/i.exec(l)).filter((m) => m && m[1]);
  return lines.length ? lines.at(-1)[1] : null;
}

/**
 * The trees whose content a land commit's reviews read: the land commit's own and, for a merge, every
 * commit of the unit branch (reachable from the second parent, not from the first: `branchTrees`); for
 * any other commit, its parent's (`parentTree`), the content before it.
 */
export function reviewTrees(commit, { branchTrees = [], parentTree = null } = {}) {
  const trees = new Set([commit.tree]);
  if (commit.parents.length > 1) for (const t of branchTrees) trees.add(t);
  else if (parentTree) trees.add(parentTree);
  return trees;
}

/** The ledger rows of a review kind whose recorded `tree` is one of `trees`, oldest first. */
export function reviewRows(rows, trees) {
  return rows.filter((r) => r && REVIEW_KINDS.includes(r.kind) && HEX.test(r.tree ?? '') && trees.has(r.tree)).sort(byTime);
}

/** The post-merge audit that read content in `trees` (an ok run of an AUDIT_KIND): the newest row, or null. */
export function auditRow(rows, trees) {
  return rows.filter((r) => r && AUDIT_KIND.test(String(r.kind ?? '')) && r.outcome === 'ok' && HEX.test(r.tree ?? '') && trees.has(r.tree)).sort(byTime).at(-1) ?? null;
}

const byTime = (a, b) => {
  const x = Date.parse(a.at);
  const y = Date.parse(b.at);
  return (Number.isFinite(x) ? x : 0) - (Number.isFinite(y) ? y : 0);
};

/** A row's P0 and P1 counts as the row records them (`counts` from its verdict, else `p0` and `p1`), or null for none. */
export function countsOf(row) {
  const c = row?.counts;
  if (c && Number.isFinite(c.P0) && Number.isFinite(c.P1)) return { P0: c.P0, P1: c.P1 };
  const p0 = row?.p0 ?? row?.P0;
  const p1 = row?.p1 ?? row?.P1;
  return Number.isFinite(p0) && Number.isFinite(p1) ? { P0: p0, P1: p1 } : null;
}

/**
 * The lands a first-parent commit carries: [{ unit, categories, carrier, landing }], newest first. The
 * runner puts `Unit:` and `Never-auto:` on the land commit of the unit branch and merges it with a message
 * that has none, so for a merge `branch` (the commits reachable from its second parent and not its first,
 * newest first) is read too, after the merge's own message; a plain commit reads only itself. Each unit is
 * one land: its categories are those of every commit of the unit that names one, newest first, each once
 * (a `Never-auto: none` commit names none and adds none, and a unit with no category is no land), `carrier`
 * is the first commit that names one, and `landing` the first `Landing:` line any commit of the unit has
 * (null for none). A commit with no `Unit:` trailer takes the merge's, else its own subject.
 */
export function landsOf(commit, branch = []) {
  const carriers = commit.parents.length > 1 ? [commit, ...branch] : [commit];
  const lands = new Map();
  const landings = new Map();
  for (const carrier of carriers) {
    const unit = unitTrailer(carrier.message) ?? unitTrailer(commit.message) ?? unitOf(carrier.message);
    landings.set(unit, landings.get(unit) ?? landingOf(carrier.message));
    const categories = neverAutoOf(carrier.message);
    if (categories.length === 0) continue;
    const land = lands.get(unit);
    if (!land) lands.set(unit, { unit, categories, carrier });
    else for (const c of categories) if (!land.categories.includes(c)) land.categories.push(c);
  }
  return [...lands.values()].map((land) => ({ ...land, landing: landings.get(land.unit) }));
}

/**
 * `WARN <sha12> has a Never-auto: line outside a trailer block`, for each commit read (a merge's branch
 * commits too) that has one; then `WARN <sha12> has a Never-auto: value that names no category`, for each
 * commit read with a `Never-auto:` trailer whose value is there but names no category and is not none
 * (`(money)`); then `WARN <sha12> land is not a merge: its critical paths cover that commit
 * only`, for each first-parent commit that is no merge and carries a land (a fast-forward or squash land:
 * the files listed are that commit's, not the unit's earlier commits').
 */
export function warningsOf(commits, extra = {}) {
  const stray = commits.flatMap((commit) =>
    [commit, ...(commit.parents.length > 1 ? (extra[commit.sha]?.branch ?? []) : [])]
      .filter((c) => strayNeverAuto(c.message))
      .map((c) => `WARN ${short(c.sha)} has a ${KEY_TEXT}: line outside a trailer block`),
  );
  const unreadable = commits.flatMap((commit) =>
    [commit, ...(commit.parents.length > 1 ? (extra[commit.sha]?.branch ?? []) : [])]
      .filter((c) => parseTrailers(c.message).some((t) => t.key.toLowerCase() === NEVER_AUTO_KEY && neverAutoUnreadable(t.value)))
      .map((c) => `WARN ${short(c.sha)} has a ${KEY_TEXT}: value that names no category`),
  );
  const flat = commits
    .filter((c) => c.parents.length <= 1 && landsOf(c).length > 0)
    .map((c) => `WARN ${short(c.sha)} land is not a merge: its critical paths cover that commit only`);
  return [...stray, ...unreadable, ...flat];
}

/**
 * The deploy list's entries from the range's first-parent commits, oldest first (`commits`), their
 * facts (`extra[sha]`: { branch, parentTree, files }, `branch` being a merge's own commits, newest first)
 * and the ledger rows: one entry per land (landsOf) -> [{ commit, carrier, unit, categories, landing,
 * reviews, audit, files }], `commit` the first-parent commit and `carrier` the one whose message names
 * the categories. `audit` is { row, sha } where `sha` is the commit whose tree it read, or null.
 */
export function listEntries(commits, extra, rows) {
  const entries = [];
  commits.forEach((commit, i) => {
    const facts = extra[commit.sha] ?? {};
    const lands = landsOf(commit, facts.branch ?? []);
    if (lands.length === 0) return;
    const later = commits.slice(i);
    const row = auditRow(rows, new Set(later.map((c) => c.tree)));
    const reviews = reviewRows(rows, reviewTrees(commit, { branchTrees: (facts.branch ?? []).map((c) => c.tree), parentTree: facts.parentTree }));
    for (const land of lands) {
      entries.push({
        commit,
        carrier: land.carrier,
        unit: land.unit,
        categories: land.categories,
        landing: land.landing ?? landingOf(commit.message),
        reviews,
        audit: row ? { row, sha: later.find((c) => c.tree === row.tree).sha } : null,
        files: facts.files ?? [],
      });
    }
  });
  return entries;
}

/** A path as one shell word: left as it is when plain, else single-quoted. */
export function shellWord(p) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : `'${p.replaceAll("'", "'\\''")}'`;
}

/** The union of the entries' files, sorted. */
export function criticalPaths(entries) {
  return [...new Set(entries.flatMap((e) => e.files))].sort();
}

/** One review row as its line: `  review <kind> <model>/<family> P0=<n> P1=<n> <dot> <outcome>`; `?` for a count the row does not record. */
export function reviewLine(row) {
  const c = countsOf(row);
  const who = `${row.model ?? '?'}/${row.family ?? '?'}`;
  return `  review ${row.kind} ${who} P0=${c ? c.P0 : '?'} P1=${c ? c.P1 : '?'} ${DOT} ${row.outcome ?? '?'}`;
}

/** One entry as its block of lines. */
export function formatEntry(e) {
  return [
    `NEVER-AUTO ${short(e.commit.sha)} ${e.unit} ${DOT} ${e.categories.join(', ')}`,
    `  landing: ${e.landing ?? NOT_RECORDED}`,
    ...(e.reviews.length ? e.reviews.map(reviewLine) : [`  review: ${NONE_RECORDED}`]),
    `  audit: ${e.audit ? `${e.audit.row.kind} ${short(e.audit.sha)}` : NONE_RECORDED}`,
  ];
}

/**
 * The whole report: each entry's block, `DEPLOY LIST <n> never-auto lands in <live12|root>..<sha12>`
 * and, when n > 0, the `CRITICAL PATHS` line with the diff to read. `live` is the resolved live commit
 * (null: root), `sha` the resolved head, `root` the full hash of the tree a diff from the root starts at,
 * `warnings` lines printed before the count line.
 */
export function formatList(entries, { live = null, sha, root, warnings = [] }) {
  const from = isRoot(live) ? 'root' : short(live);
  const lines = [...entries.flatMap(formatEntry), ...warnings];
  lines.push(`DEPLOY LIST ${entries.length} never-auto lands in ${from}..${short(sha)}`);
  if (entries.length > 0) {
    const paths = criticalPaths(entries);
    // the empty tree whole: git refuses it shortened
    const range = `${isRoot(live) ? root : short(live)}..${short(sha)}`;
    lines.push(
      paths.length
        ? `CRITICAL PATHS ${paths.length} files: run one adversarial pass over git diff ${range} -- ${paths.map(shellWord).join(' ')}`
        : 'CRITICAL PATHS 0 files: the lands changed no file',
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Positional arguments -> { live, sha }; `--help` is the CLI's. Rejects an option, no live and a third argument. */
export function parseArgs(argv) {
  const pos = [];
  for (const t of argv) {
    if (t.startsWith('-') && t !== '-') throw new Error(`unknown option ${t}`);
    pos.push(t);
  }
  if (pos.length === 0) throw new Error('<live-sha> is required (use - when nothing is live yet)');
  if (pos.length > 2) throw new Error(`unexpected argument ${pos[2]}`);
  return { live: pos[0], sha: pos[1] ?? 'HEAD' };
}
