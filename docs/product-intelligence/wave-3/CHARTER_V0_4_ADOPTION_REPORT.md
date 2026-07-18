# ArchiDom RU — Product Charter v0.4 Adoption Report

Дата принятия: 18 июля 2026 года.
Решение: Селена утвердила Charter v0.4 как новый продуктовый источник истины.
Git snapshot до принятия: `88b14421bfa6f43204548398d45fde4492050970`.
Исходный attachment SHA-256: `821e684dae0c23651de925974eddc6fb690aa0c232b46ecf25eda558c572ee2b`.
Materialized approved Markdown SHA-256 после статусной/filename-нормализации:
`48de205b9a9a5001e765594b581cc2ef3b8b157fab61be4607f3a82a667ef81b`.

## 1. Что принято

- один публичный ArchiDom;
- одна Organization, один Project и одна Память проекта;
- четыре ролевых workspace: Заказчик, Дизайнер, Архитектор, ГлавПрораб;
- бесплатное участие клиента/гостя/полевого исполнителя;
- платное профессиональное создание, выпуск и управление;
- отдельная оплата действий с переменной AI-себестоимостью после соответствующих gates;
- ProUp как отдельный продукт отменён;
- Россия является текущим исполняемым контуром;
- Северная Америка остаётся будущей упаковкой того же ядра;
- provenance, human approval, immutable publications и change-impact обязательны;
- Kora остаётся сложным эталоном и дополняется внешним пакетом.

Утверждённый файл материализован как
[`ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md`](../ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md).
Его статусная строка изменена с «кандидат» на «утверждён»; гипотезы и открытые
решения не были автоматически превращены в разрешённый implementation scope.

## 2. Разрешение конфликтов с v0.3

| Конфликт | Принятое разрешение |
|---|---|
| Публичный ProjectCEO | Публичный ArchiDom; `ProjectCEO` только internal compatibility namespace |
| ArchiDom Space и ProUp как редакции | Один ArchiDom, четыре workspace; ProUp отменён |
| Роли старого ProjectCEO | Публично Заказчик/Дизайнер/Архитектор/ГлавПрораб |
| Два текущих региональных runtime | Сейчас только RU; будущий регион требует отдельного ADR |
| Тонкий M2 Decisions/Selections против полного Design Workspace | Тонкий слой сохраняется как foundation; широкий M2 проходит отдельные product/AI gates |
| Тонкий M4 против WBS/сметы/закупок | Тонкий M4 принят; расширение зависит от paid wedge validation |
| Немедленный rename DB/API | Запрещён; только additive compatibility bridge по отдельному ADR |

ADR-0004 supersedes product-edition часть ADR-0002, но сохраняет техническую
изоляцию data-plane как обязательный принцип при будущем втором регионе.

## 3. Что остаётся действующим из принятой реализации

Новый Charter не отменяет:

- commits `9874524`, `e74f4b3`, `a8c86a8`, `487e993` и `88b1442`;
- Organization/Project/Package access contracts;
- Decisions, Selections, Approvals и price observations;
- source registry, ProjectBaseline, ProductionPackageVersion и releases;
- distribution, ChangeRequest, impact review, photo/milestone/handover;
- request-bound human JWT, RLS/ACL и executor separation;
- Kora deterministic full-project evidence;
- production-adoption boundary.

Они переосмысляются как техническая основа M1–M4 ArchiDom, а не как отдельный
публичный ProjectCEO.

## 4. Что утверждение не разрешает

- переписывать timestamped migrations или migration history;
- механически переименовывать `projectceo_*` schemas/RPC/routes;
- заявлять, что полный M2 Design Workspace или расширенный M4 реализованы;
- выбирать AI-провайдеров без benchmark, privacy/legal и unit-economics review;
- вводить credits/billing или unlimited AI без отдельного execution contract;
- строить CAD/BIM, render engine, ERP, склад, бухгалтерию или marketplace;
- строить US/multi-region runtime;
- применять migrations, secrets или deploy к production;
- считать sanitized fixture browser QA authenticated RLS evidence.

## 5. Обновлённые управляющие документы

- root [`AGENTS.md`](../../../AGENTS.md) — новый active contract и guardrails;
- [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) — путь к authenticated pilot;
- [`architecture-v1.md`](../architecture-v1.md) — compatibility notice;
- [`ADR-0004`](../adr/0004-one-archidom-four-workspaces.md) — naming/workspace/namespace decision;
- [`README.md`](../README.md) и [`wave-3/README.md`](./README.md) — новая навигация.

Architecture v1 остаётся frozen input. После принятого compatibility change её
SHA-256 обновлён на `aac7a5f284480bba515030fff4aed90057def604803ffe7daac9da94661a8482`,
а aggregate frozen manifest — на
`c09a4d58120865927dc03b981e0de24345bd43306ff6d5e6858658e57ee87350`.
Изменение проверяется существующим architecture contract test; остальные 50 frozen
inputs не менялись.

## 6. Следующий delivery gate

```text
AP1 disposable Supabase/Auth/PostgREST/Storage
→ AP2 additive read contracts
→ AP3 mandatory request-bound commands
→ AP4 direct route/security tests
→ AP5 authenticated Kora E2E with five sessions
→ AP6 external real package
→ paid wedge validation
→ separate production decision
```

Широкий публичный rebrand UI выполняется через i18n/navigation mapping после frozen
route/read contracts. Internal persistence namespace не меняется в этом gate.

## 7. Verification

После обновления frozen manifest выполнено:

```text
git diff --check                                      PASS
architecture-v1.contract.test.ts                     6/6 PASS
npm run lint                                         PASS, 0 errors / 9 legacy warnings
npm run typecheck                                    PASS
npm run test                                         56 files / 328 tests PASS
NEXT_DIST_DIR=.next.nosync npm run build             PASS, 18/18 static pages
```

Product Charter adoption не изменял application runtime, migrations, Supabase или
production. Публичный UI copy ещё не переименован: это следующий Stream B change
после freeze read/route contracts и отдельного browser acceptance.

## 8. Acceptance status

```text
CHARTER_V0_4_APPROVED=true
PUBLIC_PRODUCT=ArchiDom
DELIVERY_REGION=RU_ONLY
PROJECTCEO_INTERNAL_NAMESPACE=preserved
PROUP_SEPARATE_PRODUCT=false
AUTHENTICATED_PILOT_READY=false
PRODUCTION_READY=false
PRODUCTION_APPLIED=false
```
