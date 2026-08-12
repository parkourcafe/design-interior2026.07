#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

: "${PI_DB5_CONTAINER:?PI_DB5_CONTAINER is required}"
: "${PI_DB5_DATABASE:?PI_DB5_DATABASE is required}"
: "${PI_DB5_PASSWORD:?PI_DB5_PASSWORD is required}"

container=${PI_DB5_CONTAINER}
database=${PI_DB5_DATABASE}
password=${PI_DB5_PASSWORD}
project=41111111-1111-4111-8111-111111111111
package=41111111-1111-4111-8111-111111111111
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/pi-db5-concurrency.XXXXXX")
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

state=$(psql_exec db5-concurrency-state "
  select state_revision
  from project_intelligence.project_workflows
  where project_id = '${project}'
")

# Роль та же, что у остальных вызовов инкремента 2 в `20_execution_operations`:
# `authenticated` эти RPC не видит и не должен, а конкурентность проверяется на
# том же пути, что и одиночный вызов, иначе она проверяла бы другой путь.
call="begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_m4_api.define_milestone(
  '${project}',
  '${package}',
  'package-db4-root-v1',
  'Concurrent replay milestone',
  '[\"node-area-db4\"]'::jsonb,
  ${state},
  'db5-concurrent-milestone'
);
commit;"

set +e
psql_exec db5-milestone-a "${call}" >"${tmpdir}/a.out" 2>&1 &
pid_a=$!
psql_exec db5-milestone-b "${call}" >"${tmpdir}/b.out" 2>&1 &
pid_b=$!
wait "${pid_a}"; status_a=$?
wait "${pid_b}"; status_b=$?
set -e

