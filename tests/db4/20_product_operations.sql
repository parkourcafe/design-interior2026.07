\set ON_ERROR_STOP on

-- DB3 operations seed one enrolled RU project, one exact version-scoped source
-- evidence chain, owner + architect memberships and an active work package.

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
  pw.organization_id,
  pw.project_id,
  seed.node_id,
  seed.kind,
  seed.stable_key,
  seed.revision_id
from project_intelligence.project_workflows pw
cross join (values
  (
    'node-area-db4',
    'area',
    'area:db4',
    'revision-area-db4'
  ),
  (
    'node-requirement-db4',
    'requirement',
    'requirement:db4',
    'revision-requirement-db4'
  ),
  (
    'node-assumption-db4',
    'assumption',
    'assumption:db4',
    'revision-assumption-db4'
  )
) seed(node_id, kind, stable_key, revision_id)
where pw.project_id = '41111111-1111-4111-8111-111111111111';

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
  pw.organization_id,
  pw.project_id,
  seed.revision_id,
  seed.node_id,
  1,
  seed.title,
  seed.payload,
  'human',
  'human_origin',
  null,
  null,
  project_intelligence._sha256_jsonb(seed.payload),
  'human',
  '31111111-1111-4111-8111-111111111111'
from project_intelligence.project_workflows pw
cross join lateral (values
  (
    'revision-area-db4',
    'node-area-db4',
    'DB4 area',
    jsonb_build_object(
      'schemaVersion', 'project-ceo/area/0.1',
      'name', 'DB4 Area'
    )
  ),
  (
    'revision-requirement-db4',
    'node-requirement-db4',
    'DB4 requirement',
    jsonb_build_object(
      'packageId', '41111111-1111-4111-8111-111111111111',
      'schemaVersion', 'project-ceo/requirement/0.1',
      'statement', 'DB4 exact requirement'
    )
  ),
  (
    'revision-assumption-db4',
    'node-assumption-db4',
    'DB4 assumption',
    jsonb_build_object(
      'packageId', '41111111-1111-4111-8111-111111111111',
      'schemaVersion', 'project-ceo/assumption/0.1',
      'statement', 'DB4 exact assumption',
      'validationNeeded', 'Human review'
    )
  )
) seed(revision_id, node_id, title, payload)
where pw.project_id = '41111111-1111-4111-8111-111111111111';

commit;

select jsonb_build_object(
  'evidenceVersionId', pw.latest_version_id,
  'evidenceLinkId', 'evidence-requirement-1',
  'sourceId', 'source-pdf-1',
  'sourceNodeId', 'node-source-1',
  'sourceRevisionId', 'revision-source-1',
  'fragmentId', 'fragment-pdf-1'
) as evidence,
pw.state_revision as state_revision,
pw.organization_id as organization_id,
pw.latest_version_id as graph_version_id
from project_intelligence.project_workflows pw
where pw.project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select set_config(
  'projectceo.db4_state_revision',
  :'db4_state_revision',
  false
);
select set_config(
  'projectceo.db4_evidence',
  :'db4_evidence',
  false
);
begin;
set local role service_role;
do $system_without_evidence_rejected$
begin
  begin
    perform projectceo_product_api.append_system_decision_revision(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'node-decision-db4-invalid',
      'revision-decision-db4-invalid',
      null,
      'interpreted',
      'Invalid system decision',
      'Must not persist',
      'node-area-db4',
      'proposed',
      '[]'::jsonb,
      'Missing evidence',
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-system-no-evidence'
    );
    raise exception 'DB4_SYSTEM_REVISION_WITHOUT_EVIDENCE';
  exception when sqlstate 'P1111' then null;
  end;
  begin
    perform projectceo_product_api.append_system_decision_revision(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'node-decision-db4-human-invalid',
      'revision-decision-db4-human-invalid',
      null,
      'human_origin',
      'Invalid system human-origin decision',
      'Must not persist',
      'node-area-db4',
      'proposed',
      jsonb_build_array(
        current_setting('projectceo.db4_evidence')::jsonb
      ),
      'System cannot claim human authorship',
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-system-human-origin'
    );
    raise exception 'DB4_SYSTEM_HUMAN_ORIGIN_ALLOWED';
  exception when sqlstate 'P1111' then null;
  end;
  begin
    perform projectceo_product_api.append_system_decision_revision(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'node-decision-db4-evidence-invalid',
      'revision-decision-db4-evidence-invalid',
      null,
      'interpreted',
      'Invalid exact evidence decision',
      'Must not persist',
      'node-area-db4',
      'proposed',
      jsonb_build_array(
        jsonb_set(
          current_setting('projectceo.db4_evidence')::jsonb,
          '{evidenceVersionId}',
          '"version-not-in-project"'::jsonb
        )
      ),
      'Wrong exact evidence version',
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-system-wrong-evidence-version'
    );
    raise exception 'DB4_WRONG_EVIDENCE_VERSION_ALLOWED';
  exception when sqlstate 'P1111' then null;
  end;
