-- DEC-047, доработка приёмки (01.10.2026): дедлайн 30 дней и согласованное
-- уничтожение базы и файлов.
--
-- 1. Дедлайн. purge_after — крайний срок уничтожения (requested_at + 30 дней),
--    а не «не раньше». Уничтожать можно сразу после запроса (блокер
--    WINDOW_OPEN убран); просрочка видна в очереди оператора
--    (list_account_purge_queue) и в квитанции (deadline_met).
-- 2. Согласованность. База и Storage — разные системы, общей атомарности нет.
--    Поэтому уничтожение — run с журналом:
--      begin_account_purge  — все проверки (пробный прогон), затем ОДНИМ
--                             коммитом: заявка → purging (точка невозврата:
--                             восстановление и legal hold больше невозможны),
--                             run, манифест файлов, аренда исполнителя;
--      purge_run_files / mark_purge_files_deleted — файлы удаляются через
--                             Storage API и отмечаются; повтор безопасен;
--      finish_account_purge — когда все файлы отмечены: база одной
--                             транзакцией; отказ базы → run «blocked», заявка
--                             остаётся purging (аккаунт закрыт), после
--                             устранения причины — повтор.
--    Второй исполнитель при живой аренде получает LEASE_HELD; после сбоя
--    (аренда истекла) повтор продолжает тот же run.
-- Все функции run — security invoker, только суперпользователь базы.

begin;

-- === Заявка: статус purging ==================================================

alter table public.account_retention_cases
  drop constraint account_retention_cases_status_check,
  add constraint account_retention_cases_status_check
    check (status in ('requested', 'expired', 'purging', 'cancelled', 'purged'));

drop index public.account_retention_cases_active_idx;
create unique index account_retention_cases_active_idx
  on public.account_retention_cases (designer_id)
  where status in ('requested', 'expired', 'purging');

alter table public.account_retention_events
  drop constraint account_retention_events_event_type_check,
  add constraint account_retention_events_event_type_check check (event_type in (
    'requested', 'replayed', 'cancelled', 'legal_hold_set', 'legal_hold_cleared',
    'paid_archive_set', 'purge_planned', 'expired', 'restored',
    'purge_started', 'purge_resumed', 'purge_blocked'
  ));

-- Переходы: requested → expired | cancelled | purging; expired → cancelled |
-- purging. Из purging назад нельзя (строка удаляется самим уничтожением).
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
           (old.status = 'requested' and new.status in ('expired', 'cancelled', 'purging'))
           or (old.status = 'expired' and new.status in ('cancelled', 'purging')))) then
    raise exception using errcode = '55000', message = 'ACCOUNT_RETENTION_CASE_IMMUTABLE';
  end if;
  return new;
end
$function$;

create or replace function public._active_retention_case(p_designer_id uuid)
returns public.account_retention_cases
language sql
stable
security definer
set search_path = ''
as $function$
  select c.* from public.account_retention_cases c
  where c.designer_id = p_designer_id and c.status in ('requested', 'expired', 'purging')
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
    where c.designer_id = p_designer_id and c.status in ('requested', 'expired', 'purging')
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
    where c.designer_id = p_designer_id and c.status in ('requested', 'expired', 'purging')
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
    where rp.project_id = p_project_id and c.status in ('requested', 'expired', 'purging')
  )
$function$;

create or replace function public._account_purge_project_ids(p_designer_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(distinct x.id), '{}')
  from (
    select p.id from public.projects p where p.designer_id = p_designer_id
    union
    select rp.project_id from public.account_retention_projects rp
    join public.account_retention_cases c on c.case_id = rp.case_id
    where c.designer_id = p_designer_id and c.status in ('requested', 'expired', 'purging')
  ) x
$function$;

-- Статус для приложения: дедлайн, просрочка, начатое уничтожение.
create or replace function public._retention_status_json(p_case public.account_retention_cases)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when p_case.case_id is null then null else jsonb_build_object(
    'caseId', p_case.case_id,
    'status', case when p_case.status = 'purging' then 'purging'
                   when public._retention_case_expired(p_case) then 'expired'
                   else p_case.status end,
    'requestedAt', p_case.requested_at,
    'purgeAfter', p_case.purge_after,
    'purgeDeadline', p_case.purge_after,
    'overdue', p_case.status in ('requested', 'expired', 'purging')
               and statement_timestamp() > p_case.purge_after,
    'legalHold', p_case.legal_hold,
    'paidArchiveUntil', p_case.paid_archive_until,
    'cancellable', false,
    'closed', p_case.status in ('requested', 'expired', 'purging')
  ) end
