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
| **Hot modules** | named paths where a defect cannot be corrected forward | the policy category, a risk id, or an incident |
| **Critical code** | the hot modules + the code implementing each never-auto category + schema and migrations + any module imported by at least *N* files | the category, or the importer count |
| **Cold modules** | named paths where a defect is visible and cheap — leaf UI, internal tools, test helpers | the reason it is cheap |
| everything else | standard | — |

- **Critical wins over cold.** A cold-looking component with many importers is
  critical.
- **Never put shared constants, formatters or date utilities on the cold list** —
  their importers make them critical.
- `[B]` *N* — **left empty at generation.** List the ten most-imported modules with
  their counts as candidates in the draft; the owner sets *N* or strikes entries at
  review.
- Read the history too: `git log --since=90.days --numstat` names the modules that
  change most and the fix commits that touched them. A hot module that never
  changes still belongs on the list; a frequently fixed one is a candidate.

**A new repository has planned paths only.** Take them from the documents that fix
the layout (an architecture or repository-structure section) and from the areas the
documents say need the owner's approval, and mark each entry **`planned`** with the
document it comes from. A planned path is critical when its area is; there are no
importer counts and no history yet, so *N* stays empty. Write the trigger into the
draft: re-derive the map when a planned path first has code, and at the first
checkpoint after that — the owner reviews the re-derived map like the first one.
A path the map cannot place yet is **critical**, never cold.

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

## The merge policy

Draft the default from `gate-design.md` — Small merges locally on its own when
clean; Full, never-auto and taste calls wait for the owner; push is always the
owner's — and state any tightening the documents imply (a regulated project may
want no auto-merge at all). Never loosen push.

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
