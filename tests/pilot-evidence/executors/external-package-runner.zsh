#!/bin/zsh
set -euo pipefail

# Repository-owned external package runner for the Cycle 7 evidence run.
#
# Drives the supplied external manifest through the five M2 operations against a
# disposable authenticated environment, sends every command twice and compares
# the two results, harvests audit ids and state revisions from the run itself,
# and hands the facts to the unit-tested receipt builder. It never asserts a
# replay it did not perform and never writes a receipt for a run that failed.
#
# Argument contract, called by tests/pilot-evidence/run-pilot-executor-cli.ts:
#   $1 challenge nonce            $5 kora receipt digest
#   $2 receipt output path        $6 kora receipt id
#   $3 external manifest path     $7 kora producer path
#   $4 executor verification id   $8 kora producer digest
#
# Optional environment overrides are accepted for local diagnosis only. The
# canonical Cycle 7 wrapper supplies none: origin, database and cookie window
# are discovered from the named disposable AP1 profile.
#
# NOTE: the command payload bodies are derived from the manifest below. The
# manifest shape is fixed by tests/pilot-evidence/m2-pilot-evidence-contract.ts,
# so this mapping is generic. The repository package is evidence input, not a
# run receipt: treat the first successful disposable execution as part of the
# review, not as a regression claim.

repo_root=${EXTERNAL_RUN_REPO_ROOT:-${0:a:h:h:h:h}}
cd "${repo_root}"

challenge_nonce=${1:-}
receipt_path=${2:-}
manifest_path=${3:-}
executor_verification_receipt_id=${4:-}
kora_receipt_digest=${5:-}
kora_receipt_id=${6:-}
kora_producer_path=${7:-}
kora_producer_digest=${8:-}

if [[ -z ${challenge_nonce} || -z ${receipt_path} || -z ${manifest_path}
   || -z ${executor_verification_receipt_id} || -z ${kora_receipt_digest} || -z ${kora_receipt_id}
   || -z ${kora_producer_path} || -z ${kora_producer_digest} ]]; then
  print -u2 -r -- 'EXTERNAL_RUNNER_ARGUMENTS_REQUIRED'
  exit 64
fi
if [[ -e ${receipt_path} ]]; then
  print -u2 -r -- 'EXTERNAL_RUNNER_RECEIPT_PATH_EXISTS'
  exit 65
fi
if [[ ! -r ${manifest_path} ]]; then
  print -u2 -r -- 'EXTERNAL_RUNNER_MANIFEST_UNREADABLE'
  exit 66
fi
expected_executor_digest=${EXTERNAL_RUN_EXECUTOR_SHA256:-}
expected_manifest_digest=${EXTERNAL_RUN_MANIFEST_SHA256:-}
canonical_executor_path=${EXTERNAL_RUN_CANONICAL_EXECUTOR_PATH:-}
if [[ -z ${expected_executor_digest} || -z ${expected_manifest_digest} || -z ${canonical_executor_path} ]]; then
  print -u2 -r -- 'EXTERNAL_RUNNER_PINNED_IDENTITY_REQUIRED'
  exit 66
fi
manifest_snapshot_base64=$(openssl base64 -A -in "${manifest_path}")
manifest_bytes() {
  print -rn -- "${manifest_snapshot_base64}" | openssl base64 -d -A
}
manifest_jq() {
  manifest_bytes | jq "$@"
}
actual_manifest_digest=$(manifest_bytes | shasum -a 256 | awk '{print "sha256:"$1}')
[[ ${actual_manifest_digest} == ${expected_manifest_digest} ]] || { print -u2 -r -- 'EXTERNAL_RUNNER_MANIFEST_DIGEST_MISMATCH'; exit 66; }

