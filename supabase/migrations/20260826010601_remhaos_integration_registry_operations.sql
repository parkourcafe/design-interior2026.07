-- RemHaOS Integration Gateway PR1: operations tables and RPC surface.
--
-- Provider-specific adapters remain out of scope. These functions materialize
-- only the generic registry, candidate, idempotency and worker contracts.

begin;

set local check_function_bodies = on;

create table remhaos_integration.external_objects (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  project_connection_id uuid not null,
  provider_object_key text not null
    check (
      char_length(btrim(provider_object_key)) between 1 and 1024
      and provider_object_key = btrim(provider_object_key)
      and provider_object_key !~ '[[:cntrl:]]'
    ),
  provider_object_hash bytea not null
    check (octet_length(provider_object_hash) = 32),
  object_kind text not null
    check (object_kind in (
      'file',
      'folder',
      'board',
      'design',
      'message',
      'other'
    )),
  display_name text
    check (
      display_name is null
      or (
        char_length(btrim(display_name)) between 1 and 255
        and display_name = btrim(display_name)
        and display_name !~ '[[:cntrl:]/\\]'
      )
    ),
  mime_type text
    check (
      mime_type is null
      or (
        char_length(btrim(mime_type)) between 1 and 255
        and mime_type = lower(btrim(mime_type))
        and mime_type !~ '[[:cntrl:]]'
      )
    ),
  size_bytes bigint
    check (
      size_bytes is null
      or size_bytes between 0 and 9007199254740991
    ),
  external_revision text
    check (
      external_revision is null
      or (
        char_length(btrim(external_revision)) between 1 and 255
        and external_revision = btrim(external_revision)
        and external_revision !~ '[[:cntrl:]]'
      )
    ),
  modified_at_provider timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(metadata) = 'object'
      and not (metadata ?| array[
        'access_token',
        'refresh_token',
        'authorization_code',
        'signed_url',
        'provider_object_id',
        'raw_filename',
        'message_body',
        'file_contents',
        'webhook_body',
        'email',
        'phone',
        'token',
        'secret'
      ])
    ),
  last_seen_at timestamptz not null default statement_timestamp(),
  constraint external_objects_project_connection_fkey
    foreign key (organization_id, project_id, project_connection_id)
    references remhaos_integration.project_connections (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint external_objects_scope_id_key
    unique (organization_id, project_id, id)
);

create unique index external_objects_revision_key
  on remhaos_integration.external_objects (
    project_connection_id,
    provider_object_hash,
    external_revision
  )
  where external_revision is not null;
create unique index external_objects_stable_key
  on remhaos_integration.external_objects (
    project_connection_id,
    provider_object_hash
  )
  where external_revision is null;
create index external_objects_project_idx
  on remhaos_integration.external_objects (
    organization_id,
    project_id,
    last_seen_at desc
  );
create index external_objects_project_connection_scope_idx
  on remhaos_integration.external_objects (
    organization_id,
    project_id,
    project_connection_id
  );

create table remhaos_integration.import_candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  external_object_id uuid,
  source_kind text not null
    check (source_kind in ('url', 'file', 'message', 'snapshot')),
  status text not null default 'candidate'
    check (status in (
      'candidate',
      'reviewing',
      'accepted',
      'rejected',
      'superseded'
    )),
  target_kind text not null
    check (target_kind in (
      'source',
      'reference',
      'selection',
      'evidence',
      'other'
    )),
  internal_object_key text
    check (
      internal_object_key is null
      or (
        char_length(btrim(internal_object_key)) between 1 and 512
        and internal_object_key = btrim(internal_object_key)
        and internal_object_key !~ '[[:cntrl:]]'
        and internal_object_key !~ '(^|/)[.][.]?(/|$)'
      )
    ),
  server_sha256 text
    check (
      server_sha256 is null
      or server_sha256 ~ '^[a-f0-9]{64}$'
    ),
  scan_state text not null default 'pending'
    check (scan_state in (
      'pending',
      'clean',
      'infected',
      'failed',
      'not_applicable'
    )),
  provenance jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(provenance) = 'object'
      and not (provenance ?| array[
        'access_token',
        'refresh_token',
        'authorization_code',
        'signed_url',
        'provider_object_id',
        'raw_filename',
        'message_body',
        'file_contents',
        'webhook_body',
        'email',
        'phone',
        'token',
        'secret'
      ])
    ),
  created_by uuid,
  reviewed_by uuid,
  created_at timestamptz not null default statement_timestamp(),
  reviewed_at timestamptz,
  constraint import_candidates_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (
      organization_id,
      project_id
    )
    on delete restrict,
  constraint import_candidates_external_object_fkey
    foreign key (organization_id, project_id, external_object_id)
    references remhaos_integration.external_objects (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint import_candidates_creator_fkey
    foreign key (organization_id, created_by)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint import_candidates_reviewer_fkey
    foreign key (organization_id, reviewed_by)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint import_candidates_review_shape_check
    check (
      (
        status in ('accepted', 'rejected')
        and reviewed_by is not null
        and reviewed_at is not null
      )
      or (
        status not in ('accepted', 'rejected')
        and reviewed_by is null
        and reviewed_at is null
      )
    )
);

create index import_candidates_project_status_idx
  on remhaos_integration.import_candidates (
    organization_id,
    project_id,
    status,
    created_at desc
  );
create index import_candidates_external_object_idx
  on remhaos_integration.import_candidates (
    organization_id,
    project_id,
    external_object_id
  )
  where external_object_id is not null;
create index import_candidates_created_by_idx
  on remhaos_integration.import_candidates (organization_id, created_by)
  where created_by is not null;
