\set ON_ERROR_STOP on

-- DB4: удаление аккаунта дизайнера — 90 дней только для чтения
-- (DEC-040, DEC-041 §2, DEC-044 (a); миграция 20260928100000). Дизайнер
-- 31111111 (проект 41111111), второй дизайнер 33333333 (проект 42222222).
-- Весь файл — одна транзакция с откатом. Данные не удаляются нигде.

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

create function pg_temp.expect_error(
  p_role text, p_user uuid, p_sql text, p_state text, p_marker text, p_label text
)
returns void language plpgsql as $function$
declare
  v_state text;
  v_text text;
begin
  begin
    perform pg_temp.call_as(p_role, p_user, p_sql);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_text := sqlerrm;
    if v_state <> p_state or v_text not like '%' || p_marker || '%' then
      raise exception 'DB4_84_WRONG_FAILURE:%:%:%', p_label, v_state, v_text;
    end if;
    return;
  end;
  raise exception 'DB4_84_EXPECTED_FAILURE:%', p_label;
end
$function$;

do $schema_contract$
begin
  if pg_catalog.has_table_privilege('authenticated', 'public.account_retention_cases', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'public.account_retention_cases', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.account_retention_events', 'SELECT') then
    raise exception 'DB4_84_RETENTION_TABLES_EXPOSED';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.set_account_legal_hold(uuid,boolean,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.request_account_deletion(text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.count_passport_revisions(uuid[])', 'EXECUTE') then
    raise exception 'DB4_84_OPERATOR_FUNCTIONS_EXPOSED';
  end if;
end
$schema_contract$;

-- Паспорт проекта 41111111 — чтобы экспорту было что отдавать.
update public.projects
set passport = '{"object":{"type":"flat","area_m2":70,"city":"db4-84"}}'::jsonb,
    passport_revision_llm_ok = true
where id = '41111111-1111-4111-8111-111111111111';

-- Отправленное КП проекта — его клиент откроет, но ответить не сможет.
insert into public.proposals (id, project_id, version, sections, status, public_token, sent_at)
values ('84a00000-0000-4000-8000-000000000001', '41111111-1111-4111-8111-111111111111',
        84, '[]'::jsonb, 'sent', 'db4-84-token', statement_timestamp());

-- === 1. Запрос и идемпотентный повтор ======================================

do $request$
declare
  v_first jsonb;
  v_second jsonb;
begin
  v_first := pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
    'select public.request_account_deletion(''Закрываю студию'')');
  v_second := pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
    'select public.request_account_deletion(null)');
  if v_first->>'status' <> 'requested' or (v_first->>'replay')::boolean
     or (v_first->>'purgeAfter')::timestamptz <> (v_first->>'requestedAt')::timestamptz + interval '90 days'
     or not (v_first->>'cancellable')::boolean then
    raise exception 'DB4_84_REQUEST_SHAPE:%', v_first;
  end if;
  if v_second->>'caseId' <> v_first->>'caseId' or not (v_second->>'replay')::boolean then
    raise exception 'DB4_84_REPLAY_CREATED_NEW_CASE:%/%', v_first, v_second;
  end if;
  if (select count(*) from public.account_retention_cases
      where designer_id = '31111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'DB4_84_DUPLICATE_CASE';
  end if;
  if (select array_agg(event_type order by event_id) from public.account_retention_events
      where case_id = (v_first->>'caseId')::uuid) <> array['requested', 'replayed'] then
    raise exception 'DB4_84_EVENTS_NOT_RECORDED';
  end if;
  perform set_config('db4.t84_case', v_first->>'caseId', true);
  if pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
       'select public.get_account_retention_status()')->>'caseId' <> v_first->>'caseId' then
    raise exception 'DB4_84_STATUS_MISMATCH';
  end if;
  -- Другой дизайнер своей заявки не имеет и чужую не видит.
  if pg_temp.call_as('authenticated', '33333333-3333-4333-8333-333333333333',
       'select public.get_account_retention_status()') is not null then
    raise exception 'DB4_84_FOREIGN_STATUS_VISIBLE';
  end if;
end
$request$;

-- === 2. Только чтение: дизайнер, приём брифа, ответ клиента на КП ===========

select pg_temp.expect_error('authenticated', '31111111-1111-4111-8111-111111111111',
  $sql$ with u as (update public.projects set client_name = client_name
    where id = '41111111-1111-4111-8111-111111111111' returning 1) select to_jsonb(count(*)) from u $sql$,
  '42501', 'ACCOUNT_IN_RETENTION_READ_ONLY', 'designer_project_update');
select pg_temp.expect_error('service_role', null,
  $sql$ with i as (insert into public.answers (project_id, question_id, value)
    values ('41111111-1111-4111-8111-111111111111', 'db4-84', '"x"'::jsonb) returning 1)
    select to_jsonb(count(*)) from i $sql$,
  '42501', 'ACCOUNT_IN_RETENTION_READ_ONLY', 'brief_answer_insert');
select pg_temp.expect_error('service_role', null,
  $sql$ with u as (update public.proposals set status = status
    where id = '84a00000-0000-4000-8000-000000000001' returning 1) select to_jsonb(count(*)) from u $sql$,
  '42501', 'ACCOUNT_IN_RETENTION_READ_ONLY', 'client_response_update');

do $other_designer_writable$
begin
  if public._designer_in_retention('33333333-3333-4333-8333-333333333333') then
    raise exception 'DB4_84_OTHER_DESIGNER_IN_RETENTION';
  end if;
  perform pg_temp.call_as('service_role', null,
    $sql$ with u as (update public.projects set client_name = client_name
      where id = '42222222-2222-4222-8222-222222222222' returning 1) select to_jsonb(count(*)) from u $sql$);
end
$other_designer_writable$;

-- === 3. Экспорт версий паспорта — только свои ===============================

do $export$
declare
  v_own jsonb;
  v_foreign jsonb;
begin
  v_own := pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
    'select public.export_passport_revisions()');
  v_foreign := pg_temp.call_as('authenticated', '33333333-3333-4333-8333-333333333333',
    'select public.export_passport_revisions()');
  if jsonb_array_length(v_own) = 0
     or exists (select 1 from jsonb_array_elements(v_own) r
                where r->>'project_id' <> '41111111-1111-4111-8111-111111111111') then
    raise exception 'DB4_84_OWN_EXPORT_WRONG:%', v_own;
  end if;
  if exists (select 1 from jsonb_array_elements(v_foreign) r
             where r->>'project_id' = '41111111-1111-4111-8111-111111111111') then
    raise exception 'DB4_84_FOREIGN_EXPORT_LEAK';
  end if;
