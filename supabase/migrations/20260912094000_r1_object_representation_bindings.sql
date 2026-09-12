begin;
set local search_path = pg_catalog, projectceo_foundation, extensions;

-- R1 logical ProjectObject records are private, package-scoped identities.
-- They deliberately do not reuse generic Project Links or legacy public rooms:
-- both lack an immutable, package-scoped representation contract.
create table projectceo_foundation.project_objects (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  object_id uuid not null default extensions.gen_random_uuid(),
  object_key text not null check (char_length(btrim(object_key)) between 1 and 160 and object_key = btrim(object_key)),
  object_kind text not null check (object_kind in ('room_area', 'fixed_element', 'equipment', 'finish', 'other')),
  room_entity_id text not null check (char_length(btrim(room_entity_id)) between 1 and 160 and room_entity_id = btrim(room_entity_id)),
  protected_name text not null check (char_length(btrim(protected_name)) between 1 and 400 and protected_name = btrim(protected_name)),
  identification_origin text not null check (identification_origin in ('manual', 'dwg', 'skp', 'hybrid')),
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, object_id),
  unique (organization_id, project_id, package_id, object_key),
  foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (organization_id, project_id, id) on delete restrict,
  foreign key (organization_id, created_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict
);

create table projectceo_foundation.project_object_revisions (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  object_id uuid not null,
  object_revision_id uuid not null default extensions.gen_random_uuid(),
  revision_no bigint not null check (revision_no between 1 and 9007199254740991),
  supersedes_object_revision_id uuid,
  room_entity_id text not null check (char_length(btrim(room_entity_id)) between 1 and 160 and room_entity_id = btrim(room_entity_id)),
  room_revision_id text not null check (char_length(btrim(room_revision_id)) between 1 and 160 and room_revision_id = btrim(room_revision_id)),
  semantic_payload jsonb not null check (jsonb_typeof(semantic_payload) = 'object'),
  explicit_unknowns jsonb not null default '[]'::jsonb check (jsonb_typeof(explicit_unknowns) = 'array'),
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, object_revision_id),
  unique (organization_id, project_id, package_id, object_id, revision_no),
  unique (organization_id, project_id, package_id, object_id, object_revision_id),
  foreign key (organization_id, project_id, package_id, object_id)
    references projectceo_foundation.project_objects (organization_id, project_id, package_id, object_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, object_id, supersedes_object_revision_id)
    references projectceo_foundation.project_object_revisions (organization_id, project_id, package_id, object_id, object_revision_id) on delete restrict,
  foreign key (organization_id, created_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict,
  check (
    (revision_no = 1 and supersedes_object_revision_id is null)
    or (revision_no > 1 and supersedes_object_revision_id is not null)
  )
);

create function projectceo_foundation.assert_r1_object_room_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from projectceo_product.m2_workspace_revisions revision
    where revision.organization_id = new.organization_id
      and revision.project_id = new.project_id
      and revision.package_id = new.package_id
      and revision.entity_kind = 'room'
      and revision.entity_id = new.room_entity_id
  ) then
    raise exception 'R1_OBJECT_ROOM_SCOPE_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger project_objects_room_scope
before insert on projectceo_foundation.project_objects
for each row execute function projectceo_foundation.assert_r1_object_room_scope();

-- Existing M2 revisions have a project-wide primary key, not a package-scoped
-- one. The trigger below enforces exact room identity, kind and package scope.
create function projectceo_foundation.assert_r1_object_revision_room_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_room_package_id uuid;
  v_stable_room_entity_id text;
begin
  select revision.package_id into v_room_package_id
  from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = new.organization_id
    and revision.project_id = new.project_id
    and revision.entity_kind = 'room'
    and revision.entity_id = new.room_entity_id
    and revision.revision_id = new.room_revision_id;

  select object.room_entity_id into v_stable_room_entity_id
  from projectceo_foundation.project_objects object
  where object.organization_id = new.organization_id
    and object.project_id = new.project_id
    and object.package_id = new.package_id
    and object.object_id = new.object_id;

  if not found
    or v_room_package_id is distinct from new.package_id
    or v_stable_room_entity_id is distinct from new.room_entity_id then
    raise exception 'R1_OBJECT_ROOM_SCOPE_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger project_object_revisions_room_scope
