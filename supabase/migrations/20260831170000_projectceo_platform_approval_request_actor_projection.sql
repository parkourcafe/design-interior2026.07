-- M1 approval read projection: expose only whether the current authenticated
-- actor created each draft. The actor identity itself stays server-side.

begin;

create or replace function projectceo_platform_api.list_approval_requests(
  p_project_id uuid,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_actor_user_id uuid;
  v_data jsonb;
begin
  if p_status is not null and p_status not in
    ('draft', 'submitted', 'approved', 'rejected') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"status"}'::jsonb);
  end if;

  select context.organization_id, context.actor_user_id
    into v_organization_id, v_actor_user_id
  from projectceo_foundation._authorize_project_human(
    p_project_id, 'view_project'
  ) context;

  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', r.request_id,
    'subjectKind', r.subject_kind,
    'subjectId', r.subject_id,
    'approverCapability', r.approver_capability,
    'status', r.status,
    'requestedByCurrentActor', r.requested_by = v_actor_user_id,
    'requestedReason', r.requested_reason,
    'selfApproved', r.self_approved,
    'decidedBy', r.decided_by,
    'decisionReason', r.decision_reason,
    'createdAt', r.created_at
  ) order by r.created_at, r.request_id), '[]'::jsonb) into v_data
  from projectceo_platform.approval_requests r
  where r.organization_id = v_organization_id
    and r.project_id = p_project_id
    and (p_status is null or r.status = p_status);

  return jsonb_build_object('requests', v_data);
end
$function$;

alter function projectceo_platform_api.list_approval_requests(uuid, text)
  owner to pi_table_owner;

commit;
