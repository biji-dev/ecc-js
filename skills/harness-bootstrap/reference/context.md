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
Model and Effort are the host's, from `harness-host.mjs`'s first line. The main
session runs at `high`. An `Effort` above `high` with no reason in the line
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
- **At a gate that waits on the owner, or at a deliverable's boundary, offer
  `/clear` instead** — with the resume command ready to paste (`/task-runner <unit>`).
  Each deliverable's Gate 2 is that boundary: the next deliverable starts in a clean
  coordinator context (`gate-design.md` › Milestone size).
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

## The window, the gate wait and the base

**Evidence: 21 days of transcripts from nine installs (2026-10-05 to 26) — 28,322
main-thread requests, $2,774, 288 compactions — and a replay of their measured
growth at other windows, within 0.1% of the actual spend at the configured ones.**

`[M]` **Three levers set what a long session costs, and the window is the
smallest.**

| Lever | Measured | What the harness does |
|---|---|---|
| the auto-compact window | against the replay of the configured windows: 300K −4.0% of main-thread spend; 250K −5.4%, with 539 compactions against 361; 200K −1.6%; 150K +69%; 1M +20% | `autoCompactWindow: 300000` |
| cache expiry while the owner is away | 183 requests after a gap of more than an hour rewrote their whole context: $267, 9.6% of main-thread spend | the gate wait, below |
| the base | a compaction lands at about 106K; a fresh session starts at 22–108K, by project | the base budget, below |

`[M]` Compaction fires about 33K under the window (at 367K under 400K, at 297K
under 330K) and lands near the 106K base, so a window under 250K buys little
headroom and many compactions. 300K over 250K: a third fewer compactions (361
against 539), each about 66 seconds and the chat's detail, and the cheaper of the
two if the compaction call itself turns out uncached (−1.8% against −0.4%).

`[M]` **The gate wait.** Claude Code's prompt cache lives an hour. Its idle
compaction compacts a conversation left idle about 54 minutes, before the cache
expires, so the owner's answer does not rewrite it all — but only after an ended
turn: **0 of 44 idle compactions came while an `AskUserQuestion` or `ExitPlanMode`
was pending.** So at an owner gate with the context at **150K or more**, the cards
go to the state file as `Q-n` rows and out as text, the `/clear` offer first, and
the turn ends (`gate-design.md` › Who decides). Under 150K the question tool stays:
rewriting the context costs less than compacting it below about 125K (the $0.15
compaction call against rewriting what lies above the 106K base at $8 a million).

`[M]` **Idle compaction** is on by default for a conversation of 200K or more;
`CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS=150000`, a machine setting, lowers that to the
gate wait's figure, and `/config` › Idle compaction turns it off. Taking the `/clear`
offer at the gate is better still: the state file is the resume point, so there is
nothing left to compact.

`[M]` **The base budget.** Each 10K tokens trimmed from what every session loads
saves about 2% of main-thread spend and $0.08 per compaction. The repository's share
— `CLAUDE.md`, the files it imports with `@`, `AGENTS.md`, and any rule file without
`paths:` — is `check-agent-docs.mjs --base`, held to a ratcheted target
(`budgets.base`); MCP servers, plugins and user files add the rest, per machine.
Measured fresh bases in four repositories: 108K (one with its harness in a 144 KB `CLAUDE.md`), 91K,
82K, ecc-js 68K; a worktree session 22–28K.

`[M]` **Subagents: the slice before the window.** Subagents were 59% of the spend
($4,003). A 250K window on the implementer would save about 7% of its cost, but
after a subagent compaction 147 of its next 170 Reads re-read files it had already
read (86%, over 59 compactions, against 25% in the control). So the slice keeps a
subagent small — about 70 tool calls and a peak under 200K (`delegate-tasks`) — and
the implementer's `autoCompactWindow: 250000` is only a backstop (`runner.md` › The
implementer agent). Reviewers and auditors get none: they would save 5% or less,
and a compaction mid-review loses what they read.
> Origin: one project slices to about 70 calls and a 200K peak since its own study
> found subagents at 76% of its spend, with the main-thread hook seeing none of it.

`[B]` The window (`autoCompactWindow` in Claude Code's settings, which follow the
settings order: managed settings, then `--settings`, then local, project and user;
`--autocompact` beats the key for one session, and
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` beats both; a `modelSettings` entry in a settings
file beats the top-level key in the same file), the hook's warning
(220K) and its margin under the window (40K; with no window set, a 260K limit), the
gate wait's figure (150K), the base target, the state file's path. The retro
re-measures them (`learning.md`).

## The budget hook — opt-in

`templates/context-budget.mjs` — a Claude Code hook on `Stop`, `UserPromptSubmit`
and `PostToolUse`. It reads the main thread's last `usage` record from the
transcript tail and:

- below the warning budget, gives the model a one-line figure for the switch line
  (on `UserPromptSubmit`), and from 150K adds that an owner gate goes out as text
  and the turn ends — on `PostToolUse` too, so a long autonomous turn hears it
  before it reaches the gate;
- past it, tells the user on `Stop` and the model on the other two to offer a
  `/compact` at the next step boundary — or `/clear` and the runner's resume command
  when the run is waiting on the owner — and keep working, never to ask for a new
  session;
- takes its limit from the auto-compact window, 40K under it, read where Claude
  Code reads it: `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, then `.claude/settings.local.json`,
  `.claude/settings.json` and the user's settings (`$CLAUDE_CONFIG_DIR/settings.json`
  when that is set, else `~/.claude/settings.json`); with none set, or `auto`, 260K.
  It reads the env variable and those three files only, so a window set by managed
  settings, `--settings`, `--autocompact` or a `modelSettings` entry is not seen:
  set `CONTEXT_BUDGET_LIMIT` 40K under that window instead;
