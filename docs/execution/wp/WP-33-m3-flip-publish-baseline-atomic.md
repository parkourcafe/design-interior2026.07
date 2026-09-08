# WP-33 — M3 №8: флип на `publish_baseline_atomic`, `_module_signatures('m3')` без сырых RPC

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 3.3 | W5 | 2–3 РС | S-MIG #3, S-CS, S-AP5 (после WP-14) | да — слот у оркестратора |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Командный слой M3 публикует baseline только через атомарную дверь; сырые publish-RPC уходят из сигнатур модуля.

## Входы (что должно быть выполнено до старта)
- WP-14 слит

## Allowlist файлов (правишь только это)
- H3 — только M3-ветка `command-service.ts`
- H6 (`m3-surface.ts`, `m3-surface-matrix.test.ts:85`, `tests/db4/06`, `49`, `enable-m3-publication.sql`, `verify-m3-data-api-closed.mjs`)
- H1, H2 (миграция, ledger, `preExisting`, `run.zsh`)
- `docs/audits/wp/WP-33_EVIDENCE.md`

## Запрещено
- H4 (`semanticConflict` :575 — DEC-027, ждёт Р18), H5, H7, H8, H13, H14
- `lib/project-intelligence/modules/package/orchestration.ts`
- H11 — только если звено 6 меняется, по согласованию

## Шаги
1. `command-service.ts` → `publish_baseline_atomic` (`20260825030000`); миграция `create or replace projectceo_platform._module_signatures` для `'m3'` без `publish_version`/`publish_project_baseline`/`publish_production_package_version`; строки двери в `m3-surface.ts`; сверка теста :85 с объединением `20260811010000` + новой миграции; DB4 06/49/51 обновить.

## Гейты
- полный CI (AP5 звенья 6–7)
- blind review

## Критерий приёмки
- `_module_signatures('m3')` без сырых RPC; DB4 06/49/51 зелёные на PG16/17

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-33-m3-flip-publish-baseline-atomic` от свежего `origin/main`; один PR `WP-33: M3 №8: флип на `publish_baseline_atomic`, `_module_signatures('m3')` без сырых RPC`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-33_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-33: <статус> | PR #N | HEAD <sha> | blockers: …`.
