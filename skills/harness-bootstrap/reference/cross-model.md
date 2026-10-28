# Reference: the second model family

A reviewer from a **different model family** catches what same-family reviewers
share; two passes on one family are one correlated check. **Evidence:** the third
project ran Codex beside Claude for about 120 sessions behind one wrapper; its
blind second plans and adversarial passes found defects its Opus lanes had
cleared, and the wrapper exists because Codex's own exit code lied both ways.

**`[M]` mechanism · `[B]` binding**

## The rule

`[M]` **Whatever one model family writes, the other reviews.** Claude-written code
gets its decorrelated pass from Codex; Codex-written code (a cold slice, a fix, a
doc sweep) gets a Claude reviewer — Opus on critical code at once, and on cold code
the unit review covers it (a Sonnet `code-reviewer` for a Small unit or a cold fix),
as `review-gate.mjs --writer second` says. `--writer` is the role that wrote the
diff under review — the slice, the unit, or the fix: `main | bounded | second |
mixed` (on Claude Code also `claude | sonnet | codex`), each role's model per host
in `gate-design.md` › Model and effort.

`[M]` **Never block a unit on the second family.** Quota, login or a missing binary
makes the pass `unavailable`: a fresh Claude agent takes the same prompt — Sonnet for
a per-slice review of cold code, Opus for critical code, the adversarial pass and
lane B — and the ledger says **degraded**, quoting the wrapper's reason. The owed
pass runs at the next unit's equivalent step over both diffs.

`[M]` **Use it where it finds the most, then let it build.** In the cost study the
second family found 43% of all valid P0/P1 — half of them in re-reviews — at no cost
to the Claude quota, yet sat at 5–28% of its own weekly quota while Opus reviewed
every slice. **It is the first builder for cold work** — cold slices, fixes outside
critical code, tests for cold code, doc rewrites — while its budget guard allows;
Sonnet takes the same work when it is reserved, or when the task needs a browser, a
service it cannot reach, or steering mid-run. Its quota is real but finite: the
wrapper's budget guard (below) keeps the essential kinds running when it runs low.
> Origin, the v4 usage study: in 14 days the second family wrote code 7 times
> against 502 Opus implementer runs. A write run cost 0.5–2% of its weekly meter and
> took 4–9 minutes; reviews alone reached 72–78% in a busy week. At that plan it can
> carry about a fifth of the implementation — read the meter in the ledger, and
> treat more as the owner's plan decision.
> Origin: one change request in the third project waited on a five-day Codex
> outage.

`[M]` **Never stand in Opus while the second family is available.** Two Opus passes
are one check counted twice.

`[B]` Whether the project has a second family at all. Without one, every row below
is `degraded` by design — say so once in the harness file, not on every unit.

## Where it runs

| Step | Pass | Tier |
|---|---|---|
| 1 plan check | **blind dual plan** — the second family writes its own plan from the same brief while the session writes one; the session compares (agree · differ, with evidence · one side only) and merges | Full |
| 4 conform | lane A may run on the second family — it is a literal checklist | Small, Full |
| 2 per slice | the second family's **review** over each slice's diff (`review-gate.mjs --kind slice`) — in the background while the next independent slice starts | Full |
| 8 review | the second family's review over the unit diff — **the** review of a Small unit. It takes no brief, so lane B's change surface rides in an `adversarial` pass when the Impact Analysis lists a reader outside the diff (`blast-radius-auditor.md`) | Small |
| 8 regression | the **adversarial pass** — "find flows that silently break against this diff, cite `file:line`", with the Impact Analysis as focus and **lane B's brief** (`blast-radius-auditor.md`: the change surface, every reader outside the diff, the siblings of each fixed bug); the frontier model too when the diff touches a never-auto category | Full |
| 8 fix rounds | the **first re-review** of a fix, over the fix diff (`review-gate.mjs --kind fix`); the adversarial pass for a third round the owner orders | Small, Full |
| 8 visual | optional **dual UI critique** — the second family and a fresh Opus critic, blind to each other, from the same screenshots and measurements | Full, UI diffs |
| 2 implement, 8 fixes, 8a docs | **the first builder for cold work** — cold slices (`implement-cold`), fixes outside critical code (`fix-cold`), tests for cold code, doc rewrites (`docs`) — reviewed by Claude as `review-gate.mjs --writer second` says; hot code only on the owner's `executor: codex` override, then an Opus reviewer per slice | any |

`[M]` The **blind** in blind dual plan is the point: the second plan is written
without seeing the first. Every item only one side has is verified in code before
it is merged or dropped.

## The wrapper — `templates/scripts/codex-run.mjs`

