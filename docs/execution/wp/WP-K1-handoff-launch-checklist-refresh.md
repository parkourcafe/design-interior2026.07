# WP-K1 — HANDOFF / LAUNCH_CHECKLIST / conflict register / email README → актуальные факты

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 0.13 (К-10, К-11, К-13), 1.5 docs | W1 (филлер) | 0,5–1 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Привести операционные документы к живым фактам аудита 08.09.

## Входы (что должно быть выполнено до старта)
- Р2 (ветка `release`), Р13 (домен почты)

## Allowlist файлов (правишь только это)
- `HANDOFF.md`
- `LAUNCH_CHECKLIST.md`
- `REMHAOS_CONFLICT_REGISTER_2026-08-02.csv` (C-001 → RESOLVED)
- `HANDOFF_CINEMATIC.md` (баннер устаревания)
- `supabase/email-templates/README.md` (→ `remhaos.com`)
- `docs/audits/wp/WP-K1_EVIDENCE.md`

## Запрещено
- H9, H10

## Шаги
1. HANDOFF: орг «Remhaos+ Pet ID», production-проект (идентификатор взять из `ARCHITECTURE.md:22`, в промпт не копировать), ветка `main`, «Свод» → RemHaOS, production branch `release`; LAUNCH_CHECKLIST — домен; register C-001 resolved; баннер в HANDOFF_CINEMATIC; email README под `remhaos.com`.

## Гейты
- docs-only

## Критерий приёмки
- `rg 'Свод|arhidom.space'` в этих файлах → только исторические сноски

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-k1-handoff-launch-checklist-refresh` от свежего `origin/main`; один PR `WP-K1: HANDOFF / LAUNCH_CHECKLIST / conflict register / email README → актуальные факты`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-K1_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-K1: <статус> | PR #N | HEAD <sha> | blockers: …`.
