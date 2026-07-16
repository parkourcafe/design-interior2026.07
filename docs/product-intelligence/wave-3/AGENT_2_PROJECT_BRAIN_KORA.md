# ТЗ агента 2 — Project Brain, M2/M3 и Kora

## Миссия

Превратить Kora manifest и Project Intelligence primitives в DB-ready application
workflow полного проекта.

## Входы

- Product Charter v0.3.
- Kora source manifest и static demo.
- Project Intelligence domain/application.
- Foundation interfaces агента 1.
- Existing vertical-slice fixtures and golden tests.

## Обязательные задачи

### B1. Kora DB-ready fixture

Создать sanitized golden:

- UUID organization/project;
- 209 manifest records;
- 81 materialized source hashes;
- 128 placeholders без выдуманного checksum;
- hierarchy: project/package/floor/zone/discipline;
- current/previous/reference/unknown;
- duplicate aliases;
- semantic conflict quarantine;
- минимум один approved baseline path;
- no-change и changed-version paths.

Fixture должен создаваться воспроизводимым sanitized scanner/import planner. Скрипт
не должен публиковать абсолютные пользовательские пути.

### B2. Import planning

Разделить import на:

1. inventory registration;
2. bytes materialization;
3. checksum/source registration;
4. fragment/evidence extraction;
5. human review;
6. baseline candidate;
7. baseline publication.

Placeholder не становится evidence до materialization/hash.

### B3. M2 typed revisions

Реализовать application contracts для:

- Requirement;
- Assumption;
- DecisionRevision;
- SelectionRevision;
- PriceObservation;
- ApprovalPackage.

Каждая revision:

- immutable;
- source/evidence-linked либо human-origin;
- имеет claim/review status;
- не становится approved автоматически;
- сохраняет reason при изменении.

### B4. Selection workflow

P0 actions:

- create selection candidate;
- bind to area/package/decision;
- attach source and price observation;
- submit approval package;
- approve/reject/request change;
- supersede previous revision;
- expose exact revision in baseline/release.

### B5. M3 baseline and package

Реализовать application orchestration:

- completeness checks;
- conflict/quarantine review;
- package hierarchy;
- baseline candidate;
- human approval;
- immutable ProjectBaseline;
- immutable ProductionPackageVersion;
- release descriptor and semantic hash.

Если current DB2 relations недостаточно, подготовить interface request на явные
сущности:

- `project_packages`;
- `production_package_versions`;
- `release_artifacts`;
- `release_distributions`;
- `release_acknowledgements`.

Не маскировать package под room или произвольный task/item.

### B6. Change and impact

Сквозной golden:

- изменить одно confirmed decision/selection;
- создать ChangeRequest/ChangeSet;
- опубликовать новую baseline;
- вычислить deterministic impact;
- провести human dispositions;
- собрать новый handoff/release;
- доказать, что V1 не изменился.

### B7. Domain hardening

Закрыть:

- WBS false cross-room dependencies;
- safe-integer RUB validation;
- strict ChangeOrder schema/status transitions;
- exact `sha256:` handoff validation;
- deterministic message normalization;
- explicit no-change terminal path.

Если задача требует новой persistence surface, не менять migration самостоятельно:
создать interface request Агенту 1.

## File ownership

Рекомендуемый scope:

- `lib/project-intelligence/modules/decisions/**`;
- `lib/project-intelligence/modules/package/**`;
- `lib/project-intelligence/modules/execution/**` для pure/application rules;
- `fixtures/project-intelligence/kora/**`;
- `scripts/project-intelligence/kora/**`;
- contract/integration tests;
- agent report.

Не изменять migrations, auth и presentation UI.

## Acceptance scenarios

1. Full Kora inventory сохраняет 209 physical records.
2. Все 81 materialized sources имеют exact checksum.
3. 128 placeholders не имеют checksum/evidence.
4. Duplicate bytes не создают разные logical sources.
5. Восемь semantic conflicts остаются quarantined до human review.
6. Baseline нельзя опубликовать при unresolved required conflict.
7. Selection approval относится к exact revision.
8. Изменение создаёт V2, не меняя V1.
9. Impact roots выводятся сервером из diff.
10. Repeat build даёт тот же semantic hash.
11. Повторный handoff с другим idempotency key возвращает controlled existing
    artifact outcome, а не raw unique-constraint error.
12. Static public assets не содержат реальный production manifest, filenames или
    paths.

## Definition of Done

```text
KORA_DB_GOLDEN=true
M2_DECISIONS_SELECTIONS=true
M3_BASELINE_RELEASE=true
CHANGE_IMPACT_GOLDEN=true
NO_ROOM_ONLY_REDUCTION=true
PRODUCTION_CHANGED=false
```

## Handoff интегратору

- public application interfaces;
- golden fixtures;
- schema/interface requests;
- test output;
- known limitations;
- demo script from full project to one change and new release.
