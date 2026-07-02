-- ─────────────────────────────────────────────────────────────
-- MVP v0.1 schema: designers · projects · answers · risk_cards ·
-- proposals · events. Деньги — integer в рублях. RLS: дизайнер
-- видит только свои проекты; публичный intake/КП идут через server
-- route с service role (обход RLS после сверки токена на сервере).
-- ─────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── designers ────────────────────────────────────────────────
create table if not exists public.designers (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  studio_name text not null default '',
  pricing jsonb,                          -- null = режим «без цены»
  proposal_defaults jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ── projects ─────────────────────────────────────────────────
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.designers (id) on delete cascade,
  client_name text not null default '',
  status text not null default 'created'
    check (status in ('created','brief_sent','brief_in_progress','brief_completed','proposal_draft','proposal_sent')),
  intake_token text not null unique,
  passport jsonb,
  created_at timestamptz not null default now()
);
create index if not exists projects_designer_id_idx on public.projects (designer_id);
create index if not exists projects_intake_token_idx on public.projects (intake_token);

-- ── answers ──────────────────────────────────────────────────
create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  question_id text not null,
  value jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, question_id)
);
create index if not exists answers_project_id_idx on public.answers (project_id);

-- ── risk_cards ───────────────────────────────────────────────
create table if not exists public.risk_cards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  risk_type text not null check (risk_type in ('budget','timeline','function','style','technical')),
  evidence text[] not null default '{}',
  impact text not null default '',
  confidence text not null check (confidence in ('low','medium','high')),
  designer_action text not null default '',
  proposal_implication text not null default '',
  status text not null default 'proposed' check (status in ('proposed','accepted','rejected')),
  source text not null check (source in ('rule','llm')),
  created_at timestamptz not null default now()
);
create index if not exists risk_cards_project_id_idx on public.risk_cards (project_id);

-- ── proposals ────────────────────────────────────────────────
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version int not null default 1,
  sections jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','sent')),
  public_token text not null unique,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists proposals_project_id_idx on public.proposals (project_id);
create index if not exists proposals_public_token_idx on public.proposals (public_token);

-- ── events ───────────────────────────────────────────────────
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid references public.designers (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  type text not null,
  created_at timestamptz not null default now()
);
create index if not exists events_designer_id_idx on public.events (designer_id);

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.designers   enable row level security;
alter table public.projects    enable row level security;
alter table public.answers     enable row level security;
alter table public.risk_cards  enable row level security;
alter table public.proposals   enable row level security;
alter table public.events      enable row level security;

-- designers: строка только своя (id = auth.uid()).
create policy "designers_self_select" on public.designers
  for select using (id = auth.uid());
create policy "designers_self_insert" on public.designers
  for insert with check (id = auth.uid());
create policy "designers_self_update" on public.designers
  for update using (id = auth.uid());

-- projects: только проекты текущего дизайнера.
create policy "projects_owner_all" on public.projects
  for all using (designer_id = auth.uid()) with check (designer_id = auth.uid());

-- answers: доступ через владение проектом.
create policy "answers_owner_all" on public.answers
  for all
  using (exists (select 1 from public.projects p where p.id = answers.project_id and p.designer_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = answers.project_id and p.designer_id = auth.uid()));

-- risk_cards: доступ через владение проектом.
create policy "risk_cards_owner_all" on public.risk_cards
  for all
  using (exists (select 1 from public.projects p where p.id = risk_cards.project_id and p.designer_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = risk_cards.project_id and p.designer_id = auth.uid()));

-- proposals: доступ через владение проектом.
create policy "proposals_owner_all" on public.proposals
  for all
  using (exists (select 1 from public.projects p where p.id = proposals.project_id and p.designer_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = proposals.project_id and p.designer_id = auth.uid()));

-- events: дизайнер читает свои; запись идёт с server route.
create policy "events_owner_select" on public.events
  for select using (designer_id = auth.uid());
create policy "events_owner_insert" on public.events
  for insert with check (designer_id = auth.uid());

-- Публичный intake и публичное КП НЕ имеют anon-политик намеренно:
-- доступ к чужим данным идёт только через server route с service role
-- (сверка intake_token / public_token на сервере). anon-ключ доступа не даёт.

-- ── Storage bucket для планов/фото клиента (метаданные пишутся в answers) ──
insert into storage.buckets (id, name, public)
values ('client-uploads', 'client-uploads', false)
on conflict (id) do nothing;
