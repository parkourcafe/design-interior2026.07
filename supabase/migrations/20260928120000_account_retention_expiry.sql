-- DEC-045 (a): после 90 дней заявка на удаление аккаунта получает статус
-- «срок вышел, ждёт удаления» (`expired`). Вход дизайнера закрыт, данные не
-- трогаются; оператор видит такие аккаунты и может восстановить аккаунт по
-- просьбе дизайнера — с причиной и записью в журнал. Удаление данных (purge)
-- по-прежнему не разрешено и здесь не появляется.
--
-- Чтение fail-closed: заявка `requested`, у которой срок уже вышел, везде
-- считается `expired` — не важно, прошёл ли по ней перевод статуса
-- (`sweep_account_retention_expiry`). Перевод нужен журналу и оператору, а не
-- защите.

begin;

alter table public.account_retention_cases
  drop constraint account_retention_cases_status_check,
  add constraint account_retention_cases_status_check
    check (status in ('requested', 'expired', 'cancelled', 'purged'));

-- Одна живая заявка на дизайнера: и в сроке, и после него.
drop index public.account_retention_cases_active_idx;
create unique index account_retention_cases_active_idx
  on public.account_retention_cases (designer_id)
  where status in ('requested', 'expired');

alter table public.account_retention_events
  drop constraint account_retention_events_event_type_check,
  add constraint account_retention_events_event_type_check check (event_type in (
    'requested', 'replayed', 'cancelled', 'legal_hold_set', 'legal_hold_cleared',
    'paid_archive_set', 'purge_planned', 'expired', 'restored'
  ));

-- Переходы: requested → expired | cancelled; expired → cancelled (восстановление).
-- Назад в requested и из терминальных статусов — нельзя.
create or replace function public.guard_account_retention_case_mutation()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'ACCOUNT_RETENTION_CASE_NOT_DELETABLE';
  end if;
  if new.designer_id is distinct from old.designer_id
     or new.requested_at is distinct from old.requested_at
     or new.purge_after is distinct from old.purge_after
     or (new.status is distinct from old.status and not (
           (old.status = 'requested' and new.status in ('expired', 'cancelled'))
           or (old.status = 'expired' and new.status = 'cancelled'))) then
    raise exception using errcode = '55000', message = 'ACCOUNT_RETENTION_CASE_IMMUTABLE';
  end if;
  return new;
end
$function$;

-- Живая заявка — в сроке или после него: hold, архив, блокеры и план удаления
-- работают и для неё.
create or replace function public._active_retention_case(p_designer_id uuid)
returns public.account_retention_cases
language sql
stable
security definer
set search_path = ''
as $function$
  select c.* from public.account_retention_cases c
  where c.designer_id = p_designer_id and c.status in ('requested', 'expired')
$function$;

create or replace function public.account_retention_active(p_designer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.account_retention_cases c
    where c.designer_id = p_designer_id and c.status in ('requested', 'expired')
  )
$function$;

create or replace function public._designer_in_retention(p_designer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.account_retention_cases c
    where c.designer_id = p_designer_id and c.status in ('requested', 'expired')
  )
$function$;

create or replace function public._project_in_retention(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_project_id is not null and exists (
    select 1
    from public.account_retention_projects rp
    join public.account_retention_cases c on c.case_id = rp.case_id
    where rp.project_id = p_project_id and c.status in ('requested', 'expired')
  )
$function$;

-- Срок вышел — по статусу или по времени (fail-closed до перевода).
create function public._retention_case_expired(p_case public.account_retention_cases)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select p_case.case_id is not null and (
    p_case.status = 'expired'
    or (p_case.status = 'requested' and statement_timestamp() >= p_case.purge_after)
  )
$function$;

create or replace function public._retention_status_json(p_case public.account_retention_cases)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when p_case.case_id is null then null else jsonb_build_object(
    'caseId', p_case.case_id,
    -- Для экрана — действующий статус: `expired`, если срок вышел.
    'status', case when public._retention_case_expired(p_case) then 'expired' else p_case.status end,
    'requestedAt', p_case.requested_at,
    'purgeAfter', p_case.purge_after,
    'legalHold', p_case.legal_hold,
    'paidArchiveUntil', p_case.paid_archive_until,
    'cancellable', p_case.status = 'requested'
      and statement_timestamp() < p_case.purge_after,
    'closed', public._retention_case_expired(p_case)
  ) end
$function$;

-- Legal hold и платный архив ставятся и после срока (до удаления это самое
-- важное время для hold). Прежние версии обновляли только `requested`.
create or replace function public.set_account_legal_hold(p_designer_id uuid, p_hold boolean, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_case public.account_retention_cases;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'ACCOUNT_RETENTION_REASON_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-retention:' || p_designer_id::text, 0));
  v_case := public._active_retention_case(p_designer_id);
  if v_case.case_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_RETENTION_NO_ACTIVE_CASE';
  end if;
  if v_case.legal_hold is distinct from p_hold then
    update public.account_retention_cases set legal_hold = p_hold
    where case_id = v_case.case_id and status in ('requested', 'expired') returning * into v_case;
    insert into public.account_retention_events (case_id, event_type, actor, reason)
    values (v_case.case_id,
      case when p_hold then 'legal_hold_set' else 'legal_hold_cleared' end,
      'operator', btrim(p_reason));
  end if;
  return public._retention_status_json(v_case);
