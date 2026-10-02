-- Подготовка комплекта подрядчика: сверка и контролируемое содержимое
-- (решение владельца 02.10.2026 после ревью 3203af3: блокеры B-1 и B-2).
--
--   B-1. Перед передачей дизайнер сверяет принятое КП и сводку паспорта, которая
--        уйдёт исполнителю, и подтверждает сверку. Подтверждение — копия того, что
--        было подтверждено: текст для исполнителя, решения по файлам, отметки
--        «оставить», полный паспорт проекта и сводка. Комплект создаётся только
--        если всё это совпадает с текущим состоянием. Правка паспорта, текста или
--        файлов после сверки сбрасывает подтверждение.
--   B-2. Текст КП для исполнителя — отдельная редактируемая копия; принятая
--        клиентом версия КП не меняется. Файлы проекта в комплект по умолчанию не
--        входят: дизайнер выбирает каждый — передать оригинал, не передавать или
--        заменить безопасной копией (новый файл; оригинал не меняется). Файл,
--        отмеченный «нужна безопасная копия», блокирует подтверждение, пока копия
--        не загружена. Manifest комплекта обязан перечислять ровно выбранные
--        файлы.
--   Правка паспорта дизайнером — запись в projects.passport (существующий
--   триггер пишет неизменяемую ревизию) плюс журнал правок с автором.
--
-- Попутно: внешние ключи proposal_responses и комплекта были on delete restrict,
-- из-за чего очистка аккаунта (delete from projects) падала бы на проекте с
-- ответом клиента или комплектом. Теперь — cascade, как у остальных таблиц
-- проекта. Конечные пользователи по-прежнему ничего не удаляют (триггеры).

begin;

-- === Внешние ключи: очистка аккаунта ========================================

alter table public.proposal_responses
  drop constraint proposal_responses_proposal_id_fkey,
  drop constraint proposal_responses_project_id_fkey,
  add constraint proposal_responses_proposal_id_fkey
    foreign key (proposal_id) references public.proposals(id) on delete cascade,
  add constraint proposal_responses_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete cascade;

alter table public.project_handover_kits
  drop constraint project_handover_kits_room_id_fkey,
  drop constraint project_handover_kits_project_id_fkey,
  drop constraint project_handover_kits_proposal_id_fkey,
  add constraint project_handover_kits_room_id_fkey
    foreign key (room_id) references public.project_rooms(id) on delete cascade,
  add constraint project_handover_kits_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete cascade,
  add constraint project_handover_kits_proposal_id_fkey
    foreign key (proposal_id) references public.proposals(id) on delete cascade;

alter table public.project_handover_receipts
  drop constraint project_handover_receipts_kit_id_fkey,
  drop constraint project_handover_receipts_participant_id_fkey,
  add constraint project_handover_receipts_kit_id_fkey
    foreign key (kit_id) references public.project_handover_kits(id) on delete cascade,
  add constraint project_handover_receipts_participant_id_fkey
    foreign key (participant_id) references public.project_participants(id) on delete cascade;

-- === Черновик комплекта и сверка ============================================

create table public.project_handover_drafts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  proposal_version integer not null check (proposal_version > 0),
  -- Рабочее содержимое (правит дизайнер).
  contractor_sections jsonb not null check (jsonb_typeof(contractor_sections) = 'array'),
  files jsonb not null default '[]'::jsonb
    check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 30),
  acknowledged jsonb not null default '[]'::jsonb check (jsonb_typeof(acknowledged) = 'array'),
  -- Подтверждённая сверка: копии на момент подтверждения.
  confirmed_at timestamptz,
  confirmed_by uuid,
  confirmed_sections jsonb,
  confirmed_files jsonb,
  confirmed_acknowledged jsonb,
  confirmed_passport jsonb,
  confirmed_passport_summary jsonb,
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint project_handover_drafts_confirmation_complete check (
    (confirmed_at is null and confirmed_by is null and confirmed_sections is null
      and confirmed_files is null and confirmed_acknowledged is null
      and confirmed_passport is null and confirmed_passport_summary is null)
    or
    (confirmed_at is not null and confirmed_by is not null and confirmed_sections is not null
      and confirmed_files is not null and confirmed_acknowledged is not null
      and confirmed_passport is not null and confirmed_passport_summary is not null)
  )
);

alter table public.project_handover_drafts enable row level security;
alter table public.project_handover_drafts force row level security;

