# R1-10 — external attachment candidate and command integration

Scope: repository-only increment of MASTER R1-10. Base: main `3e79f74`.
This document does not close the full M3 external release work package.

## Implemented contract

`projectceo_product_api.attach_external_release_refs(uuid,uuid,text,text,jsonb,bigint,text)`
creates an immutable candidate for an existing published native handoff.
The command accepts project/package selectors, exact handoff IDs, typed refs,
the caller's expected state revision and an idempotency key. Actor, organization,
effective authority, reference identity and subject digest are derived by the server.

Six reference kinds resolve exact scoped versions: asset, representation,
documentation sheet, object representation binding, technical reference and
annotation. Direct and indirect sheet references must belong to the selected
handoff. Reference sorting and identity construction are deterministic; quotes
and JSON control-character escaping remain collision-free within a 2048-character
identity bound (maximum encoded sheet identity: 1957 characters).

Authorization uses the existing `prepare_client_handoff` package capability.
Replay follows fresh authorization and actor binding; the workflow row lock and
expected revision enforce CAS. Private tables use forced RLS and append-only
protection. The candidate RPC is default-denied to authenticated callers and
joins the existing M3 module switch. Opening M3 grants command execution;
closing it revokes execution. Private table access is never granted.

Application wiring uses the existing command contract/service, request-bound
Postgres adapter, action registry and M3 application gate. All seven SQL arguments
use their exact `p_*` names. The caller's expected revision is not replaced with
the revision returned by a navigation/scope lookup. The result is a candidate
submission ID, subject digest, status and ref count; it is not an approval.

The new frozen-manifest constraints bind a future 0.2 package version to its
manifest in the same transaction. The old 0.1 path remains separate and cannot
acquire an external sidecar after publication. No 0.2 publisher is added here.

## Allowlist

- `supabase/migrations/20260912110000_r1_external_release_attachment_manifest.sql`
- `tests/ap1/environment/migration-ledger.sha256`
- `tests/ap1/environment/enable-m3-publication.sql`
- `tests/ap1/commands/execution-guardrail.test.ts`
- `tests/ap5/01-authenticated-role-matrix.spec.ts`
- `tests/db4/05_m3_publication_guardrail.sql`
- `tests/db4/06_m3_surface_classification.sql`
- `tests/db4/10_schema_security.sql`, `tests/db4/run.zsh`
- `tests/db4/63_r1_external_release_attachment_resolver.sql`
- `tests/db4/64_r1_external_attachment_candidates.sql`
- `tests/layout-studio/integration/integration.test.ts`
- `lib/project-intelligence/adapters/postgres/project-brain.ts`
- `lib/project-intelligence/delivery/projectceo/command-contract.ts`
- `lib/project-intelligence/delivery/projectceo/command-service.ts`
- `lib/project-intelligence/delivery/projectceo/m3-surface.ts`
- `lib/project-intelligence/platform/action-registry.ts`
- `tests/projectceo-integration/r1-external-release-manifest.contract.test.ts`
- `tests/projectceo-integration/r1-external-release-refs-command.test.ts`
- `tests/projectceo-integration/m3-surface-matrix.test.ts`
- This evidence file.

## Verification

Independent SQL review found one encoded-identity length issue; the bound was
corrected and a native authoring/attach regression persists a 1957-character
identity. Restoring the previous bound reproduces the constraint failure.
Independent static review of the runtime wiring found no actionable findings.

The full suite also identified missing M3 surface classification. The correction
uses the established default-deny database module switch, preserving all existing
M3/M4 signatures, rather than growing the app-only closure residue. The M4 tripwire
enumerates actual top-level command schemas; nested reference kinds are not
commands. Its expected command count is 38 and the new command is explicitly M3.

Four AP5 cases exercise the new command through real authenticated HTTP sessions:
owner/architect must reach the RPC CAS rejection with the supplied mismatching
revision; builder/client must be forbidden. These cases perform no candidate
creation and do not replace the native handoff positive fixtures in DB4. Their
execution result must be taken from the current-head AP5 run, not static review.

Native handoff H2 is produced through the existing authenticated publication RPC
from Cycle 6's actual approved commit. Technical-reference and annotation controls
succeed for H1 and reject H2 with the exact scope/handoff error, without side
effects. Disabling either indirect guard makes its corresponding test fail.
These fixtures use synthetic actors/data and roll back; they do not create real
customer approvals or validate an external-only handoff.

Focused PG16 fixtures and 75 command/service/registry tests passed. Final local
lint (0 errors, 13 existing warnings), typecheck, the full test suite and Webpack
build passed. Full PG17 DB4 (including upgrades, concurrency and restart replay)
and PG16 DB5 passed after the final module-gate correction. Independent final
static review confirmed the corrected SQL, runtime and surface classifications.
GitHub CI/AP5 and Claude review are separate evidence classes. The owner's earlier
Claude exception covered only seven named merged PRs and does not cover this package.

## Remaining full R1-10 work

Candidate attachment does not supply typed client-design or architect-technical
decisions, subject-scoped replacement/revocation, scan/readiness proof, independent
release authorization, atomic root/work-package 0.2 publication, filtered delivery
or the product review UI. Those prerequisites must be implemented and verified;
ordinary native M2 approvals must not be treated as approval of external attachments.
The hash graph remains snapshot -> design/technical decisions -> release candidate
-> separate release authorization. No shared DB, production, deploy or flags were used.

## Explicit capability regression — 2026-09-13

Independent Claude review identified a difference from the stricter role predicates in two documentation-sheet RPCs. Canonical review resolved the intended boundary: MASTER §9 defines this operation as candidate composition; §10 separately preserves release-author checks. ADR-0004 §3 models workspaces as capability compositions, and Charter v0.5 §13 assigns contextual permissions. Existing project/package capability constraints permit explicit `prepare_client_handoff`; role presets are defaults rather than a veto on these rows. AP5's `designer` alias maps to the database `architect` role.

The original timestamped migration remains unchanged. Its comment comparing authority with sheet authoring means the shared capability, not identical additional role predicates. No new role restriction or new runtime grant was added. Candidate composition still grants no approval or publication authority.

Fixture64 now independently proves both project-wide and exact-package explicit capability access for the existing active client_approver identity, correct actor/scope, exact replay, tenant/sibling-package denial, and refusal of replay/new commands after revocation. Only two candidates are created, with zero approval/release effects. A savepoint rolls all setup and effects back before canonical role scenarios.

Independent fixture review PASS at SHA2564459b2b4ef90850dddd7371c76983086ef88bd130554278307b5da93047b3f49. Local PG16 and PG17 passed all47 ordered DB4 fixture files including this regression and subsequent workflows. Both exact owned containers were removed and absence verified. These tmpfs checks do not prove database restart; current-head CI/review must be recorded separately.
