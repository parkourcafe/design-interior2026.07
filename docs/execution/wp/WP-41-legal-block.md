# WP-41 — Юрблок: privacy/terms/support из env, subprocessors, тест удаления аккаунта

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 4.2 (eng) | W5–W7 | 1–2 РС | S-RU | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Страницы privacy/terms/support отражают факт: реквизиты из env, subprocessors, сроки хранения, порядок удаления; удаление аккаунта покрыто тестом.

## Входы (что должно быть выполнено до старта)
- WP-03 слит
- тексты юриста (владелец)
- Р23 — data plane

## Allowlist файлов (правишь только это)
- `app/legal/**`, `app/support/**`
- `app/api/account/delete/route.ts`
- H8 — `ru.legal.*`
- новый `tests/release/account-delete-and-associations.test.ts`
- `docs/audits/wp/WP-41_EVIDENCE.md`

## Запрещено
- остальные хотспоты

## Шаги
1. Subprocessors: Supabase (ap-northeast-1, Токио), Vercel, Resend, LLM-провайдер по env, Higgsfield CDN; сроки хранения — плейсхолдер до DEC-026; удаление — охват user/projects/answers/files (тест).

## Гейты
- полный CI

## Критерий приёмки
- Charter §18 п.7 evidence; страницы рендерят env-значения, не дефолты

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-41-legal-block` от свежего `origin/main`; один PR `WP-41: Юрблок: privacy/terms/support из env, subprocessors, тест удаления аккаунта`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-41_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-41: <статус> | PR #N | HEAD <sha> | blockers: …`.
