\set ON_ERROR_STOP on

insert into auth.users (id, email, email_confirmed_at) values
  (
    '61111111-1111-4111-8111-111111111111',
    'dbig-owner@example.test',
    statement_timestamp()
  ),
  (
    '62222222-2222-4222-8222-222222222222',
    'dbig-architect@example.test',
    statement_timestamp()
  ),
  (
    '63333333-3333-4333-8333-333333333333',
    'dbig-outsider@example.test',
    statement_timestamp()
  ),
  (
    '64444444-4444-4444-8444-444444444444',
    'dbig-client@example.test',
    statement_timestamp()
  );

insert into public.designers (id, name, studio_name) values
  (
    '61111111-1111-4111-8111-111111111111',
    'DBIG Owner',
    'RemHaOS Integration A'
  ),
  (
    '63333333-3333-4333-8333-333333333333',
    'DBIG Outsider',
    'RemHaOS Integration B'
  );

insert into public.projects (
  id,
  designer_id,
  client_name,
  status,
  intake_token
) values
  (
    '71111111-1111-4111-8111-111111111111',
    '61111111-1111-4111-8111-111111111111',
    'Integration Gateway A',
    'active_project',
    'dbig-project-a'
  ),
  (
    '72222222-2222-4222-8222-222222222222',
    '63333333-3333-4333-8333-333333333333',
    'Integration Gateway B',
    'active_project',
    'dbig-project-b'
  );

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select projectceo_api.enroll_organization_project(
  '71111111-1111-4111-8111-111111111111',
  'dbig-enroll-owner'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '63333333-3333-4333-8333-333333333333';
select projectceo_api.enroll_organization_project(
  '72222222-2222-4222-8222-222222222222',
  'dbig-enroll-outsider'
);
commit;

select workflow.organization_id as org_a
from project_intelligence.project_workflows workflow
where workflow.project_id = '71111111-1111-4111-8111-111111111111'
\gset dbig_

insert into project_intelligence.organization_members (
  organization_id,
  user_id,
  role,
  status
)
select
  workflow.organization_id,
  '62222222-2222-4222-8222-222222222222',
  'member',
  'active'
from project_intelligence.project_workflows workflow
where workflow.project_id = '71111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.project_memberships (
  organization_id,
  project_id,
  user_id,
  role,
  status
)
select
  workflow.organization_id,
  workflow.project_id,
  '62222222-2222-4222-8222-222222222222',
  'architect',
  'active'
from project_intelligence.project_workflows workflow
where workflow.project_id = '71111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.project_member_capabilities (
  organization_id,
  project_id,
  user_id,
  capability
)
select
  workflow.organization_id,
  workflow.project_id,
  '62222222-2222-4222-8222-222222222222',
  preset.capability
from project_intelligence.project_workflows workflow
cross join lateral projectceo_foundation._role_capabilities('architect') preset
where workflow.project_id = '71111111-1111-4111-8111-111111111111';

insert into project_intelligence.organization_members (
  organization_id,
  user_id,
  role,
  status
)
select
  workflow.organization_id,
  '64444444-4444-4444-8444-444444444444',
  'member',
  'active'
from project_intelligence.project_workflows workflow
where workflow.project_id = '71111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.project_memberships (
  organization_id,
  project_id,
  user_id,
  role,
  status
)
select
  workflow.organization_id,
  workflow.project_id,
  '64444444-4444-4444-8444-444444444444',
  'client_approver',
  'active'
from project_intelligence.project_workflows workflow
where workflow.project_id = '71111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.project_member_capabilities (
  organization_id,
  project_id,
  user_id,
  capability
)
select
  workflow.organization_id,
  workflow.project_id,
  '64444444-4444-4444-8444-444444444444',
  preset.capability
from project_intelligence.project_workflows workflow
cross join lateral projectceo_foundation._role_capabilities('client_approver') preset
where workflow.project_id = '71111111-1111-4111-8111-111111111111';

