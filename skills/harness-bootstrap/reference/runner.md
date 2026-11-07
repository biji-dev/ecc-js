# Reference: the runner

The most-validated artifact here. Plan mode: 21+ runs in the origin project and 10
in a second, revised roughly twenty times between them. Change mode: a third
project's eleven-step workflow, about 120 sessions behind it. **One runner skill
serves both**: the front-ends differ until Gate 1, and the sequence after it is the
same.

**`[M]` = mechanism, ship it.  `[B]` = binding, re-derive from the project.**

## Shape

`[M]` **Stateless.** State lives on disk — the registry row and the unit's state
file (`scope-guard.md`) — so any session picks up cold and a crash or a compaction
loses nothing but the current step.

`[M]` **No hand-off: a queue run.** `/task-runner` resumes what is held, then the
queue; `/task-runner <unit>` runs that unit, then the queue; `/task-runner <unit>
only`, that unit alone. A kickoff may carry a `Grant:` line and a stop line
(`gate-design.md` › The run grant). After a land, announce the next ready unit in
one line and start it: answered parked units, then due-checks, then the next ready
row. Stop only on a command's word — an empty queue, all left waiting on the owner
(`gate-design.md` › Parking a unit), the stop line, the host's own usage limit —
and end the turn on the state line (`rules.md` §1). An `escalate-adversarial`, a
tripwire or a memory refusal at a live step parks its unit; a second family out of
quota is `degraded`, never a stop.
> Origin: 28 of 118 sessions in the third project ended in a hand-off, about 90%
> forced by a "start a new session" budget rule; v7's offers drew 94 keep-lines, 38
> `/clear`s and 33 "what's next" prompts in 14 days (`rules.md` §3).

`[M]` **The main session coordinates and reviews.** It owns the tier, the gates,
the plan text, the slicing, every brief, the critique of every report, triage, the
scope guard, the decision log, the commits and the merge. Above Small it writes no
feature code and reads no file whole: it reads reports, `git diff --stat`, hunks
of critical files and gate result lines. Code reading goes to a search agent; a
generated or large file is never `Read` in the main session (`context.md`). **A
report is a claim** it checks against the plan, the diff and the Scope block before
acting on it.

`[M]` Short, pointing at the harness file rather than restating it. Production
runners grew to about 250 lines; past that, move rules into the harness file and
cite them.

`[M]` **Generated to `.agents/skills/task-runner/SKILL.md`**, with a committed
relative symlink at `.claude/skills/task-runner` (`harness-targets.md`). An
upgrade keeps an existing runner's name through the manifest's `roles`. Beside it,
`process.md` holds the run's blocks (`harness-targets.md` › The run's blocks); the
runner reads it before step 0 and on every resume.

## Task type first — before the tier

`[M]` Classify by **what will change** — `git status --porcelain -uall` (staged,
unstaged and untracked) or `git diff --name-only <base>` plus untracked files —
never by feel. Check in this order; unsure → the heavier type.

| Type | Test | Runs |
|---|---|---|
| **Ops** | a deploy, migration run, production data fix or credential rotation, even with no repo change | its runbook, owner approval first; the runbook's mechanical steps on a Sonnet runner, judgment calls in the Opus session (`context.md`) |
| **Answer** | nothing changes — a question, an investigation, a review, a status, a plan only | no steps; the answer quotes its evidence. **A bug's cause, even with no fix, takes step 1's root-cause route** |
| **Intake** | new behaviour no request and no plan row covers, with an open P or C decision or more than one deliverable | `intake.md`: capture, ground, draft in the project's own shape, the second family's review, one owner sheet, register and queue — no code; unit 1's Gate 1 is then `intake.mjs --gate1`'s |
| **Docs-light** | every changed path is prose, and no test or script reads it | write, format, lint, commit; one ledger row |
| **Docs-heavy** | the same, but a rule file, a runbook, a change request, or ~200+ lines others act on | Docs-light + one review by the other model family + one fix pass |
| **Code** | anything else — docs mixed with code, a doc a test reads, a hook | the tiers (`gate-design.md`) and the sequence below |

`[B]` Which files are rule files; the line threshold for Docs-heavy; how to tell
that a test reads a doc. The harness's own files — `AGENTS.md`, `CLAUDE.md`, the
skills and agents — are read by the agent-docs lint, so a change to them is
**Code**, never Docs; a diff of harness paths alone runs the harness lane (below).

`[M]` **Docs units still go through the lock and the merge policy.** They take no
Scope block, but they claim a registry row, branch and land like a Small change —
the guard refuses an unclaimed commit while a run holds the lock on this checkout, and where the
merge policy sends every tier to the owner, a docs change waits for the owner too.

