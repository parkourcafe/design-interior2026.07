-- RemHaOS Integration Gateway PR1: private registry foundation.
--
-- Additive only. Existing ProjectCEO compatibility schemas and timestamped
-- migrations stay unchanged; this migration creates the new private registry
-- schema, request-bound API schema, common helpers and organization/project
-- connection primitives.

begin;

set local check_function_bodies = on;

create schema remhaos_integration authorization pi_table_owner;
create schema remhaos_integration_api authorization pi_table_owner;

revoke all on schema remhaos_integration
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on schema remhaos_integration_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke create on schema remhaos_integration from public;
revoke create on schema remhaos_integration_api from public;

alter default privileges for role pi_table_owner
  in schema remhaos_integration
  revoke all on tables
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema remhaos_integration
  revoke execute on functions
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema remhaos_integration_api
  revoke execute on functions
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

alter table projectceo_foundation.project_member_capabilities
  drop constraint if exists project_member_capabilities_capability_check;
alter table projectceo_foundation.project_member_capabilities
  add constraint project_member_capabilities_capability_check
  check (capability in (
    'view_project',
    'manage_project',
    'manage_access',
    'manage_project_integrations',
    'register_source',
    'review_source',
    'review_claim',
    'create_selection',
    'review_selection',
    'publish_baseline',
    'publish_release',
    'distribute_release',
    'acknowledge_release',
    'revise_decision',
    'create_change',
    'review_change_impact',
    'upload_photo_evidence',
    'review_milestone',
    'view_audit',
    'manage_budget',
    'prepare_client_handoff'
  ));

create or replace function projectceo_foundation._role_capabilities(p_role text)
returns table (capability text)
language sql
immutable
set search_path = ''
as $function$
  select value
  from unnest(
    case p_role
      when 'owner_lead' then array[
        'view_project', 'manage_project', 'manage_access',
        'manage_project_integrations', 'register_source', 'review_source',
        'review_claim', 'create_selection', 'review_selection',
        'publish_baseline', 'publish_release', 'distribute_release',
        'acknowledge_release', 'revise_decision', 'create_change',
        'review_change_impact', 'upload_photo_evidence', 'review_milestone',
        'view_audit', 'manage_budget', 'prepare_client_handoff'
      ]::text[]
      when 'architect' then array[
        'view_project', 'register_source', 'review_source', 'review_claim',
        'create_selection', 'review_selection', 'publish_baseline',
        'publish_release', 'distribute_release', 'acknowledge_release',
        'revise_decision', 'create_change', 'review_change_impact',
        'upload_photo_evidence', 'review_milestone', 'view_audit',
        'manage_budget', 'prepare_client_handoff'
      ]::text[]
      when 'builder' then array[
        'view_project', 'register_source', 'acknowledge_release',
        'create_change', 'upload_photo_evidence'
      ]::text[]
      when 'client_approver' then array[
        'view_project', 'review_selection', 'acknowledge_release',
        'create_change', 'review_milestone'
      ]::text[]
      else array[]::text[]
    end
  ) value
$function$;

create function remhaos_integration._raise(
  p_sqlstate text,
  p_code text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = p_sqlstate,
    message = p_code,
    detail = coalesce(p_detail, '{}'::jsonb)::text;
end
$function$;

create function remhaos_integration._assert_idempotency_key(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := btrim(coalesce(p_value, ''));
begin
  if length(v_value) < 1 or length(v_value) > 512 then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"idempotencyKey"}'::jsonb
    );
  end if;
  return v_value;
end
$function$;

create function remhaos_integration._assert_reason(
  p_value text,
  p_field text default 'reason'
)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := btrim(coalesce(p_value, ''));
begin
  if length(v_value) < 1 or length(v_value) > 500
     or v_value ~ '[[:cntrl:]]' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  return v_value;
end
$function$;

create function remhaos_integration._assert_bytea_32(
  p_value bytea,
  p_field text
)
returns bytea
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_value is null or octet_length(p_value) <> 32 then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  return p_value;
end
$function$;

create function remhaos_integration._assert_safe_text(
  p_value text,
  p_field text,
  p_max_length integer,
  p_required boolean default true
)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := btrim(coalesce(p_value, ''));
begin
  if (p_required and length(v_value) = 0)
     or length(v_value) > p_max_length
     or v_value ~ '[[:cntrl:]]' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  if not p_required and length(v_value) = 0 then
    return null;
  end if;
  return v_value;
