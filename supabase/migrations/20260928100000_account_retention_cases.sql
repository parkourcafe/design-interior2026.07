-- DEC-040, DEC-041 §2, DEC-044 (a): удаление аккаунта дизайнера — 90 дней
-- только для чтения и полного экспорта, затем удаление ПДн. Дизайн:
-- docs/canonical/remhaos-v1/REMHAOS_ACCOUNT_RETENTION_DESIGN_2026-09-28.md.
--
-- Эта миграция НЕ удаляет данные и не создаёт процесса удаления (purge не
-- разрешён). Она:
--   * заводит заявку на удаление (account_retention_cases) и append-only
--     журнал (account_retention_events);
--   * даёт дизайнеру запрос (идемпотентный), отмену и статус, оператору —
--     legal hold и платный архив (только service_role);
--   * даёт блокеры будущего удаления (account_purge_blockers) и запись плана
--     в журнал; сам план (dry-run) строит серверный скрипт оператора;
--   * переводит данные дизайнера с активной заявкой в «только чтение» на
--     уровне базы: проекты, ответы брифа, риски, КП, комнаты, договоры;
--   * даёт дизайнеру его версии паспорта для полного экспорта
--     (export_passport_revisions); остальное экспорт читает под RLS дизайнера.

begin;

create table public.account_retention_cases (
  case_id uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.designers (id) on delete restrict,
  status text not null default 'requested'
    check (status in ('requested', 'cancelled', 'purged')),
  requested_at timestamptz not null default statement_timestamp(),
  purge_after timestamptz not null,
  legal_hold boolean not null default false,
  paid_archive_until date,
  cancelled_at timestamptz,
  constraint account_retention_cases_window_check
    check (purge_after = requested_at + interval '90 days'),
  constraint account_retention_cases_cancel_shape_check
    check ((status = 'cancelled') = (cancelled_at is not null))
);

-- Одна активная заявка на дизайнера.
create unique index account_retention_cases_active_idx
  on public.account_retention_cases (designer_id)
  where status = 'requested';

create table public.account_retention_events (
  event_id bigint generated always as identity primary key,
  case_id uuid not null references public.account_retention_cases (case_id) on delete restrict,
  event_type text not null check (event_type in (
    'requested', 'replayed', 'cancelled', 'legal_hold_set', 'legal_hold_cleared',
    'paid_archive_set', 'purge_planned'
  )),
  actor text not null check (actor in ('designer', 'operator')),
  actor_user_id uuid,
  reason text check (reason is null or char_length(reason) between 1 and 500),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp()
);

create function public.reject_account_retention_event_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception using errcode = '55000', message = 'ACCOUNT_RETENTION_EVENT_IMMUTABLE';
end
$function$;

create trigger account_retention_events_append_only
  before update or delete on public.account_retention_events
  for each row execute function public.reject_account_retention_event_mutation();

-- Заявку меняют только функции ниже (владелец pi_table_owner); удалять — никому.
create function public.guard_account_retention_case_mutation()
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
     or (old.status <> 'requested' and new.status is distinct from old.status) then
    raise exception using errcode = '55000', message = 'ACCOUNT_RETENTION_CASE_IMMUTABLE';
  end if;
  return new;
end
$function$;

create trigger account_retention_cases_guard
  before update or delete on public.account_retention_cases
  for each row execute function public.guard_account_retention_case_mutation();

alter table public.account_retention_cases owner to pi_table_owner;
alter table public.account_retention_events owner to pi_table_owner;
alter table public.account_retention_cases enable row level security;
alter table public.account_retention_cases force row level security;
alter table public.account_retention_events enable row level security;
alter table public.account_retention_events force row level security;
revoke all on table public.account_retention_cases
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on table public.account_retention_events
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
create policy account_retention_cases_internal_owner on public.account_retention_cases
  for all to pi_table_owner using (true) with check (true);
create policy account_retention_events_internal_owner on public.account_retention_events
  for all to pi_table_owner using (true) with check (true);

-- === Помощники ==============================================================

create function public._active_retention_case(p_designer_id uuid)
returns public.account_retention_cases
language sql
stable
security definer
set search_path = ''
as $function$
  select c.* from public.account_retention_cases c
  where c.designer_id = p_designer_id and c.status = 'requested'
$function$;

-- Для серверных маршрутов (service role): дизайнер в сроке удаления?
create function public.account_retention_active(p_designer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.account_retention_cases c
    where c.designer_id = p_designer_id and c.status = 'requested'
  )
$function$;

create function public._retention_status_json(p_case public.account_retention_cases)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when p_case.case_id is null then null else jsonb_build_object(
    'caseId', p_case.case_id,
    'status', p_case.status,
    'requestedAt', p_case.requested_at,
    'purgeAfter', p_case.purge_after,
    'legalHold', p_case.legal_hold,
    'paidArchiveUntil', p_case.paid_archive_until,
    'cancellable', p_case.status = 'requested' and not p_case.legal_hold
      and statement_timestamp() < p_case.purge_after
  ) end
