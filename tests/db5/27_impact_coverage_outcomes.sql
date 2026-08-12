\set ON_ERROR_STOP on

-- V1 Impact: полная матрица исходов покрытия (DEC-033 LOCKED).
--
-- `26_impact_policy_benchmark.sql` доказывает, что обход детерминирован,
-- честно сигналит усечение и укладывается во время. Этот файл доказывает
-- КОНТРАКТ трёх исходов дословно — то, ради чего DEC-033 вообще существует:
--
--   * complete — обход исчерпан РОВНО на границе глубины политики;
--   * partial_depth — обход упёрся в глубину, и это отличимо от завершения
--     полем, а не догадкой;
--   * blocked_result_limit — превышение 5000 РОВНО на границе (5000 не
--     блокирует, 5001 блокирует durable-терминально), и при одновременном
--     срабатывании глубины и лимита побеждает лимит.
--
-- Плюс всё остальное, что делает эти три исхода КОНТРАКТОМ, а не тремя
-- отдельными ветками кода: покрытие входит в digest и переживает replay;
-- terminal outcome неизменяем (append-only); один сломанный ChangeRequest не
-- блокирует остальную очередь и уходит в durable dead-letter после
-- исчерпанных попыток, а redrive его возвращает; просмотр ВСЕХ показанных
-- карточек partial-результата не делает ревью полным; blocked-исход исчезает
-- из очереди воркера.
--
-- ФИКСТУРЫ. Ветвящиеся деревья и двухуровневые "мётлы" (два уровня fan-out,
-- НЕ один хаб — иначе это была бы звезда), а не звёзды: чистая звезда кладёт
-- все узлы на расстояние 1 и не может отличить обход, уважающий глубину, от
-- обхода, который её игнорирует. Точные количества для границ 5000/5001
-- собраны арифметикой fan-out, а не подобраны на глаз. Ссылочная целостность
-- на время вставки отключается (`session_replication_role = replica`) — тем
-- же приёмом, что и в `26_...`.
--
-- Весь сценарий откатывается одним `rollback` в конце: следующие файлы DB5
-- обязаны видеть прежнее состояние. Исключение — увидеть НЕ прежнее состояние
-- обязан сам этот файл: каждая секция строит и проверяет свою фикстуру внутри
-- одной и той же открытой транзакции, поэтому идентификаторы узлов и заявок
-- у секций непересекающиеся (`cov27-...` + отдельный префикс на секцию).

begin;

select
  cr.organization_id::text as org,
  cr.package_id::text as pkg,
  cr.from_production_package_version_id as from_version,
  cr.proposed_baseline_id as to_baseline,
  pb.graph_version_id as graph_version
from projectceo_m4.change_requests cr
join projectceo_product.project_baselines pb
  on pb.organization_id = cr.organization_id
 and pb.project_id = cr.project_id
 and pb.baseline_id = cr.proposed_baseline_id
where cr.project_id = '41111111-1111-4111-8111-111111111111'
order by cr.requested_at
limit 1
\gset cov_

select set_config('projectceo.cov_org', :'cov_org', false);
select set_config('projectceo.cov_pkg', :'cov_pkg', false);
select set_config('projectceo.cov_from_version', :'cov_from_version', false);
select set_config('projectceo.cov_to_baseline', :'cov_to_baseline', false);
select set_config('projectceo.cov_graph_version', :'cov_graph_version', false);

-- ═══════════════════════════════════════════════════════════════════════════
-- Фикстуры: один PL/pgSQL-блок строит ВСЕ синтетические подсети сразу.
-- ═══════════════════════════════════════════════════════════════════════════
set local session_replication_role = replica;

do $cov_fixture$
declare
  v_org uuid := current_setting('projectceo.cov_org')::uuid;
  v_project uuid := '41111111-1111-4111-8111-111111111111';
  v_pkg uuid := current_setting('projectceo.cov_pkg')::uuid;
  v_version text := current_setting('projectceo.cov_graph_version');
  v_from_version text := current_setting('projectceo.cov_from_version');
  v_to_baseline text := current_setting('projectceo.cov_to_baseline');
