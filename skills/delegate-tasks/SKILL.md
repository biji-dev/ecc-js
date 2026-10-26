---
name: delegate-tasks
description: "Use when a batch of well-specified work should go to subagents behind deterministic gates — two or more build slices, diagnosed fixes, control tests, check or review fan-outs with typed findings, or a blind second plan — while the main session (Opus) stays architect and diagnostician. Also the dispatch engine for a gated harness (harness-bootstrap): the implement, fix-round, cross-check and doc-sweep steps of a plan task or a change. Use when the user invokes /delegate-tasks, asks to delegate builds, fixes or checks, or names the architect-builder or spec-driven delegation pattern. Claude Code first; Codex, ZCode and Kimi supported. Not for a single bug, a design decision still open, or taste work."
when_to_use: "Deliberate invocation, or a harness step that hands it a slicing table. Standalone: two or more well-specified tasks with disjoint files and command-decidable acceptance. Never auto-route an ordinary feature request, a single bug or a one-off task here — the spec-writing overhead only pays at volume."
metadata:
  origin: ecc-js
  version: 3
---

# delegate-tasks — architect on Opus, executors by risk

The main session is the **architect and diagnostician**: it understands the work,
makes the design decisions, diagnoses defects, and writes one spec file per task.
Executors do the work from those specs. **Commands decide, not claims:** the session
gates the result on the project's own checks, and checks each executor's file scope
with git rather than trusting its report. Then it integrates and reviews.

