-- Восстановление function-level `statement_timeout = '30s'` на двери
-- `projectceo_product_api.publish_baseline_atomic` (решение владельца
-- 11.10.2026, вариант P-1; диагноз — RW2_AP5_DIAGNOSIS, 11.10.2026).
--
-- История настройки по миграциям (воспроизводимо: tests/db4/98):
--   20260825030000  дверь создана, `set statement_timeout = '30s'` (строки 454–456);
--   20260911160000  дверь пересобрана как обёртка над `_unchecked`, 30s
--                   поставлены заново (строки 91–93);
--   20260925100000  новая 7-аргументная сигнатура, 30s поставлены заново
--                   (строки 335–337);
--   20260928090000  `create or replace function … set search_path = ''`
--                   (строка 328) — `create or replace` записывает proconfig
--                   целиком по определению, и запись `statement_timeout=30s`
--                   ИСЧЕЗЛА. Guard той миграции проверял владельца, но не
--                   proconfig, поэтому потеря прошла незамеченной.
--
-- Следствие. С 28.09 действующий предел двери — не 30 секунд, а ролевые
-- 8 секунд (платформенный `rolconfig`: `authenticator` и `authenticated` —
-- `statement_timeout=8s`; PostgREST исполняет RPC от `authenticator` с
-- `set local role authenticated`). Публикация baseline на графе AP5
-- (5 000 листьев) стоит 6,7–10,9 с и обрывается `57014 canceling statement
-- due to statement timeout` → HTTP 500 (logs/rw/ap5-door-timeout-proof.log).
--
-- Почему именно на двери, а не на внутренней функции. PostgREST читает
-- proconfig только вызываемой RPC-функции и применяет его `set local` до
-- основного statement; `SET statement_timeout` внутри уже идущего statement
-- таймер не перевзводит. 30s на `_publish_baseline_atomic_unchecked` стоят и
-- не действуют — они не меняются.
--
-- ЧТО МИГРАЦИЯ НЕ ДЕЛАЕТ. Не меняет глобальный `statement_timeout`, rolconfig
-- ролей (`authenticator`, `authenticated`, `anon`, `service_role`), тело,
-- сигнатуру, владельца, `security definer`, `search_path` и права двери;
-- не трогает тест AP5 и его пороги. Всё перечисленное зафиксировано guard'ом:
-- снимок свойств до `alter` сравнивается со снимком после.

begin;

create temporary table _p1_door_before on commit drop as
select
  p.proowner,
  p.prosecdef,
  p.proacl,
  p.prolang,
  p.provolatile,
  p.prorettype,
  p.proargtypes,
  p.prosrc,
  array(
    select e from unnest(coalesce(p.proconfig, '{}'::text[])) e
    where e not like 'statement_timeout=%'
    order by e
  ) as config_without_timeout,
  (
    select array_agg(r.rolname order by r.rolname)
    from pg_catalog.pg_roles r
    where r.rolname in ('authenticator', 'authenticated', 'anon', 'service_role')
  ) as roles,
  (
    select array_agg(coalesce(array_to_string(r.rolconfig, ','), '') order by r.rolname)
    from pg_catalog.pg_roles r
    where r.rolname in ('authenticator', 'authenticated', 'anon', 'service_role')
  ) as role_configs,
  current_setting('statement_timeout') as global_timeout
from pg_catalog.pg_proc p
where p.oid = 'projectceo_product_api.publish_baseline_atomic(uuid, text, text, jsonb, bigint, text, text)'::regprocedure;

alter function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, jsonb, bigint, text, text
) set statement_timeout = '30s';

do $guard$
declare
  v_before _p1_door_before%rowtype;
  v_proc pg_catalog.pg_proc%rowtype;
  v_config_without_timeout text[];
  v_role_configs text[];
begin
  select * into v_before from _p1_door_before;
  if not found then
    raise exception 'PROJECTCEO_PUBLISH_BASELINE_DOOR_MISSING';
  end if;

  select p.* into v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'projectceo_product_api.publish_baseline_atomic(uuid, text, text, jsonb, bigint, text, text)'::regprocedure;

  -- Восстановленная настройка.
  if v_proc.proconfig is null
     or not exists (select 1 from unnest(v_proc.proconfig) e where e = 'statement_timeout=30s') then
    raise exception 'PROJECTCEO_PUBLISH_BASELINE_DOOR_TIMEOUT_NOT_SET:%', v_proc.proconfig;
  end if;
  if not exists (select 1 from unnest(v_proc.proconfig) e where e ~ '^search_path=("")?$') then
    raise exception 'PROJECTCEO_PUBLISH_BASELINE_DOOR_SEARCH_PATH_NOT_PINNED:%', v_proc.proconfig;
  end if;
  -- Ровно две записи proconfig: search_path и statement_timeout — ничего лишнего.
  if cardinality(v_proc.proconfig) <> 2 then
    raise exception 'PROJECTCEO_PUBLISH_BASELINE_DOOR_UNEXPECTED_CONFIG:%', v_proc.proconfig;
  end if;

  -- Всё остальное у двери — как до миграции.
  select array(
    select e from unnest(v_proc.proconfig) e where e not like 'statement_timeout=%' order by e
  ) into v_config_without_timeout;
  if v_config_without_timeout <> v_before.config_without_timeout then
    raise exception 'PROJECTCEO_PUBLISH_BASELINE_DOOR_CONFIG_DRIFT:% -> %',
      v_before.config_without_timeout, v_config_without_timeout;
  end if;
  if v_proc.proowner <> v_before.proowner
     or v_proc.proowner::regrole::text <> 'pi_table_owner' then
    raise exception 'PROJECTCEO_PUBLISH_BASELINE_DOOR_OWNER_CHANGED:%', v_proc.proowner::regrole;
  end if;
  if v_proc.prosecdef is distinct from v_before.prosecdef or not v_proc.prosecdef then
    raise exception 'PROJECTCEO_PUBLISH_BASELINE_DOOR_SECURITY_CHANGED';
  end if;
  if v_proc.proacl is distinct from v_before.proacl then
    raise exception 'PROJECTCEO_PUBLISH_BASELINE_DOOR_ACL_CHANGED:% -> %', v_before.proacl, v_proc.proacl;
  end if;
  if v_proc.prolang <> v_before.prolang
     or v_proc.provolatile <> v_before.provolatile
     or v_proc.prorettype <> v_before.prorettype
     or v_proc.proargtypes <> v_before.proargtypes
     or v_proc.prosrc <> v_before.prosrc then
    raise exception 'PROJECTCEO_PUBLISH_BASELINE_DOOR_DEFINITION_CHANGED';
  end if;

  -- Глобальный и ролевые лимиты не тронуты.
  if current_setting('statement_timeout') <> v_before.global_timeout then
    raise exception 'PROJECTCEO_GLOBAL_STATEMENT_TIMEOUT_CHANGED';
  end if;
  select array_agg(coalesce(array_to_string(r.rolconfig, ','), '') order by r.rolname)
    into v_role_configs
  from pg_catalog.pg_roles r
  where r.rolname in ('authenticator', 'authenticated', 'anon', 'service_role');
  if v_role_configs is distinct from v_before.role_configs then
    raise exception 'PROJECTCEO_ROLE_CONFIG_CHANGED:% -> %', v_before.role_configs, v_role_configs;
  end if;
end
$guard$;

commit;
