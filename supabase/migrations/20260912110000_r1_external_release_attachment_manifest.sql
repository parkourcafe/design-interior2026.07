begin;
set local search_path = pg_catalog, projectceo_foundation, extensions;

-- R1 uses an immutable candidate before a release is frozen. The candidate is
-- server-composed from narrow IDs; the release transaction re-resolves every
-- record and copies the exact snapshot into the released manifest.
do $r1_external_release_registry$
declare
  v_old_operations text[];
  v_old_events text[];
begin
  select array_agg(match[1] order by match[1]) into v_old_operations
  from pg_catalog.pg_constraint c,
    lateral regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), $re$'([a-z0-9_]+)'$re$, 'g') match
  where c.conname = 'command_records_operation_check'
    and c.conrelid = 'projectceo_product.command_records'::regclass;
  select array_agg(match[1] order by match[1]) into v_old_events
  from pg_catalog.pg_constraint c,
    lateral regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), $re$'([a-z0-9_]+)'$re$, 'g') match
  where c.conname = 'audit_events_event_type_check'
    and c.conrelid = 'projectceo_product.audit_events'::regclass;
  if v_old_operations is null or v_old_events is null then
    raise exception 'R1_EXTERNAL_RELEASE_COMMAND_REGISTRY_MISSING';
  end if;
  alter table projectceo_product.command_records drop constraint command_records_operation_check;
  execute format(
    'alter table projectceo_product.command_records add constraint command_records_operation_check check (operation = any (array[%s]))',
    (select string_agg(quote_literal(value), ', ' order by value)
     from (select distinct value from unnest(v_old_operations || array[
       'attach_external_release_refs',
       'publish_release_request_bound_external',
       'publish_work_package_release_request_bound_external'
     ]) value) registry_values)
  );
  alter table projectceo_product.audit_events drop constraint audit_events_event_type_check;
  execute format(
    'alter table projectceo_product.audit_events add constraint audit_events_event_type_check check (event_type = any (array[%s]))',
    (select string_agg(quote_literal(value), ', ' order by value)
     from (select distinct value from unnest(v_old_events || array[
       'external_release_refs_attached',
       'external_release_manifest_frozen'
     ]) value) registry_values)
  );
end
$r1_external_release_registry$;

create table projectceo_foundation.external_release_attachment_submissions (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  external_attachment_submission_id uuid not null default extensions.gen_random_uuid(),
  handoff_id text not null check (char_length(btrim(handoff_id)) between 1 and 160 and handoff_id = btrim(handoff_id)),
  handoff_revision_id text not null check (char_length(btrim(handoff_revision_id)) between 1 and 160 and handoff_revision_id = btrim(handoff_revision_id)),
  review_subject_digest bytea not null check (octet_length(review_subject_digest) = 32),
  schema_version text not null check (schema_version = 'archidom.external-release-attachments/0.2'),
  semantic_content jsonb not null check (
    jsonb_typeof(semantic_content) = 'object'
    and not (semantic_content ?| array['storageLocator','storagePath','signedUrl','sourceUrl','originalFilename'])
  ),
  semantic_digest bytea not null check (octet_length(semantic_digest) = 32),
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, external_attachment_submission_id),
  foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (organization_id, project_id, id) on delete restrict,
  foreign key (organization_id, created_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict
);

create table projectceo_foundation.external_release_attachment_submission_refs (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  external_attachment_submission_id uuid not null,
  ordinal bigint not null check (ordinal between 0 and 9007199254740991),
  ref_kind text not null check (ref_kind in (
    'asset_version','representation_version','documentation_sheet_revision',
    'object_representation_binding','technical_reference_revision','annotation_revision'
  )),
  -- Sheet identities encode two 160-character IDs as a JSON tuple. At six
  -- characters per escape, 2 * 160 * 6 + 8 JSON characters + 29 prefix = 1957.
  ref_identity text not null check (char_length(ref_identity) between 3 and 2048),
  asset_version_id uuid,
  representation_version_id uuid,
  sheet_id text,
  sheet_revision_id text,
  object_representation_binding_id uuid,
  technical_reference_revision_id uuid,
  annotation_revision_id uuid,
  semantic_content jsonb not null check (jsonb_typeof(semantic_content) = 'object'),
  semantic_digest bytea not null check (octet_length(semantic_digest) = 32),
  primary key (organization_id, project_id, package_id, external_attachment_submission_id, ordinal),
  unique (organization_id, project_id, package_id, external_attachment_submission_id, ref_identity),
  foreign key (organization_id, project_id, package_id, external_attachment_submission_id)
    references projectceo_foundation.external_release_attachment_submissions
      (organization_id, project_id, package_id, external_attachment_submission_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, asset_version_id)
    references projectceo_foundation.external_asset_versions (organization_id, project_id, package_id, asset_version_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, representation_version_id)
    references projectceo_foundation.external_representation_versions (organization_id, project_id, package_id, representation_version_id) on delete restrict,
  foreign key (organization_id, project_id, sheet_id, sheet_revision_id)
    references projectceo_m3.documentation_sheet_revisions (organization_id, project_id, sheet_id, revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, object_representation_binding_id)
    references projectceo_foundation.object_representation_bindings (organization_id, project_id, package_id, binding_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, technical_reference_revision_id)
    references projectceo_foundation.technical_reference_versions (organization_id, project_id, package_id, technical_reference_revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, annotation_revision_id)
    references projectceo_foundation.external_annotation_revisions (organization_id, project_id, package_id, annotation_revision_id) on delete restrict,
  check (
    (ref_kind = 'asset_version' and asset_version_id is not null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'representation_version' and asset_version_id is null and representation_version_id is not null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'documentation_sheet_revision' and asset_version_id is null and representation_version_id is null and sheet_id is not null and sheet_revision_id is not null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'object_representation_binding' and asset_version_id is null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is not null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'technical_reference_revision' and asset_version_id is null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is not null and annotation_revision_id is null)
    or (ref_kind = 'annotation_revision' and asset_version_id is null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is not null)
  )
);

