# ECC-JS fork rules

This repository is the slim ECC fork `biji-dev/ecc-js`. `CLAUDE.md` and the
other files in `.claude/rules/` are upstream text; these rules take precedence
where they differ. Maintainer guide: `FORK.md`. Scope and install: `docs/ECC-JS.md`.

## Tests

- Run `npm test`. It sets `ECC_HOOK_ALLOWLIST=off`; the fork's `ecc/setup.json`
  hook allowlist otherwise changes hook gating and about 5 upstream hook tests fail.
- For direct runs prefix the variable: `ECC_HOOK_ALLOWLIST=off node tests/run-all.js`
  or `ECC_HOOK_ALLOWLIST=off node tests/hooks/<file>.test.js`.
- Also run `node fork/bin/verify.js --drift --since origin/main` before committing.

## Editing

- Never hand-edit files listed in `fork/slim.json` `derived` (README.md, AGENTS.md,
  plugin manifests, package.json, manifests/*.json, hooks/hooks.json, command
  registry). Change `fork/slim.json` or `fork/bin/transforms/`, then
  `npm run fork:apply`.
- Keep edits to upstream files small; every changed line can conflict on the
  next upstream sync. Prefer fork-owned files (`fork/`, `tests/fork/`, `ecc/`,
  `FORK.md`, `docs/ECC-JS.md`, `biji-*` items).
- Every change that ships (skills, agents, commands, rules, hooks, scripts,
  `ecc/`, MCP configs, plugin manifests) needs `npm run fork:bump`.
- New own skills, agents, commands and rule packs use the `biji-` prefix and
  are listed under `own` in `fork/slim.json`.

## Git

- Work lands on `main` directly or through `sync/*` and `slim/*` branches merged
  locally with `git merge --no-ff`. No PRs to upstream affaan-m/ECC.
- Never push `upstream/v*` tags and never use `git push --tags`.
- `.github/workflows` may contain only `fork-ci.yml` and `fork-sync.yml`.
