-- Атомарная дверь публикации baseline (M3 backlog #6) — graph version и
-- baseline создаются одной транзакцией.
--
-- ГОНКА, КОТОРУЮ ЗАКРЫВАЕТ ДВЕРЬ. Сегодня публикация — две RPC из приложения:
-- `publish_version` (коммит: версия графа создана, `latest_version_id`
-- передвинут) и `publish_project_baseline` (второй коммит). Потеря второго
-- шага оставляет осиротевшую версию: resume работает только повтором ТОГО ЖЕ
-- `commandId` (детерминированная метка из #79), а НОВАЯ команда вычисляет
-- ожидаемую версию из последнего baseline, получает `P1005 VERSION_STALE` от
-- осиротевшей и не может пройти никогда. Одна транзакция убирает сам класс:
-- версия не может существовать без своего baseline.
--
-- COMPOSITION — НА СЕРВЕРЕ (суть M3 backlog #8). Дверь НЕ принимает от
-- клиента ни списков ревизий, ни semanticHash: состав выводится из базы —
-- активные пакеты, одобренные approval-пакеты, победившая ревизия на
-- сущность (правило «одна ревизия на сущность», зеркало
-- `baseline-composition.ts:145-190`: последняя по created_at одобрившего
-- пакета), подтверждённые ревизии источников из свежесозданной версии графа
-- (M3 backlog #5: sourceRevisionIds выводятся сервером из проверенных
-- источников и входят в composition и semantic hash). Частичный baseline
-- прямым вызовом двери невозможен — клиенту нечего урезать.
--
-- ЧЕМ ДВЕРЬ НЕ ЯВЛЯЕТСЯ. Она не заменяет и не меняет ни `publish_version`,
-- ни `publish_project_baseline`: обе внутренние операции вызываются как есть,
-- со всеми их проверками, аудитом и леджером. Приложение продолжает ходить
-- старым двухшаговым путём до перевода command-слоя (координация с Фазой 2);
-- перевод — локализованная правка `command-service.ts` после её PR-3.
--
-- ПОРЯДОК ВНУТРИ (требование DEC-027 §2.5 п.4 к пути A′): авторизация →
-- валидация → блокировка → replay → staleness → [будущий гейт конфликта
-- документов, 3b.3] → записи. Гейт конфликта встанет после replay и до
-- первой записи — структура двери оставляет ему ровно это место.
--
-- ИДЕМПОТЕНТНОСТЬ ДВЕРИ. Собственная запись в общем леджере
-- `command_records` (операция `publish_baseline_atomic`), request digest —
-- от входа двери, а не от выведенного состава: повтор той же команды после
-- потери ответа возвращает прежний результат, даже если одобрения с тех пор
-- изменились. Запись двери коммитится в одной транзакции с внутренними —
-- replay не может увидеть половину.

begin;

set local check_function_bodies = on;

-- Словарь операций леджера: + `publish_baseline_atomic`. Полное перечисление —
-- потому что CHECK не расширяется на месте; guard ниже роняет миграцию, если
-- при переписывании потерялась хоть одна прежняя операция (образец —
-- `20260812020000`).
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
      'acknowledge_impact_truncation', 'publish_baseline_atomic'
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

-- Дверь (definer, владелец pi_table_owner) вызывает внутреннюю
-- `project_intelligence_api.publish_version`, принадлежащую
-- pi_human_executor: владельцу таблиц нужен на неё явный execute. Наружу
-- это не расширяет ничего — pi_table_owner недостижим прикладными ролями,
-- а у `authenticated` execute на эту функцию есть с `20260716073000`
-- (см. `tests/db4/39_publish_version_door.sql`: «до двери у authenticated
-- уже были и usage, и execute»).
grant execute on function project_intelligence_api.publish_version(
  uuid, text, bigint, text, jsonb, text
) to pi_table_owner;

create function projectceo_product_api.publish_baseline_atomic(
  project_id uuid,
  expected_latest_version_id text,
  previous_baseline_id text,
  expected_state_revision bigint,
  command_ref text,
  idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_command_ref text;
  v_key_digest bytea;
  v_request_digest bytea;
  v_state_revision bigint;
  v_replay jsonb;
  v_version_envelope jsonb;
  v_graph_version_id text;
  v_state_after_version bigint;
  v_package_ids text[];
  v_approval_ids text[];
  v_requirement_ids text[];
  v_assumption_ids text[];
  v_decision_ids text[];
  v_selection_ids text[];
  v_source_ids text[];
  v_semantic_content jsonb;
  v_descriptor jsonb;
  v_baseline_envelope jsonb;
  v_result jsonb;
begin
  v_command_ref := projectceo_product._assert_text(
    command_ref, 'commandRef', 120
  );
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  if expected_latest_version_id is not null then
    perform projectceo_product._assert_text(
      expected_latest_version_id, 'expectedLatestVersionId', 160
    );
  end if;
  if previous_baseline_id is not null then
    perform projectceo_product._assert_text(
      previous_baseline_id, 'previousBaselineId', 160
    );
  end if;

  select context.organization_id, context.actor_user_id, context.actor_id
    into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'publish_baseline'
  ) context;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  -- Digest — от входа двери. Выведенный состав сюда не входит намеренно:
  -- повтор той же команды обязан вернуть прежний результат, а не пересчитать
  -- состав по изменившимся с тех пор одобрениям и упасть в P1108.
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'commandRef', v_command_ref,
      'expectedLatestVersionId', expected_latest_version_id,
      'expectedStateRevision', expected_state_revision,
      'operation', 'publish_baseline_atomic',
      'previousBaselineId', previous_baseline_id,
      'projectId', project_id
    )
  );

  select workflow.state_revision into v_state_revision
  from project_intelligence.project_workflows workflow
  where workflow.organization_id = v_context.organization_id
    and workflow.project_id = project_id
  for update;

  -- Ключ принадлежит актору (образец — request-bound двери).
  if exists (
    select 1
    from projectceo_product.command_records command
    where command.organization_id = v_context.organization_id
      and command.project_id = project_id
      and command.operation = 'publish_baseline_atomic'
      and command.key_digest = v_key_digest
      and (
        command.actor_type <> 'human'
        or command.actor_user_id is distinct from v_context.actor_user_id
      )
  ) then
    perform projectceo_product._raise(
      'P1103',
      'forbidden',
      '{"reason":"IDEMPOTENCY_ACTOR_MISMATCH"}'::jsonb
    );
  end if;

  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id,
    project_id,
    'publish_baseline_atomic',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  -- [Здесь встанет гейт неразрешённого конфликта документов — DEC-027,
  -- этап 3b.3: после replay, до первой записи.]

  -- Шаг 1: версия графа. Все проверки внутренней операции — staleness
  -- (P1005/P1006), неподтверждённые обязательные утверждения, блокировки —
  -- действуют как есть; её коммит теперь не отделим от baseline ниже.
  v_version_envelope := project_intelligence_api.publish_version(
    project_id,
    expected_latest_version_id,
    expected_state_revision,
    'baseline:' || v_command_ref,
    '[]'::jsonb,
    btrim(idempotency_key) || ':version'
  );
  v_graph_version_id := v_version_envelope #>> '{result,version,id}';
  if v_graph_version_id is null then
    perform projectceo_product._raise(
      'P1112',
      'internal_error',
      '{"reason":"ATOMIC_DOOR_VERSION_MISSING"}'::jsonb
    );
  end if;
  v_state_after_version := (v_version_envelope ->> 'stateRevision')::bigint;

  -- Шаг 2: состав — из базы, а не из запроса.
  select coalesce(
    array_agg(pp.id::text order by pp.id::text collate "C"), '{}'
  )
  into v_package_ids
  from projectceo_foundation.project_packages pp
  where pp.organization_id = v_context.organization_id
    and pp.project_id = project_id
    and pp.status = 'active';

  select coalesce(
    array_agg(approved.approval_package_id
      order by approved.approval_package_id collate "C"), '{}'
  )
  into v_approval_ids
  from (
    select ap.approval_package_id
    from projectceo_product.approval_packages ap
    join lateral (
      select ape.to_status
      from projectceo_product.approval_package_events ape
      where ape.organization_id = ap.organization_id
        and ape.project_id = ap.project_id
        and ape.approval_package_id = ap.approval_package_id
      order by ape.sequence_no desc
      limit 1
    ) current_event on true
    where ap.organization_id = v_context.organization_id
      and ap.project_id = project_id
      and ap.package_id::text = any(v_package_ids)
      and current_event.to_status = 'approved'
  ) approved;

  -- Победившая ревизия на сущность: последний по created_at (тай-брейк —
  -- id) одобривший пакет. Зеркало правила «одна ревизия на сущность»
  -- (`baseline-composition.ts`, commit 7bf00fd).
  with winners as (
    select distinct on (item.target_kind, item.entity_id)
      item.target_kind,
      item.revision_id
    from projectceo_product.approval_package_items item
    join projectceo_product.approval_packages ap
      on ap.organization_id = item.organization_id
     and ap.project_id = item.project_id
     and ap.approval_package_id = item.approval_package_id
    where item.organization_id = v_context.organization_id
      and item.project_id = project_id
      and item.approval_package_id = any(v_approval_ids)
    order by
      item.target_kind,
      item.entity_id,
      ap.created_at desc,
      ap.approval_package_id collate "C" desc
  )
  select
    coalesce(array_agg(winners.revision_id order by winners.revision_id collate "C")
      filter (where winners.target_kind = 'requirement_revision'), '{}'),
    coalesce(array_agg(winners.revision_id order by winners.revision_id collate "C")
      filter (where winners.target_kind = 'assumption_revision'), '{}'),
    coalesce(array_agg(winners.revision_id order by winners.revision_id collate "C")
      filter (where winners.target_kind = 'decision_revision'), '{}'),
    coalesce(array_agg(winners.revision_id order by winners.revision_id collate "C")
      filter (where winners.target_kind = 'selection_revision'), '{}')
  into
    v_requirement_ids,
    v_assumption_ids,
    v_decision_ids,
    v_selection_ids
  from winners;

  -- Подтверждённые источники — из только что созданной версии графа: ровно
  -- те ревизии, что вошли в snapshot и прошли human review. Источник без
  -- подтверждения в baseline не входит; версия графа его при этом хранит.
  -- distinct не нужен: version_nodes держит одну ревизию на узел в версии,
  -- а human_reviews — одно ревью на ревизию (unique-ключи обеих таблиц).
  select coalesce(
    array_agg(vn.revision_id order by vn.revision_id collate "C"), '{}'
  )
  into v_source_ids
  from project_intelligence.version_nodes vn
  join project_intelligence.graph_nodes gn
    on gn.organization_id = vn.organization_id
   and gn.project_id = vn.project_id
   and gn.node_id = vn.node_id
  join project_intelligence.human_reviews review
    on review.organization_id = vn.organization_id
   and review.project_id = vn.project_id
   and review.target_revision_id = vn.revision_id
  where vn.organization_id = v_context.organization_id
    and vn.project_id = project_id
    and vn.version_id = v_graph_version_id
    and gn.kind = 'source'
    and review.decision = 'confirmed';

  -- Semantic content — та же каноничная форма, которую пересчитает и сверит
  -- `publish_project_baseline` (`20260717101000:2088-2115`).
  select jsonb_build_object(
    'approvalPackageIds', to_jsonb(v_approval_ids),
    'assumptionRevisionIds', to_jsonb(v_assumption_ids),
    'decisionRevisionIds', to_jsonb(v_decision_ids),
    'graphVersionId', v_graph_version_id,
    'organizationId', v_context.organization_id,
    'packageIds', to_jsonb(v_package_ids),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pp.id,
        'kind', pp.kind,
        'parentPackageId', pp.parent_package_id,
        'stableKey', pp.stable_key
      ) order by pp.id::text collate "C")
      from projectceo_foundation.project_packages pp
      where pp.organization_id = v_context.organization_id
        and pp.project_id = project_id
        and pp.id = any(v_package_ids::uuid[])
    ), '[]'::jsonb),
    'previousBaselineId', previous_baseline_id,
    'projectId', project_id,
    'requirementRevisionIds', to_jsonb(v_requirement_ids),
    'schemaVersion', 'project-ceo-baseline/0.1',
    'selectionRevisionIds', to_jsonb(v_selection_ids),
    'sourceRevisionIds', to_jsonb(v_source_ids)
  ) into v_semantic_content;

  v_descriptor := jsonb_build_object(
    'id', 'baseline:' || v_command_ref,
    'graphVersionId', v_graph_version_id,
    'previousBaselineId', previous_baseline_id,
    'packageIds', to_jsonb(v_package_ids),
    'sourceRevisionIds', to_jsonb(v_source_ids),
    'requirementRevisionIds', to_jsonb(v_requirement_ids),
    'assumptionRevisionIds', to_jsonb(v_assumption_ids),
    'decisionRevisionIds', to_jsonb(v_decision_ids),
    'selectionRevisionIds', to_jsonb(v_selection_ids),
    'approvalPackageIds', to_jsonb(v_approval_ids),
    'semanticHash', 'sha256:' || encode(
      project_intelligence._sha256_jsonb(v_semantic_content), 'hex'
    )
  );

  -- Шаг 3: baseline — той же транзакцией. Все проверки внутренней операции
  -- (scope пакетов, вхождение ревизий в версию графа, одобренность, пересчёт
  -- хеша, staleness P1107 по previousBaselineId) действуют как есть; её отказ
  -- откатывает и версию графа из шага 1 — осиротевшая версия невозможна.
  v_baseline_envelope := projectceo_product_api.publish_project_baseline(
    project_id,
    v_descriptor,
    v_state_after_version,
    btrim(idempotency_key)
  );

  v_result := jsonb_build_object(
    'baseline', v_baseline_envelope -> 'result',
    'version', v_version_envelope #> '{result,version}'
  );

  -- Запись двери — в той же транзакции, без третьего инкремента
  -- state_revision и без второго аудита: событийную историю уже написали
  -- внутренние операции, у двери — только replay-память.
  insert into projectceo_product.command_records (
    organization_id,
    project_id,
    operation,
    key_digest,
    request_digest,
    actor_type,
    actor_id,
    actor_user_id,
    logical_result,
    resulting_state_revision
  )
  values (
    v_context.organization_id,
    project_id,
    'publish_baseline_atomic',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    (v_baseline_envelope ->> 'stateRevision')::bigint
  );

  return jsonb_build_object(
    'operation', 'publish_baseline_atomic',
    'replay', false,
    'stateRevision', (v_baseline_envelope ->> 'stateRevision')::bigint,
    'result', v_result
  );
