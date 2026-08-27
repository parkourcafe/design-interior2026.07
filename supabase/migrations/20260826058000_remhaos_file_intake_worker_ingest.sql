-- RemHaOS Integration Gateway PR6: worker-owned Drive quarantine ingest.
--
-- Additive only. Human review and publication remain on the authenticated
-- file-intake commands; these commands only create and advance quarantine
-- state on behalf of a verified integration worker.

begin;

alter table remhaos_integration.file_intakes
  alter column created_by_user_id drop not null;

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
    'create_file_intake_worker',
    'mark_file_intake_uploaded',
    'mark_file_intake_uploaded_worker',
    'complete_file_intake_scan',
    'review_file_intake',
    'publish_file_intake',
    'bind_telegram_chat',
    'migrate_telegram_chat',
    'ingest_telegram_update',
    'complete_telegram_ingestion_job',
    'fail_telegram_ingestion_job',
    'review_telegram_candidate',
    'create_oauth_intent',
    'create_google_drive_webhook_channel',
    'stop_google_drive_webhook_channel',
    'record_google_drive_notification',
    'mark_google_drive_reauth_required'
  ));

create function remhaos_integration_api.create_file_intake_worker(
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
  v_organization_id uuid;
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
  select pw.organization_id, pw.state_revision
    into v_organization_id, v_state_revision
  from project_intelligence.project_workflows pw
  where pw.project_id = p_project_id
  for update;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"project"}'::jsonb);
  end if;

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
  where pp.organization_id = v_organization_id
    and pp.project_id = p_project_id
    and pp.kind = 'project_root'
    and pp.status = 'active';
  if v_package_id is null then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"project_package"}'::jsonb);
  end if;

  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
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
  v_replay := remhaos_integration._replay_or_null(
    v_organization_id, p_project_id, 'create_file_intake_worker', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_existing
  from remhaos_integration.file_intakes intake
  where intake.organization_id = v_organization_id
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
      v_organization_id, p_project_id, 'create_file_intake_worker', v_key_digest,
      v_request_digest, 'system', 'system:google-drive-import-worker', null,
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
    v_organization_id, p_project_id, v_intake_id, v_package_id, v_filename,
    v_policy ->> 'mediaType', v_policy ->> 'extension', p_source_role, p_size_bytes, v_checksum,
    remhaos_integration._file_intake_quarantine_key(
      v_organization_id, p_project_id, v_intake_id, v_checksum_hex, p_source_role, v_extension
    ),
    remhaos_integration._file_intake_internal_key(
      v_organization_id, p_project_id, v_checksum_hex, p_source_role, v_extension
    ),
    'requested', null
  );
  perform remhaos_integration._record_file_intake_event(
    v_organization_id, p_project_id, v_intake_id, null, 'requested',
    'file_intake_requested', 'system', 'system:google-drive-import-worker', null,
    jsonb_build_object('extension', v_extension, 'media_type', v_media_type, 'size_bytes', p_size_bytes)
  );
  v_result := jsonb_build_object(
    'intakeId', v_intake_id,
    'organizationId', v_organization_id,
    'projectId', p_project_id,
    'packageId', v_package_id,
    'bucket', 'client-uploads',
    'checksumHex', v_checksum_hex,
    'mediaType', v_policy ->> 'mediaType',
    'extension', v_policy ->> 'extension',
    'sourceRole', p_source_role,
    'objectKey', remhaos_integration._file_intake_quarantine_key(
      v_organization_id, p_project_id, v_intake_id, v_checksum_hex, p_source_role, v_extension
    ),
    'internalObjectKey', remhaos_integration._file_intake_internal_key(
      v_organization_id, p_project_id, v_checksum_hex, p_source_role, v_extension
    ),
    'status', 'requested',
    'reused', false
  );
  return remhaos_integration._complete_command(
    v_organization_id, p_project_id, 'create_file_intake_worker', v_key_digest,
    v_request_digest, 'system', 'system:google-drive-import-worker', null,
    v_result, 'file_intake_requested', 'file_intake_requested',
    jsonb_build_object('intake_id', v_intake_id, 'status', 'requested'), null
  );
end
$function$;

create function remhaos_integration_api.mark_file_intake_uploaded_worker(
  p_project_id uuid,
  p_intake_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intake remhaos_integration.file_intakes%rowtype;
  v_organization_id uuid;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select pw.organization_id into v_organization_id
  from project_intelligence.project_workflows pw
  where pw.project_id = p_project_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"project"}'::jsonb);
  end if;

  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.organization_id = v_organization_id
    and intake.project_id = p_project_id
    and intake.intake_id = p_intake_id
  for update;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"file_intake"}'::jsonb);
  end if;

  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('intakeId', p_intake_id));
  v_replay := remhaos_integration._replay_or_null(
    v_organization_id, p_project_id, 'mark_file_intake_uploaded_worker', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  if v_intake.status <> 'requested' then
    if v_intake.status in ('uploaded_to_quarantine', 'scan_pending') then
      v_result := jsonb_build_object('intakeId', p_intake_id, 'status', v_intake.status);
      return remhaos_integration._complete_command(
        v_organization_id, p_project_id, 'mark_file_intake_uploaded_worker', v_key_digest,
        v_request_digest, 'system', 'system:google-drive-import-worker', null,
        v_result, 'file_intake_upload_replayed', 'file_intake_upload_replayed', '{}', null
      );
    end if;
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"INVALID_INTAKE_STATE"}'::jsonb);
  end if;

  update remhaos_integration.file_intakes
  set status = 'uploaded_to_quarantine', uploaded_at = statement_timestamp()
  where organization_id = v_organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_organization_id, p_project_id, p_intake_id, 'requested', 'uploaded_to_quarantine',
    'file_uploaded_to_quarantine', 'system', 'system:google-drive-import-worker', null
  );
  update remhaos_integration.file_intakes
  set status = 'scan_pending'
  where organization_id = v_organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_organization_id, p_project_id, p_intake_id, 'uploaded_to_quarantine', 'scan_pending',
    'file_scan_queued', 'system', 'system:google-drive-import-worker', null
  );
  v_result := jsonb_build_object('intakeId', p_intake_id, 'status', 'scan_pending');
  return remhaos_integration._complete_command(
    v_organization_id, p_project_id, 'mark_file_intake_uploaded_worker', v_key_digest,
    v_request_digest, 'system', 'system:google-drive-import-worker', null,
    v_result, 'file_intake_upload_accepted', 'file_intake_upload_accepted', '{}', null
  );
end
$function$;

alter function remhaos_integration_api.create_file_intake_worker(uuid, text, text, text, bigint, text, text, text)
  owner to pi_table_owner;
alter function remhaos_integration_api.mark_file_intake_uploaded_worker(uuid, uuid, text)
  owner to pi_table_owner;

revoke all on function remhaos_integration_api.create_file_intake_worker(uuid, text, text, text, bigint, text, text, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.mark_file_intake_uploaded_worker(uuid, uuid, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
grant execute on function remhaos_integration_api.create_file_intake_worker(uuid, text, text, text, bigint, text, text, text)
  to pi_worker_executor;
grant execute on function remhaos_integration_api.mark_file_intake_uploaded_worker(uuid, uuid, text)
  to pi_worker_executor;

commit;
