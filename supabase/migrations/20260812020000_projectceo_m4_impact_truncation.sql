-- V1 Impact: усечение становится ДАННЫМИ, а не отказом.
--
-- Основание: OWNER DECISION от 12.08.2026 поверх M4 IMPLEMENTATION GO на V1.
-- Прежнее поведение — отказ при достижении любой границы — было принято как
-- «лучше ничего, чем молча неполно». Практика показала третий вариант, лучше
-- обоих: сохранить найденное и сделать неполноту видимой.
--
-- ЧТО МЕНЯЕТСЯ ПО СУЩЕСТВУ.
--
-- 1. `calculate_change_impact` больше не выбрасывает найденное влияние при
--    превышении лимита: результат усекается детерминированно и помечается.
--    `IMPACT_RESULT_LIMIT_EXCEEDED` как исход исчезает.
-- 2. `calculate_change_impact_policy_bound` больше не отказывает при усечении
--    по глубине: обнаружение переехало внутрь расчёта, где его можно записать
--    в ту же строку и в тот же логический результат — атомарно, а не вторым
--    шагом, который может не случиться.
-- 3. Прогон с признаком неполноты РАССМАТРИВАТЬ можно, а ЗАКРЫТЬ — нельзя:
--    `allImpactsReviewed` требует ещё и явного подтверждения архитектора.
--    Без этого «рассмотрено всё» означало бы, что человек видел всё влияние,
--    а он видел его часть.
-- 4. Читающая RPC отдаёт признаки наружу и считает `reviewComplete` честно.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Ни одного нового права `authenticated` в постоянной
-- миграции: новая человеческая RPC отзывается здесь же и открывается только
-- скриптом одноразовой среды, как инкремент 1 и V1 (DEC-029 без изменений).
-- Production не открывается: `M4_PRODUCTION_ENABLED` не наступил.

begin;

-- Признаки неполноты живут на строке прогона, а не выводятся на лету: прогон
-- неизменяем после создания, и его неполнота — такой же факт, как его хеш.
alter table projectceo_m4.impact_runs
  add column is_truncated boolean not null default false,
  add column truncation_reason text,
  add column calculated_depth integer,
  add column policy_max_depth integer;

alter table projectceo_m4.impact_runs
  add constraint m4_impact_runs_truncation_reason_check
    check (truncation_reason is null or truncation_reason in (
      'depth_limit', 'result_limit'
    )),
  -- Признак и причина не расходятся: усечено без причины и причина без
  -- усечения одинаково означали бы, что одно из двух записали по ошибке.
  add constraint m4_impact_runs_truncation_pair_check
    check (
      (is_truncated and truncation_reason is not null)
      or (not is_truncated and truncation_reason is null)
    ),
  add constraint m4_impact_runs_calculated_depth_check
    check (calculated_depth is null or calculated_depth between 0 and 20),
  add constraint m4_impact_runs_policy_max_depth_check
    check (policy_max_depth is null or policy_max_depth between 1 and 20);

-- Подтверждение неполноты архитектором. Отдельная таблица, а не колонка на
-- прогоне: у подтверждения есть автор, время и причина, а прогон остаётся
-- неизменяемым.
create table projectceo_m4.impact_truncation_acknowledgements (
  organization_id uuid not null,
  project_id uuid not null,
  acknowledgement_id uuid not null default extensions.gen_random_uuid(),
  impact_run_id uuid not null,
  package_id uuid not null,
  protected_reason text not null
    check (
      char_length(btrim(protected_reason)) between 1 and 4000
      and protected_reason = btrim(protected_reason)
    ),
  reason_digest bytea not null check (octet_length(reason_digest) = 32),
  acknowledged_by_user_id uuid not null,
  acknowledged_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, acknowledgement_id),
  -- Одно подтверждение на прогон. Второе не добавило бы решения, но добавило
  -- бы вопрос, какое из них считать действующим.
  constraint m4_impact_truncation_ack_unique
    unique (organization_id, project_id, impact_run_id),
  constraint m4_impact_truncation_ack_run_fkey
    foreign key (organization_id, project_id, impact_run_id)
    references projectceo_m4.impact_runs (
      organization_id, project_id, impact_run_id
    )
    on delete restrict
);

