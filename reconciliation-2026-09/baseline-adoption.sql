\set ON_ERROR_STOP on

-- WP-13 / Approval A only.
--
-- This file repairs migration history; it deliberately contains no baseline
-- DDL. The expected counts come from the reviewed, fresh catalog snapshot and
-- are passed by the Approval A operator. The disposable rehearsal invokes this
-- file through adopt-production.zsh after validating their shape. Do not
-- replace the required inputs with stale values from a prior snapshot.
\if :{?AP1_EXPECTED_RELATIONS}
\else
  \echo 'AP1_BASELINE_EXPECTED_RELATIONS_REQUIRED'
  \quit 64
\endif
\if :{?AP1_EXPECTED_ROUTINES}
\else
  \echo 'AP1_BASELINE_EXPECTED_ROUTINES_REQUIRED'
  \quit 64
\endif
\if :{?AP1_EXPECTED_POLICIES}
\else
  \echo 'AP1_BASELINE_EXPECTED_POLICIES_REQUIRED'
  \quit 64
\endif
\if :{?AP1_EXPECTED_LEDGER_ROWS}
\else
  \echo 'AP1_BASELINE_EXPECTED_LEDGER_ROWS_REQUIRED'
  \quit 64
\endif

begin;

select set_config('ap1.expected_relations', :'AP1_EXPECTED_RELATIONS', true);
select set_config('ap1.expected_routines', :'AP1_EXPECTED_ROUTINES', true);
select set_config('ap1.expected_policies', :'AP1_EXPECTED_POLICIES', true);
select set_config('ap1.expected_ledger_rows', :'AP1_EXPECTED_LEDGER_ROWS', true);

do $baseline_adoption$
declare
  v_relations integer;
  v_routines integer;
  v_policies integer;
  v_ledger_rows integer;
  v_expected_relations integer := current_setting('ap1.expected_relations')::integer;
  v_expected_routines integer := current_setting('ap1.expected_routines')::integer;
  v_expected_policies integer := current_setting('ap1.expected_policies')::integer;
  v_expected_ledger_rows integer := current_setting('ap1.expected_ledger_rows')::integer;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'AP1_BASELINE_LEDGER_MISSING';
  end if;

  -- Keep this scope byte-for-byte aligned with WP-11's catalog snapshot:
  -- every non-system relation and routine, and every policy in that scope.
  select count(*) into v_relations
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname not in ('pg_catalog', 'information_schema')
    and namespace.nspname !~ '^pg_toast'
    and namespace.nspname !~ '^pg_temp_'
    and namespace.nspname !~ '^pg_toast_temp_'
    and relation.relkind in ('r', 'p', 'v', 'm', 'f', 'S');

  select count(*) into v_routines
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname not in ('pg_catalog', 'information_schema')
    and namespace.nspname !~ '^pg_toast'
    and namespace.nspname !~ '^pg_temp_'
    and namespace.nspname !~ '^pg_toast_temp_';

  select count(*) into v_policies
  from pg_catalog.pg_policies policy
  join pg_catalog.pg_namespace namespace on namespace.nspname = policy.schemaname
  where namespace.nspname not in ('pg_catalog', 'information_schema')
    and namespace.nspname !~ '^pg_toast'
    and namespace.nspname !~ '^pg_temp_'
    and namespace.nspname !~ '^pg_toast_temp_';

  select count(*) into v_ledger_rows
  from supabase_migrations.schema_migrations;

  if v_relations <> v_expected_relations
    or v_routines <> v_expected_routines
    or v_policies <> v_expected_policies
    or v_ledger_rows <> v_expected_ledger_rows then
    raise exception
      'AP1_BASELINE_FINGERPRINT_MISMATCH relations=%/% routines=%/% policies=%/% ledger_rows=%/%',
      v_relations, v_expected_relations,
      v_routines, v_expected_routines,
      v_policies, v_expected_policies,
      v_ledger_rows, v_expected_ledger_rows;
  end if;

  if exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260716071024'
  ) then
    raise exception 'AP1_BASELINE_ALREADY_ADOPTED';
  end if;

  insert into supabase_migrations.schema_migrations (version, name)
  values ('20260716071024', 'legacy_production_baseline');
end
$baseline_adoption$;

commit;

select 'AP1_BASELINE_ADOPTION_OK version=20260716071024 ddl_executed=false' as result;
