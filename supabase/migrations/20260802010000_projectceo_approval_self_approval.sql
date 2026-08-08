-- Additive approval provenance for the canonical M2 foundation.
--
-- Existing timestamped migrations remain immutable.  The package creator is
-- the initiated_by actor; a terminal human review records decision_by and the
-- explicit self_approved marker when the same actor performs both actions.

begin;

alter table projectceo_product.approval_package_events
  add column self_approved boolean not null default false;

alter table projectceo_product.approval_package_events
  add constraint approval_package_events_self_approval_shape
  check (
    not self_approved
    or (sequence_no = 3 and to_status = 'approved')
  );

create or replace function projectceo_product._transition_approval_package(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_actor_id text,
  p_operation text,
  p_project_id uuid,
  p_approval_package_id text,
  p_expected_status text,
  p_to_status text,
  p_reason text,
  p_expected_state_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_current_status text;
  v_sequence_no bigint;
  v_reason text;
  v_result jsonb;
  v_initiated_by_user_id uuid;
  v_self_approved boolean := false;
begin
  perform projectceo_product._assert_text(
    p_approval_package_id,
    'approvalPackageId',
    160
  );
  perform projectceo_foundation._assert_state_revision(
    p_expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(p_idempotency_key);
  if p_operation = 'submit_approval_package' then
    if p_expected_status <> 'draft'
       or p_to_status <> 'submitted'
       or p_reason is not null then
      perform projectceo_product._raise(
        'P1111',
        'validation_failed',
        '{"reason":"APPROVAL_SUBMIT_TRANSITION_INVALID"}'::jsonb
      );
    end if;
    v_sequence_no := 2;
  else
    if p_expected_status <> 'submitted'
       or p_to_status not in (
         'approved',
         'rejected',
         'change_requested'
       ) then
      perform projectceo_product._raise(
        'P1111',
        'validation_failed',
        '{"reason":"APPROVAL_REVIEW_TRANSITION_INVALID"}'::jsonb
      );
    end if;
    v_reason := projectceo_product._assert_text(
      p_reason,
      'reason',
      4000
    );
    v_sequence_no := 3;
  end if;

  v_key_digest := project_intelligence._sha256_text(
    btrim(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'approvalPackageId', p_approval_package_id,
      'expectedStateRevision', p_expected_state_revision,
      'expectedStatus', p_expected_status,
      'projectId', p_project_id,
      'reason', v_reason,
      'toStatus', p_to_status
    )
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = p_organization_id
    and pw.project_id = p_project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    p_organization_id,
    p_project_id,
    p_operation,
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> p_expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select approval.created_by_user_id
  into v_initiated_by_user_id
  from projectceo_product.approval_packages approval
  where approval.organization_id = p_organization_id
    and approval.project_id = p_project_id
    and approval.approval_package_id = p_approval_package_id
  for update;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"approvalPackage"}'::jsonb
    );
  end if;

  select ape.to_status into v_current_status
  from projectceo_product.approval_package_events ape
  where ape.organization_id = p_organization_id
    and ape.project_id = p_project_id
    and ape.approval_package_id = p_approval_package_id
  order by ape.sequence_no desc
  limit 1
  for update;
  if v_current_status is null then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"approvalPackage"}'::jsonb
    );
  end if;
  if v_current_status <> p_expected_status then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStatus', v_current_status)
    );
  end if;

  if v_sequence_no = 3 then
    v_self_approved := p_to_status = 'approved'
      and v_initiated_by_user_id = p_actor_user_id;
  end if;

  insert into projectceo_product.approval_package_events (
    organization_id,
    project_id,
    approval_package_id,
    sequence_no,
    from_status,
    to_status,
    actor_user_id,
    reason,
    reason_digest,
    self_approved
  )
  values (
    p_organization_id,
    p_project_id,
    p_approval_package_id,
    v_sequence_no,
    p_expected_status,
    p_to_status,
    p_actor_user_id,
    v_reason,
    case
      when v_reason is null then null
      else project_intelligence._sha256_text(v_reason)
    end,
    v_self_approved
  );

  v_result := jsonb_build_object(
    'approvalPackageId', p_approval_package_id,
    'projectId', p_project_id,
    'selfApproved', v_self_approved,
    'status', p_to_status
  );
  return projectceo_product._complete_command(
    p_organization_id,
    p_project_id,
    p_operation,
    v_key_digest,
    v_request_digest,
    'human',
    p_actor_id,
    p_actor_user_id,
    v_result,
    case
      when p_to_status = 'submitted'
        then 'approval_package_submitted'
      else 'approval_package_reviewed'
    end,
    jsonb_build_object(
      'approval_package_id', p_approval_package_id,
      'from_status', p_expected_status,
      'self_approved', v_self_approved,
      'to_status', p_to_status
    ),
    v_state_revision
  );
end
$function$;

commit;
