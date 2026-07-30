# Event contract

Audit ledger и product analytics — разные sinks, schemas и retention policies. Analytics не доказывает business state; audit не используется как поведенческий clickstream.

## Common envelope

Каждая запись получает server-derived:

```text
event_id
event_name
occurred_at_utc
region
edition
organization_id
project_id
request_id / correlation_id
```

`project_version_id`, `source_id`, `node_id`, `node_revision_id`, `change_set_id`, `impact_run_id`, `impact_id`, `export_id` обязательны только когда применимы. User/client не передаёт `region`, `edition`, organization, actor ID/role или timestamp как доверенные properties.

## Immutable audit events

Audit payload хранит идентичность операции и controlled before/after state. Free-text reason может храниться в защищённом domain audit record, но не копируется в analytics/logs.

| Audit event | Trigger | Required IDs | Controlled state | Idempotency/correlation |
|---|---|---|---|---|
| `source_upload_created` | upload intent accepted | project, source, actor, command | source kind, `none→uploading` | one event per accepted idempotent command |
| `source_processing_started` | worker accepts attempt | project, source, attempt, system actor | `uploading/failed→processing` | attempt ID + correlation to source command |
| `source_processing_completed` | terminal ready/partial | source, attempt | before/after status, checksum, fragment IDs/count | one terminal event per attempt |
| `source_processing_failed` | terminal failure | source, attempt | before/after, controlled error code | one terminal event per attempt; provider error excluded |
| `claim_review_confirmed` | human confirms revision | node, target revision, review, actor | old/new claim status | one event per review command/result |
| `claim_review_rejected` | human rejects revision | node, target revision, review, actor | old/new claim status, reason code | one event per review command/result |
| `claim_review_edited` | human edit creates revision | node, target/result revisions, review, actor | action, reason code | same idempotency result returns same event ID |
| `evidence_unavailable_acknowledged` | explicit override accepted | revision, fragment, review, actor | acknowledgement code; protected reason reference | separate from claim review, same correlation ID |
| `project_version_published` | immutable version committed | version, base version, actor | version number, selected revision IDs | one event per published version |
| `decision_changed` | confirmed decision revision created | node, from/to revisions, change set, actor | reason code, changed paths/count | command/change-set correlation |
| `impact_set_calculated` | deterministic run persisted | change set, impact run, version pair, system actor | policy version, result digest, impact IDs/count | one terminal result per idempotent run |
| `impact_reviewed` | human disposition accepted | impact, impact run, actor | before/after status, disposition/reason code | one per accepted transition |
| `impact_missing_dependency_reported` | disposition `missing_added` | impact run, changed node, candidate impacted node, actor | controlled reason code, follow-up command reference | correlated to review; does not mutate old run |
| `handoff_generation_requested` | export command accepted | export, version, impact run, actor | format, locale | one per idempotent export command |
| `handoff_generated` | render terminal ready | export, version, impact run, system actor | format, full content hash, unresolved count | one terminal event per render attempt |
| `handoff_generation_failed` | render terminal failed | export, version, attempt | controlled error code | one terminal event per attempt |

Forbidden in audit copies/logs: source bytes, raw provider payload, permanent/signed URLs, secrets, contact details. Protected free-text reason is stored once in the domain audit record and referenced by ID where possible.

## Product analytics dictionary

Names and controlled properties follow `measurement-plan.md`.

| Product event | Trigger | Required IDs | Allowed controlled properties | Idempotency/correlation |
|---|---|---|---|---|
| `source_uploaded` | bytes accepted and checksum created | organization, project, source | `source_kind`, `size_bucket` | dedupe by source accepted event; correlation to upload command |
| `source_processed` | terminal ingestion | organization, project, source | `status`, `duration_bucket`, `fragment_count` | one per terminal processing attempt; retries have distinct attempt ID |
| `claim_proposed` | AI/import revision created | organization, project, node, revision | `node_kind`, `claim_status` | one per immutable revision |
| `claim_reviewed` | human confirm/reject/edit accepted | organization, project, node, target/result revision | `node_kind`, `outcome`, `review_seconds_bucket` | one per accepted review result, not UI click |
| `project_version_published` | version committed | organization, project, version | `version_no`, `node_count` | one per immutable version ID |
| `decision_changed` | new decision revision committed | organization, project, node, revision, change set | `reason_code`, `changed_field_count` | one per ChangeSet decision change |
| `impact_calculated` | impact set persisted | organization, project, change set, impact run | `impacted_count`, `max_distance` | one per immutable run/result digest |
| `impact_reviewed` | human review cycle reaches recorded checkpoint | organization, project, impact run | `accepted`, `not_applicable`, `missing_added` counts | aggregate checkpoint keyed by run/review revision; audit remains row-level truth |
| `handoff_generated` | export ready | organization, project, version, export | `format`, `content_hash_prefix`, `unresolved_count` | one per ready artifact; retries with same artifact not double-counted |
| `handoff_used` | downstream use explicitly confirmed | organization, project, version, export | `confirmation_method` = `in_product|pilot_interview|integration_callback` | one per confirmation method/evidence reference |
| `second_project_started` | organization begins second live project | organization, project | `days_since_first` | one when second qualifying project first enters live state |

`handoff_used` and `second_project_started` are not emitted by the standalone fixture. They remain contract-ready for product measurement.

## Forbidden analytics properties

Never include:

- source text or excerpt;
- client/user names, email, phone, address or contact IDs outside approved opaque actor/user ID;
- original filenames or document URLs;
- node title/payload/material free text;
- review/change free-text reason;
- locator contents, edge paths or graph payload;
- signed URL, storage key, provider response, prompt/model output;
- full content hash when a short prefix is sufficient.

## Correlation and retry semantics

- `request_id` identifies one HTTP attempt.
- `command_id`/idempotency operation identifies the semantic mutation across retries.
- `processing_attempt_id` and `render_attempt_id` distinguish worker attempts.
- `change_set_id` joins decision change, diff and impact runs.
- `impact_run_id` pins the exact impact snapshot used by export.
- `export_id` pins one artifact/render lifecycle.
- Analytics dedupe key is deterministic per semantic outcome, not per HTTP request.
- Replayed idempotent response does not emit a second audit or analytics outcome.

## Fixture event sequence

The expected logical order is:

```text
source_uploaded ×3
→ source_processed ×3
→ claim_proposed (requirement, decision, risk)
→ claim_reviewed (requirement, decision)
→ project_version_published V1
→ decision_changed
→ project_version_published V2
→ impact_calculated
→ impact_reviewed
→ handoff_generated
```

Ordering is established by IDs/timestamps/correlation, not by assuming cross-worker delivery order.
