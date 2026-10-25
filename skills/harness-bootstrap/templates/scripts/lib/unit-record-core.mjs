// harness-bootstrap unit-record core (generated YYYY-MM-DD). Pure core of scripts/unit-record.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- the auditor lane names, the gate summary line, the state-file section names and the
// record's commit cap, each re-derived from the project's own harness.
/**
 * Turns a unit's state file plus what git and the gate log already know into the unit's record
 * block. No I/O here, so `unit-record-core.test.mjs` can pin each rule.
 *
 * WHY GENERATED. The runner's step 8b record was written by hand; in one project records grew to
 * 58-81 KB of prose and a unit took four consecutive `FALSE CLAIMS` rounds from the claim auditor,
 * 75% of whose P1s were about record prose, not product code. A record generated from git, the gate
 * log and the state file is true by construction, so the claim audit can stay on product claims.
 */

// ---- [B] project bindings
// [B] The project's own auditor lanes: findings from these sources are not product defects.
export const AUDITOR_SOURCE = /conform|claim|lane-a|lane-c/i;
// [B] The one line the project's gate runner prints when it finishes (scripts/run-gates.sh).
export const SUMMARY_LINE = /^SUMMARY \d+ passed, \d+ failed, \d+ skipped.*$/gm;
// [B] The state file's table sections, matched case-insensitively on the `## ` heading.
export const LEDGER_HEADING = 'ledger';
export const FINDINGS_HEADING = 'findings';
// [B] How many commit lines a record lists before it says "... and k more".
export const MAX_COMMITS = 40;
// ---- end [B]

export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
export const STATUSES = ['open', 'fixed', 'follow-up', 'retracted'];

const SEVERITY_WORDS = { critical: 'P0', high: 'P1', medium: 'P2', low: 'P3' };
// Keys are matched with case, spaces, hyphens and underscores ignored (`Owner-wait` = `owner_wait`).
const HEADER_KEYS = {
  unit: 'unit',
  mode: 'mode',
  type: 'type',
  tier: 'tier',
  branch: 'branch',
  base: 'base',
  claimed: 'claimed',
  ownerwait: 'ownerWait',
};
const EMPTY_ALSO = new Set(['', '-', '—']);
const NO_SUMMARY = 'not run — no SUMMARY line found';
const MAX_OWNER_WAIT = 80;
const NO_CLAIMED = 'unknown — no Claimed: line in the state file';

/** Reject unknown flags and a missing --state before any file is read. */
export function parseArgs(argv) {
  const a = { state: null, base: null, gates: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--state' || t === '--base' || t === '--gates') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[t.slice(2)] = v;
    } else throw new Error(`unknown option ${t}`);
  }
  if (!a.state) throw new Error('--state <file> is required');
  return a;
}

/**
 * One markdown table row -> trimmed cells. A real cell splitter: `\|` is a literal pipe inside a
 * cell (never a split point) and is unescaped; the row's outer pipes do not make empty cells.
 */
export function splitRow(line) {
  const text = line.trim();
  const cells = [];
  let cur = '';
  let endedOnSeparator = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') {
      cur += '|';
      i++;
      endedOnSeparator = false;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      endedOnSeparator = true;
    } else {
      cur += ch;
      endedOnSeparator = false;
    }
  }
  if (!endedOnSeparator) cells.push(cur.trim());
  if (text.startsWith('|')) cells.shift();
  return cells;
}

/** `P0`-`P3`, or CRITICAL/HIGH/MEDIUM/LOW mapped to P0-P3; anything else is '' (not counted). */
export function normalizeSeverity(raw) {
  const m = /^(P[0-3]|CRITICAL|HIGH|MEDIUM|LOW)\b/i.exec(String(raw).trim());
  if (!m) return '';
  const key = m[1].toLowerCase();
  return SEVERITY_WORDS[key] ?? key.toUpperCase();
}

/** fixed | follow-up | retracted | open; anything unrecognised is open, never silently closed. */
export function normalizeStatus(raw) {
  const s = String(raw).trim().toLowerCase();
  if (/^fixed\b/.test(s)) return 'fixed';
  if (/^(follow-?up|out|deferred)\b/.test(s)) return 'follow-up';
  if (/^(retracted|rejected)\b/.test(s)) return 'retracted';
  return 'open';
}

