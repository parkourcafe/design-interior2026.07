\set ON_ERROR_STOP on

-- Воркерный контур ingest_source_graph (`20260825040000`, M3 backlog #5):
-- очередь отдаёт ровно то, чего нет в графе; системная дверь синтезирует
-- граф из инвентаря и исполняет от имени зарегистрировавшего; durable-отказы
-- по DEC-036; после ингеста источник становится доступен ревью — ровно тот
-- разрыв, который сценарий 37 фиксировал как «инвентарь без графа».
--
-- Фикстура — из 37: materialized-запись 'db4-inventory-only.pdf'
-- (checksum d×64 → logical_source_id 'source-sha256-' || d×24,
-- sourceRevisionId 'db4-inventory-only-revision', автор 3111).

-- 1. Прикладным ролям контур закрыт; redrive закрыт всем.
do $ingest_worker_boundaries$
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
    raise exception 'DB4_INGEST_WORKER_LEAKED:%', v_leaked;
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
    raise exception 'DB4_INGEST_REDRIVE_REACHABLE:%', v_leaked;
  end if;
end
$ingest_worker_boundaries$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $ingest_worker_denied_live$
begin
  begin
    perform projectceo_api.list_source_ingest_backlog(10);
    raise exception 'DB4_INGEST_BACKLOG_REACHED_BY_AUTHENTICATED';
  exception when insufficient_privilege then null;
  end;
end
$ingest_worker_denied_live$;
rollback;

-- 2. Очередь: ровно инвентарь-без-графа, самосогласованно, без PII.
-- RPC зовётся под service_role, проверки против приватных таблиц — от имени
-- суперпользователя: у service_role нет usage на приватные схемы.
begin;
set local role service_role;
select projectceo_api.list_source_ingest_backlog(100) as backlog_envelope
\gset db4_
rollback;

select set_config('db4.backlog_envelope', :'db4_backlog_envelope', false);

do $backlog_contents$
declare
  v_envelope jsonb;
  v_rows jsonb;
  v_target jsonb;
  v_text text;
begin
  v_envelope := current_setting('db4.backlog_envelope')::jsonb;
  if v_envelope->>'contractVersion' <> 'project-ceo-ingest-worker/0.1' then
    raise exception 'DB4_INGEST_BACKLOG_CONTRACT_WRONG';
  end if;
  v_rows := v_envelope->'data';

  select row_value into v_target
  from jsonb_array_elements(v_rows) row_value
  where row_value->>'logicalSourceId' = 'source-sha256-' || repeat('d', 24);
  if v_target is null then
    raise exception 'DB4_INGEST_BACKLOG_MISSING_PENDING_ROW';
  end if;
  if v_target->>'sourceRevisionId' <> 'db4-inventory-only-revision'
    or v_target->>'projectId' <> '41111111-1111-4111-8111-111111111111'
    or v_target->>'packageId' <> '41111111-1111-4111-8111-111111111111' then
    raise exception 'DB4_INGEST_BACKLOG_ROW_WRONG:%', v_target;
  end if;
  if (v_target->>'stateRevision')::bigint <> (
    select workflow.state_revision
    from project_intelligence.project_workflows workflow
    where workflow.project_id = '41111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'DB4_INGEST_BACKLOG_STATE_STALE';
  end if;

  -- Самосогласованность: ни одна строка очереди не лежит в графе.
  if exists (
    select 1
    from jsonb_array_elements(v_rows) row_value
    join project_intelligence.sources source
      on source.source_id = row_value->>'logicalSourceId'
     and source.project_id = (row_value->>'projectId')::uuid
  ) then
    raise exception 'DB4_INGEST_BACKLOG_ROW_ALREADY_IN_GRAPH';
  end if;

  -- DTO: ни имён (даже санированных), ни ключей планировки.
  v_text := v_rows::text;
  if v_text like '%sanitizedName%'
    or v_text like '%db4-inventory-only.pdf%'
    or v_text like '%floor%'
    or v_text like '%zone%' then
    raise exception 'DB4_INGEST_BACKLOG_DTO_LEAK';
  end if;

end
$backlog_contents$;

-- Лимиты — как у очереди артефактов.
begin;
set local role service_role;
do $backlog_limits$
begin
  begin
    perform projectceo_api.list_source_ingest_backlog(0);
    raise exception 'DB4_INGEST_BACKLOG_LIMIT_ZERO_ACCEPTED';
  exception when sqlstate 'P1111' then null;
  end;
  begin
    perform projectceo_api.list_source_ingest_backlog(5000);
    raise exception 'DB4_INGEST_BACKLOG_LIMIT_HUGE_ACCEPTED';
  exception when sqlstate 'P1111' then null;
  end;
end
$backlog_limits$;
rollback;

-- 3. Durable-отказы: transient → бэкофф прячет строку; до max_attempts →
-- dead_letter; redrive возвращает; permanent → dead_letter сразу.
begin;
set local role service_role;
do $failure_contour$
declare
  v_logical text := 'source-sha256-' || repeat('d', 24);
  v_report jsonb;
  v_rows jsonb;
  i int;
begin
  v_report := projectceo_api.record_source_ingest_worker_failure(
    '41111111-1111-4111-8111-111111111111', v_logical,
    'transient', 'internal_error', '{"probe":1}'::jsonb
  );
  if v_report->>'status' <> 'retrying' then
    raise exception 'DB4_INGEST_FAILURE_FIRST_NOT_RETRYING:%', v_report;
  end if;

  v_rows := projectceo_api.list_source_ingest_backlog(100)->'data';
  if exists (
    select 1 from jsonb_array_elements(v_rows) row_value
    where row_value->>'logicalSourceId' = v_logical
  ) then
    raise exception 'DB4_INGEST_BACKLOG_SHOWS_BACKED_OFF_ROW';
  end if;

  for i in 1..4 loop
    v_report := projectceo_api.record_source_ingest_worker_failure(
      '41111111-1111-4111-8111-111111111111', v_logical,
      'transient', 'internal_error', null
    );
  end loop;
  if v_report->>'status' <> 'dead_letter' then
    raise exception 'DB4_INGEST_FAILURE_NOT_DEAD_LETTERED:%', v_report;
  end if;

  -- Permanent — dead_letter с первой записи, на отдельном ключе.
  v_report := projectceo_api.record_source_ingest_worker_failure(
    '41111111-1111-4111-8111-111111111111', 'source-sha256-poison-probe',
    'permanent', 'not_found', null
  );
  if v_report->>'status' <> 'dead_letter'
    or v_report->>'deadLetteredAt' is null then
    raise exception 'DB4_INGEST_PERMANENT_NOT_IMMEDIATE:%', v_report;
  end if;
end
$failure_contour$;
commit;

-- Redrive — только прямым доступом к базе.
do $redrive$
declare
  v_report jsonb;
begin
  v_report := projectceo_foundation.redrive_source_ingest_worker_failure(
    '41111111-1111-4111-8111-111111111111',
    'source-sha256-' || repeat('d', 24),
    'DB4 harness', 'сценарий 52: возврат строки после разбора'
  );
  if v_report->>'status' <> 'retrying' then
    raise exception 'DB4_INGEST_REDRIVE_FAILED:%', v_report;
  end if;

  -- Повторный redrive той же строки — она уже не dead_letter.
  begin
    perform projectceo_foundation.redrive_source_ingest_worker_failure(
      '41111111-1111-4111-8111-111111111111',
      'source-sha256-' || repeat('d', 24),
      'DB4 harness', 'повтор'
    );
    raise exception 'DB4_INGEST_REDRIVE_REPEATED';
  exception when sqlstate 'P1104' then null;
  end;
end
$redrive$;

-- 4. Системный ингест: граф синтезирован сервером, автор — регистрировавший,
-- очередь пустеет, след отказов стёрт.
select workflow.state_revision as ingest_state
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select set_config('db4.ingest_state', :'db4_ingest_state', false);

begin;
set local role service_role;
select projectceo_api.ingest_source_graph_system(
  '41111111-1111-4111-8111-111111111111',
  'source-sha256-' || repeat('d', 24),
  :'db4_ingest_state'::bigint,
  'db4-ingest-worker-1'
) as envelope
\gset db4_ingest_
commit;

select set_config('db4.ingest_envelope', :'db4_ingest_envelope', false);

do $system_ingest_succeeded$
declare
  v_envelope jsonb := current_setting('db4.ingest_envelope')::jsonb;
  v_logical text := 'source-sha256-' || repeat('d', 24);
begin
  if (v_envelope->>'replay')::boolean then
    raise exception 'DB4_INGEST_FIRST_CALL_REPLAYED';
  end if;
  if v_envelope#>>'{result,sourceRevisionId}' <> 'db4-inventory-only-revision' then
    raise exception 'DB4_INGEST_RESULT_WRONG:%', v_envelope#>'{result}';
  end if;

  if not exists (
    select 1
    from project_intelligence.sources source
    where source.project_id = '41111111-1111-4111-8111-111111111111'
      and source.source_id = v_logical
      and source.kind = 'pdf'
      and source.checksum = decode(repeat('d', 64), 'hex')
  ) then
    raise exception 'DB4_INGEST_SOURCE_ROW_MISSING';
  end if;
  if not exists (
    select 1
    from project_intelligence.graph_nodes node
    where node.project_id = '41111111-1111-4111-8111-111111111111'
      and node.node_id = 'node:' || v_logical
      and node.kind = 'source'
      and node.current_revision_id = 'db4-inventory-only-revision'
  ) then
    raise exception 'DB4_INGEST_GRAPH_NODE_MISSING';
  end if;
  if not exists (
    select 1
    from projectceo_foundation.source_ingestions ingestion
    where ingestion.project_id = '41111111-1111-4111-8111-111111111111'
      and ingestion.source_id = v_logical
      and ingestion.actor_user_id = '31111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'DB4_INGEST_LEDGER_ACTOR_WRONG';
  end if;
  -- Провенанс системы: ревизия origin='import' записана как system.
  if not exists (
    select 1
    from project_intelligence.graph_node_revisions revision
    where revision.project_id = '41111111-1111-4111-8111-111111111111'
      and revision.revision_id = 'db4-inventory-only-revision'
      and revision.created_by_type = 'system'
      and revision.created_by_id = 'system:projectceo-ingestion'
  ) then
    raise exception 'DB4_INGEST_SYSTEM_PROVENANCE_MISSING';
  end if;
  -- След отказов стёрт успехом.
  if exists (
    select 1
    from projectceo_foundation.source_ingest_worker_failures failure
    where failure.project_id = '41111111-1111-4111-8111-111111111111'
      and failure.logical_source_id = v_logical
  ) then
    raise exception 'DB4_INGEST_FAILURE_TRACE_SURVIVED_SUCCESS';
  end if;
end
$system_ingest_succeeded$;

-- Очередь больше не предлагает ингестированное.
begin;
set local role service_role;
do $backlog_drained$
begin
  if exists (
    select 1
    from jsonb_array_elements(
      projectceo_api.list_source_ingest_backlog(100)->'data'
    ) row_value
    where row_value->>'logicalSourceId' = 'source-sha256-' || repeat('d', 24)
  ) then
    raise exception 'DB4_INGEST_BACKLOG_STILL_OFFERS_INGESTED';
  end if;
end
$backlog_drained$;
rollback;

-- 5. Повтор того же ключа — реплей; новый ключ по той же строке — P1109.
select workflow.state_revision as dup_state
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select set_config('db4.dup_state', :'db4_dup_state', false);

begin;
set local role service_role;
do $ingest_replay_and_duplicate$
declare
  v_envelope jsonb;
begin
  v_envelope := projectceo_api.ingest_source_graph_system(
    '41111111-1111-4111-8111-111111111111',
    'source-sha256-' || repeat('d', 24),
    current_setting('db4.ingest_state')::bigint,
    'db4-ingest-worker-1'
  );
  if not (v_envelope->>'replay')::boolean then
    raise exception 'DB4_INGEST_REPLAY_NOT_MARKED';
  end if;

  begin
    perform projectceo_api.ingest_source_graph_system(
      '41111111-1111-4111-8111-111111111111',
      'source-sha256-' || repeat('d', 24),
      current_setting('db4.dup_state')::bigint,
      'db4-ingest-worker-1-new-key'
    );
    raise exception 'DB4_INGEST_DUPLICATE_ACCEPTED';
  exception when sqlstate 'P1109' then null;
  end;
end
$ingest_replay_and_duplicate$;
rollback;

-- 6. Разрыв 37 закрыт: v8 теперь предлагает ревью, и ревью проходит.
select workflow.state_revision as review_state
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select set_config('db4.review_state', :'db4_review_state', false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $review_now_possible$
declare
  v_read jsonb;
  v_target text;
begin
  v_read := projectceo_read_api.get_project_workspace_read_v8(
    '41111111-1111-4111-8111-111111111111', null
  );
  select source_row->>'reviewTargetRevisionId' into v_target
  from jsonb_array_elements(v_read#>'{data,sources}') source_row
  where source_row->>'sourceRevisionId' = 'db4-inventory-only-revision';
  if v_target is distinct from 'db4-inventory-only-revision' then
    raise exception 'DB4_INGEST_REVIEW_TARGET_STILL_MISSING:%',
      coalesce(v_target, 'null');
  end if;

  perform projectceo_api.review_source(
    '41111111-1111-4111-8111-111111111111',
    'db4-inventory-only-revision',
    'db4-inventory-only-revision',
    current_setting('db4.review_state')::bigint,
    'confirmed',
    'db4-ingest-worker-review'
  );
end
$review_now_possible$;
commit;

do $review_recorded$
begin
  if not exists (
    select 1
    from project_intelligence.human_reviews review
    where review.project_id = '41111111-1111-4111-8111-111111111111'
      and review.target_revision_id = 'db4-inventory-only-revision'
      and review.decision = 'confirmed'
  ) then
    raise exception 'DB4_INGEST_REVIEW_NOT_RECORDED';
  end if;
end
$review_recorded$;

select 'DB4_SOURCE_INGEST_WORKER_OK' as result;
