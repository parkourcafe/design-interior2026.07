-- V1 Impact: DEC-034 correction over PR #94's truncation-as-data model.
--
-- Основание: OWNER CONTINUE «ЗАВЕРШИТЬ СУЩЕСТВУЮЩИЙ V1» 12.08.2026, поверх
-- DEC-033 LOCKED. Пока эта ветка была в работе, параллельная сессия
-- независимо реализовала тот же OWNER GO и слила PR #94 и #96 первой:
-- `20260812010000`, `20260812020000` и `20260812030000` уже применены и
-- неизменяемы (`AGENTS.md`, «Неподвижные технические правила»). Эта миграция
-- НЕ переписывает ни одну из них — она аддитивно исправляет ровно то, где
-- поведение PR #94 разошлось с зафиксированным контрактом DEC-033.
--
-- ГДЕ РАСХОЖДЕНИЕ. `20260812020000` заменила отказ при превышении лимита
-- влияний на сохранение первых `maxImpacts` карточек с признаком
-- `is_truncated` и человеческой дверью подтверждения неполноты
-- (`acknowledge_impact_truncation`). DEC-033 требует другого: свыше 5000
-- влияний ничего не сохраняется, `returnedImpactCount = 0`,
-- `knownImpactCountLowerBound = maxImpacts + 1`, результат — durable
-- terminal `blocked_result_limit`, человеческого override нет. Первые 5000
-- НЕ показываются как частичный результат ни при каком раскладе.
--
-- ЧТО ДЕЛАЕТ ЭТА МИГРАЦИЯ.
--   1. Добавляет точный контракт покрытия DEC-033 (`coverage_status`,
--      `cutoff_reason`, `has_more_beyond_depth`,
--      `known_impact_count_lower_bound`, `returned_impact_count`,
--      `policy_version`, `max_impacts`) НАРЯДУ с уже существующими
--      `is_truncated`/`truncation_reason`/`calculated_depth`/
--      `policy_max_depth` — старые колонки не удаляются и не переименовы-
--      ваются, просто перестают быть единственным источником истины.
--   2. `create or replace function calculate_change_impact(...)` —
--      ЕДИНСТВЕННОЕ содержательное изменение: при превышении лимита
--      результат обнуляется (`v_impacts := '[]'::jsonb`) ДО вставки, приоритет
--      лимита над зондом глубины — короткое замыкание, зонд глубины при
--      заблокированном исходе не выполняется вовсе. Весь остальной текст
--      функции (обход графа, шейпинг влияний, дедупликация путей) —
--      byte-for-byte копия применённой версии, не переписана заново.
--   3. `create or replace function review_change_impact(...)` — убирает
--      шлюз подтверждения неполноты; `allReturnedImpactsReviewed` /
--      `coverageComplete` / `impactReviewComplete = allReturnedImpactsReviewed
--      AND coverageComplete` заменяют собой `allImpactsReviewed` с
--      подтверждением. Функция больше не читает и не пишет
--      `impact_truncation_acknowledgements` — таблица остаётся в схеме
--      (DDL уже применён и неизменяем), просто больше никем не используется.
--   4. `create or replace function get_execution_delivery(...)` — читающая
--      RPC отдаёт весь контракт покрытия и обе версии совместности
--      (`impactReviewComplete` — новое точное имя, `reviewComplete` — старое
--      имя того же смысла, оставлено ради обратной совместимости чтения).
--   5. `create or replace function projectceo_m4._v1_impact_signatures()` —
--      список дверей вертикали сокращается с трёх до двух:
--      `review_change_impact` и `replay_review_change_impact`.
--      `acknowledge_impact_truncation` убирается из списка, поэтому ни
--      открытие (`open_v1_impact_production`), ни закрытие
--      (`close_v1_impact_production`) вертикали её больше не касаются —
--      единственная точка истины правится один раз, а не в двух местах.
--   6. Явный `revoke` на `acknowledge_impact_truncation` от каждой роли —
--      защитно, поверх уже применённого в `20260812020000` отзыва: эта дверь
--      не должна становиться доступной НИ ПРИ КАКОМ состоянии переключателя.
--   7. Явный `revoke` на `calculate_change_impact` (сырую, с произвольной
--      глубиной от вызывающего) от `service_role` — единственная системная
--      дверь расчёта отныне `calculate_change_impact_policy_bound`, как того
--      требует DEC-033. Обёртка продолжает вызывать сырую функцию изнутри:
--      `security definer` выполняет её под правами владельца, а не
--      вызывающей роли, так что грант вызывающему для этого не нужен.
--   8. Guard-блок проверяет всё перечисленное на живой базе, а не только по
--      тексту миграции.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Ни одного нового человеческого права: обе двери
-- (`review_change_impact`, `replay_review_change_impact`) остаются закрыты
-- постоянной миграцией и открываются только одноразовой средой
-- (`enable-m4-v1-impact.sql`) либо явным `open_v1_impact_production`, как и
-- раньше. Durable operator failure / dead-letter / redrive воркера,
-- построенный в параллельной (несостоявшейся) реализации этой же ветки, — не
-- восстанавливается: PR #94 не строил его, а OWNER CONTINUE прямо запрещает
-- реализовывать V1 заново сверх необходимой коррекции.

