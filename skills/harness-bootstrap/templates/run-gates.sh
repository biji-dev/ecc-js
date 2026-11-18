#!/usr/bin/env bash
# harness-bootstrap run-gates (generated YYYY-MM-DD)
# [M] mechanism, ship as-is: the never-bail loop, per-gate log files, the result-line
#     format, exit status = number of failed gates, the --since scoped mode, the --snapshot
#     commit mode, the result cache keyed by tree, the single-flight lock, the
#     instant-failure note, the per-gate timeout, the admission step and its host lease, the
#     executor refusal, the known-red baseline, the paths mode, the flaky retry and its register.
# [B] binding, re-derived per project: the gate list between the harness:gates markers,
#     the SCOPED_PATHS, SNAPSHOT_COPY, ADMIT, GATE_TIMEOUT, MAINLINE, PRODUCT_PATHS, RECORDS,
#     RETRY_FLAKY, GATE_JOBS and SERIAL lines.
#
# Usage: bash scripts/run-gates.sh [--since <ref> | --snapshot] [--no-cache] | --list
#   Invoke it with bash (`bash scripts/run-gates.sh`), not sh or dash: it uses arrays.
#   (no args)        FULL run: every gate, on the working tree.
#   --since <ref>    SCOPED run: skips `full` gates. The changed files are worked out
#                    here (git diff against <ref> plus untracked files) because a
#                    package manager's "changed since" filter ignores uncommitted
#                    edits. A change outside SCOPED_PATHS promotes the run to FULL.
#   --snapshot       FULL run on the commit: the gates run in a throwaway detached worktree
#                    of HEAD (a temp dir; no git hook runs) holding a copy of each
#                    SNAPSHOT_COPY entry the commit lacks (node_modules, untracked .env*),
#                    copy-on-write where the disk can. No other untracked or ignored file
#                    reaches a gate. Tracked or staged changes are refused (exit 99, listed);
#                    untracked files are counted ("not in this run: <n> untracked file(s)").
#                    The worktree and its temp dir are removed on EXIT, INT and TERM.
#                    Not with --since.
#   --no-cache       run the gates even when a cached all-PASS result exists for this tree
#                    (RUN_GATES_NO_CACHE=1 does the same). A passing run still refreshes the cache.
#   --list           print "<name> <mode>" per gate and exit 0.
#   With HARNESS_ROLE=executor (codex-run and claude-run set it for every run they start) a run
#   with neither --since nor --list exits 99 before anything runs, saying on stderr: "run-gates:
#   FULL is the session's, once at landing; an executor runs bash scripts/run-gates.sh --since
#   <the slice's base>". --snapshot is a FULL run and is refused too; --list still works. A --since
#   run that a change outside SCOPED_PATHS promotes to FULL exits 99 too, before the cache, admission,
#   the lock or a gate (and so does one promoted after a lock or machine wait), saying on stderr:
#   "run-gates: PROMOTED to FULL by <path>, outside SCOPED_PATHS: FULL is the session's, once at
#   landing; an executor stops and reports the path".
#   A gate name registered twice, a PRODUCT_PATHS or RECORDS grep -E cannot read or that matches an
#   empty path (so every path: '.*'), and a SERIAL name that is no gate exit 99 before anything runs.
# Gates: `gate <name> <always|full|paths> '<command>'` passes when the command exits 0.
#   `gate_counted <name> <always|full|paths> '<regex>' '<command>'` also needs the command's
#   combined output, colour codes stripped, to match the extended regex, so a runner that
#   ran zero tests (or skipped them all) and exited 0 is a FAIL, not a PASS. Run a test
#   runner through scripts/run-counted.mjs: it reads the runner's own summary and prints
#   `COUNTED <kind> <n> passed (min <m>)` only when nothing failed, was skipped or went
#   unrun, so the regex is '^COUNTED <kind> [1-9][0-9]* passed'.
# Paths mode: a `paths` gate is for tests that read only the harness (or any part that is not the
#   product), so a change that touches only the product need not run them. [B] PRODUCT_PATHS is an
#   extended regex of the product's paths (env RUN_GATES_PRODUCT_PATHS overrides); empty = off, and a
#   `paths` gate then runs as `full`. A FULL run prints
#     SKIP <name> (no path outside PRODUCT_PATHS changed since <12-hex merge base>)
#   only when the paths changed since merge-base(refs/heads/<MAINLINE>, HEAD) (committed, staged,
#   unstaged and untracked; for --snapshot, the commit against merge-base(<MAINLINE>, <commit>)),
#   minus .review-work/, the log dir and RECORDS, are not none and every one matches PRODUCT_PATHS. It
#   runs the gate on the mainline's tip itself (HEAD there), with no mainline or no merge base, with
#   nothing changed and when a git command fails. A scoped run runs it when a changed path is outside
#   PRODUCT_PATHS, and prints the SKIP line with the --since commit otherwise (nothing changed too).
#   The run-or-skip decision joins the cache variant, so a skipped run never answers one that runs it.
# Output: one line per gate, in registration order, then a SUMMARY line:
#   PASS <name> <secs>s <logpath> | FAIL <name> <secs>s <logpath> (exit <n>)
#   | FAIL <name> <secs>s <logpath> (no count line matched)
#   | FAIL <name> <secs>s <logpath> (timeout after <n>s) | SKIP <name> (full only)
#   | SKIP <name> (no path outside PRODUCT_PATHS changed since <12-hex commit>)
#   | KNOWN <name> <secs>s <logpath> (<n> failing test(s) in the <mainline> baseline, their files untouched)
#   | PASS <name> <secs>s <retry logpath> (flaky: <id>[; <id>...], retried)
#   SUMMARY <p> passed, <f> failed, <s> skipped[, <k> known] (<full|scoped>)
#   A refused admission prints "NOT ADMITTED (exit <n>)" instead and exits 97: no gate ran, no SUMMARY.
#   A FAIL in under RUN_GATES_INSTANT_SECS seconds (default 10) ends with
#   " (instant: if the log shows no real failure, check the command/env before re-running)":
#   a gate that dies at once is often the command or the environment, not the code (a
#   genuine fast failure gets the note too, so read the log first).
#   A --snapshot run prints "input: commit <short sha>" (and the untracked count) after the
#   "logs:" line.
# Known reds: a FULL run with HEAD at the tip of refs/heads/<MAINLINE> ([B], default main; env
#   RUN_GATES_MAINLINE overrides, empty = off), on the branch or detached, and no tracked change (or
#   a --snapshot run there) records, per gate, its commit and the failing test ids its log names
#   (`run-counted: FAILED <file> :: <title>`, the trailing block run-counted prints) under the
#   cache dir, and clears a gate's record when it passes, times out, misses its count line or names
#   a failure it cannot (`run-counted: FAILED ?`). The records are written after the last gate, and
#   only when HEAD and the tracked tree (the snapshot's, for --snapshot) are still those the run
#   started on. Any other run, FULL or scoped, prints a gate that exited non-zero as KNOWN instead
#   of FAIL when its command is one run-counted call (no `;`, `&`, `|` or newline), its record was
#   made at the merge base with the mainline or after it (an older one would hide a fix made since),
#   every failing test it names is in that record, and each of their files is a file of the tree
#   (the path relative to the top) that the merge base has, that did not change since it
#   (committed, uncommitted or untracked) and that holds the test's title. A path printed from
#   inside a package names its file by vitest's RUN root; another runner's names the one file git
#   lists that it is the tail of, where an ignored test file is not listed (so one the runner runs
#   can be taken for a listed file of the same tail) and a tree with a submodule or nested
#   repository is not searched (idFile in run-counted-core.mjs). A KNOWN gate does not
#   count in the exit status and starts no fix round; a run with one is never cached. The
#   mainline's own run prints its reds as FAIL. No record, no merge base, a timeout, a missed count
#   line, output after the FAILED block or a `FAILED ?` line: FAIL.
# Flaky retry: with [B] RETRY_FLAKY=1 (env RUN_GATES_RETRY_FLAKY overrides; 0 = off) a gate that
#   FAILs, and is not KNOWN, runs once more when its command is one run-counted call, it exited
#   non-zero (not a timeout, not a missed count line) after RUN_GATES_INSTANT_SECS or more, its log
#   ends with a FAILED block naming every failure (no `FAILED ?`, one ` :: ` per id), and each failing
#   test's file is a file of the tree (relative to the top) that the merge base with the mainline has,
#   that did not change since it (committed, uncommitted or untracked; no mainline or no merge base:
#   no retry) and that holds the test's title, as for a known red. A red the branch causes in a test
#   file it did not touch is retried too: a second fail prints FAIL; a pass is a flake in the register.
#   A pass on the retry prints the flaky PASS line above, with the retry's log and both runs' time,
#   appends {"at","gate","ids","tree","top"} as one JSON line to <cache dir>/flakes.jsonl (shared by
#   every worktree) and counts as a PASS, so the run can be cached. A second fail prints FAIL, as the
#   first would have.
# Timeout: each gate runs in a process group of its own (set -m around its launch; the group id is
#   its pid). Past GATE_TIMEOUT seconds ([B], default 3600; env RUN_GATES_GATE_TIMEOUT overrides,
#   0 = no limit) the group gets TERM, then KILL 10 s later, and the gate is a FAIL ending
#   "(timeout after <n>s)". When a gate ends, whatever it left running in its group gets TERM, and
#   KILL after 10 s: a gate's children in its process group never outlive it. INT or TERM to run-gates stops the running
#   gate's group the same way before the EXIT cleanup (snapshot, lock). With no group (set -m made
#   none) the signals go to the gate's pid alone, never to run-gates' own group. A run-gates killed
#   with KILL runs no trap: each gate's watchdog sees it gone within a second and stops the gate's
#   group the same way (GATE_TIMEOUT 0 starts no watchdog, so nothing does).
# Parallel gates: [B] GATE_JOBS (env RUN_GATES_GATE_JOBS overrides; default 1 = one gate at a time,
#   in the run-gates shell) gates run at once, each in a background worker of its own with its own
#   process group, watchdog, log and retry. The result lines still print in registration order, each
#   once every gate before it has printed, so the output, the SUMMARY, the record and the exit status
#   are those of a GATE_JOBS=1 run; only the seconds differ. [B] SERIAL (env RUN_GATES_SERIAL) names
#   gates, space-separated, that run alone: one starts once every running gate has ended, and no gate
#   starts while it runs (a gate that binds a port or rebuilds a shared dir). A SERIAL name that is no
#   gate exits 99. INT or TERM stops every running gate's group, as for one.
# Admission: a FULL run only (a scoped run is never held), after the cache check and before the lock
#   (so a run waiting on the machine holds no lock, and one waiting on the lock waits only for the
#   gates), the "logs:" line, the snapshot and the first gate, `$ADMIT --holder <run-gates' pid> --top
#   <repo top>` runs ([B] ADMIT, scripts/lib/admission.mjs: memory, disk, load and the host lease, one of
#   LEASE_SLOTS slot files in ~/.harness/leases, HARNESS_LEASE_DIR overrides, printed `LEASE <path>`;
#   with every slot held by a live run it waits as for memory). The EXIT trap removes the slot (the one
#   printed and any naming this pid), and a run a wait turns scoped removes it then: a scoped run never
#   holds one; a slot whose run died is taken over by the next. A run that then waits for this
#   worktree's lock keeps its slot through the wait, so a FULL run in another worktree may wait on
#   "lease held" meanwhile: the slots bound FULL runs admitted, not only those running gates. Its
#   stdout is passed through once it
#   ends (`ADMISSION ...`, after a wait `MACHINE WAIT <ISO> → <ISO> <reason>`; never part of a cache
#   record); its stderr goes straight through. It runs in the background under `wait`, in a process
#   group of its own (`set -m`), so INT or TERM ends the run at once: the group gets TERM (a compound
#   ADMIT's node, not only the bash wrapping it), or the admission's pid alone when set -m made no
#   group, the group and the pid are checked every 0.1 s and get KILL when either is still there
#   after 100 sleeps, only then is the admission reaped, and what it printed (the CLI's closing pair
#   included) is passed through. A non-zero exit prints "NOT ADMITTED (exit <n>)" and exits 97. After
#   a wait the changed files, the mode, the variant and the tree are worked out again and the cache
#   is read again, as after a lock wait. A cache hit never runs it. After a lock wait that is not a
#   cache hit, a FULL run runs it once more, given `--wait 0 --holder <pid> --top <repo top>`, while it holds the
#   lock: the machine may have gone short meanwhile; a refusal exits 97 (the EXIT trap releases the
#   lock); it never waits for the machine holding the lock. So an ADMIT override must not fix its
#   own --wait (the CLI refuses a repeated flag: exit 2, so 97).
# Reuse: the working tree (tracked, staged, unstaged and untracked files, minus
#   .review-work/, the log dir and every path RECORDS matches) is hashed with `git write-tree` into a
#   temporary index; the real index is never touched. [B] RECORDS (an extended regex, env
#   RUN_GATES_RECORDS overrides, empty = off) names the run's own records, the state files and step
#   ledgers a land commit adds: they leave the key, the scoped changed list and the paths diff, so the
#   land commit and the merge after a FULL run print REUSED (not the run on the mainline after the
#   merge when a `paths` gate skipped on the branch: the mainline's tip runs it, another variant, and
#   every gate runs). Bind it only to files no gate's result depends on (the agent-docs gate's
#   state-file budget only warns). A run with every gate PASS is recorded under that tree,
#   the mode (full or scoped:<since-sha>), the bound gate list, the KEY_EXTRA output and
#   NODE_OPTIONS (hashed, never stored; unset = empty: it changes what every node child runs).
#   The next run for the same tree, mode, gates, extra and NODE_OPTIONS prints, instead of
#   running anything:
#     REUSED <tree> <time of the original run>
#     <the original result lines and SUMMARY line>            (exit 0)
#   A run is recorded only if the tree is still the same after the gates ran; otherwise it
#   prints "NOT CACHED tree changed during the run" on stderr (a gate that writes files into
#   the tree, or an edit made meanwhile: the result may describe neither tree). A FAIL is
#   never recorded. Not a reusable state (no commit yet, no git index to hash): runs normally.
#   A --snapshot run is keyed by the commit's tree (minus RECORDS), under a mode of its own (snapshot), and
#   is recorded only if no gate changed a tracked file in the snapshot.
#   [B] Docs-only reuse is OFF unless the DOCS_ONLY pattern (an extended regex; env
#   RUN_GATES_DOCS_ONLY overrides, empty = off) is set: a tree that differs from a recorded
#   one only in matching paths then reuses the newest such record with the first line
#   "REUSED <tree> docs-only change since <time of the original run>". Bind it only when no
#   gate reads the matched paths: a gate that reads .md files (a docs linter, an agent-doc
#   check, a grep over README.md) would be answered by a stale PASS.
#   [B] The key covers tracked, staged, unstaged and untracked-not-ignored files; ignored
#   inputs (node_modules, .env, build output) and refs are NOT in it unless KEY_EXTRA names
#   them. KEY_EXTRA is a shell command whose stdout is hashed into the key (env
#   RUN_GATES_KEY_EXTRA overrides, empty = nothing), e.g.
#     KEY_EXTRA='cat pnpm-lock.yaml node_modules/.modules.yaml 2>/dev/null; git rev-parse origin/main; node --version; pnpm --version'
#   It runs under `bash -c` with no stdin, so write it in single quotes (double quotes inside);
#   its output is hashed, never stored.
#   Worktrees of one repository share the cache (same tree, same result), so a worktree
#   whose ignored inputs differ needs KEY_EXTRA to name them. Keep the cache dir out of any
#   writer's reach (a sandboxed Codex run must not be able to write a PASS record): the
#   default is under the git common dir, outside the working tree.
# Lock: one run per worktree and mode at a time, taken after admission. A second run prints
#   "WAITING for run <pid>" on stderr, polls every RUN_GATES_LOCK_POLL seconds (default 5) for up to
#   RUN_GATES_LOCK_WAIT seconds (default 1800), then works out the changed files, the mode
#   (scoped or promoted to full), the cache variant and the tree again and looks at the
#   cache before it runs (the other run's result is usually a hit). Once the wait ends it prints
#   "MACHINE WAIT <ISO> → <ISO> lock run <pid>" on stderr. When that changed the mode (a scoped
#   run promoted to FULL), it releases the lock it holds, runs admission (a FULL run) and takes
#   the new mode's lock (waiting as usual), then makes these checks again. A lock whose pid is dead
#   is taken over (only while it still names that pid); a lock is removed only by its owner;
#   after the wait limit the run goes ahead without the lock.
# Exit status = number of FAIL lines (capped at 98; KNOWN lines do not count); 97 = not admitted (no SUMMARY line);
#   99 = usage error (including no gates bound, a refused --snapshot, a snapshot that could
#   not be built and a FULL run under HARNESS_ROLE=executor, a promoted one included).
# Known limits: a gate's child that starts its own session (setsid, a daemon) outlives the gate:
#   the gate must stop what it starts. --snapshot does not see an edit to a file whose index entry
#   has the skip-worktree bit (git status hides it): a sparse checkout sets that bit on every file
#   outside its cone, so refusing it would refuse every snapshot there.
# Env: RUN_GATES_LOG_DIR overrides the log dir. Each gate runs in the repo top (in the
#      snapshot under --snapshot) and sees RUN_GATES_MODE=full|scoped,
#      RUN_GATES_SINCE=<ref or empty>, RUN_GATES_CHANGED_FILE=<changed-file list, scoped only>,
#      RUN_GATES_TOP=<that directory> (run-counted names failing test files relative to it).
#      RUN_GATES_SNAPSHOT_COPY overrides SNAPSHOT_COPY.
#      RUN_GATES_CACHE_DIR overrides the cache dir (default: run-gates-cache inside the git
#      common dir, which worktrees of one repository share). RUN_GATES_NO_CACHE,
#      RUN_GATES_DOCS_ONLY, RUN_GATES_KEY_EXTRA, RUN_GATES_LOCK_WAIT, RUN_GATES_LOCK_POLL,
#      RUN_GATES_INSTANT_SECS: above. RUN_GATES_ADMIT overrides ADMIT (empty = no admission).
#      RUN_GATES_GATE_TIMEOUT overrides GATE_TIMEOUT (seconds; 0 = no limit).
#      RUN_GATES_MAINLINE overrides MAINLINE (empty = no known-red baseline, no paths skip and no
#      flaky retry). RUN_GATES_PRODUCT_PATHS, RUN_GATES_RECORDS, RUN_GATES_RETRY_FLAKY,
#      RUN_GATES_GATE_JOBS, RUN_GATES_SERIAL: above.
#      HARNESS_ROLE=executor refuses a FULL run, a promoted one included (see Usage).

