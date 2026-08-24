-- Воркерный контур ingest_source_graph (M3 backlog #5): источники попадают в
-- граф утверждений системой, а не остаются навсегда «инвентарём без графа».
--
-- ЧТО БЫЛО. `projectceo_api.ingest_source_graph` — человеческая дверь
-- (авторизация по claims, грант только `authenticated`), и звали её только
-- фикстуры AP5/AP1. Зарегистрированный через `register_source_inventory`
-- источник сам в граф не попадал, ревью источника было невозможно
-- (`human_reviews` требует ревизию в графе), а `sourceRevisionIds` в
-- composition/token/hash оставались пустыми навсегда.
--
-- ЧТО СТРОИТСЯ — по образцу воркеров release-artifact (`20260811030000`) и
-- change-impact (`20260812010000` + DEC-036 `20260813030000`):
--   1. читающая очередь `list_source_ingest_backlog` (service_role);
--   2. системная дверь `ingest_source_graph_system` (service_role):
--      ВЕСЬ граф синтезируется сервером из строки инвентаря — воркер не
--      передаёт ни байта содержимого, ему нечего подделать;
--   3. durable-контур отказов: леджер, дверь записи, операторский redrive,
--      бэкофф, dead-letter, исчезновение ядовитой строки из очереди —
--      тотальность `calculateOne` (DEC-036).
--
-- ИДЕНТИЧНОСТЬ СИСТЕМНОГО INGEST. `_ingest_source_graph_v1` авторизуется по
-- request-claims и пишет `source_ingestions.actor_user_id NOT NULL` (FK на
-- членство). Системная дверь исполняет отложенное действие ЧЕЛОВЕКА,
-- зарегистрировавшего источник: она выставляет транзакционно-локальный
-- request-claim sub = `registered_by_user_id` строки инвентаря и зовёт
-- публичную человеческую дверь со всеми её проверками. Это не произвольная
-- имперсонация: пользователь выводится СЕРВЕРОМ из строки инвентаря, вызвать
-- дверь может только service_role, а действие ограничено ровно «довести до
-- графа то, что этот человек уже зарегистрировал». Провенанс системы при
-- этом не теряется: ревизии origin='import' получают
-- created_by_id='system:projectceo-ingestion' (v1). Если автор больше не
-- активный участник с register_source — P1103, воркер уводит строку в
-- dead-letter: источник без действующего автора требует оператора.
--
-- НАЗВАННОЕ ОГРАНИЧЕНИЕ (до DEC-026, этап 3b.1). Инвентарь не хранит ни
-- media type, ни роль загрузки: расширение выводится из sanitized_name,
-- канонический media type — из расширения, роль фиксирована 'document'.
-- Если фактическая загрузка шла с другой ролью, `storage_object_path`
-- источника разойдётся с реальным путём байтов. Скачивания это не ломает —
-- его контура ещё нет; серверные файловые записи DEC-026 закроют это поле
-- фактом, а не выводом. Нерасшифруемое расширение — P1110, воркер честно
-- уводит строку в dead-letter, а не пропускает молча.

begin;

set local check_function_bodies = on;

-- 1. Durable-леджер отказов — зеркало impact_worker_failures (DEC-036).
create table projectceo_foundation.source_ingest_worker_failures (
  organization_id uuid not null,
  project_id uuid not null,
  logical_source_id text not null check (
    char_length(btrim(logical_source_id)) between 1 and 160
    and logical_source_id = btrim(logical_source_id)
  ),
  attempt_count bigint not null default 1
    check (attempt_count between 1 and 9007199254740991),
  max_attempts bigint not null default 5
    check (max_attempts between 1 and 100),
  status text not null check (status in ('retrying', 'dead_letter')),
  failure_kind text not null check (failure_kind in ('transient', 'permanent')),
  error_code text not null check (
    char_length(btrim(error_code)) between 1 and 200
  ),
  error_detail jsonb,
  first_attempted_at timestamptz not null default clock_timestamp(),
  last_attempted_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz,
  dead_lettered_at timestamptz,
  redriven_at timestamptz,
  redriven_by text,
  redrive_reason text,
  primary key (organization_id, project_id, logical_source_id),
  constraint source_ingest_worker_failures_status_shape_check check (
    (
      status = 'retrying'
      and next_attempt_at is not null
      and dead_lettered_at is null
    )
    or (
      status = 'dead_letter'
      and next_attempt_at is null
      and dead_lettered_at is not null
    )
  )
);

alter table projectceo_foundation.source_ingest_worker_failures
  owner to pi_table_owner;
alter table projectceo_foundation.source_ingest_worker_failures
  enable row level security;
alter table projectceo_foundation.source_ingest_worker_failures
  force row level security;
revoke all on table projectceo_foundation.source_ingest_worker_failures
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy source_ingest_worker_failures_internal_owner
  on projectceo_foundation.source_ingest_worker_failures
  for all to pi_table_owner using (true) with check (true);

-- 2. Дверь записи отказа. Параметры с префиксом p_ — `#variable_conflict
-- use_variable` переписал бы список колонок `on conflict` в значения
-- параметров (урок `20260813030000`).
create function projectceo_api.record_source_ingest_worker_failure(
  p_project_id uuid,
  p_logical_source_id text,
  p_failure_kind text,
  p_error_code text,
  p_error_detail jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_organization_id uuid;
  v_row projectceo_foundation.source_ingest_worker_failures%rowtype;
begin
  if p_failure_kind not in ('transient', 'permanent') then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"failureKind"}'::jsonb
    );
  end if;
  if p_logical_source_id is null
     or btrim(p_logical_source_id) = ''
     or p_error_code is null
     or btrim(p_error_code) = '' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"INGEST_FAILURE_RECORD_INVALID"}'::jsonb
    );
  end if;

  v_organization_id := projectceo_product._system_context(p_project_id);

  insert into projectceo_foundation.source_ingest_worker_failures as failure (
    organization_id,
    project_id,
    logical_source_id,
    attempt_count,
    status,
    failure_kind,
    error_code,
    error_detail,
    next_attempt_at,
    dead_lettered_at
  )
  values (
    v_organization_id,
    p_project_id,
    btrim(p_logical_source_id),
    1,
    case when p_failure_kind = 'permanent' then 'dead_letter' else 'retrying' end,
    p_failure_kind,
    btrim(p_error_code),
    p_error_detail,
    case when p_failure_kind = 'permanent'
      then null
      else clock_timestamp() + interval '2 seconds'
    end,
    case when p_failure_kind = 'permanent' then clock_timestamp() else null end
  )
  on conflict (organization_id, project_id, logical_source_id)
  do update set
    attempt_count = failure.attempt_count + 1,
    failure_kind = excluded.failure_kind,
    error_code = excluded.error_code,
    error_detail = excluded.error_detail,
    last_attempted_at = clock_timestamp(),
    status = case
      when excluded.failure_kind = 'permanent'
        or failure.attempt_count + 1 >= failure.max_attempts
      then 'dead_letter'
      else 'retrying'
    end,
    next_attempt_at = case
      when excluded.failure_kind = 'permanent'
        or failure.attempt_count + 1 >= failure.max_attempts
      then null
      else clock_timestamp() + least(
        power(2, failure.attempt_count + 1) * interval '1 second',
        interval '5 minutes'
      )
    end,
    dead_lettered_at = case
      when excluded.failure_kind = 'permanent'
        or failure.attempt_count + 1 >= failure.max_attempts
      then clock_timestamp()
      else null
    end,
    redriven_at = null,
    redriven_by = null,
    redrive_reason = null
  returning * into v_row;

  return jsonb_build_object(
    'status', v_row.status,
    'attemptCount', v_row.attempt_count,
    'maxAttempts', v_row.max_attempts,
    'nextAttemptAt', v_row.next_attempt_at,
    'deadLetteredAt', v_row.dead_lettered_at
  );
