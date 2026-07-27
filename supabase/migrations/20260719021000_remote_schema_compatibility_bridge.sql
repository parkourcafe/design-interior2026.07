-- Reconstruct application-owned objects present in the production
-- 20260719020040 snapshot but absent from migrations 0001-0006.
-- Existing production objects are preserved; a clean database receives the
-- same compatibility schema before Sprint 1 migrations run.

alter table public.projects
  drop constraint if exists projects_status_check;
alter table public.projects
  add constraint projects_status_check
  check (
    status in (
      'created',
      'brief_sent',
      'brief_in_progress',
      'brief_completed',
      'proposal_draft',
      'proposal_sent',
      'proposal_accepted',
      'active_project'
    )
  );

alter table public.proposals
  drop constraint if exists proposals_status_check;
alter table public.proposals
  add constraint proposals_status_check
  check (status in ('draft', 'sent', 'accepted'));

create table if not exists public.project_rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique
    references public.projects(id) on delete cascade,
  proposal_id uuid not null unique
    references public.proposals(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  scope_package text
    check (scope_package in ('concept', 'full', 'full_plus_supervision')),
  pricing_snapshot jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.project_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.project_rooms(id) on delete cascade,
  role text not null
    check (role in ('designer', 'client', 'executor')),
  display_name text not null default '',
  auth_user_id uuid references auth.users(id) on delete set null,
  access_token text unique,
  created_at timestamptz not null default now(),
  unique (room_id, role)
);

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.project_rooms(id) on delete cascade,
  title text not null,
  description text not null default '',
  owner_role text not null
    check (owner_role in ('designer', 'client', 'executor')),
  assignee_participant_id uuid
    references public.project_participants(id) on delete set null,
  due_date date,
  status text not null default 'todo'
    check (
      status in (
        'todo',
        'in_progress',
        'blocked',
        'waiting_client',
        'waiting_executor',
        'done'
      )
    ),
  client_facing boolean not null default false,
  related_scope_item text,
  proposal_section text,
  created_from text not null
    check (created_from in ('proposal', 'accepted_risk', 'system', 'manual')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_task_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.project_rooms(id) on delete cascade,
  task_id uuid references public.project_tasks(id) on delete cascade,
  actor_role text
    check (actor_role in ('designer', 'client', 'executor', 'system')),
  event_type text not null
    check (
      event_type in (
        'room_created',
        'task_created',
        'task_status_changed'
      )
    ),
  from_status text,
  to_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_participants_room_idx
  on public.project_participants(room_id);
create index if not exists project_tasks_room_idx
  on public.project_tasks(room_id, sort_order);
create index if not exists project_task_events_room_idx
  on public.project_task_events(room_id, created_at desc);

alter table public.project_rooms enable row level security;
alter table public.project_participants enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_task_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'project_rooms'
      and policyname = 'project_rooms_studio_all'
  ) then
    create policy project_rooms_studio_all
      on public.project_rooms
      for all
      using (
        exists (
          select 1 from public.projects p
          where p.id = project_rooms.project_id
            and public.is_studio_member(p.designer_id, auth.uid())
        )
      )
      with check (
        exists (
          select 1 from public.projects p
          where p.id = project_rooms.project_id
            and public.is_studio_member(p.designer_id, auth.uid())
        )
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'project_participants'
      and policyname = 'project_participants_studio_all'
  ) then
    create policy project_participants_studio_all
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
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'project_tasks'
      and policyname = 'project_tasks_studio_all'
  ) then
    create policy project_tasks_studio_all
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
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'project_task_events'
      and policyname = 'project_task_events_studio_all'
  ) then
    create policy project_task_events_studio_all
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
  end if;
end;
$$;

grant all on table public.project_rooms
  to anon, authenticated, service_role;
grant all on table public.project_participants
  to anon, authenticated, service_role;
grant all on table public.project_tasks
  to anon, authenticated, service_role;
grant all on table public.project_task_events
  to anon, authenticated, service_role;
