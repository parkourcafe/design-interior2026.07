-- RemHaOS Integration Gateway: transport-only queue and credential lookups.
--
-- Additive only. Raw provider values stay in the selected SecretStore; this
-- migration stores only opaque references and bounded job metadata.

begin;

create function remhaos_integration_api.resolve_telegram_webhook_binding(
  p_chat_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_count integer;
  v_binding record;
begin
  if p_chat_id is null or p_chat_id = 0 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"chatId"}'::jsonb);
  end if;
  select count(*)::integer into v_count
  from remhaos_integration.telegram_bindings binding
  where binding.chat_id = p_chat_id and binding.status = 'active';
  if v_count = 0 then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"telegramBinding"}'::jsonb);
  end if;
  if v_count > 1 then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"TELEGRAM_CHAT_AMBIGUOUS"}'::jsonb);
  end if;
  select binding.organization_id, binding.project_id, binding.binding_id
    into v_binding
  from remhaos_integration.telegram_bindings binding
  where binding.chat_id = p_chat_id and binding.status = 'active';
  return jsonb_build_object(
    'organizationId', v_binding.organization_id,
    'projectId', v_binding.project_id,
    'bindingId', v_binding.binding_id
  );
end
$function$;

create function remhaos_integration_api.get_integration_credential_ref(
  p_connection_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_connection remhaos_integration.connections%rowtype;
begin
  select * into v_connection
  from remhaos_integration.connections connection
  where connection.id = p_connection_id
    and connection.status <> 'disconnected';
  if not found or v_connection.credential_ref is null then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"integrationCredential"}'::jsonb);
  end if;
  return jsonb_build_object(
    'connectionId', v_connection.id,
    'organizationId', v_connection.organization_id,
    'providerCode', v_connection.provider_code,
    'credentialRef', v_connection.credential_ref,
    'status', v_connection.status,
    'tokenExpiresAt', v_connection.token_expires_at
  );
end
$function$;

create function remhaos_integration_api.claim_selected_google_drive_import_jobs(
  p_limit integer,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50
     or p_lease_seconds is null
     or p_lease_seconds < 1
     or p_lease_seconds > 3600 then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"lease"}'::jsonb
    );
  end if;

  with next_jobs as (
    select job.id
    from remhaos_integration.sync_jobs job
    where job.job_kind = 'selected_object_import'
      and (
        job.status in ('queued', 'retryable_failed')
        or (
          job.status = 'leased'
          and job.lease_expires_at <= statement_timestamp()
        )
      )
      and job.available_at <= statement_timestamp()
    order by job.available_at, job.id
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update remhaos_integration.sync_jobs job
    set status = 'leased',
        attempt_count = job.attempt_count + 1,
        lease_token = extensions.gen_random_uuid(),
        lease_expires_at =
          statement_timestamp() + make_interval(secs => p_lease_seconds),
        last_error_code = null
    where job.id in (select next_jobs.id from next_jobs)
    returning job.*
  )
  select jsonb_agg(
    jsonb_build_object(
      'jobId', claimed.id,
      'organizationId', claimed.organization_id,
      'projectId', claimed.project_id,
      'connectionId', claimed.connection_id,
      'jobKind', claimed.job_kind,
      'attemptCount', claimed.attempt_count,
      'leaseToken', claimed.lease_token,
      'leaseExpiresAt', claimed.lease_expires_at,
      'inputRef', claimed.input_ref
    )
    order by claimed.available_at, claimed.id
  )
  into v_result
  from claimed;

  return coalesce(v_result, '[]'::jsonb);
end
$function$;

create function remhaos_integration_api.list_google_drive_webhook_channels(
  p_connection_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'channelId', channel.channel_id,
      'status', channel.status,
      'expiresAt', channel.expires_at
    ) order by channel.created_at, channel.channel_id
  ), '[]'::jsonb)
  from remhaos_integration.google_drive_webhook_channels channel
  where channel.connection_id = p_connection_id
    and channel.status = 'active'
$function$;

create function remhaos_integration.cancel_integration_jobs_on_disconnect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status <> 'disconnected' and new.status = 'disconnected' then
    update remhaos_integration.sync_jobs job
    set status = 'cancelled',
        lease_token = null,
        lease_expires_at = null,
        finished_at = coalesce(job.finished_at, statement_timestamp()),
        last_error_code = 'connection_disconnected'
    where job.organization_id = new.organization_id
      and job.connection_id = new.id
      and job.status in ('queued', 'leased', 'retryable_failed');
  end if;
  return new;
end
$function$;

