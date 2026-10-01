-- Правки после независимого ревью 20260928160000 (01.10.2026).
--
--   * Список файлов сверяется с хранилищем заново при продолжении и перед
--     завершением: файл, появившийся после точки невозврата или не удалённый
--     на самом деле, возвращается в список (раньше run застревал навсегда
--     с FILES_REMAIN).
--   * Файл отмечается удалённым, только если его действительно нет в
--     storage.objects (ответ Storage API «без ошибки» этого не доказывает).
--   * В точке невозврата вход закрывается: пользователь блокируется в Auth,
--     его сессии удаляются (ни новых загрузок, ни записей журнала входа).
--   * Переход в purging — только из requested/expired (в replica триггер
--     переходов не работает).
--   * Уничтожение базы — только из finish_account_purge этого run; итог,
--     отличный от «purged», — отказ, а не завершение без квитанции.
--   * Дедлайн — не позднее 30 дней от запроса и для старых 90-дневных заявок:
--     least(purge_after, requested_at + 30 дней) — в статусе, очереди,
--     просрочке и квитанции.
--   * account_purge_storage_objects больше не доступна service_role (скрипт
--     её не использует, а без WINDOW_OPEN она отдавала имена файлов сразу).

begin;

create function public._account_purge_deadline(p_requested_at timestamptz, p_purge_after timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $function$
  select least(p_purge_after, p_requested_at + interval '30 days')
$function$;

create or replace function public._retention_case_expired(p_case public.account_retention_cases)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select p_case.case_id is not null and (
    p_case.status = 'expired'
    or (p_case.status = 'requested'
        and statement_timestamp() >= public._account_purge_deadline(p_case.requested_at, p_case.purge_after))
  )
$function$;

-- Дедлайн квитанции вычисляет уничтожение при записи (выражение с
-- timestamptz + interval не годится для вычисляемого столбца).
alter table public.account_purge_receipts
  drop column deadline_met,
  add column deadline_met boolean;

create function public._account_purge_object_exists(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_found boolean;
begin
  execute 'select exists (select 1 from storage.objects o where o.bucket_id = $1 and o.name = $2)'
  into v_found using p_bucket, p_name;
  return v_found;
end
$function$;

-- Список файлов run = то, что сейчас лежит в хранилище по проектам
-- дизайнера; уже отмеченный файл, который снова (или всё ещё) есть, —
-- возвращается в работу.
create function public._account_purge_sync_manifest(p_run_id uuid, p_designer_id uuid)
returns public.account_purge_runs
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_run public.account_purge_runs;
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute $sql$
      insert into public.account_purge_files (run_id, bucket, name)
      select $3, o.bucket_id, o.name from storage.objects o
      where (o.bucket_id in ('client-uploads', 'contract-documents')
             and exists (select 1 from unnest($1) pid where strpos(o.name, pid::text) > 0))
         or o.owner_id = $2::text
      on conflict (run_id, bucket, name) do update set deleted_at = null
    $sql$ using public._account_purge_project_ids(p_designer_id), p_designer_id, p_run_id;
  end if;
  update public.account_purge_runs
  set files_total = (select count(*) from public.account_purge_files f where f.run_id = p_run_id),
      files_deleted = (select count(*) from public.account_purge_files f
                       where f.run_id = p_run_id and f.deleted_at is not null)
  where run_id = p_run_id
  returning * into v_run;
  return v_run;
end
$function$;

-- Точка невозврата закрывает вход: блокировка в Auth и удаление сессий.
create function public._account_purge_lock_out(p_designer_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if exists (select 1 from pg_catalog.pg_attribute a
             where a.attrelid = 'auth.users'::regclass and a.attname = 'banned_until' and not a.attisdropped) then
    execute 'update auth.users set banned_until = ''infinity'' where id = $1' using p_designer_id;
  end if;
  if pg_catalog.to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1::text' using p_designer_id;
  end if;
  if pg_catalog.to_regclass('auth.sessions') is not null then
    if pg_catalog.to_regclass('auth.mfa_amr_claims') is not null then
      execute 'delete from auth.mfa_amr_claims c using auth.sessions s where c.session_id = s.id and s.user_id = $1'
      using p_designer_id;
    end if;
    execute 'delete from auth.sessions where user_id = $1' using p_designer_id;
  end if;
end
$function$;

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
    'purgeDeadline', public._account_purge_deadline(p_case.requested_at, p_case.purge_after),
    'overdue', p_case.status in ('requested', 'expired', 'purging')
               and statement_timestamp() > public._account_purge_deadline(p_case.requested_at, p_case.purge_after),
    'legalHold', p_case.legal_hold,
    'paidArchiveUntil', p_case.paid_archive_until,
    'cancellable', false,
    'closed', p_case.status in ('requested', 'expired', 'purging')
  ) end
$function$;

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
  -- ...и только из finish_account_purge этого run (он сверяет файлы и пишет
  -- итог run; ручной вызов в обход него оставил бы run без квитанции).
  if not p_dry_run and (v_case.status <> 'purging' or not exists (
      select 1 from public.account_purge_runs r
      where r.case_id = v_case.case_id and r.status <> 'completed'
        and r.run_id::text = pg_catalog.current_setting('remhaos.account_purge_finish', true))) then
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
  insert into public.account_purge_receipts (requested_at, purge_after, operator, project_count, row_counts, deadline_met)
  values (v_case.requested_at, v_case.purge_after, btrim(p_operator), cardinality(v_projects), v_counts,
          statement_timestamp() <= public._account_purge_deadline(v_case.requested_at, v_case.purge_after))
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

create or replace function public.begin_account_purge(
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
    -- Хранилище могло измениться после прошлого прохода: список файлов заново.
    v_run := public._account_purge_sync_manifest(v_run.run_id, p_designer_id);
    perform public._account_purge_lock_out(p_designer_id);
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
  -- В режиме replica триггер переходов не работает — условие здесь.
  update public.account_retention_cases set status = 'purging'
  where case_id = v_case.case_id and status in ('requested', 'expired')
  returning * into v_case;
  if v_case.case_id is null then
    raise exception using errcode = '55000', message = 'ACCOUNT_RETENTION_CASE_IMMUTABLE';
  end if;
  insert into public.account_purge_runs (case_id, operator, lease_owner, lease_expires_at)
  values (v_case.case_id, btrim(p_operator), btrim(p_lease_owner),
          clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds))
  returning * into v_run;
  v_run := public._account_purge_sync_manifest(v_run.run_id, p_designer_id);
  perform public._account_purge_lock_out(p_designer_id);
  insert into public.account_retention_events (case_id, event_type, actor, detail)
  values (v_case.case_id, 'purge_started', 'operator',
    jsonb_build_object('runId', v_run.run_id, 'operator', btrim(p_operator), 'filesTotal', v_run.files_total));
  return public._account_purge_run_json(v_run) || jsonb_build_object('resume', v_resume);
end
$function$;

create or replace function public.mark_purge_files_deleted(
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
  v_present bigint := 0;
begin
  select * into v_run from public.account_purge_runs r where r.run_id = p_run_id for update;
  if v_run.run_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_PURGE_RUN_NOT_FOUND';
  end if;
  perform public._account_purge_take_lease(v_run, btrim(p_lease_owner));
  -- Отмечается только то, чего в хранилище действительно больше нет: ответ
  -- Storage API «без ошибки» не доказывает удаление (не тот сервер, пропуск).
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute $sql$
      select count(*) from jsonb_to_recordset(coalesce($1, '[]'::jsonb)) as x(bucket text, name text)
      where exists (select 1 from storage.objects o where o.bucket_id = x.bucket and o.name = x.name)
    $sql$ into v_present using p_files;
  end if;
  update public.account_purge_files f set deleted_at = statement_timestamp()
  from jsonb_to_recordset(coalesce(p_files, '[]'::jsonb)) as x(bucket text, name text)
  where f.run_id = p_run_id and f.bucket = x.bucket and f.name = x.name and f.deleted_at is null
    and (pg_catalog.to_regclass('storage.objects') is null
         or not public._account_purge_object_exists(x.bucket, x.name));
  update public.account_purge_runs
  set files_deleted = (select count(*) from public.account_purge_files f
                       where f.run_id = p_run_id and f.deleted_at is not null),
      lease_owner = btrim(p_lease_owner),
      lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds)
  where run_id = p_run_id
  returning * into v_run;
  return public._account_purge_run_json(v_run) || jsonb_build_object('stillPresent', v_present);
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

create or replace function public.list_account_purge_queue()
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
    'deadline', public._account_purge_deadline(c.requested_at, c.purge_after),
    'daysLeft', trunc(extract(epoch from (public._account_purge_deadline(c.requested_at, c.purge_after)
                                           - statement_timestamp())) / 86400),
    'overdue', statement_timestamp() > public._account_purge_deadline(c.requested_at, c.purge_after),
    'legalHold', c.legal_hold,
    'paidArchiveUntil', c.paid_archive_until
  ) order by public._account_purge_deadline(c.requested_at, c.purge_after)), '[]'::jsonb)
  from public.account_retention_cases c
  left join public.account_purge_runs r on r.case_id = c.case_id and r.status <> 'completed'
  where c.status in ('requested', 'expired', 'purging')
$function$;

-- Список файлов для исполнителя — после сверки с хранилищем.
create or replace function public.purge_run_files(p_run_id uuid, p_lease_owner text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_run public.account_purge_runs;
  v_designer uuid;
begin
  select * into v_run from public.account_purge_runs r where r.run_id = p_run_id for update;
  if v_run.run_id is null then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_PURGE_RUN_NOT_FOUND';
  end if;
  perform public._account_purge_take_lease(v_run, btrim(p_lease_owner));
  select c.designer_id into v_designer from public.account_retention_cases c where c.case_id = v_run.case_id;
  if v_designer is not null then
    perform public._account_purge_sync_manifest(p_run_id, v_designer);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('bucket', f.bucket, 'name', f.name)
                                    order by f.bucket, f.name)
                   from public.account_purge_files f
                   where f.run_id = p_run_id and f.deleted_at is null), '[]'::jsonb);
end
$function$;

revoke execute on function public.account_purge_storage_objects(uuid) from service_role;

do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public._account_purge_object_exists(text, text)',
    'public._account_purge_sync_manifest(uuid, uuid)',
    'public._account_purge_lock_out(uuid)'
  ] loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_signature);
  end loop;
end
$grants$;

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
