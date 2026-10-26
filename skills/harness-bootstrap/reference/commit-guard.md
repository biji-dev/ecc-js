# Reference: the commit guard

**`[M]` mechanism · `[B]` binding**

## Why a hook

`[M]` The failure it exists for is **a second session starting during a run** — in
another terminal, another agent, or a human at the keyboard. That session never
read the harness file's instructions, so a guard written as a snippet the agent
is asked to run does not exist for it. **A hook, not a habit.** Both projects that
adopted this harness first shipped the guard as a snippet; neither had a hook.

`[M]` What it refuses. A row **matches** the branch when its `Branch` cell equals the
branch name, or when any cell other than the Worktree cell equals the task id the
branch carries. A table with no `Branch` column matches the branch name against any
non-Worktree cell. A header is a row followed by a `|---|` separator, inside the
markers or immediately above the begin marker; with neither, every numbered row is
data and the branch name matches any cell — so give the table a header:

| Branch | Registry | `SCOPE=repo` | `SCOPE=checkout` |
|---|---|---|---|
| matches a held row | — | allow | allow — **unless** that row's Worktree names another checkout |
| carries a task id | no row for it | **refuse** — claim the lock first | **refuse** — claim the lock first |
| matches no row | any row held | **refuse** — a run is in progress | **refuse** only if a held row locks **this** checkout |
| matches no row | no rows | allow | allow |

## Two scopes

`[M]` **`SCOPE=repo`** — one lock for the whole clone. Right when runs share the main
checkout and branch in it, as plan mode usually does: a second session on the
mainline must not commit while any run holds a row.

`[M]` **`SCOPE=checkout`** — one lock per checkout. Right when every unit runs in its
own linked worktree, as change mode often does: a docs fix on the main checkout must
not be refused because a worktree elsewhere holds a row, while a commit in the
checkout a row locks still is. Add a `Worktree` column to the active table; its
first word is `main` (or `.`, empty, or a placeholder such as `-` or `n/a`) for the
main checkout, else a path relative to the main checkout root. Paths are compared
physically (`pwd -P`). A registry without the column locks the main checkout with
every row — a guard that cannot tell which checkout a row means fails closed.

`[M]` **Branch-cell matching** lets a unit whose branch carries no task id — a
change branch like `fix/login` — claim a row by writing the branch name in its
`Branch` cell. Only that column counts: a `Base` cell reading `main` or a Task cell
reading `login` matches nothing, so a mainline commit is still refused while a run
holds a row.

## The template

`templates/harness-guard.sh` — POSIX `sh`, so it runs under Git for Windows too.
Copy it; set its `[B]` lines; **test the shipped file**.

`[B]` `REGISTRY` path · `ID_PATTERN` · `SCOPE` · nothing else. An invalid `SCOPE`
refuses every commit, so a typo cannot disable the guard.

## Installing

- **No hook manager:** copy to `.githooks/pre-commit` **and**
  `.githooks/pre-merge-commit`, `chmod +x`, commit both, and
  `git config core.hooksPath .githooks`. Each clone runs that config once — put
  it in the project's setup script or `prepare` step so a fresh clone is guarded,
  and say in the harness file that a clone is unguarded until it has run.
- **husky:** keep the script at `.githooks/harness-guard.sh` and call it first
  in `.husky/pre-commit` and `.husky/pre-merge-commit`:
  `sh .githooks/harness-guard.sh || exit 1`.
- **lefthook:** `pre-commit` and `pre-merge-commit` commands running
  `sh .githooks/harness-guard.sh`.

`[M]` **Why two hooks.** A merge that needs no conflict resolution runs
`pre-merge-commit`, never `pre-commit`: with only the first hook, a mainline
`git merge --no-ff` went through while a run held a row. **A fast-forward runs no
hook at all**, so the runner merges with `--no-ff` and the harness file says
never to fast-forward the mainline while a row is held.

`[M]` If the repository already sets `core.hooksPath`, **chain into it**; never
overwrite another hook manager's setting.

`[M]` `git commit --no-verify` skips every hook, and `git merge --no-verify` skips
`pre-merge-commit`. Say so in the harness file, and
install the project's command guard (`templates/command-guard.mjs`,
`harness-targets.md`), which refuses that flag — and `HUSKY=0` or a `core.hooksPath`
override — from an agent by parsing the command. Setting `core.hooksPath` to the
project's own hooks directory (its `[B]` `HOOKS_DIR`, default `.githooks`) stays
allowed, so an agent can still run the install step in a fresh clone or worktree.
Never rely on a plugin's hook for it: a machine may run with every plugin hook
disabled.

## Construction rules — each one cost a run

`[M]` **Key on the task id in the branch name, not a branch prefix.** The first
guard checked only "is this the mainline" and refused every commit while any run
held the lock — including the owning run's own.

