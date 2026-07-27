# ArchiDom · Product Charter v0.5 · Canonical · Россия

**Дата:** 27.07.2026  
**Статус:** УТВЕРЖДЁННЫЙ ПРОДУКТОВЫЙ КОНТРАКТ  
**Владелец решения:** Селена  
**Заменяет:** Product Charter v0.4 и интегрирует Addendum A1 от 27.07.2026  
**Публичный бренд:** ArchiDom  
**Публичный язык первого рынка:** русский

## 0. Статус и иерархия

Этот Charter определяет продукт, коммерческие границы, публичные обещания, роли, безопасность и открытые гейты. Он выше технической архитектуры и execution briefs по этим вопросам.

Иерархия:

1. **Product Contract:** этот Charter и последующие утверждённые аддендумы.
2. **Technical Architecture:** техническая декомпозиция в рамках Charter.
3. **Execution:** briefs, матрицы и отчёты, фиксирующие задачу и факт реализации.

Код и production behavior являются источником факта о текущем состоянии, но не могут молча изменить продуктовый контракт. Расхождение факта с Charter создаёт задачу или OWNER DECISION.

Термин `SOURCE OF TRUTH` не используется для новых документов. Допустимые классы: `Product Contract`, `Technical Architecture`, `Execution Brief`, `Implementation Report`.

## 1. Продукт одной фразой

**ArchiDom — единая система проектных решений, которая сохраняет память интерьерного проекта, проверяет готовность к каждому следующему этапу и управляет последствиями изменений.**

Коммерческая формула:

> **Не переходите к следующему дорогому этапу вслепую.**

ArchiDom показывает, что подтверждено, чего не хватает, где есть противоречия, кто должен принять решение и что оно изменит в бюджете, сроках, документации и исполнении.

ArchiDom продаёт не AI-чат и не генератор картинок, а управляемость решений, повторяемые процессы и доказуемое состояние проекта.

## 2. Первый рынок и первый плательщик

Основной плательщик первого рынка — интерьерный дизайнер или небольшая студия. Заказчик участвует бесплатно по приглашению.

Design-build компании могут покупать тот же продукт, но не являются отдельным стартовым позиционированием. Ремонтные компании, архитекторы и прорабы не продвигаются одновременно как четыре независимые аудитории.

**Открыто:** точная тарифная сетка и willingness-to-pay подтверждаются пилотами. Гейт первого платежа закрывается разговорами с A-tier, а не дополнительной архитектурой.

## 3. Стартовый сценарий

```text
запрос клиента
→ бриф и исходные материалы
→ извлечённые факты
→ пропуски и противоречия
→ вопросы и риски
→ допущения и исключения
→ предварительный объём работ
→ основание расчёта
→ КП
→ решение о готовности к договору
```

До договора создана **проверенная основа проекта**, а не «проверенный проект».

Первый измеримый результат:

- Project Passport;
- обязательные вопросы;
- реестр рисков;
- допущения и исключения;
- предварительный scope;
- основа стоимости и КП;
- Project Check `READY`, `CONDITIONAL` или `BLOCKED` с причинами.

## 4. Вертикальная архитектура

### M1 · Заказчик / Presale

Вход: запрос, бриф, план, референсы, бюджет, сроки, существующие сметы или КП.  
Работа: факты, вопросы, риски, противоречия, допущения, scope, расчёт, КП, согласование.  
Выход: зафиксированная основа проекта и проверка готовности к КП/договору.  
Статус: текущий продукт и единственный обязательный полный модуль ближайшего запуска.

### M2 · Дизайнер

Вход: утверждённая основа проекта.  
Работа: концепция помещения, варианты, точечные AI-изменения, материалы, бюджет, согласования.  
Выход: утверждённый Design Intent и `DESIGN_FREEZE`.

### M3 · Архитектор

Вход: Design Intent.  
Работа: рабочая документация, room sheets, ведомости, спецификации, версии, комплектность и конфликты.  
Выход: утверждённый пакет и `DOCUMENTATION_RELEASE`.

### M4 · ГлавПрораб

Вход: действующая выданная версия пакета.  
Работа: выдача, получение, RFI, отклонения, замены, фотофиксация, этапы, приёмка, punch list.  
Выход: контролируемое исполнение, история изменений и Evidence Pack.

M4 не превращает ArchiDom в маркетплейс, сервис гарантий, склад, бухгалтерию или строительный ERP.

## 5. Горизонтальное ядро

Четыре модуля используют одну проектную реальность:

