\set ON_ERROR_STOP on

-- Атомарная дверь публикации baseline (`20260825030000`, M3 backlog #6/#7):
-- версия графа и baseline — одна транзакция. Четыре теста семантики из
-- backlog #7 (тест «потеря ответа после commit» дополнительно повторён после
-- рестарта базы в 30_restart_replay.sql) плюс счётчик версий из гипотезы:
-- повтор того же commandId не создаёт вторую версию графа.
--
-- Дверь выдана `authenticated` выключателем модулей: сценарии 49/50 открыли
-- M3 через `open_module_production`, а список сигнатур M3 с `20260825030000`
-- включает дверь.

-- Стартовые координаты: версии, baseline, state_revision.
select
  workflow.state_revision as state_revision,
  workflow.latest_version_id as latest_version_id
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
\gset door_

select baseline.baseline_id as previous_baseline_id
from projectceo_product.project_baselines baseline
where baseline.project_id = '41111111-1111-4111-8111-111111111111'
order by baseline.version_no desc
limit 1
\gset door_

select count(*) as versions_before
from project_intelligence.project_versions version
where version.project_id = '41111111-1111-4111-8111-111111111111'
\gset door_

select count(*) as baselines_before
from projectceo_product.project_baselines baseline
where baseline.project_id = '41111111-1111-4111-8111-111111111111'
\gset door_

select set_config('db4.door_versions_before', :'door_versions_before', false);
select set_config('db4.door_baselines_before', :'door_baselines_before', false);
select set_config('db4.door_latest_version_id', :'door_latest_version_id', false);
select set_config('db4.door_previous_baseline_id', :'door_previous_baseline_id', false);
select set_config('db4.door_state_revision', :'door_state_revision', false);

-- Т1. Успешная публикация: версия + baseline одной транзакцией, состав
-- выведен сервером и самосогласован.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.publish_baseline_atomic(
  '41111111-1111-4111-8111-111111111111',
  :'door_latest_version_id',
  :'door_previous_baseline_id',
  pi_test_fixture.handoff_refs('41111111-1111-4111-8111-111111111111'),
  :'door_state_revision'::bigint,
  'db4-atomic-1',
  'db4-atomic-door-1'
) as envelope
\gset door_t1_
commit;

select set_config('db4.door_t1_envelope', :'door_t1_envelope', false);

do $atomic_publish_succeeded$
declare
  v_envelope jsonb := current_setting('db4.door_t1_envelope')::jsonb;
  v_version_id text;
  v_derived_sources jsonb;
begin
  if (v_envelope->>'replay')::boolean then
    raise exception 'DB4_ATOMIC_FIRST_CALL_REPLAYED';
  end if;
  if v_envelope#>>'{result,baseline,id}' is distinct from 'baseline:db4-atomic-1' then
    raise exception 'DB4_ATOMIC_BASELINE_ID_WRONG:%',
      v_envelope#>>'{result,baseline,id}';
  end if;
  v_version_id := v_envelope#>>'{result,version,id}';
  if v_version_id is null then
    raise exception 'DB4_ATOMIC_VERSION_MISSING_IN_RESULT';
  end if;

  if (
    select count(*)
    from project_intelligence.project_versions version
    where version.project_id = '41111111-1111-4111-8111-111111111111'
  ) <> current_setting('db4.door_versions_before')::int + 1 then
    raise exception 'DB4_ATOMIC_VERSION_COUNT_WRONG_AFTER_PUBLISH';
  end if;
  if (
    select count(*)
    from projectceo_product.project_baselines baseline
    where baseline.project_id = '41111111-1111-4111-8111-111111111111'
  ) <> current_setting('db4.door_baselines_before')::int + 1 then
    raise exception 'DB4_ATOMIC_BASELINE_COUNT_WRONG_AFTER_PUBLISH';
  end if;

  -- Состав источников — ровно подтверждённые ревизии источников из
  -- созданной версии графа (сервер вывел, сервер же и проверяем).
  select coalesce(jsonb_agg(distinct_revision order by distinct_revision collate "C"), '[]'::jsonb)
  into v_derived_sources
  from (
    select distinct vn.revision_id as distinct_revision
    from project_intelligence.version_nodes vn
    join project_intelligence.graph_nodes gn
      on gn.organization_id = vn.organization_id
     and gn.project_id = vn.project_id
     and gn.node_id = vn.node_id
    join project_intelligence.human_reviews review
      on review.organization_id = vn.organization_id
     and review.project_id = vn.project_id
     and review.target_revision_id = vn.revision_id
    where vn.project_id = '41111111-1111-4111-8111-111111111111'
      and vn.version_id = v_version_id
      and gn.kind = 'source'
      and review.decision = 'confirmed'
  ) confirmed(distinct_revision);

  if v_envelope#>'{result,baseline,semanticContent,sourceRevisionIds}'
     is distinct from v_derived_sources then
    raise exception 'DB4_ATOMIC_SOURCE_COMPOSITION_MISMATCH: % vs %',
      v_envelope#>'{result,baseline,semanticContent,sourceRevisionIds}',
      v_derived_sources;
  end if;
