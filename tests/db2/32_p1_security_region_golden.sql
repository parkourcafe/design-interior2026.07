\set ON_ERROR_STOP on

-- P1 production-gate assertions: executor roles are sealed, regional cells are
-- explicit, and the canonical/golden contract cannot silently drift.
do $assert$
declare
  n bigint;
begin
  select count(*) into n
  from pg_catalog.pg_auth_members m
  join pg_catalog.pg_roles r on r.oid = m.roleid
  where r.rolname in ('pi_table_owner','pi_human_executor','pi_worker_executor');
  if n <> 0 then
    raise exception 'DB2_EXECUTOR_ROLE_MEMBERSHIP_NOT_EMPTY count=%', n;
  end if;

  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname in ('pi_table_owner','pi_human_executor','pi_worker_executor')
      and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole
           or rolreplication or rolbypassrls)
  ) then
    raise exception 'DB2_EXECUTOR_ROLE_ATTRIBUTES_UNSAFE';
  end if;

  if not exists (
    select 1 from project_intelligence.deployment_cells
    where cell_code = 'ru'
  ) then
    raise exception 'DB2_DEFAULT_RU_CELL_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace s on s.oid = t.relnamespace
    where s.nspname = 'project_intelligence'
      and t.relname = 'organizations'
      and c.conname = 'organizations_cell_code_fkey'
  ) then
    raise exception 'DB2_ORGANIZATION_CELL_FK_MISSING';
  end if;

  -- Physical-cell isolation is deliberate: no runtime region switch exists.
  if exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_class t on t.oid = a.attrelid
    join pg_catalog.pg_namespace s on s.oid = t.relnamespace
    where s.nspname = 'project_intelligence'
      and a.attname in ('region','runtime_region','tenant_region')
      and not a.attisdropped
  ) then
    raise exception 'DB2_RUNTIME_REGION_SELECTOR_PRESENT';
  end if;
end
$assert$;

do $golden$
declare
  expected text[] := array[
    'project_intelligence_api.review_claim(uuid,text,text,bigint,text,text)',
    'project_intelligence_api.publish_version(uuid,text,bigint,text,jsonb,text)',
    'project_intelligence_api.revise_decision(uuid,text,text,text,bigint,text,jsonb,text,text,text)',
    'project_intelligence_api.calculate_impact(uuid,text,bigint,text)',
    'project_intelligence_api.review_impact(uuid,text,text,text,text,text,bigint,text)',
    'project_intelligence_api.build_handoff(uuid,text,bigint,text)'
  ];
  actual text[];
begin
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
    into actual
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'project_intelligence_api';
  if not (expected <@ coalesce(actual, array[]::text[])) then
    raise exception 'DB2_GOLDEN_RPC_CONTRACT_MISSING expected=% actual=%', expected, actual;
  end if;
end
$golden$;

select 'DB2_P1_SECURITY_REGION_GOLDEN_OK' as assertion;
