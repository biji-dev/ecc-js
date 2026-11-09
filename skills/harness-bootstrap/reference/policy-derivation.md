# Reference: deriving the never-auto-merge policy, the risk map and the merge policy

**Phase B. The piece that cannot be templated, and the reason this skill is not
a template.** It is also the precondition that actually fails: of four projects
surveyed in one portfolio, none had a written one — not because anyone was
careless, but because the rule lived in a senior engineer's head and nobody had
been asked to write it down.

## The single test

For every candidate change category:

> **If this is wrong and ships, can it be corrected forward?**

Correctable forward is **not** this list. A wrong number can be corrected. A
reversible merge can be reversed. Data that left the building, a message that was
sent, and a record that was supposed to prove what happened cannot.

**Ask it against the stakes line.** Phase A records the owner's
`Stakes: <data> · <exposure> · <who runs it> · <what cannot be corrected forward here>`;
it opens the policy block with the line *A P0 or P1 must be reachable under this
line*, so a reviewer that reads only `AGENTS.md` judges by it, and every reviewer
brief carries it (`gate-design.md` › Severity). A local prototype with fictional data has little that
cannot be corrected forward, and its policy says so.

## Rules for the output

- **Every category cites an identifier from the project's own documents** — a
  locked decision, a numbered risk, a security requirement. A category you cannot
  cite is one you invented. Drop it. A small repository with no such documents
  cites the code instead (`path:line` of the invariant, a comment stating it) and
  says so; the owner's review is then the only check, so flag it.
- **Never import another project's categories.** They are one system's answer.
- **Expect three to six** where the project has a risk register. Fewer means it
  went unread; more means correctable things crept in. A small repository may
  honestly have one or two — say which surfaces you looked at.
- **Say which severe risks you excluded, and why.** That list is as informative
  as the policy, and it is where a reader will disagree with you if anywhere.

## Two worked examples, deliberately different

The point of showing both is that a template would have produced the same answer
twice, and the right answers are not the same.

**A rental platform handling identity documents — three categories:**
auth and session handling · identity document storage, access and purge · any
database migration. Small surface, and every one of them is about a *person's*
irreversible exposure.

**A multi-tenant agent platform that can act on the world — five:**
the tenant boundary · the untrusted→privileged boundary · audit integrity · what
leaves the system (outbound actions, and secrets crossing into a model context or
third-party telemetry) · schema migrations, because schema-per-tenant makes one
migration a fleet operation.

Different counts, different shapes, same test. The second project has an agent
that sends things, so *what leaves the system* is a category the first does not
need. The first holds scans of national identity cards, so identity storage is
a category the second does not have.

## The risk map — derived in the same pass

The policy names categories. The risk map names **paths**, so a unit that has no
plan row — a change, a hotfix — still gets a tier, a writer model and a reviewer.
It is what lets a repository without a plan get gates at all. Same test, applied
to code instead of change categories.

| List | What goes on it | Evidence each entry cites |
|---|---|---|
| **Hot modules** | named paths where a defect spreads or cannot be corrected forward, and any module imported by at least *N* files | the policy category, a risk id, an incident, or the importer count |
| **Critical code** | the code implementing each never-auto category + schema and migrations + the harness's own guards + the hot modules that cite an irreversible harm under the stakes line | the category, or the harm a defect there reaches under the stakes line |
| **Cold modules** | named paths where a defect is visible and cheap — leaf UI, internal tools, test helpers | the reason it is cheap |
| everything else | standard | — |

- **Hot wins over cold.** A cold-looking component with many importers is hot. **The
  importer count makes a module hot, never critical.**
- **Every critical entry cites a harm or a category.** A coverage target, a layer
  name or an importer count alone is no evidence: a module whose every defect can be
  corrected forward is standard, and its tier test still applies.
- **Never put shared constants, formatters or date utilities on the cold list** —
  their importers make them hot.
- `[B]` *N* — **left empty at generation.** List the ten most-imported modules with
  their counts as hot candidates in the draft; the owner sets *N* or strikes entries
  at review.
> Origin, the v10 study: in one install the hot modules and the modules with 25 or
> more importers made every product change critical, so all 7 product units ran Full.
- Read the history too: `git log --since=90.days --numstat` names the modules that
  change most and the fix commits that touched them. A hot module that never
  changes still belongs on the list; a frequently fixed one is a candidate.

**A new repository has planned paths only.** Take them from the documents that fix
the layout (an architecture or repository-structure section) and from the areas the
documents say need the owner's approval, and mark each entry **`planned`** with the
document it comes from. A planned path is critical when its area is; there are no
importer counts and no history yet, so *N* stays empty. Write the trigger into the
draft: the flip re-derives the map (`foundation.md`) and places every top-level
product directory, and the first milestone after it re-derives it again — the owner
reviews each like the first. A new file under a placed directory takes its class;
a path under no placed directory is **critical**, never cold.

**The harness's own paths are on the map too.** These are **critical** — the risk
map's tier, which some projects also call never-auto (a project whose own word differs
maps it). A broken one silently allows everything:

- the commit guard (`harness-guard.sh`) and the hook files that run it — it decides
  what may be committed;
- the command guard and the edit guard (`.claude/hooks/`) and the files that wire them
  in: `.claude/settings.json`, `.codex/hooks.json` where Codex runs and
  `.zcode/config.json` where ZCode runs — an edit there unhooks a guard as surely as
  editing the guard (the risk map lists paths, so the whole file is critical);
- `run-gates.sh` — it runs the gates;
- `scripts/run-counted.mjs` and its core — they decide whether a counted gate passed;
- `scripts/review-gate.mjs` and `scripts/lib/review-gate-core.mjs` — they decide who
  reviews.

The runner skill, the auditors and the harness docs are standard. Leaving the
critical ones off is how a later session finds them unplaced and has to file it.
Critical here sets the gate, not the review: the owner merges a change to these, and
a diff of harness paths alone — these, the instruction files, the harness scripts
and records, `HARNESS` in `review-gate-core.mjs` — runs the harness lane
(`runner.md`).

## The merge policy

Draft the default from `gate-design.md` — merge when green for every tier, the
never-auto categories the owner's, and the standing grant with `Push deploys:` read
from the workflows (› The standing grant) — and state any tightening the documents
imply (a regulated project may want no auto-merge at all: `Grant: none`). An
upgrade sheet never recommends narrowing the grant without citing an incident.

## Where it goes, and what not to do

Write all three — policy, risk map, merge policy — into the project's harness
file, inside the `policy`, `risk-map` and `merge` markers (`upgrade.md`), under one
status line:

```
Never-auto policy: DRAFT — owner has not reviewed
```

**And do not commit it.** The categories and paths are a judgment call the owner
must check, and a policy adopted without being read is not a policy. The owner
changes the line to `REVIEWED <date>`; the manifest records all three as
`reviewed`.