before insert on projectceo_foundation.project_object_revisions
for each row execute function projectceo_foundation.assert_r1_object_revision_room_scope();

create table projectceo_foundation.project_object_material_references (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  object_revision_id uuid not null,
  material_entity_id text not null check (char_length(btrim(material_entity_id)) between 1 and 160 and material_entity_id = btrim(material_entity_id)),
  material_revision_id text not null check (char_length(btrim(material_revision_id)) between 1 and 160 and material_revision_id = btrim(material_revision_id)),
  relation_kind text not null check (relation_kind in ('primary_material', 'finish', 'component')),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, object_revision_id, material_entity_id, material_revision_id, relation_kind),
  foreign key (organization_id, project_id, package_id, object_revision_id)
    references projectceo_foundation.project_object_revisions (organization_id, project_id, package_id, object_revision_id) on delete restrict,
  foreign key (organization_id, created_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict
);

create function projectceo_foundation.assert_r1_object_material_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_material_package_id uuid;
begin
  select revision.package_id into v_material_package_id
  from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = new.organization_id
    and revision.project_id = new.project_id
    and revision.entity_kind = 'material'
    and revision.entity_id = new.material_entity_id
    and revision.revision_id = new.material_revision_id;

  if not found or v_material_package_id is distinct from new.package_id then
    raise exception 'R1_OBJECT_MATERIAL_SCOPE_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger project_object_material_references_scope
before insert on projectceo_foundation.project_object_material_references
for each row execute function projectceo_foundation.assert_r1_object_material_scope();

-- A node index is evidence for a converted representation, not a stable object
-- identifier. Bindings carry the exact node path and mapping evidence as well.
create table projectceo_foundation.external_representation_node_index (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  representation_version_id uuid not null,
  node_key text not null check (char_length(btrim(node_key)) between 1 and 512 and node_key = btrim(node_key)),
  node_path text not null check (char_length(btrim(node_path)) between 1 and 4096 and node_path = btrim(node_path)),
  node_metadata jsonb not null check (jsonb_typeof(node_metadata) = 'object'),
  indexed_by_user_id uuid not null,
  indexed_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, representation_version_id, node_key),
  foreign key (organization_id, project_id, package_id, representation_version_id)
    references projectceo_foundation.external_representation_versions (organization_id, project_id, package_id, representation_version_id) on delete restrict,
  foreign key (organization_id, indexed_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict
);

create table projectceo_foundation.object_representation_bindings (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  binding_id uuid not null default extensions.gen_random_uuid(),
  object_revision_id uuid not null,
  representation_version_id uuid not null,
  node_key text not null,
  node_path text not null check (char_length(btrim(node_path)) between 1 and 4096 and node_path = btrim(node_path)),
  mapping_transform jsonb not null check (jsonb_typeof(mapping_transform) = 'object'),
  mapping_method text not null check (char_length(btrim(mapping_method)) between 3 and 160 and mapping_method = btrim(mapping_method)),
  mapping_evidence jsonb not null check (jsonb_typeof(mapping_evidence) = 'object'),
  mapped_by_user_id uuid not null,
  causation_id text not null check (char_length(btrim(causation_id)) between 1 and 160 and causation_id = btrim(causation_id)),
  request_id text not null check (char_length(btrim(request_id)) between 1 and 160 and request_id = btrim(request_id)),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, binding_id),
  unique (organization_id, project_id, package_id, object_revision_id, representation_version_id, node_key),
  foreign key (organization_id, project_id, package_id, object_revision_id)
    references projectceo_foundation.project_object_revisions (organization_id, project_id, package_id, object_revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, representation_version_id, node_key)
    references projectceo_foundation.external_representation_node_index (organization_id, project_id, package_id, representation_version_id, node_key) on delete restrict,
  foreign key (organization_id, mapped_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict
);

create function projectceo_foundation.assert_r1_binding_node_path()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_indexed_path text;
begin
  select node_path into v_indexed_path
  from projectceo_foundation.external_representation_node_index
  where organization_id = new.organization_id
    and project_id = new.project_id
    and package_id = new.package_id
    and representation_version_id = new.representation_version_id
    and node_key = new.node_key;

  if not found or v_indexed_path is distinct from new.node_path then
    raise exception 'R1_BINDING_NODE_PATH_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger object_representation_bindings_node_path
