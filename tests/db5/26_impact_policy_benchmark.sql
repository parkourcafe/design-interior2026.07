\set ON_ERROR_STOP on

-- V1 Impact: исполняемый benchmark политики обхода.
--
-- Значение `maxDepth` в `projectceo_m4._impact_policy()` выбирается ЭТИМ
-- прогоном, а не на глаз. Решение владельца от 11.08.2026 требует проверить
-- ровно четыре вещи, и все четыре проверяются здесь вызовами:
--
--   1. детерминированность — один и тот же граф даёт один и тот же результат;
--   2. отсутствие МОЛЧАЛИВОГО усечения — обход, упёршийся в глубину, обязан
--      быть отличим от обхода, который дошёл до конца;
--   3. лимит 5000 impacts — он существует в `calculate_change_impact`
--      (`IMPACT_RESULT_LIMIT_EXCEEDED`) и обязан срабатывать, а не быть
--      декларацией;
--   4. приемлемое время — измеряется и имеет потолок, иначе «приемлемое»
--      означало бы «никто не смотрел».
--
-- ФИКСТУРА И ПОЧЕМУ ОНА ТАКАЯ. Золотой проект DB5 слишком мал, чтобы что-то
-- измерять: на нём любая глубина отработает мгновенно и ничего не докажет.
-- Поэтому в целевую версию графа досыпаются две синтетические подсети —
-- цепочка известной длины (для глубины и усечения) и звезда известной ширины
-- (для лимита). Ссылочная целостность на время фикстуры отключается: предметом
-- проверки является стоимость обхода, а не цепочка baseline-ссылок, и собирать
-- её целиком значило бы измерять заодно то, что измеряется в другом месте.
--
-- Весь сценарий откатывается: следующие файлы DB5 обязаны видеть прежнее
-- состояние.

begin;

-- Ориентиры золотого проекта берутся из данных, а не переписываются константой:
-- иначе фикстура разъедется с `20_execution_operations.sql` молча.
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
\gset bench_

select set_config('projectceo.bench_org', :'bench_org', true);
select set_config('projectceo.bench_pkg', :'bench_pkg', true);
select set_config('projectceo.bench_from_baseline', :'bench_from_baseline', true);
select set_config('projectceo.bench_to_baseline', :'bench_to_baseline', true);
select set_config('projectceo.bench_from_version', :'bench_from_version', true);
select set_config('projectceo.bench_graph_version', :'bench_graph_version', true);
select set_config('projectceo.bench_state_revision', :'bench_state_revision', true);

set local session_replication_role = replica;

do $bench_fixture$
declare
  v_org uuid := current_setting('projectceo.bench_org')::uuid;
  v_project uuid := '41111111-1111-4111-8111-111111111111';
  v_pkg uuid := current_setting('projectceo.bench_pkg')::uuid;
  v_version text := current_setting('projectceo.bench_graph_version');
  -- Цепочка длиннее любой правдоподобной политики: только на такой видно, что
  -- усечение обнаруживается, а не угадывается.
  v_chain_len integer := 14;
  -- Звезда шире лимита: 6000 > 5000, значит лимит обязан сработать.
  v_star_width integer := 6000;
  -- Ветвящееся дерево — единственная фигура, на которой глубина ЧТО-ТО стоит.
  -- На звезде всё лежит на расстоянии 1, и профиль по глубине получается
  -- плоским: он измеряет ширину, а не глубину. Первая редакция benchmark мерила
  -- именно её и потому ничего не говорила о выборе `maxDepth`.
  v_tree_branching integer := 3;
  v_tree_depth integer := 8;
