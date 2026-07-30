# Proposed API contract

Статус: **proposal**, route names может изменить Integrator. Semantics, concurrency, idempotency и stable error codes сохраняются.

## Common rules

- Все routes требуют authenticated project membership. Actor ID, actor role, organization и region выводятся сервером; client не передаёт их как доверенные поля.
- Недоступный или чужой project/source/revision/version/impact/export возвращает `404`, чтобы не раскрывать существование ресурса.
- Все mutating operations требуют HTTP header `Idempotency-Key`. Scope ключа: `(organization, project, operation)`; request digest вычисляет сервер по canonical command.
- Повтор того же key/digest возвращает первоначальный status/result с `idempotentReplay=true`. Тот же key с другим digest возвращает `409 IDEMPOTENCY_CONFLICT`.
- Human commands используют expected revision/version/status. Конфликт возвращает `409 REVISION_STALE` либо `409 VERSION_STALE`; действие не переносится автоматически.
- Server timestamp возвращается в response/audit, но отсутствует в command body.
- Raw source bytes/text, full filenames, excerpts, free-text reasons, signed upload descriptors и provider payload запрещены в structured logs и analytics.
- Error envelope содержит только controlled fields:

```json
{
  "error": {
    "code": "REVISION_STALE",
    "message": "The selected revision is no longer current.",
    "requestId": "request-synthetic-001",
    "retryable": false,
    "details": {
      "currentRevisionId": "revision-decision-worktop-material-r2"
    }
  }
}
```

`message` не является stable API. `code` и controlled `details` являются stable.

## Role vocabulary

| Role | Capabilities in this slice |
|---|---|
| `designer` | upload/process, review claims, publish versions, revise decisions, review impacts, export |
| `client` | read authorized project, review/modify decisions allowed by project policy, publish only when policy grants approval capability |
| `executor` | read explicitly shared published version/handoff; no mutation in this slice |
| `system` | ingestion/extraction/impact/export worker through server credentials; cannot perform human review |

Client-side role strings never grant access.

## Operation summary

| Operation | Proposed route | Idempotent mutation | Optimistic field |
|---|---|---:|---|
| Create source upload | `POST /api/projects/{projectId}/sources` | yes | none; project access checked |
| Complete/process source | `POST /api/projects/{projectId}/sources/{sourceId}/complete` | yes | `expectedIngestionStatus` |
| List review queue | `GET /api/projects/{projectId}/review-queue` | n/a | response `currentRevisionId` |
| Review revision | `POST /api/projects/{projectId}/revisions/{revisionId}/review` | yes | `expectedRevisionId` |
| Publish version | `POST /api/projects/{projectId}/versions` | yes | `expectedLatestVersionId` + selected revisions |
| Revise decision | `POST /api/projects/{projectId}/decisions/{nodeId}/revisions` | yes | `baseVersionId` + `expectedRevisionId` |
| Calculate impacts | `POST /api/projects/{projectId}/change-sets/{changeSetId}/impact-runs` | yes | `fromVersionId` + `toVersionId` |
| Read impacts | `GET /api/projects/{projectId}/change-sets/{changeSetId}/impacts` | n/a | immutable run ID in response |
| Review impact | `POST /api/projects/{projectId}/change-sets/{changeSetId}/impacts/{impactId}/review` | yes | `expectedImpactStatus` |
| Request export | `POST /api/projects/{projectId}/exports` | yes | `versionId` + `impactRunId` |
| Read export | `GET /api/projects/{projectId}/exports/{exportId}` | n/a | immutable IDs in response |

## 1. Create source upload

**Method/route:** `POST /api/projects/{projectId}/sources`
**Roles:** `designer`; `client` only when project policy allows source contribution.

Request:

```json
{
  "sourceKind": "transcript",
  "mediaType": "text/plain",
  "originalName": "synthetic-client-call.txt",
  "declaredByteLength": 96
}
```

Response `201`:

```json
{
  "sourceId": "source-transcript-001",
  "projectId": "project-kitchen-001",
  "ingestionStatus": "uploading",
  "upload": {
    "opaqueUploadHandle": "redacted-from-logs",
    "expiresAt": "2026-07-16T00:10:00.000Z"
  },
  "idempotentReplay": false
}
```

