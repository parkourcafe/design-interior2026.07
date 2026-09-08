# WP-24 — Адаптер читает legacy-паспорт и договор request-bound под RLS

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 2.4 | W4–W5 | 3–5 РС | S-UI (после WP-23) | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
«Contracted Project Passport» в панели Passport = последняя `project_passport_revisions` + статус `contract_documents` (`uploaded→received→signed`), читаемые через `lib/supabase/server.ts` под RLS `20260829074543`, а не admin-клиентом.

## Входы (что должно быть выполнено до старта)
- WP-21, WP-23 (общая панель)

## Allowlist файлов (правишь только это)
- M1-адаптер (из #124)
- `components/projectceo/m1-passport-panel.tsx`
- `tests/db4/53_m1_passport_versions_contract.sql`, `56_m1_rls_security.sql` (расширение)
- UI-тест
- `docs/audits/wp/WP-24_EVIDENCE.md`

## Запрещено
- H1–H7, H11, H14

## Шаги
1. Проекция: последняя ревизия паспорта + статус договора; чтение request-bound; чужой/anon — 0 строк (DB4 56).

## Гейты
- полный CI

## Критерий приёмки
- дизайнер видит паспорт и договор; изоляция доказана DB4 56

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-24-m1-adapter-reads-legacy-passport` от свежего `origin/main`; один PR `WP-24: Адаптер читает legacy-паспорт и договор request-bound под RLS`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-24_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-24: <статус> | PR #N | HEAD <sha> | blockers: …`.