$function$;

-- === Дизайнер: запрос, отмена, статус ======================================

create function public.request_account_deletion(p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_case public.account_retention_cases;
  v_now timestamptz := statement_timestamp();
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'ACCOUNT_RETENTION_UNAUTHENTICATED';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'ACCOUNT_RETENTION_REASON_TOO_LONG';
  end if;
  -- Сериализация по дизайнеру: два одновременных запроса дают одну заявку.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-retention:' || v_user::text, 0));

  v_case := public._active_retention_case(v_user);
  if v_case.case_id is not null then
    insert into public.account_retention_events (case_id, event_type, actor, actor_user_id)
    values (v_case.case_id, 'replayed', 'designer', v_user);
    return public._retention_status_json(v_case) || jsonb_build_object('replay', true);
  end if;

  insert into public.account_retention_cases (designer_id, requested_at, purge_after)
  values (v_user, v_now, v_now + interval '90 days')
  returning * into v_case;
  insert into public.account_retention_events (case_id, event_type, actor, actor_user_id, reason)
  values (v_case.case_id, 'requested', 'designer', v_user, nullif(btrim(p_reason), ''));
  return public._retention_status_json(v_case) || jsonb_build_object('replay', false);
end
$function$;

create function public.cancel_account_deletion(p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_case public.account_retention_cases;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'ACCOUNT_RETENTION_UNAUTHENTICATED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-retention:' || v_user::text, 0));
  v_case := public._active_retention_case(v_user);
  if v_case.case_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_RETENTION_NO_ACTIVE_CASE';
  end if;
  if v_case.legal_hold then
    raise exception using errcode = '42501', message = 'ACCOUNT_RETENTION_LEGAL_HOLD';
  end if;
  if statement_timestamp() >= v_case.purge_after then
    raise exception using errcode = '42501', message = 'ACCOUNT_RETENTION_WINDOW_CLOSED';
  end if;
  update public.account_retention_cases
  set status = 'cancelled', cancelled_at = statement_timestamp()
  where case_id = v_case.case_id
  returning * into v_case;
  insert into public.account_retention_events (case_id, event_type, actor, actor_user_id, reason)
  values (v_case.case_id, 'cancelled', 'designer', v_user, nullif(btrim(p_reason), ''));
  return public._retention_status_json(v_case);
end
$function$;

create function public.get_account_retention_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select public._retention_status_json(public._active_retention_case(auth.uid()))
$function$;

-- === Оператор (только service_role, серверный путь) ========================

create function public.set_account_legal_hold(p_designer_id uuid, p_hold boolean, p_reason text)
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
  v_case := public._active_retention_case(p_designer_id);
  if v_case.case_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_RETENTION_NO_ACTIVE_CASE';
  end if;
  if v_case.legal_hold is distinct from p_hold then
    update public.account_retention_cases set legal_hold = p_hold
    where case_id = v_case.case_id returning * into v_case;
    insert into public.account_retention_events (case_id, event_type, actor, reason)
    values (v_case.case_id,
      case when p_hold then 'legal_hold_set' else 'legal_hold_cleared' end,
      'operator', btrim(p_reason));
  end if;
  return public._retention_status_json(v_case);
end
$function$;

create function public.mark_account_paid_archive(p_designer_id uuid, p_until date, p_reason text)
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
  v_case := public._active_retention_case(p_designer_id);
  if v_case.case_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_RETENTION_NO_ACTIVE_CASE';
  end if;
  update public.account_retention_cases set paid_archive_until = p_until
  where case_id = v_case.case_id returning * into v_case;
  insert into public.account_retention_events (case_id, event_type, actor, reason, detail)
  values (v_case.case_id, 'paid_archive_set', 'operator', btrim(p_reason),
    jsonb_build_object('paidArchiveUntil', p_until));
  return public._retention_status_json(v_case);
end
$function$;

