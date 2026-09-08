# WP-27 — Static-boundary тест TTL подписей ≤900

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 2.6 | W1 (филлер) | 0,5 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Закрепить тестом, что вне `lib/project-intelligence/adapters/storage` нет `createSignedUrl(` с TTL больше 900 секунд.

## Входы (что должно быть выполнено до старта)
- —

## Allowlist файлов (правишь только это)
- новый `tests/release/signed-url-ttl-boundary.test.ts`
- `docs/audits/wp/WP-27_EVIDENCE.md`

## Запрещено
- все хотспоты

## Шаги
1. Тест сканирует `app/`, `lib/`, `components/`; допускает только TTL ≤ 900; зелёный на `main` (BUG-03 закрыт в `app/dashboard/projects/[id]/page.tsx:238`), красный при 3600 (доказать временной правкой в evidence, не коммитить).

## Гейты
- gates

## Критерий приёмки
- тест зелёный на main; красный при нарушении

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-27-signed-url-ttl-boundary-test` от свежего `origin/main`; один PR `WP-27: Static-boundary тест TTL подписей ≤900`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-27_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-27: <статус> | PR #N | HEAD <sha> | blockers: …`.