- Idempotency: required; same key returns same `sourceId`/upload intent.
- Concurrency: source does not yet exist; server enforces one idempotent operation record.
- Status: `201`, replay `200`; `401`, hidden `404`, `413`, `415`, `409 IDEMPOTENCY_CONFLICT`, `422 INVALID_TRANSITION`.
- Audit: `source_upload_created`; analytics is emitted only after accepted bytes (`source_uploaded`).
- Logging: `sourceKind`, media type and size bucket allowed; original name and upload handle forbidden.

## 2. Complete/process source

**Method/route:** `POST /api/projects/{projectId}/sources/{sourceId}/complete`
**Roles:** initiating `designer/client`, or authenticated `system` worker for processing transition.

Request:

```json
{
  "expectedIngestionStatus": "uploading",
  "uploadHandle": "opaque-value-not-logged"
}
```

Accepted response `202`:

```json
{
  "sourceId": "source-transcript-001",
  "ingestionStatus": "processing",
  "processingAttemptId": "source-transcript-001-attempt-1",
  "idempotentReplay": false
}
```

Terminal read model contains `checksum`, `fragmentCount`, `ready|processing_partial|processing_failed`, and controlled `errorCode`; raw provider response is absent.

- Idempotency: required per completion attempt.
- Concurrency: `expectedIngestionStatus`; invalid transition returns `409 INVALID_TRANSITION`.
- Status: `202`, replay `200`; `401`, hidden `404`, `409 IDEMPOTENCY_CONFLICT`, `409 INVALID_TRANSITION`, `422 PROJECT_SCOPE_VIOLATION`.
- Audit: `source_processing_started`, then exactly one terminal `source_processing_completed|failed` per attempt.
- Logging: checksum and controlled duration/status allowed; upload handle, raw content/excerpts and filename forbidden.

## 3. List review queue

**Method/route:** `GET /api/projects/{projectId}/review-queue?state=pending&cursor=…`
**Roles:** `designer`; authorized `client` for project policy-approved decision types.

Response `200`:

```json
{
  "items": [
    {
      "nodeId": "decision-worktop-material",
      "currentRevisionId": "revision-decision-worktop-material-r1",
      "nodeKind": "decision",
      "contentOrigin": "ai",
      "claimStatus": "extracted",
      "title": "Use natural stone for the kitchen worktop",
      "payload": {
        "areaId": "area-kitchen",
        "material": "natural_stone",
        "subject": "kitchen_worktop"
      },
      "evidence": [
        {
          "sourceId": "source-transcript-001",
          "fragmentId": "fragment-transcript-decision",
          "available": true,
          "locator": { "startMs": 0, "endMs": 9600, "speaker": "client" },
          "excerpt": "Use natural stone for the kitchen worktop."
        }
      ]
    }
  ],
  "nextCursor": null
}
```

- Idempotency: n/a; read is side-effect free.
- Concurrency: response `currentRevisionId` must be echoed by the review command.
- Status: `200`, `401`, hidden `404`.
- Audit: no immutable audit for passive read; controlled product event `review_queue_viewed` may be sampled without content.
- Logging: node kind/count allowed; title/payload/excerpt/locator details forbidden.

## 4. Review revision

**Method/route:** `POST /api/projects/{projectId}/revisions/{revisionId}/review`
**Roles:** authenticated human `designer` or policy-authorized `client`. `system/ai` forbidden.

Request:

```json
{
  "action": "confirm",
  "expectedRevisionId": "revision-decision-worktop-material-r1",
  "editedPayload": null,
  "reasonCode": null,
  "evidenceAcknowledgement": null
}
```

For unavailable evidence, acknowledgement is explicit:

```json
{
  "code": "fragment_unavailable",
  "reason": "Confirmed from the original meeting notes available to the reviewer."
}
```

Response `200` for confirm/reject or `201` for edit-created revision includes `reviewId`, `targetRevisionId`, `resultingRevisionId`, `outcome`, server-derived actor role and `reviewedAt`.

- Idempotency: required.
- Concurrency: path revision and `expectedRevisionId` must both equal current revision; otherwise `409 REVISION_STALE`.
- Status: `200/201`; `401`, hidden `404`, `409 REVISION_STALE`, `409 IDEMPOTENCY_CONFLICT`, `422 EVIDENCE_ACK_REQUIRED`, `422 INVALID_TRANSITION`, `422 PROJECT_SCOPE_VIOLATION`.
- Audit: `claim_review_confirmed|rejected|edited`; separate `evidence_unavailable_acknowledged` when used.
- Logging: outcome/node kind allowed; payload, excerpt, free-text reason, actor contact forbidden.

