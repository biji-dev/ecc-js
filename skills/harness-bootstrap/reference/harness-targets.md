# Reference: which agents read what

The harness is generated **for the agents this project actually uses** — decided
from the project's files, never from the machine running the bootstrap. Claude
Code is the default target; the others are additive.

| Signal in the project | Means |
|---|---|
| `CLAUDE.md`, `.claude/` | Claude Code |
| `AGENTS.md` alone, `.codex/` | Codex |
| `.zcode/` | ZCode |
| `AGENTS.md` and a Kimi config the owner names | Kimi |
| nothing | ask; default to Claude Code plus `AGENTS.md`, so a second agent can join later |

## The shared layout

`[M]` **One owner per fact, readable by every agent:**

| File | Holds | Read by |
|---|---|---|
| `AGENTS.md` | rules (one clause of origin + link), task types, tiers, gate table, never-auto policy, risk map, merge policy, stops, tripwire slots, commands | every agent; Claude Code through `@AGENTS.md` |
| `CLAUDE.md` | line 1 `@AGENTS.md`, then only Claude specifics: model map, agent names, skills, hooks | Claude Code |
| `.agents/skills/<name>/` | the real skill files | Codex, ZCode, Kimi |
| `.claude/skills/<name>` | a **committed relative symlink** to `../../.agents/skills/<name>` | Claude Code |
| `.claude/agents/*.md` | auditor and reviewer definitions | Claude Code; others receive them as briefs |

`[M]` **Propose the split; do not impose it.** A project that uses only Claude Code
and already keeps everything in `CLAUDE.md` may keep `CLAUDE.md` as the harness
file and `.claude/skills/` as the real store. Say what a second agent would then
miss, and let the owner choose.

`[M]` **Edit the real file, never through the link.** A new skill gets its link
in the same commit. On Windows without symlink support, copy instead and add a
check that the two copies match.

`[M]` **A plain file read does not expand `@AGENTS.md`.** Any agent told to read
the rules (the auditors especially) reads both files.

`[M]` Skill descriptions stay under 1024 characters — the strictest loader's
limit.

## Keeping the instruction files small

`[M]` **Every session re-reads them.** Budget them, and keep each fact in one place:

| File | Holds | Budget `[B]` |
|---|---|---|
| `AGENTS.md` | each rule as **rule + one clause of why + a link**; the tier and gate tables; the policy; commands; the area-rules index | its current size, rounded up — and under 32 KB where Codex reads it (its default project-doc cap truncates the rest silently) |
| `CLAUDE.md` | `@AGENTS.md`, then Claude specifics only | its current size, rounded up |
| `.claude/rules/<area>.md` | rules that apply to one area, with `paths:` frontmatter so Claude Code loads them on reading a matching file | per file |
| `docs/harness/rule-origins.md` | the full origin of every shipped rule (`rules.md` §1), generated | none |
| the state file | one unit's state (`scope-guard.md`) | 8 KB |
| each `SKILL.md` | one skill | 500 lines |

`[M]` **Budgets ratchet from the current size.** Generation sets each to the file's
size today, rounded up, and the lint fails only above it. A 118 KB `CLAUDE.md` must
not fail on day one; it must not grow either.

`[M]` **Area rules are indexed in `AGENTS.md`**, one line each:
``- `<file>.md` — <what it covers> (`<first path glob>` …)``. Sub-agents and other
agents do not load path-scoped rules on their own, so **every brief names the ones
that apply** — `node scripts/check-agent-docs.mjs --rules-for <files>` lists them.

`[M]` **The agent-docs lint** — `templates/scripts/check-agent-docs.mjs`, installed
to `scripts/` and run as a verify gate. It checks the `@AGENTS.md` import, the
budgets, that every `paths:` glob matches a tracked file, that the index and the
rule files agree both ways, that links and backticked paths resolve, skill and
agent frontmatter (a "read-only" agent listing `Bash`, `Edit` or `Write` fails),
and secret patterns (masked in its output). Its test,
`templates/scripts/lib/check-agent-docs.test.mjs`, ships beside it. Its `CONFIG`
block is `[B]`.

`[M]` **Thin per-agent skills, one shared script.** When a procedure is a command
sequence (verify, a wrapper), write it once as a script and let each agent's skill
call it; never maintain the same sequence in three skill files.

## Claude Code — the default

