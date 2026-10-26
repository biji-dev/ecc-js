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

## Who decides — four classes, one owner question format

`[M]` **Ask the owner only what only the owner can decide.** Every decision the run
meets gets exactly one class, written in its decision row (`scope-guard.md`):

| Class | What it is | What happens |
|---|---|---|
| **P** — product | scope, behaviour a user sees, copy, naming, price, visual identity, what ships when | **ask**, as a decision card |
| **C** — confirmation | a one-way door (data that cannot be restored, a store build, a durable public name, a production write), a contradiction of the specification, a framework, vendor or platform choice, a never-auto decision, spend above the Gate 1 estimate | **ask**, as a decision card |
| **T** — technical | recoverable and product-neutral: a timeout, a limit, an index, a test layout, an internal name, a retry window, which model runs a slice | **the session decides**, writes the row (`By: agent`, why, rejected alternative, reversal cost), and lists it in the Gate 2 brief under **Decided for you** — the owner may reverse any of them there |
| **H** — process | approve a step, another review round, a tripwire that a rule already answers, "summary now or later", "did the harness miss anything" | **never a question** — the rule decides (Owner stops, below) and the ledger records it |

`[M]` **The test is recoverability and product-neutrality, not "is it technical".**
A technical choice whose reversal is a migration, a re-issued credential or a
customer-visible change is **C**, and its card says so. Unsure between T and C →
**C**.

`[M]` **A decision card** — one per P or C decision, never a bare question:

```
<id> · <class> · <one-line question>
Recommend: <option> — <why, one line>
  A <option> — pros · cons · reversal cost · data (a count, a measured number, a cited line)
  B <option> — …
Default if unanswered: <option> (park-and-carry: work that depends on it waits)
```

> Origin, the v4 usage study (10–25 Oct, three projects): 373 owner questions —
> 51% process, 30% technical, 10% product, 9% genuine confirmation; the owner took
> the recommended option 89% of the time and overrode 2 defaults in total; 121 hours
> of owner wait. One 124-item owner round, about 75 of them technical, was answered
> in one line: "use your recommendation". A sheet nobody reads is not a review.

`[M]` **How the cards reach the owner depends on the context**, which the budget
hook's figure line gives (`context.md` › The window, the gate wait and the base):

- **Under 150K:** the question tool — `AskUserQuestion`, or `ExitPlanMode` for a plan.
- **At 150K or more:** write each open card to the state file's decision log as a
  `Q-n` row, give the cards as text after the `/clear` offer and its resume command,
  and **end the turn**. The answer comes back as text, and the `Q-n` rows become
  `DEC` rows. In plan mode, `ExitPlanMode` follows the answer, while the owner is
  there.

> Origin, the v5 context study (21 days, nine installs): 183 requests after a gap
> of more than an hour rewrote their whole context — $267, 9.6% of main-thread
> spend. Past about 125K an idle compaction costs less than the rewrite it saves,
> but it runs only after an ended turn: 0 of 44 idle compactions came while a
> question was pending, and 39 of the 183 waits were on one.

## The intake sheet — Gate 1 ahead of time

`[M]` **An idea with no request is drafted into one first** (`intake.md`), and the
owner answers it on one sheet before unit 1 is claimed: the deliverables with their
`Demo:` lines, every P and C card, the never-auto and risk-map hits with the tier
they set, the estimate, unit 1's Scope block, the queue, and *Decided*. The context
rule above decides how the sheet reaches the owner.

`[M]` **That sheet is unit 1's Gate 1.** The `Approved:` line it leaves in the
request names the unit, the tier and the sha of the Scope block the owner saw; at
unit 1's Gate 1, `node scripts/intake.mjs --gate1` compares them with the claim.
Unchanged → auto, its line in the ledger. Anything else — another unit, a re-tier,
an edited Scope block, a request edited after its approval, a default in place of
the owner's answer — re-opens Gate 1 as an ordinary sheet. Later units' Gate 1s run
as usual; the cards the intake answered are decision rows, never asked again.

