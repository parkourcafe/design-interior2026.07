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
