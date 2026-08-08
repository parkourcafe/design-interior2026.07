# AGENTS.md — RemHaOS RU / Product Charter v0.4

## Текущий активный контракт

С 18 июля 2026 года источниками продуктовой и delivery-истины являются:

- `docs/product-intelligence/ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md`;
- `docs/product-intelligence/adr/0005-remhaos-public-brand.md`;
- `docs/product-intelligence/architecture-v1.md` с compatibility-решением ADR-0004;
- `docs/product-intelligence/adr/0004-one-archidom-four-workspaces.md`;
- `docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md`.

Публичный российский продукт называется **RemHaOS**. `ProjectCEO` сохраняется
только как внутренний compatibility namespace существующего кода, API и database
contracts до отдельно принятой безопасной миграции. `ProUp` как отдельный продукт
отменён.

Текущий исполняемый delivery scope — только RU. Kora Food Hall около 1 800 м²
остаётся полноразмерным эталонным проектом, но до заморозки широкого P0 через ту же
модель данных должен пройти минимум один внешний реальный пакет.

## Четыре публичных рабочих пространства

1. **M1 · Заказчик** → `Contracted Project Passport`.
2. **M2 · Дизайнер** → `Approved Design Intent + Approved Selections`.
3. **M3 · Архитектор** → `Released Production Package`.
4. **M4 · ГлавПрораб** → `As-built & Warranty Archive`.

Это четыре ролевых пространства одного аккаунта, одной Organization, одного Project
и одной модели данных, а не четыре приложения. Один человек может совмещать роли.

## Разрешённая последовательность

1. Сохранить принятый локальный baseline через commit `88b1442` и evidence commit
   `487e993`; существующие green gates не переобъявлять production evidence.
2. Закрыть **Authenticated Pilot Gate** в disposable Supabase, не в production:
   request-bound Auth/PostgREST, additive read contracts, обязательный command
   surface, Storage и пять отдельных role sessions.
3. Пройти Kora end-to-end без ручной записи в базу: invitation → sources → human
   review → approvals → baseline → release → distribution → change/impact → photo
   evidence → acceptance → handover.
4. Пройти внешний реальный пакет через те же Organization/Project/Package contracts.
5. Повторить lint/typecheck/test/build, PG16/PG17, RLS, concurrency, idempotency,
   rollback, restart replay и authenticated browser QA.
6. Проверить минимум два платных concierge/pilot-сценария и второй проект одной
   организации до широкой разработки M2/M4.
7. Production adoption выполнять только отдельным контролируемым решением.

## Неподвижные технические правила

- Existing timestamped migrations immutable; изменения только additive.
- Не переименовывать существующие `projectceo_*` schemas, RPC, routes или internal
  TypeScript namespaces ради публичного ребрендинга без отдельного ADR и migration plan.
- Application runtime не получает direct access к private Project Intelligence tables.
- Human operations не выполняются через service role.
- Actor, organization, project, package, role и effective scope выводятся server-side.
- Один Project принадлежит ровно одной Organization.
- Source provenance и exact revision обязательны для extracted/interpreted facts.
- Published versions, approvals, releases, handoffs и audit append-only/immutable.
- Guest grants hashed, scoped, expiring и revocable.
- Повторные requests/jobs/webhooks идемпотентны.
- AI не утверждает, не выпускает и не согласовывает решения автоматически.
- AI получает только минимально разрешённый контекст; PII, source text, original
  filenames, raw tokens и signed URLs не попадают в structured logs.
- Все пользовательские строки находятся в `lib/i18n/ru.ts`; публичный copy использует
  RemHaOS и названия четырёх рабочих пространств после отдельного UI acceptance gate.
- Деньги хранятся как safe integer RUB; signed deltas типизируются явно.

## Что не строить сейчас

- US/multi-region runtime или отдельную американскую кодовую базу;
- паритет с CAD/BIM: слои, размерные цепи, узлы, чтение и запись DWG/IFC и прочих
  обменных форматов САПР (собственный редактор планировок с 2D/3D и вводом
  геометрии мышью **разрешён** решением ADR-0006 — геометрия является способом
  ввода проектного решения, а не продуктом);
- полный ERP, бухгалтерию, склад, payroll, marketplace или универсальный task/calendar;
- юридически значимую собственную ЭП без выбранного провайдера и legal review;
- широкий AI Model Router, безлимитный AI или credits billing до provider benchmark,
  unit economics, privacy/legal gate и отдельного принятого execution spec.

**M2 Design Workspace открыт решением ADR-0006 от 08.08.2026.** Его
Decisions/Selections/Approvals реализованы (PR #66), редактор планировок
внедряется отдельно и выключен флагом `ARCHIDOM_LAYOUT_STUDIO_ENABLED`.
Это НЕ снимает требование провести через те же contracts минимум один внешний
реальный пакет до заморозки широкого M2–M4: цикл 7 остаётся открытым.

Расширенный платный M4 из Charter остаётся целевым состоянием. Его широкий build
не начинается раньше authenticated pilot и выбора первого платящего wedge. До
этого разрешены только узкие совместимые contracts и concierge fallback.

## Definition of Done

Для каждого принятого слоя:

```text
npm run lint
npm run typecheck
npm run test
npm run build
```

Database layers дополнительно проходят disposable PostgreSQL 16 и 17, RLS,
negative tenancy/package scope, concurrency, idempotency, rollback и restart replay.
Browser acceptance разделяет sanitized fixture QA и настоящую authenticated
Auth/PostgREST/RLS matrix; первое не заменяет второе.

Любое утверждение `PRODUCTION_READY=true` запрещено до заполненного adoption
checklist, свежего production snapshot, backup/restore rehearsal, SMTP/Auth/Storage
проверок, monitoring и отдельного человеческого GO.
