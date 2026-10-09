# Reference: context, sessions and reporting

How a run keeps its context small, survives a compaction or a crash, and says what
it actually did. **Evidence:** a third project that measured its token spend
(calls above 400K tokens were 60% of it; tests were under 1%), plus the compaction
and crash rows of the two harness projects.

**`[M]` mechanism · `[B]` binding**

## Why context is the cost

`[M]` Every API call re-reads the whole context. Spend tracks **context size**,
not output: in the measured project, cache re-reads were 70% of spend and whole-
file reads were the largest re-read cost. After a budget hook and the rules below
landed, calls above 400K went from about three quarters of main-thread spend to
about zero.

## Rules for the harness file

`[M]` **One session per task** (the runner already exits after one). For work
split into slices, **one sub-agent per slice**; the main thread orchestrates and
stays small — it does not read the plan or source files whole.

`[M]` **Read slices, not files** — search first, then read with an offset and a
limit. Bulk exploration goes to a sub-agent that returns conclusions.

`[M]` **A switch line before each step**, one line, then continue:
`Step · Model · Effort · Context (figure + continue / compact / new session) · Reason`.

`[M]` **Compaction rule.**
- Under the warning budget: continue. Between warning and limit: compact at the
  next step boundary, or earlier if the next step is heavy. Past the limit, or for
  a new task: a new session.
- **Persist before compacting.** The run's state file — branch, track, base
  commit, step done / next, owner decisions, open findings, ledger rows so far —
  is written first, and work in progress is committed. A compaction replaces the
  chat with a summary; files survive, the chat does not.
- **Only at a step boundary**: after Gate 1, after implement is committed, after
  findings are written down. Never mid-debug, mid-edit series, or with a decision
  not yet written down.
- Reviewer hand-backs live in files (`.review-work/<name>/`), not only in the
  chat — a compaction lost them once and they were recovered from the transcript.

`[M]` **The registry `Step` plus the state file are the resume point** after a
crash or a compaction. Both harness projects resumed from them after machine
crashes; a compaction summary that got a timestamp wrong by nine minutes was
corrected from the transcript, never the other way round.

`[B]` Warning and limit figures — start at 250K and 400K, then let the log move
them. The state file's path (`.claude/plans/<task-id>.state.md`, gitignored).

## The budget hook — opt-in

`templates/context-budget.mjs` — a Claude Code `Stop` + `UserPromptSubmit` hook.
It reads the main thread's last `usage` record from the transcript tail and:

- below the warning budget, gives the model a one-line figure for the switch line;
- past it, tells the user (on `Stop`) and the model (on `UserPromptSubmit`) to
  compact or start a new session at the next step boundary;
- never blocks, and exits 0 on any error.

Install only when the owner agrees: copy it to `.claude/hooks/context-budget.mjs`
and add to `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/context-budget.mjs\"", "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/context-budget.mjs\"", "timeout": 10 }] }]
  }
}
```

Merge into existing `hooks` arrays; never replace them. `CONTEXT_BUDGET_WARN` and
`CONTEXT_BUDGET_LIMIT` override the figures. Other agents have no equivalent
hook surface yet — the switch line and the compaction rule still apply there.

`[M]` **No per-turn model-calling hooks.** A plugin that ran a model review on
every stop was 5–8% of spend in the measured project.

## Reporting — the step ledger

`[M]` A task's final report ends with **one ledger row per required step**:
`ran` with quoted evidence (the command and the line of output that matters), or
`skipped` / `unavailable` / `degraded` with the reason. **A step missing from the
ledger did not run.**
> Origin: across 88 audited "done" reports in the measured project, an
> independent cross-check found something in 87 and contradicted the report in
> 81; most of those reports had skipped the verification steps without saying so.

## Reporting — every gate, one line each

`[M]` The project's verification runner reports **one PASS/FAIL line per gate and
never stops at the first red**; its exit status is the number of failed gates.
> Origin: an `&&` chain of suites stopped at the first failure, and four suites
> behind it never ran — the report read as one failure, not five.

`[M]` Quote this run's lines, not a previous run's. Attribute each red against the
merge base before calling it pre-existing.

`[B]` The gate list — whatever the project's CI runs.