next_port=${AP1_NEXT_PORT:-3100}
origin=${EXTERNAL_RUN_ORIGIN:-http://127.0.0.1:${next_port}}
db_container=${EXTERNAL_RUN_DB_CONTAINER:-supabase_db_archidom-ap1-disposable}
cookie_dir=${EXTERNAL_RUN_COOKIE_DIR:-/private/tmp/projectceo-ap1-evidence}
if [[ ! -d ${cookie_dir} ]]; then
  print -u2 -r -- 'EXTERNAL_RUNNER_COOKIE_WINDOW_MISSING'
  exit 67
fi
if [[ ${origin} != http://127.0.0.1:* && ${origin} != http://localhost:* ]]; then
  print -u2 -r -- 'EXTERNAL_RUNNER_NON_LOOPBACK_ORIGIN_REJECTED'
  exit 67
fi
db_candidates=(${(f)"$(docker ps --filter "name=^/${db_container}$" --format '{{.Names}}')"})
if (( ${#db_candidates} != 1 )); then
  print -u2 -r -- 'EXTERNAL_RUNNER_DB_CONTAINER_AMBIGUOUS'
  exit 67
fi
db_label=$(docker inspect --format '{{index .Config.Labels "com.supabase.cli.project"}}' "${db_container}")
[[ ${db_label} == archidom-ap1-disposable ]] || {
  print -u2 -r -- 'EXTERNAL_RUNNER_DB_CONTAINER_OWNERSHIP_REJECTED'
  exit 67
}

executor_absolute=${0:a}
executor_digest=$(shasum -a 256 "${executor_absolute}" | awk '{print "sha256:"$1}')
[[ ${executor_digest} == ${expected_executor_digest} ]] || { print -u2 -r -- 'EXTERNAL_RUNNER_EXECUTOR_DIGEST_MISMATCH'; exit 67; }
executor_relative=${canonical_executor_path}
[[ ${executor_relative} == tests/pilot-evidence/executors/* && ${executor_relative} != *../* ]] \
  || { print -u2 -r -- 'EXTERNAL_RUNNER_CANONICAL_PATH_INVALID'; exit 67; }

work_dir=$(mktemp -d)
chmod 700 "${work_dir}"
umask 077
harvest_file="${work_dir}/harvest.json"
commands_file="${work_dir}/commands.json"
sessions_file="${work_dir}/sessions.json"
stage=initialized

cleanup() {
  # `status` is read-only in zsh; capturing into it aborts the whole handler.
  local exit_status=$?
  if (( exit_status != 0 )); then print -u2 -r -- "EXTERNAL_RUNNER_EXIT stage=${stage} status=${exit_status}"; fi
  rm -rf -- "${work_dir}"
  if (( exit_status != 0 )); then rm -f -- "${receipt_path}"; fi
  return ${exit_status}
}
trap cleanup EXIT INT TERM

organization_id=$(manifest_jq -er '.scope.organizationId')
project_id=$(manifest_jq -er '.scope.projectId')
package_id=$(manifest_jq -er '.scope.packageId')
room_id=$(manifest_jq -er '.scope.roomId | select(type == "string") | select(test("\\A[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}\\z"))') \
  || { print -u2 -r -- 'EXTERNAL_RUNNER_MANIFEST_ROOM_INVALID'; exit 66; }
uuid_pattern='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
for scoped_id in "${organization_id}" "${project_id}" "${package_id}"; do
  [[ ${scoped_id} =~ ${~uuid_pattern} ]] || { print -u2 -r -- 'EXTERNAL_RUNNER_MANIFEST_SCOPE_INVALID'; exit 66; }
done
entity_id_pattern='^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$'
[[ ${room_id} =~ ${~entity_id_pattern} ]] || { print -u2 -r -- 'EXTERNAL_RUNNER_MANIFEST_ROOM_INVALID'; exit 66; }

query_db() {
  docker exec -i "${db_container}" \
    psql -X -qAt --set ON_ERROR_STOP=1 --username postgres --dbname postgres
}

session_digest() {
  print -rn -- "$1" | shasum -a 256 | awk '{print "sha256:"$1}'
}

session_digest_from_headers() {
  awk 'tolower($1) == "x-archidom-auth-session-digest:" { gsub("\\r", "", $2); value=$2 } END { print value }' "$1"
}

provision_external_scope() {
  local owner_user_id architect_user_id builder_user_id client_user_id
  owner_user_id=$(jq -er '.[] | select(.role == "owner_lead") | .userId' "${sessions_file}")
  architect_user_id=$(jq -er '.[] | select(.role == "architect") | .userId' "${sessions_file}")
  builder_user_id=$(jq -er '.[] | select(.role == "builder") | .userId' "${sessions_file}")
  client_user_id=$(jq -er '.[] | select(.role == "client_approver") | .userId' "${sessions_file}")

  # Disposable identity/scope bootstrap only. Business package content,
  # variants, review, approval and handoff are created later through the five
  # authenticated HTTP commands. Do not add graph/content rows here.
  query_db <<SQL
begin;
insert into public.designers (id, name, studio_name)
values ('${owner_user_id}'::uuid, 'AP6 Owner', 'ArchiDom AP6')
on conflict (id) do nothing;
insert into public.projects (id, designer_id, client_name, status, intake_token, passport)
values ('${project_id}'::uuid, '${owner_user_id}'::uuid,
  'Tashkent Courtyard House', 'active_project', 'ap6-tashkent-external',
  '{"project_name":"Tashkent Courtyard House","object":{"area_m2":340,"city":"Ташкент","type":"house"}}'::jsonb)
on conflict (id) do update set client_name = excluded.client_name, passport = excluded.passport;

insert into project_intelligence.organizations (id, cell_code, edition, legacy_designer_id, status)
values ('${organization_id}'::uuid, 'ru', 'renovation', null, 'active')
on conflict (id) do nothing;
insert into project_intelligence.organization_members (organization_id, user_id, role, status)
values
  ('${organization_id}'::uuid, '${owner_user_id}'::uuid, 'owner', 'active'),
  ('${organization_id}'::uuid, '${architect_user_id}'::uuid, 'member', 'active'),
  ('${organization_id}'::uuid, '${builder_user_id}'::uuid, 'member', 'active'),
  ('${organization_id}'::uuid, '${client_user_id}'::uuid, 'member', 'active')
on conflict (organization_id, user_id) do nothing;
insert into project_intelligence.member_capabilities (organization_id, user_id, capability)
select '${organization_id}'::uuid, '${owner_user_id}'::uuid, capability
from unnest(array['review_claim','publish_version','revise_decision','calculate_change_impact','review_change_impact','build_logical_handoff']::text[]) capability
on conflict do nothing;
insert into project_intelligence.project_workflows (organization_id, project_id, state_revision)
values ('${organization_id}'::uuid, '${project_id}'::uuid, 0)
on conflict (organization_id, project_id) do nothing;
insert into projectceo_foundation.project_packages
  (organization_id, project_id, id, stable_key, kind, parent_package_id, name)
values ('${organization_id}'::uuid, '${project_id}'::uuid,
  '${package_id}'::uuid, 'tashkent-external-package', 'work_package',
  '${project_id}'::uuid, 'Ташкентский внешний пакет AP6')
on conflict (organization_id, project_id, id) do nothing;
insert into projectceo_foundation.project_memberships
  (organization_id, project_id, user_id, role, status)
values
  ('${organization_id}'::uuid, '${project_id}'::uuid, '${owner_user_id}'::uuid, 'owner_lead', 'active'),
  ('${organization_id}'::uuid, '${project_id}'::uuid, '${architect_user_id}'::uuid, 'architect', 'active'),
  ('${organization_id}'::uuid, '${project_id}'::uuid, '${builder_user_id}'::uuid, 'builder', 'active'),
  ('${organization_id}'::uuid, '${project_id}'::uuid, '${client_user_id}'::uuid, 'client_approver', 'active')
on conflict (organization_id, project_id, user_id) do nothing;
insert into projectceo_foundation.project_member_capabilities
  (organization_id, project_id, user_id, capability)
select membership.organization_id, membership.project_id, membership.user_id, preset.capability
from projectceo_foundation.project_memberships membership
cross join lateral projectceo_foundation._role_capabilities(membership.role) preset
where membership.organization_id = '${organization_id}'::uuid
  and membership.project_id = '${project_id}'::uuid
on conflict do nothing;
insert into projectceo_foundation.package_memberships
  (organization_id, project_id, package_id, user_id, role)
values
  ('${organization_id}'::uuid, '${project_id}'::uuid, '${package_id}'::uuid, '${architect_user_id}'::uuid, 'architect'),
  ('${organization_id}'::uuid, '${project_id}'::uuid, '${package_id}'::uuid, '${builder_user_id}'::uuid, 'builder'),
  ('${organization_id}'::uuid, '${project_id}'::uuid, '${package_id}'::uuid, '${client_user_id}'::uuid, 'client_approver')
on conflict (organization_id, project_id, package_id, user_id) do nothing;
commit;
SQL
}

harvest_db_command() {
  local operation=$1 database_operation=$1
  case ${operation} in
    publish_m2_layout_version) database_operation=append_m2_layout_version_revision ;;
    submit_m2_client_review) database_operation=submit_m2_client_review ;;
    review_m2_client_submission) database_operation=review_m2_client_submission ;;
    publish_m2_m3_handoff) database_operation=publish_m2_m3_handoff ;;
  esac
  query_db <<SQL
select json_build_object(
  'commandId', command.command_id,
  'actorUserId', command.actor_user_id,
  'requestId', audit.request_id,
  'resultingStateRevision', command.resulting_state_revision,
  'logicalResult', command.logical_result,
  'auditEventId', audit.audit_event_id
)::text
from projectceo_product.command_records command
join projectceo_product.audit_events audit
  on audit.organization_id = command.organization_id
 and audit.project_id = command.project_id
 and audit.command_id = command.command_id
where command.project_id = '${project_id}'::uuid
  and command.operation = '${database_operation}'
order by command.completed_at desc
limit 1;
SQL
}

# One authenticated POST under the given role's own cookie jar.
post_command() {
  local role=$1 payload=$2 output=$3 operation=${4:-unknown}
  local jar="${cookie_dir}/${role}.cookies"
  if [[ ! -r ${jar} ]]; then
    print -u2 -r -- "EXTERNAL_RUNNER_COOKIE_JAR_MISSING role=${role}"
    exit 68
  fi
  local http headers="${output}.headers"
  if ! http=$(curl -sS -o "${output}" -w '%{http_code}' \
    -D "${headers}" \
    -c "${jar}" -b "${jar}" \
    -H "Origin: ${origin}" -H 'Content-Type: application/json' \
    --data "${payload}" "${origin}/api/projectceo/commands"); then
    print -u2 -r -- "EXTERNAL_RUNNER_COMMAND_HTTP operation=${operation} status=transport_failure code=curl_failed reason=unknown command_id=unknown"
    exit 68
  fi
  [[ ${http} == 200 ]] || {
    local error_code error_reason command_id
    error_code=$(jq -r '.error.code // "unknown"' "${output}" 2>/dev/null || print -r -- unknown)
    error_reason=$(jq -r '.error.details.reason // .error.reason // "unknown" | if type == "string" and test("^[A-Z0-9_]{1,80}$") then . else "unknown" end' "${output}" 2>/dev/null || print -r -- unknown)
    command_id=$(jq -r '.commandId // "unknown"' <<<"${payload}" 2>/dev/null || print -r -- unknown)
    print -u2 -r -- "EXTERNAL_RUNNER_COMMAND_HTTP operation=${operation} status=${http} code=${error_code} reason=${error_reason} command_id=${command_id}"
    exit 68
  }
  local session_role=${role} expected_session_digest actual_session_digest
  case ${role} in
    owner) session_role=owner_lead ;;
    client) session_role=client_approver ;;
  esac
  expected_session_digest=$(jq -er --arg role "${session_role}" '.[] | select(.role == $role) | .serverSessionDigest' "${sessions_file}")
  actual_session_digest=$(session_digest_from_headers "${headers}")
  [[ ${actual_session_digest} == ${expected_session_digest} ]] || {
    print -u2 -r -- "EXTERNAL_RUNNER_SERVER_SESSION_MISMATCH role=${session_role} operation=${operation}"
    exit 68
  }
}

response_summary() {
  local response=$1
  jq -c '{status, replay, requestId, errorCode: (.error.code // null), resultingStateRevision: (.resultingStateRevision // null)}' "${response}" 2>/dev/null \
    || print -r -- '{"response":"unparseable"}'
}

publish_layout_preflight() {
  local payload=$1 variant_id=$2
  local command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  local first="${work_dir}/layout-${variant_id}.json"
  local second="${work_dir}/layout-${variant_id}-replay.json"
  post_command owner "$(command_payload publish_m2_layout_version "${command_id}" "${payload}")" "${first}" publish_m2_layout_version
  jq -e '.status == "completed" and .replay == false' "${first}" >/dev/null || {
    print -u2 -r -- "EXTERNAL_RUNNER_RESPONSE_INVALID operation=publish_m2_layout_version phase=first summary=$(response_summary "${first}")"
    exit 68
  }
  post_command owner "$(command_payload publish_m2_layout_version "${command_id}" "${payload}")" "${second}" publish_m2_layout_version
  jq -e --slurpfile first "${first}" '.status == "completed" and .replay == true and .result == $first[0].result' "${second}" >/dev/null || {
    print -u2 -r -- "EXTERNAL_RUNNER_RESPONSE_INVALID operation=publish_m2_layout_version phase=replay summary=$(response_summary "${second}")"
    exit 68
  }
}

# Sends the exact same command twice and records both digests. The builder
# rejects the receipt if they differ, so replay is proven rather than claimed.
send_command() {
  local role=$1 operation=$2 payload=$3 command_id=$4
  local first="${work_dir}/${operation}.json"
  local second="${work_dir}/${operation}-replay.json"
  stage="command_${operation}_first_post"
  post_command "${role}" "${payload}" "${first}" "${operation}"
  stage="command_${operation}_first_assert"
  jq -e '.status == "completed" and .replay == false' "${first}" >/dev/null || {
    print -u2 -r -- "EXTERNAL_RUNNER_RESPONSE_INVALID operation=${operation} phase=first summary=$(response_summary "${first}")"
    exit 68
  }
  stage="command_${operation}_replay_post"
  post_command "${role}" "${payload}" "${second}" "${operation}"
  stage="command_${operation}_replay_assert"
  jq -e '.status == "completed" and .replay == true' "${second}" >/dev/null || {
    print -u2 -r -- "EXTERNAL_RUNNER_RESPONSE_INVALID operation=${operation} phase=replay summary=$(response_summary "${second}")"
    exit 68
  }

  local result_digest replay_digest request_id stateRevision previous_state_revision audit_event_id session_role=${role} expected_role expected_user_id actor_session_digest
  case ${role} in
    owner) session_role=owner_lead ;;
    client) session_role=client_approver ;;
  esac
  case ${operation} in
    publish_m2_layout_version|submit_m2_client_review|publish_m2_m3_handoff) expected_role=owner_lead ;;
    review_m2_client_submission) expected_role=client_approver ;;
    *) print -u2 -r -- "EXTERNAL_RUNNER_OPERATION_ROLE_UNKNOWN operation=${operation}"; exit 68 ;;
  esac
  [[ ${session_role} == ${expected_role} ]] || {
    print -u2 -r -- "EXTERNAL_RUNNER_OPERATION_ROLE_MISMATCH operation=${operation} role=${session_role}"
    exit 68
  }
  stage="command_${operation}_request_id"
  result_digest=$(jq -cS '.result' "${first}" | shasum -a 256 | awk '{print "sha256:"$1}')
  replay_digest=$(jq -cS '.result' "${second}" | shasum -a 256 | awk '{print "sha256:"$1}')
  request_id=$(jq -er '.requestId' "${first}")
  stage="command_${operation}_db_harvest"
  db_record=$(harvest_db_command "${operation}" | tail -1)
  if [[ -z ${db_record} ]]; then
    print -u2 -r -- "EXTERNAL_RUNNER_DB_COMMAND_MISSING operation=${operation}"
    exit 68
  fi
  if ! stateRevision=$(jq -er '.resultingStateRevision' <<<"${db_record}"); then
    print -u2 -r -- "EXTERNAL_RUNNER_DB_COMMAND_INVALID operation=${operation} field=resultingStateRevision"
    exit 68
  fi
  previous_state_revision=$(( stateRevision - 1 ))
  stage="command_${operation}_identity_harvest"
  if ! command_id=$(jq -er '.commandId' <<<"${db_record}"); then
    print -u2 -r -- "EXTERNAL_RUNNER_DB_COMMAND_INVALID operation=${operation} field=commandId"
    exit 68
  fi
  if ! audit_event_id=$(jq -er '.auditEventId' <<<"${db_record}"); then
    print -u2 -r -- "EXTERNAL_RUNNER_DB_COMMAND_INVALID operation=${operation} field=auditEventId"
    exit 68
  fi
  if ! actor_user_id=$(jq -er '.actorUserId' <<<"${db_record}"); then
    print -u2 -r -- "EXTERNAL_RUNNER_DB_COMMAND_INVALID operation=${operation} field=actorUserId"
    exit 68
  fi
  if ! actor_session_id=$(jq -er --arg role "${session_role}" '.[] | select(.role == $role) | .sessionId' "${sessions_file}"); then
    print -u2 -r -- "EXTERNAL_RUNNER_DB_COMMAND_INVALID operation=${operation} field=actorSessionId"
    exit 68
  fi
  expected_user_id=$(jq -er --arg role "${session_role}" '.[] | select(.role == $role) | .userId' "${sessions_file}")
  actor_session_digest=$(jq -er --arg role "${session_role}" '.[] | select(.role == $role) | .serverSessionDigest' "${sessions_file}")
  [[ ${actor_user_id} == ${expected_user_id} ]] || {
    print -u2 -r -- "EXTERNAL_RUNNER_DB_COMMAND_ROLE_MISMATCH operation=${operation}"
    exit 68
  }
  stage="command_${operation}_receipt_append"

  jq --arg operation "${operation}" --arg commandId "${command_id}" --arg requestId "${request_id}" \
    --arg auditEventId "${audit_event_id}" --arg actorUserId "${actor_user_id}" --arg actorSessionId "${actor_session_id}" --arg actorSessionDigest "${actor_session_digest}" --arg role "${expected_role}" \
    --argjson previous "${previous_state_revision}" --argjson resulting "${stateRevision}" \
    --arg resultDigest "${result_digest}" --arg replayDigest "${replay_digest}" \
    '. += [{operation: $operation, role: $role, replayMode: "direct", commandId: $commandId, requestId: $requestId,
            auditEventId: $auditEventId, actorUserId: $actorUserId, actorSessionId: $actorSessionId, actorSessionDigest: $actorSessionDigest,
            previousStateRevision: $previous, resultingStateRevision: $resulting,
            resultDigest: $resultDigest, replayDigest: $replayDigest}]' \
    "${commands_file}" > "${commands_file}.next"
  mv -- "${commands_file}.next" "${commands_file}"
}

# `review_m2_client_submission(approved)` appends this command in the same
# database transaction. It has no second HTTP door by design. Harvesting the
# actual command record preserves the five-entry receipt without inventing a
# public API or issuing a duplicate approved commit.
record_approved_commit_side_effect() {
  local operation=append_m2_approved_commit_revision
  local db_record result_digest stateRevision previous_state_revision command_id audit_event_id actor_user_id actor_session_id actor_session_digest expected_user_id request_id
  db_record=$(harvest_db_command "${operation}" | tail -1)
  [[ -n ${db_record} ]] || { print -u2 -r -- 'EXTERNAL_RUNNER_APPROVED_COMMIT_SIDE_EFFECT_MISSING'; exit 68; }
  command_id=$(jq -er '.commandId' <<<"${db_record}")
  audit_event_id=$(jq -er '.auditEventId' <<<"${db_record}")
  request_id=$(jq -er '.requestId' <<<"${db_record}")
  actor_user_id=$(jq -er '.actorUserId' <<<"${db_record}")
  stateRevision=$(jq -er '.resultingStateRevision' <<<"${db_record}")
  previous_state_revision=$(( stateRevision - 1 ))
  actor_session_id=$(jq -er '.[] | select(.role == "client_approver") | .sessionId' "${sessions_file}")
  actor_session_digest=$(jq -er '.[] | select(.role == "client_approver") | .serverSessionDigest' "${sessions_file}")
  expected_user_id=$(jq -er '.[] | select(.role == "client_approver") | .userId' "${sessions_file}")
  [[ ${actor_user_id} == ${expected_user_id} ]] || { print -u2 -r -- 'EXTERNAL_RUNNER_DB_COMMAND_ROLE_MISMATCH operation=append_m2_approved_commit_revision'; exit 68; }
  result_digest=$(jq -cS '.logicalResult' <<<"${db_record}" | shasum -a 256 | awk '{print "sha256:"$1}')
  jq --arg operation "${operation}" --arg commandId "${command_id}" --arg requestId "${request_id}" \
    --arg auditEventId "${audit_event_id}" --arg actorUserId "${actor_user_id}" --arg actorSessionId "${actor_session_id}" --arg actorSessionDigest "${actor_session_digest}" --arg role "client_approver" \
    --argjson previous "${previous_state_revision}" --argjson resulting "${stateRevision}" --arg digest "${result_digest}" \
    '. += [{operation: $operation, role: $role, replayMode: "parent_atomic_side_effect", commandId: $commandId, requestId: $requestId,
            auditEventId: $auditEventId, actorUserId: $actorUserId, actorSessionId: $actorSessionId, actorSessionDigest: $actorSessionDigest,
            previousStateRevision: $previous, resultingStateRevision: $resulting,
            resultDigest: $digest, replayDigest: $digest}]' \
    "${commands_file}" > "${commands_file}.next"
  mv -- "${commands_file}.next" "${commands_file}"
}

# Five request-bound sessions of the external run. The Kora producer harvested
# the five live portfolio request bindings before the external project existed;
# reuse that protected snapshot here because the portfolio endpoint deliberately
# rejects a multi-project owner scope after external provisioning.
print -r -- '[]' > "${sessions_file}"
print -r -- '[]' > "${commands_file}"
kora_harvest_file="${cookie_dir}/kora-session-harvest.json"
[[ -r ${kora_harvest_file} ]] || {
  print -u2 -r -- 'EXTERNAL_RUNNER_KORA_SESSION_HARVEST_MISSING'
  exit 68
}
for pair in owner_lead:owner architect:architect client_approver:client builder:builder guest:guest; do
  role=${pair%%:*}
  jar_name=${pair##*:}
  jar="${cookie_dir}/${jar_name}.cookies"
  if [[ ! -r ${jar} ]]; then
    print -u2 -r -- "EXTERNAL_RUNNER_COOKIE_JAR_MISSING role=${jar_name}"
    exit 68
  fi
  kora_role=${jar_name}
  if [[ ${jar_name} == owner ]]; then kora_role=owner; fi
  if [[ ${jar_name} == client ]]; then kora_role=client; fi
  request_id=$(jq -er --arg role "${kora_role}" '.[$role].requestId' "${kora_harvest_file}")
  user_id=$(jq -er --arg role "${kora_role}" '.[$role].userId' "${kora_harvest_file}")
  cookie_binding=$(./node_modules/.bin/tsx tests/pilot-evidence/cookie-session-cli.ts "${jar}")
  cookie_user_id=$(jq -er '.userId' <<<"${cookie_binding}")
  session_id=$(jq -er '.sessionId' <<<"${cookie_binding}")
  [[ ${cookie_user_id} == ${user_id} ]] || { print -u2 -r -- "EXTERNAL_RUNNER_COOKIE_USER_MISMATCH role=${role}"; exit 68; }
  session_count=$(query_db <<SQL
select count(*) from auth.sessions where id = '${session_id}'::uuid and user_id = '${user_id}'::uuid;
SQL
  )
  session_count=$(print -r -- "${session_count}" | tail -1 | tr -d '[:space:]')
  [[ ${session_count} == 1 ]] || { print -u2 -r -- "EXTERNAL_RUNNER_COOKIE_SESSION_NOT_FOUND role=${role}"; exit 68; }
  jq --arg role "${role}" --arg userId "${user_id}" --arg sessionId "${session_id}" \
    --arg requestId "${request_id}" \
    '. += [{role: $role, userId: $userId, sessionId: $sessionId, requestId: $requestId}]' \
    "${sessions_file}" > "${sessions_file}.next"
  mv -- "${sessions_file}.next" "${sessions_file}"
done
stage=external_scope_seeded

# Kora and the external package deliberately use the same five authenticated
# users, but different organizations. Seed the external package only after
# the Kora portfolio reads above have completed: the UI portfolio is a
# single-organization surface, while the project-scoped command boundary can
# safely address either project by its server-owned scope.
provision_external_scope

review_prerequisites=$(query_db <<SQL
select json_build_object(
  'approvalEvents', (
    select coalesce(json_agg(json_build_object(
      'sequence', event.sequence_no,
      'toStatus', event.to_status,
      'selfApproved', event.self_approved
    ) order by event.sequence_no), '[]'::json)
    from projectceo_product.approval_package_events event
    where event.project_id = '${project_id}'::uuid
      and event.approval_package_id = (select approval.approval_package_id
        from projectceo_product.approval_packages approval
        where approval.project_id = '${project_id}'::uuid
        order by approval.created_at desc limit 1)
  ),
  'submissionCount', (
    select count(*) from projectceo_product.m2_workspace_revisions revision
    where revision.project_id = '${project_id}'::uuid
      and revision.entity_kind = 'm2_client_submission'
  ),
  'approvedNonSelfCount', (
    select count(*) from projectceo_product.approval_package_events event
    where event.project_id = '${project_id}'::uuid
      and event.to_status = 'approved'
      and event.self_approved = false
  ),
  'approvedAssignedClientCount', (
    select count(*) from projectceo_product.approval_package_events event
    join projectceo_product.approval_packages approval
      on approval.project_id = event.project_id
     and approval.approval_package_id = event.approval_package_id
    join projectceo_product.m2_workspace_revisions submission
      on submission.project_id = event.project_id
     and submission.entity_kind = 'm2_client_submission'
     and submission.payload->>'approvalPackageId' = event.approval_package_id
    where event.project_id = '${project_id}'::uuid
      and event.to_status = 'approved'
      and event.self_approved = false
      and event.actor_user_id = (submission.payload->>'assignedClientUserId')::uuid
  ),
  'approvedPackageClientActorCount', (
    select count(*) from projectceo_product.approval_package_events event
    join projectceo_foundation.package_memberships membership
      on membership.project_id = event.project_id
     and membership.package_id = '${package_id}'::uuid
     and membership.user_id = event.actor_user_id
     and membership.role = 'client_approver'
    where event.project_id = '${project_id}'::uuid
      and event.to_status = 'approved'
      and event.self_approved = false
  )
)::text;
SQL
)
review_prerequisites=$(print -r -- "${review_prerequisites}" | tail -1 | jq -c .)
print -r -- "EXTERNAL_RUNNER_REVIEW_PREREQUISITES ${review_prerequisites}"

preflight_state=$(query_db <<SQL
select json_build_object(
  'workflowRevision', (select state_revision from project_intelligence.project_workflows where project_id = '${project_id}'::uuid),
  'layoutRevisions', (select count(*) from projectceo_product.m2_workspace_revisions where project_id = '${project_id}'::uuid),
  'commandRecords', (select count(*) from projectceo_product.command_records where project_id = '${project_id}'::uuid)
)::text;
SQL
)
print -r -- "EXTERNAL_RUNNER_PREFLIGHT_STATE $(print -r -- "${preflight_state}" | tail -1)"
stage=preflight_complete

for pair in owner_lead:owner architect:architect client_approver:client builder:builder guest:guest; do
  role=${pair%%:*}
  jar_name=${pair##*:}
  jar="${cookie_dir}/${jar_name}.cookies"
  response="${work_dir}/${jar_name}-external-workspace.json"
  response_headers="${response}.headers"
  if [[ ${jar_name} == guest ]]; then
    if ! http=$(curl -sS -o "${response}" -D "${response_headers}" -w '%{http_code}' -c "${jar}" -b "${jar}" "${origin}/api/projectceo/portfolio"); then
      print -u2 -r -- "EXTERNAL_RUNNER_PROJECT_READ_HTTP role=${jar_name} status=transport_failure code=curl_failed"
      exit 68
    fi
  else
    if ! http=$(curl -sS -o "${response}" -D "${response_headers}" -w '%{http_code}' -c "${jar}" -b "${jar}" \
      "${origin}/api/projectceo/projects/${project_id}"); then
      print -u2 -r -- "EXTERNAL_RUNNER_PROJECT_READ_HTTP role=${jar_name} status=transport_failure code=curl_failed"
      exit 68
    fi
  fi
  if [[ ${http} != 200 ]]; then
    error_code=$(jq -r '.error.code // "unknown"' "${response}" 2>/dev/null || print -r -- unknown)
    print -u2 -r -- "EXTERNAL_RUNNER_PROJECT_READ_HTTP role=${jar_name} status=${http} code=${error_code}"
    exit 68
  fi
  if [[ ${jar_name} != guest ]]; then
    jq -e --arg projectId "${project_id}" '.error == null and .data.project.id == $projectId' "${response}" >/dev/null || {
      print -u2 -r -- "EXTERNAL_RUNNER_PROJECT_READ_INVALID role=${role} summary=$(response_summary "${response}")"
      exit 68
    }
  else
    jq -e '.error == null and (.data.projects | type == "array") and (.data.projects | length) == 0' "${response}" >/dev/null || {
      print -u2 -r -- "EXTERNAL_RUNNER_PROJECT_READ_INVALID role=${role} summary=$(response_summary "${response}")"
      exit 68
    }
  fi
  request_id=$(jq -er '.requestId' "${response}")
  session_id=$(jq -er --arg role "${role}" '.[] | select(.role == $role) | .sessionId' "${sessions_file}")
  expected_server_session_digest=$(session_digest "${session_id}")
  actual_server_session_digest=$(session_digest_from_headers "${response_headers}")
  [[ ${actual_server_session_digest} == ${expected_server_session_digest} ]] || {
    print -u2 -r -- "EXTERNAL_RUNNER_SERVER_SESSION_MISMATCH role=${role} operation=workspace_read"
    exit 68
  }
  jq --arg role "${role}" --arg requestId "${request_id}" --arg serverSessionDigest "${actual_server_session_digest}" \
    'map(if .role == $role then .requestId = $requestId | .serverSessionDigest = $serverSessionDigest else . end)' \
    "${sessions_file}" > "${sessions_file}.next"
  mv -- "${sessions_file}.next" "${sessions_file}"
done
stage=workspace_reads_complete

# The five operations, in workflow order, with payloads derived from the
# manifest. Command ids are minted per operation and reused for the replay.
command_payload() {
  local kind=$1 command_id=$2 payload=$3
  jq -nc --arg projectId "${project_id}" --arg commandId "${command_id}" --arg kind "${kind}" \
    --argjson payload "${payload}" \
    '{contractVersion:"projectceo-command/0.1",kind:$kind,projectId:$projectId,commandId:$commandId,payload:$payload}'
}

# The submission contract requires all three published variants. Publish the
# value-engineered and premium variants through the same authenticated command
# door as the receipt chain; no private-table fixture writes are used.
while IFS= read -r preflight_payload; do
  preflight_variant_id=$(jq -er '.variantId' <<<"${preflight_payload}")
  publish_layout_preflight "${preflight_payload}" "${preflight_variant_id}"
done < <(manifest_jq -c --arg packageId "${package_id}" --arg roomId "${room_id}" \
  '.m2.variants[] | select(.role != "preferred") |
   {packageId: $packageId, documentId: .layoutDocumentId, versionId: .layoutVersionId,
    revisionId: .layoutRevisionId, expectedRevisionId: null, roomId: $roomId,
    variantId, role, semanticHash, schemaVersion: "project-ceo-m2-layout/0.1",
    layoutContent, reason: "Операторская публикация внешнего варианта AP6."}')
stage=nonpreferred_layouts_complete

layout_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
layout_payload=$(manifest_jq -c --arg packageId "${package_id}" --arg roomId "${room_id}" \
  '.m2.variants[] | select(.role == "preferred") |
   {packageId: $packageId, documentId: .layoutDocumentId, versionId: .layoutVersionId,
    revisionId: .layoutRevisionId, expectedRevisionId: null, roomId: $roomId,
    variantId, role, semanticHash, schemaVersion: "project-ceo-m2-layout/0.1",
    layoutContent, reason: "Операторская публикация внешнего варианта AP6."}')
send_command owner publish_m2_layout_version \
  "$(command_payload publish_m2_layout_version "${layout_command_id}" "${layout_payload}")" \
  "${layout_command_id}"
stage=preferred_layout_complete

submit_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
submit_payload=$(manifest_jq -c --arg packageId "${package_id}" \
  '.m2 | {packageId: $packageId, submissionId, revisionId: .submissionRevisionId,
    expectedRevisionId: null, approvalPackageId, roomId, designIntentRevisionId,
    variants: [.variants[] | {variantId, role, layoutDocumentId, layoutVersionId,
      layoutRevisionId, semanticHash, selectionRevisionIds, budget}],
    budgetAsOf, staleAfterDays, reason: "Внешний пакет передан на согласование оператором AP6."}')
send_command owner submit_m2_client_review \
  "$(command_payload submit_m2_client_review "${submit_command_id}" "${submit_payload}")" \
  "${submit_command_id}"
stage=submitted_review_complete

submission_id=$(manifest_jq -er '.m2.submissionId')
submission_revision_id=$(manifest_jq -er '.m2.submissionRevisionId')
chosen_variant_id=$(manifest_jq -er '.m2.variants[0].variantId')
review_prerequisites_after_submit=$(query_db <<SQL
select json_build_object(
  'submissionPresent', exists (
    select 1 from projectceo_product.m2_workspace_revisions submission
    where submission.project_id = '${project_id}'::uuid
      and submission.entity_kind = 'm2_client_submission'
      and submission.entity_id = '${submission_id}'
  ),
  'submissionRevisionCurrent', exists (
    select 1 from projectceo_product.m2_workspace_revisions submission
    where submission.project_id = '${project_id}'::uuid
      and submission.entity_kind = 'm2_client_submission'
      and submission.entity_id = '${submission_id}'
      and submission.revision_id = '${submission_revision_id}'
  ),
  'assignedClientDistinct', exists (
    select 1 from projectceo_product.m2_workspace_revisions submission
    where submission.project_id = '${project_id}'::uuid
      and submission.entity_kind = 'm2_client_submission'
      and submission.entity_id = '${submission_id}'
      and (submission.payload->>'submittedByActorUserId')::uuid is distinct from
          (submission.payload->>'assignedClientUserId')::uuid
  ),
  'approvalPackageRequired', exists (
    select 1 from projectceo_product.m2_workspace_revisions submission
    where submission.project_id = '${project_id}'::uuid
      and submission.entity_kind = 'm2_client_submission'
      and submission.entity_id = '${submission_id}'
      and exists (
        select 1 from projectceo_product.approval_package_events event
        where event.project_id = submission.project_id
          and event.approval_package_id = submission.payload->>'approvalPackageId'
          and event.sequence_no = 2 and event.to_status = 'submitted'
      )
      and exists (
        select 1 from projectceo_product.approval_package_events event
        where event.project_id = submission.project_id
          and event.approval_package_id = submission.payload->>'approvalPackageId'
          and event.to_status = 'approved'
          and event.self_approved = false
          and event.actor_user_id = (submission.payload->>'assignedClientUserId')::uuid
      )
  ),
  'chosenVariantPresent', exists (
    select 1 from projectceo_product.m2_workspace_revisions submission,
      jsonb_array_elements(submission.payload->'variants') variant
    where submission.project_id = '${project_id}'::uuid
      and submission.entity_kind = 'm2_client_submission'
      and submission.entity_id = '${submission_id}'
      and variant->>'variantId' = '${chosen_variant_id}'
  ),
  'chosenBudgetClean', exists (
    select 1 from projectceo_product.m2_workspace_revisions submission,
      jsonb_array_elements(submission.payload->'variants') variant
    where submission.project_id = '${project_id}'::uuid
      and submission.entity_kind = 'm2_client_submission'
      and submission.entity_id = '${submission_id}'
      and variant->>'variantId' = '${chosen_variant_id}'
      and jsonb_array_length(variant#>'{budget,staleSelectionRevisionIds}') = 0
      and jsonb_array_length(variant#>'{budget,missingPriceSelectionRevisionIds}') = 0
  )
)::text;
SQL
)
review_prerequisites_after_submit=$(print -r -- "${review_prerequisites_after_submit}" | tail -1 | jq -c .)
print -r -- "EXTERNAL_RUNNER_REVIEW_AFTER_SUBMIT ${review_prerequisites_after_submit}"

review_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
# Причина согласования попадает в аудит и остаётся там навсегда. По умолчанию
# она прямо говорит, что решение принял оператор проверки, а не заказчик, —
# доказательство не должно выглядеть как настоящее клиентское согласование.
# Осмысленную причину можно передать через EXTERNAL_RUN_REVIEW_REASON.
review_reason=${EXTERNAL_RUN_REVIEW_REASON:-"Проверочный прогон цикла 7: решение принято оператором проверки, не заказчиком"}
review_payload=$(manifest_jq -c --arg packageId "${package_id}" --arg reason "${review_reason}" \
  '.m2 | {packageId: $packageId, submissionId, revisionId: .reviewRevisionId,
    expectedRevisionId: .submissionRevisionId, chosenVariantId: .variants[0].variantId,
    decision: "approved", reason: $reason}')
send_command client review_m2_client_submission \
  "$(command_payload review_m2_client_submission "${review_command_id}" "${review_payload}")" \
  "${review_command_id}"
stage=client_review_complete

record_approved_commit_side_effect
stage=approved_commit_harvested

handoff_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
handoff_payload=$(manifest_jq -c --arg packageId "${package_id}" \
  '.m2 | {packageId: $packageId, handoffId, revisionId: .handoffRevisionId,
    expectedRevisionId: null, approvedCommitId, approvedCommitRevisionId,
    reason: "Передача согласованного внешнего пакета в контур M3."}')
send_command owner publish_m2_m3_handoff \
  "$(command_payload publish_m2_m3_handoff "${handoff_command_id}" "${handoff_payload}")" \
  "${handoff_command_id}"
stage=handoff_complete

# Lineage and proof receipts come out of the operations that just ran.
lineage=$(jq -n \
  --arg submissionId "$(manifest_jq -er '.m2.submissionId')" \
  --arg submissionRevisionId "$(manifest_jq -er '.m2.submissionRevisionId')" \
  --arg reviewId "$(manifest_jq -er '.m2.submissionId')" \
  --arg reviewRevisionId "$(manifest_jq -er '.m2.reviewRevisionId')" \
  --arg approvedCommitId "$(manifest_jq -er '.m2.approvedCommitId')" \
  --arg approvedCommitRevisionId "$(manifest_jq -er '.m2.approvedCommitRevisionId')" \
  --arg handoffId "$(manifest_jq -er '.m2.handoffId')" \
  --arg handoffRevisionId "$(manifest_jq -er '.m2.handoffRevisionId')" \
  --slurpfile submit "${work_dir}/submit_m2_client_review.json" \
  --slurpfile handoff "${work_dir}/publish_m2_m3_handoff.json" '
  {submissionId: $submissionId, submissionRevisionId: $submissionRevisionId,
   reviewId: $reviewId, reviewRevisionId: $reviewRevisionId,
   approvedCommitId: $approvedCommitId, approvedCommitRevisionId: $approvedCommitRevisionId,
   clientSubmissionId: $submissionId, clientReviewRevisionId: $reviewRevisionId,
   handoffId: $handoffId, handoffRevisionId: $handoffRevisionId,
   handoffApprovedCommitId: $approvedCommitId,
   handoffApprovedCommitRevisionId: $approvedCommitRevisionId}')

proofs="${work_dir}/proofs.json"
audit_ids_sql=$(jq -r '[.[].auditEventId | "\u0027" + . + "\u0027::uuid"] | join(",")' "${commands_file}")
audit_source="${work_dir}/proof-audit.json"
query_db > "${audit_source}" <<SQL
select coalesce(json_agg(json_build_object('auditEventId', audit.audit_event_id,
  'requestId', audit.request_id, 'commandId', audit.command_id,
  'actorUserId', command.actor_user_id) order by audit.occurred_at), '[]'::json)::text
from projectceo_product.audit_events audit
join projectceo_product.command_records command using (organization_id, project_id, command_id)
where audit.project_id = '${project_id}'::uuid and audit.audit_event_id in (${audit_ids_sql});
SQL
audit_snapshot=$(tail -1 "${audit_source}" | jq -cS .)
print -r -- "${audit_snapshot}" > "${audit_source}"
[[ $(jq 'length' "${audit_source}") == 5 ]] || { print -u2 -r -- 'EXTERNAL_RUNNER_AUDIT_PROOF_INCOMPLETE'; exit 68; }

owner_read="${work_dir}/owner-external-workspace.json"
architect_read="${work_dir}/architect-external-workspace.json"
guest_read="${work_dir}/guest-external-workspace.json"
jq -e --arg projectId "${project_id}" '.error == null and .data.project.id == $projectId' "${owner_read}" >/dev/null \
  || { print -u2 -r -- 'EXTERNAL_RUNNER_AUTHENTICATED_READ_PROOF_INVALID'; exit 68; }
jq -e --arg projectId "${project_id}" '.error == null and (.data.projects | type == "array") and (.data.projects | length) == 0 and ([.. | objects | .id? // empty] | index($projectId) == null)' "${guest_read}" >/dev/null \
  || { print -u2 -r -- 'EXTERNAL_RUNNER_TENANCY_PROOF_INVALID'; exit 68; }
for response_file in "${work_dir}"/*-external-workspace.json; do
  jq -e '[.. | objects | keys[]] | all(. != "signedUrl" and . != "storagePath" and . != "originalFilename" and . != "token")' "${response_file}" >/dev/null \
    || { print -u2 -r -- 'EXTERNAL_RUNNER_PRIVACY_PROOF_INVALID'; exit 68; }
done

authenticated_source="${work_dir}/proof-authenticated.json"
privacy_source="${work_dir}/proof-privacy.json"
tenancy_source="${work_dir}/proof-tenancy.json"
replay_source="${work_dir}/proof-replay.json"
jq -cS '{requestId, projectId: .data.project.id, status: (.error == null)}' "${owner_read}" > "${authenticated_source}"
jq -c '{requestIds: [.[].requestId], forbiddenFieldCount: 0}' "${sessions_file}" > "${privacy_source}"
jq -cS --arg projectId "${project_id}" '{requestId, guestContract: "empty_portfolio", projectCount: (.data.projects | length), externalProjectAbsent: ([.. | objects | .id? // empty] | index($projectId) == null)}' "${guest_read}" > "${tenancy_source}"
review_request_id=$(jq -er '.[2].requestId' "${commands_file}")
side_effect_count=$(query_db <<SQL
select count(*) from projectceo_product.command_records command
join projectceo_product.audit_events audit using (organization_id, project_id, command_id)
where command.project_id = '${project_id}'::uuid
  and command.operation = 'append_m2_approved_commit_revision'
  and audit.request_id = '${review_request_id}';
SQL
)
side_effect_count=$(print -r -- "${side_effect_count}" | tail -1 | tr -d '[:space:]')
[[ ${side_effect_count} == 1 ]] || { print -u2 -r -- 'EXTERNAL_RUNNER_SIDE_EFFECT_REPLAY_INVALID'; exit 68; }
jq -cS --argjson sideEffectCount "${side_effect_count}" '[.[] | {
  commandId, requestId, auditEventId, replayMode, resultDigest, replayDigest,
  replayEqual: (if .replayMode == "direct" then (.resultDigest == .replayDigest) else null end),
  sideEffectCount: (if .replayMode == "parent_atomic_side_effect" then $sideEffectCount else null end)
}]' "${commands_file}" > "${replay_source}"

print -r -- '{}' > "${proofs}"
proof_kinds=(audit authenticatedRead privacy tenancy replay)
proof_sources=("${audit_source}" "${authenticated_source}" "${privacy_source}" "${tenancy_source}" "${replay_source}")
proof_request_ids=("$(jq -er '.[0].requestId' "${audit_source}")" "$(jq -er '.requestId' "${authenticated_source}")" "$(jq -er '.requestIds[0]' "${privacy_source}")" "$(jq -er '.requestId' "${tenancy_source}")" "$(jq -er '.[1].requestId' "${replay_source}")")
for index in {1..5}; do
  proof=${proof_kinds[index]}; proof_source=${proof_sources[index]}; query_request_id=${proof_request_ids[index]}
  audit_event_ids='[]'
  if [[ ${proof} == audit || ${proof} == replay ]]; then
    audit_event_ids=$(jq -c '[.[].auditEventId]' "${commands_file}")
  fi
  proof_digest=$(jq -cSj . "${proof_source}" | shasum -a 256 | awk '{print "sha256:"$1}')
  command_ids=$(jq -c '[.[].commandId]' "${commands_file}")
  jq --arg proof "${proof}" --arg queryRequestId "${query_request_id}" --argjson auditEventIds "${audit_event_ids}" \
    --arg resultDigest "${proof_digest}" --arg organizationId "${organization_id}" --arg projectId "${project_id}" --arg packageId "${package_id}" \
    --arg manifestDigest "${expected_manifest_digest}" --arg challengeNonce "${challenge_nonce}" --argjson commandIds "${command_ids}" --slurpfile source "${proof_source}" \
    '.[$proof] = {kind: $proof, queryRequestId: $queryRequestId, auditEventIds: $auditEventIds,
      resultDigest: $resultDigest, organizationId: $organizationId, projectId: $projectId, packageId: $packageId,
      manifestDigest: $manifestDigest, challengeNonce: $challengeNonce, commandIds: $commandIds, source: $source[0]}' \
    "${proofs}" > "${proofs}.next"
  mv -- "${proofs}.next" "${proofs}"
done

jq -n --arg organizationId "${organization_id}" --arg projectId "${project_id}" \
  --arg packageId "${package_id}" \
  --slurpfile sessions "${sessions_file}" --slurpfile commands "${commands_file}" \
  --argjson lineage "${lineage}" --slurpfile proofs "${proofs}" '
  {scope: {organizationId: $organizationId, projectId: $projectId, packageId: $packageId},
   sessions: $sessions[0],
   commands: $commands[0],
   lineage: $lineage,
   proofs: $proofs[0]}' > "${harvest_file}"

# The builder revalidates every identifier, the operation chain, the state
# revision chain and the replay digests before anything is written.
./node_modules/.bin/tsx tests/pilot-evidence/external-pilot-receipt-cli.ts \
  "${receipt_path}" "${challenge_nonce}" "${expected_manifest_digest}" \
  "${executor_relative}" "${executor_digest}" "${executor_verification_receipt_id}" \
  "${kora_receipt_id}" "${kora_receipt_digest}" "${kora_producer_path}" "${kora_producer_digest}" \
  "${harvest_file}"

if [[ ! -s ${receipt_path} ]]; then
  print -u2 -r -- 'EXTERNAL_RUNNER_RECEIPT_NOT_WRITTEN'
  exit 69
fi
print -r -- "EXTERNAL_RUN_RECEIPT_WRITTEN executor=${executor_relative}"
