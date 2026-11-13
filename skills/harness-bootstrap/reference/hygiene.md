# Reference: the hygiene report — dead code, docs drift, the archive, residue

**Evidence: designed 2026-10-26 from nine installs.** Each job answers a measured gap:
one project has 23 state files over budget, the largest 493 KB; no project runs knip,
ts-prune or depcheck. **A report, never a unit (v10):** in v9 it was a `harness/`
unit with a P3 batch, and a due hygiene unit ran ahead of the next product row.

**`[M]` mechanism · `[B]` binding**

## When it runs

`[M]` **`harness-due.mjs` prints `REPORT hygiene` 14 days or 5 product landings
(`sweep.md` › When it runs) after the newest hygiene report** `[B]`, never in the
foundation stage. The runner starts it in the background on a Sonnet runner only
once the product queue is empty, or on the owner's word (`runner.md` › Due-checks):
never mid-unit. It edits no code: what it finds in code is a candidate in the
report, and only the owner's word makes it work (› Cleanup on the owner's word).

## Four jobs, in this order

`[M]` **1 · Dead code and unused dependencies.** Run `knip`, or the project's own tool,
in report mode. A finding is a candidate, never an order: an export a script, a
config or a dynamic import uses looks dead to it. List the groups with their
evidence, and count the tests whose subject is gone and those skipped over 30 days. At the next upgrade, propose the tool as a `full`-level gate.

`[M]` **2 · Docs drift over the whole tree.** `docs-drift.mjs --since <the previous
hygiene report's commit>`. Step 8a checks one unit's diff; this catches what slipped
between units. The stale sections are listed.

`[M]` **3 · The archive.** Move the state files of closed units, and closed plans, to
the archive path `[B]` (`docs/plans/archive/` by default); the moves ride with the
report. Where the log or a follow-up row cites one, update the citation. An open unit's state file over budget
moves its closed findings to the follow-ups doc instead (`scope-guard.md`).

`[M]` **4 · Residue.** Remove the worktrees `harness-due` named that no registry row
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

`[M]` **The report rides in the next unit's land commit** at `REPORTS.hygiene` in
`harness-due-core.mjs` (default `docs/harness/reports/hygiene-<date>.md`), at most
4 KB `[B]`, with no branch, review or gate of its own. For each job: what it found,
what it moved or removed, and the follow-ups doc's counts by status. The committed
report restarts the `REPORT hygiene` count.

## Cleanup on the owner's word

`[M]` **With the product queue dry, the end message offers one line** from the newest
report: `cleanup available: <n> unused exports, <n> files, <n> tests of deleted code
(knip, <date>)`. On "do it", an ordinary Small unit with ECC's `refactor-cleaner` and
knip, landed by the grant, removes dead code, tests whose subject is gone and tests
skipped over 30 days, and flags the 10 slowest; a test that covers a live path goes
only when the reviewer agrees. No new cadence.

`[B]` In `scripts/lib/harness-due-core.mjs`: `CADENCE.hygiene`, `REPORTS.hygiene`
(`null` for a project that runs none), `WORKTREE_IDLE_HOURS`, `REBUILDABLE`.
Elsewhere: the dead-code tool and its config, the archive path, the residue ages.
