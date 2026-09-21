\set ON_ERROR_STOP on
\if :{?r1_validation_restart_check}
begin;
do $validation_restart_check$
declare c r1_validation_fixture.context%rowtype; expected jsonb; got jsonb; before_counts jsonb; after_counts jsonb;
begin
 select * into strict c from r1_validation_fixture.context;
 if c.ledger_before is distinct from (select to_jsonb(q) from remhaos_integration.external_upload_quota_ledgers q where organization_id=c.organization_id and project_id=c.project_id) then raise exception 'VALIDATION_RESTART_RESERVATION_NOT_HELD'; end if;
 if not exists(select 1 from remhaos_integration.external_validation_jobs where organization_id=c.organization_id and project_id=c.project_id and job_id=c.job_id and state='succeeded' and attempt=1 and fence=1 and lease_digest=project_intelligence._sha256_text(c.lease_secret)) then raise exception 'VALIDATION_RESTART_JOB_IDENTITY'; end if;
 select logical_result into strict expected from remhaos_integration.command_records where organization_id=c.organization_id and project_id=c.project_id and operation='complete_external_validation_job' and key_digest=project_intelligence._sha256_text('b-overlap-complete');
 select jsonb_build_object('commands',(select count(*) from remhaos_integration.command_records),'attempts',(select count(*) from remhaos_integration.external_validation_attempts),'receipts',(select count(*) from remhaos_integration.external_validation_receipts),'canonical',(select count(*) from remhaos_integration.external_canonical_object_receipts),'completions',(select count(*) from remhaos_integration.external_validation_completions)) into before_counts;
 got:=remhaos_integration._complete_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,c.job_id,1,1,c.lease_secret,c.validation_receipt_id,c.canonical_receipt_id,'b-overlap-complete');
 if got->>'replay' is distinct from 'true' or got->'result' is distinct from expected then raise exception 'VALIDATION_RESTART_TERMINAL_REPLAY'; end if;
 begin
  perform remhaos_integration._complete_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,c.job_id,1,1,c.lease_secret,c.validation_receipt_id,extensions.gen_random_uuid(),'b-overlap-complete');
  raise exception 'VALIDATION_RESTART_CHANGED_RECEIPT_REPLAY';
 exception when sqlstate 'P1208' then null; end;
 select jsonb_build_object('commands',(select count(*) from remhaos_integration.command_records),'attempts',(select count(*) from remhaos_integration.external_validation_attempts),'receipts',(select count(*) from remhaos_integration.external_validation_receipts),'canonical',(select count(*) from remhaos_integration.external_canonical_object_receipts),'completions',(select count(*) from remhaos_integration.external_validation_completions)) into after_counts;
 if before_counts<>after_counts or c.ledger_before is distinct from (select to_jsonb(q) from remhaos_integration.external_upload_quota_ledgers q where organization_id=c.organization_id and project_id=c.project_id) then raise exception 'VALIDATION_RESTART_DUPLICATED_EFFECT'; end if;
 if exists(select 1 from remhaos_integration.command_records where logical_result::text like '%'||c.lease_secret||'%' or logical_result::text like '%'||c.principal_secret||'%') then raise exception 'VALIDATION_RESTART_SECRET_LEAK'; end if;
end $validation_restart_check$;
commit;
select 'R1_VALIDATION_TERMINAL_REPLAY_CHECK_OK' as result;
\else
begin;
do $validation$
declare
 org uuid; project uuid:='41111111-1111-4111-8111-111111111111';
 principal uuid:=extensions.gen_random_uuid(); host uuid:=extensions.gen_random_uuid();
 principal_secret text:=encode(extensions.gen_random_bytes(32),'hex'); lease_secret text:=encode(extensions.gen_random_bytes(32),'hex'); lease_two text:=encode(extensions.gen_random_bytes(32),'hex'); lease_three text:=encode(extensions.gen_random_bytes(32),'hex');
 g remhaos_integration.external_upload_generations%rowtype; s remhaos_integration.external_upload_sessions%rowtype; b remhaos_integration.external_upload_policy_bindings%rowtype;
 seal remhaos_integration.external_upload_seal_receipts%rowtype; j remhaos_integration.external_validation_jobs%rowtype;
 job uuid; receipt uuid:=extensions.gen_random_uuid(); canonical uuid:=extensions.gen_random_uuid(); result jsonb; replay jsonb; reserve_before jsonb; source_bytes text; measured_sha bytea; expires timestamptz; org_b uuid; binding_b uuid:=extensions.gen_random_uuid(); session_b uuid; intake_b uuid; claim_b uuid:=extensions.gen_random_uuid(); seal_b uuid:=extensions.gen_random_uuid(); generation_b uuid:=extensions.gen_random_uuid(); host_b uuid:=extensions.gen_random_uuid(); principal_b uuid:=extensions.gen_random_uuid(); principal_secret_b text:=encode(extensions.gen_random_bytes(32),'hex'); job_b uuid; other jsonb; detail text;
