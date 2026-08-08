-- Additive read projection for the M2 approval provenance marker.
-- The historical read function remains immutable; this wrapper enriches its
-- already-authorized envelope with the latest append-only self_approved flag.

begin;

create function projectceo_read_api.get_project_workspace_read_v2(
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
  v_enriched jsonb;
  v_organization_id uuid;
begin
  v_base := projectceo_read_api.get_project_workspace_read(project_id, package_id);
  if v_base -> 'error' is not null and v_base -> 'error' <> 'null'::jsonb then
    return v_base;
  end if;
  v_organization_id := (v_base #>> '{scope,organizationId}')::uuid;

  select coalesce(
    jsonb_agg(
      package_row
      || jsonb_build_object(
        'selfApproved', coalesce(latest_event.self_approved, false)
      )
      order by package_row ->> 'createdAt'
    ),
    '[]'::jsonb
  )
  into v_enriched
  from jsonb_array_elements(
    coalesce(v_base #> '{data,approvalPackages}', '[]'::jsonb)
  ) package_row
  left join lateral (
    select event.self_approved
    from projectceo_product.approval_package_events event
    where event.organization_id = v_organization_id
      and event.project_id = project_id
      and event.approval_package_id = package_row ->> 'id'
    order by event.sequence_no desc
    limit 1
  ) latest_event on true;

  return jsonb_set(
    v_base,
    '{data,approvalPackages}',
    v_enriched,
    true
  );
end
$function$;

alter function projectceo_read_api.get_project_workspace_read_v2(uuid, uuid)
  owner to pi_table_owner;

revoke all on function
  projectceo_read_api.get_project_workspace_read_v2(uuid, uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant execute on function
  projectceo_read_api.get_project_workspace_read_v2(uuid, uuid)
  to authenticated;

commit;
