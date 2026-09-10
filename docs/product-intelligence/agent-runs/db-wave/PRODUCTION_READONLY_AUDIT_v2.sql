-- RemHaOS WP-11: authoritative production catalog snapshot v2.
--
-- READ-ONLY: this file is one SELECT. It performs no DDL or DML and does not
-- read application rows, Auth identities, Storage objects, filenames or file
-- contents. Run it in the Supabase Dashboard SQL Editor and download the one
-- `production_schema_snapshot` value as JSON.
--
-- Scope: every non-system schema, including private, storage and
-- market_harvest when they exist. The migration ledger is the only
-- application-owned table read because its rows are part of the adoption
-- contract.

with
scope_schemas as (
  select n.oid, n.nspname as schema_name
  from pg_namespace as n
  where n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname !~ '^pg_toast'
    and n.nspname !~ '^pg_temp_'
    and n.nspname !~ '^pg_toast_temp_'
),
migration_ledger as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'version', to_jsonb(m) ->> 'version',
        'name', to_jsonb(m) ->> 'name',
        'statements_md5', md5(coalesce((to_jsonb(m) -> 'statements')::text, 'null'))
      ) order by coalesce(to_jsonb(m) ->> 'version', '')
    ),
    '[]'::jsonb
  ) as value
  from supabase_migrations.schema_migrations as m
),
schemas as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema_name', s.schema_name,
        'owner', pg_get_userbyid(n.nspowner),
        'acl', coalesce(n.nspacl::text, '')
      ) order by s.schema_name
    ),
    '[]'::jsonb
  ) as value
  from scope_schemas as s
  join pg_namespace as n on n.oid = s.oid
),
relations as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', s.schema_name,
        'name', c.relname,
        'kind', c.relkind,
        'owner', pg_get_userbyid(c.relowner),
        'row_security', c.relrowsecurity,
        'force_row_security', c.relforcerowsecurity,
        'persistence', c.relpersistence,
        'acl', coalesce(c.relacl::text, '')
      ) order by s.schema_name, c.relname
    ),
    '[]'::jsonb
  ) as value
  from pg_class as c
  join scope_schemas as s on s.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
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
      ) order by c.table_schema, c.table_name, c.ordinal_position
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
        'schema', s.schema_name,
        'table', c.relname,
        'name', con.conname,
        'type', con.contype,
        'definition', pg_get_constraintdef(con.oid, true),
        'deferrable', con.condeferrable,
        'initially_deferred', con.condeferred,
        'validated', con.convalidated
      ) order by s.schema_name, c.relname, con.conname
    ),
    '[]'::jsonb
  ) as value
  from pg_constraint as con
  join pg_class as c on c.oid = con.conrelid
  join scope_schemas as s on s.oid = c.relnamespace
),
indexes as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', i.schemaname,
        'table', i.tablename,
        'name', i.indexname,
        'definition', i.indexdef
      ) order by i.schemaname, i.tablename, i.indexname
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
      ) order by p.schemaname, p.tablename, p.policyname
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
        'schema', s.schema_name,
        'name', p.proname,
        'kind', p.prokind,
        'language', language.lanname,
        'identity_arguments', pg_get_function_identity_arguments(p.oid),
        'result', pg_get_function_result(p.oid),
        'security_definer', p.prosecdef,
        'leakproof', p.proleakproof,
        'volatility', p.provolatile,
        'parallel', p.proparallel,
        'owner', pg_get_userbyid(p.proowner),
        'config', p.proconfig,
        'acl', coalesce(p.proacl::text, ''),
        'definition', case
          when p.prokind in ('f', 'p', 'w') then pg_get_functiondef(p.oid)
          else null
        end
      ) order by s.schema_name, p.proname,
        pg_get_function_identity_arguments(p.oid)
    ),
    '[]'::jsonb
  ) as value
  from pg_proc as p
  join scope_schemas as s on s.oid = p.pronamespace
  join pg_language as language on language.oid = p.prolang
),
views as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', s.schema_name,
        'name', c.relname,
        'kind', c.relkind,
        'definition', pg_get_viewdef(c.oid, true)
      ) order by s.schema_name, c.relname
    ),
    '[]'::jsonb
  ) as value
  from pg_class as c
  join scope_schemas as s on s.oid = c.relnamespace
  where c.relkind in ('v', 'm')
),
triggers as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', s.schema_name,
        'table', c.relname,
        'name', t.tgname,
        'enabled', t.tgenabled,
        'definition', pg_get_triggerdef(t.oid, true)
      ) order by s.schema_name, c.relname, t.tgname
    ),
    '[]'::jsonb
  ) as value
  from pg_trigger as t
  join pg_class as c on c.oid = t.tgrelid
  join scope_schemas as s on s.oid = c.relnamespace
  where not t.tgisinternal
),
enums as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', s.schema_name,
        'type', t.typname,
        'label', e.enumlabel,
        'sort_order', e.enumsortorder
      ) order by s.schema_name, t.typname, e.enumsortorder
    ),
    '[]'::jsonb
  ) as value
  from pg_type as t
  join scope_schemas as s on s.oid = t.typnamespace
  join pg_enum as e on e.enumtypid = t.oid
),
types as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', s.schema_name,
        'name', t.typname,
        'kind', t.typtype,
        'category', t.typcategory,
        'owner', pg_get_userbyid(t.typowner),
        'acl', coalesce(t.typacl::text, ''),
        'domain_base_type', case
          when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod)
          else null
        end
      ) order by s.schema_name, t.typname
    ),
    '[]'::jsonb
  ) as value
  from pg_type as t
  join scope_schemas as s on s.oid = t.typnamespace
  where t.typtype in ('e', 'd', 'c')
),
table_grants as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'grantor', g.grantor,
        'grantee', g.grantee,
        'schema', g.table_schema,
        'object', g.table_name,
        'privilege', g.privilege_type,
        'grantable', g.is_grantable
      ) order by g.table_schema, g.table_name, g.grantee, g.privilege_type
    ),
    '[]'::jsonb
  ) as value
  from information_schema.table_privileges as g
  join scope_schemas as s on s.schema_name = g.table_schema
),
column_grants as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'grantor', g.grantor,
        'grantee', g.grantee,
        'schema', g.table_schema,
        'object', g.table_name,
        'column', g.column_name,
        'privilege', g.privilege_type,
        'grantable', g.is_grantable
      ) order by g.table_schema, g.table_name, g.column_name, g.grantee,
        g.privilege_type
    ),
    '[]'::jsonb
  ) as value
  from information_schema.column_privileges as g
  join scope_schemas as s on s.schema_name = g.table_schema
),
routine_grants as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'grantor', g.grantor,
        'grantee', g.grantee,
        'schema', g.routine_schema,
        'object', g.routine_name,
        'specific_name', g.specific_name,
        'privilege', g.privilege_type,
        'grantable', g.is_grantable
      ) order by g.routine_schema, g.specific_name, g.grantee,
        g.privilege_type
    ),
    '[]'::jsonb
  ) as value
  from information_schema.routine_privileges as g
  join scope_schemas as s on s.schema_name = g.routine_schema
),
usage_grants as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'grantor', g.grantor,
        'grantee', g.grantee,
        'schema', g.object_schema,
        'object', g.object_name,
        'object_type', g.object_type,
        'privilege', g.privilege_type,
        'grantable', g.is_grantable
      ) order by g.object_schema, g.object_name, g.grantee,
        g.privilege_type
    ),
    '[]'::jsonb
  ) as value
  from information_schema.usage_privileges as g
  join scope_schemas as s on s.schema_name = g.object_schema
),
default_privileges as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', coalesce(s.schema_name, '*'),
        'owner', pg_get_userbyid(d.defaclrole),
        'object_type', d.defaclobjtype,
        'acl', coalesce(d.defaclacl::text, '')
      ) order by coalesce(s.schema_name, '*'), pg_get_userbyid(d.defaclrole),
        d.defaclobjtype
    ),
    '[]'::jsonb
  ) as value
  from pg_default_acl as d
  left join scope_schemas as s on s.oid = d.defaclnamespace
  where d.defaclnamespace = 0 or s.oid is not null
),
runtime_roles as (
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
      ) order by r.rolname
    ),
    '[]'::jsonb
  ) as value
  from pg_roles as r
  where r.rolname in ('anon', 'authenticated', 'authenticator', 'service_role', 'postgres')
    or r.rolname ~ '^(pi_|projectceo_|project_intelligence_)'
),
role_memberships as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'role', role.rolname,
        'member', member.rolname,
        'admin_option', membership.admin_option
      ) order by role.rolname, member.rolname
    ),
    '[]'::jsonb
  ) as value
  from pg_auth_members as membership
  join pg_roles as role on role.oid = membership.roleid
  join pg_roles as member on member.oid = membership.member
  where role.rolname in ('anon', 'authenticated', 'authenticator', 'service_role', 'postgres')
    or member.rolname in ('anon', 'authenticated', 'authenticator', 'service_role', 'postgres')
    or role.rolname ~ '^(pi_|projectceo_|project_intelligence_)'
    or member.rolname ~ '^(pi_|projectceo_|project_intelligence_)'
),
schema_role_privileges as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'role', r.rolname,
        'schema', s.schema_name,
        'usage', has_schema_privilege(r.rolname, s.schema_name, 'USAGE'),
        'create', has_schema_privilege(r.rolname, s.schema_name, 'CREATE')
      ) order by r.rolname, s.schema_name
    ),
    '[]'::jsonb
  ) as value
  from pg_roles as r
  cross join scope_schemas as s
  where r.rolname in ('anon', 'authenticated', 'authenticator', 'service_role', 'postgres')
    or r.rolname ~ '^(pi_|projectceo_|project_intelligence_)'
),
extensions as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', e.extname,
        'version', e.extversion,
        'schema', n.nspname
      ) order by e.extname
    ),
    '[]'::jsonb
  ) as value
  from pg_extension as e
  join pg_namespace as n on n.oid = e.extnamespace
)
select jsonb_pretty(
  jsonb_build_object(
    'snapshot_contract', 'remhaos-production-catalog/2.0',
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
    'views', (select value from views),
    'triggers', (select value from triggers),
    'enums', (select value from enums),
    'types', (select value from types),
    'table_grants', (select value from table_grants),
    'column_grants', (select value from column_grants),
    'routine_grants', (select value from routine_grants),
    'usage_grants', (select value from usage_grants),
    'default_privileges', (select value from default_privileges),
    'roles', (select value from runtime_roles),
    'role_memberships', (select value from role_memberships),
    'schema_role_privileges', (select value from schema_role_privileges),
    'extensions', (select value from extensions)
  )
) as production_schema_snapshot;
