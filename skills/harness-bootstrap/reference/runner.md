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

`[M]` **No hand-off, and one deliverable per coordinator context.** After a
deliverable's Gate 2 — an owner wait anyway — offer `/clear` with the resume
command (`context.md`): the state file carries the next deliverable, so the next
one starts in a clean context, not on top of the last one's reports. After a unit
lands: close its state file, offer the same `/clear`, announce the next unit in one
line, and start it only if the owner's instruction covers it. Never ask the owner to
open a session, paste a hand-off note or say what is next.
> Origin: plan mode first shipped "one task per session, then exit". In the third
> project 28 of 118 sessions ended in a hand-off, about 90% of them triggered by a
> budget rule that said "start a new session" (`rules.md` §3).

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
upgrade keeps an existing runner's name through the manifest's `roles`.

## Task type first — before the tier

`[M]` Classify by **what will change** — `git status --porcelain -uall` (staged,
unstaged and untracked) or `git diff --name-only <base>` plus untracked files —
never by feel. Check in this order; unsure → the heavier type.

| Type | Test | Runs |
|---|---|---|
| **Ops** | a deploy, migration run, production data fix or credential rotation, even with no repo change | its runbook, owner approval first; the runbook's mechanical steps on a Sonnet runner, judgment calls in the Opus session (`context.md`) |
| **Answer** | nothing changes — a question, an investigation, a review, a status, a plan only | no steps; the answer quotes its evidence. **A bug's cause, even with no fix, takes step 1's root-cause route** |
| **Docs-light** | every changed path is prose, and no test or script reads it | write, format, lint, commit; one ledger row |
| **Docs-heavy** | the same, but a rule file, a runbook, a change request, or ~200+ lines others act on | Docs-light + one review by the other model family + one fix pass |
| **Code** | anything else — docs mixed with code, a doc a test reads, a hook | the tiers (`gate-design.md`) and the sequence below |

`[B]` Which files are rule files; the line threshold for Docs-heavy; how to tell
that a test reads a doc. The harness's own files — `AGENTS.md`, `CLAUDE.md`, the
skills and agents — are read by the agent-docs lint, so a change to them is
**Code**, never Docs.

`[M]` **Docs units still go through the lock and the merge policy.** They take no
Scope block, but they claim a registry row, branch and land like a Small change —
the guard refuses an unclaimed commit while a run holds the lock on this checkout, and where the
merge policy sends every tier to the owner, a docs change waits for the owner too.

## The sequence

```
0a resume      a held registry row or an existing unit branch = a stopped run; verify each step against evidence
0  claim       type · tier · unit · overlap · branch (+ worktree) · lock · state file
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
               · bounded fix rounds · the FULL verify run
8a docs        the doc sweep
8b record      written last, from the diff, as fields
8c claims      lane C — the claim auditor (claims, test honesty, fix commits)
                                                          ══ GATE 2 ══  by the merge policy
9  land        guard → land commit → release the lock → merge → push on the owner's word
10 teardown    stop what was started; close the state file; offer /compact; next unit
```

`[M]` 3 → 4 order matters: audit the merged reality, not the pre-sync diff.

`[B]` 5, 6 and 7 are conditional on what the unit delivers. No UI drops 7; no
third-party surface drops 6.

**Change installs that already number eleven steps** keep their numbers; the
correspondence is: investigate, plan, plan check → 1 · decision sheet → Gate 1 ·
implement and tests → 2 · diff review → 8 · cross-check A/B/C → 4, 8, 8c ·
regression → 5–8 · doc sweep → 8a · ship → 9.

## Which steps each tier runs

| Step | Trivial | Small | Full |
|---|---|---|---|
| 0 claim | type + tier in the claim line | + Scope block, frozen when stated | + Scope block for Gate 1 |
| 1 ground | — | light: cause or reuse noted in the plan | full: root cause, Impact Analysis, plan check |
| Gate 1 | — | **auto** unless the risk map or the policy is hit | owner |
| 2 implement | the session | the session or one executor | one executor per slice |
| 2 per-slice review | — | — | `review-gate.mjs --kind slice`: the second family |
| 4 conform | — | against the Scope block | against plan + Scope block, once; a scoped re-audit only when a fix touches a plan item |
| 5–7 live | if it changes behaviour | **yes — never dropped** | yes |
| 8 review | — | `review-gate.mjs --kind unit --tier small`: the second family's review | `--kind unit --tier full`: one Opus code-reviewer + the adversarial pass (lane B) + triggered specialists + `pr-test-analyzer` (Sonnet) |
| 8 fix rounds | — | `review-gate.mjs --kind fix`; P3s go to the sweep | the same (`gate-design.md`) |
| 8 verify | scoped | FULL once before merge | FULL |
| 8a docs | in the same commit | `docs-drift.mjs`, in the same commit | `docs-drift.mjs`, then a separate sweep |
| 8b record | ledger line | `unit-record.mjs` | `unit-record.mjs` + the deviations |
| 8c claims | — | **skipped; the record is generated** | blocking, **product claims** |
| Gate 2 | by the merge policy | by the merge policy | owner |

