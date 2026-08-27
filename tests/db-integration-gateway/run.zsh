#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h}
image=${PI_DB_IMAGE:-postgres:16-alpine}
container="pi-dbig-${$}-${RANDOM}"
database=pi_dbig
password=pi_dbig_local_only

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

print -r -- "DBIG harness image: ${image}"
docker run --detach --rm \
  --name "${container}" \
  --network none \
  --env POSTGRES_PASSWORD="${password}" \
  --env POSTGRES_DB="${database}" \
  "${image}" >/dev/null

for attempt in {1..120}; do
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
    print -u2 -r -- "DBIG database did not become ready"
    exit 1
  fi
  sleep 0.25
done

run_file "${repo_root}/tests/db2/00_supabase_prelude.sql"
for migration in "${repo_root}"/supabase/migrations/*.sql(N); do
  print -r -- "Applying ${migration:t}"
  run_file "${migration}"
done

for sql in \
  "${repo_root}/tests/db-integration-gateway/10_schema_security.sql" \
  "${repo_root}/tests/db-integration-gateway/20_registry_operations.sql" \
  "${repo_root}/tests/db-integration-gateway/40_project_links.sql" \
  "${repo_root}/tests/db-integration-gateway/50_file_intake.sql" \
  "${repo_root}/tests/db-integration-gateway/60_telegram_staging.sql" \
  "${repo_root}/tests/db-integration-gateway/70_google_drive_staging.sql"; do
  print -r -- "Running ${sql:t}"
  run_file "${sql}"
done

PI_DBIG_CONTAINER="${container}" \
PI_DBIG_DATABASE="${database}" \
PI_DBIG_PASSWORD="${password}" \
  "${repo_root}/tests/db-integration-gateway/run-concurrency.zsh"

print -r -- "Restarting database for DBIG replay proof"
docker restart "${container}" >/dev/null
for attempt in {1..120}; do
  if docker exec -e PGPASSWORD="${password}" "${container}" \
      psql -X --tuples-only --no-align \
        --username postgres --dbname "${database}" \
        --command 'select 1' 2>/dev/null \
      | rg -qx '1'; then
    break
  fi
  if (( attempt == 120 )); then
    print -u2 -r -- "DBIG database did not return after restart"
    exit 1
  fi
  sleep 0.25
done
run_file "${repo_root}/tests/db-integration-gateway/30_restart_replay.sql"

print -r -- "DBIG_INTEGRATION_GATEWAY_HARNESS_OK image=${image}"
