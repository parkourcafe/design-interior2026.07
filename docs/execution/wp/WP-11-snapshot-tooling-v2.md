# WP-11 — Snapshot-tooling v2: все схемы, детерминированный fingerprint, генератор дрейфа

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 1.2 (eng) | W2 | 2 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Подготовить инструменты свежего read-only снапшота production, чтобы владелец выполнил SQL в дашборде, а fingerprint и реестр дрейфа считались детерминированно.

## Входы (что должно быть выполнено до старта)
- Р12 — владелец единственный оператор; запускает SQL и передаёт JSON (только каталоги и счётчики, без данных)

## Allowlist файлов (правишь только это)
- новые файлы в `docs/product-intelligence/agent-runs/db-wave/` (`PRODUCTION_READONLY_AUDIT_v2.sql`; v1 не переписывать)
- новый `scripts/ops/fingerprint-from-snapshot.mjs` + юнит-тест на фикстуре
- шаблоны `docs/product-intelligence/wave-3/production-adoption/PRODUCTION_SNAPSHOT_2026-09-xx.md`, `PRODUCTION_READ_ONLY_FINGERPRINT_2026-09-xx.md`
- `docs/audits/wp/WP-11_EVIDENCE.md`

## Запрещено
- все хотспоты
- production из сессии

## Шаги
1. SQL v2: scope — все не-системные схемы (включая `market_harvest` до дропа, `private`, `storage`); только каталоги, счётчики, определения функций/политик/грантов; без строк данных.
2. Fingerprint: формат `PRODUCTION_READ_ONLY_FINGERPRINT_2026-07-19.md` (count + md5 по категориям, combined sha256); один и тот же JSON → тот же sha (тест).
3. Генератор дрейфа: сравнение с fingerprint 19.07 → строки `docs/audits/REMHAOS_CONFLICT_REGISTER_2026-09-xx.csv` (`id,conflict,status,evidence,resolution`).

## Гейты
- gates + юнит-тест

## Критерий приёмки
- детерминизм доказан тестом
- шаблоны готовы к заполнению владельцем

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-11-snapshot-tooling-v2` от свежего `origin/main`; один PR `WP-11: Snapshot-tooling v2: все схемы, детерминированный fingerprint, генератор дрейфа`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-11_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-11: <статус> | PR #N | HEAD <sha> | blockers: …`.
