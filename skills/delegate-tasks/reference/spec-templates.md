# Spec templates

One file per task, `NN-slug.md`, numbered in dispatch order. A file appears in
exactly one spec's Files list.

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

## Check

```markdown
# Check NN — <what to examine>

## Scope
Exactly what to examine: `src/api/**` route handlers, or the snapshots this run
produces.

## Report
Typed findings only — where (`path:line`) / what / evidence / severity. Edit
nothing.

## Patterns to imitate
- An existing audit note showing what a good finding looks like.

## Acceptance
- Every item in scope examined, listed as checked even when clean.
- Each finding carries evidence a reader can re-run.
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
