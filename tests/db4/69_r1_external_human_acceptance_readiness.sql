\set ON_ERROR_STOP on
\if :{?r1_human_readiness_restart_check}
begin;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $human_restart_check$
declare c r1_validation_fixture.context%rowtype; l remhaos_integration.external_asset_validation_lineage%rowtype; d remhaos_integration.external_file_intake_decisions%rowtype;
 expected jsonb; response jsonb; ready jsonb; before_counts jsonb; after_counts jsonb;
begin
 select * into strict c from r1_validation_fixture.context;
 select * into strict l from remhaos_integration.external_asset_validation_lineage where organization_id=c.organization_id and project_id=c.project_id;
 select * into strict d from remhaos_integration.external_file_intake_decisions where intake_id=l.intake_id;
 select logical_result into strict expected from remhaos_integration.command_records where organization_id=c.organization_id and project_id=c.project_id and operation='review_external_file_intake' and key_digest=project_intelligence._sha256_text('e-overlap-review');
 select jsonb_build_object('decisions',(select count(*) from remhaos_integration.external_file_intake_decisions),'events',(select count(*) from remhaos_integration.file_intake_events),'commands',(select count(*) from remhaos_integration.command_records)) into before_counts;
 response:=remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'accepted','synthetic overlap retained-file review','e-overlap-review');
 if response->>'replay' is distinct from 'true' or response->'result' is distinct from expected then raise exception 'HUMAN_RESTART_RECEIPT_CHANGED'; end if;
 ready:=projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id);
 if ready is distinct from jsonb_build_object('assetVersionId',d.asset_version_id,'generationId',d.generation_id,'receiptId',d.validation_receipt_id,'sha256',encode(d.source_sha256,'hex'),'byteLength',d.byte_length,'validatedFormat',d.validated_format,'validationProfile',d.validation_profile) then raise exception 'HUMAN_RESTART_READY_FACTS_CHANGED'; end if;
 select jsonb_build_object('decisions',(select count(*) from remhaos_integration.external_file_intake_decisions),'events',(select count(*) from remhaos_integration.file_intake_events),'commands',(select count(*) from remhaos_integration.command_records)) into after_counts;
 if before_counts<>after_counts then raise exception 'HUMAN_RESTART_DUPLICATED_EFFECT'; end if;
 if not exists(select 1 from remhaos_integration.file_intakes where intake_id=l.intake_id and status='human_reviewed' and source_id is null and reviewed_by_user_id=d.decided_by_user_id and reviewed_at=d.decided_at) then raise exception 'HUMAN_RESTART_NATIVE_PROMOTION_OR_IDENTITY_CHANGE'; end if;
end $human_restart_check$;
commit;
select 'R1_HUMAN_ACCEPTANCE_EXACT_REPLAY_CHECK_OK' as result;
\else
begin;
create function r1_validation_fixture.reject_human_review_command() returns trigger language plpgsql as $f$
begin if new.operation='review_external_file_intake' then raise sqlstate 'P9003' using message='SYNTHETIC_LATE_HUMAN_REVIEW_FAILURE'; end if; return new; end $f$;
create trigger r1_fixture_human_late_failure before insert on remhaos_integration.command_records for each row execute function r1_validation_fixture.reject_human_review_command();
do $human_late_failure$
declare c r1_validation_fixture.context%rowtype; l remhaos_integration.external_asset_validation_lineage%rowtype; before_intake jsonb; before_events bigint;
begin
 select * into strict c from r1_validation_fixture.context;
 select * into strict l from remhaos_integration.external_asset_validation_lineage where organization_id=c.organization_id and project_id=c.project_id;
 perform set_config('request.jwt.claim.sub','31111111-1111-4111-8111-111111111111',true);
 select to_jsonb(i) into before_intake from remhaos_integration.file_intakes i where intake_id=l.intake_id;
 select count(*) into before_events from remhaos_integration.file_intake_events where intake_id=l.intake_id;
 begin
  perform remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'accepted','synthetic rollback probe','e-late-failure');
  raise exception 'HUMAN_REVIEW_LATE_FAILURE_NOT_REACHED';
 exception when sqlstate 'P9003' then null; end;
 if exists(select 1 from remhaos_integration.external_file_intake_decisions) or before_intake is distinct from (select to_jsonb(i) from remhaos_integration.file_intakes i where intake_id=l.intake_id) or before_events<>(select count(*) from remhaos_integration.file_intake_events where intake_id=l.intake_id) then raise exception 'HUMAN_REVIEW_PARTIAL_WRITE_LEAK'; end if;
