---
name: harness-bootstrap
description: Assess whether a plan-driven repository can sustain a gated task harness (task runner, commit guard, two human gates, conformance and claim auditors, harness log), derive its never-auto-merge policy from its own documents, and install it. Claude Code first (Opus for judgment, Sonnet for bounded work); Codex, ZCode and Kimi supported. Use when adopting the gated flow in a new repository, upgrading an installed one, or asking whether a project is ready for one. Refuses projects that do not meet the preconditions. Not for auditing agent config (that is harness-audit).
when_to_use: Set up, audit, adopt, or upgrade a gated task harness in a repository — task runner, commit guard, gates, conformance auditor, claim auditor, harness log. Also when asked whether a project is ready for one.
metadata:
  origin: ecc-js
---

# Harness bootstrap

Six phases against a target repository (0, A–E). **Phase A can refuse, and
refusing is the common outcome** — of four projects surveyed, three were refused
for the same precondition: a never-auto-merge policy that existed only in
someone's head. The fourth lacked one too, and derived it in Phase B. A harness
installed on a project that cannot sustain it is ceremony; it gets abandoned
inside a fortnight, and it burns the idea.

## When to Use

- A repository works from a plan of identified, sequenced tasks and wants gated,
  agent-driven delivery with two human gates.
- A harness is already installed and the reference here is newer (Phase 0
  upgrade path).
- Someone asks whether a project is ready for this flow — Phase A answers it.

Not for a maintenance repository with a change stream and no live plan (see
**Out of scope**), and not for tuning agent configuration (`harness-audit`).

## How It Works

Run it from inside the target repository, in the main session on **Opus** — every
phase here is judgment. `reference/` holds the pattern; read what each phase
names rather than working from memory of how another project did it. In Claude
Code the files are under `${CLAUDE_PLUGIN_ROOT}/skills/harness-bootstrap/`; in
other agents, use the folder this `SKILL.md` was read from.

| Phase | Read |
|---|---|
| 0 · existing harness | the Phase C set, to diff against |
| B · policy | `reference/policy-derivation.md` only |
| C · generate | `rules.md`, `gate-design.md`, `task-runner.md`, `conformance-auditor.md`, `claim-auditor.md`, `commit-guard.md`, `log-format.md`, `context.md`, `harness-targets.md` |
| C · optional | `preflight.md`, `sweep.md`, `segment.md` |
| E · growth | `vendor-skill.md` |

Every reference line is marked **`[M]` mechanism** — ship it — or **`[B]`
binding** — re-derive it from this project. Generating means writing files that
name **this** project's real paths, commands and column names inline. Never an
indirection layer: the runners work partly because the format is literally in
the instructions, and an adapter is a place to guess wrong.

### What ships as rules, and what does not

Every rule in `reference/rules.md` §1 was produced by a specific failure and has
held since. Ship them **verbatim, with their origin attached** — a rule without
its incident reads as pedantry and is deleted just before it is needed. The
short list, to orient:

- **Guard every commit — refuse, do not merely check.** A hook, not a habit.
- **Break the code and watch the suite stay green.** A control never seen failing
  is an assertion.
- **A validation command that can report green having run nothing is not one.**
- **The record is written last, from the diff, and audited by someone else.** A
  rule asking the author to check their own claims was measured not to work.
- **Gate 2 is not asked while a review is still running.**
- **A conformance verdict is not evidence of correctness.**
- **An implementer may always raise a gate, never lower one.**

**Left deliberately empty, to be earned:** the never-auto-merge categories (Phase
B derives them), tier thresholds, tripwire numbers and medians. Importing them
hands a team rules whose reasons they have not lived. The **model split** is the
exception: Opus where a miss cannot be corrected forward, Sonnet for work bounded
by an exit condition (`gate-design.md`) — it is mechanism, not a threshold.

**Project-specific skills are not generated.** They are the residue of a vendor
behaving against its own documentation. Phase C wires the trigger; Phase E grows
them.

### Phase 0 — Check for an existing harness

