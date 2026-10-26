# Rules, and what produced each one

Every rule in §1 was written **after** a specific failure — in the origin project
(a regulated rental platform, 21+ logged tasks), in a second project that adopted
the harness later (a multi-tenant agent platform, 10 logged tasks), or in a third
that grew the change-mode workflow independently (a production multi-tenant
platform, about 120 sessions, with measured engineering notes) — or, under
**Cost**, in a 14-day cost study across those installs (1,094 review runs, 2,961
ledger findings, every transcript priced). None was reasoned into existence. That is the whole filter: §3 records rules that
*were* reasoned into existence, and they turned out wrong.

When generating a harness, **ship §1 with its origin named.** A rule without its
incident reads as pedantry and gets deleted by the first team that has not lived
it — usually just before they live it.

---

## 1 · Ship these

### Proving things

**Break the code and watch the suite stay green.** A control you have not watched
fail is an assertion. Writing one is not enough.
> Origin: the *"asserts the live suite actually ran"* guard sat **inside** the
> `describe.skip` it existed to detect, so both control suites reported
> `0 pass, N skip, exit 0` — the guard reintroduced the failure it was built for.

**A control that goes red is not automatically a control that works.** Ask what
made it red.
> Origin: dropping a row-security policy reddened the probes — but because a
> forced table with no policy permits nothing, the write failed and the probe
> never asked its question. The policy that actually tested it was a permissive
> one.

**A validation command that can report green having run nothing is not a
validation command.** Assert the expected case count, or make a skip fail.
> Origin: the test script reported green while silently skipping all eleven live
> cases.

**No validation line may pass by cache, skip or missing binary.** Bypass build
caches, make a missing database fail rather than skip, and spell each command as
it actually runs from the repository root.
> Origin: a build "passed" from a warm cache while the source no longer compiled.

**Never pipe a check through `tail`, `head` or `tee` inside an `&&` chain.** A
pipeline's status is its last command's.
> Origin, twice: `typecheck | tail` swallowed a failing typecheck and the chain
> carried on.

**Ratchet the declaration a check reads, not only the check.** If a check is built
from a list, removing an entry from that list must turn something red. Enumerate
the real catalogue; never a hand-written list beside it.
> Origin: one word removed from a data list silenced an invariant check with
> every gate green.

**A guard's acceptance criterion must point at the real schema or code the spec
names** — never a fixture written alongside the guard.
> Origin: a guard matched `_amount` suffixes while the spec named the columns bare
> `amount`. Built, conformant, guarding nothing.

**Mutation runs — the rules that cost a fix round each:**
- **Commit first, then restore each mutant from a `cp` snapshot and confirm with
  `cmp`.** Never `git checkout -- <file>`.
  > Origin: a mutation runner restored with `git checkout --` and silently
  > discarded a fix round's uncommitted edits.
- **Confirm the mutant applied** before reading it as a survivor, and probe one
  before calling it equivalent.
- **A mutant that removes a guard removes what the guard prevented, too.** Point
  the run at something disposable and check what it left behind.
  > Origin: a mutated provisioning guard let its test create a stray tenant in the
  > shared local database.
- **Mutate operands, anchors and call arguments, not only branches.**
  > Origin: one pass over call arguments found 18 survivors the branch mutants
  > had missed.
- **A kill belongs to the tree it was measured on.** After a change that adds a
  read of the guarded value, re-run every standing mutant.

**Nothing merely asserted survives.** Docstrings, reports, test titles and column
names all assert; none verify.
> Origin, five occurrences in one task: four docstrings asserted vendor
> properties that did not hold, three test titles claimed more than their bodies
> checked, and a column named `hashed_token` held a plaintext value.

**The record is written last, from the diff — its fields generated, its prose
audited by someone who did not write it.** (`runner.md` 8b/8c, `claim-auditor.md`.)
> Origin: *"a report is a claim — verify it before presenting it"* was a rule
> addressed to the author. After it was written, one task shipped **eight** false
> claims, and **nine of the first twenty-one** tasks shipped at least one. None
> was caught by the author re-reading; every one by an external check. An author
> checks a sentence against what they meant, not against the tree. So it became
> a step and an agent instead of a paragraph. Origin, the cost study: 79 of the
> claim auditor's 105 P1s were about record prose, so the fields a script can
> produce (`unit-record.mjs`) are generated, true by construction, and the audit
> reads only what a person wrote.

