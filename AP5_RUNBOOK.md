# AP5 Runbook — authenticated browser matrix

Гейт AP5 из `docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md` §AP5:
одна Organization проходит цепочку Kora, **browser matrix выполняется отдельной
authenticated session для каждой роли**. Переключение роли через query, фикстуру
или клиентское состояние доказательством не считается.

Этот документ описывает, что прогон делает, что он доказывает и что он ещё **не**
доказывает. Читать вместе с `AP1_RUNBOOK.md` §5: санитизированный харнесс
`/projectceo-qa/[role]` и настоящая Auth/PostgREST/RLS-матрица — разные вещи, и
первое второе не заменяет.

## Где он живёт

Job `ap5` в `.github/workflows/ci.yml`. Не в каждом push — поднимает весь стек
Supabase и идёт ~15 минут:

- вручную — **Actions → CI → Run workflow**;
- на PR — повесить метку `ap5`.

Гейт помечен `continue-on-error: true`: пока цепочка закрыта не полностью (см.
«Чего он не доказывает»), его состояние видно, но прогон он не роняет. Когда
последние звенья закроются — снять этот флаг, это и будет закрытие AP5.

## Что делает прогон

1. `supabase start` из репозиторного `supabase/config.toml`: порты, список схем
   в Data API и `custom_access_token` hook берутся оттуда, а не из дефолтов CLI.
2. `tests/ap1/environment/verify-db.sql` — состояние базы: managed-auth ссылок не
   осталось, request-claim helpers на месте, приватные гранты закрыты.
3. `tests/ap1/environment/verify-runtime.mjs` — разрешённые схемы отвечают,
   приватные закрыты `406`, Auth и Storage живы.
4. `npm run provision:ap1` — пять auth-identity. **Только identity.** Членства
   скрипт не выдаёт: human operations через service role запрещены.
5. Сборка и запуск приложения на `http://127.0.0.1:3100` (этот адрес есть в
   `additional_redirect_urls`, другой Auth не примет).
6. `npm run test:ap5` — Playwright.

## Что доказывает прогон

`tests/ap5/global-setup.ts`:

- **живой стек, а не фикстуры.** Портфель без сессии обязан ответить `401`.
  Мок-порт ответил бы данными, и вся матрица стала бы бессмысленной. Плюс
  прямой запрет `PROJECTCEO_LOCAL_FIXTURE_MODE=1`;
- **пять отдельных сессий,** каждая рождается в браузере на настоящей форме
  `/login`, а не подкладывается в контекст;
- **приглашения** выпускает owner своей сессией (`create_invitation` →
  `invitationUrl`), а принимает каждый приглашённый — своей, на реальной
  странице `/projectceo/invitations/[token]`.

`01-authenticated-role-matrix.spec.ts`:

| Проверка | Что доказывает |
|---|---|
| портфель без сессии → 401 | стек живой |
| каждая роль открывает `/dashboard/projectceo` и страницу проекта | серверный рендер под своей сессией |
| `actor.role` в проекции равен роли членства | роль считается от членства |
| роль в query и заголовке игнорируется | подмена роли клиентом невозможна |
| guest без членства → 404 | deny-by-default у настоящей сессии |
| чужой projectId → 403/404 | изоляция арендатора |
| мутация с чужим Origin → 403 | same-origin у команд |

`02-kora-chain.spec.ts` — звенья цепочки, достижимые сегодня: регистрация
проекта, приём приглашений тремя ролями, регистрация санитизированного
источника, ревью ровно той ревизии, решение и выбор человеческого
происхождения. Плюс отдельная проверка, что `build_handover` честно
отдаётся как `unavailable / worker_only`, а не имитируется браузером.

## Чего он не доказывает

Это не оговорки на будущее, а текущее состояние продукта. Каждое — причина, по
которой AP5 сегодня не закрыт.

1. **Регистрация организации и проекта не проходит через браузер.**
   У `enroll_organization_project` нет ни HTTP-маршрута, ни элемента интерфейса:
   `FoundationService` (`lib/project-intelligence/delivery/server/foundation-service.ts`)
   не подключён никуда. В прогоне шаг выполняется RPC от лица owner **его же**
   access token — инвариант про service role соблюдён, но браузерным
   доказательством этот шаг не является. Чтобы закрыть: маршрут регистрации
   плюс экран, после этого убрать обход из `global-setup.ts`.
2. **Baseline V1 и всё, что за ним.** `publish_baseline` принимает дескриптор с
   семантическим хешем, который собирает доменный слой; сборки дескриптора из
   браузера не описано (`AP1_RUNBOOK.md` §4.1 — открытый вопрос владельца).
   Следом не покрыты `publish_release`, `distribute_release`,
   `acknowledge_release` и версия V2.
3. **Влияние изменения.** `create_change` проходит, но `review_change_impact`
   адресуется `impactRunId`, который создаёт воркерный расчёт.
4. **Фотодоказательство и приёмка вехи.** `upload_photo_evidence` требует
   существующего `milestoneId`; вех без воркерного плана в проекте нет.
5. **Граф утверждений.** Из браузера проходит только `claimStatus:
   "human_origin"` с пустым `evidence`: ссылки на evidence рождаются в воркерном
   `ingest_source_graph` (`command-contract.ts`).

Всё это перечислено в спеке как `test.fixme` с причиной — пропуск виден в
отчёте, а не растворяется в зелёном.

## Локальный прогон

Нужен docker (стенд, а не этот репозиторий сам по себе):

```bash
supabase start
supabase status -o env            # взять API_URL, ANON_KEY, SERVICE_ROLE_KEY
# положить их в .env.local вместе с AP1_TEST_PASSWORD и PROJECTCEO_TOKEN_SECRET
AP1_CONFIRM_DISPOSABLE=yes npm run provision:ap1
npm run build && PORT=3100 npm run start &
npx playwright install chromium
npm run test:ap5
```

`tests/ap5/.state/` — одноразовое состояние прогона: файлы сессий содержат живые
access token, каталог в `.gitignore` и коммиту не подлежит.

## Попутная находка

Схема `projectceo_m3_api` не была отдана Data API в `supabase/config.toml`, хотя
приложение вызывает её листы через PostgREST
(`lib/project-intelligence/adapters/postgres/documentation.ts`). На голом
PostgreSQL это невидимо — DB4 ходит напрямую в базу; на живом стеке RPC
документации просто не существовало бы для приложения. Схема добавлена,
приватная `projectceo_m3` остаётся закрытой, обе проверки — в
`environment.contract.test.ts` и `verify-runtime.mjs`.
