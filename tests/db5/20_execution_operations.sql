\set ON_ERROR_STOP on

-- Роли в этом сценарии выбраны не по удобству, а по границе модуля.
--
--   * `authenticated` — M2/M3 и инкремент 1 (`submit_change_request`,
--     публикация, чтение `get_execution_delivery`). Ровно то, что скрипты
--     среды открывают в непроизводственном стенде;
--   * `pi_db5_execution_tester` — человеческие RPC инкремента 2. Отдельная
--     `nologin`-роль, заведённая `06_execution_test_role.sql` внутри
--     одноразового контейнера. `authenticated` для этих RPC закрыт навсегда, и
--     открывать его ради прогона нельзя: доказательство работы движка не
--     должно стоить снятия запрета;
--   * `service_role` — только воркерные `calculate_change_impact_policy_bound`,
--     `list_change_impact_backlog` и `build_construction_handover`.
--     Человеческих операций у неё нет, и `10_schema_security.sql` роняет
--     прогон, если появятся.
--
-- Идентичность человека при этом одна и та же во всех трёх случаях:
-- `request.jwt.claim.sub`. Роль базы решает, можно ли ВЫЗВАТЬ функцию;
-- кто вызвал — по-прежнему решает `_authorize_package_human` по членству и
-- capability.

-- Extend the DB4 golden project with one revision replacement and one
-- downstream deliverable so M4 can prove bounded deterministic impact.
begin;
insert into project_intelligence.graph_nodes (
  organization_id,
  project_id,
  node_id,
  kind,
  stable_key,
  current_revision_id
)
select
  workflow.organization_id,
  workflow.project_id,
  'node-deliverable-db5',
  'deliverable',
  'deliverable:db5',
  'revision-deliverable-db5'
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into project_intelligence.graph_node_revisions (
  organization_id,
  project_id,
  revision_id,
  node_id,
  revision_no,
  title,
  payload,
  origin,
  claim_status,
  unknown_reason,
  replaces_revision_id,
  content_digest,
  created_by_type,
  created_by_id
)
select
  workflow.organization_id,
  workflow.project_id,
  'revision-deliverable-db5',
  'node-deliverable-db5',
  1,
  'DB5 downstream work package',
  '{"schemaVersion":"project-ceo-deliverable/0.1"}'::jsonb,
  'human',
  'human_origin',
  null,
  null,
  project_intelligence._sha256_jsonb(
    '{"schemaVersion":"project-ceo-deliverable/0.1"}'::jsonb
  ),
  'human',
  '31111111-1111-4111-8111-111111111111'
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into project_intelligence.graph_edges (
  organization_id,
  project_id,
  edge_id,
  from_node_id,
  to_node_id,
  relation
)
select
  workflow.organization_id,
  workflow.project_id,
  'edge-deliverable-decision-db5',
  'node-deliverable-db5',
  'node-decision-db4',
  'depends_on'
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111';
commit;

select
  state_revision,
  latest_version_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.append_decision_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'node-decision-db4',
  'revision-decision-db5-r2',
  'revision-decision-db4-r1',
  'human_origin',
  'DB5 changed floor decision',
  'Use the revised approved floor solution',
  'node-area-db4',
  'confirmed',
  '[]'::jsonb,
  'Client approved a field change',
  :'db5_state_revision'::bigint,
  'db5-decision-r2'
);
commit;

select
  state_revision,
  latest_version_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select project_intelligence_api.publish_version(
  '41111111-1111-4111-8111-111111111111',
  :'db5_latest_version_id',
  :'db5_state_revision'::bigint,
  'DB5 graph after approved change',
  '[]'::jsonb,
  'db5-publish-graph-v3'
);
commit;

select
  state_revision,
  latest_version_id as graph_version_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.create_approval_package(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'approval-db5-root-v2',
  jsonb_build_array(
    jsonb_build_object(
      'targetKind', 'requirement_revision',
      'entityId', 'node-requirement-db4',
      'revisionId', 'revision-requirement-db4'
    ),
    jsonb_build_object(
      'targetKind', 'assumption_revision',
      'entityId', 'node-assumption-db4',
      'revisionId', 'revision-assumption-db4'
    ),
    jsonb_build_object(
      'targetKind', 'decision_revision',
      'entityId', 'node-decision-db4',
      'revisionId', 'revision-decision-db5-r2'
    ),
    jsonb_build_object(
      'targetKind', 'selection_revision',
      'entityId', 'node-selection-db4',
      'revisionId', 'revision-selection-db4-r1'
    )
  ),
  :'db5_state_revision'::bigint,
  'db5-create-approval-v2'
);
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

