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
- **template state** — on each entry generated from a template: `current`, `newer`
  (the skill changed the template since the entry was written), `gone` (the skill
  no longer ships it), `unrecorded` (no `templateSha256`) or `invalid`, counted on
  one line of the text report;
- **markers** — every `harness:begin` / `harness:end` pair in `AGENTS.md` and
  `CLAUDE.md`, and whether it balances;
- **sizes**, **id prefixes** in use (`DEC-`, `D-`, `D<n>`, `Q-`, counted outside
  harness blocks) and **held registry rows**;
- **hazards** — by id, with the file and line.

Run it without `--text` for JSON. `--hash <path>[#block]` prints the hash the
manifest records for a file or block. `--base <path>[#block]` prints the template
an entry was generated from, the version its `templateSha256` names, found in the
skill's git history: the base of Step 2's merge (for a block, its whole template). A
plugin cache is a shallow clone that holds one commit, so there pass
`--history <a full clone of the skill repository>`.

`[M]` Quote its output at the top of the sheet. A lineage judged by eye misses the
install that names its runner something else — and the script misses what it does
not fingerprint, so read the repo too.

## Step 2 — the decision sheet, before anything is written

`[M]` **One table, one owner round:**

```
| Path[#block] | Lineage | Status | Proposed | Default |
```

`Lineage` is the mode the row belongs to (`plan`, `change`, or `core` for both);
hazard rows carry `—`. `Default` is one of `replace · merge · keep · generate · ask ·
wait`.

| Status | Proposed | Default |
|---|---|---|
| `unchanged` or `edited`, template `newer` | the three-way merge below, listing the template's hunks | **merge** when clean; **ask** on a conflict, both sides shown |
| `unchanged` or `edited`, template `current` | nothing: the template has not changed since; say so | keep |
| `unchanged` or `edited`, template `unrecorded` or `invalid` | no base to merge from: the file against the current template with this project's bindings, section by section | ask |
| `unchanged` or `edited`, template `gone` | what the version row says took its place; the entry dropped once the owner agrees | ask |
| `unchanged` (generated from a reference, hash matches) | where a version row since the manifest's `skillVersion` names the reference: the block regenerated, and its diff against the file, in which a hunk the reference change does not explain is a project fix the hash folded in and stays; otherwise nothing, and say so | **replace** where the reference change explains every hunk, else **ask** |
| `edited` (generated from a reference, hash differs) | where a version row names the reference: the block regenerated, and its diff against the file, in which a hunk the reference change does not explain is a project edit and stays; otherwise the edit, section by section, against the block as the manifest's commit wrote it (`git show <that commit>:AGENTS.md`), since only a hash is stored | **ask** where a version row names the reference, else **keep** |
| `reviewed` (policy, risk map, earned rules) | nothing, or a section-level suggestion | keep |
| `scaffold` (registry, log, follow-ups, decision log) | nothing; add a column only if the newer format needs it | keep |
| `ignored` (a gitignored scaffold absent here, e.g. the registry in a fresh clone) | nothing | keep |
| `legacy` (no manifest) | section-level proposals only | **keep** |
| `missing` | the file, newly generated | generate — but **ask** for rows that depend on Phase B (policy, risk map, merge policy, `CODEOWNERS`) and route them there |

`[M]` **A file generated from a template is merged, never regenerated.** Its
`sha256` folds in every fix the project made before the manifest was written, so
`unchanged` does not mean "as the template wrote it", and a replace drops those
fixes. The merge is three-way: the file, its base (`--base`) and the current
template. Format the base and the current template as the project formats the file
first (prettier: `npx prettier --stdin-filepath <path>`), and give both the file's
own date in place of `generated YYYY-MM-DD`: a formatter that reflowed the file
would otherwise make every line an edit, and a stamped date conflicts with any
header line the template changed beside it:

```
node <skill dir>/scripts/harness-status.js <repo> --base <path> > base
cp <skill dir>/<template> theirs   # then format both as <path> is, and give both its date
git merge-file -p <path> base theirs > merged
```

Exit 0 is a clean merge. A conflict marks both sides: where the template now carries
the project's own fix, take the template's side, and keep behaviour only this
project has as a binding or a rule. Where it marks a binding the project set, keep
the project's value and take the template's lines around it: git marks a change on
the line beside another change as a conflict.

