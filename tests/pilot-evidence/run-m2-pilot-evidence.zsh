#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h}
cd "${repo_root}"
kora_manifest=tests/fixtures/cycle7/kora-one-room-pilot.json
external_manifest=${ARCHIDOM_EXTERNAL_PILOT_MANIFEST:-tests/fixtures/cycle7/external-package.manifest.json}
external_executor=${ARCHIDOM_EXTERNAL_PILOT_EXECUTOR:-tests/pilot-evidence/executors/external-package-runner.zsh}
external_executor_digest=${ARCHIDOM_EXTERNAL_PILOT_EXECUTOR_SHA256:-}
kora_receipt_producer=${ARCHIDOM_KORA_FIVE_SESSION_PRODUCER:-tests/pilot-evidence/executors/kora-five-session-producer.zsh}
kora_receipt_producer_digest=${ARCHIDOM_KORA_FIVE_SESSION_PRODUCER_SHA256:-}
evidence_dir=${ARCHIDOM_PILOT_EVIDENCE_OUT:-/private/tmp/archidom-m2-pilot-evidence}
pending_artifact="${evidence_dir}/PENDING.json"
receipt_artifact="${evidence_dir}/RECEIPT.json"
kora_five_receipt="${evidence_dir}/KORA_RECEIPT.json"
ap1_profile=archidom-ap1-disposable
# The canonical evidence path never accepts a caller-selected loopback target,
# container or cookie directory. Those diagnostic overrides exist only for a
# direct local executor invocation and must not survive into H15 execution.
unset EXTERNAL_RUN_ORIGIN EXTERNAL_RUN_DB_CONTAINER EXTERNAL_RUN_COOKIE_DIR AP1_NEXT_PORT DOCKER_HOST
export DOCKER_HOST=unix://${HOME}/.colima/${ap1_profile}/docker.sock
kora_window_line=""
pinned_executor=""
pinned_manifest=""
pin_dir=""