select set_config(
  'projectceo.db5_current_state',
  :'db5_state_revision',
  false
);

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.submit_approval_package(
  '41111111-1111-4111-8111-111111111111',
  'approval-db5-root-v2',
  'draft',
  :'db5_state_revision'::bigint,
  'db5-submit-approval-v2'
);
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.review_approval_package(
  '41111111-1111-4111-8111-111111111111',
  'approval-db5-root-v2',
  'submitted',
  'approved',
  'Approved exact changed revision',
  :'db5_state_revision'::bigint,
  'db5-review-approval-v2'
);
commit;

select
  state_revision,
  organization_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

select jsonb_build_object(
  'id', 'baseline-db5-v2',
  'graphVersionId', :'db5_graph_version_id',
  'previousBaselineId', 'baseline-db4-v1',
  'packageIds', jsonb_build_array(
    '41111111-1111-4111-8111-111111111111',
    '49999999-9999-4999-8999-999999999999'
  ),
  'sourceRevisionIds', jsonb_build_array('revision-source-1'),
  'requirementRevisionIds',
    jsonb_build_array('revision-requirement-db4'),
  'assumptionRevisionIds',
    jsonb_build_array('revision-assumption-db4'),
  'decisionRevisionIds',
    jsonb_build_array('revision-decision-db5-r2'),
  'selectionRevisionIds',
    jsonb_build_array('revision-selection-db4-r1'),
  'approvalPackageIds', jsonb_build_array('approval-db5-root-v2'),
  'semanticHash', 'sha256:' || encode(
    project_intelligence._sha256_jsonb(jsonb_build_object(
      'approvalPackageIds', jsonb_build_array('approval-db5-root-v2'),
      'assumptionRevisionIds',
        jsonb_build_array('revision-assumption-db4'),
      'decisionRevisionIds',
        jsonb_build_array('revision-decision-db5-r2'),
      'graphVersionId', :'db5_graph_version_id',
      'organizationId', :'db5_organization_id'::uuid,
      'packageIds', jsonb_build_array(
        '41111111-1111-4111-8111-111111111111',
        '49999999-9999-4999-8999-999999999999'
      ),
      'packages', (
        select jsonb_agg(jsonb_build_object(
          'id', package.id,
          'kind', package.kind,
          'parentPackageId', package.parent_package_id,
          'stableKey', package.stable_key
        ) order by package.id::text collate "C")
        from projectceo_foundation.project_packages package
        where package.organization_id = :'db5_organization_id'::uuid
          and package.project_id =
            '41111111-1111-4111-8111-111111111111'
          and package.id in (
            '41111111-1111-4111-8111-111111111111',
            '49999999-9999-4999-8999-999999999999'
          )
      ),
      'previousBaselineId', 'baseline-db4-v1',
      'projectId', '41111111-1111-4111-8111-111111111111',
      'requirementRevisionIds',
        jsonb_build_array('revision-requirement-db4'),
      'schemaVersion', 'project-ceo-baseline/0.1',
      'selectionRevisionIds',
        jsonb_build_array('revision-selection-db4-r1'),
      'sourceRevisionIds', jsonb_build_array('revision-source-1')
    )),
    'hex'
  )
) as baseline_descriptor
\gset db5_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.publish_project_baseline(
  '41111111-1111-4111-8111-111111111111',
  :'db5_baseline_descriptor'::jsonb,
  :'db5_state_revision'::bigint,
  'db5-publish-baseline-v2'
);
commit;

select
  state_revision,
  organization_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

