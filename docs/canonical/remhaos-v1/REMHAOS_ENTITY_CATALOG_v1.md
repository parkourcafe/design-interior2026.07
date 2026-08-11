> Brand-only successor of the corresponding ARCHIDOM document. Product scope and architecture are unchanged except where a later approved addendum explicitly says otherwise.
> Current public brand: RemHaOS. Russian pronunciation: РемХаос. Primary host: https://remhaos.com.

# REMHAOS — ENTITY & PROJECT GRAPH CATALOG v1

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

## 3.1 Integration Gateway entities (A7 / DEC-031)

Сущности **шлюза интеграций**, не доменные. Они принадлежат
`Integration Gateway → Messaging` и живут в собственных таблицах: доменные
таблицы M1–M4 внешних идентификаторов канала не получают (INV-T7).

| Technical ID | Публичный канон | Тип | Смысл |
|---|---|---|---|
| ProjectChannelBinding | Подключённый чат проекта | entity | связь проекта с одним внешним чатом; ≤1 активной на проект и на чат (INV-T1) |
| ChannelIdentityLink | Связанный аккаунт канала | entity | внешний **числовой** user ID ↔ аккаунт RemHaOS (INV-T2); полномочий не даёт (INV-T3) |
| ChannelLinkIntent | Одноразовое намерение | entity | nonce для связывания identity и для подключения чата: в базе только hash, TTL, одноразовость, отзыв (INV-T5) |
| ChannelEvent | Событие канала | entity | нормализованное входящее сообщение; повтор внешнего update даёт один event; правка даёт новую ревизию источника |
| ChannelAttachment | Вложение канала | entity | метаданные и карантинный статус файла; до `CLEAN` недоступен ни человеку, ни AI |
| ProjectInboxCandidate | Кандидат входящих | entity | неподтверждённое предложение из канала; официальным объектом становится только человеческой командой (INV-T4) |
| NotificationOutbox | Очередь уведомлений | entity | исходящие уведомления; `at-least-once` + внутренняя дедупликация |

Допустимые рёбра:

| From | Relation | To | Requirement |
|---|---|---|---|
| Project | HAS_CHANNEL_BINDING | ProjectChannelBinding | optional-one-active |
| ProjectChannelBinding | RECEIVES | ChannelEvent | required-one (у события всегда есть привязка) |
| ChannelEvent | CARRIES | ChannelAttachment | optional-many |
| ChannelEvent | PROPOSES | ProjectInboxCandidate | required-one (у кандидата всегда есть источник) |
| ProjectInboxCandidate | CONFIRMED_INTO | Domain Entity | optional-one, **только** через человеческую команду |
| ChannelIdentityLink | IDENTIFIES | ChannelEvent sender | optional-one; отсутствие связи означает `unverified`, а не отказ в приёме |
| NotificationOutbox | NOTIFIES_ABOUT | persisted domain state | required-one |

Запрещённые сокращения этого раздела (в дополнение к §5):

- официальный объект, созданный из кандидата **без** человеческой команды;
- кандидат без `ChannelEvent`;
- вложение, переданное AI или человеку до статуса `CLEAN`;
- поле внешнего идентификатора канала в доменной таблице M1–M4;
- вторая история переписки рядом с Project Memory (DEC-002).

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
