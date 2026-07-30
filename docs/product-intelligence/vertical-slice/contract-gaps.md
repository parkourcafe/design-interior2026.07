# Contract gaps and assumptions

Этот файл не изменяет public domain contract. Он сообщает Integrator, где standalone fixture semantics требуют adapter или решения владельца другого bounded module.

## Resolved inside Agent 3 scope

### CG-001 — Semantic fixture identity and ordering

- Classification: `resolved`.
- Decision: fixed readable IDs/timestamps/checksums; deterministic lexical/default ordering; impact order = changed root, distance, impacted node.
- Evidence: `manifest.json`, standalone validator.

### CG-002 — Handoff semantic hash

- Classification: `resolved`.
- Decision: SHA-256 of UTF-8 canonical `logicalContent`; object keys recursively sorted; contract arrays preserve defined order.
- Excluded: artifact ID, generation timestamp, job status.
- Evidence: `expected-handoff.json`, validator repeated-hash assertion.

### CG-003 — V1→V2 semantic change

- Classification: `resolved` for fixture.
- Decision: one stable decision node; r2 replaces r1; payload changes only `/material`; Item/Deliverables remain unchanged and appear as impacts.

### CG-004 — Accepted impact resolution meaning

- Classification: `resolved` for this contract.
- Decision: `accepted` means reviewer acknowledges downstream update is required and therefore remains unresolved. Terminal resolved states are `resolved` and `not_applicable`.

## Assumed application semantics

### CG-005 — Content origin vs review actor/target revision

- Classification: `assumed`; integration-blocking if Agent 2 contract cannot express it.
- Required semantics: AI-origin revision may become human-confirmed when a separate human review targets that exact revision. `contentOrigin="ai"` is retained. Forbidden condition is a non-human actor performing human review.
- Forbidden workaround: rewrite origin to `human` merely to pass an invariant.
- Fixture representation: revision contains content origin/status; `reviews[]` contains human actor, action, target/result revision and server time.
- Owner: Agent 2/Integrator mapping to frozen domain contract.

### CG-006 — Review-only transition and content diff

- Classification: `assumed`.
- Decision: review status/approval change with identical payload is audit/review state, not semantic content diff. A new content revision created by Edit participates in diff only when payload changes.
- Consequence: publishing a reviewed snapshot can change version membership without creating a `/payload` change.
- Owner: Integrator must keep review/audit projection separate from pure `NodeVersionChange`.

### CG-007 — No semantic change

- Classification: `assumed`, L1.
- Decision: canonical-equal payload returns `INVALID_TRANSITION` + `NO_SEMANTIC_CHANGE`; no revision, ChangeSet or version is created.
- Owner: application service.

### CG-008 — Rollback

- Classification: `assumed`, L1.
- Decision: rollback selects earlier logical payloads into a new latest version (for example V3 based on V2); no version/revision is mutated or deleted.
- Owner: versions application service.

## Deferred adapters/persistence

### CG-009 — ChangeSet enrichment over pure diff

- Classification: `deferred`, L1 adapter/L2 persistence.
- Pure diff fields: node ID, change type, from/to revision IDs, JSON Pointer paths.
- ChangeSet/audit fields: from/to version IDs, actor role, server timestamp, reason code/text.
- Fixture stores them separately in `expected-diff.json`; adapter must not extend/guess Agent 2 type silently.

### CG-010 — Persisted impact identity and lifecycle

- Classification: `deferred`, L1 adapter/L2 persistence.
- Pure impact: changed/impacted nodes, distance, node/edge paths.
- Persisted wrapper: impact ID, change-set/version pair, initial status, review status/actor/time/reason.
- Fixture mapping: `expected-impacts.json`.

### CG-011 — Edges active for exact target version

- Classification: `deferred`, L1 adapter/L2 persistence.
- Fixture edges contain `validFromVersionId`/`validToVersionId` and are active in V2.
- Integrator must project only version-active edges before invoking pure impact; current graph edges may not be substituted for historical versions.

### CG-012 — Unavailable evidence acknowledgement

- Classification: `deferred`, L1/L2.
- Required: explicit acknowledgement code + non-empty protected reason, human actor/server time and immutable audit event.
- Without it: `EVIDENCE_ACK_REQUIRED`.
- Persistence schema/table shape is intentionally unspecified.

### CG-013 — Idempotency storage

- Classification: `deferred`, L2.
- Stable semantics: operation-scoped key + server canonical request digest; same digest replays original result; different digest gives `IDEMPOTENCY_CONFLICT`.
- Unknown by design: table/queue/provider implementation, retention duration and partitioning.

### CG-014 — Source checksum dedupe

- Classification: `deferred`, L2.
- Stable semantics: same checksum dedupes within a project, not globally across tenants/projects.
- Unknown by design: database index shape, storage multipart protocol and retention policy.

### CG-015 — API source/upload transport

- Classification: `deferred`, Integrator/runtime.
- Proposed contract uses an opaque upload handle. Actual signed upload mechanism is deployment-specific and must never be logged or persisted in fixtures.

