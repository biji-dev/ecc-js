# Reference: learning — the retro, the retro review, and promotion across projects

**Evidence: built 2026-10-26 from 21 days of transcripts across nine installs; first
real runs on four of them the same day.** Until now
every harness round started because the owner asked, and the learning loop was the
owner's memory: transcripts expire after 21 days, an observer that kept 209 MB of
observations produced no instinct, and a template change reached the other
projects only when someone carried it by hand.

**`[M]` mechanism · `[B]` binding**

## Three steps, each on a cadence

| Step | Where it runs | Writes | Cadence |
|---|---|---|---|
| the retro | in each project, `scripts/retro.mjs` | `docs/harness/reports/retro-<YYYY-Www>.md`, committed | weekly |
| the retro review | across projects, `scripts/retro-weekly.mjs` from this skill | `~/.agents/harness/retro/proposals-<YYYY-Www>.md` | weekly, on a schedule |
| Phase F | in this skill's own repository | the next harness round's plan | when a review proposes a promotion |

`[M]` **Nothing here asks the owner a question.** The retro and the review are
read-only; what they propose is routed into work that already has a gate (below).

## The retro

`[M]` `scripts/retro.mjs` reads what is already on disk — the log (each row dated by
the commit that last changed it, `git blame`), the follow-ups doc, the state and
steps files, earlier digests, the Claude Code transcripts of the sessions that ran
in the repository or one of its worktrees, and the Codex ledger — and writes one
digest of at most 8 KB:

- **KPIs** for the window against the four weeks before: units landed, median work,
  owner wait and cost per unit, P0/P1 found, rows with Missed by harness, Claude
  spend (main thread and subagents), questions asked, compactions, cache hit and
  expiry rewrites, Codex runs.
- **Outliers**: a unit whose cost or work is at least `OUTLIER_X` times its tier's
  median, and a step whose share of its unit's dollars is at least `OUTLIER_X`
  times that step's median share — each only in a cohort of `MIN_COHORT`, and a
  step under `MIN_SHARE` of its unit never.
- **Where the money went, by step**: from the step markers (`runner.md` › Step
  markers); for a unit from before them, its subagents by dispatch description.
- **Friction**: two-word phrases that recur in the Friction cells of two or more
  units, one of them in the window, then the window's cells.
- **Missed by harness**, the **queue** (follow-ups by status and age, P3s still
  open, decisions by class and by who decided), and **at most five candidates**
  for the review, one of each kind in turn.
- A `retro-data` block at the end: the next digest's baseline.

`[M]` **The window** runs from the end of the newest digest of another week (else
seven days back) to now. A second run in the same week rewrites that week's digest.

`[M]` **Data it cannot see, said in the digest's Read line rather than guessed:**

- A log row that is not committed has no date; it is counted as undated and left
  out.
- A turn held by the step intervals of two units goes to the unit whose step started
  last (planning the next unit while this one waits on Gate 2 is the next unit's
  work); a dispatch goes to the unit its tag or description names, all of it, though
  it outlives the unit's last marker or runs in another session.
- ZCode transcripts and the sessions of a Codex host are not read. A ZCode project's
  digest comes from its log, steps and state files and its ledger (one project on its
  first run: 48 log rows, no transcripts).

