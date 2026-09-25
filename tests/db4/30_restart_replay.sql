\set ON_ERROR_STOP on

select
  cr.resulting_state_revision - 1 as expected_state_revision,
  (
    select jsonb_agg(
      jsonb_build_object(
        'evidenceVersionId', rer.evidence_version_id,
        'evidenceLinkId', rer.evidence_link_id,
        'sourceId', rer.source_id,
        'sourceNodeId', rer.source_node_id,
        'sourceRevisionId', rer.source_revision_id,
        'fragmentId', rer.fragment_id
      )
      order by rer.ordinal
    )
    from projectceo_product.revision_evidence_refs rer
    where rer.organization_id = cr.organization_id
      and rer.project_id = cr.project_id
      and rer.claim_revision_id = 'revision-decision-db4-r2'
  ) as evidence
from projectceo_product.command_records cr
where cr.project_id = '41111111-1111-4111-8111-111111111111'
  and cr.operation = 'append_system_decision_revision'
  and cr.logical_result ->> 'revisionId' =
      'revision-decision-db4-r2'
\gset db4_

begin;
set local role service_role;
select (
  projectceo_product_api.append_system_decision_revision(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111',
    'node-decision-db4',
    'revision-decision-db4-r2',
    'revision-decision-db4-r1',
    'interpreted',
    'DB4 sourced decision revision two',
    'Use the approved floor solution with exact replay proof',
    'node-area-db4',
    'proposed',
    :'db4_evidence'::jsonb,
    'Concurrent exact revision',
    :'db4_expected_state_revision'::bigint,
    'db4-concurrent-decision-r2'
  ) ->> 'replay'
)::boolean as replay
\gset db4_
commit;

select case
  when :'db4_replay'::boolean then true
  else projectceo_product._raise(
    'P1112',
    'DB4_RESTART_REPLAY_FALSE',
    '{}'::jsonb
  ) is null
end;

do $restart_count$
begin
  if (
    select count(*)
    from project_intelligence.graph_node_revisions gr
    where gr.project_id = '41111111-1111-4111-8111-111111111111'
      and gr.revision_id = 'revision-decision-db4-r2'
  ) <> 1 or (
    select count(*)
    from projectceo_product.command_records cr
    where cr.project_id = '41111111-1111-4111-8111-111111111111'
      and cr.operation = 'append_system_decision_revision'
      and cr.logical_result ->> 'revisionId' =
          'revision-decision-db4-r2'
  ) <> 1 then
    raise exception 'DB4_RESTART_DUPLICATE_STATE';
  end if;
end
$restart_count$;

-- Атомарная дверь публикации baseline (backlog #7d): потеря ответа после
-- commit, пережившая рестарт базы. Оригинальные аргументы вызова
-- восстанавливаются из леджера — так делал бы и клиент, у которого остался
-- только commandId: детерминированная метка делает всё остальное выводимым.
select
  door.resulting_state_revision - 2 as door_expected_state,
  door.logical_result #>> '{version,baseVersionId}' as door_expected_latest,
  door.logical_result #>> '{baseline,previousBaselineId}' as door_previous_baseline,
  door.logical_result #>> '{version,id}' as door_version_id,
  door.logical_result #>> '{baseline,id}' as door_baseline_id
from projectceo_product.command_records door
where door.project_id = '41111111-1111-4111-8111-111111111111'
  and door.operation = 'publish_baseline_atomic'
  and door.logical_result #>> '{baseline,id}' = 'baseline:db4-atomic-1'
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.publish_baseline_atomic(
  '41111111-1111-4111-8111-111111111111',
  nullif(:'db4_door_expected_latest', ''),
  nullif(:'db4_door_previous_baseline', ''),
  pi_test_fixture.handoff_refs('41111111-1111-4111-8111-111111111111'),
  :'db4_door_expected_state'::bigint,
  'db4-atomic-1',
  'db4-atomic-door-1'
) as door_envelope
\gset db4_
commit;

select set_config('db4.door_envelope', :'db4_door_envelope', false);
select set_config('db4.door_version_id', :'db4_door_version_id', false);
select set_config('db4.door_baseline_id', :'db4_door_baseline_id', false);

do $door_restart_replay$
declare
  v_envelope jsonb := current_setting('db4.door_envelope')::jsonb;
begin
  if not (v_envelope->>'replay')::boolean then
    raise exception 'DB4_DOOR_RESTART_REPLAY_FALSE';
  end if;
  if v_envelope#>>'{result,version,id}'
     is distinct from current_setting('db4.door_version_id')
    or v_envelope#>>'{result,baseline,id}'
     is distinct from current_setting('db4.door_baseline_id') then
    raise exception 'DB4_DOOR_RESTART_REPLAY_DIFFERENT_RESULT';
  end if;
  if (
    select count(*)
    from project_intelligence.project_versions version
    where version.project_id = '41111111-1111-4111-8111-111111111111'
      and version.label = 'baseline:db4-atomic-1'
  ) <> 1 then
    raise exception 'DB4_DOOR_RESTART_DUPLICATE_VERSION';
  end if;
end
$door_restart_replay$;

select 'DB4_RESTART_REPLAY_OK' as result;
