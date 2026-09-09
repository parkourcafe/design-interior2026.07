# M4 V1 Impact — production runbook

Что делать руками, чтобы открыть вертикаль V1 Impact живым пользователям,
убедиться, что она работает, и закрыть её обратно за секунды, если нет.

Основание — `docs/canonical/remhaos-v1/REMHAOS_OWNER_DECISION_M4_V1_PRODUCTION_2026-08-12.md`
(DEC-033). Состояние готовности — `docs/canonical/remhaos-v1/REMHAOS_M4_V1_PRODUCTION_READINESS_AUDIT_2026-08-12.md`.

> **Поправка 2026-09 — К-2 / owner gate.**
> [DEC-038](docs/canonical/remhaos-v1/REMHAOS_OWNER_DECISION_PLATFORM_FOUNDATION_2026-08-24.md)
> установил `ACTIVE_FOR_DISPOSABLE_PILOT`: снят запрет на repository/disposable
> platform foundation, но production adoption остаётся отдельным гейтом.
> До любых операций ниже владелец должен предъявить production adoption GO,
> AP6 PASS, Р19 на открытие M3/M4 increment 1 и Р20 на способ входа проекта,
> а также разрешённый доступ и отдельный smoke-проект.
> Дорожная карта называет production adoption решением DEC-040; в проверенном
> журнале baseline `64b23e83` такая запись не найдена — **UNKNOWN**, не GO.
> Подпись Р19/Р20 и исполнение production-операций этим документом не подтверждаются.
> Весь SQL ниже — условный runbook владельца, не выполненные действия.

---

## 0. Что вообще происходит

У выключателя две половины, и ни одна без другой не работает:

- **база** — право `execute` на две RPC у роли `authenticated`
  (`review_change_impact`, `replay_review_change_impact`; третья дверь DEC-033
  закрыта навсегда решением DEC-034, ратифицированным 17.08.2026);
- **приложение** — `REMHAOS_EXECUTION_ENABLED=true`.

Флаг не виден PostgREST, права не видны приложению. Поэтому включать нужно
обе, а выключать достаточно любую — и первой всегда выключают базу.

## 1. Предполётная проверка

В SQL editor производственного проекта:

```sql
-- 1.1 Сверить полный список с утверждённым adoption plan и exact repo ledger.
-- Число строк и наличие только последнего timestamp недостаточны.
select version from supabase_migrations.schema_migrations order by version;

-- 1.2 Выключатель на месте и вертикаль закрыта.
select * from projectceo_m4.v1_impact_production_state();
--     open_now = false, granted_signatures = {}, last_action = null
```

Сверка production migration history и backup/restore receipt — обязательные
предпосылки, не новый приказ применить миграции. Требуются как V1 switch
(`20260812030000` с последующими DEC-034/037), так и module switch
`20260825010000_projectceo_platform_module_switch.sql`. Если доказательства
наличия/состояния не совпали с adoption plan — остановиться.

Р20 выбирает один проверенный путь: (а) опубликованный HTTP enroll-маршрут
после WP-39 с request-bound/CSRF доказательством либо (б) записанный и
подписанный временный операционный порядок. Наличие RPC или локального AP5
bootstrap само по себе не является production GO. На baseline `64b23e83`
нового HTTP enroll-маршрута нет; выбор/подпись Р20 — UNKNOWN.

В GitHub: секреты окружения `production` заданы
(`PRODUCTION_SUPABASE_URL`, `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY`).

## 2. Включение

**Порядок важен: сначала воркер, потом база, потом приложение.** Если открыть
двери раньше воркера, архитектор увидит заявки без прогонов влияния и решит,
что модуль сломан.

```text
2.1  GitHub → Settings → Variables → REMHAOS_M4_V1_PRODUCTION_ENABLED = true
2.2  GitHub → Actions → «change-impact worker» → Run workflow  (первый проход руками)
     Ожидание: зелёное задание, в summary — JSON прохода.
```

