// harness-bootstrap harness-host core (generated YYYY-MM-DD). Pure core of scripts/harness-host.mjs.
// [M] mechanism (ships as-is): everything below the [B] block. [B] binding: the block right
// below -- where the models file lives, each family's login check and each family's wrapper.
/**
 * Which host runs this session, which model each role takes there, and what stands in the way:
 * an effort above high, a second family that cannot run, no models for the host. No I/O here
 * (scripts/harness-host.mjs reads the environment, the files and the login checks), so
 * `harness-host-core.test.mjs` can pin each rule.
 *
 * WHY A CHECK. The role table named Claude Code's models only, and nothing said which host a
 * session ran on, so under Codex or ZCode the runner read "Opus" and "Sonnet" for models that
 * host does not have. Measured on one machine: Codex started every session at xhigh (its
 * config.toml), and a Codex run started from a Claude Code shell still carried CLAUDECODE, so a
 * check of that one variable names the wrong host.
 */

// ---- [B] project bindings
// [B] The models file Phase C generates for the hosts the project runs (harness-bootstrap's
// reference/gate-design.md › Model and effort).
export const MODELS_FILE = '.agents/harness-models.json';
// [B] Each family's login check. `codex login status` exits 0 when logged in; `claude auth
// status` prints JSON with `loggedIn`.
export const LOGIN = {
  codex: { command: 'codex', args: ['login', 'status'] },
  claude: { command: 'claude', args: ['auth', 'status'] },
};
// [B] The wrapper each family runs through, relative to the repository.
export const WRAPPERS = { codex: 'scripts/codex-run.mjs', claude: 'scripts/claude-run.mjs' };
// ---- end [B]

export const HOSTS = ['claude', 'codex', 'zcode', 'kimi'];
// The family a host's own models belong to: its second family is never this one.
const FAMILY_OF = { claude: 'claude', codex: 'codex', zcode: 'glm', kimi: 'kimi' };
const FAMILIES = Object.keys(LOGIN);
const ABOVE_HIGH = /^(xhigh|max|ultra)$/i;
const VALUE_FLAGS = { '--repo': 'repo' };

export function parseArgs(argv) {
  const a = { json: false, repo: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t in VALUE_FLAGS) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
      a[VALUE_FLAGS[t]] = v;
    } else throw new Error(t.startsWith('--') ? `unknown option ${t}` : `unexpected argument "${t}"`);
  }
  return a;
}

/**
 * The host, and the variable that named it. HARNESS_HOST is the owner's word; ZCode sets
 * CLAUDE_* variables too, so it goes before Claude Code; a host started from another inherits
 * the outer one's variables, so the inner host's own go first.
 */
export function detectHost(env) {
  const set = (k) => typeof env[k] === 'string' && env[k] !== '';
  if (set('HARNESS_HOST')) {
    const host = env.HARNESS_HOST.toLowerCase();
    if (!HOSTS.includes(host)) throw new Error(`HARNESS_HOST must be one of ${HOSTS.join(', ')}, not "${env.HARNESS_HOST}"`);
    return { host, by: 'HARNESS_HOST' };
  }
  const zcode = Object.keys(env).sort().find((k) => k.startsWith('ZCODE_') && set(k));
  if (zcode) return { host: 'zcode', by: zcode };
  for (const k of ['CODEX_THREAD_ID', 'CODEX_SANDBOX']) if (set(k)) return { host: 'codex', by: k };
  if (set('CLAUDECODE')) return { host: 'claude', by: 'CLAUDECODE' };
  return { host: 'unknown', by: '' };
}

function role(host, entry, key) {
  const r = entry?.[key];
  if (!r || typeof r.model !== 'string' || !r.model.trim()) throw new Error(`${host}: ${key}.model is missing`);
  if (r.effort !== undefined && r.effort !== null && typeof r.effort !== 'string') throw new Error(`${host}: ${key}.effort is not a string`);
  return { model: r.model.trim(), effort: r.effort || null };
}

function family(host, entry, key) {
  const f = entry[key] ?? null;
  if (f === null) return null;
  if (f === FAMILY_OF[host]) throw new Error(`${host}: its second family is its own`);
  if (!FAMILIES.includes(f)) throw new Error(`${host}: ${key} must be ${FAMILIES.join(', ')} or null`);
  return f;
}

/** The models file -> { schema, hosts: { <host>: { main, bounded, second, fallback } } }; throws with the reason. */
export function parseModels(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || parsed.schema !== 1) throw new Error(`expected schema 1, found ${parsed?.schema}`);
  if (!parsed.hosts || typeof parsed.hosts !== 'object' || Array.isArray(parsed.hosts)) throw new Error('no hosts object');
  const hosts = {};
  for (const [host, entry] of Object.entries(parsed.hosts)) {
    if (!HOSTS.includes(host)) throw new Error(`unknown host ${host}`);
    const second = family(host, entry, 'second');
    const fallback = family(host, entry, 'fallback');
    if (fallback && !second) throw new Error(`${host}: a fallback needs a second family`);
    if (fallback && fallback === second) throw new Error(`${host}: the fallback repeats the second family`);
    hosts[host] = { main: role(host, entry, 'main'), bounded: role(host, entry, 'bounded'), second, fallback };
  }
  return { schema: 1, hosts };
}

