\set ON_ERROR_STOP on

begin;

do $r1_external_release_resolver$
declare
  v_organization_id uuid;
  v_project_id uuid := '41111111-1111-4111-8111-111111111111';
  v_package_id uuid := '41111111-1111-4111-8111-111111111111';
  v_other_package_id uuid := '49999999-9999-4999-8999-999999999999';
  v_owner_id uuid := '31111111-1111-4111-8111-111111111111';
  v_asset_id uuid := 'd1111111-1111-4111-8111-111111111111';
  v_asset_version_id uuid := 'd2222222-2222-4222-8222-222222222222';
  v_representation_version_id uuid := 'd3333333-3333-4333-8333-333333333333';
  v_object_id uuid := 'd4444444-4444-4444-8444-444444444444';
  v_object_revision_id uuid := 'd5555555-5555-4555-8555-555555555555';
  v_binding_id uuid := 'd6666666-6666-4666-8666-666666666666';
  v_technical_reference_id uuid := 'd7777777-7777-4777-8777-777777777777';
  v_technical_reference_revision_id uuid := 'd8888888-8888-4888-8888-888888888888';
  v_annotation_id uuid := 'd9999999-9999-4999-8999-999999999999';
  v_annotation_revision_id uuid := 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_asset jsonb;
  v_representation jsonb;
  v_sheet jsonb;
  v_binding jsonb;
  v_technical jsonb;
  v_annotation jsonb;
