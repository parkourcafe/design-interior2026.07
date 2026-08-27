-- RemHaOS Integration Gateway PR4: Telegram staging bridge.
--
-- Additive only. Telegram is an adapter boundary: it can produce private
-- candidates and quarantine metadata, but it cannot mutate official artifacts.

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
    'review_telegram_candidate'
  ));

create function remhaos_integration._telegram_chat_digest(p_chat_id bigint)
returns bytea
language sql
immutable
set search_path = ''
as $function$
  select project_intelligence._sha256_text(p_chat_id::text)
$function$;

create function remhaos_integration._assert_telegram_digest(
  p_value text,
  p_field text,
  p_required boolean default true
)
returns bytea
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := lower(btrim(coalesce(p_value, '')));
begin
  if not p_required and v_value = '' then
    return null;
  end if;
  if v_value !~ '^[a-f0-9]{64}$' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  return decode(v_value, 'hex');
end
$function$;

create function remhaos_integration._assert_telegram_quarantine_key(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := btrim(coalesce(p_value, ''));
begin
  if length(v_value) < 1
     or length(v_value) > 2048
     or v_value !~ '^project-intelligence/ru/[0-9a-f-]{36}/'
     or v_value ~ '[[:cntrl:]]'
     or v_value ~ '(^|/)\.\.?(/|$)'
     or v_value ~ '//'
     or v_value ~* '(access_token|refresh_token|token|secret|password|credential)' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"quarantineObjectKey"}'::jsonb
    );
  end if;
  return v_value;
end
$function$;

