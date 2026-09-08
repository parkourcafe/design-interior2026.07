# Доска пакетов работ — RemHaOS

Правит только оркестратор. Статусы — словарь ТЗ §2. Волны — ТЗ §9. Серии — ТЗ §8.
Обновлено: 08.09.2026 (создание доски; механизм не запущен — ждёт GO по ТЗ §14).

| WP | Название | Волна | Серия | Статус | Ветка | PR | Сессия | Блокер | Обновлено |
|---|---|---|---|---|---|---|---|---|---|
| WP-01 | PR-триаж, health commit, список веток | W1 | — | NOT_STARTED | — | — | — | Р1, Р10 | 08.09 |
| WP-02 | Хардкод стенда → vars, де-пин ledger в ci.yml | W1 | S-CI | NOT_STARTED | — | — | — | var в env | 08.09 |
| WP-03 | ПДн из env-дефолтов + полнота .env.example | W1 | — | NOT_STARTED | — | — | — | Р9 | 08.09 |
| WP-05 | Экспорт market_harvest (скрипт + runbook) | W2 | — | NOT_STARTED | — | — | — | Р6 | 08.09 |
| WP-11 | Snapshot-tooling v2 | W2 | — | NOT_STARTED | — | — | — | Р12 | 08.09 |
| WP-12 | Reconciliation-пакет документов | W3–W4 | — | NOT_STARTED | — | — | — | снапшот | 08.09 |
| WP-13 | adopt-production.zsh + baseline-adoption.sql | W2–W3 | — | NOT_STARTED | — | — | — | — | 08.09 |
| WP-14 | Миграция legacy_adopted_hardening + DB4 №57 | W3 | S-MIG #2 | NOT_STARTED | — | — | — | Р7, WP-21 | 08.09 |
| WP-16 | CI-джоба adoption-rehearsal + прогон | W4→W5 | S-CI | NOT_STARTED | — | — | — | WP-02, WP-13, WP-14, клон | 08.09 |
| WP-18 | Пакет Human GO | W6 | — | NOT_STARTED | — | — | — | WP-12, WP-16 | 08.09 |
| WP-21 | Посадка PR #124 | W1 | S-MIG #1 | NOT_STARTED | codex/m1-project-workspace-contracts | #124 | — | Р1, #123, Р11 | 08.09 |
| WP-22 | Предложение по модели моста M1 | W1 | — | NOT_STARTED | — | — | — | — | 08.09 |
| WP-23 | sendProposal требует platform approval | W3–W4 | S-CS, S-UI, S-RU | NOT_STARTED | — | — | — | WP-21, Р11 | 08.09 |
| WP-24 | Адаптер читает legacy-паспорт и договор | W4–W5 | S-UI | NOT_STARTED | — | — | — | WP-21 | 08.09 |
| WP-25 | BUG-05 (а): token-scoped helper + allowlist-тест | W2–W3 | — | NOT_STARTED | — | — | — | Р26 | 08.09 |
| WP-26 | BUG-05 (б): страницы дизайнера → request-bound | W5–W6 | S-MIG #5? | NOT_STARTED | — | — | — | WP-25 | 08.09 |
| WP-27 | Static-boundary тест TTL ≤900 | W1 | — | NOT_STARTED | — | — | — | — | 08.09 |
| WP-28 | События ошибок, activation-отчёт, метрики AP7 | W3/W8 | S-RU | NOT_STARTED | — | — | — | Р22 | 08.09 |
| WP-31 | AP6-инструменты (загрузчик, cookie-jar) | W3–W4 | S-PE | NOT_STARTED | — | — | — | — | 08.09 |
| WP-32 | Прогон AP6 + receipt + отчёт | W5–W6 | S-PE | NOT_STARTED | — | — | — | WP-31, партнёр | 08.09 |
| WP-33 | M3 №8: флип на publish_baseline_atomic | W5 | S-MIG #3, S-CS, S-AP5 | NOT_STARTED | — | — | — | WP-14 | 08.09 |
| WP-34 | M4 №5 + №4 | W2 | S-LRP | NOT_STARTED | — | — | — | — | 08.09 |
| WP-35 | M4 №2: DROP legacy-дверей | W6 | S-MIG #4, S-AP5 | NOT_STARTED | — | — | — | WP-33 | 08.09 |
| WP-36 | M4 №6 + BUG-04 | W2 | S-CS | NOT_STARTED | — | — | — | WP-21 | 08.09 |
| WP-38 | Мёртвый контур impact | W1 | — | NOT_STARTED | — | — | — | — | 08.09 |
| WP-39 | HTTP-маршрут enroll | W6–W7 | S-CS, S-LRP?, S-AP5? | NOT_STARTED | — | — | — | Р20 | 08.09 |
| WP-41 | Юрблок | W5–W7 | S-RU | NOT_STARTED | — | — | — | текст юриста, Р23 | 08.09 |
| WP-K1 | HANDOFF / LAUNCH_CHECKLIST / реестр / email README | W1 | — | NOT_STARTED | — | — | — | Р2, Р13 | 08.09 |
| WP-K2 | Поправки К-1…К-5, К-12; runbook M4 | W2 | — | NOT_STARTED | — | — | — | — | 08.09 |
| WP-C | Канонические транскрипции (только оркестратор) | по событию | S-CANON | NOT_STARTED | — | — | — | Р15, Р16 | 08.09 |

## Журнал (одна строка в день, пишет оркестратор)

| Дата | Слито | В работе | Блокеры владельца | Расход сессий, $ | Примечание |
|---|---|---|---|---|---|
| 08.09 | 0 | 0 | Р1, Р2, Р3, Р10, Р11, Р29, Р30 | 0 | доска создана; PR #122 закрыт, #123 ждёт CI |
