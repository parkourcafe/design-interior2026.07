# WP-34 — M4 №5 (TS `prerequisite_missing`) + №4 (тесты вехи под флагом V2/V3)

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 3.3 | W2 | 2 РС | S-LRP | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Читатель `live-read-port.ts` отражает `approvalSupersededEntities` как `prerequisite_missing` для `publish_baseline`; вернуть три утверждения приёмки вехи под `REMHAOS_M4_V2_V3_ENABLED`.

## Входы (что должно быть выполнено до старта)
- —

## Allowlist файлов (правишь только это)
- H14: `lib/project-intelligence/delivery/projectceo/live-read-port.ts`, `tests/projectceo-integration/live-read-sanitization.test.ts`
- `docs/audits/wp/WP-34_EVIDENCE.md`

## Запрещено
- H3–H7, H11, H13

## Шаги
1. Чтение v11 (`20260828020000`): непустой `approvalSupersededEntities` → `publish_baseline: prerequisite_missing`.
2. Три утверждения приёмки вехи в `live-read-sanitization.test.ts` под флагом (фикстуры уже есть).

## Гейты
- полный CI (scope m4_v1 → AP5)

## Критерий приёмки
- тесты красные без правки и зелёные с ней (доказать в evidence)

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-34-m4-backlog-5-and-4` от свежего `origin/main`; один PR `WP-34: M4 №5 (TS `prerequisite_missing`) + №4 (тесты вехи под флагом V2/V3)`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-34_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-34: <статус> | PR #N | HEAD <sha> | blockers: …`.
