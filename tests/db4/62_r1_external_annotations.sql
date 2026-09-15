\set ON_ERROR_STOP on

begin;

do $r1_external_annotations$
declare
  v_organization_id uuid;
  v_project_id uuid := '41111111-1111-4111-8111-111111111111';
  v_package_id uuid := '41111111-1111-4111-8111-111111111111';
  v_owner_id uuid := '31111111-1111-4111-8111-111111111111';
  v_client_id uuid := '32222222-2222-4222-8222-222222222222';
  v_asset_id uuid := 'c1111111-1111-4111-8111-111111111111';
  v_asset_version_id uuid := 'c2222222-2222-4222-8222-222222222222';
  v_representation_version_id uuid := 'c3333333-3333-4333-8333-333333333333';
  v_wrong_representation_version_id uuid := 'c4444444-4444-4444-8444-444444444444';
  v_object_id uuid := 'c5555555-5555-4555-8555-555555555555';
  v_object_revision_id uuid := 'c6666666-6666-4666-8666-666666666666';
  v_other_object_id uuid := 'c6767676-6767-4676-8676-676767676767';
  v_other_object_revision_id uuid := 'c6868686-6868-4686-8686-686868686868';
  v_technical_reference_id uuid := 'c7777777-7777-4777-8777-777777777777';
  v_technical_reference_revision_id uuid := 'c8888888-8888-4888-8888-888888888888';
