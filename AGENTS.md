# AGENTS.md — ProjectCEO RU / Wave 3

## Источник истины

- `docs/product-intelligence/ProjectCEO_Russia_Product_Charter_v0.3_2026-07-17.docx`
- `docs/product-intelligence/architecture-v1.md`
- `docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md`

Российский продукт называется ProjectCEO. Текущий delivery scope — только RU.
Kora Food Hall около 1 800 м² является полноразмерным эталонным проектом.

## Порядок

1. Gate 0: materialized Git baseline и зелёные lint/typecheck/test/build.
2. Foundation: Organization/Project enrollment, Invitation/AccessGrant,
   project/package-scoped read model, Storage authorization, initial ingestion.
3. M2: Decisions, Selections, price observations и human approvals.
4. M3: source registry, ProjectBaseline и immutable ProductionPackageVersion.
5. Тонкий M4: distribution, acknowledgement, ChangeRequest, impact review,
   photo evidence и handover archive.
6. PG16/PG17, RLS, concurrency, idempotency, rollback и browser QA.
7. Production adoption — отдельный контролируемый gate.

## Неподвижные правила

- Existing timestamped migrations immutable; новые изменения только additive.
- Application runtime не получает direct access к private Project Intelligence tables.
- Human operations не выполняются через service role.
- Actor, organization, project, package и role выводятся server-side.
- Source provenance и exact revision обязательны для extracted/interpreted facts.
- Published versions, release packages и handoffs immutable.
- Audit append-only.
- Guest grants hashed, scoped, expiring и revocable.
- AI не утверждает решения автоматически.
- Kora не сворачивается в room-only data model.
- Local Kora manifest и реальные filenames не деплоятся публично.
- Секреты только в env; `.env.example` не содержит настоящих ключей.
- Все пользовательские строки находятся в `lib/i18n/ru.ts`.
- Деньги — safe integer RUB, кроме явно типизированных signed deltas.

## Не строить сейчас

US/multi-region runtime, CAD/DWG editor, 3D/render engine, бухгалтерию, полный
ERP/склад, marketplace и универсальный task/calendar.

## Definition of Done

Для каждого принятого слоя:

```text
npm run lint
npm run typecheck
npm run test
npm run build
```

Database layers дополнительно проходят disposable PostgreSQL 16 и 17, RLS,
concurrency, idempotency, rollback и restart replay.
