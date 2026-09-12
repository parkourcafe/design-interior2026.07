#!/bin/zsh
set -euo pipefail

# WP-13 is a disposable rehearsal tool for a separately approved historical
# adoption. Shared-target execution is deliberately disabled until a separate
# trusted, target-bound executor is reviewed and merged.

repo_root=${0:a:h:h:h:h}
ledger_path="${repo_root}/tests/ap1/environment/migration-ledger.sha256"
baseline_path="${repo_root}/reconciliation-2026-09/baseline-adoption.sql"
roles_path="${repo_root}/supabase/roles.sql"
verify_db_path="${repo_root}/tests/ap1/environment/verify-db.sql"
role_precondition_path="${repo_root}/tests/ap1/environment/apply-hosted-role-precondition.sql"
readonly baseline_version=20260716071024

target_ref=''
allowlist_path=''
dry_run=false

usage() {
  cat <<'USAGE'
usage: AP1_APPROVAL_RECORD='Approval B: <record-id>' \
  AP1_EXPECTED_RELATIONS=<fixture-count> \
  AP1_EXPECTED_ROUTINES=<fixture-count> \
  AP1_EXPECTED_POLICIES=<fixture-count> \
  AP1_EXPECTED_LEDGER_ROWS=23 \
  zsh tests/ap1/environment/adopt-production.zsh \
    --target-ref <disposable-label> --allowlist-ref <single-line-file> --dry-run

The allowlist file must contain exactly the selected disposable label and no URL.
--dry-run starts an isolated Docker PostgreSQL container with no network.
Any non-disposable target is refused before connection details are read.
USAGE
}

fail() {
  print -u2 -r -- "$1"
  exit "${2:-70}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "AP1_ADOPTION_COMMAND_MISSING $1" 69
}