create table remhaos_integration.telegram_bindings (
  organization_id uuid not null,
  project_id uuid not null,
  binding_id uuid not null default extensions.gen_random_uuid(),
  chat_id bigint not null check (chat_id <> 0),
  chat_id_digest bytea not null check (octet_length(chat_id_digest) = 32),
  label text not null
    check (
      char_length(btrim(label)) between 1 and 160
      and label = btrim(label)
      and label !~ '[[:cntrl:]]'
    ),
  status text not null default 'active'
    check (status in ('active', 'migrated', 'revoked')),
  migrated_to_binding_id uuid,
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  migrated_by_user_id uuid,
  migrated_at timestamptz,
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  primary key (organization_id, project_id, binding_id),
  constraint telegram_bindings_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint telegram_bindings_creator_fkey
    foreign key (organization_id, created_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint telegram_bindings_migrated_by_fkey
    foreign key (organization_id, migrated_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint telegram_bindings_revoked_by_fkey
    foreign key (organization_id, revoked_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint telegram_bindings_migrated_target_fkey
    foreign key (organization_id, project_id, migrated_to_binding_id)
    references remhaos_integration.telegram_bindings (organization_id, project_id, binding_id)
    on delete restrict,
  constraint telegram_bindings_status_shape_check check (
    (status = 'active' and migrated_to_binding_id is null and migrated_at is null and revoked_at is null)
    or (status = 'migrated' and migrated_to_binding_id is not null and migrated_at is not null and revoked_at is null)
    or (status = 'revoked' and migrated_to_binding_id is null and revoked_at is not null and migrated_at is null)
  )
);

create unique index telegram_bindings_active_chat_key
  on remhaos_integration.telegram_bindings (organization_id, project_id, chat_id)
  where status = 'active';
create index telegram_bindings_project_idx
  on remhaos_integration.telegram_bindings (organization_id, project_id, created_at desc);
create index telegram_bindings_created_by_idx
  on remhaos_integration.telegram_bindings (organization_id, created_by_user_id);
create index telegram_bindings_migrated_by_idx
  on remhaos_integration.telegram_bindings (organization_id, migrated_by_user_id)
  where migrated_by_user_id is not null;
create index telegram_bindings_revoked_by_idx
  on remhaos_integration.telegram_bindings (organization_id, revoked_by_user_id)
  where revoked_by_user_id is not null;
create index telegram_bindings_migrated_target_idx
  on remhaos_integration.telegram_bindings (organization_id, project_id, migrated_to_binding_id)
  where migrated_to_binding_id is not null;

create table remhaos_integration.telegram_updates (
  organization_id uuid not null,
  project_id uuid not null,
  update_id bigint not null check (update_id >= 0),
  binding_id uuid not null,
  chat_id bigint not null check (chat_id <> 0),
  chat_id_digest bytea not null check (octet_length(chat_id_digest) = 32),
  message_id bigint check (message_id is null or message_id >= 0),
  sender_id bigint check (sender_id is null or sender_id >= 0),
  payload_sha256 bytea not null check (octet_length(payload_sha256) = 32),
  text_sha256 bytea check (text_sha256 is null or octet_length(text_sha256) = 32),
  status text not null default 'received'
    check (status in ('received', 'candidate_created', 'rejected', 'failed')),
  received_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  primary key (organization_id, project_id, update_id),
  constraint telegram_updates_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint telegram_updates_binding_fkey
    foreign key (organization_id, project_id, binding_id)
    references remhaos_integration.telegram_bindings (organization_id, project_id, binding_id)
    on delete restrict,
  constraint telegram_updates_status_shape_check check (
    (status = 'received' and processed_at is null)
    or (status in ('candidate_created', 'rejected', 'failed') and processed_at is not null)
  )
);

create index telegram_updates_binding_idx
  on remhaos_integration.telegram_updates (organization_id, project_id, binding_id, received_at desc);
create index telegram_updates_status_idx
  on remhaos_integration.telegram_updates (organization_id, project_id, status, received_at desc);

create table remhaos_integration.telegram_attachments (
  organization_id uuid not null,
  project_id uuid not null,
  attachment_id uuid not null default extensions.gen_random_uuid(),
  update_id bigint not null,
  provider_file_id_digest bytea not null check (octet_length(provider_file_id_digest) = 32),
  display_name text
    check (
      display_name is null
      or (
        char_length(btrim(display_name)) between 1 and 500
        and display_name = btrim(display_name)
        and display_name !~ '[/\\]'
        and display_name !~ '[[:cntrl:]]'
      )
    ),
  media_type text
    check (media_type is null or (media_type = lower(btrim(media_type)) and char_length(media_type) between 1 and 255)),
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 9007199254740991),
  checksum bytea not null check (octet_length(checksum) = 32),
  quarantine_object_key text not null
    check (char_length(btrim(quarantine_object_key)) between 1 and 2048),
  source_role text not null check (source_role in (
    'document', 'drawing-preview', 'reference', 'photo-evidence', 'correspondence', 'schedule'
  )),
  status text not null default 'quarantined'
    check (status in ('quarantined', 'scan_pending', 'clean', 'rejected')),
  created_at timestamptz not null default statement_timestamp(),
  constraint telegram_attachments_update_fkey
    foreign key (organization_id, project_id, update_id)
    references remhaos_integration.telegram_updates (organization_id, project_id, update_id)
    on delete restrict
);

create unique index telegram_attachments_provider_key
  on remhaos_integration.telegram_attachments (organization_id, project_id, provider_file_id_digest);
alter table remhaos_integration.telegram_attachments
  add constraint telegram_attachments_scope_key
  unique (organization_id, project_id, attachment_id);
create index telegram_attachments_update_idx
  on remhaos_integration.telegram_attachments (organization_id, project_id, update_id, created_at);
create index telegram_attachments_status_idx
  on remhaos_integration.telegram_attachments (organization_id, project_id, status, created_at desc);

create table remhaos_integration.telegram_candidates (
  organization_id uuid not null,
  project_id uuid not null,
  candidate_id uuid not null default extensions.gen_random_uuid(),
  update_id bigint not null,
  attachment_id uuid,
  source_kind text not null check (source_kind in ('message', 'attachment')),
  text_sha256 bytea check (text_sha256 is null or octet_length(text_sha256) = 32),
  status text not null default 'candidate'
    check (status in ('candidate', 'accepted', 'rejected')),
  review_reason text,
  created_at timestamptz not null default statement_timestamp(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid,
  primary key (organization_id, project_id, candidate_id),
  constraint telegram_candidates_update_fkey
    foreign key (organization_id, project_id, update_id)
    references remhaos_integration.telegram_updates (organization_id, project_id, update_id)
    on delete restrict,
  constraint telegram_candidates_attachment_fkey
    foreign key (organization_id, project_id, attachment_id)
    references remhaos_integration.telegram_attachments (organization_id, project_id, attachment_id)
    on delete restrict,
  constraint telegram_candidates_reviewer_fkey
    foreign key (organization_id, reviewed_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint telegram_candidates_shape_check check (
    (source_kind = 'message' and attachment_id is null and text_sha256 is not null)
    or (source_kind = 'attachment' and attachment_id is not null)
  ),
  constraint telegram_candidates_review_shape_check check (
    (status = 'candidate' and reviewed_at is null and reviewed_by_user_id is null and review_reason is null)
    or (status in ('accepted', 'rejected') and reviewed_at is not null and reviewed_by_user_id is not null and review_reason is not null)
  )
);

create unique index telegram_candidates_message_key
  on remhaos_integration.telegram_candidates (organization_id, project_id, update_id)
  where source_kind = 'message';
create unique index telegram_candidates_attachment_key
  on remhaos_integration.telegram_candidates (organization_id, project_id, attachment_id)
  where attachment_id is not null;
create index telegram_candidates_project_status_idx
  on remhaos_integration.telegram_candidates (organization_id, project_id, status, created_at desc);
create index telegram_candidates_update_idx
  on remhaos_integration.telegram_candidates (organization_id, project_id, update_id);
create index telegram_candidates_attachment_idx
  on remhaos_integration.telegram_candidates (organization_id, project_id, attachment_id)
  where attachment_id is not null;
create index telegram_candidates_reviewer_idx
  on remhaos_integration.telegram_candidates (organization_id, reviewed_by_user_id)
  where reviewed_by_user_id is not null;

create table remhaos_integration.telegram_ingestion_jobs (
  organization_id uuid not null,
  project_id uuid not null,
  job_id uuid not null default extensions.gen_random_uuid(),
  update_id bigint not null,
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'succeeded', 'retryable_failed', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  available_at timestamptz not null default statement_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  result_ref jsonb,
  created_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  primary key (organization_id, project_id, job_id),
  constraint telegram_jobs_update_fkey
    foreign key (organization_id, project_id, update_id)
    references remhaos_integration.telegram_updates (organization_id, project_id, update_id)
    on delete restrict,
  constraint telegram_jobs_error_check check (
    last_error_code is null
    or (char_length(btrim(last_error_code)) between 1 and 80 and last_error_code = btrim(last_error_code) and last_error_code !~ '[[:cntrl:]]')
  ),
  constraint telegram_jobs_result_check check (
    result_ref is null
    or (jsonb_typeof(result_ref) = 'object' and not (result_ref ?| array['raw_body', 'message_body', 'file_id', 'provider_file_id', 'chat_id', 'token', 'secret']))
  ),
  constraint telegram_jobs_lease_shape_check check (
    (status = 'leased' and lease_token is not null and lease_expires_at is not null and finished_at is null)
    or (status <> 'leased' and lease_token is null and lease_expires_at is null)
  ),
  constraint telegram_jobs_terminal_shape_check check (
    (status in ('succeeded', 'dead_letter') and finished_at is not null)
    or (status not in ('succeeded', 'dead_letter') and finished_at is null)
  )
);

create unique index telegram_jobs_update_key
  on remhaos_integration.telegram_ingestion_jobs (organization_id, project_id, update_id);
create index telegram_jobs_claim_idx
  on remhaos_integration.telegram_ingestion_jobs (status, available_at, job_id)
  where status in ('queued', 'retryable_failed', 'leased');

alter table remhaos_integration.telegram_bindings owner to pi_table_owner;
alter table remhaos_integration.telegram_updates owner to pi_table_owner;
alter table remhaos_integration.telegram_attachments owner to pi_table_owner;
alter table remhaos_integration.telegram_candidates owner to pi_table_owner;
alter table remhaos_integration.telegram_ingestion_jobs owner to pi_table_owner;

alter table remhaos_integration.telegram_bindings enable row level security;
alter table remhaos_integration.telegram_bindings force row level security;
alter table remhaos_integration.telegram_updates enable row level security;
alter table remhaos_integration.telegram_updates force row level security;
alter table remhaos_integration.telegram_attachments enable row level security;
alter table remhaos_integration.telegram_attachments force row level security;
alter table remhaos_integration.telegram_candidates enable row level security;
alter table remhaos_integration.telegram_candidates force row level security;
alter table remhaos_integration.telegram_ingestion_jobs enable row level security;
alter table remhaos_integration.telegram_ingestion_jobs force row level security;

create policy telegram_bindings_owner_only
  on remhaos_integration.telegram_bindings as permissive for all to pi_table_owner
  using (true) with check (true);
create policy telegram_updates_owner_only
  on remhaos_integration.telegram_updates as permissive for all to pi_table_owner
  using (true) with check (true);
create policy telegram_attachments_owner_only
  on remhaos_integration.telegram_attachments as permissive for all to pi_table_owner
  using (true) with check (true);
create policy telegram_candidates_owner_only
  on remhaos_integration.telegram_candidates as permissive for all to pi_table_owner
  using (true) with check (true);
create policy telegram_jobs_owner_only
  on remhaos_integration.telegram_ingestion_jobs as permissive for all to pi_table_owner
  using (true) with check (true);

create function remhaos_integration_api.bind_telegram_chat(
  p_project_id uuid,
  p_chat_id bigint,
  p_label text,
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
  v_label text := remhaos_integration._assert_safe_text(p_label, 'label', 160, true);
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_binding remhaos_integration.telegram_bindings%rowtype;
  v_result jsonb;
begin
  if p_chat_id is null or p_chat_id = 0 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"chatId"}'::jsonb);
  end if;
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'manage_project_integrations');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'chatIdDigest', encode(remhaos_integration._telegram_chat_digest(p_chat_id), 'hex'),
    'label', v_label,
    'projectId', p_project_id
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'bind_telegram_chat', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if exists (
    select 1
    from remhaos_integration.telegram_bindings binding
    where binding.organization_id = v_context.organization_id
      and binding.project_id = p_project_id
      and binding.chat_id = p_chat_id
      and binding.status = 'active'
  ) then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"TELEGRAM_CHAT_ALREADY_BOUND"}'::jsonb);
  end if;
  insert into remhaos_integration.telegram_bindings (
    organization_id, project_id, chat_id, chat_id_digest, label, created_by_user_id
  ) values (
    v_context.organization_id, p_project_id, p_chat_id,
    remhaos_integration._telegram_chat_digest(p_chat_id), v_label, v_context.actor_user_id
  ) returning * into v_binding;
  v_result := jsonb_build_object(
    'bindingId', v_binding.binding_id,
    'chatIdDigest', encode(v_binding.chat_id_digest, 'hex'),
    'label', v_binding.label,
    'status', v_binding.status
  );
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'bind_telegram_chat', v_key_digest,
    v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'telegram_chat_bound', 'telegram_chat_bound',
    jsonb_build_object('chat_id_digest', encode(v_binding.chat_id_digest, 'hex'))
  );
end
$function$;

create function remhaos_integration_api.migrate_telegram_chat(
  p_project_id uuid,
  p_binding_id uuid,
  p_new_chat_id bigint,
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
  v_context record;
  v_binding remhaos_integration.telegram_bindings%rowtype;
  v_new_binding remhaos_integration.telegram_bindings%rowtype;
  v_reason text := remhaos_integration._assert_reason(p_reason);
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_new_chat_id is null or p_new_chat_id = 0 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"newChatId"}'::jsonb);
  end if;
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'manage_project_integrations');
  select * into v_binding
  from remhaos_integration.telegram_bindings binding
  where binding.organization_id = v_context.organization_id
    and binding.project_id = p_project_id
    and binding.binding_id = p_binding_id
  for update;
  if not found or v_binding.status <> 'active' then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"telegram_binding"}'::jsonb);
  end if;
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'bindingId', p_binding_id,
    'newChatIdDigest', encode(remhaos_integration._telegram_chat_digest(p_new_chat_id), 'hex'),
    'projectId', p_project_id,
    'reason', v_reason
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'migrate_telegram_chat', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if exists (
    select 1
    from remhaos_integration.telegram_bindings binding
    where binding.organization_id = v_context.organization_id
      and binding.project_id = p_project_id
      and binding.chat_id = p_new_chat_id
      and binding.status = 'active'
  ) then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"TELEGRAM_CHAT_ALREADY_BOUND"}'::jsonb);
  end if;
  insert into remhaos_integration.telegram_bindings (
    organization_id, project_id, chat_id, chat_id_digest, label, created_by_user_id
  ) values (
    v_context.organization_id, p_project_id, p_new_chat_id,
    remhaos_integration._telegram_chat_digest(p_new_chat_id),
    left(v_binding.label || ' (migrated)', 160), v_context.actor_user_id
  ) returning * into v_new_binding;
  update remhaos_integration.telegram_bindings
  set status = 'migrated',
      migrated_to_binding_id = v_new_binding.binding_id,
      migrated_by_user_id = v_context.actor_user_id,
      migrated_at = statement_timestamp()
  where organization_id = v_binding.organization_id
    and project_id = p_project_id
    and binding_id = p_binding_id;
  v_result := jsonb_build_object(
    'bindingId', p_binding_id,
    'replacementBindingId', v_new_binding.binding_id,
    'chatIdDigest', encode(v_new_binding.chat_id_digest, 'hex'),
    'status', 'migrated'
  );
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'migrate_telegram_chat', v_key_digest,
    v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'telegram_chat_migrated', 'telegram_chat_migrated',
    jsonb_build_object(
      'old_chat_id_digest', encode(v_binding.chat_id_digest, 'hex'),
      'new_chat_id_digest', encode(v_new_binding.chat_id_digest, 'hex'),
      'reason', v_reason
    )
  );