end
$function$;

create function remhaos_integration._assert_json_object(
  p_value jsonb,
  p_field text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  if p_value ?| array[
    'access_token',
    'refresh_token',
    'authorization_code',
    'signed_url',
    'callback_url',
    'raw_query',
    'provider_object_id',
    'filename',
    'raw_filename',
    'message_body',
    'file_contents',
    'webhook_body',
    'email',
    'phone',
    'client_pii',
    'token',
    'secret'
  ] then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      jsonb_build_object('field', p_field, 'reason', 'FORBIDDEN_METADATA_KEY')
    );
  end if;
  return p_value;
end
$function$;

create function remhaos_integration._assert_capabilities(
  p_values text[],
  p_allow_empty boolean default false
)
returns text[]
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_values text[] := coalesce(p_values, array[]::text[]);
begin
  if (not p_allow_empty and cardinality(v_values) = 0)
     or cardinality(v_values) > 32
     or exists (
       select 1
       from unnest(v_values) value
       where value is null
          or value <> btrim(value)
          or value not in (
            'list_objects',
            'import_object',
            'receive_webhook',
            'send_notification',
            'export_published_artifact'
          )
     )
     or (
       select count(*) <> count(distinct value)
       from unnest(v_values) value
     ) then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"capabilities"}'::jsonb
    );
  end if;
  return v_values;
end
$function$;

create function remhaos_integration._provider_capability_codes(
  p_capabilities jsonb
)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select coalesce(array_agg(value order by value), array[]::text[])
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(p_capabilities -> 'capabilities') = 'array'
        then p_capabilities -> 'capabilities'
      else '[]'::jsonb
    end
  ) value
  where value in (
    'list_objects',
    'import_object',
    'receive_webhook',
    'send_notification',
    'export_published_artifact'
  );
$function$;

create function remhaos_integration._assert_capability_subset(
  p_provider_capabilities jsonb,
  p_requested text[]
)
returns text[]
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_requested text[] := remhaos_integration._assert_capabilities(
    p_requested,
    false
  );
  v_available text[] := remhaos_integration._provider_capability_codes(
    p_provider_capabilities
  );
begin
  if exists (
    select 1
    from unnest(v_requested) requested
    where requested <> all(v_available)
  ) then
    perform remhaos_integration._raise(
      'P1209',
      'scope_conflict',
      '{"reason":"CAPABILITY_NOT_GRANTED_BY_PROVIDER"}'::jsonb
    );
  end if;
  return v_requested;
end
$function$;

create function remhaos_integration._assert_scopes(
  p_values text[],
  p_allow_empty boolean default true
)
returns text[]
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_values text[] := coalesce(p_values, array[]::text[]);
begin
  if (not p_allow_empty and cardinality(v_values) = 0)
     or cardinality(v_values) > 32
     or exists (
       select 1
       from unnest(v_values) value
       where value is null
          or value <> btrim(value)
          or length(value) > 255
          or value ~ '[[:cntrl:]]'
     )
     or (
       select count(*) <> count(distinct value)
       from unnest(v_values) value
     ) then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"scopes"}'::jsonb
    );
  end if;
  return v_values;
end
$function$;

create function remhaos_integration._normalize_credential_ref(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := btrim(coalesce(p_value, ''));
begin
  if length(v_value) < 1
     or length(v_value) > 255
     or v_value ~ '[[:cntrl:]]'
     or v_value ~* '(sk-|ghp_|akia|-----begin|access_token|refresh_token)' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"credentialRef"}'::jsonb
    );
  end if;
  return v_value;
end
$function$;

create function remhaos_integration._assert_provider_code(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := btrim(coalesce(p_value, ''));
begin
  if v_value !~ '^[a-z][a-z0-9_]{1,63}$' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"providerCode"}'::jsonb
    );
  end if;
  return v_value;
end
$function$;

