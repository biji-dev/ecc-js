// harness-bootstrap intake core (generated YYYY-MM-DD). Pure core of scripts/intake.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- the words that mark a question this project's documents leave open.
/**
 * Feature intake (harness-bootstrap's reference/intake.md): checks a drafted request for the properties the owner
 * sheet needs, whatever the project's own shape -- each deliverable's Demo: line, every P and C
 * decision as a card, the Never-auto: and Risk map: lines, the Estimate: line, unit 1's Scope
 * block -- and decides unit 1's Gate 1 from the request's Approved: line. No I/O here
 * (scripts/intake.mjs reads the files), so `intake-core.test.mjs` can pin each rule.
 *
 * WHY. One change request that started without its decisions up front added 16 open questions
 * mid-flow, over five owner rounds; one 45.7-hour stop had three of them waiting on the owner.
 * The sheet answers them before the first unit is claimed, and the request it approved and its
 * Scope block are both hashed, so "unchanged" is a comparison and never a judgement.
 */
import crypto from 'node:crypto';

// ---- [B] project bindings
// [B] Words that mark a question left open outside a card: every P and C decision is a card on the
// sheet, so a question left as a word is asked mid-flow later.
export const STRAY = /\bTBD\b|\?\?|\bto be decided\b/i;
// ---- end [B]

// The Scope block's labels (harness-bootstrap's reference/scope-guard.md), in the order the hash reads them.
export const LABELS = ['In scope', 'Out of scope', 'Done when', 'Must not', 'Verification plan'];
const REQUIRED = LABELS.slice(0, 3);
const PREFIX = String.raw`^\s*(?:>\s*)?(?:[-*]\s+)?`;
const LABEL_RE = new RegExp(`${PREFIX}(${LABELS.join('|')}):\\s*(.*)$`, 'i');
const CARD_RE = /^\s*(?:[-*]\s+)?([A-Za-z][\w./-]*) · ([A-Z]) · (\S.*?)\s*$/;
const OPTION_RE = /^\s*(?:[-*]\s+)?[A-H](?:[.)]|\s)\s*\S/;
const line = (label) => new RegExp(`${PREFIX}${label}:\\s*(\\S.*?)\\s*$`, 'i');
const RECOMMEND = line('Recommend');
const DEFAULT = line('Default if unanswered');
// `Estimate: <line>`, or estimate.mjs's own line pasted as-is.
const ESTIMATE = new RegExp(`${PREFIX}(?:Estimate:\\s*|(?=Estimate per unit\\b))(\\S.*?)\\s*$`, 'i');
const NEVER_AUTO = line('Never-auto');
const RISK_MAP = line('Risk map');
const APPROVED = line('Approved');
const DEMO = /\bDemo:\s+\S/;
const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^\s*#{1,6}\s/;
// The request's title: one `#`, never a section heading.
const TITLE = /^\s*#\s/;
const VALUE_FLAGS = { '--check': 'check', '--gate1': 'gate1', '--state': 'state' };

const canonical = (label) => LABELS.find((l) => l.toLowerCase() === label.toLowerCase());
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sha8 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);

/** `--check <request>` or `--gate1 <request> --state <state file>`, and `--json`; anything else is an error. */
export function parseArgs(argv) {
  const out = { mode: null, request: null, state: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--json') {
      out.json = true;
      continue;
    }
    const key = VALUE_FLAGS[flag];
    if (!key) return { error: `unknown argument ${flag}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value` };
    i += 1;
    if (key === 'state') {
      out.state = value;
      continue;
    }
    if (out.mode) return { error: 'give one of --check and --gate1' };
    out.mode = key;
    out.request = value;
  }
  if (!out.mode) return { error: 'give --check <request> or --gate1 <request> --state <state file>' };
  if (out.mode === 'gate1' && !out.state) return { error: '--gate1 needs --state <state file>' };
  if (out.mode === 'check' && out.state) return { error: '--state goes with --gate1 only' };
  return out;
}

/**
 * The first Scope block: from its `In scope:` line through the labelled lines that follow, a wrapped
 * line joining the label above it. A blank line ends it unless a label comes next; a heading, a
 * fence, an unlabelled paragraph or a label seen twice (the next unit's block) ends it too.
 * `hash` is the first 8 hex of the sha256 of its lines in LABELS order, whitespace squashed.
 * `missing` names a required label that is absent, `empty` one present with nothing after it.
 */