end
$atomic_publish_succeeded$;

-- Т2 (backlog #7a + гипотеза счётчика). Повтор того же commandId — прежний
-- успех, вторая версия графа не создаётся, state_revision не движется.
select workflow.state_revision as state_after_t1
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
\gset door_

select set_config('db4.door_state_after_t1', :'door_state_after_t1', false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.publish_baseline_atomic(
  '41111111-1111-4111-8111-111111111111',
  :'door_latest_version_id',
  :'door_previous_baseline_id',
  pi_test_fixture.handoff_refs('41111111-1111-4111-8111-111111111111'),
  :'door_state_revision'::bigint,
  'db4-atomic-1',
  'db4-atomic-door-1'
) as envelope
\gset door_t2_
commit;

select set_config('db4.door_t2_envelope', :'door_t2_envelope', false);

do $atomic_replay_returns_prior$
declare
  v_first jsonb := current_setting('db4.door_t1_envelope')::jsonb;
  v_second jsonb := current_setting('db4.door_t2_envelope')::jsonb;
begin
  if not (v_second->>'replay')::boolean then
    raise exception 'DB4_ATOMIC_REPLAY_NOT_MARKED';
  end if;
  if v_second#>>'{result,baseline,id}'
     is distinct from v_first#>>'{result,baseline,id}'
    or v_second#>>'{result,version,id}'
     is distinct from v_first#>>'{result,version,id}' then
    raise exception 'DB4_ATOMIC_REPLAY_DIFFERENT_RESULT';
  end if;
  if (
    select count(*)
    from project_intelligence.project_versions version
    where version.project_id = '41111111-1111-4111-8111-111111111111'
  ) <> current_setting('db4.door_versions_before')::int + 1 then
    raise exception 'DB4_ATOMIC_REPLAY_CREATED_SECOND_VERSION';
  end if;
  if (
    select workflow.state_revision
    from project_intelligence.project_workflows workflow
    where workflow.project_id = '41111111-1111-4111-8111-111111111111'
  ) <> current_setting('db4.door_state_after_t1')::bigint then
    raise exception 'DB4_ATOMIC_REPLAY_MOVED_STATE';
  end if;
end
$atomic_replay_returns_prior$;

-- Т3 (backlog #7b). Новый commandId со старым снапшотом мира — stale_state
-- (P1006 STATE_STALE внутренней операции), ничего не записано.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $atomic_stale_token$
begin
  begin
    perform projectceo_product_api.publish_baseline_atomic(
      '41111111-1111-4111-8111-111111111111',
      current_setting('db4.door_latest_version_id'),
      current_setting('db4.door_previous_baseline_id'),
      pi_test_fixture.handoff_refs('41111111-1111-4111-8111-111111111111'),
      current_setting('db4.door_state_revision')::bigint,
      'db4-atomic-2',
      'db4-atomic-door-2'
    );
    raise exception 'DB4_ATOMIC_STALE_TOKEN_ACCEPTED';
  exception when sqlstate 'P1006' then null;
  end;
end
$atomic_stale_token$;
rollback;

do $atomic_stale_left_nothing$
begin
  if (
    select count(*)
    from project_intelligence.project_versions version
    where version.project_id = '41111111-1111-4111-8111-111111111111'
  ) <> current_setting('db4.door_versions_before')::int + 1 then
    raise exception 'DB4_ATOMIC_STALE_TOKEN_WROTE_VERSION';
  end if;
  if exists (
    select 1
    from projectceo_product.command_records command
    where command.project_id = '41111111-1111-4111-8111-111111111111'
      and command.operation = 'publish_baseline_atomic'
      and command.logical_result#>>'{baseline,id}' = 'baseline:db4-atomic-2'
  ) then
    raise exception 'DB4_ATOMIC_STALE_TOKEN_WROTE_LEDGER';
  end if;
end
$atomic_stale_left_nothing$;

-- Т4 (backlog #7c). Сбой после доменных записей второго шага — в базе не
-- остаётся НИЧЕГО: ни версии графа из первого шага, ни baseline, ни записей
-- леджера. Инъекция — штатный крючок `projectceo.product_test_fail_after_domain`.
select
  workflow.state_revision as fresh_state,
  workflow.latest_version_id as fresh_latest_version
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
\gset door_t4_

select baseline.baseline_id as fresh_previous_baseline
from projectceo_product.project_baselines baseline
where baseline.project_id = '41111111-1111-4111-8111-111111111111'
order by baseline.version_no desc
limit 1
\gset door_t4_

select set_config('db4.door_t4_fresh_state', :'door_t4_fresh_state', false);
select set_config('db4.door_t4_fresh_latest_version', :'door_t4_fresh_latest_version', false);
select set_config('db4.door_t4_fresh_previous_baseline', :'door_t4_fresh_previous_baseline', false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
set local "projectceo.product_test_fail_after_domain" = 'on';
do $atomic_failure_keeps_nothing$
begin
  begin
    perform projectceo_product_api.publish_baseline_atomic(
      '41111111-1111-4111-8111-111111111111',
      current_setting('db4.door_t4_fresh_latest_version'),
      current_setting('db4.door_t4_fresh_previous_baseline'),
      pi_test_fixture.handoff_refs('41111111-1111-4111-8111-111111111111'),
      current_setting('db4.door_t4_fresh_state')::bigint,
      'db4-atomic-3',
      'db4-atomic-door-3'
    );
    raise exception 'DB4_ATOMIC_INJECTED_FAILURE_NOT_RAISED';
  exception when sqlstate 'P1112' then null;
  end;
end
$atomic_failure_keeps_nothing$;

-- Ловля исключения откатила savepoint plpgsql-блока: доменных следов нет
-- уже здесь, внутри той же транзакции. Проверки — от имени суперпользователя:
-- у `authenticated` нет usage на приватные схемы.
reset role;
do $atomic_failure_no_traces_in_txn$
begin
  if exists (
    select 1
    from project_intelligence.project_versions version
    where version.project_id = '41111111-1111-4111-8111-111111111111'
      and version.label = 'baseline:db4-atomic-3'
  ) then
    raise exception 'DB4_ATOMIC_FAILURE_LEFT_VERSION';
  end if;
  if exists (
    select 1
    from projectceo_product.project_baselines baseline
    where baseline.project_id = '41111111-1111-4111-8111-111111111111'
      and baseline.baseline_id = 'baseline:db4-atomic-3'
  ) then
    raise exception 'DB4_ATOMIC_FAILURE_LEFT_BASELINE';
  end if;
  if exists (
    select 1
    from projectceo_product.command_records command
    where command.project_id = '41111111-1111-4111-8111-111111111111'
      and command.operation in ('publish_baseline_atomic', 'publish_project_baseline')
      and command.logical_result::text like '%db4-atomic-3%'
  ) then
    raise exception 'DB4_ATOMIC_FAILURE_LEFT_LEDGER';
  end if;
  if exists (
    select 1
    from project_intelligence.command_records command
    where command.project_id = '41111111-1111-4111-8111-111111111111'
      and command.operation = 'publish_version'
      and command.logical_result::text like '%db4-atomic-3%'
  ) then
    raise exception 'DB4_ATOMIC_FAILURE_LEFT_VERSION_LEDGER';
  end if;
end
$atomic_failure_no_traces_in_txn$;
rollback;

do $atomic_failure_nothing_after_rollback$
begin
  if (
    select count(*)
    from project_intelligence.project_versions version
    where version.project_id = '41111111-1111-4111-8111-111111111111'
  ) <> current_setting('db4.door_versions_before')::int + 1 then
    raise exception 'DB4_ATOMIC_FAILURE_VERSION_SURVIVED';
  end if;
  if (
    select workflow.latest_version_id
    from project_intelligence.project_workflows workflow
    where workflow.project_id = '41111111-1111-4111-8111-111111111111'
  ) is distinct from (current_setting('db4.door_t1_envelope')::jsonb)#>>'{result,version,id}' then
    raise exception 'DB4_ATOMIC_FAILURE_MOVED_LATEST_VERSION';
  end if;
end
$atomic_failure_nothing_after_rollback$;

-- Т5. Закрытый модуль закрывает и дверь: close отзывает грант, живой вызов
-- упирается в 42501; open возвращает среду харнесса.
select projectceo_platform.close_module_production(
  'm3', 'DB4 harness', 'сценарий 51: дверь закрыта вместе с модулем'
);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $door_closed_with_module$
begin
  begin
    perform projectceo_product_api.publish_baseline_atomic(
      '41111111-1111-4111-8111-111111111111',
      null, null, '[]'::jsonb, 1, 'db4-atomic-closed', 'db4-atomic-door-closed'
    );
    raise exception 'DB4_ATOMIC_DOOR_REACHED_WITH_MODULE_OFF';
  exception when insufficient_privilege then null;
  end;
end
$door_closed_with_module$;
rollback;

select projectceo_platform.open_module_production(
  'm3', 'DB4 harness', 'сценарий 51: возврат среды харнесса к открытому M3'
);

select 'DB4_PUBLISH_BASELINE_DOOR_OK' as result;