end $human_late_failure$;
drop trigger r1_fixture_human_late_failure on remhaos_integration.command_records;
drop function r1_validation_fixture.reject_human_review_command();

do $acceptance_readiness$
declare c r1_validation_fixture.context%rowtype; l remhaos_integration.external_asset_validation_lineage%rowtype;
 b remhaos_integration.external_upload_policy_bindings%rowtype; i remhaos_integration.file_intakes%rowtype; accepted_record remhaos_integration.external_file_intake_decisions%rowtype;
 reviewer uuid:='32222222-2222-4222-8222-222222222222'; result jsonb; replay jsonb; ready jsonb; binding uuid; source text; state text; role_name text; unbound uuid:=extensions.gen_random_uuid();
begin
 select * into strict c from r1_validation_fixture.context;
 select * into strict l from remhaos_integration.external_asset_validation_lineage where organization_id=c.organization_id and project_id=c.project_id;
 select * into strict i from remhaos_integration.file_intakes where intake_id=l.intake_id;
 select p.* into strict b from remhaos_integration.external_upload_policy_bindings p join remhaos_integration.external_upload_policy_heads h using(organization_id,project_id,policy_binding_id) where p.organization_id=c.organization_id and p.project_id=c.project_id;
 begin
  perform projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id);
  raise exception 'HUMAN_ACCEPTANCE_NOT_REQUIRED';
 exception when sqlstate 'P1111' then null; end;
 -- Correct bytes and a legacy-looking event/projection alone are insufficient.
 begin
  update remhaos_integration.file_intakes set status='human_reviewed',review_decision='accepted',reviewed_by_user_id=reviewer,reviewed_at=clock_timestamp() where intake_id=l.intake_id;
  perform remhaos_integration._record_file_intake_event(c.organization_id,c.project_id,l.intake_id,'clean','human_reviewed','file_human_reviewed','human',reviewer::text,reviewer,'{"decision":"accepted"}');
  begin
   perform projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id);
   raise exception 'UNTYPED_HUMAN_EVENT_PROVED_READINESS';
  exception when sqlstate 'P1111' then null; end;
  set constraints remhaos_integration.r1_intake_decision_fields_closure immediate;
  raise exception 'UNTYPED_HUMAN_FIELDS_COMMITTED';
 exception when raise_exception then if sqlerrm<>'R1_HUMAN_FILE_DECISION_MISSING' then raise; end if; end;
 insert into projectceo_foundation.external_asset_versions(organization_id,project_id,package_id,asset_id,asset_version_id,revision_no,server_sha256,byte_length,validated_format,private_storage_locator,origin_intake_generation,created_by_user_id)
 values(c.organization_id,c.project_id,c.project_id,l.asset_id,unbound,2,i.checksum,i.size_bytes,'pdf','private/synthetic-unbound','legacy-unverified-origin',i.created_by_user_id);
 begin
  perform projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,unbound);
  raise exception 'UNBOUND_ORIGIN_PROVED_READINESS';
 exception when sqlstate 'P1111' then null; end;
 -- Exact package capability, not a role-name shortcut or project-wide grant.
 delete from projectceo_foundation.project_member_capabilities where organization_id=c.organization_id and project_id=c.project_id and user_id=reviewer and capability='review_source';
 insert into projectceo_foundation.package_memberships(organization_id,project_id,package_id,user_id,role) values(c.organization_id,c.project_id,c.project_id,reviewer,'architect') on conflict do nothing;
 insert into projectceo_foundation.package_member_capabilities(organization_id,project_id,package_id,user_id,capability) values(c.organization_id,c.project_id,c.project_id,reviewer,'review_source') on conflict do nothing;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 begin
  perform remhaos_integration._review_external_file_intake(c.project_id,'49999999-9999-4999-8999-999999999999',l.intake_id,'accepted','synthetic sibling denial','e-sibling');
  raise exception 'HUMAN_ROOT_GRANT_INHERITED_SIBLING';
 exception when sqlstate 'P1103' then null; end;
 begin
  result:=remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'rejected','synthetic rejected file','e-reject');
  if result#>>'{result,status}'<>'rejected' then raise exception 'HUMAN_REJECTION_STATUS'; end if;
  begin perform projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id); raise exception 'REJECTED_FILE_READY'; exception when sqlstate 'P1111' then null; end;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 result:=remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'accepted','synthetic accepted retained file','e-accept');
 if result#>>'{result,status}'<>'human_reviewed' or not exists(select 1 from remhaos_integration.external_file_intake_decisions where intake_id=l.intake_id and decided_by_user_id=reviewer and authority_scope='package') or not exists(select 1 from remhaos_integration.file_intakes where intake_id=l.intake_id and status='human_reviewed' and source_id is null) then raise exception 'HUMAN_ACCEPTANCE_AUTHORITY_OR_NATIVE_SIDE_EFFECT'; end if;
 replay:=remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'accepted','synthetic accepted retained file','e-accept');
 if replay->>'replay' is distinct from 'true' or replay->'result' is distinct from result->'result' then raise exception 'HUMAN_ACCEPTANCE_REPLAY'; end if;
 begin
  perform remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'accepted','altered reason','e-accept');
  raise exception 'HUMAN_ACCEPTANCE_REASON_REPLAY';
 exception when sqlstate 'P1208' then null; end;
 begin
  perform set_config('request.jwt.claim.sub','31111111-1111-4111-8111-111111111111',true);
  perform remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'accepted','synthetic accepted retained file','e-accept');
  raise exception 'HUMAN_ACCEPTANCE_CROSS_ACTOR_REPLAY';
 exception when sqlstate 'P1208' then null; end;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 begin
  update project_intelligence.organization_members set status='inactive' where organization_id=c.organization_id and user_id=reviewer;
  perform remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'accepted','synthetic accepted retained file','e-accept');
  raise exception 'HUMAN_REVOKED_REVIEWER_REPLAY';
 exception when sqlstate 'P1103' then null; end;
 ready:=projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id);
 select * into strict accepted_record from remhaos_integration.external_file_intake_decisions where organization_id=c.organization_id and project_id=c.project_id and package_id=c.project_id and intake_id=l.intake_id;
 if ready is distinct from jsonb_build_object('assetVersionId',accepted_record.asset_version_id,'generationId',accepted_record.generation_id,'receiptId',accepted_record.validation_receipt_id,'sha256',encode(accepted_record.source_sha256,'hex'),'byteLength',accepted_record.byte_length,'validatedFormat',accepted_record.validated_format,'validationProfile',accepted_record.validation_profile) then raise exception 'SOURCE_READY_FACTS_OR_SCOPE'; end if;
 foreach state in array array['ingested_candidate','published_internal_copy'] loop
  begin
   update remhaos_integration.file_intakes set status=state where intake_id=l.intake_id;
   if projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id)<>ready then raise exception 'ACCEPTED_LATER_STATUS_LOST_READINESS'; end if;
   set constraints all immediate;
   raise sqlstate 'P9001';
  exception when sqlstate 'P9001' then null; end;
 end loop;
 begin
  update project_intelligence.project_workflows set state_revision=state_revision+1 where organization_id=c.organization_id and project_id=c.project_id;
  if projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id)<>ready then raise exception 'UNRELATED_GLOBAL_REVISION_INVALIDATED_SOURCE'; end if;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 -- Historical people/worker expiry do not erase accepted project evidence.
 begin
  update project_intelligence.organization_members set status='inactive' where organization_id=c.organization_id and user_id in (reviewer,i.created_by_user_id);
  update remhaos_integration.external_validation_principal_heads set active=false,revision=revision+1 where principal_id=c.principal_id;
  if projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id)<>ready then raise exception 'HISTORICAL_EMPLOYMENT_INVALIDATED_FILE'; end if;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 -- A current read-only authority may rotate processing preferences. This does
 -- not retrospectively revoke the old profile or refresh its scan evidence.
 begin
  binding:=extensions.gen_random_uuid();
  insert into remhaos_integration.external_upload_policy_bindings select (jsonb_populate_record(null::remhaos_integration.external_upload_policy_bindings,to_jsonb(b)||jsonb_build_object('policy_binding_id',binding,'signature_policy_version','synthetic-new-signatures','scanner_policy_version','synthetic-new-scanner','accepted_profiles',array['skp-original-retention-v1']))).*;
  update remhaos_integration.external_upload_policy_heads set policy_binding_id=binding,write_eligible=false,processing_eligible=false,read_eligible=true,revision=revision+1 where organization_id=c.organization_id and project_id=c.project_id;
  if projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id)<>ready then raise exception 'READ_AUTHORITY_ROTATION_INVALIDATED_HISTORY'; end if;
  begin perform remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'accepted','synthetic accepted retained file','e-accept'); raise exception 'READ_GRACE_ALLOWED_NEW_REVIEW_COMMAND'; exception when sqlstate 'P1103' then null; end;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 begin
  update remhaos_integration.external_upload_policy_heads set cancellation_revision=cancellation_revision+1,revision=revision+1 where organization_id=c.organization_id and project_id=c.project_id;
  perform projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id);
  raise exception 'EXPLICIT_POLICY_REVOCATION_IGNORED';
 exception when sqlstate 'P1111' then null; end;
 begin
  update remhaos_integration.external_upload_policy_heads set read_eligible=false,revision=revision+1 where organization_id=c.organization_id and project_id=c.project_id;
  perform projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id);
  raise exception 'CURRENT_READ_AUTHORITY_IGNORED';
 exception when sqlstate 'P1111' then null; end;
 begin
  binding:=extensions.gen_random_uuid();
  insert into remhaos_integration.external_upload_policy_bindings select (jsonb_populate_record(null::remhaos_integration.external_upload_policy_bindings,to_jsonb(b)||jsonb_build_object('policy_binding_id',binding,'valid_from',clock_timestamp()-interval '2 hours','valid_until',clock_timestamp()-interval '1 hour'))).*;
  update remhaos_integration.external_upload_policy_heads set policy_binding_id=binding,revision=revision+1 where organization_id=c.organization_id and project_id=c.project_id;
  perform projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id);
  raise exception 'EXPIRED_CURRENT_READ_AUTHORITY_IGNORED';
 exception when sqlstate 'P1111' then null; end;
 begin
  update remhaos_integration.external_upload_sessions set cancellation_revision=cancellation_revision+1,revision=revision+1,grant_revocation_state='pending' where session_id=(select session_id from remhaos_integration.external_upload_generations where organization_id=c.organization_id and project_id=c.project_id and generation_id=l.generation_id);
  perform projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id);
  raise exception 'EXPLICIT_SESSION_REVOCATION_IGNORED';
 exception when sqlstate 'P1111' then null; end;
 -- Static temporal contract assertion accompanies the live policy-rotation test;
 -- this fixture does not pretend to advance the wall clock by 24 hours.
 source:=pg_get_functiondef('remhaos_integration._lock_external_source_review_context(uuid,uuid,uuid,uuid)'::regprocedure);
 if source ~ 'lease_expires_at|scan_completed_at|attempt_started_at|signature_version|86400|24 hours' then raise exception 'ROLLING_HISTORICAL_EVIDENCE_EXPIRY_INTRODUCED'; end if;
 foreach role_name in array array['anon','authenticated','service_role','pi_human_executor','pi_worker_executor'] loop
  if has_function_privilege(role_name,'projectceo_foundation.assert_external_source_ready(uuid,uuid,uuid,uuid)','EXECUTE') or has_function_privilege(role_name,'remhaos_integration._review_external_file_intake(uuid,uuid,uuid,text,text,text)','EXECUTE') then raise exception 'HUMAN_READINESS_RUNTIME_EXPOSED'; end if;
 end loop;
 set constraints all immediate;
