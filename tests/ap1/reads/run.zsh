#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h:h}
image=${PI_DB_IMAGE:-postgres:16-alpine}
container="pi-ap1-read-${$}-${RANDOM}"
database=pi_ap1_read
password=pi_ap1_read_local_only

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

print -r -- "AP1 read harness image: ${image}"
docker run --detach --rm \
  --name "${container}" \
  --network none \
  --tmpfs /var/lib/postgresql/data:rw,size=768m,mode=0700 \
  --entrypoint /bin/sh \
  --env POSTGRES_PASSWORD="${password}" \
  --env POSTGRES_DB="${database}" \
  "${image}" -c \
  'docker-entrypoint.sh postgres & child=$!; wait "$child"; while :; do sleep 3600; done' \
  >/dev/null

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
    print -u2 -r -- 'AP1 read database did not become ready'
    exit 1
  fi
  sleep 0.25
done

run_file "${repo_root}/tests/db2/00_supabase_prelude.sql"
for migration in "${repo_root}"/supabase/migrations/*.sql(N); do
  print -r -- "Applying ${migration:t}"
  run_file "${migration}"
done

# Модули 3 и 4 закрыты в базе по умолчанию (guardrail'ы 20260811010000 и
# 20260811020000), а сценарии ниже публикуют baseline, выдают пакет и
# подтверждают получение из-под роли authenticated. Харнесс — одноразовая среда,
# где модули открыты намеренно; без двух строк включения он падал бы на
# insufficient_privilege, то есть проверял бы не то, ради чего написан.
for sql in \
  "${repo_root}/tests/db3/20_foundation_operations.sql" \
  "${repo_root}/tests/ap1/environment/enable-m3-publication.sql" \
  "${repo_root}/tests/ap1/environment/enable-m4-increment-1.sql" \
  "${repo_root}/tests/db4/20_product_operations.sql" \
  "${repo_root}/tests/db5/20_execution_operations.sql" \
  "${repo_root}/tests/ap1/reads/10_schema_security.sql" \
  "${repo_root}/tests/ap1/reads/15_inventory_duplicate_groups.sql" \
  "${repo_root}/tests/ap1/reads/20_authenticated_read.sql" \
  "${repo_root}/tests/ap1/reads/25_request_bound_replay.sql"; do
  print -r -- "Running ${sql:t}"
  run_file "${sql}"
done

AP1_READ_CONTAINER="${container}" \
AP1_READ_DATABASE="${database}" \
AP1_READ_PASSWORD="${password}" \
  zsh "${repo_root}/tests/ap1/reads/run-concurrency.zsh"

print -r -- 'Restarting database for AP1 read replay proof'
docker exec --user postgres "${container}" \
  pg_ctl restart --wait --timeout=30 --pgdata=/var/lib/postgresql/data \
  >/dev/null
for attempt in {1..120}; do
  if docker exec -e PGPASSWORD="${password}" "${container}" \
      psql -X --tuples-only --no-align \
        --username postgres --dbname "${database}" \
        --command 'select 1' 2>/dev/null \
      | rg -qx '1'; then
    break
  fi
  if (( attempt == 120 )); then
    print -u2 -r -- 'AP1 read database did not return after restart'
    exit 1
  fi
  sleep 0.25
done
run_file "${repo_root}/tests/ap1/reads/25_request_bound_replay.sql"
run_file "${repo_root}/tests/ap1/reads/30_restart_read.sql"

print -r -- "AP1_AUTHENTICATED_READ_HARNESS_OK image=${image}"