$function$;

-- Блокеры уничтожения: без WINDOW_OPEN — срок является дедлайном.
create or replace function public.account_purge_blockers(p_designer_id uuid)
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
  if v_case.legal_hold then
    v_blockers := v_blockers || 'LEGAL_HOLD'::text;
  end if;
  if v_case.paid_archive_until is not null and current_date <= v_case.paid_archive_until then
    v_blockers := v_blockers || 'PAID_ARCHIVE'::text;
  end if;
  return jsonb_build_object(
    'caseId', v_case.case_id, 'purgeAfter', v_case.purge_after,
    'purgeDeadline', v_case.purge_after, 'blockers', to_jsonb(v_blockers)
  );
end
$function$;

-- Отмена (восстановление) — только до начала уничтожения.
create or replace function public.restore_account_retention_case(p_designer_id uuid, p_reason text, p_operator text)
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
  if v_case.status = 'purging' then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_IN_PROGRESS';
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
  if v_case.status = 'purging' then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_IN_PROGRESS';
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
  if v_case.status = 'purging' then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_IN_PROGRESS';
  end if;
  update public.account_retention_cases set paid_archive_until = p_until
  where case_id = v_case.case_id and status in ('requested', 'expired') returning * into v_case;
  insert into public.account_retention_events (case_id, event_type, actor, reason, detail)
  values (v_case.case_id, 'paid_archive_set', 'operator', btrim(p_reason),
    jsonb_build_object('paidArchiveUntil', p_until));
  return public._retention_status_json(v_case);
end
$function$;

-- === Run и манифест файлов ===================================================

-- Без id дизайнера: run переживает уничтожение (журнал оператора), связь с
-- дизайнером — через заявку, которая уничтожается вместе с данными.
create table public.account_purge_runs (
  run_id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  status text not null default 'files_pending'
    check (status in ('files_pending', 'blocked', 'completed')),
  operator text not null check (char_length(operator) between 1 and 200),
  lease_owner text check (lease_owner is null or char_length(lease_owner) between 1 and 200),
  lease_expires_at timestamptz,
  started_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  files_total integer not null default 0 check (files_total >= 0),
  files_deleted integer not null default 0 check (files_deleted >= 0),
  last_error text,
  receipt_id uuid
);
create unique index account_purge_runs_open_idx
  on public.account_purge_runs (case_id) where status <> 'completed';

create table public.account_purge_files (
  run_id uuid not null references public.account_purge_runs (run_id) on delete cascade,
  bucket text not null,
  name text not null,
  deleted_at timestamptz,
  primary key (run_id, bucket, name)
);

alter table public.account_purge_receipts
  add column run_id uuid,
  add column files_deleted integer,
  -- purge_after заявки = дедлайн уничтожения.
  add column deadline_met boolean generated always as (purged_at <= purge_after) stored;

grant create on schema public to pi_table_owner;
alter table public.account_purge_runs owner to pi_table_owner;
alter table public.account_purge_files owner to pi_table_owner;
revoke create on schema public from pi_table_owner;
alter table public.account_purge_runs enable row level security;
alter table public.account_purge_runs force row level security;
alter table public.account_purge_files enable row level security;
alter table public.account_purge_files force row level security;
revoke all on table public.account_purge_runs, public.account_purge_files
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
create policy account_purge_runs_internal_owner on public.account_purge_runs
  for all to pi_table_owner using (true) with check (true);
create policy account_purge_files_internal_owner on public.account_purge_files
  for all to pi_table_owner using (true) with check (true);

-- === Уничтожение базы: только внутри run =====================================

create or replace function public.purge_designer_account(p_designer_id uuid, p_operator text, p_dry_run boolean default false)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_case public.account_retention_cases;
  v_blockers jsonb;
  v_projects uuid[];
  v_files bigint;
  v_fk record;
  v_col record;
  v_child_cols text;
  v_parent_cols text;
  v_count bigint;
  v_changed bigint;
  v_foreign text;
  v_residual text[] := '{}';
  v_found boolean;
  v_counts jsonb;
  v_receipt public.account_purge_receipts;
