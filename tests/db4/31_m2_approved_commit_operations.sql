\set ON_ERROR_STOP on

-- DB4 exact Approved M2 Commit rehearsal. Run after 30_m2_expansion_operations.sql.
-- Disposable database only: the scenario proves request-bound authorship,
-- authoritative approval provenance, immutable persistence and projection rules.

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

-- The earlier root approval is intentionally self-approved. Create a fresh
-- package submitted by the owner and reviewed by the distinct architect.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.create_approval_package(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'approval-db4-m2-exact',
  jsonb_build_array(jsonb_build_object(
    'targetKind', 'selection_revision',
    'entityId', 'node-selection-db4',
    'revisionId', 'revision-selection-db4-r1'
  )),
  :'db4_state_revision'::bigint,
  'db4-m2-create-approval'
);
commit;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.submit_approval_package(
  '41111111-1111-4111-8111-111111111111',
  'approval-db4-m2-exact',
  'draft',
  :'db4_state_revision'::bigint,
  'db4-m2-submit-approval'
);
commit;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_product_api.review_approval_package(
  '41111111-1111-4111-8111-111111111111',
  'approval-db4-m2-exact',
  'submitted',
  'approved',
  'Approved exact DB4 M2 selection',
  :'db4_state_revision'::bigint,
  'db4-m2-review-approval'
);
commit;

-- An Approved M2 Commit may only point at an exact, already-published layout
-- version in the same project/package/room/variant/role lineage. Publish that
-- immutable version before building the approval snapshot.
select state_revision as state_revision,
  jsonb_build_object(
    'contractVersion', 'archidom.layout-document/0.1',
    'documentId', 'layout-document-db4',
    'projectId', '41111111-1111-4111-8111-111111111111',
    'name', 'Кухня-гостиная · Предпочтительный',
    'canonicalUnits', 'mm', 'stateRevision', 17,
    'floor', jsonb_build_object(
      'id', 'floor-db4', 'label', 'Этаж 1',
      'elevationMm', 0, 'clearHeightMm', 3100
    ),
    'variant', jsonb_build_object(
      'id', 'db4-variant', 'label', 'Предпочтительный', 'status', 'published'
    ),
    'nodes', '[]'::jsonb, 'walls', '[]'::jsonb,
    'openings', '[]'::jsonb, 'columns', '[]'::jsonb,
    'objects', '[]'::jsonb, 'clearanceZones', '[]'::jsonb,
    'materials', '[]'::jsonb, 'materialAssignments', '[]'::jsonb,
    'lights', '[]'::jsonb,
    'metadata', jsonb_build_object(
      'sourceRefs', jsonb_build_array('source:kora-db4-r1'),
      'warnings', '[]'::jsonb
    )
  ) as layout_content,
  projectceo_product._m2_layout_semantic_hash(jsonb_build_object(
    'contractVersion', 'archidom.layout-document/0.1',
    'documentId', 'layout-document-db4',
    'projectId', '41111111-1111-4111-8111-111111111111',
    'name', 'Кухня-гостиная · Предпочтительный',
    'canonicalUnits', 'mm', 'stateRevision', 17,
    'floor', jsonb_build_object('id','floor-db4','label','Этаж 1','elevationMm',0,'clearHeightMm',3100),
    'variant', jsonb_build_object('id','db4-variant','label','Предпочтительный','status','published'),
    'nodes','[]'::jsonb,'walls','[]'::jsonb,'openings','[]'::jsonb,
    'columns','[]'::jsonb,'objects','[]'::jsonb,'clearanceZones','[]'::jsonb,
    'materials','[]'::jsonb,'materialAssignments','[]'::jsonb,'lights','[]'::jsonb,
    'metadata',jsonb_build_object('sourceRefs',jsonb_build_array('source:kora-db4-r1'),'warnings','[]'::jsonb)
  )) as semantic_hash
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_layout_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_product_api.append_m2_workspace_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'layout_version', 'layout-document-db4',
  'layout-version-db4-revision-r1', null, 'published',
  jsonb_build_object(
    'versionId', 'layout-version-db4-r1', 'roomId', 'db4-room',
    'variantId', 'db4-variant', 'role', 'preferred',
    'semanticHash', :'db4_layout_semantic_hash',
    'schemaVersion', 'project-ceo-m2-layout/0.1',
    'layoutContent', :'db4_layout_layout_content'::jsonb
  ),
  'DB4 exact published layout lineage', :'db4_layout_state_revision'::bigint,
  'db4-layout-document-r1'
);
commit;