### CG-016 — Export renderer and access grant

- Classification: `deferred`, L2.
- Logical content/hash is fixed. PDF/HTML renderer, artifact storage, tenant branding and expiring access grant are not selected here.

## Blocking for cross-contract Gate I4, not for standalone Agent 3 validation

### CG-017 — Domain contract freeze

- Classification: `blocking for Integrator I4` until Agent 2 reports `domain_contract_ready=true`.
- Agent 3 validator intentionally does not import `lib/project-intelligence` during parallel work.
- Integrator must map:
  - `contentOrigin` to the frozen origin field;
  - separate review target/actor to frozen review contract;
  - V1/V2 selected revisions to `ProjectVersionSnapshot`;
  - fixture edge fields to version-effective `ProjectGraph`;
  - expected pure diff/impact subsets to Agent 2 functions.

If the frozen contract cannot preserve CG-005 without changing AI origin, Integrator must stop and route a change request to Agent 2. Expected fixture semantics must not be silently altered.

### CG-018 — Frozen-candidate adapter mapping observed during handoff

- Classification: `contract-ready`, Integrator-owned.
- Observed candidate: Agent 2 `ProjectGraphSnapshot` separates stable nodes, immutable revisions and `HumanReview`; revision stores only `extracted|interpreted|unknown`, while effective human status is derived from review.
- Agent 3 fixtures are application-level snapshots. Their `revision.claimStatus="human_confirmed"` denotes the effective display/application status, not the value to copy into Agent 2 `GraphNodeRevision.claimStatus`.

Required deterministic mapping:

| Agent 3 fixture | Agent 2 frozen candidate |
|---|---|
| `graph.version.id` | top-level `ProjectGraphSnapshot.versionId` |
| `sources[].sourceKind` | `ProjectSource.kind` |
| `revisions[].contentOrigin` | `GraphNodeRevision.origin` |
| AI decision/requirement r1 effective `human_confirmed` | revision `claimStatus="extracted"` plus separate `HumanReview decision="confirmed"` |
| AI risk r1 `interpreted` | revision `claimStatus="interpreted"`, no human review required |
| human decision r2 effective `human_confirmed` | revision `origin="human"`, `claimStatus="interpreted"`, plus `HumanReview decision="confirmed"` targeting r2 |
| fixture review `action="confirm"` | domain review `decision="confirmed"` |
| fixture review `action="edit"`, target r1/result r2 | immutable r2 + domain confirmation targeting r2; edit lineage/reason remains application audit/ChangeSet |
| null `replacesRevisionId` | omit optional field |
| versioned edge fields | filter active edges for target version, then omit validity wrapper from pure edge |
| expected changed decision | Agent 2 change plus `impactRelevant=true` |

Typed locator mapping:

| Fixture fragment | Agent 2 locator |
|---|---|
| PDF `{page,bbox}` | `{kind:"pdf",page,bbox}` |
| transcript `{startMs,endMs,speaker}` | `{kind:"transcript",startMs,endMs,speaker}` |
| questionnaire `{jsonPointer,questionKey}` | pure fallback `{kind:"plain_text",startCharacter:61,endCharacter:89}` over the fixed UTF-8 fixture representation; application view retains structured locator |

Ordering note: fixture IDs are ASCII, so standalone lexical ordering equals Agent 2 Unicode code-point ordering. Integrator must use Agent 2 comparator for the adapter/output, not `localeCompare`.

Error mapping:

| Fixture/application expectation | Agent 2 pure code or layer |
|---|---|
| `AI_CLAIM_MISSING_EVIDENCE` | `ai_claim_missing_evidence` |
| `AI_HUMAN_REVIEW_FORBIDDEN` | `review_actor_not_human` |
| `UNKNOWN_REASON_REQUIRED` | `unknown_missing_reason` |
| `PROJECT_SCOPE_VIOLATION` | `project_mismatch` or application scope guard |
| `REVISION_STALE` | `review_target_stale` mapped to API code |
| `EVIDENCE_ACK_REQUIRED` | application layer only |
| `CHANGE_REASON_REQUIRED` | application layer only |
| `IDEMPOTENCY_CONFLICT` | application/persistence layer only |

This mapping requires no Agent 2/public contract change and therefore does not create a `CHANGE_REQUEST.md`.

## Non-blocking unknowns

- Exact HTTP route names: proposed, Integrator may rename while preserving semantics/error codes.
- SQL table/constraint/RLS shape: unknown and outside Agent 3 scope.
- Queue/job provider and retry backoff: unknown.
- Final visual/brand design: unknown.
- First commercial Studio/Renovation build-track: intentionally not selected.

## Change-request decision

No runtime/common file change is requested by this package. `CHANGE_REQUEST.md` is required only if Agent 2 freeze fails CG-005 or Integrator needs to alter a common baseline. Until then the gap is fully documented and no cross-owner file is modified.
