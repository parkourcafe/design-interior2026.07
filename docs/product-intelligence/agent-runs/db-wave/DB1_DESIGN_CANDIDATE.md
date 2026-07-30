# DB1 — read-only design candidate

Дата: 16 июля 2026 года.

```text
DESIGN_CANDIDATE=ready
DB1_ACCEPTED=false
DB2_ALLOWED=false
FILES_CHANGED_OUTSIDE_DOCS=false
DATABASE_CHANGED=false
PRODUCTION_ACCESSED=false
```

Этот документ сохраняет проектное решение для будущего DB1 review. Он не резервирует
номер migration и не разрешает DB2, пока не пройдены условия `BASELINE_GATE.md`.

## Boundary

Не расширять `project_rooms`, `events`, `concept_packs` или `projects.passport` до роли
Project Intelligence persistence. Создать отдельный, не экспонированный напрямую через
PostgREST schema:

```text
project_intelligence
```

`public.projects` остаётся существующей канонической строкой проекта. Новый
`project_intelligence.project_workflows` — opt-in extension только для allowlisted pilot
projects.

## Regional cell and tenancy

- `deployment_cell(cell_code, singleton)` — одна immutable строка `us` или `ru`;
- `organizations(id, cell_code, edition, legacy_designer_id, status, created_at)`;
- `organization_members(id, organization_id, user_id, role, status, ...)`;
- `member_capabilities(member_id, capability)`;
- `project_workflows(organization_id, project_id, state_revision, latest_version_id, ...)`.

Разные регионы остаются разными Supabase DB, Storage, backups, logs и secrets.
`cell_code` защищает от ошибочного cross-cell import, но не является runtime region
switch.

Legacy backfill candidate:

- одна `designers`-строка → одна organization;
- owner и active `studio_members` → organization members;
- `projects.designer_id IS NULL` автоматически не подключаются;
- enrolment выполняется только для allowlisted pilots.

## Graph and provenance tables

- `sources`;
- `source_fragments`;
- `graph_nodes`;
- `graph_node_revisions`;
- `human_reviews`;
- `evidence_links`;
- `graph_edges`;
- `draft_edges`.

Rules:

- stable node и revisions разделены;
- source, fragment, revision, review и evidence append-only;
- `graph_nodes.current_revision_id` меняется только atomic command transaction;
- replacement lineage замкнут на тот же organization/project/node;
- AI `extracted|interpreted` требует evidence;
- `unknown` требует controlled `unknown_reason`;
- locator — JSONB с отдельным controlled `locator_kind` и DB validator;
- source bytes остаются в object storage того же physical cell.

## Exact published versions

Tables:

- `project_versions`;
- `version_nodes`;
- `version_revisions`;
- `version_reviews`;
- `version_sources`;
- `version_source_fragments`;
- `version_evidence_links`;
- `version_edges`.

`project_versions` хранит `version_no`, `base_version_id`, actor/time, `graph_digest` и
contract version. Deferred snapshot validation проверяет selected revisions и полную
review/evidence/source/edge closure.

## ChangeSet

- `change_sets` — immutable lineage и controlled reason code;
- `change_set_reasons` — protected free-text reason;
- `change_set_publications` — append-only `to_version_id` binding.

Publish contract:

```text
to.base_version_id = from.id
to.version_no = from.version_no + 1
to-version selects change_set.to_revision_id
from-version selects change_set.from_revision_id
```

Free-text reason не попадает в audit, logs или analytics.

## Impact and handoff

Impact tables:

- `impact_runs`;
- `impact_run_changes`;
- `impact_run_roots`;
- `impacts`;
- `impact_path_steps`;
- `impact_reviews`.

Run связывает exact ChangeSet, from/to versions, controlled reason, target graph digest,
algorithm descriptor и result digest. Path steps ссылаются на edges exact target
version. Current impact status выводится из append-only review chain.

Handoff tables:

- `logical_handoffs`;
- `handoff_impact_reviews`.

Immutable JSONB допустим здесь как deliverable payload: exact version/run/reviews,
logical content, semantic SHA-256, contract/hash versions и artifact descriptor.

