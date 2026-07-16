-- ProjectCEO RU Foundation: sanitized inventory, Storage authorization,
-- atomic initial graph ingestion and narrow versioned read projections.

begin;

set check_function_bodies = on;

alter table projectceo_foundation.command_records
  drop constraint command_records_operation_check;
alter table projectceo_foundation.command_records
  add constraint command_records_operation_check
  check (operation in (
    'enroll_organization_project',
    'create_invitation',
    'accept_invitation',
    'revoke_invitation',
    'expire_invitation',
    'create_guest_access_grant',
    'revoke_guest_access_grant',
    'register_source_inventory',
    'ingest_source_graph'
  ));

create table projectceo_foundation.source_inventory_records (
  organization_id uuid not null,
  project_id uuid not null,
  physical_record_id uuid not null,
  package_id uuid not null,
  sanitized_name text not null
    check (
      char_length(btrim(sanitized_name)) between 1 and 500
      and sanitized_name = btrim(sanitized_name)
      and sanitized_name !~ '[/\\]'
    ),
  floor_key text not null
    check (
      char_length(btrim(floor_key)) between 1 and 160
      and floor_key = btrim(floor_key)
    ),
  zone_key text not null
    check (
      char_length(btrim(zone_key)) between 1 and 160
      and zone_key = btrim(zone_key)
    ),
  discipline_key text not null
    check (
      char_length(btrim(discipline_key)) between 1 and 160
      and discipline_key = btrim(discipline_key)
    ),
  availability text not null
    check (availability in ('materialized', 'placeholder')),
  document_status text not null
    check (document_status in ('current', 'previous', 'reference', 'unknown')),
  size_bytes bigint
    check (
      size_bytes is null
      or size_bytes between 0 and 9007199254740991
    ),
  checksum bytea check (checksum is null or octet_length(checksum) = 32),
  source_revision_id text
    check (
      source_revision_id is null
      or (
        char_length(btrim(source_revision_id)) between 1 and 160
        and source_revision_id = btrim(source_revision_id)
      )
    ),
  logical_source_id text
    check (
      logical_source_id is null
      or (
        char_length(btrim(logical_source_id)) between 1 and 160
        and logical_source_id = btrim(logical_source_id)
      )
    ),
  semantic_conflict boolean not null default false,
  registered_by_user_id uuid not null,
  registered_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, physical_record_id),
  constraint source_inventory_records_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint source_inventory_records_actor_fkey
    foreign key (organization_id, project_id, registered_by_user_id)
    references projectceo_foundation.project_memberships (
      organization_id,
      project_id,
      user_id
    )
    on delete restrict,
  constraint source_inventory_records_materialization_check
    check (
      (
        availability = 'placeholder'
        and size_bytes is null
        and checksum is null
        and source_revision_id is null
        and logical_source_id is null
      )
      or (
        availability = 'materialized'
        and size_bytes is not null
        and checksum is not null
        and source_revision_id is not null
        and logical_source_id is not null
      )
    )
);

create index source_inventory_records_package_idx
  on projectceo_foundation.source_inventory_records (
    organization_id,
    project_id,
    package_id,
    document_status
  );
create index source_inventory_records_checksum_idx
  on projectceo_foundation.source_inventory_records (
    organization_id,
    project_id,
    checksum
  )
  where checksum is not null;
create index source_inventory_records_actor_idx
  on projectceo_foundation.source_inventory_records (
    organization_id,
    project_id,
    registered_by_user_id
  );

create table projectceo_foundation.source_protected_metadata (
  organization_id uuid not null,
  project_id uuid not null,
  source_id text not null,
  package_id uuid not null,
  original_filename text not null
    check (
      char_length(btrim(original_filename)) between 1 and 1024
      and original_filename = btrim(original_filename)
    ),
  media_type text not null
    check (
      char_length(btrim(media_type)) between 1 and 255
      and media_type = lower(btrim(media_type))
    ),
  size_bytes bigint not null
    check (size_bytes between 1 and 9007199254740991),
  extension text not null
    check (
      extension = lower(btrim(extension))
      and extension ~ '^[a-z0-9]{1,12}$'
    ),
  source_role text not null check (source_role in (
    'document',
    'drawing-preview',
    'reference',
    'photo-evidence',
    'correspondence',
    'schedule'
  )),
  declared_revision text,
  document_status text not null
    check (document_status in ('current', 'previous', 'reference', 'unknown')),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, source_id),
  constraint source_protected_metadata_source_fkey
    foreign key (organization_id, project_id, source_id)
    references project_intelligence.sources (
      organization_id,
      project_id,
      source_id
    )
    on delete restrict,
  constraint source_protected_metadata_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict
);

create index source_protected_metadata_package_idx
  on projectceo_foundation.source_protected_metadata (
    organization_id,
    project_id,
    package_id
  );

create table projectceo_foundation.source_ingestions (
  organization_id uuid not null,
  project_id uuid not null,
  ingestion_id uuid not null default extensions.gen_random_uuid(),
  source_id text not null,
  package_id uuid not null,
  fragment_count bigint not null
    check (fragment_count between 0 and 9007199254740991),
  node_count bigint not null
    check (node_count between 0 and 9007199254740991),
  revision_count bigint not null
    check (revision_count between 0 and 9007199254740991),
  evidence_link_count bigint not null
    check (evidence_link_count between 0 and 9007199254740991),
  edge_count bigint not null
    check (edge_count between 0 and 9007199254740991),
  status text not null check (status = 'ready'),
  actor_user_id uuid not null,
  completed_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, ingestion_id),
  constraint source_ingestions_source_fkey
    foreign key (organization_id, project_id, source_id)
    references project_intelligence.sources (
      organization_id,
      project_id,
      source_id
    )
    on delete restrict,
  constraint source_ingestions_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint source_ingestions_actor_fkey
    foreign key (organization_id, project_id, actor_user_id)
    references projectceo_foundation.project_memberships (
      organization_id,
      project_id,
      user_id
    )
    on delete restrict,
  constraint source_ingestions_one_ready_source_key
    unique (organization_id, project_id, source_id)
);

