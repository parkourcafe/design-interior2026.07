# M3 P0 — инвентаризация по коду: что уже есть, что строить

Дата: 09.08.2026 · Ветка: `claude/m3-a5-governance` (от `main`, канон влит `1e7c441`)
Основание: A5 подписан 09.08.2026 (DEC-024); брифинг M3, раздел «ЧТО УЖЕ
СУЩЕСТВУЕТ — НЕ СТРОИТЬ ЗАНОВО».

Проверено по репозиторию, а не по отчётам. Каждая строка — файл и номер строки.

## Шесть пунктов P0 из `MASTER_EXECUTION_PLAN` §M3

| # | Пункт P0 | Состояние | Доказательство |
|---|---|---|---|
| 1 | Intake PDF/JPG/PNG/CSV/XLSX | **модель есть, командная поверхность закрыта** | `SourceMediaKind` = `pdf \| image \| spreadsheet \| plain_text \| document \| cad_binary \| archive` (`modules/package/contracts.ts:12–19`); формат импорта `logical_json \| pdf \| xlsx \| csv` (там же, 208, 221). Но команда `register_source` возвращает `unavailable("read_contract_pending")` — `delivery/projectceo/live-read-port.ts:937`; в контракте помечена комментарием «пока UNAVAILABLE» (`command-contract.ts:18`) |
| 2 | Связи room / sheet / specification | **частично: `sheet` отсутствует как сущность** | `roomId` есть, но в M2-контуре design-intent (`modules/design-intent/contracts.ts:13,23,32,41`); `specification` есть как поле selection (`modules/decisions/workflow.ts:214,234`). Поиск `sheetId`/`SheetRef` по `lib/project-intelligence/modules/` — **ноль вхождений**. Связей room↔sheet↔specification нет |
| 3 | Ревизии | **есть** | `revisionId`/`revisionNo` сквозные; статусы документа `current \| previous \| reference \| unknown` (`modules/package/contracts.ts:3–10`) |
| 4 | Completeness / conflict review | **conflict есть, completeness отсутствует** | `ConflictReview`, `conflictReviews` (`contracts.ts:113,132`), `semantic_conflict` (68), `semanticConflict` в инвентаре (39). Поиск `completeness` по `modules/package/*.ts` — **ноль вхождений** |
| 5 | Baseline | **есть** | `BaselineCandidateInput`, `ProjectBaseline`, `BaselineSemanticContent` (`contracts.ts:119,135,142,162`) |
| 6 | Immutable Released Production Package | **есть** | `ReleaseLogicalContent`, `ReleaseDescriptor`, `ReleaseArtifact` (`contracts.ts:198,213,218,226`); неизменяемость — `immutable()` с рекурсивным `Object.freeze` (`orchestration.ts:38–43`, применяется в 202, 370, 394) |

## Вход модуля — построен и подключён к интерфейсу

- домен: `createM2ToM3Handoff` (`lib/project-intelligence/application/m2-to-m3-handoff/index.ts`),
  контракт `archidom.m2-to-m3-handoff/0.1`, тест
  `tests/project-intelligence/application/m2-to-m3-handoff.test.ts`;
- сервер: `supabase/migrations/20260802090000_projectceo_m2_client_review_m3_handoff.sql`,
  `tests/db4/33_m2_client_review_m3_handoff_operations.sql`;
- интерфейс: `components/projectceo/m2-m3-approved-input-card.tsx` — показывает
  существующий handoff либо кнопку `publish_m2_m3_handoff`; доступ только у
  ролей `owner` и `architect` (строки 9–10).

## Роли и поверхности M3 уже существуют в рабочем пространстве

`components/projectceo/role-policy.ts`: роль **`architect`** наделена
`register_source`, `review_source`, `publish_baseline`, `publish_release`,
`distribute_release` (30–49). Вкладки `sources`, `baseline`, `releases` есть в
`TAB_CAPABILITY` (74–83).

**Следствие для формы каркаса.** M3 не имеет и не должен иметь собственного
дерева маршрутов: модуль живёт внутри
`/dashboard/projectceo/projects/[projectId]` (`app/dashboard/projectceo/projects/[projectId]/page.tsx`,
23 строки → `ProjectCeoWorkspace`). Инвариант A5 §4.2.2 («флаг модуля,
выключенный по умолчанию; при выключенном — 404 на всех маршрутах модуля»)
применяется к этой топологии так: флаг закрывает **поверхности** M3 — новые
вкладки/секции и новые команды на сервере, — а не воображаемые отдельные
страницы. Отдельный маршрут заводится только если появится поверхность, которой
действительно нужен свой URL. Строить дерево `/documentation/...` ради
буквального прочтения инварианта означало бы построить пустой фасад.

