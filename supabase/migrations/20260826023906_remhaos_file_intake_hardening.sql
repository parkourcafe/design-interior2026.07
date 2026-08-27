-- RemHaOS Integration Gateway PR3: request-bound file intake hardening.
--
-- Additive only. Quarantine state is private and independent from the legacy
-- ProjectCEO source tables until a human-approved internal copy is published.

begin;

alter table remhaos_integration.command_records
  drop constraint if exists command_records_operation_check;
alter table remhaos_integration.command_records
  add constraint command_records_operation_check
  check (operation in (
    'activate_oauth_connection',
    'disconnect_integration_connection',
    'bind_project_connection',
    'unbind_project_connection',
    'review_import_candidate',
    'record_verified_webhook',
    'enqueue_integration_job',
    'complete_integration_job',
    'fail_integration_job',
    'upsert_external_object',
    'create_import_candidate',
    'create_project_link',
    'revise_project_link',
    'archive_project_link',
    'publish_project_link_to_client',
    'create_file_intake',
    'mark_file_intake_uploaded',
    'complete_file_intake_scan',
    'review_file_intake',
    'publish_file_intake'
  ));

create function remhaos_integration._file_intake_policy(
  p_media_type text,
  p_extension text,
  p_size_bytes bigint
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
  v_max_bytes := case
    when v_media = 'application/pdf' and v_extension = 'pdf'
      then 52428800
    when v_media = 'image/jpeg' and v_extension in ('jpg', 'jpeg')
      then 26214400
    when v_media = 'image/png' and v_extension = 'png'
      then 26214400
    when v_media = 'text/csv' and v_extension = 'csv'
      then 26214400
    when v_media = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      and v_extension = 'xlsx'
      then 26214400
    else null
  end;

  if v_max_bytes is null then
    perform remhaos_integration._raise(
      'P1210',
      'unsupported_source',
      jsonb_build_object('reason', 'MIME_EXTENSION_NOT_ALLOWED')
    );
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_max_bytes then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      jsonb_build_object('field', 'sizeBytes', 'maxBytes', v_max_bytes)
    );
  end if;

  return jsonb_build_object(
    'extension', v_extension,
    'maxBytes', v_max_bytes,
    'mediaType', v_media
  );
end
$function$;

create function remhaos_integration._file_intake_source_kind(
  p_media_type text,
  p_extension text
)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_extension = 'pdf' then return 'pdf'; end if;
  if p_extension in ('jpg', 'jpeg', 'png') then return 'image'; end if;
  if p_extension = 'csv' or p_extension = 'xlsx' then return 'spreadsheet'; end if;
  perform remhaos_integration._raise(
    'P1210',
    'unsupported_source',
    '{"reason":"SOURCE_KIND_UNMAPPED"}'::jsonb
  );
  return null;
end
$function$;

