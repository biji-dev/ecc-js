# Spec templates

One file per task, `NN-slug.md`, numbered in dispatch order. A file appears in
exactly one spec's Files list.

## The slicing table

The run's index, written before any spec and approved at Gate 1 in a harness:

```markdown
| Slice | Files | Kind | Executor | Order / wave | Gate | Expected counts | Risk |
|---|---|---|---|---|---|---|---|
| 01 money service | src/refunds/service.ts, src/refunds/service.test.ts | build | Opus implementer | 1, serial | `npm test -- refunds` | 9 cases | critical |
| 02 route | src/api/refunds.ts | build | Sonnet | 2, wave A | `npx tsc --noEmit` | — | cold |
| 03 admin button | src/admin/RefundButton.tsx | build | Sonnet | 2, wave A | `npm test -- RefundButton` | 3 cases | cold |

Coverage: AC1 → 01 · AC2 → 02 · AC3 → 03
Kept by the session: src/api/router.ts (hub)
```

## Build

```markdown
# Task NN — <imperative title>

Wave: 0 | 1 | …

## Goal
One sentence: what this task delivers.

## Files
- Create: `src/orders/export.ts`
- Modify: `src/api/orders.ts`

## Contract
Everything other tasks depend on — verbatim, identical in every spec that
touches it, with its source (plan row or decision id):
- `GET /api/orders/export.csv` → 200, `text/csv`,
  `Content-Disposition: attachment; filename="orders.csv"`
- `serializeOrders(rows: Order[]): string` exported from `src/orders/export.ts`

## Patterns to imitate
- `src/api/customers.ts` — route + service split
- `src/utils/csv.ts` — quoting rules

## Repo rules
- Quote the two or three project rules this slice could break.

## Acceptance
Run each and fix until green; never report a check you did not run:
- `npx tsc --noEmit` — no errors
- `npm test -- export` — all pass, 6 cases
```

## Fix

```markdown
# Fix NN — <imperative summary of the symptom>

## Symptom
What goes wrong, as reported (ticket quote or repro steps).

## Root cause
From the main session's diagnosis: where, and why. Builders never guess this.

## Files
- Modify: `src/orders/export.ts` (the fix)
- Create: `src/orders/export.test.ts` (the regression test)

## Contract
Correct behaviour after the fix: `serializeOrders([])` returns the header row
only — no throw.

## Patterns to imitate
- `src/utils/csv.test.ts` — test style

## Acceptance
- Write the regression test; run it on the CURRENT code and see it FAIL first.
  Paste the failing line.
- Apply the fix and run until green: `npm test -- export`
- `npx tsc --noEmit` — no errors
```

## Control

A test whose job is to prove that a protection works. Judged by someone other than
its writer (in a harness: lane C, the claim auditor).

```markdown
# Control NN — prove <the protection>

## Protection
What must hold, and where it is enforced: `src/api/refunds.ts:41` refuses a refund
above the captured amount.

## Files
- Create: `src/api/refunds.control.test.ts`

## Acceptance
- Commit first.
- Write the test; run it; paste the green line.
- Remove the protection (save the hunk as a patch, `git apply -R` it); run the test;
  paste the **red** line. Its own assertion must fail — a compile or import error is
  not a red.
- Restore (`git apply` the patch); run it; paste the green line again.
- `git status --porcelain` matches what it was before the control. Never
  `git checkout -- <file>`.
```

## Check

```markdown
# Check NN — <what to examine>

## Scope
Exactly what to examine: `src/api/**` route handlers, or the snapshots this run
produces. In a review fan-out: the diff against `<base>`, working tree included,
plus the Scope block and the Impact Analysis.

## Lens
The one question this check asks — e.g. "handlers missing the permission check", or
for a blast-radius lane "readers OUTSIDE the diff of each changed export, field,
route, column, config key or environment variable".

## Report
Edit nothing. One row per finding:

| Field | |
|---|---|
| severity | P0 · P1 · P2 · P3 |
| where | `path:line` |
| evidence | the quoted line or command output |
| why | why it is wrong |
| repro | how a reader re-runs it |
| introduced | this diff · pre-existing |
| scope class | IN · BLOCKER · CRITICAL · OUT (proposed; the session decides) |

Then a **checked and clean** list, one line per item examined with nothing found.

## Patterns to imitate
- An existing audit note showing what a good finding looks like.

## Acceptance
- Every item in scope examined, listed as checked even when clean.
- Each finding carries evidence a reader can re-run.
```

## Plan

Two of these from one brief, to two different models, neither seeing the other.

```markdown
# Plan — <the change>

## Brief
The problem, the evidence from investigation, the constraints, the Scope block, and
the invariants the change must preserve. Identical for both planners.

## Return
- Files and functions to change, with line ranges.
- Data flow and edge cases.
- Impact Analysis: every caller, invariant and dependent flow, and how each is
  preserved.
- Tests that prove it.
- Open questions, each with a proposed default.

Read the code; do not edit it. Do not look for another plan of this change.
```

## Copy rows

When a slice ships user-facing text, the strings are decided before delegation
and pasted verbatim:

```markdown
## Copy (owner-approved, verbatim)
| Key | Text |
|---|---|
| export.button | Export CSV |
```
