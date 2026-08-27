\set ON_ERROR_STOP on

select workflow.organization_id as org_a
from project_intelligence.project_workflows workflow
where workflow.project_id = '71111111-1111-4111-8111-111111111111'
\gset dbig_

begin;
set local role pi_table_owner;
insert into remhaos_integration.connections (
  organization_id,
  provider_code,
  created_by,
  status,
  credential_ref,
  granted_scopes,
  external_subject_hash,
  display_label
) values (
  :'dbig_org_a'::uuid,
  'google_drive',
  '61111111-1111-4111-8111-111111111111'::uuid,
  'connected',
  'vault:test-disconnect-active',
  array['https://www.googleapis.com/auth/drive.file'],
  decode('abababababababababababababababababababababababababababababababab', 'hex'),
  'Disconnect test connection'
)
returning id as connection_id
\gset dbig_

select binding.id as project_connection_id
from remhaos_integration.project_connections binding
where binding.organization_id = :'dbig_org_a'::uuid
  and binding.project_id = '71111111-1111-4111-8111-111111111111'::uuid
  and binding.unbound_at is null
limit 1
\gset dbig_

set local role service_role;
select remhaos_integration_api.enqueue_integration_job(
  :'dbig_org_a'::uuid,
  '71111111-1111-4111-8111-111111111111'::uuid,
  :'dbig_connection_id'::uuid,
  'selected_object_import',
  'dbig-disconnect-active-job',
  ('{"selectionMode":"explicit_selected_object","selectionRef":"selection:google-drive:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","projectConnectionId":"' || :'dbig_project_connection_id' || '","sourceRole":"document"}')::jsonb
) #>> '{result,jobId}' as job_id
\gset dbig_

set local role pi_worker_executor;
select remhaos_integration_api.claim_selected_google_drive_import_jobs(1, 60) -> 0 ->> 'leaseToken'
  as lease_token
\gset dbig_
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select remhaos_integration_api.disconnect_integration_connection(
  :'dbig_connection_id'::uuid,
  'active job disconnect test',
  'dbig-disconnect-active-connection'
);
commit;

select set_config('dbig.disconnect_job_id', :'dbig_job_id', false);
select set_config('dbig.disconnect_lease_token', :'dbig_lease_token', false);

do $dbig_disconnect_active_job$
declare
  v_status text;
begin
  select status into v_status
  from remhaos_integration.sync_jobs
  where id = current_setting('dbig.disconnect_job_id')::uuid;
  if v_status <> 'cancelled' then
    raise exception 'DBIG_DISCONNECT_JOB_NOT_CANCELLED:%', v_status;
  end if;
  begin
    perform remhaos_integration_api.complete_integration_job(
      current_setting('dbig.disconnect_job_id')::uuid,
      current_setting('dbig.disconnect_lease_token')::uuid,
      '{"result":"stale"}'::jsonb,
      'dbig-disconnect-active-complete'
    );
    raise exception 'DBIG_DISCONNECT_STALE_COMPLETE_ACCEPTED';
  exception when sqlstate 'P1208' then null;
  end;
end
$dbig_disconnect_active_job$;

select 'DBIG_DISCONNECT_ACTIVE_JOB_OK' as result;