begin
  if pg_catalog.current_setting('session_replication_role') <> 'replica' then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_REPLICA_SESSION_REQUIRED';
  end if;
  if p_operator is null or char_length(btrim(p_operator)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'ACCOUNT_RETENTION_OPERATOR_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-retention:' || p_designer_id::text, 0));

  v_case := public._active_retention_case(p_designer_id);
  if v_case.case_id is null then
    if not exists (select 1 from public.designers d where d.id = p_designer_id)
       and not exists (select 1 from auth.users u where u.id = p_designer_id) then
      return jsonb_build_object('status', 'already_purged');
    end if;
    raise exception using errcode = 'P0002', message = 'ACCOUNT_RETENTION_NO_ACTIVE_CASE';
  end if;
  v_blockers := public.account_purge_blockers(p_designer_id)->'blockers';
  if jsonb_array_length(v_blockers) > 0 then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_BLOCKED:' || v_blockers::text;
  end if;
  -- Настоящее уничтожение — только внутри начатого run (begin_account_purge
  -- зафиксировал точку невозврата до удаления первого файла).
  if not p_dry_run and (v_case.status <> 'purging' or not exists (
      select 1 from public.account_purge_runs r
      where r.case_id = v_case.case_id and r.status <> 'completed')) then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_NOT_STARTED';
  end if;
  v_projects := public._account_purge_project_ids(p_designer_id);
  -- Файлы проверяются прямо в storage.objects (функция работает с правами
  -- суперпользователя-оператора), а не через список для скрипта. В пробном
  -- прогоне файлы ещё на месте — его задача проверить всё остальное до их
  -- удаления.
  if not p_dry_run and pg_catalog.to_regclass('storage.objects') is not null then
    execute $sql$
      select count(*) from storage.objects o
      where (o.bucket_id in ('client-uploads', 'contract-documents')
             and exists (select 1 from unnest($1) pid where strpos(o.name, pid::text) > 0))
         or o.owner_id = $2::text
    $sql$ into v_files using v_projects, p_designer_id;
    if v_files > 0 then
      raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_FILES_REMAIN:' || v_files::text;
    end if;
  end if;

  drop table if exists pg_temp.account_purge_rows;
  create temp table account_purge_rows (rel regclass not null, row_data jsonb not null) on commit drop;
  create index on pg_temp.account_purge_rows (rel);

  -- Корни: проекты, дизайнер, пользователь, строки с project_id/designer_id
  -- без внешнего ключа.
  with d as (delete from public.projects p where p.id = any(v_projects) returning p.*)
  insert into pg_temp.account_purge_rows select 'public.projects'::regclass, to_jsonb(d) from d;
  with d as (delete from public.designers x where x.id = p_designer_id returning x.*)
  insert into pg_temp.account_purge_rows select 'public.designers'::regclass, to_jsonb(d) from d;
  with d as (delete from auth.users x where x.id = p_designer_id returning x.*)
  insert into pg_temp.account_purge_rows select 'auth.users'::regclass, to_jsonb(d) from d;
  for v_col in
    select c.oid::regclass as rel, a.attname
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition
      and n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
      and a.attnum > 0 and not a.attisdropped
      and a.atttypid = 'uuid'::regtype
      and a.attname in ('project_id', 'designer_id')
      and c.oid <> 'pg_temp.account_purge_rows'::regclass
  loop
    execute pg_catalog.format(
      'with d as (delete from %s t where t.%I = any($1) returning t.*) '
      'insert into pg_temp.account_purge_rows select %L::regclass, to_jsonb(d) from d',
      v_col.rel, v_col.attname, v_col.rel)
    using case when v_col.attname = 'project_id' then v_projects else array[p_designer_id] end;
  end loop;
  -- Журнал входов GoTrue хранит почту и id пользователя в payload.
  if pg_catalog.to_regclass('auth.audit_log_entries') is not null then
    execute $sql$
      with d as (delete from auth.audit_log_entries e where e.payload::text like '%' || $1::text || '%' returning e.*)
      insert into pg_temp.account_purge_rows select 'auth.audit_log_entries'::regclass, to_jsonb(d) from d
    $sql$ using p_designer_id;
  end if;

  -- Внешние ключи до неподвижной точки: удаляются зависимые строки по
  -- ключам cascade/restrict/no action. Строки по ключам set null/default
  -- не трогаются: такая строка переживает удаление (например, участие
  -- дизайнера в чужой студии с его почтой) — это отказ ниже, решает оператор.
  loop
    v_changed := 0;
    for v_fk in
      select c.conrelid::regclass as child, c.confrelid::regclass as parent, c.confdeltype,
             c.conkey, c.confkey
      from pg_catalog.pg_constraint c
      where c.contype = 'f' and c.conparentid = 0
        and c.confrelid in (select distinct r.rel from pg_temp.account_purge_rows r)
    loop
      select string_agg(pg_catalog.format('to_jsonb(t.%I)', ca.attname), ', ' order by k.ord),
             string_agg(pg_catalog.format('r.row_data->%L', pa.attname), ', ' order by k.ord)
      into v_child_cols, v_parent_cols
      from unnest(v_fk.conkey, v_fk.confkey) with ordinality as k(ckey, pkey, ord)
      join pg_catalog.pg_attribute ca on ca.attrelid = v_fk.child and ca.attnum = k.ckey
      join pg_catalog.pg_attribute pa on pa.attrelid = v_fk.parent and pa.attnum = k.pkey;

      if v_fk.confdeltype not in ('n', 'd') then
        execute pg_catalog.format(
          'with d as (delete from %s t where (%s) in (select %s from pg_temp.account_purge_rows r where r.rel = %L::regclass) returning t.*) '
          'insert into pg_temp.account_purge_rows select %L::regclass, to_jsonb(d) from d',
          v_fk.child, v_child_cols, v_parent_cols, v_fk.parent, v_fk.child);
        get diagnostics v_count = row_count;
        v_changed := v_changed + v_count;
      end if;
    end loop;
    exit when v_changed = 0;
  end loop;

  -- Чужие проекты и организации не трогаются.
  select string_agg(distinct r.rel::text, ', ') into v_foreign
  from pg_temp.account_purge_rows r
  where (r.row_data ? 'project_id' and r.row_data->>'project_id' is not null
         and r.row_data->>'project_id' <> all(v_projects::text[]))
     or (r.row_data ? 'organization_id' and r.row_data->>'organization_id' is not null
         and r.row_data->>'organization_id' not in (
           select o.row_data->>'id' from pg_temp.account_purge_rows o
           where o.rel::text = 'project_intelligence.organizations'));
  -- Строки, которые всё ещё ссылаются на удалённые (ключи set null/default):
  -- в режиме replica база их не обнулила бы, а обнулять за неё — оставить
  -- данные дизайнера в чужих записях.
  for v_fk in
    select c.conrelid::regclass as child, c.confrelid::regclass as parent, c.conkey, c.confkey
    from pg_catalog.pg_constraint c
    where c.contype = 'f' and c.conparentid = 0
      and c.confrelid in (select distinct r.rel from pg_temp.account_purge_rows r)
  loop
    select string_agg(pg_catalog.format('to_jsonb(t.%I)', ca.attname), ', ' order by k.ord),
           string_agg(pg_catalog.format('r.row_data->%L', pa.attname), ', ' order by k.ord)
    into v_child_cols, v_parent_cols
    from unnest(v_fk.conkey, v_fk.confkey) with ordinality as k(ckey, pkey, ord)
    join pg_catalog.pg_attribute ca on ca.attrelid = v_fk.child and ca.attnum = k.ckey
    join pg_catalog.pg_attribute pa on pa.attrelid = v_fk.parent and pa.attnum = k.pkey;
    execute pg_catalog.format(
      'select exists (select 1 from %s t where (%s) in (select %s from pg_temp.account_purge_rows r where r.rel = %L::regclass))',
      v_fk.child, v_child_cols, v_parent_cols, v_fk.parent)
    into v_found;
    if v_found then
      v_foreign := concat_ws(', ', v_foreign, v_fk.child::text);
    end if;
  end loop;
  if v_foreign is not null then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_FOREIGN_RECORDS:' || v_foreign;
  end if;

  -- Ни одного uuid дизайнера или его проектов не осталось.
  for v_col in
    select c.oid::regclass as rel, a.attname
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition
      and n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
      and a.attnum > 0 and not a.attisdropped
      and a.atttypid = 'uuid'::regtype
      and c.oid <> 'pg_temp.account_purge_rows'::regclass
  loop
    execute pg_catalog.format('select exists (select 1 from %s t where t.%I = any($1))', v_col.rel, v_col.attname)
    into v_found using array_append(v_projects, p_designer_id);
    if v_found then
      v_residual := v_residual || (v_col.rel::text || '.' || v_col.attname);
    end if;
  end loop;
  -- В схеме auth id пользователя хранится и строкой (refresh_tokens.user_id).
  for v_col in
    select c.oid::regclass as rel, a.attname
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = 'auth'
      and a.attnum > 0 and not a.attisdropped
      and a.atttypid in ('text'::regtype, 'character varying'::regtype)
  loop
    execute pg_catalog.format('select exists (select 1 from %s t where t.%I = $1)', v_col.rel, v_col.attname)
    into v_found using p_designer_id::text;
    if v_found then
      v_residual := v_residual || (v_col.rel::text || '.' || v_col.attname);
    end if;
  end loop;
  if cardinality(v_residual) > 0 then
    raise exception using errcode = '55000',
      message = 'ACCOUNT_PURGE_RESIDUAL_REFERENCES:' || array_to_string(v_residual, ', ');
  end if;

  select coalesce(jsonb_object_agg(x.rel, x.n), '{}'::jsonb) into v_counts
  from (select r.rel::text as rel, count(*) as n from pg_temp.account_purge_rows r group by r.rel) x;
  -- Пробный прогон: всё проверено, ничего не сохраняется — исключение
  -- откатывает удаление при любом вызывающем.
  if p_dry_run then
    raise exception using errcode = 'P0001',
      message = 'ACCOUNT_PURGE_DRY_RUN_OK:' || jsonb_build_object('projects', cardinality(v_projects), 'rows', v_counts)::text;
  end if;
  insert into public.account_purge_receipts (requested_at, purge_after, operator, project_count, row_counts)
  values (v_case.requested_at, v_case.purge_after, btrim(p_operator), cardinality(v_projects), v_counts)
  returning * into v_receipt;
  drop table pg_temp.account_purge_rows;
  return jsonb_build_object(
    'status', 'purged',
    'receiptId', v_receipt.receipt_id,
    'purgedAt', v_receipt.purged_at,
    'projects', v_receipt.project_count,
    'rows', v_receipt.row_counts
  );