select jsonb_build_object(
  'id', 'package-db5-root-v2',
  'packageId', '41111111-1111-4111-8111-111111111111',
  'baselineId', 'baseline-db5-v2',
  'previousVersionId', 'package-db4-root-v1',
  'exactRevisionRefs', jsonb_build_object(
    'sources', jsonb_build_array('revision-source-1'),
    'requirements', jsonb_build_array('revision-requirement-db4'),
    'assumptions', jsonb_build_array('revision-assumption-db4'),
    'decisions', jsonb_build_array('revision-decision-db5-r2'),
    'selections', jsonb_build_array('revision-selection-db4-r1')
  ),
  'semanticHash', 'sha256:' || encode(
    project_intelligence._sha256_jsonb(jsonb_build_object(
      'baselineId', 'baseline-db5-v2',
      'exactRevisionRefs', jsonb_build_object(
        'assumptions', jsonb_build_array('revision-assumption-db4'),
        'decisions', jsonb_build_array('revision-decision-db5-r2'),
        'requirements', jsonb_build_array('revision-requirement-db4'),
        'selections', jsonb_build_array('revision-selection-db4-r1'),
        'sources', jsonb_build_array('revision-source-1')
      ),
      'organizationId', :'db5_organization_id'::uuid,
      'packageId', '41111111-1111-4111-8111-111111111111',
      'previousVersionId', 'package-db4-root-v1',
      'projectId', '41111111-1111-4111-8111-111111111111',
      'schemaVersion', 'project-ceo-production-package/0.1'
    )),
    'hex'
  )
) as package_descriptor
\gset db5_

select set_config(
  'projectceo.db5_package_descriptor',
  :'db5_package_descriptor',
  false
);
select set_config(
  'projectceo.db5_preimpact_state',
  :'db5_state_revision',
  false
);

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $release_before_impact_review$
begin
  begin
    perform projectceo_product_api.publish_production_package_version(
      '41111111-1111-4111-8111-111111111111',
      current_setting('projectceo.db5_package_descriptor')::jsonb,
      current_setting('projectceo.db5_preimpact_state')::bigint,
      'db5-premature-package-v2'
    );
    raise exception 'DB5_PREMATURE_CHANGED_RELEASE_ALLOWED';
  exception when sqlstate 'P1110' then null;
  end;
end
$release_before_impact_review$;
rollback;

-- Register exact materialized photo and warranty sources. These are private
-- fixtures and intentionally include protected filenames only in private data.
begin;
insert into project_intelligence.sources (
  organization_id,
  project_id,
  source_id,
  kind,
  checksum,
  storage_object_path
)
select
  workflow.organization_id,
  workflow.project_id,
  seed.source_id,
  seed.kind,
  decode(seed.checksum_hex, 'hex'),
  seed.storage_path
from project_intelligence.project_workflows workflow
cross join (values
  (
    'source-sha256-0123456789abcdef01234567',
    'image',
    repeat('0123456789abcdef', 4),
    'ru/db5/photo/11111111-aaaa-4111-8111-111111111111.jpg'
  ),
  (
    'source-sha256-fedcba9876543210fedcba98',
    'pdf',
    repeat('fedcba9876543210', 4),
    'ru/db5/handover/22222222-bbbb-4222-8222-222222222222.pdf'
  )
) seed(source_id, kind, checksum_hex, storage_path)
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into project_intelligence.graph_nodes (
  organization_id,
  project_id,
  node_id,
  kind,
  stable_key,
  current_revision_id
)
select
  workflow.organization_id,
  workflow.project_id,
  seed.node_id,
  'source',
  seed.stable_key,
  seed.revision_id
from project_intelligence.project_workflows workflow
cross join (values
  (
    'node-source-photo-db5',
    'source:photo:db5',
    'revision-source-photo-db5'
  ),
  (
    'node-source-warranty-db5',
    'source:warranty:db5',
    'revision-source-warranty-db5'
  )
) seed(node_id, stable_key, revision_id)
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into project_intelligence.graph_node_revisions (
  organization_id,
  project_id,
  revision_id,
  node_id,
  revision_no,
  title,
  payload,
  origin,
  claim_status,
  unknown_reason,
  replaces_revision_id,
  content_digest,
  created_by_type,
  created_by_id
)
select
  workflow.organization_id,
  workflow.project_id,
  seed.revision_id,
  seed.node_id,
  1,
  seed.title,
  jsonb_build_object(
    'schemaVersion', 'project-ceo-source/0.1',
    'sourceId', seed.source_id
  ),
  'import',
  'extracted',
  null,
  null,
  project_intelligence._sha256_jsonb(jsonb_build_object(
    'schemaVersion', 'project-ceo-source/0.1',
    'sourceId', seed.source_id
  )),
  'system',
  'system:db5-fixture'
