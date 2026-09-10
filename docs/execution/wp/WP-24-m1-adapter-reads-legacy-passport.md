# WP-24 — Адаптер читает legacy-паспорт и договор request-bound под RLS

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 2.4 | W4–W5 | 3–5 РС | S-UI + S-MIG #6 | `20260910090000` additive |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
«Contracted Project Passport» в панели Passport = последняя `project_passport_revisions` + статус `contract_documents` (`uploaded→received→signed`), читаемые через `lib/supabase/server.ts` под RLS `20260829074543`, а не admin-клиентом.

## Входы (что должно быть выполнено до старта)
- WP-21, WP-23 (общая панель)

## Allowlist файлов (правишь только это)
- `supabase/migrations/20260910090000_projectceo_m1_legacy_read_contract.sql`
- `lib/project-intelligence/adapters/postgres/m1-legacy-read.ts`
- `lib/project-intelligence/adapters/postgres/index.ts`
- `lib/project-intelligence/delivery/projectceo/live-read-port.ts`
- `components/projectceo/contracts.ts`, `m1-passport-panel.tsx`, `m1-project-panel.tsx`, `mock.ts`
- `lib/i18n/ru.ts`
- `tests/ap1/environment/migration-ledger.sha256`
- `tests/layout-studio/integration/integration.test.ts`
- `tests/db4/53_m1_passport_versions_contract.sql`, `56_m1_rls_security.sql`, `59_m1_legacy_read_rpc.sql`
- `tests/db5/run.zsh` (DB5 invokes M1 security/read checks)
- `tests/projectceo-integration/m1-legacy-read-adapter.test.ts`
- `docs/audits/wp/WP-24_EVIDENCE.md`

## Запрещено
- H1–H7, H11, H14

## Шаги
1. Проекция: последняя ревизия паспорта + статус договора; чтение request-bound через canonical `_authorize_project_human(project_id, 'view_project')`; роли `owner_lead`/`architect`; чужой/anon/builder/client — deny (DB4-59, DB5).

## Гейты
- полный CI

## Критерий приёмки
- owner/architect видят паспорт и договор; изоляция и ACL доказаны DB4-59/DB5, без storage metadata

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-24-m1-adapter-reads-legacy-passport` от свежего `origin/main`; один PR `WP-24: Адаптер читает legacy-паспорт и договор request-bound под RLS`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-24_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-24: <статус> | PR #N | HEAD <sha> | blockers: …`.
