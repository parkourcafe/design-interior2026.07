#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h:h}
project_id=archidom-ap1-disposable
cli_version=2.109.1
cli_home=${AP1_CLI_HOME:-/private/tmp/archidom-ap1-home}
cli_cache=${AP1_NPM_CACHE:-/private/tmp/projectceo-ap1-npm-cache}
docker_host=${DOCKER_HOST:-unix://${HOME}/.colima/archidom-ap1/docker.sock}

if [[ "${docker_host}" != unix://*/.colima/archidom-ap1/docker.sock ]]; then
  print -u2 -r -- "AP1_DOCKER_HOST_REJECTED"
  exit 65
fi
if [[ -f "${repo_root}/supabase/.temp/project-ref" ]]; then
  print -u2 -r -- "AP1_LINKED_PROJECT_REJECTED"
  exit 65
fi

mkdir -p "${cli_home}" "${cli_cache}"

supabase_cli() {
  env \
    HOME="${cli_home}" \
    npm_config_cache="${cli_cache}" \
    DOCKER_HOST="${docker_host}" \
    npm exec --yes --package="supabase@${cli_version}" -- supabase "$@"
}

docker_cli() {
  env DOCKER_HOST="${docker_host}" docker "$@"
}

redact_credentials() {
  perl -pe 'if (/key|secret|token|password|jwt/i) { $_ = "[credential line redacted]\n" }'
}

verify_ledger() {
  local expected actual name
  expected=$(for file in "${repo_root}"/supabase/migrations/*.sql(N); do
    name=${file:t:r}
    print -r -- "${name%%_*}"
  done | paste -sd, -)
  actual=$(docker_cli exec "supabase_db_${project_id}" \
    psql -X --tuples-only --no-align --username postgres --dbname postgres \
      --command "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations")
  if [[ "${actual}" != "${expected}" ]]; then
    print -u2 -r -- "AP1_MIGRATION_LEDGER_MISMATCH"
    return 1
  fi
  print -r -- "AP1_MIGRATION_LEDGER_OK count=$(print -r -- "${actual}" | tr ',' '\n' | wc -l | tr -d ' ')"
}

verify_runtime() {
  supabase_cli status --output json \
    | node "${repo_root}/tests/ap1/environment/verify-runtime.mjs"
  docker_cli exec -i "supabase_db_${project_id}" \
    psql -X --username postgres --dbname postgres \
    < "${repo_root}/tests/ap1/environment/verify-db.sql"
  verify_ledger
}

apply_local_auth_compat() {
  # Local Supabase's auth schema is owned by supabase_auth_admin; postgres is
  # required here solely to revoke historical ACLs and model hosted behavior.
  docker_cli exec -i "supabase_db_${project_id}" \
    psql -X --username postgres --dbname postgres \
    < "${repo_root}/tests/ap1/environment/apply-local-auth-compat.sql"
}

start_stack() {
  # AP1 requires real DB/Auth/Kong/PostgREST/Storage. Image derivatives and the
  # local mailbox UI are deliberately outside this authenticated pilot gate.
  supabase_cli start --yes --exclude imgproxy,mailpit 2>&1 | redact_credentials
  apply_local_auth_compat
  verify_runtime
}

case ${1:-status} in
  start)
    start_stack
    ;;
  status)
    verify_runtime
    ;;
  reset)
    supabase_cli db reset --local --no-seed
    apply_local_auth_compat
    verify_runtime
    ;;
  restart)
    supabase_cli stop --project-id "${project_id}"
    start_stack
    ;;
  dispose)
    supabase_cli stop --project-id "${project_id}" --no-backup
    ;;
  version)
    supabase_cli --version
    ;;
  *)
    print -u2 -r -- "usage: $0 {start|status|reset|restart|dispose|version}"
    exit 64
    ;;
esac