end
$system_without_evidence_rejected$;
rollback;

begin;
set local role service_role;
select projectceo_product_api.append_system_decision_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'node-decision-db4',
  'revision-decision-db4-r1',
  null,
  'interpreted',
  'DB4 sourced decision',
  'Use the approved floor solution',
  'node-area-db4',
  'proposed',
  jsonb_build_array(:'db4_evidence'::jsonb),
  'Extracted from exact approved source version',
  :'db4_state_revision'::bigint,
  'db4-system-decision-r1'
);
commit;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select set_config(
  'projectceo.db4_state_revision',
  :'db4_state_revision',
  false
);
select set_config(
  'projectceo.db4_evidence',
  :'db4_evidence',
  false
);
begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $price_bounds_rejected$
begin
  begin
    perform projectceo_product_api.append_price_observation(
      '41111111-1111-4111-8111-111111111111',
      'revision-selection-db4-r1',
      'price-db4-negative',
      -1,
      current_setting('projectceo.db4_evidence')::jsonb,
      'supplier:test',
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-price-negative'
    );
    raise exception 'DB4_NEGATIVE_PRICE_ALLOWED';
  exception when sqlstate 'P1111' then null;
  end;
  begin
    perform projectceo_product_api.append_price_observation(
      '41111111-1111-4111-8111-111111111111',
      'revision-selection-db4-r1',
      'price-db4-unsafe',
      9007199254740992,
      current_setting('projectceo.db4_evidence')::jsonb,
      'supplier:test',
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-price-unsafe'
    );
    raise exception 'DB4_UNSAFE_INTEGER_PRICE_ALLOWED';
  exception when sqlstate 'P1111' then null;
  end;
end
$price_bounds_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.append_selection_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'node-selection-db4',
  'revision-selection-db4-r1',
  null,
  'human_origin',
  'DB4 finish selection',
  'node-area-db4',
  'revision-decision-db4-r1',
  '{"material":"porcelain","finish":"matte"}'::jsonb,
  '[]'::jsonb,
  'Human-authored exact selection',
  :'db4_state_revision'::bigint,
  'db4-selection-r1'
);
commit;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.append_price_observation(
  '41111111-1111-4111-8111-111111111111',
  'revision-selection-db4-r1',
  'price-db4-1',
  125000,
  :'db4_evidence'::jsonb,
  'supplier:test',
  :'db4_state_revision'::bigint,
  'db4-price-1'
);
commit;

do $price_server_time_and_evidence$
begin
  if not exists (
    select 1
    from projectceo_product.price_observations po
    where po.project_id = '41111111-1111-4111-8111-111111111111'
      and po.observation_id = 'price-db4-1'
      and po.amount_rub = 125000
      and po.source_revision_id = 'revision-source-1'
      and po.observed_at <= statement_timestamp()
      and po.observed_at > statement_timestamp() - interval '1 minute'
  ) then
    raise exception 'DB4_PRICE_OBSERVATION_INVALID';
  end if;
end
$price_server_time_and_evidence$;

