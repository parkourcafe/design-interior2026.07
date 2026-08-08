\set ON_ERROR_STOP on

do $db4_schema_security$
declare
  v_missing text;
  v_problem text;
  v_count bigint;
begin
  select expected.name into v_missing
  from (values
    ('projectceo_product'),
    ('projectceo_product_api')
  ) expected(name)
  where not exists (
    select 1
    from pg_namespace n
    where n.nspname = expected.name
  )
  limit 1;
  if v_missing is not null then
    raise exception 'DB4_MISSING_SCHEMA:%', v_missing;
  end if;

  select expected.name into v_missing
  from (values
    ('claim_revision_descriptors'),
    ('revision_evidence_refs'),
    ('price_observations'),
    ('approval_packages'),
    ('approval_package_items'),
    ('approval_package_events'),
    ('project_baselines'),
    ('project_baseline_packages'),
    ('project_baseline_refs'),
    ('project_baseline_approvals'),
    ('production_package_versions'),
    ('production_package_version_refs'),
    ('release_artifacts'),
    ('release_distributions'),
    ('release_acknowledgements'),
    ('no_change_terminals'),
    ('command_records'),
    ('audit_events')
  ) expected(name)
  where not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'projectceo_product'
      and c.relname = expected.name
      and c.relkind in ('r', 'p')
  )
  limit 1;
  if v_missing is not null then
    raise exception 'DB4_MISSING_TABLE:%', v_missing;
  end if;

  if pg_get_constraintdef(
    (
      select c.oid
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'project_intelligence'
        and t.relname = 'graph_nodes'
        and c.conname = 'graph_nodes_kind_check'
    )
  ) !~ '''selection''' then
    raise exception 'DB4_SELECTION_GRAPH_KIND_MISSING';
  end if;
  if pg_get_constraintdef(
    (
      select c.oid
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'project_intelligence'
        and t.relname = 'graph_node_revisions'
        and c.conname = 'graph_node_revisions_claim_status_check'
    )
  ) !~ '''human_origin''' then
    raise exception 'DB4_HUMAN_ORIGIN_STATUS_MISSING';
  end if;

  select format('%I.%I', n.nspname, c.relname)
  into v_problem
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'projectceo_product'
    and c.relkind in ('r', 'p')
    and (
      pg_get_userbyid(c.relowner) <> 'pi_table_owner'
      or not c.relrowsecurity
      or not c.relforcerowsecurity
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB4_TABLE_SECURITY:%', v_problem;
  end if;

  select format('%I:%I', table_name, grantee)
  into v_problem
  from information_schema.role_table_grants
  where table_schema = 'projectceo_product'
    and grantee in (
      'PUBLIC',
      'anon',
      'authenticated',
      'service_role',
      'pi_human_executor',
      'pi_worker_executor'
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB4_DIRECT_TABLE_GRANT:%', v_problem;
  end if;

  select format('%I.%I:%I', n.nspname, t.relname, c.conname)
  into v_problem
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'projectceo_product'
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
    raise exception 'DB4_UNINDEXED_FOREIGN_KEY:%', v_problem;
  end if;

  select expected.name into v_missing
  from (values
    ('claim_revision_descriptors_replaces_node_fkey'),
    ('production_package_versions_previous_package_fkey'),
    ('production_package_versions_baseline_package_fkey'),
    ('production_package_version_refs_exact_baseline_fkey'),
    ('release_artifacts_exact_package_version_fkey'),
    ('release_distributions_exact_artifact_fkey'),
    ('release_acknowledgements_exact_distribution_fkey'),
    ('no_change_terminals_exact_package_version_fkey')
  ) expected(name)
  where not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'projectceo_product'
      and c.contype = 'f'
      and c.conname = expected.name
  )
  limit 1;
  if v_missing is not null then
    raise exception 'DB4_MISSING_EXACT_COMPOSITE_FK:%', v_missing;
  end if;

  select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
  into v_problem
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in (
    'projectceo_product',
    'projectceo_product_api'
  )
    and p.prosecdef
    and (
      pg_get_userbyid(p.proowner) <> 'pi_table_owner'
      or coalesce(array_to_string(p.proconfig, ','), '') !~
        '(^|,)search_path=""(,|$)'
      or exists (
        select 1
        from aclexplode(
          coalesce(p.proacl, acldefault('f', p.proowner))
        ) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB4_UNSAFE_DEFINER:%', v_problem;
  end if;

  select expected.signature into v_missing
  from (values
    ('projectceo_product_api.append_decision_revision(uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,bigint,text)'),
    ('projectceo_product_api.append_selection_revision(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,text,bigint,text)'),
    ('projectceo_product_api.append_system_decision_revision(uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,bigint,text)'),
    ('projectceo_product_api.append_system_selection_revision(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,text,bigint,text)'),
    ('projectceo_product_api.append_price_observation(uuid,text,text,bigint,jsonb,text,bigint,text)'),
    ('projectceo_product_api.create_approval_package(uuid,uuid,text,jsonb,bigint,text)'),
    ('projectceo_product_api.submit_approval_package(uuid,text,text,bigint,text)'),
    ('projectceo_product_api.review_approval_package(uuid,text,text,text,text,bigint,text)'),
    ('projectceo_product_api.publish_project_baseline(uuid,jsonb,bigint,text)'),
    ('projectceo_product_api.publish_production_package_version(uuid,jsonb,bigint,text)'),
    ('projectceo_product_api.build_release_artifact(uuid,jsonb,bigint,text)'),
    ('projectceo_product_api.distribute_release(uuid,text,uuid,bigint,text)'),
    ('projectceo_product_api.acknowledge_release(uuid,uuid,text,bigint,text)'),
    ('projectceo_product_api.distribute_release_request_bound(uuid,text,uuid,bigint,text)'),
    ('projectceo_product_api.acknowledge_release_request_bound(uuid,uuid,text,bigint,text)'),
    ('projectceo_product_api.approve_no_change(uuid,text,text,text,bigint,text)'),
    ('projectceo_product_api.append_m2_workspace_revision(uuid,uuid,text,text,text,text,text,jsonb,text,bigint,text)')
  ) expected(signature)
  where to_regprocedure(expected.signature) is null
  limit 1;
  if v_missing is not null then
    raise exception 'DB4_MISSING_RPC:%', v_missing;
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_product_api'
    and p.prokind = 'f';
  if v_count <> 17 then
    raise exception 'DB4_UNEXPECTED_RPC_COUNT:%', v_count;
  end if;

  if has_function_privilege(
    'service_role',
    'projectceo_product_api.append_decision_revision(uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'projectceo_product_api.review_approval_package(uuid,text,text,text,text,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'pi_worker_executor',
    'projectceo_product_api.append_decision_revision(uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,bigint,text)',
    'EXECUTE'
  ) then
    raise exception 'DB4_HUMAN_RPC_EXECUTOR_EXPOSURE';
  end if;

  if has_function_privilege(
    'authenticated',
    'projectceo_product_api.append_system_decision_revision(uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'projectceo_product_api.build_release_artifact(uuid,jsonb,bigint,text)',
    'EXECUTE'
  ) then
    raise exception 'DB4_WORKER_RPC_HUMAN_EXPOSURE';
  end if;
end
$db4_schema_security$;

select 'DB4_SCHEMA_SECURITY_OK' as result;