create policy project_handover_drafts_studio_select
  on public.project_handover_drafts for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_handover_drafts.project_id
      and public.is_studio_member(p.designer_id, auth.uid())
  ));
create policy project_handover_drafts_studio_insert
  on public.project_handover_drafts for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_handover_drafts.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );
create policy project_handover_drafts_studio_update
  on public.project_handover_drafts for update to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_handover_drafts.project_id
      and public.is_studio_member(p.designer_id, auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_handover_drafts.project_id
      and public.is_studio_member(p.designer_id, auth.uid())
  ));

revoke all on table public.project_handover_drafts from public, anon, authenticated, service_role;
grant select, insert, update on table public.project_handover_drafts to authenticated;

-- Решения по файлам: допустимая форма и привязка к файлам проекта.
create or replace function public._handover_draft_files_valid(p_project_id uuid, p_files jsonb)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(bool_and(
    jsonb_typeof(f) = 'object'
    and f->>'decision' in ('exclude', 'original', 'needs_safe_copy', 'safe_copy')
    and jsonb_typeof(f->'reviewed') = 'boolean'
    and f->>'kind' in ('designer_plan', 'client_file')
    and coalesce(f->>'source_path', '') <> ''
    -- Источник — файл этого проекта из ответов брифа.
    and exists (
      select 1 from public.answers a
      where a.project_id = p_project_id
        and a.question_id in ('attachments', 'designer_plan_attachments')
        and a.value @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path', f->>'source_path'))
    )
    and (
      starts_with(f->>'source_path', p_project_id::text || '/')
      or starts_with(f->>'source_path', 'designer-plans/' || p_project_id::text || '/')
    )
    -- Безопасная копия — только в папке подготовки этого проекта.
    and (
      f->>'decision' <> 'safe_copy'
      or (f->'safe_copy'->>'path') ~ ('^designer-plans/' || p_project_id::text || '/handover/[^/]+$')
    )
  ), true)
  from pg_catalog.jsonb_array_elements(p_files) f
$function$;

-- Пути окончательных файлов комплекта (что реально передаётся).
create or replace function public._handover_final_paths(p_files jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select coalesce(array_agg(path order by path), '{}'::text[])
  from (
    select case f->>'decision'
      when 'original' then f->>'source_path'
      when 'safe_copy' then f->'safe_copy'->>'path'
    end as path
    from pg_catalog.jsonb_array_elements(p_files) f
    where f->>'decision' in ('original', 'safe_copy')
  ) s
$function$;

create or replace function public.guard_project_handover_draft()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_end_user boolean := current_user in ('authenticated', 'anon');
  v_proposal record;
  v_passport jsonb;
  v_confirming boolean;
  v_content_changed boolean;
begin
  if tg_op = 'DELETE' then
    if v_end_user then
      raise exception using errcode = '42501', message = 'HANDOVER_DRAFT_APPEND_ONLY';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select project_id, version, status into v_proposal
    from public.proposals where id = new.proposal_id;
    if not found or v_proposal.status <> 'accepted'
       or v_proposal.project_id is distinct from new.project_id
       or v_proposal.version is distinct from new.proposal_version then
      raise exception using errcode = '42501', message = 'HANDOVER_DRAFT_PROPOSAL_NOT_ACCEPTED';
    end if;
    if new.confirmed_at is not null then
      raise exception using errcode = '42501', message = 'HANDOVER_DRAFT_CONFIRM_ON_INSERT';
    end if;
    if not public._handover_draft_files_valid(new.project_id, new.files) then
      raise exception using errcode = '23514', message = 'HANDOVER_DRAFT_FILES_INVALID';
    end if;
    return new;
  end if;

  -- UPDATE
  if exists (select 1 from public.project_handover_kits k where k.draft_id = old.id) then
    raise exception using errcode = '42501', message = 'HANDOVER_DRAFT_LOCKED';
  end if;
  if new.project_id is distinct from old.project_id
     or new.proposal_id is distinct from old.proposal_id
     or new.proposal_version is distinct from old.proposal_version
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'HANDOVER_DRAFT_SUBJECT_IMMUTABLE';
  end if;
  if not public._handover_draft_files_valid(new.project_id, new.files) then
    raise exception using errcode = '23514', message = 'HANDOVER_DRAFT_FILES_INVALID';
  end if;
  new.updated_at := pg_catalog.statement_timestamp();

  v_confirming := new.confirmed_at is not null
    and new.confirmed_at is distinct from old.confirmed_at;
  v_content_changed := new.contractor_sections is distinct from old.contractor_sections
    or new.files is distinct from old.files
    or new.acknowledged is distinct from old.acknowledged;

  if v_confirming then
    -- Подтверждается ровно текущее содержимое и текущий паспорт.
    select passport into v_passport from public.projects where id = new.project_id;
    if v_end_user and new.confirmed_by is distinct from auth.uid() then
      raise exception using errcode = '42501', message = 'HANDOVER_DRAFT_CONFIRMER_SPOOFED';
    end if;
    if new.confirmed_sections is distinct from new.contractor_sections
       or new.confirmed_files is distinct from new.files
       or new.confirmed_acknowledged is distinct from new.acknowledged
       or new.confirmed_passport is distinct from v_passport then
      raise exception using errcode = '42501', message = 'HANDOVER_DRAFT_CONFIRMATION_MISMATCH';
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(new.files) f
      where f->>'decision' = 'needs_safe_copy'
         or (f->>'decision' in ('original', 'safe_copy') and (f->'reviewed')::boolean is not true)
    ) then
      raise exception using errcode = '42501', message = 'HANDOVER_DRAFT_FILES_NOT_READY';
    end if;
    new.confirmed_at := pg_catalog.statement_timestamp();
    return new;
  end if;

  if v_content_changed then
    -- Любая правка после сверки отменяет подтверждение.
    new.confirmed_at := null;
    new.confirmed_by := null;
    new.confirmed_sections := null;
    new.confirmed_files := null;
    new.confirmed_acknowledged := null;
    new.confirmed_passport := null;
    new.confirmed_passport_summary := null;
    return new;
  end if;

  -- Без сверки и без правки содержимого подтверждение не трогается
  -- (в том числе нельзя «снять» или подменить его копии).
  new.confirmed_at := old.confirmed_at;
  new.confirmed_by := old.confirmed_by;
  new.confirmed_sections := old.confirmed_sections;
  new.confirmed_files := old.confirmed_files;
  new.confirmed_acknowledged := old.confirmed_acknowledged;
  new.confirmed_passport := old.confirmed_passport;
  new.confirmed_passport_summary := old.confirmed_passport_summary;
  return new;
