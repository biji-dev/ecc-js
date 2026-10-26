#!/usr/bin/env bash
# harness-bootstrap run-gates (generated YYYY-MM-DD)
# [M] mechanism, ship as-is: the never-bail loop, per-gate log files, the result-line
#     format, exit status = number of failed gates, the --since scoped mode, the result
#     cache keyed by tree, the single-flight lock and the instant-failure note.
# [B] binding, re-derived per project: the gate list between the harness:gates markers
#     and the SCOPED_PATHS line.
#
# Usage: bash scripts/run-gates.sh [--since <ref>] [--no-cache] | --list
#   Invoke it with bash (`bash scripts/run-gates.sh`), not sh or dash: it uses arrays.
#   (no args)        FULL run: every gate.
#   --since <ref>    SCOPED run: skips `full` gates. The changed files are worked out
#                    here (git diff against <ref> plus untracked files) because a
#                    package manager's "changed since" filter ignores uncommitted
#                    edits. A change outside SCOPED_PATHS promotes the run to FULL.
#   --no-cache       run the gates even when a cached all-PASS result exists for this tree
#                    (RUN_GATES_NO_CACHE=1 does the same). A passing run still refreshes the cache.
#   --list           print "<name> <mode>" per gate and exit 0.
# Gates: `gate <name> <always|full> '<command>'` passes when the command exits 0.
#   `gate_counted <name> <always|full> '<regex>' '<command>'` also needs the command's
#   combined output to match the extended regex, so a runner that ran zero tests
#   (or skipped them all) and exited 0 is a FAIL, not a PASS.
# Output: one line per gate, in registration order, then a SUMMARY line:
#   PASS <name> <secs>s <logpath> | FAIL <name> <secs>s <logpath> (exit <n>)
#   | FAIL <name> <secs>s <logpath> (no count line matched) | SKIP <name> (full only)
#   SUMMARY <p> passed, <f> failed, <s> skipped (<full|scoped>)
#   A FAIL in under RUN_GATES_INSTANT_SECS seconds (default 10) ends with
#   " (instant: if the log shows no real failure, check the command/env before re-running)":
#   a gate that dies at once is often the command or the environment, not the code (a
#   genuine fast failure gets the note too, so read the log first).
# Reuse: the working tree (tracked, staged, unstaged and untracked files, minus
#   .review-work/ and the log dir) is hashed with `git write-tree` into a temporary index;
#   the real index is never touched. A run with every gate PASS is recorded under that tree,
#   the mode (full or scoped:<since-sha>), the bound gate list and the KEY_EXTRA output. The
#   next run for the same tree, mode, gates and extra prints, instead of running anything:
#     REUSED <tree> <time of the original run>
#     <the original result lines and SUMMARY line>            (exit 0)
#   A run is recorded only if the tree is still the same after the gates ran; otherwise it
#   prints "NOT CACHED tree changed during the run" on stderr (a gate that writes files into
#   the tree, or an edit made meanwhile: the result may describe neither tree). A FAIL is
#   never recorded. Not a reusable state (no commit yet, no git index to hash): runs normally.
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
#     KEY_EXTRA='cat pnpm-lock.yaml node_modules/.modules.yaml 2>/dev/null; git rev-parse origin/main'
#   Worktrees of one repository share the cache (same tree, same result), so a worktree
#   whose ignored inputs differ needs KEY_EXTRA to name them. Keep the cache dir out of any
#   writer's reach (a sandboxed Codex run must not be able to write a PASS record): the
#   default is under the git common dir, outside the working tree.
# Lock: one run per worktree and mode at a time. A second run prints "WAITING for run <pid>"
#   on stderr, polls every RUN_GATES_LOCK_POLL seconds (default 5) for up to
#   RUN_GATES_LOCK_WAIT seconds (default 1800), then works out the changed files, the mode
#   (scoped or promoted to full), the cache variant and the tree again and looks at the
#   cache before it runs (the other run's result is usually a hit). A lock whose pid is dead
#   is taken over (only while it still names that pid); a lock is removed only by its owner;
#   after the wait limit the run goes ahead without the lock.
# Exit status = number of FAIL lines (capped at 98); 99 = usage error (including no gates bound).
# Env: RUN_GATES_LOG_DIR overrides the log dir. Each gate sees RUN_GATES_MODE=full|scoped,
#      RUN_GATES_SINCE=<ref or empty>, RUN_GATES_CHANGED_FILE=<changed-file list, scoped only>.
#      RUN_GATES_CACHE_DIR overrides the cache dir (default: run-gates-cache inside the git
#      common dir, which worktrees of one repository share). RUN_GATES_NO_CACHE,
#      RUN_GATES_DOCS_ONLY, RUN_GATES_KEY_EXTRA, RUN_GATES_LOCK_WAIT, RUN_GATES_LOCK_POLL,
#      RUN_GATES_INSTANT_SECS: above.

