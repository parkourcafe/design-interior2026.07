\set ON_ERROR_STOP on

-- DB4: M1 B-блок (Фаза 2) — immutable паспорт, версии КП, договор.
-- Легаси-мир: public.projects (исполнитель сеет напрямую, как graph_nodes).

begin;
insert into public.projects (id, client_name, status, intake_token)
values (
  '77777777-7777-4777-8777-777777777777',
  'DB4 M1 probe',
  'created',
  'db4-m1-intake-token'
)
on conflict (id) do nothing;
commit;

-- === B1: ревизии паспорта — append-only и нумерация ==========================

begin;
insert into public.project_passport_revisions (project_id, revision_no, passport, llm_ok)
values ('77777777-7777-4777-8777-777777777777', 1,
        '{"contact": {"name": "Клиент А"}}'::jsonb, false);
insert into public.project_passport_revisions (project_id, revision_no, passport, llm_ok)
values ('77777777-7777-4777-8777-777777777777', 2,
        '{"contact": {"name": "Клиент А"}, "object": {"area_m2": 42}}'::jsonb, true);
commit;

do $passport_immutable$
declare
  v_first_passport jsonb;
begin
  -- UPDATE запрещён.
  begin
    update public.project_passport_revisions
    set passport = '{"contact": {"name": "Переписано"}}'::jsonb
    where project_id = '77777777-7777-4777-8777-777777777777' and revision_no = 1;
    raise exception 'DB4_M1_PASSPORT_UPDATE_ACCEPTED';
  exception
    when object_not_in_prerequisite_state then null;
    when insufficient_privilege then null;
  end;
  -- DELETE запрещён.
  begin
    delete from public.project_passport_revisions
    where project_id = '77777777-7777-4777-8777-777777777777' and revision_no = 1;
    raise exception 'DB4_M1_PASSPORT_DELETE_ACCEPTED';
  exception
    when object_not_in_prerequisite_state then null;
    when insufficient_privilege then null;
  end;
  -- Первая ревизия байт-в-байт прежняя.
  select passport into v_first_passport
  from public.project_passport_revisions
  where project_id = '77777777-7777-4777-8777-777777777777' and revision_no = 1;
  if v_first_passport ->> 'contact' is null
    or v_first_passport -> 'object' is not null then
    raise exception 'DB4_M1_PASSPORT_HISTORY_VIOLATED';
  end if;
end
$passport_immutable$;

-- === B2: версия КП уникальна в проекте =======================================

begin;
insert into public.proposals (project_id, version, sections, status, public_token)
values ('77777777-7777-4777-8777-777777777777', 1, '[]'::jsonb, 'draft',
        'db4-m1-token-v1');
do $duplicate_version_denied$
begin
  insert into public.proposals (project_id, version, sections, status, public_token)
  values ('77777777-7777-4777-8777-777777777777', 1, '[]'::jsonb, 'draft',
          'db4-m1-token-dup');
  raise exception 'DB4_M1_DUPLICATE_VERSION_ACCEPTED';
exception when unique_violation then null;
end
$duplicate_version_denied$;
-- Вторая версия легальна — это и есть повторная выдача.
insert into public.proposals (project_id, version, sections, status, public_token)
values ('77777777-7777-4777-8777-777777777777', 2, '[]'::jsonb, 'draft',
        'db4-m1-token-v2');
commit;

-- === B3: статусная машина договора ===========================================

begin;
insert into public.contract_documents (
  project_id, storage_path, original_name, sha256, size_bytes, status
) values (
  '77777777-7777-4777-8777-777777777777',
  'contract-documents/77777777-7777-4777-8777-777777777777/' ||
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'договор.pdf', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  1024, 'uploaded'
) returning id as doc_id \gset
select set_config('projectceo.db4_doc', :'doc_id', false) as bdoc \gset
commit;

begin;
do $contract_transitions$
declare
  v_doc uuid := current_setting('projectceo.db4_doc')::uuid;
  v_status text;
begin
  -- uploaded → signed: разрешено (пропуск received — осознанный).
  update public.contract_documents set status = 'signed' where id = v_doc;
  select status into v_status from public.contract_documents where id = v_doc;
  if v_status <> 'signed' then
    raise exception 'DB4_M1_CONTRACT_SIGN_FAILED';
  end if;
  -- signed → received: назад нельзя.
  begin
    update public.contract_documents set status = 'received' where id = v_doc;
    raise exception 'DB4_M1_CONTRACT_BACKWARD_ACCEPTED';
  exception
    when object_not_in_prerequisite_state then null;
    when insufficient_privilege then null;
  end;
end
$contract_transitions$;
rollback;

-- === B4: колонка истечения токена ============================================

begin;
do $expiry_column$
declare
  v_exists integer;
begin
  select count(*) into v_exists
  from information_schema.columns
  where table_schema = 'public' and table_name = 'projects'
    and column_name = 'intake_expires_at';
  if v_exists <> 1 then
    raise exception 'DB4_M1_INTAKE_EXPIRY_COLUMN_MISSING';
  end if;
end
$expiry_column$;
commit;

select 'DB4_M1_BLOCK_OK' as result;
