# Telegram в RemHaOS: два контура и предложение единого контракта

**Статус:** DRAFT. Это описание и предложение, **не решение**. Документ ничего
не меняет в каноне, коде, миграциях и флагах. Любой пункт раздела 4 вступает в
силу только отдельным решением владельца (новая строка DEC в
`REMHAOS_DECISION_LOG_v1.md`).

**Основание:** DEC-040 (6), 25.09.2026 — «Telegram — ни один контур не
выбирается и не расширяется; сначала описание обоих и предложение одного
совместимого основного контракта». Вопрос Q6 финального аудита
(`docs/audits/REMHAOS_FINAL_AUDIT_2026-09-25.md:215`), BUG-18 (там же, `:121`).

**Срез кода:** `main` @ `2e36a1a`. Все ссылки `file:line` сверены с этим срезом.

---

## 1. Назначение и статус

В репозитории живут два независимых Telegram-контура, которые делят один
webhook-маршрут и один флаг:

| | Контур A7 «мост» | Контур integration staging |
|---|---|---|
| Схемы БД | `remhaos_channel`, `remhaos_channel_api` | `remhaos_integration`, `remhaos_integration_api` |
| Миграции | `20260811040000` … `20260811070000` | `20260826030233`, `20260826057000`, `20260827010000` (+ упоминания операций в реестре `20260826034120/042000/044000/058000`) |
| Канон | A7 + DEC-031 (LOCKED), runbook `REMHAOS_TELEGRAM_BRIDGE_RUNBOOK.md` | канонического addendum нет; часть Integration Gateway |
| Код | `app/api/integrations/telegram/webhook/route.ts` (A7-ветка), `channel-port.ts`, `update-contract.ts`, `extraction/*`, `notification-runner.ts`, `distribution-projector.ts`, `scripts/run-telegram-*.ts` | `lib/integration-gateway/telegram/{webhook,runtime,worker,contracts,provider-transport,service}.ts` |
| Гейты | TG0/TG1 PASS, TG2/TG3 NOT PROVEN, TG4 BLOCKED (`RUNBOOK.md:20-28`) | отдельных гейтов нет |

Цель документа — зафиксировать фактическое поведение обоих, риски
сосуществования и предложить **один** контракт, в который оба могут быть сведены
без потери уже доказанных свойств.

---

## 2. Сравнение по измерениям

### 2.1 Вход и флаги

| | A7 | integration |
|---|---|---|
| Диспетчеризация | `route.ts:453-456`: если `REMHAOS_INTEGRATIONS_ENABLED === "true"`, **весь** запрос уходит в `postTelegramIntegrationWebhook`; A7-ветка не исполняется вовсе | та же точка `route.ts:454-455` |
| Флаг контура | `REMHAOS_TELEGRAM_BRIDGE_ENABLED` (`bridge-flag.ts:20-24`, проверка `route.ts:460`) | **тот же** `REMHAOS_TELEGRAM_BRIDGE_ENABLED` (`webhook.ts:12-14`, проверка `:36`) |
| Доп. флаг | — | `REMHAOS_TELEGRAM_WORKER_ENABLED` (`webhook.ts:51-53`), иначе 503 `worker_unavailable` |
| Секреты | `TELEGRAM_TEST_BOT_TOKEN`, `TELEGRAM_TEST_WEBHOOK_SECRET`, `TELEGRAM_TEST_BOT_USERNAME` (`config.ts:38-42`) | `TELEGRAM_WEBHOOK_SECRET` (`webhook.ts:46`), `TELEGRAM_BOT_TOKEN` (`runtime.ts:78`) |
| Ответы | 200 на семантический отказ, 503 `retryLater` на транзиентный (`route.ts:67-106`), 404 при выключенном мосте | 202 принято; 400 на любую нераспознанную ошибку, включая «чат не привязан» (`webhook.ts:16-33`); 503 только для трёх кодов |

Уточнение к ранее собранной сводке: «оба контура делят
`REMHAOS_TELEGRAM_BRIDGE_ENABLED`» — **верно**; «маршрут диспетчеризуется
целиком по `REMHAOS_INTEGRATIONS_ENABLED`» — **верно**. Дополнительно: контуры
читают **разные** переменные с токеном и секретом, а `.env.example` объявляет
`REMHAOS_TELEGRAM_BRIDGE_ENABLED` дважды (`.env.example:27` и `:142`).

### 2.2 Привязка чата к проекту

