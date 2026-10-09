# Library tiers and skill-advisor: design

Date: 2026-09-29. Status: approved in conversation, pending written-spec review.
Branch: `slim/library-tiers`.

## Why

- The fork ships 140 skills, 36 agents and 66 commands to every project in
  Claude Code, Codex and ZCode. Their name and description listing costs about
  12.8k tokens per session.
- Claude Code caps the skill listing at 1% of the context window. When it
  overflows, it drops descriptions starting with the least-invoked skills. In a
  live session most `ecc:*` skills, and other plugins' skills such as `expo:*`,
  showed no description, so rarely used skills can never be matched to a
  request.
- Usage over the last 30 days: 17 distinct ECC items were used in Claude Code
  (275 invocations). Codex read 3 ECC skills (`agent-self-evaluation` 66,
  `latency-critical-systems` 14, `terminal-ops` 2). grobiz and rentalae
  reference about 30 `ecc:` names in `CLAUDE.md`, `change-workflow` and
  `task-runner`.
- Claude Code cannot hide single plugin skills per project: `skillOverrides`
  does not apply to plugin skills (docs: skills.md, "Override skill
  visibility"). A per-project surface therefore has to be project-local copies.

## Goals

1. A small core plugin (about 54 items) loaded everywhere.
2. A user-curated library of items that ship inside the plugin but are not
   loaded, installable per project.
3. `skill-advisor`: reads a project's sessions and docs, proposes library items
   to add, remove or refresh, and installs them after approval.
4. Own items no longer need the `biji-` prefix; a name-collision check against
   upstream protects them instead.

## Non-goals

- No live per-prompt suggestion hook. Session analysis after the fact covers it
  without adding an always-on hook.
- No changes to ECC's upstream installer (`scripts/install-*.js`,
  `scripts/lib/install-targets/*`).
- No per-project Codex agents or commands (the Codex plugin has none).

## Section 1: tiers and the `library/` folder

### Data

`fork/slim.json` gains a `library` array for `skills`, `agents` and `commands`,
next to `keep`, `drop`, `own` and `pinned`.

- An item is in exactly one of `keep`, `library`, `drop`, `own`.
- Every `pinned` item is in `keep`.
- `verify.js` fails on a violation of either rule.

### Layout

| Kind | Upstream path | Library path |
| --- | --- | --- |
| Skill | `skills/<n>/**` | `library/skills/<n>/**` |
| Agent | `agents/<n>.md` | `library/agents/<n>.md` |
| Command | `commands/<n>.md` | `library/commands/<n>.md` |

No harness scans `library/`: the Claude plugin loads `./skills/`,
`./commands/` and `agents/`; the Codex plugin loads `./skills/`. The folder is
still present in the installed plugin directory, so the advisor can copy from
it.

### Sync and apply

In `fork/bin/lib/config.js` and `fork/bin/lib/apply.js`:

- Library names join `removedNames`, so the upstream path is in the drop set and
  `git rm`'d, together with its `.agents/skills/<n>` mirror and any upstream
  test whose triggers are all non-kept (existing `tests.drop` logic).
- Library names join `knownNames`, so they are never queued as new.
- `applyDecisions` gets a step "materialise library": for each library item,
  delete `library/<kind>/<n>` and write every file of `<ref>:<upstream path>`
  into it, then stage it. `<ref>` is the upstream ref recorded in
  `fork/state.json`, the same ref used for kept items.
- `library/**` is added to `FORK_OWNED`, so a merge restores it from HEAD before
  `applyDecisions` refreshes it. In effect `library/` is generated: never
  hand-edit it.

### Queue, inventory, checks

- `queue.js` `pruneDecided` treats a `library` name as decided. `queueHints`
  accepts a `library` suggestion.
- `inventory.js` `diffInventory` reports a library item that disappeared
  upstream as GONE (library). It does not block the sync; the materialise step
  deletes the stale copy and the report tells the maintainer to drop it from
  `library`.
- `checks.js`:
  - `SHIPPED_PREFIXES` adds `library/`, so library changes need `fork:bump`.
  - `danglingReferences` treats library names as known: a core item that names
    a library item is a warning, not an error.
  - New check `tierExclusive` for the two rules in "Data".
  - New check `libraryMaterialised`: every library name has its library path,
    and `library/` holds nothing that is not in `library`.
- Transforms (`manifests.js`, `overlays.js`, `scripts/ci/catalog.js`) keep
  counting only `skills/`, `agents/`, `commands/`, so counts equal keep + own
  without change. `manifests.js` must not emit install modules for library
  paths.

### Tests (`tests/fork/slim-tooling.test.js`)

- Materialising a library item from a ref, including removal of a stale file.
- Library names are in the drop set for their upstream paths and mirrors.
- Library items are not counted in manifests or README.
- `tierExclusive` fails on an item in two tiers and on an unkept pinned item.
- A `library` decision prunes the queue entry.
- A library item gone upstream is reported and does not block.

## Section 2: own items and the collision check