from project_intelligence.project_workflows workflow
cross join (values
  (
    'revision-source-photo-db5',
    'node-source-photo-db5',
    'DB5 accepted field photo',
    'source-sha256-0123456789abcdef01234567'
  ),
  (
    'revision-source-warranty-db5',
    'node-source-warranty-db5',
    'DB5 warranty document',
    'source-sha256-fedcba9876543210fedcba98'
  )
) seed(revision_id, node_id, title, source_id)
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.source_protected_metadata (
  organization_id,
  project_id,
  source_id,
  package_id,
  original_filename,
  media_type,
  size_bytes,
  extension,
  source_role,
  declared_revision,
  document_status
)
select
  workflow.organization_id,
  workflow.project_id,
  seed.source_id,
  '41111111-1111-4111-8111-111111111111',
  seed.original_filename,
  seed.media_type,
  seed.size_bytes,
  seed.extension,
  seed.source_role,
  seed.declared_revision,
  'current'
from project_intelligence.project_workflows workflow
cross join (values
  (
    'source-sha256-0123456789abcdef01234567',
    'private-field-photo.jpg',
    'image/jpeg',
    1000::bigint,
    'jpg',
    'photo-evidence',
    'photo-r1'
  ),
  (
    'source-sha256-fedcba9876543210fedcba98',
    'private-warranty.pdf',
    'application/pdf',
    2000::bigint,
    'pdf',
    'document',
    'warranty-r1'
  )
) seed(
  source_id,
  original_filename,
  media_type,
  size_bytes,
  extension,
  source_role,
  declared_revision
)
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.source_inventory_records (
  organization_id,
  project_id,
  physical_record_id,
  package_id,
  sanitized_name,
  floor_key,
  zone_key,
  discipline_key,
  availability,
  document_status,
  size_bytes,
  checksum,
  source_revision_id,
  logical_source_id,
  semantic_conflict,
  registered_by_user_id
)
select
  workflow.organization_id,
  workflow.project_id,
  seed.physical_record_id,
  '41111111-1111-4111-8111-111111111111',
  seed.sanitized_name,
  'floor:db5',
  'zone:db5',
  seed.discipline_key,
  'materialized',
  'current',
  seed.size_bytes,
  decode(seed.checksum_hex, 'hex'),
  seed.source_revision_id,
  seed.source_id,
  false,
  '31111111-1111-4111-8111-111111111111'
from project_intelligence.project_workflows workflow
cross join (values
  (
    '51111111-aaaa-4111-8111-111111111111'::uuid,
    'field-photo.jpg',
    'photo',
    1000::bigint,
    repeat('0123456789abcdef', 4),
    'revision-source-photo-db5',
    'source-sha256-0123456789abcdef01234567'
  ),
  (
    '52222222-bbbb-4222-8222-222222222222'::uuid,
    'warranty.pdf',
    'handover',
    2000::bigint,
    repeat('fedcba9876543210', 4),
    'revision-source-warranty-db5',
    'source-sha256-fedcba9876543210fedcba98'
  )
) seed(
  physical_record_id,
  sanitized_name,
  discipline_key,
  size_bytes,
  checksum_hex,
  source_revision_id,
  source_id
)
where workflow.project_id = '41111111-1111-4111-8111-111111111111';
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select (
  projectceo_m4_api.submit_change_request(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111',
    'baseline-db4-v1',
    'baseline-db5-v2',
    'package-db4-root-v1',
    'Client approved a floor finish replacement',
    175000,
    4,
    :'db5_state_revision'::bigint,
    'db5-submit-change'
  ) #>> '{result,id}'
) as change_request_id
\gset db5_
commit;

select set_config(
  'projectceo.db5_change_state',
  :'db5_state_revision',
  false
);

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $change_replay$
declare
  v_response jsonb;
begin
  v_response := projectceo_m4_api.submit_change_request(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111',
    'baseline-db4-v1',
    'baseline-db5-v2',
    'package-db4-root-v1',
    'Client approved a floor finish replacement',
    175000,
    4,
    current_setting('projectceo.db5_change_state')::bigint,
    'db5-submit-change'
  );
  if not (v_response ->> 'replay')::boolean then
    raise exception 'DB5_CHANGE_REPLAY_FAILED';
  end if;