## Idempotency and audit

- `command_records` — scoped key digest, operation, request digest, exact result и
  resulting state revision; unique
  `(organization_id, project_id, operation, key_digest)`;
- `audit_events` — append-only server actor/time/request и controlled metadata с
  event-specific key whitelist; FK на command record без cascade delete.

Существующий `public.events` не используется как security audit: он cascade-deletable и
не соответствует append-only contract.

## Constraints and indexes

- every tenant table carries `organization_id + project_id`;
- child relations use composite FK, запрещая cross-project/cross-organization links;
- every FK indexed;
- domain IDs remain `text`; organization/project IDs remain UUID;
- `state_revision` и `version_no` are `bigint` bounded to JS safe integer;
- SHA-256 digests use `bytea` with exact 32-byte check;
- closed vocabularies use `CHECK` constraints;
- node identity unique `(organization_id, project_id, kind, stable_key)`;
- reverse-impact index `(organization_id, project_id, to_node_id, relation)`;
- audit index `(organization_id, project_id, occurred_at desc)`;
- core/history FK use `RESTRICT`, not `CASCADE`;
- no partitioning in P0.

## RLS and privileges

- Core schema не экспонируется напрямую в Data API.
- Tables owned by a dedicated `NOLOGIN` owner.
- Runtime RPC owner has no `BYPASSRLS`.
- `ENABLE RLS` + `FORCE RLS` on every tenant table.
- `anon`: no access.
- `authenticated`: no direct table mutations.
- Human RPC derives actor only from `(select auth.uid())`.
- Organization, project and capabilities are resolved server-side.
- System/AI entry point is separate and worker-only.
- Every `SECURITY DEFINER`: `search_path=''`, schema-qualified objects, explicit
  `REVOKE/GRANT EXECUTE`.
- Append-only trigger rejects `UPDATE/DELETE` on history even after an accidental grant.

## Atomic commit and concurrency contract

Один `project_workflows.state_revision` используется всеми шестью L1 operations.
Раздельные application state revisions должны быть объединены persistence coordinator до
DB2.

Transaction order:

1. lock `project_workflows ... FOR UPDATE`;
2. same key + same digest → replay; same key + other digest → conflict;
3. verify `expected_state_revision`;
4. verify exact revision/version/impact status;
5. persist normalized records;
6. persist completed command result;
7. append audit events;
8. increment state revision exactly once;
9. commit.

Lock order is always:

```text
project workflow root
→ entity rows sorted by ID
→ command record
→ audit
```

AI, HTTP и object-storage calls запрещены внутри transaction.

DB2 должен доказать parallel same-key replay, different-digest conflict, one-success/one-
stale CAS, unique version numbering, impact-review race safety, rollback on injected
failure, cross-org RLS rejection, append-only enforcement и restart-safe idempotency.

## Expand/contract sequence

1. Obtain authoritative ledger and schema-only dump.
2. Fix deployment cell identity.
3. Add the private schema/roles/tables/RLS without changing legacy flows.
4. Backfill organizations/members in idempotent batches.
5. Enrol allowlisted pilot projects only.
6. Add persistence coordinator and shadow round-trip validation.
7. Enable writes behind pilot feature flag.
8. Switch reads only after rollback window.
9. Legacy contract/deprecation remains a later wave.

After live writes, rollback means disabling the feature flag and returning application
reads/writes to legacy flow. Immutable PI history is retained and corrected roll-forward;
tables are not dropped.

## Blocking decisions before acceptance

1. Materialize canonical Git and capture exact dirty state.
2. Obtain authoritative production migration ledger/schema-only dump.
3. Reconcile occupied `0007`, `0008`, worktree-only `0009` and all refs.
4. Select the physical cell that may receive legacy production data.
5. Introduce one owning persistence coordinator/state revision across both application
   modules.
6. Replace the unsafe `0009` candidate rather than apply it unchanged: client-supplied
   actor authority, missing expected-version CAS, plaintext grants, mutable/cascade audit
   and irreversible duplicate deletion remain blockers.
