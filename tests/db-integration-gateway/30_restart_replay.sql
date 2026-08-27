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

select candidate.id as candidate_id
from remhaos_integration.import_candidates candidate
where candidate.server_sha256 =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
\gset dbig_

begin;
set local role service_role;
set local dbig.org_id = :'dbig_org_a';
set local dbig.connection_id = :'dbig_connection_id';
do $dbig_restart_worker_replay$
declare
  v_org uuid;
  v_connection_id uuid;
  v_result jsonb;
begin
  v_org := current_setting('dbig.org_id')::uuid;
  v_connection_id := current_setting('dbig.connection_id')::uuid;

  v_result := remhaos_integration_api.enqueue_integration_job(
    v_org,
    '71111111-1111-4111-8111-111111111111',
    v_connection_id,
    'sync_import_candidates',
    'dbig-enqueue-job',
    '{"cursor":"page_1"}'::jsonb
  );
  if (v_result ->> 'replay')::boolean is not true then
    raise exception 'DBIG_RESTART_ENQUEUE_REPLAY_FALSE:%', v_result;
  end if;

end
$dbig_restart_worker_replay$;
commit;

begin;
set local role pi_worker_executor;
set local dbig.org_id = :'dbig_org_a';
set local dbig.connection_id = :'dbig_connection_id';
do $dbig_reauth_transition$
declare
  v_org uuid;
  v_connection_id uuid;
  v_result jsonb;
begin
  v_org := current_setting('dbig.org_id')::uuid;
  v_connection_id := current_setting('dbig.connection_id')::uuid;

  v_result := remhaos_integration_api.create_google_drive_webhook_channel(
    v_org,
    v_connection_id,
    decode('8888888888888888888888888888888888888888888888888888888888888888', 'hex'),
    decode('9999999999999999999999999999999999999999999999999999999999999999', 'hex'),
    statement_timestamp() + interval '1 day',
    'dbig-re-auth-channel'
  );
  v_result := remhaos_integration_api.mark_google_drive_reauth_required(
    v_org,
    v_connection_id,
    'invalid_grant',
    'dbig-mark-reauth-required'
  );
  if v_result #>> '{result,status}' <> 'reauth_required' then
    raise exception 'DBIG_REAUTH_TRANSITION_INVALID:%', v_result;
  end if;

  begin
    perform remhaos_integration_api.enqueue_integration_job(
      v_org,
      '71111111-1111-4111-8111-111111111111',
      v_connection_id,
      'post_reauth_retry',
      'dbig-post-reauth-retry',
      '{}'::jsonb
    );
    raise exception 'DBIG_REAUTH_RETRY_ACCEPTED';
  exception when sqlstate 'P1205' then null;
  end;

  begin
    perform remhaos_integration_api.resolve_google_drive_webhook_channel(
      decode('8888888888888888888888888888888888888888888888888888888888888888', 'hex'),
      decode('9999999999999999999999999999999999999999999999999999999999999999', 'hex')
    );
    raise exception 'DBIG_REAUTH_CHANNEL_REMAINED_ACTIVE';
  exception when sqlstate 'P1204' then null;
  end;
end
$dbig_reauth_transition$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
set local dbig.connection_id = :'dbig_connection_id';
set local dbig.candidate_id = :'dbig_candidate_id';
do $dbig_restart_human_replay$
declare
  v_connection_id uuid;
  v_candidate_id uuid;
  v_result jsonb;
begin
  v_connection_id := current_setting('dbig.connection_id')::uuid;

  v_result := remhaos_integration_api.bind_project_connection(
    '71111111-1111-4111-8111-111111111111',
    v_connection_id,
    array['list_objects','import_object'],
    'dbig-bind-owner-second'
  );
  if (v_result ->> 'replay')::boolean is not true then
    raise exception 'DBIG_RESTART_BIND_REPLAY_FALSE:%', v_result;
  end if;

  v_candidate_id := current_setting('dbig.candidate_id')::uuid;

  v_result := remhaos_integration_api.review_import_candidate(
    v_candidate_id,
    'accepted',
    '{"targetKind":"selection"}'::jsonb,
    'dbig-review-candidate'
  );
  if (v_result ->> 'replay')::boolean is not true then
    raise exception 'DBIG_RESTART_REVIEW_REPLAY_FALSE:%', v_result;
  end if;
end
$dbig_restart_human_replay$;
commit;

do $dbig_restart_counts$
begin
  if (
    select count(*)
    from remhaos_integration.sync_jobs
    where job_kind = 'sync_import_candidates'
  ) <> 1 then
    raise exception 'DBIG_RESTART_DUPLICATE_SYNC_JOB';
  end if;
  if (
    select count(*)
    from remhaos_integration.import_candidates
    where server_sha256 =
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      and status = 'accepted'
  ) <> 1 then
    raise exception 'DBIG_RESTART_DUPLICATE_REVIEW';
  end if;
end
$dbig_restart_counts$;

select 'DBIG_RESTART_REPLAY_OK' as result;
