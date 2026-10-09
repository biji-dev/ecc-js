# Reference: deriving the never-auto-merge policy

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
  cite is one you invented. Drop it.
- **Never import another project's categories.** They are one system's answer.
- **Expect three to six.** Fewer means the risk register went unread; more means
  correctable things crept in.
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

## Where it goes, and what not to do

Write it into the project's harness file — **and do not commit it.** The
categories are a judgment call the owner must check, and a policy adopted without
being read is not a policy.