-- Тот же контур безопасности, что у любой таблицы схемы (`20260717102000`):
-- владелец, RLS с `force`, отзыв всех прав у прикладных ролей и единственная
-- политика для владельца. Прямого доступа к данным модуля нет ни у кого —
-- ходят только через `security definer` RPC.
alter table projectceo_m4.impact_truncation_acknowledgements
  owner to pi_table_owner;
alter table projectceo_m4.impact_truncation_acknowledgements
  enable row level security;
alter table projectceo_m4.impact_truncation_acknowledgements
  force row level security;
revoke all on table projectceo_m4.impact_truncation_acknowledgements
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy impact_truncation_acknowledgements_internal_owner
  on projectceo_m4.impact_truncation_acknowledgements
  for all to pi_table_owner using (true) with check (true);

-- Словари операций и событий расширяются одним значением каждый.
--
-- ЛОВУШКА ВОКРУГ ПЕРЕПИСЫВАНИЯ СПИСКА. CHECK не дополняется — его приходится
-- объявлять заново целиком, и при первом написании этой миграции ручное
-- копирование потеряло два значения (`distribute_release_request_bound` и
-- `acknowledge_release_request_bound`). Поймал это харнесс AP1, а не глаза.
--
-- Поэтому старый список снимается с базы ДО замены и сверяется с новым после:
-- значение, принимавшееся раньше и переставшее приниматься теперь, роняет
-- миграцию. Расширение словаря остаётся ручным и видимым в диффе, а вот
-- незаметная потеря — нет.
do $operation_dictionary$
declare
  v_old text[];
  v_new text[];
  v_lost text;
begin
  select array_agg(match[1] order by match[1]) into v_old
  from pg_catalog.pg_constraint constraint_row,
    lateral regexp_matches(
      pg_catalog.pg_get_constraintdef(constraint_row.oid), $re$'([a-z0-9_]+)'$re$, 'g'
    ) match
  where constraint_row.conname = 'command_records_operation_check'
    and constraint_row.conrelid = 'projectceo_product.command_records'::regclass;

  alter table projectceo_product.command_records
    drop constraint command_records_operation_check;
  alter table projectceo_product.command_records
    add constraint command_records_operation_check check (operation in (
      'append_decision_revision', 'append_selection_revision', 'append_price_observation',
      'append_system_decision_revision', 'append_system_selection_revision',
      'create_approval_package', 'submit_approval_package', 'review_approval_package',
      'publish_project_baseline', 'publish_production_package_version', 'build_release_artifact',
      'distribute_release', 'distribute_release_request_bound',
      'acknowledge_release', 'acknowledge_release_request_bound',
      'approve_no_change', 'submit_change_request',
      'calculate_change_impact', 'review_change_impact', 'define_milestone',
      'register_photo_evidence', 'review_photo_evidence', 'accept_milestone',
      'register_handover_document', 'build_construction_handover', 'append_m2_room_revision',
      'append_m2_variant_revision', 'append_m2_material_revision', 'append_m2_budget_revision',
      'append_m2_client_handoff_revision', 'append_m2_approved_commit_revision',
      'append_m2_layout_version_revision', 'submit_m2_client_review',
      'review_m2_client_submission', 'publish_m2_m3_handoff',
      'register_m3_documentation_sheet', 'attach_m3_documentation_sheet_specifications',
      'acknowledge_impact_truncation'
    ));

  select array_agg(match[1] order by match[1]) into v_new
  from pg_catalog.pg_constraint constraint_row,
    lateral regexp_matches(
      pg_catalog.pg_get_constraintdef(constraint_row.oid), $re$'([a-z0-9_]+)'$re$, 'g'
    ) match
  where constraint_row.conname = 'command_records_operation_check'
    and constraint_row.conrelid = 'projectceo_product.command_records'::regclass;

  select value into v_lost
  from unnest(v_old) value
  where not value = any(v_new)
  limit 1;
  if v_lost is not null then
    raise exception 'PROJECTCEO_COMMAND_OPERATION_DROPPED:%', v_lost;
  end if;