`[M]` **A P0 or P1 from review promotes Small to Full** — the unit then runs the
plan check, lane A against a written plan, lane C and the adversarial pass.

## Per-step notes

**Step 0a — resume.** `[M]` A held row or an existing unit branch means resume, not
start. Read the state file; the row's `Step` says where the run *thought* it got
to — **verify, do not trust the marker.** Restart from the earliest step you cannot
evidence; redoing a step is cheap and never wrong. Commit uncommitted work first,
as its own commit. Never reclaim a row you do not own.

**Step 0 — claim.**
- `[M]` **State the claim line:** unit, type, tier, whether it touches the risk map's
  critical code or a never-auto category, both gate decisions, the model for each
  role, and on Small the Scope block.
- `[M]` **The lock is also the concurrency guard.** One row per active unit, held
  for the whole run, its `Step` updated at every boundary. The commit guard reads
  it (`commit-guard.md`); in `SCOPE=checkout` the row names its worktree.
- `[M]` **The registry is also a resource lock** where units share machines —
  ports, isolated stacks, migration slots in the same row.
- `[M]` Compare this unit's write set against every other held row. Overlap means
  sequence, not parallelise — say so and stop.
- `[M]` **One unit in flight**, plus hotfixes. Planning the next (step 1) may start
  while this one waits on Gate 2; its step 2 waits.
- `[B]` Branch naming (carrying the task id, or matched by the Branch cell) ·
  worktree convention. **Every kind of unit has a branch form:** plan items carry
  their id; the code half of an approved change request carries the request's id (or runs on
  `change/<slug>`, matched by the Branch cell, when requests carry none);
  harness work, vendor-trap skills and follow-ups no unit owns run on
  `harness/<slug>`, matched by the Branch cell. Write the generated paths with
  `<unit>` (the id or the slug), never the plan's id shape alone.
- `[M]` **In the foundation stage** (`foundation.md`) every Code unit is Full and
  Gate 2 is the owner's; the unit that lands the first counted test is followed by
  the flip, its own `harness/` unit.

**Step 1 — ground, plan mode.**
- `[M]` **Sync both directions.** Behind: pull before branching. **Ahead:** another
  session left unpushed work, and this push would publish it — ask first.
  > Origin: the local mainline was four commits ahead, and no step looked.
- `[M]` Read the follow-ups doc: rows scheduled for this unit are part of its
  requirement. Verify the dependency list before presenting it.

**Step 1 — ground, change mode.**
- `[M]` **Investigate.** A bug: no fix without the root cause, decided by Opus or the
  second family's `investigate`, **never by a search agent**, which returns
  locations and quoted evidence only. A feature: read the touched modules, list the
  invariants, reuse patterns. A third-party surface: current vendor docs first;
  measurements in the repo still win.
- `[M]` **Plan + Impact Analysis** (Full): files, functions, data flow, edge cases,
  tests; for every caller, invariant and dependent flow, how it is preserved, with
  function names and line ranges. The plan opens with the **Scope block**.
- `[M]` **Plan check** (Full): the blind dual plan (`cross-model.md`), then a plan
  comparison the session merges. **A failed plan is revised, never carried on.**
- `[M]` **Nobody reads the plan whole.** Grep the section; paste the slice verbatim
  into its brief.

**Gate 1 — one decision sheet.** `[M]` In this order (`scope-guard.md`,
`gate-design.md` › Who decides):

1. **The deliverables**, each with its `Demo:` line — what the owner will be able to
   open, do and see. **A table past the cap splits here** (`gate-design.md` ›
   Milestone size).
