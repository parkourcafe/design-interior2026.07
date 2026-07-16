# ProjectCEO RU — Master Execution Plan, Wave 3

Дата: 17 июля 2026 года.
Статус: план подготовки pilot-ready P0.
Источник продуктовой истины:
`ProjectCEO_Russia_Product_Charter_v0.3_2026-07-17.docx`.

Gate 0 завершён 17 июля 2026 года: release gate, DB2 PostgreSQL 16/17 и Git
materialization прошли. Зафиксированный результат:
`docs/product-intelligence/wave-3/GATE_0_REPORT.md`.

## 1. Цель

Собрать один DB-backed сквозной ProjectCEO workflow для российского продукта:

```text
M1 Project Passport
→ M2 Decisions & Selections
→ M3 Production Package & Release
→ M4 Distribution, Change & Acceptance
```

Kora Food Hall используется как эталонный полноразмерный проект около 1 800 м².
Помещение, этаж, дисциплина или package являются представлениями полного Project
Graph, а не отдельными уменьшенными проектами.

P0 считается завершённым не по количеству экранов, а когда на одном живом проекте:

1. владелец создаёт организацию и проект;
2. приглашает архитектора и исполнителя;
3. загружает или регистрирует источники;
4. человек подтверждает baseline и решения;
5. система выпускает immutable production package;
6. участник получает только разрешённый package и подтверждает получение;
7. одно реальное изменение создаёт новую revision, ChangeRequest, impact review и
   новую baseline/package version;
8. audit позволяет восстановить кто, что, когда и на основании какого источника
   изменил;
9. тот же workflow повторяется на втором проекте одной организации.

## 2. Фактическая исходная точка

### Уже существует

- Architecture v1 и Project Intelligence domain/application contracts.
- Локальный DB2-контур из 31 private relation и шести mutation RPC.
- Локальный DB2 harness, прошедший PostgreSQL 16 и 17, RLS, concurrency,
  idempotency, immutability, rollback и restart replay.
- Pure-domain путь review → V1 → change → V2 → impact → logical handoff.
- RU domain seams для import, WBS, estimate, procurement state, change order,
  photo report и handover.
- Kora manifest: 209 источников, 81 materialized/hashed, 128 placeholders,
  28 unique blobs, 18 duplicate groups, 8 semantic-conflict groups.
- Read-only Kora demo с поиском, provenance, quarantine и review queue.
- Legacy M1: brief, Project Passport, risks, proposal и базовая team/project-room
  функциональность.

### Не завершено

- Gate 0 закрыт: `lint`, `typecheck`, 223/223 tests, build и DB2 PG16/PG17
  проходят; materialized baseline зафиксирован.
- Нет application enrollment для Organization/Project.
- Нет безопасных Invitation/AccessGrant контрактов ProjectCEO.
- Нет initial ingestion RPC и DB-backed Kora import.
- Нет RLS-scoped read model.
- Нет Storage authorization probe и source registration workflow.
- Нет application/API adapters для шести DB2 RPC.
- Нет DB-backed экранов ProjectCEO.
- Нет persisted selections, procurement transition, photo acceptance и
  construction handover.
- Legacy `studio_members` и token-based `project_rooms` не являются целевой
  ProjectCEO access model.

### Текущая готовность модулей

| Модуль | Статус | Краткий вывод |
|---|---|---|
| M1 Presale | PARTIAL / legacy exists | Workflow существует, но baseline сломан, бренд и ownership не соответствуют ProjectCEO v0.3 |
| M2 Decisions & Selections | PARTIAL | Revision/review/change primitives есть, но selection/approval product flow и DB projection отсутствуют |
| M3 Production Package | PARTIAL | Kora inventory/demo и immutable version core есть, но ingestion, hierarchy, baseline UI и release отсутствуют |
| M4 Execution & Change | EARLY / MISSING | Impact/logical handoff есть; distribution, acknowledgement, photo acceptance и construction handover отсутствуют |

### Критические риски, которые нельзя переносить в ProjectCEO

- Legacy invitation активируется по совпадению email и даёт равный доступ ко всей
  студии.
- Текущая password registration может подтвердить email без доказанного владения
  почтовым ящиком.
- Legacy participant tokens хранятся plaintext, не имеют полного expiry/revoke
  lifecycle и обслуживаются через admin client.
- Organization membership DB2 пока не ограничен project/package scope.
- Один legacy project технически может быть enrolled в несколько organizations.
- Storage keys legacy flow могут содержать original filename.
- Некоторые signed URLs живут дольше целевых 15 минут.
- Static Kora manifest нельзя публиковать в production: он раскрывает реальные
  имена и структуру файлов.