create table remhaos_integration.providers (
  code text primary key
    check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  display_name_key text not null
    check (
      char_length(btrim(display_name_key)) between 1 and 160
      and display_name_key = btrim(display_name_key)
      and display_name_key ~ '^[a-z0-9_.-]+$'
    ),
  connection_mode text not null
    check (connection_mode in (
      'link_only',
      'oauth',
      'native',
      'webhook',
      'file_import'
    )),
  capabilities jsonb not null
    check (
      jsonb_typeof(capabilities) = 'object'
      and not (capabilities ?| array[
        'access_token',
        'refresh_token',
        'authorization_code',
        'token',
        'secret'
      ])
    ),
  legal_state text not null
    check (legal_state in ('allowed', 'staging_only', 'blocked')),
  default_enabled boolean not null default false,
  created_at timestamptz not null default statement_timestamp()
);

create table remhaos_integration.oauth_intents (
  id uuid primary key default extensions.gen_random_uuid(),
  provider_code text not null,
  organization_id uuid not null,
  actor_id uuid not null,
  state_digest bytea not null
    check (octet_length(state_digest) = 32),
  pkce_credential_ref text not null
    check (
      char_length(btrim(pkce_credential_ref)) between 1 and 255
      and pkce_credential_ref = btrim(pkce_credential_ref)
      and pkce_credential_ref !~* '(sk-|ghp_|akia|-----begin|verifier|token|secret)'
    ),
  redirect_uri_hash bytea not null
    check (octet_length(redirect_uri_hash) = 32),
  requested_scopes text[] not null default array[]::text[],
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint oauth_intents_provider_fkey
    foreign key (provider_code)
    references remhaos_integration.providers (code)
    on delete restrict,
  constraint oauth_intents_organization_fkey
    foreign key (organization_id)
    references project_intelligence.organizations (id)
    on delete restrict,
  constraint oauth_intents_actor_fkey
    foreign key (organization_id, actor_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint oauth_intents_state_digest_key unique (state_digest),
  constraint oauth_intents_ttl_check
    check (
      expires_at > created_at
      and expires_at <= created_at + interval '30 minutes'
    ),
  constraint oauth_intents_consumed_check
    check (consumed_at is null or consumed_at >= created_at)
);

create index oauth_intents_provider_org_idx
  on remhaos_integration.oauth_intents (
    provider_code,
    organization_id,
    expires_at
  );
create index oauth_intents_actor_idx
  on remhaos_integration.oauth_intents (
    organization_id,
    actor_id,
    created_at desc
  );

create table remhaos_integration.connections (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  provider_code text not null,
  created_by uuid not null,
  status text not null
    check (status in (
      'pending',
      'connected',
      'degraded',
      'reauth_required',
      'disconnected'
    )),
  credential_ref text,
  granted_scopes text[] not null default array[]::text[],
  external_subject_hash bytea not null
    check (octet_length(external_subject_hash) = 32),
  display_label text
    check (
      display_label is null
      or (
        char_length(btrim(display_label)) between 1 and 160
        and display_label = btrim(display_label)
        and display_label !~ '[[:cntrl:]]'
      )
    ),
  metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(metadata) = 'object'
      and not (metadata ?| array[
        'access_token',
        'refresh_token',
        'authorization_code',
        'signed_url',
        'raw_query',
        'raw_provider_subject',
        'email',
        'phone',
        'token',
        'secret'
      ])
    ),
  token_expires_at timestamptz,
  last_successful_sync_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint connections_organization_fkey
    foreign key (organization_id)
    references project_intelligence.organizations (id)
    on delete restrict,
  constraint connections_provider_fkey
    foreign key (provider_code)
    references remhaos_integration.providers (code)
    on delete restrict,
  constraint connections_creator_fkey
    foreign key (organization_id, created_by)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint connections_organization_id_key
    unique (organization_id, id),
  constraint connections_credential_shape_check
    check (
      (
        status in ('connected', 'degraded', 'reauth_required')
        and credential_ref is not null
      )
      or status in ('pending', 'disconnected')
    ),
  constraint connections_disconnect_shape_check
    check (
      (status = 'disconnected' and disconnected_at is not null)
      or (status <> 'disconnected' and disconnected_at is null)
    )
);

create unique index connections_active_subject_key
  on remhaos_integration.connections (
    organization_id,
    provider_code,
    external_subject_hash
  )
  where status <> 'disconnected';
create index connections_provider_status_idx
  on remhaos_integration.connections (
    organization_id,
    provider_code,
    status,
    updated_at desc
  );
