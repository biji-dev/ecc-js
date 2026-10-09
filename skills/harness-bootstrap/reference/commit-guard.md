# Reference: the commit guard

**`[M]` mechanism · `[B]` binding**

## Why a hook

`[M]` The failure it exists for is **a second session starting during a run** — in
another terminal, another agent, or a human at the keyboard. That session never
read the harness file's instructions, so a guard written as a snippet the agent
is asked to run does not exist for it. **A hook, not a habit.** Both projects that
adopted this harness first shipped the guard as a snippet; neither had a hook.

`[M]` What it refuses:

| Branch | Registry | Result |
|---|---|---|
| carries a task id | that id holds a row | allow |
| carries a task id | no row for it | **refuse** — claim the lock first |
| no task id (the mainline, anything else) | any row held | **refuse** — a run is in progress |
| no task id | no rows | allow |

## The template

`templates/harness-guard.sh` — POSIX `sh`, so it runs under Git for Windows too.
Copy it; set its three `[B]` lines; **test the shipped file**.

`[B]` `REGISTRY` path · `ID_PATTERN` · nothing else.

## Installing

- **No hook manager:** copy to `.githooks/pre-commit`, `chmod +x`, commit it, and
  `git config core.hooksPath .githooks`. Each clone runs that config once — put
  it in the project's setup script or `prepare` step so a fresh clone is guarded.
- **husky:** keep the script at `.githooks/harness-guard.sh` and call it first
  in `.husky/pre-commit`: `sh .githooks/harness-guard.sh || exit 1`.
- **lefthook:** a `pre-commit` command running `sh .githooks/harness-guard.sh`.

`[M]` If the repository already sets `core.hooksPath`, **chain into it**; never
overwrite another hook manager's setting.

`[M]` `git commit --no-verify` skips every hook. Say so in the harness file. ECC's
`block-no-verify` hook refuses that flag from an agent when it is enabled.

## Construction rules — each one cost a run

`[M]` **Key on the task id in the branch name, not a branch prefix.** The first
guard checked only "is this the mainline" and refused every commit while any run
held the lock — including the owning run's own.

`[M]` **The id pattern must match every id shape the plan has.** The default
`[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[0-9]+[a-z]?` covers `P0-12`, `T-AB-12`,
`T-I18N-003` and `T-SEC-030b`, and takes only the **first** id from a segment
branch named for a range (`P0-12-P0-11` → `P0-12`). A simpler pattern read
`T-AB-12` as `AB-12` and refused its own run. Check the pattern against the real
plan's ids before installing.

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
| # | Task | Step | Branch | Resources | Claimed (UTC) |
|---|---|---|---|---|---|
| 0 | mainline — never claimed | | | | |
<!-- /harness:active -->
```

`[M]` If the project insists on tracking the registry, the guard allows the land
step's **release commit** — one that touches only the registry and removes this
task's row. Exclude the file from the formatter either way.

## Land order

`[M]` Guard → land commit **on the task branch** (status, evidence, log row) →
release the row → merge with `--no-ff` → push. Releasing after the merge cannot
work: the guard refuses a mainline commit while any row is held. Logged three
times in one project and twice in another before it was written down.

`[M]` Write the merge message to a file. `git merge` does not read stdin.
