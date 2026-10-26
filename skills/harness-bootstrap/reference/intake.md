# Reference: feature intake

How an idea becomes a request the units can run from: with every product and
confirmation decision asked once, up front, on one owner sheet, in the shape the
project already writes its requests in. Both modes use it.

**`[M]` mechanism · `[B]` binding**

> Origin, the v5 study (nine installs): three runners carried one line for it — "no
> request yet → writing it is the work", pointing at brainstorming, one adding "copy
> the skeleton from a recent request" — and none said what to ask the owner, or when.
> The v2 default `docs/changes/<slug>.md` was created in two installs and never
> written. In the third project one change request carried 28 numbered questions, and
> 16 more open questions were added mid-flow, answered over five owner rounds; during
> one 45.7-hour stretch with no session running, three of them waited on the owner
> while the second family was unavailable too.

## The type

`[M]` **Intake** (`runner.md` › Task type first): new behaviour that no request and
no plan row covers, with an open P or C decision (`gate-design.md` › Who decides)
or more than one deliverable. An idea the owner's message already settles — one
deliverable, nothing left for the owner to decide — is Code at its tier, not
Intake. An idea an existing request already covers is that request's change, never
a new one.

`[M]` **It writes the request and queues units; it writes no code.** It claims a
registry row like a docs unit, on its own branch (`intake/<slug>`, matched by the
Branch cell), and lands by the merge policy once the owner has approved it.

## The six steps

`[M]` **1 · Capture.** The owner's words go into the draft verbatim, dated, as its
first lines. Never paraphrased: the request is checked against them later.

`[M]` **2 · Ground.** What exists: the code it would touch, the docs that describe
that behaviour, the follow-ups doc's rows it closes or collides with, and every
existing request near it. A search agent returns locations and quoted lines; the
session reads them. A claim in the draft cites the line it rests on, or is listed
as unverified.

`[M]` **3 · Draft, in the project's own shape.** Its own request document, sections
and numbering — the request, change-request or plan format its documents already
use; `docs/changes/<slug>.md` only when it has none. Check properties, never a
template. The draft has:

- the problem, who has it, the behaviour asked for, and the non-goals;
- the deliverables, each with a `Demo:` line (`gate-design.md` › Milestone size);
- `Never-auto:` and `Risk map:` lines — the categories and the critical or hot
  modules it hits, or `none` — which set the tier the sheet shows;
- **every P and C decision as a card** (`gate-design.md` › Who decides), with no
  question left as a word (`TBD`); every T decision taken and listed under
  *Decided*, one line each with its reversal cost;
- the estimate — the line `node scripts/estimate.mjs --log <log> --tier <tier>`
  prints, pasted as-is: a range from this project's log, or "no history";
- the unit queue, unit 1 first, and **unit 1's Scope block** (`scope-guard.md`).

`[M]` **Lenses, not generators.** `superpowers:brainstorming`, where installed, answers
its own first question — is anything that matters missing from the idea? — and,
when the idea is too thin to ground, gives one open question before step 2;
its one-question-per-message conversation never replaces the sheet. ECC's
`intent-driven-development` turns the behaviour into `Done when` and `Demo:` lines,
`product-capability` lists the constraints, invariants and unresolved decisions
that become cards, `blueprint` cuts the deliverables into one-branch units, and
`contract-first` makes a shared contract the first deliverable when its consumer and
provider would build in parallel. Each is read for its questions; none writes the
request.

`[M]` **Never regenerate an existing request** with `/ecc:plan-prd` or
`/ecc:prp-plan`: they write a generic PRD without the request's own sections and
citations. One project forbids it in its own workflow for that reason.

`[B]` **Where the project's documents forbid a session writing its requests** —
one project's PRD "is authored by hand, always" — intake drafts the sheet and the
queue as a note beside them, and the owner writes the document from it.

`[M]` **4 · Review, by the second family.** The draft is Docs-heavy (`runner.md` ›
Task type first): one read-only review by the other model family (`cross-model.md`),
its brief the properties above plus two asks — every question the draft leaves
open, and every claim no cited line supports. One fix pass. Then
`node scripts/intake.mjs --check <request>`, until it prints `intake: ready for the
owner sheet`. The second family unavailable → a fresh Opus agent, read-only,
recorded `degraded`.

`[M]` **5 · One owner sheet.** In this order: the deliverables with their `Demo:`
lines; the cards; the never-auto and risk-map hits with the tier they set; the
estimate; unit 1's Scope block; the queue; *Decided*. How it reaches the owner
follows the context rule (`gate-design.md` › Who decides). The answer turns each card
into a decision row (`By: owner`, or `default` where the owner let it stand).
- An answer that picks among a card's options approves the draft with those
  choices written in.
- An answer that adds or drops a deliverable, or changes unit 1's Scope block
  beyond a card's option, is a revision: steps 3 to 5 again for what changed, one
  more sheet.
- Approved → `intake.mjs --check` once more, then one line in the request:

```
Approved: <YYYY-MM-DD> · owner · <unit>/DEC-n · unit <unit 1's id> · tier <tier> · scope <sha>
```

`[M]` The `scope` sha is the one `--check` printed for the Scope block the owner
saw. A park-and-carry default is never approval: an unanswered sheet waits.

`[M]` **6 · Register, then queue.** Enter the request wherever the project registers
requests — its register, its index, its plan's rows — and queue its units there,
unit 1 first. Nothing is claimed by the intake; the next claim takes unit 1.

## Unit 1's Gate 1

`[M]` **The sheet approved unit 1's Scope block and estimate, so its Gate 1 is
automatic while nothing it approved has changed.** At Gate 1 (`runner.md` › The
sequence), run:

```
node scripts/intake.mjs --gate1 <request> --state <unit 1's state file>
```

- `Gate 1: auto — <request> approved <date> by the owner (<ref>) for <unit> at <tier>;
  its Scope block is unchanged (sha <sha>)` → no sheet. The ledger's Gate 1 row quotes
  the line as its evidence.
- `Gate 1: owner — <what changed>` → the ordinary Gate 1 sheet, which opens with
  that line: another unit, a re-tier, an edited Scope block, a request edited after
  its approval, or no approval at all.

`[M]` **Only unit 1.** The sheet approved its Scope block alone; later units were
queued, not approved. Their Gate 1 runs as usual, and the cards the intake already
answered are decision rows, never asked again.

`[M]` **Grounding still runs.** Step 1 re-verifies the request against the mainline
before Gate 1; a finding that changes a deliverable, its `Demo:` or a P or C decision
is an owner stop (`gate-design.md` › Owner stops), and an edited Scope block makes
`--gate1` say `owner`.

## The intake check

`[M]` `scripts/intake.mjs` reads files and prints; it never writes. `--check`:
one line per property — deliverables, cards by class, the estimate, the never-auto
and risk-map lines, unit 1's Scope block and its sha, the approval — then a
`PROBLEM` line for each one missing and the verdict. Exit 0 ready or approved, 1 a
property missing, 2 usage. `--gate1`: exit 0 auto, 1 the owner decides.

`[B]` In `scripts/lib/intake-core.mjs`: `STRAY`, the words that mark a question this
project's documents leave open.

## What the log records

`[M]` One row per landed intake (`log-format.md` › Intake rows): the cards asked,
the days from capture to approval, and — on the queued units' rows — the cards asked
after it. Cards asked after an intake are its misses.
