-- M1 B-блок (Фаза 2): immutable паспорт, версии КП, договор, защита брифа.
--
-- B1. `project_passport_revisions` — append-only ревизии паспорта: каждая
--     отправка брифа создаёт НОВУЮ ревизию; прежняя остаётся байт-в-байт
--     (INSERT-only триггер). Легаси `projects.passport` пока остаётся
--     read-моделью (dual-write), неизменяемый реестр — доказуемая истина.
--     project_id — идентификатор легаси-проекта (public.projects.id):
--     M1-мир до зачисления в project_intelligence, FK на другой мир нет —
--     это осознанная граница двух архитектурных линий (AP1_RUNBOOK §0).
--
-- B2. Уникальный индекс proposals(project_id, version): версия КП —
--     настоящий номер, дубликат невозможен; повторная выдача создаёт
--     version+1 с новым токеном (код — отдельным коммитом).
--
-- B3. `contract_documents` — внешний договор: приватный бакет, статусная
--     машина uploaded→received→signed→archived под триггером переходов,
--     checksum считает сервер (маршрут), имя файла — в metadata.
--
-- B4. `projects.intake_expires_at` — истечение токена брифа (маршрут
--     сверяет; null = бессрочно). Отзыв/продление — действия дашборда.

begin;

-- === B1: ревизии паспорта ===================================================

create table public.project_passport_revisions (
  project_id uuid not null references public.projects (id) on delete cascade,
  revision_no bigint not null,
  passport jsonb not null,
  llm_ok boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (project_id, revision_no)
);

create function public.reject_passport_revision_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'PROJECTCEO_M1_PASSPORT_REVISION_IMMUTABLE';
end
$function$;

create trigger project_passport_revisions_append_only
  before update or delete on public.project_passport_revisions
  for each row execute function public.reject_passport_revision_mutation();

-- === B2: версия КП — настоящий номер ========================================

create unique index proposals_project_version_key
  on public.proposals (project_id, version);

-- === B4: истечение токена брифа =============================================

alter table public.projects add column intake_expires_at timestamptz;

-- === B3: внешний договор ====================================================

create table public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  storage_path text not null
    check (storage_path ~ '^contract-documents/[0-9a-f-]{36}/[0-9a-f]{64}$'),
  original_name text not null
    check (char_length(btrim(original_name)) between 1 and 255),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'received', 'signed', 'archived')),
  created_at timestamptz not null default now(),
  status_updated_at timestamptz not null default now()
);

create index contract_documents_project_idx
  on public.contract_documents (project_id);

create function public.guard_contract_document_status()
returns trigger
language plpgsql
as $function$
declare
  allowed text[] := case old.status
    when 'uploaded' then array['received', 'signed', 'archived']
    when 'received' then array['signed', 'archived']
    when 'signed' then array['archived']
    else array['archived']::text[]
  end;
begin
  if new.status = old.status then
    return new;
  end if;
  if not (new.status = any(allowed)) then
    raise exception using
      errcode = '55000',
      message = 'PROJECTCEO_M1_CONTRACT_STATUS_TRANSITION_ILLEGAL',
      detail = format('%s -> %s', old.status, new.status);
  end if;
  new.status_updated_at := now();
  return new;
end
$function$;

create trigger contract_documents_status_guard
  before update on public.contract_documents
  for each row execute function public.guard_contract_document_status();

-- Приватный бакет договора (idempotent).
insert into storage.buckets (id, name, public)
values ('contract-documents', 'contract-documents', false)
on conflict (id) do nothing;

commit;
