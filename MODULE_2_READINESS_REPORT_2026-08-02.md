# Module 2 readiness — 2026-08-02

Status: **PARTIAL / not ready for public users**

## Progress scale (engineering estimate, not a READY verdict)

Using the narrow M2 Decision/Selection/Approval foundation as the 100-point
scope, the current evidence supports **90/100**. This is an engineering gate,
not a claim that the full public M2 workspace is complete:

| Area | Weight | Proven now |
| --- | ---: | ---: |
| Immutable contracts and PostgreSQL persistence | 25 | 25 |
| Request-bound workflow/API sequence | 20 | 20 |
| Auth, RLS and security controls | 15 | 15 |
| Designer write workspace and controls | 20 | 17 |
| Authenticated browser QA | 10 | 8 |
| Explicit `self_approved` approval semantics | 5 | 5 |
| Production-shaped compatibility/adoption gate | 5 | 0 |
| **Total** | **100** | **90** |

This is not a product-completion percentage for the full public M2 Design
Workspace. The broader workspace (rooms, variants, real materials/items, budget
frame and client approval handoff) is explicitly not implemented yet; including
those surfaces would make the public M2 percentage lower, not higher.

## What is implemented locally

- Immutable `DecisionRevision` and `SelectionRevision` contracts with
  provenance/evidence, human-vs-system actor rules, supersession and safe RUB
  price observations.
- Approval package lifecycle: draft → submitted → approved/rejected/
  change_requested. AI/system actors cannot approve.
- Server-side command schemas and request-bound RPC adapter for decision,
  selection, price and approval operations.
- Authenticated read projection for decisions, selections, evidence, revision
  history and the additive `selfApproved` marker.
- Deterministic text Concept Pack slice from the legacy M1 passport.

## Evidence

The full repository test suite passes:

```text
72 files, 426 tests passed
```

`npm run typecheck`, `npm run build` and `npm run lint` pass. Lint reports nine
pre-existing warnings and zero errors.

The disposable DB4 Product Brain harness now passes on both PostgreSQL 17 and
16, including the requested persistence sequence:

```text
create decision → create selection → submit approval package → human review
DB4_PRODUCT_BRAIN_HARNESS_OK image=postgres:17-alpine
DB4_PRODUCT_BRAIN_HARNESS_OK image=postgres:16-alpine
```

The harness also covers forced RLS/ACL, idempotency, concurrency, rollback and
restart replay. Its RPC-count assertion was updated to include the two
request-bound release functions introduced by the AP1 read migration.

The deployed-state hardening checks from `4970db4` are also present: the
verification contract scans all nine managed schemas for forbidden
`auth.uid()`/`auth.jwt()`/`auth.users` references and validates the request-claim
reader functions by owner, `SECURITY DEFINER` status and pinned `search_path`.
The focused contract suite passes with 48 tests after this hardening change.

Migration-path reconciliation is documented separately in
`docs/product-intelligence/agent-runs/db-wave/MIGRATION_PATH_DECISION_2026-08-02.md`:
old timestamped migrations remain immutable; clean-bootstrap is the proven path
for new/disposable clones; production remains grandfathered and is not replayed.

The full local Supabase Auth/PostgREST stack was also started with the canonical
chain. The first `verify-db.sql` run correctly stopped on the historical local
`pi_table_owner → auth.users` grant. That grant was revoked only inside the
local clone (no migration or production change), after which the verifier passed:

```text
AP1_DB_OK postgres=17.6 migrations=20 private_persistence_runtime_grants=0
executor_roles_guarded=true storage_bucket_private=true managed_auth_references=0
request_claim_readers=ok
```

An authenticated HTTP rehearsal now also passes against the local Supabase
Auth/PostgREST stack (no construction photo fixture involved). A signed
request-bound human JWT successfully executed `list_projects`, then:

```text
append_decision_revision
append_selection_revision
create_approval_package
submit_approval_package
review_approval_package (approved)
state_revision: 29 → 34
```

The approval event is human-authored and records the same actor as the package
creator. Additive migration `20260802010000_projectceo_approval_self_approval.sql`
stores `self_approved` on the terminal append-only event. Additive migration
`20260802020000_projectceo_approval_read_self_approval.sql` exposes that marker
through the already-authorized read envelope. The authenticated clone rehearsal
returned `selfApproved: true`, and SQL verification confirmed the marker on
sequence 3 while sequences 1 and 2 remain false.

The authenticated live surface now includes a bounded Designer write slice:
create decision, create selection, create approval package, submit it and run
human review. The existing fixture route remains read-only by design. Desktop
and 390×844 mobile browser rehearsals both completed this sequence; the UI
displayed “Approved by author” and recorded no console errors.

The final clean replay also verified the new read wrapper's ACL (`anon` has no
execute privilege; `authenticated` does), and an outsider request was rejected
by the request-bound project capability check before any workspace data was
returned.

The production-shaped SQL snapshot separately proves that production has a
different public governed-M1 runtime: zero `projectceo_*` schemas and no
`project_intelligence` schema. Therefore local M2 persistence is not production
adoption evidence.

## What is not complete

- The complete designer workspace for room → variants → real materials/items →
  selection → approval is not implemented; the current write slice is limited to
  decision/selection/approval commands.
- The full M2 workspace (rooms, variants, real materials/items, budget frame and
  client approval handoff) is not implemented; browser evidence covers only the
  bounded Decision/Selection/Approval slice.
- Production `project_facts` lacks the canonical `provenance` field and does not
  contain the repository's Project Brain schemas/RPCs.
- Broad M2 AI/credits, image generation, CAD/render integrations and marketplace
  behavior remain outside the current gate and are not implemented.

## Remaining gate

1. Decide whether to expand M2 beyond this bounded foundation into rooms,
   variants, real item catalogs, budget framing and client handoff.
2. Keep production adoption as a separate controlled gate: production has zero
   Project Brain schemas and must not receive these migrations implicitly.

Until the broader workspace and production adoption gate are separately proven,
Module 2 must remain `PARTIAL`, not `READY`.
