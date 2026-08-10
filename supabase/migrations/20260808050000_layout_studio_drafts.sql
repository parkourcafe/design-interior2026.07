-- Layout Studio (модуль 2): серверное хранение рабочего состояния редактора.
--
-- До этой миграции редактор планировок жил целиком в браузере: черновики и
-- чекпойнты лежали в localStorage. Чистка кэша или переход на другой
-- компьютер означали потерю работы. Здесь появляется серверное хранилище
-- рабочего состояния: черновики и именованные чекпойнты.
--
-- Опубликованных версий здесь НЕТ намеренно. В объединённом контуре подписанная
-- истина одна: версии планировок публикуются в projectceo_product
-- (20260802080000_projectceo_m2_layout_versions.sql), где Postgres сам
-- перевалидирует документ и пересчитывает семантический хеш. Вторая таблица
-- версий означала бы два движка версий и две «истины» — ровно то, чего
-- обязательство «один движок версий для всех модулей» запрещает.
--
-- Миграция строго аддитивная: ни одна существующая таблица, политика или
-- функция не изменяется.

-- ── Документ планировки ──────────────────────────────────────
-- Одна строка = одна планировка проекта. Хранит ТЕКУЩИЙ черновик; история
-- восстановимых состояний живёт в layout_checkpoints.
create table if not exists public.layout_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Канонический идентификатор внутри движка (напр. layout.kora.liquid-station).
  -- Глобально уникален: движок адресует документ только по нему.
  document_id text not null unique,
  title text not null default '',
  -- Черновик целиком, в формате LayoutDocument v0.1.
  draft jsonb not null,
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

-- Чекпойнт — снимок: переписывать его задним числом нельзя. Неизменяемость
-- держит триггер на уровне БД, а не только код приложения.
create or replace function public.enforce_layout_checkpoint_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'чекпойнт планировки нельзя изменить';
end;
$$;

-- Триггерная функция не предназначена для прямого вызова через Data API.
-- Для срабатывания триггера EXECUTE вызывающей роли не нужен.
revoke all on function public.enforce_layout_checkpoint_immutability()
  from public, anon, authenticated, service_role;

drop trigger if exists layout_checkpoints_immutable on public.layout_checkpoints;
create trigger layout_checkpoints_immutable
before update on public.layout_checkpoints
for each row execute function public.enforce_layout_checkpoint_immutability();

-- ── RLS: доступ только к планировкам своей студии ────────────
-- Форма политик — ровно та же, что у answers / risk_cards / proposals в
-- 20260716071024_legacy_production_baseline: `to authenticated` и проверенный
-- продакшен-помощник public.is_studio_member(owner, auth.uid()) (SECURITY
-- DEFINER, ACL сохранён базлайном сознательно). Никаких новых схем и
-- помощников эта миграция не заводит.
alter table public.layout_documents enable row level security;
alter table public.layout_checkpoints enable row level security;

drop policy if exists layout_documents_studio_all on public.layout_documents;
create policy layout_documents_studio_all on public.layout_documents
  for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = layout_documents.project_id
      and public.is_studio_member(p.designer_id, auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = layout_documents.project_id
      and public.is_studio_member(p.designer_id, auth.uid())
  ));

drop policy if exists layout_checkpoints_studio_all on public.layout_checkpoints;
create policy layout_checkpoints_studio_all on public.layout_checkpoints
  for all to authenticated
  using (exists (
    select 1 from public.layout_documents d
    join public.projects p on p.id = d.project_id
    where d.id = layout_checkpoints.layout_document_id
      and public.is_studio_member(p.designer_id, auth.uid())
  ))
  with check (exists (
    select 1 from public.layout_documents d
    join public.projects p on p.id = d.project_id
    where d.id = layout_checkpoints.layout_document_id
      and public.is_studio_member(p.designer_id, auth.uid())
  ));

-- Права на сами таблицы: писать и читать может только authenticated (через
-- RLS); anon не видит планировок вовсе.
grant select, insert, update, delete
  on public.layout_documents, public.layout_checkpoints
  to authenticated;
revoke all
  on public.layout_documents, public.layout_checkpoints
  from anon;