- `FORK_OWNED` gains the paths of every name in `slim.<kind>.own` (skills,
  agents, commands, rules). The `biji-*` patterns stay for compatibility.
- New collision check: an error if `<ref>` contains `skills/<n>`,
  `agents/<n>.md`, `commands/<n>.md` or `rules/<n>/` for any own name `<n>`.
  - In `sync.js`, it runs before `git merge` against the incoming ref; on
    failure nothing is merged.
  - In `verify.js`, it runs against the ref in `fork/state.json`.
  - The message names the item and says: rename yours, or adopt upstream's by
    moving the name to `keep` and deleting yours.
- `.claude/rules/ecc-js-fork.md` and `FORK.md`: own items go under `own`; the
  `biji-` prefix is no longer required; the collision check protects them.
- Tests: an unprefixed own item is fork-owned; sync refuses a colliding ref;
  `verify.js` reports the collision.
- `skill-advisor` is the first entry in `slim.skills.own`.

## Section 3: skill-advisor

### Files

```text
skills/skill-advisor/
  SKILL.md          workflow the model follows
  scripts/collect.js  evidence collector (deterministic, no network, no model)
  scripts/install.js  plan executor and state keeper
```

Both scripts locate `library/` as `path.resolve(__dirname, '../../../library')`,
so they work from the Claude and the Codex plugin directories without
environment variables. CommonJS, Node >= 18, no dependencies.

### collect.js

`node collect.js --project <dir> [--out <file>]` writes one JSON evidence file:

1. `sessions`
   - Claude Code: `~/.claude/projects/<encoded dir>*/*.jsonl`, where the encoded
     prefix matches the project and its worktrees (for example
     `.worktrees/*`).
   - Codex: `~/.codex/sessions/**/*.jsonl` whose `session_meta` `cwd` is inside
     the project.
   - ZCode: included only if step 0 finds a readable transcript store;
     otherwise the file says `zcode: not available`.
   - Extracted: the last 300 user prompts (each cut to 300 characters), ECC item
     usage (Skill and Agent tool calls, `ecc:` slash commands, Codex reads of
     `skills/<n>/SKILL.md`), files touched, and `.md` files created or edited.
2. `docs`: `docs/**/*.md`, files matching `*prd*`, `*trd*`, `*spec*`, `*plan*`,
   `.claude/plans/**`, `CLAUDE.md`, `AGENTS.md`, `README.md`, plus the session
   `.md` files from (1) that still exist. Each doc is capped at 8 KB and the
   total at 200 KB; the file lists what was cut.
3. `stack`: `package.json` dependencies, lockfile type, framework config files.
4. `catalog`: kind, name and description of every item in `library/`.
5. `state`: the project's `.claude/skill-advisor.json` if present, with a
   per-item status of `current`, `outdated`, `modified` or `missing`.

### SKILL.md workflow

1. Run `collect.js` for the current project.
2. Report item status: outdated, modified, missing.
3. Match the evidence against the catalog and propose a plan with three
   actions: add, remove, refresh. Every add or remove cites evidence (a doc
   and line, or session counts). Declined items are not proposed again unless
   evidence dated after the decline supports them.
4. Show the plan as a table and wait for the user to approve or edit it.
5. Run `install.js --plan <file> --dry-run`, show the output, then run it
   without `--dry-run`.
6. Report what changed and remind the user to commit `.claude/` and `.agents/`.

### install.js

`node install.js --project <dir> --plan <file> [--dry-run]`. The plan lists
`add`, `remove`, `refresh` and `decline` entries.

Destinations:

| Kind | Claude Code | Codex and ZCode |
| --- | --- | --- |
| Skill | `.claude/skills/<n>/` | `.agents/skills/<n>/` |
| Agent | `.claude/agents/<n>.md` | not installed |
| Command | `.claude/commands/<n>.md` | not installed |

State file `.claude/skill-advisor.json` (committed):

```json
{
  "version": 1,
  "items": [
    {
      "kind": "skill",
      "name": "postgres-patterns",
      "hash": "sha256 of the library copy",
      "paths": [".claude/skills/postgres-patterns", ".agents/skills/postgres-patterns"],
      "pluginVersion": "2.2.1-js.3",
      "installedAt": "2026-09-29"
    }
  ],
  "declined": [{ "kind": "skill", "name": "redis-patterns", "at": "2026-09-29" }]
}
```

Rules:

- A destination that exists and is not in the state file is skipped with a
  warning, never overwritten.
- A copy whose hash differs from the recorded hash is `modified`: refresh
  skips it unless the plan entry says `overwrite`; `untrack` removes it from
  the state file only.
- Remove deletes only paths recorded in the state file.
- `--dry-run` prints every write and delete and changes nothing.
- The hash of a skill is over its sorted relative paths and file contents.

### Tests (`tests/fork/skill-advisor.test.js`)

Against a temp project, a temp `HOME` with fake Claude and Codex session files,
and a temp `library/`:

