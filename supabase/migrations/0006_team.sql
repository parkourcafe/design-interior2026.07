-- ─────────────────────────────────────────────────────────────
-- «Команда» (v1, равный доступ). Студия = строка designers владельца.
-- Приглашённые участники (по совпадению email при входе) получают равный
-- доступ к проектам студии. Ролей пока нет (все равны).
--
-- Приглашение НЕ шлёт письмо: владелец добавляет email → человек заходит этой
-- почтой (Google/пароль) → getStudio() активирует приглашение при первом входе.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.studio_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.designers (id) on delete cascade,
  member_id uuid references auth.users (id) on delete set null,  -- проставляется при входе
  email text not null,                                           -- нормализованный (lower)
  role text not null default 'member' check (role in ('member')),
  status text not null default 'invited' check (status in ('invited','active')),
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (owner_id, email)
);
create index if not exists studio_members_member_idx
  on public.studio_members (member_id) where member_id is not null;
create index if not exists studio_members_email_idx on public.studio_members (email);

-- Может ли пользователь uid работать в студии владельца owner:
-- он сам владелец, ЛИБО активный участник. SECURITY DEFINER — читает
-- studio_members в обход RLS (без рекурсии политик).
create or replace function public.is_studio_member(owner uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select owner = uid
      or exists (
        select 1 from public.studio_members m
        where m.owner_id = owner and m.member_id = uid and m.status = 'active'
      );
$$;

-- ── Переписываем RLS: «владелец» → «студия» ──────────────────

drop policy if exists "projects_owner_all" on public.projects;
create policy "projects_studio_all" on public.projects
  for all
  using (public.is_studio_member(designer_id, auth.uid()))
  with check (public.is_studio_member(designer_id, auth.uid()));

drop policy if exists "answers_owner_all" on public.answers;
create policy "answers_studio_all" on public.answers
  for all
  using (exists (select 1 from public.projects p
                 where p.id = answers.project_id
                   and public.is_studio_member(p.designer_id, auth.uid())))
  with check (exists (select 1 from public.projects p
                 where p.id = answers.project_id
                   and public.is_studio_member(p.designer_id, auth.uid())));

drop policy if exists "risk_cards_owner_all" on public.risk_cards;
create policy "risk_cards_studio_all" on public.risk_cards
  for all
  using (exists (select 1 from public.projects p
                 where p.id = risk_cards.project_id
                   and public.is_studio_member(p.designer_id, auth.uid())))
  with check (exists (select 1 from public.projects p
                 where p.id = risk_cards.project_id
                   and public.is_studio_member(p.designer_id, auth.uid())));

drop policy if exists "proposals_owner_all" on public.proposals;
create policy "proposals_studio_all" on public.proposals
  for all
  using (exists (select 1 from public.projects p
                 where p.id = proposals.project_id
                   and public.is_studio_member(p.designer_id, auth.uid())))
  with check (exists (select 1 from public.projects p
                 where p.id = proposals.project_id
                   and public.is_studio_member(p.designer_id, auth.uid())));

-- designers: участник видит и правит строку СТУДИИ (равный доступ).
-- insert без изменений (designers_self_insert: id = auth.uid()).
drop policy if exists "designers_self_select" on public.designers;
drop policy if exists "designers_self_update" on public.designers;
create policy "designers_studio_select" on public.designers
  for select using (public.is_studio_member(id, auth.uid()));
create policy "designers_studio_update" on public.designers
  for update using (public.is_studio_member(id, auth.uid()));

drop policy if exists "events_owner_select" on public.events;
drop policy if exists "events_owner_insert" on public.events;
create policy "events_studio_select" on public.events
  for select using (public.is_studio_member(designer_id, auth.uid()));
create policy "events_studio_insert" on public.events
  for insert with check (public.is_studio_member(designer_id, auth.uid()));

-- ── RLS для studio_members ───────────────────────────────────
alter table public.studio_members enable row level security;

-- Ростер студии виден всем её участникам (и владельцу).
create policy "studio_members_select" on public.studio_members
  for select using (public.is_studio_member(owner_id, auth.uid()));
-- Приглашать (insert) и удалять (delete) — только владелец.
create policy "studio_members_owner_insert" on public.studio_members
  for insert with check (owner_id = auth.uid());
create policy "studio_members_owner_delete" on public.studio_members
  for delete using (owner_id = auth.uid());
-- update (активация member_id/status при входе) — только через service role
-- (getStudio), пользовательской политики намеренно нет.
