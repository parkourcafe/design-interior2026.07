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

select 'DB4_RESTART_REPLAY_OK' as result;