begin;

-- === Точный контракт покрытия DEC-033 (наряду со старыми колонками) =======

alter table projectceo_m4.impact_runs
  add column coverage_status text,
  add column cutoff_reason text,
  add column has_more_beyond_depth boolean,
  add column known_impact_count_lower_bound integer,
  add column returned_impact_count integer,
  add column policy_version text,
  add column max_impacts integer;

-- BACKFILL ДО NOT NULL (OWNER DECISION 17.08.2026 §5). Прежняя редакция
-- ставила NOT NULL сразу, полагаясь на «таблица пуста на момент применения».
-- Это верно для среды, применяющей весь ledger одним проходом, и НЕВЕРНО для
-- любой базы, применившей `20260812*` раньше и успевшей посчитать прогоны под
-- семантикой PR #94: на ней `set not null` падает, и упавшую миграцию уже не
-- вылечит никакая последующая. Поэтому существующие строки нормализуются к
-- трём формам контракта ЗДЕСЬ, из legacy-колонок `20260812020000`
-- (`is_truncated not null default false` + парный constraint с
-- `truncation_reason` дают полную классификацию):
--
--   * не усечён → `complete`;
--   * `depth_limit` → `partial_depth`;
--   * `result_limit` (truncate-and-keep PR #94) → `blocked_result_limit` по
--     DEC-034: `returned_impact_count = 0`, нижняя граница `max_impacts + 1`.
--     Сохранённые строки `projectceo_m4.impacts` такого прогона НЕ удаляются
--     (append-only факт), но поверхность чтения и дверь ревью обязаны вести
--     себя по счётчикам контракта — это закрепляет `20260817010000`.
--
-- Legacy-прогоны считались политикой `project-ceo-impact-policy/0.1`
-- (`maxImpacts = 5000`) — снимок политики на момент расчёта, не производная
-- от текущей функции (тот же принцип, что в DEC-035).
--
-- Append-only триггер (`20260717102000`) отключается РОВНО на время этой
-- одноразовой нормализации и включается обратно в той же транзакции: это не
-- изменение содержимого прогонов, а заполнение только что добавленных
-- колонок значениями, выведенными из самих строк.
alter table projectceo_m4.impact_runs
  disable trigger impact_runs_append_only;
update projectceo_m4.impact_runs run set
  coverage_status = case
    when not run.is_truncated then 'complete'
    when run.truncation_reason = 'depth_limit' then 'partial_depth'
    else 'blocked_result_limit'
  end,
  cutoff_reason = case
    when not run.is_truncated then null
    when run.truncation_reason = 'depth_limit' then 'depth_boundary'
    else 'result_limit'
  end,
  has_more_beyond_depth = run.is_truncated,
  returned_impact_count = case
    when run.is_truncated and run.truncation_reason = 'result_limit' then 0
    else (
      select count(*)::integer
      from projectceo_m4.impacts impact
      where impact.organization_id = run.organization_id
        and impact.project_id = run.project_id
        and impact.impact_run_id = run.impact_run_id
    )
  end,
  known_impact_count_lower_bound = case
    when run.is_truncated and run.truncation_reason = 'result_limit'
      then 5000 + 1
    when run.is_truncated and run.truncation_reason = 'depth_limit'
      then (
        select count(*)::integer + 1
        from projectceo_m4.impacts impact
        where impact.organization_id = run.organization_id
          and impact.project_id = run.project_id
          and impact.impact_run_id = run.impact_run_id
      )
    else (
      select count(*)::integer
      from projectceo_m4.impacts impact
      where impact.organization_id = run.organization_id
        and impact.project_id = run.project_id
        and impact.impact_run_id = run.impact_run_id
    )
  end,
  policy_version = 'project-ceo-impact-policy/0.1',
  max_impacts = 5000
where run.coverage_status is null;

alter table projectceo_m4.impact_runs
  enable trigger impact_runs_append_only;

alter table projectceo_m4.impact_runs
  alter column coverage_status set not null,
  alter column has_more_beyond_depth set not null,
  alter column known_impact_count_lower_bound set not null,
  alter column returned_impact_count set not null,
  alter column policy_version set not null,
  alter column max_impacts set not null;

alter table projectceo_m4.impact_runs
  add constraint m4_impact_runs_coverage_status_check
    check (coverage_status in ('complete', 'partial_depth', 'blocked_result_limit')),
  add constraint m4_impact_runs_cutoff_reason_check_dec034
    check (cutoff_reason is null or cutoff_reason in ('depth_boundary', 'result_limit')),
  add constraint m4_impact_runs_known_lower_bound_check
    check (known_impact_count_lower_bound >= 0),
  add constraint m4_impact_runs_returned_count_check
    check (returned_impact_count >= 0),
  add constraint m4_impact_runs_policy_version_check_dec034
    check (char_length(btrim(policy_version)) between 1 and 60),
  add constraint m4_impact_runs_max_impacts_check_dec034
    check (max_impacts between 1 and 5000);

-- Инвариант трёх исходов — constraint, не документ (DEC-033). Строка, не
-- соответствующая ровно одному из трёх контрактов, не попадёт в базу ни при
-- каком будущем изменении кода вокруг неё.
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

create or replace function projectceo_m4_api.calculate_change_impact(
  project_id uuid,
  change_request_id uuid,
  max_depth integer,
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
  v_target_baseline_id text;
  v_target_graph_version_id text;
  v_impact_run_id uuid := extensions.gen_random_uuid();
  v_algorithm jsonb;
  v_impacts jsonb;
  v_result_digest bytea;
  v_result jsonb;
  v_policy jsonb := projectceo_m4._impact_policy();
  v_policy_max_depth integer := (v_policy ->> 'maxDepth')::integer;
  v_max_impacts integer := (v_policy ->> 'maxImpacts')::integer;
  v_found integer;
  v_calculated_depth integer;
  v_is_truncated boolean := false;
  v_truncation_reason text := null;
  v_deeper bigint;
  v_within bigint;
  -- DEC-034 correction (over PR #94's truncation-as-data model, OWNER
  -- CONTINUE 12.08.2026): exact DEC-033 coverage contract fields, computed
  -- alongside the legacy is_truncated/truncation_reason pair rather than
  -- replacing it.
  v_coverage_status text;
  v_cutoff_reason text;
  v_has_more_beyond_depth boolean;
  v_known_impact_count_lower_bound integer;
  v_returned_impact_count integer;
  v_policy_version text := v_policy ->> 'version';
begin
  if max_depth is null or max_depth < 1 or max_depth > 20 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"maxDepth"}'::jsonb
    );
  end if;
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
      'P1104',
      'not_found',
      '{"entity":"changeRequest"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_m4._worker_command_context(
    project_id,
    v_package_id,
    'calculate_change_impact',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object(
      'changeRequestId', change_request_id,
      'maxDepth', max_depth
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;
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

  v_algorithm := jsonb_build_object(
    'cyclePolicy', 'shortest_path_per_changed_root',
    'direction', 'reverse_dependency',
    'maxDepth', max_depth,
    'ordering', 'unicode_code_point',
    'propagatingRelations', jsonb_build_array(
      'depends_on', 'derived_from', 'satisfies', 'specified_by'
    ),
    'version', 'project-ceo-impact/0.2'
  );

  with recursive roots as (
    select
      root.node_id changed_node_id,
      root.to_revision_id changed_revision_id
    from projectceo_m4.change_request_roots root
    where root.organization_id = v_context.organization_id
      and root.project_id = project_id
      and root.change_request_id = change_request_id
  ), walk as (
    select
      root.changed_node_id,
      root.changed_revision_id,
      root.changed_node_id current_node_id,
      array[root.changed_node_id]::text[] node_path,
      array[]::text[] edge_path
    from roots root
    union all
    select
      walk.changed_node_id,
      walk.changed_revision_id,
      edge.from_node_id,
      walk.node_path || edge.from_node_id,
      walk.edge_path || edge.edge_id
    from walk
    join project_intelligence.version_edges version_edge
      on version_edge.organization_id = v_context.organization_id
     and version_edge.project_id = project_id
     and version_edge.version_id = v_target_graph_version_id
    join project_intelligence.graph_edges edge
      on edge.organization_id = version_edge.organization_id
     and edge.project_id = version_edge.project_id
     and edge.edge_id = version_edge.edge_id
     and edge.to_node_id = walk.current_node_id
     and edge.relation in (
       'depends_on', 'derived_from', 'specified_by', 'satisfies'
     )
    where cardinality(walk.edge_path) < max_depth
      and not edge.from_node_id = any(walk.node_path)
  ), ranked as (
    select
      walk.*,
      row_number() over (
        partition by walk.changed_node_id, walk.current_node_id
        order by
          cardinality(walk.edge_path),
          walk.node_path collate "C",
          walk.edge_path collate "C"
      ) path_rank
    from walk
    where walk.current_node_id <> walk.changed_node_id
  ), best as (
    select * from ranked where path_rank = 1
  ), shaped as (
    select jsonb_build_object(
      'changedNodeId', best.changed_node_id,
      'changedRevisionId', best.changed_revision_id,
      'distance', cardinality(best.edge_path),
      'edgePath', coalesce((
        select jsonb_agg(jsonb_build_object(
          'edgeId', edge.edge_id,
          'fromNodeId', edge.from_node_id,
          'relation', edge.relation,
          'stepNo', edge_ref.ordinality - 1,
          'toNodeId', edge.to_node_id
        ) order by edge_ref.ordinality)
        from unnest(best.edge_path) with ordinality
          edge_ref(edge_id, ordinality)
        join project_intelligence.graph_edges edge
          on edge.organization_id = v_context.organization_id
         and edge.project_id = project_id
         and edge.edge_id = edge_ref.edge_id
      ), '[]'::jsonb),
      'impactId', 'impact:' || substr(encode(
        project_intelligence._sha256_jsonb(jsonb_build_array(
          change_request_id,
          v_target_graph_version_id,
          best.changed_node_id,
          best.current_node_id,
          to_jsonb(best.node_path),
          to_jsonb(best.edge_path)
        )),
        'hex'
      ), 1, 32),
      'impactedNodeId', best.current_node_id,
      'impactedRevisionId', target.revision_id,
      'nodePath', to_jsonb(best.node_path)
    ) impact
    from best
    join project_intelligence.version_nodes target
      on target.organization_id = v_context.organization_id
     and target.project_id = project_id
     and target.version_id = v_target_graph_version_id
     and target.node_id = best.current_node_id
  )
  select coalesce(jsonb_agg(shaped.impact order by
    shaped.impact ->> 'changedNodeId' collate "C",
    (shaped.impact ->> 'distance')::integer,
    shaped.impact ->> 'impactedNodeId' collate "C"
  ), '[]'::jsonb)
  into v_impacts
  from shaped;

  -- УСЕЧЕНИЕ ВМЕСТО ОТКАЗА (OWNER DECISION 12.08.2026).
  --
  -- Прежняя редакция при превышении лимита отказывалась целиком: найденное
  -- влияние выбрасывалось, и заявка оставалась без анализа вовсе. Отказ был
  -- честнее молчаливого усечения, но хуже частичного результата с признаком —
  -- человек не получал НИЧЕГО там, где мог рассмотреть большую часть.
  --
  -- Теперь результат сохраняется частично, а факт неполноты становится
  -- ДАННЫМИ: `is_truncated`, `truncation_reason`, `calculated_depth`,
  -- `policy_max_depth`. Срез детерминированный — массив уже отсортирован
  -- (changedNodeId, distance, impactedNodeId), поэтому два прогона на одном
  -- графе усекаются одинаково.
  v_found := jsonb_array_length(v_impacts);

  -- DEC-034 correction (OWNER CONTINUE 12.08.2026): DEC-033 requires that
  -- blocked_result_limit save NOTHING and never present the first
  -- max_impacts as a reviewable partial result — PR #94's truncate-and-keep
  -- behavior contradicted this. The limit check short-circuits BEFORE the
  -- depth probe runs at all: a secondary signal (depth) never gets computed
  -- once the primary terminal outcome (blocked) is already decided.
  if v_found > v_max_impacts then
    v_impacts := '[]'::jsonb;
    v_is_truncated := true;
    v_truncation_reason := 'result_limit';
    v_coverage_status := 'blocked_result_limit';
    v_cutoff_reason := 'result_limit';
    v_has_more_beyond_depth := true;
    v_returned_impact_count := 0;
    v_known_impact_count_lower_bound := v_max_impacts + 1;
  else
    -- Усечение по глубине: тот же обход на шаг глубже нашёл бы больше пар.
    -- Проверяется только когда лимит НЕ сработал: граф глубже политики —
    -- самая частая причина неполноты и самая незаметная.
    v_within := projectceo_m4._impact_pair_count(
      v_context.organization_id, project_id, change_request_id,
      v_target_graph_version_id, max_depth
    );
    v_deeper := projectceo_m4._impact_pair_count(
      v_context.organization_id, project_id, change_request_id,
      v_target_graph_version_id, max_depth + 1
    );
    if v_deeper > v_within then
      v_is_truncated := true;
      v_truncation_reason := 'depth_limit';
      v_coverage_status := 'partial_depth';
      v_cutoff_reason := 'depth_boundary';
      v_has_more_beyond_depth := true;
      v_returned_impact_count := v_found;
      v_known_impact_count_lower_bound := v_found + 1;
    else
      v_coverage_status := 'complete';
      v_cutoff_reason := null;
      v_has_more_beyond_depth := false;
      v_returned_impact_count := v_found;
      v_known_impact_count_lower_bound := v_found;
    end if;
  end if;

  -- Фактически достигнутая глубина — по сохранённому результату, а не по
  -- границе: пустое влияние даёт 0, и это отличимо от «дошли до восьми».
  select coalesce(max((impact ->> 'distance')::integer), 0)
  into v_calculated_depth
  from jsonb_array_elements(v_impacts) shaped(impact);
  v_result_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'algorithm', v_algorithm,
      'changeRequestId', change_request_id,
      'impacts', v_impacts,
      'targetBaselineId', v_target_baseline_id,
      'targetGraphVersionId', v_target_graph_version_id
    )
  );

  insert into projectceo_m4.impact_runs (
    organization_id,
    project_id,
    impact_run_id,
    change_request_id,
    package_id,
    target_baseline_id,
    target_graph_version_id,
    max_depth,
    algorithm,
    result_digest,
    created_by_id,
    is_truncated,
    truncation_reason,
    calculated_depth,
    policy_max_depth,
    coverage_status,
    cutoff_reason,
    has_more_beyond_depth,
    known_impact_count_lower_bound,
    returned_impact_count,
    policy_version,
    max_impacts
  ) values (
    v_context.organization_id,
    project_id,
    v_impact_run_id,
    change_request_id,
    v_package_id,
    v_target_baseline_id,
    v_target_graph_version_id,
    max_depth,
    v_algorithm,
    v_result_digest,
    v_context.actor_id,
    v_is_truncated,
    v_truncation_reason,
    v_calculated_depth,
    v_policy_max_depth,
    v_coverage_status,
    v_cutoff_reason,
    v_has_more_beyond_depth,
    v_known_impact_count_lower_bound,
    v_returned_impact_count,
    v_policy_version,
    v_max_impacts
  );

  insert into projectceo_m4.impacts (
    organization_id,
    project_id,
    impact_id,
    impact_run_id,
    change_request_id,
    package_id,
    target_graph_version_id,
    changed_node_id,
    changed_revision_id,
    impacted_node_id,
    impacted_revision_id,
    distance,
    node_path
  )
  select
    v_context.organization_id,
    project_id,
    impact ->> 'impactId',
    v_impact_run_id,
    change_request_id,
    v_package_id,
    v_target_graph_version_id,
    impact ->> 'changedNodeId',
    impact ->> 'changedRevisionId',
    impact ->> 'impactedNodeId',
    impact ->> 'impactedRevisionId',
    (impact ->> 'distance')::integer,
    array(select jsonb_array_elements_text(impact -> 'nodePath'))
  from jsonb_array_elements(v_impacts) shaped(impact)
  order by impact ->> 'impactId' collate "C";

  insert into projectceo_m4.impact_path_steps (
    organization_id,
    project_id,
    impact_id,
    impact_run_id,
    package_id,
    target_graph_version_id,
    step_no,
    edge_id,
    relation,
    from_node_id,
    to_node_id
  )
  select
    v_context.organization_id,
    project_id,
    impact ->> 'impactId',
    v_impact_run_id,
    v_package_id,
    v_target_graph_version_id,
    (step ->> 'stepNo')::integer,
    step ->> 'edgeId',
    step ->> 'relation',
    step ->> 'fromNodeId',
    step ->> 'toNodeId'
  from jsonb_array_elements(v_impacts) shaped_impact(impact)
  cross join lateral jsonb_array_elements(impact -> 'edgePath')
    shaped_step(step)
  order by impact ->> 'impactId' collate "C",
           (step ->> 'stepNo')::integer;

  -- Признаки усечения входят в ЛОГИЧЕСКИЙ РЕЗУЛЬТАТ команды, а не только в
  -- строку таблицы. Иначе повтор по ключу идемпотентности вернул бы прежний
  -- ответ без них — то есть повтор выглядел бы полнее оригинала.
  v_result := jsonb_build_object(
    'algorithm', v_algorithm,
    'calculatedDepth', v_calculated_depth,
    'changeRequestId', change_request_id,
    'id', v_impact_run_id,
    'impactCount', jsonb_array_length(v_impacts),
    'isTruncated', v_is_truncated,
    'policyMaxDepth', v_policy_max_depth,
    'truncationReason', v_truncation_reason,
    'coverageStatus', v_coverage_status,
    'cutoffReason', v_cutoff_reason,
    'hasMoreBeyondDepth', v_has_more_beyond_depth,
    'knownImpactCountLowerBound', v_known_impact_count_lower_bound,
    'returnedImpactCount', v_returned_impact_count,
    'policyVersion', v_policy_version,
    'maxImpacts', v_max_impacts,
    'impacts', v_impacts,
    'packageId', v_package_id,
    'projectId', project_id,
    'resultHash', 'sha256:' || encode(v_result_digest, 'hex'),
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
      'impact_count', jsonb_array_length(v_impacts),
      'impact_run_id', v_impact_run_id,
      'max_depth', max_depth,
      'result_digest', 'sha256:' || encode(v_result_digest, 'hex')
    ),
    v_context.state_revision
  );
