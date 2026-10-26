# Reference: Phase 0 — detecting and upgrading an installed harness

A harness is regenerated as the reference improves, and the project edits it in
between. The upgrade must tell the three apart: a generated file nobody touched
(replace it), a generated file someone edited (show the diff, the owner decides),
and content the project earned or reviewed (keep it). **Evidence:** four installs
on one machine, none stamped consistently — one plan install with its guard as a
snippet in `CLAUDE.md`, one whose 118 KB `CLAUDE.md` had no `AGENTS.md`, two change
installs that predated this skill.

**`[M]` mechanism · `[B]` binding**

## Step 1 — run the status script, read-only

```
node <skill dir>/scripts/harness-status.js <repo> --text
```

It never writes. It reports:

- **lineage** — from the manifest's `modes` when there is one; otherwise from
  fingerprints of a plan install (registry, task runner, conformance and claim
  auditors, a log with `Missed by harness` — v1 was plan-only) and of a change
  install (change-workflow, crosscheck and verify skills, a tier table), each with
  the file that matched; verdict `none`, `plan`, `change` or `both`;
- **entries** — every file and block in the manifest with its status, or, with no
  manifest, every fingerprinted file as `legacy` (including lineage-neutral harness
  files such as `codex-run.mjs`, `check-agent-docs.mjs`, `run-gates.sh`, the hooks,
  the decision log and the follow-ups doc);
- **markers** — every `harness:begin` / `harness:end` pair in `AGENTS.md` and
  `CLAUDE.md`, and whether it balances;
- **sizes**, **id prefixes** in use (`DEC-`, `D-`, `D<n>`, `Q-`, counted outside
  harness blocks) and **held registry rows**;
- **hazards** — by id, with the file and line.

Run it without `--text` for JSON. `--hash <path>[#block]` prints the hash the
manifest records for a file or block.

`[M]` Quote its output at the top of the sheet. A lineage judged by eye misses the
install that names its runner something else — and the script misses what it does
not fingerprint, so read the repo too.

## Step 2 — the decision sheet, before anything is written

`[M]` **One table, one owner round:**

```
| Path[#block] | Lineage | Status | Proposed | Default |
```

`Lineage` is the mode the row belongs to (`plan`, `change`, or `core` for both);
hazard rows carry `—`. `Default` is one of `replace · keep · generate · ask · wait`.

| Status | Proposed | Default |
|---|---|---|
| `unchanged` (generated, hash matches) | replace with the newer template — a no-op when the manifest's `skillVersion` is current; say so | replace |
| `edited` (generated, hash differs) | the edit, section by section — for a template-generated file against the template with this project's bindings; for a reference-generated block against the block as the manifest's commit wrote it (`git show <that commit>:AGENTS.md`), since only a hash is stored | **keep** |
| `reviewed` (policy, risk map, earned rules) | nothing, or a section-level suggestion | keep |
| `scaffold` (registry, log, follow-ups, decision log) | nothing; add a column only if the newer format needs it | keep |
| `ignored` (a gitignored scaffold absent here, e.g. the registry in a fresh clone) | nothing | keep |
| `legacy` (no manifest) | section-level proposals only | **keep** |
| `missing` | the file, newly generated | generate — but **ask** for rows that depend on Phase B (policy, risk map, merge policy, `CODEOWNERS`) and route them there |

`[M]` **Without a manifest, build the `missing` rows yourself:** compare the repo
against the Phase C core table and the mode's set in `SKILL.md`. A component the
project already wrote its own way (its own lint, its own verify runner) is a
`legacy` keep row with a section-level proposal, not `missing`.

Every hazard gets a row too, with its fix as the proposal and `ask` as the
default. Anything that blocks applying — a held registry row, an open unit —
gets a `wait` row.

`[M]` **A legacy policy needs one owner confirmation** before it counts as
reviewed; then its status line reads `REVIEWED <date> (adopted)`. Nobody can know
whether an unstamped policy was ever read. Recognise one by what it governs, not
its heading: a never-auto section, a hot-modules or critical-code table that keys
review or merging, a locked-decisions list. Where it spans two files, the status
line goes above the copy in the harness file and the other links to it. No policy
at all → Phase B, its rows `ask`.

`[M]` **Roles are kept by name.** The manifest maps each role to the project's
existing name; the upgrade edits that file, never installs a second one beside it.
Two files governing the same steps is the drift `rules.md` warns against. Role
keys: `runner`, `lane-a` (conformance), `lane-b` (blast radius), `lane-c` (claim
audit), `implementer`, `verify`, `rule-origins`, `log`, `follow-ups`,
`decision-log`. A legacy auditor that covers several lanes maps to each
(`"lane-b": "crosscheck-auditor", "lane-c": "crosscheck-auditor"`); when it holds
`Bash` only for lane C, propose splitting the read-only lane out.

