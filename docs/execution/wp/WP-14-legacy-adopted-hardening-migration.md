# WP-14 — Миграция `legacy_adopted_hardening` + DB4 №57

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 1.3, 0.10 | W3 | 2–3 РС | S-MIG #2 (после WP-21) | да — timestamp и номер DB4 выдаёт оркестратор |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Аддитивная миграция, no-op на чистой базе, закрывающая advisor-находки production после adoption: deny-policy `rate_limits`, revoke от `anon` 11 SECURITY DEFINER RPC, force RLS на `project_facts`.

## Входы (что должно быть выполнено до старта)
- WP-21 слит (ledger 91)
- Р7 — подтверждение объёма

## Allowlist файлов (правишь только это)
- новая `supabase/migrations/<timestamp>_legacy_adopted_hardening.sql`
- H1: ledger, `preExisting` в `tests/layout-studio/integration/integration.test.ts`
- H2: `tests/db4/run.zsh` (+57)
- новый `tests/db4/57_legacy_adopted_hardening.sql`
- `docs/audits/wp/WP-14_EVIDENCE.md`

## Запрещено
- H3–H18

## Шаги
1. Функция `projectceo_platform.apply_legacy_adopted_hardening()` с guard-ами `to_regclass`/`to_regprocedure`: policy `using (false) with check (false)` на `public.rate_limits` для `anon, authenticated` (приложение ходит service_role — `lib/rate-limit.ts`); `revoke execute ... from anon` на 11 RPC из аудита §1 п.8; `force row level security` на `public.project_facts`; от `authenticated` — не отзывать (аудит вызовов — отдельно).
2. DB4 57: создать заглушки legacy-объектов → вызвать функцию → проверить policy/revoke/force; на чистой базе — no-op.
3. Ledger регенерировать командой протокола; `preExisting` дополнить; `run.zsh` +57.

## Гейты
- полный CI (DB4/DB5 ×2)
- blind review (security)

## Критерий приёмки
- ledger 92; clean bootstrap = no-op; DB4 57 зелёный на PG16 и PG17

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-14-legacy-adopted-hardening-migration` от свежего `origin/main`; один PR `WP-14: Миграция `legacy_adopted_hardening` + DB4 №57`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-14_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-14: <статус> | PR #N | HEAD <sha> | blockers: …`.
