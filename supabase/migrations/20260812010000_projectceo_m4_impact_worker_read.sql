-- V1 Impact: bounded, coverage-aware change-impact calculation.
--
-- Основание: OWNER GO «АВТОНОМНО ЗАВЕРШИТЬ REMHAOS M4 V1 IMPACT», DEC-033
-- LOCKED, поверх DEC-032
-- (`REMHAOS_A6_CLARIFICATION_M4_EXECUTION_LAYER_2026-08-12.md`). Открывает
-- РОВНО расчёт влияния и его ревью. V2/V3 остаются `NOT AUTHORIZED`, и
-- настоящая миграция не выдаёт прав ни на одну их RPC.
--
-- ПОЛИТИКА (DEC-033, зафиксирована, не benchmark-подбор):
--   maxDepth = 7, maxImpacts = 5000, version 'project-ceo-impact-policy/0.1'.
--   Три исхода: complete / partial_depth / blocked_result_limit — таблица
--   `projectceo_m4.impact_runs` расширяется колонками покрытия, и они входят
--   в digest и в replay-контракт наравне с самим списком влияний.
--
-- ПОЧЕМУ ОБХОД — ЯВНЫЙ ЦИКЛ С ВРЕМЕННОЙ ТАБЛИЦЕЙ, А НЕ РЕКУРСИВНЫЙ CTE.
-- Прежняя реализация (`calculate_change_impact`, уже слитая) строит ВСЕ пути
-- до глубины через `union all` и лишь ПОТОМ схлопывает их в пары —
-- ромбовидный граф зависимостей даёт здесь комбинаторный взрыв путей ещё до
-- дедупликации. Рекурсивный CTE не спасает: `WITH RECURSIVE` в PostgreSQL
-- открывает self-reference только на РЕЗУЛЬТАТ ПРЕДЫДУЩЕЙ итерации
-- («working table»), а не на всю накопленную историю, поэтому anti-join
-- внутри рекурсивного терма не может корректно запретить повторное открытие
-- уже посещённого узла с более длинного пути. Явный PL/pgSQL-цикл по глубине
-- с временной таблицей `pg_temp.impact_frontier` (одна строка на пару
-- «изменённый узел, достигнутый узел», PRIMARY KEY это гарантирует) даёт
-- ИСТИННОЕ «посещён один раз», ограничивая работу O(узлы × глубина), а не
-- O(путей). Обход выполняется РОВНО один раз до `maxDepth + 1` — этого
-- достаточно и для подсчёта, и для зонда «есть ли что-то за границей глубины»
-- одновременно, поэтому второго полного обхода не требуется.
--
-- ЧТО ЗДЕСЬ ПОЯВЛЯЕТСЯ.
--   1. `_impact_policy()` — versioned server-side constant.
--   2. `calculate_change_impact_policy_bound()` — единственная системная дверь
--      расчёта. Caller НЕ передаёт `max_depth`/`max_impacts`. Считает влияние
--      целиком новым ограниченным алгоритмом (см. выше), сама решает исход и
--      сохраняет его как durable terminal outcome.
--   3. `list_change_impact_backlog()` — очередь: заявки без прогона влияния.
--
-- ЧТО ЗАКРЫВАЕТСЯ. Прежняя дверь `calculate_change_impact(...,max_depth,...)`
-- с произвольной глубиной от вызывающего теряет `execute` у `service_role` —
-- единственная системная дверь расчёта отныне policy-bound. Права
-- `authenticated`/`anon` на новые функции НЕ выдаются ни здесь, ни в
-- постоянной миграции нигде: `review_change_impact` (человеческая RPC для
-- рассмотрения уже посчитанного влияния) открывается ТОЛЬКО в одноразовой
-- среде (`tests/ap1/environment/enable-m4-increment-1.sql`), как и остальной
-- инкремент 1.

begin;

-- === Персистентность: покрытие обхода как часть исхода прогона ===========

alter table projectceo_m4.impact_runs
  add column coverage_status text,
  add column policy_version text,
  add column max_impacts integer,
  add column returned_impact_count integer,
  add column known_impact_count_lower_bound integer,
  add column has_more_beyond_depth boolean,
  add column cutoff_reason text;

-- Заполнить NOT NULL без дефолта нельзя, если в таблице уже есть строки, а
-- заранее гарантировать пустоту таблицы миграция не вправе (DB5 запускает всю
-- цепочку с нуля, но правило должно быть верным вообще, а не только в тесте).
-- Поэтому: сначала колонки nullable, затем — на пустых значениях — ставится
-- ограничение NOT NULL отдельным `alter`, что для новой таблицы эквивалентно
-- объявлению `not null` сразу, а для гипотетической населённой — упадёт явно,
-- а не тихо запишет неверные нули.
alter table projectceo_m4.impact_runs
  alter column coverage_status set not null,
  alter column policy_version set not null,
  alter column max_impacts set not null,
  alter column returned_impact_count set not null,
  alter column known_impact_count_lower_bound set not null,
  alter column has_more_beyond_depth set not null;

alter table projectceo_m4.impact_runs
  add constraint m4_impact_runs_coverage_status_check
    check (coverage_status in ('complete', 'partial_depth', 'blocked_result_limit')),
  add constraint m4_impact_runs_policy_version_check
    check (char_length(btrim(policy_version)) between 1 and 60),
  add constraint m4_impact_runs_max_impacts_check
    check (max_impacts between 1 and 5000),
  add constraint m4_impact_runs_returned_count_check
    check (returned_impact_count >= 0),
  add constraint m4_impact_runs_lower_bound_check
    check (known_impact_count_lower_bound >= 0),
  add constraint m4_impact_runs_cutoff_reason_check
    check (cutoff_reason is null or cutoff_reason in ('depth_boundary', 'result_limit'));

