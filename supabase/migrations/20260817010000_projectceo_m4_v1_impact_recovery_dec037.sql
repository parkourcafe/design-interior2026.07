-- DEC-037 (OWNER DECISION 17.08.2026,
-- `docs/canonical/remhaos-v1/REMHAOS_OWNER_DECISION_M4_V1_COVERAGE_AND_RECOVERY_2026-08-17.md`
-- §3): recovery заблокированного прогона V1 Impact.
--
-- ЧТО БЫЛО. Заблокированный прогон (`blocked_result_limit`) был тупиком:
-- заявка с ним навсегда исчезала из очереди воркера (`not exists
-- impact_runs`), закрыть её было нельзя (`impactReviewComplete = false`
-- навечно), а пересчёт того же входа детерминированно дал бы тот же blocked —
-- прогон намертво пришит FK к `proposed_baseline_id` заявки и её неизменяемым
-- корням. Вдобавок расчёт узнавал о блокировке ПОСЛЕ полной материализации
-- результата: сборка путей рёбер на графе шире лимита выполнялась целиком и
-- выбрасывалась.
--
-- ЧТО СТАНОВИТСЯ. Четыре изменения, все аддитивные:
--
--   1. РАННЯЯ ОСТАНОВКА (§3.1). Ограниченный счётчик различных пар
--      (`_impact_pair_count_bounded`, `limit maxImpacts + 1`) решает исход
--      `blocked_result_limit` ДО материализации результата; дорогая сборка
--      для заблокированного прогона не выполняется вовсе. Содержание трёх
--      исходов DEC-034 не меняется.
--   2. ВЫТЕСНЕНИЕ (§3.3). Пересчёт той же заявки разрешён системе РОВНО в
--      одном случае: её единственный активный прогон — `blocked_result_limit`
--      УСТАРЕВШЕЙ версии политики (например, будущая политика поднимет
--      лимит). Новый прогон вытесняет старый (`superseded_at`,
--      `superseded_by_impact_run_id`); «один активный прогон на заявку»
--      закрепляется ЧАСТИЧНЫМ уникальным индексом (`where superseded_at is
--      null`) вместо безусловного `m4_impact_runs_request_key`.
--      `complete`/`partial_depth` не вытесняются никогда: по их карточкам
--      существуют или могут существовать человеческие рассмотрения. Blocked
--      ТОЙ ЖЕ политики не пересчитывается: результат детерминирован. Человек
--      расчёт по-прежнему не заказывает — триггер пересчёта только данные.
--   3. ОЧЕРЕДЬ (§3.3). `list_change_impact_backlog` снова предлагает заявку,
--      чей активный прогон — blocked устаревшей политики.
--   4. ПОВЕРХНОСТЬ И ДВЕРЬ РЕВЬЮ. Вытесненные прогоны не показываются
--      (история для аудита живёт в таблице); сохранённые truncate-and-keep
--      строки legacy-прогонов (backfill `20260813010000`) не показываются и
--      не рассматриваются; `allReturnedImpactsReviewed` вакуумно true для
--      blocked.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Ни одной новой человеческой двери: rescope — это
-- существующая `submit_change_request` (инкремент 1). Права ролей не
-- меняются; production-выключатель DEC-033 не затрагивается; V2/V3 закрыты.

begin;

-- === Вытеснение: колонки, парный CHECK, один активный прогон ==============

alter table projectceo_m4.impact_runs
  add column superseded_at timestamptz,
  add column superseded_by_impact_run_id uuid;

alter table projectceo_m4.impact_runs
  add constraint m4_impact_runs_superseded_pair_check
    check (
      (superseded_at is null) = (superseded_by_impact_run_id is null)
    );

-- `max_impacts` — СНИМОК политики на момент расчёта, а не её пин: прежний
-- CHECK (`between 1 and 5000`) вшивал текущее значение политики в таблицу и
-- делал подъём лимита будущей версией политики — саму предпосылку
-- superseding recalculation по DEC-037 §3.3 — невозможным by construction.
-- Остаётся sanity-граница.
alter table projectceo_m4.impact_runs
  drop constraint m4_impact_runs_max_impacts_check_dec034;
