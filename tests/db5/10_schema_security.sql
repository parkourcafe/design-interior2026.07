\set ON_ERROR_STOP on

do $db5_schema_security$
declare
  v_missing text;
  v_problem text;
  v_count bigint;
begin
  select expected.name into v_missing
  from (values ('projectceo_m4'), ('projectceo_m4_api')) expected(name)
  where not exists (
    select 1 from pg_namespace namespace
    where namespace.nspname = expected.name
  )
  limit 1;
  if v_missing is not null then
    raise exception 'DB5_MISSING_SCHEMA:%', v_missing;
  end if;

  select expected.name into v_missing
  from (values
    ('change_requests'),
    ('change_request_roots'),
    ('impact_runs'),
    ('impacts'),
    ('impact_path_steps'),
    ('impact_reviews'),
    ('milestones'),
    ('milestone_areas'),
    ('photo_evidence'),
    ('photo_evidence_reviews'),
    ('milestone_acceptances'),
    ('handover_documents'),
    ('construction_handovers'),
    ('handover_milestone_refs'),
    ('handover_photo_refs'),
    ('handover_document_refs')
  ) expected(name)
  where not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'projectceo_m4'
      and relation.relname = expected.name
      and relation.relkind in ('r', 'p')
  )
  limit 1;
  if v_missing is not null then
    raise exception 'DB5_MISSING_TABLE:%', v_missing;
  end if;

  select format('%I.%I', namespace.nspname, relation.relname)
  into v_problem
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'projectceo_m4'
    and relation.relkind in ('r', 'p')
    and (
      pg_get_userbyid(relation.relowner) <> 'pi_table_owner'
      or not relation.relrowsecurity
      or not relation.relforcerowsecurity
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_TABLE_SECURITY:%', v_problem;
  end if;

  select format('%I:%I', grant_row.table_name, grant_row.grantee)
  into v_problem
  from information_schema.role_table_grants grant_row
  where grant_row.table_schema = 'projectceo_m4'
    and grant_row.grantee in (
      'PUBLIC', 'anon', 'authenticated', 'service_role',
      'pi_human_executor', 'pi_worker_executor'
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_DIRECT_TABLE_GRANT:%', v_problem;
  end if;

  select format(
    '%I.%I:%I',
    namespace.nspname,
    relation.relname,
    constraint_row.conname
  )
  into v_problem
  from pg_constraint constraint_row
  join pg_class relation on relation.oid = constraint_row.conrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'projectceo_m4'
    and constraint_row.contype = 'f'
    and not exists (
      select 1
      from pg_index index_row
      where index_row.indrelid = constraint_row.conrelid
        and index_row.indisvalid
        and index_row.indisready
        and index_row.indnkeyatts >= cardinality(constraint_row.conkey)
        and not exists (
          select 1
          from generate_subscripts(constraint_row.conkey, 1) position
          where index_row.indkey[position - 1] <>
            constraint_row.conkey[position]
        )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_UNINDEXED_FOREIGN_KEY:%', v_problem;
  end if;

  select format(
    '%I(%s)',
    procedure.proname,
    pg_get_function_identity_arguments(procedure.oid)
  )
  into v_problem
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('projectceo_m4', 'projectceo_m4_api')
    and procedure.prosecdef
    and (
      pg_get_userbyid(procedure.proowner) <> 'pi_table_owner'
      or coalesce(array_to_string(procedure.proconfig, ','), '') !~
        '(^|,)search_path=""(,|$)'
      or exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_UNSAFE_DEFINER:%', v_problem;
  end if;

  select expected.signature into v_missing
  from (values
    ('projectceo_m4_api.submit_change_request(uuid,uuid,text,text,text,text,bigint,integer,bigint,text)'),
    ('projectceo_m4_api.calculate_change_impact(uuid,uuid,integer,bigint,text)'),
    ('projectceo_m4_api.review_change_impact(uuid,uuid,text,text,text,bigint,text)'),
    ('projectceo_m4_api.define_milestone(uuid,uuid,text,text,jsonb,bigint,text)'),
    ('projectceo_m4_api.register_photo_evidence(uuid,uuid,text,text,text,timestamp with time zone,text,bigint,text)'),
    ('projectceo_m4_api.review_photo_evidence(uuid,uuid,text,text,bigint,text)'),
    ('projectceo_m4_api.accept_milestone(uuid,uuid,bigint,text)'),
    ('projectceo_m4_api.register_handover_document(uuid,uuid,text,text,text,text,bigint,text)'),
    ('projectceo_m4_api.build_construction_handover(uuid,uuid,text,bigint,text)'),
    ('projectceo_m4_api.get_execution_delivery(uuid,uuid)')
  ) expected(signature)
  where to_regprocedure(expected.signature) is null
  limit 1;
  if v_missing is not null then
    raise exception 'DB5_MISSING_RPC:%', v_missing;
  end if;

  select count(*) into v_count
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_m4_api'
    and procedure.prokind = 'f';
  if v_count <> 10 then
    raise exception 'DB5_UNEXPECTED_RPC_COUNT:%', v_count;
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid =
      'projectceo_m4.handover_photo_refs'::regclass
      and constraint_row.conname = 'm4_handover_photo_review_fkey'
      and pg_get_constraintdef(constraint_row.oid) like
        '%photo_review_id, photo_evidence_id, package_id, production_package_version_id, decision%'
  ) then
    raise exception 'DB5_HANDOVER_PHOTO_EXACT_PACKAGE_FK_MISSING';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid =
      'projectceo_product.production_package_versions'::regclass
      and trigger_row.tgname = 'm4_product_release_impact_review'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'projectceo_m4.photo_evidence'::regclass
      and trigger_row.tgname = 'm4_photo_evidence_open_milestone'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid =
      'projectceo_m4.photo_evidence_reviews'::regclass
      and trigger_row.tgname = 'm4_photo_review_open_milestone'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'DB5_RELEASE_OR_ACCEPTANCE_CLOSURE_TRIGGER_MISSING';
  end if;

  if has_function_privilege(
    'service_role',
    'projectceo_m4_api.submit_change_request(uuid,uuid,text,text,text,text,bigint,integer,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'projectceo_m4_api.accept_milestone(uuid,uuid,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'projectceo_m4_api.calculate_change_impact(uuid,uuid,integer,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'projectceo_m4_api.build_construction_handover(uuid,uuid,text,bigint,text)',
    'EXECUTE'
  ) then
    raise exception 'DB5_EXECUTOR_ROLE_BOUNDARY_BROKEN';
  end if;

  if (
    select count(*)
    from pg_trigger trigger_row
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'projectceo_m4'
      and relation.relkind in ('r', 'p')
      and not trigger_row.tgisinternal
      and trigger_row.tgname like '%_append_only'
  ) <> 16 then
    raise exception 'DB5_APPEND_ONLY_TRIGGER_COUNT';
  end if;
end
$db5_schema_security$;

select 'DB5_SCHEMA_SECURITY_OK' as result;