-- Инвариант исхода — не документ, а constraint: строка, не соответствующая
-- ровно одному из трёх контрактов DEC-033, не попадёт в базу ни при каком
-- будущем изменении кода вокруг неё.
alter table projectceo_m4.impact_runs
  add constraint m4_impact_runs_coverage_shape_check
    check (
      (
        coverage_status = 'complete'
        and has_more_beyond_depth = false
        and cutoff_reason is null
        and returned_impact_count = known_impact_count_lower_bound
        and returned_impact_count <= max_impacts
      ) or (
        coverage_status = 'partial_depth'
        and has_more_beyond_depth = true
        and cutoff_reason = 'depth_boundary'
        and returned_impact_count <= max_impacts
        and known_impact_count_lower_bound = returned_impact_count + 1
      ) or (
        coverage_status = 'blocked_result_limit'
        and has_more_beyond_depth = true
        and cutoff_reason = 'result_limit'
        and returned_impact_count = 0
        and known_impact_count_lower_bound = max_impacts + 1
      )
    );

-- === Политика обхода (DEC-033, зафиксирована) =============================

create function projectceo_m4._impact_policy()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'version', 'project-ceo-impact-policy/0.1',
    'maxDepth', 7,
    'maxImpacts', 5000
  )
$function$;

alter function projectceo_m4._impact_policy() owner to pi_table_owner;

-- === Единственная системная дверь расчёта =================================

