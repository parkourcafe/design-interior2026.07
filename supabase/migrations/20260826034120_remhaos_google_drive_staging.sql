-- RemHaOS Integration Gateway PR6: Google Drive staging provider config.
--
-- This migration registers only the minimal selected-object OAuth contract.
-- Credential exchange and external staging proof remain disabled until the
-- owner supplies a test project, test account and public callback.

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
    'create_oauth_intent'
  ));

create table remhaos_integration.google_drive_connector_config (
  config_id boolean primary key default true check (config_id),
  allowed_scopes text[] not null default array[
    'https://www.googleapis.com/auth/drive.file',
    'openid',
    'email',
    'profile'
  ]::text[],
  required_file_scope text not null default 'https://www.googleapis.com/auth/drive.file',
  selection_mode text not null default 'explicit_selected_object'
    check (selection_mode = 'explicit_selected_object'),
  recursive_folder_sync boolean not null default false,
  shared_drives_enabled boolean not null default false,
  production_enabled boolean not null default false,
  updated_at timestamptz not null default statement_timestamp(),
  constraint google_drive_scope_config_check check (
    required_file_scope = any(allowed_scopes)
    and allowed_scopes <@ array[
      'https://www.googleapis.com/auth/drive.file',
      'openid',
      'email',
      'profile'
    ]::text[]
  )
);

insert into remhaos_integration.google_drive_connector_config (config_id)
values (true)
on conflict (config_id) do nothing;

insert into remhaos_integration.providers (
  code, display_name_key, connection_mode, capabilities, legal_state, default_enabled
)
values (
  'google_drive',
  'integrations.provider.google_drive',
  'oauth',
  '{"capabilities":["list_objects","import_object","receive_webhook"]}'::jsonb,
  'staging_only',
  false
)
on conflict (code) do update
set display_name_key = excluded.display_name_key,
    connection_mode = excluded.connection_mode,
    capabilities = excluded.capabilities,
    legal_state = excluded.legal_state,
    default_enabled = false;

create function remhaos_integration._google_drive_assert_scopes(p_scopes text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_allowed text[];
  v_values text[] := coalesce(p_scopes, array[]::text[]);
begin
  select config.allowed_scopes into v_allowed
  from remhaos_integration.google_drive_connector_config config
  where config.config_id;
  if v_allowed is null
     or not ('https://www.googleapis.com/auth/drive.file' = any(v_values))
     or exists (
       select 1 from unnest(v_values) value
       where value <> all(v_allowed)
     )
     or (select count(*) <> count(distinct value) from unnest(v_values) value) then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"googleDriveScopes","reason":"MINIMAL_SCOPE_REQUIRED"}'::jsonb
    );
  end if;
  return v_values;
end
$function$;

create function remhaos_integration_api.create_oauth_intent(
  p_organization_id uuid,
  p_provider_code text,
  p_state_digest bytea,
  p_pkce_credential_ref text,
  p_redirect_uri_hash bytea,
  p_requested_scopes text[],
  p_expires_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_provider text := remhaos_integration._assert_provider_code(p_provider_code);
  v_scopes text[] := remhaos_integration._assert_scopes(p_requested_scopes, false);
  v_state_digest bytea := remhaos_integration._assert_bytea_32(p_state_digest, 'stateDigest');
  v_redirect_uri_hash bytea := remhaos_integration._assert_bytea_32(p_redirect_uri_hash, 'redirectUriHash');
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_intent remhaos_integration.oauth_intents%rowtype;
  v_result jsonb;
begin
  select * into v_context
  from remhaos_integration._authorize_organization_human(
    p_organization_id, 'manage_project_integrations'
  );
  if v_provider = 'google_drive' then
    v_scopes := remhaos_integration._google_drive_assert_scopes(v_scopes);
  end if;
  if p_expires_at is null
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '30 minutes' then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"expiresAt"}'::jsonb);
  end if;
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'expiresAt', p_expires_at,
    'organizationId', v_context.organization_id,
    'providerCode', v_provider,
    'redirectUriHash', encode(v_redirect_uri_hash, 'hex'),
    'requestedScopes', to_jsonb(v_scopes),
    'stateDigest', encode(v_state_digest, 'hex')
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, null, 'create_oauth_intent', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  insert into remhaos_integration.oauth_intents (
    provider_code, organization_id, actor_id, state_digest, pkce_credential_ref,
    redirect_uri_hash, requested_scopes, expires_at
  ) values (
    v_provider, v_context.organization_id, v_context.actor_user_id, v_state_digest,
    remhaos_integration._normalize_credential_ref(p_pkce_credential_ref),
    v_redirect_uri_hash, v_scopes, p_expires_at
  ) returning * into v_intent;
  v_result := jsonb_build_object(
    'intentId', v_intent.id,
    'providerCode', v_intent.provider_code,
    'stateDigestHex', encode(v_intent.state_digest, 'hex'),
    'pkceCredentialRef', v_intent.pkce_credential_ref,
    'requestedScopes', v_intent.requested_scopes,
    'expiresAt', v_intent.expires_at
  );
  return remhaos_integration._complete_command(
    v_context.organization_id, null, 'create_oauth_intent', v_key_digest,
    v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'oauth_intent_created', 'created',
    jsonb_build_object('providerCode', v_provider, 'scopeCount', cardinality(v_scopes))
  );