## The sequence

```
0a resume      a held registry row or an existing unit branch = a stopped run; verify each step against evidence
0  claim       due-checks · type · tier · unit · overlap · branch (+ worktree) · lock · state file
1  ground      plan mode: sync both ways, follow the trace, read follow-ups owed
               change mode: investigate → plan + Impact Analysis + Scope block → plan check (Full)
                                                          ══ GATE 1 ══  one decision sheet
2  implement   slices with their tests; an executor per slice from the risk map
3  sync        re-sync the mainline before auditing
4  conform     lane A — the conformance auditor, against the plan and the Scope block
5  run live    start it, exercise it with real data
6  integrate   third parties: assert the downstream effect, not a 200
7  visual      UI only — structure before pixels
8  review      routed reviewers + the second family · lane B blast radius · adversarial (Full)
               · bounded fix rounds
8a docs        the doc sweep · then the FULL verify run
8b record      written last, from the diff, as fields
8c claims      lane C — the claim auditor (claims, test honesty, fix commits)
                                                          ══ GATE 2 ══  by the merge policy
9  land        guard → land commit → release the lock → merge → push on the owner's word or the grant → due-checks
10 teardown    stop what was started; close the state file; start the next ready unit
```

`[M]` 3 → 4 order matters: audit the merged reality, not the pre-sync diff.

`[B]` 5, 6 and 7 are conditional on what the unit delivers. No UI drops 7; no
third-party surface drops 6.

**Change installs that already number eleven steps** keep their numbers, and those
numbers are their step ids: in the markers, the dispatch tags and the ledger. The
correspondence is: investigate, plan, plan check → 1 · decision sheet → Gate 1 ·
implement and tests → 2 · diff review → 8 · cross-check A/B/C → 4, 8, 8c ·
regression → 5–8 · a tests step after regression → before the FULL verify · doc
sweep → 8a, then the FULL verify · ship → 9. Such an install reads this file's step
numbers through the correspondence: "step 9" is its ship step.

## Step markers

