> Brand-only successor of the corresponding ARCHIDOM document. Product scope and architecture are unchanged except where a later approved addendum explicitly says otherwise.
> Current public brand: RemHaOS. Russian pronunciation: РемХаос. Primary host: https://remhaos.com.

# REMHAOS — PLATFORM ARCHITECTURE V1.1

**Дата:** 27 июля 2026  
**Статус:** целевая техническая архитектура. Подчинена Product Charter v0.5 Canonical.  
Не является продуктовым контрактом и не изменяет публичные обещания, роли, монетизацию и OWNER GATES. При расхождении действует Charter.  
**Рынок первого запуска:** Россия  
**Публичный язык:** русский  
**Технический принцип:** четыре доменных модуля работают поверх единого Project Intelligence Core; Studio Intelligence является общим платформенным слоем и коммерческим пакетом, но не Module 5. Названия `* Intelligence` являются внутренней классификацией.

## 1. Финальное решение

RemHaOS — единая операционная система интерьерного и архитектурного проекта. Заказчик, дизайнер, архитектор и команда исполнения работают с одним Project Graph, одной историей решений, единой системой версий и единым audit trail.

AI в RemHaOS не является отдельным чатом и не получает право молча переписывать проектную правду. Он запускает контролируемые действия и workflows, показывает источники, формирует предложения изменений и передаёт результат уполномоченному человеку на проверку и утверждение.

### Архитектурная классификация

- Module 1 — Intake Intelligence.
- Module 2 — Design Intelligence.
- Module 3 — Documentation Intelligence.
- Module 4 — Execution Intelligence.
- Shared Platform — Project Intelligence Core + Studio Intelligence + AI Orchestration.
- Studio Intelligence — коммерческий пакет и административный раздел, но не пятый доменный модуль.
- Первая реализация нового слоя — вертикальный workflow Module 1.

## 2. Целевая архитектура

```text
REMHAOS EXPERIENCE LAYER
│
├── Studio Home
├── Project Workspace
├── Client Portal
├── Contextual AI Actions
├── Automations
└── Studio Settings
     │
     ▼
DOMAIN WORKSPACES
│
├── Module 1 — Client / Intake
├── Module 2 — Design
├── Module 3 — Documentation
└── Module 4 — Execution
     │
     ▼
AI ORCHESTRATION LAYER
│
├── Action Registry
├── Skill Registry
├── Workflow Engine
├── Workflow Runs
├── Context Builder
├── Model Gateway
├── Tool Gateway
├── Human Approval Gates
├── Permission Policies
└── AI Audit
     │
     ▼
REMHAOS PLATFORM CORE
│
├── Project Graph
├── Project Memory
├── Studio Memory
├── Decision Ledger
├── Document Engine
├── Version Engine
├── Approval Engine
├── Budget Core
├── Audit / Evidence Layer
└── Project Event Bus
     │
     ▼
INTEGRATION GATEWAY
│
├── File Import
├── Email
├── Cloud Storage
├── Messaging
├── Calendar
├── CAD / BIM
├── CRM / Accounting
├── Webhooks
└── MCP Adapters
```

## 3. Project Workspace

Project Workspace — основной пользовательский интерфейс вокруг Project Graph, а не папка документов и не пустой AI-чат.

```text
Project
├── Overview
├── Client
├── Design
├── Documentation
├── Execution
├── Decisions
├── Documents
├── Budget
├── Team
└── Automations
```

Overview показывает стадию, активные блокеры, ожидающие согласования, последние решения, изменения бюджета, актуальные версии, следующие действия и историю активности.

Главными объектами являются структурированные факты, требования, решения, версии и связи. Документы являются представлением этих данных, а не отдельным источником истины.

## 4. Project Graph и Project Memory

Минимальная сквозная цепочка:

```text
Source
→ ProjectFact / Requirement / Constraint
→ Decision
→ Room / Area
→ Deliverable / Drawing / Specification
→ Version
→ Approval
→ SiteTask / Purchase / Observation
→ ChangeImpact / Evidence
```