begin
 select organization_id into strict org from project_intelligence.project_workflows where project_id=project;
 select * into strict g from remhaos_integration.external_upload_generations where organization_id=org and project_id=project;
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=org and project_id=project and session_id=g.session_id;
 select * into strict b from remhaos_integration.external_upload_policy_bindings where organization_id=org and project_id=project and policy_binding_id=s.policy_binding_id;
 select * into strict seal from remhaos_integration.external_upload_seal_receipts where organization_id=org and project_id=project and receipt_id=g.seal_receipt_id;
 -- Synthetic broker credentials/config only. Digests below are computed from
 -- explicit synthetic bytes, not invented expected checksums or real AV proof.
 insert into remhaos_integration.external_validation_hosts values(host,1,'synthetic:host-authority',project_intelligence._sha256_text('synthetic host evidence'),clock_timestamp()+interval '1 hour');
 insert into remhaos_integration.external_validation_principals values(principal,host,'system:synthetic-validation-'||principal,project_intelligence._sha256_text(principal_secret),2,'synthetic:broker-authentication',project_intelligence._sha256_text('synthetic broker evidence'),clock_timestamp()+interval '1 hour');
 insert into remhaos_integration.external_validation_principal_heads(principal_id,active) values(principal,true);
 insert into remhaos_integration.external_validation_principal_scopes values(principal,org,project,project,b.policy_binding_id,'synthetic:processing-scope',project_intelligence._sha256_text('synthetic scope evidence'),clock_timestamp()+interval '1 hour');
 job:=remhaos_integration._enqueue_external_validation_job(org,project,project,g.generation_id);
 if job<>remhaos_integration._enqueue_external_validation_job(org,project,project,g.generation_id) then raise exception 'VALIDATION_ENQUEUE_DUPLICATED'; end if;
 begin
  perform remhaos_integration._claim_external_validation_job(principal,repeat('wrong',10),org,project,project,'legacy-pdf-intake-v1',lease_secret,'b-claim');
  raise exception 'VALIDATION_FORGED_PRINCIPAL';
 exception when sqlstate 'P1103' then null; end;
 begin
  perform remhaos_integration._claim_external_validation_job(principal,principal_secret,org,project,'49999999-9999-4999-8999-999999999999','legacy-pdf-intake-v1',lease_secret,'b-claim-sibling');
  raise exception 'VALIDATION_SIBLING_SCOPE';
 exception when sqlstate 'P1103' then null; end;
 result:=remhaos_integration._claim_external_validation_job(principal,principal_secret,org,project,project,'legacy-pdf-intake-v1',lease_secret,'b-claim');
 replay:=remhaos_integration._claim_external_validation_job(principal,principal_secret,org,project,project,'legacy-pdf-intake-v1',lease_secret,'b-claim');
 if replay->>'replay' is distinct from 'true' or replay->'result' is distinct from result->'result' or result::text like '%'||lease_secret||'%' then raise exception 'VALIDATION_CLAIM_REPLAY_OR_SECRET'; end if;
 begin
  perform remhaos_integration._claim_external_validation_job(principal,principal_secret,org,project,project,'legacy-pdf-intake-v1',lease_two,'b-claim');
  raise exception 'VALIDATION_SECRET_ROTATED_ON_REPLAY';
 exception when sqlstate 'P1208' then null; end;
 begin
  perform remhaos_integration._claim_external_validation_job(principal,principal_secret,org,project,project,'legacy-pdf-intake-v1',lease_two,'b-project-busy');
  raise exception 'VALIDATION_PROJECT_SLOT_OVERRUN';
 exception when sqlstate 'P1107' then null; end;
 begin
  perform remhaos_integration._heartbeat_external_validation_job(principal,principal_secret,org,project,project,job,1,2,lease_secret);
  raise exception 'VALIDATION_WRONG_FENCE_HEARTBEAT';
 exception when sqlstate 'P1107' then null; end;
 expires:=remhaos_integration._heartbeat_external_validation_job(principal,principal_secret,org,project,project,job,1,1,lease_secret);
 select * into strict j from remhaos_integration.external_validation_jobs where organization_id=org and project_id=project and job_id=job;
 if expires>j.walltime_deadline or j.walltime_deadline<>j.attempt_started_at+interval '300 seconds' or expires>clock_timestamp()+interval '60 seconds' then raise exception 'VALIDATION_HEARTBEAT_UNBOUNDED'; end if;
 -- Two eligible projects distinguish host-wide capacity from per-worker limit.
 -- All added project-B fixture facts are rolled back before the receipt branch.
 begin
  select organization_id into strict org_b from project_intelligence.project_workflows where project_id='42222222-2222-4222-8222-222222222222';
  insert into remhaos_integration.external_upload_policy_bindings
  select (jsonb_populate_record(null::remhaos_integration.external_upload_policy_bindings,to_jsonb(b)||jsonb_build_object('organization_id',org_b,'project_id','42222222-2222-4222-8222-222222222222','policy_binding_id',binding_b))).*;
  insert into remhaos_integration.external_upload_policy_heads(organization_id,project_id,policy_binding_id,write_eligible,processing_eligible,read_eligible) values(org_b,'42222222-2222-4222-8222-222222222222',binding_b,true,true,true);
  insert into remhaos_integration.external_upload_quota_ledgers(organization_id,project_id) values(org_b,'42222222-2222-4222-8222-222222222222');
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  other:=remhaos_integration._begin_external_upload('42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222','pdf',100,null,'b-other-upload');
  session_b:=(other#>>'{result,sessionId}')::uuid; intake_b:=(other#>>'{result,intakeId}')::uuid;
  update remhaos_integration.external_upload_sessions set state='finalizing',revision=revision+1 where session_id=session_b;
  insert into remhaos_integration.external_upload_finalize_claims(organization_id,project_id,package_id,claim_id,session_id,session_revision,part_manifest_digest,attempt,fence,principal_binding_reference,token_digest,expires_at,recovery_deadline)
  values(org_b,'42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222',claim_b,session_b,1,project_intelligence._sha256_text('synthetic other parts'),1,1,'synthetic:broker',project_intelligence._sha256_text('synthetic other finalize token'),clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '60 seconds');
  insert into remhaos_integration.external_upload_seal_receipts(organization_id,project_id,package_id,receipt_id,session_id,claim_id,fence,policy_binding_id,adapter_id,storage_policy_version,pin_mode,private_locator,immutable_provider_version,observed_byte_length,object_identity_digest,sealing_evidence_digest,source_claim_digest,closure_evidence_digest)
  values(org_b,'42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222',seal_b,session_b,claim_b,1,binding_b,b.adapter_id,b.storage_policy_version,'provider_version','private/synthetic-other','synthetic-version',100,project_intelligence._sha256_text('synthetic other object'),project_intelligence._sha256_text('synthetic other seal'),project_intelligence._sha256_text('synthetic other claim'),project_intelligence._sha256_text('synthetic other closure'));
  insert into remhaos_integration.external_upload_generations values(org_b,'42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222',generation_b,session_b,intake_b,seal_b,100,'pdf','33333333-3333-4333-8333-333333333333',clock_timestamp());
  update remhaos_integration.external_upload_sessions set state='finalized',revision=revision+1 where session_id=session_b;
  update remhaos_integration.external_upload_finalize_claims set state='consumed' where claim_id=claim_b;
  update remhaos_integration.external_upload_reservations set state='committed',revision=revision+1 where session_id=session_b;
  insert into remhaos_integration.external_upload_outbox(organization_id,project_id,package_id,operation_id,session_id,generation_id,kind,target_fence) values(org_b,'42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222',extensions.gen_random_uuid(),session_b,generation_b,'enqueue_validation',1);
  job_b:=remhaos_integration._enqueue_external_validation_job(org_b,'42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222',generation_b);
  insert into remhaos_integration.external_validation_principal_scopes values(principal,org_b,'42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222',binding_b,'synthetic:second-scope',project_intelligence._sha256_text('synthetic second scope'),clock_timestamp()+interval '1 hour');
  begin
   perform remhaos_integration._claim_external_validation_job(principal,principal_secret,org_b,'42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222','legacy-pdf-intake-v1',lease_two,'b-host-cap');
   raise exception 'VALIDATION_HOST_CAP_OVERRUN';
  exception when sqlstate 'P1107' then get stacked diagnostics detail=pg_exception_detail; if detail::jsonb->>'reason'<>'validation_worker_slot_busy' then raise; end if; end;
  insert into remhaos_integration.external_validation_hosts values(host_b,2,'synthetic:second-host',project_intelligence._sha256_text('synthetic second host'),clock_timestamp()+interval '1 hour');
  insert into remhaos_integration.external_validation_principals values(principal_b,host_b,'system:synthetic-second-'||principal_b,project_intelligence._sha256_text(principal_secret_b),1,'synthetic:second-principal',project_intelligence._sha256_text('synthetic second auth'),clock_timestamp()+interval '1 hour');
  insert into remhaos_integration.external_validation_principal_heads(principal_id,active) values(principal_b,true);
  insert into remhaos_integration.external_validation_principal_scopes values(principal_b,org_b,'42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222',binding_b,'synthetic:second-worker-scope',project_intelligence._sha256_text('synthetic second worker scope'),clock_timestamp()+interval '1 hour'),(principal_b,org,project,project,b.policy_binding_id,'synthetic:first-worker-scope',project_intelligence._sha256_text('synthetic first worker scope'),clock_timestamp()+interval '1 hour');
  perform remhaos_integration._claim_external_validation_job(principal_b,principal_secret_b,org_b,'42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222','legacy-pdf-intake-v1',lease_two,'b-second-worker');
  begin
   perform remhaos_integration._heartbeat_external_validation_job(principal_b,principal_secret_b,org,project,project,job,1,1,lease_secret);
   raise exception 'VALIDATION_WRONG_WORKER_ACCEPTED';
  exception when sqlstate 'P1107' then null; end;
  perform remhaos_integration._fail_external_validation_job(principal,principal_secret,org,project,project,job,1,1,lease_secret,null,'transient_io','b-make-first-project-eligible');
  begin
   perform remhaos_integration._claim_external_validation_job(principal_b,principal_secret_b,org,project,project,'legacy-pdf-intake-v1',lease_three,'b-worker-cap');
   raise exception 'VALIDATION_WORKER_CAP_OVERRUN';
  exception when sqlstate 'P1107' then get stacked diagnostics detail=pg_exception_detail; if detail::jsonb->>'reason'<>'validation_worker_slot_busy' then raise; end if; end;
  set constraints all immediate;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 source_bytes:=repeat('x',g.observed_byte_length::integer); measured_sha:=project_intelligence._sha256_text(source_bytes);
 select to_jsonb(r) into strict reserve_before from remhaos_integration.external_upload_reservations r where organization_id=org and project_id=project and reservation_id=s.reservation_id;
 -- Success branch is rolled back so the same live attempt can then test real
 -- expiry/reclaim. No human is impersonated when the original uploader leaves.
 begin
  update project_intelligence.organization_members set status='inactive' where organization_id=org and user_id=s.created_by_user_id;
  insert into remhaos_integration.external_validation_receipts(organization_id,project_id,package_id,receipt_id,job_id,generation_id,attempt,fence,object_identity_digest,outcome,source_sha256,byte_length,validated_format,validation_profile,policy_binding_id,structure_policy_version,structure_result,av_outcome,scanner_adapter_version,engine_version,executable_sha256,signature_version,signature_bundle_sha256,signature_policy_version,scan_started_at,scan_completed_at,sandbox_attestation_reference,sandbox_evidence_digest,completion_request_id,scanner_policy_version,sandbox_policy_version)
  values(org,project,project,receipt,job,g.generation_id,1,1,seal.object_identity_digest,'successful',measured_sha,octet_length(source_bytes),g.requested_format,j.validation_profile,b.policy_binding_id,'synthetic-pdf-structure','valid','clean','synthetic-adapter/1','1.0.0',project_intelligence._sha256_text('synthetic executable'),1,project_intelligence._sha256_text('synthetic signature bundle'),b.signature_policy_version,j.attempt_started_at,clock_timestamp(),'synthetic:sandbox-attestation',project_intelligence._sha256_text('synthetic sandbox attestation'),extensions.gen_random_uuid(),b.scanner_policy_version,b.sandbox_policy_version);
  begin
   insert into remhaos_integration.external_validation_receipts
   select (jsonb_populate_record(null::remhaos_integration.external_validation_receipts,to_jsonb(existing)||jsonb_build_object('receipt_id',extensions.gen_random_uuid(),'signature_version',null))).*
   from remhaos_integration.external_validation_receipts existing where existing.receipt_id=receipt;
   raise exception 'VALIDATION_NULL_SIGNATURE_ACCEPTED';
  exception when check_violation then null; end;
  begin
   insert into remhaos_integration.external_canonical_object_receipts values(org,project,project,canonical,g.generation_id,receipt,project_intelligence._sha256_text('synthetic canonical identity'),'private/synthetic-validation',project_intelligence._sha256_text('different synthetic source bytes'),100,b.storage_policy_version,project_intelligence._sha256_text('synthetic canonical verification'),clock_timestamp());
   raise exception 'VALIDATION_CANONICAL_SHA_SUBSTITUTED';
  exception when raise_exception then if sqlerrm<>'VALIDATION_CANONICAL_BYTE_MISMATCH' then raise; end if; end;
  begin
   insert into remhaos_integration.external_canonical_object_receipts values(org,project,project,canonical,g.generation_id,receipt,project_intelligence._sha256_text('synthetic canonical identity'),'private/synthetic-validation',measured_sha,99,b.storage_policy_version,project_intelligence._sha256_text('synthetic canonical verification'),clock_timestamp());
   raise exception 'VALIDATION_CANONICAL_LENGTH_SUBSTITUTED';
  exception when raise_exception then if sqlerrm<>'VALIDATION_CANONICAL_BYTE_MISMATCH' then raise; end if; end;
  insert into remhaos_integration.external_canonical_object_receipts values(org,project,project,canonical,g.generation_id,receipt,project_intelligence._sha256_text('synthetic canonical identity'),'private/synthetic-validation',measured_sha,octet_length(source_bytes),b.storage_policy_version,project_intelligence._sha256_text('synthetic canonical verification'),clock_timestamp());
  result:=remhaos_integration._complete_external_validation_job(principal,principal_secret,org,project,project,job,1,1,lease_secret,receipt,canonical,'b-complete');
  replay:=remhaos_integration._complete_external_validation_job(principal,principal_secret,org,project,project,job,1,1,lease_secret,receipt,canonical,'b-complete');
  if replay->>'replay' is distinct from 'true' or replay->'result' is distinct from result->'result' then raise exception 'VALIDATION_TERMINAL_REPLAY_FAILED'; end if;
  if reserve_before is distinct from (select to_jsonb(r) from remhaos_integration.external_upload_reservations r where organization_id=org and project_id=project and reservation_id=s.reservation_id) then raise exception 'VALIDATION_PREMATURE_MATERIALIZATION_ACCOUNTING'; end if;
  if exists(select 1 from remhaos_integration.file_intakes where organization_id=org and project_id=project and intake_id=g.intake_id) or exists(select 1 from projectceo_foundation.external_asset_versions where organization_id=org and project_id=project and origin_intake_generation=g.generation_id::text) then raise exception 'VALIDATION_PREMATURE_INTAKE_ASSET'; end if;
  set constraints all immediate;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 -- Current scope/policy/principal changes deny replay or completion immediately.
 begin
  update remhaos_integration.external_validation_principal_heads set active=false,revision=revision+1 where principal_id=principal;
  perform remhaos_integration._claim_external_validation_job(principal,principal_secret,org,project,project,'legacy-pdf-intake-v1',lease_secret,'b-claim');
  raise exception 'VALIDATION_REVOKED_PRINCIPAL_REPLAY';
 exception when sqlstate 'P1103' then null; end;
 begin
  update remhaos_integration.external_upload_policy_heads set cancellation_revision=cancellation_revision+1,revision=revision+1 where organization_id=org and project_id=project;
  perform remhaos_integration._heartbeat_external_validation_job(principal,principal_secret,org,project,project,job,1,1,lease_secret);
  raise exception 'VALIDATION_POLICY_CANCEL_IGNORED';
 exception when sqlstate 'P1103' then null; end;
 if exists(select 1 from remhaos_integration.command_records where logical_result::text like '%'||lease_secret||'%' or logical_result::text like '%'||principal_secret||'%') then raise exception 'VALIDATION_SECRET_IN_AUDIT'; end if;
 -- Actual wall-clock expiry. No test clock, lease-shortening bypass or fake
 -- expired receipt is installed in production code.
 perform pg_sleep(greatest(0,extract(epoch from (expires-clock_timestamp())))+0.1);
 begin
  perform remhaos_integration._heartbeat_external_validation_job(principal,principal_secret,org,project,project,job,1,1,lease_secret);
  raise exception 'VALIDATION_EXPIRED_HEARTBEAT_RESURRECTED';
 exception when sqlstate 'P1107' then null; end;
 if remhaos_integration._reclaim_external_validation_job(principal,principal_secret,org,project,project,job,1,1,'b-reclaim')<>'queued' then raise exception 'VALIDATION_RECLAIM_NOT_QUEUED'; end if;
 if remhaos_integration._reclaim_external_validation_job(principal,principal_secret,org,project,project,job,1,1,'b-reclaim')<>'queued' then raise exception 'VALIDATION_RECLAIM_REPLAY'; end if;
 result:=remhaos_integration._claim_external_validation_job(principal,principal_secret,org,project,project,'legacy-pdf-intake-v1',lease_two,'b-claim-two');
 begin
  perform remhaos_integration._fail_external_validation_job(principal,principal_secret,org,project,project,job,1,1,lease_secret,null,'transient_io','b-stale-fail');
  raise exception 'VALIDATION_STALE_ATTEMPT_CALLBACK';
 exception when sqlstate 'P1107' then null; end;
 result:=remhaos_integration._fail_external_validation_job(principal,principal_secret,org,project,project,job,2,2,lease_two,null,'transient_io','b-fail-two');
 if result#>>'{result,state}'<>'queued' then raise exception 'VALIDATION_TRANSIENT_RETRY'; end if;
 result:=remhaos_integration._claim_external_validation_job(principal,principal_secret,org,project,project,'legacy-pdf-intake-v1',lease_three,'b-claim-three');
 result:=remhaos_integration._fail_external_validation_job(principal,principal_secret,org,project,project,job,3,3,lease_three,null,'scanner_unavailable','b-fail-three');
 if result#>>'{result,state}'<>'failed' then raise exception 'VALIDATION_ATTEMPT_CAP_NOT_TERMINAL'; end if;
 replay:=remhaos_integration._fail_external_validation_job(principal,principal_secret,org,project,project,job,3,3,lease_three,null,'scanner_unavailable','b-fail-three');
 if replay->>'replay' is distinct from 'true' then raise exception 'VALIDATION_FAILURE_REPLAY'; end if;
 if exists(select 1 from remhaos_integration.external_validation_project_slots where organization_id=org and project_id=project and job_id is not null) then raise exception 'VALIDATION_SLOT_LEAK'; end if;
 if (select count(*) from remhaos_integration.external_validation_attempts where organization_id=org and project_id=project and job_id=job)<>3 then raise exception 'VALIDATION_ATTEMPT_HISTORY'; end if;
 if has_function_privilege('pi_worker_executor','remhaos_integration._claim_external_validation_job(uuid,text,uuid,uuid,uuid,text,text,text)','EXECUTE') or has_table_privilege('service_role','remhaos_integration.external_validation_receipts','INSERT') then raise exception 'VALIDATION_RUNTIME_EXPOSED'; end if;
 set constraints all immediate;
end $validation$;
rollback;
select 'DB4_R1_VALIDATION_LEASE_RECEIPT_OK' as result;


-- Dedicated end-of-harness phases commit only synthetic broker-retained secrets
-- in an owner-only fixture schema. No secret enters domain receipts/audit.
\if :{?r1_validation_overlap}
create schema r1_validation_fixture;
revoke all on schema r1_validation_fixture from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
create table r1_validation_fixture.context (
 organization_id uuid, project_id uuid, principal_id uuid, principal_secret text,
 lease_secret text, job_id uuid, validation_receipt_id uuid, canonical_receipt_id uuid,
 ledger_before jsonb
);
revoke all on r1_validation_fixture.context from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
begin;
do $overlap_seed$
declare
 org uuid; project uuid:='41111111-1111-4111-8111-111111111111';
 principal uuid:=extensions.gen_random_uuid(); host uuid:=extensions.gen_random_uuid();
 principal_secret text:=encode(extensions.gen_random_bytes(32),'hex'); lease_secret text:=encode(extensions.gen_random_bytes(32),'hex'); lease_two text:=encode(extensions.gen_random_bytes(32),'hex'); lease_three text:=encode(extensions.gen_random_bytes(32),'hex');
 g remhaos_integration.external_upload_generations%rowtype; s remhaos_integration.external_upload_sessions%rowtype; b remhaos_integration.external_upload_policy_bindings%rowtype;
 seal remhaos_integration.external_upload_seal_receipts%rowtype; j remhaos_integration.external_validation_jobs%rowtype;
 job uuid; receipt uuid:=extensions.gen_random_uuid(); canonical uuid:=extensions.gen_random_uuid(); result jsonb; replay jsonb; reserve_before jsonb; source_bytes text; measured_sha bytea; expires timestamptz; org_b uuid; binding_b uuid:=extensions.gen_random_uuid(); session_b uuid; intake_b uuid; claim_b uuid:=extensions.gen_random_uuid(); seal_b uuid:=extensions.gen_random_uuid(); generation_b uuid:=extensions.gen_random_uuid(); host_b uuid:=extensions.gen_random_uuid(); principal_b uuid:=extensions.gen_random_uuid(); principal_secret_b text:=encode(extensions.gen_random_bytes(32),'hex'); job_b uuid; other jsonb; detail text;
begin
 select organization_id into strict org from project_intelligence.project_workflows where project_id=project;
 select * into strict g from remhaos_integration.external_upload_generations where organization_id=org and project_id=project;
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=org and project_id=project and session_id=g.session_id;
 select * into strict b from remhaos_integration.external_upload_policy_bindings where organization_id=org and project_id=project and policy_binding_id=s.policy_binding_id;
 select * into strict seal from remhaos_integration.external_upload_seal_receipts where organization_id=org and project_id=project and receipt_id=g.seal_receipt_id;
 -- Synthetic broker credentials/config only. Digests below are computed from
 -- explicit synthetic bytes, not invented expected checksums or real AV proof.
 insert into remhaos_integration.external_validation_hosts values(host,1,'synthetic:host-authority',project_intelligence._sha256_text('synthetic host evidence'),clock_timestamp()+interval '1 hour');
 insert into remhaos_integration.external_validation_principals values(principal,host,'system:synthetic-validation-'||principal,project_intelligence._sha256_text(principal_secret),2,'synthetic:broker-authentication',project_intelligence._sha256_text('synthetic broker evidence'),clock_timestamp()+interval '1 hour');
 insert into remhaos_integration.external_validation_principal_heads(principal_id,active) values(principal,true);
 insert into remhaos_integration.external_validation_principal_scopes values(principal,org,project,project,b.policy_binding_id,'synthetic:processing-scope',project_intelligence._sha256_text('synthetic scope evidence'),clock_timestamp()+interval '1 hour');
 job:=remhaos_integration._enqueue_external_validation_job(org,project,project,g.generation_id);
 if job<>remhaos_integration._enqueue_external_validation_job(org,project,project,g.generation_id) then raise exception 'VALIDATION_ENQUEUE_DUPLICATED'; end if;
 result:=remhaos_integration._claim_external_validation_job(principal,principal_secret,org,project,project,'legacy-pdf-intake-v1',lease_secret,'b-overlap-claim');
 select * into strict j from remhaos_integration.external_validation_jobs where job_id=job;
 source_bytes:=repeat('x',g.observed_byte_length::integer); measured_sha:=project_intelligence._sha256_text(source_bytes);
  insert into remhaos_integration.external_validation_receipts(organization_id,project_id,package_id,receipt_id,job_id,generation_id,attempt,fence,object_identity_digest,outcome,source_sha256,byte_length,validated_format,validation_profile,policy_binding_id,structure_policy_version,structure_result,av_outcome,scanner_adapter_version,engine_version,executable_sha256,signature_version,signature_bundle_sha256,signature_policy_version,scan_started_at,scan_completed_at,sandbox_attestation_reference,sandbox_evidence_digest,completion_request_id,scanner_policy_version,sandbox_policy_version)
  values(org,project,project,receipt,job,g.generation_id,1,1,seal.object_identity_digest,'successful',measured_sha,octet_length(source_bytes),g.requested_format,j.validation_profile,b.policy_binding_id,'synthetic-pdf-structure','valid','clean','synthetic-adapter/1','1.0.0',project_intelligence._sha256_text('synthetic executable'),1,project_intelligence._sha256_text('synthetic signature bundle'),b.signature_policy_version,j.attempt_started_at,clock_timestamp(),'synthetic:sandbox-attestation',project_intelligence._sha256_text('synthetic sandbox attestation'),extensions.gen_random_uuid(),b.scanner_policy_version,b.sandbox_policy_version);
  insert into remhaos_integration.external_canonical_object_receipts values(org,project,project,canonical,g.generation_id,receipt,project_intelligence._sha256_text('synthetic canonical identity'),'private/synthetic-validation',measured_sha,octet_length(source_bytes),b.storage_policy_version,project_intelligence._sha256_text('synthetic canonical verification'),clock_timestamp());
 insert into r1_validation_fixture.context select org,project,principal,principal_secret,lease_secret,job,receipt,canonical,to_jsonb(r) from remhaos_integration.external_upload_quota_ledgers r where organization_id=org and project_id=project;
 set constraints all immediate;
end $overlap_seed$;
commit;
do $package_immutable$ begin begin update projectceo_foundation.project_packages set status='archived' where organization_id=(select organization_id from r1_validation_fixture.context) and project_id=(select project_id from r1_validation_fixture.context) and id=project_id; raise exception 'VALIDATION_PACKAGE_APPEND_ONLY_REMOVED'; exception when sqlstate '55000' then null; end; end $package_immutable$;
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-b-org-revoke-1'"'"'"'"'"'"'"'"'; begin; update project_intelligence.organizations set status='"'"'"'"'"'"'"'"'suspended'"'"'"'"'"'"'"'"' where id=(select organization_id from r1_validation_fixture.context); select pg_sleep(3); commit;'"'"' > /tmp/r1-b-org-revoke-1.log 2>&1 & first=$!; for i in $(seq 1 20); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-b-org-revoke-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.05; done; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-b-org-revoke-2'"'"'"'"'"'"'"'"'; begin; select remhaos_integration._complete_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,c.job_id,1,1,c.lease_secret,c.validation_receipt_id,c.canonical_receipt_id,'"'"'"'"'"'"'"'"'b-overlap-complete'"'"'"'"'"'"'"'"') from r1_validation_fixture.context c; commit;'"'"' > /tmp/r1-b-org-revoke-2.log 2>&1 & second=$!; overlap=f; for i in $(seq 1 20); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-b-org-revoke-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-b-org-revoke-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"')'"'"'); [ "$overlap" = t ] && break; sleep 0.05; done; printf "%s\n" "$overlap" > /tmp/r1-b-org-revoke-overlap; wait "$first"; a=$?; wait "$second"; b=$?; printf "%s %s\n" "$a" "$b" > /tmp/r1-b-org-revoke-exits'
do $race_assert$ begin if btrim(pg_read_file('/tmp/r1-b-org-revoke-overlap'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-b-org-revoke-exits'),E' \n\r\t') not in ('0 1','0 3') or position('forbidden' in pg_read_file('/tmp/r1-b-org-revoke-2.log'))=0 then raise exception 'VALIDATION_REVOKE_OVERLAP_FAILED_org-revoke'; end if;
 if exists(select 1 from remhaos_integration.external_validation_completions) then raise exception 'VALIDATION_REVOKE_DID_NOT_WIN'; end if; end $race_assert$;
update project_intelligence.organizations set status='active' where id=(select organization_id from r1_validation_fixture.context);
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-b-principal-revoke-1'"'"'"'"'"'"'"'"'; begin; update remhaos_integration.external_validation_principal_heads set active=false,revision=revision+1 where principal_id=(select principal_id from r1_validation_fixture.context); select pg_sleep(3); commit;'"'"' > /tmp/r1-b-principal-revoke-1.log 2>&1 & first=$!; for i in $(seq 1 20); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-b-principal-revoke-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.05; done; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-b-principal-revoke-2'"'"'"'"'"'"'"'"'; begin; select remhaos_integration._complete_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,c.job_id,1,1,c.lease_secret,c.validation_receipt_id,c.canonical_receipt_id,'"'"'"'"'"'"'"'"'b-overlap-complete'"'"'"'"'"'"'"'"') from r1_validation_fixture.context c; commit;'"'"' > /tmp/r1-b-principal-revoke-2.log 2>&1 & second=$!; overlap=f; for i in $(seq 1 20); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-b-principal-revoke-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-b-principal-revoke-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"')'"'"'); [ "$overlap" = t ] && break; sleep 0.05; done; printf "%s\n" "$overlap" > /tmp/r1-b-principal-revoke-overlap; wait "$first"; a=$?; wait "$second"; b=$?; printf "%s %s\n" "$a" "$b" > /tmp/r1-b-principal-revoke-exits'
do $race_assert$ begin if btrim(pg_read_file('/tmp/r1-b-principal-revoke-overlap'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-b-principal-revoke-exits'),E' \n\r\t') not in ('0 1','0 3') or position('forbidden' in pg_read_file('/tmp/r1-b-principal-revoke-2.log'))=0 then raise exception 'VALIDATION_REVOKE_OVERLAP_FAILED_principal-revoke'; end if;
 if exists(select 1 from remhaos_integration.external_validation_completions) then raise exception 'VALIDATION_REVOKE_DID_NOT_WIN'; end if; end $race_assert$;
update remhaos_integration.external_validation_principal_heads set active=true,revision=revision+1 where principal_id=(select principal_id from r1_validation_fixture.context);
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-b-complete-first-1'"'"'"'"'"'"'"'"'; begin; select remhaos_integration._complete_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,c.job_id,1,1,c.lease_secret,c.validation_receipt_id,c.canonical_receipt_id,'"'"'"'"'"'"'"'"'b-overlap-complete'"'"'"'"'"'"'"'"') from r1_validation_fixture.context c; select pg_sleep(3); commit;'"'"' > /tmp/r1-b-complete-first-1.log 2>&1 & first=$!; for i in $(seq 1 20); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-b-complete-first-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.05; done; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-b-complete-first-2'"'"'"'"'"'"'"'"'; begin; update project_intelligence.organizations set status='"'"'"'"'"'"'"'"'suspended'"'"'"'"'"'"'"'"' where id=(select organization_id from r1_validation_fixture.context); commit;'"'"' > /tmp/r1-b-complete-first-2.log 2>&1 & second=$!; overlap=f; for i in $(seq 1 20); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-b-complete-first-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-b-complete-first-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"')'"'"'); [ "$overlap" = t ] && break; sleep 0.05; done; printf "%s\n" "$overlap" > /tmp/r1-b-complete-first-overlap; wait "$first"; a=$?; wait "$second"; b=$?; printf "%s %s\n" "$a" "$b" > /tmp/r1-b-complete-first-exits'
do $race_assert$ begin if btrim(pg_read_file('/tmp/r1-b-complete-first-overlap'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-b-complete-first-exits'),E' \n\r\t')<>'0 0' then raise exception 'VALIDATION_REVOKE_OVERLAP_FAILED_complete-first'; end if;
 if (select count(*) from remhaos_integration.external_validation_completions)<>1 then raise exception 'VALIDATION_COMPLETION_FIRST_NOT_COMMITTED'; end if; end $race_assert$;
do $revoked_replay$ declare c r1_validation_fixture.context%rowtype; begin select * into strict c from r1_validation_fixture.context; begin
 perform remhaos_integration._complete_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,c.job_id,1,1,c.lease_secret,c.validation_receipt_id,c.canonical_receipt_id,'b-overlap-complete');
 raise exception 'VALIDATION_REVOKED_TERMINAL_REPLAY'; exception when sqlstate 'P1103' then null; end; end $revoked_replay$;
update project_intelligence.organizations set status='active' where id=(select organization_id from r1_validation_fixture.context);
select 'R1_VALIDATION_REVOKE_COMPLETION_LOCK_OVERLAP_OK' as result;
\endif
\endif