create function remhaos_integration._file_intake_quarantine_key(
  p_organization_id uuid,
  p_project_id uuid,
  p_intake_id uuid,
  p_checksum_hex text,
  p_source_role text,
  p_extension text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select 'project-intelligence/ru/'
    || p_organization_id::text || '/' || p_project_id::text
    || '/quarantine/' || p_intake_id::text || '/' || p_checksum_hex
    || '/' || p_source_role || '.' || p_extension
$function$;

create function remhaos_integration._file_intake_internal_key(
  p_organization_id uuid,
  p_project_id uuid,
  p_checksum_hex text,
  p_source_role text,
  p_extension text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select 'project-intelligence/ru/'
    || p_organization_id::text || '/' || p_project_id::text
    || '/sources/' || p_checksum_hex || '/' || p_source_role || '.' || p_extension
$function$;

create table remhaos_integration.file_intakes (
  organization_id uuid not null,
  project_id uuid not null,
  intake_id uuid not null default extensions.gen_random_uuid(),
  package_id uuid not null,
  original_filename text not null
    check (
      char_length(btrim(original_filename)) between 1 and 500
      and original_filename = btrim(original_filename)
      and original_filename !~ '[/\\]'
      and original_filename !~ '[[:cntrl:]]'
    ),
  media_type text not null
    check (media_type = lower(btrim(media_type)) and char_length(media_type) between 1 and 255),
  extension text not null
    check (extension = lower(btrim(extension)) and extension in ('pdf', 'jpg', 'jpeg', 'png', 'csv', 'xlsx')),
  source_role text not null check (source_role in (
    'document', 'drawing-preview', 'reference', 'photo-evidence', 'correspondence', 'schedule'
  )),
  size_bytes bigint not null check (size_bytes between 1 and 9007199254740991),
  checksum bytea not null check (octet_length(checksum) = 32),
  quarantine_object_key text not null
    check (char_length(btrim(quarantine_object_key)) between 1 and 2048),
  internal_object_key text not null
    check (char_length(btrim(internal_object_key)) between 1 and 2048),
  status text not null check (status in (
    'requested',
    'uploaded_to_quarantine',
    'scan_pending',
    'clean',
    'infected',
    'scan_failed',
    'human_reviewed',
    'rejected',
    'ingested_candidate',
    'published_internal_copy'
  )),
  scan_outcome text check (scan_outcome is null or scan_outcome in ('clean', 'infected', 'scan_failed')),
  review_decision text check (review_decision is null or review_decision in ('accepted', 'rejected')),
  source_id text,
  created_by_user_id uuid not null,
  uploaded_at timestamptz,
  scanned_at timestamptz,
  reviewed_at timestamptz,
  published_at timestamptz,
  reviewed_by_user_id uuid,
  published_by_user_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, intake_id),
  constraint file_intakes_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint file_intakes_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (organization_id, project_id, id)
    on delete restrict,
  constraint file_intakes_created_by_fkey
    foreign key (organization_id, created_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint file_intakes_reviewed_by_fkey
    foreign key (organization_id, reviewed_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint file_intakes_published_by_fkey
    foreign key (organization_id, published_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint file_intakes_source_fkey
    foreign key (organization_id, project_id, source_id)
    references project_intelligence.sources (organization_id, project_id, source_id)
    on delete restrict,
  constraint file_intakes_status_shape_check check (
    (status in ('clean', 'infected', 'scan_failed') and scan_outcome is not null)
    or (status not in ('clean', 'infected', 'scan_failed'))
  )
);

create table remhaos_integration.file_intake_events (
  organization_id uuid not null,
  project_id uuid not null,
  event_id uuid not null default extensions.gen_random_uuid(),
  intake_id uuid not null,
  from_status text,
  to_status text not null,
  event_type text not null,
  actor_type text not null check (actor_type in ('human', 'system')),
  actor_id text not null,
  actor_user_id uuid,
  sanitized_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sanitized_metadata) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, event_id),
  constraint file_intake_events_intake_fkey
    foreign key (organization_id, project_id, intake_id)
    references remhaos_integration.file_intakes (organization_id, project_id, intake_id)
    on delete restrict,
  constraint file_intake_events_actor_fkey
    foreign key (organization_id, actor_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict
);

alter table remhaos_integration.file_intakes owner to pi_table_owner;
alter table remhaos_integration.file_intake_events owner to pi_table_owner;

create index file_intakes_project_idx
  on remhaos_integration.file_intakes (organization_id, project_id, created_at desc);
create index file_intakes_package_idx
  on remhaos_integration.file_intakes (organization_id, project_id, package_id);
create index file_intakes_created_by_idx
  on remhaos_integration.file_intakes (organization_id, created_by_user_id);
create index file_intakes_reviewed_by_idx
  on remhaos_integration.file_intakes (organization_id, reviewed_by_user_id)
  where reviewed_by_user_id is not null;
create index file_intakes_published_by_idx
  on remhaos_integration.file_intakes (organization_id, published_by_user_id)
  where published_by_user_id is not null;
create index file_intakes_source_idx
  on remhaos_integration.file_intakes (organization_id, project_id, source_id)
  where source_id is not null;
create unique index file_intakes_active_checksum_key
  on remhaos_integration.file_intakes (organization_id, project_id, checksum)
  where status <> 'rejected';
create index file_intakes_status_idx
  on remhaos_integration.file_intakes (organization_id, project_id, status, created_at desc);
create index file_intake_events_intake_idx
  on remhaos_integration.file_intake_events (organization_id, project_id, intake_id, created_at);
create index file_intake_events_actor_idx
  on remhaos_integration.file_intake_events (organization_id, actor_user_id)
  where actor_user_id is not null;

alter table remhaos_integration.file_intakes enable row level security;
alter table remhaos_integration.file_intakes force row level security;
alter table remhaos_integration.file_intake_events enable row level security;
alter table remhaos_integration.file_intake_events force row level security;

create policy file_intakes_owner_only
  on remhaos_integration.file_intakes
  as permissive for all to pi_table_owner
  using (true) with check (true);
create policy file_intake_events_owner_only
  on remhaos_integration.file_intake_events
  as permissive for all to pi_table_owner
  using (true) with check (true);

create trigger file_intake_events_append_only
  before update or delete on remhaos_integration.file_intake_events
  for each row execute function remhaos_integration.reject_append_only_mutation();

create function remhaos_integration._record_file_intake_event(
  p_organization_id uuid,
  p_project_id uuid,
  p_intake_id uuid,
  p_from_status text,
  p_to_status text,
  p_event_type text,
  p_actor_type text,
  p_actor_id text,
  p_actor_user_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
volatile
set search_path = ''
as $function$
  insert into remhaos_integration.file_intake_events (
    organization_id, project_id, intake_id, from_status, to_status,
    event_type, actor_type, actor_id, actor_user_id, sanitized_metadata
  ) values (
    p_organization_id, p_project_id, p_intake_id, p_from_status, p_to_status,
    p_event_type, p_actor_type, p_actor_id, p_actor_user_id,
    remhaos_integration._assert_json_object(coalesce(p_metadata, '{}'::jsonb), 'metadata')
  )
$function$;

create function remhaos_integration_api.create_file_intake(
  p_project_id uuid,
  p_original_filename text,
  p_media_type text,
  p_extension text,
  p_size_bytes bigint,
  p_checksum_hex text,
  p_source_role text,
  p_idempotency_key text
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
  v_intake_id uuid;
  v_checksum bytea;
  v_checksum_hex text := lower(btrim(coalesce(p_checksum_hex, '')));
  v_filename text := btrim(coalesce(p_original_filename, ''));
  v_media_type text := lower(btrim(coalesce(p_media_type, '')));
  v_extension text := lower(btrim(coalesce(p_extension, '')));
  v_policy jsonb;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
  v_state_revision bigint;
  v_existing remhaos_integration.file_intakes%rowtype;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'register_source');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  if v_filename = '' or length(v_filename) > 500 or v_filename ~ '[[:cntrl:]]' or v_filename ~ '[/\\]' then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"originalFilename"}'::jsonb);
  end if;
  if p_source_role not in ('document', 'drawing-preview', 'reference', 'photo-evidence', 'correspondence', 'schedule') then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"sourceRole"}'::jsonb);
  end if;
  if v_checksum_hex !~ '^[a-f0-9]{64}$' then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"checksum"}'::jsonb);
  end if;
  v_checksum := remhaos_integration._assert_bytea_32(decode(v_checksum_hex, 'hex'), 'checksum');
  v_policy := remhaos_integration._file_intake_policy(v_media_type, v_extension, p_size_bytes);

  select pp.id into v_package_id
  from projectceo_foundation.project_packages pp
  where pp.organization_id = v_context.organization_id
    and pp.project_id = p_project_id
    and pp.kind = 'project_root'
    and pp.status = 'active';
  if v_package_id is null then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"project_package"}'::jsonb);
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'extension', v_extension,
    'filename', v_filename,
    'mediaType', v_media_type,
    'projectId', p_project_id,
    'role', p_source_role,
    'sizeBytes', p_size_bytes,
    'checksum', v_checksum_hex
  ));
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id and pw.project_id = p_project_id
  for update;
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'create_file_intake', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_existing
  from remhaos_integration.file_intakes intake
  where intake.organization_id = v_context.organization_id
    and intake.project_id = p_project_id
    and intake.checksum = v_checksum
    and intake.status <> 'rejected'
  for update;
  if found then
    v_result := jsonb_build_object(
      'intakeId', v_existing.intake_id,
      'organizationId', v_existing.organization_id,
      'projectId', p_project_id,
      'packageId', v_existing.package_id,
      'bucket', 'client-uploads',
      'checksumHex', encode(v_existing.checksum, 'hex'),
      'mediaType', v_existing.media_type,
      'extension', v_existing.extension,
      'sourceRole', v_existing.source_role,
      'objectKey', v_existing.quarantine_object_key,
      'internalObjectKey', v_existing.internal_object_key,
      'status', v_existing.status,
      'reused', true
    );
    return remhaos_integration._complete_command(
      v_context.organization_id, p_project_id, 'create_file_intake', v_key_digest,
      v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
      v_result, 'file_intake_reused', 'file_intake_reused',
      jsonb_build_object('status', v_existing.status), null
    );
  end if;

  v_intake_id := extensions.gen_random_uuid();
  insert into remhaos_integration.file_intakes (
    organization_id, project_id, intake_id, package_id, original_filename,
    media_type, extension, source_role, size_bytes, checksum,
    quarantine_object_key, internal_object_key, status, created_by_user_id
  ) values (
    v_context.organization_id, p_project_id, v_intake_id, v_package_id, v_filename,
    v_policy ->> 'mediaType', v_policy ->> 'extension', p_source_role, p_size_bytes, v_checksum,
    remhaos_integration._file_intake_quarantine_key(
      v_context.organization_id, p_project_id, v_intake_id, v_checksum_hex, p_source_role, v_extension
    ),
    remhaos_integration._file_intake_internal_key(
      v_context.organization_id, p_project_id, v_checksum_hex, p_source_role, v_extension
    ),
    'requested', v_context.actor_user_id
  );
  perform remhaos_integration._record_file_intake_event(
    v_context.organization_id, p_project_id, v_intake_id, null, 'requested',
    'file_intake_requested', 'human', v_context.actor_id, v_context.actor_user_id,
    jsonb_build_object('extension', v_extension, 'media_type', v_media_type, 'size_bytes', p_size_bytes)
  );
  v_result := jsonb_build_object(
    'intakeId', v_intake_id,
    'organizationId', v_context.organization_id,
    'projectId', p_project_id,
    'packageId', v_package_id,
    'bucket', 'client-uploads',
    'checksumHex', v_checksum_hex,
    'mediaType', v_policy ->> 'mediaType',
    'extension', v_policy ->> 'extension',
    'sourceRole', p_source_role,
    'objectKey', remhaos_integration._file_intake_quarantine_key(
      v_context.organization_id, p_project_id, v_intake_id, v_checksum_hex, p_source_role, v_extension
    ),
    'internalObjectKey', remhaos_integration._file_intake_internal_key(
      v_context.organization_id, p_project_id, v_checksum_hex, p_source_role, v_extension
    ),
    'status', 'requested',
    'reused', false
  );
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'create_file_intake', v_key_digest,
    v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'file_intake_requested', 'file_intake_requested',
    jsonb_build_object('intake_id', v_intake_id, 'status', 'requested'), null
  );