create function projectceo_m4_api.calculate_change_impact_policy_bound(
  project_id uuid,
  change_request_id uuid,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_policy jsonb := projectceo_m4._impact_policy();
  v_max_depth integer := (v_policy ->> 'maxDepth')::integer;
  v_max_impacts integer := (v_policy ->> 'maxImpacts')::integer;
  v_policy_version text := v_policy ->> 'version';
  v_probe_depth integer := (v_policy ->> 'maxDepth')::integer + 1;
  v_package_id uuid;
  v_target_baseline_id text;
  v_target_graph_version_id text;
  v_context record;
  v_depth integer;
  v_within_count bigint;
  v_beyond_exists boolean;
  v_coverage_status text;
  v_has_more boolean;
  v_cutoff_reason text;
  v_known_lower_bound integer;
  v_impact_run_id uuid := extensions.gen_random_uuid();
  v_impacts jsonb;
  v_algorithm jsonb;
  v_result_digest bytea;
  v_result jsonb;
begin
  select cr.package_id, cr.proposed_baseline_id, pb.graph_version_id
  into v_package_id, v_target_baseline_id, v_target_graph_version_id
  from projectceo_m4.change_requests cr
  join projectceo_product.project_baselines pb
    on pb.organization_id = cr.organization_id
   and pb.project_id = cr.project_id
   and pb.baseline_id = cr.proposed_baseline_id
  where cr.project_id = project_id
    and cr.change_request_id = change_request_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"changeRequest"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_m4._worker_command_context(
    project_id,
    v_package_id,
    'calculate_change_impact',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object('changeRequestId', change_request_id)
  );
  if v_context.replay is not null then return v_context.replay; end if;

  -- Один immutable ChangeRequest -> один immutable impact run (решение
  -- владельца 11.08.2026): пересчёт и отмена в V1 не строятся. Новое
  -- изменение — новый ChangeRequest.
  if exists (
    select 1
    from projectceo_m4.impact_runs ir
    where ir.organization_id = v_context.organization_id
      and ir.project_id = project_id
      and ir.change_request_id = change_request_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"IMPACT_ALREADY_CALCULATED"}'::jsonb
    );
  end if;

  -- Ограниченный обход: явный цикл по глубине, временная таблица держит
  -- ИСТИННОЕ множество посещённых пар (root, node) — PRIMARY KEY запрещает
  -- дубли. `drop ... if exists` в начале делает функцию безопасно
  -- переисполняемой внутри одной транзакции (важно для benchmark и
  -- конкурентных сценариев DB5, где несколько вызовов идут подряд).
  drop table if exists pg_temp.impact_frontier;
  create temporary table pg_temp.impact_frontier (
    changed_node_id text not null,
    changed_revision_id text not null,
    current_node_id text not null,
    depth integer not null,
    via_node_id text,
    via_edge_id text,
    primary key (changed_node_id, current_node_id)
  ) on commit drop;

  insert into pg_temp.impact_frontier (
    changed_node_id, changed_revision_id, current_node_id, depth,
    via_node_id, via_edge_id
  )
  select root.node_id, root.to_revision_id, root.node_id, 0, null, null
  from projectceo_m4.change_request_roots root
  where root.organization_id = v_context.organization_id
    and root.project_id = project_id
    and root.change_request_id = change_request_id;

  for v_depth in 0 .. (v_probe_depth - 1) loop
    -- Кандидаты на новую глубину: рёбра «против зависимости» из ТЕКУЩЕГО слоя
    -- (depth = v_depth) к узлам, которых ещё нет в посещённых. Несколько
    -- рёбер могут вести к одному новому узлу из разных предшественников —
    -- `distinct on` с лексикографическим тай-брейком выбирает РОВНО одного,
    -- детерминированно, тем же принципом, что и в исходном алгоритме
    -- (`node_path collate "C"`).
    insert into pg_temp.impact_frontier (
      changed_node_id, changed_revision_id, current_node_id, depth,
      via_node_id, via_edge_id
    )
    select distinct on (candidate.changed_node_id, candidate.new_node_id)
      candidate.changed_node_id,
      candidate.changed_revision_id,
      candidate.new_node_id,
      v_depth + 1,
      candidate.via_node_id,
      candidate.via_edge_id
    from (
      select
        f.changed_node_id,
        f.changed_revision_id,
        edge.from_node_id as new_node_id,
        f.current_node_id as via_node_id,
        edge.edge_id as via_edge_id
      from pg_temp.impact_frontier f
      join project_intelligence.version_edges ve
        on ve.organization_id = v_context.organization_id
       and ve.project_id = project_id
       and ve.version_id = v_target_graph_version_id
      join project_intelligence.graph_edges edge
        on edge.organization_id = ve.organization_id
       and edge.project_id = ve.project_id
       and edge.edge_id = ve.edge_id
       and edge.to_node_id = f.current_node_id
       and edge.relation in (
         'depends_on', 'derived_from', 'specified_by', 'satisfies'
       )
      where f.depth = v_depth
        and not exists (
          select 1
          from pg_temp.impact_frontier seen
          where seen.changed_node_id = f.changed_node_id
            and seen.current_node_id = edge.from_node_id
        )
    ) candidate
    order by candidate.changed_node_id, candidate.new_node_id,
      candidate.via_node_id collate "C", candidate.via_edge_id collate "C";
    exit when not found;
  end loop;

  select count(*) into v_within_count
  from pg_temp.impact_frontier f
  where f.depth between 1 and v_max_depth;

  if v_within_count > v_max_impacts then
    -- При одновременном срабатывании count- и depth-cutoff приоритет у
    -- blocked_result_limit (DEC-033): зонд глубины не нужен и не выполняется.
    v_coverage_status := 'blocked_result_limit';
    v_has_more := true;
    v_cutoff_reason := 'result_limit';
    v_known_lower_bound := v_max_impacts + 1;
    v_impacts := '[]'::jsonb;
  else
    select exists (
      select 1 from pg_temp.impact_frontier f where f.depth = v_max_depth + 1
    ) into v_beyond_exists;

    if v_beyond_exists then
      v_coverage_status := 'partial_depth';
      v_has_more := true;
      v_cutoff_reason := 'depth_boundary';
      v_known_lower_bound := v_within_count + 1;
    else
      v_coverage_status := 'complete';
      v_has_more := false;
      v_cutoff_reason := null;
      v_known_lower_bound := v_within_count;
    end if;

    -- Реконструкция пути ТОЛЬКО для подтверждённого ограниченного множества.
    -- У каждой достигнутой пары ровно один предшественник (PRIMARY KEY на
    -- impact_frontier это гарантирует), поэтому обратный обход — не поиск, а
    -- прямая линейная цепочка длиной не больше max_depth на каждую пару:
    -- O(возвращённых пар × max_depth), без обращения к графу.
    with recursive path_walk as (
      select
        f.changed_node_id, f.changed_revision_id,
        f.current_node_id as target_node_id,
        f.current_node_id as node_id,
        f.via_node_id, f.via_edge_id,
        array[f.current_node_id]::text[] as node_path_from_target,
        array[]::text[] as edge_path_from_target
      from pg_temp.impact_frontier f
      where f.depth between 1 and v_max_depth
      union all
      select
        pw.changed_node_id, pw.changed_revision_id, pw.target_node_id,
        fr.current_node_id, fr.via_node_id, fr.via_edge_id,
        pw.node_path_from_target || fr.current_node_id,
        pw.edge_path_from_target || pw.via_edge_id
      from path_walk pw
      join pg_temp.impact_frontier fr
        on fr.changed_node_id = pw.changed_node_id
       and fr.current_node_id = pw.via_node_id
      where pw.node_id <> pw.changed_node_id
    ),
    reconstructed as (
      select
        -- Синтетический номер строки — ключ для доклейки `edgePath` ОДНИМ
        -- join'ом ниже, а не корреляционным подзапросом на каждую строку.
        -- `impacted_node_id` для этого не годится: у ChangeRequest может быть
        -- несколько корней, и тогда один и тот же impacted-узел законно
        -- встречается в нескольких строках `reconstructed` — по одной на
        -- каждый корень, который до него достаёт.
        row_number() over () as rn,
        pw.changed_node_id,
        pw.changed_revision_id,
        pw.target_node_id as impacted_node_id,
        target.revision_id as impacted_revision_id,
        cardinality(pw.edge_path_from_target) as distance,
        (
          select array_agg(x order by ord desc)
          from unnest(pw.node_path_from_target) with ordinality as u(x, ord)
        ) as node_path,
        (
          select array_agg(x order by ord desc)
          from unnest(pw.edge_path_from_target) with ordinality as u(x, ord)
        ) as edge_path
      from path_walk pw
      join project_intelligence.version_nodes target
        on target.organization_id = v_context.organization_id
       and target.project_id = project_id
       and target.version_id = v_target_graph_version_id
       and target.node_id = pw.target_node_id
      where pw.node_id = pw.changed_node_id
    ),
    -- Разворот всех путей ОДНИМ набором и ОДИН join на `graph_edges` для всего
    -- результата разом — вместо join'а на каждую из потенциально тысяч строк
    -- `reconstructed` по отдельности (что на ~3300 возвращённых influence при
    -- глубине политики занимало заметные секунды: план с корреляционным
    -- подзапросом в списке `select` перепланирует и переисполняет join на
    -- КАЖДУЮ строку заново).
    edge_steps as (
      select
        reconstructed.rn,
        edge_ref.ordinality,
        jsonb_build_object(
          'edgeId', edge.edge_id,
          'fromNodeId', edge.from_node_id,
          'relation', edge.relation,
          'stepNo', edge_ref.ordinality - 1,
          'toNodeId', edge.to_node_id
        ) as step
      from reconstructed
      cross join lateral unnest(reconstructed.edge_path) with ordinality
        as edge_ref(edge_id, ordinality)
      join project_intelligence.graph_edges edge
        on edge.organization_id = v_context.organization_id
       and edge.project_id = project_id
       and edge.edge_id = edge_ref.edge_id
    ),
    edge_paths as (
      select edge_steps.rn,
        jsonb_agg(edge_steps.step order by edge_steps.ordinality) as edge_path_json
      from edge_steps
      group by edge_steps.rn
    )
    select coalesce(jsonb_agg(shaped.impact order by
      shaped.impact ->> 'changedNodeId' collate "C",
      (shaped.impact ->> 'distance')::integer,
      shaped.impact ->> 'impactedNodeId' collate "C"
    ), '[]'::jsonb)
    into v_impacts
    from (
      select jsonb_build_object(
        'changedNodeId', reconstructed.changed_node_id,
        'changedRevisionId', reconstructed.changed_revision_id,
        'distance', reconstructed.distance,
        'edgePath', coalesce(edge_paths.edge_path_json, '[]'::jsonb),
        'impactId', 'impact:' || substr(encode(
          project_intelligence._sha256_jsonb(jsonb_build_array(
            change_request_id,
            v_target_graph_version_id,
            reconstructed.changed_node_id,
            reconstructed.impacted_node_id,
            to_jsonb(reconstructed.node_path),
            to_jsonb(reconstructed.edge_path)
          )),
          'hex'
        ), 1, 32),
        'impactedNodeId', reconstructed.impacted_node_id,
        'impactedRevisionId', reconstructed.impacted_revision_id,
        'nodePath', to_jsonb(reconstructed.node_path)
      ) impact
      from reconstructed
      left join edge_paths on edge_paths.rn = reconstructed.rn
    ) shaped;
  end if;

  drop table if exists pg_temp.impact_frontier;

  v_algorithm := jsonb_build_object(
    'cyclePolicy', 'first_visit_bounded_bfs',
    'direction', 'reverse_dependency',
    'ordering', 'unicode_code_point',
    'policyVersion', v_policy_version,
    'propagatingRelations', jsonb_build_array(
      'depends_on', 'derived_from', 'satisfies', 'specified_by'
    ),
    'version', 'project-ceo-impact/0.3'
  );

  v_result_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'algorithm', v_algorithm,
      'changeRequestId', change_request_id,
      'coverageStatus', v_coverage_status,
      'cutoffReason', v_cutoff_reason,
      'hasMoreBeyondDepth', v_has_more,
      'impacts', v_impacts,
      'knownImpactCountLowerBound', v_known_lower_bound,
      'maxDepth', v_max_depth,
      'maxImpacts', v_max_impacts,
      'policyVersion', v_policy_version,
      'returnedImpactCount', jsonb_array_length(v_impacts),
      'targetBaselineId', v_target_baseline_id,
      'targetGraphVersionId', v_target_graph_version_id
    )
  );

  insert into projectceo_m4.impact_runs (
    organization_id, project_id, impact_run_id, change_request_id,
    package_id, target_baseline_id, target_graph_version_id, max_depth,
    algorithm, result_digest, created_by_id,
    coverage_status, policy_version, max_impacts, returned_impact_count,
    known_impact_count_lower_bound, has_more_beyond_depth, cutoff_reason
  ) values (
    v_context.organization_id, project_id, v_impact_run_id, change_request_id,
    v_package_id, v_target_baseline_id, v_target_graph_version_id, v_max_depth,
    v_algorithm, v_result_digest, v_context.actor_id,
    v_coverage_status, v_policy_version, v_max_impacts,
    jsonb_array_length(v_impacts), v_known_lower_bound, v_has_more,
    v_cutoff_reason
  );

  insert into projectceo_m4.impacts (
    organization_id, project_id, impact_id, impact_run_id, change_request_id,
    package_id, target_graph_version_id, changed_node_id, changed_revision_id,
    impacted_node_id, impacted_revision_id, distance, node_path
  )
  select
    v_context.organization_id, project_id, impact ->> 'impactId',
    v_impact_run_id, change_request_id, v_package_id,
    v_target_graph_version_id, impact ->> 'changedNodeId',
    impact ->> 'changedRevisionId', impact ->> 'impactedNodeId',
    impact ->> 'impactedRevisionId', (impact ->> 'distance')::integer,
    array(select jsonb_array_elements_text(impact -> 'nodePath'))
  from jsonb_array_elements(v_impacts) shaped(impact)
  order by impact ->> 'impactId' collate "C";

  insert into projectceo_m4.impact_path_steps (
    organization_id, project_id, impact_id, impact_run_id, package_id,
    target_graph_version_id, step_no, edge_id, relation, from_node_id,
    to_node_id
  )
  select
    v_context.organization_id, project_id, impact ->> 'impactId',
    v_impact_run_id, v_package_id, v_target_graph_version_id,
    (step ->> 'stepNo')::integer, step ->> 'edgeId', step ->> 'relation',
    step ->> 'fromNodeId', step ->> 'toNodeId'
  from jsonb_array_elements(v_impacts) shaped_impact(impact)
  cross join lateral jsonb_array_elements(impact -> 'edgePath')
    shaped_step(step)
  order by impact ->> 'impactId' collate "C", (step ->> 'stepNo')::integer;

  v_result := jsonb_build_object(
    'algorithm', v_algorithm,
    'changeRequestId', change_request_id,
    'coverageStatus', v_coverage_status,
    'cutoffReason', v_cutoff_reason,
    'hasMoreBeyondDepth', v_has_more,
    'id', v_impact_run_id,
    'impactCount', jsonb_array_length(v_impacts),
    'impacts', v_impacts,
    'knownImpactCountLowerBound', v_known_lower_bound,
    'maxDepth', v_max_depth,
    'maxImpacts', v_max_impacts,
    'packageId', v_package_id,
    'policyVersion', v_policy_version,
    'projectId', project_id,
    'resultHash', 'sha256:' || encode(v_result_digest, 'hex'),
    'returnedImpactCount', jsonb_array_length(v_impacts),
    'targetBaselineId', v_target_baseline_id,
    'targetGraphVersionId', v_target_graph_version_id
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'calculate_change_impact',
    v_context.key_digest,
    v_context.request_digest,
    'system',
    v_context.actor_id,
    null,
    v_result,
    'change_impact_calculated',
    jsonb_build_object(
      'change_request_id', change_request_id,
      'coverage_status', v_coverage_status,
      'cutoff_reason', v_cutoff_reason,
      'has_more_beyond_depth', v_has_more,
      'impact_run_id', v_impact_run_id,
      'known_impact_count_lower_bound', v_known_lower_bound,
      'max_depth', v_max_depth,
      'max_impacts', v_max_impacts,
      'policy_version', v_policy_version,
      'result_digest', 'sha256:' || encode(v_result_digest, 'hex'),
      'returned_impact_count', jsonb_array_length(v_impacts)
    ),
    v_context.state_revision
  );