## 3. Четыре продуктовых модуля

### M1 — Presale / Project Passport

Текущий статус: функционально существует, но требует стабилизации и моста в новое
ядро.

P0 output:

- immutable `ProjectPassportSnapshot`;
- Organization и Project identity;
- source-linked scope/requirements/assumptions;
- передача подтверждённого результата в M2/M3 без копирования вручную.

Осталось:

- восстановить зелёный baseline legacy приложения;
- заменить пользовательский бренд на ProjectCEO в RU product flow;
- создать explicit `promote passport to Project Brain` command;
- обеспечить version/source identity при передаче;
- не смешивать legacy studio ownership и ProjectCEO membership.

### M2 — Decisions & Selections

Текущий статус: graph/revision/review/change primitives существуют; product workflow
и persistence projection не завершены.

P0 output:

- Requirement/Assumption/Decision/Selection с immutable revisions;
- источник и evidence для каждого извлечённого или интерпретированного факта;
- human review exact revision;
- approval package;
- price observation с валютой RUB и датой проверки;
- change reason и связь с baseline/version.

Не P0:

- marketplace;
- автоматический заказ;
- бухгалтерия;
- supplier master-data platform;
- AI, который самостоятельно утверждает selection.

### M3 — Source Registry, Baseline & Production Release

Текущий статус: Kora manifest и static demo существуют; DB-backed workflow отсутствует.

P0 output:

- `Project → Package → Zone/Room → Discipline → Source/Artifact`;
- checksum/provenance и immutable source revisions;
- current/previous/reference/unknown;
- exact-hash dedupe;
- semantic-name conflict quarantine;
- completeness/conflict review;
- approved ProjectBaseline;
- immutable ProductionPackageVersion;
- logical export с semantic hash.

Не P0:

- native DWG authoring;
- CAD/BIM plugin;
- автоматическое утверждение листов;
- удаление старых revisions.

### M4 — Distribution, Change & Acceptance

Текущий статус: impact/handoff primitives существуют; field workflow не завершён.

P0 output:

- role-scoped distribution;
- expiring/revocable guest access;
- acknowledgement exact package hash/version;
- ChangeRequest с причиной, инициатором, delta RUB/days;
- deterministic impact + human disposition;
- новая baseline/package version;
- photo evidence, milestone acceptance и handover archive в узком P0-контракте.

Не P0:

- полный ERP;
- складской учёт;
- бухгалтерия;
- универсальный task manager;
- тяжёлый стройконтроль;
- полноценная WhatsApp-auth интеграция.

## 4. Обязательный Gate 0 — Restore Trustworthy Baseline

До новых функциональных веток выполняется последовательно.

### G0.1 Snapshot

- Зафиксировать список tracked/untracked/deleted файлов.
- Не удалять и не восстанавливать пользовательские изменения без provenance.
- Определить intended state для:
  - `lib/i18n/ru.ts`;
  - `app/legal/privacy/page.tsx`;
  - legacy migrations `0001–0008`;
  - файлов `* 2.ts`;
  - Architecture frozen manifest;
  - domain contract runtime exports.

### G0.2 Repository contract

- Согласовать `AGENTS.md` с Product Charter v0.3 либо создать отдельный
  ProjectCEO implementation root с собственным contract.
- Пока старый guardrail действует, specifications/procurement/construction workflow
  можно проектировать и тестировать, но нельзя выдавать за разрешённый production
  scope.

### G0.3 Green baseline

Обязательный результат:

```text
npm run lint       PASS
npm run typecheck  PASS
npm run test       PASS
npm run build      PASS
git snapshot       MATERIALIZED
```

### G0.4 Freeze

- Обновить frozen-input manifests только после review фактических изменений.
- Зафиксировать один baseline commit/hash для Wave 3.
- Все агенты начинают работу от одного snapshot.

## 5. Последовательность исполнения

### Wave A — Foundation contracts

Выполняется после Gate 0.

Результат:

- Organization/Project enrollment;
- ProjectMembership;
- Invitation/AccessGrant;
- project-scoped read model;
- Storage authorization;
- initial source/graph ingestion;
- stable API error envelope;
- DB-ready Kora golden fixture.

До DB design отдельно замораживаются:

- стабильная Package identity;
- invariant «один Project enrolled ровно в одну Organization»;
- role/capability matrix;
- verified recipient binding для приглашений.

Это общий блокирующий слой. UI и product modules не должны создавать прямые записи
в private tables или реконструировать authorization в TypeScript.

### Wave B — Параллельные product streams

После принятия Foundation:

