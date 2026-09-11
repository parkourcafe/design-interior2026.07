#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE
: "${PI_DB4_CONTAINER:?disposable DB4 container required}"
: "${PI_DB4_DATABASE:?disposable DB4 database required}"
: "${PI_DB4_PASSWORD:?disposable DB4 password required}"
[[ "${PI_DB4_DATABASE}" =~ '^[a-zA-Z0-9_]+$' ]] || exit 1
legal_database="consent_race_${$}_${RANDOM}"
legal_tmp=$(mktemp -d "${TMPDIR:-/tmp}/consent-race.XXXXXX")
psql_call() {
  docker exec -e PGPASSWORD="${PI_DB4_PASSWORD}" -e PGAPPNAME="$1" "${PI_DB4_CONTAINER}" \
    psql -X --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$2" --command "$3"
}
cleanup() {
  psql_call legal-cleanup "${PI_DB4_DATABASE}" "drop database if exists ${legal_database} with (force)" >/dev/null 2>&1 || true
  rm -rf "${legal_tmp}"
}
trap cleanup EXIT INT TERM
# Two connections need committed fixtures. They live only in a throwaway clone,
# never in the normal DB4 database whose legal fixtures are rolled back.
psql_call legal-clone "${PI_DB4_DATABASE}" "create database ${legal_database} template ${PI_DB4_DATABASE}"
psql_call legal-seed "${legal_database}" "
insert into remhaos_legal.document_versions(id,purpose,version,body,operator,status,effective_at,approved_at,approval_reference)
values ('61000000-0000-4000-8000-000000000001','account','race-fixture','TEST ONLY concurrent acceptance','Synthetic operator','approved','2020-01-01','2020-01-01','disposable clone only');
insert into remhaos_legal.active_requirements values ('account','61000000-0000-4000-8000-000000000001',600,'disposable clone only');"
wait_state() {
  local app="$1" state="$2"
  for attempt in {1..100}; do
    if [[ "$(psql_call legal-observe "${legal_database}" "select count(*) from pg_stat_activity where application_name='${app}' and wait_event='${state}'")" == 1 ]]; then return; fi
    sleep 0.025
  done
  print -u2 -- "CONSENT_RACE_MISSING_STATE ${app} ${state}"
  exit 1
}
accept_call="select public.record_browser_consent('account','',repeat('e',64),'61000000-0000-4000-8000-000000000001',true,'61000000-0000-4000-8000-000000000002');"
psql_call legal-accept-first "${legal_database}" "begin; set local role anon; ${accept_call} select pg_sleep(2); commit;" >"${legal_tmp}/first" 2>&1 &
first_pid=$!
wait_state legal-accept-first PgSleep
psql_call legal-accept-second "${legal_database}" "set role anon; ${accept_call}" >"${legal_tmp}/second" 2>&1 &
second_pid=$!
wait_state legal-accept-second advisory
wait "${first_pid}"
wait "${second_pid}"
[[ "$(psql_call legal-count "${legal_database}" 'select count(*) from remhaos_legal.receipts')" == 1 ]] || { print -u2 -- 'CONSENT_RACE_DUPLICATE_RECEIPTS'; exit 1; }
receipt_id=$(psql_call legal-id "${legal_database}" 'select id from remhaos_legal.receipts')
psql_call legal-withdraw "${legal_database}" "begin; set local role anon; select public.withdraw_browser_consent('account','',repeat('e',64),'${receipt_id}'); select pg_sleep(2); commit;" >"${legal_tmp}/withdraw" 2>&1 &
withdraw_pid=$!
wait_state legal-withdraw PgSleep
psql_call legal-replay "${legal_database}" "set role anon; ${accept_call}" >"${legal_tmp}/replay" 2>&1 &
replay_pid=$!
wait_state legal-replay advisory
wait "${withdraw_pid}"
if wait "${replay_pid}"; then print -u2 -- 'CONSENT_RACE_WITHDRAWAL_REPLAY_ALLOWED'; exit 1; fi
rg -q 'consent_request_no_longer_active' "${legal_tmp}/replay"
[[ "$(psql_call legal-check "${legal_database}" "set role anon; select public.has_browser_consent('account','',repeat('e',64))")" == f ]] || { print -u2 -- 'CONSENT_RACE_WITHDRAWAL_IGNORED'; exit 1; }
print -r -- 'DB4_CONSENT_CONCURRENCY_OK'