begin
  select organization_id into v_organization_id
  from project_intelligence.project_workflows where project_id = v_project_id;

  insert into project_intelligence.organization_members (organization_id, user_id, role, status)
  values (v_organization_id, v_client_id, 'member', 'active') on conflict do nothing;
  insert into projectceo_foundation.project_memberships (organization_id, project_id, user_id, role, status)
  values (v_organization_id, v_project_id, v_client_id, 'client_approver', 'active') on conflict do nothing;
  insert into projectceo_foundation.package_memberships (organization_id, project_id, package_id, user_id, role, status)
  values (v_organization_id, v_project_id, v_package_id, v_client_id, 'client_approver', 'active') on conflict do nothing;
  insert into projectceo_foundation.package_member_capabilities (organization_id, project_id, package_id, user_id, capability)
  values (v_organization_id, v_project_id, v_package_id, v_client_id, 'review_selection') on conflict do nothing;

  insert into projectceo_foundation.external_assets (organization_id, project_id, package_id, asset_id, source_kind, created_by_user_id)
  values (v_organization_id, v_project_id, v_package_id, v_asset_id, 'dwg', v_owner_id);
  insert into projectceo_foundation.external_asset_versions (organization_id, project_id, package_id, asset_id, asset_version_id, revision_no, server_sha256, byte_length, validated_format, private_storage_locator, origin_intake_generation, created_by_user_id)
  values (v_organization_id, v_project_id, v_package_id, v_asset_id, v_asset_version_id, 1, decode(repeat('a',64),'hex'), 1, 'dwg', 'r1/private/annotation-source', 'r1-annotation-fixture', v_owner_id);
  insert into projectceo_foundation.external_representation_versions (organization_id, project_id, package_id, asset_version_id, representation_version_id, server_sha256, byte_length, validated_format, private_storage_locator, producer_kind, producer_version, units, axes, transform, manifest_schema_version, provenance, resource_manifest, created_by_user_id)
  values (v_organization_id, v_project_id, v_package_id, v_asset_version_id, v_representation_version_id, decode(repeat('b',64),'hex'), 1, 'svg', 'r1/private/annotation-preview', 'fixture', '1', 'mm', 'z-up', '{}'::jsonb, 'r1/0.1', '{}'::jsonb, '{}'::jsonb, v_owner_id);
  insert into projectceo_foundation.external_representation_versions (organization_id, project_id, package_id, asset_version_id, representation_version_id, server_sha256, byte_length, validated_format, private_storage_locator, producer_kind, producer_version, units, axes, transform, manifest_schema_version, provenance, resource_manifest, created_by_user_id)
  values (v_organization_id, v_project_id, v_package_id, v_asset_version_id, v_wrong_representation_version_id, decode(repeat('c',64),'hex'), 1, 'svg', 'r1/private/annotation-preview-wrong', 'fixture', '1', 'mm', 'z-up', '{}'::jsonb, 'r1/0.1', '{}'::jsonb, '{}'::jsonb, v_owner_id);

  insert into projectceo_product.m2_workspace_revisions (organization_id, project_id, package_id, entity_kind, entity_id, revision_id, revision_no, status, payload, reason, reason_digest, created_by_user_id)
  values (v_organization_id, v_project_id, v_package_id, 'room', 'r1-annotation-room', 'r1-annotation-room-r1', 1, 'approved', '{}'::jsonb, 'R1 annotation fixture', decode(repeat('d',64),'hex'), v_owner_id);
  insert into projectceo_foundation.project_objects (organization_id, project_id, package_id, object_id, object_key, object_kind, room_entity_id, protected_name, identification_origin, created_by_user_id)
  values (v_organization_id, v_project_id, v_package_id, v_object_id, 'annotation-object', 'fixed_element', 'r1-annotation-room', 'Annotation object', 'dwg', v_owner_id);
  insert into projectceo_foundation.project_object_revisions (organization_id, project_id, package_id, object_id, object_revision_id, revision_no, room_entity_id, room_revision_id, semantic_payload, explicit_unknowns, created_by_user_id)
  values (v_organization_id, v_project_id, v_package_id, v_object_id, v_object_revision_id, 1, 'r1-annotation-room', 'r1-annotation-room-r1', '{}'::jsonb, '[]'::jsonb, v_owner_id);
  insert into projectceo_foundation.project_objects (organization_id, project_id, package_id, object_id, object_key, object_kind, room_entity_id, protected_name, identification_origin, created_by_user_id)
  values (v_organization_id, v_project_id, v_package_id, v_other_object_id, 'annotation-other-object', 'fixed_element', 'r1-annotation-room', 'Other annotation object', 'dwg', v_owner_id);
  insert into projectceo_foundation.project_object_revisions (organization_id, project_id, package_id, object_id, object_revision_id, revision_no, room_entity_id, room_revision_id, semantic_payload, explicit_unknowns, created_by_user_id)
  values (v_organization_id, v_project_id, v_package_id, v_other_object_id, v_other_object_revision_id, 1, 'r1-annotation-room', 'r1-annotation-room-r1', '{}'::jsonb, '[]'::jsonb, v_owner_id);
  insert into projectceo_m3.documentation_sheet_revisions (organization_id, project_id, package_id, sheet_id, revision_id, revision_no, room_id, sheet_number, title, handoff_id, handoff_revision_id, handoff_contract_version, approved_m2_commit_revision_id, design_intent_revision_id, layout_document_id, layout_version_id, layout_revision_id, semantic_hash, specification_revision_ids, payload, reason, reason_digest, created_by_user_id)
  values (v_organization_id, v_project_id, v_package_id, 'r1-annotation-sheet', 'r1-annotation-sheet-r1', 1, 'r1-annotation-room', 'ANN-001', 'Annotation sheet', 'handoff', 'handoff-r1', 'r1/0.1', 'approved', 'design', 'layout', 'layout-version', 'layout-revision', 'sha256:' || repeat('e',64), array[]::text[], '{}'::jsonb, 'R1 annotation fixture', decode(repeat('e',64),'hex'), v_owner_id);
  insert into projectceo_foundation.technical_reference_versions (organization_id, project_id, package_id, technical_reference_id, technical_reference_revision_id, revision_no, status, object_revision_id, sheet_id, sheet_revision_id, reference_asset_version_id, preview_representation_version_id, preview_sha256, view_kind, coordinate_space, x_min, y_min, x_max, y_max, view_transform, mapping_method, mapping_evidence, created_by_user_id, confirmed_by_user_id, confirmed_at, causation_id, request_id)
  values (v_organization_id, v_project_id, v_package_id, v_technical_reference_id, v_technical_reference_revision_id, 1, 'confirmed', v_object_revision_id, 'r1-annotation-sheet', 'r1-annotation-sheet-r1', v_asset_version_id, v_representation_version_id, decode(repeat('b',64),'hex'), 'detail', 'sheet_mm', 0, 0, 10, 10, '{"matrix":[1,0,0,1,0,0]}'::jsonb, 'fixture', '{}'::jsonb, v_owner_id, v_owner_id, statement_timestamp(), 'fixture', 'fixture-reference');
  insert into projectceo_foundation.technical_reference_events (organization_id, project_id, package_id, technical_reference_revision_id, sequence_no, event_type, actor_type, actor_id, actor_user_id, causation_id, request_id)
  values (v_organization_id, v_project_id, v_package_id, v_technical_reference_revision_id, 1, 'confirmed', 'human', v_owner_id::text, v_owner_id, 'fixture', 'fixture-reference-event');

  begin
    insert into projectceo_foundation.external_annotation_revisions (organization_id, project_id, package_id, annotation_id, revision_no, representation_version_id, representation_sha256, technical_reference_revision_id, anchor_kind, point, body, created_by_user_id, causation_id, request_id)
    values (v_organization_id, v_project_id, v_package_id, extensions.gen_random_uuid(), 1, v_wrong_representation_version_id, decode(repeat('c',64),'hex'), v_technical_reference_revision_id, 'point', '{"x":1}'::jsonb, 'wrong technical target', v_client_id, 'fixture', 'fixture-wrong-reference');
    raise exception 'DB4_R1_ANNOTATION_TECHNICAL_MISMATCH_ALLOWED';
  exception when others then
    if sqlerrm not like '%R1_ANNOTATION_TECHNICAL_REFERENCE_MISMATCH%' then raise; end if;
  end;
  begin
    insert into projectceo_foundation.external_annotation_revisions (organization_id, project_id, package_id, annotation_id, revision_no, representation_version_id, representation_sha256, object_revision_id, technical_reference_revision_id, anchor_kind, point, body, created_by_user_id, causation_id, request_id)
    values (v_organization_id, v_project_id, v_package_id, extensions.gen_random_uuid(), 1, v_representation_version_id, decode(repeat('b',64),'hex'), v_other_object_revision_id, v_technical_reference_revision_id, 'point', '{"x":1}'::jsonb, 'wrong technical object', v_client_id, 'fixture', 'fixture-wrong-object');
    raise exception 'DB4_R1_ANNOTATION_TECHNICAL_OBJECT_MISMATCH_ALLOWED';
  exception when others then
    if sqlerrm not like '%R1_ANNOTATION_TECHNICAL_REFERENCE_MISMATCH%' then raise; end if;
  end;