before insert on projectceo_foundation.object_representation_bindings
for each row execute function projectceo_foundation.assert_r1_binding_node_path();

create table projectceo_foundation.technical_reference_versions (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  technical_reference_id uuid not null,
  technical_reference_revision_id uuid not null default extensions.gen_random_uuid(),
  revision_no bigint not null check (revision_no between 1 and 9007199254740991),
  supersedes_technical_reference_revision_id uuid,
  status text not null check (status in ('candidate', 'confirmed')),
  object_revision_id uuid not null,
  sheet_id text not null check (char_length(btrim(sheet_id)) between 1 and 160 and sheet_id = btrim(sheet_id)),
  sheet_revision_id text not null check (char_length(btrim(sheet_revision_id)) between 1 and 160 and sheet_revision_id = btrim(sheet_revision_id)),
  reference_asset_version_id uuid not null,
  preview_sha256 bytea not null check (octet_length(preview_sha256) = 32),
  view_kind text not null check (view_kind in ('plan', 'section', 'elevation', 'detail', 'schedule')),
  coordinate_space text not null check (coordinate_space in ('sheet_mm', 'model_mm', 'normalized')),
  x_min numeric not null,
  y_min numeric not null,
  x_max numeric not null,
  y_max numeric not null,
  mapping_method text not null check (char_length(btrim(mapping_method)) between 3 and 160 and mapping_method = btrim(mapping_method)),
  mapping_evidence jsonb not null check (jsonb_typeof(mapping_evidence) = 'object'),
  created_by_user_id uuid not null,
  confirmed_by_user_id uuid,
  confirmed_at timestamptz,
  causation_id text not null check (char_length(btrim(causation_id)) between 1 and 160 and causation_id = btrim(causation_id)),
  request_id text not null check (char_length(btrim(request_id)) between 1 and 160 and request_id = btrim(request_id)),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, technical_reference_revision_id),
  unique (organization_id, project_id, package_id, technical_reference_id, revision_no),
  unique (organization_id, project_id, package_id, technical_reference_id, technical_reference_revision_id),
  foreign key (organization_id, project_id, package_id, object_revision_id)
    references projectceo_foundation.project_object_revisions (organization_id, project_id, package_id, object_revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, technical_reference_id, supersedes_technical_reference_revision_id)
    references projectceo_foundation.technical_reference_versions (organization_id, project_id, package_id, technical_reference_id, technical_reference_revision_id) on delete restrict,
  foreign key (organization_id, project_id, sheet_id, sheet_revision_id)
    references projectceo_m3.documentation_sheet_revisions (organization_id, project_id, sheet_id, revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, reference_asset_version_id)
    references projectceo_foundation.external_asset_versions (organization_id, project_id, package_id, asset_version_id) on delete restrict,
  foreign key (organization_id, created_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict,
  foreign key (organization_id, confirmed_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict,
  check (x_min < x_max and y_min < y_max),
  check (
    (revision_no = 1 and supersedes_technical_reference_revision_id is null)
    or (revision_no > 1 and supersedes_technical_reference_revision_id is not null)
  ),
  check (
    (status = 'candidate' and confirmed_by_user_id is null and confirmed_at is null)
    or (status = 'confirmed' and confirmed_by_user_id is not null and confirmed_at is not null)
  )
);

create table projectceo_foundation.technical_reference_events (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  technical_reference_revision_id uuid not null,
  event_id uuid not null default extensions.gen_random_uuid(),
  sequence_no bigint not null check (sequence_no > 0),
  event_type text not null check (event_type in ('candidate_created', 'needs_reconfirmation', 'confirmed')),
  actor_type text not null check (actor_type in ('human', 'system')),
  actor_id text not null check (char_length(btrim(actor_id)) between 1 and 160 and actor_id = btrim(actor_id)),
  actor_user_id uuid,
  causation_id text not null check (char_length(btrim(causation_id)) between 1 and 160 and causation_id = btrim(causation_id)),
  request_id text not null check (char_length(btrim(request_id)) between 1 and 160 and request_id = btrim(request_id)),
  occurred_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, event_id),
  unique (organization_id, project_id, package_id, technical_reference_revision_id, sequence_no),
  foreign key (organization_id, project_id, package_id, technical_reference_revision_id)
    references projectceo_foundation.technical_reference_versions (organization_id, project_id, package_id, technical_reference_revision_id) on delete restrict,
  foreign key (organization_id, actor_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict,
  check (
    (actor_type = 'human' and actor_user_id is not null)
    or (actor_type = 'system' and actor_user_id is null)
  )
);

create function projectceo_foundation.assert_r1_technical_reference_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_sheet_package_id uuid;
  v_asset_format text;
begin
  select revision.package_id into v_sheet_package_id
  from projectceo_m3.documentation_sheet_revisions revision
  where revision.organization_id = new.organization_id
    and revision.project_id = new.project_id
    and revision.sheet_id = new.sheet_id
    and revision.revision_id = new.sheet_revision_id;

  select asset_version.validated_format into v_asset_format
  from projectceo_foundation.external_asset_versions asset_version
  where asset_version.organization_id = new.organization_id
    and asset_version.project_id = new.project_id
    and asset_version.package_id = new.package_id
    and asset_version.asset_version_id = new.reference_asset_version_id;

  if not found or v_sheet_package_id is distinct from new.package_id
    or v_asset_format not in ('dwg', 'pdf') then
    raise exception 'R1_TECHNICAL_REFERENCE_SCOPE_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger technical_reference_versions_scope
before insert on projectceo_foundation.technical_reference_versions
for each row execute function projectceo_foundation.assert_r1_technical_reference_scope();

create function projectceo_foundation.assert_r1_technical_reference_event()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_required_event text;
begin
  v_required_event := case new.status
    when 'candidate' then 'needs_reconfirmation'
    when 'confirmed' then 'confirmed'
  end;

  if not exists (
    select 1
    from projectceo_foundation.technical_reference_events event
    where event.organization_id = new.organization_id
      and event.project_id = new.project_id
      and event.package_id = new.package_id
      and event.technical_reference_revision_id = new.technical_reference_revision_id
      and event.event_type = v_required_event
  ) then
    raise exception 'R1_TECHNICAL_REFERENCE_EVENT_MISSING';
  end if;
  return new;
end
$function$;

create constraint trigger technical_reference_versions_required_event
after insert on projectceo_foundation.technical_reference_versions
deferrable initially deferred
for each row execute function projectceo_foundation.assert_r1_technical_reference_event();

do $r1_object_binding_security$
declare
  v_table text;
begin
  foreach v_table in array array[
    'project_objects', 'project_object_revisions', 'project_object_material_references',
    'external_representation_node_index', 'object_representation_bindings',
    'technical_reference_versions', 'technical_reference_events'
  ] loop
    execute format('create trigger %I before update or delete on projectceo_foundation.%I for each row execute function projectceo_foundation.reject_append_only_mutation()', v_table || '_append_only', v_table);
    execute format('alter table projectceo_foundation.%I owner to pi_table_owner', v_table);
    execute format('alter table projectceo_foundation.%I enable row level security', v_table);
    execute format('alter table projectceo_foundation.%I force row level security', v_table);
    execute format('revoke all on table projectceo_foundation.%I from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor', v_table);
    execute format('create policy %I on projectceo_foundation.%I for all to pi_table_owner using (true) with check (true)', v_table || '_owner_only', v_table);
  end loop;
end
$r1_object_binding_security$;

alter function projectceo_foundation.assert_r1_object_revision_room_scope() owner to pi_table_owner;
alter function projectceo_foundation.assert_r1_object_room_scope() owner to pi_table_owner;
alter function projectceo_foundation.assert_r1_object_material_scope() owner to pi_table_owner;
alter function projectceo_foundation.assert_r1_binding_node_path() owner to pi_table_owner;
alter function projectceo_foundation.assert_r1_technical_reference_scope() owner to pi_table_owner;
alter function projectceo_foundation.assert_r1_technical_reference_event() owner to pi_table_owner;
revoke all on function projectceo_foundation.assert_r1_object_revision_room_scope() from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_foundation.assert_r1_object_room_scope() from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_foundation.assert_r1_object_material_scope() from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_foundation.assert_r1_binding_node_path() from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_foundation.assert_r1_technical_reference_scope() from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_foundation.assert_r1_technical_reference_event() from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

commit;
