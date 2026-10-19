# Reference: the scope guard, the decision log and the state file

How a unit of work keeps the size it was approved at, and where its decisions go
so the next session — or the owner, months later — finds them. Both modes use it.
**Evidence:** a third project, a production multi-tenant platform, ~120 sessions:
one change request raised 28 questions and 16 open items mid-flow over five owner
rounds and sat 46 hours with no session running; its follow-ups file reached 254
rows, about 17% closed; its state files grew to 12–77 KB because nothing bounded
them.

**`[M]` mechanism · `[B]` binding**

## The Scope block

`[M]` Every unit above Trivial opens with three lines, written before
implementation:

```
In scope:  <what this unit changes>
Out of scope: <what a reader might expect and will not get>
Done when: <the checks, by command or observable result, that close it>
```

Optional, from a written acceptance brief where the project has one: **Must not**
lines (behaviour that must stay unchanged) and a **Verification plan** (which
command proves each "Done when").

`[M]` **Approval freezes it.** On Full, Gate 1 approves it; on Small it is frozen
when stated in the claim line. Every brief quotes it verbatim — a sub-agent that
cannot see the block cannot tell scope from drift.

`[M]` In plan mode the row's exit condition is "Done when", and the row's write set
is "In scope". The block still gets written; it is where "Out of scope" lives.

## Classify every new item once

A review finding, an audit finding, a bug noticed in passing, a sub-agent's
suggestion, an owner's aside — each gets one class, the first time it appears.

| Class | Test | Goes to |
|---|---|---|
| **IN** | "Done when" needs it, or it is a defect in this unit's diff (whatever its severity) | the branch |
| **BLOCKER** | the unit cannot land or be verified without it | the branch + a `scope-in` decision row naming why |
| **CRITICAL** | a pre-existing or outside-the-diff defect in a never-auto category, or one that loses data, money or access | its own commit and test + a `scope-in` row; the owner is told at the next stop. Admitting it is not itself a stop unless its fix needs a product decision |
| **OUT** | everything else, however tempting or cheap | one follow-ups row — not fixed, not added to the plan, not raised again in this unit |

`[M]` **A pre-existing defect is OUT unless it is CRITICAL. "It's a one-liner" is
not a class.** Fixing an OUT item widens the diff past what was reviewed.

`[M]` Severity and scope class are independent. Severity (P0–P3,
`gate-design.md`) decides whether a finding enters a fix round; the class decides
whether it belongs on this branch at all.

## The drift check — at every step boundary

`[M]` Compare each sub-agent report and recommendation with the Scope block and the
decision log. One that widens scope, or reverses a recorded decision, is labelled
**DRIFT** and rejected with a line under *Pushed back* — unless it is a BLOCKER or
CRITICAL, in which case it becomes a decision row saying what it reverses and why.

`[M]` The check applies to the main session's own recommendations: one that
changes between turns ("file it" → "fix it here") states the reversal and its
reason, or it does not change.

`[M]` **Push back.** Reject a finding that does not reproduce or is OUT; send back
a slice that deviated from its brief; tell the owner plainly when a request widens
the scope or contradicts a recorded decision, and propose OUT or a later unit. The
owner decides; the decision is logged.

`[M]` **A choice with a hidden cost is spelled out before it is taken** — an option
implying a new table, migration, endpoint, dependency or second platform says so in
the option text.
> Origin: an owner's "fix it here, fully" once added a table nobody had named.

## The decision sheet — Gate 1

`[M]` Every open question the plan raises is listed **once**, at Gate 1, each with a
proposed default and what it changes. Approval accepts every default the owner does
not change.

`[M]` A question found later is batched — at most one owner round per working day —
unless it changes what the next step does or decides a never-auto category; then
it is asked now, with a recommended default. A non-blocking one gets its default
written as a decision row of kind `default`, goes on the next owner round's sheet,
and work continues. The owner's answer confirms it or replaces it with a
`reversal` row.

`[M]` **Uncertainty is a reason to ask, never a reason to hand the session back.**
Ask with a default; never resolve silently and report it later.

## The decision log

`[M]` In the unit's state file, one table, rewritten in place:

```
| ID | Date | Decision | By (owner / default / agent) | Why | Rejected alternative | Kind (scope-in / scope-out / reversal / default) |
```

plus **Scope changes** (each BLOCKER or CRITICAL admitted, with its id) and **Pushed
back** (each rejected finding or recommendation: source, one line, reason).

`[M]` **Ids:** `DEC-n`, numbered per unit; an open question is `Q-n` until answered,
then becomes a `DEC` row. Outside the state file, cite it as `<unit>/DEC-n`.
`[B]` Phase A lists the id prefixes the project already uses (`D-`, `DEC-`, `Q-`);
pick a prefix that collides with none.
> Origin: bare `D-n` ids collided three times across follow-up rows and design
> decisions in the third project, and one adopting project already numbers its own
> locked decisions `DEC-n`.

`[M]` **At close-out**, append one line per decision with lasting value to the
project's decision log (`date · unit · DEC-n · decision · why · link`). The done
report carries a **Scope** line: admitted (ids and reason), filed OUT (count +
link), drift rejected (count).

`[B]` The decision-log path (default `docs/plans/decision-log.md`), created as a
scaffold.

## The state file

`[M]` **One per unit, beside its plan, a few KB, rewritten in place.** It holds:
branch and worktree, mode, type and tier, base commit, the claim time (copied from
the registry row, which is deleted at land) and any time spent waiting on the
owner, the Scope block's "Done when", slices or steps done and next, the decision
log, open findings, ledger rows so far, and the last gate lines. A resume, a post-compaction turn or a fresh session
reads **this file** — the plan stops collecting resume notes and progress rows.

`[M]` **Committed on the unit branch at step boundaries**, never per fix.
> Origin: one change request spent 49 commits on progress rows, state and
> hand-off notes.

`[M]` **Byte budget**, enforced by the agent-docs lint (`check-agent-docs.mjs`):
closed findings move to the follow-ups doc, decisions with lasting value to the
decision log, and the state file keeps only what the next step needs.

`[B]` Path (default `docs/plans/<unit>.state.md`) and budget (default 8 KB).

## The follow-ups doc

`[M]` **One doc** for everything filed OUT and everything deferred. It replaces plan
mode's separate deferral queue. Each row: `file:line` or area, why it waits, the
unit that filed it, and a **Status**: `open` · `scheduled <unit>` · `fixed <sha>` ·
`dropped — <why>`.

`[M]` **At each close-out, every row still `open` from an earlier unit is marked
`scheduled <unit>` or `dropped — <why>`.** The sweep fixes nothing; a row becomes
`fixed` only by entering a later unit's Scope block.

`[M]` Grounding reads it: rows scheduled for this unit are part of its requirement.

`[B]` Path (default `docs/harness/follow-ups.md`), created as a scaffold.