create table projectceo_foundation.external_release_attachment_manifests (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  external_attachment_manifest_id uuid not null default extensions.gen_random_uuid(),
  external_attachment_submission_id uuid not null,
  production_package_version_id text not null check (char_length(btrim(production_package_version_id)) between 1 and 160 and production_package_version_id = btrim(production_package_version_id)),
  handoff_id text not null check (char_length(btrim(handoff_id)) between 1 and 160 and handoff_id = btrim(handoff_id)),
  handoff_revision_id text not null check (char_length(btrim(handoff_revision_id)) between 1 and 160 and handoff_revision_id = btrim(handoff_revision_id)),
  approved_snapshot_digest bytea not null check (octet_length(approved_snapshot_digest) = 32),
  schema_version text not null check (schema_version = 'archidom.external-release-attachments/0.2'),
  semantic_content jsonb not null check (
    jsonb_typeof(semantic_content) = 'object'
    and not (semantic_content ?| array['storageLocator','storagePath','signedUrl','sourceUrl','originalFilename'])
  ),
  semantic_digest bytea not null check (octet_length(semantic_digest) = 32),
  frozen_by_user_id uuid not null,
  frozen_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, external_attachment_manifest_id),
  unique (organization_id, project_id, package_id, production_package_version_id),
  unique (organization_id, project_id, package_id, external_attachment_submission_id),
  foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (organization_id, project_id, id) on delete restrict,
  foreign key (organization_id, project_id, package_id, external_attachment_submission_id)
    references projectceo_foundation.external_release_attachment_submissions
      (organization_id, project_id, package_id, external_attachment_submission_id) on delete restrict,
  foreign key (organization_id, project_id, production_package_version_id)
    references projectceo_product.production_package_versions
      (organization_id, project_id, production_package_version_id) on delete restrict,
  foreign key (organization_id, frozen_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict
);

create table projectceo_foundation.external_release_attachment_manifest_refs (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  external_attachment_manifest_id uuid not null,
  ordinal bigint not null check (ordinal between 0 and 9007199254740991),
  ref_kind text not null check (ref_kind in (
    'asset_version','representation_version','documentation_sheet_revision',
    'object_representation_binding','technical_reference_revision','annotation_revision'
  )),
  -- Keep the same bound as candidate refs so every exact identity can freeze.
  ref_identity text not null check (char_length(ref_identity) between 3 and 2048),
  asset_version_id uuid,
  representation_version_id uuid,
  sheet_id text,
  sheet_revision_id text,
  object_representation_binding_id uuid,
  technical_reference_revision_id uuid,
  annotation_revision_id uuid,
  semantic_content jsonb not null check (jsonb_typeof(semantic_content) = 'object'),
  semantic_digest bytea not null check (octet_length(semantic_digest) = 32),
  primary key (organization_id, project_id, package_id, external_attachment_manifest_id, ordinal),
  unique (organization_id, project_id, package_id, external_attachment_manifest_id, ref_identity),
  foreign key (organization_id, project_id, package_id, external_attachment_manifest_id)
    references projectceo_foundation.external_release_attachment_manifests
      (organization_id, project_id, package_id, external_attachment_manifest_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, asset_version_id)
    references projectceo_foundation.external_asset_versions (organization_id, project_id, package_id, asset_version_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, representation_version_id)
    references projectceo_foundation.external_representation_versions (organization_id, project_id, package_id, representation_version_id) on delete restrict,
  foreign key (organization_id, project_id, sheet_id, sheet_revision_id)
    references projectceo_m3.documentation_sheet_revisions (organization_id, project_id, sheet_id, revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, object_representation_binding_id)
    references projectceo_foundation.object_representation_bindings (organization_id, project_id, package_id, binding_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, technical_reference_revision_id)
    references projectceo_foundation.technical_reference_versions (organization_id, project_id, package_id, technical_reference_revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, annotation_revision_id)
    references projectceo_foundation.external_annotation_revisions (organization_id, project_id, package_id, annotation_revision_id) on delete restrict,
  check (
    (ref_kind = 'asset_version' and asset_version_id is not null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'representation_version' and asset_version_id is null and representation_version_id is not null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'documentation_sheet_revision' and asset_version_id is null and representation_version_id is null and sheet_id is not null and sheet_revision_id is not null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'object_representation_binding' and asset_version_id is null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is not null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'technical_reference_revision' and asset_version_id is null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is not null and annotation_revision_id is null)
    or (ref_kind = 'annotation_revision' and asset_version_id is null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is not null)
  )
);

create index external_release_attachment_submission_refs_asset_idx
  on projectceo_foundation.external_release_attachment_submission_refs (organization_id, project_id, package_id, asset_version_id)
  where asset_version_id is not null;
create index external_release_attachment_submission_refs_representation_idx
  on projectceo_foundation.external_release_attachment_submission_refs (organization_id, project_id, package_id, representation_version_id)
  where representation_version_id is not null;
create index external_release_attachment_submission_refs_sheet_idx
  on projectceo_foundation.external_release_attachment_submission_refs (organization_id, project_id, sheet_id, sheet_revision_id)
  where sheet_id is not null;
create index external_release_attachment_submission_refs_binding_idx
  on projectceo_foundation.external_release_attachment_submission_refs (organization_id, project_id, package_id, object_representation_binding_id)
  where object_representation_binding_id is not null;
create index external_release_attachment_submission_refs_technical_idx
  on projectceo_foundation.external_release_attachment_submission_refs (organization_id, project_id, package_id, technical_reference_revision_id)
  where technical_reference_revision_id is not null;
create index external_release_attachment_submission_refs_annotation_idx
  on projectceo_foundation.external_release_attachment_submission_refs (organization_id, project_id, package_id, annotation_revision_id)
  where annotation_revision_id is not null;
create index external_release_attachment_manifest_refs_asset_idx
  on projectceo_foundation.external_release_attachment_manifest_refs (organization_id, project_id, package_id, asset_version_id)
  where asset_version_id is not null;
create index external_release_attachment_manifest_refs_representation_idx
  on projectceo_foundation.external_release_attachment_manifest_refs (organization_id, project_id, package_id, representation_version_id)
  where representation_version_id is not null;
