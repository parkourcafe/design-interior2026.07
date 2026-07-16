# RU vertical slice → DB2 / Storage adapter specification

Дата review: 16 июля 2026 года.
Статус: design-only, без изменений application code, migrations и production.
Основание: `project-intelligence-db2-core/1.0`, 31 private relation и шесть
принятых RPC.

```text
ADAPTER_SPEC_FROZEN=true
CURRENT_DB2_SUPPORTS_ACCEPTED_L1_MUTATIONS=true
CURRENT_DB2_SUPPORTS_RU_INGESTION=false
CURRENT_DB2_SUPPORTS_RU_READ_MODEL=false
CURRENT_DB2_SUPPORTS_CONSTRUCTION_HANDOVER=false
APPLICATION_IMPLEMENTATION_ALLOWED_BY_THIS_DOCUMENT=false
PRODUCTION_APPLY_ALLOWED=false
```

## 1. Итог review

Текущий DB2 является надёжным persistence-контуром для уже сформированного
Project Graph:

```text
review claim
→ publish version
→ revise an existing decision
→ publish next version
→ calculate/review impact
→ build logical handoff
```

Он не является persistence API для полного RU-сценария:

```text
upload/import
→ initial graph
→ WBS
→ estimate
→ procurement state
→ photo acceptance
→ construction handover
```

Поэтому безопасный адаптер нельзя строить через прямую запись в 31 private table,
через `service_role`-обход или путём переименования закупок в design decisions.
Недостающие команды и read model перечислены в отдельном gap register.

Дополнительно действует repository guardrail из `AGENTS.md`: specifications,
procurement и production workflow не входят в MVP v0.1. Этот документ только
фиксирует границу и mapping; он не расширяет разрешённый scope.

## 2. Trust boundary

### Human operations

Server route использует request-bound Supabase client из `lib/supabase/server.ts`.
JWT пользователя должен доходить до SQL RPC. Организация и пользователь не
принимаются из JSON: DB2 получает их через `auth.uid()`, active membership и
`member_capabilities`.

`authenticated` может вызывать только:

| RPC | Required capability |
|---|---|
| `review_claim` | `review_claim` |
| `publish_version` | `publish_version` |
| `revise_decision` | `revise_decision` |
| `review_impact` | `review_change_impact` |

Human route не использует `createAdminClient()` для этих операций.

### Worker operations

Server-only worker использует `service_role` только для:

| RPC | Context |
|---|---|
| `calculate_impact` | `pi_worker_executor` |
| `build_handoff` | `pi_worker_executor` |

`service_role` не получает human RPC и не получает direct table privileges.

### Private DB

Ни браузер, ни `authenticated`, ни `service_role` не получают:

- `USAGE` на `project_intelligence`;
- прямые `SELECT/INSERT/UPDATE/DELETE` на 31 relation;
- возможность самостоятельно задавать actor, organization, audit timestamp или
  command result.

Все новые adapter operations, если они будут отдельно разрешены, должны сохранить
этот принцип: narrow `SECURITY DEFINER` RPC, empty `search_path`, exact ACL, RLS,
root lock, idempotency record и audit event.

## 3. Storage contract

Используется существующий private bucket `client-uploads`. Bucket не имеет
зафиксированных file-size/MIME limits, поэтому ограничения обязаны применяться в
server route до upload.

Canonical object key:

```text
project-intelligence/ru/{organization_uuid}/{project_uuid}/sources/{sha256_hex}/{role}.{ext}
```

Правила:

1. `sha256_hex` — lowercase hex из 32 bytes содержимого; не хеш имени файла.
2. В object key нет исходного имени клиента, email, signed URL или свободного
   описания.
3. Upload всегда `upsert: false`.
4. Storage недоступен напрямую из браузера. Route сначала авторизует exact
   `(organization_id, project_id)`, затем использует server-only admin client.
5. Signed URL выдаётся только после повторной project-membership проверки,
   живёт не более 15 минут и никогда не сохраняется в graph payload,
   `logical_content`, `command_records` или `audit_events`.
6. Object Storage не вызывается внутри DB transaction. Сначала вычисляется hash и
   загружается deterministic object, затем отдельная idempotent DB command
   регистрирует Source. При DB failure route делает best-effort cleanup; retry с
   тем же hash не создаёт второй logical source.
7. Исходное имя, MIME, размер и заявленная ревизия являются protected source
   metadata. В текущей `sources` для них нет колонок; допустимая будущая проекция —
   revision payload узла `kind='source'`. Эти данные запрещены в controlled audit
   metadata.