## Tiers — decided at claim, after the task type

`[M]` For a Code unit (`runner.md` › Task type first), state the tier in the claim
line. **Unsure → the heavier tier.**

| Tier | Test |
|---|---|
| **Trivial** | a typo, a comment, a one-line config value, a rename with no semantic change |
| **Small** | a local change outside critical code, no never-auto category, no new dependency, no shared contract |
| **Full** | critical code, a never-auto category, more than one module, a new external dependency, a shared contract or schema, a migration, the owner's taste call, the largest size in the plan, or a path no gate covers yet (the coverage map, SKILL.md Phase A) |
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

## Review lineup — what each tier runs

`[M]` The review is **risk-proportional**: scripts first, the second family where it
finds the most for the least, Opus once per unit where a miss cannot be corrected
forward. `scripts/review-gate.mjs` names the reviewers for each review point; the
session dispatches what it names, with `model` and `effort` passed.

| Layer | When | Reviews |
|---|---|---|
| **0 · Scripts** (no model) | every change | the commit guard, the gates (`run-gates.sh`), `review-gate.mjs`, `docs-drift.mjs` (step 8a), `unit-record.mjs` (step 8b) |
| **Small** | cold or standard code, most units | the **second family's review** over the unit diff — no Opus reviewer. Lane B's change surface rides in an `adversarial` pass when a reader sits outside the diff (`blast-radius-auditor.md`). A Small unit the second family wrote gets a Sonnet `code-reviewer` instead; critical code it wrote gets an Opus one per slice (`review-gate.mjs`). Lane A against the Scope block. |
| **Full** | critical code, a never-auto category, a contract, a migration | **per slice:** the second family's review. **Step 8, once over the unit diff:** one Opus `code-reviewer` (the generic language lens is in its brief) · the second family's **adversarial pass**, carrying lane B's change surface · each **triggered specialist** (below) · `pr-test-analyzer` on Sonnet when tests changed. Then lane A once, and the claim audit over **product claims** |
| **Fix rounds** | after any fix | `review-gate.mjs --kind fix` (above) |

> Origin, the cost study (14 days, 1,094 review runs, 2,961 ledger findings): the
> second family found 43% of all valid P0/P1 at no Claude cost; the per-slice Opus
> code-reviewer found none in a 50-slice milestone; a generic language reviewer, a
> separate blast-radius auditor and an Opus docs lane found 1, 0 and 3 unique P0/P1
> between them. Security (on its trigger), claim audits and plan conformance were the
> cheapest per unique P0/P1 and stay. **Track it:** the log's *Yield by source*
> (`log-format.md`) says which source to drop or restore next.

`[M]` **What `review-gate.mjs` names, and what the session dispatches:**
`second-family-review` → `codex-run.mjs review`; `second-family-adversarial` →
`codex-run.mjs adversarial --prompt <brief>` (`--critical` on critical code);
`opus-code-reviewer` / `sonnet-code-reviewer` → the `code-reviewer` agent on that
model; `opus-adversarial` → the Opus `blast-radius-auditor` with the adversarial
brief (the round-3 pass over a fix the second family wrote); every other name → the agent of that name (`pr-test-analyzer` on Sonnet). Each
dispatch passes `model` and `effort: "high"`.

`[M]` **When the second family is unavailable** (quota, login, outage — never block
the unit, `cross-model.md`): per-slice review becomes a Sonnet `code-reviewer` on
cold code and an Opus one on critical code; the adversarial pass becomes the Opus
`blast-radius-auditor` plus an Opus adversarial brief; every row is `degraded`.

## Milestone size — deliverables, split before they outgrow a context

`[M]` **Gate 1 cuts a unit into deliverables** — each one something the owner can
open, use or run, with a **`Demo:` line**: what to open, what to do, what to expect
(`Demo: /settings/plans as a Gratis tenant → staff 3 shows "paused" → resume after
upgrade`). A deliverable holds one or more slices; **inside it the slices stay
technical** — disjoint file sets, contract first, twins in parallel. A unit too small
to split is one deliverable.

