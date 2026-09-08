# WP-22 — Предложение по модели моста M1 (enrollment vs legacy-id без FK)

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 2.2 | W1 (филлер) | 0,5 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Подготовить владельцу решение Р11 с последствиями для RLS, AP5 и данных.

## Входы (что должно быть выполнено до старта)
- —

## Allowlist файлов (правишь только это)
- новый `docs/product-intelligence/M1_BRIDGE_MODEL_PROPOSAL_2026-09-xx.md`
- `docs/audits/wp/WP-22_EVIDENCE.md`

## Запрещено
- H9, H10
- код

## Шаги
1. Вариант (а) enrollment — legacy-проект серверно зачисляется в ProjectCEO-проект студии при первой команде M1 (одна модель данных, `AGENTS.md:46-47`); вариант (б) — ключ по legacy id без FK (образец `20260824170000`). Последствия для RLS, AP5, миграций, отката. Рекомендация — (а). Черновик owner-decision.

## Гейты
- docs-only

## Критерий приёмки
- владелец подписал решение (Р11)

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-22-m1-bridge-model-proposal` от свежего `origin/main`; один PR `WP-22: Предложение по модели моста M1 (enrollment vs legacy-id без FK)`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-22_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-22: <статус> | PR #N | HEAD <sha> | blockers: …`.