alter table projectceo_m4.impact_runs
  add constraint m4_impact_runs_max_impacts_check_dec037
    check (max_impacts between 1 and 1000000);

-- Безусловная уникальность «один прогон на заявку навсегда» уступает место
-- «одному АКТИВНОМУ прогону»: вытесненные остаются историей. Конкурентную
-- гарантию (два параллельных расчёта -> один прогон) продолжает давать
-- уникальный индекс — теперь частичный.
alter table projectceo_m4.impact_runs
  drop constraint m4_impact_runs_request_key;

create unique index m4_impact_runs_one_active_key
  on projectceo_m4.impact_runs (organization_id, project_id, change_request_id)
  where superseded_at is null;

-- === Append-only с одним санкционированным переходом ======================
--
-- Общий триггер `reject_append_only_mutation` (`20260717102000`) запрещает
-- прогону ЛЮБОЙ update — включая вытеснение. Заменяем его на прогонах
-- специализированным: разрешён РОВНО один односторонний переход — активный →
-- вытесненный (`superseded_at`/`superseded_by_impact_run_id` из null в
-- значение), при этом каждый прочий байт строки обязан совпасть. Содержимое
-- прогона остаётся неизменяемым; delete запрещён как и был. Имя триггера
-- сохраняется — состав триггеров таблицы проверяется тестами по имени.
create function projectceo_m4.reject_impact_run_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
    and old.superseded_at is null
    and old.superseded_by_impact_run_id is null
    and new.superseded_at is not null
    and new.superseded_by_impact_run_id is not null
    and (to_jsonb(new) - 'superseded_at' - 'superseded_by_impact_run_id')
      = (to_jsonb(old) - 'superseded_at' - 'superseded_by_impact_run_id')
  then
    return new;
  end if;
  raise exception using
    errcode = '55000',
    message = 'PROJECTCEO_M4_APPEND_ONLY';
end
$function$;

alter function projectceo_m4.reject_impact_run_mutation()
  owner to pi_table_owner;

revoke all on function projectceo_m4.reject_impact_run_mutation()
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

drop trigger impact_runs_append_only on projectceo_m4.impact_runs;
create trigger impact_runs_append_only
  before update or delete on projectceo_m4.impact_runs
  for each row execute function projectceo_m4.reject_impact_run_mutation();

-- === Ограниченный счётчик пар для ранней остановки (DEC-037 §3.1) =========