`[M]` **The harness file is where the project keeps its process.** Generated blocks
default to `AGENTS.md`; where the project keeps process in `CLAUDE.md` on purpose —
another agent is its main runtime, or a test caps `AGENTS.md` — the blocks go there
and the sheet says so.

`[M]` **The owner's answer is the plan.** Write nothing the sheet did not approve.

## Step 3 — apply, then write the manifest

`[M]` **Only when no unit is in flight** — harness changes land between runs, never
during one (`rules.md` §1). With a registry: the status script's held rows read 0.
Without one: no linked worktree or open state file has uncommitted work; if any
does, ask.

`[M]` **Check the land order first.** A legacy runner that merges, flips a status
or writes its log row on the mainline before releasing its row is refused by the
guard the upgrade installs (`commit-guard.md` › Land order). Fix the runner in the
same upgrade, or do not install the hook yet.

`[M]` After applying, write `.agents/harness-manifest.json` and commit it with the
change (then register the repository for the weekly job, `learning.md` › The weekly
job):

```json
{ "schema": 1, "skill": "harness-bootstrap", "skillVersion": 5, "generated": "<date>",
  "modes": ["change"], "targets": ["claude", "codex"],
  "roles": { "runner": "task-runner" },
  "entries": [
    { "path": "AGENTS.md", "block": "gates", "kind": "generated", "sha256": "<hex>" },
    { "path": "AGENTS.md", "block": "policy", "kind": "reviewed" },
    { "path": ".githooks/pre-commit", "kind": "generated",
      "template": "templates/harness-guard.sh", "templateSha256": "<hex>", "sha256": "<hex>" },
    { "path": "docs/harness/log.md", "kind": "scaffold" } ] }
```