end
$function$;

alter function projectceo_api.record_source_ingest_worker_failure(
  uuid, text, text, text, jsonb
) owner to pi_table_owner;
revoke all on function projectceo_api.record_source_ingest_worker_failure(
  uuid, text, text, text, jsonb
) from public, anon, authenticated, service_role,
     pi_human_executor, pi_worker_executor;
grant execute on function projectceo_api.record_source_ingest_worker_failure(
  uuid, text, text, text, jsonb
) to service_role;

-- 3. Операторский redrive — только прямой доступ к базе, как у DEC-036.
create function projectceo_foundation.redrive_source_ingest_worker_failure(
  p_project_id uuid,
  p_logical_source_id text,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_row projectceo_foundation.source_ingest_worker_failures%rowtype;
begin
  if p_actor is null or btrim(p_actor) = ''
     or p_reason is null or btrim(p_reason) = '' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"REDRIVE_ACTOR_AND_REASON_REQUIRED"}'::jsonb
    );
  end if;

  update projectceo_foundation.source_ingest_worker_failures failure
  set status = 'retrying',
      next_attempt_at = clock_timestamp(),
      dead_lettered_at = null,
      attempt_count = 1,
      redriven_at = clock_timestamp(),
      redriven_by = btrim(p_actor),
      redrive_reason = btrim(p_reason)
  where failure.project_id = p_project_id
    and failure.logical_source_id = btrim(p_logical_source_id)
    and failure.status = 'dead_letter'
  returning * into v_row;

  if v_row.logical_source_id is null then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"deadLetteredIngestFailure"}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'status', v_row.status,
    'attemptCount', v_row.attempt_count,
    'redrivenAt', v_row.redriven_at
  );