create index external_release_attachment_manifest_refs_sheet_idx
  on projectceo_foundation.external_release_attachment_manifest_refs (organization_id, project_id, sheet_id, sheet_revision_id)
  where sheet_id is not null;
create index external_release_attachment_manifest_refs_binding_idx
  on projectceo_foundation.external_release_attachment_manifest_refs (organization_id, project_id, package_id, object_representation_binding_id)
  where object_representation_binding_id is not null;
create index external_release_attachment_manifest_refs_technical_idx
  on projectceo_foundation.external_release_attachment_manifest_refs (organization_id, project_id, package_id, technical_reference_revision_id)
  where technical_reference_revision_id is not null;
create index external_release_attachment_manifest_refs_annotation_idx
  on projectceo_foundation.external_release_attachment_manifest_refs (organization_id, project_id, package_id, annotation_revision_id)
  where annotation_revision_id is not null;

-- Server-only canonicalization. The caller can name one of the six typed
-- references, but neither its semantic payload nor its digest comes from the
-- caller. Publication will call this resolver again inside its own transaction.
create function projectceo_foundation._r1_external_release_ref_uuid(
  p_requested_ref jsonb,
  p_key text
)
returns uuid
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text;
begin
  v_value := p_requested_ref ->> p_key;
  if v_value is null or v_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', jsonb_build_object('field', p_key)
    );
  end if;
  return v_value::uuid;
end
$function$;

