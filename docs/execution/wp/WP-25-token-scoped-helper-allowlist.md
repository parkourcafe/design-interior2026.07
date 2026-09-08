# WP-25 — BUG-05 (а): token-scoped helper + allowlist-тест на `createAdminClient` + черновик принятия риска

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 2.5а | W2–W3 | 2–3 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Публичные token-scoped маршруты продолжают использовать service_role через узкий helper с allowlist, а любое новое использование вне списка роняет CI.

## Входы (что должно быть выполнено до старта)
- Р26 — принятие риска (черновик готовит этот WP)

## Allowlist файлов (правишь только это)
- новый `lib/supabase/token-scoped.ts`
- новый `tests/release/service-role-allowlist.test.ts` (образец `tests/ap1/guest/static-boundary.test.ts`)
- перечисленные маршруты класса (а): `app/api/intake/{start,submit,upload}`, `app/api/client/create`, `app/api/proposal/respond`, `app/p/[public_token]`, `app/b/[token]`, `app/room/[access_token]`, `app/api/brief/custom-question/plan-upload`, `app/api/project-room/task-status`, `lib/rate-limit.ts`, `lib/llm/recording.ts`, `app/api/account/delete`, telegram webhook, `lib/integration-gateway/runtime/worker-client.ts`
- новый `docs/audits/REMHAOS_RISK_ACCEPTANCE_TOKEN_SCOPED_2026-09-xx.md`
- `docs/audits/wp/WP-25_EVIDENCE.md`

## Запрещено
- все хотспоты

## Шаги
1. Helper оборачивает `createAdminClient` с allowlist вызывающих; тест: импорт `createAdminClient` разрешён только в списке; новый импорт вне списка — падение CI.
2. Черновик принятия риска: почему token-scoped маршруты остаются на service_role (правило 3 CLAUDE.md), какие проверки это компенсируют.

## Гейты
- полный CI

## Критерий приёмки
- новый импорт вне allowlist роняет CI (доказать в evidence)

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-25-token-scoped-helper-allowlist` от свежего `origin/main`; один PR `WP-25: BUG-05 (а): token-scoped helper + allowlist-тест на `createAdminClient` + черновик принятия риска`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-25_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-25: <статус> | PR #N | HEAD <sha> | blockers: …`.
