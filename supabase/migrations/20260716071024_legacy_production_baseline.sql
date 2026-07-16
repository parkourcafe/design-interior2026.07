-- ArchiDom legacy production adoption baseline.
--
-- PURPOSE
--   Clean-bootstrap only: reproduce the verified production schema captured at
--   2026-07-16T07:10:24.609229Z, plus the original private client-uploads
--   storage bucket effect.
--
-- PRODUCTION ADOPTION
--   DO NOT execute this file against the existing production database.
--   Existing production already contains this schema but has an empty migration
--   ledger. After clean-bootstrap verification and explicit authorization, adopt
--   this version in production by repairing migration history only.
--
-- INCLUDED LEGACY EFFECTS
--   0001_init, 0002_client_briefs, 0003_custom_questions,
--   0004_designer_profile, 0006_team, and the final schema effect of the exact
--   0007_project_rooms Git blob.
--
-- EXCLUDED
--   0005_rate_limits and 0008_concept_packs were absent from production.
--   0009_project_room_workflow was rejected as unsafe and was absent.
--
-- SECURITY DEBT PRESERVED, NOT ENDORSED
--   This baseline intentionally preserves the verified legacy public-schema
--   grants, permissive RLS policies, mutable/cascading history, raw access
--   tokens, and is_studio_member SECURITY DEFINER contract. New Project
--   Intelligence objects must not copy these patterns.

begin;

-- Refuse accidental execution over any existing legacy application schema.
do $baseline_guard$
begin
  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'designers',
        'projects',
        'answers',
        'risk_cards',
        'proposals',
        'events',
        'studio_members',
        'project_rooms',
        'project_participants',
        'project_tasks',
        'project_task_events'
      )
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  ) then
    raise exception
      'legacy production baseline is clean-bootstrap only; application relations already exist'
      using hint =
        'Do not execute this migration on existing production. Adopt its version in migration history only after an authorized schema-fingerprint check.';
  end if;
end
$baseline_guard$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.designers (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  studio_name text not null default '',
  pricing jsonb,
  proposal_defaults jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  profile jsonb not null default '{}'::jsonb
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid references public.designers (id) on delete cascade,
  client_name text not null default '',
  status text not null default 'created' check (status in (
    'created',
    'brief_sent',
    'brief_in_progress',
    'brief_completed',
    'proposal_draft',
    'proposal_sent',
    'proposal_accepted',
    'active_project'
  )),
  intake_token text not null unique,
  passport jsonb,
  created_at timestamptz not null default now(),
  custom_questions jsonb not null default '[]'::jsonb
);

create index projects_designer_id_idx
  on public.projects (designer_id);
create index projects_intake_token_idx
  on public.projects (intake_token);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  question_id text not null,
  value jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, question_id)
);

create index answers_project_id_idx
  on public.answers (project_id);

create table public.risk_cards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  risk_type text not null check (risk_type in (
    'budget',
    'timeline',
    'function',
    'style',
    'technical'
  )),
  evidence text[] not null default '{}',
  impact text not null default '',
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  designer_action text not null default '',
  proposal_implication text not null default '',
  status text not null default 'proposed' check (status in (
    'proposed',
    'accepted',
    'rejected'
  )),
  source text not null check (source in ('rule', 'llm')),
  created_at timestamptz not null default now()
);

create index risk_cards_project_id_idx
  on public.risk_cards (project_id);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version int not null default 1,
  sections jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in (
    'draft',
    'sent',
    'accepted'
  )),
  public_token text not null unique,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index proposals_project_id_idx
  on public.proposals (project_id);
create index proposals_public_token_idx
  on public.proposals (public_token);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid references public.designers (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  type text not null,
  created_at timestamptz not null default now()
);

create index events_designer_id_idx
  on public.events (designer_id);

create table public.studio_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.designers (id) on delete cascade,
  member_id uuid references auth.users (id) on delete set null,
  email text not null,
  role text not null default 'member' check (role in ('member')),
  status text not null default 'invited' check (status in ('invited', 'active')),
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (owner_id, email)
);

create index studio_members_member_idx
  on public.studio_members (member_id)
  where member_id is not null;
create index studio_members_email_idx
  on public.studio_members (email);

-- Legacy SECURITY DEFINER definition reproduced exactly from production.
create or replace function public.is_studio_member(owner uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select owner = uid
      or exists (
        select 1 from public.studio_members m
        where m.owner_id = owner and m.member_id = uid and m.status = 'active'
      );
$function$;

create table public.project_rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects (id) on delete cascade,
  proposal_id uuid not null unique references public.proposals (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'archived')),
  scope_package text check (scope_package in (
    'concept',
    'full',
    'full_plus_supervision'
  )),
  pricing_snapshot jsonb,
  created_at timestamptz not null default now()
);

