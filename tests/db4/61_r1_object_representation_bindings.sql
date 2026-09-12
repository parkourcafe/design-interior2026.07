\set ON_ERROR_STOP on

begin;

do $r1_object_binding_contract$
declare
  v_organization_id uuid;
  v_project_id uuid := '41111111-1111-4111-8111-111111111111';
  v_root_package_id uuid := '41111111-1111-4111-8111-111111111111';
  v_work_package_id uuid := '49999999-9999-4999-8999-999999999999';
  v_owner_id uuid := '31111111-1111-4111-8111-111111111111';
  v_asset_id uuid := 'b1111111-1111-4111-8111-111111111111';
  v_asset_version_id uuid := 'b2222222-2222-4222-8222-222222222222';
  v_representation_version_id uuid := 'b3333333-3333-4333-8333-333333333333';
  v_glb_asset_id uuid := 'b4444444-4444-4444-8444-444444444444';
  v_glb_asset_version_id uuid := 'b5555555-5555-4555-8555-555555555555';
  v_object_id uuid := 'b6666666-6666-4666-8666-666666666666';
  v_object_revision_id uuid := 'b7777777-7777-4777-8777-777777777777';
  v_second_object_id uuid := 'b7878787-8787-4787-8787-878787878787';
  v_second_object_revision_id uuid := 'b7979797-9797-4797-8797-979797979797';
  v_technical_reference_id uuid := 'b8888888-8888-4888-8888-888888888888';
  v_technical_reference_revision_id uuid := 'b9999999-9999-4999-8999-999999999999';
  v_technical_reference_candidate_revision_id uuid := 'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_checked integer;
  v_table text;
  v_timestamp_column text;