2. **The P and C decision cards** — nothing else is asked.
3. **The estimate**: `node scripts/estimate.mjs --log <harness log> --tier <tier>
   --slices <n>` — p25–p75 for work time, owner wait, Claude % and Codex %, with
   its cohort size, or "no history" — and the second family's weekly meter from its
   ledger. A range from this project's log, never a single number.
4. **Decided** — the T decisions taken, one line each with its reversal cost.
5. **The slicing table**: slice · files · executor · order · gate · expected counts
   · risk · deliverable. Every acceptance criterion maps to a slice, or the table is
   incomplete. Cold slices name the second family's `implement-cold` (or a Sonnet
   builder where the task needs a browser, a service or steering) — never the Opus
   implementer. The owner may change any executor cell in the reply (› Executor
   override).

Gate 1 waits on the owner: offer `/clear` with the resume command (`context.md`).

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
  such a slice runs `review-gate.mjs --writer codex` so an Opus reviewer reads it.
  An override to the second family while its budget guard reserves write kinds
  (`codex-run` exit 4) falls back to Sonnet and says so in the ledger.
- `[M]` **One slice per agent.** A fix round is split by area into several.
  > Origin: one agent handed a whole fix round ran 309 calls, to 368K of context.
- `[M]` **After each slice:** read its report and `git diff --stat`, run the drift
  check, then `node scripts/review-gate.mjs --base <slice base> --kind slice
  [--writer codex]` and dispatch what it names — the **second family's review** over
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
  verify once at step 8 — **never once per slice**. Tests a later step adds (a
  doc-sweep test, a parity test) land **before** that FULL run, not after it.
  > Origin: one change request ran the full suite 39 times, 8.4 hours. The v4 usage
  > study: implementers ran 3,758 single-file test runs (18.6 h) in 14 days, and one
  > project's tests step came after its FULL verify, so a second FULL was nearly
  > always owed.
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
  <tier>` (`--writer codex` for a unit the second family wrote) and dispatch exactly
  the reviewers it names (`gate-design.md` maps each name to a dispatch), with `model` and `effort`
  passed on each (`gate-design.md` › Review lineup). Full: one Opus `code-reviewer`
  over the whole unit diff, the second family's adversarial pass carrying lane B's
  change surface (`blast-radius-auditor.md` › The brief), each triggered specialist,
  and `pr-test-analyzer` on Sonnet when tests changed — independent, in **one message**. Small: the
  second family's review, plus the adversarial pass with lane B's brief when the
  Impact Analysis lists a reader outside the diff. The second family unavailable → the fallbacks in
  `gate-design.md`, `degraded`.
- `[M]` **Each dispatch gets its own scratch directory**, `.review-work/<name>/`.
  Briefs forbid host-level operations and repository-wide suite runs.
- `[M]` **Hold edits until every reviewer has reported.**
- `[M]` **Reproduce before fixing.** Read the cited line, run the single test or
  probe the endpoint. A finding that does not reproduce is **retracted**, never
  "fixed".
  > Origin: about 6% of claimed gaps in the third project were artefacts — a
  > scaled measurement, harness timing, another worktree's test run.
- `[M]` **Triage by scope class, then severity**: OUT → follow-ups whatever its
  severity; P3 → **the sweep**, never a fix round, unless on a line this round already
  changes.
- `[M]` **Fix rounds** are bounded by `gate-design.md`, and each fix gets a
  regression test proven to fail without it. One brief per area; fix groups on
  critical code go to Opus; the rest to the second family's `fix-cold` while its
  budget allows, else Sonnet. After the round, `review-gate.mjs --kind fix
  --max-fixed <P> --round <n> [--writer codex]` names the re-review, which reads
  the fix diff only — `--writer` is who wrote the fix.
  `escalate-adversarial` is the third-round stop (`rules.md` §2): ask the owner,
  and run the adversarial pass only for the round the owner orders.
- `[M]` **The P3 sweep** runs once per slice set, after the fix rounds: one Sonnet
  fixer (or the second family's `fix-cold`) over every P3 still IN scope, its
  targeted tests, no re-review.
- `[M]` Then the **FULL verify** (`context.md`): every gate, one line each, each red
  attributed against the merge base, working tree included. `run-gates.sh` reuses an
  all-PASS result for the same tree (`REUSED <tree>`), and for a tree that differs
  only in docs; a second agent that starts the same run waits for the first. Quote
  the `REUSED` line as the evidence — never re-run to have a fresh one.

**Step 8a — docs.** `[M]` Only when the diff changes a public behaviour, a named
invariant, a module description or user-visible output. List stale docs with
`node scripts/docs-drift.mjs --since <merge base>` — a script, not an Opus lane — and
hand the candidates to a Sonnet runner or the second family's `docs` kind to
rewrite the stale sections, never append. A change to a
rule file updates every document that repeats the rule (`rules.md` §1).

**Step 8b — write the record, from the diff.** `[M]` Now — not during the run and
not from memory. **Generate the fields:** `node scripts/unit-record.mjs --state
<state file> --gates <the FULL verify output> --cost "$(node scripts/unit-cost.mjs
--session <this session's id> --since <claimed>)"` prints commits, diffstat, the gate
SUMMARY line, finding counts by severity and by source, elapsed, the ledger and the
draft log row from git and the state file, never retyped. The git-derived fields
are true by construction; the ledger and findings rows are copied as the session
wrote them.
The session writes only what no command knows: the deviations, the controls
evidence, the `<fill: …>` cells of the log row. Delete any sentence you cannot point
at a line for. **The record has a byte budget** like the state file
(`scope-guard.md`).
> Origin: two tasks took three and five claim-audit rounds; every false claim was
> in the record or a commit message, not the code.

