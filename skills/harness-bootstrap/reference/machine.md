# Reference: the machine — disk, residue and leftover processes

**Evidence: one project's incident and one machine's survey.** The project, 2026-10-17:
across 9 sessions, 73 MCP server processes and leftover dev servers held 11.25 GB of
a 12 GB swap, with 3.1 GB of disk free. Its leftover-processes hook then fired in 39
sessions, and the owner typed "close" or "cleanup" 79 times. This skill's own
machine, 2026-10-26: 20 GB free of 245 GB, and at most 12 GB of it reclaimable
without touching work. A first survey counted 15–25 GB; measuring what is still in
use took the rest back (› What is in use).

**`[M]` mechanism · `[B]` binding**

## Two parts

| Part | What it covers | Where it runs | Whose |
|---|---|---|---|
| the machine sweep | caches, build output, residue worktrees, orphaned MCP servers, recorded processes | `scripts/machine-sweep.mjs`, this skill's own; never generated | the owner approves categories once; then `DUE disk` starts them |
| the leftover-processes hook | what this checkout left listening, and tight memory | `.claude/hooks/leftover-processes.mjs`, from `templates/leftover-processes.mjs` | optional, per project (`SKILL.md` › Phase C) |

That project's `dev:ps` and `dev:clean` stay its own: the hook and the report's orphan
list name what runs, and `harness-due` and the sweep remove worktrees on
`dev:clean`'s own rails.

## The machine sweep

`[M]` **The report changes nothing.** `node <skill dir>/scripts/machine-sweep.mjs`
lists each category: its size, what freeing it runs, and what it keeps and why. It
also lists the dev processes that lost their parent, with their age, directory and
ports, and never stops one.

`[M]` **Approval is the owner's, once per category.** `--approve <ids>` writes
`~/.agents/harness/sweep.json` and installs a copy at
`~/.agents/harness/machine-sweep/`, which a plugin update cannot move. `--unapprove
<ids>` withdraws. Read the first report before approving anything.

`[M]` **Then it runs on its own.** Under 25 GB free `[B]`, `harness-due` says `DUE
disk` and the runner starts `node ~/.agents/harness/machine-sweep/machine-sweep.mjs
--apply-approved` in the background (`runner.md` › Due-checks). It frees the
approved categories alone, takes a lock so two runs never overlap, refuses to run
as root, and appends one line to `~/.agents/harness/sweep-log.jsonl`. The next
`DUE disk` line says what the last run freed. `--dry-run` prints the plan instead.

| Category | Frees | Keeps |
|---|---|---|
| `pnpm` | `pnpm store prune`; a store version the installed pnpm does not read | that version until nothing has written it for 30 days |
| `npm` · `bun` | `npm cache clean --force` · bun's install cache | — |
| `uv` · `homebrew` | `uv cache prune` · `brew cleanup --prune=all` | what each tool's own prune keeps |
| `derived-data` | Xcode's DerivedData | all of it while Xcode or `xcodebuild` runs |
| `docker` | `docker builder prune -f` · `docker image prune -f` | the build cache and images in use |
| `playwright` | browsers no live installation names | each one a live installation names, for any platform |
| `updaters` | downloaded app updates | anything written in the last hour |
| `codex` | old Codex releases; Codex worktrees that are residue | the current release, the one before it, any release a process maps |
| `chrome-clones` | Chrome's code-sign clones | any a running Chrome uses, any from the last hour |
| `worktrees` | the registered repositories' residue worktrees | any with work in it (below) |
| `orphan-mcp` | MCP servers whose agent is gone (SIGTERM) | any with a non-MCP process above it |
| `recorded-pids` | processes a harness run recorded (SIGTERM) | a reused PID, one recorded under 6 h ago, one whose repository holds a registry row |

`[M]` **A worktree is residue** only when it is merged into the mainline with
commits of its own, has no change, holds no ignored file but rebuildable output (a
link counts as none), names no held registry row, has no process inside, and has
been idle 6 h. It goes with `git worktree remove`, never `--force`. These are the
hygiene unit's rails (`hygiene.md` › Residue); the sweep also keeps a detached HEAD.

`[M]` **An orphaned MCP server** is one whose every process above it, up to
process 1, is an MCP launcher, and whose top one is no launchd job. One under a
live agent, an editor, a terminal or tmux has something else above it. A shell is
never the server itself, only a launcher.

`[M]` **A recorded process** is one a run named at its start:
`node ~/.agents/harness/machine-sweep/machine-sweep.mjs --record <pid>` appends its
start time and command to `~/.agents/harness/pids.jsonl` (`runner.md` › Step 10).
The sweep stops it only while the same process still holds that PID.

`[M]` **Never:** sudo; the agents' sessions and transcripts, which the retro reads,
or the harness's own state under `~/.agents/harness`; any path outside its
category's directory; any other process.

### What is in use

> Origin, 2026-10-26, measuring before approving anything:
>
> - Both Playwright browser revisions were in use: one project's playwright-core
>   1.63.0 needs chromium-1243, another's 1.61.1 needs chromium-1228. Keeping
>   only the newest would have broken one.
> - The pnpm v3 store, which the installed pnpm 10 does not read, had been written
>   two days earlier.
> - Docker counted 3.25 GB of build cache and 12 kB of it reclaimable: the rest is
>   shared with the 11 images in use.
> - Both Codex worktrees held commits that no mainline has.
> - A running Codex session maps its release's binaries, whatever its command
>   line says; the sweep reads what each process maps.
> - 0 of 48 MCP processes were orphans: each had a live non-MCP process above it.

## The leftover-processes hook

`[M]` On Stop it tells the owner, and on UserPromptSubmit it tells the model, which
TCP listeners run with a working directory inside this checkout. A main checkout
leaves out its worktrees: they belong to other sessions. It also names every
executable `MACHINE_WIDE` matches, whoever started it, and says when memory is
tight, at most every 30 minutes unless it gets worse. **It never stops anything,
never blocks, and never fails the turn.** Wire it as a Stop and a UserPromptSubmit
command hook, `node .claude/hooks/leftover-processes.mjs`.

> Origin: one project's version (2026-10-17) matched machine-wide processes on their
> whole command line. This skill's first test then named the test session's own
> shell, whose command line held an emulator's name. It now matches the
> executable's name alone.

`[B]` The hook: `WORKTREES`, `MACHINE_WIDE`, `NOTICE_MINUTES`. The sweep: the
settings block in `scripts/lib/machine-sweep-core.mjs` (the idle times, the
releases kept, `REBUILDABLE`), and `harness-due`'s `DISK_MIN_GB`. Its tests,
`scripts/lib/machine-sweep-core.test.mjs`, run with `node --test` against a temp
`--home`, under which every category whose cache or processes a `--home` cannot
fence (pnpm, npm, uv, Homebrew, Docker, Chrome's clones, the MCP servers) reports
itself absent.
