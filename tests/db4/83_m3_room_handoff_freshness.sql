\set ON_ERROR_STOP on

-- DB4: DEC-041 §4 (миграция 20260928090000) — передача M2→M3 по комнатам с
-- точными ревизиями. Проект 41111111 после DB4 20–81: в корневом пакете есть
-- комнаты с утверждённым дизайном (db4-room из DB4 31 с засевом передачи в
-- DB4 51, cycle6-living-room с настоящей передачей из DB4 33) и фикстурные
-- передачи пакетов. Весь файл — одна транзакция с откатом.

begin;

create function pg_temp.rev()
returns bigint language sql as $function$
  select state_revision from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111'
$function$;

create function pg_temp.call_as(p_user uuid, p_sql text)
returns jsonb language plpgsql as $function$
declare
  v_result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', p_user::text, true);
  perform pg_catalog.set_config('role', 'authenticated', true);
  execute p_sql into v_result;
  perform pg_catalog.set_config('role', 'postgres', true);
  return v_result;
end
$function$;

create function pg_temp.publish(p_refs jsonb, p_key text)
returns jsonb language sql as $function$
  select pg_temp.call_as('31111111-1111-4111-8111-111111111111', pg_catalog.format(
    'select projectceo_product_api.publish_baseline_atomic(%L, %L, %L, %L::jsonb, %s, %L, %L)',
    '41111111-1111-4111-8111-111111111111',
    current_setting('db4.t83_latest_version'), current_setting('db4.t83_previous_baseline'),
    p_refs, current_setting('db4.t83_state_revision'), p_key, p_key))
$function$;

create function pg_temp.expect_publish_error(
  p_refs jsonb, p_state text, p_marker text, p_label text
)
returns void language plpgsql as $function$
declare
  v_state text;
  v_text text;
begin
  begin
    perform pg_temp.publish(p_refs, 'db4-83-' || p_label);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_text = pg_exception_detail;
    v_text := coalesce(v_text, '') || ' ' || sqlerrm;
    if v_state <> p_state or v_text not like '%' || p_marker || '%' then
      raise exception 'DB4_83_WRONG_FAILURE:%:%:%', p_label, v_state, v_text;
    end if;
    return;
  end;
  raise exception 'DB4_83_EXPECTED_FAILURE:%', p_label;
end
$function$;

-- Причина несвежести последней передачи db4-room (null — свежая).
create function pg_temp.db4_room_problem()
returns text language sql as $function$
  select projectceo_product._room_handoff_problem(
    revision.organization_id, revision.project_id, revision.package_id, revision)
  from projectceo_product.m2_workspace_revisions revision
  where revision.project_id = '41111111-1111-4111-8111-111111111111'
    and revision.entity_kind = 'm2_m3_handoff'
    and revision.entity_id = 'handoff-db4-room'
  order by revision.revision_no desc
  limit 1
$function$;

-- Копия утверждённого дизайна db4-room — как будто клиент утвердил новый
-- дизайн комнаты p_room (или той же комнаты).
-- Строка вставляется напрямую с выключенными триггерами (session_replication_role):
-- полную дверь утверждения дизайна доказывают DB4 31/33, здесь нужен только
-- факт «у комнаты есть более новый утверждённый дизайн».
create function pg_temp.copy_approved_commit(p_entity_id text, p_room text)
returns void language plpgsql as $function$
begin
  perform pg_catalog.set_config('session_replication_role', 'replica', true);
  insert into projectceo_product.m2_workspace_revisions
  select (jsonb_populate_record(
    null::projectceo_product.m2_workspace_revisions,
    to_jsonb(source) || jsonb_build_object(
      'entity_id', p_entity_id,
      'revision_id', extensions.gen_random_uuid()::text,
      'revision_no', 1,
      'supersedes_revision_id', null,
      'payload', source.payload || jsonb_build_object('roomId', p_room),
      'created_at', pg_catalog.clock_timestamp()
    )
  )).*
  from projectceo_product.m2_workspace_revisions source
  where source.project_id = '41111111-1111-4111-8111-111111111111'
    and source.entity_kind = 'approved_commit'
    and source.payload->>'roomId' = 'db4-room'
  order by source.created_at desc
  limit 1;
  perform pg_catalog.set_config('session_replication_role', 'origin', true);