end
$function$;


-- === Run: начало, файлы, завершение ==========================================

create function public._account_purge_run_json(p_run public.account_purge_runs)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'runId', p_run.run_id, 'status', p_run.status, 'filesTotal', p_run.files_total,
    'filesDeleted', p_run.files_deleted, 'leaseExpiresAt', p_run.lease_expires_at,
    'lastError', p_run.last_error, 'receiptId', p_run.receipt_id)
$function$;

-- Аренда: run ведёт один исполнитель; чужая живая аренда — отказ.
create function public._account_purge_take_lease(p_run public.account_purge_runs, p_lease_owner text)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if p_run.lease_owner is distinct from p_lease_owner
     and p_run.lease_expires_at is not null and p_run.lease_expires_at > clock_timestamp() then
    raise exception using errcode = '55P03', message = 'ACCOUNT_PURGE_LEASE_HELD';
  end if;
end
$function$;

create function public.begin_account_purge(
  p_designer_id uuid, p_operator text, p_lease_owner text, p_lease_seconds integer default 600
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_case public.account_retention_cases;
  v_run public.account_purge_runs;
  v_projects uuid[];
  v_blockers jsonb;
  v_error text;
  v_state text;
  v_resume boolean := false;
begin
  if pg_catalog.current_setting('session_replication_role') <> 'replica' then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_REPLICA_SESSION_REQUIRED';
  end if;
  if p_operator is null or char_length(btrim(p_operator)) not between 1 and 200
     or p_lease_owner is null or char_length(btrim(p_lease_owner)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'ACCOUNT_RETENTION_OPERATOR_REQUIRED';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 5 and 86400 then
    raise exception using errcode = '22023', message = 'ACCOUNT_PURGE_LEASE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-retention:' || p_designer_id::text, 0));

  v_case := public._active_retention_case(p_designer_id);
  if v_case.case_id is null then
    if not exists (select 1 from public.designers d where d.id = p_designer_id)
       and not exists (select 1 from auth.users u where u.id = p_designer_id) then
      return jsonb_build_object('status', 'already_purged');
    end if;
    raise exception using errcode = 'P0002', message = 'ACCOUNT_RETENTION_NO_ACTIVE_CASE';
  end if;

  if v_case.status = 'purging' then
    -- Продолжение начатого run (после сбоя или отказа базы).
    select * into v_run from public.account_purge_runs r
    where r.case_id = v_case.case_id and r.status <> 'completed' for update;
    if v_run.run_id is null then
      raise exception using errcode = 'P0002', message = 'ACCOUNT_PURGE_RUN_NOT_FOUND';
    end if;
    perform public._account_purge_take_lease(v_run, btrim(p_lease_owner));
    update public.account_purge_runs
    set lease_owner = btrim(p_lease_owner),
        lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
        status = 'files_pending'
    where run_id = v_run.run_id
    returning * into v_run;
    insert into public.account_retention_events (case_id, event_type, actor, detail)
    values (v_case.case_id, 'purge_resumed', 'operator',
      jsonb_build_object('runId', v_run.run_id, 'operator', btrim(p_operator)));
    return public._account_purge_run_json(v_run) || jsonb_build_object('resume', true);
  end if;

  v_blockers := public.account_purge_blockers(p_designer_id)->'blockers';
  if jsonb_array_length(v_blockers) > 0 then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_BLOCKED:' || v_blockers::text;
  end if;
  -- Все проверки уничтожения (кроме файлов) — до точки невозврата.
  begin
    perform public.purge_designer_account(p_designer_id, btrim(p_operator), true);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_error := sqlerrm;
    if v_error not like 'ACCOUNT_PURGE_DRY_RUN_OK:%' then
      raise exception using errcode = v_state, message = v_error;
    end if;
  end;

  -- Точка невозврата: заявка, run и манифест — одним коммитом до первого файла.
  update public.account_retention_cases set status = 'purging'
  where case_id = v_case.case_id
  returning * into v_case;
  insert into public.account_purge_runs (case_id, operator, lease_owner, lease_expires_at)
  values (v_case.case_id, btrim(p_operator), btrim(p_lease_owner),
          clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds))
  returning * into v_run;
  v_projects := public._account_purge_project_ids(p_designer_id);
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute $sql$
      insert into public.account_purge_files (run_id, bucket, name)
      select $3, o.bucket_id, o.name from storage.objects o
      where (o.bucket_id in ('client-uploads', 'contract-documents')
             and exists (select 1 from unnest($1) pid where strpos(o.name, pid::text) > 0))
         or o.owner_id = $2::text
    $sql$ using v_projects, p_designer_id, v_run.run_id;
  end if;
  update public.account_purge_runs
  set files_total = (select count(*) from public.account_purge_files f where f.run_id = v_run.run_id)
  where run_id = v_run.run_id
  returning * into v_run;
  insert into public.account_retention_events (case_id, event_type, actor, detail)
  values (v_case.case_id, 'purge_started', 'operator',
    jsonb_build_object('runId', v_run.run_id, 'operator', btrim(p_operator), 'filesTotal', v_run.files_total));
  return public._account_purge_run_json(v_run) || jsonb_build_object('resume', v_resume);