## Что, следовательно, составляет работу M3 P0

Ровно то, чего нет:

1. **`sheet` как сущность** и связи room ↔ sheet ↔ specification (пункт 2).
2. **Completeness review** — комплектность пакета (пункт 4, вторая половина).
3. **Открытие командной поверхности intake**: `register_source` / `review_source`
   из `read_contract_pending` в рабочее состояние (пункт 1).

Пункты 3, 5, 6 и первая половина 4 (conflict) переиспользуются как есть.
Второй механизм ревизий не строится — инвариант A5 §4.2.1.

## Чего эта инвентаризация не утверждает

Она не проверяет поведение baseline/release на живой базе — отдельных тестов
`tests/project-intelligence/modules/package/` и `tests/db4/*baseline*` в
репозитории нет; покрытие этих контрактов идёт через сценарии Kora и AP1
(`tests/ap1/e2e/run-five-sessions.zsh`), которые в этой сессии не запускались.
Утверждение «машинерия работает» взято из брифинга и из наличия контрактов, а
не из собственного прогона, и здесь оно отмечено как непроверенное.

Цикл 7 остаётся открытым и красным: `npm run test:cycle7` не запускался, не
чинился и зелёным не объявляется.

## Поправка 10.08.2026: baseline/release всё-таки проверены на живой базе

Утверждение раздела выше — «поведение baseline/release на живой базе не
проверяется» — **неверно**, и это ошибка самой инвентаризации, а не пробел в
доказательствах. Поиск шёл по именам файлов (`tests/db4/*baseline*`,
`tests/project-intelligence/modules/package/`), их действительно нет — но
контракты прогоняются внутри общего сценария продуктового мозга
`tests/db4/20_product_operations.sql`, где искать по имени было нечего.

Что там проверяется на самом деле (файл, строка, утверждение):

| Контракт | Строка | Что доказывается |
|---|---|---|
| `publish_project_baseline` | 511 | baseline до одобрения не публикуется — `DB4_UNAPPROVED_BASELINE_PUBLISHED` |
| `publish_project_baseline` | 567 | публикация проходит и попадает в леджер |
| ссылки baseline | — | `DB4_BASELINE_REF_COUNT`, `DB4_WORK_PACKAGE_OUTSIDE_BASELINE` |
| `publish_production_package_version` | 618, 690, 707 | корневой и рабочий пакеты, отказ вне baseline |
| `build_release_artifact` | 754, 769, 795 | семантическая дедупликация: вторая сборка того же кортежа возвращает `existing_artifact`, второй строки не создаётся |
| `distribute_release` / `acknowledge_release` | 812, 860, 881, 899 | `DB4_WRONG_ACK_HASH_ALLOWED`, `DB4_WRONG_ACK_RECIPIENT_ALLOWED` |
| неизменяемость | 1058–1072 | реальные `update` baseline и `delete` release-артефакта отбиваются: `DB4_BASELINE_MUTABLE`, `DB4_RELEASE_MUTABLE` |

Плюс на том же материале: rollback/replay после перезапуска базы
(`30_restart_replay.sql`), межарендная изоляция, идемпотентность и конфликт
дайджеста запроса.

Сценарий не «лежит в репозитории» — он бежит в CI при каждом push, в job
`database` на `postgres:16-alpine` **и** `postgres:17-alpine`
(`.github/workflows/ci.yml`). То есть пункты 5 и 6 плана (baseline и immutable
Released Production Package) подтверждены прогоном на обеих версиях СУБД, а не
взяты из брифинга.

Что по-прежнему НЕ покрыто и остаётся честной дырой: юнит-тестов доменного
слоя `lib/project-intelligence/modules/package/` нет — контракты baseline и
release проверяются только на границе БД. Отдельного сценария на сам пакет
документации в связке с baseline тоже нет: M3-листы в baseline пока не входят,
и до решения о том, входят ли они туда вообще, писать такой сценарий было бы
кодированием невыясненного.