/** A section's table rows -> a cell lookup by header name (case-insensitive), '' when absent. */
function tableRows(rows) {
  const body = rows.filter((r) => !(r.length > 0 && r.every((c) => /^:?-+:?$/.test(c))));
  if (body.length === 0) return [];
  const names = body[0].map((c) => c.toLowerCase());
  return body.slice(1).map((cells) => (...wanted) => {
    for (const name of wanted) {
      const i = names.indexOf(name);
      if (i !== -1) return cells[i] ?? '';
    }
    return '';
  });
}

/**
 * The state file -> header fields, ledger rows and findings. Header lines are `Key: value` before
 * the first `##`; only the ledger and findings sections are read, every other section is ignored.
 */
export function parseState(text) {
  const header = {
    unit: '',
    mode: '',
    type: '',
    tier: '',
    branch: '',
    base: '',
    claimed: '',
    ownerWait: '',
  };
  const raw = { [LEDGER_HEADING]: [], [FINDINGS_HEADING]: [] };
  let section = null;
  let inTable = false;
  let kvTable = false;
  let title = null;
  const setHeader = (name, value) => {
    const k = name.toLowerCase().replace(/[\s_-]/g, '');
    const key = Object.hasOwn(HEADER_KEYS, k) ? HEADER_KEYS[k] : undefined;
    if (key && header[key] === '') header[key] = value.trim().replace(/^`(.*)`$/, '$1');
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##(?!#)\s*(.*?)\s*$/.exec(line);
    if (heading) {
      section = heading[1].toLowerCase();
      continue;
    }
    if (section === null) {
      if (line.trim().startsWith('|')) {
        // A header table: its first row names the columns, and only a two-column one is key/value.
        const cells = splitRow(line);
        if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
        if (!inTable) {
          inTable = true;
          kvTable = cells.length === 2;
        } else if (kvTable && cells.length === 2) setHeader(cells[0], cells[1]);
        continue;
      }
      inTable = false;
      const kv = /^([A-Za-z][A-Za-z _-]*?):\s*(.*?)\s*$/.exec(line);
      if (kv) setHeader(kv[1], kv[2]);
      else if (title === null) {
        const h1 = /^# (\S+)/.exec(line);
        if (h1) title = h1[1];
      }
    } else if (Object.hasOwn(raw, section) && line.trim().startsWith('|')) {
      raw[section].push(splitRow(line));
    }
  }
  // No Unit key: the first `# ` heading's first token names it, if it looks like an id.
  if (header.unit === '' && title !== null && /[0-9-]/.test(title)) header.unit = title;
  const ledger = tableRows(raw[LEDGER_HEADING])
    .map((get) => ({ step: get('step'), status: get('status'), evidence: get('evidence') }))
    .filter((r) => r.step || r.status || r.evidence);
  const findings = tableRows(raw[FINDINGS_HEADING])
    .map((get) => ({
      id: get('id'),
      sev: normalizeSeverity(get('sev', 'severity')),
      source: get('source'),
      also: get('also')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => !EMPTY_ALSO.has(s)),
      status: normalizeStatus(get('status')),
    }))
    .filter((f) => f.id || f.source);
  return { header, ledger, findings };
}

/**
 * Counts for the record. `bySev` skips retracted findings; `byStatus` counts all of them;
 * `defects` is "P0/P1" among non-retracted findings an auditor lane did not raise; `yield` counts
 * UNIQUE valid findings per source (fixed or follow-up, no `also`, P0-P2).
 */
export function summarizeFindings(findings) {
  const bySev = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const byStatus = { open: 0, fixed: 0, 'follow-up': 0, retracted: 0 };
  const yielded = new Map();
  let p0 = 0;
  let p1 = 0;
  for (const f of findings) {
    if (f.status in byStatus) byStatus[f.status] += 1;
    if (f.status === 'retracted') continue;
    if (f.sev in bySev) bySev[f.sev] += 1;
    if (!AUDITOR_SOURCE.test(f.source)) {
      if (f.sev === 'P0') p0 += 1;
      if (f.sev === 'P1') p1 += 1;
    }
    if (
      (f.status === 'fixed' || f.status === 'follow-up') &&
      f.also.length === 0 &&
      ['P0', 'P1', 'P2'].includes(f.sev)
    ) {
      const source = f.source || 'unknown';
      if (!yielded.has(source)) yielded.set(source, { P0: 0, P1: 0, P2: 0 });
      yielded.get(source)[f.sev] += 1;
    }
  }
  return { bySev, byStatus, defects: `${p0}/${p1}`, yield: Object.fromEntries(yielded) };
}