A block entry merges on the block alone. `--base AGENTS.md#rules` prints the whole
template, so cut the block, its marker lines included, out of the file, the base and
the current template, merge the three cuts, and put the merged block back in place of
the file's. The text around the block is the project's and stays out of the merge:

```
node <skill dir>/scripts/harness-status.js <repo> --base AGENTS.md#rules > base
cp <skill dir>/templates/agents-rules.md theirs   # then format both as AGENTS.md is
for f in AGENTS.md base theirs; do sed -n '/<!-- harness:begin rules -->/,/<!-- harness:end rules -->/p' "$f" > "$f.block"; done
git merge-file -p AGENTS.md.block base.block theirs.block > merged.block
```

`[M]` **Without a manifest, build the `missing` rows yourself:** compare the repo
against the Phase C core table and the mode's set in `SKILL.md`. A component the
project already wrote its own way (its own lint, its own verify runner) is a
`legacy` keep row with a section-level proposal, not `missing`.

Every hazard gets a row too, with its fix as the proposal and `ask` as the
default. Anything that blocks applying — a held registry row, an open unit —
gets a `wait` row.

`[M]` **The base gets a row of its own.** Regenerated blocks and new rules add bytes
every session loads, and the agent-docs lint's `base` budget is a ratchet. Read the
base now (`node scripts/check-agent-docs.mjs --base`) and add what each regenerated
block adds. Where the total passes the budget, the row proposes moving text out of
the base (rationale to `docs/harness/rule-origins.md`, area rules to path-scoped
files: `harness-targets.md` › Keeping the instruction files small), or raising the
budget on the owner's word. A rule the project already states keeps its own words
and cites them in place of its why clause (`rules.md` §1). Never trim a shipped rule
to fit.

`[M]` **A legacy policy needs one owner confirmation** before it counts as
reviewed; then its status line reads `REVIEWED <date> (adopted)`. Nobody can know
whether an unstamped policy was ever read. Recognise one by what it governs, not
its heading: a never-auto section, a hot-modules or critical-code table that keys
review or merging, a locked-decisions list. Where it spans two files, the status
line goes above the copy in the harness file and the other links to it. Adopting it
in place wraps the legacy text in `policy` markers where it stands, and the
manifest records that block as `reviewed`; until it is wrapped, the status line is
its only record, and the sheet says so. No policy at all → Phase B, its rows `ask`.

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

`[M]` **Cores that import each other land together.** A core that imports another
(`import … from './<core>.mjs'`) is applied in the same change as that core: read
the imports of every core the sheet changes. Two sets do today: `unit-step-core`,
`unit-record-core`, `estimate-core`, `retro-core`, `retro-gather`,
`harness-due-core`, `unit-cost-core` and `run-sources`; and `harness-host-core`,
`review-gate-core` and `claude-run-core`. Applied one by one, a script run in
between fails on a name the newer core imports.