end
$change_replay$;
rollback;

select set_config(
  'projectceo.db5_duplicate_transition_state',
  workflow.state_revision::text,
  false
)
from project_intelligence.project_workflows workflow
where workflow.project_id =
  '41111111-1111-4111-8111-111111111111';

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $duplicate_change_transition$
begin
  begin
    perform projectceo_m4_api.submit_change_request(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'baseline-db4-v1',
      'baseline-db5-v2',
      'package-db4-root-v1',
      'Same transition under another command key',
      175000,
      4,
      current_setting(
        'projectceo.db5_duplicate_transition_state'
      )::bigint,
      'db5-duplicate-change-transition'
    );
    raise exception 'DB5_DUPLICATE_CHANGE_TRANSITION_ALLOWED';
  exception when sqlstate 'P1110' then null;
  end;
end
$duplicate_change_transition$;
rollback;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

select set_config(
  'projectceo.db5_current_state',
  :'db5_state_revision',
  false
);
select set_config(
  'projectceo.db5_change_request_id',
  :'db5_change_request_id',
  false
);

-- V1 Impact (DEC-033): глубина и лимит больше не аргументы вызывающего —
-- политика фиксирована сервером (`_impact_policy()`), поэтому теста
-- «недопустимая глубина от вызывающего» здесь больше нет как класса: его
-- заменяет проверка §26/27, что дверь с аргументом `max_depth` вообще
-- недостижима (`DB5_RAW_IMPACT_RPC_REACHABLE_BY_SERVICE_ROLE`).
begin;
set local role service_role;
select (
  projectceo_m4_api.calculate_change_impact_policy_bound(
    '41111111-1111-4111-8111-111111111111',
    :'db5_change_request_id'::uuid,
    :'db5_state_revision'::bigint,
    'db5-calculate-impact'
  ) #>> '{result,id}'
) as impact_run_id
\gset db5_
commit;

select impact_id
from projectceo_m4.impacts
where project_id = '41111111-1111-4111-8111-111111111111'
  and impact_run_id = :'db5_impact_run_id'::uuid
  and impacted_node_id = 'node-deliverable-db5'
\gset db5_

select set_config(
  'projectceo.db5_impact_run_id',
  :'db5_impact_run_id',
  false
);

-- Малый золотой граф исчерпывается на первом же соседе: единственный исход —
-- complete. Полная матрица complete/partial_depth/blocked_result_limit
-- проверяется отдельно, на специально построенных графах
-- (`29_impact_coverage_dec034.sql`), где размер и форма графа управляемы.
do $impact_contract$
declare
  v_policy jsonb := projectceo_m4._impact_policy();
begin
  if (
    select count(*)
    from projectceo_m4.impacts impact
    where impact.project_id = '41111111-1111-4111-8111-111111111111'
      and impact.impact_run_id =
        current_setting('projectceo.db5_impact_run_id')::uuid
  ) <> 1 or not exists (
    select 1
    from projectceo_m4.impacts impact
    where impact.project_id = '41111111-1111-4111-8111-111111111111'
      and impact.impact_run_id =
        current_setting('projectceo.db5_impact_run_id')::uuid
      and impact.changed_node_id = 'node-decision-db4'
      and impact.changed_revision_id = 'revision-decision-db5-r2'
      and impact.impacted_node_id = 'node-deliverable-db5'
      and impact.distance = 1
      and cardinality(impact.node_path) = 2
  ) then
    raise exception 'DB5_BOUNDED_IMPACT_INVALID';
  end if;

  -- Политика читается динамически: версия и глубина здесь — то, что живая
  -- база отдаёт СЕЙЧАС, а не число, застывшее в тексте сценария.
  if not exists (
    select 1
    from projectceo_m4.impact_runs run
    where run.project_id = '41111111-1111-4111-8111-111111111111'
      and run.impact_run_id =
        current_setting('projectceo.db5_impact_run_id')::uuid
      and run.coverage_status = 'complete'
      and run.policy_version = v_policy ->> 'version'
      and run.max_depth = (v_policy ->> 'maxDepth')::integer
      and run.max_impacts = (v_policy ->> 'maxImpacts')::integer
      and run.returned_impact_count = 1
      and run.known_impact_count_lower_bound = 1
      and run.has_more_beyond_depth = false
      and run.cutoff_reason is null
  ) then
    raise exception 'DB5_IMPACT_COVERAGE_SHAPE_INVALID';
  end if;
