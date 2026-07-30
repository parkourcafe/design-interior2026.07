# M1 Scope Guardrails

Документ фиксирует продуктовые границы Модуля 1 Свода. Его задача - не расширять MVP до CRM, marketplace или project OS, а удерживать разработку вокруг цепочки:

**Brief -> Passport -> Risks -> Review -> Proposal**.

## Product Definition

Модуль 1 - это AI pre-sale слой для интерьерного дизайнера.

Дизайнер или студия отправляет клиенту публичную ссылку на бриф. Клиент без регистрации проходит quick brief с ветвлением. Система интерпретирует ответы, собирает паспорт проекта, генерирует карточки рисков, показывает их дизайнеру на Review Board, а затем помогает собрать коммерческое предложение.

Это слой до дизайна: до чертежей, визуализаций, закупок, подрядчиков и ведения реализации.

Продуктовая формула M1:

**Brief -> Passport -> Risks -> Review -> Proposal**.

## Users And Roles

### Designer / Studio

Платящий и настраивающий пользователь. В M1 дизайнер:

- создает pre-sale клиентский кейс;
- отправляет публичную ссылку на бриф;
- настраивает профиль, базовую формулу цены и defaults КП;
- смотрит паспорт, ответы, файлы и карточки рисков;
- принимает, отклоняет и, в целевом M1, редактирует выводы;
- собирает, редактирует и отправляет КП.

Студия в M1 - это рабочий контур дизайнера. Допустимы участники команды с доступом к тем же pre-sale кейсам, но это не полноценная CRM-роли-модель.

### Client

Клиент дизайнера не является CRM-пользователем. В M1 клиент:

- открывает публичную ссылку на бриф;
- проходит бриф без регистрации;
- загружает план/фото как вложения, без анализа изображений;
- открывает публичное КП по ссылке;
- может оставить базовый ответ по КП, если такая петля включена.

Клиент не получает личный кабинет проекта, задачи, закупки, чат реализации или vendor workspace.

### Optional Studio Manager/Admin

Опциональный manager/admin студии может помогать дизайнеру обрабатывать pre-sale кейсы: смотреть брифы, Review Board, КП и базовые события. В текущей реализации это ближе к равному участнику студии, а не к детальной матрице ролей.

### Not M1 Roles

Vendor, contractor, supplier, construction manager и post-sale client portal не входят в M1. Их появление означает переход к будущим модулям, а не развитие текущего MVP.

## M1 Workflow

1. Designer creates a client lead/project in the dashboard.
2. System generates a public brief link `/i/[token]`.
3. Designer sends the link to the client.
4. Client completes the public brief without registration.
5. System saves brief answers and files metadata.
6. System builds the project passport from answers.
7. System generates risk cards from deterministic rules and one LLM pass, with fallback to rule cards.
8. Designer opens Review Board and reviews passport, answers, comments, uploads and risks.
9. Designer accepts or rejects risk cards. Target M1 also includes editing the cards before proposal generation.
10. Accepted risks influence proposal content through `proposal_implication`.
11. System generates proposal sections from passport, accepted risks, pricing config and proposal defaults.
12. Designer edits, sends and exports the proposal as a public web link with print view.
13. Basic proposal events, such as created, sent, opened and response, are stored as validation trail.

Existing self-serve/client-initiated brief routes are treated as an already-built edge/future hook. They must not become the center of M1 work unless a separate task explicitly re-scopes the product.

## Core M1 Objects

### ClientLead

Pre-sale client case owned by a designer or studio. Current implementation maps this mostly to `projects`: `client_name`, `designer_id`, `status`, `intake_token`, `passport`, `created_at`.

ClientLead is not a CRM contact, deal pipeline, invoice account or post-sale project workspace.

### BriefSession

The public intake session around an `intake_token`: current project status, browser autosave draft, started/completed events and final submit.

Current implementation does not have a separate `brief_sessions` table; the session is represented by `projects`, `/i/[token]`, localStorage draft state and `events`.

### BriefAnswer

One answer to one brief question. Current implementation maps this to `answers`: `project_id`, `question_id`, `value`, `created_at`.

### Passport

Machine-readable project passport derived from brief answers and stored in `projects.passport`. It is a pre-sale interpretation object, not a design specification.

In current code `buildPassport(answers)` is deterministic. The broader product phrase "AI passport" should be read as "AI-assisted interpretation flow": passport plus risk diagnosis, not as a reason to add a second LLM call for passport construction.

### PassportFact

A normalized explainability unit: what fact was inferred, from which answer, with what value and where it appears in the passport.

Current implementation does not persist PassportFact. For M1 it can be derived from `answers` and `projects.passport`; it should not require a new AI call.

### RiskCard

A possible risk or contradiction for designer review: risk type, evidence, impact, confidence, designer action, proposal implication, status and source.

Current implementation maps this to `risk_cards` and supports `proposed`, `accepted`, `rejected`.

### ServiceItem

A discrete item in the service offer: deliverable, stage, inclusion/exclusion or scope element. Current implementation hardcodes deliverables inside proposal generation.