/** A TOML key's string value above the first table header, or null. */
export function tomlTopLevel(text, key) {
  const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
  for (const line of String(text ?? '').split('\n')) {
    if (/^\s*\[/.test(line)) break;
    const m = re.exec(line);
    if (m) return m[1] ?? m[2];
  }
  return null;
}

/**
 * `effort-above-high` on this host. Codex: the project's .codex/config.toml, then the user's
 * (`codexConfigs`, first match wins). Claude Code: CLAUDE_CODE_EFFORT_LEVEL overrides every
 * dispatch; CLAUDE_EFFORT is the session's own level, as Claude Code passes it to its shells.
 */
export function effortHazards(host, { env, codexConfigs = [] }) {
  const out = [];
  const add = (detail) => out.push({ id: 'effort-above-high', detail });
  if (host === 'codex') {
    for (const c of codexConfigs) {
      const v = c ? tomlTopLevel(c.text, 'model_reasoning_effort') : null;
      if (v === null) continue;
      if (ABOVE_HIGH.test(v))
        add(`model_reasoning_effort = "${v}" in ${c.source}: a session started without -c model_reasoning_effort=high runs every turn there, and the harness's main session runs at high`);
      break;
    }
  }
  if (host === 'claude') {
    const level = env.CLAUDE_CODE_EFFORT_LEVEL;
    if (typeof level === 'string' && ABOVE_HIGH.test(level))
      add(`CLAUDE_CODE_EFFORT_LEVEL=${level}: it overrides every dispatch's effort and every agent file's (harness-bootstrap's reference/gate-design.md › Model and effort)`);
    const effort = env.CLAUDE_EFFORT;
    if (typeof effort === 'string' && ABOVE_HIGH.test(effort))
      add(`CLAUDE_EFFORT=${effort}: this session runs at ${effort}; lower it with /effort high unless the switch line gives the reason (harness-bootstrap's reference/context.md)`);
  }
  return out;
}

const firstLine = (s) => String(s ?? '').trim().split('\n')[0].trim();

/** Whether a family can take a pass: its wrapper installed, then its CLI's login answer. */
export function familyState(fam, { wrapper, login }) {
  if (!wrapper) return { ok: false, why: `${WRAPPERS[fam]} is not installed` };
  const check = `\`${[LOGIN[fam].command, ...LOGIN[fam].args].join(' ')}\``;
  if (login?.error === 'ENOENT') return { ok: false, why: `${LOGIN[fam].command} is not on PATH` };
  if (login?.error) return { ok: false, why: `${check} ${login.error === 'ETIMEDOUT' ? 'timed out' : `failed (${login.error})`}` };
  if (fam === 'claude') {
    let answer;
    try {
      answer = JSON.parse(String(login?.stdout ?? ''));
    } catch {
      return { ok: false, why: `${check} printed no JSON (exit ${login?.status})` };
    }
    return answer?.loggedIn === true ? { ok: true, why: '' } : { ok: false, why: `${check}: not logged in` };
  }
  return login?.status === 0 ? { ok: true, why: '' } : { ok: false, why: `${check}: ${firstLine(login?.stdout) || `exit ${login?.status}`}` };
}

/** `second-family-absent`: the second family, then the fallback; none named is degraded by design. */
export function familyHazards(host, entry, states) {
  const haz = (detail) => [{ id: 'second-family-absent', detail }];
  if (!entry.second)
    return haz(`${host} names no second family in ${MODELS_FILE}: every cross-family pass is degraded by design (harness-bootstrap's reference/cross-model.md)`);
  const second = states[entry.second];
  if (second?.ok) return [];
  const why = `${entry.second}: ${second?.why ?? 'not checked'}`;
  if (entry.fallback && states[entry.fallback]?.ok)
    return haz(`${why}; the fallback, ${entry.fallback}, takes the second-family passes`);
  const fb = entry.fallback ? `; ${entry.fallback}: ${states[entry.fallback]?.why ?? 'not checked'}` : '';
  return haz(`${why}${fb}: every cross-family pass is degraded until one is back (harness-bootstrap's reference/cross-model.md)`);
}

const show = (r) => (r.effort ? `${r.model} ${r.effort}` : r.model);

/** The report: the role line for the switch line, the host's models and every hazard. */
export function hostReport({ host, by, models, modelsError = null, hazards = [] }) {
  if (host === 'unknown') {
    return {
      host,
      by,
      known: false,
      entry: null,
      line: `host unknown · no host variable is set: set HARNESS_HOST to ${HOSTS.join(', ')}`,
      hazards,
    };
  }
  const entry = models?.hosts?.[host] ?? null;
  const own = [];
  if (!entry) {
    const where = !models ? `${MODELS_FILE} ${modelsError === 'missing' ? 'is missing' : `is unreadable (${modelsError})`}` : `${MODELS_FILE} has no ${host} entry`;
    own.push({ id: 'host-models-missing', detail: `${where}: the roles have no models on this host (harness-bootstrap's reference/gate-design.md › Model and effort)` });
  }
  const line = entry
    ? `host ${host} · main ${show(entry.main)} · second family ${entry.second ?? 'none'}`
    : `host ${host} · main ? · second family ?`;
  return { host, by, known: Boolean(entry), entry, line, hazards: [...own, ...hazards] };
}

export function formatHost(r) {
  if (r.host === 'unknown') return [r.line, 'harness-host: the host is unknown'].join('\n');
  const detail = r.entry
    ? `  bounded ${show(r.entry.bounded)}${r.entry.fallback ? ` · fallback ${r.entry.fallback}` : ''} · detected by ${r.by}`
    : `  detected by ${r.by}`;
  const n = r.hazards.length;
  return [
    r.line,
    detail,
    ...r.hazards.map((h) => `HAZARD ${h.id} — ${h.detail}`),
    n ? `harness-host: ${n} hazard${n === 1 ? '' : 's'}` : 'harness-host: no hazards',
  ].join('\n');
}
