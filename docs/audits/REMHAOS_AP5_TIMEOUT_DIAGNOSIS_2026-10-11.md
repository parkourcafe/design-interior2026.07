# RW-2 — AP5, шаг 15 «blocked_result_limit»: диагностика тайм-аута

Дата: 2026-10-11 (UTC). Стенд: одноразовый стек AP5 по рецепту CI
(`supabase/config.toml`, PostgREST v14.14, роль `authenticator`
`statement_timeout=8s`). Все эксперименты — на одноразовых данных AP5;
в рабочем дереве и в production ничего не менялось. Требования теста
(5 000 листьев, `blocked_result_limit`) не ослаблялись.

## 1. Что падает

`tests/ap5/02-kora-chain.spec.ts:926` — команда `publish_baseline`
(RPC `projectceo_product_api.publish_baseline_atomic`) после ingest
широкой звезды из 5 000 листьев отвечает не 200. В журнале базы
(`ap5-db-log-timeout-context.txt`):

```
13:09:22.987 UTC [1706] authenticator@postgres ERROR:  canceling statement due to statement timeout
CONTEXT: … PL/pgSQL function project_intelligence.validate_version_closure() line 65 at IF
         SQL statement "set constraints … immediate"
         PL/pgSQL function project_intelligence._complete_command(…) line 99
         … projectceo_product_api.publish_baseline_atomic(…)
```

Шаг начался в 13:09:14 (посев фикстуры `pi_test_fixture.seed_handoff`),
отказ — через ~8,7 с, а не через 30 с. Тест длился 12,8 с.

## 2. Доказанная причина

### 2.1 Эффективный лимит двери — 8 секунд, а не 30

| Факт | Источник |
|---|---|
| Роль `authenticator` (логин PostgREST): `statement_timeout=8s`, `lock_timeout=8s`; `authenticated`: `8s` | `pg_roles.rolconfig` на стенде |
| PostgREST применяет `proconfig` **вызываемой** функции отдельным statement до основного (как и role/claims — через `set_config(…, true)` в той же транзакции), поэтому таймер основного statement взводится уже новым значением | Поведение доказано прогонами C1/C2 (HTTP 500 → HTTP 200 после `alter function … set statement_timeout`) и полной матрицей с P-1 (§3); документирующий комментарий в `20260813040000` |
| Дверь `projectceo_product_api.publish_baseline_atomic(uuid,text,text,jsonb,bigint,text,text)` в HEAD несёт только `search_path=""` — **без** `statement_timeout` | `pg_proc.proconfig` на стенде; `ap5-door-timeout-proof.log` (door_proconfig) |
| 30 с стоит на внутренней `projectceo_product._publish_baseline_atomic_unchecked` и на другой двери `projectceo_api.publish_version` — PostgREST их не видит, а `SET` внутри уже идущего statement таймер не перевзводит | `pg_proc.proconfig`; тест A/B ниже |

**Откуда потерялся лимит.** Миграция `20260925100000_projectceo_m3_handoff_gate.sql`
(строки 335–337) ставила `set statement_timeout = '30s'` на эту дверь.
Следующая миграция `20260928090000_projectceo_m3_room_handoff_freshness.sql`
(DEC-041 §4) пересоздала дверь через `create or replace function … set search_path = ''`
— `create or replace` заменяет весь набор `proconfig` на тот, что записан в
определении, и прежний `alter function … set statement_timeout` исчез.
Ни один DB4-тест это не ловит: `tests/db4/39_publish_version_door.sql`
проверяет `statement_timeout=30s` только у `projectceo_api.publish_version`.

Дефект присутствует в HEAD `bf705ae` (исходный снимок) и не внесён доработками
ТЗ 08.10: рабочее дерево не трогает ни одну из этих миграций.

### 2.2 Стоимость публикации на стороне базы — 6,7–7,5 с, впритык к 8 с

Профиль вложенных statement'ов (`pg_stat_statements.track=all`, сессионно,
вызов двери откатан; `ap5-nested-profile.txt`), всего 7,47 с:

| Доля | Что | Вызовов |
|---|---|---|
| **5,18 с (69 %)** | RLS-политика `current_user_is_active_member(organization_id)` → `exists(select … from organization_members …)` | **85 228** |
| 2,48 с | `set constraints … immediate` → `validate_version_closure` (три `exists` по 5 000 узлов/рёбер: 1,36 + 0,76 + 0,36 с; тоже под RLS) | 1 |
| 1,27 с | сборка снапшота графа (`jsonb_agg` узлов и рёбер) | 1 |
| 0,98 + 0,95 с | `insert into version_nodes` / `version_edges` (под RLS) | 1 + 1 |
| ~1,0 с | канонизация jsonb (`_canonical_jsonb`, 15 051 вызов) + sha256 | — |
| 0,23 с | `_request_user_id()` | 170 460 |

