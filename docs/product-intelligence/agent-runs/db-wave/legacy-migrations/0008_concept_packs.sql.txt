-- ─────────────────────────────────────────────────────────────
-- Module 2 / vertical slice 1: один приватный Concept Pack на
-- проект. Секции хранятся единым JSONB-объектом; публичного
-- токена и anon-доступа нет. projects.status не меняется, чтобы
-- не затрагивать существующий M1 flow.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.concept_packs (
  project_id uuid primary key references public.projects (id) on delete cascade,
  status text not null default 'ready' check (status in ('draft', 'ready')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.concept_packs enable row level security;

drop policy if exists "concept_packs_studio_all" on public.concept_packs;
create policy "concept_packs_studio_all" on public.concept_packs
  for all
  using (
    exists (
      select 1
      from public.projects p
      where p.id = concept_packs.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = concept_packs.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

-- Идемпотентный audit: повторная отправка формы или гонка запросов
-- не создаёт два события создания для одной студии и проекта. designer_id
-- входит в ключ: событие другой студии с известным project UUID не может
-- заранее занять корректный audit slot.
drop index if exists public.events_concept_pack_created_once_idx;
create unique index events_concept_pack_created_once_idx
  on public.events (designer_id, project_id, type)
  where type = 'concept_pack_created';

-- Pack и audit event создаются в одной транзакции. SECURITY DEFINER нужен
-- только для системной записи события; владелец берётся из защищённого FK-
-- проекта, а вставка самого pack по-прежнему проходит studio-RLS выше.
create or replace function public.record_concept_pack_created_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.events (designer_id, project_id, type)
  select p.designer_id, new.project_id, 'concept_pack_created'
  from public.projects p
  where p.id = new.project_id
  on conflict (designer_id, project_id, type) where type = 'concept_pack_created'
  do nothing;

  return new;
end;
$$;

drop trigger if exists concept_packs_record_created_event on public.concept_packs;
create trigger concept_packs_record_created_event
  after insert on public.concept_packs
  for each row execute function public.record_concept_pack_created_event();