end
$function$;

alter function projectceo_m4_api.calculate_change_impact_policy_bound(
  uuid, uuid, bigint, text
) owner to pi_table_owner;

-- === Очередь воркера ========================================================

create function projectceo_m4_api.list_change_impact_backlog(
  max_rows integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_limit integer;
  v_data jsonb;
begin
  if max_rows is null or max_rows < 1 or max_rows > 1000 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"IMPACT_BACKLOG_LIMIT_INVALID"}'::jsonb
    );
  end if;
  v_limit := max_rows;

  -- Заявки со сломанным baseline из очереди НЕ фильтруются молча: без
  -- отдельного durable-состояния сломанная строка либо никогда не всплывала бы
  -- (если фильтровать по существованию), либо всплывала бы бесконечно (если не
  -- фильтровать вовсе, как было раньше в этой миграции). Разница — эта
  -- `impact_worker_failures`: item остаётся в очереди на bounded retry (пока
  -- `dead_lettered = false`) и уходит из неё, только когда воркер зафиксировал
  -- терминальный отказ через `record_change_impact_worker_failure`. Возврат —
  -- явная операторская команда `redrive_change_impact_worker_failure`, а не
  -- тихий автосброс.
  select coalesce(jsonb_agg(item order by item ->> 'changeRequestId'), '[]'::jsonb)
  into v_data
  from (
    select jsonb_build_object(
      'organizationId', cr.organization_id,
      'projectId', cr.project_id,
      'packageId', cr.package_id,
      'changeRequestId', cr.change_request_id,
      'proposedBaselineId', cr.proposed_baseline_id,
      'rootCount', (
        select count(*)
        from projectceo_m4.change_request_roots root
        where root.organization_id = cr.organization_id
          and root.project_id = cr.project_id
          and root.change_request_id = cr.change_request_id
      ),
      'stateRevision', pw.state_revision
    ) item
    from projectceo_m4.change_requests cr
    join project_intelligence.project_workflows pw
      on pw.organization_id = cr.organization_id
     and pw.project_id = cr.project_id
    where not exists (
      select 1
      from projectceo_m4.impact_runs ir
      where ir.organization_id = cr.organization_id
        and ir.project_id = cr.project_id
        and ir.change_request_id = cr.change_request_id
    )
    and not exists (
      select 1
      from projectceo_m4.impact_worker_failures f
      where f.organization_id = cr.organization_id
        and f.project_id = cr.project_id
        and f.change_request_id = cr.change_request_id
        and f.dead_lettered
    )
    order by cr.organization_id, cr.project_id,
      cr.change_request_id::text collate "C"
    limit v_limit
  ) rows;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-impact-worker/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'policy', projectceo_m4._impact_policy(),
    'data', v_data,
    'error', null
  );
