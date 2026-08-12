\set ON_ERROR_STOP on

-- V1 Impact: точная граница 5000/5001 и приоритет лимита над глубиной
-- (DEC-034, коррекция над PR #94 поверх DEC-033 LOCKED).
--
-- `26_impact_policy_benchmark.sql` уже доказывает `blocked_result_limit` на
-- реальном широком графе (звезда 6000) как РЕГРЕССИЮ производительности и
-- формы ответа. Этот файл — про ТОЧНУЮ границу, которую тот файл сознательно
-- не проверяет:
--
--   1. ровно 5000 найденных влияний — НЕ блокирует, исход `complete`;
--   2. ровно 5001 — блокирует терминально: `returnedImpactCount=0`,
--      `knownImpactCountLowerBound=5001`, ничего не сохранено;
--   3. граф одновременно шире лимита И глубже политики — побеждает лимit, без
--      зонда глубины и без второго полного обхода;
--   4. заблокированная и завершённая заявки исчезают из очереди воркера
--      (`list_change_impact_backlog`) — расчёт уже состоялся, независимо от
--      исхода.
--
-- Сценарий откатывается целиком: следующие файлы DB5 обязаны видеть прежнее
-- состояние.

begin;

select
  cr.organization_id::text as org,
  cr.package_id::text as pkg,
  cr.from_baseline_id as from_baseline,
  cr.proposed_baseline_id as to_baseline,
  cr.from_production_package_version_id as from_version,
  pb.graph_version_id as graph_version,
  pw.state_revision::text as state_revision
from projectceo_m4.change_requests cr
join projectceo_product.project_baselines pb
  on pb.organization_id = cr.organization_id
 and pb.project_id = cr.project_id
 and pb.baseline_id = cr.proposed_baseline_id
join project_intelligence.project_workflows pw
  on pw.organization_id = cr.organization_id
 and pw.project_id = cr.project_id
where cr.project_id = '41111111-1111-4111-8111-111111111111'
order by cr.requested_at
limit 1
\gset cov34_

select set_config('projectceo.cov34_org', :'cov34_org', true);
select set_config('projectceo.cov34_pkg', :'cov34_pkg', true);
select set_config('projectceo.cov34_from_baseline', :'cov34_from_baseline', true);
select set_config('projectceo.cov34_to_baseline', :'cov34_to_baseline', true);
select set_config('projectceo.cov34_from_version', :'cov34_from_version', true);
select set_config('projectceo.cov34_graph_version', :'cov34_graph_version', true);
select set_config('projectceo.cov34_state_revision', :'cov34_state_revision', true);

set local session_replication_role = replica;

do $cov34_fixture$
declare
  v_org uuid := current_setting('projectceo.cov34_org')::uuid;
  v_project uuid := '41111111-1111-4111-8111-111111111111';
  v_pkg uuid := current_setting('projectceo.cov34_pkg')::uuid;
  v_version text := current_setting('projectceo.cov34_graph_version');
  -- Политика читается динамически (`_impact_policy()`), а не зашивается
  -- числом: хвост `v_tail_len` всегда на пять шагов длиннее живого maxDepth —
  -- граф «combined» одновременно шире лимита и глубже политики независимо от
  -- того, каким числом эта политика сейчас является.
  v_policy_depth integer :=
    (projectceo_m4._impact_policy() ->> 'maxDepth')::integer;
  v_tail_len integer;
begin
  v_tail_len := v_policy_depth + 5;

  -- Узлы: три звезды (5000, 5001 и combined-хаб) плюс хвост combined-графа.
  insert into project_intelligence.graph_nodes (
    organization_id, project_id, node_id, kind, stable_key, current_revision_id
  )
  select v_org, v_project, node_id, 'deliverable',
    'cov34:' || node_id, 'rev-' || node_id
  from (
    select 'cov34-5000-hub' node_id
    union all
    select 'cov34-5000-' || lpad(leaf::text, 6, '0')
    from generate_series(1, 5000) leaf
    union all
    select 'cov34-5001-hub'
    union all
    select 'cov34-5001-' || lpad(leaf::text, 6, '0')
    from generate_series(1, 5001) leaf
    union all
    select 'cov34-combined-hub'
    union all
    select 'cov34-combined-leaf-' || lpad(leaf::text, 6, '0')
    from generate_series(1, 5001) leaf
    union all
    select 'cov34-combined-tail-' || lpad(step::text, 4, '0')
    from generate_series(1, v_tail_len) step
  ) nodes;

  insert into project_intelligence.version_nodes (
    organization_id, project_id, version_id, node_id, revision_id
  )
  select v_org, v_project, v_version, node.node_id, node.current_revision_id
  from project_intelligence.graph_nodes node
  where node.organization_id = v_org
    and node.project_id = v_project
    and node.node_id like 'cov34-%';

  -- Обход идёт против зависимости (`to_node_id` = текущий узел), как в
  -- `26_impact_policy_benchmark.sql`.
  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'cov34-edge-5000-' || lpad(leaf::text, 6, '0'),
    'cov34-5000-' || lpad(leaf::text, 6, '0'),
    'cov34-5000-hub',
    'depends_on'
  from generate_series(1, 5000) leaf;

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'cov34-edge-5001-' || lpad(leaf::text, 6, '0'),
    'cov34-5001-' || lpad(leaf::text, 6, '0'),
    'cov34-5001-hub',
    'depends_on'
  from generate_series(1, 5001) leaf;

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'cov34-edge-combined-leaf-' || lpad(leaf::text, 6, '0'),
    'cov34-combined-leaf-' || lpad(leaf::text, 6, '0'),
    'cov34-combined-hub',
    'depends_on'
  from generate_series(1, 5001) leaf;

  -- Хвост: цепочка длиной v_tail_len, привязанная к хабу combined-графа.
  -- Первое звено хвоста висит на хабе; дальше — обычная цепочка.
  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'cov34-edge-combined-tail-' || lpad(step::text, 4, '0'),
    'cov34-combined-tail-' || lpad(step::text, 4, '0'),
    case when step = 1 then 'cov34-combined-hub'
         else 'cov34-combined-tail-' || lpad((step - 1)::text, 4, '0') end,
    'depends_on'
  from generate_series(1, v_tail_len) step;

  insert into project_intelligence.version_edges (
    organization_id, project_id, version_id, edge_id
  )
  select v_org, v_project, v_version, edge.edge_id
  from project_intelligence.graph_edges edge
  where edge.organization_id = v_org
    and edge.project_id = v_project
    and edge.edge_id like 'cov34-edge-%';

  insert into projectceo_m4.change_requests (
    organization_id, project_id, change_request_id, package_id,
    from_baseline_id, proposed_baseline_id, from_production_package_version_id,
    protected_reason, reason_digest, initiator_role, delta_cost_rub, delta_days,
    requested_by_user_id
  )
  select v_org, v_project, request.id, v_pkg,
    request.from_baseline,
    current_setting('projectceo.cov34_to_baseline'),
    current_setting('projectceo.cov34_from_version'),
    request.reason,
    pg_catalog.sha256(convert_to(request.reason, 'UTF8')),
    'architect', 0, 0,
    '31111111-1111-4111-8111-111111111111'
  from (values
    ('c0000000-0000-4000-8000-000000005000'::uuid, 'cov34-baseline-5000', 'DEC-034 exact boundary: 5000'),
    ('c0000000-0000-4000-8000-000000005001'::uuid, 'cov34-baseline-5001', 'DEC-034 exact boundary: 5001'),
    ('c0000000-0000-4000-8000-00000000c0cb'::uuid, 'cov34-baseline-combined', 'DEC-034 combined cutoff priority')
  ) request(id, from_baseline, reason);

  insert into projectceo_m4.change_request_roots (
    organization_id, project_id, change_request_id, package_id,
    from_baseline_id, proposed_baseline_id, target_kind, node_id,
    from_revision_id, to_revision_id
  )
  select v_org, v_project, root.id, v_pkg,
    root.from_baseline,
    current_setting('projectceo.cov34_to_baseline'),
    'decision_revision', root.node_id,
    'rev-' || root.node_id || '-from',
    'rev-' || root.node_id
  from (values
    ('c0000000-0000-4000-8000-000000005000'::uuid, 'cov34-baseline-5000', 'cov34-5000-hub'),
    ('c0000000-0000-4000-8000-000000005001'::uuid, 'cov34-baseline-5001', 'cov34-5001-hub'),
    ('c0000000-0000-4000-8000-00000000c0cb'::uuid, 'cov34-baseline-combined', 'cov34-combined-hub')
  ) root(id, from_baseline, node_id);
end
$cov34_fixture$;

set local session_replication_role = origin;

analyze project_intelligence.graph_edges;
analyze project_intelligence.graph_nodes;
analyze project_intelligence.version_edges;
analyze project_intelligence.version_nodes;

-- Прямое чтение таблиц модуля недоступно `service_role` (приватная схема,
-- доступ только через security definer RPC) — поэтому вызов RPC и проверка
-- сохранённой строки разнесены по ролям: `service_role` вызывает, `reset
-- role` (суперпользователь стенда) читает. Тот же приём, что в
-- `26_impact_policy_benchmark.sql` и `27_impact_coverage_outcomes.sql` этой
-- же серии файлов.

set local role service_role;

-- 1. Ровно 5000 — НЕ блокирует. Единственная безопасная сторона границы:
--    строго БОЛЬШЕ лимита, не больше-или-равно.
do $cov34_exactly_5000$
declare
  v_response jsonb;
begin
  v_response := projectceo_m4_api.calculate_change_impact_policy_bound(
    '41111111-1111-4111-8111-111111111111',
    'c0000000-0000-4000-8000-000000005000'::uuid,
    current_setting('projectceo.cov34_state_revision')::bigint,
    'db5-cov34-exactly-5000'
  );
  if (v_response #>> '{result,coverageStatus}') is distinct from 'complete' then
    raise exception 'DB5_COV34_5000_NOT_COMPLETE:%',
      v_response #>> '{result,coverageStatus}';
  end if;
  if (v_response #>> '{result,returnedImpactCount}')::integer <> 5000 then
    raise exception 'DB5_COV34_5000_COUNT_UNEXPECTED:%',
      v_response #>> '{result,returnedImpactCount}';
  end if;
  if (v_response #>> '{result,knownImpactCountLowerBound}')::integer <> 5000 then
    raise exception 'DB5_COV34_5000_LOWER_BOUND_UNEXPECTED:%',
      v_response #>> '{result,knownImpactCountLowerBound}';
  end if;
  if (v_response #>> '{result,hasMoreBeyondDepth}') is distinct from 'false' then
    raise exception 'DB5_COV34_5000_HAS_MORE_UNEXPECTED:%',
      v_response #>> '{result,hasMoreBeyondDepth}';
  end if;

  -- Каждый прогон завершения команды двигает `state_revision` ровно на один
  -- шаг. Следующему вызову нужна ТЕКУЩАЯ ревизия, а прочитать её из таблицы
  -- эта роль не может — поэтому она берётся из ответа предыдущей команды и
  -- передаётся дальше через `set_config`, ровно как ходит настоящий воркер.
  perform set_config(
    'projectceo.cov34_state_revision', v_response ->> 'stateRevision', true
  );
end
$cov34_exactly_5000$;

-- 2. Ровно 5001 — блокирует терминально. Ничего не сохранено.
do $cov34_exactly_5001$
declare
  v_response jsonb;
begin
  v_response := projectceo_m4_api.calculate_change_impact_policy_bound(
    '41111111-1111-4111-8111-111111111111',
    'c0000000-0000-4000-8000-000000005001'::uuid,
    current_setting('projectceo.cov34_state_revision')::bigint,
    'db5-cov34-exactly-5001'
  );
  if (v_response #>> '{result,coverageStatus}') is distinct from 'blocked_result_limit' then
    raise exception 'DB5_COV34_5001_NOT_BLOCKED:%',
      v_response #>> '{result,coverageStatus}';
  end if;
  if (v_response #>> '{result,cutoffReason}') is distinct from 'result_limit' then
    raise exception 'DB5_COV34_5001_WRONG_REASON:%',
      v_response #>> '{result,cutoffReason}';
  end if;
  if (v_response #>> '{result,returnedImpactCount}')::integer <> 0 then
    raise exception 'DB5_COV34_5001_COUNT_NOT_ZERO:%',
      v_response #>> '{result,returnedImpactCount}';
  end if;
  if (v_response #>> '{result,knownImpactCountLowerBound}')::integer <> 5001 then
    raise exception 'DB5_COV34_5001_LOWER_BOUND_UNEXPECTED:%',
      v_response #>> '{result,knownImpactCountLowerBound}';
  end if;

  perform set_config(
    'projectceo.cov34_state_revision', v_response ->> 'stateRevision', true
  );
end
$cov34_exactly_5001$;

-- 3. Совмещённый срез: граф одновременно шире лимита (5001 в одном хабе) И
--    глубже политики (хвост длиннее maxDepth). Побеждает лимит — тот же
--    терминальный blocked_result_limit, не partial_depth. Второй проверки на
--    независимость от порядка не нужно: приоритет живёт в самой RPC
--    (короткое замыкание ДО зонда глубины), а не в порядке вызовов теста.
do $cov34_combined_cutoff$
declare
  v_response jsonb;
begin
  v_response := projectceo_m4_api.calculate_change_impact_policy_bound(
    '41111111-1111-4111-8111-111111111111',
    'c0000000-0000-4000-8000-00000000c0cb'::uuid,
    current_setting('projectceo.cov34_state_revision')::bigint,
    'db5-cov34-combined-cutoff'
  );
  if (v_response #>> '{result,coverageStatus}') is distinct from 'blocked_result_limit' then
    raise exception 'DB5_COV34_COMBINED_NOT_BLOCKED:%',
      v_response #>> '{result,coverageStatus}';
  end if;
  if (v_response #>> '{result,cutoffReason}') is distinct from 'result_limit' then
    raise exception 'DB5_COV34_COMBINED_WRONG_REASON:%',
      v_response #>> '{result,cutoffReason}';
  end if;
  if (v_response #>> '{result,returnedImpactCount}')::integer <> 0 then
    raise exception 'DB5_COV34_COMBINED_COUNT_NOT_ZERO:%',
      v_response #>> '{result,returnedImpactCount}';
  end if;
end
$cov34_combined_cutoff$;

-- 4. Все три заявки посчитаны — все три исчезли из очереди воркера. Расчёт
--    уже состоялся, независимо от исхода: заблокированная не возвращается на
--    повторную попытку так же, как завершённая.
do $cov34_backlog_excludes_calculated$
declare
  v_backlog jsonb;
  v_leaked text;
begin
  v_backlog := projectceo_m4_api.list_change_impact_backlog(1000);
  select item ->> 'changeRequestId' into v_leaked
  from jsonb_array_elements(v_backlog -> 'data') item
  where item ->> 'changeRequestId' in (
    'c0000000-0000-4000-8000-000000005000',
    'c0000000-0000-4000-8000-000000005001',
    'c0000000-0000-4000-8000-00000000c0cb'
  )
  limit 1;
  if v_leaked is not null then
    raise exception 'DB5_COV34_CALCULATED_REQUEST_STILL_IN_BACKLOG:%', v_leaked;
  end if;
end
$cov34_backlog_excludes_calculated$;

-- 5. Персистентность на настоящих таблицах, а не только в ответе RPC:
--    5000 — сохранено ровно столько; 5001 и combined — ноль строк в обоих
--    (`impact_runs`-инвариант это тоже требует, но проверяется здесь фактом,
--    а не доверием к constraint).
reset role;

do $cov34_persisted_shape$
declare
  v_run record;
  v_stored integer;
begin
  select count(*) into v_stored
  from projectceo_m4.impacts impact
  where impact.project_id = '41111111-1111-4111-8111-111111111111'
    and impact.change_request_id = 'c0000000-0000-4000-8000-000000005000'::uuid;
  if v_stored <> 5000 then
    raise exception 'DB5_COV34_5000_STORED_UNEXPECTED:%', v_stored;
  end if;

  select run.coverage_status, run.returned_impact_count,
         run.known_impact_count_lower_bound
  into v_run
  from projectceo_m4.impact_runs run
  where run.project_id = '41111111-1111-4111-8111-111111111111'
    and run.change_request_id = 'c0000000-0000-4000-8000-000000005001'::uuid;
  if not found or v_run.coverage_status is distinct from 'blocked_result_limit'
     or v_run.returned_impact_count <> 0
     or v_run.known_impact_count_lower_bound <> 5001 then
    raise exception 'DB5_COV34_5001_ROW_SHAPE_UNEXPECTED';
  end if;

  select count(*) into v_stored
  from projectceo_m4.impacts impact
  where impact.project_id = '41111111-1111-4111-8111-111111111111'
    and impact.change_request_id = 'c0000000-0000-4000-8000-000000005001'::uuid;
  if v_stored <> 0 then
    raise exception 'DB5_COV34_5001_STORED_NOT_ZERO:%', v_stored;
  end if;

  select count(*) into v_stored
  from projectceo_m4.impacts impact
  where impact.project_id = '41111111-1111-4111-8111-111111111111'
    and impact.change_request_id = 'c0000000-0000-4000-8000-00000000c0cb'::uuid;
  if v_stored <> 0 then
    raise exception 'DB5_COV34_COMBINED_STORED_NOT_ZERO:%', v_stored;
  end if;
end
$cov34_persisted_shape$;

rollback;

select 'DB5_IMPACT_COVERAGE_DEC034_OK' as result;
