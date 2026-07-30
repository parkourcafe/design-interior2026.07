# P0 UI state contract

Это state/interaction contract без visual design. Graph canvas не входит в P0.

## State flow

```text
source_empty
  → uploading
  → processing
  → processing_partial | processing_failed | review_pending
  → review_complete
  → v1_published
  → decision_editing
  → v2_draft
  → impact_pending
  → impact_review
  → v2_ready
  → export_queued
  → export_ready | export_failed
```

Backward navigation is read-only unless an explicit transition is listed. Published data never returns to an editable state in place.

## Roles

- `designer`: all states and mutation actions in project scope;
- `client`: read, allowed claim/decision actions according to server capability response;
- `executor`: only explicitly shared `v1_published`, `v2_ready`, `export_ready` views;
- `system`: status producer, never a UI human actor.

The UI renders capabilities returned by the server; locally stored role strings are not authorization.

## State table

| State | Visible data/actions | Allowed transitions | Forbidden transitions | Loading/empty/error/stale behavior | Role | Audit / product event |
|---|---|---|---|---|---|---|
| `source_empty` | Empty source list, supported kinds, Upload | `uploading` | publish/review/export | Empty is a valid first state; failure to load project is not shown as empty | designer; allowed client | product `source_list_viewed`; no audit |
| `uploading` | Local filename only in current session, progress, Cancel | `processing`, `source_empty` on pre-commit cancel | review/publish; navigation that silently abandons committed upload | Network retry preserves idempotency key; after server accepted intent, cancel does not delete audit/source | uploader | audit `source_upload_created`; analytics only after bytes accepted |
| `processing` | Source kind, controlled status, progress/refresh | `processing_partial`, `processing_failed`, `review_pending` | manual claim confirmation before fragments exist | Poll errors retain last server state; no raw provider error | project reader | terminal transition audited by server; product `source_processed` only terminal |
| `processing_partial` | Completed fragments, failed fragment count, Retry | `processing`, `review_pending`, `processing_failed` | treating missing evidence as complete | Available claims may be reviewed; unavailable claims display blocking warning | designer | retry audit with correlation; product controlled counts |
| `processing_failed` | Controlled error code, Retry, source metadata | `processing` | delete history, expose provider payload, publish claims | Error copy contains no source text/filename/contact; same operation replay distinguished from new attempt | designer | audit `source_processing_failed`; analytics status/duration bucket |
| `review_pending` | Queue, source fragment + claim side-by-side, Confirm/Reject/Edit | remains `review_pending`, then `review_complete` | bulk silent confirm, confirmation by system actor | Loading skeleton preserves selected revision ID; unavailable evidence requires acknowledgement; stale action moves back to refreshed item | designer; policy client | each action immutable audit; product `claim_reviewed` |
| `review_complete` | Counts by outcome, unresolved unknowns, Publish V1 when valid | `v1_published`, back to `review_pending` only for newly created revisions | mutate reviewed revision; publish stale selection | Empty pending queue is explicit; publication conflict refreshes revision set | designer / approver capability | audit only on publish; product review completion derived, not a separate source of truth |
| `v1_published` | Version 1 badge, immutable node table, provenance, Start decision change | `decision_editing`; read export may be offered later but not fixture path | edit V1 in place, delete V1 | Loading uses exact `versionId`; if latest is newer, show banner without replacing requested V1 | project reader; edit capability for action | product `project_version_viewed`; no mutation audit |
| `decision_editing` | V1 value, new material editor, required reason code/text, Cancel/Save draft | `v1_published`, `v2_draft` | save without reason, change stable node ID, modify dependencies automatically | Client validation is advisory; server errors authoritative. `REVISION_STALE` reloads and requires new human decision | designer; policy client | audit only on accepted revision command; product `decision_changed` after success |
| `v2_draft` | Draft revision, base V1, semantic diff preview, Publish V2 | `decision_editing`, `impact_pending` after publish | impact from unpersisted arbitrary client graph, no-op publication | No semantic change displays controlled error and keeps V1 current; stale base refreshes diff | approver capability | audit `project_version_published`; product same event with counts |
| `impact_pending` | V1→V2 diff, calculation status, retry/refresh | `impact_review`, `v2_draft` only if V2 not actually published | client-provided changed nodes/edges, hidden LLM impact | Failure preserves V2 and ChangeSet; retry uses same change context and idempotency semantics | project reader; system calculates | audit terminal impact-run result; product `impact_calculated` |
| `impact_review` | Ordered impacts, status, changed/impacted nodes, dependency path, Accept/Resolve/Not applicable/Missing | remains `impact_review`, then `v2_ready` | automatic business-data mutation, hiding non-reviewed impact, adding silent edge | Empty is valid only when calculation succeeded with zero impacts. Stale status refreshes item. Missing dependency opens explicit report flow | designer; policy client | audit per disposition; product `impact_reviewed` controlled outcomes |
| `v2_ready` | Immutable V2 summary, provenance, resolved/unresolved impact groups, Export | `export_queued`, read older versions | edit V2 in place, export “latest” alias without exact version | If a newer version exists, requested V2 remains visible with banner; export command pins version and impact run | project reader; export capability | no audit for view; product event optional without content |
| `export_queued` | Export ID, exact version, format, status, Cancel only if server supports safe cancellation | `export_ready`, `export_failed` | switch version/impact snapshot inside job | Poll failure keeps queued state and last server timestamp; no signed link before ready | authorized requester | audit request already written; no audit per poll |
| `export_ready` | Version/hash/format, Open/Print/Generate another render, export history | `export_queued` for explicit new render | claim volatile artifact fields changed semantic hash | Access expiry refreshes access grant, not artifact/content; hash mismatch is blocking integrity error | authorized audience | audit `handoff_generated`; product `handoff_generated`, later `handoff_used` on verified use |
| `export_failed` | Controlled failure code, exact version, Retry | `export_queued` | mutate project/version to repair render silently | Retry preserves semantic input; raw renderer/provider error hidden | authorized requester | audit `handoff_generation_failed`; analytics controlled status only |