`[M]` **Every step's start is a command, never prose:** `node scripts/unit-step.mjs <unit>
<step> start`, chained onto the step's first command (`node scripts/unit-step.mjs EP-7 8
start && node scripts/review-gate.mjs …`) so a marker costs no turn of its own. A start
closes the step before it, so `done` (`node scripts/unit-step.mjs <unit> <step> done`) is
needed only after the last step and before a stop.
Step ids are the sequence's own (`0a`, `0`, `1` … `8a`, `8b`, `8c`, `9`, `10`), `g1` and
`g2` for the gates; a step's second round passes `--round 2`. review-gate counts fix
rounds, not step rounds, so its `--round 1` runs inside step 8's round 2. The steps file
sits beside the state file (`scope-guard.md`); `--list` prints what it holds. Small and
Full; Trivial needs none.

`[M]` **A marker refuses the wrong checkout** — exit 1, the unit's `cd` printed:
outside `MAIN_CHECKOUT_STEPS` (`0a`, `0`, `10`) the branch carries the unit id or is
the state file's `Branch:`, and git checks a branch out in one worktree only.
`--check <unit>` is the check alone, chained before the gates and each dispatch.
> Origin: resumed sessions ran on `main`, or in another lane's worktree.

`[M]` **Every dispatch's description starts with the tag `[<unit> s<step> r<n>]`** —
`[EP-7 s8 r2] codex review` — so `unit-cost.mjs --by-step` puts each subagent's cost on its
step. An untagged dispatch goes by when it started.

`[M]` **Step 8b reads them:** `unit-record.mjs --steps` puts each step's time in the
record, and `unit-cost.mjs --times --by-step <steps file>` gives the wall, owner-wait and
work time and the dollars per step (`log-format.md`).
> Origin: one unit's record step took 19% of its $78.41, found only by rebuilding its
> steps from the transcripts by hand.

## Due-checks

`[M]` **Step 0 starts with `node scripts/harness-due.mjs --claim <row id>`; the land
step (9) ends with `node scripts/harness-due.mjs`.** It reads the log, the follow-ups doc,
the reports, git and the free disk, prints one line for each thing the harness owes,
and never asks a question. What each line makes the runner do:

| Line | The runner |
|---|---|
| `DUE preflight <phase>`, exit 1: the claimed row opens a phase with no report | **stops the claim** and runs the phase preflight (`preflight.md`); its escalations become Gate 1 cards. A phase already under way is named, never stopped |
| `DUE sweep` · `DUE retro` · `DUE hygiene` · `DUE p3` | names it in the claim line and carries on; at step 9 the first one still due is the next unit after any answered parked one (› Shape), a `harness/<slug>` unit. Cadences count product landings only; before the flip they print `HELD … — foundation stage — they wait for the flip` instead |
| `DUE disk` | starts the approved machine-sweep categories in the background (`machine.md`); with none approved, the line goes in the next owner brief |
| `DUE worktrees` | removes each one no registry row names and no process runs in (`git worktree remove`, never `--force`) |
| `NEW proposals <week>` | routes each proposal (`learning.md` › The retro review), then runs `--seen <week>` |
| `INBOX <unit> <gate> since <time> · <cards>`: a parked unit (`gate-design.md` › Parking a unit) | runs on with the next ready unit; once answered (its Cards cell), it is the next unit claimed |

`[M]` **No queue is stored.** The checks re-read the files each time, so a unit
that is due stays due until its report is committed, and nothing has to remember
it. Reports are committed at `REPORTS.<kind>` in `harness-due-core.mjs` (default
`docs/harness/reports/<file>`), never in a gitignored directory: a report nobody can
count does not exist for the next check.
> Origin: 13 preflights and sweeps in two projects caught real problems, each one
> because someone asked; two ran overdue, and one "sweep due" note lived in a
> session's memory only.

`[B]` In `scripts/lib/harness-due-core.mjs`: `MAIN`, `LOG`, `FOLLOW_UPS`, `REPORTS`
(`null` for a kind the project does not run), `PHASE_OF`, `CADENCE`, `P3_AGE_DAYS`,
`DISK_MIN_GB`, `WORKTREE_IDLE_HOURS`, `COMMANDS`.

## The hygiene unit

`[M]` **`DUE hygiene` queues a `harness/hygiene-<date>` unit** (`hygiene.md`): the P3
batch, dead code, docs drift, the archive and the residue. With no hygiene unit
bound, `DUE p3` queues the P3 batch alone.

## Which steps each tier runs

| Step | Trivial | Small | Full |
|---|---|---|---|
| 0 claim | type + tier in the claim line | + Scope block, frozen when stated | + Scope block for Gate 1 |
| 1 ground | — | light: cause or reuse noted in the plan | full: root cause, Impact Analysis, plan check |
| Gate 1 | — | **auto** unless the risk map or the policy is hit | owner — unit 1 of an approved intake: `intake.mjs --gate1` |
| 2 implement | the session | the session or one executor | one executor per slice |
| 2 per-slice review | — | — | `review-gate.mjs --kind slice`: the second family |
| 4 conform | — | against the Scope block | against plan + Scope block, once; a scoped re-audit only when a fix touches a plan item |
| 5–7 live | if it changes behaviour | **yes — never dropped** | yes |
| 8 review | — | `review-gate.mjs --kind unit --tier small`: the second family's review | `--kind unit --tier full`: one Opus code-reviewer + the adversarial pass (lane B) + triggered specialists + `pr-test-analyzer` (Sonnet) |
| 8 fix rounds | — | `review-gate.mjs --kind fix`; P3s go to the P3 batch | the same (`gate-design.md`) |
| 8a docs | in the same commit | `docs-drift.mjs`, in the same commit | `docs-drift.mjs`, then a separate sweep |
| 8a verify | scoped | FULL once before merge | FULL |
| 8b record | ledger line | `unit-record.mjs` | `unit-record.mjs` + the deviations |
| 8c claims | — | **skipped; the record is generated** | blocking, **behaviour claims**, one round |
| Gate 2 | by the merge policy | by the merge policy | owner |

`[M]` **A P0 or P1 from review promotes Small to Full** — the unit then runs the
plan check, lane A against a written plan, lane C and the adversarial pass.
**Hot-small**, once its cap is filled (`gate-design.md`), runs Full's column
without the plan check, lane A and the separate doc sweep; step 8 is `--tier full`.

## The harness lane

`[M]` **A diff of harness paths alone** (`HARNESS` in `review-gate-core.mjs`; a
doc changes no tier's review) runs Small's column with these changes: step 1 is an
impact note; 4 and 8c do not run; 5–7 are the shipped tests and
`check-agent-docs.mjs`; step 8 is `--tier harness`, one cross-family review and one
fix round, a second round the owner's call. Gate 1 is the claim line and Gate 2 the
merge policy's, except that the owner takes both for a guard (the commit guard, its
hooks), a gate (`run-gates.sh`, `review-gate.mjs`, the `gates` block), a reviewed
block or the rules block. A diff Trivial fits stays Trivial unless it edits one.
> Origin: seven of one install's first eight units were its own harness, each Full.

`[M]` **Harness work waits for product work.** A non-blocking harness follow-up
goes into one harness unit per milestone unless the owner orders it now; an owner's
request runs when asked, its claim line saying what it displaces.

## Batched rows

`[M]` **One unit may carry two or three consecutive Small rows of one phase**,
their dependencies landed or in the batch, none never-auto, critical or behind an
open P or C card; the owner may raise the cap, the runner may not (`segment.md`).
One registry row, branch `<first id>-<last id>-<slug>`, unit id the first row's,
every row on the `Rows:` line and in the Scope block. One slice per row, one step-8
review over the combined diff, one fix round; 8a checks every row's "Done when";
the record's Deliverable cell starts `rows <id>, <id>, <id> —`; Gate 2 shows one
`Demo:` per row. **A row promoted to Full splits the batch:** the rows before it
finish as a smaller batch from their last slice, their `Rows:` line cut to them, and
the promoted row and the rows after it go back to the queue, it as a Full unit of its
own (`segment.md` › Halting).

## Per-step notes

**Step 0a — resume.** `[M]` A held row, an answered parked one (moved back to the
active table first) or an existing unit branch means resume, not start. **The checkout first:** `node scripts/unit-step.mjs --where [<unit>]`; one
candidate, `cd` there; several, ask — never pick by plan file. Read the state file;
the row's `Step` says where the run *thought* it got to — **verify, do not trust the marker.** Restart from the earliest step you cannot
evidence; redoing a step is cheap and never wrong. Commit uncommitted work first,
as its own commit. Never reclaim a row you do not own.

**Step 0 — claim.**
- `[M]` **The due-checks first** (› Due-checks): a missing preflight for the phase
  this row opens stops the claim before anything is held.
- `[M]` **The host, once a session:** `node scripts/harness-host.mjs`. Its first line
  gives each role's model on this host for the claim line and the switch line, and
  each `HAZARD` line goes to the owner (`gate-design.md` › Model and effort).
- `[M]` **State the claim line:** unit, type, tier, whether it touches the risk map's
  critical code or a never-auto category, both gate decisions, the model for each
  role, and on Small the Scope block.
- `[M]` **Decision first.** A change that hangs on a P or C decision nobody has taken
  (an `Owner decides:` follow-up row, an open card) asks it as one card, before
  any step 1 work that depends on it. Until it is answered the claim carries the
  stricter tier; after it, re-tier for what remains. An answer on record is reused.
  > Origin: a one-line guard edit ran Full; the line only applied an owner's choice.
- `[M]` **The lock is also the concurrency guard.** One row per active unit, held
  for the whole run, its `Step` updated at every boundary. The commit guard reads
  it (`commit-guard.md`); in `SCOPE=checkout` the row names its worktree.
- `[M]` **The registry is also a resource lock** where units share machines —
  ports, isolated stacks, migration slots in the same row; `scripts/unit-stack.sh`
  holds live stacks side by side (`commit-guard.md` › The registry).
- `[M]` Compare this unit's write set against every other held or parked row.
  Overlap means sequence, not parallelise: take the next ready unit instead.
- `[M]` **One unit in flight**, plus hotfixes; a parked unit is not in flight.
- `[B]` Branch naming (carrying the task id, or matched by the Branch cell) ·
  worktree convention. **Every kind of unit has a branch form:** plan items carry
  their id; the code half of an approved change request carries the request's id (or runs on
  `change/<slug>`, matched by the Branch cell, when requests carry none);
  harness work, vendor-trap skills and follow-ups no unit owns run on
  `harness/<slug>`, matched by the Branch cell, and that branch is the unit's id in
  the registry, the log row and the merge subject: the cadences and the retro tell
  harness work from product work by it. Write the generated paths with
  `<unit>` (the id or the slug), never the plan's id shape alone.
- `[M]` **In the foundation stage** (`foundation.md`) the skeleton is the one
  product unit, Full and owner-merged; the flip follows it, and no other harness
  unit runs first unless it blocks the flip.
- `[M]` **An owner's own push, rename or commit is a fact:** one decision-log line,
  never a finding, a follow-up or a card. Where a rule binds pushes, this claim
  carries one check row over the pushed range.

**Step 1 — ground, plan mode.**
- `[M]` **Sync both directions.** Behind: pull before branching. **Ahead:** another
  session left unpushed work, and this push would publish it — ask first.
  > Origin: the local mainline was four commits ahead, and no step looked.
- `[M]` Read the follow-ups doc: rows scheduled for this unit are part of its
  requirement. Verify the dependency list before presenting it.
- `[M]` The IA, and the plan check where it runs, as in change mode, in the plan
  document.

**Step 1 — ground, change mode.**
- `[M]` **Investigate.** A bug: no fix without the root cause, decided by Opus or the
  second family's `investigate`, **never by a search agent**, which returns
  locations and quoted evidence only. A feature: read the touched modules, list the
  invariants, reuse patterns. A third-party surface: current vendor docs first;
  measurements in the repo still win.
- `[M]` **Plan + Impact Analysis** (Full): files, functions, data flow, edge cases,
  tests; for every caller, invariant and dependent flow, how it is preserved, with
  function names and line ranges, **found by** (the search that listed them; required
  on an "every" or "no other" claim) and **proof** (its test, or `none`: lane B's
  targets). Small writes `IA: <surface> · readers: <search result>` or `IA: none — no
  shared surface`. The plan opens with the **Scope block**.
- `[M]` **Plan check** (Full, when the approach is open — the row's design
  section or the request names none, or the preflight raised a card on it): the
  blind dual plan (`cross-model.md`), then a plan comparison the session merges. **A
  failed plan is revised, never carried on.** Then its **Drawbacks** and one **plan
  critique** by the other family (`cross-model.md` › The plan critique). An approach
  the documents already fix gets the Impact Analysis only.
- `[M]` **Nobody reads the plan whole.** Grep the section; paste the slice verbatim
  into its brief.

**Gate 1 — one decision sheet.** `[M]` In this order (`scope-guard.md`,
`gate-design.md` › Who decides):

1. **The deliverables**, each with its `Demo:` line — what the owner will be able to
   open, do and see. **A table past the cap splits here** (`gate-design.md` ›
   Milestone size).
2. **The P and C decision cards** — nothing else is asked.
3. **The estimate**: `node scripts/estimate.mjs --log <harness log> --tier <tier>`
   — per unit, p25–p75 for work time, owner wait, Claude % and Codex %, with
   its cohort size, or "no history" — and the second family's weekly meter from its
   ledger. A range from this project's log, never a single number.
4. **Decided** — the T decisions taken, one line each with its reversal cost.
5. **The slicing table**: slice · files · executor · order · gate · expected counts
   · risk · deliverable. Every acceptance criterion maps to a slice, or the table is
   incomplete. Cold slices name the second family's `implement-cold` (or a Sonnet
   builder where the task needs a browser, a service or steering) — never the Opus
   implementer. The owner may change any executor cell in the reply (› Executor
   override).

A Gate 1 that waits on the owner parks the unit (`gate-design.md` › Parking a unit).

`[M]` **Unit 1 of an approved intake runs `node scripts/intake.mjs --gate1 <request>
--state <state file>` first.** `Gate 1: auto — …` skips the sheet, quoted in the
ledger's Gate 1 row; `Gate 1: owner — …` opens the sheet with that line
(`intake.md` › Unit 1's Gate 1).

**Step 2 — implement.**
- `[M]` **An executor per slice, from the risk map** (`gate-design.md`): critical
  slices to the Opus `implementer` agent, serially, never in parallel; cold slices
  **to the second family first** (`codex-run implement-cold`) while its budget guard
  allows, else to Sonnet builders through `delegate-tasks`; the session may
  implement Small itself. Never-auto, migration and auth slices are Opus only unless
  the owner's override says otherwise (below).
- `[M]` **Executor override.** One field, `executor: codex | opus | sonnet | auto`,
  on a slicing-table row, unit-wide as `executor-default:` in the plan or state
  header, or in the owner's Gate 1 reply (`S3: codex`). Precedence: the owner's
  word, then the risk routing, then the default. Lowering the writer on critical or
  never-auto code is a **C** decision, the owner's only, recorded as a decision row;
  such a slice runs `review-gate.mjs --writer second` (`bounded` for a Sonnet
  override) so an Opus reviewer reads it.
  An override to the second family while its budget guard reserves write kinds
  (`codex-run` exit 4) falls back to Sonnet and says so in the ledger.
- `[M]` **One slice per agent.** A fix round is split by area into several.
  > Origin: one agent handed a whole fix round ran 309 calls, to 368K of context.
- `[M]` **Every brief has a `Traps:` line**: each vendor-trap skill
  (`vendor-skill.md`) whose library or tool the slice touches, by path (a gate or
  script slice counts the package manager), or `Traps: none`. `--rules-for` finds
  rule files by their `paths:` globs, never a trap skill, and one no brief names
  goes unused.
  > Origin: in one project agents read the trap skills its briefs named 45 times, and
  > the four no brief named once (2026-10-05 to 26).
- `[M]` **After each slice:** read its report and `git diff --stat`, run the drift
  check, then `node scripts/review-gate.mjs --base <slice base> --kind slice
  --writer <role>` (the role that wrote it) and dispatch what it names — the
  **second family's review** over
  that slice's diff before the next slice builds on it (`codex-run review`); a cold
  slice the second family wrote is deferred to the unit review. **Never an Opus
  code-reviewer per slice.** The review runs in the background while the next
  independent slice starts. A follow-up goes to the same agent while its context is
  small. Update the state file.
- `[M]` **Independent twins run in parallel** — a web and a mobile screen over a
  contract that has already landed, for example — each a cold slice of its own.
- `[M]` **Tests land with their slice**: a bug's regression test fails without the
  fix; a feature's golden path and Impact Analysis edge cases. Prove each with a
  control (`delegate-tasks` control specs): break the protection, paste the red line,
  restore, paste the green line.
- `[M]` A slice runs its targeted tests only — **once per batch of edits**, the
  related tests of every file it touched in one command, not one run per file. The
  session runs a scoped verify after a slice that crossed packages, and the FULL
  verify once, at the end of step 8a — **never once per slice**. Tests a later step
  adds (a doc-sweep test, a parity test) land **before** that FULL run, not after it.
  > Origin: one change request ran the full suite 39 times, 8.4 hours; implementers
  > ran 3,758 single-file test runs (18.6 h) in 14 days (the v4 usage study).
- `[M]` Commit at every meaningful step, naming paths, never `git add -A`.
- `[M]` Mutation runs follow `rules.md` §1.

**Step 4 — conform.** `[M]` Dispatch `plan-conformance-auditor` with
`model: "sonnet"`, `effort: "high"`. A fix round that introduces a new blocking
finding is a stop (`rules.md` §2). A scoped re-audit only after a fix round that
touches a plan item. Tell it which columns are written at land.

**Steps 5–7.** `[M]` Every validation line follows `rules.md` §1. Live pass: drive
the real surface, including refusal and empty states, and follow one figure across
every surface that states it. Visual: assert against the accessibility tree or a
DOM snapshot; send screenshots to a model that reads images.

**Step 8 — review.**
- `[M]` Run `node scripts/review-gate.mjs --base <merge base> --kind unit --tier
  <tier> --writer <role>` (the role that wrote it; `mixed` when the second family
  wrote part of it, `bounded` when Opus and Sonnet wrote it together) and dispatch
  exactly the reviewers it names, independent ones in **one message**, with `model`
  and `effort` passed on each (`gate-design.md` › Review lineup; lane B's brief in
  `blast-radius-auditor.md`). On Small the adversarial pass with lane B's brief joins
  when the Impact Analysis lists a reader outside the diff. The second family
  unavailable → the fallbacks in `gate-design.md`, `degraded`.
- `[M]` **Each dispatch gets its own scratch directory**, `.review-work/<name>/`.
  Briefs forbid host-level operations and repository-wide suite runs. A reviewer
  that mutates code to prove a test does it in a worktree of its own, never the
  shared tree (`claim-auditor.md`).
- `[M]` **Hold edits until every reviewer has reported.**
- `[M]` **Reproduce before fixing.** Read the cited line, run the single test or
  probe the endpoint. A finding that does not reproduce is **retracted**, never
  "fixed".
  > Origin: about 6% of claimed gaps in the third project were artefacts, such as
  > another worktree's test run.
- `[M]` **Triage by scope class, then severity**: OUT → filed or dropped
  (`scope-guard.md`) whatever its severity; P3 → **the P3 batch**, never a fix round,
  unless on a line this round already changes.
- `[M]` **Fix rounds** are bounded by `gate-design.md`, and each fix gets a
  regression test proven to fail without it. One brief per area; fix groups on
  critical code go to Opus; the rest to the second family's `fix-cold` while its
  budget allows, else Sonnet. After the round, `review-gate.mjs --kind fix
  --max-fixed <P> --round <n> --writer <role>` names the re-review, which reads the
  fix diff only; `--writer` is the role that wrote the fix, as for the unit.
  `escalate-adversarial` is the third-round stop (`rules.md` §2): ask the owner,
  and run the adversarial pass only for the round the owner orders.
- `[M]` **The P3 batch** runs once per slice set, after the fix rounds: one Sonnet
  fixer (or the second family's `fix-cold`) over every P3 still IN scope, its
  targeted tests, no re-review (`review-gate.mjs` says `p3-batch`) — except a batch
  over critical code that Opus did not write, which the Opus `code-reviewer` reads.
  The P3s a unit defers go to the follow-ups doc, and the hygiene unit batches them.

**Step 8a — docs, then the FULL verify.**
- `[M]` **The doc sweep**, only when the diff changes a public behaviour, a named
  invariant, a module description or user-visible output. List stale docs with
  `node scripts/docs-drift.mjs --since <merge base>` — a script, not an Opus lane —
  and hand the candidates to a Sonnet runner or the second family's `docs` kind to
  rewrite the stale sections, never append. A change to a rule file updates every
  document that repeats the rule (`rules.md` §1).
- `[M]` Then the **FULL verify** (`context.md`), after the sweep's edits and every
  test a step added, so the one run reads what lands: every gate, one line each, each red
  attributed against the merge base, working tree included. Where the project bound
  `SNAPSHOT_COPY`, it is `bash scripts/run-gates.sh --snapshot` once the unit's work
  is committed: the gates read what lands, and no scratch file or note reaches them.
  `run-gates.sh` reuses an
  all-PASS result for the same tree (`REUSED <tree>`) — and for a tree that differs
  only in docs when the project bound `RUN_GATES_DOCS_ONLY`, which it does only if
  no gate reads those paths; a second agent that starts the same run waits for the
  first. Quote the `REUSED` line as the evidence — never re-run to have a fresh
  one. The key is the working tree's tracked and untracked files plus what
  `RUN_GATES_KEY_EXTRA` names and `NODE_OPTIONS`; ignored inputs (`node_modules`, `.env`) and refs are
  not in it unless named, and worktrees of one repository share the cache.

**Step 8b — write the record, from the diff.** `[M]` Now — not during the run and
not from memory. **Generate the fields:** `node scripts/unit-record.mjs --state
<state file> --steps <steps file> --gates <the FULL verify output> --cost "$(node scripts/unit-cost.mjs
--line --session <every session id since the start, comma-separated> --since <start>)"` prints commits, diffstat, the gate
SUMMARY line, finding counts by severity and by source, elapsed, each step's time, the ledger and the
draft log row from git, the state file and the steps file, never retyped. `<start>` is the state
file's `Deliverable started:`, else the claim: the row's own window, as for Elapsed
(`log-format.md`). On a Codex host the session ids are its thread ids
(`$CODEX_THREAD_ID`). The git-derived fields
are true by construction; the ledger and findings rows are copied as the session
wrote them.
The session writes only what no command knows: the deviations, the controls
evidence, the `<fill: …>` cells of the log row. **Quote-or-delete** every prose
claim in the record, the state file and the commit messages: it inlines its
evidence or goes; nothing re-audits it. **The record has a byte budget** like the
state file (`scope-guard.md`).
> Origin: two tasks took three and five claim-audit rounds; every false claim was
> in the record or a commit message, not the code.

