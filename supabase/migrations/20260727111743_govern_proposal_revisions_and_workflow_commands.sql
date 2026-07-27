-- Govern M1 workflow commands and issued proposal snapshots.
-- This migration is additive: existing mutable proposal drafts remain compatible,
-- while every authorized/issued version is captured in an immutable revision.

revoke all on table public.workflow_runs from authenticated;
revoke all on table public.workflow_step_runs from authenticated;
revoke all on table public.approval_requests from authenticated;

grant select on table public.workflow_runs to authenticated;
grant select on table public.workflow_step_runs to authenticated;
grant select on table public.approval_requests to authenticated;

create table if not exists public.proposal_revisions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  version integer not null check (version > 0),
  sections jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (proposal_id, version)
);

create index if not exists proposal_revisions_project_idx
  on public.proposal_revisions(project_id, created_at);

alter table public.proposal_revisions enable row level security;

drop policy if exists proposal_revisions_studio_select
  on public.proposal_revisions;
create policy proposal_revisions_studio_select
on public.proposal_revisions for select to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = proposal_revisions.project_id
      and private.is_studio_member(p.designer_id)
  )
);

revoke all on table public.proposal_revisions from authenticated;
revoke all on table public.proposal_revisions from anon;
grant select on table public.proposal_revisions to authenticated;

alter table public.approval_requests
  add column if not exists proposal_revision_id uuid
  references public.proposal_revisions(id) on delete restrict;

alter table public.approval_requests
  add column if not exists issued_at timestamptz;

alter table public.proposals
  add column if not exists issued_revision_id uuid
  references public.proposal_revisions(id) on delete restrict;

alter table public.approval_requests
  drop constraint if exists approval_requests_proposal_revision_required;
alter table public.approval_requests
  add constraint approval_requests_proposal_revision_required
  check (
    (subject_type = 'proposal' and proposal_revision_id is not null)
    or (subject_type <> 'proposal' and proposal_revision_id is null)
  ) not valid;

create index if not exists approval_requests_proposal_revision_idx
  on public.approval_requests(proposal_revision_id);

create or replace function private.reject_proposal_revision_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'proposal revisions are immutable';
end;
$$;

revoke all on function private.reject_proposal_revision_mutation()
  from public, anon, authenticated;

drop trigger if exists proposal_revisions_immutable
  on public.proposal_revisions;
create trigger proposal_revisions_immutable
before update or delete on public.proposal_revisions
for each row execute function private.reject_proposal_revision_mutation();

create or replace function private.enforce_proposal_revision_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.proposals pr
    where pr.id = new.proposal_id
      and pr.project_id = new.project_id
  ) then
    raise exception 'proposal revision project does not match proposal';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_proposal_revision_project()
  from public, anon, authenticated;

drop trigger if exists proposal_revisions_project_identity
  on public.proposal_revisions;
create trigger proposal_revisions_project_identity
before insert on public.proposal_revisions
for each row execute function private.enforce_proposal_revision_project();

create or replace function private.enforce_approval_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id
    or new.workflow_run_id is distinct from old.workflow_run_id
    or new.subject_type is distinct from old.subject_type
    or new.subject_id is distinct from old.subject_id
    or new.proposal_revision_id is distinct from old.proposal_revision_id
    or new.approval_type is distinct from old.approval_type
    or new.required_role is distinct from old.required_role
    or new.requested_by is distinct from old.requested_by
    or new.created_at is distinct from old.created_at then
    raise exception 'approval request identity is immutable';
  end if;
  return new;
end;
$$;

create or replace function public.prepare_m1_risk_retry(p_workflow_run_id uuid)
returns public.workflow_step_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.workflow_runs;
  v_step public.workflow_step_runs;
  v_attempt integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  join public.projects p on p.id = w.project_id
  where w.id = p_workflow_run_id
    and private.is_studio_member(p.designer_id)
  for update of w;

  if not found then
    raise exception 'workflow run not found or access denied';
  end if;
  if v_run.workflow_key <> 'client_intake_to_issued_proposal'
    or v_run.status <> 'failed' then
    raise exception 'invalid workflow retry state';
  end if;

  select coalesce(max(s.attempt), 0) + 1 into v_attempt
  from public.workflow_step_runs s
  where s.workflow_run_id = v_run.id
    and s.step_key = 'generate_risk_register';

  update public.workflow_runs
  set status = 'retrying', current_step = 'generate_risk_register',
      error_state = null
  where id = v_run.id;

  insert into public.workflow_step_runs(
    workflow_run_id, step_key, attempt, status, input_snapshot, started_at
  )
  values (
    v_run.id, 'generate_risk_register', v_attempt, 'running',
    jsonb_build_object('requested_by', v_actor), now()
  )
  returning * into v_step;

  insert into public.audit_events(
    project_id, actor_id, actor_type, event_type, entity_type,
    entity_id, workflow_run_id, payload
  )
  values (
    v_run.project_id, v_actor, 'human', 'workflow_retry_started',
    'workflow_step_run', v_step.id, v_run.id,
    jsonb_build_object('step_key', v_step.step_key, 'attempt', v_step.attempt)
  );

  return v_step;