create function projectceo_m4._impact_pair_count_bounded(
  p_organization_id uuid,
  p_project_id uuid,
  p_change_request_id uuid,
  p_graph_version_id text,
  p_max_depth integer,
  p_limit bigint
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  with recursive roots as (
    select root.node_id changed_node_id
    from projectceo_m4.change_request_roots root
    where root.organization_id = p_organization_id
      and root.project_id = p_project_id
      and root.change_request_id = p_change_request_id
  ), walk as (
    select
      root.changed_node_id,
      root.changed_node_id current_node_id,
      array[root.changed_node_id]::text[] node_path,
      0 depth
    from roots root
    union all
    select
      walk.changed_node_id,
      edge.from_node_id,
      walk.node_path || edge.from_node_id,
      walk.depth + 1
    from walk
    join project_intelligence.version_edges version_edge
      on version_edge.organization_id = p_organization_id
     and version_edge.project_id = p_project_id
     and version_edge.version_id = p_graph_version_id
    join project_intelligence.graph_edges edge
      on edge.organization_id = version_edge.organization_id
     and edge.project_id = version_edge.project_id
     and edge.edge_id = version_edge.edge_id
     and edge.to_node_id = walk.current_node_id
     and edge.relation in (
       'depends_on', 'derived_from', 'specified_by', 'satisfies'
     )
    where walk.depth < p_max_depth
      and not edge.from_node_id = any(walk.node_path)
  )
  -- Те же пары, что у `_impact_pair_count`, но счёт ОГРАНИЧЕН: `limit`
  -- внутри даёт `min(истинное число, p_limit)`. Для решения «больше ли пар,
  -- чем maxImpacts» этого достаточно (сравнение с p_limit = maxImpacts + 1),
  -- а исполнителю разрешено остановиться, как только различных пар набралось
  -- p_limit, — точного числа заблокированный прогон не требует по контракту
  -- DEC-034 (нижняя граница maxImpacts + 1).
  select count(*)
  from (
    select distinct walk.changed_node_id, walk.current_node_id
    from walk
    join project_intelligence.version_nodes target
      on target.organization_id = p_organization_id
     and target.project_id = p_project_id
     and target.version_id = p_graph_version_id
     and target.node_id = walk.current_node_id
    where walk.current_node_id <> walk.changed_node_id
    limit p_limit
  ) bounded
$function$;

alter function projectceo_m4._impact_pair_count_bounded(
  uuid, uuid, uuid, text, integer, bigint
) owner to pi_table_owner;

-- Тот же контур закрытости, что у `_impact_pair_count` (`20260812010000`):
-- дефолтный EXECUTE PUBLIC снимается явно, счётчик достижим только изнутри
-- `security definer` функций владельца.
revoke all on function
  projectceo_m4._impact_pair_count_bounded(uuid, uuid, uuid, text, integer, bigint)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- === Расчёт: ранняя остановка + вытеснение ================================

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
  -- DEC-037 (OWNER DECISION 17.08.2026): recovery заблокированного прогона.
  v_active_run_id uuid;
  v_active_coverage text;
  v_active_policy_version text;
  v_probe bigint;
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
  -- DEC-037 §3.3: активный прогон блокирует пересчёт, КРОМЕ ровно одного
  -- случая — `blocked_result_limit`, посчитанный УСТАРЕВШЕЙ версией политики:
  -- его новый прогон вытесняет (`superseded_at`). `complete` и
  -- `partial_depth` не вытесняются никогда — по их карточкам существуют или
  -- могут существовать человеческие рассмотрения; blocked ТОЙ ЖЕ политики не
  -- пересчитывается — вход неизменяем (FK к proposed_baseline_id и корням),
  -- результат детерминирован.
  select ir.impact_run_id, ir.coverage_status, ir.policy_version
  into v_active_run_id, v_active_coverage, v_active_policy_version
  from projectceo_m4.impact_runs ir
  where ir.organization_id = v_context.organization_id
    and ir.project_id = project_id
    and ir.change_request_id = change_request_id
    and ir.superseded_at is null;
  if found then
    if v_active_coverage = 'blocked_result_limit'
       and v_active_policy_version is distinct from v_policy_version then
      update projectceo_m4.impact_runs ir
      set superseded_at = statement_timestamp(),
          superseded_by_impact_run_id = v_impact_run_id
      where ir.organization_id = v_context.organization_id
        and ir.project_id = project_id
        and ir.impact_run_id = v_active_run_id
        and ir.superseded_at is null;
      -- Параллельный пересчёт мог вытеснить первым: под READ COMMITTED
      -- проигравший увидит 0 строк после снятия блокировки и отвечает тем же
      -- отказом, что и повторный вызов, — воркер понимает его как
      -- `already_present`.
      if not found then
        perform projectceo_product._raise(
          'P1110',
          'invalid_transition',
          '{"reason":"IMPACT_ALREADY_CALCULATED"}'::jsonb
        );
      end if;
    else
      perform projectceo_product._raise(
        'P1110',
        'invalid_transition',
        '{"reason":"IMPACT_ALREADY_CALCULATED"}'::jsonb
      );
    end if;
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

  -- DEC-037 §3.1: ранняя остановка на maxImpacts + 1. Исход
  -- `blocked_result_limit` решается ограниченным счётчиком различных пар
  -- (`limit maxImpacts + 1`, без сборки путей) ДО материализации результата:
  -- дорогая сборка путей рёбер для заведомо заблокированного прогона не
  -- выполняется вовсе. Содержание трёх исходов не меняется — меняется только
  -- момент, когда система прекращает работу над заблокированным прогоном.
  v_probe := projectceo_m4._impact_pair_count_bounded(
    v_context.organization_id,
    project_id,
    change_request_id,
    v_target_graph_version_id,
    max_depth,
    v_max_impacts + 1
  );
  if v_probe > v_max_impacts then
    v_impacts := '[]'::jsonb;
    v_found := 0;
    v_is_truncated := true;
    v_truncation_reason := 'result_limit';
    v_coverage_status := 'blocked_result_limit';
    v_cutoff_reason := 'result_limit';
    v_has_more_beyond_depth := true;
    v_returned_impact_count := 0;
    v_known_impact_count_lower_bound := v_max_impacts + 1;
  else

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

  -- Лимит уже исключён ранней остановкой выше: сюда попадает только прогон,
  -- у которого различных пар не больше maxImpacts, и v_found равен счётчику
  -- пробы. Остаётся различить полноту по глубине.
  v_found := jsonb_array_length(v_impacts);

  -- Усечение по глубине: тот же обход на шаг глубже нашёл бы больше пар.
  -- Граф глубже политики — самая частая причина неполноты и самая
  -- незаметная.
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

  end if; -- конец ветви ранней остановки (DEC-037 §3.1)

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

-- === Дверь ревью: карточки blocked и вытесненных прогонов не рассматриваются

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
  -- DEC-037: состояние прогона, которому принадлежит карточка.
  v_run_coverage text;
  v_run_superseded_at timestamptz;
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
  -- DEC-037: карточки вытесненного прогона и сохранённые truncate-and-keep
  -- строки legacy-прогона `blocked_result_limit` (backfill `20260813010000`)
  -- не рассматриваются: у заблокированного прогона возвращённых карточек НЕТ
  -- по контракту DEC-034, а вытесненный прогон заменён новым.
  select run.coverage_status, run.superseded_at
  into v_run_coverage, v_run_superseded_at
  from projectceo_m4.impact_runs run
  where run.organization_id = v_context.organization_id
    and run.project_id = project_id
    and run.impact_run_id = impact_run_id;
  if v_run_superseded_at is not null then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"IMPACT_RUN_SUPERSEDED"}'::jsonb
    );
  end if;
  if v_run_coverage = 'blocked_result_limit' then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"IMPACT_RUN_BLOCKED"}'::jsonb
    );
  end if;
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

