# WP-16 — CI-джоба `adoption-rehearsal` + прогон на клоне production

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 1.4 | W4 (PR) → W5 (прогон) | 2–3 РС + владелец | S-CI (после WP-02) | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Отдельная `workflow_dispatch`-джоба, которая на клоне production (из backup) прогоняет `adopt-production.zsh`, POST_VERIFY, provision AP1 и AP5, и выдаёт sanitized receipt.

## Входы (что должно быть выполнено до старта)
- WP-02, WP-13, WP-14 слиты
- Р12; владелец создаёт клон из backup (`pg_restore`), заводит секреты в GitHub Environment `adoption-rehearsal`, запускает dispatch, удаляет клон после receipt (живые ПДн)

## Allowlist файлов (правишь только это)
- H12: `.github/workflows/ci.yml` (новая job), `tests/ap1/environment/ci-secret-log.contract.test.ts` (пины новой job)
- `reconciliation-2026-09/{REPLAY_LOG,POST_VERIFY,ROLLBACK_EVIDENCE}.md` (заполнение по прогону)
- `docs/audits/wp/WP-16_EVIDENCE.md`

## Запрещено
- остальные хотспоты
- `hosted-staging` (ledger «ровно 90», bootstrap-строки — не переиспользовать)

## Шаги
1. Job `adoption-rehearsal`: `environment: adoption-rehearsal`, input с `AP1_APPROVAL_RECORD`, `EXPECTED_REHEARSAL_REF` из vars, запрет production ref (образец `HOSTED_STAGING_PRODUCTION_REF_REJECTED`), шаги: `adopt-production.zsh` → `POST_VERIFY` (`verify-db.sql`, `verify-runtime.mjs`, `verify-m3/m4-data-api-closed.mjs`, advisors errors=0, `module_production_state()` закрыто, `v1_impact_production_state()` `open_now=false`) → `npm run provision:ap1` → AP5 без skip → sanitized receipt (ledger = 23+1+N, advisors 0, `passed`, `skipped=0`).
2. Логи проходят `scan-log-hygiene.mjs`; никаких имён файлов клиентов и токенов.

## Гейты
- полный CI на PR
- прогон — dispatch владельцем; итерации до зелёного

## Критерий приёмки
- receipt: AP5 27/27, skipped 0, advisors 0, ledger 116 (при N=92)
- клон удалён; RTO/RPO записаны в `ROLLBACK_EVIDENCE.md`

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-16-adoption-rehearsal-job` от свежего `origin/main`; один PR `WP-16: CI-джоба `adoption-rehearsal` + прогон на клоне production`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-16_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-16: <статус> | PR #N | HEAD <sha> | blockers: …`.
