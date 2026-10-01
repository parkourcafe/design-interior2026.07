-- Правки после независимого ревью DEC-047 (20260928158000), 01.10.2026.
--
--   * Пробный прогон (p_dry_run): все проверки уничтожения, кроме файлов, и
--     откат исключением. Скрипт оператора делает его ДО удаления файлов —
--     иначе отказ базы (чужие записи) наступал после того, как файлы уже
--     удалены.
--   * Ключи set null/default больше не обнуляются: строка, пережившая
--     удаление и ссылающаяся на удалённое (участие дизайнера в чужой студии
--     с его почтой, участник чужой комнаты), — отказ FOREIGN_RECORDS.
--   * Файлы проверяются прямо в storage.objects, а не через функцию списка
--     для скрипта (у неё другой владелец и права).
--   * Остатки id ищутся и в строковых столбцах схемы auth.
--   * Убрана проверка workflow_id (такого столбца нет).

begin;

drop function public.purge_designer_account(uuid, text);

create function public.purge_designer_account(p_designer_id uuid, p_operator text, p_dry_run boolean default false)
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

revoke all on function public.purge_designer_account(uuid, text, boolean)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

commit;