select pw.state_revision as state_revision,
  jsonb_build_object(
    'approvalPackageId', 'approval-db4-m2-exact',
    'roomId', 'db4-room',
    'designIntentRevisionId', 'design-intent-db4-r1',
    'chosenVariant', jsonb_build_object(
      'variantId', 'db4-variant',
      'role', 'preferred',
      'layoutDocumentId', 'layout-document-db4',
      'layoutVersionId', 'layout-version-db4-r1',
      'semanticHash', :'db4_layout_semantic_hash'
    ),
    'approvedSelectionRevisionIds',
      jsonb_build_array('revision-selection-db4-r1'),
    'budget', jsonb_build_object(
      'asOf', '2026-08-06T12:00:00+08:00',
      'staleAfterDays', 30,
      'amountRub', 189000,
      'staleSelectionRevisionIds', '[]'::jsonb,
      'missingPriceSelectionRevisionIds', '[]'::jsonb
    ),
    'submittedAt', (
      select to_jsonb(event.occurred_at)
      from projectceo_product.approval_package_events event
      where event.project_id = pw.project_id
        and event.approval_package_id = 'approval-db4-m2-exact'
        and event.sequence_no = 2
        and event.to_status = 'submitted'
    ),
    'reviewedAt', (
      select to_jsonb(event.occurred_at)
      from projectceo_product.approval_package_events event
      where event.project_id = pw.project_id
        and event.approval_package_id = 'approval-db4-m2-exact'
        and event.to_status = 'approved'
      order by event.sequence_no desc limit 1
    ),
    'submissionReason', 'Commit exact client-approved snapshot',
    'reviewReason', (
      select event.reason
      from projectceo_product.approval_package_events event
      where event.project_id = pw.project_id
        and event.approval_package_id = 'approval-db4-m2-exact'
        and event.to_status = 'approved'
      order by event.sequence_no desc limit 1
    )
  ) as approved_payload
from project_intelligence.project_workflows pw
where pw.project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_

select set_config(
  'projectceo.db4_state_revision', :'db4_state_revision', false
);
select set_config(
  'projectceo.db4_approved_payload', :'db4_approved_payload', false
);

-- Fail closed before the valid append: fabricated review provenance, a non-null
-- first expected revision, cross-package approval reuse and cross-tenant reuse.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $approved_commit_negatives$
declare
  v_payload jsonb := current_setting('projectceo.db4_approved_payload')::jsonb;
begin
  begin
    perform projectceo_product_api.append_m2_workspace_revision(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'approved_commit', 'db4-approved-provenance',
      'db4-approved-provenance-r1', null, 'approved',
      jsonb_set(v_payload, '{reviewedAt}', to_jsonb(
        ((v_payload->>'reviewedAt')::timestamptz + interval '1 second')
      )),
      'DB4 fabricated provenance must fail',
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-approved-fabricated-provenance'
    );
    raise exception 'DB4_APPROVED_FABRICATED_PROVENANCE_ALLOWED';
  exception when sqlstate 'P1111' then null;
  end;
  begin
    perform projectceo_product_api.append_m2_workspace_revision(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'approved_commit', 'db4-approved-first-stale',
      'db4-approved-first-stale-r1', 'fabricated-prior-revision', 'approved',
      v_payload, 'DB4 initial expected revision must be null',
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-approved-first-stale'
    );
    raise exception 'DB4_APPROVED_INITIAL_EXPECTED_NON_NULL_ALLOWED';
  exception when sqlstate 'P1107' then null;
  end;
  begin
    perform projectceo_product_api.append_m2_workspace_revision(
      '41111111-1111-4111-8111-111111111111',
      '49999999-9999-4999-8999-999999999999',
      'approved_commit', 'db4-approved-cross-package',
      'db4-approved-cross-package-r1', null, 'approved',
      v_payload, 'DB4 cross-package approval must fail',
      current_setting('projectceo.db4_state_revision')::bigint,
      'db4-approved-cross-package'
    );
    raise exception 'DB4_APPROVED_CROSS_PACKAGE_ALLOWED';
  exception when sqlstate 'P1111' then null;
  end;
end
$approved_commit_negatives$;
rollback;

select set_config(
  'projectceo.db4_outsider_state_revision',
  (
    select state_revision::text
    from project_intelligence.project_workflows
    where project_id = '42222222-2222-4222-8222-222222222222'
  ),
  false
);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $approved_commit_cross_tenant$
declare
  v_outsider_state bigint := current_setting(
    'projectceo.db4_outsider_state_revision'
  )::bigint;
begin
  begin
    perform projectceo_product_api.append_m2_workspace_revision(
      '42222222-2222-4222-8222-222222222222',
      '42222222-2222-4222-8222-222222222222',
      'approved_commit', 'db4-approved-cross-tenant',
      'db4-approved-cross-tenant-r1', null, 'approved',
      current_setting('projectceo.db4_approved_payload')::jsonb,
      'DB4 cross-tenant approval must fail', v_outsider_state,
      'db4-approved-cross-tenant'
    );
    raise exception 'DB4_APPROVED_CROSS_TENANT_ALLOWED';
  exception when sqlstate 'P1111' then null;
  end;