**A "done" report ends with the step ledger; a step missing from it did not run.**
(`context.md`.)
> Origin, the third project: across 88 audited "done" reports a fresh cross-check
> found something in 87 and contradicted the report in 81. Most had skipped
> verification steps without saying so.

**Reproduce a finding before fixing it.** One that does not reproduce is
*retracted*, never "fixed".
> Origin, the third project: about 6% of claimed gaps were artefacts — a scaled
> measurement, harness timing, another worktree's test run, a search over keys
> built from templates.

**Trust a wrapper's exit code, never the agent CLI's own.**
> Origin, the third project: the second-family CLI exited 0 on runs that produced
> no verdict (a usage limit, an interrupted review) and non-zero on a retry it had
> recovered from. One wrapper now decides, from the verdict file and the log
> (`cross-model.md`).

**Verify a command, agent or skill resolves before naming it.** A step naming a
missing tool never runs, and nobody notices.
> Origin: one project's first routing table named eleven agents and ten did not
> exist.

**A fix commit is new code** — it gets reviewed like any other diff, and on
critical code every fix round is reviewed (`gate-design.md`).
> Origin, the third project: review-fix commits were where review rounds
> introduced new defects, including money defects caught only by a later round.

### Gates

**Guard every commit — refuse, do not merely check.** Printing a branch name is
not a guard; the command must exit non-zero, and it must be a **git hook**, not a
snippet an agent is asked to run (`commit-guard.md`).
> Origin, three occurrences: a concurrent session committed onto a running task's
> branch; the third time `git add -A` swept 588 lines of another session's
> in-flight work into an unrelated commit. A branch check alone is insufficient —
> the failure is a *second session starting during a run*, which cannot know what
> branch the first expects but **can** read a lock held for the whole run. Both
> adopting projects first shipped the guard as a snippet in the harness file; a
> snippet only runs in the session that remembers it.

**Gate 2 is not asked while a review is still running.** An approval given
against an incomplete picture is not an approval.
> Origin: approved with *"good, finish it then merge"* while a second security
> pass was in flight. Two more rounds followed. It held because an agent chose the
> careful reading — not because the gate did.

**An unanswered Gate 2 question means park and carry, never consent.**
> Origin, three occurrences: silence after a Gate 2 brief was read as approval.

**An override covers the findings on the table when it was given; new findings
re-arm the stop.** State in one line what an override covers.
> Origin: an owner overrode a stop over six HIGH findings — *"finish it, fix your
> findings, then merge"*. Five more review rounds followed, surfacing a re-tier
> and twelve findings the override never saw.

**A re-tier into a never-auto category invalidates the reviews already run.**
Re-tier at a gate, not in flight, and re-review at the new tier.
> Origin: a task tiered as a lower category added an authorization layer
> mid-task and merged carrying the highest-risk category, reviewed throughout at
> the lower tier.

**A conformance verdict is not evidence of correctness.** It checks that the plan
was implemented, never that the implementation works.
> Origin: conformance returned CLEAN on code containing a CRITICAL for **nine
> consecutive tasks**. Auto-approval must require a clean *reviewer* result too.

**An implementer may always raise a gate, never lower one.**

**Ask the owner only what only the owner can decide.** Product and confirmation
decisions go to the owner as a decision card — recommendation, why, options with
pros, cons, reversal cost and data; a recoverable, product-neutral technical
decision is the session's, logged and listed at Gate 2 as *Decided for you*; a
process question a rule answers is never asked (`gate-design.md` › Who decides).
> Origin, the v4 usage study (three projects, 14 days): of 373 owner questions 51%
> were process and 30% technical; the owner took the recommended option 89% of the
> time, overrode 2 defaults in total, and answered a 124-item round — about 75 of
> them technical — with "use your recommendation". 121 hours went to waiting.