end
$function$;

create or replace function public.mark_account_paid_archive(p_designer_id uuid, p_until date, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_case public.account_retention_cases;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'ACCOUNT_RETENTION_REASON_REQUIRED';
  end if;
  if p_until is null or p_until < current_date then
    raise exception using errcode = '22023', message = 'ACCOUNT_RETENTION_ARCHIVE_DATE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-retention:' || p_designer_id::text, 0));
  v_case := public._active_retention_case(p_designer_id);
  if v_case.case_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_RETENTION_NO_ACTIVE_CASE';
  end if;
  update public.account_retention_cases set paid_archive_until = p_until
  where case_id = v_case.case_id and status in ('requested', 'expired') returning * into v_case;
  insert into public.account_retention_events (case_id, event_type, actor, reason, detail)
  values (v_case.case_id, 'paid_archive_set', 'operator', btrim(p_reason),
    jsonb_build_object('paidArchiveUntil', p_until));
  return public._retention_status_json(v_case);
end
$function$;

-- === Оператор: перевод, список, восстановление (только service_role) =======

create function public.sweep_account_retention_expiry()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_case public.account_retention_cases;
  v_count integer := 0;
begin
  for v_case in
    select c.* from public.account_retention_cases c
    where c.status = 'requested' and c.purge_after <= statement_timestamp()
    order by c.purge_after
    for update skip locked
  loop
    update public.account_retention_cases set status = 'expired'
    where case_id = v_case.case_id and status = 'requested';
    if found then
      insert into public.account_retention_events (case_id, event_type, actor, reason)
      values (v_case.case_id, 'expired', 'operator', 'retention_window_elapsed');
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('expired', v_count);
end
$function$;

create function public.list_expired_account_retention_cases()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'caseId', c.case_id,
    'designerId', c.designer_id,
    'status', c.status,
    'requestedAt', c.requested_at,
    'purgeAfter', c.purge_after,
    'legalHold', c.legal_hold,
    'paidArchiveUntil', c.paid_archive_until
  ) order by c.purge_after), '[]'::jsonb)
  from public.account_retention_cases c
  where public._retention_case_expired(c)
$function$;

-- Восстановление по просьбе дизайнера: данные сохраняются, вход открывается.
-- Legal hold не мешает — он запрещает удаление, а не сохранение.
-- p_operator — кто восстановил (имя или почта оператора): service_role общий,
-- и без этого журнал не ответил бы, кто принял решение.
create function public.restore_account_retention_case(p_designer_id uuid, p_reason text, p_operator text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_case public.account_retention_cases;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'ACCOUNT_RETENTION_REASON_REQUIRED';
  end if;
  if p_operator is null or char_length(btrim(p_operator)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'ACCOUNT_RETENTION_OPERATOR_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-retention:' || p_designer_id::text, 0));
  v_case := public._active_retention_case(p_designer_id);
  if v_case.case_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_RETENTION_NO_ACTIVE_CASE';
  end if;
  -- В срок дизайнер отменяет сам; восстановление — только после срока.
  if not public._retention_case_expired(v_case) then
    raise exception using errcode = '42501', message = 'ACCOUNT_RETENTION_WINDOW_OPEN';
  end if;
  update public.account_retention_cases
  set status = 'cancelled', cancelled_at = statement_timestamp()
  where case_id = v_case.case_id
  returning * into v_case;
  insert into public.account_retention_events (case_id, event_type, actor, reason, detail)
  values (v_case.case_id, 'restored', 'operator', btrim(p_reason),
    jsonb_build_object('operator', btrim(p_operator)));
  return public._retention_status_json(v_case);
end
$function$;

do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public._retention_case_expired(public.account_retention_cases)',
    'public.sweep_account_retention_expiry()',
    'public.list_expired_account_retention_cases()',
    'public.restore_account_retention_case(uuid, text, text)'
  ] loop
    execute pg_catalog.format('alter function %s owner to pi_table_owner', v_signature);
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_signature);
  end loop;
end
$grants$;

grant execute on function public.sweep_account_retention_expiry() to service_role;
grant execute on function public.list_expired_account_retention_cases() to service_role;
grant execute on function public.restore_account_retention_case(uuid, text, text) to service_role;

commit;
