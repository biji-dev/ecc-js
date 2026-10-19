#!/usr/bin/env bash
# harness-bootstrap run-gates (generated YYYY-MM-DD)
# [M] mechanism, ship as-is: the never-bail loop, per-gate log files, the result-line
#     format, exit status = number of failed gates, and the --since scoped mode.
# [B] binding, re-derived per project: the gate list between the harness:gates markers
#     and the SCOPED_PATHS line.
#
# Usage: bash scripts/run-gates.sh [--since <ref>] | --list
#   Invoke it with bash (`bash scripts/run-gates.sh`), not sh or dash: it uses arrays.
#   (no args)        FULL run: every gate.
#   --since <ref>    SCOPED run: skips `full` gates. The changed files are worked out
#                    here (git diff against <ref> plus untracked files) because a
#                    package manager's "changed since" filter ignores uncommitted
#                    edits. A change outside SCOPED_PATHS promotes the run to FULL.
#   --list           print "<name> <mode>" per gate and exit 0.
# Gates: `gate <name> <always|full> '<command>'` passes when the command exits 0.
#   `gate_counted <name> <always|full> '<regex>' '<command>'` also needs the command's
#   combined output to match the extended regex, so a runner that ran zero tests
#   (or skipped them all) and exited 0 is a FAIL, not a PASS.
# Output: one line per gate, in registration order:
#   PASS <name> <secs>s <logpath> | FAIL <name> <secs>s <logpath> (exit <n>)
#   | FAIL <name> <secs>s <logpath> (no count line matched) | SKIP <name> (full only)
# Exit status = number of FAIL lines (capped at 98); 99 = usage error (including no gates bound).
# Env: RUN_GATES_LOG_DIR overrides the log dir. Each gate sees RUN_GATES_MODE=full|scoped,
#      RUN_GATES_SINCE=<ref or empty>, RUN_GATES_CHANGED_FILE=<changed-file list, scoped only>.

if [ -z "${BASH_VERSION:-}" ]; then
  echo "run-gates: needs bash (it uses arrays); run it as: bash scripts/run-gates.sh" >&2
  exit 99
fi

set -u

usage() {
  echo "run-gates: $1" >&2
  echo "usage: run-gates.sh [--since <ref>] | --list" >&2
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

SINCE=""
LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --since)
      [ $# -ge 2 ] && [ -n "$2" ] || usage "--since needs a non-empty ref"
      SINCE="$2"
      shift 2
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

# Changed files are computed before the log dir is created, minus anything under the
# log dirs themselves, so a run's own logs never count as a change.
MODE=full
CHANGED=""
if [ -n "$SINCE" ]; then
  MODE=scoped
  case "$LOG" in
    "$TOP"/*) LOG_REL="${LOG#"$TOP"/}" ;;
    /*) LOG_REL="" ;;
    *) LOG_REL="${LOG#./}" ;;
  esac
  DIFF_OUT=$(git -c core.quotePath=false diff --name-only --no-renames "$SINCE" --) ||
    usage "git diff against $SINCE failed; cannot list the changed files"
  UNTRACKED_OUT=$(git -c core.quotePath=false ls-files --others --exclude-standard) ||
    usage "git ls-files failed; cannot list the untracked files"
  CHANGED=$(printf '%s\n%s\n' "$DIFF_OUT" "$UNTRACKED_OUT" | filter_changed | sort -u)
fi

mkdir -p "$LOG" || usage "cannot create log dir: $LOG"
echo "logs: $LOG"

CHANGED_FILE=""
if [ "$MODE" = scoped ]; then
  CHANGED_FILE="$LOG/changed-files.txt"
  if [ -n "$CHANGED" ]; then printf '%s\n' "$CHANGED" >"$CHANGED_FILE"; else : >"$CHANGED_FILE"; fi
  if [ -z "$CHANGED" ]; then
    echo "SCOPED: nothing changed since $SINCE"
  else
    outside=$(printf '%s\n' "$CHANGED" | grep -vE "$SCOPED_PATHS" | head -n 1)
    if [ -n "$outside" ]; then
      echo "PROMOTED to FULL: $outside"
      MODE=full
      SINCE=""
      CHANGED_FILE=""
    fi
  fi
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
    echo "SKIP $name (full only)"
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
    echo "PASS $name ${secs}s $logfile"
    passed=$((passed + 1))
  else
    echo "FAIL $name ${secs}s $logfile ($why)"
    failed=$((failed + 1))
  fi
done

echo "SUMMARY $passed passed, $failed failed, $skipped skipped ($MODE)"
[ "$failed" -gt 98 ] && failed=98
exit "$failed"
