---
name: coordinate-sessions
description: "Use when one big piece of work should run as two or more worker sessions the owner starts in their own terminals, with this session as the controller: it suggests the split, writes the board and the kickoffs, gives each worker its own worktree, write set and ID range, answers and routes over cross-session messages, and runs the full test run and every merge itself, one at a time. Use when the user asks to split a big task across sessions or terminals, to run parallel sessions, or to coordinate other sessions; also when a slicing gives two or more units too big for a subagent that can start now. Not for work that subagents can carry (delegate-tasks), a single unit, or units that must edit the same files. Claude Code first; Codex, ZCode and Kimi workers report through their log only."
when_to_use: "Deliberate: the owner asks for parallel sessions, or the agent suggests it after a slicing passes the three tests in When to Use and the owner says yes. Never start workers, worktrees or a board before that yes."
metadata:
  origin: ecc-js
  version: 2
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

**Workers:** at most min(cores ÷ 2, 3, n + free memory ÷ the peak of one scoped test
run) **over every worker on the machine**, every project's runs included, where n is
the workers already running (free memory is measured with them in it; on macOS, free,
inactive, speculative and purgeable pages). Each controller registers its run
(`board-check.mjs --host --register <board>` at setup, `--release` when the run ends),
and `board-check.mjs --host` prints `HOST <n> workers in <m> runs (cap <c>; <g> GB
free by vm_stat|freemem)`, each run's workers read from its board now; at the cap it
prints `HOST AT CAP: start no new worker`. A run whose board and logs were not written
for 6 hours is printed as `HOST STALE <run> <board>` and not counted. The owner can raise the 3.
> Origin, the v12 study: 16 sessions at once on a 10-core, 16 GB machine, because
> five projects each computed the cap alone and the caps added up to 15.

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
  sets, or two globs that could both match a file one unit will create, moves one unit
  to a later wave or becomes a hub file.
- **Hub files** (the package manifest, the lockfile, routers, trackers) belong to the
  controller, which lands one hub commit before each wave.
- **ID ranges:** each worker gets its own range for every "next free number":
  follow-ups, decision records, migrations. Two sessions that both take "the next
  free" collide.
- **Append-only logs** that several workers write get `merge=union` in
  `.gitattributes`, and go in the board's `Shared:` line. The follow-ups doc stays
  with the controller: a worker sends `OUTSIDE` instead of writing it.
- **Worktrees:** `node <skill dir>/scripts/worktree-add.mjs --branch <branch> --path
  <path> --base <mainline> --board <board>` for each worker. It runs `git worktree
  add` under umask 022, symlinks the main checkout's `.env*` files (never copies
  them), copies what git does not carry (`[B] COPY`: `.claude/plans`, an install's
  certificates), runs the board's `Setup:` line (the install command), writes `core.hooksPath` back
  as an absolute path in the main checkout (`HOOKS restored <value>`: the config is
  shared, and a hook path in a worktree dies with it), and deletes `[B] LEFTOVERS`.
  No `.env*` file is ever copied, a `COPY` folder's included. It ends on
  `WORKTREE READY <path>`, or `WORKTREE FAILED <step>: <reason>`. In a gated harness
  (`harness-bootstrap`) the controller also writes one registry row per worker
  worktree, and the commit guard runs at its default `SCOPE=checkout`, one lock per
  worktree: under `SCOPE=repo` one held row refuses every mainline commit, so an
  install still on `repo` switches before the first worker starts.
  > Origin, the v12 study: three installs fixed these setup steps by hand, and one ran
  > strictly one unit at a time for 40 hours under `SCOPE=repo`.
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
READY. A never-auto product unit merges like any other and reaches the owner on the
deploy list. Only a diff to `GUARDS` or a harness upgrade needs the owner key: the
controller runs the merge hook's checks for each first, on a branch that holds the
mainline tip, asks in one chat line (`2 guard merges ready: <branch>, <branch> —
merge?`), keeps serving its workers, and on the yes runs each
`HARNESS_LANDING=owner git merge --no-ff <branch>` itself, one at a time, so each
dialog appears while the owner is looking (harness-bootstrap › The owner key). It
never prints a command for the owner to type.

### 4. Conflicts

At every event (a message, an idle notice, after a compaction) the controller runs
`node <skill dir>/scripts/board-check.mjs <board> --transcripts`. It prints:

