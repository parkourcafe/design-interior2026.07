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

## 2026-09-13 — подготовка нового clone-only executor

Статус: IN_PROGRESS. Текущий разрешённый target — только `reitdpzxtnmdkznesffu`; исторический production-скрипт выше не является разрешением на live-действие. Baseline repair уже выполнен отдельно и не повторяется. Новый executor не использует старый 93-entry набор или текущие дополнительные миграции.

Расширение allowlist оркестратором для разрешённого repository-only пакета:

- `scripts/ops/clone-rehearsal-sql.mjs`
- `scripts/ops/clone-rehearsal-journal.mjs`
- `tests/ap1/environment/clone-rehearsal-sql.test.ts`
- `tests/ap1/environment/clone-rehearsal-journal.test.ts`
- эта карточка

Компилятор проверяет frozen commit `d5f21817f34f336e10c562a3515d5004711d25e5`, canonical manifest SHA `bf772ca1d8253160310ea442068e49295dd172503f837fbf689a9f9fd6d10230`, ledger и все 98 исходных файлов, включая исключаемый baseline, плюс три auxiliary-файла. Результат — immutable inventory 97 миграций; `executionReady=false`. Только две точные hash-bound auxiliary-директивы `\set ON_ERROR_STOP on` переносятся в обязательство транспорта; произвольные psql-команды запрещены.

Локальный supplemental journal создаётся exclusively с правами0600 в каталоге0700, выполняет fsync файла/каталога и хранит только фиксированные идентификаторы/хеши/классификации. Последовательные STAGED-записи не означают commit. Повторное создание и resume запрещены, torn/corrupt/uncertain запись не даёт продолжить. Это не согласие владельца, не удалённый CAS fence и не защита от доверенного пользователя, намеренно переписавшего локальное хранилище.

Проверки этой вехи: independent source review и closure PASS; исправлена утечка filesystem path в ошибке. Lint/typecheck/1704 tests/Webpack build PASS;17 существующих lint warnings. Тесты включают реальный SIGKILL дочернего процесса с чтением уже fsynced журнала. Существующий lockfile совпал с проверенным dependency tree; использован его локальный symlink. Никакие SQL, GitHub fence или live DB вызовы эти компоненты не выполняли.

До выполнения rehearsal остаются: совместимость реальной общей транзакции (GUC, deferred constraints, dynamic SQL и порядок auxiliary), транспорт с конкретным verified TLS/endpoint, remote absence-CAS fence, exact fresh clone fingerprint/history и отсутствие предыдущей ошибки. Полный WP-13, disposable full-plan proof, hosted и production не закрыты этой вехой. Отдельный code review Claude на итоговом commit остаётся required evidence.
