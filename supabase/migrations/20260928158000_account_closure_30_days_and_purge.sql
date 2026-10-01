-- DEC-047 (решение владельца 01.10.2026, оценка ПДн «Персональные данные в
-- пилоте RemHaOS» от 01.10.2026): удаление аккаунта дизайнера — в течение
-- 30 дней, без периода «только чтение». Заменяет DEC-044 (a), DEC-045 (a),
-- DEC-046.
--
--   * запрос удаления сразу закрывает аккаунт: кабинет, экспорт, запись,
--     клиентские ссылки (приложение смотрит на `closed` в статусе заявки);
--   * срок уничтожения — 30 дней от запроса (`purge_after`);
--   * отменить запрос дизайнер сам не может — только оператор по обращению
--     в поддержку до уничтожения (restore_account_retention_case);
--   * уничтожение — purge_designer_account: одна транзакция, запускает
--     оператор под суперпользователем базы (см. scripts/account-purge.ts).
--     Ни одна API-роль её не вызывает.
--
-- Старые заявки с 90-дневным сроком (до DEC-047) остаются допустимыми.

begin;

-- === Срок и журнал ==========================================================

alter table public.account_retention_cases
  drop constraint account_retention_cases_window_check,
  add constraint account_retention_cases_window_check
    check (purge_after = requested_at + interval '30 days'
        or purge_after = requested_at + interval '90 days');

-- Квитанция об уничтожении: без идентификатора и данных дизайнера — только
-- даты, оператор и число удалённых строк по таблицам. Её номер оператор
-- сообщает дизайнеру как подтверждение удаления.
create table public.account_purge_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  requested_at timestamptz not null,
  purge_after timestamptz not null,
  purged_at timestamptz not null default statement_timestamp(),
  operator text not null check (char_length(operator) between 1 and 200),
  project_count integer not null check (project_count >= 0),
  row_counts jsonb not null check (jsonb_typeof(row_counts) = 'object')
);
-- Смена владельца требует CREATE на схему у нового владельца (как в
-- 20260928095900): право выдаётся только на время миграции.
grant create on schema public to pi_table_owner;
alter table public.account_purge_receipts owner to pi_table_owner;
revoke create on schema public from pi_table_owner;
alter table public.account_purge_receipts enable row level security;
alter table public.account_purge_receipts force row level security;
revoke all on table public.account_purge_receipts
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

-- === Запрос: 30 дней, аккаунт закрыт сразу ==================================

create or replace function public.request_account_deletion(p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  -- Пользователь — из JWT запроса, как в 20260928155000 (у владельца функции
  -- нет доступа к схеме auth на Supabase).
  v_user uuid := project_intelligence._request_user_id();
  v_case public.account_retention_cases;
  v_now timestamptz := statement_timestamp();
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'ACCOUNT_RETENTION_UNAUTHENTICATED';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'ACCOUNT_RETENTION_REASON_TOO_LONG';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-retention:' || v_user::text, 0));

  v_case := public._active_retention_case(v_user);
  if v_case.case_id is not null then
    insert into public.account_retention_events (case_id, event_type, actor, actor_user_id)
    values (v_case.case_id, 'replayed', 'designer', v_user);
    return public._retention_status_json(v_case) || jsonb_build_object('replay', true);
  end if;

  insert into public.account_retention_cases (designer_id, requested_at, purge_after)
  values (v_user, v_now, v_now + interval '30 days')
  returning * into v_case;
  insert into public.account_retention_projects (case_id, project_id)
  select v_case.case_id, p.id from public.projects p where p.designer_id = v_user;
  insert into public.account_retention_events (case_id, event_type, actor, actor_user_id, reason)
  values (v_case.case_id, 'requested', 'designer', v_user, nullif(btrim(p_reason), ''));
  return public._retention_status_json(v_case) || jsonb_build_object('replay', false);
end
$function$;

-- Дизайнер сам не отменяет: аккаунт закрыт с момента запроса.
create or replace function public.cancel_account_deletion(p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'ACCOUNT_RETENTION_CANCEL_VIA_SUPPORT';
end
$function$;
revoke execute on function public.cancel_account_deletion(text) from authenticated;

-- `closed` — для приложения: любая живая заявка закрывает аккаунт.
create or replace function public._retention_status_json(p_case public.account_retention_cases)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when p_case.case_id is null then null else jsonb_build_object(
    'caseId', p_case.case_id,
    'status', case when public._retention_case_expired(p_case) then 'expired' else p_case.status end,
    'requestedAt', p_case.requested_at,
    'purgeAfter', p_case.purge_after,
    'legalHold', p_case.legal_hold,
    'paidArchiveUntil', p_case.paid_archive_until,
    'cancellable', false,
    'closed', p_case.status in ('requested', 'expired')
  ) end
$function$;

-- Отмена по обращению в поддержку — в любой момент до уничтожения.
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

-- === Уничтожение ============================================================

-- Проекты, которые уничтожаются вместе с аккаунтом: свои и снимок заявки.
create function public._account_purge_project_ids(p_designer_id uuid)
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
    where c.designer_id = p_designer_id and c.status in ('requested', 'expired')
  ) x
$function$;

-- Файлы проектов в хранилище — их удаляет скрипт оператора через Storage API
-- (иначе файлы останутся на диске) до вызова purge_designer_account.
-- Список выдаётся только по заявке, готовой к уничтожению.
create function public.account_purge_storage_objects(p_designer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_blockers jsonb := public.account_purge_blockers(p_designer_id)->'blockers';
  v_projects uuid[] := public._account_purge_project_ids(p_designer_id);
  v_result jsonb;
begin
  if jsonb_array_length(v_blockers) > 0 then
    raise exception using errcode = '55000', message = 'ACCOUNT_PURGE_BLOCKED:' || v_blockers::text;
  end if;
  if pg_catalog.to_regclass('storage.objects') is null then
    return '[]'::jsonb;
  end if;
  execute $sql$
    select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name)
                              order by o.bucket_id, o.name), '[]'::jsonb)
    from storage.objects o
    where (o.bucket_id in ('client-uploads', 'contract-documents')
           and exists (select 1 from unnest($1) pid where strpos(o.name, pid::text) > 0))
       or o.owner_id = $2::text
  $sql$ into v_result using v_projects, p_designer_id;
  return v_result;
