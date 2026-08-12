# M4 V1 Impact — реализация, контракт покрытия, воркер, доказательство

**Дата:** 12.08.2026
**Основание:** OWNER GO «АВТОНОМНО ЗАВЕРШИТЬ REMHAOS M4 V1 IMPACT», DEC-033
LOCKED (`docs/canonical/remhaos-v1/REMHAOS_DECISION_LOG_v1.md`), поверх
DEC-032 (`REMHAOS_A6_CLARIFICATION_M4_EXECUTION_LAYER_2026-08-12.md`).
**Объём:** ровно расчёт влияния изменения (`calculate_change_impact_policy_bound`)
и его человеческое рассмотрение (`review_change_impact`). V2/V3 (вехи, фото,
приёмка, передача) этим документом не открываются — они остаются
`NOT AUTHORIZED`.
**Итоговое состояние этапа:** `M4_V1_IMPACT_PROVEN`.

Этот отчёт — единый документ, закрывающий четыре синхронизационных требования
OWNER GO: контракт политики/покрытия, поверхность команд/RPC, отчёт о
реализации и доказательстве, операционный runbook воркера. Разделы 3, 5 и 6
ниже — самостоятельные разделы именно под эти три требования; раздел 2 и 4 —
отчёт о реализации и доказательство.

## 1. Зачем этап существует

DEC-032 зафиксировал целевой человеческий контракт M4 из 10 команд, но
`calculate_change_impact` (расчёт влияния) остался системной, а не
человеческой RPC — без него `review_change_impact` нечего рассматривать.
Старая реализация расчёта принимала `max_depth`/`max_impacts` от вызывающего,
не имела фиксированной политики, не различала «граф пуст за пределами
найденного» от «графа за пределами найденного точно больше нет», и строила
пути на каждый возвращённый impact отдельным коррелированным подзапросом —
что на графах, близких к границе лимита, занимало от 12 до 142 секунд.

V1 Impact закрывает это: единственная policy-bound системная дверь расчёта,
зафиксированная политика, три различимых durable-исхода с точными полями,
воркер, который эту дверь вызывает вместо человека, и durable operator
failure на случай постоянно ломающихся заявок — вместо того чтобы яд в
очереди блокировал остальные заявки навсегда.

## 2. Что построено

| Слой | Файл |
|---|---|
| Миграция: колонки покрытия, `_impact_policy()`, `calculate_change_impact_policy_bound`, `list_change_impact_backlog`, `impact_worker_failures`, `record_change_impact_worker_failure`, `redrive_change_impact_worker_failure`, закрытие старой двери | `supabase/migrations/20260812010000_projectceo_m4_impact_worker_read.sql` |
| Адаптер: типы покрытия, `calculateChangeImpactPolicyBound`, `listChangeImpactBacklog`, `recordChangeImpactWorkerFailure`, `redriveChangeImpactWorkerFailure` | `lib/project-intelligence/adapters/postgres/execution.ts` |
| Планировщик воркера: схемы очереди, идемпотентный ключ, обнаружение дублей | `lib/project-intelligence/workers/change-impact/planner.ts` |
| Раннер воркера: классификация исходов, поглощение одного яда, bounded retry → dead-letter | `lib/project-intelligence/workers/change-impact/runner.ts` |
| CLI-точка входа | `scripts/run-change-impact-worker.ts`, `package.json` (`worker:change-impact`) |
| Флаг инкремента: `review_change_impact` → инкремент 1 | `lib/project-intelligence/delivery/projectceo/execution-flag.ts` |
| Поверхность команд: increment/onState/closure для двух RPC, non-command список для 4 новых системных функций | `lib/project-intelligence/delivery/projectceo/m4-surface.ts` |
| Live-read: `impactCoverageView`, разделение `allReturnedImpactsReviewed`/`coverageComplete`/`impactReviewComplete` | `lib/project-intelligence/delivery/projectceo/live-read-port.ts` |
| UI-контракт: `ChangeImpactCoverageView`, поле `coverage` на `ChangeRequestView` | `components/projectceo/contracts.ts` |
| UI: баннеры partial/blocked, счётчик рассмотренных | `components/projectceo/project-workspace.tsx` |
| Строки RU | `lib/i18n/ru.ts` (`workspace.changes.coveragePartialWarning`, `coverageReviewedCount`, `coverageBlockedWarning`) |
| Одноразовая среда: гранты `review_change_impact`/`replay_review_change_impact` на `authenticated` | `tests/ap1/environment/enable-m4-increment-1.sql` |
| DB5: бенчмарк детерминированности и производительности | `tests/db5/26_impact_policy_benchmark.sql` |
| DB5: полная матрица трёх исходов | `tests/db5/27_impact_coverage_outcomes.sql` |
| DB5: parallel-worker и restart/replay пробы для V1 Impact | `tests/db5/run-concurrency.zsh`, `tests/db5/30_restart_replay.sql` |
| DB5/DB4: обновлённые census/default-deny/surface-classification файлы | `tests/db5/{05,06,10,20,90}_*.sql`, `tests/db4/{07,08,38}_*.sql` |
| Юнит-тесты воркера | `tests/projectceo-integration/change-impact-worker.test.ts` |
| AP5: реальный воркер + отдельная сессия архитектора + недостижимость двери | `tests/ap5/02-kora-chain.spec.ts` (звенья 12–13), `tests/ap5/change-impact-worker.ts` |

