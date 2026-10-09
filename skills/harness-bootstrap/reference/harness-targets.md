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
| `AGENTS.md` | rules with origins, tracks, gate table, never-auto policy, tripwire slots, commands | every agent; Claude Code through `@AGENTS.md` |
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

`[M]` If an existing `AGENTS.md` has a size budget (Codex truncates long ones),
keep the rules terse and move rationale into a notes file the rules cite.

`[M]` Skill descriptions stay under 1024 characters — the strictest loader's
limit.

## Claude Code — the default

- **Models:** Opus for the main session, gates, the claim auditor and Full-track
  review; Sonnet for implementers, delegated builders, fixers, the conformance
  auditor and doc scans (`gate-design.md`). Pass `model` on every Agent dispatch.
- **Agents:** `.claude/agents/*.md` with `model:` and `tools:` frontmatter —
  `tools` is enforced, so the conformance auditor's read-only bound is real.
- **Hooks:** the commit guard is a git hook, not a Claude hook, so every agent
  and every human is guarded. The context-budget hook is Claude-only
  (`context.md`).

## Codex

- **Instructions:** `AGENTS.md`. **Skills:** `.agents/skills/`.
- **Read-only agents:** `.codex/agents/<name>.toml` with
  `sandbox_mode = "read-only"` and the auditor brief as `developer_instructions`.
  That is the tool-level bound the conformance auditor needs.
- **Models:** the TOML's `model` and `model_reasoning_effort`; keep the same
  judgment / bounded split with whatever models the project runs.
- **As a second reviewer for Claude Code:**
  `codex exec -s read-only -o <verdict> - < <prompt>` (`gate-design.md`).

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

## Kimi

- **Instructions:** `AGENTS.md`. **Skills:** `.agents/skills/`. Treat agent
  files as briefs, as for ZCode.

## Detection, in the report

`[M]` State which agents you generated for and the evidence for each. Generating
for an agent the project does not use is clutter; missing one it does use leaves
that agent unguarded by everything except the git hook.