**Taste is not a risk tier.** A table keyed on size, blast radius and
dependencies cannot catch a deliverable that is correct by every check and still
the owner's call — visual identity, product copy, naming.
> Origin: a task raised its own gate for exactly this reason, by judgment. The
> rule exists so it is not judgment next time.

### Sizing and measurement

**Re-tier at both gates, not only at grounding.** Scope grows during review
rounds, which grounding cannot see.
> Origin: one task entered `S`, became `M` at gate 1, and was `L` by the end. In
> the second project three rows say "not re-tiered" — write it into the gate
> brief, not just the rules.

**Measure elapsed from the lock claim, not the first commit**, read timestamps
with `git log --format=%cI` rather than `date`, and record owner-wait and
machine-down time separately.
> Origin: one task spent an hour grounding before its first commit; another
> recorded 7h32m against a 60-minute session clock. An elapsed tripwire later
> fired while the run was only waiting on the owner.

**The log append must be idempotent.** A resumed run reaches that step twice.
> Origin: byte-identical rows, doubling one task's weight in every median.

### Cost

**P3s never start a fix round.** They wait for one batched sweep per slice set,
with no re-review; a P3 on a line the round already changes rides along.
> Origin, the cost study: in one 50-slice milestone, 20 of the 50 fix rounds were
> opened by P3 findings alone, each followed by an Opus re-review — about four hours
> of serial wall time and a tenth of the milestone's spend.

**A re-review reads the fix diff, by the reviewer whose finding was fixed** — the
second family first; Opus again only on critical code with a P1 fixed, at most two
Opus rounds (`gate-design.md`, `review-gate.mjs`).
> Origin, the cost study: 50 of 174 review spawns in 30 hours were re-reviews, and
> one round 2 re-ran all four reviewers over the full scope. Re-reviews still found
> real defects — 42 of 200 valid P0/P1 were introduced by fix rounds — so the rule
> scopes them; it does not skip them.

**Never leave a session or a dispatch at `max` effort.** Raise effort for one hard
question, then lower it; every generated agent pins `effort: high`.
> Origin, the cost study: a session set to `max` passed it to every subagent. The
> same reviewers cost 5–8× their `high` runs, the session compacted 22 times in 10.6
> hours, and no finding showed what the extra effort bought.

**One turn, many tool calls.** Independent reads, searches and checks go out
together in one message; several patterns go in one search (`rg -e a -e b`).
> Origin, the cost study: 96% of implementer and reviewer turns made a single tool
> call, and every turn re-reads the whole context — about 100K tokens in a subagent.

**Split a milestone that will not fit one session.** At Gate 1 a slicing table past
the cap becomes deliverables the owner can see, each with its own `Demo:` line, its
own step 8, its own Gate 2 and its own `/clear` boundary — one deliverable per
coordinator context.
> Origin, the cost study: one milestone of 59.6k lines and 50 slices ran in one main
> session — 20 compactions, a 211K average context, and a state file that grew to
> 493 KB.

**Never re-run a gate on a tree it already passed.** `run-gates.sh` reuses an
all-PASS result for the same tree, or for one that differs only in docs, and a
second run of the same gates waits for the first.
> Origin, the v4 usage study: 33 full-suite runs repeated on an unchanged tree —
> retries, two agents a minute apart, verify → docs commit → verify — and one
> project's tests step came after its FULL verify, so a second FULL was nearly
> always owed. No run repeated after a merge whose tree equalled the verified tip;
> the merges were never the waste.

**At an owner gate past 150K, the cards go out as text and the turn ends.** The
open cards go to the state file as `Q-n` rows first; under 150K the question tool
stays (`gate-design.md` › Who decides).
> Origin, the v5 context study: 183 requests after a gap of more than an hour
> rewrote their whole context, 9.6% of main-thread spend. Idle compaction runs only
> after an ended turn — 0 of 44 came while a question was pending.

**Wait on a completion notice, never a sleep loop; shrink a screenshot before
reading it.**
> Origin, the cost study: one release session ran 41 sleep-or-poll commands while a
> build ran and read 18 full-resolution device screenshots; each poll re-read about
> 200K of context.

### Sessions and the working tree

**Hold edits until every reviewer has reported**, and never stage with
`git add -A` — name the paths.
> Origin, six occurrences: reviewer probe files were swept into commits.

