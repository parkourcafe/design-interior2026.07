# M4 V1 Impact — аудит готовности к production

**Дата:** 12.08.2026.
**Основание:** OWNER DECISION 12.08.2026 / DEC-033.
**Кодовая база:** `main` на `e4731947007308d4f3e947067e67eddc07362639` плюс
настоящая релизная ветка.
**Итог:** вертикаль **готова к включению**, но **не включена**: три предпосылки
из §1, §7 и §8 не закрыты и требуют владельца.

Аудит отвечает на восемь вопросов ровно в том порядке, в каком они заданы, и
не подменяет «проверено» на «предполагается». Там, где проверить не удалось,
написано, почему именно.

---

## 1. Применены ли необходимые миграции в production

**Не проверено. Нет доступа.**

Производственный проект Supabase — `ztnycrchwxqczqbyegnp` (`design2026`);
идентификатор виден в проверке `Supabase Preview` на PR (она указывает на
`https://supabase.com/dashboard/project/ztnycrchwxqczqbyegnp/branches`) и
зафиксирован в
`docs/product-intelligence/wave-4/ap1/SUPABASE_AUTH_PROTECTED_ROUTES_REPORT.md`.

Сессия, готовившая релиз, обращается к Supabase от учётной записи, которой
этот проект не принадлежит: запрос к нему отвечает
`You do not have permission to perform this action`. Видны три посторонних
проекта (`bali-privilege`, `parkourcafe@gmail.com's Project`, `mydoki`); ни в
одном нет схем `projectceo_*` — это не базы RemHaOS.

Следствие: **нельзя утверждать ни что миграции применены, ни что нет.**
Наличие проверки `Supabase Preview` говорит, что интеграция Supabase ↔ GitHub
в репозитории настроена, то есть механизм доставки миграций существует; но её
состояние на production этой сессии не видно.

**Что должен сделать владелец перед включением** (SQL editor производственного
проекта):

```sql
-- Последняя применённая миграция обязана быть 20260812030000.
select version from supabase_migrations.schema_migrations order by version desc limit 5;
```

Ожидаемый хвост: `20260812010000`, `20260812020000`, `20260812030000`.
Если `20260812030000` отсутствует — выключателя в базе нет, и включать нечего.

## 2. Задеплоен ли change-impact worker

**До этой ветки — нет, и запускать его было нечему.** Воркер существовал как
команда `npm run worker:change-impact` (`scripts/run-change-impact-worker.ts`),
которую кто-то должен был набрать руками. Ни `vercel.json` с cron, ни
scheduled workflow, ни очереди в проекте не было — единственный workflow
репозитория был `ci.yml`.

**После этой ветки** воркер запускается заданием
`.github/workflows/worker-change-impact.yml`. Оно **выключено по умолчанию**:
шаг не исполняется, пока переменная репозитория
`REMHAOS_M4_V1_PRODUCTION_ENABLED` не равна строке `true`. Слияние ветки в
production не ходит.

То же касается и второго воркера продукта — Release Artifact Worker (DEC-030):
production-расписания у него по-прежнему нет. Настоящий релиз его не трогает,
и это не упущение, а граница объёма: DEC-033 — про V1 Impact.

## 3. Что запускает обработку очереди

| | Механизм | Периодичность |
|---|---|---|
| Основной | GitHub Actions `schedule` | каждые 15 минут |
| Ручной | `workflow_dispatch` того же задания | по требованию |
| Аварийный | `npm run worker:change-impact` с production-окружением | руками |

Почему расписание, а не HTTP-маршрут: воркер ходит `service_role`, то есть
идентичностью, обходящей RLS. HTTP-дверь к ней охранялась бы только заголовком
с секретом — одна ошибка в проверке, и обход RLS доступен извне. У расписания
такой поверхности нет вовсе. Vercel Cron отвергнут по тому же доводу плюс
второму: он вызывает маршрут приложения, то есть сначала пришлось бы этот
маршрут завести.

Гонка безопасна независимо от механизма: ключ идемпотентности выводится из
заявки на изменение, и два параллельных прохода дают ровно один прогон и одну
командную запись (`tests/db5/run-concurrency.zsh`, фаза 2).

## 4. Environment variables

### 4.1 Приложение (Vercel, production)

| Переменная | Нужна для | Состояние |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | всё приложение | должна быть задана давно; сессией не проверялась |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | клиентские сессии | то же |
| `SUPABASE_SERVICE_ROLE_KEY` | серверные маршруты | то же |
| `PROJECTCEO_TOKEN_SECRET` | приглашения ProjectCEO | то же |
| **`REMHAOS_EXECUTION_ENABLED`** | **вторая половина выключателя M4** | **должна стать `true` при включении; сравнение со строкой буквальное — `1` читается как «выключено»** |

### 4.2 Задание воркера (GitHub Actions, окружение `production`)

| Имя | Тип | Назначение |
|---|---|---|
| `PRODUCTION_SUPABASE_URL` | secret | адрес производственного Supabase |
| `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` | secret | системная идентичность воркера |
| `REMHAOS_M4_V1_PRODUCTION_ENABLED` | variable | `true` включает расписание |
| `IMPACT_WORKER_MAX_ROWS` | variable, необязательна | размер прохода, по умолчанию 100 |