| | A7 | integration |
|---|---|---|
| Механизм | `/start <nonce>` в группе: nonce из `create_binding_intent`, проверка, что инициатор и бот — администраторы чата (`route.ts:364-413`), связь создаётся `notice_pending`, приём открывается только после публикации уведомления участникам (`route.ts:182-280`, `20260811070000:521`, `:686`, `:774`) | человеческий RPC `bind_telegram_chat(project, chat_id bigint, label, key)` с правом `manage_project_integrations` (`20260826030233:379-445`); сырой `chat_id` вводит человек |
| Уведомление участникам | обязательно, версия текста хранится (`20260811040000:79-82`) | нет |
| Проверка администраторства | инициатор и бот (`route.ts:396-413`) | нет |
| Уникальность | одна живая связь на чат (`provider, external_chat_id`) и одна на проект (`org, project, provider`) для `pending/notice_pending/active` (`20260811070000:160-166`) | частичный уникальный индекс `(organization_id, project_id, chat_id) where status='active'` (`20260826030233:152-154`) — один чат **может** быть активен в нескольких проектах, один проект — в нескольких чатах |
| Разрешение неоднозначности | исключено индексом | во время приёма: `resolve_telegram_webhook_binding` поднимает `TELEGRAM_CHAT_AMBIGUOUS`, если активных связей > 1 (`20260827010000:24-32`) |
| Вызов из TS | `channel-port.ts`, панель `telegram-channel-panel.tsx` | `bind_telegram_chat` не вызывается ни одним TS-файлом; есть только в SQL-тестах (`tests/db-integration-gateway/10_schema_security.sql:205`) |

### 2.3 Входящий путь

| | A7 | integration |
|---|---|---|
| Запись | `ingest_channel_update` → `remhaos_channel.channel_events` (`20260811050000:523`, переопределена `20260811070000:955`); вызов `route.ts:573-584` | синхронно в запросе webhook: `resolve_telegram_webhook_binding` → скачивание вложений → `ingest_telegram_update` (`runtime.ts:40-62`) пишет `telegram_updates`, `telegram_attachments`, `telegram_candidates`, `telegram_ingestion_jobs` (`20260826030233:570-770`) |
| Текст сообщения | хранится в `channel_events.payload.text` (`update-contract.ts:179-195`) | хранится только sha256 (`contracts.ts:26-30,80`; `20260826030233:178`) — человеку в Inbox показать нечего, кроме факта |
| Разбор | отдельный воркер `extraction/runner.ts` с детерминированным классификатором без LLM (`extraction/classifier.ts:1-9`) → типизированные `project_inbox_candidates` (`question`, `decision_candidate`, `change_request_candidate`, `risk_candidate`, …; `20260811040000:312-330`) | кандидат создаётся сразу в RPC: `source_kind in ('message','attachment')`, без типизации (`20260826030233:248-257`) |
| Правки | ревизия `source_revision` на `edited_message` | `edited_message` нормализуется как обычное сообщение (`contracts.ts:40`), ревизии нет |
| Очередь задач | `claim_channel_events` / `complete_channel_event` (`20260811060000:30,159`), воркер `scripts/run-telegram-bridge-workers.ts` | `telegram_ingestion_jobs` ставятся (`20260826030233:749-757`), но `claimJobs/completeJob/failJob` (`worker.ts:142-193`) **не вызываются нигде** — очередь пишется и не разбирается |

### 2.4 Вложения

| | A7 | integration |
|---|---|---|
| Таблица | `remhaos_channel.channel_attachments` (`20260811040000:268-305`) | `remhaos_integration.telegram_attachments` (`20260826030233:204-245`) |
| Запись | **ни одной строки**: `ingest_channel_update` не принимает вложения, порт их не передаёт (`channel-port.ts:303-320`); доживает только `attachmentCount` (`update-contract.ts:193`) | скачивание `getFile` с лимитами 64 КБ/50 МБ (`provider-transport.ts:6-7,144-180`), sha256, проверка размера (`worker.ts:89-97`), загрузка в карантинный ключ `…/quarantine/telegram/<sha>/<role>` (`worker.ts:43-64,105-113`); ключ дополнительно проверяет триггер `telegram_attachment_quarantine_key_guard` (`20260826057000:33-37`) |
| Сканирование | статусная модель есть (`scan_status`), исполнителя нет | статус `quarantined` по умолчанию, исполнителя сканирования нет |