redact() {
  perl -pe '
    s{((?:postgresql?|https?)://)[^:@/\s]+:[^@\s]+@}{$1[redacted]@}gi;
    s{\bBearer\s+[A-Za-z0-9._~+/-]+=*}{Bearer [redacted]}gi;
    s{\bsb(?:p|_secret|_publishable)_[A-Za-z0-9]{10,}\b}{[supabase-key-redacted]}gi;
    if (/(?:authorization|cookie|session|token|key|secret|password|jwt|dsn)\s*[:=]\s*\S/i) {
      $_ = "[credential line redacted]\\n"
    }
  '
}

cleanup() {
  if [[ -n ${dry_container:-} ]]; then
    docker rm -f "${dry_container}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

while (( $# )); do
  case "$1" in
    --target-ref)
      (( $# >= 2 )) || fail 'AP1_ADOPTION_TARGET_REF_REQUIRED' 64
      target_ref=$2
      shift 2
      ;;
    --allowlist-ref)
      (( $# >= 2 )) || fail 'AP1_ADOPTION_ALLOWLIST_REQUIRED' 64
      allowlist_path=$2
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      print -u2 -r -- "AP1_ADOPTION_UNKNOWN_ARGUMENT $(print -r -- "$1" | redact)"
      exit 64
      ;;
  esac
done

[[ -n ${AP1_APPROVAL_RECORD:-} ]] || fail 'AP1_ADOPTION_APPROVAL_RECORD_REQUIRED' 64
[[ ${AP1_APPROVAL_RECORD} == 'Approval B: '* ]] || fail 'AP1_ADOPTION_APPROVAL_RECORD_INVALID' 64
[[ -n ${target_ref} ]] || fail 'AP1_ADOPTION_TARGET_REF_REQUIRED' 64
[[ ${target_ref} =~ '^[a-z0-9][a-z0-9-]{1,62}$' ]] || fail 'AP1_ADOPTION_TARGET_REF_INVALID' 64
[[ -n ${allowlist_path} && -f ${allowlist_path} ]] || fail 'AP1_ADOPTION_ALLOWLIST_REQUIRED' 64

allowlisted_ref=$(tr -d '\r\n' < "${allowlist_path}")
[[ ${allowlisted_ref} == ${target_ref} ]] || fail 'AP1_ADOPTION_REF_NOT_ALLOWLISTED' 65
[[ $(wc -l < "${allowlist_path}" | tr -d ' ') == 1 ]] || fail 'AP1_ADOPTION_ALLOWLIST_FORMAT_INVALID' 64

if [[ ${dry_run} != true ]]; then
  fail 'AP1_ADOPTION_SHARED_TARGET_DISABLED' 69
fi

if [[ ${dry_run} == true ]]; then
  for count_name in AP1_EXPECTED_RELATIONS AP1_EXPECTED_ROUTINES AP1_EXPECTED_POLICIES AP1_EXPECTED_LEDGER_ROWS; do
    value=${(P)count_name:-}
    [[ ${value} =~ '^[0-9]+$' ]] || fail "AP1_ADOPTION_${count_name}_INVALID" 64
  done
  [[ ${AP1_EXPECTED_LEDGER_ROWS} == 23 ]] || fail 'AP1_ADOPTION_LEDGER_ROWS_MUST_BE_23' 64
fi

require_command sha256sum
require_command docker
[[ -f ${ledger_path} && -f ${baseline_path} && -f ${roles_path} ]] \
  || fail 'AP1_ADOPTION_REPOSITORY_INPUT_MISSING' 66

first_ledger_path=$(awk 'NR == 1 { print $2 }' "${ledger_path}")
[[ ${first_ledger_path} == 'supabase/migrations/20260716071024_legacy_production_baseline.sql' ]] \
  || fail 'AP1_ADOPTION_LEDGER_BASELINE_INVALID' 66

(
  cd "${repo_root}"
  sha256sum --check "${ledger_path}" >/dev/null
) || fail 'AP1_ADOPTION_LEDGER_DIGEST_MISMATCH' 66

psql_run() {
  PGPASSWORD=${AP1_DRY_RUN_PASSWORD:-} psql -X --set ON_ERROR_STOP=1 "$@"
}

if [[ ${dry_run} == true ]]; then
  dry_container="pi-adoption-${$}-${RANDOM}"
  export AP1_DRY_RUN_PASSWORD=pi_adoption_local_only
  image=${PI_DB_IMAGE:-postgres:16-alpine}
  docker run --detach --rm --name "${dry_container}" --network none \
    --env POSTGRES_PASSWORD="${AP1_DRY_RUN_PASSWORD}" \
    --env POSTGRES_DB=pi_adoption \
    "${image}" >/dev/null
  for attempt in {1..120}; do
    if docker exec -e PGPASSWORD="${AP1_DRY_RUN_PASSWORD}" "${dry_container}" \
      psql -X --tuples-only --no-align --username postgres --dbname pi_adoption \
        --command 'select 1' 2>/dev/null | rg -qx '1'; then
      break
    fi
    (( attempt == 120 )) && fail 'AP1_ADOPTION_DRY_RUN_DATABASE_NOT_READY' 70
    sleep 0.25
  done
  psql_run=(docker exec -e PGPASSWORD="${AP1_DRY_RUN_PASSWORD}" -i "${dry_container}" \
    psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_adoption)
else
  psql_run=(psql -X --set ON_ERROR_STOP=1 "${AP1_DB_URL}")
fi

run_sql_file() {
  local file=$1
  shift
  "${psql_run[@]}" "$@" < "${file}" >/dev/null \
    || fail "AP1_ADOPTION_SQL_FILE_FAILED ${file:t}" 70
}

run_sql() {
  print -r -- "$1" | "${psql_run[@]}" >/dev/null \
    || fail 'AP1_ADOPTION_SQL_FAILED' 70
}

psql_value() {
  local result
  result=$(print -r -- "$1" | "${psql_run[@]}" --tuples-only --no-align) \
    || fail 'AP1_ADOPTION_SQL_VALUE_FAILED' 70
  print -r -- "$result" | tail -n 1 | tr -d '[:space:]'
}

seed_dry_run_legacy() {
  [[ ${dry_run} == true ]] || return 0
  run_sql_file "${repo_root}/tests/db2/00_supabase_prelude.sql"
  # The historical SQL evidence predates the repository's explicit
  # `extensions` schema. The production snapshot includes pgcrypto; create its
  # non-application container before replaying only the adopted legacy files.
  run_sql 'create schema extensions; create extension if not exists pgcrypto with schema extensions;'
  for legacy in \
    0001_init.sql.txt \
    0002_client_briefs.sql.txt \
    0003_custom_questions.sql.txt \
    0004_designer_profile.sql.txt \
    0006_team.sql.txt \
    0007_project_rooms.sql.txt; do
    run_sql_file "${repo_root}/docs/product-intelligence/agent-runs/db-wave/legacy-migrations/${legacy}"
  done
  run_sql 'create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);'
  run_sql "insert into supabase_migrations.schema_migrations (version, name)
    select lpad(value::text, 14, '0'), 'legacy_adopted'
    from generate_series(1, 23) value;"
  # Approval A is a separate transaction even in the disposable rehearsal.
  run_sql_file "${baseline_path}" \
    --variable=AP1_EXPECTED_RELATIONS="${AP1_EXPECTED_RELATIONS}" \
    --variable=AP1_EXPECTED_ROUTINES="${AP1_EXPECTED_ROUTINES}" \
    --variable=AP1_EXPECTED_POLICIES="${AP1_EXPECTED_POLICIES}" \
    --variable=AP1_EXPECTED_LEDGER_ROWS="${AP1_EXPECTED_LEDGER_ROWS}"
}

seed_dry_run_legacy

print -r -- "AP1_ADOPTION_TARGET_OK ref=${target_ref} mode=$([[ ${dry_run} == true ]] && print dry-run || print approved)"
print -r -- 'AP1_ADOPTION_APPROVAL_B_PRESENT'

baseline_record_count=$(psql_value "select count(*) from supabase_migrations.schema_migrations where version = '${baseline_version}';")
[[ ${baseline_record_count} == 1 ]] || fail 'AP1_ADOPTION_BASELINE_NOT_ADOPTED' 65
print -r -- 'AP1_ADOPTION_BASELINE_ADOPTED ddl_executed=false'

run_sql_file "${roles_path}"

ledger_lines=("${(@f)$(cat "${ledger_path}")}")
for ledger_line in "${ledger_lines[@]:1}"; do
  digest=${ledger_line%% *}
  relative=${ledger_line##*  }
  [[ -n ${digest} && -n ${relative} && -f "${repo_root}/${relative}" ]] \
    || fail 'AP1_ADOPTION_LEDGER_LINE_INVALID' 66
  print -r -- "${digest}  ${relative}" | (cd "${repo_root}" && sha256sum --check -) >/dev/null \
    || fail "AP1_ADOPTION_MIGRATION_DIGEST_MISMATCH ${relative}" 66
  version=${${relative:t:r}%%_*}
  already_applied=$(psql_value "select exists (select 1 from supabase_migrations.schema_migrations where version = '${version}');")
  if [[ ${already_applied} == t ]]; then
    continue
  fi
  print -r -- "AP1_ADOPTION_APPLYING ${relative:t}"
  run_sql_file "${repo_root}/${relative}"
  run_sql "insert into supabase_migrations.schema_migrations (version, name)
    values ('${version}', '${${relative:t:r}#*_}')"
done

if [[ ${dry_run} == true ]]; then
  run_sql_file "${repo_root}/tests/ap1/environment/apply-local-auth-compat.sql"
fi
run_sql_file "${verify_db_path}"
run_sql_file "${role_precondition_path}"

print -r -- 'AP1_ADOPTION_VERIFY_DB_OK'
print -r -- 'AP1_ADOPTION_COMPLETE modules_opened=false deployment_performed=false'
