# WP-02 — Хардкод стенда → `vars`, де-пин счётчика ledger в `ci.yml`, runbook «стенд на прогон»

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 0.6 | W1 | 1 РС | S-CI | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Убрать идентификатор одноразового стенда из кода и снять жёсткий счётчик «90» миграций в hosted-джобе, чтобы миграционные пакеты не трогали `ci.yml`.

## Входы (что должно быть выполнено до старта)
- #123 слит (иначе конфликт в `ci.yml`)
- владелец создаёт переменную `DISPOSABLE_STAGING_REF` в GitHub Environment `disposable-staging` (может быть пустой до нового стенда)

## Allowlist файлов (правишь только это)
- `.github/workflows/ci.yml` (только job `hosted-staging` и связанные строки)
- `tests/ap1/environment/ci-secret-log.contract.test.ts`
- `AP1_RUNBOOK.md` §7 (порядок «стенд на прогон → удалить после приёмки»)
- `docs/audits/wp/WP-02_EVIDENCE.md`

## Запрещено
- H1–H11, H13–H18
- литерал production-ref в `ci.yml:496` (отказ от production — контракт, оставить)

## Шаги
1. `ci.yml:450`: `EXPECTED_STAGING_REF: ukkzasfsmannjprfkaxp` → `${{ vars.DISPOSABLE_STAGING_REF }}`; убедиться, что при пустом значении hosted-джоба fail-closed (`ci.yml:511`, проверка `endsWith('.')`/пустоты).
2. `ci.yml:726,752`: ожидание `90` заменить на счётчик из ledger (`grep -c . tests/ap1/environment/migration-ledger.sha256`).
3. `ci-secret-log.contract.test.ts:93`: ожидание литерала стенда → ожидание формы `vars.DISPOSABLE_STAGING_REF` и запрет любого литерала стенда; строку `:95` (production-контракт) не трогать.
4. `AP1_RUNBOOK.md` §7: стенд создаётся на прогон и удаляется после приёмки; MCP умеет только паузу.

## Гейты
- полный CI
- `rg ukkzasfsmannjprfkaxp --glob '!docs/audits/**' --glob '!docs/execution/**'` → 0

## Критерий приёмки
- hosted-джоба читает ref из vars и падает закрыто при пустом значении
- де-пин счётчика: миграция больше не требует правки `ci.yml`
- тест контракта зелёный

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-02-staging-ref-vars-ledger-depin` от свежего `origin/main`; один PR `WP-02: Хардкод стенда → `vars`, де-пин счётчика ledger в `ci.yml`, runbook «стенд на прогон»`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-02_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-02: <статус> | PR #N | HEAD <sha> | blockers: …`.