create index source_ingestions_package_idx
  on projectceo_foundation.source_ingestions (
    organization_id,
    project_id,
    package_id
  );
create index source_ingestions_actor_idx
  on projectceo_foundation.source_ingestions (
    organization_id,
    project_id,
    actor_user_id
  );

create function projectceo_foundation._assert_sha256_hex(
  p_value text,
  p_field text
)
returns bytea
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_value is null or p_value !~ '^[a-f0-9]{64}$' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  return decode(p_value, 'hex');
end
$function$;

create function projectceo_foundation._assert_safe_integer(
  p_value numeric,
  p_field text,
  p_allow_zero boolean default true
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_value is null
     or trunc(p_value) <> p_value
     or p_value > 9007199254740991
     or (p_allow_zero and p_value < 0)
     or (not p_allow_zero and p_value <= 0) then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  return p_value::bigint;
end
$function$;

create function projectceo_foundation._source_policy(
  p_media_type text,
  p_extension text,
  p_size_bytes bigint,
  p_source_role text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_media text := lower(btrim(coalesce(p_media_type, '')));
  v_extension text := lower(btrim(coalesce(p_extension, '')));
  v_max_bytes bigint;
begin
  if v_extension in ('dwg', 'dxf', 'rar', 'zip', '7z', 'tar', 'gz') then
    perform projectceo_foundation._raise(
      'P1110',
      'unsupported_source',
      '{"reason":"RAW_CAD_OR_ARCHIVE_REQUIRES_PREPROCESSING"}'::jsonb
    );
  end if;
  if p_source_role not in (
    'document',
    'drawing-preview',
    'reference',
    'photo-evidence',
    'correspondence',
    'schedule'
  ) then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"sourceRole"}'::jsonb
    );
  end if;

  v_max_bytes := case
    when v_media = 'application/pdf' and v_extension = 'pdf'
      then 52428800
    when v_media in ('image/jpeg', 'image/png', 'image/webp')
      and v_extension in ('jpg', 'jpeg', 'png', 'webp')
      then 26214400
    when v_media in (
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) and v_extension in ('csv', 'xlsx')
      then 26214400
    when v_media in ('text/plain', 'message/rfc822', 'application/json')
      and v_extension in ('txt', 'eml', 'json')
      then 10485760
    when v_media in ('audio/mpeg', 'audio/mp4', 'audio/wav')
      and v_extension in ('mp3', 'm4a', 'wav')
      then 104857600
    else null
  end;

  if v_max_bytes is null then
    perform projectceo_foundation._raise(
      'P1110',
      'unsupported_source',
      jsonb_build_object('reason', 'MIME_EXTENSION_NOT_ALLOWED')
    );
  end if;
  if p_size_bytes is null
     or p_size_bytes <= 0
     or p_size_bytes > v_max_bytes then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      jsonb_build_object('field', 'sizeBytes', 'maxBytes', v_max_bytes)
    );
  end if;

  return jsonb_build_object(
    'extension', v_extension,
    'maxBytes', v_max_bytes,
    'mediaType', v_media,
    'sourceRole', p_source_role
  );
end
$function$;

create function projectceo_foundation._source_kind_for(
  p_media_type text,
  p_extension text
)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_media text := lower(btrim(coalesce(p_media_type, '')));
  v_extension text := lower(btrim(coalesce(p_extension, '')));
begin
  if v_media = 'application/pdf' and v_extension = 'pdf' then return 'pdf'; end if;
  if v_media in ('image/jpeg', 'image/png', 'image/webp') then return 'image'; end if;
  if v_extension in ('csv', 'xlsx') then return 'spreadsheet'; end if;
  if v_extension = 'eml' then return 'email'; end if;
  if v_media in ('audio/mpeg', 'audio/mp4', 'audio/wav') then return 'audio'; end if;
  if v_extension in ('txt', 'json') then return 'plain_text'; end if;
  perform projectceo_foundation._raise(
    'P1110',
    'unsupported_source',
    '{"reason":"SOURCE_KIND_UNMAPPED"}'::jsonb
  );
  return null;
end
$function$;

create or replace function projectceo_api.authorize_source_upload(
  project_id uuid,
  package_id uuid,
  checksum_hex text,
  media_type text,
  extension text,
  size_bytes bigint,
  source_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_checksum bytea;
  v_policy jsonb;
  v_object_key text;
begin
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    package_id,
    'register_source'
  );
  v_checksum := projectceo_foundation._assert_sha256_hex(
    checksum_hex,
    'checksum'
  );
  v_policy := projectceo_foundation._source_policy(
    media_type,
    extension,
    size_bytes,
    source_role
  );
  v_object_key :=
    'project-intelligence/ru/'
    || v_context.organization_id::text
    || '/'
    || project_id::text
    || '/sources/'
    || encode(v_checksum, 'hex')
    || '/'
    || source_role
    || '.'
    || (v_policy ->> 'extension');

  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', jsonb_build_object(
      'bucket', 'client-uploads',
      'checksum', encode(v_checksum, 'hex'),
      'mediaType', v_policy ->> 'mediaType',
      'objectKey', v_object_key,
      'packageId', package_id,
      'projectId', project_id,
      'upsert', false
    ),
    'error', null
  );
end
$function$;