Каждый AI-вывод имеет:
- источник;
- статус `EXTRACTED`, `INTERPRETED`, `UNKNOWN` или `HUMAN_CONFIRMED`;
- версию;
- автора или skill;
- время создания;
- область действия;
- историю подтверждений и отмен.

## 5. Studio Memory

Используется единый термин `Studio Memory`. Не создавать параллельные Company Memory, Organization Memory и память Module 5.

```text
Studio
├── Brand Assets
├── Terminology
├── Naming Standards
├── Room Types
├── Document Templates
├── Proposal Templates
├── Contract Templates
├── Rate Tables
├── Drawing Standards
├── Preferred Materials
├── Supplier Rules
├── Approval Policies
├── QA Checklists
├── Standard Risks
├── Skills
└── Workflow Templates
```

Приоритет правил:

```text
Approved specific decision
> Project override
> Studio standard
> Platform default
```

## 6. Skills Library

Skill является не сохранённым промптом, а версионируемым исполняемым контрактом.

Минимальный `SkillDefinition`:
- id;
- name;
- owning_module;
- version;
- allowed_roles;
- required_inputs;
- context_sources;
- allowed_tools;
- output_schema;
- permitted_writes;
- approval_policy;
- audit_policy;
- status.

Движок общий. Владение skills:
- M1: intake;
- M2: design;
- M3: documentation;
- M4: execution;
- Platform: studio administration и общие операции.

## 7. AI Actions вместо AI Chat

Основной цикл:

```text
Запустить действие
→ получить структурированный результат
→ проверить источники и diff
→ подтвердить
→ записать новую версию в Project Graph
```

Чат остаётся вспомогательным интерфейсом поиска, объяснения и запуска зарегистрированных действий. Чат не хранит проектную правду.

## 8. Workflow Engine

Сначала реализуются фиксированные версионируемые Workflow Templates. Визуальный Workflow Builder и marketplace откладываются до доказательства нескольких рабочих процессов.

Минимальный `WorkflowDefinition`:
- id;
- name;
- version;
- owning_module;
- trigger;
- steps;
- conditions;
- role_permissions;
- human_gates;
- retry_policy;
- rollback_policy;
- output_contract;
- audit_policy.

Минимальный `WorkflowRun`:
- status;
- initiated_by;
- current_step;
- input_snapshot;
- output_snapshot;
- pending_approval;
- errors;
- tool_calls;
- created_entities;
- audit_events.

## 9. Integration Gateway

MCP является одним адаптером, а не архитектурой интеграций.

```text
Integration Gateway
├── Native Connectors
├── OAuth Connectors
├── Webhooks
├── File Importers
├── Email Ingestion
├── MCP Adapters
└── CAD Plugins
```

Каждая интеграция имеет scopes, разрешённые проекты, read/write permissions, credential reference, sync policy и audit log.

Порядок подключения:
1. Google Drive / Dropbox.
2. Gmail / Outlook.
3. Calendar.
4. PDF, DOCX, CSV, XLSX.
5. Telegram / WhatsApp ingestion.
6. DWG / IFC import.
7. CAD/BIM plugins.
8. CRM, бухгалтерия и платежи.

## 10. Design System

Состоит из:
- Studio Asset Library;
- Document Rendering Engine.

Поток:

```text
Structured Project Data
→ Document Template
→ Studio Design System
→ PDF / DOCX / Presentation / XLSX
```

Содержание и оформление разделены. Изменение фирменного стиля не изменяет бизнес-логику документа.

## 11. Роли и human gates

AI не обходит полномочия.

- Client: отвечает, комментирует, согласует разрешённые решения.
- Designer: создаёт и выпускает дизайн-решения.
- Architect: выпускает документацию и закрывает технические конфликты.
- Site Manager: создаёт фиксации, RFI и запросы изменений, но не утверждает изменение проектной истины.
- Owner / Studio Admin: управляет templates, skills, workflows, integrations и policies.

Любое изменение утверждённых данных создаётся как `ChangeRequest`. После human review и утверждения Impact Assessment оно может перейти в `ChangeOrder`, после чего создаётся новая baseline revision.

