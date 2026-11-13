# Reference: the machine — disk, residue and leftover processes

**Evidence: one project's incident and one machine's survey.** The project, 2026-10-17:
across 9 sessions, 73 MCP server processes and leftover dev servers held 11.25 GB of
a 12 GB swap, with 3.1 GB of disk free. Its leftover-processes hook then fired in 39
sessions, and the owner typed "close" or "cleanup" 79 times. This skill's own
machine, 2026-10-26: 20 GB free of 245 GB, and at most 12 GB of it reclaimable
without touching work. A first survey counted 15–25 GB; measuring what is still in
use took the rest back (› What is in use).

**`[M]` mechanism · `[B]` binding**

## Three parts: act, don't warn

| Part | What it covers | Where it runs | Whose |
|---|---|---|---|
| the machine sweep | caches, build output, residue worktrees, orphaned MCP servers, recorded processes | `scripts/machine-sweep.mjs`, this skill's own; never generated | the owner approves categories once; then `DIGEST disk` starts them |
| the leftover-processes hook | orphans and runaway shells, stuck tool shells, what this checkout left listening, a full disk | `.claude/hooks/leftover-processes.mjs`, from `templates/leftover-processes.mjs` | every Claude Code install (`SKILL.md` › Phase C) |
| admission | memory, disk and load before a FULL verify | `scripts/lib/admission.mjs`, run by `run-gates.sh` | every install with `run-gates.sh` |

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

`[M]` **Then it runs on its own.** Under 10 GB free (`DISK_MIN_GB`, `[B]`), `harness-due` prints `DIGEST
disk` — housekeeping, in the digest, never an owner line — and the runner starts `node ~/.agents/harness/machine-sweep/machine-sweep.mjs
--apply-approved` with the host's own background option (Claude Code: the Bash tool's
`run_in_background`, never a shell `&`; `runner.md` › Due-checks). It frees the
approved categories alone and takes a lock so two runs never overlap: each run
writes its own entry in `~/.agents/harness/machine-sweep.locks/` and removes only
the entries of runs that are gone, so two runs that start together both stop. It
refuses to run as root and appends one line to `~/.agents/harness/sweep-log.jsonl`.
At the next step boundary the runner says what it freed, from the run's last line or the newest
line of `sweep-log.jsonl`: once the disk is back over the floor, no `DIGEST disk`
line says it. `--dry-run` prints the plan instead.

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
hygiene report's rails (`hygiene.md` › Residue); the sweep also keeps a detached HEAD.

`[M]` **An orphaned MCP server** is one whose every process above it, up to
process 1, is an MCP launcher, and whose top one is no launchd job. One under a
live agent, an editor, a terminal or tmux has something else above it. A shell is
never the server itself, only a launcher.

`[M]` **A recorded process** is one a run named at its start:
`node ~/.agents/harness/machine-sweep/machine-sweep.mjs --record <pid>` appends its
start time and command to `~/.agents/harness/pids.jsonl` (`runner.md` › Step 10).
The sweep stops it only while the same process still holds that PID. `--status`
(`--json`) lists each recorded process still running, by the same rule, with its
start, CPU time, repository and command; it runs alone, reads only and exits 0.

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

`[M]` **It acts; it does not warn.** On SessionStart, Stop and UserPromptSubmit
(`harness-targets.md`) it reads `ps` and `lsof` once, then:

- **reaps** (`SIGTERM`, `SIGKILL` a second later) a process of its own uid, parent
  process 1, no TTY, `REAP_MINUTES` (10) old, with nothing in its subtree listening
  and no match for `KEEP` (`[B]`, empty by default), whose group leader is gone and
  that no service manager runs, when it runs in this checkout or its `WORKTREES`, or
  is a `sh -c` on 30% of a CPU anywhere. A package runner never listens itself:
  `npm run dev &` stays because its server, npm's child, listens, but in this
  checkout only until `LISTEN_HOURS` (6) old or until its directory is gone, so a
  finished unit's server never keeps its worktree from the sweep. A failed reading
  reaps nothing; each pid is re-read before each signal; the model hears
  `reaped <n>: …` with how to keep a job running, and a Stop with nothing stuck
  keeps that line for the next prompt;
- **reports** on Stop, once, a tool shell of this session `STUCK_MINUTES` (30) old
  with no CPU and no listener, so the session stops it (`TaskStop`) or keeps it;
- **lists** this checkout's listeners and the `MACHINE_WIDE` executables to the
  model, at most once an hour;
- **notifies** once a day, on the desktop, under `DISK_NOTICE_GB` (5) free. Nothing
  reaches the owner on Stop; the turn never fails; the header lists its limits.

> Origin: one install's probe scripts killed only their direct child on timeout:
> about 96 `zsh -c` shells went to process 1 and spun for about 9.5 hours on 5–8
> cores, while the hook's memory notice fired 354 times and prevented neither real
> out-of-memory kill. Its `MACHINE_WIDE` list matches the executable's name alone:
> matched on the whole command line, it named a test session's own shell.

`[M]` **Admission holds a FULL verify** until the machine has `MEM_RESERVE_GB`
available, `DISK_FLOOR_GB` free and a load under `LOAD_PER_CPU` per CPU, for up to
`WAIT_S`; past it `run-gates.sh` exits 97, `NOT ADMITTED`, no gate run (`context.md`).

`[B]` The hook: `WORKTREES`, `MACHINE_WIDE`, `REAP_MINUTES`, `STUCK_MINUTES`,
`DISK_NOTICE_GB`. Admission: the floors in `scripts/lib/admission-core.mjs`. The sweep: the
settings block in `scripts/lib/machine-sweep-core.mjs` (the idle times, the
releases kept, `REBUILDABLE`), and `harness-due`'s `DISK_MIN_GB`. Its tests,
`scripts/lib/machine-sweep-core.test.mjs`, run with `node --test` against a temp
`--home`, under which every category whose cache or processes a `--home` cannot
fence (pnpm, npm, uv, Homebrew, Docker, Chrome's clones, the MCP servers) reports
itself absent.
