#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

repo_root=${0:a:h:h:h:h}
cd "${repo_root}"

project_id=41111111-1111-4111-8111-111111111111
supabase_project=archidom-ap1-disposable
docker_host=${DOCKER_HOST:-unix://${HOME}/.colima/archidom-ap1-disposable/docker.sock}
db_container="supabase_db_${supabase_project}"
db_psql_user=${AP1_DB_PSQL_USER:-supabase_admin}
next_port=${AP1_NEXT_PORT:-3100}
[[ ${next_port} =~ '^[0-9]+$' ]] || {
  print -u2 -r -- "AP1_NEXT_PORT_INVALID"
  exit 65
}
next_origin="http://127.0.0.1:${next_port}"
session_file=/private/tmp/projectceo-ap1-sessions.json
next_log=/private/tmp/projectceo-ap1-next.log
evidence_dir=/private/tmp/projectceo-ap1-evidence
runtime_root=""
run_completed=0

export DOCKER_HOST=${docker_host}
if [[ "${docker_host}" != "unix://${HOME}/.colima/archidom-ap1-disposable/docker.sock" \
  && ! ( "${GITHUB_ACTIONS:-false}" == "true" && "${docker_host}" == "unix:///var/run/docker.sock" ) ]]; then
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
  if [[ "${AP1_KEEP_EVIDENCE:-0}" == "1" && ${run_completed} -eq 1 ]]; then
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
    psql -X --set ON_ERROR_STOP=1 --username "${db_psql_user}" --dbname postgres \
    < "${file}" > "${evidence_dir}/${file:t}.log"
}

# These accepted SQL scenarios construct the exact source/evidence, baseline,
# release, change-impact, photo, milestone and handover chain. They run only in
# the disposable local database and are followed by real GoTrue user sessions.
# DEC-040 (4): baseline M3 требует опубликованную передачу M2→M3 по каждому
# пакету. Путь M2 (планировки → ревью клиента → approved commit → передача)
# доказывают DB4 33 и внешний раннер AP6; здесь — фикстура одноразовой базы с
# design intent, который войдёт в baseline.
seed_m3_handoffs() {
  local design_intent=$1
  [[ ${design_intent} =~ '^[A-Za-z0-9._:@-]{1,160}$' ]] || { print -u2 -r -- "AP1_HANDOFF_SEED_INVALID"; exit 1; }
  { cat tests/fixtures/sql/m3_handoff_fixture.sql
    print -r -- "select pi_test_fixture.seed_handoff(package.project_id, package.id, 'ap1-handoff-' || package.stable_key, '${design_intent}', array['ap1-handoff-selection'], (select designer_id from public.projects where id = package.project_id)) from projectceo_foundation.project_packages package where package.project_id = '${project_id}'::uuid and package.status = 'active';"
  } | docker exec -i "${db_container}" \
    psql -X --set ON_ERROR_STOP=1 --username "${db_psql_user}" --dbname postgres \
    > "${evidence_dir}/m3-handoff-seed-${design_intent}.log"
}

run_sql tests/ap1/environment/reset-disposable-data.sql
run_sql tests/ap1/environment/cleanup-repeatable-run.sql
run_sql tests/ap1/environment/enable-m3-publication.sql
run_sql tests/ap1/environment/enable-m4-increment-1.sql
run_sql tests/ap1/environment/enable-m4-v1-impact.sql
run_sql tests/ap1/environment/enable-m4-v2-v3.sql

AP1_API_URL="${api_url}" \
AP1_ANON_KEY="${anon_key}" \
AP1_SERVICE_ROLE_KEY="${service_role_key}" \
AP1_SESSION_FILE="${session_file}" \
AP1_DB_CONTAINER="${db_container}" \
AP1_NEXT_ORIGIN="${next_origin}" \
  ./node_modules/.bin/tsx tests/ap1/e2e/provision-kora.ts

photo_source_id=$(jq -er '.photoSourceId' "${session_file}")
photo_source_revision_id=$(jq -er '.photoSourceRevisionId' "${session_file}")

