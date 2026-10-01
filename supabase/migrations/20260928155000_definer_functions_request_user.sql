-- Чистый bootstrap на настоящем Supabase (находка 28.09, блокер B2).
--
-- Функции SECURITY DEFINER выполняются с правами владельца. Семь функций,
-- принадлежащих pi_table_owner, брали пользователя через auth.uid(). На
-- настоящем Supabase у pi_table_owner нет USAGE на схему auth: владелец схемы —
-- supabase_auth_admin, и `postgres` не может выдать это право (прежние
-- `grant … on schema auth` в миграциях отрабатывали предупреждением «no
-- privileges were granted»). Вызов падал с «permission denied for schema auth»:
--   * удаление аккаунта: request/cancel/get_account_retention_status;
--   * export_passport_revisions;
--   * remhaos_channel_api.create_identity_link_intent (Telegram);
--   * две функции реестра интеграций.
-- DB4 (суперпользователь) этого не видит.
--
-- Правка: вместо auth.uid() — project_intelligence._request_user_id()
-- (20260801130000), который читает тот же sub из JWT запроса без доступа к
-- схеме auth и уже используется остальными функциями ProjectCEO. Тела
-- функций переписываются из их текущего определения (pg_get_functiondef) с
-- единственной заменой; `create or replace` сохраняет владельца и права.
-- Жёсткие проверки: переписываются ровно эти семь функций, и после правки ни
-- одна функция pi_table_owner с SECURITY DEFINER не обращается к auth.uid().

begin;
set local check_function_bodies = on;
-- Имена функций в проверках — всегда со схемой.
set local search_path = '';

do $rewrite$
declare
  v_expected text[] := array[
    'public.request_account_deletion(text)',
    'public.cancel_account_deletion(text)',
    'public.get_account_retention_status()',
    'public.export_passport_revisions()',
    'remhaos_channel_api.create_identity_link_intent(bytea,integer)',
    'remhaos_integration._authorize_organization_human(uuid,text)',
    'remhaos_integration_api.list_available_integration_providers()'
  ];
  v_found text[];
  v_fn record;
  v_def text;
begin
  select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}')
    into v_found
  from pg_catalog.pg_proc p
  where p.prosecdef
    and pg_catalog.pg_get_userbyid(p.proowner) = 'pi_table_owner'
    and p.prosrc ~ '\mauth\.uid\(\)';

  if (select array_agg(x order by x) from unnest(v_found) x)
     is distinct from (select array_agg(x order by x) from unnest(v_expected) x) then
    raise exception 'DEFINER_AUTH_UID_SET_CHANGED: %', v_found;
  end if;

  for v_fn in
    select p.oid from pg_catalog.pg_proc p
    where p.oid::regprocedure::text = any (v_expected)
  loop
    v_def := pg_catalog.pg_get_functiondef(v_fn.oid);
    v_def := replace(v_def, 'auth.uid()', 'project_intelligence._request_user_id()');
    execute v_def;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_proc p
    where p.prosecdef
      and pg_catalog.pg_get_userbyid(p.proowner) = 'pi_table_owner'
      and p.prosrc ~ '\mauth\.'
  ) then
    raise exception 'DEFINER_AUTH_REFERENCE_REMAINS';
  end if;
end
$rewrite$;

commit;