end
$function$;

-- Чтение готовности (20260928091000) от имени владельца: проблема комнаты.
create function pg_temp.readiness_problem(p_room text)
returns text language sql as $function$
  select room->>'problem'
  from jsonb_array_elements(pg_temp.call_as('31111111-1111-4111-8111-111111111111',
    'select projectceo_read_api.get_m3_room_handoff_readiness(''41111111-1111-4111-8111-111111111111'')'
  )->'rooms') room
  where room->>'roomId' = p_room
    and room->>'packageId' = '41111111-1111-4111-8111-111111111111'
$function$;

-- Новая ревизия selection node-selection-db4 (черновик, не утверждена).
create function pg_temp.append_selection(
  p_revision_id text, p_key text, p_node text default 'node-selection-db4'
)
returns jsonb language sql as $function$
  select pg_temp.call_as('31111111-1111-4111-8111-111111111111', pg_catalog.format(
    'select projectceo_product_api.append_selection_revision(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L::jsonb, %L::jsonb, %L, %s, %L)',
    '41111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111',
    p_node, p_revision_id,
    (select revision_id from project_intelligence.graph_node_revisions
     where project_id = '41111111-1111-4111-8111-111111111111'
       and node_id = p_node
     order by revision_no desc limit 1),
    'human_origin', 'DB4 83 изменённый материал', 'node-area-db4',
    'revision-decision-db4-r1',
    '{"material":"porcelain","finish":"glossy"}', '[]', 'Замена отделки',
    pg_temp.rev(), p_key))
$function$;

-- Утвердить ревизию selection через approval package (создать, подать, одобрить).
create function pg_temp.approve_selection(
  p_revision_id text, p_package text, p_node text default 'node-selection-db4',
  p_extra_revision_id text default null
)
returns void language plpgsql as $function$
begin
  perform pg_temp.call_as('31111111-1111-4111-8111-111111111111', pg_catalog.format(
    'select projectceo_product_api.create_approval_package(%L, %L, %L, %L::jsonb, %s, %L)',
    '41111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111',
    p_package,
    jsonb_build_array(jsonb_build_object(
      'targetKind', 'selection_revision', 'entityId', p_node,
      'revisionId', p_revision_id))
    || case when p_extra_revision_id is null then '[]'::jsonb
       else jsonb_build_array(jsonb_build_object(
         'targetKind', 'selection_revision', 'entityId', p_node,
         'revisionId', p_extra_revision_id)) end,
    pg_temp.rev(), p_package || '-create'));
  perform pg_temp.call_as('31111111-1111-4111-8111-111111111111', pg_catalog.format(
    'select projectceo_product_api.submit_approval_package(%L, %L, %L, %s, %L)',
    '41111111-1111-4111-8111-111111111111', p_package, 'draft',
    pg_temp.rev(), p_package || '-submit'));
  perform pg_temp.call_as('31111111-1111-4111-8111-111111111111', pg_catalog.format(
    'select projectceo_product_api.review_approval_package(%L, %L, %L, %L, %L, %s, %L)',
    '41111111-1111-4111-8111-111111111111', p_package, 'submitted', 'approved',
    'DB4 83 утверждена замена материала', pg_temp.rev(), p_package || '-review'));
end
$function$;

-- Вход двери фиксируется один раз: точный replay обязан прийти с теми же
-- аргументами, что и первый вызов.
select set_config('db4.t83_latest_version',
  (select latest_version_id from project_intelligence.project_workflows
   where project_id = '41111111-1111-4111-8111-111111111111'), true);
select set_config('db4.t83_previous_baseline',
  (select baseline_id from projectceo_product.project_baselines
   where project_id = '41111111-1111-4111-8111-111111111111'
   order by version_no desc limit 1), true);
