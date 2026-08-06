# ArchiDom M2 Completion Agent Loop Plan

Date: 2026-08-06
Status: proposed execution plan; implementation requires slice approval
Target: authenticated M2 P0, not production adoption

## 1. Outcome

Complete one real vertical M2 flow for one project room:

```text
Contracted Project Passport
  -> Room Design Brief
  -> three controlled Design Intent variants
  -> real selections with provenance and current RUB observations
  -> budget frame
  -> human/client review
  -> immutable Approved Design Intent + Approved Selections
  -> versioned handoff to M3
```

The result is complete only when the flow works through request-bound Auth/PostgREST
and additive command contracts without manual writes to private tables or human
operations through service role.

## 2. Scope boundary

### Included in this P0

- one Organization, Project, Package and Room/Area context;
- exactly three controlled variants for one room;
- one preferred variant plus value-engineered and premium alternatives;
- explicit requirements, constraints, decision reasons and source revisions;
- selections for materials/items with supplier reference, checked date and integer RUB;
- deterministic budget frame and freshness warnings;
- designer submission and human client approve/reject/change-request actions;
- immutable approved snapshot and audit lineage;
- Layout Studio loading and saving through an authenticated repository port;
- exact-version M2 handoff readable by M3;
- Kora package plus one external real package through the same contracts.

### Excluded until later gates

- native CAD/BIM or exact DWG authoring;
- broad AI provider router, credits billing or unlimited generation;
- marketplace, procurement, accounting or warehouse flows;
- full multi-room Design Workspace;
- production adoption;
- automatic AI approval or release.

## 3. Definition of the M2 artifacts

### Design Intent Variant

A versioned room-scoped proposal containing the exact Layout Document version,
Style DNA/reference constraints, rationale, warnings and budget classification.

### Approved Design Intent

An immutable human-approved snapshot of one exact variant revision. It cannot point
to a mutable draft or silently follow a newer Layout Document.

### Approved Selection

An immutable approval target containing an exact selection revision, specification,
source provenance, supplier reference, price observation time and review decision.
Price staleness does not rewrite the approval; it creates a warning/new observation.

### Budget Frame

A deterministic sum/range in integer RUB over the exact selected revisions, with
missing-price and stale-price warnings. It is not an invoice or procurement order.

## 4. TDD vertical slices

### Slice 1 — Room Design Intent aggregate (domain)

Define three room-scoped variants tied to exact Layout Document versions. Verify
scope consistency, stable IDs, unique variant roles, revision reasons and immutable
publication of the chosen Design Intent.

Exit: domain tests prove invalid cross-project/package/room references and mutable
draft references are rejected.

### Slice 2 — Selections and budget frame (domain/domain service)

Bind existing SelectionRevision and PriceObservation contracts to a Design Intent
variant. Calculate preferred/value-engineered/premium totals and freshness warnings
without floating-point money.

Exit: tests cover missing prices, stale observations, replacement revisions,
cross-scope evidence and deterministic totals.

### Slice 3 — Approval package and M2 commit (application)

Build the human-only submit/review/change-request flow and create immutable
Approved Design Intent + Approved Selections from exact revisions.

Exit: tests prove AI/system actors cannot approve, stale reviews fail, retries are
idempotent and accepted publications are append-only.

### Slice 4 — Authenticated persistence and commands (infrastructure)

Add migrations/RPC/read contracts for variants, budget frames and approved M2
snapshots. Actor, Organization, Project, Package, Room and effective role are derived
server-side. The application does not access private tables directly.

Exit: PG16/PG17, RLS/ACL, tenancy/package/room negatives, concurrency,
idempotency, rollback and restart replay pass in disposable infrastructure.

### Slice 5 — Layout Studio repository integration (application/infrastructure)

Replace the synthetic/local-only production path with an authenticated repository
port while retaining local storage only as an explicit internal preview adapter.

Exit: a designer opens a real permitted room, edits a variant, saves a new revision,
reloads it and cannot read or write a sibling Organization/Package/Room.

### Slice 6 — Client review UI and M2-to-M3 handoff (infrastructure/UI)

Expose Russian workspace UI for three variants, selections, budget warnings,
submission, review and exact-version M3 handoff.

Exit: designer and client complete the flow in separate authenticated/guest-scoped
sessions; M3 reads only the approved immutable artifact, not drafts.

### Slice 7 — Pilot evidence

Run the full flow for Kora with owner-approved source/coordinate evidence and for one
external real package through the same Organization/Project/Package contracts.

