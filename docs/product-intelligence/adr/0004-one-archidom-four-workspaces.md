# ADR-0004: Один ArchiDom, четыре рабочих пространства и compatibility namespaces

Статус: **accepted**. Дата: 18 июля 2026 года.
Основание: утверждённый `ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md`.

## Контекст

Предыдущий контракт использовал публичное имя ProjectCEO для российского delivery,
ProUp Renovation для execution edition и ArchiDom Space для studio edition. К 18 июля
в коде и базе уже материализованы additive migrations, schemas/RPC, delivery paths и
тесты с внутренним namespace `projectceo`, а локальный Kora vertical slice принят.

Charter v0.4 фиксирует другое продуктовое решение: один публичный ArchiDom и четыре
ролевых пространства одного проекта — Заказчик, Дизайнер, Архитектор и ГлавПрораб.
Механическое переименование опубликованных database/API contracts создало бы риск для
migration ledger и не добавило бы пользовательской ценности.

## Решение

1. Публичный бренд российского продукта — **ArchiDom**.
2. Публичная навигация — четыре workspace:
   - M1 · Заказчик;
   - M2 · Дизайнер;
   - M3 · Архитектор;
   - M4 · ГлавПрораб.
3. Это capability compositions одного аккаунта, Organization, Project и Project Brain,
   а не отдельные приложения, базы или логины.
4. `ProjectCEO` больше не используется как публичный product name, но временно
   сохраняется как internal compatibility namespace существующих:
   - timestamped migrations;
   - PostgreSQL schemas/RPC/roles;
   - TypeScript modules/types;
   - API paths и test fixtures.
5. Публичный ребрендинг выполняется через `lib/i18n/ru.ts`, navigation mapping и
   controlled route aliases. Internal rename возможен только отдельным ADR с additive
   compatibility bridge, contract tests, migration ledger review и rollback.
6. ProUp как отдельный продукт/edition отменён. Его подтверждённые execution contracts
   становятся M4 ArchiDom.
7. Северная Америка является будущей региональной упаковкой того же ArchiDom. Текущий
   runtime и delivery — только RU; второй data-plane требует отдельного решения.
8. Project Intelligence Core, provenance, exact revisions, immutable publications,
   deterministic impact, append-only audit и server-derived authorization не меняются.

## Compatibility mapping

| Публичный контракт | Совместимый внутренний контур |
|---|---|
| ArchiDom | `projectceo` delivery namespace до безопасной миграции |
| M1 · Заказчик | legacy brief/passport/proposal + immutable passport handoff |
| M2 · Дизайнер | Decision/Selection/Approval foundation; Design Workspace расширяется отдельно |
| M3 · Архитектор | source registry, baseline, package, release |
| M4 · ГлавПрораб | distribution, change, impact, photo, milestone, handover |
| Память проекта | Project Intelligence Core / Project Graph |

## Последствия

Положительные:

- пользователь видит один продукт и одну непрерывную историю проекта;
- уже принятые DB contracts и evidence не выбрасываются;
- роль одного человека может включать несколько workspace capabilities;
- публичный ребрендинг отделён от рискованного persistence rename.

Ограничения:

- некоторое время публичный ArchiDom и internal `projectceo` будут сосуществовать;
- документация и telemetry обязаны различать public name и compatibility namespace;
- нельзя утверждать, что полный M2 Design Workspace или расширенный M4 уже реализованы;
- route aliases не должны ослаблять Auth/RLS или создавать второй authorization path.

## Что этот ADR не разрешает

- переписывать существующие timestamped migrations;
- переименовывать schemas/RPC/roles in-place;
- строить US/multi-region runtime;
- начинать широкий AI/credits/CAD/ERP scope без последующих gates;
- считать локальный fixture/browser QA authenticated или production evidence.

## Следующий gate

Authenticated RU pilot на disposable Supabase: additive read contracts, обязательный
command surface, пять отдельных sessions, Kora E2E и внешний пакет. После него
принимается отдельное решение о публичном route/copy rollout и production adoption.