| Line | Meaning | The controller's move |
|---|---|---|
| `FENCE <w> <path>` | a write outside the worker's set or to a hub file, uncommitted included | `REROUTE` the path to its owner, or move it into the set on the board and say so |
| `OVERLAP <w1> <w2> <path>` | two workers changed one file | `HOLD` the later one; the file goes to one of them or becomes a hub file |
| `BEHIND <w> <n>` | the branch lacks the mainline's newest `<n>` commits | `MERGE-MAIN` when the landed diff touches its set, else leave it for READY |
| `QUIET <w> <n>m` | no log line, commit or file change for 15 minutes | read its `PROMPT`, `IDLE` or `NOTRANSCRIPT` line and act on that |
| `PROMPT <w> <tool> <n>m` | the oldest tool call with no result for 5 minutes or more (a foreground Bash only past its timeout plus 60 s; an agent, task or workflow call never): the worker waits on a dialog | tell the owner the terminal (its row and worktree) and the tool; only the owner can answer it |
| `IDLE <w> <n>m` | the turn ended on no state line, or on `RUNNING` with nothing running: no agent, workflow, Monitor or background shell open | send `GO <next step>` or `PING`; never the owner |
| `NOTRANSCRIPT <w> <dir>` | no Claude Code transcript for that worktree, neither under its own folder nor under the main checkout's with the worktree as its last `cwd` (a session that entered it); `(<n> candidates)` when two or more of those match and none is picked | `PING`; the owner only after 2 `PING`s go unanswered |
| `MISSING <w> <path>` | the board names a worktree that is not there | ask the owner; never recreate it over a worker's work |

`board-check` only reads (`--host --register` and `--release` write the host
registry). It exits 0 when it found nothing, 1 when it printed a line.
> Origin, the v12 study: every project had a silent stall of an hour or more, the
> longest 353 minutes — a prompt nobody saw, a turn that ended on `RUNNING` with
> nothing running, an out-of-memory kill nobody reported — and the skill sent the
> controller to tell the owner which terminal instead of acting.

### 5. Watching without polling

- **Idle notices:** every command goes out with `notify_when_idle`. A notice fires
  once, so the controller arms it again with the next send. Never poll the session
  list or send "are you done?".
- **The watchdog:** `node <skill dir>/scripts/board-check.mjs --watch <board> --every
  600`, started with the host's background option (Claude Code: the Bash tool's
  `run_in_background`). It runs the event check with `--transcripts` every 10
  minutes and exits 1 on its first **new** finding, so its completion notice wakes
  the controller: a wait on a notice, not a sleep loop. The lines that stand at its
  first check (`BEHIND` before `READY`, `NOTRANSCRIPT` for a Codex worker) are its
  baseline, printed once as `WATCH BASELINE <n> standing findings`; the controller
  acts on those from its own event check. A standing `IDLE` or `PROMPT` fires again
  once it has grown by 30 minutes, and a line that clears and comes back is new. After
  240 minutes it ends `WATCH END <n> checks, nothing found` (or `<k> still standing`)
  with exit 0. It arms the watch again after each event and each end.
- **On an idle notice:** run the event check and act on its line (§4). A notice is
  dismissed as a duplicate only when the worker's log or transcript shows activity
  after it.
- **Workers by row and worktree:** the controller names a worker to the owner by its
  board row and worktree, never by session name alone.
- **A fresh session after 2 units or a compaction:** a worker whose second unit
  landed, or which compacted, ends at its next `LANDED` on `DONE — <what landed>;
  nothing runs here, close this terminal`, and the controller writes its next
  kickoff with one line to paste.
  > Origin, the v12 study: one worker ran 11 compactions at 170–220K contexts.
- **Status line:** each controller turn ends with one line, for example
  `A s2 12m · B READY q1 · C QUIET 41m`, and adds `owner: <n> open` when something
  waits on the owner. Workers end their turns on the state lines in
  `reference/board.md` › The kickoff.
- **After a compaction:** re-read the board and run `board-check` before anything
  else. A worker after a compaction re-reads its kickoff and its own log, and
  re-enters its worktree only when `git rev-parse --show-toplevel` differs from the
  kickoff's: it never calls EnterWorktree on the directory it is in. In a harness,
  the session-resume hook names only the unit whose row locks that worktree, says
  `do not re-enter` when the session is already in it, and lists the others as held
  elsewhere.
  > Origin, the v12 study: workers re-entering the worktree they were in lost one
  > install 851 worker-minutes.

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