select set_config('db4.t83_state_revision', pg_temp.rev()::text, true);
select set_config('db4.t83_refs',
  pi_test_fixture.handoff_refs('41111111-1111-4111-8111-111111111111')::text, true);

do $schema_contract$
begin
  if pg_catalog.has_table_privilege(
    'authenticated', 'projectceo_product.baseline_room_handoff_refs', 'SELECT'
  ) then
    raise exception 'DB4_83_ROOM_REFS_EXPOSED';
  end if;
  -- Обе комнаты корневого пакета с утверждённым дизайном — в ссылках.
  if (select count(*) from jsonb_array_elements(current_setting('db4.t83_refs')::jsonb) ref
      where ref->>'roomId' in ('db4-room', 'cycle6-living-room')) <> 2 then
    raise exception 'DB4_83_ROOMS_NOT_IN_REFS:%', current_setting('db4.t83_refs');
  end if;
  if pg_temp.db4_room_problem() is not null then
    raise exception 'DB4_83_BASELINE_STATE_NOT_FRESH:%', pg_temp.db4_room_problem();
  end if;
  -- Чтение готовности видит то же самое, что проверит дверь.
  if pg_temp.readiness_problem('db4-room') is not null
     or not exists (
       select 1 from jsonb_array_elements(pg_temp.call_as(
         '31111111-1111-4111-8111-111111111111',
         'select projectceo_read_api.get_m3_room_handoff_readiness(''41111111-1111-4111-8111-111111111111'')'
       )->'rooms') room
       where room->>'roomId' = 'db4-room' and (room->>'applicable')::boolean
     ) then
    raise exception 'DB4_83_READINESS_NOT_FRESH';
  end if;
  if pg_catalog.has_function_privilege(
    'anon', 'projectceo_read_api.get_m3_room_handoff_readiness(uuid)', 'execute'
  ) then
    raise exception 'DB4_83_READINESS_REACHABLE_BY_ANON';
  end if;
end
$schema_contract$;

-- === 1. Форма ссылок ========================================================

select pg_temp.expect_publish_error(
  (select jsonb_agg(case when ref->>'roomId' = 'db4-room'
      then ref || '{"roomId":"cycle6-living-room"}'::jsonb else ref end)
   from jsonb_array_elements(current_setting('db4.t83_refs')::jsonb) ref),
  'P1111', 'handoffRefs', 'room_mismatch_or_duplicate');
select pg_temp.expect_publish_error(
  (select jsonb_agg(case when ref->>'roomId' = 'db4-room'
      then ref || '{"roomId":"db4-room-renamed"}'::jsonb else ref end)
   from jsonb_array_elements(current_setting('db4.t83_refs')::jsonb) ref),
  'P1111', 'handoffRefs.roomId', 'room_mismatch');

-- === 2. Новая комната с утверждённым дизайном без передачи ==================

savepoint new_room;
select pg_temp.copy_approved_commit('approved-db4-83-new-room', 'db4-room-83');
select pg_temp.expect_publish_error(
  current_setting('db4.t83_refs')::jsonb, 'P1111', 'db4-room-83', 'new_room_without_handoff');
do $readiness_missing$
begin
  if pg_temp.readiness_problem('db4-room-83') is distinct from 'M2_HANDOFF_MISSING' then
    raise exception 'DB4_83_READINESS_MISSING_ROOM:%', pg_temp.readiness_problem('db4-room-83');
  end if;
end
$readiness_missing$;
rollback to savepoint new_room;

-- === 3. Новый утверждённый дизайн той же комнаты ============================

savepoint newer_commit;
select pg_temp.copy_approved_commit('approved-db4-83-newer', 'db4-room');
do $newer_commit$
begin
  if pg_temp.db4_room_problem() is distinct from 'M2_HANDOFF_COMMIT_SUPERSEDED' then
    raise exception 'DB4_83_NEWER_COMMIT_NOT_DETECTED:%', pg_temp.db4_room_problem();
  end if;