1. Project Memory.
2. Project Check.
3. Decision Log.
4. Approval Model.
5. Evidence Layer.
6. Responsibility Model.
7. Change Control.
8. Version Control.
9. Studio Memory.
10. Skills и Workflows.

Это горизонтальный слой, а не Module 5.

`Studio Intelligence` допускается как коммерческое название платного пакета и раздела настроек, но не как отдельный доменный модуль или отдельная память.

Названия `Intake Intelligence`, `Design Intelligence`, `Documentation Intelligence`, `Execution Intelligence` являются только внутренней классификацией и не используются публично.

## 6. Project Check

Статусы:

```text
READY
CONDITIONAL
BLOCKED
```

Статус без причин запрещён.

Минимальные reason codes:

```text
missing_data
conflict_detected
approval_required
professional_review_required
outdated_source
budget_impact_unconfirmed
schedule_impact_unconfirmed
scope_unconfirmed
responsible_person_missing
```

MVP реализует `PROPOSAL_READY` и `CONTRACT_READY`. Остальные checkpoints являются целевым контрактом, а не разрешением строить M2–M4.

## 7. Evidence и Project Memory

Каждый значимый факт, вывод, риск, решение или blocker имеет:

- source_id и тип источника;
- версию или хэш;
- дату;
- автора: человек или алгоритм;
- evidence status;
- confidence для машинного вывода;
- ответственное лицо;
- затронутые сущности;
- влияние на scope, бюджет, срок, документацию или исполнение.

Статусы:

```text
EXTRACTED
INTERPRETED
ASSUMPTION
AI_PROPOSED
HUMAN_CONFIRMED
PROFESSIONAL_REVIEW_REQUIRED
OUTDATED
UNKNOWN
REJECTED
```

Если источник изменился, производные непроверенные выводы получают `OUTDATED` или `PROFESSIONAL_REVIEW_REQUIRED`.

`ProjectFact` является техническим надтипом:

```text
fact_type = requirement | constraint | assumption | open_question
```

Канонические новые доменные сущности: `Risk`, `TechnicalConflict`, `ScopeItem`, `BudgetExpectation`, `RFI`.

## 8. Decision, approvals и самоутверждение

Decision хранит предмет, варианты, выбор, причину, автора, дату, evidence, версию, затронутые сущности и статус.

Lifecycle:

```text
draft → in_review → approved → superseded → archived
```

Допускается `rejected` из `in_review`.

Типы approvals:

```text
CLIENT_APPROVED
DESIGN_APPROVED
INTERNAL_REVIEWED
TECHNICALLY_REVIEWED
RELEASE_AUTHORIZED
RECEIVED_BY_EXECUTOR
ACCEPTED_AS_BUILT
```

Одна универсальная кнопка «Согласовать» запрещена.

Если `initiated_by == decision_by`, фиксируется `self_approved = true`. В интерфейсе и экспорте это отображается как **«подтверждено автором действия»**, а не как независимая проверка.

## 9. Change Control

Каноническая цепочка:

```text
Decision
→ ChangeRequest
→ ImpactAssessment
→ Approval(s)
→ ChangeOrder
→ BaselineRevision
→ повторный Project Check
```

`ProposedChange` не используется. `SubstitutionRequest` является подтипом `ChangeRequest`. `CostImpact` и `ScheduleImpact` являются атрибутами единого `ImpactAssessment`.

## 10. Studio Memory и drift

Приоритет:

```text
approved specific decision
> project override
> studio standard
> platform default
```

`StudioStandard` версионируется. Новая редакция не переписывает утверждённые решения. Для живых решений, основанных на прежней редакции, создаётся `standard_drift` audit event.

Закрытие drift:

1. подтвердить решение как есть;
2. открыть ChangeRequest;
3. отметить неприменимым.

## 11. AI, credits и себестоимость

Любое действие имеет `cost_class`:

```text
free_deterministic
metered_ai
external_paid
```

Каждый `metered_ai` и `external_paid` вызов сохраняет:

- provider/model;
- tokens in/out или другую единицу расхода;
- estimated provider cost в рублях;
- источник оценки;
- длительность;
- outcome;
- связь с project, workflow, step и action;
- retry relation.

Измерение стоимости обязательно с первого Platform Foundation Sprint. Баланс кредитов, покупка и списание пользователю в этот спринт не входят.

Auto-trigger разрешён только для `free_deterministic`. Платный шаг в автоматическом workflow должен останавливаться для подтверждения стоимости, если превышен порог студии.

Ключевая метрика: **AI cost per approved result**, а не только cost per generation.

## 12. Integrations и 152-ФЗ

MCP — один адаптер внутри Integration Gateway, а не архитектура интеграций.