begin
  select organization_id into v_organization_id
  from project_intelligence.project_workflows
  where project_id = v_project_id;
  if v_organization_id is null then
    raise exception 'DB4_R1_EXTERNAL_RELEASE_RESOLVER_ORGANIZATION_MISSING';
  end if;

  insert into projectceo_product.m2_workspace_revisions (
    organization_id, project_id, package_id, entity_kind, entity_id, revision_id,
    revision_no, supersedes_revision_id, status, payload, reason, reason_digest, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, 'room', 'r1-release-resolver-room', 'r1-release-resolver-room-r1',
    1, null, 'approved', '{}'::jsonb, 'R1 resolver fixture', decode(repeat('a', 64), 'hex'), v_owner_id
  );

  insert into projectceo_foundation.external_assets (
    organization_id, project_id, package_id, asset_id, source_kind, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_asset_id, 'dwg', v_owner_id
  );
  insert into projectceo_foundation.external_asset_versions (
    organization_id, project_id, package_id, asset_id, asset_version_id, revision_no,
    server_sha256, byte_length, validated_format, private_storage_locator,
    origin_intake_generation, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_asset_id, v_asset_version_id, 1,
    decode(repeat('a', 64), 'hex'), 1024, 'dwg', 'r1/private/release-resolver-source',
    'r1-release-resolver-intake', v_owner_id
  );
  insert into projectceo_foundation.external_representation_versions (
    organization_id, project_id, package_id, asset_version_id, representation_version_id,
    server_sha256, byte_length, validated_format, private_storage_locator,
    producer_kind, producer_version, units, axes, transform, manifest_schema_version,
    provenance, resource_manifest, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_asset_version_id, v_representation_version_id,
    decode(repeat('b', 64), 'hex'), 2048, 'svg', 'r1/private/release-resolver-preview',
    'fixture', '1', 'mm', 'z-up', '{"matrix":[1,0,0,1,0,0]}'::jsonb, 'r1/0.1',
    '{}'::jsonb, '{}'::jsonb, v_owner_id
  );
  insert into projectceo_foundation.external_representation_attestations (
    organization_id, project_id, package_id, asset_version_id, representation_version_id,
    source_sha256, representation_sha256, confirmed_units, confirmed_axes,
    architect_user_id, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_asset_version_id, v_representation_version_id,
    decode(repeat('a', 64), 'hex'), decode(repeat('b', 64), 'hex'), 'mm', 'z-up',
    v_owner_id, 'r1-release-resolver', 'r1-release-resolver-attestation'
  );

  insert into projectceo_m3.documentation_sheet_revisions (
    organization_id, project_id, package_id, sheet_id, revision_id, revision_no,
    supersedes_revision_id, room_id, sheet_number, title, handoff_id, handoff_revision_id,
    handoff_contract_version, approved_m2_commit_revision_id, design_intent_revision_id,
    layout_document_id, layout_version_id, layout_revision_id, semantic_hash,
    specification_revision_ids, payload, reason, reason_digest, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, 'r1-release-resolver-sheet', 'r1-release-resolver-sheet-r1', 1,
    null, 'r1-release-resolver-room', 'REL-001', 'R1 resolver sheet', 'r1-release-handoff', 'r1-release-handoff-r1',
    'archidom.m2-to-m3-handoff/0.1', 'r1-release-commit', 'r1-release-design',
    'r1-release-layout-document', 'r1-release-layout-version', 'r1-release-layout-revision',
    'sha256:' || repeat('c', 64), array['r1-spec-r1']::text[], '{"fixture":"release-resolver"}'::jsonb,
    'R1 resolver fixture', decode(repeat('d', 64), 'hex'), v_owner_id
  );

  insert into projectceo_foundation.external_representation_node_index (
    organization_id, project_id, package_id, representation_version_id, node_key,
    node_path, node_metadata, indexed_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_representation_version_id,
    'node:release:001', '/Root/Release/001', '{}'::jsonb, v_owner_id
  );
  insert into projectceo_foundation.project_objects (
    organization_id, project_id, package_id, object_id, object_key, object_kind,
    room_entity_id, protected_name, identification_origin, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_object_id, 'release-object', 'fixed_element',
    'r1-release-resolver-room', 'Resolver object', 'dwg', v_owner_id
  );
  insert into projectceo_foundation.project_object_revisions (
    organization_id, project_id, package_id, object_id, object_revision_id, revision_no,
    supersedes_object_revision_id, room_entity_id, room_revision_id, semantic_payload,
    explicit_unknowns, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_object_id, v_object_revision_id, 1,
    null, 'r1-release-resolver-room', 'r1-release-resolver-room-r1', '{}'::jsonb,
    '[]'::jsonb, v_owner_id
  );
  insert into projectceo_foundation.object_representation_bindings (
    organization_id, project_id, package_id, binding_id, object_revision_id, representation_version_id,
    node_key, node_path, mapping_transform, mapping_method, mapping_evidence,
    mapped_by_user_id, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_binding_id, v_object_revision_id, v_representation_version_id,
    'node:release:001', '/Root/Release/001', '{"matrix":[1,0,0,1,0,0]}'::jsonb, 'fixture', '{}'::jsonb,
    v_owner_id, 'r1-release-resolver', 'r1-release-resolver-binding'
  );

  insert into projectceo_foundation.technical_reference_versions (
    organization_id, project_id, package_id, technical_reference_id, technical_reference_revision_id,
    revision_no, supersedes_technical_reference_revision_id, status, object_revision_id,
    sheet_id, sheet_revision_id, reference_asset_version_id, preview_representation_version_id,
    preview_sha256, view_kind, coordinate_space, x_min, y_min, x_max, y_max,
    view_transform, mapping_method, mapping_evidence, created_by_user_id,
    confirmed_by_user_id, confirmed_at, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_technical_reference_id, v_technical_reference_revision_id,
    1, null, 'confirmed', v_object_revision_id, 'r1-release-resolver-sheet', 'r1-release-resolver-sheet-r1',
    v_asset_version_id, v_representation_version_id, decode(repeat('b', 64), 'hex'), 'detail', 'sheet_mm',
    0, 0, 10, 10, '{"matrix":[1,0,0,1,0,0]}'::jsonb, 'fixture', '{}'::jsonb, v_owner_id,
    v_owner_id, statement_timestamp(), 'r1-release-resolver', 'r1-release-resolver-technical'
  );
  insert into projectceo_foundation.technical_reference_events (
    organization_id, project_id, package_id, technical_reference_revision_id, sequence_no,
    event_type, actor_type, actor_id, actor_user_id, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_technical_reference_revision_id, 1,
    'confirmed', 'human', v_owner_id::text, v_owner_id, 'r1-release-resolver', 'r1-release-resolver-technical-event'
  );
  set constraints all immediate;

  insert into projectceo_foundation.external_annotation_revisions (
    organization_id, project_id, package_id, annotation_id, annotation_revision_id, revision_no,
    supersedes_annotation_revision_id, representation_version_id, representation_sha256,
    object_revision_id, technical_reference_revision_id, anchor_kind, point, body,
    created_by_user_id, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_annotation_id, v_annotation_revision_id, 1,
    null, v_representation_version_id, decode(repeat('b', 64), 'hex'),
    v_object_revision_id, v_technical_reference_revision_id, 'point', '{"x":1,"y":2}'::jsonb,
    'Private annotation text must not leak into the canonical release ref.',
    v_owner_id, 'r1-release-resolver', 'r1-release-resolver-annotation'
  );

  v_asset := projectceo_foundation.resolve_r1_external_release_attachment_ref(
    v_organization_id, v_project_id, v_package_id,
    jsonb_build_object('kind', 'asset_version', 'assetVersionId', v_asset_version_id)
  );
  v_representation := projectceo_foundation.resolve_r1_external_release_attachment_ref(
    v_organization_id, v_project_id, v_package_id,
    jsonb_build_object('kind', 'representation_version', 'representationVersionId', v_representation_version_id)
  );
  v_sheet := projectceo_foundation.resolve_r1_external_release_attachment_ref(
    v_organization_id, v_project_id, v_package_id,
    jsonb_build_object('kind', 'documentation_sheet_revision', 'sheetId', 'r1-release-resolver-sheet', 'sheetRevisionId', 'r1-release-resolver-sheet-r1')
  );
  v_binding := projectceo_foundation.resolve_r1_external_release_attachment_ref(
    v_organization_id, v_project_id, v_package_id,
    jsonb_build_object('kind', 'object_representation_binding', 'objectRepresentationBindingId', v_binding_id)
  );
  v_technical := projectceo_foundation.resolve_r1_external_release_attachment_ref(
    v_organization_id, v_project_id, v_package_id,
    jsonb_build_object('kind', 'technical_reference_revision', 'technicalReferenceRevisionId', v_technical_reference_revision_id)
  );
  v_annotation := projectceo_foundation.resolve_r1_external_release_attachment_ref(
    v_organization_id, v_project_id, v_package_id,
    jsonb_build_object('kind', 'annotation_revision', 'annotationRevisionId', v_annotation_revision_id)
  );

  if v_asset->>'refIdentity' <> 'asset_version:' || v_asset_version_id::text
     or v_representation#>>'{semanticContent,attestationId}' is null
     or v_sheet#>>'{semanticContent,sheetRevisionId}' <> 'r1-release-resolver-sheet-r1'
     or v_binding#>>'{semanticContent,objectRevisionId}' <> v_object_revision_id::text
     or v_technical#>>'{semanticContent,technicalReferenceRevisionId}' <> v_technical_reference_revision_id::text
     or v_annotation#>>'{semanticContent,annotationRevisionId}' <> v_annotation_revision_id::text then
    raise exception 'DB4_R1_EXTERNAL_RELEASE_RESOLUTION_INCOMPLETE';
  end if;
  if v_asset::text ~ '(private_storage_locator|r1/private|sourceUrl|signedUrl)'
     or v_representation::text ~ '(private_storage_locator|r1/private|sourceUrl|signedUrl)'
     or v_annotation::text ~ 'Private annotation text' then
    raise exception 'DB4_R1_EXTERNAL_RELEASE_RESOLUTION_LEAK';
  end if;
  if v_asset->>'semanticDigest' !~ '^sha256:[0-9a-f]{64}$'
     or v_representation->>'semanticDigest' !~ '^sha256:[0-9a-f]{64}$'
     or v_sheet->>'semanticDigest' !~ '^sha256:[0-9a-f]{64}$'
     or v_binding->>'semanticDigest' !~ '^sha256:[0-9a-f]{64}$'
     or v_technical->>'semanticDigest' !~ '^sha256:[0-9a-f]{64}$'
     or v_annotation->>'semanticDigest' !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'DB4_R1_EXTERNAL_RELEASE_RESOLUTION_DIGEST_INVALID';
  end if;

  begin
    perform projectceo_foundation.resolve_r1_external_release_attachment_ref(
      v_organization_id, v_project_id, v_other_package_id,
      jsonb_build_object('kind', 'asset_version', 'assetVersionId', v_asset_version_id)
    );
    raise exception 'DB4_R1_EXTERNAL_RELEASE_CROSS_PACKAGE_RESOLVE_ALLOWED';
  exception when sqlstate 'P1104' then null;
  end;

  if has_function_privilege(
    'authenticated',
    'projectceo_foundation.resolve_r1_external_release_attachment_ref(uuid,uuid,uuid,jsonb)',
    'execute'
  ) then
    raise exception 'DB4_R1_EXTERNAL_RELEASE_RESOLVER_PUBLIC_EXECUTE';
  end if;
end
$r1_external_release_resolver$;

rollback;

select 'DB4_R1_EXTERNAL_RELEASE_ATTACHMENT_RESOLVER_OK' as result;
