-- RemHaOS Integration Gateway PR6: Google Drive channel lifecycle and
-- hash-only notification dedupe. Provider identifiers and payloads stay out
-- of business tables; the worker resolves the current Drive revision later.

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
    'record_google_drive_notification'
  ));

alter table remhaos_integration.google_drive_webhook_channels
  add constraint google_drive_channels_scope_key
  unique (organization_id, connection_id, channel_id);

create table remhaos_integration.google_drive_webhook_notifications (
  organization_id uuid not null,
  connection_id uuid not null,
  channel_id uuid not null,
  notification_id_hash bytea not null check (octet_length(notification_id_hash) = 32),
  provider_resource_id_hash bytea not null check (octet_length(provider_resource_id_hash) = 32),
  resource_state_hash bytea not null check (octet_length(resource_state_hash) = 32),
  received_at timestamptz not null default statement_timestamp(),
  constraint google_drive_notifications_organization_fkey
    foreign key (organization_id)
    references project_intelligence.organizations (id)
    on delete restrict,
  constraint google_drive_notifications_connection_fkey
    foreign key (organization_id, connection_id)
    references remhaos_integration.connections (organization_id, id)
    on delete restrict,
  constraint google_drive_notifications_channel_fkey
    foreign key (organization_id, connection_id, channel_id)
    references remhaos_integration.google_drive_webhook_channels (
      organization_id, connection_id, channel_id
    )
    on delete restrict,
  constraint google_drive_notifications_delivery_key
    unique (organization_id, connection_id, notification_id_hash)
);

create index google_drive_notifications_channel_idx
  on remhaos_integration.google_drive_webhook_notifications (
    organization_id, connection_id, channel_id, received_at desc
  );

