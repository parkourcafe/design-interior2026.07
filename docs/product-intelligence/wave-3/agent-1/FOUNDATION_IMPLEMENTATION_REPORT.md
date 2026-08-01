# Agent 1 — Foundation implementation report

Дата: 17 июля 2026 года.
Scope: RU ProjectCEO Foundation, без production apply.

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

## 1. Результат

Создан additive Foundation-контур поверх materialized DB2:

- private schema `projectceo_foundation`;
- callable schema `projectceo_api`;
- Organization/Project enrollment с one-project/one-organization invariant;
- ProjectPackage, project/package memberships и capability grants;
- verified-email invitations с revoke/expiry;
- atomic invitation reissue с token rotation и append-only replacement chain;
- hashed, scoped, expiring, revocable guest grants;
- source physical inventory;
- Storage authorization и initial Project Graph ingestion;
- узкие project/package-scoped read projections;
- typed PostgreSQL adapters для Foundation и шести DB2 RPC;
- раздельные human/worker adapter surfaces;
- server-only token, Storage и ingestion orchestration;
- DB3 harness с PG16/PG17, RLS, concurrency, rollback и restart replay.
- Additive hosted-claims compatibility: request `sub` fallback and a versioned
  Supabase Custom Access Token Hook which emits `email_verified` only for the
  allowlisted ownership methods (`otp`, `magiclink`, `invite`, `email/signup`)
  and preserves the claim on token refresh.

Существующие timestamped migrations не изменялись. Production Supabase не
изменялся.

## 2. Миграции

| Migration | SHA-256 |
|---|---|
| `20260717090000_projectceo_foundation_access.sql` | `aeed70c70e0177c27175e57869336317adb5b1959ad98a05aae3d84364818dff` |
| `20260717091000_projectceo_foundation_ingestion_read.sql` | `c238da289d2e3028d681f74f51d8142ca089cf22d3de8b099e686367a0259755` |
| `20260717092000_projectceo_foundation_integration_hardening.sql` | `381895710430f04b4876001ca00bd6cde79093cf31e9bbbe0f20157fa47e4468` |

Foundation harness evidence:

| File | SHA-256 |
|---|---|
| `tests/db2/00_supabase_prelude.sql` | `5f22570d34817aeac2af0fcf9e69da7d48b68f18a8857e93b19808da395405fc` |
| `tests/db3/10_schema_security.sql` | `1a250c39201b24a24ef46b5c519a992fdbfb542354581340492a5ab04424f546` |
| `tests/db3/20_foundation_operations.sql` | `77ec0c7aa4ae3d15c0c6667e383604b0a3355b5e610623893bada822b7b11f00` |
| `tests/db3/30_restart_replay.sql` | `a7581d3b7dc2aa9f135094f20c7fade21f1324b81953457d69faf351e0cabdb6` |
| `tests/db3/run-concurrency.zsh` | `b9a0c18f5d13bb47cc243c5fc393ea5e7c87e10797e3a02661536c44f371b7ff` |
| `tests/db3/run.zsh` | `93bafafa2855d30dbcea5e957834c9818e14e22641f4bef6fb7601dc587b2c70` |

### Private relations

- `project_packages`;
- `project_memberships`, `package_memberships`;
- `project_member_capabilities`, `package_member_capabilities`;
- `invitations`, append-only `invitation_events`;
- `guest_access_grants`, append-only `guest_access_grant_events`;
- `source_inventory_records`;
- `source_protected_metadata`;
- `source_ingestions`;
- Foundation `command_records`, append-only `audit_events`.

Все Foundation tables:

- принадлежат `pi_table_owner`;
- имеют `ENABLE ROW LEVEL SECURITY` и `FORCE ROW LEVEL SECURITY`;
- не имеют direct table grants для `anon`, `authenticated`, `service_role`,
  `pi_human_executor` или `pi_worker_executor`;
- имеют индексы на leading columns всех Foundation foreign keys.

### Callable API

Human/request-bound:

```text
enroll_organization_project
create_invitation
accept_invitation
revoke_invitation
create_guest_access_grant
revoke_guest_access_grant
authorize_source_upload
authorize_source_download
register_source_inventory
ingest_source_graph
list_projects
get_project_summary
list_project_access
list_project_sources
get_review_queue
get_project_delivery
get_audit_timeline
```

Maintenance:

```text
expire_invitation
```

Guest:

```text
read_guest_release
```

DB3 проверяет exact 19 signatures и отсутствие лишних callable functions.

## 3. Security / RLS matrix

| Surface | anon | authenticated | service_role |
|---|---:|---:|---:|
| Foundation private tables | no | no | no |
| Human Foundation RPC | no | yes | no |
| `expire_invitation` | no | no | yes |
| `read_guest_release` | yes | yes | no |
| DB2 human RPC | no | yes | no |
| DB2 worker RPC | no | no | yes |

