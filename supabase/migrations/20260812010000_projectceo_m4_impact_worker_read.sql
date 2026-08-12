-- V1 Impact: системное чтение очереди расчёта влияния и политика обхода.
--
-- Основание: OWNER M4 IMPLEMENTATION GO на V1 от 12.08.2026 поверх DEC-032
-- (`REMHAOS_A6_CLARIFICATION_M4_EXECUTION_LAYER_2026-08-12.md`). Открывается
-- ТОЛЬКО V1. V2 и V3 остаются `NOT AUTHORIZED`, и настоящая миграция не выдаёт
-- прав ни на одну их RPC.
--
-- ЧТО ЗДЕСЬ ПОЯВЛЯЕТСЯ И ЗАЧЕМ.
--
-- 1. `_impact_policy()` — versioned server-side constant. Глубина обхода
--    перестаёт быть параметром вызывающего: её решает сервер, одинаково для
--    всех проектов. Значение выбрано исполняемым benchmark
--    (`tests/db5/run-impact-benchmark.zsh`), а не на глаз, и вместе со
--    значением зафиксирована версия политики — чтобы смена числа была видна в
--    данных, а не только в диффе.
--
-- 2. `_impact_pair_count()` — тот же обход, что в `calculate_change_impact`, но
--    считающий только пары «изменённый узел → затронутый». Нужен ровно для
--    одного: понять, вернул бы обход БОЛЬШЕ на глубину глубже. Без этого
--    ограничение глубины работает молча — а молча усечённый результат влияния
--    хуже отсутствующего: человек рассмотрит семь карточек и решит, что это
--    всё.
--
-- 3. `calculate_change_impact_policy_bound()` — дверь воркера. Берёт глубину из
--    политики, отказывается считать при усечении и делегирует существующей
--    `calculate_change_impact`. Прежняя дверь не трогается: её семантику
--    проверяет DB5, и переписывать проверенную функцию ради обёртки не нужно.
--
-- 4. `list_change_impact_backlog()` — очередь. Без неё воркер не знает, для
--    каких заявок расчёта ещё нет, а читать `projectceo_m4` напрямую он не
--    может: схема приватная и Data API её не отдаёт.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Ни одной человеческой двери. Права выдаются только
-- `service_role`; `authenticated` и `anon` не получают ничего, и миграция
-- падает, если это перестанет быть правдой. Лимит 5000 impacts не вводится
-- заново — он уже живёт в `calculate_change_impact`
-- (`IMPACT_RESULT_LIMIT_EXCEEDED`), и benchmark проверяет, что он срабатывает.

begin;

-- Политика обхода. `immutable` намеренно: это константа, а не настройка.
-- Менять её — значит выпускать новую версию политики отдельной миграцией, и
-- тогда `algorithm.policyVersion` в сохранённых прогонах покажет, каким
-- правилом считали старые.
create function projectceo_m4._impact_policy()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'version', 'project-ceo-impact-policy/0.1',
    'maxDepth', 8,
    'maxImpacts', 5000
  )
$function$;

alter function projectceo_m4._impact_policy() owner to pi_table_owner;