**Step 8c — claim audit.** `[M]` Dispatch `claim-auditor` with `model: "opus"`,
`effort: "high"` (`claim-auditor.md`), over **behaviour claims** — code comments,
docstrings, test titles, each "Done when" line's evidence, test counts, the `Demo:`
line, the controls. Blocking
on Full, **one round**: a `FALSE CLAIMS` is fixed and that claim's command re-run.
> Origin, the cost study: 79 of the claim auditor's 105 P1s were about record
> prose, not product code; one install's audits then ran 7 rounds for 35 findings.

**Gate 2.** `[M]` Brief: **the deliverable's demo evidence** — its `Demo:` line,
the screenshot, the named tests or the live-walk transcript that shows it ·
**Decided for you** — every T decision row, one line each with its reversal cost ·
the P and C cards still open · verdicts · unresolved findings · diffstat · **cost
against the Gate 1 estimate**: the deliverable's window (the record's Cost line) and the
unit's total since the claim (`unit-cost.mjs`; `--by-step` for where it went) · what is still running · **the step
ledger and its lists** (`context.md`). Never presented while a
review round is outstanding. Decided by the merge policy and the run grant
(`gate-design.md`); one that waits on the owner parks the unit.

**Step 9 — land.**
- `[M]` **Order:** run the guard → land commit **on the unit branch** (status,
  evidence, log row, closed state file) → release the row → merge with `--no-ff` →
  push only on the owner's word or the run grant. Releasing after the merge cannot
  work under `SCOPE=repo`: the guard refuses a mainline commit while any row is held.
