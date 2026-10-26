#!/usr/bin/env bash
# harness-bootstrap unit-stack (generated YYYY-MM-DD). A unit's own copy of what a live run needs - its
# ports, database and container project, all derived from one slot number - serving its worktree, so units
# run side by side and none of them touches the owner's stack. The pattern is one project's unit-stack.sh;
# two others (`wt:*`, a slot per worktree; a compose project per task) built the same lock their own way.
# [M] mechanism (ship as-is): the slot lock in the registry, the ownership checks, the disk floor, the
#   state file and the commands. [B] binding: the block between the unit-stack markers.
#
#   bash scripts/unit-stack.sh free-slot   the lowest slot no held row names, no stack serves and nothing listens on
#   bash scripts/unit-stack.sh up <slot>   start this worktree's stack on the slot and wait for it to answer
#   bash scripts/unit-stack.sh env         the slot's variables, for the gates and the live run
#   bash scripts/unit-stack.sh status      the slot, the checkout its stack serves, whether it answers
#   bash scripts/unit-stack.sh down        remove what the slot owns (teardown), then check its ports are free
#
# The slot is claimed first in the unit's registry row: Resources `slot N`, Worktree naming this worktree.
# It is recorded again in .unit-stack.env here (gitignored). The main checkout is the owner's: no unit
# stack serves it. Exit 0 done, 1 refused or failed (the reason on stderr).
set -u

STATE=.unit-stack.env

# >>> unit-stack [B] - the slot range, the disk floor and everything a slot owns
SLOTS="1 2 3 4 5 6"
MIN_FREE_GB=5   # a stack's volumes and an image build need room: a full disk once hung Docker Desktop for every project
HEALTH_WAIT=300 # seconds `up` waits for stack_healthy
# Everything slot N owns, derived from N alone. Every port the stack publishes is in UNIT_PORTS, in a block
# clear of the owner's own ports and of those the OS holds (macOS: 5000 and 7000).
slot_vars() {
  UNIT_SLOT=$1
  UNIT_PROJECT="app-u$1" # a Compose project name: lowercase only
  UNIT_APP_PORT=$((4800 + 20 * $1))
  UNIT_DB_PORT=$((UNIT_APP_PORT + 1))
  UNIT_PORTS="$UNIT_APP_PORT $UNIT_DB_PORT"
}
# The functions below run with slot_vars already set for the slot.
# Start the stack serving this worktree ($HERE), idempotently: an `up` on a running stack is a no-op. E.g.
#   PORT=$UNIT_APP_PORT DB_PORT=$UNIT_DB_PORT docker compose -p "$UNIT_PROJECT" up -d
stack_up() {
  echo "unit-stack: stack_up is not bound - edit the [B] block of scripts/unit-stack.sh" >&2
  return 1
}
# Remove everything the slot owns and nothing else, e.g. docker compose -p "$UNIT_PROJECT" down -v --remove-orphans
stack_down() {
  echo "unit-stack: stack_down is not bound - edit the [B] block of scripts/unit-stack.sh" >&2
  return 1
}
# 0 once the stack answers, e.g. curl -fs --max-time 10 "http://localhost:$UNIT_APP_PORT/health" >/dev/null
stack_healthy() {
  return 1
}
# The project's own variables for the slot, one NAME=value line each, after UNIT_SLOT, UNIT_PROJECT and UNIT_PORTS.
slot_env() {
  echo "BASE_URL=http://localhost:$UNIT_APP_PORT"
}
# Print the host path of the checkout the slot's stack serves (its source bind mount), nothing when none runs.
# E.g. docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}' <app container>
stack_serves() {
  :
}
# <<< unit-stack

die() {
  echo "unit-stack: $*" >&2
  exit 1
}

TOP=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$TOP" || die "cannot enter $TOP"
HERE=$(pwd -P)
COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || die "git 2.31 or later is needed"
MAIN=$(cd "$COMMON/.." && pwd -P)
REGISTRY="$MAIN/.claude/registry.md"

valid_slot() {
  case " $SLOTS " in *" $1 "*) [ -n "$1" ] ;; *) return 1 ;; esac
}

