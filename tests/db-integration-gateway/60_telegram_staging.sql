\set ON_ERROR_STOP on

select workflow.organization_id as org_a
from project_intelligence.project_workflows workflow
where workflow.project_id = '71111111-1111-4111-8111-111111111111'
\gset dbig_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select (
  remhaos_integration_api.bind_telegram_chat(
    '71111111-1111-4111-8111-111111111111',
    987654321,
    'Kora staging chat',
    'dbig-telegram-bind'
  ) #>> '{result,bindingId}'
) as old_binding_id
\gset dbig_
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
do $dbig_telegram_binding_projection$
declare
  v_list jsonb;
begin
  v_list := remhaos_integration_api.list_telegram_bindings(
    '71111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_list) <> 1
     or v_list #>> '{0,label}' <> 'Kora staging chat'
     or v_list #>> '{0,status}' <> 'active'
     or v_list::text like '%987654321%' then
    raise exception 'DBIG_TELEGRAM_BINDING_PROJECTION_INVALID:%', v_list;
  end if;
end
$dbig_telegram_binding_projection$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select (
  remhaos_integration_api.migrate_telegram_chat(
    '71111111-1111-4111-8111-111111111111',
    :'dbig_old_binding_id'::uuid,
    987654322,
    'Provider chat migration for staging',
    'dbig-telegram-migrate'
  ) #>> '{result,replacementBindingId}'
) as new_binding_id
\gset dbig_
commit;

begin;
set local role pi_worker_executor;
do $dbig_telegram_old_chat_denied$
begin
  begin
    perform remhaos_integration_api.ingest_telegram_update(
      '71111111-1111-4111-8111-111111111111',
      9001,
      987654321,
      41,
      42,
      encode(project_intelligence._sha256_text('telegram-payload-9001'), 'hex'),
      encode(project_intelligence._sha256_text('private bridge message'), 'hex'),
      '[]'::jsonb,
      'dbig-telegram-old-chat'
    );
    raise exception 'DBIG_TELEGRAM_MIGRATED_CHAT_ACCEPTED';
  exception when sqlstate 'P1203' then null;
  end;
end
$dbig_telegram_old_chat_denied$;
rollback;

begin;
set local role pi_worker_executor;
set local dbig.org_a = :'dbig_org_a';
do $dbig_telegram_noncanonical_key_denied$
begin
  begin
    perform remhaos_integration_api.ingest_telegram_update(
      '71111111-1111-4111-8111-111111111111',
      9004,
      987654322,
      44,
      45,
      encode(project_intelligence._sha256_text('telegram-payload-9004'), 'hex'),
      null,
      jsonb_build_array(jsonb_build_object(
        'fileIdDigest', encode(project_intelligence._sha256_text('provider-file-9004'), 'hex'),
        'checksumHex', encode(project_intelligence._sha256_text('file-bytes-9004'), 'hex'),
        'quarantineObjectKey', 'project-intelligence/ru/' || current_setting('dbig.org_a') || '/71111111-1111-4111-8111-111111111111/quarantine/telegram/not-canonical/document',
        'sourceRole', 'document',
        'displayName', 'plan.pdf',
        'mediaType', 'application/pdf',
        'sizeBytes', 1024
      )),
      'dbig-telegram-noncanonical-key'
    );
    raise exception 'DBIG_TELEGRAM_NONCANONICAL_KEY_ACCEPTED';
  exception when sqlstate 'P1211' then null;
  end;
end
$dbig_telegram_noncanonical_key_denied$;
rollback;

begin;
set local role pi_worker_executor;
set local dbig.org_a = :'dbig_org_a';
select (
  remhaos_integration_api.ingest_telegram_update(
    '71111111-1111-4111-8111-111111111111',
    9002,
    987654322,
    42,
    43,
    encode(project_intelligence._sha256_text('telegram-payload-9002'), 'hex'),
    encode(project_intelligence._sha256_text('private bridge message'), 'hex'),
    jsonb_build_array(jsonb_build_object(
      'fileIdDigest', encode(project_intelligence._sha256_text('provider-file-9002'), 'hex'),
      'checksumHex', encode(project_intelligence._sha256_text('file-bytes-9002'), 'hex'),
      'quarantineObjectKey', 'project-intelligence/ru/' || current_setting('dbig.org_a') || '/71111111-1111-4111-8111-111111111111/quarantine/telegram/' || encode(project_intelligence._sha256_text('file-bytes-9002'), 'hex') || '/document',
      'sourceRole', 'document',
      'displayName', 'plan.pdf',
      'mediaType', 'application/pdf',
      'sizeBytes', 1024
    )),
    'dbig-telegram-ingest-9002'
  ) #>> '{result,jobId}'
) as telegram_job_id
\gset dbig_
commit;

begin;
set local role pi_worker_executor;
select jsonb_array_length(claimed.result) as claimed_count,
       set_config('dbig.telegram_job_id', claimed.result -> 0 ->> 'jobId', false) as job_id_set,
       set_config('dbig.telegram_lease_token', claimed.result -> 0 ->> 'leaseToken', false) as lease_token_set
from (
  select remhaos_integration_api.claim_telegram_ingestion_jobs(1, 300) as result
) claimed;
commit;

begin;
set local role pi_worker_executor;
do $dbig_telegram_stale_lease$
begin
  begin
    perform remhaos_integration_api.complete_telegram_ingestion_job(
      current_setting('dbig.telegram_job_id')::uuid,
      extensions.gen_random_uuid(),
      '{}'::jsonb,
      'dbig-telegram-stale-lease'
    );
    raise exception 'DBIG_TELEGRAM_STALE_LEASE_ACCEPTED';
  exception when sqlstate 'P1208' then null;
  end;
end
$dbig_telegram_stale_lease$;
select remhaos_integration_api.complete_telegram_ingestion_job(
  current_setting('dbig.telegram_job_id')::uuid,
  current_setting('dbig.telegram_lease_token')::uuid,
  '{"candidateCount":2}'::jsonb,
  'dbig-telegram-complete-9002'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
do $dbig_telegram_team_projection$
declare
  v_list jsonb;
  v_candidate_id uuid;
  v_review jsonb;
begin
  v_list := remhaos_integration_api.list_telegram_candidates(
    '71111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_list) <> 2
     or v_list::text like '%987654322%'
     or v_list::text like '%private bridge message%'
     or v_list::text like '%provider-file-9002%' then
    raise exception 'DBIG_TELEGRAM_TEAM_PROJECTION_INVALID:%', v_list;
  end if;
  v_candidate_id := (v_list -> 0 ->> 'candidateId')::uuid;
  v_review := remhaos_integration_api.review_telegram_candidate(
    '71111111-1111-4111-8111-111111111111',
    v_candidate_id,
    'accepted',
    'Accepted as a candidate for manual source review',
    'dbig-telegram-review-1'
  );
  if v_review #>> '{result,officialArtifactMutated}' <> 'false' then
    raise exception 'DBIG_TELEGRAM_OFFICIAL_ARTIFACT_MUTATED:%', v_review;
  end if;
end
$dbig_telegram_team_projection$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '64444444-4444-4444-8444-444444444444';
do $dbig_telegram_client_projection$
declare
  v_list jsonb;
begin
  v_list := remhaos_integration_api.list_telegram_candidates(
    '71111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_list) <> 0 then
    raise exception 'DBIG_TELEGRAM_CLIENT_CANDIDATE_VISIBLE:%', v_list;
  end if;
end
$dbig_telegram_client_projection$;
commit;

select 'DBIG_TELEGRAM_STAGING_OK' as result;