if [ -z "${BASH_VERSION:-}" ]; then
  echo "run-gates: needs bash (it uses arrays); run it as: bash scripts/run-gates.sh" >&2
  exit 99
fi

set -u

usage() {
  echo "run-gates: $1" >&2
  echo "usage: run-gates.sh [--since <ref>] [--no-cache] | --list" >&2
  exit 99
}

GATE_NAMES=()
GATE_MODES=()
GATE_CMDS=()
GATE_RXS=()
# gate <name> <always|full> '<command>' only registers; the runner executes after the block.
gate() {
  [ "$#" -eq 3 ] && [ -n "$3" ] || usage "gate '${1:-}': expected exactly: gate <name> <always|full> '<command>' (quote the command, and do not leave it empty)"
  case "${2:-}" in
    always | full) ;;
    *) usage "gate '${1:-}': mode must be always or full" ;;
  esac
  GATE_NAMES+=("$1")
  GATE_MODES+=("$2")
  GATE_CMDS+=("$3")
  GATE_RXS+=("")
}
# gate_counted <name> <always|full> '<regex>' '<command>' registers a gate that passes only when
# the command exits 0 AND its combined output matches the extended regex (write the regex to
# require a non-zero count, e.g. 'pass [1-9]').
gate_counted() {
  [ "$#" -eq 4 ] && [ -n "$3" ] && [ -n "$4" ] || usage "gate '${1:-}': expected exactly: gate_counted <name> <always|full> '<regex>' '<command>' (quote both, and do not leave either empty)"
  case "${2:-}" in
    always | full) ;;
    *) usage "gate '${1:-}': mode must be always or full" ;;
  esac
  local rc=0
  printf '' | grep -Eq -- "$3" 2>/dev/null || rc=$?
  [ "$rc" -le 1 ] || usage "gate '$1': the count regex is not a valid extended regex: $3"
  GATE_NAMES+=("$1")
  GATE_MODES+=("$2")
  GATE_CMDS+=("$4")
  GATE_RXS+=("$3")
}

# >>> harness:gates [B] — one line per gate: gate <name> <always|full> '<command>'
# Every example is commented out: bind the project's own gates here. With none bound the
# runner exits 99 instead of reporting a green run of nothing.
# gate typecheck always 'npm run -s typecheck'
# gate lint always 'npm run -s lint'
# gate test always 'npm test'
# gate build full 'npm run -s build'
# gate_counted test always 'pass [1-9]' 'node --test'   # fails when zero tests ran
# <<< harness:gates

# [B] extended regex for the paths a scoped run may cover; a change outside it runs FULL.
SCOPED_PATHS='^(src|apps|packages|lib|docs|tests?)/|\.md$'
# [B] docs-only reuse: extended regex of paths no gate reads; empty = off (see Reuse above).
DOCS_ONLY=''
# [B] extra cache-key input: a shell command whose stdout joins the key; empty = nothing.
KEY_EXTRA=''

SINCE=""
LIST=0
NO_CACHE=0
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
    --list)
      LIST=1
      shift
      ;;
    *) usage "unknown argument: $1" ;;
  esac
done

