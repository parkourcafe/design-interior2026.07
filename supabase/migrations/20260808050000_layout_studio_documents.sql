-- Layout Studio (модуль 2): серверное хранение планировок.
--
-- До этой миграции модуль жил целиком в браузере: черновики, чекпойнты и
-- опубликованные версии лежали в localStorage. Чистка кэша или переход на
-- другой компьютер означали потерю работы. Здесь появляется серверное
-- хранилище с тем же контрактом, что у MemoryLayoutRepository.
--
-- Миграция строго аддитивная: ни одна существующая таблица, политика или
-- функция не изменяется.

-- ── Документ планировки ──────────────────────────────────────
-- Одна строка = одна планировка проекта. Хранит ТЕКУЩИЙ черновик; история
-- живёт в layout_checkpoints и layout_versions.
create table if not exists public.layout_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Канонический идентификатор внутри движка (напр. layout.kora.liquid-station).
  -- Глобально уникален: движок адресует документ только по нему.
  document_id text not null unique,
  title text not null default '',
  -- Черновик целиком, в формате LayoutDocument v0.1.
  draft jsonb not null,
  -- Версия, от которой отпочковался черновик. Текстовый id движка, не uuid.
  parent_version_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists layout_documents_project_id_idx
  on public.layout_documents (project_id);

-- ── Чекпойнты ────────────────────────────────────────────────
-- Именованные снимки черновика. Создаются один раз и не переписываются.
create table if not exists public.layout_checkpoints (
  checkpoint_id text primary key,
  layout_document_id uuid not null
    references public.layout_documents (id) on delete cascade,
  document_id text not null,
  content jsonb not null,
  reason_code text not null,
  reason text not null,
  created_at timestamptz not null
);
create index if not exists layout_checkpoints_document_idx
  on public.layout_checkpoints (layout_document_id, created_at);

-- ── Опубликованные версии ────────────────────────────────────
-- Неизменяемы по построению: на них ссылаются выгруженные файлы и их
-- семантические хеши. Неизменяемость держит триггер ниже, а не только код
-- приложения (LS-AT-065).
create table if not exists public.layout_versions (
  version_id text primary key,
  layout_document_id uuid not null
    references public.layout_documents (id) on delete cascade,
  document_id text not null,
  parent_version_id text references public.layout_versions (version_id),
  contract_version text not null default 'archidom.layout-version/0.1',
  author_type text not null,
  reason_code text not null,
  reason text not null,
  semantic_hash text not null,
  warnings text[] not null default '{}',
  content jsonb not null,
  created_at timestamptz not null
);
create index if not exists layout_versions_document_idx
  on public.layout_versions (layout_document_id, created_at, version_id);
create index if not exists layout_versions_parent_idx
  on public.layout_versions (parent_version_id);

-- ── Неизменяемость опубликованных версий ─────────────────────
create or replace function private.enforce_layout_version_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'опубликованную версию планировки нельзя удалить';
  end if;
  raise exception 'опубликованную версию планировки нельзя изменить';
end;
$$;

revoke all on function private.enforce_layout_version_immutability()
  from public, anon, authenticated, service_role;

drop trigger if exists layout_versions_immutable on public.layout_versions;
create trigger layout_versions_immutable
before update or delete on public.layout_versions
for each row execute function private.enforce_layout_version_immutability();

-- Чекпойнт тоже снимок: переписывать его задним числом нельзя.
create or replace function private.enforce_layout_checkpoint_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'чекпойнт планировки нельзя изменить';
end;
$$;

revoke all on function private.enforce_layout_checkpoint_immutability()
  from public, anon, authenticated, service_role;

drop trigger if exists layout_checkpoints_immutable on public.layout_checkpoints;
create trigger layout_checkpoints_immutable
before update on public.layout_checkpoints
for each row execute function private.enforce_layout_checkpoint_immutability();

-- ── RLS: доступ только к планировкам своей студии ────────────
-- Форма политик — та же, что у answers / risk_cards / proposals ПОСЛЕ
-- 0008_platform_security_hardening: `to authenticated` и
-- private.is_studio_member(owner). Публичный public.is_studio_member(uuid,uuid)
-- намеренно отозван у роли authenticated в 0008 (он был доступен через Data API)
-- и здесь не используется.
alter table public.layout_documents enable row level security;
alter table public.layout_checkpoints enable row level security;
alter table public.layout_versions enable row level security;

drop policy if exists layout_documents_studio_all on public.layout_documents;
create policy layout_documents_studio_all on public.layout_documents
  for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = layout_documents.project_id and private.is_studio_member(p.designer_id)
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = layout_documents.project_id and private.is_studio_member(p.designer_id)
  ));

drop policy if exists layout_checkpoints_studio_all on public.layout_checkpoints;
create policy layout_checkpoints_studio_all on public.layout_checkpoints
  for all to authenticated
  using (exists (
    select 1 from public.layout_documents d
    join public.projects p on p.id = d.project_id
    where d.id = layout_checkpoints.layout_document_id
      and private.is_studio_member(p.designer_id)
  ))
  with check (exists (
    select 1 from public.layout_documents d
    join public.projects p on p.id = d.project_id
    where d.id = layout_checkpoints.layout_document_id
      and private.is_studio_member(p.designer_id)
  ));

drop policy if exists layout_versions_studio_all on public.layout_versions;
create policy layout_versions_studio_all on public.layout_versions
  for all to authenticated
  using (exists (
    select 1 from public.layout_documents d
    join public.projects p on p.id = d.project_id
    where d.id = layout_versions.layout_document_id
      and private.is_studio_member(p.designer_id)
  ))
  with check (exists (
    select 1 from public.layout_documents d
    join public.projects p on p.id = d.project_id
    where d.id = layout_versions.layout_document_id
      and private.is_studio_member(p.designer_id)
  ));

-- Права на сами таблицы: как у остальных таблиц Data API — только authenticated.
grant select, insert, update, delete
  on public.layout_documents, public.layout_checkpoints, public.layout_versions
  to authenticated;
revoke all
  on public.layout_documents, public.layout_checkpoints, public.layout_versions
  from anon;
