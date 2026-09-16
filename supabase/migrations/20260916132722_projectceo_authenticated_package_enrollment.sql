begin;

set check_function_bodies = on;

alter table projectceo_foundation.command_records
  drop constraint if exists command_records_operation_check;
alter table projectceo_foundation.command_records
  add constraint command_records_operation_check check (operation in (
    'enroll_organization_project', 'enroll_organization_project_scope',
    'create_invitation', 'accept_invitation', 'revoke_invitation',
    'expire_invitation', 'create_guest_access_grant', 'revoke_guest_access_grant',
    'register_source_inventory', 'ingest_source_graph'
  ));

create or replace function projectceo_api.enroll_organization_project_scope(
  project_id uuid,
  package_id uuid,
  package_stable_key text,
  package_name text,
  members jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_actor uuid := project_intelligence._request_user_id();
  v_base jsonb;
  v_org uuid;
  v_state bigint;
  v_key bytea;
  v_request bytea;
  v_replay jsonb;
  v_result jsonb;
  v_member jsonb;
  v_user uuid;
  v_role text;
begin
  if v_actor is null then
    perform projectceo_foundation._raise('P1101', 'unauthenticated', '{}'::jsonb);
  end if;
  if package_id is null or package_id = project_id then
    perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"packageId"}'::jsonb);
  end if;
  if jsonb_typeof(members) <> 'array' or jsonb_array_length(members) > 100 then
    perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"members"}'::jsonb);
  end if;
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  if btrim(package_stable_key) <> package_stable_key or char_length(package_stable_key) not between 1 and 160
     or btrim(package_name) <> package_name or char_length(package_name) not between 1 and 500 then
    perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"package"}'::jsonb);
  end if;

  v_base := projectceo_api.enroll_organization_project(project_id, idempotency_key || ':base');
  v_org := (v_base #>> '{result,organizationId}')::uuid;
  select pw.state_revision into v_state
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_org and pw.project_id = project_id
  for update;
  if not found then
    perform projectceo_foundation._raise('P1104', 'not_found', '{"entity":"project_workflow"}'::jsonb);
  end if;

  v_key := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request := project_intelligence._sha256_jsonb(jsonb_build_object(
    'projectId', project_id, 'packageId', package_id, 'packageStableKey', package_stable_key,
    'packageName', package_name, 'members', members
  ));
  v_replay := projectceo_foundation._replay_or_null(v_org, project_id,
    'enroll_organization_project_scope', v_key, v_request);
  if v_replay is not null then return v_replay; end if;

  insert into projectceo_foundation.project_packages
    (organization_id, project_id, id, stable_key, kind, parent_package_id, name)
  values (v_org, project_id, project_id, 'project-root', 'project_root', null,
    coalesce((select p.client_name from public.projects p where p.id = project_id), 'Project'))
  on conflict (organization_id, project_id, id) do nothing;

  insert into projectceo_foundation.project_packages
    (organization_id, project_id, id, stable_key, kind, parent_package_id, name)
  values (v_org, project_id, package_id, package_stable_key, 'work_package', project_id, package_name)
  on conflict (organization_id, project_id, id) do update
    set stable_key = excluded.stable_key, name = excluded.name, status = 'active';

  insert into project_intelligence.organization_members (organization_id, user_id, role, status)
  values (v_org, v_actor, 'owner', 'active')
  on conflict (organization_id, user_id) do update set role = 'owner', status = 'active';
  insert into projectceo_foundation.project_memberships
    (organization_id, project_id, user_id, role, status)
  values (v_org, project_id, v_actor, 'owner_lead', 'active')
  on conflict (organization_id, project_id, user_id) do update set role = 'owner_lead', status = 'active';
  insert into projectceo_foundation.project_member_capabilities
    (organization_id, project_id, user_id, capability)
  select v_org, project_id, v_actor, rc.capability
  from projectceo_foundation._role_capabilities('owner_lead') rc
  on conflict do nothing;

  for v_member in select value from jsonb_array_elements(members) loop
    begin v_user := (v_member->>'userId')::uuid; exception when invalid_text_representation then
      perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"members.userId"}'::jsonb);
    end;
    v_role := v_member->>'role';
    if v_role not in ('architect', 'builder', 'client_approver') then
      perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"members.role"}'::jsonb);
    end if;
    if exists (
      select 1 from projectceo_foundation.project_memberships existing
      where existing.organization_id = v_org and existing.project_id = project_id
        and existing.user_id = v_user and existing.role <> v_role
    ) then
      perform projectceo_foundation._raise('P1109', 'scope_conflict', '{"reason":"MEMBER_ROLE_REPLACEMENT_REQUIRED"}'::jsonb);
    end if;
    insert into project_intelligence.organization_members (organization_id, user_id, role, status)
    values (v_org, v_user, 'member', 'active') on conflict (organization_id, user_id) do update set status = 'active';
    insert into projectceo_foundation.project_memberships
      (organization_id, project_id, user_id, role, status)
    values (v_org, project_id, v_user, v_role, 'active')
    on conflict (organization_id, project_id, user_id) do update set role = excluded.role, status = 'active';
    insert into projectceo_foundation.project_member_capabilities
      (organization_id, project_id, user_id, capability)
    select v_org, project_id, v_user, rc.capability
    from projectceo_foundation._role_capabilities(v_role) rc on conflict do nothing;
    insert into projectceo_foundation.package_memberships
      (organization_id, project_id, package_id, user_id, role, status)
    values (v_org, project_id, package_id, v_user, v_role, 'active')
    on conflict (organization_id, project_id, package_id, user_id) do update
      set role = excluded.role, status = 'active';
  end loop;

  v_result := jsonb_build_object('organizationId', v_org, 'projectId', project_id,
    'rootPackageId', project_id, 'packageId', package_id);
  return projectceo_foundation._complete_project_command(
    v_org, project_id, 'enroll_organization_project_scope', v_key, v_request,
    'human', v_actor::text, v_actor, v_result, 'project_scope_enrolled',
    jsonb_build_object('organization_id', v_org, 'project_id', project_id, 'package_id', package_id), v_state);
end
$function$;

revoke all on function projectceo_api.enroll_organization_project_scope(uuid, uuid, text, text, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function projectceo_api.enroll_organization_project_scope(uuid, uuid, text, text, jsonb, text)
  to authenticated;

commit;