do $dbig_capability_seed$
begin
  if not exists (
    select 1
    from projectceo_foundation.project_member_capabilities
    where project_id = '71111111-1111-4111-8111-111111111111'
      and user_id = '61111111-1111-4111-8111-111111111111'
      and capability = 'manage_project_integrations'
  ) then
    raise exception 'DBIG_OWNER_INTEGRATION_CAPABILITY_MISSING';
  end if;
  if exists (
    select 1
    from projectceo_foundation.project_member_capabilities
    where project_id = '71111111-1111-4111-8111-111111111111'
      and user_id = '62222222-2222-4222-8222-222222222222'
      and capability = 'manage_project_integrations'
  ) then
    raise exception 'DBIG_ARCHITECT_GOT_INTEGRATION_CAPABILITY';
  end if;
end
$dbig_capability_seed$;

insert into remhaos_integration.providers (
  code,
  display_name_key,
  connection_mode,
  capabilities,
  legal_state,
  default_enabled
) values (
  'google_drive',
  'integrations.provider.google_drive',
  'oauth',
  '{"capabilities":["list_objects","import_object","receive_webhook"]}'::jsonb,
  'staging_only',
  false
)
on conflict (code) do nothing;

insert into remhaos_integration.oauth_intents (
  provider_code,
  organization_id,
  actor_id,
  state_digest,
  pkce_credential_ref,
  redirect_uri_hash,
  requested_scopes,
  expires_at
)
select
  'google_drive',
  workflow.organization_id,
  '61111111-1111-4111-8111-111111111111',
  decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'),
  'vault:pkce:dbig-google-drive',
  decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'),
  array['https://www.googleapis.com/auth/drive.file'],
  statement_timestamp() + interval '10 minutes'
from project_intelligence.project_workflows workflow
where workflow.project_id = '71111111-1111-4111-8111-111111111111';

begin;
set local role service_role;
do $dbig_oauth_wrong_redirect$
begin
  begin
    perform remhaos_integration_api.consume_oauth_intent(
      'google_drive',
      decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'),
      decode('3333333333333333333333333333333333333333333333333333333333333333', 'hex')
    );
    raise exception 'DBIG_OAUTH_WRONG_REDIRECT_ACCEPTED';
  exception when sqlstate 'P1205' then null;
  end;
end
$dbig_oauth_wrong_redirect$;
rollback;

begin;
set local role service_role;
select remhaos_integration_api.consume_oauth_intent(
  'google_drive',
  decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'),
  decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex')
);
commit;

begin;
set local role service_role;
do $dbig_oauth_consumed_once$
begin
  begin
    perform remhaos_integration_api.consume_oauth_intent(
      'google_drive',
      decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'),
      decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex')
    );
    raise exception 'DBIG_OAUTH_INTENT_CONSUMED_TWICE';
  exception when sqlstate 'P1205' then null;
  end;
end
$dbig_oauth_consumed_once$;
commit;

select intent.id as intent_id
from remhaos_integration.oauth_intents intent
where intent.state_digest = decode(
  '1111111111111111111111111111111111111111111111111111111111111111',
  'hex'
)
\gset dbig_

begin;
set local role service_role;
select remhaos_integration_api.activate_oauth_connection(
  :'dbig_intent_id'::uuid,
  'vault:integration:google-drive:dbig-1',
  array['https://www.googleapis.com/auth/drive.file'],
  decode('3333333333333333333333333333333333333333333333333333333333333333', 'hex'),
  'Drive Workspace',
  '{"tenant":"dbig","provider_object_key":"private-provider-object-key-connection-1","provider_payload":{"raw":"private"}}'::jsonb,
  statement_timestamp() + interval '1 day',
  'dbig-activate-google-drive'
);
commit;

select connection.id as connection_id
from remhaos_integration.connections connection
where connection.organization_id = :'dbig_org_a'::uuid
  and connection.provider_code = 'google_drive'
