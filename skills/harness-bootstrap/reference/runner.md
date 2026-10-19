# Reference: the runner

The most-validated artifact here. Plan mode: 21+ runs in the origin project and 10
in a second, revised roughly twenty times between them. Change mode: a third
project's eleven-step workflow, about 120 sessions behind it. **One runner skill
serves both**: the front-ends differ until Gate 1, and the sequence after it is the
same.

**`[M]` = mechanism, ship it.  `[B]` = binding, re-derive from the project.**

## Shape

`[M]` **Stateless.** State lives on disk — the registry row and the unit's state
file (`scope-guard.md`) — so any session picks up cold and a crash or a compaction
loses nothing but the current step.

`[M]` **No hand-off.** After a unit lands: close its state file, offer a `/compact`
with the keep-line (`context.md`), announce the next unit in one line, and start it
only if the owner's instruction covers it. Never ask the owner to open a session,
paste a hand-off note or say what is next.
> Origin: plan mode first shipped "one task per session, then exit". In the third
> project 28 of 118 sessions ended in a hand-off, about 90% of them triggered by a
> budget rule that said "start a new session" (`rules.md` §3).

`[M]` **The main session coordinates and reviews.** It owns the tier, the gates,
the plan text, the slicing, every brief, the critique of every report, triage, the
scope guard, the decision log, the commits and the merge. Above Small it writes no
feature code and reads no file whole: it reads reports, `git diff --stat`, hunks
of critical files and gate result lines. **A report is a claim** it checks against
the plan, the diff and the Scope block before acting on it.

`[M]` Short, pointing at the harness file rather than restating it. Production
runners grew to about 250 lines; past that, move rules into the harness file and
cite them.

`[M]` **Generated to `.agents/skills/task-runner/SKILL.md`**, with a committed
relative symlink at `.claude/skills/task-runner` (`harness-targets.md`). An
upgrade keeps an existing runner's name through the manifest's `roles`.

## Task type first — before the tier

`[M]` Classify by **what will change** — `git status --porcelain` (staged,
unstaged and untracked) or `git diff --name-only <base>` plus untracked files —
never by feel. Check in this order; unsure → the heavier type.

| Type | Test | Runs |
|---|---|---|
| **Ops** | a deploy, migration run, production data fix or credential rotation, even with no repo change | its runbook, owner approval first |
| **Answer** | nothing changes — a question, an investigation, a review, a status, a plan only | no steps; the answer quotes its evidence. **A bug's cause, even with no fix, takes step 1's root-cause route** |
| **Docs-light** | every changed path is prose, and no test or script reads it | write, format, lint, commit; one ledger row |
| **Docs-heavy** | the same, but a rule file, a runbook, a change request, or ~200+ lines others act on | Docs-light + one review by the other model family + one fix pass |
| **Code** | anything else — docs mixed with code, a doc a test reads, a hook | the tiers (`gate-design.md`) and the sequence below |

`[B]` Which files are rule files; the line threshold for Docs-heavy; how to tell
that a test reads a doc. The harness's own files — `AGENTS.md`, `CLAUDE.md`, the
skills and agents — are read by the agent-docs lint, so a change to them is
**Code**, never Docs.

`[M]` **Docs units still go through the lock and the merge policy.** They take no
Scope block, but they claim a registry row, branch and land like a Small change —
the guard refuses an unclaimed commit while a run holds the lock on this checkout, and where the
merge policy sends every tier to the owner, a docs change waits for the owner too.

## The sequence

```
0a resume      a held registry row or an existing unit branch = a stopped run; verify each step against evidence
0  claim       type · tier · unit · overlap · branch (+ worktree) · lock · state file
1  ground      plan mode: sync both ways, follow the trace, read follow-ups owed
               change mode: investigate → plan + Impact Analysis + Scope block → plan check (Full)
                                                          ══ GATE 1 ══  one decision sheet
2  implement   slices with their tests; an executor per slice from the risk map
3  sync        re-sync the mainline before auditing
4  conform     lane A — the conformance auditor, against the plan and the Scope block
5  run live    start it, exercise it with real data
6  integrate   third parties: assert the downstream effect, not a 200
7  visual      UI only — structure before pixels
8  review      routed reviewers + the second family · lane B blast radius · adversarial (Full)
               · bounded fix rounds · the FULL verify run
8a docs        the doc sweep
8b record      written last, from the diff, as fields
8c claims      lane C — the claim auditor (claims, test honesty, fix commits)
                                                          ══ GATE 2 ══  by the merge policy
9  land        guard → land commit → release the lock → merge → push on the owner's word
10 teardown    stop what was started; close the state file; offer /compact; next unit
```