end
$function$;

alter function projectceo_foundation.redrive_source_ingest_worker_failure(
  uuid, text, text, text
) owner to pi_table_owner;
revoke all on function projectceo_foundation.redrive_source_ingest_worker_failure(
  uuid, text, text, text
) from public, anon, authenticated, service_role,
     pi_human_executor, pi_worker_executor;

-- 4. Очередь: materialized-строки инвентаря, которых ещё нет в графе,
-- минус dead-letter и не подошедший бэкофф. DTO минимален: идентификаторы и
-- state revision, ни sanitized_name, ни ключей планировки — воркеру для
-- вызова системной двери больше ничего не нужно, а лог воркера не должен
-- видеть даже санированных имён.
create function projectceo_api.list_source_ingest_backlog(
  max_rows integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_rows jsonb;
begin
  if max_rows is null or max_rows < 1 or max_rows > 1000 then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"INGEST_BACKLOG_LIMIT_INVALID"}'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'organizationId', pending.organization_id,
    'projectId', pending.project_id,
    'packageId', pending.package_id,
    'logicalSourceId', pending.logical_source_id,
    'sourceRevisionId', pending.source_revision_id,
    'stateRevision', pending.state_revision
  ) order by
      pending.organization_id::text collate "C",
      pending.project_id::text collate "C",
      pending.logical_source_id collate "C"
  ), '[]'::jsonb)
  into v_rows
  from (
    select
      inventory.organization_id,
      inventory.project_id,
      inventory.package_id,
      inventory.logical_source_id,
      inventory.source_revision_id,
      workflow.state_revision
    from projectceo_foundation.source_inventory_records inventory
    join project_intelligence.project_workflows workflow
      on workflow.organization_id = inventory.organization_id
     and workflow.project_id = inventory.project_id
    where inventory.availability = 'materialized'
      and inventory.logical_source_id is not null
      and not exists (
        select 1
        from project_intelligence.sources source
        where source.organization_id = inventory.organization_id
          and source.project_id = inventory.project_id
          and source.source_id = inventory.logical_source_id
      )
      and not exists (
        select 1
        from projectceo_foundation.source_ingest_worker_failures failure
        where failure.organization_id = inventory.organization_id
          and failure.project_id = inventory.project_id
          and failure.logical_source_id = inventory.logical_source_id
          and (
            failure.status = 'dead_letter'
            or failure.next_attempt_at > clock_timestamp()
          )
      )
    limit max_rows
  ) pending;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-ingest-worker/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_rows,
    'error', null
  );
