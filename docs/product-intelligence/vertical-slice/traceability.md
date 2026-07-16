# Traceability matrix

Status meanings:

- `passed` — standalone validator executes the assertion now;
- `contract_ready` — API/UI semantics and expected fixture exist, but no adapter is connected;
- `deferred` — requires persistence, RLS, job store or renderer; it is not treated as passing.

## Source and provenance acceptance

| ID | Acceptance criterion | API operation | UI state | Fixture | Expected assertion | Maturity | Status |
|---|---|---|---|---|---|---|---|
| VS-SRC-001 | Same bytes/checksum do not create a second Source in one project | create/complete source | `uploading`, `processing` | `sources.json`, manifest | checksum and `dedupeScope=project` are stable; persistence must return existing Source | L2 deferred | deferred |
| VS-SRC-002 | Same idempotency key + same payload replays result; changed payload conflicts | every mutating operation | state remains unchanged on replay | `invalid-cases/idempotency-conflict.json` | expected `IDEMPOTENCY_CONFLICT` for different request digest | L0 executable now | passed |
| VS-SRC-003 | Every AI extracted/interpreted claim has evidence and clickable locator | list review queue | `review_pending` | `fragments.json`, `graph-v1.json`, `graph-v2.json` | every AI-origin non-unknown revision has EvidenceLink; fragment locator is non-empty | L0 executable now | passed |
| VS-SRC-004 | Unavailable fragment cannot be silently confirmed | review revision | `review_pending` | `invalid-cases/unavailable-fragment.json` | missing acknowledgement yields `EVIDENCE_ACK_REQUIRED` | L0 executable now | passed |
| VS-SRC-005 | UI requires explicit warning acknowledgement with reason | review revision | `review_pending` | unavailable-fragment contract | side-by-side state blocks confirm until acknowledgement; server adapter must enforce | L1 contract ready | contract_ready |
| VS-SRC-006 | AI/system cannot execute human-review action | review revision | `review_pending` | `invalid-cases/ai-human-confirmation.json` | non-human review actor yields `AI_HUMAN_REVIEW_FORBIDDEN`; AI content origin itself remains valid | L0 executable now | passed |
| VS-SRC-007 | Unknown claim has an explicit reason | review queue/extraction result | `processing_partial`, `review_pending` | `invalid-cases/unknown-without-reason.json` | empty unknown reason yields `UNKNOWN_REASON_REQUIRED` | L0 executable now | passed |
| VS-SRC-008 | Extraction failure preserves controlled status without raw document in logs | complete/process source | `processing_failed` | use-case/API/events contract | controlled error only; runtime logging adapter required | L1 contract ready | contract_ready |

## Versions and diff acceptance

| ID | Acceptance criterion | API operation | UI state | Fixture | Expected assertion | Maturity | Status |
|---|---|---|---|---|---|---|---|
| VS-VER-001 | Published V1 is not mutated while V2 is derived | publish/revise decision | `v1_published`, `v2_draft` | `graph-v1.json`, `graph-v2.json` | validator snapshots V1 before diff and verifies unchanged content; r1 remains in V2 history | L0 executable now | passed |
| VS-VER-002 | Persistence rejects in-place update/delete of published version/revision | publish version | `v1_published`, `v2_ready` | version contract | DB constraints/repositories and regression tests required | L2 deferred | deferred |
| VS-VER-003 | Editing confirmed decision keeps stable node and creates new revision/draft | revise decision | `decision_editing`, `v2_draft` | graph V1/V2 | stable node ID identical; r2 replaces r1; V2 base is V1 | L0 executable now | passed |
| VS-VER-004 | Confirmed-decision change requires reason | revise decision | `decision_editing` | `invalid-cases/missing-change-reason.json` | blank reason yields `CHANGE_REASON_REQUIRED` | L0 executable now | passed |
| VS-VER-005 | No semantic change does not create V2 | revise decision/publish | `decision_editing`, `v2_draft` | use-case/API contract | `INVALID_TRANSITION/NO_SEMANTIC_CHANGE`; application adapter required | L1 contract ready | contract_ready |
| VS-VER-006 | Diff contains old/new revision, actor, timestamp and reason | read diff via version/change-set projections | `v2_draft`, `impact_pending` | `expected-diff.json` | one changed decision, r1→r2, `/material`; ChangeSet contains human role/time/reason | L0 executable now | passed |
| VS-VER-007 | Rollback creates a later version instead of rewriting history | publish version | `v2_ready` | API/use-case contract | rollback command selects prior payload into V3 with base V2; adapter/persistence test required | L1 contract ready | contract_ready |
| VS-VER-008 | Version numbers are unique/monotonic per project | publish version | `v1_published`, `v2_ready` | graph V1/V2 | fixture asserts 1→2; atomic allocation requires persistence | L2 deferred | deferred |
| VS-VER-009 | Stale review cannot apply to a newer revision | review revision | `review_pending` | `invalid-cases/stale-review.json` | expected r1 vs current r2 yields `REVISION_STALE` | L0 executable now | passed |

## Change-impact acceptance