create index connections_provider_code_idx
  on remhaos_integration.connections (provider_code);
create index connections_creator_idx
  on remhaos_integration.connections (organization_id, created_by);

create table remhaos_integration.project_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  connection_id uuid not null,
  bound_by uuid not null,
  allowed_capabilities text[] not null,
  sync_policy jsonb not null default '{"mode":"manual"}'::jsonb,
  client_visibility text not null default 'hidden'
    check (client_visibility = 'hidden'),
  bound_at timestamptz not null default statement_timestamp(),
  unbound_at timestamptz,
  constraint project_connections_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (
      organization_id,
      project_id
    )
    on delete restrict,
  constraint project_connections_connection_fkey
    foreign key (organization_id, connection_id)
    references remhaos_integration.connections (organization_id, id)
    on delete restrict,
  constraint project_connections_bound_by_fkey
    foreign key (organization_id, project_id, bound_by)
    references projectceo_foundation.project_memberships (
      organization_id,
      project_id,
      user_id
    )
    on delete restrict,
  constraint project_connections_scope_id_key
    unique (organization_id, project_id, id),
  constraint project_connections_sync_policy_check
    check (
      jsonb_typeof(sync_policy) = 'object'
      and coalesce(sync_policy ->> 'mode', '') in ('manual', 'disabled')
    )
);

create unique index project_connections_active_key
  on remhaos_integration.project_connections (project_id, connection_id)
  where unbound_at is null;
create index project_connections_project_idx
  on remhaos_integration.project_connections (
    organization_id,
    project_id,
    bound_at desc
  );
create index project_connections_connection_idx
  on remhaos_integration.project_connections (
    organization_id,
    connection_id
  );
create index project_connections_bound_by_idx
  on remhaos_integration.project_connections (
    organization_id,
    project_id,
    bound_by
  );

create table remhaos_integration.command_records (
  command_id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid,
  operation text not null
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
      'create_import_candidate'
    )),
  key_digest bytea not null
    check (octet_length(key_digest) = 32),
  request_digest bytea not null
    check (octet_length(request_digest) = 32),
  actor_type text not null check (actor_type in ('human', 'system')),
  actor_id text not null
    check (
      char_length(btrim(actor_id)) between 1 and 160
      and actor_id = btrim(actor_id)
      and actor_id !~ '[[:cntrl:]]'
    ),
  actor_user_id uuid,
  logical_result jsonb not null
    check (jsonb_typeof(logical_result) = 'object'),
  completed_at timestamptz not null default statement_timestamp(),
  constraint integration_command_records_organization_fkey
    foreign key (organization_id)
    references project_intelligence.organizations (id)
    on delete restrict,
  constraint integration_command_records_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (
      organization_id,
      project_id
    )
    on delete restrict,
  constraint integration_command_records_actor_fkey
    foreign key (organization_id, actor_user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint integration_command_records_scope_id_key
    unique (organization_id, project_id, command_id),
  constraint integration_command_records_actor_shape_check
    check (
      (
        actor_type = 'human'
        and actor_user_id is not null
        and actor_id = actor_user_id::text
      )
      or (
        actor_type = 'system'
        and actor_user_id is null
        and actor_id like 'system:%'
      )
    )
);

create unique index integration_command_records_idempotency_key
  on remhaos_integration.command_records (
    organization_id,
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    operation,
    key_digest
  );
create index integration_command_records_actor_idx
  on remhaos_integration.command_records (organization_id, actor_user_id)
  where actor_user_id is not null;