end
$function$;

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
  v_reason text;
  v_review_id uuid := extensions.gen_random_uuid();
  v_every_impact_reviewed boolean;
  v_is_truncated boolean;
  v_truncation_reason text;
  v_coverage_status text;
  v_all_returned_reviewed boolean;
  v_coverage_complete boolean;
  v_impact_review_complete boolean;
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
  ) into v_every_impact_reviewed;

  -- DEC-034 correction (over PR #94's truncation-as-data model, OWNER
  -- CONTINUE 12.08.2026, DEC-033 LOCKED): no human override exists in V1.
  -- Reviewing every RETURNED card is a real, honest fact
  -- (`allReturnedImpactsReviewed`) but is kept SEPARATE from whether the walk
  -- itself is exhausted (`coverageComplete`) — an architect cannot sign a
  -- partial run into "complete" by acknowledging it. `acknowledge_impact_
  -- truncation` is permanently unreachable (revoked below); this function no
  -- longer references it or the acknowledgements table at all.
  select run.is_truncated, run.truncation_reason, run.coverage_status
  into v_is_truncated, v_truncation_reason, v_coverage_status
  from projectceo_m4.impact_runs run
  where run.organization_id = v_context.organization_id
    and run.project_id = project_id
    and run.impact_run_id = impact_run_id;

  v_all_returned_reviewed := v_every_impact_reviewed;
  v_coverage_complete := v_coverage_status = 'complete';
  v_impact_review_complete := v_all_returned_reviewed and v_coverage_complete;

  v_result := jsonb_build_object(
    'allReturnedImpactsReviewed', v_all_returned_reviewed,
    'coverageComplete', v_coverage_complete,
    'impactReviewComplete', v_impact_review_complete,
    'disposition', disposition,
    'everyImpactReviewed', v_every_impact_reviewed,
    'isTruncated', coalesce(v_is_truncated, false),
    'truncationReason', v_truncation_reason,
    'id', v_review_id,
    'impactId', impact_id,
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
      'impact_review_complete', v_impact_review_complete,
      'disposition', disposition,
      'impact_id', impact_id,
      'impact_run_id', impact_run_id,
      'reason_digest', 'sha256:' || encode(
        project_intelligence._sha256_text(v_reason), 'hex'
      )
    ),
    v_context.state_revision
  );
