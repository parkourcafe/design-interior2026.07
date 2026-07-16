-- Project Intelligence DB1 gate: authoritative production metadata snapshot.
--
-- READ-ONLY: this file contains a single SELECT and performs no DDL/DML.
-- Run it in the Supabase Dashboard SQL Editor for the current production project.
-- Download the single `production_schema_snapshot` result as JSON.
--
-- Scope:
--   * supabase_migrations.schema_migrations ledger;
--   * application-owned `public` schema;
--   * future `project_intelligence` schema, if it already exists;
--   * roles, grants, RLS, policies, constraints, indexes, triggers and functions.
--
-- It does not query application rows, auth users, storage objects or business data.

with
scope_schemas(schema_name) as (
  values ('public'::text), ('project_intelligence'::text)
),
migration_ledger as (
  select coalesce(
    jsonb_agg(to_jsonb(m) order by coalesce(to_jsonb(m) ->> 'version', '')),
    '[]'::jsonb
  ) as value
  from supabase_migrations.schema_migrations as m
),
schemas as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', n.nspname,
        'owner', pg_get_userbyid(n.nspowner),
        'acl', coalesce(n.nspacl::text, '')
      )
      order by n.nspname
    ),
    '[]'::jsonb
  ) as value
  from pg_namespace as n
  join scope_schemas as s on s.schema_name = n.nspname
),
relations as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'name', c.relname,
        'kind', c.relkind,
        'owner', pg_get_userbyid(c.relowner),
        'row_security', c.relrowsecurity,
        'force_row_security', c.relforcerowsecurity,
        'persistence', c.relpersistence,
        'acl', coalesce(c.relacl::text, '')
      )
      order by n.nspname, c.relname
    ),
    '[]'::jsonb
  ) as value
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  join scope_schemas as s on s.schema_name = n.nspname
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
),
columns as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', c.table_schema,
        'table', c.table_name,
        'ordinal', c.ordinal_position,
        'column', c.column_name,
        'data_type', c.data_type,
        'udt_schema', c.udt_schema,
        'udt_name', c.udt_name,
        'nullable', c.is_nullable,
        'default', c.column_default,
        'identity', c.is_identity,
        'generated', c.is_generated
      )
      order by c.table_schema, c.table_name, c.ordinal_position
    ),
    '[]'::jsonb
  ) as value
  from information_schema.columns as c
  join scope_schemas as s on s.schema_name = c.table_schema
),
constraints as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'table', c.relname,
        'name', con.conname,
        'type', con.contype,
        'definition', pg_get_constraintdef(con.oid, true),
        'deferrable', con.condeferrable,
        'initially_deferred', con.condeferred,
        'validated', con.convalidated
      )
      order by n.nspname, c.relname, con.conname
    ),
    '[]'::jsonb
  ) as value
  from pg_constraint as con
  join pg_class as c on c.oid = con.conrelid
  join pg_namespace as n on n.oid = c.relnamespace
  join scope_schemas as s on s.schema_name = n.nspname
),
indexes as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', i.schemaname,
        'table', i.tablename,
        'name', i.indexname,
        'definition', i.indexdef
      )
      order by i.schemaname, i.tablename, i.indexname
    ),
    '[]'::jsonb
  ) as value
  from pg_indexes as i
  join scope_schemas as s on s.schema_name = i.schemaname
),
policies as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', p.schemaname,
        'table', p.tablename,
        'name', p.policyname,
        'permissive', p.permissive,
        'roles', p.roles,
        'command', p.cmd,
        'using', p.qual,
        'with_check', p.with_check
      )
      order by p.schemaname, p.tablename, p.policyname
    ),
    '[]'::jsonb
  ) as value
  from pg_policies as p
  join scope_schemas as s on s.schema_name = p.schemaname
),
functions as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'name', p.proname,
        'identity_arguments', pg_get_function_identity_arguments(p.oid),
        'result', pg_get_function_result(p.oid),
        'security_definer', p.prosecdef,
        'leakproof', p.proleakproof,
        'volatility', p.provolatile,
        'parallel', p.proparallel,
        'owner', pg_get_userbyid(p.proowner),
        'config', p.proconfig,
        'acl', coalesce(p.proacl::text, ''),
        'definition', pg_get_functiondef(p.oid)
      )
      order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
    ),
    '[]'::jsonb
  ) as value
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  join scope_schemas as s on s.schema_name = n.nspname
),
triggers as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'table', c.relname,
        'name', t.tgname,
        'enabled', t.tgenabled,
        'definition', pg_get_triggerdef(t.oid, true)
      )
      order by n.nspname, c.relname, t.tgname
    ),
    '[]'::jsonb
  ) as value
  from pg_trigger as t
  join pg_class as c on c.oid = t.tgrelid
  join pg_namespace as n on n.oid = c.relnamespace
  join scope_schemas as s on s.schema_name = n.nspname
  where not t.tgisinternal
),
enums as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'type', t.typname,
        'label', e.enumlabel,
        'sort_order', e.enumsortorder
      )
      order by n.nspname, t.typname, e.enumsortorder
    ),
    '[]'::jsonb
  ) as value
  from pg_type as t
  join pg_namespace as n on n.oid = t.typnamespace
  join pg_enum as e on e.enumtypid = t.oid
  join scope_schemas as s on s.schema_name = n.nspname
),
table_grants as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'grantor', g.grantor,
        'grantee', g.grantee,
        'schema', g.table_schema,
        'table', g.table_name,
        'privilege', g.privilege_type,
        'grantable', g.is_grantable
      )
      order by g.table_schema, g.table_name, g.grantee, g.privilege_type
    ),
    '[]'::jsonb
  ) as value
  from information_schema.role_table_grants as g
  join scope_schemas as s on s.schema_name = g.table_schema
),
roles as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', r.rolname,
        'superuser', r.rolsuper,
        'inherit', r.rolinherit,
        'create_role', r.rolcreaterole,
        'create_db', r.rolcreatedb,
        'can_login', r.rolcanlogin,
        'replication', r.rolreplication,
        'bypass_rls', r.rolbypassrls
      )
      order by r.rolname
    ),
    '[]'::jsonb
  ) as value
  from pg_roles as r
  where r.rolname !~ '^pg_'
),
schema_role_privileges as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'role', r.rolname,
        'schema', n.nspname,
        'usage', has_schema_privilege(r.rolname, n.nspname, 'USAGE'),
        'create', has_schema_privilege(r.rolname, n.nspname, 'CREATE')
      )
      order by r.rolname, n.nspname
    ),
    '[]'::jsonb
  ) as value
  from pg_roles as r
  cross join pg_namespace as n
  join scope_schemas as s on s.schema_name = n.nspname
  where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')
),
extensions as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', e.extname,
        'version', e.extversion,
        'schema', n.nspname
      )
      order by e.extname
    ),
    '[]'::jsonb
  ) as value
  from pg_extension as e
  join pg_namespace as n on n.oid = e.extnamespace
)
select jsonb_pretty(
  jsonb_build_object(
    'snapshot_contract', 'project-intelligence-production-schema/1.0',
    'captured_at', clock_timestamp(),
    'database', current_database(),
    'server_version', current_setting('server_version'),
    'migration_ledger', (select value from migration_ledger),
    'schemas', (select value from schemas),
    'relations', (select value from relations),
    'columns', (select value from columns),
    'constraints', (select value from constraints),
    'indexes', (select value from indexes),
    'policies', (select value from policies),
    'functions', (select value from functions),
    'triggers', (select value from triggers),
    'enums', (select value from enums),
    'table_grants', (select value from table_grants),
    'roles', (select value from roles),
    'schema_role_privileges', (select value from schema_role_privileges),
    'extensions', (select value from extensions)
  )
) as production_schema_snapshot;
