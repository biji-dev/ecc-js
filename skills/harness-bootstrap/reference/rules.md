# Rules, and what produced each one

Every rule in §1 was written **after** a specific failure — in the origin project
(a regulated rental platform, 21+ logged tasks) or in a second project that
adopted the harness later (a multi-tenant agent platform, 10 logged tasks). None
was reasoned into existence. That is the whole filter: §3 records rules that
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

**The record is written last, from the diff, as fields — and audited by someone
who did not write it.** (`task-runner.md` 8b/8c, `claim-auditor.md`.)
> Origin: *"a report is a claim — verify it before presenting it"* was a rule
> addressed to the author. After it was written, one task shipped **eight** false
> claims, and **nine of the first twenty-one** tasks shipped at least one. None
> was caught by the author re-reading; every one by an external check. An author
> checks a sentence against what they meant, not against the tree. So it became
> a step and an agent instead of a paragraph.

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
| A second consecutive `FALSE CLAIMS` from the claim auditor | counts as the first row |

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
owner's, present Gate 2 again, and never open a fourth unasked.

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
| *"A process tier scaling ceremony to blast radius is unnecessary"* | Withdrawn at n=10, when clean tasks ran 22–59 min with four reviewers. **Reversed at n=22**: elapsed reached 424 minutes on a medium task returning one HIGH, because every task ran the same pipeline; the wins were concentrated in auth, identity and isolation while the cost was spread evenly. Two tracks now (`gate-design.md`). Being wrong twice about the same rule is the lesson. |
| *"Preflight never edits the plan"* | Too absolute. Deciding and transcribing are different acts; transcribing an approved decision is fine, and must cite the decision id. |
| A commit guard checking only that the branch is the mainline | Refused **every** commit while any run held the lock — including the owning run's own. Unusable as written. |
| Elapsed measured first-commit-to-merge | Missed grounding entirely. Every figure recorded before the fix understates. |
| *"A report is a claim"*, as a rule for the author | Necessary and not sufficient. False claims kept rising until the check moved to a separate agent (§1). |
| Hooks that match keywords rather than effects | About thirty stalls, nothing caught. Gate on what a command does, not on words in it. |

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