create function remhaos_integration_api.create_google_drive_webhook_channel(
  p_organization_id uuid,
  p_connection_id uuid,
  p_provider_channel_id_hash bytea,
  p_provider_resource_id_hash bytea,
  p_expires_at timestamptz,
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
  v_channel remhaos_integration.google_drive_webhook_channels%rowtype;
  v_channel_hash bytea := remhaos_integration._assert_bytea_32(
    p_provider_channel_id_hash,
    'providerChannelIdHash'
  );
  v_resource_hash bytea := remhaos_integration._assert_bytea_32(
    p_provider_resource_id_hash,
    'providerResourceIdHash'
  );
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
    and connection.status in ('connected', 'degraded');
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"googleDriveConnection"}'::jsonb
    );
  end if;
  if p_expires_at is null
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '31 days' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"expiresAt"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'connectionId', p_connection_id,
    'expiresAt', p_expires_at,
    'providerChannelIdHash', encode(v_channel_hash, 'hex'),
    'providerResourceIdHash', encode(v_resource_hash, 'hex')
  ));
  v_replay := remhaos_integration._replay_or_null(
    p_organization_id,
    null,
    'create_google_drive_webhook_channel',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  insert into remhaos_integration.google_drive_webhook_channels (
    organization_id,
    connection_id,
    provider_channel_id_hash,
    provider_resource_id_hash,
    status,
    expires_at,
    stopped_at
  ) values (
    p_organization_id,
    p_connection_id,
    v_channel_hash,
    v_resource_hash,
    'active',
    p_expires_at,
    null
  )
  on conflict (organization_id, connection_id, provider_channel_id_hash)
  do update set
    provider_resource_id_hash = excluded.provider_resource_id_hash,
    status = 'active',
    expires_at = excluded.expires_at,
    stopped_at = null
  returning * into v_channel;

  v_result := jsonb_build_object(
    'channelId', v_channel.channel_id,
    'connectionId', v_channel.connection_id,
    'status', v_channel.status,
    'expiresAt', v_channel.expires_at
  );
  return remhaos_integration._complete_command(
    p_organization_id,
    null,
    'create_google_drive_webhook_channel',
    v_key_digest,
    v_request_digest,
    'system',
    'system:google-drive-worker',
    null,
    v_result,
    'google_drive_webhook_channel_created',
    'active',
    jsonb_build_object('providerCode', v_connection.provider_code)
  );
end
$function$;

create function remhaos_integration_api.stop_google_drive_webhook_channel(
  p_organization_id uuid,
  p_connection_id uuid,
  p_channel_id uuid,
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
  v_channel remhaos_integration.google_drive_webhook_channels%rowtype;
  v_reason text := remhaos_integration._assert_reason(p_reason);
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_channel
  from remhaos_integration.google_drive_webhook_channels channel
  where channel.organization_id = p_organization_id
    and channel.connection_id = p_connection_id
    and channel.channel_id = p_channel_id
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"googleDriveWebhookChannel"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'channelId', p_channel_id,
    'connectionId', p_connection_id,
    'reason', v_reason
  ));
  v_replay := remhaos_integration._replay_or_null(
    p_organization_id,
    null,
    'stop_google_drive_webhook_channel',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  update remhaos_integration.google_drive_webhook_channels channel
  set status = case when channel.status = 'active' then 'stopped' else channel.status end,
      stopped_at = coalesce(channel.stopped_at, statement_timestamp())
  where channel.organization_id = p_organization_id
    and channel.connection_id = p_connection_id
    and channel.channel_id = p_channel_id
  returning * into v_channel;

  v_result := jsonb_build_object(
    'channelId', v_channel.channel_id,
    'connectionId', v_channel.connection_id,
    'status', v_channel.status
  );
  return remhaos_integration._complete_command(
    p_organization_id,
    null,
    'stop_google_drive_webhook_channel',
    v_key_digest,
    v_request_digest,
    'system',
    'system:google-drive-worker',
    null,
    v_result,
    'google_drive_webhook_channel_stopped',
    v_channel.status,
    jsonb_build_object('reasonCode', 'provider_channel_stop', 'reason', v_reason)
  );
end
$function$;

create function remhaos_integration_api.expire_google_drive_webhook_channels()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  update remhaos_integration.google_drive_webhook_channels channel
  set status = 'expired',
      stopped_at = statement_timestamp()
  where channel.status = 'active'
    and channel.expires_at <= statement_timestamp();
  get diagnostics v_count = row_count;
  return jsonb_build_object(
    'operation', 'expire_google_drive_webhook_channels',
    'replay', false,
    'result', jsonb_build_object('expiredCount', v_count)
  );
end
$function$;

create function remhaos_integration_api.resolve_google_drive_webhook_channel(
  p_provider_channel_id_hash bytea,
  p_provider_resource_id_hash bytea
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_channel remhaos_integration.google_drive_webhook_channels%rowtype;
  v_channel_hash bytea := remhaos_integration._assert_bytea_32(
    p_provider_channel_id_hash,
    'providerChannelIdHash'
  );
  v_resource_hash bytea := remhaos_integration._assert_bytea_32(
    p_provider_resource_id_hash,
    'providerResourceIdHash'
  );
begin
  select * into v_channel
  from remhaos_integration.google_drive_webhook_channels channel
  where channel.provider_channel_id_hash = v_channel_hash
    and channel.provider_resource_id_hash = v_resource_hash
    and channel.status = 'active'
    and channel.expires_at > statement_timestamp();
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"googleDriveWebhookChannel"}'::jsonb
    );
  end if;
  return jsonb_build_object(
    'organizationId', v_channel.organization_id,
    'connectionId', v_channel.connection_id,
    'channelId', v_channel.channel_id
  );
end
$function$;