create index import_candidates_reviewed_by_idx
  on remhaos_integration.import_candidates (organization_id, reviewed_by)
  where reviewed_by is not null;

create table remhaos_integration.sync_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  connection_id uuid not null,
  job_kind text not null
    check (
      char_length(btrim(job_kind)) between 1 and 80
      and job_kind = btrim(job_kind)
      and job_kind ~ '^[a-z][a-z0-9_]{1,79}$'
    ),
  idempotency_key text not null
    check (idempotency_key ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued'
    check (status in (
      'queued',
      'leased',
      'succeeded',
      'retryable_failed',
      'dead_letter',
      'cancelled'
    )),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 100),
  available_at timestamptz not null default statement_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  input_ref jsonb not null default '{}'::jsonb,
  result_ref jsonb,
  last_error_code text
    check (
      last_error_code is null
      or (
        char_length(btrim(last_error_code)) between 1 and 80
        and last_error_code = btrim(last_error_code)
        and last_error_code !~ '[[:cntrl:]]'
      )
    ),
  created_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  constraint sync_jobs_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (
      organization_id,
      project_id
    )
    on delete restrict,
  constraint sync_jobs_connection_fkey
    foreign key (organization_id, connection_id)
    references remhaos_integration.connections (organization_id, id)
    on delete restrict,
  constraint sync_jobs_idempotency_key
    unique (organization_id, project_id, job_kind, idempotency_key),
  constraint sync_jobs_input_ref_check
    check (
      jsonb_typeof(input_ref) = 'object'
      and not (input_ref ?| array[
        'access_token',
        'refresh_token',
        'authorization_code',
        'signed_url',
        'provider_object_key',
        'provider_object_id',
        'raw_filename',
        'message_body',
        'file_contents',
        'webhook_body',
        'email',
        'phone',
        'token',
        'secret'
      ])
    ),
  constraint sync_jobs_result_ref_check
    check (
      result_ref is null
      or (
        jsonb_typeof(result_ref) = 'object'
        and not (result_ref ?| array[
          'access_token',
          'refresh_token',
          'authorization_code',
          'signed_url',
          'provider_object_key',
          'provider_object_id',
          'raw_filename',
          'message_body',
          'file_contents',
          'webhook_body',
          'email',
          'phone',
          'token',
          'secret'
        ])
      )
    ),
  constraint sync_jobs_lease_shape_check
    check (
      (
        status = 'leased'
        and lease_token is not null
        and lease_expires_at is not null
        and finished_at is null
      )
      or (
        status <> 'leased'
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  constraint sync_jobs_terminal_shape_check
    check (
      (
        status in ('succeeded', 'dead_letter', 'cancelled')
        and finished_at is not null
      )
      or (
        status not in ('succeeded', 'dead_letter', 'cancelled')
        and finished_at is null
      )
    )
);

create index sync_jobs_claim_idx
  on remhaos_integration.sync_jobs (
    status,
    available_at,
    id
  )
  where status in ('queued', 'retryable_failed', 'leased');
create index sync_jobs_connection_idx
  on remhaos_integration.sync_jobs (
    organization_id,
    connection_id,
    created_at desc
  );

create table remhaos_integration.webhook_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  provider_code text not null,
  delivery_id_hash bytea not null
    check (octet_length(delivery_id_hash) = 32),
  payload_sha256 bytea not null
    check (octet_length(payload_sha256) = 32),
  signature_state text not null
    check (signature_state in ('verified', 'rejected', 'not_supported')),
  status text not null
    check (status in (
      'received',
      'enqueued',
      'processed',
      'rejected',
      'duplicate'
    )),
  received_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  expires_at timestamptz not null,
  constraint webhook_receipts_provider_fkey
    foreign key (provider_code)
    references remhaos_integration.providers (code)
    on delete restrict,
  constraint webhook_receipts_delivery_key
    unique (provider_code, delivery_id_hash),
  constraint webhook_receipts_expiry_check
    check (expires_at > received_at)
);

create index webhook_receipts_provider_status_idx
  on remhaos_integration.webhook_receipts (
    provider_code,
    status,
    received_at desc
  );

create function remhaos_integration_api.list_available_integration_providers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    perform remhaos_integration._raise(
      'P1201',
      'unauthenticated',
      '{}'::jsonb
    );
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'providerCode', provider.code,
        'displayNameKey', provider.display_name_key,
        'connectionMode', provider.connection_mode,
        'capabilities', provider.capabilities,
        'legalState', provider.legal_state,
        'defaultEnabled', provider.default_enabled
      )
      order by provider.code
    )
    from remhaos_integration.providers provider
  ), '[]'::jsonb);
end
$function$;

create function remhaos_integration_api.list_organization_connections(
  p_organization_id uuid
)
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
  from remhaos_integration._authorize_organization_human(
    p_organization_id,
    'manage_project_integrations'
  );

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'connectionId', connection.id,
        'providerCode', connection.provider_code,
        'status', connection.status,
        'displayLabel', connection.display_label,
        'metadata', connection.metadata,
        'tokenExpiresAt', connection.token_expires_at,
        'lastSuccessfulSyncAt', connection.last_successful_sync_at,
        'createdBy', connection.created_by,
        'createdAt', connection.created_at,
        'updatedAt', connection.updated_at
      )
      order by connection.updated_at desc, connection.id
    )
    from remhaos_integration.connections connection
    where connection.organization_id = v_context.organization_id
  ), '[]'::jsonb);
end
$function$;