`[M]` **A scaffold gains a column in place.** A column the newer format adds goes
into the project's own table, where `log-format.md` places it: the header, the
separator and an empty cell in every row already there, never a second table. Then
bind the readers to the header as it now reads: `LOG_COLUMNS` in
`unit-record-core.mjs` (its names, in order), `COLUMNS` in `estimate-core.mjs` and
`EXTRA_COLUMNS` in `retro-core.mjs` (each a prefix of its column's name). A header
the project renamed keeps its names, and the bindings follow it.

`[M]` **The ignored paths are checked too.** Each path Phase C ignores (`SKILL.md`,
the `.gitignore` row) must read as ignored: `git check-ignore -q <path>` exits 0 for
the registry, `.review-work/x` and the ledger directory of each wrapper the project
runs (`.codex-runs/x`, `.claude-runs/x`: a directory by a path inside it, since git
reads an absent directory's bare name as not ignored). One that does not is a
`missing` row: the next `git add -A` commits it.

`[M]` After applying, write `.agents/harness-manifest.json` and commit it with the
change (then register the repository for the weekly job, `learning.md` › The weekly
job):

```json
{ "schema": 1, "skill": "harness-bootstrap", "skillVersion": 6, "generated": "<date>",
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

`[M]` **A kept row keeps its old hashes.** A `keep` row's `sha256` and
`templateSha256` stay as the old manifest recorded them. Re-hashed, a kept edit
reads `unchanged` and the next upgrade regenerates over it; a `templateSha256` moved
to the current template makes the next merge read the template's changes as the
project's reverts, and keep them. A merged row records the template it merged in
(`templateSha256`) and the merged file (`sha256`); a replaced or generated row is
hashed fresh.

`[M]` **Entries no template covers.** A harness file the project wrote itself in
place of a template (its own agent-docs lint, its own runner) is a `reviewed` entry
with no `template`: an upgrade proposes section-level changes and never merges into
it. An entry whose file the project deleted reads `missing`: ask whether to generate
it again or drop the entry. A renamed file moves its entry, `template` and
`templateSha256` included, to the new path.

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
| `skill-link-drift`, `skill-unlinked` | one real file under `.agents/skills/`, a committed relative symlink under `.claude/skills/` — unless the two copies are deliberate per-agent wrappers over one shared script (`harness-targets.md`); then keep both and say so. A directory becomes the symlink in two commits, the removal and then the link, where a pre-commit tool such as lint-staged stashes the tree; a copy serves where the project refuses committed symlinks |
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
| `host-models-missing` | write `.agents/harness-models.json` from `templates/harness-models.json`, with an entry for each host the project runs on (the hosts it lists), not for every manifest target (`gate-design.md` › Model and effort); step 0 reads it through `harness-host.mjs`, which flags the session's own host |
| `second-family-absent` | name the host's second family in the models file and install its wrapper — `codex-run.mjs`, or `claude-run.mjs` under a host other than Claude Code (`cross-model.md`); until then every cross-family pass on that host is `degraded`. A host the project never runs on is an entry to drop: the template lists every host |
| `preflight-missing` | run the phase preflight for the phase under way (`preflight.md`) and commit its report at `REPORTS.preflight` in `harness-due-core.mjs` (default `docs/harness/reports/preflight-<phase>.md`); its escalations go to the next Gate 1 |
| `sweep-overdue`, `retro-overdue`, `hygiene-overdue` | install `harness-due.mjs` where it is absent (steps 0 and 9 run it), commit each report at `REPORTS.<kind>` in `harness-due-core.mjs` (default `docs/harness/reports/<file>`) — never a gitignored directory — and make the overdue one the next unit |
| `p3-queue-aging` | a hygiene unit: its P3 batch takes the oldest cold-code rows, each re-verified against the mainline first (`hygiene.md`). Follow-ups spread over many files are bound or merged into one doc first |
| `foundation-stage-has-tests` | the pass-signal unit landed and the flip did not run: claim the flip as a `harness/` unit (`foundation.md`) |

## Version table

What each skill version changed, so an upgrade knows what is new since the
manifest's `skillVersion`. An install with no manifest is v1 or earlier.

`[M]` **A reference change takes a version.** Once an install holds a version, a
release that changes a reference an entry is generated from, or what an installed
script decides, takes the next version and a row here. The template state (Step 1)
reads templates only, so the row is the only record that a reference-generated
entry is stale, and the sheet's list of what the owner reviews again.

| Version | Shipped in | Changed |
|---|---|---|
| 0 | before this skill | change installs written by hand (a tiered change workflow, cross-check lanes, a verify runner): everything in v2 is new to them except what the fingerprints show |
| 1 | up to 2.2.1-js.4 | plan mode only: task runner, commit guard (repo-wide lock), two gates, conformance and claim auditors, registry, harness log, context-budget hook (Stop + UserPromptSubmit, recommended a new session), first-line stamps |
| 2 | 2.2.1-js.5 | change mode beside plan mode; task types; tiers Trivial · Small · Full (Standard became Small); risk map and merge policy in Phase B; scope guard, decision log and committed state file; lane B `blast-radius-auditor`; test honesty in the claim auditor; guard `SCOPE=repo\|checkout` with Branch-cell matching, case-insensitive ids and a `pre-merge-commit` hook; context-budget v2 (PostToolUse, no hand-off); `run-gates.sh` with counted gates, `check-agent-docs.mjs`, `codex-run.mjs`, `command-guard.mjs`, the review workflow; manifest and markers replace stamps |
| 3 | 2.2.3-js.3 | the cost study's lineup (`gate-design.md` › Review lineup): per-slice review by the second family, one Opus code-reviewer per unit, lane B inside the adversarial pass (the Opus auditor is the fallback), `database-reviewer` on migrations only, the language lens folded into the code-reviewer, `pr-test-analyzer` on Sonnet; fix rounds by `review-gate.mjs` — P3s to one sweep, re-reviews over the fix diff, at most two Opus rounds; `docs-drift.mjs` (8a) and `unit-record.mjs` (8b), claim audit on product claims; the state file's shape; `effort: high` and the Tool discipline section in every agent; `/clear` + resume at owner waits; the milestone split; six Cost rules; the log's *Yield by source*; hazards `agent-effort-unpinned` and `effort-above-high`. Generated blocks and agents from v2 are replaced or get section proposals |
| 4 | 2.2.3-js.4 | owner questions by class (`gate-design.md` › Who decides): P and C asked as decision cards, T decided and listed at Gate 2 as *Decided for you*, H turned into rules; the decision row's `Class` and `Reversal cost`; deliverables with `Demo:` lines, one per coordinator context; the second family as the first builder of cold work and fixes, `--writer` required on every `review-gate.mjs` kind (claude, codex, sonnet or mixed), the `executor:` override; the sandbox section (`cross-model.md`); `run-gates.sh` result reuse by tree, single-flight lock and instant-fail note; `unit-cost.mjs` and `estimate.mjs`; the log's Deliverable, Owner wait and Cost columns and a `unit-record.mjs` row that fits them; three rules (owner decides only the owner's, never re-run a passed tree, deliverables); hazard `agent-model-unpinned`. Generated blocks, agents and scripts from v3 are replaced or get section proposals; the policy and gate-table blocks are `reviewed`, so their rows are proposals the owner re-reviews |
| 5 | 2.2.3-js.5 | step markers (`unit-step.mjs`), `unit-cost.mjs --times` and `--by-step`, `unit-record.mjs --steps`; the learning loop: `retro.mjs` and `run-sources.mjs`, Phase E's weekly retro and Phase F, the skill's own `retro-weekly.mjs` (`learning.md`); the context defaults (`context.md`): the budget hook warns at 220K, sits 40K under the auto-compact window, says nothing after a compaction until the next reply, and past 150K sends an owner gate as text; `check-agent-docs.mjs`'s base and citations checks (its ninth and tenth); due-checks at steps 0 and 9 (`harness-due.mjs`), the P3 batch and the hygiene unit (`hygiene.md`); the machine sweep (`machine.md`, the skill's own script) and the optional leftover-processes hook; `run-counted.mjs` behind every counted gate, `run-gates.sh --snapshot` and its colour strip; the edit guard; the tests of the guards, the budget hook and `run-gates.sh`, shipped to `scripts/lib/` and run by the counted `harness` gate; `unit-stack.sh`, bound to the commit guard's registry path; a `Traps:` line in every brief; the Intake type (`intake.md`, `intake.mjs`: unit 1's Gate 1 automatic while the approved request and its Scope block are unchanged); per-host models (`.agents/harness-models.json`, `harness-host.mjs`), `claude-run.mjs` as the second family under another host, `.codex/agents/<name>.toml` where Codex is a target; `review-gate.mjs --writer` by role on any host (`main`, `bounded`, `second` or `mixed`; on Claude Code `claude`, `sonnet` and `codex` still name them) and `--host`, and its P3 decision `p3-batch` (was `sweep`); hazards `preflight-missing`, `sweep-overdue`, `retro-overdue`, `hygiene-overdue`, `p3-queue-aging`, `host-models-missing` and `second-family-absent`. Generated blocks, agents and scripts from v4 are replaced or get section proposals |
| 6 | 2.2.3-js.8 | the fixes from the v5 installs. The guards refuse what v5 let through: `push --no-verify`, a hook path set through the environment, `git` behind `command`, `exec` or `time`, a second-family run sent to the background with `&` (built-in rule `codex-background`), an indented patch header, every env-file form, and in either scope the merge of a branch that still holds a row; each hook file runs the guard first and passes its refusal on. The review gate reviews tests and the harness's instruction files (a unit of only those under a critical path at the full tier), and a P3 batch over critical code gets the Opus reviewer. `run-counted.mjs` fails a test file that registered no tests and forwards a stop signal; `run-gates.sh` keys reuse on `NODE_OPTIONS`; `unit-cost.mjs` counts a streamed message by its fullest copy and both run ledgers by the unit's worktree; the retro warns where a figure reads zero for a fixable reason, dates rows past re-indents and moves, and reads the follow-ups' columns as bound; step ids take one `/`; the FULL verify ends step 8a; `codex-run.mjs` keeps `max` behind `--allow-max`; each CLI in `scripts/` takes `--help`, and `check-agent-docs.mjs` refuses an argument it does not know; `harness-status.js` reports each entry's template state and prints its base (`--base`). Template-backed entries from v5 merge three-way (Step 2); the rest of an upgrade to v6 is in *Upgrading to v6* below |
| 2 · foundation | 2.2.1-js.11 | the foundation stage for repositories that are documents only (`foundation.md`): manifest `stage` and `flipAfter`, hazard `foundation-stage-has-tests`; the rules block copied from `templates/agents-rules.md`; Phase C fits the project's tooling, lets project rules tighten tiers, and ends with a fresh-agent review of the install. Additive — `skillVersion` stays 2 |

`[M]` **Skipping versions.** An install takes every row above its manifest's
`skillVersion` in one upgrade — a v5 install the v6 row, a v3 install the v4 to v6
rows, a v2 install the v3 row as well — on one sheet, never one upgrade per version. A component more than
one row changed gets one sheet row, proposed from the current template; its older
form is never installed on the way. What a skipped row changes in a block the
manifest records as `reviewed` (the policy; the gate table where the owner reviewed
it) reaches the owner as proposals; v4's log columns (Deliverable, Owner wait,
Cost) and decision-row columns (`Class`, `Reversal cost`) are structure the
scaffolds gain, in place (Step 3). An install
with no manifest starts from the fingerprints (Step 1): its entries are `legacy`,
and the current core table names what is `missing`. The upgrade ends as an install
does: the repository registered for the weekly job (`learning.md` › The weekly job),
`harness-due.mjs` and `harness-host.mjs` run once, and the manifest written at
`skillVersion` 6.

### Upgrading to v6

`[M]` **What regenerates.** An entry generated from a reference v6 changed is
regenerated and diffed (Step 2): `docs/harness/rule-origins.md` (`rules.md` §1; it
opens with a line saying a bare `<name>.md` it cites is this skill's reference), the
`context` block (`context.md`; its Tool discipline section is unchanged, so the
agents' copies stand), the `scope` block (`scope-guard.md`), the blocks Phase C
writes from `gate-design.md`, the runner skill and the implementer agent
(`runner.md`), the claim auditor (`claim-auditor.md`), `CLAUDE.md`
(`harness-targets.md`), and a preflight, sweep or hygiene skill the project
generated (`preflight.md`, `sweep.md`, `hygiene.md`). The `rules` block comes from
a template (`templates/agents-rules.md`, 8 bytes longer): where the manifest records
that `template`, the block reads `template newer` and merges as Step 2 merges a
block; where it records none, the block is regenerated and diffed with the rest.
Where Codex is a target, each regenerated agent's
`.codex/agents/<name>.toml` takes the new brief as `developer_instructions`, with
`model` and `model_reasoning_effort` still from the models file
(`harness-targets.md` › Codex). The lane A and lane B auditors stand, and their
Codex files with them. The risk map is `reviewed`, so the one list of the harness's
own critical paths (`policy-derivation.md`) reaches the owner as a proposal. On a
ZCode host the command and edit guards wire into `.zcode/config.json`, with
`hooks.enabled: true` (`harness-targets.md` › ZCode): a `missing` row where the
project has not wired them. The registry keeps its columns: the guard finds
`Branch` and `Worktree` by name, so a `Task` column stays.

`[M]` **New bindings, each defaulting to v5's behaviour but two.** `MAINLINE` in the
commit guard (`main`); `CODEX_CANDIDATES` in `codex-run-core.mjs` (`.local/bin/codex`
under the home directory, tried before `codex` on `PATH`; `CODEX_BIN` still comes
first); `TIER_WORDS` in `estimate-core.mjs` (`trivial`, `hot-small`, `small`, `full`,
`docs`); `STATUS_COLUMNS`, `STATUS_WORDS`, `SEVERITY_COLUMNS` and `FILED_AT` (`null`,
off) in `retro-core.mjs`; `INSTRUCTIONS` in `review-gate-core.mjs` (`AGENTS.md`,
`CLAUDE.md`, `.claude/`, `.agents/`, `.codex/` and `.zcode/`, reviewed as code
whatever `NON_PRODUCTION` says); `LOG_COLUMNS` in `unit-record-core.mjs` (the header
in `log-format.md`). The two: v5 ran `codex` from `PATH` (bind `CODEX_CANDIDATES` to
`[]` to keep that), and v5 skipped the instruction files as docs, which v6 reviews
(*What the owner reviews again*). `FOLLOW_UPS` may now be a list, `PHASE_OF` a
function from a row id to its phase or `null`, and a project rule in the command
guard reads `env` and `background` too. Bind each where the project differs:
`MAINLINE` to its mainline, `LOG_COLUMNS` to its log's header.

`[M]` **The shipped tests bind their own values.** The tests of the command guard,
the budget hook, the commit guard, the due-checks, the review gate and the records
hold a `[B]` block of the values the file they test is bound to (`EXPECTED`,
`HOOK_FILES`, `EXPECTED_CRITICAL` and the like), and the estimate and retro tests
build their fixtures from the core's bindings. A test the project edited only to
re-pin its bound values takes the template's test, its `[B]` block bound to the
same values; those re-pins are where its merge conflicts.

`[M]` **Where else the merge conflicts.** Where the project set the binding: the
commit guard's `SCOPE` (`MAINLINE` follows it) and its test's `MERGE_GUARD`
(`HOOK_FILES` follows it); the edit guard's `PROTECTED` (its env pattern changed:
keep the project's entries, take the pattern); `check-agent-docs.mjs`'s `budgets`,
`statePattern` and `pathPrefixes`; `docs-drift-core.mjs`'s
`IGNORE_TOKENS` (`bun.lock`) and `GENERIC` (`decide`); `estimate-core.mjs`'s
`TIERS`; `harness-due-core.mjs`'s `MAIN`, `PHASE_OF` and `COMMANDS` (whose defaults
now name the reference that holds each procedure); `harness-host-core.mjs`'s
`MODELS_FILE`; `retro-core.mjs`'s `REPORTS_DIR` and `PLANS_DIR`;
`review-gate-core.mjs`'s `TESTS`; `unit-record-core.mjs`'s `MAX_COMMITS`. Every
budget key is present after the merge, a number or `null` (off): a `CONFIG` from
before v5 has no `base`, so set it or make it `null`.

`[M]` **What the owner reviews again.** A unit of only tests or instruction files is
reviewed, no longer skipped, and at the full tier under a critical path;
`--writer bounded` covers Opus and Sonnet together, and `mixed` means the second
family wrote part of it. The commit guard refuses, in either scope, the merge of a
branch that still holds a row: the runner releases first (`commit-guard.md` › Land
order). The edit guard refuses `.envrc`, `prod.env` and the other env-file forms. A
second-family run goes to the background by the host's own option, never `&`.
`run-counted.mjs` fails a test file that registered no tests, which it used to count
as a pass. A run under another `NODE_OPTIONS` is not reused. Cost with subagent work
reads higher, since a streamed message counts by its fullest copy, and both run
ledgers count the unit's worktree only. `codex-run.mjs` runs `max` as `xhigh` unless
`--allow-max` is given. `check-agent-docs.mjs` exits 2 on an argument it does not
know, so a gate that passes one fails until it goes. The FULL verify ends step 8a,
so its time moves from step 8 to 8a in the by-step figures: compare the two steps
together across the upgrade. Once per machine, run `retro-weekly.mjs --install`
again (`learning.md` › The weekly job), so the job carries `CODEX_HOME`.
