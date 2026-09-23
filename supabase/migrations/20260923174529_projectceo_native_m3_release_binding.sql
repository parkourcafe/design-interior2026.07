-- WP32: bind new child releases to the exact native M3 context in the same
-- transaction. Existing release descriptors, hashes, audit and replay stay owned
-- by the existing engine. Historical releases are NOT backfilled as native proof.
begin;

create table projectceo_m3.production_package_native_contexts (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  production_package_version_id text not null,
  context_digest text not null check (context_digest ~ '^sha256:[0-9a-f]{64}$'),
  context jsonb not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, production_package_version_id),
  foreign key (organization_id, project_id, production_package_version_id)
    references projectceo_product.production_package_versions
      (organization_id, project_id, production_package_version_id) on delete restrict,
  foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages(organization_id, project_id, id) on delete restrict,
  constraint production_package_native_context_shape check ((
    jsonb_typeof(context) = 'object'
    and context->>'schemaVersion' = 'remhaos.native-m3-release-context/1'
    and context#>>'{scope,organizationId}' = organization_id::text
    and context#>>'{scope,projectId}' = project_id::text
    and context#>>'{scope,packageId}' = package_id::text
    and context->'structurallyComplete' = 'true'::jsonb
    and context->'findings' = '[]'::jsonb
    and context->>'contextDigest' = context_digest
    and context_digest = 'sha256:' || encode(project_intelligence._sha256_jsonb(context - 'contextDigest'), 'hex')
  ) is true)
);
alter table projectceo_m3.production_package_native_contexts owner to pi_table_owner;
alter table projectceo_m3.production_package_native_contexts enable row level security;
alter table projectceo_m3.production_package_native_contexts force row level security;
revoke all on table projectceo_m3.production_package_native_contexts
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
create policy production_package_native_contexts_owner
  on projectceo_m3.production_package_native_contexts
  for all to pi_table_owner using (true) with check (true);
create trigger production_package_native_contexts_append_only
  before update or delete on projectceo_m3.production_package_native_contexts
  for each row execute function projectceo_product.reject_append_only_mutation();

-- Keep the original function name so its PL/pgSQL parameter qualifications stay
-- valid. The schema move removes the generic implementation from the public API.
alter function projectceo_product_api.publish_work_package_release_request_bound(
  uuid, uuid, text, text, bigint, text, text
) set schema projectceo_product;
revoke all on function projectceo_product.publish_work_package_release_request_bound(
  uuid, uuid, text, text, bigint, text, text
) from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

-- Confirmed multi-project defect in the reused engine: with use_variable, an
-- unqualified project_id on the left also resolves to the parameter. Qualify
-- both reads without changing its descriptor, operation or request-digest code.
do $scope_qualification$
declare definition text; anchor text; replacement text;
begin
  definition := pg_get_functiondef('projectceo_product.publish_work_package_release_request_bound(uuid,uuid,text,text,bigint,text,text)'::regprocedure);
  anchor := 'select state_revision into current_state from project_intelligence.project_workflows
  where organization_id=ctx.organization_id and project_id=publish_work_package_release_request_bound.project_id for update;';
  replacement := 'select workflow.state_revision into current_state from project_intelligence.project_workflows workflow
  where workflow.organization_id=ctx.organization_id and workflow.project_id=publish_work_package_release_request_bound.project_id for update;';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 then
    raise exception 'NATIVE_RELEASE_WORKFLOW_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,anchor,replacement);
  anchor := 'select baseline_id into current_baseline from projectceo_product.project_baselines
  where organization_id=ctx.organization_id and project_id=publish_work_package_release_request_bound.project_id and published_at is not null
  order by version_no desc limit 1 for update;';
  replacement := 'select baseline.baseline_id into current_baseline from projectceo_product.project_baselines baseline
  where baseline.organization_id=ctx.organization_id and baseline.project_id=publish_work_package_release_request_bound.project_id and baseline.published_at is not null
  order by baseline.version_no desc limit 1 for update;';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 then
    raise exception 'NATIVE_RELEASE_BASELINE_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,anchor,replacement);
end
$scope_qualification$;