end
$function$;

create function remhaos_integration_api.list_telegram_bindings(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context record;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'manage_project_integrations');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'bindingId', binding.binding_id,
      'chatIdDigest', encode(binding.chat_id_digest, 'hex'),
      'label', binding.label,
      'status', binding.status,
      'migratedToBindingId', binding.migrated_to_binding_id,
      'createdAt', binding.created_at,
      'migratedAt', binding.migrated_at,
      'revokedAt', binding.revoked_at
    ) order by binding.created_at desc, binding.binding_id)
    from remhaos_integration.telegram_bindings binding
    where binding.organization_id = v_context.organization_id
      and binding.project_id = p_project_id
  ), '[]'::jsonb);
end
$function$;

create function remhaos_integration_api.ingest_telegram_update(
  p_project_id uuid,
  p_update_id bigint,
  p_chat_id bigint,
  p_message_id bigint,
  p_sender_id bigint,
  p_payload_sha256_hex text,
  p_text_sha256_hex text,
  p_attachments jsonb,
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
  v_binding remhaos_integration.telegram_bindings%rowtype;
  v_existing remhaos_integration.telegram_updates%rowtype;
  v_update remhaos_integration.telegram_updates%rowtype;
  v_attachment remhaos_integration.telegram_attachments%rowtype;
  v_item jsonb;
  v_attachment_id uuid;
  v_payload_sha256 bytea;
  v_text_sha256 bytea;
  v_chat_id_digest bytea;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_job remhaos_integration.telegram_ingestion_jobs%rowtype;
  v_candidate_count integer := 0;
  v_has_candidate boolean := false;
  v_update_status text;
  v_result jsonb;
begin
  if p_project_id is null
     or p_update_id is null
     or p_update_id < 0
     or p_chat_id is null
     or p_chat_id = 0
     or p_message_id is not null and p_message_id < 0
     or p_sender_id is not null and p_sender_id < 0 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"telegramUpdate"}'::jsonb);
  end if;
  v_payload_sha256 := remhaos_integration._assert_telegram_digest(p_payload_sha256_hex, 'payloadSha256');
  v_text_sha256 := remhaos_integration._assert_telegram_digest(p_text_sha256_hex, 'textSha256', false);
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"attachments"}'::jsonb);
  end if;
  if jsonb_array_length(p_attachments) > 10 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"attachments"}'::jsonb);
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_attachments) item(value)
    where jsonb_typeof(item.value) <> 'object'
       or item.value ?| array[
         'file_id', 'provider_file_id', 'raw_filename', 'message_body',
         'webhook_body', 'chat_id', 'token', 'secret'
       ]
       or jsonb_typeof(item.value -> 'fileIdDigest') is distinct from 'string'
       or jsonb_typeof(item.value -> 'checksumHex') is distinct from 'string'
       or jsonb_typeof(item.value -> 'quarantineObjectKey') is distinct from 'string'
       or jsonb_typeof(item.value -> 'sourceRole') is distinct from 'string'
  ) then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"attachments"}'::jsonb);
  end if;
  select workflow.organization_id into v_organization_id
  from project_intelligence.project_workflows workflow
  where workflow.project_id = p_project_id;
  if v_organization_id is null then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"project"}'::jsonb);
  end if;
  v_chat_id_digest := remhaos_integration._telegram_chat_digest(p_chat_id);
  select * into v_binding
  from remhaos_integration.telegram_bindings binding
  where binding.organization_id = v_organization_id
    and binding.project_id = p_project_id
    and binding.chat_id = p_chat_id
    and binding.status = 'active';
  if not found then
    perform remhaos_integration._raise('P1203', 'forbidden', '{"reason":"TELEGRAM_CHAT_NOT_BOUND"}'::jsonb);
  end if;
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'attachments', p_attachments,
    'chatIdDigest', encode(v_chat_id_digest, 'hex'),
    'messageId', p_message_id,
    'payloadSha256', lower(btrim(p_payload_sha256_hex)),
    'projectId', p_project_id,
    'senderId', p_sender_id,
    'textSha256', nullif(lower(btrim(coalesce(p_text_sha256_hex, ''))), ''),
    'updateId', p_update_id
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_organization_id, p_project_id, 'ingest_telegram_update', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  select * into v_existing
  from remhaos_integration.telegram_updates update_record
  where update_record.organization_id = v_organization_id
    and update_record.project_id = p_project_id
    and update_record.update_id = p_update_id;
  if found then
    v_result := jsonb_build_object(
      'updateId', v_existing.update_id,
      'bindingId', v_existing.binding_id,
      'chatIdDigest', encode(v_existing.chat_id_digest, 'hex'),
      'status', v_existing.status,
      'duplicate', true
    );
    return remhaos_integration._complete_command(
      v_organization_id, p_project_id, 'ingest_telegram_update', v_key_digest,
      v_request_digest, 'system', 'system:telegram-worker', null, v_result,
      'telegram_update_deduplicated', 'duplicate',
      jsonb_build_object('update_id', p_update_id)
    );
  end if;
  insert into remhaos_integration.telegram_updates (
    organization_id, project_id, update_id, binding_id, chat_id, chat_id_digest,
    message_id, sender_id, payload_sha256, text_sha256
  ) values (
    v_organization_id, p_project_id, p_update_id, v_binding.binding_id, p_chat_id,
    v_chat_id_digest, p_message_id, p_sender_id, v_payload_sha256, v_text_sha256
  ) returning * into v_update;
  if v_text_sha256 is not null then
    insert into remhaos_integration.telegram_candidates (
      organization_id, project_id, update_id, source_kind, text_sha256
    ) values (
      v_organization_id, p_project_id, p_update_id, 'message', v_text_sha256
    );
    v_candidate_count := v_candidate_count + 1;
    v_has_candidate := true;
  end if;
  for v_item in select value from jsonb_array_elements(p_attachments) item(value) loop
    v_attachment_id := null;
    select attachment.attachment_id into v_attachment_id
    from remhaos_integration.telegram_attachments attachment
    where attachment.organization_id = v_organization_id
      and attachment.project_id = p_project_id
      and attachment.provider_file_id_digest = remhaos_integration._assert_telegram_digest(
        v_item ->> 'fileIdDigest', 'fileIdDigest'
      );
    if v_attachment_id is null then
      insert into remhaos_integration.telegram_attachments (
        organization_id, project_id, update_id, provider_file_id_digest,
        display_name, media_type, size_bytes, checksum, quarantine_object_key, source_role
      ) values (
        v_organization_id, p_project_id, p_update_id,
        remhaos_integration._assert_telegram_digest(v_item ->> 'fileIdDigest', 'fileIdDigest'),
        nullif(btrim(v_item ->> 'displayName'), ''),
        case when nullif(btrim(v_item ->> 'mediaType'), '') is null then null else lower(btrim(v_item ->> 'mediaType')) end,
        case when nullif(v_item ->> 'sizeBytes', '') is null then null else (v_item ->> 'sizeBytes')::bigint end,
        remhaos_integration._assert_telegram_digest(v_item ->> 'checksumHex', 'checksumHex'),
        remhaos_integration._assert_telegram_quarantine_key(v_item ->> 'quarantineObjectKey'),
        v_item ->> 'sourceRole'
      ) returning * into v_attachment;
      v_attachment_id := v_attachment.attachment_id;
    end if;
    insert into remhaos_integration.telegram_candidates (
      organization_id, project_id, update_id, attachment_id, source_kind
    ) values (
      v_organization_id, p_project_id, p_update_id, v_attachment_id, 'attachment'
    ) on conflict (organization_id, project_id, attachment_id)
      where attachment_id is not null do nothing;
    if found then
      v_candidate_count := v_candidate_count + 1;
      v_has_candidate := true;
    end if;
  end loop;
  v_update_status := case when v_has_candidate then 'candidate_created' else 'rejected' end;
  update remhaos_integration.telegram_updates update_record
  set status = v_update_status, processed_at = statement_timestamp()
  where update_record.organization_id = v_organization_id
    and update_record.project_id = p_project_id
    and update_record.update_id = p_update_id;
  if v_has_candidate then
    insert into remhaos_integration.telegram_ingestion_jobs (
      organization_id, project_id, update_id
    ) values (v_organization_id, p_project_id, p_update_id)
    returning * into v_job;
  end if;
  v_result := jsonb_build_object(
    'updateId', v_update.update_id,
    'bindingId', v_binding.binding_id,
    'chatIdDigest', encode(v_chat_id_digest, 'hex'),
    'candidateCount', v_candidate_count,
    'jobId', v_job.job_id,
    'status', v_update_status,
    'duplicate', false
  );
  return remhaos_integration._complete_command(
    v_organization_id, p_project_id, 'ingest_telegram_update', v_key_digest,
    v_request_digest, 'system', 'system:telegram-worker', null, v_result,
    'telegram_update_ingested', v_update_status,
    jsonb_build_object('update_id', p_update_id, 'candidate_count', v_candidate_count)
  );
