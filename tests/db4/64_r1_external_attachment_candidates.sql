\set ON_ERROR_STOP on

-- Run after DB4's actual native M2 review/handoff and M3 sheet workflows.
-- External bytes are synthetic fixtures. No fake native handoff is inserted.
begin;

-- The disposable environment grants M3 before this file. Exercise the real
-- authoritative switch as well; the surrounding rollback restores its journal
-- and grants so the later platform-switch scenario retains its empty baseline.
select projectceo_platform.close_module_production(
  'm3','DB4 R1 candidate fixture','Verify candidate authoring closes with native M3'
);
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $candidate_closed_with_m3$
begin
  begin
    perform projectceo_product_api.attach_external_release_refs(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'cycle6-handoff','74000000-0000-4000-8000-000000000021','[]'::jsonb,
      1,'r1-closed-m3-candidate'
    );
    raise exception 'R1_CANDIDATE_REACHABLE_WITH_CLOSED_M3';
  exception when insufficient_privilege then null; end;
end
$candidate_closed_with_m3$;
reset role;
select projectceo_platform.open_module_production(
  'm3','DB4 R1 candidate fixture','Verify candidate authoring opens with native M3'
);
do $candidate_open_with_m3$
begin
  if not projectceo_platform.is_module_open('m3')
    or not has_function_privilege('authenticated',
      'projectceo_product_api.attach_external_release_refs(uuid,uuid,text,text,jsonb,bigint,text)',
      'EXECUTE') then
    raise exception 'R1_CANDIDATE_NOT_GRANTED_WITH_OPEN_M3';
  end if;
end
$candidate_open_with_m3$;

create temporary table r1_candidate_test (
  initial_state bigint,
  result jsonb,
  reversed_result jsonb,
  refs jsonb,
  initial_versions bigint,
  initial_approvals bigint
);
grant all on r1_candidate_test to authenticated;
insert into r1_candidate_test
select state_revision, null, null,
  '[{"kind":"asset_version","assetVersionId":"ed222222-2222-4222-8222-222222222222"},
    {"kind":"documentation_sheet_revision","sheetId":"m3-sheet-a101","sheetRevisionId":"75000000-0000-4000-8000-000000000002"}]'::jsonb,
  (select count(*) from projectceo_product.production_package_versions),
  (select count(*) from projectceo_platform.approval_requests)
from project_intelligence.project_workflows where project_id = '41111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.external_assets (
  organization_id, project_id, package_id, asset_id, source_kind, created_by_user_id
) select organization_id, project_id, project_id, 'ed111111-1111-4111-8111-111111111111', 'pdf',
  '31111111-1111-4111-8111-111111111111'
from project_intelligence.project_workflows where project_id = '41111111-1111-4111-8111-111111111111';
insert into projectceo_foundation.external_asset_versions (
  organization_id, project_id, package_id, asset_id, asset_version_id, revision_no,
  server_sha256, byte_length, validated_format, private_storage_locator,
  origin_intake_generation, created_by_user_id
) select organization_id, project_id, project_id, 'ed111111-1111-4111-8111-111111111111',
  'ed222222-2222-4222-8222-222222222222', 1, decode(repeat('a',64),'hex'), 100,
  'pdf', 'private/synthetic-only', 'synthetic-generation', '31111111-1111-4111-8111-111111111111'
from project_intelligence.project_workflows where project_id = '41111111-1111-4111-8111-111111111111';

-- Existing DB4 identities can hold explicit capabilities beyond their role.
-- Remove only the tested capability, then restore it before the positive path.
savepoint r1_without_authoring_capability;
delete from projectceo_foundation.project_member_capabilities
where project_id = '41111111-1111-4111-8111-111111111111'
  and user_id = '32222222-2222-4222-8222-222222222222' and capability = 'prepare_client_handoff';
