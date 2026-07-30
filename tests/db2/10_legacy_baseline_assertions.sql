\set ON_ERROR_STOP on

do $assert$
declare
  contract_line_count integer;
  contract_fingerprint text;
  actual integer;
  missing_table text;
  rls_problem text;
  missing_grant text;
begin
  -- This projection is intentionally independent of migration source text. It
  -- is the normalized catalog contract calculated from the authoritative
  -- 2026-07-16 production snapshot, plus the verified client-uploads bucket.
  --
  -- It detects additions as well as removals/changes: relation kind/owner/RLS,
  -- every column type/default/nullability, every constraint/index/policy,
  -- function definition/config/ACL, triggers, enums and expanded table grants.
  with
  relations as (
    select
      1 as section_order,
      n.nspname as sort_1,
      c.relname as sort_2,
      ''::text as sort_3,
      array_to_string(array[
        'R'::text,
        n.nspname,
        c.relname,
        c.relkind::text,
        pg_get_userbyid(c.relowner),
        c.relrowsecurity::text,
        c.relforcerowsecurity::text,
        c.relpersistence::text
      ], chr(31), '<NULL>') as line
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  ),
  columns as (
    select
      2 as section_order,
      c.table_schema || chr(31) || c.table_name as sort_1,
      lpad(c.ordinal_position::text, 10, '0') as sort_2,
      ''::text as sort_3,
      array_to_string(array[
        'C'::text,
        c.table_schema,
        c.table_name,
        c.ordinal_position::text,
        c.column_name,
        c.data_type,
        c.udt_schema,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.is_identity,
        c.is_generated
      ], chr(31), '<NULL>') as line
    from information_schema.columns c
    where c.table_schema = 'public'
  ),
  constraints as (
    select
      3 as section_order,
      n.nspname || chr(31) || c.relname as sort_1,
      con.conname as sort_2,
      ''::text as sort_3,
      array_to_string(array[
        'K'::text,
        n.nspname,
        c.relname,
        con.conname,
        con.contype::text,
        pg_get_constraintdef(con.oid, true),
        con.condeferrable::text,
        con.condeferred::text,
        con.convalidated::text
      ], chr(31), '<NULL>') as line
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ),
  indexes as (
    select
      4 as section_order,
      i.schemaname || chr(31) || i.tablename as sort_1,
      i.indexname as sort_2,
      ''::text as sort_3,
      array_to_string(array[
        'I'::text,
        i.schemaname,
        i.tablename,
        i.indexname,
        i.indexdef
      ], chr(31), '<NULL>') as line
    from pg_indexes i
    where i.schemaname = 'public'
  ),
  policies as (
    select
      5 as section_order,
      p.schemaname || chr(31) || p.tablename as sort_1,
      p.policyname as sort_2,
      ''::text as sort_3,
      array_to_string(array[
        'P'::text,
        p.schemaname,
        p.tablename,
        p.policyname,
        p.permissive,
        array_to_string(p.roles, ','),
        p.cmd,
        p.qual,
        p.with_check
      ], chr(31), '<NULL>') as line
    from pg_policies p
    where p.schemaname = 'public'
  ),
  functions as (
    select
      6 as section_order,
      n.nspname || chr(31) || p.proname as sort_1,
      pg_get_function_identity_arguments(p.oid) as sort_2,
      ''::text as sort_3,
      array_to_string(array[
        'F'::text,
        n.nspname,
        p.proname,
        pg_get_function_identity_arguments(p.oid),
        pg_get_function_result(p.oid),
        p.prosecdef::text,
        p.proleakproof::text,
        p.provolatile::text,
        p.proparallel::text,
        pg_get_userbyid(p.proowner),
        array_to_string(p.proconfig, ','),
        coalesce(p.proacl::text, ''),
        pg_get_functiondef(p.oid)
      ], chr(31), '<NULL>') as line
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ),
  triggers as (
    select
      7 as section_order,
      n.nspname || chr(31) || c.relname as sort_1,
      t.tgname as sort_2,
      ''::text as sort_3,
      array_to_string(array[
        'T'::text,
        n.nspname,
        c.relname,
        t.tgname,
        t.tgenabled::text,
        pg_get_triggerdef(t.oid, true)
      ], chr(31), '<NULL>') as line
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
  ),
  enums as (
    select
      8 as section_order,
      n.nspname || chr(31) || t.typname as sort_1,
      lpad(e.enumsortorder::text, 20, '0') as sort_2,
      ''::text as sort_3,
      array_to_string(array[
        'E'::text,
        n.nspname,
        t.typname,
        e.enumlabel,
        e.enumsortorder::text
      ], chr(31), '<NULL>') as line
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public'
  ),
  table_grants as (
    select
      9 as section_order,
      g.table_schema || chr(31) || g.table_name as sort_1,
      g.grantee as sort_2,
      g.privilege_type as sort_3,
      array_to_string(array[
        'G'::text,
        g.grantor,
        g.grantee,
        g.table_schema,
        g.table_name,
        g.privilege_type,
        g.is_grantable
      ], chr(31), '<NULL>') as line
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
  ),
  bucket as (
    select
      10 as section_order,
      b.id as sort_1,
      ''::text as sort_2,
      ''::text as sort_3,
      array_to_string(array[
        'B'::text,
        b.id,
        b.name,
        b.public::text,
        b.file_size_limit::text,
        array_to_string(b.allowed_mime_types, ',')
      ], chr(31), '<NULL>') as line
    from storage.buckets b
    where b.id = 'client-uploads'
  ),
  contract_lines as (
    select * from relations
    union all select * from columns
    union all select * from constraints
    union all select * from indexes
    union all select * from policies
    union all select * from functions
    union all select * from triggers
    union all select * from enums
    union all select * from table_grants
    union all select * from bucket
  ),
  contract as (
    select
      count(*)::integer as line_count,
      string_agg(
        line,
        chr(30)
        order by section_order, sort_1, sort_2, sort_3
      ) as canonical_text
    from contract_lines
  )
  select
    line_count,
    encode(
      extensions.digest(convert_to(canonical_text, 'UTF8'), 'sha256'),
      'hex'
    )
  into contract_line_count, contract_fingerprint
  from contract;

  if contract_line_count <> 510 then
    raise exception
      'BASELINE_ASSERT_CONTRACT_LINE_COUNT:expected=510 actual=%',
      contract_line_count;
  end if;

  if contract_fingerprint <>
    '2e65b2ac381225b4b9942f25e147dd81f70f2391cd4212ed6fb2a3740fdf61b5'
  then
    raise exception
      'BASELINE_ASSERT_CONTRACT_FINGERPRINT:expected=% actual=%',
      '2e65b2ac381225b4b9942f25e147dd81f70f2391cd4212ed6fb2a3740fdf61b5',
      contract_fingerprint;
  end if;

  select count(*)
  into actual
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'answers',
      'designers',
      'events',
      'project_participants',
      'project_rooms',
      'project_task_events',
      'project_tasks',
      'projects',
      'proposals',
      'risk_cards',
      'studio_members'
    );

  if actual <> 11 then
    raise exception 'BASELINE_ASSERT_TABLE_COUNT:%', actual;
  end if;

  select expected.name
  into missing_table
  from (
    values
      ('answers'),
      ('designers'),
      ('events'),
      ('project_participants'),
      ('project_rooms'),
      ('project_task_events'),
      ('project_tasks'),
      ('projects'),
      ('proposals'),
      ('risk_cards'),
      ('studio_members')
  ) as expected(name)
  where to_regclass(format('public.%I', expected.name)) is null
  limit 1;

  if missing_table is not null then
    raise exception 'BASELINE_ASSERT_MISSING_TABLE:%', missing_table;
  end if;

  if to_regclass('public.rate_limits') is not null
    or to_regclass('public.concept_packs') is not null
    or to_regclass('project_intelligence.project_workflows') is not null
  then
    raise exception 'BASELINE_ASSERT_ABSENT_OBJECT_PRESENT';
  end if;

  select count(*)
  into actual
  from information_schema.columns
  where table_schema = 'public'
    and table_name in (
      'answers',
      'designers',
      'events',
      'project_participants',
      'project_rooms',
      'project_task_events',
      'project_tasks',
      'projects',
      'proposals',
      'risk_cards',
      'studio_members'
    );

  if actual <> 90 then
    raise exception 'BASELINE_ASSERT_COLUMN_COUNT:%', actual;
  end if;

  select count(*)
  into actual
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'answers',
      'designers',
      'events',
      'project_participants',
      'project_rooms',
      'project_task_events',
      'project_tasks',
      'projects',
      'proposals',
      'risk_cards',
      'studio_members'
    );

  if actual <> 52 then
    raise exception 'BASELINE_ASSERT_CONSTRAINT_COUNT:%', actual;
  end if;

  select count(*)
  into actual
  from pg_indexes
  where schemaname = 'public'
    and tablename in (
      'answers',
      'designers',
      'events',
      'project_participants',
      'project_rooms',
      'project_task_events',
      'project_tasks',
      'projects',
      'proposals',
      'risk_cards',
      'studio_members'
    );

  if actual <> 31 then
    raise exception 'BASELINE_ASSERT_INDEX_COUNT:%', actual;
  end if;

  select count(*)
  into actual
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'answers',
      'designers',
      'events',
      'project_participants',
      'project_rooms',
      'project_task_events',
      'project_tasks',
      'projects',
      'proposals',
      'risk_cards',
      'studio_members'
    );

  if actual <> 16 then
    raise exception 'BASELINE_ASSERT_POLICY_COUNT:%', actual;
  end if;

  select format('%I.%I', n.nspname, c.relname)
  into rls_problem
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'answers',
      'designers',
      'events',
      'project_participants',
      'project_rooms',
      'project_task_events',
      'project_tasks',
      'projects',
      'proposals',
      'risk_cards',
      'studio_members'
    )
    and (not c.relrowsecurity or c.relforcerowsecurity)
  limit 1;

  if rls_problem is not null then
    raise exception 'BASELINE_ASSERT_RLS_SHAPE:%', rls_problem;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'is_studio_member'
      and p.prosecdef
      and p.proconfig = array['search_path=public']
  ) then
    raise exception 'BASELINE_ASSERT_STUDIO_FUNCTION';
  end if;

  select format('%I.%I:%I:%I', tables.table_schema, tables.table_name, roles.role_name, privileges.privilege)
  into missing_grant
  from (
    select 'public'::text as table_schema, unnest(array[
      'answers',
      'designers',
      'events',
      'project_participants',
      'project_rooms',
      'project_task_events',
      'project_tasks',
      'projects',
      'proposals',
      'risk_cards',
      'studio_members'
    ]) as table_name
  ) as tables
  cross join (
    select unnest(array['anon', 'authenticated', 'service_role']) as role_name
  ) as roles
  cross join (
    select unnest(array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]) as privilege
  ) as privileges
  where not has_table_privilege(
    roles.role_name,
    format('%I.%I', tables.table_schema, tables.table_name),
    privileges.privilege
  )
  limit 1;

  if missing_grant is not null then
    raise exception 'BASELINE_ASSERT_MISSING_LEGACY_GRANT:%', missing_grant;
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'client-uploads'
      and name = 'client-uploads'
      and public = false
      and file_size_limit is null
      and allowed_mime_types is null
  ) then
    raise exception 'BASELINE_ASSERT_STORAGE_BUCKET';
  end if;
end
$assert$;

select 'LEGACY_BASELINE_ASSERTIONS_OK' as result;