create function projectceo_foundation.resolve_r1_external_release_attachment_ref(
  p_organization_id uuid,
  p_project_id uuid,
  p_package_id uuid,
  p_requested_ref jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_kind text;
  v_uuid uuid;
  v_sheet_id text;
  v_sheet_revision_id text;
  v_content jsonb;
  v_identity text;
  v_attestation_id uuid;
  v_asset record;
  v_representation record;
  v_sheet record;
  v_binding record;
  v_technical record;
  v_annotation record;
begin
  if jsonb_typeof(p_requested_ref) <> 'object'
     or coalesce(p_requested_ref ->> 'kind', '') not in (
       'asset_version', 'representation_version', 'documentation_sheet_revision',
       'object_representation_binding', 'technical_reference_revision', 'annotation_revision'
     ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"externalAttachmentRef"}'::jsonb
    );
  end if;
  v_kind := p_requested_ref ->> 'kind';

  if v_kind = 'asset_version' then
    if exists (
      select 1 from jsonb_object_keys(p_requested_ref) k(value)
      where k.value not in ('kind', 'assetVersionId')
    ) then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"externalAttachmentRef"}'::jsonb);
    end if;
    v_uuid := projectceo_foundation._r1_external_release_ref_uuid(p_requested_ref, 'assetVersionId');
    select asset.asset_id, asset.source_kind, version.asset_version_id,
      version.server_sha256, version.byte_length, version.validated_format,
      version.origin_intake_generation
      into v_asset
    from projectceo_foundation.external_asset_versions version
    join projectceo_foundation.external_assets asset
      on asset.organization_id = version.organization_id
     and asset.project_id = version.project_id
     and asset.package_id = version.package_id
     and asset.asset_id = version.asset_id
    where version.organization_id = p_organization_id
      and version.project_id = p_project_id
      and version.package_id = p_package_id
      and version.asset_version_id = v_uuid
    for key share of version, asset;
    if not found then
      perform projectceo_product._raise('P1104', 'not_found', '{"entity":"externalAttachmentRef"}'::jsonb);
    end if;
    v_identity := 'asset_version:' || v_asset.asset_version_id::text;
    v_content := jsonb_build_object(
      'assetId', v_asset.asset_id,
      'assetVersionId', v_asset.asset_version_id,
      'byteLength', v_asset.byte_length,
      'originIntakeGeneration', v_asset.origin_intake_generation,
      'sourceDigest', 'sha256:' || encode(v_asset.server_sha256, 'hex'),
      'sourceKind', v_asset.source_kind,
      'validatedFormat', v_asset.validated_format
    );
    return jsonb_build_object(
      'assetVersionId', v_asset.asset_version_id,
      'refIdentity', v_identity,
      'refKind', v_kind,
      'semanticContent', v_content,
      'semanticDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_content), 'hex')
    );
  end if;

  if v_kind = 'representation_version' then
    if exists (
      select 1 from jsonb_object_keys(p_requested_ref) k(value)
      where k.value not in ('kind', 'representationVersionId')
    ) then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"externalAttachmentRef"}'::jsonb);
    end if;
    v_uuid := projectceo_foundation._r1_external_release_ref_uuid(p_requested_ref, 'representationVersionId');
    select asset.asset_id, version.asset_version_id, source.server_sha256 as source_sha256,
      version.representation_version_id, version.server_sha256 as representation_sha256,
      version.byte_length, version.validated_format, version.producer_kind,
      version.producer_version, version.units, version.axes, version.transform,
      version.manifest_schema_version
      into v_representation
    from projectceo_foundation.external_representation_versions version
    join projectceo_foundation.external_asset_versions source
      on source.organization_id = version.organization_id
     and source.project_id = version.project_id
     and source.package_id = version.package_id
     and source.asset_version_id = version.asset_version_id
    join projectceo_foundation.external_assets asset
      on asset.organization_id = source.organization_id
     and asset.project_id = source.project_id
     and asset.package_id = source.package_id
     and asset.asset_id = source.asset_id
    where version.organization_id = p_organization_id
      and version.project_id = p_project_id
      and version.package_id = p_package_id
      and version.representation_version_id = v_uuid
    for key share of version, source, asset;
    if not found then
      perform projectceo_product._raise('P1104', 'not_found', '{"entity":"externalAttachmentRef"}'::jsonb);
    end if;
    select attestation.attestation_id into v_attestation_id
    from projectceo_foundation.external_representation_attestations attestation
    where attestation.organization_id = p_organization_id
      and attestation.project_id = p_project_id
      and attestation.package_id = p_package_id
      and attestation.asset_version_id = v_representation.asset_version_id
      and attestation.representation_version_id = v_representation.representation_version_id
      and attestation.source_sha256 = v_representation.source_sha256
      and attestation.representation_sha256 = v_representation.representation_sha256
      and attestation.confirmed_units = v_representation.units
      and attestation.confirmed_axes = v_representation.axes
    for key share;
    if v_attestation_id is null then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"EXTERNAL_REPRESENTATION_ATTESTATION_REQUIRED"}'::jsonb);
    end if;
    v_identity := 'representation_version:' || v_representation.representation_version_id::text;
    v_content := jsonb_build_object(
      'assetId', v_representation.asset_id,
      'assetVersionId', v_representation.asset_version_id,
      'attestationId', v_attestation_id,
      'axes', v_representation.axes,
      'byteLength', v_representation.byte_length,
      'manifestSchemaVersion', v_representation.manifest_schema_version,
      'producerKind', v_representation.producer_kind,
      'producerVersion', v_representation.producer_version,
      'representationDigest', 'sha256:' || encode(v_representation.representation_sha256, 'hex'),
      'representationVersionId', v_representation.representation_version_id,
      'sourceDigest', 'sha256:' || encode(v_representation.source_sha256, 'hex'),
      'transformDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_representation.transform), 'hex'),
      'units', v_representation.units,
      'validatedFormat', v_representation.validated_format
    );
    return jsonb_build_object(
      'refIdentity', v_identity,
      'refKind', v_kind,
      'representationVersionId', v_representation.representation_version_id,
      'semanticContent', v_content,
      'semanticDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_content), 'hex')
    );
  end if;

  if v_kind = 'documentation_sheet_revision' then
    if exists (
      select 1 from jsonb_object_keys(p_requested_ref) k(value)
      where k.value not in ('kind', 'sheetId', 'sheetRevisionId')
    ) then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"externalAttachmentRef"}'::jsonb);
    end if;
    v_sheet_id := p_requested_ref ->> 'sheetId';
    v_sheet_revision_id := p_requested_ref ->> 'sheetRevisionId';
    if v_sheet_id is null or v_sheet_revision_id is null
       or btrim(v_sheet_id) = '' or btrim(v_sheet_revision_id) = ''
       or v_sheet_id <> btrim(v_sheet_id) or v_sheet_revision_id <> btrim(v_sheet_revision_id)
       or char_length(v_sheet_id) > 160 or char_length(v_sheet_revision_id) > 160 then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"externalAttachmentRef"}'::jsonb);
    end if;
    select revision.sheet_id, revision.revision_id, revision.handoff_id,
      revision.handoff_revision_id, revision.handoff_contract_version,
      revision.approved_m2_commit_revision_id, revision.design_intent_revision_id,
      revision.layout_document_id, revision.layout_version_id, revision.layout_revision_id,
      revision.semantic_hash, revision.specification_revision_ids, revision.payload
      into v_sheet
    from projectceo_m3.documentation_sheet_revisions revision
    where revision.organization_id = p_organization_id
      and revision.project_id = p_project_id
      and revision.package_id = p_package_id
      and revision.sheet_id = v_sheet_id
      and revision.revision_id = v_sheet_revision_id
    for key share;
    if not found then
      perform projectceo_product._raise('P1104', 'not_found', '{"entity":"externalAttachmentRef"}'::jsonb);
    end if;
    -- A tuple encoding prevents ambiguous IDs when either component has ':'.
    v_identity := 'documentation_sheet_revision:' || jsonb_build_array(v_sheet.sheet_id, v_sheet.revision_id)::text;
    v_content := jsonb_build_object(
      'approvedM2CommitRevisionId', v_sheet.approved_m2_commit_revision_id,
      'designIntentRevisionId', v_sheet.design_intent_revision_id,
      'handoffContractVersion', v_sheet.handoff_contract_version,
      'handoffId', v_sheet.handoff_id,
      'handoffRevisionId', v_sheet.handoff_revision_id,
      'layoutDocumentId', v_sheet.layout_document_id,
      'layoutRevisionId', v_sheet.layout_revision_id,
      'layoutVersionId', v_sheet.layout_version_id,
      'payloadDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_sheet.payload), 'hex'),
      'semanticHash', v_sheet.semantic_hash,
      'sheetId', v_sheet.sheet_id,
      'sheetRevisionId', v_sheet.revision_id,
      'specificationRevisionIds', to_jsonb(v_sheet.specification_revision_ids)
    );
    return jsonb_build_object(
      'refIdentity', v_identity,
      'refKind', v_kind,
      'semanticContent', v_content,
      'semanticDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_content), 'hex'),
      'sheetId', v_sheet.sheet_id,
      'sheetRevisionId', v_sheet.revision_id
    );
  end if;

  if v_kind = 'object_representation_binding' then
    if exists (
      select 1 from jsonb_object_keys(p_requested_ref) k(value)
      where k.value not in ('kind', 'objectRepresentationBindingId')
    ) then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"externalAttachmentRef"}'::jsonb);
    end if;
    v_uuid := projectceo_foundation._r1_external_release_ref_uuid(p_requested_ref, 'objectRepresentationBindingId');
    select binding.binding_id, binding.object_revision_id, binding.representation_version_id,
      binding.node_key, binding.node_path, binding.mapping_transform, binding.mapping_method,
      binding.mapping_evidence, representation.server_sha256 as representation_sha256
      into v_binding
    from projectceo_foundation.object_representation_bindings binding
    join projectceo_foundation.external_representation_versions representation
      on representation.organization_id = binding.organization_id
     and representation.project_id = binding.project_id
     and representation.package_id = binding.package_id
     and representation.representation_version_id = binding.representation_version_id
    where binding.organization_id = p_organization_id
      and binding.project_id = p_project_id
      and binding.package_id = p_package_id
      and binding.binding_id = v_uuid
    for key share of binding, representation;
    if not found then
      perform projectceo_product._raise('P1104', 'not_found', '{"entity":"externalAttachmentRef"}'::jsonb);
    end if;
    v_identity := 'object_representation_binding:' || v_binding.binding_id::text;
    v_content := jsonb_build_object(
      'mappingEvidenceDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_binding.mapping_evidence), 'hex'),
      'mappingMethod', v_binding.mapping_method,
      'mappingTransformDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_binding.mapping_transform), 'hex'),
      'nodeKey', v_binding.node_key,
      'nodePath', v_binding.node_path,
      'objectRevisionId', v_binding.object_revision_id,
      'representationDigest', 'sha256:' || encode(v_binding.representation_sha256, 'hex'),
      'representationVersionId', v_binding.representation_version_id
    );
    return jsonb_build_object(
      'objectRepresentationBindingId', v_binding.binding_id,
      'refIdentity', v_identity,
      'refKind', v_kind,
      'semanticContent', v_content,
      'semanticDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_content), 'hex')
    );
  end if;

  if v_kind = 'technical_reference_revision' then
    if exists (
      select 1 from jsonb_object_keys(p_requested_ref) k(value)
      where k.value not in ('kind', 'technicalReferenceRevisionId')
    ) then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"externalAttachmentRef"}'::jsonb);
    end if;
    v_uuid := projectceo_foundation._r1_external_release_ref_uuid(p_requested_ref, 'technicalReferenceRevisionId');
    select technical.technical_reference_revision_id, technical.object_revision_id,
      technical.sheet_id, technical.sheet_revision_id, technical.reference_asset_version_id,
      technical.preview_representation_version_id, technical.preview_sha256,
      technical.view_kind, technical.coordinate_space, technical.x_min, technical.y_min,
      technical.x_max, technical.y_max, technical.view_transform,
      technical.mapping_method, technical.mapping_evidence, asset.server_sha256 as source_sha256,
      representation.server_sha256 as representation_sha256
      into v_technical
    from projectceo_foundation.technical_reference_versions technical
    join projectceo_foundation.external_asset_versions asset
      on asset.organization_id = technical.organization_id
     and asset.project_id = technical.project_id
     and asset.package_id = technical.package_id
     and asset.asset_version_id = technical.reference_asset_version_id
    left join projectceo_foundation.external_representation_versions representation
      on representation.organization_id = technical.organization_id
     and representation.project_id = technical.project_id
     and representation.package_id = technical.package_id
     and representation.representation_version_id = technical.preview_representation_version_id
    where technical.organization_id = p_organization_id
      and technical.project_id = p_project_id
      and technical.package_id = p_package_id
      and technical.technical_reference_revision_id = v_uuid
      and technical.status = 'confirmed'
    -- `representation` is the nullable side for a PDF technical reference.
    -- PostgreSQL cannot lock an outer-join nullable relation; the referenced
    -- version is immutable and protected by the exact FK, so lock the two
    -- mandatory rows and resolve the optional representation again below.
    for key share of technical, asset;
    if not found then
      perform projectceo_product._raise('P1104', 'not_found', '{"entity":"externalAttachmentRef"}'::jsonb);
    end if;
    if not exists (
      select 1
      from projectceo_m3.documentation_sheet_revisions sheet
      where sheet.organization_id = p_organization_id
        and sheet.project_id = p_project_id
        and sheet.package_id = p_package_id
        and sheet.sheet_id = v_technical.sheet_id
        and sheet.revision_id = v_technical.sheet_revision_id
    ) then
      perform projectceo_product._raise('P1104', 'not_found', '{"entity":"externalAttachmentRef"}'::jsonb);
    end if;
    if v_technical.preview_representation_version_id is not null and not exists (
      select 1
      from projectceo_foundation.external_representation_attestations attestation
      join projectceo_foundation.external_representation_versions representation
        on representation.organization_id = attestation.organization_id
       and representation.project_id = attestation.project_id
       and representation.package_id = attestation.package_id
       and representation.asset_version_id = attestation.asset_version_id
       and representation.representation_version_id = attestation.representation_version_id
      where attestation.organization_id = p_organization_id
        and attestation.project_id = p_project_id
        and attestation.package_id = p_package_id
        and attestation.representation_version_id = v_technical.preview_representation_version_id
        and attestation.representation_sha256 = v_technical.representation_sha256
        and attestation.confirmed_units = representation.units
        and attestation.confirmed_axes = representation.axes
    ) then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"EXTERNAL_REPRESENTATION_ATTESTATION_REQUIRED"}'::jsonb);
    end if;
    v_identity := 'technical_reference_revision:' || v_technical.technical_reference_revision_id::text;
    v_content := jsonb_build_object(
      'coordinateSpace', v_technical.coordinate_space,
      'mappingEvidenceDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_technical.mapping_evidence), 'hex'),
      'mappingMethod', v_technical.mapping_method,
      'objectRevisionId', v_technical.object_revision_id,
      'previewDigest', 'sha256:' || encode(v_technical.preview_sha256, 'hex'),
      'previewRepresentationVersionId', v_technical.preview_representation_version_id,
      'referenceAssetVersionId', v_technical.reference_asset_version_id,
      'sheetId', v_technical.sheet_id,
      'sheetRevisionId', v_technical.sheet_revision_id,
      'sourceDigest', 'sha256:' || encode(v_technical.source_sha256, 'hex'),
      'technicalReferenceRevisionId', v_technical.technical_reference_revision_id,
      'viewKind', v_technical.view_kind,
      'viewTransformDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_technical.view_transform), 'hex'),
      'xMax', v_technical.x_max, 'xMin', v_technical.x_min,
      'yMax', v_technical.y_max, 'yMin', v_technical.y_min
    );
    return jsonb_build_object(
      'refIdentity', v_identity,
      'refKind', v_kind,
      'semanticContent', v_content,
      'semanticDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_content), 'hex'),
      'technicalReferenceRevisionId', v_technical.technical_reference_revision_id
    );
  end if;

  -- The remaining accepted kind is annotation_revision. Its body and anchor
  -- payload remain protected: only their stable server digests enter a release.
  if exists (
    select 1 from jsonb_object_keys(p_requested_ref) k(value)
    where k.value not in ('kind', 'annotationRevisionId')
  ) then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"externalAttachmentRef"}'::jsonb);
  end if;
  v_uuid := projectceo_foundation._r1_external_release_ref_uuid(p_requested_ref, 'annotationRevisionId');
  select annotation.annotation_id, annotation.annotation_revision_id, annotation.revision_no,
    annotation.representation_version_id, annotation.representation_sha256,
    annotation.object_revision_id, annotation.technical_reference_revision_id,
    annotation.anchor_kind, annotation.camera, annotation.point, annotation.region,
    annotation.body, annotation.created_by_user_id
    into v_annotation
  from projectceo_foundation.external_annotation_revisions annotation
  where annotation.organization_id = p_organization_id
    and annotation.project_id = p_project_id
    and annotation.package_id = p_package_id
    and annotation.annotation_revision_id = v_uuid
  for key share;
  if not found then
    perform projectceo_product._raise('P1104', 'not_found', '{"entity":"externalAttachmentRef"}'::jsonb);
  end if;
  if v_annotation.technical_reference_revision_id is not null and not exists (
    select 1 from projectceo_foundation.technical_reference_versions technical
    where technical.organization_id = p_organization_id
      and technical.project_id = p_project_id
      and technical.package_id = p_package_id
      and technical.technical_reference_revision_id = v_annotation.technical_reference_revision_id
      and technical.status = 'confirmed'
  ) then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"ANNOTATION_TECHNICAL_REFERENCE_NOT_CONFIRMED"}'::jsonb);
  end if;
  v_identity := 'annotation_revision:' || v_annotation.annotation_revision_id::text;
  v_content := jsonb_build_object(
    'anchorDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(
      case v_annotation.anchor_kind
        when 'camera' then v_annotation.camera
        when 'point' then v_annotation.point
        else v_annotation.region
      end
    ), 'hex'),
    'anchorKind', v_annotation.anchor_kind,
    'annotationId', v_annotation.annotation_id,
    'annotationRevisionId', v_annotation.annotation_revision_id,
    'annotationRevisionNo', v_annotation.revision_no,
    'authorUserId', v_annotation.created_by_user_id,
    'bodyDigest', 'sha256:' || encode(project_intelligence._sha256_text(v_annotation.body), 'hex'),
    'objectRevisionId', v_annotation.object_revision_id,
    'representationDigest', 'sha256:' || encode(v_annotation.representation_sha256, 'hex'),
    'representationVersionId', v_annotation.representation_version_id,
    'technicalReferenceRevisionId', v_annotation.technical_reference_revision_id
  );
  return jsonb_build_object(
    'annotationRevisionId', v_annotation.annotation_revision_id,
    'refIdentity', v_identity,
    'refKind', v_kind,
    'semanticContent', v_content,
    'semanticDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_content), 'hex')
  );