create function remhaos_integration_api.record_google_drive_notification(
  p_organization_id uuid,
  p_connection_id uuid,
  p_channel_id uuid,
  p_provider_channel_id_hash bytea,
  p_provider_resource_id_hash bytea,
  p_notification_id_hash bytea,
  p_resource_state_hash bytea,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_channel remhaos_integration.google_drive_webhook_channels%rowtype;
  v_notification remhaos_integration.google_drive_webhook_notifications%rowtype;
  v_project_id uuid;
  v_channel_hash bytea := remhaos_integration._assert_bytea_32(
    p_provider_channel_id_hash,
    'providerChannelIdHash'
  );
  v_resource_hash bytea := remhaos_integration._assert_bytea_32(
    p_provider_resource_id_hash,
    'providerResourceIdHash'
  );
  v_notification_hash bytea := remhaos_integration._assert_bytea_32(
    p_notification_id_hash,
    'notificationIdHash'
  );
  v_state_hash bytea := remhaos_integration._assert_bytea_32(
    p_resource_state_hash,
    'resourceStateHash'
  );
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
  v_jobs integer := 0;
  v_inserted integer;
begin
  select * into v_channel
  from remhaos_integration.google_drive_webhook_channels channel
  where channel.organization_id = p_organization_id
    and channel.connection_id = p_connection_id
    and channel.channel_id = p_channel_id
    and channel.provider_channel_id_hash = v_channel_hash
    and channel.provider_resource_id_hash = v_resource_hash
    and channel.status = 'active'
    and channel.expires_at > statement_timestamp()
  for update;
  if not found then
    if exists (
      select 1
      from remhaos_integration.google_drive_webhook_channels channel
      where channel.organization_id = p_organization_id
        and channel.connection_id = p_connection_id
        and channel.channel_id = p_channel_id
        and channel.status in ('expired', 'stopped')
    ) then
      perform remhaos_integration._raise(
        'P1205',
        'expired',
        '{"entity":"googleDriveWebhookChannel"}'::jsonb
      );
    end if;
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"googleDriveWebhookChannel"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'channelId', p_channel_id,
    'connectionId', p_connection_id,
    'notificationIdHash', encode(v_notification_hash, 'hex'),
    'providerChannelIdHash', encode(v_channel_hash, 'hex'),
    'providerResourceIdHash', encode(v_resource_hash, 'hex'),
    'resourceStateHash', encode(v_state_hash, 'hex')
  ));
  v_replay := remhaos_integration._replay_or_null(
    p_organization_id,
    null,
    'record_google_drive_notification',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  insert into remhaos_integration.google_drive_webhook_notifications (
    organization_id,
    connection_id,
    channel_id,
    notification_id_hash,
    provider_resource_id_hash,
    resource_state_hash
  ) values (
    p_organization_id,
    p_connection_id,
    p_channel_id,
    v_notification_hash,
    v_resource_hash,
    v_state_hash
  )
  on conflict (organization_id, connection_id, notification_id_hash) do nothing
  returning * into v_notification;

  if not found then
    v_result := jsonb_build_object(
      'connectionId', p_connection_id,
      'status', 'duplicate',
      'jobsEnqueued', 0
    );
  else
    for v_project_id in
      select project_connection.project_id
      from remhaos_integration.project_connections project_connection
      where project_connection.organization_id = p_organization_id
        and project_connection.connection_id = p_connection_id
        and project_connection.unbound_at is null
    loop
      insert into remhaos_integration.sync_jobs (
        organization_id,
        project_id,
        connection_id,
        job_kind,
        idempotency_key,
        input_ref
      ) values (
        p_organization_id,
        v_project_id,
        p_connection_id,
        'google_drive_change_signal',
        encode(project_intelligence._sha256_text(
          encode(v_notification.notification_id_hash, 'hex') || ':' || v_project_id::text
        ), 'hex'),
        jsonb_build_object(
          'notificationHash', encode(v_notification.notification_id_hash, 'hex'),
          'resourceStateHash', encode(v_notification.resource_state_hash, 'hex')
        )
      )
      on conflict (organization_id, project_id, job_kind, idempotency_key) do nothing;
      get diagnostics v_inserted = row_count;
      v_jobs := v_jobs + v_inserted;
    end loop;
    v_result := jsonb_build_object(
      'connectionId', p_connection_id,
      'status', 'enqueued',
      'jobsEnqueued', v_jobs
    );
  end if;

  return remhaos_integration._complete_command(
    p_organization_id,
    null,
    'record_google_drive_notification',
    v_key_digest,
    v_request_digest,
    'system',
    'system:google-drive-webhook',
    null,
    v_result,
    'google_drive_notification_recorded',
    v_result ->> 'status',
    jsonb_build_object('providerCode', 'google_drive')
  );
end
$function$;

create function remhaos_integration.google_drive_stop_channels_on_disconnect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status <> 'disconnected' and new.status = 'disconnected' then
    update remhaos_integration.google_drive_webhook_channels channel
    set status = 'stopped',
        stopped_at = coalesce(channel.stopped_at, statement_timestamp())
    where channel.organization_id = new.organization_id
      and channel.connection_id = new.id
      and channel.status = 'active';
  end if;
  return new;
end
$function$;

create trigger google_drive_stop_channels_after_disconnect
  after update of status on remhaos_integration.connections
  for each row
  when (new.provider_code = 'google_drive')
  execute function remhaos_integration.google_drive_stop_channels_on_disconnect();

alter table remhaos_integration.google_drive_webhook_notifications owner to pi_table_owner;
alter table remhaos_integration.google_drive_webhook_notifications enable row level security;
alter table remhaos_integration.google_drive_webhook_notifications force row level security;
create policy google_drive_notifications_owner_only
  on remhaos_integration.google_drive_webhook_notifications as permissive for all to pi_table_owner
  using (true) with check (true);

alter function remhaos_integration_api.create_google_drive_webhook_channel(
  uuid, uuid, bytea, bytea, timestamptz, text
) owner to pi_table_owner;
alter function remhaos_integration_api.stop_google_drive_webhook_channel(
  uuid, uuid, uuid, text, text
) owner to pi_table_owner;
alter function remhaos_integration_api.expire_google_drive_webhook_channels() owner to pi_table_owner;
alter function remhaos_integration_api.resolve_google_drive_webhook_channel(bytea, bytea) owner to pi_table_owner;
alter function remhaos_integration_api.record_google_drive_notification(
  uuid, uuid, uuid, bytea, bytea, bytea, bytea, text
) owner to pi_table_owner;
alter function remhaos_integration.google_drive_stop_channels_on_disconnect() owner to pi_table_owner;

revoke all on table remhaos_integration.google_drive_webhook_notifications
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.create_google_drive_webhook_channel(
  uuid, uuid, bytea, bytea, timestamptz, text
) from public, anon, authenticated, service_role, pi_human_executor;
revoke all on function remhaos_integration_api.stop_google_drive_webhook_channel(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role, pi_human_executor;
revoke all on function remhaos_integration_api.expire_google_drive_webhook_channels()
  from public, anon, authenticated, service_role, pi_human_executor;
revoke all on function remhaos_integration_api.resolve_google_drive_webhook_channel(bytea, bytea)
  from public, anon, authenticated, service_role, pi_human_executor;
revoke all on function remhaos_integration_api.record_google_drive_notification(
  uuid, uuid, uuid, bytea, bytea, bytea, bytea, text
) from public, anon, authenticated, service_role, pi_human_executor;
revoke all on function remhaos_integration.google_drive_stop_channels_on_disconnect()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
grant execute on function remhaos_integration_api.create_google_drive_webhook_channel(
  uuid, uuid, bytea, bytea, timestamptz, text
) to pi_worker_executor;
grant execute on function remhaos_integration_api.stop_google_drive_webhook_channel(
  uuid, uuid, uuid, text, text
) to pi_worker_executor;
grant execute on function remhaos_integration_api.expire_google_drive_webhook_channels()
  to pi_worker_executor;
grant execute on function remhaos_integration_api.resolve_google_drive_webhook_channel(bytea, bytea)
  to pi_worker_executor;
grant execute on function remhaos_integration_api.record_google_drive_notification(
  uuid, uuid, uuid, bytea, bytea, bytea, bytea, text
) to pi_worker_executor;

commit;