create table public.project_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.project_rooms (id) on delete cascade,
  role text not null check (role in ('designer', 'client', 'executor')),
  display_name text not null default '',
  auth_user_id uuid references auth.users (id) on delete set null,
  access_token text unique,
  created_at timestamptz not null default now(),
  unique (room_id, role)
);

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.project_rooms (id) on delete cascade,
  title text not null,
  description text not null default '',
  owner_role text not null check (owner_role in (
    'designer',
    'client',
    'executor'
  )),
  assignee_participant_id uuid
    references public.project_participants (id) on delete set null,
  due_date date,
  status text not null default 'todo' check (status in (
    'todo',
    'in_progress',
    'blocked',
    'waiting_client',
    'waiting_executor',
    'done'
  )),
  client_facing boolean not null default false,
  related_scope_item text,
  proposal_section text,
  created_from text not null check (created_from in (
    'proposal',
    'accepted_risk',
    'system',
    'manual'
  )),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_task_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.project_rooms (id) on delete cascade,
  task_id uuid references public.project_tasks (id) on delete cascade,
  actor_role text check (actor_role in (
    'designer',
    'client',
    'executor',
    'system'
  )),
  event_type text not null check (event_type in (
    'room_created',
    'task_created',
    'task_status_changed'
  )),
  from_status text,
  to_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index project_participants_room_idx
  on public.project_participants (room_id);
create index project_tasks_room_idx
  on public.project_tasks (room_id, sort_order);
create index project_task_events_room_idx
  on public.project_task_events (room_id, created_at desc);

alter table public.designers enable row level security;
alter table public.projects enable row level security;
alter table public.answers enable row level security;
alter table public.risk_cards enable row level security;
alter table public.proposals enable row level security;
alter table public.events enable row level security;
alter table public.studio_members enable row level security;
alter table public.project_rooms enable row level security;
alter table public.project_participants enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_task_events enable row level security;

create policy "designers_self_insert"
  on public.designers
  for insert
  with check (id = auth.uid());

create policy "designers_studio_select"
  on public.designers
  for select
  using (public.is_studio_member(id, auth.uid()));

create policy "designers_studio_update"
  on public.designers
  for update
  using (public.is_studio_member(id, auth.uid()));

create policy "projects_studio_all"
  on public.projects
  for all
  using (public.is_studio_member(designer_id, auth.uid()))
  with check (public.is_studio_member(designer_id, auth.uid()));

create policy "answers_studio_all"
  on public.answers
  for all
  using (
    exists (
      select 1
      from public.projects p
      where p.id = answers.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = answers.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

create policy "risk_cards_studio_all"
  on public.risk_cards
  for all
  using (
    exists (
      select 1
      from public.projects p
      where p.id = risk_cards.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = risk_cards.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

create policy "proposals_studio_all"
  on public.proposals
  for all
  using (
    exists (
      select 1
      from public.projects p
      where p.id = proposals.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = proposals.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

create policy "events_studio_select"
  on public.events
  for select
  using (public.is_studio_member(designer_id, auth.uid()));

create policy "events_studio_insert"
  on public.events
  for insert
  with check (public.is_studio_member(designer_id, auth.uid()));

create policy "studio_members_select"
  on public.studio_members
  for select
  using (public.is_studio_member(owner_id, auth.uid()));

create policy "studio_members_owner_insert"
  on public.studio_members
  for insert
  with check (owner_id = auth.uid());

create policy "studio_members_owner_delete"
  on public.studio_members
  for delete
  using (owner_id = auth.uid());

create policy "project_rooms_studio_all"
  on public.project_rooms
  for all
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_rooms.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = project_rooms.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

create policy "project_participants_studio_all"
  on public.project_participants
  for all
  using (
    exists (
      select 1
      from public.project_rooms r
      join public.projects p on p.id = r.project_id
      where r.id = project_participants.room_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.project_rooms r
      join public.projects p on p.id = r.project_id
      where r.id = project_participants.room_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

create policy "project_tasks_studio_all"
  on public.project_tasks
  for all
  using (
    exists (
      select 1
      from public.project_rooms r
      join public.projects p on p.id = r.project_id
      where r.id = project_tasks.room_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.project_rooms r
      join public.projects p on p.id = r.project_id
      where r.id = project_tasks.room_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

create policy "project_task_events_studio_all"
  on public.project_task_events
  for all
  using (
    exists (
      select 1
      from public.project_rooms r
      join public.projects p on p.id = r.project_id
      where r.id = project_task_events.room_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.project_rooms r
      join public.projects p on p.id = r.project_id
      where r.id = project_task_events.room_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

-- Supabase grants broad table privileges by default; production exposes these
-- exact legacy grants and relies on RLS for row isolation.
grant all privileges on table
  public.answers,
  public.designers,
  public.events,
  public.project_participants,
  public.project_rooms,
  public.project_task_events,
  public.project_tasks,
  public.projects,
  public.proposals,
  public.risk_cards,
  public.studio_members
to anon, authenticated, service_role;

-- Preserve the verified legacy function ACL, including PUBLIC execute.
grant execute on function public.is_studio_member(uuid, uuid)
  to public, anon, authenticated, service_role;

-- Original non-public upload bucket side effect. File metadata remains in
-- answers; no image analysis is enabled by this baseline.
insert into storage.buckets (id, name, public)
values ('client-uploads', 'client-uploads', false)
on conflict (id) do nothing;

commit;
