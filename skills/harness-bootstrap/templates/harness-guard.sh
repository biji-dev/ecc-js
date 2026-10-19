#!/bin/sh
# harness-bootstrap commit guard (generated YYYY-MM-DD). Refuses, never merely checks.
# [M] the logic below. [B] REGISTRY, ID_PATTERN and SCOPE: re-derive them from this project.
# Install: .githooks/pre-commit (git config core.hooksPath .githooks), or call it
# from an existing husky/lefthook pre-commit. Install the same file as
# .githooks/pre-merge-commit too: a non-conflicting merge runs that hook, not
# pre-commit. Test THIS file, never a copy.

REGISTRY=".claude/registry.md"             # [B] the lock file, relative to the repo root
# ID_PATTERN binds per mode. Plan mode: the plan's id shape (every shape it uses). Change
# mode: '' (branches carry no id; a unit matches a row by its Branch cell only), or the
# change id shape if the project has one. Matched against the UPPERCASED branch name, so
# a plan id P2-20 owns task/p2-20; keep the pattern uppercase (letters after the digits
# may be either case).
ID_PATTERN='[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[0-9]+[A-Za-z]?'  # [B] the task-id shape; '' = no id matching
SCOPE="repo"                               # [B] repo = one lock for the whole clone; checkout = one lock per checkout (worktree)
LABEL="harness guard"

refuse() {
  echo "$LABEL: REFUSE - $1" >&2
  exit 1
}

case "$SCOPE" in
  repo|checkout) ;;
  *) refuse "invalid SCOPE '$SCOPE' (use repo or checkout)" ;;
esac

# The registry lives in the main checkout, so every linked worktree of this clone
# reads the same lock. Keep it untracked (gitignored): claim and release are edits.
top=$(git rev-parse --show-toplevel) || exit 1
common=$(cd "$top" && cd "$(git rev-parse --git-common-dir)" && pwd) || exit 1
case "$common" in
  */.git) root=${common%/.git} ;;
  *) root=$top ;;
esac
root=$(cd "$root" && pwd -P) || exit 1
curp=$(cd "$top" && pwd -P) || exit 1
reg="$root/$REGISTRY"

# No registry: the harness is not in use in this checkout.
if [ ! -f "$reg" ]; then
  exit 0
fi

if ! grep -q '<!-- harness:active -->' "$reg" || ! grep -q '<!-- /harness:active -->' "$reg"; then
  refuse "$REGISTRY has no '<!-- harness:active -->' ... '<!-- /harness:active -->' section"
fi

branch=$(git branch --show-current 2>/dev/null)
id=""
if [ -n "$ID_PATTERN" ]; then
  id=$(printf '%s\n' "$branch" | tr '[:lower:]' '[:upper:]' | grep -oE "$ID_PATTERN" | head -n 1)
fi

# One line per held row: "<matched name>|<Worktree cell>". Rows inside the active section
# whose first cell is 1+ count as held; row 0 is reserved for the mainline. The header is the
# row directly above a |---| separator row; with none inside the section, the table header
# right above the begin marker (markers around data rows only). No header at all: every
# numbered row is data and no cell is the Worktree cell. A row matches when its Branch cell
# equals the branch name (no Branch column: any cell but Worktree does) or any cell but
# Worktree equals the branch's task id, ignoring case (the id is uppercased). A Worktree cell holds a path, never a match; a
# placeholder (-, n/a, none) is the same as empty.
held=$(awk -v b="$branch" -v id="$id" '
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
        if (h == "branch") bc = i
      }
    }
    for (j = 1; j <= m; j++) {
      if (hdr && (j == hdr || j == hdr + 1)) continue
      n = cells(r[j])
      num = c[2]; gsub(/[ \t]/, "", num)
      if (num !~ /^[1-9][0-9]*$/) continue
      tok = ""
      for (i = 3; i < n; i++) {
        if (i == w) continue
        v = trim(c[i])
        if (v == "") continue
        if (b != "" && v == b && (!bc || i == bc)) tok = b
        else if (id != "" && toupper(v) == id && tok == "") tok = id
      }
      wt = ""
      if (w) {
        wt = c[w]; gsub(/`/, "", wt); gsub(/^[ \t]+/, "", wt)
        k = match(wt, /[ \t]/); if (k) wt = substr(wt, 1, k - 1)
        k = index(wt, "·"); if (k) wt = substr(wt, 1, k - 1)
        lw = tolower(wt)
        if (lw == "-" || lw == "—" || lw == "n/a" || lw == "none") wt = ""
      }
      print tok "|" wt
    }
  }' "$reg")

# Which checkout does a Worktree cell lock? Empty, main and . mean the main checkout;
# anything else is a path relative to it (or absolute). Sets $res.
resolve() {
  case "$1" in
    ''|main|.) p=$root ;;
    /*) p=$1 ;;
    *) p=$root/$1 ;;
  esac
  res=$(cd "$p" 2>/dev/null && pwd -P) || res=$p
}

is_here() { [ "$1" = "$curp" ]; }

match_here=0
match_other=""
lock_here=0
if [ -n "$held" ]; then
  while IFS='|' read -r tok wt; do
    if [ "$SCOPE" = "checkout" ]; then resolve "$wt"; else res=$curp; fi
    if is_here "$res"; then lock_here=1; fi
    if [ -n "$tok" ]; then
      if is_here "$res"; then match_here=1; else match_other="row for $tok locks $res, not this checkout"; fi
    fi
  done <<EOF
$held
EOF
fi

# A row for this branch (or its task id) that locks this checkout: the owning run.
if [ "$match_here" = 1 ]; then
  exit 0
fi
if [ -n "$match_other" ]; then
  refuse "$match_other"
fi

if [ -n "$id" ]; then
  # A task branch may commit only while its own row is held.
  # A tracked registry only: the land step's release commit touches nothing but the
  # registry and removes this task's row. Never a merge: its staged diff is everything
  # merged in, and a registry among it is not a release. A clean merge runs this hook as
  # pre-merge-commit before MERGE_HEAD exists, so also check the hook name and the
  # reflog action git sets ("merge <branch>", "pull ...").
  merging=0
  if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then merging=1; fi
  case "$(basename "$0")" in pre-merge-commit) merging=1 ;; esac
  case "${GIT_REFLOG_ACTION:-}" in merge*|pull*) merging=1 ;; esac
  staged=$(git diff --cached --name-only)
  if [ "$merging" = 0 ] && [ "$staged" = "$REGISTRY" ] && git diff --cached -- "$REGISTRY" | grep -E '^-[ \t]*\|' | grep -iqF "$id"; then
    exit 0
  fi
  refuse "branch '$branch' carries $id, which holds no row in $REGISTRY. Claim the lock first."
fi

# Not a task branch (the mainline, or anything else): refuse while a held row locks this checkout.
if [ "$lock_here" = 1 ]; then
  refuse "a run holds a row in $REGISTRY and '${branch:-detached HEAD}' is not its task branch."
fi

exit 0