create table remhaos_integration.audit_events (
  audit_event_id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid,
  command_id uuid,
  actor_type text not null check (actor_type in ('human', 'system')),
  actor_id text not null
    check (
      char_length(btrim(actor_id)) between 1 and 160
      and actor_id = btrim(actor_id)
      and actor_id !~ '[[:cntrl:]]'
    ),
  action text not null
    check (
      char_length(btrim(action)) between 1 and 160
      and action = btrim(action)
      and action !~ '[[:cntrl:]]'
    ),
  provider_code text,
  connection_id uuid,
  project_connection_id uuid,
  external_object_id uuid,
  import_candidate_id uuid,
  job_id uuid,
  outcome_code text not null
    check (
      char_length(btrim(outcome_code)) between 1 and 80
      and outcome_code = btrim(outcome_code)
      and outcome_code !~ '[[:cntrl:]]'
    ),
  correlation_id text not null
    check (
      char_length(btrim(correlation_id)) between 1 and 160
      and correlation_id = btrim(correlation_id)
      and correlation_id !~ '[[:cntrl:]]'
    ),
  sanitized_metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(sanitized_metadata) = 'object'
      and not (sanitized_metadata ?| array[
        'access_token',
        'refresh_token',
        'authorization_code',
        'signed_url',
        'callback_url',
        'raw_query',
        'provider_object_id',
        'filename',
        'raw_filename',
        'message_body',
        'file_contents',
        'webhook_body',
        'email',
        'phone',
        'client_pii',
        'token',
        'secret'
      ])
    ),
  occurred_at timestamptz not null default statement_timestamp(),
  constraint integration_audit_events_organization_fkey
    foreign key (organization_id)
    references project_intelligence.organizations (id)
    on delete restrict,
  constraint integration_audit_events_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (
      organization_id,
      project_id
    )
    on delete restrict,
  constraint integration_audit_events_command_fkey
    foreign key (organization_id, project_id, command_id)
    references remhaos_integration.command_records (
      organization_id,
      project_id,
      command_id
    )
    on delete restrict
);

create index integration_audit_events_project_occurred_idx
  on remhaos_integration.audit_events (
    organization_id,
    project_id,
    occurred_at desc
  );
create index integration_audit_events_command_idx
  on remhaos_integration.audit_events (
    organization_id,
    project_id,
    command_id
  )
  where command_id is not null;
create index integration_audit_events_connection_idx
  on remhaos_integration.audit_events (
    organization_id,
    connection_id,
    occurred_at desc
  )
  where connection_id is not null;

create function remhaos_integration.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'REMHAOS_INTEGRATION_APPEND_ONLY';
end
$function$;