## 3. Контракт политики и покрытия

### 3.1 Политика — зафиксированная серверная константа

`projectceo_m4._impact_policy()` возвращает
`{ "version": "project-ceo-impact-policy/0.1", "maxDepth": 7, "maxImpacts": 5000 }`.
Вызывающий `calculate_change_impact_policy_bound` не передаёт ни `max_depth`,
ни `max_impacts` — их нет в сигнатуре функции. Значение политики попадает и в
сохранённую строку `impact_runs`, и в `resultHash`/`request_digest`, поэтому
смена версии политики не может тихо переинтерпретировать уже посчитанный
прогон задним числом (см. §4, «политика/покрытие не переписывают прошлый
прогон»). Следующее изменение `maxDepth`/`maxImpacts` возможно только новой
версией `_impact_policy()`, не повторным подбором на benchmark.

### 3.2 Три исхода — durable terminal outcome

Инвариант каждого исхода — не только текст, а constraint на таблице
(`m4_impact_runs_coverage_shape_check`, `supabase/migrations/20260812010000_….sql:93-115`):
строка, не подходящая ровно под один из трёх контрактов, физически не может
попасть в базу ни при каком будущем изменении кода вокруг неё.

| `coverageStatus` | `hasMoreBeyondDepth` | `cutoffReason` | `returnedImpactCount` | `knownImpactCountLowerBound` |
|---|---|---|---|---|
| `complete` | `false` | `null` | = найдено все | = `returnedImpactCount` |
| `partial_depth` | `true` | `'depth_boundary'` | ≤ `maxImpacts`, сохранены и видимы | `returnedImpactCount + 1` |
| `blocked_result_limit` | `true` | `'result_limit'` | `0` — ничего не сохраняется, ревью недоступно | `maxImpacts + 1` (`5001`) |

При совмещённом срабатывании (глубина упёрлась ровно там же, где превышен
лимит) побеждает `blocked_result_limit` — зонд глубины не выполняется и
второго полного обхода не требуется: лимит проверяется в ходе того же
единственного обхода до `maxDepth + 1`.

`blocked_result_limit` — durable terminal: `returnedImpactCount = 0` означает,
что ни один impact не сохраняется и не показывается, кнопки ревью отсутствуют,
а заявка исчезает из `list_change_impact_backlog` (расчёт уже произошёл и
зафиксирован как терминальный, повторный расчёт по тому же ключу — replay
того же результата, не новая попытка).

### 3.3 Разделение ревью-полноты

Старое булево `allImpactsReviewed` заменено тремя полями:

* `allReturnedImpactsReviewed` — все ПОКАЗАННЫЕ карточки рассмотрены
  (`not exists` непросмотренных среди сохранённых; для `blocked_result_limit`
  с нулём сохранённых карточек это тривиально `true` — вакуумная истинность,
  обработанная явно в `impactCoverageView()`, `live-read-port.ts`).