end
$function$;

create function remhaos_integration_api.claim_telegram_ingestion_jobs(
  p_limit integer,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50
     or p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"lease"}'::jsonb);
  end if;
  with next_jobs as (
    select job.organization_id, job.project_id, job.job_id
    from remhaos_integration.telegram_ingestion_jobs job
    where (
      job.status in ('queued', 'retryable_failed')
      or (job.status = 'leased' and job.lease_expires_at <= statement_timestamp())
    )
    and job.available_at <= statement_timestamp()
    order by job.available_at, job.job_id
    for update skip locked
    limit p_limit
  ), claimed as (
    update remhaos_integration.telegram_ingestion_jobs job
    set status = 'leased',
        attempt_count = job.attempt_count + 1,
        lease_token = extensions.gen_random_uuid(),
        lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
        last_error_code = null
    from next_jobs
    where job.organization_id = next_jobs.organization_id
      and job.project_id = next_jobs.project_id
      and job.job_id = next_jobs.job_id
    returning job.*
  )
  select jsonb_agg(jsonb_build_object(
    'jobId', claimed.job_id,
    'organizationId', claimed.organization_id,
    'projectId', claimed.project_id,
    'updateId', claimed.update_id,
    'attemptCount', claimed.attempt_count,
    'leaseToken', claimed.lease_token,
    'leaseExpiresAt', claimed.lease_expires_at
  ) order by claimed.available_at, claimed.job_id)
  into v_result
  from claimed;
  return coalesce(v_result, '[]'::jsonb);
