# WP-13 — `adopt-production.zsh` + `baseline-adoption.sql` + контракт-тест

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 1.3 | W2–W3 | 3–4 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Операторский скрипт исторического принятия production: запись baseline как applied без DDL, затем additive-миграции по ledger с проверкой хешей; fail-closed без записи одобрения.

## Входы (что должно быть выполнено до старта)
- WP-11 (counts для assert)

## Allowlist файлов (правишь только это)
- новый `tests/ap1/environment/adopt-production.zsh`
- новый `tests/ap1/environment/adopt-production.contract.test.ts`
- `reconciliation-2026-09/baseline-adoption.sql`
- `docs/audits/wp/WP-13_EVIDENCE.md`

## Запрещено
- `bootstrap-disposable.zsh` (контракт `reject_production` :225 — не трогать, H18)
- H1, H12
- production

## Шаги
1. Скрипт: сначала проверяет, что запись baseline `20260716071024` уже есть в `supabase_migrations.schema_migrations` (её создаёт `baseline-adoption.sql` на Approval A; при отсутствии — отказ), DDL baseline не исполняется никогда (он падает при существующих legacy-таблицах, `20260716071024:31-57`) → `supabase/roles.sql` → additive-миграции со второй строки `migration-ledger.sha256` строго по порядку, с проверкой sha до применения → `verify-db.sql` → `apply-hosted-role-precondition.sql`; требует `AP1_APPROVAL_RECORD=<id Approval B>` и файл allowlist ref (`prod` или ref клона); stop-on-first-failure.
2. `baseline-adoption.sql` (исполняется отдельно, на Approval A, до скрипта): одна транзакция — assert counts relations/routines/policies по снапшоту (`raise exception` при несовпадении) → insert строки `20260716071024` в `supabase_migrations.schema_migrations` без DDL; 23 существующие строки не трогать.
3. Контракт-тест: отказ без approval record; отказ на не-allowlisted ref; отказ на production без записи; dry-run на локальном контейнере (DB4-образ + legacy `.sql.txt`) доходит до `verify-db`.

## Гейты
- gates (zsh ставится в job `gates`)

## Критерий приёмки
- контракт-тест зелёный
- dry-run в evidence с выводом

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-13-adopt-production-script` от свежего `origin/main`; один PR `WP-13: `adopt-production.zsh` + `baseline-adoption.sql` + контракт-тест`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-13_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-13: <статус> | PR #N | HEAD <sha> | blockers: …`.