end
$r1_external_annotations$;

create temporary table r1_annotation_results (
  expected_state_revision bigint not null,
  first_result jsonb,
  replay_result jsonb,
  revised_result jsonb
);
grant all on r1_annotation_results to authenticated;
insert into r1_annotation_results (expected_state_revision)
select state_revision from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111';

set local role authenticated;
select set_config('request.jwt.claim.sub', '32222222-2222-4222-8222-222222222222', true);
update r1_annotation_results
set first_result = projectceo_product_api.create_external_annotation(
  '41111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111',
  'c3333333-3333-4333-8333-333333333333', 'c6666666-6666-4666-8666-666666666666', 'c8888888-8888-4888-8888-888888888888', 'point', null,
  '{"x":1,"y":2}'::jsonb, null, 'Client review note', expected_state_revision, 'r1-annotation-key'
);
update r1_annotation_results
set replay_result = projectceo_product_api.create_external_annotation(
  '41111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111',
  'c3333333-3333-4333-8333-333333333333', 'c6666666-6666-4666-8666-666666666666', 'c8888888-8888-4888-8888-888888888888', 'point', null,
  '{"x":1,"y":2}'::jsonb, null, 'Client review note', expected_state_revision, 'r1-annotation-key'
);
update r1_annotation_results
set revised_result = projectceo_product_api.revise_external_annotation(
  '41111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111',
  (first_result->'result'->>'annotationId')::uuid,
  (first_result->'result'->>'annotationRevisionId')::uuid,
  'region', null, null, '{"xMin":1,"yMin":1,"xMax":2,"yMax":2}'::jsonb,
  'Corrected client review note', (first_result->>'stateRevision')::bigint, 'r1-annotation-revise-key'
);
reset role;

