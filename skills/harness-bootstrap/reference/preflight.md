# Reference: phase preflight

**Evidence: 2 runs.** Both produced real decisions; neither has been run enough
to trust its edges. Install only where the project has phase-scoped work and a
decision log.

**`[M]` mechanism · `[B]` binding**

## Why it exists

`[M]` Ambiguity resolved **before** a phase runs is reviewable. Ambiguity
resolved in flight arrives wrapped in rationale, after the code is written, and
is very hard to argue with.

## What it can and cannot find — say this in the generated file

`[M]` **Doc-latent** — contradictions between documents, silences where a task's
trace lands on a section that does not decide what the task needs, undefined or
drifting terms, dependency gaps, weak acceptance criteria. **Catchable.**

`[M]` **Environment** — declared versions against installed ones, claimed ports
against what is listening, lockfile health. **Catchable by probing.**

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

`[B]` Which documents · what a decision entry looks like · where the report goes.
