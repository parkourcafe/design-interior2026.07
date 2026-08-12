#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

: "${PI_DB5_CONTAINER:?PI_DB5_CONTAINER is required}"
: "${PI_DB5_DATABASE:?PI_DB5_DATABASE is required}"
: "${PI_DB5_PASSWORD:?PI_DB5_PASSWORD is required}"

container=${PI_DB5_CONTAINER}
database=${PI_DB5_DATABASE}
password=${PI_DB5_PASSWORD}
project=41111111-1111-4111-8111-111111111111
package=41111111-1111-4111-8111-111111111111
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/pi-db5-concurrency.XXXXXX")
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

state=$(psql_exec db5-concurrency-state "
  select state_revision
  from project_intelligence.project_workflows
  where project_id = '${project}'
")

# Роль та же, что у остальных вызовов инкремента 2 в `20_execution_operations`:
# `authenticated` эти RPC не видит и не должен, а конкурентность проверяется на
# том же пути, что и одиночный вызов, иначе она проверяла бы другой путь.
call="begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_m4_api.define_milestone(
  '${project}',
  '${package}',
  'package-db4-root-v1',
  'Concurrent replay milestone',
  '[\"node-area-db4\"]'::jsonb,
  ${state},
  'db5-concurrent-milestone'
);
commit;"

set +e
psql_exec db5-milestone-a "${call}" >"${tmpdir}/a.out" 2>&1 &
pid_a=$!
psql_exec db5-milestone-b "${call}" >"${tmpdir}/b.out" 2>&1 &
pid_b=$!
wait "${pid_a}"; status_a=$?
wait "${pid_b}"; status_b=$?
set -e

if [[ "${status_a}" != "0" || "${status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent M4 milestone failed"
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
  print -u2 -r -- "Concurrent M4 replay contract failed"
  sed -n '1,160p' "${tmpdir}/a.out" >&2
  sed -n '1,160p' "${tmpdir}/b.out" >&2
  exit 1
fi

expected_state=$(( state + 1 ))
result=$(psql_exec db5-concurrency-assert "
  select workflow.state_revision::text
    || '|' || count(distinct milestone.milestone_id)::text
    || '|' || count(distinct command.command_id)::text
  from project_intelligence.project_workflows workflow
  left join projectceo_m4.milestones milestone
    on milestone.organization_id = workflow.organization_id
   and milestone.project_id = workflow.project_id
   and milestone.title = 'Concurrent replay milestone'
  left join projectceo_product.command_records command
    on command.organization_id = workflow.organization_id
   and command.project_id = workflow.project_id
   and command.operation = 'define_milestone'
   and command.logical_result ->> 'title' =
     'Concurrent replay milestone'
  where workflow.project_id = '${project}'
  group by workflow.state_revision
")
if [[ "${result}" != "${expected_state}|1|1" ]]; then
  print -u2 -r -- "Concurrent M4 state invalid: ${result}"
  exit 1
fi

print -r -- "DB5_CONCURRENCY_OK"
