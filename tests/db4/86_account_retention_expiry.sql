\set ON_ERROR_STOP on

-- DB4: после 90 дней заявка на удаление аккаунта — «срок вышел, ждёт
-- удаления» (DEC-045 (a); миграция 20260928120000). Вход закрыт, данные не
-- трогаются, оператор видит список и может восстановить аккаунт с причиной.
-- Дизайнер 31111111 (проект 41111111). Весь файл — одна транзакция с откатом.

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
      raise exception 'DB4_86_WRONG_FAILURE:%:%:%', p_label, v_state, v_text;
    end if;
    return;
  end;
  raise exception 'DB4_86_EXPECTED_FAILURE:%', p_label;
end
$function$;

-- Операторские двери — только service_role.
do $surface$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.sweep_account_retention_expiry()',
    'public.list_expired_account_retention_cases()',
    'public.restore_account_retention_case(uuid,text,text)'
  ] loop
    if pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'DB4_86_OPERATOR_SURFACE:%', v_signature;
    end if;
  end loop;
  if pg_catalog.has_function_privilege('service_role',
       'public._retention_case_expired(public.account_retention_cases)', 'EXECUTE') then
    raise exception 'DB4_86_HELPER_EXPOSED';
  end if;
end
$surface$;

-- Заявка, поданная 100 дней назад: срок вышел, перевод статуса ещё не прошёл.
insert into public.account_retention_cases (designer_id, requested_at, purge_after)
values ('31111111-1111-4111-8111-111111111111',
        statement_timestamp() - interval '100 days',
        statement_timestamp() - interval '100 days' + interval '90 days');
insert into public.account_retention_projects (case_id, project_id)
select case_id, '41111111-1111-4111-8111-111111111111'
from public.account_retention_cases
where designer_id = '31111111-1111-4111-8111-111111111111' and status = 'requested';
select set_config('db4.t86_case', case_id::text, true)
from public.account_retention_cases
where designer_id = '31111111-1111-4111-8111-111111111111' and status = 'requested';

-- === 1. До перевода статуса — уже «закрыто» (fail-closed) ==================

do $fail_closed$
declare
  v_status jsonb;
begin
  v_status := pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
    'select public.get_account_retention_status()');
  if v_status->>'status' <> 'expired' or not (v_status->>'closed')::boolean
     or (v_status->>'cancellable')::boolean then
    raise exception 'DB4_86_NOT_CLOSED_BEFORE_SWEEP:%', v_status;
  end if;
  if not (pg_temp.call_as('service_role', null,
       'select to_jsonb(public.account_retention_active(''31111111-1111-4111-8111-111111111111''))'))::boolean then
    raise exception 'DB4_86_RETENTION_INACTIVE_AFTER_WINDOW';
  end if;
end
$fail_closed$;

select pg_temp.expect_error('authenticated', '31111111-1111-4111-8111-111111111111',
  $sql$ with u as (update public.projects set client_name = client_name
    where id = '41111111-1111-4111-8111-111111111111' returning 1) select to_jsonb(count(*)) from u $sql$,
  '42501', 'ACCOUNT_IN_RETENTION_READ_ONLY', 'write_after_window');
select pg_temp.expect_error('authenticated', '31111111-1111-4111-8111-111111111111',
  'select public.cancel_account_deletion(null)', '42501', 'ACCOUNT_RETENTION_WINDOW_CLOSED', 'cancel_after_window');

-- === 2. Перевод статуса: один раз, с журналом ==============================

do $sweep$
declare
  v_first jsonb;
  v_second jsonb;
  v_replay jsonb;