end
$impact_contract$;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_m4_api.review_change_impact(
  '41111111-1111-4111-8111-111111111111',
  :'db5_impact_run_id'::uuid,
  :'db5_impact_id',
  'resolved',
  'Downstream deliverable updated and checked',
  :'db5_state_revision'::bigint,
  'db5-review-impact'
);
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.publish_production_package_version(
  '41111111-1111-4111-8111-111111111111',
  :'db5_package_descriptor'::jsonb,
  :'db5_state_revision'::bigint,
  'db5-publish-package-v2'
);
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select (
  projectceo_m4_api.define_milestone(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111',
    'package-db5-root-v2',
    'Floor finish accepted',
    '["node-area-db4"]'::jsonb,
    :'db5_state_revision'::bigint,
    'db5-define-milestone'
  ) #>> '{result,id}'
) as milestone_id
\gset db5_
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select (
  projectceo_m4_api.register_photo_evidence(
    '41111111-1111-4111-8111-111111111111',
    :'db5_milestone_id'::uuid,
    'node-area-db4',
    'source-sha256-0123456789abcdef01234567',
    'revision-source-photo-db5',
    statement_timestamp() - interval '1 hour',
    'Field photo after installation',
    :'db5_state_revision'::bigint,
    'db5-register-photo'
  ) #>> '{result,id}'
) as photo_evidence_id
\gset db5_
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

select set_config(
  'projectceo.db5_current_state',
  :'db5_state_revision',
  false
);
select set_config(
  'projectceo.db5_milestone_id',
  :'db5_milestone_id',
  false
);

begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $milestone_before_photo_review$
begin
  begin
    perform projectceo_m4_api.accept_milestone(
      '41111111-1111-4111-8111-111111111111',
      current_setting('projectceo.db5_milestone_id')::uuid,
      current_setting('projectceo.db5_current_state')::bigint,
      'db5-premature-milestone'
    );
    raise exception 'DB5_PREMATURE_MILESTONE_ACCEPTED';
  exception when sqlstate 'P1110' then null;
  end;
end
$milestone_before_photo_review$;
rollback;

begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_m4_api.review_photo_evidence(
  '41111111-1111-4111-8111-111111111111',
  :'db5_photo_evidence_id'::uuid,
  'accepted',
  'Photo confirms accepted work in the exact area',
  :'db5_state_revision'::bigint,
  'db5-review-photo'
);
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_m4_api.accept_milestone(
  '41111111-1111-4111-8111-111111111111',
  :'db5_milestone_id'::uuid,
  :'db5_state_revision'::bigint,
  'db5-accept-milestone'
);
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

select set_config(
  'projectceo.db5_current_state',
  :'db5_state_revision',
  false
);

begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $accepted_milestone_photo_stream_closed$
begin
  begin
    perform projectceo_m4_api.register_photo_evidence(
      '41111111-1111-4111-8111-111111111111',
      current_setting('projectceo.db5_milestone_id')::uuid,
      'node-area-db4',
      'source-sha256-0123456789abcdef01234567',
      'revision-source-photo-db5',
      statement_timestamp() - interval '30 minutes',
      'Late evidence must not change accepted snapshot',
      current_setting('projectceo.db5_current_state')::bigint,
      'db5-late-accepted-photo'
    );
    raise exception 'DB5_ACCEPTED_MILESTONE_PHOTO_MUTATED';
  exception when sqlstate 'P1110' then null;
  end;
end
$accepted_milestone_photo_stream_closed$;
rollback;

begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_m4_api.register_handover_document(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'package-db5-root-v2',
  'warranty',
  'source-sha256-fedcba9876543210fedcba98',
  'revision-source-warranty-db5',
  :'db5_state_revision'::bigint,
  'db5-register-warranty'
);
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

begin;
do $handover_without_photo_ref$
declare
  v_handover_id uuid := extensions.gen_random_uuid();
  v_semantic_digest bytea := project_intelligence._sha256_jsonb(
    '{"negativeFixture":"missing-photo-ref"}'::jsonb
  );
