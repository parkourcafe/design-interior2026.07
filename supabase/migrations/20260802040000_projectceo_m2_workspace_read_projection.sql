-- Additive M2 read projection. The v2 wrapper remains the authorization
-- boundary; this wrapper only projects latest immutable M2 revisions.
-- Financial fields are returned only to owner/architect project roles.

begin;

create function projectceo_read_api.get_project_workspace_read_v3(
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
    and membership.project_id = project_id
    and membership.user_id = v_actor_user_id
    and membership.status = 'active'
  limit 1;
  v_financial := v_role in ('owner_lead', 'architect');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', revision.entity_id, 'packageId', revision.package_id,
    'revisionId', revision.revision_id, 'revisionNo', revision.revision_no,
    'status', revision.status, 'payload', revision.payload,
    'createdAt', revision.created_at
  ) order by revision.entity_id), '[]'::jsonb)
  into v_rows
  from (
    select distinct on (entity_kind, entity_id)
      entity_id, package_id, revision_id, revision_no, status, payload, created_at
    from projectceo_product.m2_workspace_revisions
    where organization_id = v_organization_id and project_id = get_project_workspace_read_v3.project_id
      and (get_project_workspace_read_v3.package_id is null or package_id = get_project_workspace_read_v3.package_id)
      and entity_kind = 'room'
    order by entity_kind, entity_id, revision_no desc
  ) revision;
  v_base := jsonb_set(v_base, '{data,m2Rooms}', v_rows, true);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', revision.entity_id, 'packageId', revision.package_id,
    'revisionId', revision.revision_id, 'revisionNo', revision.revision_no,
    'status', revision.status, 'payload', revision.payload,
    'createdAt', revision.created_at
  ) order by revision.entity_id), '[]'::jsonb)
  into v_rows
  from (
    select distinct on (entity_kind, entity_id)
      entity_id, package_id, revision_id, revision_no, status, payload, created_at
    from projectceo_product.m2_workspace_revisions
    where organization_id = v_organization_id and project_id = get_project_workspace_read_v3.project_id
      and (get_project_workspace_read_v3.package_id is null or package_id = get_project_workspace_read_v3.package_id)
      and entity_kind = 'variant'
    order by entity_kind, entity_id, revision_no desc
  ) revision;
  v_base := jsonb_set(v_base, '{data,m2Variants}', v_rows, true);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', revision.entity_id, 'packageId', revision.package_id,
    'revisionId', revision.revision_id, 'revisionNo', revision.revision_no,
    'status', revision.status,
    'payload', case when v_financial then revision.payload
      else revision.payload - 'supplierRef' - 'unitCostRub' end,
    'createdAt', revision.created_at
  ) order by revision.entity_id), '[]'::jsonb)
  into v_rows
  from (
    select distinct on (entity_kind, entity_id)
      entity_id, package_id, revision_id, revision_no, status, payload, created_at
    from projectceo_product.m2_workspace_revisions
    where organization_id = v_organization_id and project_id = get_project_workspace_read_v3.project_id
      and (get_project_workspace_read_v3.package_id is null or package_id = get_project_workspace_read_v3.package_id)
      and entity_kind = 'material'
    order by entity_kind, entity_id, revision_no desc
  ) revision;
  v_base := jsonb_set(v_base, '{data,m2Materials}', v_rows, true);

  if v_financial then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', revision.entity_id, 'packageId', revision.package_id,
      'revisionId', revision.revision_id, 'revisionNo', revision.revision_no,
      'status', revision.status, 'payload', revision.payload,
      'createdAt', revision.created_at
    ) order by revision.entity_id), '[]'::jsonb)
    into v_rows
    from (
      select distinct on (entity_kind, entity_id)
        entity_id, package_id, revision_id, revision_no, status, payload, created_at
      from projectceo_product.m2_workspace_revisions
      where organization_id = v_organization_id and project_id = get_project_workspace_read_v3.project_id
        and (get_project_workspace_read_v3.package_id is null or package_id = get_project_workspace_read_v3.package_id)
        and entity_kind = 'budget'
      order by entity_kind, entity_id, revision_no desc
    ) revision;
  else
    v_rows := '[]'::jsonb;
  end if;
  v_base := jsonb_set(v_base, '{data,m2BudgetFrames}', v_rows, true);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', revision.entity_id, 'packageId', revision.package_id,
    'revisionId', revision.revision_id, 'revisionNo', revision.revision_no,
    'status', revision.status, 'payload', revision.payload,
    'createdAt', revision.created_at
  ) order by revision.entity_id), '[]'::jsonb)
  into v_rows
  from (
    select distinct on (entity_kind, entity_id)
      entity_id, package_id, revision_id, revision_no, status, payload, created_at
    from projectceo_product.m2_workspace_revisions
    where organization_id = v_organization_id and project_id = get_project_workspace_read_v3.project_id
      and (get_project_workspace_read_v3.package_id is null or package_id = get_project_workspace_read_v3.package_id)
      and entity_kind = 'client_handoff'
    order by entity_kind, entity_id, revision_no desc
  ) revision;
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