delete from projectceo_foundation.package_member_capabilities
where project_id = '41111111-1111-4111-8111-111111111111'
  and package_id = '41111111-1111-4111-8111-111111111111'
  and user_id = '32222222-2222-4222-8222-222222222222' and capability = 'prepare_client_handoff';
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $open_module_does_not_grant_authoring_capability$
declare t record; v_detail text;
begin
  select * into strict t from r1_candidate_test;
  begin
    perform projectceo_product_api.attach_external_release_refs(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'cycle6-handoff','74000000-0000-4000-8000-000000000021',t.refs,t.initial_state,
      'r1-client-cannot-compose-candidate'
    );
    raise exception 'R1_M3_OPEN_GRANTED_CLIENT_AUTHORING';
  exception when sqlstate 'P1103' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm is distinct from 'forbidden'
      or v_detail::jsonb is distinct from '{"reason":"PACKAGE_CAPABILITY_REQUIRED"}'::jsonb then raise; end if;
  end;
end
$open_module_does_not_grant_authoring_capability$;
reset role;
rollback to savepoint r1_without_authoring_capability;
release savepoint r1_without_authoring_capability;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
update r1_candidate_test set result = projectceo_product_api.attach_external_release_refs(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'cycle6-handoff','74000000-0000-4000-8000-000000000021',refs,initial_state,'r1-candidate-test'
);
do $replay$
declare t record; replay jsonb;
begin
  select * into t from r1_candidate_test;
  replay := projectceo_product_api.attach_external_release_refs(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
    'cycle6-handoff','74000000-0000-4000-8000-000000000021',t.refs,t.initial_state,'r1-candidate-test'
  );
  if replay->>'replay' is distinct from 'true' or replay->'result' is distinct from t.result->'result' then
    raise exception 'R1_CANDIDATE_REPLAY_CHANGED';
  end if;
end
$replay$;

do $negatives$
declare t record;
begin
  select * into t from r1_candidate_test;
  begin
    perform projectceo_product_api.attach_external_release_refs(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'cycle6-handoff','74000000-0000-4000-8000-000000000021',t.refs,t.initial_state,'r1-stale-candidate'
    );
    raise exception 'R1_CANDIDATE_STALE_ALLOWED';
  exception when sqlstate 'P1107' then null; end;
  begin
    perform projectceo_product_api.attach_external_release_refs(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'cycle6-handoff','74000000-0000-4000-8000-000000000021',t.refs || t.refs,t.initial_state+1,'r1-duplicate-candidate'
    );
    raise exception 'R1_CANDIDATE_DUPLICATE_ALLOWED';
  exception when sqlstate 'P1111' then null; end;
  begin
    perform projectceo_product_api.attach_external_release_refs(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'missing-handoff','missing-revision',t.refs,t.initial_state+1,'r1-no-native-handoff'
    );
    raise exception 'R1_CANDIDATE_FAKE_HANDOFF_ALLOWED';
  exception when sqlstate 'P1111' then null; end;
  begin
    perform projectceo_product_api.attach_external_release_refs(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'cycle6-handoff','74000000-0000-4000-8000-000000000021',
      '[{"kind":"asset_version","assetVersionId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}]',t.initial_state+1,'r1-missing-asset'
    );
    raise exception 'R1_CANDIDATE_MISSING_ASSET_ALLOWED';
  exception when sqlstate 'P1104' then null; end;
  begin
    perform projectceo_product_api.attach_external_release_refs(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'cycle6-handoff','74000000-0000-4000-8000-000000000021',t.refs || t.refs,t.initial_state,'r1-candidate-test'
    );
    raise exception 'R1_CANDIDATE_IDEMPOTENCY_CONFLICT_ALLOWED';
  exception when sqlstate 'P1108' then null; end;
end
$negatives$;

update r1_candidate_test set reversed_result = projectceo_product_api.attach_external_release_refs(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'cycle6-handoff','74000000-0000-4000-8000-000000000021',jsonb_build_array(refs->1,refs->0),initial_state+1,'r1-reordered-candidate'
);
reset role;