begin
  begin
    insert into projectceo_m4.construction_handovers (
      organization_id,
      project_id,
      construction_handover_id,
      package_id,
      production_package_version_id,
      baseline_id,
      graph_version_id,
      semantic_content,
      semantic_digest,
      contract_version,
      hash_contract_version,
      created_by_id
    )
    select
      baseline.organization_id,
      baseline.project_id,
      v_handover_id,
      '41111111-1111-4111-8111-111111111111'::uuid,
      'package-db5-root-v2',
      baseline.baseline_id,
      baseline.graph_version_id,
      '{"negativeFixture":"missing-photo-ref"}'::jsonb,
      v_semantic_digest,
      'project-ceo-construction-handover/0.1',
      'jsonb-recursive-sorted-object-keys-arrays-contract-order/1',
      'system:db5-negative'
    from projectceo_product.project_baselines baseline
    where baseline.project_id =
      '41111111-1111-4111-8111-111111111111'
      and baseline.baseline_id = 'baseline-db5-v2';

    insert into projectceo_m4.handover_milestone_refs (
      organization_id,
      project_id,
      construction_handover_id,
      package_id,
      production_package_version_id,
      handover_semantic_digest,
      milestone_acceptance_id,
      milestone_id,
      milestone_semantic_digest
    )
    select
      acceptance.organization_id,
      acceptance.project_id,
      v_handover_id,
      acceptance.package_id,
      acceptance.production_package_version_id,
      v_semantic_digest,
      acceptance.milestone_acceptance_id,
      acceptance.milestone_id,
      acceptance.semantic_digest
    from projectceo_m4.milestone_acceptances acceptance
    where acceptance.project_id =
      '41111111-1111-4111-8111-111111111111'
      and acceptance.production_package_version_id =
        'package-db5-root-v2';

    insert into projectceo_m4.handover_document_refs (
      organization_id,
      project_id,
      construction_handover_id,
      package_id,
      production_package_version_id,
      handover_semantic_digest,
      handover_document_id,
      document_kind,
      source_revision_id,
      source_checksum
    )
    select
      document.organization_id,
      document.project_id,
      v_handover_id,
      document.package_id,
      document.production_package_version_id,
      v_semantic_digest,
      document.handover_document_id,
      document.document_kind,
      document.source_revision_id,
      document.source_checksum
    from projectceo_m4.handover_documents document
    where document.project_id =
      '41111111-1111-4111-8111-111111111111'
      and document.production_package_version_id =
        'package-db5-root-v2';

    set constraints
      projectceo_m4.m4_construction_handover_closure immediate;
    raise exception 'DB5_HANDOVER_WITHOUT_PHOTO_REF_ALLOWED';
  exception when check_violation then null;
  end;
end
$handover_without_photo_ref$;
rollback;

select set_config(
  'projectceo.db5_handover_state',
  :'db5_state_revision',
  false
);

begin;
set local role service_role;
select
  response #>> '{result,id}' as handover_id,
  response #>> '{result,semanticHash}' as handover_hash
from (
  select projectceo_m4_api.build_construction_handover(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111',
    'package-db5-root-v2',
    :'db5_state_revision'::bigint,
    'db5-build-handover'
  ) response
) built
\gset db5_
commit;

select set_config(
  'projectceo.db5_handover_id',
  :'db5_handover_id',
  false
);
select set_config(
  'projectceo.db5_handover_hash',
  :'db5_handover_hash',
  false
);

do $handover_hash_contract$
begin
  if not exists (
    select 1
    from projectceo_m4.construction_handovers handover
    where handover.project_id = '41111111-1111-4111-8111-111111111111'
      and handover.construction_handover_id =
        current_setting('projectceo.db5_handover_id')::uuid
      and 'sha256:' || encode(
        project_intelligence._sha256_jsonb(handover.semantic_content),
        'hex'
      ) = current_setting('projectceo.db5_handover_hash')
      and handover.semantic_content ->> 'schemaVersion' =
        'project-ceo-construction-handover/0.1'
  ) then
    raise exception 'DB5_HANDOVER_HASH_CONTRACT_INVALID';
  end if;
  if (
    select count(*)
    from projectceo_m4.handover_photo_refs reference
    where reference.project_id = '41111111-1111-4111-8111-111111111111'
      and reference.construction_handover_id =
        current_setting('projectceo.db5_handover_id')::uuid
  ) <> 1 or (
    select count(*)
    from projectceo_m4.handover_document_refs reference
    where reference.project_id = '41111111-1111-4111-8111-111111111111'
      and reference.construction_handover_id =
        current_setting('projectceo.db5_handover_id')::uuid
      and reference.document_kind = 'warranty'
  ) <> 1 then
    raise exception 'DB5_HANDOVER_EXACT_REFS_INVALID';
  end if;
