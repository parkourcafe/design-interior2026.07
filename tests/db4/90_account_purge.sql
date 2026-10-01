\set ON_ERROR_STOP on

-- DB4-90: уничтожение аккаунта дизайнера (DEC-047, миграция 20260928158000).
--   * функцию не вызывает ни одна API-роль; без режима replica — отказ;
--   * отказ до срока, при legal hold, при записях в чужом проекте и участии в
--     чужой студии — и тогда не удалено ничего; пробный прогон ничего не
--     сохраняет;
--   * после уничтожения ни в одном столбце uuid/text/json(b) любой таблицы
--     нет id дизайнера и его проектов (проверка по каталогу, независимо от
--     самой функции); вторая студия не тронута; квитанция без данных
--     дизайнера; повторный вызов безопасен.
-- Сид: tests/db3/20_foundation_operations.sql — дизайнер 31111111 (проект
-- 41111111), дизайнер 33333333 (проект 42222222). Одна транзакция с откатом.

begin;

create function pg_temp.call_as(p_role text, p_user uuid, p_sql text)
returns jsonb language plpgsql as $function$
declare
  v_result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform pg_catalog.set_config('role', p_role, true);
  execute p_sql into v_result;
  perform pg_catalog.set_config('role', 'postgres', true);
  return v_result;
end
$function$;

create function pg_temp.purge_error(p_designer uuid) returns text
language plpgsql as $function$
begin
  perform public.purge_designer_account(p_designer, 'db4-operator');
  return null;
exception when others then
  return sqlerrm;
end
$function$;

-- Число вхождений id (как текст) во всех столбцах uuid/text/varchar/json(b)
-- пользовательских таблиц.
create function pg_temp.mentions(p_ids uuid[]) returns jsonb
language plpgsql as $function$
declare
  v_col record;
  v_count bigint;
  v_result jsonb := '{}'::jsonb;
begin
  for v_col in
    select c.oid::regclass as rel, n.nspname || '.' || c.relname as relname, a.attname, a.atttypid
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition
      and n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
      and a.attnum > 0 and not a.attisdropped
      and a.atttypid in ('uuid'::regtype, 'text'::regtype, 'character varying'::regtype,
                         'json'::regtype, 'jsonb'::regtype, 'uuid[]'::regtype)
  loop
    execute pg_catalog.format(
      'select count(*) from %s t where exists (select 1 from unnest($1) i where t.%I::text like ''%%'' || i::text || ''%%'')',
      v_col.rel, v_col.attname)
    into v_count using p_ids;
    if v_count > 0 then
      v_result := v_result || jsonb_build_object(v_col.relname || '.' || v_col.attname, v_count);
    end if;
  end loop;
  return v_result;
end
$function$;

-- === 0. Права ===============================================================

do $rights$
begin
  if pg_catalog.has_function_privilege('authenticated', 'public.purge_designer_account(uuid,text,boolean)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.purge_designer_account(uuid,text,boolean)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.purge_designer_account(uuid,text,boolean)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.account_purge_storage_objects(uuid)', 'EXECUTE')
     or pg_catalog.has_table_privilege('service_role', 'public.account_purge_receipts', 'SELECT') then
    raise exception 'DB4_90_PURGE_EXPOSED_TO_API';
  end if;
end
$rights$;

-- === 1. Данные дизайнера 31111111 ===========================================

update public.projects
set passport = '{"object":{"type":"flat","area_m2":70,"city":"db4-90"}}'::jsonb,
    passport_revision_llm_ok = true
where id = '41111111-1111-4111-8111-111111111111';
insert into public.answers (project_id, question_id, value)
values ('41111111-1111-4111-8111-111111111111', 'pain', '"Тесно утром"'::jsonb);
insert into public.proposals (id, project_id, version, sections, status, public_token, sent_at)
values ('90a00000-0000-4000-8000-000000000001', '41111111-1111-4111-8111-111111111111',
        90, '[]'::jsonb, 'sent', 'db4-90-token', statement_timestamp());
