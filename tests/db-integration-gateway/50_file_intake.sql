\set ON_ERROR_STOP on

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select (
  remhaos_integration_api.create_file_intake(
    '71111111-1111-4111-8111-111111111111',
    'floor-plan.pdf',
    'application/pdf',
    'pdf',
    1024,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'document',
    'dbig-file-create'
  ) -> 'result' ->> 'intakeId'
) as intake_id
\gset dbig_
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
set local dbig.intake_id = :'dbig_intake_id';
do $dbig_file_replay$
declare
  v_result jsonb;
begin
  v_result := remhaos_integration_api.create_file_intake(
    '71111111-1111-4111-8111-111111111111',
    'floor-plan.pdf',
    'application/pdf',
    'pdf',
    1024,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'document',
    'dbig-file-create'
  );
  if v_result ->> 'replay' <> 'true'
     or v_result #>> '{result,intakeId}' <> current_setting('dbig.intake_id') then
    raise exception 'DBIG_FILE_CREATE_REPLAY_INVALID:%', v_result;
  end if;
  begin
    perform remhaos_integration_api.create_file_intake(
      '71111111-1111-4111-8111-111111111111', 'oversized.pdf',
      'application/pdf', 'pdf', 52428801,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'document', 'dbig-file-oversize'
    );
    raise exception 'DBIG_FILE_OVERSIZE_ACCEPTED';
  exception when sqlstate 'P1211' then null;
  end;
end
$dbig_file_replay$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select remhaos_integration_api.mark_file_intake_uploaded(
  '71111111-1111-4111-8111-111111111111',
  :'dbig_intake_id'::uuid,
  'dbig-file-uploaded'
);
commit;

begin;
set local role pi_worker_executor;
select remhaos_integration_api.complete_file_intake_scan(
  '71111111-1111-4111-8111-111111111111',
  :'dbig_intake_id'::uuid,
  'clean',
  'dbig-file-scan-clean'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '64444444-4444-4444-8444-444444444444';
do $dbig_file_client_quarantine$
declare
  v_list jsonb;
begin
  v_list := remhaos_integration_api.list_file_intakes(
    '71111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_list) <> 0 then
    raise exception 'DBIG_FILE_QUARANTINE_VISIBLE:%', v_list;
  end if;
  begin
    perform remhaos_integration_api.create_file_intake(
      '71111111-1111-4111-8111-111111111111', 'client.pdf',
      'application/pdf', 'pdf', 12,
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'document', 'dbig-client-file-create'
    );
    raise exception 'DBIG_CLIENT_FILE_CREATE_ACCEPTED';
  exception when sqlstate 'P1103' then null;
  end;
end
$dbig_file_client_quarantine$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select remhaos_integration_api.review_file_intake(
  '71111111-1111-4111-8111-111111111111',
  :'dbig_intake_id'::uuid,
  'accepted',
  'Clean scan and owner review complete',
  'dbig-file-review'
);
select remhaos_integration_api.get_file_intake_storage(
  '71111111-1111-4111-8111-111111111111',
  :'dbig_intake_id'::uuid
) as storage_auth;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select remhaos_integration_api.publish_file_intake(
  '71111111-1111-4111-8111-111111111111',
  :'dbig_intake_id'::uuid,
  'dbig-file-publish'
);

set local dbig.intake_id = :'dbig_intake_id';
do $dbig_file_publish_replay$
declare
  v_storage jsonb;
  v_publish jsonb;
begin
  v_storage := remhaos_integration_api.get_file_intake_storage(
    '71111111-1111-4111-8111-111111111111',
    current_setting('dbig.intake_id')::uuid
  );
  v_publish := remhaos_integration_api.publish_file_intake(
    '71111111-1111-4111-8111-111111111111',
    current_setting('dbig.intake_id')::uuid,
    'dbig-file-publish'
  );
  if v_storage ->> 'status' <> 'published_internal_copy'
     or v_storage ->> 'objectKey' not like '%/sources/%'
     or v_publish ->> 'replay' <> 'true' then
    raise exception 'DBIG_FILE_PUBLISH_REPLAY_INVALID:%:%', v_storage, v_publish;
  end if;
end
$dbig_file_publish_replay$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '64444444-4444-4444-8444-444444444444';
set local dbig.intake_id = :'dbig_intake_id';
do $dbig_file_client_published$
declare
  v_list jsonb;
  v_download jsonb;
begin
  v_list := remhaos_integration_api.list_file_intakes(
    '71111111-1111-4111-8111-111111111111'
  );
  v_download := remhaos_integration_api.authorize_file_intake_download(
    '71111111-1111-4111-8111-111111111111',
    current_setting('dbig.intake_id')::uuid,
    900
  );
  if jsonb_array_length(v_list) <> 1
     or v_list #>> '{0,status}' <> 'published_internal_copy'
     or v_list #>> '{0,quarantineObjectKey}' is not null
     or v_list #>> '{0,internalObjectKey}' is not null
     or v_download ->> 'sourceId' is null
     or v_download ->> 'objectKey' not like '%/sources/%' then
    raise exception 'DBIG_FILE_CLIENT_PROJECTION_INVALID:%:%', v_list, v_download;
  end if;
end
$dbig_file_client_published$;
commit;

begin;
set local role pi_worker_executor;
select (remhaos_integration_api.create_file_intake_worker(
  '71111111-1111-4111-8111-111111111111',
  'drive-plan.pdf',
  'application/pdf',
  'pdf',
  1024,
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'document',
  'dbig-worker-file-create'
) -> 'result' ->> 'intakeId') as worker_intake_id
\gset dbig_
select remhaos_integration_api.mark_file_intake_uploaded_worker(
  '71111111-1111-4111-8111-111111111111',
  :'dbig_worker_intake_id'::uuid,
  'dbig-worker-file-uploaded'
);
select remhaos_integration_api.complete_file_intake_scan(
  '71111111-1111-4111-8111-111111111111',
  :'dbig_worker_intake_id'::uuid,
  'clean',
  'dbig-worker-file-scan'
);
set local role postgres;
set local dbig.worker_intake_id = :'dbig_worker_intake_id';
do $dbig_worker_audit$
declare
  v_created_by uuid;
  v_system_events integer;
  v_system_commands integer;
begin
  select intake.created_by_user_id into v_created_by
  from remhaos_integration.file_intakes intake
  where intake.project_id = '71111111-1111-4111-8111-111111111111'
    and intake.intake_id = current_setting('dbig.worker_intake_id')::uuid;
  select count(*) into v_system_events
  from remhaos_integration.file_intake_events event
  where event.project_id = '71111111-1111-4111-8111-111111111111'
    and event.intake_id = current_setting('dbig.worker_intake_id')::uuid
    and event.actor_type = 'system'
    and event.actor_id = 'system:google-drive-import-worker';
  select count(*) into v_system_commands
  from remhaos_integration.command_records command
  where command.project_id = '71111111-1111-4111-8111-111111111111'
    and command.operation in ('create_file_intake_worker', 'mark_file_intake_uploaded_worker')
    and command.actor_type = 'system'
    and command.actor_id = 'system:google-drive-import-worker';
  if v_created_by is not null or v_system_events <> 3 or v_system_commands <> 2 then
    raise exception 'DBIG_WORKER_AUDIT_INVALID:%:%:%', v_created_by, v_system_events, v_system_commands;
  end if;
end
$dbig_worker_audit$;
commit;

select 'DBIG_FILE_INTAKE_OK' as result;