- on `PostToolUse`, speaks only when the context crosses into a new 25K band or a
  new level, so a long tool loop hears about it without hearing it every call;
- after a compaction, says nothing until the next reply brings a new figure. A hook
  that read past the compaction told the first prompt after it the size before it:
  in seven installs, 185 of 408 main-thread compactions (2026-09-28 to 10-25; 157 of
  177 manual ones) were followed by the old figure, 90 of them a warning to compact.
  one project found and fixed it in its own copy (195086a5, FU-014);
- never blocks, and exits 0 on any error.

Install only when the owner agrees: copy it to `.claude/hooks/context-budget.mjs`,
its test `templates/scripts/lib/context-budget.test.mjs` to `scripts/lib/` (it runs
the installed hook at the project's own figures), and add to `.claude/settings.json`:

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
`CONTEXT_BUDGET_LIMIT` override the figures (a limit set this way ignores the window); `CONTEXT_BUDGET_STATE_DIR` moves the
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
| 8a verify FULL | ran | `SUMMARY 9 passed, 0 failed, 0 skipped (full)` |
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
'<command>'` passes only when the command exits 0 **and** its output, colour codes
stripped, matches the regex. The command is `scripts/run-counted.mjs`
(`templates/scripts/run-counted.mjs`): it runs the test command, reads the runner's
own summary (vitest, `node --test` with the TAP reporter, pytest, bun or Playwright)
and prints `COUNTED <kind> <n> passed (min <m>)` only when nothing failed, was
skipped, was left out by a filter or went unrun, and the passes reach the floor:

```bash
gate_counted test always '^COUNTED vitest [1-9][0-9]* passed' 'node scripts/run-counted.mjs --kind vitest --min 412 -- pnpm -s --filter web test'
```

`--min` is today's count. A run above it prints the raise (`run-counted: 412 → 418:
raise --min on the gate's line`), wherever the project defines its gates; the unit
that added the tests raises it. No summary is a FAIL, so a `--filter` that matched
no package, `--if-present` with no script anywhere and `--passWithNoTests` fail
where they passed. Bind one counted gate
per package: a second summary in one output fails too. A plain `gate` passes on exit
0 alone, so bind a build without `--if-present` and a pnpm filter with
`--fail-if-no-match`: pnpm 10.30 exits 0 when `-r --if-present run build` finds no
script or a `--filter` matches nothing, and 1 without `--if-present` or with the
flag (2026-10-26).
> Origin: three projects found gates green on what never ran, and each wrote its own
> fix. One: a grep for `Tests +[1-9][0-9]* passed` "matched one pass among a
> hundred skips, and so did a suite that lost half its tests"; `pnpm -r --if-present
> run build` stayed green after the last `build` script was deleted, and a `--filter`
> that matched nothing exited 0. Another checked summaries against ratcheted floors
> (86ede40); a third grepped its bun output for skips. run-counted is the first one's wrapper
> with the other runners' summaries, each read from real output.

- `bash scripts/run-gates.sh` — the FULL run.
- `bash scripts/run-gates.sh --since <ref>` — the SCOPED run: it computes the
  changed files itself, **untracked files included** (package-manager "changed
  since" filters ignore uncommitted edits), skips `full` gates, and promotes itself
  to FULL when a change falls outside `SCOPED_PATHS`. Gates read the list from
  `$RUN_GATES_CHANGED_FILE`.
- `bash scripts/run-gates.sh --snapshot` — the FULL run on the commit. The gates run
  in a throwaway worktree of HEAD that holds a copy of each `SNAPSHOT_COPY` entry the
  commit lacks (`node_modules`, the untracked `.env*`), copy-on-write where the disk
  can, so no scratch file, note or untracked doc reaches a gate. A copy, never a
  link: a workspace package's relative link must reach the snapshot's files. Tracked
  or staged changes are refused (exit 99); the untracked files left out are counted
  (`not in this run: <n> untracked file(s)`). The cache keys it by the commit's tree,
  and a hit skips the copy, which is the cost: on one Mac (APFS, 2026-10-26) one project's
  root `node_modules` (36,129 files and links) cloned in 6 s, another's (134,862) in 26 s.
  > Origin: one project's R40, "A FULL verify's input is the commit, not the working tree":
  > `format` went red on untracked `.remember/` files and the owner's untracked
  > guideline doc, `lint` on a reviewer's scratch under `.review-work/` (2026-10-19).
  > Its fix copies `node_modules` too: "Turbopack refuses a node_modules symlinked out
  > of the root".
- `bash scripts/run-gates.sh --list` — the gates and their modes.

`[M]` Quote this run's lines, not a previous run's. **Attribute each red against the
merge base, working tree included** (`git diff --quiet $(git merge-base <main> HEAD) -- <files>`)
before calling it pre-existing — the mainline can be red.

`[B]` The gate list — whatever the project's CI runs — `SCOPED_PATHS`, and
`SNAPSHOT_COPY` (a monorepo names each package's `node_modules`).
