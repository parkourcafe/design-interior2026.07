-- ArchiDom Sprint 1: additive platform foundation for the existing M1.
-- Rollback: see docs/reports/ARCHIDOM_MIGRATION_AND_ROLLBACK_2026-07-27.md.
-- No legacy table or column is removed or renamed.

create table public.project_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null check (source_type in ('client_brief','attachment','designer_input','system')),
  source_ref text not null,
  title text not null default '',
  checksum text,
  ingested_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique(project_id, source_type, source_ref)
);

create table public.project_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  fact_type text not null check (fact_type in ('requirement','constraint','assumption','open_question')),
  value jsonb not null,
  source_id uuid references public.project_sources(id) on delete restrict,
  evidence_locator text not null,
  status text not null check (status in ('extracted','interpreted','unknown','human_confirmed','rejected')),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  created_by_type text not null check (created_by_type in ('human','ai','system')),
  created_by_id uuid references auth.users(id) on delete set null,
  version integer not null check (version > 0),
  supersedes_id uuid references public.project_facts(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (created_by_type <> 'ai' or status <> 'human_confirmed'),
  unique(project_id, evidence_locator, version)
);

create table public.workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version integer not null check (version > 0),
  owning_module text not null check (owning_module = 'M1'),
  definition jsonb not null,
  status text not null check (status in ('active','retired')),
  unique(key, version)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  workflow_key text not null,
  workflow_version integer not null,
  status text not null check (status in ('queued','running','waiting_for_human','pending_cost_confirmation','retrying','completed','failed','cancelled','rolled_back')),
  current_step text not null,
  initiated_by uuid references auth.users(id) on delete set null,
  input_snapshot jsonb not null default '{}'::jsonb,
  output_snapshot jsonb not null default '{}'::jsonb,
  error_state jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(workflow_key, workflow_version) references public.workflow_definitions(key, version)
);

create unique index workflow_runs_active_m1_idx on public.workflow_runs(project_id, workflow_key)
  where status in ('queued','running','waiting_for_human','pending_cost_confirmation','retrying','failed');

create table public.workflow_step_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  step_key text not null,
  attempt integer not null default 1 check (attempt > 0),
  status text not null check (status in ('queued','running','waiting_for_human','pending_cost_confirmation','completed','failed','skipped')),
  input_snapshot jsonb not null default '{}'::jsonb,
  output_snapshot jsonb not null default '{}'::jsonb,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(workflow_run_id, step_key, attempt)
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  workflow_run_id uuid references public.workflow_runs(id) on delete cascade,
  subject_type text not null check (subject_type in ('project_facts','proposal')),
  subject_id uuid,
  approval_type text not null check (approval_type in ('INTERNAL_REVIEWED','RELEASE_AUTHORIZED')),
  required_role text not null check (required_role in ('owner','member')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decision_by uuid references auth.users(id) on delete restrict,
  decision_at timestamptz,
  comment text not null default '',
  self_approved boolean not null default false,
  created_at timestamptz not null default now(),
  check ((status = 'pending' and decision_by is null and decision_at is null)
    or (status <> 'pending' and decision_by is not null and decision_at is not null)),
  check (self_approved = (decision_by is not null and decision_by = requested_by))
);

create unique index approval_requests_pending_subject_idx
  on public.approval_requests(project_id, subject_type, approval_type)
  where status = 'pending';

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('human','ai','system')),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  workflow_run_id uuid references public.workflow_runs(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  workflow_run_id uuid references public.workflow_runs(id) on delete set null,
  workflow_step_run_id uuid references public.workflow_step_runs(id) on delete set null,
  action_key text not null,
  cost_class text not null check (cost_class in ('free_deterministic','metered_ai','external_paid')),
  provider text not null,
  model text not null,
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  provider_cost_estimate numeric(14,6) not null default 0 check (provider_cost_estimate >= 0),
  estimate_source text not null check (estimate_source in ('static_table','provider_response')),
  retry_of_id uuid references public.ai_calls(id) on delete set null,
  outcome text not null check (outcome in ('success','schema_fail','provider_error','timeout')),
  created_at timestamptz not null default now()
);