**Every review dispatch gets its own scratch directory, inside the tree and
gitignored** (`.review-work/<dispatch>/`), named in its brief.
> Origin: four reviewers dispatched together overwrote each other's files in one
> shared directory; in another run the system temp directory was wiped mid-task.

**Every subagent brief forbids host-level operations by default** — no image
pulls, no daemon or volume commands, no global installs, no restarting shared
services, no repository-wide suite runs. These act on the whole machine rather
than on the task.

**Chain an edit script to its commit with `&&`** — and check what the chain
contains. `git merge` does not read a message from stdin; write it to a file.
> Origin, twice: a half-applied script committed under a message describing the
> whole change. Once, `git checkout main && git merge -F -` left the run on
> `main` with no merge.

**A check whose result a commit message asserts is a precondition of the commit,
not something remembered.**
> Origin: lint failed, and the next commit said *"eslint clean"* because lint and
> commit were separate commands.

**Harness changes land between runs, never during one.**

**Never ask the owner for a new session or a hand-off.** State lives in files; past
the budget, update the state file, offer a `/compact` — or, at a gate that waits on
the owner, `/clear` and the runner's resume command — and keep working
(`context.md`).
> Origin, the third project: 28 of 118 sessions ended in a hand-off, about 90% of
> them triggered by a budget rule that said to start a new session (§3).

**Search, then read once; one slice per agent.** Grep first, then read what you
need in one call — the file whole, or a range of 150 lines or more — never page it
in small slices. The main session reads no plan or source file whole. Split a fix
round by area.
> Origin, the third project: two whole-plan reads cost about 170K tokens and ended
> a session after one step; one agent handed a whole fix round ran 309 calls, to
> 368K of context. The cost study then found the opposite failure: about 4,500
> `sed -n` slice reads, 2,137 of them under 40 lines, each a turn that re-read the
> whole context.

**Run the full verification once per unit, not once per slice.** Slices run their
targeted tests; the full run belongs to step 8 and to the merge.
> Origin, the third project: one change request ran the full suite 39 times, 8.4
> hours of wall time.

**Stop processes by the PID you recorded, never by name**, and start the lightest
form that answers the question. On a machine short of memory, hold and ask.
> Origin, the third project: watch supervisors and their package-manager parents
> outlived a kill by port, and a kill by pattern reaches every session's processes
> on the machine, not only this one's.

### Documents

**One canonical owner per fact.** Two files carrying the same rule drift, and then
neither is trustworthy.

**A decision's reasoning may outrun the decision — check whether it was applied
consistently.**
> Origin: a hash covered six fields but not the order id, so three rows copied
> onto a different order replayed as a valid chain. The decision that added two
> *other* fields had already argued that a formula not covering a field cannot
> detect an edit to it. Nobody asked — including the preflight.

**Fix a fact in every document that repeats it.**
> Origin: a claim audit's second round found five sentences that were round-one
> fixes never copied to a sibling document.

---

## 2 · Tripwires — stop in flight, do not log and continue

An anomaly recorded in a log is one discovered too late.

| Tripwire | Fired, in the origin project |
|---|---|
| **A fix round introduces a new *blocking* finding** | **4×** — every occurrence inside one of the four longest tasks |
| Scope outgrew its tier | 4× |
| Elapsed beyond 3× the tier median, **work time only** | 3× |
| A third review round opens **without the owner asking** | 1× |
| A re-tier crosses into a never-auto category | 1× |
| A second consecutive `FALSE CLAIMS` from the claim auditor on **product** claims | counts as the first row — on record prose alone it is quote-or-delete and land, not a stop |

The first is the strongest signal in the data. **When a fix makes things worse,
more fixing makes it worse still** — the approach is wrong, not the
implementation.
> Origin: an absolute-cap hook caused a permanent lockout, and exempting one path
> to fix it reopened a credential-rebinding hole. A restrictive delete policy
> turned member revocation into a silent success — *"worse than the gap it
> closed."*

**Only a blocking finding trips it.** A non-blocking finding from a fix round is
fixed or filed and counted under Defects.
> Origin, twice in the second project: every fix pass produced a minor finding of
> its own; the table had no arm for that, and the log said *"fix the machinery."*

