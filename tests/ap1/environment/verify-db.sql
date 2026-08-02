\set ON_ERROR_STOP on

do $verify$
declare
  v_private_runtime_table_grants bigint;
  v_private_runtime_routine_grants bigint;
  v_private_runtime_schema_grants bigint;
  v_bad_executor_roles bigint;
  v_auth_owner_table_grants bigint;
  v_missing_api_schemas text[];
  v_bucket_public boolean;
  v_managed_auth_functions text[];
  v_claim_reader_defects text[];
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'AP1_EXPECTED_POSTGRES_17 actual=%', current_setting('server_version');
  end if;

  select array_agg(expected.name order by expected.name)
  into v_missing_api_schemas
  from unnest(array[
    'projectceo_api',
    'projectceo_read_api',
    'projectceo_product_api',
    'projectceo_m4_api'
  ]) expected(name)
  where not exists (
    select 1 from pg_catalog.pg_namespace n where n.nspname = expected.name
  );
  if v_missing_api_schemas is not null then
    raise exception 'AP1_MISSING_API_SCHEMAS %', v_missing_api_schemas;
  end if;

  select count(*)
  into v_private_runtime_table_grants
  from information_schema.table_privileges p
  where p.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
    and p.table_schema in (
      'project_intelligence',
      'projectceo_foundation',
      'projectceo_product',
      'projectceo_m4'
    );
  if v_private_runtime_table_grants <> 0 then
    raise exception 'AP1_PRIVATE_TABLE_RUNTIME_GRANTS count=%', v_private_runtime_table_grants;
  end if;

  -- project_intelligence_api is a legacy compatibility RPC schema with narrow
  -- authenticated/service grants. The HTTP verifier proves it is not exposed;
  -- persistence schemas themselves must have no runtime grants at all.
  select count(*)
  into v_private_runtime_routine_grants
  from information_schema.routine_privileges p
  where p.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
    and p.routine_schema in (
      'project_intelligence',
      'projectceo_foundation',
      'projectceo_product',
      'projectceo_m4'
    );
  if v_private_runtime_routine_grants <> 0 then
    raise exception 'AP1_PRIVATE_ROUTINE_RUNTIME_GRANTS count=%', v_private_runtime_routine_grants;
  end if;

  select count(*)
  into v_private_runtime_schema_grants
  from (values ('anon'), ('authenticated'), ('service_role')) runtime_role(name)
  cross join (values
    ('project_intelligence'),
    ('projectceo_foundation'),
    ('projectceo_product'),
    ('projectceo_m4')
  ) private_schema(name)
  where has_schema_privilege(runtime_role.name, private_schema.name, 'USAGE');
  if v_private_runtime_schema_grants <> 0 then
    raise exception 'AP1_PRIVATE_SCHEMA_RUNTIME_GRANTS count=%', v_private_runtime_schema_grants;
  end if;

  select count(*)
  into v_bad_executor_roles
  from pg_catalog.pg_roles r
  where r.rolname in ('pi_human_executor', 'pi_worker_executor')
    and (
      r.rolcanlogin or r.rolinherit or r.rolsuper or r.rolcreatedb
      or r.rolcreaterole or r.rolreplication or r.rolbypassrls
    );
  if v_bad_executor_roles <> 0
     or (select count(*) from pg_catalog.pg_roles r
         where r.rolname in ('pi_human_executor', 'pi_worker_executor')) <> 2 then
    raise exception 'AP1_EXECUTOR_ROLE_GUARD_FAILED bad=%', v_bad_executor_roles;
  end if;

  if has_schema_privilege('pi_table_owner', 'auth', 'USAGE')
     or has_schema_privilege('pi_human_executor', 'auth', 'USAGE')
     or has_schema_privilege('pi_worker_executor', 'auth', 'USAGE') then
    raise exception 'AP1_AUTH_SCHEMA_OWNER_LOOKUP_MUST_NOT_BE_REQUIRED';
  end if;
  select count(*)
  into v_auth_owner_table_grants
  from information_schema.table_privileges p
  where p.grantee = 'pi_table_owner'
    and p.table_schema = 'auth';
  if v_auth_owner_table_grants <> 0 or has_table_privilege(
    'pi_table_owner', 'auth.users', 'SELECT'
  ) then
    raise exception 'AP1_AUTH_TABLE_OWNER_GRANT_MUST_NOT_EXIST count=%', v_auth_owner_table_grants;
  end if;
  if exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'auth'
      and policy.tablename = 'users'
  ) then
    raise exception 'AP1_AUTH_USERS_POLICY_MUST_NOT_EXIST';
  end if;

  -- Постусловие к 20260801120000: ни одна развёрнутая функция ProjectCEO не
  -- обращается к управляемой схеме auth. Миграция проверяет это в момент
  -- применения, но только для семи схем и только один раз. Здесь проверка
  -- стоит на фактическом состоянии базы, покрывает все девять схем (включая
  -- project_intelligence_api и projectceo_read_api, которых в guard'е миграции
  -- нет) и срабатывает после любой последующей миграции.
  --
  -- Дефект, ради которого это написано: grant usage on schema auth молча не
  -- применяется (WARNING, не ERROR), функция с auth.uid() применяется успешно
  -- и падает только у аутентифицированного клиента в рантайме.
  select array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname)
  into v_managed_auth_functions
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
      'projectceo_m4',
      'projectceo_m4_api'
    )
    and p.prokind = 'f'
    -- Совпадает по смыслу с регуляркой в auth-regression.contract.test.ts.
    -- Ловит и упоминание в комментарии внутри тела — это осознанно: тело
    -- функции не место для строки auth.uid().
    and pg_get_functiondef(p.oid) ~ 'auth\.(uid\s*\(|jwt\s*\(|users)';
  if v_managed_auth_functions is not null then
    raise exception 'AP1_MANAGED_AUTH_REFERENCE_REMAINS %', v_managed_auth_functions;
  end if;

  -- Замена auth.uid()/auth.jwt() существует и пригодна к использованию:
  -- SECURITY DEFINER (иначе читает GUC от имени вызывающего без гарантий),
  -- владелец pi_table_owner (иначе цепочка владения расходится с таблицами),
  -- пришпиленный search_path (иначе definer уязвим к подмене схемы).
  select array_agg(t.defect order by t.defect)
  into v_claim_reader_defects
  from (
    select case
      when p.oid is null then expected.name || ':MISSING'
      when not p.prosecdef then expected.name || ':NOT_SECURITY_DEFINER'
      when pg_get_userbyid(p.proowner) <> 'pi_table_owner'
        then expected.name || ':OWNER=' || pg_get_userbyid(p.proowner)
      when coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%'
        then expected.name || ':SEARCH_PATH_NOT_PINNED'
    end as defect
    from unnest(array['_request_user_id', '_request_jwt']) expected(name)
    left join pg_catalog.pg_namespace n on n.nspname = 'project_intelligence'
    left join pg_catalog.pg_proc p
      on p.pronamespace = n.oid
     and p.proname = expected.name
     and p.pronargs = 0
  ) t
  where t.defect is not null;
  if v_claim_reader_defects is not null then
    raise exception 'AP1_REQUEST_CLAIM_READERS_INVALID %', v_claim_reader_defects;
  end if;

  select b.public
  into strict v_bucket_public
  from storage.buckets b
  where b.id = 'client-uploads';
  if v_bucket_public then
    raise exception 'AP1_CLIENT_UPLOADS_BUCKET_MUST_BE_PRIVATE';
  end if;
end
$verify$;

select format(
  'AP1_DB_OK postgres=%s migrations=%s private_persistence_runtime_grants=0 executor_roles_guarded=true storage_bucket_private=true managed_auth_references=0 request_claim_readers=ok',
  current_setting('server_version'),
  (select count(*) from supabase_migrations.schema_migrations)
);
