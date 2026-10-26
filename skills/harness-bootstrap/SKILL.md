---
name: harness-bootstrap
description: Use when setting up, adopting, auditing or upgrading a gated agent harness in any repository — documents only, new, or already in production — a plan-driven task runner (registry lock, commit guard, two human gates, conformance and claim auditors, harness log) or a tiered change workflow (task type, Trivial/Small/Full tiers, risk map, scope guard, cross-check lanes, step ledger). Also when asking whether a project is ready for one, or when a repository already carries an older harness (a registry, a task-runner or change-workflow skill, crosscheck lanes, an agent-workflow guide) that should be brought up to date without losing what it earned. Claude Code first (Opus for judgment, Sonnet for bounded work); Codex, ZCode and Kimi supported. Not for tuning agent configuration (that is harness-audit).
when_to_use: Set up, audit, adopt, or upgrade a gated harness in a repository — task runner or change workflow, commit guard, gates, tiers, risk map, auditors, harness log. Also when asked whether a project is ready for one, or to bring an installed harness up to date.
metadata:
  origin: ecc-js
  version: 4
---

# Harness bootstrap

Six phases against a target repository (0, A–E), and a seventh across them (F).
The harness has **one core and two work-unit modes**:

- **Plan mode** — the unit is a plan task with a stable id. Born in a regulated
  rental platform (21+ logged tasks) and adopted by a multi-tenant agent platform
  (10).
- **Change mode** — the unit is a change, a change request or a milestone of one,
  in a repository that ships continuously. Grown independently in a production
  multi-tenant platform over about 120 sessions.

Both may coexist. **Phase A routes; it refuses only what no harness can serve.** A
harness installed on a project that cannot sustain it is ceremony: it gets
abandoned inside a fortnight, and it burns the idea.

## When to Use

- A repository — new, or years into production — wants gated, agent-driven
  delivery: two human gates, everything between them checked by fresh agents.
- A harness is already installed, from this skill or grown by hand, and should be
  upgraded without losing its earned rules (Phase 0).
- Someone asks whether a project is ready for this — Phase A answers it.

Not for tuning agent configuration (`harness-audit`), and not for dispatching one
batch of specs (`delegate-tasks`, which this harness uses as its engine).

## How It Works

Run it from inside the target repository, in the main session on **Opus** — every
phase is judgment. `reference/` holds the pattern; read what each phase names
rather than working from memory of how another project did it. In Claude Code the
files are under `${CLAUDE_PLUGIN_ROOT}/skills/harness-bootstrap/`; in other agents,
use the folder this `SKILL.md` was read from.

| Phase | Read |
|---|---|
| 0 · detect, upgrade | run `scripts/harness-status.js`; `reference/upgrade.md` when it reports an install; then the reference each proposed row's fix names, and the Phase C core table (for `missing` rows) |
| A · assess, route | the table below; `harness-targets.md` (agents), `scope-guard.md` (id prefixes), `commit-guard.md` (`SCOPE`); `foundation.md` when nothing is built yet |
| B · policy, risk map, merge policy | `reference/policy-derivation.md`; the merge default in `gate-design.md`; the marker syntax in `upgrade.md` |
| C · generate | `templates/agents-rules.md`, `rules.md`, `gate-design.md`, `runner.md`, `scope-guard.md`, `conformance-auditor.md`, `blast-radius-auditor.md`, `claim-auditor.md`, `commit-guard.md`, `log-format.md`, `context.md`, `harness-targets.md`, `hygiene.md` |
| C · optional | `cross-model.md`, `preflight.md`, `sweep.md`, `segment.md`, `machine.md` |
| E · growth | `vendor-skill.md`, `learning.md` |
| F · across projects | `learning.md` › Phase F |

Every reference line is marked **`[M]` mechanism** — ship it — or **`[B]`
binding** — re-derive it from this project. Generating means writing files that
name **this** project's real paths, commands and column names inline. Never an
indirection layer: the runners work partly because the format is literally in the
instructions, and an adapter is a place to guess wrong.

### Who orchestrates