insert into public.events (designer_id, project_id, type)
values ('31111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111', 'proposal_sent');
insert into public.intake_consent_records (project_id, consent_version, consent_text_sha256, consent_text, source)
values ('41111111-1111-4111-8111-111111111111', 'consent-draft-2026-10-01',
        encode(sha256(convert_to('Даю Студия DB4-90 согласие на обработку моих данных.', 'UTF8')), 'hex'),
        'Даю Студия DB4-90 согласие на обработку моих данных.', 'designer_intake');
insert into public.studio_members (owner_id, member_id, email, status)
values ('31111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
        'db4-90-member@remhaos.test', 'active');

-- Строка дизайнера 31111111 в ЧУЖОМ проекте 42222222 — для проверки отказа.
insert into public.events (id, designer_id, project_id, type)
values ('90e00000-0000-4000-8000-000000000001', '31111111-1111-4111-8111-111111111111',
        '42222222-2222-4222-8222-222222222222', 'proposal_viewed');

create temp table db4_90_other_before as
select pg_temp.mentions(array['33333333-3333-4333-8333-333333333333',
                              '42222222-2222-4222-8222-222222222222']::uuid[]) as m;

-- === 2. Запрос удаления; отказы =============================================

do $request$
begin
  perform pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
    'select public.request_account_deletion(''DB4-90'')');
end
$request$;

do $refusals$
declare
  v_error text;
begin
  v_error := pg_temp.purge_error('31111111-1111-4111-8111-111111111111');
  if v_error is distinct from 'ACCOUNT_PURGE_REPLICA_SESSION_REQUIRED' then
    raise exception 'DB4_90_NO_REPLICA:%', v_error;
  end if;
  set local session_replication_role = replica;
  v_error := pg_temp.purge_error('31111111-1111-4111-8111-111111111111');
  if v_error is distinct from 'ACCOUNT_PURGE_BLOCKED:["WINDOW_OPEN"]' then
    raise exception 'DB4_90_WINDOW_OPEN:%', v_error;
  end if;
  -- Срок прошёл (заявка 31 день назад; триггер неизменяемости в replica не работает).
  update public.account_retention_cases
  set requested_at = requested_at - interval '31 days', purge_after = purge_after - interval '31 days'
  where designer_id = '31111111-1111-4111-8111-111111111111' and status = 'requested';
  set local session_replication_role = origin;
  perform pg_temp.call_as('service_role', null,
    'select public.set_account_legal_hold(''31111111-1111-4111-8111-111111111111'', true, ''Запрос суда'')');
  set local session_replication_role = replica;
  v_error := pg_temp.purge_error('31111111-1111-4111-8111-111111111111');
  if v_error is distinct from 'ACCOUNT_PURGE_BLOCKED:["LEGAL_HOLD"]' then
    raise exception 'DB4_90_LEGAL_HOLD:%', v_error;
  end if;
  set local session_replication_role = origin;
  perform pg_temp.call_as('service_role', null,
    'select public.set_account_legal_hold(''31111111-1111-4111-8111-111111111111'', false, ''Снято'')');
  set local session_replication_role = replica;
  -- Запись в чужом проекте и участие в чужой студии (ключ set null на
  -- auth.users, в строке остаётся почта): отказ, и ничего не удалено.
  insert into public.studio_members (id, owner_id, member_id, email, status)
  values ('90f00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
          '31111111-1111-4111-8111-111111111111', 'db4-90-designer@remhaos.test', 'active');
  v_error := pg_temp.purge_error('31111111-1111-4111-8111-111111111111');
  if v_error not like 'ACCOUNT_PURGE_FOREIGN_RECORDS:%public.events%'
     or v_error not like '%studio_members%' then
    raise exception 'DB4_90_FOREIGN_NOT_REFUSED:%', v_error;
  end if;
  if not exists (select 1 from public.projects where id = '41111111-1111-4111-8111-111111111111')
     or not exists (select 1 from public.designers where id = '31111111-1111-4111-8111-111111111111') then
    raise exception 'DB4_90_REFUSAL_DELETED_DATA';
  end if;
  set local session_replication_role = origin;