begin
  insert into project_intelligence.graph_nodes (
    organization_id, project_id, node_id, kind, stable_key, current_revision_id
  )
  select v_org, v_project, node_id, 'deliverable',
    'bench:' || node_id, 'rev-' || node_id
  from (
    select 'bench-chain-' || lpad(step::text, 4, '0') node_id
    from generate_series(0, v_chain_len) step
    union all
    select 'bench-star-hub'
    union all
    select 'bench-star-' || lpad(leaf::text, 6, '0')
    from generate_series(1, v_star_width) leaf
    union all
    select 'bench-tree-' || lpad(ordinal::text, 6, '0')
    from generate_series(
      0, (power(v_tree_branching, v_tree_depth + 1)::bigint - 1)
         / (v_tree_branching - 1) - 1
    ) ordinal
  ) nodes;

  insert into project_intelligence.version_nodes (
    organization_id, project_id, version_id, node_id, revision_id
  )
  select v_org, v_project, v_version, node.node_id, node.current_revision_id
  from project_intelligence.graph_nodes node
  where node.organization_id = v_org
    and node.project_id = v_project
    and node.node_id like 'bench-%';

  -- Направление рёбер соответствует обходу: он идёт от изменённого узла ПРОТИВ
  -- зависимости, то есть ищет рёбра, у которых `to_node_id` — текущий узел.
  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'bench-edge-chain-' || lpad(step::text, 4, '0'),
    'bench-chain-' || lpad(step::text, 4, '0'),
    'bench-chain-' || lpad((step - 1)::text, 4, '0'),
    'depends_on'
  from generate_series(1, v_chain_len) step;

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'bench-edge-star-' || lpad(leaf::text, 6, '0'),
    'bench-star-' || lpad(leaf::text, 6, '0'),
    'bench-star-hub',
    'depends_on'
  from generate_series(1, v_star_width) leaf;

  -- Полное `v_tree_branching`-арное дерево в массиве: у узла `i` родитель
  -- `(i - 1) / branching`. Обход идёт против зависимости, поэтому ребро
  -- направлено от потомка к родителю.
  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'bench-edge-tree-' || lpad(ordinal::text, 6, '0'),
    'bench-tree-' || lpad(ordinal::text, 6, '0'),
    'bench-tree-' || lpad((((ordinal - 1) / v_tree_branching))::text, 6, '0'),
    'depends_on'
  from generate_series(
    1, (power(v_tree_branching, v_tree_depth + 1)::bigint - 1)
       / (v_tree_branching - 1) - 1
  ) ordinal;

  insert into project_intelligence.version_edges (
    organization_id, project_id, version_id, edge_id
  )
  select v_org, v_project, v_version, edge.edge_id
  from project_intelligence.graph_edges edge
  where edge.organization_id = v_org
    and edge.project_id = v_project
    and edge.edge_id like 'bench-edge-%';

  -- Две заявки: одна корнем на цепочке, другая на ступице звезды.
  insert into projectceo_m4.change_requests (
    organization_id, project_id, change_request_id, package_id,
    from_baseline_id, proposed_baseline_id, from_production_package_version_id,
    protected_reason, reason_digest, initiator_role, delta_cost_rub, delta_days,
    requested_by_user_id
  )
  -- `m4_change_request_transition_key` держит уникальность перехода
  -- (пакет, from → proposed). Золотая заявка этот переход уже занимает,
  -- поэтому у синтетических свой `from_baseline_id`; `proposed_baseline_id`
  -- остаётся настоящим — по нему разрешается целевая версия графа.
  select v_org, v_project, request.id, v_pkg,
    request.from_baseline,
    current_setting('projectceo.bench_to_baseline'),
    current_setting('projectceo.bench_from_version'),
    request.reason,
    pg_catalog.sha256(convert_to(request.reason, 'UTF8')),
    'architect', 0, 0,
    '31111111-1111-4111-8111-111111111111'
  from (values
    ('b0000000-0000-4000-8000-0000000000c1'::uuid, 'bench-baseline-chain', 'benchmark chain request'),
    ('b0000000-0000-4000-8000-00000000057a'::uuid, 'bench-baseline-star', 'benchmark star request'),
    ('b0000000-0000-4000-8000-000000000432'::uuid, 'bench-baseline-tree', 'benchmark tree request')
  ) request(id, from_baseline, reason);

  insert into projectceo_m4.change_request_roots (
    organization_id, project_id, change_request_id, package_id,
    from_baseline_id, proposed_baseline_id, target_kind, node_id,
    from_revision_id, to_revision_id
  )
  select v_org, v_project, root.id, v_pkg,
    root.from_baseline,
    current_setting('projectceo.bench_to_baseline'),
    'decision_revision', root.node_id,
    'rev-' || root.node_id || '-from',
    'rev-' || root.node_id
  from (values
    ('b0000000-0000-4000-8000-0000000000c1'::uuid, 'bench-baseline-chain', 'bench-chain-0000'),
    ('b0000000-0000-4000-8000-00000000057a'::uuid, 'bench-baseline-star', 'bench-star-hub'),
    ('b0000000-0000-4000-8000-000000000432'::uuid, 'bench-baseline-tree', 'bench-tree-000000')
  ) root(id, from_baseline, node_id);