/** "3h12m", "45m" under an hour; "unknown" for a missing, invalid or negative interval. */
export function formatElapsed(fromIso, toIso) {
  const at = (v) => (v === null || v === undefined || v === '' ? NaN : new Date(v).getTime());
  const ms = at(toIso) - at(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const minutes = Math.floor(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** The last gate summary line in a run-gates log or output, or null when none was printed. */
export function lastSummary(text) {
  const all = [...text.matchAll(SUMMARY_LINE)];
  return all.length ? all[all.length - 1][0].trim() : null;
}

const cell = (s) => String(s).replaceAll('|', '\\|');

/**
 * The record markdown. `commits` is [{sha, subject}], newest last. `base` and `head` default to the
 * state file's `Base:` and the newest commit; the wrapper passes the resolved ones (a `--base` flag
 * wins over the file). Every `<fill: ...>` cell is the session's to complete -- never invented here.
 */
export function buildRecord({ state, commits, diffstat, gatesSummary, now, base, head }) {
  const h = state.header;
  const sum = summarizeFindings(state.findings);
  const unit = h.unit || 'unit';
  const elapsed = h.claimed ? formatElapsed(h.claimed, now) : null;
  const sources = Object.entries(sum.yield);
  const yieldLine = sources.length
    ? sources.map(([s, y]) => `${s} P0/P1/P2 ${y.P0}/${y.P1}/${y.P2}`).join(' · ')
    : 'none';
  const yieldCompact = sources.length
    ? sources.map(([s, y]) => `${cell(s)} ${y.P0}/${y.P1}/${y.P2}`).join(' · ')
    : 'none';
  const shown = commits.slice(0, MAX_COMMITS).map((c) => `  - ${c.sha} ${c.subject}`);
  if (commits.length > MAX_COMMITS) shown.push(`  - … and ${commits.length - MAX_COMMITS} more`);
  const ledgerRows = state.ledger.length
    ? state.ledger.map((r) => `| ${cell(r.step)} | ${cell(r.status)} | ${cell(r.evidence)} |`)
    : ['| — | missing | no ## Ledger section |'];
  const s = sum.byStatus;
  const ownerWait =
    h.ownerWait.length > MAX_OWNER_WAIT ? `${h.ownerWait.slice(0, MAX_OWNER_WAIT)}…` : h.ownerWait || 'none recorded';
  const kind = [h.mode, h.type, h.tier].map((v) => cell(v || '?'));
  return [
    `## Record — ${unit} (generated by unit-record.mjs — regenerate, never edit by hand)`,
    '',
    `- Base: ${base || h.base || 'unknown'} · Head: ${head || commits.at(-1)?.sha || 'unknown'}`,
    `- Commits: ${commits.length}`,
    ...shown,
    `- Diffstat: ${diffstat.trim() || 'none'}`,
    `- Gates: ${gatesSummary ?? NO_SUMMARY}`,
    `- Findings: P0 ${sum.bySev.P0} · P1 ${sum.bySev.P1} · P2 ${sum.bySev.P2} · P3 ${sum.bySev.P3} (open ${s.open} · fixed ${s.fixed} · follow-up ${s['follow-up']} · retracted ${s.retracted})`,
    `- Yield by source: ${yieldLine}`,
    `- Elapsed: ${elapsed === null ? NO_CLAIMED : `${elapsed} since claim`} · owner wait ${ownerWait}`,
    '- Ledger:',
    '',
    '| Step | Status | Evidence |',
    '|---|---|---|',
    ...ledgerRows,
    '',
    'Draft log row:',
    `| ${cell(unit)} · ${kind.join(' · ')} | ${elapsed ?? 'unknown'} | ${sum.defects} | <fill: scope counts> | <fill: gates as decided> | <fill: verdicts> | <fill: retries> | <fill: models as dispatched> | <fill: missed by harness> | ${yieldCompact} | <fill: friction> |`,
    '',
  ].join('\n');
}
