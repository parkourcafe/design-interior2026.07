\set ON_ERROR_STOP on
-- Synthetic A/B/D/E fixture; no parser, storage bytes or human approval proof.
\if :{?r1_source_pair_restart_check}
begin;
do $restart$ declare c r1_validation_fixture.source_pair_context%rowtype; actual jsonb; n bigint; begin
 select * into strict c from r1_validation_fixture.source_pair_context;
 perform set_config('request.jwt.claim.sub',c.actor_id::text,true);
 select count(*) into n from projectceo_foundation.pdf_dwg_source_pair_confirmations;
 actual:=projectceo_foundation._confirm_pdf_dwg_source_pair(c.project_id,c.project_id,c.dwg_id,c.pdf_id,'synthetic source pair','source-pair-first');
 if actual->>'replay' is distinct from 'true' or actual->'result' is distinct from c.expected_result or (select count(*) from projectceo_foundation.pdf_dwg_source_pair_confirmations)<>n then raise exception 'SOURCE_PAIR_RESTART_CHANGED'; end if;
end $restart$;
rollback;
select 'R1_SOURCE_PAIR_RESTART_REPLAY_OK' as result;
\else
begin;
create table r1_validation_fixture.source_pair_context(organization_id uuid,project_id uuid,actor_id uuid,dwg_id uuid,pdf_id uuid,expected_result jsonb);
do $readiness_profile_matrix$
#variable_conflict use_variable
<<matrix_vars>>
declare
 c r1_validation_fixture.context%rowtype; b remhaos_integration.external_upload_policy_bindings%rowtype;
 binding uuid:=extensions.gen_random_uuid(); f record; upload jsonb; claim_result jsonb; materialized jsonb; proof jsonb; checked_formats text[]:=array[]::text[];
 session_id uuid; intake_id uuid; session_revision bigint; claim_id uuid; seal_id uuid; generation_id uuid; job_id uuid; receipt_id uuid; canonical_id uuid;
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
  insert into r1_validation_fixture.source_pair_context(organization_id,project_id,actor_id) values(c.organization_id,c.project_id,'31111111-1111-4111-8111-111111111111');
  perform set_config('request.jwt.claim.sub','31111111-1111-4111-8111-111111111111',true);
  for f in select * from (values
   ('dwg','dwg','application/octet-stream','dwg','dwg-original-retention-v1'),
   ('pdf','pdf','application/pdf','pdf','legacy-pdf-intake-v1')
  ) matrix(format,extension,media_type,source_kind,profile) loop
   payload:=rpad(f.format,12,'_'); digest:=project_intelligence._sha256_text(payload);
   upload:=remhaos_integration._begin_external_upload(c.project_id,c.project_id,f.format,octet_length(payload),'supplied-'||f.format||'.label','pair-format-upload-'||f.format);
   session_id:=(upload#>>'{result,sessionId}')::uuid; intake_id:=(upload#>>'{result,intakeId}')::uuid;
   claim_id:=extensions.gen_random_uuid(); seal_id:=extensions.gen_random_uuid(); generation_id:=extensions.gen_random_uuid(); receipt_id:=extensions.gen_random_uuid(); canonical_id:=extensions.gen_random_uuid(); lease_secret:=encode(extensions.gen_random_bytes(32),'hex');
   update remhaos_integration.external_upload_sessions x set state='finalizing',revision=revision+1 where x.session_id=matrix_vars.session_id;
   select x.revision into strict session_revision from remhaos_integration.external_upload_sessions x where x.session_id=matrix_vars.session_id;
   insert into remhaos_integration.external_upload_finalize_claims(organization_id,project_id,package_id,claim_id,session_id,session_revision,part_manifest_digest,attempt,fence,principal_binding_reference,token_digest,expires_at,recovery_deadline)
   values(c.organization_id,c.project_id,c.project_id,claim_id,session_id,session_revision,project_intelligence._sha256_text('synthetic parts '||f.format),1,1,'synthetic:format-broker',project_intelligence._sha256_text('synthetic finalize token '||f.format),clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '60 seconds');
   insert into remhaos_integration.external_upload_seal_receipts(organization_id,project_id,package_id,receipt_id,session_id,claim_id,fence,policy_binding_id,adapter_id,storage_policy_version,pin_mode,private_locator,immutable_provider_version,observed_byte_length,object_identity_digest,sealing_evidence_digest,source_claim_digest,closure_evidence_digest)
   values(c.organization_id,c.project_id,c.project_id,seal_id,session_id,claim_id,1,binding,b.adapter_id,b.storage_policy_version,'provider_version','private/format-source-'||generation_id,'synthetic-immutable-version',octet_length(payload),project_intelligence._sha256_text('synthetic object '||generation_id),project_intelligence._sha256_text('synthetic seal '||f.format),project_intelligence._sha256_text('synthetic source claim '||f.format),project_intelligence._sha256_text('synthetic closure '||f.format));
   insert into remhaos_integration.external_upload_generations values(c.organization_id,c.project_id,c.project_id,generation_id,session_id,intake_id,seal_id,octet_length(payload),f.format,'31111111-1111-4111-8111-111111111111',clock_timestamp());
   update remhaos_integration.external_upload_sessions x set state='finalized',revision=revision+1 where x.session_id=matrix_vars.session_id;
   update remhaos_integration.external_upload_finalize_claims x set state='consumed' where x.claim_id=matrix_vars.claim_id;
   update remhaos_integration.external_upload_reservations x set state='committed',revision=revision+1 where x.session_id=matrix_vars.session_id;
   insert into remhaos_integration.external_upload_outbox(organization_id,project_id,package_id,operation_id,session_id,generation_id,kind,target_fence) values(c.organization_id,c.project_id,c.project_id,extensions.gen_random_uuid(),session_id,generation_id,'enqueue_validation',1);
   job_id:=remhaos_integration._enqueue_external_validation_job(c.organization_id,c.project_id,c.project_id,generation_id);
   claim_result:=remhaos_integration._claim_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,f.profile,lease_secret,'pair-format-claim-'||f.format);
   select x.attempt_started_at into strict started_at from remhaos_integration.external_validation_jobs x where x.job_id=matrix_vars.job_id;
   insert into remhaos_integration.external_validation_receipts(organization_id,project_id,package_id,receipt_id,job_id,generation_id,attempt,fence,object_identity_digest,outcome,source_sha256,byte_length,validated_format,validation_profile,policy_binding_id,structure_policy_version,structure_result,av_outcome,scanner_adapter_version,engine_version,executable_sha256,signature_version,signature_bundle_sha256,signature_policy_version,scan_started_at,scan_completed_at,sandbox_attestation_reference,sandbox_evidence_digest,completion_request_id,scanner_policy_version,sandbox_policy_version)
   values(c.organization_id,c.project_id,c.project_id,receipt_id,job_id,generation_id,1,1,project_intelligence._sha256_text('synthetic object '||generation_id),'successful',digest,octet_length(payload),f.format,f.profile,binding,'synthetic structure '||f.profile,'valid','clean','synthetic-adapter/1','1.0.0',project_intelligence._sha256_text('synthetic executable'),1,project_intelligence._sha256_text('synthetic signatures'),b.signature_policy_version,started_at,clock_timestamp(),'synthetic:format-sandbox',project_intelligence._sha256_text('synthetic sandbox evidence'),extensions.gen_random_uuid(),b.scanner_policy_version,b.sandbox_policy_version);
   insert into remhaos_integration.external_canonical_object_receipts values(c.organization_id,c.project_id,c.project_id,canonical_id,generation_id,receipt_id,project_intelligence._sha256_text('synthetic canonical '||generation_id),'private/format-canonical-'||generation_id,digest,octet_length(payload),b.storage_policy_version,project_intelligence._sha256_text('synthetic verification '||f.format),clock_timestamp());
   perform remhaos_integration._complete_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,job_id,1,1,lease_secret,receipt_id,canonical_id,'pair-format-complete-'||f.format);
   materialized:=remhaos_integration._materialize_external_generation(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,generation_id,'pair-format-materialize-'||f.format);
   perform remhaos_integration._review_external_file_intake(c.project_id,c.project_id,intake_id,'accepted','synthetic retained-file profile review','pair-profile-review-'||f.format);
   proof:=projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,(materialized#>>'{result,assetVersionId}')::uuid);
   if proof is distinct from jsonb_build_object('assetVersionId',(materialized#>>'{result,assetVersionId}')::uuid,'generationId',matrix_vars.generation_id,'receiptId',matrix_vars.receipt_id,'sha256',encode(matrix_vars.digest,'hex'),'byteLength',octet_length(matrix_vars.payload),'validatedFormat',f.format,'validationProfile',f.profile) or not exists(select 1 from remhaos_integration.file_intakes i where i.intake_id=matrix_vars.intake_id and i.status='human_reviewed' and i.source_id is null) then raise exception 'READINESS_PROFILE_OR_NATIVE_CONFLATION'; end if;
   if f.format='dwg' then update r1_validation_fixture.source_pair_context set dwg_id=(materialized#>>'{result,assetVersionId}')::uuid; else update r1_validation_fixture.source_pair_context set pdf_id=(materialized#>>'{result,assetVersionId}')::uuid; end if;
   checked_formats:=array_append(checked_formats,f.format);
   raise notice 'R1_HUMAN_READY_PROFILE_OK format=% profile=%',f.format,f.profile;
   if not exists(select 1 from remhaos_integration.file_intakes i join remhaos_integration.external_generation_intake_links l on l.organization_id=i.organization_id and l.project_id=i.project_id and l.package_id=i.package_id and l.intake_id=i.intake_id join remhaos_integration.external_asset_validation_lineage a on a.organization_id=l.organization_id and a.project_id=l.project_id and a.package_id=l.package_id and a.generation_id=l.generation_id join projectceo_foundation.external_asset_versions av on av.organization_id=a.organization_id and av.project_id=a.project_id and av.package_id=a.package_id and av.asset_version_id=a.asset_version_id join projectceo_foundation.external_assets asset on asset.organization_id=av.organization_id and asset.project_id=av.project_id and asset.package_id=av.package_id and asset.asset_id=av.asset_id where i.intake_id=matrix_vars.intake_id and i.r1_generation_id=matrix_vars.generation_id and i.extension=f.extension and i.media_type=f.media_type and i.source_role='document' and i.checksum=digest and i.size_bytes=octet_length(payload) and i.original_filename='supplied-'||f.format||'.label' and l.display_name_origin='supplied' and av.validated_format=f.format and av.server_sha256=digest and asset.source_kind=f.source_kind) then raise exception 'MATERIALIZATION_FORMAT_MAPPING_FAILED: %',f.format; end if;
   raise notice 'R1_MATERIALIZATION_FORMAT_OK %',f.format;
  end loop;
  if cardinality(checked_formats)<>2 then raise exception 'SOURCE_PAIR_FIXTURE_INCOMPLETE'; end if;
  set constraints all immediate;
 end;
end $readiness_profile_matrix$;
create function pg_temp.expect_source_pair_denied(p_dwg uuid,p_pdf uuid,p_key text,p_state text default 'P1111') returns void language plpgsql as $f$
declare c r1_validation_fixture.source_pair_context%rowtype; begin
 select * into strict c from r1_validation_fixture.source_pair_context;
 perform projectceo_foundation._confirm_pdf_dwg_source_pair(c.project_id,c.project_id,p_dwg,p_pdf,'synthetic source pair',p_key);
 raise exception 'SOURCE_PAIR_UNEXPECTED_ALLOW';
exception when others then if sqlstate<>p_state then raise; end if; end $f$;
create function r1_validation_fixture.source_pair_late_failure() returns trigger language plpgsql as $f$
begin
 if new.operation='confirm_pdf_dwg_source_pair' and new.key_digest=project_intelligence._sha256_text('source-pair-late-failure') then raise sqlstate 'P9003' using message='SYNTHETIC_SOURCE_PAIR_LATE_FAILURE'; end if;
 return new;
end $f$;
create trigger source_pair_fixture_late_failure before insert on remhaos_integration.command_records for each row execute function r1_validation_fixture.source_pair_late_failure();
create function r1_validation_fixture.source_pair_audit_failure() returns trigger language plpgsql as $f$
begin
 if new.action='confirm_pdf_dwg_source_pair' and exists(select 1 from remhaos_integration.command_records c where c.command_id=new.command_id and c.key_digest=project_intelligence._sha256_text('source-pair-audit-failure')) then raise sqlstate 'P9004' using message='SYNTHETIC_SOURCE_PAIR_AUDIT_FAILURE'; end if;
 return new;
end $f$;
create trigger source_pair_fixture_audit_failure before insert on remhaos_integration.audit_events for each row execute function r1_validation_fixture.source_pair_audit_failure();
do $behavior$
declare c r1_validation_fixture.source_pair_context%rowtype; response jsonb; replay jsonb; historical jsonb; n bigint; role_name text; alternate_pdf uuid; alternate_result jsonb; malformed text;
begin
 select * into strict c from r1_validation_fixture.source_pair_context;
 perform set_config('request.jwt.claim.sub',c.actor_id::text,true);
 -- Existing uploader owner is not an architect. Synthetic project role change
 -- below supplies an explicit test actor only, never real human approval.
 perform pg_temp.expect_source_pair_denied(c.dwg_id,c.pdf_id,'source-pair-first','P1103');
 update projectceo_foundation.project_memberships pm set role='architect' where pm.organization_id=c.organization_id and pm.project_id=c.project_id and pm.user_id=c.actor_id;
 perform pg_temp.expect_source_pair_denied(c.pdf_id,c.dwg_id,'swapped');
 perform pg_temp.expect_source_pair_denied(c.dwg_id,c.dwg_id,'same');
 perform pg_temp.expect_source_pair_denied(c.dwg_id,'71000000-0000-4000-8000-000000000099','unknown');
 set constraints all immediate;
 perform set_config('TimeZone','UTC',true);
 response:=projectceo_foundation._confirm_pdf_dwg_source_pair(c.project_id,c.project_id,c.dwg_id,c.pdf_id,'synthetic source pair','source-pair-first');
 update r1_validation_fixture.source_pair_context set expected_result=response->'result';
 if response#>>'{result,confirmationStatus}' is distinct from 'architect_confirmed' or response#>>'{result,conversionStatus}' is distinct from 'unconfirmed' or response#>>'{result,warning}' is distinct from 'PDF предоставлен архитектором; DWG conversion не подтверждён' then raise exception 'SOURCE_PAIR_STATUS_OR_WARNING'; end if;
 if not exists(select 1 from projectceo_foundation.external_asset_versions d, projectceo_foundation.external_asset_versions p where d.organization_id=c.organization_id and d.project_id=c.project_id and d.package_id=c.project_id and d.asset_version_id=c.dwg_id and p.organization_id=c.organization_id and p.project_id=c.project_id and p.package_id=c.project_id and p.asset_version_id=c.pdf_id and response#>>'{result,dwgSha256}'=encode(d.server_sha256,'hex') and response#>>'{result,pdfSha256}'=encode(p.server_sha256,'hex') and (response#>>'{result,dwgRevision}')::integer=d.revision_no and (response#>>'{result,pdfRevision}')::integer=p.revision_no and (response#>>'{result,dwgAssetVersionId}')::uuid=d.asset_version_id and (response#>>'{result,pdfAssetVersionId}')::uuid=p.asset_version_id) then raise exception 'SOURCE_PAIR_RESULT_DIFFERS_FROM_SOURCE_VERSIONS'; end if;
 foreach malformed in array array['',' padded ',repeat('x',2001)] loop
  begin
   perform projectceo_foundation._confirm_pdf_dwg_source_pair(c.project_id,c.project_id,c.dwg_id,c.pdf_id,malformed,'malformed-reason');
   raise exception 'SOURCE_PAIR_MALFORMED_REASON_ALLOWED';
  exception when sqlstate 'P1111' then null; end;
 end loop;
 foreach malformed in array array['',' padded ',repeat('x',513)] loop
  perform pg_temp.expect_source_pair_denied(c.dwg_id,c.pdf_id,malformed);
 end loop;
 replay:=projectceo_foundation._confirm_pdf_dwg_source_pair(c.project_id,c.project_id,c.dwg_id,c.pdf_id,'synthetic source pair','source-pair-first');
 if replay->>'replay' is distinct from 'true' or replay->'result' is distinct from response->'result' then raise exception 'SOURCE_PAIR_REPLAY_CHANGED'; end if;
 perform set_config('TimeZone','Asia/Tashkent',true);
 replay:=projectceo_foundation._confirm_pdf_dwg_source_pair(c.project_id,c.project_id,c.dwg_id,c.pdf_id,'synthetic source pair','source-pair-first');
 if replay->'result' is distinct from response->'result' then raise exception 'SOURCE_PAIR_TIMEZONE_REPLAY_CHANGED'; end if;
 perform set_config('TimeZone','UTC',true);
 begin
  perform projectceo_foundation._confirm_pdf_dwg_source_pair(c.project_id,c.project_id,c.dwg_id,c.pdf_id,'different reason','source-pair-first');
  raise exception 'SOURCE_PAIR_REASON_REPLAY';
 exception when sqlstate 'P1208' then null; end;
 select to_jsonb(r) into strict historical from projectceo_foundation.pdf_dwg_source_pair_confirmations r where r.confirmation_id=(response#>>'{result,confirmationId}')::uuid;
 -- Reuse the original genuinely accepted PDF from B/D/E, not an unknown
 -- selector or a manually inserted “ready” asset.
 select l.asset_version_id into strict alternate_pdf
 from r1_validation_fixture.context original
 join remhaos_integration.external_asset_validation_lineage l
 on l.organization_id=original.organization_id and l.project_id=original.project_id
 and l.package_id=original.project_id and l.job_id=original.job_id;
 if alternate_pdf=c.pdf_id then raise exception 'SOURCE_PAIR_SECOND_PDF_NOT_DISTINCT'; end if;
 perform projectceo_foundation.assert_external_source_ready(c.organization_id,c.project_id,c.project_id,alternate_pdf);
 perform pg_temp.expect_source_pair_denied(c.dwg_id,alternate_pdf,'source-pair-first','P1208');
 alternate_result:=projectceo_foundation._confirm_pdf_dwg_source_pair(c.project_id,c.project_id,c.dwg_id,alternate_pdf,'synthetic source pair','source-pair-second');
 if alternate_result#>>'{result,confirmationId}'=response#>>'{result,confirmationId}' or (alternate_result#>>'{result,pdfAssetVersionId}')::uuid<>alternate_pdf then raise exception 'SOURCE_PAIR_DISTINCT_VERSION_REUSED_RECEIPT'; end if;
 if not exists(select 1 from projectceo_foundation.external_asset_versions p where p.organization_id=c.organization_id and p.project_id=c.project_id and p.package_id=c.project_id and p.asset_version_id=alternate_pdf and alternate_result#>>'{result,pdfSha256}'=encode(p.server_sha256,'hex') and (alternate_result#>>'{result,pdfRevision}')::integer=p.revision_no) then raise exception 'SOURCE_PAIR_SECOND_VERSION_FACTS'; end if;
 begin
  update projectceo_foundation.pdf_dwg_source_pair_confirmations set reason='changed' where confirmation_id=(response#>>'{result,confirmationId}')::uuid;
  raise exception 'SOURCE_PAIR_UPDATE_ALLOWED';
 exception when sqlstate '55000' then null; end;
 begin
  delete from projectceo_foundation.pdf_dwg_source_pair_confirmations where confirmation_id=(response#>>'{result,confirmationId}')::uuid;
  raise exception 'SOURCE_PAIR_DELETE_ALLOWED';
 exception when sqlstate '55000' then null; end;
 begin
  update projectceo_foundation.project_memberships pm set role='owner_lead' where pm.organization_id=c.organization_id and pm.project_id=c.project_id and pm.user_id=c.actor_id;
  perform pg_temp.expect_source_pair_denied(c.dwg_id,c.pdf_id,'source-pair-first','P1103');
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 begin
  update remhaos_integration.external_upload_policy_heads set write_eligible=false,revision=revision+1 where organization_id=c.organization_id and project_id=c.project_id;
  perform pg_temp.expect_source_pair_denied(c.dwg_id,c.pdf_id,'source-pair-first','P1103');
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 begin
  update remhaos_integration.external_upload_policy_heads set read_eligible=false,revision=revision+1 where organization_id=c.organization_id and project_id=c.project_id;
  perform pg_temp.expect_source_pair_denied(c.dwg_id,c.pdf_id,'source-pair-first');
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 if historical is distinct from (select to_jsonb(r) from projectceo_foundation.pdf_dwg_source_pair_confirmations r where r.confirmation_id=(response#>>'{result,confirmationId}')::uuid) then raise exception 'SOURCE_PAIR_HISTORY_MUTATED'; end if;
 select count(*) into n from projectceo_foundation.pdf_dwg_source_pair_confirmations;
 begin
  perform projectceo_foundation._confirm_pdf_dwg_source_pair(c.project_id,c.project_id,c.dwg_id,c.pdf_id,'synthetic source pair','source-pair-late-failure');
  raise exception 'SOURCE_PAIR_LATE_FAILURE_NOT_RAISED';
 exception when sqlstate 'P9003' then null; end;
 if (select count(*) from projectceo_foundation.pdf_dwg_source_pair_confirmations)<>n then raise exception 'SOURCE_PAIR_LATE_FAILURE_LEFT_RECEIPT'; end if;
 begin
  perform projectceo_foundation._confirm_pdf_dwg_source_pair(c.project_id,c.project_id,c.dwg_id,c.pdf_id,'synthetic source pair','source-pair-audit-failure');
  raise exception 'SOURCE_PAIR_AUDIT_FAILURE_NOT_RAISED';
 exception when sqlstate 'P9004' then null; end;
 if (select count(*) from projectceo_foundation.pdf_dwg_source_pair_confirmations)<>n or exists(select 1 from remhaos_integration.command_records where organization_id=c.organization_id and project_id=c.project_id and operation='confirm_pdf_dwg_source_pair' and key_digest=project_intelligence._sha256_text('source-pair-audit-failure')) then raise exception 'SOURCE_PAIR_AUDIT_FAILURE_LEFT_EFFECTS'; end if;
 -- Receipt without command cannot survive deferred closure.
 begin
  insert into projectceo_foundation.pdf_dwg_source_pair_confirmations
  select (jsonb_populate_record(null::projectceo_foundation.pdf_dwg_source_pair_confirmations,historical||jsonb_build_object('confirmation_id',extensions.gen_random_uuid(),'key_digest',project_intelligence._sha256_text('orphan-pair')))).*;
  set constraints projectceo_foundation.r1_source_pair_receipt_closure immediate;
  raise exception 'SOURCE_PAIR_ORPHAN_RECEIPT_ALLOWED';
 exception when no_data_found then null; end;
 -- Conversely, a valid-shaped command cannot commit without its typed receipt.
 begin
  set constraints remhaos_integration.r1_source_pair_command_closure deferred;
  insert into remhaos_integration.command_records(organization_id,project_id,operation,key_digest,request_digest,actor_type,actor_id,actor_user_id,logical_result)
  values(c.organization_id,c.project_id,'confirm_pdf_dwg_source_pair',project_intelligence._sha256_text('orphan-pair-command'),project_intelligence._sha256_text('synthetic orphan request'),'human',c.actor_id::text,c.actor_id,response->'result');
  set constraints remhaos_integration.r1_source_pair_command_closure immediate;
  raise exception 'SOURCE_PAIR_ORPHAN_COMMAND_ALLOWED';
 exception when no_data_found then null; end;
 if exists(select 1 from remhaos_integration.command_records where organization_id=c.organization_id and project_id=c.project_id and operation='confirm_pdf_dwg_source_pair' and key_digest=project_intelligence._sha256_text('orphan-pair-command'))
 or (select count(*) from projectceo_foundation.pdf_dwg_source_pair_confirmations)<>n then raise exception 'SOURCE_PAIR_ORPHAN_COMMAND_LEFT_EFFECTS'; end if;
 -- A second audit for the same command is not an independent confirmation.
 begin
  insert into remhaos_integration.audit_events(organization_id,project_id,command_id,actor_type,actor_id,action,outcome_code,correlation_id,sanitized_metadata)
  select organization_id,project_id,command_id,'human',actor_id,'confirm_pdf_dwg_source_pair','ok','synthetic:duplicate-pair-audit','{}' from remhaos_integration.command_records where organization_id=c.organization_id and project_id=c.project_id and operation='confirm_pdf_dwg_source_pair' and key_digest=project_intelligence._sha256_text('source-pair-first');
  set constraints remhaos_integration.r1_source_pair_audit_closure immediate;
  raise exception 'SOURCE_PAIR_EXTRA_AUDIT_ALLOWED';
 exception when raise_exception then if sqlerrm<>'R1_SOURCE_PAIR_AUDIT_MISMATCH' then raise; end if; end;
 foreach role_name in array array['anon','authenticated','service_role','pi_human_executor','pi_worker_executor'] loop
  if has_function_privilege(role_name,'projectceo_foundation._confirm_pdf_dwg_source_pair(uuid,uuid,uuid,uuid,text,text)','EXECUTE') or has_table_privilege(role_name,'projectceo_foundation.pdf_dwg_source_pair_confirmations','SELECT') then raise exception 'SOURCE_PAIR_RUNTIME_ACL'; end if;
 end loop;
 set constraints all immediate;
end $behavior$;
\if :{?r1_source_pair_keep_fixture}
commit;
\else
rollback;
\endif
select 'R1_SOURCE_PAIR_BEHAVIOR_OK' as result;
\endif