do $r1_external_annotation_assertions$
declare
  v_first jsonb;
  v_replay jsonb;
  v_revised jsonb;
  v_annotation_revision_id uuid;
  v_state_revision bigint;
begin
  select first_result, replay_result, revised_result into v_first, v_replay, v_revised from r1_annotation_results;
  if coalesce((v_first->>'replay')::boolean, false) then raise exception 'DB4_R1_ANNOTATION_FIRST_REPLAY'; end if;
  if coalesce((v_replay->>'replay')::boolean, false) is not true then raise exception 'DB4_R1_ANNOTATION_REPLAY_MISSING'; end if;
  if coalesce((v_revised->>'replay')::boolean, false) then raise exception 'DB4_R1_ANNOTATION_REVISION_REPLAY'; end if;
  v_annotation_revision_id := (v_first->'result'->>'annotationRevisionId')::uuid;
  v_state_revision := (v_first->>'stateRevision')::bigint;
  if not exists (select 1 from projectceo_product.audit_events where event_type = 'external_annotation_created') then raise exception 'DB4_R1_ANNOTATION_AUDIT_MISSING'; end if;
  if not exists (select 1 from projectceo_product.audit_events where event_type = 'external_annotation_revised') then raise exception 'DB4_R1_ANNOTATION_REVISION_AUDIT_MISSING'; end if;
  if (select count(*) from projectceo_foundation.external_annotation_revisions where annotation_id = (v_first->'result'->>'annotationId')::uuid) <> 2 then raise exception 'DB4_R1_ANNOTATION_REVISION_LINEAGE_MISSING'; end if;
  begin update projectceo_foundation.external_annotation_revisions set body = 'changed' where annotation_revision_id = v_annotation_revision_id; raise exception 'DB4_R1_ANNOTATION_UPDATE_ALLOWED'; exception when sqlstate '55000' then null; end;
  begin delete from projectceo_foundation.external_annotation_revisions where annotation_revision_id = v_annotation_revision_id; raise exception 'DB4_R1_ANNOTATION_DELETE_ALLOWED'; exception when sqlstate '55000' then null; end;
  if has_table_privilege('authenticated', 'projectceo_foundation.external_annotation_revisions', 'select') then raise exception 'DB4_R1_ANNOTATION_TABLE_GRANT'; end if;
  perform set_config('r1.annotation.state_revision', v_state_revision::text, false);
end
$r1_external_annotation_assertions$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '31111111-1111-4111-8111-111111111111', true);
do $r1_annotation_owner_forbidden$
begin
  perform projectceo_product_api.create_external_annotation(
    '41111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111',
    'c3333333-3333-4333-8333-333333333333', null, null, 'point', null,
    '{"x":1}'::jsonb, null, 'Owner cannot impersonate client',
    current_setting('r1.annotation.state_revision')::bigint, 'r1-owner-forbidden'
  );
  raise exception 'DB4_R1_ANNOTATION_OWNER_ALLOWED';
exception when sqlstate 'P1103' then null;
end
$r1_annotation_owner_forbidden$;
reset role;

rollback;

select 'DB4_R1_EXTERNAL_ANNOTATIONS_OK' as result;
