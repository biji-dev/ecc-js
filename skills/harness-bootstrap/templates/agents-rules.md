<!-- harness-bootstrap rules block (generated YYYY-MM-DD).
[M] mechanism: copy the block between the markers into the harness file as-is. Every bold rule
is harness-bootstrap's reference/rules.md §1 verbatim; every why clause is condensed from that
rule's recorded origin. Never compose a why clause: a paraphrase that drifts from the incident
reads as invented.
[B] binding: the rule-origins path in the first paragraph, and the project's names in the
parenthesised pointers (the runner, the claim auditor, the guard, the context section). A rule
the project already states in its own words stays in its words: keep the bold rule, and in place
of its why clause write `Stated in the project's words: <path> › <heading>`. No section is left
a bare heading.
Delete this comment after copying. -->
<!-- harness:begin rules -->
## Rules

Each rule was produced by a failure in another project; the incident behind each is in
`docs/harness/rule-origins.md`.

### Proving things

- **Break the code and watch the suite stay green.** A control never seen failing is an assertion: a guard once sat inside the skip it was built to detect.
- **A control that goes red is not automatically a control that works.** Ask what made it red; a probe once failed for a reason that never asked its question.
- **A validation command that can report green having run nothing is not a validation command.** A test script reported green while skipping all eleven live cases.
- **No validation line may pass by cache, skip or missing binary.** A build passed from a warm cache while the source no longer compiled.
- **Never pipe a check through `tail`, `head` or `tee` inside an `&&` chain.** The pipeline's status is its last command's: `typecheck | tail` swallowed a failure twice.
- **Ratchet the declaration a check reads, not only the check.** One word removed from a data list silenced an invariant check with every gate green.
- **A guard's acceptance criterion must point at the real schema or code the spec names** — a guard matched `_amount` suffixes while the spec named the column `amount`.
- **Mutation runs — the rules that cost a fix round each:**
  - **Commit first, then restore each mutant from a `cp` snapshot and confirm with `cmp`.** A `git checkout --` restore discarded a fix round's uncommitted edits.
  - **Confirm the mutant applied** before reading it as a survivor.
  - **A mutant that removes a guard removes what the guard prevented, too.** Point the run at something disposable.
  - **Mutate operands, anchors and call arguments, not only branches.** One pass over call arguments found 18 survivors the branch mutants missed.
  - **A kill belongs to the tree it was measured on.** Re-run the standing mutants after a change that reads the guarded value.
- **Nothing merely asserted survives.** Docstrings, reports, test titles and column names assert; none verify — five false ones in a single task.
- **The record is written last, from the diff — its fields generated, its prose audited at Full by someone who did not write it.** Nine of the first twenty-one tasks shipped a false claim after the author-facing rule existed.
- **A "done" report ends with the step ledger; a step missing from it did not run.** A fresh cross-check contradicted 81 of 88 "done" reports.
- **Reproduce a finding before fixing it.** About 6% of claimed gaps were artefacts; one that does not reproduce is retracted.
- **Trust a wrapper's exit code, never the agent CLI's own.** The CLI exited 0 on runs with no verdict and non-zero on a recovered retry.
- **Verify a command, agent or skill resolves before naming it.** One routing table named eleven agents; ten did not exist.
- **A fix commit is new code** — review-fix commits were where review rounds introduced new defects, money defects included.

### Gates

- **Guard every commit — refuse, do not merely check.** A git hook, not a habit: three times a concurrent session committed onto a running unit's branch.
- **Gate 2 is not asked while a review is still running.** An approval against an incomplete picture is not an approval.
- **An unanswered Gate 2 question means park and carry, never consent.** Silence was read as approval three times.
- **An override covers the findings on the table when it was given; new findings re-arm the stop.** One override over six findings preceded twelve it never saw.
- **A re-tier into a never-auto category invalidates the reviews already run.** A unit added an authorization layer mid-run and merged reviewed at the lower tier.
- **A conformance verdict is not evidence of correctness.** Conformance returned CLEAN on code with a CRITICAL nine tasks running.
- **An implementer may always raise a gate, never lower one.**
- **Ask the owner only what only the owner can decide.** Of 373 owner questions in 14 days, 81% were process or technical; the owner took the recommendation 89% of the time.
- **Taste is not a risk tier.** Copy, naming and visual identity are the owner's call however clean every check is.

### Sizing and measurement

- **Re-tier at both gates, not only at grounding.** Scope grows during review rounds, which grounding cannot see.
- **Measure elapsed from the lock claim, not the first commit**, with `git log --format=%cI`, and record owner-wait separately.
- **The log append must be idempotent.** A resumed run reaches that step twice; duplicate rows doubled one unit's weight in every median.

### Cost

- **P3s never start a fix round.** In one milestone 20 of 50 fix rounds were opened by P3s alone, each re-reviewed by Opus.
- **A re-review reads the fix diff, by the reviewer whose finding was fixed** — one round 2 re-ran four reviewers over the full scope.
- **Never leave a session or a dispatch at `max` effort.** Every subagent inherited it and the same reviewers cost 5–8× their `high` runs.
- **One turn, many tool calls.** 96% of agent turns made one tool call, each re-reading the whole context.
- **Split a milestone that will not fit one session.** 50 slices in one session meant 20 compactions and a 493 KB state file.
- **Never re-run a gate on a tree it already passed.** 33 full-suite runs repeated on an unchanged tree in 14 days.
- **At an owner gate past 150K, the cards go out as text and the turn ends.** An open question is never idle-compacted; waits of over an hour rewrote whole contexts for 9.6% of main-thread spend.
- **Wait on a completion notice, never a sleep loop; shrink a screenshot before reading it.** Each poll re-read about 200K of context.

### Sessions and the working tree

- **Hold edits until every reviewer has reported**, and never stage with `git add -A`: reviewer probe files were swept into commits six times.
- **Every review dispatch gets its own scratch directory, inside the tree and gitignored** — four reviewers once overwrote each other's files.
- **Every subagent brief forbids host-level operations by default** — no image pulls, daemon commands, global installs, shared-service restarts or repository-wide suite runs.
- **Chain an edit script to its commit with `&&`** — a half-applied script was committed under a message describing the whole change.
- **A check whose result a commit message asserts is a precondition of the commit, not something remembered.** Lint failed, and the next commit said "eslint clean".
- **Harness changes land between runs, never during one.**
- **Never ask the owner for a new session or a hand-off.** 28 of 118 sessions ended in one, most triggered by a budget rule; offer `/compact`, or `/clear` and the resume command at a gate wait.
- **Search, then read once; one slice per agent.** Two whole-plan reads ended a session after one step, and about 4,500 small `sed -n` reads each re-read the whole context.
- **Run the full verification once per unit, not once per slice.** One change request ran the full suite 39 times: 8.4 hours.
- **Stop processes by the PID you recorded, never by name** — a kill by pattern reaches every session's processes on the machine.

### Documents

- **One canonical owner per fact.** Two files carrying the same rule drift, and then neither is trustworthy.
- **A decision's reasoning may outrun the decision — check whether it was applied consistently.** A hash's own decision argued for covering a field the hash then left out.
- **Fix a fact in every document that repeats it.** Five round-one fixes were never copied to a sibling document.
<!-- harness:end rules -->
