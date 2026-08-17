\set ON_ERROR_STOP on

-- V1 Impact: recovery заблокированного прогона (DEC-037, OWNER DECISION
-- 17.08.2026 §3).
--
-- Что доказывается, в порядке сценария:
--
--   1. Широкий граф (maxImpacts + 1 листьев) даёт `blocked_result_limit`;
--      ранняя остановка не меняет ни одного поля контракта DEC-034.
--   2. Blocked ТЕКУЩЕЙ политики терминален: очередь воркера заявку НЕ
--      предлагает, повторный расчёт с новым ключом отклоняется
--      `IMPACT_ALREADY_CALCULATED` — вход неизменяем, результат
--      детерминирован.
--   3. Blocked УСТАРЕВШЕЙ политики — НЕ терминален: очередь предлагает
--      заявку снова, новый прогон вытесняет старый (`superseded_at`,
--      `superseded_by_impact_run_id`), активный прогон ровно один.
--   4. Подъём лимита политики лечит блокировку: после бампа заявка
--      возвращается в очередь, пересчёт даёт `complete` и вытесняет blocked.
--   5. Сохранённые truncate-and-keep карточки legacy-прогона (backfill
--      `20260813010000`) не рассматриваются: до вытеснения дверь ревью
--      отвечает `IMPACT_RUN_BLOCKED`, после — `IMPACT_RUN_SUPERSEDED`;
--      сами строки никуда не деваются (append-only).
--
-- Сценарий откатывается целиком: следующие файлы DB5 обязаны видеть прежнее
-- состояние (включая живую версию `_impact_policy()` — её подмена тоже
-- внутри транзакции).

begin;

select
  cr.organization_id::text as org,
  cr.package_id::text as pkg,
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
\gset rec37_

select set_config('projectceo.rec37_org', :'rec37_org', true);
select set_config('projectceo.rec37_pkg', :'rec37_pkg', true);
select set_config('projectceo.rec37_to_baseline', :'rec37_to_baseline', true);
select set_config('projectceo.rec37_from_version', :'rec37_from_version', true);
select set_config('projectceo.rec37_graph_version', :'rec37_graph_version', true);
select set_config('projectceo.rec37_state_revision', :'rec37_state_revision', true);

set local session_replication_role = replica;

do $rec37_fixture$
declare
  v_org uuid := current_setting('projectceo.rec37_org')::uuid;
  v_project uuid := '41111111-1111-4111-8111-111111111111';
  v_pkg uuid := current_setting('projectceo.rec37_pkg')::uuid;
  v_version text := current_setting('projectceo.rec37_graph_version');
  -- Лимит читается динамически: звезда всегда на один лист шире живого
  -- maxImpacts, независимо от его числа.
  v_max integer := (projectceo_m4._impact_policy() ->> 'maxImpacts')::integer;