end
$newer_commit$;
select pg_temp.expect_publish_error(
  current_setting('db4.t83_refs')::jsonb, 'P1109', 'M2_HANDOFF_COMMIT_SUPERSEDED', 'newer_commit');
rollback to savepoint newer_commit;

-- === 4. Материал/спецификация: черновик не мешает, утверждённая замена — да ==

savepoint newer_selection;
select pg_temp.append_selection('revision-selection-db4-83', 'db4-83-selection-draft');
do $draft_is_not_stale$
begin
  if pg_temp.db4_room_problem() is not null then
    raise exception 'DB4_83_DRAFT_MADE_HANDOFF_STALE:%', pg_temp.db4_room_problem();
  end if;
end
$draft_is_not_stale$;
select pg_temp.approve_selection('revision-selection-db4-83', 'approval-db4-83-selection');
do $approved_is_stale$
begin
  if pg_temp.db4_room_problem() is distinct from 'M2_HANDOFF_SELECTION_SUPERSEDED'
     or pg_temp.readiness_problem('db4-room') is distinct from 'M2_HANDOFF_SELECTION_SUPERSEDED' then
    raise exception 'DB4_83_APPROVED_SELECTION_NOT_DETECTED:%/%',
      pg_temp.db4_room_problem(), pg_temp.readiness_problem('db4-room');
  end if;
end
$approved_is_stale$;
select pg_temp.expect_publish_error(
  current_setting('db4.t83_refs')::jsonb, 'P1109', 'M2_HANDOFF_SELECTION_SUPERSEDED',
  'newer_approved_selection');
rollback to savepoint newer_selection;

-- === 4б. Новый материал при неизменном решении комнаты ======================
-- Новая selection-сущность, связанная с тем же решением, утверждена, но не
-- вошла ни в одну передачу: клиент получил бы материал, которого не видел.

savepoint unbound_selection;
select pg_temp.append_selection('revision-selection-db4-83-unseen', 'db4-83-unseen',
  'node-selection-db4-83-unseen');
select pg_temp.approve_selection('revision-selection-db4-83-unseen',
  'approval-db4-83-unseen', 'node-selection-db4-83-unseen');
do $unbound_visible$
declare
  v_unbound jsonb := pg_temp.call_as('31111111-1111-4111-8111-111111111111',
    'select projectceo_read_api.get_m3_room_handoff_readiness(''41111111-1111-4111-8111-111111111111'')'
  )->'unboundSelectionRevisionIds';
begin
  -- Комнаты свежие, но baseline заблокирован материалом вне передач.
  if pg_temp.db4_room_problem() is not null
     or not v_unbound ? 'revision-selection-db4-83-unseen' then
    raise exception 'DB4_83_UNBOUND_NOT_REPORTED:%/%', pg_temp.db4_room_problem(), v_unbound;
  end if;
end
$unbound_visible$;
select pg_temp.expect_publish_error(
  current_setting('db4.t83_refs')::jsonb, 'P1109', 'M2_HANDOFF_UNBOUND_SELECTION',
  'unbound_selection');
rollback to savepoint unbound_selection;

-- === 4в. Две версии одного материала в одном утверждении ===================

savepoint ambiguous;
select pg_temp.append_selection('revision-selection-db4-83a', 'db4-83-ambiguous-a');
select pg_temp.append_selection('revision-selection-db4-83b', 'db4-83-ambiguous-b');
select pg_temp.approve_selection('revision-selection-db4-83a', 'approval-db4-83-ambiguous',
  'node-selection-db4', 'revision-selection-db4-83b');
do $ambiguous$
begin
  if pg_temp.db4_room_problem() is distinct from 'M2_HANDOFF_APPROVAL_AMBIGUOUS' then
    raise exception 'DB4_83_AMBIGUOUS_NOT_DETECTED:%', pg_temp.db4_room_problem();
  end if;
end
$ambiguous$;
rollback to savepoint ambiguous;

-- === 5. Позитивный путь: точные ревизии записаны и совпадают с baseline =====

do $positive$
declare
  v_result jsonb;
  v_baseline text;
