#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

: ${AP1_READ_CONTAINER:?AP1_READ_CONTAINER is required}
: ${AP1_READ_DATABASE:?AP1_READ_DATABASE is required}
: ${AP1_READ_PASSWORD:?AP1_READ_PASSWORD is required}

tmp_dir=$(mktemp -d /private/tmp/projectceo-ap1-read-concurrency.XXXXXX)
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT INT TERM

run_actor() {
  local actor=$1
  local package=$2
  local output=$3
  docker exec -e PGPASSWORD="${AP1_READ_PASSWORD}" -i "${AP1_READ_CONTAINER}" \
    psql -X --set ON_ERROR_STOP=1 --tuples-only --no-align \
      --username postgres --dbname "${AP1_READ_DATABASE}" \
      --command "begin; set local role authenticated; set local request.jwt.claim.sub = '${actor}'; select jsonb_array_length(projectceo_read_api.get_project_workspace_read('41111111-1111-4111-8111-111111111111', ${package}) #> '{data,packages}'); rollback;" \
      > "${output}"
}

run_m4_replay() {
  local output=$1
  docker exec -e PGPASSWORD="${AP1_READ_PASSWORD}" -i "${AP1_READ_CONTAINER}" \
    psql -X --set ON_ERROR_STOP=1 --tuples-only --no-align \
      --username postgres --dbname "${AP1_READ_DATABASE}" \
      --command "begin; set local role authenticated; set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111'; select coalesce((projectceo_m4_api.replay_submit_change_request('41111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111', 'baseline-db4-v1', 'baseline-db5-v2', 'package-db4-root-v1', 'Client approved a floor finish replacement', 175000, 4, 'db5-submit-change') ->> 'replay')::boolean, false); rollback;" \
      > "${output}"
}

typeset -a pids
for iteration in {1..8}; do
  run_actor \
    '31111111-1111-4111-8111-111111111111' \
    'null' \
    "${tmp_dir}/owner-${iteration}.out" &
  pids+=("$!")
  run_actor \
    '32222222-2222-4222-8222-222222222222' \
    'null' \
    "${tmp_dir}/architect-${iteration}.out" &
  pids+=("$!")
  run_actor \
    '34444444-4444-4444-8444-444444444444' \
    "'41111111-1111-4111-8111-111111111111'::uuid" \
    "${tmp_dir}/builder-${iteration}.out" &
  pids+=("$!")
  run_m4_replay "${tmp_dir}/m4-replay-${iteration}.out" &
  pids+=("$!")
done

for pid in ${pids[@]}; do
  wait "${pid}"
done

for output in "${tmp_dir}"/owner-*.out "${tmp_dir}"/architect-*.out; do
  rg -qx '2' "${output}"
done
for output in "${tmp_dir}"/builder-*.out; do
  rg -qx '1' "${output}"
done
for output in "${tmp_dir}"/m4-replay-*.out; do
  rg -qx 't' "${output}"
done

print -r -- 'AP1_READ_CONCURRENCY_OK'