The generated **runner skill** holds the sequence and the **main session** (Opus)
coordinates it: tier, gates, plan, slicing, briefs, triage, scope guard, commits.
It hands every bounded segment — slices, fixes, review and audit fan-outs,
countable inventories — to the **`delegate-tasks`** skill, whose gates are commands,
never claims. On Full, the review fan-out may run as the project's **review
workflow** (Claude Code's Workflow tool, `templates/workflows/review.workflow.js`).
No single engine runs all of it: the gates need the owner, and a workflow can
neither ask the owner nor run a command.

### What ships as rules, and what does not

Every rule in `reference/rules.md` §1 was produced by a specific failure and has
held since. Ship each into `AGENTS.md` as **the rule + one clause of why + a link** —
**copied from `templates/agents-rules.md`, never composed**: a why clause written from
memory drifts from its incident and reads as invented — and its full origin into the
generated `docs/harness/rule-origins.md` — a rule
without its incident reads as pedantry and is deleted just before it is needed. To
orient:

- **Guard every commit — refuse, do not merely check.** A hook, not a habit.
- **Break the code and watch the suite stay green.** A control never seen failing
  is an assertion.
- **A "done" report ends with the step ledger; a step missing from it did not
  run.**
- **The record is written last, from the diff — fields generated, prose audited by someone else.**
- **Reproduce a finding before fixing it.**
- **Whatever one model family writes, the other reviews.**
- **Never ask the owner for a new session or a hand-off.**
- **An implementer may always raise a gate, never lower one.**
- **P3s never start a fix round; a re-review reads the fix diff.** Review cost goes
  where the risk is (`gate-design.md` › Review lineup).
- **Ask the owner only what only the owner can decide.** Product and confirmation
  decisions as decision cards; technical ones decided, logged and listed at Gate 2
  (`gate-design.md` › Who decides).
- **One deliverable per coordinator context, each with a `Demo:` line** the owner
  can open and check (`gate-design.md` › Milestone size).
- **Never re-run a gate on a tree it already passed** (`run-gates.sh` reuses it).

**Left deliberately empty, to be earned:** the never-auto categories and the risk
map (Phase B derives them), the importer threshold, the Hot-small tier, tripwire
numbers, medians. The milestone cap **starts** at 15 slices or 10k changed production
lines (`gate-design.md` › Milestone size) and the log moves it. Budgets on
instruction files **ratchet from their current size**. Importing another project's numbers hands a team rules whose
reasons they have not lived. The **model split** is the exception — Opus where a
miss cannot be corrected forward, Sonnet for work bounded by an exit condition, the second family where it finds the
most for the least and as the first builder of cold work (`gate-design.md`) — because it is mechanism, not a threshold.
Any slice's executor can be overridden (`runner.md` › Executor override).

**Project-specific skills are not generated.** They are the residue of a vendor
behaving against its own documentation. Phase C wires the trigger — a line in the
runner's teardown step — and Phase E grows them.

### Phase 0 — Detect, and upgrade what is there

Run the status script first. It is read-only:

```
node <skill dir>/scripts/harness-status.js <repo> --text
```

It reports the lineage installed (plan, change, both or none, with the files that
matched), every manifest entry's status (`unchanged`, `edited`, `reviewed`,
`scaffold`, `missing`, or `legacy` with no manifest), markers, sizes, id prefixes
in use, held registry rows, the policy status line, and hazards by id. **Quote it at the top of the
decision sheet** — or of the Phase A assessment when nothing is installed.

- **Nothing installed** → Phase A.
- **Lineage `none`, no manifest, and a policy line** → a Phase B draft from an earlier
  session: `DRAFT` → stop for the owner's review; `REVIEWED` → Phase C.
- **Anything installed → stop for one decision sheet** before writing anything:
  `Path[#block] | Lineage | Status | Proposed | Default`. Unchanged generated
  files default to replace; edited, reviewed, scaffold and legacy entries default
  to **keep**, with section-level proposals; every hazard gets a row.
  `reference/upgrade.md` has the table, the manifest and the version history.
- **Without a manifest the script lists only what it fingerprints.** Build the
  `missing` rows by comparing the repo against the Phase C core table and the
  mode's set, and read what each row's fix names before proposing it.
- **Check the existing runner's land order** against `commit-guard.md` › Land
  order. A runner that merges or flips status on the mainline before releasing its
  row is refused by the guard the upgrade installs — that row is not optional.
- The sheet also carries the three Phase A facts — agents used, id prefixes taken,
  main checkout or worktrees — since the upgrade binds them.
- **Never install alongside.** An existing runner keeps its name through the
  manifest's `roles`; two files governing the same steps is the drift the rules
  warn about. A log with rows in it is the strongest signal to preserve.