`[M]` **One deliverable per coordinator context.** Each has its own slicing table,
its own step 8 over its own diff, its own Gate 2 with the demo evidence (a
screenshot, the named tests, the live-walk transcript) and its own `/clear`
boundary at that Gate 2 (`context.md`); the state file keeps only the current
deliverable, and closed ones move to the decision log and the follow-ups doc.
> Origin, the v4 usage study: slices already ran in fresh sub-agents; the
> coordinator was the polluted context (207K tokens on average, 78 full rebuilds),
> and slices were cut by layer — contract, mock, shell, labels — so the owner saw
> nothing until the unit's Gate 2.
> Origin, the cost study: one milestone of 59.6k lines and 50 slices ran in one main
> session — 20 compactions, a 211K average context and a 493 KB state file.

`[B]` The cap per deliverable — **start at 15 slices or 10k changed production
lines** (tests excluded, `git diff --numstat`), whichever comes first, and let the
log move it. It goes in the `earned` block with the other slots.

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
| The foundation stage (`foundation.md`) — before the flip | every unit Full: ask | ask, **never auto** |
| **Unit 1 of an approved intake**, `intake.mjs --gate1` saying `auto` | auto — its sheet asked ahead of time: its `Never-auto:` and `Risk map:` lines and its cards answer the Gate 1 ask of every row above they cover | by the merge policy; every row above still applies |

`[M]` **The project's own rules tighten these rows, never loosen them.** A document
that requires every change reviewed by another agent puts a reviewer on Trivial too;
one that requires a human on every merge removes the Small auto-merge.

`[M]` **A gate that reads another gate's output runs that gate first, on the same
line** — a schema test reading an emitted file runs the emit before it, or a failed
emit leaves it passing on a stale file.

`[M]` **An ambiguous gate row resolves to `ask`** — and the ask carries only the
unit's P and C cards, its deliverables and its estimate (`runner.md` › Gate 1);
T decisions ride along as a list, never as questions. Auto-approval requires a clean **reviewer**
result, not only a clean conformance verdict. **An override is scoped:** write in
one line what it covers; new findings re-arm the stop.

## The merge policy

`[B]` Derived in Phase B with the policy, behind the same `DRAFT` line. The
generated default:

- **Small merges locally on its own** when conformance has no blocking gap, no P0 or
  P1 is unresolved from reviewers or lane B, this round's FULL verify shows every
  gate PASS, every step the tier requires is `ran` in the ledger, nothing is
  `degraded`, the diff touches no path the coverage map leaves uncovered, and the run
  re-verified if the mainline moved since.
- **Full, any never-auto category, any taste call: the owner merges.**
- **Push is always the owner's**, every tier.

`[M]` The owner may tighten the default (no auto-merge at all) at review. **Never
loosen push.** A pushed merge is the one step the harness cannot take back.

## Owner stops — and what is not one

`[M]` **Stop for the owner only at:**

1. Gate 1 when the tier or the table says ask — one sheet: the P and C cards, the
   deliverables with their `Demo:` lines, the estimate (`runner.md`);
2. a divergence from the approved plan that changes a deliverable, its `Demo:` or a
   P or C decision (a divergence inside one deliverable's technique is T: decide,
   log, list it);
3. a P or C decision that blocks the next step — a never-auto decision, a hidden
   cost that is a one-way door (`scope-guard.md`), spend past the Gate 1 estimate's upper bound;
4. a third fix round on critical code (`escalate-adversarial`, below);
5. Gate 2 when the merge policy says ask, and before every push;
6. an Ops step — the runbook is approved once, for the SHA and the rollback it names.