end
$function$;

create function remhaos_integration_api.complete_telegram_ingestion_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_result_ref jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job remhaos_integration.telegram_ingestion_jobs%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result_ref jsonb := coalesce(p_result_ref, '{}'::jsonb);
  v_result jsonb;
begin
  if jsonb_typeof(v_result_ref) <> 'object'
     or v_result_ref ?| array['raw_body', 'message_body', 'file_id', 'provider_file_id', 'chat_id', 'token', 'secret'] then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"resultRef"}'::jsonb);
  end if;
  select * into v_job
  from remhaos_integration.telegram_ingestion_jobs job
  where job.job_id = p_job_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"telegram_job"}'::jsonb);
  end if;
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'jobId', p_job_id, 'leaseToken', p_lease_token, 'resultRef', v_result_ref
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_job.organization_id, v_job.project_id, 'complete_telegram_ingestion_job', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  update remhaos_integration.telegram_ingestion_jobs job
  set status = 'succeeded', lease_token = null, lease_expires_at = null,
      result_ref = v_result_ref, finished_at = statement_timestamp()
  where job.organization_id = v_job.organization_id
    and job.project_id = v_job.project_id
    and job.job_id = p_job_id
    and job.status = 'leased'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > statement_timestamp()
  returning * into v_job;
  if not found then
    perform remhaos_integration._raise('P1208', 'lease_conflict', '{"entity":"telegram_job"}'::jsonb);
  end if;
  v_result := jsonb_build_object('jobId', v_job.job_id, 'status', v_job.status);
  return remhaos_integration._complete_command(
    v_job.organization_id, v_job.project_id, 'complete_telegram_ingestion_job',
    v_key_digest, v_request_digest, 'system', 'system:telegram-worker', null,
    v_result, 'telegram_ingestion_job_completed', 'succeeded', '{}', null
  );