end
$function$;

create function public.purge_run_files(p_run_id uuid, p_lease_owner text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_run public.account_purge_runs;
begin
  select * into v_run from public.account_purge_runs r where r.run_id = p_run_id;
  if v_run.run_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_PURGE_RUN_NOT_FOUND';
  end if;
  perform public._account_purge_take_lease(v_run, btrim(p_lease_owner));
  return coalesce((select jsonb_agg(jsonb_build_object('bucket', f.bucket, 'name', f.name)
                                    order by f.bucket, f.name)
                   from public.account_purge_files f
                   where f.run_id = p_run_id and f.deleted_at is null), '[]'::jsonb);
end
$function$;

create function public.mark_purge_files_deleted(
  p_run_id uuid, p_lease_owner text, p_files jsonb, p_lease_seconds integer default 600
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_run public.account_purge_runs;
begin
  select * into v_run from public.account_purge_runs r where r.run_id = p_run_id for update;
  if v_run.run_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_PURGE_RUN_NOT_FOUND';
  end if;
  perform public._account_purge_take_lease(v_run, btrim(p_lease_owner));
  update public.account_purge_files f set deleted_at = statement_timestamp()
  from jsonb_to_recordset(coalesce(p_files, '[]'::jsonb)) as x(bucket text, name text)
  where f.run_id = p_run_id and f.bucket = x.bucket and f.name = x.name and f.deleted_at is null;
  update public.account_purge_runs
  set files_deleted = (select count(*) from public.account_purge_files f
                       where f.run_id = p_run_id and f.deleted_at is not null),
      lease_owner = btrim(p_lease_owner),
      lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds)
  where run_id = p_run_id
  returning * into v_run;
  return public._account_purge_run_json(v_run);
end
$function$;

create function public.finish_account_purge(p_run_id uuid, p_lease_owner text)
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
  if exists (select 1 from public.account_purge_files f where f.run_id = p_run_id and f.deleted_at is null) then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_FILES_PENDING';
  end if;
  select * into v_case from public.account_retention_cases c where c.case_id = v_run.case_id;

  -- База — одной транзакцией (вложенной): при отказе ничего из неё не удалено,
  -- а run помечается blocked и остаётся для повтора.
  begin
    v_result := public.purge_designer_account(v_case.designer_id, v_run.operator, false);
  exception when others then
    v_error := sqlerrm;
  end;
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

  update public.account_purge_receipts
  set run_id = p_run_id, files_deleted = v_run.files_deleted
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
                    where r.receipt_id = v_run.receipt_id));
