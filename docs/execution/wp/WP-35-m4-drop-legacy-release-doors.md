# WP-35 — M4 №2: замена `_module_signatures('m4_increment_1')`, DROP legacy-дверей, матрицы и скрипты

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 3.3 | W6 | 2–3 РС | S-MIG #4, S-AP5 (после WP-33) | да — слот у оркестратора |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Физически удалить выведенные legacy-двери выдачи/подтверждения и убрать их из всех матриц и скриптов, не сломав `open_module_production`.

## Входы (что должно быть выполнено до старта)
- WP-33 слит

## Allowlist файлов (правишь только это)
- H7 (`m4-surface.ts`, `m4-surface-matrix.test.ts:124,150`, `tests/db4/07`, `08`, `20:962-973`, `enable-m4-increment-1.sql:36-62`)
- H1, H2
- `docs/audits/wp/WP-35_EVIDENCE.md`

## Запрещено
- H3–H6, H8, H11 (кроме звеньев 9–10 по согласованию), H13, H14

## Шаги
1. Миграция: сначала `create or replace _module_signatures` для `'m4_increment_1'` без legacy (`20260825010000:126-133`), затем `drop function projectceo_product_api.distribute_release(...)`, `acknowledge_release(...)`.
2. Обновить матрицу, тесты и скрипты стенда; DB4 49 (`open_module_production('m4_increment_1')`) должен работать.

## Гейты
- полный CI (DB4/DB5 ×2, AP5 9–10)
- blind review

## Критерий приёмки
- сигнатур нет в матрице, скриптах и базе; DB4 49 зелёный

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-35-m4-drop-legacy-release-doors` от свежего `origin/main`; один PR `WP-35: M4 №2: замена `_module_signatures('m4_increment_1')`, DROP legacy-дверей, матрицы и скрипты`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-35_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-35: <статус> | PR #N | HEAD <sha> | blockers: …`.
