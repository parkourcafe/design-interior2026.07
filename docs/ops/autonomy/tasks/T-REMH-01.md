# T-REMH-01 — сквозная проверка M1 после #208/#209 и переходы M1–M4

| Поле | Значение |
|---|---|
| task_id | T-REMH-01 |
| repo | parkourcafe/design-interior2026.07 |
| base SHA | `737795d7aa6bae3b6020010c6a53b4757ed99a48` (main, merge #209; #208 влит ранее) |
| branch / PR | `claude/autonomy-remh-01` · draft PR [#210](https://github.com/parkourcafe/design-interior2026.07/pull/210) |
| дата прогона | 27.09.2026 (запуск 1), 28.09.2026 (запуск 2, раздел 9) |
| среда | только локальная песочница; Node 22.22.2, npm 10.9.7; без `.env`, без секретов, без сети к production, без платных LLM |

Словарь статусов: `DONE_CODE`, `TESTED_LOCAL`, `BLOCKED_EXTERNAL`, `BLOCKED_DECISION`, `NOT_VERIFIED`. Staging и production здесь не проверялись ни в одном пункте.
Пометка **[факт]** значит, что утверждение взято из названного файла или из вывода команды. Пометка **[интерпретация]** значит, что это вывод исполнителя.

## 1. Статус по шагам

| # | Шаг | Статус |
|---|---|---|
| 1 | Ветка от origin/main, `npm ci` по lockfile | TESTED_LOCAL |
| 2 | lint / typecheck / test / build (DoD из `AGENTS.md`) | TESTED_LOCAL |
| 3a | Бриф → паспорт → риски (rules + LLM, LLM замокан) | TESTED_LOCAL |
| 3b | Паспорт → цена → КП | TESTED_LOCAL |
| 3c | Ответ клиента на публичном КП (`/api/proposal/respond`) | TESTED_LOCAL (mock-БД, без реального Supabase) |
| 3d | Публичная страница `/p/[public_token]` в браузере | NOT_VERIFIED |
| 4 | Дефект: отправленное или принятое КП можно было переписать | DONE_CODE + TESTED_LOCAL |
| 5 | Переходы M1→M2→M3→M4 на уровне БД | TESTED_LOCAL (PG16, последовательная часть DB4/DB5) |
| 6 | Переходы M1–M4 через аутентифицированный браузер (AP5) | BLOCKED_EXTERNAL |
| 7 | PostgreSQL 17 | BLOCKED_EXTERNAL |

## 2. Изменённые файлы

- `app/dashboard/projects/[id]/proposal/actions.ts` — изменён минимально, это исправление дефекта.
- `app/dashboard/projects/[id]/proposal/editor.tsx` — после отправки кнопок «Сохранить» и «Пересобрать» нет, поля доступны только для чтения.
- `tests/release/m1-brief-to-client-response-chain.test.ts` — новый файл: сквозной тест цепочки и регрессия, всего 10 тестов.
- `docs/ops/autonomy/tasks/T-REMH-01.md` — этот отчёт.

Миграции, зависимости, lockfile, CI и настройки деплоя не менялись.

## 3. Команды и результаты

| Команда | Результат |
|---|---|
| `git fetch origin main && git checkout -b claude/autonomy-remh-01 origin/main` | OK, origin/main = `737795d` |
| `npm ci --no-audit --no-fund` | exit 0, установлено 599 пакетов, lockfile не менялся |
| `npm run lint` | exit 0: **0 ошибок, 15 предупреждений**. Это то же число, что записано в #209 |
| `npm run typecheck` | exit 0 |
| `npm run test` (base, до установки zsh) | exit 1: 8 падений в 3 файлах, все с `spawnSync("zsh")` → ENOENT. Причина — в песочнице не было `zsh`, код тут ни при чём |
| `apt-get install zsh`, затем повтор 3 файлов | 52/52 passed |
| `npm run test` (base, с zsh) | exit 0: **257 файлов, 2321 passed, 1 skipped** |
| `npm run build` (base) | exit 0 |
| `npm run test` (ветка, финал) | exit 0: **258 файлов, 2331 passed, 1 skipped** |
| `npm run typecheck` / `lint` / `build` (ветка, финал) | exit 0 / exit 0 (0 ошибок, 15 предупреждений) / exit 0 |
| `npm run test:cycle7` | exit 0, 3/3. [факт] `AGENTS.md` называет этот набор «красным намеренно». [интерпретация] Здесь он зелёный, и владельцу стоит сверить, что имелось в виду |
| `npx vitest run tests/release/m1-brief-to-client-response-chain.test.ts` на коде **без** исправления | 3 failed / 7 passed. Регрессия ловит дефект |
| DB4, последовательная часть (скрипт-аналог `tests/db4/run.zsh` на одноразовом кластере `pg_createcluster 16`, порт 5499, PostgreSQL 16.13) | 127 миграций применены, **52/52 SQL-файлов PASS**, в том числе 77/78 из #208 |
| DB5, последовательная часть (отдельный одноразовый кластер, тот же список, что в `tests/db5/run.zsh`, плюс `90_default_deny_after.sql`) | 127 миграций, **20/20 PASS** |

Одно замечание по окружению. Для прогона я временно поднял `dockerd`. Пока он работал, ранее пропускаемый тест `tests/ap1/environment/adopt-production.contract.test.ts` (`skipIf(!docker)`) начал выполняться и упал по таймауту: Docker Hub отвечал 429. После остановки `dockerd` тест снова пропускается, это и есть «1 skipped» выше. Оба одноразовых кластера удалены (`pg_dropcluster`).

## 4. Цепочка M1 — доказательства

**3a. Бриф → паспорт → риски — TESTED_LOCAL.**
[факт] `lib/brief/pipeline.ts:17-28`: `buildPassport` → `evaluateRules` → `generateLlmRisks` → `dedupeRisks`. Если LLM не ответил, остаются только rule-карточки (`:22`).
[факт] В новом тесте `completeJSON` из `@/lib/llm/provider` заменён моком, настоящего вызова LLM нет. Тест проверяет оба варианта: `llmOk=true` с карточками `rule`+`llm` и `llmOk=false` только с `rule`.
Модульные тесты тоже зелёные: `lib/brief/passport.test.ts`, `lib/risks/rules.test.ts`, `lib/risks/llm.test.ts`, `lib/risks/dedupe.test.ts`.
Маршрут `app/api/intake/submit/route.ts` покрыт тестом `tests/release/launch-error-events.test.ts` на уровне ошибок и события fallback. Пайплайн в этом тесте замокан.

**3b. Цена → КП — TESTED_LOCAL.**
Тест проверяет, что `calcPrice` возвращает safe integer RUB, `min < max`, а сумма попадает в секцию `price`. `proposal_implication` из принятой LLM-карточки попадает в секцию `included` через `buildProposalSections`.
[факт] Маршрут сборки такой же, как в `app/dashboard/projects/[id]/proposal/page.tsx`: сложность там жёстко `complexity: "mid"`.
[интерпретация] Выбор сложности дизайнером в UI отсутствует. Это ограничение продукта, дефектом цепочки не считаю.

**3c. Ответ клиента — TESTED_LOCAL (mock-БД).**
[факт] `app/api/proposal/respond/route.ts:32`: отвечать можно только на КП в статусе `sent` или `accepted`, на черновик маршрут отдаёт 404.
[факт] `:55-66`: учитывается только первый ответ. `:39-50`: при `accept` КП переходит в `accepted`, проект — в `proposal_accepted`.
Тест на in-memory хранилище проверяет:
- ответ на черновик → 404, событий нет;
- неизвестное действие → 400, чужой токен → 404;
- `accept` меняет оба статуса, повторный `changes` не перезаписывает решение (одно событие);
- `changes` оставляет КП в `sent`, проект — в `proposal_sent`.

**3d. Публичная страница — NOT_VERIFIED.**
Серверный рендер `app/p/[public_token]/page.tsx` и клик по `respond.tsx` в браузере не запускались, потому что нет Supabase (см. блокер B1).

**Шлюз отправки.**
[факт] `sendProposal` требует утверждённый `project_passport` через RPC `list_approval_requests` (`actions.ts:191`). Это покрыто тестом `tests/projectceo-integration/m1-proposal-approval.test.ts`, он зелёный.

## 5. Найденный и исправленный дефект

**Суть.** [факт] До исправления после «Отправить» в `editor.tsx` оставалась активной кнопка «Сохранить», а поля текста можно было редактировать. `saveProposal` обновлял `sections` последней версии КП без проверки статуса. Поэтому дизайнер мог молча поменять текст и цену КП, которое уже **отправлено или принято клиентом**, и клиент по живой ссылке видел новое содержание.

Смежные проблемы:
- `rebuildProposal` блокировал только статус `sent`, а `accepted` пропускал.
- `sendProposal` на принятом КП возвращал статусы в `sent` / `proposal_sent`, то есть откатывал акцепт. [факт] После этого `createProjectRoom` перестаёт работать (`room/actions.ts:19` требует `proposal_accepted`).

Почему это противоречит замыслу — [факт] комментарии в самом коде: `actions.ts` («После «Отправить» пересборка запрещена: у клиента уже живая ссылка») и `lib/proposal/latest.ts:5-8` («прежние версии — неизменяемая история… принятие клиента естественно привязано к своей версии»).

**Исправление** (коммит `9f2f801`):
- `actions.ts:70` — `saveProposal` возвращает `{ok:false, reason:"sent"}`, если статус не `draft`;
- `actions.ts:98` — в `rebuildProposal` проверка `!== "draft"`;
- `actions.ts:187` — `sendProposal` отказывает для `accepted`;
- `editor.tsx:75`, `:117` — после отправки кнопок сохранения и пересборки нет, поля `readOnly`.

**Регрессия.** Тест `tests/release/m1-brief-to-client-response-chain.test.ts`, блок «a sent or accepted proposal is not rewritten…». Без исправления он даёт 3 падения.

**Что не исправлено** [интерпретация]:
- На уровне БД неизменяемость не закреплена: политика `proposals_studio_all` разрешает `for all` (`20260716071024_legacy_production_baseline.sql:364`). Защиту триггером нужно решать отдельно и добавлять аддитивной миграцией — в рамках минимального исправления я её не делал.
- Ответ клиента и значок «клиент ответил» привязаны к **проекту**, а не к версии КП (`respond/route.ts:55-60`, `p/[public_token]/page.tsx:53`). [факт] Сейчас в UI это недостижимо: новая версия создаётся только когда КП ещё нет (`proposal/page.tsx:142`). [интерпретация] Как только появится «новая версия после запроса правок», клиент не сможет ответить на v2. Это нужно учесть до реализации версий.

## 6. Переходы M1–M4

| Переход | Что есть в коде | Что проверено здесь | Статус |
|---|---|---|---|
| M1 → «комната проекта» (legacy) | [факт] `room/actions.ts:11-19`: только после `proposal_accepted` и принятого КП | Условие теперь не откатывается повторной отправкой (раздел 5). Сама комната не запускалась | NOT_VERIFIED |
| M1 → M2 (enrollment) | [факт] `app/api/projectceo/enroll/route.ts` принимает legacy `projectId`, scope выводится из JWT. SQL: `enroll_organization_project_scope` (`20260922183823`). Паспорт M1 читается в M2 как `contractedPassport` (`live-read-port.ts:837`) | `tests/ap1/commands/enroll-route.test.ts` (vitest), DB4 `77_authenticated_package_scoped_enrollment.sql`, `53/56/59_m1_*` — PASS на PG16 | TESTED_LOCAL (API + БД) |
| M1 → M2: кнопка в UI и предусловие «КП принято» | [факт] Ни одного вызова `/api/projectceo/enroll` из `app/` или `components/` нет. [интерпретация] Enrollment не проверяет, принято ли КП | — | BLOCKED_DECISION |
| M2 → M3 (handoff) | [факт] `lib/project-intelligence/application/m2-to-m3-handoff/index.ts`, `publish_m2_m3_handoff` | DB4 `31/32/33_m2_*`, `33_m2_client_review_m3_handoff_operations.sql` — PASS; vitest contract-тесты M2 зелёные | TESTED_LOCAL (БД + контракты) |
| M3 baseline → release | [факт] `20260825030000_projectceo_publish_baseline_door.sql`, `20260911150000_…request_bound.sql` | DB4 `05/06_m3_*`, `39_publish_version_door`, `51_publish_baseline_door`, `62_publish_work_package_release_request_bound`, `78_package_bound_approval_review` — PASS | TESTED_LOCAL |
| M3 → M4 (distribute / acknowledge / change) | [факт] Флаг `isExecutionModuleEnabled` (`execution-flag.ts:28`), инкремент 1 открывается только в одноразовой среде (`enable-m4-increment-1.sql`) | DB4 `07/08/38_m4_*`, DB5 `05_default_deny_before` → `20_execution_operations` → `90_default_deny_after` — PASS | TESTED_LOCAL |
| M4 V1 Impact | [факт] DEC-033…037 | DB5 `26/28/29/31/32` — PASS | TESTED_LOCAL |
| M4 V2 (фото, вехи) | [факт] DEC-039: открыто **только** для local/disposable через `REMHAOS_M4_V2_V3_ENABLED` (`execution-flag.ts:91`) | DB4 `55_m4_v2_v3_compatibility.sql` — PASS | TESTED_LOCAL (DB) |
| M4 `build_handover` | [факт] В `EXECUTION_NOT_AUTHORIZED_COMMANDS` (`execution-flag.ts:142`) | Закрытость проверена DB4 08 и DB5 90 | BLOCKED_DECISION (не авторизовано) |
| Вся цепочка через браузер пятью ролевыми сессиями (AP5 `tests/ap5/02-kora-chain.spec.ts`) | — | Не запускалась | BLOCKED_EXTERNAL |

[интерпретация] В `AGENTS.md` написано, что V2/V3 «по-прежнему `NOT AUTHORIZED`». Журнал решений (DEC-039 от 27.08.2026) открыл V2/V3 для одноразовых сред. По правилу старшинства из `AGENTS.md` действует журнал. Абзац в `AGENTS.md` устарел, и его стоит поправить отдельно — в этой задаче я его не менял.

Реальные документы. Внешний реальный пакет (цикл 7, Tashkent M3/M4) в репозитории **отсутствует**. [факт] Это записано в `docs/audits/FOUR_MODULE_ARCHITECTURE_AUDIT_2026-09-16.md` §Current reconciliation и в описании PR #208. Синтетические данные этого прогона за реальные не выдаются.

## 7. Блокеры

- **B1 · BLOCKED_EXTERNAL — аутентифицированный браузерный прогон (AP5) и публичная страница КП.** Нужно: локальный Supabase stack (Supabase CLI и образы) плюс Playwright-браузеры. В песочнице нет Supabase CLI, а `docker pull postgres:16-alpine` вернул `429 Too Many Requests` от Docker Hub. Что снимет блокер: окружение с доступом к registry (или зеркалу) и установленным Supabase CLI.
- **B2 · BLOCKED_EXTERNAL — PostgreSQL 17 и docker-зависимые части DB4/DB5.** Не прогонялись: конкурентные пробы `run-concurrency.zsh`, апгрейды населённой базы, restart-replay `30_restart_replay.sql`, R1 upload/validation. Причина та же — нет образов (429). PG16 прогнан на системном кластере, а не в контейнере.
- **B3 · BLOCKED_DECISION — вход M1 → M2 из UI.** Кнопки или маршрута в интерфейсе, который вызывает `/api/projectceo/enroll`, нет. Нужно решение владельца: где точка входа (например, в блоке «КП принято» на странице КП) и должно ли принятое КП быть обязательным условием enrollment.
- **B4 · BLOCKED_DECISION — неизменяемость КП на уровне БД.** Нужно решение, закреплять ли `sent/accepted` триггером. Если да — отдельной аддитивной миграцией.

## 8. next_step

1. Ревью черновика PR (исправление неизменяемости КП).
2. В окружении с Docker registry и Supabase CLI прогнать `npm run test:db4`, `npm run test:db5` (PG16 и PG17) и `npm run test:ap5` на коммите этой ветки.
3. Принять решения B3 и B4. Поправить абзац про V2/V3 в `AGENTS.md` по DEC-039.

## 9. Запуск 2 — 28.09.2026 (R1 + R3)

### 9.1 Статус

| # | Задача | Статус |
|---|---|---|
| R1 | Draft PR | DONE: PR #210 уже был открыт, он draft и указывает на `main` |
| R1 | CI до зелёного | BLOCKED_DECISION, см. B6. Проверки прогнаны локально, результат ниже |
| R3 | Локальная демонстрация «бриф → КП → ответ клиента» | TESTED_LOCAL: `npm run demo:m1:local` |
| R3 | Чек-лист владельцу на 5 минут | DONE_CODE: `docs/ops/autonomy/demo/M1_LOCAL_DEMO.md` §B. Живой прогон — NOT_VERIFIED, сайт закрыт прокси |
| 3d | Публичная страница `/p/[public_token]` | Повышено с NOT_VERIFIED до TESTED_LOCAL: серверный рендер с mock-БД. Клики в браузере по-прежнему NOT_VERIFIED |
| R2 | Переходы M1→M4 | Без изменений относительно раздела 6. Новое — находка B5 |
| R4 | Посевы | Не начато. Это следующий запуск |

### 9.2 Изменённые файлы

- `tests/release/m1-local-demo.test.tsx` — новый. Прогоняет по порядку:
  - бриф → риски → цена → КП;
  - `/p/` на черновике → 404;
  - `sendProposal`;
  - серверный рендер `/p/`: секции, цена, три кнопки, событие `proposal_viewed`;
  - `accept`;
  - повторный рендер с «Вы приняли это предложение».
- `package.json` — добавлен только скрипт `demo:m1:local`. Зависимости не менялись.
- `tests/release/m1-brief-to-client-response-chain.test.ts` — совместимость с веткой `claude/phase-0-kg4xd8`:
  - в мок добавлены `rpc` (`account_retention_active` → false) и `subjectRevisionCurrent: true`;
  - регрессия теперь проверяет отказ и неизменность текста, а не литерал причины (`"sent"` против `"not_draft"`).
- `DEMO.md`, шаг 7:
  - порядок исправлен: сначала «Отправить», потом ссылка `/p/`. [факт] Черновик отдаёт 404, `app/p/[public_token]/page.tsx:34`;
  - добавлено предусловие approval;
  - упомянут `demo:m1:local`.
- `docs/ops/autonomy/demo/M1_LOCAL_DEMO.md` — новый: стенограмма, находка B5, чек-лист владельцу.

### 9.3 Проверки (реально запускались 28.09.2026)

| Команда | Результат |
|---|---|
| `npm ci --no-audit --no-fund` | exit 0 |
| `npm run lint` | exit 0: 0 ошибок, 15 предупреждений (как на base) |
| `npm run typecheck` | exit 0 |
| `npm run test` (с zsh) | exit 0: **259 файлов, 2332 passed, 1 skipped** |
| `npm run build` | exit 0 |
| `npm run demo:m1:local` | 1/1 passed, стенограмма в `M1_LOCAL_DEMO.md` |
| Оба теста M1 на коде `origin/claude/phase-0-kg4xd8` (временный detached worktree, ветку не менял) | До правки моков: 5 failed. После: **11/11 passed** |

GitHub CI не запускался: B6.

### 9.4 Новые блокеры

- **B5 · BLOCKED_DECISION — «Отправить» КП на свежем проекте недостижимо кликами.**
  - [факт] `sendProposal` требует утверждённый approval на `project_passport` (`actions.ts:191`).
  - [факт] RPC `list_approval_requests` авторизует через `_authorize_project_human`, значит, проект должен быть записан в ProjectCEO.
  - [факт] Вызова `/api/projectceo/enroll` в UI нет. AP5 делает enrollment прямым RPC (`tests/ap5/global-setup.ts:146-163`).
  - [интерпретация] Демо по DEMO.md останавливается на шаге 7. Это расширение B3.
  - Нужно решение владельца: (а) кнопка enrollment + approval в пилотном пути **или** (б) отправка КП в пилоте без approval.
- **B6 · BLOCKED_DECISION — CI для PR не запускается.**
  - [факт] Все workflow в `.github/workflows/` имеют только `on: workflow_dispatch` (коммит `07e186d` «chore: disable automatic runs»).
  - [факт] Единственный check у PR #210 — «Supabase Preview», skipped.
  - Правила программы запрещают включать отключённый CI. Ручной dispatch тратит минуты Actions, поэтому я его не запускал.
  - Нужно: владелец запускает `CI` вручную на `claude/autonomy-remh-01` **или** разрешает это исполнителю.
- **B7 · BLOCKED_DECISION — пересечение с `claude/phase-0-kg4xd8` (DEC-044).**
  - [факт] Та ветка меняет те же файлы: `proposal/actions.ts`, `editor.tsx`, `app/api/proposal/respond/route.ts`, `app/p/[public_token]/*`, `package.json`.
  - [факт] В ней тот же фикс неизменяемости КП, только шире: `.eq("status","draft")` в update, причина `not_draft`, триггер БД `guard_proposal_lifecycle` в миграции `20260925090000`. Это закрывает и B4.
  - [факт] `git merge-tree HEAD origin/claude/phase-0-kg4xd8` даёт конфликты в `actions.ts` и `editor.tsx`.
  - Их файлы я не трогал.
  - Рекомендация [интерпретация]: вливать phase-0 первым. После этого из #210 выкинуть коммит `9f2f801`, то есть собственный фикс в `actions.ts`/`editor.tsx`, и оставить только тесты, демо и документы. Тесты уже зелёные на коде phase-0.
  - Нужно решение оркестратора или владельца о порядке слияния.

### 9.5 next_step

1. Владельцу: решить B5, B6, B7. Пройти чек-лист `docs/ops/autonomy/demo/M1_LOCAL_DEMO.md` §B и прислать ✓/✗ по пунктам.
2. Исполнителю, следующий запуск: R4 — посевы для российского пилота из `docs/positioning` и research. Ничего не публиковать.
3. После слияния phase-0: убрать из #210 дублирующий фикс (B7) и перепрогнать `npm run test`.

## 10. Запуск 3 — 28.09.2026 (R2 + R4)

База: `origin/main` = `737795d`; ветка до запуска — `d0f8b24`. Файлы `proposal/actions.ts` и `editor.tsx` не трогались (B7).

### 10.1 Статус

| # | Задача | Статус |
|---|---|---|
| R2 | M1 → M2 | Без изменений: API + БД — TESTED_LOCAL (§6). Вход из UI — BLOCKED_DECISION (B3/B5). Новых тестов нет: реализованной TS-связи «паспорт M1 → данные M2» в коде нет, тестировать нечего |
| R2 | M2 → M3 одним прогоном | **TESTED_LOCAL**: новый `tests/release/m2-m3-transition-chain.test.ts`, 6 тестов |
| R2 | M3 → M4 | Без изменений: TESTED_LOCAL на уровне БД (§6) и прогона Kora (`tests/projectceo-e2e/kora-pilot.e2e.test.ts`, в общем наборе зелёный). Дублирующий тест не писал |
| R4 | Посевы | DONE_CODE (документ): `docs/ops/autonomy/seeding/REMHAOS_SEEDING_2026-09-28.md`. Ничего не отправлено. Площадки — BLOCKED_DECISION D1 |

### 10.2 Изменённые файлы

- `tests/release/m2-m3-transition-chain.test.ts` — новый.
- `docs/ops/autonomy/seeding/REMHAOS_SEEDING_2026-09-28.md` — новый.
- `docs/ops/autonomy/tasks/T-REMH-01.md` — этот раздел.

### 10.3 R2 · что проверяет новый тест

Выход каждого звена — вход следующего: `createRoomDesignIntent` → `createDesignIntentBudget` → `createM2ApprovalSubmission` → `reviewM2ApprovalSubmission` (клиент ≠ дизайнер) → `createApprovedM2Commit` → `createM2ToM3Handoff` → `registerDocumentationSheet` → `reviewPackageCompleteness`. Данные синтетические (комната, 3 варианта × 2 позиции, цены назначены в тесте).

1. Прямой путь: набор выборов, подпись планировки, ревизия намерения и сумма (222 000 ₽, целое) доходят до `sheet.origin` без подмены. Пакет полный.
2. `change_requested` клиента: `M2_COMMIT_NOT_APPROVED` в M2 и `M2_M3_COMMIT_NOT_APPROVED` на входе M3.
3. Цена позиции изменилась после согласования → `M2_COMMIT_STALE_BUDGET`.
4. Цены старше 30 дней на момент подачи → `M2_APPROVAL_MISSING_PRICE`.
5. Планировка не опубликована → `M2_M3_EXACT_LAYOUT_NOT_FOUND`; подпись подменена → `M2_M3_LAYOUT_MISMATCH`.
6. Лист ссылается на выбор другого варианта → `DOCUMENTATION_SHEET_SPECIFICATION_NOT_APPROVED`; неполный лист → `SPECIFICATION_NOT_COVERED`; лист из чужого утверждения → `SHEET_FROM_OTHER_APPROVAL`.

Проверка, что тест ловит поломку: из `createM2ToM3Handoff` временно убраны проверка статуса и сверка подписи → 2 из 6 тестов упали; код восстановлен (в диффе его нет).

Находки [факт]:
- `createApprovedM2Commit` и `createM2ToM3Handoff` не вызываются нигде в `app/`, `components/`, `lib/` вне своих модулей. В продукте переход M2 → M3 делает SQL (`publish_m2_m3_handoff`, `supabase/migrations/20260802090000_projectceo_m2_client_review_m3_handoff.sql`). TS-функции — эталон контракта, а не рабочий путь.
- Тип `ApprovedM2Commit` не содержит полей, которые нужны входу handoff: `id`, `revisionId`, `revisionNo`, `status` коммита, `approvalPackageId`, `layoutRevisionId`. Их присваивает хранилище. В тесте это заполняет функция `persisted` — тестовая замена SQL-записи, не продуктовый адаптер.
- `createApprovedM2Commit` принимает любые непустые id, а handoff требует UUID для проекта и пакета. [интерпретация] В БД id — UUID, поэтому в продукте расхождения нет; в тесте использованы UUID.

### 10.4 R2 · BLOCKED — нужно от владельца (реальные документы не подменялись)

- **R2-1 · BLOCKED_EXTERNAL — реальный пакет цикла 7.** [факт] `tests/fixtures/cycle7/external-package.manifest.json`: `"status": "pending"`, «prices and selections require commercial confirmation». Нужно: подтверждённые цены и выборы по пакету (или другой реальный пакет) — чтобы прогнать M2 → M3 не на синтетике.
- **R2-2 · BLOCKED_DECISION — состав обязательных листов M3.** [факт] `modules/documentation/contracts.ts:86`: «состав обязательных листов нигде не утверждён». Проверка полноты поэтому видит только комнату и выборы. Нужно: утверждённый перечень листов (шаблон пакета документации).
- **R2-3 · BLOCKED_DECISION — связь паспорта M1 с M2.** В коде паспорт M1 в M2 только показывается (`contractedPassport`, `live-read-port.ts:837`), в бюджет или варианты M2 не попадает. Нужно решение: должна ли вилка/бюджет из брифа ограничивать варианты M2 (правило), или это только справка.
- B3/B5 (вход M1 → M2 из UI и approval перед «Отправить») — без изменений, см. §7 и §9.4.

### 10.5 R4 · итог

- Названных площадок с источником в репозитории — **0**. Единственный источник о канале: `docs/positioning/REMHAOS_POSITIONING_V2_2026-08-08.md:160-161` («личная сеть, профессиональные сообщества дизайнеров»). Поиск по `docs/`, `research/`, корневым `*.md`: `docs/gtm/` и `docs/marketing/` не существуют.
- Три текста (дизайнер → `/designers`, студия → `/studios`, сообщество → `/pilot`), UTM-ссылки на `https://www.remhaos.com` (`lib/env.ts:4`), критерий на 14 дней, очередь 29.09–12.10, чек-лист на 5 минут.
- [факт] UTM сейчас не сохраняется нигде: веб-аналитики в коде нет, `pilot_request` пишется без источника (`app/api/pilot/route.ts:16-20`).
- Решения владельца: D1 площадки, D2 учёт UTM, D3 пороги, D4 маркировка рекламы, D5 бесплатный или платный пилот (документы противоречат).

### 10.6 Проверки (реально запускались 28.09.2026)

| Команда | Результат |
|---|---|
| `npm ci --no-audit --no-fund` | exit 0, 599 пакетов |
| `npx vitest run tests/release/m2-m3-transition-chain.test.ts` | 6/6 passed |
| то же на временно испорченном `m2-to-m3-handoff/index.ts` | 2 failed / 4 passed (ожидаемо), файл восстановлен |
| `npm run typecheck` | exit 0 |
| `npx eslint tests/release/m2-m3-transition-chain.test.ts` | 0 ошибок, 0 предупреждений |
| `npm run test` (с zsh) | exit 0: **260 файлов, 2338 passed, 1 skipped** |

Не запускались: `npm run build` (изменены только тест и документы), GitHub CI (B6), живой сайт (закрыт сетевой политикой).

### 10.7 next_step

1. Владельцу: D1–D5 из `REMHAOS_SEEDING_2026-09-28.md` §9, чек-лист §8 там же; R2-1…R2-3; прежние B3/B5/B6/B7.
2. Исполнителю, после D1/D2: дополнить таблицу площадок и UTM-ссылки; после R2-2 — тест полноты пакета M3 по утверждённому перечню листов.

## 11. Запуск 4 — 28.09.2026 (D1 площадки + AP5: локализация падения попытки 1)

База: `origin/main` = `737795d`; ветка до запуска — `3b6f4ae`. Код приложения и CI не менялись: только два документа.

### 11.1 Статус

| # | Задача | Статус |
|---|---|---|
| D1 | Площадки для посевов | DONE_CODE (документ): §3, §4 (сопоставление), §5.2, §7, §9 в `REMHAOS_SEEDING_2026-09-28.md`. 8 кандидатов, все «кандидат — не связывались, согласия нет». Ничего не отправлено |
| AP5-1 | Кандидаты на невоспроизводимое падение по коду | DONE (анализ ниже) |
| AP5-2 | Одноразовый стенд AP5 локально | **BLOCKED_EXTERNAL** — образы Supabase не скачиваются через прокси песочницы (11.4) |
| AP5-3 | Два прогона `npm run test:ap5` | не выполнено: стенда нет |
| AP5-4 | Раздел с итогом | этот раздел |

### 11.2 Изменённые файлы

- `docs/ops/autonomy/seeding/REMHAOS_SEEDING_2026-09-28.md` — §0.1, §3 (таблица площадок + §3.1 чек проверки владельцем), §4 (сопоставление текстов), §5.2 (UTM по площадкам), §7 (очередь 29.09–12.10 под найденные площадки), §9 D1.
- `docs/ops/autonomy/tasks/T-REMH-01.md` — этот раздел.

### 11.3 D1 · как искали и что важно

- Метод: субагент с WebSearch/WebFetch, 22 поисковых запроса, 18 попыток WebFetch. [факт] **Все WebFetch отклонены сетевой политикой песочницы** (`EGRESS_BLOCKED`: tgstat.ru, t.me, rusdecor.ru, unionda.ru, designconference.ru, design-conf.ru, rusdf.ru и др.; `interior-design.club` — DNS-ошибка). Поэтому у каждой строки §3 стоит «по выдаче поиска, страница не открыта», а правила размещения там, где сниппет их не называет, — «неизвестно».
- Личные телефоны, email и имена администраторов не собирались, хотя попадались в выдаче.
- [интерпретация] Восемь строк — это кандидаты, не проверенный список. Проверку существования и правил делает владелец по §3.1 до любого контакта; в частности, для АДДИ корневой домен в выдаче выглядел перехваченным.

### 11.4 AP5 · факты о прогоне и что даёт код

Входные факты (от оркестратора): run `36379317284` на `3b6f4ae`, попытка 1 — job `AP5 authenticated browser matrix`: 1 failed, 2 skipped, `AP5_NO_SKIPS_FAILED skipped=2`; попытка 2 на том же коммите зелёная; артефакт попытки 1 — `10952217446`, недоступен исполнителю.

Что видно по коду:

1. **Пропусков «по условию среды» в AP5 нет.** [факт] `grep -rn 'skip\|fixme\|only' tests/ap5/` находит только комментарий (`02-kora-chain.spec.ts:390`) и `assert-no-skips.mjs`. Ни `test.skip`, ни `test.fixme`, ни условных пропусков по env в спеках нет.
2. **Единственный источник `skipped` — серийный режим.** [факт] `tests/ap5/02-kora-chain.spec.ts:37`: `test.describe.configure({ mode: "serial" })` на уровне файла; `playwright.config.ts`: `retries: 0`, `workers: 1`, `timeout: 60_000`, `expect.timeout: 15_000`. В серийном режиме падение одного теста пропускает все последующие тесты файла.
3. **Серийный режим на уровне файла захватывает и второй `describe`.** [факт] Проверено экспериментом во временном проекте (scratchpad, не в репозитории): файл с `configure({mode:"serial"})` сверху, describe A из 4 тестов (3-й падает) + describe B из 1 теста → JSON-отчёт `expected:4, skipped:2, unexpected:1`. То есть тест из второго describe тоже пропускается.
4. **Порядок тестов.** [факт] `npx playwright test --list`: 31 тест в 2 файлах; в `02-kora-chain.spec.ts` — 18 тестов, последние три: `14. частичный охват (partial_depth) на настоящей странице` (`:965`), `15. заблокированный результат (blocked_result_limit)…` (`:1055`), `фотодоказательство и приёмка вехи остаются закрытыми` (`:1122`). Файл `01-authenticated-role-matrix.spec.ts` серийного режима не имеет: его падение не даёт ни одного `skipped`.
5. **Вывод [интерпретация, но арифметика однозначная]:** `1 failed + 2 skipped` при `retries: 0` означает, что упал **тест 14 (`partial_depth`)**, а пропущены 15 и «фотодоказательство…». Падение теста 13 дало бы 3 пропуска, теста 15 — 1. Другого расклада, дающего ровно 2 пропуска при 1 падении, в этом наборе нет.

### 11.5 AP5 · почему именно тест 14 может падать невоспроизводимо

Тест 14 (`02-kora-chain.spec.ts:965-1037`) — первый в цепочке, где утверждения делаются через настоящую страницу и клики, а не через `context.request`. Кандидаты, по убыванию вероятности [интерпретация]:

- **К1. Клик по вкладке до гидратации.** [факт] Вкладки — клиентское состояние: `components/projectceo/project-workspace.tsx:1958` (`useState`), `:1980` (`onClick={() => setTab(item)}`), компонент `"use client"` (`:1`), страница `force-dynamic`. Тест делает `page.goto(...)` и сразу `getByRole("tab", { name: "Изменения" }).click()` (`:996-998`). `goto` завершается по `load`, гидратация React-дерева на ~2000 строк может закончиться позже; клик по ещё не гидратированной кнопке теряется, вкладка не переключается, `await expect(card).toBeVisible()` (`:1001`) истекает через 15 с → 1 failed. На повторе на том же коммите успевает — «зелёная попытка 2» это ровно такая картина. Ни одно утверждение теста не проверяет, что вкладка действительно переключилась (`aria-selected`).
  - Как сделать устойчивым без ослабления: после клика дождаться `aria-selected="true"` у вкладки и повторять клик до этого (`expect(async () => { await tab.click(); await expect(tab).toHaveAttribute("aria-selected", "true"); }).toPass()`), либо перед кликом дождаться признака гидратации. Утверждения про карточку и тексты не меняются.
- **К2. Бюджет 60 с на весь тест.** [факт] До первого клика тест успевает: выпуск токена архитектора + `ingest_source_graph` (9 узлов), `publish_release`, пересмотр решения (5 команд + 2 чтения), заявка строителя (3 чтения + 1 команда), запуск воркера как отдельного процесса `npm run --silent worker:change-impact` (`change-impact-worker.ts:64`, старт `tsx` + расчёт), потом `goto`, клик, цикл до 8 кликов, каждый — команда + `router.refresh()` (`command-client.tsx:62`, повторный серверный рендер страницы). На загруженном раннере это десятки секунд; тест не логирует длительности шагов, поэтому по логу нельзя сказать, где ушло время. Таймаут теста в отчёте выглядит как «Test timeout of 60000ms exceeded» — это отличимо от К1 только по артефакту.
  - Как сделать устойчивым без ослабления: не поднимать таймаут вслепую, а сначала снять длительности шагов (`test.step` вокруг ingest / воркера / цикла кликов — они попадают в JSON-отчёт и трассу). Если доминирует воркер или цикл, отделить их бюджет (`test.slow()` только для 14/15 или `test.setTimeout` с обоснованием), не трогая `expect.timeout`.
- **К3. Цикл кликов маскирует настоящую причину.** [факт] `:1016-1024`: `waitForResponse` принимает любой ответ `/api/projectceo/commands`, статус не проверяется. Кнопка на время запроса меняет подпись на «Обновить» (`command-client.tsx:76`, `ru.ts:1215`), поэтому `toHaveCount(remaining)` проходит ещё до применения `router.refresh()`. Если команда ответила не `completed`, кнопка возвращает подпись, статус ошибки в DOM не проверяется, и тест падает на следующей итерации `toHaveCount` через 15 с с сообщением про число кнопок, а не про 4xx/5xx. Это не отдельная причина нестабильности, но именно из-за этого падение попытки 1 нельзя прочитать без артефакта.
  - Как сделать устойчивым без ослабления: сохранить `response` из `waitForResponse` и утверждать `status() === 200` и `body.status === "completed"` на каждой итерации; дополнительно `toHaveCount(0)` для `role="status"` с текстом `commandUnavailable` внутри карточки. Проверка становится строже, а не слабее.
- **К4. Не кандидаты (проверено):** `ANALYZE` статистики планировщика выполняется только в `ingestWideStar` (`coverage-graph.ts:334`), то есть в тесте 15, который в попытке 1 не запускался; `review_change_impact` не несёт `expectedStateRevision` (`project-workspace.tsx:1479-1484`), поэтому CAS-гонка между кликами исключена; воркер ищет очередь сам, повторный проход no-op (`:1109-1110` относится к 15).

Что нужно от владельца, чтобы закрыть вопрос (артефакт `10952217446` из run `36379317284`):
1. `test-results/ap5-report.json` → у теста 14 поле `error.message` и `duration`: «Test timeout of 60000ms» подтверждает К2, «expect(locator).toBeVisible … article» — К1, «toHaveCount» — К3.
2. `test-results/**/trace.zip` (`trace: "retain-on-failure"`) → на каком действии остановилось и был ли ответ команды не-200.
3. Из зелёной попытки 2 — тот же `ap5-report.json`: `duration` теста 14 показывает, насколько близко к 60 с проходит успешный прогон.
4. `app.log` в артефакт не попадает: на падении печатается только число строк (`ci.yml:383-390`). Предложение (не применено): добавить `${RUNNER_TEMP}/app.log` в `upload-artifact` — тогда 5xx со стороны сервера будут видны без повторного прогона.

### 11.6 AP5 · локальный стенд — BLOCKED_EXTERNAL

Что удалось по шагам job (`ci.yml:265-374`):
- [факт] Docker-демон в песочнице не запущен по умолчанию (`/var/run/docker.sock` нет), но `dockerd` запускается вручную: `Server Version: 29.3.1`.
- [факт] Supabase CLI 2.109.1 скачивается с GitHub releases и запускается (`supabase --version` → `2.109.1`; в тарболле шим `supabase` + `supabase-go`, их нельзя разносить по разным каталогам). `psql` 16.13 есть.
- [факт] `supabase start` с репозиторным `config.toml` не смог скачать образы. Попытка 1 (прямой `docker pull public.ecr.aws/supabase/postgres`): blob-запрос к `d2glxqk2uabbnd.cloudfront.net` → `Forbidden`; `docker.io` → `429 Too Many Requests`. Попытка 2 (`supabase start`, перебирает ECR → ghcr → docker.io): 34 × `Forbidden` (cloudfront и `pkg-containers.githubusercontent.com`), 6 × `429` (docker.io), 1 × `Data limit exceeded`, `pull access denied` для `supabase/kong`, `supabase/imgproxy` на docker.io. Скачался только `supabase/postgres:17.6.1.143` (1,7 ГБ), остальные (`postgrest`, `gotrue`, `storage-api`, `kong`, `imgproxy`) — нет. Образ удалён, контейнеры не создавались.
- Нужно, чтобы стенд заработал: разрешить в сетевой политике окружения `d2glxqk2uabbnd.cloudfront.net`, `pkg-containers.githubusercontent.com` (ghcr blobs) или docker.io без лимита. Больше двух попыток не делал.

### 11.7 Проверки (реально запускались 28.09.2026)

| Команда | Результат |
|---|---|
| `npm ci --no-audit --no-fund` | exit 0 |
| `npx playwright test --list` (с заглушками env) | 31 тест в 2 файлах, порядок как в 11.4 п.4 |
| эксперимент серийного режима (временный проект в scratchpad) | `expected:4, skipped:2, unexpected:1` |
| `dockerd`, `supabase --version`, `supabase start` | см. 11.6 |
| `npm run test:ap5` | **не запускался** (нет стенда) |
| `lint` / `typecheck` / `test` / `build` | не запускались: изменены только два `.md` |

Совпадение двух зелёных прогонов, если владелец их получит, не докажет отсутствие проблемы: при К1 и К2 падение зависит от загрузки раннера, а не от кода.

### 11.8 next_step

1. Владельцу: прислать из артефакта `10952217446` `ap5-report.json` (ошибка и `duration` теста 14) и `trace.zip`; из попытки 2 — `duration` теста 14. Проверить §3 плана посевов по §3.1 и вычеркнуть лишнее.
2. Исполнителю после артефакта: подтвердить К1/К2/К3 и подготовить правку теста 14 (ожидание `aria-selected`, проверка статуса ответа в цикле, `test.step` с длительностями) отдельным коммитом; CI не трогать.
3. Прежние блокеры без изменений: B3/B5, B6, B7, R2-1…R2-3, D2–D5.
