#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

: "${PI_DB2_CONTAINER:?PI_DB2_CONTAINER is required}"
: "${PI_DB2_DATABASE:?PI_DB2_DATABASE is required}"
: "${PI_DB2_PASSWORD:?PI_DB2_PASSWORD is required}"

container=${PI_DB2_CONTAINER}
database=${PI_DB2_DATABASE}
password=${PI_DB2_PASSWORD}
owner_user=11111111-1111-4111-8111-111111111111
organization=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/pi-db2-concurrency.XXXXXX")
blocker_backend_pid=
blocker_job_pid=

psql_exec() {
  local application_name=$1
  local sql=$2
  docker exec \
    -e PGPASSWORD="${password}" \
    -e PGAPPNAME="${application_name}" \
    "${container}" \
    psql -X --quiet --tuples-only --no-align \
      --set ON_ERROR_STOP=1 \
      --set VERBOSITY=verbose \
      --username postgres \
      --dbname "${database}" \
      --command "${sql}"
}

scalar() {
  psql_exec db2-harness-scalar "$1" | tail -n 1
}

cleanup() {
  if [[ -n "${blocker_backend_pid}" ]]; then
    scalar "select pg_terminate_backend(${blocker_backend_pid})" >/dev/null 2>&1 \
      || true
  fi
  rm -rf "${tmpdir}"
}
trap cleanup EXIT INT TERM

human_sql() {
  local call=$1
  print -r -- "begin;
set local statement_timeout = '15s';
set local role authenticated;
set local request.jwt.claim.sub = '${owner_user}';
select ${call};
commit;"
}

run_capture() {
  local application_name=$1
  local output=$2
  local sql=$3
  set +e
  psql_exec "${application_name}" "${sql}" >"${output}" 2>&1
  print -r -- "$?" >"${output}.status"
  return 0
}

