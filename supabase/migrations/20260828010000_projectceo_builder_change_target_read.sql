-- Builder change requests need one server-derived structural fact that the
-- published-only read projection deliberately hides from `latestBaseline`: the
-- current approved baseline that succeeds the already released package version.
--
-- This does not expose baseline refs, draft documents, unpublished package
-- versions, or client data. It only publishes a builder-only command hint when
-- the same request-bound membership can already see a published package version
-- whose baseline is the predecessor of the proposed baseline. The M4 mutation
-- RPC still performs the final membership, lineage, duplicate, root-count and
-- idempotency checks.

begin;

set local check_function_bodies = on;

do $precondition$
begin
  if to_regprocedure(
    'projectceo_read_api.get_project_workspace_read_v9(uuid,uuid)'
  ) is null then
    raise exception 'PROJECTCEO_WORKSPACE_READ_V9_MISSING';
  end if;
  if to_regprocedure('project_intelligence._request_user_id()') is null then
    raise exception 'PROJECTCEO_REQUEST_USER_ID_MISSING';
  end if;
end
$precondition$;

create function projectceo_read_api._builder_change_proposed_baseline(
  p_data jsonb,
  p_project_id uuid,
  p_package_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_actor_user_id uuid := project_intelligence._request_user_id();
  v_role text;
  v_baseline jsonb;
begin
  if v_actor_user_id is null then
    return null;
  end if;

  select membership.role
  into v_role
  from projectceo_foundation.project_memberships membership
  where membership.organization_id = p_organization_id
    and membership.project_id = p_project_id
    and membership.user_id = v_actor_user_id
    and membership.status = 'active'
  order by case membership.role
    when 'owner_lead' then 1
    when 'architect' then 2
    when 'builder' then 3
    when 'client_approver' then 4
    else 99
  end
  limit 1;

  if v_role is null and p_package_id is not null then
    select membership.role
    into v_role
    from projectceo_foundation.package_memberships membership
    where membership.organization_id = p_organization_id
      and membership.project_id = p_project_id
      and membership.package_id = p_package_id
      and membership.user_id = v_actor_user_id
      and membership.status = 'active'
    order by case membership.role
      when 'builder' then 1
      when 'client_approver' then 2
      else 99
    end
    limit 1;
  end if;

  if v_role <> 'builder' then
    return null;
  end if;

  select jsonb_build_object(
    'id', baseline.baseline_id,
    'previousBaselineId', baseline.previous_baseline_id,
    'versionNo', baseline.version_no
  )
  into v_baseline
  from projectceo_product.project_baselines baseline
  where baseline.organization_id = p_organization_id
    and baseline.project_id = p_project_id
    and baseline.previous_baseline_id is not null
    and exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_data -> 'packageVersions', '[]'::jsonb)
      ) version
      join projectceo_product.project_baseline_packages binding
        on binding.organization_id = baseline.organization_id
       and binding.project_id = baseline.project_id
       and binding.baseline_id = baseline.baseline_id
       and binding.package_id::text = version ->> 'packageId'
      where version ->> 'baselineId' = baseline.previous_baseline_id
        and nullif(version ->> 'id', '') is not null
        and nullif(version ->> 'packageId', '') is not null
    )
  order by baseline.version_no desc
  limit 1;

  return v_baseline;
end
$function$;

create function projectceo_read_api.get_project_workspace_read_v10(
  project_id uuid,
  package_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_base jsonb;
  v_organization_id uuid;
  v_builder_baseline jsonb;
  v_extension_status jsonb;
begin
  v_base := projectceo_read_api.get_project_workspace_read_v9(project_id, package_id);
  if v_base->'error' is not null and v_base->'error' <> 'null'::jsonb then
    return v_base;
  end if;
  if v_base->'scope' is null or v_base->'scope' = 'null'::jsonb then
    return v_base;
  end if;

  v_organization_id := (v_base #>> '{scope,organizationId}')::uuid;
  v_builder_baseline := projectceo_read_api._builder_change_proposed_baseline(
    v_base -> 'data',
    project_id,
    package_id,
    v_organization_id
  );
  if v_builder_baseline is null then
    return v_base;
  end if;

  v_extension_status := case
    when jsonb_typeof(v_base #> '{data,extensionStatus}') = 'object'
      then v_base #> '{data,extensionStatus}'
    else '{}'::jsonb
  end;

  return jsonb_set(
    v_base,
    '{data,extensionStatus}',
    v_extension_status || jsonb_build_object(
      'createChangeProposedBaselineId',
      v_builder_baseline ->> 'id'
    ),
    true
  );
end
$function$;

alter function projectceo_read_api._builder_change_proposed_baseline(
  jsonb,
  uuid,
  uuid,
  uuid
)
  owner to pi_table_owner;

alter function projectceo_read_api.get_project_workspace_read_v10(uuid, uuid)
  owner to pi_table_owner;

revoke all on function projectceo_read_api._builder_change_proposed_baseline(
  jsonb,
  uuid,
  uuid,
  uuid
)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

revoke all on function projectceo_read_api.get_project_workspace_read_v10(
  uuid,
  uuid
)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant execute on function projectceo_read_api.get_project_workspace_read_v10(
  uuid,
  uuid
)
  to authenticated;

do $postcondition$
begin
  if has_function_privilege(
    'authenticated',
    'projectceo_read_api._builder_change_proposed_baseline(jsonb, uuid, uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_BUILDER_CHANGE_HELPER_PUBLIC';
  end if;
  if not has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_project_workspace_read_v10(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_WORKSPACE_READ_V10_NOT_CALLABLE';
  end if;
end
$postcondition$;

commit;