- `[M]` **Re-verify if the mainline moved** since step 8a's verify, before an
  auto-merge — on the merged tree; `run-gates.sh` reuses the step 8a result when the
  tree is unchanged, so an unmoved mainline costs nothing. Never re-run after a
  merge whose tree equals the verified tip.
- `[M]` **A Missed that comes after the land** — the merge policy merged, and the
  owner spoke later — goes in a commit of its own that edits that row: on the
  mainline where the guard allows it, else on the branch of the unit in flight
  (under `SCOPE=repo` the guard refuses a mainline commit while any row is held).
  Until it is committed the row has no date, and the retro's digest says so
  (`learning.md`).
- `[M]` **Every action idempotent.** A resumed run reaches land twice.
- `[M]` Write the merge message to a file, its subject `Merge <branch>: <title>`;
  `git merge` does not read stdin.
- `[M]` **Then the due-checks** (› Due-checks): their first unit still due is the next
  unit the close announces, after any answered parked unit (› Shape).

**Step 10 — teardown.** `[M]` Long commands ran in the background, awaited by
their completion notice, never a sleep loop, each recorded at its start — also with
`node ~/.agents/harness/machine-sweep/machine-sweep.mjs --record <pid>` where the
machine sweep is installed (`machine.md`).
**What is still running comes from commands, never memory:** the host's task list,
`codex-run.mjs --status` (or `claude-run.mjs`), `machine-sweep.mjs --status`; a live
run is never relaunched, a dead one's partial writes are checked first.
Stop everything started, by recorded PID only (a unit stack with
`bash scripts/unit-stack.sh down`), and
confirm nothing still listens on the claimed ports. If a library behaved contrary to
its documentation, write the vendor skill now (`vendor-skill.md`). Close out the
follow-ups doc (`scope-guard.md`), then the no-hand-off close above.

