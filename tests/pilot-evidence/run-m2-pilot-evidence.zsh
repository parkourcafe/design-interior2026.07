#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h}
cd "${repo_root}"
kora_manifest=tests/fixtures/cycle7/kora-one-room-pilot.json
external_manifest=${ARCHIDOM_EXTERNAL_PILOT_MANIFEST:-}
external_executor=${ARCHIDOM_EXTERNAL_PILOT_EXECUTOR:-}
external_executor_digest=${ARCHIDOM_EXTERNAL_PILOT_EXECUTOR_SHA256:-}
kora_receipt_producer=${ARCHIDOM_KORA_FIVE_SESSION_PRODUCER:-}
kora_receipt_producer_digest=${ARCHIDOM_KORA_FIVE_SESSION_PRODUCER_SHA256:-}
evidence_dir=${ARCHIDOM_PILOT_EVIDENCE_OUT:-/private/tmp/archidom-m2-pilot-evidence}
pending_artifact="${evidence_dir}/PENDING.json"
receipt_artifact="${evidence_dir}/RECEIPT.json"
kora_five_receipt="${evidence_dir}/KORA_RECEIPT.json"

cleanup() {
  # `status` is a read-only special parameter in zsh: declaring it local aborts
  # this function on its first line and silently skips the failure cleanup.
  local exit_status=$?
  rm -f -- "${evidence_dir}/PASS.json.tmp"
  if (( exit_status != 0 )); then rm -f -- "${pending_artifact}" "${receipt_artifact}" "${kora_five_receipt}"; fi
  return ${exit_status}
}
trap cleanup EXIT INT TERM

if [[ -z ${external_manifest} || ! -r ${external_manifest} ]]; then
  print -u2 -r -- '{"contractVersion":"archidom.m2-pilot-run-evidence/0.1","external":{"status":"not_supplied"},"productionChanged":false}'
  exit 66
fi
if [[ -z ${external_executor} || ! -x ${external_executor} ]]; then
  print -u2 -r -- '{"contractVersion":"archidom.m2-pilot-run-evidence/0.1","external":{"status":"pending_executor"},"productionChanged":false}'
  exit 67
