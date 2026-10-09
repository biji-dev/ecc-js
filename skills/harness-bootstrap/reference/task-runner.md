# Reference: the task runner

The most-validated artifact here: 21+ runs in the origin project and 10 in a
second one, revised roughly twenty times between them.

**`[M]` = mechanism, ship it.  `[B]` = binding, re-derive from the project.**

## Shape

`[M]` **Stateless.** Reads state from disk, runs exactly one task, exits. No
long-lived coordinator, so any session picks up cold and a crash loses nothing
but the current step. This is the property everything else depends on.

`[M]` **One task per session, then exit.** Do not begin the next task in the same
session — context carried forward is context re-read on every call.

`[M]` Short, and pointing at the harness file rather than restating it. Both
production runners grew to about 250 lines; past that, move rules into the
harness file and cite them.

`[M]` **Generated to `.agents/skills/task-runner/SKILL.md`** with a committed
relative symlink at `.claude/skills/task-runner` (`harness-targets.md`).

## The sequence

```
0a resume      a claimed registry row with a Step = a stopped run; verify each step against evidence
0  claim       track · select task · check overlap · branch · claim the lock (+ resources)
1  ground      sync both directions · follow the trace into the spec · read the deferral queue
                                                          ══ GATE 1 ══
2  implement   commit at every meaningful step · may hand a batch to delegate-tasks (Standard)
3  sync        re-sync the mainline before auditing
4  conform     dispatch the conformance auditor; bounded retries
5  run live    start it, exercise it with real data
6  integrate   third parties: assert the downstream effect, not a 200
7  visual      UI only — structure before pixels
8  review      route reviewers by what the diff touched; scoped re-audit of review commits
8b record      write the record last, from the diff, as fields
8c claims      dispatch the claim auditor
                                                          ══ GATE 2 ══
9  land        guard → land commit on the branch → release the lock → merge
10 teardown    stop what was started; confirm nothing still listens; exit
```

`[M]` The order of 3 → 4 matters: audit the merged reality, not the pre-sync diff.

`[B]` Which steps apply: 5/6/7 are conditional on what the task delivers. A
project with no UI drops 7; one with no third-party surface drops 6.

## Per-step notes worth carrying

**Step 0a — resume.** `[M]` A registry row claimed for this task, or a task branch
that exists, means resume, not start. The row's `Step` says where the run
*thought* it got to — **verify, do not trust the marker.** Restart from the
earliest step you cannot evidence; redoing a step is cheap and never wrong.
Commit uncommitted work first, as its own commit. Never reclaim a row you do not
own.

**Step 0 — claim.**
- `[M]` **Decide the track first** — Full or Standard (`gate-design.md`), and
  state it in the claim line with the task, its size, whether it touches a
  never-auto category, both gate decisions and the model for each role.
- `[M]` **The lock is also the concurrency guard.** One row per active run, held
  for the whole run, its `Step` updated at every boundary — that column is the
  crash marker. The commit guard reads it (`commit-guard.md`).
- `[M]` **The registry is also a resource lock** where tasks share machines: ports,
  isolated stacks, migration slots are claimed in the same row. If a test can
  parse the registry against the real config, write that test — a partial claim
  once seized another run's ports.
- `[M]` Compare this task's write set against every other active row's. Overlap
  means sequence, not parallelise — say so and stop.
- `[B]` Branch naming carries the task id, because the guard reads it from there.

**Step 1 — ground.**
- `[M]` **Sync in both directions.** Behind the remote means pull before
  branching. **Ahead** means another session left unpushed work, and this task's
  push would publish it — ask before branching.
  > Origin: local mainline was four commits ahead, and no step looked.
- `[M]` **Read the deferral queue.** Rows owned by this task are part of the
  requirement; discovering one by accident is a grounding failure.
- `[M]` **Verify the dependency list before presenting it.** A list approved at
  gate 1 and found incomplete mid-task is a gate 1 failure.
- `[M]` Full track grounds in full (a written plan with validation commands);
  Standard grounds from the row's trace, its owned queue rows and a short plan.
- `[M]` **Run state stays out of history and format checks:** the run's plan file
  and `.review-work/` are gitignored, the registry is excluded from the
  formatter.
  > Origin: the format check failed on every run until the registry was ignored.

**Step 2 — implement.**
- `[M]` Commit at every meaningful step, staging named paths, never `git add -A`.
- `[M]` **Standard track may delegate.** When the task splits into two or more
  slices with disjoint files and command-decidable acceptance, the session (Opus)
  writes specs and hands them to the `delegate-tasks` skill — Sonnet builders,
  deterministic gates. Gate 1 approves the slicing table, which replaces that
  skill's own spec-index stop. **Never** for never-auto categories, migrations or
  auth diffs, and never across plan tasks — chains across tasks are the segment
  runner's job.