* `coverageComplete` — обход графа завершён, то есть `coverageStatus ===
  'complete'`.
* `impactReviewComplete = allReturnedImpactsReviewed AND coverageComplete`.

Рассмотреть все показанные карточки не переводит `partial_depth` в
завершённый статус: `impactReviewComplete` остаётся `false`, пока
`coverageComplete` не станет `true` — а это свойство графа, а не действие
человека, и человеческого способа его обойти в V1 нет (никакой кнопки
«принять как есть»).

## 4. Требования DEC-033 и чем каждое закрыто

| Требование | Чем закрыто |
|---|---|
| Единственная policy-bound дверь, caller не передаёт `maxDepth`/`maxImpacts` | `calculate_change_impact_policy_bound(project_id, change_request_id, expected_state_revision, idempotency_key)` — 4 параметра, ни одного про политику; `_impact_policy()` читается внутри |
| Старая дверь с произвольной глубиной закрыта даже для `service_role` | `revoke execute on function projectceo_m4_api.calculate_change_impact(...) from service_role` (миграция, секция «закрытие старой двери»); `tests/db5/90_default_deny_after.sql` `DB5_RAW_IMPACT_RPC_REACHABLE_BY_SERVICE_ROLE_AFTER_RUN`; `tests/db4/38_m4_execution_guardrail.sql` `DB4_M4_RAW_IMPACT_RPC_REACHABLE_BY_SERVICE_ROLE` |
| Три исхода как durable terminal | `m4_impact_runs_coverage_shape_check`; DB5 §1–§5 файла 27 |
| `blocked_result_limit` не сохраняет ничего, ревью недоступно | DB5 файл 27 §4 (`returnedImpactCount=0`, backlog не содержит заявку); AP5 звено 12 (ветка `blocked_result_limit` явно проверяет отсутствие `review_change_impact` в доступных операциях) |
| Комбинированный cutoff → лимит побеждает | DB5 файл 27 §5 |
| Нет человеческого override/«принять как partial complete» | Не реализовано ни одной командой; `command-service.ts` не содержит такого kind; DB5 файл 27 §9 проверяет, что ревью всех карточек `partial_depth` не поднимает `coverageComplete`/`impactReviewComplete` |
| `allReturnedImpactsReviewed`/`coverageComplete`/`impactReviewComplete` | `execution.ts` (`ImpactReviewMutation`), `live-read-port.ts` (`impactCoverageView`), DB5 файл 27 §9, `tests/projectceo-ui/workflows.test.ts` |
| Policy/coverage входят в digest и replay | DB5 файл 27 §6 (повтор с тем же `expected_state_revision` и тем же idempotency-ключом даёт `replay=true` и байт-идентичные поля покрытия) |
| Уже смерженные миграции не редактировались | Всё это — новая миграция `20260812010000`; `git diff` против `origin/main` не касается ни одной ранее смерженной миграции |
| `maxImpacts` реально governs limit, не hardcoded 5000 в вычислительной семантике | Алгоритм читает `v_max_impacts := (v_policy->>'maxImpacts')::integer` из `_impact_policy()`, а не литерал; DB5 файл 27 §3/§4 проверяют границу именно через эту переменную на фикстурах ровно 5000 и 5001 узлов |
| Поиск max+1 различимых influences, bounded frontier, без unbounded JSON до проверки лимита, без path explosion, без множественных полных обходов, детерминированный порядок/результат/digest | См. §7 ниже (обоснование алгоритма); `tests/db5/26_impact_policy_benchmark.sql` (детерминированность через `SAVEPOINT`/`ROLLBACK TO`, честный сигнал усечения, ceiling на время) |
| Полный воркер (backlog RPC, planner, runner, adapter, bounded retry, durable terminal/operator failure, DLQ/redrive, structured report, `npm run worker:change-impact`) | §6 ниже |
| complete/partial/blocked никогда не возвращаются в backlog | `list_change_impact_backlog` фильтрует по `not exists (impact_runs where change_request_id = …)` — расчёт уже произошёл, независимо от исхода; DB5 файл 27 §4 «blocked исчезает из очереди» |
| stale_state retryable, transient failure — bounded retry, permanent invalid input — durable operator failure | `runner.ts` `calculateOne()` — три раздельные ветки (см. §6.2) |
| Один яд не блокирует остальные | `runner.ts` — `try/catch` внутри цикла по заданиям, не вокруг всего прохода; DB5 файл 27 §8(b)-(c); юнит-тест «one poison item does not block the next» |
| Два параллельных воркера → один исход | `tests/db5/run-concurrency.zsh` (V1 Impact блок) |
| Restart/replay без дублирования | `tests/db5/30_restart_replay.sql` (V1 Impact блок) |
| Пустая очередь — безопасный no-op | Юнит-тест «empty queue is a safe no-op»; `runner.ts` не делает ни одного мутирующего вызова, если план пуст |
| Production-планировщик не добавлен | Ни одного cron/edge-function/scheduled trigger в диффе; запуск — только `npm run worker:change-impact` вручную/из CI |
| `review_change_impact` полностью открыт в V1 по контракту/сервису/адаптеру/рантайм-контрактам/матрице поверхности/одноразовым грантам/UI | `execution-flag.ts` (инкремент 1), `command-service.ts` (авто-починка через снятие из `EXECUTION_INCREMENT_2_COMMANDS`), `m4-surface.ts`, `enable-m4-increment-1.sql`, `project-workspace.tsx` |
| Требуемый текст UI | `lib/i18n/ru.ts`: `coveragePartialWarning` = «Показаны найденные влияния. Анализ ограничен глубиной и не является полным.»; `coverageReviewedCount(reviewed, total)` = «Рассмотрено найденных влияний N/N»; `coverageBlockedWarning(bound)` = «Обнаружено не менее {bound} влияния. Сузьте изменение.» — все три через `lib/i18n/ru.ts`, ни одной строки инлайн в компоненте |
| AP5: реальная браузерная цепочка, реальный воркер, отдельная сессия архитектора, недостижимость воркерной двери | `tests/ap5/02-kora-chain.spec.ts` звенья 12–13, §5 ниже |