end
$function$;

create function remhaos_integration_api.fail_telegram_ingestion_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean,
  p_max_attempts integer,
  p_retry_after_seconds integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing remhaos_integration.telegram_ingestion_jobs%rowtype;
  v_job remhaos_integration.telegram_ingestion_jobs%rowtype;
  v_error_code text := remhaos_integration._assert_safe_text(p_error_code, 'errorCode', 80, true);
  v_next_status text;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  if coalesce(p_max_attempts, 0) < 1 or p_max_attempts > 20
     or coalesce(p_retry_after_seconds, 0) < 1 or p_retry_after_seconds > 86400 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"retryPolicy"}'::jsonb);
  end if;
  select * into v_existing
  from remhaos_integration.telegram_ingestion_jobs job
  where job.job_id = p_job_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"telegram_job"}'::jsonb);
  end if;
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'errorCode', v_error_code,
    'jobId', p_job_id,
    'leaseToken', p_lease_token,
    'maxAttempts', p_max_attempts,
    'retryAfterSeconds', p_retry_after_seconds,
    'retryable', coalesce(p_retryable, false)
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_existing.organization_id, v_existing.project_id, 'fail_telegram_ingestion_job', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  v_next_status := case
    when coalesce(p_retryable, false) and v_existing.attempt_count < p_max_attempts then 'retryable_failed'
    else 'dead_letter'
  end;
  update remhaos_integration.telegram_ingestion_jobs job
  set status = v_next_status,
      lease_token = null,
      lease_expires_at = null,
      available_at = case when v_next_status = 'retryable_failed'
        then statement_timestamp() + make_interval(secs => p_retry_after_seconds)
        else job.available_at end,
      last_error_code = v_error_code,
      finished_at = case when v_next_status = 'dead_letter' then statement_timestamp() else null end
  where job.organization_id = v_existing.organization_id
    and job.project_id = v_existing.project_id
    and job.job_id = p_job_id
    and job.status = 'leased'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > statement_timestamp()
  returning * into v_job;
  if not found then
    perform remhaos_integration._raise('P1208', 'lease_conflict', '{"entity":"telegram_job"}'::jsonb);
  end if;
  v_result := jsonb_build_object(
    'jobId', v_job.job_id, 'status', v_job.status, 'lastErrorCode', v_job.last_error_code
  );
  return remhaos_integration._complete_command(
    v_job.organization_id, v_job.project_id, 'fail_telegram_ingestion_job',
    v_key_digest, v_request_digest, 'system', 'system:telegram-worker', null,
    v_result, 'telegram_ingestion_job_failed', v_job.status,
    jsonb_build_object('error_code', v_error_code), null
  );