# Next normally loads the repository's .env.local automatically. AP1 must not
# expose any production secret to the application process, so run from a small
# disposable source copy that contains no env files and launch under env -i.
runtime_root=$(mktemp -d "${repo_root}/.projectceo-ap1-runtime.XXXXXX")
for runtime_dir in app components fixtures lib public; do
  rsync -a "${repo_root}/${runtime_dir}" "${runtime_root}/"
done
for runtime_file in package.json package-lock.json \
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
    REMHAOS_EXECUTION_ENABLED=true \
    REMHAOS_M4_V2_V3_ENABLED=true \
    REMHAOS_DOCUMENTATION_ENABLED=true \
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
    --hostname 127.0.0.1 --port "${next_port}"
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
  local http_status
  http_status=$(curl -sS -L -c "${jar}" -b "${jar}" -w '%{http_code}' \
    -o "${evidence_dir}/${role}-login.html" \
    "${next_origin}/auth/callback?token_hash=${encoded}&type=magiclink&next=%2Fdashboard%2Fprojectceo")
  if [[ ${http_status} != 2* ]]; then
    print -u2 -r -- "AP1_LOGIN_FAILURE role=${role} status=${http_status}"
    return 1
  fi
}

for role in owner architect builder client guest; do
  magic_login "${role}"
done


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