Look for one already installed: a harness file with a gate table, a
`task-runner` skill, a conformance auditor, a registry, a harness log.

**If any exists, report what you found and stop for a decision.** Do not
overwrite silently and do not install alongside — two files governing the same
thing is the drift the rules warn about.

| | |
|---|---|
| **Generated** — runner, auditors, guard, registry and log scaffolding | replaceable; the newer reference is probably better |
| **Reviewed** — an approved never-auto policy, rules earned from the project's own log, tuned thresholds | **preserve.** An earned rule outranks a generated one |

**A log with rows in it is the strongest signal to preserve.** Every generated
file carries a stamp — a first-line comment naming `harness-bootstrap` and the
date. A later run compares stamps, regenerates the generated files and keeps the
reviewed ones. Say file by file what you replace and what you keep, before
writing.

### Phase A — Assess, and be willing to refuse

| # | Precondition | Look for | If absent |
|---|---|---|---|
| 1 | A task list with **stable IDs and dependencies** | a plan document, a tracker table, issue labels | **stop** — nothing can select or sequence work |
| 2 | A **per-task risk signal** | a Size/Effort/Risk column or label | **stop** — gates and models have nothing to key on |
| 3 | A **written** never-auto-merge policy | a security section, locked decisions, a risk register | **Phase B** — the usual failure |
| 4 | A **per-task pass signal** | test scripts, CI config, per-task exit conditions | **stop** — "done" is unfalsifiable |

**Specify properties, not columns.** A table carrying `ID · Task · Writes ·
Depends · Exit condition · Sz · Trace · St` satisfies 1, 2 and 4 more completely
than one copied from elsewhere. Never prescribe a shape; check the property.

**The assessment is a table, not prose:** `Precondition | Evidence (file, path or
line) | Verdict (pass · Phase B · stop)`, then one closing line naming the
outcome. A pass without cited evidence was not assessed. If 1, 2 or 4 fail,
**stop and say what to write first.** Never install a partial harness.

Two sizing notes worth saying at this point: ceremony is roughly fixed per task,
so **prefer fewer, larger tasks**; and a plan whose tasks are all trivial does not
need this harness.

### Phase B — Derive the never-auto-merge policy

**Read `reference/policy-derivation.md`.** It holds the single test — *if this is
wrong and ships, can it be corrected forward?* — the output rules, and two worked
examples whose right answers differed. This is the piece that cannot be
templated.

Write it into the harness file under a status line:

```
Never-auto policy: DRAFT — owner has not reviewed
```

**Do not commit it**, and stop. The owner reads it and changes the line to
`REVIEWED <date>`. A policy adopted without being read is not a policy.

### Phase C — Generate

**Refuse while the policy line says `DRAFT`.** Then read the Phase C references
and write these into the project, naming every path in the report. Defaults are
for Claude Code; `harness-targets.md` gives the Codex, ZCode and Kimi forms and
how to tell which agents the project uses.

| File | From | Notes |
|---|---|---|
| `AGENTS.md` — the shared harness file (or `CLAUDE.md` alone in a Claude-only project, if the owner prefers) | `rules.md` §1, `gate-design.md`, Phase B | rules **with their origin** · two tracks · gate table on this project's risk signal · the policy · **empty** tripwire and threshold slots |
| `CLAUDE.md` | `harness-targets.md` | first line `@AGENTS.md`, then only Claude specifics: model map, agents, skills |
| `.agents/skills/task-runner/SKILL.md`, with a committed relative symlink at `.claude/skills/task-runner` | `task-runner.md` | the sequence, bound to this plan. Edit the real file, never through the link |
| `.claude/agents/plan-conformance-auditor.md` | `conformance-auditor.md` | `model: sonnet`, `tools: Read, Grep, Glob`; states its bound |
| `.claude/agents/claim-auditor.md` | `claim-auditor.md` | `model: opus`, `tools: Read, Grep, Glob, Bash`; states that it sabotages and restores |
| `.claude/registry.md` | `task-runner.md` step 0 | the lock the guard reads; add it to `.prettierignore` |
| `.githooks/pre-commit` + `git config core.hooksPath .githooks` | `commit-guard.md`, `templates/pre-commit` | or chain into husky/lefthook if present. Test the shipped file, not a copy |
| `CODEOWNERS` + branch protection, where the platform supports it | Phase B | never-auto categories as required-review paths |
| the harness log | `log-format.md` | **the engine** — headers only, no seeded medians |
| a deferral queue | `task-runner.md` | rows carry an owning task, or they are notes |
| `.gitignore` entries | `task-runner.md` | run plans and `.review-work/` — run state stays out of history |
| `.claude/hooks/context-budget.mjs` + settings entry — **ask first** | `context.md`, `templates/context-budget.mjs` | opt-in; warns at a token budget so long runs hand off instead of degrading |

