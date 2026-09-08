# WP-23 — `sendProposal` требует platform approval, self-approval маркирован, UI «Согласовать КП»

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 2.3 | W3–W4 | 3–5 РС | S-CS, S-UI, S-RU (после WP-21) | нет, если хватает RPC `20260824150000`; иначе S-MIG #6 (запросить слот) |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Отправка КП невозможна без утверждённого approval request платформы; self-approval виден в UI и БД (DEC-010).

## Входы (что должно быть выполнено до старта)
- WP-21 слит
- Р11

## Allowlist файлов (правишь только это)
- `app/dashboard/projects/[id]/proposal/{actions,editor,page}.tsx`
- `components/projectceo/m1-passport-panel.tsx` (выделить из workspace по согласованию с оркестратором)
- H3 — только M1-ветка `command-service.ts`
- H8 — `ru.proposal.*` в конец namespace
- `tests/db4/51_platform_approval_requests_operations.sql` (расширение)
- `tests/projectceo-integration/m1-*`
- `docs/audits/wp/WP-23_EVIDENCE.md`

## Запрещено
- H1, H2, H4–H7, H11, H14

## Шаги
1. `actions.ts:117-140`: перед `status='sent'` — approved request через `projectceo_platform_api.create/submit/decide_approval_request` (`20260824150000:156-428`); self-approval маркируется.
2. UI: «Согласовать КП» в панели Passport → отправка; строки в `ru.ts`.
3. Тесты: командный сервис M1, DB4 51 (approval обязателен, self-approval помечен).

## Гейты
- полный CI
- blind review (approval = security)

## Критерий приёмки
- нельзя `sent` без approved; self-approval виден в UI и БД

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-23-send-proposal-requires-approval` от свежего `origin/main`; один PR `WP-23: `sendProposal` требует platform approval, self-approval маркирован, UI «Согласовать КП»`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-23_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-23: <статус> | PR #N | HEAD <sha> | blockers: …`.
