# WP-05 — Скрипт экспорта `market_harvest` с fail-closed на production + runbook

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 0.9а (eng) | W2 (филлер) | 1 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Дать владельцу воспроизводимый инструмент экспорта схемы `market_harvest` из production в отдельный проект с проверкой восстановления; сам экспорт выполняет владелец.

## Входы (что должно быть выполнено до старта)
- Р6 — решение об экспорте и последующем удалении схемы
- строка подключения — только у владельца

## Allowlist файлов (правишь только это)
- новый `scripts/ops/export-market-harvest.zsh`
- новый `docs/product-intelligence/wave-3/production-adoption/MARKET_HARVEST_EXPORT_RUNBOOK.md`
- новый контракт-тест `tests/release/export-market-harvest.contract.test.ts`
- `docs/audits/wp/WP-05_EVIDENCE.md`

## Запрещено
- все хотспоты
- любое обращение к production из сессии

## Шаги
1. Скрипт: `pg_dump --schema=market_harvest --schema-only` и `--data-only` в два файла + `sha256sum`; восстановление в целевой проект; сверка `count(*)` по 12 таблицам (ожидание из аудита: companies 3 633, contacts 6 358, credit_ledger 23 801 и т. д.).
2. Fail-closed: при production-ref (константа `reject_production` в `tests/ap1/environment/bootstrap-disposable.zsh`; в промпт и evidence не копировать) без переменной `EXPORT_CONFIRM=<дата>` — отказ (образец `tests/ap1/environment/bootstrap-disposable.contract.test.ts:52`).
3. Runbook: порядок «экспорт → проверка восстановления → остановка коллектора → ротация service_role → drop схемы после снапшота Трека 1.2»; секреты не печатать.

## Гейты
- полный CI (`.zsh` считается кодом)

## Критерий приёмки
- контракт-тест доказывает отказ без подтверждения
- runbook пошаговый; владелец после экспорта фиксирует совпадение счётчиков в evidence

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-05-market-harvest-export-tool` от свежего `origin/main`; один PR `WP-05: Скрипт экспорта `market_harvest` с fail-closed на production + runbook`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-05_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-05: <статус> | PR #N | HEAD <sha> | blockers: …`.
