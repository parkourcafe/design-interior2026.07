#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h}
image=${PI_DB_IMAGE:-postgres:16-alpine}
container="pi-db2-${$}-${RANDOM}"
database=pi_db2
password=pi_db2_local_only

cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

run_file() {
  local file=$1
  docker exec -e PGPASSWORD="${password}" -i "${container}" \
    psql -X --set ON_ERROR_STOP=1 --username postgres --dbname "${database}" \
    < "${file}"
}

print -r -- "DB2 harness image: ${image}"
docker run --detach --rm \
  --name "${container}" \
  --network none \
  --env POSTGRES_PASSWORD="${password}" \
  --env POSTGRES_DB="${database}" \
  "${image}" >/dev/null

for attempt in {1..120}; do
  # pg_isready can briefly succeed against the temporary postmaster that the
  # official image uses during initdb, immediately before that server shuts
  # down. Wait for the entrypoint's completed-init marker and then verify the
  # final postmaster with an actual query.
  if docker logs "${container}" 2>&1 \
      | rg -q 'PostgreSQL init process complete; ready for start up\.' \
    && docker exec -e PGPASSWORD="${password}" "${container}" \
      psql -X --tuples-only --no-align \
        --username postgres --dbname "${database}" \
        --command 'select 1' 2>/dev/null \
      | rg -qx '1'; then
    break
  fi
  if (( attempt == 120 )); then
    print -u2 -r -- "DB2 database did not become ready"
    exit 1
  fi
  sleep 0.25
done

run_file "${repo_root}/tests/db2/00_supabase_prelude.sql"

active_migrations=("${repo_root}"/supabase/migrations/*.sql(N))
if (( ${#active_migrations} == 0 )); then
  print -u2 -r -- "No active migrations found"
  exit 1
fi

for migration in "${active_migrations[@]}"; do
  name=${migration:t}
  if [[ ! "${name}" =~ '^[0-9]{14}_[a-z0-9_]+\.sql$' ]]; then
    print -u2 -r -- "Migration is not timestamped: ${name}"
    exit 1
  fi
done

baseline=${active_migrations[1]}
if [[ "${baseline:t}" != *_legacy_production_baseline.sql ]]; then
  print -u2 -r -- "First migration is not the production adoption baseline: ${baseline:t}"
  exit 1
fi

print -r -- "Applying ${baseline:t}"
run_file "${baseline}"
run_file "${repo_root}/tests/db2/10_legacy_baseline_assertions.sql"

if docker exec -e PGPASSWORD="${password}" -i "${container}" \
  psql -X --set ON_ERROR_STOP=1 --username postgres --dbname "${database}" \
  < "${baseline}" >/dev/null 2>&1; then
  print -u2 -r -- "Baseline guard failed: a second execution unexpectedly succeeded"
  exit 1
fi
print -r -- "LEGACY_BASELINE_REAPPLY_GUARD_OK"

if [[ "${PI_DB2_STOP_AFTER_BASELINE:-0}" == "1" ]]; then
  print -r -- "DB2_BASELINE_HARNESS_OK image=${image}"
  exit 0
fi

for migration in "${active_migrations[@]}"; do
  if [[ "${migration}" == "${baseline}" ]]; then
    continue
  fi
  name=${migration:t}
  print -r -- "Applying ${name}"
  run_file "${migration}"
done

run_file "${repo_root}/tests/db2/20_schema_assertions.sql"
run_file "${repo_root}/tests/db2/25_canonical_json_assertions.sql"

operation_tests=(
  "${repo_root}/tests/db2/30_seed_and_operations.sql"
  "${repo_root}/tests/db2/31_security_and_rollback.sql"
  "${repo_root}/tests/db2/32_p1_security_region_golden.sql"
  "${repo_root}/tests/db2/33_auth_hook.sql"
)

for sql in "${operation_tests[@]}"; do
  if [[ ! -f "${sql}" ]]; then
    print -u2 -r -- "Required DB2 operation test is missing: ${sql:t}"
    exit 1
  fi
  print -r -- "Running ${sql:t}"
  run_file "${sql}"
done

if [[ ! -x "${repo_root}/tests/db2/run-concurrency.zsh" ]]; then
  print -u2 -r -- "Required executable concurrency harness is missing"
  exit 1
fi

PI_DB2_CONTAINER="${container}" \
PI_DB2_DATABASE="${database}" \
PI_DB2_PASSWORD="${password}" \
  "${repo_root}/tests/db2/run-concurrency.zsh"

print -r -- "DB2_HARNESS_OK image=${image}"