create function remhaos_integration._authorize_organization_human(
  p_organization_id uuid,
  p_capability text
)
returns table (
  organization_id uuid,
  actor_user_id uuid,
  actor_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    perform remhaos_integration._raise(
      'P1201',
      'unauthenticated',
      '{}'::jsonb
    );
  end if;

  select count(distinct o.id), min(o.id::text)::uuid
    into v_count, organization_id
  from project_intelligence.organizations o
  join project_intelligence.organization_members om
    on om.organization_id = o.id
   and om.user_id = v_user_id
   and om.status = 'active'
  join projectceo_foundation.project_memberships pm
    on pm.organization_id = o.id
   and pm.user_id = v_user_id
   and pm.status = 'active'
  join projectceo_foundation.project_member_capabilities pc
    on pc.organization_id = pm.organization_id
   and pc.project_id = pm.project_id
   and pc.user_id = pm.user_id
   and pc.capability = p_capability
  where o.id = p_organization_id
    and o.cell_code = 'ru'
    and o.status = 'active';

  if v_count = 0 then
    perform remhaos_integration._raise(
      'P1203',
      'forbidden',
      '{"reason":"ORGANIZATION_CAPABILITY_REQUIRED"}'::jsonb
    );
  elsif v_count <> 1 then
    perform remhaos_integration._raise(
      'P1209',
      'scope_conflict',
      '{"reason":"AMBIGUOUS_ORGANIZATION_SCOPE"}'::jsonb
    );
  end if;

  actor_user_id := v_user_id;
  actor_id := v_user_id::text;
  return next;
end
$function$;

create function remhaos_integration._replay_or_null(
  p_organization_id uuid,
  p_project_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_record remhaos_integration.command_records%rowtype;
begin
  select *
    into v_record
  from remhaos_integration.command_records command
  where command.organization_id = p_organization_id
    and coalesce(command.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and command.operation = p_operation
    and command.key_digest = p_key_digest;

  if not found then
    return null;
  end if;
  if v_record.request_digest <> p_request_digest then
    perform remhaos_integration._raise(
      'P1208',
      'idempotency_conflict',
      jsonb_build_object('operation', p_operation)
    );
  end if;

  return jsonb_build_object(
    'operation', p_operation,
    'replay', true,
    'result', v_record.logical_result
  );
end
$function$;

create function remhaos_integration._complete_command(
  p_organization_id uuid,
  p_project_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea,
  p_actor_type text,
  p_actor_id text,
  p_actor_user_id uuid,
  p_logical_result jsonb,
  p_action text,
  p_outcome_code text,
  p_sanitized_metadata jsonb default '{}'::jsonb,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_command_id uuid := extensions.gen_random_uuid();
  v_correlation_id text := coalesce(
    nullif(btrim(p_correlation_id), ''),
    'db:' || extensions.gen_random_uuid()::text
  );
begin
  insert into remhaos_integration.command_records (
    command_id,
    organization_id,
    project_id,
    operation,
    key_digest,
    request_digest,
    actor_type,
    actor_id,
    actor_user_id,
    logical_result
  )
  values (
    v_command_id,
    p_organization_id,
    p_project_id,
    p_operation,
    p_key_digest,
    p_request_digest,
    p_actor_type,
    p_actor_id,
    p_actor_user_id,
    remhaos_integration._assert_json_object(
      p_logical_result,
      'logicalResult'
    )
  );

  insert into remhaos_integration.audit_events (
    organization_id,
    project_id,
    command_id,
    actor_type,
    actor_id,
    action,
    outcome_code,
    correlation_id,
    sanitized_metadata
  )
  values (
    p_organization_id,
    p_project_id,
    v_command_id,
    p_actor_type,
    p_actor_id,
    p_action,
    p_outcome_code,
    v_correlation_id,
    remhaos_integration._assert_json_object(
      coalesce(p_sanitized_metadata, '{}'::jsonb),
      'sanitizedMetadata'
    )
  );

  return jsonb_build_object(
    'operation', p_operation,
    'replay', false,
    'result', p_logical_result
  );
end
$function$;

create trigger integration_command_records_no_update
  before update or delete on remhaos_integration.command_records
  for each row execute function remhaos_integration.reject_append_only_mutation();
create trigger integration_audit_events_no_update
  before update or delete on remhaos_integration.audit_events
  for each row execute function remhaos_integration.reject_append_only_mutation();

do $integration_table_security$
declare
  v_table text;
begin
  foreach v_table in array array[
    'providers',
    'oauth_intents',
    'connections',
    'project_connections',
    'command_records',
    'audit_events'
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
$integration_table_security$;

alter function projectceo_foundation._role_capabilities(text)
  owner to pi_table_owner;

alter function remhaos_integration._raise(text, text, jsonb)
  owner to pi_table_owner;
alter function remhaos_integration._assert_idempotency_key(text)
  owner to pi_table_owner;
alter function remhaos_integration._assert_reason(text, text)
  owner to pi_table_owner;
alter function remhaos_integration._assert_bytea_32(bytea, text)
  owner to pi_table_owner;
alter function remhaos_integration._assert_safe_text(text, text, integer, boolean)
  owner to pi_table_owner;
alter function remhaos_integration._assert_json_object(jsonb, text)
  owner to pi_table_owner;
alter function remhaos_integration._assert_capabilities(text[], boolean)
  owner to pi_table_owner;
alter function remhaos_integration._provider_capability_codes(jsonb)
  owner to pi_table_owner;
alter function remhaos_integration._assert_capability_subset(jsonb, text[])
  owner to pi_table_owner;
alter function remhaos_integration._assert_scopes(text[], boolean)
  owner to pi_table_owner;
alter function remhaos_integration._normalize_credential_ref(text)
  owner to pi_table_owner;
alter function remhaos_integration._assert_provider_code(text)
  owner to pi_table_owner;
alter function remhaos_integration.reject_append_only_mutation()
  owner to pi_table_owner;
alter function remhaos_integration._authorize_organization_human(uuid, text)
  owner to pi_table_owner;
alter function remhaos_integration._replay_or_null(
  uuid, uuid, text, bytea, bytea
) owner to pi_table_owner;
alter function remhaos_integration._complete_command(
  uuid, uuid, text, bytea, bytea, text, text, uuid, jsonb, text, text, jsonb, text
) owner to pi_table_owner;

grant usage on schema auth to pi_table_owner;
grant execute on function auth.uid() to pi_table_owner;

revoke all on all functions in schema remhaos_integration
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on all functions in schema remhaos_integration_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

commit;