### 2.5 Миграция группы в супергруппу

| | A7 | integration |
|---|---|---|
| `migrate_to_chat_id` / `migrate_from_chat_id` | в коде не встречаются (ни в `app`, ни в `lib`, ни в миграциях) — связь осиротеет (`RUNBOOK.md:179-184`) | тоже не читаются из апдейта; есть **ручной** человеческий RPC `migrate_telegram_chat` (`20260826030233:447-538`), переводящий старую связь в `migrated` и создающий новую; TS-вызывающего нет |

### 2.6 Исходящие

| | A7 | integration |
|---|---|---|
| Очередь | `notification_outbox` (`20260811040000:386`), `enqueue/claim/mark_*` с арендой и fencing (`20260811070000:1085,1153,1193`) | нет |
| Проектор/отправитель | `distribution-projector.ts`, `notification-runner.ts`, `scripts/run-telegram-notifications.ts` (гейт `isTelegramBridgeEnabled`, `:38`) | нет |

### 2.7 Хранение идентификаторов Telegram

- A7: сырые `external_chat_id`, `external_sender_id`, `external_file_id` — только
  в `remhaos_channel.*` (`20260811040000:6-7` прямо фиксирует запрет на доменные
  таблицы).
- integration: сырые `chat_id`, `sender_id`, `message_id` в
  `telegram_bindings`/`telegram_updates` плюс `chat_id_digest`; `file_id` — только
  digest (`contracts.ts:52`; запрет ключей `file_id`, `chat_id` в RPC —
  `20260826030233:624-631`).
- Ни один контур не пишет Telegram-идентификаторы в таблицы M1–M4: поиск
  `telegram_chat_id|telegram_user_id|chat_id` вне схем `remhaos_channel` и
  `remhaos_integration` по `supabase/migrations` пуст.
- Логи A7: `chatRef` — sha256 без соли, обрезанный до 12 hex
  (`observability.ts:59-64`), восстанавливается словарём (SEC-10 аудита).

### 2.8 Железные правила A7 (§1.6, §1.7, §2.1)

| Правило | A7 | integration |
|---|---|---|
| §1.6 всё из чата — только кандидат | да: `project_inbox_candidates` без перехода в официальный объект | да: `telegram_candidates`, review только `accepted/rejected` |
| §1.7 Telegram не переносит полномочия | привязка аккаунта не создаёт членства; callback не обрабатывается намеренно (`RUNBOOK.md:196-199`) | человеческих действий из чата нет |
| §2.1 не писать из webhook в M1–M4 | соблюдено | соблюдено |
| §2.1 не вызывать human RPC через `service_role` | системные RPC выданы только `service_role` (`20260811050000:852-872`) | системные RPC выданы `pi_worker_executor` (`20260826030233:1140-1145`), `resolve_…` — `service_role, pi_worker_executor` (`20260827010000:321-322`) |
| §2.1 не строить вторую Telegram-истину | один Inbox A7 | **второй** набор кандидатов и **вторая** поверхность: страница `/inbox` читает integration-кандидатов под флагом A7 (`app/dashboard/projectceo/projects/[projectId]/inbox/page.tsx:21,30-32`), а рабочее пространство проекта показывает A7-панели (`components/projectceo/project-workspace.tsx:1508,1605`) |
| Уведомление участникам до приёма (A7 §6, TG1 дефект №2) | соблюдено | не предусмотрено |
| DEC-031 «один чат — один проект» | индекс в базе | не соблюдено в базе, только ошибка на приёме |

### 2.9 Тесты

- A7: `tests/projectceo-integration/telegram-{webhook-route,transport,notice-recovery,inbox-vertical,bridge-surface}.test.ts`,
  `tests/projectceo-ui/telegram-channel-panel.test.tsx`,
  `tests/db4/42…47_telegram_*.sql`, `run-telegram-upgrade.zsh`,
  `run-telegram-concurrency.zsh`; `lib/integration-gateway/telegram/lease.test.ts`.
- integration: `tests/integration-gateway/telegram-webhook.test.ts` (импортирует
  `postTelegramIntegrationWebhook` напрямую, `:13`),
  `tests/integration-gateway/telegram.static.test.ts`,
  `tests/db-integration-gateway/60_telegram_staging.sql`,
  `lib/integration-gateway/telegram/{worker,provider-transport,security}.test.ts`.