create function remhaos_integration_api.disconnect_integration_connection(
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
  v_context record;
  v_reason text := remhaos_integration._assert_reason(p_reason);
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_connection
  from remhaos_integration.connections connection
  where connection.id = p_connection_id
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"connection"}'::jsonb
    );
  end if;

  select * into v_context
  from remhaos_integration._authorize_organization_human(
    v_connection.organization_id,
    'manage_project_integrations'
  );

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'actorId', v_context.actor_id,
      'connectionId', p_connection_id,
      'reason', v_reason
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id,
    null,
    'disconnect_integration_connection',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;
  if v_connection.status = 'disconnected' then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"connection"}'::jsonb
    );
  end if;

  update remhaos_integration.connections
  set status = 'disconnected',
      credential_ref = null,
      token_expires_at = null,
      disconnected_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = v_connection.id
  returning * into v_connection;

  v_result := jsonb_build_object(
    'connectionId', v_connection.id,
    'providerCode', v_connection.provider_code,
    'status', v_connection.status
  );

  return remhaos_integration._complete_command(
    v_context.organization_id,
    null,
    'disconnect_integration_connection',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'integration_connection_disconnected',
    'disconnected',
    jsonb_build_object(
      'providerCode', v_connection.provider_code,
      'reasonCode', 'human_requested'
    )
  );
end
$function$;

create function remhaos_integration_api.list_project_connections(
  p_project_id uuid
)
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
  from projectceo_foundation._authorize_project_human(
    p_project_id,
    'manage_project_integrations'
  );

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'projectConnectionId', binding.id,
        'connectionId', binding.connection_id,
        'providerCode', connection.provider_code,
        'status', connection.status,
        'displayLabel', connection.display_label,
        'allowedCapabilities', binding.allowed_capabilities,
        'syncPolicy', binding.sync_policy,
        'clientVisibility', binding.client_visibility,
        'boundBy', binding.bound_by,
        'boundAt', binding.bound_at,
        'unboundAt', binding.unbound_at,
        'lastSuccessfulSyncAt', connection.last_successful_sync_at
      )
      order by binding.bound_at desc, binding.id
    )
    from remhaos_integration.project_connections binding
    join remhaos_integration.connections connection
      on connection.organization_id = binding.organization_id
     and connection.id = binding.connection_id
    where binding.organization_id = v_context.organization_id
      and binding.project_id = p_project_id
      and binding.unbound_at is null
  ), '[]'::jsonb);
end
$function$;

create function remhaos_integration_api.bind_project_connection(
  p_project_id uuid,
  p_connection_id uuid,
  p_capabilities text[],
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
  v_connection remhaos_integration.connections%rowtype;
  v_provider remhaos_integration.providers%rowtype;
  v_capabilities text[];
  v_binding remhaos_integration.project_connections%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
  v_outcome text := 'created';
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    p_project_id,
    'manage_project_integrations'
  );

  select * into v_connection
  from remhaos_integration.connections connection
  where connection.organization_id = v_context.organization_id
    and connection.id = p_connection_id
    and connection.status in ('connected', 'degraded', 'reauth_required')
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"connection"}'::jsonb
    );
  end if;

  select * into v_provider
  from remhaos_integration.providers provider
  where provider.code = v_connection.provider_code;
  v_capabilities := remhaos_integration._assert_capability_subset(
    v_provider.capabilities,
    p_capabilities
  );

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'actorId', v_context.actor_id,
      'projectId', p_project_id,
      'connectionId', p_connection_id,
      'capabilities', to_jsonb(v_capabilities)
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id,
    p_project_id,
    'bind_project_connection',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_binding
  from remhaos_integration.project_connections binding
  where binding.organization_id = v_context.organization_id
    and binding.project_id = p_project_id
    and binding.connection_id = p_connection_id
    and binding.unbound_at is null
  for update;

  if found then
    v_outcome := 'existing';
  else
    insert into remhaos_integration.project_connections (
      organization_id,
      project_id,
      connection_id,
      bound_by,
      allowed_capabilities,
      sync_policy,
      client_visibility
    )
    values (
      v_context.organization_id,
      p_project_id,
      p_connection_id,
      v_context.actor_user_id,
      v_capabilities,
      '{"mode":"manual"}'::jsonb,
      'hidden'
    )
    returning * into v_binding;
  end if;

  v_result := jsonb_build_object(
    'projectConnectionId', v_binding.id,
    'connectionId', v_binding.connection_id,
    'providerCode', v_connection.provider_code,
    'allowedCapabilities', v_binding.allowed_capabilities,
    'clientVisibility', v_binding.client_visibility,
    'kind', v_outcome
  );

  return remhaos_integration._complete_command(
    v_context.organization_id,
    p_project_id,
    'bind_project_connection',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'project_connection_bound',
    v_outcome,
    jsonb_build_object(
      'providerCode', v_connection.provider_code,
      'capabilityCount', cardinality(v_capabilities)
    )
  );
end
$function$;

