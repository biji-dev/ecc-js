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

`[B]` `REGISTRY` path · `ID_PATTERN` · `SCOPE` · `MAINLINE` (the branch lands merge
into, default `main`) · nothing else. An invalid `SCOPE` refuses every commit, so a
typo cannot disable the guard.

## Installing

- **No hook manager:** copy to `.githooks/pre-commit`, `.githooks/pre-merge-commit`
  **and** `.githooks/reference-transaction`, `chmod +x`, commit all three, and
  `git config core.hooksPath "$(git rev-parse --show-toplevel)/.githooks"`. Each
  clone runs that config once — put it in the project's setup script or `prepare`
  step so a fresh clone is guarded, and say in the harness file that a clone is
  unguarded until it has run.
- **husky:** keep the script at `.githooks/harness-guard.sh` (executable) and call
  it first in `.husky/pre-commit`, `.husky/pre-merge-commit` and
  `.husky/reference-transaction`, as the first line
  `sh .githooks/harness-guard.sh "$@" || exit 1`, or
  `exec sh .githooks/harness-guard.sh "$@"` when it is the only command. A guard
  line followed by another command, or ending `|| exit 0`, loses the refusal: with
  no `set -e` the hook exits with its last command's status. husky v9 runs those
  files from `.husky/_`: its own `prepare` step sets `core.hooksPath` to `.husky/_`,
  whose stubs run `.husky/<hook>` with `sh`. **husky writes no stub for
  `reference-transaction`,** so the `prepare` step writes it after husky's own:
  `printf '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n' > .husky/_/reference-transaction`
  and `chmod +x` it. That hook needs the `"$@"`: its state is its first argument.
  The same step then re-sets the path husky wrote to an absolute one:
  `git config core.hooksPath "$(git rev-parse --show-toplevel)/.husky/_"`.
- **lefthook:** `pre-commit`, `pre-merge-commit` and `reference-transaction`
  commands running `sh .githooks/harness-guard.sh`; the last one passes the hook's
  arguments (`{0}`) and its stdin (`use_stdin: true`). lefthook installs into
  `.git/hooks`, which git finds from any directory.

`[M]` **The hooks path is absolute.** git resolves a relative `core.hooksPath`
against the directory a command runs in. So `git -C .git update-ref refs/heads/main <x>`,
or `--git-dir` or `GIT_DIR` from another directory, found no hook and moved the
mainline. In the `prepared` state the guard also refuses a mainline move it sees
from outside the working tree, which includes a push into a non-bare clone's
mainline (receive-pack runs inside `.git`): push to the shared remote instead.
A bare repository with no working tree passes, told by its own files, never by
`-c core.bare`; a separate git directory (`--separate-git-dir`) does not.
The status script says `hooks-path-relative` for a relative path, and
`hooks-path-missing` when the directory is gone, as in a moved clone, where git
runs no hook at all.

`[M]` **Why three hooks.** A merge that needs no conflict resolution runs
`pre-merge-commit`, never `pre-commit`: with only the first hook, a mainline
`git merge --no-ff` went through while a run held a row. **A fast-forward writes no
commit, so it runs neither**, and nor do `reset`, `update-ref`, `branch -f`, a
rebase or a pull that fast-forwards. `reference-transaction` runs on every ref
update (git 2.28 or later). The guard reads its first argument, and in the
`prepared` state refuses any move of the mainline ref that the landing check
refuses (The landing refusal, below); for any other ref or state it starts no
process. The runner still merges with `--no-ff`: the commit hooks refuse before git
writes anything, so `git merge --abort` works, while a refused fast-forward leaves
the refused files in the working tree.

`[M]` If the repository already sets `core.hooksPath`, **chain into it**; never
overwrite another hook manager's setting.

