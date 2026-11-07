# The gated agent harness

**Describes:** skills `version: 9`, plugin `2.2.3-js.12`, branch `slim/harness-js12`, 2026-11-07.
`tests/fork/harness-doc.test.js` fails when the skills' version moves on without this file. A
plugin build that changes other things needs no edit here, so the build above can trail the
plugin's current one.

This document owns the **why, the flow and the analysis**. The references under
[`skills/harness-bootstrap/reference/`](../skills/harness-bootstrap/reference/) own
thresholds, cadences and exact wording, so it links to them instead of copying them. When
this document and a reference disagree on a threshold, the reference wins, and the
disagreement is a bug here.

**Where to start:** [§2](#2-one-page) for what it is, [§7](#7-how-a-run-works) for how a
run goes, [§18](#18-analysis-does-it-pay-for-itself) for whether it pays for itself,
[§19](#19-open-issues) for what is known to be wrong.

**How to read the numbers.** The evidence comes from the repositories that run the harness,
and those repositories are not named here. Each figure carries one of these labels and a date
or window:

| Label | Meaning |
|---|---|
| **measured** | Computed by a script from transcripts, git or usage records |
| **self-reported** | Written by a project's own harness log or report; not independently checked |
| **classified** | A model or a regex assigned the category; the count depends on that classifier |
| **estimate** | Modelled or projected; never observed as a result |

Dollar figures are API-list equivalents, not invoices: useful for ranking causes. They leave
out compaction calls and a few small items, so they are a floor. Where two sources disagree,
this document prints both ([§19](#numbers-that-do-not-agree)).

## Contents

1. [Terms first](#1-terms-first)
2. [One page](#2-one-page)
3. [Why it exists and how it started](#3-why-it-exists-and-how-it-started)
4. [Architecture](#4-architecture)
5. [Bootstrap and upgrade](#5-bootstrap-and-upgrade)
6. [What gets installed](#6-what-gets-installed)
7. [How a run works](#7-how-a-run-works)
8. [The human gates](#8-the-human-gates)
9. [Review and verification](#9-review-and-verification)
10. [Models and hosts](#10-models-and-hosts)
11. [`delegate-tasks`](#11-delegate-tasks)
12. [Context](#12-context)
13. [Guards, merge and push](#13-guards-merge-and-push)
14. [Measurement and learning](#14-measurement-and-learning)
15. [Inventory](#15-inventory)
16. [Distribution and rollout](#16-distribution-and-rollout)
17. [Version history](#17-version-history)
18. [Analysis: does it pay for itself?](#18-analysis-does-it-pay-for-itself)
19. [Open issues](#19-open-issues)

Appendices: [A, the rules](#appendix-a-the-rules-one-line-each) · [B, commands](#appendix-b-commands) · [C, test map](#appendix-c-test-map) · [D, reference-file map](#appendix-d-reference-file-map) · [E, sources](#appendix-e-sources)

## 1. Terms first

Several words here mean something else elsewhere, and the collisions cause real confusion.

| Term | Meaning here |
|---|---|
| **Gated harness**, "the harness" | Instructions, scripts and hooks generated into one repository. They make coding agents run each piece of work through numbered steps, with independent checks and human decision points |
| **Host** | The coding-agent program: Claude Code, Codex, ZCode or Kimi. ECC's own docs call these "harnesses"; this document never does |
| **Owner** | The human who decides product questions and one-way doors |
| **Unit** | One piece of work with a claim, a branch and a land: a plan row, a change, or a harness job |
| **Plan mode**, **change mode** | The two ways units arise. Plan mode takes rows with stable ids from a plan. Change mode takes change requests, issues or nothing yet, and picks a type and a tier. Neither is Claude Code's plan mode (`ExitPlanMode`), which the harness only uses as one way to show a plan |
| **Type** | What a task is: Ops, Answer, Intake, Docs-light, Docs-heavy or Code |
| **Tier** | How much process a Code unit gets: Trivial, Small or Full |
| **Slice** | The part of a unit handed to one executor |
| **Deliverable** | What the owner can open and check, named on a `Demo:` line. A unit may carry several, one at a time |
| **Gate** | Three meanings. **Gate 1 and Gate 2** are the human decision points. The **`Gate` column** of a slicing table is the command that decides whether a slice passed. The **run gates** are the commands `run-gates.sh` runs for verification. Unqualified, this document means the human ones |
| **Lane** | An independent audit: A plan conformance, B blast radius, C claims |
| **Family** | A model vendor. The **second family** is the one that did not write the code, and reviews it. Each host also has a **judgment model** and a **bounded model** |
| **Critical code**, **cold code** | Paths in a project's risk map where a miss cannot be corrected forward, and paths where it can |
| **Never-auto** | Categories the owner always approves, from the project's reviewed policy |
| **Registry** | `.claude/registry.md`, a gitignored table that is the lock: one row per held unit, and a table of parked ones |
| **State file** | `docs/plans/<unit>.state.md`, committed, at most 8 KB: where a unit resumes from |
| **Ledger** | The state file's table of steps: ran, skipped, unavailable or degraded. A step missing from it did not run |
| **Parked** | A unit waiting on the owner with no lock held, so that other units can run |
| **Grant** | A line in a kickoff that approves, for one run, what the owner would otherwise approve unread |
| **`[M]`, `[B]`** | Reference-file markers. `[M]` mechanism ships as written. `[B]` binding is filled in per project |

**Not to be confused with** these ECC items, which share the word and do different jobs:

| ECC item | What it does | Relation to this harness |
|---|---|---|
| `harness-audit` (command) | Scores a repository's agent setup, deterministically | Separate; the skill's description sends config tuning there |
| `harness-optimizer` (agent) | Tunes local agent configuration with eval grading | Unused |
| `agent-harness-construction` (skill) | Designs agent action spaces and tool definitions | Unused |
| `autonomous-agent-harness` (skill) | Turns Claude Code into an autonomous system with queues and scheduling | Unused, and the opposite premise: this one is gated, not autonomous |
| `eval-harness` (skill) | Eval-driven development with pass rates | Unused |
| `gan-style-harness` (skill) | A generator and an evaluator loop | Unused; its "evaluator that loops until a score" is not how this harness decides |

## 2. One page

A gated harness makes coding agents take every piece of work through the same numbered steps,
with independent checks, and with two points where a human decides. The
[`harness-bootstrap`](../skills/harness-bootstrap/SKILL.md) skill generates it into each
repository, and from then on it belongs to that repository. Its other half,
[`delegate-tasks`](../skills/delegate-tasks/SKILL.md), hands well-specified pieces of work
to cheaper or different models behind checks that are commands, not reports.

```mermaid
flowchart TD
  K["Owner: /task-runner, optional Grant and stop lines"] --> C["Step 0: claim, due-checks, type, tier, lock, branch"]
  C --> G["Step 1: ground in the plan, or investigate and plan"]
  G --> G1{"Gate 1: does the tier or policy say ask?"}
  G1 -- "yes" --> P1["Park the unit, post cards, run other units"]
  P1 --> G1A["Owner answers"]
  G1A --> I
  G1 -- "no" --> I["Steps 2-3: implement in slices, sync"]
  I --> A["Step 4: lane A, was the plan built?"]
  A --> L["Steps 5-7: run live, integrate, visual"]
  L --> R["Step 8: routed reviewers, second family, fix rounds"]
  R --> V["Step 8a: docs, then the FULL verify"]
  V --> RC["Step 8b: generated record. Step 8c: claim audit"]
  RC --> G2{"Gate 2: may this merge without the owner?"}
  G2 -- "yes, policy or grant" --> M["Step 9: land, merge --no-ff, push if granted"]
  G2 -- "no" --> P2["Park, brief, run other units"]
  P2 -- "owner answers" --> M
  M --> T["Step 10: teardown"]
  T --> N{"Another ready unit?"}
  N -- "yes" --> C
  N -- "no" --> E["State line: DONE, WAITING ON YOU or BLOCKED"]
```

**The owner does:** write and review the never-auto policy once; answer product and
one-way-door cards; read the Gate 1 sheet and Gate 2 brief where the tier asks; push, or grant
the push; approve Ops steps.

**The design says the owner no longer does:** approve steps, manage the context, restart
sessions, ask what is next, or answer technical questions. These are v8's aims, and no install
runs v8 yet ([§16](#install-state-2026-11-06)).

**What it is not:**

- **Not autonomous.** The phrase in the references is "gated, not autonomous".
- **Not a judge of whether the work is right.** No step decides that. Product judgment stays
  at the gates.
- **Not a shared runtime.** Each project owns its copy, and an upgrade is a reviewed merge.
- **Not free.** Costs and defects of the harness itself are in [§18](#costs).

## 3. Why it exists and how it started

### The failures that forced it

Agents reported work as done that was not. Tests passed without testing. Reviews approved what
they had not read. Each of these happened in a real project before any rule existed, and every
figure below is **self-reported** by that project's log unless marked.

| What happened | Evidence |
|---|---|
| False claims shipped in records | 9 of the first 21 tasks shipped at least one false claim; one shipped 8 |
| A conformance check is not a correctness check | Conformance read `CLEAN` on `CRITICAL` findings nine tasks running |
| Another session's work got swept into a commit | `git add -A` took 588 lines of another session's work |
| Green suite that tested nothing | A validation passed while skipping all eleven of its live cases |
| "Done" reports could not be trusted | Of 88 audited "done" reports, a cross-check found something in 87 and contradicted 81 |
| Sessions ended in hand-offs | 28 of 118 sessions, about 90% forced by a "start a new session" rule the harness itself had |
| Owner decisions spread thin | One change request carried 28 questions and then 16 more, over five owner rounds; one 45.7-hour stretch ran with no session at all, waiting on the owner and on a second family that was out |

### Two lineages, one skill

The harness was not designed in one sitting. Two projects grew their own answers.

- **Plan-mode lineage.** A regulated rental platform scaffolded a task runner over a plan with
  stable ids on 2026-09-06. A multi-tenant agent platform adopted it on 2026-10-02. It brought
  the registry lock, the commit guard, two gates, two auditors and the log.
- **Change-mode lineage.** A production multi-tenant platform, about 120 sessions in, grew task
  types, tiers and a review gate. Its earliest tier table dates from 2026-04-23 at the latest,
  it was formalised on 2026-09-25, and its review gate came on 2026-10-19.

On 2026-10-09, three diverging copies were ported into `harness-bootstrap` v1, plan mode only.
On 2026-10-19, v2 generalised change mode beside it, with an upgrade path, because repositories
were refusing the install and installs carried no version stamp. The owner rejected a
from-scratch orchestration design at that point and reused `delegate-tasks` instead.

### Why a generator, not a shared runtime

- **Critical paths and gate commands differ per project**, and the risky part cannot be
  templated. Phase B's policy is the piece "that cannot be templated".
- **Thresholds imported from another project hand a team rules whose reasons they have not
  lived.** So the never-auto categories, risk map, tripwire numbers and medians ship empty,
  to be earned.
- **Each project can edit its copy.** A manifest records what was edited, and an upgrade keeps
  those edits.
- **No dependency on ECC's plugin hooks.** The harness depends on git hooks and its own
  project-local hooks only, so plugin hook changes cannot silently remove a guard.

### The arc of the versions

Each round followed measurement of the last one ([§17](#17-version-history)):

1. **v1–v2, correctness:** make false reports hard to ship.
2. **v3–v5, cost and measurement:** a 14-day usage study priced the reviews and rerouted them;
   v5 added step markers and a weekly retro so that the next round would not need a study.
3. **v6, the harness's own defects:** about 95 distinct template defects found in four rollouts.
4. **v7, judgment:** decision-first planning, plan critique, a simplicity lens.
5. **v8, owner flow:** the run continues without the owner wherever it can.
6. **v9, fit:** the process scales to the stakes, and a documents-only start reaches product
   code in its first unit.

## 4. Architecture

```mermaid
flowchart LR
  subgraph S["Layer 1: own skills"]
    HB["harness-bootstrap: assess, derive, generate, upgrade"]
    DT["delegate-tasks: dispatch behind command gates"]
  end
  subgraph P["Layer 2: project harness"]
    AG["AGENTS.md blocks and rules"]
    TR["task-runner skill"]
    GD["git hooks and tool hooks"]
    SC["scripts and their tests"]
    LG["log, state files, reports"]
  end
  subgraph J["Layer 3: machine-wide jobs"]
    WK["retro-weekly: digests and a review"]
    MS["machine-sweep: disk and residue"]
  end
  HB -- "generates and upgrades" --> P
  TR -- "hands every bounded segment to" --> DT
  LG -- "read by" --> WK
  WK -- "NEW proposals line in the due-checks" --> TR
  WK -- "promote upstream, Phase F" --> HB
```

The plugin ships layer 1. Layer 2 is generated into each repository, which then owns it, and upgrades
reach it through a manifest.

**Mechanism and binding.** Every reference marks its content `[M]`, copied as written, or `[B]`,
filled in for the project. A binding is what makes a rule true here: `CRITICAL` paths, the
gate commands, `ID_PATTERN`, the cadences. Tests check that the mechanisms still work after
binding ([Appendix C](#appendix-c-test-map)).

**Who orchestrates.** The generated runner skill holds the sequence, and the main session on the
judgment model coordinates it. The runner is stateless: everything it needs is in the registry
row and the state file, so any session can pick up cold. The main session owns tier, gates, plan
text, slicing, every brief, critique of reports, triage, scope guard, decision log, commits and
merge. Above Small, it writes no feature code and reads no file whole.

No single engine runs all of it, on purpose: the gates need the owner, and a workflow can neither
ask the owner nor run a command.

### What code enforces, and what only instructions ask

This table matters more than any other for judging the harness. A rule in the right-hand part
holds only as well as the model follows it.

| Rule | How it holds | Limit |
|---|---|---|
| No commit on a task branch without a row; no commit by a non-owner of a locked checkout; no merge of a branch that holds a row | **Refused** by `harness-guard.sh` in git hooks, for agents and humans | A fresh clone is unguarded until `core.hooksPath` is set and the registry is recreated |
| No `--no-verify`, no hook-path override, no force-push or delete of mainline, no backgrounded Codex run | **Refused** by `command-guard.mjs` on PreToolUse | Fails open if the guard itself errors ([§19](#verified-disagreements-in-the-skills)) |
| No agent edit of env files or installed packages | **Refused** by `edit-guard.mjs` | Tool edits only; a shell command is not an edit |
| A test gate fails on any skip, zero tests, or a count below the minimum | **Refused** by `run-counted.mjs` through `run-gates.sh` | Only for gates bound through it |
| The lane A and lane B agents cannot edit | **Refused** by the host through `tools:` frontmatter | On Claude Code. A Codex TOML cannot bound its sandbox, and the claim auditor has Bash on purpose |
| The second-family review is read-only | **Refused** by the wrapper's sandbox or restricted argv | Applies only when run through the wrapper |
| Instruction files within budget, links and paths alive, no secrets | **Refused** by `check-agent-docs.mjs`, run as a gate | Only when the gate runs |
| Git-derived record fields true by construction | **Generated** by `unit-record.mjs` from git | Its ledger and findings rows are copied as the session wrote them, and the prose beside them is still written |
| Which reviewers a diff is owed | **Computed** by `review-gate.mjs` | It prints a decision; the model has to dispatch them |
| A step ran | **Recorded** by `unit-step.mjs`, and it refuses a wrong checkout | Nothing forces the marker or the order |
| Stop at Gate 1 and Gate 2 | **Instruction only** | The row is released before the merge, so no guard knows whether the owner agreed |
| Push only on the owner's word or a grant | **Instruction only** | No guard refuses a plain `git push` |
| Decision classes, tier choice, "ask only what only the owner can decide" | **Instruction only** | The re-tier checks at both gates are also instructions |
| What a grant covers and how far | **Instruction only** | Grant and stop line sit in the kickoff and in state files |
| Main session reads little and writes no feature code | **Instruction only** | The budget hook shows the figure and blocks nothing |

## 5. Bootstrap and upgrade

The skill runs in phases. Phase 0 and Phase A only read. Phase B writes an uncommitted draft
policy and stops, and nothing is generated until the owner has reviewed it.

```mermaid
flowchart TD
  P0["Phase 0: harness-status.js"] --> Q{"Anything installed?"}
  Q -- "yes" --> SH["Decision sheet, owner approves, three-way merge, new manifest"]
  Q -- "no" --> A["Phase A: seven preconditions, evidence table, coverage map, fit and forecast"]
  A -- "pass" --> B["Phase B: stakes line, policy, risk map, merge policy. Status line DRAFT"]
  A -- "only row 1 fails, nothing built" --> F["Short foundation"]
  A -- "throwaway, or speed over a false-claim rate" --> N["No harness: hard rules only"]
  F --> B
  A -- "row 1, 2 or 3 fails" --> R["Refusal: a readiness plan, then rerun Phase A"]
  R --> A
  B --> O["Owner reads it and sets REVIEWED date"]
  O --> C["Phase C: generate core, per-mode, optional"]
  C --> IR["Install review by a fresh judgment-model agent, one fix round, one re-review"]
  IR --> D["Phase D: calibrate on the lowest-risk unit"]
  D --> E["Phase E: vendor skills, rules from the log, weekly retro"]
  E --> PF["Phase F: promote mechanism across projects"]
```

### Phase A: assess, and be willing to refuse

| # | Precondition | If absent |
|---|---|---|
| 1 | A **pass signal** that can fail: at least one real test, run once and seen red once | Stop. "Done" would be unfalsifiable |
| 2 | A reachable **owner** who answers gates | Stop. Gates with nobody behind them are decoration |
| 3 | **Non-trivial work** | Stop. The harness would cost more than it catches |
| 4 | A **unit of work** | Routes to plan mode or change mode, never stops |
| 5 | A **risk signal** | Phase B derives the risk map |
| 6 | A **written** never-auto policy | Phase B derives it. This is the usual gap |
| 7 | The **stakes**: data, exposure, who runs it, what cannot be corrected forward | Ask the owner. It scales every review |

**Fit and forecast** come before anything is installed. The stakes line is weighed against
what the harness costs; a throwaway repository gets hard rules only. The plan's rows are
classified by tier, and each tier gets a cost range from the owner's other harness logs
(`estimate.mjs --log <a> --log <b>`), labelled *estimate*. The owner sees the gates and the
cost before the first unit, not after the fifteenth.

Lint, a type check and a format check are gates, not a pass signal. A command that runs nothing
is not a pass signal either. The output is a table with cited evidence and a coverage map per
path, and a unit that touches a path nothing covers is Full and never auto-merges.

**A refusal is a readiness plan,** written in the report and not the repository: the smallest
units that would make the failed rows pass, each with a "Done when", ending with *rerun Phase A*.

**The foundation stage** ([`reference/foundation.md`](../skills/harness-bootstrap/reference/foundation.md))
exists because of an embarrassment. One documents-only repository was refused, and then landed
three units in eleven minutes with no lock, no gate, no review and no log row (self-reported).
The foundation stage installs everything that needs no pass signal. Since v9 it is **short**:
the skeleton, the plan's first row, is the pass-signal unit, Full and owner-merged, its "Done
when" one counted product test; the flip follows at once and takes the risk-map re-derive with
it, and no other harness unit runs first. v8 let an install name a later row the pass-signal
unit, and one did: row fifteen, reached after eight units in 29 hours, seven of them on the
harness itself ([§18](#a-documents-only-start-on-v7)).

### Phase B: the one piece that cannot be templated

[`reference/policy-derivation.md`](../skills/harness-bootstrap/reference/policy-derivation.md)
holds a single test: *if this is wrong and ships, can it be corrected forward?* The same test
yields three things: the never-auto policy, the risk map (hot, critical and cold modules, each
citing evidence), and the merge policy. The test is asked against Phase A's stakes line, which
opens the policy block, and since v9 every critical entry cites a harm under it or a never-auto
category; a coverage target alone makes a path standard. All three go into the harness file under
one line:

```text
Never-auto policy: DRAFT — owner has not reviewed
```

The skill does not commit this, and stops. The owner reads it and changes the line to
`REVIEWED <date>`. Phase C refuses while the line says `DRAFT`, because a policy adopted without
being read is not a policy.

### Phase C: generate

The core goes into every install, the per-mode binding follows, and each optional part is asked
about. [§6](#6-what-gets-installed) lists them. The project's own names win: where its documents
define agent roles and working rules, the generated files use those names. Project rules may
tighten the defaults and may never loosen them.

Then a **fresh agent on the judgment model reviews the install**, with one fix round and one
re-review. All four recorded install reviews found at least one P1 (self-reported; a total of 1
P0 and 10 P1, the P0 being a guard that let an unclaimed branch commit). The install lands as a
harness unit, registers for the weekly job, and offers the machine sweep.

### Phase D and on

- **Phase D** calibrates on one lowest-risk unit. The first failure writes the first rule. A fresh
  agent then reviews the generated harness against `rules.md` (ECC's `loop-design-check`, where
  installed) before the second unit. The skill says to expect being wrong: about 15 corrections in the origin's first 21 tasks, and
  roughly one reasoned rule in five later disproved ([§18](#rules-that-turned-out-wrong)).
- **Phase E** adds vendor-trap skills when a library behaves against its docs and the run
  measured it, adds rules from the log, and runs the weekly retro.
- **Phase F** promotes across projects: mechanism travels, thresholds never do.

### Left empty, to be earned

Never-auto categories and the risk map (Phase B derives them), the importer threshold, the
Hot-small tier, tripwire numbers and medians. The milestone cap starts at 15 slices or 10k
changed production lines, and the log moves it. Budgets on instruction files ratchet from their
current size. The model split is the deliberate exception, because it is mechanism: the judgment
model where a miss cannot be corrected forward.

### Upgrading an install

[`reference/upgrade.md`](../skills/harness-bootstrap/reference/upgrade.md) is the procedure.

1. **`harness-status.js`** reads the repository: lineage, each manifest entry's status, markers,
   sizes, held rows, the policy line and hazards by id. It writes nothing.
2. **A decision sheet** goes to the owner before anything is written:
   `Path[#block] | Lineage | Status | Proposed | Default`. Unchanged generated entries default to
   replace; edited, reviewed, scaffold and legacy entries default to keep; every hazard gets a row.
3. **Apply while no row is held or parked,** on a `harness/<slug>` branch. Template-backed entries
   merge three-way against the version that generated them; `--base <path>[#block]` supplies an
   older template and `--history <full clone>` its source. Skipping versions is one sheet, not a
   chain. Each upgrade ends with an install review.

The manifest, `.agents/harness-manifest.json`, is written last and has these kinds:

| Kind | Upgrade behaviour |
|---|---|
| `generated` | Replaced while its hash still matches |
| `scaffold` | Gains structure, never rows |
| `reviewed` | Changes only with the owner |

**Never install alongside.** An existing runner keeps its name through the manifest's `roles`,
since two files governing the same steps is the drift the rules warn about.

**The v8 upgrade** regenerates the rules block, the runner, the `context` and `scope` blocks, and
the gate-design blocks; adds the session-resume hook and the registry's parked table; drops the
context hook's `Stop` entry; and removes any `/clear` or `/compact` offer in the project's own
words. The `gates` block is `reviewed`, so the push line and run grant reach the owner as
proposals.

**The v9 upgrade** moves the run's blocks out of `AGENTS.md` into the runner's `process.md`,
leaving a `run` block; binds `HARNESS` in the review gate; regenerates the runner, the claim
auditor and the scripts; and asks three cards: the stakes line, a demotion for each critical
entry that cites no harm, and, in an install still in foundation, which unit becomes the
pass-signal unit.

**The kickoff.** An upgrade starts from a prompt in a fresh session, between units, in this form:

```text
Use the harness-bootstrap skill to upgrade this repository's harness to v9,
following reference/upgrade.md. Confirm SKILL.md says version: 9. Start between
units, on branch harness/v9. Run harness-status first and show me the decision sheet.
```

## 6. What gets installed

Everything below is generated into the project. `*` marks an optional part, asked about at
install ([`SKILL.md`](../skills/harness-bootstrap/SKILL.md) › Phase C has the full table).

```text
AGENTS.md                 rules, stakes and policy, risk map, merge, commands, the run pointer, plus the project's text
CLAUDE.md                 line 1 is @AGENTS.md, then Claude specifics only
CODEOWNERS                never-auto paths as required review, where the platform supports it
.githooks/                pre-commit and pre-merge-commit, the same guard script
.claude/
  registry.md             the lock; gitignored
  settings.json           hook entries
  hooks/                  command-guard, edit-guard, context-budget*, session-resume*, leftover-processes*
  agents/                 implementer, plan-conformance-auditor, blast-radius-auditor, claim-auditor
  skills/task-runner      committed relative symlink to the runner
  workflows/              review.workflow.js*
  rules/<area>.md         the project's path-scoped rules
.agents/
  skills/task-runner/SKILL.md     the runner, bound to this project's documents
  skills/task-runner/process.md   the run's blocks: types, tiers, gates, stops, scope, context, triggers, models
  harness-manifest.json           every entry's kind and hashes; written last
  harness-models.json             each role's model per host
.codex/                   agents/<name>.toml and hooks.json, where Codex is a target
.zcode/config.json        where ZCode is a target
docs/harness/
  log.md                  one row per unit: "the engine"
  rule-origins.md         the incident behind each shipped rule
  follow-ups.md           the register of deferred work
  reports/                preflight, sweep, retro and hygiene reports
docs/plans/               <unit>.md, <unit>.state.md, <unit>.steps.jsonl, decision-log.md
docs/changes/<unit>.md    change requests, unless the project has its own home for them
scripts/                  the scripts below, with scripts/lib/ holding cores and 21 test files
```

Runtime directories stay gitignored: `.review-work/`, `.codex-runs/`, `.claude-runs/` and
`.unit-stack.env`.

### Guards and hooks

| File | Fires | What it does |
|---|---|---|
| `.githooks/pre-commit`, `.githooks/pre-merge-commit` | Every commit and merge, by anyone | Commit guard: refuses a task-id branch with no row, a commit by a non-owner while a row locks, and a merge of a branch that holds a row. No registry at all exits 0; bad markers or a bad `SCOPE` refuse |
| `.claude/hooks/command-guard.mjs` | Before a shell command on Claude Code, Codex and ZCode | Parses the command. Refuses `--no-verify`, hook-path overrides, mainline force-push or delete, and a backgrounded Codex run. `EXTRA_RULES` adds project rules |
| `.claude/hooks/edit-guard.mjs` | Before an agent's file edit | Refuses env files (except `.example`, `.sample`, `.template`) and installed packages, case-insensitively and through symlinks |
| `.claude/hooks/context-budget.mjs`* | `UserPromptSubmit`, `PostToolUse` | Gives the model a one-line context figure in 25K bands. Silent after a compaction until the next reply, and on `Stop`. Never blocks |
| `.claude/hooks/session-resume.mjs`* | `SessionStart`: startup, resume, clear, compact | For each held or parked unit, prints step, branch, worktree, the state file's `## Next`, open `Q-n` cards, `Grant:` and `Stop:` lines, and the inbox. Writes nothing and is capped at 4,000 bytes |
| `.claude/hooks/leftover-processes.mjs`* | `Stop`, `UserPromptSubmit` | Names what this checkout left listening, and tight memory. Stops nothing itself |

### Scripts the run calls

| Script | Called at | What it does |
|---|---|---|
| `scripts/harness-host.mjs` | Step 0, once a session | Names the host and each role's model; `HAZARD` lines flag an effort above `high`, a second family that cannot run, a host with no models |
| `scripts/harness-due.mjs` | Steps 0 and 9 | One line per due job ([§7](#due-checks)) |
| `scripts/unit-step.mjs` | Each step | Marks start and end in the steps file; refuses a wrong checkout outside the resume, claim and teardown steps; `--check`, `--where`, `--list` |
| `scripts/unit-stack.sh`* | Step 0 | Gives a unit a slot (1–6) when units run live stacks side by side |
| `scripts/estimate.mjs` | Phase A, Gate 1 | p25–p75 ranges from the log, or "no history" below three rows; `--log` repeats to pool other installs' logs for a forecast |
| `scripts/intake.mjs` | Intake | `--check` holds a drafted request to the owner sheet; `--gate1` makes unit 1's Gate 1 automatic while its approval still matches |
| `scripts/review-gate.mjs` | Each slice, step 8, each fix round | Names the reviewers from facts about the diff ([§9](#who-reviews-what)); `--tier harness` names one cross-family reviewer over harness paths only |
| `scripts/docs-drift.mjs` | Step 8a | Lists docs that may have gone stale against the diff |
| `scripts/run-gates.sh`*, `scripts/run-counted.mjs`* | Verification | Runs every gate and never bails; prints PASS, FAIL or SKIP and a summary; reuses a result by tree (`REUSED`); waits for another run's lock, 30 minutes by default, then goes ahead without it. Counted gates pass only with no failed, skipped, todo or flaky test and at least the minimum count |
| `scripts/unit-record.mjs` | Step 8b | Record fields and the log row, from git, state and steps |
| `scripts/unit-cost.mjs` | Step 8b, retro | The log's Cost cell; `--times` and `--by-step` show where time and money went |
| `scripts/retro.mjs` | Weekly, or as a unit | The digest ([§14](#the-learning-loop)) |
| `scripts/check-agent-docs.mjs` | A `full`-level gate | Ten checks: import, budget, rule-paths, rule-index, links, paths, frontmatter, secrets, base, citations |
| `scripts/codex-run.mjs`*, `scripts/claude-run.mjs`* | Whenever the second family runs | Fixed model, effort and sandbox per kind; budget guard; run ledger ([§10](#wrappers)) |

### Scripts the skill itself runs

These stay in the plugin and are never generated:

| Script | What it does |
|---|---|
| [`scripts/harness-status.js`](../skills/harness-bootstrap/scripts/harness-status.js) | Read-only inspection for Phase 0 and upgrades |
| [`scripts/retro-weekly.mjs`](../skills/harness-bootstrap/scripts/retro-weekly.mjs) | The machine-wide weekly job. Runs on Mondays at 09:00 and writes under the user's home; `--register`, `--run`, `--install`, `--dry-run` and others |
| [`scripts/machine-sweep.mjs`](../skills/harness-bootstrap/scripts/machine-sweep.mjs) | Reports reclaimable disk by default across 14 categories; applies only what `--approve` allowed; never uses sudo |

### Shapes worth knowing

**Registry** (active table, between markers, row 0 being mainline):

```markdown
| # | Unit | Step | Branch | Worktree | Resources | Claimed (UTC) |
```

**Parked table**, between `<!-- harness:parked -->` markers:

```markdown
| Unit | Gate | Parked (UTC) | Branch | Worktree | Cards |
```

**State file** (budget 8 KB; shape in
[`reference/scope-guard.md`](../skills/harness-bootstrap/reference/scope-guard.md)). Header keys
are `Unit`, `Mode`, `Type`, `Tier`, `Deliverable`, `Deliverable started`, `Demo`, `Branch`,
`Worktree`, `Base`, `Claimed`, `Owner wait`, `Grant`, `Stop` and `Parked`. Sections are Scope,
Ledger, Findings, Decisions, Pushed back and Next.

**Log row** ([`reference/log-format.md`](../skills/harness-bootstrap/reference/log-format.md)):
Unit, mode, type and tier; Deliverable; Elapsed (work); Owner wait; Defects; Scope; Gate 1 and
Gate 2; Verdicts; Retries; Model; Cost; Missed by harness; Yield by source; Friction.

**Manifest**:

```json
{ "schema": 1, "skill": "harness-bootstrap", "skillVersion": 8, "generated": "<date>",
  "modes": ["change"], "targets": ["claude"], "roles": { "runner": "task-runner" },
  "entries": [{ "path": "AGENTS.md", "block": "rules", "kind": "generated",
                "template": "<template path>", "templateSha256": "<hash>", "sha256": "<hash>" }] }
```

## 7. How a run works

[`reference/runner.md`](../skills/harness-bootstrap/reference/runner.md) is the source for this
section, and is what gets generated into each project.

### Starting

A session starts in one of three ways. In all of them, the state file is what gets read.

- **A new, compacted or cleared session on Claude Code:** the session-resume hook puts each held or
  parked unit's resume point into the first turn. After a compaction, the turn continues the next
  step itself. Other hosts have no such hook, so the turn reads the state file first. Either
  way the runner reads its `process.md`, which holds the blocks below, before step 0 and on
  every resume.
- **`/task-runner`** resumes what is held, then the queue. **`/task-runner <unit>`** runs that unit,
  then the queue. **`/task-runner <unit> only`** runs that unit alone.
- **A kickoff may carry a grant and a stop line:**

  ```text
  /task-runner
  Grant: merge clean Full · push after merge · recommendation on reversible P cards
  until 18:00
  ```

### The task type comes first

Checked in order, and when unsure the heavier one wins:

| Type | When | What happens |
|---|---|---|
| **Ops** | A deploy, migration run, production data fix or credential rotation, even with no repo change | Follows its runbook, with owner approval first |
| **Answer** | Nothing changes: a question, an investigation, a review, a status, a plan only | No steps. A bug's cause still takes step 1's root-cause route |
| **Intake** | New behaviour no request covers, with open decisions or several deliverables | [`reference/intake.md`](../skills/harness-bootstrap/reference/intake.md): no code, one owner sheet |
| **Docs-light** | Small prose | Write, format, lint, commit, one ledger row |
| **Docs-heavy** | A rule file, runbook, change request, or about 200 lines or more | Adds one other-family review and one fix pass |
| **Code** | Everything else, and always the harness's own files | Tiers and the sequence below; a diff of harness files alone runs the harness lane |

Docs units still claim a row, a branch and a land.

### The tier

| Tier | What qualifies |
|---|---|
| **Trivial** | A typo, a comment, a one-line config value, a rename |
| **Small** | Local, outside critical code, no never-auto category, no new dependency, no shared contract |
| **Full** | Critical code, a never-auto category, critical code in more than one module, a new external dependency, a shared contract or schema, a migration, the largest plan size, or an uncovered path |
| **Harness** | A diff of harness paths only: one cross-family review, one fix round, no lane A or claim audit. The owner still merges a guard, a gate, a reviewed block or the rules block |
| **Hot-small** | An empty slot that a project may earn: 5 or more critical-code units ran Full and found nothing a cheaper path would have missed |

A unit is re-tiered at both gates. A re-tier into never-auto discards earlier reviews. The tier
line names the Full condition it meets: unsure whether a named condition holds means Full, and
no condition named means Small. Taste is a card at Gate 1 and a demo at Gate 2, not a tier.
v8 made "more than one module", "a taste call" and "unsure" Full, which on one plan classified
about half of 115 rows Full (classified).

### The sequence

```mermaid
flowchart TD
  S0a["0a resume: verify, do not trust the marker"] --> S0["0 claim: due-checks, type, tier, overlap, branch, lock, state file"]
  S0 --> S1["1 ground: sync and read the plan, or investigate and write one"]
  S1 --> G1(["GATE 1"])
  G1 --> S2["2 implement: slices with Traps lines and tests"]
  S2 --> S3["3 sync with mainline"]
  S3 --> S4["4 conform: lane A"]
  S4 --> S5["5 run live"]
  S5 --> S6["6 integrate: assert the downstream effect"]
  S6 --> S7["7 visual: structure before pixels"]
  S7 --> S8["8 review: routed reviewers, second family, fix rounds"]
  S8 --> S8a["8a docs, then the FULL verify"]
  S8a --> S8b["8b record: last, from the diff"]
  S8b --> S8c["8c claims: lane C"]
  S8c --> G2(["GATE 2"])
  G2 --> S9["9 land: guard, land commit, release row, merge --no-ff, push if allowed"]
  S9 --> S10["10 teardown: stop by PID, vendor skill, follow-ups, next ready unit"]
```

| Step | What it does | Why it is there |
|---|---|---|
| **0a resume** | Compares the marker against branch, tree and state file | A compaction summary once carried a wrong timestamp; files win |
| **0 claim** | Decides first. Runs due-checks, picks type and tier, checks overlap (overlap means sequence, not parallel), creates branch and worktree, takes the lock, writes the state file | One unit in flight plus hotfixes; a parked unit is not in flight |
| **1 ground** | Plan mode: sync both ways, follow the trace, read follow-ups. Change mode: investigate, then plan with an Impact Analysis and a Scope block; plan check on Full when the approach is open | Prevents building from a stale or thin understanding |
| **Gate 1** | The owner approves, or policy auto-approves ([§8](#8-the-human-gates)) | Last point where a change of direction is cheap |
| **2 implement** | One executor per slice, by routing. Every brief has a `Traps:` line. Tests land with their slice, proven with a control. Targeted tests only | Keeps the coordinator small and the slices cheap |
| **3 sync** | Merges mainline in | "Audit the merged reality": step 4 reads the result, not the branch alone |
| **4 conform** | Lane A checks the plan against the diff, once per unit | Was the plan built, all of it, and nothing else? |
| **5 run live** | Runs the system | Unit tests pass while features do not |
| **6 integrate** | Asserts the downstream effect, not a 200 | A status code proves little |
| **7 visual** | Structure first, then pixels | Screenshots are costly and easy to over-trust |
| **8 review** | Dispatches what `review-gate.mjs` names, independently and in one message; triages; bounded fix rounds | [§9](#9-review-and-verification) |
| **8a docs, verify** | Doc sweep, then the one FULL verify before merge | One full suite per unit: 39 runs took 8.4 hours before this rule (self-reported) |
| **8b record** | Written last, from the diff, as fields; every prose claim is quoted with its evidence or deleted | A record written earlier described what was planned |
| **8c claims** | Lane C checks that each test fails when its behaviour breaks and that each behaviour claim is true. Full only, one round | 9 of 21 tasks shipped a false claim |
| **Gate 2** | Merge decision by policy, grant or owner | [§8](#8-the-human-gates) |
| **9 land** | Guard, land commit on the unit branch, release the row, merge `--no-ff`, push on the owner's word or a grant, then due-checks | Fixed order so that the guard does not refuse its own land |
| **10 teardown** | Stops what the unit started by recorded PID, writes a vendor skill if a library misbehaved, closes follow-ups, starts the next ready unit | Leftover servers once held 11.25 GB of swap (self-reported, 2026-10-17) |

**Deliberately absent:** no step decides whether the work is the right work. That stays at the
gates.

### What each tier runs

| Step | Trivial | Small | Full |
|---|---|---|---|
| 0 claim | Type and tier in the claim line | Plus a Scope block, frozen when stated | Plus a Scope block for Gate 1 |
| 1 ground | — | Light | Root cause, Impact Analysis, plan check |
| Gate 1 | — | Automatic unless a risk-map or policy hit | Owner, except an intake's unit 1 |
| 2 implement | The session | The session or one executor | One executor per slice |
| Per-slice review | — | — | `review-gate --kind slice` |
| 4 conform | — | Against the Scope block | Against plan and Scope block, once |
| 5–7 live | If behaviour changes | Yes, never dropped | Yes |
| 8 review | — | `--tier small`: the other family | `--tier full`: one Opus code-reviewer, adversarial pass with lane B, specialists, test analyzer on Sonnet |
| 8a docs | Same commit | `docs-drift`, same commit | `docs-drift`, then a separate sweep |
| 8a verify | Scoped | FULL, once before merge | FULL |
| 8b record | A ledger line | `unit-record` | Plus deviations |
| 8c claims | — | Skipped; the record is generated | Blocking, behaviour claims, one round |
| Gate 2 | Merge policy | Merge policy | Owner, or a grant |

A P0 or P1 from review promotes a Small unit to Full.

**The harness lane** runs Small's column with an impact note at step 1, the shipped tests and
the agent-docs lint at 5–7, `review-gate --tier harness` at step 8, and no steps 4 or 8c. A
path outside the harness's own files sends it back to Full. Harness work that blocks nothing
waits for one harness unit per milestone. On one v7 install, seven of the first eight units
were harness units, and a commands edit to `CLAUDE.md` ran the whole Full sequence (measured,
to 2026-11-07; [§18](#a-documents-only-start-on-v7)).

**Batched rows.** Two or three consecutive Small rows of one phase, with no critical path and no
open card, run as one unit: one branch `<first>-<last>-<slug>`, one slice per row, one review,
one fix round, one record whose Deliverable cell lists the rows, one `Demo:` per row at Gate 2.
A row promoted to Full splits the batch: the earlier rows land, and it runs alone.

**Step markers and dispatch tags.** `node scripts/unit-step.mjs <unit> <step> start`, chained onto
the step's first command, gives each step a time and a cost. Each dispatch carries a tag,
`[<unit> s<step> r<n>]`, so that spend can be attributed. Before each step the session writes one
line: `Unit · Type/Tier · Step · Model · Effort · Context · Reason`.

### Due-checks

`harness-due.mjs` runs at step 0 and step 9. **No queue is stored:** each line comes from the
current state of reports and logs.

| Line | Meaning | Effect |
|---|---|---|
| `DUE preflight <phase>` | This row opens a phase that has no report | Exit 1 stops the claim |
| `DUE sweep`, `DUE retro`, `DUE hygiene`, `DUE p3` | A cadence has passed | Named in the claim line, and becomes the next unit at step 9 |
| `DUE disk` | Free disk below the floor | Runs the approved machine-sweep categories in the background |
| `DUE worktrees` | Idle worktrees exist | Removes them, never with `--force` |
| `NEW proposals <week>` | The weekly review proposed something | Routed by class, then acknowledged with `--seen` |
| `INBOX <unit> <gate> since <time> · <cards>` | A parked unit waits | Shown to the owner |

Default cadences are bindings and live in `CADENCE` in the template
[`harness-due-core.mjs`](../skills/harness-bootstrap/templates/scripts/lib/harness-due-core.mjs).
Since v9 they count product landings only, never a `harness/` unit, and nothing is due while the
manifest's stage is `foundation`. A v7 install's sweep and hygiene came due one day in, counted
on its own harness units (measured, to 2026-11-07).

### The queue run and the state line

After a land, the runner announces the next ready unit in one line and starts it: answered parked
units first, then due-checks, then the next ready row. It stops only on an empty queue, when all
that is left waits on the owner, at the stop line, or at the host's usage limit.

Every turn that ends a run ends on one of four lines, so the owner can tell at a glance:

```text
RUNNING: <what>, nothing needed from you
WAITING ON YOU: <the inbox>
DONE: <units landed>
BLOCKED: <cause, what you must do>
```

### A worked example

*Illustrative only: invented, and v9 has no real-session record yet.* A project `shop` runs on
Claude Code with Codex as second family. Its risk map marks `src/billing/` as critical.

1. The owner sends `/task-runner` with `Grant: merge clean Full · push after merge`.
2. Step 0 prints `DUE retro`. The first ready row is `change/export-columns`, adding two columns to
   an order export: Code, Small, no risk-map hit, so Gate 1 is automatic.
3. Codex builds it as a cold slice. Lane A checks it against the Scope block. The run step exports a
   real file and the integrate step asserts its columns.
4. `review-gate --kind unit --tier small --writer second` names a Sonnet code-reviewer, because the
   second family wrote it. The reviewer finds one P2. The session reproduces it, and Codex fixes it.
   `--kind fix --max-fixed P2 --round 1 --writer second` names the Sonnet reviewer again, scoped to
   the fix diff.
5. FULL verify passes, the session saves the record `unit-record` prints, and every ledger row reads `ran`. The merge
   policy allows it, the grant allows the push.
6. As the due-check said, the retro runs next as its own unit.
7. The third unit, `change/refund-rounding`, touches `src/billing/`, so it is Full and its plan
   holds a P card. Gate 1 asks. The unit parks with `Q-1`, the card goes out as text, and the run
   checks for other ready units.
8. Nothing else is ready. The turn ends: `WAITING ON YOU: change/refund-rounding g1, Q-1`.
9. The owner replies `answered: Q-1 B`. `WAITING ON YOU` does not end a run, so the grant still holds,
   and the unit resumes from its state file.

## 8. The human gates

[`reference/gate-design.md`](../skills/harness-bootstrap/reference/gate-design.md) is the source.

### Who decides what

| Class | Examples | Who decides |
|---|---|---|
| **P** product | What the user sees, what the feature does | Owner, on a card |
| **C** confirmation | A one-way door, a spec contradiction, a framework or vendor choice, a never-auto hit, spend above the estimate | Owner, on a card |
| **T** technical | Everything recoverable and product-neutral | The session decides, logs it, and lists it at Gate 2 under **Decided for you** |
| **H** process | Approve a step, another review round, "summary now or later" | **Never asked.** A rule decides |

The test is recoverability and product-neutrality. Unsure between T and C means C.

This came from measurement: 373 owner questions across three projects in 15 days, classified as
51% process, 30% technical, 10% product and 9% genuine confirmation. The owner took the recommended
option 89% of the time and overrode 2 defaults in total, and one 124-item round was answered in one
line, "use your recommendation" (classified and measured, 2026-10-10 to 25).

### Decision cards

```text
<id> · <class> · <one-line question>
Recommend: <option> — <why>
A <option> — pros · cons · reversal cost · data
B <option> — pros · cons · reversal cost · data
Default if unanswered: <option> (park-and-carry)
```

Unanswered means park and carry, never consent.

### Gate 1 and Gate 2

**The Gate 1 sheet,** in order: deliverables with `Demo:` lines; P and C cards; the estimate; what was
decided (T decisions with their reversal cost); and the slicing table, where the owner may change
an executor (`S3: codex`).

**The Gate 2 brief:** demo evidence; Decided for you; open cards; verdicts; unresolved findings;
diffstat; cost against estimate; what is still running; the step ledger; and five lists: fixed,
admitted, deferred, retracted and not verified. It is never presented while a review round is
outstanding.

### What the gates ask

| Situation | Gate 1 | Gate 2 |
|---|---|---|
| Never-auto category | Ask | Ask, never automatic |
| Critical code | Ask | Ask |
| Small | Automatic | Merge policy |
| Taste call | A P card | The owner reads the demo |
| Foundation stage: the skeleton, then the flip | Ask | Never automatic |
| Harness lane: a guard, a gate, a reviewed block or the rules block | Ask | Never automatic |
| Harness lane, nothing else | Automatic | Merge policy |
| Batched rows | Automatic | Merge policy, one `Demo:` per row |
| Intake's unit 1 | Automatic while approval matches | — |
| Blocking conformance gap, unresolved P0 or P1, `FALSE CLAIMS` on Full | — | Never automatic |
| Failing invariant | Stop; never modify the check | |
| Retries out, or a tripwire | Escalate | |

**The default merge policy:** a Small unit merges locally when conformance has no blocking gap, there
is no unresolved P0 or P1, the FULL verify passed, every step reads `ran`, nothing is `degraded`, no
path is uncovered, and it was re-verified if mainline moved. Full, never-auto and taste calls wait for
the owner. Push is the owner's.

### Parking and the inbox

v8's main change: a gate stops one unit, not the run.

```mermaid
stateDiagram-v2
  Held --> Parked: Gate ask, blocking card, escalation or tripwire
  Parked --> Held: Answer arrives and the row is reclaimed
  Held --> Landed: Gate passes
  note right of Parked
    Brief and cards committed in the state file.
    No lock and no resources held.
    Other units keep running.
  end note
```

To park, the session writes the brief and cards to the state file as `Q-n` rows and commits them on
the unit branch; stops what the unit started; moves the row to the parked table; posts the gate as
text with a notification where the host has one; and starts the next ready unit whose write set
overlaps nothing held or parked. With none, it ends on `WAITING ON YOU:`.

The owner answers any number of units in one message: `answered: Q-1 <answer> · Q-2 <answer>`.

**Under 150K of context with nothing else ready,** the question tool (`AskUserQuestion`, or
`ExitPlanMode` for a plan) is used instead. Below about 125K, rewriting the expired cache costs less
than an idle compaction, and an idle compaction cannot run while a question is pending (measured: 0
of 44, over 21 days).

### The run grant

A grant replaces approvals the owner was already giving unread. Its origin is 66 bare "yes", 38
"your recommendation", 22 "merge or push" and 41 picks of the Recommended option in 14 days (classified,
2026-10-23 to 11-06).

| Term | Means |
|---|---|
| `merge clean Full` | A Full unit merges when it passes the Small test above and its claim audit found no `FALSE CLAIMS` |
| `push after merge` | A merge that the policy or grant made is pushed |
| `recommendation on reversible P cards` | A P card whose reversal is a revert takes its recommendation, and is listed at Gate 2 |

A stop line (`until 18:00`, `3 units`) bounds it. **A grant never covers** a never-auto category, a
taste call, a C card, an Ops step, a re-tier, an `escalate-adversarial` or a tripwire: each parks the
unit. A grant ends with its run, and a parked unit resumed in a later run takes that run's grant.

### Owner stops, and what is not one

Six things stop for the owner: Gate 1 when the table says ask; a divergence that changes a deliverable,
`Demo:` line or decision; a blocking P or C decision; a third fix round on critical code; Gate 2 when
policy and grant say ask, plus an uncovered push; and an Ops step.

**Not a stop:** finishing a step, a full context, the second family being unavailable, findings
arriving, a red gate that can be attributed, a T decision, a non-blocking question, or "what next?".

### Tripwires

[`reference/rules.md`](../skills/harness-bootstrap/reference/rules.md) §2 lists events that mean a run
has gone wrong. How often each fired in the origin project is in brackets (self-reported).

- A fix introduces a new blocking finding (4). The strongest of them.
- Scope has outgrown the tier (4).
- Elapsed work time beyond 3× the tier median (3).
- A third review round nobody asked for (1).
- A re-tier into never-auto (1).
- A behaviour claim the claim auditor failed that its fix's re-run still does not back. Until v9
  this was a second consecutive `FALSE CLAIMS`, and on one install it fired twice on record prose.

The numbers ship as empty slots: "Do not ship the thresholds".

### The scope guard

[`reference/scope-guard.md`](../skills/harness-bootstrap/reference/scope-guard.md) classes each finding
as **IN**, **BLOCKER**, **CRITICAL** or **OUT**. OUT is filed only when it is a reproduced P0–P2,
owed deferred work, an owner decision or the owner's request; otherwise it is dropped. Decisions go
in a log with reversal cost: `ID | Date | Class | Decision | By | Why | Rejected alternative |
Reversal cost | Kind`. Later questions are batched to at most one owner round per working day.

## 9. Review and verification

### The three lanes

| Lane | Question | Runs | On | Verdict |
|---|---|---|---|---|
| **A** plan conformance | Was the plan built, all of it, and nothing else? | Step 4, once per unit | Sonnet, read-only, or Codex `lane-a` | `CLEAN` or `GAPS — n blocking, m advisory` |
| **B** blast radius | Who else reads what changed? | Step 8, riding in the second family's adversarial pass | Opus agent only when the second family is out | Findings |
| **C** claims | Does each test fail when its behaviour breaks, and is every behaviour claim true? | Step 8c, Full only, one round | Opus, may sabotage in its own worktree only | `CLAIMS HOLD` or `FALSE CLAIMS (<n>)` |

Sources:
[`reference/conformance-auditor.md`](../skills/harness-bootstrap/reference/conformance-auditor.md),
[`reference/blast-radius-auditor.md`](../skills/harness-bootstrap/reference/blast-radius-auditor.md),
[`reference/claim-auditor.md`](../skills/harness-bootstrap/reference/claim-auditor.md).

### Who reviews what

`review-gate.mjs` decides from facts about a diff, and it names the role that wrote it with a
required `--writer` (`main`, `bounded`, `second`, `mixed`). The rule underneath is: **whatever one
model family writes, the other reviews.**

| Review point | Written by | Reviewed by |
|---|---|---|
| Slice, cold | Second family | Nobody yet; the unit review covers it |
| Slice | Main or bounded model | The second family |
| Slice, critical | Anyone but Opus | An Opus code-reviewer, immediately |
| Unit, Small | Opus or Sonnet | The second family, plus triggered specialists |
| Unit, Small | Second family or mixed | A Sonnet code-reviewer, plus triggered specialists |
| Unit, Small but a critical path | Any | The Full lineup; the row must be re-tiered |
| Unit, harness lane | Any | One cross-family review over the diff; a path outside the harness's files sends it to the Full lineup |
| Unit, Full | Any | One Opus code-reviewer, the second family's adversarial pass, triggered specialists, the test analyzer when tests changed |
| Fix, P3 only | Any | None: a P3 batch, once per slice set. On critical code not written by Opus, an Opus reader |
| Fix, cold, round 1 | Main or bounded model | The second family |
| Fix, cold, round 1 | Second family | A Sonnet code-reviewer |
| Fix, cold, round 2 or later | Any | None: "its regression tests prove it" |
| Fix, critical, P2, or P1 within 40 lines | Opus | The second family |
| Fix, critical, P1 over 40 lines | Opus | The second family and Opus, at most two Opus rounds |
| Fix, critical | Anyone but Opus | Opus |
| Fix, critical, round 3 or later | Any | `escalate-adversarial`: **a stop** |

Specialists join where the risk map's triggers hit, including fix re-reads:

| Specialist | Trigger |
|---|---|
| `silent-failure-hunter` | Money, settlement, webhooks, notifications, a discarded result |
| `security-reviewer` | Auth, sessions, tenancy, permissions, a public route |
| `database-reviewer` | A migration or schema file only |
| `pr-test-analyzer` | Tests changed, on Full, on Sonnet |
| `react-reviewer` | Only on project opt-in |
| `typescript-reviewer` | Folded into the code-reviewer's brief, after finding 1 unique P0 or P1 in 14 days (classified, 2026-10-10 to 24) |

A diff of docs alone skips `review-gate`. The simplicity lens runs once per family, on Full only. The optional review workflow
(`templates/workflows/review.workflow.js`) runs the Claude side of the fan-out deterministically, and fails
closed: a finding is refuted only with `isReal === false` and confidence of at least 0.8. The second family's
review and adversarial pass stay outside it, through `codex-run`, and it runs lane B only when the second
family is unavailable.

### Severity

| Severity | Means | Consequence |
|---|---|---|
| **P0** | Data loss, security or isolation breach, wrong money, outage | Blocks |
| **P1** | Correctness defect or blocker | Blocks; opens a round |
| **P2** | Robustness | Fixed if in scope |
| **P3** | Nit | **Never opens a round.** Waits for the batch |

**Severity is judged against the stakes line,** which every reviewer brief carries since v9. A P0
or P1 must be reachable under it: a finding that needs a hostile local user on a one-developer
local app, or real records in a fictional-data prototype, is P3 or OUT, and names the condition.
Before this, one documents-only install raised P1s on exactly those conditions (classified, to
2026-11-07).

### How findings are handled

- **One scratch directory per dispatch,** `.review-work/<name>/`. Four reviewers once overwrote each
  other's files in a shared directory, and a compaction once lost reviewer reports held only in chat.
- **Hold edits until every reviewer has reported, and never stage with `git add -A`.** Reviewer probe
  files were swept into commits six times (self-reported).
- **Reproduce before fixing.** A finding that does not reproduce is retracted, never "fixed", while a P0 or
  P1 nobody can verify stays blocking ([§19](#verified-disagreements-in-the-skills) on where that line falls).
  About 6% of findings were artefacts in one project's log (self-reported), and 2.4% were rejected across
  2,961 findings ([§19](#numbers-that-do-not-agree)).
- **Triage by scope class, then severity.**
- **One fix brief per area.** A fix commit is new code, and it gets reviewed as such: 42 of 200 valid
  product P0 or P1 findings were introduced by fix rounds (classified, 2026-10-10 to 24).

### What counts as proof

- **A control is seen failing.** One guard sat inside a `describe.skip` and had never run. A control
  never seen red is only an assertion.
- **Validation cannot pass having run nothing.** All eleven live cases once skipped on a green suite,
  which is why counted gates exist.
- **No pass by cache, skip or missing binary, and no piping through `tail` inside `&&`,** where the
  pipe hides the exit code.
- **Mutation has rules:** restore with `cp` and check with `cmp`; confirm the mutant applied; mutate
  operands as well as branches; a kill belongs to the tree it was measured on. One pass over call
  arguments found 18 survivors that branch mutants had missed (self-reported).
- **Commands decide, not claims.** "The report is a claim" became a rule after the 87-of-88 figure.
- **A "done" report ends with the step ledger.** A step missing from it did not run.

## 10. Models and hosts

The routing follows one idea: **split by recoverability**. The judgment model works where a miss
cannot be corrected forward, the bounded model where an exit condition bounds the work, and the
second family where it finds the most for the least.

| Role | Claude Code | Codex | ZCode |
|---|---|---|---|
| Main session, critical implementer, Full code review, specialists, claim auditor | Opus | gpt-6.1-sol | GLM-5.3 |
| First builder for cold slices, cold fixes, cold tests and doc rewrites | Codex, through `codex-run` | The bounded model, since `claude-run` has no write kind | Codex |
| Per-slice review, Small review, re-reviews, adversarial pass | Codex | Claude, through `claude-run` | Codex, then Claude when it is out |
| Fallback cold builder, delegated builders, P3 batch, conformance auditor, test analyzer, runners, release runbooks | Sonnet | gpt-6-luna | GLM-5.3-Flash |
| Lane B when the second family is out | Opus | gpt-6.1-sol | GLM-5.3 |

The model names come from `templates/harness-models.json` and date quickly: each install re-derives
them from its host's CLI. **Kimi** is supported in the skills' wording and has no row in that file
([§19](#verified-disagreements-in-the-skills)). The canonical table is in
[`reference/gate-design.md`](../skills/harness-bootstrap/reference/gate-design.md) › Model and effort.

**Effort.** The floor is `high`, on every dispatch and the main session. `xhigh` needs a reason in the
brief. `max` needs the owner's word, because `max` reviewers cost 5.5–8× what `high` did (measured,
2026-10-24), and a session left at `max` passes it on to every subagent. Every generated agent pins
`effort: high`. The `CLAUDE_CODE_EFFORT_LEVEL` variable overrides both.

**Pass the model explicitly on every dispatch,** so that nothing inherits a session's or a global
setting.

**Executor override.** A slice may say `executor: codex | opus | sonnet | auto`. The owner's word beats
risk routing, which beats the default. Lowering the writer on critical or never-auto code is a C
decision.

**When the second family is out.** Quota, a login or a missing binary never stops a run. Per-slice
review falls back to a Sonnet code-reviewer on cold code or an Opus one on critical code, and the
adversarial pass falls back to Opus. All of these are recorded `degraded`, which itself blocks an
automatic merge.

### Wrappers

[`reference/cross-model.md`](../skills/harness-bootstrap/reference/cross-model.md) owns the table of
kinds. What the wrappers are for:

- **`codex-run.mjs` fixes model, effort and sandbox per kind,** because a bare `codex review` inherits
  the global effort. Review kinds run read-only, and `implement-cold`, `fix-cold` and `docs` run
  `workspace-write` inside the worktree.
- **`claude-run.mjs` has read-only kinds only,** with a per-run cost cap and tools restricted to
  Read, Grep and Glob. Writing is never a kind: the host builds, and Claude reviews.
- **Trust the wrapper's exit code,** never the agent CLI's own. Exit 3 means unavailable, which takes
  the fallback route.
- **A budget guard** holds back non-essential kinds past a threshold (default 85% of the weekly
  meter), and `CODEX_RUN=on|essential|off` is the owner's switch.

## 11. `delegate-tasks`

[`skills/delegate-tasks/SKILL.md`](../skills/delegate-tasks/SKILL.md) is the dispatch engine. Run by
hand, it handles a batch of well-specified work. Inside a harness run, the runner hands it each
bounded segment, and Gate 1 approves the slicing table.

**The idea:** the main session stays the architect. It writes specs, executors build, and commands
decide what passed. "Commands decide, not claims."

**What never delegates:** understanding, design, diagnosis, triage and the commit.

**The slicing table:**

```markdown
| Slice | Files | Kind | Executor | Order / wave | Gate | Expected counts | Risk | Deliverable |
```

**Routing, by what the work is:**

| Work | Executor |
|---|---|
| Copy, mechanical changes, UI against a contract, tests for cold code, non-critical fixes, docs | The second family first, while it is available and under its budget, else Sonnet. Sonnet when the slice needs a browser, a service the sandbox cannot reach, or steering mid-run |
| A contract or domain logic | Opus, serially |
| Critical code | Opus only, serially |

**Five spec kinds** ([`delegate-tasks/reference/spec-templates.md`](../skills/delegate-tasks/reference/spec-templates.md)):
Build, Fix, Control, Check and Plan. Specs are written to `.claude/tasks/<run-id>/NN-slug.md`.

**How a dispatch is checked:**

1. The spec is checked before dispatch.
2. A slice is sized to about 70 tool calls and a peak under 200K of context. This matters because
   after a subagent compaction 147 of its next 170 Reads re-read files it had already read (measured,
   over 59 compactions).
3. Its file fence is checked with git (`git status --porcelain -uall`), not from its report.
4. Its gates run as separate commands, never one `&&` chain, so that the first failure does not hide
   the others.
5. At most three fix rounds. A slice reads `verified` only when green.

## 12. Context

[`reference/context.md`](../skills/harness-bootstrap/reference/context.md) is the source.

**Why context is the cost.** Every API call re-reads the whole context. So a turn is the unit of
cost, spend tracks context size rather than output, and subagents do reading that the main thread
would otherwise pay for on every later turn.

**"The owner never manages the context."** The harness never stops for a compaction, never offers
`/compact` or `/clear`, and never asks for a new session. Auto-compaction is the reset and the state
file is what survives it. The model cannot clear or compact itself: no tool, hook field or setting
requests either. What it can judge is what the main thread reads.

The evidence for this rule is a reversal. v3 to v7 offered `/compact` with a keep-line, and `/clear` at
gates. Over 14 days the owner pasted 94 keep-lines and typed 38 `/clear`s. A clear came at a median of
170K and the cleared session cost a median of 90K before its first step, so it freed about 80K, not
the "resume from about 8 KB" the references had claimed (measured, 2026-10-23 to 11-06).

**The levers,** as measured over 21 days and nine installs (2026-10-05 to 26):

| Lever | Finding | Kind |
|---|---|---|
| Auto-compact window | Against the configured windows, 300K −4.0% of main-thread spend, 250K −5.4% with more compactions, 150K +69%, 1M +20% | Estimate, from a replay within 0.1% of actual spend |
| Cache expiry while the owner is away | 183 requests after a gap of over an hour rewrote the whole context: $267, 9.6% of main-thread spend | Measured |
| The always-loaded base | Compaction lands near 106K; a fresh session starts at 22–108K by project | Measured |
| Subagents | 59% of spend in that window | Measured |

So the harness sets `autoCompactWindow: 300000`, sends cards as text at 150K or more, and holds the
base to a ratcheted budget: `check-agent-docs.mjs` fails as a gate over that budget, and its `--base` lists the files.

**What survives a compaction:** the registry `Step`, the state file, the steps file, commits,
`.review-work/`, `CLAUDE.md` and `AGENTS.md`. Chat does not. A kickoff's grant survives only inside the
summary while no row is held ([§19](#known-gaps)).

**Tool discipline** is a verbatim block in every generated agent and every brief: parallel tool calls
in one message, whole-file reads rather than small `sed -n` slices, one search with several patterns,
a completion notice rather than a sleep loop, shrunken screenshots. Its origin is a measurement: 96%
of implementer turns made one tool call, there were about 4,500 slice reads, and one session had 41
sleep polls (measured, 2026-10-24).

## 13. Guards, merge and push

[`reference/commit-guard.md`](../skills/harness-bootstrap/reference/commit-guard.md) is the source.

**Land order is fixed:** guard → land commit on the unit branch (status, evidence, log row) → release
the row → merge `--no-ff` → push. A runner that merges before releasing its row gets refused by its
own guard.

**`SCOPE`.** Under `SCOPE=repo`, the guard refuses a mainline commit while any row is held. Under
`SCOPE=checkout`, for units in worktrees, a held row locks only its own checkout and the merge hook
refuses a merge of a branch that still holds a row. Either way, a parked row sits in another table
and blocks nothing.

**Who may do what:**

| Action | Small | Full | Never-auto, taste |
|---|---|---|---|
| Merge | The session, if the merge policy passes | The owner, or `merge clean Full` in a grant | The owner, always |
| Push | The owner, or `push after merge` in a grant | Same | The owner: `push after merge` reaches only a merge the policy or grant made |

**Failure handling.** `command-guard.mjs` fails open if the guard itself errors, and no rule refuses a
plain `git push`. This is a recorded choice with a cost ([§19](#verified-disagreements-in-the-skills)).
Bypasses happened in five projects, so the class of hazard is real (self-reported); this document does
not describe how.

**What a project may add:** `EXTRA_RULES` in the command guard, each with its own test case, and
`CODEOWNERS` with branch protection where the platform has it. Project rules tighten, never loosen.

**What the skill refuses to adopt** ([`reference/gate-design.md`](../skills/harness-bootstrap/reference/gate-design.md)
› Do not adopt): `orch-*` pipelines; reviewers that edit inside a review; self-evaluation; multi-model
wrappers pinned to an older CLI; loops that push on their own; keyword-matching hooks and disabled
hooks; verification loops whose pipes hide exit codes; and generators that write into hand-curated
instruction files.

## 14. Measurement and learning

[`reference/learning.md`](../skills/harness-bootstrap/reference/learning.md) and
[`reference/log-format.md`](../skills/harness-bootstrap/reference/log-format.md) are the sources.

Before v5, the learning loop was the owner's memory. Transcripts expire after 21 days, and an observer
plugin kept 209 MB without producing one instinct (self-reported). So measurement moved into the run.

### What gets measured

- **Each unit's log row:** drafted by `unit-record.mjs`, which only prints. The session saves it and fills
  its `<fill: …>` cells. Elapsed work and owner wait are kept apart.
- **Each unit's cost:** `unit-cost.mjs` reads the unit's Claude transcripts by dispatch tag and the
  second family's meter from its ledger. `--by-step` shows where it went.
- **Estimates:** `estimate.mjs` gives Gate 1 a p25–p75 range from the log, and Gate 2 shows the actual.

### The learning loop

| Step | Runs | Does |
|---|---|---|
| **Retro** | Weekly per project, `DUE retro` | A committed digest of at most 8 KB: KPIs against the four weeks before, owner touches, outliers, money by step, friction, Missed by harness, the queue, at most five candidates |
| **Retro review** | Weekly, machine-wide job | A fresh Opus, read-only, classes each candidate as rule, threshold, machinery fix, vendor trap or promote. It **routes and never asks**: T becomes a queued `harness/<slug>` unit, C goes to the next Gate 2 brief under "Harness learning" |
| **Rule audit** | Quarterly, in the project | Are the rules still true? |
| **Phase F** | Monthly, or on a promote | Mechanism moves upstream into the skill; thresholds never do |

The weekly job costs little: the export is $0 and the review is capped at $5. The two recorded reviews
cost $0.38 and $0.77 (measured). It prints `NEW proposals <week>` for the next due-check to route.
ZCode transcripts are not read.

### Scheduled maintenance units

Each runs as an ordinary unit, because `harness-due.mjs` makes it the next one:

| Unit | Job | Evidence (self-reported) |
|---|---|---|
| **Phase preflight** ([`reference/preflight.md`](../skills/harness-bootstrap/reference/preflight.md)) | Before the first row of a phase: are its entry conditions true? | 5 runs, two projects; every run escalated real decisions |
| **Workstream sweep** ([`reference/sweep.md`](../skills/harness-bootstrap/reference/sweep.md)) | Reconciles the register of open questions and follow-ups | 8 runs, two projects; two ran overdue because nothing enforced the cadence |
| **Hygiene** ([`reference/hygiene.md`](../skills/harness-bootstrap/reference/hygiene.md)) | The P3 batch, dead code, docs drift, the archive, residue | Designed from one project's 1,568 open items, 1,320 of them P3 |
| **Machine sweep** ([`reference/machine.md`](../skills/harness-bootstrap/reference/machine.md)) | Disk, residue, orphaned servers. The owner approves categories once | One project's 73 MCP processes and leftover servers held 11.25 GB of swap |
| **Vendor skills** ([`reference/vendor-skill.md`](../skills/harness-bootstrap/reference/vendor-skill.md)) | Not scheduled: written before the session exits, when a library contradicts its docs and the run measured it | The origin grew nine in its first thirty tasks |

## 15. Inventory

### Own skills, shipped by the plugin

Listed under `skills.own` in `fork/slim.json`. There are no own agents or commands.

| Skill | Role | Size |
|---|---|---|
| [`harness-bootstrap`](../skills/harness-bootstrap/SKILL.md) | Assesses, derives, generates, upgrades | 93 files; `SKILL.md` and its references are 358,371 bytes |
| [`delegate-tasks`](../skills/delegate-tasks/SKILL.md) | Dispatches behind command gates | `SKILL.md` and two references |
| `skill-advisor` | Unrelated to the harness; recommends library items per project | |

### Agents generated into each project

| Agent | Lane or role | Model | Tools |
|---|---|---|---|
| `implementer` | Builds slices and fixes. Reports in at most 15 lines; never pushes, merges or rebases | Opus by default, Sonnet passed for cold slices | Read, Edit, Write, Grep, Glob, Bash |
| `plan-conformance-auditor` | Lane A | Sonnet | Read, Grep, Glob |
| `blast-radius-auditor` | Lane B's fallback | Opus | Read, Grep, Glob |
| `claim-auditor` | Lane C | Opus | Read, Grep, Glob, Bash |

Implementation and fix work never goes to a general-purpose agent.

### ECC items the harness uses

**The default path needs five reviewers.** Each has a `degraded` fallback: a fresh `general-purpose`
agent with that lens.

- `code-reviewer`
- `security-reviewer`
- `silent-failure-hunter`
- `database-reviewer`
- `pr-test-analyzer`

**Optional, when a project opts in or a phase asks:**

| Item | Where |
|---|---|
| `react-reviewer`, `typescript-reviewer` | Language lenses, on opt-in |
| `planner` | A second plan when no second family exists |
| `refactor-cleaner` | Hygiene, in a clean worktree |
| `loop-design-check` | Phase D |
| `intent-driven-development`, `product-capability`, `blueprint`, `contract-first` | Intake lenses |

(`superpowers:brainstorming` is also an intake lens, and comes from outside ECC.)

**Named only to disclaim them:** `harness-audit`, `orch-*`, `plan-prd`, `prp-plan`, `learn-eval` and
`scripts/worktree-lifecycle.js`.

**Close in topic, and not used by the harness:** `verification-loop`, `tdd-workflow`, `quality-gate`,
`delivery-gate`, `santa-method`, `santa-loop`, `council`, `council-multi-model`, `gateguard`,
`safety-guard`, `dev-team`, `autonomous-agent-harness`, `agent-harness-construction`, `eval-harness`,
`autonomous-loops`, `continuous-agent-loop`, `continuous-learning-v2`, `skill-comply`, `review-pr`,
`code-explorer`, `code-architect`, `doc-updater` and `tdd-guide`. They have no stated reason for
omission in the skills; several overlap a harness step. A project can still use them by hand.

**No dependency on plugin hooks.** The harness relies on its own git hooks and project-local hooks.
Plugin agents resolve as `ecc:code-reviewer` and project agents by bare name.

## 16. Distribution and rollout

**How a skill reaches a host.** Install commands are in [`docs/ECC-JS.md`](ECC-JS.md) › Install.

| Host | Route | Note |
|---|---|---|
| Claude Code | Plugin `ecc@ecc`, from the fork's marketplace | |
| Codex | Plugin `ecc@ecc` | |
| ZCode | Copies in `~/.zcode/skills/{harness-bootstrap,delegate-tasks}` | Its plugin is stale and holds neither skill, so the copies are what loads. Re-synced from main after each round |
| Kimi | Per project, `scripts/install-apply.js --target kimi` | Install deferred |

**Versions.** The plugin version is `<upstream>-js.<build>`, and hosts cache by it, so a change that
ships needs `npm run fork:bump`. A session opened before an update keeps the older skill. The skills'
own `metadata.version` is a whole number that moves when an install must upgrade, and
`harness-status.js` fingerprints by it.

**How a project upgrades.** Never automatically, and only on the owner's word: a pilot first, then the
others one at a time after the pilot's checks.

### Install state, 2026-11-06

| Skills version | Installs |
|---|---|
| v8 | 0 |
| v7 | 5 |
| v6 | 5 |
| v5 | 2 |

Claude Code's plugin, Codex's plugin and the ZCode copies are at `2.2.3-js.11`, equal to main. One remote
machine's plugin was last noted at js.9. The weekly job ran for weeks W44 and W45 with no failed exports,
and next runs on 2026-11-09.

**The v8 pilot's checks, none run yet:** auto-compaction is followed by the right next step; zero typed
clears; parked gates are answered in one message; nothing merges beyond the grant. v9 is piloted
together with v8, on the documents-only install of [§18](#a-documents-only-start-on-v7), and adds two:
the self-reference share and product rows per day, against a stop-loss the owner sets for the pilot.

## 17. Version history

Nine versions in 29 days. To v8, 103 commits, and the skill's tree grew from 17 files to 93 (via 30,
41, 47, 89 and 91).

| Skills | Plugin | Date | Merge | What forced it | What it added |
|---|---|---|---|---|---|
| v0 | none | to 2026-10-09 | | | Hand-written installs |
| v1 | 2.2.1-js.4 | 2026-10-09 | `7980ec7f` | Three diverging copies | Port: runner, commit guard, two gates, two auditors, registry, log |
| v2 | 2.2.1-js.5 | 2026-10-19 | `66faa06a` | Repositories refused; installs unstamped | Change mode, tiers, risk map, scope guard, lane B, manifest, status script |
| v2 · foundation | 2.2.1-js.11 | 2026-10-19 | `5ba54962` | A refused repository landed 3 units in 11 minutes with no lock or review | Foundation stage, flip unit, install review |
| v3 | 2.2.3-js.3 | 2026-10-25 | `063387e8` | $8,299 in 14 days | Per-slice second family, one Opus reviewer per unit, `review-gate`, `docs-drift`, `unit-record` |
| v4 | 2.2.3-js.4 | 2026-10-26 | `83408ec4` | 373 owner questions, 51% process | Decision cards, deliverables, Codex as builder, gate reuse by tree, `unit-cost`, `estimate`. **Never ran anywhere as v4** |
| v5 | 2.2.3-js.5 to js.7 | 2026-10-27 | `fd8c2459`, `0df6a2f9`, `b65ab343`, `9befaa83` | Learning depended on the owner's memory; hosts hard-coded | Step markers, retro, weekly job, due-checks, hygiene, intake, per-host models |
| v6 | 2.2.3-js.8 | 2026-10-29 | `ff79e380` | About 95 distinct template defects from four rollouts | Guard fixes, three-way merge, `--base` |
| v6 | 2.2.3-js.9 | 2026-11-03 | `7b3f01ec` | | Pins only, no change to the skills' version |
| v7 | 2.2.3-js.10 | 2026-11-04 | `251f6918` | The owner's eight ideas | Decision first, OUT filed or dropped, plan critique, simplicity lens, marker refusal, `--status` |
| v8 | 2.2.3-js.11 | 2026-11-06 | `50478698` | The agent ran a median of 8 minutes between owner touches | No offers, session-resume hook, queue run, parked gates, run grant, state line, owner-touch KPIs |
| v9 | 2.2.3-js.12 | 2026-11-07 | | A documents-only install landed 1 of 115 plan rows in 29 hours, 7 of its 8 units on the harness | Stakes line and forecast, short foundation, harness lane, product-only cadences, stakes-scaled severity, one-round behaviour claims, batched rows, `process.md` |

Per-version detail is in [`reference/upgrade.md`](../skills/harness-bootstrap/reference/upgrade.md).

## 18. Analysis: does it pay for itself?

**The short answer: unknown, and the harness cannot yet tell you.** It catches many defects and has
measured which reviewers find them. But it has **no control group and no escaped-defect rate**, so
nothing shows that shipped software is better than it would otherwise be. Its strongest evidence is
about where review money goes, not whether the whole thing is worth it.

### Benefits claimed, against the evidence

| Claim | Evidence | Verdict |
|---|---|---|
| It catches real defects | 2,961 findings, 200 valid product P0 or P1 in 14 days (classified, 2026-10-10 to 24) | **Finding volume evidenced, net benefit not.** No control and no escaped-defect rate |
| A single agent checking its own work would ship more | 42 of those 200 were introduced by fix rounds and caught in re-review | **Partly.** Shows fixes regress; the counterfactual is an inference |
| The second family is worth having | 43% of valid product P0 or P1 at no Claude cost; 68 unique | **Evidenced, with overlap undercounted.** It is not perfect: one bypass got through 5 Codex rounds and was found by the claim audit's second round (self-reported) |
| Most Opus review spend buys few P0 or P1 | $1,037 of $1,335 bought 13 of 59 unique | **Evidenced for one window** |
| v3's rerouting saves about $270 a week | The study's projection; never re-measured | **Not evidenced.** About 6 unique Opus P0 or P1 would lose their dedicated reviewer; the recheck the study asked for is not on record |
| The 300K window saves money | A replay model, −4.0% | **Modelled only.** Re-measure due 2026-11-16 |
| The 150K rule recovers cache spend | Weekly digests show mixed readings | **Not evidenced** |
| Generated records cut paperwork | Record-step share fell from 11–22% to readings of 1.1%, 3.2% and 12.8% in W45 | **Partly; small sample** |
| The claim auditor earns its cost | $3 per unique P0 or P1 and 25 unique, though 79 of its 105 P1s were about record prose | **Evidenced, and narrower than claimed.** v9 narrows it to behaviour claims, one round |
| The install review earns its cost | All four recorded reviews found at least one P1 | **Evidenced,** and also a signal of template defects |
| Decision classes remove about 300 of 373 questions | The classification, before the rule | **Not evidenced.** 58–66% of touches still carried no decision two weeks later, partly for other reasons |
| Tiers put cost at risk | One project shows it. Elsewhere every logged unit ran Full, and Hot-small was never earned | **Partly** |
| The learning loop improves the harness | It produces reliably (14 proposals for under $2, measured); uptake is unproven | **Output evidenced, effect not** |
| v8 lets a run finish without the owner | The hook has not run in a real session | **No evidence yet** |

### Which reviewers found what

14 days, 2026-10-10 to 24, in the five projects that keep ledgers. Runs and dollars are measured,
severities classified. "Unique" means no other source reported it; duplicates are counted only where a
ledger says so, which flatters every row somewhat. Codex spends Codex quota, so its $0 is not free.

| Source | Runs | Claude $ | Valid product P0/P1 (unique) | Unique P0–P2 | $ per unique P0/P1 |
|---|---:|---:|---:|---:|---:|
| Codex review | — | 0 | 47 (42) | 83 | 0 |
| Codex adversarial | — | 0 | 38 (25) | 94 | 0 |
| Codex frontier | — | 0 | 1 (1) | 10 | 0 |
| Opus claims | 53 | 84 | 26 (25) | 25 | 3 |
| Opus security, on trigger | 58 | 109 | 15 (12) | 33 | 9 |
| Plan conformance | 72 | 105 | 9 (9) | 15 | 12 |
| Opus code-reviewer | 426 | 555 | 10 (8) | 143 | 69 |
| Opus crosscheck lanes B and C | 68 | 181 | 4 (3) | 62 | 60 |
| Opus silent-failure | 62 | 89 | 3 (1) | 41 | 89 |
| Opus language | 42 | 82 | 7 (1) | 11 | 82 |
| Opus database | 22 | 60 | 0 | 2 | — |
| Opus blast-radius | 32 | 51 | 0 | 4 | — |
| Opus test analyzer | 19 | 19 | 0 | 14 | — |

Two readings matter. The Opus code-reviewer is a poor P0 or P1 finder and a decent P2 finder, at about
$4 each. And the P3 pile is where effort leaks: 1,963 of 2,961 findings were P3 (classified).

### Costs

**Run cost.** In the same window: $8,299 across all projects, about $4,150 a week, split as main threads
38%, review and audit 21%, other subagents 20%, implementers 16% and verify runners 5% (measured). The
two weekly digests on record show $2,283 and then $1,129 in Claude spend (W44 and W45, measured), and
that drop is not a controlled comparison. Cost per unit ranged from $6.78 to $79.42 in W45.

**One heavy milestone,** to show the shape (measured): $616, 41.7 hours of wall time made of 26.7 of work
and 15.0 of owner wait, 228 commits, +59,595 lines of which 37.4k were tests, 50 slices, 50 fix rounds
and 225 subagents. Fix rounds and re-reviews were 27% of it. The study's estimate is that its later fixes
would have cut it to $370–405.

**Owner time.** Owner wait exceeded work in two of three measured repositories (1h57m against 1h44m,
8h27m against 1h01m), and in 4 of 9 on a later export. Extremes run to 23h28m of wait on 6h59m of work,
and 35h33m on 10h31m (measured). W45 ranges: wait per unit from 57m to 8h42m, work per unit from 1h01m to
7h55m.

**Paperwork.** 287 findings (10%) were about the harness's own files. Two installs spent 34% and 15% of
main-thread turns writing briefs, triage notes, state files and ledgers, about $330 in 14 days
(measured and estimated).

**Building it.** v2 $107, v3 $65, v4 $41, v6 $273 against a $100–200 estimate. v5, v7 and v8 were not
measured.

**Rolling it out.** One install spent $59.90 on v5 and $30.38 on v6. v6 upgrades took 1h13m–1h44m of work
with owner wait up to 14h48m; v7 upgrades took about 35–47 minutes. One install took 17h47m, $56.03,
+22,574 lines and 7 fix rounds.

**The always-loaded base.** One install was at 52,233 bytes against a 46,614 budget, another had 8 bytes of
headroom, and a third sat 23 bytes under its cap (self-reported).

**Self-reference.** 56 of 129 parsed units across ten logs were harness, hygiene, sweep or retro units,
about 43% (classified by regex, excluding the origin project). Some of that is the rollout itself, but it
is the number to watch: a process that spends four units in ten on itself has to catch a lot to pay.
Since v9 the retro reports it, with product rows per day.

### A documents-only start on v7

One install began from a PRD, a TRD and a 115-row plan: a documents-only prototype, fictional data,
local only, one developer. It ran v7's foundation stage (measured from git, transcripts and the
harness log, to 2026-11-07):

| Figure | Value |
|---|---|
| Wall clock / owner wait | 29h28m / 16h02m |
| Cost, API-list | $166.52 |
| Units / of them on the harness | 8 / 7, every one Full and owner-merged |
| Plan rows landed | 1 of 115 |
| Commits / touching product source | 116 / 1 (84 records or docs, 18 mechanism, 8 merges, 5 app tooling) |
| Tests / product tests | 751 / 0 |
| Claim audit | 35 findings over 7 rounds, nearly all record prose; the tripwire fired twice |

What v7 text caused it: the install named its fifteenth row the pass-signal unit, so fifteen rows ran
Full and owner-merged before any test; the risk-map re-derive ran as a Full unit of its own; the sweep and
hygiene came due on the harness's own landings; a commands edit to `CLAUDE.md` ran the whole Full
sequence; reviews raised P1s that needed a hostile local user; and an owner's own branch rename and push
became two decisions, a question, a card and a follow-up.

What earned its cost: the first push was held because personal data showed in 22 of 31 reference
screenshots; the phase preflight found the documents' contradictions for $4.40; and the local CI gate was
proven red before it was trusted. v9 keeps each of these and changes the rest.

### Failure modes observed

- **Guards bypassed** in five projects. The class is real; the details stay out of this file.
- **Fix rounds regress:** 42 of 200 valid P0 or P1 findings came from fixes, and 24 of 118 in one milestone.
- **An edit to critical code after the last review,** reaching merge unread.
- **Reviewers mutating a shared tree,** so that a fix or a report reads a different tree from the one
  reviewed.
- **A review step skipped on critical paths,** recorded in the ledger as skipped.
- **Repeat false claims:** `FALSE CLAIMS` of 5 and then 7 in one install, after the rules against them.
- **Time misattributed:** a 3-hour wait counted as work.
- **Host limits:** an out-of-memory kill; sweeps refused by an auto-mode classifier; 5h21m lost to a
  weekly limit.
- **Template defects:** about 95 distinct ones across four rollouts, before v6. Hazards in one install then
  fell from 23 to 1 after its v6 upgrade.

### Rules that turned out wrong

The reference says roughly one reasoned rule in five was wrong, and keeps the list so that a generator does
not repeat them ([`reference/rules.md`](../skills/harness-bootstrap/reference/rules.md) §3):

| Rule | What happened |
|---|---|
| "Size is a poor effort proxy" | Written at n=2, retracted at n=19 |
| "A process tier is unnecessary" | Withdrawn at n=10, reversed at n=22 after 424 minutes on one task |
| "One task per session, then exit" | 28 of 118 sessions ended in a hand-off |
| "Offer `/compact` and `/clear`" | 94 keep-line pastes and 38 clears in 14 days |
| An Opus reviewer per slice | 63 runs, no P0 or P1 |
| Fix every finding at once | 20 of 50 fix rounds were P3 only |
| Separate language, blast-radius and docs reviewers | 1, 0 and 3 unique P0 or P1 |
| Two generic review commands on every diff | 92 and 31 agents on one change request |
| Full verification every slice | 39 runs, 8.4 hours |
| "Preflight never edits the plan" | Too absolute |
| A guard that only checks the branch is mainline | Refused every commit, including the owning run's |
| Elapsed measured from first commit | Missed grounding entirely |
| "A report is a claim," as a rule for the author | False claims kept rising until a separate agent checked them |
| Keyword-matching hooks | About 30 stalls, about 650 false blocks in 80 sessions, nothing caught |
| Every foundation unit Full and owner-merged until the first test | 8 units in 29 hours, 7 on the harness, 1 plan row of 115 |
| A claim audit over record prose, with a second-round tripwire | 35 findings over 7 rounds, nearly all prose |

**A measured recommendation can be wrong too.** The 2026-10-24 cost study recommended a new session at each
gate. That became v3's `/clear` offer on 2026-10-25, and was reversed on 2026-11-06, 12 days later, by a
study of what it cost the owner. Being measured did not make it right, because that study measured spend and
not the owner's attention.

### Where it is strong

- **Stopping false reports from counting.** Counted gates, generated records and a separate claim auditor turn
  assertions into commands.
- **Cross-family review.** Cheap against Claude quota, and it finds the most P0 and P1.
- **Survival.** State on disk means a crash or compaction loses at most a step.
- **Refusing work it cannot help,** through the preconditions and the readiness plan.
- **Knowing its own costs.** It can say what each reviewer bought, and it rerouted on that.

### Where it is weak

- **It cannot show net benefit,** as above.
- **Its most important stops are unenforced.** Gates and push rest on the model following instructions
  ([§4](#what-code-enforces-and-what-only-instructions-ask)).
- **It changes faster than it can be measured.** v4 ran nowhere. v8 shipped two days after v7 and eight days
  after v6, and installs sit across three versions, so most version claims have no before-and-after. v8 itself
  shipped with no second review after its fix round, against its own rule that a fix commit is new code.
  v9 shipped a day after v8, with v8 unpiloted, so the pilot measures the two together.
- **It is heavy.** 358 KB of skill text, 93 files, and an always-loaded base that keeps pressing its budget.
- **It depends on one owner's patterns.** All of the evidence comes from one owner's projects. Those habits are in
  the numbers, and the design may not transfer.
- **It is not validated outside Claude Code at the same depth.** ZCode transcripts are not read, and Kimi has no
  models row.

### When not to use it

Since v9, Phase A's fit check offers the last two the no-harness route: hard rules only.

- **No test that can fail,** except through the short foundation.
- **No owner who answers,** since then the gates are decoration.
- **Trivial work,** per Phase A row 3.
- **A one-off or throwaway repository.** The install alone costs more than such a project will recoup.
- **When speed matters more than a false-claim rate.** Plain Claude Code plus one cross-family review keeps the
  single largest source of P0 and P1 findings at a fraction of the process. That is an inference from the yield
  table and has not been tested.

### Recommendations

1. **Add the outcome metric first.** Count reverts, hotfixes and production defects per unit per week. Without it,
   every other number describes activity.
2. **Hold the next version until v8 and v9 have a measured pilot.** Run the checks in
   [§16](#install-state-2026-11-06), and re-run the session study over the pilot window. v9 itself broke
   this rule, because the first documents-only install showed the foundation stage stalling.
3. **Re-measure the projected figures** on 2026-11-16 as planned: v3's saving, the 300K window, the 150K rule.
4. **Decide what the gates are.** Either enforce Gate 2 and push in code, or say plainly that they are instructions
   and accept the risk.
5. **Target self-reference.** v9's retro reports the share and product rows per day, with no shipped
   target; the owner sets a stop-loss per pilot.
6. **Fix the disagreements below in one small round,** since they are cheap and a reader hits them first.

## 19. Open issues

Each item below was checked against the file named, at merge `50478698`. Line numbers will drift. Nothing here
is fixed by this document: it records them as input for the next round.

### Verified disagreements in the skills

**These can change what a run does.**

| Issue | Where | Suggested resolution |
|---|---|---|
| **Who commits a slice?** The main session owns "the commits"; the implementer is told to "commit the slice"; and `delegate-tasks` says "Executors never commit" | `reference/runner.md:33`, `reference/runner.md:507`, `skills/delegate-tasks/SKILL.md:276` | Pick one. The session committing fits the "commands decide" idea; implementer commits fit what installs do. Then fix all three |
| **Does a grant cover critical code?** The gate table says critical asks at Gate 2; `merge clean Full` covers any Full unit passing the Small test; the never-covers list omits critical | `reference/gate-design.md:267`, `:321`, `:328` | Add critical code to the never-covers list, or say that it is covered, then mark the row. This is a safety question, so it is worth settling before the pilot |
| **A kept grant shown for a parked unit.** The session-resume hook prints a parked row's `grant:`, while a parked unit must take the new run's grant | `templates/session-resume.mjs:198`, `reference/gate-design.md:332` | Print it only for held rows |
| **Grant and stop line between units.** With no row held, no file holds them, so they survive a compaction only in the summary | `reference/scope-guard.md:174` holds them per unit; `templates/session-resume.mjs:38` points back at the kickoff | Persist them in the registry. Already a v9 candidate |
| **Is a tripwire a stop?** "Stop in flight"; "stops only when its answer is P or C"; and "parks the unit" | `reference/rules.md:353`, `reference/gate-design.md:371`, `:71` | Parks, unless a rule answers it |
| **Command guard fails open,** and no rule refuses a plain `git push` | `templates/command-guard.mjs:32`, `:844` | A weekly review proposed the opposite. Choose per rule: a parse error on a push-class command could refuse |
| **Cold fix rounds of 2 and later are read by nobody on Small.** `review-gate` says `skip`; the claim auditor covers those commits only on Full, and Small skips it; meanwhile a fix commit "is new code" | `templates/scripts/lib/review-gate-core.mjs:316`, `reference/claim-auditor.md:113`, `reference/rules.md:126` | Decide whether regression tests are enough, then say so in the rule |

**These are wording or binding mismatches.**

| Issue | Where |
|---|---|
| "No Opus reviewer" on Small, while `review-gate` adds triggered specialists, which run on Opus | `reference/gate-design.md:175`, `templates/scripts/lib/review-gate-core.mjs:257` |
| "Dispatch exactly the reviewers it names," then a conditional adversarial pass and a frontier pass that `review-gate` never names | `reference/runner.md:357`, `:363`, `reference/cross-model.md:60` |
| An effort floor of `high`, while the `lane-a` route runs at `medium` | `reference/cross-model.md:260`, `templates/scripts/lib/codex-run-core.mjs` |
| `By: grant` in a column whose values are owner, default and agent | `reference/gate-design.md:325`, `reference/scope-guard.md:122` |
| "An owner gate parks" with no exception, where the question tool still applies under 150K with nothing else ready | `reference/gate-design.md:70`, `:54` |
| The 150K rule reads a figure from a hook that is optional and Claude-only, and no fallback is given | `reference/gate-design.md:50` |
| `autoCompactWindow: 300000` is called a binding, but no Phase C row writes it | `reference/context.md:159` |
| The land order still says push "on the owner's word" with no mention of a grant | `reference/commit-guard.md:216` |
| The runner's builder line names `codex-run implement-cold`; a Codex host has the bounded model instead | `reference/runner.md:297`, `reference/gate-design.md:461` |
| `review-gate` says it has not checked `importers>=10`, a size signal the risk map leaves empty | `templates/scripts/lib/review-gate-core.mjs:189` |
| The state line has no word for "stopped at the stop line with work left" or "hit the usage limit" | `reference/runner.md:24`, `reference/rules.md:307` |
| The review workflow's default `quality` agent is an unprefixed `code-reviewer`, in a `[B]` block whose neighbours are `ecc:`-prefixed | `templates/workflows/review.workflow.js:26` |
| Kimi is a named host, with no row in the models file | `templates/harness-models.json` |
| A finding that "does not reproduce" is retracted, and an "unverifiable" P0 or P1 stays blocking. Nothing says which of the two a failed reproduction is | `reference/runner.md:372`, `skills/delegate-tasks/SKILL.md:219` |
| `delegate-tasks` says the review workflow "runs the same fan-out", while the workflow's header keeps the second family's passes outside it | `skills/delegate-tasks/SKILL.md:221`, `templates/workflows/review.workflow.js:17` |
| "Break the code and watch the suite stay green" names the failure, and the next sentence asks for a control seen failing, so the headline alone reads backwards | `reference/rules.md:29`, `templates/agents-rules.md:20` |

**Stale text:**

- `reference/hygiene.md:3` says "not yet run as a unit", though hygiene units have run since 2026-10-27.
- `SKILL.md:16` and `reference/runner.md:3` say "21+" tasks for the origin, whose log now holds about 85 rows.
- `SKILL.md:77` says every rule followed a specific failure. Several in `reference/rules.md` §1 cite no incident,
  among them "an implementer may always raise a gate", "harness changes land between runs" and "one canonical owner".

### Numbers that do not agree

Both versions are shown here rather than one being picked.

| Number | Versions | Status |
|---|---|---|
| Total spend | $8,299 in 14 days (2026-10-10 to 24, all projects; main threads 38%, so about $3,150) against $6,777 in 21 days (2026-10-05 to 26, nine installs: main threads $2,774, subagents $4,003) | **Not reconciled.** The longer window is smaller, so scope or method must differ. Use each only within its own study |
| Valid product P0 or P1 | 200 headline; 170 summed by project; 173 by source | Sub-totals exclude some ledgers |
| P3-only fix rounds in one milestone | "20 of 50", against a trigger table that sums to 59 | Unreconciled |
| One milestone's state file | 337 KB, then 493 KB | Growth, not a conflict |
| Owner touches | 530 with 99 question-tool answers, while the retro KPI leaves those out; the kinds table sums to 523 | Definition differs |
| Finding artefacts | 2.4% rejected across 2,961 findings; about 6% in one project's log | Different populations |
| Open follow-ups, one project | 1,547 with 1,331 P3, against 1,568 with 1,320 | Cut dates differ |
| Codex runs in the window | 259, 273 and 321 | Unreconciled. Weekly meter readings ran to 72–78%, so "no Claude cost" is not free |
| Share of spend above 400K in `reference/context.md` | 60% and "about three quarters" | Unreconciled |
| Missed by harness | Defined as owner catches; rows also record later-lane catches | The KPI has drifted from its definition |

### Known gaps

- **Grant and stop-line persistence,** above.
- **KPIs that do not exist:** escaped-defect rate, a control group, realised savings.
- **Not yet measured in a real session:** the session-resume hook, the queue run, parked gates and the run grant.
- **Least-validated component:** the segment runner, with 2 runs and one halt. It is not installed by default.

### Candidates for v10

From the weekly reviews and the v8 round; v9 was the documents-only round and took none of them. None is
decided.

- Per-review worktrees, and a landing check for critical diffs changed after the last review.
- A padding check on state-file budgets, and write-once review returns.
- A machine-wait field, so that a long build is not counted as work.
- A nested-subagent coordinator, if the pilot shows the main thread's context staying high.
- Held until after 2026-11-16: the 150K rule, Phase F's first pass, mutation probing.

## Appendix A: the rules, one line each

[`reference/rules.md`](../skills/harness-bootstrap/reference/rules.md) §1 is canonical, and holds each rule's full
origin. Rules ship into each project's `AGENTS.md` from `templates/agents-rules.md`. The incident is in brackets.

**Proving things**

1. Break the code and watch the suite stay green: that is the failure to catch, because a control you have not watched fail is an assertion. [A guard inside `describe.skip`]
2. A control that goes red may be red for the wrong reason, so ask what made it red.
3. A validation that can report green having run nothing is not a validation. [11 skipped live cases]
4. No validation line passes by cache, skip or missing binary.
5. Never pipe a check through `tail`, `head` or `tee` inside an `&&` chain.
6. Ratchet the declaration a check reads, not only the check.
7. A guard's acceptance criterion points at the real schema or code the spec names.
8. Mutation runs: restore with `cp` and `cmp`; confirm the mutant applied; a mutant that removes a guard removes what
   it prevented; mutate operands too [18 survivors]; a kill belongs to the tree it was measured on.
9. Nothing merely asserted survives.
10. The record is written last, from the diff, with generated fields. [9 of 21 tasks]
11. A "done" report ends with the step ledger. [87 of 88]
12. Reproduce a finding before fixing it. [About 6% artefacts]
13. Trust a wrapper's exit code, never the agent CLI's own.
14. Verify that a command, agent or skill resolves before naming it.
15. A fix commit is new code.

**Gates**

1. Guard every commit: refuse, do not merely check. [588 lines of another session's work]
2. Gate 2 is not asked while a review is still running.
3. An unanswered Gate 2 question means park and carry, never consent.
4. An override covers the findings on the table when it was given.
5. A re-tier into a never-auto category invalidates the reviews already run.
6. A conformance verdict is not evidence of correctness.
7. An implementer may always raise a gate, never lower one.
8. Ask the owner only what only the owner can decide. [373 questions]
9. Taste is not a risk tier.

**Sizing and measurement**

1. Re-tier at both gates, not only at grounding.
2. Measure elapsed from the lock claim, not the first commit.
3. The log append must be idempotent, because a resumed run reaches that step twice.

**Cost**

1. P3s never start a fix round. [20 of 50]
2. A re-review reads the fix diff, by the reviewer whose finding was fixed.
3. Never leave a session or a dispatch at `max` effort.
4. One turn, many tool calls. [96% of turns made one call]
5. Split a milestone that will not fit one session.
6. Never re-run a gate on a tree it already passed.
7. At an owner gate past 150K, the cards go out as text.
8. Wait on a completion notice, never a sleep loop, and shrink a screenshot before reading it.

**Sessions and the working tree**

1. Hold edits until every reviewer has reported, and never stage with `git add -A`. [Six times, probe files swept into commits]
2. Every review dispatch gets its own scratch directory, inside the tree and gitignored. [Four reviewers overwrote each other]
3. Every subagent brief forbids host-level operations by default.
4. Chain an edit script to its commit with `&&`.
5. A check whose result a commit message asserts is a precondition of the commit.
6. Harness changes land between runs, never during one.
7. Never hand the context to the owner.
8. Start the next ready unit; never make the owner say what is next.
9. A run's turn ends on a state line.
10. Search, then read once; one slice per agent.
11. Run the full verification once per unit, not once per slice. [39 runs, 8.4 hours]
12. Stop processes by the PID you recorded, never by name.

**Documents**

1. One canonical owner per fact.
2. A decision's reasoning may outrun the decision, so check whether it was applied consistently.
3. Fix a fact in every document that repeats it.

## Appendix B: commands

**In the plugin:**

```bash
node <skill dir>/scripts/harness-status.js <repo> --text      # read-only status
node <skill dir>/scripts/retro-weekly.mjs --list              # registered repositories
node <skill dir>/scripts/machine-sweep.mjs                    # report only; applies nothing
```

**In a project:**

```bash
/task-runner                                                  # resume what is held, then the queue
/task-runner <unit>                                           # that unit, then the queue
/task-runner <unit> only                                      # that unit alone
node scripts/harness-host.mjs                                 # host and role models
node scripts/harness-due.mjs --claim <row>                    # due-checks for a claim
node scripts/unit-step.mjs <unit> <step> start                # step marker
node scripts/review-gate.mjs --base <sha> --kind unit --tier full --writer main
node scripts/review-gate.mjs --base <sha> --kind fix --max-fixed P1 --round 1 --writer second
bash scripts/run-gates.sh --list                              # bound gates
bash scripts/run-gates.sh                                     # full verify
node scripts/unit-cost.mjs --session <id> --by-step <steps file> --unit <unit>   # where the money went
node scripts/estimate.mjs --log docs/harness/log.md --tier full                 # Gate 1's range
node scripts/check-agent-docs.mjs --base                      # lists the always-loaded base and its target
```

The `--help` of each `.mjs` CLI under `scripts/` is authoritative (`tests/fork/harness-cli-help.test.js` holds this).
`run-gates.sh` has no `--help`: it refuses the flag with a one-line usage, and its header comment has the detail.

**In this fork:**

```bash
npm test                                                      # the suite, hook allowlist off
npm run fork:bump                                             # any change that ships
npm run fork:apply                                            # regenerate derived files; run it last
node fork/bin/verify.js --drift --since origin/main           # before committing
```

## Appendix C: test map

This repository has 30 `tests/fork/harness-*.test.js` suites that test the templates and the skill's scripts, plus
`tests/fork/harness-doc.test.js` for this file.

| Suite (`harness-…`) | Covers |
|---|---|
| `agent-docs`, `template-lint`, `skills`, `cli-help` | The docs check script; the templates passing a project's lint; skill structure, the shipped guard and the budget hook; `--help` on every script |
| `command-guard`, `guard-scope` | The command guard's rules; the commit guard's checkout scope and Branch-cell matching |
| `run-gates`, `run-counted`, `project-tests` | The gate runner; counted gates; an install with bindings, run at pinned suite counts |
| `review-gate`, `review-workflow` | Reviewer routing; the workflow's fail-closed verifier |
| `unit-step`, `unit-record`, `unit-cost`, `unit-stack`, `estimate` | Step markers; record fields; cost; stack slots; ranges |
| `due`, `retro`, `retro-weekly`, `machine-sweep` | Due-checks; digests; the weekly job; the sweep |
| `context-budget`, `session-resume`, `leftover-processes` | The hooks |
| `codex-run`, `claude-run`, `run-status`, `host` | The wrappers; run status; host detection |
| `docs-drift`, `intake`, `status` | Drift list; intake checks; `harness-status.js` |

`harness-project-tests` installs the templates, binds the `[B]` values and runs six suites at pinned counts:
command-guard 17, edit-guard 9, harness-guard 12, context-budget 8, session-resume 8 and run-gates 10.

**In a project,** 21 test files run through a counted `harness` gate at `full` level, so a skip fails it.
`leftover-processes.mjs` and `unit-stack.sh` ship with no project test.

## Appendix D: reference-file map

Under `skills/harness-bootstrap/reference/`:

| File | Owns |
|---|---|
| `reference/policy-derivation.md` | The single test; never-auto policy, risk map, merge policy |
| `reference/foundation.md` | The documents-only route and the flip |
| `reference/upgrade.md` | Manifest, kinds, three-way merge, the version table and each version's upgrade |
| `reference/harness-targets.md` | Per-host forms of every generated file |
| `reference/runner.md` | The sequence, task types, tier matrix, due-checks, implementer brief |
| `reference/gate-design.md` | Decision classes, parking, grant, gate table, merge policy, review lineup, fix rounds, models |
| `reference/scope-guard.md` | Scope classes, decision log, state file |
| `reference/commit-guard.md` | Guard behaviour, `SCOPE`, land order |
| `reference/cross-model.md` | The second family's points in the run; wrappers and kinds |
| `reference/conformance-auditor.md`, `reference/blast-radius-auditor.md`, `reference/claim-auditor.md` | Lanes A, B and C |
| `reference/context.md` | Context rules, hooks, measured levers, base budget |
| `reference/log-format.md` | Log columns and estimates |
| `reference/learning.md` | Retro, weekly job, Phase F |
| `reference/rules.md` | Rules, tripwires, disproved rules, observations |
| `reference/intake.md` | The Intake type and owner sheet |
| `reference/preflight.md`, `reference/sweep.md`, `reference/hygiene.md`, `reference/machine.md`, `reference/vendor-skill.md` | The maintenance jobs |
| `reference/segment.md` | The segment runner: not a default |

## Appendix E: sources

Every number here comes from one of these. The private ones are not in this repository, and project names are removed.

| Source | Window | Used for |
|---|---|---|
| A usage study (private) | 30 hours, and 2026-10-10 to 24 | Spend, reviewer yield, finding outcomes, one milestone's cost |
| A v4 question study (private; summarised in `reference/gate-design.md`) | 2026-10-10 to 25, three projects | 373 owner questions |
| A v5 context study (private; summarised in `reference/context.md`) | 2026-10-05 to 26, nine installs | Window replay, cache rewrites, base, subagents |
| A v8 session study (private; summarised in `reference/rules.md` §3) | 2026-10-23 to 11-06, 127 sessions, ten installs | Owner touches, clears, runs between touches |
| Weekly digests (private) | W44 and W45, 2026 | KPIs, ranges, weekly review cost |
| Project harness logs and install reviews (private) | From 2026-09-06 | Origin failures, install-review findings, upgrade costs |
| [`reference/rules.md`](../skills/harness-bootstrap/reference/rules.md), [`reference/upgrade.md`](../skills/harness-bootstrap/reference/upgrade.md) | Public | Rule origins, version table |
| This repository's git history | Public | Merges, dates, file counts |