begin
  v_first := pg_temp.call_as('service_role', null, 'select public.sweep_account_retention_expiry()');
  v_second := pg_temp.call_as('service_role', null, 'select public.sweep_account_retention_expiry()');
  if (v_first->>'expired')::int < 1 or (v_second->>'expired')::int <> 0 then
    raise exception 'DB4_86_SWEEP:%/%', v_first, v_second;
  end if;
  if (select status from public.account_retention_cases
      where case_id = current_setting('db4.t86_case')::uuid) <> 'expired' then
    raise exception 'DB4_86_NOT_EXPIRED';
  end if;
  if (select count(*) from public.account_retention_events
      where case_id = current_setting('db4.t86_case')::uuid and event_type = 'expired') <> 1 then
    raise exception 'DB4_86_EXPIRED_EVENT';
  end if;
  -- Повторный запрос удаления не открывает новую заявку.
  v_replay := pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
    'select public.request_account_deletion(null)');
  if v_replay->>'caseId' <> current_setting('db4.t86_case') or not (v_replay->>'replay')::boolean then
    raise exception 'DB4_86_REQUEST_AFTER_EXPIRY:%', v_replay;
  end if;
  -- Оператор видит аккаунт в списке; legal hold по-прежнему ставится.
  if not exists (
    select 1 from jsonb_array_elements(pg_temp.call_as('service_role', null,
      'select public.list_expired_account_retention_cases()')) item
    where item->>'caseId' = current_setting('db4.t86_case')
  ) then
    raise exception 'DB4_86_NOT_LISTED';
  end if;
  perform pg_temp.call_as('service_role', null,
    'select public.set_account_legal_hold(''31111111-1111-4111-8111-111111111111'', true, ''Запрос суда'')');
end
$sweep$;

-- Назад в «запрошено» — нельзя.
do $no_reopen$
begin
  update public.account_retention_cases set status = 'requested'
  where case_id = current_setting('db4.t86_case')::uuid;
  raise exception 'DB4_86_EXPIRED_REOPENED';
exception when sqlstate '55000' then null;
end
$no_reopen$;

-- === 3. Восстановление: только оператор, только с причиной =================

select pg_temp.expect_error('authenticated', '31111111-1111-4111-8111-111111111111',
  $sql$ select public.restore_account_retention_case('31111111-1111-4111-8111-111111111111', 'сам', 'сам') $sql$,
  '42501', 'permission denied', 'designer_restore');
select pg_temp.expect_error('service_role', null,
  $sql$ select public.restore_account_retention_case('31111111-1111-4111-8111-111111111111', ' ', 'ops') $sql$,
  '22023', 'ACCOUNT_RETENTION_REASON_REQUIRED', 'restore_without_reason');

do $restore$
declare
  v_result jsonb;
begin
  -- Legal hold восстановлению не мешает: данные сохраняются.
  v_result := pg_temp.call_as('service_role', null,
    $sql$ select public.restore_account_retention_case('31111111-1111-4111-8111-111111111111',
      'Дизайнер вернулся, письмо от 28.09', 'ops@remhaos.example') $sql$);
  if (select detail->>'operator' from public.account_retention_events
      where case_id = current_setting('db4.t86_case')::uuid and event_type = 'restored')
     is distinct from 'ops@remhaos.example' then
    raise exception 'DB4_86_RESTORE_OPERATOR_NOT_RECORDED';
  end if;
  if v_result->>'status' <> 'cancelled' or (v_result->>'closed')::boolean then
    raise exception 'DB4_86_RESTORE:%', v_result;
  end if;
  if (select array_agg(event_type order by event_id) from public.account_retention_events
      where case_id = current_setting('db4.t86_case')::uuid)
     <> array['expired', 'replayed', 'legal_hold_set', 'restored'] then
    raise exception 'DB4_86_RESTORE_EVENTS';
  end if;
  -- Кабинет снова открыт для записи, список пуст.
  perform pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
    $sql$ with u as (update public.projects set client_name = client_name
      where id = '41111111-1111-4111-8111-111111111111' returning 1) select to_jsonb(count(*)) from u $sql$);
  if exists (
    select 1 from jsonb_array_elements(pg_temp.call_as('service_role', null,
      'select public.list_expired_account_retention_cases()')) item
    where item->>'caseId' = current_setting('db4.t86_case')
  ) then
    raise exception 'DB4_86_STILL_LISTED';
  end if;
end
$restore$;

-- В срок восстанавливать нечего: дизайнер отменяет сам.
do $fresh$
begin
  perform pg_temp.call_as('authenticated', '31111111-1111-4111-8111-111111111111',
    'select public.request_account_deletion(null)');
end
$fresh$;
select pg_temp.expect_error('service_role', null,
  $sql$ select public.restore_account_retention_case('31111111-1111-4111-8111-111111111111', 'рано', 'ops') $sql$,
  '42501', 'ACCOUNT_RETENTION_WINDOW_OPEN', 'restore_in_window');

rollback;

select 'DB4_ACCOUNT_RETENTION_EXPIRY_OK' result;
