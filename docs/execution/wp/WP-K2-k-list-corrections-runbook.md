# WP-K2 — Поправки К-1…К-5, К-12 в неканонические документы; runbook M4 под Р19/Р20

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 0.13, 3.5 docs | W2 (филлер) | 1 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Закрыть противоречия аудита в неканонических документах append-разделами и обновить production-runbook M4.

## Входы (что должно быть выполнено до старта)
- —

## Allowlist файлов (правишь только это)
- append «Поправка 2026-09» в `docs/audits/REMHAOS_FINAL_AUDIT_2026-08-23.md` (К-1), `docs/audits/REMHAOS_AUTONOMOUS_STAGING_ACCEPTANCE_2026-08-29.md` (К-3), `REMHAOS_FEATURE_READINESS_MATRIX_2026-08-02.csv` (К-4)
- `M4_V1_PRODUCTION_RUNBOOK.md` (К-2 → DEC-038, К-5 «две двери», шаги `open_module_production('m3'|'m4_increment_1')` по Р19, smoke-проект, предпосылки Р20)
- баннер «нумерация эпохи M1» в `MODULE_3_REPORT.md`, `MODULE_2_CONCEPT_PACK_REPORT.md`, `RELEASE_CONTROL.md` (К-12)
- строки К-7/К-8 в `docs/audits/REMHAOS_CONFLICT_REGISTER_2026-09-xx.csv`
- `docs/audits/wp/WP-K2_EVIDENCE.md`

## Запрещено
- H9, H10
- подписанные `docs/canonical/*` (кроме append, названного выше)

## Шаги
1. Каждая К-строка закрывается ссылкой или переводится в реестр конфликтов.

## Гейты
- docs-only

## Критерий приёмки
- все перечисленные К закрыты или в реестре

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-k2-k-list-corrections-runbook` от свежего `origin/main`; один PR `WP-K2: Поправки К-1…К-5, К-12 в неканонические документы; runbook M4 под Р19/Р20`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-K2_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-K2: <статус> | PR #N | HEAD <sha> | blockers: …`.
