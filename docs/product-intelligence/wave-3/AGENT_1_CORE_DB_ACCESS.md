# ТЗ агента 1 — Core, DB, Access и Ingestion Foundation

## Миссия

Создать безопасный application persistence boundary, без которого ProjectCEO UI и
Kora workflow не могут работать с реальной базой.

## Входы

- Product Charter v0.3.
- Architecture v1.
- DB2 core/operations migrations.
- DB2 PG16/PG17 harness.
- `DB2_STORAGE_ADAPTER_SPEC.md`.
- `ADAPTER_ACCEPTANCE_TEST_PLAN.md`.
- `INTEGRATION_GAP_REGISTER.md`.

## Обязательные задачи

### A1. Enrollment

Спроектировать и реализовать additive command:

```text
enroll_organization_project
```

Он атомарно и идемпотентно создаёт/связывает:

- Organization;
- owner OrganizationMembership;
- Project;
- ProjectMembership;
- capability set;
- ProjectIntelligenceWorkflow root.

Не принимать actor/organization/time из client payload.

Дополнительные invariants:

- один legacy `public.projects.id` может принадлежать только одной ProjectCEO
  Organization;
- legacy owner/studio должен соответствовать enrollment policy;
- повторный enrollment возвращает тот же logical result;
- concurrent enrollment имеет одного победителя.

### A2. Invitations and grants

Реализовать команды:

- create invitation;
- accept invitation;
- revoke invitation;
- expire invitation;
- create/revoke guest AccessGrant.

Контракт:

- email — основной team identity P0;
- guest link можно отправить через WhatsApp;
- raw token хранится только у получателя;
- DB хранит digest;
- grant имеет organization/project/package scope, role, expiry, revocation;
- replay безопасен;
- audit не содержит email/token.

Acceptance приглашения требует доказанного владения recipient identity. Нельзя
переносить legacy-модель, в которой достаточно зарегистрировать чужой email или
совпасть строкой email.

### A3. Read model

Создать узкие RLS-scoped query projections/RPC для:

- organization/project list;
- project summary;
- memberships and invitations;
- source registry;
- review queue;
- latest baseline and versions;
- package/release;
- change/impact;
- distribution/acknowledgement;
- audit timeline.

Не выдавать private relations напрямую.

Внешний участник получает только published projection. Organization membership сам
по себе не даёт доступ ко всем проектам организации.

### A4. Storage authorization

Создать project-scope authorization probe/command.

Object key:

```text
project-intelligence/ru/{organization_uuid}/{project_uuid}/sources/{sha256}/{role}.{ext}
```

Правила:

- private bucket;
- `upsert:false`;
- MIME/size allowlist;
- original filename отсутствует в key/audit;
- signed URL ≤ 15 минут;
- deterministic retry;
- orphan cleanup/runbook.

### A5. Initial ingestion

Создать atomic validated ingestion command для:

- Source;
- protected metadata;
- SourceFragment;
- GraphNode/stable key;
- GraphNodeRevision;
- EvidenceLink;
- GraphEdge;
- initial workflow state.

Команда должна:

- проверять project/organization closure;
- принимать только supported source kinds;
- reject raw DWG/archive as evidence source;
- поддерживать preview PDF/PNG;
- обеспечивать idempotency;
- сохранять actor/audit;
- не публиковать baseline автоматически.

### A6. Existing DB2 adapter

Реализовать typed server adapters для:

- review_claim;
- publish_version;
- revise_decision;
- calculate_impact;
- review_impact;
- build_handoff.

Human operations используют request-bound authenticated client. Worker operations
доступны только server-only executor.

### A7. Tests

Обязательные:

- static boundary tests;
- exact RPC signatures;
- enrollment replay/conflict;
- invitation expiry/revoke;
- guest scope negative tests;
- cross-tenant RLS;
- storage authorization;
- duplicate content retry;
- different bytes/same filename;
- ingestion closure;
- stale state/concurrency;
- rollback;
- restart replay;
- PG16/PG17.
- email recipient verification;
- one-project/one-organization invariant;
- immediate deny after grant revoke;
- suspended organization/inactive membership deny;
- account deletion behavior with restricted Project Intelligence records.

## File ownership

Рекомендуемый scope:

- новые additive `supabase/migrations/**`;
- `lib/project-intelligence/adapters/postgres/**`;
- `lib/project-intelligence/adapters/storage/**`;
- `lib/project-intelligence/delivery/server/**` для adapter-only handlers;
- `tests/db3/**`;
- agent report.

Не изменять UI и pure domain без interface request интегратору.

## Definition of Done

```text
ENROLLMENT_READY=true
INVITATIONS_READY=true
READ_MODEL_READY=true
STORAGE_AUTH_READY=true
INGESTION_READY=true
DB2_ADAPTER_READY=true
PG16=true
PG17=true
PRODUCTION_CHANGED=false
```

## Handoff интегратору

- migration hashes;
- callable interface;
- DTO/error mapping;
- RLS matrix;
- test evidence;
- unresolved risks;
- rollback/adoption note.
