#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

: "${PI_DB4_CONTAINER:?PI_DB4_CONTAINER is required}"
: "${PI_DB4_DATABASE:?PI_DB4_DATABASE is required}"
: "${PI_DB4_PASSWORD:?PI_DB4_PASSWORD is required}"

container=${PI_DB4_CONTAINER}
database=${PI_DB4_DATABASE}
password=${PI_DB4_PASSWORD}
project=41111111-1111-4111-8111-111111111111
package=41111111-1111-4111-8111-111111111111
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/pi-db4-concurrency.XXXXXX")
trap 'rm -rf "${tmpdir}"' EXIT INT TERM

psql_exec() {
  local app=$1
  local sql=$2
  docker exec \
    -e PGPASSWORD="${password}" \
    -e PGAPPNAME="${app}" \
    "${container}" \
    psql -X --quiet --tuples-only --no-align \
      --set ON_ERROR_STOP=1 \
      --username postgres \
      --dbname "${database}" \
      --command "${sql}"
}

state=$(psql_exec db4-concurrency-state "
  select state_revision
  from project_intelligence.project_workflows
  where project_id = '${project}'
")
evidence=$(psql_exec db4-concurrency-evidence "
  select jsonb_agg(
    jsonb_build_object(
      'evidenceVersionId', evidence_version_id,
      'evidenceLinkId', evidence_link_id,
      'sourceId', source_id,
      'sourceNodeId', source_node_id,
      'sourceRevisionId', source_revision_id,
      'fragmentId', fragment_id
    )
    order by ordinal
  )
  from projectceo_product.revision_evidence_refs
  where project_id = '${project}'
    and claim_revision_id = 'revision-decision-db4-r1'
")

call="begin;
set local role service_role;
select projectceo_product_api.append_system_decision_revision(
  '${project}',
  '${package}',
  'node-decision-db4',
  'revision-decision-db4-r2',
  'revision-decision-db4-r1',
  'interpreted',
  'DB4 sourced decision revision two',
  'Use the approved floor solution with exact replay proof',
  'node-area-db4',
  'proposed',
  '${evidence}'::jsonb,
  'Concurrent exact revision',
  ${state},
  'db4-concurrent-decision-r2'
);
commit;"

set +e
psql_exec db4-decision-a "${call}" >"${tmpdir}/a.out" 2>&1 &
pid_a=$!
psql_exec db4-decision-b "${call}" >"${tmpdir}/b.out" 2>&1 &
pid_b=$!
wait "${pid_a}"; status_a=$?
wait "${pid_b}"; status_b=$?
set -e

if [[ "${status_a}" != "0" || "${status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent product revision failed"
  sed -n '1,160p' "${tmpdir}/a.out" >&2
  sed -n '1,160p' "${tmpdir}/b.out" >&2
  exit 1
fi

if [[ $(
  (rg -o '"replay": false' "${tmpdir}/a.out" "${tmpdir}/b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]] || [[ $(
  (rg -o '"replay": true' "${tmpdir}/a.out" "${tmpdir}/b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]]; then
  print -u2 -r -- "Concurrent product revision replay contract failed"
  sed -n '1,160p' "${tmpdir}/a.out" >&2
  sed -n '1,160p' "${tmpdir}/b.out" >&2
  exit 1
fi

expected_state=$(( state + 1 ))
result=$(psql_exec db4-concurrency-assert "
  select pw.state_revision::text
    || '|' || gn.current_revision_id
    || '|' || count(distinct gr.revision_id)::text
    || '|' || count(distinct cr.command_id)::text
    || '|' || count(distinct rer.evidence_link_id)::text
  from project_intelligence.project_workflows pw
  join project_intelligence.graph_nodes gn
    on gn.organization_id = pw.organization_id
   and gn.project_id = pw.project_id
   and gn.node_id = 'node-decision-db4'
  left join project_intelligence.graph_node_revisions gr
    on gr.organization_id = gn.organization_id
   and gr.project_id = gn.project_id
   and gr.revision_id = 'revision-decision-db4-r2'
  left join projectceo_product.command_records cr
    on cr.organization_id = pw.organization_id
   and cr.project_id = pw.project_id
   and cr.operation = 'append_system_decision_revision'
   and cr.logical_result ->> 'revisionId' =
       'revision-decision-db4-r2'
  left join projectceo_product.revision_evidence_refs rer
    on rer.organization_id = pw.organization_id
   and rer.project_id = pw.project_id
   and rer.claim_revision_id = 'revision-decision-db4-r2'
  where pw.project_id = '${project}'
  group by pw.state_revision, gn.current_revision_id
")
if [[
  "${result}" !=
  "${expected_state}|revision-decision-db4-r2|1|1|1"
]]; then
  print -u2 -r -- "Concurrent product revision persisted invalid state: ${result}"
  exit 1
fi

# Two independently valid immutable documents race for one public versionId.
# The workflow lock/state precondition plus the version uniqueness invariant
# must leave exactly one publication; the losing transaction fails closed.
layout_state=$(psql_exec db4-layout-race-state "
  select state_revision from project_intelligence.project_workflows
  where project_id='${project}'
")
layout_a=$(psql_exec db4-layout-race-payload-a "
  with source as (
    select jsonb_set(payload->'layoutContent','{documentId}','\"layout-race-a\"'::jsonb) content
    from projectceo_product.m2_workspace_revisions
    where project_id='${project}' and entity_kind='layout_version'
      and entity_id='layout-document-db4-secondary'
    order by revision_no desc limit 1
  )
  select jsonb_build_object(
    'versionId','layout-version-concurrent-r1','roomId','db4-room',
    'variantId','db4-variant-value','role','value_engineered',
    'semanticHash',projectceo_product._m2_layout_semantic_hash(content),
    'schemaVersion','project-ceo-m2-layout/0.1','layoutContent',content
  ) from source
")
layout_b=$(psql_exec db4-layout-race-payload-b "
  with source as (
    select jsonb_set(payload->'layoutContent','{documentId}','\"layout-race-b\"'::jsonb) content
    from projectceo_product.m2_workspace_revisions
    where project_id='${project}' and entity_kind='layout_version'
      and entity_id='layout-document-db4-secondary'
    order by revision_no desc limit 1
  )
  select jsonb_build_object(
    'versionId','layout-version-concurrent-r1','roomId','db4-room',
    'variantId','db4-variant-value','role','value_engineered',
    'semanticHash',projectceo_product._m2_layout_semantic_hash(content),
    'schemaVersion','project-ceo-m2-layout/0.1','layoutContent',content
  ) from source
")
layout_call_a="begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
select projectceo_product_api.append_m2_workspace_revision(
  '${project}','${package}','layout_version','layout-race-a',
  'layout-race-a-revision-r1',null,'published','${layout_a}'::jsonb,
  'DB4 concurrent layout A',${layout_state},'db4-layout-race-a'
); commit;"
layout_call_b="begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
select projectceo_product_api.append_m2_workspace_revision(
  '${project}','${package}','layout_version','layout-race-b',
  'layout-race-b-revision-r1',null,'published','${layout_b}'::jsonb,
  'DB4 concurrent layout B',${layout_state},'db4-layout-race-b'
); commit;"

set +e
psql_exec db4-layout-race-a "${layout_call_a}" >"${tmpdir}/layout-a.out" 2>&1 &
layout_pid_a=$!
psql_exec db4-layout-race-b "${layout_call_b}" >"${tmpdir}/layout-b.out" 2>&1 &
layout_pid_b=$!
wait "${layout_pid_a}"; layout_status_a=$?
wait "${layout_pid_b}"; layout_status_b=$?
set -e

if [[ $(( layout_status_a + layout_status_b )) == 0 ]] \
  || [[ "${layout_status_a}" != "0" && "${layout_status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent layout version race did not select exactly one winner"
  sed -n '1,120p' "${tmpdir}/layout-a.out" >&2
  sed -n '1,120p' "${tmpdir}/layout-b.out" >&2
  exit 1
fi

layout_result=$(psql_exec db4-layout-race-assert "
  select count(*)::text || '|' || count(distinct entity_id)::text
  from projectceo_product.m2_workspace_revisions
  where project_id='${project}' and package_id='${package}'
    and entity_kind='layout_version'
    and payload->>'versionId'='layout-version-concurrent-r1'
")
if [[ "${layout_result}" != "1|1" ]]; then
  print -u2 -r -- "Concurrent layout version race persisted invalid state: ${layout_result}"
  exit 1
fi

# Cycle 6 lock order: after one immutable submission, two client decisions at
# the same workflow revision race. Exactly one review may append; the loser
# must fail stale after waiting on the workflow/revision locks (never deadlock).
cycle6_variants=$(psql_exec db4-cycle6-race-variants "
  select payload->'variants'
  from projectceo_product.m2_workspace_revisions
  where project_id='${project}' and entity_kind='m2_client_submission'
    and entity_id='cycle6-submission'
  order by revision_no desc limit 1
")
cycle6_submit_state=$(psql_exec db4-cycle6-race-submit-state "
  select state_revision
  from project_intelligence.project_workflows
  where project_id='${project}'
")
cycle6_setup=$(psql_exec db4-cycle6-race-setup "
  begin;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  select projectceo_product_api.submit_m2_client_review(
    '${project}','${package}','cycle6-race-submission',
    '75000000-0000-4000-8000-000000000001',null,
    'approval-db4-m2-exact','cycle6-living-room','revision-decision-db4-r1',
    '${cycle6_variants}'::jsonb,
    '2026-08-06T10:00:00+08:00',30,'Concurrent client review snapshot',
    ${cycle6_submit_state},
    'cycle6-race-submit');
  commit;
")
cycle6_state=$(psql_exec db4-cycle6-race-state "
  select state_revision from project_intelligence.project_workflows where project_id='${project}'
")
cycle6_review_a="begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
select projectceo_product_api.review_m2_client_submission(
  '${project}','${package}','cycle6-race-submission',
  '75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000001',
  'cycle6-variant-preferred','approved','Concurrent client approval',
  ${cycle6_state},'cycle6-race-review-a'); commit;"
cycle6_review_b="begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
select projectceo_product_api.review_m2_client_submission(
  '${project}','${package}','cycle6-race-submission',
  '75000000-0000-4000-8000-000000000003','75000000-0000-4000-8000-000000000001',
  'cycle6-variant-preferred','rejected','Concurrent client rejection',
  ${cycle6_state},'cycle6-race-review-b'); commit;"

set +e
psql_exec db4-cycle6-review-a "${cycle6_review_a}" >"${tmpdir}/cycle6-a.out" 2>&1 &
cycle6_pid_a=$!
psql_exec db4-cycle6-review-b "${cycle6_review_b}" >"${tmpdir}/cycle6-b.out" 2>&1 &
cycle6_pid_b=$!
wait "${cycle6_pid_a}"; cycle6_status_a=$?
wait "${cycle6_pid_b}"; cycle6_status_b=$?
set -e

if [[ $(( cycle6_status_a + cycle6_status_b )) == 0 ]] \
  || [[ "${cycle6_status_a}" != "0" && "${cycle6_status_b}" != "0" ]]; then
  print -u2 -r -- "Cycle 6 review race did not select exactly one winner"
  sed -n '1,120p' "${tmpdir}/cycle6-a.out" >&2
  sed -n '1,120p' "${tmpdir}/cycle6-b.out" >&2
  exit 1
fi

cycle6_result=$(psql_exec db4-cycle6-race-assert "
  select count(*)::text || '|' || count(distinct revision_id)::text
  from projectceo_product.m2_workspace_revisions
  where project_id='${project}' and package_id='${package}'
    and entity_kind='m2_client_review' and entity_id='cycle6-race-submission'
")
if [[ "${cycle6_result}" != "1|1" ]]; then
  print -u2 -r -- "Cycle 6 review race persisted invalid state: ${cycle6_result}"
  exit 1
fi

print -r -- "DB4_CONCURRENCY_OK"