end
$function$;

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
        'maxDepth', run.max_depth,
        -- Неполнота прогона — часть того, что видит человек, а не служебная
        -- деталь. Без этих полей интерфейс показал бы усечённый список
        -- неотличимо от полного (OWNER DECISION 12.08.2026, п. 4).
        'calculatedDepth', run.calculated_depth,
        'isTruncated', run.is_truncated,
        'policyMaxDepth', run.policy_max_depth,
        'truncationReason', run.truncation_reason,
        -- DEC-034 correction (over PR #94's truncation-as-data model, OWNER
        -- CONTINUE 12.08.2026, DEC-033 LOCKED): the exact coverage contract,
        -- and the split completeness fields with NO acknowledgement gate —
        -- there is no human override in V1. `allReturnedImpactsReviewed` is
        -- vacuously true when zero impacts were returned (blocked_result_
        -- limit), matching what `review_change_impact` itself computes.
        'coverageStatus', run.coverage_status,
        'cutoffReason', run.cutoff_reason,
        'hasMoreBeyondDepth', run.has_more_beyond_depth,
        'knownImpactCountLowerBound', run.known_impact_count_lower_bound,
        'returnedImpactCount', run.returned_impact_count,
        'policyVersion', run.policy_version,
        'maxImpacts', run.max_impacts,
        'allReturnedImpactsReviewed', not exists (
          select 1
          from projectceo_m4.impacts impact
          where impact.organization_id = run.organization_id
            and impact.project_id = run.project_id
            and impact.impact_run_id = run.impact_run_id
            and not exists (
              select 1
              from projectceo_m4.impact_reviews review
              where review.organization_id = impact.organization_id
                and review.project_id = impact.project_id
                and review.impact_run_id = impact.impact_run_id
                and review.impact_id = impact.impact_id
            )
        ),
        'coverageComplete', run.coverage_status = 'complete',
        'impactReviewComplete', (
          not exists (
            select 1
            from projectceo_m4.impacts impact
            where impact.organization_id = run.organization_id
              and impact.project_id = run.project_id
              and impact.impact_run_id = run.impact_run_id
              and not exists (
                select 1
                from projectceo_m4.impact_reviews review
                where review.organization_id = impact.organization_id
                  and review.project_id = impact.project_id
                  and review.impact_run_id = impact.impact_run_id
                  and review.impact_id = impact.impact_id
              )
          )
          and run.coverage_status = 'complete'
        ),
        'reviewComplete', (
          not exists (
            select 1
            from projectceo_m4.impacts impact
            where impact.organization_id = run.organization_id
              and impact.project_id = run.project_id
              and impact.impact_run_id = run.impact_run_id
              and not exists (
                select 1
                from projectceo_m4.impact_reviews review
                where review.organization_id = impact.organization_id
                  and review.project_id = impact.project_id
                  and review.impact_run_id = impact.impact_run_id
                  and review.impact_id = impact.impact_id
              )
          )
          and run.coverage_status = 'complete'
        ),
        'resultHash', 'sha256:' || encode(run.result_digest, 'hex'),
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

  return jsonb_build_object(
    'contractVersion', 'project-ceo-m4-delivery/0.1',
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

-- === Единственная точка истины для дверей вертикали — сокращена ===========

create or replace function projectceo_m4._v1_impact_signatures()
returns text[]
language sql
immutable
security definer
set search_path = ''
as $function$
  select array[
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)'
  ];