## 5. Publish project version

**Method/route:** `POST /api/projects/{projectId}/versions`
**Roles:** `designer`; `client` only with server-side approval capability.

Request:

```json
{
  "baseVersionId": "version-kitchen-001-v1",
  "expectedLatestVersionId": "version-kitchen-001-v1",
  "label": "Kitchen baseline after worktop material change",
  "selectedRevisions": [
    { "nodeId": "decision-worktop-material", "revisionId": "revision-decision-worktop-material-r2" }
  ]
}
```

For V1, `baseVersionId` and `expectedLatestVersionId` are `null`; complete selected revision set may be server-derived from the draft.

Response `201` includes immutable `versionId`, monotonic `versionNo`, base version, selected revision IDs, `publishedAt` and server-derived publisher role.

- Idempotency: required.
- Concurrency: latest version and every selected current revision checked atomically.
- Status: `201`, replay `200`; `401`, hidden `404`, `409 VERSION_STALE`, `409 REVISION_STALE`, `409 IDEMPOTENCY_CONFLICT`, `422 INVALID_TRANSITION`, `422 PROJECT_SCOPE_VIOLATION`.
- Audit: `project_version_published` with before/base IDs and selected revision count.
- Logging: version IDs/count/label code allowed; node payloads and free-text label forbidden from analytics.

Published version has no update/delete operation in this contract. Rollback creates a new version with `baseVersionId` pointing to current latest and selected payloads matching an earlier snapshot.

## 6. Revise confirmed decision

**Method/route:** `POST /api/projects/{projectId}/decisions/{nodeId}/revisions`
**Roles:** `designer`; policy-authorized `client`.

Request:

```json
{
  "baseVersionId": "version-kitchen-001-v1",
  "expectedRevisionId": "revision-decision-worktop-material-r1",
  "payload": {
    "areaId": "area-kitchen",
    "material": "quartz_composite",
    "subject": "kitchen_worktop"
  },
  "reasonCode": "schedule_constraint",
  "reason": "Natural stone lead time exceeds the approved project schedule."
}
```

Response `201` includes same stable `nodeId`, new immutable `revisionId`, `replacesRevisionId`, draft version ID and ChangeSet ID.

- Idempotency: required.
- Concurrency: base version must remain current base and `expectedRevisionId` current; stale returns `409`.
- Status: `201`, replay `200`; `401`, hidden `404`, `409 REVISION_STALE`, `409 VERSION_STALE`, `409 IDEMPOTENCY_CONFLICT`, `422 CHANGE_REASON_REQUIRED`, `422 INVALID_TRANSITION` with `NO_SEMANTIC_CHANGE`, `422 PROJECT_SCOPE_VIOLATION`.
- Audit: `decision_changed` containing IDs, reason code and changed-field count; free-text reason remains audit-only.
- Logging: IDs/reason code/count allowed; payload and reason text forbidden.

## 7. Calculate impacts

**Method/route:** `POST /api/projects/{projectId}/change-sets/{changeSetId}/impact-runs`
**Roles:** `designer/client` allowed to trigger; deterministic `system` worker performs calculation.

Request:

```json
{
  "fromVersionId": "version-kitchen-001-v1",
  "toVersionId": "version-kitchen-001-v2"
}
```

Client must not send changed-node IDs, graph nodes or edges. Server derives diff and loads edges active for the exact target version.

Response `201` includes `impactRunId`, version pair, changed node count, impact count, max distance and a stable result digest.

- Idempotency: required, scoped to change set/version pair/graph snapshot.
- Concurrency: supplied version pair must equal immutable ChangeSet pair; otherwise `422 INVALID_TRANSITION`.
- Status: `201`, replay `200`; `401`, hidden `404`, `409 IDEMPOTENCY_CONFLICT`, `422 PROJECT_SCOPE_VIOLATION`, `422 INVALID_TRANSITION`.
- Audit: `impact_set_calculated` with policy version, result digest and counts.
- Logging: counts/distance/digest allowed; node titles/payloads/paths forbidden.

## 8. Read impacts

**Method/route:** `GET /api/projects/{projectId}/change-sets/{changeSetId}/impacts?runId=…`
**Roles:** authorized project members; executor only if the version is explicitly shared.

Response includes changed/impacted node IDs, distance, full ordered `nodePath`, ordered `edgePath`, status, reviewed metadata and immutable run/version pair.