if [[ "${status_a}" != "0" || "${status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent M4 milestone failed"
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
  print -u2 -r -- "Concurrent M4 replay contract failed"
  sed -n '1,160p' "${tmpdir}/a.out" >&2
  sed -n '1,160p' "${tmpdir}/b.out" >&2
  exit 1
fi

expected_state=$(( state + 1 ))
result=$(psql_exec db5-concurrency-assert "
  select workflow.state_revision::text
    || '|' || count(distinct milestone.milestone_id)::text
    || '|' || count(distinct command.command_id)::text
  from project_intelligence.project_workflows workflow
  left join projectceo_m4.milestones milestone
    on milestone.organization_id = workflow.organization_id
   and milestone.project_id = workflow.project_id
   and milestone.title = 'Concurrent replay milestone'
  left join projectceo_product.command_records command
    on command.organization_id = workflow.organization_id
   and command.project_id = workflow.project_id
   and command.operation = 'define_milestone'
   and command.logical_result ->> 'title' =
     'Concurrent replay milestone'
  where workflow.project_id = '${project}'
  group by workflow.state_revision
")
if [[ "${result}" != "${expected_state}|1|1" ]]; then
  print -u2 -r -- "Concurrent M4 state invalid: ${result}"
  exit 1
fi

# Вторая гонка: РАСЧЁТ ВЛИЯНИЯ (гейт V1 «два параллельных прохода дают один
# прогон»).
#
# Почему на отдельной заявке — см. `27_impact_concurrency_fixture.sql`: у заявки
# золотого проекта прогон уже есть, и оба соперника получили бы
# `IMPACT_ALREADY_CALCULATED`, то есть проверялся бы повтор, а не гонка.
#
# Роль здесь `service_role`, а не тестовая: расчёт — системная операция, и
# гонка обязана идти тем же путём, каким ходит воркер.
impact_change_request=c0ffee00-0000-4000-8000-000000000001

impact_state=$(psql_exec db5-impact-state "
  select state_revision
  from project_intelligence.project_workflows
  where project_id = '${project}'
")

# Ключ идемпотентности тот же, что выводит воркер
# (`changeImpactIdempotencyKey`): гонка обязана проверять ровно то значение,
# которым ходит продукт, иначе она доказывает поведение, которого нет.
impact_call="begin;
set local role service_role;
select projectceo_m4_api.calculate_change_impact_policy_bound(
  '${project}',
  '${impact_change_request}'::uuid,
  ${impact_state},
  'worker:change-impact:${impact_change_request}'
);
commit;"

set +e
psql_exec db5-impact-a "${impact_call}" >"${tmpdir}/impact-a.out" 2>&1 &
pid_impact_a=$!
psql_exec db5-impact-b "${impact_call}" >"${tmpdir}/impact-b.out" 2>&1 &
pid_impact_b=$!
wait "${pid_impact_a}"; status_impact_a=$?
wait "${pid_impact_b}"; status_impact_b=$?
set -e

# Оба вызова обязаны ЗАВЕРШИТЬСЯ успехом. Проигравший гонку не падает: у него
# тот же ключ идемпотентности, и он получает сохранённый результат победителя.
if [[ "${status_impact_a}" != "0" || "${status_impact_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent M4 impact calculation failed"
  sed -n '1,160p' "${tmpdir}/impact-a.out" >&2
  sed -n '1,160p' "${tmpdir}/impact-b.out" >&2
  exit 1
fi

# Ровно один из двух посчитал, ровно один получил повтор. Два `replay: false`
# означали бы два прогона, два `true` — что не посчитал никто.
if [[ $(
  (rg -o '"replay": false' "${tmpdir}/impact-a.out" "${tmpdir}/impact-b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]] || [[ $(
  (rg -o '"replay": true' "${tmpdir}/impact-a.out" "${tmpdir}/impact-b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]]; then
  print -u2 -r -- "Concurrent M4 impact replay contract failed"
  sed -n '1,160p' "${tmpdir}/impact-a.out" >&2
  sed -n '1,160p' "${tmpdir}/impact-b.out" >&2
  exit 1
fi

# И главное — состояние базы. Ровно один прогон, ровно один набор влияния и
# ровно одна запись команды: контракт повтора проверяется по данным, а не по
# тексту ответа.
impact_result=$(psql_exec db5-impact-assert "
  select (
    select count(*)
    from projectceo_m4.impact_runs run
    where run.project_id = '${project}'
      and run.change_request_id = '${impact_change_request}'
  )::text
  || '|' || (
    select count(distinct impact.impact_run_id)
    from projectceo_m4.impacts impact
    where impact.project_id = '${project}'
      and impact.change_request_id = '${impact_change_request}'
  )::text
  || '|' || (
    select count(*)
    from projectceo_product.command_records command
    where command.project_id = '${project}'
      and command.operation = 'calculate_change_impact'
      and command.logical_result ->> 'changeRequestId'
        = '${impact_change_request}'
  )::text
")
if [[ "${impact_result}" != "1|1|1" ]]; then
  print -u2 -r -- "Concurrent M4 impact state invalid: ${impact_result}"
  exit 1
fi

print -r -- "DB5_IMPACT_CONCURRENCY_OK"

print -r -- "DB5_CONCURRENCY_OK"

# ─────────────────────────────────────────────────────────────────────────────
# V1 Impact (DEC-033): два параллельных прохода воркера на ОДНОЙ ещё не
# посчитанной заявке обязаны дать ОДИН исход. Фикстура — своя отдельная
# ChangeRequest (не золотая: та уже посчитана в `20_execution_operations.sql`)
# на минимальном графе в один шаг, построенная тем же приёмом, что и в
# `26_...`/`27_...` (`session_replication_role = replica`, реальный
# `proposed_baseline_id` золотого проекта — RPC резолвит его в момент вызова).
impact_org=$(psql_exec db5-concurrency-impact-org "
  select cr.organization_id::text
  from projectceo_m4.change_requests cr
  where cr.project_id = '${project}'
  order by cr.requested_at
  limit 1
")
impact_graph_version=$(psql_exec db5-concurrency-impact-graph "
  select pb.graph_version_id
  from projectceo_m4.change_requests cr
  join projectceo_product.project_baselines pb
    on pb.organization_id = cr.organization_id
   and pb.project_id = cr.project_id
   and pb.baseline_id = cr.proposed_baseline_id
  where cr.project_id = '${project}'
  order by cr.requested_at
  limit 1
")
impact_to_baseline=$(psql_exec db5-concurrency-impact-baseline "
  select cr.proposed_baseline_id
  from projectceo_m4.change_requests cr
  where cr.project_id = '${project}'
  order by cr.requested_at
  limit 1
")
impact_from_version=$(psql_exec db5-concurrency-impact-version "
  select cr.from_production_package_version_id
  from projectceo_m4.change_requests cr
  where cr.project_id = '${project}'
  order by cr.requested_at
  limit 1
")

psql_exec db5-concurrency-impact-fixture "
begin;
set local session_replication_role = replica;
insert into project_intelligence.graph_nodes (
  organization_id, project_id, node_id, kind, stable_key, current_revision_id
) values
  ('${impact_org}', '${project}', 'concur-impact-root', 'deliverable', 'concur-impact:root', 'rev-concur-impact-root'),
  ('${impact_org}', '${project}', 'concur-impact-leaf', 'deliverable', 'concur-impact:leaf', 'rev-concur-impact-leaf');
insert into project_intelligence.version_nodes (
  organization_id, project_id, version_id, node_id, revision_id
) values
  ('${impact_org}', '${project}', '${impact_graph_version}', 'concur-impact-root', 'rev-concur-impact-root'),
  ('${impact_org}', '${project}', '${impact_graph_version}', 'concur-impact-leaf', 'rev-concur-impact-leaf');
insert into project_intelligence.graph_edges (
  organization_id, project_id, edge_id, from_node_id, to_node_id, relation
) values (
  '${impact_org}', '${project}', 'concur-impact-edge',
  'concur-impact-leaf', 'concur-impact-root', 'depends_on'
);
insert into project_intelligence.version_edges (
  organization_id, project_id, version_id, edge_id
) values ('${impact_org}', '${project}', '${impact_graph_version}', 'concur-impact-edge');
insert into projectceo_m4.change_requests (
  organization_id, project_id, change_request_id, package_id,
  from_baseline_id, proposed_baseline_id, from_production_package_version_id,
  protected_reason, reason_digest, initiator_role, delta_cost_rub, delta_days,
  requested_by_user_id
) values (
  '${impact_org}', '${project}', 'd0000000-0000-4000-8000-000000000001', '${package}',
  'concur-impact-baseline', '${impact_to_baseline}', '${impact_from_version}',
  'concurrency impact request',
  pg_catalog.sha256(convert_to('concurrency impact request', 'UTF8')),
  'architect', 0, 0, '31111111-1111-4111-8111-111111111111'
);
insert into projectceo_m4.change_request_roots (
  organization_id, project_id, change_request_id, package_id,
  from_baseline_id, proposed_baseline_id, target_kind, node_id,
  from_revision_id, to_revision_id
) values (
  '${impact_org}', '${project}', 'd0000000-0000-4000-8000-000000000001', '${package}',
  'concur-impact-baseline', '${impact_to_baseline}', 'decision_revision',
  'concur-impact-root', 'rev-concur-impact-root-from', 'rev-concur-impact-root'
);
commit;
analyze project_intelligence.graph_edges;
analyze project_intelligence.graph_nodes;
"

impact_state=$(psql_exec db5-concurrency-impact-state "
  select state_revision
  from project_intelligence.project_workflows
  where project_id = '${project}'
")

# Воркерная дверь — `service_role`, не человеческая тестовая роль: гонка
# проверяется на том же пути, каким её реально вызовет воркер.
impact_call="begin;
set local role service_role;
select projectceo_m4_api.calculate_change_impact_policy_bound(
  '${project}',
  'd0000000-0000-4000-8000-000000000001'::uuid,
  ${impact_state},
  'db5-concurrent-impact'
);
commit;"

set +e
psql_exec db5-impact-a "${impact_call}" >"${tmpdir}/impact-a.out" 2>&1 &
pid_a=$!
psql_exec db5-impact-b "${impact_call}" >"${tmpdir}/impact-b.out" 2>&1 &
pid_b=$!
wait "${pid_a}"; status_a=$?
wait "${pid_b}"; status_b=$?
set -e

if [[ "${status_a}" != "0" || "${status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent M4 impact calculation failed"
  sed -n '1,160p' "${tmpdir}/impact-a.out" >&2
  sed -n '1,160p' "${tmpdir}/impact-b.out" >&2
  exit 1
fi

if [[ $(
  (rg -o '"replay": false' "${tmpdir}/impact-a.out" "${tmpdir}/impact-b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]] || [[ $(
  (rg -o '"replay": true' "${tmpdir}/impact-a.out" "${tmpdir}/impact-b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]]; then
  print -u2 -r -- "Concurrent M4 impact replay contract failed"
  sed -n '1,160p' "${tmpdir}/impact-a.out" >&2
  sed -n '1,160p' "${tmpdir}/impact-b.out" >&2
  exit 1
fi

impact_runs_count=$(psql_exec db5-impact-concurrency-assert "
  select count(*)::text
  from projectceo_m4.impact_runs run
  where run.project_id = '${project}'
    and run.change_request_id = 'd0000000-0000-4000-8000-000000000001'
")
if [[ "${impact_runs_count}" != "1" ]]; then
  print -u2 -r -- "Concurrent M4 impact run duplicated: ${impact_runs_count}"
  exit 1
fi

print -r -- "DB5_IMPACT_CONCURRENCY_OK"
