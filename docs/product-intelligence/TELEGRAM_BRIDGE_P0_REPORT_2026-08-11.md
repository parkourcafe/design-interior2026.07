# Telegram Chat Bridge P0 — отчёт этапа

**Класс документа:** Implementation Report.
**Дата:** 11.08.2026.
**Основание:** Addendum A7 (`REMHAOS_ADDENDUM_A7_TELEGRAM_CHAT_BRIDGE.md`), DEC-031.
**База:** `main` = `50c19ee` (после #81, M4 Worker Foundation / Increment 1.5).

Каждый факт помечен: **EXTRACTED** — подтверждено репозиторием, CI или
Telegram; **INTERPRETED** — архитектурный вывод; **BLOCKED** — внешнего
доказательства нет.

---

## 1. Зафиксированные документы

| Документ | Что сделано | Метка |
|---|---|---|
| `REMHAOS_ADDENDUM_A7_TELEGRAM_CHAT_BRIDGE.md` | создан, статус **ПОДПИСАН**, владелец Selena, 11.08.2026 | EXTRACTED |
| `REMHAOS_DECISION_LOG_v1.md` | добавлен `DEC-031 · LOCKED` + примечание о пробеле DEC-026/027 и о rebase PR #77 | EXTRACTED |
| `CHAT_INGESTION_HYPOTHESIS_2026-08-08.md` | помечен `PARTIALLY SUPERSEDED BY A7 / DEC-031`; исторический текст не переписан; названы ровно два отменённых предположения | EXTRACTED |
| `AGENTS.md` | раздел об открытии моста рядом с M2/M3/M4 | EXTRACTED |
| `REMHAOS_ENTITY_CATALOG_v1.md` | новый §3.1 «Integration Gateway entities» с рёбрами и запретами | EXTRACTED |
| `REMHAOS_WORKFLOW_CATALOG_v1.md` | `WF-GW-001` — workflow шлюза, не модуля | EXTRACTED |
| `REMHAOS_READINESS_MATRIX_v1.csv` | строка `Integrations,Telegram Chat Bridge`; `PII-heavy connectors` остаётся `BLOCKED` | EXTRACTED |
| зеркала в `docs/canonical/archidom-v1/` | по конвенции «оба бренда», как делали A5 и A6 | EXTRACTED |
| `TELEGRAM_BRIDGE_RUNBOOK.md` | установка вебхука, подключение, ротация, три уровня остановки, диагностика | EXTRACTED |

Параллельных каталогов не заведено: правились файлы, которые уже существовали.
**EXTRACTED**

---

## 2. PR и SHA

| # | PR | Ветка | SHA | Гейт |
|---|---|---|---|---|
| 1 | [#82](https://github.com/parkourcafe/design-interior2026.07/pull/82) `docs(telegram): sign A7 and lock DEC-031` | `claude/remhaos-telegram-bridge-p0-aq7mfw` | `edd3b0a` | `TG0_ARCHITECTURE_LOCKED` |
| 2 | [#85](https://github.com/parkourcafe/design-interior2026.07/pull/85) `feat(telegram): add default-deny bridge foundation` | `…-foundation` | `25f802e` | `TG1_FOUNDATION_PROVEN` |
| 3 | [#86](https://github.com/parkourcafe/design-interior2026.07/pull/86) `feat(telegram): add verified group binding and durable transport` | `…-transport` | `af188d5` | `TG2_TRANSPORT_PROVEN` |
| 4 | [#88](https://github.com/parkourcafe/design-interior2026.07/pull/88) `feat(telegram): prove M3 to M4 chat bridge vertical` | `…-vertical` | `7cc4c0d` | TG3 — частично, см. §8 |

Ветки stacked: `main` → #82 → #85 → #86 → #88. Мержить в этом порядке.
**EXTRACTED**

PR #77 не тронут ни одним коммитом. **EXTRACTED**

---

## 3. Что добавлено

**Таблицы** (схема `projectceo_gateway`, миграция `20260811040000`):
`project_channel_bindings`, `channel_identity_links`, `channel_link_intents`,
`channel_events`, `channel_attachments`, `project_inbox_candidates`,
`notification_outbox`. **EXTRACTED**

**RPC** (`projectceo_gateway_api`, миграция `20260811050000`): 5 человеческих и
14 системных, перечислены в матрице `bridge-surface.ts`. **EXTRACTED**

**Маршруты:** `POST /api/integrations/telegram/webhook`, `…/connect`,
`…/disconnect`, `…/inbox`; страницы
`/dashboard/projectceo/projects/[projectId]/integrations` и `…/inbox`.
**EXTRACTED**

**Adapters:** `update-schema`, `telegram-api`, `gateway-port`, `webhook-service`,
`extraction`, `release-notification`, `bridge-log`, `bridge-flag`,
`bridge-surface`. **EXTRACTED**

**Runners:** `notification-runner` (`npm run worker:telegram-outbox`),
`inbound-runner` (`npm run worker:telegram-inbound`). Форма взята у Release
Artifact Worker: нового универсального worker framework не построено.
**EXTRACTED**

**Capability:** `manage_project_integrations` в существующем реестре, только
project-scoped `owner_lead`. **EXTRACTED**

---

## 4. Какой пользовательский сценарий работает

```text
владелец связывает Telegram-аккаунт (private start)
→ «Создать или подключить Telegram-чат» (startgroup)
→ Telegram предлагает создать или выбрать группу
→ бот становится администратором
→ бот публикует уведомление участникам
→ ТОЛЬКО ТЕПЕРЬ начинается приём

distribute_release → догоняющий проектор → outbox → сообщение в группу
→ защищённая ссылка → вход → acknowledge_release СЕССИЕЙ ПОЛУЧАТЕЛЯ

сообщение строителя → channel_event → extraction worker
→ change_request_candidate (pending) → Project Inbox
→ человек читает, правит текст, submit → create_change (его сессией)
→ кандидат помечается проверенным
```

Сценарий проходит контрактно и на уровне маршрутов. Через **настоящий**
Telegram — нет: см. §7. **INTERPRETED**

---

## 5. Результаты гейтов

| Гейт | #85 | #86 | #88 | Метка |
|---|---|---|---|---|
| `lint` | ✅ | ✅ | ✅ | EXTRACTED |
| `typecheck` | ✅ | ✅ | ✅ | EXTRACTED |
| `test` | ✅ 1235 | ✅ 1288 | ✅ 1302 | EXTRACTED |
| `build` | ✅ | ✅ | ✅ | EXTRACTED |
| migration ledger | ✅ | — | — | EXTRACTED |
| DB4 · PostgreSQL 16 | ✅ CI | ✅ CI | ✅ CI | EXTRACTED |
| DB4 · PostgreSQL 17 | ✅ CI | ✅ CI | ✅ CI | EXTRACTED |
| RLS negative scope | ✅ `09_…` + `42_…` | — | — | EXTRACTED |
| concurrency | ✅ гонка подключения одного чата двумя проектами | — | — | EXTRACTED |
| idempotency / lost response / restart replay | ✅ повтор update, повтор воркера, аренда | — | — | EXTRACTED |
| настоящая граница HTTP | — | ✅ 12 тестов `Request`→`Response` | — | EXTRACTED |
| authenticated browser (AP5) | — | — | ⛔ | BLOCKED |
| цикл 7 | 🔴 информационно, как и должен | 🔴 | 🔴 | EXTRACTED |

---

## 6. Что доказано моками и контрактами

- нормализация update, включая правку как новую ревизию источника; **EXTRACTED**
- поведение вебхука на настоящей границе HTTP: выключенный мост, поддельный и
  отсутствующий секрет, не-JSON, превышение размера, неподдерживаемый update,
  временный сбой записи, пустое тело ответа; **EXTRACTED**
- очередь: проектор до отправки, соблюдение `retry_after`, потолок попыток,
  отмена при отозванной привязке, пустая очередь как no-op; **EXTRACTED**
- извлечение: `ignored` как полноправный ответ, маскирование контактов и ссылок,
  отсутствие инструментов у модели, отсутствие кандидата при сбое модели;
  **EXTRACTED**
- невозможность выполнить команду из контура извлечения — проверено
  прокси-объектом, считающим каждый вызов порта; **EXTRACTED**
- санитизация логов: значения, не прошедшие фильтр, отбрасываются целиком.
  **EXTRACTED**

---

## 7. Что доказано настоящим Telegram

**Ничего. BLOCKED.** Секретов тестового бота и приватной тестовой группы в этом
окружении нет: `TELEGRAM_TEST_BOT_TOKEN`, `TELEGRAM_TEST_BOT_USERNAME`,
`TELEGRAM_TEST_WEBHOOK_SECRET` не заданы. Ни одного запроса к
`api.telegram.org` не выполнялось.

Итоговый статус — `TG4_BLOCKED_EXTERNAL_CREDENTIALS`. Формулировка «staging
proven» не используется. **EXTRACTED**

---

## 8. Внешние блокеры

1. **`TG4_BLOCKED_EXTERNAL_CREDENTIALS`** — нет тестового бота, приватной
   тестовой группы и публичного HTTPS-адреса стенда для вебхука. Закрывается
   набором из §0 runbook. **BLOCKED**
2. **Браузерная половина TG3** — AP5 требует поднятого стека Supabase; образы
   контейнеров в этом окружении недоступны (registry заблокирован прокси). По
   той же причине локально не проверялся PostgreSQL 17 — но его закрыл CI.
   Итог: `TG3` объявлен доказанным **только** в контрактной и маршрутной
   половине. **BLOCKED**
3. **Карантинный конвейер вложений** — общий путь для этого источника не
   доказан, поэтому байты не скачиваются, а вложения живут со статусом
   `materialization_blocked`. Отдельного телеграм-хранилища не заведено
   намеренно: оно выглядело бы работающим. **INTERPRETED**
4. **152-ФЗ / data plane / consent / retention** — гейт открыт, и A7 §9 его не
   закрывает. **EXTRACTED**

---

## 9. Production

`REMHAOS_TELEGRAM_BRIDGE_ENABLED` отсутствует в окружении по умолчанию, и
отсутствие означает «выключено». Человеческие RPC шлюза отозваны у
`authenticated` постоянной миграцией и возвращаются только скриптом одноразовой
среды; системные не возвращаются человеку никогда. Ни одна миграция в
репозитории прав `authenticated` на шлюз не выдаёт.

Production **не включён** и по A7 §9 не может быть включён до отдельного OWNER
GO после legal / data-plane / consent / retention гейта. Deployment не
выполнялся. **EXTRACTED**

---

## 10. M4 Increment 2

Не открыт. Пять команд инкремента 2 закрыты по-прежнему двумя независимыми
границами — отдельной проверкой в `command-service.ts`, не зависящей от флага
модуля, и отозванными правами в базе. Ни одна строка этой работы их не
касается; `PROJECTCEO_M4_INCREMENT_2_LEAKED` продолжает охранять скрипт среды.
**EXTRACTED**