- **Models:** from the risk map (`gate-design.md`) — Opus for the main session,
  gates, critical code, Full review and the claim and blast-radius auditors; Sonnet
  for cold slices, delegated builders, the conformance auditor, doc scans and
  runners. Pass `model` and `effort` on every Agent dispatch.
- **Agents:** `.claude/agents/*.md` with `model:` and `tools:` frontmatter —
  `tools` is enforced, so the conformance and blast-radius auditors' read-only
  bound is real. Generated: `plan-conformance-auditor.md`, `blast-radius-auditor.md`,
  `claim-auditor.md`, `implementer.md`.
- **Hooks:** the commit guard is a git hook, not a Claude hook, so every agent
  and every human is guarded. The context-budget hook is Claude-only
  (`context.md`).
- **Hooks read their stdin JSON** (`tool_name`, `tool_input`, `cwd`, the transcript
  path). Never an environment variable the hook documentation does not list: an
  inline hook reading `$CLAUDE_FILE_PATHS` depends on something no release promises
  to set, and fails silently the day it stops.
- **The command guard** — `templates/command-guard.mjs`, a `PreToolUse` hook on
  `Bash`, installed to `.claude/hooks/command-guard.mjs`. It parses the command
  (heredocs and quoted text removed, split on shell operators, wrappers such as
  `env`, `sudo`, `timeout`, `nice` and `xargs` stripped) and refuses
  `git commit --no-verify` or `-n`, `git merge` or `git pull --no-verify`, `HUSKY=0`
  on a commit or merge, a `core.hooksPath`
  override or `git config` write (setting it to the project's `[B]` `HOOKS_DIR`
  stays allowed), and a force-push or delete of the mainline; `EXTRA_RULES` is `[B]`. A commit message that *mentions* `--no-verify` passes. It
  exits 2 to block and 0 on any error. It stops an agent's own mistakes and the
  obvious retry, not a determined adversary — its header lists what it cannot see.
  It replaces a plugin's keyword hook: the harness depends on no plugin hook, since a
  machine may have them all disabled.

  ```json
  { "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/command-guard.mjs\"", "timeout": 10 }] }] } }
  ```
- **The review workflow** (optional, Full tier) — `templates/workflows/review.workflow.js`,
  installed to `.claude/workflows/review.workflow.js` and run by name with the Workflow
  tool. Its `MODELS`, `AGENTS` and `TRIGGERS` block is `[B]`; it passes `model` and
  `effort` on every agent call and verifies every P0 and P1, failing closed. It
  cannot run commands or ask the owner, so the gates and triage stay with the
  session.
- **Exclude other projects' instruction files** with `claudeMdExcludes` in
  `.claude/settings.local.json` only — it is a per-machine setting.

## Codex

- **Instructions:** `AGENTS.md`. **Skills:** `.agents/skills/`.
- **Read-only agents:** `.codex/agents/<name>.toml` with
  `sandbox_mode = "read-only"` and the auditor brief as `developer_instructions`.
  That is the tool-level bound the conformance auditor needs.
- **Models:** the TOML's `model` and `model_reasoning_effort`; keep the same
  judgment / bounded split with whatever models the project runs.
- **As the second family for Claude Code:** through the `codex-run.mjs` wrapper
  (`cross-model.md`).

## ZCode

- **Instructions:** `AGENTS.md` only — put a pointer to anything Claude-only.
  **Skills:** `.zcode/skills/` or `.agents/skills/` (it reads both).
- **No project agent registry.** The runner dispatches a general-purpose agent
  with the agent file's full text as its brief; `tools:` is not enforced, so the
  orchestrator spot-checks the auditor's citations (`conformance-auditor.md`).
- **Model pinning** exists only on dynamic workflows (`subagent_model`); ad-hoc
  dispatches run on the session model. When the split matters, batch the bounded
  work into a workflow (the `delegate-tasks` skill describes one).
- Check whether the session model reads images before planning a visual step.
- **When ZCode is the main runtime,** the Claude Code hooks (command guard,
  context budget) do not protect it, and "pass `model` and `effort` on every
  dispatch" cannot hold outside a workflow. The git hooks still do — the commit
  guard is the one protection every agent shares. Say in the harness file which
  protections apply to which runtime, and which roles fall back to the session
  model.

## Kimi

- **Instructions:** `AGENTS.md`. **Skills:** `.agents/skills/`. Treat agent
  files as briefs, as for ZCode.

## Detection, in the report

`[M]` State which agents you generated for and the evidence for each. Generating
for an agent the project does not use is clutter; missing one it does use leaves
that agent unguarded by everything except the git hook.