end
$function$;

create function remhaos_integration_api.get_file_intake_storage(
  p_project_id uuid,
  p_intake_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_intake remhaos_integration.file_intakes%rowtype;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'publish_baseline');
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.organization_id = v_context.organization_id
    and intake.project_id = p_project_id
    and intake.intake_id = p_intake_id;
  if not found or v_intake.status <> 'ingested_candidate' then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"publishable_file_intake"}'::jsonb);
  end if;
  return jsonb_build_object(
    'organizationId', v_intake.organization_id,
    'projectId', v_intake.project_id,
    'intakeId', v_intake.intake_id,
    'packageId', v_intake.package_id,
    'bucket', 'client-uploads',
    'objectKey', v_intake.quarantine_object_key,
    'internalObjectKey', v_intake.internal_object_key,
    'checksumHex', encode(v_intake.checksum, 'hex'),
    'mediaType', v_intake.media_type,
    'extension', v_intake.extension,
    'sourceRole', v_intake.source_role,
    'status', v_intake.status,
    'upsert', false
  );
end
$function$;

create function remhaos_integration_api.mark_file_intake_uploaded(
  p_project_id uuid,
  p_intake_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_intake remhaos_integration.file_intakes%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select intake.* into v_intake
  from remhaos_integration.file_intakes intake
  where intake.project_id = p_project_id and intake.intake_id = p_intake_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"file_intake"}'::jsonb);
  end if;
  select * into v_context
  from projectceo_foundation._authorize_package_human(p_project_id, v_intake.package_id, 'register_source');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('intakeId', p_intake_id));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'mark_file_intake_uploaded', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.organization_id = v_context.organization_id
    and intake.project_id = p_project_id and intake.intake_id = p_intake_id
  for update;
  if v_intake.status <> 'requested' then
    if v_intake.status in ('uploaded_to_quarantine', 'scan_pending') then
      v_result := jsonb_build_object('intakeId', p_intake_id, 'status', v_intake.status);
      return remhaos_integration._complete_command(
        v_context.organization_id, p_project_id, 'mark_file_intake_uploaded', v_key_digest,
        v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
        v_result, 'file_intake_upload_replayed', 'file_intake_upload_replayed', '{}', null
      );
    end if;
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"INVALID_INTAKE_STATE"}'::jsonb);
  end if;
  update remhaos_integration.file_intakes
  set status = 'uploaded_to_quarantine', uploaded_at = statement_timestamp()
  where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_context.organization_id, p_project_id, p_intake_id, 'requested', 'uploaded_to_quarantine',
    'file_uploaded_to_quarantine', 'human', v_context.actor_id, v_context.actor_user_id
  );
  update remhaos_integration.file_intakes
  set status = 'scan_pending'
  where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_context.organization_id, p_project_id, p_intake_id, 'uploaded_to_quarantine', 'scan_pending',
    'file_scan_queued', 'human', v_context.actor_id, v_context.actor_user_id
  );
  v_result := jsonb_build_object('intakeId', p_intake_id, 'status', 'scan_pending');
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'mark_file_intake_uploaded', v_key_digest,
    v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'file_intake_upload_accepted', 'file_intake_upload_accepted', '{}', null
  );
