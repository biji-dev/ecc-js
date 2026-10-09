# Reference: the harness log

**This is the engine.** Every rule in `rules.md` came from a row here. Everything
else in the harness is machinery; this is what improves it.

One row per completed task, appended at land, **on the task branch, before the
merge** — once on the mainline the commit guard refuses while the run holds its
row. Append at the end of the table and check the neighbouring row survived.

| Column | Why it exists |
|---|---|
| Task · Size · Track | the tier and track the gates and models keyed on |
| **Elapsed** | from the lock claim, cross-checked against `git log --format=%cI`. Owner-wait and machine-down time stated separately. Mark and exclude any row that cannot be reconciled |
| **Defects** | CRITICAL/HIGH from reviewers, as `2C/6H`. Not from the auditors |
| Gate 1 · Gate 2 | as *actually* decided, including overrides and what they covered |
| Verdicts | conformance per audit and re-audit; claim audit per round |
| Retries | conformance loops · review rounds · fix passes |
| Model | which model ran each role (implement · audit · review · claims), **as actually dispatched** |
| **★ Missed by harness** | **the load-bearing column.** What *you* caught that the harness did not |
| Friction | anything that wasted time — a wrong port, a stale env file, a reviewer firing on nothing |

## How to read it

**Act only on repeated patterns** — with one exception. A *logic error* is not a
pattern question: if it will fire on every task deterministically, fix it on the
first occurrence. Roughly half the rules in `rules.md` came from single
occurrences of that kind.

**Empty `Missed by harness` across five tasks** is evidence to loosen a gate.
Non-empty is the reason not to.

**Two of the same friction** means fix the machinery, not the habit. If the log
says *"fix the machinery"* twice, the next run starts by fixing it.

**Parse the table with a parser, never by eye.** An unescaped `|` inside a cell
once split a row into eleven cells; a by-eye recount could not see it. A
recount regex must match every id shape the plan has.

## What it measured, in the origin project

Two regimes, ten times apart, with nothing between them:

```
clean, no CRITICALs          22–59 min
defects surfaced            99–526 min
```

**Fix rounds predict elapsed; defect count does not.** One task found 14 defects
and converged in 129 minutes; another found 8 and took 526 because each round
broke something new.

**Do not seed medians.** They are computed once rows exist, excluding parked time
and unusable rows. A threshold invented before the first task is a guess wearing
a number.