Дополнительно:

- `SECURITY DEFINER` functions имеют owner `pi_table_owner`;
- `search_path=''`;
- `PUBLIC EXECUTE` отозван;
- actor/user/organization/project/package/role/server time выводятся в SQL;
- Organization membership не даёт автоматический доступ ко всем Project;
- project/package membership и capability проверяются server-side;
- suspended Organization и inactive membership немедленно запрещают доступ;
- account deletion ограничена FK `ON DELETE RESTRICT`.

## 4. Invitation и guest token contract

- public/server delivery input не принимает token digest;
- server derivation выдаёт 32-byte opaque token через HMAC-SHA-256 от
  server-only secret, operation namespace, exact scope и idempotency key;
- повтор команды воспроизводит тот же raw token без хранения plaintext;
- DB получает только `SHA-256(raw token bytes)` как `bytea`;
- invitation acceptance использует `auth.uid()`, подтверждённый email,
  exact normalized recipient email и только email-ownership AMR:
  `magiclink`, `otp`, `invite`, `email/signup`;
- generic `email`, password-only и legacy client `email_verified=true` не
  являются доказательством владения почтовым ящиком;
- reissue принимает новый digest, атомарно отзывает все предыдущие active
  invitations того же recipient/exact scope и сразу пишет
  `replaces_invitation_id` без изменения append-only row;
- reused token digest и приглашение уже существующего exact-scope member
  возвращают controlled conflict;
- guest grant привязан к exact Organization/Project/root Package/Version;
- `work_package` guest grant запрещён до появления отдельной
  package-release binding model;
- guest TTL ограничен семью днями;
- revoke начинает запрещать чтение немедленно;
- email, raw token, digest и signed URL отсутствуют в controlled audit.

Перед route wiring интегратору нужен server-only secret минимум 32 bytes,
например `PROJECTCEO_TOKEN_SECRET`. Он не добавлен в production env.

## 5. Storage и ingestion

Canonical object key:

```text
project-intelligence/ru/{organization_uuid}/{project_uuid}/sources/{sha256}/{role}.{ext}
```

Enforced:

- private bucket `client-uploads`;
- `upsert:false`;
- hash считается от bytes, не от имени;
- исходное имя отсутствует в object key и audit;
- signed URL TTL не более 900 секунд;
- raw DWG/DXF и archives rejected;
- PDF/image/spreadsheet/text/email/audio allowlist и size limits совпадают в
  TypeScript и SQL;
- upload authorization выводит exact key server-side;
- download принимает Source identity, не произвольный object path;
- initial ingestion атомарно пишет Source, protected metadata, fragments, nodes,
  revisions, evidence и edges;
- `source.sourceRevisionId` обязан указывать ровно на одну revision входного
  payload; её node обязан иметь `kind=source`, exact current revision и
  payload `sourceId`, совпадающий с Source;
- persisted command result возвращает только проверенный exact
  `sourceRevisionId`;
- ingestion не публикует baseline автоматически;
- DB failure вызывает best-effort cleanup только если object был создан текущей
  попыткой; conflict/replay object не удаляется.

## 6. Integration hardening

Additive hardening migration закрывает результаты интеграционного P1-review:

1. package authorization агрегирует project-wide и package-specific grants в
   один authoritative context, поэтому двойное совпадение не дублирует доступ;
2. invitation acceptance требует server-observed confirmed email и signed JWT
   AMR из закрытого allowlist;
3. invitation reissue сохраняет append-only историю, ротацию digest и
   replacement chain;
4. guest release ограничен root package до появления version-bound
   work-package release contract;
5. ingestion проверяет полную Source → SourceRevision → source node closure до
   любых domain writes.

Harness prelude моделирует `auth.jwt()` через `request.jwt.claims`; это только
локальная disposable test surface и не production auth implementation.

The local AP1 stack additionally enables the versioned custom access-token hook
through `supabase/config.toml`. A real five-session GoTrue browser run now
passes invitation acceptance, distribution/ack, change-impact, photo review,
milestone acceptance, replay, CSRF and isolation checks. The in-app browser also
opens the authenticated owner workspace and renders Kora Food Hall / 1 800 m²
with zero console errors. Hosted activation of the same hook remains a separate
production gate; no production migration or Auth setting was changed by this
branch. Mobile viewport capture is not claimed because the in-app browser has no
viewport control and the host headless Chrome launcher is unavailable in this
sandbox.

## 7. DB2 compatibility fix

P1 добавил deferred constraint
`project_intelligence.version_evidence_scope_closure`. Без принудительной
проверки он исполнялся на `COMMIT` уже после выхода из защищённого executor
context и получал `permission denied`.

Additive migration делает `CREATE OR REPLACE` существующего internal
`_complete_command` с тем же signature/security/ACL и:

