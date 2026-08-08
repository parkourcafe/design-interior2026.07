> SUPERSEDED_BY_BRAND_RENAME_2026-07-28. CURRENT_BRAND: RemHaOS. Successor package: docs/canonical/remhaos-v1/. Historical content preserved for provenance.

# ARCHIDOM — ENTITY & PROJECT GRAPH CATALOG v1

## 1. Правило

Технические идентификаторы английские; публичный UI русский. Новая сущность или relation требует migration, документированного смысла и обновления этого каталога.

## 2. Domain entities

| Technical ID | Публичный канон | Тип |
|---|---|---|
| Source | Источник | entity |
| ProjectFact | — | supertype |
| Requirement | Требование | fact_type |
| Constraint | Ограничение | fact_type |
| Assumption | Допущение | fact_type |
| OpenQuestion | Неизвестное | fact_type |
| Risk | Риск | entity |
| Decision | Решение | entity |
| Room | Помещение/зона | entity |
| ScopeItem | Позиция scope | entity |
| BudgetExpectation | Бюджетная рамка | entity |
| MaterialSelection | Выбранный материал | entity |
| DrawingSet | Комплект документов | entity |
| DrawingSheet | Лист | entity |
| Specification | Спецификация | entity |
| SpecificationItem | Позиция | entity |
| TechnicalConflict | Технический конфликт | entity |
| SiteTask | Задача площадки | entity |
| SiteObservation | Фотофакт/наблюдение | entity |
| RFI | Запрос разъяснения | entity |
| ChangeRequest | Запрос изменения | entity |
| ChangeOrder | Утверждённое изменение | state/entity record |
| ImpactAssessment | Оценка влияния | entity |
| Inspection | Приёмка | entity |
| EvidenceItem | Доказательство | entity |

## 3. Platform entities

`SkillDefinition`, `ActionDefinition`, `WorkflowDefinition`, `WorkflowRun`, `WorkflowStepRun`, `ApprovalRequest`, `Connection`, `StudioStandard`, `AiCall`, `AuditEvent`.

## 4. Allowed core relations

| From | Relation | To | Requirement |
|---|---|---|---|
| Project | HAS_SOURCE | Source | optional-many |
| Source | SUPPORTS | ProjectFact/Risk | required for extracted/interpreted |
| ProjectFact | AFFECTS | Room/ScopeItem/BudgetExpectation | optional-many |
| ProjectFact | INFORMS | Decision | optional-many |
| Decision | APPLIES_TO | Room/MaterialSelection/Deliverable | required-one-or-more |
| Decision | SUPERSEDES | Decision | optional-one |
| Decision | REQUIRES | ApprovalRequest | conditional |
| DrawingSheet | IMPLEMENTS | Decision | required for issued drawings |
| SpecificationItem | IMPLEMENTS | Decision/MaterialSelection | required |
| ChangeRequest | CHANGES | Decision/Deliverable/SpecificationItem | required-one-or-more |
| ImpactAssessment | ASSESSES | ChangeRequest | required-one |
| ChangeOrder | APPROVES | ChangeRequest | required-one |
| BaselineRevision | INCORPORATES | ChangeOrder | required-one-or-more |
| SiteTask | BASED_ON | BaselineRevision/Deliverable | required |
| SiteObservation | EVIDENCES | SiteTask/Decision/Deliverable | required |
| RFI | QUESTIONS | Decision/Deliverable | required |
| Inspection | ACCEPTS_OR_REJECTS | SiteTask/Deliverable | required |
| WorkflowRun | CREATES_OR_UPDATES | Domain Entity | audited |
| AiCall | EXECUTES | ActionDefinition | required |

## 5. Forbidden shortcuts

- документ без связи с Project/Version;
- AI факт без Source;
- approved Decision без Approval evidence, кроме явно self-approved;
- SiteTask без действующей baseline/version;
- ChangeOrder без ChangeRequest и ImpactAssessment;
- silent overwrite вместо SUPERSEDES;
- module-specific copy of shared truth.