-- === Очередь воркера: blocked устаревшей политики возвращается ============

create or replace function projectceo_m4_api.list_change_impact_backlog(
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
        and ir.superseded_at is null
        -- DEC-037 §3.3: blocked-прогон УСТАРЕВШЕЙ версии политики заявку не
        -- закрывает — очередь предлагает её снова, и новый прогон вытеснит
        -- его. Blocked ТЕКУЩЕЙ политики — терминален (детерминированный
        -- повтор), complete/partial_depth закрывают заявку как раньше.
        and not (
          ir.coverage_status = 'blocked_result_limit'
          and ir.policy_version is distinct from
            (projectceo_m4._impact_policy() ->> 'version')
        )
    )
    -- DEC-036: `dead_letter` исключена из активной очереди СОВСЕМ — она не
    -- «работа», а операторская находка (видна через прямой запрос к
    -- `impact_worker_failures`, не через эту очередь). `retrying` исключена
    -- ТОЛЬКО пока не наступил `next_attempt_at` — пауза между попытками
    -- живёт в данных, а не в памяти воркера, который мог перезапуститься и
    -- ничего не забыть только потому, что помнить нечего.
    and not exists (
      select 1
      from projectceo_m4.impact_worker_failures f
      where f.organization_id = cr.organization_id
        and f.project_id = cr.project_id
        and f.change_request_id = cr.change_request_id
        and (f.status = 'dead_letter' or f.next_attempt_at > now())
    )
    order by cr.organization_id,
      cr.project_id,
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