До закрытия гейта российского data plane и внешних AI-вызовов с учётом 152-ФЗ действует потолок P0:

- два сменяемых AI-провайдера;
- Google Drive с минимальным OAuth scope;
- импорт URL;
- PDF/JPG/PNG/CSV/XLSX;
- внешняя геометрия как файл;
- concierge fallback.

Почта, мессенджеры, календарь, CRM, бухгалтерия и массовый приём PII третьих лиц заблокированы. Dropbox и Outlook требуют отдельного решения.

## 13. Роли и публичные названия

Публичные роли:

- Заказчик;
- Дизайнер;
- Архитектор;
- ГлавПрораб.

Технический идентификатор `site_manager` допустим, но в публичном слое используется `ГлавПрораб`.

`Owner / Studio Admin` — роль организации, а не Module 5. Один человек может совмещать роли, но permissions назначаются в контексте проекта.

## 14. Пилотный вертикальный срез Charter

Полный пилотный срез состоит из 10 шагов:

1. ссылка и бриф;
2. Passport, КП и договор;
3. одна комната и три варианта;
4. точечное AI-действие с credits/cost measurement и provenance;
5. реальный материал и бюджетная рамка;
6. клиентское утверждение версии;
7. выпуск пакета M3;
8. выдача исполнителю;
9. изменение, impact и новая версия;
10. фотофакт и приёмка.

Sprint 1 закрывает шаги 1–2 и частично шаг 4. Он не закрывает весь §14 и не разрешает широкую разработку M2–M4.

## 15. MVP, P1, P2

### MVP

- стабильный путь brief → passport → risks → scope → proposal;
- ProjectCheck `PROPOSAL_READY`, `CONTRACT_READY`;
- hard/soft blockers;
- Evidence;
- Decision Log;
- клиентское и внутреннее approval;
- invalidation после изменения источника;
- клиентский и профессиональный виды;
- безопасность, аудит, аналитика и отсутствие ручного DB вмешательства.

### P1

- M2 Design Intent и Design Freeze;
- расширенная Approval Model;
- первые ChangeRequest и ImpactAssessment;
- portfolio view;
- materials/budget impact;
- целевой Documentation Release contract.

### P2

- M3 и M4 в полном объёме;
- BaselineRevision, issuance, receipt, substitutions, Evidence Pack;
- проверенные benchmarks;
- прогнозирование только после проверки точности.

## 16. Что продукт не делает

- не marketplace;
- не гарант качества/нормативного соответствия;
- не замена специалиста;
- не CAD/BIM/3D редактор;
- не бухгалтерия, склад, CRM холодных продаж или universal task manager;
- не продаёт выбор LLM как ценность;
- не обещает точные benchmarks без данных.

## 17. Безопасность

- actor, organization, project и role определяются server-side;
- RLS deny-by-default;
- один проект принадлежит одной организации;
- guest access ограничен, истекает и отзывается;
- значимые snapshots и audit append-only;
- секреты, PII, signed URLs и исходные тексты не попадают в logs;
- AI получает минимум данных;
- схема меняется только миграцией с access tests;
- AI не утверждает и не выпускает решения.

## 18. Launch Gate M1

M1 готов только если:

1. сценарий проходит без разработчика;
2. понятны следующий шаг и blockers;
3. AI results маркированы и имеют source;
4. изменение source инвалидирует derivations;
5. client approval отделено от internal review;
6. routes, RLS и guest links доказаны;
7. privacy, terms, support и data deletion соответствуют фактическому продукту;
8. нет ложных обещаний M2–M4;
9. analytics измеряет activation/errors;
10. lint, typecheck, tests и production build проходят;
11. metered AI calls инструментированы;
12. известна себестоимость полного M1 прохода.

## 19. Открытые OWNER GATES

1. Точная тарифная модель после пилотов.
2. Финальное русское написание: `ArchiDom` или `АрхиДом`.
3. Судьба внутреннего имени «Свод».
4. Объём guest кабинета первой версии.
5. Числовые KPI после baseline.
6. Даты M2–M4 после M1 и оценки репозитория.
7. Российский data plane и режим внешних AI-вызовов по 152-ФЗ.
8. Фактический первый платёж и сегмент, который его совершает.

Codex не принимает эти решения.

## 20. Architecture Freeze

С 27.07.2026 действует freeze:

- этот Charter меняется только утверждённым аддендумом;
- Technical Architecture не меняет продуктовый контракт;
- после спринта создаются Implementation Report и Readiness Update, а не новая «финальная архитектура»;
- M2–M4 не открываются широко до доказанного полного пилотного среза или отдельного OWNER DECISION.