end
$function$;

create function remhaos_integration_api.list_telegram_candidates(p_project_id uuid)
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
    select 1
    from projectceo_foundation.project_memberships membership
    where membership.organization_id = v_context.organization_id
      and membership.project_id = p_project_id
      and membership.user_id = v_context.actor_user_id
      and membership.role = 'client_approver'
      and membership.status = 'active'
  ) into v_client;
  if v_client then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'candidateId', candidate.candidate_id,
      'sourceKind', candidate.source_kind,
      'status', candidate.status,
      'attachmentId', candidate.attachment_id,
      'displayName', attachment.display_name,
      'mediaType', attachment.media_type,
      'sizeBytes', attachment.size_bytes,
      'createdAt', candidate.created_at,
      'reviewedAt', candidate.reviewed_at,
      'reviewReason', candidate.review_reason,
      'clientProjection', false
    ) order by candidate.created_at desc, candidate.candidate_id)
    from remhaos_integration.telegram_candidates candidate
    left join remhaos_integration.telegram_attachments attachment
      on attachment.organization_id = candidate.organization_id
     and attachment.project_id = candidate.project_id
     and attachment.attachment_id = candidate.attachment_id
    where candidate.organization_id = v_context.organization_id
      and candidate.project_id = p_project_id
  ), '[]'::jsonb);
end
$function$;