end
$function$;

alter function projectceo_m4_api.list_change_impact_backlog(integer)
  owner to pi_table_owner;

-- === Durable operator failure (bounded retry + dead-letter) ================
--
-- `calculate_change_impact_policy_bound` сама атомарна — ей не нужна лиза, как
-- очереди канальных событий (`remhaos_channel.channel_events`): либо она целиком
-- проходит и сохраняет terminal outcome, либо откатывается целиком, и заявка
-- просто снова видна в `list_change_impact_backlog`. Единственный пробел —
-- НЕОБРАТИМО сломанный ChangeRequest (P1104 на сорванной ссылке на baseline):
-- без durable-состояния он возвращался бы воркеру бесконечно. Эта таблица
-- закрывает ровно это, и только это.
create table projectceo_m4.impact_worker_failures (
  organization_id uuid not null,
  project_id uuid not null,
  change_request_id uuid not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  failure_code text not null
    check (char_length(btrim(failure_code)) between 1 and 60),
  first_failed_at timestamptz not null default statement_timestamp(),
  last_failed_at timestamptz not null default statement_timestamp(),
  dead_lettered boolean not null default false,
  primary key (organization_id, project_id, change_request_id),
  constraint m4_impact_worker_failures_request_fkey
    foreign key (organization_id, project_id, change_request_id)
    references projectceo_m4.change_requests (
      organization_id, project_id, change_request_id
    )
    on delete restrict
);

alter table projectceo_m4.impact_worker_failures owner to pi_table_owner;
alter table projectceo_m4.impact_worker_failures enable row level security;
alter table projectceo_m4.impact_worker_failures force row level security;
revoke all on table projectceo_m4.impact_worker_failures
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy impact_worker_failures_internal_owner
  on projectceo_m4.impact_worker_failures
  for all to pi_table_owner using (true) with check (true);