- Idempotency: n/a.
- Concurrency: client reviews the returned `impactId` + `status` using optimistic status.
- Status: `200`, `401`, hidden `404`.
- Audit: passive read not audited; `impact_list_viewed` may be product analytics without path content.
- Logging: impact count/status allowed; path/node content forbidden.

## 9. Review impact

**Method/route:** `POST /api/projects/{projectId}/change-sets/{changeSetId}/impacts/{impactId}/review`
**Roles:** `designer`; policy-authorized `client`.

Request:

```json
{
  "expectedImpactStatus": "needs_review",
  "disposition": "resolved",
  "reasonCode": "schedule_updated",
  "missingImpactedNodeId": null,
  "reason": null
}
```

Allowed dispositions: `accepted`, `resolved`, `not_applicable`, `missing_added`. `missing_added` requires an authorized candidate node/reference and reason; it does not silently mutate the original impact run.

Response `200` includes new status, review ID, server actor role/time and optional follow-up graph-edge command reference.

- Idempotency: required.
- Concurrency: `expectedImpactStatus`; stale returns `409 INVALID_TRANSITION` with current status.
- Status: `200`; `401`, hidden `404`, `409 IDEMPOTENCY_CONFLICT`, `409 INVALID_TRANSITION`, `422 PROJECT_SCOPE_VIOLATION`.
- Audit: `impact_reviewed`; `missing_added` additionally records `impact_missing_dependency_reported`.
- Logging: disposition/reason code allowed; free text, node titles and path content forbidden.

## 10. Request export

**Method/route:** `POST /api/projects/{projectId}/exports`
**Roles:** `designer`; authorized `client`; `executor` only for explicitly shared immutable version.

Request:

```json
{
  "versionId": "version-kitchen-001-v2",
  "impactRunId": "impact-run-kitchen-v1-v2-001",
  "format": "logical_json",
  "locale": "en-US"
}
```

Canonical values come from project/version; locale controls presentation only. Response `202` includes export ID, status, version ID, impact snapshot ID and format.

- Idempotency: required.
- Concurrency: immutable `versionId` + immutable impact run; no current-version alias accepted.
- Status: `202`, replay `200`; `401`, hidden `404`, `409 IDEMPOTENCY_CONFLICT`, `422 INVALID_TRANSITION`, `422 PROJECT_SCOPE_VIOLATION`.
- Audit: `handoff_generation_requested`; terminal audit on ready/failed.
- Logging: format/version/status allowed; rendered content, source refs, signed URLs, branding assets and filenames forbidden.

## 11. Read export

**Method/route:** `GET /api/projects/{projectId}/exports/{exportId}`
**Roles:** same authorized audience as the export grant.

Response while queued:

```json
{
  "exportId": "export-kitchen-v2-render-001",
  "status": "queued",
  "versionId": "version-kitchen-001-v2"
}
```

Ready response additionally contains `semanticContentHash` and an access mechanism scoped/expiring/revocable by server. Signed URL/token is response-sensitive and never stored in fixture, audit, analytics or logs.

- Idempotency: n/a; read is side-effect free.
- Concurrency: immutable export/version IDs.
- Status: `200`, `202`, `401`, hidden `404`; terminal controlled error code for failed render.
- Audit: no audit per poll; one `handoff_generated|handoff_generation_failed` terminal event.
- Logging: export ID/status/hash prefix allowed; access mechanism and content forbidden.

## Stable error dictionary

| Code | HTTP | Meaning |
|---|---:|---|
| `REVISION_STALE` | 409 | Human action targeted a non-current revision |
| `VERSION_STALE` | 409 | Publish/revise used an obsolete latest/base version |
| `IDEMPOTENCY_CONFLICT` | 409 | Same idempotency key was reused with a different canonical request |
| `CHANGE_REASON_REQUIRED` | 422 | Confirmed decision change lacks non-empty reason/reason code |
| `EVIDENCE_ACK_REQUIRED` | 422 | Evidence unavailable and no explicit human acknowledgement exists |
| `PROJECT_SCOPE_VIOLATION` | 422/404 | Internal reference crosses project; external unauthorized lookup is hidden as 404 |
| `INVALID_TRANSITION` | 409/422 | State-machine transition is invalid; detail code is controlled |
| `AI_HUMAN_REVIEW_FORBIDDEN` | 422 | Non-human actor attempted human-review action |

HTTP distinction: optimistic state conflict uses `409`; semantically invalid command uses `422`.