-- Блокеры будущего удаления (dry-run). Счёт объёма удаления делает серверный
-- скрипт оператора через service_role (lib/account-retention/purge-plan.ts):
-- у pi_table_owner нет чтения чужих строк старых публичных таблиц, и
-- расширять его ради плана нельзя.
create function public.account_purge_blockers(p_designer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_case public.account_retention_cases;
  v_blockers text[] := '{}';
begin
  v_case := public._active_retention_case(p_designer_id);
  if v_case.case_id is null then
    return jsonb_build_object('caseId', null, 'blockers', jsonb_build_array('NO_ACTIVE_CASE'));
  end if;
  if statement_timestamp() < v_case.purge_after then
    v_blockers := v_blockers || 'WINDOW_OPEN'::text;
  end if;
  if v_case.legal_hold then
    v_blockers := v_blockers || 'LEGAL_HOLD'::text;
  end if;
  if v_case.paid_archive_until is not null and current_date <= v_case.paid_archive_until then
    v_blockers := v_blockers || 'PAID_ARCHIVE'::text;
  end if;
  return jsonb_build_object(
    'caseId', v_case.case_id, 'purgeAfter', v_case.purge_after, 'blockers', to_jsonb(v_blockers)
  );
end
$function$;

-- Журнал: оператор построил план удаления (ничего не удалено).
create function public.record_account_purge_plan(p_designer_id uuid, p_plan jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_case public.account_retention_cases;
begin
  v_case := public._active_retention_case(p_designer_id);
  if v_case.case_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_RETENTION_NO_ACTIVE_CASE';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
     or coalesce((p_plan->>'destructive')::boolean, true) then
    raise exception using errcode = '22023', message = 'ACCOUNT_PURGE_PLAN_MUST_BE_DRY_RUN';
  end if;
  insert into public.account_retention_events (case_id, event_type, actor, detail)
  values (v_case.case_id, 'purge_planned', 'operator', p_plan);
end
$function$;

-- Версии паспорта закрыты для API-ролей (20260829074543). Дизайнеру — его
-- собственные, для полного экспорта; оператору — только их число по проектам.
create function public.export_passport_revisions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.project_id, r.revision_no), '[]'::jsonb)
  from public.project_passport_revisions r
  join public.projects p on p.id = r.project_id
  where p.designer_id = auth.uid()
$function$;

create function public.count_passport_revisions(p_project_ids uuid[])
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select count(*) from public.project_passport_revisions r
  where r.project_id = any(coalesce(p_project_ids, '{}'))
$function$;

-- === «Только чтение» в срок удаления =======================================

-- Проверка заявки для триггера ниже: триггер работает с правами вызывающего
-- (иначе current_user был бы владельцем функции), а таблица заявок закрыта.
create function public._designer_in_retention(p_designer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.account_retention_cases c
    where c.designer_id = p_designer_id and c.status = 'requested'
  )
$function$;

create function public.guard_account_retention_read_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_designer uuid;
begin
  -- Ограничиваются API-роли: сам дизайнер, публичные ссылки и service_role
  -- серверных маршрутов (ответ клиента на КП, приём брифа). Внутренние роли
  -- базы (миграции, операторские функции) не ограничиваются.
  if current_user not in ('authenticated', 'anon', 'service_role') then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'projects' then
    v_designer := coalesce(new.designer_id, old.designer_id);
  else
    select p.designer_id into v_designer from public.projects p
    where p.id = case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  end if;
  if v_designer is not null and public._designer_in_retention(v_designer) then
    raise exception using errcode = '42501', message = 'ACCOUNT_IN_RETENTION_READ_ONLY';
  end if;
  return coalesce(new, old);
end
$function$;

do $triggers$
declare
  v_table text;
begin
  foreach v_table in array array['projects', 'proposals', 'answers', 'risk_cards',
                                 'project_rooms', 'contract_documents'] loop
    execute pg_catalog.format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function public.guard_account_retention_read_only()',
      v_table || '_account_retention_read_only', v_table);
  end loop;
end
$triggers$;

-- === Владение и гранты ======================================================

do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public._active_retention_case(uuid)',
    'public.account_retention_active(uuid)',
    'public._designer_in_retention(uuid)',
    'public._retention_status_json(public.account_retention_cases)',
    'public.request_account_deletion(text)',
    'public.cancel_account_deletion(text)',
    'public.get_account_retention_status()',
    'public.set_account_legal_hold(uuid, boolean, text)',
    'public.mark_account_paid_archive(uuid, date, text)',
    'public.account_purge_blockers(uuid)',
    'public.record_account_purge_plan(uuid, jsonb)',
    'public.export_passport_revisions()',
    'public.count_passport_revisions(uuid[])',
    'public.guard_account_retention_read_only()',
    'public.reject_account_retention_event_mutation()',
    'public.guard_account_retention_case_mutation()'
  ] loop
    execute pg_catalog.format('alter function %s owner to pi_table_owner', v_signature);
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_signature);
  end loop;
end
$grants$;

grant execute on function public.request_account_deletion(text) to authenticated;
grant execute on function public.cancel_account_deletion(text) to authenticated;
grant execute on function public.get_account_retention_status() to authenticated;
grant execute on function public.export_passport_revisions() to authenticated;
grant execute on function public.account_retention_active(uuid) to service_role;
grant execute on function public._designer_in_retention(uuid) to authenticated, anon, service_role;
grant execute on function public.guard_account_retention_read_only() to authenticated, anon, service_role;
grant execute on function public.set_account_legal_hold(uuid, boolean, text) to service_role;
grant execute on function public.mark_account_paid_archive(uuid, date, text) to service_role;
grant execute on function public.account_purge_blockers(uuid) to service_role;
grant execute on function public.record_account_purge_plan(uuid, jsonb) to service_role;
grant execute on function public.count_passport_revisions(uuid[]) to service_role;

commit;
