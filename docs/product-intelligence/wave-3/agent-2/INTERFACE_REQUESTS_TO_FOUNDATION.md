# Agent 2 → Foundation interface requests

Дата: 17 июля 2026 года.
Статус: application contract request; migrations не изменялись.

## Принятый Foundation freeze

Agent 2 использует без переопределения:

- один Project принадлежит ровно одной Organization;
- `ProjectPackage` имеет `project_root | work_package` identity и не является
  Floor/Zone/Room/Discipline;
- Package scope exact: sibling/parent access не наследуется;
- actor, Organization, Project, Package, role и server time выводятся server-side;
- versioned envelope: `contractVersion + requestId + data | error`;
- initial materialized graph использует `ingest_source_graph`;
- чтение delivery идёт через `get_project_delivery`, а не private tables.

Typed application boundary:
`lib/project-intelligence/modules/package/foundation-ports.ts`.

## IF-A2-01 — physical inventory registry

Нужен persistence surface для sanitized physical inventory до materialization:

```text
register_source_inventory
```

Он хранит:

- physical record identity;
- protected display metadata reference;
- exact Project/Package binding;
- Floor/Zone/Discipline graph bindings как отдельные identities/filters;
- availability `materialized | placeholder`;
- document status `current | previous | reference | unknown`;
- checksum/source revision только после materialization;
- duplicate alias и semantic-conflict quarantine.

Placeholder не создаёт Source, SourceRevision, Fragment или EvidenceLink. Повторная
регистрация того же physical identity идемпотентна.

Все physical aliases с одинаковым checksum ссылаются на одну logical Source и одну
SourceRevision identity. Разные SourceRevision ID для exact duplicate bytes должны
возвращать `validation_failed`.

## IF-A2-02 — M2 persistence

Нужны explicit append/transition commands для:

- `DecisionRevision`;
- `SelectionRevision`;
- `PriceObservation`;
- `ApprovalPackage`.

Контракт находится в:

- `lib/project-intelligence/modules/decisions/contracts.ts`;
- `lib/project-intelligence/modules/decisions/ports.ts`.

Требования:

- revisions append-only;
- exact `replaces_revision_id`;
- revision actor имеет тип `human | system`;
- system actor может создать только sourced extracted/interpreted/unknown revision;
- `human_origin` требует human actor;
- extracted/interpreted/unknown revision имеет exact Evidence;
- human-origin фиксирует human actor;
- approval относится к exact revision;
- AI/system не переводит approval в approved/rejected;
- amount RUB — non-negative safe integer, signed delta отдельно;
- status transition имеет CAS, idempotency и controlled audit.

Не маскировать Selection как Room, Task или произвольный Item.

## IF-A2-03 — baseline and package release persistence

Нужны explicit entities/commands:

- `project_baselines`;
- `production_package_versions`;
- `release_artifacts`;
- `release_distributions`;
- `release_acknowledgements`.

`project_packages` используется из Foundation freeze без изменения его смысла.

Минимальные commands:

```text
publish_project_baseline
publish_production_package_version
build_release_artifact
```

Invariants:

- baseline/version immutable после publication;
- baseline publication требует exact human approval для каждого включённого
  RequirementRevision, AssumptionRevision, DecisionRevision и SelectionRevision;
- exact Package ID, exact revision refs и semantic hash;
- `project_root` может публиковать полный baseline; `work_package` обязан передать
  explicit validated subset, и каждый ref должен входить в baseline;
- semantic hash не включает artifact ID, timestamp, job status или signed URL;
- тот же idempotency key + тот же digest возвращает replay;
- другой key + тот же semantic tuple возвращает controlled existing artifact;
- другой digest под тем же key возвращает `idempotency_conflict`;
- V2 никогда не обновляет V1.

## IF-A2-04 — changed and no-change terminal paths

Changed path:

```text
ChangeRequest
→ deterministic baseline diff
→ server-derived impact roots
→ depth-capped impact
→ human dispositions
→ V2 baseline/package/release
```

No-change path должен быть explicit human-approved terminal record, привязанный к
exact baseline/package version. Нельзя создавать фиктивный ChangeSet или ImpactRun.

## IF-A2-05 — Foundation read projection additions

`get_project_delivery` должен вернуть только authorized exact Project/Package:

- latest published ProjectBaseline;
- immutable ProductionPackageVersion list;
- release artifact descriptors;
- distribution/acknowledgement status;
- unresolved impact review count.

Для Package-scoped grant projection не содержит sibling/parent packages, private
source registry, members или audit.

## Security and boundary

- application runtime не читает private relations;
- human mutation не использует service role;
- protected filenames/paths не входят в audit, logs или public DTO;
- static public assets не получают Kora manifest;
- этот запрос не разрешает production apply.