end
$function$;

-- Комплект ссылается на черновик, по которому он собран.
alter table public.project_handover_kits
  add column draft_id uuid references public.project_handover_drafts(id) on delete cascade;
create unique index project_handover_kits_draft_once
  on public.project_handover_kits (draft_id) where draft_id is not null;

create trigger project_handover_drafts_guard
  before insert or update or delete on public.project_handover_drafts
  for each row execute function public.guard_project_handover_draft();

-- === Комплект: только из действующей сверки =================================

create or replace function public.guard_project_handover_kit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_proposal record;
  v_draft record;
  v_passport jsonb;
  v_manifest_paths text[];
begin
  if tg_op <> 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      raise exception using errcode = '42501', message = 'HANDOVER_KIT_IMMUTABLE';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select project_id, version, status into v_proposal
  from public.proposals where id = new.proposal_id;
  if not found or v_proposal.status <> 'accepted' then
    raise exception using errcode = '42501', message = 'HANDOVER_KIT_PROPOSAL_NOT_ACCEPTED';
  end if;
  if v_proposal.project_id is distinct from new.project_id
     or v_proposal.version is distinct from new.proposal_version
     or not exists (
       select 1 from public.project_rooms r
       where r.id = new.room_id and r.project_id = new.project_id
     ) then
    raise exception using errcode = '42501', message = 'HANDOVER_KIT_SUBJECT_MISMATCH';
  end if;

  -- B-1/B-2: только по подтверждённой и не устаревшей сверке.
  select * into v_draft from public.project_handover_drafts where id = new.draft_id;
  if not found or v_draft.project_id is distinct from new.project_id
     or v_draft.proposal_id is distinct from new.proposal_id
     or v_draft.confirmed_at is null then
    raise exception using errcode = '42501', message = 'HANDOVER_KIT_NOT_RECONCILED';
  end if;
  select passport into v_passport from public.projects where id = new.project_id;
  if v_draft.contractor_sections is distinct from v_draft.confirmed_sections
     or v_draft.files is distinct from v_draft.confirmed_files
     or v_draft.acknowledged is distinct from v_draft.confirmed_acknowledged
     or v_draft.confirmed_passport is distinct from v_passport then
    raise exception using errcode = '42501', message = 'HANDOVER_KIT_RECONCILIATION_STALE';
  end if;
  if new.proposal_sections is distinct from v_draft.confirmed_sections
     or new.passport_summary is distinct from v_draft.confirmed_passport_summary then
    raise exception using errcode = '42501', message = 'HANDOVER_KIT_CONTENT_MISMATCH';
  end if;
  select coalesce(array_agg(e->>'path' order by e->>'path'), '{}'::text[]) into v_manifest_paths
  from pg_catalog.jsonb_array_elements(new.manifest) e
  where e->>'kind' not in ('proposal', 'passport_summary');
  if v_manifest_paths is distinct from public._handover_final_paths(v_draft.confirmed_files)
     or (select count(*) from pg_catalog.jsonb_array_elements(new.manifest) e
         where e->>'kind' in ('proposal', 'passport_summary')) <> 2 then
    raise exception using errcode = '42501', message = 'HANDOVER_KIT_FILES_MISMATCH';
  end if;
  return new;
