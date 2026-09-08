# WP-18 — Пакет Human GO: хеши RC, индекс evidence §1–§12, черновики Approvals A–D

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 1.8 (eng) | W6 | 0,5 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Собрать всё для подписей чек-листа adoption на точном RC SHA.

## Входы (что должно быть выполнено до старта)
- WP-12, WP-16 зелёные
- Р14 — подписанты

## Allowlist файлов (правишь только это)
- `reconciliation-2026-09/RC_HASHES.md`
- `ADOPTION_CHECKLIST.md` — evidence-строки
- `docs/audits/wp/WP-18_EVIDENCE.md`

## Запрещено
- подписи §13 (владелец)
- все хотспоты

## Шаги
1. `RC_HASHES.md`: sha ledger, `.env.example`, `.vercelignore`, `next.config.mjs`, `package.json` на RC SHA; индекс evidence по §1–§12; черновики записей Approval A (history repair) → B (additive) → C (deploy RC: `release` → RC) → D (traffic).

## Гейты
- docs-only

## Критерий приёмки
- владелец подписал A → B; окно 1.9 и C → D — владелец

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-18-human-go-package` от свежего `origin/main`; один PR `WP-18: Пакет Human GO: хеши RC, индекс evidence §1–§12, черновики Approvals A–D`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-18_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-18: <статус> | PR #N | HEAD <sha> | blockers: …`.