end
$function$;

alter function projectceo_api.list_source_ingest_backlog(integer)
  owner to pi_table_owner;
revoke all on function projectceo_api.list_source_ingest_backlog(integer)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
grant execute on function projectceo_api.list_source_ingest_backlog(integer)
  to service_role;

-- 5. Системная дверь: граф синтезируется из инвентаря целиком на сервере.
create function projectceo_api.ingest_source_graph_system(
  project_id uuid,
  logical_source_id text,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_inventory projectceo_foundation.source_inventory_records%rowtype;
  v_extension text;
  v_media_type text;
  v_kind text;
  v_node_id text;
  v_payload jsonb;
  v_source jsonb;
  v_nodes jsonb;
  v_revisions jsonb;
  v_result jsonb;
begin
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  if logical_source_id is null or btrim(logical_source_id) = '' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"logicalSourceId"}'::jsonb
    );
  end if;

  v_organization_id := projectceo_product._system_context(project_id);

  select * into v_inventory
  from projectceo_foundation.source_inventory_records inventory
  where inventory.organization_id = v_organization_id
    and inventory.project_id = project_id
    and inventory.logical_source_id = btrim(logical_source_id)
  order by inventory.registered_at
  limit 1;
  if v_inventory.logical_source_id is null then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"sourceInventoryRecord"}'::jsonb
    );
  end if;
  if v_inventory.availability <> 'materialized' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"INGEST_SOURCE_NOT_MATERIALIZED"}'::jsonb
    );
  end if;

  -- Расширение — из санированного имени; канонический media type — из
  -- расширения. Пары повторяют allowlist `_source_policy`; нераспознанное
  -- расширение — честный P1110, а не догадка.
  v_extension := lower(nullif(
    regexp_replace(v_inventory.sanitized_name, '^.*\.', ''),
    v_inventory.sanitized_name
  ));
  v_media_type := case v_extension
    when 'pdf' then 'application/pdf'
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png'
    when 'webp' then 'image/webp'
    when 'csv' then 'text/csv'
    when 'xlsx' then
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'eml' then 'message/rfc822'
    when 'mp3' then 'audio/mpeg'
    when 'm4a' then 'audio/mp4'
    when 'wav' then 'audio/wav'
    when 'txt' then 'text/plain'
    when 'json' then 'application/json'
    else null
  end;
  if v_media_type is null then
    perform projectceo_foundation._raise(
      'P1110',
      'unsupported_source',
      '{"reason":"SOURCE_EXTENSION_UNDERIVABLE"}'::jsonb
    );
  end if;
  v_kind := projectceo_foundation._source_kind_for(v_media_type, v_extension);

  v_node_id := 'node:' || v_inventory.logical_source_id;
  v_payload := jsonb_build_object(
    'schemaVersion', 'project-ceo/source-metadata/0.1',
    'sourceId', v_inventory.logical_source_id
  );

  v_source := jsonb_build_object(
    'sourceId', v_inventory.logical_source_id,
    'sourceRevisionId', v_inventory.source_revision_id,
    'kind', v_kind,
    'checksumHex', encode(v_inventory.checksum, 'hex'),
    'packageId', v_inventory.package_id,
    'metadata', jsonb_build_object(
      'originalFilename', v_inventory.sanitized_name,
      'mediaType', v_media_type,
      'sizeBytes', v_inventory.size_bytes,
      'extension', v_extension,
      'sourceRole', 'document',
      'declaredRevision', null,
      'documentStatus', v_inventory.document_status
    )
  );
  v_nodes := jsonb_build_array(jsonb_build_object(
    'nodeId', v_node_id,
    'kind', 'source',
    'stableKey', v_inventory.logical_source_id,
    'currentRevisionId', v_inventory.source_revision_id
  ));
  v_revisions := jsonb_build_array(jsonb_build_object(
    'revisionId', v_inventory.source_revision_id,
    'nodeId', v_node_id,
    'revisionNo', 1,
    'title', v_inventory.sanitized_name,
    'payload', v_payload,
    'origin', 'import',
    'claimStatus', 'extracted',
    'unknownReason', null,
    'replacesRevisionId', null,
    'contentDigestHex',
      encode(project_intelligence._sha256_jsonb(v_payload), 'hex')
  ));

  -- Исполнение от имени зарегистрировавшего автора: транзакционно-локальный
  -- claim, обоснование — в шапке миграции. Человеческая дверь дальше делает
  -- все свои проверки (binding, policy, идемпотентность, staleness) сама.
  perform set_config(
    'request.jwt.claim.sub',
    v_inventory.registered_by_user_id::text,
    true
  );

  v_result := projectceo_api.ingest_source_graph(
    project_id,
    v_source,
    '[]'::jsonb,
    v_nodes,
    v_revisions,
    '[]'::jsonb,
    '[]'::jsonb,
    expected_state_revision,
    idempotency_key
  );

  -- Успех стирает след отказов — как у change-impact (DEC-036).
  delete from projectceo_foundation.source_ingest_worker_failures failure
  where failure.organization_id = v_organization_id
    and failure.project_id = project_id
    and failure.logical_source_id = v_inventory.logical_source_id;

  return v_result;