- collection of prompts, usage, docs, session-created docs, worktrees, stack;
- install into both `.claude/` and `.agents/`;
- skip of an existing untracked destination;
- `modified` detection, `overwrite`, `untrack`;
- refresh and remove;
- `declined` kept across runs;
- `--dry-run` changes nothing.

## Section 4: initial content and the pick

- `fork/bin/pick.js generate` writes `fork/pick.md`: one line per skill, agent,
  command and hook with a tag (`core`, `library`, `drop`), the description and
  the usage signal (use count, external references, required-by).
- `fork/bin/pick.js apply` validates and writes `fork/slim.json`, then deletes
  `fork/pick.md`. It fails, naming the line, if:
  - a pinned item is not `core`;
  - a core item references a `drop` item (for example `react-review`
    references `accessibility`); a reference to a `library` item is only a
    warning, as in Section 1;
  - an `ecc:` name referenced by grobiz or rentalae is not `core`.
- Pre-fill:
  - core, 54 items:
    - agents: security-reviewer, silent-failure-hunter, database-reviewer,
      code-reviewer, typescript-reviewer, planner, react-reviewer,
      pr-test-analyzer, code-architect, code-explorer, tdd-guide,
      refactor-cleaner, e2e-runner, build-error-resolver,
      react-build-resolver, gan-evaluator, gan-generator, gan-planner;
    - commands: plan, plan-prd, prp-plan, prp-prd, prp-implement, prp-commit,
      prp-pr, pr, code-review, build-fix, learn, learn-eval, orch-review,
      update-docs, project-init, gan-design, gan-build, react-review,
      react-build, react-test;
    - skills: verification-loop, e2e-testing, make-interfaces-feel-better,
      design-system, blueprint, continuous-learning, continuous-learning-v2,
      agent-self-evaluation, latency-critical-systems, terminal-ops,
      react-patterns, react-testing, accessibility, frontend-patterns,
      tdd-workflow, plus the own `skill-advisor`.
  - library, 11 items: nextjs-turbopack, bun-runtime, postgres-patterns,
    react-performance, database-migrations, prisma-patterns,
    react-native-patterns, ecc-guide, plan-canvas, a11y-architect,
    code-simplifier.
  - drop: everything else.
  - hooks: keep `pre:bash:dispatcher` and `pre:config-protection`; drop the other
    10. `ecc/setup.json` `hooks.allow` becomes `pre:bash:block-no-verify`,
    `pre:bash:gateguard-fact-force`, `pre:bash:commit-quality`,
    `pre:config-protection`.
- The user edits the tags; the pre-fill is only a starting point.
- `ECC_HOOKS_ENABLED=false` in `~/.claude/settings.json` is outside the fork;
  the user decides separately whether to remove it.

## Section 5: build order and rollout

0. Checks. Stop and redesign if one fails.
   1. ZCode loads a skill from a scratch project's `.claude/skills`.
   2. ZCode stores readable session transcripts (where).
   3. Codex's and ZCode's installed plugin directories contain `library/`
      (test with a local build).
1. Section 1 and Section 2 with tests.
2. Pick: generate, user edits, apply, `fork:apply`.
3. Section 3 with tests.
4. Docs: `docs/ECC-JS.md` (tiers, advisor usage, moving items),
   `FORK.md` (library decisions during sync, regenerating the pick),
   `.claude/rules/ecc-js-fork.md` (prefix rule).
5. `npm run fork:bump`, `npm test`,
   `node fork/bin/verify.js --drift --since origin/main`, markdownlint; commit;
   `git merge --no-ff` into `main`; push.
6. Update the plugin in Claude Code, Codex and ZCode; restart sessions.
7. Pilot on grobiz and on one docs-heavy project with few sessions.

## Success criteria

- ECC listing about 2.5k tokens; `ecc:*` and other plugins' skills show full
  descriptions in a Claude Code session.
- Every `ecc:` reference in grobiz and rentalae resolves.
- `npm test` and the drift check pass.
- The pilot plan cites real evidence for every suggestion; add, refresh and
  remove work in `.claude/` and `.agents/`.

## Check results (Task 0)

Checked 2026-09-29 with ZCode CLI 0.16.9 (`zcode skills list --cwd`, `zcode commands list --cwd`).

- Plugin caches contain the whole repo, including `library/`: yes (Codex cache and
  ZCode marketplace clone both hold `fork/` and `FORK.md`).
- ZCode loads project skills from `<project>/.agents/skills`, not from
  `<project>/.claude/skills`. It does not list project commands from
  `<project>/.claude/commands`, and no project-agent loader was found. Skills are
  already installed into `.agents/skills`, so ZCode is covered for skills; project
  agents and commands are Claude Code only.
- ZCode transcripts: the session store is `~/.zcode/cli/db/db.sqlite` (SQLite).
  `~/.zcode/cli/rollout/model-io-*.jsonl` holds only raw model I/O for a few
  sessions, with no working folder. Reading SQLite needs a dependency, so ZCode
  sessions stay unavailable (`UNAVAILABLE_TOOLS = ['zcode']`).