end
$approved_commit_cross_tenant$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_product_api.append_m2_workspace_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'approved_commit', 'db4-approved-commit', 'db4-approved-commit-r1',
  null, 'approved', :'db4_approved_payload'::jsonb,
  'DB4 exact approved M2 commit', :'db4_state_revision'::bigint,
  'db4-approved-commit-r1'
);
commit;

-- Identical command replay must not append a second row or audit record even
-- though the workflow state has advanced since the original request.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select (
  projectceo_product_api.append_m2_workspace_revision(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111',
    'approved_commit', 'db4-approved-commit', 'db4-approved-commit-r1',
    null, 'approved', :'db4_approved_payload'::jsonb,
    'DB4 exact approved M2 commit', :'db4_state_revision'::bigint,
    'db4-approved-commit-r1'
  ) ->> 'replay'
)::boolean as replay
\gset db4_
commit;

select case when :'db4_replay'::boolean then true else
  projectceo_product._raise('P1112', 'DB4_APPROVED_REPLAY_FALSE', '{}'::jsonb)
  is null end;

do $approved_commit_storage_audit$
begin
  if (
    select count(*) from projectceo_product.m2_workspace_revisions revision
    where revision.project_id = '41111111-1111-4111-8111-111111111111'
      and revision.entity_kind = 'approved_commit'
      and revision.entity_id = 'db4-approved-commit'
  ) <> 1 then raise exception 'DB4_APPROVED_COMMIT_DUPLICATE_STATE'; end if;
  if (
    select count(*) from projectceo_product.command_records command
    where command.project_id = '41111111-1111-4111-8111-111111111111'
      and command.operation = 'append_m2_approved_commit_revision'
      and command.logical_result->>'entityId' = 'db4-approved-commit'
  ) <> 1 then raise exception 'DB4_APPROVED_COMMIT_COMMAND_AUDIT'; end if;
  if (
    select count(*) from projectceo_product.audit_events event
    where event.project_id = '41111111-1111-4111-8111-111111111111'
      and event.event_type = 'm2_approved_commit_revision_appended'
      and event.controlled_metadata->>'entity_id' = 'db4-approved-commit'
  ) <> 1 then raise exception 'DB4_APPROVED_COMMIT_EVENT_AUDIT'; end if;
end
$approved_commit_storage_audit$;

-- The append-only trigger is authoritative even for a privileged maintenance
-- session; application roles still have no direct private-table access.
do $approved_commit_immutable$
begin
  begin
    update projectceo_product.m2_workspace_revisions
    set reason = 'mutated'
    where project_id = '41111111-1111-4111-8111-111111111111'
      and entity_kind = 'approved_commit'
      and entity_id = 'db4-approved-commit';
    raise exception 'DB4_APPROVED_COMMIT_MUTABLE';
  exception when sqlstate '55000' then null;
  end;
end
$approved_commit_immutable$;

-- Owner sees financial data in project-wide (null package) read. Architect is
-- temporarily classified as a non-financial role only for projection proof.
set role authenticated;
set request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $approved_commit_owner_projection$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v4(
    '41111111-1111-4111-8111-111111111111', null
  ) into v_read;
  if jsonb_array_length(v_read#>'{data,m2ApprovedCommits}') <> 1
     or v_read#>>'{data,m2ApprovedCommits,0,packageId}'
       <> '41111111-1111-4111-8111-111111111111'
     or (v_read#>>'{data,m2ApprovedCommits,0,payload,budget,amountRub}')::bigint
       <> 189000 then
    raise exception 'DB4_APPROVED_PROJECT_READ_V4';
  end if;
end
$approved_commit_owner_projection$;
reset role;

update projectceo_foundation.project_memberships
set role = 'builder'
where project_id = '41111111-1111-4111-8111-111111111111'
  and user_id = '32222222-2222-4222-8222-222222222222';

set role authenticated;
set request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $approved_commit_redacted_projection$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v4(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111'
  ) into v_read;
  if jsonb_array_length(v_read#>'{data,m2ApprovedCommits}') <> 1
     or v_read#>'{data,m2ApprovedCommits,0,payload,budget}' ? 'amountRub' then
    raise exception 'DB4_APPROVED_NONFINANCIAL_REDACTION';
  end if;
end
$approved_commit_redacted_projection$;
reset role;

update projectceo_foundation.project_memberships
set role = 'architect'
where project_id = '41111111-1111-4111-8111-111111111111'
  and user_id = '32222222-2222-4222-8222-222222222222';

select 'DB4_M2_APPROVED_COMMIT_OK' as result;