**Evidence:** 23 delegated runs in one project (about 9 relaunched, every relaunch
traced to a spec or gate defect, never to a builder's skill), and a third project's
slice-per-agent workflow across about 120 sessions. Implementation was never the
bottleneck: on one task review and claim audit took about 250 of 423 minutes.

Five kinds of spec, one machinery:

- **Build** — implement a well-understood slice.
- **Fix** — repair a diagnosed defect; the spec carries the root cause and a
  red→green regression test.
- **Control** — write the test that proves a protection: break the protection,
  paste the red line, restore it, paste the green line.
- **Check** — examine many items and report typed findings, without editing. Review
  and audit fan-outs are check specs.
- **Plan** — a blind second plan from the same brief, by another model, for the
  session to compare.

What never delegates: understanding, design, **diagnosis**, triage and the commit.

## When to Use

- Two or more tasks, each with acceptance decidable by commands (typecheck, scoped
  tests, build, lint, count checks) or, for visual work, by a separate reviewer
  reading a screenshot or an accessibility snapshot. `[B]` Inside a harness, the
  harness file may set a higher threshold; that number wins.
- The contracts between tasks — routes, signatures, type names, file ownership —
  can be fixed **before** any executor starts.
- **Inside a gated harness** (`harness-bootstrap`): the runner hands this skill
  each bounded segment. Gate 1 approves the slicing table, which replaces this
  skill's own spec-index stop.

Handle directly instead, and say why: a single bug (diagnosis is most of the work);
design decisions still open; tasks that must edit the same files; judgment-heavy or
taste work.

## How It Works

### Phase A — Triage and slicing (main session)

Read the request — feature doc, plan slice, change request, bug backlog, audit
findings — and the code. Write the **slicing table**:

```
| Slice | Files | Kind | Executor | Order / wave | Gate | Expected counts | Risk | Deliverable |
```

Every acceptance criterion of the request maps to a slice, or the table is
incomplete. **The executor comes from the risk** — the harness's risk map where one
exists (the `harness-bootstrap` skill's gate design), else the project's own judgment:

| Slice | Executor | How |
|---|---|---|
| copy, mechanical adoption with count gates, UI against a committed contract, tests for cold code, fixes outside critical code, docs | **the second family first** (`implement-cold`, `fix-cold`, `docs`) while it is available and under its budget, else a Sonnet builder — and a Sonnet builder when the slice needs a browser, a service the sandbox cannot reach, or steering mid-run | waves, in parallel when truly independent — twins over a landed contract (web and mobile) included |
| contract or domain logic | Opus implementer | serial |
| critical code — never-auto categories, migrations, auth, money, widely imported modules | **Opus implementer only** | **serial, never in parallel** |

The second family's quota is separate from Claude's: a cold slice there costs the
Claude quota nothing, and its review comes from Claude (a Sonnet reviewer, or the
unit's one Opus review in a harness). In one measured milestone, cold UI slices ran on
the Opus implementer while the second family sat at a quarter of its weekly quota.

**An `executor:` cell overrides the table** — `codex | opus | sonnet | auto`, per
slice or unit-wide; the user's word beats the risk routing, which beats the default.
Handing critical code to the second family or Sonnet is the user's call alone, and
its review is then an Opus reviewer per slice. Each Build and Fix spec states its
executor in `## Executor`.

**Size each slice to one executor context: about 70 tool calls, a peak under
200K.** A larger slice splits before dispatch. An executor that compacts loses what
it read: after a subagent compaction, 147 of the next 170 Reads went back to files
already read. A per-agent `autoCompactWindow` is a backstop, never the plan.
> Origin: one project's study found subagents at 76% of its spend, all of it out of
> sight of the main-thread budget hook, and it has sliced to about 70 calls since.
> Across nine installs in 21 days, 108 of 575 implementer runs passed 200K.

State the decision and the model for each role in one line before going on.

### Phase B — Specs (main session)

1. **Decide and diagnose now.** A fix's root cause comes from the session's
   diagnosis, never from an executor's guess.
2. **One directory per run:** `.claude/tasks/<run-id>/NN-slug.md` (gitignored), or
   `docs/tasks/<run-id>/` when the specs should be versioned. A shared directory once
   let a glob pick up a previous run's leftover specs.
3. **Spec rules** — what makes parallel executors safe:
   - **Disjoint file sets.** Each file appears in exactly one spec. Shared hub files
     — a router, a registry, wiring — stay with the session.
   - **Contracts verbatim and identical** in every spec that touches them, citing
     where they come from.
   - **Acceptance = commands**, with what "green" means and what each one covers: a
     type check whose config leaves out the test files says nothing about them, so
     name that gap or add the command that closes it. Where a count is the point,
     state the exact count — **measured now**, not estimated — and the command that
     measures it.
   - **Scoped acceptance only.** The full suite is the session's, once.
   - **Pin and ratchet tests broken by design** are listed in the spec, with the
     new expected value, or the gate reads them as regressions.
   - **Patterns to imitate**, **repo rules** quoted (in a harness:
     `node scripts/check-agent-docs.mjs --rules-for <files>`), and **copy decided,
     not delegated**.
   - **Fix and control specs:** the test is shown **red on the current code first**.
   - **Check specs** never authorise edits, and their findings are typed.
4. **Order.** Specs that create a contract or shared copy run first; dependents wait.
   Parallel waves only for truly independent leaves.
5. **Spec check before dispatch** — a check over the specs themselves, by the
   session or one check spec: every file in exactly one spec; contracts identical
   across specs; counts re-measured; tests broken by design listed; no hub file
   assigned out.
   > Origin: Gate 1 approved the slicing table but never saw the spec text, so every
   > spec defect in those runs got past it.
6. **Show the spec index** — one line per spec with its order — and get a go-ahead
   (or Gate 1, in a harness) before dispatching.

Templates for every kind are in `reference/spec-templates.md`.

### Phase C — Execution (Claude Code)

1. **Dispatch.** One Agent call per spec, with **`model` and `effort: "high"`
   passed explicitly** — never inherited. Parallel waves go in **one message**;
   serial slices go one at a time. In a harness the call's `description` starts with
   the step tag, `[<unit> s<step> r<n>] <slice>` (the `harness-bootstrap` runner's step
   markers), so the unit's cost splits by step. The executor brief:

   > Read `<spec path>` and implement it exactly. Read every source file it
   > references before writing code, and follow the patterns it points to. Batch
   > independent reads and searches as parallel tool calls in one message; read
   > files whole or in 150+ line ranges, never small slices. Run each
   > acceptance command in the spec and fix your work until they pass — never report
   > a check you did not run. Edit only the files in the spec's Files list. Never
   > modify a test to make it pass. Do not commit. No host-level operations (global
   > installs, image pulls, restarting shared services) and no repository-wide
   > suite. If the spec contradicts the code or is missing something you need, stop
   > and report it as blocked instead of guessing. End with: `STATUS: done |
   > blocked`, `FILES:`, `COMMANDS:` each acceptance command with its last line of
   > output, `BLOCKERS:` or `none`.

2. **Assert the exact number of specs selected** before dispatching a wave. A
   filter that selects zero — or one fewer than the index — is an error, not an
   empty wave. Character classes are the usual cause: a filter written
   `/^[0678]-/` could never match `06-`, so a whole phase dispatched nothing and
   reported green.
3. **Check the fence with git, not the report.** `git status --porcelain -uall`
   against the spec's Files list. Without `-uall`, a new directory shows as one
   `?? src/ui/` line and hides the stray file inside it. A file outside every list
   is a finding; revert it or fold it into a spec deliberately.
4. **Gate on commands, in the main session.** Each spec's acceptance commands and the
   combined gate as **separate commands, one result line each** — never one `&&`
   chain. Errors-only output: a 382 KB green log once broke a gate that had passed.
5. **Per-slice review, by the other family.** After a serial slice passes its gate,
   one reviewer reads that slice's diff before the next slice builds on it — the
   **second family's review** over a Claude-written slice (in the background, while
   the next independent slice starts). A cold second-family slice waits for the
   unit review (a harness's `review-gate.mjs` says `defer`; standalone, a Sonnet
   reviewer reads it). **Never an Opus reviewer per Claude-written slice** — in one
   measured milestone 63 of them found no P0 or P1; Opus reads a slice only when
   critical code went to the second family anyway. Without a second family: a
   Sonnet reviewer on cold code, Opus on critical code, recorded `degraded`. The
   session reproduces each P0–P2 before acting on it. Then integrate. In a harness
   the session commits here, and `review-gate.mjs` names the reviewer; standalone
   the session commits at the end.
6. **Escalation.** A blocked executor, or a review finding that traces to the spec:
   answer it and continue the **same** agent (`SendMessage`) while its context is
   small, or re-dispatch with a revision note in the spec. The architect's ruling
   goes into the spec — into **every** spec that carries the contract it changes, so
   they stay identical — the harness's state file and the commit message, never only
   the chat.
7. **Fix rounds — at most three.** A red gate gets a Sonnet fixer (Opus on critical
   code) **fenced to the current slice's listed files, never a folder** — a fixer
   once wrote the next wave's strings. **Review findings:** P3s never open a fix
   round — they wait for one Sonnet P3 batch, with no re-review; fix groups
   whose files do not overlap go in one brief per area; the re-review reads the fix
   diff only, by the reviewer whose finding was fixed — the second family first,
   Opus again only on critical code with a P1 fixed (a harness's `review-gate.mjs`
   decides). Give it the tail of **both stdout and
   stderr**: type checkers and build orchestrators print errors to stdout. A finding
   is `verified` only when the gate is green. Count maps come from the spec. Still
   red after three: stop and report.
8. Executors that share state (one test database, one port) run in sequence, or each
   gets its own resource. **Pin the repository root** in every command.
9. **Another session may be working in the same clone.** A file outside every list
   may be theirs: look before reverting.
10. **The full suite stays with the session.** List it as not yet covered until it
    has run once.

**Check fan-outs** — reviewers, cross-check lanes, adversarial passes — dispatch in
one message, one brief per reviewer, each with its own `.review-work/<name>/`
directory and, in a harness, the step tag in its description. Findings are typed: severity P0–P3, `file:line`, evidence, why, how to
reproduce, introduced by this diff or pre-existing, and a proposed scope class. Every
P0 and P1 is then **verified** — reproduced or refuted — before anyone fixes it; an
unverifiable one stays blocking. A harness's review workflow
(`.claude/workflows/review.workflow.js`) runs the same fan-out deterministically.

**Plan specs** dispatch two planners from one brief, blind to each other — Opus and
the second family (`codex-run plan-blind` in a harness), or Opus and ECC's
`planner` when no second family exists (recorded `degraded`). The session writes the
comparison: agree · differ, with evidence · one side only, each one-sided item
verified in code.

A Claude Code **Workflow** variant of the build loop is possible only when the user
explicitly asks for a workflow: load the `workflow-authoring` skill and keep the same
order, fence check, gates and three-round cap — it cannot run the gates itself, so
they stay in the session. Codex, ZCode and Kimi forms are in
`reference/other-harnesses.md`.

### Phase D — Integration and review (main session)

- Read the full diff. Check the seams: do parts built from different specs match the
  contracts? Error handling on new paths? Tests asserting behaviour rather than
  implementation? Nothing outside spec scope?
- **Fix and control specs:** the test asserts the **reported symptom** and was red
  before; the root cause is addressed — no bare try/catch, no symptom-only patch.
- **Check specs:** re-run every finding a command can decide; sample the rest.
- **Visual output:** a separate reviewer — never a builder — reads the screenshots or
  the accessibility snapshot against the spec's visual contract.
- Blocked tasks: fix the **spec**, re-dispatch only that executor.
- Run the project's strongest check once yourself — **standalone only.** Inside a
  harness the runner's step 8 FULL verify is that check; run nothing extra on the
  same tree.
- **Commit gate.** Standalone: present the diff summary and proposed conventional
  commit messages, and commit only when the user confirms. Inside a harness: the
  runner's commit points and Gate 2 apply instead.
- Report what was built, fixed or checked; what each gate verified, with its output
  line; and what remains.

## Examples

**Build, three slices, one critical.** A change adds a refund endpoint. Spec 01
(Opus implementer, serial) changes the money service — critical code. Its gate
passes; a second-family reviewer reads its diff; the session commits. Specs 02 (the
route) and 03 (the admin button) are cold, disjoint and independent: one Sonnet wave,
dispatched in one message, fence-checked and gated, then integrated.

**Fix batch.** Four diagnosed defects, each spec with its root cause and a
regression test shown red first; one wave of four Sonnet fixers; the session
confirms each test was red before the fix and green after.

**Check.** One check spec per route file: "report handlers missing the permission
check — P0–P3, `file:line`, evidence, repro; edit nothing." The session reproduces
the P0 and P1 findings a grep can decide before anyone fixes them.

## Constraints

- **Diagnose before delegating a fix.** An executor guessing a root cause is the
  failure this skill exists to prevent.
- **The actor that made a change never judges its own output.**
- **Executors never commit.**
- **Pass `model` and `effort` on every dispatch** — the executor model from the
  slice's risk; Sonnet for check specs unless the harness says otherwise; the main
  session stays on Opus. Effort `high`; `xhigh` only with the reason in the brief,
  `max` never for a whole session — it reaches every dispatch that does not pass its
  own.
- **Critical slices never run in parallel.**
- Executors' scoped commands are the fast tier; the session's combined gate is the
  strong tier and runs at least once before the report — in a harness, as the
  runner's FULL verify, once.