end
$function$;

create function remhaos_integration_api.complete_file_intake_scan(
  p_project_id uuid,
  p_intake_id uuid,
  p_outcome text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intake remhaos_integration.file_intakes%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_status text;
  v_result jsonb;
begin
  if p_outcome not in ('clean', 'infected', 'scan_failed') then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"outcome"}'::jsonb);
  end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.project_id = p_project_id and intake.intake_id = p_intake_id
  for update;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"file_intake"}'::jsonb);
  end if;
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('intakeId', p_intake_id, 'outcome', p_outcome));
  v_replay := remhaos_integration._replay_or_null(
    v_intake.organization_id, p_project_id, 'complete_file_intake_scan', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_intake.status <> 'scan_pending' then
    if v_intake.status = p_outcome then
      v_result := jsonb_build_object('intakeId', p_intake_id, 'status', v_intake.status, 'scanOutcome', p_outcome);
      return remhaos_integration._complete_command(
        v_intake.organization_id, p_project_id, 'complete_file_intake_scan', v_key_digest,
        v_request_digest, 'system', 'system:remhaos-file-scanner', null, v_result,
        'file_scan_replayed', 'file_scan_replayed', '{}', null
      );
    end if;
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"INVALID_INTAKE_STATE"}'::jsonb);
  end if;
  v_status := p_outcome;
  update remhaos_integration.file_intakes
  set status = v_status, scan_outcome = p_outcome, scanned_at = statement_timestamp()
  where organization_id = v_intake.organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_intake.organization_id, p_project_id, p_intake_id, 'scan_pending', v_status,
    'file_scan_completed', 'system', 'system:remhaos-file-scanner', null,
    jsonb_build_object('outcome', p_outcome)
  );
  v_result := jsonb_build_object('intakeId', p_intake_id, 'status', v_status, 'scanOutcome', p_outcome);
  return remhaos_integration._complete_command(
    v_intake.organization_id, p_project_id, 'complete_file_intake_scan', v_key_digest,
    v_request_digest, 'system', 'system:remhaos-file-scanner', null, v_result,
    'file_scan_completed', 'file_scan_completed', jsonb_build_object('outcome', p_outcome), null
  );
