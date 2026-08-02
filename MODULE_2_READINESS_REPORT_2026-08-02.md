# Module 2 readiness — 2026-08-02

Status: **PARTIAL / not ready for public users**

## What is implemented locally

- Immutable `DecisionRevision` and `SelectionRevision` contracts with
  provenance/evidence, human-vs-system actor rules, supersession and safe RUB
  price observations.
- Approval package lifecycle: draft → submitted → approved/rejected/
  change_requested. AI/system actors cannot approve.
- Server-side command schemas and request-bound RPC adapter for decision,
  selection, price and approval operations.
- Authenticated read projection for decisions, selections, evidence and revision
  history.
- Deterministic text Concept Pack slice from the legacy M1 passport.

## Evidence

The M2-specific contract/security/UI tests pass:

```text
4 files, 44 tests passed
```

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
AP1_DB_OK postgres=17.6 migrations=18 private_persistence_runtime_grants=0
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
creator. However, the current approval schema has no explicit `self_approved`
column or equivalent persisted marker; that acceptance requirement is therefore
not yet proven and must not be presented as complete.

The production-shaped SQL snapshot separately proves that production has a
different public governed-M1 runtime: zero `projectceo_*` schemas and no
`project_intelligence` schema. Therefore local M2 persistence is not production
adoption evidence.

## What is not complete

- The decisions UI currently renders create/approve/change/reject controls as
  disabled in `components/projectceo/project-workspace.tsx`.
- There is no complete designer write UX for room → variants → selection →
  approval; current UI is primarily an authenticated read surface.
- The full M2 workspace (rooms, variants, real materials/items, budget frame and
  client approval handoff) has not passed an authenticated browser rehearsal.
- Production `project_facts` lacks the canonical `provenance` field and does not
  contain the repository's Project Brain schemas/RPCs.
- Broad M2 AI/credits, image generation, CAD/render integrations and marketplace
  behavior remain outside the current gate and are not implemented.

## Next bounded gate

1. Move the proven DB4 flow behind an authenticated request-bound/browser
   rehearsal (the local DB4 SQL proof is complete).
2. Build a disposable production-shaped clone from the schema/ACL/RLS snapshot
   and add only the smallest additive provenance projection/bridge on that
   clone; do not copy production rows into a second model.
3. Enable one authenticated designer slice: create decision → create selection
   → submit approval package → human review, with immutable revision evidence.
4. Run authenticated browser QA and negative RLS tests on the clone.
5. Reclassify Module 2 only after those proofs; production adoption remains a
   separate controlled gate.

Until these proofs exist, Module 2 must remain `PARTIAL`, not `READY`.