fi
executor_absolute=${external_executor:A}
[[ ${executor_absolute} == ${repo_root}/tests/pilot-evidence/executors/* ]] || { print -u2 -r -- 'CYCLE7_REPOSITORY_EXECUTOR_REQUIRED'; exit 67; }
executor_relative=${executor_absolute#${repo_root}/}
git ls-files --error-unmatch "${executor_relative}" >/dev/null 2>&1 || { print -u2 -r -- 'CYCLE7_GIT_TRACKED_EXECUTOR_REQUIRED'; exit 67; }
executor_actual_digest=$(shasum -a 256 "${executor_absolute}" | awk '{print "sha256:"$1}')
[[ -n ${external_executor_digest} && ${executor_actual_digest} == ${external_executor_digest} ]] || { print -u2 -r -- 'CYCLE7_EXECUTOR_DIGEST_MISMATCH'; exit 67; }
jq -e --arg path "${executor_relative}" --arg digest "${executor_actual_digest}" \
  '.contractVersion == "archidom.pilot-executor-allowlist/0.1" and any(.executors[]; .path == $path and .digest == $digest)' \
  tests/pilot-evidence/executors/allowlist.json >/dev/null || { print -u2 -r -- 'CYCLE7_EXECUTOR_NOT_ALLOWLISTED'; exit 67; }
[[ -n ${kora_receipt_producer} && -x ${kora_receipt_producer} ]] || { print -u2 -r -- 'CYCLE7_KORA_RECEIPT_PRODUCER_REQUIRED'; exit 67; }
kora_producer_absolute=${kora_receipt_producer:A}
[[ ${kora_producer_absolute} == ${repo_root}/tests/pilot-evidence/executors/* ]] || { print -u2 -r -- 'CYCLE7_REPOSITORY_KORA_PRODUCER_REQUIRED'; exit 67; }
kora_producer_relative=${kora_producer_absolute#${repo_root}/}
git ls-files --error-unmatch "${kora_producer_relative}" >/dev/null 2>&1 || { print -u2 -r -- 'CYCLE7_GIT_TRACKED_KORA_PRODUCER_REQUIRED'; exit 67; }
kora_producer_digest=$(shasum -a 256 "${kora_producer_absolute}" | awk '{print "sha256:"$1}')
[[ -n ${kora_receipt_producer_digest} && ${kora_producer_digest} == ${kora_receipt_producer_digest} ]] || { print -u2 -r -- 'CYCLE7_KORA_PRODUCER_DIGEST_MISMATCH'; exit 67; }
jq -e --arg path "${kora_producer_relative}" --arg digest "${kora_producer_digest}" \
  'any(.executors[]; .path == $path and .digest == $digest)' tests/pilot-evidence/executors/allowlist.json >/dev/null \
  || { print -u2 -r -- 'CYCLE7_KORA_PRODUCER_NOT_ALLOWLISTED'; exit 67; }
mkdir -p "${evidence_dir}"
chmod 700 "${evidence_dir}"
umask 077
[[ ! -e ${kora_five_receipt} ]] || { print -u2 -r -- 'CYCLE7_KORA_RECEIPT_ALREADY_EXISTS'; exit 67; }
challenge_nonce="cycle7-challenge-$(openssl rand -hex 24)"
executor_verification_receipt_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
"${kora_producer_absolute}" "${challenge_nonce}" "${kora_five_receipt}"
[[ -f ${kora_five_receipt} && ! -L ${kora_five_receipt} ]] || { print -u2 -r -- 'CYCLE7_KORA_PRODUCER_RECEIPT_REQUIRED'; exit 67; }
jq -e --arg producer_path "${kora_producer_relative}" --arg producer_digest "${kora_producer_digest}" --arg nonce "${challenge_nonce}" '
  .marker == "RUN_FIVE_REQUEST_BOUND_SESSIONS"
  and .producer.repoOwned == true
  and .producer.path == $producer_path
  and .producer.digest == $producer_digest
  and .producer.challengeNonce == $nonce
  and (.receiptId | test("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"))
  and ([.sessions[].role] == ["owner_lead", "architect", "client_approver", "builder", "guest"])
  and (.sessions | length == 5)
  and (all(.sessions[]; (.userId | test("^[0-9a-fA-F-]{36}$")) and (.sessionId | test("^[0-9a-fA-F-]{36}$")) and (.requestId | test("^[0-9a-fA-F-]{36}$"))))
  and ([.sessions[].userId] | unique | length == 5)
  and ([.sessions[].sessionId] | unique | length == 5)
  and ([.sessions[].requestId] | unique | length == 5)
' "${kora_five_receipt}" >/dev/null || { print -u2 -r -- 'CYCLE7_INVALID_KORA_FIVE_SESSION_RECEIPT'; exit 67; }
kora_receipt_digest=$(shasum -a 256 "${kora_five_receipt}" | awk '{print "sha256:"$1}')
kora_receipt_id=$(jq -r '.receiptId' "${kora_five_receipt}")

./node_modules/.bin/tsx tests/pilot-evidence/run-m2-pilot-evidence.ts prepare \
  "${kora_manifest}" "${external_manifest}" "${pending_artifact}" "${challenge_nonce}" \
  "${executor_relative}" "${executor_actual_digest}" "${executor_verification_receipt_id}" \
  "${kora_five_receipt}" "${kora_receipt_digest}" "${kora_producer_relative}" "${kora_producer_digest}"

# These fixed Kora gates prove local replay, audit, privacy, tenancy and restart
# regression only. They cannot substitute for external package execution.
zsh tests/projectceo-e2e/run-local.zsh
zsh tests/db4/run.zsh
PI_DB_IMAGE=postgres:17-alpine zsh tests/db4/run.zsh

# The independently supplied executable must exercise the external manifest
# with five request-bound sessions and emit the exact machine receipt. This
# wrapper provides no credentials and accepts no hand-authored PASS marker.
# Required receipt operations: publish_m2_layout_version,
# submit_m2_client_review, review_m2_client_submission,
# publish_m2_m3_handoff; each includes replay proof.
./node_modules/.bin/tsx tests/pilot-evidence/run-pilot-executor-cli.ts \
  "${executor_absolute}" "${challenge_nonce}" "${evidence_dir}" "${external_manifest}" \
  "${executor_verification_receipt_id}" "${kora_receipt_digest}" "${kora_receipt_id}" \
  "${kora_producer_relative}" "${kora_producer_digest}"
[[ -s ${receipt_artifact} ]] || { print -u2 -r -- 'CYCLE7_MACHINE_RECEIPT_REQUIRED'; exit 68; }

./node_modules/.bin/tsx tests/pilot-evidence/finalize-m2-pilot-evidence-cli.ts \
  "${receipt_artifact}" "${evidence_dir}" "${pending_artifact}" "${kora_five_receipt}" "External real package"
print -r -- "KORA_LOCAL_AUTHENTICATED_PASS evidence=${evidence_dir}/PASS.json"
print -r -- "EXTERNAL_REAL_PACKAGE_PASS evidence=${evidence_dir}/PASS.json"