begin
  perform set_config('projectceo.rec37_max', v_max::text, true);

  insert into project_intelligence.graph_nodes (
    organization_id, project_id, node_id, kind, stable_key, current_revision_id
  )
  select v_org, v_project, node_id, 'deliverable',
    'rec37:' || node_id, 'rev-' || node_id
  from (
    select 'rec37-hub' node_id
    union all
    select 'rec37-leaf-' || lpad(leaf::text, 6, '0')
    from generate_series(1, v_max + 1) leaf
  ) nodes;

  insert into project_intelligence.version_nodes (
    organization_id, project_id, version_id, node_id, revision_id
  )
  select v_org, v_project, v_version, node.node_id, node.current_revision_id
  from project_intelligence.graph_nodes node
  where node.organization_id = v_org
    and node.project_id = v_project
    and node.node_id like 'rec37-%';

  insert into project_intelligence.graph_edges (
    organization_id, project_id, edge_id, from_node_id, to_node_id, relation
  )
  select v_org, v_project,
    'rec37-edge-' || lpad(leaf::text, 6, '0'),
    'rec37-leaf-' || lpad(leaf::text, 6, '0'),
    'rec37-hub',
    'depends_on'
  from generate_series(1, v_max + 1) leaf;

  insert into project_intelligence.version_edges (
    organization_id, project_id, version_id, edge_id
  )
  select v_org, v_project, v_version, edge.edge_id
  from project_intelligence.graph_edges edge
  where edge.organization_id = v_org
    and edge.project_id = v_project
    and edge.edge_id like 'rec37-edge-%';

  -- Две заявки на один хаб: `a` живёт весь сценарий текущей политикой;
  -- `b` изображает состояние ПОСЛЕ backfill `20260813010000` — legacy
  -- blocked-прогон устаревшей политики с сохранённой truncate-and-keep
  -- карточкой. Разные фиктивные from_baseline обходят уникальность перехода
  -- в пределах пакета — как в `29_impact_coverage_dec034.sql`.
  insert into projectceo_m4.change_requests (
    organization_id, project_id, change_request_id, package_id,
    from_baseline_id, proposed_baseline_id, from_production_package_version_id,
    protected_reason, reason_digest, initiator_role, delta_cost_rub, delta_days,
    requested_by_user_id
  )
  select v_org, v_project, request.id, v_pkg,
    request.from_baseline,
    current_setting('projectceo.rec37_to_baseline'),
    current_setting('projectceo.rec37_from_version'),
    request.reason,
    pg_catalog.sha256(convert_to(request.reason, 'UTF8')),
    'architect', 0, 0,
    '31111111-1111-4111-8111-111111111111'
  from (values
    ('d0000000-0000-4000-8000-00000000000a'::uuid, 'rec37-baseline-a', 'DEC-037 recovery: current-policy blocked'),
    ('d0000000-0000-4000-8000-00000000000b'::uuid, 'rec37-baseline-b', 'DEC-037 recovery: legacy stale-policy blocked')
  ) request(id, from_baseline, reason);

  insert into projectceo_m4.change_request_roots (
    organization_id, project_id, change_request_id, package_id,
    from_baseline_id, proposed_baseline_id, target_kind, node_id,
    from_revision_id, to_revision_id
  )
  select v_org, v_project, root.id, v_pkg,
    root.from_baseline,
    current_setting('projectceo.rec37_to_baseline'),
    'decision_revision', 'rec37-hub',
    'rev-rec37-hub-from',
    'rev-rec37-hub'
  from (values
    ('d0000000-0000-4000-8000-00000000000a'::uuid, 'rec37-baseline-a'),
    ('d0000000-0000-4000-8000-00000000000b'::uuid, 'rec37-baseline-b')
  ) root(id, from_baseline);

  -- Legacy blocked-прогон заявки `b`: форма ПОСЛЕ backfill DEC-034 —
  -- blocked по счётчикам, карточка сохранена (truncate-and-keep PR #94),
  -- политика устаревшая 0.1.
  insert into projectceo_m4.impact_runs (
    organization_id, project_id, impact_run_id, change_request_id, package_id,
    target_baseline_id, target_graph_version_id, max_depth, algorithm,
    result_digest, created_by_id,
    is_truncated, truncation_reason, calculated_depth, policy_max_depth,
    coverage_status, cutoff_reason, has_more_beyond_depth,
    known_impact_count_lower_bound, returned_impact_count, policy_version,
    max_impacts
  ) values (
    v_org, v_project,
    'd0000000-0000-4000-8000-0000000000b1',
    'd0000000-0000-4000-8000-00000000000b',
    v_pkg,
    current_setting('projectceo.rec37_to_baseline'),
    v_version, 8,
    '{"version":"project-ceo-impact/0.2"}'::jsonb,
    decode(repeat('b1', 32), 'hex'), 'system:rec37-legacy',
    true, 'result_limit', 1, 8,
    'blocked_result_limit', 'result_limit', true,
    v_max + 1, 0, 'project-ceo-impact-policy/0.1', v_max
  );

  insert into projectceo_m4.impacts (
    organization_id, project_id, impact_id, impact_run_id, change_request_id,
    package_id, target_graph_version_id, changed_node_id, changed_revision_id,
    impacted_node_id, impacted_revision_id, distance, node_path
  ) values (
    v_org, v_project, 'impact:rec37-legacy-1',
    'd0000000-0000-4000-8000-0000000000b1',
    'd0000000-0000-4000-8000-00000000000b',
    v_pkg, v_version,
    'rec37-hub', 'rev-rec37-hub',
    'rec37-leaf-000001', 'rev-rec37-leaf-000001', 1,
    array['rec37-hub', 'rec37-leaf-000001']
  );
end
$rec37_fixture$;

set local session_replication_role = origin;

analyze project_intelligence.graph_edges;
analyze project_intelligence.graph_nodes;
analyze project_intelligence.version_edges;
analyze project_intelligence.version_nodes;

-- === 1. Blocked текущей политикой =========================================

set local role service_role;

do $rec37_blocked$
declare
  v_response jsonb;
  v_max integer := current_setting('projectceo.rec37_max')::integer;
begin
  v_response := projectceo_m4_api.calculate_change_impact_policy_bound(
    '41111111-1111-4111-8111-111111111111',
    'd0000000-0000-4000-8000-00000000000a'::uuid,
    current_setting('projectceo.rec37_state_revision')::bigint,
    'db5-rec37-blocked-current'
  );
  if (v_response #>> '{result,coverageStatus}') is distinct from 'blocked_result_limit'
    or (v_response #>> '{result,returnedImpactCount}')::integer <> 0
    or (v_response #>> '{result,knownImpactCountLowerBound}')::integer <> v_max + 1 then
    raise exception 'DB5_REC37_BLOCKED_SHAPE_UNEXPECTED:%', v_response #> '{result}';
  end if;
  perform set_config(
    'projectceo.rec37_state_revision', v_response ->> 'stateRevision', true
  );
end
$rec37_blocked$;

-- === 2. Blocked текущей политики терминален ===============================

do $rec37_terminal$
declare
  v_backlog jsonb;
  v_raised boolean := false;
begin
  -- Очередь не предлагает заявку `a` (blocked текущей политикой), но
  -- предлагает `b` (legacy blocked устаревшей 0.1).
  v_backlog := projectceo_m4_api.list_change_impact_backlog(1000);
  if exists (
    select 1 from jsonb_array_elements(v_backlog -> 'data') item
    where item ->> 'changeRequestId' = 'd0000000-0000-4000-8000-00000000000a'
  ) then
    raise exception 'DB5_REC37_CURRENT_BLOCKED_REOFFERED';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_backlog -> 'data') item
    where item ->> 'changeRequestId' = 'd0000000-0000-4000-8000-00000000000b'
  ) then
    raise exception 'DB5_REC37_STALE_BLOCKED_NOT_REOFFERED';
  end if;

  -- Повторный расчёт `a` новым ключом — отказ, состояние не меняется.
  begin
    perform projectceo_m4_api.calculate_change_impact_policy_bound(
      '41111111-1111-4111-8111-111111111111',
      'd0000000-0000-4000-8000-00000000000a'::uuid,
      current_setting('projectceo.rec37_state_revision')::bigint,
      'db5-rec37-blocked-current-retry'
    );
  exception
    when sqlstate 'P1110' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'DB5_REC37_SAME_POLICY_RECALC_ALLOWED';
  end if;
end
$rec37_terminal$;

-- === 3. Legacy карточка blocked-прогона не рассматривается ================
--
-- Отказ ревью откатывается собственной subtransaction DO-блока: внешняя
-- транзакция сценария (и фикстура в ней) продолжает жить.

reset role;

-- Текущая ревизия — в GUC: `\gset` внутрь plpgsql не достаёт.
select set_config(
  'projectceo.rec37_review_sr',
  (
    select state_revision::text
    from project_intelligence.project_workflows
    where project_id = '41111111-1111-4111-8111-111111111111'
  ),
  true
);

set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $rec37_review_blocked$
declare
  v_raised boolean := false;
begin
  begin
    perform projectceo_m4_api.review_change_impact(
      '41111111-1111-4111-8111-111111111111',
      'd0000000-0000-4000-8000-0000000000b1'::uuid,
      'impact:rec37-legacy-1',
      'resolved',
      'DEC-037: attempt to review a preserved legacy card',
      current_setting('projectceo.rec37_review_sr')::bigint,
      'db5-rec37-review-blocked'
    );
  exception
    when sqlstate 'P1110' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'DB5_REC37_LEGACY_CARD_REVIEW_ALLOWED';
  end if;
end
$rec37_review_blocked$;

reset role;

-- === 4. Пересчёт legacy stale-blocked текущей политикой: вытеснение =======

set local role service_role;

do $rec37_supersede_stale$
declare
  v_response jsonb;
  v_max integer := current_setting('projectceo.rec37_max')::integer;
begin
  v_response := projectceo_m4_api.calculate_change_impact_policy_bound(
    '41111111-1111-4111-8111-111111111111',
    'd0000000-0000-4000-8000-00000000000b'::uuid,
    current_setting('projectceo.rec37_state_revision')::bigint,
    'db5-rec37-supersede-stale'
  );
  -- Звезда шире и текущего лимита: новый прогон снова blocked — но уже
  -- ТЕКУЩЕЙ политикой, и он вытесняет legacy.
  if (v_response #>> '{result,coverageStatus}') is distinct from 'blocked_result_limit' then
    raise exception 'DB5_REC37_STALE_RECALC_NOT_BLOCKED:%', v_response #> '{result}';
  end if;
  perform set_config(
    'projectceo.rec37_state_revision', v_response ->> 'stateRevision', true
  );
end
$rec37_supersede_stale$;

reset role;

do $rec37_supersede_check$
declare
  v_active integer;
  v_superseded record;
  v_cards integer;
begin
  select count(*) into v_active
  from projectceo_m4.impact_runs run
  where run.project_id = '41111111-1111-4111-8111-111111111111'
    and run.change_request_id = 'd0000000-0000-4000-8000-00000000000b'::uuid
    and run.superseded_at is null;
  if v_active <> 1 then
    raise exception 'DB5_REC37_ACTIVE_RUN_COUNT:%', v_active;
  end if;

  select run.superseded_at, run.superseded_by_impact_run_id
  into v_superseded
  from projectceo_m4.impact_runs run
  where run.impact_run_id = 'd0000000-0000-4000-8000-0000000000b1'::uuid;
  if v_superseded.superseded_at is null
    or v_superseded.superseded_by_impact_run_id is null then
    raise exception 'DB5_REC37_LEGACY_NOT_SUPERSEDED';
  end if;
  if not exists (
    select 1 from projectceo_m4.impact_runs run
    where run.impact_run_id = v_superseded.superseded_by_impact_run_id
      and run.superseded_at is null
      and run.policy_version = (projectceo_m4._impact_policy() ->> 'version')
  ) then
    raise exception 'DB5_REC37_SUPERSEDING_RUN_WRONG';
  end if;

  -- Append-only: сохранённая truncate-and-keep карточка никуда не делась.
  select count(*) into v_cards
  from projectceo_m4.impacts impact
  where impact.impact_run_id = 'd0000000-0000-4000-8000-0000000000b1'::uuid;
  if v_cards <> 1 then
    raise exception 'DB5_REC37_LEGACY_CARDS_LOST:%', v_cards;
  end if;
end
$rec37_supersede_check$;

-- === 5. Карточка вытесненного прогона не рассматривается ==================

select set_config(
  'projectceo.rec37_review_sr',
  (
    select state_revision::text
    from project_intelligence.project_workflows
    where project_id = '41111111-1111-4111-8111-111111111111'
  ),
  true
);

set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $rec37_review_superseded$
declare
  v_raised boolean := false;
begin
  begin
    perform projectceo_m4_api.review_change_impact(
      '41111111-1111-4111-8111-111111111111',
      'd0000000-0000-4000-8000-0000000000b1'::uuid,
      'impact:rec37-legacy-1',
      'resolved',
      'DEC-037: attempt to review a superseded-run card',
      current_setting('projectceo.rec37_review_sr')::bigint,
      'db5-rec37-review-superseded'
    );
  exception
    when sqlstate 'P1110' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'DB5_REC37_SUPERSEDED_CARD_REVIEW_ALLOWED';
  end if;
end
$rec37_review_superseded$;

reset role;

-- === 6. Подъём лимита политики лечит блокировку заявки `a` ================

-- Подмена политики — внутри транзакции сценария, откат вернёт живую версию.
-- Форма и права функции сохраняются (`create or replace`).
create or replace function projectceo_m4._impact_policy()
returns jsonb
language sql
immutable
set search_path = ''
as $rec37_policy$
  select jsonb_build_object(
    'version', 'project-ceo-impact-policy/0.3-rec37-test',
    'maxDepth', 7,
    'maxImpacts',
      current_setting('projectceo.rec37_max')::integer + 100
  )
$rec37_policy$;

set local role service_role;

do $rec37_healed$
declare
  v_backlog jsonb;
  v_response jsonb;
  v_max integer := current_setting('projectceo.rec37_max')::integer;
begin
  -- Заявка `a` вернулась в очередь: её blocked посчитан политикой 0.2, а
  -- активная теперь 0.3-rec37-test.
  v_backlog := projectceo_m4_api.list_change_impact_backlog(1000);
  if not exists (
    select 1 from jsonb_array_elements(v_backlog -> 'data') item
    where item ->> 'changeRequestId' = 'd0000000-0000-4000-8000-00000000000a'
  ) then
    raise exception 'DB5_REC37_HEALED_NOT_REOFFERED';
  end if;

  v_response := projectceo_m4_api.calculate_change_impact_policy_bound(
    '41111111-1111-4111-8111-111111111111',
    'd0000000-0000-4000-8000-00000000000a'::uuid,
    current_setting('projectceo.rec37_state_revision')::bigint,
    'db5-rec37-healed'
  );
  if (v_response #>> '{result,coverageStatus}') is distinct from 'complete'
    or (v_response #>> '{result,returnedImpactCount}')::integer <> v_max + 1 then
    raise exception 'DB5_REC37_HEALED_SHAPE_UNEXPECTED:%', v_response #> '{result}';
  end if;
  perform set_config(
    'projectceo.rec37_state_revision', v_response ->> 'stateRevision', true
  );
end
$rec37_healed$;

reset role;

do $rec37_healed_check$
declare
  v_active integer;
begin
  select count(*) into v_active
  from projectceo_m4.impact_runs run
  where run.project_id = '41111111-1111-4111-8111-111111111111'
    and run.change_request_id = 'd0000000-0000-4000-8000-00000000000a'::uuid
    and run.superseded_at is null;
  if v_active <> 1 then
    raise exception 'DB5_REC37_HEALED_ACTIVE_COUNT:%', v_active;
  end if;
  if not exists (
    select 1 from projectceo_m4.impact_runs run
    where run.project_id = '41111111-1111-4111-8111-111111111111'
      and run.change_request_id = 'd0000000-0000-4000-8000-00000000000a'::uuid
      and run.superseded_at is null
      and run.coverage_status = 'complete'
  ) then
    raise exception 'DB5_REC37_HEALED_ACTIVE_NOT_COMPLETE';
  end if;
end
$rec37_healed_check$;

rollback;

select 'DB5_IMPACT_RECOVERY_DEC037_OK' as result;