start_blocker() {
  local tag=$1
  local project_id=$2
  local blocker_app="db2-blocker-${tag}"
  local blocker_output="${tmpdir}/${tag}-blocker.out"
  local sql="begin;
set local statement_timeout = '45s';
select 1
from project_intelligence.project_workflows
where organization_id = '${organization}'
  and project_id = '${project_id}'
for update;
select pg_sleep(30);
rollback;"

  run_capture "${blocker_app}" "${blocker_output}" "${sql}" &
  blocker_job_pid=$!

  blocker_backend_pid=
  for attempt in {1..120}; do
    blocker_backend_pid=$(scalar "
      select pid
      from pg_stat_activity
      where application_name = '${blocker_app}'
        and wait_event = 'PgSleep'
      limit 1
    " 2>/dev/null || true)
    if [[ -n "${blocker_backend_pid}" ]]; then
      return 0
    fi
    sleep 0.05
  done

  print -u2 -r -- "Blocker did not acquire workflow lock: ${tag}"
  return 1
}

release_blocker_after_waiters() {
  local tag=$1
  local app_a="db2-${tag}-a"
  local app_b="db2-${tag}-b"
  local waiter_count=0

  for attempt in {1..200}; do
    waiter_count=$(scalar "
      select count(*)
      from pg_stat_activity
      where application_name in ('${app_a}', '${app_b}')
        and wait_event_type = 'Lock'
    " 2>/dev/null || print -r -- 0)
    if [[ "${waiter_count}" == "2" ]]; then
      break
    fi
    sleep 0.05
  done

  if [[ "${waiter_count}" != "2" ]]; then
    print -u2 -r -- "Expected two lock waiters for ${tag}, got ${waiter_count}"
    for output in \
      "${tmpdir}/${tag}-blocker.out" \
      "${tmpdir}/${tag}-a.out" \
      "${tmpdir}/${tag}-b.out"; do
      if [[ -f "${output}" ]]; then
        print -u2 -r -- "--- ${output:t} ---"
        sed -n '1,120p' "${output}" >&2
      fi
    done
    return 1
  fi

  scalar "select pg_terminate_backend(${blocker_backend_pid})" >/dev/null
  blocker_backend_pid=
  wait "${blocker_job_pid}" || true
  blocker_job_pid=
}

run_locked_pair() {
  local tag=$1
  local project_id=$2
  local sql_a=$3
  local sql_b=$4
  local out_a="${tmpdir}/${tag}-a.out"
  local out_b="${tmpdir}/${tag}-b.out"

  start_blocker "${tag}" "${project_id}"
  run_capture "db2-${tag}-a" "${out_a}" "${sql_a}" &
  local pid_a=$!
  run_capture "db2-${tag}-b" "${out_b}" "${sql_b}" &
  local pid_b=$!
  release_blocker_after_waiters "${tag}"
  wait "${pid_a}"
  wait "${pid_b}"

  PAIR_OUT_A=${out_a}
  PAIR_OUT_B=${out_b}
  PAIR_STATUS_A=$(<"${out_a}.status")
  PAIR_STATUS_B=$(<"${out_b}.status")
}

match_count() {
  local pattern=$1
  shift
  local count=0
  local current
  local file
  for file in "$@"; do
    current=$(
      (rg -o "${pattern}" "${file}" 2>/dev/null || true) \
        | wc -l \
        | tr -d ' '
    )
    (( count += ${current:-0} ))
  done
  print -r -- "${count}"
}

assert_scalar() {
  local expected=$1
  local sql=$2
  local actual
  actual=$(scalar "${sql}")
  if [[ "${actual}" != "${expected}" ]]; then
    print -u2 -r -- "Scalar assertion failed: expected=${expected} actual=${actual}"
    print -u2 -r -- "SQL: ${sql}"
    exit 1
  fi
}

assert_one_success_one_error() {
  local expected_error=$1
  if ! {
    [[ "${PAIR_STATUS_A}" == "0" && "${PAIR_STATUS_B}" != "0" ]] \
      || [[ "${PAIR_STATUS_B}" == "0" && "${PAIR_STATUS_A}" != "0" ]]
  }; then
    print -u2 -r -- \
      "Expected one success/one error; statuses=${PAIR_STATUS_A},${PAIR_STATUS_B}"
    sed -n '1,120p' "${PAIR_OUT_A}" >&2
    sed -n '1,120p' "${PAIR_OUT_B}" >&2
    exit 1
  fi
  if [[ $(match_count "${expected_error}" "${PAIR_OUT_A}" "${PAIR_OUT_B}") != "1" ]]; then
    print -u2 -r -- "Expected exactly one ${expected_error}"
    sed -n '1,120p' "${PAIR_OUT_A}" >&2
    sed -n '1,120p' "${PAIR_OUT_B}" >&2
    exit 1
  fi
}

replay_project=10000000-0000-4000-8000-000000000002
replay_call="project_intelligence_api.review_claim(
  '${replay_project}',
  'decision-r1',
  'decision-r1',
  0,
  'confirmed',
  'concurrent-same-key'
)"
run_locked_pair \
  replay \
  "${replay_project}" \
  "$(human_sql "${replay_call}")" \
  "$(human_sql "${replay_call}")"

if [[ "${PAIR_STATUS_A}" != "0" || "${PAIR_STATUS_B}" != "0" ]] \
  || [[ $(match_count '"replay": false' "${PAIR_OUT_A}" "${PAIR_OUT_B}") != "1" ]] \
  || [[ $(match_count '"replay": true' "${PAIR_OUT_A}" "${PAIR_OUT_B}") != "1" ]]; then
  print -u2 -r -- "Concurrent same-key replay contract failed"
  sed -n '1,120p' "${PAIR_OUT_A}" >&2
  sed -n '1,120p' "${PAIR_OUT_B}" >&2
  exit 1
fi

assert_scalar "1|1|1|1" "
  select
    pw.state_revision::text
    || '|' || count(distinct hr.review_id)::text
    || '|' || count(distinct cr.command_id)::text
    || '|' || count(distinct ae.audit_event_id)::text
  from project_intelligence.project_workflows pw
  left join project_intelligence.human_reviews hr
    on hr.organization_id = pw.organization_id
   and hr.project_id = pw.project_id
  left join project_intelligence.command_records cr
    on cr.organization_id = pw.organization_id
   and cr.project_id = pw.project_id
  left join project_intelligence.audit_events ae
    on ae.organization_id = pw.organization_id
   and ae.project_id = pw.project_id
  where pw.organization_id = '${organization}'
    and pw.project_id = '${replay_project}'
  group by pw.state_revision
"

stale_project=10000000-0000-4000-8000-000000000003
stale_call_a="project_intelligence_api.review_claim(
  '${stale_project}',
  'decision-r1',
  'decision-r1',
  0,
  'confirmed',
  'concurrent-stale-a'
)"
stale_call_b="project_intelligence_api.review_claim(
  '${stale_project}',
  'decision-r1',
  'decision-r1',
  0,
  'confirmed',
  'concurrent-stale-b'
)"
run_locked_pair \
  stale \
  "${stale_project}" \
  "$(human_sql "${stale_call_a}")" \
  "$(human_sql "${stale_call_b}")"
assert_one_success_one_error 'P1006: STATE_STALE'
assert_scalar "1|1|1|1" "
  select
    pw.state_revision::text
    || '|' || count(distinct hr.review_id)::text
    || '|' || count(distinct cr.command_id)::text
    || '|' || count(distinct ae.audit_event_id)::text
  from project_intelligence.project_workflows pw
  left join project_intelligence.human_reviews hr
    on hr.organization_id = pw.organization_id
   and hr.project_id = pw.project_id
  left join project_intelligence.command_records cr
    on cr.organization_id = pw.organization_id
   and cr.project_id = pw.project_id
  left join project_intelligence.audit_events ae
    on ae.organization_id = pw.organization_id
   and ae.project_id = pw.project_id
  where pw.organization_id = '${organization}'
    and pw.project_id = '${stale_project}'
  group by pw.state_revision
"