- Пробел: ветка диспетчеризации `route.ts:454-455` не покрыта ни одним тестом
  (`REMHAOS_INTEGRATIONS_ENABLED` в тестах встречается только в
  `static-boundary.test.ts` и `route-early-paths.test.ts`, ни один не вызывает
  Telegram webhook).

### 2.10 Дыры TG2 (по `RUNBOOK.md:171-194`)

| # | Дыра A7 | Есть ли в integration |
|---|---|---|
| 1 | вложения не доходят до базы | закрыто иначе: скачивание, checksum, карантин |
| 2 | нет обработки `migrate_to_chat_id` | частично: ручной RPC без вызывающего, автоматики нет |
| 3 | настоящая HTTP-граница не проверена (порт подменён, базы нет) | так же: тест вызывает обработчик с моками, не маршрут и не базу |
| 4 | отправитель и проектор доказаны только на фикстурах | исходящих нет вовсе |

---

## 3. Риски текущего состояния (без изменения кода)

1. **Молчаливое отключение A7.** `REMHAOS_INTEGRATIONS_ENABLED=true` (флаг всего
   Integration Gateway, нужен также Google Drive и `/connections`) выключает
   весь A7-вход: handshake, публикацию уведомления, `my_chat_member`
   (приостановку при удалении бота) и приём. При этом A7-отправитель
   (`scripts/run-telegram-notifications.ts`) продолжает работать от
   `REMHAOS_TELEGRAM_BRIDGE_ENABLED` — исходящие идут в чаты, входящие из
   которых уже не принимаются.
2. **Повторы Telegram.** integration отвечает 400 на непривязанный чат и на
   неклассифицированные ошибки (`webhook.ts:16-33`); Telegram повторяет не-2xx,
   очередь апдейтов бота забивается (BUG-18).
3. **Нарушение DEC-031 в integration.** База разрешает один чат в нескольких
   проектах; ошибка всплывает только на приёме (`TELEGRAM_CHAT_AMBIGUOUS`), и
   все сообщения чата теряются для всех проектов.
4. **Нет согласия участников.** integration открывает приём без уведомления
   группы и без проверки администраторов — то, что A7 закрыл как дефект TG1 №2/№3.
5. **Синхронная загрузка файлов в webhook.** До 10 файлов по 50 МБ скачиваются в
   запросе (`runtime.ts:48-53`), что упирается в таймаут webhook Telegram и
   функции хостинга; повтор снова скачивает те же файлы.
6. **Мёртвая очередь.** `telegram_ingestion_jobs` наполняется, но не
   разбирается; кандидаты integration несут только digest текста.
7. **Две поверхности Inbox.** Человек видит разные наборы кандидатов в
   `/inbox` и в рабочем пространстве проекта; review идёт через разные RPC и
   разные флаги (`app/api/projects/[projectId]/inbox/review/route.ts:29` —
   `integrationGatewayEnabled`, список — флаг A7).
8. **Разные секреты на одном URL.** Смена контура флагом без смены секрета
   webhook ломает аутентификацию (`config.ts:38-42` против `webhook.ts:46`).
9. **Осиротение связи при повышении группы** — в обоих контурах.

Все риски — на staging/local: production Telegram не разрешён (A7 §1.11,
`RUNBOOK.md:27`), оба флага по умолчанию `false` (`.env.example:24,27-28`).

---

## 4. Предлагаемый единый совместимый контракт

> **ПРЕДЛОЖЕНИЕ, НЕ РЕШЕНИЕ.** Ниже — форма контракта, в который можно свести
> оба контура. Ничего из этого не исполняется до отдельного DEC владельца.

**4.1 Один контур записи, два слоя.** Каноническая модель связи, событий,
кандидатов и исходящих — из A7 (`remhaos_channel`): она уже держит DEC-031,
уведомление, администраторство, ревизии, типизированных кандидатов, outbox с
арендой и прошла TG1. Файловый конвейер — из integration: скачивание с
лимитами, sha256, проверка размера, карантинный ключ и его триггер-страж.
Иначе говоря: integration становится **реализацией дыры TG2 №1** внутри A7, а не
вторым входом.

**4.2 Привязка.** Только A7 handshake (`/start <nonce>` + администраторы +
уведомление до приёма). `bind_telegram_chat` с сырым `chat_id` — не
пользовательский путь; при сведении контуров он не получает вызывающего.

