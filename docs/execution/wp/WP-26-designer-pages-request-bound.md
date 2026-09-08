# WP-26 — BUG-05 (б): страницы дизайнера → request-bound + RLS

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 2.5б | W5–W6 | 4–6 РС | S-MIG #5 — только если нужны новые политики | возможно (запросить слот у оркестратора) |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Аутентифицированные страницы и маршруты дизайнера ходят через `lib/supabase/server.ts` под RLS, а не через admin-клиент.

## Входы (что должно быть выполнено до старта)
- WP-25 слит

## Allowlist файлов (правишь только это)
- `app/dashboard/projects/[id]/page.tsx`
- `app/join/[token]/{page,actions}.tsx`
- `app/api/pilot/route.ts`
- `app/api/dashboard/contracts/*`
- `lib/designer.ts`, `lib/studio.ts`, `lib/intake.ts`
- allowlist-тест WP-25 (сужение)
- при миграции: H1 + `tests/db4/56_*`
- `docs/audits/wp/WP-26_EVIDENCE.md`

## Запрещено
- H3–H7, H11, H14

## Шаги
1. Перевести перечисленные места на request-bound клиент; недостающие политики legacy-таблиц — additive миграция (только если реально нужны; слот у оркестратора).
2. Сузить allowlist WP-25 до класса (а).

## Гейты
- полный CI
- blind review (security)

## Критерий приёмки
- `createAdminClient` только в классе (а); DB4 56 покрывает новые политики

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-26-designer-pages-request-bound` от свежего `origin/main`; один PR `WP-26: BUG-05 (б): страницы дизайнера → request-bound + RLS`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-26_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-26: <статус> | PR #N | HEAD <sha> | blockers: …`.
