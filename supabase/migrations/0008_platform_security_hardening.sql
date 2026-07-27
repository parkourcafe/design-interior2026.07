-- ArchiDom Sprint 1 security hardening.
-- Additive follow-up to 0007: explicit Data API grants, non-exposed membership
-- helper, immutable approval identity, and workflow state-machine enforcement.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_studio_member(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select owner = (select auth.uid())
      or exists (
        select 1
        from public.studio_members m
        where m.owner_id = owner
          and m.member_id = (select auth.uid())
          and m.status = 'active'
      );
$$;

revoke all on function public.is_studio_member(uuid, uuid) from public, anon, authenticated;
revoke all on function private.is_studio_member(uuid) from public, anon;
grant execute on function private.is_studio_member(uuid) to authenticated;

-- Replace legacy policies so the SECURITY DEFINER helper is not exposed through
-- the public Data API. Existing policy semantics are preserved.
drop policy if exists projects_studio_all on public.projects;
create policy projects_studio_all on public.projects for all to authenticated
  using (private.is_studio_member(designer_id))
  with check (private.is_studio_member(designer_id));

drop policy if exists answers_studio_all on public.answers;
create policy answers_studio_all on public.answers for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = answers.project_id and private.is_studio_member(p.designer_id)
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = answers.project_id and private.is_studio_member(p.designer_id)
  ));

drop policy if exists risk_cards_studio_all on public.risk_cards;
create policy risk_cards_studio_all on public.risk_cards for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = risk_cards.project_id and private.is_studio_member(p.designer_id)
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = risk_cards.project_id and private.is_studio_member(p.designer_id)
  ));

drop policy if exists proposals_studio_all on public.proposals;
create policy proposals_studio_all on public.proposals for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = proposals.project_id and private.is_studio_member(p.designer_id)
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = proposals.project_id and private.is_studio_member(p.designer_id)
  ));

drop policy if exists designers_studio_select on public.designers;
create policy designers_studio_select on public.designers for select to authenticated
  using (private.is_studio_member(id));

drop policy if exists designers_studio_update on public.designers;
create policy designers_studio_update on public.designers for update to authenticated
  using (private.is_studio_member(id))
  with check (private.is_studio_member(id));

drop policy if exists events_studio_select on public.events;
create policy events_studio_select on public.events for select to authenticated
  using (private.is_studio_member(designer_id));

drop policy if exists events_studio_insert on public.events;
create policy events_studio_insert on public.events for insert to authenticated
  with check (private.is_studio_member(designer_id));

drop policy if exists studio_members_select on public.studio_members;
create policy studio_members_select on public.studio_members for select to authenticated
  using (private.is_studio_member(owner_id));

drop policy if exists studio_members_owner_insert on public.studio_members;
create policy studio_members_owner_insert on public.studio_members for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists studio_members_owner_delete on public.studio_members;
create policy studio_members_owner_delete on public.studio_members for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Replace Sprint 1 policies with the private helper and init-plan-safe auth calls.
drop policy if exists project_sources_studio_select on public.project_sources;
create policy project_sources_studio_select on public.project_sources for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_sources.project_id and private.is_studio_member(p.designer_id)
  ));

drop policy if exists project_facts_studio_select on public.project_facts;
create policy project_facts_studio_select on public.project_facts for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_facts.project_id and private.is_studio_member(p.designer_id)
  ));

drop policy if exists project_facts_studio_insert on public.project_facts;
create policy project_facts_studio_insert on public.project_facts for insert to authenticated
  with check (
    created_by_type = 'human'
    and created_by_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_facts.project_id and private.is_studio_member(p.designer_id)
    )
  );

drop policy if exists workflow_runs_studio_all on public.workflow_runs;
create policy workflow_runs_studio_all on public.workflow_runs for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = workflow_runs.project_id and private.is_studio_member(p.designer_id)
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = workflow_runs.project_id and private.is_studio_member(p.designer_id)
  ));

drop policy if exists workflow_step_runs_studio_all on public.workflow_step_runs;
create policy workflow_step_runs_studio_all on public.workflow_step_runs for all to authenticated
  using (exists (
    select 1
    from public.workflow_runs w
    join public.projects p on p.id = w.project_id
    where w.id = workflow_step_runs.workflow_run_id
      and private.is_studio_member(p.designer_id)
  ))
  with check (exists (
    select 1
    from public.workflow_runs w
    join public.projects p on p.id = w.project_id
    where w.id = workflow_step_runs.workflow_run_id
      and private.is_studio_member(p.designer_id)
  ));

drop policy if exists approval_requests_studio_select on public.approval_requests;
create policy approval_requests_studio_select on public.approval_requests for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = approval_requests.project_id and private.is_studio_member(p.designer_id)
  ));

drop policy if exists approval_requests_studio_insert on public.approval_requests;
create policy approval_requests_studio_insert on public.approval_requests for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and status in ('pending', 'approved')
    and (decision_by is null or decision_by = (select auth.uid()))
    and exists (
      select 1 from public.projects p
      where p.id = approval_requests.project_id and private.is_studio_member(p.designer_id)
    )
  );

drop policy if exists approval_requests_studio_update on public.approval_requests;
create policy approval_requests_studio_update on public.approval_requests for update to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = approval_requests.project_id and private.is_studio_member(p.designer_id)
  ))
  with check (
    decision_by = (select auth.uid())
    and status in ('approved', 'rejected', 'cancelled')
    and exists (
      select 1 from public.projects p
      where p.id = approval_requests.project_id and private.is_studio_member(p.designer_id)
    )
  );