end $acceptance_readiness$;
-- Type/profile/lineage matrix only: these explicit synthetic receipts do not
-- establish real AV, parser, conversion, geometry or provider acceptance.
do $readiness_profile_matrix$
#variable_conflict use_variable
<<matrix_vars>>
declare
 c r1_validation_fixture.context%rowtype; b remhaos_integration.external_upload_policy_bindings%rowtype;
 binding uuid:=extensions.gen_random_uuid(); f record; upload jsonb; claim_result jsonb; materialized jsonb; proof jsonb;
 session_id uuid; intake_id uuid; claim_id uuid; seal_id uuid; generation_id uuid; job_id uuid; receipt_id uuid; canonical_id uuid;
 lease_secret text; payload text; digest bytea; started_at timestamptz;
begin
 select * into strict c from r1_validation_fixture.context;
 select policy.* into strict b from remhaos_integration.external_upload_policy_bindings policy join remhaos_integration.external_upload_policy_heads head using(organization_id,project_id,policy_binding_id) where policy.organization_id=c.organization_id and policy.project_id=c.project_id;
 set constraints all deferred;
 begin
  insert into remhaos_integration.external_upload_policy_bindings
  select (jsonb_populate_record(null::remhaos_integration.external_upload_policy_bindings,to_jsonb(b)||jsonb_build_object('policy_binding_id',binding,'runtime_authority_reference','synthetic:format-matrix-runtime','runtime_evidence_digest',project_intelligence._sha256_text('synthetic all-format runtime'),'accepted_profiles',array['skp-original-retention-v1','dwg-original-retention-v1','glb-viewable-input-v1','dae-package-conversion-input-v1','legacy-pdf-intake-v1','legacy-image-intake-v1']))).*;
  update remhaos_integration.external_upload_policy_heads set policy_binding_id=binding,revision=revision+1 where organization_id=c.organization_id and project_id=c.project_id;
  insert into remhaos_integration.external_validation_principal_scopes values(c.principal_id,c.organization_id,c.project_id,c.project_id,binding,'synthetic:format-matrix-scope',project_intelligence._sha256_text('synthetic format-matrix authority'),clock_timestamp()+interval '1 hour');
  perform set_config('request.jwt.claim.sub','31111111-1111-4111-8111-111111111111',true);
  for f in select * from (values
   ('skp','skp','application/octet-stream','skp','skp-original-retention-v1'),
   ('dwg','dwg','application/octet-stream','dwg','dwg-original-retention-v1'),
   ('glb','glb','model/gltf-binary','glb','glb-viewable-input-v1'),
   ('dae-package','zip','application/zip','dae','dae-package-conversion-input-v1'),
   ('pdf','pdf','application/pdf','pdf','legacy-pdf-intake-v1'),
   ('jpg','jpg','image/jpeg','image','legacy-image-intake-v1'),
   ('jpeg','jpeg','image/jpeg','image','legacy-image-intake-v1'),
   ('png','png','image/png','image','legacy-image-intake-v1')
  ) matrix(format,extension,media_type,source_kind,profile) where format in ('skp','glb') loop
   payload:=rpad(f.format,12,'_'); digest:=project_intelligence._sha256_text(payload);
   upload:=remhaos_integration._begin_external_upload(c.project_id,c.project_id,f.format,octet_length(payload),'supplied-'||f.format||'.label','d-format-upload-'||f.format);
   session_id:=(upload#>>'{result,sessionId}')::uuid; intake_id:=(upload#>>'{result,intakeId}')::uuid;
   claim_id:=extensions.gen_random_uuid(); seal_id:=extensions.gen_random_uuid(); generation_id:=extensions.gen_random_uuid(); receipt_id:=extensions.gen_random_uuid(); canonical_id:=extensions.gen_random_uuid(); lease_secret:=encode(extensions.gen_random_bytes(32),'hex');
   update remhaos_integration.external_upload_sessions x set state='finalizing',revision=revision+1 where x.session_id=matrix_vars.session_id;
   insert into remhaos_integration.external_upload_finalize_claims(organization_id,project_id,package_id,claim_id,session_id,session_revision,part_manifest_digest,attempt,fence,principal_binding_reference,token_digest,expires_at,recovery_deadline)
   values(c.organization_id,c.project_id,c.project_id,claim_id,session_id,1,project_intelligence._sha256_text('synthetic parts '||f.format),1,1,'synthetic:format-broker',project_intelligence._sha256_text('synthetic finalize token '||f.format),clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '60 seconds');
   insert into remhaos_integration.external_upload_seal_receipts(organization_id,project_id,package_id,receipt_id,session_id,claim_id,fence,policy_binding_id,adapter_id,storage_policy_version,pin_mode,private_locator,immutable_provider_version,observed_byte_length,object_identity_digest,sealing_evidence_digest,source_claim_digest,closure_evidence_digest)
   values(c.organization_id,c.project_id,c.project_id,seal_id,session_id,claim_id,1,binding,b.adapter_id,b.storage_policy_version,'provider_version','private/format-source-'||generation_id,'synthetic-immutable-version',octet_length(payload),project_intelligence._sha256_text('synthetic object '||generation_id),project_intelligence._sha256_text('synthetic seal '||f.format),project_intelligence._sha256_text('synthetic source claim '||f.format),project_intelligence._sha256_text('synthetic closure '||f.format));
   insert into remhaos_integration.external_upload_generations values(c.organization_id,c.project_id,c.project_id,generation_id,session_id,intake_id,seal_id,octet_length(payload),f.format,'31111111-1111-4111-8111-111111111111',clock_timestamp());
   update remhaos_integration.external_upload_sessions x set state='finalized',revision=revision+1 where x.session_id=matrix_vars.session_id;
   update remhaos_integration.external_upload_finalize_claims x set state='consumed' where x.claim_id=matrix_vars.claim_id;
   update remhaos_integration.external_upload_reservations x set state='committed',revision=revision+1 where x.session_id=matrix_vars.session_id;
   insert into remhaos_integration.external_upload_outbox(organization_id,project_id,package_id,operation_id,session_id,generation_id,kind,target_fence) values(c.organization_id,c.project_id,c.project_id,extensions.gen_random_uuid(),session_id,generation_id,'enqueue_validation',1);
   job_id:=remhaos_integration._enqueue_external_validation_job(c.organization_id,c.project_id,c.project_id,generation_id);
   claim_result:=remhaos_integration._claim_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,f.profile,lease_secret,'d-format-claim-'||f.format);
   select x.attempt_started_at into strict started_at from remhaos_integration.external_validation_jobs x where x.job_id=matrix_vars.job_id;
   insert into remhaos_integration.external_validation_receipts(organization_id,project_id,package_id,receipt_id,job_id,generation_id,attempt,fence,object_identity_digest,outcome,source_sha256,byte_length,validated_format,validation_profile,policy_binding_id,structure_policy_version,structure_result,av_outcome,scanner_adapter_version,engine_version,executable_sha256,signature_version,signature_bundle_sha256,signature_policy_version,scan_started_at,scan_completed_at,sandbox_attestation_reference,sandbox_evidence_digest,completion_request_id,scanner_policy_version,sandbox_policy_version)
   values(c.organization_id,c.project_id,c.project_id,receipt_id,job_id,generation_id,1,1,project_intelligence._sha256_text('synthetic object '||generation_id),'successful',digest,octet_length(payload),f.format,f.profile,binding,'synthetic structure '||f.profile,'valid','clean','synthetic-adapter/1','1.0.0',project_intelligence._sha256_text('synthetic executable'),1,project_intelligence._sha256_text('synthetic signatures'),b.signature_policy_version,started_at,clock_timestamp(),'synthetic:format-sandbox',project_intelligence._sha256_text('synthetic sandbox evidence'),extensions.gen_random_uuid(),b.scanner_policy_version,b.sandbox_policy_version);
   insert into remhaos_integration.external_canonical_object_receipts values(c.organization_id,c.project_id,c.project_id,canonical_id,generation_id,receipt_id,project_intelligence._sha256_text('synthetic canonical '||generation_id),'private/format-canonical-'||generation_id,digest,octet_length(payload),b.storage_policy_version,project_intelligence._sha256_text('synthetic verification '||f.format),clock_timestamp());
   perform remhaos_integration._complete_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,job_id,1,1,lease_secret,receipt_id,canonical_id,'d-format-complete-'||f.format);
   materialized:=remhaos_integration._materialize_external_generation(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,generation_id,'d-format-materialize-'||f.format);
   perform remhaos_integration._review_external_file_intake(c.project_id,c.project_id,intake_id,'accepted','synthetic retained-file profile review','e-profile-review-'||f.format);
   proof:=projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,(materialized#>>'{result,assetVersionId}')::uuid);
   if proof is distinct from jsonb_build_object('assetVersionId',(materialized#>>'{result,assetVersionId}')::uuid,'generationId',matrix_vars.generation_id,'receiptId',matrix_vars.receipt_id,'sha256',encode(matrix_vars.digest,'hex'),'byteLength',octet_length(matrix_vars.payload),'validatedFormat',f.format,'validationProfile',f.profile) or not exists(select 1 from remhaos_integration.file_intakes i where i.intake_id=matrix_vars.intake_id and i.status='human_reviewed' and i.source_id is null) then raise exception 'READINESS_PROFILE_OR_NATIVE_CONFLATION'; end if;
   raise notice 'R1_HUMAN_READY_PROFILE_OK %',f.profile;
   if not exists(select 1 from remhaos_integration.file_intakes i join remhaos_integration.external_generation_intake_links l on l.organization_id=i.organization_id and l.project_id=i.project_id and l.package_id=i.package_id and l.intake_id=i.intake_id join remhaos_integration.external_asset_validation_lineage a on a.organization_id=l.organization_id and a.project_id=l.project_id and a.package_id=l.package_id and a.generation_id=l.generation_id join projectceo_foundation.external_asset_versions av on av.organization_id=a.organization_id and av.project_id=a.project_id and av.package_id=a.package_id and av.asset_version_id=a.asset_version_id join projectceo_foundation.external_assets asset on asset.organization_id=av.organization_id and asset.project_id=av.project_id and asset.package_id=av.package_id and asset.asset_id=av.asset_id where i.intake_id=matrix_vars.intake_id and i.r1_generation_id=matrix_vars.generation_id and i.extension=f.extension and i.media_type=f.media_type and i.source_role='document' and i.checksum=digest and i.size_bytes=octet_length(payload) and i.original_filename='supplied-'||f.format||'.label' and l.display_name_origin='supplied' and av.validated_format=f.format and av.server_sha256=digest and asset.source_kind=f.source_kind) then raise exception 'MATERIALIZATION_FORMAT_MAPPING_FAILED: %',f.format; end if;
   raise notice 'R1_MATERIALIZATION_FORMAT_OK %',f.format;
  end loop;
  set constraints all immediate;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
end $readiness_profile_matrix$;
rollback;
select 'DB4_R1_HUMAN_ACCEPTANCE_READINESS_OK' as result;

\if :{?r1_human_readiness_overlap}
-- Only synthetic fixture identities are assigned this explicit package grant.
begin;
delete from projectceo_foundation.project_member_capabilities where organization_id=(select organization_id from r1_validation_fixture.context) and project_id=(select project_id from r1_validation_fixture.context) and user_id='32222222-2222-4222-8222-222222222222' and capability='review_source';
insert into projectceo_foundation.package_memberships(organization_id,project_id,package_id,user_id,role) select organization_id,project_id,project_id,'32222222-2222-4222-8222-222222222222','architect' from r1_validation_fixture.context on conflict do nothing;
insert into projectceo_foundation.package_member_capabilities(organization_id,project_id,package_id,user_id,capability) select organization_id,project_id,project_id,'32222222-2222-4222-8222-222222222222','review_source' from r1_validation_fixture.context on conflict do nothing;
do $fresh_human_case$ begin if exists(select 1 from remhaos_integration.external_file_intake_decisions) then raise exception 'HUMAN_REVIEW_RACE_NOT_FRESH'; end if; end $fresh_human_case$;
commit;
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-e-cap-revoke-1'"'"'"'"'"'"'"'"'; begin; delete from projectceo_foundation.package_member_capabilities where organization_id=(select organization_id from r1_validation_fixture.context) and project_id=(select project_id from r1_validation_fixture.context) and package_id=project_id and user_id='"'"'"'"'"'"'"'"'32222222-2222-4222-8222-222222222222'"'"'"'"'"'"'"'"' and capability='"'"'"'"'"'"'"'"'review_source'"'"'"'"'"'"'"'"'; select pg_sleep(3); commit;'"'"' > /tmp/r1-e-cap-revoke-1.log 2>&1 & first=$!; for i in $(seq 1 20); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-e-cap-revoke-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.05; done; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-e-cap-revoke-2'"'"'"'"'"'"'"'"'; begin; set local request.jwt.claim.sub='"'"'"'"'"'"'"'"'32222222-2222-4222-8222-222222222222'"'"'"'"'"'"'"'"'; select remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'"'"'"'"'"'"'"'"'accepted'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'synthetic overlap retained-file review'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'e-overlap-review'"'"'"'"'"'"'"'"') from r1_validation_fixture.context c join remhaos_integration.external_asset_validation_lineage l on l.organization_id=c.organization_id and l.project_id=c.project_id and l.package_id=c.project_id; commit;'"'"' > /tmp/r1-e-cap-revoke-2.log 2>&1 & second=$!; overlap=f; for i in $(seq 1 20); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-e-cap-revoke-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-e-cap-revoke-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"')'"'"'); [ "$overlap" = t ] && break; sleep 0.05; done; printf "%s\n" "$overlap" > /tmp/r1-e-cap-revoke-overlap; wait "$first"; a=$?; wait "$second"; b=$?; printf "%s %s\n" "$a" "$b" > /tmp/r1-e-cap-revoke-exits'
do $human_race_assert$ begin if btrim(pg_read_file('/tmp/r1-e-cap-revoke-overlap'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-e-cap-revoke-exits'),E' \n\r\t') not in ('0 1','0 3') or position('forbidden' in pg_read_file('/tmp/r1-e-cap-revoke-2.log'))=0 then raise exception 'HUMAN_REVIEW_REVOKE_RACE_FAILED_cap-revoke'; end if;
 if exists(select 1 from remhaos_integration.external_file_intake_decisions) then raise exception 'HUMAN_REVOKE_FIRST_IGNORED'; end if; end $human_race_assert$;
insert into projectceo_foundation.package_member_capabilities(organization_id,project_id,package_id,user_id,capability) select organization_id,project_id,project_id,'32222222-2222-4222-8222-222222222222','review_source' from r1_validation_fixture.context;
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-e-accept-first-1'"'"'"'"'"'"'"'"'; begin; set local request.jwt.claim.sub='"'"'"'"'"'"'"'"'32222222-2222-4222-8222-222222222222'"'"'"'"'"'"'"'"'; select remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'"'"'"'"'"'"'"'"'accepted'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'synthetic overlap retained-file review'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'e-overlap-review'"'"'"'"'"'"'"'"') from r1_validation_fixture.context c join remhaos_integration.external_asset_validation_lineage l on l.organization_id=c.organization_id and l.project_id=c.project_id and l.package_id=c.project_id; select pg_sleep(3); commit;'"'"' > /tmp/r1-e-accept-first-1.log 2>&1 & first=$!; for i in $(seq 1 20); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-e-accept-first-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.05; done; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-e-accept-first-2'"'"'"'"'"'"'"'"'; begin; update project_intelligence.organization_members set status='"'"'"'"'"'"'"'"'inactive'"'"'"'"'"'"'"'"' where organization_id=(select organization_id from r1_validation_fixture.context) and user_id='"'"'"'"'"'"'"'"'32222222-2222-4222-8222-222222222222'"'"'"'"'"'"'"'"'; commit;'"'"' > /tmp/r1-e-accept-first-2.log 2>&1 & second=$!; overlap=f; for i in $(seq 1 20); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-e-accept-first-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-e-accept-first-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"')'"'"'); [ "$overlap" = t ] && break; sleep 0.05; done; printf "%s\n" "$overlap" > /tmp/r1-e-accept-first-overlap; wait "$first"; a=$?; wait "$second"; b=$?; printf "%s %s\n" "$a" "$b" > /tmp/r1-e-accept-first-exits'
do $human_race_assert$ begin if btrim(pg_read_file('/tmp/r1-e-accept-first-overlap'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-e-accept-first-exits'),E' \n\r\t')<>'0 0' then raise exception 'HUMAN_REVIEW_REVOKE_RACE_FAILED_accept-first'; end if;
 if (select count(*) from remhaos_integration.external_file_intake_decisions)<>1 then raise exception 'HUMAN_REVIEW_FIRST_NOT_COMMITTED'; end if; end $human_race_assert$;
begin;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $revoked_human_replay$ declare c r1_validation_fixture.context%rowtype; l remhaos_integration.external_asset_validation_lineage%rowtype; begin
 select * into strict c from r1_validation_fixture.context; select * into strict l from remhaos_integration.external_asset_validation_lineage where organization_id=c.organization_id and project_id=c.project_id;
 begin perform remhaos_integration._review_external_file_intake(c.project_id,c.project_id,l.intake_id,'accepted','synthetic overlap retained-file review','e-overlap-review'); raise exception 'HUMAN_REVOKED_REPLAY_RETURNED'; exception when sqlstate 'P1103' then null; end;
 perform projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,l.asset_version_id);
end $revoked_human_replay$;
commit;
update project_intelligence.organization_members set status='active' where organization_id=(select organization_id from r1_validation_fixture.context) and user_id='32222222-2222-4222-8222-222222222222';
select 'R1_HUMAN_ACCEPTANCE_REVOKE_LOCK_OVERLAP_OK' as result;
\endif
\endif