-- Воркер решает КОГДА звать эту дверь (не на `stale_state` — это нормальный
-- исход гонки, а не отказ); решает СКОЛЬКО попыток простить — эта дверь.
create function projectceo_m4_api.record_change_impact_worker_failure(
  project_id uuid,
  change_request_id uuid,
  failure_code text,
  max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid := projectceo_product._system_context(project_id);
  v_failure_code text;
  v_max_attempts integer;
  v_attempt_count integer;
  v_dead_lettered boolean;
begin
  if max_attempts is null or max_attempts < 1 or max_attempts > 20 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"maxAttempts"}'::jsonb
    );
  end if;
  v_max_attempts := max_attempts;
  v_failure_code := projectceo_product._assert_text(failure_code, 'failureCode', 60);

  insert into projectceo_m4.impact_worker_failures (
    organization_id, project_id, change_request_id, attempt_count,
    failure_code, dead_lettered
  ) values (
    v_organization_id, project_id, change_request_id, 1,
    v_failure_code, 1 >= v_max_attempts
  )
  -- Цель конфликта — ИМЯ ограничения, не список колонок: `project_id` и
  -- `change_request_id` — имена параметров этой функции, и список колонок
  -- здесь развалился бы о `#variable_conflict use_variable` (тот же приём,
  -- что и в `remhaos_channel_api.record_inbox_candidate`, `20260811060000`).
  on conflict on constraint impact_worker_failures_pkey do update set
    attempt_count = projectceo_m4.impact_worker_failures.attempt_count + 1,
    failure_code = excluded.failure_code,
    last_failed_at = statement_timestamp(),
    dead_lettered =
      (projectceo_m4.impact_worker_failures.attempt_count + 1) >= v_max_attempts
  returning attempt_count, dead_lettered
  into v_attempt_count, v_dead_lettered;

  return jsonb_build_object(
    'attemptCount', v_attempt_count,
    'deadLettered', v_dead_lettered
  );
end
$function$;

alter function projectceo_m4_api.record_change_impact_worker_failure(
  uuid, uuid, text, integer
) owner to pi_table_owner;

-- Redrive — единственный путь из dead-letter. Операторская дверь: сброс
-- утверждает решение человека, что сломанное состояние действительно
-- поправлено, а не тихий автовозврат по таймеру.
create function projectceo_m4_api.redrive_change_impact_worker_failure(
  project_id uuid,
  change_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid := projectceo_product._system_context(project_id);
begin
  update projectceo_m4.impact_worker_failures f
  set attempt_count = 0,
    dead_lettered = false,
    last_failed_at = statement_timestamp()
  where f.organization_id = v_organization_id
    and f.project_id = project_id
    and f.change_request_id = change_request_id;

  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"impactWorkerFailure"}'::jsonb
    );
  end if;

  return jsonb_build_object('redriven', true);
end
$function$;

alter function projectceo_m4_api.redrive_change_impact_worker_failure(uuid, uuid)
  owner to pi_table_owner;