package_invite_token=$(jq -er '.packageInviteToken' "${session_file}")
package_accept_payload=$(jq -nc --arg token "${package_invite_token}" '{contractVersion:"projectceo-invitation-accept/0.1",token:$token}')
package_accept_http=$(post_json owner /api/projectceo/invitations/accept "${package_accept_payload}" "${evidence_dir}/package-scope-accept.json")
[[ ${package_accept_http} == 200 ]] || { print -u2 -r -- "AP1_PACKAGE_SCOPE_ACCEPT_HTTP status=${package_accept_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/package-scope-accept.json" >/dev/null
jq 'del(.packageInviteToken)' "${session_file}" > "${session_file}.next" && mv -- "${session_file}.next" "${session_file}"
chmod 600 "${session_file}"

get_json() {
  local role=$1
  local endpoint=$2
  local output=$3
  local http_status
  http_status=$(curl -sS -c "$(cookie_path "${role}")" -b "$(cookie_path "${role}")" \
    -w '%{http_code}' -o "${output}" "${next_origin}${endpoint}")
  if [[ ${http_status} != 2* ]]; then
    local error_code
    error_code=$(jq -r '.error.code // "unknown"' "${output}" 2>/dev/null || print -r -- unknown)
    print -u2 -r -- "AP1_HTTP_FAILURE role=${role} endpoint=${endpoint} status=${http_status} code=${error_code}"
    return 1
  fi
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
  and .data.projects[0].sourceStats.physicalRecords == 210
  and .data.projects[0].sourceStats.materializedRecords == 82
  and .data.projects[0].sourceStats.placeholders == 128
  and .data.projects[0].sourceStats.uniqueBlobs == 29
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

# Authenticated M2 -> M3 chain. Every business mutation goes through the
# request-bound command contract; only the executor's disposable identity
# bootstrap is SQL-backed. The preview tokens are read from the authenticated
# workspace immediately before confirmation and are never fabricated.
decision_node_id=kora-decision-layout
decision_revision_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
approval_package_id=kora-approval-m2
decision_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
decision_payload=$(jq -nc \
  --arg projectId "${project_id}" --arg commandId "${decision_command_id}" \
  --arg packageId "${project_id}" --arg nodeId "${decision_node_id}" \
  --arg revisionId "${decision_revision_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"create_decision",projectId:$projectId,commandId:$commandId,payload:{packageId:$packageId,nodeId:$nodeId,revisionId:$revisionId,expectedRevisionId:null,claimStatus:"human_origin",title:"Планировка общественной зоны Kora",resolution:"Сохраняем открытую общественную зону и фиксируем текущую строительную реализацию как исходное решение.",areaNodeId:null,decisionStatus:"confirmed",evidence:[],reason:"Решение подтверждено на строительном обходе Kora."}}')
decision_http=$(post_json architect /api/projectceo/commands "${decision_payload}" "${evidence_dir}/decision.json")
[[ ${decision_http} == 200 ]] || { print -u2 -r -- "AP1_DECISION_HTTP status=${decision_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/decision.json" >/dev/null
photo_checksum=$(jq -er '.photoChecksum' "${session_file}")
impact_dependency_ingestion=$(./node_modules/.bin/tsx tests/ap1/e2e/ingest-impact-dependency.ts \
  "${api_url}" "${anon_key}" "$(cookie_path architect)" "${project_id}" "${project_id}" \
  "${decision_node_id}" "${photo_checksum}" | tail -1)
[[ ${impact_dependency_ingestion} =~ "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" ]] || {
  print -u2 -r -- "AP1_IMPACT_DEPENDENCY_INGEST_INVALID"; exit 1
}

approval_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
approval_payload=$(jq -nc \
  --arg projectId "${project_id}" --arg commandId "${approval_command_id}" \
  --arg packageId "${project_id}" --arg approvalId "${approval_package_id}" \
  --arg nodeId "${decision_node_id}" --arg revisionId "${decision_revision_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"create_approval_package",projectId:$projectId,commandId:$commandId,payload:{packageId:$packageId,approvalPackageId:$approvalId,items:[{targetKind:"decision_revision",entityId:$nodeId,revisionId:$revisionId}]}}')
approval_http=$(post_json owner /api/projectceo/commands "${approval_payload}" "${evidence_dir}/approval-create.json")
[[ ${approval_http} == 200 ]] || { print -u2 -r -- "AP1_APPROVAL_CREATE_HTTP status=${approval_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/approval-create.json" >/dev/null

submit_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
submit_payload=$(jq -nc --arg projectId "${project_id}" --arg commandId "${submit_command_id}" --arg approvalId "${approval_package_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"submit_approval_package",projectId:$projectId,commandId:$commandId,payload:{approvalPackageId:$approvalId,expectedStatus:"draft"}}')
submit_http=$(post_json owner /api/projectceo/commands "${submit_payload}" "${evidence_dir}/approval-submit.json")
[[ ${submit_http} == 200 ]] || { print -u2 -r -- "AP1_APPROVAL_SUBMIT_HTTP status=${submit_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/approval-submit.json" >/dev/null

review_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
review_payload=$(jq -nc --arg projectId "${project_id}" --arg commandId "${review_command_id}" --arg approvalId "${approval_package_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"review_selection",projectId:$projectId,commandId:$commandId,payload:{approvalPackageId:$approvalId,expectedStatus:"submitted",decision:"approved",reason:"Клиент подтвердил решение и состав approval package."}}')
review_http=$(post_json client /api/projectceo/commands "${review_payload}" "${evidence_dir}/approval-review.json")
[[ ${review_http} == 200 ]] || { print -u2 -r -- "AP1_APPROVAL_REVIEW_HTTP status=${review_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/approval-review.json" >/dev/null

seed_m3_handoffs "${decision_revision_id}"
get_json architect "/api/projectceo/projects/${project_id}" "${evidence_dir}/architect-workspace-m2.json"
baseline_token=$(jq -er '.data.operations.publish_baseline.commandTargetId' "${evidence_dir}/architect-workspace-m2.json")
baseline_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
baseline_payload=$(jq -nc --arg projectId "${project_id}" --arg commandId "${baseline_command_id}" --arg token "${baseline_token}" \
  '{contractVersion:"projectceo-command/0.1",kind:"publish_baseline",projectId:$projectId,commandId:$commandId,payload:{snapshotToken:$token}}')
baseline_http=$(post_json architect /api/projectceo/commands "${baseline_payload}" "${evidence_dir}/baseline.json")
[[ ${baseline_http} == 200 ]] || { print -u2 -r -- "AP1_BASELINE_HTTP status=${baseline_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/baseline.json" >/dev/null

get_json architect "/api/projectceo/projects/${project_id}" "${evidence_dir}/architect-workspace-baseline.json"
release_token=$(jq -er '.data.operations.publish_release.commandTargetId' "${evidence_dir}/architect-workspace-baseline.json")
release_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
release_payload=$(jq -nc --arg projectId "${project_id}" --arg commandId "${release_command_id}" --arg token "${release_token}" \
  '{contractVersion:"projectceo-command/0.1",kind:"publish_release",projectId:$projectId,commandId:$commandId,payload:{snapshotToken:$token}}')
release_http=$(post_json architect /api/projectceo/commands "${release_payload}" "${evidence_dir}/release.json")
[[ ${release_http} == 200 ]] || { print -u2 -r -- "AP1_RELEASE_HTTP status=${release_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/release.json" >/dev/null
release_version=$(jq -er '.result.productionPackageVersionId // .result.versionId // .result.id' "${evidence_dir}/release.json")
get_json architect "/api/projectceo/projects/${project_id}" "${evidence_dir}/architect-workspace-release.json"

# Release artifact materialization is deliberately a system worker door. The
# human release command never impersonates this worker; distribution is only
# offered after the worker has consumed the server-derived backlog.
artifact_worker_report=$(NEXT_PUBLIC_SUPABASE_URL="${api_url}" \
  SUPABASE_SERVICE_ROLE_KEY="${service_role_key}" \
  npm run --silent worker:release-artifacts)
print -r -- "${artifact_worker_report}" | tail -1 > "${evidence_dir}/release-artifact-worker.json"
jq -e '.scanned >= 1 and (.created + .alreadyPresent) >= 1' \
  "${evidence_dir}/release-artifact-worker.json" >/dev/null

area_node_id=$(jq -er '.areaNodeId' "${session_file}")
milestone_id=$(./node_modules/.bin/tsx tests/ap1/e2e/define-milestone-rpc.ts \
  "${api_url}" "${anon_key}" "$(cookie_path owner)" "${project_id}" "${project_id}" \
  "${release_version}" "${area_node_id}" | tail -1)
[[ ${milestone_id} =~ "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" ]] || {
  print -u2 -r -- "AP1_DYNAMIC_MILESTONE_INVALID"
  exit 1
}
final_guest_binding=$(./node_modules/.bin/tsx tests/ap1/e2e/create-guest-grant-rpc.ts \
  "${api_url}" "${anon_key}" "$(cookie_path owner)" "${project_id}" "${project_id}" \
  "${release_version}")
final_guest_token=$(print -r -- "${final_guest_binding}" | jq -er '.token')
[[ ${#final_guest_token} -ge 40 ]] || { print -u2 -r -- "AP1_FINAL_GUEST_TOKEN_INVALID"; exit 1; }
guest_release_version=$(print -r -- "${final_guest_binding}" | jq -er '.graphVersionId')
jq --arg token "${final_guest_token}" --arg version "${guest_release_version}" \
  '.guestToken=$token | .guestReleaseVersionId=$version' "${session_file}" > "${session_file}.next" \
  && mv -- "${session_file}.next" "${session_file}"
chmod 600 "${session_file}"

# Verify the final-release guest token only after the authenticated release and
# post-milestone state are materialized.
guest_token="${final_guest_token}"
guest_headers="${evidence_dir}/guest-link.headers"
guest_body="${evidence_dir}/guest-link.html"
guest_http=$(curl -sS -D "${guest_headers}" -o "${guest_body}" -w '%{http_code}' \
  "${next_origin}/projectceo/guest/${guest_token}")
[[ ${guest_http} == 200 ]] || { print -u2 -r -- "AP1_GUEST_LINK_HTTP status=${guest_http}"; exit 1; }
rg -qi '^cache-control: private, no-store' "${guest_headers}"
rg -qi '^x-robots-tag: noindex, nofollow' "${guest_headers}"
rg -F -- "${project_id}" "${guest_body}" >/dev/null
rg -F -- "${guest_release_version}" "${guest_body}" >/dev/null
if rg -F -- "${guest_token}" "${guest_body}" "${guest_headers}" >/dev/null; then
  print -u2 -r -- "AP1_GUEST_TOKEN_RESPONSE_LEAK"; exit 1
fi
invalid_guest_token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
invalid_guest_http=$(curl -sS -o "${evidence_dir}/guest-link-invalid.html" -w '%{http_code}' \
  "${next_origin}/projectceo/guest/${invalid_guest_token}")
[[ ${invalid_guest_http} == 404 ]] || { print -u2 -r -- "AP1_INVALID_GUEST_LINK_HTTP status=${invalid_guest_http}"; exit 1; }

builder_id=$(jq -er '.sessions.builder.userId' "${session_file}")
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

# A change must point from the released B1 to a separately approved proposed
# baseline. Create B2 through the same authenticated decision/approval door;
# the builder never manufactures a target baseline.
change_decision_node_id=${decision_node_id}
change_decision_revision_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
change_approval_package_id=kora-approval-site-adjustment
change_decision_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
change_decision_payload=$(jq -nc \
  --arg projectId "${project_id}" --arg commandId "${change_decision_command_id}" \
  --arg packageId "${project_id}" --arg nodeId "${change_decision_node_id}" --arg revisionId "${change_decision_revision_id}" \
  --arg expectedRevisionId "${decision_revision_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"create_decision",projectId:$projectId,commandId:$commandId,payload:{packageId:$packageId,nodeId:$nodeId,revisionId:$revisionId,expectedRevisionId:$expectedRevisionId,claimStatus:"human_origin",title:"Уточнение отделки по фотофиксации",resolution:"Зафиксировать изменение отделки второго этажа для последующей оценки влияния.",areaNodeId:null,decisionStatus:"confirmed",evidence:[],reason:"Решение зафиксировано после осмотра строительной площадки."}}')
change_decision_http=$(post_json architect /api/projectceo/commands "${change_decision_payload}" "${evidence_dir}/change-decision.json")
[[ ${change_decision_http} == 200 ]] || { print -u2 -r -- "AP1_CHANGE_DECISION_HTTP status=${change_decision_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/change-decision.json" >/dev/null

# Baseline composition resolves a re-approved node by the approval package's
# server creation time. Let the local VM clock advance past B1 before minting
# B2; the later assertion keeps a non-monotonic local clock from producing a
# false clean evidence run.
sleep 2
change_approval_create_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
change_approval_create_payload=$(jq -nc \
  --arg projectId "${project_id}" --arg commandId "${change_approval_create_id}" --arg packageId "${project_id}" \
  --arg approvalId "${change_approval_package_id}" --arg nodeId "${change_decision_node_id}" --arg revisionId "${change_decision_revision_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"create_approval_package",projectId:$projectId,commandId:$commandId,payload:{packageId:$packageId,approvalPackageId:$approvalId,items:[{targetKind:"decision_revision",entityId:$nodeId,revisionId:$revisionId}]}}')
change_approval_create_http=$(post_json owner /api/projectceo/commands "${change_approval_create_payload}" "${evidence_dir}/change-approval-create.json")
[[ ${change_approval_create_http} == 200 ]] || { print -u2 -r -- "AP1_CHANGE_APPROVAL_CREATE_HTTP status=${change_approval_create_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/change-approval-create.json" >/dev/null

change_approval_submit_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
change_approval_submit_payload=$(jq -nc --arg projectId "${project_id}" --arg commandId "${change_approval_submit_id}" --arg approvalId "${change_approval_package_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"submit_approval_package",projectId:$projectId,commandId:$commandId,payload:{approvalPackageId:$approvalId,expectedStatus:"draft"}}')
change_approval_submit_http=$(post_json owner /api/projectceo/commands "${change_approval_submit_payload}" "${evidence_dir}/change-approval-submit.json")
[[ ${change_approval_submit_http} == 200 ]] || { print -u2 -r -- "AP1_CHANGE_APPROVAL_SUBMIT_HTTP status=${change_approval_submit_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/change-approval-submit.json" >/dev/null

change_approval_review_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
change_approval_review_payload=$(jq -nc --arg projectId "${project_id}" --arg commandId "${change_approval_review_id}" --arg approvalId "${change_approval_package_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"review_selection",projectId:$projectId,commandId:$commandId,payload:{approvalPackageId:$approvalId,expectedStatus:"submitted",decision:"approved",reason:"Клиент подтвердил уточнение после получения выпуска."}}')
change_approval_review_http=$(post_json client /api/projectceo/commands "${change_approval_review_payload}" "${evidence_dir}/change-approval-review.json")
[[ ${change_approval_review_http} == 200 ]] || { print -u2 -r -- "AP1_CHANGE_APPROVAL_REVIEW_HTTP status=${change_approval_review_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/change-approval-review.json" >/dev/null

seed_m3_handoffs "${change_decision_revision_id}"
get_json architect "/api/projectceo/projects/${project_id}" "${evidence_dir}/architect-workspace-change-baseline.json"
change_baseline_token=$(jq -er '.data.operations.publish_baseline.commandTargetId' "${evidence_dir}/architect-workspace-change-baseline.json")
change_baseline_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
change_baseline_payload=$(jq -nc --arg projectId "${project_id}" --arg commandId "${change_baseline_command_id}" --arg token "${change_baseline_token}" \
  '{contractVersion:"projectceo-command/0.1",kind:"publish_baseline",projectId:$projectId,commandId:$commandId,payload:{snapshotToken:$token}}')
change_baseline_http=$(post_json architect /api/projectceo/commands "${change_baseline_payload}" "${evidence_dir}/change-baseline.json")
[[ ${change_baseline_http} == 200 ]] || { print -u2 -r -- "AP1_CHANGE_BASELINE_HTTP status=${change_baseline_http}"; exit 1; }
jq -e '.status == "completed"' "${evidence_dir}/change-baseline.json" >/dev/null

# Change request -> worker impact -> human review, all through the authenticated
# request-bound HTTP contract. The exact client retry reuses the same command id.
change_command_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
change_payload=$(jq -nc \
  --arg projectId "${project_id}" \
  --arg commandId "${change_command_id}" \
  --arg versionId "${release_version}" \
  '{contractVersion:"projectceo-command/0.1",kind:"create_change",projectId:$projectId,commandId:$commandId,payload:{reason:"Уточнена отделка второго этажа по замечанию стройки",fromProductionPackageVersionId:$versionId,deltaCostRub:125000,deltaDays:2}}')
change_http=$(post_json builder /api/projectceo/commands "${change_payload}" "${evidence_dir}/change.json")
[[ ${change_http} == 200 ]] || {
  print -u2 -r -- "AP1_CHANGE_HTTP status=${change_http}"; exit 1;
}
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
  '{project_id:$projectId,change_request_id:$changeRequestId,expected_state_revision:$expectedStateRevision,idempotency_key:$key}')
curl -fsS \
  -H "apikey: ${service_role_key}" \
  -H "Authorization: Bearer ${service_role_key}" \
  -H 'Content-Type: application/json' \
  -H 'Content-Profile: projectceo_m4_api' \
  --data "${impact_payload}" \
  "${api_url}/rest/v1/rpc/calculate_change_impact_policy_bound" \
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
  --arg areaNodeId "${area_node_id}" \
  '{contractVersion:"projectceo-command/0.1",kind:"upload_photo_evidence",projectId:$projectId,commandId:$commandId,payload:{milestoneId:$milestoneId,areaNodeId:$areaNodeId,sourceId:$sourceId,sourceRevisionId:$sourceRevisionId,capturedAt:$capturedAt,note:"Фотофиксация архитектурного выпуска Kora"}}')
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
  psql -X -qAt --set ON_ERROR_STOP=1 --username "${db_psql_user}" --dbname postgres \
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
  http_status=$(curl -sS -c "$(cookie_path "${role}")" -b "$(cookie_path "${role}")" \
    -w '%{http_code}' -o "${evidence_dir}/${role}-workspace.html" \
    "${next_origin}/dashboard/projectceo/projects/${project_id}")
  if [[ ${http_status} != 2* ]]; then
    print -u2 -r -- "AP1_BROWSER_HTTP_FAILURE role=${role} status=${http_status}"
    exit 1
  fi
  rg -q 'Kora Food Hall' "${evidence_dir}/${role}-workspace.html"
  rg -q '1.?800' "${evidence_dir}/${role}-workspace.html"
done

if [[ ${AP1_BROWSER_QA:-0} == 1 ]]; then
  node tests/ap1/e2e/capture-browser-evidence.mjs \
    "${next_origin}" "${project_id}" "${evidence_dir}"
fi

# Harvest the five Kora bindings before adding the second disposable project:
# the portfolio endpoint intentionally rejects a multi-project owner scope.
kora_harvest_file="${evidence_dir}/kora-session-harvest.json"
print -r -- '{}' > "${kora_harvest_file}"
for role in owner architect client builder guest; do
  user_id=$(jq -er --arg role "${role}" '.sessions[$role].userId' "${session_file}")
  cookie_binding=$(./node_modules/.bin/tsx tests/pilot-evidence/cookie-session-cli.ts "$(cookie_path "${role}")")
  [[ $(print -r -- "${cookie_binding}" | jq -er '.userId') == "${user_id}" ]] || {
    print -u2 -r -- "AP1_KORA_HARVEST_USER_MISMATCH role=${role}"; exit 1
  }
  session_id=$(print -r -- "${cookie_binding}" | jq -er '.sessionId')
  expected_session_digest="sha256:$(print -rn -- "${session_id}" | shasum -a 256 | awk '{print $1}')"
  portfolio_response="${evidence_dir}/${role}-portfolio-harvest.json"
  portfolio_headers="${evidence_dir}/${role}-portfolio-harvest.headers"
  portfolio_http=$(curl -sS -c "$(cookie_path "${role}")" -b "$(cookie_path "${role}")" \
    -D "${portfolio_headers}" \
    -w '%{http_code}' -o "${portfolio_response}" "${next_origin}/api/projectceo/portfolio")
  actual_session_digest=$(awk 'tolower($1) == "x-archidom-auth-session-digest:" { gsub("\r", "", $2); print $2 }' "${portfolio_headers}")
  rm -f -- "${portfolio_headers}"
  if [[ ${portfolio_http} != 2* ]]; then
    error_code=$(jq -r '.error.code // "unknown"' "${portfolio_response}" 2>/dev/null || print -r -- unknown)
    print -u2 -r -- "AP1_KORA_HARVEST_HTTP role=${role} status=${portfolio_http} code=${error_code}"
    exit 1
  fi
  [[ ${actual_session_digest} == "${expected_session_digest}" ]] || {
    print -u2 -r -- "AP1_KORA_HARVEST_SESSION_MISMATCH role=${role}"; exit 1
  }
  if ! request_id=$(jq -er '.requestId' "${portfolio_response}"); then
    print -u2 -r -- "AP1_KORA_HARVEST_REQUEST_ID_MISSING role=${role}"
    exit 1
  fi
  jq --arg role "${role}" --arg userId "${user_id}" --arg sessionId "${session_id}" \
    --arg requestId "${request_id}" \
    '.[$role] = {userId: $userId, sessionId: $sessionId, requestId: $requestId}' \
    "${kora_harvest_file}" > "${kora_harvest_file}.next"
  mv -- "${kora_harvest_file}.next" "${kora_harvest_file}"
done
chmod 600 "${kora_harvest_file}"

# The external package shares these disposable users but is added only after
# all Kora HTTP assertions and the binding harvest above have completed.
AP1_EXTERNAL_ONLY=1 \
AP1_API_URL="${api_url}" \
AP1_ANON_KEY="${anon_key}" \
AP1_SERVICE_ROLE_KEY="${service_role_key}" \
AP1_SESSION_FILE="${session_file}" \
AP1_DB_CONTAINER="${db_container}" \
AP1_NEXT_ORIGIN="${next_origin}" \
  ./node_modules/.bin/tsx tests/ap1/e2e/provision-kora.ts

jq -n '{
  contractVersion:"archidom-ap1-five-session-evidence/0.1",
  productionChanged:false,
  users:5,
  auth:"magiclink",
  project:{name:"Kora Food Hall",areaM2:1800,registrySources:209,foundationFixtureSources:0,sitePhotos:1,physicalSources:210,materializedSources:82,placeholders:128,uniqueBlobs:29,duplicateGroups:18,quarantinedGroups:8},
  gates:{invitationAccept:true,distributionAcknowledgement:true,changeImpactReview:true,photoEvidenceReview:true,milestoneAcceptance:true,exactRetry:true,csrf:true,tenantIsolation:true,guestExactTokenScope:true}
}' > "${evidence_dir}/summary.json"

run_completed=1
print -r -- "AP1_SUPPORTED_SLICE_E2E_OK users=5 auth=magiclink kora_registry=209 foundation_fixtures=0 site_photos=1 area_m2=1800 invite_accept=true distribution_ack=true change_impact=true photo_review=true milestone_accept=true replay=true csrf=true isolation=true identity_bootstrap=disposable production_changed=false"
