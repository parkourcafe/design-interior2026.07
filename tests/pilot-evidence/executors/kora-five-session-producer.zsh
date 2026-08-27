#!/bin/zsh
set -euo pipefail

# Repository-owned Kora five-session producer for the Cycle 7 evidence run.
#
# It runs the real AP1 five-session flow against the disposable local stack,
# harvests the identifiers that run actually created, and hands them to the
# unit-tested receipt builder. It never invents a user, session or request
# identifier, and it writes no receipt for a run that did not succeed.
#
# Argument contract, called by tests/pilot-evidence/run-m2-pilot-evidence.zsh:
#   $1 challenge nonce minted by the runner
#   $2 absolute path the protected receipt must be written to

repo_root=${0:a:h:h:h:h}
cd "${repo_root}"

challenge_nonce=${1:-}
receipt_path=${2:-}
if [[ -z ${challenge_nonce} || -z ${receipt_path} ]]; then
  print -u2 -r -- 'KORA_PRODUCER_ARGUMENTS_REQUIRED'
  exit 64
fi
if [[ -e ${receipt_path} ]]; then
  print -u2 -r -- 'KORA_PRODUCER_RECEIPT_PATH_EXISTS'
  exit 65
fi

producer_absolute=${0:a}
producer_relative=${producer_absolute#${repo_root}/}
producer_digest=$(shasum -a 256 "${producer_absolute}" | awk '{print "sha256:"$1}')

supabase_project=archidom-ap1-disposable
db_container="supabase_db_${supabase_project}"
next_origin=http://127.0.0.1:3100
session_file=/private/tmp/projectceo-ap1-sessions.json
# Next's own log records the magic-link callback URLs, so it carries token
# hashes. AP1 destroys it on its normal path but keeps it under KEEP_EVIDENCE.
next_log=/private/tmp/projectceo-ap1-next.log
export DOCKER_HOST=${DOCKER_HOST:-unix://${HOME}/.colima/archidom-ap1/docker.sock}

work_dir=$(mktemp -d)
chmod 700 "${work_dir}"
umask 077
run_log="${work_dir}/ap1-run.log"
evidence_dir=""
runtime_root=""
next_pid=""
preserve_evidence=${KORA_KEEP_EVIDENCE:-0}

# AP1_KEEP_EVIDENCE suppresses AP1's own teardown so the session file and cookie
# jars survive the harvest window. Everything it skipped is torn down here.
cleanup() {
  # `status` is a read-only special parameter in zsh: declaring it local aborts
  # this function on its first line and silently skips the teardown below.
  local exit_status=$?
  if (( preserve_evidence == 1 )) && (( exit_status == 0 )); then
    print -r -- "KORA_PRESERVED_EVIDENCE_WINDOW evidence=${evidence_dir} runtime=${runtime_root:-unset} next_pid=${next_pid:-unset}"
    return 0
  fi
  if [[ -n ${next_pid} ]]; then
    kill "${next_pid}" >/dev/null 2>&1 || true
    wait "${next_pid}" >/dev/null 2>&1 || true
  fi
  if [[ -n ${runtime_root} && -d ${runtime_root} ]]; then
    rm -rf -- "${runtime_root}"
  fi
  if [[ -n ${evidence_dir} && -d ${evidence_dir} ]]; then
    rm -f -- "${evidence_dir}"/*.cookies(N) "${evidence_dir}"/invite-*.json(N)
  fi
  rm -f -- "${session_file}" "${next_log}"
  rm -rf -- "${work_dir}"
  if (( exit_status != 0 )); then rm -f -- "${receipt_path}"; fi
  return ${exit_status}
}
trap cleanup EXIT INT TERM

AP1_KEEP_EVIDENCE=1 zsh tests/ap1/e2e/run-five-sessions.zsh 2>&1 | tee "${run_log}"

run_marker=$(sed -n 's/^\(AP1_SUPPORTED_SLICE_E2E_OK .*\)$/\1/p' "${run_log}" | tail -1)
keep_line=$(sed -n 's/^\(AP1_KEEP_EVIDENCE_ACTIVE .*\)$/\1/p' "${run_log}" | tail -1)
if [[ -z ${run_marker} || -z ${keep_line} ]]; then
  print -u2 -r -- 'KORA_PRODUCER_RUN_NOT_VERIFIED'
  exit 66
fi
evidence_dir=$(print -r -- "${keep_line}" | sed -n 's/.*evidence=\([^ ]*\).*/\1/p')
runtime_root=$(print -r -- "${keep_line}" | sed -n 's/.*runtime=\([^ ]*\).*/\1/p')
next_pid=$(print -r -- "${keep_line}" | sed -n 's/.*next_pid=\([^ ]*\).*/\1/p')
if [[ ${runtime_root} == unset ]]; then runtime_root=""; fi
if [[ ${next_pid} == unset ]]; then next_pid=""; fi
if [[ -z ${evidence_dir} || ! -d ${evidence_dir} || ! -r ${session_file} ]]; then
  print -u2 -r -- 'KORA_PRODUCER_EVIDENCE_WINDOW_MISSING'
  exit 66
fi

# Harvest one real binding per AP1 login: the provisioned user, the GoTrue
# session row that login created, and the request id the application minted for
# a live authenticated read by that same cookie jar.
harvest_file="${work_dir}/harvest.json"
harvest_sessions="${work_dir}/sessions.json"
print -r -- '{}' > "${harvest_sessions}"
for ap1_role in owner architect client builder guest; do
  user_id=$(jq -er --arg role "${ap1_role}" '.sessions[$role].userId' "${session_file}")
  session_id=$(docker exec -i "${db_container}" \
    psql -X -qAt --set ON_ERROR_STOP=1 --username postgres --dbname postgres <<SQL
select id from auth.sessions where user_id = '${user_id}'::uuid order by created_at desc limit 1;
SQL
  )
  session_id=$(print -r -- "${session_id}" | tail -1 | tr -d '[:space:]')
  cookie_jar="${evidence_dir}/${ap1_role}.cookies"
  if [[ ! -r ${cookie_jar} ]]; then
    print -u2 -r -- "KORA_PRODUCER_COOKIE_JAR_MISSING role=${ap1_role}"
    exit 66
  fi
  request_id=$(curl -fsS -c "${cookie_jar}" -b "${cookie_jar}" \
    "${next_origin}/api/projectceo/portfolio" | jq -er '.requestId')
  jq --arg role "${ap1_role}" --arg userId "${user_id}" --arg sessionId "${session_id}" \
    --arg requestId "${request_id}" \
    '.[$role] = {userId: $userId, sessionId: $sessionId, requestId: $requestId}' \
    "${harvest_sessions}" > "${harvest_sessions}.next"
  mv -- "${harvest_sessions}.next" "${harvest_sessions}"
done
jq -n --arg runMarker "${run_marker}" --slurpfile sessions "${harvest_sessions}" \
  '{runMarker: $runMarker, sessions: $sessions[0]}' > "${harvest_file}"

# The builder revalidates every identifier, enforces the five distinct bindings
# and writes the receipt 0600 with O_EXCL. It is the only writer of this file.
./node_modules/.bin/tsx tests/pilot-evidence/kora-five-session-receipt-cli.ts \
  "${receipt_path}" "${challenge_nonce}" "${producer_relative}" "${producer_digest}" "${harvest_file}"

if [[ ! -s ${receipt_path} ]]; then
  print -u2 -r -- 'KORA_PRODUCER_RECEIPT_NOT_WRITTEN'
  exit 67
fi
print -r -- "KORA_FIVE_SESSION_RECEIPT_WRITTEN producer=${producer_relative}"
