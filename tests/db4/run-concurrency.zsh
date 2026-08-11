#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

: "${PI_DB4_CONTAINER:?PI_DB4_CONTAINER is required}"
: "${PI_DB4_DATABASE:?PI_DB4_DATABASE is required}"
: "${PI_DB4_PASSWORD:?PI_DB4_PASSWORD is required}"

container=${PI_DB4_CONTAINER}
database=${PI_DB4_DATABASE}
password=${PI_DB4_PASSWORD}
project=41111111-1111-4111-8111-111111111111
package=41111111-1111-4111-8111-111111111111
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/pi-db4-concurrency.XXXXXX")
trap 'rm -rf "${tmpdir}"' EXIT INT TERM

psql_exec() {
  local app=$1
  local sql=$2
  docker exec \
    -e PGPASSWORD="${password}" \
    -e PGAPPNAME="${app}" \
    "${container}" \
    psql -X --quiet --tuples-only --no-align \
      --set ON_ERROR_STOP=1 \
      --username postgres \
      --dbname "${database}" \
      --command "${sql}"
}

state=$(psql_exec db4-concurrency-state "
  select state_revision
  from project_intelligence.project_workflows
  where project_id = '${project}'
")
evidence=$(psql_exec db4-concurrency-evidence "
  select jsonb_agg(
    jsonb_build_object(
      'evidenceVersionId', evidence_version_id,
      'evidenceLinkId', evidence_link_id,
      'sourceId', source_id,
      'sourceNodeId', source_node_id,
      'sourceRevisionId', source_revision_id,
      'fragmentId', fragment_id
    )
    order by ordinal
  )
  from projectceo_product.revision_evidence_refs
  where project_id = '${project}'
    and claim_revision_id = 'revision-decision-db4-r1'
")

call="begin;
set local role service_role;
select projectceo_product_api.append_system_decision_revision(
  '${project}',
  '${package}',
  'node-decision-db4',
  'revision-decision-db4-r2',
  'revision-decision-db4-r1',
  'interpreted',
  'DB4 sourced decision revision two',
  'Use the approved floor solution with exact replay proof',
  'node-area-db4',
  'proposed',
  '${evidence}'::jsonb,
  'Concurrent exact revision',
  ${state},
  'db4-concurrent-decision-r2'
);
commit;"

set +e
psql_exec db4-decision-a "${call}" >"${tmpdir}/a.out" 2>&1 &
pid_a=$!
psql_exec db4-decision-b "${call}" >"${tmpdir}/b.out" 2>&1 &
pid_b=$!
wait "${pid_a}"; status_a=$?
wait "${pid_b}"; status_b=$?
set -e

if [[ "${status_a}" != "0" || "${status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent product revision failed"
  sed -n '1,160p' "${tmpdir}/a.out" >&2
  sed -n '1,160p' "${tmpdir}/b.out" >&2
  exit 1
fi

if [[ $(
  (rg -o '"replay": false' "${tmpdir}/a.out" "${tmpdir}/b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]] || [[ $(
  (rg -o '"replay": true' "${tmpdir}/a.out" "${tmpdir}/b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]]; then
  print -u2 -r -- "Concurrent product revision replay contract failed"
  sed -n '1,160p' "${tmpdir}/a.out" >&2
  sed -n '1,160p' "${tmpdir}/b.out" >&2
  exit 1
fi

expected_state=$(( state + 1 ))
result=$(psql_exec db4-concurrency-assert "
  select pw.state_revision::text
    || '|' || gn.current_revision_id
    || '|' || count(distinct gr.revision_id)::text
    || '|' || count(distinct cr.command_id)::text
    || '|' || count(distinct rer.evidence_link_id)::text
  from project_intelligence.project_workflows pw
  join project_intelligence.graph_nodes gn
    on gn.organization_id = pw.organization_id
   and gn.project_id = pw.project_id
   and gn.node_id = 'node-decision-db4'
  left join project_intelligence.graph_node_revisions gr
    on gr.organization_id = gn.organization_id
   and gr.project_id = gn.project_id
   and gr.revision_id = 'revision-decision-db4-r2'
  left join projectceo_product.command_records cr
    on cr.organization_id = pw.organization_id
   and cr.project_id = pw.project_id
   and cr.operation = 'append_system_decision_revision'
   and cr.logical_result ->> 'revisionId' =
       'revision-decision-db4-r2'
  left join projectceo_product.revision_evidence_refs rer
    on rer.organization_id = pw.organization_id
   and rer.project_id = pw.project_id
   and rer.claim_revision_id = 'revision-decision-db4-r2'
  where pw.project_id = '${project}'
  group by pw.state_revision, gn.current_revision_id
")
if [[
  "${result}" !=
  "${expected_state}|revision-decision-db4-r2|1|1|1"
]]; then
  print -u2 -r -- "Concurrent product revision persisted invalid state: ${result}"
  exit 1
fi

# Two independently valid immutable documents race for one public versionId.
# The workflow lock/state precondition plus the version uniqueness invariant
# must leave exactly one publication; the losing transaction fails closed.
layout_state=$(psql_exec db4-layout-race-state "
  select state_revision from project_intelligence.project_workflows
  where project_id='${project}'
")
layout_a=$(psql_exec db4-layout-race-payload-a "
  with source as (
    select jsonb_set(payload->'layoutContent','{documentId}','\"layout-race-a\"'::jsonb) content
    from projectceo_product.m2_workspace_revisions
    where project_id='${project}' and entity_kind='layout_version'
      and entity_id='layout-document-db4-secondary'
    order by revision_no desc limit 1
  )
  select jsonb_build_object(
    'versionId','layout-version-concurrent-r1','roomId','db4-room',
    'variantId','db4-variant-value','role','value_engineered',
    'semanticHash',projectceo_product._m2_layout_semantic_hash(content),
    'schemaVersion','project-ceo-m2-layout/0.1','layoutContent',content
  ) from source
")
layout_b=$(psql_exec db4-layout-race-payload-b "
  with source as (
    select jsonb_set(payload->'layoutContent','{documentId}','\"layout-race-b\"'::jsonb) content
    from projectceo_product.m2_workspace_revisions
    where project_id='${project}' and entity_kind='layout_version'
      and entity_id='layout-document-db4-secondary'
    order by revision_no desc limit 1
  )
  select jsonb_build_object(
    'versionId','layout-version-concurrent-r1','roomId','db4-room',
    'variantId','db4-variant-value','role','value_engineered',
    'semanticHash',projectceo_product._m2_layout_semantic_hash(content),
    'schemaVersion','project-ceo-m2-layout/0.1','layoutContent',content
  ) from source
")
layout_call_a="begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
select projectceo_product_api.append_m2_workspace_revision(
  '${project}','${package}','layout_version','layout-race-a',
  'layout-race-a-revision-r1',null,'published','${layout_a}'::jsonb,
  'DB4 concurrent layout A',${layout_state},'db4-layout-race-a'
); commit;"
layout_call_b="begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
select projectceo_product_api.append_m2_workspace_revision(
  '${project}','${package}','layout_version','layout-race-b',
  'layout-race-b-revision-r1',null,'published','${layout_b}'::jsonb,
  'DB4 concurrent layout B',${layout_state},'db4-layout-race-b'
); commit;"

set +e
psql_exec db4-layout-race-a "${layout_call_a}" >"${tmpdir}/layout-a.out" 2>&1 &
layout_pid_a=$!
psql_exec db4-layout-race-b "${layout_call_b}" >"${tmpdir}/layout-b.out" 2>&1 &
layout_pid_b=$!
wait "${layout_pid_a}"; layout_status_a=$?
wait "${layout_pid_b}"; layout_status_b=$?
set -e

if [[ $(( layout_status_a + layout_status_b )) == 0 ]] \
  || [[ "${layout_status_a}" != "0" && "${layout_status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent layout version race did not select exactly one winner"
  sed -n '1,120p' "${tmpdir}/layout-a.out" >&2
  sed -n '1,120p' "${tmpdir}/layout-b.out" >&2
  exit 1
fi

layout_result=$(psql_exec db4-layout-race-assert "
  select count(*)::text || '|' || count(distinct entity_id)::text
  from projectceo_product.m2_workspace_revisions
  where project_id='${project}' and package_id='${package}'
    and entity_kind='layout_version'
    and payload->>'versionId'='layout-version-concurrent-r1'
")
if [[ "${layout_result}" != "1|1" ]]; then
  print -u2 -r -- "Concurrent layout version race persisted invalid state: ${layout_result}"
  exit 1
fi

# Cycle 6 lock order: after one immutable submission, two client decisions at
# the same workflow revision race. Exactly one review may append; the loser
# must fail stale after waiting on the workflow/revision locks (never deadlock).
cycle6_variants=$(psql_exec db4-cycle6-race-variants "
  select payload->'variants'
  from projectceo_product.m2_workspace_revisions
  where project_id='${project}' and entity_kind='m2_client_submission'
    and entity_id='cycle6-submission'
  order by revision_no desc limit 1
")
cycle6_submit_state=$(psql_exec db4-cycle6-race-submit-state "
  select state_revision
  from project_intelligence.project_workflows
  where project_id='${project}'
")
cycle6_setup=$(psql_exec db4-cycle6-race-setup "
  begin;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  select projectceo_product_api.submit_m2_client_review(
    '${project}','${package}','cycle6-race-submission',
    '75000000-0000-4000-8000-000000000001',null,
    'approval-db4-m2-exact','cycle6-living-room','revision-decision-db4-r1',
    '${cycle6_variants}'::jsonb,
    '2026-08-06T10:00:00+08:00',30,'Concurrent client review snapshot',
    ${cycle6_submit_state},
    'cycle6-race-submit');
  commit;
")
cycle6_state=$(psql_exec db4-cycle6-race-state "
  select state_revision from project_intelligence.project_workflows where project_id='${project}'
")
cycle6_review_a="begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
select projectceo_product_api.review_m2_client_submission(
  '${project}','${package}','cycle6-race-submission',
  '75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000001',
  'cycle6-variant-preferred','approved','Concurrent client approval',
  ${cycle6_state},'cycle6-race-review-a'); commit;"
cycle6_review_b="begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
select projectceo_product_api.review_m2_client_submission(
  '${project}','${package}','cycle6-race-submission',
  '75000000-0000-4000-8000-000000000003','75000000-0000-4000-8000-000000000001',
  'cycle6-variant-preferred','rejected','Concurrent client rejection',
  ${cycle6_state},'cycle6-race-review-b'); commit;"

set +e
psql_exec db4-cycle6-review-a "${cycle6_review_a}" >"${tmpdir}/cycle6-a.out" 2>&1 &
cycle6_pid_a=$!
psql_exec db4-cycle6-review-b "${cycle6_review_b}" >"${tmpdir}/cycle6-b.out" 2>&1 &
cycle6_pid_b=$!
wait "${cycle6_pid_a}"; cycle6_status_a=$?
wait "${cycle6_pid_b}"; cycle6_status_b=$?
set -e

if [[ $(( cycle6_status_a + cycle6_status_b )) == 0 ]] \
  || [[ "${cycle6_status_a}" != "0" && "${cycle6_status_b}" != "0" ]]; then
  print -u2 -r -- "Cycle 6 review race did not select exactly one winner"
  sed -n '1,120p' "${tmpdir}/cycle6-a.out" >&2
  sed -n '1,120p' "${tmpdir}/cycle6-b.out" >&2
  exit 1
fi

cycle6_result=$(psql_exec db4-cycle6-race-assert "
  select count(*)::text || '|' || count(distinct revision_id)::text
  from projectceo_product.m2_workspace_revisions
  where project_id='${project}' and package_id='${package}'
    and entity_kind='m2_client_review' and entity_id='cycle6-race-submission'
")
if [[ "${cycle6_result}" != "1|1" ]]; then
  print -u2 -r -- "Cycle 6 review race persisted invalid state: ${cycle6_result}"
  exit 1
fi

# Два системных воркера артефактов выпуска сталкиваются на одной версии
# (DEC-030, инкремент 1.5). Идентификатор артефакта и ключ идемпотентности
# детерминированные — те же, что выводит `planner.ts`, — поэтому оба вызова
# уходят одинаковыми. Контракт: обе транзакции успешны, артефакт ровно один,
# и ровно одна из них видит `replay: false`.
worker_state=$(psql_exec db4-release-worker-state "
  select state_revision from project_intelligence.project_workflows
  where project_id='${project}'
")
worker_org=$(psql_exec db4-release-worker-org "
  select organization_id from project_intelligence.project_workflows
  where project_id='${project}'
")
# Та же деривация, что в TypeScript (`planner.ts`): sha256 от
# «организация U+001F проект U+001F версия», первые 32 hex. Разделитель именно
# U+001F, а не пробел и не NUL: пробел бывает внутри идентификатора версии, а
# NUL PostgreSQL в `text` не принимает вовсе. Разойдись эти две деривации —
# воркер и этот сценарий проверяли бы разные значения, а комментарий врал бы.
worker_artifact=$(psql_exec db4-release-worker-artifact-id "
  select 'release-artifact:' || left(encode(project_intelligence._sha256_text(
    '${worker_org}' || E'\\x1f' || '${project}' || E'\\x1f' || 'package-db4-work-v1'
  ), 'hex'), 32)
")
worker_descriptor=$(psql_exec db4-release-worker-descriptor "
  select jsonb_build_object(
    'artifactId', '${worker_artifact}',
    'productionPackageVersionId', 'package-db4-work-v1',
    'format', 'logical_json',
    'semanticHash', 'sha256:' || encode(
      project_intelligence._sha256_jsonb(jsonb_build_object(
        'artifacts', jsonb_build_array(jsonb_build_object(
          'contentHash', 'sha256:' || encode(ppv.semantic_digest, 'hex'),
          'kind', 'logical_json'
        )),
        'baselineId', ppv.baseline_id,
        'exactRevisionRefs', ppv.semantic_content -> 'exactRevisionRefs',
        'organizationId', ppv.organization_id,
        'packageId', ppv.package_id,
        'productionPackageSemanticHash',
          'sha256:' || encode(ppv.semantic_digest, 'hex'),
        'productionPackageVersionId', ppv.production_package_version_id,
        'projectId', ppv.project_id,
        'schemaVersion', 'project-ceo-release/0.1'
      )),
      'hex'
    )
  )::text
  from projectceo_product.production_package_versions ppv
  where ppv.project_id='${project}'
    and ppv.production_package_version_id='package-db4-work-v1'
")
worker_call="begin;
set local role service_role;
select projectceo_product_api.build_release_artifact(
  '${project}',
  '${worker_descriptor}'::jsonb,
  ${worker_state},
  'worker:release-artifact:package-db4-work-v1'
);
commit;"

set +e
psql_exec db4-release-worker-a "${worker_call}" >"${tmpdir}/worker-a.out" 2>&1 &
worker_pid_a=$!
psql_exec db4-release-worker-b "${worker_call}" >"${tmpdir}/worker-b.out" 2>&1 &
worker_pid_b=$!
wait "${worker_pid_a}"; worker_status_a=$?
wait "${worker_pid_b}"; worker_status_b=$?
set -e

if [[ "${worker_status_a}" != "0" || "${worker_status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent release artifact worker failed"
  sed -n '1,160p' "${tmpdir}/worker-a.out" >&2
  sed -n '1,160p' "${tmpdir}/worker-b.out" >&2
  exit 1
fi

if [[ $(
  (rg -o '"replay": false' "${tmpdir}/worker-a.out" "${tmpdir}/worker-b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]] || [[ $(
  (rg -o '"replay": true' "${tmpdir}/worker-a.out" "${tmpdir}/worker-b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]]; then
  print -u2 -r -- "Concurrent release artifact replay contract failed"
  sed -n '1,160p' "${tmpdir}/worker-a.out" >&2
  sed -n '1,160p' "${tmpdir}/worker-b.out" >&2
  exit 1
fi

worker_result=$(psql_exec db4-release-worker-assert "
  select count(*)::text || '|' || count(distinct artifact_id)::text
  from projectceo_product.release_artifacts
  where project_id='${project}'
    and production_package_version_id='package-db4-work-v1'
")
if [[ "${worker_result}" != "1|1" ]]; then
  print -u2 -r -- "Concurrent release artifact persisted invalid state: ${worker_result}"
  exit 1
fi

# Повтор после гонки — тот же ключ, тот же результат, второго артефакта нет.
psql_exec db4-release-worker-repeat "${worker_call}" >"${tmpdir}/worker-repeat.out" 2>&1
worker_repeat=$(psql_exec db4-release-worker-repeat-assert "
  select count(*)::text
  from projectceo_product.release_artifacts
  where project_id='${project}'
    and production_package_version_id='package-db4-work-v1'
")
if [[ "${worker_repeat}" != "1" ]]; then
  print -u2 -r -- "Release artifact repeat created a duplicate: ${worker_repeat}"
  exit 1
fi

print -r -- "DB4_RELEASE_ARTIFACT_WORKER_OK"

# ---------------------------------------------------------------------------
# Telegram Chat Bridge: настоящие гонки (CORRECTIVE C1, блокер 4)
# ---------------------------------------------------------------------------
#
# Три последовательные правки конкурентностью не являются: они проходят по
# одной, и блокировка ревизии на них не нагружается вовсе. Ниже — параллельные
# процессы, каждый в своей сессии.

tg_owner=31111111-1111-4111-8111-111111111111
tg_project_e=45555555-5555-4555-8555-555555555555
tg_project_f=46666666-6666-4666-8666-666666666666

psql_exec db4-tg-race-setup "
  insert into public.projects (id, designer_id, client_name, status, intake_token)
  values
    ('${tg_project_e}','${tg_owner}','Race E','active_project','db4-tg-race-e'),
    ('${tg_project_f}','${tg_owner}','Race F','active_project','db4-tg-race-f');
" >/dev/null

for proj in "${tg_project_e}" "${tg_project_f}"; do
  psql_exec db4-tg-race-enroll "
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub = '${tg_owner}';
    select projectceo_api.enroll_organization_project('${proj}', 'db4-tg-enroll-${proj}');
    commit;
  " >/dev/null
done

# --- Гонка 1: два бота доводят СВОИ связи в ОДНОМ чате до активной ----------
#
# Частичный уникальный индекс покрывает только `active`, поэтому два
# `notice_pending` в одном чате сосуществуют законно. Победить обязан ровно
# один, и проигравший обязан получить осмысленный конфликт, а не
# `unique_violation`.
race_chat=-100900
for pair in "${tg_project_e}:bot-alpha:race-nonce-e" "${tg_project_f}:bot-beta:race-nonce-f"; do
  proj=${pair%%:*}; rest=${pair#*:}; botid=${rest%%:*}; nonce=${rest#*:}
  psql_exec db4-tg-race-intent "
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub = '${tg_owner}';
    select remhaos_channel_api.create_binding_intent(
      '${proj}', pg_catalog.sha256(convert_to('${nonce}', 'UTF8')), 600);
    commit;
    begin;
    set local role service_role;
    select remhaos_channel_api.activate_project_binding(
      pg_catalog.sha256(convert_to('${nonce}', 'UTF8')),
      777001, '${botid}', ${race_chat}, 'supergroup', 'notice-v1', true, true);
    commit;
  " >/dev/null
done

binding_e=$(psql_exec db4-tg-race-binding-e "
  select binding_id from remhaos_channel.project_channel_bindings
  where project_id='${tg_project_e}' and status='notice_pending'")
binding_f=$(psql_exec db4-tg-race-binding-f "
  select binding_id from remhaos_channel.project_channel_bindings
  where project_id='${tg_project_f}' and status='notice_pending'")

notice_call() {
  print -r -- "begin;
set local role service_role;
select remhaos_channel_api.mark_channel_notice_posted('$1'::uuid,'notice-v1',true,true);
commit;"
}

set +e
psql_exec db4-tg-notice-e "$(notice_call "${binding_e}")" >"${tmpdir}/tg-notice-e.out" 2>&1 &
tg_pid_e=$!
psql_exec db4-tg-notice-f "$(notice_call "${binding_f}")" >"${tmpdir}/tg-notice-f.out" 2>&1 &
tg_pid_f=$!
wait "${tg_pid_e}"; tg_status_e=$?
wait "${tg_pid_f}"; tg_status_f=$?
set -e

if [[ $(( tg_status_e + tg_status_f )) == 0 ]] \
  || [[ "${tg_status_e}" != "0" && "${tg_status_f}" != "0" ]]; then
  print -u2 -r -- "Telegram cross-bot notice race did not select exactly one winner"
  sed -n '1,80p' "${tmpdir}/tg-notice-e.out" >&2
  sed -n '1,80p' "${tmpdir}/tg-notice-f.out" >&2
  exit 1
fi

# Проигравший обязан отказать ОСМЫСЛЕННО. `unique_violation` наружу означал бы,
# что дверь полагается на индекс вместо собственной проверки.
if ! rg -q 'scope_conflict|CHANNEL_ALREADY_BOUND' \
     "${tmpdir}/tg-notice-e.out" "${tmpdir}/tg-notice-f.out"; then
  print -u2 -r -- "Telegram cross-bot notice race loser did not fail with a controlled conflict"
  sed -n '1,80p' "${tmpdir}/tg-notice-e.out" >&2
  sed -n '1,80p' "${tmpdir}/tg-notice-f.out" >&2
  exit 1
fi

tg_race_result=$(psql_exec db4-tg-race-assert "
  select count(*)::text
  from remhaos_channel.project_channel_bindings
  where external_chat_id=${race_chat} and status='active'")
if [[ "${tg_race_result}" != "1" ]]; then
  print -u2 -r -- "Telegram cross-bot race left ${tg_race_result} active bindings"
  exit 1
fi

# --- Гонка 2: параллельные правки одного сообщения ---------------------------
#
# Ревизия считалась через `max(...)+1` без блокировки: под нагрузкой правки
# получали один номер и терялись, а вызов отвечал «сохранено».
winner_project=$(psql_exec db4-tg-race-winner "
  select project_id from remhaos_channel.project_channel_bindings
  where external_chat_id=${race_chat} and status='active'")
winner_bot=$(psql_exec db4-tg-race-winner-bot "
  select bot_instance_id from remhaos_channel.project_channel_bindings
  where external_chat_id=${race_chat} and status='active'")

psql_exec db4-tg-edit-seed "
  begin;
  set local role service_role;
  select remhaos_channel_api.ingest_channel_update(
    '${winner_bot}', 90000, ${race_chat}, 4242, 'message', 777001, null, null, null,
    '{\"kind\":\"message\",\"text\":\"исходное\",\"attachmentCount\":0}'::jsonb);
  commit;" >/dev/null

set +e
tg_edit_pids=()
for i in 1 2 3 4; do
  psql_exec "db4-tg-edit-${i}" "begin;
set local role service_role;
select remhaos_channel_api.ingest_channel_update(
  '${winner_bot}', $(( 90000 + i )), ${race_chat}, 4242, 'edited_message', 777001,
  null, null, null,
  '{\"kind\":\"edited_message\",\"text\":\"правка ${i}\",\"attachmentCount\":0}'::jsonb);
commit;" >"${tmpdir}/tg-edit-${i}.out" 2>&1 &
  tg_edit_pids+=($!)
done
tg_edit_failures=0
for pid in "${tg_edit_pids[@]}"; do
  wait "${pid}" || tg_edit_failures=$(( tg_edit_failures + 1 ))
done
set -e

if [[ "${tg_edit_failures}" != "0" ]]; then
  print -u2 -r -- "Concurrent telegram edits failed: ${tg_edit_failures}"
  sed -n '1,60p' "${tmpdir}"/tg-edit-*.out >&2
  exit 1
fi

# Пять ревизий: исходная и четыре правки. Номера последовательные и различные —
# ни одна правка не переписала предыдущую и ни одна не потерялась.
tg_edit_result=$(psql_exec db4-tg-edit-assert "
  select count(*)::text
    || '|' || count(distinct source_revision)::text
    || '|' || min(source_revision)::text
    || '|' || max(source_revision)::text
    || '|' || count(distinct payload->>'text')::text
  from remhaos_channel.channel_events
  where external_chat_id=${race_chat} and external_message_id=4242")
if [[ "${tg_edit_result}" != "5|5|1|5|5" ]]; then
  print -u2 -r -- "Concurrent telegram edits persisted invalid revisions: ${tg_edit_result}"
  exit 1
fi

# Очередь этих проектов оставляем терминальной: claim глобален, и брошенная
# работа увела бы следующий сценарий на чужую строку.
psql_exec db4-tg-race-cleanup "
  update remhaos_channel.notification_outbox
  set state='cancelled', failure_code='db4_fixture_cleanup',
      lease_token=null, lease_expires_at=null
  where project_id in ('${tg_project_e}','${tg_project_f}')
    and state in ('pending','retry','sending');" >/dev/null

print -r -- "DB4_TELEGRAM_BRIDGE_CONCURRENCY_OK"

print -r -- "DB4_CONCURRENCY_OK"