1. сохраняет frozen четыре DB2 constraint statements без изменения;
2. дополнительно переводит `version_evidence_scope_closure` в
   `IMMEDIATE`, затем обратно в `DEFERRED`, пока NOLOGIN executor ещё активен.

Private table grants не расширялись, frozen DB2 assertions остались зелёными.

## 8. Typed adapters

Созданы:

- `adapters/postgres/contracts.ts`, stable envelope и error DTO;
- `adapters/postgres/foundation.ts`, exact Foundation RPC mapping;
- `adapters/postgres/db2.ts`, отдельные human и worker classes;
- `adapters/postgres/errors.ts`, SQLSTATE → stable public error code без raw SQL;
- `adapters/storage/policy.ts`, byte/MIME/size/hash policy;
- `adapters/storage/storage.ts`, exact-key upload/download;
- `adapters/storage/tokens.ts`, server-only opaque tokens;
- `delivery/server/foundation-service.ts`, route-level orchestration.

Human DB2 adapter имеет только:

```text
review_claim
publish_version
revise_decision
review_impact
```

Worker DB2 adapter имеет только:

```text
calculate_impact
build_handoff
```

Ни один adapter не импортирует legacy `createAdminClient()` и не читает private
relations напрямую.

## 9. Test evidence

Последние успешные команды:

```text
PI_DB_IMAGE=postgres:16-alpine tests/db2/run.zsh
DB2_HARNESS_OK image=postgres:16-alpine

PI_DB_IMAGE=postgres:17-alpine tests/db2/run.zsh
DB2_HARNESS_OK image=postgres:17-alpine

PI_DB_IMAGE=postgres:16-alpine tests/db3/run.zsh
DB3_FOUNDATION_HARNESS_OK image=postgres:16-alpine

PI_DB_IMAGE=postgres:17-alpine tests/db3/run.zsh
DB3_FOUNDATION_HARNESS_OK image=postgres:17-alpine

npm run test
46 files passed, 278 tests passed

npm run release:check
lint, typecheck, 46/46 files, 278/278 tests and build passed

zsh -n tests/db2/run.zsh tests/db2/run-concurrency.zsh \
  tests/db3/run.zsh tests/db3/run-concurrency.zsh
passed

git diff --check
passed
```

DB3 covers:

- exact schemas, tables, RPC signatures and ACL;
- no direct runtime table grants;
- all Foundation FK leading indexes;
- enrollment replay and one-project/one-organization;
- concurrent enrollment: one winner + one replay;
- concurrent same-key invitation: one winner + one replay;
- concurrent different-token reissue: one winner + one stale loser, one active
  replacement and one revocation event;
- confirmed recipient identity with exact email-ownership AMR allowlist;
- generic `email`, password-only and client email-verified negatives;
- invitation token rotation, superseded-token denial and replacement linkage;
- duplicate token digest and existing exact-scope membership conflicts;
- unverified, revoked and expired invitation negatives;
- package authorization deduplication for simultaneous project/package grants;
- guest root-package scope, work-package denial and immediate revoke;
- storage authorization and raw DWG rejection;
- inventory, atomic graph ingestion and SourceRevision closure negatives;
- DB2 human review + immutable version publication after ingestion;
- cross-tenant denial;
- suspended Organization and inactive membership denial;
- account deletion restriction;
- injected rollback;
- restart replay.

## 10. Deferred surfaces

Осознанно не реализованы в этом Foundation scope:

1. IF-A2-02 explicit persistence для DecisionRevision, SelectionRevision,
   PriceObservation и ApprovalPackage.
2. IF-A2-03 отдельные tables/commands для `project_baselines`,
   `production_package_versions`, `release_artifacts`, distributions и
   acknowledgements.
3. `publish_project_baseline`, `publish_production_package_version` и
   `build_release_artifact`.
4. Полный M4: no-change terminal record, construction ChangeRequest,
   photo acceptance, acts/warranty handover.
5. Live Next.js route wiring, email sender и WhatsApp delivery.
6. Production adoption/apply.

`get_project_delivery` сейчас возвращает authorized existing DB2
version/handoff projection и explicit extension placeholders. Он не изображает
deferred entities уже реализованными.

## 11. Adoption / rollback note

Production adoption разрешается только отдельным решением.

Перед apply:

1. создать и проверить server-only token secret;
2. подключить request-bound human client, отдельный maintenance client и
   worker-only client;
3. создать private bucket policy/runbook orphan cleanup;
4. повторить DB2+DB3 на snapshot production schema;
5. сделать database backup и dry-run rollback.

Если controlled adoption потребуется откатить, сначала отозвать
`projectceo_api` EXECUTE и остановить route traffic, затем экспортировать audit
и Foundation records. Удаление schemas/constraints должно быть отдельной
reviewed down-migration; автоматический destructive rollback в этот change set
не включён.