begin
  select organization_id into v_organization_id
  from project_intelligence.project_workflows
  where project_id = v_project_id;
  if v_organization_id is null then raise exception 'DB4_R1_OBJECT_FIXTURE_ORGANIZATION_MISSING'; end if;

  insert into projectceo_product.m2_workspace_revisions (
    organization_id, project_id, package_id, entity_kind, entity_id, revision_id,
    revision_no, supersedes_revision_id, status, payload, reason, reason_digest, created_by_user_id
  ) values
    (v_organization_id, v_project_id, v_root_package_id, 'room', 'r1-room-fixture', 'r1-room-rev-1',
      1, null, 'approved', '{}'::jsonb, 'R1 DB4 fixture', decode(repeat('a', 64), 'hex'), v_owner_id),
    (v_organization_id, v_project_id, v_root_package_id, 'material', 'r1-material-fixture', 'r1-material-rev-1',
      1, null, 'approved', '{}'::jsonb, 'R1 DB4 fixture', decode(repeat('b', 64), 'hex'), v_owner_id);

  insert into projectceo_foundation.external_assets (
    organization_id, project_id, package_id, asset_id, source_kind, created_by_user_id
  ) values
    (v_organization_id, v_project_id, v_root_package_id, v_asset_id, 'dwg', v_owner_id),
    (v_organization_id, v_project_id, v_root_package_id, v_glb_asset_id, 'glb', v_owner_id);

  insert into projectceo_foundation.external_asset_versions (
    organization_id, project_id, package_id, asset_id, asset_version_id, revision_no,
    server_sha256, byte_length, validated_format, private_storage_locator,
    origin_intake_generation, created_by_user_id
  ) values
    (v_organization_id, v_project_id, v_root_package_id, v_asset_id, v_asset_version_id, 1,
      decode(repeat('c', 64), 'hex'), 1024, 'dwg', 'r1/private/object-source', 'r1-object-fixture', v_owner_id),
    (v_organization_id, v_project_id, v_root_package_id, v_glb_asset_id, v_glb_asset_version_id, 1,
      decode(repeat('d', 64), 'hex'), 1024, 'glb', 'r1/private/object-representation', 'r1-object-fixture', v_owner_id);

  insert into projectceo_foundation.external_representation_versions (
    organization_id, project_id, package_id, asset_version_id, representation_version_id,
    server_sha256, byte_length, validated_format, private_storage_locator,
    producer_kind, producer_version, units, axes, transform, manifest_schema_version,
    provenance, resource_manifest, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_asset_version_id, v_representation_version_id,
    decode(repeat('e', 64), 'hex'), 2048, 'svg', 'r1/private/object-preview',
    'fixture-converter', '1', 'mm', 'z-up', '{}'::jsonb, 'r1/0.1', '{}'::jsonb, '{}'::jsonb, v_owner_id
  );

  insert into projectceo_foundation.external_representation_node_index (
    organization_id, project_id, package_id, representation_version_id, node_key,
    node_path, node_metadata, indexed_by_user_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_representation_version_id,
    'node:stair:001', '/Root/Stair/001', '{}'::jsonb, v_owner_id
  );

  insert into projectceo_foundation.project_objects (
    organization_id, project_id, package_id, object_id, object_key, object_kind,
    room_entity_id, protected_name, identification_origin, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_object_id, 'side-stair-landing',
    'fixed_element', 'r1-room-fixture', 'Side stair landing', 'dwg', v_owner_id
  );

  insert into projectceo_foundation.project_object_revisions (
    organization_id, project_id, package_id, object_id, object_revision_id, revision_no,
    supersedes_object_revision_id, room_entity_id, room_revision_id, semantic_payload,
    explicit_unknowns, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_object_id, v_object_revision_id, 1,
    null, 'r1-room-fixture', 'r1-room-rev-1', '{}'::jsonb, '[]'::jsonb, v_owner_id
  );

  insert into projectceo_foundation.project_object_material_references (
    organization_id, project_id, package_id, object_revision_id, material_entity_id,
    material_revision_id, relation_kind, evidence, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_object_revision_id,
    'r1-material-fixture', 'r1-material-rev-1', 'finish', '{}'::jsonb, v_owner_id
  );

  insert into projectceo_foundation.object_representation_bindings (
    organization_id, project_id, package_id, object_revision_id, representation_version_id,
    node_key, node_path, mapping_transform, mapping_method, mapping_evidence,
    mapped_by_user_id, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_object_revision_id, v_representation_version_id,
    'node:stair:001', '/Root/Stair/001', '{}'::jsonb, 'architect-verified', '{}'::jsonb,
    v_owner_id, 'db4-r1-object-binding', 'db4-r1-object-binding-request'
  );

  insert into projectceo_m3.documentation_sheet_revisions (
    organization_id, project_id, package_id, sheet_id, revision_id, revision_no,
    supersedes_revision_id, room_id, sheet_number, title, handoff_id, handoff_revision_id,
    handoff_contract_version, approved_m2_commit_revision_id, design_intent_revision_id,
    layout_document_id, layout_version_id, layout_revision_id, semantic_hash,
    specification_revision_ids, payload, reason, reason_digest, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, 'r1-sheet-fixture', 'r1-sheet-rev-1', 1,
    null, 'r1-room-fixture', 'R1-001', 'R1 DB4 object sheet', 'r1-handoff', 'r1-handoff-rev-1',
    'r1/0.1', 'r1-approved-commit', 'r1-design-intent', 'r1-layout-document',
    'r1-layout-version', 'r1-layout-revision', 'sha256:' || repeat('f', 64),
    array[]::text[], '{}'::jsonb, 'R1 DB4 fixture', decode(repeat('f', 64), 'hex'), v_owner_id
  );

  insert into projectceo_foundation.technical_reference_versions (
    organization_id, project_id, package_id, technical_reference_id,
    technical_reference_revision_id, revision_no, supersedes_technical_reference_revision_id,
    status, object_revision_id, sheet_id, sheet_revision_id, reference_asset_version_id,
    preview_sha256, view_kind, coordinate_space, x_min, y_min, x_max, y_max,
    mapping_method, mapping_evidence, created_by_user_id, confirmed_by_user_id, confirmed_at,
    causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_technical_reference_id,
    v_technical_reference_revision_id, 1, null, 'confirmed', v_object_revision_id,
    'r1-sheet-fixture', 'r1-sheet-rev-1', v_asset_version_id, decode(repeat('1', 64), 'hex'),
    'detail', 'sheet_mm', 0, 0, 100, 100,
    'architect-verified', '{}'::jsonb, v_owner_id, v_owner_id, statement_timestamp(),
    'db4-r1-technical-reference', 'db4-r1-technical-reference-request'
  );

  insert into projectceo_foundation.technical_reference_events (
    organization_id, project_id, package_id, technical_reference_revision_id, sequence_no,
    event_type, actor_type, actor_id, actor_user_id, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_technical_reference_revision_id, 1,
    'confirmed', 'human', v_owner_id::text, v_owner_id,
    'db4-r1-technical-reference', 'db4-r1-technical-reference-event'
  );

  begin
    insert into projectceo_foundation.project_objects (
      organization_id, project_id, package_id, object_key, object_kind,
      room_entity_id, protected_name, identification_origin, created_by_user_id
    ) values (
      v_organization_id, v_project_id, v_work_package_id, 'wrong-package-room', 'room_area',
      'r1-room-fixture', 'Wrong package room', 'manual', v_owner_id
    );
    insert into projectceo_foundation.project_object_revisions (
      organization_id, project_id, package_id, object_id, revision_no,
      room_entity_id, room_revision_id, semantic_payload, explicit_unknowns, created_by_user_id
    ) select
      v_organization_id, v_project_id, v_work_package_id, object_id, 1,
      'r1-room-fixture', 'r1-room-rev-1', '{}'::jsonb, '[]'::jsonb, v_owner_id
    from projectceo_foundation.project_objects
    where organization_id = v_organization_id and project_id = v_project_id
      and package_id = v_work_package_id and object_key = 'wrong-package-room';
    raise exception 'DB4_R1_ROOM_SCOPE_MISMATCH_ALLOWED';
  exception when others then
    if sqlerrm not like '%R1_OBJECT_ROOM_SCOPE_MISMATCH%' then raise; end if;
  end;

  begin
    insert into projectceo_foundation.object_representation_bindings (
      organization_id, project_id, package_id, object_revision_id, representation_version_id,
      node_key, node_path, mapping_transform, mapping_method, mapping_evidence,
      mapped_by_user_id, causation_id, request_id
    ) values (
      v_organization_id, v_project_id, v_root_package_id, v_object_revision_id, v_representation_version_id,
      'node:stair:001', '/Root/Wrong', '{}'::jsonb, 'architect-verified', '{}'::jsonb,
      v_owner_id, 'db4-r1-object-binding-path', 'db4-r1-object-binding-path-request'
    );
    raise exception 'DB4_R1_NODE_PATH_MISMATCH_ALLOWED';
  exception when others then
    if sqlerrm not like '%R1_BINDING_NODE_PATH_MISMATCH%' then raise; end if;
  end;

  begin
    insert into projectceo_foundation.project_object_material_references (
      organization_id, project_id, package_id, object_revision_id, material_entity_id,
      material_revision_id, relation_kind, evidence, created_by_user_id
    ) values (
      v_organization_id, v_project_id, v_root_package_id, v_object_revision_id,
      'r1-material-fixture', 'missing-material-revision', 'component', '{}'::jsonb, v_owner_id
    );
    raise exception 'DB4_R1_MATERIAL_SCOPE_MISMATCH_ALLOWED';
  exception when others then
    if sqlerrm not like '%R1_OBJECT_MATERIAL_SCOPE_MISMATCH%' then raise; end if;
  end;

  begin
    insert into projectceo_foundation.technical_reference_versions (
      organization_id, project_id, package_id, technical_reference_id,
      revision_no, status, object_revision_id, sheet_id, sheet_revision_id,
      reference_asset_version_id, preview_sha256, view_kind, coordinate_space,
      x_min, y_min, x_max, y_max, mapping_method, mapping_evidence,
      created_by_user_id, causation_id, request_id
    ) values (
      v_organization_id, v_project_id, v_root_package_id, extensions.gen_random_uuid(),
      1, 'candidate', v_object_revision_id, 'r1-sheet-fixture', 'r1-sheet-rev-1',
      v_glb_asset_version_id, decode(repeat('2', 64), 'hex'), 'detail', 'sheet_mm',
      0, 0, 100, 100, 'architect-verified', '{}'::jsonb, v_owner_id,
      'db4-r1-technical-reference-format', 'db4-r1-technical-reference-format-request'
    );
    raise exception 'DB4_R1_TECHNICAL_REFERENCE_FORMAT_ALLOWED';
  exception when others then
    if sqlerrm not like '%R1_TECHNICAL_REFERENCE_SCOPE_MISMATCH%' then raise; end if;
  end;

  insert into projectceo_foundation.technical_reference_versions (
    organization_id, project_id, package_id, technical_reference_id,
    technical_reference_revision_id, revision_no, supersedes_technical_reference_revision_id,
    status, object_revision_id, sheet_id, sheet_revision_id, reference_asset_version_id,
    preview_sha256, view_kind, coordinate_space, x_min, y_min, x_max, y_max,
    mapping_method, mapping_evidence, created_by_user_id, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_technical_reference_id,
    v_technical_reference_candidate_revision_id, 2, v_technical_reference_revision_id,
    'candidate', v_object_revision_id, 'r1-sheet-fixture', 'r1-sheet-rev-1', v_asset_version_id,
    decode(repeat('3', 64), 'hex'), 'detail', 'sheet_mm', 10, 10, 110, 110,
    'architect-reconfirmation', '{}'::jsonb, v_owner_id,
    'db4-r1-technical-reference-candidate', 'db4-r1-technical-reference-candidate-request'
  );

  insert into projectceo_foundation.technical_reference_events (
    organization_id, project_id, package_id, technical_reference_revision_id, sequence_no,
    event_type, actor_type, actor_id, actor_user_id, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_technical_reference_candidate_revision_id, 1,
    'needs_reconfirmation', 'human', v_owner_id::text, v_owner_id,
    'db4-r1-technical-reference-candidate', 'db4-r1-technical-reference-candidate-event'
  );

  insert into projectceo_foundation.project_objects (
    organization_id, project_id, package_id, object_id, object_key, object_kind,
    room_entity_id, protected_name, identification_origin, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_second_object_id, 'side-stair-rail',
    'fixed_element', 'r1-room-fixture', 'Side stair rail', 'dwg', v_owner_id
  );

  insert into projectceo_foundation.project_object_revisions (
    organization_id, project_id, package_id, object_id, object_revision_id, revision_no,
    room_entity_id, room_revision_id, semantic_payload, explicit_unknowns, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_root_package_id, v_second_object_id, v_second_object_revision_id, 1,
    'r1-room-fixture', 'r1-room-rev-1', '{}'::jsonb, '[]'::jsonb, v_owner_id
  );

  begin
    insert into projectceo_foundation.project_object_revisions (
      organization_id, project_id, package_id, object_id, revision_no,
      supersedes_object_revision_id, room_entity_id, room_revision_id,
      semantic_payload, explicit_unknowns, created_by_user_id
    ) values (
      v_organization_id, v_project_id, v_root_package_id, v_second_object_id, 2,
      v_object_revision_id, 'r1-room-fixture', 'r1-room-rev-1',
      '{}'::jsonb, '[]'::jsonb, v_owner_id
    );
    raise exception 'DB4_R1_CROSS_OBJECT_LINEAGE_ALLOWED';
  exception when foreign_key_violation then null;
  end;

  for v_table, v_timestamp_column in
    select table_name, timestamp_column
    from (values
      ('project_objects'::text, 'created_at'::text),
      ('project_object_revisions', 'created_at'),
      ('project_object_material_references', 'created_at'),
      ('external_representation_node_index', 'indexed_at'),
      ('object_representation_bindings', 'created_at'),
      ('technical_reference_versions', 'created_at'),
      ('technical_reference_events', 'occurred_at')
    ) as append_only(table_name, timestamp_column)
  loop
    begin
      execute format('update projectceo_foundation.%I set %I = %I', v_table, v_timestamp_column, v_timestamp_column);
      raise exception 'DB4_R1_APPEND_ONLY_UPDATE_ALLOWED: %', v_table;
    exception when sqlstate '55000' then null;
    end;
    begin
      execute format('delete from projectceo_foundation.%I', v_table);
      raise exception 'DB4_R1_APPEND_ONLY_DELETE_ALLOWED: %', v_table;
    exception when sqlstate '55000' then null;
    end;
  end loop;

  select count(*) into v_checked
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'projectceo_foundation'
    and c.relname in (
      'project_objects', 'project_object_revisions', 'project_object_material_references',
      'external_representation_node_index', 'object_representation_bindings',
      'technical_reference_versions', 'technical_reference_events'
    )
    and c.relrowsecurity and c.relforcerowsecurity;
  if v_checked <> 7 then raise exception 'DB4_R1_OBJECT_RLS_FORCE_MISSING'; end if;

  foreach v_table in array array[
    'project_objects', 'project_object_revisions', 'project_object_material_references',
    'external_representation_node_index', 'object_representation_bindings',
    'technical_reference_versions', 'technical_reference_events'
  ] loop
    if has_table_privilege('authenticated', format('projectceo_foundation.%I', v_table), 'select')
      or has_table_privilege('authenticated', format('projectceo_foundation.%I', v_table), 'insert')
      or has_table_privilege('authenticated', format('projectceo_foundation.%I', v_table), 'update')
      or has_table_privilege('authenticated', format('projectceo_foundation.%I', v_table), 'delete') then
      raise exception 'DB4_R1_OBJECT_AUTHENTICATED_TABLE_ACCESS: %', v_table;
    end if;
  end loop;
end
$r1_object_binding_contract$;

set constraints all immediate;

select 'DB4_R1_OBJECT_REPRESENTATION_BINDINGS_OK' as result;

rollback;