export function scopeBlock(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const m = l.match(LABEL_RE);
    return m && canonical(m[1]) === 'In scope';
  });
  if (start === -1) return null;
  const fields = new Map();
  let current = null;
  for (let i = start; i < lines.length; i += 1) {
    const l = lines[i];
    const m = l.match(LABEL_RE);
    if (m) {
      const label = canonical(m[1]);
      if (fields.has(label)) break;
      fields.set(label, m[2]);
      current = label;
      continue;
    }
    if (!l.trim()) {
      const next = lines.slice(i + 1).find((x) => x.trim());
      if (next && LABEL_RE.test(next)) continue;
      break;
    }
    if (FENCE.test(l) || HEADING.test(l) || !current) break;
    fields.set(current, `${fields.get(current)} ${l.replace(/^\s*>?\s*/, '')}`);
  }
  const ordered = LABELS.filter((l) => fields.has(l)).map((l) => `${l}: ${squash(fields.get(l))}`);
  return {
    line: start + 1,
    fields: Object.fromEntries(LABELS.filter((l) => fields.has(l)).map((l) => [l, squash(fields.get(l))])),
    missing: REQUIRED.filter((l) => !fields.has(l)),
    empty: REQUIRED.filter((l) => fields.has(l) && !squash(fields.get(l))),
    hash: sha8(ordered.join('\n')),
  };
}

/** The cards, and the 0-based index of every line a card covers: its own line and its body. */
function readCards(text) {
  const cards = [];
  const covered = new Set();
  let card = null;
  for (const [i, l] of String(text ?? '').split(/\r?\n/).entries()) {
    const m = l.match(CARD_RE);
    if (m) {
      card = { id: m[1], cls: m[2], question: m[3], line: i + 1, recommend: false, options: 0, dflt: false };
      cards.push(card);
      covered.add(i);
      continue;
    }
    if (!card) continue;
    if (FENCE.test(l) || HEADING.test(l)) {
      card = null;
      continue;
    }
    covered.add(i);
    if (RECOMMEND.test(l)) card.recommend = true;
    else if (DEFAULT.test(l)) card.dflt = true;
    else if (OPTION_RE.test(l)) card.options += 1;
  }
  return { cards, covered };
}

/** Decision cards (harness-bootstrap's reference/gate-design.md › Who decides): `<id> · <class> · <question>`, then its body up to the next card, heading or fence. */
export function parseCards(text) {
  return readCards(text).cards;
}

/** The capture's line indexes: the first blockquote, the draft's first content after at most one `#` title line. */
function captureLines(lines) {
  const out = new Set();
  let i = 0;
  const blanks = () => {
    while (i < lines.length && !lines[i].trim()) i += 1;
  };
  blanks();
  if (i < lines.length && TITLE.test(lines[i])) {
    i += 1;
    blanks();
  }
  for (; i < lines.length && /^\s*>/.test(lines[i]); i += 1) out.add(i);
  return out;
}

/**
 * The request's sha: the first 8 hex of the sha256 of its lines, trailing whitespace and trailing
 * blank lines dropped, Approved: lines left out -- so writing the approval never moves it, and
 * any other edit does.
 */
export function requestHash(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => !APPROVED.test(l));
  while (lines.length > 0 && !lines.at(-1)) lines.pop();
  return sha8(lines.join('\n'));
}

/** `[reason]` when the request is not the one approved, else `[]`; an approval with no request sha moves nothing here. */
function requestMoved(a, text) {
  const now = requestHash(text);
  return a.request && now !== a.request ? [`the request changed since the approval (approved ${a.request}, now ${now})`] : [];
}

/** The last `Approved: <date> · <by> · [<ref>] · unit <id> · tier <tier> · scope <sha> · request <sha>` line, or null. */
export function parseApproval(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => APPROVED.test(l));
  if (lines.length === 0) return null;
  const fields = lines.at(-1).match(APPROVED)[1].split('·').map((f) => f.trim());
  const named = (word) => fields.find((f) => f.startsWith(`${word} `))?.slice(word.length + 1).trim() || null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(fields[0]) ? fields[0] : null;
  const by = fields[1] && !/^(unit|tier|scope|request) /.test(fields[1]) ? fields[1] : null;
  const scope = named('scope');
  const request = named('request');
  const out = {
    date,
    by,
    ref: fields.find((f) => /\bDEC-\d+\b/.test(f)) ?? null,
    unit: named('unit'),
    tier: named('tier'),
    scope: scope && /^[0-9a-f]{8}$/.test(scope) ? scope : null,
    request: request && /^[0-9a-f]{8}$/.test(request) ? request : null,
  };
  out.lacks = ['date', 'by', 'unit', 'tier', 'scope', 'request'].filter((k) => !out[k]);
  return out;
}

