# Reference: the workstream sweep

**Evidence: 8 runs in two projects** — one project's seven (2026-09-12 to 2026-10-21)
and the other's one (2026-10-18). The first found a bug in its own reconciler and
disproved a standing claim in its own instructions; later ones tracked one
field-measurement warning for four sweeps running before it failed a phase's entry
check. Install wherever there is a register of open questions with a `blocks`
relation, or non-code work that gates code work — the default since v5. In change
mode the register is the follow-ups doc (› Change mode).

**`[M]` mechanism · `[B]` binding**

## When it runs

`[M]` **`harness-due.mjs` says `DUE sweep` seven days or five landings after the
newest report** `[B]`, and the runner queues it as the next unit (`runner.md` ›
Due-checks); before a phase preflight too. A landing is a log row or a mainline
merge, whichever counts more.
> Origin: all eight runs happened because someone asked. Two ran overdue —
> "overdue by seven landings" (2026-09-24), then "by four days and fourteen
> landings" (2026-10-11), whose report opened with "the weekly cadence is enforced
> by nothing mechanical".

`[M]` **The report is committed** at `REPORTS.sweep` in `harness-due-core.mjs`
(default `docs/harness/reports/sweep-<date>.md`), never in a gitignored
directory: job 3 compares against the last report, and the next due-check counts
from it.

## The risk it exists for

`[M]` Non-code work — field measurement, legal opinion, a procurement decision —
arrives *during* the build, and **late answers are expensive**. Nothing else
watches for them. A weekly review item that depends on someone remembering is not
a watch.

## Three jobs

`[M]` **1 · Reconcile status against evidence.** The plan's status column is what
every runner reads; when it drifts, the wrong task gets selected.

- Only ever **advance** a status, and only on a commit you can name.
- Status says done but no commit exists → **report, change nothing.** History may
  be squashed. Advancing on proof is safe; retracting on absence is not.
- In-progress marks are human judgment about work outside the repository. Never
  touch them.

> Origin: the reconciler's own commit pattern matched one of three merge shapes
> and missed a task merged inside a segment, plus a lowercase variant. It reported
> zero drift anyway because the run checked by hand. **Match every shape the
> project actually produces, and verify against real history rather than assuming
> a convention.**

`[M]` **2 · Lead-time warning — the actual point.** For every unanswered
question, resolve what it blocks and how soon that work starts. Warn when a
question gates work that is close *and* the task that would close it has not
begun. **Rank by lead time, not register order:** a month-long benchmark not yet
started outranks a question someone could answer this afternoon. Distinguish a
wall-clock blocker — where the time is simply running — from a stalled one.

`[M]` **3 · Report, and compare against the last report.** A warning seen once is
a note; the same warning three sweeps running is the thing about to hurt. Tag
each with its consecutive count, and say what **cleared**.

## Registers are report-only

`[M]` Never fill a register or answer a question. A field measurement or a legal
opinion leaves no commit, and inferring one corrupts the register that gates the
phase.

## Derived, never stored

`[M]` Velocity is **computed at read time and stored nowhere** — grouped by
defect profile, with `Size` reported alongside only to show whether it tracks.
Storing it creates a second owner for a fact the log already holds.

`[M]` Also report: which tripwires fired and whether any fired twice, and the
deferral queue's **growth rate** — the slope matters more than the level.

## Change mode

`[M]` **The register is the follow-ups doc.** Job 1 reconciles its Status column —
`scheduled <unit>` against that unit's merge, `fixed <sha>` against the commit,
never the other way; job 2 warns on rows scheduled for a unit that is close and
not started; job 3 reports the queue by status and its growth.

`[B]` Register locations · merge-commit shapes, read from `git log --merges
--format=%s` on the real history, never from the convention (one project: its first
pattern caught `Merge P0-07:` and missed `Merge segment P0-12:` and
`merge(P1-12a):`, fixed in 430e3af8, and its later merges read `Merge task/p2-16:
…` and `P3-12 landed: …`; the other: `Merge l-core/T-DATA-037: …` — its first sweep
missed a merge named by its branch and id ranges such as `T-MOD-001..007`, fixed in
19c0abf) · the task-id pattern · what counts as non-code work.
