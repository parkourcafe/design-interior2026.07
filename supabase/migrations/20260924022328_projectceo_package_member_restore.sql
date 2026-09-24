-- Explicit restoration for package-scoped members. Enrollment never revives
-- an inactive member: access returns only through the audited command below.
begin;
set local check_function_bodies = on;

do $restore_command_registry$
declare old_operations text[]; old_events text[];
begin
  select array_agg(match[1] order by match[1]) into old_operations
  from pg_catalog.pg_constraint constraint_row,
    lateral regexp_matches(pg_catalog.pg_get_constraintdef(constraint_row.oid), $re$'([a-z0-9_]+)'$re$, 'g') match
  where constraint_row.conname='command_records_operation_check'
    and constraint_row.conrelid='projectceo_foundation.command_records'::regclass;
  select array_agg(match[1] order by match[1]) into old_events
  from pg_catalog.pg_constraint constraint_row,
    lateral regexp_matches(pg_catalog.pg_get_constraintdef(constraint_row.oid), $re$'([a-z0-9_]+)'$re$, 'g') match
  where constraint_row.conname='audit_events_event_type_check'
    and constraint_row.conrelid='projectceo_foundation.audit_events'::regclass;
  if old_operations is null or old_events is null then
    raise exception 'PACKAGE_MEMBER_RESTORE_REGISTRY_MISSING';
  end if;
  alter table projectceo_foundation.command_records drop constraint command_records_operation_check;
  execute format(
    'alter table projectceo_foundation.command_records add constraint command_records_operation_check check (operation=any(array[%s]))',
    (select string_agg(quote_literal(value),',' order by value)
     from (select distinct value from unnest(old_operations||array['restore_package_member_access']) value) values_set));
  alter table projectceo_foundation.audit_events drop constraint audit_events_event_type_check;
  execute format(
    'alter table projectceo_foundation.audit_events add constraint audit_events_event_type_check check (event_type=any(array[%s]))',
    (select string_agg(quote_literal(value),',' order by value)
     from (select distinct value from unnest(old_events||array['package_member_access_restored']) value) values_set));
end
$restore_command_registry$;

alter function projectceo_api.enroll_organization_project_scope(
  uuid,uuid,text,text,jsonb,text
) rename to _enroll_organization_project_scope_delegate;
alter function projectceo_api._enroll_organization_project_scope_delegate(
  uuid,uuid,text,text,jsonb,text
) set schema projectceo_foundation;
revoke all on function projectceo_foundation._enroll_organization_project_scope_delegate(
  uuid,uuid,text,text,jsonb,text
) from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;