if [ -z "${BASH_VERSION:-}" ]; then
  echo "run-gates: needs bash (it uses arrays); run it as: bash scripts/run-gates.sh" >&2
  exit 99
fi

set -u

usage() {
  echo "run-gates: $1" >&2
  echo "usage: run-gates.sh [--since <ref> | --snapshot] [--no-cache] | --list" >&2
  exit 99
}

GATE_NAMES=()
GATE_MODES=()
GATE_CMDS=()
GATE_RXS=()
# A gate's log, timeout mark and retry log are named after it, so a name is registered once.
new_gate_name() {
  local gn
  [ "${#GATE_NAMES[@]}" -gt 0 ] || return 0
  for gn in "${GATE_NAMES[@]}"; do [ "$gn" != "$1" ] || usage "gate '$1' is registered twice"; done
}
# gate <name> <always|full|paths> '<command>' only registers; the runner executes after the block.
gate() {
  [ "$#" -eq 3 ] && [ -n "$3" ] || usage "gate '${1:-}': expected exactly: gate <name> <always|full|paths> '<command>' (quote the command, and do not leave it empty)"
  case "${2:-}" in
    always | full | paths) ;;
    *) usage "gate '${1:-}': mode must be always, full or paths" ;;
  esac
  new_gate_name "$1"
  GATE_NAMES+=("$1")
  GATE_MODES+=("$2")
  GATE_CMDS+=("$3")
  GATE_RXS+=("")
}
# gate_counted <name> <always|full|paths> '<regex>' '<command>' registers a gate that passes only when
# the command exits 0 AND its combined output, colour stripped, matches the extended regex
# (with scripts/run-counted.mjs as the command: '^COUNTED vitest [1-9][0-9]* passed').
gate_counted() {
  [ "$#" -eq 4 ] && [ -n "$3" ] && [ -n "$4" ] || usage "gate '${1:-}': expected exactly: gate_counted <name> <always|full|paths> '<regex>' '<command>' (quote both, and do not leave either empty)"
  case "${2:-}" in
    always | full | paths) ;;
    *) usage "gate '${1:-}': mode must be always, full or paths" ;;
  esac
  local rc=0
  printf '' | grep -Eq -- "$3" 2>/dev/null || rc=$?
  [ "$rc" -le 1 ] || usage "gate '$1': the count regex is not a valid extended regex: $3"
  new_gate_name "$1"
  GATE_NAMES+=("$1")
  GATE_MODES+=("$2")
  GATE_CMDS+=("$4")
  GATE_RXS+=("$3")
}