create or replace function projectceo_api.authorize_source_download(
  project_id uuid,
  source_id text,
  ttl_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_package_id uuid;
  v_object_key text;
  v_context record;
begin
  if ttl_seconds is null or ttl_seconds < 1 or ttl_seconds > 900 then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"ttlSeconds"}'::jsonb
    );
  end if;
  select s.organization_id, m.package_id, s.storage_object_path
    into v_organization_id, v_package_id, v_object_key
  from project_intelligence.sources s
  join projectceo_foundation.source_protected_metadata m
    on m.organization_id = s.organization_id
   and m.project_id = s.project_id
   and m.source_id = s.source_id
  where s.project_id = project_id
    and s.source_id = source_id;
  if not found or v_object_key is null then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"source"}'::jsonb
    );
  end if;
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    v_package_id,
    'view_project'
  );
  if v_context.organization_id <> v_organization_id then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{}'::jsonb
    );
  end if;
  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', jsonb_build_object(
      'bucket', 'client-uploads',
      'objectKey', v_object_key,
      'packageId', v_package_id,
      'projectId', project_id,
      'sourceId', source_id,
      'ttlSeconds', ttl_seconds
    ),
    'error', null
  );
end
$function$;

create or replace function projectceo_api.register_source_inventory(
  project_id uuid,
  records jsonb,
  import_plan jsonb,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_record_count bigint;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'register_source'
  );
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  if jsonb_typeof(records) <> 'array'
     or jsonb_array_length(records) < 1
     or jsonb_array_length(records) > 1000 then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"records"}'::jsonb
    );
  end if;
  if jsonb_typeof(import_plan) <> 'object'
     or import_plan ->> 'projectId' is distinct from project_id::text then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{"field":"importPlan.projectId"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'importPlan', import_plan,
    'records', records
  ));
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_foundation._replay_or_null(
    v_context.organization_id,
    project_id,
    'register_source_inventory',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_foundation._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(records) as r(
      "physicalRecordId" uuid,
      "sanitizedName" text,
      hierarchy jsonb,
      availability text,
      "documentStatus" text,
      "sizeBytes" numeric,
      checksum text,
      "sourceRevisionId" text,
      "semanticConflict" boolean
    )
    where r.hierarchy ->> 'projectId' is distinct from project_id::text
       or not exists (
         select 1
         from projectceo_foundation.project_packages pp
         where pp.organization_id = v_context.organization_id
           and pp.project_id = project_id
           and pp.id = (r.hierarchy ->> 'packageId')::uuid
           and pp.status = 'active'
       )
       or r.availability not in ('materialized', 'placeholder')
       or r."documentStatus" not in (
         'current', 'previous', 'reference', 'unknown'
       )
       or (
         r.availability = 'placeholder'
         and (
           r."sizeBytes" is not null
           or r.checksum is not null
           or r."sourceRevisionId" is not null
         )
       )
       or (
         r.availability = 'materialized'
         and (
           r."sizeBytes" is null
           or r."sizeBytes" < 0
           or trunc(r."sizeBytes") <> r."sizeBytes"
           or r."sizeBytes" > 9007199254740991
           or r.checksum !~ '^[a-f0-9]{64}$'
           or nullif(btrim(r."sourceRevisionId"), '') is null
         )
       )
       or nullif(btrim(r.hierarchy ->> 'floorId'), '') is null
       or nullif(btrim(r.hierarchy ->> 'zoneId'), '') is null
       or nullif(btrim(r.hierarchy ->> 'disciplineId'), '') is null
  ) then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"INVENTORY_RECORD_INVALID"}'::jsonb
    );
  end if;

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
    v_context.organization_id,
    project_id,
    r."physicalRecordId",
    (r.hierarchy ->> 'packageId')::uuid,
    r."sanitizedName",
    r.hierarchy ->> 'floorId',
    r.hierarchy ->> 'zoneId',
    r.hierarchy ->> 'disciplineId',
    r.availability,
    r."documentStatus",
    r."sizeBytes"::bigint,
    case when r.checksum is null then null else decode(r.checksum, 'hex') end,
    r."sourceRevisionId",
    case
      when r.checksum is null then null
      else 'source-sha256-' || left(r.checksum, 24)
    end,
    coalesce(r."semanticConflict", false),
    v_context.actor_user_id
  from jsonb_to_recordset(records) as r(
    "physicalRecordId" uuid,
    "sanitizedName" text,
    hierarchy jsonb,
    availability text,
    "documentStatus" text,
    "sizeBytes" numeric,
    checksum text,
    "sourceRevisionId" text,
    "semanticConflict" boolean
  )
  order by r."physicalRecordId"
  on conflict on constraint source_inventory_records_pkey do nothing;

  get diagnostics v_record_count = row_count;
  if v_record_count <> jsonb_array_length(records) then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"PHYSICAL_RECORD_ALREADY_REGISTERED"}'::jsonb
    );
  end if;

  v_result := jsonb_build_object(
    'registeredPhysicalRecords', v_record_count
  );
  return projectceo_foundation._complete_project_command(
    v_context.organization_id,
    project_id,
    'register_source_inventory',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'source_inventory_registered',
    jsonb_build_object('record_count', v_record_count),
    v_state_revision
  );
end
$function$;

