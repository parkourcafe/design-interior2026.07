-- Fix project-wide M2 reads: with #variable_conflict use_variable, an
-- unqualified package_id in a subquery resolves to the function parameter.
-- Qualify every revision column so project scope returns its real package id.

begin;

create or replace function projectceo_read_api.get_project_workspace_read_v3(
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
  v_actor_user_id uuid;
  v_role text;
  v_financial boolean := false;
  v_rows jsonb;
begin
  v_base := projectceo_read_api.get_project_workspace_read_v2(project_id, package_id);
  if v_base -> 'error' is not null and v_base -> 'error' <> 'null'::jsonb then
    return v_base;
  end if;
  v_organization_id := (v_base #>> '{scope,organizationId}')::uuid;
  v_actor_user_id := (v_base #>> '{scope,actorUserId}')::uuid;
  select membership.role into v_role
  from projectceo_foundation.project_memberships membership
  where membership.organization_id = v_organization_id
    and membership.project_id = get_project_workspace_read_v3.project_id
    and membership.user_id = v_actor_user_id
    and membership.status = 'active'
  limit 1;
  v_financial := v_role in ('owner_lead', 'architect');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.entity_id, 'packageId', r.package_id,
    'revisionId', r.revision_id, 'revisionNo', r.revision_no,
    'status', r.status, 'payload', r.payload,
    'createdAt', r.created_at
  ) order by r.entity_id), '[]'::jsonb)
  into v_rows
  from (
    select distinct on (m.entity_kind, m.entity_id)
      m.entity_id, m.package_id, m.revision_id, m.revision_no,
      m.status, m.payload, m.created_at
    from projectceo_product.m2_workspace_revisions m
    where m.organization_id = v_organization_id
      and m.project_id = get_project_workspace_read_v3.project_id
      and (get_project_workspace_read_v3.package_id is null
        or m.package_id = get_project_workspace_read_v3.package_id)
      and m.entity_kind = 'room'
    order by m.entity_kind, m.entity_id, m.revision_no desc
  ) r;
  v_base := jsonb_set(v_base, '{data,m2Rooms}', v_rows, true);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.entity_id, 'packageId', r.package_id,
    'revisionId', r.revision_id, 'revisionNo', r.revision_no,
    'status', r.status, 'payload', r.payload,
    'createdAt', r.created_at
  ) order by r.entity_id), '[]'::jsonb)
  into v_rows
  from (
    select distinct on (m.entity_kind, m.entity_id)
      m.entity_id, m.package_id, m.revision_id, m.revision_no,
      m.status, m.payload, m.created_at
    from projectceo_product.m2_workspace_revisions m
    where m.organization_id = v_organization_id
      and m.project_id = get_project_workspace_read_v3.project_id
      and (get_project_workspace_read_v3.package_id is null
        or m.package_id = get_project_workspace_read_v3.package_id)
      and m.entity_kind = 'variant'
    order by m.entity_kind, m.entity_id, m.revision_no desc
  ) r;
  v_base := jsonb_set(v_base, '{data,m2Variants}', v_rows, true);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.entity_id, 'packageId', r.package_id,
    'revisionId', r.revision_id, 'revisionNo', r.revision_no,
    'status', r.status,
    'payload', case when v_financial then r.payload
      else r.payload - 'supplierRef' - 'unitCostRub' end,
    'createdAt', r.created_at
  ) order by r.entity_id), '[]'::jsonb)
  into v_rows
  from (
    select distinct on (m.entity_kind, m.entity_id)
      m.entity_id, m.package_id, m.revision_id, m.revision_no,
      m.status, m.payload, m.created_at
    from projectceo_product.m2_workspace_revisions m
    where m.organization_id = v_organization_id
      and m.project_id = get_project_workspace_read_v3.project_id
      and (get_project_workspace_read_v3.package_id is null
        or m.package_id = get_project_workspace_read_v3.package_id)
      and m.entity_kind = 'material'
    order by m.entity_kind, m.entity_id, m.revision_no desc
  ) r;
  v_base := jsonb_set(v_base, '{data,m2Materials}', v_rows, true);

  if v_financial then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.entity_id, 'packageId', r.package_id,
      'revisionId', r.revision_id, 'revisionNo', r.revision_no,
      'status', r.status, 'payload', r.payload,
      'createdAt', r.created_at
    ) order by r.entity_id), '[]'::jsonb)
    into v_rows
    from (
      select distinct on (m.entity_kind, m.entity_id)
        m.entity_id, m.package_id, m.revision_id, m.revision_no,
        m.status, m.payload, m.created_at
      from projectceo_product.m2_workspace_revisions m
      where m.organization_id = v_organization_id
        and m.project_id = get_project_workspace_read_v3.project_id
        and (get_project_workspace_read_v3.package_id is null
          or m.package_id = get_project_workspace_read_v3.package_id)
        and m.entity_kind = 'budget'
      order by m.entity_kind, m.entity_id, m.revision_no desc
    ) r;
  else
    v_rows := '[]'::jsonb;
  end if;
  v_base := jsonb_set(v_base, '{data,m2BudgetFrames}', v_rows, true);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.entity_id, 'packageId', r.package_id,
    'revisionId', r.revision_id, 'revisionNo', r.revision_no,
    'status', r.status, 'payload', r.payload,
    'createdAt', r.created_at
  ) order by r.entity_id), '[]'::jsonb)
  into v_rows
  from (
    select distinct on (m.entity_kind, m.entity_id)
      m.entity_id, m.package_id, m.revision_id, m.revision_no,
      m.status, m.payload, m.created_at
    from projectceo_product.m2_workspace_revisions m
    where m.organization_id = v_organization_id
      and m.project_id = get_project_workspace_read_v3.project_id
      and (get_project_workspace_read_v3.package_id is null
        or m.package_id = get_project_workspace_read_v3.package_id)
      and m.entity_kind = 'client_handoff'
    order by m.entity_kind, m.entity_id, m.revision_no desc
  ) r;
  return jsonb_set(v_base, '{data,m2ClientHandoffs}', v_rows, true);
end
$function$;

alter function projectceo_read_api.get_project_workspace_read_v3(uuid, uuid)
  owner to pi_table_owner;
revoke all on function projectceo_read_api.get_project_workspace_read_v3(uuid, uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
grant execute on function projectceo_read_api.get_project_workspace_read_v3(uuid, uuid)
  to authenticated;

commit;
