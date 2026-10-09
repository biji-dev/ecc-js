---
name: delegate-tasks
description: "Delegate a batch of well-specified tasks to parallel Sonnet builders behind deterministic gates. The main session (Opus — architect and diagnostician) designs or diagnoses, writes one spec per task (build, fix with root cause and a red-to-green regression test, or check with typed findings and no edits), dispatches builders in waves, gates the result on the project's own commands, then integrates and reviews. Claude Code first; Codex and ZCode supported. Use when the user invokes /delegate-tasks, asks to delegate a batch of builds, fixes or checks, or names the architect-builder or spec-driven delegation pattern. Not for single or judgment-heavy tasks."
when_to_use: "Deliberate invocation, for 2 or more well-specified tasks with disjoint files and command-decidable acceptance. Never auto-route an ordinary feature request, a single bug or a one-off task here — the spec-writing overhead only pays at volume."
metadata:
  origin: ecc-js
---

# delegate-tasks — architect on Opus, builders on Sonnet

The main session is the **architect and diagnostician**: it understands the work,
makes the design decisions, diagnoses defects, and writes one spec file per task.
Builders — Sonnet subagents with the same tools as any agent — do the real work
from those specs. **Commands decide, not claims:** the session gates the combined
result on the project's own checks, and checks the builders' file scope with git
rather than trusting their reports. Then it integrates and reviews.

One machinery, three kinds of task:

- **Build** — implement well-understood feature slices.
- **Fix** — repair diagnosed defects; each spec carries the root cause and a
  red→green regression test.
- **Check** — examine many items and report typed findings, without editing.

What never delegates: understanding, design, and **diagnosis**.

## When to Use

- Two or more tasks, each with acceptance decidable by commands (typecheck,
  scoped tests, build, lint, count checks) or, for visual work, by a separate
  reviewer reading a screenshot or an accessibility snapshot.
- The contracts between tasks — routes, signatures, type names, file ownership —
  can be fixed **before** any builder starts.
- Inside a gated harness (`harness-bootstrap`): the task runner's implement step
  on the **Standard** track. Gate 1 approves the slicing table, and that replaces
  this skill's spec-index stop.

Handle directly instead, and say why: a single bug (diagnosis is most of the
work); design decisions that must be made mid-flight; tasks that must edit the
same files; judgment-heavy or taste work; **never-auto categories, migrations and
auth changes**; and chains across plan tasks (the harness's segment runner).

## How It Works

### Phase A — Triage (main session)

Read the request — feature doc, plan slice, bug backlog, audit findings — and the
code. Delegate only when every condition above holds. State the decision and the
model for each role in one line before going on.

### Phase B — Specs (main session)

1. **Decide and diagnose now.** For fixes, the root cause in a spec comes from the
   main session's diagnosis, never from a builder's guess.
2. **One directory per run:** `.claude/tasks/<run-id>/NN-slug.md` (gitignored), or
   `docs/tasks/<run-id>/` when the specs should be versioned. A shared directory
   once let a glob pick up a previous run's leftover specs.
3. **Spec rules** — what makes parallel builders safe:
   - **Disjoint file sets.** Two builders never edit the same file. If two tasks
     need one shared file, merge them or sequence them.
   - **Contracts verbatim and identical** in every spec that touches them, citing
     where they come from (a plan row, a decision id). Two strangers building from
     these specs must produce parts that click together.
   - **Acceptance = commands**, with what "green" means for each. Where a count is
     the point — call sites migrated, rows copied — state the exact count and the
     command that measures it.
   - **Scoped acceptance only.** The full suite is the session's job, once.
   - **Patterns to imitate** — existing files that already do it right.
   - **Repo rules** — the handful of project rules this slice could break, quoted.
   - **Copy and naming are decided, not delegated.** Owner-approved strings go in
     the spec verbatim.
   - **Fix mode:** the regression test is shown **red on the current code first**.
   - **Check mode:** never authorises edits.
4. **Waves.** Specs that create a contract or shared copy are **wave 0**; their
   dependents wait for them. Everything else in a wave must be truly independent.
5. **Show the spec index** — one line per spec, with its wave — and get a
   go-ahead (or Gate 1, in a harness) before dispatching. This is the cheapest
   place to veto the decomposition.

Templates for the three spec kinds are in `reference/spec-templates.md`.

### Phase C — Execution (Claude Code)

1. **Dispatch one wave at a time.** For each spec in the wave, an Agent call with
   **`model: "sonnet"` passed explicitly**, all of the wave's calls in **one
   message** so they run in parallel. The builder brief:

   > Read `<spec path>` and implement it exactly. Read every source file it
   > references before writing code, and follow the patterns it points to. Run each
   > acceptance command in the spec and fix your work until they pass — never
   > report a check you did not run. Edit only the files in the spec's Files list.
   > Never modify a test to make it pass. Do not commit. No host-level operations
   > (global installs, image pulls, restarting shared services) and no
   > repository-wide suite. If the spec contradicts the code or is missing
   > something you need, stop and report it as blocked instead of guessing. End
   > with: `STATUS: done | blocked`, `FILES:` the files you changed, `COMMANDS:`
   > each acceptance command with its last line of output, `BLOCKERS:` or `none`.

2. **A blocked wave-0 spec stops the run.** Fix the spec, not the code, and
   re-dispatch that builder alone.
3. **Check the fence with git, not the report.** `git status --porcelain` against
   each spec's Files list. A file outside every list is a finding; revert it or
   fold it into a spec deliberately.
4. **Gate on commands, in the main session.** Run each spec's acceptance commands
   and the run's combined gate (typecheck, lint, the scoped tests the specs
   touch) as **separate commands, one result line each** — never one `&&` chain,
   which hides every check after the first red. Keep output small (errors-only
   reporter flags); a huge green log once broke a gate that had passed.
