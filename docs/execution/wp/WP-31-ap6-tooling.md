# WP-31 — AP6-инструменты: загрузчик пакета Ташкент, cookie-jar пяти ролей, digests

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 3.1 (NOT_BUILT из Phase3A §3a.7) | W3–W4 | 3–4 РС | S-PE | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Инструменты для прогона внешнего реального пакета через те же контракты: загрузка данных пакета в одноразовый стек аутентифицированными командами и cookie-jar пяти ролей.

## Входы (что должно быть выполнено до старта)
- манифест `tests/fixtures/cycle7/external-package.manifest.json` (status pending)

## Allowlist файлов (правишь только это)
- новые `tests/pilot-evidence/executors/*` (загрузчик, producer cookie-jar по образцу `kora-five-session-producer.zsh`)
- H15: `tests/pilot-evidence/executors/allowlist.json` (digests)
- `tests/pilot-evidence/*.test.ts`
- `docs/audits/wp/WP-31_EVIDENCE.md`

## Запрещено
- H1–H11
- изменение `status` манифеста (только WP-32 с receipt)

## Шаги
1. Загрузчик: команды от аутентифицированных ролей, не service role; digests в `allowlist.json`; юнит-тесты.

## Гейты
- полный CI

## Критерий приёмки
- тесты pilot-evidence зелёные; digests совпадают; runtime-прогон — WP-32

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-31-ap6-tooling` от свежего `origin/main`; один PR `WP-31: AP6-инструменты: загрузчик пакета Ташкент, cookie-jar пяти ролей, digests`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-31_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-31: <статус> | PR #N | HEAD <sha> | blockers: …`.
