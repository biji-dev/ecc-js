# Reference: vendor-trap skills (Phase E)

**Evidence:** the origin project grew nine of these in its first thirty tasks —
schema-generator diffs that omit DDL, privilege behaviour, query-cache semantics,
auth-library and object-store behaviour, toolchain traps. Each is a measured list
of behaviours that contradict the vendor's own documentation. None could have
been written before the run that hit it.

**`[M]` mechanism · `[B]` binding**

## When

`[M]` A library behaves contrary to its documentation **and the run measured it**.
Write the skill **before the session exits** — it is built from this session's
evidence, which a later session does not have. A process lesson is not a vendor
skill; it goes in the harness log.

`[M]` If a skill for that vendor already exists, **append** a section rather than
creating a second one. The origin's skills grew task by task.

## Where

`[M]` `.agents/skills/<vendor>-traps/SKILL.md`, with the Claude Code symlink
(`harness-targets.md`). Project-local — it names this project's versions.

## Shape

```markdown
---
name: <vendor>-traps
description: "Use when <the command or symptom, in the words someone would search>. Measured cases: <one phrase each>."
metadata:
  origin: task-run
---

# <vendor>: <the headline trap>

**Extracted:** <date> (task <id>)
**Measured against:** <vendor and version as installed>; <how it was run>

## Problem

What the documentation says, what the tool actually did, and the output that
showed it — pasted, not paraphrased.

## Solution

What to do instead, and the check that proves it worked.

## Trap: <second case>

Same shape, appended by a later task.

## When to Use

The exact commands, errors or situations that should load this skill.
```

`[M]` **Measured, not believed.** Every claim in the skill carries the output that
showed it, and the version it was measured against — a vendor release can fix the
trap, and an unversioned trap becomes a false claim.

`[M]` The description is trigger text: the command someone is about to run, or
the error they are looking at. That is what makes it load at the right moment.
