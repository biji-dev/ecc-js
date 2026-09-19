# ECC-JS

ECC-JS (`biji-dev/ecc-js`) is a slim fork of
[affaan-m/ECC](https://github.com/affaan-m/ECC) (Everything Claude Code), cut
down to the surface a JavaScript/TypeScript team actually uses and delivered as
the `ecc` plugin for Claude Code, ZCode and Codex, plus a Kimi installer config.

- This file: what the fork contains, why, how to install it and how the hooks behave.
- [FORK.md](../FORK.md): maintaining the fork (upstream sync, review queue, releases).
- Everything else in the repository (README, AGENTS.md, CONTRIBUTING, skills,
  agents, commands) is upstream prose and may still mention things the fork removed.

## Why a fork

Running upstream ECC loads about 290 skills, 68 agents, 94 commands, 22 rule
packs and about 47 hooks into every session. In practice only a small part of
that surface served this stack, and the default hooks caused friction: the
GateGuard edit gate blocked about 1,000 tool calls in one week, and hook
bootstrap output added a lot of noise to transcripts.

The fork keeps upstream's content and history, but physically removes what the
stack does not need, so every harness (including ones that scan directories
instead of reading manifests) sees only the slim set. Upstream releases still
merge in through a scripted, reviewable sync.

## Target stack

Derived from a census of the projects in `~/Projects` (KvernaProject and
GLM-Free-API excluded; sabbi and maxchat used only as secondary evidence):

| Area | Technologies |
| --- | --- |
| Language and runtime | TypeScript, Node 20-24, Bun 1.3, pnpm/bun workspaces, Turborepo |
| Web | React 19, Next.js 15/16 App Router, Vite SPAs, Astro, Tailwind v4, shadcn |
| Backend and data | Hono, Fastify, Postgres with Drizzle or Prisma, Redis, BullMQ, pg-boss, MySQL (ERPNext), ClickHouse (monitoring) |
| Mobile and extensions | Expo / React Native with EAS, PWAs, MV3 browser extensions |
| Testing | Vitest, bun test, Playwright |
| Delivery | Docker, pm2 + nginx, GitHub Actions |
| AI | LLM apps, RAG, evals, agent harnesses |

## Scope rule

Keep every **technical, language-neutral** item that a JS/TS project can use,
so custom flows can build on the whole generic toolkit. Remove:

1. Non-JS language, framework and platform lanes (Python/Django/FastAPI, Go,
   Rust, Java/Kotlin/Spring/Quarkus, Swift, Flutter/Dart, C++/C#/F#, PHP/Laravel,
   Perl, Ruby/Rails, Vue/Nuxt/Angular, NestJS, networking/homelab, healthcare
   EMR, web3, ML training).
2. Non-technical business skills (marketing, investor, logistics, social,
   content, scientific research and similar).
3. ECC's own side products (ito, nasiko, taste, epic, ECC Tools billing).
4. Jira and Kubernetes (not used).
5. Skills that depend on paid external APIs (codehealth-mcp,
   nutrient-document-processing, mailtrap-email-integration, deep-research,
   exa-search).
6. Claw/Hermes harness items (nanoclaw-repl, unified-memory, `scripts/claw.js`).
7. `configure-ecc`, which only accepts the upstream marketplace.

Every removed item is listed with its reason code in `fork/slim.json`
(`<kind>.drop`); that file is the source of truth, not this page.

## What ships

| Surface | Kept | Removed | Notes |
| --- | --- | --- | --- |
| Skills | 140 | 152 | lang 84, non-technical 47, ecc-product 11, paid-api 5, claw-harness 2, jira 1, unused-infra 1, broken-in-fork 1 |
| Agents | 36 | 32 | lang 30, non-technical 2 (chief-of-staff, marketing-agent) |
| Commands | 66 | 28 | lang 19, ecc-product 7 (`epic-*`), jira 1, non-technical 1 |
| Rule packs | 5 | 17 | common, typescript, web, react, react-native |
| Hooks | 12 top-level entries | 12 | gated by an allowlist, see below |

Kept highlights: all reviewers used day to day (security, typescript, code,
database, react, silent-failure-hunter), planner, architect, code-architect,
code-explorer, the `gan-*` harness, `orch-*` and `loop-*` workflows, the PRP flow,
continuous learning v2 with instincts, verification-loop, e2e-testing,
mysql-patterns and clickhouse-io.

**Pinned** items make an upstream sync stop if they disappear upstream, because
other projects call them by name (`ecc:security-reviewer`, `/ecc:plan`,
`/ecc:prp-implement`, `/ecc:learn-eval` and so on). The list is in
`fork/slim.json` under `<kind>.pinned`. Plugin name `ecc` and item names stay
identical to upstream for the same reason.

Removed repository surface: all docs translations and most of `docs/`
(`docs/COMMAND-REGISTRY.json`, `COMMAND-AGENT-MAP.md`,
`SKILL-PLACEMENT-POLICY.md`, `CODEX-NAVIGATION-GUIDE.md` and the zh-CN catalog
anchors stay), `ecc2/`, `src/`, Python tooling, `integrations/`, `docker/`,
`examples/` (except `examples/eval-harness`), `contexts/`, `scaffolds/`, the
adapter dirs for Cursor, OpenCode, Kiro, Gemini, Qwen, Zed, Pi, Hermes,
OpenClaw, AdaL, Trae and CodeBuddy, the 12 upstream GitHub workflows,
operator/release scripts and 64 test files coupled to removed content.
The repository went from 3,716 to about 1,100 tracked files.

## Hooks

Hooks are deny-by-default. `ecc/setup.json` holds `hooks.allow`; the patched
`scripts/lib/hook-flags.js` runs a hook only when its id is on that list, and
the upstream hook profile (`minimal`/`standard`/`strict`) is ignored while the
list exists. Hooks that upstream adds later stay off until they are allowlisted.

| Group | Hook id | What it does |
| --- | --- | --- |
| Safety | `pre:bash:block-no-verify` | Blocks `git commit --no-verify` and similar bypasses |
| Safety | `pre:config-protection` | Blocks edits to existing linter/formatter configs, so agents fix code instead of rules |
| Safety | `pre:bash:gateguard-fact-force` | Destructive Bash commands only (`rm -rf`, `git reset --hard`, ...); the routine first-Bash gate and the Edit/Write gate are off |
| Safety | `pre:bash:commit-quality` | Before `git commit`: lints staged files, flags console.log/TODO and checks the message format |
| Quality | `post:edit:console-warn` | Warns about `console.log` in edited files |
| Quality | `stop:format-typecheck` (+ `post:edit:accumulator`) | Formats and type-checks edited files at Stop; can take up to about 300s on large TS repos |
| Data | `stop:cost-tracker` | Writes `~/.claude/metrics/costs.jsonl` for `/cost-report` |
| Data | `post:skill:track` | Skill usage for `/skill-health` |
| Data | `pre:observe`, `post:observe:continuous-learning`, `session:end:marker` | Continuous learning observations for instincts, `/evolve`, `/promote`, `/prune`; needs `python3` |
| Session | `session:start`, `stop:session-end` | Session context load and save (Codex gets the SessionStart mirror) |
| Notify | `stop:desktop-notify` | Desktop notification when a turn ends |

Two ids describe an entry rather than a behaviour: `pre:bash:dispatcher` is the
Bash dispatcher that hosts the three `pre:bash:*` hooks above, and the hook
entry `pre:observe:continuous-learning` runs under the runtime id `pre:observe`.
The dispatchers themselves are never gated; each sub-hook inside them is.

### Hooks that are off

Upstream ships these; the fork removed them from `hooks/hooks.json`
(`fork/slim.json` `hooks.drop`):

| Hook id | Why it is off |
| --- | --- |
| `pre:edit-write:gateguard-fact-force` | The Edit/Write fact gate; about 1,005 blocked tool calls in one week. The destructive-only Bash gate is kept instead |
| `pre:powershell:gateguard-fact-force` | No PowerShell on macOS |
| `pre:write:doc-file-warning` | Not wanted (decision 2026-09-14) |
| `pre:edit-write:suggest-compact` | Noisy; native auto-compact already handles it |
| `pre:governance-capture` | ECC2 control plane only |
| `pre:mcp-health-check` | False alarms on plugin MCPs, and the probes block |
| `post:mcp-health-check` | Pairs with the dropped pre-check |
| `pre:compact` | Hidden paid `claude -p` call |
| `session-start:plan-canvas-sessions` | plan-canvas is off by default |
| `stop:plan-canvas-pending` | plan-canvas is off by default |
| `stop:check-console-log` | Duplicates `post:edit:console-warn` |
| `stop:evaluate-session` | Continuous-learning v1 evaluator; extracts nothing |

Anything upstream adds later is also off until you allowlist it.

### How a hook is decided, in order

`scripts/lib/hook-flags.js` `isHookEnabled()` checks, in this order:

1. `ECC_HOOKS_ENABLED=false` (or `CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED`) turns
   every ECC hook off.
2. `ECC_DISABLED_HOOKS=id,id` turns off the ids it lists. This wins over the
   allowlist, so it is the per-project escape hatch.
3. The allowlist in `ecc/setup.json` `hooks.allow`: with it, only those runtime
   ids run and the hook profile is ignored.
4. Only if there is no allowlist (`ECC_HOOK_ALLOWLIST=off`) does the upstream
   profile (`minimal`/`standard`/`strict`) decide.

### Turning a hook off

- **This shell only:** `ECC_DISABLED_HOOKS=stop:format-typecheck claude`
- **One project:** add it to `.claude/settings.json` in that project. This keeps
  working regardless of what the fork ships:

  ```json
  { "env": { "ECC_DISABLED_HOOKS": "stop:format-typecheck,stop:desktop-notify" } }
  ```

- **Everywhere, permanently:** remove the runtime id from `ecc/setup.json`
  `hooks.allow`. If it is also a top-level entry in `hooks/hooks.json`, move its
  id from `hooks.keep` to `hooks.drop` in `fork/slim.json` with a reason. Then
  `npm run fork:apply && npm run fork:bump`, `npm test`, commit, push, and
  update the harnesses.
- **All hooks at once:** `ECC_HOOKS_ENABLED=false`.

### Turning a hook on

Add its runtime id to `ecc/setup.json` `hooks.allow`. If upstream ships it as a
top-level entry that the fork dropped, also move its id from `hooks.drop` to
`hooks.keep` in `fork/slim.json`. Then `npm run fork:apply && npm run fork:bump`,
`npm test`, commit and push. Full steps: "Enabling or disabling a hook" in
[FORK.md](../FORK.md).

Hook ids come from `hooks/hooks.metadata.json` (top-level entries) and from the
`id:` fields in `scripts/hooks/bash-hook-dispatcher.js` and
`scripts/hooks/posttooluse-dispatcher.js` (sub-hooks).

## Turning skills, agents, commands and rules on or off

`fork/slim.json` is the switchboard: `keep` ships an item, `drop` removes it
with a reason, `own` is for your own `biji-*` items.

See what is off and why:

```bash
node -e "const s=require('./fork/slim.json');for(const k of ['skills','agents','commands','rules'])for(const [n,r] of Object.entries(s[k].drop))console.log(k,n,'—',r)"
```

To bring a dropped item back, move its name from `drop` to `keep`. To remove one
that currently ships, move it from `keep` to `drop` with a reason (and out of
`pinned` if listed there). Either way:

```bash
npm run fork:apply     # restore or remove files, regenerate manifests (staged)
npm run fork:bump      # new plugin version so the harness caches update
npm test && node fork/bin/verify.js --drift --since origin/main
git add -A && git commit && git push origin main
```

Then update the harnesses so they pick up the new build. Rule packs work the
same way, but they are installed separately (see Rules below), so re-run the
rules installer afterwards.

## Turning ECC-JS off entirely

Per harness, without uninstalling:

```bash
claude plugin disable ecc@ecc          # claude plugin enable ecc@ecc to restore
node /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs plugins disable ecc@ecc
```

Codex has no disable, only `codex plugin remove ecc@ecc`. To keep the plugin but
silence only its hooks, set `ECC_HOOKS_ENABLED=false`.

## Install

The plugin version is `<upstream version>-js.<build>` (for example
`2.2.1-js.2`). Harnesses cache plugins by version, so an update only arrives
when the build number changes. Sessions that were already open keep the hooks
of the version they started with: restart them after installing or updating.

### Claude Code

```bash
claude plugin uninstall ecc@ecc --scope user     # only when the upstream plugin is installed
claude plugin marketplace remove ecc              # only when the upstream marketplace is configured
export CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS=600000   # the clone carries full upstream history
claude plugin marketplace add https://github.com/biji-dev/ecc-js.git
claude plugin install ecc@ecc --scope user
claude plugin details ecc@ecc                     # Skills (206) = 140 skills + 66 commands, Agents (36)
```

Update:

```bash
CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS=600000 claude plugin marketplace update ecc
claude plugin update ecc@ecc
```

Notes:

- Use the HTTPS URL. The `biji-dev/ecc-js` shorthand clones over SSH and fails
  without a GitHub SSH key ("correct access rights"). The default 120s clone
  timeout is too short for the first clone.
- `marketplace add` writes `extraKnownMarketplaces.ecc` in
  `~/.claude/settings.json` itself; no manual edit is needed.
- The "userConfig options not yet set" notice can be ignored. `hook_profile`
  has no effect while the allowlist exists.
- Do not run `ecc setup` or the configure-ecc flow; they only accept the
  upstream marketplace.
- The fork's `stop:desktop-notify` duplicates a custom osascript Stop hook in
  `~/.claude/settings.json` if you have one; keep only one of them.

### ZCode

In the ZCode plugin UI, add the marketplace URL
`https://github.com/biji-dev/ecc-js.git` (not the shorthand) and install `ecc`.
Check that about 140 skills and 36 agents are listed, the version reads
`2.2.1-js.N`, and a new session starts without a SessionStart hook error (hook
scripts fall back to the `~/.claude` plugin cache when `CLAUDE_PLUGIN_ROOT` is
unset). Refresh the marketplace in the UI to update.

### Codex

```bash
codex plugin marketplace add biji-dev/ecc-js
codex plugin add ecc@ecc
codex plugin list --json
```

Then open Codex, run `/hooks` and trust the ECC SessionStart hook. Trust is tied
to the hook's hash: when a sync changes `hooks/codex-hooks.json`, trust it again.

Update: `codex plugin marketplace upgrade ecc && codex plugin add ecc@ecc`, then
restart Codex.

Check the installed cache from a local clone (the upstream no-flag form checks
the `package.json` version and fails for the fork):

```bash
node scripts/codex/check-plugin-cache.js --version "$(node -p "require('./.codex-plugin/plugin.json').version")"
```

### Kimi (per project, from a local clone)

```bash
node ~/Projects/ecc-js/scripts/install-plan.js --target kimi --config ~/Projects/ecc-js/fork/install/kimi.json --json
node ~/Projects/ecc-js/scripts/install-apply.js --target kimi --config ~/Projects/ecc-js/fork/install/kimi.json
```

The installer never prunes. After the fork removes items, run
`node ~/Projects/ecc-js/scripts/uninstall.js --target kimi --dry-run` from the
same project, then without `--dry-run`, then reinstall.

### Rules (optional)

Plugins cannot ship rules. To install the 5 rule packs into `~/.claude/rules/ecc/`:

```bash
node scripts/install-apply.js --target claude --config fork/install/claude-rules.json --dry-run
node scripts/install-apply.js --target claude --config fork/install/claude-rules.json
```

Never install agents, commands, skills or hooks to the `claude` target: that
duplicates the plugin.

## Adding your own items

Name your own skills, agents, commands and rule packs with the `biji-` prefix
and list them under `<kind>.own` in `fork/slim.json`. `biji-*` paths are
fork-owned: upstream syncs never touch them, and own skills are included in the
Kimi install config automatically. Then run `npm run fork:apply` and
`npm run fork:bump` (see [FORK.md](../FORK.md)).

## Known limitations

- Upstream prose (README body, AGENTS.md, CONTRIBUTING.md, TROUBLESHOOTING.md,
  COMMANDS-QUICK-REF.md, docs/COMMAND-AGENT-MAP.md and some kept skills such as
  plan-orchestrate and prompt-optimizer) still names removed items. The real
  surface is `skills/`, `agents/`, `commands/` and `fork/slim.json`;
  `node fork/bin/verify.js` lists these mentions as warnings. They are left
  alone so upstream edits keep merging cleanly.
- Hook runners can still echo raw input on some events; upstream's bootstrap
  suppresses most of it, and the allowlist keeps the number of hooks small.
- `package.json` `packageManager` stays upstream's `yarn@4.9.2`; the fork uses
  `npm ci` and `package-lock.json` in CI.
- The fork tooling and `npm test` assume a POSIX shell (macOS, Linux, CI on
  ubuntu-latest).
- Security issues in fork-only code (`fork/**`, the hook allowlist and
  GateGuard patches, the fork workflows) go to biji-dev/ecc-js; issues in shared
  content go upstream per SECURITY.md.