## 12. Модули

### Module 1 — Intake Intelligence
Бриф → факты → вопросы → паспорт → риски → scope → стоимость → КП → договорный черновик.

Ключевые сущности:
`ProjectFact` — надтип (`fact_type = requirement | constraint | assumption | open_question`), а также `Risk`, `Decision`, `ScopeItem`, `BudgetExpectation`, `ProposalVersion`, `ContractVersion`.

### Module 2 — Design Intelligence
Паспорт → концепции → варианты → материалы → мебель → бюджет → согласование.

Ключевые сущности:
`DesignConcept`, `ConceptOption`, `MaterialSelection`, `FurnitureSelection`, `RoomDecision`, `DesignConstraint`, `ClientFeedback`, `ConceptApproval`, `BudgetImpact`.

### Module 3 — Documentation Intelligence
Утверждённые решения → чертежи → спецификации → QA → выдача → передача.

Ключевые сущности:
`DrawingSet`, `DrawingSheet`, `DrawingRevision`, `Specification`, `Schedule`, `DocumentIssue`, `Transmittal`, `TechnicalConflict`, `ChangeImpact`, `ApprovalStatus`, `SupersededVersion`.

### Module 4 — Execution Intelligence
Выданный пакет → задачи → RFI → отклонения → изменения → замены → приёмка → Evidence Pack.

Ключевые сущности:
`SiteTask`, `SiteObservation`, `RFI`, `ChangeRequest`, `SubstitutionRequest`, `Defect`, `Inspection`, `EvidenceItem`, `ProgressRecord`, `CostImpact`, `ScheduleImpact`, `HandoverItem`.

## 13. Первый вертикальный workflow

```text
Client Brief
→ Extract Facts
→ Human Review
→ Generate Missing Questions
→ Update Answers
→ Create Project Passport
→ Create Risk Register
→ Create Scope
→ Calculate Fee
→ Generate Proposal
→ Approval
→ Issue Proposal
```

Он обязан использовать общий фундамент:
- Project Memory;
- Studio Memory;
- Skill Registry;
- Workflow Engine;
- Approval Gate;
- Document Version;
- Audit Log;
- Project Event Bus.

## 14. Запрещённые архитектурные решения

- Не создавать Module 5 в доменной модели.
- Не создавать отдельную память Studio Intelligence.
- Не строить marketplace skills сейчас.
- Не начинать с визуального Workflow Builder.
- Не подключать все интеграции одновременно.
- Не давать AI право молча менять утверждённые данные.
- Не делать AI Chat главным экраном.
- Не хранить документы отдельно от структурированных сущностей.
- Не дублировать решения между M2, M3 и M4.
- Не строить универсальный Platform Core без первого vertical slice.

## 15. Канонические дополнения v1.1

### 15.1 Decision lifecycle

```text
draft → in_review → approved → superseded → archived
                 ↘ rejected
```

### 15.2 Workflow lifecycle

```text
queued
→ running
→ waiting_for_human | pending_cost_confirmation | retrying
→ completed | failed | cancelled | rolled_back
```

### 15.3 AI cost instrumentation

Каждый action имеет `cost_class`. Каждый metered вызов записывается в `ai_calls` с provider/model, tokens, cost estimate в рублях, duration, outcome и retry relation.

### 15.4 Studio standard drift

`StudioStandard` версионируется. Изменение стандарта создаёт `standard_drift` audit event, но не переписывает утверждённое решение.

### 15.5 Self approval

`approval_requests.self_approved = true`, если инициатор и подтверждающий совпадают. Публичная формулировка: «подтверждено автором действия».

### 15.6 Integration gate

Порядок интеграций не является разрешением. До закрытия OWNER GATE по 152-ФЗ действуют ограничения Charter v0.5 §12. Почта, messaging, calendar, CRM/accounting заблокированы.

### 15.7 Project Graph Contract

Допустимые ребра и обязательные связи определены в `REMHAOS_ENTITY_CATALOG_v1.md`. Новые типы связей не добавляются ad hoc.