# >>> harness:gates [B] — one line per gate: gate <name> <always|full|paths> '<command>'
# Every example is commented out: bind the project's own gates here. With none bound the
# runner exits 99 instead of reporting a green run of nothing.
# gate typecheck always 'npm run -s typecheck'
# gate lint always 'npm run -s lint'
# gate test always 'npm test'
# gate build full 'npm run -s build'
# A runner's own cache (turbo, nx) only hides a stale result, as run-gates already reuses by tree: turbo run <task> --force, nx run-many … --skip-nx-cache.
# A test gate counts what ran: run-counted fails on a skip, a filter that matched nothing or a
# pass count under the floor (--min: today's count; it prints the raise when the count grows).
# gate_counted test always '^COUNTED vitest [1-9][0-9]* passed' 'node scripts/run-counted.mjs --kind vitest --min 1 -- npx vitest run'
# the harness's own tests skip a FULL run whose every change is in PRODUCT_PATHS (see Paths mode)
# gate_counted harness paths '^COUNTED node [1-9][0-9]* passed' 'node scripts/run-counted.mjs --kind node --min 1 -- node --test --test-reporter=tap scripts/lib/*.test.mjs'
# a scoped run may run only the tests related to the changed files (vitest related, jest --findRelatedTests)
# gate_counted test always '^COUNTED vitest [1-9][0-9]* passed' 'if [ "$RUN_GATES_MODE" = scoped ]; then node scripts/run-counted.mjs --kind vitest --min 1 -- npx vitest related --run $(cat "$RUN_GATES_CHANGED_FILE"); else node scripts/run-counted.mjs --kind vitest --min 1 -- npx vitest run; fi'
# <<< harness:gates

# [B] extended regex for the paths a scoped run may cover; a change outside it runs FULL.
SCOPED_PATHS='^(src|apps|packages|lib|docs|tests?)/|\.md$'
# [B] docs-only reuse: extended regex of paths no gate reads; empty = off (see Reuse above).
DOCS_ONLY=''
# [B] extra cache-key input: a shell command whose stdout joins the key; empty = nothing.
KEY_EXTRA=''
# [B] --snapshot: what the gates need that the commit lacks, copied from the working tree
# (globs, relative to the repo top; an entry the commit has comes from the commit). A
# monorepo adds each package's own: 'node_modules apps/*/node_modules packages/*/node_modules .env*'.
# A name with no glob character that is missing is a usage error.
SNAPSHOT_COPY='node_modules .env*'
# [B] admission: the command run before a FULL run's gates (see Admission above), given --top <repo
# top>; a non-zero exit refuses the run (97). Its floors are the [B] block of scripts/lib/admission-core.mjs.
ADMIT='node scripts/lib/admission.mjs'
# [B] seconds a gate may run before its process group is stopped (see Timeout above); 0 = no limit.
GATE_TIMEOUT=3600
# [B] the mainline branch whose clean FULL run records the known-red baseline (see Known reds above); empty = off.
MAINLINE='main'
# [B] paths mode: extended regex of the product's paths; a FULL run whose every change matches skips
# the `paths` gates (see Paths mode above). Never a path a `paths` gate reads. Empty = off.
PRODUCT_PATHS=''
# [B] the run's own records, out of the cache key, the scoped list and the paths diff (see Reuse above).
RECORDS='(^|/)[^/]+\.(state\.md|steps\.jsonl)$'
# [B] 1 = a gate whose failing tests are all in files the branch did not touch runs once more (see Flaky retry above).
RETRY_FLAKY=1
# [B] how many gates run at once (see Parallel gates above); 1 = one at a time.
GATE_JOBS=1
# [B] gates, space-separated, that run alone when GATE_JOBS is above 1.
SERIAL=''

SINCE=""
LIST=0
NO_CACHE=0
SNAPSHOT=0
[ "${RUN_GATES_NO_CACHE:-}" = 1 ] && NO_CACHE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --since)
      [ $# -ge 2 ] && [ -n "$2" ] || usage "--since needs a non-empty ref"
      SINCE="$2"
      shift 2
      ;;
    --no-cache)
      NO_CACHE=1
      shift
      ;;
    --snapshot)
      SNAPSHOT=1
      shift
      ;;
    --list)
      LIST=1
      shift
      ;;
    *) usage "unknown argument: $1" ;;
  esac
done

# An executor (codex-run and claude-run set HARNESS_ROLE=executor) runs scoped; FULL is the session's.
if [ "${HARNESS_ROLE:-}" = executor ] && [ "$LIST" -eq 0 ] && { [ -z "$SINCE" ] || [ "$SNAPSHOT" -eq 1 ]; }; then
  echo "run-gates: FULL is the session's, once at landing; an executor runs bash scripts/run-gates.sh --since <the slice's base>" >&2
  exit 99
fi

[ "${#GATE_NAMES[@]}" -gt 0 ] || usage "no gates bound - edit the [B] block between the harness:gates markers"
[ "$SNAPSHOT" -eq 0 ] || [ -z "$SINCE" ] || usage "--snapshot is a FULL run on the commit; it does not take --since"

TOP=$(git rev-parse --show-toplevel 2>/dev/null) || usage "not inside a git repository"
cd "$TOP" || usage "cannot enter $TOP"

if [ "$LIST" -eq 1 ]; then
  i=0
  while [ "$i" -lt "${#GATE_NAMES[@]}" ]; do
    echo "${GATE_NAMES[$i]} ${GATE_MODES[$i]}"
    i=$((i + 1))
  done
  exit 0
fi

if [ -n "$SINCE" ]; then
  git rev-parse --verify --quiet "$SINCE^{commit}" >/dev/null || usage "unknown ref: $SINCE"
fi

