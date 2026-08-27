-- RemHaOS Integration Gateway PR6: stop retry storms after a revoked Drive
-- credential. The provider/secret adapter revokes the credential; this
-- worker-only transition fences local channels and jobs.

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
    'create_project_link',
    'revise_project_link',
    'archive_project_link',
    'publish_project_link_to_client',
    'review_import_candidate',
    'record_verified_webhook',
    'enqueue_integration_job',
    'complete_integration_job',
    'fail_integration_job',
    'upsert_external_object',
    'create_import_candidate',
    'create_file_intake',
    'mark_file_intake_uploaded',
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

create function remhaos_integration.google_drive_stop_work_on_auth_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status is distinct from new.status
     and new.provider_code = 'google_drive'
     and new.status in ('disconnected', 'reauth_required') then
    update remhaos_integration.google_drive_webhook_channels channel
    set status = 'stopped',
        stopped_at = coalesce(channel.stopped_at, statement_timestamp())
    where channel.organization_id = new.organization_id
      and channel.connection_id = new.id
      and channel.status = 'active';

    update remhaos_integration.sync_jobs job
    set status = case
          when new.status = 'disconnected' then 'cancelled'
          else 'dead_letter'
        end,
        last_error_code = case
          when new.status = 'disconnected' then 'connection_disconnected'
          else 'reauth_required'
        end,
        lease_token = null,
        lease_expires_at = null,
        finished_at = coalesce(job.finished_at, statement_timestamp())
    where job.organization_id = new.organization_id
      and job.connection_id = new.id
      and job.status in ('queued', 'retryable_failed', 'leased');
  end if;
  return new;
end
$function$;

create trigger google_drive_stop_work_after_auth_loss
  after update of status on remhaos_integration.connections
  for each row
  when (new.provider_code = 'google_drive')
  execute function remhaos_integration.google_drive_stop_work_on_auth_loss();

create function remhaos_integration.reject_google_drive_jobs_without_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status in ('queued', 'retryable_failed', 'leased')
     and exists (
       select 1
       from remhaos_integration.connections connection
       where connection.organization_id = new.organization_id
         and connection.id = new.connection_id
         and connection.provider_code = 'google_drive'
         and connection.status = 'reauth_required'
     ) then
    perform remhaos_integration._raise(
      'P1205',
      'reauth_required',
      '{"entity":"googleDriveConnection"}'::jsonb
    );
  end if;
  return new;
end
$function$;

create trigger google_drive_reject_jobs_without_auth
  before insert or update of status, connection_id on remhaos_integration.sync_jobs
  for each row
  execute function remhaos_integration.reject_google_drive_jobs_without_auth();

create function remhaos_integration_api.mark_google_drive_reauth_required(
  p_organization_id uuid,
  p_connection_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_connection remhaos_integration.connections%rowtype;
  v_reason text := remhaos_integration._assert_reason(p_reason);
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_connection
  from remhaos_integration.connections connection
  where connection.organization_id = p_organization_id
    and connection.id = p_connection_id
    and connection.provider_code = 'google_drive'
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"googleDriveConnection"}'::jsonb
    );
  end if;
  if v_connection.status not in ('connected', 'degraded', 'reauth_required') then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"connectionStatus","reason":"REAUTH_NOT_ALLOWED"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'connectionId', p_connection_id,
    'reason', v_reason
  ));
  v_replay := remhaos_integration._replay_or_null(
    p_organization_id,
    null,
    'mark_google_drive_reauth_required',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  update remhaos_integration.connections connection
  set status = 'reauth_required',
      updated_at = statement_timestamp()
  where connection.organization_id = p_organization_id
    and connection.id = p_connection_id
  returning * into v_connection;

  v_result := jsonb_build_object(
    'connectionId', v_connection.id,
    'providerCode', v_connection.provider_code,
    'status', v_connection.status
  );
  return remhaos_integration._complete_command(
    p_organization_id,
    null,
    'mark_google_drive_reauth_required',
    v_key_digest,
    v_request_digest,
    'system',
    'system:google-drive-auth',
    null,
    v_result,
    'google_drive_reauth_required',
    'reauth_required',
    jsonb_build_object('reasonCode', 'provider_credential_revoked', 'reason', v_reason)
  );
end
$function$;

alter function remhaos_integration.google_drive_stop_work_on_auth_loss() owner to pi_table_owner;
alter function remhaos_integration.reject_google_drive_jobs_without_auth() owner to pi_table_owner;
alter function remhaos_integration_api.mark_google_drive_reauth_required(
  uuid, uuid, text, text
) owner to pi_table_owner;

revoke all on function remhaos_integration.google_drive_stop_work_on_auth_loss()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration.reject_google_drive_jobs_without_auth()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.mark_google_drive_reauth_required(
  uuid, uuid, text, text
) from public, anon, authenticated, pi_human_executor;
grant execute on function remhaos_integration_api.mark_google_drive_reauth_required(
  uuid, uuid, text, text
) to service_role, pi_worker_executor;

commit;
