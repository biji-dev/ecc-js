#!/bin/sh
# harness-bootstrap commit guard (generated YYYY-MM-DD). Refuses, never merely checks.
# [M] the logic below. [B] REGISTRY, ID_PATTERN, SCOPE and MAINLINE: re-derive them from this project.
# Install: .githooks/pre-commit (git config core.hooksPath .githooks), or call it
# from an existing husky/lefthook pre-commit. Install the same file as
# .githooks/pre-merge-commit too: a non-conflicting merge runs that hook, not
# pre-commit. Test THIS file, never a copy. A merge, by either hook, is refused while the
# branch it merges still holds a row: release the row first, then merge (the land order). The
# owning run's own row never refuses: it may pull its branch and merge one carrying its id.

REGISTRY=".claude/registry.md"             # [B] the lock file, relative to the repo root
# ID_PATTERN binds per mode. Plan mode: the plan's id shape (every shape it uses). Change
# mode: '' (branches carry no id; a unit matches a row by its Branch cell only), or the
# change id shape if the project has one. Matched against the UPPERCASED branch name, so
# a plan id P2-20 owns task/p2-20; keep the pattern uppercase (letters after the digits
# may be either case).
ID_PATTERN='[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[0-9]+[A-Za-z]?'  # [B] the task-id shape; '' = no id matching
SCOPE="repo"                               # [B] repo = one lock for the whole clone; checkout = one lock per checkout (worktree)
MAINLINE="main"                            # [B] the branch lands merge into
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

# The task id a branch name carries: the first ID_PATTERN match in the UPPERCASED name.
task_id() {
  if [ -n "$ID_PATTERN" ]; then
    printf '%s\n' "$1" | tr '[:lower:]' '[:upper:]' | grep -oE "$ID_PATTERN" | head -n 1
  fi
}

branch=$(git branch --show-current 2>/dev/null)
id=$(task_id "$branch")

