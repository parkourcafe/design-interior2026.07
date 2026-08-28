\set ON_ERROR_STOP on

-- v10: чтение называет устаревшие одобрения (`20260825070000`, M4 backlog
-- #5). Управляемая фикстура на свежей сущности: одобрить r1 → пересмотреть
-- в r2 без переодобрения → сущность обязана появиться в
-- approvalSupersededEntities; после переодобрения r2 — исчезнуть.
-- Фикстура намеренно НЕ трогает node-decision-db4: его вторую ревизию
-- создаёт гоночный сценарий run-concurrency, идущий после списка.

-- 0. Снимок и самосогласованность стартового состояния: v10 отдаёт ровно
-- то, что даёт предикат по базе (что бы там ни было к этому месту цепочки).
select workflow.state_revision as s54_state
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select set_config('db4.s54_state', :'db4_s54_state', false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_read_api.get_project_workspace_read_v11(
  '41111111-1111-4111-8111-111111111111', null
) #> '{data,approvalSupersededEntities}' as s54_initial
\gset db4_
rollback;

select set_config('db4.s54_initial', :'db4_s54_initial', false);

-- 1. Свежая сущность: решение r1 → одобрение отдельным пакетом.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.append_decision_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'node-decision-54',
  'revision-decision-54-r1',
  null,
  'human_origin',
  'DB4 superseded probe',
  'Первая редакция решения для проверки v10',
  null,
  'proposed',
  '[]'::jsonb,
  'Фикстура сценария 54',
  current_setting('db4.s54_state')::bigint,
  'db4-s54-append-r1'
) ->> 'stateRevision' as s54_state
\gset db4_
commit;

select set_config('db4.s54_state', :'db4_s54_state', false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.create_approval_package(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'approval-54',
  jsonb_build_array(jsonb_build_object(
    'targetKind', 'decision_revision',
    'entityId', 'node-decision-54',
    'revisionId', 'revision-decision-54-r1'
  )),
  current_setting('db4.s54_state')::bigint,
  'db4-s54-create-approval'
) ->> 'stateRevision' as s54_state
\gset db4_
commit;

select set_config('db4.s54_state', :'db4_s54_state', false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.submit_approval_package(
  '41111111-1111-4111-8111-111111111111',
  'approval-54',
  'draft',
  current_setting('db4.s54_state')::bigint,
  'db4-s54-submit-approval'
) ->> 'stateRevision' as s54_state
\gset db4_
commit;

select set_config('db4.s54_state', :'db4_s54_state', false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_product_api.review_approval_package(
  '41111111-1111-4111-8111-111111111111',
  'approval-54',
  'submitted',
  'approved',
  'Одобрение первой редакции для сценария 54',
  current_setting('db4.s54_state')::bigint,
  'db4-s54-review-approval'
) ->> 'stateRevision' as s54_state
\gset db4_
commit;

select set_config('db4.s54_state', :'db4_s54_state', false);

-- Одобренная и текущая совпадают — сущность НЕ в списке.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $approved_current_not_flagged$
declare
  v_list jsonb;
begin
  v_list := projectceo_read_api.get_project_workspace_read_v11(
    '41111111-1111-4111-8111-111111111111', null
  ) #> '{data,approvalSupersededEntities}';
  if exists (
    select 1 from jsonb_array_elements(v_list) entry
    where entry->>'entityId' = 'node-decision-54'
  ) then
    raise exception 'DB4_V10_FLAGGED_FRESHLY_APPROVED';
  end if;
end
$approved_current_not_flagged$;
rollback;

-- 2. Пересмотр без переодобрения: r2 становится текущей.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.append_decision_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'node-decision-54',
  'revision-decision-54-r2',
  'revision-decision-54-r1',
  'human_origin',
  'DB4 superseded probe',
  'Вторая редакция: решение пересмотрели после одобрения',
  null,
  'proposed',
  '[]'::jsonb,
  'Пересмотр без переодобрения',
  current_setting('db4.s54_state')::bigint,
  'db4-s54-append-r2'
) ->> 'stateRevision' as s54_state
\gset db4_
commit;

select set_config('db4.s54_state', :'db4_s54_state', false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $superseded_flagged$
declare
  v_list jsonb;
  v_entry jsonb;
begin
  v_list := projectceo_read_api.get_project_workspace_read_v11(
    '41111111-1111-4111-8111-111111111111', null
  ) #> '{data,approvalSupersededEntities}';

  select entry into v_entry
  from jsonb_array_elements(v_list) entry
  where entry->>'entityId' = 'node-decision-54';
  if v_entry is null then
    raise exception 'DB4_V10_SUPERSEDED_NOT_FLAGGED:%', v_list;
  end if;
  if v_entry->>'targetKind' <> 'decision_revision'
    or v_entry->>'approvedRevisionId' <> 'revision-decision-54-r1'
    or v_entry->>'currentRevisionId' <> 'revision-decision-54-r2' then
    raise exception 'DB4_V10_SUPERSEDED_ENTRY_WRONG:%', v_entry;
  end if;

  -- v9 поля не имеет — контракт отданной версии не менялся.
  if projectceo_read_api.get_project_workspace_read_v9(
    '41111111-1111-4111-8111-111111111111', null
  ) #> '{data,approvalSupersededEntities}' is not null then
    raise exception 'DB4_V10_LEAKED_INTO_V9';
  end if;
end
$superseded_flagged$;
rollback;

-- Самосогласованность против предиката по базе — от суперпользователя.
do $v10_matches_database$
declare
  v_reported jsonb;
  v_derived_count int;
  v_reported_count int;
begin
  -- Список из-под владельца снят повторно тем же путём, что выше, но
  -- сверяется с независимым предикатом по таблицам.
  perform set_config('request.jwt.claim.sub',
    '31111111-1111-4111-8111-111111111111', true);
  set local role authenticated;
  v_reported := projectceo_read_api.get_project_workspace_read_v11(
    '41111111-1111-4111-8111-111111111111', null
  ) #> '{data,approvalSupersededEntities}';
  reset role;

  v_reported_count := jsonb_array_length(v_reported);

  with approved_items as (
    select item.target_kind, item.entity_id, item.revision_id,
           ap.created_at, ap.approval_package_id
    from projectceo_product.approval_package_items item
    join projectceo_product.approval_packages ap
      on ap.organization_id = item.organization_id
     and ap.project_id = item.project_id
     and ap.approval_package_id = item.approval_package_id
    join lateral (
      select event.to_status
      from projectceo_product.approval_package_events event
      where event.organization_id = ap.organization_id
        and event.project_id = ap.project_id
        and event.approval_package_id = ap.approval_package_id
      order by event.sequence_no desc
      limit 1
    ) latest on latest.to_status = 'approved'
    where item.project_id = '41111111-1111-4111-8111-111111111111'
  ),
  winners as (
    select distinct on (approved.target_kind, approved.entity_id)
      approved.target_kind, approved.entity_id, approved.revision_id
    from approved_items approved
    order by approved.target_kind, approved.entity_id,
      approved.created_at desc,
      approved.approval_package_id collate "C" desc
  )
  select count(*) into v_derived_count
  from winners winner
  join project_intelligence.graph_nodes node
    on node.project_id = '41111111-1111-4111-8111-111111111111'
   and node.node_id = winner.entity_id
  where node.current_revision_id is distinct from winner.revision_id
    and not exists (
      select 1 from approved_items current_approval
      where current_approval.target_kind = winner.target_kind
        and current_approval.entity_id = winner.entity_id
        and current_approval.revision_id = node.current_revision_id
    );

  if v_reported_count <> v_derived_count then
    raise exception 'DB4_V10_LIST_DIVERGES_FROM_DATABASE: % vs %',
      v_reported_count, v_derived_count;
  end if;
end
$v10_matches_database$;

select 'DB4_WORKSPACE_READ_SUPERSEDED_OK' as result;