create function projectceo_api.enroll_organization_project_scope(
  project_id uuid,
  package_id uuid,
  package_stable_key text,
  package_name text,
  members jsonb,
  idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
#variable_conflict use_variable
declare
  result jsonb;
  organization_id uuid;
begin
  result := projectceo_foundation._enroll_organization_project_scope_delegate(
    project_id,package_id,package_stable_key,package_name,members,idempotency_key);
  organization_id := (result#>>'{result,organizationId}')::uuid;
  if exists(
    select 1
    from jsonb_array_elements(members) requested
    join project_intelligence.organization_members org_member
      on org_member.organization_id=organization_id
     and org_member.user_id=(requested->>'userId')::uuid
    join projectceo_foundation.package_memberships package_member
      on package_member.organization_id=organization_id
     and package_member.project_id=enroll_organization_project_scope.project_id
     and package_member.package_id=enroll_organization_project_scope.package_id
     and package_member.user_id=org_member.user_id
    where org_member.status='inactive' or package_member.status='inactive'
  ) then
    -- Raising after the private delegate is intentional: the transaction rolls
    -- back capabilities, command/audit rows and state changes made by it.
    perform projectceo_foundation._raise(
      'P1109','scope_conflict','{"reason":"PACKAGE_MEMBER_INACTIVE_RESTORE_REQUIRED"}'::jsonb);
  end if;
  return result;
end
$function$;

create function projectceo_api.restore_package_member_access(
  project_id uuid,
  package_id uuid,
  member_user_id uuid,
  expected_role text,
  expected_state_revision bigint,
  idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
#variable_conflict use_variable
declare
  ctx record;
  workflow_state bigint;
  key_digest bytea;
  request_digest bytea;
  replay jsonb;
  org_status text;
  membership projectceo_foundation.package_memberships%rowtype;
  result jsonb;
begin
  if package_id is null or package_id=project_id or member_user_id is null
    or expected_role not in ('architect','builder','client_approver') then
    perform projectceo_foundation._raise('P1111','validation_failed','{"field":"member"}'::jsonb);
  end if;
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  select * into strict ctx
  from projectceo_foundation._authorize_project_human(project_id,'manage_access');
  select workflow.state_revision into strict workflow_state
  from project_intelligence.project_workflows workflow
  where workflow.organization_id=ctx.organization_id
    and workflow.project_id=restore_package_member_access.project_id
  for update;
  key_digest:=project_intelligence._sha256_text(btrim(idempotency_key));
  request_digest:=project_intelligence._sha256_jsonb(jsonb_build_object(
    'projectId',project_id,'packageId',package_id,'memberUserId',member_user_id,
    'expectedRole',expected_role,'expectedStateRevision',expected_state_revision));
  replay:=projectceo_foundation._replay_or_null(
    ctx.organization_id,project_id,'restore_package_member_access',key_digest,request_digest);
  if replay is not null then return replay; end if;
  if workflow_state<>expected_state_revision then
    perform projectceo_foundation._raise(
      'P1107','stale_state',jsonb_build_object('currentStateRevision',workflow_state));
  end if;
  perform 1 from projectceo_foundation.project_packages package
  where package.organization_id=ctx.organization_id
    and package.project_id=restore_package_member_access.project_id
    and package.id=restore_package_member_access.package_id
    and package.kind='work_package' and package.status='active'
  for share;
  if not found then
    perform projectceo_foundation._raise('P1104','not_found','{"entity":"work_package"}'::jsonb);
  end if;
  select member.status into org_status
  from project_intelligence.organization_members member
  where member.organization_id=ctx.organization_id and member.user_id=member_user_id
  for update;
  if not found then
    perform projectceo_foundation._raise('P1104','not_found','{"entity":"organization_member"}'::jsonb);
  end if;
  select * into membership
  from projectceo_foundation.package_memberships member
  where member.organization_id=ctx.organization_id
    and member.project_id=restore_package_member_access.project_id
    and member.package_id=restore_package_member_access.package_id
    and member.user_id=member_user_id
  for update;
  if not found then
    perform projectceo_foundation._raise('P1104','not_found','{"entity":"package_member"}'::jsonb);
  end if;
  if membership.role<>expected_role then
    perform projectceo_foundation._raise(
      'P1109','scope_conflict','{"reason":"PACKAGE_MEMBER_ROLE_REPLACEMENT_REQUIRED"}'::jsonb);
  end if;
  if org_status='active' and membership.status='active' then
    perform projectceo_foundation._raise(
      'P1109','scope_conflict','{"reason":"PACKAGE_MEMBER_ALREADY_ACTIVE"}'::jsonb);
  end if;
  if org_status='inactive' and (
    exists(select 1 from projectceo_foundation.project_memberships other
      where other.organization_id=ctx.organization_id and other.user_id=member_user_id
        and other.status='active')
    or exists(select 1 from projectceo_foundation.package_memberships other
      where other.organization_id=ctx.organization_id and other.user_id=member_user_id
        and other.status='active'
        and (other.project_id,other.package_id) is distinct from
          (restore_package_member_access.project_id,restore_package_member_access.package_id))
  ) then
    perform projectceo_foundation._raise(
      'P1109','scope_conflict','{"reason":"ORGANIZATION_MEMBER_SCOPE_RECONCILIATION_REQUIRED"}'::jsonb);
  end if;
  update project_intelligence.organization_members member
  set status='active'
  where member.organization_id=ctx.organization_id and member.user_id=member_user_id
    and member.status='inactive';
  update projectceo_foundation.package_memberships member
  set status='active'
  where member.organization_id=ctx.organization_id
    and member.project_id=restore_package_member_access.project_id
    and member.package_id=restore_package_member_access.package_id
    and member.user_id=member_user_id and member.status='inactive';
  result:=jsonb_build_object(
    'organizationId',ctx.organization_id,'projectId',project_id,'packageId',package_id,
    'memberUserId',member_user_id,'role',expected_role,'status','active');
  return projectceo_foundation._complete_project_command(
    ctx.organization_id,project_id,'restore_package_member_access',key_digest,request_digest,
    'human',ctx.actor_id,ctx.actor_user_id,result,'package_member_access_restored',
    jsonb_build_object('package_id',package_id,'member_user_id',member_user_id,'role',expected_role),
    workflow_state);
end
$function$;

alter function projectceo_api.enroll_organization_project_scope(uuid,uuid,text,text,jsonb,text)
  owner to pi_table_owner;
alter function projectceo_api.restore_package_member_access(uuid,uuid,uuid,text,bigint,text)
  owner to pi_table_owner;
revoke all on function projectceo_api.enroll_organization_project_scope(uuid,uuid,text,text,jsonb,text)
  from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
revoke all on function projectceo_api.restore_package_member_access(uuid,uuid,uuid,text,bigint,text)
  from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
grant execute on function projectceo_api.enroll_organization_project_scope(uuid,uuid,text,text,jsonb,text)
  to authenticated;
grant execute on function projectceo_api.restore_package_member_access(uuid,uuid,uuid,text,bigint,text)
  to authenticated;
commit;
