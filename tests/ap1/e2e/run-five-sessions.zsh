#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

repo_root=${0:a:h:h:h:h}
cd "${repo_root}"

project_id=41111111-1111-4111-8111-111111111111
supabase_project=archidom-ap1-disposable
docker_host=${DOCKER_HOST:-unix://${HOME}/.colima/archidom-ap1/docker.sock}
db_container="supabase_db_${supabase_project}"
next_origin=http://127.0.0.1:3100
session_file=/private/tmp/projectceo-ap1-sessions.json
next_log=/private/tmp/projectceo-ap1-next.log
evidence_dir=/private/tmp/projectceo-ap1-evidence
runtime_root=""

export DOCKER_HOST=${docker_host}
if [[ "${docker_host}" != "unix://${HOME}/.colima/archidom-ap1/docker.sock" ]]; then
  print -u2 -r -- "AP1_DOCKER_HOST_REJECTED"
  exit 65
fi
if [[ -f "${repo_root}/supabase/.temp/project-ref" ]]; then
  print -u2 -r -- "AP1_LINKED_PROJECT_REJECTED"
  exit 65
fi
if [[ ! -r ${AP1_KORA_SITE_PHOTO:-} ]]; then
  print -u2 -r -- "AP1_KORA_SITE_PHOTO_REQUIRED"
  exit 66
fi
mkdir -p "${evidence_dir}"
chmod 700 "${evidence_dir}"

cleanup() {
  if [[ "${AP1_KEEP_EVIDENCE:-0}" == "1" ]]; then
    print -r -- "AP1_KEEP_EVIDENCE_ACTIVE evidence=${evidence_dir} runtime=${runtime_root:-unset} next_pid=${next_pid:-unset}"
    return
  fi
  if [[ -n ${next_pid:-} ]]; then
    kill "${next_pid}" >/dev/null 2>&1 || true
    wait "${next_pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${session_file}" "${next_log}"
  local secret_file
  for secret_file in "${evidence_dir}"/*.cookies(N) "${evidence_dir}"/invite-*.json(N); do
    rm -f "${secret_file}"
  done
  if [[ -n ${runtime_root} && -d ${runtime_root} ]]; then
    rm -rf -- "${runtime_root}"
  fi
}
trap cleanup EXIT INT TERM

api_url=http://127.0.0.1:59621
auth_environment=$(docker inspect --format \
  '{{range .Config.Env}}{{println .}}{{end}}' \
  "supabase_auth_${supabase_project}")
jwt_secret=$(print -r -- "${auth_environment}" \
  | sed -n 's/^GOTRUE_JWT_SECRET=//p')
unset auth_environment
[[ ${#jwt_secret} -ge 32 ]] || {
  print -u2 -r -- "AP1_LOCAL_JWT_SECRET_MISSING"
  exit 67
}
anon_key=$(print -rn -- "${jwt_secret}" \
  | node tests/ap1/environment/sign-local-role-jwt.mjs anon)
service_role_key=$(print -rn -- "${jwt_secret}" \
  | node tests/ap1/environment/sign-local-role-jwt.mjs service_role)
unset jwt_secret
if [[ ${api_url} != http://127.0.0.1:* && ${api_url} != http://localhost:* ]]; then
  print -u2 -r -- "AP1_NON_LOOPBACK_SUPABASE_REJECTED"
  exit 1
fi

run_sql() {
  local file=$1
  docker exec -i "${db_container}" \
    psql -X --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
    < "${file}" > "${evidence_dir}/${file:t}.log"
}

# These accepted SQL scenarios construct the exact source/evidence, baseline,
# release, change-impact, photo, milestone and handover chain. They run only in
# the disposable local database and are followed by real GoTrue user sessions.
run_sql tests/ap1/environment/reset-disposable-data.sql
run_sql tests/db3/20_foundation_operations.sql
run_sql tests/db4/20_product_operations.sql
run_sql tests/db5/20_execution_operations.sql

AP1_API_URL="${api_url}" \
AP1_ANON_KEY="${anon_key}" \
AP1_SERVICE_ROLE_KEY="${service_role_key}" \
AP1_SESSION_FILE="${session_file}" \
AP1_DB_CONTAINER="${db_container}" \
AP1_NEXT_ORIGIN="${next_origin}" \
  ./node_modules/.bin/tsx tests/ap1/e2e/provision-kora.ts

architecture_package=$(jq -er '.architecturePackageId' "${session_file}")
photo_source_id=$(jq -er '.photoSourceId' "${session_file}")
photo_source_revision_id=$(jq -er '.photoSourceRevisionId' "${session_file}")
owner_user_id=$(jq -er '.sessions.owner.userId' "${session_file}")

# A milestone definition is a local scenario precondition because the thin UI
# intentionally does not expose schedule authoring yet. It is created by the
# accepted DB human contract, never by the application service role.
milestone_id=$(docker exec -i "${db_container}" \
  psql -X -qAt --set ON_ERROR_STOP=1 --username postgres --dbname postgres <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '${owner_user_id}';
select response #>> '{result,id}'
from (
  select projectceo_m4_api.define_milestone(
    '${project_id}',
    '${architecture_package}',
    'package-db4-work-v1',
    'Архитектурный выпуск — проверка по фото',
    '["node-area-db4"]'::jsonb,
    (
      select max((project_scope ->> 'stateRevision')::bigint)
      from jsonb_array_elements(
        projectceo_api.list_projects() -> 'data'
      ) project_scope
      where project_scope ->> 'projectId' = '${project_id}'
    ),
    'ap1-define-live-architecture-milestone'
  ) response
) defined;
commit;
SQL
)
milestone_id=$(print -r -- "${milestone_id}" | tail -1 | tr -d '[:space:]')
[[ ${milestone_id} =~ "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" ]] || {
  print -u2 -r -- "AP1_DYNAMIC_MILESTONE_INVALID"
  exit 1
}

# Next normally loads the repository's .env.local automatically. AP1 must not
# expose any production secret to the application process, so run from a small
# disposable source copy that contains no env files and launch under env -i.
runtime_root=$(mktemp -d "${repo_root}/.projectceo-ap1-runtime.XXXXXX")
for runtime_dir in app components fixtures lib public; do
  rsync -a "${repo_root}/${runtime_dir}" "${runtime_root}/"
done
for runtime_file in package.json package-lock.json next-env.d.ts \
  postcss.config.mjs proxy.ts tailwind.config.ts tsconfig.json; do
  rsync -a "${repo_root}/${runtime_file}" "${runtime_root}/${runtime_file}"
done
rsync -a "${repo_root}/tests/ap1/e2e/next.config.mjs" \
  "${runtime_root}/next.config.mjs"
mkdir -p "${runtime_root}/home"
projectceo_token_secret=$(openssl rand -base64 48)

# Build once before serving. Next 16 dev mode can report ready before its route
# tree is complete and is sensitive to host watcher limits; production start is
# deterministic and is the closer browser-adoption boundary.
run_isolated_next() {
  exec env -i \
    HOME="${runtime_root}/home" \
    PATH="${PATH}" \
    TMPDIR="${TMPDIR:-/private/tmp}" \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SUPABASE_URL="${api_url}" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="${anon_key}" \
    NEXT_PUBLIC_APP_URL="${next_origin}" \
    PROJECTCEO_TOKEN_SECRET="${projectceo_token_secret}" \
    NEXT_DIST_DIR=.next-ap1 \
    "$@"
}

if ! (
  cd "${runtime_root}"
  run_isolated_next "${repo_root}/node_modules/.bin/next" build .
) > "${next_log}" 2>&1; then
  tail -80 "${next_log}" >&2
  print -u2 -r -- "AP1_NEXT_BUILD_FAILED"
  exit 1
fi

(
  cd "${runtime_root}"
  run_isolated_next "${repo_root}/node_modules/.bin/next" start . \
    --hostname 127.0.0.1 --port 3100
) >> "${next_log}" 2>&1 &
next_pid=$!

for attempt in {1..120}; do
  if curl -fsS "${next_origin}/api/health" >/dev/null 2>&1; then
    break
  fi
  if (( attempt == 120 )); then
    tail -80 "${next_log}" >&2
    print -u2 -r -- "AP1_NEXT_NOT_READY"
    exit 1
  fi
  sleep 0.5
done

cookie_path() {
  print -r -- "${evidence_dir}/$1.cookies"
}

magic_login() {
  local role=$1
  local token_hash encoded jar
  token_hash=$(jq -er --arg role "${role}" '.sessions[$role].tokenHash' "${session_file}")
  encoded=$(jq -rn --arg value "${token_hash}" '$value|@uri')
  jar=$(cookie_path "${role}")
  : > "${jar}"
  chmod 600 "${jar}"
  curl -fsS -L -c "${jar}" -b "${jar}" \
    "${next_origin}/auth/callback?token_hash=${encoded}&type=magiclink&next=%2Fdashboard%2Fprojectceo" \
    > "${evidence_dir}/${role}-login.html"
}

for role in owner architect builder client guest; do
  magic_login "${role}"
done

# The bearer token is consumed only by the anonymous exact-release route.  The
# temporary response, session file and Next access log are destroyed at exit.
guest_token=$(jq -er '.guestToken' "${session_file}")
guest_release_version=$(jq -er '.guestReleaseVersionId' "${session_file}")
guest_headers="${evidence_dir}/guest-link.headers"
guest_body="${evidence_dir}/guest-link.html"
guest_http=$(curl -sS -D "${guest_headers}" -o "${guest_body}" -w '%{http_code}' \
  "${next_origin}/projectceo/guest/${guest_token}")
[[ ${guest_http} == 200 ]] || {
  print -u2 -r -- "AP1_GUEST_LINK_HTTP status=${guest_http}"
  exit 1
}
rg -qi '^cache-control: private, no-store' "${guest_headers}"
rg -qi '^x-robots-tag: noindex, nofollow' "${guest_headers}"
rg -F -- "${project_id}" "${guest_body}" >/dev/null
rg -F -- "${guest_release_version}" "${guest_body}" >/dev/null
if rg -F -- "${guest_token}" "${guest_body}" "${guest_headers}" >/dev/null; then
  print -u2 -r -- "AP1_GUEST_TOKEN_RESPONSE_LEAK"
  exit 1
fi
if rg -q '/Users/|construction-hall\.jpg|KORA_Website_Code' "${guest_body}"; then
  print -u2 -r -- "AP1_GUEST_PROTECTED_PATH_LEAK"
  exit 1
fi

invalid_guest_token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
invalid_guest_http=$(curl -sS \
  -o "${evidence_dir}/guest-link-invalid.html" -w '%{http_code}' \
  "${next_origin}/projectceo/guest/${invalid_guest_token}")
[[ ${invalid_guest_http} == 404 ]] || {
  print -u2 -r -- "AP1_INVALID_GUEST_LINK_HTTP status=${invalid_guest_http}"
  exit 1
}
if rg -F -- "${invalid_guest_token}" \
    "${evidence_dir}/guest-link-invalid.html" >/dev/null; then
  print -u2 -r -- "AP1_INVALID_GUEST_TOKEN_RESPONSE_LEAK"
  exit 1
fi

post_json() {
  local role=$1
  local endpoint=$2
  local body=$3
  local output=$4
  curl -sS -o "${output}" -w '%{http_code}' \
    -c "$(cookie_path "${role}")" -b "$(cookie_path "${role}")" \
    -H "Origin: ${next_origin}" \
    -H 'Content-Type: application/json' \
    --data "${body}" \
    "${next_origin}${endpoint}"
}

get_json() {
  local role=$1
  local endpoint=$2
  local output=$3
  curl -fsS -c "$(cookie_path "${role}")" -b "$(cookie_path "${role}")" \
    "${next_origin}${endpoint}" > "${output}"
}

assert_exact_replay() {
  local first=$1
  local replay=$2
  jq -e --slurpfile first "${first}" '
    .status == "completed"
    and .replay == true
    and .operation == $first[0].operation
    and .stateRevision == $first[0].stateRevision
    and .result == $first[0].result
  ' "${replay}" >/dev/null
}

expires_at=$(node -e 'process.stdout.write(new Date(Date.now()+86400000).toISOString())')

invite_role() {
  local role=$1
  local target_role=$2
  local email command_id payload response http invitation_url token accept_payload accept_response accept_http
  email=$(jq -er --arg role "${role}" '.sessions[$role].email' "${session_file}")
  command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  payload=$(jq -nc \
    --arg projectId "${project_id}" \
    --arg commandId "${command_id}" \
    --arg email "${email}" \
    --arg role "${target_role}" \
    --arg expiresAt "${expires_at}" \
    '{contractVersion:"projectceo-command/0.1",kind:"create_invitation",projectId:$projectId,commandId:$commandId,payload:{recipientEmail:$email,targetRole:$role,expiresAt:$expiresAt}}')
  response="${evidence_dir}/invite-${role}.json"
  http=$(post_json owner /api/projectceo/commands "${payload}" "${response}")
  [[ ${http} == 200 ]] || { print -u2 -r -- "AP1_INVITE_HTTP role=${role} status=${http}"; exit 1; }
  jq -e '.status == "completed" and (.result.invitationUrl | type == "string")' "${response}" >/dev/null
  invitation_url=$(jq -er '.result.invitationUrl' "${response}")
  token=${invitation_url:t}
  accept_payload=$(jq -nc --arg token "${token}" \
    '{contractVersion:"projectceo-invitation-accept/0.1",token:$token}')
  accept_response="${evidence_dir}/accept-${role}.json"
  accept_http=$(post_json "${role}" /api/projectceo/invitations/accept "${accept_payload}" "${accept_response}")
  [[ ${accept_http} == 200 ]] || { print -u2 -r -- "AP1_ACCEPT_HTTP role=${role} status=${accept_http}"; exit 1; }
  jq -e '.status == "completed"' "${accept_response}" >/dev/null
}

invite_role architect architect
invite_role builder builder
invite_role client client

for role in owner architect builder client guest; do
  get_json "${role}" /api/projectceo/portfolio "${evidence_dir}/${role}-portfolio.json"
done

jq -e '
  .error == null and .data.actor.role == "owner"
  and .data.projects[0].name == "Kora Food Hall"
  and .data.projects[0].areaM2 == 1800
  and .data.projects[0].sourceStats.physicalRecords == 214
  and .data.projects[0].sourceStats.materializedRecords == 85
  and .data.projects[0].sourceStats.placeholders == 129
  and .data.projects[0].sourceStats.uniqueBlobs == 32
  and .data.projects[0].sourceStats.duplicateGroups == 18
  and .data.projects[0].sourceStats.quarantinedGroups == 8
' "${evidence_dir}/owner-portfolio.json" >/dev/null
jq -e '.error == null and .data.actor.role == "architect" and (.data.projects|length) == 1' \
  "${evidence_dir}/architect-portfolio.json" >/dev/null
jq -e '.error == null and .data.actor.role == "builder" and (.data.projects|length) == 1' \
  "${evidence_dir}/builder-portfolio.json" >/dev/null
jq -e '.error == null and .data.actor.role == "client" and (.data.projects|length) == 1' \
  "${evidence_dir}/client-portfolio.json" >/dev/null
jq -e '.error == null and .data.actor.role == "guest" and (.data.projects|length) == 0 and (.data.actor.capabilities|length) == 0' \
  "${evidence_dir}/guest-portfolio.json" >/dev/null

builder_id=$(jq -er '.sessions.builder.userId' "${session_file}")
release_version=$(jq -er '.releaseVersionId' "${session_file}")
distribution_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
distribution_payload=$(jq -nc \
  --arg projectId "${project_id}" \
  --arg commandId "${distribution_command_id}" \
  --arg versionId "${release_version}" \
  --arg recipientUserId "${builder_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"distribute_release",projectId:$projectId,commandId:$commandId,payload:{productionPackageVersionId:$versionId,recipientUserId:$recipientUserId}}')
distribution_http=$(post_json owner /api/projectceo/commands "${distribution_payload}" "${evidence_dir}/distribution.json")
[[ ${distribution_http} == 200 ]] || { print -u2 -r -- "AP1_DISTRIBUTION_HTTP status=${distribution_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/distribution.json" >/dev/null
distribution_id=$(jq -er '.result.distributionId' "${evidence_dir}/distribution.json")
distribution_replay_http=$(post_json owner /api/projectceo/commands "${distribution_payload}" "${evidence_dir}/distribution-replay.json")
[[ ${distribution_replay_http} == 200 ]] || { print -u2 -r -- "AP1_DISTRIBUTION_REPLAY_HTTP status=${distribution_replay_http}"; exit 1; }
assert_exact_replay "${evidence_dir}/distribution.json" "${evidence_dir}/distribution-replay.json"

ack_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
ack_payload=$(jq -nc \
  --arg projectId "${project_id}" \
  --arg commandId "${ack_command_id}" \
  --arg distributionId "${distribution_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"acknowledge_release",projectId:$projectId,commandId:$commandId,payload:{distributionId:$distributionId}}')
ack_http=$(post_json builder /api/projectceo/commands "${ack_payload}" "${evidence_dir}/ack.json")
[[ ${ack_http} == 200 ]] || { print -u2 -r -- "AP1_ACK_HTTP status=${ack_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/ack.json" >/dev/null

# Exact retry must remain idempotent after the first response could have been lost.
ack_replay_http=$(post_json builder /api/projectceo/commands "${ack_payload}" "${evidence_dir}/ack-replay.json")
[[ ${ack_replay_http} == 200 ]] || { print -u2 -r -- "AP1_ACK_REPLAY_HTTP status=${ack_replay_http}"; exit 1; }
assert_exact_replay "${evidence_dir}/ack.json" "${evidence_dir}/ack-replay.json"

# Change request -> worker impact -> human review, all through the authenticated
# request-bound HTTP contract. The exact client retry reuses the same command id.
change_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
change_payload=$(jq -nc \
  --arg projectId "${project_id}" \
  --arg commandId "${change_command_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"create_change",projectId:$projectId,commandId:$commandId,payload:{reason:"Уточнена отделка второго этажа по замечанию стройки",fromProductionPackageVersionId:"package-db4-work-v1",deltaCostRub:125000,deltaDays:2}}')
change_http=$(post_json builder /api/projectceo/commands "${change_payload}" "${evidence_dir}/change.json")
[[ ${change_http} == 200 ]] || { print -u2 -r -- "AP1_CHANGE_HTTP status=${change_http}"; exit 1; }
jq -e '.status == "completed" and .replay == false' "${evidence_dir}/change.json" >/dev/null
change_replay_http=$(post_json builder /api/projectceo/commands "${change_payload}" "${evidence_dir}/change-replay.json")
[[ ${change_replay_http} == 200 ]] || { print -u2 -r -- "AP1_CHANGE_REPLAY_HTTP status=${change_replay_http}"; exit 1; }
assert_exact_replay "${evidence_dir}/change.json" "${evidence_dir}/change-replay.json"
change_request_id=$(jq -er '.result.id' "${evidence_dir}/change.json")
change_state_revision=$(jq -er '.stateRevision' "${evidence_dir}/change.json")

impact_payload=$(jq -nc \
  --arg projectId "${project_id}" \
  --arg changeRequestId "${change_request_id}" \
  --argjson expectedStateRevision "${change_state_revision}" \
  --arg key "ap1:worker:impact:${change_command_id}" \
  '{project_id:$projectId,change_request_id:$changeRequestId,max_depth:3,expected_state_revision:$expectedStateRevision,idempotency_key:$key}')
curl -fsS \
  -H "apikey: ${service_role_key}" \
  -H "Authorization: Bearer ${service_role_key}" \
  -H 'Content-Type: application/json' \
  -H 'Content-Profile: projectceo_m4_api' \
  --data "${impact_payload}" \
  "${api_url}/rest/v1/rpc/calculate_change_impact" \
  > "${evidence_dir}/impact-worker.json"
jq -e '.result.impactCount > 0 and (.result.impacts | length) > 0' "${evidence_dir}/impact-worker.json" >/dev/null
impact_run_id=$(jq -er '.result.id' "${evidence_dir}/impact-worker.json")
impact_index=0
for impact_id in ${(f)"$(jq -er '.result.impacts[].impactId' "${evidence_dir}/impact-worker.json")"}; do
  impact_index=$((impact_index + 1))
  impact_review_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  impact_review_payload=$(jq -nc \
    --arg projectId "${project_id}" \
    --arg commandId "${impact_review_command_id}" \
    --arg impactRunId "${impact_run_id}" \
    --arg impactId "${impact_id}" \
    '{contractVersion:"projectceo-command/0.1",kind:"review_change_impact",projectId:$projectId,commandId:$commandId,payload:{impactRunId:$impactRunId,impactId:$impactId,disposition:"resolved",reason:"Влияние проверено руководителем проекта"}}')
  impact_review_http=$(post_json owner /api/projectceo/commands "${impact_review_payload}" "${evidence_dir}/impact-review-${impact_index}.json")
  [[ ${impact_review_http} == 200 ]] || { print -u2 -r -- "AP1_IMPACT_REVIEW_HTTP index=${impact_index} status=${impact_review_http}"; exit 1; }
  jq -e '.status == "completed"' "${evidence_dir}/impact-review-${impact_index}.json" >/dev/null
  impact_review_replay_http=$(post_json owner /api/projectceo/commands "${impact_review_payload}" "${evidence_dir}/impact-review-${impact_index}-replay.json")
  [[ ${impact_review_replay_http} == 200 ]] || { print -u2 -r -- "AP1_IMPACT_REVIEW_REPLAY_HTTP index=${impact_index} status=${impact_review_replay_http}"; exit 1; }
  assert_exact_replay \
    "${evidence_dir}/impact-review-${impact_index}.json" \
    "${evidence_dir}/impact-review-${impact_index}-replay.json"
done
[[ ${impact_index} -gt 0 ]] || { print -u2 -r -- "AP1_IMPACT_REVIEW_EMPTY"; exit 1; }

# Builder uploads Kora image evidence, owner reviews it and client accepts the
# milestone. These are three different real GoTrue sessions.
photo_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
captured_at=$(node -e 'process.stdout.write(new Date(Date.now()-60000).toISOString())')
photo_payload=$(jq -nc \
  --arg projectId "${project_id}" \
  --arg commandId "${photo_command_id}" \
  --arg milestoneId "${milestone_id}" \
  --arg sourceId "${photo_source_id}" \
  --arg sourceRevisionId "${photo_source_revision_id}" \
  --arg capturedAt "${captured_at}" \
  '{contractVersion:"projectceo-command/0.1",kind:"upload_photo_evidence",projectId:$projectId,commandId:$commandId,payload:{milestoneId:$milestoneId,areaNodeId:"node-area-db4",sourceId:$sourceId,sourceRevisionId:$sourceRevisionId,capturedAt:$capturedAt,note:"Фотофиксация архитектурного выпуска Kora"}}')
photo_http=$(post_json builder /api/projectceo/commands "${photo_payload}" "${evidence_dir}/photo.json")
[[ ${photo_http} == 200 ]] || { print -u2 -r -- "AP1_PHOTO_HTTP status=${photo_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/photo.json" >/dev/null
photo_replay_http=$(post_json builder /api/projectceo/commands "${photo_payload}" "${evidence_dir}/photo-replay.json")
[[ ${photo_replay_http} == 200 ]] || { print -u2 -r -- "AP1_PHOTO_REPLAY_HTTP status=${photo_replay_http}"; exit 1; }
assert_exact_replay "${evidence_dir}/photo.json" "${evidence_dir}/photo-replay.json"
photo_evidence_id=$(jq -er '.result.id' "${evidence_dir}/photo.json")

photo_review_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
photo_review_payload=$(jq -nc \
  --arg projectId "${project_id}" \
  --arg commandId "${photo_review_command_id}" \
  --arg photoEvidenceId "${photo_evidence_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"review_photo_evidence",projectId:$projectId,commandId:$commandId,payload:{photoEvidenceId:$photoEvidenceId,decision:"accepted",reason:"Фото соответствует контрольной точке"}}')
photo_review_http=$(post_json owner /api/projectceo/commands "${photo_review_payload}" "${evidence_dir}/photo-review.json")
[[ ${photo_review_http} == 200 ]] || { print -u2 -r -- "AP1_PHOTO_REVIEW_HTTP status=${photo_review_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/photo-review.json" >/dev/null
photo_review_replay_http=$(post_json owner /api/projectceo/commands "${photo_review_payload}" "${evidence_dir}/photo-review-replay.json")
[[ ${photo_review_replay_http} == 200 ]] || { print -u2 -r -- "AP1_PHOTO_REVIEW_REPLAY_HTTP status=${photo_review_replay_http}"; exit 1; }
assert_exact_replay "${evidence_dir}/photo-review.json" "${evidence_dir}/photo-review-replay.json"

milestone_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
milestone_payload=$(jq -nc \
  --arg projectId "${project_id}" \
  --arg commandId "${milestone_command_id}" \
  --arg milestoneId "${milestone_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"accept_milestone",projectId:$projectId,commandId:$commandId,payload:{milestoneId:$milestoneId}}')
milestone_http=$(post_json client /api/projectceo/commands "${milestone_payload}" "${evidence_dir}/milestone.json")
[[ ${milestone_http} == 200 ]] || { print -u2 -r -- "AP1_MILESTONE_HTTP status=${milestone_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/milestone.json" >/dev/null
milestone_replay_http=$(post_json client /api/projectceo/commands "${milestone_payload}" "${evidence_dir}/milestone-replay.json")
[[ ${milestone_replay_http} == 200 ]] || { print -u2 -r -- "AP1_MILESTONE_REPLAY_HTTP status=${milestone_replay_http}"; exit 1; }
assert_exact_replay "${evidence_dir}/milestone.json" "${evidence_dir}/milestone-replay.json"

# Prove retries did not create duplicate domain rows and every calculated
# impact received exactly one human review.
docker exec -i "${db_container}" \
  psql -X -qAt --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
  > "${evidence_dir}/mutation-cardinality.json" <<SQL
select jsonb_build_object(
  'distributionRows', (select count(*) from projectceo_product.release_distributions where distribution_id = '${distribution_id}'::uuid),
  'acknowledgementRows', (select count(*) from projectceo_product.release_acknowledgements where distribution_id = '${distribution_id}'::uuid),
  'changeRows', (select count(*) from projectceo_m4.change_requests where change_request_id = '${change_request_id}'::uuid),
  'impactRows', (select count(*) from projectceo_m4.impacts where impact_run_id = '${impact_run_id}'::uuid),
  'impactReviewRows', (select count(*) from projectceo_m4.impact_reviews where impact_run_id = '${impact_run_id}'::uuid),
  'photoRows', (select count(*) from projectceo_m4.photo_evidence where photo_evidence_id = '${photo_evidence_id}'::uuid),
  'photoReviewRows', (select count(*) from projectceo_m4.photo_evidence_reviews where photo_evidence_id = '${photo_evidence_id}'::uuid),
  'milestoneAcceptanceRows', (select count(*) from projectceo_m4.milestone_acceptances where milestone_id = '${milestone_id}'::uuid)
);
SQL
jq -e '
  .distributionRows == 1
  and .acknowledgementRows == 1
  and .changeRows == 1
  and .impactRows > 0
  and .impactReviewRows == .impactRows
  and .photoRows == 1
  and .photoReviewRows == 1
  and .milestoneAcceptanceRows == 1
' "${evidence_dir}/mutation-cardinality.json" >/dev/null

for role in owner architect builder client; do
  get_json "${role}" "/api/projectceo/projects/${project_id}" "${evidence_dir}/${role}-workspace.json"
  jq -e --arg role "${role}" '
    .error == null and .data.actor.role == $role
    and .data.project.name == "Kora Food Hall"
    and .data.project.areaM2 == 1800
  ' "${evidence_dir}/${role}-workspace.json" >/dev/null
done
jq -e '[.data.releases[] | select(.distributionStatus == "acknowledged")] | length >= 1' \
  "${evidence_dir}/builder-workspace.json" >/dev/null

# Capability isolation at the real HTTP/RPC boundary.
architect_email=$(jq -er '.sessions.guest.email' "${session_file}")
forbidden_invite=$(jq -nc \
  --arg projectId "${project_id}" \
  --arg commandId "$(uuidgen | tr '[:upper:]' '[:lower:]')" \
  --arg email "${architect_email}" \
  --arg expiresAt "${expires_at}" \
  '{contractVersion:"projectceo-command/0.1",kind:"create_invitation",projectId:$projectId,commandId:$commandId,payload:{recipientEmail:$email,targetRole:"builder",expiresAt:$expiresAt}}')
forbidden_http=$(post_json architect /api/projectceo/commands "${forbidden_invite}" "${evidence_dir}/architect-forbidden.json")
[[ ${forbidden_http} == 403 ]] || { print -u2 -r -- "AP1_ARCHITECT_ACCESS_GUARD status=${forbidden_http}"; exit 1; }
jq -e '.error.code == "forbidden"' "${evidence_dir}/architect-forbidden.json" >/dev/null

client_distribute=$(jq -nc \
  --arg projectId "${project_id}" \
  --arg commandId "$(uuidgen | tr '[:upper:]' '[:lower:]')" \
  --arg versionId "${release_version}" \
  --arg recipientUserId "${builder_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"distribute_release",projectId:$projectId,commandId:$commandId,payload:{productionPackageVersionId:$versionId,recipientUserId:$recipientUserId}}')
client_forbidden_http=$(post_json client /api/projectceo/commands "${client_distribute}" "${evidence_dir}/client-forbidden.json")
[[ ${client_forbidden_http} == 403 ]] || { print -u2 -r -- "AP1_CLIENT_ACCESS_GUARD status=${client_forbidden_http}"; exit 1; }
jq -e '.error.code == "forbidden"' "${evidence_dir}/client-forbidden.json" >/dev/null

guest_workspace_status=$(curl -sS -o "${evidence_dir}/guest-workspace.json" -w '%{http_code}' \
  -c "$(cookie_path guest)" -b "$(cookie_path guest)" \
  "${next_origin}/api/projectceo/projects/${project_id}")
[[ ${guest_workspace_status} == 404 || ${guest_workspace_status} == 403 ]] || {
  print -u2 -r -- "AP1_GUEST_PROJECT_ISOLATION status=${guest_workspace_status}"
  exit 1
}

cross_origin_status=$(curl -sS -o "${evidence_dir}/cross-origin.json" -w '%{http_code}' \
  -c "$(cookie_path owner)" -b "$(cookie_path owner)" \
  -H 'Origin: https://evil.invalid' -H 'Content-Type: application/json' \
  --data "${distribution_payload}" "${next_origin}/api/projectceo/commands")
[[ ${cross_origin_status} == 403 ]] || { print -u2 -r -- "AP1_CSRF_GUARD status=${cross_origin_status}"; exit 1; }

for role in owner architect builder client; do
  curl -fsS -c "$(cookie_path "${role}")" -b "$(cookie_path "${role}")" \
    "${next_origin}/dashboard/projectceo/projects/${project_id}" \
    > "${evidence_dir}/${role}-workspace.html"
  rg -q 'Kora Food Hall' "${evidence_dir}/${role}-workspace.html"
  rg -q '1.?800' "${evidence_dir}/${role}-workspace.html"
done

if [[ ${AP1_BROWSER_QA:-0} == 1 ]]; then
  node tests/ap1/e2e/capture-browser-evidence.mjs \
    "${next_origin}" "${project_id}" "${evidence_dir}"
fi

jq -n '{
  contractVersion:"archidom-ap1-five-session-evidence/0.1",
  productionChanged:false,
  users:5,
  auth:"magiclink",
  project:{name:"Kora Food Hall",areaM2:1800,registrySources:209,foundationFixtureSources:4,sitePhotos:1,physicalSources:214,materializedSources:85,placeholders:129,uniqueBlobs:32,duplicateGroups:18,quarantinedGroups:8},
  gates:{invitationAccept:true,distributionAcknowledgement:true,changeImpactReview:true,photoEvidenceReview:true,milestoneAcceptance:true,exactRetry:true,csrf:true,tenantIsolation:true,guestExactTokenScope:true}
}' > "${evidence_dir}/summary.json"

print -r -- "AP1_SUPPORTED_SLICE_E2E_OK users=5 auth=magiclink kora_registry=209 foundation_fixtures=4 site_photos=1 area_m2=1800 invite_accept=true distribution_ack=true change_impact=true photo_review=true milestone_accept=true replay=true csrf=true isolation=true seeded_preconditions=true production_changed=false"