end
$handover_hash_contract$;

select set_config(
  'projectceo.db5_current_state',
  state_revision::text,
  false
)
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111';

begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $closed_version_rejected$
begin
  begin
    perform projectceo_m4_api.define_milestone(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'package-db5-root-v2',
      'Late milestone must fail',
      '["node-area-db4"]'::jsonb,
      current_setting('projectceo.db5_current_state')::bigint,
      'db5-late-milestone'
    );
    raise exception 'DB5_CLOSED_HANDOVER_VERSION_MUTATED';
  exception when sqlstate 'P1110' then null;
  end;
end
$closed_version_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $delivery_projection$
declare
  v_delivery jsonb;
begin
  v_delivery := projectceo_m4_api.get_execution_delivery(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_delivery #> '{data,changeRequests}') <> 1
     or jsonb_array_length(v_delivery #> '{data,impactRuns}') <> 1
     or jsonb_array_length(v_delivery #> '{data,milestones}') <> 1
     or jsonb_array_length(
       v_delivery #> '{data,constructionHandovers}'
     ) <> 1
     or v_delivery::text ~
       '(private-field-photo|private-warranty|storage_object_path|ru/db5/)'
  then
    raise exception 'DB5_DELIVERY_PROJECTION_INVALID';
  end if;
end
$delivery_projection$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '33333333-3333-4333-8333-333333333333';
do $cross_tenant_denied$
begin
  begin
    perform projectceo_m4_api.get_execution_delivery(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111'
    );
    raise exception 'DB5_CROSS_TENANT_READ_ALLOWED';
  exception when sqlstate 'P1103' then null;
  end;
end
$cross_tenant_denied$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $idempotency_conflict$
begin
  begin
    perform projectceo_m4_api.submit_change_request(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'baseline-db4-v1',
      'baseline-db5-v2',
      'package-db4-root-v1',
      'Different reason under the same key',
      175000,
      4,
      current_setting('projectceo.db5_change_state')::bigint,
      'db5-submit-change'
    );
    raise exception 'DB5_IDEMPOTENCY_CONFLICT_MISSING';
  exception when sqlstate 'P1108' then null;
  end;
end
$idempotency_conflict$;
rollback;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db5_

select set_config(
  'projectceo.db5_current_state',
  :'db5_state_revision',
  false
);

begin;
set local role pi_db5_execution_tester;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
set local projectceo.product_test_fail_after_domain = 'on';
do $rollback_after_domain$
begin
  begin
    perform projectceo_m4_api.define_milestone(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'package-db4-root-v1',
      'Rollback-only milestone',
      '["node-area-db4"]'::jsonb,
      current_setting('projectceo.db5_current_state')::bigint,
      'db5-rollback-milestone'
    );
    raise exception 'DB5_ROLLBACK_NOT_TRIGGERED';
  exception when sqlstate 'P1112' then null;
  end;
end
$rollback_after_domain$;
rollback;

do $rollback_assertion$
begin
  if exists (
    select 1
    from projectceo_m4.milestones milestone
    where milestone.project_id = '41111111-1111-4111-8111-111111111111'
      and milestone.title = 'Rollback-only milestone'
  ) then
    raise exception 'DB5_ROLLBACK_PARTIAL_STATE';
  end if;
end
$rollback_assertion$;

do $immutability$
begin
  begin
    update projectceo_m4.change_requests
    set delta_days = 99
    where project_id = '41111111-1111-4111-8111-111111111111';
    raise exception 'DB5_CHANGE_REQUEST_MUTABLE';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    delete from projectceo_m4.construction_handovers
    where project_id = '41111111-1111-4111-8111-111111111111';
    raise exception 'DB5_HANDOVER_MUTABLE';
  exception when object_not_in_prerequisite_state then null;
  end;
end
$immutability$;

select 'DB5_M4_V2_V3_COMPATIBILITY_OK' as result;
select 'DB5_EXECUTION_OPERATIONS_OK' as result;