end
$export$;

-- === 4. Legal hold, блокеры, запись плана ==================================

do $hold$
declare
  v_blockers jsonb;
begin
  v_blockers := pg_temp.call_as('service_role', null,
    'select public.account_purge_blockers(''31111111-1111-4111-8111-111111111111'')');
  if v_blockers->'blockers' <> '["WINDOW_OPEN"]'::jsonb then
    raise exception 'DB4_84_BLOCKERS:%', v_blockers;
  end if;
  perform pg_temp.call_as('service_role', null,
    'select public.set_account_legal_hold(''31111111-1111-4111-8111-111111111111'', true, ''Запрос суда'')');
  v_blockers := pg_temp.call_as('service_role', null,
    'select public.account_purge_blockers(''31111111-1111-4111-8111-111111111111'')');
  if not v_blockers->'blockers' @> '["LEGAL_HOLD"]'::jsonb then
    raise exception 'DB4_84_HOLD_NOT_BLOCKING:%', v_blockers;
  end if;
end
$hold$;

select pg_temp.expect_error('authenticated', '31111111-1111-4111-8111-111111111111',
  'select public.cancel_account_deletion(null)', '42501', 'ACCOUNT_RETENTION_LEGAL_HOLD', 'cancel_under_hold');
select pg_temp.expect_error('service_role', null,
  $sql$ select to_jsonb(public.record_account_purge_plan('31111111-1111-4111-8111-111111111111',
    '{"destructive": true}'::jsonb)) $sql$,
  '22023', 'ACCOUNT_PURGE_PLAN_MUST_BE_DRY_RUN', 'destructive_plan');