end
$function$;

-- Исполнитель завершился с ошибкой штатно — отпускает аренду, повтор может
-- начаться сразу. (Упавший процесс держит аренду до её истечения.)
create function public.release_account_purge_lease(p_run_id uuid, p_lease_owner text)
returns void
language sql
volatile
security invoker
set search_path = ''
as $function$
  update public.account_purge_runs set lease_owner = null, lease_expires_at = null
  where run_id = p_run_id and lease_owner = btrim(p_lease_owner)
$function$;

-- Очередь оператора: все живые заявки по дедлайну.
create function public.list_account_purge_queue()
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
    'runStatus', r.status,
    'runError', r.last_error,
    'filesTotal', r.files_total,
    'filesDeleted', r.files_deleted,
    'requestedAt', c.requested_at,
    'deadline', c.purge_after,
    'daysLeft', trunc(extract(epoch from (c.purge_after - statement_timestamp())) / 86400),
    'overdue', statement_timestamp() > c.purge_after,
    'legalHold', c.legal_hold,
    'paidArchiveUntil', c.paid_archive_until
  ) order by c.purge_after), '[]'::jsonb)
  from public.account_retention_cases c
  left join public.account_purge_runs r on r.case_id = c.case_id and r.status <> 'completed'
  where c.status in ('requested', 'expired', 'purging')