cleanup() {
  # `status` is a read-only special parameter in zsh: declaring it local aborts
  # this function on its first line and silently skips the failure cleanup.
  local exit_status=$?
  rm -f -- "${evidence_dir}/PASS.json.tmp"
  [[ -z ${pin_dir} ]] || rm -rf -- "${pin_dir}"
  if (( exit_status != 0 )); then rm -f -- "${pending_artifact}" "${receipt_artifact}" "${kora_five_receipt}"; fi
  if [[ -n ${kora_window_line} ]]; then
    preserved_evidence=$(print -r -- "${kora_window_line}" | sed -n 's/.*evidence=\([^ ]*\).*/\1/p')
    preserved_runtime=$(print -r -- "${kora_window_line}" | sed -n 's/.*runtime=\([^ ]*\).*/\1/p')
    preserved_next_pid=$(print -r -- "${kora_window_line}" | sed -n 's/.*next_pid=\([^ ]*\).*/\1/p')
    if [[ ${preserved_next_pid:-unset} != unset ]]; then
      kill "${preserved_next_pid}" >/dev/null 2>&1 || true
      wait "${preserved_next_pid}" >/dev/null 2>&1 || true
    fi
    if [[ ${preserved_runtime:-unset} != unset && -d ${preserved_runtime:-} ]]; then
      rm -rf -- "${preserved_runtime}"
    fi
    if [[ -n ${preserved_evidence:-} && -d ${preserved_evidence} ]]; then
      rm -f -- "${preserved_evidence}"/*.cookies(N) "${preserved_evidence}"/invite-*.json(N)
    fi
    rm -f -- /private/tmp/projectceo-ap1-sessions.json /private/tmp/projectceo-ap1-next.log
  fi
  if [[ -x tests/ap1/environment/run-local.zsh ]]; then
    zsh tests/ap1/environment/run-local.zsh dispose >/dev/null 2>&1 || true
  fi
  return ${exit_status}
}
trap cleanup EXIT INT TERM

[[ -r ${external_manifest} ]] || { print -u2 -r -- 'CYCLE7_EXTERNAL_MANIFEST_REQUIRED'; exit 66; }
if [[ ! -x ${external_executor} ]]; then
  print -u2 -r -- '{"contractVersion":"archidom.m2-pilot-run-evidence/0.1","external":{"status":"pending_executor"},"productionChanged":false}'
  exit 67
fi
executor_absolute=${external_executor:A}
[[ ${executor_absolute} == ${repo_root}/tests/pilot-evidence/executors/* ]] || { print -u2 -r -- 'CYCLE7_REPOSITORY_EXECUTOR_REQUIRED'; exit 67; }
executor_relative=${executor_absolute#${repo_root}/}
git ls-files --error-unmatch "${executor_relative}" >/dev/null 2>&1 || { print -u2 -r -- 'CYCLE7_GIT_TRACKED_EXECUTOR_REQUIRED'; exit 67; }
executor_actual_digest=$(shasum -a 256 "${executor_absolute}" | awk '{print "sha256:"$1}')
external_executor_digest=${external_executor_digest:-${executor_actual_digest}}
[[ ${executor_actual_digest} == ${external_executor_digest} ]] || { print -u2 -r -- 'CYCLE7_EXECUTOR_DIGEST_MISMATCH'; exit 67; }
jq -e --arg path "${executor_relative}" --arg digest "${executor_actual_digest}" \
  '.contractVersion == "archidom.pilot-executor-allowlist/0.1" and any(.executors[]; .path == $path and .digest == $digest)' \
  tests/pilot-evidence/executors/allowlist.json >/dev/null || { print -u2 -r -- 'CYCLE7_EXECUTOR_NOT_ALLOWLISTED'; exit 67; }
[[ -x ${kora_receipt_producer} ]] || { print -u2 -r -- 'CYCLE7_KORA_RECEIPT_PRODUCER_REQUIRED'; exit 67; }
kora_producer_absolute=${kora_receipt_producer:A}
[[ ${kora_producer_absolute} == ${repo_root}/tests/pilot-evidence/executors/* ]] || { print -u2 -r -- 'CYCLE7_REPOSITORY_KORA_PRODUCER_REQUIRED'; exit 67; }
kora_producer_relative=${kora_producer_absolute#${repo_root}/}
git ls-files --error-unmatch "${kora_producer_relative}" >/dev/null 2>&1 || { print -u2 -r -- 'CYCLE7_GIT_TRACKED_KORA_PRODUCER_REQUIRED'; exit 67; }
kora_producer_digest=$(shasum -a 256 "${kora_producer_absolute}" | awk '{print "sha256:"$1}')
kora_receipt_producer_digest=${kora_receipt_producer_digest:-${kora_producer_digest}}
[[ ${kora_producer_digest} == ${kora_receipt_producer_digest} ]] || { print -u2 -r -- 'CYCLE7_KORA_PRODUCER_DIGEST_MISMATCH'; exit 67; }
jq -e --arg path "${kora_producer_relative}" --arg digest "${kora_producer_digest}" \
  'any(.executors[]; .path == $path and .digest == $digest)' tests/pilot-evidence/executors/allowlist.json >/dev/null \
  || { print -u2 -r -- 'CYCLE7_KORA_PRODUCER_NOT_ALLOWLISTED'; exit 67; }
evidence_absolute=${evidence_dir:A}
[[ ${evidence_absolute} == /private/tmp/* && ! -L ${evidence_dir} ]] \
  || { print -u2 -r -- 'CYCLE7_EVIDENCE_DIRECTORY_REJECTED'; exit 67; }
mkdir -p "${evidence_dir}"
[[ -d ${evidence_dir} && ! -L ${evidence_dir} ]] \
  || { print -u2 -r -- 'CYCLE7_EVIDENCE_DIRECTORY_REJECTED'; exit 67; }
chmod 700 "${evidence_dir}"
umask 077
pin_dir=$(mktemp -d "${evidence_dir}/.pinned-inputs.XXXXXX")
chmod 700 "${pin_dir}"
pinned_executor="${pin_dir}/external-package-runner.pinned.zsh"
pinned_manifest="${pin_dir}/external-package-manifest.pinned.json"
cp -- "${executor_absolute}" "${pinned_executor}"
cp -- "${external_manifest}" "${pinned_manifest}"
chmod 500 "${pinned_executor}"
chmod 400 "${pinned_manifest}"
pinned_executor_digest=$(shasum -a 256 "${pinned_executor}" | awk '{print "sha256:"$1}')
pinned_manifest_digest=$(shasum -a 256 "${pinned_manifest}" | awk '{print "sha256:"$1}')
[[ ${pinned_executor_digest} == ${executor_actual_digest} ]] || { print -u2 -r -- 'CYCLE7_PINNED_EXECUTOR_DIGEST_MISMATCH'; exit 67; }
[[ ${pinned_manifest_digest} == sha256:* ]] || { print -u2 -r -- 'CYCLE7_PINNED_MANIFEST_DIGEST_INVALID'; exit 67; }
[[ ! -e ${kora_five_receipt} ]] || { print -u2 -r -- 'CYCLE7_KORA_RECEIPT_ALREADY_EXISTS'; exit 67; }
challenge_nonce="cycle7-challenge-$(openssl rand -hex 24)"
executor_verification_receipt_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
zsh tests/ap1/environment/run-local.zsh start
kora_log="${evidence_dir}/kora-producer.log"
KORA_KEEP_EVIDENCE=1 "${kora_producer_absolute}" "${challenge_nonce}" "${kora_five_receipt}" 2>&1 | tee "${kora_log}"
kora_window_line=$(sed -n 's/^\(KORA_PRESERVED_EVIDENCE_WINDOW .*\)$/\1/p' "${kora_log}" | tail -1)
[[ -n ${kora_window_line} ]] || { print -u2 -r -- 'CYCLE7_KORA_EVIDENCE_WINDOW_REQUIRED'; exit 67; }
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
  "${kora_manifest}" "${pinned_manifest}" "${pending_artifact}" "${challenge_nonce}" \
  "${executor_relative}" "${executor_actual_digest}" "${executor_verification_receipt_id}" \
  "${kora_five_receipt}" "${kora_receipt_digest}" "${kora_producer_relative}" "${kora_producer_digest}"

# These fixed Kora gates prove local replay, audit, privacy, tenancy and restart
# regression only. They cannot substitute for external package execution.
zsh tests/projectceo-e2e/run-local.zsh
zsh tests/db4/run.zsh
PI_DB_IMAGE=postgres:17-alpine zsh tests/db4/run.zsh

# The repository-owned executable exercises the external manifest with five
# request-bound sessions and emits the exact machine receipt. Its local origin
# and database container are discovered from the disposable profile; no
# EXTERNAL_RUN_* operator variables are part of the canonical path.
# The receipt chain is publish_m2_layout_version -> submit_m2_client_review ->
# review_m2_client_submission -> append_m2_approved_commit_revision ->
# publish_m2_m3_handoff; every externally submitted command is replayed.
export EXTERNAL_RUN_REPO_ROOT="${repo_root}"
export EXTERNAL_RUN_CANONICAL_EXECUTOR_PATH="${executor_relative}"
export EXTERNAL_RUN_EXECUTOR_SHA256="${executor_actual_digest}"
export EXTERNAL_RUN_MANIFEST_SHA256="${pinned_manifest_digest}"
./node_modules/.bin/tsx tests/pilot-evidence/run-pilot-executor-cli.ts \
  "${pinned_executor}" "${challenge_nonce}" "${evidence_dir}" "${pinned_manifest}" \
  "${executor_verification_receipt_id}" "${kora_receipt_digest}" "${kora_receipt_id}" \
  "${kora_producer_relative}" "${kora_producer_digest}"
[[ -s ${receipt_artifact} ]] || { print -u2 -r -- 'CYCLE7_MACHINE_RECEIPT_REQUIRED'; exit 68; }

./node_modules/.bin/tsx tests/pilot-evidence/finalize-m2-pilot-evidence-cli.ts \
  "${receipt_artifact}" "${evidence_dir}" "${pending_artifact}" "${kora_five_receipt}" "External real package" "${pinned_manifest}"
print -r -- "KORA_LOCAL_AUTHENTICATED_PASS evidence=${evidence_dir}/PASS.json"
print -r -- "EXTERNAL_REAL_PACKAGE_PASS evidence=${evidence_dir}/PASS.json"