### Input format mapping

| RU input | DB2 `sources.kind` | Locator | Current decision |
|---|---|---|---|
| PDF | `pdf` | `pdf` page/bbox | Exact fit |
| XLSX/CSV | `spreadsheet` | `spreadsheet` sheet/cellRange | Exact fit |
| JPG/PNG | `image` | `image` coordinateSystem/bbox | Exact fit |
| Email | `email` | `email` messageId + paragraph/part | Exact fit after normalization |
| Chat/message export | `plain_text` or `transcript` | matching locator | Adapter must normalize explicitly |
| Audio | `audio` | transcript fragment only after transcript exists | Binary source fits; direct audio locator does not exist |
| DWG preview PDF/PNG | `pdf` or `image` | matching locator | Store the generated preview, not raw DWG semantics |
| Raw `.dwg` | none | none | Unsupported as registered DB2 Source |
| `.rar`/`.zip` | none | none | Expand outside DB2; hash/register each supported leaf |

`dwg-preview` and `message` from `RuPackageFormat` are transport concepts, not DB2
source kinds. Адаптер не должен записывать raw DWG как `plain_text` или архив как
`pdf`.

## 4. Initial Project Graph projection

Следующая таблица фиксирует canonical projection, но её materialization заблокирована
отсутствием initial-ingestion RPC.

| RU entity | Graph projection | Required payload | Edges/evidence |
|---|---|---|---|
| Package file metadata | `source` node | `schemaVersion`, `sourceId`, `originalName`, `mediaType`, `sizeBytes`, `declaredRevision`, `documentStatus` | revision must be tied to a fragment/evidence when it asserts project facts |
| Room/area | `area` node | `schemaVersion`, `name`, optional `areaM2` | parent area `contains` child area when hierarchy exists |
| WBS work item | `item` node | `schemaVersion`, `itemType='work'`, `areaId`, `discipline`, `qty`, `unit`, `status` | work → predecessor `depends_on`; work → area `applies_to` |
| Material/equipment | `item` node | `itemType`, `areaId`, `qty`, `unit`, optional `plannedCostRub` | item → area `applies_to`; item → decision `specified_by` |
| Estimate line | `item` node | `itemType='estimate_line'`, `estimateKind`, `qty`, `unit`, `unitCostRub`, `amountRub` | estimate deliverable → line `depends_on` |
| Estimate/schedule/checklist | `deliverable` node | type-specific immutable snapshot metadata | deliverable → inputs `depends_on` |
| Design requirement | `requirement` node | sourced requirement payload | evidence link required for AI extracted/interpreted revisions |
| Design choice | `decision` node | decision-specific payload | item → decision `specified_by`; decision → area `applies_to` |
| Risk/conflict | `risk` node | source status and explanation | risk → affected node `conflicts_with` |

Payload schema names are required inside JSON because DB2 intentionally keeps
`payload jsonb` generic:

```text
pro-up/source-metadata/0.1
pro-up/area/0.1
pro-up/work-item/0.1
pro-up/material-item/0.1
pro-up/estimate-line/0.1
pro-up/deliverable/0.1
pro-up/decision/0.1
pro-up/risk/0.1
```

All RUB values must be non-negative JavaScript-safe integers where the business
field does not explicitly allow a signed delta. `deltaCostRub` and `deltaDays` may
be signed but must remain safe integers. DB2 does not currently enforce these
payload rules; the route schema and a future ingestion RPC both must validate them.

### Provenance

For every extracted/interpreted fact:

```text
sources
→ source_fragments
→ evidence_links
→ graph_node_revisions
→ version_evidence_links
```

The published version only captures a Source when at least one evidence link points
from a current selected revision to its fragment. Uploading an object alone does not
put it into a version.

## 5. Mapping of RU operations

| RU operation | Current DB2 mapping | Verdict |
|---|---|---|
| Validate/hash package | pure domain + Storage | Partial; DB registration missing |
| Create initial baseline graph | none | Blocked |
| Publish baseline | `publish_version` after graph exists | Supported only after missing ingestion step |
| Build deterministic WBS | pure domain → graph nodes/edges | Projection defined; persistence blocked |
| Calculate estimate | pure domain → item/deliverable revisions | Projection defined; persistence/update blocked |
| Advance procurement state | none | Blocked; do not overload `revise_decision` |
| Revise approved design decision | `revise_decision` | Exact fit |
| Standalone construction change order | no exact mapping | Partial only when it is the consequence of revising one existing decision |
| Upload photo report | Storage + image Source | Partial; registration and acceptance command missing |
| Review change impact | `calculate_impact` + `review_impact` | Exact fit |
| Project-intelligence logical handoff | `build_handoff` | Exact fit after an impact run |
| Construction acceptance/warranty handover | none | Blocked |

