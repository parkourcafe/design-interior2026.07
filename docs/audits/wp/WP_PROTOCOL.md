# Протокол пакета работ (WP) — RemHaOS

Действует для всех рабочих и ревью-сессий программы по `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`.

## Рабочая сессия

1. Прочитай свою карточку `docs/execution/wp/WP-xx-*.md` целиком и `AGENTS.md`. Карточка — контракт:
   цель, allowlist файлов, запрещённые файлы, гейты, критерий приёмки.
2. Ветка `wp/WP-xx-<slug>` от свежего `origin/main`. Никаких force-push, amend, rebase чужих веток.
3. Правишь только allowlist. Нужен другой файл — остановись, статус `BLOCKED_HOTSPOT`, в PR: файл,
   строки, причина, минимальный diff. Границу расширяет оркестратор.
4. Grep-first: если карточка ссылается на код, которого нет на `main`, зафиксируй это как факт с командой
   и выводом и заверши пакет как no-op с evidence.
5. Коммиты маленькие, императивные, без префиксов и без идентификаторов моделей.
6. Перед каждым push: `npm ci && npm run release:check`. Если задет SQL: `apt-get install -y zsh ripgrep`,
   `PI_DB_IMAGE=postgres:16-alpine zsh tests/db4/run.zsh`, затем `postgres:17-alpine`; DB5 аналогично.
   Один push на веху, не на каждый коммит.
7. Evidence — `docs/audits/wp/WP-xx_EVIDENCE.md` по `WP_EVIDENCE_TEMPLATE.md`, каждая строка помечена
   `[ИЗВЛЕЧЕНО]` или `[ИНТЕРПРЕТИРОВАНО]`.
8. PR: заголовок `WP-xx: <название>`; тело — секции `WP`, `Основание`, `Allowlist`, `Hotspots`,
   `Миграция/S-MIG`, `Пины`, `Локальные гейты`, `CI`, `Evidence`, `Не сделано`. Строка `@claude` в PR
   запрещена. Draft до прохождения локальных гейтов.
9. Секреты не печатать; `.env`, ключи, сертификаты не читать; production-ref не использовать.
10. Завершение сессии — одна строка статуса: `WP-xx: <статус> | PR #N | HEAD <sha> | blockers: …`.

## Миграции (только держатель S-MIG)

- Timestamp и номер DB4 выдаёт оркестратор; вписаны в карточку до старта.
- Ledger регенерируется только командой `sha256sum supabase/migrations/*.sql >
  tests/ap1/environment/migration-ledger.sha256`; затем `npx vitest run
  tests/ap1/environment/environment.contract.test.ts tests/layout-studio/integration/integration.test.ts`.
- Новая миграция добавляется в `preExisting` в `tests/layout-studio/integration/integration.test.ts` с
  комментарием «К Layout Studio отношения не имеет».
- При rebase, если в `main` появилась миграция новее — `git mv` на новый timestamp, регенерация ledger,
  пометка в PR. Применённые миграции не переименовываются.
- Count-pinned тесты меняются в том же PR с таблицей «пин: было → стало → основание».

## Ревью-сессия (blind-review)

- Read-only. Вход: diff PR на точном HEAD, `docs/audits/wp/WP-xx_EVIDENCE.md`, карточка WP, ТЗ.
  Транскрипт рабочего не читается; вердикт автора не запрашивается.
- Проверяет: allowlist соблюдён; хотспоты не тронуты; пины обоснованы; тесты не ослаблены; секретов и
  production-ref нет; классы доказательств не смешаны; критерий приёмки карточки выполнен.
- Вердикт комментарием в PR: `BLOCKER` (безопасность, tenancy, потеря данных, обход гейта, production),
  `MAJOR`, `MINOR`, либо «замечаний нет». Новый SHA инвалидирует вердикт.

## Оркестратор

Правило слияния (Р31), серии (ТЗ §8), лимиты (ТЗ §5), конфликты (ТЗ §10) — обязательны. Первое слияние в
`main` только после перевода Vercel Production Branch на `release` владельцем.