begin
  -- ── Узлы и рёбра ══════════════════════════════════════════════════════
  --
  -- chain7   — ровно 7 узлов, цепочка (branching 1): completion РОВНО на
  --            границе глубины политики (`maxDepth = 7`), ничего за ней.
  -- chain10  — 10 узлов, цепочка: partial_depth, граница отличима от конца.
  -- d5000    — двухуровневая метла (50 + 4950 = 5000 в границе глубины,
  --            ничего глубже): 5000 НЕ блокирует.
  -- d5001    — та же форма, 50 + 4951 = 5001: блокирует.
  -- combined — 50 + 5000 в границе (заведомо больше 5000) ПЛЮС цепочка из
  --            8 добавочных шагов от одного узла второго уровня (значит есть
  --            узлы и на глубине 8+): совмещённое срабатывание.
  -- poison-valid  — один узел на расстоянии 1: заведомо годная заявка рядом
  --                 со сломанной, чтобы доказать «одна сломанная не блокирует
  --                 очередь».
  -- poison-broken — заявка с несуществующим `proposed_baseline_id`: RPC
  --                 обязана ответить `P1104`, а не тихо посчитать пусто.
  insert into project_intelligence.graph_nodes (
    organization_id, project_id, node_id, kind, stable_key, current_revision_id
  )
  select v_org, v_project, node_id, 'deliverable', 'cov27:' || node_id,
    'rev-' || node_id
  from (
    select 'cov27-chain7-' || lpad(step::text, 2, '0') node_id
    from generate_series(0, 7) step
    union all
    select 'cov27-chain10-' || lpad(step::text, 2, '0')
    from generate_series(0, 10) step
    union all
    select 'cov27-d5000-root'
    union all
    select 'cov27-d5000-l1-' || lpad(i::text, 5, '0')
    from generate_series(0, 49) i
    union all
    select 'cov27-d5000-l2-' || lpad(i::text, 6, '0')
    from generate_series(0, 4949) i
    union all
    select 'cov27-d5001-root'
    union all
    select 'cov27-d5001-l1-' || lpad(i::text, 5, '0')
    from generate_series(0, 49) i
    union all
    select 'cov27-d5001-l2-' || lpad(i::text, 6, '0')
    from generate_series(0, 4950) i
    union all
    select 'cov27-comb-root'
    union all
    select 'cov27-comb-l1-' || lpad(i::text, 5, '0')
    from generate_series(0, 49) i
    union all
    select 'cov27-comb-l2-' || lpad(i::text, 6, '0')
    from generate_series(0, 4999) i
    union all
    select 'cov27-comb-deep-' || lpad(step::text, 2, '0')
    from generate_series(1, 8) step
    union all
    select 'cov27-poison-valid-root'
    union all
    select 'cov27-poison-valid-01'
  ) nodes;

  insert into project_intelligence.version_nodes (
    organization_id, project_id, version_id, node_id, revision_id
  )
  select v_org, v_project, v_version, node.node_id, node.current_revision_id
  from project_intelligence.graph_nodes node
  where node.organization_id = v_org
    and node.project_id = v_project
    and node.node_id like 'cov27-%';

  -- chain7: узел i зависит от узла i-1 (edge i -> i-1), значит изменение
  -- узла 0 достаёт узлы 1..7 на расстояниях 1..7 — ровно граница политики.
  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project, 'cov27-chain7-edge-' || lpad(step::text, 2, '0'),
    'cov27-chain7-' || lpad(step::text, 2, '0'),
    'cov27-chain7-' || lpad((step - 1)::text, 2, '0'),
    'depends_on'
  from generate_series(1, 7) step;

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project, 'cov27-chain10-edge-' || lpad(step::text, 2, '0'),
    'cov27-chain10-' || lpad(step::text, 2, '0'),
    'cov27-chain10-' || lpad((step - 1)::text, 2, '0'),
    'depends_on'
  from generate_series(1, 10) step;

  -- d5000 / d5001: двухуровневая метла. Уровень 1 (50 узлов) зависит от
  -- корня; уровень 2 распределён по уровню 1 round-robin (`i % 50`) — то есть
  -- у метлы 50 РАЗНЫХ узлов-родителей на втором уровне, а не один хаб.
  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project, 'cov27-d5000-l1-edge-' || lpad(i::text, 5, '0'),
    'cov27-d5000-l1-' || lpad(i::text, 5, '0'), 'cov27-d5000-root',
    'depends_on'
  from generate_series(0, 49) i;

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project, 'cov27-d5000-l2-edge-' || lpad(i::text, 6, '0'),
    'cov27-d5000-l2-' || lpad(i::text, 6, '0'),
    'cov27-d5000-l1-' || lpad((i % 50)::text, 5, '0'),
    'depends_on'
  from generate_series(0, 4949) i;

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project, 'cov27-d5001-l1-edge-' || lpad(i::text, 5, '0'),
    'cov27-d5001-l1-' || lpad(i::text, 5, '0'), 'cov27-d5001-root',
    'depends_on'
  from generate_series(0, 49) i;

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project, 'cov27-d5001-l2-edge-' || lpad(i::text, 6, '0'),
    'cov27-d5001-l2-' || lpad(i::text, 6, '0'),
    'cov27-d5001-l1-' || lpad((i % 50)::text, 5, '0'),
    'depends_on'
  from generate_series(0, 4950) i;

  -- combined: та же форма, но заведомо шире 5000 (50 + 5000 = 5050 в
  -- границе), и от ПЕРВОГО узла уровня 2 дополнительно тянется цепочка длиной
  -- 8 — гарантирует узлы на глубине 8+ ОДНОВРЕМЕННО с превышением лимита.
  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project, 'cov27-comb-l1-edge-' || lpad(i::text, 5, '0'),
    'cov27-comb-l1-' || lpad(i::text, 5, '0'), 'cov27-comb-root',
    'depends_on'
  from generate_series(0, 49) i;

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project, 'cov27-comb-l2-edge-' || lpad(i::text, 6, '0'),
    'cov27-comb-l2-' || lpad(i::text, 6, '0'),
    'cov27-comb-l1-' || lpad((i % 50)::text, 5, '0'),
    'depends_on'
  from generate_series(0, 4999) i;

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'cov27-comb-deep-edge-' || lpad(step::text, 2, '0'),
    'cov27-comb-deep-' || lpad(step::text, 2, '0'),
    case when step = 1 then 'cov27-comb-l2-000000'
      else 'cov27-comb-deep-' || lpad((step - 1)::text, 2, '0') end,
    'depends_on'
  from generate_series(1, 8) step;

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  values (
    v_org, v_project, 'cov27-poison-valid-edge',
    'cov27-poison-valid-01', 'cov27-poison-valid-root', 'depends_on'
  );

  insert into project_intelligence.version_edges (
    organization_id, project_id, version_id, edge_id
  )
  select v_org, v_project, v_version, edge.edge_id
  from project_intelligence.graph_edges edge
  where edge.organization_id = v_org
    and edge.project_id = v_project
    and edge.edge_id like 'cov27-%';

  -- ── ChangeRequests ═══════════════════════════════════════════════════
  --
  -- `proposed_baseline_id` — РЕАЛЬНЫЙ golden baseline для всех, КРОМЕ
  -- poison-broken (тому нужен несуществующий, это и есть яд).
  insert into projectceo_m4.change_requests (
    organization_id, project_id, change_request_id, package_id,
    from_baseline_id, proposed_baseline_id, from_production_package_version_id,
    protected_reason, reason_digest, initiator_role, delta_cost_rub, delta_days,
    requested_by_user_id
  )
  select v_org, v_project, request.id, v_pkg,
    request.from_baseline,
    case when request.broken then 'cov27-nonexistent-baseline'
      else v_to_baseline end,
    v_from_version,
    request.reason,
    pg_catalog.sha256(convert_to(request.reason, 'UTF8')),
    'architect', 0, 0,
    '31111111-1111-4111-8111-111111111111'
  from (values
    ('c7000000-0000-4000-8000-000000000001'::uuid, 'cov27-baseline-chain7', 'coverage: complete at maxDepth', false),
    ('c7000000-0000-4000-8000-000000000002'::uuid, 'cov27-baseline-chain10', 'coverage: partial_depth', false),
    ('c7000000-0000-4000-8000-000000000003'::uuid, 'cov27-baseline-d5000', 'coverage: exactly 5000, not blocked', false),
    ('c7000000-0000-4000-8000-000000000004'::uuid, 'cov27-baseline-d5001', 'coverage: exactly 5001, blocked', false),
    ('c7000000-0000-4000-8000-000000000005'::uuid, 'cov27-baseline-combined', 'coverage: combined depth+count cutoff', false),
    ('c7000000-0000-4000-8000-000000000006'::uuid, 'cov27-baseline-poison-valid', 'coverage: valid neighbor of a poison item', false),
    ('c7000000-0000-4000-8000-000000000007'::uuid, 'cov27-baseline-poison-broken', 'coverage: permanently broken baseline reference', true)
  ) request(id, from_baseline, reason, broken);

  -- ── Корни ════════════════════════════════════════════════════════════
  --
  -- poison-broken БЕЗ корня намеренно: RPC обязана упасть на резолве
  -- baseline ДО того, как посмотрит на `change_request_roots` вообще.
  insert into projectceo_m4.change_request_roots (
    organization_id, project_id, change_request_id, package_id,
    from_baseline_id, proposed_baseline_id, target_kind, node_id,
    from_revision_id, to_revision_id
  )
  select v_org, v_project, root.id, v_pkg,
    root.from_baseline, v_to_baseline, 'decision_revision', root.node_id,
    'rev-' || root.node_id || '-from', 'rev-' || root.node_id
  from (values
    ('c7000000-0000-4000-8000-000000000001'::uuid, 'cov27-baseline-chain7', 'cov27-chain7-00'),
    ('c7000000-0000-4000-8000-000000000002'::uuid, 'cov27-baseline-chain10', 'cov27-chain10-00'),
    ('c7000000-0000-4000-8000-000000000003'::uuid, 'cov27-baseline-d5000', 'cov27-d5000-root'),
    ('c7000000-0000-4000-8000-000000000004'::uuid, 'cov27-baseline-d5001', 'cov27-d5001-root'),
    ('c7000000-0000-4000-8000-000000000005'::uuid, 'cov27-baseline-combined', 'cov27-comb-root'),
    ('c7000000-0000-4000-8000-000000000006'::uuid, 'cov27-baseline-poison-valid', 'cov27-poison-valid-root')
  ) root(id, from_baseline, node_id);
