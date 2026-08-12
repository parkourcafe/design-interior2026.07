\set ON_ERROR_STOP on

-- V1 Impact: исполняемый benchmark политики обхода (DEC-033 LOCKED).
--
-- `maxDepth = 7` / `maxImpacts = 5000` больше НЕ выбираются этим прогоном:
-- OWNER GO 12.08.2026 зафиксировал их окончательно для V1 (DEC-033) —
-- следующее изменение возможно только новой версией политики, не повторным
-- benchmark. Роль этого файла сузилась соответственно: он больше не ищет
-- число, он ловит РЕГРЕССИЮ вокруг уже выбранного числа. Три вещи:
--
--   1. детерминированность — один и тот же граф даёт один и тот же
--      `resultHash` при пересчёте с нуля (SAVEPOINT/ROLLBACK, не replay);
--   2. отсутствие МОЛЧАЛИВОГО усечения — обход, упёршийся в глубину, обязан
--      прийти с `coverageStatus = 'partial_depth'` и
--      `hasMoreBeyondDepth = true`, а не тихо вернуть частичный список;
--   3. приемлемое время на РЕАЛЬНОЙ RPC — потолок щедрый и ловит катастрофу
--      вроде утраченного индекса, а не колебания стенда.
--
-- Точная проверка лимита 5000/5001 и вся матрица исходов
-- (complete/partial_depth/blocked_result_limit, включая совмещённое
-- срабатывание глубины и лимита) — не здесь: она требует управляемого
-- ТОЧНОГО количества узлов и живёт в `27_impact_coverage_outcomes.sql`, где
-- фикстуры для этого специально построены. Дублировать её тут значило бы
-- поддерживать две копии одной проверки.
--
-- ФИКСТУРА И ПОЧЕМУ ОНА ТАКАЯ. Золотой проект DB5 слишком мал, чтобы что-то
-- измерять. Поэтому в целевую версию графа досыпается ОДНА синтетическая
-- подсеть — ветвящееся дерево (branching factor 2, глубина политики 7), а НЕ
-- звезда: звезда кладёт все узлы на расстояние 1 и потому не может отличить
-- обход, уважающий глубину, от обхода, который её игнорирует (DEC-033 §8.5).
-- К последнему узлу глубины 7 подвешено два потомка глубины 8 — ровно
-- столько, сколько нужно, чтобы «есть что-то за границей» было истинным, без
-- полного ветвления восьмого уровня. Ссылочная целостность на время фикстуры
-- отключается: предметом проверки является стоимость обхода и его отчёт о
-- покрытии, а не цепочка baseline-ссылок.
--
-- Весь сценарий откатывается: следующие файлы DB5 обязаны видеть прежнее
-- состояние.

begin;

-- Ориентиры золотого проекта берутся из данных, а не переписываются
-- константой: иначе фикстура разъедется с `20_execution_operations.sql`
-- молча.
select
  cr.organization_id::text as org,
  cr.package_id::text as pkg,
  cr.from_production_package_version_id as from_version,
  cr.proposed_baseline_id as to_baseline,
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
\gset bench_

select set_config('projectceo.bench_org', :'bench_org', true);
select set_config('projectceo.bench_pkg', :'bench_pkg', true);
select set_config('projectceo.bench_from_version', :'bench_from_version', true);
select set_config('projectceo.bench_to_baseline', :'bench_to_baseline', true);
select set_config('projectceo.bench_graph_version', :'bench_graph_version', true);
select set_config('projectceo.bench_state_revision', :'bench_state_revision', true);

set local session_replication_role = replica;

do $bench_fixture$
declare
  v_org uuid := current_setting('projectceo.bench_org')::uuid;
  v_project uuid := '41111111-1111-4111-8111-111111111111';
  v_pkg uuid := current_setting('projectceo.bench_pkg')::uuid;
  v_version text := current_setting('projectceo.bench_graph_version');
  -- Полное branching-2 дерево ровно до глубины политики: далеко от лимита
  -- 5000 (2+4+...+2^7 = 254), поэтому здесь проверяется ИМЕННО глубина, а не
  -- совмещённое срабатывание с лимитом (это отдельная проверка в §27, где
  -- размер фикстуры управляем и специально подобран под 5000/5001).
  v_branching integer := 2;
  v_policy_depth integer := 7;