create or replace function projectceo_api.ingest_source_graph(
  project_id uuid,
  source jsonb,
  fragments jsonb,
  nodes jsonb,
  revisions jsonb,
  evidence_links jsonb,
  edges jsonb,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_package_id uuid;
  v_source_id text;
  v_source_kind text;
  v_checksum bytea;
  v_checksum_hex text;
  v_storage_path text;
  v_original_filename text;
  v_media_type text;
  v_extension text;
  v_source_role text;
  v_size_bytes bigint;
  v_declared_revision text;
  v_document_status text;
  v_expected_path text;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_ingestion_id uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  if jsonb_typeof(source) <> 'object'
     or jsonb_typeof(fragments) <> 'array'
     or jsonb_typeof(nodes) <> 'array'
     or jsonb_typeof(revisions) <> 'array'
     or jsonb_typeof(evidence_links) <> 'array'
     or jsonb_typeof(edges) <> 'array' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"INGESTION_SHAPE_INVALID"}'::jsonb
    );
  end if;
  v_package_id := (source ->> 'packageId')::uuid;
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    v_package_id,
    'register_source'
  );
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  v_source_id := btrim(source ->> 'sourceId');
  v_checksum_hex := source ->> 'checksumHex';
  v_checksum := projectceo_foundation._assert_sha256_hex(
    v_checksum_hex,
    'source.checksumHex'
  );
  v_storage_path := source ->> 'storageObjectPath';
  v_original_filename := source #>> '{metadata,originalFilename}';
  v_media_type := lower(btrim(source #>> '{metadata,mediaType}'));
  v_extension := lower(btrim(source #>> '{metadata,extension}'));
  v_source_role := source #>> '{metadata,sourceRole}';
  v_size_bytes := projectceo_foundation._assert_safe_integer(
    (source #>> '{metadata,sizeBytes}')::numeric,
    'source.metadata.sizeBytes',
    false
  );
  v_declared_revision := nullif(
    btrim(source #>> '{metadata,declaredRevision}'),
    ''
  );
  v_document_status := source #>> '{metadata,documentStatus}';
  perform projectceo_foundation._source_policy(
    v_media_type,
    v_extension,
    v_size_bytes,
    v_source_role
  );
  v_source_kind := projectceo_foundation._source_kind_for(
    v_media_type,
    v_extension
  );
  if source ->> 'kind' is distinct from v_source_kind then
    perform projectceo_foundation._raise(
      'P1110',
      'unsupported_source',
      '{"reason":"SOURCE_KIND_MISMATCH"}'::jsonb
    );
  end if;
  if nullif(v_source_id, '') is null
     or length(v_source_id) > 160
     or v_document_status not in (
       'current', 'previous', 'reference', 'unknown'
     )
     or nullif(btrim(v_original_filename), '') is null then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"SOURCE_METADATA_INVALID"}'::jsonb
    );
  end if;
  v_expected_path :=
    'project-intelligence/ru/'
    || v_context.organization_id::text
    || '/'
    || project_id::text
    || '/sources/'
    || v_checksum_hex
    || '/'
    || v_source_role
    || '.'
    || v_extension;
  if v_storage_path is not null
     and v_storage_path is distinct from v_expected_path then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"STORAGE_OBJECT_KEY_MISMATCH"}'::jsonb
    );
  end if;
  v_storage_path := v_expected_path;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'edges', edges,
    'evidenceLinks', evidence_links,
    'fragments', fragments,
    'nodes', nodes,
    'revisions', revisions,
    'source', source
  ));
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_foundation._replay_or_null(
    v_context.organization_id,
    project_id,
    'ingest_source_graph',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_foundation._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;
  if exists (
    select 1
    from project_intelligence.sources s
    where s.organization_id = v_context.organization_id
      and s.project_id = project_id
      and (s.source_id = v_source_id or s.checksum = v_checksum)
  ) then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"SOURCE_ALREADY_REGISTERED_USE_ORIGINAL_IDEMPOTENCY_KEY"}'::jsonb
    );
  end if;

  set constraints
    project_intelligence.graph_node_revisions_evidence_closure
    deferred;

  insert into project_intelligence.sources (
    organization_id,
    project_id,
    source_id,
    kind,
    checksum,
    storage_object_path
  )
  values (
    v_context.organization_id,
    project_id,
    v_source_id,
    v_source_kind,
    v_checksum,
    v_storage_path
  );

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
  values (
    v_context.organization_id,
    project_id,
    v_source_id,
    v_package_id,
    v_original_filename,
    v_media_type,
    v_size_bytes,
    v_extension,
    v_source_role,
    v_declared_revision,
    v_document_status
  );

  insert into project_intelligence.source_fragments (
    organization_id,
    project_id,
    fragment_id,
    source_id,
    locator_kind,
    locator
  )
  select
    v_context.organization_id,
    project_id,
    f."fragmentId",
    v_source_id,
    f."locatorKind",
    f.locator
  from jsonb_to_recordset(fragments) as f(
    "fragmentId" text,
    "locatorKind" text,
    locator jsonb
  )
  order by f."fragmentId" collate "C";

  insert into project_intelligence.graph_nodes (
    organization_id,
    project_id,
    node_id,
    kind,
    stable_key,
    current_revision_id
  )
  select
    v_context.organization_id,
    project_id,
    n."nodeId",
    n.kind,
    n."stableKey",
    n."currentRevisionId"
  from jsonb_to_recordset(nodes) as n(
    "nodeId" text,
    kind text,
    "stableKey" text,
    "currentRevisionId" text
  )
  order by n."nodeId" collate "C";

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
    v_context.organization_id,
    project_id,
    r."revisionId",
    r."nodeId",
    projectceo_foundation._assert_safe_integer(
      r."revisionNo",
      'revision.revisionNo',
      true
    ),
    r.title,
    r.payload,
    r.origin,
    r."claimStatus",
    r."unknownReason",
    r."replacesRevisionId",
    projectceo_foundation._assert_sha256_hex(
      r."contentDigestHex",
      'revision.contentDigestHex'
    ),
    case
      when r.origin = 'human' then 'human'
      when r.origin = 'ai' then 'ai'
      else 'system'
    end,
    case
      when r.origin = 'human' then v_context.actor_id
      when r.origin = 'ai' then 'ai:projectceo-ingestion'
      else 'system:projectceo-ingestion'
    end
  from jsonb_to_recordset(revisions) as r(
    "revisionId" text,
    "nodeId" text,
    "revisionNo" numeric,
    title text,
    payload jsonb,
    origin text,
    "claimStatus" text,
    "unknownReason" text,
    "replacesRevisionId" text,
    "contentDigestHex" text
  )
  order by r."revisionId" collate "C";

  insert into project_intelligence.evidence_links (
    organization_id,
    project_id,
    evidence_link_id,
    node_revision_id,
    source_fragment_id
  )
  select
    v_context.organization_id,
    project_id,
    e."evidenceLinkId",
    e."nodeRevisionId",
    e."sourceFragmentId"
  from jsonb_to_recordset(evidence_links) as e(
    "evidenceLinkId" text,
    "nodeRevisionId" text,
    "sourceFragmentId" text
  )
  order by e."evidenceLinkId" collate "C";

  insert into project_intelligence.graph_edges (
    organization_id,
    project_id,
    edge_id,
    from_node_id,
    to_node_id,
    relation
  )
  select
    v_context.organization_id,
    project_id,
    e."edgeId",
    e."fromNodeId",
    e."toNodeId",
    e.relation
  from jsonb_to_recordset(edges) as e(
    "edgeId" text,
    "fromNodeId" text,
    "toNodeId" text,
    relation text
  )
  order by e."edgeId" collate "C";

  set constraints
    project_intelligence.graph_node_revisions_evidence_closure
    immediate;
  set constraints
    project_intelligence.graph_node_revisions_evidence_closure
    deferred;

  insert into projectceo_foundation.source_ingestions (
    organization_id,
    project_id,
    ingestion_id,
    source_id,
    package_id,
    fragment_count,
    node_count,
    revision_count,
    evidence_link_count,
    edge_count,
    status,
    actor_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    v_ingestion_id,
    v_source_id,
    v_package_id,
    jsonb_array_length(fragments),
    jsonb_array_length(nodes),
    jsonb_array_length(revisions),
    jsonb_array_length(evidence_links),
    jsonb_array_length(edges),
    'ready',
    v_context.actor_user_id
  );

  v_result := jsonb_build_object(
    'ingestionId', v_ingestion_id,
    'packageId', v_package_id,
    'sourceId', v_source_id,
    'sourceRevisionId', source ->> 'sourceRevisionId'
  );
  return projectceo_foundation._complete_project_command(
    v_context.organization_id,
    project_id,
    'ingest_source_graph',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'source_graph_ingested',
    jsonb_build_object(
      'edge_count', jsonb_array_length(edges),
      'evidence_link_count', jsonb_array_length(evidence_links),
      'fragment_count', jsonb_array_length(fragments),
      'ingestion_id', v_ingestion_id,
      'node_count', jsonb_array_length(nodes),
      'package_id', v_package_id,
      'revision_count', jsonb_array_length(revisions),
      'source_id', v_source_id
    ),
    v_state_revision
  );
