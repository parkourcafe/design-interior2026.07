# WP-12 — Reconciliation-пакет документов: классификация 23 миграций, коллизии, rollback, post-verify, мониторинг

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 1.3 (docs), 1.7 | W3–W4 | 3 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Собрать документальную часть reconciliation PR по пути historical incremental (`AP1_MIGRATION_PATH_DECISION_2026-08-01.md`).

## Входы (что должно быть выполнено до старта)
- WP-11 + снапшот от владельца

## Allowlist файлов (правишь только это)
- `docs/product-intelligence/wave-3/production-adoption/reconciliation-2026-09/**` (новый каталог)
- `ADOPTION_CHECKLIST.md` §3–§12 — только evidence-строки, не подписи
- `docs/audits/wp/WP-12_EVIDENCE.md`

## Запрещено
- все хотспоты
- подписи §13 чек-листа

## Шаги
1. `FINGERPRINT_COMPARISON.md`: все 23 применённые миграции production — legacy `0007–0009` ↔ `agent-runs/db-wave/legacy-migrations/*.sql.txt`; июльский «M1 governed runtime» (`public.workflow_*`, `project_facts`, `approval_requests`, `ai_calls`, `audit_events`, `proposal_revisions`, `project_overrides`, `studio_standards`, RPC, hook 02.08) → класс LEGACY_ADOPTED; 10 миграций `market_harvest` → LEGACY_ADOPTED-no-op.
2. `COLLISION_CHECK.md`: репо-миграции, пишущие в `public`, против production — `20260801150000` (hook `create` vs `create or replace`), `20260824170000` (unique `proposals(project_id, version)` при 3 КП; `intake_expires_at`), `20260829074543`, `20260808050000`, `20260716072000` — план проверки каждой на клоне.
3. `ROLLBACK_EVIDENCE.md` (PITR + Vercel rollback по `ROLLBACK_RUNBOOK.md` §3–4), `POST_VERIFY.md`, `REPLAY_LOG.md` (шаблон), `MONITORING_AND_KILL_SWITCH.md` (Vercel rollback + `close_module_production`/`close_v1_impact_production`, алерты Supabase, `query_logs`).

## Гейты
- docs-only

## Критерий приёмки
- каждый объект production классифицирован
- каждая коллизия имеет план проверки на клоне

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-12-reconciliation-docs` от свежего `origin/main`; один PR `WP-12: Reconciliation-пакет документов: классификация 23 миграций, коллизии, rollback, post-verify, мониторинг`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-12_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-12: <статус> | PR #N | HEAD <sha> | blockers: …`.
