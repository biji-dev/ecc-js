# Reference: designing the gates, the tiers and the models

**`[M]` mechanism · `[B]` binding**

## The two gates

`[M]` **Gate 1 — approve the plan**, as one decision sheet (`scope-guard.md`),
before implementation.
`[M]` **Gate 2 — approve the merge**, after every review round returns and the
claim audit has run.

`[M]` Everything between them flows without stopping. **Gated, not autonomous.**

`[M]` **An unanswered gate question is park-and-carry, never consent.** Record it
in the registry `Step` and the state file, and pick it up when the owner answers.

## Tiers — decided at claim, after the task type

`[M]` For a Code unit (`runner.md` › Task type first), state the tier in the claim
line. **Unsure → the heavier tier.**

| Tier | Test |
|---|---|
| **Trivial** | a typo, a comment, a one-line config value, a rename with no semantic change |
| **Small** | a local change outside critical code, no never-auto category, no new dependency, no shared contract |
| **Full** | critical code, a never-auto category, more than one module, a new external dependency, a shared contract or schema, a migration, the owner's taste call, or the largest size in the plan |
| *Hot-small* | `[B]` **empty slot, earned** — see below |

`[M]` **One scale for both modes.** Plan mode's former Standard track is Small; its
Full track is Full. The steps each tier runs are in `runner.md`.

> Origin: over 22 tasks the origin harness found 9 CRITICAL and ~75 HIGH, and
> conformance came back CLEAN on CRITICAL-bearing code nine consecutive times — the
> case *for* the machinery. But elapsed rose from 22–32 minutes to 424 on a medium
> task returning one HIGH, because every task ran the same pipeline. Tiers put the
> cost where the risk is. **Small is not unreviewed** — it drops duplication, not
> checks.

`[M]` **Hot-small** is a tier one project earned for small changes inside critical
code: a line cap measured with `git diff --numstat` (tests excluded), one module,
no schema or auth. It keeps the Opus writer and reviewer, the second family's
review, lanes B and C and the adversarial pass, and drops the plan check, lane A and
the separate doc sweep. A P1 promotes it to Full. **Ship it empty:** the line cap
is a number that project earned. Fill the slot when the log shows the case — five
or more critical-code units under some size that ran Full and found nothing the
cheaper path would have missed.

`[M]` **Re-tier at both gates.** A re-tier into a never-auto category discards the
reviews already run.

## The gate table

`[B]` Rows key on the **risk map** and the **never-auto policy** from Phase B
(`policy-derivation.md`), plus whatever per-task risk signal a plan already has.
Never impose a column the project does not have.

`[M]` Rows that are mechanism regardless of project:

| Condition | Gate 1 | Gate 2 |
|---|---|---|
| Never-auto category | ask | ask, **never auto** |
| Critical code (risk map) | ask | ask |
| Small, nothing else hit | auto — the Scope block, stated in the claim line | by the merge policy |
| Conformance reports a blocking gap | — | never auto |
| An unresolved P0 or P1 | — | never auto |
| Claim auditor reports `FALSE CLAIMS` (Full) | — | never auto |
| Any invariant or contract check failing | — | **stop.** Never modify the check to pass |
| Retries exhausted, or a tripwire (`rules.md` §2) | — | escalate |
| **Owner taste** — identity, copy, naming | ask | ask |
| A re-tier during the run | re-ask | re-ask, at the new tier |

`[M]` **Ambiguous resolves to `ask`.** Auto-approval requires a clean **reviewer**
result, not only a clean conformance verdict. **An override is scoped:** write in
one line what it covers; new findings re-arm the stop.

## The merge policy

`[B]` Derived in Phase B with the policy, behind the same `DRAFT` line. The
generated default:

- **Small merges locally on its own** when conformance has no blocking gap, no P0 or
  P1 is unresolved from reviewers or lane B, this round's FULL verify shows every
  gate PASS, every step the tier requires is `ran` in the ledger, nothing is
  `degraded`, and the run re-verified if the mainline moved since.
- **Full, any never-auto category, any taste call: the owner merges.**
- **Push is always the owner's**, every tier.

`[M]` The owner may tighten the default (no auto-merge at all) at review. **Never
loosen push.** A pushed merge is the one step the harness cannot take back.

## Owner stops — and what is not one

`[M]` **Stop for the owner only at:**

1. Gate 1 when the tier or the table says ask;
2. a divergence from the approved plan;
3. a decision inside a never-auto category, or one with a hidden cost
   (`scope-guard.md`);
4. a question that changes what the next step does;
5. Gate 2 when the merge policy says ask, and before every push.