begin
  insert into project_intelligence.graph_nodes (
    organization_id, project_id, node_id, kind, stable_key, current_revision_id
  )
  select v_org, v_project, node_id, 'deliverable',
    'bench26:' || node_id, 'rev-' || node_id
  from (
    select 'bench26-tree-' || lpad(ordinal::text, 6, '0') node_id
    from generate_series(
      0, (power(v_branching, v_policy_depth + 1)::bigint - 1)
         / (v_branching - 1) - 1
    ) ordinal
    union all
    select 'bench26-beyond-' || lpad(leaf::text, 2, '0')
    from generate_series(1, 2) leaf
  ) nodes;

  insert into project_intelligence.version_nodes (
    organization_id, project_id, version_id, node_id, revision_id
  )
  select v_org, v_project, v_version, node.node_id, node.current_revision_id
  from project_intelligence.graph_nodes node
  where node.organization_id = v_org
    and node.project_id = v_project
    and node.node_id like 'bench26-%';

  -- Полное `v_branching`-арное дерево в массиве: у узла `i` родитель
  -- `(i - 1) / branching`. Обход идёт против зависимости (от изменённого узла
  -- к тем, что от него зависят), поэтому ребро направлено от потомка к
  -- родителю — родитель СТАНОВИТСЯ импактнутым, когда меняется потомок.
  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'bench26-edge-tree-' || lpad(ordinal::text, 6, '0'),
    'bench26-tree-' || lpad(ordinal::text, 6, '0'),
    'bench26-tree-' || lpad((((ordinal - 1) / v_branching))::text, 6, '0'),
    'depends_on'
  from generate_series(
    1, (power(v_branching, v_policy_depth + 1)::bigint - 1)
       / (v_branching - 1) - 1
  ) ordinal;

  -- Два узла глубины 8, подвешенные к ПЕРВОМУ узлу глубины 7 (первый лист
  -- полного дерева при этой нумерации). Достаточно, чтобы `hasMoreBeyondDepth`
  -- стало истинным без полного восьмого уровня (это утроило бы объём вставки
  -- без дополнительного смысла — глубина уже доказана седьмым уровнем).
  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'bench26-edge-beyond-' || lpad(leaf::text, 2, '0'),
    'bench26-beyond-' || lpad(leaf::text, 2, '0'),
    (
      select node.node_id
      from project_intelligence.graph_nodes node
      where node.organization_id = v_org
        and node.project_id = v_project
        and node.node_id like 'bench26-tree-%'
      order by node.node_id collate "C" desc
      limit 1
    ),
    'depends_on'
  from generate_series(1, 2) leaf;

  insert into project_intelligence.version_edges (
    organization_id, project_id, version_id, edge_id
  )
  select v_org, v_project, v_version, edge.edge_id
  from project_intelligence.graph_edges edge
  where edge.organization_id = v_org
    and edge.project_id = v_project
    and edge.edge_id like 'bench26-edge-%';

  -- Две заявки на ОДНОМ и том же корне (единственный узел глубины 0): первая
  -- Одна заявка: расчёт вызывается на ней ДВАЖДЫ (SAVEPOINT/ROLLBACK TO между
  -- вызовами) для проверки детерминированности — см. ниже, после фикстуры.
  insert into projectceo_m4.change_requests (
    organization_id, project_id, change_request_id, package_id,
    from_baseline_id, proposed_baseline_id, from_production_package_version_id,
    protected_reason, reason_digest, initiator_role, delta_cost_rub, delta_days,
    requested_by_user_id
  )
  -- `proposed_baseline_id` — РЕАЛЬНЫЙ golden baseline: `calculate_change_
  -- impact_policy_bound` резолвит `target_graph_version_id` через join на
  -- `project_baselines` именно по этому полю в момент вызова (не только при
  -- вставке), и синтетическое значение здесь дало бы `P1104 not_found` вместо
  -- измерения. `from_baseline_id` в теле RPC нигде не читается — ему можно
  -- оставаться синтетическим.
  select v_org, v_project, request.id, v_pkg,
    request.from_baseline,
    current_setting('projectceo.bench_to_baseline'),
    current_setting('projectceo.bench_from_version'),
    request.reason,
    pg_catalog.sha256(convert_to(request.reason, 'UTF8')),
    'architect', 0, 0,
    '31111111-1111-4111-8111-111111111111'
  from (values
    ('c6000000-0000-4000-8000-000000000001'::uuid, 'bench26-baseline-a', 'benchmark determinism request')
  ) request(id, from_baseline, reason);

  insert into projectceo_m4.change_request_roots (
    organization_id, project_id, change_request_id, package_id,
    from_baseline_id, proposed_baseline_id, target_kind, node_id,
    from_revision_id, to_revision_id
  )
  select v_org, v_project, root.id, v_pkg,
    root.from_baseline,
    current_setting('projectceo.bench_to_baseline'),
    'decision_revision', 'bench26-tree-000000',
    'rev-bench26-tree-000000-from',
    'rev-bench26-tree-000000'
  from (values
    ('c6000000-0000-4000-8000-000000000001'::uuid, 'bench26-baseline-a')
  ) root(id, from_baseline);
end
$bench_fixture$;

-- Фикстура собрана. Дальше — измерения и утверждения на НАСТОЯЩЕЙ RPC.
set local session_replication_role = origin;

