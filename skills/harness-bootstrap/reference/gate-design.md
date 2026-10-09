# Reference: designing the gate table

**`[M]` mechanism · `[B]` binding**

## The two gates

`[M]` **Gate 1 — approve the plan.** Before implementation.
`[M]` **Gate 2 — approve the merge.** After every review round returns and the
claim audit has run.

`[M]` Everything between them flows without stopping. The gates are the only
mandatory human contact: **gated, not autonomous.**

`[M]` **An unanswered gate question is park-and-carry, never consent.** Leave the
run at the gate, record it in the registry `Step`, and pick it up when the owner
answers.

## Two tracks — decided first, at claim

`[M]` **Full** if the task touches any never-auto category, carries the largest
size, adds an external dependency, changes a shared contract, or is the owner's
taste call. **Standard** otherwise. Ambiguity resolves to Full.

| | Full | Standard |
|---|---|---|
| Grounding | a written plan with validation commands | the row's trace, its owned queue rows, a short plan |
| Conformance | step 4 **and** the review re-audit | one pass, plus a scoped re-audit after each fix round |
| Reviewers | all routed reviewers, **Opus**, adversarial brief on never-auto categories | two (general + language), **Sonnet**; add security if the diff touches a query, user input, a secret or crypto |
| Claim audit (8c) | blocking; quote-or-delete after two rounds | one round, advisory |
| Run live | yes | **yes — never dropped** |
| Implement | the session | the session, or `delegate-tasks` with Sonnet builders |
| Gate 1 / Gate 2 | ask / ask | **auto / auto** when conformance is CLEAN, reviewers return no CRITICAL or HIGH, and CI is green |

> Origin: over 22 tasks the harness found 9 CRITICAL and ~75 HIGH, and
> conformance came back CLEAN on CRITICAL-bearing code nine consecutive times —
> the case *for* the machinery. But elapsed rose from 22–32 minutes to 424 on a
> medium task returning one HIGH, because every task ran the same pipeline. The
> wins were concentrated in auth, identity and isolation; the cost was spread
> evenly. Two tracks put the cost where the risk is. **Standard is not
> unreviewed** — it drops duplication, not checks.

## Building the table

`[B]` Rows key on the project's own risk signal — whatever column or label it
already has. Do not impose one.

`[M]` The **never-auto category is a row, not a footnote**, and it is `ask`/`ask`
with no exception for schedule.

`[M]` Rows that are mechanism regardless of project:

| Condition | Gate 1 | Gate 2 |
|---|---|---|
| Never-auto category | ask | ask, **never auto** |
| Conformance reports a blocking gap | — | never auto |
| Claim auditor reports `FALSE CLAIMS` (Full) | — | never auto |
| Any invariant/contract check failing | — | **stop.** Never modify the check to pass |
| Retries exhausted | — | escalate |
| **Owner taste** — identity, copy, naming | ask | ask |
| A re-tier during the run | re-ask | re-ask, at the new tier |

`[M]` **Ambiguous resolves to `ask`.**

`[M]` Auto-approval requires a clean **reviewer** result, not only a clean
conformance verdict.

`[M]` **An override is scoped.** When the owner overrides a stop, write in one
line what it covers; new findings re-arm the stop.

`[M]` **A re-tier into a never-auto category discards the reviews already run.**

## Model and effort

`[M]` Key models on the **same** signals as the gates — one signal is easier to
keep honest than two. The split is by **recoverability**, not severity: a wrong
number can be corrected; data that left the building cannot.

| Role | Claude Code default |
|---|---|
| Main session — Phase B, both gates, planning, diagnosis, triage of review findings | **Opus** |
| Claim auditor · reviewers on the Full track and never-auto categories | **Opus** |
| Implementers and delegated builders on the Standard track · fixers · conformance auditor · preflight doc scans | **Sonnet** |

`[M]` **Pass the model explicitly on every dispatch.** Agent files often pin their
own model, which beats the session model — without an override, the highest-risk
task silently gets the cheapest reviewer.

`[M]` **Effort `high` by default; `xhigh` only with the reason written in the
brief.** An inherited `xhigh` was measured at 1.6–2.8× the cost per reviewer.

`[M]` The log records which model **actually ran** each role. A tier that cannot
be dispatched on this platform is a finding to record, not a tier to pretend.

`[B]` Which reviewer for which file pattern — derive it from the stack and the
agents that actually resolve here. **Verify an agent or command exists before
naming it**: one project's first routing table named eleven, and ten did not
exist.

## Optional — a cross-model pass

`[M]` A reviewer from a **different model family** catches what same-family
reviewers share. Where a second agent CLI is installed (`harness-targets.md`),
run it read-only on Full-track tasks:

```
codex exec -s read-only -o .review-work/xmodel/verdict.md - < .review-work/xmodel/prompt.md
```

- The prompt goes on **stdin**; a quoted-argument prompt hung.
- It counts as run only if the verdict file is non-empty and the log carries no
  error or usage-limit line — the CLI exits 0 on failure.
- Inline the rule text the reviewer needs; it reads `AGENTS.md` but not
  harness-specific rule folders.
- When it cannot run, a fresh Opus reviewer stands in and the ledger says
  **degraded**. Never silently skipped.
