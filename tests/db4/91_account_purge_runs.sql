\set ON_ERROR_STOP on

-- DB4-91: дедлайн 30 дней и run уничтожения (миграция 20260928160000).
--   * срок — дедлайн: блокеров сразу после запроса нет, очередь показывает
--     дни до дедлайна и просрочку;
--   * begin фиксирует точку невозврата: заявка purging, восстановление и
--     legal hold запрещены;
--   * аренда: второй исполнитель — отказ, после истечения — продолжение;
--   * finish не идёт, пока не отмечены все файлы; отказ базы после файлов —
--     run blocked, заявка purging, восстановления нет; после устранения
--     причины — завершение, квитанция с deadline_met;
--   * функции run не доступны API-ролям.
-- Сид: tests/db3/20_foundation_operations.sql — дизайнер 33333333 (проект
-- 42222222), дизайнер 31111111 (проект 41111111). Одна транзакция с откатом.

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

create function pg_temp.error_of(p_sql text) returns text
language plpgsql as $function$
begin
  execute p_sql;
  return null;
exception when others then
  perform pg_catalog.set_config('role', 'postgres', true);
  return sqlerrm;
end
$function$;

-- === 0. Права ===============================================================

do $rights$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.begin_account_purge(uuid,text,text,integer)',
    'public.purge_run_files(uuid,text)',
    'public.mark_purge_files_deleted(uuid,text,jsonb,integer)',
    'public.finish_account_purge(uuid,text)'
  ] loop
    if pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'DB4_91_RUN_FUNCTION_EXPOSED:%', v_fn;
    end if;
  end loop;
  if pg_catalog.has_function_privilege('authenticated', 'public.list_account_purge_queue()', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.list_account_purge_queue()', 'EXECUTE')
     or pg_catalog.has_table_privilege('service_role', 'public.account_purge_runs', 'SELECT') then
    raise exception 'DB4_91_QUEUE_RIGHTS';
  end if;
end
$rights$;

-- === 1. Дедлайн и очередь ===================================================

do $deadline$
declare
  v_status jsonb;
  v_queue jsonb;
  v_item jsonb;
begin
  v_status := pg_temp.call_as('authenticated', '33333333-3333-4333-8333-333333333333',
    'select public.request_account_deletion(''DB4-91'')');
  if (v_status->>'purgeDeadline')::timestamptz <> (v_status->>'requestedAt')::timestamptz + interval '30 days'
     or (v_status->>'overdue')::boolean or not (v_status->>'closed')::boolean then
    raise exception 'DB4_91_STATUS:%', v_status;
  end if;
  if pg_temp.call_as('service_role', null,
       'select public.account_purge_blockers(''33333333-3333-4333-8333-333333333333'')')->'blockers'
     <> '[]'::jsonb then
    raise exception 'DB4_91_BLOCKERS_BEFORE_DEADLINE';
  end if;
  -- Просроченная заявка второго дизайнера (31 день назад).
  insert into public.account_retention_cases (designer_id, requested_at, purge_after)
  values ('31111111-1111-4111-8111-111111111111',
          statement_timestamp() - interval '31 days',
          statement_timestamp() - interval '31 days' + interval '30 days');
  v_queue := pg_temp.call_as('service_role', null, 'select public.list_account_purge_queue()');
  if jsonb_array_length(v_queue) <> 2
     or (v_queue->0->>'designerId') <> '31111111-1111-4111-8111-111111111111'
     or not (v_queue->0->>'overdue')::boolean then
    raise exception 'DB4_91_QUEUE_ORDER_OR_OVERDUE:%', v_queue;
  end if;
  v_item := v_queue->1;
  if (v_item->>'overdue')::boolean or (v_item->>'daysLeft')::int not between 29 and 30
     or v_item->>'status' <> 'requested' then
    raise exception 'DB4_91_QUEUE_ITEM:%', v_item;
  end if;
end
$deadline$;

-- === 2. Точка невозврата, аренда, продолжение ===============================

set local session_replication_role = replica;

do $begin_run$
declare
  v_run jsonb;
  v_error text;
begin
  v_run := public.begin_account_purge('33333333-3333-4333-8333-333333333333', 'db4-operator', 'lease-a');
  if v_run->>'status' <> 'files_pending' or (v_run->>'resume')::boolean then
    raise exception 'DB4_91_BEGIN:%', v_run;
  end if;
  perform set_config('db4.t91_run', v_run->>'runId', true);
  if (select status from public.account_retention_cases
      where designer_id = '33333333-3333-4333-8333-333333333333' and status <> 'cancelled') <> 'purging' then
    raise exception 'DB4_91_NOT_PURGING';
  end if;
  -- Второй исполнитель при живой аренде.
  v_error := pg_temp.error_of($sql$ select public.begin_account_purge(
    '33333333-3333-4333-8333-333333333333', 'db4-operator', 'lease-b') $sql$);
  if v_error is distinct from 'ACCOUNT_PURGE_LEASE_HELD' then
    raise exception 'DB4_91_SECOND_RUNNER:%', v_error;
  end if;
end
$begin_run$;

set local session_replication_role = origin;

do $no_restore$
declare
  v_error text;
  v_status jsonb;
begin
  v_error := pg_temp.error_of($sql$ select pg_temp.call_as('service_role', null,
    'select public.restore_account_retention_case(''33333333-3333-4333-8333-333333333333'', ''передумал'', ''ops'')') $sql$);
  if v_error is distinct from 'ACCOUNT_PURGE_IN_PROGRESS' then
    raise exception 'DB4_91_RESTORE_DURING_PURGE:%', v_error;
  end if;
  v_error := pg_temp.error_of($sql$ select pg_temp.call_as('service_role', null,
    'select public.set_account_legal_hold(''33333333-3333-4333-8333-333333333333'', true, ''суд'')') $sql$);
  if v_error is distinct from 'ACCOUNT_PURGE_IN_PROGRESS' then
    raise exception 'DB4_91_HOLD_DURING_PURGE:%', v_error;
  end if;
  v_status := pg_temp.call_as('authenticated', '33333333-3333-4333-8333-333333333333',
    'select public.get_account_retention_status()');
  if v_status->>'status' <> 'purging' or not (v_status->>'closed')::boolean then
    raise exception 'DB4_91_STATUS_DURING_PURGE:%', v_status;
  end if;
end
$no_restore$;

set local session_replication_role = replica;

do $files_and_resume$
declare
  v_run uuid := current_setting('db4.t91_run')::uuid;
  v_error text;
  v_resumed jsonb;
  v_marked jsonb;
begin
  -- Файл в манифесте (в харнессе нет storage — строка вставляется вручную).
  insert into public.account_purge_files (run_id, bucket, name)
  values (v_run, 'client-uploads', '42222222-2222-4222-8222-222222222222/db4-91.png');
  v_error := pg_temp.error_of(pg_catalog.format(
    'select public.finish_account_purge(%L, %L)', v_run, 'lease-a'));
  if v_error is distinct from 'ACCOUNT_PURGE_FILES_PENDING' then
    raise exception 'DB4_91_FINISH_WITH_FILES:%', v_error;
  end if;
  v_error := pg_temp.error_of(pg_catalog.format(
    'select public.purge_run_files(%L, %L)', v_run, 'lease-b'));
  if v_error is distinct from 'ACCOUNT_PURGE_LEASE_HELD' then
    raise exception 'DB4_91_FILES_FOREIGN_LEASE:%', v_error;
  end if;
  -- Сбой исполнителя A: аренда истекла — B продолжает тот же run.
  update public.account_purge_runs set lease_expires_at = clock_timestamp() - interval '1 second'
  where run_id = v_run;
  v_resumed := public.begin_account_purge('33333333-3333-4333-8333-333333333333', 'db4-operator', 'lease-b');
  if not (v_resumed->>'resume')::boolean or (v_resumed->>'runId')::uuid <> v_run then
    raise exception 'DB4_91_RESUME:%', v_resumed;
  end if;
  if jsonb_array_length(public.purge_run_files(v_run, 'lease-b')) <> 1 then
    raise exception 'DB4_91_FILE_LIST';
  end if;
  v_marked := public.mark_purge_files_deleted(v_run, 'lease-b',
    '[{"bucket": "client-uploads", "name": "42222222-2222-4222-8222-222222222222/db4-91.png"}]'::jsonb);
  if (v_marked->>'filesDeleted')::int <> 1 then
    raise exception 'DB4_91_MARK:%', v_marked;
  end if;
end
$files_and_resume$;

-- === 3. Отказ базы после удаления файлов; повтор ============================

do $blocked_then_done$
declare
  v_run uuid := current_setting('db4.t91_run')::uuid;
  v_result jsonb;
  v_error text;
begin
  insert into public.events (id, designer_id, project_id, type)
  values ('91e00000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
          '41111111-1111-4111-8111-111111111111', 'proposal_viewed');
  v_result := public.finish_account_purge(v_run, 'lease-b');
  if v_result->>'status' <> 'blocked' or v_result->>'lastError' not like 'ACCOUNT_PURGE_FOREIGN_RECORDS:%' then
    raise exception 'DB4_91_NOT_BLOCKED:%', v_result;
  end if;
  if not exists (select 1 from public.projects where id = '42222222-2222-4222-8222-222222222222')
     or (select status from public.account_retention_cases
         where designer_id = '33333333-3333-4333-8333-333333333333' and status <> 'cancelled') <> 'purging' then
    raise exception 'DB4_91_BLOCKED_STATE';
  end if;
  v_error := pg_temp.error_of($sql$ select public.restore_account_retention_case(
    '33333333-3333-4333-8333-333333333333', 'после блокировки', 'ops') $sql$);
  if v_error is distinct from 'ACCOUNT_PURGE_IN_PROGRESS' then
    raise exception 'DB4_91_RESTORE_AFTER_BLOCK:%', v_error;
  end if;
  -- Оператор устранил причину; повтор.
  delete from public.events where id = '91e00000-0000-4000-8000-000000000001';
  perform public.begin_account_purge('33333333-3333-4333-8333-333333333333', 'db4-operator', 'lease-c');
  v_result := public.finish_account_purge(v_run, 'lease-c');
  if v_result->>'status' <> 'completed' or not (v_result->>'deadlineMet')::boolean then
    raise exception 'DB4_91_NOT_COMPLETED:%', v_result;
  end if;
  if (select files_deleted from public.account_purge_receipts where run_id = v_run) <> 1
     or exists (select 1 from public.account_purge_files where run_id = v_run)
     or exists (select 1 from public.designers where id = '33333333-3333-4333-8333-333333333333') then
    raise exception 'DB4_91_COMPLETION_STATE';
  end if;
end
$blocked_then_done$;

set local session_replication_role = origin;

rollback;

select 'DB4_ACCOUNT_PURGE_RUNS_OK' as result;