end
$function$;

create or replace function projectceo_api.list_projects()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_user_id uuid := auth.uid();
  v_data jsonb;
begin
  if v_user_id is null then
    perform projectceo_foundation._raise(
      'P1101',
      'unauthenticated',
      '{}'::jsonb
    );
  end if;
  select coalesce(jsonb_agg(item order by item ->> 'projectId'), '[]'::jsonb)
    into v_data
  from (
    select distinct jsonb_build_object(
      'accessScope', 'project',
      'organizationId', pw.organization_id,
      'projectId', pw.project_id,
      'role', pm.role,
      'stateRevision', pw.state_revision
    ) item
    from project_intelligence.project_workflows pw
    join project_intelligence.organizations o
      on o.id = pw.organization_id
     and o.status = 'active'
    join project_intelligence.organization_members om
      on om.organization_id = pw.organization_id
     and om.user_id = v_user_id
     and om.status = 'active'
    join projectceo_foundation.project_memberships pm
      on pm.organization_id = pw.organization_id
     and pm.project_id = pw.project_id
     and pm.user_id = v_user_id
     and pm.status = 'active'
    union all
    select distinct jsonb_build_object(
      'accessScope', 'package',
      'organizationId', pw.organization_id,
      'packageId', pm.package_id,
      'projectId', pw.project_id,
      'role', pm.role,
      'stateRevision', pw.state_revision
    ) item
    from project_intelligence.project_workflows pw
    join project_intelligence.organizations o
      on o.id = pw.organization_id
     and o.status = 'active'
    join project_intelligence.organization_members om
      on om.organization_id = pw.organization_id
     and om.user_id = v_user_id
     and om.status = 'active'
    join projectceo_foundation.package_memberships pm
      on pm.organization_id = pw.organization_id
     and pm.project_id = pw.project_id
     and pm.user_id = v_user_id
     and pm.status = 'active'
  ) scoped;
  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

create or replace function projectceo_api.get_project_summary(project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_data jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'view_project'
  );
  select jsonb_build_object(
    'latestVersionId', pw.latest_version_id,
    'organizationId', pw.organization_id,
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pp.id,
        'kind', pp.kind,
        'name', pp.name,
        'parentPackageId', pp.parent_package_id,
        'stableKey', pp.stable_key,
        'status', pp.status
      ) order by pp.stable_key collate "C")
      from projectceo_foundation.project_packages pp
      where pp.organization_id = pw.organization_id
        and pp.project_id = pw.project_id
    ), '[]'::jsonb),
    'projectId', pw.project_id,
    'stateRevision', pw.state_revision
  )
  into v_data
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id;
  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