Политика исполняется **на каждую строку** каждого прохода по
`graph_nodes`/`graph_node_revisions`/`graph_edges`/`version_nodes`/`version_edges`:
`publish_version` — `security definer` от `pi_human_executor`, на таблицах
`force row level security`, а функция политики объявлена
`language sql stable set search_path = ''` — наличие `SET` в определении
запрещает планировщику её инлайнить, поэтому `exists(…)` не превращается в
один хэш-подзапрос, а вызывается 85 тысяч раз по ~61 мкс.

Статистика таблиц графа была свежей за 10 с до отказа (`last_analyze 13:09:13`,
`ap5-stats-evidence.txt`); гипотеза «устаревшая статистика» не подтвердилась и
снята. Конкурентных транзакций не было (`workers: 1`, `fullyParallel: false`).

### 2.3 Воспроизведение и контрольные прогоны (одноразовые данные)

`ap5-door-timeout-proof.log`:

| Прогон | Условия | Результат |
|---|---|---|
| A | psql, логин `authenticator` (8 с), `set local role authenticated` + claims дизайнера, дверь как в HEAD; хост без нагрузки (load 0,14) | успех за **6,70 с** — запас до 8 с всего 1,3 с |
| B | то же + `set local statement_timeout to '30s'` перед вызовом (что эмитирует PostgREST при `proconfig` на двери) | успех за 7,40 с |
| P | как postgres, `track=all`, откат | 7,47 с, профиль выше |
| **C1** | **настоящий HTTP-путь**: `POST /rest/v1/rpc/publish_baseline_atomic` через kong/PostgREST с JWT дизайнера, дверь как в HEAD | **HTTP 500 `57014 canceling statement due to statement timeout` за 8,03 с** — идентично отказу шага 15 |
| **C2** | то же после `alter function … set statement_timeout = '30s'` на одноразовой базе + `notify pgrst, 'reload schema'` | **HTTP 200 за 10,89 с**, версия №4 опубликована; в `pg_stat_statements` появился `set local statement_timeout to '30s'` |

Вывод: даже на пустом хосте путь через PostgREST (10,9 с) не укладывается в
8 с; под нагрузкой теста (Next.js + Chromium + Postgres на 4 vCPU) — тем более.
Отказ детерминирован условиями среды, а не случайностью.

## 3. Сравнение снимков при одинаковых условиях

Условия: тот же хост (4 vCPU, 16 ГБ), стек поднят заново для каждого прогона,
один worker Playwright, перед запуском load < 0,5, других тяжёлых процессов нет.

| Снимок | Байты | load до/после | Матрица AP5 | Шаг 15 | Где отказ |
|---|---|---|---|---|---|
| Исправленный (рабочее дерево, снимок 05) | HEAD `bf705ae` + доработки | 0,25 → 1,57 | 29 passed / 1 failed / 1 не запущен (16 зависит от 15) | **FAIL** | `publish_baseline` → 500, тайм-аут 8 с |
| Исходный (HEAD `bf705ae`, чистый, `base-copy`, байты = `snapshots/00-baseline`) | HEAD без доработок | 0,22 → 1,43 | 29 passed / 1 failed / 1 не запущен | **FAIL** | тот же: `publish_baseline` → 500; журнал базы 13:40:00.098 UTC `canceling statement due to statement timeout`, CONTEXT `current_user_is_active_member` ← `validate_version_closure` line 65 ← `set constraints … immediate` ← `_complete_command` ← `publish_baseline_atomic`; посев фикстуры шага — 13:39:51.354, то есть отказ через ~8,7 с (`logs/final-ap5-base/db-log-timeout-context.txt`) |
| Исправленный + предложение P-1 (`proposal-copy` = рабочее дерево + миграция `20261011110000_proposal_p1_…` + строка ledger; **не в рабочем дереве**) | снимок 05 + P-1 | 0,65 → 0,66 | **31 passed / 0 failed**, `ap5 exit=0`, `ap5-no-skips exit=0` | **PASS** (шаги 15 и 16 — 21,7 с) | тайм-аутов в журнале базы 0; дверь на стенде несёт `statement_timeout=30s`; самый долгий вызов двери через PostgREST — 11,0 с (`logs/final-ap5-proposal/pgss-door.txt`), то есть > 8 с и < 30 с |

Исходный и исправленный снимки падают одинаково — на одном шаге, в одном месте
стека вызовов, через одинаковое время (~8,7 с от посева фикстуры). Доработки
ТЗ 08.10 на этот отказ не влияют.

Шаг 16 (`blocked_result_limit` после восстановления) отдельно не засчитывается:
он зависит от результата шага 15 и искусственно подготовленное состояние не
является его прохождением.

## 4. Статус AP5

**Не пройден.** Полного зелёного прогона матрицы на исправленном снимке нет.
Причина не в доработках ТЗ 08.10 (см. §2.1, §3) — но это не делает AP5
зачтённым: до зелёного прогона он остаётся непройденным.

## 5. Предложения (отдельно, решение владельца)

Оба — не часть ТЗ 08.10, в рабочее дерево не внесены.

### P-1. Вернуть function-level `statement_timeout = '30s'` на дверь baseline (восстановление утраченного, не новое решение)