## 5. Поверхность команд и RPC V1 Impact

| Имя | Роль-исполнитель | Тип | Инкремент/состояние | Достижимо из |
|---|---|---|---|---|
| `projectceo_m4_api.calculate_change_impact_policy_bound` | `service_role` только | системная (не команда) | всегда, воркером | `list_change_impact_backlog` → воркер |
| `projectceo_m4_api.list_change_impact_backlog` | `service_role` только | системная (не команда) | всегда, воркером | воркер напрямую |
| `projectceo_m4_api.record_change_impact_worker_failure` | `service_role` только | системная (не команда) | всегда, воркером | воркер при отказе |
| `projectceo_m4_api.redrive_change_impact_worker_failure` | `service_role` только | системная (не команда), операторская дверь | всегда, вручную | оператор напрямую (скрипт/SQL), НЕ UI |
| `review_change_impact` | `authenticated` (роль `architect`/`site_manager` через capability) | человеческая команда | инкремент 1 (перенесена DEC-033; была закрыта до) | `command-service.ts` → UI, открывается `enable-m4-increment-1.sql` в одноразовой среде |
| `replay_review_change_impact` | `authenticated` | человеческая команда (replay) | инкремент 1 | то же |
| `projectceo_m4_api.calculate_change_impact` (старая, с произвольной глубиной) | НИКТО | закрыта | — | недостижима: `execute` отозван даже у `service_role` |

Постоянные миграции не выдают `authenticated`/`anon` прав ни на одну из
четырёх системных функций ни при каких условиях — единственный путь
`authenticated` к воркерным дверям — их отсутствие. `review_change_impact`/
`replay_review_change_impact` доступны `authenticated` только после
одноразового `enable-m4-increment-1.sql` (не production-флаг, см. DEC-029) —
до него обе закрыты default-deny, как и весь остальной инкремент 1.

Классификация non-command функций для матрицы поверхности —
`M4_NON_COMMAND_FUNCTIONS` в `lib/project-intelligence/delivery/projectceo/m4-surface.ts`,
проверяется `tests/db5/10_schema_security.sql` (RPC-перепись) и
`tests/db4/08_m4_surface_classification.sql`.