publication_project=10000000-0000-4000-8000-000000000004
publication_call_a="project_intelligence_api.publish_version(
  '${publication_project}',
  null,
  0,
  'Concurrent baseline',
  '[]'::jsonb,
  'concurrent-publication-a'
)"
publication_call_b="project_intelligence_api.publish_version(
  '${publication_project}',
  null,
  0,
  'Concurrent baseline',
  '[]'::jsonb,
  'concurrent-publication-b'
)"
run_locked_pair \
  publication \
  "${publication_project}" \
  "$(human_sql "${publication_call_a}")" \
  "$(human_sql "${publication_call_b}")"
assert_one_success_one_error 'P1006: STATE_STALE'
assert_scalar "1|1|1|1|1" "
  select
    pw.state_revision::text
    || '|' || count(distinct pv.version_id)::text
    || '|' || min(pv.version_no)::text
    || '|' || count(distinct cr.command_id)::text
    || '|' || count(distinct ae.audit_event_id)::text
  from project_intelligence.project_workflows pw
  left join project_intelligence.project_versions pv
    on pv.organization_id = pw.organization_id
   and pv.project_id = pw.project_id
  left join project_intelligence.command_records cr
    on cr.organization_id = pw.organization_id
   and cr.project_id = pw.project_id
  left join project_intelligence.audit_events ae
    on ae.organization_id = pw.organization_id
   and ae.project_id = pw.project_id
  where pw.organization_id = '${organization}'
    and pw.project_id = '${publication_project}'
  group by pw.state_revision
"

impact_project=10000000-0000-4000-8000-000000000005
impact_run_id=$(scalar "
  select impact_run_id
  from project_intelligence.impact_runs
  where organization_id = '${organization}'
    and project_id = '${impact_project}'
")
impact_id=$(scalar "
  select impact_id
  from project_intelligence.impacts
  where organization_id = '${organization}'
    and project_id = '${impact_project}'
")
if [[ -z "${impact_run_id}" || -z "${impact_id}" ]]; then
  print -u2 -r -- "Impact concurrency fixture is incomplete"
  exit 1
fi
impact_call_a="project_intelligence_api.review_impact(
  '${impact_project}',
  '${impact_run_id}',
  '${impact_id}',
  'needs_review',
  'accepted',
  'downstream_update_required',
  5,
  'concurrent-impact-a'
)"
impact_call_b="project_intelligence_api.review_impact(
  '${impact_project}',
  '${impact_run_id}',
  '${impact_id}',
  'needs_review',
  'accepted',
  'downstream_update_required',
  5,
  'concurrent-impact-b'
)"
run_locked_pair \
  impact \
  "${impact_project}" \
  "$(human_sql "${impact_call_a}")" \
  "$(human_sql "${impact_call_b}")"
assert_one_success_one_error 'P1006: STATE_STALE'
assert_scalar "6|1|6|6" "
  select
    pw.state_revision::text
    || '|' || count(distinct ir.impact_review_id)::text
    || '|' || count(distinct cr.command_id)::text
    || '|' || count(distinct ae.audit_event_id)::text
  from project_intelligence.project_workflows pw
  left join project_intelligence.impact_reviews ir
    on ir.organization_id = pw.organization_id
   and ir.project_id = pw.project_id
  left join project_intelligence.command_records cr
    on cr.organization_id = pw.organization_id
   and cr.project_id = pw.project_id
  left join project_intelligence.audit_events ae
    on ae.organization_id = pw.organization_id
   and ae.project_id = pw.project_id
  where pw.organization_id = '${organization}'
    and pw.project_id = '${impact_project}'
  group by pw.state_revision
"

# Restart the actual disposable database process, establish a new connection,
# and replay the already committed same-key command.
docker restart "${container}" >/dev/null
for attempt in {1..120}; do
  if scalar 'select 1' >/dev/null 2>&1; then
    break
  fi
  if (( attempt == 120 )); then
    print -u2 -r -- "Database did not recover after restart"
    exit 1
  fi
  sleep 0.25
done

restart_output="${tmpdir}/restart-replay.out"
run_capture \
  db2-restart-replay \
  "${restart_output}" \
  "$(human_sql "${replay_call}")"
restart_status=$(<"${restart_output}.status")
if [[ "${restart_status}" != "0" ]] \
  || [[ $(match_count '"replay": true' "${restart_output}") != "1" ]]; then
  print -u2 -r -- "Committed result did not replay after database restart"
  sed -n '1,160p' "${restart_output}" >&2
  exit 1
fi

assert_scalar "1|1|1|1" "
  select
    pw.state_revision::text
    || '|' || count(distinct hr.review_id)::text
    || '|' || count(distinct cr.command_id)::text
    || '|' || count(distinct ae.audit_event_id)::text
  from project_intelligence.project_workflows pw
  left join project_intelligence.human_reviews hr
    on hr.organization_id = pw.organization_id
   and hr.project_id = pw.project_id
  left join project_intelligence.command_records cr
    on cr.organization_id = pw.organization_id
   and cr.project_id = pw.project_id
  left join project_intelligence.audit_events ae
    on ae.organization_id = pw.organization_id
   and ae.project_id = pw.project_id
  where pw.organization_id = '${organization}'
    and pw.project_id = '${replay_project}'
  group by pw.state_revision
"

print -r -- "DB2_CONCURRENCY_AND_RESTART_OK"