end
$operation_dictionary$;

do $event_dictionary$
declare
  v_old text[];
  v_new text[];
  v_lost text;
begin
  select array_agg(match[1] order by match[1]) into v_old
  from pg_catalog.pg_constraint constraint_row,
    lateral regexp_matches(
      pg_catalog.pg_get_constraintdef(constraint_row.oid), $re$'([a-z0-9_]+)'$re$, 'g'
    ) match
  where constraint_row.conname = 'audit_events_event_type_check'
    and constraint_row.conrelid = 'projectceo_product.audit_events'::regclass;

  alter table projectceo_product.audit_events
    drop constraint audit_events_event_type_check;
  alter table projectceo_product.audit_events
    add constraint audit_events_event_type_check check (event_type in (
      'decision_revision_appended', 'selection_revision_appended', 'price_observation_appended',
      'approval_package_created', 'approval_package_submitted', 'approval_package_reviewed',
      'project_baseline_published', 'production_package_version_published', 'release_artifact_built',
      'release_distributed', 'release_acknowledged', 'no_change_approved', 'change_request_submitted',
      'change_impact_calculated', 'change_impact_reviewed', 'milestone_defined',
      'photo_evidence_registered', 'photo_evidence_reviewed', 'milestone_accepted',
      'handover_document_registered', 'construction_handover_built', 'm2_room_revision_appended',
      'm2_variant_revision_appended', 'm2_material_revision_appended', 'm2_budget_revision_appended',
      'm2_client_handoff_revision_appended', 'm2_approved_commit_revision_appended',
      'm2_layout_version_revision_appended', 'm2_client_review_submitted',
      'm2_client_submission_reviewed', 'm2_m3_handoff_published',
      'm3_documentation_sheet_registered', 'm3_documentation_sheet_specifications_attached',
      'change_impact_truncation_acknowledged'
    ));

  select array_agg(match[1] order by match[1]) into v_new
  from pg_catalog.pg_constraint constraint_row,
    lateral regexp_matches(
      pg_catalog.pg_get_constraintdef(constraint_row.oid), $re$'([a-z0-9_]+)'$re$, 'g'
    ) match
  where constraint_row.conname = 'audit_events_event_type_check'
    and constraint_row.conrelid = 'projectceo_product.audit_events'::regclass;

  select value into v_lost
  from unnest(v_old) value
  where not value = any(v_new)
  limit 1;
  if v_lost is not null then
    raise exception 'PROJECTCEO_AUDIT_EVENT_DROPPED:%', v_lost;
  end if;