create function projectceo_product_api.publish_work_package_release_request_bound(
  project_id uuid, package_id uuid, expected_baseline_id text,
  expected_previous_version_id text, expected_state_revision bigint,
  command_ref text, idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
#variable_conflict use_variable
declare
  ctx record;
  v_state bigint;
  v_kind text;
  v_key bytea;
  v_context jsonb;
  v_result jsonb;
  v_release_id text;
begin
  perform projectceo_product._assert_text(command_ref, 'commandRef', 120);
  perform projectceo_product._assert_text(expected_baseline_id, 'expectedBaselineId', 160);
  if expected_previous_version_id is not null then
    perform projectceo_product._assert_text(expected_previous_version_id, 'expectedPreviousVersionId', 160);
  end if;
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  select * into strict ctx from projectceo_foundation._authorize_package_human(
    project_id, package_id, 'publish_release');
  if not projectceo_platform.m3_read_gate_open() then
    perform projectceo_foundation._raise('P1113', 'module_disabled', '{}'::jsonb);
  end if;
  select p.kind into v_kind from projectceo_foundation.project_packages p
    where p.organization_id=ctx.organization_id
      and p.project_id=publish_work_package_release_request_bound.project_id
      and p.id=publish_work_package_release_request_bound.package_id and p.status='active';
  if v_kind is distinct from 'work_package' then
    perform projectceo_product._raise('P1109', 'scope_conflict', '{"reason":"WORK_PACKAGE_REQUIRED"}');
  end if;
  -- Every handoff/sheet/approval mutation uses this existing workflow lock.
  -- A context read before acquiring it would be a check/use race.
  select w.state_revision into strict v_state from project_intelligence.project_workflows w
    where w.organization_id=ctx.organization_id
      and w.project_id=publish_work_package_release_request_bound.project_id for update;
  -- Follow the existing authority-lock order: status/role/capability revocation
  -- must serialize with publication, including non-key updates (FOR SHARE).
  perform 1 from project_intelligence.organizations locked
    where locked.id=ctx.organization_id for share;
  perform 1 from projectceo_foundation.project_packages locked
    where locked.organization_id=ctx.organization_id and locked.project_id=project_id
      and locked.id=package_id for share;
  perform 1 from project_intelligence.organization_members locked
    where locked.organization_id=ctx.organization_id and locked.user_id=ctx.actor_user_id for share;
  perform 1 from projectceo_foundation.project_memberships locked
    where locked.organization_id=ctx.organization_id and locked.project_id=project_id
      and locked.user_id=ctx.actor_user_id for share;
  perform 1 from projectceo_foundation.project_member_capabilities locked
    where locked.organization_id=ctx.organization_id and locked.project_id=project_id
      and locked.user_id=ctx.actor_user_id and locked.capability='publish_release' for share;
  perform 1 from projectceo_foundation.package_memberships locked
    where locked.organization_id=ctx.organization_id and locked.project_id=project_id
      and locked.package_id=package_id and locked.user_id=ctx.actor_user_id for share;
  perform 1 from projectceo_foundation.package_member_capabilities locked
    where locked.organization_id=ctx.organization_id and locked.project_id=project_id
      and locked.package_id=package_id and locked.user_id=ctx.actor_user_id
      and locked.capability='publish_release' for share;
  select * into strict ctx from projectceo_foundation._authorize_package_human(
    project_id, package_id, 'publish_release');
  if not projectceo_platform.m3_read_gate_open() then
    perform projectceo_foundation._raise('P1113','module_disabled','{}'::jsonb);
  end if;
  v_key := project_intelligence._sha256_text(btrim(idempotency_key));
  if exists(select 1 from projectceo_product.command_records c
    where c.organization_id=ctx.organization_id
      and c.project_id=publish_work_package_release_request_bound.project_id
      and c.operation='publish_work_package_release_request_bound' and c.key_digest=v_key) then
    -- The delegate rechecks actor + exact request digest. A legacy replay must
    -- not manufacture native lineage, and a native replay returns its old result
    -- even after newer handoff/sheet revisions exist.
    return projectceo_product.publish_work_package_release_request_bound(
      project_id, package_id, expected_baseline_id, expected_previous_version_id,
      expected_state_revision, command_ref, idempotency_key);
  end if;
  if v_state <> expected_state_revision then
    perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentStateRevision',v_state));
  end if;
  v_context := projectceo_m3_api.get_native_m3_release_context(project_id,package_id)->'data';
  if v_context->>'baselineId' is null then
    perform projectceo_product._raise('P1104','not_found','{"entity":"publishedBaseline"}');
  end if;
  if v_context->>'baselineId' is distinct from expected_baseline_id
    or v_context->>'previousVersionId' is distinct from expected_previous_version_id then
    perform projectceo_product._raise('P1107','stale_state',jsonb_build_object(
      'currentBaselineId',v_context->>'baselineId','currentVersionId',v_context->>'previousVersionId'));
  end if;
  if v_context->'structurallyComplete' is distinct from 'true'::jsonb then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"NATIVE_M3_CONTEXT_INCOMPLETE"}');
  end if;
  v_result := projectceo_product.publish_work_package_release_request_bound(
    project_id, package_id, expected_baseline_id, expected_previous_version_id,
    expected_state_revision, command_ref, idempotency_key);
  v_release_id := v_result#>>'{result,id}';
  -- Verify the persisted release rather than trusting only the envelope.
  if not exists(select 1 from projectceo_product.production_package_versions r
    where r.organization_id=ctx.organization_id
      and r.project_id=publish_work_package_release_request_bound.project_id
      and r.package_id=publish_work_package_release_request_bound.package_id
      and r.production_package_version_id=v_release_id
      and r.baseline_id=expected_baseline_id
      and r.published_by_user_id=ctx.actor_user_id)
    or v_result->'replay' is distinct from 'false'::jsonb then
    perform projectceo_product._raise('P1112','internal_error','{"reason":"NATIVE_RELEASE_BINDING_MISMATCH"}');
  end if;
  insert into projectceo_m3.production_package_native_contexts(
    organization_id,project_id,package_id,production_package_version_id,
    context_digest,context,created_by_user_id
  ) values(ctx.organization_id,project_id,package_id,v_release_id,
    v_context->>'contextDigest',v_context,ctx.actor_user_id);
  return v_result;
end
$function$;
alter function projectceo_product_api.publish_work_package_release_request_bound(
  uuid, uuid, text, text, bigint, text, text
) owner to pi_table_owner;
revoke all on function projectceo_product_api.publish_work_package_release_request_bound(
  uuid, uuid, text, text, bigint, text, text
) from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
commit;
