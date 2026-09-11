-- S-MIG #7: M3 opens only request-bound publication doors.
begin;

-- The original atomic door correctly derives the descriptor inside one
-- transaction, but an empty approved-package set could still reach that
-- derivation. Keep its transaction and replay implementation intact behind a
-- non-public delegate, and add the missing request-bound approval precondition
-- at the public M3 door.
alter function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, bigint, text, text
) rename to _publish_baseline_atomic_unchecked;

revoke all on function projectceo_product_api._publish_baseline_atomic_unchecked(
  uuid, text, text, bigint, text, text
) from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

create function projectceo_product_api.publish_baseline_atomic(
  project_id uuid,
  expected_latest_version_id text,
  previous_baseline_id text,
  expected_state_revision bigint,
  command_ref text,
  idempotency_key text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
begin
  -- Authorize before inspecting approval state. The delegate authorizes again
  -- before its locked write transaction, preserving its existing race checks.
  select context.organization_id, context.actor_user_id, context.actor_id
    into v_context
  from projectceo_foundation._authorize_project_human(
    project_id, 'publish_baseline'
  ) context;

  if not exists (
    select 1
    from projectceo_product.approval_packages approval
    join projectceo_foundation.project_packages package
      on package.organization_id = approval.organization_id
     and package.project_id = approval.project_id
     and package.id = approval.package_id
     and package.status = 'active'
    join lateral (
      select event.to_status
      from projectceo_product.approval_package_events event
      where event.organization_id = approval.organization_id
        and event.project_id = approval.project_id
        and event.approval_package_id = approval.approval_package_id
      order by event.sequence_no desc
      limit 1
    ) current_event on true
    where approval.organization_id = v_context.organization_id
      and approval.project_id = project_id
      and current_event.to_status = 'approved'
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"APPROVED_SNAPSHOT_REQUIRED"}'::jsonb
    );
  end if;

  return projectceo_product_api._publish_baseline_atomic_unchecked(
    project_id,
    expected_latest_version_id,
    previous_baseline_id,
    expected_state_revision,
    command_ref,
    idempotency_key
  );
end
$function$;

alter function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, bigint, text, text
) owner to pi_table_owner;

alter function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, bigint, text, text
) set statement_timeout = '30s';

create or replace function projectceo_platform._module_signatures(p_module text)
returns text[] language sql immutable security definer set search_path = '' as $function$
  select case p_module
    when 'm3' then array[
      'projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)',
      'projectceo_product_api.publish_release_request_bound(uuid, text, text, bigint, text, text)',
      'projectceo_product_api.publish_work_package_release_request_bound(uuid, uuid, text, text, bigint, text, text)',
      'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
      'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
      'projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)'
    ]
    when 'm4_increment_1' then array[
      'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)',
      'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)',
      'projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)',
      'projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text)',
      'projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text)',
      'projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)'
    ] else null end;
$function$;
alter function projectceo_platform._module_signatures(text) owner to pi_table_owner;
revoke execute on function
  projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text),
  projectceo_product_api.publish_project_baseline(uuid, jsonb, bigint, text),
  projectceo_product_api.publish_production_package_version(uuid, jsonb, bigint, text),
  projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text),
  projectceo_product_api.publish_release_request_bound(uuid, text, text, bigint, text, text),
  projectceo_product_api.publish_work_package_release_request_bound(uuid, uuid, text, text, bigint, text, text)
from authenticated;
commit;