`[M]` 3 → 4 order matters: audit the merged reality, not the pre-sync diff.

`[B]` 5, 6 and 7 are conditional on what the unit delivers. No UI drops 7; no
third-party surface drops 6.

**Change installs that already number eleven steps** keep their numbers; the
correspondence is: investigate, plan, plan check → 1 · decision sheet → Gate 1 ·
implement and tests → 2 · diff review → 8 · cross-check A/B/C → 4, 8, 8c ·
regression → 5–8 · doc sweep → 8a · ship → 9.

## Which steps each tier runs

| Step | Trivial | Small | Full |
|---|---|---|---|
| 0 claim | type + tier in the claim line | + Scope block, frozen when stated | + Scope block for Gate 1 |
| 1 ground | — | light: cause or reuse noted in the plan | full: root cause, Impact Analysis, plan check |
| Gate 1 | — | **auto** unless the risk map or the policy is hit | owner |
| 2 implement | the session | the session or one executor | one executor per slice |
| 4 conform | — | against the Scope block | against plan + Scope block, and re-audit |
| 5–7 live | if it changes behaviour | **yes — never dropped** | yes |
| 8 review | — | one reviewer + language reviewer; lane B | all routed + second family; lane B; adversarial |
| 8 fix rounds | — | one re-review | per `gate-design.md` |
| 8 verify | scoped | FULL once before merge | FULL |
| 8a docs | in the same commit | in the same commit | a separate sweep |
| 8b record | ledger line | fields | fields |
| 8c claims | — | **skipped; the record is fields only** | blocking |
| Gate 2 | by the merge policy | by the merge policy | owner |

`[M]` **A P0 or P1 from review promotes Small to Full** — the unit then runs the
plan check, lane A against a written plan, lane C and the adversarial pass.

## Per-step notes

**Step 0a — resume.** `[M]` A held row or an existing unit branch means resume, not
start. Read the state file; the row's `Step` says where the run *thought* it got
to — **verify, do not trust the marker.** Restart from the earliest step you cannot
evidence; redoing a step is cheap and never wrong. Commit uncommitted work first,
as its own commit. Never reclaim a row you do not own.

**Step 0 — claim.**
- `[M]` **State the claim line:** unit, type, tier, whether it touches the risk map's
  critical code or a never-auto category, both gate decisions, the model for each
  role, and on Small the Scope block.
- `[M]` **The lock is also the concurrency guard.** One row per active unit, held
  for the whole run, its `Step` updated at every boundary. The commit guard reads
  it (`commit-guard.md`); in `SCOPE=checkout` the row names its worktree.
- `[M]` **The registry is also a resource lock** where units share machines —
  ports, isolated stacks, migration slots in the same row.
- `[M]` Compare this unit's write set against every other held row. Overlap means
  sequence, not parallelise — say so and stop.
- `[M]` **One unit in flight**, plus hotfixes. Planning the next (step 1) may start
  while this one waits on Gate 2; its step 2 waits.
- `[B]` Branch naming (carrying the task id, or matched by the Branch cell) ·
  worktree convention.

**Step 1 — ground, plan mode.**
- `[M]` **Sync both directions.** Behind: pull before branching. **Ahead:** another
  session left unpushed work, and this push would publish it — ask first.
  > Origin: the local mainline was four commits ahead, and no step looked.
- `[M]` Read the follow-ups doc: rows scheduled for this unit are part of its
  requirement. Verify the dependency list before presenting it.