Exit: authenticated browser matrix, audit replay, export privacy scan and manual
five-minute walkthrough pass. Evidence remains pilot evidence, not production GO.

## 5. Agent Loop protocol

For every slice:

1. RED: an isolated test writer receives the slice contract and public API only.
2. GREEN: an isolated implementer receives only the failing test and failure output.
3. REFACTOR: an isolated reviewer receives green code/tests and may simplify without
   changing behavior.
4. Run the slice test, full tests, lint, strict typecheck and build as appropriate.
5. Update this plan with evidence, changed files, known limitations and the next slice.
6. Stop on a real contract/security blocker; do not weaken tests or invent evidence.

Database and browser slices add their own required gates. A green local fixture never
substitutes for request-bound Auth/RLS evidence.

## 6. Milestones and decision gates

| Milestone | Deliverable | Decision |
|---|---|---|
| M2-A | Domain contracts for variants, selections and budget | Safe to persist? |
| M2-B | Human approval and immutable M2 commit | Contract accepted? |
| M2-C | Authenticated DB/read/command integration | Safe for disposable pilot? |
| M2-D | Integrated Layout Studio and client review | Usable end-to-end? |
| M2-E | Kora + external package evidence | Pilot GO/NO-GO? |
| M2-F | Two paid concierge/pilot cycles | Select or reject M1-to-M2 wedge |

## 7. Completion criteria

M2 P0 is complete only when all are true:

- one room has three managed variants and one exact approved revision;
- approved selections include provenance and time-bound RUB observations;
- budget frame is reproducible from the approved revision set;
- only a human with effective scope can approve;
- approvals/publications/audit are append-only and retries idempotent;
- Layout Studio uses authenticated persistence for the pilot path;
- client review and M2-to-M3 handoff work without private-table writes;
- Kora and one external package pass the same contracts;
- lint, typecheck, tests and build pass;
- PG16/PG17 and authenticated browser/RLS matrices pass;
- the verdict remains `PILOT_READY` or `NO_GO`, never `PRODUCTION_READY` without a
  separate adoption gate.

## 8. Immediate next action

Reconcile the current authenticated migration ledger, then start Slice 4 with an
isolated RED contract for request-bound M2 persistence and commands.
Do not merge the Layout Studio branch into the current product branch until the
integration base and migration ledger have been reconciled and verified.

## 9. Execution evidence

### 2026-08-06 — M2-010 Room Design Intent aggregate

Status: completed.

- RED: 14 contract tests failed on `DESIGN_INTENT_NOT_IMPLEMENTED` in a clean
  disposable worktree.
- GREEN: exact three-role aggregate and immutable exact-version publication added.
- REFACTOR: output contracts made readonly; domain-to-application canonical JSON
  dependency removed from the existing decisions workflow.
- Verification: 71 test files / 417 tests PASS; strict typecheck PASS; targeted ESLint
  PASS; Next.js production build PASS.
- Environment note: the iCloud worktree runtime stalled before Vitest output, so the
  reproducible gate used detached commit `1978b27` in `/private/tmp` plus only the
  current slice changes and a freshly installed lockfile dependency tree.

### 2026-08-06 — M2-020 Selections and budget frame

Status: completed.

- RED: 16 contract tests failed on `DESIGN_BUDGET_NOT_IMPLEMENTED`.
- GREEN: exact selection bindings, deterministic as-of price choice, supplier/source
  provenance checks, integer RUB totals and stale/missing-price warnings added.
- GREEN retry: scope validation was moved before generic revision validation so a
  cross-scope input returns `DESIGN_BUDGET_SCOPE_MISMATCH` deterministically.
- REFACTOR: removed a redundant second scope check; unrelated approval/supersession
  behavior changes were intentionally deferred until their own RED contract.
- Verification: 72 test files / 433 tests PASS; strict typecheck PASS; targeted ESLint
  PASS; Next.js production build PASS.

### 2026-08-06 — M2-030 Human approval and immutable M2 commit

Status: completed.

- RED: five lifecycle tests failed on `M2_APPROVAL_NOT_IMPLEMENTED`.
- GREEN: designer submission, distinct human client review, approved-only commit,
  exact snapshots and stale intent/layout/selection/budget checks added.
- Trust-boundary RED: two additional tests proved forged approved objects and
  JSON-key-order-dependent selection comparison were unsafe.
- Trust-boundary GREEN: commit revalidates human actors, reviewer separation,
  chronology and chosen variant; selection comparison is structural and deterministic.
- Verification: 73 test files / 440 tests PASS; strict typecheck PASS; targeted ESLint
  PASS; Next.js production build PASS.