| `kind` | Means | An upgrade may |
|---|---|---|
| `generated` | written by this skill from a template or a reference | replace it while its hash matches |
| `scaffold` | created once, then the project's (registry, log, follow-ups, decision log) | add structure the newer format needs, never rows |
| `reviewed` | owner-approved, earned, or a kept legacy file (policy, risk map, merge policy, earned rules, the project's own runner) | nothing without the owner |

`[M]` A foundation-stage install (`foundation.md`) adds `"stage": "foundation"` and
`"flipAfter": "<the pass-signal unit's id>"`; the flip sets `"stage": "full"`. A
manifest with no `stage` is `full`.

`[M]` **Hash after the formatter.** Take each hash from `harness-status.js --hash`
**after** the project's formatter has run on the file, or the first formatting pass
reads every file as edited. Hashes are over LF-normalised text; a block's hash
covers the text strictly between its markers. `templateSha256` is the same command
run on the skill itself: `node <skill dir>/scripts/harness-status.js <skill dir>
--hash templates/<file>`.

`[M]` **What is not an entry.** A symlink (record its real file); a shared JSON file
the project also edits, such as `.claude/settings.json` — record the hook entries
you added in the report, or the first permission change reads `edited`; the
`prepare` line in `package.json`.

## Markers in shared files

`[M]` In files the project also writes (`AGENTS.md`, `CLAUDE.md`), generated
sections sit between markers on their own lines, never nested:

```
<!-- harness:begin gates -->
...
<!-- harness:end gates -->
```

Ids: `rules`, `types`, `tiers`, `gates`, `policy`, `risk-map`, `merge`, `stops`,
`scope`, `context`, `triggers`, `do-not-adopt`, `commands`, `models`, `claude`, and
`earned` — the empty slots the log fills (Hot-small, tripwire numbers, the
milestone cap), always of kind `reviewed`. Everything outside the markers is the
project's, and an upgrade never touches it. **Wrap only blocks this skill writes**:
legacy text the project wrote stays outside markers until the owner adopts it, and
an adopted block is `reviewed`.

`[M]` Files the harness owns outright — the runner skill, the auditors, the guard,
the hooks, the scripts — are entries without a block. Never put a stamp comment in
a `SKILL.md`: frontmatter must be the first line.

## Hazards and their fixes

| Hazard | Fix to propose |
|---|---|
| `registry-no-markers` | add `<!-- harness:active -->` / `<!-- /harness:active -->` around the active table (`commit-guard.md` › Migrating a legacy registry) |
| `guard-missing`, `guard-snippet-only`, `lock-missing` | install the registry and the git hook; delete the snippet once the hook is tested |
| `merge-unguarded` | install the same guard as `pre-merge-commit` (`commit-guard.md`) |
| `id-pattern-truncates`, `id-pattern-invalid` | bind `ID_PATTERN` to the full id shape and run the self-test (`commit-guard.md`); until then the guard refuses the branches that own those rows |
| `skill-link-drift`, `skill-unlinked` | one real file under `.agents/skills/`, a committed relative symlink under `.claude/skills/` — unless the two copies are deliberate per-agent wrappers over one shared script (`harness-targets.md`); then keep both and say so |
| `agents-md-codex-truncation`, `claude-md-large` | move rationale to `docs/harness/rule-origins.md` and area rules to path-scoped files (`harness-targets.md`). The script reads a raised `project_doc_max_bytes` from the Codex config |
| `state-file-over-budget` | an open unit: move closed findings to the follow-ups doc (`scope-guard.md`); a closed unit: archive its state file (`docs/plans/archive/`) — the budget binds open units |
| `readonly-agent-has-write-tools` | drop `Bash`, `Edit`, `Write` from `tools:`, or drop the claim. An auditor that needs a diff gets it written into its brief, so it needs no `Bash` |
| `hook-undocumented-var` | rewrite the hook to read its stdin JSON — until then it acts on nothing |
| `secret-in-agent-files` | move the value into the project's secret store, and rotate it if the file was ever committed: history keeps it. The report masks it; never repeat it |
| `policy-no-status` | the one-time owner confirmation above |
| `keyword-commit-hook` | remove it: a hook that checks for tags the agent writes itself is keyword matching (`rules.md` §3) |
| `marker-unbalanced` | fix the pair before anything else; hashing depends on it |
| `manifest-invalid` | regenerate the manifest from the status report: every entry re-assessed, kind `reviewed` until the owner decides |
| `agent-effort-unpinned` | add `effort: high` to the agent file's frontmatter: without it the agent inherits the session's level, and a session at `max` reaches every reviewer |
| `agent-model-unpinned` | add `model:` to the agent file's frontmatter (`opus` for judgment, `sonnet` for bounded work): one dispatch in ten names no model, and without a pin those run on the session's Opus |
| `effort-above-high` | lower it to `high` — an agent file at `xhigh` or `max`, or `CLAUDE_CODE_EFFORT_LEVEL` / `effortLevel` above `high` in the project's settings; raise effort per question, never per session (`gate-design.md`) |
| `host-models-missing` | write `.agents/harness-models.json` from `templates/harness-models.json`, with an entry for every target the manifest names (`gate-design.md` › Model and effort); step 0 reads it through `harness-host.mjs` |
| `second-family-absent` | name the host's second family in the models file and install its wrapper — `codex-run.mjs`, or `claude-run.mjs` under a host other than Claude Code (`cross-model.md`); until then every cross-family pass on that host is `degraded` |
| `preflight-missing` | run the phase preflight for the phase under way (`preflight.md`) and commit its report under `docs/harness/reports/`; its escalations go to the next Gate 1 |
| `sweep-overdue`, `retro-overdue`, `hygiene-overdue` | install `harness-due.mjs` where it is absent (steps 0 and 9 run it), commit each report under `docs/harness/reports/` — never a gitignored directory — and make the overdue one the next unit |
| `p3-queue-aging` | a hygiene unit: its P3 batch takes the oldest cold-code rows, each re-verified against the mainline first (`hygiene.md`). Follow-ups spread over many files are bound or merged into one doc first |
| `foundation-stage-has-tests` | the pass-signal unit landed and the flip did not run: claim the flip as a `harness/` unit (`foundation.md`) |

## Version table

What each skill version changed, so an upgrade knows what is new since the
manifest's `skillVersion`. An install with no manifest is v1 or earlier.

| Version | Shipped in | Changed |
|---|---|---|
| 0 | before this skill | change installs written by hand (a tiered change workflow, cross-check lanes, a verify runner): everything in v2 is new to them except what the fingerprints show |
| 1 | up to 2.2.1-js.4 | plan mode only: task runner, commit guard (repo-wide lock), two gates, conformance and claim auditors, registry, harness log, context-budget hook (Stop + UserPromptSubmit, recommended a new session), first-line stamps |
| 2 | 2.2.1-js.5 | change mode beside plan mode; task types; tiers Trivial · Small · Full (Standard became Small); risk map and merge policy in Phase B; scope guard, decision log and committed state file; lane B `blast-radius-auditor`; test honesty in the claim auditor; guard `SCOPE=repo\|checkout` with Branch-cell matching, case-insensitive ids and a `pre-merge-commit` hook; context-budget v2 (PostToolUse, no hand-off); `run-gates.sh` with counted gates, `check-agent-docs.mjs`, `codex-run.mjs`, `command-guard.mjs`, the review workflow; manifest and markers replace stamps |
| 3 | 2.2.3-js.3 | the cost study's lineup (`gate-design.md` › Review lineup): per-slice review by the second family, one Opus code-reviewer per unit, lane B inside the adversarial pass (the Opus auditor is the fallback), `database-reviewer` on migrations only, the language lens folded into the code-reviewer, `pr-test-analyzer` on Sonnet; fix rounds by `review-gate.mjs` — P3s to one sweep, re-reviews over the fix diff, at most two Opus rounds; `docs-drift.mjs` (8a) and `unit-record.mjs` (8b), claim audit on product claims; the state file's shape; `effort: high` and the Tool discipline section in every agent; `/clear` + resume at owner waits; the milestone split; six Cost rules; the log's *Yield by source*; hazards `agent-effort-unpinned` and `effort-above-high`. Generated blocks and agents from v2 are replaced or get section proposals |
| 4 | 2.2.3-js.4 | owner questions by class (`gate-design.md` › Who decides): P and C asked as decision cards, T decided and listed at Gate 2 as *Decided for you*, H turned into rules; the decision row's `Class` and `Reversal cost`; deliverables with `Demo:` lines, one per coordinator context; the second family as the first builder of cold work and fixes, `--writer` required on every `review-gate.mjs` kind (claude, codex, sonnet or mixed), the `executor:` override; the sandbox section (`cross-model.md`); `run-gates.sh` result reuse by tree, single-flight lock and instant-fail note; `unit-cost.mjs` and `estimate.mjs`; the log's Deliverable, Owner wait and Cost columns and a `unit-record.mjs` row that fits them; three rules (owner decides only the owner's, never re-run a passed tree, deliverables); hazard `agent-model-unpinned`. Generated blocks, agents and scripts from v3 are replaced or get section proposals; the policy and gate-table blocks are `reviewed`, so their rows are proposals the owner re-reviews |
| 5 | 2.2.3-js.5 | step markers (`unit-step.mjs`), `unit-cost.mjs --times` and `--by-step`, `unit-record.mjs --steps`; the learning loop: `retro.mjs` and `run-sources.mjs`, Phase E's weekly retro and Phase F, the skill's own `retro-weekly.mjs` (`learning.md`); the context defaults (`context.md`): the budget hook warns at 220K, sits 40K under the auto-compact window, says nothing after a compaction until the next reply, and past 150K sends an owner gate as text; `check-agent-docs.mjs`'s base and citations checks (its ninth and tenth); due-checks at steps 0 and 9 (`harness-due.mjs`), the P3 batch and the hygiene unit (`hygiene.md`); the machine sweep (`machine.md`, the skill's own script) and the optional leftover-processes hook; `run-counted.mjs` behind every counted gate, `run-gates.sh --snapshot` and its colour strip; the edit guard; the tests of the guards, the budget hook and `run-gates.sh`, shipped to `scripts/lib/` and run by the counted `harness` gate; `unit-stack.sh`; a `Traps:` line in every brief; the Intake type (`intake.md`, `intake.mjs`: unit 1's Gate 1 automatic while its approved Scope block is unchanged); per-host models (`.agents/harness-models.json`, `harness-host.mjs`), `claude-run.mjs` as the second family under another host, `.codex/agents/<name>.toml` where Codex is a target; hazards `preflight-missing`, `sweep-overdue`, `retro-overdue`, `hygiene-overdue`, `p3-queue-aging`, `host-models-missing` and `second-family-absent`. Generated blocks, agents and scripts from v4 are replaced or get section proposals |
| 2 · foundation | 2.2.1-js.11 | the foundation stage for repositories that are documents only (`foundation.md`): manifest `stage` and `flipAfter`, hazard `foundation-stage-has-tests`; the rules block copied from `templates/agents-rules.md`; Phase C fits the project's tooling, lets project rules tighten tiers, and ends with a fresh-agent review of the install. Additive — `skillVersion` stays 2 |

`[M]` **Skipping versions.** An install takes every row above its manifest's
`skillVersion` in one upgrade — a v3 install the v4 and v5 rows, a v2 install the v3
row as well — on one sheet, never one upgrade per version. A component more than
one row changed gets one sheet row, proposed from the current template; its older
form is never installed on the way. What a skipped row changes in a block the
manifest records as `reviewed` (the policy; the gate table where the owner reviewed
it) reaches the owner as proposals; v4's log columns (Deliverable, Owner wait,
Cost) and decision-row columns (`Class`, `Reversal cost`) are structure the
scaffolds gain. An install
with no manifest starts from the fingerprints (Step 1): its entries are `legacy`,
and the current core table names what is `missing`. The upgrade ends as an install
does: the repository registered for the weekly job (`learning.md` › The weekly job),
`harness-due.mjs` and `harness-host.mjs` run once, and the manifest written at
`skillVersion` 5.