5. **Fix rounds — at most three.** For a red gate, dispatch a Sonnet fixer with
   the failing output, fenced to the specs' scope: *"if the fix belongs outside
   these files, report that instead of editing."* Re-run the gate after each
   round. Still red after three: stop and report.
6. Builders that share state (one test database, one port) cannot run their
   acceptance in parallel. Put them in sequential waves, or give each its own
   resource.
7. **The full suite stays with the session.** List it as not yet covered until
   it has run once.

A Claude Code **Workflow** variant is possible only when the user explicitly asks
for a workflow: load the `workflow-authoring` skill and keep the same waves,
fence check, gates and three-round cap. Codex and ZCode forms are in
`reference/other-harnesses.md`.

### Phase D — Integration and review (main session)

- Read the full diff. Check the seams: do parts built from different specs match
  the contracts? Error handling on new paths? Tests asserting behaviour rather
  than implementation? Nothing outside spec scope?
- **Fix mode:** the regression test asserts the **reported symptom**, and the root
  cause is addressed — no bare try/catch, no symptom-only patch.
- **Check mode:** re-run any finding a command can decide; sample the rest before
  anyone acts on them.
- **Visual output:** a separate reviewer — never a builder — reads the
  screenshots or the accessibility snapshot against the spec's visual contract.
  **The actor that made a change never judges its own output.**
- Blocked tasks: fix the **spec**, re-dispatch only that builder.
- Run the project's strongest check once yourself.
- **Commit gate.** Standalone: present the diff summary and proposed conventional
  commit messages, and commit only when the user confirms. Inside a harness: the
  task runner's own commit points and Gate 2 apply instead.
- Report what was built, fixed or checked; what each gate verified, with its
  output line; and what remains.

## Examples

**Build, three slices.** A plan task adds a CSV export. Spec 01 (wave 0) fixes
the contract — `serializeOrders(rows): string` and `GET /orders/export.csv`.
Specs 02 (service) and 03 (route + UI button) are wave 1, disjoint files, each with
`tsc --noEmit` and a scoped test as acceptance. The session dispatches 01, checks
its fence and gate, then dispatches 02 and 03 in one message, gates, integrates.

**Fix batch.** Four diagnosed defects from a bug list, each with its root cause
and a regression test shown red first; one wave of four Sonnet builders; the
session confirms each test was red before the fix and green after.

**Check.** One check spec per route file: "report handlers missing the
permission check — where, evidence, severity; edit nothing." The session re-runs
the findings a grep can decide before reporting.

## Constraints

- **Diagnose before delegating a fix.** A builder guessing a root cause is the
  failure this skill exists to prevent.
- **The actor that made a change never judges its own output.**
- **Builders and fixers never commit.**
- **Pass `model` on every dispatch** — Sonnet for builders, fixers and check
  specs; the main session stays on Opus.
- Builders' scoped commands are the fast tier; the session's combined gate is the
  strong tier and runs at least once before the report.