`[B]` Validation commands · reviewer routing · plan path and column names · the
version or release step · where artifacts live.

## The implementer agent

`[M]` Generated to `.claude/agents/implementer.md`: `model: opus`, `effort: high`,
`tools: Read, Edit, Write, Grep, Glob, Bash`, `autoCompactWindow: 250000` — a
backstop; the slice keeps it small (`context.md` › The window, the gate wait and
the base). The frontmatter window only lowers: it applies when 250000 is below the
window the subagent inherits; it needs Claude Code v2.1.296 or later and a plain
integer (`250000`, not `250k`). Dispatched with
`model` and `effort` passed explicitly — `"sonnet"` for a cold slice. Its file
carries the **Tool discipline** section verbatim
(`context.md`) and says:

- work only in the worktree the brief names, by absolute path;
- read `AGENTS.md`, every rule file the brief lists (`--rules-for`) and every trap
  skill on its `Traps:` line;
- **follow the slice literally**; on divergence from what the slice assumes, stop,
  change nothing further, and report it;
- run only the targeted tests and the type check of what it touched, once per batch
  of edits; never the whole suite; never weaken a failing test;
- commit the slice in the project's own message style (read from `git log`, `[B]`);
  never push, merge, rebase or touch another branch; start no servers or watchers;
- a defect outside the slice is reported with a proposed scope class, never fixed;
- write the report to the path the brief gives — commits, files, each command with
  its result line quoted, deviations, divergence, open questions — and return a
  summary of at most fifteen lines.

