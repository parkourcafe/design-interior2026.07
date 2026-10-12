\set ON_ERROR_STOP on

-- Форма двери публикации baseline: `projectceo_product_api.publish_baseline_atomic`.
--
-- Зачем сценарий. Миграция 20260928090000 пересоздала дверь через
-- `create or replace function … set search_path = ''`, и function-level
-- `statement_timeout = '30s'` (поставленный 20260825 / 20260911 / 20260925)
-- исчез: `create or replace` записывает proconfig целиком по определению.
-- Guard той миграции проверял владельца, но не proconfig — потеря прошла
-- незамеченной, и дверь жила на ролевых 8 секундах `authenticated`, в которые
-- публикация на графе AP5 (5 000 листьев) не помещается (57014 → HTTP 500).
-- Миграция 20261011110000 вернула 30s. Этот сценарий падает, если следующий
-- `create or replace` снова стирает proconfig — или меняет что-то ещё в
-- форме двери: владельца, security definer, search_path, права.

do $db4_publish_baseline_door_shape$
declare
  v_proc pg_catalog.pg_proc%rowtype;
  v_grantee text;
  v_door constant text :=
    'projectceo_product_api.publish_baseline_atomic(uuid, text, text, jsonb, bigint, text, text)';
  v_inner constant text :=
    'projectceo_product._publish_baseline_atomic_unchecked(uuid, text, text, bigint, text, text)';
begin
  select p.* into v_proc
  from pg_catalog.pg_proc p
  where p.oid = v_door::regprocedure;
  if not found then
    raise exception 'DB4_PUBLISH_BASELINE_DOOR_MISSING';
  end if;

  -- Владелец и security definer: дверь исполняет тело от pi_table_owner и
  -- сама решает, кого пускать (`_authorize_project_human`).
  if v_proc.proowner::regrole::text <> 'pi_table_owner' then
    raise exception 'DB4_PUBLISH_BASELINE_DOOR_OWNER:%', v_proc.proowner::regrole;
  end if;
  if not v_proc.prosecdef then
    raise exception 'DB4_PUBLISH_BASELINE_DOOR_MUST_BE_DEFINER';
  end if;

  -- proconfig: ровно две записи — закреплённый search_path и 30s.
  if v_proc.proconfig is null
     or not exists (
       select 1 from unnest(v_proc.proconfig) entry
       where entry ~ '^search_path=("")?$'
     ) then
    raise exception 'DB4_PUBLISH_BASELINE_DOOR_SEARCH_PATH_NOT_PINNED:%', v_proc.proconfig;
  end if;
  -- Function-level statement_timeout (20260825030000, восстановлен
  -- 20261011110000). PostgREST применяет proconfig вызываемой функции до
  -- основного statement — только так публикация baseline на большом графе
  -- переживает ролевые 8 секунд, не растягивая лимит ни роли, ни остальным
  -- запросам. 30s на внутренней `_unchecked` не действуют: они внутри уже
  -- идущего statement.
  if not exists (
       select 1 from unnest(v_proc.proconfig) entry
       where entry = 'statement_timeout=30s'
     ) then
    raise exception 'DB4_PUBLISH_BASELINE_DOOR_TIMEOUT_NOT_PINNED:%', v_proc.proconfig;
  end if;
  if cardinality(v_proc.proconfig) <> 2 then
    raise exception 'DB4_PUBLISH_BASELINE_DOOR_UNEXPECTED_CONFIG:%', v_proc.proconfig;
  end if;

  -- Делегирование, а не копия логики публикации.
  if pg_catalog.pg_get_functiondef(v_proc.oid)
       !~ 'projectceo_product\._publish_baseline_atomic_unchecked' then
    raise exception 'DB4_PUBLISH_BASELINE_DOOR_DOES_NOT_DELEGATE';
  end if;

  -- Права: дверь закрыта всем, кроме `authenticated`, которому её открывает
  -- выключатель M3 (в этой среде — enable-m3-publication.sql харнеса).
  foreach v_grantee in array array[
    'public', 'anon', 'service_role', 'pi_human_executor', 'pi_worker_executor'
  ] loop
    if pg_catalog.has_function_privilege(v_grantee, v_door, 'EXECUTE') then
      raise exception 'DB4_PUBLISH_BASELINE_DOOR_OVERGRANTED:%', v_grantee;
    end if;
  end loop;
  if not pg_catalog.has_function_privilege('authenticated', v_door, 'EXECUTE') then
    raise exception 'DB4_PUBLISH_BASELINE_DOOR_NOT_OPENED_BY_M3_SWITCH';
  end if;

  -- Внутренняя функция недостижима напрямую ни одной клиентской роли.
  foreach v_grantee in array array[
    'public', 'anon', 'authenticated', 'service_role', 'pi_human_executor', 'pi_worker_executor'
  ] loop
    if pg_catalog.has_function_privilege(v_grantee, v_inner, 'EXECUTE') then
      raise exception 'DB4_PUBLISH_BASELINE_INNER_REACHABLE:%', v_grantee;
    end if;
  end loop;
end
$db4_publish_baseline_door_shape$;

-- Что сценарий НЕ доказывает: что настройка действует во время вызова.
-- Таймер statement_timeout взводится в начале statement, и изменение GUC
-- внутри уже идущего statement (в том числе `SET` функции при входе в неё)
-- его не перевзводит — поэтому из psql это проверить нельзя. Действие
-- настройки доказывается только через PostgREST, который ставит proconfig
-- RPC-функции отдельным `set local` ДО основного statement: AP5 через
-- настоящий HTTP/Auth-путь (шаг публикации baseline на графе 5 000 листьев).