-- Сколько различных пар «изменённый узел → затронутый узел» даёт обход на
-- заданную глубину. Обход повторяет `calculate_change_impact` в той части,
-- которая влияет на состав результата: те же отношения, тот же запрет
-- повторного посещения узла в пределах пути, та же граница по длине.
create function projectceo_m4._impact_pair_count(
  p_organization_id uuid,
  p_project_id uuid,
  p_change_request_id uuid,
  p_graph_version_id text,
  p_max_depth integer
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
  -- Считаются ровно те пары, которые попали бы в результат: узел, отличный от
  -- корня, и существующий в целевой версии графа.
  select count(distinct (walk.changed_node_id, walk.current_node_id))
  from walk
  join project_intelligence.version_nodes target
    on target.organization_id = p_organization_id
   and target.project_id = p_project_id
   and target.version_id = p_graph_version_id
   and target.node_id = walk.current_node_id
  where walk.current_node_id <> walk.changed_node_id
$function$;

alter function projectceo_m4._impact_pair_count(uuid, uuid, uuid, text, integer)
  owner to pi_table_owner;

-- Дверь воркера: глубина из политики, отказ при усечении, делегирование.
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
  v_organization_id uuid;
  v_graph_version_id text;
  v_within bigint;
  v_deeper bigint;
begin
  select cr.organization_id, pb.graph_version_id
  into v_organization_id, v_graph_version_id
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

  -- Проба нужна только там, где расчёт действительно произойдёт. Если прогон
  -- уже есть, делегат ответит `IMPACT_ALREADY_CALCULATED` или повтором по
  -- ключу — и семантику повтора обёртка менять не имеет права: иначе повтор
  -- после изменения графа отвечал бы отказом вместо сохранённого результата.
  if not exists (
    select 1
    from projectceo_m4.impact_runs ir
    where ir.organization_id = v_organization_id
      and ir.project_id = project_id
      and ir.change_request_id = change_request_id
  ) then
    v_within := projectceo_m4._impact_pair_count(
      v_organization_id, project_id, change_request_id,
      v_graph_version_id, v_max_depth
    );
    v_deeper := projectceo_m4._impact_pair_count(
      v_organization_id, project_id, change_request_id,
      v_graph_version_id, v_max_depth + 1
    );
    if v_deeper > v_within then
      -- Молча отдать усечённый результат нельзя: человек примет решение по
      -- неполной картине и не узнает об этом. Отказ громкий и с числами.
      perform projectceo_product._raise(
        'P1111',
        'validation_failed',
        jsonb_build_object(
          'reason', 'IMPACT_DEPTH_TRUNCATED',
          'policyVersion', v_policy ->> 'version',
          'maxDepth', v_max_depth,
          'pairsWithinDepth', v_within,
          'pairsOneDeeper', v_deeper
        )
      );
    end if;
  end if;

  return projectceo_m4_api.calculate_change_impact(
    project_id,
    change_request_id,
    v_max_depth,
    expected_state_revision,
    idempotency_key
  );
end
$function$;

alter function projectceo_m4_api.calculate_change_impact_policy_bound(
  uuid, uuid, bigint, text
) owner to pi_table_owner;

-- Очередь расчёта: заявки на изменение, у которых прогона влияния ещё нет.
--
-- Заявки с неразрешимым baseline из очереди НЕ исключаются намеренно. Убрать
-- их фильтром значило бы, что сломанная строка никогда не всплывёт: воркер
-- всегда видел бы пустую очередь и отчитывался «работы нет». Пусть лучше
-- обёртка ответит `not_found`, а воркер это напечатает.
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
      -- Ревизия состояния нужна воркеру для `expected_state_revision`. Между
      -- чтением очереди и вызовом она может сдвинуться — тогда расчёт ответит
      -- `stale_state`, и это нормальный исход гонки, а не ошибка воркера.
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
    -- Порядок детерминированный: два параллельных воркера обязаны видеть одну
    -- очередь одинаково, иначе «повтор» перестал бы быть повтором.
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

alter function projectceo_m4_api.list_change_impact_backlog(integer)
  owner to pi_table_owner;

revoke all on function
  projectceo_m4._impact_policy(),
  projectceo_m4._impact_pair_count(uuid, uuid, uuid, text, integer),
  projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text),
  projectceo_m4_api.list_change_impact_backlog(integer)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Только системная identity, и только на две публичные двери. Приватные
-- helper-функции не выдаются никому: их зовёт обёртка от имени владельца.
grant execute on function
  projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text),
  projectceo_m4_api.list_change_impact_backlog(integer)
  to service_role;

do $guard$
declare
  v_reachable text;
begin
  -- Человеческие роли не достают до воркерного контура ничем.
  select format('%s:%s', role_name, signature) into v_reachable
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_REACHABLE_BY_HUMAN_ROLE:%', v_reachable;
  end if;

  select signature into v_reachable
  from unnest(array[
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)'
  ]) signature
  where not pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_UNREACHABLE_BY_SYSTEM:%', v_reachable;
  end if;

  -- V1 не открывает V2 и V3. Проверка стоит здесь, а не только в тестах,
  -- потому что ошибиться легче всего в момент выдачи прав.
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

  -- Прежняя дверь расчёта как была системной, так и остаётся.
  if pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_M4_IMPACT_CALC_REACHABLE_BY_AUTHENTICATED';
  end if;
end
$guard$;

commit;