end
$function$;

alter function projectceo_api.ingest_source_graph_system(
  uuid, text, bigint, text
) owner to pi_table_owner;
revoke all on function projectceo_api.ingest_source_graph_system(
  uuid, text, bigint, text
) from public, anon, authenticated, service_role,
     pi_human_executor, pi_worker_executor;
grant execute on function projectceo_api.ingest_source_graph_system(
  uuid, text, bigint, text
) to service_role;

-- Guard: границы контура выставлены ровно так, как заявлено.
do $guard$
declare
  v_leaked text;
begin
  select format('%s:%s', role_name, signature) into v_leaked
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_api.list_source_ingest_backlog(integer)',
    'projectceo_api.ingest_source_graph_system(uuid, text, bigint, text)',
    'projectceo_api.record_source_ingest_worker_failure(uuid, text, text, text, jsonb)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_INGEST_WORKER_LEAKED:%', v_leaked;
  end if;

  select signature into v_leaked
  from unnest(array[
    'projectceo_api.list_source_ingest_backlog(integer)',
    'projectceo_api.ingest_source_graph_system(uuid, text, bigint, text)',
    'projectceo_api.record_source_ingest_worker_failure(uuid, text, text, text, jsonb)'
  ]) signature
  where not pg_catalog.has_function_privilege(
    'service_role', signature, 'EXECUTE'
  )
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_INGEST_WORKER_UNREACHABLE:%', v_leaked;
  end if;

  select role_name into v_leaked
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  where pg_catalog.has_function_privilege(
    role_name,
    'projectceo_foundation.redrive_source_ingest_worker_failure(uuid, text, text, text)',
    'EXECUTE'
  )
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_INGEST_REDRIVE_REACHABLE:%', v_leaked;
  end if;

  -- Человеческая дверь не расширилась и не сузилась.
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_api.ingest_source_graph(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_HUMAN_INGEST_LOST_GRANT';
  end if;
  if pg_catalog.has_function_privilege(
    'service_role',
    'projectceo_api.ingest_source_graph(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_HUMAN_INGEST_WIDENED_TO_SERVICE';
  end if;

  -- Форма леджера отказов защищена CHECK'ом, а не договорённостью.
  begin
    insert into projectceo_foundation.source_ingest_worker_failures (
      organization_id, project_id, logical_source_id,
      status, failure_kind, error_code, next_attempt_at, dead_lettered_at
    )
    values (
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000001',
      'guard-shape-probe',
      'retrying', 'transient', 'GUARD', null, null
    );
    raise exception 'PROJECTCEO_INGEST_FAILURE_SHAPE_UNGUARDED';
  exception
    when check_violation then null;
  end;
end
$guard$;

commit;
