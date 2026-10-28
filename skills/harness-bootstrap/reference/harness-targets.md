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
| `AGENTS.md` | each rule as **rule + one clause of why + a link**; the tier and gate tables; the policy; commands; the area-rules index | its current size, rounded up to the next 1,024 bytes — and under 32 KB where Codex reads it (its default project-doc cap truncates the rest silently) |
| `CLAUDE.md` | `@AGENTS.md`, then Claude specifics only | its current size, rounded up to the next 1,024 bytes |
| `.claude/rules/<area>.md` | rules that apply to one area, with `paths:` frontmatter so Claude Code loads them on reading a matching file | per file |
| `docs/harness/rule-origins.md` | the full origin of every shipped rule (`rules.md` §1), generated | none |
| the state file | one unit's state (`scope-guard.md`) | 8 KB |
| each `SKILL.md` | one skill | 500 lines |

`[M]` **Budgets ratchet from the current size.** Generation sets each to the file's
size today, rounded up to the next 1,024 bytes, and the lint fails only above it. A
118 KB `CLAUDE.md` must not fail on day one; it must not grow either.

`[M]` **Area rules are indexed in `AGENTS.md`**, one line each:
``- `<file>.md` — <what it covers> (`<first path glob>` …)``; a rule in a
subdirectory (Claude Code loads `.claude/rules/` at any depth) by its path under the
rules dir, `web/react.md`. Sub-agents and other
agents do not load path-scoped rules on their own, so **every brief names the ones
that apply** — `node scripts/check-agent-docs.mjs --rules-for <files>` lists them.

`[M]` **The agent-docs lint** — `templates/scripts/check-agent-docs.mjs`, installed
to `scripts/` and run as a verify gate. It checks the `@AGENTS.md` import, the
budgets, that every `paths:` glob matches a tracked file, that the index and the
rule files agree both ways, that links and backticked paths resolve, skill and
agent frontmatter (a "read-only" agent listing `Bash`, `Edit` or `Write` fails),
secret patterns (masked in its output), and the base: the bytes every session loads
from the repository, against a ratcheted target — `--base` lists the files
(`context.md` › The window, the gate wait and the base). Its test,
`templates/scripts/lib/check-agent-docs.test.mjs`, ships beside it. Its `CONFIG`
block is `[B]`.

`[M]` **Citations of `AGENTS.md` hold** (the lint's tenth check). An instruction
file or a code comment (`citeFiles`) that sends a reader to `` `AGENTS.md` › Name ``,
`` `AGENTS.md` (Name) `` or a quoted name or phrase fails once `AGENTS.md` loses it.
A name is the words up to the next punctuation, and holds while it is a heading or
a bold lead, begins one ("› Context" for "Context budget and reporting") or one
begins it ("› Gates apply"); a quoted name or phrase holds while `AGENTS.md` still
has those words. One project's audit counted about 35 comments that renamed headings had
orphaned before it wrote its own lint (2026-09-27), which this check generalises. In
eight installs (2026-10-26) it read 183 cited names and failed 6. Five sit on three
lines (each task-runner skill has a `.claude` and an `.agents` copy): `› Policy` in
one project names no section, a quote in another is not `AGENTS.md`'s words, and
a third's "› Reviewers maps each name to a dispatch" runs an abbreviation into prose
(`` (`AGENTS.md` › Reviewers) maps … `` holds). The sixth is the second one's own parser
test, whose citations are fixtures: such a file goes in `citeExempt`.

`[M]` **Thin per-agent skills, one shared script.** When a procedure is a command
sequence (verify, a wrapper), write it once as a script and let each agent's skill
call it; never maintain the same sequence in three skill files.

## Claude Code — the default

- **Models:** from the risk map (`gate-design.md`) — Opus for the main session,
  gates, critical code, the one unit code review on Full, the triggered specialists
  and the claim auditor; Sonnet for cold slices, delegated builders, the conformance
  auditor, `pr-test-analyzer`, doc rewrites and runners; the second family for
  per-slice review, Small review, fix re-reviews and the adversarial pass. Pass
  `model` and `effort` on every Agent dispatch, and pin `effort: high` in every
  agent file.
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
  `env`, `sudo`, `timeout`, `nice`, `xargs`, `command`, `exec`, `time` and `nohup`
  stripped with their options) and refuses
  `git commit --no-verify` or `-n`, `git push`, `git merge` or `git pull --no-verify`,
  `HUSKY=0` on a commit, merge or push, a `core.hooksPath`
  override (`-c`, or an inline `GIT_CONFIG_*` such as `GIT_CONFIG_KEY_0=core.hooksPath`)
  or `git config` write (setting it to the project's `[B]` `HOOKS_DIR`
  stays allowed), a force-push or delete of the mainline, and (`codex-background`) a
  Codex or run-wrapper launch sent to the background with a shell `&`; `EXTRA_RULES`
  is `[B]`, and each rule gets the command's `env` and `background`. A commit message that *mentions* `--no-verify` passes. It
  exits 2 to block and 0 on any error. It stops an agent's own mistakes and the
  obvious retry, not a determined adversary — its header lists what it cannot see.
  It replaces a plugin's keyword hook: the harness depends on no plugin hook, since a
  machine may have them all disabled.

  ```json
  { "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/command-guard.mjs\"", "timeout": 10 }] }] } }
  ```
