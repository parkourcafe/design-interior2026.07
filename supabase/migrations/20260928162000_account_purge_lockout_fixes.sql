-- Правка по стенду (01.10.2026, код 37a0213):
--   * блокировка входа в точке невозврата ставила banned_until = 'infinity' —
--     GoTrue не читает такое значение и отвечает 500 на любой поиск
--     пользователя. Теперь — дата через 100 лет;
--   * сессии и токены входа, удалённые в точке невозврата, учитываются в
--     квитанции (раньше они в неё не попадали).

begin;

alter table public.account_purge_runs
  add column lockout_rows jsonb not null default '{}'::jsonb
    check (jsonb_typeof(lockout_rows) = 'object');

create function public._account_purge_sum_counts(p_a jsonb, p_b jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
  from (
    select k, sum(v::bigint) as n
    from (select key as k, value as v from jsonb_each_text(coalesce(p_a, '{}'::jsonb))
          union all
          select key, value from jsonb_each_text(coalesce(p_b, '{}'::jsonb))) x
    group by k
  ) y
$function$;

create or replace function public._account_purge_lock_out(p_designer_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
begin
  if exists (select 1 from pg_catalog.pg_attribute a
             where a.attrelid = 'auth.users'::regclass and a.attname = 'banned_until' and not a.attisdropped) then
    -- Конечная дата: 'infinity' GoTrue прочитать не может.
    execute 'update auth.users set banned_until = statement_timestamp() + interval ''100 years'' where id = $1'
    using p_designer_id;
  end if;
  if pg_catalog.to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1::text' using p_designer_id;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('auth.refresh_tokens', v_n);
  end if;
  if pg_catalog.to_regclass('auth.sessions') is not null then
    if pg_catalog.to_regclass('auth.mfa_amr_claims') is not null then
      execute 'delete from auth.mfa_amr_claims c using auth.sessions s where c.session_id = s.id and s.user_id = $1'
      using p_designer_id;
      get diagnostics v_n = row_count;
      v_counts := v_counts || jsonb_build_object('auth.mfa_amr_claims', v_n);
    end if;
    execute 'delete from auth.sessions where user_id = $1' using p_designer_id;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('auth.sessions', v_n);
  end if;
  update public.account_purge_runs r
  set lockout_rows = public._account_purge_sum_counts(r.lockout_rows, v_counts)
  where r.status <> 'completed' and r.case_id = (
    select c.case_id from public.account_retention_cases c
    where c.designer_id = p_designer_id and c.status = 'purging');
end
$function$;

create or replace function public.finish_account_purge(p_run_id uuid, p_lease_owner text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_run public.account_purge_runs;
  v_case public.account_retention_cases;
  v_result jsonb;
  v_error text;
begin
  if pg_catalog.current_setting('session_replication_role') <> 'replica' then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_REPLICA_SESSION_REQUIRED';
  end if;
  select * into v_run from public.account_purge_runs r where r.run_id = p_run_id for update;
  if v_run.run_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_PURGE_RUN_NOT_FOUND';
  end if;
  if v_run.status = 'completed' then
    return public._account_purge_run_json(v_run) || jsonb_build_object('replay', true);
  end if;
  perform public._account_purge_take_lease(v_run, btrim(p_lease_owner));
  select * into v_case from public.account_retention_cases c where c.case_id = v_run.case_id;
  -- Хранилище сверяется заново: появившийся или неудалённый файл возвращается
  -- в список, и повтор `purge` его удалит (иначе run застрял бы навсегда).
  if v_case.case_id is not null then
    v_run := public._account_purge_sync_manifest(p_run_id, v_case.designer_id);
  end if;
  -- Есть неудалённые файлы — не отказ (он откатил бы сверку), а статус:
  -- исполнитель удаляет их и повторяет finish.
  if exists (select 1 from public.account_purge_files f where f.run_id = p_run_id and f.deleted_at is null) then
    return public._account_purge_run_json(v_run) || jsonb_build_object('filesPending',
      (select count(*) from public.account_purge_files f where f.run_id = p_run_id and f.deleted_at is null));
  end if;
  if v_case.case_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_PURGE_CASE_MISSING';
  end if;

  -- База — одной транзакцией (вложенной): при отказе ничего из неё не удалено,
  -- а run помечается blocked и остаётся для повтора.
  perform pg_catalog.set_config('remhaos.account_purge_finish', p_run_id::text, true);
  begin
    v_result := public.purge_designer_account(v_case.designer_id, v_run.operator, false);
    if v_result->>'status' is distinct from 'purged' then
      raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_UNEXPECTED_RESULT:' || coalesce(v_result::text, 'null');
    end if;
  exception when others then
    v_error := sqlerrm;
  end;
  perform pg_catalog.set_config('remhaos.account_purge_finish', '', true);
  if v_error is not null then
    update public.account_purge_runs
    set status = 'blocked', last_error = left(v_error, 2000), lease_owner = null, lease_expires_at = null
    where run_id = p_run_id
    returning * into v_run;
    -- Заявка ещё на месте (откат вложенной транзакции).
    insert into public.account_retention_events (case_id, event_type, actor, reason, detail)
    values (v_run.case_id, 'purge_blocked', 'operator', left(v_error, 500),
      jsonb_build_object('runId', p_run_id));
    return public._account_purge_run_json(v_run);
  end if;

  -- В квитанцию входят и строки входа, удалённые в точке невозврата.
  update public.account_purge_receipts
  set run_id = p_run_id, files_deleted = v_run.files_deleted,
      row_counts = public._account_purge_sum_counts(row_counts, v_run.lockout_rows)
  where receipt_id = (v_result->>'receiptId')::uuid;
  delete from public.account_purge_files f where f.run_id = p_run_id;
  update public.account_purge_runs
  set status = 'completed', finished_at = statement_timestamp(), last_error = null,
      receipt_id = (v_result->>'receiptId')::uuid, lease_owner = null, lease_expires_at = null
  where run_id = p_run_id
  returning * into v_run;
  return public._account_purge_run_json(v_run) || jsonb_build_object(
    'purgedAt', v_result->'purgedAt', 'projects', v_result->'projects', 'rows', v_result->'rows',
    'deadlineMet', (select r.deadline_met from public.account_purge_receipts r
                    where r.receipt_id = v_run.receipt_id),
    'rows', (select r.row_counts from public.account_purge_receipts r where r.receipt_id = v_run.receipt_id));
end
$function$;

do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public._account_purge_sum_counts(jsonb, jsonb)',
    'public._account_purge_lock_out(uuid)'
  ] loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_signature);
  end loop;
end
$grants$;

commit;
