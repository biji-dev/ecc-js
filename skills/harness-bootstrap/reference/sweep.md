# Reference: the workstream sweep

**Evidence: 1 real run.** That run was unusually valuable — it found a bug in its
own reconciler and disproved a standing claim in its own instructions — but one
run is one run. Install only where the project has a register of open questions
with a `blocks` relation, and non-code work that gates code work.

**`[M]` mechanism · `[B]` binding**

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

`[B]` Register locations · merge-commit shapes · the task-id pattern · what
counts as non-code work.