**A third round the owner asks for is not the tripwire.** Run it, log it as the
owner's, present Gate 2 again, and never open a fourth unasked. On critical code
that round is the second family's adversarial pass, never a third Opus review
(`review-gate.mjs` says `escalate-adversarial`).

**Do not ship the thresholds.** *"3× the tier median"* is mechanism; *"90
minutes"* is a number that project earned. Generate the slot empty. If you carry
the origin's fire counts, label them as justifying the order of rows, not as
thresholds.

---

## 3 · Rules reasoned into existence, and wrong

This section exists so a generator does not repeat the pattern.

| Claim | Fate |
|---|---|
| *"Size is a poor effort proxy"* | Written at n=2. At n=19 size ordered correctly at the median and the large bucket had the **tightest** spread of any. Retracted. |
| *"A process tier scaling ceremony to blast radius is unnecessary"* | Withdrawn at n=10, when clean tasks ran 22–59 min with four reviewers. **Reversed at n=22**: elapsed reached 424 minutes on a medium task returning one HIGH, because every task ran the same pipeline; the wins were concentrated in auth, identity and isolation while the cost was spread evenly. Tiers now (`gate-design.md`). Being wrong twice about the same rule is the lesson. |
| *"One task per session, then exit"* and *"past the limit, start a new session"* | Both shipped in this skill's first version. The third project measured the cost: 28 of 118 sessions ended in a hand-off, about 90% triggered by the budget rule. State on disk made the exit unnecessary. Reversed: offer `/compact`, keep working (`context.md`). |
| An Opus code-reviewer over every slice | 63 per-slice runs in one milestone found no P0 or P1; both of its P1s came from the silent-failure lens and the second family. Across 14 days the code-reviewer cost the most of any Opus reviewer and found 8 unique P0/P1. The second family reviews each slice now; one Opus reviewer reads the whole unit diff at step 8 (`gate-design.md`). |
| Fix every finding at once, nits included | 20 of one milestone's 50 fix rounds were opened by P3s alone, each re-reviewed. P3s wait for one sweep now (§1). |
| A generic language reviewer, a blast-radius auditor and a docs lane as separate Opus reviewers on every Full unit | Over 14 days they found 1, 0 and 3 unique P0/P1 between them; the docs lane's findings were mostly P3 drift. The language lens folds into the code-reviewer's brief, lane B rides in the second family's adversarial pass, and docs drift is a script (`docs-drift.mjs`). |
| Two generic review commands on every diff by default | They reviewed one diff a third and fourth time — 92 and 31 agents on a single change request. Opt-in now, for a refactor-heavy slice or when the owner asks. |
| The full verification after every slice | 39 full runs, 8.4 hours, on one change request. Once per unit now (§1). |
| *"Preflight never edits the plan"* | Too absolute. Deciding and transcribing are different acts; transcribing an approved decision is fine, and must cite the decision id. |
| A commit guard checking only that the branch is the mainline | Refused **every** commit while any run held the lock — including the owning run's own. Unusable as written. |
| Elapsed measured first-commit-to-merge | Missed grounding entirely. Every figure recorded before the fix understates. |
| *"A report is a claim"*, as a rule for the author | Necessary and not sufficient. False claims kept rising until the check moved to a separate agent (§1). |
| Hooks that match keywords rather than effects | About thirty stalls, nothing caught. Gate on what a command does, not on words in it. A commit-message hook that checks for review tags the agent writes itself is the same mistake. A plugin's keyword hooks produced about 650 false-positive blocks across 80 sessions in the third project before they were turned off. |

**The lesson for a generator: ship rules that cite an incident. Everything else
is taste wearing a rule's clothes — and roughly one in five was wrong.**

---

## 4 · Observations worth carrying

**Deferral volume tracks review depth, not sloppiness.** The two tasks that
discovered the most follow-up items were the two highest-risk ones, reviewed line
by line. A rising queue is not evidence of declining quality.

**Fix rounds predict elapsed; defect count does not.** One task found 14 defects
and converged in 129 minutes; another found 8 and took 526 because each round
broke something new.