$function$;

do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.purge_designer_account(uuid, text, boolean)',
    'public._account_purge_run_json(public.account_purge_runs)',
    'public._account_purge_take_lease(public.account_purge_runs, text)',
    'public.begin_account_purge(uuid, text, text, integer)',
    'public.purge_run_files(uuid, text)',
    'public.mark_purge_files_deleted(uuid, text, jsonb, integer)',
    'public.finish_account_purge(uuid, text)',
    'public.release_account_purge_lease(uuid, text)',
    'public.list_account_purge_queue()'
  ] loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_signature);
  end loop;
end
$grants$;

-- Смена владельца требует CREATE на схему (как в 20260928095900).
grant create on schema public to pi_table_owner;
alter function public.list_account_purge_queue() owner to pi_table_owner;
revoke create on schema public from pi_table_owner;
grant execute on function public.list_account_purge_queue() to service_role;

-- Как в 20260928155000 и DB4 88: функции pi_table_owner с SECURITY DEFINER не
-- обращаются к схеме auth.
do $no_auth_schema$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p
    where p.prosecdef and p.proowner = 'pi_table_owner'::regrole
      and p.prosrc ~ '\mauth\.'
  ) then
    raise exception 'ACCOUNT_RETENTION_DEFINER_USES_AUTH_SCHEMA';
  end if;
end
$no_auth_schema$;

commit;