- Apply only what the sheet approved, **only while no unit holds a registry row**,
  then write `.agents/harness-manifest.json`.

### Phase A — Assess, route, and be willing to refuse

| # | Precondition | Look for | If absent |
|---|---|---|---|
| 1 | A **pass signal** that can fail | test scripts or CI config — **run it once**, read its count, and **see it red once** (break one assertion, run, restore) | **stop** — "done" is unfalsifiable |
| 2 | A reachable **owner** who answers gates | the person asking, code owners, recent commits | **stop** — gates with nobody behind them are decoration |
| 3 | **Non-trivial work** | `git log --since=90.days --numstat` against the paths a policy would plainly cover (money, auth, schema, deploy, data deletion); or the plan's tasks; or the owner's stated scope | **stop** if every change was a typo, a config value or docs — the harness would cost more than it catches |
| 4 | A **unit of work** | a plan with stable ids → **plan mode**, its order from a dependency column or else from the plan's phases and checkpoints (say which); code change requests, issues, milestones, a change stream, or nothing yet → **change mode** | route, never stop |
| 5 | A **risk signal** | a per-task size or risk column, the paths of critical code, or the areas a document says need the owner's approval | present: evidence for Phase B · absent: **Phase B** — the risk map |
| 6 | A **written** never-auto-merge policy | a security section, locked decisions, a risk register, a protected-areas list | present: Phase B confirms it · absent: **Phase B** — the usual gap |

**Specify properties, not columns.** Never prescribe a plan shape; check the
property. **A pass signal is at least one real test that runs and was seen red.**
Lint, a type check and a format check can fail but test no behaviour: they are
gates, not the signal. A command that runs nothing is not one either — `exit 0`, no
matching files, a workspace runner that finds no package with tests
(`pnpm -r --if-present run test`), zero tests, every test skipped. A weak suite
passes row 1 but goes into the report as a gap. Plan mode also needs an exit
condition per task; where the plan has none, each unit's Scope block supplies its
"Done when" at claim (`scope-guard.md`). **Change requests against the
specification** are the owner's to decide: a unit may *draft* a new one when it finds
a gap (in the shape the project already uses), never edit the specification or an
existing request, and stops if the gap blocks it. The **code half of an approved
request** is a unit with the request's own id — a request with no id runs on
`change/<slug>`, matched by the `Branch` cell — so `ID_PATTERN` covers every id shape
that names a unit, and never a prefix the documents use for something else.

**Coverage, per path.** Row 1 holds for the repository; the gates hold for paths.
List each gate with the paths it exercises, and the paths nothing exercises yet —
a backend whose tests need a service no runner has, a package with no tests. The
generated gate table carries this map: a unit that touches an uncovered path is
**Full and never auto-merges** until a gate covers it.

**The assessment is a table, not prose:** `Precondition | Evidence (file, path or
line) | Verdict (pass · route · Phase B · ask · stop)`, then the coverage map, then
one closing line: the mode when eligible, the foundation stage when nothing is
built yet, or the readiness plan when refused. A pass without cited evidence was not
assessed. **Never install a harness that can merge on its own without a pass
signal.**

