#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

: "${PI_DBIG_CONTAINER:?PI_DBIG_CONTAINER is required}"
: "${PI_DBIG_DATABASE:?PI_DBIG_DATABASE is required}"
: "${PI_DBIG_PASSWORD:?PI_DBIG_PASSWORD is required}"

container=${PI_DBIG_CONTAINER}
database=${PI_DBIG_DATABASE}
password=${PI_DBIG_PASSWORD}
project=71111111-1111-4111-8111-111111111111
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/pi-dbig-concurrency.XXXXXX")
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

org_id=$(psql_exec dbig-concurrency-org "
  select organization_id::text
  from project_intelligence.project_workflows
  where project_id = '${project}'
")
connection_id=$(psql_exec dbig-concurrency-connection "
  select c.id::text
  from remhaos_integration.connections c
  where c.organization_id = '${org_id}'
    and c.provider_code = 'google_drive'
")

psql_exec dbig-concurrency-seed "
begin;
set local role service_role;
select remhaos_integration_api.enqueue_integration_job(
  '${org_id}',
  '${project}',
  '${connection_id}',
  'concurrent_claim',
  'dbig-concurrent-claim',
  '{}'::jsonb
);
commit;" >/dev/null

claim_call="begin;
set local role service_role;
select remhaos_integration_api.claim_integration_jobs(1, 60);
select pg_sleep(0.5);
commit;"

set +e
psql_exec dbig-claim-a "${claim_call}" >"${tmpdir}/claim-a.out" 2>&1 &
pid_a=$!
psql_exec dbig-claim-b "${claim_call}" >"${tmpdir}/claim-b.out" 2>&1 &
pid_b=$!
wait "${pid_a}"; status_a=$?
wait "${pid_b}"; status_b=$?
set -e

if [[ "${status_a}" != "0" || "${status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent claim failed"
  sed -n '1,120p' "${tmpdir}/claim-a.out" >&2
  sed -n '1,120p' "${tmpdir}/claim-b.out" >&2
  exit 1
fi

result=$(psql_exec dbig-claim-assert "
  select count(*)::text
    || '|' || count(*) filter (where status = 'leased')::text
    || '|' || coalesce(max(attempt_count), 0)::text
  from remhaos_integration.sync_jobs
  where job_kind = 'concurrent_claim'
")
if [[ "${result}" != "1|1|1" ]]; then
  print -u2 -r -- "Concurrent claim persisted invalid state: ${result}"
  exit 1
fi

job_info=$(psql_exec dbig-claim-job "
  select id::text || '|' || lease_token::text
  from remhaos_integration.sync_jobs
  where job_kind = 'concurrent_claim'
")
job_id=${job_info%%|*}
lease_token=${job_info##*|}

complete_call_a="begin;
set local role service_role;
select remhaos_integration_api.complete_integration_job(
  '${job_id}',
  '${lease_token}',
  '{\"result\":\"a\"}'::jsonb,
  'dbig-concurrent-complete-a'
);
commit;"
complete_call_b="begin;
set local role service_role;
select remhaos_integration_api.complete_integration_job(
  '${job_id}',
  '${lease_token}',
  '{\"result\":\"b\"}'::jsonb,
  'dbig-concurrent-complete-b'
);
commit;"

set +e
psql_exec dbig-complete-a "${complete_call_a}" >"${tmpdir}/complete-a.out" 2>&1 &
pid_a=$!
psql_exec dbig-complete-b "${complete_call_b}" >"${tmpdir}/complete-b.out" 2>&1 &
pid_b=$!
wait "${pid_a}"; status_a=$?
wait "${pid_b}"; status_b=$?
set -e

if [[ "${status_a}:${status_b}" != "0:1" && "${status_a}:${status_b}" != "1:0" ]]; then
  print -u2 -r -- "Concurrent complete did not fence one worker"
  sed -n '1,120p' "${tmpdir}/complete-a.out" >&2
  sed -n '1,120p' "${tmpdir}/complete-b.out" >&2
  exit 1
fi

if ! rg -q 'lease_conflict|P1208' \
    "${tmpdir}/complete-a.out" "${tmpdir}/complete-b.out"; then
  print -u2 -r -- "Concurrent complete failure was not a lease conflict"
  sed -n '1,120p' "${tmpdir}/complete-a.out" >&2
  sed -n '1,120p' "${tmpdir}/complete-b.out" >&2
  exit 1
fi

result=$(psql_exec dbig-complete-assert "
  select count(*)::text
    || '|' || count(*) filter (where status = 'succeeded')::text
    || '|' || count(*) filter (where lease_token is null)::text
  from remhaos_integration.sync_jobs
  where job_kind = 'concurrent_claim'
")
if [[ "${result}" != "1|1|1" ]]; then
  print -u2 -r -- "Concurrent complete persisted invalid state: ${result}"
  exit 1
fi

print -r -- "DBIG_CONCURRENCY_OK"