```sql
-- 2.3a Только после отдельного Р19: два независимых модуля.
-- Подставить фактические actor/basis из подписанного решения владельца.
select projectceo_platform.open_module_production(
  'm3', '<actor из решения владельца>', '<подписанное Р19 / adoption GO>'
);
select projectceo_platform.open_module_production(
  'm4_increment_1', '<actor из решения владельца>', '<подписанное Р19 / adoption GO>'
);
select * from projectceo_platform.module_production_state('m3');
select * from projectceo_platform.module_production_state('m4_increment_1');
-- Для каждого: open_now=true, фактические signatures и actor/basis
-- соответствуют решению; запись сохранена в module_switch_log.

-- 2.3b V1 отдельно. Подпись и основание обязательны и попадают в журнал.
select projectceo_m4.open_v1_impact_production(
  '<actor из решения владельца>',
  '<подписанное production GO с основанием DEC-033/034/037>'
);

-- 2.4 Проверить, а не поверить.
select * from projectceo_m4.v1_impact_production_state();
--     open_now = true, ровно ДВЕ сигнатуры (review_change_impact,
--     replay_review_change_impact — DEC-034/20260813010000),
--     last_action = 'open'
```

```text
2.5  Только после подтверждённых DB states и GO:
     Vercel → production → REMHAOS_DOCUMENTATION_ENABLED = true,
     REMHAOS_EXECUTION_ENABLED = true → redeploy.
     Проверить точный deployment/commit; нажатие redeploy не является PASS.
```

Операция сама проверяет радиус поражения и падает, ничего не открыв, если
рядом просочилась команда V2/V3 (`PROJECTCEO_M4_V2_V3_LEAKED_BY_V1`), если
воркерный контур оказался доступен человеку
(`..._IMPACT_WORKER_LEAKED_BY_V1`) или если право досталось `anon`
(`..._V1_LEAKED_TO_ANON`). Падение здесь — это успех проверки, а не сбой
включения.

## 3. Живой smoke-test

**Только на отдельном smoke-проекте.** Реальные клиентские проекты в проверке
не участвуют: заявка на изменение — это факт в истории проекта, а не черновик,
и удалить её потом нельзя.

Smoke-проект должен пройти выбранный Р20 путь регистрации и обычную цепочку
M2 handoff → M3 baseline/release → выдача пакета → подтверждение получателем
своей сессией. Предусловия нельзя подменять ручными INSERT в private tables.
В receipt сохранить project/package/release IDs, exact deployment SHA,
command/audit IDs и исходы проверок; без raw tokens и содержимого cookie jars.

Роли берутся настоящие, сессии — разные, вход — обычный магический линк.
Ничего из перечисленного нельзя выполнять service role: системная идентичность
человеческих команд не имеет вовсе (аудит §5).

| # | Что делаем | Чем подтверждается |
|---|---|---|
| 1 | Строитель создаёт заявку на изменение по устаревшей редакции | заявка видна в рабочем пространстве |
| 2 | Ждём проход воркера (≤15 мин) или запускаем задание руками | в summary задания `calculated: 1` |
| 3 | Архитектор открывает заявку | у заявки непустой счётчик влияния, есть карточка |
| 4 | Архитектор выполняет рассмотрение карточки | состояние карточки изменилось, счётчик рассмотренных вырос |
| 5 | Обновляем страницу | результат рассмотрения пришёл клиенту, а не остался в форме |
| 6 | Повторяем рассмотрение той же карточки | отказ; состояние не изменилось |
| 7 | Запускаем воркер ещё раз | `alreadyPresent`, второго прогона нет |
| 8 | Заходим той же ссылкой без сессии | отказ (`anon` не имеет прав) |
| 9 | Заходим сессией участника без роли архитектора | отказ команды, состояние не меняется |

Проверка «неполный результат не получает ложный `complete`» на живом проекте
не воспроизводится: чтобы получить неполноту, нужен граф глубже 7 или шире
5000 влияний, и создавать такой в production специально — значит портить
данные ради теста. Она доказана прогоном на настоящем PostgreSQL 16 и 17
(`tests/db5/26_impact_policy_benchmark.sql`, `29_impact_coverage_dec034.sql`):
звезда шире лимита даёт `blocked_result_limit` с НУЛЁМ сохранённых карточек
(DEC-034: только durable-метаданные), длинная цепочка даёт `partial_depth`,
и ни один из этих исходов не превращается в `complete` — ни рассмотрением
карточек, ни каким-либо подтверждением: двери подтверждения неполноты не
существует.

