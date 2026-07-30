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

print -r -- "DB4_CONCURRENCY_OK"