create function remhaos_integration_api.unbind_project_connection(
  p_project_connection_id uuid,
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
  v_binding remhaos_integration.project_connections%rowtype;
  v_context record;
  v_reason text := remhaos_integration._assert_reason(p_reason);
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_binding
  from remhaos_integration.project_connections binding
  where binding.id = p_project_connection_id
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"projectConnection"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_foundation._authorize_project_human(
    v_binding.project_id,
    'manage_project_integrations'
  );
  if v_context.organization_id <> v_binding.organization_id then
    perform remhaos_integration._raise(
      'P1209',
      'scope_conflict',
      '{"reason":"PROJECT_CONNECTION_SCOPE"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'actorId', v_context.actor_id,
      'projectConnectionId', p_project_connection_id,
      'reason', v_reason
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id,
    v_binding.project_id,
    'unbind_project_connection',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;
  if v_binding.unbound_at is not null then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"projectConnection"}'::jsonb
    );
  end if;

  update remhaos_integration.project_connections
  set unbound_at = statement_timestamp()
  where id = v_binding.id
  returning * into v_binding;

  v_result := jsonb_build_object(
    'projectConnectionId', v_binding.id,
    'connectionId', v_binding.connection_id,
    'unboundAt', v_binding.unbound_at
  );

  return remhaos_integration._complete_command(
    v_context.organization_id,
    v_binding.project_id,
    'unbind_project_connection',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'project_connection_unbound',
    'unbound',
    jsonb_build_object('reasonCode', 'human_requested')
  );
end
$function$;

create function remhaos_integration_api.list_import_candidates(
  p_project_id uuid,
  p_status text default null
)
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
  from projectceo_foundation._authorize_project_human(
    p_project_id,
    'review_source'
  );
  if p_status is not null and p_status not in (
    'candidate',
    'reviewing',
    'accepted',
    'rejected',
    'superseded'
  ) then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"status"}'::jsonb
    );
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'candidateId', candidate.id,
        'sourceKind', candidate.source_kind,
        'status', candidate.status,
        'targetKind', candidate.target_kind,
        'scanState', candidate.scan_state,
        'serverSha256', candidate.server_sha256,
        'provenance', candidate.provenance,
        'createdAt', candidate.created_at,
        'reviewedAt', candidate.reviewed_at
      )
      order by candidate.created_at desc, candidate.id
    )
    from remhaos_integration.import_candidates candidate
    where candidate.organization_id = v_context.organization_id
      and candidate.project_id = p_project_id
      and (p_status is null or candidate.status = p_status)
  ), '[]'::jsonb);
end
$function$;

create function remhaos_integration_api.review_import_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_target jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_candidate remhaos_integration.import_candidates%rowtype;
  v_context record;
  v_target jsonb := remhaos_integration._assert_json_object(
    coalesce(p_target, '{}'::jsonb),
    'target'
  );
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_next_status text;
  v_result jsonb;
begin
  if p_decision not in ('accepted', 'rejected') then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"decision"}'::jsonb
    );
  end if;

  select * into v_candidate
  from remhaos_integration.import_candidates candidate
  where candidate.id = p_candidate_id
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"importCandidate"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_foundation._authorize_project_human(
    v_candidate.project_id,
    'review_source'
  );
  if v_context.organization_id <> v_candidate.organization_id then
    perform remhaos_integration._raise(
      'P1209',
      'scope_conflict',
      '{"reason":"IMPORT_CANDIDATE_SCOPE"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'actorId', v_context.actor_id,
      'candidateId', p_candidate_id,
      'decision', p_decision,
      'target', v_target
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id,
    v_candidate.project_id,
    'review_import_candidate',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;
  if v_candidate.status not in ('candidate', 'reviewing') then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"importCandidate"}'::jsonb
    );
  end if;

  v_next_status := p_decision;
  update remhaos_integration.import_candidates
  set status = v_next_status,
      reviewed_by = v_context.actor_user_id,
      reviewed_at = statement_timestamp(),
      provenance = provenance || jsonb_build_object(
        'reviewTargetKind',
        coalesce(v_target ->> 'targetKind', target_kind)
      )
  where id = v_candidate.id
  returning * into v_candidate;

  v_result := jsonb_build_object(
    'candidateId', v_candidate.id,
    'status', v_candidate.status,
    'targetKind', v_candidate.target_kind
  );

  return remhaos_integration._complete_command(
    v_context.organization_id,
    v_candidate.project_id,
    'review_import_candidate',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'import_candidate_reviewed',
    v_next_status,
    jsonb_build_object('decision', v_next_status)
  );
end
$function$;