### Change order boundary

`revise_decision` atomically creates:

- a new human decision revision;
- confirming human review;
- `change_sets`;
- protected free-text reason in `change_set_reasons`;
- command and audit records.

It can carry validated RU deltas in the new decision payload, but this does not turn
every `RuChangeOrder` into a valid DB2 ChangeSet. A standalone scope item, procurement
event or new variation requires its own explicitly designed command.

### Photo boundary

An accepted photo can become an image Source and evidence for an `item` or
`deliverable`. Current `build_handoff`:

- does not enforce one accepted photo per accepted room;
- does not include `approval` nodes;
- does not freeze warranty object paths;
- does not generate a construction act.

Therefore `canHandover()` is not a database admission rule.

## 6. Exact RPC adapter calls

The adapter sends only the following SQL argument identities.

```text
review_claim(
  project_id uuid,
  target_revision_id text,
  expected_revision_id text,
  expected_state_revision bigint,
  decision text,
  idempotency_key text
)

publish_version(
  project_id uuid,
  expected_latest_version_id text|null,
  expected_state_revision bigint,
  label text,
  selected_revisions jsonb,
  idempotency_key text
)

revise_decision(
  project_id uuid,
  node_id text,
  base_version_id text,
  expected_revision_id text,
  expected_state_revision bigint,
  title text,
  payload jsonb,
  reason_code text,
  protected_reason text,
  idempotency_key text
)

calculate_impact(
  project_id uuid,
  change_set_id text,
  expected_state_revision bigint,
  idempotency_key text
)

review_impact(
  project_id uuid,
  impact_run_id text,
  impact_id text,
  expected_impact_status text,
  disposition text,
  reason_code text,
  expected_state_revision bigint,
  idempotency_key text
)

build_handoff(
  project_id uuid,
  impact_run_id text,
  expected_state_revision bigint,
  idempotency_key text
)
```

Route-level projection, если implementation будет разрешена:

| Server endpoint intent | Auth client | DB/Storage action | Current readiness |
|---|---|---|---|
| enroll organization/project | human/admin bootstrap | missing RPC | Blocked |
| import source | human + authorized server Storage | missing ingest RPC | Blocked |
| load project graph/read model | human | missing query RPC | Blocked |
| review claim | request-bound human | `review_claim` | Ready |
| publish version | request-bound human | `publish_version` | Ready |
| revise design decision | request-bound human | `revise_decision` | Ready |
| calculate impact | server worker | `calculate_impact` | Ready |
| review impact | request-bound human | `review_impact` | Ready |
| build logical handoff | server worker | `build_handoff` | Ready |
| load/download source | human auth + server signed URL | missing DB2 membership/read probe | Blocked |

Mutation results must be parsed as a strict discriminated schema. SQLSTATE/DB2
contract errors are mapped to stable application codes; raw Postgres messages and
private table names are not returned to the browser.

## 7. Handoff hash contract

DB2 is the authority for persisted handoff identity:

```text
hashed field: logicalContent
algorithm: sha256
encoding: utf-8
canonicalization:
  recursive_sorted_object_keys_arrays_preserve_contract_order
excluded volatile fields:
  artifactId
  generatedAt
  jobStatus
```

The adapter must use `artifact.semanticContentHash` returned by
`build_handoff`. It may independently verify that hash, but it must not:

- reuse the current RU fixture golden hash as the DB2 digest;
- include signed URLs or generated timestamps in `logicalContent`;
- hash the whole RPC response;
- recalculate arrays in UI display order.

Current RU fixture hash `sha256:54be…` covers another object shape and remains only a
pure-domain golden test.

## 8. Safe integration sequence

No application implementation starts until the P0 gaps are resolved and repository
scope explicitly permits the RU execution workflow.

```text
1. enrollment + capability command/read contract
2. source/fragment/graph ingestion command
3. RLS-safe project read model
4. Storage authorization probe and compensation contract
5. RU payload schemas and initial graph golden
6. accepted six-RPC adapter
7. only then WBS/procurement/photo/handover commands
8. PG16 + PG17 + application + Storage harness
9. separate production-adoption decision
```