end
$refusals$;

-- Оператор решил: событие в чужом проекте и участие в чужой студии удаляются отдельно.
set local session_replication_role = replica;
delete from public.events where id = '90e00000-0000-4000-8000-000000000001';
delete from public.studio_members where id = '90f00000-0000-4000-8000-000000000001';

-- Пробный прогон: все проверки пройдены, ничего не удалено.
do $dry_run$
declare
  v_error text;
begin
  begin
    perform public.purge_designer_account('31111111-1111-4111-8111-111111111111', 'db4-operator', true);
    raise exception 'DB4_90_DRY_RUN_RETURNED';
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error not like 'ACCOUNT_PURGE_DRY_RUN_OK:%' then
    raise exception 'DB4_90_DRY_RUN:%', v_error;
  end if;
  if not exists (select 1 from public.projects where id = '41111111-1111-4111-8111-111111111111')
     or exists (select 1 from public.account_purge_receipts) then
    raise exception 'DB4_90_DRY_RUN_CHANGED_DATA';
  end if;
end
$dry_run$;

-- === 3. Уничтожение =========================================================

do $purge$
declare
  v_result jsonb;
  v_left jsonb;
begin
  v_result := public.purge_designer_account('31111111-1111-4111-8111-111111111111', 'db4-operator');
  if v_result->>'status' <> 'purged' or (v_result->>'projects')::int < 1
     or not (v_result->'rows' ? 'public.projects') or not (v_result->'rows' ? 'auth.users')
     or not (v_result->'rows' ? 'public.intake_consent_records')
     or not (v_result->'rows' ? 'public.project_passport_revisions') then
    raise exception 'DB4_90_PURGE_RESULT:%', v_result;
  end if;
  v_left := pg_temp.mentions(array['31111111-1111-4111-8111-111111111111',
                                   '41111111-1111-4111-8111-111111111111']::uuid[]);
  if v_left <> '{}'::jsonb then
    raise exception 'DB4_90_RESIDUAL:%', v_left;
  end if;
  if (select count(*) from public.account_purge_receipts
      where receipt_id = (v_result->>'receiptId')::uuid and operator = 'db4-operator') <> 1 then
    raise exception 'DB4_90_RECEIPT_MISSING';
  end if;
  if public.purge_designer_account('31111111-1111-4111-8111-111111111111', 'db4-operator')
       <> '{"status": "already_purged"}'::jsonb then
    raise exception 'DB4_90_REPEAT_NOT_SAFE';
  end if;
end
$purge$;
set local session_replication_role = origin;

-- Вторая студия: всё на месте, кроме её участия в уничтоженной студии
-- (строка studio_members, где владелец — дизайнер 31111111).
do $other_studio$
declare
  v_before jsonb := (select m from db4_90_other_before);
  v_after jsonb := pg_temp.mentions(array['33333333-3333-4333-8333-333333333333',
                                          '42222222-2222-4222-8222-222222222222']::uuid[]);
  v_expected jsonb := jsonb_set(v_before, '{public.studio_members.member_id}',
    to_jsonb((v_before->>'public.studio_members.member_id')::int - 1));
begin
  -- Событие дизайнера 31111111 в проекте 42222222 удалено оператором выше.
  v_expected := jsonb_set(v_expected, '{public.events.project_id}',
    to_jsonb((v_before->>'public.events.project_id')::int - 1));
  v_expected := (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
                 from jsonb_each(v_expected) where value <> '0'::jsonb);
  if v_after <> v_expected then
    raise exception 'DB4_90_OTHER_STUDIO_CHANGED:%/%', v_before, v_after;
  end if;
end
$other_studio$;

rollback;

select 'DB4_ACCOUNT_PURGE_OK' as result;
