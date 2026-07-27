-- A proposal revision may only be issued while the locked mutable projection
-- still contains the exact content that was approved.

create or replace function public.issue_proposal_revision(
  p_proposal_revision_id uuid,
  p_approval_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_revision public.proposal_revisions;
  v_proposal public.proposals;
  v_approval public.approval_requests;
  v_run public.workflow_runs;
  v_designer_id uuid;
  v_max_revision integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select r.* into v_revision
  from public.proposal_revisions r
  join public.proposals pr on pr.id = r.proposal_id
  join public.projects p on p.id = r.project_id
  where r.id = p_proposal_revision_id
    and pr.project_id = r.project_id
    and private.is_studio_member(p.designer_id)
  for update of r;

  if not found then
    raise exception 'proposal revision not found or access denied';
  end if;

  select pr.* into v_proposal
  from public.proposals pr
  where pr.id = v_revision.proposal_id
    and pr.project_id = v_revision.project_id
  for update;
  if not found then
    raise exception 'proposal revision parent not found';
  end if;

  if v_proposal.sections is distinct from v_revision.sections then
    raise exception 'proposal draft differs from approved revision';
  end if;

  select p.designer_id into v_designer_id
  from public.projects p
  where p.id = v_revision.project_id;

  select a.* into v_approval
  from public.approval_requests a
  where a.id = p_approval_request_id
  for update;

  if not found
    or v_approval.project_id is distinct from v_revision.project_id
    or v_approval.subject_type is distinct from 'proposal'
    or v_approval.subject_id is distinct from v_revision.proposal_id
    or v_approval.proposal_revision_id is distinct from v_revision.id
    or v_approval.approval_type is distinct from 'RELEASE_AUTHORIZED'
    or v_approval.status is distinct from 'approved' then
    raise exception 'approved proposal revision authorization required';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  where w.id = v_approval.workflow_run_id
    and w.project_id = v_revision.project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
  for update;
  if not found then
    raise exception 'approval workflow identity invalid';
  end if;

  if v_proposal.status = 'sent'
    and v_proposal.issued_revision_id = v_revision.id
    and v_approval.issued_at is not null
    and v_run.status = 'completed' then
    insert into public.audit_events(
      project_id, actor_id, actor_type, event_type, entity_type,
      entity_id, workflow_run_id, payload
    )
    values (
      v_revision.project_id, v_actor, 'human',
      'proposal_issuance_replayed_idempotently', 'proposal_revision',
      v_revision.id, v_run.id,
      jsonb_build_object('proposal_id', v_proposal.id, 'version', v_revision.version)
    );
    return v_proposal.id;
  end if;

  if v_proposal.status <> 'draft'
    or v_proposal.issued_revision_id is not null
    or v_approval.issued_at is not null
    or v_run.status <> 'running'
    or v_run.current_step <> 'issue_proposal' then
    raise exception 'proposal is not in an issuable state';
  end if;

  select max(r.version) into v_max_revision
  from public.proposal_revisions r
  where r.proposal_id = v_proposal.id;
  if v_revision.version is distinct from v_max_revision
    or v_revision.version <= v_proposal.version then
    raise exception 'only the current monotonic proposal revision can be issued';
  end if;

  update public.proposals
  set sections = v_revision.sections, version = v_revision.version,
      status = 'sent', sent_at = now(), issued_revision_id = v_revision.id
  where id = v_revision.proposal_id
    and project_id = v_revision.project_id
    and status = 'draft'
    and issued_revision_id is null;
  if not found then
    raise exception 'proposal changed concurrently';
  end if;

  update public.approval_requests
  set issued_at = now()
  where id = v_approval.id
    and status = 'approved'
    and proposal_revision_id = v_revision.id
    and issued_at is null;
  if not found then
    raise exception 'approval changed concurrently';
  end if;

  update public.projects
  set status = 'proposal_sent'
  where id = v_revision.project_id
    and status in ('brief_completed', 'proposal_draft');
  if not found then
    raise exception 'project is not in an issuable state';
  end if;

  update public.workflow_runs
  set status = 'completed', current_step = 'issue_proposal',
      completed_at = now(),
      output_snapshot = jsonb_build_object(
        'proposal_id', v_proposal.id,
        'proposal_revision_id', v_revision.id,
        'proposal_issued', true
      ),
      error_state = null
  where id = v_run.id
    and status = 'running'
    and current_step = 'issue_proposal';
  if not found then
    raise exception 'workflow changed concurrently';
  end if;

  insert into public.audit_events(
    project_id, actor_id, actor_type, event_type, entity_type,
    entity_id, workflow_run_id, payload
  )
  values (
    v_revision.project_id, v_actor, 'human', 'proposal_issued',
    'proposal_revision', v_revision.id, v_run.id,
    jsonb_build_object(
      'proposal_id', v_proposal.id,
      'approval_request_id', v_approval.id,
      'version', v_revision.version
    )
  );

  insert into public.events(designer_id, project_id, type)
  values (v_designer_id, v_revision.project_id, 'proposal_sent');

  return v_revision.proposal_id;
end;
$$;

revoke all on function public.issue_proposal_revision(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.issue_proposal_revision(uuid, uuid)
  to authenticated;