**Step 8c — claim audit.** `[M]` Dispatch `claim-auditor` with `model: "opus"`,
`effort: "high"` (`claim-auditor.md`), over **product claims** — code comments,
docstrings, test titles, commit messages, controls evidence and the deviations. The
git-derived record fields are not re-audited; the ledger's evidence cells are
checked against the saved returns. Blocking on Full. A second consecutive
`FALSE CLAIMS` switches to quote-or-delete.
> Origin, the cost study: 79 of the claim auditor's 105 P1s were about record
> prose, not product code.

**Gate 2.** `[M]` Brief: **the deliverable's demo evidence** — its `Demo:` line,
the screenshot, the named tests or the live-walk transcript that shows it ·
**Decided for you** — every T decision row, one line each with its reversal cost ·
the P and C cards still open · verdicts · unresolved findings · diffstat · **cost
against the Gate 1 estimate** (`unit-cost.mjs`) · what is still running · **the step
ledger and its lists** (`context.md`). Never presented while a
review round is outstanding. Decided by the merge policy (`gate-design.md`). When it
waits on the owner, offer `/clear` with the resume command (`context.md`).

**Step 9 — land.**
- `[M]` **Order:** run the guard → land commit **on the unit branch** (status,
  evidence, log row, closed state file) → release the row → merge with `--no-ff` →
  push only on the owner's word. Releasing after the merge cannot work under
  `SCOPE=repo`: the guard refuses a mainline commit while any row is held.
- `[M]` **Re-verify if the mainline moved** since step 8's verify, before an
  auto-merge — on the merged tree; `run-gates.sh` reuses the step 8 result when the
  tree is unchanged, so an unmoved mainline costs nothing. Never re-run after a
  merge whose tree equals the verified tip.
- `[M]` **Every action idempotent.** A resumed run reaches land twice.
- `[M]` Write the merge message to a file; `git merge` does not read stdin.

**Step 10 — teardown.** `[M]` Long commands — builds, the FULL verify, an emulator
— ran in the background and were awaited by their completion notice, never a sleep
loop. Stop everything started, by recorded PID only, and
confirm nothing still listens on the claimed ports. If a library behaved contrary to
its documentation, write the vendor skill now (`vendor-skill.md`). Close out the
follow-ups doc (`scope-guard.md`), then the no-hand-off close above.

`[B]` Validation commands · reviewer routing · plan path and column names · the
version or release step · where artifacts live.

## The implementer agent

`[M]` Generated to `.claude/agents/implementer.md`: `model: opus`, `effort: high`,
`tools: Read, Edit, Write, Grep, Glob, Bash`. Dispatched with `model` and `effort`
passed explicitly — `"sonnet"` for a cold slice. Its file carries the **Tool
discipline** section verbatim (`context.md`) and says:

- work only in the worktree the brief names, by absolute path;
- read `AGENTS.md` and every rule file the brief lists (`--rules-for`);
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

`[M]` No request yet → writing it is the work (`superpowers:brainstorming`, where
installed).

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
