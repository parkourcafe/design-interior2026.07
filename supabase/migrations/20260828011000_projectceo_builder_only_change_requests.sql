-- AP5 command boundary: submit_change_request remains request-bound but is now builder-only.
-- Historical capability maps still contain create_change for other roles; the M4
-- command itself is the authoritative boundary for creating field change requests.

begin;

set local check_function_bodies = on;

create or replace function projectceo_m4_api.submit_change_request(
  project_id uuid,
  package_id uuid,
  from_baseline_id text,
  proposed_baseline_id text,
  from_production_package_version_id text,
  reason text,
  delta_cost_rub bigint,
  delta_days integer,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_reason text;
  v_initiator_role text;
  v_change_request_id uuid := extensions.gen_random_uuid();
  v_root_count bigint;
  v_result jsonb;
begin
  v_reason := projectceo_product._assert_text(reason, 'reason', 4000);
  if delta_cost_rub is null
     or delta_cost_rub not between -9007199254740991 and 9007199254740991
     or delta_days is null then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"CHANGE_DELTA_INVALID"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_m4._human_command_context(
    project_id,
    package_id,
    'create_change',
    'submit_change_request',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object(
      'deltaCostRub', delta_cost_rub,
      'deltaDays', delta_days,
      'fromBaselineId', from_baseline_id,
      'fromProductionPackageVersionId',
        from_production_package_version_id,
      'proposedBaselineId', proposed_baseline_id,
      'reason', v_reason
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;

  v_initiator_role := projectceo_m4._actor_initiator_role(
    v_context.organization_id,
    project_id,
    package_id,
    v_context.actor_user_id
  );
  if v_initiator_role is null then
    perform projectceo_product._raise(
      'P1103',
      'forbidden',
      '{"reason":"INITIATOR_ROLE_REQUIRED"}'::jsonb
    );
  end if;

  if v_initiator_role <> 'builder' then
    perform projectceo_product._raise(
      'P1103',
      'forbidden',
      '{"reason":"BUILDER_ROLE_REQUIRED"}'::jsonb
    );
  end if;

  if not exists (
    select 1
    from projectceo_product.project_baselines proposed
    join projectceo_product.project_baseline_packages proposed_package
      on proposed_package.organization_id = proposed.organization_id
     and proposed_package.project_id = proposed.project_id
     and proposed_package.baseline_id = proposed.baseline_id
     and proposed_package.package_id = package_id
    join projectceo_product.production_package_versions prior_version
      on prior_version.organization_id = proposed.organization_id
     and prior_version.project_id = proposed.project_id
     and prior_version.package_id = package_id
     and prior_version.baseline_id = from_baseline_id
     and prior_version.production_package_version_id =
       from_production_package_version_id
    where proposed.organization_id = v_context.organization_id
      and proposed.project_id = project_id
      and proposed.baseline_id = proposed_baseline_id
      and proposed.previous_baseline_id = from_baseline_id
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"CHANGE_BASELINE_LINEAGE_INVALID"}'::jsonb
    );
  end if;

  -- Thin P0 accepts revision replacement only. Added or removed decision and
  -- selection identities require an explicit later contract version.
  if exists (
    with from_refs as (
      select ref.target_kind, ref.entity_id
      from projectceo_product.project_baseline_refs ref
      where ref.organization_id = v_context.organization_id
        and ref.project_id = project_id
        and ref.baseline_id = from_baseline_id
        and ref.target_kind in (
          'decision_revision', 'selection_revision'
        )
    ), proposed_refs as (
      select ref.target_kind, ref.entity_id
      from projectceo_product.project_baseline_refs ref
      where ref.organization_id = v_context.organization_id
        and ref.project_id = project_id
        and ref.baseline_id = proposed_baseline_id
        and ref.target_kind in (
          'decision_revision', 'selection_revision'
        )
    )
    select 1
    from from_refs
    full join proposed_refs using (target_kind, entity_id)
    where from_refs.entity_id is null or proposed_refs.entity_id is null
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"CHANGE_ROOT_SET_UNSUPPORTED"}'::jsonb
    );
  end if;

  if exists (
    select 1
    from projectceo_m4.change_requests existing
    where existing.organization_id = v_context.organization_id
      and existing.project_id = project_id
      and existing.package_id = package_id
      and existing.from_baseline_id = from_baseline_id
      and existing.proposed_baseline_id = proposed_baseline_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"CHANGE_TRANSITION_ALREADY_SUBMITTED"}'::jsonb
    );
  end if;

  insert into projectceo_m4.change_requests (
    organization_id,
    project_id,
    change_request_id,
    package_id,
    from_baseline_id,
    proposed_baseline_id,
    from_production_package_version_id,
    protected_reason,
    reason_digest,
    initiator_role,
    delta_cost_rub,
    delta_days,
    requested_by_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    v_change_request_id,
    package_id,
    from_baseline_id,
    proposed_baseline_id,
    from_production_package_version_id,
    v_reason,
    project_intelligence._sha256_text(v_reason),
    v_initiator_role,
    delta_cost_rub,
    delta_days,
    v_context.actor_user_id
  );

  insert into projectceo_m4.change_request_roots (
    organization_id,
    project_id,
    change_request_id,
    package_id,
    from_baseline_id,
    proposed_baseline_id,
    target_kind,
    node_id,
    from_revision_id,
    to_revision_id
  )
  select
    v_context.organization_id,
    project_id,
    v_change_request_id,
    package_id,
    from_baseline_id,
    proposed_baseline_id,
    prior.target_kind,
    prior.entity_id,
    prior.revision_id,
    proposed.revision_id
  from projectceo_product.project_baseline_refs prior
  join projectceo_product.project_baseline_refs proposed
    on proposed.organization_id = prior.organization_id
   and proposed.project_id = prior.project_id
   and proposed.target_kind = prior.target_kind
   and proposed.entity_id = prior.entity_id
   and proposed.baseline_id = proposed_baseline_id
  where prior.organization_id = v_context.organization_id
    and prior.project_id = project_id
    and prior.baseline_id = from_baseline_id
    and prior.target_kind in ('decision_revision', 'selection_revision')
    and prior.revision_id <> proposed.revision_id
  order by prior.target_kind collate "C", prior.entity_id collate "C";
  get diagnostics v_root_count = row_count;
  if v_root_count = 0 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"NO_CHANGE_ROOTS"}'::jsonb
    );
  end if;

  v_result := jsonb_build_object(
    'deltaCostRub', delta_cost_rub,
    'deltaDays', delta_days,
    'fromBaselineId', from_baseline_id,
    'fromProductionPackageVersionId',
      from_production_package_version_id,
    'id', v_change_request_id,
    'initiatorRole', v_initiator_role,
    'packageId', package_id,
    'projectId', project_id,
    'proposedBaselineId', proposed_baseline_id,
    'reasonHash', 'sha256:' || encode(
      project_intelligence._sha256_text(v_reason),
      'hex'
    ),
    'rootCount', v_root_count,
    'status', 'submitted'
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'submit_change_request',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'change_request_submitted',
    jsonb_build_object(
      'change_request_id', v_change_request_id,
      'from_baseline_id', from_baseline_id,
      'proposed_baseline_id', proposed_baseline_id,
      'reason_digest', 'sha256:' || encode(
        project_intelligence._sha256_text(v_reason),
        'hex'
      ),
      'root_count', v_root_count
    ),
    v_context.state_revision
  );
end
$function$;


commit;