# rows NAME ID: one line per held row, "<matched name>|<Worktree cell>|<Branch cell>|<row index>", the
# match taken against branch NAME and its task id ID. Rows inside the active section
# whose first cell is 1+ count as held; row 0 is reserved for the mainline. The header is the
# row directly above a |---| separator row; with none inside the section, the table header
# right above the begin marker (markers around data rows only). No header at all: every
# numbered row is data and no cell is the Worktree cell. A row matches when its Branch cell
# equals the branch name (no Branch column: any cell but Worktree does) or any cell but
# Worktree equals the branch's task id, ignoring case (the id is uppercased). A Worktree cell holds a path, never a match; a
# placeholder (-, n/a, none) is the same as empty.
rows() {
  awk -v b="$1" -v id="$2" '
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
      br = bc ? trim(c[bc]) : ""
      wt = ""
      if (w) {
        wt = c[w]; gsub(/`/, "", wt); gsub(/^[ \t]+/, "", wt)
        k = match(wt, /[ \t]/); if (k) wt = substr(wt, 1, k - 1)
        k = index(wt, "·"); if (k) wt = substr(wt, 1, k - 1)
        lw = tolower(wt)
        if (lw == "-" || lw == "—" || lw == "n/a" || lw == "none") wt = ""
      }
      print tok "|" wt "|" br "|" j
    }
  }' "$reg"
}
held=$(rows "$branch" "$id")

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
own=" "   # the row indexes of the rows this checkout owns: they match its branch and lock it
if [ -n "$held" ]; then
  while IFS='|' read -r tok wt br j; do
    if [ "$SCOPE" = "checkout" ]; then resolve "$wt"; else res=$curp; fi
    if is_here "$res"; then lock_here=1; fi
    if [ -n "$tok" ]; then
      if is_here "$res"; then match_here=1; own="$own$j "; else match_other="row for $tok locks $res, not this checkout"; fi
    fi
  done <<EOF
$held
EOF
fi

# Is this a merge? A clean merge runs this hook as pre-merge-commit before MERGE_HEAD exists,
# so also check the hook name and the reflog action git sets ("merge <name>...", "pull ...").
merging=0
mhf=$(git rev-parse --git-path MERGE_HEAD)
if [ -f "$mhf" ]; then merging=1; fi
case "$(basename "$0")" in pre-merge-commit) merging=1 ;; esac
case "${GIT_REFLOG_ACTION:-}" in merge*|pull*) merging=1 ;; esac

# A merge refuses while what it merges is still held, in either scope: under checkout a row
# locks only its own checkout, so nothing else stops the main checkout merging it. A merged
# name refuses when it matches a held row by name or task id; a merged commit refuses when it
# is a held row's Branch tip with work of its own. Names come from a clean merge's reflog
# action ("merge <name>...", as typed: refs/heads/x, refs/remotes/<remote>/x and <remote>/x
# read as x) and a pull's FETCH_HEAD lines for merge ("branch '<name>' of ..."); commits from
# those names, those lines, and MERGE_HEAD (one line per merged commit), which a conflicted
# merge leaves for the commit that concludes it, with no reflog action. A held tip already in
# MAINLINE (a branch claimed at its tip, no commits yet) is no held work; with no MAINLINE
# branch every held tip counts as work. The rows this checkout owns never refuse: the owning
# run pulls its own branch and merges branches that carry its task id.
tab=$(printf '\t')
branch_name() {
  case "$1" in
    refs/heads/*) printf '%s\n' "${1#refs/heads/}"; return ;;
    refs/remotes/*/*) printf '%s\n' "${1#refs/remotes/*/}"; return ;;
  esac
  for r in $(git remote 2>/dev/null); do
    case "$1" in "$r"/*) printf '%s\n' "${1#"$r"/}"; return ;; esac
  done
  printf '%s\n' "$1"
}
has_work() { ! git merge-base --is-ancestor "$1" "refs/heads/$MAINLINE" 2>/dev/null; }
is_own() { case "$own" in *" $1 "*) return 0 ;; esac; return 1; }
held_name() {
  m=$(branch_name "$1")
  hits=$(rows "$m" "$(task_id "$m")")
  while IFS='|' read -r tok wt br j; do
    if [ -n "$tok" ] && ! is_own "$j"; then
      refuse "merging '$m', which still holds a row in $REGISTRY. The land order: release its row first, then merge."
    fi
  done <<EOF
$hits
EOF
}
held_commit() {
  [ -n "$1" ] || return 0
  while IFS='|' read -r tok wt br j; do
    if [ -n "$br" ] && ! is_own "$j" && [ "$(git rev-parse -q --verify "refs/heads/$br" 2>/dev/null)" = "$1" ] && has_work "$1"; then
      refuse "merging '$br', which still holds a row in $REGISTRY. The land order: release its row first, then merge."
    fi
  done <<EOF
$held
EOF
}
if [ "$merging" = 1 ] && [ -n "$held" ]; then
  set -f
  case "${GIT_REFLOG_ACTION:-}" in
    merge\ *)
      for n in ${GIT_REFLOG_ACTION#merge }; do
        held_name "$n"
        held_commit "$(git rev-parse -q --verify "$n^{commit}" 2>/dev/null)"
      done
      ;;
    pull*)
      fhf=$(git rev-parse --git-path FETCH_HEAD)
      if [ -f "$fhf" ]; then
        while IFS= read -r line; do
          case "$line" in *"${tab}not-for-merge${tab}"*) continue ;; esac
          held_commit "${line%%"$tab"*}"
          case "$line" in
            *"branch '"*"' of "*) n=${line#*"branch '"}; n=${n%%"' of "*}; held_name "$n" ;;
          esac
        done <"$fhf"
      fi
      ;;
  esac
  set +f
  if [ -f "$mhf" ]; then
    while IFS= read -r c; do held_commit "$c"; done <"$mhf"
  fi
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
  # merged in, and a registry among it is not a release ($merging, above).
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