-- Статистику надо пересобрать, иначе меряется не обход, а планировщик.
--
-- Первая редакция benchmark этого не делала и показала секунды при ЛЮБОЙ
-- глубине. Индексы обратного обхода при этом на месте
-- (`graph_edges_reverse_impact_idx`), просто планировщик не знал о только что
-- вставленных строках и выбирал перебор. Цифра была настоящей, но измеряла
-- отсутствие `analyze`, а не стоимость влияния.
analyze project_intelligence.graph_edges;
analyze project_intelligence.graph_nodes;
analyze project_intelligence.version_edges;
analyze project_intelligence.version_nodes;

-- Роль меняется здесь, на верхнем уровне транзакции, а не внутри
-- PL/pgSQL-блока ниже: `calculate_change_impact_policy_bound` — воркерная
-- дверь, выданная только `service_role`.
set local role service_role;

-- Детерминированность: ОДИН и тот же change_request_id считается ДВАЖДЫ с
-- нуля — не replay (идемпотентный кэш обязан быть выключен из уравнения) и не
-- сравнение двух РАЗНЫХ заявок (`resultHash` намеренно включает
-- `changeRequestId`, поэтому у двух разных заявок он всегда отличался бы,
-- даже на идентичном графе — это была бы проверка личности, а не алгоритма).
-- SAVEPOINT/ROLLBACK TO между вызовами отменяет ровно то, что записал первый
-- вызов (impact_runs, command_records, бамп state_revision), и второй вызов
-- считает граф заново с той же самой ожидаемой ревизией — настоящий повторный
-- расчёт, а не чтение из кэша идемпотентности.
savepoint determinism_probe;

select projectceo_m4_api.calculate_change_impact_policy_bound(
  '41111111-1111-4111-8111-111111111111',
  'c6000000-0000-4000-8000-000000000001'::uuid,
  current_setting('projectceo.bench_state_revision')::bigint,
  'db5-bench26-determinism'
) as first_response
\gset bench_

rollback to savepoint determinism_probe;

select clock_timestamp()::text as started_at \gset bench_

select projectceo_m4_api.calculate_change_impact_policy_bound(
  '41111111-1111-4111-8111-111111111111',
  'c6000000-0000-4000-8000-000000000001'::uuid,
  current_setting('projectceo.bench_state_revision')::bigint,
  'db5-bench26-determinism'
) as second_response
\gset bench_

select clock_timestamp()::text as ended_at \gset bench_

select set_config('projectceo.bench_first_response', :'bench_first_response', false);
select set_config('projectceo.bench_second_response', :'bench_second_response', false);
select set_config('projectceo.bench_started_at', :'bench_started_at', false);
select set_config('projectceo.bench_ended_at', :'bench_ended_at', false);

do $bench_assert$
declare
  v_first jsonb := current_setting('projectceo.bench_first_response')::jsonb;
  v_second jsonb := current_setting('projectceo.bench_second_response')::jsonb;
  v_elapsed_ms numeric := round(extract(epoch from (
    current_setting('projectceo.bench_ended_at')::timestamptz
    - current_setting('projectceo.bench_started_at')::timestamptz
  ))::numeric * 1000, 1);
begin
  -- 1. Детерминированность.
  if (v_first #>> '{result,resultHash}') is distinct from
     (v_second #>> '{result,resultHash}')
  then
    raise exception 'DB5_IMPACT_NOT_DETERMINISTIC:%<>%',
      v_first #>> '{result,resultHash}', v_second #>> '{result,resultHash}';
  end if;
  raise notice 'impact determinism: resultHash=% elapsed(second run)=% ms',
    v_second #>> '{result,resultHash}', v_elapsed_ms;

  -- 2. Отсутствие молчаливого усечения: обход обязан ЗНАТЬ, что он неполон, а
  --    не тихо вернуть то, что нашёл в границах.
  if (v_first #>> '{result,coverageStatus}') is distinct from 'partial_depth'
     or (v_first #>> '{result,hasMoreBeyondDepth}') is distinct from 'true'
     or (v_first #>> '{result,cutoffReason}') is distinct from 'depth_boundary'
  then
    raise exception 'DB5_IMPACT_TRUNCATION_NOT_SIGNALED:%', v_first;
  end if;
  -- Нижняя граница обязана быть СТРОГО больше возвращённого количества —
  -- ровно на единицу (DEC-033: она доказана, не оценена), не «примерно
  -- больше». Ошибка в этом инварианте — не таймаут, а дефект контракта.
  if (v_first #>> '{result,knownImpactCountLowerBound}')::integer <>
     (v_first #>> '{result,returnedImpactCount}')::integer + 1
  then
    raise exception 'DB5_IMPACT_LOWER_BOUND_INVALID:%', v_first;
  end if;

  -- 3. Время на РЕАЛЬНОЙ RPC. Потолок намеренно щедрый — он ловит катастрофу
  --    вроде утраченного индекса или возврата path-explosion, а не колебания
  --    стенда.
  if v_elapsed_ms > 3000 then
    raise exception 'DB5_IMPACT_POLICY_TOO_SLOW:% ms', v_elapsed_ms;
  end if;
end
$bench_assert$;

rollback;

select 'DB5_IMPACT_POLICY_BENCHMARK_OK' as result;