end
$function$;

create function remhaos_integration_api.review_file_intake(
  p_project_id uuid,
  p_intake_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intake remhaos_integration.file_intakes%rowtype;
  v_context record;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.project_id = p_project_id and intake.intake_id = p_intake_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"file_intake"}'::jsonb);
  end if;
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'review_source');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  if p_decision not in ('accepted', 'rejected') then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"decision"}'::jsonb);
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or length(btrim(p_reason)) > 2000 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"reason"}'::jsonb);
  end if;
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('decision', p_decision, 'intakeId', p_intake_id, 'reason', btrim(p_reason)));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'review_file_intake', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.organization_id = v_context.organization_id and intake.project_id = p_project_id and intake.intake_id = p_intake_id
  for update;
  if p_decision = 'accepted' and v_intake.status <> 'clean' then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"CLEAN_SCAN_REQUIRED"}'::jsonb);
  end if;
  if p_decision = 'rejected' and v_intake.status not in ('clean', 'scan_failed', 'infected', 'scan_pending') then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"INVALID_INTAKE_STATE"}'::jsonb);
  end if;
  if p_decision = 'accepted' then
    update remhaos_integration.file_intakes
    set status = 'human_reviewed', review_decision = 'accepted', reviewed_at = statement_timestamp(), reviewed_by_user_id = v_context.actor_user_id
    where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
    perform remhaos_integration._record_file_intake_event(
      v_context.organization_id, p_project_id, p_intake_id, 'clean', 'human_reviewed', 'file_human_reviewed',
      'human', v_context.actor_id, v_context.actor_user_id, jsonb_build_object('decision', p_decision)
    );
    update remhaos_integration.file_intakes
    set status = 'ingested_candidate'
    where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
    perform remhaos_integration._record_file_intake_event(
      v_context.organization_id, p_project_id, p_intake_id, 'human_reviewed', 'ingested_candidate', 'file_candidate_ready',
      'human', v_context.actor_id, v_context.actor_user_id, '{}'
    );
  else
    update remhaos_integration.file_intakes
    set status = 'rejected', review_decision = 'rejected', reviewed_at = statement_timestamp(), reviewed_by_user_id = v_context.actor_user_id
    where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
    perform remhaos_integration._record_file_intake_event(
      v_context.organization_id, p_project_id, p_intake_id, v_intake.status, 'rejected', 'file_human_rejected',
      'human', v_context.actor_id, v_context.actor_user_id, jsonb_build_object('decision', p_decision)
    );
  end if;
  v_result := jsonb_build_object('intakeId', p_intake_id, 'status', case when p_decision = 'accepted' then 'ingested_candidate' else 'rejected' end, 'decision', p_decision);
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'review_file_intake', v_key_digest, v_request_digest,
    'human', v_context.actor_id, v_context.actor_user_id, v_result, 'file_intake_reviewed',
    'file_intake_reviewed', jsonb_build_object('decision', p_decision), null
  );
