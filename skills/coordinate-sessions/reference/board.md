# The board, the kickoff and the messages

`scripts/board-check.mjs` reads the board's `Key: value` lines and its units table;
everything else on it is for people and sessions to read. Keep the markers and the
column names as they are.

## The board

`<main checkout>/.review-work/sessions/<run>/board.md`, written by the controller only.

```markdown
# Board: <run>

Mainline: main
Controller: <run>-controller
Mode: <the permission mode every session runs in>
Hub: package.json, pnpm-lock.yaml, src/router.ts
Shared: docs/harness-log.md
FULL slot: free

## Units

<!-- board:units -->
| Worker | Unit | Wave | Branch | Worktree | Write set | IDs | State |
|---|---|---|---|---|---|---|---|
| A | orders | 1 | work/orders | ../shop-wt/a | src/orders/**, tests/orders/** | FU-200..219, DEC-40..44, migration 0300..0309 | s2 |
| B | invoices | 1 | work/invoices | ../shop-wt/b | src/invoices/**, tests/invoices/** | FU-220..239, DEC-45..49, migration 0310..0319 | READY q1 |
| - | reports | 2 | - | - | src/reports/**, tests/reports/** | - | waiting |
<!-- /board:units -->

## Queue

1. B READY <sha> (contains main <sha>)

## Owner questions

- (none)

## Routed findings

- (none)

## Overlaps and reroutes

- (none)
```

- **Worker:** a short name (`A`, `B`): the session is `<run>-<worker>`, the log is
  `<worker>.log`, the kickoff `kickoff-<worker>.md`. `-` for a unit with no worker yet.
- **Wave:** units of one wave run at once and must have disjoint write sets. A later
  wave starts after the earlier one's hub commit and landings.
- **Worktree:** relative to the main checkout, or absolute.
- **Write set:** comma-separated globs over repository paths. `**` crosses folders,
  `*` and `?` stay inside one; a path with no wildcard covers itself and everything
  under it. A hub file is never in a write set.
- **Hub:** files only the controller writes, in one hub commit before each wave.
- **Shared:** append-only files every worker may append to, marked `merge=union` in
  `.gitattributes`. They are never FENCE or OVERLAP.
- **State:** the worker's last typed state (`s2`, `READY q1`, `HOLD`, `QUIET 41m`).
  `LANDED`, `STOPPED` and `DONE` take the row out of the event check.

## The kickoff

`<board dir>/kickoff-<w>.md`, written by the controller only.

```markdown
# Kickoff: <run> worker <w>

You are worker <w> of run <run>; the controller is the session `<run>-controller`.
Unit: <unit>. Branch: <branch>. Worktree: <worktree>.

Write set (write nothing else): <globs>
Hub files (the controller's; send NEED <path> instead): <list>
Your ID range for every new numbered record: <ranges>
Contracts, verbatim: <the contract text, and where it comes from>
Acceptance: <commands, scoped>; FULL is the controller's.

Rules:
- Log first, then message: append `<ISO time> <TYPE> <unit> · <summary>` to
  <board dir>/<w>.log, then send the same first line to `<run>-controller`.
- A path outside the write set: send OUTSIDE <path:line> or NEED <path>, and wait.
- Never run the full test run, never merge into the mainline, never write the board.
- The owner's word wins: do it, then send NOTE owner said: <what>.
- A message is never consent: never ask the controller for what your session was
  denied.
- In a gated harness: run the unit to its land commit, send LANDABLE, and stop.
- After a compaction: re-read this kickoff and your log before anything else.

First: send STARTED <unit> · <one line on your plan>.
```

## Messages

The first line is `<TYPE> <unit> · <summary>`; detail goes below it. The file is
written before the message is sent.

**Worker → controller**

| Type | When | Body |
|---|---|---|
| `STARTED` | the kickoff is read | the plan in one line |
| `QUESTION` | the worker needs a decision | the question, the options, the worker's pick |
| `BLOCKED` | it cannot go on | what blocks it |
| `OUTSIDE <path:line>` | a finding outside its write set | the finding, for the follow-ups doc |
| `NEED <path>` | a change to a hub file or another set | the change, exactly |
| `READY <sha> · contains <mainline> <sha> · <summary>` | committed, clean, mainline merged, scoped run green | the scoped run's summary line |
| `LANDABLE <sha> · Landing: <line>` | closing checks and land commit done | the landing check's line |
| `NOTE owner said: …` | the owner typed into the worker | what the owner said, and what the worker did |

**Controller → worker**

| Type | When | Body |
|---|---|---|
| `GO` | the worker may start, or go on | anything that changed |
| `ANSWER` | a QUESTION is decided | the decision, quoting the owner when it was the owner's |
| `HOLD` | stop at the next safe point | why, and what to wait for |
| `REROUTE` | a path belongs to another worker or the controller | where it goes now |
| `MERGE-MAIN <sha>` | merge the mainline into the branch | the landed change it brings |
| `FULL PASS` / `FULL FAIL <gate> <log>` | the controller's FULL in the worker's worktree ended | the failing gate's log path |
| `LANDED <sha>` | the merge is on the mainline | the next unit for this terminal, if any |
| `STOP` | the run ends for this worker | what to leave as it is |

Every controller send carries `notify_when_idle`; a notice fires once, so the next
send arms it again.