end
$bench_fixture$;

-- Фикстура собрана. Дальше — измерения и утверждения на НАСТОЯЩИХ функциях.
set local session_replication_role = origin;

-- Статистику надо пересобрать, иначе меряется не обход, а планировщик.
--
-- Первая редакция benchmark этого не делала и показала 4-5 секунд на звезде
-- при ЛЮБОЙ глубине. Индексы обратного обхода при этом на месте
-- (`graph_edges_reverse_impact_idx`), просто планировщик не знал о только что
-- вставленных 6000 строках и выбирал перебор. Цифра была настоящей, но
-- измеряла отсутствие `analyze`, а не стоимость влияния.
analyze project_intelligence.graph_edges;
analyze project_intelligence.graph_nodes;
analyze project_intelligence.version_edges;
analyze project_intelligence.version_nodes;

do $bench_measure$
declare
  v_org uuid := current_setting('projectceo.bench_org')::uuid;
  v_project uuid := '41111111-1111-4111-8111-111111111111';
  v_version text := current_setting('projectceo.bench_graph_version');
  v_chain uuid := 'b0000000-0000-4000-8000-0000000000c1';
  v_star uuid := 'b0000000-0000-4000-8000-00000000057a';
  v_tree uuid := 'b0000000-0000-4000-8000-000000000432';
  v_policy jsonb := projectceo_m4._impact_policy();
  v_policy_depth integer := (v_policy ->> 'maxDepth')::integer;
  v_depth integer;
  v_started timestamptz;
  v_elapsed_ms numeric;
  v_pairs bigint;
  v_first bigint;
  v_second bigint;
  v_within bigint;
  v_deeper bigint;
  v_policy_ms numeric;