**Step 1 — ground, change mode.**
- `[M]` **Investigate.** A bug: no fix without the root cause, decided by Opus or the
  second family's `investigate`, **never by a search agent**, which returns
  locations and quoted evidence only. A feature: read the touched modules, list the
  invariants, reuse patterns. A third-party surface: current vendor docs first;
  measurements in the repo still win.
- `[M]` **Plan + Impact Analysis** (Full): files, functions, data flow, edge cases,
  tests; for every caller, invariant and dependent flow, how it is preserved, with
  function names and line ranges. The plan opens with the **Scope block**.
- `[M]` **Plan check** (Full): the blind dual plan (`cross-model.md`), then a plan
  comparison the session merges. **A failed plan is revised, never carried on.**
- `[M]` **Nobody reads the plan whole.** Grep the section; paste the slice verbatim
  into its brief.

**Gate 1 — one decision sheet.** `[M]` Every open question, once, with a default
(`scope-guard.md`). Its slicing table is approved here too: slice · files ·
executor · order · gate · expected counts · risk. Every acceptance criterion maps to
a slice, or the table is incomplete.

**Step 2 — implement.**
- `[M]` **An executor per slice, from the risk map** (`gate-design.md`): critical
  slices to the Opus `implementer` agent, serially, never in parallel; cold slices
  to Sonnet builders through `delegate-tasks`, or to the second family; the session
  may implement Small itself. Never-auto, migration and auth slices are Opus only.
- `[M]` **One slice per agent.** A fix round is split by area into several.
  > Origin: one agent handed a whole fix round ran 309 calls, to 368K of context.
- `[M]` **After each slice:** read its report and `git diff --stat`, run the drift
  check, and on critical code send one reviewer **on a different model** over that
  slice's diff before the next slice builds on it. A follow-up goes to the same
  agent while its context is small. Update the state file.
- `[M]` **Tests land with their slice**: a bug's regression test fails without the
  fix; a feature's golden path and Impact Analysis edge cases. Prove each with a
  control (`delegate-tasks` control specs): break the protection, paste the red line,
  restore, paste the green line.
- `[M]` A slice runs its targeted tests only. The session runs a scoped verify after
  a slice that crossed packages, and the FULL verify once at step 8 — **never once
  per slice**.
  > Origin: one change request ran the full suite 39 times, 8.4 hours.
- `[M]` Commit at every meaningful step, naming paths, never `git add -A`.
- `[M]` Mutation runs follow `rules.md` §1.

**Step 4 — conform.** `[M]` Dispatch `plan-conformance-auditor` with
`model: "sonnet"`. A fix round that introduces a new blocking finding is a stop
(`rules.md` §2). A scoped re-audit after every fix round. Tell it which columns are
written at land.

**Steps 5–7.** `[M]` Every validation line follows `rules.md` §1. Live pass: drive
the real surface, including refusal and empty states, and follow one figure across
every surface that states it. Visual: assert against the accessibility tree or a
DOM snapshot; send screenshots to a model that reads images.

**Step 8 — review.**
- `[M]` Route reviewers by what the diff touched, from the specialist trigger table
  (`gate-design.md`); pass `model` and `effort` on every dispatch. Full runs the
  second family's review beside them, then lane B (`blast-radius-auditor.md`) and the
  adversarial pass (`cross-model.md`) — independent, in **one message**. Small runs
  its reviewers and lane B.
- `[M]` **Each dispatch gets its own scratch directory**, `.review-work/<name>/`.
  Briefs forbid host-level operations and repository-wide suite runs.
- `[M]` **Hold edits until every reviewer has reported.**
- `[M]` **Reproduce before fixing.** Read the cited line, run the single test or
  probe the endpoint. A finding that does not reproduce is **retracted**, never
  "fixed".
  > Origin: about 6% of claimed gaps in the third project were artefacts — a
  > scaled measurement, harness timing, another worktree's test run.
- `[M]` **Triage by scope class, then severity**: OUT → follow-ups whatever its
  severity; P3 → follow-ups unless on a line this round already changes.
- `[M]` **Fix rounds** are bounded by `gate-design.md`, and each fix gets a
  regression test proven to fail without it. Fix groups on critical code go to Opus.
- `[M]` Then the **FULL verify** (`context.md`): every gate, one line each, each red
  attributed against the merge base, working tree included.

