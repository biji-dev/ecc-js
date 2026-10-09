# Reference: the segment runner

**Evidence: 2 runs, one of which halted.** The least-validated component here.
**Do not install it by default** — it needs several genuinely independent
low-risk tasks, and a project without them gains nothing and carries the risk.

**`[M]` mechanism · `[B]` binding**

## What it is

`[M]` A **segment** is the run of tasks between two points where a human must be
present. The coordinator never decides where to stop — the boundary comes from
the project's own risk signal and its never-auto categories.

`[M]` **One subagent per task, each with its own context window.** That is what
makes it possible at all: the coordinator holds N summaries rather than N
implementations.

## Eligibility, and the trade

`[M]` Low risk signal only, never the highest tier, never a never-auto category,
never blocked by non-code work. **Default maximum three.** The user may raise it;
the coordinator may not.

`[M]` Tasks run on a segment branch and merge into *it*; the mainline stays clean
until one gate at the end.

`[M]` **What you give up, stated plainly in the generated file:** a defect in the
first task compounds into later ones before anyone sees it. The per-task auditor
and validation commands that actually run the deliverable are what bound that.

## The dispatch brief

`[M]` **"You have no user to ask. If you reach a decision you cannot make from
the plan, the spec or the harness file, stop and report it rather than
choosing."** That line is what stops a subagent guessing at exactly the moments a
supervised run would have escalated.

`[M]` Forbid host-level operations explicitly in every brief.

`[M]` Run them one at a time. Parallel dispatch inside a segment reintroduces
every shared-state problem the design avoids.

## Halting

`[M]` Stop the whole segment on: a blocking conformance gap surviving its
retries, any contract or invariant check failing, a subagent reporting a decision
it could not make, or **anything unexpected** — an unfamiliar failure is a stop,
not a puzzle to solve.

`[M]` A clean stop — the next task is high-risk or never-auto — is **success**,
not failure. Say so plainly.

`[M]` A halt is never resolved by lowering a standard.

`[M]` **A partial segment still merges its completed tasks.** The halted one goes
back to single-task mode.

## What one run proved

> The segment packet caught a foreign commit in the cumulative diff that **no
> per-task audit could have seen** — each task's audit looked only at its own
> work. That is an argument for the batched review that was not anticipated when
> it was designed.

## Segment runner versus delegate-tasks

`[M]` They are different layers; do not merge them.

| | Segment runner | `delegate-tasks` |
|---|---|---|
| Unit | several **plan tasks**, each a full task-runner run | slices **inside one task's** implement step |
| Gates | one human gate at the end of the segment | the task's own gates; Gate 1 approves the slicing |
| Who works | one subagent per task, each running the task runner | Sonnet builders per spec, behind command gates |
| Never for | never-auto categories, the largest tier | never-auto categories, migrations, auth diffs |

`[M]` In Claude Code, dispatch each segment task with `model` set by its track
(`gate-design.md`) — never by inheritance.

`[M]` Eligibility excludes every never-auto category **as currently written**.
Re-read the policy before each segment: one project's eligibility line still named
a category its owner had narrowed weeks earlier.

`[B]` Branch naming · how eligibility reads the project's risk signal · where the
packet goes.
