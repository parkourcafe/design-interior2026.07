# WP-28 — События ошибок, activation-отчёт, скрипт метрик AP7, шаблоны evidence

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 2.7, 4.1 (eng) | W3 (eng) / W8 (отчёт) | 2–4 РС | S-RU (после WP-23) | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Закрыть инженерную часть Launch Gate §18 п.9 и подготовить измерения AP7.

## Входы (что должно быть выполнено до старта)
- Р22 — wedge
- п.11/п.12 — после adoption (владелец)

## Allowlist файлов (правишь только это)
- legacy-маршруты intake/proposal (события ошибок в `events`)
- `app/dashboard/analytics/page.tsx` (строки → `ru.analytics.*`)
- новый `scripts/ops/launch-metrics.ts`
- шаблоны `docs/audits/REMHAOS_M1_COST_REPORT_TEMPLATE.md`, `REMHAOS_AP7_EVIDENCE_TEMPLATE.md`
- H8 — `ru.analytics.*`
- `docs/audits/wp/WP-28_EVIDENCE.md`

## Запрещено
- H1–H7, H11, H13, H14

## Шаги
1. События ошибок в `events` для intake/proposal; activation-отчёт (`intake_link_created` … `proposal_sent`) в аналитике; строки вынести из хардкода в `ru.analytics.*`.
2. `launch-metrics.ts`: time-to-passport из `events`, AI cost из `ai_calls` — запускает владелец на read-only URL; отчёты — по шаблонам после adoption.

## Гейты
- полный CI

## Критерий приёмки
- события пишутся (юнит); отчёт строится на фикстуре; cost report — BLOCKED_ON_OWNER до adoption

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-28-launch-gate-metrics` от свежего `origin/main`; один PR `WP-28: События ошибок, activation-отчёт, скрипт метрик AP7, шаблоны evidence`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-28_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-28: <статус> | PR #N | HEAD <sha> | blockers: …`.
