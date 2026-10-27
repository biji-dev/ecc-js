# Reference: the harness log

**This is the engine.** Every rule in `rules.md` came from a row here. Everything
else in the harness is machinery; this is what improves it.

One row per landed **Small or Full** unit, in either mode, appended at land, **on
the unit branch, before the merge** — under `SCOPE=repo` the commit guard refuses a
mainline commit while the run holds its row. Append at the end of the table and
check the neighbouring row survived. Trivial and Docs units get a ledger line in
their report, not a row; an intake gets a row (› Intake rows).

| Column | Why it exists |
|---|---|
| Unit · Mode · Type · Tier | what the gates and models keyed on — plan task id or change id; plan or change; the tier as finally run |
| Deliverable | which deliverable of the unit the row is (`2 of 3 — staff pause`); `1 of 1` for a unit that is one deliverable. One row per deliverable that reaches its own Gate 2 |
| **Elapsed (work)** | from the deliverable's start (`Deliverable started:`, else the lock claim), minus owner wait and machine-down time, cross-checked against `git log --format=%cI` and `unit-cost.mjs --times`. Mark and exclude any row that cannot be reconciled |
| Owner wait | the time the run waited on the owner, from the state file's `Owner wait:` — a duration or its `asked <ISO> → answered <ISO>` pairs. `unit-cost.mjs --times` measures it from the transcripts: each question until its answer, each typed prompt back to the last turn before it |
| **Defects** | P0/P1 from reviewers, lane B and the second family, as `0/2`. Not from the conformance or claim auditors. A row written before the P0–P3 scale may say `2C/6H` |
| Scope | admitted (BLOCKER/CRITICAL) · filed OUT · drift rejected, as counts |
| Gate 1 · Gate 2 | as *actually* decided, including overrides and what they covered — and how many P/C cards each asked |
| Verdicts | conformance per audit and re-audit; claim audit per round; any step `degraded` |
| Retries | conformance loops · review rounds · fix passes |
| Model | which model ran each role (implement · audit · review · claims), **as actually dispatched**, and any `executor:` override |
| **Cost** | `unit-cost.mjs`'s line — `Cost $<x> · Claude <p>% · Codex <q>% (<n> runs)`: API-equivalent dollars, the share of a weekly limit at the project's calibration, and the second family's weekly meter. On a Codex host the Codex part reads `(host)`, `(host, <n> runs)` beside codex-run's runs, and claude-run's dollars are in the cost, `Claude <p>% (<n> claude-run)`: the runs made in the unit's worktree. What `estimate.mjs` reads |
| **★ Missed by harness** | **the load-bearing column.** What *you* caught that the harness did not — filled from what the owner volunteered at Gate 2, never asked as a question; `—` when nothing was |
| **Yield by source** | unique valid P0/P1/P2 per reviewer source (`codex-review 0/1/2 · opus-code-reviewer 0/0/1 · …`), from `unit-record.mjs` — "unique" means no other source reported it, "valid" means fixed or filed, not retracted |
| Friction | anything that wasted time — a wrong port, a stale env file, a reviewer firing on nothing |

## Intake rows

`[M]` **An intake (`intake.md`) lands as a row**, because it is where the owner's
questions are counted:

- `Unit · Mode · Type · Tier`: `<slug> · <mode> · Intake · —`. The empty tier
  keeps it out of every `--tier` estimate.
- `Deliverable`: the request and its size (`CR-030 — 2 deliverables, 2 units queued`).
- `Gate 1 · Gate 2`: the sheet, `sheet 3 cards (P 2 · C 1) · approved 1.2 d after
  capture` — from the capture date to the `Approved:` date.
- `Owner wait` and `Cost` as for any unit; the other cells `—` where they do not
  apply.

`[M]` **The queued units' rows count what the intake missed.** Their
`Gate 1 · Gate 2` cell says how Gate 1 went and the cards asked after the intake
(`auto (intake) · 0 cards`, `owner (re-tier) · 2 cards`). The sum across a request's
units is that intake's miss count; quote it in Friction when it is not 0.

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

**Where a unit's time and money went** is not a column; it would not fit one. Step
8b's `unit-cost.mjs --times --by-step <steps file>` prints it: wall, owner-wait and
work time, compactions, the cache-hit share, cache-expiry rewrites, and dollars and
time per runner step (`runner.md` › Step markers). Quote the line that explains an
outlier in Friction. The week's units side by side are the retro's digest
(`learning.md` › The retro), which reads the log's Defects, Missed by harness and
Friction cells as they are written here.

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

## Estimates come from here

`node scripts/estimate.mjs --log <this file> --tier <tier>` prints, per unit (a
unit's deliverable rows summed), p25–p75 ranges for work time, owner wait, Claude % and Codex % at Gate 1, with the
cohort size, and **"no history" below three rows** of the cohort. Gate 2 sets the
actual (`unit-cost.mjs`) beside it, and the next estimate reads the row.
> Origin, the v4 usage study: per-slice cost varied too much for a point estimate —
> Opus implementer runs at a median $1.86 with a p90 of $4.93, only 19–30% of slices
> within ±30% of the median — while session cost followed the number of implementer
> runs (R² 0.92), which fix rounds decide. A range from the project's own rows is
> honest; a single number is not.