create or replace function projectceo_api.list_project_access(project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_data jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'manage_access'
  );
  select jsonb_build_object(
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'expiresAt', i.expires_at,
        'invitationId', i.invitation_id,
        'packageId', i.package_id,
        'recipientEmail', i.recipient_email,
        'role', i.role,
        'scope', i.scope_kind,
        'status', case
          when exists (
            select 1 from projectceo_foundation.invitation_events ie
            where ie.organization_id = i.organization_id
              and ie.project_id = i.project_id
              and ie.invitation_id = i.invitation_id
              and ie.event_type = 'revoked'
          ) then 'revoked'
          when exists (
            select 1 from projectceo_foundation.invitation_events ie
            where ie.organization_id = i.organization_id
              and ie.project_id = i.project_id
              and ie.invitation_id = i.invitation_id
              and ie.event_type = 'accepted'
          ) then 'accepted'
          when i.expires_at <= statement_timestamp() then 'expired'
          else 'pending'
        end
      ) order by i.created_at desc)
      from projectceo_foundation.invitations i
      where i.organization_id = v_context.organization_id
        and i.project_id = project_id
    ), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', pm.role,
        'scope', 'project',
        'status', pm.status,
        'userId', pm.user_id
      ) order by pm.user_id::text)
      from projectceo_foundation.project_memberships pm
      where pm.organization_id = v_context.organization_id
        and pm.project_id = project_id
    ), '[]'::jsonb),
    'packageMemberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'packageId', pm.package_id,
        'role', pm.role,
        'scope', 'package',
        'status', pm.status,
        'userId', pm.user_id
      ) order by pm.package_id::text, pm.user_id::text)
      from projectceo_foundation.package_memberships pm
      where pm.organization_id = v_context.organization_id
        and pm.project_id = project_id
    ), '[]'::jsonb)
  ) into v_data;
  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

create or replace function projectceo_api.list_project_sources(project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_data jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'view_project'
  );
  select coalesce(jsonb_agg(jsonb_build_object(
    'checksum', encode(s.checksum, 'hex'),
    'documentStatus', m.document_status,
    'kind', s.kind,
    'mediaType', m.media_type,
    'packageId', m.package_id,
    'sizeBytes', m.size_bytes,
    'sourceId', s.source_id,
    'sourceRole', m.source_role
  ) order by s.source_id collate "C"), '[]'::jsonb)
  into v_data
  from project_intelligence.sources s
  join projectceo_foundation.source_protected_metadata m
    on m.organization_id = s.organization_id
   and m.project_id = s.project_id
   and m.source_id = s.source_id
  where s.organization_id = v_context.organization_id
    and s.project_id = project_id;
  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

create or replace function projectceo_api.get_review_queue(project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_data jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'review_source'
  );
  select coalesce(jsonb_agg(jsonb_build_object(
    'claimStatus', r.claim_status,
    'kind', n.kind,
    'nodeId', n.node_id,
    'origin', r.origin,
    'revisionId', r.revision_id,
    'title', r.title
  ) order by n.stable_key collate "C"), '[]'::jsonb)
  into v_data
  from project_intelligence.graph_nodes n
  join project_intelligence.graph_node_revisions r
    on r.organization_id = n.organization_id
   and r.project_id = n.project_id
   and r.revision_id = n.current_revision_id
  where n.organization_id = v_context.organization_id
    and n.project_id = project_id
    and not exists (
      select 1
      from project_intelligence.human_reviews hr
      where hr.organization_id = r.organization_id
        and hr.project_id = r.project_id
        and hr.target_revision_id = r.revision_id
    );
  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

create or replace function projectceo_api.get_project_delivery(
  project_id uuid,
  package_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_data jsonb;
  v_project_wide boolean;
begin
  if package_id is null then
    select *, true as project_wide into v_context
    from projectceo_foundation._authorize_project_human(
      project_id,
      'view_project'
    );
    v_project_wide := true;
  else
    select * into v_context
    from projectceo_foundation._authorize_package_human(
      project_id,
      package_id,
      'view_project'
    );
    v_project_wide := v_context.project_wide;
  end if;

  select jsonb_build_object(
    'acknowledgements', '[]'::jsonb,
    'distributions', '[]'::jsonb,
    'extensionStatus', jsonb_build_object(
      'productionPackageVersions', 'deferred',
      'projectBaselines', 'mapped_to_db2_project_versions',
      'releaseArtifacts', 'mapped_to_db2_logical_handoffs'
    ),
    'latestBaseline', case
      when v_project_wide then (
        select jsonb_build_object(
          'graphDigest', 'sha256:' || encode(pv.graph_digest, 'hex'),
          'label', pv.label,
          'publishedAt', pv.published_at,
          'versionId', pv.version_id,
          'versionNo', pv.version_no
        )
        from project_intelligence.project_versions pv
        where pv.organization_id = v_context.organization_id
          and pv.project_id = project_id
        order by pv.version_no desc
        limit 1
      )
      else null
    end,
    'package', case
      when package_id is null then null
      else (
        select jsonb_build_object(
          'id', pp.id,
          'kind', pp.kind,
          'name', pp.name,
          'parentPackageId', pp.parent_package_id,
          'stableKey', pp.stable_key,
          'status', pp.status
        )
        from projectceo_foundation.project_packages pp
        where pp.organization_id = v_context.organization_id
          and pp.project_id = project_id
          and pp.id = package_id
      )
    end,
    'packageVersions', '[]'::jsonb,
    'releaseArtifacts', case
      when v_project_wide then coalesce((
        select jsonb_agg(jsonb_build_object(
          'artifact', lh.artifact_descriptor,
          'handoffId', lh.handoff_id,
          'semanticHash',
            'sha256:' || encode(lh.semantic_content_digest, 'hex'),
          'versionId', lh.version_id
        ) order by lh.created_at desc)
        from project_intelligence.logical_handoffs lh
        where lh.organization_id = v_context.organization_id
          and lh.project_id = project_id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'unresolvedImpactReviewCount', case
      when v_project_wide then (
        select count(*)
        from project_intelligence.impacts i
        where i.organization_id = v_context.organization_id
          and i.project_id = project_id
          and not exists (
            select 1
            from project_intelligence.impact_reviews ir
            where ir.organization_id = i.organization_id
              and ir.project_id = i.project_id
              and ir.impact_id = i.impact_id
          )
      )
      else 0
    end
  ) into v_data;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

create or replace function projectceo_api.get_audit_timeline(project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_data jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'view_audit'
  );
  select coalesce(jsonb_agg(event order by event ->> 'occurredAt' desc), '[]'::jsonb)
    into v_data
  from (
    select jsonb_build_object(
      'actorType', ae.actor_type,
      'eventType', ae.event_type,
      'metadata', ae.controlled_metadata,
      'occurredAt', ae.occurred_at
    ) event
    from project_intelligence.audit_events ae
    where ae.organization_id = v_context.organization_id
      and ae.project_id = project_id
    union all
    select jsonb_build_object(
      'actorType', ae.actor_type,
      'eventType', ae.event_type,
      'metadata', ae.controlled_metadata,
      'occurredAt', ae.occurred_at
    ) event
    from projectceo_foundation.audit_events ae
    where ae.organization_id = v_context.organization_id
      and ae.project_id = project_id
  ) events;
  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

create or replace function projectceo_api.read_guest_release(token_digest bytea)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_grant projectceo_foundation.guest_access_grants%rowtype;
  v_data jsonb;
begin
  if octet_length(token_digest) <> 32 then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"tokenDigest"}'::jsonb
    );
  end if;
  select * into v_grant
  from projectceo_foundation.guest_access_grants g
  where g.token_digest = token_digest;
  if not found then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"grant"}'::jsonb
    );
  end if;
  if exists (
    select 1
    from projectceo_foundation.guest_access_grant_events ge
    where ge.organization_id = v_grant.organization_id
      and ge.project_id = v_grant.project_id
      and ge.grant_id = v_grant.grant_id
  ) then
    perform projectceo_foundation._raise('P1106', 'revoked', '{}'::jsonb);
  end if;
  if v_grant.expires_at <= statement_timestamp() then
    perform projectceo_foundation._raise('P1105', 'expired', '{}'::jsonb);
  end if;
  if not exists (
    select 1
    from project_intelligence.organizations o
    where o.id = v_grant.organization_id
      and o.status = 'active'
  ) then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"ORGANIZATION_SUSPENDED"}'::jsonb
    );
  end if;
  select jsonb_build_object(
    'allowAcknowledgement', v_grant.allow_acknowledgement,
    'expiresAt', v_grant.expires_at,
    'package', jsonb_build_object(
      'id', pp.id,
      'kind', pp.kind,
      'name', pp.name,
      'stableKey', pp.stable_key
    ),
    'projectId', v_grant.project_id,
    'release', jsonb_build_object(
      'graphDigest', 'sha256:' || encode(pv.graph_digest, 'hex'),
      'publishedAt', pv.published_at,
      'versionId', pv.version_id,
      'versionNo', pv.version_no
    )
  ) into v_data
  from projectceo_foundation.project_packages pp
  join project_intelligence.project_versions pv
    on pv.organization_id = pp.organization_id
   and pv.project_id = pp.project_id
   and pv.version_id = v_grant.version_id
  where pp.organization_id = v_grant.organization_id
    and pp.project_id = v_grant.project_id
    and pp.id = v_grant.package_id;
  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

