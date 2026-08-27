#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h}
image=${PI_DB_IMAGE:-postgres:16-alpine}
container="pi-dbig-upgrade-${$}-${RANDOM}"
database=pi_dbig_upgrade
password=pi_dbig_upgrade_local_only
log="/private/tmp/${container}.log"

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

run_inline() {
  docker exec -e PGPASSWORD="${password}" -i "${container}" \
    psql -X --set ON_ERROR_STOP=1 --username postgres --dbname "${database}"
}

print -r -- "DBIG upgrade harness image: ${image}"
: > "${log}"
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
    print -u2 -r -- "DBIG upgrade database did not become ready"
    exit 1
  fi
  sleep 0.25
done

run_file "${repo_root}/tests/db2/00_supabase_prelude.sql" >> "${log}" 2>&1
for migration in "${repo_root}"/supabase/migrations/202607*.sql(N); do
  print -r -- "Applying pre-PR ${migration:t}" >> "${log}"
  run_file "${migration}" >> "${log}" 2>&1
done

# Populate the database using only the existing pre-Integration-Gateway tables
# and enrollment RPC. The full DB3 fixture has an intentionally independent
# capability-count assertion and is not an upgrade seed.
run_inline >> "${log}" 2>&1 <<'SQL'
insert into auth.users (id, email, email_confirmed_at) values
  ('81111111-1111-4111-8111-111111111111', 'upgrade-owner@example.test', statement_timestamp()),
  ('82222222-2222-4222-8222-222222222222', 'upgrade-outsider@example.test', statement_timestamp());

insert into public.designers (id, name, studio_name) values
  ('81111111-1111-4111-8111-111111111111', 'Upgrade Owner', 'Upgrade Fixture'),
  ('82222222-2222-4222-8222-222222222222', 'Upgrade Outsider', 'Upgrade Fixture B');

insert into public.projects (
  id, designer_id, client_name, status, intake_token
) values
  ('81111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111111', 'Upgrade Project', 'active_project', 'upgrade-project-a'),
  ('82222222-2222-4222-8222-222222222222', '82222222-2222-4222-8222-222222222222', 'Upgrade Project B', 'active_project', 'upgrade-project-b');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
select projectceo_api.enroll_organization_project(
  '81111111-1111-4111-8111-111111111111',
  'dbig-upgrade-enroll-owner'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '82222222-2222-4222-8222-222222222222';
select projectceo_api.enroll_organization_project(
  '82222222-2222-4222-8222-222222222222',
  'dbig-upgrade-enroll-outsider'
);
commit;
SQL
run_inline >> "${log}" 2>&1 <<'SQL'
do $upgrade_pre_pr$
begin
  if not exists (
    select 1
    from public.projects
    where id = '81111111-1111-4111-8111-111111111111'::uuid
  ) then
    raise exception 'DBIG_UPGRADE_PRE_PR_PROJECT_MISSING';
  end if;
  if not exists (
    select 1
    from project_intelligence.project_workflows
    where project_id = '81111111-1111-4111-8111-111111111111'::uuid
  ) then
    raise exception 'DBIG_UPGRADE_PRE_PR_WORKFLOW_MISSING';
  end if;
  raise notice 'DBIG_UPGRADE_PRE_PR_STATE_OK';
end
$upgrade_pre_pr$;
SQL

for migration in "${repo_root}"/supabase/migrations/202608*.sql(N); do
  print -r -- "Applying PR migration ${migration:t}" >> "${log}"
  run_file "${migration}" >> "${log}" 2>&1
done

run_inline >> "${log}" 2>&1 <<'SQL'
do $upgrade_post_pr$
begin
  if not exists (
    select 1
    from public.projects
    where id = '81111111-1111-4111-8111-111111111111'::uuid
  ) then
    raise exception 'DBIG_UPGRADE_POST_PR_PROJECT_LOST';
  end if;
  if not exists (
    select 1
    from pg_namespace
    where nspname = 'remhaos_integration'
  ) then
    raise exception 'DBIG_UPGRADE_INTEGRATION_SCHEMA_MISSING';
  end if;
  raise notice 'DBIG_UPGRADE_POST_PR_STATE_OK';
end
$upgrade_post_pr$;
SQL

for sql in \
  "${repo_root}/tests/db-integration-gateway/10_schema_security.sql" \
  "${repo_root}/tests/db-integration-gateway/20_registry_operations.sql" \
  "${repo_root}/tests/db-integration-gateway/40_project_links.sql" \
  "${repo_root}/tests/db-integration-gateway/50_file_intake.sql" \
  "${repo_root}/tests/db-integration-gateway/60_telegram_staging.sql" \
  "${repo_root}/tests/db-integration-gateway/70_google_drive_staging.sql"; do
  print -r -- "Running ${sql:t}" >> "${log}"
  run_file "${sql}" >> "${log}" 2>&1
done

PI_DBIG_CONTAINER="${container}" \
PI_DBIG_DATABASE="${database}" \
PI_DBIG_PASSWORD="${password}" \
  "${repo_root}/tests/db-integration-gateway/run-concurrency.zsh" >> "${log}" 2>&1

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
    print -u2 -r -- "DBIG upgrade database did not return after restart"
    exit 1
  fi
  sleep 0.25
done
run_file "${repo_root}/tests/db-integration-gateway/30_restart_replay.sql" >> "${log}" 2>&1

rg -q 'DBIG_UPGRADE_PRE_PR_STATE_OK' "${log}"
rg -q 'DBIG_UPGRADE_POST_PR_STATE_OK' "${log}"
for marker in \
  DBIG_SCHEMA_SECURITY_OK \
  DBIG_REGISTRY_OPERATIONS_OK \
  DBIG_PROJECT_LINKS_OK \
  DBIG_FILE_INTAKE_OK \
  DBIG_TELEGRAM_STAGING_OK \
  DBIG_GOOGLE_DRIVE_STAGING_OK \
  DBIG_CONCURRENCY_OK \
  DBIG_RESTART_REPLAY_OK; do
  rg -q "${marker}" "${log}"
done

rg 'DBIG_UPGRADE_|DBIG_(SCHEMA_SECURITY|REGISTRY_OPERATIONS|PROJECT_LINKS|FILE_INTAKE|TELEGRAM_STAGING|GOOGLE_DRIVE_STAGING|CONCURRENCY|RESTART_REPLAY)_OK' "${log}"
print -r -- "DBIG_UPGRADE_INTEGRATION_GATEWAY_HARNESS_OK image=${image}"