**4.3 DEC-031 на уровне базы.** Инвариант «один живой чат — один проект, один
проект — один живой чат» задаётся уникальными индексами (форма
`20260811070000:160-166`), а не проверкой на приёме. Неоднозначность на приёме
становится невозможной, а не обрабатываемой.

**4.4 Автоматическая миграция чата.** Обработчик читает `migrate_to_chat_id`
(в старом чате) / `migrate_from_chat_id` (в новом) и атомарно, идемпотентно
переносит живую связь: старая — `migrated` со ссылкой на новую (форма статусов
из `migrate_telegram_chat`, `20260826030233:115-116,146-150`), новая — `active`
без повторного уведомления, так как это та же группа. Ручной RPC остаётся только
операторским recovery.

**4.5 Вложения.** Webhook пишет событие и метаданные вложения (digest
`file_id`, заявленные размер и тип) синхронно и отвечает быстро. Скачивание,
checksum и карантин — отдельный воркер по очереди с арендой (форма
`claim_channel_events`), результат — строка `channel_attachments` со
`storage_locator` и `server_sha256` (уже требуется
`channel_attachments_clean_shape_check`). Кандидат из вложения остаётся
кандидатом до `scan_status='clean'` и решения человека.

**4.6 Раздельные флаги.** `REMHAOS_INTEGRATIONS_ENABLED` больше не
маршрутизирует Telegram. Предлагаемая тройка, все default-off, сравнение только
со строкой `"true"`:
- `REMHAOS_TELEGRAM_BRIDGE_ENABLED` — вход, привязка, приём, Inbox;
- `REMHAOS_TELEGRAM_ATTACHMENTS_ENABLED` — воркер скачивания и карантина;
- `REMHAOS_TELEGRAM_NOTIFICATIONS_ENABLED` — outbox-отправитель.
Один набор переменных бота/секрета на маршрут.

**4.7 Ответы webhook.** 200 на любой семантический отказ (чат не привязан,
чужой бот, мусор), 503 только на транзиентный сбой — как в A7
(`route.ts:67-106`).

**4.8 Одна поверхность Inbox.** Один список кандидатов и один review-RPC; обе
текущие поверхности читают одно и то же.

**4.9 Идентификаторы.** Сырые id — только в схеме моста; в логах — HMAC с
серверным ключом вместо `chatRef` без соли. В M1–M4 — ничего (A7 §2.1 без
изменений).

**4.10 Судьба integration-схемы.** Таблицы `remhaos_integration.telegram_*`
остаются неизменными (миграции неизменяемы); при принятии контракта —
отдельный DEC о выводе их из записи и способе обращения с уже накопленными
строками staging.

---

## 5. Что НЕ делается сейчас (DEC-040 (6))

- Ни один контур не объявляется каноническим и не расширяется.
- Не меняются `route.ts`, флаги, `.env.example`, миграции, RPC, UI и тесты.
- Не закрываются дыры TG2, не добавляется обработка `migrate_to_chat_id`, не
  строится воркер вложений.
- Не исправляются BUG-18 и SEC-10 — они ждут выбора контракта, иначе
  исправление придётся делать дважды.
- Production Telegram, TG4 и внешние учётные данные — вне объёма.

---

## 6. Вопросы владельцу

1. **Основа контракта.**
   (а) A7 как основа + файловый конвейер integration (раздел 4, рекомендация);
   (б) integration как основа + перенос в неё handshake, уведомления, DEC-031 и outbox;
   (в) отложить сведение, но до него запретить одновременное включение
   `REMHAOS_INTEGRATIONS_ENABLED` и `REMHAOS_TELEGRAM_BRIDGE_ENABLED` на одном стенде.
2. **Миграция группы.** (а) автоматическая по `migrate_to_chat_id` (4.4);
   (б) только ручная операторская; (в) автоматическая с повторным уведомлением группы.
3. **Вложения.** (а) асинхронный воркер (4.5); (б) синхронно в webhook, как
   сейчас в integration, с жёстким лимитом размера.
4. **Флаги.** (а) три раздельных флага (4.6); (б) один флаг моста + worker-флаг.
5. **integration-кандидаты staging.** (а) заморозить без миграции данных;
   (б) перенести в `project_inbox_candidates` одноразовым скриптом; (в) удалить на
   disposable-стендах.
6. **Порядок относительно TG2.** (а) сначала DEC по контракту, затем C2 в его
   рамках; (б) закрыть C2 в A7 как есть, сведение — после.