create function remhaos_integration_api.review_telegram_candidate(
  p_project_id uuid,
  p_candidate_id uuid,
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
  v_context record;
  v_candidate remhaos_integration.telegram_candidates%rowtype;
  v_reason text := remhaos_integration._assert_reason(p_reason);
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_decision not in ('accepted', 'rejected') then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"decision"}'::jsonb);
  end if;
  select * into v_candidate
  from remhaos_integration.telegram_candidates candidate
  where candidate.project_id = p_project_id
    and candidate.candidate_id = p_candidate_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"telegram_candidate"}'::jsonb);
  end if;
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'review_source');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'candidateId', p_candidate_id,
    'decision', p_decision,
    'projectId', p_project_id,
    'reason', v_reason
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'review_telegram_candidate', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  select * into v_candidate
  from remhaos_integration.telegram_candidates candidate
  where candidate.organization_id = v_context.organization_id
    and candidate.project_id = p_project_id
    and candidate.candidate_id = p_candidate_id
  for update;
  if v_candidate.status <> 'candidate' then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"CANDIDATE_ALREADY_REVIEWED"}'::jsonb);
  end if;
  update remhaos_integration.telegram_candidates candidate
  set status = p_decision,
      review_reason = v_reason,
      reviewed_at = statement_timestamp(),
      reviewed_by_user_id = v_context.actor_user_id
  where candidate.organization_id = v_context.organization_id
    and candidate.project_id = p_project_id
    and candidate.candidate_id = p_candidate_id;
  v_result := jsonb_build_object(
    'candidateId', p_candidate_id,
    'status', p_decision,
    'officialArtifactMutated', false
  );
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'review_telegram_candidate',
    v_key_digest, v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'telegram_candidate_reviewed', p_decision,
    jsonb_build_object('official_artifact_mutated', false)
  );
end
$function$;

alter function remhaos_integration._telegram_chat_digest(bigint) owner to pi_table_owner;
alter function remhaos_integration._assert_telegram_digest(text, text, boolean) owner to pi_table_owner;
alter function remhaos_integration._assert_telegram_quarantine_key(text) owner to pi_table_owner;
alter function remhaos_integration_api.bind_telegram_chat(uuid, bigint, text, text) owner to pi_table_owner;
alter function remhaos_integration_api.migrate_telegram_chat(uuid, uuid, bigint, text, text) owner to pi_table_owner;
alter function remhaos_integration_api.list_telegram_bindings(uuid) owner to pi_table_owner;
alter function remhaos_integration_api.ingest_telegram_update(uuid, bigint, bigint, bigint, bigint, text, text, jsonb, text) owner to pi_table_owner;
alter function remhaos_integration_api.claim_telegram_ingestion_jobs(integer, integer) owner to pi_table_owner;
alter function remhaos_integration_api.complete_telegram_ingestion_job(uuid, uuid, jsonb, text) owner to pi_table_owner;
alter function remhaos_integration_api.fail_telegram_ingestion_job(uuid, uuid, text, boolean, integer, integer, text) owner to pi_table_owner;
alter function remhaos_integration_api.list_telegram_candidates(uuid) owner to pi_table_owner;
alter function remhaos_integration_api.review_telegram_candidate(uuid, uuid, text, text, text) owner to pi_table_owner;

revoke all on table
  remhaos_integration.telegram_bindings,
  remhaos_integration.telegram_updates,
  remhaos_integration.telegram_attachments,
  remhaos_integration.telegram_candidates,
  remhaos_integration.telegram_ingestion_jobs
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._telegram_chat_digest(bigint)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._assert_telegram_digest(text, text, boolean)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._assert_telegram_quarantine_key(text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function
  remhaos_integration_api.bind_telegram_chat(uuid, bigint, text, text),
  remhaos_integration_api.migrate_telegram_chat(uuid, uuid, bigint, text, text),
  remhaos_integration_api.list_telegram_bindings(uuid),
  remhaos_integration_api.ingest_telegram_update(uuid, bigint, bigint, bigint, bigint, text, text, jsonb, text),
  remhaos_integration_api.claim_telegram_ingestion_jobs(integer, integer),
  remhaos_integration_api.complete_telegram_ingestion_job(uuid, uuid, jsonb, text),
  remhaos_integration_api.fail_telegram_ingestion_job(uuid, uuid, text, boolean, integer, integer, text),
  remhaos_integration_api.list_telegram_candidates(uuid),
  remhaos_integration_api.review_telegram_candidate(uuid, uuid, text, text, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
grant execute on function
  remhaos_integration_api.bind_telegram_chat(uuid, bigint, text, text),
  remhaos_integration_api.migrate_telegram_chat(uuid, uuid, bigint, text, text),
  remhaos_integration_api.list_telegram_bindings(uuid),
  remhaos_integration_api.list_telegram_candidates(uuid),
  remhaos_integration_api.review_telegram_candidate(uuid, uuid, text, text, text)
  to authenticated;
grant execute on function
  remhaos_integration_api.ingest_telegram_update(uuid, bigint, bigint, bigint, bigint, text, text, jsonb, text),
  remhaos_integration_api.claim_telegram_ingestion_jobs(integer, integer),
  remhaos_integration_api.complete_telegram_ingestion_job(uuid, uuid, jsonb, text),
  remhaos_integration_api.fail_telegram_ingestion_job(uuid, uuid, text, boolean, integer, integer, text)
  to pi_worker_executor;

commit;