- **The edit guard** — `templates/edit-guard.mjs`, a `PreToolUse` hook on `Edit`,
  `Write`, `MultiEdit` and `NotebookEdit`, installed to `.claude/hooks/edit-guard.mjs`.
  It reads the paths from stdin (`tool_input.file_path`, `notebook_path`) and refuses,
  with exit 2, an edit of a `[B]` `PROTECTED` path: env files that hold secrets
  (`.env`, `.envrc`, `*.env` and their suffixed forms such as `.env.local`) and
  installed packages, while a committed template such as `.env.example` or
  `.env.production.sample` stays editable. It tests the
  path as written and the path the write lands on, through symlinks, and matches
  without case (macOS and Windows volumes ignore it): `.ENV`, or `deps/` linked to
  `node_modules/`, is refused too. It replaces
  inline hooks on `$CLAUDE_FILE_PATHS`, which Claude Code does not set: one project's
  `.env` guard and formatter read it, so neither ever ran (the 2.1.308 binary holds no
  such name). A `PostToolUse` formatter imports its `editedPaths`.

  ```json
  { "hooks": { "PreToolUse": [{ "matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/edit-guard.mjs\"", "timeout": 10 }] }] } }
  ```
- **Each hook ships with its test** (`templates/scripts/lib/command-guard.test.mjs`,
  `edit-guard.test.mjs`, `context-budget.test.mjs`), installed to `scripts/lib/`. The
  test drives the installed hook with the payload the host sends, so the project's
  counted `harness` gate fails the day an edit breaks it.
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
- **Agents:** `.codex/agents/<name>.toml`, generated when Codex is a target, one per
  generated Claude agent: `name`, `description`, the agent file's brief as
  `developer_instructions`, and `model` and `model_reasoning_effort` from
  `.agents/harness-models.json` (`gate-design.md` › Model and effort). **A TOML bounds
  no sandbox:** "Other session settings, including `sandbox_mode`, `approval_policy`,
  `model_provider`, and `mcp_servers`, don't override the parent configuration when
  placed in a custom agent file", and its instructions "can ask an agent to avoid
  edits, but they don't create a separate read-only sandbox" (Codex's subagents
  documentation). The read-only bound the conformance and blast-radius auditors need
  is `codex exec -s read-only`: `codex-run.mjs`'s read-only kinds, `lane-a` for the
  conformance checklist.