## 6. Воркер: операционный runbook

### 6.1 Запуск

```bash
NEXT_PUBLIC_SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CHANGE_IMPACT_WORKER_MAX_ROWS=100 \
CHANGE_IMPACT_WORKER_MAX_ATTEMPTS=5 \
npm run worker:change-impact
```

Обе переменные окружения опциональны (`maxRows` по умолчанию 100 — верхняя
граница одного прохода поверх серверного ограничения в 1000 строк;
`maxAttempts` по умолчанию берётся сервером — 5 попыток до dead-letter).
Учётные данные — `SUPABASE_SERVICE_ROLE_KEY`, потому что и очередь, и расчёт
выданы исключительно `service_role`: воркер не может и не должен работать под
человеческой сессией.

Отчёт печатается в stdout одной JSON-строкой ВСЕГДА, включая пустую очередь —
«ничего не нашёл» и «не запускался» обязаны различаться в логе:

```json
{"worker":"change-impact","scanned":0,"calculated":0,"alreadyPresent":0,
 "staleState":0,"failureRecorded":0,"deadLettered":0,"items":[]}
```

`items[]` содержит `projectId`/`changeRequestId`/`outcome` и, если
`outcome === "calculated"`, `coverageStatus` — не PII, безопасно логировать.

### 6.2 Классификация исходов одного задания

| Ошибка от RPC | Исход воркера | Засчитывается как попытка? |
|---|---|---|
| Успех | `calculated` | — |
| `idempotency_conflict` (тот же ключ, другой запрос) | `already_present` | нет |
| `P1110` / `unsupported_source` (уже посчитано под другим ключом — один ChangeRequest, один прогон) | `already_present` | нет |
| `stale_state` (состояние проекта сдвинулось между чтением очереди и расчётом — нормальный исход гонки) | `stale_state` | **нет** — не пишет в `impact_worker_failures`, следующий проход перечитает очередь заново |
| любая другая ошибка (включая `not_found` на сорванной ссылке на baseline) | `failure_recorded` либо `dead_lettered` | да, через `record_change_impact_worker_failure` |

### 6.3 Bounded retry, dead-letter, redrive

`record_change_impact_worker_failure(project_id, change_request_id,
failure_code, max_attempts default 5)` — upsert на
`(organization_id, project_id, change_request_id)`: увеличивает
`attempt_count`, ставит `dead_lettered = (attempt_count >= max_attempts)`.
После dead-letter заявка перестаёт возвращаться из
`list_change_impact_backlog` (там прямое исключение по
`f.dead_lettered = true`) — терминально, автосброса нет.

Возврат из dead-letter — только `redrive_change_impact_worker_failure(project_id,
change_request_id)`: сбрасывает `attempt_count = 0`, `dead_lettered = false`.
Это операторская дверь, не часть цикла воркера и не UI-кнопка — вызывается
вручную (SQL/скрипт) при устранении первопричины (например, восстановлении
сорванной ссылки на baseline).

### 6.4 Гарантии, которые не нужно проверять руками при каждом запуске

Уже проверены DB5 (§4 ниже) для обеих версий PostgreSQL и не требуют ручной
регрессии на каждый прогон: один поломанный элемент очереди не блокирует
остальные (обработка внутри цикла по заданиям, не вокруг всего прохода); два
параллельных воркера на одной заявке дают один исход (второй получает либо
`replay`, либо `already_present`); перезапуск/повтор не создаёт дубликат
(идемпотентный ключ выводится из заявки, не из времени/случайности); пустая
очередь — ни одного мутирующего вызова.

### 6.5 Production-планировщик

Не добавлен намеренно и явным решением OWNER GO. Воркер запускается процессом
(`npm run worker:change-impact`), а не HTTP-запросом или cron-триггером —
человеческой поверхности не создаёт и производственного расписания в этом
этапе нет.

## 7. Алгоритм: обоснование выбора