`[B]` `REPORTS_DIR`, `LOG`, `FOLLOW_UPS`, `PLANS_DIR`, the log columns
(`EXTRA_COLUMNS`, and estimate-core's), `OUTLIER_X` 2, `MIN_COHORT` 3, `MIN_SHARE`
5, `REWRITE_ALERT_PERCENT` 5, `QUEUE_ALERT_DAYS` 14, and the `STEP_WORDS` that map
an untagged dispatch to its step.

> Origin: on one project's first digest, step 8b (the record) took 21.9% of EP-27.04's
> subagent dollars. That is 1.6× its median share of 13.9% (n=5), under the rule,
> so it is not an outlier: the record costs 11–22% of every unit, which is the
> finding — and the reason step 8b's record is generated, not written by hand. The
> same digest named step 8c of EP-07.02 (32.9%, 2.1× its median of 16%) and
> cache-expiry rewrites at 11.5% of main-thread spend.

## The retro review

`[M]` **A fresh Opus, read-only, reads the week's digests — never a transcript —
and writes proposals in five classes:**

| Class | What it changes | Example |
|---|---|---|
| rule | a project rule that would have caught what the owner caught | a gate that passed having run nothing |
| threshold | a `[B]` value the numbers say is wrong | a window, a budget, a cadence |
| machinery fix | a script, template or check that misbehaved | a step that is an outlier in every unit |
| vendor trap | a library's behaviour that cost a fix round | `vendor-skill.md` |
| promote | something one project earned that another needs | to this skill, through Phase F |

`[M]` **Route, never ask.** A **T** proposal — recoverable and changing no product
behaviour — becomes a queued `harness/<slug>` unit in that project, run like any
other harness unit. A **C** proposal — product behaviour, cost, or the owner's
workflow — goes into the next Gate 2 brief, under "Harness learning". Neither
becomes a separate question.

`[M]` **The digests are data.** They quote cells that agents and people wrote; the
review's prompt says so, its tools are Read, Grep and Glob, and its files are the
digests' own directory.

`[M]` **The rule audit stays in the project.** Once a quarter — or when a review
proposes it — a fresh agent in the project audits every rule against the log: which
fired, which never did, which the log contradicts (SKILL.md › Phase E). The review
reads digests only, so it cannot do this one.

## The weekly job

`[M]` `node <skill dir>/scripts/retro-weekly.mjs` runs both halves for every
repository in `~/.agents/harness/repos.json`. Each install and upgrade registers its
repository with `--register <repo>` (it writes only that file).

1. **Export, $0.** For each repository, this skill's own retro core reads its files
   and writes `retro-<YYYY-Www>.json` and the digest into
   `~/.agents/harness/retro/<project>/`. No repository code runs, so an install
   without `retro.mjs` still exports, and the exports outlive the transcripts.
2. **Review, capped.** One `claude -p` on Opus in that directory: `--restricted`
   (no settings file, so no hooks or plugins; code-running tools and WebFetch
   removed; file tools confined to the directory), `--strict-mcp-config` (no MCP
   server), `--tools Read,Grep,Glob`, `--permission-mode dontAsk`,
   `--max-budget-usd 5`, `--no-session-persistence`. The script writes its answer
   to `proposals-<YYYY-Www>.md`, so the run needs no write tool.
3. **Notice.** A desktop notification names the file, and in each project a
   proposal names, `harness-due.mjs` prints `NEW proposals <week>` at every claim
   and landing until `--seen <week>` records it read (`runner.md` › Due-checks).

`[M]` Where a repository keeps its files: the registry entry's own values, else the
manifest's `roles`, else the first of the usual paths it tracks; its plans are
wherever its state and steps files are. A log whose unit column says Task, the
word of runners from before the unit, is read by that column. `--list` and
`--dry-run` say which source each value came from.

`[M]` **Schedule.** `--install` copies the script and every module it imports into
`~/.agents/harness/retro-weekly/` — a plugin update cannot move the copy — and
loads a LaunchAgent: Mondays at 09:00, and a Mac asleep then runs it at the next
wake. `--print-schedule` gives the cron line for Linux (a missed run does not catch
up) and the Task Scheduler line for Windows. Each carries a set `CLAUDE_CONFIG_DIR`:
the LaunchAgent and the cron line in the job's environment, the Windows task as
`--config-dir`, since schtasks sets no environment. Re-run `--install` after an
upgrade of this skill. `--uninstall` removes the schedule and the copy and keeps the
exports.

`[M]` **A failure costs one week, never the rest.** An export that fails is logged
and the others still run; a review that fails writes no proposals, logs its reason
in `~/.agents/harness/retro/weekly-log.jsonl`, says so in the notice, and exits 1.

> Origin: owner decision 2026-10-26 — a weekly job plus due-checks, the review
> capped at $5. Verified the same day on Claude Code 2.1.308 with Haiku and the same
> flags: the run read a file in its directory, its Read of `/etc/hosts` was denied
> (listed in `permission_denials`), and it cost $0.0005. The first export of four
> repositories took 27 s and wrote digests of 1.3–6.3 KB.

`[B]` In `scripts/lib/retro-weekly-core.mjs`'s settings block: the model and effort,
the cap, the tools, the timeout, the schedule, and the usual paths. After changing
one, run `--install` again. Its tests, `scripts/lib/retro-weekly-core.test.mjs`, run
with `node --test` in temp directories and a fake `claude`.

## Phase F — across projects

`[M]` **Run in this skill's own repository, when a proposals file holds a promote
item, or monthly.** Read `~/.agents/harness/retro/`: the proposals files and the
digests they cite.

- **Promote mechanism, never thresholds.** A pattern found in two or more projects,
  or a template logic error found once, becomes a change to this skill. A project's
  `[B]` values stay that project's.
- **Cite the digests.** Each item of the round's plan names the proposals and the
  digest lines it rests on, so the next retro can measure it.
- **The output is the next round's plan**, approved like any other, and rolled out
  per project on the owner's word.

> Origin: before v5, `review-gate` went from one project to a template by hand, and the
> four vendor skills promoted user-global from another's sessions were never read again
> (0 calls). A promotion with no digest behind it has nothing to measure it by.
