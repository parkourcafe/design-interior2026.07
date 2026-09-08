# WP-01 — PR-триаж, `/api/health` отдаёт commit, dry-run список веток

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 0.3, 0.11 (eng) | W1 | 0,5 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Закрыть хвосты триажа PR и сделать живой коммит production видимым через `/api/health`; подготовить владельцу список веток к удалению без выполнения удаления.

## Входы (что должно быть выполнено до старта)
- Р1 (CI работает) — для merge #123
- Р10 — merge #123 после зелёного CI (делает оркестратор/владелец)
- Р8 — удаление веток и branch protection выполняет владелец по списку из evidence

## Allowlist файлов (правишь только это)
- `app/api/health/route.ts`
- новый `tests/release/health-route.test.ts`
- `docs/audits/wp/WP-01_EVIDENCE.md` (включая список веток)

## Запрещено
- все хотспоты H1–H18
- удаление веток, настройка protection (только владелец)

## Шаги
1. Подтвердить, что PR #122 закрыт и #123 слит (или готов к слиянию); записать в evidence run id CI #123.
2. `app/api/health/route.ts`: добавить поле `commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null`; значение секретов не отдавать (сохранить `Boolean(...)`-паттерн).
3. Тест `tests/release/health-route.test.ts`: с переменной — возвращает sha; без — `null`; ключи не утекают.
4. Dry-run списка веток: `git fetch --prune origin && git branch -r --merged origin/main | grep -vE 'origin/(main|HEAD)$'`, исключить головы открытых PR (`list_pull_requests`), `git diff origin/main..origin/Main --stat` — вывод в evidence. Ничего не удалять.

## Гейты
- полный CI (код)

## Критерий приёмки
- `/api/health` отдаёт `commit`; тест зелёный
- #122 closed, #123 merged (или причина, почему нет)
- список веток и `Main` передан владельцу в evidence

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-01-pr-triage-health-commit` от свежего `origin/main`; один PR `WP-01: PR-триаж, `/api/health` отдаёт commit, dry-run список веток`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-01_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-01: <статус> | PR #N | HEAD <sha> | blockers: …`.