do $persisted_candidate$
declare t record; s projectceo_foundation.external_release_attachment_submissions; n integer;
begin
  select * into t from r1_candidate_test;
  select * into s from projectceo_foundation.external_release_attachment_submissions
  where external_attachment_submission_id = (t.result#>>'{result,submissionId}')::uuid;
  if s.external_attachment_submission_id is null or t.result#>>'{result,status}' is distinct from 'candidate'
    or t.result#>>'{result,subjectDigest}' is distinct from t.reversed_result#>>'{result,subjectDigest}'
    or s.semantic_digest is distinct from project_intelligence._sha256_jsonb(s.semantic_content)
    or s.review_subject_digest is distinct from s.semantic_digest
    or s.semantic_content ?| array['approved','approval','decision','selfDigest','signedUrl','storagePath'] then
    raise exception 'R1_CANDIDATE_DIGEST_OR_STATUS_INVALID';
  end if;
  select count(*) into n from projectceo_foundation.external_release_attachment_submission_refs
  where external_attachment_submission_id = s.external_attachment_submission_id;
  if n <> 2 then raise exception 'R1_CANDIDATE_REFS_MISSING'; end if;
  if (select count(*) from projectceo_product.production_package_versions) <> t.initial_versions
    or (select count(*) from projectceo_platform.approval_requests) <> t.initial_approvals then
    raise exception 'R1_CANDIDATE_MINTED_RELEASE_OR_APPROVAL';
  end if;
  begin
    update projectceo_foundation.external_release_attachment_submissions set handoff_id = 'changed'
    where external_attachment_submission_id = s.external_attachment_submission_id;
    raise exception 'R1_CANDIDATE_MUTATION_ALLOWED';
  exception when sqlstate '55000' then null; end;
  if has_table_privilege('authenticated','projectceo_foundation.external_release_attachment_submissions','SELECT')
    or has_function_privilege('service_role','projectceo_product_api.attach_external_release_refs(uuid,uuid,text,text,jsonb,bigint,text)','EXECUTE') then
    raise exception 'R1_CANDIDATE_RUNTIME_PRIVILEGE_BROKEN';
  end if;
end
$persisted_candidate$;

-- Structural commit-boundary tests only. No 0.2 publisher is claimed by these
-- fixtures: existing native release rows remain byte-for-byte unchanged.
do $freeze_boundary$
declare
  s projectceo_foundation.external_release_attachment_submissions;
  v projectceo_product.production_package_versions;
  candidate_content jsonb;
begin
  select * into s from projectceo_foundation.external_release_attachment_submissions
  order by created_at, external_attachment_submission_id limit 1;
  select * into v from projectceo_product.production_package_versions
  where organization_id = s.organization_id and project_id = s.project_id and package_id = s.package_id
  order by version_no desc limit 1;
  if v.production_package_version_id is null then raise exception 'R1_NATIVE_RELEASE_FIXTURE_REQUIRED'; end if;
  begin
    insert into projectceo_foundation.external_release_attachment_manifests (
      organization_id,project_id,package_id,external_attachment_submission_id,
      production_package_version_id,handoff_id,handoff_revision_id,approved_snapshot_digest,
      schema_version,semantic_content,semantic_digest,frozen_by_user_id
    ) values (
      s.organization_id,s.project_id,s.package_id,s.external_attachment_submission_id,
      v.production_package_version_id,s.handoff_id,s.handoff_revision_id,s.review_subject_digest,
      s.schema_version,s.semantic_content,s.semantic_digest,s.created_by_user_id
    );
    raise exception 'R1_EXISTING_RELEASE_ACCEPTED_POSTHOC_SIDECAR';
  exception when others then
    if sqlerrm <> 'R1_EXTERNAL_MANIFEST_DIGEST_MISMATCH' then raise; end if;
  end;
  candidate_content := v.semantic_content || jsonb_build_object(
    'schemaVersion','project-ceo-production-package/0.2',
    'previousVersionId',v.production_package_version_id,
    'externalAttachmentManifestDigest','sha256:' || encode(s.semantic_digest,'hex')
  );
  begin
    insert into projectceo_product.production_package_versions (
      organization_id,project_id,production_package_version_id,package_id,baseline_id,
      version_no,previous_version_id,semantic_content,semantic_digest,published_by_user_id
    ) values (
      v.organization_id,v.project_id,'synthetic-r1-atomic-negative',v.package_id,v.baseline_id,
      v.version_no+1,v.production_package_version_id,candidate_content,
      project_intelligence._sha256_jsonb(candidate_content),v.published_by_user_id
    );
    set constraints projectceo_product.production_package_versions_r1_manifest immediate;
    raise exception 'R1_EXTERNAL_RELEASE_WITHOUT_MANIFEST_ALLOWED';
  exception when others then
    if sqlerrm <> 'R1_EXTERNAL_MANIFEST_ATOMIC_BINDING_REQUIRED' then raise; end if;
  end;
end
$freeze_boundary$;

-- H1's indirect references must not cross into a different, valid native H2.
-- H2 reuses Cycle 6's actual client-reviewed commit through the public human
-- RPC. Only external bytes/object/technical mapping below are synthetic.
create temporary table r1_handoff_test (
  state_revision bigint,
  approved_commit_id text,
  approved_commit_revision_id text,
  annotation_result jsonb,
  refs jsonb,
  initial_submissions bigint,
  initial_commands bigint,
  initial_audits bigint
);
grant all on r1_handoff_test to authenticated;
insert into r1_handoff_test (state_revision, approved_commit_id, approved_commit_revision_id)
select workflow.state_revision, handoff.payload->>'approvedCommitId',
  handoff.payload->>'approvedCommitRevisionId'
from project_intelligence.project_workflows workflow
join projectceo_product.m2_workspace_revisions handoff
  on handoff.organization_id = workflow.organization_id and handoff.project_id = workflow.project_id
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
  and handoff.entity_kind = 'm2_m3_handoff' and handoff.entity_id = 'cycle6-handoff'
  and handoff.revision_id = '74000000-0000-4000-8000-000000000021';

do $indirect_external_fixtures$
declare
  v_org uuid;
  v_project uuid := '41111111-1111-4111-8111-111111111111';
  v_owner uuid := '31111111-1111-4111-8111-111111111111';
begin
  select organization_id into strict v_org from project_intelligence.project_workflows
  where project_id = v_project;
  insert into projectceo_foundation.external_assets (
    organization_id, project_id, package_id, asset_id, source_kind, created_by_user_id
  ) values (v_org, v_project, v_project, 'ec111111-1111-4111-8111-111111111111', 'dwg', v_owner);
  insert into projectceo_foundation.external_asset_versions (
    organization_id, project_id, package_id, asset_id, asset_version_id, revision_no,
    server_sha256, byte_length, validated_format, private_storage_locator,
    origin_intake_generation, created_by_user_id
  ) values (v_org, v_project, v_project, 'ec111111-1111-4111-8111-111111111111',
    'ec222222-2222-4222-8222-222222222222', 1, decode(repeat('b',64),'hex'), 1024,
    'dwg', 'private/synthetic-handoff-source', 'synthetic-generation', v_owner);
  insert into projectceo_foundation.external_representation_versions (
    organization_id, project_id, package_id, asset_version_id, representation_version_id,
    server_sha256, byte_length, validated_format, private_storage_locator,
    producer_kind, producer_version, units, axes, transform, manifest_schema_version,
    provenance, resource_manifest, created_by_user_id
  ) values (v_org, v_project, v_project, 'ec222222-2222-4222-8222-222222222222',
    'ec333333-3333-4333-8333-333333333333', decode(repeat('c',64),'hex'), 2048,
    'svg', 'private/synthetic-handoff-preview', 'fixture', '1', 'mm', 'z-up',
    '{"matrix":[1,0,0,1,0,0]}', 'r1/0.1', '{}', '{}', v_owner);
  insert into projectceo_foundation.external_representation_attestations (
    organization_id, project_id, package_id, asset_version_id, representation_version_id,
    source_sha256, representation_sha256, confirmed_units, confirmed_axes,
    architect_user_id, causation_id, request_id
  ) values (v_org, v_project, v_project, 'ec222222-2222-4222-8222-222222222222',
    'ec333333-3333-4333-8333-333333333333', decode(repeat('b',64),'hex'),
    decode(repeat('c',64),'hex'), 'mm', 'z-up', v_owner, 'r1-indirect', 'r1-indirect-attestation');
  insert into projectceo_foundation.project_objects (
    organization_id, project_id, package_id, object_id, object_key, object_kind,
    room_entity_id, protected_name, identification_origin, created_by_user_id
  ) values (v_org, v_project, v_project, 'ec444444-4444-4444-8444-444444444444',
    'r1-indirect-object', 'fixed_element', 'db4-room', 'Synthetic handoff object', 'dwg', v_owner);
  insert into projectceo_foundation.project_object_revisions (
    organization_id, project_id, package_id, object_id, object_revision_id, revision_no,
    room_entity_id, room_revision_id, semantic_payload, created_by_user_id
  ) values (v_org, v_project, v_project, 'ec444444-4444-4444-8444-444444444444',
    'ec555555-5555-4555-8555-555555555555', 1, 'db4-room', 'db4-room-r1', '{}', v_owner);
  insert into projectceo_foundation.technical_reference_versions (
    organization_id, project_id, package_id, technical_reference_id, technical_reference_revision_id,
    revision_no, status, object_revision_id, sheet_id, sheet_revision_id,
    reference_asset_version_id, preview_representation_version_id, preview_sha256,
    view_kind, coordinate_space, x_min, y_min, x_max, y_max, view_transform,
    mapping_method, mapping_evidence, created_by_user_id, confirmed_by_user_id, confirmed_at,
    causation_id, request_id
  ) values (v_org, v_project, v_project, 'ec666666-6666-4666-8666-666666666666',
    'ec777777-7777-4777-8777-777777777777', 1, 'confirmed', 'ec555555-5555-4555-8555-555555555555',
    'm3-sheet-a101', '75000000-0000-4000-8000-000000000002',
    'ec222222-2222-4222-8222-222222222222', 'ec333333-3333-4333-8333-333333333333',
    decode(repeat('c',64),'hex'), 'detail', 'sheet_mm', 0, 0, 10, 10,
    '{"matrix":[1,0,0,1,0,0]}', 'fixture', '{}', v_owner, v_owner, statement_timestamp(),
    'r1-indirect', 'r1-indirect-technical');
  insert into projectceo_foundation.technical_reference_events (
    organization_id, project_id, package_id, technical_reference_revision_id, sequence_no,
    event_type, actor_type, actor_id, actor_user_id, causation_id, request_id
  ) values (v_org, v_project, v_project, 'ec777777-7777-4777-8777-777777777777', 1,
    'confirmed', 'human', v_owner::text, v_owner, 'r1-indirect', 'r1-indirect-technical-event');
  set constraints all immediate;
end
$indirect_external_fixtures$;

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
update r1_handoff_test set state_revision = (projectceo_product_api.publish_m2_m3_handoff(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'r1-candidate-handoff-h2','ec888888-8888-4888-8888-888888888888',null,
  approved_commit_id,approved_commit_revision_id,'Second exact handoff for isolation regression',
  state_revision,'r1-indirect-native-h2'
)->>'stateRevision')::bigint;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
update r1_handoff_test set annotation_result = projectceo_product_api.create_external_annotation(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'ec333333-3333-4333-8333-333333333333','ec555555-5555-4555-8555-555555555555',
  'ec777777-7777-4777-8777-777777777777','point',null,'{"x":1,"y":2}',null,
  'Synthetic annotation bound to H1 technical reference',state_revision,'r1-indirect-annotation'
);
update r1_handoff_test set state_revision = (annotation_result->>'stateRevision')::bigint,
  refs = jsonb_build_array(
    jsonb_build_object('kind','technical_reference_revision',
      'technicalReferenceRevisionId','ec777777-7777-4777-8777-777777777777'),
    jsonb_build_object('kind','annotation_revision',
      'annotationRevisionId',annotation_result#>>'{result,annotationRevisionId}')
  );
reset role;

do $native_h2_provenance$
declare v_handoff projectceo_product.m2_workspace_revisions;
begin
  select handoff.* into strict v_handoff
  from project_intelligence.project_workflows workflow
  cross join lateral projectceo_m3._require_published_handoff(
    workflow.organization_id, workflow.project_id, workflow.project_id,
    'r1-candidate-handoff-h2','ec888888-8888-4888-8888-888888888888') handoff
  where workflow.project_id = '41111111-1111-4111-8111-111111111111';
  if v_handoff.payload->'selectionRevisionIds' is distinct from '["revision-selection-db4-r1"]'::jsonb
    or not exists (
      select 1 from projectceo_product.command_records command
      join projectceo_product.audit_events event on event.command_id = command.command_id
        and event.organization_id = command.organization_id and event.project_id = command.project_id
      where command.project_id = v_handoff.project_id and command.operation = 'publish_m2_m3_handoff'
        and command.logical_result->>'revisionId' = v_handoff.revision_id
        and command.actor_user_id = '31111111-1111-4111-8111-111111111111'
        and event.event_type = 'm2_m3_handoff_published'
    ) then raise exception 'R1_SECOND_NATIVE_HANDOFF_NOT_PROVEN'; end if;
end
$native_h2_provenance$;

update r1_handoff_test set
  initial_submissions = (select count(*) from projectceo_foundation.external_release_attachment_submissions),
  initial_commands = (select count(*) from projectceo_product.command_records),
  initial_audits = (select count(*) from projectceo_product.audit_events);
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $indirect_handoff_negatives$
declare t record; v_ref jsonb; v_result jsonb; v_detail text; v_rejections integer := 0;
begin
  select * into strict t from r1_handoff_test;
  -- H2 is accepted by this very command with a handoff-independent asset.
  v_result := projectceo_product_api.attach_external_release_refs(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
    'r1-candidate-handoff-h2','ec888888-8888-4888-8888-888888888888',
    '[{"kind":"asset_version","assetVersionId":"ed222222-2222-4222-8222-222222222222"}]',
    t.state_revision,'r1-indirect-h2-control');
  if v_result#>>'{result,status}' is distinct from 'candidate' then
    raise exception 'R1_SECOND_HANDOFF_CANDIDATE_CONTROL_FAILED';
  end if;
  t.state_revision := (v_result->>'stateRevision')::bigint;
  for v_ref in select value from jsonb_array_elements(t.refs) loop
    -- Each indirect reference is valid for H1 before H2 must reject it.
    v_result := projectceo_product_api.attach_external_release_refs(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'cycle6-handoff','74000000-0000-4000-8000-000000000021',jsonb_build_array(v_ref),
      t.state_revision,'r1-indirect-h1-' || (v_ref->>'kind'));
    if v_result#>>'{result,status}' is distinct from 'candidate'
      or v_result#>>'{result,refCount}' is distinct from '1' then
      raise exception 'R1_INDIRECT_H1_CONTROL_FAILED_%', v_ref->>'kind';
    end if;
    t.state_revision := (v_result->>'stateRevision')::bigint;
    begin
      perform projectceo_product_api.attach_external_release_refs(
        '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
        'r1-candidate-handoff-h2','ec888888-8888-4888-8888-888888888888',jsonb_build_array(v_ref),
        t.state_revision,'r1-indirect-h2-' || (v_ref->>'kind'));
      raise exception 'R1_INDIRECT_CROSS_HANDOFF_ALLOWED_%', v_ref->>'kind';
    exception when sqlstate 'P1109' then
      get stacked diagnostics v_detail = pg_exception_detail;
      if sqlerrm is distinct from 'scope_conflict'
        or v_detail::jsonb is distinct from '{"reason":"SHEET_HANDOFF_MISMATCH"}'::jsonb then raise; end if;
      v_rejections := v_rejections + 1;
    end;
  end loop;
  if v_rejections <> 2 then raise exception 'R1_INDIRECT_HANDOFF_NEGATIVES_INCOMPLETE'; end if;
  update r1_handoff_test set state_revision = t.state_revision;
end
$indirect_handoff_negatives$;
reset role;

do $indirect_no_side_effects$
declare t record;
begin
  select * into strict t from r1_handoff_test;
  if (select state_revision from project_intelligence.project_workflows
      where project_id = '41111111-1111-4111-8111-111111111111') is distinct from t.state_revision
    or (select count(*) from projectceo_foundation.external_release_attachment_submissions) <> t.initial_submissions + 3
    or (select count(*) from projectceo_product.command_records) <> t.initial_commands + 3
    or (select count(*) from projectceo_product.audit_events) <> t.initial_audits + 3
    or (select count(*) from projectceo_product.production_package_versions)
      <> (select initial_versions from r1_candidate_test)
    or (select count(*) from projectceo_platform.approval_requests)
      <> (select initial_approvals from r1_candidate_test) then
    raise exception 'R1_INDIRECT_HANDOFF_UNEXPECTED_SIDE_EFFECTS';
  end if;
end
$indirect_no_side_effects$;

-- Native IDs allow 160 characters each. JSON escapes control characters to
-- six characters, so the collision-free tuple identity can exceed 420 even
-- though both IDs satisfy the native sheet authoring contract.
create temporary table r1_escaped_ids_test (
  state_revision bigint,
  sheet_id text,
  sheet_revision_id text,
  attach_result jsonb
);
grant all on r1_escaped_ids_test to authenticated;
insert into r1_escaped_ids_test
select state_revision, repeat(chr(1),160), repeat(chr(2),160), null
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111';
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
update r1_escaped_ids_test set state_revision = (projectceo_m3_api.register_documentation_sheet(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'cycle6-handoff','74000000-0000-4000-8000-000000000021',sheet_id,
  'R1-ESC-160','Escaped native ID boundary',sheet_revision_id,
  array['revision-selection-db4-r1']::text[],'Native sheet with maximum JSON escaping',
  state_revision,'r1-escaped-native-sheet'
)->>'stateRevision')::bigint;
update r1_escaped_ids_test set attach_result = projectceo_product_api.attach_external_release_refs(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'cycle6-handoff','74000000-0000-4000-8000-000000000021',
  jsonb_build_array(jsonb_build_object('kind','documentation_sheet_revision',
    'sheetId',sheet_id,'sheetRevisionId',sheet_revision_id)),
  state_revision,'r1-escaped-native-sheet-candidate'
);
reset role;

do $escaped_identity_persisted$
declare t record; r projectceo_foundation.external_release_attachment_submission_refs;
begin
  select * into strict t from r1_escaped_ids_test;
  select * into strict r from projectceo_foundation.external_release_attachment_submission_refs
  where external_attachment_submission_id = (t.attach_result#>>'{result,submissionId}')::uuid;
  if char_length(t.sheet_id) <> 160 or char_length(t.sheet_revision_id) <> 160
    or char_length(r.ref_identity) <> 1957
    or r.ref_identity is distinct from
      'documentation_sheet_revision:' || jsonb_build_array(t.sheet_id,t.sheet_revision_id)::text
    or r.sheet_id is distinct from t.sheet_id or r.sheet_revision_id is distinct from t.sheet_revision_id
    or r.semantic_digest is distinct from project_intelligence._sha256_jsonb(r.semantic_content)
    or t.attach_result#>>'{result,status}' is distinct from 'candidate'
    or t.attach_result#>>'{result,refCount}' is distinct from '1' then
    raise exception 'R1_ESCAPED_SHEET_IDENTITY_NOT_PERSISTED';
  end if;
end
$escaped_identity_persisted$;

rollback;
select 'DB4_R1_EXTERNAL_ATTACHMENT_CANDIDATES_OK' as result;