Ни один из этих секретов сессии недоступен и ею не задавался. Задание падает с
понятным сообщением, если секрет пуст, — отдельным шагом до запуска воркера.

## 5. Какие роли получают каждую RPC

Снято с чистого кластера, где применены **только миграции репозитория** — то
есть ровно то, что получает production до вызова выключателя.

| RPC | `anon` | `authenticated` | `service_role` |
|---|---|---|---|
| `projectceo_m4_api.get_execution_delivery` | — | **да** | — |
| `projectceo_m4_api.calculate_change_impact` | — | — | **да** |
| `projectceo_m4_api.calculate_change_impact_policy_bound` | — | — | **да** |
| `projectceo_m4_api.list_change_impact_backlog` | — | — | **да** |
| `projectceo_m4_api.build_construction_handover` | — | — | **да** |
| `projectceo_product_api.build_release_artifact` | — | — | **да** |
| `projectceo_product_api.list_release_artifact_backlog` | — | — | **да** |
| `review_change_impact`, `replay_review_change_impact`, `acknowledge_impact_truncation` | — | — | — |
| `submit_change_request`, `replay_submit_change_request` | — | — | — |
| `distribute_release`, `acknowledge_release` и их `_request_bound` | — | — | — |
| `register_photo_evidence`, `review_photo_evidence`, `accept_milestone`, `define_milestone`, `register_handover_document` и их `replay_*` | — | — | — |

**После вызова `open_v1_impact_production`** к колонке `authenticated`
добавляются ровно три строки: `review_change_impact`,
`replay_review_change_impact`, `acknowledge_impact_truncation`. Больше ничего
не меняется — операция это проверяет и падает, если изменилось.

Внутри вертикали право ещё раз сужается ролью: команду принимает
`command-service.ts`, а RPC требует capability архитектора. Право `execute` —
условие необходимое, но не достаточное.

## 6. Не получают ли `anon` и `service_role` лишнего

**`anon` — ничего.** Ни одной RPC модуля 4 ни до, ни после включения.
Выключатель падает с `PROJECTCEO_M4_V1_LEAKED_TO_ANON`, если право у `anon`
обнаружится.

**`service_role` — ровно воркерный контур** (таблица §5) и **ни одной
человеческой команды**. Это существенно: системная идентичность не может
рассмотреть влияние за архитектора. Проверяется до и после цепочки
(`tests/db5/05_default_deny_before.sql`, `90_default_deny_after.sql`).

**Сам выключатель** недостижим всем трём ролям: `execute` отозван, схема
`projectceo_m4` в Data API не входит. Проверяется шагом 0 сценария
`tests/db5/28_v1_production_switch.sql`.

**Прямого доступа к таблицам нет ни у кого:** все таблицы `projectceo_m4` —
владелец `pi_table_owner`, RLS с `force`, права отозваны у прикладных ролей
(`tests/db5/10_schema_security.sql`).

## 7. Мониторинг, логи и неразрешимые задания

### 7.1 Что считается сигналом

| Исход прохода | Код возврата | Что значит |
|---|---|---|
| `calculated` | 0 | посчитано целиком |
| `already_present` | 0 | прогон уже был; повтор ничего не создал |
| `stale_state` | 0 | гонка; следующий проход доберёт сам |
| `calculated_truncated` | **1** | частичный прогон — ждёт подтверждения архитектора |
| `unresolved` | **1** | baseline не разрешается — нужен человек |

Красное задание в GitHub Actions **и есть** уведомление: отдельного канала
мониторинга у проекта нет, и заводить его в этом релизе не нужно. Отчёт
прохода печатается всегда (в том числе на пустой очереди) и кладётся в summary
прогона: в нём только идентификаторы и счётчики — ни имён, ни контактов, ни
текста причины изменения.

### 7.2 Здоровье очереди одним запросом

```sql
set role pi_table_owner;  -- таблицы под force RLS; политика — только владельцу

select
  request.project_id,
  request.change_request_id,
  request.requested_at,
  run.impact_run_id,
  run.is_truncated,
  run.truncation_reason,
  (ack.acknowledgement_id is not null) as truncation_acknowledged
from projectceo_m4.change_requests request
left join projectceo_m4.impact_runs run
  on run.organization_id = request.organization_id
 and run.project_id = request.project_id
 and run.change_request_id = request.change_request_id
left join projectceo_m4.impact_truncation_acknowledgements ack
  on ack.organization_id = run.organization_id
 and ack.project_id = run.project_id
 and ack.impact_run_id = run.impact_run_id
where run.impact_run_id is null                       -- не посчитано
   or (run.is_truncated and ack.acknowledgement_id is null)  -- посчитано частично и не подтверждено
order by request.requested_at;
```

Пустой ответ = очередь здорова. Строка, висящая дольше двух проходов (30
минут), — повод смотреть логи задания.

### 7.3 Неразрешимые задания

