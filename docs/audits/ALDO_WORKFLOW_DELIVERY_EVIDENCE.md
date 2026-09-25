# Aldo 01–07 — delivery evidence

Date: 2026-09-24 (Asia/Tashkent)

## Scope and evidence boundary

This document records ALDO-0 orientation for
`docs/execution/REMHAOS_ALDO_WORKFLOW_ADDITIONAL_TZ_2026-09-24.md`. It is not
an acceptance report for AW-01–AW-08 and does not authorize a production,
shared-environment, Drive, Pejeng, merge, deploy, or paid-provider action.

- **ИЗВЛЕЧЕНО:** checkout is
  `remhaos-architect-intake-20260923`, remote
  `https://github.com/parkourcafe/design-interior2026.07.git`, branch
  `codex/wp32-architect-intake-20260923`, HEAD
  `631b4c5d5a20158028d8ed031eae5f0b234d508d` at the time of orientation.
- **ИЗВЛЕЧЕНО:** `origin/main` is
  `737795d7aa6bae3b6020010c6a53b4757ed99a48`; this branch is not an ancestor
  of it. Integration is a separate future decision and review.
- **ИЗВЛЕЧЕНО:** pre-existing uncommitted files are the Aldo architecture and
  additional specification plus the architecture link; they were not changed
  by this orientation. The WP-32 native-M3 work was committed concurrently as
  `631b4c5`; its final working tree must be rechecked before any later edit.
- **ИЗВЛЕЧЕНО:** `git diff --check` passed before this document was added.
  Process ownership cannot be proven in this sandbox because its process-list
  read is denied; concurrent repository activity is evidenced by the new
  commit at 07:00 local time. Do not touch the WP-32 migration/API/test paths
  while their owner is active.
- **ИЗВЛЕЧЕНО:** the attached `Office - Workflow Aldo .pdf` has 15 pages.
  Its first two pages visibly show seven phases: client/architect phases 01–05
  and contractor-facing phases 06–07. Its durations and role percentages are
  source examples, not RemHaOS SLAs.

## Governing constraints

- **ИЗВЛЕЧЕНО:** the local `AGENTS.md` names the canonical Charter v0.5 and
  `REMHAOS_DECISION_LOG_v1.md` as higher authority than historical v0.4 text.
- **ИЗВЛЕЧЕНО:** DEC-039 opens M4 V2/V3 only in local/disposable AP1/AP6 via
  `REMHAOS_M4_V2_V3_ENABLED`; it does not open production adoption.
- **ИЗВЛЕЧЕНО:** WP-32 evidence reports local SQL and route-contract PASS for
  native M3 confirmation, while authenticated external package delivery,
  AP5, M4 field acceptance and production adoption remain open.
- **ИНТЕРПРЕТИРОВАНО:** AW-03 onward cannot be called runtime PASS until the
  relevant WP-32 authenticated contracts are proven in a disposable role
  matrix. Local UI/domain preparation remains permissible.

## Reuse matrix

| AW | Existing reusable contract | Current UI/API evidence | Missing work and runtime gate |
| --- | --- | --- | --- |
| AW-01 | Project/workspace reads, role/capability projection, M1 facts and approvals | `ProjectWorkspaceView` exposes technical stage only (`source_review`, `baseline`, `release`, `change`); workspace has overview/navigation | Add seven-phase projection with persisted result references, owner, dates, block reason, derived next action, revision history and N/A decision audit. No button may directly complete a phase. |
| AW-02 | Exact M2 variants, `submit_m2_client_review`, `review_m2_client_submission`, approval packages and idempotent commands | Client panel can select one of three variants and approve/reject/request changes, bound to layout revision | Add version discussion events distinct from view and decision, exact-version material/history surface, and authenticated revoke/expiry browser proof. Current panel is not a general comment thread. |
| AW-03 | M2→M3 exact handoff, documentation sheets, revision reasons, completeness findings, source conflict gate | Documentation tab registers sheets and shows M2-derived completeness | Add versioned apartment/room/discipline checklist, applicability reason/author, technical-content review, stale-on-document-revision and server release block. Existing completeness is narrower than a checklist. |
| AW-04 | Immutable release snapshot/semantic hash, release artifact worker, distribution and acknowledgement | Releases tab exposes version/hash and recipient acknowledgement | Add recipient-safe manifest/index/change log and verified downloadable released bytes. Prove assigned contractor receipt and separate acknowledgement for a replacement release using Auth/PostgREST/Storage. |
| AW-05 | RUB integer price observations and exact package/release identities | No contractor-offer entity, comparison projection or selection decision found | Add minimal versioned offer/revision/line/comparison/selection contract after reuse design. Preserve missing price, currency/tax comparability and human rationale. |
| AW-06 | Change request, bounded impact, photo evidence, milestone acceptance | Overview has photo and milestone controls when environment gate permits | Add applicable repair-stage route, dependencies, assigned roles and plan/fact evidence. Keep builder-completed distinct from authorised acceptance. |
| AW-07 | Source provenance, `create_change`, impact review, photo evidence and append-only audit | Changes tab creates a change; no field-issue/RFI journal found | Add scoped issue record with location, priority, due date, discussions and photo provenance. Route a design change into existing change/impact/release contracts. |
| AW-08 | Milestone acceptance, handover documents (`acceptance_act`, `warranty`, `manual`) and worker-built archive | Overview reports handover readiness and warranty-document count | Add defects/remediation and final-acceptance projection; prove actual archive build/read then revoke denial. Human finalization must remain separate from worker construction. |