create function remhaos_integration_api.consume_oauth_intent(
  p_provider_code text,
  p_state_digest bytea,
  p_redirect_uri_hash bytea
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_intent remhaos_integration.oauth_intents%rowtype;
begin
  update remhaos_integration.oauth_intents intent
  set consumed_at = statement_timestamp()
  where intent.provider_code =
      remhaos_integration._assert_provider_code(p_provider_code)
    and intent.state_digest = remhaos_integration._assert_bytea_32(
      p_state_digest,
      'stateDigest'
    )
    and intent.redirect_uri_hash = remhaos_integration._assert_bytea_32(
      p_redirect_uri_hash,
      'redirectUriHash'
    )
    and intent.consumed_at is null
    and intent.expires_at > statement_timestamp()
  returning * into v_intent;

  if not found then
    perform remhaos_integration._raise(
      'P1205',
      'expired_or_consumed',
      '{"entity":"oauthIntent"}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'intentId', v_intent.id,
    'providerCode', v_intent.provider_code,
    'organizationId', v_intent.organization_id,
    'actorId', v_intent.actor_id,
    'requestedScopes', v_intent.requested_scopes,
    'pkceCredentialRef', v_intent.pkce_credential_ref
  );
end
$function$;

create function remhaos_integration_api.activate_oauth_connection(
  p_intent_id uuid,
  p_credential_ref text,
  p_granted_scopes text[],
  p_external_subject_hash bytea,
  p_display_label text,
  p_metadata jsonb,
  p_token_expires_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_intent remhaos_integration.oauth_intents%rowtype;
  v_connection remhaos_integration.connections%rowtype;
  v_scopes text[] := remhaos_integration._assert_scopes(
    p_granted_scopes,
    false
  );
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_intent
  from remhaos_integration.oauth_intents intent
  where intent.id = p_intent_id
    and intent.consumed_at is not null
    and intent.expires_at > statement_timestamp()
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"oauthIntent"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'intentId', p_intent_id,
      'providerCode', v_intent.provider_code,
      'grantedScopes', to_jsonb(v_scopes),
      'externalSubjectHash', encode(p_external_subject_hash, 'hex')
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_intent.organization_id,
    null,
    'activate_oauth_connection',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_connection
  from remhaos_integration.connections connection
  where connection.organization_id = v_intent.organization_id
    and connection.provider_code = v_intent.provider_code
    and connection.external_subject_hash =
      remhaos_integration._assert_bytea_32(
        p_external_subject_hash,
        'externalSubjectHash'
      )
    and connection.status <> 'disconnected'
  for update;

  if found then
    update remhaos_integration.connections
    set status = 'connected',
        credential_ref =
          remhaos_integration._normalize_credential_ref(p_credential_ref),
        granted_scopes = v_scopes,
        display_label = remhaos_integration._assert_safe_text(
          p_display_label,
          'displayLabel',
          160,
          false
        ),
        metadata = remhaos_integration._assert_json_object(
          coalesce(p_metadata, '{}'::jsonb),
          'metadata'
        ),
        token_expires_at = p_token_expires_at,
        updated_at = statement_timestamp()
    where id = v_connection.id
    returning * into v_connection;
  else
    insert into remhaos_integration.connections (
      organization_id,
      provider_code,
      created_by,
      status,
      credential_ref,
      granted_scopes,
      external_subject_hash,
      display_label,
      metadata,
      token_expires_at
    )
    values (
      v_intent.organization_id,
      v_intent.provider_code,
      v_intent.actor_id,
      'connected',
      remhaos_integration._normalize_credential_ref(p_credential_ref),
      v_scopes,
      remhaos_integration._assert_bytea_32(
        p_external_subject_hash,
        'externalSubjectHash'
      ),
      remhaos_integration._assert_safe_text(
        p_display_label,
        'displayLabel',
        160,
        false
      ),
      remhaos_integration._assert_json_object(
        coalesce(p_metadata, '{}'::jsonb),
        'metadata'
      ),
      p_token_expires_at
    )
    returning * into v_connection;
  end if;

  v_result := jsonb_build_object(
    'connectionId', v_connection.id,
    'providerCode', v_connection.provider_code,
    'organizationId', v_connection.organization_id,
    'status', v_connection.status
  );

  return remhaos_integration._complete_command(
    v_intent.organization_id,
    null,
    'activate_oauth_connection',
    v_key_digest,
    v_request_digest,
    'system',
    'system:oauth-callback',
    null,
    v_result,
    'integration_connection_activated',
    'connected',
    jsonb_build_object(
      'providerCode', v_connection.provider_code,
      'scopeCount', cardinality(v_scopes)
    )
  );
end
$function$;

create function remhaos_integration_api.record_verified_webhook(
  p_provider_code text,
  p_delivery_id_hash bytea,
  p_payload_sha256 bytea,
  p_signature_state text,
  p_status text,
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
  v_receipt remhaos_integration.webhook_receipts%rowtype;
  v_system_org uuid;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_signature_state not in ('verified', 'rejected', 'not_supported')
     or p_status not in ('received', 'enqueued', 'processed', 'rejected') then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"webhook"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'providerCode', p_provider_code,
      'deliveryIdHash', encode(p_delivery_id_hash, 'hex'),
      'payloadSha256', encode(p_payload_sha256, 'hex'),
      'signatureState', p_signature_state,
      'status', p_status
    )
  );

  select min(id::text)::uuid into v_system_org
  from project_intelligence.organizations
  where cell_code = 'ru'
    and status = 'active';
  if v_system_org is not null then
    v_replay := remhaos_integration._replay_or_null(
      v_system_org,
      null,
      'record_verified_webhook',
      v_key_digest,
      v_request_digest
    );
    if v_replay is not null then
      return v_replay;
    end if;
  end if;

  insert into remhaos_integration.webhook_receipts (
    provider_code,
    delivery_id_hash,
    payload_sha256,
    signature_state,
    status,
    expires_at
  )
  values (
    remhaos_integration._assert_provider_code(p_provider_code),
    remhaos_integration._assert_bytea_32(
      p_delivery_id_hash,
      'deliveryIdHash'
    ),
    remhaos_integration._assert_bytea_32(p_payload_sha256, 'payloadSha256'),
    p_signature_state,
    p_status,
    p_expires_at
  )
  on conflict (provider_code, delivery_id_hash) do update
  set status = 'duplicate',
      processed_at = statement_timestamp()
  returning * into v_receipt;

  v_result := jsonb_build_object(
    'receiptId', v_receipt.id,
    'providerCode', v_receipt.provider_code,
    'status', v_receipt.status
  );

  if v_system_org is null then
    return jsonb_build_object(
      'operation', 'record_verified_webhook',
      'replay', false,
      'result', v_result
    );
  end if;

  return remhaos_integration._complete_command(
    v_system_org,
    null,
    'record_verified_webhook',
    v_key_digest,
    v_request_digest,
    'system',
    'system:webhook-boundary',
    null,
    v_result,
    'integration_webhook_recorded',
    v_receipt.status,
    jsonb_build_object('providerCode', v_receipt.provider_code)
  );
end
$function$;

create function remhaos_integration_api.enqueue_integration_job(
  p_organization_id uuid,
  p_project_id uuid,
  p_connection_id uuid,
  p_job_kind text,
  p_idempotency_key text,
  p_input_ref jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_job remhaos_integration.sync_jobs%rowtype;
  v_connection remhaos_integration.connections%rowtype;
  v_key_digest bytea;
  v_job_key text;
  v_request_digest bytea;
  v_replay jsonb;
  v_input_ref jsonb := remhaos_integration._assert_json_object(
    coalesce(p_input_ref, '{}'::jsonb),
    'inputRef'
  );
  v_result jsonb;
begin
  select * into v_connection
  from remhaos_integration.connections connection
  where connection.organization_id = p_organization_id
    and connection.id = p_connection_id
    and connection.status in ('connected', 'degraded', 'reauth_required');
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"connection"}'::jsonb
    );
  end if;
  if not exists (
    select 1
    from project_intelligence.project_workflows workflow
    where workflow.organization_id = p_organization_id
      and workflow.project_id = p_project_id
  ) then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"project"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_job_key := encode(v_key_digest, 'hex');
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'organizationId', p_organization_id,
      'projectId', p_project_id,
      'connectionId', p_connection_id,
      'jobKind', p_job_kind,
      'inputRef', v_input_ref
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    p_organization_id,
    p_project_id,
    'enqueue_integration_job',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  insert into remhaos_integration.sync_jobs (
    organization_id,
    project_id,
    connection_id,
    job_kind,
    idempotency_key,
    input_ref
  )
  values (
    p_organization_id,
    p_project_id,
    p_connection_id,
    p_job_kind,
    v_job_key,
    v_input_ref
  )
  on conflict (organization_id, project_id, job_kind, idempotency_key)
  do update set id = remhaos_integration.sync_jobs.id
  returning * into v_job;

  v_result := jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'jobKind', v_job.job_kind
  );

  return remhaos_integration._complete_command(
    p_organization_id,
    p_project_id,
    'enqueue_integration_job',
    v_key_digest,
    v_request_digest,
    'system',
    'system:integration-boundary',
    null,
    v_result,
    'integration_job_enqueued',
    v_job.status,
    jsonb_build_object('providerCode', v_connection.provider_code)
  );
