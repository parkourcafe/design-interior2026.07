-- Authenticated read surface for private R1 external-review evidence.
-- It is deliberately read-only: no submit, decision, release or access grant
-- can be reached through this function.
begin;

create function projectceo_read_api.get_external_review(
  p_project_id uuid,
  p_package_id uuid,
  p_submission_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_variable
declare
  v_base jsonb;
  v_org uuid;
  v_actor uuid;
  v_role text;
  v_submission projectceo_foundation.external_review_submissions%rowtype;
  v_head projectceo_foundation.external_review_subject_heads%rowtype;
  v_refs jsonb := '[]'::jsonb;
  v_decisions jsonb := '[]'::jsonb;
  v_release_eligibility text;
begin
  -- Start from the project-scoped authenticated read. A project owner is
  -- allowed to inspect an exact package without also holding a redundant
  -- package-membership row; a client is checked below against that exact row.
  v_base := projectceo_read_api.get_project_workspace_read_v5(p_project_id, null);
  if v_base->'error' is not null and v_base->'error' <> 'null'::jsonb then
    return v_base;
  end if;
  v_org := (v_base#>>'{scope,organizationId}')::uuid;
  v_actor := (v_base#>>'{scope,actorUserId}')::uuid;

  select membership.role into v_role
  from projectceo_foundation.project_memberships membership
  where membership.organization_id = v_org
    and membership.project_id = p_project_id
    and membership.user_id = v_actor
    and membership.status = 'active';
  if v_role is null then
    return jsonb_build_object(
      'contractVersion', v_base->>'contractVersion', 'requestId', v_base->>'requestId',
      'data', null, 'error', jsonb_build_object('code','forbidden','messageKey','projectceo.read.forbidden'),
      'scope', null, 'stateRevision', null
    );
  end if;

  select submission.* into v_submission
  from projectceo_foundation.external_review_submissions submission
  where submission.organization_id = v_org
    and submission.project_id = p_project_id
    and submission.package_id = p_package_id
    and submission.submission_id = p_submission_id;
  if not found then
    return jsonb_build_object(
      'contractVersion', v_base->>'contractVersion', 'requestId', v_base->>'requestId',
      'data', null, 'error', jsonb_build_object('code','not_found','messageKey','projectceo.read.not_found'),
      'scope', null, 'stateRevision', null
    );
  end if;
  select head.* into v_head
  from projectceo_foundation.external_review_subject_heads head
  where head.organization_id = v_org and head.project_id = p_project_id
    and head.package_id = p_package_id and head.review_thread_id = v_submission.review_thread_id;
  if not found then
    return jsonb_build_object(
      'contractVersion', v_base->>'contractVersion', 'requestId', v_base->>'requestId',
      'data', null, 'error', jsonb_build_object('code','not_found','messageKey','projectceo.read.not_found'),
      'scope', null, 'stateRevision', null
    );
  end if;

  -- A client can read only the exact submission assigned to them. Builders and
  -- guests receive no review evidence; owner/architect access is scoped by the
  -- authenticated workspace-read gate above.
  if v_role not in ('owner_lead','architect') and (
    v_role is distinct from 'client_approver'
    or v_submission.assigned_client_user_id is distinct from v_actor
    or not exists (
      select 1 from projectceo_foundation.package_memberships membership
      where membership.organization_id = v_org and membership.project_id = p_project_id
        and membership.package_id = p_package_id and membership.user_id = v_actor
        and membership.role = 'client_approver' and membership.status = 'active'
    )
  ) then
    return jsonb_build_object(
      'contractVersion', v_base->>'contractVersion', 'requestId', v_base->>'requestId',
      'data', null, 'error', jsonb_build_object('code','forbidden','messageKey','projectceo.read.forbidden'),
      'scope', null, 'stateRevision', null
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ordinal', ref.ordinal, 'kind', ref.ref_kind,
    'digest', 'sha256:' || encode(ref.semantic_digest, 'hex')
  ) order by ref.ordinal), '[]'::jsonb) into v_refs
  from projectceo_foundation.external_review_submission_refs ref
  where ref.organization_id = v_org and ref.project_id = p_project_id
    and ref.package_id = p_package_id and ref.submission_id = p_submission_id;

  select coalesce(jsonb_agg(decision order by decision->>'reviewType'), '[]'::jsonb) into v_decisions
  from (
    select jsonb_build_object(
      'reviewType','design', 'decision', d.decision, 'approvalType', d.approval_type,
      'selfApproved', d.self_approved, 'authorshipDisclosure', d.authorship_disclosure,
      'decisionDigest', 'sha256:' || encode(d.semantic_digest, 'hex'), 'decidedAt', d.decided_at
    ) decision
    from projectceo_foundation.external_review_design_decisions d
    where d.organization_id = v_org and d.project_id = p_project_id
      and d.package_id = p_package_id and d.submission_id = p_submission_id
    union all
    select jsonb_build_object(
      'reviewType','technical', 'decision', d.decision, 'approvalType', d.approval_type,
      'selfApproved', d.self_approved, 'authorshipDisclosure', d.authorship_disclosure,
      'decisionDigest', 'sha256:' || encode(d.semantic_digest, 'hex'), 'decidedAt', d.decided_at
    ) decision
    from projectceo_foundation.external_review_technical_decisions d
    where d.organization_id = v_org and d.project_id = p_project_id
      and d.package_id = p_package_id and d.submission_id = p_submission_id
  ) decisions;

  v_release_eligibility := case v_submission.purpose
    when 'file_review' then 'ineligible_file_review'
    else 'not_evaluated'
  end;
  return jsonb_build_object(
    'contractVersion', v_base->>'contractVersion', 'requestId', v_base->>'requestId',
    'data', jsonb_build_object(
      'reviewThreadId', v_submission.review_thread_id,
      'submissionId', v_submission.submission_id,
      'purpose', v_submission.purpose,
      'snapshotSchemaVersion', v_submission.snapshot_schema_version,
      'submissionRevision', v_submission.submission_revision,
      'subjectDigest', 'sha256:' || encode(v_submission.subject_digest, 'hex'),
      'lifecycleRevision', v_head.lifecycle_revision,
      'eventSequence', v_head.last_event_sequence,
      'status', case when exists (
        select 1 from projectceo_foundation.external_review_events event
        where event.organization_id = v_org and event.project_id = p_project_id
          and event.package_id = p_package_id and event.review_thread_id = v_submission.review_thread_id
          and event.submission_id = p_submission_id and event.event_kind = 'withdrawn'
      ) then 'withdrawn' when v_head.current_submission_id = p_submission_id then 'current' else 'superseded' end,
      'currentSubmissionId', v_head.current_submission_id,
      'safeExactRefs', v_refs,
      'reviewReadiness', 'not_evaluated',
      'releaseEligibility', v_release_eligibility,
      'decisions', v_decisions,
      'allowedActions', '[]'::jsonb
    ), 'error', null, 'scope', v_base->'scope', 'stateRevision', v_base->'stateRevision'
  );
end $function$;

alter function projectceo_read_api.get_external_review(uuid,uuid,uuid) owner to pi_table_owner;
revoke all on function projectceo_read_api.get_external_review(uuid,uuid,uuid)
  from public,anon,service_role,pi_human_executor,pi_worker_executor;
grant execute on function projectceo_read_api.get_external_review(uuid,uuid,uuid) to authenticated;

commit;
