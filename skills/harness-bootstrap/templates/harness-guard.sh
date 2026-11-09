#!/bin/sh
# harness-bootstrap commit guard (generated YYYY-MM-DD). Refuses, never merely checks.
# [M] the logic below. [B] REGISTRY, ID_PATTERN, SCOPE and MAINLINE: re-derive them from this project.
# Install: .githooks/pre-commit (git config core.hooksPath .githooks), or call it
# from an existing husky/lefthook pre-commit. Install the same file as
# .githooks/pre-merge-commit too: a non-conflicting merge runs that hook, not
# pre-commit. Test THIS file, never a copy. A merge, by either hook, is refused while the
# branch it merges still holds a row: release the row first, then merge (the land order). The
# owning run's own row never refuses: it may pull its branch and merge one carrying its id.
# Every commit and merge onto MAINLINE must also pass the landing check: the tree being committed
# goes to the mainline's committed scripts/review-gate.mjs --landing, never a branch's copy, and
# each critical path in it must be content a cross-family review read. It reads the result, not
# branch names, so an auto-merge, a resolution or a squash is checked too; no node refuses.
# Install the same file as .githooks/reference-transaction too (husky: .husky/reference-transaction
# running it with "$@"): then every move of the MAINLINE ref, a fast-forward, reset, update-ref,
# branch -f, fetch into it, pull or rebase, passes the same landing check before the ref moves.

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

# every git read here and in the landing check sees the objects that land, not a replacement or a graft
GIT_NO_REPLACE_OBJECTS=1
GIT_GRAFT_FILE=/dev/null
export GIT_NO_REPLACE_OBJECTS GIT_GRAFT_FILE

refuse() {
  echo "$LABEL: REFUSE - $1" >&2
  exit 1
}

# The registry lives in the main checkout, so every linked worktree of this clone
# reads the same lock. Keep it untracked (gitignored): claim and release are edits.
# Sets top, root, curp and reg; fails outside a working tree.
find_registry() {
  top=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
  common=$(cd "$top" && cd "$(git rev-parse --git-common-dir)" && pwd) || return 1
  case "$common" in
    */.git) root=${common%/.git} ;;
    *) root=$top ;;
  esac
  root=$(cd "$root" && pwd -P) || return 1
  curp=$(cd "$top" && pwd -P) || return 1
  reg="$root/$REGISTRY"
}