Additive-миграция (черновик: `proposal-P1-migration.sql`):

* `alter function projectceo_product_api.publish_baseline_atomic(uuid,text,text,jsonb,bigint,text,text) set statement_timeout = '30s'` — ровно то, что ставила `20260925100000`;
* guard в той же миграции — `proconfig` обязан нести и `search_path=""`, и `statement_timeout=30s`;
* DB4-тест формы двери (по образцу `39_publish_version_door.sql`), чтобы следующий `create or replace` снова не стёр настройку молча;
* строка в `tests/ap1/environment/migration-ledger.sha256`.

Что не меняется: глобальный `statement_timeout`, `rolconfig` ролей, тело
двери, права, тест AP5 и его лимиты. Это возвращает бюджет, который владелец
уже утвердил в `20260813040000` / `20260825030000` / `20260925100000`.
Доказательство эффективности — прогон C2 (§2.3); полный прогон матрицы с P-1
на отдельной копии дерева — см. §3 после его выполнения (строка добавится).

### P-2. Снять 69 % стоимости публикации — политика членства без per-row вызова

Причина доказана профилем (§2.2). Варианты, оба — отдельный ADR:

* (а) переписать политики `*_human_member` вида
  `current_user_is_active_member(organization_id)` в
  `organization_id in (select om.organization_id from project_intelligence.organization_members om where om.user_id = project_intelligence._request_user_id() and om.status = 'active')`
  — планировщик вычисляет подзапрос один раз на statement (hashed SubPlan);
* (б) сделать функцию политики инлайнимой (убрать `SET search_path` из её
  определения, квалифицировав все имена явно — они уже квалифицированы) и
  сохранить `stable`.

Ожидаемый эффект на AP5-графе: публикация ≈ 2–2,5 с вместо 7,5 с. Риск:
политики — часть контракта безопасности (DEC о RLS deny-by-default), нужны
DB4-тесты эквивалентности доступа до/после. Без P-1 P-2 сам по себе
бюджет не восстанавливает — он лишь увеличивает запас.

## 6. Файлы доказательств (`logs/rw/`)

`ap5-door-timeout-proof.log`, `ap5-nested-profile.txt`, `ap5-pgss-top.txt`,
`ap5-db-log-timeout-context.txt`, `ap5-stats-evidence.txt`, `ap5-explain.log`,
`ap5-graph-sizes.txt`, `publish_baseline_door_live.sql`,
`rls_member_policy_fns.sql`, `version_triggers.sql`, `ap5-fixed/` (прогон
исправленного снимка), `../final-ap5-base/` (прогон исходного снимка).
Секретов, токенов и ПДн в файлах нет (JWT для прогона C выписан локально на
одноразовом стенде и в журнал не записан).

## 7. Актуализация 11.10.2026 — решение владельца: P-1 применён, P-2 не выполняется

**Поправка к формулировкам выше и в ранних сообщениях.** Везде, где отказ шага 15
объяснялся «30-секундным тайм-аутом», читать: *действующий предел — ролевые
8 секунд* (`authenticator`/`authenticated` `statement_timeout=8s`); 30 с у двери не
было с `20260928090000`. Это уже сказано в §1 и §2.1, но здесь зафиксировано явно.

| Шаг | Доказательство | Файл |
|---|---|---|
| История proconfig по миграциям в чистом PG17 | 30s есть после 20260825/0911/0925, исчезает ровно на 20260928090000, возвращается на 20261011110000 | `p1-history-replay-postgres-17-alpine.log` |
| Живая БД до/после (стенд) | до: `{search_path=""}`; после: `{search_path="", statement_timeout=30s}`; owner/definer/ACL/роли без изменений; идемпотентно | `p1-door-before.txt`, `p1-door-after.txt`, `p1-role-limits*.txt`, `p1-stand-apply.log` |
| Миграция | `supabase/migrations/20261011110000_projectceo_publish_baseline_door_timeout.sql` (в рабочем дереве; `proposal-P1-migration.sql` — только черновик, не применялся) | — |
| Проверка настройки | DB4-98 (форма двери; негативный контроль), pre-flight `verify-db.sql` (`publication_door_timeouts=ok`; негативный контроль) | `p1-db4-98-on-stand.log`, `p1-verify-db-on-stand.log`, `../p1/db4-*.log` |
| DB4 PG16 / PG17 | `exit 0`, тест 98 выполнен | `../p1/db4-postgres-16-alpine.log`, `../p1/db4-postgres-17-alpine.log` |
| **Полный AP5 на рабочем дереве, HTTP/Auth** | 31 passed / 0 failed / 0 skipped / 0 flaky; шаг 15 — 24,0 с; дверь через PostgREST: 4 вызова, max 11,5 с; `57014` в журналах базы и приложения — 0 | `../p1/ap5/run.log`, `report.json`, `door-pgss.txt`, `door-state.txt`, `verify-db.log` |

Статус AP5: **пройден на итоговом снимке** (§4 выше описывал состояние до P-1).
