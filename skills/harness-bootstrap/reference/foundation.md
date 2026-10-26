# Reference: the foundation stage — a harness before the first test

A new repository often starts as documents only: a specification, a build plan, an
owner. Phase A row 1 fails — there is no test to see red — and the older answer was
to refuse with a readiness plan and install later. **Evidence:** one
specification-only repository, refused that way, landed its first three units within
eleven minutes of the refusal — the repository skeleton, a shared module every
later unit builds on (critical code), and a change touching a never-auto category —
with no lock, no never-auto gate, no independent review and
no log row. The policy, risk map and merge policy derived for it later needed no
code: every entry came from its documents.

The first units of a project are where its foundations are laid, and where an
unreviewed decision costs most. **The foundation stage installs everything that
does not need a pass signal, forbids every auto-merge, and makes the unit that
lands the first real test the one that completes the install.**

**`[M]` mechanism · `[B]` binding**

## When Phase A routes here

`[M]` All of these, each cited in the assessment:

- row 1 fails **because nothing is built yet** — no test command, or one that runs
  nothing — and the work to build is ahead, not behind;
- row 2 passes — an owner answers gates;
- row 3 passes from the plan or the owner's stated scope (a new repository has no
  history to read);
- there are documents Phase B can derive from — a specification, a plan, a risk
  register, a list of what needs the owner's approval. Without them Phase B has
  nothing to cite, and the owner is asked for the scope first.

`[M]` **Not here:** a repository with product code and no tests (its code is
already unguarded; the readiness plan adds tests first), a suite that exists but is
broken or skips everything (fix it — that is a readiness unit, not a new project),
and a repository whose only work is trivial. Those keep the readiness plan.

`[M]` **Offer both, default foundation.** The Phase A closing line names the choice:
*foundation stage now* (default) — the harness gates the readiness units — or
*readiness plan first* — the owner runs them as ordinary work and Phase A is rerun
after. Record the owner's answer on the line below the Phase B status line; Phase C
copies it into the decision log it creates.

## Phase B — unchanged

`[M]` Policy, risk map and merge policy from the documents, every risk-map entry
**`planned`** with the document it comes from (`policy-derivation.md`), behind the
`DRAFT` line. The merge policy states the foundation rule below in its first line.
Phase C refuses while the line says `DRAFT`, as always.

## Stage 1 — the foundation install

`[M]` The Phase C core table, with these differences:

| Component | Foundation stage |
|---|---|
| `scripts/run-gates.sh` | installed with the gates that exist now — the agent-docs lint and the harness's own template tests (counted, at their pinned counts) at least; lint, format and type check only once the project has them — and **no** counted gate over the project's tests; those wait for the flip |
| `scripts/check-agent-docs.mjs` CONFIG | `pathPrefixes` names only folders that exist; every planned path the harness file cites goes in `intentionallyAbsent` (an entry whose path later exists is harmless; the flip prunes them) |
| setup | no `package.json` yet: the commands block gives `git config core.hooksPath .githooks` as the clone step; the flip adds the `prepare` line and fits the project's lint and format |
| coverage map (gate table) | one row: **uncovered — every path** |
| tiers block | Trivial and Full only; Small is written in and marked *unlocked at the flip* |
| merge block | first line: *Foundation stage: every merge is the owner's* |
| `.agents/harness-manifest.json` | `"stage": "foundation"` and the pass-signal unit's id in `"flipAfter"` |

Everything else follows the core table as in any install — the registry and commit
guard, the command guard, the runner, the three auditors, the implementer, the rules
block, the harness docs — and the optional rows as the owner answers them. **This is not a
partial harness:** it is complete for what exists, and it can merge nothing on its
own.

## The foundation rules

`[M]` Written into the generated gates block while the stage is `foundation`:

1. **Every Code unit is Full** — no path is covered, and the coverage-map rule
   already makes every uncovered path Full. Say so in each claim line.
2. **No auto-merge.** Gate 2 is always the owner's, whatever the merge policy says
   for later.
3. **The readiness units are the first units.** Take them from the plan's own
   foundation stories — the skeleton, then the first story that can ship a test — in
   the plan's order. When no story says which, Phase B asks the owner to name the
   pass-signal unit, defaulting to the earliest story whose "Done when" can be a
   counted test. Gate 1 of the pass-signal unit approves its "Done when" as the
   row-1 test: *`<test command>` runs at least one test, counted, and was seen red
   once*. That command counts **the project's tests only**: a bare runner
   that also finds the harness's template tests (`scripts/lib/*.test.mjs`) reported
   over a hundred passes with no product test in the repository. Until the flip binds
   the gate, the pass-signal unit runs it by hand at verify and pastes the count and
   the red line into the ledger; the claim auditor reruns it.
4. **A unit that adds tests proves them.** The claim auditor re-counts them and runs
   the sabotage; a suite that runs nothing is a false claim, not a gap.
5. **Planned paths become real ones.** When a planned risk-map path first gets code,
   the re-derive trigger in the risk-map block fires (`policy-derivation.md`). The
   risk map is a reviewed block, so the re-derive is a harness unit between runs;
   the product unit that created the path records it as a follow-up, and the flip
   takes every one raised before it. When the plan calls its paths working names,
   the skeleton fixes them and the same re-derive renames the map.

## The flip — stage 2

`[M]` **The flip is its own harness unit**, claimed on a `harness/<slug>` branch
immediately after the pass-signal unit lands — harness changes land between runs,
never during one. It:

1. reruns Phase A row 1 and quotes the evidence: the command, its count, the
   sabotage that turned it red, the `cmp` that confirmed the restore;
2. binds the counted test gates in `run-gates.sh` (`gate_counted` through
   `run-counted.mjs` at today's count, so a skip or zero tests is a FAIL) over the
   project's tests only, and any gate that reads another gate's
   output runs that gate first; adds the `prepare` line and fits the lint and format
   (SKILL.md, *Fit the project's tooling*);
3. writes the coverage map's first covered rows and lists what is still uncovered;
4. unlocks Small in the tiers block and drops the foundation line from the merge
   block — the merge policy the owner reviewed applies from here;
5. sets the manifest's `"stage"` to `"full"`, rehashes the blocks it changed, and
   records the flip as a decision-log line;
6. goes to Gate 2 as the owner's merge. The flip edits two reviewed blocks — the
   merge block's foundation line and the risk map's planned entries — and the
   owner's merge is the review those edits need (`upgrade.md`).

`[M]` **One flip per install.** A later unit that adds tests for another path moves
that path to a covered row in its own commit — that is ordinary coverage-map upkeep,
not a flip.

`[M]` `harness-status.js` reports the stage, and raises
`foundation-stage-has-tests` when the manifest still says `foundation` and the
repository already has test files: the pass-signal unit landed and nobody ran the
flip.

## What not to do

- Never auto-merge in the foundation stage, and never let a merge policy's Small
  rule apply before the flip.
- Never run the flip inside the pass-signal unit; its diff is reviewed as product
  code, the flip as a harness change.
- Never seed a counted gate with a pattern before a test exists to match it — a
  gate that cannot pass is turned off by the first person it blocks.
- Never route a repository with untested product code here to skip writing its
  tests.