end
$function$;

create function remhaos_integration_api.claim_integration_jobs(
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
    where (
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

create function remhaos_integration_api.complete_integration_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_result_ref jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_job remhaos_integration.sync_jobs%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result_ref jsonb := remhaos_integration._assert_json_object(
    coalesce(p_result_ref, '{}'::jsonb),
    'resultRef'
  );
  v_result jsonb;
begin
  select * into v_job
  from remhaos_integration.sync_jobs job
  where job.id = p_job_id;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"job"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'jobId', p_job_id,
      'leaseToken', p_lease_token,
      'resultRef', v_result_ref
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_job.organization_id,
    v_job.project_id,
    'complete_integration_job',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  update remhaos_integration.sync_jobs job
  set status = 'succeeded',
      lease_token = null,
      lease_expires_at = null,
      result_ref = v_result_ref,
      finished_at = statement_timestamp()
  where job.id = p_job_id
    and job.status = 'leased'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > statement_timestamp()
  returning * into v_job;
  if not found then
    perform remhaos_integration._raise(
      'P1208',
      'lease_conflict',
      '{"entity":"job"}'::jsonb
    );
  end if;

  v_result := jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status
  );
  return remhaos_integration._complete_command(
    v_job.organization_id,
    v_job.project_id,
    'complete_integration_job',
    v_key_digest,
    v_request_digest,
    'system',
    'system:integration-worker',
    null,
    v_result,
    'integration_job_completed',
    'succeeded',
    jsonb_build_object('jobKind', v_job.job_kind)
  );
end
$function$;

create function remhaos_integration_api.fail_integration_job(
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
volatile
security definer
set search_path = ''
as $function$
declare
  v_existing remhaos_integration.sync_jobs%rowtype;
  v_job remhaos_integration.sync_jobs%rowtype;
  v_error_code text := remhaos_integration._assert_safe_text(
    p_error_code,
    'errorCode',
    80,
    true
  );
  v_retryable boolean := coalesce(p_retryable, false);
  v_max_attempts integer := coalesce(p_max_attempts, 3);
  v_retry_after integer := coalesce(p_retry_after_seconds, 60);
  v_next_status text;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_existing
  from remhaos_integration.sync_jobs job
  where job.id = p_job_id;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"job"}'::jsonb
    );
  end if;
  if v_max_attempts < 1 or v_max_attempts > 20
     or v_retry_after < 1 or v_retry_after > 86400 then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"retryPolicy"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'jobId', p_job_id,
      'leaseToken', p_lease_token,
      'errorCode', v_error_code,
      'retryable', v_retryable,
      'maxAttempts', v_max_attempts,
      'retryAfterSeconds', v_retry_after
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_existing.organization_id,
    v_existing.project_id,
    'fail_integration_job',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_next_status := case
    when v_retryable and v_existing.attempt_count < v_max_attempts
      then 'retryable_failed'
    else 'dead_letter'
  end;

  update remhaos_integration.sync_jobs job
  set status = v_next_status,
      lease_token = null,
      lease_expires_at = null,
      available_at = case
        when v_next_status = 'retryable_failed'
          then statement_timestamp() + make_interval(secs => v_retry_after)
        else job.available_at
      end,
      last_error_code = v_error_code,
      finished_at = case
        when v_next_status = 'dead_letter' then statement_timestamp()
        else null
      end
  where job.id = p_job_id
    and job.status = 'leased'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > statement_timestamp()
  returning * into v_job;
  if not found then
    perform remhaos_integration._raise(
      'P1208',
      'lease_conflict',
      '{"entity":"job"}'::jsonb
    );
  end if;

  v_result := jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'lastErrorCode', v_job.last_error_code
  );
  return remhaos_integration._complete_command(
    v_job.organization_id,
    v_job.project_id,
    'fail_integration_job',
    v_key_digest,
    v_request_digest,
    'system',
    'system:integration-worker',
    null,
    v_result,
    'integration_job_failed',
    v_job.status,
    jsonb_build_object('jobKind', v_job.job_kind)
  );