# The landing check: landing_check RESULT BASE WHAT [TIP...]. RESULT (a rev that peels to a tree)
# goes to `review-gate.mjs --landing` with BASE, the mainline commit before it, as the base. The
# copy that runs is BASE's, extracted from git into a temporary directory, never a working tree's:
# during a merge the working tree holds the branch's copy, which could rebind what counts as
# critical, and a ref can move while another branch is checked out. Each remote MAINLINE tip, and
# each TIP the caller passes, is --trust (content the remote already holds; a remote-tracking ref
# moved by hand is trusted too). Node runs with every NODE_* variable unset, so NODE_OPTIONS can load
# no code before the gate, and it passes only on exit 0 with a `Landing: ... PASS — ` first line.
# No node refuses: a check that skips itself is no check. WHAT names the refusal: merge or move.
land_dir=""
land_clean() {
  if [ -n "$land_dir" ]; then rm -rf "$land_dir"; fi
  land_dir=""
}
land_refuse() {
  land_clean
  refuse "$1 Ask the owner to merge this."
}
landing_check() {
  land_result=$1
  land_base=$2
  land_what=$3
  shift 3
  command -v node >/dev/null 2>&1 \
    || refuse "the landing check needs node, which is not on PATH. Ask the owner to merge this."
  land_dir=$(mktemp -d 2>/dev/null) || land_refuse "the landing check could not make a temporary directory."
  trap 'land_clean' 0
  trap 'land_clean; exit 1' HUP INT TERM
  if ! git archive --format=tar "$land_base" scripts/review-gate.mjs scripts/lib 2>"$land_dir/err" | tar -xf - -C "$land_dir" 2>/dev/null \
    || [ ! -f "$land_dir/scripts/review-gate.mjs" ]; then
    land_refuse "the landing check could not extract the mainline's committed scripts/review-gate.mjs: $(sed -n '1p' "$land_dir/err")."
  fi
  git for-each-ref --format='%(objectname)' "refs/remotes/*/$MAINLINE" >"$land_dir/tips" 2>/dev/null || :
  for c in "$@"; do printf '%s\n' "$c" >>"$land_dir/tips"; done
  # the CLI's words, built in the positional parameters: no word splitting, whatever a value holds
  set -- --landing "$land_result" --base "$land_base"
  land_tips=" "
  while IFS= read -r c; do
    case "$c" in ''|*[!0-9a-f]*) continue ;; esac
    case "$c" in *[!0]*) ;; *) continue ;; esac
    case "$land_tips" in *" $c "*) continue ;; esac
    land_tips="$land_tips$c "
    set -- "$@" --trust "$c"
  done <"$land_dir/tips"
  land_out=$(
    for v in $(env | sed -n 's/^\(NODE_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done
    cd "$top" && node "$land_dir/scripts/review-gate.mjs" "$@" 2>"$land_dir/err"
  )
  land_rc=$?
  land_msg=$(printf '%s\n' "$land_out" | sed -n '1p')
  land_pass=0
  if [ "$land_rc" = 0 ]; then
    case "$land_msg" in "Landing: "*" PASS — "*) land_pass=1 ;; esac
  fi
  if [ -z "$land_msg" ]; then land_msg=$(sed -n '1p' "$land_dir/err"); fi
  land_clean
  trap - 0 HUP INT TERM
  [ "$land_pass" = 1 ] && return 0
  [ -n "$land_msg" ] || land_msg="review-gate.mjs --landing printed no PASS line"
  if [ "$land_what" = move ]; then
    refuse "the landing check refused this move of $MAINLINE: $land_msg. $MAINLINE did not move; a fast-forward, reset or pull leaves the refused files in the working tree (git status shows them). Re-review the delta it names on the branch, or ask the owner to merge it."
  fi
  refuse "the landing check refused this merge: $land_msg. Re-review the delta it names on the branch, or ask the owner to merge it."
}