select state_revision as state_revision,
  latest_version_id as latest_version_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select project_intelligence_api.publish_version(
  '41111111-1111-4111-8111-111111111111',
  :'db4_latest_version_id',
  :'db4_state_revision'::bigint,
  'DB4 Product Brain graph snapshot',
  '[]'::jsonb,
  'db4-publish-graph-v2'
);
commit;

select state_revision as state_revision,
  latest_version_id as graph_version_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.create_approval_package(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'approval-db4-root',
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
      'revisionId', 'revision-decision-db4-r1'
    ),
    jsonb_build_object(
      'targetKind', 'selection_revision',
      'entityId', 'node-selection-db4',
      'revisionId', 'revision-selection-db4-r1'
    )
  ),
  :'db4_state_revision'::bigint,
  'db4-create-approval'
);
commit;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.submit_approval_package(
  '41111111-1111-4111-8111-111111111111',
  'approval-db4-root',
  'draft',
  :'db4_state_revision'::bigint,
  'db4-submit-approval'
);
commit;

select state_revision as state_revision,
  organization_id as organization_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select jsonb_build_object(
  'id', 'baseline-db4-v1',
  'graphVersionId', :'db4_graph_version_id',
  'previousBaselineId', null,
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
    jsonb_build_array('revision-decision-db4-r1'),
  'selectionRevisionIds',
    jsonb_build_array('revision-selection-db4-r1'),
  'approvalPackageIds',
    jsonb_build_array('approval-db4-root'),
  'semanticHash', 'sha256:' || encode(
    project_intelligence._sha256_jsonb(jsonb_build_object(
      'approvalPackageIds', jsonb_build_array('approval-db4-root'),
      'assumptionRevisionIds',
        jsonb_build_array('revision-assumption-db4'),
      'decisionRevisionIds',
        jsonb_build_array('revision-decision-db4-r1'),
      'graphVersionId', :'db4_graph_version_id',
      'organizationId', :'db4_organization_id'::uuid,
      'packageIds', jsonb_build_array(
        '41111111-1111-4111-8111-111111111111',
        '49999999-9999-4999-8999-999999999999'
      ),
      'packages', (
        select jsonb_agg(jsonb_build_object(
          'id', pp.id,
          'kind', pp.kind,
          'parentPackageId', pp.parent_package_id,
          'stableKey', pp.stable_key
        ) order by pp.id::text collate "C")
        from projectceo_foundation.project_packages pp
        where pp.organization_id = :'db4_organization_id'::uuid
          and pp.project_id =
            '41111111-1111-4111-8111-111111111111'
          and pp.id in (
            '41111111-1111-4111-8111-111111111111',
            '49999999-9999-4999-8999-999999999999'
          )
      ),
      'previousBaselineId', null,
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
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select set_config(
  'projectceo.db4_baseline_descriptor',
  :'db4_baseline_descriptor',
  false
);
select set_config(
  'projectceo.db4_state_revision',
  :'db4_state_revision',
  false
);
do $unapproved_baseline_rejected$
begin
  begin
    perform projectceo_product_api.publish_project_baseline(
      '41111111-1111-4111-8111-111111111111',
      current_setting(
        'projectceo.db4_baseline_descriptor'
      )::jsonb,
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-baseline-before-review'
    );
    raise exception 'DB4_UNAPPROVED_BASELINE_PUBLISHED';
  exception when sqlstate 'P1111' then null;
  end;
end
$unapproved_baseline_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.review_approval_package(
  '41111111-1111-4111-8111-111111111111',
  'approval-db4-root',
  'submitted',
  'approved',
  'Approved exact DB4 revisions',
  :'db4_state_revision'::bigint,
  'db4-review-approval'
);
commit;

do $self_approval_marker$
declare
  v_self_approved boolean;
  v_actor_user_id uuid;
begin
  select event.self_approved, event.actor_user_id
  into v_self_approved, v_actor_user_id
  from projectceo_product.approval_package_events event
  where event.approval_package_id = 'approval-db4-root'
    and event.to_status = 'approved';
  if not coalesce(v_self_approved, false)
     or v_actor_user_id <> '31111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'DB4_SELF_APPROVED_MARKER_INVALID';
  end if;
end
$self_approval_marker$;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.publish_project_baseline(
  '41111111-1111-4111-8111-111111111111',
  :'db4_baseline_descriptor'::jsonb,
  :'db4_state_revision'::bigint,
  'db4-publish-baseline-v1'
);
commit;

select state_revision as state_revision,
  organization_id as organization_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select jsonb_build_object(
  'id', 'package-db4-root-v1',
  'packageId', '41111111-1111-4111-8111-111111111111',
  'baselineId', 'baseline-db4-v1',
  'previousVersionId', null,
  'exactRevisionRefs', jsonb_build_object(
    'sources', jsonb_build_array('revision-source-1'),
    'requirements', jsonb_build_array('revision-requirement-db4'),
    'assumptions', jsonb_build_array('revision-assumption-db4'),
    'decisions', jsonb_build_array('revision-decision-db4-r1'),
    'selections', jsonb_build_array('revision-selection-db4-r1')
  ),
  'semanticHash', 'sha256:' || encode(
    project_intelligence._sha256_jsonb(jsonb_build_object(
      'baselineId', 'baseline-db4-v1',
      'exactRevisionRefs', jsonb_build_object(
        'assumptions', jsonb_build_array('revision-assumption-db4'),
        'decisions', jsonb_build_array('revision-decision-db4-r1'),
        'requirements', jsonb_build_array('revision-requirement-db4'),
        'selections', jsonb_build_array('revision-selection-db4-r1'),
        'sources', jsonb_build_array('revision-source-1')
      ),
      'organizationId', :'db4_organization_id'::uuid,
      'packageId', '41111111-1111-4111-8111-111111111111',
      'previousVersionId', null,
      'projectId', '41111111-1111-4111-8111-111111111111',
      'schemaVersion', 'project-ceo-production-package/0.1'
    )),
    'hex'
  )
) as root_package_descriptor
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.publish_production_package_version(
  '41111111-1111-4111-8111-111111111111',
  :'db4_root_package_descriptor'::jsonb,
  :'db4_state_revision'::bigint,
  'db4-publish-root-package-v1'
);
commit;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select jsonb_build_object(
  'id', 'package-db4-work-v1',
  'packageId', '49999999-9999-4999-8999-999999999999',
  'baselineId', 'baseline-db4-v1',
  'previousVersionId', null,
  'exactRevisionRefs', jsonb_build_object(
    'sources', jsonb_build_array('revision-source-1'),
    'requirements', '[]'::jsonb,
    'assumptions', '[]'::jsonb,
    'decisions', jsonb_build_array('revision-decision-db4-r1'),
    'selections', jsonb_build_array('revision-selection-db4-r1')
  ),
  'semanticHash', 'sha256:' || encode(
    project_intelligence._sha256_jsonb(jsonb_build_object(
      'baselineId', 'baseline-db4-v1',
      'exactRevisionRefs', jsonb_build_object(
        'assumptions', '[]'::jsonb,
        'decisions', jsonb_build_array('revision-decision-db4-r1'),
        'requirements', '[]'::jsonb,
        'selections', jsonb_build_array('revision-selection-db4-r1'),
        'sources', jsonb_build_array('revision-source-1')
      ),
      'organizationId', :'db4_organization_id'::uuid,
      'packageId', '49999999-9999-4999-8999-999999999999',
      'previousVersionId', null,
      'projectId', '41111111-1111-4111-8111-111111111111',
      'schemaVersion', 'project-ceo-production-package/0.1'
    )),
    'hex'
  )
) as work_package_descriptor
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select set_config(
  'projectceo.db4_work_package_descriptor',
  :'db4_work_package_descriptor',
  false
);
select set_config(
  'projectceo.db4_state_revision',
  :'db4_state_revision',
  false
);
do $work_package_outside_baseline_rejected$
declare
  v_invalid jsonb;
begin
  v_invalid := jsonb_set(
    current_setting(
      'projectceo.db4_work_package_descriptor'
    )::jsonb,
    '{exactRevisionRefs,selections}',
    '["revision-not-in-baseline"]'::jsonb
  );
  begin
    perform projectceo_product_api.publish_production_package_version(
      '41111111-1111-4111-8111-111111111111',
      v_invalid,
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-invalid-work-subset'
    );
    raise exception 'DB4_WORK_PACKAGE_OUTSIDE_BASELINE';
  exception when sqlstate 'P1111' then null;
  end;
end
$work_package_outside_baseline_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.publish_production_package_version(
  '41111111-1111-4111-8111-111111111111',
  :'db4_work_package_descriptor'::jsonb,
  :'db4_state_revision'::bigint,
  'db4-publish-work-package-v1'
);
commit;

select state_revision as state_revision,
  organization_id as organization_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select jsonb_build_object(
  'artifactId', 'release-db4-root-v1',
  'productionPackageVersionId', 'package-db4-root-v1',
  'format', 'logical_json',
  'semanticHash', 'sha256:' || encode(
    project_intelligence._sha256_jsonb(jsonb_build_object(
      'artifacts', jsonb_build_array(jsonb_build_object(
        'contentHash', 'sha256:' || encode(ppv.semantic_digest, 'hex'),
        'kind', 'logical_json'
      )),
      'baselineId', ppv.baseline_id,
      'exactRevisionRefs',
        ppv.semantic_content -> 'exactRevisionRefs',
      'organizationId', ppv.organization_id,
      'packageId', ppv.package_id,
      'productionPackageSemanticHash',
        'sha256:' || encode(ppv.semantic_digest, 'hex'),
      'productionPackageVersionId',
        ppv.production_package_version_id,
      'projectId', ppv.project_id,
      'schemaVersion', 'project-ceo-release/0.1'
    )),
    'hex'
  )
) as release_descriptor
from projectceo_product.production_package_versions ppv
where ppv.organization_id = :'db4_organization_id'::uuid
  and ppv.project_id = '41111111-1111-4111-8111-111111111111'
  and ppv.production_package_version_id = 'package-db4-root-v1'
\gset db4_

begin;
set local role service_role;
select projectceo_product_api.build_release_artifact(
  '41111111-1111-4111-8111-111111111111',
  :'db4_release_descriptor'::jsonb,
  :'db4_state_revision'::bigint,
  'db4-build-release-root-v1'
);
commit;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

begin;
set local role service_role;
select projectceo_product_api.build_release_artifact(
  '41111111-1111-4111-8111-111111111111',
  jsonb_set(
    :'db4_release_descriptor'::jsonb,
    '{artifactId}',
    '"release-db4-root-v1-alias"'::jsonb
  ),
  :'db4_state_revision'::bigint,
  'db4-build-release-existing-tuple'
);
commit;

do $release_existing_tuple$
begin
  if (
    select count(*)
    from projectceo_product.release_artifacts ra
    where ra.project_id = '41111111-1111-4111-8111-111111111111'
      and ra.production_package_version_id = 'package-db4-root-v1'
  ) <> 1 then
    raise exception 'DB4_RELEASE_SEMANTIC_TUPLE_DUPLICATED';
  end if;
  if not exists (
    select 1
    from projectceo_product.command_records cr
    where cr.project_id = '41111111-1111-4111-8111-111111111111'
      and cr.operation = 'build_release_artifact'
      and cr.logical_result ->> 'kind' = 'existing_artifact'
  ) then
    raise exception 'DB4_RELEASE_EXISTING_OUTCOME_MISSING';
  end if;
end
$release_existing_tuple$;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

-- Выдача — через request-bound дверь (M4 backlog #2, `20260825060000`):
-- покрытие семантики выдачи/подтверждения живёт на дверях, которые зовёт
-- приложение. Прежние двери выведены из строя и проверяются ниже отдельным
-- пробником LEGACY_DOOR_RETIRED.
begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.distribute_release_request_bound(
  '41111111-1111-4111-8111-111111111111',
  'release-db4-root-v1',
  '32222222-2222-4222-8222-222222222222',
  :'db4_state_revision'::bigint,
  'db4-distribute-root-v1'
);
commit;

-- Чужая область получателя: пользователь вне проекта — P1109
-- RECIPIENT_SCOPE_REQUIRED (до этой правки семантика не покрывалась нигде).
-- Проверка области стоит до сверки state_revision, поэтому годится любой
-- валидный снимок; свежий берётся ровно для честности аргументов.
select state_revision as probe_state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select set_config(
  'projectceo.db4_probe_state_revision',
  :'db4_probe_state_revision',
  false
);
begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $distribute_foreign_recipient_rejected$
begin
  begin
    perform projectceo_product_api.distribute_release_request_bound(
      '41111111-1111-4111-8111-111111111111',
      'release-db4-root-v1',
      '33333333-3333-4333-8333-333333333333',
      current_setting('projectceo.db4_probe_state_revision')::bigint,
      'db4-distribute-foreign-recipient'
    );
    raise exception 'DB4_DISTRIBUTE_FOREIGN_RECIPIENT_ALLOWED';
  exception when sqlstate 'P1109' then null;
  end;
end
$distribute_foreign_recipient_rejected$;
rollback;

select state_revision as state_revision,
  (
    select rd.distribution_id
    from projectceo_product.release_distributions rd
    where rd.project_id = pw.project_id
      and rd.production_package_version_id = 'package-db4-root-v1'
  ) as distribution_id,
  (
    select 'sha256:' || encode(ra.semantic_digest, 'hex')
    from projectceo_product.release_artifacts ra
    where ra.project_id = pw.project_id
      and ra.artifact_id = 'release-db4-root-v1'
  ) as release_hash
from project_intelligence.project_workflows pw
where pw.project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select set_config(
  'projectceo.db4_distribution_id',
  :'db4_distribution_id',
  false
);
select set_config(
  'projectceo.db4_release_hash',
  :'db4_release_hash',
  false
);
select set_config(
  'projectceo.db4_state_revision',
  :'db4_state_revision',
  false
);
begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $wrong_ack_recipient_rejected$
begin
  begin
    perform projectceo_product_api.acknowledge_release_request_bound(
      '41111111-1111-4111-8111-111111111111',
      current_setting('projectceo.db4_distribution_id')::uuid,
      current_setting('projectceo.db4_release_hash'),
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-ack-wrong-recipient'
    );
    raise exception 'DB4_WRONG_ACK_RECIPIENT_ALLOWED';
  exception when sqlstate 'P1103' then null;
  end;
end
$wrong_ack_recipient_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '32222222-2222-4222-8222-222222222222';
do $wrong_ack_hash_rejected$
begin
  begin
    -- Свежий ключ обязателен: у request-bound двери хеш входит в request
    -- digest, и повтор УЖЕ ИСПОЛЬЗОВАННОГО ключа с другим хешем упёрся бы в
    -- P1108 раньше, чем в проверку хеша.
    perform projectceo_product_api.acknowledge_release_request_bound(
      '41111111-1111-4111-8111-111111111111',
      current_setting('projectceo.db4_distribution_id')::uuid,
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-ack-wrong-hash'
    );
    raise exception 'DB4_WRONG_ACK_HASH_ALLOWED';
  exception when sqlstate 'P1107' then null;
  end;
end
$wrong_ack_hash_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '32222222-2222-4222-8222-222222222222';
select projectceo_product_api.acknowledge_release_request_bound(
  '41111111-1111-4111-8111-111111111111',
  :'db4_distribution_id'::uuid,
  :'db4_release_hash',
  :'db4_state_revision'::bigint,
  'db4-ack-root-v1'
);
commit;

-- Прежние двери выведены из строя (`20260825060000`): гранты среды на них
-- ещё существуют, но тело отвечает отказом при любых аргументах — «дверь
-- недостижима по существу, покрытие живо» на request-bound версиях выше.
begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $legacy_doors_retired$
declare
  v_refused int := 0;
begin
  begin
    perform projectceo_product_api.distribute_release(
      '41111111-1111-4111-8111-111111111111',
      'release-db4-root-v1',
      '32222222-2222-4222-8222-222222222222',
      1,
      'db4-legacy-distribute-probe'
    );
    raise exception 'DB4_LEGACY_DISTRIBUTE_ALIVE';
  exception when sqlstate 'P1111' then v_refused := v_refused + 1;
  end;
  begin
    perform projectceo_product_api.acknowledge_release(
      '41111111-1111-4111-8111-111111111111',
      current_setting('projectceo.db4_distribution_id')::uuid,
      current_setting('projectceo.db4_release_hash'),
      1,
      'db4-legacy-ack-probe'
    );
    raise exception 'DB4_LEGACY_ACK_ALIVE';
  exception when sqlstate 'P1111' then v_refused := v_refused + 1;
  end;
  if v_refused <> 2 then
    raise exception 'DB4_LEGACY_DOORS_REFUSALS_EXPECTED_2_GOT_%', v_refused;
  end if;
end
$legacy_doors_retired$;
rollback;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.approve_no_change(
  '41111111-1111-4111-8111-111111111111',
  'package-db4-root-v1',
  'baseline-db4-v1',
  'Human confirmed no change for exact package version',
  :'db4_state_revision'::bigint,
  'db4-no-change-root-v1'
);
commit;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select set_config(
  'projectceo.db4_expected_state_revision',
  :'db4_state_revision',
  false
);
select set_config(
  'projectceo.db4_evidence',
  :'db4_evidence',
  false
);
begin;
set local role service_role;
set local projectceo.product_test_fail_after_domain = 'on';
do $rollback_after_domain$
begin
  begin
    perform projectceo_product_api.append_system_decision_revision(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'node-decision-db4',
      'revision-decision-db4-rollback',
      'revision-decision-db4-r1',
      'interpreted',
      'Rollback decision',
      'Must roll back',
      'node-area-db4',
      'proposed',
      jsonb_build_array(
        current_setting('projectceo.db4_evidence')::jsonb
      ),
      'Injected rollback',
      current_setting(
        'projectceo.db4_expected_state_revision'
      )::bigint,
      'db4-rollback-decision'
    );
    raise exception 'DB4_ROLLBACK_NOT_TRIGGERED';
  exception when sqlstate 'P1112' then null;
  end;
end
$rollback_after_domain$;
rollback;

do $rollback_assertion$
begin
  if exists (
    select 1
    from project_intelligence.graph_node_revisions gr
    where gr.project_id = '41111111-1111-4111-8111-111111111111'
      and gr.revision_id = 'revision-decision-db4-rollback'
  ) or (
    select state_revision
    from project_intelligence.project_workflows
    where project_id = '41111111-1111-4111-8111-111111111111'
  ) <> current_setting(
    'projectceo.db4_expected_state_revision'
  )::bigint then
    raise exception 'DB4_ROLLBACK_PARTIAL_STATE';
  end if;
end
$rollback_assertion$;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '33333333-3333-4333-8333-333333333333';
do $cross_tenant_denied$
begin
  begin
    perform projectceo_api.get_project_delivery(
      '41111111-1111-4111-8111-111111111111',
      null
    );
    raise exception 'DB4_CROSS_TENANT_READ_ALLOWED';
  exception when sqlstate 'P1103' then null;
  end;
  begin
    perform projectceo_product_api.append_decision_revision(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'node-cross-tenant',
      'revision-cross-tenant',
      null,
      'human_origin',
      'Cross tenant',
      'Denied',
      null,
      'proposed',
      '[]'::jsonb,
      'Denied',
      current_setting(
        'projectceo.db4_expected_state_revision'
      )::bigint,
      'db4-cross-tenant'
    );
    raise exception 'DB4_CROSS_TENANT_WRITE_ALLOWED';
  exception when sqlstate 'P1103' then null;
  end;
end
$cross_tenant_denied$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $idempotency_digest_conflict$
begin
  begin
    perform projectceo_product_api.approve_no_change(
      '41111111-1111-4111-8111-111111111111',
      'package-db4-root-v1',
      'baseline-db4-v1',
      'Different digest under same key',
      current_setting(
        'projectceo.db4_expected_state_revision'
      )::bigint,
      'db4-no-change-root-v1'
    );
    raise exception 'DB4_IDEMPOTENCY_DIGEST_CONFLICT_MISSING';
  exception when sqlstate 'P1108' then null;
  end;
end
$idempotency_digest_conflict$;
rollback;

do $immutability$
begin
  begin
    update projectceo_product.project_baselines
    set semantic_content = '{}'::jsonb
    where project_id = '41111111-1111-4111-8111-111111111111'
      and baseline_id = 'baseline-db4-v1';
    raise exception 'DB4_BASELINE_MUTABLE';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    delete from projectceo_product.release_artifacts
    where project_id = '41111111-1111-4111-8111-111111111111'
      and artifact_id = 'release-db4-root-v1';
    raise exception 'DB4_RELEASE_MUTABLE';
  exception when object_not_in_prerequisite_state then null;
  end;
end
$immutability$;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $delivery_projection$
declare
  v_project jsonb;
  v_package jsonb;
begin
  v_project := projectceo_api.get_project_delivery(
    '41111111-1111-4111-8111-111111111111',
    null
  );
  v_package := projectceo_api.get_project_delivery(
    '41111111-1111-4111-8111-111111111111',
    '49999999-9999-4999-8999-999999999999'
  );
  if v_project #>> '{data,latestBaseline,id}'
       is distinct from 'baseline-db4-v1'
     or jsonb_array_length(v_project #> '{data,packageVersions}') <> 2
     or jsonb_array_length(v_project #> '{data,releaseArtifacts}') <> 1
     or jsonb_array_length(v_project #> '{data,acknowledgements}') <> 1 then
    raise exception 'DB4_PROJECT_DELIVERY_INCOMPLETE';
  end if;
  if jsonb_array_length(v_package #> '{data,packageVersions}') <> 1
     or v_package #>> '{data,packageVersions,0,packageId}'
        is distinct from '49999999-9999-4999-8999-999999999999'
     or jsonb_array_length(v_package #> '{data,releaseArtifacts}') <> 0
     or v_package::text ~
       '41111111-1111-4111-8111-111111111111.*package-db4-root-v1' then
    raise exception 'DB4_PACKAGE_DELIVERY_SCOPE_LEAK';
  end if;
end
$delivery_projection$;
rollback;

do $final_closure$
begin
  if (
    select count(*)
    from projectceo_product.project_baseline_refs pbr
    where pbr.project_id = '41111111-1111-4111-8111-111111111111'
      and pbr.baseline_id = 'baseline-db4-v1'
  ) <> 5 then
    raise exception 'DB4_BASELINE_REF_COUNT';
  end if;
  if (
    select count(*)
    from projectceo_product.approval_package_events ape
    where ape.project_id = '41111111-1111-4111-8111-111111111111'
      and ape.approval_package_id = 'approval-db4-root'
  ) <> 3 then
    raise exception 'DB4_APPROVAL_HISTORY_COUNT';
  end if;
  if not exists (
    select 1
    from projectceo_product.no_change_terminals nct
    where nct.project_id = '41111111-1111-4111-8111-111111111111'
      and nct.baseline_id = 'baseline-db4-v1'
      and nct.production_package_version_id = 'package-db4-root-v1'
  ) then
    raise exception 'DB4_NO_CHANGE_TERMINAL_MISSING';
  end if;
  if exists (
    select 1
    from project_intelligence.change_sets cs
    where cs.project_id = '41111111-1111-4111-8111-111111111111'
      and cs.change_set_id like 'db4-no-change%'
  ) then
    raise exception 'DB4_FAKE_CHANGE_SET_CREATED';
  end if;
end
$final_closure$;

select 'DB4_PRODUCT_OPERATIONS_OK' as result;