| ID | Acceptance criterion | API operation | UI state | Fixture | Expected assertion | Maturity | Status |
|---|---|---|---|---|---|---|---|
| VS-IMP-001 | Same graph/version pair produces identical impacts | calculate/read impacts | `impact_pending`, `impact_review` | `graph-v2.json`, `expected-impacts.json` | normal and reversed input ordering produce identical ordered result | L0 executable now | passed |
| VS-IMP-002 | Every impact has changed/impacted node and full path | read impacts | `impact_review` | `expected-impacts.json` | distance, nodePath and edgePath continuity match stored V2 edges | L0 executable now | passed |
| VS-IMP-003 | Non-propagating edge does not create impact | calculate impacts | `impact_review` | graph V2 + expected excluded signal | risk through `conflicts_with` is absent from impacts | L0 executable now | passed |
| VS-IMP-004 | Cycle terminates without duplicate/self impact | calculate impacts | `impact_pending` | `invalid-cases/cycle.json` | visited nodes ≤3; outputs Item and Deliverable once; changed root excluded | L0 executable now | passed |
| VS-IMP-005 | Cross-project edge is rejected before traversal | calculate impacts / graph command | error boundary before `impact_review` | `invalid-cases/cross-project-edge.json` | expected `PROJECT_SCOPE_VIOLATION` | L0 executable now | passed |
| VS-IMP-006 | Database/API prevents cross-project/organization references | graph persistence/application service | hidden `404` or controlled error | cross-project fixture | RLS/FK/transaction tests required | L2 deferred | deferred |
| VS-IMP-007 | User can accept/resolve/not-applicable and audit disposition | review impact | `impact_review`, `v2_ready` | `expected-impacts.json`, handoff | fixture has human reviewed dispositions; API/audit adapter required | L1 contract ready | contract_ready |
| VS-IMP-008 | Missing dependency found by human is explicit, not hidden | review impact + future graph-edge command | `impact_review` | use-case/API/events contract | `missing_added` records audit and follow-up; does not rewrite original impact run | L1 contract ready | contract_ready |
| VS-IMP-009 | Impact run is persisted/idempotent per change set | calculate impacts | `impact_pending` | expected impacts IDs/version pair | result digest and unique store constraints required | L2 deferred | deferred |

## Export acceptance

| ID | Acceptance criterion | API operation | UI state | Fixture | Expected assertion | Maturity | Status |
|---|---|---|---|---|---|---|---|
| VS-EXP-001 | Export identifies project and exact version | request/read export | `export_queued`, `export_ready` | `expected-handoff.json` | logical content pins project, V2 and base V1 | L0 executable now | passed |
| VS-EXP-002 | Claims include source references/locators | read export | `export_ready` | expected handoff + fragments | every handoff source reference resolves to fixture source/fragment; no signed URL | L0 executable now | passed |
| VS-EXP-003 | Unresolved impacts are explicit | read export | `v2_ready`, `export_ready` | expected handoff/impacts | accepted Item/Budget are unresolved; Finish Schedule is resolved; all impact IDs accounted for | L0 executable now | passed |
| VS-EXP-004 | Repeat render has same semantic content hash | request export | `export_queued`, `export_ready` | `expected-handoff.json` | canonical logical content SHA-256 repeats exactly; volatile fields excluded | L0 executable now | passed |
| VS-EXP-005 | Same export key reuses job; different key may create new render with same hash | request export | `export_queued` | idempotency contract | durable job/idempotency store tests required | L2 deferred | deferred |
| VS-EXP-006 | Tenant branding/locale do not alter canonical values or leak across organization | request/read export | `export_ready` | canonical/display metadata in handoff | logical separation specified; tenant isolation/renderer test required | L2 deferred | deferred |

## P0 UI surface traceability

| ID | Surface requirement | API operation | UI state | Fixture/contract | Expected assertion | Maturity | Status |
|---|---|---|---|---|---|---|---|
| VS-UI-001 | Source list and ingestion status | create/complete source | source states | sources fixture + UI table | empty/uploading/processing/partial/failed paths defined | L1 contract ready | contract_ready |
| VS-UI-002 | Fragment and claim side-by-side with Confirm/Reject/Edit | queue/review | `review_pending` | fragments/graph + UI contract | IDs, locator availability and stale behavior defined | L1 contract ready | contract_ready |
| VS-UI-003 | Graph table by area/node kind | version/read projection | `v1_published`, `v2_ready` | graphs V1/V2 | table fields defined; graph canvas explicitly excluded | L1 contract ready | contract_ready |
| VS-UI-004 | Version diff | diff projection | `v2_draft`, `impact_pending` | expected diff | `/material`, revision IDs and ChangeSet enrichment shown separately | L1 contract ready | contract_ready |
| VS-UI-005 | Impact list with dependency path | read/review impact | `impact_review` | expected impacts | exact edge/node path and disposition state defined | L1 contract ready | contract_ready |
| VS-UI-006 | Export action and history | request/read export | export states | expected handoff + API/UI contract | exact version/hash/status/history semantics defined | L1 contract ready | contract_ready |

## Coverage statement

Every acceptance bullet in `vertical-slice-spec.md` is represented above. L0 covers logical fixture/domain assertions only. Version immutability enforcement, durable idempotency, RLS, audit persistence and real render behavior remain explicitly L2.