/** A problem line for each card used twice, of a class the owner is never asked, or missing a part. */
function cardProblems(cards) {
  const problems = [];
  const seen = new Set();
  for (const c of cards) {
    if (seen.has(c.id)) problems.push(`card ${c.id} appears twice`);
    seen.add(c.id);
    if (c.cls !== 'P' && c.cls !== 'C') {
      problems.push(`card ${c.id}: class ${c.cls} — only P and C reach the owner: a T decision is decided and listed under Decided, an H one never asked`);
      continue;
    }
    if (!c.recommend) problems.push(`card ${c.id}: no Recommend: line`);
    if (c.options < 2) problems.push(`card ${c.id}: ${plural(c.options, 'option')}, a card offers two or three`);
    if (!c.dflt) problems.push(`card ${c.id}: no Default if unanswered: line`);
  }
  return problems;
}

/** Every property the owner sheet needs, and a problem line for each one missing. */
export function checkRequest(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const problems = [];
  const value = (re) => lines.map((l) => l.match(re)).find(Boolean)?.[1] ?? null;
  const deliverables = lines.flatMap((l, i) => (DEMO.test(l) ? [{ line: i + 1, text: l.trim() }] : []));
  if (deliverables.length === 0) problems.push('no deliverable has a Demo: line — each deliverable names what the owner opens, does and sees');
  const { cards, covered } = readCards(text);
  problems.push(...cardProblems(cards));
  // The capture is the owner's words verbatim, and a card is where an open question belongs.
  const capture = captureLines(lines);
  lines.forEach((l, i) => {
    if (capture.has(i) || covered.has(i)) return;
    if (STRAY.test(l)) problems.push(`line ${i + 1}: an open question outside a card — ${l.trim()}`);
  });
  const estimate = value(ESTIMATE);
  if (!estimate) problems.push('no Estimate: line — paste the line node scripts/estimate.mjs prints');
  const neverAuto = value(NEVER_AUTO);
  if (!neverAuto) problems.push('no Never-auto: line — the categories the request hits, or none');
  const riskMap = value(RISK_MAP);
  if (!riskMap) problems.push('no Risk map: line — the critical or hot modules it touches, or none');
  const scope = scopeBlock(text);
  if (!scope) problems.push('no Scope block — unit 1 needs In scope:, Out of scope: and Done when: lines');
  else {
    for (const l of scope.missing) problems.push(`unit 1's Scope block lacks ${l}:`);
    for (const l of scope.empty) problems.push(`unit 1's Scope block has an empty ${l}: line`);
  }
  const request = requestHash(text);
  let approval = parseApproval(text);
  if (approval) {
    for (const k of approval.lacks) problems.push(`the Approved: line lacks ${k}`);
    const scopeSame = Boolean(scope && approval.scope === scope.hash);
    approval = { ...approval, unchanged: scopeSame && approval.request === request };
    if (scope && approval.scope && !scopeSame) {
      problems.push(`unit 1's Scope block changed since the approval (approved ${approval.scope}, now ${scope.hash}): the sheet re-opens`);
    }
    problems.push(...requestMoved(approval, text).map((p) => `${p}: the sheet re-opens`));
  }
  return { deliverables, cards, estimate, neverAuto, riskMap, scope, request, approval, problems };
}

/** How the approval compares: a sha it carries that differs is a change; a sha it lacks cannot be compared. */
function since(a, r) {
  const scopeMoved = a.scope && (!r.scope || a.scope !== r.scope.hash);
  if (scopeMoved || (a.request && a.request !== r.request)) return 'changed since the approval';
  const lacks = ['scope', 'request'].filter((k) => !a[k]);
  if (lacks.length > 0) return `cannot tell whether it changed: the Approved: line lacks ${lacks.join(', ')}`;
  return 'the request and its Scope block are unchanged';
}