## First implementation slice

**ИНТЕРПРЕТИРОВАНО:** ALDO-1 should begin with a pure domain projection and
tests for AW-01. It can be isolated under
`lib/project-intelligence/modules/` and tests, without altering the active
WP-32 migration, request route, command service, or existing UI contracts.

Before persistence/API/UI integration, the slice must specify each phase's
states, permitted transitions, required evidence, scope/authority, exact
result reference, idempotency, retry/restart behaviour, and audit record. The
AW-02 extension must then reuse the existing exact revision and approval
contracts rather than introduce a parallel approval engine.

## What has not been run

- **НЕ ПОДТВЕРЖДЕНО:** no new ALDO feature test, lint, typecheck, build,
  disposable database run, authenticated browser run, or independent review
  has been run by this orientation.
- **НЕ ПОДТВЕРЖДЕНО:** no real contractor offer, warranty document, external
  architect package content review, or commercial acceptance was used.
- **ИЗВЛЕЧЕНО:** this document uses source inspection, repository state,
  existing evidence, and a code-only Graphify extraction of 112
  `lib/project-intelligence` files (1,325 nodes / 3,597 extracted edges).
  Graph output is temporary at `/private/tmp/aldo-graph-out` and is not a
  product artifact.

## ALDO-1 foundation validation

- **ИЗВЛЕЧЕНО:** `lib/project-intelligence/modules/project-workflow/aldo-stages.ts`
  was added as a pure, no-I/O contract. It derives stage status from persisted
  result/evidence/approval facts and rejects an approval whose exact revision
  differs from the result. It does not yet persist a stage or expose a UI/API.
- **ИЗВЛЕЧЕНО:** `npm run test --
  lib/project-intelligence/modules/project-workflow/aldo-stages.test.ts` passed:
  1 file, 5 tests, 2026-09-24 07:02 Asia/Tashkent.
- **ИЗВЛЕЧЕНО:** `npm run lint` passed with 0 errors and 15 pre-existing
  warnings; `npm run typecheck` passed.
- **НЕ ПОДТВЕРЖДЕНО:** `npm run test` did not complete cleanly: 19 unrelated
  failures occurred in Integration Gateway AV sandbox suites because this
  environment denies child-process execution (`spawn EPERM`), and the frozen
  architecture test detected the pre-existing uncommitted change to
  `docs/product-intelligence/architecture-v1.md`.
- **НЕ ПОДТВЕРЖДЕНО:** `npm run build` stopped before compilation because it
  could not remove existing `.next/build/chunks` (`EPERM`). No cleanup was
  attempted, because the active owner of that generated directory is unknown.

## ALDO-1 additive persistence slice

- **ИЗВЛЕЧЕНО:** migration
  `20260924054328_projectceo_aldo_project_stage_revisions.sql` adds private,
  force-RLS append-only stage revisions and two authenticated RPC doors:
  project-wide read and owner/architect recording. Recording derives actor and
  organization server-side, locks workflow state, requires an idempotency key,
  and reuses the existing Foundation command/audit ledger.
- **ИЗВЛЕЧЕНО:** after this addition, focused stage tests passed (5/5),
  `git diff --check` passed, and `npm run typecheck` passed.
- **НЕ ПОДТВЕРЖДЕНО:** `SUPABASE_TELEMETRY_DISABLED=1 supabase migration list
  --local` could not connect to local Postgres (`LegacyDbConnectError`). The
  migration has not been applied, DB4-tested, or authenticated-browser-tested.
