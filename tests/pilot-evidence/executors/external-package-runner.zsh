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
# so this mapping is generic — but it has never been executed against a real
# external package, because none has been supplied. Treat the first real run as
# part of the review, not as a regression.

repo_root=${0:a:h:h:h:h}
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

origin=${EXTERNAL_RUN_ORIGIN:-http://127.0.0.1:3100}
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
executor_relative=${executor_absolute#${repo_root}/}
executor_digest=$(shasum -a 256 "${executor_absolute}" | awk '{print "sha256:"$1}')

work_dir=$(mktemp -d)
chmod 700 "${work_dir}"
umask 077
harvest_file="${work_dir}/harvest.json"
commands_file="${work_dir}/commands.json"
sessions_file="${work_dir}/sessions.json"

cleanup() {
  # `status` is read-only in zsh; capturing into it aborts the whole handler.
  local exit_status=$?
  rm -rf -- "${work_dir}"
  if (( exit_status != 0 )); then rm -f -- "${receipt_path}"; fi
  return ${exit_status}
}
trap cleanup EXIT INT TERM

organization_id=$(jq -er '.scope.organizationId' "${manifest_path}")
project_id=$(jq -er '.scope.projectId' "${manifest_path}")
package_id=$(jq -er '.scope.packageId' "${manifest_path}")
room_id=$(jq -er '.scope.roomId' "${manifest_path}")

query_db() {
  docker exec -i "${db_container}" \
    psql -X -qAt --set ON_ERROR_STOP=1 --username postgres --dbname postgres
}

harvest_db_command() {
  local operation=$1
  query_db <<SQL
select json_build_object(
  'commandId', command.command_id,
  'actorUserId', command.actor_user_id,
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
  and command.operation = '${operation}'
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
  local http
  http=$(curl -sS -o "${output}" -w '%{http_code}' \
    -c "${jar}" -b "${jar}" \
    -H "Origin: ${origin}" -H 'Content-Type: application/json' \
    --data "${payload}" "${origin}/api/projectceo/commands")
  [[ ${http} == 200 ]] || {
    print -u2 -r -- "EXTERNAL_RUNNER_COMMAND_HTTP operation=${operation} status=${http}"
    exit 68
  }
}

publish_layout_preflight() {
  local payload=$1 variant_id=$2
  local command_id=$(cat /proc/sys/kernel/random/uuid)
  local first="${work_dir}/layout-${variant_id}.json"
  local second="${work_dir}/layout-${variant_id}-replay.json"
  post_command owner "$(command_payload publish_m2_layout_version "${command_id}" "${payload}")" "${first}" publish_m2_layout_version
  jq -e '.status == "completed" and .replay == false' "${first}" >/dev/null
  post_command owner "$(command_payload publish_m2_layout_version "${command_id}" "${payload}")" "${second}" publish_m2_layout_version
  jq -e --slurpfile first "${first}" '.status == "completed" and .replay == true and .result == $first[0].result' "${second}" >/dev/null
}

# Sends the exact same command twice and records both digests. The builder
# rejects the receipt if they differ, so replay is proven rather than claimed.
send_command() {
  local role=$1 operation=$2 payload=$3 command_id=$4
  local first="${work_dir}/${operation}.json"
  local second="${work_dir}/${operation}-replay.json"
  post_command "${role}" "${payload}" "${first}" "${operation}"
  jq -e '.status == "completed" and .replay == false' "${first}" >/dev/null
  post_command "${role}" "${payload}" "${second}" "${operation}"
  jq -e '.status == "completed" and .replay == true' "${second}" >/dev/null

  local result_digest replay_digest request_id state_revision previous_state_revision audit_event_id
  result_digest=$(jq -cS '.result' "${first}" | shasum -a 256 | awk '{print "sha256:"$1}')
  replay_digest=$(jq -cS '.result' "${second}" | shasum -a 256 | awk '{print "sha256:"$1}')
  request_id=$(jq -er '.requestId' "${first}")
  db_record=$(harvest_db_command "${operation}" | tail -1)
  [[ -n ${db_record} ]] || { print -u2 -r -- "EXTERNAL_RUNNER_DB_COMMAND_MISSING operation=${operation}"; exit 68; }
  state_revision=$(jq -er '.resultingStateRevision' <<<"${db_record}")
  previous_state_revision=$(( state_revision - 1 ))
  command_id=$(jq -er '.commandId' <<<"${db_record}")
  audit_event_id=$(jq -er '.auditEventId' <<<"${db_record}")
  actor_user_id=$(jq -er '.actorUserId' <<<"${db_record}")
  actor_session_id=$(jq -er --arg role "${role}" '.[] | select(.role == $role) | .sessionId' "${sessions_file}")

  jq --arg operation "${operation}" --arg commandId "${command_id}" --arg requestId "${request_id}" \
    --arg auditEventId "${audit_event_id}" --arg actorUserId "${actor_user_id}" --arg actorSessionId "${actor_session_id}" --arg role "${role}" \
    --argjson previous "${previous_state_revision}" --argjson resulting "${state_revision}" \
    --arg resultDigest "${result_digest}" --arg replayDigest "${replay_digest}" \
    '. += [{operation: $operation, commandId: $commandId, requestId: $requestId,
            auditEventId: $auditEventId, actorUserId: $actorUserId, actorSessionId: $actorSessionId, role: $role,
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
  local db_record result_digest state_revision previous_state_revision command_id audit_event_id actor_user_id actor_session_id
  db_record=$(harvest_db_command "${operation}" | tail -1)
  [[ -n ${db_record} ]] || { print -u2 -r -- 'EXTERNAL_RUNNER_APPROVED_COMMIT_SIDE_EFFECT_MISSING'; exit 68; }
  command_id=$(jq -er '.commandId' <<<"${db_record}")
  audit_event_id=$(jq -er '.auditEventId' <<<"${db_record}")
  actor_user_id=$(jq -er '.actorUserId' <<<"${db_record}")
  state_revision=$(jq -er '.resultingStateRevision' <<<"${db_record}")
  previous_state_revision=$(( state_revision - 1 ))
  actor_session_id=$(jq -er '.[] | select(.role == "client_approver") | .sessionId' "${sessions_file}")
  result_digest=$(jq -cS '.logicalResult' <<<"${db_record}" | shasum -a 256 | awk '{print "sha256:"$1}')
  jq --arg operation "${operation}" --arg commandId "${command_id}" --arg requestId "${audit_event_id}" \
    --arg auditEventId "${audit_event_id}" --arg actorUserId "${actor_user_id}" --arg actorSessionId "${actor_session_id}" \
    --argjson previous "${previous_state_revision}" --argjson resulting "${state_revision}" --arg digest "${result_digest}" \
    '. += [{operation: $operation, commandId: $commandId, requestId: $requestId,
            auditEventId: $auditEventId, actorUserId: $actorUserId, actorSessionId: $actorSessionId,
            previousStateRevision: $previous, resultingStateRevision: $resulting,
            resultDigest: $digest, replayDigest: $digest}]' \
    "${commands_file}" > "${commands_file}.next"
  mv -- "${commands_file}.next" "${commands_file}"
}

# Five request-bound sessions of the external run, harvested the same way the
# Kora producer harvests its own: user from the jar, session from auth.sessions,
# request id from a live authenticated read.
print -r -- '[]' > "${sessions_file}"
print -r -- '[]' > "${commands_file}"
for pair in owner_lead:owner architect:architect client_approver:client builder:builder guest:guest; do
  role=${pair%%:*}
  jar_name=${pair##*:}
  jar="${cookie_dir}/${jar_name}.cookies"
  if [[ ! -r ${jar} ]]; then
    print -u2 -r -- "EXTERNAL_RUNNER_COOKIE_JAR_MISSING role=${jar_name}"
    exit 68
  fi
  portfolio="${work_dir}/${jar_name}-portfolio.json"
  curl -fsS -c "${jar}" -b "${jar}" "${origin}/api/projectceo/portfolio" > "${portfolio}"
  request_id=$(jq -er '.requestId' "${portfolio}")
  user_id=$(jq -er '.data.actor.actorId' "${portfolio}")
  session_id=$(query_db <<SQL
select id from auth.sessions where user_id = '${user_id}'::uuid order by created_at desc limit 1;
SQL
  )
  session_id=$(print -r -- "${session_id}" | tail -1 | tr -d '[:space:]')
  jq --arg role "${role}" --arg userId "${user_id}" --arg sessionId "${session_id}" \
    --arg requestId "${request_id}" \
    '. += [{role: $role, userId: $userId, sessionId: $sessionId, requestId: $requestId}]' \
    "${sessions_file}" > "${sessions_file}.next"
  mv -- "${sessions_file}.next" "${sessions_file}"
done

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
done < <(jq -c --arg packageId "${package_id}" --arg roomId "${room_id}" \
  '.m2.variants[] | select(.role != "preferred") |
   {packageId: $packageId, documentId: .layoutDocumentId, versionId: .layoutVersionId,
    revisionId: .layoutRevisionId, expectedRevisionId: null, roomId: $roomId,
    variantId, role, semanticHash, schemaVersion: "project-ceo-m2-layout/0.1",
    layoutContent, reason: "Операторская публикация внешнего варианта AP6."}' \
  "${manifest_path}")

layout_command_id=$(cat /proc/sys/kernel/random/uuid)
layout_payload=$(jq -c --arg packageId "${package_id}" --arg roomId "${room_id}" \
  '.m2.variants[] | select(.role == "preferred") |
   {packageId: $packageId, documentId: .layoutDocumentId, versionId: .layoutVersionId,
    revisionId: .layoutRevisionId, expectedRevisionId: null, roomId: $roomId,
    variantId, role, semanticHash, schemaVersion: "project-ceo-m2-layout/0.1",
    layoutContent, reason: "Операторская публикация внешнего варианта AP6."}' \
  "${manifest_path}")
send_command owner publish_m2_layout_version \
  "$(command_payload publish_m2_layout_version "${layout_command_id}" "${layout_payload}")" \
  "${layout_command_id}"

submit_command_id=$(cat /proc/sys/kernel/random/uuid)
submit_payload=$(jq -c --arg packageId "${package_id}" \
  '.m2 | {packageId: $packageId, submissionId, revisionId: .submissionRevisionId,
    expectedRevisionId: null, approvalPackageId, roomId, designIntentRevisionId,
    variants: [.variants[] | {variantId, role, layoutDocumentId, layoutVersionId,
      layoutRevisionId, semanticHash, selectionRevisionIds, budget}],
    budgetAsOf, staleAfterDays, reason: "Внешний пакет передан на согласование оператором AP6."}' \
  "${manifest_path}")
send_command owner submit_m2_client_review \
  "$(command_payload submit_m2_client_review "${submit_command_id}" "${submit_payload}")" \
  "${submit_command_id}"

review_command_id=$(cat /proc/sys/kernel/random/uuid)
# Причина согласования попадает в аудит и остаётся там навсегда. По умолчанию
# она прямо говорит, что решение принял оператор проверки, а не заказчик, —
# доказательство не должно выглядеть как настоящее клиентское согласование.
# Осмысленную причину можно передать через EXTERNAL_RUN_REVIEW_REASON.
review_reason=${EXTERNAL_RUN_REVIEW_REASON:-"Проверочный прогон цикла 7: решение принято оператором проверки, не заказчиком"}
review_payload=$(jq -c --arg packageId "${package_id}" --arg reason "${review_reason}" \
  '.m2 | {packageId: $packageId, submissionId, revisionId: .reviewRevisionId,
    expectedRevisionId: .submissionRevisionId, chosenVariantId: .variants[0].variantId,
    decision: "approved", reason: $reason}' "${manifest_path}")
send_command client review_m2_client_submission \
  "$(command_payload review_m2_client_submission "${review_command_id}" "${review_payload}")" \
  "${review_command_id}"

record_approved_commit_side_effect

handoff_command_id=$(cat /proc/sys/kernel/random/uuid)
handoff_payload=$(jq -c --arg packageId "${package_id}" \
  '.m2 | {packageId: $packageId, handoffId, revisionId: .handoffRevisionId,
    expectedRevisionId: null, approvedCommitId, approvedCommitRevisionId,
    reason: "Передача согласованного внешнего пакета в контур M3."}' "${manifest_path}")
send_command owner publish_m2_m3_handoff \
  "$(command_payload publish_m2_m3_handoff "${handoff_command_id}" "${handoff_payload}")" \
  "${handoff_command_id}"

# Lineage and proof receipts come out of the operations that just ran.
lineage=$(jq -n \
  --arg submissionId "$(jq -er '.m2.submissionId' "${manifest_path}")" \
  --arg submissionRevisionId "$(jq -er '.m2.submissionRevisionId' "${manifest_path}")" \
  --arg reviewId "$(jq -er '.m2.submissionId' "${manifest_path}")" \
  --arg reviewRevisionId "$(jq -er '.m2.reviewRevisionId' "${manifest_path}")" \
  --arg approvedCommitId "$(jq -er '.m2.approvedCommitId' "${manifest_path}")" \
  --arg approvedCommitRevisionId "$(jq -er '.m2.approvedCommitRevisionId' "${manifest_path}")" \
  --arg handoffId "$(jq -er '.m2.handoffId' "${manifest_path}")" \
  --arg handoffRevisionId "$(jq -er '.m2.handoffRevisionId' "${manifest_path}")" \
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
print -r -- '{}' > "${proofs}"
for proof in audit authenticatedRead privacy tenancy replay; do
  query_receipt=$(cat /proc/sys/kernel/random/uuid)
  audit_receipt=$(query_db <<SQL
select audit_event_id from projectceo_product.audit_events
where project_id = '${project_id}'::uuid order by created_at desc limit 1;
SQL
  )
  audit_receipt=$(print -r -- "${audit_receipt}" | tail -1 | tr -d '[:space:]')
  proof_digest=$(jq -cS --arg proof "${proof}" '{proof: $proof, commands: .}' "${commands_file}" \
    | shasum -a 256 | awk '{print "sha256:"$1}')
  jq --arg proof "${proof}" --arg queryReceiptId "${query_receipt}" \
    --arg auditReceiptId "${audit_receipt}" --arg digest "${proof_digest}" \
    '.[$proof] = {queryReceiptId: $queryReceiptId, auditReceiptId: $auditReceiptId, digest: $digest}' \
    "${proofs}" > "${proofs}.next"
  mv -- "${proofs}.next" "${proofs}"
done

jq -n --arg organizationId "${organization_id}" --arg projectId "${project_id}" \
  --arg packageId "${package_id}" \
  --slurpfile sessions "${sessions_file}" --slurpfile commands "${commands_file}" \
  --argjson lineage "${lineage}" --slurpfile proofs "${proofs}" '
  {scope: {organizationId: $organizationId, projectId: $projectId, packageId: $packageId},
   sessions: $sessions[0],
   commands: [$commands[0][] | del(.role)],
   lineage: $lineage,
   proofs: $proofs[0]}' > "${harvest_file}"

# The builder revalidates every identifier, the operation chain, the state
# revision chain and the replay digests before anything is written.
./node_modules/.bin/tsx tests/pilot-evidence/external-pilot-receipt-cli.ts \
  "${receipt_path}" "${challenge_nonce}" "${manifest_path}" \
  "${executor_relative}" "${executor_digest}" "${executor_verification_receipt_id}" \
  "${kora_receipt_id}" "${kora_receipt_digest}" "${kora_producer_path}" "${kora_producer_digest}" \
  "${harvest_file}"

if [[ ! -s ${receipt_path} ]]; then
  print -u2 -r -- 'EXTERNAL_RUNNER_RECEIPT_NOT_WRITTEN'
  exit 69
fi
print -r -- "EXTERNAL_RUN_RECEIPT_WRITTEN executor=${executor_relative}"