/** The --check report: one line per property, then `intake: ready for the owner sheet`, `intake: approved` or the problem count. */
export function formatCheck(r, file) {
  const out = [`intake: ${file}`];
  out.push(`deliverables ${r.deliverables.length} — each named by its Demo: line`);
  const asked = r.cards.filter((c) => c.cls === 'P' || c.cls === 'C');
  const count = (cls) => asked.filter((c) => c.cls === cls).length;
  out.push(
    asked.length === 0
      ? 'cards 0 — the draft asks the owner nothing'
      : `cards ${asked.length} — P ${count('P')} · C ${count('C')}; each with a recommendation, its options and a default`,
  );
  out.push(`estimate — ${r.estimate ?? 'none'}`);
  out.push(`never-auto — ${r.neverAuto ?? 'none written'} · risk map — ${r.riskMap ?? 'none written'}`);
  if (r.scope) out.push(`scope 1 — ${Object.keys(r.scope.fields).join(' · ')} · sha ${r.scope.hash}`);
  out.push(`request — sha ${r.request}`);
  const a = r.approval;
  if (!a) out.push('approval — none yet: the owner sheet approves it');
  else {
    const ref = a.ref ? ` (${a.ref})` : '';
    out.push(`approval — ${a.date ?? '?'} by ${a.by ?? '?'}${ref} for ${a.unit ?? '?'} at ${a.tier ?? '?'}; ${since(a, r)}`);
  }
  for (const p of r.problems) out.push(`PROBLEM ${p}`);
  if (r.problems.length > 0) out.push(`intake: ${plural(r.problems.length, 'problem')} — not ready for the owner sheet`);
  else out.push(a ? 'intake: approved' : 'intake: ready for the owner sheet');
  return `${out.join('\n')}\n`;
}

/** The state file's `Key: value` header lines, before its first `##`. */
function header(text) {
  const out = {};
  for (const l of String(text ?? '').split(/\r?\n/)) {
    if (l.startsWith('##')) break;
    const m = l.match(/^([A-Za-z][\w ]*):\s*(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

/** The state file's `## Scope` section, else the whole file. */
function stateScope(text) {
  const t = String(text ?? '');
  const at = t.search(/^##\s+Scope\b/m);
  if (at === -1) return scopeBlock(t);
  const rest = t.slice(at).split(/\r?\n/).slice(1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return scopeBlock((end === -1 ? rest : rest.slice(0, end)).join('\n'));
}

/**
 * Unit 1's Gate 1: auto only when the owner approved the request, the request and its Scope block
 * are the ones approved, and the claim is that unit, at that tier, with that block -- any change
 * re-opens it.
 */
export function gate1(requestText, stateText, file) {
  const a = parseApproval(requestText);
  const req = scopeBlock(requestText);
  const st = header(stateText);
  const own = stateScope(stateText);
  const reasons = [];
  if (!a) reasons.push('the request carries no Approved: line — the owner sheet has not approved it');
  else {
    if (a.by !== 'owner') reasons.push(`approved by ${a.by ?? 'nobody'}, not the owner — an unanswered sheet is park-and-carry, never consent`);
    if (a.lacks.length > 0) reasons.push(`the Approved: line lacks ${a.lacks.join(', ')}`);
    if (!req) reasons.push('the request has no Scope block for unit 1');
    else if (a.scope && req.hash !== a.scope) reasons.push(`the request's Scope block changed since the approval (approved ${a.scope}, now ${req.hash})`);
    reasons.push(...requestMoved(a, requestText));
    if (a.unit && st.Unit !== a.unit) reasons.push(`the approval covers ${a.unit}, this claim is ${st.Unit || 'a state file with no Unit: line'}`);
    if (a.tier && (st.Tier ?? '').toLowerCase() !== a.tier.toLowerCase()) reasons.push(`the tier is ${st.Tier || 'unstated'}, approved at ${a.tier}: a re-tier re-asks`);
    if (!own) reasons.push('the state file has no Scope block');
    else if (a.scope && own.hash !== a.scope) reasons.push(`the unit's Scope block differs from the approved one (approved ${a.scope}, state file ${own.hash})`);
  }
  if (reasons.length > 0) return { auto: false, reasons, line: `Gate 1: owner — ${reasons.join('; ')}` };
  const ref = a.ref ? ` (${a.ref})` : '';
  return {
    auto: true,
    reasons,
    line: `Gate 1: auto — ${file} approved ${a.date} by the owner${ref} for ${a.unit} at ${a.tier}; the request and its Scope block are unchanged (request ${a.request}, scope ${a.scope})`,
  };
}