**Local skills, not global.** They live in the project so they can name its
facts and grow from its runs. The harness file is read every session, and
`.claude/skills/`, `.claude/agents/` and `.agents/skills/` register on their own —
no further wiring.

**Optional, only where the project's shape earns them** — each reference states
its own evidence count, and none exceeds two runs:

| Component | From | Needs |
|---|---|---|
| phase preflight | `preflight.md` | phase-scoped work and a decision log |
| workstream sweep | `sweep.md` | a register of open questions with a `blocks` relation |
| segment runner | `segment.md` | several genuinely independent low-risk tasks |

Batches of well-specified work **inside one task** are not a component: the
task-runner's implement step may hand them to the `delegate-tasks` skill on the
Standard track (`task-runner.md` step 2).

### Phase D — Calibrate, and let the project write its own rules

Run one task — the lowest-risk one whose exit condition is fully specified; the
first row exists for calibration. Read the log row. **The first failure writes the
first rule.**

Medians, tripwire numbers and tier boundaries are computed from the log once rows
exist, never before. After about five tasks, read `Missed by harness`: empty
across five is evidence to loosen a gate; non-empty is the reason not to.

**Expect to be wrong.** The origin harness was corrected about fifteen times in
its first 21 tasks, and five of its reasoned-from-first-principles rules were
disproved by its own log (`rules.md` §3) — one of them twice.

### Phase E — Growth

**Vendor surprises.** When a library behaves contrary to its documentation, write
a named skill **before the session exits** — it analyses that session. Format in
`reference/vendor-skill.md`. These are the highest-value artifacts the harness
makes, and none could have been generated up front.

**Rules from the log.** Each incident that produces a rule adds it to the harness
file with its story. Over time earned rules outnumber generated ones — which is
the point.

## Examples

**Refusal.** A repository has a README, tests, and work tracked as free-form
issues with no IDs or dependencies:

```
| Precondition | Evidence | Verdict |
|---|---|---|
| 1 task list with IDs + deps | issues have no stable id, no blocks relation | stop |
| 2 per-task risk signal | no size/risk label on any issue | stop |
| 3 written never-auto policy | SECURITY.md covers disclosure only | Phase B |
| 4 per-task pass signal | `npm test`, CI on push | pass |
Outcome: refused. Write a plan table with ID · Depends · Size · Exit condition first.
```

**Install.** A plan with `ID · Writes · Depends · Exit · Sz · St` columns and a
risk register: Phase B drafts four categories citing risk ids, the owner flips
the line to `REVIEWED`, Phase C writes the files above, and Phase D runs the
smallest task end to end and reads its log row.

## Out of scope

**A project already in production with no live plan** has a change stream, not a
task list, and needs a different unit of work — do not force it into this shape.

## Constraints

- Refusing is a valid and common outcome. Say so plainly and name what to write.
- Never install a partial harness to be helpful.
- Never copy a threshold, a tier boundary or a policy category from another
  project.
- Never commit the derived policy; never generate while it says `DRAFT`.
- Pass `model` explicitly on every subagent dispatch — an agent file's pinned
  model otherwise wins, and the riskiest task silently gets the cheapest reviewer.