end
$function$;

-- Уничтожение данных дизайнера одной транзакцией.
--
-- Запускает оператор под суперпользователем базы с
-- `set local session_replication_role = replica`: в этом режиме не работают
-- триггеры неизменяемых журналов (и проверки внешних ключей), поэтому
-- функция сама проходит по ВСЕМ внешним ключам базы от удаляемых строк до
-- неподвижной точки: зависимые строки удаляются (cascade/restrict/no action)
-- или обнуляются (set null/default) — как сделала бы база, но без запретов
-- журналов.
--
-- Отказ всей транзакции (ничего не удалено), если:
--   * заявка не готова (срок, legal hold, платный архив);
--   * остались файлы проектов в хранилище;
--   * под удаление попала строка чужого проекта или организации (дизайнер
--     работал в чужой студии) — решает оператор отдельно;
--   * после удаления в базе остался uuid дизайнера или его проектов в любом
--     столбце uuid (вне удалённого).
-- Повторный вызов после уничтожения ничего не делает.
create function public.purge_designer_account(p_designer_id uuid, p_operator text)
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
  v_files jsonb;
  v_fk record;
  v_col record;
  v_child_cols text;
  v_parent_cols text;
  v_set text;
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
  v_projects := public._account_purge_project_ids(p_designer_id);
  v_files := public.account_purge_storage_objects(p_designer_id);
  if jsonb_array_length(v_files) > 0 then
    raise exception using errcode = '55000',
      message = 'ACCOUNT_PURGE_FILES_REMAIN:' || jsonb_array_length(v_files)::text;
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

  -- Внешние ключи до неподвижной точки.
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
             string_agg(pg_catalog.format('r.row_data->%L', pa.attname), ', ' order by k.ord),
             string_agg(pg_catalog.format('%I = %s', ca.attname,
               case when v_fk.confdeltype = 'd' then 'default' else 'null' end), ', ' order by k.ord)
      into v_child_cols, v_parent_cols, v_set
      from unnest(v_fk.conkey, v_fk.confkey) with ordinality as k(ckey, pkey, ord)
      join pg_catalog.pg_attribute ca on ca.attrelid = v_fk.child and ca.attnum = k.ckey
      join pg_catalog.pg_attribute pa on pa.attrelid = v_fk.parent and pa.attnum = k.pkey;

      if v_fk.confdeltype in ('n', 'd') then
        execute pg_catalog.format(
          'update %s t set %s where (%s) in (select %s from pg_temp.account_purge_rows r where r.rel = %L::regclass)',
          v_fk.child, v_set, v_child_cols, v_parent_cols, v_fk.parent);
      else
        execute pg_catalog.format(
          'with d as (delete from %s t where (%s) in (select %s from pg_temp.account_purge_rows r where r.rel = %L::regclass) returning t.*) '
          'insert into pg_temp.account_purge_rows select %L::regclass, to_jsonb(d) from d',
          v_fk.child, v_child_cols, v_parent_cols, v_fk.parent, v_fk.child);
      end if;
      get diagnostics v_count = row_count;
      v_changed := v_changed + v_count;
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
           where o.rel::text = 'project_intelligence.organizations'))
     or (r.row_data ? 'workflow_id' and r.row_data->>'workflow_id' is not null
         and r.row_data->>'workflow_id' not in (
           select w.row_data->>'id' from pg_temp.account_purge_rows w
           where w.rel::text = 'project_intelligence.project_workflows'));
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
  if cardinality(v_residual) > 0 then
    raise exception using errcode = '55000',
      message = 'ACCOUNT_PURGE_RESIDUAL_REFERENCES:' || array_to_string(v_residual, ', ');
  end if;

  select coalesce(jsonb_object_agg(x.rel, x.n), '{}'::jsonb) into v_counts
  from (select r.rel::text as rel, count(*) as n from pg_temp.account_purge_rows r group by r.rel) x;
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

do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public._account_purge_project_ids(uuid)',
    'public.account_purge_storage_objects(uuid)',
    'public.purge_designer_account(uuid, text)'
  ] loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_signature);
  end loop;
end
$grants$;

-- Список файлов — скрипту оператора (service role, Storage API).
grant execute on function public.account_purge_storage_objects(uuid) to service_role;

-- Как в 20260928155000 и DB4 88: ни одна функция pi_table_owner с SECURITY
-- DEFINER не обращается к схеме auth (на Supabase у владельца нет к ней доступа).
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