**A refusal is a readiness plan.** If 1, 2 or 3 fail, write — in the report, not
the repository — the smallest units that make each failed row pass. Take them from
the project's own plan where it has one (its foundation stories), else name them.
Each unit gets a "Done when" that is the row's own test (`pnpm test runs at least
one test and was seen red once`), what it needs from the owner, and its order. The
last line is always *rerun Phase A*. The owner runs the units as ordinary work —
`delegate-tasks` can carry them — and the skill does not install until the rerun
passes.

**A new repository — documents only.** Row 3 has no history: judge it from the plan
or the owner's stated scope and say so; with neither, **ask** the owner for the
scope, and stop if there is none. When row 1 fails only because nothing is built yet
and rows 2 and 3 pass, route to the **foundation stage** (`reference/foundation.md`)
— the default, offered beside the readiness plan: Phase B runs from the documents, the
install ships everything that needs no pass signal, every unit is Full and merged by
the owner, and the unit that lands the first real test is followed by the flip that
binds the test gates. Refusal stays for untested product code, a broken suite, no
owner and trivial scope. The risk map can name only **planned** paths
(`policy-derivation.md`).
Install **between units**: a branch already in flight carries an id the new guard
finds no row for, so it lands first or is claimed in the registry at install.

Also list here:

- the id prefixes already taken (the status script's `ids`, plus a search of the
  plan's own ids — `scope-guard.md`) and the plan's id **shape**, which binds
  `ID_PATTERN` (`EP-27.01` needs the dot);
- the agents the project uses (a search; none found → ask, default Claude Code plus
  `AGENTS.md` — `harness-targets.md`);
- the **roles and working rules the project's documents already define** — an
  agent table, review-by-another-agent, protected areas, "never edit the spec".
  Phase C maps the harness onto them, by their names, instead of adding competing
  ones;
- a **governed document set** (a register, versioned specifications): ask where the
  harness's docs live — default `harness/` at the root, outside the set, unless the
  owner registers them;
- whether units run in the main checkout or in worktrees (`git worktree list`; no
  units yet → the main checkout, `SCOPE=repo`, unless the owner says worktrees).

### Phase B — Derive the policy, the risk map and the merge policy

**Read `reference/policy-derivation.md`.** It holds the single test — *if this is
wrong and ships, can it be corrected forward?* — the output rules, two worked
examples whose right answers differed, and how the same test yields the **risk
map** (hot modules, critical code, cold modules, each entry citing its evidence)
and the **merge policy** (the generated default: Small merges locally when clean;
Full, never-auto and taste calls — copy, naming, visual identity — wait for the
owner; push is always the owner's).
This is the piece that cannot be templated.

Write all three into the **harness file** — the instruction file every agent reads,
`AGENTS.md` by default, created now if the project has only `CLAUDE.md`
(`harness-targets.md`) — under one status line, placed directly above
the `policy` block and outside its markers (so flipping it never edits a block):

```
Never-auto policy: DRAFT — owner has not reviewed
```

**Do not commit it**, and stop. The owner reads it and changes the line to
`REVIEWED <YYYY-MM-DD>`. A policy adopted without being read is not a policy.

### Phase C — Generate

**Refuse while the policy line says `DRAFT`.** Then read the Phase C references and
write these into the project, naming every path in the report. Defaults are for
Claude Code; `harness-targets.md` gives the Codex, ZCode and Kimi forms.

**Core — every install:**

| File | From | Notes |
|---|---|---|
| `AGENTS.md` — generated sections between `harness:begin`/`harness:end` markers (block ids in `upgrade.md`) | `templates/agents-rules.md` (the rules block, copied), `gate-design.md`, `scope-guard.md`, `context.md`, Phase B | rules (rule + why + link) · task types · tiers · gate table on the risk map and policy · the policy, risk map and merge policy · owner stops · the scope guard (Scope block, scope classes, drift check, quote-or-delete, the state-file convention) · the no-hand-off context rule · specialist triggers · model and effort routing (`models`) · the "do not adopt" list · the project's commands. The earned slots — Hot-small and tripwire numbers empty, the milestone cap at its starting figure — go in their own `earned` block of kind `reviewed`, so filling one never marks a generated block edited |
| `docs/harness/rule-origins.md` | `rules.md` §1 | every shipped rule's full origin |
| `CLAUDE.md` | `harness-targets.md` | line 1 `@AGENTS.md`, then only Claude specifics: model map, agents, skills, hooks. An existing `CLAUDE.md` keeps its project text; moving it to `AGENTS.md` is a proposal to the owner, never part of the install |
| `.agents/skills/task-runner/SKILL.md`, with a committed relative symlink at `.claude/skills/task-runner` | `runner.md` | the sequence with this project's front-end(s), bound to its plan or change documents. Edit the real file, never through the link |
| `.claude/agents/plan-conformance-auditor.md` | `conformance-auditor.md` | lane A · `model: sonnet`, `effort: high`, `tools: Read, Grep, Glob`; states its bound |
| `.claude/agents/blast-radius-auditor.md` | `blast-radius-auditor.md` | lane B's fallback when the second family is unavailable · `model: opus`, `effort: high`, `tools: Read, Grep, Glob` |
| `.claude/agents/claim-auditor.md` | `claim-auditor.md` | lane C · `model: opus`, `effort: high`, `tools: Read, Grep, Glob, Bash`; product claims only; states that it sabotages and restores |
| `.claude/agents/implementer.md` | `runner.md` | `model: opus` default, `sonnet` passed for cold slices, `effort: high`, `autoCompactWindow: 250000` |
| every generated agent file | `context.md` | the **Tool discipline** section, verbatim |
| `scripts/review-gate.mjs` + `scripts/lib/review-gate-core.mjs` + its test | `templates/scripts/review-gate.mjs`, `templates/scripts/lib/review-gate-core.mjs`, `templates/scripts/lib/review-gate-core.test.mjs` | names the reviewers at each review point (`gate-design.md` › Review lineup, Fix rounds). Bind `CRITICAL` and `TRIGGERS` from the risk map — unbound, it says so in every result line |
| `scripts/docs-drift.mjs` + `scripts/lib/docs-drift-core.mjs` + its test | `templates/scripts/docs-drift.mjs`, `templates/scripts/lib/docs-drift-core.mjs`, `templates/scripts/lib/docs-drift-core.test.mjs` | step 8a's stale-doc list; bind `DOC_GLOBS` to the doc tree |
| `scripts/unit-step.mjs` + `scripts/lib/unit-step-core.mjs` + its test | `templates/scripts/unit-step.mjs`, `templates/scripts/lib/unit-step-core.mjs`, `templates/scripts/lib/unit-step-core.test.mjs` | each runner step's start and end, one line each in the unit's steps file beside its state file (`runner.md` › Step markers); bind `STEPS_DIR` to the state file's directory |
| `scripts/unit-record.mjs` + `scripts/lib/unit-record-core.mjs` + its test | `templates/scripts/unit-record.mjs`, `templates/scripts/lib/unit-record-core.mjs`, `templates/scripts/lib/unit-record-core.test.mjs` | step 8b's record fields and the log row, from git, the state file and the steps file (`scope-guard.md` › the state file's shape) |
| `scripts/unit-cost.mjs` + `scripts/lib/unit-cost-core.mjs` + its test | `templates/scripts/unit-cost.mjs`, `templates/scripts/lib/unit-cost-core.mjs`, `templates/scripts/lib/unit-cost-core.test.mjs` | the log's Cost cell — the unit's Claude cost from its transcripts and the second family's meter from its ledger (`log-format.md`); with `--times` and `--by-step`, where the time and money went; bind the price table and the dollars-per-percent calibration |
| `scripts/retro.mjs` + `scripts/lib/retro-core.mjs` + `scripts/lib/retro-gather.mjs` + its test | `templates/scripts/retro.mjs`, `templates/scripts/lib/retro-core.mjs`, `templates/scripts/lib/retro-gather.mjs`, `templates/scripts/lib/retro-core.test.mjs` | the week's digest, committed under `docs/harness/reports/`: KPIs against the four weeks before, outliers, where the money went by step, friction, the queue, at most five candidates (`learning.md` › The retro); bind the paths, the extra log columns, the outlier rule and the step words |
| `scripts/harness-due.mjs` + `scripts/lib/harness-due-core.mjs` + its test | `templates/scripts/harness-due.mjs`, `templates/scripts/lib/harness-due-core.mjs`, `templates/scripts/lib/harness-due-core.test.mjs` | the due-checks at steps 0 and 9 (`runner.md` › Due-checks): a missing preflight stops the claim of the row that opens a phase; a sweep, retro or hygiene unit due, the P3 queue, low disk, finished worktrees and the week's proposals each print one line; bind `MAIN`, the paths, `REPORTS`, `PHASE_OF`, `CADENCE` and the limits |
| `scripts/lib/run-sources.mjs` | `templates/scripts/lib/run-sources.mjs` | where a run's transcripts and Codex ledger are, for `unit-cost.mjs` and `retro.mjs`; bind `LEDGER_DIR` as `codex-run.mjs` does |
| `scripts/estimate.mjs` + `scripts/lib/estimate-core.mjs` + its test | `templates/scripts/estimate.mjs`, `templates/scripts/lib/estimate-core.mjs`, `templates/scripts/lib/estimate-core.test.mjs` | Gate 1's estimate — p25–p75 ranges from the log, "no history" below three rows (`log-format.md` › Estimates); bind the log's column names |
| `.claude/registry.md` | `commit-guard.md` | the lock, with markers and a header row; gitignored; a `Worktree` column under `SCOPE=checkout`. Exclude it from the formatter |
| `.githooks/pre-commit` **and** `.githooks/pre-merge-commit` (the same script) + `git config core.hooksPath .githooks`, + `scripts/lib/harness-guard.test.mjs` | `commit-guard.md`, `templates/harness-guard.sh`, `templates/scripts/lib/harness-guard.test.mjs` | or chain into husky/lefthook. Set `SCOPE` and `ID_PATTERN`; the test runs the installed guard in throwaway repos, with `IDS` bound to every plan id (the id self-test, `commit-guard.md`) and `GUARD` to where it is installed |
| `.claude/hooks/command-guard.mjs` + settings entry + `scripts/lib/command-guard.test.mjs` | `harness-targets.md`, `templates/command-guard.mjs`, `templates/scripts/lib/command-guard.test.mjs` | refuses `--no-verify`, hook-path overrides and mainline force-pushes, by parsing; set `HOOKS_DIR`; a rule added to `EXTRA_RULES` gets its own case in the test |
| `.claude/hooks/edit-guard.mjs` + settings entry, and `.codex/hooks.json` where Codex runs, + `scripts/lib/edit-guard.test.mjs` | `harness-targets.md`, `templates/edit-guard.mjs`, `templates/scripts/lib/edit-guard.test.mjs` | refuses an agent's edit of an env file or of installed packages, reading the paths from the hook's stdin on both hosts; bind `PROTECTED`, and the test's `REFUSED` and `ALLOWED` with it |
| `scripts/check-agent-docs.mjs` + `scripts/lib/check-agent-docs.test.mjs`, run as a gate | `harness-targets.md`, `templates/scripts/check-agent-docs.mjs`, `templates/scripts/lib/check-agent-docs.test.mjs` | budgets ratcheted from today's sizes · `--rules-for` for briefs · the test is slow: a `full`-level gate |
| the harness log, `docs/harness/log.md` | `log-format.md` | **the engine** — headers only, no seeded medians |
| the follow-ups doc and the decision log | `scope-guard.md` | scaffolds at their default paths |
| `.gitignore` entries | `runner.md`, `commit-guard.md` | `.claude/registry.md`, `.review-work/`, and `.codex-runs/` with the wrapper |
| `CODEOWNERS` + branch protection, where the platform supports it | Phase B | never-auto categories as required-review paths |
| `.agents/harness-manifest.json` — **last** | `upgrade.md` | every entry with its kind, hashes taken after the formatter; `"stage": "foundation"` until the flip (`foundation.md`) |

**Per mode:** plan mode binds the runner to the plan's path, columns and id
pattern (`ID_PATTERN`, checked against the plan's real ids). Change mode binds it
to the change-request and milestone documents — the project's own home for them,
else `docs/changes/<unit>.md` — puts each unit's plan and state file at
`docs/plans/<unit>.md` and `docs/plans/<unit>.state.md`, matches registry rows by
the `Branch` cell with `ID_PATTERN` empty (unless changes carry ids), and takes
`SCOPE=checkout` when units run in worktrees, else `SCOPE=repo`.

**Optional — ask first, each where the project earns it.** The default is the
answer when the owner just accepts:

| Component | From | Needs | Default |
|---|---|---|---|
| `.claude/hooks/context-budget.mjs` + settings entry + `scripts/lib/context-budget.test.mjs` | `context.md`, `templates/context-budget.mjs`, `templates/scripts/lib/context-budget.test.mjs` | warns at a token budget and offers `/compact` instead of a hand-off | yes, on Claude Code |
| `.claude/hooks/leftover-processes.mjs` + settings entry, on Stop and UserPromptSubmit | `machine.md`, `templates/leftover-processes.mjs` | checks that start dev servers, emulators or browsers; bind `WORKTREES` and `MACHINE_WIDE` | yes, on Claude Code, where they do |
| `scripts/run-gates.sh`, run as `bash scripts/run-gates.sh`, + `scripts/lib/run-gates.test.mjs` + `scripts/run-counted.mjs` + `scripts/lib/run-counted-core.mjs` + its test | `context.md`, `templates/run-gates.sh`, `templates/scripts/lib/run-gates.test.mjs`, `templates/scripts/run-counted.mjs`, `templates/scripts/lib/run-counted-core.mjs`, `templates/scripts/lib/run-counted-core.test.mjs` | no existing runner that reports every gate and never bails; test gates bound through run-counted, so a skip, a filter that matched nothing or zero tests is a FAIL (the runner's test holds every counted gate to it; `UNCOUNTED` names the exceptions); `SNAPSHOT_COPY` bound where untracked files would reach the FULL verify | yes, unless such a runner exists |
| `scripts/codex-run.mjs` + `scripts/lib/codex-run-core.mjs` + its test | `cross-model.md`, `templates/scripts/codex-run.mjs`, `templates/scripts/lib/codex-run-core.mjs`, `templates/scripts/lib/codex-run-core.test.mjs` | a second model family's CLI installed and logged in | yes when it is; else skip and record cross-model passes `degraded` |
| `.claude/workflows/review.workflow.js` | `harness-targets.md`, `templates/workflows/review.workflow.js` | Full-tier review fan-outs often enough to want them deterministic | no, until the log shows them |
| phase preflight · workstream sweep | `preflight.md`, `sweep.md` | phases in the plan (preflight); a question register, non-code work that gates code, or a follow-ups doc in change mode (sweep). 5 and 8 runs | yes, wherever they have a home; the due-checks run them |
| segment runner | `segment.md` | several independent low-risk tasks; 2 runs | no |

**The project's own model wins on names.** Where its documents define agent roles
and working rules, the generated runner, agents and gate table use those names and
cite those rules; a harness role with no counterpart is added and said so. The
harness's docs (`docs/harness/`, `docs/plans/`) move wherever Phase A agreed when
`docs/` is a governed set.

**Fit the project's tooling.** Run the project's own lint, format and type check over
the generated files before hashing. Where the harness's Node scripts break its
config (a strict TypeScript lint with no Node globals; with nothing to run yet, the
flip does this — `foundation.md`), add one block scoped to those
paths; keep the template scripts out of the formatter (a reformat breaks their hash,
and the agent-docs test reads its CONFIG block); add `.review-work/` and `.codex-runs/`
to the linter's ignores; record each change under the manifest's `notTracked`. Bind
the commit-message style from `git log`, never a default. Add the `prepare` (or
equivalent) line that sets `core.hooksPath`, and say in the commands block that a
fresh clone is unguarded until it runs and the registry is recreated.

**Project rules tighten the defaults, never loosen them.** Where the project's
documents require more than a tier's default steps — every change reviewed by
another agent, every merge by a human, the owner's review of one kind of change
(that kind is Full, its Gate 2 the owner's) — the generated tiers and runner carry the
stricter rule, Trivial included. Units that are not plan items (harness work,
vendor-trap skills, follow-ups no unit owns) run on `harness/<slug>` branches matched
by the registry's `Branch` cell; write paths with `<unit>`, never the plan's id
shape alone. The harness's own paths go on the risk map (the guard, the command and
edit guards and `run-gates.sh` are critical: a broken one silently allows everything)
and on the coverage map, covered by the tests that ship with them in `scripts/lib/`,
which the counted `harness` gate runs.

**Review the install before committing it.** A fresh agent that did not write it
(Opus, read-only) checks that every path, command, flag, agent and section reference
resolves; that `AGENTS.md`, the runner, the agents, the guard and `run-gates.sh`
agree with one another; that no generated line contradicts the project's own rules or
the reviewed policy; and that the core table is complete. One fix round, one
re-review, both in the install report. The install then lands like a harness unit:
its own `harness/<slug>` branch, `--no-ff` on the owner's word, a log row, push the
owner's. On its first run this review found five P1
defects the generator could not see in its own output. Once it lands, register the
repository for the weekly job: `node <skill dir>/scripts/retro-weekly.mjs --register
<repo>` writes only `~/.agents/harness/repos.json`, and `--dry-run` shows what the
next run will read (`learning.md` › The weekly job). Once per machine, offer the
owner the machine sweep: `node <skill dir>/scripts/machine-sweep.mjs` reports and
changes nothing, the owner approves the categories they want with `--approve <ids>`,
and from then on `DUE disk` starts them (`machine.md`).

**Local skills, not global.** They live in the project so they can name its facts
and grow from its runs. `.claude/skills/`, `.claude/agents/` and `.agents/skills/`
register on their own — no further wiring.

### Phase D — Calibrate, and let the project write its own rules

Run one unit — the lowest-risk one whose "Done when" is fully specified. Read the
log row and the ledger. **The first failure writes the first rule.** Have a fresh
agent review the generated harness against `rules.md` (ECC's `loop-design-check`,
where installed) before the second unit.

Medians, tripwire numbers, the Hot-small cap and the importer threshold come from
the log once rows exist, never before. After about five units, read `Missed by
harness`: empty across five is evidence to loosen a gate; non-empty is the reason
not to.

**Expect to be wrong.** The origin harness was corrected about fifteen times in its
first 21 tasks, and about one in five of its reasoned-from-first-principles rules
was disproved by a log (`rules.md` §3) — including two of this skill's own first
version.

### Phase E — Growth

**Vendor surprises.** When a library behaves contrary to its documentation, write a
named skill **before the session moves on** — it analyses that session. Format in
`reference/vendor-skill.md`. These are the highest-value artifacts the harness
makes, and none could have been generated up front.

**Rules from the log.** Each incident that produces a rule adds it to `AGENTS.md`
(rule + why + link) and its story to `docs/harness/rule-origins.md`. Over time earned rules
outnumber generated ones — which is the point. Once a quarter, or when a weekly review
proposes it, a fresh agent audits every rule against the log: which fired, which never
did, which the log contradicts.

**The retro, weekly.** `scripts/retro.mjs` writes the week's digest; the weekly job
exports every registered project's and has a fresh Opus review them, read-only and
capped. Its proposals are routed, never asked: a T proposal becomes a queued
`harness/<slug>` unit, a C proposal goes into the next Gate 2 brief under "Harness
learning" (`learning.md`).

### Phase F — Across projects

Run in this skill's own repository when a weekly review proposes a promotion, or
monthly. Promote mechanism that two or more projects found, or a template logic
error found once — never one project's thresholds — and cite the digests it rests
on. The output is the next harness round's plan (`learning.md` › Phase F).

## Examples

**Refusal.** A repository with a README and no tests:

```
| Precondition | Evidence | Verdict |
|---|---|---|
| 1 pass signal | no test script, no CI config | stop |
| 2 owner | the requester answers gates | pass |
| 3 non-trivial work | 41 commits in 90 days, 12 touch src/billing | pass |
| 4 unit of work | issues, no plan ids | route: change mode |
| 5 risk signal | none written | Phase B |
| 6 never-auto policy | none | Phase B |
Outcome: refused. Add a test command that fails when the billing code is broken, then rerun.
```

**New repository, documents only.** A specification and a build plan with story
ids, no code. Row 1 fails because nothing is built; rows 2 and 3 pass from the plan
and its named owner; row 6 is whatever the documents say needs the owner's approval.
The closing line offers the **foundation stage** (default) beside the readiness
plan. The owner takes it: Phase B derives the never-auto categories and a risk map
of planned paths from the documents, and asks which story is the pass-signal unit;
Phase C installs the guard bound to the plan's own id shape, the runner, the
auditors and `run-gates.sh` with the agent-docs lint, the only gate that exists yet.
The plan's foundation stories run as Full units merged by the owner, up to the
pass-signal unit — "done when the test command runs at least one test and was seen
red once". A `harness/` unit then flips the stage: counted test gates, the first
covered rows, Small unlocked.

**Change-mode install.** A production repository with CI, change requests and no
plan: Phase A routes to change mode with `SCOPE=checkout` (units run in worktrees);
Phase B drafts four never-auto categories, a risk map of nine hot modules and the
default merge policy; the owner flips the line; Phase C writes the core set,
`run-gates.sh` and `codex-run.mjs`; Phase D runs one Small change end to end.

**Upgrade.** A plan install from the first version: `harness-status.js` reports
`plan` lineage, `registry-no-markers`, `guard-snippet-only` and `policy-no-status`.
The sheet proposes markers, the git hook, a one-time policy confirmation, lane B and
the new context rule, and keeps the runner, the log and every earned rule. The owner
approves; the upgrade lands between runs and writes the manifest.

## Constraints

- Refusing is a valid outcome. Say so plainly and name what to write.
- Never install a harness that can merge on its own without a pass signal, and never
  install alongside an existing one. The foundation stage is not partial: it merges
  nothing on its own.
- Never copy a threshold, a tier boundary, a risk-map entry or a policy category
  from another project.
- Never commit the derived policy, and never generate, while its line says `DRAFT`.
- Never write during Phase 0 before the owner answers the decision sheet.
- Pass `model` and `effort` explicitly on every subagent dispatch — an agent file's
  pinned model otherwise wins, and the riskiest unit silently gets the cheapest
  reviewer. Every generated agent pins `effort: high`; never leave a session at
  `max` (`rules.md` §1 › Cost).
- Never ask the owner to open a new session or paste a hand-off.