end
$cov_fixture$;

set local session_replication_role = origin;

-- Статистика — иначе меряется планировщик, не обход (см. `26_...`).
analyze project_intelligence.graph_edges;
analyze project_intelligence.graph_nodes;
analyze project_intelligence.version_edges;
analyze project_intelligence.version_nodes;

-- Стартовая ревизия читается ДО смены роли: `service_role` не видит
-- `project_intelligence.project_workflows` напрямую (закрытая схема, доступ
-- только через SECURITY DEFINER). Каждый следующий вызов в этом файле берёт
-- свежую ревизию из СОБСТВЕННОГО ответа предыдущего вызова через
-- `set_config`/`current_setting` — тем же приёмом, что и в `26_...` — а не
-- перечитывает таблицу.
select
  state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset cov_
select set_config('projectceo.cov_state_revision', :'cov_state_revision', false);
-- Сохраняется ОТДЕЛЬНО и не перезаписывается: реплей в §6 обязан позвать RPC
-- с ТЕМИ ЖЕ аргументами, что и первый вызов (`request_digest` внутри
-- `_worker_command_context` включает `expectedStateRevision`), иначе вместо
-- реплея выйдет `P1108 idempotency_conflict` — другой запрос под тем же
-- ключом, а не повтор того же самого.
select set_config(
  'projectceo.cov_chain7_expected_state_revision', :'cov_state_revision', false
);

