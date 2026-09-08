# WP-39 — HTTP-маршрут enroll (Р20 (а)) request-bound, CSRF, тесты

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 3.5 (предпосылка входа вертикали V1) | W6–W7 | 2–3 РС | S-CS; S-LRP/S-AP5 при варианте-команды | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Дать владельцу-роли способ зачислить организацию/проект в ProjectCEO по HTTP (`enroll_organization_project`, `20260717090000`) без service role и без ручного SQL.

## Входы (что должно быть выполнено до старта)
- Р20 = (а)

## Allowlist файлов (правишь только это)
- новый `app/api/projectceo/enroll/route.ts` (или команда в контракте → реестр → `command-service.ts`, тогда H3/H4/H5/H8)
- `lib/project-intelligence/delivery/projectceo/csrf.ts` (использование)
- тесты route/contract
- `docs/audits/wp/WP-39_EVIDENCE.md`

## Запрещено
- H1, H2, H6, H7, H11, H13, H14
- `tests/ap5/global-setup.ts`

## Шаги
1. Request-bound вызов RPC; same-origin CSRF; чужой/anon → 401/403; тесты.

## Гейты
- полный CI
- blind review (новая дверь)

## Критерий приёмки
- owner-роль зачисляет проект по HTTP; чужой/anon отклонены

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-39-enroll-http-route` от свежего `origin/main`; один PR `WP-39: HTTP-маршрут enroll (Р20 (а)) request-bound, CSRF, тесты`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-39_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-39: <статус> | PR #N | HEAD <sha> | blockers: …`.
