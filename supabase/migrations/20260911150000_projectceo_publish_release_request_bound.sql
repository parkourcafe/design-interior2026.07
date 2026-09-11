-- S-MIG #6: root release is derived entirely from the current published
-- baseline. The caller supplies no package, revision refs, or semantic hash.
begin;

do $operation_dictionary$
declare old_ops text[]; new_ops text[]; lost text;
begin
  select array_agg(m[1] order by m[1]) into old_ops
  from pg_catalog.pg_constraint c,
    lateral regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), $r$'([a-z0-9_]+)'$r$, 'g') m
  where c.conname = 'command_records_operation_check'
    and c.conrelid = 'projectceo_product.command_records'::regclass;
  if old_ops is null then raise exception 'PROJECTCEO_COMMAND_OPERATION_CHECK_MISSING'; end if;
  alter table projectceo_product.command_records drop constraint command_records_operation_check;
  execute format(
    'alter table projectceo_product.command_records add constraint command_records_operation_check check (operation = any (array[%s]))',
    (select string_agg(quote_literal(value), ', ' order by value)
     from (select distinct value from unnest(old_ops || array['publish_release_request_bound']) value) x)
  );
  select array_agg(m[1] order by m[1]) into new_ops
  from pg_catalog.pg_constraint c,
    lateral regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), $r$'([a-z0-9_]+)'$r$, 'g') m
  where c.conname = 'command_records_operation_check'
    and c.conrelid = 'projectceo_product.command_records'::regclass;
  select value into lost from unnest(old_ops) value where not value = any(new_ops) limit 1;
  if lost is not null then raise exception 'PROJECTCEO_COMMAND_OPERATION_DROPPED:%', lost; end if;
end
$operation_dictionary$;

