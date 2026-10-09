#!/bin/sh
# harness-bootstrap commit guard (generated YYYY-MM-DD). Refuses, never merely checks.
# [M] the logic below. [B] the three settings: re-derive them from this project.
# Install: .githooks/pre-commit (git config core.hooksPath .githooks), or call it
# from an existing husky/lefthook pre-commit. Test THIS file, never a copy.

REGISTRY=".claude/registry.md"             # [B] the lock file, relative to the repo root
ID_PATTERN='[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[0-9]+[a-z]?'  # [B] must match every task-id shape the plan uses
LABEL="harness guard"

refuse() {
  echo "$LABEL: REFUSE - $1" >&2
  exit 1
}

# The registry lives in the main checkout, so every linked worktree of this clone
# reads the same lock. Keep it untracked (gitignored): claim and release are edits.
top=$(git rev-parse --show-toplevel) || exit 1
common=$(cd "$top" && cd "$(git rev-parse --git-common-dir)" && pwd) || exit 1
case "$common" in
  */.git) root=${common%/.git} ;;
  *) root=$top ;;
esac
reg="$root/$REGISTRY"

# No registry: the harness is not in use in this checkout.
if [ ! -f "$reg" ]; then
  exit 0
fi

if ! grep -q '<!-- harness:active -->' "$reg" || ! grep -q '<!-- /harness:active -->' "$reg"; then
  refuse "$REGISTRY has no '<!-- harness:active -->' ... '<!-- /harness:active -->' section"
fi

# Cells of every held row: rows inside the active section whose first cell is 1+.
# Row 0 is reserved for the mainline and never counts as held.
held=$(awk '
  /<!-- harness:active -->/ { on = 1; next }
  /<!-- \/harness:active -->/ { on = 0 }
  on && /^[ \t]*\|/ {
    n = split($0, c, "|")
    num = c[2]; gsub(/[ \t]/, "", num)
    if (num ~ /^[1-9][0-9]*$/) {
      for (i = 3; i < n; i++) { v = c[i]; gsub(/^[ \t`]+|[ \t`]+$/, "", v); if (v != "") print v }
      print "#row"
    }
  }' "$reg")

branch=$(git branch --show-current 2>/dev/null)
id=$(printf '%s\n' "$branch" | grep -oE "$ID_PATTERN" | head -n 1)

if [ -n "$id" ]; then
  # A task branch may commit only while its own row is held.
  if printf '%s\n' "$held" | grep -qxF "$id"; then
    exit 0
  fi
  # A tracked registry only: the land step's release commit touches nothing but the
  # registry and removes this task's row.
  staged=$(git diff --cached --name-only)
  if [ "$staged" = "$REGISTRY" ] && git diff --cached -- "$REGISTRY" | grep -E '^-[ \t]*\|' | grep -qF "$id"; then
    exit 0
  fi
  refuse "branch '$branch' carries $id, which holds no row in $REGISTRY. Claim the lock first."
fi

# Not a task branch (the mainline, or anything else): refuse while any run holds a row.
if printf '%s\n' "$held" | grep -qx '#row'; then
  refuse "a run holds a row in $REGISTRY and '${branch:-detached HEAD}' is not its task branch."
fi

exit 0