## Side-by-side review contract

The review surface always binds four IDs:

```text
projectId
nodeId
currentRevisionId
sourceFragmentId
```

Left side:

- source kind and controlled label;
- exact fragment excerpt;
- locator appropriate to PDF/transcript/questionnaire;
- `available` state;
- authorized “open in source” action without exposing permanent signed URL.

Right side:

- node kind/title/payload;
- `contentOrigin` and current claim status;
- confidence as informational only;
- Confirm/Reject/Edit capability;
- target revision ID visible in details/audit context.

If fragment becomes unavailable after render, Confirm is disabled until the reviewer opens the acknowledgement flow and provides reason. A warning is not equivalent to acknowledgement.

## Version diff contract

The UI combines two sources without merging their semantics:

1. Pure content diff: stable node ID, from/to revision IDs, change type, JSON Pointer paths.
2. ChangeSet/audit enrichment: actor role, server timestamp, reason code and reason.

For the fixture the diff view shows:

```text
Decision: Kitchen worktop material
V1: natural_stone
V2: quartz_composite
Changed field: /material
Actor role: client
Reason code: schedule_constraint
```

Budget and Finish Schedule are not shown as auto-changed. They appear in the impact view.

## Dependency path contract

Each impact row shows:

- changed node;
- impacted node;
- distance;
- ordered nodes;
- ordered edge IDs and relations;
- current disposition and reviewer metadata.

Example:

```text
decision-worktop-material
  ← specified_by / edge-item-decision
item-kitchen-worktop
  ← depends_on / edge-budget-item
deliverable-budget
```

The stored edge direction remains dependent → dependency; the visual path starts at changed dependency and follows reverse incoming edges. `conflicts_with` risk may appear as a separate review signal but never inside this impact list.

## Stale-data rules

- Never auto-replay Confirm/Reject/Edit after `REVISION_STALE`.
- Never switch a version-specific screen to “latest” without user action.
- Never merge two impact dispositions client-side after optimistic conflict.
- Retain form input locally for recovery, but revalidation and explicit resubmission are required.
- Server actor/time/status always replace optimistic display after accepted command.