LOG="${RUN_GATES_LOG_DIR:-.review-work/verify/$(date +%Y%m%dT%H%M%S)-$$}"
case "$LOG" in
  "$TOP"/*) LOG_REL="${LOG#"$TOP"/}" ;;
  /*) LOG_REL="" ;;
  *) LOG_REL="${LOG#./}" ;;
esac

# Non-negative integer from an env value, else the default ($1 = value, $2 = default).
num_or() {
  case "$1" in
    '' | *[!0-9]*) echo "$2" ;;
    *) echo "$1" ;;
  esac
}
LOCK_WAIT=$(num_or "${RUN_GATES_LOCK_WAIT:-}" 1800)
LOCK_POLL=$(num_or "${RUN_GATES_LOCK_POLL:-}" 5)
[ "$LOCK_POLL" -ge 1 ] || LOCK_POLL=1
INSTANT_SECS=$(num_or "${RUN_GATES_INSTANT_SECS:-}" 10)
DOCS_RX="${RUN_GATES_DOCS_ONLY-$DOCS_ONLY}"
KEY_EXTRA_CMD="${RUN_GATES_KEY_EXTRA-$KEY_EXTRA}"
ADMIT_CMD="${RUN_GATES_ADMIT-$ADMIT}"
GATE_TIMEOUT_S=$(num_or "${RUN_GATES_GATE_TIMEOUT:-}" "$(num_or "$GATE_TIMEOUT" 3600)")
MAINLINE_B="${RUN_GATES_MAINLINE-$MAINLINE}"
PRODUCT_RX="${RUN_GATES_PRODUCT_PATHS-$PRODUCT_PATHS}"
RECORDS_RX="${RUN_GATES_RECORDS-$RECORDS}"
RETRY_ON=0
[ "${RUN_GATES_RETRY_FLAKY-$RETRY_FLAKY}" = 1 ] && RETRY_ON=1
# A pattern grep -E cannot read would match nothing: a paths gate would always run (safe), but the
# records would silently stay in the key. One that matches an empty line ('.*', 'x?$') matches every
# path: every tree would hash alike, every paths gate would skip. Both are usage errors instead.
for rx_pair in "PRODUCT_PATHS:$PRODUCT_RX" "RECORDS:$RECORDS_RX"; do
  rx_val=${rx_pair#*:}
  [ -n "$rx_val" ] || continue
  rx_rc=0
  printf '' | grep -Eq -- "$rx_val" 2>/dev/null || rx_rc=$?
  [ "$rx_rc" -le 1 ] || usage "${rx_pair%%:*} is not a valid extended regex: $rx_val"
  if printf '\n' | grep -Eq -- "$rx_val" 2>/dev/null; then usage "${rx_pair%%:*} matches an empty path, so every path: $rx_val"; fi
done
HAS_PATHS=0
for gm in "${GATE_MODES[@]}"; do [ "$gm" != paths ] || HAS_PATHS=1; done
JOBS=$(num_or "${RUN_GATES_GATE_JOBS:-}" "$(num_or "$GATE_JOBS" 1)")
[ "$JOBS" -ge 1 ] || JOBS=1
# The SERIAL names, split on blanks and newlines (no globbing), each checked, kept as " a b " for is_serial.
SERIAL_NAMES=" "
set -f
# shellcheck disable=SC2086 # the list is split on purpose
for sn in ${RUN_GATES_SERIAL-$SERIAL}; do
  sn_ok=0
  for gn in "${GATE_NAMES[@]}"; do [ "$gn" != "$sn" ] || sn_ok=1; done
  [ "$sn_ok" -eq 1 ] || usage "SERIAL names $sn, which is no gate"
  SERIAL_NAMES="$SERIAL_NAMES$sn "
done
set +f
RUN_PID=$$

# Reads paths on stdin; drops the ones RECORDS matches (none when it is empty).
drop_records() {
  if [ -n "$RECORDS_RX" ]; then grep -vE -- "$RECORDS_RX" || true; else cat; fi
}

# Reads paths on stdin; drops blanks, .review-work/ and the log dir by LITERAL prefix
# (never a regex built from a path).
filter_changed() {
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      .review-work/*) continue ;;
    esac
    if [ -n "$LOG_REL" ]; then
      case "$f" in
        "$LOG_REL"/*) continue ;;
      esac
    fi
    printf '%s\n' "$f"
  done
}

SCOPED_REQ=0
[ -n "$SINCE" ] && SCOPED_REQ=1
# Sets MODE, CHANGED and NOTE. The changed files are computed before the log dir is created,
# minus anything under the log dirs themselves, so a run's own logs never count as a change.
# Called again after a lock wait: the tree may have changed meanwhile. An executor's run promoted
# to FULL exits 99 here, wherever it is called: FULL is the session's (see Usage).
compute_scope() {
  local diff_out untracked_out outside
  MODE=full
  CHANGED=""
  NOTE=""
  [ "$SCOPED_REQ" -eq 1 ] || return 0
  MODE=scoped
  diff_out=$(git -c core.quotePath=false diff --name-only --no-renames "$SINCE" --) ||
    usage "git diff against $SINCE failed; cannot list the changed files"
  untracked_out=$(git -c core.quotePath=false ls-files --others --exclude-standard) ||
    usage "git ls-files failed; cannot list the untracked files"
  CHANGED=$(printf '%s\n%s\n' "$diff_out" "$untracked_out" | filter_changed | drop_records | sort -u)
  if [ -z "$CHANGED" ]; then
    NOTE="SCOPED: nothing changed since $SINCE"
  else
    outside=$(printf '%s\n' "$CHANGED" | grep -vE "$SCOPED_PATHS" | head -n 1)
    if [ -n "$outside" ]; then
      NOTE="PROMOTED to FULL: $outside"
      MODE=full
      if [ "${HARNESS_ROLE:-}" = executor ]; then
        echo "run-gates: PROMOTED to FULL by $outside, outside SCOPED_PATHS: FULL is the session's, once at landing; an executor stops and reports the path" >&2
        exit 99
      fi
    fi
  fi
}
compute_scope

# --snapshot: the commit is resolved once, here, and every check is made before the cache is
# read. A tracked or staged change would not be in the run, so it is refused.
SNAP_COMMIT=""
SNAP_DIR=""
SNAP_ENTRIES=()
UNTRACKED_N=0
if [ "$SNAPSHOT" -eq 1 ]; then
  SNAP_COMMIT=$(git rev-parse --verify --quiet 'HEAD^{commit}') || usage "--snapshot needs a commit to verify"
  dirty=$(git -c core.quotePath=false status --porcelain --untracked-files=no) ||
    usage "git status failed; cannot check for uncommitted changes"
  [ -z "$dirty" ] || usage "--snapshot verifies the commit; commit or stash these first:"$'\n'"$dirty"
  untracked=$(git -c core.quotePath=false ls-files --others --exclude-standard) ||
    usage "git ls-files failed; cannot count the untracked files"
  UNTRACKED_N=$(printf '%s\n' "$untracked" | filter_changed | awk 'END { print NR }')
  read -r -a snap_words <<<"${RUN_GATES_SNAPSHOT_COPY-$SNAPSHOT_COPY}"
  shopt -s nullglob
  for w in ${snap_words[@]+"${snap_words[@]}"}; do
    case "$w" in
      /* | .. | ../* | */.. | */../*) usage "SNAPSHOT_COPY: $w is outside the repository" ;;
      *[*?[]*) for e in $w; do SNAP_ENTRIES+=("$e"); done ;;
      *)
        [ -e "$w" ] || [ -L "$w" ] || usage "SNAPSHOT_COPY names $w, which $TOP does not have (install first, or bind SNAPSHOT_COPY)"
        SNAP_ENTRIES+=("$w")
        ;;
    esac
  done
  shopt -u nullglob
fi

# Sets PATHS_DECISION (off | run | skip) and PATHS_BASE, the commit a skip is measured from (see Paths
# mode in the header). Every case it cannot decide, a failing git command included, is run. Called
# from compute_variant (the decision joins the cache variant) and once more right before the gates.
PATHS_DECISION=off
PATHS_BASE=""
compute_paths() {
  local tip head mb d1 d2 list
  PATHS_DECISION=off
  PATHS_BASE=""
  [ "$HAS_PATHS" -eq 1 ] && [ -n "$PRODUCT_RX" ] || return 0
  PATHS_DECISION=run
  if [ "$MODE" = scoped ]; then
    mb=$(git rev-parse --verify --quiet "$SINCE^{commit}") || return 0
    list=$CHANGED
  else
    [ -n "$MAINLINE_B" ] || return 0
    tip=$(git rev-parse -q --verify "refs/heads/$MAINLINE_B^{commit}" 2>/dev/null) || return 0
    if [ "$SNAPSHOT" -eq 1 ]; then head=$SNAP_COMMIT; else head=$(git rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null) || return 0; fi
    # the mainline's tip itself always runs every gate
    [ -n "$head" ] && [ "$head" != "$tip" ] || return 0
    mb=$(git merge-base "$tip" "$head" 2>/dev/null) || return 0
    [ -n "$mb" ] || return 0
    if [ "$SNAPSHOT" -eq 1 ]; then
      d1=$(git -c core.quotePath=false diff --name-only --no-renames "$mb" "$head" --) || return 0
      d2=""
    else
      d1=$(git -c core.quotePath=false diff --name-only --no-renames "$mb" --) || return 0
      d2=$(git -c core.quotePath=false ls-files --others --exclude-standard) || return 0
    fi
    list=$(printf '%s\n%s\n' "$d1" "$d2" | filter_changed | drop_records | sort -u)
    # nothing changed since the merge base: run
    [ -n "$list" ] || return 0
  fi
  PATHS_BASE=$mb
  # a scoped run with nothing changed has no path outside: skip (a FULL run with none ran above)
  if [ -z "$list" ] || [ -z "$(printf '%s\n' "$list" | grep -vE -- "$PRODUCT_RX" | head -n 1)" ]; then
    PATHS_DECISION=skip
  fi
}

# -- result cache and single-flight lock ----------------------------------------

RESULT=""
emit() {
  echo "$1"
  RESULT="$RESULT$1"$'\n'
}

hash_str() { printf '%s' "$1" | git hash-object --stdin 2>/dev/null; }
iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

LOCK_DIR=""
LOCK_OWNED=0
LOCK_WAITED=0
LOCK_WAIT_START=""
LOCK_HOLDER=""
release_lock() {
  if [ "$LOCK_OWNED" -eq 1 ] && [ -n "$LOCK_DIR" ]; then
    LOCK_OWNED=0
    # Only our own lock: a taker-over may have replaced it.
    if [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ]; then rm -rf "${LOCK_DIR:?}" 2>/dev/null; fi
  fi
  return 0
}
# Removes this run's snapshot: only the temp dir it made. --force because the copied entries
# are untracked there; nothing in a snapshot is anyone's work.
remove_snapshot() {
  [ -n "$SNAP_DIR" ] || return 0
  if [ -e "$SNAP_DIR/tree" ] && ! git -C "$TOP" worktree remove --force "$SNAP_DIR/tree" >/dev/null 2>&1; then
    echo "run-gates: could not unregister the snapshot worktree; git worktree prune clears it once $SNAP_DIR is gone" >&2
  fi
  rm -rf "${SNAP_DIR:?}" 2>/dev/null
  SNAP_DIR=""
  return 0
}
# Stops an admission still running (the run was interrupted): TERM makes the CLI print its closing MACHINE
# WAIT pair, which is passed through, so the wait is not lost from the record. The admission runs in a
# process group of its own whose id is ADMIT_PID, so TERM goes to the group: a compound ADMIT's node, not
# only the wrapper bash. The pid fallback is for a run where set -m made no group (monitor mode unavailable,
# or setpgid refused): the admission then sits in run-gates' own group, so TERM and KILL go to its pid alone,
# never to that group, and a compound ADMIT's children are not reached. Then it checks the group and the
# pid every 0.1 s, as long as either is there; after 100 sleeps (10 s) it sends KILL, to the group or else
# the pid. Only then is the admission reaped with wait (never before the bound: one that ignores TERM would
# block it, and with it the lock this run may hold), and the output is passed through.
ADMIT_PID=""
ADMIT_OUT=""
stop_admit() {
  local n=0
  if [ -n "$ADMIT_PID" ]; then
    kill -TERM -- -"$ADMIT_PID" 2>/dev/null || kill -TERM "$ADMIT_PID" 2>/dev/null
    while kill -0 -- -"$ADMIT_PID" 2>/dev/null || kill -0 "$ADMIT_PID" 2>/dev/null; do
      n=$((n + 1))
      if [ "$n" -gt 100 ]; then
        kill -KILL -- -"$ADMIT_PID" 2>/dev/null || kill -KILL "$ADMIT_PID" 2>/dev/null
        break
      fi
      sleep 0.1
    done
    wait "$ADMIT_PID" 2>/dev/null
    ADMIT_PID=""
    [ ! -s "$ADMIT_OUT" ] || cat "$ADMIT_OUT"
  fi
  [ -z "$ADMIT_OUT" ] || rm -f "$ADMIT_OUT"
  ADMIT_OUT=""
  return 0
}
# Runs $ADMIT_CMD given "$@", --holder <this run's pid> and --top <repo top>, in the background under wait
# (a trap interrupts wait, and the INT or TERM trap stops it), in a process group of its own (set -m: the
# group id is its pid). Passes its stdout through once it ends and keeps it in ADMIT_TEXT, and the slot
# its `LEASE <path>` line names in LEASE_PATH; a non-zero exit prints NOT ADMITTED (exit <n>) and exits 97.
# Its lines go through echo, never emit, so no record carries a wait.
ADMIT_TEXT=""
LEASE_PATH=""
LEASE_ASKED=0
run_admission() {
  local rc=0 l
  ADMIT_OUT=$(mktemp "${TMPDIR:-/tmp}/run-gates-admit.XXXXXX") || usage "cannot create a temp file for the admission output"
  LEASE_ASKED=1
  set -m
  bash -c "$ADMIT_CMD \"\$@\"" admit "$@" --holder "$$" --top "$TOP" </dev/null >"$ADMIT_OUT" &
  ADMIT_PID=$!
  set +m
  wait "$ADMIT_PID" || rc=$?
  ADMIT_PID=""
  ADMIT_TEXT=$(cat "$ADMIT_OUT")
  rm -f "$ADMIT_OUT"
  ADMIT_OUT=""
  [ -z "$ADMIT_TEXT" ] || printf '%s\n' "$ADMIT_TEXT"
  l=$(printf '%s\n' "$ADMIT_TEXT" | sed -n 's/^LEASE //p' | tail -n 1)
  [ -z "$l" ] || LEASE_PATH=$l
  if [ "$rc" -ne 0 ]; then
    echo "NOT ADMITTED (exit $rc)"
    exit 97
  fi
}
# The running gate (see Timeout in the header): GATE_PID is its pid and its process group's id, WATCH_PID
# its watchdog's. kill_gate <signal> signals the gate's group, or its pid alone when there is no such group
# (set -m made none), never run-gates' own group; 1 = neither is there.
GATE_PID=""
WATCH_PID=""
kill_gate() { kill -"$1" -- -"$GATE_PID" 2>/dev/null || kill -"$1" "$GATE_PID" 2>/dev/null; }
alive_gate() { kill -0 -- -"$GATE_PID" 2>/dev/null || kill -0 "$GATE_PID" 2>/dev/null; }
# The watchdog, started in the background in a group of its own: after GATE_TIMEOUT_S seconds it creates
# the timeout mark ($1), sends the gate TERM and, 10 s later, KILL. It sleeps a second at a time and
# stops the gate the same way, with no mark, once run-gates ($RUN_PID) is gone (KILLed: no trap ran).
# TERM ends it at once, its sleep with it: the trap kills the sleep it knows and flags the rest, so a
# TERM that lands between a sleep's start and `s=$!` (an instant gate's end_gate) still ends that sleep.
watch_gate() {
  local s="" stop="" left=$GATE_TIMEOUT_S
  trap 'stop=1; [ -z "$s" ] || kill "$s" 2>/dev/null' TERM
  while :; do
    if [ "$left" -le 0 ]; then
      : >"$1"
      break
    fi
    sleep 1 &
    s=$!
    [ -z "$stop" ] || { kill "$s" 2>/dev/null; exit 0; }
    wait "$s" || exit 0
    [ -z "$stop" ] || exit 0
    s=""
    left=$((left - 1))
    kill -0 "$RUN_PID" 2>/dev/null || break
  done
  kill_gate TERM
  sleep 10 &
  s=$!
  [ -z "$stop" ] || { kill "$s" 2>/dev/null; exit 0; }
  wait "$s" || exit 0
  [ -z "$stop" ] || exit 0
  kill_gate KILL
}
# Ends the gate run: stops the watchdog, then sends whatever is left in the gate's group TERM, checks it
# every 0.1 s and sends KILL when it is still there after 100 sleeps (10 s); then reaps the gate. Called
# when the gate's own process has ended (its children may not have) and from the INT and TERM traps.
end_gate() {
  local n=0
  if [ -n "$WATCH_PID" ]; then
    kill -TERM -- -"$WATCH_PID" 2>/dev/null || kill -TERM "$WATCH_PID" 2>/dev/null
    wait "$WATCH_PID" 2>/dev/null
    WATCH_PID=""
  fi
  [ -n "$GATE_PID" ] || return 0
  if kill_gate TERM; then
    while alive_gate; do
      n=$((n + 1))
      if [ "$n" -gt 100 ]; then
        kill_gate KILL
        break
      fi
      sleep 0.1
    done
  fi
  wait "$GATE_PID" 2>/dev/null
  GATE_PID=""
  return 0
}
# The parallel workers (see run_parallel): JOB_PIDS[i] is gate i's worker's pid ("" before its launch),
# JOB_DONE[i] is set once it is reaped ("skip" for a gate this run skips), JOB_PG is a worker's file for
# its gate's and watchdog's group ids.
JOB_PG=""
JOB_PIDS=()
JOB_DONE=()
# INT or TERM with workers running: each gets TERM (its trap ends its gate's group), they are checked
# every 0.1 s, and after 120 checks (12 s: end_gate's own KILL comes at 10 s) the groups a worker
# recorded and the worker itself get KILL. Then every worker is reaped.
stop_jobs() {
  local i n=${#JOB_PIDS[@]} k=0 alive g gp wp
  [ "$n" -gt 0 ] || return 0
  i=0
  while [ "$i" -lt "$n" ]; do
    if [ -n "${JOB_PIDS[$i]}" ] && [ -z "${JOB_DONE[$i]}" ]; then kill -TERM "${JOB_PIDS[$i]}" 2>/dev/null; fi
    i=$((i + 1))
  done
  while :; do
    alive=0
    i=0
    while [ "$i" -lt "$n" ]; do
      if [ -n "${JOB_PIDS[$i]}" ] && [ -z "${JOB_DONE[$i]}" ] && kill -0 "${JOB_PIDS[$i]}" 2>/dev/null; then alive=1; fi
      i=$((i + 1))
    done
    [ "$alive" -eq 1 ] && [ "$k" -lt 120 ] || break
    k=$((k + 1))
    sleep 0.1
  done
  i=0
  while [ "$i" -lt "$n" ]; do
    if [ -n "${JOB_PIDS[$i]}" ] && [ -z "${JOB_DONE[$i]}" ]; then
      if kill -0 "${JOB_PIDS[$i]}" 2>/dev/null; then
        gp=""
        wp=""
        read -r gp wp <"$LOG/.job-$i.pg" 2>/dev/null
        for g in "$gp" "$wp"; do
          case "$g" in
            '' | *[!0-9]*) ;;
            *) kill -KILL -- -"$g" 2>/dev/null ;;
          esac
        done
        kill -KILL "${JOB_PIDS[$i]}" 2>/dev/null
      fi
      wait "${JOB_PIDS[$i]}" 2>/dev/null
      JOB_DONE[i]=run
      rm -f "$LOG/.job-$i" "$LOG/.job-$i.tmp" "$LOG/.job-$i.pg"
    fi
    i=$((i + 1))
  done
}
# INT or TERM: the admission, the running gate and any parallel workers are stopped first, then the
# EXIT trap removes the snapshot, releases the lock and the lease.
on_signal() {
  trap '' INT TERM
  stop_admit
  end_gate
  stop_jobs
  exit "$1"
}
# Removes the host lease slot this run holds: the one the admission named, and any slot in the lease dir
# that names this run's pid (an admission stopped after it took one). A slot naming another pid is left.
release_lease() {
  local f
  [ "$LEASE_ASKED" -eq 1 ] || return 0
  for f in "$LEASE_PATH" "${HARNESS_LEASE_DIR:-${HOME:-/nonexistent}/.harness/leases}"/slot-*; do
    [ -n "$f" ] && [ -f "$f" ] || continue
    if grep -Eq "\"pid\":$$[,}]" "$f" 2>/dev/null; then rm -f "$f"; fi
  done
  LEASE_PATH=""
  return 0
}
# INT or TERM during the cleanup is ignored: on_signal's exit would end the trap before the lock and lease go.
trap 'trap "" INT TERM; remove_snapshot; release_lock; release_lease' EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

# Sets MODE_ID, VARIANT and REC_DIR: the mode, the bound gates, the KEY_EXTRA output and
# NODE_OPTIONS (what every node child runs; unset = empty) decide which records can answer this
# run. Called again after a lock wait (the mode may have changed).
compute_variant() {
  local extra=""
  MODE_ID=full
  if [ "$MODE" = scoped ]; then
    MODE_ID="scoped:$(git rev-parse --verify --quiet "$SINCE^{commit}")"
  elif [ "$SNAPSHOT" -eq 1 ]; then
    MODE_ID=snapshot
  fi
  if [ -n "$KEY_EXTRA_CMD" ]; then extra=$(bash -c "$KEY_EXTRA_CMD" 2>/dev/null </dev/null); fi
  compute_paths
  VARIANT=$(hash_str "$MODE_ID|$(hash_str "$GATES_SIG")|$(hash_str "$extra")|$(hash_str "${NODE_OPTIONS:-}")")
  # a run that skips its paths gates never answers one that runs them, nor the other way
  [ "$HAS_PATHS" -eq 0 ] || VARIANT=$(hash_str "$VARIANT|paths:$PATHS_DECISION")
  REC_DIR="$CACHE_DIR/records/$VARIANT"
}

CACHE_ON=0
CACHE_DIR="${RUN_GATES_CACHE_DIR:-}"
if [ -z "$CACHE_DIR" ]; then
  gcd=$(git rev-parse --git-common-dir 2>/dev/null) && gcd=$(cd "$gcd" 2>/dev/null && pwd -P) &&
    CACHE_DIR="$gcd/run-gates-cache"
fi
KEY=""
REC_DIR=""
VARIANT=""
MODE_ID=full
GATES_SIG=""
KEY_EXCLUDES=(.review-work)
if [ -n "$CACHE_DIR" ] && git rev-parse --verify --quiet HEAD >/dev/null 2>&1; then
  case "$CACHE_DIR" in /*) ;; *) CACHE_DIR="$TOP/$CACHE_DIR" ;; esac
  i=0
  while [ "$i" -lt "${#GATE_NAMES[@]}" ]; do
    GATES_SIG="$GATES_SIG${GATE_NAMES[$i]}"$'\037'"${GATE_MODES[$i]}"$'\037'"${GATE_CMDS[$i]}"$'\037'"${GATE_RXS[$i]}"$'\n'
    i=$((i + 1))
  done
  compute_variant
  TOP_H=$(hash_str "$TOP")
  MODE_H=$(hash_str "$MODE_ID")
  if [ -n "$VARIANT" ] && [ -n "$TOP_H" ] && [ -n "$MODE_H" ]; then
    LOCK_DIR="$CACHE_DIR/locks/${TOP_H:0:16}-${MODE_H:0:16}"
    mkdir -p "$CACHE_DIR/records" "$CACHE_DIR/locks" 2>/dev/null && CACHE_ON=1
  fi
  # The log dir and the cache dir never count as part of the tree.
  for ex in "$LOG_REL" "${CACHE_DIR#"$TOP"/}"; do
    case "$ex" in
      '' | . | .. | ../* | /*) ;;
      *) KEY_EXCLUDES+=("$ex") ;;
    esac
  done
fi

# Sets KEY to the tree of the working tree (tracked, staged, unstaged and untracked files)
# through a temporary index seeded from the real one for its stat cache (cp -p keeps the index
# mtime, which git needs to spot an edit made in the same second); the real index is never written. Empty KEY (and return 1) when the tree cannot be hashed.
# Drops every path RECORDS matches from the index GIT_INDEX_FILE names (nothing when RECORDS is
# empty). A name git quotes (a control character, a quote) never matches and stays in the key.
drop_record_entries() {
  [ -n "$RECORDS_RX" ] || return 0
  git -c core.quotePath=false ls-files | { grep -E -- "$RECORDS_RX" || true; } | git update-index --force-remove --stdin
}
compute_key() {
  local d src
  KEY=""
  if [ "$SNAPSHOT" -eq 1 ]; then
    # The input is the commit. Once the snapshot exists, a tracked file a gate changed there
    # changed what the gates after it read: no key, so the result is not recorded.
    if [ -n "$SNAP_DIR" ] && [ -n "$(git -C "$SNAP_DIR/tree" status --porcelain --untracked-files=no 2>&1)" ]; then return 1; fi
    if [ -z "$RECORDS_RX" ]; then
      KEY=$(git rev-parse --verify --quiet "$SNAP_COMMIT^{tree}")
    else
      d=$(mktemp -d "${TMPDIR:-/tmp}/run-gates-key.XXXXXX" 2>/dev/null) || return 1
      # shellcheck disable=SC2030 # the temporary index is meant to stay inside this subshell
      KEY=$(
        export GIT_INDEX_FILE="$d/index"
        git read-tree "$SNAP_COMMIT" >/dev/null 2>&1 && drop_record_entries >/dev/null 2>&1 && git write-tree 2>/dev/null
      )
      rm -rf "${d:?}"
    fi
    [ -n "$KEY" ]
    return
  fi
  d=$(mktemp -d "${TMPDIR:-/tmp}/run-gates-key.XXXXXX" 2>/dev/null) || return 1
  src=$(git rev-parse --git-path index 2>/dev/null)
  if [ -n "$src" ] && [ -f "$src" ] && cp -p "$src" "$d/index" 2>/dev/null; then
    :
  else
    GIT_INDEX_FILE="$d/index" git read-tree HEAD >/dev/null 2>&1 || {
      rm -rf "${d:?}"
      return 1
    }
  fi
  # shellcheck disable=SC2031 # each temporary index stays inside its own subshell
  KEY=$(
    export GIT_INDEX_FILE="$d/index"
    git add -A >/dev/null 2>&1 &&
      git --literal-pathspecs rm -r -q --cached --ignore-unmatch -- "${KEY_EXCLUDES[@]}" >/dev/null 2>&1 &&
      drop_record_entries >/dev/null 2>&1 &&
      git write-tree 2>/dev/null
  )
  rm -rf "${d:?}"
  [ -n "$KEY" ]
}

# Everything a lock wait can invalidate, worked out again: scope, variant, tree. 1 = no key.
refresh_state() {
  compute_scope
  compute_variant
  [ -n "$VARIANT" ] || return 1
  compute_key
}

# $1 = record file, $2 = tree it was recorded for, $3 = label ("" or "docs-only change since ").
print_reused() {
  echo "REUSED $2 $3$(head -n 1 "$1")"
  tail -n +2 "$1"
}

# Prints the reused result and returns 0 on a hit: an all-PASS record for KEY, else the newest
# all-PASS record whose tree differs from KEY only in docs paths.
try_reuse() {
  local rec t diff bad
  [ -n "$KEY" ] || return 1
  rec="$REC_DIR/$KEY"
  if [ -f "$rec" ] && grep -Eq '^SUMMARY [0-9]+ passed, 0 failed' "$rec"; then
    print_reused "$rec" "$KEY" ""
    return 0
  fi
  [ -n "$DOCS_RX" ] || return 1
  # shellcheck disable=SC2012 # record names are 40-64 hex chars
  for t in $(ls -t "$REC_DIR" 2>/dev/null | head -n 30); do
    # A record name goes to git unquoted below: only a tree id (lowercase hex) may.
    case "$t" in *[!0-9a-f]*) continue ;; esac
    [ "${#t}" -ge 40 ] && [ "${#t}" -le 64 ] && [ "$t" != "$KEY" ] || continue
    rec="$REC_DIR/$t"
    grep -Eq '^SUMMARY [0-9]+ passed, 0 failed' "$rec" 2>/dev/null || continue
    diff=$(git diff-tree -r --name-only "$t" "$KEY" 2>/dev/null) || continue
    [ -n "$diff" ] || continue
    bad=$(printf '%s\n' "$diff" | grep -Ev "$DOCS_RX" | head -n 1)
    if [ -z "$bad" ]; then
      print_reused "$rec" "$t" "docs-only change since "
      return 0
    fi
  done
  return 1
}

# Admission (see the header) for a FULL run: after the cache check (a hit needs no machine), before the
# lock, so its wait (up to an hour) is never held against another run's lock wait (30 minutes). After a
# machine wait the tree may have changed and may be a hit, as after a lock wait.
admit_full() {
  [ -n "$ADMIT_CMD" ] && [ "$MODE" = full ] || return 0
  run_admission
  printf '%s\n' "$ADMIT_TEXT" | grep -q '^MACHINE WAIT ' || return 0
  if [ "$CACHE_ON" -eq 1 ]; then
    refresh_state || CACHE_ON=0
    if [ "$CACHE_ON" -eq 1 ] && [ "$NO_CACHE" -eq 0 ] && try_reuse; then exit 0; fi
  else
    compute_scope
  fi
  # A scoped run never holds a lease: the wait may have turned this one scoped.
  [ "$MODE" = full ] || release_lease
}

# Sets LOCK_DIR to the lock of MODE_ID, the mode the run is in now (unchanged when it cannot be hashed).
lock_for_mode() {
  local h
  h=$(hash_str "$MODE_ID")
  [ -z "$h" ] || LOCK_DIR="$CACHE_DIR/locks/${TOP_H:0:16}-${h:0:16}"
  return 0
}

# mkdir lock holding our pid. Sets LOCK_WAITED=1 when another live run held it. Returns 1 when
# no lock could be taken (wait limit reached or the cache dir is unwritable): the run goes on.
acquire_lock() {
  local holder waited=0 takeovers=0 retries=0
  LOCK_WAITED=0
  while :; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      echo "$$" >"$LOCK_DIR/pid"
      LOCK_OWNED=1
      return 0
    fi
    if [ ! -d "$LOCK_DIR" ]; then
      # Released between the failed mkdir and here (or the cache dir is unwritable): retry.
      retries=$((retries + 1))
      [ "$retries" -le 5 ] || return 1
      continue
    fi
    holder=$(cat "$LOCK_DIR/pid" 2>/dev/null)
    if [ -z "$holder" ]; then
      sleep 1 # the owner may not have written its pid yet
      holder=$(cat "$LOCK_DIR/pid" 2>/dev/null)
    fi
    case "$holder" in
      '' | *[!0-9]*) holder="" ;;
    esac
    if [ -z "$holder" ] || ! kill -0 "$holder" 2>/dev/null; then
      takeovers=$((takeovers + 1))
      [ "$takeovers" -le 5 ] || return 1
      # Another waiter may have taken over first and written its own pid: only move a lock
      # that still names the stale pid we saw.
      if [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$holder" ]; then
        mv "$LOCK_DIR" "$LOCK_DIR.stale.$$" 2>/dev/null && rm -rf "${LOCK_DIR:?}.stale.$$"
      fi
      continue
    fi
    if [ "$LOCK_WAITED" -eq 0 ]; then
      echo "WAITING for run $holder" >&2
      LOCK_WAITED=1
      LOCK_WAIT_START=$(iso_now)
      LOCK_HOLDER=$holder
    fi
    if [ "$waited" -ge "$LOCK_WAIT" ]; then
      echo "run-gates: waited ${waited}s for run $holder; running without the lock" >&2
      return 1
    fi
    sleep "$LOCK_POLL"
    waited=$((waited + LOCK_POLL))
  done
}

if [ "$CACHE_ON" -eq 1 ]; then
  if compute_key; then
    if [ "$NO_CACHE" -eq 0 ] && try_reuse; then exit 0; fi
    admit_full
    while :; do
      # The lock of the mode the run is in now: an admission wait or a lock wait may have changed it.
      lock_for_mode
      LOCK_MODE_ID=$MODE_ID
      acquire_lock || true
      [ "$LOCK_WAITED" -eq 1 ] || break
      echo "MACHINE WAIT $LOCK_WAIT_START → $(iso_now) lock run $LOCK_HOLDER" >&2
      # The other run took its time: the changed files, the mode, the variant and the tree may
      # all differ now, and its result may be a hit.
      refresh_state || CACHE_ON=0
      if [ "$CACHE_ON" -eq 1 ] && [ "$NO_CACHE" -eq 0 ] && try_reuse; then exit 0; fi
      if [ "$MODE_ID" != "$LOCK_MODE_ID" ]; then
        # The mode changed (a scoped run promoted to FULL, or back): the lock held is the other
        # mode's. Released; then admission (a FULL run's), the new mode's lock and these checks again.
        release_lock
        [ "$MODE" = full ] || release_lease
        admit_full
        continue
      fi
      # Not a hit: the machine may have gone short while this run waited. A FULL run is checked once
      # more, holding the lock, and never waits for it here (a wait would hold the lock against the
      # next run's lock wait).
      if [ -n "$ADMIT_CMD" ] && [ "$MODE" = full ]; then run_admission --wait 0; fi
      break
    done
  else
    CACHE_ON=0
    admit_full
  fi
else
  admit_full
fi

# Builds the --snapshot input: a detached worktree of the commit in a fresh temp dir (no git
# hook runs), then a copy of each SNAPSHOT_COPY entry the commit lacks. A copy, copy-on-write
# where the disk can, never a symlink: a relative link inside node_modules (a workspace
# package) must reach the snapshot's files, not the working tree's. 0 = built.
make_snapshot() {
  local e dst
  SNAP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/run-gates-snapshot.XXXXXX") || {
    SNAP_DIR=""
    return 1
  }
  git -c core.hooksPath=/dev/null worktree add --quiet --detach "$SNAP_DIR/tree" "$SNAP_COMMIT" >/dev/null || return 1
  for e in ${SNAP_ENTRIES[@]+"${SNAP_ENTRIES[@]}"}; do
    dst="$SNAP_DIR/tree/$e"
    # A path the commit has (a tracked .env.example) comes from the commit.
    if [ -e "$dst" ] || [ -L "$dst" ]; then continue; fi
    mkdir -p "$(dirname "$dst")" || return 1
    # -H: an entry that is a symlink itself (a .env shared between worktrees) is copied as its
    # target; the links inside a copied directory stay links.
    case "$(uname -s)" in
      Darwin) cp -cRpH -- "$e" "$dst" 2>/dev/null || { rm -rf "$dst" && cp -RpH -- "$e" "$dst"; } || return 1 ;;
      *) cp -RpH --reflink=auto -- "$e" "$dst" || return 1 ;;
    esac
  done
}

mkdir -p "$LOG" || usage "cannot create log dir: $LOG"
echo "logs: $LOG"

GATE_DIR=$TOP
if [ "$SNAPSHOT" -eq 1 ]; then
  SNAP_SHORT=$(git rev-parse --short "$SNAP_COMMIT")
  make_snapshot || {
    echo "run-gates: cannot build the snapshot of $SNAP_SHORT" >&2
    exit 99
  }
  GATE_DIR="$SNAP_DIR/tree"
  echo "input: commit $SNAP_SHORT"
  [ "$UNTRACKED_N" -eq 0 ] || echo "not in this run: $UNTRACKED_N untracked file(s)"
fi

CHANGED_FILE=""
if [ "$SCOPED_REQ" -eq 1 ]; then
  if [ "$MODE" = scoped ]; then CHANGED_FILE="$LOG/changed-files.txt"; else SINCE=""; fi
  if [ -n "$CHANGED" ]; then printf '%s\n' "$CHANGED" >"$LOG/changed-files.txt"; else : >"$LOG/changed-files.txt"; fi
  [ -z "$NOTE" ] || echo "$NOTE"
fi

# CSI escape sequences (colour) out of a log, so a count regex reads the plain text.
strip_csi() { LC_ALL=C sed $'s#\033\\[[0-?]*[ -/]*[@-~]##g'; }

# -- the known-red baseline (see Known reds above) --------------------------------------------
BASE_REC=0 # 1 = this run records the baseline: FULL, HEAD at the mainline's tip, no tracked change
BASE_HEAD="" # the commit a recording run started on: a run that ends on another records nothing
BASE_PENDING="" # what a recording run will write once its gates are done: <record> then <tmp file or ->, a line each
KNOWN_ON=0 # 1 = this run may print KNOWN: KNOWN_CHANGED lists every file changed since the merge base
KNOWN_CHANGED=""
KNOWN_MB="" # the merge base with the mainline: a record made before it is stale
# No tracked change in the gates' tree: the checkout, or the snapshot's worktree (a gate can write there).
tree_clean() { st=$(git -C "$GATE_DIR" status --porcelain --untracked-files=no 2>/dev/null) && [ -z "$st" ]; }
if [ "$CACHE_ON" -eq 1 ] && [ -n "$MAINLINE_B" ] && git check-ref-format --branch "$MAINLINE_B" >/dev/null 2>&1 &&
  mkdir -p "$CACHE_DIR/baseline" 2>/dev/null; then
  # HEAD at the mainline's tip, on the branch or detached at it (a worktree cannot check the branch out twice)
  if [ "$MODE" = full ] && BASE_HEAD=$(git rev-parse -q --verify HEAD 2>/dev/null) &&
    [ "$BASE_HEAD" = "$(git rev-parse -q --verify "refs/heads/$MAINLINE_B" 2>/dev/null)" ] && tree_clean; then
    BASE_REC=1
  elif KNOWN_MB=$(git merge-base "refs/heads/$MAINLINE_B" HEAD 2>/dev/null) &&
    d1=$(git diff --name-only -z --no-renames "$KNOWN_MB" -- 2>/dev/null | tr '\000' '\n'; exit "${PIPESTATUS[0]}") &&
    d2=$(git ls-files -z --others --exclude-standard 2>/dev/null | tr '\000' '\n'; exit "${PIPESTATUS[0]}"); then
    KNOWN_CHANGED=$(printf '%s\n%s\n' "$d1" "$d2" | filter_changed | LC_ALL=C sort -u)
    KNOWN_ON=1
  fi
fi
base_file() { printf '%s/%s' "$CACHE_DIR/baseline" "$(hash_str "$MAINLINE_B|$1")"; }
# The failing test ids a gate's log ends with (run-counted's trailing FAILED block), sorted, each
# once; returns 1 when it names none, "?" (a failure it could not name), or an id whose file or
# title holds a second " :: " (no split of it is sure).
failed_ids() {
  local ids
  ids=$(strip_csi <"$1" | awk '/^run-counted: FAILED /{b = b substr($0, 21) "\n"; next} /^[ \t\r]*$/{next} {b = ""} END{printf "%s", b}' | LC_ALL=C sort -u)
  [ -n "$ids" ] || return 1
  if printf '%s\n' "$ids" | grep -Fxq '?'; then return 1; fi
  if printf '%s\n' "$ids" | grep -q ' :: .* :: '; then return 1; fi
  printf '%s\n' "$ids"
}
# $1 = gate, $2 = why it failed ("" = passed), $3 = log: the mainline run's record for the gate
# (`head <commit>`, then the ids), kept only for a gate that exited non-zero naming each failing
# test (not a timeout or a missed count line), else cleared. Held in BASE_PENDING until
# commit_base: a run whose tree moved writes none.
record_base() {
  local base ids tmp=-
  base=$(base_file "$1")
  if [ "${2#exit }" != "$2" ] && ids=$(failed_ids "$3"); then
    tmp="$base.tmp.$$"
    printf 'head %s\n%s\n' "$BASE_HEAD" "$ids" >"$tmp" 2>/dev/null || { rm -f "$tmp"; tmp=-; }
  fi
  BASE_PENDING="$BASE_PENDING$base
$tmp
"
}
# After the gates: the pending records go in place only when HEAD is still the commit the run
# started on and the tree is still clean (an edit during the run would record its own reds).
commit_base() {
  local base tmp ok=0
  if [ "$(git rev-parse -q --verify HEAD 2>/dev/null)" = "$BASE_HEAD" ] && tree_clean; then ok=1; fi
  [ "$ok" -eq 1 ] || echo "run-gates: the tree changed during the run: the known-red record is not updated" >&2
  while IFS= read -r base && IFS= read -r tmp; do
    [ -n "$base" ] || continue
    if [ "$ok" -eq 0 ]; then
      [ "$tmp" = - ] || rm -f "$tmp"
    elif [ "$tmp" = - ]; then
      rm -f "$base"
    else
      mv -f "$tmp" "$base" 2>/dev/null || rm -f "$tmp"
    fi
  done <<EOF
$BASE_PENDING
EOF
}
# 0 when a gate's command is one run-counted call and nothing else, so the gate's exit and its
# FAILED block are that call's: a list (`;`, `&&`, `||`, `&`, a pipe, a newline) or a second call
# can fail on a step the last block does not name.
single_counted() {
  case "$1" in *';'* | *'&'* | *'|'* | *$'\n'*) return 1 ;; esac
  [ "$(printf '%s\n' "$1" | grep -o 'run-counted\.mjs' | grep -c .)" -eq 1 ]
}
# The words a test's title must show in its file: the last ` > ` or ` › ` part, then the last
# `::` part (pytest), without a [project] lead or a [param] tail.
title_needle() {
  printf '%s' "$1" | LC_ALL=C sed -e 's/^\[[^]]*\] //' -e 's/.* > //' -e $'s/.* \xe2\x80\xba //' -e 's/.*:://' -e 's/\[.*\]$//'
}
# $1 = gate, $2 = why it failed, $3 = log, $4 = its command: prints the number of failing tests
# and returns 0 when the gate is one run-counted call that exited non-zero, the gate's record was
# made at KNOWN_MB or after it, every test it names is in that record, and each of their files is
# a file of the gate's tree that KNOWN_MB has, that is not in KNOWN_CHANGED and that holds the
# test's title (a path the runner printed against another root, a package's cwd, is no proof; an
# ignored file is in no diff; a title the file does not spell, from it.each or a template, is none).
known_red() {
  local base ids rec_head rec_ids id f t needle
  [ "${2#exit }" != "$2" ] && single_counted "$4" || return 1
  base=$(base_file "$1")
  [ -f "$base" ] && ids=$(failed_ids "$3") || return 1
  rec_head=$(LC_ALL=C sed -n '1s/^head \([0-9a-f]\{40,64\}\)$/\1/p' "$base")
  [ -n "$rec_head" ] && git merge-base --is-ancestor "$KNOWN_MB" "$rec_head" 2>/dev/null || return 1
  rec_ids=$(sed 1d "$base")
  while IFS= read -r id; do
    printf '%s\n' "$rec_ids" | grep -Fxq -- "$id" || return 1
    f=${id%% :: *}
    t=${id#* :: }
    case "$f" in '' | /* | ../* | */../*) return 1 ;; esac
    [ "$f" != "$id" ] && [ -f "$GATE_DIR/$f" ] || return 1
    git cat-file -e "$KNOWN_MB:$f" 2>/dev/null || return 1
    if printf '%s\n' "$KNOWN_CHANGED" | grep -Fxq -- "$f"; then return 1; fi
    needle=$(title_needle "$t")
    [ -n "$needle" ] && grep -Fq -- "$needle" "$GATE_DIR/$f" || return 1
  done <<EOF
$ids
EOF
  printf '%s\n' "$ids" | grep -c .
}

# -- the flaky retry (see Flaky retry above) -------------------------------------------------------
# TOUCHED: every file changed since the merge base with the mainline, committed, uncommitted or
# untracked (the snapshot's commit against it, for --snapshot); TOUCHED_OK=1 once it is known. No
# mainline, no merge base or a failing git: 0, and no gate is retried.
TOUCHED=""
TOUCHED_OK=0
TOUCHED_MB=""
if [ "$RETRY_ON" -eq 1 ] && [ -n "$MAINLINE_B" ] && r_tip=$(git rev-parse -q --verify "refs/heads/$MAINLINE_B^{commit}" 2>/dev/null) &&
  r_head=$(if [ "$SNAPSHOT" -eq 1 ]; then echo "$SNAP_COMMIT"; else git rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null; fi) &&
  r_mb=$(git merge-base "$r_tip" "$r_head" 2>/dev/null) && [ -n "$r_mb" ]; then
  if [ "$SNAPSHOT" -eq 1 ]; then
    t1=$(git diff --name-only -z --no-renames "$r_mb" "$r_head" -- 2>/dev/null | tr '\000' '\n'; exit "${PIPESTATUS[0]}") && t2="" && TOUCHED_OK=1
  else
    t1=$(git diff --name-only -z --no-renames "$r_mb" -- 2>/dev/null | tr '\000' '\n'; exit "${PIPESTATUS[0]}") &&
      t2=$(git ls-files -z --others --exclude-standard 2>/dev/null | tr '\000' '\n'; exit "${PIPESTATUS[0]}") && TOUCHED_OK=1
  fi
  [ "$TOUCHED_OK" -eq 0 ] || TOUCHED=$(printf '%s\n%s\n' "$t1" "$t2" | LC_ALL=C sort -u)
  TOUCHED_MB=$r_mb
fi
# $1 = why the gate failed, $2 = its log, $3 = its command, $4 = its seconds: prints the failing ids
# and returns 0 when the gate may run once more (see Flaky retry above).
flaky_ids() {
  local ids id f needle
  [ "$RETRY_ON" -eq 1 ] && [ "$TOUCHED_OK" -eq 1 ] && [ "${1#exit }" != "$1" ] && [ "$4" -ge "$INSTANT_SECS" ] && single_counted "$3" || return 1
  ids=$(failed_ids "$2") || return 1
  while IFS= read -r id; do
    f=${id%% :: *}
    case "$f" in '' | /* | ../* | */../*) return 1 ;; esac
    [ "$f" != "$id" ] && [ -f "$GATE_DIR/$f" ] || return 1
    # as for a known red: a file the merge base has (an ignored or generated file is in no diff) and
    # that spells the test's title (a path printed against another root is no proof)
    git cat-file -e "$TOUCHED_MB:$f" 2>/dev/null || return 1
    if printf '%s\n' "$TOUCHED" | grep -Fxq -- "$f"; then return 1; fi
    needle=$(title_needle "${id#* :: }")
    [ -n "$needle" ] && grep -Fq -- "$needle" "$GATE_DIR/$f" || return 1
  done <<EOF
$ids
EOF
  printf '%s\n' "$ids"
}
# One JSON string: backslash, quote and tab escaped, every other control character dropped.
json_str() {
  printf '"%s"' "$(printf '%s' "$1" | LC_ALL=C sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e $'s/\t/\\\\t/g' | LC_ALL=C tr -d '\000-\037')"
}
FLAKES_FILE=""
if [ -n "$CACHE_DIR" ]; then
  case "$CACHE_DIR" in /*) FLAKES_FILE="$CACHE_DIR/flakes.jsonl" ;; *) FLAKES_FILE="$TOP/$CACHE_DIR/flakes.jsonl" ;; esac
fi
# $1 = gate, $2 = the ids its first run failed (a line each): one line in the flakes register.
record_flake() {
  local id ids="" tree
  [ -n "$FLAKES_FILE" ] || return 0
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    ids="$ids${ids:+,}$(json_str "$id")"
  done <<EOF
$2
EOF
  tree=$KEY
  [ -n "$tree" ] || tree=$(git rev-parse -q --verify "${SNAP_COMMIT:-HEAD}^{tree}" 2>/dev/null)
  mkdir -p "$(dirname "$FLAKES_FILE")" 2>/dev/null
  printf '{"at":"%s","gate":%s,"ids":[%s],"tree":"%s","top":%s}\n' "$(iso_now)" "$(json_str "$1")" "$ids" "$tree" "$(json_str "$TOP")" >>"$FLAKES_FILE" 2>/dev/null ||
    echo "run-gates: could not append to $FLAKES_FILE" >&2
}

# -- the gates ------------------------------------------------------------------------------------
# Prints gate $1's SKIP line and returns 0 when this run skips it: a full-only gate in a scoped run,
# or a paths gate the paths decision skips (with PRODUCT_PATHS empty a paths gate is a full one).
skip_line() {
  local gmode=${GATE_MODES[$1]}
  if [ "$gmode" = paths ]; then
    case "$PATHS_DECISION" in
      skip)
        echo "SKIP ${GATE_NAMES[$1]} (no path outside PRODUCT_PATHS changed since ${PATHS_BASE:0:12})"
        return 0
        ;;
      off) gmode=full ;;
    esac
  fi
  if [ "$MODE" = scoped ] && [ "$gmode" = full ]; then
    echo "SKIP ${GATE_NAMES[$1]} (full only)"
    return 0
  fi
  return 1
}
# Runs gate $1 (its index) once, its output in log $2: the gate and its watchdog in a process group of
# their own, under wait, so a trap can stop them. Sets G_SECS and G_WHY ("" = it passed).
launch_gate() {
  local logfile=$2 rx=${GATE_RXS[$1]} mark="$2.timeout" t0 rc=0
  rm -f "$mark"
  t0=$SECONDS
  set -m
  (cd "$GATE_DIR" && RUN_GATES_MODE="$MODE" RUN_GATES_SINCE="$SINCE" RUN_GATES_CHANGED_FILE="$CHANGED_FILE" \
    RUN_GATES_TOP="$GATE_DIR" exec bash -c "${GATE_CMDS[$1]}") >"$2" 2>&1 </dev/null &
  GATE_PID=$!
  if [ "$GATE_TIMEOUT_S" -gt 0 ]; then
    watch_gate "$mark" </dev/null >/dev/null 2>&1 &
    WATCH_PID=$!
  fi
  set +m
  [ -z "$JOB_PG" ] || echo "$GATE_PID $WATCH_PID" >"$JOB_PG"
  wait "$GATE_PID" || rc=$?
  end_gate
  G_SECS=$((SECONDS - t0))
  G_WHY=""
  if [ -e "$mark" ]; then
    rm -f "$mark"
    G_WHY="timeout after ${GATE_TIMEOUT_S}s"
  elif [ "$rc" -ne 0 ]; then
    G_WHY="exit $rc"
  elif [ -n "$rx" ] && ! strip_csi <"$logfile" | grep -Eq -- "$rx"; then
    G_WHY="no count line matched"
  fi
}
# Runs gate $1 and decides its result: R_STATUS (PASS, KNOWN or FAIL), R_LINE (its result line), R_WHY
# and R_LOG (the last run's, for the baseline record) and R_FLAKY (the ids a passing retry healed).
run_gate_job() {
  local name=${GATE_NAMES[$1]} cmd=${GATE_CMDS[$1]} log secs n ids instant
  log="$LOG/$name.log"
  R_FLAKY=""
  launch_gate "$1" "$log"
  secs=$G_SECS
  if [ -z "$G_WHY" ]; then
    R_STATUS=PASS
    R_LINE="PASS $name ${secs}s $log"
  elif [ "$KNOWN_ON" -eq 1 ] && n=$(known_red "$name" "$G_WHY" "$log" "$cmd"); then
    R_STATUS=KNOWN
    R_LINE="KNOWN $name ${secs}s $log ($n failing test(s) in the $MAINLINE_B baseline, their files untouched)"
  else
    R_STATUS=FAIL
    if ids=$(flaky_ids "$G_WHY" "$log" "$cmd" "$secs"); then
      log="$LOG/$name.retry.log"
      launch_gate "$1" "$log"
      secs=$((secs + G_SECS))
      if [ -z "$G_WHY" ]; then
        R_STATUS=PASS
        R_FLAKY=$ids
        R_LINE="PASS $name ${secs}s $log (flaky: $(printf '%s\n' "$ids" | awk 'NR > 1 { printf "; " } { printf "%s", $0 }'), retried)"
      fi
    fi
    if [ "$R_STATUS" = FAIL ]; then
      instant=""
      # A timeout is never instant: the gate ran its whole allowance.
      if [ "${G_WHY#timeout}" = "$G_WHY" ] && [ "$secs" -lt "$INSTANT_SECS" ]; then instant=" (instant: if the log shows no real failure, check the command/env before re-running)"; fi
      R_LINE="FAIL $name ${secs}s $log ($G_WHY)$instant"
    fi
  fi
  R_WHY=$G_WHY
  R_LOG=$log
}

passed=0
failed=0
skipped=0
known=0
# The gates' result: the line, the counts, the baseline record and the flakes register.
take_result() {
  emit "$R_LINE"
  case "$R_STATUS" in
    PASS) passed=$((passed + 1)) ;;
    KNOWN) known=$((known + 1)) ;;
    *) failed=$((failed + 1)) ;;
  esac
  [ "$BASE_REC" -eq 0 ] || record_base "$1" "$R_WHY" "$R_LOG"
  [ -z "$R_FLAKY" ] || record_flake "$1" "$R_FLAKY"
}

# GATE_JOBS above 1 (see Parallel gates in the header): gate $1's run_gate_job in a background worker,
# started under set -m (a process group of its own, so INT is not ignored in it and in its gates), a
# subshell, so no trap of run-gates runs there. It writes its R_* to $LOG/.job-<i> (a temp file moved into
# place: a result is read whole) and its gate's and watchdog's group ids to $LOG/.job-<i>.pg (JOB_PG);
# TERM ends its gate (end_gate) and then the worker. JOB_SKIPS[i] holds a skipped gate's line; RUNNING
# counts the workers not reaped; SERIAL_ON = 1 while a SERIAL gate runs.
JOB_SKIPS=()
RUNNING=0
SERIAL_ON=0
is_serial() {
  case "$SERIAL_NAMES" in
    *" ${GATE_NAMES[$1]} "*) return 0 ;;
  esac
  return 1
}
start_job() {
  local res="$LOG/.job-$1"
  rm -f "$res" "$res.tmp" "$res.pg"
  set -m
  (
    trap 'end_gate; exit 143' TERM
    trap 'end_gate; exit 130' INT
    JOB_PG="$res.pg"
    run_gate_job "$1"
    { printf '%s\n%s\n%s\n%s\n' "$R_STATUS" "$R_LINE" "$R_WHY" "$R_LOG" && printf '%s' "$R_FLAKY"; } >"$res.tmp" &&
      mv -f "$res.tmp" "$res"
  ) </dev/null &
  JOB_PIDS[$1]=$!
  set +m
  RUNNING=$((RUNNING + 1))
  if is_serial "$1"; then SERIAL_ON=1; fi
}
# Reaps every worker that wrote its result or is gone; 0 = at least one was reaped.
collect_jobs() {
  local i=0 rc=1
  while [ "$i" -lt "${#JOB_PIDS[@]}" ]; do
    if [ -n "${JOB_PIDS[$i]}" ] && [ -z "${JOB_DONE[$i]}" ] &&
      { [ -f "$LOG/.job-$i" ] || ! kill -0 "${JOB_PIDS[$i]}" 2>/dev/null; }; then
      wait "${JOB_PIDS[$i]}" 2>/dev/null
      JOB_DONE[i]=run
      RUNNING=$((RUNNING - 1))
      if is_serial "$i"; then SERIAL_ON=0; fi
      rc=0
    fi
    i=$((i + 1))
  done
  return "$rc"
}
# Sets R_* from gate $1's result file; a worker that ended without one is a FAIL.
read_job() {
  local res="$LOG/.job-$1"
  if [ -f "$res" ]; then
    {
      IFS= read -r R_STATUS
      IFS= read -r R_LINE
      IFS= read -r R_WHY
      IFS= read -r R_LOG
      R_FLAKY=$(cat)
    } <"$res"
  else
    R_STATUS=FAIL
    R_WHY="no result"
    R_LOG="$LOG/${GATE_NAMES[$1]}.log"
    R_FLAKY=""
    R_LINE="FAIL ${GATE_NAMES[$1]} 0s $R_LOG (its worker ended without a result)"
  fi
  rm -f "$res" "$res.pg"
}
# The gates, GATE_JOBS at a time: launches in registration order while a slot is free (a SERIAL gate
# only once none runs, and none after it while it runs), and prints each result once every gate before
# it has printed.
run_parallel() {
  local n=${#GATE_NAMES[@]} next=0 out=0 i=0 s moved
  while [ "$i" -lt "$n" ]; do
    JOB_PIDS[i]=""
    JOB_DONE[i]=""
    JOB_SKIPS[i]=""
    i=$((i + 1))
  done
  while [ "$out" -lt "$n" ]; do
    while [ "$next" -lt "$n" ] && [ "$SERIAL_ON" -eq 0 ]; do
      if s=$(skip_line "$next"); then
        JOB_SKIPS[next]=$s
        JOB_DONE[next]=skip
      elif is_serial "$next"; then
        [ "$RUNNING" -eq 0 ] || break
        start_job "$next"
      else
        [ "$RUNNING" -lt "$JOBS" ] || break
        start_job "$next"
      fi
      next=$((next + 1))
    done
    moved=0
    collect_jobs && moved=1
    while [ "$out" -lt "$n" ] && [ -n "${JOB_DONE[$out]}" ]; do
      if [ "${JOB_DONE[$out]}" = skip ]; then
        emit "${JOB_SKIPS[$out]}"
        skipped=$((skipped + 1))
      else
        read_job "$out"
        take_result "${GATE_NAMES[$out]}"
      fi
      out=$((out + 1))
      moved=1
    done
    [ "$moved" -eq 1 ] || sleep 0.1
  done
}

compute_paths
if [ "$JOBS" -gt 1 ]; then
  run_parallel
else
  i=0
  while [ "$i" -lt "${#GATE_NAMES[@]}" ]; do
    if s=$(skip_line "$i"); then
      emit "$s"
      skipped=$((skipped + 1))
    else
      run_gate_job "$i"
      take_result "${GATE_NAMES[$i]}"
    fi
    i=$((i + 1))
  done
fi

[ "$BASE_REC" -eq 1 ] && commit_base
known_part=""
[ "$known" -eq 0 ] || known_part=", $known known"
emit "SUMMARY $passed passed, $failed failed, $skipped skipped$known_part ($MODE)"

# Only an all-PASS run is recorded, under the tree it started from and only if the tree (and
# the KEY_EXTRA output) is still the same now; a FAIL or a KNOWN is never cached.
RECORD=0
if [ "$failed" -eq 0 ] && [ "$known" -eq 0 ] && [ "$CACHE_ON" -eq 1 ] && [ -n "$KEY" ]; then
  START_KEY=$KEY
  START_VARIANT=$VARIANT
  compute_variant
  if ! compute_key || [ "$KEY" != "$START_KEY" ] || [ "$VARIANT" != "$START_VARIANT" ]; then
    echo "run-gates: NOT CACHED tree changed during the run" >&2
  else
    RECORD=1
  fi
fi
if [ "$RECORD" -eq 1 ]; then
  if mkdir -p "$REC_DIR" 2>/dev/null &&
    { iso_now && printf '%s' "$RESULT"; } >"$REC_DIR/.tmp.$$" 2>/dev/null &&
    mv -f "$REC_DIR/.tmp.$$" "$REC_DIR/$START_KEY" 2>/dev/null; then
    # Keep the 50 newest records per variant.
    # shellcheck disable=SC2012
    ls -t "$REC_DIR" 2>/dev/null | tail -n +51 | while IFS= read -r old; do rm -f "${REC_DIR:?}/${old:?}"; done
  else
    rm -f "${REC_DIR:?}/.tmp.$$" 2>/dev/null
  fi
fi

[ "$failed" -gt 98 ] && failed=98
exit "$failed"