create table public.studio_standards (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.designers(id) on delete cascade,
  standard_key text not null,
  value jsonb not null,
  version integer not null check (version > 0),
  supersedes_id uuid references public.studio_standards(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(studio_id, standard_key, version)
);

create table public.project_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  standard_key text not null,
  value jsonb not null,
  approved boolean not null default false,
  standard_version_id uuid references public.studio_standards(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(project_id, standard_key)
);

insert into public.workflow_definitions(key, version, owning_module, definition, status)
values ('client_intake_to_issued_proposal', 1, 'M1',
  '{"steps":["extract_client_brief","human_review","generate_clarifying_questions","build_project_passport","generate_risk_register","build_scope_draft","calculate_fee","generate_proposal_draft","approval","issue_proposal"]}'::jsonb,
  'active');

create index project_sources_project_idx on public.project_sources(project_id);
create index project_facts_project_idx on public.project_facts(project_id, created_at);
create index workflow_runs_project_idx on public.workflow_runs(project_id, created_at);
create index workflow_step_runs_run_idx on public.workflow_step_runs(workflow_run_id, created_at);
create index approval_requests_project_idx on public.approval_requests(project_id, created_at);
create index audit_events_project_idx on public.audit_events(project_id, created_at);
create index ai_calls_project_idx on public.ai_calls(project_id, created_at);
create index studio_standards_studio_idx on public.studio_standards(studio_id, standard_key, version desc);

alter table public.project_sources enable row level security;
alter table public.project_facts enable row level security;
alter table public.workflow_definitions enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_step_runs enable row level security;
alter table public.approval_requests enable row level security;
alter table public.audit_events enable row level security;
alter table public.ai_calls enable row level security;
alter table public.studio_standards enable row level security;
alter table public.project_overrides enable row level security;

create policy project_sources_studio_select on public.project_sources for select to authenticated
  using (exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,(select auth.uid()))));
create policy project_facts_studio_select on public.project_facts for select to authenticated
  using (exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,(select auth.uid()))));
create policy project_facts_studio_insert on public.project_facts for insert to authenticated
  with check (
    created_by_type = 'human'
    and created_by_id = (select auth.uid())
    and exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,(select auth.uid())))
  );
create policy workflow_definitions_authenticated_select on public.workflow_definitions for select to authenticated using (true);
create policy workflow_runs_studio_all on public.workflow_runs for all to authenticated
  using (exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,auth.uid())))
  with check (exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,auth.uid())));
create policy workflow_step_runs_studio_all on public.workflow_step_runs for all to authenticated
  using (exists(select 1 from public.workflow_runs w join public.projects p on p.id=w.project_id
    where w.id=workflow_run_id and public.is_studio_member(p.designer_id,auth.uid())))
  with check (exists(select 1 from public.workflow_runs w join public.projects p on p.id=w.project_id
    where w.id=workflow_run_id and public.is_studio_member(p.designer_id,auth.uid())));
create policy approval_requests_studio_select on public.approval_requests for select to authenticated
  using (exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,(select auth.uid()))));
create policy approval_requests_studio_insert on public.approval_requests for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and status in ('pending','approved')
    and (decision_by is null or decision_by = (select auth.uid()))
    and exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,(select auth.uid())))
  );
create policy approval_requests_studio_update on public.approval_requests for update to authenticated
  using (exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,(select auth.uid()))))
  with check (
    decision_by = (select auth.uid())
    and status in ('approved','rejected','cancelled')
    and exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,(select auth.uid())))
  );
create policy audit_events_studio_select on public.audit_events for select to authenticated
  using (exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,auth.uid())));
create policy ai_calls_studio_select on public.ai_calls for select to authenticated
  using (exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,auth.uid())));
create policy studio_standards_studio_select on public.studio_standards for select
  using (public.is_studio_member(studio_id,auth.uid()));
create policy studio_standards_owner_insert on public.studio_standards for insert
  with check (studio_id=auth.uid() and created_by=auth.uid());
create policy project_overrides_studio_all on public.project_overrides for all
  using (exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,auth.uid())))
  with check (created_by=auth.uid() and exists(select 1 from public.projects p where p.id=project_id and public.is_studio_member(p.designer_id,auth.uid())));

-- ai_calls and audit events are intentionally append-only for authenticated users.
revoke update, delete on public.ai_calls from authenticated;
revoke update, delete on public.audit_events from authenticated;

-- Supabase Data API access is explicit; RLS remains the row-level boundary.
grant select on public.workflow_definitions to authenticated;
grant select on public.project_sources, public.project_facts, public.workflow_runs,
  public.workflow_step_runs, public.approval_requests, public.audit_events,
  public.ai_calls, public.studio_standards, public.project_overrides to authenticated;
grant insert on public.project_facts, public.workflow_runs, public.workflow_step_runs,
  public.approval_requests, public.studio_standards, public.project_overrides to authenticated;
grant update on public.workflow_runs, public.workflow_step_runs,
  public.approval_requests, public.project_overrides to authenticated;
revoke all on public.audit_events, public.ai_calls from anon;
revoke insert, update, delete on public.audit_events, public.ai_calls from authenticated;
