# Reference: the hygiene unit — the P3 batch, dead code, docs drift, the archive, residue

**Evidence: designed 2026-10-26 from nine installs; not yet run as a unit.** Each job
answers a measured gap. One project's reconciliation of 144 follow-up files left 1,568
items open, 1,320 of them P3, and found about 10% of its own unjudged closures false.
The same project has 23 state files over budget, the largest 493 KB. No project runs knip,
ts-prune or depcheck. And the v3 rule "P3s go to the sweep" is written into three
installs with **no evidence it ever ran**: no ledger row, log cell or subagent.

**`[M]` mechanism · `[B]` binding**

## When it runs

`[M]` **`harness-due.mjs` says `DUE hygiene` 14 days or 5 landings after the newest
hygiene report** `[B]`, with the oldest open P3's age on the line, and the runner
makes it the next unit (`runner.md` › Due-checks). It is a **Code** unit,
`harness/hygiene-<date>`, with the tiers: Small, and **Full when a job deletes in
the risk map's critical code**. Its executors follow the risk map like any slice's.

## Five jobs, in this order

`[M]` **1 · The P3 batch.** Take the oldest open P3 rows of the follow-ups doc whose
code is cold, at most one slice set's worth `[B]`. **Re-verify each one against the
mainline first**: later work may have fixed it, moved it or made it wrong. A row that
no longer reproduces is closed `dropped — <why>` with the line that shows it, never
"fixed". Then one Sonnet fixer runs over the rest (the second family's `fix-cold`
while its budget allows), with targeted tests and no re-review, as the in-unit P3
batch does (`gate-design.md` › Fix rounds). Each fixed row's Status becomes
`fixed <sha>`.
> Origin: one project's reconciliation found about 10% of its unjudged closures false,
> spread across every area. A closure that cites nothing is a claim (`rules.md` §1).

`[M]` **2 · Dead code and unused dependencies.** Run `knip`, or the project's own tool,
in report mode. A finding is a candidate, never an order: an export a script, a
config or a dynamic import uses looks dead to it. Delete one group per commit, with
the targeted tests green after each. ECC's `refactor-cleaner` runs
`git checkout -- <file>` when a step fails, so it runs only in a clean worktree,
fenced to its file list. At the next upgrade, propose the tool as a `full`-level gate.

`[M]` **3 · Docs drift over the whole tree.** `docs-drift.mjs --since <the previous
hygiene report's commit>`. Step 8a checks one unit's diff; this catches what slipped
between units. Stale sections are rewritten, never appended (`runner.md` › Step 8a).

`[M]` **4 · The archive.** Move the state files of closed units, and closed plans, to
the archive path `[B]` (`docs/plans/archive/` by default). Where the log or a
follow-up row cites one, update the citation. An open unit's state file over budget
moves its closed findings to the follow-ups doc instead (`scope-guard.md`).

`[M]` **5 · Residue.** Remove the worktrees `harness-due` named that no registry row
names and no process runs in (`lsof -d cwd`), with `git worktree remove` and never
`--force`. It names one only when it is merged with commits of its own, has no
change, holds no ignored file but rebuildable output (a link counts as none), and
has been idle over 6 h. Delete `.review-work/` directories older than 14 days `[B]`;
keep `.codex-runs/` and `.claude-runs/`, which hold only `ledger.jsonl`, the second
family's meter (`codex-run.mjs` and `claude-run.mjs` write nothing else there). Stop
processes by recorded PID only (`runner.md` › Step 10). Disk outside the repository
is the machine sweep's (`machine.md`).
> Origin: the check's first draft named a worktree in one project whose ignored
> `.reconcile/` held 673 files of a reconciliation's briefs and second-model
> outputs; `git worktree remove` deletes ignored files without a word. The project's own
> `dev:clean` already refused it. Its rails are the ones above. ECC's
> `scripts/worktree-lifecycle.js` would have planned the removal: its clean check
> (`git status --porcelain`, no `--ignored`) cannot see ignored files, and it calls
> any branch with nothing ahead of the base merged, one cut and never started too.

## The report

`[M]` **`docs/harness/reports/hygiene-<date>.md`, committed with the unit**, at most
4 KB `[B]`. For each job: what it found, what it changed (commits), what it left and
why, and the follow-ups doc's counts by status before and after. The report is what
restarts `DUE hygiene`'s count, so a hygiene unit that lands without one is due again
at once.

`[B]` In `scripts/lib/harness-due-core.mjs`: `CADENCE.hygiene`, `P3_AGE_DAYS`,
`REPORTS.hygiene` (`null` for a project that runs no hygiene unit: `DUE p3` then
queues the P3 batch alone), `WORKTREE_IDLE_HOURS`, `REBUILDABLE`. Elsewhere: the
batch size, the dead-code tool and its config, the archive path, the residue ages.