`[M]` **Every Codex call goes through one script**, never `codex exec` directly. It
ships as three files that mirror a target's `scripts/` folder:
`templates/scripts/codex-run.mjs` (the wrapper),
`templates/scripts/lib/codex-run-core.mjs` (the pure core) and
`templates/scripts/lib/codex-run-core.test.mjs` (its `node --test` suite, which
runs unchanged once copied).

What it does that a bare call does not:

- **A route table** picks model, effort and sandbox per kind (`investigate`,
  `plan-blind`, `review`, `lane-a`, `adversarial`, `adversarial-frontier`,
  `implement-cold`, `fix-cold`, `docs`, `ui-review`, or `auto` through a cheap
  router), and a **clamp** bounds any override — the frontier model and the top
  effort need an explicit flag.
- **An honest exit:** 0 only for a non-empty verdict with no failure or error event; 1
  failed; 2 usage; 3 unavailable (quota, login, missing binary → take the Claude
  fallback); 4 reserved (the budget guard or the owner's switch → do it with
  Claude). It prints **one result line**, and that line is what the ledger quotes.
  > Origin: the CLI exited 0 on runs that produced no verdict (a usage limit, an
  > interrupted review) and non-zero on a retry it had recovered from.
- **An owner switch** — `CODEX_RUN=on|essential|off`. `essential` keeps only the
  decorrelated checks (`review`, `adversarial`, `adversarial-frontier`); a misspelt
  value is a usage error, never a silent `on`.
- **A weekly budget guard** — reads the CLI's own session rollouts and reserves
  non-essential kinds past a threshold (default 85%), so quota goes to the checks
  that matter.
- **`--rules-for <files>`** appends the area rule files that apply. Codex reads
  `AGENTS.md` but not path-scoped rule folders. A missing resolver is a usage
  error, never a silent skip.
- **A JSONL ledger** of every real run (`--dry-run` writes none), and a **leftovers** report after write kinds
  (`commits=`, `uncommitted=`) — look at them before a fallback starts.
- **The prompt goes on stdin.** A quoted-argument prompt hung.
- **A background run uses the host's own background option** (Claude Code: the
  Bash tool's `run_in_background`), never a shell `&` or a `( … ) &` subshell: one
  launched that way died with its shell before Codex started, and the command
  guard refuses it (`codex-background`). The wrapper writes its ledger row when
  the run ends, so when the host reports the command finished, the run counts only
  if its row exists. No row means the run did not finish, not that it did nothing:
  a write kind may have edited or committed first. Before a relaunch, check that it
  stopped, read its log and look at the worktree (`git status`, its new commits).

`[B]` Bindings, re-derived per machine and project:

- the `CATALOG` block at the top of the core — the models this machine's CLI
  offers, by role (`default`, `frontier`, `router`, `previous`);
- `LEDGER_DIR` and `RULES_FOR` in the wrapper;
- `CODEX_BIN` if the CLI is not on `PATH`;
- the route table's efforts only when the log has shown a reason.

**Install:** copy the three files to `scripts/` and `scripts/lib/`, set the bindings,
run `node --test scripts/lib/codex-run-core.test.mjs` once (it is hermetic: temporary
`HOME` and `CODEX_HOME`, and a stub `codex` first on `PATH`, so it never spends
quota), and add `.codex-runs/` to `.gitignore`. Install the agent-docs
lint too (`harness-targets.md`) or drop `RULES_FOR`.

## The sandbox — why, and how far to widen it

`[M]` **The wrapper picks the sandbox from the kind, and never offers full
access.** Review kinds run `read-only`, so a reviewer cannot edit what it judges;
`implement-cold`, `fix-cold` and `docs` run `workspace-write` inside the worktree;
network is off unless `--network`. Never `danger-full-access` or
`--dangerously-bypass-approvals-and-sandbox`: none of the Claude-side guards reach
Codex — the command guard and every Claude Code hook run only inside Claude Code,
and git hooks fall to `--no-verify` — so with the sandbox gone nothing stands
between Codex and the ssh keys, the agent socket, `git push` and the network.

`[M]` **What the sandbox costs, measured** (v4 usage study, 273 runs): no failed
run was caused by it; read-only reviews could not run tests (temp-dir `EPERM`) in
about six verdicts — the session runs the tests anyway, a review is a claim; one
write run could not commit (`index.lock`), and the leftovers report caught it.
`--add-dir` does **not** help a read-only kind: on codex-cli 0.163 a read-only run
still refused writes to the added directory.

`[M]` **Widen in this order, each step measured:**