-- === Расширение читающей проекции покрытием ================================
--
-- `get_execution_delivery` уже создана и выдана `authenticated`
-- (`20260717103000`). Права `create or replace` не трогает — это
-- установленный в репозитории способ эволюции тела уже слитой функции без
-- переписывания старого файла миграции.
create or replace function projectceo_m4_api.get_execution_delivery(
  project_id uuid,
  package_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_state_revision bigint;
  v_data jsonb;
begin
  select distinct
    context.organization_id,
    context.actor_user_id,
    context.actor_id
  into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    package_id,
    'view_project'
  ) context;
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id;

  select jsonb_build_object(
    'changeRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'deltaCostRub', request.delta_cost_rub,
        'deltaDays', request.delta_days,
        'fromBaselineId', request.from_baseline_id,
        'id', request.change_request_id,
        'initiatorRole', request.initiator_role,
        'proposedBaselineId', request.proposed_baseline_id,
        'reason', request.protected_reason,
        'reasonHash', 'sha256:' || encode(request.reason_digest, 'hex'),
        'requestedAt', request.requested_at,
        'rootCount', (
          select count(*)
          from projectceo_m4.change_request_roots root
          where root.organization_id = request.organization_id
            and root.project_id = request.project_id
            and root.change_request_id = request.change_request_id
        )
      ) order by request.requested_at desc)
      from projectceo_m4.change_requests request
      where request.organization_id = v_context.organization_id
        and request.project_id = project_id
        and request.package_id = package_id
    ), '[]'::jsonb),
    'impactRuns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'changeRequestId', run.change_request_id,
        'coverageStatus', run.coverage_status,
        'cutoffReason', run.cutoff_reason,
        'hasMoreBeyondDepth', run.has_more_beyond_depth,
        'id', run.impact_run_id,
        'impacts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'changedNodeId', impact.changed_node_id,
            'disposition', review.disposition,
            'distance', impact.distance,
            'id', impact.impact_id,
            'impactedNodeId', impact.impacted_node_id,
            'nodePath', to_jsonb(impact.node_path),
            'reviewReason', review.protected_reason
          ) order by impact.changed_node_id collate "C",
                     impact.distance,
                     impact.impacted_node_id collate "C")
          from projectceo_m4.impacts impact
          left join projectceo_m4.impact_reviews review
            on review.organization_id = impact.organization_id
           and review.project_id = impact.project_id
           and review.impact_run_id = impact.impact_run_id
           and review.impact_id = impact.impact_id
          where impact.organization_id = run.organization_id
            and impact.project_id = run.project_id
            and impact.impact_run_id = run.impact_run_id
        ), '[]'::jsonb),
        'knownImpactCountLowerBound', run.known_impact_count_lower_bound,
        'maxDepth', run.max_depth,
        'maxImpacts', run.max_impacts,
        'policyVersion', run.policy_version,
        'resultHash', 'sha256:' || encode(run.result_digest, 'hex'),
        'returnedImpactCount', run.returned_impact_count,
        'targetBaselineId', run.target_baseline_id,
        'targetGraphVersionId', run.target_graph_version_id
      ) order by run.created_at desc)
      from projectceo_m4.impact_runs run
      where run.organization_id = v_context.organization_id
        and run.project_id = project_id
        and run.package_id = package_id
    ), '[]'::jsonb),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'acceptance', case when acceptance.milestone_acceptance_id is null
          then null else jsonb_build_object(
            'id', acceptance.milestone_acceptance_id,
            'semanticHash', 'sha256:' || encode(
              acceptance.semantic_digest, 'hex'
            )
          ) end,
        'areas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'areaNodeId', area.area_node_id,
            'areaRevisionId', area.area_revision_id,
            'photos', coalesce((
              select jsonb_agg(jsonb_build_object(
                'capturedAt', photo.captured_at,
                'decision', review.decision,
                'id', photo.photo_evidence_id,
                'note', photo.protected_note,
                'sourceChecksum', 'sha256:' || encode(
                  photo.source_checksum, 'hex'
                ),
                'sourceId', photo.source_id,
                'sourceRevisionId', photo.source_revision_id
              ) order by photo.registered_at)
              from projectceo_m4.photo_evidence photo
              left join projectceo_m4.photo_evidence_reviews review
                on review.organization_id = photo.organization_id
               and review.project_id = photo.project_id
               and review.photo_evidence_id = photo.photo_evidence_id
              where photo.organization_id = area.organization_id
                and photo.project_id = area.project_id
                and photo.milestone_id = area.milestone_id
                and photo.area_node_id = area.area_node_id
            ), '[]'::jsonb)
          ) order by area.area_node_id collate "C")
          from projectceo_m4.milestone_areas area
          where area.organization_id = milestone.organization_id
            and area.project_id = milestone.project_id
            and area.milestone_id = milestone.milestone_id
        ), '[]'::jsonb),
        'id', milestone.milestone_id,
        'productionPackageVersionId',
          milestone.production_package_version_id,
        'title', milestone.title
      ) order by milestone.defined_at desc)
      from projectceo_m4.milestones milestone
      left join projectceo_m4.milestone_acceptances acceptance
        on acceptance.organization_id = milestone.organization_id
       and acceptance.project_id = milestone.project_id
       and acceptance.milestone_id = milestone.milestone_id
      where milestone.organization_id = v_context.organization_id
        and milestone.project_id = project_id
        and milestone.package_id = package_id
    ), '[]'::jsonb),
    'handoverDocuments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'documentKind', document.document_kind,
        'id', document.handover_document_id,
        'productionPackageVersionId',
          document.production_package_version_id,
        'sourceChecksum', 'sha256:' || encode(
          document.source_checksum, 'hex'
        ),
        'sourceId', document.source_id,
        'sourceRevisionId', document.source_revision_id
      ) order by document.registered_at desc)
      from projectceo_m4.handover_documents document
      where document.organization_id = v_context.organization_id
        and document.project_id = project_id
        and document.package_id = package_id
    ), '[]'::jsonb),
    'constructionHandovers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contractVersion', handover.contract_version,
        'createdAt', handover.created_at,
        'id', handover.construction_handover_id,
        'productionPackageVersionId',
          handover.production_package_version_id,
        'semanticContent', handover.semantic_content,
        'semanticHash', 'sha256:' || encode(
          handover.semantic_digest, 'hex'
        )
      ) order by handover.created_at desc)
      from projectceo_m4.construction_handovers handover
      where handover.organization_id = v_context.organization_id
        and handover.project_id = project_id
        and handover.package_id = package_id
    ), '[]'::jsonb)
  ) into v_data;

  -- Версия поднята с /0.1 на /0.2: конверт теперь несёт покрытие обхода
  -- влияния (coverageStatus и соседние поля). Это чистое расширение объекта
  -- impactRuns[], но контракт проверяется строгим равенством строки на
  -- TypeScript-стороне (`execution.ts`), поэтому расхождение обязано быть
  -- видимым, а не тихим.
  return jsonb_build_object(
    'contractVersion', 'project-ceo-m4-delivery/0.2',
    'data', v_data,
    'error', null,
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'scope', jsonb_build_object(
      'organizationId', v_context.organization_id,
      'packageId', package_id,
      'projectId', project_id
    ),
    'stateRevision', v_state_revision
  );
end
$function$;

alter function projectceo_m4_api.get_execution_delivery(uuid, uuid)
  owner to pi_table_owner;

