# Module 2 readiness — 2026-08-02

Status: **PARTIAL / not ready for public users**

## Progress scale (engineering estimate, not a READY verdict)

Using the bounded M2 foundation plus additive workspace contracts as the 100-point
scope, the current evidence supports **94/100**. This is an engineering gate,
not a claim that the full public M2 workspace is complete:

| Area | Weight | Proven now |
| --- | ---: | ---: |
| Immutable contracts and PostgreSQL persistence | 25 | 25 |
| Request-bound workflow/API sequence | 20 | 20 |
| Auth, RLS and security controls | 15 | 15 |
| Designer write workspace and controls | 20 | 20 |
| Authenticated browser QA | 10 | 9 |
| Explicit `self_approved` approval semantics | 5 | 5 |
| Production-shaped compatibility/adoption gate | 5 | 0 |
| **Total** | **100** | **94** |

This is not a product-completion percentage for the full public M2 Design
Workspace. The broader public M2 still needs a client-facing handoff surface,
multi-revision editing UX and the authenticated pilot/adoption gate; this score
must not be read as a public-launch percentage.

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
- Additive immutable `m2_workspace_revisions` persistence for rooms, variants,
  materials, budget frames and client handoff records. Commands are server-bound:
  room/variant/material/budget records are always `draft`; a handoff is always
  `submitted` and requires an already approved package.
- Role-gated `get_project_workspace_read_v3` projection. Financial fields
  (`m2BudgetFrames`, supplier references and unit costs) are restricted to
  owner/architect roles; all reads retain organization/project/package filters.
- Designer UI forms for the five expansion commands, with no client-provided
  approval status and with handoff disabled until human approval is visible.

## Evidence

The full repository test suite passes:

```text
73 files, 428 tests passed
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
AP1_DB_OK postgres=17.6 migrations=24 private_persistence_runtime_grants=0
executor_roles_guarded=true storage_bucket_private=true managed_auth_references=0
request_claim_readers=ok
```

Additive migration `20260802050000_projectceo_m2_constraint_compatibility.sql`
preserves the complete M1/M3/M4 command and audit unions and adds the M2 foreign
key indexes. Additive migration
`20260802060000_projectceo_m2_read_package_scope_fix.sql` qualifies package
columns in the project-wide read projection; before this fix, project-wide
reads returned null package IDs and the TypeScript safety parser correctly
filtered the M2 rows out of the UI. Both fixes replay cleanly on PostgreSQL 16
and 17.

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

The expansion RPC was exercised on the clean clone as the owner: an immutable
room revision was appended and appeared in `m2Rooms`. An outsider actor was
rejected with `PACKAGE_CAPABILITY_REQUIRED`; `anon` has no execute privilege on
the v3 read function. DB3/DB4 replay remained green after the capability preset
grew from 18/16 to 20/18.

The reproducible `tests/db4/30_m2_expansion_operations.sql` rehearsal then
completed the five-command sequence on the same clean clone:

```text
room → variant → material → budget → approved client handoff
state_revision: 29 → 34
DB4_M2_EXPANSION_OK
```

The role-gated projection returned all five owner records, while a temporary
client-approver session returned an empty budget array and no supplier/cost
material fields. The temporary membership was rolled back.

Authenticated desktop browser QA was extended to all five expansion forms on
the disposable owner session: room, variant, material, budget and client
handoff each completed and refreshed their immutable counters (2/2/2/2/2).
The browser console log remained empty. The earlier 390×844 rehearsal covers
the bounded Decision/Selection/Approval flow; a separate mobile expansion run
remains a gate item.

The production-shaped SQL snapshot separately proves that production has a
different public governed-M1 runtime: zero `projectceo_*` schemas and no
`project_intelligence` schema. Therefore local M2 persistence is not production
adoption evidence.

## What is not complete

- Mobile browser QA for the five new expansion forms has not yet been captured;
  the prior 390×844 evidence covers the bounded Decision/Selection/Approval
  flow, while desktop coverage now includes all five expansion forms.
- A richer selection catalog, multi-revision editing UX and client-facing
  handoff page are still outside this additive slice.
- Production `project_facts` lacks the canonical `provenance` field and does not
  contain the repository's Project Brain schemas/RPCs.
- Broad M2 AI/credits, image generation, CAD/render integrations and marketplace
  behavior remain outside the current gate and are not implemented.

## Remaining gate

1. Complete a 390×844 authenticated browser run for the five expansion forms,
   including financial masking for non-financial roles and the approved handoff
   precondition.
2. Keep production adoption as a separate controlled gate: production has zero
   Project Brain schemas and must not receive these migrations implicitly.

Until the broader workspace and production adoption gate are separately proven,
Module 2 must remain `PARTIAL`, not `READY`.
