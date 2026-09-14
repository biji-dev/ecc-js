# ECC JS fork (biji-dev/ecc-js)

This repository is a slim fork of [affaan-m/ECC](https://github.com/affaan-m/ECC).
It keeps only the technical, language-neutral surface that serves a
JavaScript/TypeScript, Bun, React, Next.js and React Native stack, and it still
takes upstream releases through a scripted merge.

Everything upstream-authored keeps upstream prose. Fork documentation lives in
this file only, so upstream README/AGENTS edits merge without conflicts.

## What ships

| Surface | Count | Source of truth |
| --- | --- | --- |
| Skills | 140 | `fork/slim.json` `skills.keep` |
| Agents | 36 | `fork/slim.json` `agents.keep` |
| Commands | 66 | `fork/slim.json` `commands.keep` |
| Rule packs | 5 (common, typescript, web, react, react-native) | `fork/slim.json` `rules.keep` |
| Hooks | 12 top-level entries, gated by an allowlist | `fork/slim.json` `hooks`, `ecc/setup.json` |

Excluded: non-JS language and platform lanes, non-technical business skills,
ECC side products (ito, nasiko, taste, epic), Jira, paid-API integrations,
claw/Hermes harness items, other-harness adapter dirs (Cursor, OpenCode, Kiro,
Gemini, Qwen, Zed, Pi, Hermes, OpenClaw, AdaL, Trae, CodeBuddy), docs
translations, `ecc2/`, `src/` and upstream CI/release workflows.

Kept harnesses: Claude Code (plugin), ZCode (Claude-compatible plugin
marketplace), Codex (`.codex-plugin`) and Kimi (installer target).

## Hooks

`ecc/setup.json` holds an allowlist. Only listed hook ids run; upstream profile
gating is ignored while the allowlist exists. Everything upstream adds later
stays off until you allowlist it.

On by default: `pre:bash:block-no-verify`, `pre:config-protection`,
`pre:bash:gateguard-fact-force` (destructive commands only),
`pre:bash:commit-quality`, `post:edit:console-warn`, `stop:format-typecheck`
(with `post:edit:accumulator`), `stop:cost-tracker`, `post:skill:track`,
continuous-learning observe (`pre:observe`, `post:observe:continuous-learning`,
`session:end:marker`), `session:start`, `stop:session-end`,
`stop:desktop-notify`.

Escape hatches (environment variables):

- `ECC_DISABLED_HOOKS=id,id` disables specific hooks on one machine or project.
- `ECC_HOOK_ALLOWLIST=off` restores upstream profile gating (used by `npm test`).
- `ECC_HOOKS_ENABLED=false` disables every ECC hook.

To enable another hook: add its top-level id to `hooks.keep` in
`fork/slim.json` (if it is a top-level entry), add its runtime id to
`ecc/setup.json` `hooks.allow`, run `npm run fork:apply`, then bump.

## Install

### Claude Code

```bash
claude plugin uninstall ecc@ecc --scope user     # remove the upstream plugin
claude plugin marketplace remove ecc
# edit ~/.claude/settings.json: extraKnownMarketplaces.ecc.source = {"source":"github","repo":"biji-dev/ecc-js"}
claude plugin marketplace add biji-dev/ecc-js
claude plugin install ecc@ecc --scope user
claude plugin details ecc@ecc                     # expect 140 skills, 36 agents, 66 commands
```

Update: `claude plugin marketplace update ecc && claude plugin update ecc@ecc`.
Do not run `ecc setup` or the configure-ecc flow: they only accept the upstream
marketplace.

### ZCode

Add the marketplace `biji-dev/ecc-js` in the ZCode plugin UI and install `ecc`.

### Codex

```bash
codex plugin marketplace add biji-dev/ecc-js
codex plugin add ecc@ecc
codex plugin list --json
```

Re-trust hooks in `/hooks` when `hooks/codex-hooks.json` changes.

### Kimi (per project, from a local clone)

```bash
node ~/Projects/ecc-js/scripts/install-plan.js --target kimi --config ~/Projects/ecc-js/fork/install/kimi.json --json
node ~/Projects/ecc-js/scripts/install-apply.js --target kimi --config ~/Projects/ecc-js/fork/install/kimi.json
```

The installer never prunes: after the fork drops items, run
`node ~/Projects/ecc-js/scripts/uninstall.js --target kimi` from the same project
directory (add `--dry-run` first), then reinstall.

### Rules (optional)

Plugins cannot ship rules. Install them into `~/.claude/rules/ecc/`:

```bash
node scripts/install-apply.js --target claude --config fork/install/claude-rules.json --dry-run
node scripts/install-apply.js --target claude --config fork/install/claude-rules.json
```

## Syncing upstream

Upstream is fetched from the remote `ecc-upstream` (fetch-only). It is not named
`upstream` on purpose: `gh` and the GitHub UI would otherwise target
affaan-m/ECC. Always pass `-R biji-dev/ecc-js` to `gh`.

One-time setup in a fresh clone:

```bash
git remote add ecc-upstream https://github.com/affaan-m/ECC.git
git remote set-url --push ecc-upstream DISABLED
git config remote.ecc-upstream.tagOpt --no-tags
git config --replace-all remote.ecc-upstream.fetch '+refs/heads/main:refs/remotes/ecc-upstream/main'
git config --add remote.ecc-upstream.fetch '+refs/tags/v*:refs/tags/upstream/v*'
git config rerere.enabled true
git config merge.renameLimit 10000
gh repo set-default biji-dev/ecc-js
```

The weekly `fork-sync` workflow only forecasts: when upstream publishes a new
release tag it opens an issue with the forecast. Then, locally:

```bash
git switch main && git pull --ff-only
git switch -c sync/vX.Y.Z-$(date +%Y%m%d)
npm run fork:plan            # read-only forecast in fork/.sync-report.md
npm run fork:sync            # merge the newest release tag
# on MANUAL conflicts: resolve, git add, then
node fork/bin/sync.js --continue
npm test && node fork/bin/verify.js --drift
git status                   # regenerated files, fork/state.json and the queue are already staged
git commit                   # merge commit: "chore(sync): merge upstream vX.Y.Z"
git push -u origin HEAD
gh pr create -R biji-dev/ecc-js --base main --body-file fork/.sync-report.md
```

What the sync does automatically:

1. Merges the upstream tag with a real merge commit.
2. Removes paths in the drop set (dropped items, their `.agents/skills` mirrors,
   dropped trees, dropped tests) even when upstream modified them.
3. Resets derived files (README counts, manifests, package.json, agent.yaml,
   hooks.json, plugin manifests, command registry) to upstream and regenerates them.
4. Restores fork-owned files (`fork/`, `tests/fork/`, `ecc/`, `FORK.md`,
   `.github/workflows/fork-*.yml`) from the fork.
5. Queues new upstream skills, agents, commands and rule packs in
   `fork/review-queue.json`. Queued items do not ship until decided. New hook
   ids, dispatcher sub-hooks, scripts, lib dirs and top-level paths are listed
   in `fork/.sync-report.md`: new top-level hook ids are removed until you add
   them to `hooks.keep` or `hooks.drop`, new sub-hooks stay off until
   allowlisted, and new top-level paths ship unless you add them to `paths.drop`.
6. Blocks when a kept item disappears upstream, with rename/successor hints.
7. Bumps the plugin build number and renders `<upstream>-js.<build>` into every
   plugin manifest, then stages every regenerated file.

Only files you edited that upstream also changed need manual resolution.

### Deciding review-queue items

Move each queued name into `keep` or `drop` (with a short reason) in
`fork/slim.json`, then:

```bash
npm run fork:apply     # prune decided queue entries, restore kept items, remove dropped, regenerate (staged)
npm run fork:bump      # new plugin version so harness caches update (staged)
npm test && node fork/bin/verify.js --drift
git add fork/slim.json && git commit
```

### Resolving a blocked sync (kept item gone upstream)

`npm run fork:sync` refuses to merge when an item listed in `keep` no longer
exists at the upstream tag. The "Kept items gone upstream" section of
`fork/.sync-report.md` lists each one with hints: an `R` line is a rename, a
`D` line is a deletion.

1. For each blocked item, remove it from `<kind>.keep` (and `<kind>.pinned`).
2. If it was renamed, add the new name to `keep` (and `pinned` if it was).
   If it was deleted, record it under `drop` with a reason such as
   `removed-upstream-vX.Y.Z`.
3. Commit the `fork/slim.json` change on the sync branch and rerun
   `npm run fork:sync`.

External consumers that reference a pinned `ecc:` name (task-runner skills,
project `CLAUDE.md` files) need the same rename.

### Your own skills, agents and commands

Prefix them with `biji-` so they never collide with upstream names, and list
them under `own` in `fork/slim.json`. Own skills are claimed by the `fork-own`
install module automatically.

## Rules for this repository

- Merge sync PRs with **Create a merge commit**. Never squash or rebase them,
  and never use GitHub's **Sync fork** or **Discard commits** buttons: that
  breaks the upstream ancestry the sync depends on.
- Never hand-edit derived files; change `fork/slim.json` or `fork/bin/transforms`.
- Bump the plugin build (`npm run fork:bump`) for every change that ships, or
  Claude Code, ZCode and Codex keep their cached copy.
- `.github/workflows` may contain only `fork-ci.yml` and `fork-sync.yml`
  (`fork/bin/verify.js` enforces this).
- Never push upstream `v*` tags to origin.
- The fork tooling and `npm test` assume a POSIX shell (macOS, Linux, CI on
  ubuntu-latest).
