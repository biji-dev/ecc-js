# Reference: context, sessions and reporting

How a run keeps its context small, survives a compaction or a crash without a
hand-off, and says what it actually did. **Evidence:** the third project measured
its token spend (calls above 400K tokens were 60% of it; test output was under
1%), and logged 28 hand-offs in 118 sessions before it reversed the rule that
caused them; plus the compaction and crash rows of the two plan-mode projects.

**`[M]` mechanism · `[B]` binding**

## Why context is the cost

`[M]` Every API call re-reads the whole context. Spend tracks **context size**,
not output: cache re-reads were 70% of spend and whole-file reads the largest
re-read cost. After a budget hook and the rules below landed, calls above 400K
went from about three quarters of main-thread spend to about zero.

## Rules for the harness file

`[M]` **One session for the work, one sub-agent per step or slice.** The main
session coordinates and stays small: it does not read the plan or source files
whole (`runner.md`).

`[M]` **Search, then read once.** Grep first, then read what you need in one call —
the file whole, or a range of 150 lines or more. Never page a file in small
`sed -n` slices: each slice is a turn, and each turn re-reads the whole context. The
main session reads no plan or source file whole, and never `Read`s a generated or
large file (a lockfile, a bundle, a snapshot, a 260 KB fixture once cost 65K tokens
re-read on every turn): code reading goes to a search agent that returns locations
and quoted evidence; on a bug it never decides the cause.

`[M]` **Tool discipline — copied verbatim into every generated agent file and every
brief**, under a `## Tool discipline` heading (it is mechanism, so never reworded):

> Each turn re-reads your whole context, so a turn is the unit of cost. Send
> independent reads, searches and checks as parallel tool calls in one message. Read
> a file whole with `Read`, or in ranges of 150 lines or more — never in small
> `sed -n` slices. Put several patterns in one search (`rg -e a -e b`). Run a long
> command in the background and wait for its completion notice; never poll it with
> `sleep`. Shrink a screenshot before reading it (`sips -Z 1000 <file>` on macOS),
> and prefer a text snapshot — an accessibility tree, a DOM query, `uiautomator
> dump` — when the question is about text or structure.
> Origin: the cost study (the rule origins › Cost) — 96% of agent turns made one tool
> call, about 4,500 small slice reads, 41 sleep polls in one session.

`[B]` The origin pointer is the one bound word: it names the project's rule-origins
file (default `docs/harness/rule-origins.md`), never a skill file the project lacks.

`[M]` **Run-and-report goes to a Sonnet runner** — the verify run, re-runs, a smoke
check, a cold UI walk. It quotes each PASS/FAIL or result line and the log path,
and stops at the first red without attributing or fixing it. The main session
attributes; an implementer fixes. The first red on a critical path, a live pass on
a never-auto surface and the decision to deploy stay with Opus; the runbook that
carries out an approved deploy runs on Sonnet (below).

`[M]` **A switch line before each step**, one line, then continue:
`Unit · Type/Tier · Step · Model · Effort · Context (figure + continue / compact or clear offered) · Reason`.
The main session runs at `high`. An `Effort` above `high` with no reason in the line
is itself a finding: say so and ask the owner to lower it (`/effort high`) — a
session left at `max` passes it to every subagent (`gate-design.md`).

`[M]` **Release and deploy runbooks go to a Sonnet runner** at `high` — build,
upload, smoke, report. Judgment calls inside them (a wire-skew check against the
deployed API, a red on a never-auto surface) come back to the Opus session.

## No hand-off — the compaction rule

`[M]` **Never stop for a compact and never ask the owner to open a new session.** A
new session is the owner's choice alone. The work never waits on a `/compact`.

- **At every step boundary, from the hook's figure:** under the warning budget,
  continue. Past it — or before a heavy step — **offer a `/compact`** with the
  keep-line ready to paste, and keep working. If the owner compacts, the next turn
  resumes from the state file; if they are away, carry on until the platform's
  automatic compaction takes over.
- **Persist first, every boundary.** The state file is current and work is
  committed at **every** step boundary, not only when compacting — automatic
  compaction can land on any turn. A compaction replaces the chat with a summary;
  files survive, the chat does not.
- **Offer only at a step boundary:** after Gate 1, after implementation is
  committed, after findings are written down. Never mid-debug, mid-edit series, or
  with a decision not yet written down.
- **At a gate that waits on the owner, or at a sub-milestone boundary, offer
  `/clear` instead** — with the resume command ready to paste (`/task-runner <unit>`).
  The state file is the resume point, so a cleared context resumes from about 8 KB
  instead of a 200–400K compaction summary, and it never waits out a cache expiry.
  It is an offer, like `/compact`; the work never stops for it, and nothing needs
  pasting but the command.
- **The keep-line:**
  `/compact keep: unit <id>, branch <b>, worktree <path>, tier, plan <path>, state file <path>, step <n> done / next, the unit's decision ids, open findings, commands to rerun`.
  A post-compaction or post-clear turn starts from the state file and continues the
  next step itself.
- Reviewer hand-backs live in files (`.review-work/<name>/`), not only in the chat
  — a compaction lost them once and they were recovered from the transcript.

`[M]` **The registry `Step` plus the state file are the resume point** after a
crash or a compaction. Both plan-mode projects resumed from them after machine
crashes; a compaction summary that got a timestamp wrong by nine minutes was
corrected from the transcript, never the other way round.