For M1, ServiceItem exists only to make proposal scope clearer. It is not a full task, work package, procurement item or contractor assignment.

### PricingFactor

One factor used to explain price: base rate, area, complexity, urgency, package. Current implementation returns this from `calcPrice()` as a transparent breakdown.

### PackageRecommendation

A recommended package such as `concept`, `full`, or `full_plus_supervision`, with reasons from passport and accepted risks.

Current implementation has the field `passport.scope.package`, but it is usually `null` and proposal generation falls back to `full`. This is a real M1 gap.

### Proposal

Commercial proposal generated from passport, accepted risks, pricing and defaults. Current implementation maps this to `proposals`.

### ProposalSection

Editable text section inside proposal `sections`: task, works, stages, price, included, excluded, revisions, client inputs and stage completion.

### ProposalVersion

Versioned proposal artifact. Current schema has `version`, but code currently uses version `1` only. Real versioning is an M1 gap.

### ProposalEvent

Sales trail event for validation and follow-up. Current implementation uses `events` for `proposal_created`, `proposal_sent`, `proposal_viewed` and client response events.

ProposalEvent is not an invoice, contract, payment or CRM automation.

## What Is In Scope For M1

- Public brief link for the client.
- Branching quick brief.
- Autosave for public brief progress.
- AI-assisted passport flow: deterministic passport plus AI/rule risk interpretation.
- Risk cards.
- Designer Review Board.
- Accept/reject/edit risks.
- Service/package recommendation.
- Pricing explanation.
- Proposal generation.
- Proposal PDF/web link, where PDF means printable HTML/web page in v0.1.
- Proposal versioning.
- Basic proposal status/opened event.
- Basic activity log.

## What Is Out Of Scope For M1

- SketchUp, Adobe, render and CAD integrations.
- MCP tool hub.
- AI image/video generation hub.
- Vendor workspace.
- Contractor tasks.
- Post-sale client portal.
- Project delivery management.
- Procurement.
- Materials catalog.
- Marketplace, designer matching and lead marketplace.
- Plan/fact construction budget.
- Full CRM replacement.
- Invoices, contracts and accounting.
- Billing and tariffs.
- Multicurrency and EN localization.
- ML pricing and pricing master from historical projects.
- Deep brief as a separate product.
- PDF libraries for generated files.
- Analysis of uploaded plans/photos.

## Future Modules

### Module 2 - Designer Tools / AI Tool Hub

Module 2 is the designer-to-tools layer: integrations, AI tool routing, render/CAD helpers, asset generation and tool hub workflows.

It can reuse M1 outputs as future hooks, but it must not be built inside the current M1 MVP.

### Module 3 - Project Workspace

Module 3 is the designer + client + vendors/contractors workspace after sale: client portal, project delivery, tasks, procurement, construction budget, approvals and document storage.

It starts after proposal acceptance and therefore is outside M1.

### Future Marketplace / Integrations

Catalogs, matching, lead transfer, marketplace logic and external integrations are future modules. They must not enter M1 unless explicitly re-scoped.

## Competitive Boundary

Свод не конкурирует с Битрикс24 как CRM. CRM-системы конкурируют за backstage дизайнера: сделки, договоры, счета, задачи и коммуникации. M1 не пытается заменить это.

Свод не конкурирует с Estimates.guru как обычный КП-редактор. КП в M1 ценно не само по себе, а потому что оно собрано из брифа, паспорта, рисков и логики оффера.

Свод не конкурирует с Roomix как post-sale approval workspace. M1 заканчивается на pre-sale коммерческом предложении.

Защищенный слой Свода:

**brief interpretation -> passport -> risk diagnosis -> offer logic**.

## Healthy Principles Adapted From Future OS Vision

### Item-As-Data -> Pre-Sale Decision Objects

В M1 объектами данных являются не задачи стройки, а pre-sale решения: ответы, факты паспорта, риски, pricing factors, service items и proposal sections.

### Budget Tied To Decision

Ответы клиента должны влиять на scope, package and price explanation. Бюджет в M1 не является строительной сметой или plan/fact контролем.

### Audit Trail -> Sales Trail / Proposal Events

M1 хранит след продаж: создана ссылка, начат/завершен бриф, создано/отправлено/открыто КП, клиент оставил базовый ответ.

### Role-Based Visibility

Клиент видит публичный бриф и публичное КП. Дизайнер видит паспорт, диагноз, внутренние риски, accepted/rejected статус и расчет. Поставщики и подрядчики ничего не видят в M1.

### Project As Source Of Truth -> Pre-Sale Client Case

В M1 source of truth - это pre-sale client case. Это не полный project OS после сделки.

## MVP Guardrails

Любая новая задача для M1 должна напрямую поддерживать цепочку:

**Brief -> Passport -> Risks -> Review -> Proposal**.

Если задача в первую очередь поддерживает tools, vendors, construction, procurement, marketplace, billing, contracts, accounting или post-sale execution, она должна попасть в `BACKLOG.md` как future module, а не в код M1.

Допустимы только future hooks, если они не меняют поведение MVP и не утягивают команду в Module 2/3.
