\set ON_ERROR_STOP on

do $assert$
declare
  missing_schema text;
  missing_role text;
  missing_table text;
  missing_api_function text;
  extra_table text;
  extra_api_function text;
  private_function_exposure text;
  missing_private_trigger_guard text;
  extra_private_definer text;
  missing_hash_helper text;
  private_function_privilege_problem text;
  schema_privilege_problem text;
  crypto_privilege_problem text;
  executor_table_privilege_problem text;
  missing_append_only text;
  unsafe_role text;
  unsafe_table text;
  missing_force_rls text;
  exposed_table text;
  exposed_default text;
  exposed_core_schema text;
  api_table text;
  unsafe_function text;
  missing_root_fk text;
  missing_fk_index text;
  cascade_history_fk text;
  missing_closure_trigger text;
begin
  select required.name
  into missing_schema
  from (
    values
      ('project_intelligence'),
      ('project_intelligence_api')
  ) as required(name)
  where not exists (
    select 1
    from pg_namespace n
    where n.nspname = required.name
  )
  limit 1;

  if missing_schema is not null then
    raise exception 'DB2_ASSERT_MISSING_SCHEMA:%', missing_schema;
  end if;

  select required.name
  into missing_role
  from (
    values
      ('pi_table_owner'),
      ('pi_human_executor'),
      ('pi_worker_executor')
  ) as required(name)
  where not exists (
    select 1
    from pg_roles r
    where r.rolname = required.name
  )
  limit 1;

  if missing_role is not null then
    raise exception 'DB2_ASSERT_MISSING_ROLE:%', missing_role;
  end if;

  select required.name
  into missing_table
  from (
    values
      ('deployment_cells'),
      ('organizations'),
      ('organization_members'),
      ('member_capabilities'),
      ('project_workflows'),
      ('sources'),
      ('source_fragments'),
      ('graph_nodes'),
      ('graph_node_revisions'),
      ('human_reviews'),
      ('evidence_links'),
      ('graph_edges'),
      ('project_versions'),
      ('version_nodes'),
      ('version_reviews'),
      ('version_sources'),
      ('version_source_fragments'),
      ('version_evidence_links'),
      ('version_edges'),
      ('change_sets'),
      ('change_set_reasons'),
      ('change_set_publications'),
      ('impact_runs'),
      ('impact_run_changes'),
      ('impacts'),
      ('impact_path_steps'),
      ('impact_reviews'),
      ('logical_handoffs'),
      ('handoff_impact_reviews'),
      ('command_records'),
      ('audit_events')
  ) as required(name)
  where to_regclass(format('project_intelligence.%I', required.name)) is null
  limit 1;

  if missing_table is not null then
    raise exception 'DB2_ASSERT_MISSING_TABLE:%', missing_table;
  end if;

  select format('%I.%I', n.nspname, c.relname)
  into extra_table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'project_intelligence'
    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    and c.relname not in (
      'deployment_cells',
      'organizations',
      'organization_members',
      'member_capabilities',
      'project_workflows',
      'sources',
      'source_fragments',
      'graph_nodes',
      'graph_node_revisions',
      'human_reviews',
      'evidence_links',
      'graph_edges',
      'project_versions',
      'version_nodes',
      'version_reviews',
      'version_sources',
      'version_source_fragments',
      'version_evidence_links',
      'version_edges',
      'change_sets',
      'change_set_reasons',
      'change_set_publications',
      'impact_runs',
      'impact_run_changes',
      'impacts',
      'impact_path_steps',
      'impact_reviews',
      'logical_handoffs',
      'handoff_impact_reviews',
      'command_records',
      'audit_events'
    )
  limit 1;

  if extra_table is not null then
    raise exception 'DB2_ASSERT_EXTRA_RELATION:%', extra_table;
  end if;

  select format('%s(%s)', required.name, required.identity_arguments)
  into missing_api_function
  from (
    values
      (
        'review_claim',
        'project_id uuid, target_revision_id text, expected_revision_id text, expected_state_revision bigint, decision text, idempotency_key text',
        'pi_human_executor',
        true,
        false
      ),
      (
        'publish_version',
        'project_id uuid, expected_latest_version_id text, expected_state_revision bigint, label text, selected_revisions jsonb, idempotency_key text',
        'pi_human_executor',
        true,
        false
      ),
      (
        'revise_decision',
        'project_id uuid, node_id text, base_version_id text, expected_revision_id text, expected_state_revision bigint, title text, payload jsonb, reason_code text, protected_reason text, idempotency_key text',
        'pi_human_executor',
        true,
        false
      ),
      (
        'calculate_impact',
        'project_id uuid, change_set_id text, expected_state_revision bigint, idempotency_key text',
        'pi_worker_executor',
        false,
        true
      ),
      (
        'review_impact',
        'project_id uuid, impact_run_id text, impact_id text, expected_impact_status text, disposition text, reason_code text, expected_state_revision bigint, idempotency_key text',
        'pi_human_executor',
        true,
        false
      ),
      (
        'build_handoff',
        'project_id uuid, impact_run_id text, expected_state_revision bigint, idempotency_key text',
        'pi_worker_executor',
        false,
        true
      )
  ) as required(
    name,
    identity_arguments,
    owner_name,
    authenticated_execute,
    service_execute
  )
  where not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'project_intelligence_api'
      and p.proname = required.name
      and pg_get_function_identity_arguments(p.oid) =
        required.identity_arguments
      and pg_get_function_result(p.oid) = 'jsonb'
      and p.prokind = 'f'
      and l.lanname = 'plpgsql'
      and p.prosecdef
      and not p.proleakproof
      and p.provolatile = 'v'
      and p.proparallel = 'u'
      and pg_get_userbyid(p.proowner) = required.owner_name
      and p.proconfig = array['search_path=""']
      and has_function_privilege(
        'authenticated',
        p.oid,
        'EXECUTE'
      ) = required.authenticated_execute
      and has_function_privilege(
        'service_role',
        p.oid,
        'EXECUTE'
      ) = required.service_execute
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
  )
  limit 1;

  if missing_api_function is not null then
    raise exception 'DB2_ASSERT_MISSING_OR_MISGRANTED_API:%', missing_api_function;
  end if;

  select format(
    '%I.%I(%s)',
    n.nspname,
    p.proname,
    pg_get_function_identity_arguments(p.oid)
  )
  into extra_api_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'project_intelligence_api'
    and (
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) not in (
      (
        'review_claim',
        'project_id uuid, target_revision_id text, expected_revision_id text, expected_state_revision bigint, decision text, idempotency_key text'
      ),
      (
        'publish_version',
        'project_id uuid, expected_latest_version_id text, expected_state_revision bigint, label text, selected_revisions jsonb, idempotency_key text'
      ),
      (
        'revise_decision',
        'project_id uuid, node_id text, base_version_id text, expected_revision_id text, expected_state_revision bigint, title text, payload jsonb, reason_code text, protected_reason text, idempotency_key text'
      ),
      (
        'calculate_impact',
        'project_id uuid, change_set_id text, expected_state_revision bigint, idempotency_key text'
      ),
      (
        'review_impact',
        'project_id uuid, impact_run_id text, impact_id text, expected_impact_status text, disposition text, reason_code text, expected_state_revision bigint, idempotency_key text'
      ),
      (
        'build_handoff',
        'project_id uuid, impact_run_id text, expected_state_revision bigint, idempotency_key text'
      )
    )
  limit 1;

  if extra_api_function is not null then
    raise exception 'DB2_ASSERT_EXTRA_API_FUNCTION:%', extra_api_function;
  end if;

  select format(
    '%I.%I(%s):%I',
    n.nspname,
    p.proname,
    pg_get_function_identity_arguments(p.oid),
    runtime_roles.role_name
  )
  into private_function_exposure
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (
    values ('anon'), ('authenticated'), ('service_role')
  ) as runtime_roles(role_name)
  where n.nspname = 'project_intelligence'
    and has_function_privilege(
      runtime_roles.role_name,
      p.oid,
      'EXECUTE'
    )
  limit 1;

  if private_function_exposure is not null then
    raise exception
      'DB2_ASSERT_PRIVATE_FUNCTION_EXPOSED:%',
      private_function_exposure;
  end if;

  select required.name
  into missing_private_trigger_guard
  from (
    values
      ('validate_revision_evidence'),
      ('validate_version_closure'),
      ('validate_change_publication'),
      ('validate_impact_path')
  ) as required(name)
  where not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'project_intelligence'
      and p.proname = required.name
      and pg_get_function_identity_arguments(p.oid) = ''
      and pg_get_function_result(p.oid) = 'trigger'
      and p.prokind = 'f'
      and l.lanname = 'plpgsql'
      and not p.prosecdef
      and not p.proleakproof
      and p.provolatile = 'v'
      and p.proparallel = 'u'
      and pg_get_userbyid(p.proowner) = 'pi_table_owner'
      and p.proconfig = array['search_path=""']
      and not exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  )
  limit 1;

  if missing_private_trigger_guard is not null then
    raise exception
      'DB2_ASSERT_MISCONFIGURED_CLOSURE_TRIGGER:%',
      missing_private_trigger_guard;
  end if;

  select format(
    '%I.%I(%s)',
    n.nspname,
    p.proname,
    pg_get_function_identity_arguments(p.oid)
  )
  into extra_private_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'project_intelligence'
    and p.prosecdef
    and (
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) not in (
      ('validate_revision_evidence', ''),
      ('validate_version_closure', ''),
      ('validate_change_publication', ''),
      ('validate_impact_path', ''),
      ('_request_user_id', ''),
      ('_request_jwt', '')
    )
  limit 1;

  if extra_private_definer is not null then
    raise exception
      'DB2_ASSERT_EXTRA_PRIVATE_DEFINER:%',
      extra_private_definer;
  end if;

  select required.name
  into missing_hash_helper
  from (
    values
      ('_sha256_text', 'p_value text', 'bytea', 'sql'),
      ('_canonical_jsonb', 'p_value jsonb', 'text', 'plpgsql'),
      ('_sha256_jsonb', 'p_value jsonb', 'bytea', 'sql')
  ) as required(name, identity_arguments, result_type, language_name)
  where not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'project_intelligence'
      and p.proname = required.name
      and pg_get_function_identity_arguments(p.oid) =
        required.identity_arguments
      and pg_get_function_result(p.oid) = required.result_type
      and p.prokind = 'f'
      and l.lanname = required.language_name
      and not p.prosecdef
      and p.provolatile = 'i'
      and p.proisstrict
      and p.proparallel = 'u'
      and pg_get_userbyid(p.proowner) = 'pi_table_owner'
      and p.proconfig = case required.name
        when '_canonical_jsonb' then
          array['search_path=""', 'extra_float_digits=3']
        else array['search_path=""']
      end
      and has_function_privilege('pi_human_executor', p.oid, 'EXECUTE')
      and has_function_privilege('pi_worker_executor', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  )
  limit 1;

  if missing_hash_helper is not null then
    raise exception
      'DB2_ASSERT_MISSING_CANONICAL_HASH_HELPER:%',
      missing_hash_helper;
  end if;

  with expected(role_name, function_name, identity_arguments) as (
    values
      ('pi_human_executor', 'is_valid_source_locator', 'p_locator_kind text, p_locator jsonb'),
      ('pi_human_executor', 'validate_revision_evidence', ''),
      ('pi_human_executor', 'validate_version_closure', ''),
      ('pi_human_executor', 'validate_change_publication', ''),
      ('pi_human_executor', 'validate_impact_path', ''),
      ('pi_human_executor', '_request_user_id', ''),
      ('pi_human_executor', '_request_jwt', ''),
      ('pi_human_executor', 'current_user_is_active_member', 'p_organization_id uuid'),
      ('pi_human_executor', 'current_user_has_capability', 'p_organization_id uuid, p_capability text'),
      ('pi_human_executor', '_raise_contract_error', 'p_sqlstate text, p_message text, p_detail jsonb'),
      ('pi_human_executor', '_sha256_text', 'p_value text'),
      ('pi_human_executor', '_canonical_jsonb', 'p_value jsonb'),
      ('pi_human_executor', '_sha256_jsonb', 'p_value jsonb'),
      ('pi_human_executor', '_assert_domain_id', 'p_value text, p_field text'),
      ('pi_human_executor', '_assert_idempotency_key', 'p_value text'),
      ('pi_human_executor', '_assert_state_revision', 'p_value bigint'),
      ('pi_human_executor', '_human_context', 'p_project_id uuid, p_capability text'),
      ('pi_human_executor', '_replay_or_null', 'p_organization_id uuid, p_project_id uuid, p_operation text, p_key_digest bytea, p_request_digest bytea'),
      ('pi_human_executor', '_lock_workflow', 'p_organization_id uuid, p_project_id uuid'),
      ('pi_human_executor', '_complete_command', 'p_organization_id uuid, p_project_id uuid, p_operation text, p_key_digest bytea, p_request_digest bytea, p_actor_type text, p_actor_id text, p_actor_user_id uuid, p_logical_result jsonb, p_event_type text, p_controlled_metadata jsonb, p_previous_state_revision bigint, p_set_latest_version boolean, p_latest_version_id text'),
      ('pi_worker_executor', 'is_valid_source_locator', 'p_locator_kind text, p_locator jsonb'),
      ('pi_worker_executor', 'validate_revision_evidence', ''),
      ('pi_worker_executor', 'validate_version_closure', ''),
      ('pi_worker_executor', 'validate_change_publication', ''),
      ('pi_worker_executor', 'validate_impact_path', ''),
      ('pi_worker_executor', '_request_user_id', ''),
      ('pi_worker_executor', '_request_jwt', ''),
      ('pi_worker_executor', '_raise_contract_error', 'p_sqlstate text, p_message text, p_detail jsonb'),
      ('pi_worker_executor', '_sha256_text', 'p_value text'),
      ('pi_worker_executor', '_canonical_jsonb', 'p_value jsonb'),
      ('pi_worker_executor', '_sha256_jsonb', 'p_value jsonb'),
      ('pi_worker_executor', '_assert_domain_id', 'p_value text, p_field text'),
      ('pi_worker_executor', '_assert_idempotency_key', 'p_value text'),
      ('pi_worker_executor', '_assert_state_revision', 'p_value bigint'),
      ('pi_worker_executor', '_worker_context', 'p_project_id uuid'),
      ('pi_worker_executor', '_replay_or_null', 'p_organization_id uuid, p_project_id uuid, p_operation text, p_key_digest bytea, p_request_digest bytea'),
      ('pi_worker_executor', '_lock_workflow', 'p_organization_id uuid, p_project_id uuid'),
      ('pi_worker_executor', '_json_pointer_segment', 'p_value text'),
      ('pi_worker_executor', '_jsonb_diff_paths', 'p_from jsonb, p_to jsonb, p_path text'),
      ('pi_worker_executor', '_complete_command', 'p_organization_id uuid, p_project_id uuid, p_operation text, p_key_digest bytea, p_request_digest bytea, p_actor_type text, p_actor_id text, p_actor_user_id uuid, p_logical_result jsonb, p_event_type text, p_controlled_metadata jsonb, p_previous_state_revision bigint, p_set_latest_version boolean, p_latest_version_id text')
  ),
  actual as (
    select
      grantee.rolname::text as role_name,
      p.proname::text as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    join pg_roles grantee on grantee.oid = acl.grantee
    where n.nspname = 'project_intelligence'
      and grantee.rolname in ('pi_human_executor', 'pi_worker_executor')
      and acl.privilege_type = 'EXECUTE'
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select format('%I:%I(%s)', role_name, function_name, identity_arguments)
  into private_function_privilege_problem
  from differences
  limit 1;

  if private_function_privilege_problem is not null then
    raise exception
      'DB2_ASSERT_PRIVATE_FUNCTION_PRIVILEGE:%',
      private_function_privilege_problem;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'project_intelligence'
      and p.proname = '_complete_command'
      and pg_get_function_identity_arguments(p.oid) =
        'p_organization_id uuid, p_project_id uuid, p_operation text, p_key_digest bytea, p_request_digest bytea, p_actor_type text, p_actor_id text, p_actor_user_id uuid, p_logical_result jsonb, p_event_type text, p_controlled_metadata jsonb, p_previous_state_revision bigint, p_set_latest_version boolean, p_latest_version_id text'
      and pg_get_function_result(p.oid) = 'jsonb'
      and p.prokind = 'f'
      and l.lanname = 'plpgsql'
      and not p.prosecdef
      and p.provolatile = 'v'
      and p.proparallel = 'u'
      and pg_get_userbyid(p.proowner) = 'pi_table_owner'
      and p.proconfig = array['search_path=""']
      and regexp_replace(
        pg_get_functiondef(p.oid),
        '[[:space:]]+',
        ' ',
        'g'
      ) ~*
        'SET CONSTRAINTS project_intelligence[.]graph_node_revisions_evidence_closure, project_intelligence[.]project_versions_closure, project_intelligence[.]change_set_publications_closure, project_intelligence[.]impacts_path_closure IMMEDIATE'
      and regexp_replace(
        pg_get_functiondef(p.oid),
        '[[:space:]]+',
        ' ',
        'g'
      ) ~*
        'SET CONSTRAINTS project_intelligence[.]graph_node_revisions_evidence_closure, project_intelligence[.]project_versions_closure, project_intelligence[.]change_set_publications_closure, project_intelligence[.]impacts_path_closure DEFERRED'
  ) then
    raise exception 'DB2_ASSERT_CLOSURE_FLUSH_GUARD_MISSING';
  end if;

  select role_name
  into schema_privilege_problem
  from (
    select 'PUBLIC'::text as role_name
    where exists (
      select 1
      from pg_namespace n
      cross join lateral aclexplode(
        coalesce(n.nspacl, acldefault('n', n.nspowner))
      ) acl
      where n.nspname = 'project_intelligence_api'
        and acl.grantee = 0
        and acl.privilege_type in ('USAGE', 'CREATE')
    )

    union all

    select runtime_roles.role_name
    from (
      values
        ('anon', false),
        ('authenticated', true),
        ('service_role', true)
    ) as runtime_roles(role_name, should_have_usage)
    where has_schema_privilege(
      runtime_roles.role_name,
      'project_intelligence_api',
      'USAGE'
    ) is distinct from runtime_roles.should_have_usage
       or has_schema_privilege(
         runtime_roles.role_name,
         'project_intelligence_api',
         'CREATE'
       )
  ) problems
  limit 1;

  if schema_privilege_problem is not null then
    raise exception
      'DB2_ASSERT_API_SCHEMA_PRIVILEGE:%',
      schema_privilege_problem;
  end if;

  select role_name
  into crypto_privilege_problem
  from (
    select expected.role_name
    from (
      values
        ('pi_table_owner', true),
        ('pi_human_executor', true),
        ('pi_worker_executor', true),
        ('anon', false),
        ('authenticated', false),
        ('service_role', false)
    ) as expected(role_name, should_have_access)
    where has_schema_privilege(
      expected.role_name,
      'extensions',
      'USAGE'
    ) is distinct from expected.should_have_access
       or (
         expected.should_have_access
         and not has_function_privilege(
           expected.role_name,
           'extensions.digest(bytea,text)',
           'EXECUTE'
         )
       )

    union all

    select 'PUBLIC'
    from pg_namespace n
    cross join lateral aclexplode(
      coalesce(n.nspacl, acldefault('n', n.nspowner))
    ) acl
    where n.nspname = 'extensions'
      and acl.grantee = 0
      and acl.privilege_type = 'USAGE'
  ) problems
  limit 1;

  if crypto_privilege_problem is not null then
    raise exception
      'DB2_ASSERT_CRYPTO_PRIVILEGE:%',
      crypto_privilege_problem;
  end if;

  select r.rolname
  into unsafe_role
  from pg_roles r
  where r.rolname in ('pi_table_owner', 'pi_human_executor', 'pi_worker_executor')
    and (r.rolcanlogin or r.rolinherit or r.rolbypassrls or r.rolsuper)
  limit 1;

  if unsafe_role is not null then
    raise exception 'DB2_ASSERT_UNSAFE_ROLE:%', unsafe_role;
  end if;

  select format('%I.%I', n.nspname, c.relname)
  into unsafe_table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'project_intelligence'
    and c.relkind in ('r', 'p')
    and pg_get_userbyid(c.relowner) <> 'pi_table_owner'
  limit 1;

  if unsafe_table is not null then
    raise exception 'DB2_ASSERT_WRONG_TABLE_OWNER:%', unsafe_table;
  end if;

  select format('%I.%I', n.nspname, c.relname)
  into missing_force_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'project_intelligence'
    and c.relkind in ('r', 'p')
    and (not c.relrowsecurity or not c.relforcerowsecurity)
  limit 1;

  if missing_force_rls is not null then
    raise exception 'DB2_ASSERT_RLS_NOT_FORCED:%', missing_force_rls;
  end if;

  select format('%I.%I:%I', table_schema, table_name, grantee)
  into exposed_table
  from information_schema.role_table_grants
  where table_schema = 'project_intelligence'
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  limit 1;

  if exposed_table is not null then
    raise exception 'DB2_ASSERT_DIRECT_TABLE_GRANT:%', exposed_table;
  end if;

  with
  table_names(name) as (
    values
      ('deployment_cells'),
      ('organizations'),
      ('organization_members'),
      ('member_capabilities'),
      ('project_workflows'),
      ('sources'),
      ('source_fragments'),
      ('graph_nodes'),
      ('graph_node_revisions'),
      ('human_reviews'),
      ('evidence_links'),
      ('graph_edges'),
      ('project_versions'),
      ('version_nodes'),
      ('version_reviews'),
      ('version_sources'),
      ('version_source_fragments'),
      ('version_evidence_links'),
      ('version_edges'),
      ('change_sets'),
      ('change_set_reasons'),
      ('change_set_publications'),
      ('impact_runs'),
      ('impact_run_changes'),
      ('impacts'),
      ('impact_path_steps'),
      ('impact_reviews'),
      ('logical_handoffs'),
      ('handoff_impact_reviews'),
      ('command_records'),
      ('audit_events')
  ),
  append_only(name) as (
    values
      ('sources'),
      ('source_fragments'),
      ('graph_node_revisions'),
      ('human_reviews'),
      ('evidence_links'),
      ('graph_edges'),
      ('project_versions'),
      ('version_nodes'),
      ('version_reviews'),
      ('version_sources'),
      ('version_source_fragments'),
      ('version_evidence_links'),
      ('version_edges'),
      ('change_sets'),
      ('change_set_reasons'),
      ('change_set_publications'),
      ('impact_runs'),
      ('impact_run_changes'),
      ('impacts'),
      ('impact_path_steps'),
      ('impact_reviews'),
      ('logical_handoffs'),
      ('handoff_impact_reviews'),
      ('command_records'),
      ('audit_events')
  ),
  human_insert(name) as (
    values
      ('graph_node_revisions'),
      ('human_reviews'),
      ('project_versions'),
      ('version_nodes'),
      ('version_reviews'),
      ('version_sources'),
      ('version_source_fragments'),
      ('version_evidence_links'),
      ('version_edges'),
      ('change_sets'),
      ('change_set_reasons'),
      ('change_set_publications'),
      ('impact_reviews'),
      ('command_records'),
      ('audit_events')
  ),
  worker_insert(name) as (
    values
      ('impact_runs'),
      ('impact_run_changes'),
      ('impacts'),
      ('impact_path_steps'),
      ('logical_handoffs'),
      ('handoff_impact_reviews'),
      ('command_records'),
      ('audit_events')
  ),
  expected(role_name, table_name, privilege_type) as (
    select 'pi_human_executor', name, 'SELECT' from table_names
    union all
    select 'pi_worker_executor', name, 'SELECT' from table_names
    union all
    select 'pi_human_executor', name, 'UPDATE' from append_only
    union all
    select 'pi_worker_executor', name, 'UPDATE' from append_only
    union all
    values
      ('pi_human_executor', 'project_workflows', 'UPDATE'),
      ('pi_worker_executor', 'project_workflows', 'UPDATE'),
      ('pi_human_executor', 'graph_nodes', 'UPDATE')
    union all
    select 'pi_human_executor', name, 'INSERT' from human_insert
    union all
    select 'pi_worker_executor', name, 'INSERT' from worker_insert
  ),
  actual as (
    select
      grantee::text as role_name,
      table_name::text,
      privilege_type::text
    from information_schema.role_table_grants
    where table_schema = 'project_intelligence'
      and grantee in ('pi_human_executor', 'pi_worker_executor')
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select format('%I:%I:%s', role_name, table_name, privilege_type)
  into executor_table_privilege_problem
  from differences
  limit 1;

  if executor_table_privilege_problem is not null then
    raise exception
      'DB2_ASSERT_EXECUTOR_TABLE_PRIVILEGE:%',
      executor_table_privilege_problem;
  end if;

  select role_name
  into exposed_core_schema
  from (
    select runtime_roles.role_name
    from (
      values ('anon'), ('authenticated'), ('service_role')
    ) as runtime_roles(role_name)
    where has_schema_privilege(
      runtime_roles.role_name,
      'project_intelligence',
      'USAGE'
    )

    union all

    select 'PUBLIC'
    from pg_namespace n
    cross join lateral aclexplode(
      coalesce(n.nspacl, acldefault('n', n.nspowner))
    ) acl
    where n.nspname = 'project_intelligence'
      and acl.grantee = 0
      and acl.privilege_type = 'USAGE'
  ) exposed_roles
  limit 1;

  if exposed_core_schema is not null then
    raise exception 'DB2_ASSERT_CORE_SCHEMA_EXPOSED:%', exposed_core_schema;
  end if;

  select format('%I.%I', n.nspname, c.relname)
  into api_table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'project_intelligence_api'
    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  limit 1;

  if api_table is not null then
    raise exception 'DB2_ASSERT_TABLE_IN_API_SCHEMA:%', api_table;
  end if;

  select format(
    '%I.%I(%s)',
    n.nspname,
    p.proname,
    pg_get_function_identity_arguments(p.oid)
  )
  into unsafe_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('project_intelligence', 'project_intelligence_api')
    and p.prosecdef
    and (
      pg_get_userbyid(p.proowner) not in (
        'pi_table_owner',
        'pi_human_executor',
        'pi_worker_executor'
      )
      or coalesce(array_to_string(p.proconfig, ','), '') !~ '(^|,)search_path=""(,|$)'
      or exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    )
  limit 1;

  if unsafe_function is not null then
    raise exception 'DB2_ASSERT_UNSAFE_DEFINER:%', unsafe_function;
  end if;

  select format(
    '%I:%I:%I',
    coalesce(n.nspname, '<all schemas>'),
    pg_get_userbyid(d.defaclrole),
    coalesce(grantee.rolname, 'PUBLIC')
  )
  into exposed_default
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) acl
  left join pg_roles grantee on grantee.oid = acl.grantee
  where n.nspname in ('project_intelligence', 'project_intelligence_api')
    and coalesce(grantee.rolname, 'PUBLIC') in (
      'PUBLIC',
      'anon',
      'authenticated',
      'service_role'
    )
  limit 1;

  if exposed_default is not null then
    raise exception 'DB2_ASSERT_UNSAFE_DEFAULT_ACL:%', exposed_default;
  end if;

  with project_tables as (
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'project_intelligence'
      and c.relkind in ('r', 'p')
      and c.relname <> 'project_workflows'
      and exists (
        select 1
        from pg_attribute a
        where a.attrelid = c.oid
          and a.attname = 'organization_id'
          and not a.attisdropped
      )
      and exists (
        select 1
        from pg_attribute a
        where a.attrelid = c.oid
          and a.attname = 'project_id'
          and not a.attisdropped
      )
  )
  select pt.relname
  into missing_root_fk
  from project_tables pt
  where not exists (
    select 1
    from pg_constraint con
    join pg_class target on target.oid = con.confrelid
    join pg_namespace target_schema on target_schema.oid = target.relnamespace
    where con.conrelid = pt.oid
      and con.contype = 'f'
      and target_schema.nspname = 'project_intelligence'
      and target.relname = 'project_workflows'
      and (
        select array_agg(att.attname::text order by key_position.ordinality)
        from unnest(con.conkey) with ordinality as key_position(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = con.conrelid
         and att.attnum = key_position.attnum
      ) = array['organization_id', 'project_id']
  )
  limit 1;

  if missing_root_fk is not null then
    raise exception 'DB2_ASSERT_MISSING_PROJECT_ROOT_FK:%', missing_root_fk;
  end if;

  with foreign_keys as (
    select
      con.oid as constraint_oid,
      con.conrelid,
      con.conkey,
      format('%I.%I:%I',
        n.nspname,
        c.relname,
        con.conname
      ) as identity
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f'
      and n.nspname = 'project_intelligence'
  )
  select fk.identity
  into missing_fk_index
  from foreign_keys fk
  where not exists (
    select 1
    from pg_index i
    where i.indrelid = fk.conrelid
      and i.indisvalid
      and i.indisready
      and i.indnkeyatts >= cardinality(fk.conkey)
      and not exists (
        select 1
        from generate_subscripts(fk.conkey, 1) as key_position
        where (i.indkey::smallint[])[key_position - 1]
          is distinct from fk.conkey[key_position]
      )
  )
  limit 1;

  if missing_fk_index is not null then
    raise exception 'DB2_ASSERT_FK_WITHOUT_LEADING_INDEX:%', missing_fk_index;
  end if;

  select format('%I.%I:%I', n.nspname, c.relname, con.conname)
  into cascade_history_fk
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f'
    and n.nspname = 'project_intelligence'
    and c.relname in (
      'source_fragments',
      'graph_node_revisions',
      'human_reviews',
      'evidence_links',
      'project_versions',
      'version_nodes',
      'version_reviews',
      'version_sources',
      'version_source_fragments',
      'version_evidence_links',
      'version_edges',
      'change_sets',
      'change_set_reasons',
      'change_set_publications',
      'impact_runs',
      'impact_run_changes',
      'impacts',
      'impact_path_steps',
      'impact_reviews',
      'logical_handoffs',
      'handoff_impact_reviews',
      'command_records',
      'audit_events'
    )
    and con.confdeltype = 'c'
  limit 1;

  if cascade_history_fk is not null then
    raise exception 'DB2_ASSERT_CASCADE_ON_HISTORY:%', cascade_history_fk;
  end if;

  select required.trigger_name
  into missing_closure_trigger
  from (
    values
      (
        'graph_node_revisions_evidence_closure',
        'graph_node_revisions',
        'validate_revision_evidence'
      ),
      (
        'project_versions_closure',
        'project_versions',
        'validate_version_closure'
      ),
      (
        'change_set_publications_closure',
        'change_set_publications',
        'validate_change_publication'
      ),
      (
        'impacts_path_closure',
        'impacts',
        'validate_impact_path'
      )
  ) as required(trigger_name, table_name, function_name)
  where not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where n.nspname = 'project_intelligence'
      and c.relname = required.table_name
      and t.tgname = required.trigger_name
      and not t.tgisinternal
      and t.tgconstraint <> 0
      and t.tgenabled = 'O'
      and t.tgdeferrable
      and t.tginitdeferred
      and (t.tgtype & 1) = 1
      and (t.tgtype & 2) = 0
      and (t.tgtype & 4) = 4
      and (t.tgtype & 8) = 0
      and (t.tgtype & 16) = 16
      and (t.tgtype & 32) = 0
      and (t.tgtype & 64) = 0
      and pn.nspname = 'project_intelligence'
      and p.proname = required.function_name
      and pg_get_function_identity_arguments(p.oid) = ''
  )
  limit 1;

  if missing_closure_trigger is not null then
    raise exception
      'DB2_ASSERT_MISSING_CLOSURE_TRIGGER:%',
      missing_closure_trigger;
  end if;

  select required.name
  into missing_append_only
  from (
    values
      ('sources'),
      ('source_fragments'),
      ('graph_node_revisions'),
      ('human_reviews'),
      ('evidence_links'),
      ('graph_edges'),
      ('project_versions'),
      ('version_nodes'),
      ('version_reviews'),
      ('version_sources'),
      ('version_source_fragments'),
      ('version_evidence_links'),
      ('version_edges'),
      ('change_sets'),
      ('change_set_reasons'),
      ('change_set_publications'),
      ('impact_runs'),
      ('impact_run_changes'),
      ('impacts'),
      ('impact_path_steps'),
      ('impact_reviews'),
      ('logical_handoffs'),
      ('handoff_impact_reviews'),
      ('command_records'),
      ('audit_events')
  ) as required(name)
  where not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'project_intelligence'
      and c.relname = required.name
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and (t.tgtype & 2) = 2
      and (t.tgtype & 8) = 8
      and (t.tgtype & 16) = 16
      and t.tgfoid = to_regprocedure(
        'project_intelligence.reject_append_only_mutation()'
      )
  )
  limit 1;

  if missing_append_only is not null then
    raise exception 'DB2_ASSERT_MISSING_APPEND_ONLY_TRIGGER:%', missing_append_only;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'project_intelligence'
      and r.relname = 'impacts'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%distance%'
      and pg_get_constraintdef(c.oid) ilike '%1%'
      and pg_get_constraintdef(c.oid) ilike '%64%'
  ) then
    raise exception 'DB2_ASSERT_IMPACT_DEPTH_CAP_MISSING';
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'project_intelligence'
      and r.relname = 'impact_path_steps'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%step_no%'
      and pg_get_constraintdef(c.oid) ilike '%0%'
      and pg_get_constraintdef(c.oid) ilike '%63%'
  ) then
    raise exception 'DB2_ASSERT_IMPACT_STEP_CAP_MISSING';
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'project_intelligence'
      and r.relname = 'impact_runs'
      and c.conname = 'impact_runs_publication_fkey'
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) like '%change_set_id, to_version_id%'
  ) then
    raise exception 'DB2_ASSERT_IMPACT_PUBLICATION_COMPOSITE_FK_MISSING';
  end if;
end
$assert$;

select 'DB2_SCHEMA_ASSERTIONS_OK' as result;