1. **`--network` for a write kind whose tests need the local database** — only
   after a Codex rules file forbids what network would open. The rules are a
   backstop, not a boundary: they match an argv prefix, so `git -C . push` or
   `env git push` may slip past one — keep the list wide and the pre-push hook. `[B]` `~/.codex/rules/<project>.rules`:
   `prefix_rule(pattern=["ssh"], decision="forbidden")`, and the same for `scp`,
   `rsync`, `git push`, `git remote`, `curl`, `wget`, `gh`, `npm publish` (and the
   project's package manager's publish), `pkill`, `docker compose down`, the
   project's destructive scripts, and `git commit --no-verify`. Add a `pre-push` hook that refuses when the
   Codex sandbox's environment marker is set (check the variable on the installed
   CLI before relying on it).
2. **An allow rule for the exact commit form the brief prescribes**
   (`git commit -F <file>`), keeping the leftovers report.
3. Nothing beyond that. A task that needs a browser, a running service or steering
   goes to a Sonnet builder.

`[M]` **When Claude Code coordinates, briefs for Codex never ask it to call
Claude.** Its automatic approval reviewer refused two attempts to send a diff out to
`claude -p` — correctly; the cross-family review is the session's to dispatch. Under
a Codex host the session is Codex, and it calls Claude itself, through `claude-run`
(below).

## Without the wrapper

`[M]` Where the owner declines the template, the one-line form still needs its two
rules:

```
codex exec -s read-only -o .review-work/xmodel/verdict.md - < .review-work/xmodel/prompt.md
```

It counts as run only if the verdict file is non-empty and the log carries no
error or usage-limit line. Inline the rule text the reviewer needs.

## When the host is not Claude Code — `templates/scripts/claude-run.mjs`

`[M]` The rule is about families, not products. A session run from Codex gets its
decorrelated pass from Claude; one run from ZCode gets it from Codex, or from Claude
when Codex is out (`gate-design.md` › Model and effort). **Every Claude call from
such a host goes through `claude-run.mjs`**, the mirror of `codex-run`:
`templates/scripts/claude-run.mjs`, `lib/claude-run-core.mjs` and its `node --test`
suite, which stubs `claude` and spends nothing. It imports `lib/harness-host-core.mjs`.

- **Read-only kinds only:** `review` (the diff against `--base`, written beside the
  verdict for the reviewer to Read; `--prompt` adds a focus), `adversarial`
  (`--critical` → `xhigh`), `plan-blind`, `investigate` and `lane-a`. Writing is
  never a kind: the host builds, and Claude reviews.
- **One argv:** `claude -p --restricted --strict-mcp-config --tools Read,Grep,Glob
  --allowedTools Read,Grep,Glob --permission-mode dontAsk --model <m> --effort <e>
  --max-budget-usd <cap> --no-session-persistence --output-format json`, with the
  prompt on stdin. `--restricted` drops the command and web tools and every settings
  file, and keeps the file tools inside the working directory.
- **An honest exit**, read from the JSON result rather than the exit code: 0 a
  non-empty verdict; 1 failed (the budget cap reached, an error result, a timeout); 2
  usage, or the host is Claude Code, whose second family is Codex; 3 unavailable (no
  binary, not logged in, no network, a usage limit → the fallback, recorded
  `degraded`); 4 reserved by the owner's switch, `CLAUDE_RUN=on|essential|off`.
- **Never inside a sandbox with no network.** It needs the network and `~/.claude`,
  which Codex's `workspace-write` sandbox blocks, so it runs only outside the sandbox,
  on an approval. Codex's approval reviewer refused that twice for a diff (above):
  the owner approves the first run, or saves a rule for `node scripts/claude-run.mjs`
  — a machine setting, the owner's. Inside the sandbox it reads
  `CODEX_SANDBOX_NETWORK_DISABLED=1` and exits 3 at once.
  > Origin, measured on one machine: `claude -p` inside that sandbox ran 177 s, then
  > returned `is_error` with "API Error: Can't reach the API server — check your
  > internet or DNS (ENOTFOUND)", at $0.
- **A JSONL ledger** of every run but a dry run, with the dollars each one spent.

`[B]` Bindings: the `CATALOG` block (the `--model` aliases by role) and `BUDGET_USD`
($5 a run by default) at the top of the core, `LEDGER_DIR` in the wrapper, and
`CLAUDE_BIN` when the CLI is not on `PATH`. **Install:** the three files to
`scripts/` and `scripts/lib/` beside `harness-host`, `node --test
scripts/lib/claude-run-core.test.mjs` once, and `.claude-runs/` in `.gitignore`.

## Escalation — a hard problem

`[M]` A bug's cause, or a plan the check found wrong in both versions:

1. Opus (the session or a planning agent) or the second family's `investigate`, at
   effort `high`.
2. The answer was disproved, or the code is critical → both, blind to each other;
   that one re-asked call may run at `xhigh`.
3. Still open → the frontier rung (`[B]`: which model, if any), with a decision row
   naming why.

`[M]` Effort floor `high`; `xhigh` only at rung 2 or with the reason in the brief;
`max` only on the owner's word (`gate-design.md`).