-- === Ревью влияния: разделить allReturnedImpactsReviewed и coverageComplete
--
-- Прежнее `allImpactsReviewed` не различало «просмотрены все ВОЗВРАЩЁННЫЕ
-- карточки» и «обход полон» — для partial это позволяло бы полю молча
-- вернуть `true`, хотя влияние показано не целиком. `create or replace`
-- сохраняет сигнатуру и права уже слитой функции, меняя только тело.
create or replace function projectceo_m4_api.review_change_impact(
  project_id uuid,
  impact_run_id uuid,
  impact_id text,
  disposition text,
  reason text,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_package_id uuid;
  v_target_graph_version_id text;
  v_coverage_status text;
  v_reason text;
  v_review_id uuid := extensions.gen_random_uuid();
  v_all_returned_reviewed boolean;
  v_coverage_complete boolean;
  v_result jsonb;
begin
  if disposition not in ('accepted', 'resolved', 'dismissed') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"disposition"}'::jsonb
    );
  end if;
  v_reason := projectceo_product._assert_text(reason, 'reason', 4000);
  select impact.package_id, impact.target_graph_version_id
  into v_package_id, v_target_graph_version_id
  from projectceo_m4.impacts impact
  where impact.project_id = project_id
    and impact.impact_run_id = impact_run_id
    and impact.impact_id = impact_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"impact"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_m4._human_command_context(
    project_id,
    v_package_id,
    'review_change_impact',
    'review_change_impact',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object(
      'disposition', disposition,
      'impactId', impact_id,
      'impactRunId', impact_run_id,
      'reason', v_reason
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;
  if exists (
    select 1
    from projectceo_m4.impact_reviews review
    where review.organization_id = v_context.organization_id
      and review.project_id = project_id
      and review.impact_run_id = impact_run_id
      and review.impact_id = impact_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"IMPACT_ALREADY_REVIEWED"}'::jsonb
    );
  end if;

  insert into projectceo_m4.impact_reviews (
    organization_id,
    project_id,
    impact_review_id,
    impact_run_id,
    impact_id,
    package_id,
    target_graph_version_id,
    disposition,
    protected_reason,
    reason_digest,
    reviewed_by_user_id
  ) values (
    v_context.organization_id,
    project_id,
    v_review_id,
    impact_run_id,
    impact_id,
    v_package_id,
    v_target_graph_version_id,
    disposition,
    v_reason,
    project_intelligence._sha256_text(v_reason),
    v_context.actor_user_id
  );

  select not exists (
    select 1
    from projectceo_m4.impacts impact
    where impact.organization_id = v_context.organization_id
      and impact.project_id = project_id
      and impact.impact_run_id = impact_run_id
      and not exists (
        select 1
        from projectceo_m4.impact_reviews review
        where review.organization_id = impact.organization_id
          and review.project_id = impact.project_id
          and review.impact_run_id = impact.impact_run_id
          and review.impact_id = impact.impact_id
      )
  ) into v_all_returned_reviewed;

  select run.coverage_status = 'complete' into v_coverage_complete
  from projectceo_m4.impact_runs run
  where run.organization_id = v_context.organization_id
    and run.project_id = project_id
    and run.impact_run_id = impact_run_id;

  v_result := jsonb_build_object(
    -- Сохранено буквально, чтобы не ломать существующих читателей DB5: все
    -- возвращённые карточки просмотрены. Это НЕ «анализ полон» — для этого
    -- смотреть impactReviewComplete.
    'allReturnedImpactsReviewed', v_all_returned_reviewed,
    'coverageComplete', v_coverage_complete,
    'disposition', disposition,
    'id', v_review_id,
    'impactId', impact_id,
    'impactReviewComplete', v_all_returned_reviewed and v_coverage_complete,
    'impactRunId', impact_run_id,
    'reasonHash', 'sha256:' || encode(
      project_intelligence._sha256_text(v_reason), 'hex'
    ),
    'reviewedBy', jsonb_build_object(
      'actorId', v_context.actor_id,
      'actorType', 'human'
    )
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'review_change_impact',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'change_impact_reviewed',
    jsonb_build_object(
      'all_returned_impacts_reviewed', v_all_returned_reviewed,
      'coverage_complete', v_coverage_complete,
      'disposition', disposition,
      'impact_id', impact_id,
      'impact_review_complete', v_all_returned_reviewed and v_coverage_complete,
      'impact_run_id', impact_run_id,
      'reason_digest', 'sha256:' || encode(
        project_intelligence._sha256_text(v_reason), 'hex'
      )
    ),
    v_context.state_revision
  );
end
$function$;

-- === Границы прав ===========================================================

revoke all on function
  projectceo_m4._impact_policy(),
  projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text),
  projectceo_m4_api.list_change_impact_backlog(integer),
  projectceo_m4_api.record_change_impact_worker_failure(uuid, uuid, text, integer),
  projectceo_m4_api.redrive_change_impact_worker_failure(uuid, uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant execute on function
  projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text),
  projectceo_m4_api.list_change_impact_backlog(integer),
  projectceo_m4_api.record_change_impact_worker_failure(uuid, uuid, text, integer),
  projectceo_m4_api.redrive_change_impact_worker_failure(uuid, uuid)
  to service_role;

-- Единственная системная дверь расчёта отныне policy-bound: прежняя дверь с
-- произвольной глубиной от вызывающего закрыта даже для `service_role`.
revoke execute on function
  projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)
  from service_role;

do $guard$
declare
  v_reachable text;
begin
  -- Человеческие роли не достают до воркерного контура ничем.
  select format('%s:%s', role_name, signature) into v_reachable
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)',
    'projectceo_m4_api.record_change_impact_worker_failure(uuid, uuid, text, integer)',
    'projectceo_m4_api.redrive_change_impact_worker_failure(uuid, uuid)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_REACHABLE_BY_HUMAN_ROLE:%', v_reachable;
  end if;

  select signature into v_reachable
  from unnest(array[
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)',
    'projectceo_m4_api.record_change_impact_worker_failure(uuid, uuid, text, integer)',
    'projectceo_m4_api.redrive_change_impact_worker_failure(uuid, uuid)'
  ]) signature
  where not pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_UNREACHABLE_BY_SYSTEM:%', v_reachable;
  end if;

  -- Прежняя дверь расчёта закрыта отовсюду, включая service_role.
  if pg_catalog.has_function_privilege(
    'anon',
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_M4_RAW_IMPACT_RPC_STILL_REACHABLE';
  end if;

  -- V1 не открывает V2/V3: остальные четыре команды инкремента 2
  -- (upload_photo_evidence, review_photo_evidence, accept_milestone,
  -- build_handover через build_construction_handover) остаются недостижимы
  -- отовсюду, чем бы ни была эта миграция.
  select format('%s:%s', role_name, signature) into v_reachable
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4_api.define_milestone(uuid, uuid, text, text, jsonb, bigint, text)',
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.register_handover_document(uuid, uuid, text, text, text, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'PROJECTCEO_M4_V2_V3_LEAKED_BY_V1:%', v_reachable;
  end if;
end
$guard$;

commit;