end
$function$;

create function remhaos_integration_api.publish_file_intake(
  p_project_id uuid,
  p_intake_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intake remhaos_integration.file_intakes%rowtype;
  v_context record;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_source_id text;
  v_source_kind text;
  v_result jsonb;
begin
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.project_id = p_project_id and intake.intake_id = p_intake_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"file_intake"}'::jsonb);
  end if;
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'publish_baseline');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('intakeId', p_intake_id));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'publish_file_intake', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.organization_id = v_context.organization_id and intake.project_id = p_project_id and intake.intake_id = p_intake_id
  for update;
  if v_intake.status <> 'ingested_candidate' then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"HUMAN_REVIEW_REQUIRED"}'::jsonb);
  end if;
  if exists (
    select 1 from project_intelligence.sources source
    where source.organization_id = v_context.organization_id and source.project_id = p_project_id and source.checksum = v_intake.checksum
  ) then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"SOURCE_ALREADY_REGISTERED"}'::jsonb);
  end if;
  v_source_id := 'file-intake-' || p_intake_id::text;
  v_source_kind := remhaos_integration._file_intake_source_kind(v_intake.media_type, v_intake.extension);
  insert into project_intelligence.sources (
    organization_id, project_id, source_id, kind, checksum, storage_object_path
  ) values (
    v_context.organization_id, p_project_id, v_source_id, v_source_kind, v_intake.checksum, v_intake.internal_object_key
  );
  insert into projectceo_foundation.source_protected_metadata (
    organization_id, project_id, source_id, package_id, original_filename, media_type,
    size_bytes, extension, source_role, document_status
  ) values (
    v_context.organization_id, p_project_id, v_source_id, v_intake.package_id, v_intake.original_filename,
    v_intake.media_type, v_intake.size_bytes, v_intake.extension, v_intake.source_role, 'current'
  );
  update remhaos_integration.file_intakes
  set status = 'published_internal_copy', source_id = v_source_id,
      published_at = statement_timestamp(), published_by_user_id = v_context.actor_user_id
  where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_context.organization_id, p_project_id, p_intake_id, 'ingested_candidate', 'published_internal_copy',
    'file_internal_copy_published', 'human', v_context.actor_id, v_context.actor_user_id,
    jsonb_build_object('source_id', v_source_id)
  );
  v_result := jsonb_build_object('intakeId', p_intake_id, 'sourceId', v_source_id, 'status', 'published_internal_copy');
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'publish_file_intake', v_key_digest, v_request_digest,
    'human', v_context.actor_id, v_context.actor_user_id, v_result, 'file_internal_copy_published',
    'file_internal_copy_published', jsonb_build_object('source_id', v_source_id), null
  );
