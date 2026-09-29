---
name: skill-advisor
description: Recommend, install, refresh or remove ECC library skills, agents and commands for the current project, based on its Claude Code and Codex sessions and its docs (PRD, TRD, specs, plans). Use when starting a project, after new planning docs land, or to review the project's ECC library items.
---

# Skill Advisor

Picks ECC library items for one project and installs them as project-local copies:
skills into `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex, ZCode), agents
and commands into `.claude/` (Claude Code only). Core ECC items are always loaded by the
plugin and are never installed here.

## When to Use

- A new project has a PRD, TRD, spec or plan and no library items yet.
- New planning docs were written, or the work in a project has shifted.
- The plugin was updated and installed copies may be outdated.
- A library item seems unused in this project and could be removed.

## How It Works

The scripts are in the `scripts/` folder next to this file. In Claude Code that is
`${CLAUDE_PLUGIN_ROOT}/skills/skill-advisor/scripts`; in Codex, use the folder this
`SKILL.md` was read from.

1. **Collect evidence.** Run from the project root:

   ```bash
   EVIDENCE="$(mktemp -d)/evidence.json"
   node "<scripts>/collect.js" --project "$PWD" --out "$EVIDENCE"
   ```

   Read the evidence file. It holds `sessions` (prompts, ECC usage, touched files,
   docs written), `docs` (planning docs, capped), `stack` (dependencies, lockfile,
   configs), `catalog` (every library item with its description) and `state`
   (installed items with a status, and declined items).

2. **Report installed items first.** List each installed item whose status is not
   `current`: `outdated` (library has a newer version), `modified` (edited by hand),
   `missing` (a copy was deleted), `gone` (no longer in the library).

3. **Match evidence to the catalog.** Propose only what the evidence supports:
   - **add**: a catalog item fits the project. Cite the evidence: a doc and the line
     that shows the need, or session counts ("4 sessions edited migrations").
   - **remove**: an installed item with no use in `sessions.usage` and nothing in the
     docs or stack that needs it.
   - **refresh**: every `outdated` item; `modified` items only if the user agrees to
     overwrite their edit.
   - Do not propose items in `state.declined` unless evidence newer than the decline
     date supports them; say what changed.
   - Propose at most 8 additions. Fewer, well-supported items beat many weak ones.
   - If `sessions.unavailable` lists a harness, say its sessions were not read.

4. **Show the plan as a table** (action, item, evidence) and wait. The user approves,
   edits or rejects each row. Rejected additions become `decline` entries.

5. **Apply.** Write the approved plan to a file, dry-run it, show the output, then run it:

   ```bash
   PLAN="$(mktemp -d)/plan.json"
   # write the approved plan JSON to "$PLAN"
   node "<scripts>/install.js" --project "$PWD" --plan "$PLAN" --dry-run
   node "<scripts>/install.js" --project "$PWD" --plan "$PLAN"
   ```

6. **Report** what changed and any `WARN` lines, and remind the user to commit
   `.claude/` and `.agents/` (including `.claude/skill-advisor.json`). New skills are
   picked up by new sessions.

### Plan file format

```json
{
  "add": [{ "kind": "skill", "name": "postgres-patterns" }],
  "refresh": [{ "kind": "agent", "name": "a11y-architect", "overwrite": true }],
  "remove": [{ "kind": "command", "name": "plan-canvas" }],
  "untrack": [],
  "decline": [{ "kind": "skill", "name": "redis-patterns" }]
}
```

`kind` is `skill`, `agent` or `command`. `untrack` forgets an item but keeps its files.
The installer never overwrites a file it did not install, and only deletes paths recorded
in `.claude/skill-advisor.json`.

## Examples

**New project with a PRD.** `docs/prd.md` says "PostgreSQL with Prisma, deployed on Bun".
No sessions yet. Proposed: add `postgres-patterns` (prd.md line 12), add `prisma-patterns`
(prd.md line 12, `prisma` in package.json), add `bun-runtime` (prd.md line 30, `bun.lock`).

**Existing project.** 40 sessions, `postgres-patterns` installed but unused in 30 days and
the docs moved to SQLite. Proposed: remove `postgres-patterns` (no usage; docs/adr-7.md
line 4 replaces Postgres with SQLite).

**After a plugin update.** `postgres-patterns` is `outdated`. Proposed: refresh it.
