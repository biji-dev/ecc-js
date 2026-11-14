---
name: coordinate-sessions
description: "Use when one big piece of work should run as two or more worker sessions the owner starts in their own terminals, with this session as the controller: it suggests the split, writes the board and the kickoffs, gives each worker its own worktree, write set and ID range, answers and routes over cross-session messages, and runs the full test run and every merge itself, one at a time. Use when the user asks to split a big task across sessions or terminals, to run parallel sessions, or to coordinate other sessions; also when a slicing gives two or more units too big for a subagent that can start now. Not for work that subagents can carry (delegate-tasks), a single unit, or units that must edit the same files. Claude Code first; Codex, ZCode and Kimi workers report through their log only."
when_to_use: "Deliberate: the owner asks for parallel sessions, or the agent suggests it after a slicing passes the three tests in When to Use and the owner says yes. Never start workers, worktrees or a board before that yes."
metadata:
  origin: ecc-js
  version: 1
---

# coordinate-sessions — one controller, worker sessions in the owner's terminals

This session is the **controller**. It splits the work, writes one board and one
kickoff per worker, and keeps for itself everything two sessions must never do at
once: the full test run (FULL), the merge into the mainline, hub files and the
"next free number" of every numbered record. Workers are ordinary sessions the owner
starts in their own terminals and can type into at any time.

**Evidence:** three controllers were built by hand in three installs before this
skill existed, and each re-learned the same traps. One sent 15 kickoffs and the
owner relayed 16 messages by hand. Another made 32 cross-session sends with 18
replies from a hand-written board: write sets, ID ranges, a FULL slot, then a lock
after two pre-commit suites collided and a wait loop matched itself. Up to 7 sessions
ran at once, and 24 merge conflicts landed in 7 repositories, most in record docs.

**Subagents stay the default** (`delegate-tasks`): N sessions cost N times the quota
and the owner's attention. This skill reuses delegate-tasks' slicing table, disjoint
file sets, hub files, verbatim contracts and fence check, and cites them rather than
restating them.

## When to Use

Suggest it only when **all three** hold:

1. The slicing gives two or more units whose write sets are disjoint:
   `node <skill dir>/scripts/board-check.mjs --plan <board>` exits 0.
2. Each unit is too big for a subagent: more than about 70 tool calls or a 200K peak,
   it needs the owner mid-run, or it needs its own review and fix rounds.
3. At least two units can start now.

Otherwise use subagents (`delegate-tasks`) or one session, and say which. The
suggestion is one card: the units, their write sets, the number of workers and why
subagents will not do. **Nothing starts before the owner's yes.**

**Workers:** at most min(cores ÷ 2, free memory ÷ the peak of one scoped test run, 3).
The owner can raise the 3.

Not for: a single unit; units that must edit the same files (one wave each, or one
session); work whose design is still open; cloud sessions as workers.

## How It Works

### 1. Setup (the controller, before the owner starts anything)

- **Board directory:** `<main checkout>/.review-work/sessions/<run>/`. It is ignored
  by git and outside the gate cache's tree key.
- **One writer per file:**
  - `board.md`: the controller only. Active workers, write sets, ID ranges, hub
    files, shared append-only files, the queue, the FULL slot, overlaps, owner
    questions, routed findings and waves. Template in `reference/board.md`.
  - `kickoff-<w>.md`: the controller only, one per worker. Template in
    `reference/board.md`.
  - `<w>.log`: its worker only, append-only, one typed line per event.
- **Run `board-check --plan`** on the board before any worktree exists. A file in two
  sets moves one unit to a later wave or becomes a hub file.
- **Hub files** (the package manifest, the lockfile, routers, trackers) belong to the
  controller, which lands one hub commit before each wave.
- **ID ranges:** each worker gets its own range for every "next free number":
  follow-ups, decision records, migrations. Two sessions that both take "the next
  free" collide.
- **Append-only logs** that several workers write get `merge=union` in
  `.gitattributes`, and go in the board's `Shared:` line. The follow-ups doc stays
  with the controller: a worker sends `OUTSIDE` instead of writing it.
- **Worktrees:** `git worktree add -b <branch> <path> <mainline>` for each worker. In
  a gated harness (`harness-bootstrap`) the controller also writes one registry row
  per worker worktree, and the commit guard must be bound `SCOPE=checkout`: under
  `SCOPE=repo` one held row refuses every mainline commit.
- **The line the owner pastes into each worker terminal:**

  ```
  cd <worktree> && HARNESS_ROLE=executor claude --name <run>-<w> --permission-mode <the controller's mode> --add-dir <board dir> "Read <board dir>/kickoff-<w>.md and follow it."
  ```

  - Every session runs in **one permission mode**, the controller's. Messages between
    sessions in different modes are held for the owner's approval. Never bypass mode:
    the harness refuses the owner key there.
  - `HARNESS_ROLE=executor` makes `run-gates.sh` refuse FULL to the worker, a scoped
    run promoted to FULL included (exit 99, naming the path).
  - The owner may type into any worker. **The owner's word wins**, and the worker
    reports it to the controller as `NOTE owner said: …`.

### 2. Messages