## 4. Что делать с красным проходом

Задание воркера краснеет ровно в двух случаях, и оба означают «нужен человек»,
а не «система сломалась».

| Что в отчёте | Что это | Что делать |
|---|---|---|
| `blocked > 0` | заявка заблокирована по ширине (`blocked_result_limit`, найдено больше `maxImpacts`): карточек НЕТ, сохранены только durable-метаданные | recovery — **rescope**: новая заявка с более узким набором корней либо против новой baseline (DEC-037 §3.3); при будущем подъёме лимита политики пересчёт произойдёт сам; ручного подтверждения неполноты не существует (DEC-034) |
| `calculatedTruncated > 0` | прогон неполон по глубине (`partial_depth`): возвращённые карточки сохранены | архитектор рассматривает возвращённые карточки; `impactReviewComplete` останется `false` — неполнота покрытия это данные, а не подтверждаемая галочка |
| `unresolved > 0` | у заявки нет разрешимого целевого baseline | смотреть цепочку публикации проекта: заявка может относиться к версии, которой больше нет |

`staleState` и `alreadyPresent` красным не считаются: первое — гонка, которую
следующий проход доберёт сам, второе — нормальный повтор.

Исторический SQL аудита §7.2 с `impact_truncation_acknowledgements`
не является актуальным health gate. Контракт — DEC-034/037:
`coverage_status` (`complete`, `partial_depth`, `blocked_result_limit`),
действующий прогон `superseded_at is null`; неполное покрытие не закрывается
человеческим подтверждением. Поправка исторического аудита ведётся WP-38.

## 5. Откат

Любой рычаг действует сам по себе; первый достаточен.

```sql
-- 5.1 Закрыть двери. Секунды. Отзывает права и у authenticated, и у anon.
select projectceo_m4.close_v1_impact_production(
  'Selena, владелец продукта',
  'причина отката одной строкой'
);
select * from projectceo_m4.v1_impact_production_state();  -- open_now = false
```

```text
5.2  Vercel → REMHAOS_EXECUTION_ENABLED = false → redeploy
     Если rollback GO охватывает M3, REMHAOS_DOCUMENTATION_ENABLED = false.
5.3  GitHub → Variables → REMHAOS_M4_V1_PRODUCTION_ENABLED = false
```

Если по Р19 были открыты M3 / M4 increment 1, V1 rollback сам их не закрывает.
В пределах rollback GO владелец отдельно вызывает
`projectceo_platform.close_module_production('m4_increment_1', actor, basis)`
и, если требуется решением, `projectceo_platform.close_module_production('m3', actor, basis)`,
затем проверяет `module_production_state` для каждого закрываемого модуля.
Нельзя считать V1 switch общим выключателем M3/M4.

Откат не удаляет уже посчитанные прогоны и уже выполненные рассмотрения: это
факты проекта, а не права. Повторное включение застаёт их на месте.

## 6. Если операция отвечает `permission denied`

Выключатель принадлежит `pi_table_owner` и недоступен прикладным ролям. Если
роль подключения не наследует владельца:

```sql
set role pi_table_owner;
select projectceo_m4.open_v1_impact_production('...', '...');
reset role;
```

Если и это не проходит — у подключения нет членства в `pi_table_owner`, и
включать вертикаль этой ролью нельзя. Это не обходится: право открывать модуль
намеренно живёт там же, где право менять его схему.


## Источники поправки 2026-09

- К-2: [DEC-038](docs/canonical/remhaos-v1/REMHAOS_OWNER_DECISION_PLATFORM_FOUNDATION_2026-08-24.md).
- К-5: две V1 сигнатуры уже исправлены в baseline; основание
  [DEC-034/037](docs/canonical/remhaos-v1/REMHAOS_OWNER_DECISION_M4_V1_COVERAGE_AND_RECOVERY_2026-08-17.md).
- Р19/Р20 — [дорожная карта, §3.5 и решения владельца](docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md);
  это запросы на решения, не доказательство их подписи.
- API выключателей: [module switch migration](supabase/migrations/20260825010000_projectceo_platform_module_switch.sql).