Обход — явный PL/pgSQL-цикл по глубине с временной таблицей
`pg_temp.impact_frontier` (PRIMARY KEY на паре «изменённый узел, достигнутый
узел» — истинное глобальное множество посещённых), а не рекурсивный CTE:
`WITH RECURSIVE` в PostgreSQL открывает self-reference только на результат
ПРЕДЫДУЩЕЙ итерации («working table»), а не на всю накопленную историю —
anti-join внутри рекурсивного терма не может корректно запретить повторное
открытие уже посещённого узла с более длинного пути на ромбовидном графе
зависимостей, что даёт path explosion ещё до дедупликации. Явный цикл
ограничивает работу O(узлы × глубина), не O(путей), и выполняется РОВНО один
раз до `maxDepth + 1` — этой одной границы достаточно и для подсчёта, и для
зонда «есть ли что-то за пределами глубины» одновременно, второй полный
обход не нужен.

Построение путей для итогового JSON изначально использовало коррелированный
подзапрос к `graph_edges` на каждую возвращаемую impact-строку — на графах,
близких к границе лимита (тысячи impacts), это занимало от 12 до 142 секунд.
Обнаружено и исправлено в рамках этого этапа: `row_number() over ()` на CTE
`reconstructed`, затем один set-based join
(`cross join lateral unnest(...) with ordinality` + один join на
`graph_edges`) и агрегация путей одним проходом, соединённая обратно по
`rn`. Замена превращает O(строки × длина пути) отдельных запросов в один
join + group by. Регрессия по времени поймана `26_impact_policy_benchmark.sql`
(ceiling, не тонкая настройка — файл специально не гонится за точным числом).

## 8. Доказательство этапа

Все пункты ниже выполняются на PostgreSQL 16 И 17 (`tests/db5/run.zsh` под
оба образа), с `ANALYZE` после построения фикстур и на ветвящемся (не
звездообразном) графе, где это существенно для проверки глубины.

| Доказываемое | Где |
|---|---|
| `complete` на границе глубины (chain-7) | `27_impact_coverage_outcomes.sql` §1 |
| `partial_depth` (chain-10, новый различимый impact за `maxDepth`) | §2 |
| Ровно 5000 → не блокирует | §3 |
| Ровно 5001 → `blocked_result_limit`, `returnedImpactCount=0`, `knownImpactCountLowerBound=5001` | §4 |
| Blocked исчезает из backlog | §4 (следом) |
| Совмещённый cutoff → побеждает лимит | §5 |
| Policy/coverage в digest и replay (тот же `expected_state_revision`, тот же ключ → `replay=true`, поля покрытия байт-идентичны) | §6 |
| Append-only неизменяемость (`UPDATE`/`DELETE` на `impact_runs`/`impacts` → `object_not_in_prerequisite_state`) | §7 |
| Один яд не блокирует очередь; dead-letter на 5-й попытке; redrive возвращает заявку в backlog | §8 |
| `partial_depth` после ревью ВСЕХ показанных карточек остаётся `impactReviewComplete=false` | §9 |
| Детерминированность (`SAVEPOINT`/`ROLLBACK TO` на ОДНОМ change_request_id, пересчёт с нуля даёт тот же `resultHash`) | `26_impact_policy_benchmark.sql` |
| Честный сигнал усечения, время расчёта в разумных пределах на реальной RPC (не fine-tune, а regression ceiling) | `26_impact_policy_benchmark.sql` |
| Два параллельных воркера → один исход | `run-concurrency.zsh` (V1 Impact блок) |
| Перезапуск/повтор → без дубля | `30_restart_replay.sql` (V1 Impact блок) |
| Старая RPC с произвольной глубиной недоступна `service_role` | `90_default_deny_after.sql` `DB5_RAW_IMPACT_RPC_REACHABLE_BY_SERVICE_ROLE_AFTER_RUN`; `05_default_deny_before.sql` — тот же список до прогона |
| `anon`/`authenticated` не получают ни одной из 4 системных дверей | `06_execution_test_role.sql`, `90_default_deny_after.sql` |
| RPC-перепись (census) включает все новые функции, счёт обновлён | `10_schema_security.sql` |
| DB4: закрытая/открытая поверхность после `enable-m4-increment-1.sql` корректна для обеих команд V1 Impact | `07_m4_execution_boundary.sql`, `08_m4_surface_classification.sql`, `38_m4_execution_guardrail.sql` |
| Юнит-тесты воркера (13 сценариев: пустая очередь, расчёт, отсутствие дубля, конкурентный победитель, already-calculated, stale_state без записи попытки, bounded retry, dead-letter, redrive, один яд не блокирует соседа, нарушение контракта конверта — бросает) | `tests/projectceo-integration/change-impact-worker.test.ts` |
| AP5 звено 12: настоящий воркер (не мост) считает влияние; повторный запуск воркера — no-op; АРХИТЕКТОР отдельной аутентифицированной сессией открывает результат; ветвление по фактическому исходу (`complete`/`partial_depth`/`blocked_result_limit`); ревью всех impacts не выдаёт себя за завершённость на `partial_depth`; `blocked_result_limit` — 0 impacts, действия ревью недоступны | `tests/ap5/02-kora-chain.spec.ts` |
| AP5 звено 13: воркерная дверь недостижима напрямую через Data API живого проекта тем же anon key, каким ходит браузер (401/403/404) | `tests/ap5/02-kora-chain.spec.ts` |