`[M]` **Never a general-purpose agent for implement or fix work** — its cold prefix
was measured at about twice the implementer's.

## Working from a change request

`[M]` **A change request or milestone document is the plan — never regenerate
it.** Re-verify it against the mainline first (citations, linked follow-ups, what
already shipped): requests go stale both ways. Its impact section is step 1's
Impact Analysis — verify and extend it, never derive a parallel list.

`[M]` **The steps run per milestone**, not per request. A risky milestone lands
alone; split pure moves from interface changes. `[B]` A milestone cap — it
starts at 15 slices or 10k changed production lines and the log moves it
(`gate-design.md` › Milestone size).

`[M]` Close out in the document itself: the milestone row marked shipped with scope
corrections, wrong claims struck through in place.

`[M]` **No request yet → the Intake type** (`intake.md`): the request is drafted in the
project's own shape with every P and C decision on one owner sheet, before unit 1.

`[M]` **A request against the specification** — documents the owner decides — is
the owner's. A unit that finds a gap may *draft* a new request in the shape the
project already uses and commit it on its branch; it never edits the specification
or an existing request, and it stops if the gap blocks it. Once the owner approves
one, its code half runs as a unit with the request's id, or on `change/<slug>` when
requests carry none.

## What is *not* in the sequence, deliberately

`[M]` No step decides whether the work is *right* — only whether it matches the
plan, runs, survives review, reaches its readers, and says only true things about
itself. Product judgment stays at the gates.