drop policy if exists audit_events_studio_select on public.audit_events;
create policy audit_events_studio_select on public.audit_events for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = audit_events.project_id and private.is_studio_member(p.designer_id)
  ));

drop policy if exists ai_calls_studio_select on public.ai_calls;
create policy ai_calls_studio_select on public.ai_calls for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = ai_calls.project_id and private.is_studio_member(p.designer_id)
  ));

drop policy if exists studio_standards_studio_select on public.studio_standards;
create policy studio_standards_studio_select on public.studio_standards for select to authenticated
  using (private.is_studio_member(studio_id));

drop policy if exists studio_standards_owner_insert on public.studio_standards;
create policy studio_standards_owner_insert on public.studio_standards for insert to authenticated
  with check (
    studio_id = (select auth.uid())
    and created_by = (select auth.uid())
  );

drop policy if exists project_overrides_studio_all on public.project_overrides;
create policy project_overrides_studio_all on public.project_overrides for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_overrides.project_id and private.is_studio_member(p.designer_id)
  ))
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_overrides.project_id and private.is_studio_member(p.designer_id)
    )
  );

-- Do not inherit Supabase's broad default privileges for new public tables.
revoke all on table
  public.project_sources,
  public.project_facts,
  public.workflow_definitions,
  public.workflow_runs,
  public.workflow_step_runs,
  public.approval_requests,
  public.audit_events,
  public.ai_calls,
  public.studio_standards,
  public.project_overrides
from anon, authenticated;

grant select on table public.workflow_definitions to authenticated;
grant select on table
  public.project_sources,
  public.project_facts,
  public.workflow_runs,
  public.workflow_step_runs,
  public.approval_requests,
  public.audit_events,
  public.ai_calls,
  public.studio_standards,
  public.project_overrides
to authenticated;
grant insert on table
  public.project_facts,
  public.workflow_runs,
  public.workflow_step_runs,
  public.approval_requests,
  public.studio_standards,
  public.project_overrides
to authenticated;
grant update on table
  public.workflow_runs,
  public.workflow_step_runs,
  public.approval_requests,
  public.project_overrides
to authenticated;

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
    or new.approval_type is distinct from old.approval_type
    or new.required_role is distinct from old.required_role
    or new.requested_by is distinct from old.requested_by
    or new.created_at is distinct from old.created_at then
    raise exception 'approval request identity is immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_approval_update() from public, anon, authenticated;
drop trigger if exists approval_requests_immutable_identity on public.approval_requests;
create trigger approval_requests_immutable_identity
before update on public.approval_requests
for each row execute function private.enforce_approval_update();

create or replace function private.enforce_workflow_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'queued' and new.status in ('running', 'cancelled'))
    or (old.status = 'running' and new.status in (
      'waiting_for_human', 'pending_cost_confirmation', 'completed', 'failed', 'cancelled'
    ))
    or (old.status = 'waiting_for_human' and new.status in ('running', 'cancelled'))
    or (old.status = 'pending_cost_confirmation' and new.status in ('running', 'cancelled'))
    or (old.status = 'retrying' and new.status in ('running', 'failed', 'cancelled'))
    or (old.status = 'failed' and new.status in ('retrying', 'cancelled', 'rolled_back'))
  ) then
    raise exception 'invalid workflow transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_workflow_transition() from public, anon, authenticated;
drop trigger if exists workflow_runs_state_machine on public.workflow_runs;
create trigger workflow_runs_state_machine
before update of status on public.workflow_runs
for each row execute function private.enforce_workflow_transition();

-- Cover all Sprint 1 foreign keys used by authorization and audit queries.
create index if not exists project_sources_created_by_idx on public.project_sources(created_by);
create index if not exists project_facts_source_idx on public.project_facts(source_id);
create index if not exists project_facts_supersedes_idx on public.project_facts(supersedes_id);
create index if not exists project_facts_created_by_idx on public.project_facts(created_by_id);
create index if not exists workflow_runs_initiated_by_idx on public.workflow_runs(initiated_by);
create index if not exists workflow_runs_definition_idx on public.workflow_runs(workflow_key, workflow_version);
create index if not exists approval_requests_run_idx on public.approval_requests(workflow_run_id);
create index if not exists approval_requests_requested_by_idx on public.approval_requests(requested_by);
create index if not exists approval_requests_decision_by_idx on public.approval_requests(decision_by);
create index if not exists audit_events_actor_idx on public.audit_events(actor_id);
create index if not exists audit_events_run_idx on public.audit_events(workflow_run_id);
create index if not exists ai_calls_run_idx on public.ai_calls(workflow_run_id);
create index if not exists ai_calls_step_idx on public.ai_calls(workflow_step_run_id);
create index if not exists ai_calls_retry_idx on public.ai_calls(retry_of_id);
create index if not exists studio_standards_created_by_idx on public.studio_standards(created_by);
create index if not exists studio_standards_supersedes_idx on public.studio_standards(supersedes_id);
create index if not exists project_overrides_created_by_idx on public.project_overrides(created_by);
create index if not exists project_overrides_standard_version_idx on public.project_overrides(standard_version_id);