do $plan_recorded$
begin
  perform pg_temp.call_as('service_role', null,
    $sql$ select to_jsonb(public.record_account_purge_plan('31111111-1111-4111-8111-111111111111',
      '{"destructive": false, "scope": {"projects": 1}}'::jsonb)) $sql$);
  perform pg_temp.call_as('service_role', null,
    'select public.set_account_legal_hold(''31111111-1111-4111-8111-111111111111'', false, ''Снято'')');
  if (select array_agg(event_type order by event_id) from public.account_retention_events
      where case_id = current_setting('db4.t84_case')::uuid)
     <> array['requested', 'replayed', 'legal_hold_set', 'purge_planned', 'legal_hold_cleared'] then
    raise exception 'DB4_84_OPERATOR_EVENTS';
  end if;
end
$plan_recorded$;

-- === 5. Отмена снимает «только чтение»; журнал и заявка неизменяемы =========

do $cancel$
declare
  v_result jsonb;
begin
  v_result := pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
    'select public.cancel_account_deletion(''Передумал'')');
  if v_result->>'status' <> 'cancelled' then
    raise exception 'DB4_84_CANCEL_FAILED:%', v_result;
  end if;
  perform pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
    $sql$ with u as (update public.projects set client_name = client_name
      where id = '41111111-1111-4111-8111-111111111111' returning 1) select to_jsonb(count(*)) from u $sql$);
end
$cancel$;

select pg_temp.expect_error('authenticated', '31111111-1111-4111-8111-111111111111',
  'select public.cancel_account_deletion(null)', 'P0002', 'ACCOUNT_RETENTION_NO_ACTIVE_CASE', 'cancel_twice');

do $immutable$
begin
  begin
    update public.account_retention_events set reason = 'tampered'
    where case_id = current_setting('db4.t84_case')::uuid;
    raise exception 'DB4_84_EVENTS_MUTABLE';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.account_retention_cases set status = 'requested'
    where case_id = current_setting('db4.t84_case')::uuid;
    raise exception 'DB4_84_CANCELLED_CASE_REOPENED';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.account_retention_cases where case_id = current_setting('db4.t84_case')::uuid;
    raise exception 'DB4_84_CASE_DELETABLE';
  exception when sqlstate '55000' then null;
  end;
end
$immutable$;

-- === 6. Срок истёк: отмены нет, блокеров нет (удаление всё равно не выполняется)

do $window_closed$
declare
  v_blockers jsonb;
begin
  insert into public.account_retention_cases (designer_id, requested_at, purge_after)
  values ('31111111-1111-4111-8111-111111111111',
          statement_timestamp() - interval '100 days',
          statement_timestamp() - interval '100 days' + interval '90 days');
  v_blockers := pg_temp.call_as('service_role', null,
    'select public.account_purge_blockers(''31111111-1111-4111-8111-111111111111'')');
  if v_blockers->'blockers' <> '[]'::jsonb then
    raise exception 'DB4_84_EXPIRED_BLOCKERS:%', v_blockers;
  end if;
end
$window_closed$;

select pg_temp.expect_error('authenticated', '31111111-1111-4111-8111-111111111111',
  'select public.cancel_account_deletion(null)', '42501', 'ACCOUNT_RETENTION_WINDOW_CLOSED', 'cancel_after_window');

rollback;

select 'DB4_ACCOUNT_RETENTION_OK' result;
