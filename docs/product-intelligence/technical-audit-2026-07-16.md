# Технический аудит — 16 июля 2026

## Доступный baseline

- Локальный Git HEAD: `5134998` — `feat: use ZAI OCR for plan uploads`.
- В локальном HEAD присутствуют миграции `0007_project_rooms.sql` и `0008_concept_packs.sql`.
- В working tree находится более новая `0009_project_room_workflow.sql`; после частичной материализации iCloud она прочитана полностью. Она изменяет таблицы из `0007`, тогда как сам файл `0007_project_rooms.sql` отсутствует в working tree. Чистое развёртывание текущей папки миграций поэтому не является воспроизводимым.
- Git index и значительная часть файлов также находятся в состоянии `compressed,dataless`, поэтому достоверный `git status` локального worktree получить невозможно.
- Для чтения базовой истории использована отдельная read-only clone удалённой ветки; её HEAD `96e895d` новее опубликованной ветки, но не содержит локальные непушенные изменения и поэтому не считается источником истины для working tree.
- Read-only запрос production Data API подтвердил наличие basic `project_rooms/project_tasks` без колонок hardening-миграции `0009`; `0009` в наблюдаемой production schema не применена. Полный migration ledger через Data API не открыт.

Это ограничение запрещает безопасно изменять существующие dataless-файлы и применять database migrations. В рамках аудита добавляются только новые изолированные файлы.

## Что уже реализовано

### Pre-sale M1

- Next.js App Router + TypeScript + Supabase;
- публичный intake по token;
- answers → deterministic passport;
- rule/LLM risks и human review;
- deterministic pricing;
- proposal draft/public page/print;
- events, rate limiting, team membership и RLS.

### Следующие модули локального HEAD

- concept pack как приватный JSONB artifact;
- accepted proposal → project room;
- participants `designer/client/executor`;
- tasks, task status events и простая admin summary;
- извлечение текста/plan-assisted brief и OCR-эксперименты.

## Матрица перехода

| Текущий элемент | Решение | Целевой элемент |
|---|---|---|
| Next.js/Supabase | сохранить | application/deployment cell |
| `designers` | адаптировать | organization + membership |
| `projects` | расширить additive | project + current version |
| `answers` | адаптировать | source fragments + structured inputs |
| `projects.passport jsonb` | оставить временной projection | versioned graph nodes |
| `risk_cards` | адаптировать | risk node revisions + evidence links |
| `proposals.version` | включить в общую версию | deliverable revisions |
| `concept_packs.content jsonb` | projection/artifact | deliverable backed by graph |
| `project_rooms` | не считать Area/Room | edition workspace/session |
| `project_tasks.related_scope_item text` | заменить | FK graph edge |
| plan text/OCR | переиспользовать за adapter | ingestion/extraction provider |
| `events` | сохранить и разделить | product events + append-only audit |

## Главные gaps

1. Organization не является first-class owner; доступ в основном выводится из `designer_id` и studio membership.
2. Нет `Source`/`SourceFragment` с checksum, locator и immutable provenance.
3. Passport и concept pack — крупные JSONB-снимки без identity/revision отдельных решений.
4. `risk_cards.evidence` — текст, а не ссылка на fragment.
5. Нет общей модели requirement/assumption/decision/deliverable/item.
6. Нет ProjectVersion, ChangeSet и diff на уровне домена.
7. Нет сохранённых dependency edges и детерминированного change-impact.
8. Project-room tasks генерируются из proposal/risk, но связь со scope хранится строкой.
9. Региональная изоляция не оформлена как deployment cell.
10. Runtime AI routing содержит принятые ранее компромиссы для РФ, но ещё не отделён по региональным policy.

## Подтверждённые риски текущего workflow

1. `app/api/intake/submit/route.ts` и повторный запуск risks перезаписывают Passport и пересоздают risk cards без общей immutable version; подтверждения и ручные правки могут потерять lineage.
2. Отправленное КП остаётся редактируемым через текущий proposal editor, поэтому публичный URL может показать изменённое содержание без новой версии и повторного approval.
3. Создание Project Room выполняется несколькими последовательными insert/update без единой database transaction; частичный failure может оставить неполный workspace.
4. Proposal response защищён application check, но не подтверждён уникальным database constraint от конкурентных ответов.
5. Public access tokens не имеют оформленной expiry/rotation policy и хранятся как bearer secrets.
6. `project_participants` ограничивает один participant на role, что не соответствует нескольким исполнителям или заказчикам.
7. `events` и `project_task_events` не дают полного actor/before/after/correlation audit.
8. Версии toolchain расходятся: приложение собирается на Next `16.2.10`, а `eslint-config-next` остаётся `14.2.15`; это нужно выровнять отдельной проверяемой задачей.
9. `SECURITY DEFINER` функции текущего membership/workspace слоя требуют отдельного privilege audit: role/participant нельзя принимать как доверенные значения из клиента, а execute grants должны быть минимальными.
10. Новые Supabase deployments должны получать явные Data API grants; полагаться на исторические defaults нельзя.

## Риски миграции

- попытка заменить passport сразу сломает рабочий M1;
- переименование `project_rooms` конфликтует с понятием физических помещений;
- изменение ownership/RLS одной миграцией может закрыть доступ действующим студиям;
- локальная последовательность миграций расходится с удалённой веткой;
- production schema может отличаться от Git из-за выборочно применённых migrations;
- незафиксированные working-tree изменения нельзя безопасно смешивать с большим refactor.

## Рекомендуемый migration path

1. Материализовать iCloud project folder и получить чистый `git status`.
2. Снять production schema-only dump и таблицу применённых migrations.
3. Восстановить непрерывную цепочку `0001…0009` и проверить bootstrap на пустой БД.
4. Зафиксировать текущий HEAD в резервной ветке.
5. Добавить organization model без удаления `designer_id`; выполнить backfill.
6. Развести legacy `project_rooms`/workspace и физические `project_areas`.
7. Добавить sources/fragments и graph tables additive migration.
8. Dual-write: текущий intake продолжает писать answers/passport и параллельно создаёт graph projections.
9. Сравнивать outputs на эталонных проектах.
10. Перевести read-path нового вертикального среза на graph.
11. Только после пилотов объявить graph источником истины и оставить passport как projection.

## Автономно выполненная безопасная часть

- архитектурный baseline и ADR;
- Project Graph contract и invariants;
- vertical slice acceptance criteria;
- исполняемый backlog;
- изолированный pure TypeScript impact/invariant module и unit tests.

Production migration и интеграция в текущие routes отложены до восстановления полного локального worktree.