end
$event_dictionary$;

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
  if v_found > v_max_impacts then
    select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
    into v_impacts
    from jsonb_array_elements(v_impacts) with ordinality entry(item, ordinality)
    where ordinality <= v_max_impacts;
    v_is_truncated := true;
    v_truncation_reason := 'result_limit';
  end if;

  -- Усечение по глубине: тот же обход на шаг глубже нашёл бы больше пар.
  -- Проверяется всегда, а не только при исчерпании лимита: граф глубже
  -- политики — самая частая причина неполноты и самая незаметная.
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
    -- Приоритет у `result_limit`: если срез уже случился, потеряно и то, что
    -- нашли, и то, до чего не дошли. Называть это `depth_limit` значило бы
    -- назвать меньшую из двух потерь.
    v_truncation_reason := coalesce(v_truncation_reason, 'depth_limit');
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
    policy_max_depth
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
    v_policy_max_depth
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
  v_all_reviewed boolean;
  v_every_impact_reviewed boolean;
  v_is_truncated boolean;
  v_truncation_reason text;
  v_truncation_acknowledged boolean;
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

  -- ЧАСТИЧНЫЙ ПРОГОН НЕ ЗАКРЫВАЕТСЯ САМ (OWNER DECISION 12.08.2026).
  --
  -- Рассматривать усечённый прогон можно и нужно — карточки настоящие. Но
  -- «рассмотрено всё» на нём означало бы, что человек видел всё влияние, а он
  -- видел его часть. Поэтому `allImpactsReviewed` требует ещё и явного
  -- подтверждения архитектора (`acknowledge_impact_truncation`): решение о
  -- неполноте принимает человек, а не умолчание.
  select run.is_truncated, run.truncation_reason
  into v_is_truncated, v_truncation_reason
  from projectceo_m4.impact_runs run
  where run.organization_id = v_context.organization_id
    and run.project_id = project_id
    and run.impact_run_id = impact_run_id;

  v_truncation_acknowledged := exists (
    select 1
    from projectceo_m4.impact_truncation_acknowledgements ack
    where ack.organization_id = v_context.organization_id
      and ack.project_id = project_id
      and ack.impact_run_id = impact_run_id
  );

  v_all_reviewed := v_every_impact_reviewed
    and (not coalesce(v_is_truncated, false) or v_truncation_acknowledged);

  v_result := jsonb_build_object(
    'allImpactsReviewed', v_all_reviewed,
    'disposition', disposition,
    'everyImpactReviewed', v_every_impact_reviewed,
    'isTruncated', coalesce(v_is_truncated, false),
    'truncationAcknowledged', v_truncation_acknowledged,
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
      'all_impacts_reviewed', v_all_reviewed,
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
-- Подтверждение неполноты архитектором.
--
-- ЗАЧЕМ ОТДЕЛЬНАЯ ОПЕРАЦИЯ. Без неё усечённый прогон был бы тупиком:
-- рассмотреть карточки можно, а закрыть рассмотрение нельзя никогда. Решение
-- «я вижу, что картина неполная, и готов идти дальше» обязано быть действием
-- человека с именем, временем и причиной, а не следствием того, что кто-то
-- дорассматривал последнюю карточку.
--
-- ПОЧЕМУ CAPABILITY ПРЕЖНЯЯ. Используется `review_change_impact`: подтверждает
-- тот же человек, который рассматривает влияние, и над тем же объектом. Новая
-- capability потребовала бы правки каталога и ролевой раскладки, ничего не
-- добавив к разграничению.
create function projectceo_m4_api.acknowledge_impact_truncation(
  project_id uuid,
  impact_run_id uuid,
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
  v_is_truncated boolean;
  v_truncation_reason text;
  v_reason text;
  v_acknowledgement_id uuid := extensions.gen_random_uuid();
  v_all_reviewed boolean;
  v_result jsonb;
begin
  v_reason := projectceo_product._assert_text(reason, 'reason', 4000);

  select run.package_id, run.is_truncated, run.truncation_reason
  into v_package_id, v_is_truncated, v_truncation_reason
  from projectceo_m4.impact_runs run
  where run.project_id = project_id
    and run.impact_run_id = impact_run_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"impactRun"}'::jsonb
    );
  end if;
  -- Подтверждать полноту нечего. Разрешить это значило бы завести подпись под
  -- утверждением, которого никто не делал.
  if not v_is_truncated then
    perform projectceo_product._raise(
      'P1110', 'invalid_transition', '{"reason":"IMPACT_NOT_TRUNCATED"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_m4._human_command_context(
    project_id,
    v_package_id,
    'review_change_impact',
    'acknowledge_impact_truncation',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object(
      'impactRunId', impact_run_id,
      'reason', v_reason
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;
  if exists (
    select 1
    from projectceo_m4.impact_truncation_acknowledgements ack
    where ack.organization_id = v_context.organization_id
      and ack.project_id = project_id
      and ack.impact_run_id = impact_run_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"IMPACT_TRUNCATION_ALREADY_ACKNOWLEDGED"}'::jsonb
    );
  end if;

  insert into projectceo_m4.impact_truncation_acknowledgements (
    organization_id,
    project_id,
    acknowledgement_id,
    impact_run_id,
    package_id,
    protected_reason,
    reason_digest,
    acknowledged_by_user_id
  ) values (
    v_context.organization_id,
    project_id,
    v_acknowledgement_id,
    impact_run_id,
    v_package_id,
    v_reason,
    project_intelligence._sha256_text(v_reason),
    v_context.actor_user_id
  );

  -- Подтверждение снимает ровно одно препятствие. Нерассмотренные карточки оно
  -- не закрывает: `allImpactsReviewed` по-прежнему требует обеих половин.
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
  ) into v_all_reviewed;

  v_result := jsonb_build_object(
    'acknowledgedBy', jsonb_build_object(
      'actorId', v_context.actor_id,
      'actorType', 'human'
    ),
    'allImpactsReviewed', v_all_reviewed,
    'id', v_acknowledgement_id,
    'impactRunId', impact_run_id,
    'reasonHash', 'sha256:' || encode(
      project_intelligence._sha256_text(v_reason), 'hex'
    ),
    'truncationReason', v_truncation_reason
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'acknowledge_impact_truncation',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'change_impact_truncation_acknowledged',
    jsonb_build_object(
      'acknowledgement_id', v_acknowledgement_id,
      'impact_run_id', impact_run_id,
      'reason_digest', 'sha256:' || encode(
        project_intelligence._sha256_text(v_reason), 'hex'
      ),
      'truncation_reason', v_truncation_reason
    ),
    v_context.state_revision
  );