`[M]` `git commit --no-verify` skips `pre-commit`, and `git merge --no-verify` skips
`pre-merge-commit`. Neither skips `reference-transaction`, so the landing check
still reads a mainline move, but the lock checks never run. Say so in the harness
file, and
install the project's command guard (`templates/command-guard.mjs`,
`harness-targets.md`), which refuses that flag — and `HUSKY=0` or a `core.hooksPath`
override — from an agent by parsing the command. Setting `core.hooksPath` to the
project's own hooks directory (its `[B]` `HOOKS_DIR`, default `.githooks`) stays
allowed, so an agent can still run the install step in a fresh clone or worktree.
With husky v9, bind `HOOKS_DIR` to `.husky/_`, the path husky's install step sets,
so that step stays allowed.
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
in the middle of the id. Run it over the plan's ids, upper-cased, since the guard
matches the upper-cased branch name (the extract command is `[B]`):

```sh
ID_PATTERN='EP-[0-9]+\.[0-9]+'   # the value about to be bound
for id in $(grep -oE 'EP-[0-9]+\.[0-9]+' docs/plan.md | sort -u); do
  up=$(printf '%s' "$id" | tr '[:lower:]' '[:upper:]')
  [ "$(printf '%s\n' "$up" | grep -oE "$ID_PATTERN" | head -n 1)" = "$up" ] || echo "CUT $id"
done
```

Any `CUT` line is a row the guard can match only through its `Branch` cell. A
segment or renamed branch then holds no row and is refused, and a tracked
registry's release check, which finds the row by id, accepts removing any row the
cut id is a prefix of. The default pattern cuts `EP-27.01` to `EP-27`. After install,
the status script reports a cut id as `id-pattern-truncates`.