`[M]` **The state file has a byte budget** (`scope-guard.md`); the agent-docs lint
enforces it. A state file that grows past it is being used as a log.

`[B]` Warning and limit figures — start at 250K and 400K, and let the log move
them. The state file's path. Where the platform's automatic compaction is
configured (Claude Code: `autoCompactWindow` in `.claude/settings.json`).

## The budget hook — opt-in

`templates/context-budget.mjs` — a Claude Code hook on `Stop`, `UserPromptSubmit`
and `PostToolUse`. It reads the main thread's last `usage` record from the
transcript tail and:

- below the warning budget, gives the model a one-line figure for the switch line
  (on `UserPromptSubmit` only);
- past it, tells the user on `Stop` and the model on the other two to offer a
  `/compact` at the next step boundary — or `/clear` and the runner's resume command
  when the run is waiting on the owner — and keep working, never to ask for a new
  session;
- on `PostToolUse`, speaks only when the context crosses into a new 25K band, so a
  long tool loop hears about it without hearing it every call;
- never blocks, and exits 0 on any error.

Install only when the owner agrees: copy it to `.claude/hooks/context-budget.mjs`
and add to `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/context-budget.mjs\"", "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/context-budget.mjs\"", "timeout": 10 }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/context-budget.mjs\"", "timeout": 10 }] }]
  }
}
```

Merge into existing `hooks` arrays; never replace them. `CONTEXT_BUDGET_WARN` and
`CONTEXT_BUDGET_LIMIT` override the figures; `CONTEXT_BUDGET_STATE_DIR` moves the
band state (default: the system temp directory). Other agents have no equivalent
hook surface yet — the switch line and the compaction rule still apply there.

`[M]` **No per-turn model-calling hooks.** A plugin that ran a model review on
every stop was 5–8% of spend in the measured project.

## Reporting — the step ledger

`[M]` A unit's final report ends with **one ledger row per step the tier
requires**: `ran` with quoted evidence (the agent or command, and the line of
output that matters), or `skipped` / `unavailable` / `degraded` with the reason.
**A step missing from the ledger did not run.**
> Origin: across 88 audited "done" reports in the third project, an independent
> cross-check found something in 87 and contradicted the report in 81; most had
> skipped verification steps without saying so.

```
| Step | Status | Evidence |
|---|---|---|
| 8 review — code-reviewer + security-reviewer | ran | 3 findings: 2 fixed (abc1234), 1 → follow-ups |
| 8 second-family review | unavailable | `codex-run: unavailable kind=review … usage limit` — degraded, Opus stood in |
| 8 lane B blast radius | ran | 2 readers outside the diff fixed (def5678) |
| 8 verify FULL | ran | `SUMMARY 9 passed, 0 failed, 0 skipped (full)` |
```

`[M]` Then five lists:

- **fixed** — each with its commit;
- **admitted** — each BLOCKER or CRITICAL scope change, with its decision id;
- **deferred** — OUT items: count and the follow-ups link;
- **retracted** — findings that did not reproduce, and why;
- **not verified** — what nobody ran (a real device, a real gateway, production
  data), stated plainly.

`[M]` **Quote the result line; never paraphrase a gate or a background event you
did not read.** "All green" only if this round's output showed every gate's PASS.

## Reporting — every gate, one line each

`[M]` The project's verification runner reports **one PASS/FAIL line per gate and
never stops at the first red**; its exit status is the number of failed gates.
> Origin: an `&&` chain of suites stopped at the first failure, and four suites
> behind it never ran — the report read as one failure, not five.

`templates/run-gates.sh` is that runner — bash, so always `bash scripts/run-gates.sh`.
Its gate list sits between `# >>> harness:gates` and `# <<< harness:gates` as one
`gate <name> <always|full> '<command>'` line per gate; each gate's output goes to its
own log; the last line is `SUMMARY <p> passed, <f> failed, <s> skipped (<mode>)`. It
ships with every example gate commented out, and a run with none bound exits 99 —
never a green summary of nothing.

`[M]` **A test gate counts its cases.** `gate_counted <name> <always|full> '<regex>'
'<command>'` passes only when the command exits 0 **and** its output matches a
regex that requires a non-zero count — `'pass [1-9]'` for `node --test`,
`'Tests: +[1-9][0-9]* passed'` for Jest. `node --test` exits 0 having matched no
files, and so does a run whose every test was skipped.

- `bash scripts/run-gates.sh` — the FULL run.
- `bash scripts/run-gates.sh --since <ref>` — the SCOPED run: it computes the
  changed files itself, **untracked files included** (package-manager "changed
  since" filters ignore uncommitted edits), skips `full` gates, and promotes itself
  to FULL when a change falls outside `SCOPED_PATHS`. Gates read the list from
  `$RUN_GATES_CHANGED_FILE`.
- `bash scripts/run-gates.sh --list` — the gates and their modes.

`[M]` Quote this run's lines, not a previous run's. **Attribute each red against the
merge base, working tree included** (`git diff --quiet $(git merge-base <main> HEAD) -- <files>`)
before calling it pre-existing — the mainline can be red.

`[B]` The gate list — whatever the project's CI runs — and `SCOPED_PATHS`.
