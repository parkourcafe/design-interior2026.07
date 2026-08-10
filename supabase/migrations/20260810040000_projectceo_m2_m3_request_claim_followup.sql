-- Продолжение 20260801120000: пять точек входа, заведённых ПОСЛЕ того фикса,
-- снова читают актора через auth.uid(). На managed Supabase схема auth
-- принадлежит supabase_admin, у pi_table_owner на неё нет USAGE, и SECURITY
-- DEFINER функция падает с «permission denied for schema auth» — тот же дефект,
-- что описан в AP1_RUNBOOK §2b. Локально он невидим: локальная auth раздаёт
-- права, которых в бою нет.
--
--   projectceo_product_api.submit_m2_client_review          (20260802090000)
--   projectceo_product_api.review_m2_client_submission      (20260802090000)
--   projectceo_product_api.publish_m2_m3_handoff            (20260802090000)
--   projectceo_m3_api.register_documentation_sheet          (20260810010000)
--   projectceo_m3_api.attach_documentation_sheet_specifications (20260810010000)
--
-- Исходные миграции — неизменная история, их текст не правится. Тела функций
-- переписываются здесь тем же способом, что и в 20260801120000: через
-- pg_get_functiondef, без изменения сигнатур, владельцев и грантов.

do $rewrite$
declare
  item record;
  definition text;
begin
  for item in
    select p.oid, p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (
      'project_intelligence',
      'project_intelligence_api',
      'projectceo_foundation',
      'projectceo_api',
      'projectceo_product',
      'projectceo_product_api',
      'projectceo_read_api',
      'projectceo_m3',
      'projectceo_m3_api',
      'projectceo_m4',
      'projectceo_m4_api'
    )
      and p.prokind = 'f'
      and (
        pg_get_functiondef(p.oid) like '%auth.uid()%' or
        pg_get_functiondef(p.oid) like '%auth.jwt()%'
      )
  loop
    definition := pg_get_functiondef(item.oid);
    definition := replace(
      definition,
      'auth.uid()',
      'project_intelligence._request_user_id()'
    );
    definition := replace(
      definition,
      'auth.jwt()',
      'project_intelligence._request_jwt()'
    );
    execute definition;
  end loop;
end
$rewrite$;

-- Fail-fast того же охвата, что и проверка состояния AP1_MANAGED_AUTH_REFERENCE_REMAINS
-- в tests/ap1/environment/verify-db.sql. Список схем здесь шире, чем в guard'е
-- 20260801120000: в него добавлены project_intelligence_api, projectceo_read_api
-- и обе схемы M3, которых на тот момент не существовало.
--
-- auth.users в DDL таблиц (внешние ключи) под запрет не попадает: ссылка на
-- managed-таблицу в ограничении целостности не требует USAGE на схему во время
-- выполнения SECURITY DEFINER функции.
do $guard$
declare
  v_remaining text;
begin
  select string_agg(format('%s.%s', n.nspname, p.proname), ', ' order by n.nspname, p.proname)
  into v_remaining
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in (
    'project_intelligence',
    'project_intelligence_api',
    'projectceo_foundation',
    'projectceo_api',
    'projectceo_product',
    'projectceo_product_api',
    'projectceo_read_api',
    'projectceo_m3',
    'projectceo_m3_api',
    'projectceo_m4',
    'projectceo_m4_api'
  )
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ~ 'auth\.(uid\s*\(|jwt\s*\(|users)';
  if v_remaining is not null then
    raise exception 'PROJECTCEO_MANAGED_AUTH_REFERENCE_REMAINS %', v_remaining;
  end if;
end
$guard$;