`unresolved` означает, что у заявки нет разрешимого целевого baseline: расчёт
невозможен, и следующий проход этого не исправит. Воркер такие заявки **не
трогает повторно вслепую** — он честно считает их в `needsAttention` и красит
задание. Разбор — человеческий: либо заявка относится к версии, которой больше
нет, либо цепочка публикации оборвана.

Усечённый прогон — не отказ и не потеря: он сохранён с признаками
(`is_truncated`, `truncation_reason`, `calculated_depth`, `policy_max_depth`),
доступен для рассмотрения и **не может закрыть заявку**, пока архитектор явно
не подтвердит неполноту. Клиенту при этом никогда не показывается `complete`.

### 7.4 Журнал переключений

`projectceo_m4.production_switch_log` — кто, когда, на каком основании открыл
или закрыл вертикаль, с фактическими сигнатурами. Состояние одним запросом:

```sql
select * from projectceo_m4.v1_impact_production_state();
```

Функция читает **права из базы**, а не последнюю запись журнала: журнал
говорит, что собирались сделать, права — что есть на самом деле, и расхождение
между ними само по себе находка.

## 8. Немедленный откат

Три независимых рычага, каждый действует сам по себе. Первый — основной.

| # | Действие | Команда | Время |
|---|---|---|---|
| 1 | Закрыть двери в базе | `select projectceo_m4.close_v1_impact_production('<кто>', '<причина>');` | секунды |
| 2 | Выключить модуль в приложении | `REMHAOS_EXECUTION_ENABLED=false` в Vercel + redeploy | минуты |
| 3 | Остановить воркер | переменная репозитория `REMHAOS_M4_V1_PRODUCTION_ENABLED=false` | секунды |

Рычаг 1 достаточен сам по себе: без прав в базе команда не проходит ни через
приложение, ни в обход него через PostgREST. Рычаги 2 и 3 закрывают
поверхность и останавливают фоновую работу.

Откат **проверен прогоном**, а не описан: `tests/db5/28_v1_production_switch.sql`
закрывает открытую вертикаль, убеждается, что права исчезли у `authenticated`
**и** у `anon`, что функция состояния это видит, и что закрытие попало в
журнал. Прогон идёт в обязательном CI на PostgreSQL 16 и 17.

Чего откат **не** делает: не удаляет уже сохранённые прогоны влияния и
рассмотрения. Это правильно — они факты, а не права.

## 9. Что остаётся незакрытым

| # | Препятствие | Кто снимает |
|---|---|---|
| 1 | `PLATFORM_FOUNDATION = BLOCKED` — A6 §7 и DEC-025 запрещают `M4_PRODUCTION_ENABLED` раньше его снятия | владелец, отдельной записью |
| 2 | Вход вертикали в production недостижим: `enroll_organization_project` без HTTP-маршрута, публикация baseline и `submit_change_request` закрыты | владелец: расширить GO или записать операционный порядок |
| 3 | Нет доступа к производственной базе и секретам | владелец |

Пункты 1 и 2 — не технические: код к ним готов. Пункт 3 — причина, по которой
живой smoke-test в этом релизе не выполнен.


## Поправка 2026-09 к §7.2 — контракт покрытия

[ИЗВЛЕЧЕНО] SQL и критерий здоровья очереди в §7.2 отражают историческое
состояние и больше не являются актуальной проверкой. По DEC-034/DEC-037
покрытие определяется `projectceo_m4.impact_runs.coverage_status`:
`complete`, `partial_depth`, `blocked_result_limit`. При выборе действующего
прогона учитывается `superseded_at is null`; вытесненные прогоны сохраняются
как история.

[ИЗВЛЕЧЕНО] `is_truncated`/`truncation_reason` сохраняются как совместимые
диагностические поля, но не заменяют `coverage_status`.
`impact_truncation_acknowledgements` не является действующим механизмом
закрытия неполного покрытия. Человеческая операция
`acknowledge_impact_truncation` остаётся недоступной (`operation_unavailable`).

[ИЗВЛЕЧЕНО] Рассмотрение всех возвращённых карточек
(`allReturnedImpactsReviewed`) и полное покрытие (`coverageComplete`) —
разные условия. `impactReviewComplete` требует обоих. `partial_depth` не
закрывает рассмотрение даже после ревью всех показанных карточек;
`blocked_result_limit` не предоставляет карточек для ревью и требует
сужения изменения. Системный пересчёт blocked-прогона устаревшей политики
регулируется DEC-037 и не является человеческим override.

[ИНТЕРПРЕТИРОВАНО] Поэтому пустой результат исторического запроса §7.2
нельзя использовать как доказательство здоровья очереди или готовности
production.

[ИЗВЛЕЧЕНО] Основания:
`REMHAOS_OWNER_DECISION_M4_V1_COVERAGE_AND_RECOVERY_2026-08-17.md` (DEC-037),
`supabase/migrations/20260817010000_projectceo_m4_v1_impact_recovery_dec037.sql`
(`review_change_impact`, поверхность чтения и отбор активного прогона),
`tests/ap5/02-kora-chain.spec.ts` (звенья 12–15).