begin
  raise notice 'impact policy: %', v_policy;

  -- 1. Профиль стоимости по глубине на ВЕТВЯЩЕМСЯ дереве (3 потомка, 8
  --    уровней, ~9840 узлов). Печатается всегда: число в политике обязано быть
  --    объяснимо этими строками, а не устной договорённостью. Здесь же видно,
  --    на какой глубине результат перестаёт помещаться в лимит 5000.
  for v_depth in 1..10 loop
    v_started := clock_timestamp();
    v_pairs := projectceo_m4._impact_pair_count(
      v_org, v_project, v_tree, v_version, v_depth
    );
    v_elapsed_ms := round(
      extract(epoch from clock_timestamp() - v_started)::numeric * 1000, 1
    );
    raise notice 'tree depth % : pairs=% elapsed=% ms',
      lpad(v_depth::text, 2), lpad(v_pairs::text, 5), v_elapsed_ms;
  end loop;

  -- И ширина отдельно: звезда 6000 на глубине политики. Она проверяет, что
  -- широкий граф не становится дороже глубокого.
  v_started := clock_timestamp();
  v_pairs := projectceo_m4._impact_pair_count(
    v_org, v_project, v_star, v_version, v_policy_depth
  );
  raise notice 'star width 6000 at policy depth % : pairs=% elapsed=% ms',
    v_policy_depth, v_pairs,
    round(extract(epoch from clock_timestamp() - v_started)::numeric * 1000, 1);

  -- 2. Детерминированность: тот же граф, тот же ответ.
  v_first := projectceo_m4._impact_pair_count(
    v_org, v_project, v_chain, v_version, v_policy_depth
  );
  v_second := projectceo_m4._impact_pair_count(
    v_org, v_project, v_chain, v_version, v_policy_depth
  );
  if v_first <> v_second then
    raise exception 'DB5_IMPACT_NOT_DETERMINISTIC:%<>%', v_first, v_second;
  end if;

  -- 3. Усечение обнаруживается. Цепочка длиной 14 заведомо длиннее политики,
  --    поэтому на глубине политики обход обязан видеть меньше, чем на шаг
  --    глубже.
  v_within := v_first;
  v_deeper := projectceo_m4._impact_pair_count(
    v_org, v_project, v_chain, v_version, v_policy_depth + 1
  );
  if v_within <> v_policy_depth then
    raise exception 'DB5_IMPACT_CHAIN_DEPTH_UNEXPECTED:%', v_within;
  end if;
  if v_deeper <= v_within then
    raise exception 'DB5_IMPACT_TRUNCATION_NOT_DETECTED:%/%', v_within, v_deeper;
  end if;

  -- ...и НЕ обнаруживается там, где обход дошёл до конца. Иначе проверка
  -- ловила бы не усечение, а просто «глубже больше».
  if projectceo_m4._impact_pair_count(v_org, v_project, v_chain, v_version, 15)
     <> projectceo_m4._impact_pair_count(v_org, v_project, v_chain, v_version, 16)
  then
    raise exception 'DB5_IMPACT_FALSE_TRUNCATION_AT_FULL_DEPTH';
  end if;

  -- 4. Время на глубине политики. Потолок намеренно щедрый — он ловит
  --    катастрофу вроде утраченного индекса, а не колебания стенда.
  v_started := clock_timestamp();
  perform projectceo_m4._impact_pair_count(
    v_org, v_project, v_star, v_version, v_policy_depth
  );
  v_policy_ms := round(
    extract(epoch from clock_timestamp() - v_started)::numeric * 1000, 1
  );
  raise notice 'policy depth % on 6000-wide star: % ms', v_policy_depth, v_policy_ms;
  -- Потолок держится на порядок ниже прежнего: со свежей статистикой обход
  -- укладывается в десятки миллисекунд, и секунда здесь означала бы утраченный
  -- индекс, а не медленный стенд.
  if v_policy_ms > 1000 then
    raise exception 'DB5_IMPACT_POLICY_TOO_SLOW:% ms', v_policy_ms;
  end if;
end
$bench_measure$;

-- 5. Лимит 5000 — не декларация. Звезда шириной 6000 обязана его пробить, и
--    пробить ИМЕННО в настоящей RPC, а не в проверочном запросе рядом.
do $bench_limit$
begin
  begin
    perform projectceo_m4_api.calculate_change_impact(
      '41111111-1111-4111-8111-111111111111',
      'b0000000-0000-4000-8000-00000000057a'::uuid,
      (projectceo_m4._impact_policy() ->> 'maxDepth')::integer,
      current_setting('projectceo.bench_state_revision')::bigint,
      'db5-bench-star-limit'
    );
    raise exception 'DB5_IMPACT_RESULT_LIMIT_NOT_ENFORCED';
  exception when sqlstate 'P1111' then null;
  end;
end
$bench_limit$;

-- 6. Дверь воркера отказывается считать усечённое влияние — и говорит, почему.
do $bench_policy_bound$
declare
  v_detail text;
begin
  begin
    perform projectceo_m4_api.calculate_change_impact_policy_bound(
      '41111111-1111-4111-8111-111111111111',
      'b0000000-0000-4000-8000-0000000000c1'::uuid,
      current_setting('projectceo.bench_state_revision')::bigint,
      'db5-bench-chain-truncated'
    );
    raise exception 'DB5_IMPACT_TRUNCATION_NOT_REFUSED';
  exception when sqlstate 'P1111' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail::jsonb ->> 'reason' is distinct from 'IMPACT_DEPTH_TRUNCATED' then
      raise exception 'DB5_IMPACT_TRUNCATION_WRONG_REASON:%', v_detail;
    end if;
  end;
end
$bench_policy_bound$;

rollback;

select 'DB5_IMPACT_POLICY_BENCHMARK_OK' as result;
