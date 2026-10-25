# Reference: the harness log

**This is the engine.** Every rule in `rules.md` came from a row here. Everything
else in the harness is machinery; this is what improves it.

One row per landed **Small or Full** unit, in either mode, appended at land, **on
the unit branch, before the merge** — under `SCOPE=repo` the commit guard refuses a
mainline commit while the run holds its row. Append at the end of the table and
check the neighbouring row survived. Trivial and Docs units get a ledger line in
their report, not a row.

| Column | Why it exists |
|---|---|
| Unit · Mode · Type · Tier | what the gates and models keyed on — plan task id or change id; plan or change; the tier as finally run |
| **Elapsed** | from the lock claim, cross-checked against `git log --format=%cI`. Owner-wait and machine-down time stated separately. Mark and exclude any row that cannot be reconciled |
| **Defects** | P0/P1 from reviewers, lane B and the second family, as `0/2`. Not from the conformance or claim auditors. A row written before the P0–P3 scale may say `2C/6H` |
| Scope | admitted (BLOCKER/CRITICAL) · filed OUT · drift rejected, as counts |
| Gate 1 · Gate 2 | as *actually* decided, including overrides and what they covered |
| Verdicts | conformance per audit and re-audit; claim audit per round; any step `degraded` |
| Retries | conformance loops · review rounds · fix passes |
| Model | which model ran each role (implement · audit · review · claims), **as actually dispatched** |
| **★ Missed by harness** | **the load-bearing column.** What *you* caught that the harness did not |
| **Yield by source** | unique valid P0/P1/P2 per reviewer source (`codex-review 0/1/2 · opus-code-reviewer 0/0/1 · …`), from `unit-record.mjs` — "unique" means no other source reported it, "valid" means fixed or filed, not retracted |
| Friction | anything that wasted time — a wrong port, a stale env file, a reviewer firing on nothing |

## How to read it

**Act only on repeated patterns** — with one exception. A *logic error* is not a
pattern question: if it will fire on every task deterministically, fix it on the
first occurrence. Roughly half the rules in `rules.md` came from single
occurrences of that kind.

**Empty `Missed by harness` across five units** is evidence to loosen a gate — or
to earn the Hot-small slot (`gate-design.md`). Non-empty is the reason not to.

**A source with no unique P0–P2 across five units** is a candidate to drop or to
move to a cheaper model — and one whose removal shows up in `Missed by harness` comes
back. This is how the review lineup in `gate-design.md` was set; keep measuring it.

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