[ "${#GATE_NAMES[@]}" -gt 0 ] || usage "no gates bound - edit the [B] block between the harness:gates markers"

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
# Called again after a lock wait: the tree may have changed meanwhile.
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
  CHANGED=$(printf '%s\n%s\n' "$diff_out" "$untracked_out" | filter_changed | sort -u)
  if [ -z "$CHANGED" ]; then
    NOTE="SCOPED: nothing changed since $SINCE"
  else
    outside=$(printf '%s\n' "$CHANGED" | grep -vE "$SCOPED_PATHS" | head -n 1)
    if [ -n "$outside" ]; then
      NOTE="PROMOTED to FULL: $outside"
      MODE=full
    fi
  fi
}
compute_scope

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
release_lock() {
  if [ "$LOCK_OWNED" -eq 1 ] && [ -n "$LOCK_DIR" ]; then
    LOCK_OWNED=0
    # Only our own lock: a taker-over may have replaced it.
    if [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ]; then rm -rf "${LOCK_DIR:?}" 2>/dev/null; fi
  fi
  return 0
}
trap release_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Sets MODE_ID, VARIANT and REC_DIR: the mode, the bound gates and the KEY_EXTRA output decide
# which records can answer this run. Called again after a lock wait (the mode may have changed).
compute_variant() {
  local extra=""
  MODE_ID=full
  if [ "$MODE" = scoped ]; then
    MODE_ID="scoped:$(git rev-parse --verify --quiet "$SINCE^{commit}")"
  fi
  if [ -n "$KEY_EXTRA_CMD" ]; then extra=$(bash -c "$KEY_EXTRA_CMD" 2>/dev/null </dev/null); fi
  VARIANT=$(hash_str "$MODE_ID|$(hash_str "$GATES_SIG")|$(hash_str "$extra")")
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
compute_key() {
  local d src
  KEY=""
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
  KEY=$(
    export GIT_INDEX_FILE="$d/index"
    git add -A >/dev/null 2>&1 &&
      git --literal-pathspecs rm -r -q --cached --ignore-unmatch -- "${KEY_EXCLUDES[@]}" >/dev/null 2>&1 &&
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
    acquire_lock || true
    if [ "$LOCK_WAITED" -eq 1 ]; then
      # The other run took its time: the changed files, the mode, the variant and the tree may
      # all differ now, and its result may be a hit.
      refresh_state || CACHE_ON=0
      if [ "$CACHE_ON" -eq 1 ] && [ "$NO_CACHE" -eq 0 ] && try_reuse; then exit 0; fi
    fi
  else
    CACHE_ON=0
  fi
fi

mkdir -p "$LOG" || usage "cannot create log dir: $LOG"
echo "logs: $LOG"

CHANGED_FILE=""
if [ "$SCOPED_REQ" -eq 1 ]; then
  if [ "$MODE" = scoped ]; then CHANGED_FILE="$LOG/changed-files.txt"; else SINCE=""; fi
  if [ -n "$CHANGED" ]; then printf '%s\n' "$CHANGED" >"$LOG/changed-files.txt"; else : >"$LOG/changed-files.txt"; fi
  [ -z "$NOTE" ] || echo "$NOTE"
fi

passed=0
failed=0
skipped=0
i=0
while [ "$i" -lt "${#GATE_NAMES[@]}" ]; do
  name="${GATE_NAMES[$i]}"
  gmode="${GATE_MODES[$i]}"
  cmd="${GATE_CMDS[$i]}"
  rx="${GATE_RXS[$i]}"
  i=$((i + 1))
  if [ "$MODE" = scoped ] && [ "$gmode" = full ]; then
    emit "SKIP $name (full only)"
    skipped=$((skipped + 1))
    continue
  fi
  logfile="$LOG/$name.log"
  start=$SECONDS
  RUN_GATES_MODE="$MODE" RUN_GATES_SINCE="$SINCE" RUN_GATES_CHANGED_FILE="$CHANGED_FILE" \
    bash -c "$cmd" >"$logfile" 2>&1 </dev/null
  rc=$?
  secs=$((SECONDS - start))
  why=""
  if [ "$rc" -ne 0 ]; then
    why="exit $rc"
  elif [ -n "$rx" ] && ! grep -Eq -- "$rx" "$logfile"; then
    why="no count line matched"
  fi
  if [ -z "$why" ]; then
    emit "PASS $name ${secs}s $logfile"
    passed=$((passed + 1))
  else
    instant=""
    if [ "$secs" -lt "$INSTANT_SECS" ]; then instant=" (instant: if the log shows no real failure, check the command/env before re-running)"; fi
    emit "FAIL $name ${secs}s $logfile ($why)$instant"
    failed=$((failed + 1))
  fi
done

emit "SUMMARY $passed passed, $failed failed, $skipped skipped ($MODE)"

# Only an all-PASS run is recorded, under the tree it started from and only if the tree (and
# the KEY_EXTRA output) is still the same now; a FAIL is never cached.
RECORD=0
if [ "$failed" -eq 0 ] && [ "$CACHE_ON" -eq 1 ] && [ -n "$KEY" ]; then
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