create trigger cancel_integration_jobs_after_disconnect
  after update of status on remhaos_integration.connections
  for each row
  when (new.status = 'disconnected')
  execute function remhaos_integration.cancel_integration_jobs_on_disconnect();

create function remhaos_integration_api.request_selected_google_drive_import(
  p_project_id uuid,
  p_project_connection_id uuid,
  p_selection_ref text,
  p_source_role text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_binding remhaos_integration.project_connections%rowtype;
  v_connection remhaos_integration.connections%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_job remhaos_integration.sync_jobs%rowtype;
  v_selection_ref text := btrim(coalesce(p_selection_ref, ''));
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    p_project_id, 'manage_project_integrations'
  );
  if v_selection_ref !~ '^selection:google-drive:[a-f0-9]{64}$' then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"selectionRef"}'::jsonb);
  end if;
  if p_source_role not in (
    'document', 'drawing-preview', 'reference', 'photo-evidence', 'correspondence', 'schedule'
  ) then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"sourceRole"}'::jsonb);
  end if;
  select * into v_binding
  from remhaos_integration.project_connections binding
  where binding.id = p_project_connection_id
    and binding.organization_id = v_context.organization_id
    and binding.project_id = p_project_id
    and binding.unbound_at is null
  for update;
  if not found or not v_binding.allowed_capabilities @> array['import_object']::text[] then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"projectConnection"}'::jsonb);
  end if;
  select * into v_connection
  from remhaos_integration.connections connection
  where connection.organization_id = v_context.organization_id
    and connection.id = v_binding.connection_id
    and connection.provider_code = 'google_drive'
    and connection.status in ('connected', 'degraded')
  for update;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"connection"}'::jsonb);
  end if;
  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'projectId', p_project_id,
    'projectConnectionId', p_project_connection_id,
    'selectionRef', v_selection_ref,
    'sourceRole', p_source_role
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'enqueue_integration_job',
    v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  insert into remhaos_integration.sync_jobs (
    organization_id, project_id, connection_id, job_kind, idempotency_key, input_ref
  ) values (
    v_context.organization_id, p_project_id, v_connection.id, 'selected_object_import',
    encode(v_key_digest, 'hex'), jsonb_build_object(
      'selectionMode', 'explicit_selected_object',
      'selectionRef', v_selection_ref,
      'projectConnectionId', p_project_connection_id,
      'sourceRole', p_source_role
    )
  )
  on conflict (organization_id, project_id, job_kind, idempotency_key)
  do update set id = remhaos_integration.sync_jobs.id
  returning * into v_job;
  v_result := jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'jobKind', v_job.job_kind,
    'selectionMode', 'explicit_selected_object'
  );
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'enqueue_integration_job',
    v_key_digest, v_request_digest, 'human', v_context.actor_id,
    v_context.actor_user_id, v_result, 'integration_job_enqueued', v_job.status,
    jsonb_build_object('providerCode', 'google_drive', 'reasonCode', 'selected_object_import')
  );
end
$function$;

alter function remhaos_integration_api.resolve_telegram_webhook_binding(bigint)
  owner to pi_table_owner;
alter function remhaos_integration_api.get_integration_credential_ref(uuid)
  owner to pi_table_owner;
alter function remhaos_integration_api.claim_selected_google_drive_import_jobs(integer, integer)
  owner to pi_table_owner;
alter function remhaos_integration_api.list_google_drive_webhook_channels(uuid)
  owner to pi_table_owner;
alter function remhaos_integration.cancel_integration_jobs_on_disconnect()
  owner to pi_table_owner;
alter function remhaos_integration_api.request_selected_google_drive_import(uuid, uuid, text, text, text)
  owner to pi_table_owner;

revoke all on function remhaos_integration_api.resolve_telegram_webhook_binding(bigint)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.get_integration_credential_ref(uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.claim_selected_google_drive_import_jobs(integer, integer)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.list_google_drive_webhook_channels(uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration.cancel_integration_jobs_on_disconnect()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.request_selected_google_drive_import(uuid, uuid, text, text, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;

grant execute on function remhaos_integration_api.resolve_telegram_webhook_binding(bigint)
  to service_role, pi_worker_executor;
grant execute on function remhaos_integration_api.get_integration_credential_ref(uuid)
  to service_role, pi_worker_executor;
grant execute on function remhaos_integration_api.claim_selected_google_drive_import_jobs(integer, integer)
  to service_role, pi_worker_executor;
grant execute on function remhaos_integration_api.list_google_drive_webhook_channels(uuid)
  to service_role, pi_worker_executor;
grant execute on function remhaos_integration_api.request_selected_google_drive_import(uuid, uuid, text, text, text)
  to authenticated;

commit;