- Stream B1: M2 Decisions & Selections.
- Stream B2: M3 Kora Registry, Baseline & Release.
- Stream B3: role-scoped ProjectCEO UI и thin M4 Distribution/Change.

Каждый stream работает через принятые ports/RPC/read DTO и не меняет чужие
контракты самостоятельно.

### Wave C — Cross-module vertical slice

Сценарий:

```text
Organization
→ Invitation
→ Kora ingestion
→ human source review
→ ProjectBaseline V1
→ approved Decision/Selection
→ ProductionPackageVersion 1
→ distribution + acknowledgement
→ decision change
→ ChangeRequest
→ impact review
→ ProjectBaseline V2
→ ProductionPackageVersion 2
→ acknowledgement
```

### Wave D — Hardening

- PG16/PG17 disposable runs.
- RLS and negative tenancy.
- same-key replay and different-digest conflict.
- multi-session races.
- object-storage retry and orphan cleanup.
- immutable snapshots and append-only audit.
- signed URL expiry/revocation.
- MIME/size limits.
- mobile/keyboard/accessibility.
- failure, empty, loading and stale-state UX.

### Wave E — Paid pilot gate

- Kora работает как full-project proof.
- Три оплаченных клиента имеют договорённый scope и success criteria.
- Минимум два handoff/package реально использованы downstream.
- Минимум одна организация запускает второй проект.
- Измеряются time-to-baseline, package review time, change cycle и avoided rework.

Production adoption оформляется отдельным решением после green gate.

## 6. Распределение между тремя агентами и интегратором

### Агент 1 — Core, DB, Access

Владеет:

- additive migrations;
- Organization/Project enrollment;
- membership/capabilities;
- Invitation/AccessGrant;
- RLS read model;
- Storage authorization;
- initial ingestion transaction;
- DB/API adapter acceptance;
- PG16/PG17 harness.

Не владеет UI, product copy и Kora presentation.

### Агент 2 — Project Brain и Kora workflow

Владеет:

- DB-ready Kora fixture/import mapping;
- source register, dedupe, quarantine;
- package hierarchy;
- M2 Decision/Selection application rules;
- baseline/release application orchestration;
- change/impact/handoff integration;
- golden fixtures and contract tests.

Не меняет migrations напрямую. Новые persistence needs передаёт Агенту 1 через
interface request.

### Агент 3 — Product UI, Roles и Pilot Readiness

Владеет:

- ProjectCEO navigation and naming;
- onboarding;
- invitation UX;
- owner/architect/builder/client views;
- sources/review/baseline/release/change screens;
- distribution/acknowledgement UI;
- mobile/WhatsApp-friendly share links;
- analytics events;
- browser and accessibility QA.

Не использует admin client для human operations и не пишет напрямую в private
tables.

### Главный интегратор

Владеет:

- Gate 0;
- frozen contracts;
- shared DTO approval;
- task sequencing;
- merge/integration;
- cross-module tests;
- security review;
- product acceptance;
- reports and final production-adoption proposal.

## 7. Merge policy

1. Один владелец на изменяемый shared file.
2. Existing migration files immutable; только additive migrations.
3. Domain/application/adapters/delivery не смешиваются.
4. UI получает server-derived actor/scope.
5. Ни один agent не использует direct private-table runtime access.
6. Каждый merge сопровождается:
   - scope report;
   - changed files;
   - commands/tests;
   - known gaps;
   - rollback note.
7. Интегратор принимает stream только после его локального Definition of Done.

## 8. Общий Definition of Done

### Product

- Пользователь проходит полный P0 flow без ручной записи в Supabase.
- Kora остаётся единым проектом около 1 800 м².
- Room/package filters не разрывают Project Graph.
- Изменение всегда связано с причиной, revision, impact и новой выдачей.

### Data and security

- Actor/organization/project/role выводятся server-side.
- RLS/ACL deny-by-default.
- Guest grants hashed, expiring, scoped and revocable.
- Snapshots, evidence and handoffs immutable.
- Audit append-only.
- PII/source text/original filenames/signed URLs отсутствуют в structured logs.

### Engineering

- lint/typecheck/test/build green.
- PG16 and PG17 green.
- concurrency, idempotency, rollback and restart replay green.
- golden Kora scenario green.
- no direct private-table application access.

### Commercial

- три paid pilot scopes зафиксированы;
- минимум два downstream package uses;
- минимум один second-project start;
- production adoption decision оформлен отдельно.

## 9. Что делаем первым

Первое исполнимое действие — Gate 0. После зелёного baseline Агент 1 начинает
Foundation, а Агенты 2 и 3 готовят fixtures/UI against frozen interfaces. Полная
feature-разработка M2–M4 начинается только после принятия enrollment, ingestion и
read model.