end
$function$;

alter function projectceo_m4_api.acknowledge_impact_truncation(
  uuid, uuid, text, bigint, text
) owner to pi_table_owner;

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
        'truncationAcknowledged', exists (
          select 1
          from projectceo_m4.impact_truncation_acknowledgements ack
          where ack.organization_id = run.organization_id
            and ack.project_id = run.project_id
            and ack.impact_run_id = run.impact_run_id
        ),
        -- Единственный честный признак завершённости: все карточки
        -- рассмотрены И неполнота либо отсутствует, либо подтверждена.
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
          and (
            not run.is_truncated
            or exists (
              select 1
              from projectceo_m4.impact_truncation_acknowledgements ack
              where ack.organization_id = run.organization_id
                and ack.project_id = run.project_id
                and ack.impact_run_id = run.impact_run_id
            )
          )
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

-- Обёртка воркера упрощается: обнаружение усечения переехало в сам расчёт,
-- где его можно записать атомарно. Здесь остаётся единственная обязанность —
-- взять глубину из политики, чтобы она не была аргументом вызывающего.
create or replace function projectceo_m4_api.calculate_change_impact_policy_bound(
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
  v_max_depth integer := (projectceo_m4._impact_policy() ->> 'maxDepth')::integer;
begin
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

-- Новая человеческая RPC закрыта ровно так же, как остальные командные RPC
-- модуля: постоянная миграция прав не выдаёт. Открывает её только скрипт
-- одноразовой среды (`enable-m4-v1-impact.sql`), как и `review_change_impact`.
revoke all on function
  projectceo_m4_api.acknowledge_impact_truncation(uuid, uuid, text, bigint, text)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

do $guard$
declare
  v_problem text;
begin
  -- 1. Новая дверь недоступна никому из постоянной миграции.
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

  -- 2. Признак и причина не могут разойтись — проверяется на самой таблице, а
  --    не только в коде функции: строку однажды вставит кто-то ещё.
  begin
    insert into projectceo_m4.impact_runs (
      organization_id, project_id, impact_run_id, change_request_id, package_id,
      target_baseline_id, target_graph_version_id, max_depth, algorithm,
      result_digest, created_by_id, is_truncated, truncation_reason
    ) values (
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000000',
      extensions.gen_random_uuid(),
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000000',
      'guard', 'guard', 1, '{}'::jsonb,
      decode(repeat('00', 32), 'hex'), 'system:guard', true, null
    );
    raise exception 'PROJECTCEO_M4_TRUNCATED_WITHOUT_REASON_ALLOWED';
  exception
    when check_violation then null;
    when foreign_key_violation then
      raise exception 'PROJECTCEO_M4_TRUNCATION_PAIR_CHECK_NOT_REACHED';
  end;

  -- 3. Причина ограничена словарём: свободный текст сделал бы признак
  --    нечитаемым машиной ровно тогда, когда он нужен машине.
  if exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'm4_impact_runs_truncation_reason_check'
      and conrelid = 'projectceo_m4.impact_runs'::regclass
  ) is not true then
    raise exception 'PROJECTCEO_M4_TRUNCATION_REASON_CHECK_MISSING';
  end if;
end
$guard$;

commit;