$function$;

-- === Двери, которые не должны быть доступны ни при каком состоянии ========

-- Защитно, поверх уже применённого в `20260812020000` отзыва: эта дверь не
-- открывается переключателем (список сократился выше) и не должна быть
-- доступна, даже если её когда-то грантнули вручную в обход обеих функций.
revoke all on function
  projectceo_m4_api.acknowledge_impact_truncation(uuid, uuid, text, bigint, text)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Единственная системная дверь расчёта — `calculate_change_impact_policy_
-- bound` (DEC-033). Сырая функция с произвольной глубиной от вызывающего
-- продолжает существовать (её вызывает обёртка изнутри под `security
-- definer`), но перестаёт быть достижимой снаружи хоть какой-то ролью.
revoke all on function
  projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

do $guard$
declare
  v_problem text;
  v_signatures text[] := projectceo_m4._v1_impact_signatures();
begin
  -- 1. Список дверей вертикали сократился ровно до двух, и это не третья
  --    дверь под другим именем.
  if array_length(v_signatures, 1) <> 2 then
    raise exception 'PROJECTCEO_M4_V1_SIGNATURES_COUNT:%', array_length(v_signatures, 1);
  end if;
  if 'projectceo_m4_api.acknowledge_impact_truncation(uuid, uuid, text, bigint, text)'
      = any(v_signatures) then
    raise exception 'PROJECTCEO_M4_TRUNCATION_ACK_STILL_A_V1_DOOR';
  end if;

  -- 2. Ни одна роль постоянной миграции не видит подтверждение усечения.
  select format('%s:%s', role_name, signature) into v_problem
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4_api.acknowledge_impact_truncation(uuid, uuid, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'PROJECTCEO_M4_TRUNCATION_ACK_GRANTED_BY_MIGRATION:%', v_problem;
  end if;

  -- 3. Сырая дверь расчёта недостижима ни одной ролью, включая service_role:
  --    policy-bound RPC остаётся единственной системной дверью.
  select format('%s:%s', role_name, signature) into v_problem
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'PROJECTCEO_M4_RAW_IMPACT_RPC_REACHABLE:%', v_problem;
  end if;

  -- 4. Инвариант трёх исходов стоит на самой таблице.
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'm4_impact_runs_coverage_shape_check'
      and conrelid = 'projectceo_m4.impact_runs'::regclass
  ) then
    raise exception 'PROJECTCEO_M4_COVERAGE_SHAPE_CHECK_MISSING';
  end if;

  -- 5. blocked_result_limit физически не может нести сохранённые влияния:
  --    строка, нарушающая это, не пройдёт constraint, а не просто "не должна".
  begin
    insert into projectceo_m4.impact_runs (
      organization_id, project_id, impact_run_id, change_request_id, package_id,
      target_baseline_id, target_graph_version_id, max_depth, algorithm,
      result_digest, created_by_id, is_truncated, truncation_reason,
      coverage_status, cutoff_reason, has_more_beyond_depth,
      known_impact_count_lower_bound, returned_impact_count, policy_version,
      max_impacts
    ) values (
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000000',
      extensions.gen_random_uuid(),
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000000',
      'guard', 'guard', 1, '{}'::jsonb,
      decode(repeat('00', 32), 'hex'), 'system:guard', true, 'result_limit',
      'blocked_result_limit', 'result_limit', true, 5001,
      1, -- ЗАВЕДОМО НЕВЕРНО: blocked обязан нести 0, не 1.
      'project-ceo-impact-policy/0.1', 5000
    );
    raise exception 'PROJECTCEO_M4_BLOCKED_WITH_SAVED_IMPACT_ALLOWED';
  exception
    when check_violation then null;
  end;
end
$guard$;

commit;