create function projectceo_product_api.publish_release_request_bound(
  project_id uuid, expected_baseline_id text, expected_previous_version_id text,
  expected_state_revision bigint, command_ref text, idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
#variable_conflict use_variable
declare
  root_package_id uuid; ctx record; command_text text; key_digest bytea;
  request_digest bytea; current_state bigint; replay jsonb; current_baseline text;
  current_previous text; source_ids text[]; requirement_ids text[];
  assumption_ids text[]; decision_ids text[]; selection_ids text[]; total_refs bigint;
  content jsonb; descriptor jsonb; inner_key text; raw jsonb; result jsonb; result_state bigint;
begin
  command_text := projectceo_product._assert_text(command_ref, 'commandRef', 120);
  perform projectceo_product._assert_text(expected_baseline_id, 'expectedBaselineId', 160);
  if expected_previous_version_id is not null then
    perform projectceo_product._assert_text(expected_previous_version_id, 'expectedPreviousVersionId', 160);
  end if;
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  select package.id into root_package_id
  from projectceo_foundation.project_packages package
  where package.project_id=publish_release_request_bound.project_id
    and package.kind='project_root' and package.status='active';
  if root_package_id is null then
    perform projectceo_product._raise('P1104','not_found','{"entity":"projectRootPackage"}'::jsonb);
  end if;
  select organization_id, actor_user_id, actor_id into ctx
  from projectceo_foundation._authorize_package_human(project_id, root_package_id, 'publish_release');
  key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'commandRef',command_text,'expectedBaselineId',expected_baseline_id,
    'expectedPreviousVersionId',expected_previous_version_id,
    'expectedStateRevision',expected_state_revision,'operation','publish_release_request_bound',
    'projectId',project_id));
  select state_revision into current_state from project_intelligence.project_workflows
  where organization_id=ctx.organization_id and project_id=publish_release_request_bound.project_id for update;
  if exists(select 1 from projectceo_product.command_records c where c.organization_id=ctx.organization_id and c.project_id=project_id and c.operation='publish_release_request_bound' and c.key_digest=key_digest and (c.actor_type<>'human' or c.actor_user_id is distinct from ctx.actor_user_id)) then
    perform projectceo_product._raise('P1103','forbidden','{"reason":"IDEMPOTENCY_ACTOR_MISMATCH"}'::jsonb);
  end if;
  replay := projectceo_product._replay_or_null(ctx.organization_id,project_id,'publish_release_request_bound',key_digest,request_digest);
  if replay is not null then return replay; end if;
  if current_state <> expected_state_revision then
    perform projectceo_product._raise('P1107','stale_state',jsonb_build_object('currentStateRevision',current_state));
  end if;
  select baseline_id into current_baseline from projectceo_product.project_baselines
  where organization_id=ctx.organization_id and project_id=publish_release_request_bound.project_id and published_at is not null
  order by version_no desc limit 1 for update;
  if current_baseline is null then
    perform projectceo_product._raise('P1104','not_found','{"entity":"publishedBaseline"}'::jsonb);
  end if;
  if current_baseline is distinct from expected_baseline_id then
    perform projectceo_product._raise('P1107','stale_state',jsonb_build_object('currentBaselineId',current_baseline));
  end if;
  if not exists(select 1 from projectceo_product.project_baseline_packages p where p.organization_id=ctx.organization_id and p.project_id=project_id and p.baseline_id=current_baseline and p.package_id=root_package_id) then
    perform projectceo_product._raise('P1109','scope_conflict','{"reason":"ROOT_PACKAGE_NOT_IN_BASELINE"}'::jsonb);
  end if;
  select version.production_package_version_id into current_previous
  from projectceo_product.production_package_versions version
  where version.organization_id=ctx.organization_id and version.project_id=publish_release_request_bound.project_id and version.package_id=root_package_id
  order by version.version_no desc limit 1 for update;
  if current_previous is distinct from expected_previous_version_id then
    perform projectceo_product._raise('P1107','stale_state',jsonb_build_object('currentVersionId',current_previous));
  end if;
  select coalesce(array_agg(revision_id order by ordinal) filter(where target_kind='source_revision'),'{}'),
    coalesce(array_agg(revision_id order by ordinal) filter(where target_kind='requirement_revision'),'{}'),
    coalesce(array_agg(revision_id order by ordinal) filter(where target_kind='assumption_revision'),'{}'),
    coalesce(array_agg(revision_id order by ordinal) filter(where target_kind='decision_revision'),'{}'),
    coalesce(array_agg(revision_id order by ordinal) filter(where target_kind='selection_revision'),'{}')
  into source_ids,requirement_ids,assumption_ids,decision_ids,selection_ids
  from projectceo_product.project_baseline_refs
  where organization_id=ctx.organization_id and project_id=publish_release_request_bound.project_id and baseline_id=current_baseline;
  total_refs:=cardinality(source_ids)+cardinality(requirement_ids)+cardinality(assumption_ids)+cardinality(decision_ids)+cardinality(selection_ids);
  if total_refs=0 then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"ROOT_RELEASE_REFS_REQUIRED"}'::jsonb);
  end if;
  content:=jsonb_build_object('baselineId',current_baseline,'exactRevisionRefs',jsonb_build_object('sources',to_jsonb(source_ids),'requirements',to_jsonb(requirement_ids),'assumptions',to_jsonb(assumption_ids),'decisions',to_jsonb(decision_ids),'selections',to_jsonb(selection_ids)),'organizationId',ctx.organization_id,'packageId',root_package_id,'previousVersionId',current_previous,'projectId',project_id,'schemaVersion','project-ceo-production-package/0.1');
  descriptor:=jsonb_build_object('id',command_text,'packageId',root_package_id,'baselineId',current_baseline,'previousVersionId',current_previous,'exactRevisionRefs',content->'exactRevisionRefs','semanticHash','sha256:'||encode(project_intelligence._sha256_jsonb(content),'hex'));
  inner_key:='root-release:'||encode(key_digest,'hex');
  raw:=projectceo_product_api.publish_production_package_version(project_id,descriptor,expected_state_revision,inner_key);
  result:=raw->'result'; result_state:=(raw->>'stateRevision')::bigint;
  insert into projectceo_product.command_records(organization_id,project_id,operation,key_digest,request_digest,actor_type,actor_id,actor_user_id,logical_result,resulting_state_revision) values(ctx.organization_id,project_id,'publish_release_request_bound',key_digest,request_digest,'human',ctx.actor_id,ctx.actor_user_id,result,result_state);
  return jsonb_build_object('operation','publish_release_request_bound','replay',false,'stateRevision',result_state,'result',result);
end
$function$;
alter function projectceo_product_api.publish_release_request_bound(uuid,text,text,bigint,text,text) owner to pi_table_owner;
revoke all on function projectceo_product_api.publish_release_request_bound(uuid,text,text,bigint,text,text) from public,anon,service_role,pi_human_executor,pi_worker_executor;
grant execute on function projectceo_product_api.publish_release_request_bound(uuid,text,text,bigint,text,text) to authenticated;
commit;