end
$function$;

alter function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, bigint, text, text
) owner to pi_table_owner;

-- Тот же таймаут, что у двери публикации версии (`20260813040000`): snapshot
-- графа выполняется в этом же вызове, платформенные 8 секунд роли ему малы.
alter function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, bigint, text, text
) set statement_timeout = '30s';

-- Публикация закрыта по умолчанию — принцип guardrail `20260811010000`.
-- Дверь открывается только выключателем модуля (ниже) или, в одноразовой
-- среде, явным грантом её харнесса.
revoke all on function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, bigint, text, text
) from public, anon, authenticated, service_role,
     pi_human_executor, pi_worker_executor;

-- Дверь входит в состав включения M3: production-открытие модуля выдаёт её
-- вместе с остальной поверхностью. Сырые descriptor-RPC остаются в списке
-- НАМЕРЕННО И ВРЕМЕННО: приложение до перевода command-слоя (Фаза 2, PR-3)
-- ходит старым двухшаговым путём, и открыть модуль без них значило бы
-- открыть неработающий продукт. Снятие сырых RPC из этого списка — вместе с
-- переводом приложения на дверь (M3 backlog #8, запрос координации).
create or replace function projectceo_platform._module_signatures(p_module text)
returns text[]
language sql
immutable
security definer
set search_path = ''
as $function$
  select case p_module
    when 'm3' then array[
      'projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)',
      'projectceo_product_api.publish_project_baseline(uuid, jsonb, bigint, text)',
      'projectceo_product_api.publish_production_package_version(uuid, jsonb, bigint, text)',
      'projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)',
      'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
      'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
      'projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)'
    ]
    when 'm4_increment_1' then array[
      'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)',
      'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)',
      'projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)',
      'projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text)',
      'projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text)',
      'projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)'
    ]
    else null
  end;
$function$;

do $guard$
begin
  if to_regprocedure(
    'projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)'
  ) is null then
    raise exception 'PROJECTCEO_ATOMIC_DOOR_MISSING';
  end if;
  if pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_ATOMIC_DOOR_OPEN_BY_DEFAULT';
  end if;
  if not (
    'projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)'
    = any(projectceo_platform._module_signatures('m3'))
  ) then
    raise exception 'PROJECTCEO_ATOMIC_DOOR_NOT_IN_M3_SWITCH';
  end if;
  -- Переписывание списка не смеет потерять ни одной прежней сигнатуры.
  if exists (
    select 1
    from unnest(array[
      'projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)',
      'projectceo_product_api.publish_project_baseline(uuid, jsonb, bigint, text)',
      'projectceo_product_api.publish_production_package_version(uuid, jsonb, bigint, text)',
      'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
      'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
      'projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)'
    ]) prior_signature
    where not prior_signature = any(projectceo_platform._module_signatures('m3'))
  ) then
    raise exception 'PROJECTCEO_M3_SWITCH_SIGNATURE_DROPPED';
  end if;
end
$guard$;

commit;