- `[M]` Mutation runs follow `rules.md` §1 — commit first, snapshot-restore.

**Step 4 — conform.**
- `[M]` Dispatch `plan-conformance-auditor` with `model: "sonnet"` passed
  explicitly. Bounded retries.
- `[M]` **A fix round that introduces a new blocking finding is a stop**, not
  another fix (`rules.md` §2). A non-blocking one is fixed or filed.
- `[M]` **Run a scoped re-audit after every fix round**, not only after review.
- `[M]` Tell the auditor which columns are written at land (status, evidence),
  or it flags their absence every round.

**Step 5 — run live; Step 6 — integrate.**
- `[M]` Every validation line follows `rules.md` §1: no pass by cache, skip or
  missing binary; case counts asserted; no `| tail` in an `&&` chain.
- `[M]` **Report every gate, one line each, and never stop at the first red**
  (`context.md` → the verify runner). An `&&` chain of suites hides every suite
  after the first failure.

**Step 7 — visual.** `[M]` Structure before pixels: assert against the
accessibility tree or a DOM snapshot — text, like any other exit condition — and
send screenshots to a model that reads images. Pixel review by a text-only model
is a claim, not a check.

**Step 8 — review.**
- `[M]` Route reviewers by what the diff touched; pass `model` on every dispatch —
  **Opus** on Full track and never-auto categories, **Sonnet** otherwise.
- `[M]` **Each dispatch gets its own scratch directory**, `.review-work/<name>/`,
  named in its brief. Briefs forbid host-level operations, restarting services and
  repository-wide suite runs.
- `[M]` **Hold edits until every reviewer has reported.** A report that arrives
  cut off is re-requested, not read as complete. Resuming the same reviewer to
  re-verify is cheaper than a fresh dispatch.
- `[M]` **Re-audit the review commits** before Gate 2 — fixes made here are
  otherwise never conformance-checked.
- `[M]` Optional cross-model pass on Full track (`gate-design.md`).

**Step 8b — write the record, from the diff.** `[M]` **Now** — not during the
run, and not from memory — write the deviations, the controls evidence, the
Gate 2 brief and the draft log row, with the final diff open. **As fields, not
prose:** verdicts, finding counts by severity, commit hashes, test counts with the
command that produced them, queue rows with owners, elapsed. No narrative
sections. Delete any sentence you cannot point at a line for.
> Origin: two tasks took three and five claim-audit rounds; every false claim in
> both was in the record or a commit message, not the code, and the second
> converged only when whole narrative sections were deleted. Anchor any count to
> a named commit — counts re-measured on a moving tree took six rounds once.

**Step 8c — claim audit.** `[M]` Dispatch `claim-auditor` with
`model: "opus"` (`claim-auditor.md`). `FALSE CLAIMS` is blocking on Full track and
advisory on Standard. A second consecutive `FALSE CLAIMS` is a stop: switch to
**quote-or-delete** — every surviving claim inlines its evidence, every other one
is deleted rather than reworded. `Unverifiable` entries go to Gate 2 as such.

**Gate 2 brief.** `[M]` Verdicts · unresolved findings · diffstat · what is still
running · **the step ledger** (`context.md`). Never presented while a review round
is outstanding.

**Step 9 — land.**
- `[M]` **Order:** run the guard → make the land commit **on the task branch**
  (status, evidence, log row together) → release the registry row → merge with
  `--no-ff` → push. Releasing after the merge is unworkable: the guard refuses a
  mainline commit while any row is held.
  > Origin: logged three times in one project and twice in another before the
  > order was written down.
- `[M]` **Every action idempotent.** A resumed run reaches land twice. Check
  before bumping, flipping status, merging, or appending a log row.
- `[M]` Derived aggregates (rollup tables, counts) move with the row — recount
  them from the rows, never edit by hand.
- `[M]` Write the merge message to a file; `git merge` does not read stdin.

**Step 10 — teardown.** `[M]` Stop everything started, confirm nothing still
listens on the claimed ports, then **exit**. If a library behaved contrary to its
documentation, write the vendor skill *before* exiting (`vendor-skill.md`).

`[B]` Branch and isolation convention · validation commands · reviewer routing ·
plan path and column names · version/release step · where artifacts live.

## What is *not* in the sequence, deliberately

`[M]` No step decides whether the work is *right* — only whether it matches the
plan, runs, survives review, and says only true things about itself. Product
judgment stays at the gates.