# As git's reference-transaction hook (the first argument is its state): a move of MAINLINE must
# pass the landing check. git runs this hook on every ref update of every command, so any other
# state, and a transaction that holds no MAINLINE line, ends here with no git or node process. In
# `prepared` a refusal aborts the update and the ref keeps its value, which still reads as the old
# one; the stdin <old> is zeros for update-ref without an old value, so it is not used. Only reads
# here: the command may hold the ref lock. A deletion, no move, a rewind to content MAINLINE held,
# the owner's HARNESS_LANDING=owner, no registry and a bare repository with no working tree pass.
# The base is MAINLINE now, else (MAINLINE being created) the first remote MAINLINE tip; with
# neither, or no committed review gate at the base, it passes, as the commit path does. A remote
# MAINLINE line in the same transaction (`git fetch origin main:main` moves both) is trusted too. A
# move made from inside .git, or with --git-dir or GIT_DIR from another directory, is refused: there
# the check cannot find the working tree it reads (a bare repository with no working tree passes),
# and only an absolute core.hooksPath, which the install sets, makes git run this hook there at all.
case "${1:-}" in
  preparing|committed|aborted)
    while IFS= read -r _; do :; done
    exit 0
    ;;
  prepared)
    rt_new=""
    rt_seen=0
    set --
    while read -r _ rt_n rt_ref; do
      case "$rt_ref" in
        "refs/heads/$MAINLINE") rt_new=$rt_n; rt_seen=1 ;;
        refs/remotes/*/"$MAINLINE") case "$rt_n" in *[!0]*) set -- "$@" "$rt_n" ;; esac ;;
      esac
    done
    [ "$rt_seen" = 1 ] || exit 0
    [ "${HARNESS_LANDING:-}" != owner ] || exit 0
    rt_outside="the landing check refused this move of $MAINLINE: git ran outside the working tree (inside .git, or with --git-dir or GIT_DIR from another directory), where the check cannot read it. $MAINLINE did not move. Run git from the working tree."
    if ! find_registry; then
      # only a bare repository with no working tree passes, decided by the repository's own files,
      # never by --is-bare-repository, which -c core.bare=true flips
      rt_cd=$(git rev-parse --git-common-dir 2>/dev/null) || rt_cd=""
      rt_common=""
      if [ -n "$rt_cd" ]; then rt_common=$(cd "$rt_cd" 2>/dev/null && pwd -P); fi
      case "$rt_common" in ''|*/.git) refuse "$rt_outside" ;; esac
      [ "$(git config --file "$rt_common/config" --bool --get core.bare 2>/dev/null)" = true ] || refuse "$rt_outside"
      [ ! -e "$rt_common/index" ] || refuse "$rt_outside"
      for rt_w in "$rt_common"/worktrees/* "$rt_common"/worktrees/.[!.]* "$rt_common"/worktrees/..?*; do
        if [ -e "$rt_w" ] || [ -L "$rt_w" ]; then refuse "$rt_outside"; fi
      done
      exit 0
    fi
    rt_gd=$(git rev-parse --absolute-git-dir 2>/dev/null) || refuse "$rt_outside"
    rt_top_gd=$(
      unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY
      cd "$top" && git rev-parse --absolute-git-dir 2>/dev/null
    ) || refuse "$rt_outside"
    [ -n "$rt_gd" ] && [ "$rt_gd" = "$rt_top_gd" ] || refuse "$rt_outside"
    [ -f "$reg" ] || exit 0
    case "$rt_new" in *[!0]*) ;; *) exit 0 ;; esac
    rt_cur=$(git rev-parse -q --verify "refs/heads/$MAINLINE" 2>/dev/null)
    [ "$rt_new" != "$rt_cur" ] || exit 0
    if [ -n "$rt_cur" ] && git merge-base --is-ancestor "$rt_new" "$rt_cur" 2>/dev/null; then exit 0; fi
    rt_base=$rt_cur
    if [ -z "$rt_base" ]; then
      rt_base=$(git for-each-ref --count=1 --format='%(objectname)' "refs/remotes/*/$MAINLINE" 2>/dev/null)
    fi
    [ -n "$rt_base" ] || exit 0
    git cat-file -e "$rt_base:scripts/review-gate.mjs" 2>/dev/null || exit 0
    landing_check "$rt_new^{tree}" "$rt_base" move "$@"
    exit 0
    ;;
esac

case "$SCOPE" in
  repo|checkout) ;;
  *) refuse "invalid SCOPE '$SCOPE' (use repo or checkout)" ;;
esac

find_registry || exit 1

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

# The landing check, on every commit and merge onto MAINLINE (pre-commit, a squash's commit and
# the commit that concludes a conflict included, and pre-merge-commit): the tree being committed,
# `git write-tree` of the index git hands the hook, against HEAD. It reads no names: a check by
# merged branch name skipped SHA, tag, remote, pull and squash merges and a spoofed
# GIT_REFLOG_ACTION, and never saw what an auto-merge or a conflict resolution wrote. It refuses
# before git writes anything, so `git merge --abort` still works; the reference-transaction hook
# checks the same commit again as a move of MAINLINE. It runs once the mainline has a committed
# review gate. HARNESS_LANDING=owner, the owner's merge, skips it.
if [ "$branch" = "$MAINLINE" ] && [ "${HARNESS_LANDING:-}" != owner ] \
  && git rev-parse -q --verify 'HEAD^{commit}' >/dev/null 2>&1 \
  && git cat-file -e 'HEAD:scripts/review-gate.mjs' 2>/dev/null; then
  land_head=$(git rev-parse -q --verify 'HEAD^{commit}')
  land_tree=$(git write-tree 2>&1) \
    || refuse "the landing check could not write the tree being committed: $(printf '%s\n' "$land_tree" | sed -n '1p'). Ask the owner to merge this."
  landing_check "$land_tree" "$land_head" merge
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