`[M]` **Not a stop:** finishing a step, a full context (offer `/compact` and keep
working, `context.md`), the second family being unavailable (degraded, recorded),
findings arriving (triage is the session's), a red gate that can be attributed, a
T decision (decide, log, list it at Gate 2), a non-blocking P or C question (its
default goes in a `default` row, batched), and "what next?" — announce the next step
in one line and start it.

`[M]` **What were H questions, as rules:**

- **Another review round** — `review-gate.mjs` decides; only its
  `escalate-adversarial` is a stop.
- **A tripwire a rule already answers** proceeds by that rule and is logged — a
  second `FALSE CLAIMS` round on record prose only is quote-or-delete and land; a
  tripwire stops only when its answer is P or C.
- **Summaries and records** are written at the step that owns them, never asked.
- **★ Missed by harness** is filled from what the owner volunteered at Gate 2;
  nothing volunteered → `—`, not a question.
- **Merge** goes by the merge policy; **push** stays the owner's, asked once with
  Gate 2.

## Severity — one scale

`[M]` **P0–P3 everywhere** — reviewers, auditors, the second family, the log.

| | Means | Fix round |
|---|---|---|
| **P0** | data loss, a security or isolation breach, wrong money, an outage | always |
| **P1** | a correctness defect the unit introduces, or a blocker for its "Done when" | always |
| **P2** | a robustness gap, an edge case, a missing test for a real path | if IN scope |
| **P3** | a nit, a style point | **never opens one** — the P3 batch, or rides along on a line the round already changes |

`[M]` Agents that report CRITICAL / HIGH / MEDIUM / LOW map to P0 / P1 / P2 / P3.
Severity decides whether a finding enters a fix round; the scope class decides
whether it belongs on this branch (`scope-guard.md`).

## Fix rounds — bounded by severity and by what the fix touches

`[M]` **`scripts/review-gate.mjs` decides, from facts** — the paths and production
lines the round changed, whether they are critical (the risk map, bound in its `[B]`
block), the highest severity the round fixed and the round number. Run it once per
round over `<sha-before-the-fixes>..`, after the last fix group, and quote its result
line in the ledger. Its rules:

| Round fixed | Cold code | Critical code |
|---|---|---|
| P3 only | **no fix round** — `p3-batch` | **no fix round** — `p3-batch` |
| P2 | round 1: the second family re-reviews; later rounds: the regression tests prove it | the second family re-reviews |
| P1 or P0 | as P2 | the second family; **plus Opus** when the fix is larger than the gate's `FIX_LINES` |
| any, round 3 or later | — | `escalate-adversarial`: **a stop** — a third round opened unasked is a tripwire (`rules.md` §2). The round the owner orders is the second family's adversarial pass, never a third Opus round |
| **written by the second family** | round 1: a Sonnet `code-reviewer`; later rounds: the regression tests | an Opus `code-reviewer` instead of the second family's re-review; round 3 is an Opus adversarial brief |

`[M]` **`--writer` names who wrote the fix**, not the unit: whatever one family
writes, the other re-reads — fix rounds included. It is required —
`claude | codex | sonnet | mixed`; a round whose fix groups went to more than one
executor is `mixed` and routes as the second family's, and critical code that
Sonnet wrote gets the Opus reviewer as the second family's does.

`[M]` **P3s never open a fix round.** They wait for **the P3 batch, one per slice
set** — a Sonnet fixer (the second family's `fix-cold` where it runs) over every
P3 still IN scope, with no re-review; a P3 on a line the round already changes rides
along in that round. P3s deferred to the follow-ups doc get their own batch in the
hygiene unit (`hygiene.md`). It was called the P3 sweep until v5, a name the
workstream sweep (`sweep.md`) also uses.
> Origin: in one 50-slice milestone, 20 of 50 fix rounds were opened by P3s alone,
> each re-reviewed by Opus (`rules.md` §1 › Cost).

`[M]` **A re-review reads the fix diff, by the reviewer whose finding was fixed** —
never the whole lineup again over the whole unit. The specialist whose trigger the
fix hits joins it. **At most two Opus rounds** on one area; a third round is the
owner's to order, and it is the adversarial pass.
> Origin, the third project: review-fix commits on critical code kept introducing
> defects, and the later rounds caught real money defects — which is why critical
> fixes are still re-reviewed. Origin, the cost study: re-reviews were 50 of 174
> review spawns, and one round 2 re-ran four reviewers over the full scope; 42 of
> 200 valid P0/P1 came from fix rounds, so re-reviews are scoped, never skipped.

`[M]` **One fix brief per area, not per finding.** Fix groups whose files do not
overlap go to one executor in one brief; groups that share files run in sequence.
Fix groups on critical code go to Opus; the rest to the second family's `fix-cold`
where it has quota, else Sonnet — and the review gate then runs with
`--writer codex`.

`[M]` **A P0 or P1 introduced by the fix itself trips the stop** (`rules.md` §2). A
pre-existing finding seen for the first time does not.

## Model and effort

`[M]` Key models on the **same** signals as the gates — the risk map and the
policy. The split is by **recoverability**: a wrong number can be corrected; data
that left the building cannot.

| Role | Claude Code default |
|---|---|
| Main session — Phase B, both gates, the plan, diagnosis, triage | **Opus**, `high` |
| Implementer of critical code and its fixes · the one unit code review on Full · the triggered specialists · the claim auditor · the reviewer of anything the second family wrote on critical code | **Opus** |
| **First builder** for cold slices, fixes outside critical code, tests for cold code and doc rewrites, while its weekly budget allows (`implement-cold`, `fix-cold`, `docs`) · per-slice review · the review of a Small unit · re-reviews of Claude-written fixes · the adversarial pass (carrying lane B) | the second family (`cross-model.md`) |
| The same cold work when the second family is reserved or the task needs a browser, a service or steering · delegated builders · the P3 batch · the conformance auditor · `pr-test-analyzer` · a run-and-report runner · release runbooks · the reviewer of cold code the second family wrote | **Sonnet** |
| The blast-radius auditor (lane B) | **Opus**, only when the second family is unavailable (`degraded`) |

`[M]` **An `executor:` override beats this table** (`runner.md` › Executor
override) — owner first, then the risk routing above, then the default — with one
guard: an override that hands critical or never-auto code to the second family or
Sonnet is a **C** decision, only the owner's, and its slices run with `--writer`
set so the review gate names an Opus reviewer.
> Origin, the v4 usage study: the second family wrote code 7 times in 14 days
> against 502 Opus implementer spawns, while its weekly meter sat at 5–30% most days.
> Its write runs cost 0.5–2% of its week each, so at that plan it can carry about a
> fifth of the implementation — measure, do not assume more.

`[M]` **Pass the model explicitly on every dispatch.** Agent files often pin their
own model, which beats the session's — without an override, the highest-risk unit
silently gets the cheapest reviewer.

`[M]` **Every generated agent file pins `effort: high` in its frontmatter.** An agent
file's `effort:` beats the session's level; without it, a session raised to `max`
reaches every reviewer. **Never leave the main session at `xhigh` or `max`**: raise it
for one hard question, then lower it (`rules.md` §1 › Cost).

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
| Full, once over the unit diff | a correctness reviewer — `code-reviewer`, with the language lens (types, async correctness, unsafe casts, error handling) in its brief |
| money, settlement, webhooks, notifications, a discarded result | `silent-failure-hunter` |
| auth, sessions, tenancy, permissions, a public route | `security-reviewer` |
| **a migration or schema file changed** | `database-reviewer` — not for a query edit alone |
| tests added or changed, Full tier | `pr-test-analyzer`, on **Sonnet** |
| React components carry the change, with no repo invariant | `react-reviewer` only when the owner opts in; a separate generic `typescript-reviewer` found 1 unique P0/P1 in 14 days and is folded into the code-reviewer's brief |
| another language carries the change | that language's reviewer if one resolves; else the correctness reviewer with that lens in its brief, `degraded` |

`[B]` The same triggers, as path patterns, are the `TRIGGERS` block of
`review-gate.mjs` — one canonical list; the table here names the agents.

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