\gset dbig_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
set local dbig.org_id = :'dbig_org_a';
do $dbig_owner_registry_ops$
declare
  v_org uuid;
  v_connection_id uuid;
  v_project_connection_id uuid;
  v_first jsonb;
  v_second jsonb;
  v_list jsonb;
begin
  v_org := current_setting('dbig.org_id')::uuid;

  v_list := remhaos_integration_api.list_available_integration_providers();
  if jsonb_array_length(v_list) <> 1
     or v_list #>> '{0,providerCode}' <> 'google_drive'
     or v_list #>> '{0,legalState}' <> 'staging_only'
     or v_list #>> '{0,defaultEnabled}' <> 'false' then
    raise exception 'DBIG_PROVIDER_LIST_INVALID:%', v_list;
  end if;

  v_list := remhaos_integration_api.list_organization_connections(v_org);
  if jsonb_array_length(v_list) <> 1
     or v_list #>> '{0,status}' <> 'connected'
     or v_list #>> '{0,projectsUsing}' <> '0'
     or v_list::text ~* '(credential_ref|credentialRef|vault:|access_token|refresh_token|authorization_code|private-provider-object-key)' then
    raise exception 'DBIG_ORG_CONNECTION_LIST_INVALID:%', v_list;
  end if;
  v_connection_id := (v_list #>> '{0,connectionId}')::uuid;

  v_first := remhaos_integration_api.bind_project_connection(
    '71111111-1111-4111-8111-111111111111',
    v_connection_id,
    array['list_objects'],
    'dbig-bind-owner'
  );
  v_second := remhaos_integration_api.bind_project_connection(
    '71111111-1111-4111-8111-111111111111',
    v_connection_id,
    array['list_objects'],
    'dbig-bind-owner'
  );
  if (v_first ->> 'replay')::boolean is not false
     or (v_second ->> 'replay')::boolean is not true
     or v_first #>> '{result,projectConnectionId}' <>
       v_second #>> '{result,projectConnectionId}' then
    raise exception 'DBIG_BIND_REPLAY_INVALID:%:%', v_first, v_second;
  end if;
  v_project_connection_id := (
    v_first #>> '{result,projectConnectionId}'
  )::uuid;

  begin
    perform remhaos_integration_api.bind_project_connection(
      '71111111-1111-4111-8111-111111111111',
      v_connection_id,
      array['import_object'],
      'dbig-bind-owner'
    );
    raise exception 'DBIG_BIND_IDEMPOTENCY_CONFLICT_MISSING';
  exception when sqlstate 'P1208' then null;
  end;

  v_list := remhaos_integration_api.list_project_connections(
    '71111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_list) <> 1
     or v_list #>> '{0,clientVisibility}' <> 'hidden'
     or not ((v_list #> '{0,allowedCapabilities}') @> '["list_objects"]'::jsonb)
     or v_list::text ~* '(credential_ref|credentialRef|vault:|access_token|refresh_token|authorization_code|private-provider-object-key)' then
    raise exception 'DBIG_PROJECT_CONNECTION_LIST_INVALID:%', v_list;
  end if;

  v_first := remhaos_integration_api.unbind_project_connection(
    v_project_connection_id,
    'owner unbind dbig',
    'dbig-unbind-owner'
  );
  v_second := remhaos_integration_api.unbind_project_connection(
    v_project_connection_id,
    'owner unbind dbig',
    'dbig-unbind-owner'
  );
  if (v_second ->> 'replay')::boolean is not true then
    raise exception 'DBIG_UNBIND_REPLAY_INVALID:%', v_second;
  end if;

  v_first := remhaos_integration_api.bind_project_connection(
    '71111111-1111-4111-8111-111111111111',
    v_connection_id,
    array['list_objects','import_object'],
    'dbig-bind-owner-second'
  );
  if (v_first ->> 'replay')::boolean is not false then
    raise exception 'DBIG_SECOND_BIND_NOT_CREATED:%', v_first;
  end if;
  v_project_connection_id := (
    v_first #>> '{result,projectConnectionId}'
  )::uuid;

  v_list := remhaos_integration_api.list_organization_connections(v_org);
  if v_list #>> '{0,projectsUsing}' <> '1' then
    raise exception 'DBIG_CONNECTION_PROJECT_USAGE_INVALID:%', v_list;
  end if;

end
$dbig_owner_registry_ops$;
commit;

select binding.id as project_connection_id
from remhaos_integration.project_connections binding
where binding.organization_id = :'dbig_org_a'::uuid
  and binding.project_id = '71111111-1111-4111-8111-111111111111'
  and binding.connection_id = :'dbig_connection_id'::uuid
  and binding.unbound_at is null
\gset dbig_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '62222222-2222-4222-8222-222222222222';
set local dbig.project_connection_id = :'dbig_project_connection_id';
do $dbig_architect_denied$
declare
  v_list jsonb;
begin
  v_list := remhaos_integration_api.list_team_project_connections(
    '71111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_list) <> 1
     or v_list #>> '{0,clientVisibility}' <> 'hidden' then
    raise exception 'DBIG_ARCHITECT_TEAM_CONNECTION_PROJECTION_INVALID:%', v_list;
  end if;

  begin
    perform remhaos_integration_api.list_project_connections(
      '71111111-1111-4111-8111-111111111111'
    );
    raise exception 'DBIG_ARCHITECT_LISTED_PROJECT_CONNECTIONS';
  exception when others then
    if sqlstate not in ('P1103', 'P1203') then
      raise;
    end if;
  end;

  begin
    perform remhaos_integration_api.request_manual_integration_sync(
      '71111111-1111-4111-8111-111111111111',
      current_setting('dbig.project_connection_id')::uuid,
      'dbig-architect-manual-sync'
    );
    raise exception 'DBIG_ARCHITECT_REQUESTED_MANUAL_SYNC';
  exception when others then
    if sqlstate not in ('P1103', 'P1203') then
      raise;
    end if;
  end;
end
$dbig_architect_denied$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '63333333-3333-4333-8333-333333333333';
do $dbig_outsider_denied$
begin
  begin
    perform remhaos_integration_api.list_project_connections(
      '71111111-1111-4111-8111-111111111111'
    );
    raise exception 'DBIG_OUTSIDER_LISTED_PROJECT_CONNECTIONS';
  exception when others then
    if sqlstate not in ('P1103', 'P1203') then
      raise;
    end if;
  end;
end
$dbig_outsider_denied$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '64444444-4444-4444-8444-444444444444';
set local dbig.project_connection_id = :'dbig_project_connection_id';
do $dbig_client_connection_projection_denied$
begin
  begin
    perform remhaos_integration_api.list_team_project_connections(
      '71111111-1111-4111-8111-111111111111'
    );
    raise exception 'DBIG_CLIENT_LISTED_PROJECT_CONNECTIONS';
  exception when others then
    if sqlstate not in ('P1103', 'P1203') then
      raise;
    end if;
  end;

  begin
    perform remhaos_integration_api.request_manual_integration_sync(
      '71111111-1111-4111-8111-111111111111',
      current_setting('dbig.project_connection_id')::uuid,
      'dbig-client-manual-sync'
    );
    raise exception 'DBIG_CLIENT_REQUESTED_MANUAL_SYNC';
  exception when others then
    if sqlstate not in ('P1103', 'P1203') then
      raise;
    end if;
  end;
end
$dbig_client_connection_projection_denied$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
do $dbig_private_tables_denied$
begin
  begin
    perform count(*) from remhaos_integration.connections;
    raise exception 'DBIG_AUTHENTICATED_READ_PRIVATE_CONNECTIONS';
  exception when insufficient_privilege then null;
  end;
end
$dbig_private_tables_denied$;
rollback;

begin;
set local role service_role;
set local dbig.org_id = :'dbig_org_a';
set local dbig.connection_id = :'dbig_connection_id';
set local dbig.project_connection_id = :'dbig_project_connection_id';
do $dbig_worker_ops$
declare
  v_org uuid;
  v_connection_id uuid;
  v_project_connection_id uuid;
  v_job_id uuid;
  v_lease_token uuid;
  v_external_object_id uuid;
  v_revision_two_object_id uuid;
  v_first jsonb;
  v_second jsonb;
  v_claimed jsonb;
begin
  v_org := current_setting('dbig.org_id')::uuid;
  v_connection_id := current_setting('dbig.connection_id')::uuid;
  v_project_connection_id :=
    current_setting('dbig.project_connection_id')::uuid;

  v_first := remhaos_integration_api.enqueue_integration_job(
    v_org,
    '71111111-1111-4111-8111-111111111111',
    v_connection_id,
    'sync_import_candidates',
    'dbig-enqueue-job',
    '{"cursor":"page_1"}'::jsonb
  );
  v_second := remhaos_integration_api.enqueue_integration_job(
    v_org,
    '71111111-1111-4111-8111-111111111111',
    v_connection_id,
    'sync_import_candidates',
    'dbig-enqueue-job',
    '{"cursor":"page_1"}'::jsonb
  );
  if (v_first ->> 'replay')::boolean is not false
     or (v_second ->> 'replay')::boolean is not true
     or v_first #>> '{result,jobId}' <> v_second #>> '{result,jobId}' then
    raise exception 'DBIG_ENQUEUE_REPLAY_INVALID:%:%', v_first, v_second;
  end if;
  v_claimed := remhaos_integration_api.claim_integration_jobs(10, 60);
  if jsonb_array_length(v_claimed) <> 1 then
    raise exception 'DBIG_CLAIM_COUNT_INVALID:%', v_claimed;
  end if;

  v_job_id := (v_claimed #>> '{0,jobId}')::uuid;
  v_lease_token := (v_claimed #>> '{0,leaseToken}')::uuid;

  begin
    perform remhaos_integration_api.complete_integration_job(
      v_job_id,
      '99999999-9999-4999-8999-999999999999',
      '{"result":"wrong-lease"}'::jsonb,
      'dbig-complete-wrong-lease'
    );
    raise exception 'DBIG_WRONG_LEASE_COMPLETED';
  exception when sqlstate 'P1208' then null;
  end;

  v_first := remhaos_integration_api.complete_integration_job(
    v_job_id,
    v_lease_token,
    '{"result":"ok"}'::jsonb,
    'dbig-complete-job'
  );
  v_second := remhaos_integration_api.complete_integration_job(
    v_job_id,
    v_lease_token,
    '{"result":"ok"}'::jsonb,
    'dbig-complete-job'
  );
  if (v_first ->> 'replay')::boolean is not false
     or (v_second ->> 'replay')::boolean is not true then
    raise exception 'DBIG_COMPLETE_REPLAY_INVALID:%:%', v_first, v_second;
  end if;

  v_first := remhaos_integration_api.enqueue_integration_job(
    v_org,
    '71111111-1111-4111-8111-111111111111',
    v_connection_id,
    'refresh_connection',
    'dbig-enqueue-retry',
    '{}'::jsonb
  );
  v_claimed := remhaos_integration_api.claim_integration_jobs(10, 60);
  if jsonb_array_length(v_claimed) <> 1 then
    raise exception 'DBIG_RETRY_CLAIM_COUNT_INVALID:%', v_claimed;
  end if;
  v_job_id := (v_claimed #>> '{0,jobId}')::uuid;
  v_lease_token := (v_claimed #>> '{0,leaseToken}')::uuid;

  v_first := remhaos_integration_api.fail_integration_job(
    v_job_id,
    v_lease_token,
    'provider_rate_limited',
    true,
    3,
    86400,
    'dbig-fail-job'
  );
  if v_first #>> '{result,status}' <> 'retryable_failed' then
    raise exception 'DBIG_RETRYABLE_FAILURE_INVALID:%', v_first;
  end if;

  begin
    perform remhaos_integration_api.complete_integration_job(
      v_job_id,
      v_lease_token,
      '{"result":"stale"}'::jsonb,
      'dbig-complete-stale-lease'
    );
    raise exception 'DBIG_STALE_LEASE_COMPLETED';
  exception when sqlstate 'P1208' then null;
  end;

  v_first := remhaos_integration_api.upsert_external_object(
    v_project_connection_id,
    'private-provider-object-key-1',
    decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'),
    'file',
    'Design Package',
    'application/pdf',
    120,
    'rev-1',
    statement_timestamp(),
    '{"source":"dbig"}'::jsonb,
    'dbig-upsert-object'
  );
  v_second := remhaos_integration_api.upsert_external_object(
    v_project_connection_id,
    'private-provider-object-key-1',
    decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'),
    'file',
    'Design Package',
    'application/pdf',
    120,
    'rev-1',
    statement_timestamp(),
    '{"source":"dbig"}'::jsonb,
    'dbig-upsert-object'
  );
  if (v_second ->> 'replay')::boolean is not true then
    raise exception 'DBIG_EXTERNAL_OBJECT_REPLAY_INVALID:%', v_second;
  end if;

  v_external_object_id := (
    v_first #>> '{result,externalObjectId}'
  )::uuid;

  v_first := remhaos_integration_api.create_import_candidate(
    '71111111-1111-4111-8111-111111111111',
    v_external_object_id,
    'file',
    'source',
    'source://dbig/1',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'clean',
    '{"source":"dbig","provider_object_key":"private-provider-object-key-1"}'::jsonb,
    'dbig-create-candidate'
  );
  if v_first #>> '{result,status}' <> 'candidate' then
    raise exception 'DBIG_IMPORT_CANDIDATE_INVALID:%', v_first;
  end if;

  v_first := remhaos_integration_api.upsert_external_object(
    v_project_connection_id,
    'private-provider-object-key-1',
    decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'),
    'file',
    'Design Package',
    'application/pdf',
    120,
    'rev-2',
    statement_timestamp(),
    '{"source":"dbig"}'::jsonb,
    'dbig-upsert-object-rev-2'
  );
  v_revision_two_object_id := (v_first #>> '{result,externalObjectId}')::uuid;
  v_first := remhaos_integration_api.create_import_candidate(
    '71111111-1111-4111-8111-111111111111',
    v_revision_two_object_id,
    'file',
    'source',
    'source://dbig/2',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'clean',
    '{"source":"dbig","exactExternalRevision":"rev-2"}'::jsonb,
    'dbig-create-candidate-rev-2'
  );
  if v_first #>> '{result,status}' <> 'candidate' then
    raise exception 'DBIG_REVISION_SUPERSESSION_INVALID:%', v_first;
  end if;
end
$dbig_worker_ops$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
set local dbig.project_connection_id = :'dbig_project_connection_id';
do $dbig_manual_sync_request$
declare
  v_project_connection_id uuid;
  v_first jsonb;
  v_second jsonb;
begin
  v_project_connection_id := current_setting('dbig.project_connection_id')::uuid;
  v_first := remhaos_integration_api.request_manual_integration_sync(
    '71111111-1111-4111-8111-111111111111',
    v_project_connection_id,
    'dbig-manual-sync'
  );
  v_second := remhaos_integration_api.request_manual_integration_sync(
    '71111111-1111-4111-8111-111111111111',
    v_project_connection_id,
    'dbig-manual-sync'
  );
  if (v_first ->> 'replay')::boolean is not false
     or (v_second ->> 'replay')::boolean is not true
     or v_first #>> '{result,selectionMode}' <> 'explicit_selected_object' then
    raise exception 'DBIG_MANUAL_SYNC_REPLAY_INVALID:%:%', v_first, v_second;
  end if;
end
$dbig_manual_sync_request$;
commit;

begin;
set local role pi_worker_executor;
do $dbig_manual_sync_worker$
declare
  v_claimed jsonb;
  v_job_id uuid;
  v_lease_token uuid;
begin
  v_claimed := remhaos_integration_api.claim_integration_jobs(1, 60);
  if jsonb_array_length(v_claimed) <> 1
     or v_claimed #>> '{0,jobKind}' <> 'manual_selected_object_sync' then
    raise exception 'DBIG_MANUAL_SYNC_JOB_INVALID:%', v_claimed;
  end if;
  v_job_id := (v_claimed #>> '{0,jobId}')::uuid;
  v_lease_token := (v_claimed #>> '{0,leaseToken}')::uuid;
  perform remhaos_integration_api.complete_integration_job(
    v_job_id,
    v_lease_token,
    '{"selectionRequired":true}'::jsonb,
    'dbig-manual-sync-complete'
  );
end
$dbig_manual_sync_worker$;
commit;

do $dbig_revision_supersession_assertion$
begin
  if not exists (
    select 1
    from remhaos_integration.import_candidates candidate
    where candidate.server_sha256 =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and candidate.status = 'superseded'
  ) then
    raise exception 'DBIG_REVISION_SUPERSESSION_NOT_PERSISTED';
  end if;
end
$dbig_revision_supersession_assertion$;

do $dbig_worker_private_assertions$
begin
  if exists (
    select 1
    from remhaos_integration.sync_jobs
    where idempotency_key = 'dbig-enqueue-job'
  ) or not exists (
    select 1
    from remhaos_integration.sync_jobs
    where job_kind = 'sync_import_candidates'
      and idempotency_key ~ '^[a-f0-9]{64}$'
  ) then
    raise exception 'DBIG_JOB_IDEMPOTENCY_KEY_NOT_HASHED';
  end if;
end
$dbig_worker_private_assertions$;

select candidate.id as candidate_id
from remhaos_integration.import_candidates candidate
where candidate.server_sha256 =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
\gset dbig_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
set local dbig.candidate_id = :'dbig_candidate_id';
do $dbig_review_candidate$
declare
  v_candidate_id uuid;
  v_first jsonb;
  v_second jsonb;
  v_list jsonb;
begin
  v_candidate_id := current_setting('dbig.candidate_id')::uuid;

  v_list := remhaos_integration_api.list_import_candidates(
    '71111111-1111-4111-8111-111111111111',
    'candidate'
  );
  if jsonb_array_length(v_list) <> 1
     or v_list::text ~* '(private-provider-object-key|credential_ref|credentialRef|vault:|access_token|refresh_token|authorization_code)' then
    raise exception 'DBIG_IMPORT_CANDIDATE_LIST_INVALID:%', v_list;
  end if;

  v_first := remhaos_integration_api.review_import_candidate(
    v_candidate_id,
    'accepted',
    '{"targetKind":"selection"}'::jsonb,
    'dbig-review-candidate'
  );
  v_second := remhaos_integration_api.review_import_candidate(
    v_candidate_id,
    'accepted',
    '{"targetKind":"selection"}'::jsonb,
    'dbig-review-candidate'
  );
  if (v_first ->> 'replay')::boolean is not false
     or (v_second ->> 'replay')::boolean is not true
     or v_first #>> '{result,targetKind}' <> 'selection' then
    raise exception 'DBIG_REVIEW_REPLAY_INVALID:%:%', v_first, v_second;
  end if;
end
$dbig_review_candidate$;
commit;

do $dbig_append_only_audit$
begin
  begin
    update remhaos_integration.audit_events
    set outcome_code = 'mutated'
    where action = 'project_connection_bound';
    raise exception 'DBIG_AUDIT_EVENT_MUTATED';
  exception when sqlstate '55000' then null;
  end;
end
$dbig_append_only_audit$;

select 'DBIG_REGISTRY_OPERATIONS_OK' as result;
