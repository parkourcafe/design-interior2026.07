\set ON_ERROR_STOP on

select workflow.organization_id as org_a
from project_intelligence.project_workflows workflow
where workflow.project_id = '71111111-1111-4111-8111-111111111111'
\gset dbig_

select connection.id as connection_id
from remhaos_integration.connections connection
where connection.organization_id = :'dbig_org_a'::uuid
  and connection.provider_code = 'google_drive'
\gset dbig_

select set_config(
  'dbig.google_expires_at',
  (statement_timestamp() + interval '5 minutes')::text,
  false
);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select (
  remhaos_integration_api.create_oauth_intent(
    :'dbig_org_a'::uuid,
    'google_drive',
    decode('68bff29bf96576d4a288afc9cc7b55fdf8884d8647ef00caa7bf06d9bef1007e', 'hex'),
    'vault:google-drive:pkce:dbig-1',
    decode('4ba12f470ac8e3a628f1e6a3ae6d2fd529b93165a87128fdd20fbf3dd9f4507f', 'hex'),
    array['https://www.googleapis.com/auth/drive.file', 'openid'],
    current_setting('dbig.google_expires_at')::timestamptz,
    'dbig-google-intent-1'
  ) #>> '{result,intentId}'
) as google_intent_id
\gset dbig_
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
set local dbig.org_a = :'dbig_org_a';
set local dbig.google_intent_id = :'dbig_google_intent_id';
do $dbig_google_intent_replay$
declare
  v_result jsonb;
begin
  v_result := remhaos_integration_api.create_oauth_intent(
    current_setting('dbig.org_a')::uuid,
    'google_drive',
    decode('68bff29bf96576d4a288afc9cc7b55fdf8884d8647ef00caa7bf06d9bef1007e', 'hex'),
    'vault:google-drive:pkce:dbig-1',
    decode('4ba12f470ac8e3a628f1e6a3ae6d2fd529b93165a87128fdd20fbf3dd9f4507f', 'hex'),
    array['https://www.googleapis.com/auth/drive.file', 'openid'],
    current_setting('dbig.google_expires_at')::timestamptz,
    'dbig-google-intent-1'
  );
  if v_result ->> 'replay' <> 'true'
     or v_result #>> '{result,intentId}' <> current_setting('dbig.google_intent_id') then
    raise exception 'DBIG_GOOGLE_INTENT_REPLAY_INVALID:%', v_result;
  end if;
end
$dbig_google_intent_replay$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
set local dbig.org_a = :'dbig_org_a';
do $dbig_google_full_scope_denied$
begin
  begin
    perform remhaos_integration_api.create_oauth_intent(
      current_setting('dbig.org_a')::uuid,
      'google_drive',
      decode('206dedd9922f5bfd6e6bf78e3ce23d2a1be3a018d9c28e1e59499062718dbbe5', 'hex'),
      'vault:google-drive:pkce:dbig-2',
      decode('4ba12f470ac8e3a628f1e6a3ae6d2fd529b93165a87128fdd20fbf3dd9f4507f', 'hex'),
      array['https://www.googleapis.com/auth/drive'],
      current_setting('dbig.google_expires_at')::timestamptz,
      'dbig-google-intent-2'
    );
    raise exception 'DBIG_GOOGLE_FULL_SCOPE_ACCEPTED';
  exception when sqlstate 'P1211' then null;
  end;
end
$dbig_google_full_scope_denied$;
commit;

begin;
set local role pi_worker_executor;
select (
  remhaos_integration_api.create_google_drive_webhook_channel(
    :'dbig_org_a'::uuid,
    :'dbig_connection_id'::uuid,
    decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'),
    decode('5555555555555555555555555555555555555555555555555555555555555555', 'hex'),
    statement_timestamp() + interval '1 day',
    'dbig-google-channel-create-1'
  ) #>> '{result,channelId}'
) as google_channel_id
\gset dbig_
commit;

begin;
set local role pi_worker_executor;
select set_config('dbig.google_org_id', :'dbig_org_a', true);
select set_config('dbig.google_connection_id', :'dbig_connection_id', true);
select set_config('dbig.google_channel_id', :'dbig_google_channel_id', true);
do $dbig_google_channel_resolve$
declare
  v_channel jsonb;
begin
  v_channel := remhaos_integration_api.resolve_google_drive_webhook_channel(
    decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'),
    decode('5555555555555555555555555555555555555555555555555555555555555555', 'hex')
  );
  if v_channel ->> 'organizationId' <> current_setting('dbig.google_org_id')
     or v_channel ->> 'connectionId' <> current_setting('dbig.google_connection_id')
     or v_channel ->> 'channelId' <> current_setting('dbig.google_channel_id', true) then
    raise exception 'DBIG_GOOGLE_CHANNEL_RESOLUTION_INVALID:%', v_channel;
  end if;
end
$dbig_google_channel_resolve$;
commit;

begin;
set local role pi_worker_executor;
select set_config('dbig.google_org_id', :'dbig_org_a', true);
select set_config('dbig.google_connection_id', :'dbig_connection_id', true);
select set_config('dbig.google_channel_id', :'dbig_google_channel_id', true);
do $dbig_google_notification_dedupe$
declare
  v_first jsonb;
  v_second jsonb;
begin
  v_first := remhaos_integration_api.record_google_drive_notification(
    current_setting('dbig.google_org_id')::uuid,
    current_setting('dbig.google_connection_id')::uuid,
    current_setting('dbig.google_channel_id')::uuid,
    decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'),
    decode('5555555555555555555555555555555555555555555555555555555555555555', 'hex'),
    decode('6666666666666666666666666666666666666666666666666666666666666666', 'hex'),
    decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'),
    'dbig-google-notification-1'
  );
  if v_first #>> '{result,status}' <> 'enqueued'
     or v_first #>> '{result,jobsEnqueued}' <> '1' then
    raise exception 'DBIG_GOOGLE_NOTIFICATION_ENQUEUE_INVALID:%', v_first;
  end if;

  v_second := remhaos_integration_api.record_google_drive_notification(
    current_setting('dbig.google_org_id')::uuid,
    current_setting('dbig.google_connection_id')::uuid,
    current_setting('dbig.google_channel_id')::uuid,
    decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'),
    decode('5555555555555555555555555555555555555555555555555555555555555555', 'hex'),
    decode('6666666666666666666666666666666666666666666666666666666666666666', 'hex'),
    decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'),
    'dbig-google-notification-2'
  );
  if v_second #>> '{result,status}' <> 'duplicate'
     or v_second #>> '{result,jobsEnqueued}' <> '0' then
    raise exception 'DBIG_GOOGLE_NOTIFICATION_DUPLICATE_INVALID:%', v_second;
  end if;
end
$dbig_google_notification_dedupe$;
select remhaos_integration_api.stop_google_drive_webhook_channel(
  current_setting('dbig.google_org_id')::uuid,
  current_setting('dbig.google_connection_id')::uuid,
  current_setting('dbig.google_channel_id')::uuid,
  'staging channel complete',
  'dbig-google-channel-stop-1'
);
commit;

select 'DBIG_GOOGLE_DRIVE_STAGING_OK' as result;
