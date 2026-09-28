-- Репетиция переноса: структура переносимых таблиц СТАРОЙ рабочей базы
-- (снимок только структуры, чтение 28.09; без данных). Только то, что
-- переносит transfer.zsh. Используется на одноразовом стенде, не в production.

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
  status text not null default 'created',
  intake_token text not null unique,
  passport jsonb,
  created_at timestamptz not null default now(),
  custom_questions jsonb not null default '[]'::jsonb
);
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  question_id text not null,
  value jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, question_id)
);
create table public.risk_cards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  risk_type text not null,
  evidence text[] not null default '{}',
  impact text not null default '',
  confidence text not null,
  designer_action text not null default '',
  proposal_implication text not null default '',
  status text not null default 'proposed',
  source text not null,
  created_at timestamptz not null default now()
);
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version integer not null default 1,
  sections jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  public_token text not null unique,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  issued_revision_id uuid
);
create table public.events (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid,
  project_id uuid,
  type text not null,
  created_at timestamptz not null default now()
);
insert into storage.buckets (id, name, public) values ('client-uploads', 'client-uploads', false)
  on conflict do nothing;