**Step 8a — docs.** `[M]` Only when the diff changes a public behaviour, a named
invariant, a module description or user-visible output. List stale docs with a
search over the doc tree; rewrite the stale sections, never append. A change to a
rule file updates every document that repeats the rule (`rules.md` §1).

**Step 8b — write the record, from the diff.** `[M]` Now — not during the run and
not from memory — write the deviations, the controls evidence, the Gate 2 brief and
the draft log row, with the final diff open. **As fields, not prose:** verdicts,
finding counts by severity, commit hashes, test counts with the command that
produced them, follow-up rows, elapsed. Delete any sentence you cannot point at a
line for.
> Origin: two tasks took three and five claim-audit rounds; every false claim was
> in the record or a commit message, not the code.

**Step 8c — claim audit.** `[M]` Dispatch `claim-auditor` with `model: "opus"`
(`claim-auditor.md`). Blocking on Full. A second consecutive `FALSE CLAIMS` switches
to quote-or-delete.

**Gate 2.** `[M]` Brief: verdicts · unresolved findings · diffstat · what is still
running · **the step ledger and its lists** (`context.md`). Never presented while a
review round is outstanding. Decided by the merge policy (`gate-design.md`).

**Step 9 — land.**
- `[M]` **Order:** run the guard → land commit **on the unit branch** (status,
  evidence, log row, closed state file) → release the row → merge with `--no-ff` →
  push only on the owner's word. Releasing after the merge cannot work under
  `SCOPE=repo`: the guard refuses a mainline commit while any row is held.
- `[M]` **Re-verify if the mainline moved** since step 8's verify, before an
  auto-merge.
- `[M]` **Every action idempotent.** A resumed run reaches land twice.
- `[M]` Write the merge message to a file; `git merge` does not read stdin.

**Step 10 — teardown.** `[M]` Stop everything started, by recorded PID only, and
confirm nothing still listens on the claimed ports. If a library behaved contrary to
its documentation, write the vendor skill now (`vendor-skill.md`). Close out the
follow-ups doc (`scope-guard.md`), then the no-hand-off close above.

`[B]` Validation commands · reviewer routing · plan path and column names · the
version or release step · where artifacts live.

## The implementer agent

`[M]` Generated to `.claude/agents/implementer.md`: `model: opus`, `effort: high`,
`tools: Read, Edit, Write, Grep, Glob, Bash`. Dispatched with `model` passed
explicitly — `"sonnet"` for a cold slice. Its file says:

- work only in the worktree the brief names, by absolute path;
- read `AGENTS.md` and every rule file the brief lists (`--rules-for`);
- **follow the slice literally**; on divergence from what the slice assumes, stop,
  change nothing further, and report it;
- run only the targeted tests and the type check of what it touched; never the
  whole suite; never weaken a failing test;
- commit the slice; never push, merge, rebase or touch another branch; start no
  servers or watchers;
- a defect outside the slice is reported with a proposed scope class, never fixed;
- write the report to the path the brief gives — commits, files, each command with
  its result line quoted, deviations, divergence, open questions — and return a
  summary of at most fifteen lines.

`[M]` **Never a general-purpose agent for implement or fix work** — its cold prefix
was measured at about twice the implementer's.

## Working from a change request

`[M]` **A change request or milestone document is the plan — never regenerate
it.** Re-verify it against the mainline first (citations, linked follow-ups, what
already shipped): requests go stale both ways. Its impact section is step 1's
Impact Analysis — verify and extend it, never derive a parallel list.

`[M]` **The steps run per milestone**, not per request. A risky milestone lands
alone; split pure moves from interface changes. `[B]` A milestone cap in
production lines, empty until the log earns one.

`[M]` Close out in the document itself: the milestone row marked shipped with scope
corrections, wrong claims struck through in place.

`[M]` No request yet → writing it is the work (`superpowers:brainstorming`, where
installed).

## What is *not* in the sequence, deliberately

`[M]` No step decides whether the work is *right* — only whether it matches the
plan, runs, survives review, reaches its readers, and says only true things about
itself. Product judgment stays at the gates.