begin
  v_result := pg_temp.publish(current_setting('db4.t83_refs')::jsonb, 'db4-83-positive');
  v_baseline := 'baseline:db4-83-positive';
  if (select count(*) from projectceo_product.baseline_room_handoff_refs r
      where r.project_id = '41111111-1111-4111-8111-111111111111'
        and r.baseline_id = v_baseline)
     <> jsonb_array_length(current_setting('db4.t83_refs')::jsonb) then
    raise exception 'DB4_83_ROOM_REFS_NOT_PERSISTED';
  end if;
  if exists (
    select 1 from projectceo_product.baseline_room_handoff_refs r
    where r.project_id = '41111111-1111-4111-8111-111111111111'
      and r.baseline_id = v_baseline
      and (
        not exists (select 1 from projectceo_product.project_baseline_refs br
                    where br.project_id = r.project_id and br.baseline_id = r.baseline_id
                      and br.target_kind = 'decision_revision'
                      and br.revision_id = r.decision_revision_id)
        or exists (select 1 from unnest(r.selection_revision_ids) selection(revision_id)
                   where not exists (
                     select 1 from projectceo_product.project_baseline_refs br
                     where br.project_id = r.project_id and br.baseline_id = r.baseline_id
                       and br.target_kind = 'selection_revision'
                       and br.revision_id = selection.revision_id))
      )
  ) then
    raise exception 'DB4_83_FROZEN_REVISIONS_NOT_EXACT';
  end if;
  if not exists (
    select 1 from projectceo_product.baseline_room_handoff_refs r
    where r.baseline_id = v_baseline and r.room_id = 'db4-room'
      and r.selection_revision_ids = array['revision-selection-db4-r1']
  ) then
    raise exception 'DB4_83_DB4_ROOM_SELECTIONS_NOT_RECORDED';
  end if;
  -- Точный replay — тот же результат.
  if pg_temp.publish(current_setting('db4.t83_refs')::jsonb, 'db4-83-positive')->'result'
     is distinct from v_result->'result' then
    raise exception 'DB4_83_REPLAY_RESULT_CHANGED';
  end if;
  perform set_config('db4.t83_baseline', v_baseline, true);
end
$positive$;

do $append_only$
begin
  update projectceo_product.baseline_room_handoff_refs set room_id = 'tampered'
  where baseline_id = current_setting('db4.t83_baseline');
  raise exception 'DB4_83_ROOM_REFS_MUTABLE';
exception when sqlstate '55000' then null;
end
$append_only$;

-- === 6. Выпуск: утверждённая после baseline замена материала блокирует ======

select pg_temp.append_selection('revision-selection-db4-83r', 'db4-83-selection-release');
select pg_temp.approve_selection('revision-selection-db4-83r', 'approval-db4-83-release');

set local role pi_table_owner;
do $release_stale$
declare
  v_state text;
  v_detail text;
begin
  begin
    insert into projectceo_product.production_package_versions
    select (jsonb_populate_record(
      null::projectceo_product.production_package_versions,
      to_jsonb(v) || jsonb_build_object(
        'baseline_id', current_setting('db4.t83_baseline'),
        'production_package_version_id', 'db4-83-release-probe')
    )).*
    from projectceo_product.production_package_versions v
    where v.project_id = '41111111-1111-4111-8111-111111111111'
      and v.package_id = '41111111-1111-4111-8111-111111111111'
    limit 1;
    raise exception 'DB4_83_STALE_RELEASE_ACCEPTED';
  exception when sqlstate 'P1109' then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    if v_detail::jsonb->>'reason' is distinct from 'M2_HANDOFF_STALE_AT_RELEASE'
       or v_detail::jsonb->>'cause' is distinct from 'M2_HANDOFF_SELECTION_SUPERSEDED' then
      raise exception 'DB4_83_STALE_RELEASE_WRONG_REFUSAL:%', v_detail;
    end if;
  end;
end
$release_stale$;
reset role;

rollback;

select 'DB4_M3_ROOM_HANDOFF_FRESHNESS_OK' result;