`[M]` **The id pattern must match every id shape the plan has.** The default
`[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[0-9]+[A-Za-z]?` covers `P0-12`, `T-AB-12`,
`T-I18N-003` and `T-SEC-030b`, and takes only the **first** id from a segment
branch named for a range (`P0-12-P0-11` → `P0-12`). A simpler pattern read
`T-AB-12` as `AB-12` and refused its own run. Check the pattern against the real
plan's ids before installing. Ids match **case-insensitively**: plans write
`P2-20`, branches are usually `task/p2-20`.

`[M]` **Self-test the bound pattern before installing.** It must take each id
**whole**: for every plan id and every existing branch, the match must not stop
in the middle of the id. Run it over the plan's ids (the extract command is `[B]`):

```sh
ID_PATTERN='EP-[0-9]+\.[0-9]+'   # the value about to be bound
for id in $(grep -oE 'EP-[0-9]+\.[0-9]+' docs/plan.md | sort -u); do
  [ "$(printf '%s' "$id" | grep -oE "$ID_PATTERN" | head -n 1)" = "$id" ] || echo "CUT $id"
done
```

Any `CUT` line is a row the guard can match only through its `Branch` cell. A
segment or renamed branch then holds no row and is refused, and a tracked
registry's release check, which finds the row by id, accepts removing any row the
cut id is a prefix of. The default pattern cuts `EP-27.01` to `EP-27`. After install,
the status script reports a cut id as `id-pattern-truncates`.

`[M]` **Its test ships with it:** `templates/scripts/lib/harness-guard.test.mjs`,
installed to `scripts/lib/`. It runs the installed guard as git runs it, in throwaway
repos: no registry, row 0 alone, a registry without its markers, the owning branch
against the mainline and another branch, a clean `--no-ff` merge onto the mainline,
and every id in its `[B]` `IDS` (the self-test above, end to end). Bind `IDS` to the
plan's ids and `GUARD` to where the guard is installed; a plan-mode guard with no ids
bound fails the test.

`[B]` **Change mode leaves `ID_PATTERN` empty** unless its changes carry ids. The
plan default also matches tokens such as `UTF-8` or `ISO-8601`, and refused a
`fix/UTF-8-bom` branch with no run in progress. With it empty, a row is matched
only by its `Branch` cell.

`[M]` **Read only the marked active section.** Rows count only between
`<!-- harness:active -->` and `<!-- /harness:active -->`, and only when the first
cell is a number ≥ 1 — **row 0 is reserved** for the mainline. Without the markers,
a port-range table elsewhere in the registry matched as a held row.

`[M]` **`if`, not `grep … && { … }`.** In the second form, the passing case's
`grep` exit status 1 became the result, so the commit silently did nothing.

`[M]` **End with an explicit `exit 0`.** A guard whose last command is a failed
test refuses everything.

`[M]` **Test by extracting the shipped text.** A copy that drifted from the
installed file once passed its tests while the real guard refused every commit.

## The registry

`[M]` **Untracked by default** — gitignored, in the main checkout. The template
resolves it through `git rev-parse --git-common-dir`, so every linked worktree of
the clone reads the same lock. Claiming and releasing are plain edits; no commit,
no circularity at land.

```markdown
<!-- harness:active -->
| # | Task | Step | Branch | Worktree | Resources | Claimed (UTC) |
|---|---|---|---|---|---|---|
| 0 | mainline — never claimed | | | main | | |
<!-- /harness:active -->
```

The `Worktree` column is needed only with `SCOPE=checkout`; under `SCOPE=repo` it
is harmless.

`[M]` If the project insists on tracking the registry, the guard allows the land
step's **release commit** — one that touches only the registry and removes this
task's row. Exclude the file from the formatter either way.

## Migrating a legacy registry

`[M]` An older registry without markers (`harness-status.js` reports
`registry-no-markers`) is migrated by **adding** the two marker lines around the
active table and nothing else, while no row is held. Keep its columns; add
`Worktree` only when switching to `SCOPE=checkout`. A legacy column that holds the
branch inside another cell (`main · task/p2-20` under `Worktree`) is never matched
by that branch name — the guard reads a Worktree cell as a path. The row still
matches through the task id the branch carries; a branch without an id needs a
`Branch` column. Keep the tracked-registry
release exception if the project tracks it. Then test the shipped guard against the
migrated file — a held row, a release commit and a mainline commit — before
deleting any guard snippet from the harness file.

## Land order

`[M]` Guard → land commit **on the task branch** (status, evidence, log row) →
release the row → merge with `--no-ff` → push on the owner's word. Releasing after
the merge cannot work under `SCOPE=repo`: the guard refuses a mainline commit while
any row is held. Logged three times in one project and twice in another before it
was written down.

`[M]` Write the merge message to a file. `git merge` does not read stdin.