end
$function$;

create function remhaos_integration_api.list_file_intakes(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_client boolean;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'view_project');
  select exists (
    select 1 from projectceo_foundation.project_memberships membership
    where membership.organization_id = v_context.organization_id and membership.project_id = p_project_id
      and membership.user_id = v_context.actor_user_id and membership.role = 'client_approver' and membership.status = 'active'
  ) into v_client;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'intakeId', intake.intake_id,
      'projectId', intake.project_id,
      'packageId', case when v_client then null else intake.package_id end,
      'originalFilename', intake.original_filename,
      'mediaType', intake.media_type,
      'extension', intake.extension,
      'sourceRole', intake.source_role,
      'sizeBytes', intake.size_bytes,
      'status', intake.status,
      'scanOutcome', intake.scan_outcome,
      'reviewDecision', intake.review_decision,
      'sourceId', case when v_client then null else intake.source_id end,
      'createdAt', intake.created_at,
      'publishedAt', intake.published_at,
      'createdBy', case when v_client then null else intake.created_by_user_id end,
      'quarantineObjectKey', case when v_client then null else intake.quarantine_object_key end,
      'internalObjectKey', case when v_client then null else intake.internal_object_key end,
      'clientProjection', v_client
    ) order by intake.created_at desc, intake.intake_id)
    from remhaos_integration.file_intakes intake
    where intake.organization_id = v_context.organization_id and intake.project_id = p_project_id
      and (not v_client or intake.status = 'published_internal_copy')
  ), '[]'::jsonb);
