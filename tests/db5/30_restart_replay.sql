\set ON_ERROR_STOP on

select
  command.resulting_state_revision - 1 as expected_state_revision,
  command.logical_result ->> 'id' as expected_handover_id,
  command.logical_result ->> 'semanticHash' as expected_handover_hash,
  workflow.state_revision as current_state_revision
from projectceo_product.command_records command
join project_intelligence.project_workflows workflow
  on workflow.organization_id = command.organization_id
 and workflow.project_id = command.project_id
where command.project_id = '41111111-1111-4111-8111-111111111111'
  and command.operation = 'build_construction_handover'
\gset db5_

begin;
set local role service_role;
select projectceo_m4_api.build_construction_handover(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'package-db5-root-v2',
  :'db5_expected_state_revision'::bigint,
  'db5-build-handover'
) as replay_response
\gset db5_
commit;

select set_config(
  'projectceo.db5_replay_response',
  :'db5_replay_response',
  false
);
select set_config(
  'projectceo.db5_expected_handover_id',
  :'db5_expected_handover_id',
  false
);
select set_config(
  'projectceo.db5_expected_handover_hash',
  :'db5_expected_handover_hash',
  false
);
select set_config(
  'projectceo.db5_current_state_revision',
  :'db5_current_state_revision',
  false
);

do $restart_replay$
begin
  if not (
       current_setting('projectceo.db5_replay_response')::jsonb
       ->> 'replay'
     )::boolean
     or current_setting('projectceo.db5_replay_response')::jsonb
        #>> '{result,id}' is distinct from
        current_setting('projectceo.db5_expected_handover_id')
     or current_setting('projectceo.db5_replay_response')::jsonb
        #>> '{result,semanticHash}' is distinct from
        current_setting('projectceo.db5_expected_handover_hash')
     or (
       select state_revision
       from project_intelligence.project_workflows
       where project_id = '41111111-1111-4111-8111-111111111111'
     ) <> current_setting(
       'projectceo.db5_current_state_revision'
     )::bigint
     or (
       select count(*)
       from projectceo_m4.construction_handovers handover
       where handover.project_id =
         '41111111-1111-4111-8111-111111111111'
         and handover.production_package_version_id =
           'package-db5-root-v2'
     ) <> 1 then
    raise exception 'DB5_RESTART_REPLAY_INVALID';
  end if;
end
$restart_replay$;

select 'DB5_RESTART_REPLAY_OK' as result;

-- V1 Impact (DEC-033): та же проба, что и выше, для policy-bound двери
-- расчёта — restart/replay не имеет права ни потерять покрытие, ни завести
-- вторую строку `impact_runs` на ту же заявку. Источник ожидаемых значений —
-- уже посчитанная золотая заявка из `20_execution_operations.sql`
-- (`db5-calculate-impact`), а не заявка из `run-concurrency.zsh`: та строится
-- заново при каждом прогоне и не нужна здесь отдельно.
select
  command.resulting_state_revision - 1 as expected_state_revision,
  command.logical_result ->> 'id' as expected_impact_run_id,
  command.logical_result ->> 'resultHash' as expected_result_hash,
  command.logical_result ->> 'coverageStatus' as expected_coverage_status,
  run.change_request_id::text as change_request_id,
  workflow.state_revision as current_state_revision
from projectceo_product.command_records command
join projectceo_m4.impact_runs run
  on run.organization_id = command.organization_id
 and run.project_id = command.project_id
 and run.impact_run_id = (command.logical_result ->> 'id')::uuid
join project_intelligence.project_workflows workflow
  on workflow.organization_id = command.organization_id
 and workflow.project_id = command.project_id
where command.project_id = '41111111-1111-4111-8111-111111111111'
  and command.operation = 'calculate_change_impact'
  -- Ровно золотая заявка: `run-concurrency.zsh` с этого прогона тоже завёл
  -- свою собственную `calculate_change_impact`-запись под другим ключом
  -- идемпотентности, и без фильтра по ключу здесь стало бы больше одной
  -- строки.
  and command.key_digest = project_intelligence._sha256_text('db5-calculate-impact')
\gset db5_impact_

begin;
set local role service_role;
select projectceo_m4_api.calculate_change_impact_policy_bound(
  '41111111-1111-4111-8111-111111111111',
  :'db5_impact_change_request_id'::uuid,
  :'db5_impact_expected_state_revision'::bigint,
  'db5-calculate-impact'
) as replay_response
\gset db5_impact_
commit;

select set_config(
  'projectceo.db5_impact_replay_response', :'db5_impact_replay_response', false
);
select set_config(
  'projectceo.db5_impact_expected_result_hash',
  :'db5_impact_expected_result_hash', false
);
select set_config(
  'projectceo.db5_impact_expected_coverage_status',
  :'db5_impact_expected_coverage_status', false
);
select set_config(
  'projectceo.db5_impact_change_request_id', :'db5_impact_change_request_id', false
);
select set_config(
  'projectceo.db5_impact_current_state_revision',
  :'db5_impact_current_state_revision', false
);

do $impact_restart_replay$
begin
  if not (
       current_setting('projectceo.db5_impact_replay_response')::jsonb
       ->> 'replay'
     )::boolean
     or current_setting('projectceo.db5_impact_replay_response')::jsonb
        #>> '{result,resultHash}' is distinct from
        current_setting('projectceo.db5_impact_expected_result_hash')
     or current_setting('projectceo.db5_impact_replay_response')::jsonb
        #>> '{result,coverageStatus}' is distinct from
        current_setting('projectceo.db5_impact_expected_coverage_status')
     or (
       select state_revision
       from project_intelligence.project_workflows
       where project_id = '41111111-1111-4111-8111-111111111111'
     ) <> current_setting(
       'projectceo.db5_impact_current_state_revision'
     )::bigint
     or (
       select count(*)
       from projectceo_m4.impact_runs run
       where run.project_id = '41111111-1111-4111-8111-111111111111'
         and run.change_request_id =
           current_setting('projectceo.db5_impact_change_request_id')::uuid
     ) <> 1 then
    raise exception 'DB5_IMPACT_RESTART_REPLAY_INVALID';
  end if;
end
$impact_restart_replay$;

select 'DB5_IMPACT_RESTART_REPLAY_OK' as result;