end
$function$;

-- This command creates a candidate, never an approval or production version.
-- Future publication must re-resolve this exact subject and verify independent
-- design/technical decisions plus version-bound processing evidence.
create function projectceo_product_api.attach_external_release_refs(
  p_project_id uuid,
  p_package_id uuid,
  p_handoff_id text,
  p_handoff_revision_id text,
  p_candidate_refs jsonb,
  p_expected_state_revision bigint,
  p_idempotency_key text
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context record;
  v_state bigint;
  v_key bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_handoff projectceo_product.m2_workspace_revisions;
  v_ref jsonb;
  v_resolved jsonb;
  v_refs jsonb := '[]'::jsonb;
  v_semantic jsonb;
  v_digest bytea;
  v_submission_id uuid := extensions.gen_random_uuid();
  v_ordinal bigint := 0;
  v_technical_id uuid;
  v_sheet_handoff_id text;
  v_sheet_handoff_revision_id text;
begin
  -- Same existing authority as M3 sheet authoring. Actor and tenancy are never
  -- accepted from the request body, including on idempotent replays.
  select * into v_context from projectceo_foundation._authorize_package_human(
    p_project_id, p_package_id, 'prepare_client_handoff'
  );
  perform projectceo_product._assert_text(p_handoff_id, 'handoffId', 160);
  perform projectceo_product._assert_text(p_handoff_revision_id, 'handoffRevisionId', 160);
  perform projectceo_foundation._assert_state_revision(p_expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(p_idempotency_key);
  if p_package_id is null or p_candidate_refs is null
    or jsonb_typeof(p_candidate_refs) is distinct from 'array' then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"candidateRefs"}');
  end if;
  if jsonb_array_length(p_candidate_refs) not between 1 and 2000
    or octet_length(p_candidate_refs::text) > 1000000 then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"candidateRefs","reason":"REF_LIMIT"}');
  end if;
  v_key := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'actorUserId', v_context.actor_user_id, 'projectId', p_project_id,
    'packageId', p_package_id, 'handoffId', p_handoff_id,
    'handoffRevisionId', p_handoff_revision_id, 'candidateRefs', p_candidate_refs,
    'expectedStateRevision', p_expected_state_revision
  ));
  select workflow.state_revision into v_state
  from project_intelligence.project_workflows workflow
  where workflow.organization_id = v_context.organization_id and workflow.project_id = p_project_id
  for update;
  if exists (
    select 1 from projectceo_product.command_records command
    where command.organization_id = v_context.organization_id and command.project_id = p_project_id
      and command.operation = 'attach_external_release_refs' and command.key_digest = v_key
      and command.actor_user_id is distinct from v_context.actor_user_id
  ) then
    perform projectceo_product._raise('P1103', 'forbidden', '{"reason":"IDEMPOTENCY_ACTOR_MISMATCH"}');
  end if;
  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id, p_project_id, 'attach_external_release_refs', v_key, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state is distinct from p_expected_state_revision then
    perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentStateRevision', v_state));
  end if;
  v_handoff := projectceo_m3._require_published_handoff(
    v_context.organization_id, p_project_id, p_package_id, p_handoff_id, p_handoff_revision_id
  );
  for v_ref in select value from jsonb_array_elements(p_candidate_refs) loop
    v_resolved := projectceo_foundation.resolve_r1_external_release_attachment_ref(
      v_context.organization_id, p_project_id, p_package_id, v_ref
    );
    if v_resolved->>'refKind' = 'documentation_sheet_revision'
      and ((v_resolved#>>'{semanticContent,handoffId}') is distinct from p_handoff_id
        or (v_resolved#>>'{semanticContent,handoffRevisionId}') is distinct from p_handoff_revision_id) then
      perform projectceo_product._raise('P1109', 'scope_conflict', '{"reason":"SHEET_HANDOFF_MISMATCH"}');
    end if;
    v_technical_id := case v_resolved->>'refKind'
      when 'technical_reference_revision' then (v_resolved->>'technicalReferenceRevisionId')::uuid
      when 'annotation_revision' then (v_resolved#>>'{semanticContent,technicalReferenceRevisionId}')::uuid
      else null end;
    if v_technical_id is not null then
      select sheet.handoff_id, sheet.handoff_revision_id
        into v_sheet_handoff_id, v_sheet_handoff_revision_id
      from projectceo_foundation.technical_reference_versions technical
      join projectceo_m3.documentation_sheet_revisions sheet
        on sheet.organization_id = technical.organization_id and sheet.project_id = technical.project_id
        and sheet.package_id = technical.package_id and sheet.sheet_id = technical.sheet_id
        and sheet.revision_id = technical.sheet_revision_id
      where technical.organization_id = v_context.organization_id and technical.project_id = p_project_id
        and technical.package_id = p_package_id and technical.technical_reference_revision_id = v_technical_id;
      if not found or v_sheet_handoff_id is distinct from p_handoff_id
        or v_sheet_handoff_revision_id is distinct from p_handoff_revision_id then
        perform projectceo_product._raise('P1109', 'scope_conflict', '{"reason":"SHEET_HANDOFF_MISMATCH"}');
      end if;
    end if;
    if exists (select 1 from jsonb_array_elements(v_refs) prior
      where prior->>'refIdentity' = v_resolved->>'refIdentity') then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"DUPLICATE_EXTERNAL_REF"}');
    end if;
    v_refs := v_refs || jsonb_build_array(v_resolved);
  end loop;
  select jsonb_agg(value order by (value->>'refIdentity') collate "C") into v_refs
  from jsonb_array_elements(v_refs);
  v_semantic := jsonb_build_object(
    'schemaVersion', 'archidom.external-review-subject/0.1',
    'organizationId', v_context.organization_id, 'projectId', p_project_id,
    'packageId', p_package_id, 'handoffId', p_handoff_id,
    'handoffRevisionId', p_handoff_revision_id,
    'handoffDigest', 'sha256:' || encode(project_intelligence._sha256_jsonb(v_handoff.payload), 'hex'),
    'refs', v_refs
  );
  v_digest := project_intelligence._sha256_jsonb(v_semantic);
  insert into projectceo_foundation.external_release_attachment_submissions (
    organization_id, project_id, package_id, external_attachment_submission_id,
    handoff_id, handoff_revision_id, review_subject_digest, schema_version,
    semantic_content, semantic_digest, created_by_user_id
  ) values (
    v_context.organization_id, p_project_id, p_package_id, v_submission_id,
    p_handoff_id, p_handoff_revision_id, v_digest, 'archidom.external-release-attachments/0.2',
    v_semantic, v_digest, v_context.actor_user_id
  );
  for v_resolved in select value from jsonb_array_elements(v_refs) loop
    insert into projectceo_foundation.external_release_attachment_submission_refs (
      organization_id, project_id, package_id, external_attachment_submission_id,
      ordinal, ref_kind, ref_identity, asset_version_id, representation_version_id,
      sheet_id, sheet_revision_id, object_representation_binding_id,
      technical_reference_revision_id, annotation_revision_id, semantic_content, semantic_digest
    ) values (
      v_context.organization_id, p_project_id, p_package_id, v_submission_id,
      v_ordinal, v_resolved->>'refKind', v_resolved->>'refIdentity',
      (v_resolved->>'assetVersionId')::uuid, (v_resolved->>'representationVersionId')::uuid,
      v_resolved->>'sheetId', v_resolved->>'sheetRevisionId',
      (v_resolved->>'objectRepresentationBindingId')::uuid,
      (v_resolved->>'technicalReferenceRevisionId')::uuid, (v_resolved->>'annotationRevisionId')::uuid,
      v_resolved->'semanticContent', decode(substr(v_resolved->>'semanticDigest', 8), 'hex')
    );
    v_ordinal := v_ordinal + 1;
  end loop;
  return projectceo_product._complete_command(
    v_context.organization_id, p_project_id, 'attach_external_release_refs', v_key, v_request_digest,
    'human', v_context.actor_id, v_context.actor_user_id,
    jsonb_build_object('submissionId', v_submission_id, 'subjectDigest', 'sha256:' || encode(v_digest, 'hex'),
      'status', 'candidate', 'refCount', v_ordinal), 'external_release_refs_attached',
    jsonb_build_object('submission_id', v_submission_id, 'package_id', p_package_id, 'ref_count', v_ordinal), v_state
  );
end
$function$;

-- Frozen content must agree with both the immutable candidate and the actual
-- package version. A plain 0.1 release cannot acquire an external sidecar later.
create function projectceo_foundation.assert_r1_external_manifest_package()
returns trigger language plpgsql set search_path = ''
as $function$
declare
  v_release projectceo_product.production_package_versions;
  v_submission projectceo_foundation.external_release_attachment_submissions;
begin
  select * into v_release from projectceo_product.production_package_versions
  where organization_id = new.organization_id and project_id = new.project_id
    and production_package_version_id = new.production_package_version_id;
  if not found or v_release.package_id is distinct from new.package_id then
    raise exception 'R1_EXTERNAL_MANIFEST_PACKAGE_MISMATCH';
  end if;
  select * into v_submission from projectceo_foundation.external_release_attachment_submissions
  where organization_id = new.organization_id and project_id = new.project_id
    and package_id = new.package_id and external_attachment_submission_id = new.external_attachment_submission_id;
  if not found or v_submission.handoff_id is distinct from new.handoff_id
    or v_submission.handoff_revision_id is distinct from new.handoff_revision_id
    or v_submission.review_subject_digest is distinct from new.approved_snapshot_digest
    or new.semantic_digest is distinct from project_intelligence._sha256_jsonb(new.semantic_content)
    or (v_release.semantic_content->>'schemaVersion') is distinct from 'project-ceo-production-package/0.2'
    or (v_release.semantic_content->>'externalAttachmentManifestDigest') is distinct from 'sha256:' || encode(new.semantic_digest, 'hex')
    or v_release.semantic_digest is distinct from project_intelligence._sha256_jsonb(v_release.semantic_content) then
    raise exception 'R1_EXTERNAL_MANIFEST_DIGEST_MISMATCH';
  end if;
  return new;
end
$function$;
create trigger external_release_attachment_manifests_package
before insert on projectceo_foundation.external_release_attachment_manifests
for each row execute function projectceo_foundation.assert_r1_external_manifest_package();

-- A 0.2 release and its manifest must be committed together. The old 0.1
-- publication/read path does not enter this constraint's branch.
create function projectceo_foundation.require_r1_manifest_at_release_commit()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  -- Deferred triggers execute at COMMIT, outside the publisher's definer
  -- context. The private table owner checks this invariant without granting
  -- the authenticated caller direct access to Foundation.
  if new.semantic_content->>'schemaVersion' is distinct from 'project-ceo-production-package/0.2' then
    return new;
  end if;
  if not exists (
    select 1 from projectceo_foundation.external_release_attachment_manifests manifest
    where manifest.organization_id = new.organization_id and manifest.project_id = new.project_id
      and manifest.package_id = new.package_id
      and manifest.production_package_version_id = new.production_package_version_id
      and new.semantic_content->>'externalAttachmentManifestDigest' = 'sha256:' || encode(manifest.semantic_digest, 'hex')
  ) then
    raise exception 'R1_EXTERNAL_MANIFEST_ATOMIC_BINDING_REQUIRED';
  end if;
  return new;
end
$function$;
create constraint trigger production_package_versions_r1_manifest
after insert on projectceo_product.production_package_versions
deferrable initially deferred for each row
execute function projectceo_foundation.require_r1_manifest_at_release_commit();

alter function projectceo_foundation.assert_r1_external_manifest_package() owner to pi_table_owner;
alter function projectceo_foundation.require_r1_manifest_at_release_commit() owner to pi_table_owner;
revoke all on function projectceo_foundation.assert_r1_external_manifest_package()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_foundation.require_r1_manifest_at_release_commit()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

alter function projectceo_product_api.attach_external_release_refs(uuid, uuid, text, text, jsonb, bigint, text) owner to pi_table_owner;
revoke all on function projectceo_product_api.attach_external_release_refs(uuid, uuid, text, text, jsonb, bigint, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke execute on function
  projectceo_product_api.attach_external_release_refs(uuid, uuid, text, text, jsonb, bigint, text)
from authenticated;

-- Candidate composition is M3 authoring. The existing module switch owns its
-- grant, exactly as it owns native sheet authoring and request-bound release.
-- Preserve all current M3/M4 entries and the private registry's owner/ACL.
do $r1_candidate_m3_module$
declare
  v_m3 text[] := projectceo_platform._module_signatures('m3');
  v_m4 text[] := projectceo_platform._module_signatures('m4_increment_1');
  v_signature text := 'projectceo_product_api.attach_external_release_refs(uuid, uuid, text, text, jsonb, bigint, text)';
  v_owner oid;
  v_acl aclitem[];
begin
  select proowner, proacl into strict v_owner, v_acl from pg_catalog.pg_proc
  where oid = 'projectceo_platform._module_signatures(text)'::regprocedure;
  execute $definition$
    create or replace function projectceo_platform._module_signatures(p_module text)
    returns text[] language sql immutable security definer set search_path = '' as $function$
      select case p_module
        when 'm3' then array[
          'projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)',
          'projectceo_product_api.publish_release_request_bound(uuid, text, text, bigint, text, text)',
          'projectceo_product_api.publish_work_package_release_request_bound(uuid, uuid, text, text, bigint, text, text)',
          'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
          'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
          'projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)',
          'projectceo_product_api.attach_external_release_refs(uuid, uuid, text, text, jsonb, bigint, text)'
        ]
        when 'm4_increment_1' then array[
          'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)',
          'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)',
          'projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)',
          'projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text)'
        ] else null end;
    $function$;
  $definition$;
  if projectceo_platform._module_signatures('m3') is distinct from v_m3 || array[v_signature]
    or projectceo_platform._module_signatures('m4_increment_1') is distinct from v_m4
    or exists (
      select 1 from pg_catalog.pg_proc
      where oid = 'projectceo_platform._module_signatures(text)'::regprocedure
        and (proowner is distinct from v_owner or proacl is distinct from v_acl)
    ) then
    raise exception 'R1_M3_MODULE_SIGNATURE_OR_PRIVILEGE_CHANGED';
  end if;
end
$r1_candidate_m3_module$;

alter function projectceo_foundation._r1_external_release_ref_uuid(jsonb, text) owner to pi_table_owner;
alter function projectceo_foundation.resolve_r1_external_release_attachment_ref(uuid, uuid, uuid, jsonb) owner to pi_table_owner;
revoke all on function projectceo_foundation._r1_external_release_ref_uuid(jsonb, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_foundation.resolve_r1_external_release_attachment_ref(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

do $r1_external_manifest_security$
declare v_table text;
begin
  foreach v_table in array array[
    'external_release_attachment_submissions',
    'external_release_attachment_submission_refs',
    'external_release_attachment_manifests',
    'external_release_attachment_manifest_refs'
  ] loop
    execute format('create trigger %I before update or delete on projectceo_foundation.%I for each row execute function projectceo_foundation.reject_append_only_mutation()', v_table || '_append_only', v_table);
    execute format('alter table projectceo_foundation.%I owner to pi_table_owner', v_table);
    execute format('alter table projectceo_foundation.%I enable row level security', v_table);
    execute format('alter table projectceo_foundation.%I force row level security', v_table);
    execute format('revoke all on table projectceo_foundation.%I from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor', v_table);
    execute format('create policy %I on projectceo_foundation.%I for all to pi_table_owner using (true) with check (true)', v_table || '_owner_only', v_table);
  end loop;
end
$r1_external_manifest_security$;

commit;