set local role service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. complete — РОВНО на границе глубины политики (7 из 7), ничего дальше.
-- ═══════════════════════════════════════════════════════════════════════════
select projectceo_m4_api.calculate_change_impact_policy_bound(
  '41111111-1111-4111-8111-111111111111',
  'c7000000-0000-4000-8000-000000000001'::uuid,
  current_setting('projectceo.cov_state_revision')::bigint,
  'db5-cov27-chain7'
) as response
\gset cov_chain7_
select set_config('projectceo.cov_chain7_response', :'cov_chain7_response', false);
select set_config(
  'projectceo.cov_state_revision',
  (:'cov_chain7_response'::jsonb ->> 'stateRevision'),
  false
);

do $cov_chain7_assert$
declare
  v jsonb := current_setting('projectceo.cov_chain7_response')::jsonb;
begin
  if (v #>> '{result,coverageStatus}') is distinct from 'complete'
     or (v #> '{result,cutoffReason}') is distinct from 'null'::jsonb
     or (v #>> '{result,hasMoreBeyondDepth}') is distinct from 'false'
     or (v #>> '{result,returnedImpactCount}')::integer <> 7
     or (v #>> '{result,knownImpactCountLowerBound}')::integer <> 7
  then
    raise exception 'DB5_COV_CHAIN7_NOT_COMPLETE:%', v;
  end if;
end
$cov_chain7_assert$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. partial_depth — цепочка длиннее границы: усечение отличимо от конца.
-- ═══════════════════════════════════════════════════════════════════════════
select projectceo_m4_api.calculate_change_impact_policy_bound(
  '41111111-1111-4111-8111-111111111111',
  'c7000000-0000-4000-8000-000000000002'::uuid,
  current_setting('projectceo.cov_state_revision')::bigint,
  'db5-cov27-chain10'
) as response
\gset cov_chain10_
select set_config('projectceo.cov_chain10_response', :'cov_chain10_response', false);
select set_config(
  'projectceo.cov_state_revision',
  (:'cov_chain10_response'::jsonb ->> 'stateRevision'),
  false
);

do $cov_chain10_assert$
declare
  v jsonb := current_setting('projectceo.cov_chain10_response')::jsonb;
begin
  if (v #>> '{result,coverageStatus}') is distinct from 'partial_depth'
     or (v #>> '{result,cutoffReason}') is distinct from 'depth_boundary'
     or (v #>> '{result,hasMoreBeyondDepth}') is distinct from 'true'
     or (v #>> '{result,returnedImpactCount}')::integer <> 7
     or (v #>> '{result,knownImpactCountLowerBound}')::integer <> 8
     or (v #>> '{result,maxDepth}')::integer <> 7
     or (v #>> '{result,maxImpacts}')::integer <> 5000
     or (v #>> '{result,policyVersion}') is distinct from 'project-ceo-impact-policy/0.1'
  then
    raise exception 'DB5_COV_CHAIN10_NOT_PARTIAL:%', v;
  end if;
end
$cov_chain10_assert$;

-- Инвариант хранится в базе как CHECK, не только в приложении: строка,
-- сохранённая RPC, обязана удовлетворять тому же контракту, что и её ответ.
-- `service_role` не имеет прямого доступа к таблице (только через RPC) —
-- эта проверка нарочно идёт от роли, у которой такой доступ есть.
reset role;

do $cov_chain10_persisted$
begin
  if not exists (
    select 1
    from projectceo_m4.impact_runs run
    where run.project_id = '41111111-1111-4111-8111-111111111111'
      and run.change_request_id = 'c7000000-0000-4000-8000-000000000002'::uuid
      and run.coverage_status = 'partial_depth'
      and run.cutoff_reason = 'depth_boundary'
      and run.has_more_beyond_depth
      and run.returned_impact_count = 7
      and run.known_impact_count_lower_bound = 8
  ) then
    raise exception 'DB5_COV_CHAIN10_PERSISTED_SHAPE_INVALID';
  end if;
end
$cov_chain10_persisted$;

set local role service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Ровно 5000 в границе глубины — НЕ блокирует (граница снизу).
-- ═══════════════════════════════════════════════════════════════════════════
select projectceo_m4_api.calculate_change_impact_policy_bound(
  '41111111-1111-4111-8111-111111111111',
  'c7000000-0000-4000-8000-000000000003'::uuid,
  current_setting('projectceo.cov_state_revision')::bigint,
  'db5-cov27-d5000'
) as response
\gset cov_d5000_
select set_config('projectceo.cov_d5000_response', :'cov_d5000_response', false);
select set_config(
  'projectceo.cov_state_revision',
  (:'cov_d5000_response'::jsonb ->> 'stateRevision'),
  false
);

do $cov_d5000_assert$
declare
  v jsonb := current_setting('projectceo.cov_d5000_response')::jsonb;
begin
  if (v #>> '{result,coverageStatus}') is distinct from 'complete'
     or (v #> '{result,cutoffReason}') is distinct from 'null'::jsonb
     or (v #>> '{result,hasMoreBeyondDepth}') is distinct from 'false'
     or (v #>> '{result,returnedImpactCount}')::integer <> 5000
     or (v #>> '{result,knownImpactCountLowerBound}')::integer <> 5000
  then
    raise exception 'DB5_COV_D5000_BLOCKED_OR_WRONG:%', v;
  end if;
end
$cov_d5000_assert$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Ровно 5001 — блокирует, durable terminal, ни одного impact не сохранён.
-- ═══════════════════════════════════════════════════════════════════════════
select projectceo_m4_api.calculate_change_impact_policy_bound(
  '41111111-1111-4111-8111-111111111111',
  'c7000000-0000-4000-8000-000000000004'::uuid,
  current_setting('projectceo.cov_state_revision')::bigint,
  'db5-cov27-d5001'
) as response
\gset cov_d5001_
select set_config('projectceo.cov_d5001_response', :'cov_d5001_response', false);
select set_config(
  'projectceo.cov_state_revision',
  (:'cov_d5001_response'::jsonb ->> 'stateRevision'),
  false
);

do $cov_d5001_assert$
declare
  v jsonb := current_setting('projectceo.cov_d5001_response')::jsonb;
begin
  if (v #>> '{result,coverageStatus}') is distinct from 'blocked_result_limit'
     or (v #>> '{result,cutoffReason}') is distinct from 'result_limit'
     or (v #>> '{result,hasMoreBeyondDepth}') is distinct from 'true'
     or (v #>> '{result,returnedImpactCount}')::integer <> 0
     or (v #>> '{result,knownImpactCountLowerBound}')::integer <> 5001
     or jsonb_array_length(v #> '{result,impacts}') <> 0
  then
    raise exception 'DB5_COV_D5001_NOT_BLOCKED:%', v;
  end if;
end
$cov_d5001_assert$;

reset role;

do $cov_d5001_persisted$
begin
  if (
    select count(*)
    from projectceo_m4.impacts impact
    where impact.project_id = '41111111-1111-4111-8111-111111111111'
      and impact.impact_run_id = (
        current_setting('projectceo.cov_d5001_response')::jsonb #>> '{result,id}'
      )::uuid
  ) <> 0 then
    raise exception 'DB5_COV_D5001_IMPACTS_SAVED_DESPITE_BLOCK';
  end if;
end
$cov_d5001_persisted$;

set local role service_role;

-- Blocked-исход обязан ИСЧЕЗНУТЬ из очереди воркера: `impact_runs`-строка для
-- него уже есть (см. проверку выше), а `list_change_impact_backlog`
-- исключает то, для чего строка `impact_runs` уже существует, — вне
-- зависимости от того, что `returnedImpactCount = 0`.
select projectceo_m4_api.list_change_impact_backlog(1000) as response
\gset cov_backlog_post_block_
select set_config(
  'projectceo.cov_backlog_post_block', :'cov_backlog_post_block_response', false
);

do $cov_backlog_post_block_assert$
declare
  v jsonb := current_setting('projectceo.cov_backlog_post_block')::jsonb;
  v_ids text[];
begin
  select coalesce(array_agg(item ->> 'changeRequestId'), array[]::text[])
  into v_ids
  from jsonb_array_elements(v -> 'data') item;
  if v_ids @> array['c7000000-0000-4000-8000-000000000004'] then
    raise exception 'DB5_COV_BLOCKED_STILL_IN_BACKLOG:%', v_ids;
  end if;
end
$cov_backlog_post_block_assert$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Совмещённое срабатывание глубины и лимита — побеждает лимит (DEC-033):
--    ни зонда глубины, ни неограниченного обхода ради второстепенного
--    сигнала — исход РОВНО blocked_result_limit, а не partial_depth.
-- ═══════════════════════════════════════════════════════════════════════════
select projectceo_m4_api.calculate_change_impact_policy_bound(
  '41111111-1111-4111-8111-111111111111',
  'c7000000-0000-4000-8000-000000000005'::uuid,
  current_setting('projectceo.cov_state_revision')::bigint,
  'db5-cov27-combined'
) as response
\gset cov_combined_
select set_config('projectceo.cov_combined_response', :'cov_combined_response', false);
select set_config(
  'projectceo.cov_state_revision',
  (:'cov_combined_response'::jsonb ->> 'stateRevision'),
  false
);

do $cov_combined_assert$
declare
  v jsonb := current_setting('projectceo.cov_combined_response')::jsonb;
begin
  if (v #>> '{result,coverageStatus}') is distinct from 'blocked_result_limit'
     or (v #>> '{result,cutoffReason}') is distinct from 'result_limit'
     or (v #>> '{result,returnedImpactCount}')::integer <> 0
  then
    raise exception 'DB5_COV_COMBINED_DEPTH_LEAKED_PRIORITY:%', v;
  end if;
end
$cov_combined_assert$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Digest/replay: покрытие входит в digest и переживает replay буквально.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Тот же change_request_id, ТЕ ЖЕ аргументы (включая исходную
-- `expectedStateRevision` — она часть `request_digest`), тот же ключ
-- идемпотентности → обязан вернуться КЭШИРОВАННЫЙ результат первого вызова
-- (`replay: true`), а не пересчёт. `stateRevision` из этого ответа НЕ
-- используется дальше в файле: он относится к прошлому, а не к текущему
-- состоянию проекта.
select projectceo_m4_api.calculate_change_impact_policy_bound(
  '41111111-1111-4111-8111-111111111111',
  'c7000000-0000-4000-8000-000000000001'::uuid,
  current_setting('projectceo.cov_chain7_expected_state_revision')::bigint,
  'db5-cov27-chain7'
) as response
\gset cov_chain7_replay_
select set_config(
  'projectceo.cov_chain7_replay_response', :'cov_chain7_replay_response', false
);

do $cov_chain7_replay_assert$
declare
  v_first jsonb := current_setting('projectceo.cov_chain7_response')::jsonb;
  v_replay jsonb := current_setting('projectceo.cov_chain7_replay_response')::jsonb;
begin
  if (v_replay ->> 'replay')::boolean is distinct from true
     or (v_replay #>> '{result,resultHash}')
       is distinct from (v_first #>> '{result,resultHash}')
     or (v_replay #>> '{result,coverageStatus}')
       is distinct from (v_first #>> '{result,coverageStatus}')
     or (v_replay #>> '{result,cutoffReason}')
       is distinct from (v_first #>> '{result,cutoffReason}')
     or (v_replay #>> '{result,hasMoreBeyondDepth}')
       is distinct from (v_first #>> '{result,hasMoreBeyondDepth}')
     or (v_replay #>> '{result,returnedImpactCount}')
       is distinct from (v_first #>> '{result,returnedImpactCount}')
     or (v_replay #>> '{result,knownImpactCountLowerBound}')
       is distinct from (v_first #>> '{result,knownImpactCountLowerBound}')
     or (v_replay #>> '{result,policyVersion}')
       is distinct from (v_first #>> '{result,policyVersion}')
     or (v_replay #>> '{result,maxDepth}')
       is distinct from (v_first #>> '{result,maxDepth}')
     or (v_replay #>> '{result,maxImpacts}')
       is distinct from (v_first #>> '{result,maxImpacts}')
  then
    raise exception 'DB5_COV_REPLAY_LOST_COVERAGE:%<>%', v_first, v_replay;
  end if;
end
$cov_chain7_replay_assert$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Policy/coverage неизменяемы: новая версия политики не может переписать
--    уже сохранённый исход, потому что ПЕРЕПИСАТЬ строку `impact_runs` нельзя
--    вообще, чем бы ни было мотивировано изменение.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `service_role` не имеет прямого доступа к таблице (только через RPC) —
-- проверка обязана идти от роли, которая ХОТЯ БЫ ТЕОРЕТИЧЕСКИ могла дотянуться
-- до строки напрямую, иначе она проверяла бы отсутствие гранта, а не
-- append-only триггер.
reset role;

do $cov_immutability$
begin
  begin
    update projectceo_m4.impact_runs
    set coverage_status = 'complete',
      has_more_beyond_depth = false,
      cutoff_reason = null,
      known_impact_count_lower_bound = returned_impact_count
    where project_id = '41111111-1111-4111-8111-111111111111'
      and change_request_id = 'c7000000-0000-4000-8000-000000000002'::uuid;
    raise exception 'DB5_COV_IMPACT_RUN_MUTABLE';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    delete from projectceo_m4.impacts
    where project_id = '41111111-1111-4111-8111-111111111111'
      and change_request_id = 'c7000000-0000-4000-8000-000000000002'::uuid;
    raise exception 'DB5_COV_IMPACTS_MUTABLE';
  exception when object_not_in_prerequisite_state then null;
  end;
end
$cov_immutability$;

set local role service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Один сломанный ChangeRequest не блокирует остальную очередь; durable
--    operator failure (bounded retry → dead-letter) и redrive.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 8a. Сломанная заявка не выпадает из очереди молча — иначе воркер вечно
--     видел бы пустую очередь и не смог бы её распознать. Годная заявка рядом
--     с ней видна тоже: очередь не выбирает между ними.
select projectceo_m4_api.list_change_impact_backlog(1000) as response
\gset cov_backlog_before_
select set_config(
  'projectceo.cov_backlog_before', :'cov_backlog_before_response', false
);

do $cov_backlog_before_assert$
declare
  v jsonb := current_setting('projectceo.cov_backlog_before')::jsonb;
  v_ids text[];
begin
  select coalesce(array_agg(item ->> 'changeRequestId'), array[]::text[])
  into v_ids
  from jsonb_array_elements(v -> 'data') item;
  if not (v_ids @> array[
    'c7000000-0000-4000-8000-000000000006',
    'c7000000-0000-4000-8000-000000000007'
  ]) then
    raise exception 'DB5_COV_BACKLOG_MISSING_POISON_PAIR:%', v_ids;
  end if;
end
$cov_backlog_before_assert$;

-- 8b. Сломанная заявка отвечает `not_found`, а не тихой пустотой.
do $cov_poison_broken_fails$
begin
  begin
    perform projectceo_m4_api.calculate_change_impact_policy_bound(
      '41111111-1111-4111-8111-111111111111',
      'c7000000-0000-4000-8000-000000000007'::uuid,
      current_setting('projectceo.cov_state_revision')::bigint,
      'db5-cov27-poison-broken'
    );
    raise exception 'DB5_COV_POISON_BROKEN_NOT_REJECTED';
  exception when sqlstate 'P1104' then null;
  end;
end
$cov_poison_broken_fails$;

-- 8c. ...и это не мешает соседней годной заявке посчитаться следом, в ТОМ ЖЕ
--     проходе. Отказ на одной заявке не бампает `state_revision` (RPC падает
--     до `_complete_command`), поэтому `cov_state_revision` остаётся годным
--     без перечитывания.
select projectceo_m4_api.calculate_change_impact_policy_bound(
  '41111111-1111-4111-8111-111111111111',
  'c7000000-0000-4000-8000-000000000006'::uuid,
  current_setting('projectceo.cov_state_revision')::bigint,
  'db5-cov27-poison-valid'
) as response
\gset cov_poison_valid_
select set_config(
  'projectceo.cov_poison_valid_response', :'cov_poison_valid_response', false
);
select set_config(
  'projectceo.cov_state_revision',
  (:'cov_poison_valid_response'::jsonb ->> 'stateRevision'),
  false
);

do $cov_poison_valid_assert$
declare
  v jsonb := current_setting('projectceo.cov_poison_valid_response')::jsonb;
begin
  if (v #>> '{result,coverageStatus}') is distinct from 'complete'
     or (v #>> '{result,returnedImpactCount}')::integer <> 1
  then
    raise exception 'DB5_COV_POISON_NEIGHBOR_NOT_CALCULATED:%', v;
  end if;
end
$cov_poison_valid_assert$;

-- 8d. Bounded retry: пять попыток (дефолт `max_attempts`) — и terminal
--     dead-letter ровно на пятой, не раньше и не позже.
do $cov_dead_letter$
declare
  v_response jsonb;
  v_attempt integer;
begin
  for v_attempt in 1..5 loop
    v_response := projectceo_m4_api.record_change_impact_worker_failure(
      '41111111-1111-4111-8111-111111111111',
      'c7000000-0000-4000-8000-000000000007'::uuid,
      'not_found'
    );
    if (v_response ->> 'attemptCount')::integer <> v_attempt then
      raise exception 'DB5_COV_ATTEMPT_COUNT_WRONG:%<>%', v_attempt, v_response;
    end if;
    if v_attempt < 5 and (v_response ->> 'deadLettered')::boolean then
      raise exception 'DB5_COV_DEAD_LETTER_TOO_EARLY:%/%', v_attempt, v_response;
    end if;
    if v_attempt = 5 and not (v_response ->> 'deadLettered')::boolean then
      raise exception 'DB5_COV_DEAD_LETTER_NOT_REACHED:%', v_response;
    end if;
  end loop;
end
$cov_dead_letter$;

-- 8e. Dead-lettered заявка исчезает из очереди — bounded retry исчерпан,
--     дальнейшие попытки воркера были бы бессмысленны без операторского
--     решения.
select projectceo_m4_api.list_change_impact_backlog(1000) as response
\gset cov_backlog_after_dl_
select set_config(
  'projectceo.cov_backlog_after_dl', :'cov_backlog_after_dl_response', false
);

do $cov_backlog_after_dl_assert$
declare
  v jsonb := current_setting('projectceo.cov_backlog_after_dl')::jsonb;
  v_ids text[];
begin
  select coalesce(array_agg(item ->> 'changeRequestId'), array[]::text[])
  into v_ids
  from jsonb_array_elements(v -> 'data') item;
  if v_ids @> array['c7000000-0000-4000-8000-000000000007'] then
    raise exception 'DB5_COV_DEAD_LETTERED_STILL_IN_BACKLOG:%', v_ids;
  end if;
end
$cov_backlog_after_dl_assert$;

-- 8f. Redrive — единственный путь назад, и это операторское решение, а не
--     автосброс: после него заявка снова видна очереди.
select projectceo_m4_api.redrive_change_impact_worker_failure(
  '41111111-1111-4111-8111-111111111111',
  'c7000000-0000-4000-8000-000000000007'::uuid
) as response
\gset cov_redrive_
select set_config('projectceo.cov_redrive_response', :'cov_redrive_response', false);

do $cov_redrive_assert$
begin
  if (current_setting('projectceo.cov_redrive_response')::jsonb ->> 'redriven')::boolean
     is distinct from true
  then
    raise exception 'DB5_COV_REDRIVE_FAILED:%',
      current_setting('projectceo.cov_redrive_response');
  end if;
end
$cov_redrive_assert$;

select projectceo_m4_api.list_change_impact_backlog(1000) as response
\gset cov_backlog_after_redrive_
select set_config(
  'projectceo.cov_backlog_after_redrive', :'cov_backlog_after_redrive_response', false
);

do $cov_backlog_after_redrive_assert$
declare
  v jsonb := current_setting('projectceo.cov_backlog_after_redrive')::jsonb;
  v_ids text[];
begin
  select coalesce(array_agg(item ->> 'changeRequestId'), array[]::text[])
  into v_ids
  from jsonb_array_elements(v -> 'data') item;
  if not (v_ids @> array['c7000000-0000-4000-8000-000000000007']) then
    raise exception 'DB5_COV_REDRIVE_DID_NOT_REOPEN_QUEUE:%', v_ids;
  end if;
end
$cov_backlog_after_redrive_assert$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Partial после ревью ВСЕХ показанных карточек остаётся НЕ полным ревью.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `allReturnedImpactsReviewed = true` и `impactReviewComplete = false`
-- ОДНОВРЕМЕННО — ровно то различие, ради которого DEC-033 разделил старое
-- `allImpactsReviewed` на три поля.
select set_config(
  'projectceo.cov_chain10_impact_run_id',
  (current_setting('projectceo.cov_chain10_response')::jsonb #>> '{result,id}'),
  false
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

do $cov_review_all$
declare
  v_impacts jsonb :=
    current_setting('projectceo.cov_chain10_response')::jsonb #> '{result,impacts}';
  v_impact jsonb;
  v_response jsonb;
  v_idx integer := 0;
  v_total integer := jsonb_array_length(
    current_setting('projectceo.cov_chain10_response')::jsonb #> '{result,impacts}'
  );
  v_run_id uuid := current_setting('projectceo.cov_chain10_impact_run_id')::uuid;
begin
  if v_total <> 7 then
    raise exception 'DB5_COV_CHAIN10_IMPACT_COUNT_UNEXPECTED:%', v_total;
  end if;
  for v_impact in select * from jsonb_array_elements(v_impacts) loop
    v_idx := v_idx + 1;
    v_response := projectceo_m4_api.review_change_impact(
      '41111111-1111-4111-8111-111111111111',
      v_run_id,
      v_impact ->> 'impactId',
      'resolved',
      'DB5 coverage matrix review',
      current_setting('projectceo.cov_state_revision')::bigint,
      'db5-cov27-review-' || v_idx::text
    );
    perform set_config(
      'projectceo.cov_state_revision', (v_response ->> 'stateRevision'), false
    );
    if v_idx = v_total then
      if (v_response #>> '{result,allReturnedImpactsReviewed}') is distinct from 'true'
         or (v_response #>> '{result,coverageComplete}') is distinct from 'false'
         or (v_response #>> '{result,impactReviewComplete}') is distinct from 'false'
      then
        raise exception 'DB5_COV_PARTIAL_AFTER_FULL_REVIEW_WRONG:%', v_response;
      end if;
    end if;
  end loop;
end
$cov_review_all$;

rollback;

select 'DB5_IMPACT_COVERAGE_OUTCOMES_OK' as result;