`[M]` **Its test ships with it:** `templates/scripts/lib/harness-guard.test.mjs`,
installed to `scripts/lib/`. It checks that each hook file git runs (its `[B]`
`HOOK_FILES`) is the guard, or runs it as its first command and fails when it
refuses (the guard stubbed to exit 1, the hook run by plain `sh`), then runs the installed
guard as git runs it, in throwaway repos: no registry, row 0 alone, a registry
without its markers, the owning branch against the mainline and another branch, a
clean `--no-ff` merge onto the mainline, a row that locks a linked worktree (the
main checkout commits under `checkout` and is refused under `repo`), merging a
branch that still holds a row (refused, then merged once the row is released), and
every id in its `[B]` `IDS` (the self-test above, end to end). Bind `IDS` to the
plan's ids, `GUARD` and `MERGE_GUARD` to where the guard is installed and
`HOOK_FILES` to the files git runs; a plan-mode guard with no ids bound fails the
test.

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
| # | Unit | Step | Branch | Worktree | Resources | Claimed (UTC) |
|---|---|---|---|---|---|---|
| 0 | mainline — never claimed | | | main | | |
<!-- /harness:active -->
```

The `Worktree` column is needed only with `SCOPE=checkout`; under `SCOPE=repo` it
is harmless.

`[M]` **The parked table follows the active one** (`gate-design.md` › Parking a
unit): a unit waiting on the owner moves its row there, so it holds nothing. The
guard reads the active table only; `harness-due.mjs` prints the parked rows as the
inbox and keeps their worktrees.

`[M]` If the project insists on tracking the registry, the guard allows the land
step's **release commit** — one that touches only the registry and removes this
task's row. Exclude the file from the formatter either way.

`[M]` **Live stacks side by side.** Where units run them, `templates/unit-stack.sh`
(installed to `scripts/`) is the resource lock: one slot per unit, claimed as
`slot N` in the row's Resources cell, and every port, database and container
project of the slot derives from N. Its `up` refuses the main checkout, a slot
another row holds, a slot whose stack serves another checkout (a stale state file
would otherwise remove that unit's data), a port another process holds and a disk
below its floor; `down` checks the ports are free after. Three projects each built
this lock their own way. `[B]` the registry's path (the guard's `REGISTRY`), the
slot range, the floor and what a slot owns (its block).

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

`[M]` One order for both scopes: guard → the landing check → land commit **on the
task branch** (status, evidence, log row) → release the row → merge with `--no-ff` →
push by the grant. Releasing after the merge cannot work under either scope. Under
`SCOPE=repo` the guard refuses a mainline commit while any row is held. Under
`SCOPE=checkout` a held row locks only its own checkout, so the merge hook refuses
instead: a merge, clean or concluded with `git commit`, is refused while the branch
it merges still holds a row, and the refusal names that branch. The merged commit
counts too, whatever name it is merged by (`refs/heads/…`, `origin/…`, a copy
branch, a pull): it is refused when it is a held branch's tip with work of its own.
A held branch with no work of its own, its tip already in `MAINLINE` (claimed at the
mainline's tip, no commits yet), adds nothing held, so merging that commit goes
through; with no `MAINLINE` branch every held tip counts as work. A row this checkout
owns, one that names its branch or task id and locks it, never refuses: the owning run
may pull its own branch back, diverged, and merge a branch that carries its task id.
Logged three times in one project and twice in another before it was written down.

`[M]` **The landing refusal.** Every commit and merge onto `MAINLINE`, and every
other move of the mainline ref, runs the landing check on its result: the guard
takes `git write-tree` of the index being committed (or the tree the ref moves to)
and runs the mainline's **committed** copy of `scripts/review-gate.mjs` (`git
archive` of the mainline's tip, never the working tree's, so a branch cannot rebind
its own `CRITICAL`) with `--landing <result> --base <tip>`. Its node runs with every
`NODE_*` variable unset, and only a `PASS` line passes: `the landing check refused
this merge: Landing: … RE-REVIEW — …. Re-review the delta it names on the branch,
or ask the owner to merge it.` The check is by content: each critical file of the
result must be reached from the mainline through the `baseTree → tree` changes that
cross-family review rows recorded, so a squash, an auto-merge, a conflict
resolution, a SHA, a tag, a pull or a reset is checked the same way, and needs no
state-file line. A pull trusts what the remote mainline already holds (`--trust`);
a rewind to a commit the mainline held passes. The hook reads git's objects with
replacements and grafts off, so `git replace` cannot dress an edit as a rewind. Only
the other family's rows count: the host comes from its own variables, and
`HARNESS_HOST` only where none is set. Where neither names a host, no row counts,
so an environment stripped of them fails closed; from a plain terminal the owner
lands a critical change with `HARNESS_LANDING=owner`. A
machine without `node` is refused. An install without the committed script is not
checked. `HARNESS_LANDING=owner` is the owner's override; the refusal never names
it. The command guard refuses a line that sets it (`landing-override`), a git line
that names a host variable other than to read it (`host-override`), and a fast-forward merge
onto the mainline (`merge-ff-mainline`), which the hook would refuse later and less
cleanly.
> Origin, the v10 study: an edit to critical code after its last review reached the
> mainline unread, and guards had been bypassed in five installs where the rule
> lived only in prose.

`[M]` **Its limits.** A remote-tracking mainline ref moved by hand is trusted, and
so is a `HARNESS_LANDING` or a host variable set in an earlier call of a shell that
persists, or by a file or input the line runs (a script, `source`, a heredoc fed to
a shell, a git alias, a scheduler), which the command guard never reads, and so is a
node planted outside the repository and the temporary
directories and put first on `PATH`. The hook runs a working-tree copy of the
guard, so a branch that edits `.githooks/` can run its own copy at its own merge: `GUARDS` sends
that diff to the owner, and nothing in the hook can enforce it. A moved clone runs no
hook until the install line runs again. A review row written before v10 has
no `baseTree` and does not count. An edit undone before the reviewer exits is not
seen (`treeMoved` compares the tree before and after the run). A review whose tree
moved during its run counts for nothing, so the unit review runs with no edit in
flight in its checkout. Untracked files are never in a reviewed tree: stage them
(`git add`) before the review. A file whose `assume-unchanged` or `skip-worktree`
flag hides an edit gives its review no tree, so a sparse checkout earns no landing;
clear the flags before the review. A critical path that is a symlink is checked as
its link text: bind its target as critical too. A linked `AGENTS.md` or `CLAUDE.md`
is read through its link.

`[M]` Write the merge message to a file. `git merge` does not read stdin.