-- === Поверхность чтения: только активные прогоны, blocked без карточек ====

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
            -- DEC-037: сохранённые truncate-and-keep строки legacy-прогона
            -- `blocked_result_limit` (backfill `20260813010000`) не
            -- показываются: заблокированный прогон отдаёт ноль карточек по
            -- контракту DEC-034, поверхность ведёт себя по счётчикам.
            and run.coverage_status <> 'blocked_result_limit'
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
        'allReturnedImpactsReviewed', (
          -- Вакуумно true для blocked: возвращённых карточек ноль по
          -- контракту, и сохранённые строки legacy-прогона этого не меняют.
          run.coverage_status = 'blocked_result_limit'
          or not exists (
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
        -- DEC-037: вытесненный прогон — история для аудита в базе, а не
        -- рабочая поверхность: показывается только активный.
        and run.superseded_at is null
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

-- === Guard: проверяем на живой базе, а не по тексту =======================

do $guard$
declare
  v_problem text;
begin
  -- 1. Старый безусловный ключ снят, частичный индекс активных прогонов на
  --    месте.
  if exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'm4_impact_runs_request_key'
      and conrelid = 'projectceo_m4.impact_runs'::regclass
  ) then
    raise exception 'PROJECTCEO_M4_UNCONDITIONAL_RUN_KEY_STILL_PRESENT';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'projectceo_m4'
      and tablename = 'impact_runs'
      and indexname = 'm4_impact_runs_one_active_key'
      and indexdef like '%WHERE%superseded_at IS NULL%'
  ) then
    raise exception 'PROJECTCEO_M4_ONE_ACTIVE_RUN_INDEX_MISSING';
  end if;

  -- 2. Ограниченный счётчик недостижим PostgREST-ролям: приватная схема,
  --    прав никто не получал.
  select format('%s', role_name) into v_problem
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  where pg_catalog.has_function_privilege(
    role_name,
    'projectceo_m4._impact_pair_count_bounded(uuid, uuid, uuid, text, integer, bigint)',
    'EXECUTE'
  )
  limit 1;
  if v_problem is not null then
    raise exception 'PROJECTCEO_M4_BOUNDED_COUNT_REACHABLE:%', v_problem;
  end if;

  -- 3. Список дверей вертикали НЕ изменился: рекавери не открыл ни одной
  --    новой человеческой двери (DEC-037 «ЧЕГО ЗДЕСЬ НЕТ»).
  if array_length(projectceo_m4._v1_impact_signatures(), 1) <> 2 then
    raise exception 'PROJECTCEO_M4_RECOVERY_CHANGED_V1_DOORS';
  end if;

  -- 4. Два активных прогона одной заявки физически невозможны: синтетическая
  --    вторая строка обязана упасть на частичном индексе.
  begin
    insert into projectceo_m4.impact_runs (
      organization_id, project_id, impact_run_id, change_request_id,
      package_id, target_baseline_id, target_graph_version_id, max_depth,
      algorithm, result_digest, created_by_id, is_truncated,
      truncation_reason, coverage_status, cutoff_reason,
      has_more_beyond_depth, known_impact_count_lower_bound,
      returned_impact_count, policy_version, max_impacts
    )
    select
      '00000000-0000-4000-8000-0000000000aa',
      '00000000-0000-4000-8000-0000000000aa',
      extensions.gen_random_uuid(),
      '00000000-0000-4000-8000-0000000000aa',
      '00000000-0000-4000-8000-0000000000aa',
      'guard', 'guard', 1, '{}'::jsonb,
      decode(repeat('00', 32), 'hex'), 'system:guard', false, null,
      'complete', null, false, 0, 0,
      'project-ceo-impact-policy/0.2', 5000
    from generate_series(1, 2);
    raise exception 'PROJECTCEO_M4_TWO_ACTIVE_RUNS_ALLOWED';
  exception
    when unique_violation then null;
    when foreign_key_violation then
      -- FK сработал раньше индекса — среда с включёнными constraint-триггерами
      -- на пустой базе. Инвариант индекса это не отменяет, но проверить его
      -- вставкой здесь нельзя; форма индекса уже проверена в п. 1.
      null;
  end;
end
$guard$;

commit;