- **Models:** the session's own effort is `config.toml`'s `model_reasoning_effort` —
  the project's `.codex/config.toml` first, in a trusted repository — and
  `harness-host.mjs` flags one above `high`: start the session with
  `-c model_reasoning_effort=high`. A profile is a file, not a `[profiles]` table:
  `codex -p <name>` layers `$CODEX_HOME/<name>.config.toml` on the user config
  (`--help`, 0.163).
- **As the second family for Claude Code:** through the `codex-run.mjs` wrapper
  (`cross-model.md`).
- **As the host:** its second family is Claude, through `claude-run.mjs`
  (`cross-model.md` › When the host is not Claude Code). The `workspace-write`
  sandbox has no network and cannot write `~/.claude`, so `claude-run` runs outside
  it, on the approval Codex asks for.
- **Hooks:** the command and edit guards run under Codex unchanged, from
  `.codex/hooks.json`, which Codex loads only once the project's `.codex/` layer is
  trusted. Its stdin carries `tool_name`, `tool_input` and `cwd`; "`Bash` and
  `apply_patch` use `tool_input.command`". Every file edit reports as `apply_patch`
  (the `Edit` and `Write` matchers alias it), and the edit guard reads the patch's
  `*** Add File:`, `*** Update File:`, `*** Delete File:` and `*** Move to:` lines
  against `cwd`, indented too where a file section may start (inside an Update hunk
  a space-led line is context). Exit 2 blocks, as on Claude Code. Set `timeout`:
  Codex's default is 600 seconds.

  ```json
  { "hooks": { "PreToolUse": [
    { "matcher": "apply_patch|Edit|Write", "hooks": [{ "type": "command", "command": "node \"$(git rev-parse --show-toplevel)/.claude/hooks/edit-guard.mjs\"", "timeout": 10 }] },
    { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node \"$(git rev-parse --show-toplevel)/.claude/hooks/command-guard.mjs\"", "timeout": 10 }] }
  ] } }
  ```

## ZCode

- **Instructions:** `AGENTS.md` only — put a pointer to anything Claude-only.
  **Skills:** `.zcode/skills/` or `.agents/skills/` (it reads both).
- **No project agent registry.** The runner dispatches a general-purpose agent
  with the agent file's full text as its brief; `tools:` is not enforced, so the
  orchestrator spot-checks the auditor's citations (`conformance-auditor.md`).
- **Model pinning** exists only on dynamic workflows (`subagent_model`); ad-hoc
  dispatches run on the session model. When the split matters, batch the bounded
  work into a workflow (the `delegate-tasks` skill describes one).
- **The second family** is Codex, through `codex-run.mjs`; Claude, through
  `claude-run.mjs`, when Codex is out. ZCode sets `CLAUDE_*` variables too, so
  `harness-host.mjs` reads any `ZCODE_*` variable first. No ZCode variable is
  verified yet (none was found in its app or its logs), so until one is, a ZCode
  session reads as `claude`: set `HARNESS_HOST=zcode` in the environment ZCode gives
  its shells, never in a shell profile the other hosts read too.
- Check whether the session model reads images before planning a visual step.
- **When ZCode is the main runtime,** the Claude Code hooks (command and edit
  guards, context budget) do not protect it, and "pass `model` and `effort` on every
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

`[M]` **At run time, `scripts/harness-host.mjs` names the host:** `HARNESS_HOST`,
then any `ZCODE_*` variable, then `CODEX_THREAD_ID` or `CODEX_SANDBOX`, then
`CLAUDECODE`. A host started from another inherits its variables — a Codex run
started from a Claude Code shell carries `CLAUDECODE` — so the inner host's own
variables go first; `HARNESS_HOST` settles anything else. Kimi sets none: it needs
`HARNESS_HOST=kimi`. ZCode needs `HARNESS_HOST=zcode` until a `ZCODE_*` variable is
verified in its shells (ZCode, above).