## 9. Границы этапа — что НЕ построено

* V2 Field Evidence (`upload_photo_evidence`, `review_photo_evidence`,
  `accept_milestone`, `define_milestone`, `register_handover_document`) и V3
  Handover (`build_handover`, `build_construction_handover`) остаются
  `NOT AUTHORIZED` — этот этап их не открывает, ни одна их RPC не получила
  новых прав.
* Production не включён: `REMHAOS_EXECUTION_ENABLED`/эквивалентный флаг
  приложения не тронут; `enable-m4-increment-1.sql` — одноразовый,
  непроизводственный скрипт (DEC-029), не production-флаг.
* Ни одного нового вызова LLM: расчёт влияния — детерминированный обход графа,
  без обращения к `lib/llm/provider.ts`.
* Production-планировщик воркера не добавлен (см. §6.5) — намеренно, по
  явному ограничению OWNER GO.
* Человеческого override/«принять partial как complete» нет и не
  предполагается в V1.
* Telegram Chat Bridge (DEC-031) этим этапом не затронут.

## 10. Как проверить руками за 5 минут

```bash
npm run lint && npm run typecheck && npm run test && npm run build

# DB5 — полная матрица исходов, оба сервера PostgreSQL:
zsh tests/db5/run.zsh   # смотреть на DB5_IMPACT_COVERAGE_OUTCOMES_OK,
                         # DB5_IMPACT_POLICY_BENCHMARK_OK

zsh tests/db5/run-concurrency.zsh   # DB5_IMPACT_CONCURRENCY_OK

# Воркер локально (нужен работающий Supabase-стек и .env.local):
npm run worker:change-impact
```

Ожидаемый итог: все команды завершаются успешно; на пустой локальной очереди
воркер печатает `{"worker":"change-impact","scanned":0,...}` и не делает ни
одного мутирующего вызова.

## 11. Известные ограничения

1. AP5 не может построить синтетический граф глубиной/шириной, нужной для
   `partial_depth`/`blocked_result_limit`, — приватные схемы
   (`project_intelligence`, `projectceo_m4`) не выставлены в PostgREST даже
   для `service_role`. Поэтому AP5 звено 12 доказывает реальную браузерную
   цепочку (воркер → отдельная сессия архитектора → корректная семантика
   покрытия) для того исхода, который даёт золотой граф Kora Chain
   (`complete`), и явно ветвится по фактическому `coverageStatus`, а не
   предполагает один сценарий. Точные границы 5000/5001 и `partial_depth`
   исчерпывающе доказаны DB5 на PostgreSQL 16 и 17 — на управляемых
   фикстурах, где `session_replication_role=replica` позволяет построить
   ровно нужный граф в обход FK-проверок (CHECK/UNIQUE остаются в силе).
2. `redrive_change_impact_worker_failure` — намеренно без UI: операторская
   дверь возврата из dead-letter вызывается вручную (скрипт/SQL), не кнопкой
   в интерфейсе.
3. `26_impact_policy_benchmark.sql` фиксирует ceiling по времени (регрессия),
   не целевое число — точный порог для конкретного размера графа не
   гарантирован и не должен использоваться как SLA.
