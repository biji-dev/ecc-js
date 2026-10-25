# Reference: the second model family

A reviewer from a **different model family** catches what same-family reviewers
share; two passes on one family are one correlated check. **Evidence:** the third
project ran Codex beside Claude for about 120 sessions behind one wrapper; its
blind second plans and adversarial passes found defects its Opus lanes had
cleared, and the wrapper exists because Codex's own exit code lied both ways.

**`[M]` mechanism · `[B]` binding**

## The rule

`[M]` **Whatever one model family writes, the other reviews.** Claude-written code
gets its decorrelated pass from Codex; Codex-written code (a cold slice, a doc
sweep) gets an Opus reviewer over its diff.

`[M]` **Never block a unit on the second family.** Quota, login or a missing binary
makes the pass `unavailable`: a fresh Claude agent takes the same prompt — Sonnet for
a per-slice review of cold code, Opus for critical code, the adversarial pass and
lane B — and the ledger says **degraded**, quoting the wrapper's reason. The owed
pass runs at the next unit's equivalent step over both diffs.

`[M]` **Use it where it finds the most.** In the cost study the second family found
43% of all valid P0/P1 — half of them in re-reviews — at no cost to the Claude quota,
yet sat at 5–28% of its own weekly quota while Opus reviewed every slice. Its quota
is real but finite: the wrapper's budget guard (below) keeps the essential kinds
running when it runs low.
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
| 8 review | the second family's review over the unit diff — **the** review of a Small unit, carrying the change surface | Small |
| 8 regression | the **adversarial pass** — "find flows that silently break against this diff, cite `file:line`", with the Impact Analysis as focus and **lane B's brief** (`blast-radius-auditor.md`: the change surface, every reader outside the diff, the siblings of each fixed bug); the frontier model too when the diff touches a never-auto category | Full |
| 8 fix rounds | the **first re-review** of a fix, over the fix diff (`review-gate.mjs --kind fix`); the adversarial pass from round 3 | Small, Full |
| 8 visual | optional **dual UI critique** — the second family and a fresh Opus critic, blind to each other, from the same screenshots and measurements | Full, UI diffs |
| 2 implement | **cold slices** may go to the second family (`implement-cold`, `docs`), reviewed by Opus | any |

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

## Without the wrapper

`[M]` Where the owner declines the template, the one-line form still needs its two
rules:

```
codex exec -s read-only -o .review-work/xmodel/verdict.md - < .review-work/xmodel/prompt.md
```

It counts as run only if the verdict file is non-empty and the log carries no
error or usage-limit line. Inline the rule text the reviewer needs.

## Other harnesses as the second family

`[M]` The rule is about families, not products. A project run from Codex gets its
decorrelated pass from Claude (`claude -p` read-only, or a Claude reviewer agent),
by the same table. `harness-targets.md` lists which agents the project uses.

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