end;
$$;

revoke all on function public.prepare_m1_risk_retry(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_m1_risk_retry(uuid) to authenticated;

create or replace function public.complete_m1_risk_retry(
  p_workflow_run_id uuid,
  p_step_run_id uuid,
  p_output_snapshot jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.workflow_runs;
  v_step public.workflow_step_runs;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  join public.projects p on p.id = w.project_id
  where w.id = p_workflow_run_id
    and w.status = 'retrying'
    and private.is_studio_member(p.designer_id)
  for update of w;
  if not found then
    raise exception 'retry workflow not found, invalid, or access denied';
  end if;

  select s.* into v_step
  from public.workflow_step_runs s
  where s.workflow_run_id = v_run.id
    and s.step_key = 'generate_risk_register'
  order by s.attempt desc
  limit 1
  for update;
  if not found
    or v_step.id is distinct from p_step_run_id
    or v_step.status is distinct from 'running' then
    raise exception 'retry attempt not found, invalid, or access denied';
  end if;

  update public.workflow_step_runs
  set status = 'completed', output_snapshot = coalesce(p_output_snapshot, '{}'::jsonb),
      error = null, completed_at = now()
  where id = v_step.id and status = 'running';
  if not found then
    raise exception 'retry attempt changed concurrently';
  end if;

  update public.workflow_runs
  set status = 'running', error_state = null
  where id = v_run.id and status = 'retrying';
  if not found then
    raise exception 'retry workflow changed concurrently';
  end if;

  update public.workflow_runs
  set status = 'waiting_for_human', current_step = 'human_review'
  where id = v_run.id and status = 'running';
  if not found then
    raise exception 'retry workflow could not enter human review';
  end if;

  insert into public.audit_events(
    project_id, actor_id, actor_type, event_type, entity_type,
    entity_id, workflow_run_id, payload
  )
  values (
    v_run.project_id, v_actor, 'human', 'workflow_retry_completed',
    'workflow_step_run', v_step.id, v_run.id,
    jsonb_build_object('step_key', v_step.step_key, 'attempt', v_step.attempt)
  );
end;
$$;

revoke all on function public.complete_m1_risk_retry(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_m1_risk_retry(uuid, uuid, jsonb)
  to authenticated;

create or replace function public.fail_m1_risk_retry(
  p_workflow_run_id uuid,
  p_step_run_id uuid,
  p_error jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.workflow_runs;
  v_step public.workflow_step_runs;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_error is null or jsonb_typeof(p_error) <> 'object' then
    raise exception 'error payload must be an object';
  end if;
  select w.* into v_run
  from public.workflow_runs w
  join public.projects p on p.id = w.project_id
  where w.id = p_workflow_run_id
    and w.status = 'retrying'
    and private.is_studio_member(p.designer_id)
  for update of w;
  if not found then
    raise exception 'retry workflow not found, invalid, or access denied';
  end if;

  select s.* into v_step
  from public.workflow_step_runs s
  where s.workflow_run_id = v_run.id
    and s.step_key = 'generate_risk_register'
  order by s.attempt desc
  limit 1
  for update;
  if not found
    or v_step.id is distinct from p_step_run_id
    or v_step.status is distinct from 'running' then
    raise exception 'retry attempt not found, invalid, or access denied';
  end if;

  update public.workflow_step_runs
  set status = 'failed', error = p_error, completed_at = now()
  where id = v_step.id and status = 'running';
  if not found then
    raise exception 'retry attempt changed concurrently';
  end if;

  update public.workflow_runs
  set status = 'failed', error_state = p_error
  where id = v_run.id and status = 'retrying';
  if not found then
    raise exception 'retry workflow changed concurrently';
  end if;

  insert into public.audit_events(
    project_id, actor_id, actor_type, event_type, entity_type,
    entity_id, workflow_run_id, payload
  )
  values (
    v_run.project_id, v_actor, 'human', 'workflow_retry_failed',
    'workflow_step_run', v_step.id, v_run.id,
    jsonb_build_object(
      'step_key', v_step.step_key, 'attempt', v_step.attempt, 'error', p_error
    )
  );
end;
$$;

revoke all on function public.fail_m1_risk_retry(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fail_m1_risk_retry(uuid, uuid, jsonb)
  to authenticated;

create or replace function public.record_m1_risk_rerun(
  p_project_id uuid,
  p_workflow_run_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.workflow_runs;
  v_step public.workflow_step_runs;
  v_attempt integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  join public.projects p on p.id = w.project_id
  where w.id = p_workflow_run_id
    and w.project_id = p_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.status in ('running', 'waiting_for_human')
    and private.is_studio_member(p.designer_id)
  for update of w;
  if not found then
    raise exception 'project/workflow identity invalid or access denied';
  end if;

  select coalesce(max(s.attempt), 0) + 1 into v_attempt
  from public.workflow_step_runs s
  where s.workflow_run_id = v_run.id
    and s.step_key = 'generate_risk_register';

  insert into public.workflow_step_runs(
    workflow_run_id, step_key, attempt, status, input_snapshot,
    output_snapshot, started_at, completed_at
  )
  values (
    v_run.id, 'generate_risk_register', v_attempt, 'completed',
    jsonb_build_object('requested_by', v_actor),
    coalesce(p_payload, '{}'::jsonb), now(), now()
  )
  returning * into v_step;

  insert into public.audit_events(
    project_id, actor_id, actor_type, event_type, entity_type,
    entity_id, workflow_run_id, payload
  )
  values (
    p_project_id, v_actor, 'human', 'm1_risk_rerun_recorded',
    'workflow_step_run', v_step.id, p_workflow_run_id,
    jsonb_build_object('attempt', v_step.attempt, 'output', v_step.output_snapshot)
  );

  return v_step.id;
end;
$$;

revoke all on function public.record_m1_risk_rerun(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_m1_risk_rerun(uuid, uuid, jsonb)
  to authenticated;

create or replace function public.authorize_proposal_revision(
  p_proposal_id uuid,
  p_workflow_run_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_proposal public.proposals;
  v_run public.workflow_runs;
  v_revision_id uuid;
  v_approval_id uuid;
  v_version integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select pr.* into v_proposal
  from public.proposals pr
  join public.projects p on p.id = pr.project_id
  where pr.id = p_proposal_id
    and private.is_studio_member(p.designer_id)
  for update of pr;

  if not found then
    raise exception 'proposal not found or access denied';
  end if;
  if v_proposal.status <> 'draft'
    or v_proposal.issued_revision_id is not null then
    raise exception 'only an unissued draft proposal can be authorized';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  where w.id = p_workflow_run_id
    and w.project_id = v_proposal.project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and (
      (w.status = 'waiting_for_human' and w.current_step = 'human_review')
      or (w.status = 'running' and w.current_step = 'issue_proposal')
    )
  for update;
  if not found then
    raise exception 'workflow/proposal identity invalid';
  end if;

  select a.id, r.id into v_approval_id, v_revision_id
  from public.proposal_revisions r
  join public.approval_requests a
    on a.proposal_revision_id = r.id
   and a.workflow_run_id = v_run.id
   and a.approval_type = 'RELEASE_AUTHORIZED'
   and a.status in ('pending', 'approved')
  where r.proposal_id = v_proposal.id
    and r.sections = v_proposal.sections
  order by r.version desc
  limit 1;

  if v_approval_id is not null then
    if v_run.status = 'waiting_for_human' then
      update public.workflow_runs
      set status = 'running', current_step = 'issue_proposal', error_state = null
      where id = v_run.id
        and status = 'waiting_for_human'
        and current_step = 'human_review';
      if not found then
        raise exception 'workflow changed concurrently';
      end if;
    end if;

    insert into public.audit_events(
      project_id, actor_id, actor_type, event_type, entity_type,
      entity_id, workflow_run_id, payload
    )
    values (
      v_proposal.project_id, v_actor, 'human',
      'proposal_release_authorization_reused', 'approval_request',
      v_approval_id, v_run.id,
      jsonb_build_object('proposal_revision_id', v_revision_id)
    );
    return v_approval_id;
  end if;

  select greatest(
    v_proposal.version,
    coalesce(max(r.version), 0)
  ) + 1 into v_version
  from public.proposal_revisions r
  where r.proposal_id = v_proposal.id;

  insert into public.proposal_revisions(
    proposal_id, project_id, version, sections, created_by
  )
  values (
    v_proposal.id, v_proposal.project_id, v_version,
    v_proposal.sections, v_actor
  )
  returning id into v_revision_id;

  insert into public.approval_requests(
    project_id, workflow_run_id, subject_type, subject_id,
    proposal_revision_id, approval_type, required_role, requested_by,
    status, decision_by, decision_at, self_approved
  )
  values (
    v_proposal.project_id, p_workflow_run_id, 'proposal', v_proposal.id,
    v_revision_id, 'RELEASE_AUTHORIZED', 'member', v_actor,
    'approved', v_actor, now(), true
  )
  returning id into v_approval_id;

  if v_run.status = 'waiting_for_human' then
    update public.workflow_runs
    set status = 'running', current_step = 'issue_proposal', error_state = null
    where id = v_run.id
      and status = 'waiting_for_human'
      and current_step = 'human_review';
    if not found then
      raise exception 'workflow changed concurrently';
    end if;
  end if;

  insert into public.audit_events(
    project_id, actor_id, actor_type, event_type, entity_type,
    entity_id, workflow_run_id, payload
  )
  values (
    v_proposal.project_id, v_actor, 'human',
    'proposal_release_authorized', 'approval_request',
    v_approval_id, v_run.id,
    jsonb_build_object(
      'proposal_id', v_proposal.id,
      'proposal_revision_id', v_revision_id,
      'version', v_version,
      'self_approved', true
    )
  );

  return v_approval_id;
end;
$$;

revoke all on function public.authorize_proposal_revision(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.authorize_proposal_revision(uuid, uuid)
  to authenticated;

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
