# Reference: phase preflight

**Evidence: 5 runs in two projects** — one project's four phases (2026-09-06 to
2026-10-21) and one of the other's waves (2026-10-18). Every run escalated real
decisions: the first project's P2 run found the phase's own entry clause failing on three open
questions, and its P3 run escalated five decisions; the other's found 15 open decisions
and a wrong port. Install wherever the plan has phases — the default since v5.

**`[M]` mechanism · `[B]` binding**

## When it runs

`[M]` **Before the first row of a phase is claimed, by the claim itself.** The first
row of a phase is the first row whose id `PHASE_OF` gives that phase. Step 0's
`harness-due.mjs --claim <row>` stops the claim when the row opens a phase that has
no report, and the escalations become that row's Gate 1 cards (`runner.md` ›
Due-checks). A phase already under way without one is named, never stopped.
> Origin: every one of the five runs happened because someone asked for it; the first project's
> runner read the report "if it exists".

`[M]` **The report is committed** at `REPORTS.preflight` in `harness-due-core.mjs`
(default `docs/harness/reports/preflight-<phase>.md`), never in a gitignored
directory: the other project's went to `.review-work/`, where no check or later
reader could find it.

## Why it exists

`[M]` Ambiguity resolved **before** a phase runs is reviewable. Ambiguity
resolved in flight arrives wrapped in rationale, after the code is written, and
is very hard to argue with.

## What it can and cannot find — say this in the generated file

`[M]` **Doc-latent** — contradictions between documents, silences where a task's
trace lands on a section that does not decide what the task needs, undefined or
drifting terms, dependency gaps, weak acceptance criteria. **Catchable.**

`[M]` **Environment** — declared versions against installed ones; the ports the repo
declares (dev and preview scripts, env examples, compose and server config), and the
defaults of the tools it runs where it declares none, against what is listening
(`lsof -nP -iTCP -sTCP:LISTEN`); lockfile health. **Catchable by probing.**

`[M]` **Emergent** — a library behaving differently from its documentation. **Not
catchable.** A clean preflight does not promise an uninterrupted phase, and the
never-auto categories stand regardless of how clean it was.

## The scan category most worth carrying

`[M]` **Decisions whose reasoning outruns the decision.** For every decision
entry, ask what its *argument* would cover if applied consistently, then check
whether it was.
> Origin: a hash covered six fields but not the one identifying which parent
> record the rows belonged to, so rows copied onto a different parent replayed as
> a valid chain. The decision that added two *other* fields had already argued
> that a formula not covering a field cannot detect an edit to it. The same
> sentence covered the omitted one. The preflight itself missed it — this
> category was added afterwards.

## Output discipline

`[M]` **Cite a section, or mark it as needing a decision. There is no third
option.** An uncited resolution is a guess wearing a citation's clothes.

`[M]` **Never resolve a decision the documents do not settle**, however obvious.
That is the entire point of running before the code exists.

`[M]` **The scan amends nothing.** It writes its report and stops. Deciding and
transcribing are different acts: once the owner has settled the escalations, a
*separate* step may transcribe them into the plan, citing the decision id that
authorises each edit, in a *separate* commit.
> Origin: the rule was first written as "never edit the plan," which was too
> absolute — the transcription had already happened correctly and the rule
> forbade it.

`[M]` Report its own elapsed and how many tasks it scanned. A preflight costing
more than the halts it prevents is not paying for itself.

`[B]` Which documents · what a decision entry looks like · where the report goes
(`REPORTS.preflight` in `harness-due-core.mjs`) · the phase in a row id
(`PHASE_OF`).