listening() {
  command -v lsof >/dev/null 2>&1 || die "lsof not found: it is how this script sees a port in use"
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

# The checkout the slot's stack serves, as a real path (Docker Desktop reports it under /host_mnt), or nothing.
served_by() {
  local src
  src=$(stack_serves | head -n 1)
  [ -n "$src" ] || return 0
  src=${src#/host_mnt}
  (cd "$src" 2>/dev/null && pwd -P) || printf '%s\n' "$src"
}

# "<slot>|<Worktree cell>" for each held row whose Resources cell names a slot. Held rows, the header and the
# Worktree cell are read as the commit guard reads them (harness-guard.sh): inside the active markers, first
# cell 1 or more, columns by the header row.
registry_slots() {
  [ -f "$REGISTRY" ] || return 0
  awk '
    function cells(s) {
      sub(/[ \t\r]+$/, "", s)
      if (s !~ /\|$/) s = s "|"
      return split(s, c, "|")
    }
    function trim(v) { gsub(/^[ \t`]+|[ \t`]+$/, "", v); return v }
    function issep(s) { return s ~ /^[ \t]*\|[ \t:|\r-]*-[ \t:|\r-]*$/ }
    /<!-- harness:active -->/ {
      if (!seen && np > 1 && issep(p[np])) ph = p[np - 1]
      seen = 1; on = 1; next
    }
    !on && /^[ \t]*\|/ { p[++np] = $0; next }
    !on { np = 0 }
    /<!-- \/harness:active -->/ { on = 0 }
    on && /^[ \t]*\|/ { r[++m] = $0 }
    END {
      for (j = 1; j < m && !hdr; j++)
        if (issep(r[j + 1])) hdr = j
      hl = hdr ? r[hdr] : ph
      if (hl != "") {
        n = cells(hl)
        for (i = 2; i < n; i++) {
          h = tolower(trim(c[i]))
          if (h == "worktree") w = i
          if (h == "resources") rc = i
        }
      }
      if (!rc) exit
      for (j = 1; j <= m; j++) {
        if (hdr && (j == hdr || j == hdr + 1)) continue
        n = cells(r[j])
        num = c[2]; gsub(/[ \t]/, "", num)
        if (num !~ /^[1-9][0-9]*$/) continue
        if (!match(tolower(c[rc]), /slot[ \t]*[0-9]+/)) continue
        s = substr(c[rc], RSTART, RLENGTH); gsub(/[^0-9]/, "", s)
        wt = ""
        if (w) {
          wt = c[w]; gsub(/`/, "", wt); gsub(/^[ \t]+/, "", wt)
          k = match(wt, /[ \t]/); if (k) wt = substr(wt, 1, k - 1)
          k = index(wt, "·"); if (k) wt = substr(wt, 1, k - 1)
          lw = tolower(wt)
          if (lw == "-" || lw == "—" || lw == "n/a" || lw == "none") wt = ""
        }
        print s "|" wt
      }
    }' "$REGISTRY"
}

# The checkout a Worktree cell names, as a real path: empty, main and . are the main checkout; anything else
# is a path relative to it, or absolute.
resolve() {
  local p
  case "$1" in
    '' | main | .) p=$MAIN ;;
    /*) p=$1 ;;
    *) p=$MAIN/$1 ;;
  esac
  (cd "$p" 2>/dev/null && pwd -P) || printf '%s\n' "$p"
}

# The checkout of the first held row naming slot $1 that is not this worktree, or nothing.
held_elsewhere() {
  local s wt where
  while IFS='|' read -r s wt; do
    [ "$s" = "$1" ] || continue
    where=$(resolve "$wt")
    [ "$where" = "$HERE" ] || {
      printf '%s\n' "$where"
      return 0
    }
  done <<EOF
$(registry_slots)
EOF
}

held_here() {
  local s wt
  while IFS='|' read -r s wt; do
    [ "$s" = "$1" ] && [ "$(resolve "$wt")" = "$HERE" ] && return 0
  done <<EOF
$(registry_slots)
EOF
  return 1
}

# Refuses a slot another worktree's row holds, or whose stack serves another checkout (a stale $STATE after
# the slot was reused: `down` here would remove that unit's data). Returns 0 when the slot's stack serves this
# worktree, 1 when none runs. Needs slot_vars set.
check_owner() {
  local other src
  other=$(held_elsewhere "$UNIT_SLOT")
  [ -z "$other" ] || die "slot $UNIT_SLOT is held by the registry row of $other"
  src=$(served_by)
  [ -n "$src" ] || return 1
  [ "$src" = "$HERE" ] || die "slot $UNIT_SLOT serves $src, not this worktree (a stale $STATE here?)"
  return 0
}

load_state() {
  [ -f "$STATE" ] || die "no stack in this worktree: bash scripts/unit-stack.sh up <slot> (free-slot names one)"
  local s
  s=$(sed -n 's/^UNIT_SLOT=\([0-9][0-9]*\)$/\1/p' "$STATE" | head -n 1)
  valid_slot "$s" || die "$STATE holds no valid UNIT_SLOT"
  slot_vars "$s"
}

cmd_free_slot() {
  local s p held busy
  held=$(registry_slots | cut -d'|' -f1)
  for s in $SLOTS; do
    printf '%s\n' "$held" | grep -qx "$s" && continue
    slot_vars "$s"
    [ -z "$(served_by)" ] || continue
    busy=0
    for p in $UNIT_PORTS; do listening "$p" && busy=1; done
    [ "$busy" = 0 ] || continue
    echo "$s"
    return 0
  done
  die "no free slot in: $SLOTS"
}

cmd_up() {
  local s=${1:-} p avail waited=0
  valid_slot "$s" || die "usage: unit-stack.sh up <slot> (one of: $SLOTS)"
  [ "$HERE" != "$MAIN" ] || die "the main checkout is the owner's; a unit stack serves a worktree"
  if [ -f "$STATE" ]; then
    load_state
    [ "$UNIT_SLOT" = "$s" ] || die "this worktree already runs slot $UNIT_SLOT; down it first"
  fi
  slot_vars "$s"
  held_here "$s" || die "no held registry row names slot $s for this worktree: claim it first (Resources: slot $s)"
  if ! check_owner; then
    for p in $UNIT_PORTS; do listening "$p" && die "port $p is in use by another process"; done
    avail=$(df -Pk . | awk 'NR == 2 { print $4 }')
    [ "${avail:-0}" -ge $((MIN_FREE_GB * 1024 * 1024)) ] ||
      die "only $((${avail:-0} / 1024 / 1024)) GB free, $MIN_FREE_GB GB needed (the machine sweep frees space)"
  fi
  [ -f "$STATE" ] || printf 'UNIT_SLOT=%s\n' "$s" >"$STATE"
  stack_up || die "stack_up failed for slot $s"
  until stack_healthy; do
    [ "$waited" -lt "$HEALTH_WAIT" ] || die "slot $s did not answer within ${HEALTH_WAIT}s"
    sleep 5
    waited=$((waited + 5))
  done
  echo "unit-stack: slot $s is up"
  cmd_env
}

cmd_env() {
  load_state
  echo "UNIT_SLOT=$UNIT_SLOT"
  echo "UNIT_PROJECT=$UNIT_PROJECT"
  echo "UNIT_PORTS=\"$UNIT_PORTS\""
  slot_env
}

cmd_status() {
  local src
  load_state
  src=$(served_by)
  echo "unit-stack: slot $UNIT_SLOT serves ${src:-nothing}"
  if stack_healthy; then echo "unit-stack: answering"; else echo "unit-stack: not answering"; fi
}

cmd_down() {
  local p
  load_state
  check_owner || true
  stack_down || die "stack_down failed for slot $UNIT_SLOT"
  rm -f "$STATE"
  for p in $UNIT_PORTS; do listening "$p" && die "port $p still listens after down"; done
  echo "unit-stack: slot $UNIT_SLOT removed; its ports are free"
}

case "${1:-}" in
  free-slot) cmd_free_slot ;;
  up) cmd_up "${2:-}" ;;
  env) cmd_env ;;
  status) cmd_status ;;
  down) cmd_down ;;
  *) die "usage: unit-stack.sh free-slot | up <slot> | env | status | down" ;;
esac