end
$function$;

create function remhaos_integration.google_drive_scope_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.provider_code = 'google_drive' then
    perform remhaos_integration._google_drive_assert_scopes(new.granted_scopes);
  end if;
  return new;
end
$function$;

create trigger google_drive_connections_scope_guard
  before insert or update of provider_code, granted_scopes
  on remhaos_integration.connections
  for each row execute function remhaos_integration.google_drive_scope_guard();

create table remhaos_integration.google_drive_webhook_channels (
  organization_id uuid not null,
  connection_id uuid not null,
  channel_id uuid not null default extensions.gen_random_uuid(),
  provider_channel_id_hash bytea not null check (octet_length(provider_channel_id_hash) = 32),
  provider_resource_id_hash bytea not null check (octet_length(provider_resource_id_hash) = 32),
  status text not null default 'active' check (status in ('active', 'stopped', 'expired')),
  expires_at timestamptz not null,
  last_notified_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint google_drive_channels_organization_fkey
    foreign key (organization_id)
    references project_intelligence.organizations (id)
    on delete restrict,
  constraint google_drive_channels_connection_fkey
    foreign key (organization_id, connection_id)
    references remhaos_integration.connections (organization_id, id)
    on delete restrict,
  constraint google_drive_channels_status_shape_check check (
    (status = 'active' and stopped_at is null)
    or (status in ('stopped', 'expired') and stopped_at is not null)
  ),
  constraint google_drive_channels_expiry_check check (expires_at > created_at)
);

create unique index google_drive_channels_provider_key
  on remhaos_integration.google_drive_webhook_channels (
    organization_id, connection_id, provider_channel_id_hash
  );
create index google_drive_channels_connection_idx
  on remhaos_integration.google_drive_webhook_channels (organization_id, connection_id, status, expires_at);

alter table remhaos_integration.google_drive_connector_config owner to pi_table_owner;
alter table remhaos_integration.google_drive_webhook_channels owner to pi_table_owner;
alter table remhaos_integration.google_drive_connector_config enable row level security;
alter table remhaos_integration.google_drive_connector_config force row level security;
alter table remhaos_integration.google_drive_webhook_channels enable row level security;
alter table remhaos_integration.google_drive_webhook_channels force row level security;
create policy google_drive_config_owner_only
  on remhaos_integration.google_drive_connector_config as permissive for all to pi_table_owner
  using (true) with check (true);
create policy google_drive_channels_owner_only
  on remhaos_integration.google_drive_webhook_channels as permissive for all to pi_table_owner
  using (true) with check (true);

alter function remhaos_integration._google_drive_assert_scopes(text[]) owner to pi_table_owner;
alter function remhaos_integration.google_drive_scope_guard() owner to pi_table_owner;
alter function remhaos_integration_api.create_oauth_intent(
  uuid, text, bytea, text, bytea, text[], timestamptz, text
) owner to pi_table_owner;
revoke all on table
  remhaos_integration.google_drive_connector_config,
  remhaos_integration.google_drive_webhook_channels
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._google_drive_assert_scopes(text[])
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration.google_drive_scope_guard()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.create_oauth_intent(
  uuid, text, bytea, text, bytea, text[], timestamptz, text
)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
grant execute on function remhaos_integration_api.create_oauth_intent(
  uuid, text, bytea, text, bytea, text[], timestamptz, text
)
  to authenticated;

commit;
