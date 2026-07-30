\set ON_ERROR_STOP on

do $schema_security$
declare
  v_missing text;
  v_exposed text;
  v_problem text;
  v_function_count integer;
begin
  select expected.name into v_missing
  from (values
    ('projectceo_foundation'),
    ('projectceo_api')
  ) expected(name)
  where not exists (
    select 1 from pg_namespace n where n.nspname = expected.name
  )
  limit 1;
  if v_missing is not null then
    raise exception 'DB3_MISSING_SCHEMA:%', v_missing;
  end if;

  select expected.name into v_missing
  from (values
    ('project_packages'),
    ('project_memberships'),
    ('package_memberships'),
    ('project_member_capabilities'),
    ('package_member_capabilities'),
    ('invitations'),
    ('invitation_events'),
    ('guest_access_grants'),
    ('guest_access_grant_events'),
    ('source_inventory_records'),
    ('source_protected_metadata'),
    ('source_ingestions'),
    ('command_records'),
    ('audit_events')
  ) expected(name)
  where not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'projectceo_foundation'
      and c.relname = expected.name
      and c.relkind in ('r', 'p')
  )
  limit 1;
  if v_missing is not null then
    raise exception 'DB3_MISSING_TABLE:%', v_missing;
  end if;

  select format('%I.%I', n.nspname, c.relname)
    into v_problem
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'projectceo_foundation'
    and c.relkind in ('r', 'p')
    and (
      pg_get_userbyid(c.relowner) <> 'pi_table_owner'
      or not c.relrowsecurity
      or not c.relforcerowsecurity
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB3_TABLE_SECURITY:%', v_problem;
  end if;

  select format('%I:%I', table_name, grantee)
    into v_exposed
  from information_schema.role_table_grants
  where table_schema = 'projectceo_foundation'
    and grantee in (
      'PUBLIC',
      'anon',
      'authenticated',
      'service_role',
      'pi_human_executor',
      'pi_worker_executor'
    )
  limit 1;
  if v_exposed is not null then
    raise exception 'DB3_DIRECT_TABLE_GRANT:%', v_exposed;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'project_intelligence'
      and t.relname = 'project_workflows'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (project_id)'
  ) then
    raise exception 'DB3_ONE_PROJECT_ONE_ORGANIZATION_MISSING';
  end if;

  if pg_get_functiondef(
    'project_intelligence._human_context(uuid,text)'::regprocedure
  ) !~ 'projectceo_foundation[.]_authorize_project_human' then
    raise exception 'DB3_DB2_HUMAN_CONTEXT_NOT_PROJECT_SCOPED';
  end if;

  select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    into v_problem
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('projectceo_foundation', 'projectceo_api')
    and p.prosecdef
    and (
      pg_get_userbyid(p.proowner) <> 'pi_table_owner'
      or coalesce(array_to_string(p.proconfig, ','), '') !~ '(^|,)search_path=""(,|$)'
      or exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB3_UNSAFE_DEFINER:%', v_problem;
  end if;

  if has_function_privilege(
    'service_role',
    'projectceo_api.enroll_organization_project(uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'projectceo_api.create_invitation(uuid,uuid,text,text,timestamptz,bytea,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'projectceo_api.accept_invitation(bytea,text)',
    'EXECUTE'
  ) then
    raise exception 'DB3_SERVICE_ROLE_HAS_HUMAN_FUNCTION';
  end if;

  if has_function_privilege(
    'authenticated',
    'projectceo_api.expire_invitation(uuid,uuid,bigint,text)',
    'EXECUTE'
  ) then
    raise exception 'DB3_AUTHENTICATED_HAS_WORKER_FUNCTION';
  end if;

  if exists (
    select 1
    from (
      select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'projectceo_api'
        and p.prokind = 'f'
      offset 0
    ) foundation_function
    where pg_get_functiondef(foundation_function.oid) ~*
        '(recipient_email|token_digest|original_filename|signed_url).*(audit_events)'
  ) then
    raise exception 'DB3_SENSITIVE_AUDIT_PATTERN';
  end if;

  select expected.signature into v_missing
  from (values
    ('projectceo_api.enroll_organization_project(uuid,text)'),
    ('projectceo_api.create_invitation(uuid,uuid,text,text,timestamptz,bytea,bigint,text)'),
    ('projectceo_api.accept_invitation(bytea,text)'),
    ('projectceo_api.revoke_invitation(uuid,uuid,bigint,text)'),
    ('projectceo_api.expire_invitation(uuid,uuid,bigint,text)'),
    ('projectceo_api.create_guest_access_grant(uuid,uuid,text,boolean,timestamptz,bytea,bigint,text)'),
    ('projectceo_api.revoke_guest_access_grant(uuid,uuid,bigint,text)'),
    ('projectceo_api.authorize_source_upload(uuid,uuid,text,text,text,bigint,text)'),
    ('projectceo_api.authorize_source_download(uuid,text,integer)'),
    ('projectceo_api.register_source_inventory(uuid,jsonb,jsonb,bigint,text)'),
    ('projectceo_api.ingest_source_graph(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,text)'),
    ('projectceo_api.list_projects()'),
    ('projectceo_api.get_project_summary(uuid)'),
    ('projectceo_api.list_project_access(uuid)'),
    ('projectceo_api.list_project_sources(uuid)'),
    ('projectceo_api.get_review_queue(uuid)'),
    ('projectceo_api.get_project_delivery(uuid,uuid)'),
    ('projectceo_api.get_audit_timeline(uuid)'),
    ('projectceo_api.read_guest_release(bytea)')
  ) expected(signature)
  where to_regprocedure(expected.signature) is null
  limit 1;
  if v_missing is not null then
    raise exception 'DB3_MISSING_EXACT_RPC:%', v_missing;
  end if;

  select count(*) into v_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_api'
    and p.prokind = 'f';
  if v_function_count <> 19 then
    raise exception 'DB3_UNEXPECTED_RPC_COUNT:%', v_function_count;
  end if;

  select p.oid::regprocedure::text into v_problem
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_api'
    and (
      has_function_privilege('service_role', p.oid, 'EXECUTE')
        is distinct from (p.proname = 'expire_invitation')
      or has_function_privilege('anon', p.oid, 'EXECUTE')
        is distinct from (p.proname = 'read_guest_release')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        is distinct from (p.proname <> 'expire_invitation')
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB3_RPC_ACL_MISMATCH:%', v_problem;
  end if;

  select format('%I.%I:%I', n.nspname, t.relname, c.conname)
    into v_problem
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'projectceo_foundation'
    and c.contype = 'f'
    and not exists (
      select 1
      from pg_index i
      where i.indrelid = c.conrelid
        and i.indisvalid
        and i.indisready
        and i.indnkeyatts >= cardinality(c.conkey)
        and not exists (
          select 1
          from generate_subscripts(c.conkey, 1) key_position
          where i.indkey[key_position - 1] <> c.conkey[key_position]
        )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB3_UNINDEXED_FOREIGN_KEY:%', v_problem;
  end if;
end
$schema_security$;

select 'DB3_SCHEMA_SECURITY_OK' as result;