do $ingestion_append_only$
declare
  v_table text;
begin
  foreach v_table in array array[
    'source_inventory_records',
    'source_protected_metadata',
    'source_ingestions'
  ]
  loop
    execute format(
      'create trigger %I before update or delete on projectceo_foundation.%I '
      || 'for each row execute function '
      || 'projectceo_foundation.reject_append_only_mutation()',
      v_table || '_append_only',
      v_table
    );
  end loop;
end
$ingestion_append_only$;

do $ingestion_table_security$
declare
  v_table text;
begin
  foreach v_table in array array[
    'source_inventory_records',
    'source_protected_metadata',
    'source_ingestions'
  ]
  loop
    execute format(
      'alter table projectceo_foundation.%I owner to pi_table_owner',
      v_table
    );
    execute format(
      'alter table projectceo_foundation.%I enable row level security',
      v_table
    );
    execute format(
      'alter table projectceo_foundation.%I force row level security',
      v_table
    );
    execute format(
      'revoke all on table projectceo_foundation.%I '
      || 'from public, anon, authenticated, service_role, '
      || 'pi_human_executor, pi_worker_executor',
      v_table
    );
    execute format(
      'create policy %I on projectceo_foundation.%I '
      || 'for all to pi_table_owner using (true) with check (true)',
      v_table || '_internal_owner',
      v_table
    );
  end loop;
end
$ingestion_table_security$;

do $project_intelligence_foundation_internal_policies$
declare
  v_table text;
begin
  for v_table in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'project_intelligence'
      and c.relkind in ('r', 'p')
      and c.relname not in (
        'organizations',
        'organization_members',
        'member_capabilities',
        'project_workflows'
      )
  loop
    execute format(
      'create policy %I on project_intelligence.%I '
      || 'for all to pi_table_owner using (true) with check (true)',
      v_table || '_foundation_internal',
      v_table
    );
  end loop;
end
$project_intelligence_foundation_internal_policies$;