`[M]` **Not a stop:** finishing a step, a full context (offer `/compact` and keep
working, `context.md`), the second family being unavailable (degraded, recorded),
findings arriving (triage is the session's), a red gate that can be attributed, a
non-blocking question (a `default` decision row, batched), and "what next?" —
announce the next step in one line and start it.

## Severity — one scale

`[M]` **P0–P3 everywhere** — reviewers, auditors, the second family, the log.

| | Means | Fix round |
|---|---|---|
| **P0** | data loss, a security or isolation breach, wrong money, an outage | always |
| **P1** | a correctness defect the unit introduces, or a blocker for its "Done when" | always |
| **P2** | a robustness gap, an edge case, a missing test for a real path | if IN scope |
| **P3** | a nit, a style point | follow-ups, unless on a line the round already changes |

`[M]` Agents that report CRITICAL / HIGH / MEDIUM / LOW map to P0 / P1 / P2 / P3.
Severity decides whether a finding enters a fix round; the scope class decides
whether it belongs on this branch (`scope-guard.md`).

## Fix rounds — bounded by what the fix touches

`[M]` **Critical code:** every fix round is re-reviewed — the reviewer over
`git diff <sha-before-the-fixes>`, plus the specialist whose trigger the fix hits —
until a round produces no P0–P2 finding against the fix.
> Origin: in the third project, review-fix commits on critical code kept
> introducing defects; the later rounds there caught real money defects.

`[M]` **Everything else:** **one** re-review of the fix round; its findings are
fixed and proven by their regression tests, not by another review round.
> Origin: fixes and reviews of fixes were 29% of one change request's sub-agent
> spend.

`[M]` **A P0 or P1 introduced by the fix itself trips the stop** (`rules.md` §2). A
pre-existing finding seen for the first time does not.

## Model and effort

`[M]` Key models on the **same** signals as the gates — the risk map and the
policy. The split is by **recoverability**: a wrong number can be corrected; data
that left the building cannot.

| Role | Claude Code default |
|---|---|
| Main session — Phase B, both gates, the plan, diagnosis, triage | **Opus** |
| Implementer of critical code and its fixes · reviewers on Full and critical code · the claim auditor · the blast-radius auditor | **Opus** |
| Implementer of cold slices and delegated builders · fixers outside critical code · the conformance auditor · doc scans · a run-and-report runner | **Sonnet** |
| The decorrelated pass | the second family (`cross-model.md`) |

`[M]` **Pass the model explicitly on every dispatch.** Agent files often pin their
own model, which beats the session's — without an override, the highest-risk unit
silently gets the cheapest reviewer.

`[M]` **Effort floor `high`** on every dispatch and the main session; never `low` or
`medium` on the Claude side. **`xhigh` only with the reason in the brief** — an
inherited `xhigh` was measured at 1.6–2.8× the cost per reviewer, and in the third
project `xhigh` agents averaged 28.9 minutes against 9.5 at `high`. **`max` only on
the owner's word.** The escalation ladder for a hard problem is in
`cross-model.md`. An agent file's `effort:` frontmatter overrides the session level,
and a `CLAUDE_CODE_EFFORT_LEVEL` environment variable overrides both — check for it
before trusting what a dispatch asked for.

`[M]` The log records which model **actually ran** each role. A tier that cannot be
dispatched on this platform is a finding to record, not a tier to pretend.

## Specialist triggers

`[B]` Which reviewer for which path or change — derived from the risk map and the
agents that actually resolve here. **Verify an agent or command exists before naming
it**: one project's first routing table named eleven, and ten did not exist. Plugin
agents resolve under the plugin's prefix (`ecc:code-reviewer`), project agents
under their bare name; name each as it resolves on the machines the project uses,
and give the fallback when it does not — a fresh `general-purpose` agent with that
reviewer's lens in its brief, recorded `degraded`. A shape that has worked, with
ECC's agents where the plugin is installed:

| Trigger in the diff | Add |
|---|---|
| always | a correctness reviewer — `code-reviewer` |
| money, settlement, webhooks, notifications, a discarded result | `silent-failure-hunter` |
| auth, sessions, tenancy, permissions, a public route | `security-reviewer` |
| schema, migration, a changed query shape | `database-reviewer` |
| tests added or changed, Full tier | `pr-test-analyzer` |
| mostly generic TypeScript or React, no repo invariant | `typescript-reviewer` / `react-reviewer` |

`[M]` On Full, the project's review workflow (`templates/workflows/review.workflow.js`,
`delegate-tasks` check mode) may run this fan-out deterministically, with a verifier
on every P0 and P1 that fails closed.

## Do not adopt

`[M]` Generate this list into the harness file with its reasons, so nobody wires them
in later:

- pipelines that orchestrate implement-and-review without cross-checks or a doc
  sweep (ECC's `orch-*`), or whose entry command does not resolve;
- reviewers that edit inside a review, and self-evaluation in place of a fresh
  agent;
- multi-model wrappers pinned to an older CLI than the one installed, and any loop
  that pushes on its own;
- hooks that match words rather than effects (`rules.md` §3), and any hook the
  machine has disabled — the harness depends on git hooks and its own project-local
  hooks only;
- verification loops whose pipes hide exit codes;
- generators that write into hand-curated instruction files.