end
$function$;

create function remhaos_integration_api.authorize_file_intake_download(
  p_project_id uuid,
  p_intake_id uuid,
  p_ttl_seconds integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_intake remhaos_integration.file_intakes%rowtype;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'view_project');
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 900 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"ttlSeconds"}'::jsonb);
  end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.organization_id = v_context.organization_id and intake.project_id = p_project_id and intake.intake_id = p_intake_id;
  if not found or v_intake.status <> 'published_internal_copy' then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"published_file_intake"}'::jsonb);
  end if;
  return jsonb_build_object(
    'bucket', 'client-uploads', 'objectKey', v_intake.internal_object_key,
    'projectId', p_project_id, 'packageId', v_intake.package_id,
    'sourceId', v_intake.source_id, 'ttlSeconds', p_ttl_seconds
  );
end
$function$;

alter function remhaos_integration._file_intake_policy(text, text, bigint) owner to pi_table_owner;
alter function remhaos_integration._file_intake_source_kind(text, text) owner to pi_table_owner;
alter function remhaos_integration._file_intake_quarantine_key(uuid, uuid, uuid, text, text, text) owner to pi_table_owner;
alter function remhaos_integration._file_intake_internal_key(uuid, uuid, text, text, text) owner to pi_table_owner;
alter function remhaos_integration._record_file_intake_event(uuid, uuid, uuid, text, text, text, text, text, uuid, jsonb) owner to pi_table_owner;
alter function remhaos_integration_api.create_file_intake(uuid, text, text, text, bigint, text, text, text) owner to pi_table_owner;
alter function remhaos_integration_api.mark_file_intake_uploaded(uuid, uuid, text) owner to pi_table_owner;
alter function remhaos_integration_api.get_file_intake_storage(uuid, uuid) owner to pi_table_owner;
alter function remhaos_integration_api.complete_file_intake_scan(uuid, uuid, text, text) owner to pi_table_owner;
alter function remhaos_integration_api.review_file_intake(uuid, uuid, text, text, text) owner to pi_table_owner;
alter function remhaos_integration_api.publish_file_intake(uuid, uuid, text) owner to pi_table_owner;
alter function remhaos_integration_api.list_file_intakes(uuid) owner to pi_table_owner;
alter function remhaos_integration_api.authorize_file_intake_download(uuid, uuid, integer) owner to pi_table_owner;

revoke all on table remhaos_integration.file_intakes, remhaos_integration.file_intake_events
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._file_intake_policy(text, text, bigint)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._file_intake_source_kind(text, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._file_intake_quarantine_key(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._file_intake_internal_key(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._record_file_intake_event(uuid, uuid, uuid, text, text, text, text, text, uuid, jsonb)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.create_file_intake(uuid, text, text, text, bigint, text, text, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.mark_file_intake_uploaded(uuid, uuid, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.get_file_intake_storage(uuid, uuid)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.complete_file_intake_scan(uuid, uuid, text, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.review_file_intake(uuid, uuid, text, text, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.publish_file_intake(uuid, uuid, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.list_file_intakes(uuid)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.authorize_file_intake_download(uuid, uuid, integer)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
grant execute on function
  remhaos_integration_api.create_file_intake(uuid, text, text, text, bigint, text, text, text),
  remhaos_integration_api.mark_file_intake_uploaded(uuid, uuid, text),
  remhaos_integration_api.get_file_intake_storage(uuid, uuid),
  remhaos_integration_api.review_file_intake(uuid, uuid, text, text, text),
  remhaos_integration_api.publish_file_intake(uuid, uuid, text),
  remhaos_integration_api.list_file_intakes(uuid),
  remhaos_integration_api.authorize_file_intake_download(uuid, uuid, integer)
  to authenticated;
grant execute on function remhaos_integration_api.complete_file_intake_scan(uuid, uuid, text, text)
  to pi_worker_executor;

commit;