-- DB2 completes normalized writes while the NOLOGIN executor is still active.
-- The later P1 evidence-scope closure trigger is also DEFERRABLE, so force that
-- constraint in the same protected context. Keep the frozen four-constraint
-- statements unchanged for the DB2 contract harness.
create or replace function project_intelligence._complete_command(
  p_organization_id uuid,
  p_project_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea,
  p_actor_type text,
  p_actor_id text,
  p_actor_user_id uuid,
  p_logical_result jsonb,
  p_event_type text,
  p_controlled_metadata jsonb,
  p_previous_state_revision bigint,
  p_set_latest_version boolean default false,
  p_latest_version_id text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_command_id uuid := pg_catalog.gen_random_uuid();
  v_next_state_revision bigint := p_previous_state_revision + 1;
  v_row_count integer;
begin
  if p_previous_state_revision >= 9007199254740991 then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"reason":"STATE_REVISION_EXHAUSTED"}'::jsonb
    );
  end if;

  if current_setting('project_intelligence.test_fail_after_domain', true) = 'on' then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"reason":"INJECTED_FAILURE_AFTER_DOMAIN"}'::jsonb
    );
  end if;

  insert into project_intelligence.command_records (
    command_id,
    organization_id,
    project_id,
    operation,
    key_digest,
    request_digest,
    digest_version,
    actor_type,
    actor_id,
    actor_user_id,
    logical_result,
    resulting_state_revision,
    completed_at
  )
  values (
    v_command_id,
    p_organization_id,
    p_project_id,
    p_operation,
    p_key_digest,
    p_request_digest,
    'project-intelligence-jsonb/1',
    p_actor_type,
    p_actor_id,
    p_actor_user_id,
    p_logical_result,
    v_next_state_revision,
    pg_catalog.statement_timestamp()
  );

  insert into project_intelligence.audit_events (
    audit_event_id,
    organization_id,
    project_id,
    command_id,
    event_type,
    actor_type,
    actor_id,
    request_id,
    controlled_metadata,
    occurred_at
  )
  values (
    pg_catalog.gen_random_uuid(),
    p_organization_id,
    p_project_id,
    v_command_id,
    p_event_type,
    p_actor_type,
    p_actor_id,
    'db:' || pg_catalog.gen_random_uuid()::text,
    coalesce(p_controlled_metadata, '{}'::jsonb),
    pg_catalog.statement_timestamp()
  );

  update project_intelligence.project_workflows pw
  set state_revision = v_next_state_revision,
      latest_version_id = case
        when p_set_latest_version then p_latest_version_id
        else pw.latest_version_id
      end,
      updated_at = pg_catalog.statement_timestamp()
  where pw.organization_id = p_organization_id
    and pw.project_id = p_project_id
    and pw.state_revision = p_previous_state_revision;

  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    perform project_intelligence._raise_contract_error(
      'P1006',
      'STATE_STALE',
      pg_catalog.jsonb_build_object('currentStateRevision', null)
    );
  end if;

  set constraints
    project_intelligence.graph_node_revisions_evidence_closure,
    project_intelligence.project_versions_closure,
    project_intelligence.change_set_publications_closure,
    project_intelligence.impacts_path_closure
    immediate;
  set constraints
    project_intelligence.graph_node_revisions_evidence_closure,
    project_intelligence.project_versions_closure,
    project_intelligence.change_set_publications_closure,
    project_intelligence.impacts_path_closure
    deferred;
  set constraints
    project_intelligence.version_evidence_scope_closure
    immediate;
  set constraints
    project_intelligence.version_evidence_scope_closure
    deferred;

  return pg_catalog.jsonb_build_object(
    'operation', p_operation,
    'replay', false,
    'stateRevision', v_next_state_revision,
    'result', p_logical_result
  );
end;
$function$;

alter function projectceo_foundation._assert_sha256_hex(text, text)
  owner to pi_table_owner;
alter function projectceo_foundation._assert_safe_integer(numeric, text, boolean)
  owner to pi_table_owner;
alter function projectceo_foundation._source_policy(text, text, bigint, text)
  owner to pi_table_owner;
alter function projectceo_foundation._source_kind_for(text, text)
  owner to pi_table_owner;

alter function projectceo_api.authorize_source_upload(
  uuid, uuid, text, text, text, bigint, text
) owner to pi_table_owner;
alter function projectceo_api.authorize_source_download(uuid, text, integer)
  owner to pi_table_owner;
alter function projectceo_api.register_source_inventory(
  uuid, jsonb, jsonb, bigint, text
) owner to pi_table_owner;
alter function projectceo_api.ingest_source_graph(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, text
) owner to pi_table_owner;
alter function projectceo_api.list_projects()
  owner to pi_table_owner;
alter function projectceo_api.get_project_summary(uuid)
  owner to pi_table_owner;
alter function projectceo_api.list_project_access(uuid)
  owner to pi_table_owner;
alter function projectceo_api.list_project_sources(uuid)
  owner to pi_table_owner;
alter function projectceo_api.get_review_queue(uuid)
  owner to pi_table_owner;
alter function projectceo_api.get_project_delivery(uuid, uuid)
  owner to pi_table_owner;
alter function projectceo_api.get_audit_timeline(uuid)
  owner to pi_table_owner;
alter function projectceo_api.read_guest_release(bytea)
  owner to pi_table_owner;

revoke all on all functions in schema projectceo_foundation
  from public, anon, authenticated, service_role;
revoke all on all functions in schema projectceo_api
  from public, anon, authenticated, service_role;

grant usage on schema projectceo_api to anon, authenticated;
grant execute on function
  projectceo_api.enroll_organization_project(uuid, text),
  projectceo_api.create_invitation(
    uuid, uuid, text, text, timestamptz, bytea, bigint, text
  ),
  projectceo_api.accept_invitation(bytea, text),
  projectceo_api.revoke_invitation(uuid, uuid, bigint, text),
  projectceo_api.create_guest_access_grant(
    uuid, uuid, text, boolean, timestamptz, bytea, bigint, text
  ),
  projectceo_api.revoke_guest_access_grant(uuid, uuid, bigint, text),
  projectceo_api.authorize_source_upload(
    uuid, uuid, text, text, text, bigint, text
  ),
  projectceo_api.authorize_source_download(uuid, text, integer),
  projectceo_api.register_source_inventory(uuid, jsonb, jsonb, bigint, text),
  projectceo_api.ingest_source_graph(
    uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, text
  ),
  projectceo_api.list_projects(),
  projectceo_api.get_project_summary(uuid),
  projectceo_api.list_project_access(uuid),
  projectceo_api.list_project_sources(uuid),
  projectceo_api.get_review_queue(uuid),
  projectceo_api.get_project_delivery(uuid, uuid),
  projectceo_api.get_audit_timeline(uuid)
  to authenticated;
grant execute on function
  projectceo_api.expire_invitation(uuid, uuid, bigint, text)
  to service_role;
grant execute on function projectceo_api.read_guest_release(bytea)
  to anon, authenticated;

commit;