end
$function$;

create function remhaos_integration_api.upsert_external_object(
  p_project_connection_id uuid,
  p_provider_object_key text,
  p_provider_object_hash bytea,
  p_object_kind text,
  p_display_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_external_revision text,
  p_modified_at_provider timestamptz,
  p_metadata jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_binding remhaos_integration.project_connections%rowtype;
  v_object remhaos_integration.external_objects%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_binding
  from remhaos_integration.project_connections binding
  where binding.id = p_project_connection_id
    and binding.unbound_at is null;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"projectConnection"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'projectConnectionId', p_project_connection_id,
      'providerObjectHash', encode(p_provider_object_hash, 'hex'),
      'objectKind', p_object_kind,
      'externalRevision', p_external_revision
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_binding.organization_id,
    v_binding.project_id,
    'upsert_external_object',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_object
  from remhaos_integration.external_objects object
  where object.project_connection_id = p_project_connection_id
    and object.provider_object_hash =
      remhaos_integration._assert_bytea_32(
        p_provider_object_hash,
        'providerObjectHash'
      )
    and (
      (p_external_revision is not null and object.external_revision = p_external_revision)
      or (p_external_revision is null and object.external_revision is null)
    )
  for update;

  if found then
    update remhaos_integration.external_objects
    set display_name = remhaos_integration._assert_safe_text(
          p_display_name,
          'displayName',
          255,
          false
        ),
        mime_type = case
          when p_mime_type is null then null
          else lower(remhaos_integration._assert_safe_text(
            p_mime_type,
            'mimeType',
            255,
            false
          ))
        end,
        size_bytes = p_size_bytes,
        modified_at_provider = p_modified_at_provider,
        metadata = remhaos_integration._assert_json_object(
          coalesce(p_metadata, '{}'::jsonb),
          'metadata'
        ),
        last_seen_at = statement_timestamp()
    where id = v_object.id
    returning * into v_object;
  else
    insert into remhaos_integration.external_objects (
      organization_id,
      project_id,
      project_connection_id,
      provider_object_key,
      provider_object_hash,
      object_kind,
      display_name,
      mime_type,
      size_bytes,
      external_revision,
      modified_at_provider,
      metadata
    )
    values (
      v_binding.organization_id,
      v_binding.project_id,
      p_project_connection_id,
      remhaos_integration._assert_safe_text(
        p_provider_object_key,
        'providerObjectKey',
        1024,
        true
      ),
      remhaos_integration._assert_bytea_32(
        p_provider_object_hash,
        'providerObjectHash'
      ),
      p_object_kind,
      remhaos_integration._assert_safe_text(
        p_display_name,
        'displayName',
        255,
        false
      ),
      case
        when p_mime_type is null then null
        else lower(remhaos_integration._assert_safe_text(
          p_mime_type,
          'mimeType',
          255,
          false
        ))
      end,
      p_size_bytes,
      remhaos_integration._assert_safe_text(
        p_external_revision,
        'externalRevision',
        255,
        false
      ),
      p_modified_at_provider,
      remhaos_integration._assert_json_object(
        coalesce(p_metadata, '{}'::jsonb),
        'metadata'
      )
    )
    returning * into v_object;
  end if;

  v_result := jsonb_build_object(
    'externalObjectId', v_object.id,
    'projectConnectionId', v_object.project_connection_id,
    'objectKind', v_object.object_kind,
    'externalRevision', v_object.external_revision
  );
  return remhaos_integration._complete_command(
    v_binding.organization_id,
    v_binding.project_id,
    'upsert_external_object',
    v_key_digest,
    v_request_digest,
    'system',
    'system:integration-worker',
    null,
    v_result,
    'external_object_upserted',
    'upserted',
    jsonb_build_object('objectKind', v_object.object_kind)
  );
end
$function$;

create function remhaos_integration_api.create_import_candidate(
  p_project_id uuid,
  p_external_object_id uuid,
  p_source_kind text,
  p_target_kind text,
  p_internal_object_key text,
  p_server_sha256 text,
  p_scan_state text,
  p_provenance jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_object remhaos_integration.external_objects%rowtype;
  v_candidate remhaos_integration.import_candidates%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_object
  from remhaos_integration.external_objects object
  where object.id = p_external_object_id
    and object.project_id = p_project_id;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"externalObject"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'projectId', p_project_id,
      'externalObjectId', p_external_object_id,
      'sourceKind', p_source_kind,
      'targetKind', p_target_kind,
      'serverSha256', p_server_sha256
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_object.organization_id,
    p_project_id,
    'create_import_candidate',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  insert into remhaos_integration.import_candidates (
    organization_id,
    project_id,
    external_object_id,
    source_kind,
    target_kind,
    internal_object_key,
    server_sha256,
    scan_state,
    provenance
  )
  values (
    v_object.organization_id,
    p_project_id,
    p_external_object_id,
    p_source_kind,
    p_target_kind,
    remhaos_integration._assert_safe_text(
      p_internal_object_key,
      'internalObjectKey',
      512,
      false
    ),
    p_server_sha256,
    p_scan_state,
    remhaos_integration._assert_json_object(
      coalesce(p_provenance, '{}'::jsonb),
      'provenance'
    )
  )
  returning * into v_candidate;

  v_result := jsonb_build_object(
    'candidateId', v_candidate.id,
    'state', 'candidate',
    'exactExternalRevision', v_object.external_revision
  );
  return remhaos_integration._complete_command(
    v_object.organization_id,
    p_project_id,
    'create_import_candidate',
    v_key_digest,
    v_request_digest,
    'system',
    'system:integration-worker',
    null,
    v_result,
    'import_candidate_created',
    'candidate',
    jsonb_build_object('sourceKind', v_candidate.source_kind)
  );
end
$function$;

do $integration_operations_table_security$
declare
  v_table text;
begin
  foreach v_table in array array[
    'external_objects',
    'import_candidates',
    'sync_jobs',
    'webhook_receipts'
  ]
  loop
    execute format(
      'alter table remhaos_integration.%I owner to pi_table_owner',
      v_table
    );
    execute format(
      'alter table remhaos_integration.%I enable row level security',
      v_table
    );
    execute format(
      'alter table remhaos_integration.%I force row level security',
      v_table
    );
    execute format(
      'revoke all on table remhaos_integration.%I '
      || 'from public, anon, authenticated, service_role, '
      || 'pi_human_executor, pi_worker_executor',
      v_table
    );
    execute format(
      'create policy %I on remhaos_integration.%I '
      || 'for all to pi_table_owner using (true) with check (true)',
      v_table || '_internal_owner',
      v_table
    );
  end loop;
end
$integration_operations_table_security$;

alter function remhaos_integration_api.list_available_integration_providers()
  owner to pi_table_owner;
alter function remhaos_integration_api.list_organization_connections(uuid)
  owner to pi_table_owner;
alter function remhaos_integration_api.disconnect_integration_connection(
  uuid, text, text
) owner to pi_table_owner;
alter function remhaos_integration_api.list_project_connections(uuid)
  owner to pi_table_owner;
alter function remhaos_integration_api.bind_project_connection(
  uuid, uuid, text[], text
) owner to pi_table_owner;
alter function remhaos_integration_api.unbind_project_connection(
  uuid, text, text
) owner to pi_table_owner;
alter function remhaos_integration_api.list_import_candidates(uuid, text)
  owner to pi_table_owner;
alter function remhaos_integration_api.review_import_candidate(
  uuid, text, jsonb, text
) owner to pi_table_owner;
alter function remhaos_integration_api.consume_oauth_intent(text, bytea, bytea)
  owner to pi_table_owner;
alter function remhaos_integration_api.activate_oauth_connection(
  uuid, text, text[], bytea, text, jsonb, timestamptz, text
) owner to pi_table_owner;
alter function remhaos_integration_api.record_verified_webhook(
  text, bytea, bytea, text, text, timestamptz, text
) owner to pi_table_owner;
alter function remhaos_integration_api.enqueue_integration_job(
  uuid, uuid, uuid, text, text, jsonb
) owner to pi_table_owner;
alter function remhaos_integration_api.claim_integration_jobs(integer, integer)
  owner to pi_table_owner;
alter function remhaos_integration_api.complete_integration_job(
  uuid, uuid, jsonb, text
) owner to pi_table_owner;
alter function remhaos_integration_api.fail_integration_job(
  uuid, uuid, text, boolean, integer, integer, text
) owner to pi_table_owner;
alter function remhaos_integration_api.upsert_external_object(
  uuid, text, bytea, text, text, text, bigint, text, timestamptz, jsonb, text
) owner to pi_table_owner;
alter function remhaos_integration_api.create_import_candidate(
  uuid, uuid, text, text, text, text, text, jsonb, text
) owner to pi_table_owner;

revoke all on all functions in schema remhaos_integration
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on all functions in schema remhaos_integration_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant usage on schema remhaos_integration_api
  to authenticated, service_role, pi_worker_executor;

grant execute on function
  remhaos_integration_api.list_available_integration_providers(),
  remhaos_integration_api.list_organization_connections(uuid),
  remhaos_integration_api.disconnect_integration_connection(uuid, text, text),
  remhaos_integration_api.list_project_connections(uuid),
  remhaos_integration_api.bind_project_connection(uuid, uuid, text[], text),
  remhaos_integration_api.unbind_project_connection(uuid, text, text),
  remhaos_integration_api.list_import_candidates(uuid, text),
  remhaos_integration_api.review_import_candidate(uuid, text, jsonb, text)
  to authenticated;

grant execute on function
  remhaos_integration_api.consume_oauth_intent(text, bytea, bytea),
  remhaos_integration_api.activate_oauth_connection(
    uuid, text, text[], bytea, text, jsonb, timestamptz, text
  ),
  remhaos_integration_api.record_verified_webhook(
    text, bytea, bytea, text, text, timestamptz, text
  ),
  remhaos_integration_api.enqueue_integration_job(
    uuid, uuid, uuid, text, text, jsonb
  ),
  remhaos_integration_api.claim_integration_jobs(integer, integer),
  remhaos_integration_api.complete_integration_job(uuid, uuid, jsonb, text),
  remhaos_integration_api.fail_integration_job(
    uuid, uuid, text, boolean, integer, integer, text
  ),
  remhaos_integration_api.upsert_external_object(
    uuid, text, bytea, text, text, text, bigint, text, timestamptz, jsonb, text
  ),
  remhaos_integration_api.create_import_candidate(
    uuid, uuid, text, text, text, text, text, jsonb, text
  )
  to service_role, pi_worker_executor;

commit;