end
$function$;

-- === Правки паспорта дизайнером =============================================

create table public.project_passport_corrections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  field text not null check (field in (
    'object.area_m2', 'object.condition', 'object.replanning',
    'lifestyle.bathrooms', 'lifestyle.cooking',
    'timeline.target', 'timeline.urgency', 'style.notes'
  )),
  before_value jsonb,
  after_value jsonb,
  corrected_by uuid not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp()
);

alter table public.project_passport_corrections enable row level security;
alter table public.project_passport_corrections force row level security;

create policy project_passport_corrections_studio_select
  on public.project_passport_corrections for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_passport_corrections.project_id
      and public.is_studio_member(p.designer_id, auth.uid())
  ));
create policy project_passport_corrections_studio_insert
  on public.project_passport_corrections for insert to authenticated
  with check (
    corrected_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_passport_corrections.project_id
        and public.is_studio_member(p.designer_id, auth.uid())
    )
  );

revoke all on table public.project_passport_corrections from public, anon, authenticated, service_role;
grant select, insert on table public.project_passport_corrections to authenticated;

create or replace function public.guard_project_passport_correction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception using errcode = '42501', message = 'PASSPORT_CORRECTION_APPEND_ONLY';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create trigger project_passport_corrections_append_only
  before update or delete on public.project_passport_corrections
  for each row execute function public.guard_project_passport_correction();

-- === Безопасные копии в Storage =============================================
-- `designer-plans/{project_id}/handover/{file}`: загружает и читает участник
-- студии проекта; удалять и перезаписывать нельзя (оригиналы и копии
-- неизменны). Очистка аккаунта уже охватывает префикс designer-plans/{id}/.

do $handover_copies$
begin
  if to_regclass('storage.objects') is not null then
    execute $policy$
      create policy client_uploads_handover_copy_select
        on storage.objects
        for select
        to authenticated
        using (
          bucket_id = 'client-uploads'
          and name ~ '^designer-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/handover/[^/]+$'
          and exists (
            select 1 from public.projects p
            where p.id = split_part(name, '/', 2)::uuid
              and p.designer_id is not null
              and public.is_studio_member(p.designer_id, auth.uid())
          )
        )
    $policy$;
    execute $policy$
      create policy client_uploads_handover_copy_insert
        on storage.objects
        for insert
        to authenticated
        with check (
          bucket_id = 'client-uploads'
          and name ~ '^designer-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/handover/[^/]+$'
          and exists (
            select 1 from public.projects p
            where p.id = split_part(name, '/', 2)::uuid
              and p.designer_id is not null
              and public.is_studio_member(p.designer_id, auth.uid())
          )
        )
    $policy$;
  end if;
end
$handover_copies$;

revoke all on function public._handover_draft_files_valid(uuid, jsonb) from public, anon;
revoke all on function public._handover_final_paths(jsonb) from public, anon;
grant execute on function public._handover_draft_files_valid(uuid, jsonb) to authenticated, service_role;
grant execute on function public._handover_final_paths(jsonb) to authenticated, service_role;
revoke all on function public.guard_project_handover_draft() from public, anon, authenticated;
revoke all on function public.guard_project_passport_correction() from public, anon, authenticated;

commit;