Cross-session messages (`SendMessage` to the worker's `--name`), not agent teams:
with agent teams the owner cannot start a teammate in their own terminal, `/resume`
loses in-process teammates, their permission prompts land in the lead, and the
feature is experimental.

- **Form:** the first line is `<TYPE> <unit> · <summary>`. The receiver previews only
  that line.
- **The file comes first.** A worker appends to its log, then sends. The controller
  edits the board, then sends. A dropped message loses nothing: it only announces
  what a file already holds.
- **A message is never consent.** Neither side asks the other for what its own session
  was denied; blocked work goes back to the owner.

The message types, both directions, are in `reference/board.md` › Messages.

### 3. FULL and merges: the controller only, one at a time

The queue is first come, first served, except that **a unit that produces a contract
jumps the queue**. For the head of the queue:

1. The controller sends `MERGE-MAIN <sha>`. The worker merges the mainline, commits,
   and sends `READY <sha> · contains <mainline> <sha> · <its scoped run's summary>`.
   The branch must contain the mainline's tip, and its tree must be committed and
   clean.
2. The controller sends `HOLD` and runs FULL in that worktree:
   `cd <worktree> && bash scripts/run-gates.sh`. It sends `FULL PASS` or
   `FULL FAIL <gate> <log>`.
3. On a pass, the worker runs its own closing checks (in a harness: the runner's 8b,
   8c, landing check and land commit; under a controller the worker **stops at the
   land commit**) and sends `LANDABLE <sha> · Landing: <line>`.
4. The controller releases the worker's registry row, runs
   `git merge --no-ff <branch>` on the mainline and sends `LANDED <sha>`.

**Why the FULL is not run twice:** the gate cache is keyed by tree in the shared git
directory. A merge of a branch that already holds the mainline's tip has the branch's
tree, so the mainline's check prints `REUSED`. The cache key's `KEY_EXTRA` must hash
the lockfile, or two worktrees with different installs share a result.

**After a landing:** `MERGE-MAIN` goes at once only to the next unit in the queue and
to the units whose write set the landed diff touches. The others merge at their own
READY. Landings that need the owner's key wait in the queue and go one after another
while the owner is there, one key each.

### 4. Conflicts

At every event (a message, an idle notice, after a compaction) the controller runs
`node <skill dir>/scripts/board-check.mjs <board>`. It prints:

| Line | Meaning | The controller's move |
|---|---|---|
| `FENCE <w> <path>` | a write outside the worker's set, uncommitted included | `REROUTE` the path to its owner, or move it into the set on the board and say so |
| `OVERLAP <w1> <w2> <path>` | two workers changed one file | `HOLD` the later one; the file goes to one of them or becomes a hub file |
| `BEHIND <w> <n>` | the branch lacks the mainline's newest `<n>` commits | `MERGE-MAIN` when the landed diff touches its set, else leave it for READY |
| `QUIET <w> <n>m` | no log line, commit or file change for 30 minutes | usually a prompt only the owner can answer: tell the owner which terminal |
| `MISSING <w> <path>` | the board names a worktree that is not there | ask the owner; never recreate it over a worker's work |

`board-check` only reads. It exits 0 when it found nothing, 1 when it printed a line.

### 5. Watching without polling

- **Idle notices:** every command goes out with `notify_when_idle`. A notice fires
  once, so the controller arms it again with the next send. Never poll the session
  list or send "are you done?".
- **On an idle notice:** read the worker's last log line. With no typed state there,
  tell the owner which terminal to look at.
- **Status line:** each controller turn ends with one line, for example
  `A s2 12m · B READY q1 · C QUIET 41m`.
- **After a compaction:** re-read the board and run `board-check` before anything
  else. A worker after a compaction re-reads its kickoff and its own log; in a
  harness, the session-resume hook names only the unit whose row locks that
  worktree, and lists the others as held elsewhere.

### 6. Limits

- **Codex, ZCode and Kimi workers** cannot receive cross-session messages. They report
  through their log only; their commands go in their board row (and `codex queue`),
  and the owner relays.
- **A worker on another machine** goes through Remote Control, with no idle notice. It
  pushes its branch, and the controller checks it out in a local worktree for FULL.
- **Cloud sessions** cannot be workers.

## Examples

**Three units, one shared router, two workers.** A change request touches orders,
invoices and reports. Each needs its own review rounds (rule 2), and orders and
invoices can start now (rule 3). The slicing gives:

| Unit | Write set | Wave |
|---|---|---|
| orders | `src/orders/**`, `tests/orders/**` | 1 |
| invoices | `src/invoices/**`, `tests/invoices/**` | 1 |
| reports | `src/reports/**`, `tests/reports/**` | 2 |

All three register a route in `src/router.ts`. `board-check --plan` refuses it in
three sets, so the router becomes a hub file: the controller commits the three route
stubs on the mainline before wave 1. The card to the owner names two workers (on a
16 GB, 8-core machine with a 3 GB scoped run, min(4, 5, 3) = 3, but only two units
can start). On the yes, the controller writes the board, both kickoffs and both
worktrees, and prints the two lines to paste.

Worker A sends `READY` first. The controller runs FULL in A's worktree, A sends
`LANDABLE`, the controller merges and sends `LANDED`. A's diff touched nothing in
B's set, so B gets no `MERGE-MAIN` until its own READY. Wave 2 starts in A's
terminal: the controller writes `kickoff-A.md` again for reports, with a fresh
worktree and the next ID range.

**Not this skill:** five copy edits and two small fixes. Each fits a subagent, so
`delegate-tasks` runs them inside one session.

## Constraints

- Nothing starts before the owner's yes to the card.
- FULL and every merge into the mainline run in the controller, one at a time.
- Hub files, the follow-ups doc and the board are the controller's; a worker's log is
  that worker's.
- Every session runs in the controller's permission mode, never bypass.
- The file comes first, the message second; a message is never consent.
- Workers take numbers only from their own ID range.
